import {
  createAppUserRecord,
  createAuditEvent,
  mergeAppUserRecord,
  normalizeEmail,
  normalizeProviderGrantList,
  sanitizeAppUserRecord,
} from "./app-users.mjs";
import { hashPersonalAccessToken, normalizePersonalAccessTokenScopes } from "./personal-access-tokens.mjs";

const STACK_API_BASE_URL = "https://api.stack-auth.com/api/v1";
const STACK_ME_URL = `${STACK_API_BASE_URL}/users/me`;
const STACK_TEAMS_URL = `${STACK_API_BASE_URL}/teams?user_id=me`;
const STACK_VERIFY_CACHE_TTL_MS = 5000;
const STACK_REQUEST_TIMEOUT_MS = 10000;
const BASE_PAT_SCOPES = ["broker:read", "ingest:write"];

const stackVerificationCache = new Map();
const stackVerificationInflight = new Map();

function bearerTokenFromRequest(req) {
  const header = String(req.headers.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice("bearer ".length).trim();
}

function stackAccessTokenFromRequest(req) {
  return String(req.headers["x-stack-access-token"] || "").trim();
}

function scopeSet(scopes) {
  return new Set(
    (Array.isArray(scopes) ? scopes : [])
      .map((scope) => String(scope || "").trim())
      .filter(Boolean),
  );
}

function hasRequiredScopes(grantedScopes, requiredScopes = [], options = {}) {
  if (!requiredScopes.length) {
    return true;
  }
  const granted = scopeSet(grantedScopes);
  if (options.allowWildcard === true && granted.has("*")) {
    return true;
  }
  return requiredScopes.every((scope) => granted.has(scope));
}

function isStoreReadyForAppUsers(store) {
  return Boolean(
    store &&
      typeof store.findAppUserByStackUserId === "function" &&
      typeof store.findAppUserByEmail === "function" &&
      typeof store.createAppUser === "function" &&
      typeof store.updateAppUser === "function",
  );
}

async function appendAuditEvent(store, payload) {
  if (!store || typeof store.appendAuditEvent !== "function") {
    return null;
  }
  return store.appendAuditEvent(createAuditEvent(payload));
}

function stackVerificationCacheKey(config, accessToken) {
  return JSON.stringify({
    accessToken,
    projectId: String(config.stack?.projectId || ""),
    secretServerKey: String(config.stack?.secretServerKey || ""),
    internalTeamIds: (config.stack?.internalTeamIds || []).map((teamId) => String(teamId || "").trim()).sort(),
    adminTeamIds: (config.stack?.adminTeamIds || []).map((teamId) => String(teamId || "").trim()).sort(),
  });
}

function readCachedStackVerification(cacheKey, nowMs) {
  const cached = stackVerificationCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (!Number.isFinite(cached.expiresAt) || cached.expiresAt <= nowMs) {
    stackVerificationCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function cloneCachedError(cached) {
  const error = new Error(cached.message || "Stack user verification failed.");
  error.statusCode = cached.statusCode || 500;
  return error;
}

function cacheNullStackVerification(cacheKey, nowMs) {
  stackVerificationCache.set(cacheKey, {
    type: "null",
    expiresAt: nowMs + STACK_VERIFY_CACHE_TTL_MS,
  });
}

function stackRequestHeaders(config, accessToken) {
  return {
    "x-stack-access-type": "server",
    "x-stack-project-id": config.stack.projectId,
    "x-stack-secret-server-key": config.stack.secretServerKey,
    "x-stack-access-token": accessToken,
    accept: "application/json",
  };
}

async function fetchStackJson(url, config, accessToken, errorLabel) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: stackRequestHeaders(config, accessToken),
      signal: AbortSignal.timeout(STACK_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    const wrapped = new Error(
      timeout
        ? `Stack ${errorLabel} timed out after ${STACK_REQUEST_TIMEOUT_MS}ms.`
        : `Stack ${errorLabel} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    wrapped.statusCode = 502;
    throw wrapped;
  }
  if (response.status === 401 || response.status === 403) {
    return {
      type: "null",
      payload: null,
    };
  }
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Stack ${errorLabel} failed (${response.status}): ${text.slice(0, 240)}`);
    error.statusCode = 502;
    throw error;
  }
  return {
    type: "ok",
    payload: await response.json(),
  };
}

function normalizeStackTeamIds(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : null;
  if (!items) {
    const error = new Error("Stack team membership lookup returned a malformed response.");
    error.statusCode = 502;
    throw error;
  }
  return [...new Set(
    items
      .map((item) => String(item?.id || item?.team_id || "").trim())
      .filter(Boolean),
  )];
}

async function verifyStackUser(req, config) {
  if (!config.stack?.enabled) {
    return null;
  }
  const accessToken = stackAccessTokenFromRequest(req);
  if (!accessToken) {
    return null;
  }
  if (!config.stack.projectId || !config.stack.secretServerKey) {
    const error = new Error("Stack Auth is enabled but WAVE_CONTROL_STACK_PROJECT_ID or STACK_SECRET_SERVER_KEY is missing.");
    error.statusCode = 500;
    throw error;
  }
  const internalTeamIds = new Set(config.stack.internalTeamIds || []);
  if (internalTeamIds.size === 0) {
    const error = new Error("Stack Auth is enabled but WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS is missing.");
    error.statusCode = 500;
    throw error;
  }
  const cacheKey = stackVerificationCacheKey(config, accessToken);
  const nowMs = Date.now();
  const cached = readCachedStackVerification(cacheKey, nowMs);
  if (cached) {
    if (cached.type === "principal") {
      return cached.principal;
    }
    if (cached.type === "null") {
      return null;
    }
    if (cached.type === "error") {
      throw cloneCachedError(cached);
    }
  }
  const inflight = stackVerificationInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }
  const verification = (async () => {
    const userResult = await fetchStackJson(STACK_ME_URL, config, accessToken, "user verification");
    if (userResult.type === "null") {
      cacheNullStackVerification(cacheKey, nowMs);
      return null;
    }
    const teamsResult = await fetchStackJson(STACK_TEAMS_URL, config, accessToken, "team membership lookup");
    if (teamsResult.type === "null") {
      cacheNullStackVerification(cacheKey, nowMs);
      return null;
    }
    const payload = userResult.payload;
    const teamIds = normalizeStackTeamIds(teamsResult.payload);
    const adminTeamIds = new Set(config.stack.adminTeamIds || []);
    const isInternal = teamIds.some((teamId) => internalTeamIds.has(teamId));
    if (!isInternal) {
      const error = new Error("Authenticated Stack user is not a member of an allowed internal team.");
      error.statusCode = 403;
      stackVerificationCache.set(cacheKey, {
        type: "error",
        statusCode: error.statusCode,
        message: error.message,
        expiresAt: nowMs + STACK_VERIFY_CACHE_TTL_MS,
      });
      throw error;
    }
    const principal = {
      type: "stack-user",
      stackUserId: String(payload.id || payload.userId || payload.user_id || "").trim() || null,
      email: normalizeEmail(payload.primaryEmail || payload.primary_email || payload.email || ""),
      displayName: String(payload.displayName || payload.display_name || payload.name || "").trim() || null,
      teamIds,
      stackAdminTeamMember: teamIds.some((teamId) => adminTeamIds.has(teamId)),
      isInternal: true,
      accessState: "none",
      appRole: null,
      appUserId: null,
      providerGrants: [],
      scopes: [],
      raw: {
        user: payload,
        teams: teamsResult.payload,
      },
    };
    stackVerificationCache.set(cacheKey, {
      type: "principal",
      principal,
      expiresAt: nowMs + STACK_VERIFY_CACHE_TTL_MS,
    });
    return principal;
  })();
  stackVerificationInflight.set(cacheKey, verification);
  try {
    return await verification;
  } finally {
    stackVerificationInflight.delete(cacheKey);
  }
}

function isBootstrapSuperuser(config, email) {
  const normalized = normalizeEmail(email);
  return Boolean(
    normalized &&
      (config.stack?.bootstrapSuperuserEmails || [])
        .map((entry) => normalizeEmail(entry))
        .includes(normalized),
  );
}

async function findStoredAppUserByIdentity(store, identity = {}) {
  if (!isStoreReadyForAppUsers(store)) {
    return null;
  }
  const stackUserId = String(identity.stackUserId || "").trim() || null;
  if (stackUserId) {
    const byStackUserId = await store.findAppUserByStackUserId(stackUserId);
    if (byStackUserId) {
      return sanitizeAppUserRecord(byStackUserId);
    }
  }
  const email = normalizeEmail(identity.email);
  if (email) {
    const byEmail = await store.findAppUserByEmail(email);
    if (byEmail) {
      return sanitizeAppUserRecord(byEmail);
    }
  }
  return null;
}

function createIdentityBindingError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

async function resolveStoredAppUserForStackPrincipal(store, principal = {}) {
  if (!isStoreReadyForAppUsers(store)) {
    return {
      appUser: null,
      shouldBindStackUserId: false,
    };
  }
  const stackUserId = String(principal.stackUserId || "").trim() || null;
  const email = normalizeEmail(principal.email);
  const byStackUserId =
    stackUserId ? sanitizeAppUserRecord(await store.findAppUserByStackUserId(stackUserId)) : null;
  const byEmail = email ? sanitizeAppUserRecord(await store.findAppUserByEmail(email)) : null;
  if (byStackUserId && byEmail && byStackUserId.id !== byEmail.id) {
    throw createIdentityBindingError(
      "Wave Control identity mismatch: the signed-in Stack user and email resolve to different Wave Control users. Resolve the account binding before signing in.",
    );
  }
  if (byStackUserId) {
    return {
      appUser: byStackUserId,
      shouldBindStackUserId: false,
    };
  }
  if (!byEmail) {
    return {
      appUser: null,
      shouldBindStackUserId: false,
    };
  }
  if (byEmail.stackUserId && byEmail.stackUserId !== stackUserId) {
    throw createIdentityBindingError(
      `Wave Control user ${byEmail.email || email || "unknown"} is already bound to a different Stack user. Contact a Wave Control superuser to resolve the account binding.`,
    );
  }
  return {
    appUser: byEmail,
    shouldBindStackUserId: !byEmail.stackUserId && Boolean(stackUserId),
  };
}

export function resolveAllowedPatScopesForAppUser(appUser) {
  const record = sanitizeAppUserRecord(appUser);
  if (!record || record.accessState !== "approved") {
    return [];
  }
  return normalizePersonalAccessTokenScopes([...BASE_PAT_SCOPES, "credential:read"]);
}

async function resolveStackAppUser(principal, config, store) {
  if (!principal || principal.type !== "stack-user" || !isStoreReadyForAppUsers(store)) {
    return null;
  }
  const { appUser: existing, shouldBindStackUserId } = await resolveStoredAppUserForStackPrincipal(
    store,
    principal,
  );
  if (!existing) {
    if (!isBootstrapSuperuser(config, principal.email)) {
      return null;
    }
    const created = createAppUserRecord({
      stackUserId: principal.stackUserId,
      email: principal.email,
      displayName: principal.displayName,
      role: "superuser",
      accessState: "approved",
      accessReviewedAt: new Date().toISOString(),
    });
    await store.createAppUser(created);
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: "app-user-bootstrap-superuser",
      subjectType: "app-user",
      subjectId: created.id,
      payload: {
        email: created.email,
        role: created.role,
        accessState: created.accessState,
      },
    });
    return created;
  }
  const next = mergeAppUserRecord(existing, {
    stackUserId: shouldBindStackUserId ? principal.stackUserId : existing.stackUserId,
    email: principal.email || existing.email,
    displayName: principal.displayName || existing.displayName,
  });
  if (
    next.stackUserId !== existing.stackUserId ||
    next.email !== existing.email ||
    next.displayName !== existing.displayName
  ) {
    await store.updateAppUser(existing.id, next);
    return next;
  }
  return existing;
}

