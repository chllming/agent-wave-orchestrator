import crypto from "node:crypto";

export const APP_USER_ROLES = ["member", "superuser"];
export const APP_USER_ACCESS_STATES = ["pending", "approved", "rejected", "revoked"];
export const PROVIDER_GRANT_IDS = ["anthropic", "context7", "corridor", "openai"];
export const ENV_LEASE_PROVIDER_IDS = ["anthropic", "openai"];
export const BROKER_PROVIDER_IDS = ["context7", "corridor"];

const APP_USER_ROLE_SET = new Set(APP_USER_ROLES);
const APP_USER_ACCESS_STATE_SET = new Set(APP_USER_ACCESS_STATES);
const PROVIDER_GRANT_SET = new Set(PROVIDER_GRANT_IDS);
const ENV_LEASE_PROVIDER_SET = new Set(ENV_LEASE_PROVIDER_IDS);

const PROVIDER_CATALOG = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    delivery: "env",
    envVars: ["ANTHROPIC_API_KEY"],
  },
  context7: {
    id: "context7",
    label: "Context7",
    delivery: "broker",
    envVars: [],
  },
  corridor: {
    id: "corridor",
    label: "Corridor",
    delivery: "broker",
    envVars: [],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    delivery: "env",
    envVars: ["OPENAI_API_KEY"],
  },
};

function nowIso() {
  return new Date().toISOString();
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase() || null;
}

function normalizeString(value) {
  return String(value || "").trim() || null;
}

function normalizeStringArray(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();
}

export function normalizeAppUserRole(value, fallback = "member") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return APP_USER_ROLE_SET.has(normalized) ? normalized : fallback;
}

export function normalizeAppUserAccessState(value, fallback = "pending") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return APP_USER_ACCESS_STATE_SET.has(normalized) ? normalized : fallback;
}

export function normalizeProviderGrantList(values) {
  return normalizeStringArray(values).filter((value) => PROVIDER_GRANT_SET.has(value));
}

export function listInvalidProviderGrants(values) {
  return normalizeStringArray(values).filter((value) => !PROVIDER_GRANT_SET.has(value));
}

export function isEnvLeaseProvider(providerId) {
  return ENV_LEASE_PROVIDER_SET.has(String(providerId || "").trim().toLowerCase());
}

export function getProviderDefinition(providerId) {
  const normalized = String(providerId || "").trim().toLowerCase();
  return PROVIDER_CATALOG[normalized] || null;
}

export function isProviderEnabled(config, providerId) {
  const normalized = String(providerId || "").trim().toLowerCase();
  if (normalized === "context7") {
    return Boolean(config?.broker?.ownedDeployment && config?.broker?.context7Enabled && config?.broker?.context7ApiKey);
  }
  if (normalized === "corridor") {
    return Boolean(config?.broker?.ownedDeployment && config?.broker?.corridorEnabled && config?.broker?.corridorApiToken);
  }
  if (normalized === "openai") {
    return Boolean(config?.broker?.ownedDeployment && config?.broker?.openaiEnabled && config?.broker?.openaiApiKey);
  }
  if (normalized === "anthropic") {
    return Boolean(config?.broker?.ownedDeployment && config?.broker?.anthropicEnabled && config?.broker?.anthropicApiKey);
  }
  return false;
}

export function buildProviderCatalog(config) {
  return PROVIDER_GRANT_IDS.map((providerId) => {
    const definition = getProviderDefinition(providerId);
    return {
      id: definition.id,
      label: definition.label,
      delivery: definition.delivery,
      envVars: [...definition.envVars],
      enabled: isProviderEnabled(config, providerId),
    };
  });
}

export function buildDefaultProviderGrants(role = "member") {
  return normalizeAppUserRole(role) === "superuser" ? [...PROVIDER_GRANT_IDS] : [];
}

export function resolveManagedAppUserProviderGrants(existingRecord, role, explicitProviderGrants = undefined) {
  const current = sanitizeAppUserRecord(existingRecord);
  const normalizedRole = normalizeAppUserRole(role);
  const defaultSuperuserGrants = buildDefaultProviderGrants("superuser");
  if (normalizedRole === "superuser") {
    const baseProviderGrants =
      explicitProviderGrants !== undefined ? explicitProviderGrants : current?.providerGrants || [];
    return normalizeProviderGrantList([...baseProviderGrants, ...defaultSuperuserGrants]);
  }
  if (explicitProviderGrants !== undefined) {
    return normalizeProviderGrantList(explicitProviderGrants);
  }
  if (current?.role === "superuser") {
    const defaultSuperuserGrantSet = new Set(defaultSuperuserGrants);
    return normalizeProviderGrantList(current.providerGrants || []).filter(
      (providerGrant) => !defaultSuperuserGrantSet.has(providerGrant),
    );
  }
  return normalizeProviderGrantList(current?.providerGrants || []);
}

export function hasAnyEnvLeaseGrant(providerGrants) {
  return normalizeProviderGrantList(providerGrants).some((providerId) => isEnvLeaseProvider(providerId));
}

export function sanitizeAppUserRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  return {
    id: record.id || null,
    stackUserId: normalizeString(record.stackUserId),
    email: normalizeEmail(record.email),
    displayName: normalizeString(record.displayName),
    role: normalizeAppUserRole(record.role),
    accessState: normalizeAppUserAccessState(record.accessState),
    providerGrants: normalizeProviderGrantList(record.providerGrants),
    accessRequestReason: normalizeString(record.accessRequestReason),
    accessRequestedAt: normalizeString(record.accessRequestedAt),
    accessReviewedAt: normalizeString(record.accessReviewedAt),
    accessReviewedByStackUserId: normalizeString(record.accessReviewedByStackUserId),
    createdAt: normalizeString(record.createdAt),
    updatedAt: normalizeString(record.updatedAt),
  };
}

export function createAppUserRecord({
  stackUserId = null,
  email,
  displayName = null,
  role = "member",
  accessState = "pending",
  providerGrants = [],
  accessRequestReason = null,
  accessRequestedAt = null,
  accessReviewedAt = null,
  accessReviewedByStackUserId = null,
} = {}) {
  const timestamp = nowIso();
  const normalizedRole = normalizeAppUserRole(role);
  return sanitizeAppUserRecord({
    id: crypto.randomUUID(),
    stackUserId,
    email,
    displayName,
    role: normalizedRole,
    accessState,
    providerGrants:
      Array.isArray(providerGrants) && providerGrants.length > 0
        ? providerGrants
        : buildDefaultProviderGrants(normalizedRole),
    accessRequestReason,
    accessRequestedAt,
    accessReviewedAt,
    accessReviewedByStackUserId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function mergeAppUserRecord(record, changes = {}) {
  const current = sanitizeAppUserRecord(record);
  const next = sanitizeAppUserRecord({
    ...current,
    ...changes,
    id: current?.id || changes.id,
    updatedAt: changes.updatedAt || nowIso(),
    providerGrants:
      changes.providerGrants !== undefined ? changes.providerGrants : current?.providerGrants || [],
  });
  if (!next?.id) {
    return null;
  }
  return next;
}

export function createAuditEvent({
  actorStackUserId = null,
  actorEmail = null,
  eventType,
  subjectType,
  subjectId = null,
  payload = {},
} = {}) {
  return {
    id: crypto.randomUUID(),
    actorStackUserId: normalizeString(actorStackUserId),
    actorEmail: normalizeEmail(actorEmail),
    eventType: normalizeString(eventType),
    subjectType: normalizeString(subjectType),
    subjectId: normalizeString(subjectId),
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {},
    createdAt: nowIso(),
  };
}
