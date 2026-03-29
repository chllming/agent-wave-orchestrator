import { hashPersonalAccessToken, normalizePersonalAccessTokenScopes } from "./personal-access-tokens.mjs";

const STACK_API_BASE_URL = "https://api.stack-auth.com/api/v1";
const STACK_ME_URL = `${STACK_API_BASE_URL}/users/me`;
const STACK_TEAMS_URL = `${STACK_API_BASE_URL}/teams?user_id=me`;
const STACK_VERIFY_CACHE_TTL_MS = 5000;

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
  const response = await fetch(url, {
    method: "GET",
    headers: stackRequestHeaders(config, accessToken),
  });
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
    const isAdmin = teamIds.some((teamId) => adminTeamIds.has(teamId));
    const principal = {
      type: "stack-user",
      stackUserId: String(payload.id || payload.userId || payload.user_id || "").trim() || null,
      email: String(payload.primaryEmail || payload.primary_email || payload.email || "").trim() || null,
      displayName: String(payload.displayName || payload.display_name || payload.name || "").trim() || null,
      teamIds,
      isAdmin,
      isInternal: true,
      scopes: ["app:read", ...(isAdmin ? ["app:token:write"] : [])],
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

async function resolveBearerPrincipal(req, config, store) {
  const token = bearerTokenFromRequest(req);
  if (!token) {
    return null;
  }
  const staticTokens = config.auth.tokens || [];
  if (staticTokens.includes(token)) {
    return {
      type: "env-token",
      scopes: ["*"],
      tokenId: null,
    };
  }
  if (!store || typeof store.findPersonalAccessTokenByHash !== "function") {
    return null;
  }
  const record = await store.findPersonalAccessTokenByHash(hashPersonalAccessToken(token));
  if (!record || record.revokedAt) {
    return null;
  }
  const usedAt = new Date().toISOString();
  await store.touchPersonalAccessTokenLastUsed(record.id, usedAt);
  return {
    type: "pat",
    tokenId: record.id,
    stackUserId: record.ownerStackUserId || null,
    email: record.ownerEmail || null,
    label: record.label || null,
    scopes: normalizePersonalAccessTokenScopes(record.scopes),
  };
}

export async function authenticateRequest(req, config, store, options = {}) {
  const requiredScopes = Array.isArray(options.requiredScopes) ? options.requiredScopes : [];
  const mode = options.mode || "read";
  if (mode === "read" && config.auth.requireAuthForReads === false && requiredScopes.length === 0) {
    return { type: "anonymous", scopes: [] };
  }
  const bearerPrincipal = await resolveBearerPrincipal(req, config, store);
  if (bearerPrincipal) {
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
    if (!hasRequiredScopes(stackPrincipal.scopes, requiredScopes)) {
      const error = new Error("Authenticated Stack user is missing required application permissions.");
      error.statusCode = 403;
      throw error;
    }
    return stackPrincipal;
  }
  const error = new Error("Unauthorized");
  error.statusCode = 401;
  throw error;
}

export async function requireAuthorization(req, config, store, options = {}) {
  return authenticateRequest(req, config, store, options);
}
