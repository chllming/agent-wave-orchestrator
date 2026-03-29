import crypto from "node:crypto";

export const PERSONAL_ACCESS_TOKEN_ALLOWED_SCOPES = ["broker:read", "credential:read", "ingest:write"];

const PERSONAL_ACCESS_TOKEN_ALLOWED_SCOPE_SET = new Set(PERSONAL_ACCESS_TOKEN_ALLOWED_SCOPES);

function nowIso() {
  return new Date().toISOString();
}

function normalizeScopeList(scopes) {
  return Array.from(
    new Set(
      (Array.isArray(scopes) ? scopes : [])
        .map((scope) => String(scope || "").trim())
        .filter(Boolean),
    ),
  ).sort();
}

export function hashPersonalAccessToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function normalizePersonalAccessTokenScopes(scopes) {
  return normalizeScopeList(scopes).filter((scope) => PERSONAL_ACCESS_TOKEN_ALLOWED_SCOPE_SET.has(scope));
}

export function listInvalidPersonalAccessTokenScopes(scopes) {
  return normalizeScopeList(scopes).filter((scope) => !PERSONAL_ACCESS_TOKEN_ALLOWED_SCOPE_SET.has(scope));
}

export function createPersonalAccessToken(label, scopes, owner) {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(24).toString("base64url");
  const token = `wave_pat_${id}.${secret}`;
  return {
    id,
    token,
    tokenHash: hashPersonalAccessToken(token),
    record: {
      id,
      label: String(label || "").trim() || "Wave Control token",
      scopes: normalizePersonalAccessTokenScopes(scopes),
      ownerStackUserId: String(owner?.stackUserId || "").trim() || null,
      ownerEmail: String(owner?.email || "").trim() || null,
      createdByStackUserId: String(owner?.createdByStackUserId || owner?.stackUserId || "").trim() || null,
      createdAt: nowIso(),
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

export function sanitizePersonalAccessTokenRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  return {
    id: record.id || null,
    label: record.label || null,
    scopes: normalizePersonalAccessTokenScopes(record.scopes),
    ownerStackUserId: record.ownerStackUserId || null,
    ownerEmail: record.ownerEmail || null,
    createdByStackUserId: record.createdByStackUserId || null,
    createdAt: record.createdAt || null,
    lastUsedAt: record.lastUsedAt || null,
    revokedAt: record.revokedAt || null,
  };
}