async function resolvePatOwnerAppUser(store, tokenRecord) {
  if (!isStoreReadyForAppUsers(store)) {
    return {
      appUser: null,
      accessError: "Token owner lookup is unavailable.",
    };
  }
  const ownerStackUserId = String(tokenRecord?.ownerStackUserId || "").trim() || null;
  if (!ownerStackUserId) {
    return {
      appUser: null,
      accessError:
        "Token owner is not bound to a Stack user. Reissue this token after the user signs in to Wave Control.",
    };
  }
  const ownerAppUser = sanitizeAppUserRecord(await store.findAppUserByStackUserId(ownerStackUserId));
  if (!ownerAppUser) {
    return {
      appUser: null,
      accessError:
        "Token owner binding is no longer valid. Reissue this token for the current Wave Control user.",
    };
  }
  return {
    appUser: ownerAppUser,
    accessError:
      ownerAppUser.accessState === "approved" ? null : "Token owner no longer has Wave Control access.",
  };
}

function enrichStackPrincipal(principal, appUser) {
  const record = sanitizeAppUserRecord(appUser);
  const approved = record?.accessState === "approved";
  const providerGrants = normalizeProviderGrantList(record?.providerGrants || []);
  const role = record?.role || null;
  return {
    ...principal,
    appUserId: record?.id || null,
    appRole: role,
    role,
    accessState: record?.accessState || "none",
    providerGrants,
    isSuperuser: approved && role === "superuser",
    isAdmin: approved && role === "superuser",
    scopes: approved ? ["app:read", "credential:read"] : [],
    appUser: record,
  };
}

