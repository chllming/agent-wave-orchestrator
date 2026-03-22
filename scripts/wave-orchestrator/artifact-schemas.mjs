import { readJsonOrNull, toIsoTimestamp, writeJsonAtomic } from "./shared.mjs";

export const MANIFEST_SCHEMA_VERSION = 1;
export const GLOBAL_DASHBOARD_SCHEMA_VERSION = 1;
export const WAVE_DASHBOARD_SCHEMA_VERSION = 1;
export const RELAUNCH_PLAN_SCHEMA_VERSION = 1;
export const ASSIGNMENT_SNAPSHOT_SCHEMA_VERSION = 1;
export const DEPENDENCY_SNAPSHOT_SCHEMA_VERSION = 1;
export const RUN_STATE_SCHEMA_VERSION = 2;

export const MANIFEST_KIND = "wave-manifest";
export const GLOBAL_DASHBOARD_KIND = "global-dashboard";
export const WAVE_DASHBOARD_KIND = "wave-dashboard";
export const RELAUNCH_PLAN_KIND = "wave-relaunch-plan";
export const ASSIGNMENT_SNAPSHOT_KIND = "wave-assignment-snapshot";
export const DEPENDENCY_SNAPSHOT_KIND = "wave-dependency-snapshot";
export const RUN_STATE_KIND = "wave-run-state";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeInteger(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value, fallback = null) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function normalizeManifest(payload) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: MANIFEST_KIND,
    generatedAt: normalizeText(source.generatedAt, toIsoTimestamp()),
    source: normalizeText(source.source, ""),
    waves: Array.isArray(source.waves) ? source.waves : [],
    docs: Array.isArray(source.docs) ? source.docs : [],
  };
}

export function normalizeWaveDashboardState(payload) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    ...source,
    schemaVersion: WAVE_DASHBOARD_SCHEMA_VERSION,
    kind: WAVE_DASHBOARD_KIND,
  };
}

export function normalizeGlobalDashboardState(payload) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    ...source,
    schemaVersion: GLOBAL_DASHBOARD_SCHEMA_VERSION,
    kind: GLOBAL_DASHBOARD_KIND,
  };
}

export function normalizeRelaunchPlan(payload, defaults = {}) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: RELAUNCH_PLAN_SCHEMA_VERSION,
    kind: RELAUNCH_PLAN_KIND,
    wave: normalizeInteger(source.wave, normalizeInteger(defaults.wave, null)),
    attempt: normalizeInteger(source.attempt, null),
    phase: normalizeText(source.phase, null),
    selectedAgentIds: Array.isArray(source.selectedAgentIds) ? source.selectedAgentIds : [],
    reasonBuckets: isPlainObject(source.reasonBuckets) ? source.reasonBuckets : {},
    executorStates: isPlainObject(source.executorStates) ? source.executorStates : {},
    fallbackHistory: isPlainObject(source.fallbackHistory) ? source.fallbackHistory : {},
    createdAt: normalizeText(source.createdAt, toIsoTimestamp()),
  };
}

export function readRelaunchPlan(filePath, defaults = {}) {
  const payload = readJsonOrNull(filePath);
  if (!payload) {
    return null;
  }
  return normalizeRelaunchPlan(payload, defaults);
}

export function writeRelaunchPlan(filePath, payload, defaults = {}) {
  const normalized = normalizeRelaunchPlan(payload, defaults);
  writeJsonAtomic(filePath, normalized);
  return normalized;
}

export function normalizeAssignmentSnapshot(payload, defaults = {}) {
  if (Array.isArray(payload)) {
    return {
      schemaVersion: ASSIGNMENT_SNAPSHOT_SCHEMA_VERSION,
      kind: ASSIGNMENT_SNAPSHOT_KIND,
      lane: normalizeText(defaults.lane, null),
      wave: normalizeInteger(defaults.wave, null),
      generatedAt: normalizeText(defaults.generatedAt, toIsoTimestamp()),
      assignments: payload,
    };
  }
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: ASSIGNMENT_SNAPSHOT_SCHEMA_VERSION,
    kind: ASSIGNMENT_SNAPSHOT_KIND,
    lane: normalizeText(source.lane, normalizeText(defaults.lane, null)),
    wave: normalizeInteger(source.wave, normalizeInteger(defaults.wave, null)),
    generatedAt: normalizeText(source.generatedAt, normalizeText(defaults.generatedAt, toIsoTimestamp())),
    assignments: Array.isArray(source.assignments) ? source.assignments : [],
  };
}

export function readAssignmentSnapshot(filePath, defaults = {}) {
  const payload = readJsonOrNull(filePath);
  if (!payload) {
    return null;
  }
  return normalizeAssignmentSnapshot(payload, defaults);
}

export function writeAssignmentSnapshot(filePath, payload, defaults = {}) {
  const normalized = normalizeAssignmentSnapshot(payload, defaults);
  writeJsonAtomic(filePath, normalized);
  return normalized;
}

export function normalizeDependencySnapshot(payload, defaults = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const legacyShape = !("schemaVersion" in source) && !("kind" in source);
  return {
    schemaVersion: DEPENDENCY_SNAPSHOT_SCHEMA_VERSION,
    kind: DEPENDENCY_SNAPSHOT_KIND,
    lane: normalizeText(
      source.lane,
      legacyShape ? normalizeText(defaults.lane, null) : normalizeText(defaults.lane, null),
    ),
    wave: normalizeInteger(source.wave, normalizeInteger(defaults.wave, null)),
    generatedAt: normalizeText(source.generatedAt, normalizeText(defaults.generatedAt, toIsoTimestamp())),
    inbound: Array.isArray(source.inbound) ? source.inbound : [],
    outbound: Array.isArray(source.outbound) ? source.outbound : [],
    openInbound: Array.isArray(source.openInbound) ? source.openInbound : [],
    openOutbound: Array.isArray(source.openOutbound) ? source.openOutbound : [],
    requiredInbound: Array.isArray(source.requiredInbound) ? source.requiredInbound : [],
    requiredOutbound: Array.isArray(source.requiredOutbound) ? source.requiredOutbound : [],
    unresolvedInboundAssignments: Array.isArray(source.unresolvedInboundAssignments)
      ? source.unresolvedInboundAssignments
      : [],
  };
}

export function readDependencySnapshot(filePath, defaults = {}) {
  const payload = readJsonOrNull(filePath);
  if (!payload) {
    return null;
  }
  return normalizeDependencySnapshot(payload, defaults);
}

export function writeDependencySnapshot(filePath, payload, defaults = {}) {
  const normalized = normalizeDependencySnapshot(payload, defaults);
  writeJsonAtomic(filePath, normalized);
  return normalized;
}

export function cloneArtifactPayload(value) {
  return cloneJson(value);
}
