import http from "node:http";
import { loadWaveControlServiceConfig } from "./config.mjs";
import {
  principalHasProviderGrant,
  requireAuthorization,
  requireProviderGrant,
  resolveAllowedPatScopesForAppUser,
} from "./auth.mjs";
import {
  APP_USER_ACCESS_STATES,
  APP_USER_ROLES,
  buildProviderCatalog,
  createAppUserRecord,
  createAuditEvent,
  getProviderDefinition,
  isEnvLeaseProvider,
  isProviderEnabled,
  listInvalidProviderGrants,
  mergeAppUserRecord,
  normalizeEmail,
  normalizeProviderGrantList,
  resolveManagedAppUserProviderGrants,
  sanitizeAppUserRecord,
} from "./app-users.mjs";
import {
  createPersonalAccessToken,
  listInvalidPersonalAccessTokenScopes,
  normalizePersonalAccessTokenScopes,
  sanitizePersonalAccessTokenRecord,
} from "./personal-access-tokens.mjs";
import {
  createEncryptedUserCredentialRecord,
  decryptUserCredentialValue,
  normalizeCredentialEnvVar,
  normalizeCredentialId,
  sanitizeUserCredentialMetadata,
} from "./user-credentials.mjs";
import { createWaveControlStore } from "./store.mjs";
import { renderWaveControlUi } from "./ui.mjs";

const CONTEXT7_SEARCH_URL = "https://context7.com/api/v2/libs/search";
const CONTEXT7_CONTEXT_URL = "https://context7.com/api/v2/context";
const CORRIDOR_BASE_URL = "https://app.corridor.dev/api";
const CORRIDOR_SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
const DEFAULT_APP_TOKEN_SCOPES = ["broker:read", "ingest:write"];

async function appendAuditEvent(store, payload) {
  if (!store || typeof store.appendAuditEvent !== "function") {
    return null;
  }
  return store.appendAuditEvent(createAuditEvent(payload));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function setCorsHeaders(req, res, config) {
  const origin = String(req.headers.origin || "").trim();
  const allowedOrigins = new Set(config.cors?.allowedOrigins || []);
  if (origin && (allowedOrigins.has(origin) || allowedOrigins.has("*"))) {
    res.setHeader("access-control-allow-origin", allowedOrigins.has("*") ? "*" : origin);
    res.setHeader("access-control-allow-headers", "authorization, content-type, x-stack-access-token");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("vary", "Origin");
  }
}

async function readResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseJsonOrEmpty(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function requireBrokerEnabled(config, provider) {
  if (!config?.broker?.ownedDeployment) {
    const error = new Error("Provider broker routes are only available on owned Wave Control deployments.");
    error.statusCode = 403;
    throw error;
  }
  if (provider === "context7" && (!config.broker.context7Enabled || !config.broker.context7ApiKey)) {
    const error = new Error("Context7 broker is not configured on this Wave Control deployment.");
    error.statusCode = 403;
    throw error;
  }
  if (provider === "corridor" && (!config.broker.corridorEnabled || !config.broker.corridorApiToken)) {
    const error = new Error("Corridor broker is not configured on this Wave Control deployment.");
    error.statusCode = 403;
    throw error;
  }
}

function isRetryableBrokerStatus(statusCode) {
  return [408, 429, 500, 502, 503, 504].includes(Number(statusCode || 0));
}

async function fetchBrokerResponse(url, token, config, { accept = "application/json", method = "GET" } = {}) {
  const attempts = Math.max(1, Number(config.broker?.maxRetries || 0) + 1);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept,
        },
        signal: AbortSignal.timeout(Math.max(1000, Number(config.broker?.requestTimeoutMs || 10000))),
      });
      if (response.ok) {
        return response;
      }
      const text = await response.text();
      const payload = parseJsonOrEmpty(text);
      const error = new Error(
        `Broker upstream request failed (${response.status}): ${payload?.error || payload?.message || text.slice(0, 240) || response.statusText || "unknown error"}`,
      );
      error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
      error.retryable = isRetryableBrokerStatus(response.status);
      error.isBrokerUpstreamError = true;
      throw error;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || error?.retryable === false) {
        throw error;
      }
    }
  }
  throw lastError || new Error("Broker upstream request failed.");
}

async function fetchBrokerJson(url, token, config) {
  const response = await fetchBrokerResponse(url, token, config, { accept: "application/json" });
  return response.json();
}

async function fetchBrokerText(url, token, config) {
  const response = await fetchBrokerResponse(url, token, config, {
    accept: "text/plain, application/json",
  });
  return response.text();
}