async function resolveBearerPrincipal(req, config, store) {
  const token = bearerTokenFromRequest(req);
  if (!token) {
    return null;
  }
  const serviceToken = (config.auth?.serviceTokens || []).find((entry) => entry.token === token);
  if (serviceToken) {
    return {
      type: "service-token",
      label: serviceToken.label,
      scopes: Array.isArray(serviceToken.scopes) ? serviceToken.scopes : [],
      accessState: null,
      providerGrants: [],
      isSuperuser: false,
      isAdmin: false,
    };
  }
  const staticTokens = config.auth.tokens || [];
  if (staticTokens.includes(token)) {
    return {
      type: "env-token",
      scopes: ["*"],
      tokenId: null,
      accessState: "approved",
      providerGrants: ["*"],
      isSuperuser: true,
      isAdmin: true,
    };
  }
  if (!store || typeof store.findPersonalAccessTokenByHash !== "function") {
    return null;
  }
  const record = await store.findPersonalAccessTokenByHash(hashPersonalAccessToken(token));
  if (!record || record.revokedAt) {
    return null;
  }
  const { appUser: ownerAppUser, accessError } = await resolvePatOwnerAppUser(store, record);
  const allowedScopes = resolveAllowedPatScopesForAppUser(ownerAppUser);
  const usedAt = new Date().toISOString();
  await store.touchPersonalAccessTokenLastUsed(record.id, usedAt);
  return {
    type: "pat",
    tokenId: record.id,
    stackUserId: record.ownerStackUserId || null,
    email: record.ownerEmail || null,
    label: record.label || null,
    accessState: ownerAppUser?.accessState || "none",
    providerGrants: normalizeProviderGrantList(ownerAppUser?.providerGrants || []),
    isSuperuser: ownerAppUser?.role === "superuser" && ownerAppUser?.accessState === "approved",
    isAdmin: ownerAppUser?.role === "superuser" && ownerAppUser?.accessState === "approved",
    scopes: normalizePersonalAccessTokenScopes(record.scopes).filter((scope) => allowedScopes.includes(scope)),
    appUser: ownerAppUser || null,
    accessError,
  };
}

