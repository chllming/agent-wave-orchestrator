export const SERVICE_TOKEN_ALLOWED_SCOPES = [
  "service:read",
  "service:user:write",
  "service:credential:write",
  "service:token:write",
];

const SERVICE_TOKEN_ALLOWED_SCOPE_SET = new Set(SERVICE_TOKEN_ALLOWED_SCOPES);

function normalizeScopeList(scopes) {
  return Array.from(
    new Set(
      (Array.isArray(scopes) ? scopes : [])
        .map((scope) => String(scope || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();
}

export function normalizeServiceTokenScopes(scopes) {
  return normalizeScopeList(scopes).filter((scope) => SERVICE_TOKEN_ALLOWED_SCOPE_SET.has(scope));
}

export function listInvalidServiceTokenScopes(scopes) {
  return normalizeScopeList(scopes).filter((scope) => !SERVICE_TOKEN_ALLOWED_SCOPE_SET.has(scope));
}