function normalizeOwnedPath(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

function isCorridorRelevantOwnedPath(value) {
  const normalized = normalizeOwnedPath(value);
  if (!normalized || normalized.startsWith(".tmp/")) {
    return false;
  }
  if (normalized.startsWith("docs/")) {
    return false;
  }
  return !/\.(?:md|txt)$/i.test(normalized);
}

function findingMatchesOwnedPath(findingPath, ownedPath) {
  const normalizedFinding = normalizeOwnedPath(findingPath);
  const normalizedOwned = normalizeOwnedPath(ownedPath);
  if (!normalizedFinding || !normalizedOwned) {
    return false;
  }
  return normalizedFinding === normalizedOwned || normalizedFinding.startsWith(`${normalizedOwned}/`);
}

function summarizeCorridorContext({ findings, guardrails, ownedPaths, severityThreshold, project }) {
  const relevantOwnedPaths = (Array.isArray(ownedPaths) ? ownedPaths : []).filter(isCorridorRelevantOwnedPath);
  const thresholdRank = CORRIDOR_SEVERITY_RANK[String(severityThreshold || "critical").toLowerCase()] || 4;
  const matchedFindings = (Array.isArray(findings) ? findings : [])
    .map((finding) => {
      const matches = relevantOwnedPaths.filter((ownedPath) =>
        findingMatchesOwnedPath(finding.affectedFile, ownedPath),
      );
      return matches.length > 0 ? { ...finding, matchedOwnedPaths: matches } : null;
    })
    .filter(Boolean);
  const blockingFindings = matchedFindings.filter((finding) => {
    const rank = CORRIDOR_SEVERITY_RANK[String(finding.severity || "").toLowerCase()] || 0;
    return rank >= thresholdRank;
  });
  return {
    ok: true,
    error: null,
    schemaVersion: 1,
    source: "broker",
    fetchedAt: new Date().toISOString(),
    project,
    relevantOwnedPaths,
    severityThreshold,
    guardrails: Array.isArray(guardrails?.reports) ? guardrails.reports : [],
    matchedFindings,
    blockingFindings,
    blocking: blockingFindings.length > 0,
  };
}

function parseAppUserRoleInput(value, { fieldName = "role", defaultValue = null } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (defaultValue !== null) {
      return defaultValue;
    }
    const error = new Error(`${fieldName} is required.`);
    error.statusCode = 400;
    throw error;
  }
  const normalized = raw.toLowerCase();
  if (!APP_USER_ROLES.includes(normalized)) {
    const error = new Error(
      `${fieldName} must be one of: ${APP_USER_ROLES.join(", ")}.`,
    );
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function parseAppUserAccessStateInput(value, { fieldName = "accessState", defaultValue = null } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (defaultValue !== null) {
      return defaultValue;
    }
    const error = new Error(`${fieldName} is required.`);
    error.statusCode = 400;
    throw error;
  }
  const normalized = raw.toLowerCase();
  if (!APP_USER_ACCESS_STATES.includes(normalized)) {
    const error = new Error(
      `${fieldName} must be one of: ${APP_USER_ACCESS_STATES.join(", ")}.`,
    );
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function normalizeCorridorFindingStates(findingStates) {
  return Array.from(
    new Set(
      (Array.isArray(findingStates) ? findingStates : [])
        .map((state) => String(state || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) {
    return {};
  }
  return JSON.parse(body);
}

function buildAppOverview(analytics, runs, benchmarks) {
  return {
    overview: analytics,
    recentRuns: runs.slice(0, 10),
    recentBenchmarks: benchmarks.slice(0, 10),
  };
}

function requireStackPrincipal(principal) {
  if (!principal || principal.type !== "stack-user") {
    const error = new Error("This route requires a Stack-authenticated internal user.");
    error.statusCode = 403;
    throw error;
  }
}

function requireApprovedAppUser(principal) {
  requireStackPrincipal(principal);
  if (principal.accessState !== "approved") {
    const error = new Error("This route requires an approved Wave Control user.");
    error.statusCode = 403;
    throw error;
  }
}

function requireAppSuperuser(principal) {
  requireApprovedAppUser(principal);
  if (!principal.isSuperuser) {
    const error = new Error("This route requires a Wave Control superuser.");
    error.statusCode = 403;
    throw error;
  }
}

function requireServiceToken(principal) {
  if (!principal || principal.type !== "service-token") {
    const error = new Error("This route requires a Wave Control service token.");
    error.statusCode = 403;
    throw error;
  }
}

function actorFieldsForPrincipal(principal) {
  if (principal?.type === "service-token") {
    const label = String(principal.label || "").trim() || "service-token";
    return {
      actorType: "service-token",
      actorId: label,
      actorStackUserId: null,
      actorEmail: `service-token:${label}`,
    };
  }
  return {
    actorType: principal?.type || "unknown",
    actorId:
      String(
        principal?.stackUserId ||
          principal?.email ||
          principal?.tokenId ||
          principal?.label ||
          "",
      ).trim() || null,
    actorStackUserId: String(principal?.stackUserId || "").trim() || null,
    actorEmail: normalizeEmail(principal?.email || "") || null,
  };
}

function validateRuntimeCredentialLeases(credentials) {
  if (!Array.isArray(credentials) || credentials.length === 0) {
    const error = new Error("credentials must be a non-empty array.");
    error.statusCode = 400;
    throw error;
  }
  const normalized = [];
  const seenEnvVars = new Set();
  for (const [index, entry] of credentials.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      const error = new Error(`credentials[${index}] must be an object with id and envVar.`);
      error.statusCode = 400;
      throw error;
    }
    const credentialId = normalizeCredentialId(entry.id);
    const envVar = normalizeCredentialEnvVar(entry.envVar);
    if (seenEnvVars.has(envVar)) {
      const error = new Error(`credentials contains duplicate envVar mappings for ${envVar}.`);
      error.statusCode = 400;
      throw error;
    }
    seenEnvVars.add(envVar);
    normalized.push({
      id: credentialId,
      envVar,
    });
  }
  return normalized;
}

function validateProviderGrants(providerGrants) {
  if (providerGrants !== undefined && providerGrants !== null && !Array.isArray(providerGrants)) {
    const error = new Error("Provider grants must be an array of provider ids.");
    error.statusCode = 400;
    throw error;
  }
  const invalidProviderGrants = listInvalidProviderGrants(providerGrants || []);
  if (invalidProviderGrants.length > 0) {
    const error = new Error(
      `Unsupported provider grants: ${invalidProviderGrants.join(", ")}.`,
    );
    error.statusCode = 400;
    throw error;
  }
  return normalizeProviderGrantList(providerGrants || []);
}

function defaultTokenScopes(scopes, ownerAppUser) {
  if (scopes !== undefined && scopes !== null && !Array.isArray(scopes)) {
    const error = new Error("Token scopes must be an array of strings.");
    error.statusCode = 400;
    throw error;
  }
  const allowedScopes = resolveAllowedPatScopesForAppUser(ownerAppUser);
  if (allowedScopes.length === 0) {
    const error = new Error("The token owner is not approved for PAT issuance.");
    error.statusCode = 403;
    throw error;
  }
  const requestedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : allowedScopes;
  const invalidScopes = listInvalidPersonalAccessTokenScopes(requestedScopes);
  if (invalidScopes.length > 0) {
    const error = new Error(
      `Unsupported token scopes: ${invalidScopes.join(", ")}. Allowed scopes: ${normalizePersonalAccessTokenScopes([...allowedScopes, ...DEFAULT_APP_TOKEN_SCOPES]).join(", ")}.`,
    );
    error.statusCode = 400;
    throw error;
  }
  const normalized = normalizePersonalAccessTokenScopes(requestedScopes);
  const disallowedScopes = normalized.filter((scope) => !allowedScopes.includes(scope));
  if (disallowedScopes.length > 0) {
    const error = new Error(`Requested token scopes exceed the owner's current permissions: ${disallowedScopes.join(", ")}.`);
    error.statusCode = 403;
    throw error;
  }
  return normalized.length > 0 ? normalized : [...allowedScopes];
}

function buildSessionPayload(principal, config) {
  requireStackPrincipal(principal);
  return {
    ok: true,
    session: {
      stackUserId: principal.stackUserId,
      email: principal.email,
      displayName: principal.displayName,
      teamIds: principal.teamIds,
      accessState: principal.accessState || "none",
      role: principal.appRole || null,
      isSuperuser: principal.isSuperuser === true,
      isAdmin: principal.isSuperuser === true,
      providerGrants: normalizeProviderGrantList(principal.providerGrants || []),
      accessRequestReason: principal.appUser?.accessRequestReason || null,
      accessRequestedAt: principal.appUser?.accessRequestedAt || null,
      accessReviewedAt: principal.appUser?.accessReviewedAt || null,
      accessReviewedByStackUserId: principal.appUser?.accessReviewedByStackUserId || null,
    },
    providerCatalog: buildProviderCatalog(config),
  };
}

async function requireAppUserById(store, userId) {
  if (!store || typeof store.findAppUserById !== "function") {
    const error = new Error("Wave Control app-user storage is unavailable.");
    error.statusCode = 500;
    throw error;
  }
  const appUser = sanitizeAppUserRecord(await store.findAppUserById(userId));
  if (!appUser) {
    const error = new Error("Wave Control user not found.");
    error.statusCode = 404;
    throw error;
  }
  return appUser;
}

function requireUserCredentialStore(store) {
  if (
    !store ||
    typeof store.listUserCredentials !== "function" ||
    typeof store.findUserCredential !== "function" ||
    typeof store.upsertUserCredential !== "function" ||
    typeof store.deleteUserCredential !== "function"
  ) {
    const error = new Error("Wave Control credential storage is unavailable.");
    error.statusCode = 500;
    throw error;
  }
}

function resolveProviderCatalogPayload(config) {
  return buildProviderCatalog(config);
}

async function resolveTokenOwnerAppUser(store, principal, body = {}) {
  const targetEmail = normalizeEmail(body.ownerEmail || "");
  const targetStackUserId = String(body.ownerStackUserId || "").trim() || null;
  if (principal.isSuperuser && (targetEmail || targetStackUserId)) {
    const byEmail =
      targetEmail && typeof store.findAppUserByEmail === "function"
        ? sanitizeAppUserRecord(await store.findAppUserByEmail(targetEmail))
        : null;
    const byStackUserId =
      targetStackUserId && typeof store.findAppUserByStackUserId === "function"
        ? sanitizeAppUserRecord(await store.findAppUserByStackUserId(targetStackUserId))
        : null;
    if (targetEmail && targetStackUserId) {
      if (!byEmail || !byStackUserId) {
        const error = new Error("Requested token owner was not found.");
        error.statusCode = 404;
        throw error;
      }
      if (byEmail.id !== byStackUserId.id) {
        const error = new Error("ownerEmail and ownerStackUserId must refer to the same Wave Control user.");
        error.statusCode = 400;
        throw error;
      }
      return byEmail;
    }
    if (byEmail || byStackUserId) {
      return byEmail || byStackUserId;
    }
    const error = new Error("Requested token owner was not found.");
    error.statusCode = 404;
    throw error;
  }
  return sanitizeAppUserRecord(principal.appUser);
}

function requireBoundPatOwnerAppUser(appUser) {
  const ownerAppUser = sanitizeAppUserRecord(appUser);
  if (!ownerAppUser || ownerAppUser.accessState !== "approved") {
    const error = new Error("Tokens can only be issued for approved Wave Control users.");
    error.statusCode = 403;
    throw error;
  }
  if (!ownerAppUser.stackUserId) {
    const error = new Error(
      "Tokens can only be issued for users with a bound Stack account. Have the user sign in to Wave Control first.",
    );
    error.statusCode = 409;
    throw error;
  }
  return ownerAppUser;
}

function buildManagedUserProviderGrants(existing, role, body = {}) {
  const explicitProviderGrants =
    body.providerGrants !== undefined ? validateProviderGrants(body.providerGrants) : undefined;
  return resolveManagedAppUserProviderGrants(existing, role, explicitProviderGrants);
}

function buildManagedUserUpsertRecord(existing, body, principal) {
  const email = normalizeEmail(body.email || "");
  if (!email) {
    const error = new Error("email is required.");
    error.statusCode = 400;
    throw error;
  }
  const role = parseAppUserRoleInput(body.role, { defaultValue: "member" });
  const accessState = parseAppUserAccessStateInput(body.accessState, { defaultValue: "approved" });
  const providerGrants = buildManagedUserProviderGrants(existing, role, body);
  const timestamp = new Date().toISOString();
  return {
    email,
    next:
      existing
        ? mergeAppUserRecord(existing, {
            email,
            displayName: String(body.displayName || "").trim() || existing.displayName,
            role,
            accessState,
            providerGrants,
            accessReviewedAt:
              accessState === "approved" || accessState === "rejected" || accessState === "revoked"
                ? timestamp
                : existing.accessReviewedAt,
            accessReviewedByStackUserId:
              accessState === "approved" || accessState === "rejected" || accessState === "revoked"
                ? actorFieldsForPrincipal(principal).actorStackUserId
                : existing.accessReviewedByStackUserId,
          })
        : createAppUserRecord({
            email,
            displayName: String(body.displayName || "").trim() || null,
            role,
            accessState,
            providerGrants,
            accessReviewedAt:
              accessState === "approved" || accessState === "rejected" || accessState === "revoked"
                ? timestamp
                : null,
            accessReviewedByStackUserId:
              accessState === "approved" || accessState === "rejected" || accessState === "revoked"
                ? actorFieldsForPrincipal(principal).actorStackUserId
                : null,
          }),
  };
}

async function listCredentialMetadata(store, appUserId) {
  requireUserCredentialStore(store);
  return (await store.listUserCredentials(appUserId)).map((record) =>
    sanitizeUserCredentialMetadata(record),
  );
}

async function upsertManagedUserCredential(store, config, appUser, credentialId, value, principal) {
  requireUserCredentialStore(store);
  const actor = actorFieldsForPrincipal(principal);
  const existing = await store.findUserCredential(appUser.id, normalizeCredentialId(credentialId));
  const record = createEncryptedUserCredentialRecord(config, {
    appUserId: appUser.id,
    credentialId,
    plaintextValue: value,
    actorType: actor.actorType,
    actorId: actor.actorId,
    existingRecord: existing,
  });
  return store.upsertUserCredential(record);
}

async function deleteManagedUserCredential(store, appUserId, credentialId) {
  requireUserCredentialStore(store);
  return store.deleteUserCredential(appUserId, normalizeCredentialId(credentialId));
}

function resolveLeasePrincipalAppUser(principal) {
  if (principal?.type === "service-token" || principal?.type === "env-token") {
    const error = new Error("This route requires an approved Wave Control user or a user-owned PAT.");
    error.statusCode = 403;
    throw error;
  }
  if (principal?.type === "stack-user") {
    requireApprovedAppUser(principal);
    if (!principal.appUserId) {
      const error = new Error("Authenticated Wave Control user is missing app-user state.");
      error.statusCode = 403;
      throw error;
    }
    return {
      appUserId: principal.appUserId,
      appUser: sanitizeAppUserRecord(principal.appUser),
    };
  }
  if (principal?.type === "pat") {
    if (principal.accessState !== "approved" || !principal.appUser?.id) {
      const error = new Error("Token owner no longer has Wave Control access.");
      error.statusCode = 403;
      throw error;
    }
    return {
      appUserId: principal.appUser.id,
      appUser: sanitizeAppUserRecord(principal.appUser),
    };
  }
  const error = new Error("This route requires an approved Wave Control user or a user-owned PAT.");
  error.statusCode = 403;
  throw error;
}

async function buildCredentialLeaseEnv(store, config, appUserId, credentials) {
  requireUserCredentialStore(store);
  const env = {};
  const items = [];
  for (const lease of credentials) {
    const record = await store.findUserCredential(appUserId, lease.id);
    if (!record) {
      const error = new Error(`Credential ${lease.id} is not configured for this user.`);
      error.statusCode = 404;
      throw error;
    }
    env[lease.envVar] = decryptUserCredentialValue(config, record);
    items.push({
      id: lease.id,
      envVar: lease.envVar,
    });
  }
  return {
    env,
    credentials: items,
  };
}

function resolveProviderLease(config, providerId) {
  const definition = getProviderDefinition(providerId);
  if (!definition) {
    const error = new Error(`Unknown credential provider: ${providerId}`);
    error.statusCode = 400;
    throw error;
  }
  if (!isEnvLeaseProvider(providerId)) {
    const error = new Error(`Provider ${providerId} is broker-only and cannot be leased into executor environments.`);
    error.statusCode = 400;
    throw error;
  }
  if (!isProviderEnabled(config, providerId)) {
    const error = new Error(`Provider ${providerId} is not enabled on this Wave Control deployment.`);
    error.statusCode = 403;
    throw error;
  }
  if (providerId === "openai") {
    return { OPENAI_API_KEY: config.broker.openaiApiKey };
  }
  if (providerId === "anthropic") {
    return { ANTHROPIC_API_KEY: config.broker.anthropicApiKey };
  }
  const error = new Error(`Provider ${providerId} does not expose runtime environment credentials.`);
  error.statusCode = 400;
  throw error;
}

async function listCorridorFindings(config, projectId, token, findingStates) {
  const findings = [];
  const seenPages = new Set();
  const states = Array.isArray(findingStates) && findingStates.length > 0 ? findingStates : [null];
  for (const state of states) {
    let page = 1;
    let nextUrl = new URL(`${CORRIDOR_BASE_URL}/projects/${projectId}/findings`);
    if (state) {
      nextUrl.searchParams.set("state", String(state));
    }
    while (nextUrl && page <= Math.max(1, Number(config.broker?.maxPages || 10))) {
      const dedupeKey = nextUrl.toString();
      if (seenPages.has(dedupeKey)) {
        break;
      }
      seenPages.add(dedupeKey);
      const payload = await fetchBrokerJson(nextUrl, token, config);
      if (Array.isArray(payload)) {
        findings.push(...payload);
        break;
      }
      const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.findings)
          ? payload.findings
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      findings.push(...items);
      if (payload?.nextPageUrl) {
        nextUrl = new URL(payload.nextPageUrl);
      } else if (payload?.nextCursor) {
        nextUrl = new URL(`${CORRIDOR_BASE_URL}/projects/${projectId}/findings`);
        if (state) {
          nextUrl.searchParams.set("state", String(state));
        }
        nextUrl.searchParams.set("cursor", String(payload.nextCursor));
      } else if (payload?.page && payload?.totalPages && Number(payload.page) < Number(payload.totalPages)) {
        nextUrl = new URL(`${CORRIDOR_BASE_URL}/projects/${projectId}/findings`);
        if (state) {
          nextUrl.searchParams.set("state", String(state));
        }
        nextUrl.searchParams.set("page", String(Number(payload.page) + 1));
      } else {
        nextUrl = null;
      }
      page += 1;
    }
  }
  return findings;
}

function queryFilters(url) {
  return {
    workspaceId: url.searchParams.get("workspaceId") || undefined,
    projectId: url.searchParams.get("projectId") || undefined,
    runKind: url.searchParams.get("runKind") || undefined,
    runId: url.searchParams.get("runId") || undefined,
    lane: url.searchParams.get("lane") || undefined,
    wave:
      url.searchParams.get("wave") === null ? undefined : Number(url.searchParams.get("wave")),
    orchestratorId: url.searchParams.get("orchestratorId") || undefined,
    runtimeVersion: url.searchParams.get("runtimeVersion") || undefined,
    benchmarkRunId: url.searchParams.get("benchmarkRunId") || undefined,
  };
}

function validateBatch(config, batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    const error = new Error("Batch body must be an object");
    error.statusCode = 400;
    throw error;
  }
  const events = Array.isArray(batch.events) ? batch.events : null;
  if (!events) {
    const error = new Error("Batch body must include an events array");
    error.statusCode = 400;
    throw error;
  }
  if (events.length > config.ingest.maxBatchEvents) {
    const error = new Error(`Batch exceeds max events (${config.ingest.maxBatchEvents})`);
    error.statusCode = 400;
    throw error;
  }
  for (const event of events) {
    for (const upload of event.artifactUploads || []) {
      const bytes = Buffer.byteLength(String(upload.content || ""), "utf8");
      if (bytes > config.ingest.maxInlineArtifactBytes * 1.4) {
        const error = new Error(
          `Inline artifact exceeds limit (${config.ingest.maxInlineArtifactBytes} bytes)`,
        );
        error.statusCode = 400;
        throw error;
      }
    }
  }
}

async function handleApiRequest(req, res, url, context) {
  const { config, store } = context;

  if (req.method === "GET" && url.pathname === "/api/v1/health") {
    sendJson(res, 200, {
      ok: true,
      service: "wave-control",
      store: store.constructor.name,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/ingest/batches") {
    await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["ingest:write"],
    });
    const batch = await readJsonBody(req);
    validateBatch(config, batch);
    const result = await store.ingestBatch(batch);
    sendJson(res, 200, {
      ok: true,
      ...result,
      received: batch.events.length,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/runs") {
    await requireAuthorization(req, config, store, { mode: "read" });
    sendJson(res, 200, await store.listRuns(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/run") {
    await requireAuthorization(req, config, store, { mode: "read" });
    const payload = await store.getRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/benchmarks") {
    await requireAuthorization(req, config, store, { mode: "read" });
    sendJson(res, 200, await store.listBenchmarkRuns(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/benchmark") {
    await requireAuthorization(req, config, store, { mode: "read" });
    const payload = await store.getBenchmarkRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Benchmark run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/analytics/overview") {
    await requireAuthorization(req, config, store, { mode: "read" });
    sendJson(res, 200, await store.getAnalytics(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/artifact") {
    await requireAuthorization(req, config, store, { mode: "read" });
    const eventId = url.searchParams.get("eventId") || "";
    const artifactId = url.searchParams.get("artifactId") || "";
    const inline = url.searchParams.get("inline") === "1";
    if (!eventId || !artifactId) {
      sendJson(res, 400, { error: "eventId and artifactId are required" });
      return;
    }
    const artifact = await store.getArtifact({ eventId, artifactId, inline });
    if (!artifact) {
      sendJson(res, 404, { error: "Artifact not found" });
      return;
    }
    if (url.searchParams.get("download") === "1" && artifact.downloadUrl) {
      res.writeHead(302, { location: artifact.downloadUrl });
      res.end();
      return;
    }
    sendJson(res, 200, artifact);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/artifacts/signed-upload") {
    await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["ingest:write"],
    });
    if (!store.storage || typeof store.storage.getUploadUrl !== "function") {
      sendJson(res, 501, { error: "Bucket storage is not configured" });
      return;
    }
    const body = await readJsonBody(req);
    const workspaceId = body.workspaceId || "workspace";
    const eventId = body.eventId || "event";
    const artifactId = body.artifactId || "artifact";
    const contentType = body.contentType || "application/octet-stream";
    const key = [workspaceId, eventId, artifactId].map((entry) => String(entry || "").trim()).filter(Boolean).join("/");
    const uploadUrl = await store.storage.getUploadUrl(key, contentType);
    sendJson(res, 200, {
      ok: true,
      key,
      uploadUrl,
      contentType,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/providers/context7/search") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["broker:read"],
    });
    requireBrokerEnabled(config, "context7");
    requireProviderGrant(principal, "context7");
    const proxyUrl = new URL(CONTEXT7_SEARCH_URL);
    url.searchParams.forEach((value, key) => proxyUrl.searchParams.set(key, value));
    sendJson(res, 200, await fetchBrokerJson(proxyUrl, config.broker.context7ApiKey, config));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/providers/context7/context") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["broker:read"],
    });
    requireBrokerEnabled(config, "context7");
    requireProviderGrant(principal, "context7");
    const proxyUrl = new URL(CONTEXT7_CONTEXT_URL);
    url.searchParams.forEach((value, key) => proxyUrl.searchParams.set(key, value));
    sendText(res, 200, await fetchBrokerText(proxyUrl, config.broker.context7ApiKey, config));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/providers/corridor/context") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["broker:read"],
    });
    requireBrokerEnabled(config, "corridor");
    requireProviderGrant(principal, "corridor");
    const body = await readJsonBody(req);
    const waveProjectId = String(body.projectId || "").trim();
    const mapping = config.broker.corridorProjectMap?.[waveProjectId];
    if (!mapping?.projectId) {
      sendJson(res, 404, { error: `No Corridor project mapping found for Wave project ${waveProjectId || "unknown"}.` });
      return;
    }
    const findingStates = normalizeCorridorFindingStates(
      Array.isArray(body.findingStates) ? body.findingStates : ["open", "potential"],
    );
    const findings = await listCorridorFindings(
      config,
      mapping.projectId,
      config.broker.corridorApiToken,
      findingStates,
    );
    const guardrails = await fetchBrokerJson(
      `${CORRIDOR_BASE_URL}/projects/${mapping.projectId}/reports`,
      config.broker.corridorApiToken,
      config,
    );
    sendJson(
      res,
      200,
      summarizeCorridorContext({
        findings,
        guardrails,
        ownedPaths: body.ownedPaths,
        severityThreshold: body.severityThreshold,
        project: {
          waveProjectId,
          corridorProjectId: mapping.projectId,
          teamId: mapping.teamId || null,
        },
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/runtime/provider-env") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["credential:read"],
    });
    const body = await readJsonBody(req);
    if (!Array.isArray(body.providers) || body.providers.length === 0) {
      sendJson(res, 400, { error: "providers must be a non-empty array." });
      return;
    }
    const providers = normalizeProviderGrantList(body.providers);
    if (providers.length !== body.providers.length) {
      sendJson(res, 400, { error: "providers contains unknown provider ids." });
      return;
    }
    const env = {};
    for (const providerId of providers) {
      if (!principalHasProviderGrant(principal, providerId)) {
        sendJson(res, 403, { error: `Access to provider ${providerId} is not granted for this principal.` });
        return;
      }
      Object.assign(env, resolveProviderLease(config, providerId));
    }
    sendJson(res, 200, {
      ok: true,
      providers,
      env,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/runtime/credential-env") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["credential:read"],
    });
    const leasePrincipal = resolveLeasePrincipalAppUser(principal);
    const body = await readJsonBody(req);
    const credentials = validateRuntimeCredentialLeases(body.credentials);
    const leased = await buildCredentialLeaseEnv(store, config, leasePrincipal.appUserId, credentials);
    sendJson(res, 200, {
      ok: true,
      credentials: leased.credentials,
      env: leased.env,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/service/session") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["service:read"],
    });
    requireServiceToken(principal);
    sendJson(res, 200, {
      ok: true,
      serviceToken: {
        label: principal.label || null,
        scopes: Array.isArray(principal.scopes) ? principal.scopes : [],
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/service/users") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["service:read"],
    });
    requireServiceToken(principal);
    sendJson(res, 200, {
      items: (await store.listAppUsers()).map((record) => sanitizeAppUserRecord(record)),
      providerCatalog: resolveProviderCatalogPayload(config),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/service/users") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["service:user:write"],
    });
    requireServiceToken(principal);
    const body = await readJsonBody(req);
    const existing = sanitizeAppUserRecord(await store.findAppUserByEmail(normalizeEmail(body.email || "")));
    const { next } = buildManagedUserUpsertRecord(existing, body, principal);
    if (existing) {
      await store.updateAppUser(existing.id, next);
    } else {
      await store.createAppUser(next);
    }
    const actor = actorFieldsForPrincipal(principal);
    await appendAuditEvent(store, {
      actorStackUserId: actor.actorStackUserId,
      actorEmail: actor.actorEmail,
      eventType: existing ? "app-user-updated" : "app-user-created",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        email: next.email,
        role: next.role,
        accessState: next.accessState,
        providerGrants: next.providerGrants,
      },
    });
    sendJson(res, existing ? 200 : 201, {
      ok: true,
      user: sanitizeAppUserRecord(next),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/service\/users\/[^/]+\/state$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["service:user:write"],
    });
    requireServiceToken(principal);
    const userId = url.pathname.split("/")[5] || "";
    const body = await readJsonBody(req);
    const accessState = parseAppUserAccessStateInput(body.accessState);
    const existing = await requireAppUserById(store, userId);
    const actor = actorFieldsForPrincipal(principal);
    const next = mergeAppUserRecord(existing, {
      accessState,
      accessReviewedAt: new Date().toISOString(),
      accessReviewedByStackUserId: actor.actorStackUserId,
    });
    await store.updateAppUser(existing.id, next);
    await appendAuditEvent(store, {
      actorStackUserId: actor.actorStackUserId,
      actorEmail: actor.actorEmail,
      eventType: "app-user-state-updated",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        accessState: next.accessState,
      },
    });
    sendJson(res, 200, {
      ok: true,
      user: sanitizeAppUserRecord(next),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/service\/users\/[^/]+\/role$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["service:user:write"],
    });
    requireServiceToken(principal);
    const userId = url.pathname.split("/")[5] || "";
    const body = await readJsonBody(req);
    const role = parseAppUserRoleInput(body.role);
    const existing = await requireAppUserById(store, userId);
    const actor = actorFieldsForPrincipal(principal);
    const next = mergeAppUserRecord(existing, {
      role,
      providerGrants: buildManagedUserProviderGrants(existing, role),
    });
    await store.updateAppUser(existing.id, next);
    await appendAuditEvent(store, {
      actorStackUserId: actor.actorStackUserId,
      actorEmail: actor.actorEmail,
      eventType: "app-user-role-updated",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        role: next.role,
      },
    });
    sendJson(res, 200, {
      ok: true,
      user: sanitizeAppUserRecord(next),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/service\/users\/[^/]+\/providers$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["service:user:write"],
    });
    requireServiceToken(principal);
    const userId = url.pathname.split("/")[5] || "";
    const body = await readJsonBody(req);
    const providerGrants = validateProviderGrants(body.providerGrants || []);
    const existing = await requireAppUserById(store, userId);
    const actor = actorFieldsForPrincipal(principal);
    const next = mergeAppUserRecord(existing, {
      providerGrants,
    });
    await store.updateAppUser(existing.id, next);
    await appendAuditEvent(store, {
      actorStackUserId: actor.actorStackUserId,
      actorEmail: actor.actorEmail,
      eventType: "app-user-provider-grants-updated",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        providerGrants: next.providerGrants,
      },
    });
    sendJson(res, 200, {
      ok: true,
      user: sanitizeAppUserRecord(next),
    });
    return;
  }

  if (req.method === "GET" && /^\/api\/v1\/service\/users\/[^/]+\/credentials$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["service:read"],
    });
    requireServiceToken(principal);
    const userId = url.pathname.split("/")[5] || "";
    const appUser = await requireAppUserById(store, userId);
    sendJson(res, 200, {
      items: await listCredentialMetadata(store, appUser.id),
    });
    return;
  }

  if (req.method === "PUT" && /^\/api\/v1\/service\/users\/[^/]+\/credentials\/[^/]+$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["service:credential:write"],
    });
    requireServiceToken(principal);
    const userId = url.pathname.split("/")[5] || "";
    const credentialId = url.pathname.split("/")[7] || "";
    const appUser = await requireAppUserById(store, userId);
    const body = await readJsonBody(req);
    const saved = await upsertManagedUserCredential(store, config, appUser, credentialId, body.value, principal);
    const actor = actorFieldsForPrincipal(principal);
    await appendAuditEvent(store, {
      actorStackUserId: actor.actorStackUserId,
      actorEmail: actor.actorEmail,
      eventType: "user-credential-upserted",
      subjectType: "user-credential",
      subjectId: `${appUser.id}:${saved.credentialId}`,
      payload: {
        appUserId: appUser.id,
        credentialId: saved.credentialId,
      },
    });
    sendJson(res, 200, {
      ok: true,
      credential: sanitizeUserCredentialMetadata(saved),
    });
    return;
  }

  if (req.method === "DELETE" && /^\/api\/v1\/service\/users\/[^/]+\/credentials\/[^/]+$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["service:credential:write"],
    });
    requireServiceToken(principal);
    const userId = url.pathname.split("/")[5] || "";
    const credentialId = url.pathname.split("/")[7] || "";
    const appUser = await requireAppUserById(store, userId);
    const deleted = await deleteManagedUserCredential(store, appUser.id, credentialId);
    if (!deleted) {
      sendJson(res, 404, { error: "Credential not found." });
      return;
    }
    const actor = actorFieldsForPrincipal(principal);
    await appendAuditEvent(store, {
      actorStackUserId: actor.actorStackUserId,
      actorEmail: actor.actorEmail,
      eventType: "user-credential-deleted",
      subjectType: "user-credential",
      subjectId: `${appUser.id}:${deleted.credentialId}`,
      payload: {
        appUserId: appUser.id,
        credentialId: deleted.credentialId,
      },
    });
    sendJson(res, 200, {
      ok: true,
      credential: sanitizeUserCredentialMetadata(deleted),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/service\/users\/[^/]+\/tokens$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["service:token:write"],
    });
    requireServiceToken(principal);
    const userId = url.pathname.split("/")[5] || "";
    const appUser = requireBoundPatOwnerAppUser(await requireAppUserById(store, userId));
    const body = await readJsonBody(req);
    const generated = createPersonalAccessToken(body.label, defaultTokenScopes(body.scopes, appUser), {
      stackUserId: appUser.stackUserId,
      email: appUser.email || null,
      createdByStackUserId: null,
    });
    await store.createPersonalAccessToken({
      ...generated.record,
      tokenHash: generated.tokenHash,
    });
    const actor = actorFieldsForPrincipal(principal);
    await appendAuditEvent(store, {
      actorStackUserId: actor.actorStackUserId,
      actorEmail: actor.actorEmail,
      eventType: "pat-created",
      subjectType: "pat",
      subjectId: generated.record.id,
      payload: {
        ownerEmail: generated.record.ownerEmail,
        ownerStackUserId: generated.record.ownerStackUserId,
        scopes: generated.record.scopes,
      },
    });
    sendJson(res, 201, {
      ok: true,
      token: generated.token,
      record: sanitizePersonalAccessTokenRecord(generated.record),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/service\/tokens\/[^/]+\/revoke$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["service:token:write"],
    });
    requireServiceToken(principal);
    const tokenId = url.pathname.split("/")[5] || "";
    const existing =
      typeof store.findPersonalAccessTokenById === "function"
        ? await store.findPersonalAccessTokenById(tokenId)
        : null;
    if (!existing) {
      sendJson(res, 404, { error: "Token not found" });
      return;
    }
    const revoked = await store.revokePersonalAccessToken(tokenId, new Date().toISOString());
    const actor = actorFieldsForPrincipal(principal);
    await appendAuditEvent(store, {
      actorStackUserId: actor.actorStackUserId,
      actorEmail: actor.actorEmail,
      eventType: "pat-revoked",
      subjectType: "pat",
      subjectId: revoked.id,
      payload: {
        ownerEmail: revoked.ownerEmail,
        ownerStackUserId: revoked.ownerStackUserId,
      },
    });
    sendJson(res, 200, {
      ok: true,
      record: sanitizePersonalAccessTokenRecord(revoked),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/session") {
    const principal = await requireAuthorization(req, config, store, { mode: "read" });
    requireStackPrincipal(principal);
    sendJson(res, 200, buildSessionPayload(principal, config));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/app/access-request") {
    const principal = await requireAuthorization(req, config, store, { mode: "read" });
    requireStackPrincipal(principal);
    if (principal.accessState === "approved") {
      sendJson(res, 200, buildSessionPayload(principal, config));
      return;
    }
    if (principal.accessState === "rejected" || principal.accessState === "revoked") {
      sendJson(res, 409, { error: "This account cannot reopen access requests. Contact a Wave Control superuser." });
      return;
    }
    const body = await readJsonBody(req);
    const reason = String(body.reason || "").trim() || null;
    const existing = sanitizeAppUserRecord(principal.appUser);
    const next = existing
      ? mergeAppUserRecord(existing, {
          accessState: "pending",
          role: existing.role || "member",
          accessRequestReason: reason,
          accessRequestedAt: new Date().toISOString(),
        })
      : createAppUserRecord({
          stackUserId: principal.stackUserId,
          email: principal.email,
          displayName: principal.displayName,
          role: "member",
          accessState: "pending",
          providerGrants: [],
          accessRequestReason: reason,
          accessRequestedAt: new Date().toISOString(),
        });
    if (existing) {
      await store.updateAppUser(existing.id, next);
    } else {
      await store.createAppUser(next);
    }
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: existing ? "app-user-access-request-updated" : "app-user-access-request-created",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        accessState: next.accessState,
        email: next.email,
        reason: next.accessRequestReason,
      },
    });
    const refreshedPrincipal = {
      ...principal,
      appUser: next,
      accessState: next.accessState,
      appRole: next.role,
      role: next.role,
      providerGrants: next.providerGrants,
      isSuperuser: next.role === "superuser" && next.accessState === "approved",
      isAdmin: next.role === "superuser" && next.accessState === "approved",
    };
    sendJson(res, 200, buildSessionPayload(refreshedPrincipal, config));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/me") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    sendJson(res, 200, {
      ok: true,
      user: {
        stackUserId: principal.stackUserId,
        email: principal.email,
        displayName: principal.displayName,
        teamIds: principal.teamIds,
        accessState: principal.accessState,
        role: principal.appRole,
        providerGrants: normalizeProviderGrantList(principal.providerGrants || []),
        isSuperuser: principal.isSuperuser === true,
        isAdmin: principal.isSuperuser === true,
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/overview") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    const filters = queryFilters(url);
    sendJson(
      res,
      200,
      buildAppOverview(
        await store.getAnalytics(filters),
        await store.listRuns(filters),
        await store.listBenchmarkRuns(filters),
      ),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/runs") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    sendJson(res, 200, { items: await store.listRuns(queryFilters(url)) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/run") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    const payload = await store.getRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/benchmarks") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    sendJson(res, 200, { items: await store.listBenchmarkRuns(queryFilters(url)) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/benchmark") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    const payload = await store.getBenchmarkRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Benchmark run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/tokens") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    const listAll = principal.isSuperuser && url.searchParams.get("all") === "1";
    let ownerStackUserId = null;
    if (listAll) {
      const ownerEmail = normalizeEmail(url.searchParams.get("ownerEmail") || "");
      const requestedOwnerStackUserId = String(url.searchParams.get("ownerStackUserId") || "").trim() || null;
      if (ownerEmail || requestedOwnerStackUserId) {
        const ownerAppUser = requireBoundPatOwnerAppUser(
          await resolveTokenOwnerAppUser(store, principal, {
            ownerEmail,
            ownerStackUserId: requestedOwnerStackUserId,
          }),
        );
        ownerStackUserId = ownerAppUser.stackUserId;
      }
    } else {
      ownerStackUserId = String(principal.stackUserId || "").trim() || null;
    }
    const records =
      listAll || ownerStackUserId
        ? await store.listPersonalAccessTokens({
            ownerStackUserId: ownerStackUserId || undefined,
          })
        : [];
    sendJson(res, 200, {
      items: records.map((record) => sanitizePersonalAccessTokenRecord(record)),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/app/tokens") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    const body = await readJsonBody(req);
    const ownerAppUser = requireBoundPatOwnerAppUser(await resolveTokenOwnerAppUser(store, principal, body));
    if (!principal.isSuperuser && ownerAppUser.id !== principal.appUserId) {
      sendJson(res, 403, { error: "Only Wave Control superusers can issue tokens for other users." });
      return;
    }
    const generated = createPersonalAccessToken(body.label, defaultTokenScopes(body.scopes, ownerAppUser), {
      stackUserId: ownerAppUser.stackUserId || null,
      email: ownerAppUser.email || null,
      createdByStackUserId: principal.stackUserId,
    });
    await store.createPersonalAccessToken({
      ...generated.record,
      tokenHash: generated.tokenHash,
    });
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: "pat-created",
      subjectType: "pat",
      subjectId: generated.record.id,
      payload: {
        ownerEmail: generated.record.ownerEmail,
        ownerStackUserId: generated.record.ownerStackUserId,
        scopes: generated.record.scopes,
      },
    });
    sendJson(res, 201, {
      ok: true,
      token: generated.token,
      record: sanitizePersonalAccessTokenRecord(generated.record),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/app\/tokens\/[^/]+\/revoke$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:read"],
    });
    requireApprovedAppUser(principal);
    const tokenId = url.pathname.split("/")[5] || "";
    const existing =
      typeof store.findPersonalAccessTokenById === "function"
        ? await store.findPersonalAccessTokenById(tokenId)
        : null;
    if (!existing) {
      sendJson(res, 404, { error: "Token not found" });
      return;
    }
    const canRevoke = principal.isSuperuser || existing.ownerStackUserId === principal.stackUserId;
    if (!canRevoke) {
      sendJson(res, 403, { error: "Only the token owner or a Wave Control superuser can revoke this token." });
      return;
    }
    const revoked = await store.revokePersonalAccessToken(tokenId, new Date().toISOString());
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: "pat-revoked",
      subjectType: "pat",
      subjectId: revoked.id,
      payload: {
        ownerEmail: revoked.ownerEmail,
        ownerStackUserId: revoked.ownerStackUserId,
      },
    });
    sendJson(res, 200, {
      ok: true,
      record: sanitizePersonalAccessTokenRecord(revoked),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/admin/users") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireAppSuperuser(principal);
    sendJson(res, 200, {
      items: (await store.listAppUsers()).map((record) => sanitizeAppUserRecord(record)),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/app/admin/users") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:read"],
    });
    requireAppSuperuser(principal);
    const body = await readJsonBody(req);
    const email = normalizeEmail(body.email || "");
    const existing = sanitizeAppUserRecord(await store.findAppUserByEmail(email));
    const { next } = buildManagedUserUpsertRecord(existing, body, principal);
    if (existing) {
      await store.updateAppUser(existing.id, next);
    } else {
      await store.createAppUser(next);
    }
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: existing ? "app-user-updated" : "app-user-created",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        email: next.email,
        role: next.role,
        accessState: next.accessState,
        providerGrants: next.providerGrants,
      },
    });
    sendJson(res, existing ? 200 : 201, {
      ok: true,
      user: sanitizeAppUserRecord(next),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/app\/admin\/users\/[^/]+\/state$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:read"],
    });
    requireAppSuperuser(principal);
    const userId = url.pathname.split("/")[6] || "";
    const body = await readJsonBody(req);
    const accessState = parseAppUserAccessStateInput(body.accessState);
    const existing = await requireAppUserById(store, userId);
    const next = mergeAppUserRecord(existing, {
      accessState,
      accessReviewedAt: new Date().toISOString(),
      accessReviewedByStackUserId: principal.stackUserId,
    });
    await store.updateAppUser(existing.id, next);
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: "app-user-state-updated",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        accessState: next.accessState,
      },
    });
    sendJson(res, 200, {
      ok: true,
      user: sanitizeAppUserRecord(next),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/app\/admin\/users\/[^/]+\/role$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:read"],
    });
    requireAppSuperuser(principal);
    const userId = url.pathname.split("/")[6] || "";
    const body = await readJsonBody(req);
    const role = parseAppUserRoleInput(body.role);
    const existing = await requireAppUserById(store, userId);
    const next = mergeAppUserRecord(existing, {
      role,
      providerGrants: buildManagedUserProviderGrants(existing, role),
    });
    await store.updateAppUser(existing.id, next);
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: "app-user-role-updated",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        role: next.role,
      },
    });
    sendJson(res, 200, {
      ok: true,
      user: sanitizeAppUserRecord(next),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/app\/admin\/users\/[^/]+\/providers$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:read"],
    });
    requireAppSuperuser(principal);
    const userId = url.pathname.split("/")[6] || "";
    const body = await readJsonBody(req);
    const providerGrants = validateProviderGrants(body.providerGrants || []);
    const existing = await requireAppUserById(store, userId);
    const next = mergeAppUserRecord(existing, {
      providerGrants,
    });
    await store.updateAppUser(existing.id, next);
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: "app-user-provider-grants-updated",
      subjectType: "app-user",
      subjectId: next.id,
      payload: {
        providerGrants: next.providerGrants,
      },
    });
    sendJson(res, 200, {
      ok: true,
      user: sanitizeAppUserRecord(next),
    });
    return;
  }

  if (req.method === "GET" && /^\/api\/v1\/app\/admin\/users\/[^/]+\/credentials$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireAppSuperuser(principal);
    const userId = url.pathname.split("/")[6] || "";
    const appUser = await requireAppUserById(store, userId);
    sendJson(res, 200, {
      items: await listCredentialMetadata(store, appUser.id),
    });
    return;
  }

  if (req.method === "PUT" && /^\/api\/v1\/app\/admin\/users\/[^/]+\/credentials\/[^/]+$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:read"],
    });
    requireAppSuperuser(principal);
    const userId = url.pathname.split("/")[6] || "";
    const credentialId = url.pathname.split("/")[8] || "";
    const appUser = await requireAppUserById(store, userId);
    const body = await readJsonBody(req);
    const saved = await upsertManagedUserCredential(store, config, appUser, credentialId, body.value, principal);
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: "user-credential-upserted",
      subjectType: "user-credential",
      subjectId: `${appUser.id}:${saved.credentialId}`,
      payload: {
        appUserId: appUser.id,
        credentialId: saved.credentialId,
      },
    });
    sendJson(res, 200, {
      ok: true,
      credential: sanitizeUserCredentialMetadata(saved),
    });
    return;
  }

  if (req.method === "DELETE" && /^\/api\/v1\/app\/admin\/users\/[^/]+\/credentials\/[^/]+$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:read"],
    });
    requireAppSuperuser(principal);
    const userId = url.pathname.split("/")[6] || "";
    const credentialId = url.pathname.split("/")[8] || "";
    const appUser = await requireAppUserById(store, userId);
    const deleted = await deleteManagedUserCredential(store, appUser.id, credentialId);
    if (!deleted) {
      sendJson(res, 404, { error: "Credential not found." });
      return;
    }
    await appendAuditEvent(store, {
      actorStackUserId: principal.stackUserId,
      actorEmail: principal.email,
      eventType: "user-credential-deleted",
      subjectType: "user-credential",
      subjectId: `${appUser.id}:${deleted.credentialId}`,
      payload: {
        appUserId: appUser.id,
        credentialId: deleted.credentialId,
      },
    });
    sendJson(res, 200, {
      ok: true,
      credential: sanitizeUserCredentialMetadata(deleted),
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

export async function createWaveControlServer(options = {}) {
  const config = options.config || loadWaveControlServiceConfig();
  const store = options.store || (await createWaveControlStore(config));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://wave-control.local");
    setCorsHeaders(req, res, config);
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
        sendHtml(res, 200, renderWaveControlUi(config));
        return;
      }
      await handleApiRequest(req, res, url, { config, store });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, statusCode, { error: message });
    }
  });
  return {
    config,
    store,
    server,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      if (typeof store.close === "function") {
        await store.close();
      }
    },
  };
}

export async function startWaveControlServer(options = {}) {
  const app = await createWaveControlServer(options);
  await new Promise((resolve) =>
    app.server.listen(app.config.port, app.config.host, resolve),
  );
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await startWaveControlServer();
  console.log(
    `[wave-control] listening on http://${app.config.host}:${app.config.port}`,
  );
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