export function principalHasProviderGrant(principal, providerId) {
  if (!principal) {
    return false;
  }
  if (principal.type === "env-token") {
    return true;
  }
  if (String(principal.accessState || "").trim().toLowerCase() !== "approved") {
    return false;
  }
  return normalizeProviderGrantList(principal.providerGrants).includes(
    String(providerId || "").trim().toLowerCase(),
  );
}

export function requireProviderGrant(principal, providerId) {
  if (principalHasProviderGrant(principal, providerId)) {
    return;
  }
  const error = new Error(`Access to provider ${providerId} is not granted for this principal.`);
  error.statusCode = 403;
  throw error;
}

export async function authenticateRequest(req, config, store, options = {}) {
  const requiredScopes = Array.isArray(options.requiredScopes) ? options.requiredScopes : [];
  const mode = options.mode || "read";
  if (mode === "read" && config.auth.requireAuthForReads === false && requiredScopes.length === 0) {
    return { type: "anonymous", scopes: [] };
  }
  const bearerPrincipal = await resolveBearerPrincipal(req, config, store);
  if (bearerPrincipal) {
    if (bearerPrincipal.type === "pat" && bearerPrincipal.accessState !== "approved") {
      const error = new Error(bearerPrincipal.accessError || "Token owner no longer has Wave Control access.");
      error.statusCode = 403;
      throw error;
    }
    if (
      !hasRequiredScopes(bearerPrincipal.scopes, requiredScopes, {
        allowWildcard: bearerPrincipal.type === "env-token",
      })
    ) {
      const error = new Error("Token is missing required scopes.");
      error.statusCode = 403;
      throw error;
    }
    return bearerPrincipal;
  }
  const stackPrincipal = await verifyStackUser(req, config);
  if (stackPrincipal) {
    const appUser = await resolveStackAppUser(stackPrincipal, config, store);
    const enrichedPrincipal = enrichStackPrincipal(stackPrincipal, appUser);
    if (!hasRequiredScopes(enrichedPrincipal.scopes, requiredScopes)) {
      const error = new Error("Authenticated Stack user is missing required application permissions.");
      error.statusCode = 403;
      throw error;
    }
    return enrichedPrincipal;
  }
  const error = new Error("Unauthorized");
  error.statusCode = 401;
  throw error;
}

export async function requireAuthorization(req, config, store, options = {}) {
  return authenticateRequest(req, config, store, options);
}
