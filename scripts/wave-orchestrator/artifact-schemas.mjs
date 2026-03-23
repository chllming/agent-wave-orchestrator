import { readJsonOrNull, toIsoTimestamp, writeJsonAtomic } from "./shared.mjs";
import {
  normalizeWaveControlReportMode,
  normalizeWaveControlRunKind,
} from "./wave-control-schema.mjs";

export const MANIFEST_SCHEMA_VERSION = 1;
export const GLOBAL_DASHBOARD_SCHEMA_VERSION = 1;
export const WAVE_DASHBOARD_SCHEMA_VERSION = 1;
export const RELAUNCH_PLAN_SCHEMA_VERSION = 1;
export const RETRY_OVERRIDE_SCHEMA_VERSION = 1;
export const ASSIGNMENT_SNAPSHOT_SCHEMA_VERSION = 1;
export const DEPENDENCY_SNAPSHOT_SCHEMA_VERSION = 1;
export const PROOF_REGISTRY_SCHEMA_VERSION = 1;
export const RUN_STATE_SCHEMA_VERSION = 2;
export const WAVE_CONTROL_DELIVERY_STATE_SCHEMA_VERSION = 1;

export const MANIFEST_KIND = "wave-manifest";
export const GLOBAL_DASHBOARD_KIND = "global-dashboard";
export const WAVE_DASHBOARD_KIND = "wave-dashboard";
export const RELAUNCH_PLAN_KIND = "wave-relaunch-plan";
export const RETRY_OVERRIDE_KIND = "wave-retry-override";
export const ASSIGNMENT_SNAPSHOT_KIND = "wave-assignment-snapshot";
export const DEPENDENCY_SNAPSHOT_KIND = "wave-dependency-snapshot";
export const PROOF_REGISTRY_KIND = "wave-proof-registry";
export const RUN_STATE_KIND = "wave-run-state";
export const WAVE_CONTROL_DELIVERY_STATE_KIND = "wave-control-delivery-state";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeInteger(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeText(value, fallback = null) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value, null))
        .filter(Boolean),
    ),
  );
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

export function normalizeRetryOverride(payload, defaults = {}) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: RETRY_OVERRIDE_SCHEMA_VERSION,
    kind: RETRY_OVERRIDE_KIND,
    lane: normalizeText(source.lane, normalizeText(defaults.lane, null)),
    wave: normalizeInteger(source.wave, normalizeInteger(defaults.wave, null)),
    selectedAgentIds: normalizeStringArray(source.selectedAgentIds),
    reuseAttemptIds: normalizeStringArray(source.reuseAttemptIds),
    reuseProofBundleIds: normalizeStringArray(source.reuseProofBundleIds),
    reuseDerivedSummaries: source.reuseDerivedSummaries !== false,
    invalidateComponentIds: normalizeStringArray(source.invalidateComponentIds),
    clearReusableAgentIds: normalizeStringArray(source.clearReusableAgentIds),
    preserveReusableAgentIds: normalizeStringArray(source.preserveReusableAgentIds),
    resumePhase: normalizeText(source.resumePhase, null),
    requestedBy: normalizeText(source.requestedBy, normalizeText(defaults.requestedBy, null)),
    reason: normalizeText(source.reason, null),
    applyOnce: source.applyOnce !== false,
    createdAt: normalizeText(source.createdAt, toIsoTimestamp()),
  };
}

export function readRetryOverride(filePath, defaults = {}) {
  const payload = readJsonOrNull(filePath);
  if (!payload) {
    return null;
  }
  return normalizeRetryOverride(payload, defaults);
}

export function writeRetryOverride(filePath, payload, defaults = {}) {
  const normalized = normalizeRetryOverride(payload, defaults);
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

function normalizeProofArtifactEntry(entry) {
  const source = isPlainObject(entry) ? entry : {};
  return {
    path: normalizeText(source.path, null),
    kind: normalizeText(source.kind, null),
    requiredFor: normalizeStringArray(source.requiredFor),
    exists: source.exists === true,
    sha256: normalizeText(source.sha256, null),
  };
}

function normalizeProofComponentEntry(entry) {
  const source = isPlainObject(entry) ? entry : {};
  return {
    componentId: normalizeText(source.componentId, null),
    level: normalizeText(source.level, null),
    state: normalizeText(source.state, null),
    detail: normalizeText(source.detail, null),
  };
}

function normalizeProofSummaryEntry(entry) {
  const source = isPlainObject(entry) ? entry : {};
  const state = normalizeText(source.state, null);
  const completion = normalizeText(source.completion, null);
  const durability = normalizeText(source.durability, null);
  const proof = normalizeText(source.proof, null);
  if (!state && !completion && !durability && !proof) {
    return null;
  }
  return {
    state,
    completion,
    durability,
    proof,
    detail: normalizeText(source.detail, null),
  };
}

function normalizeDocDeltaEntry(entry) {
  const source = isPlainObject(entry) ? entry : {};
  const state = normalizeText(source.state, null);
  if (!state) {
    return null;
  }
  return {
    state,
    detail: normalizeText(source.detail, null),
  };
}

function normalizeProofRegistryEntry(entry) {
  const source = isPlainObject(entry) ? entry : {};
  return {
    id: normalizeText(source.id, null),
    agentId: normalizeText(source.agentId, null),
    state: normalizeText(source.state, null),
    authoritative: source.authoritative === true,
    recordedAt: normalizeText(source.recordedAt, toIsoTimestamp()),
    recordedBy: normalizeText(source.recordedBy, null),
    detail: normalizeText(source.detail, null),
    summary: normalizeText(source.summary, null),
    satisfyOwnedComponents: source.satisfyOwnedComponents === true,
    proof: normalizeProofSummaryEntry(source.proof),
    docDelta: normalizeDocDeltaEntry(source.docDelta),
    components: (Array.isArray(source.components) ? source.components : [])
      .map((item) => normalizeProofComponentEntry(item))
      .filter((item) => item.componentId),
    artifacts: (Array.isArray(source.artifacts) ? source.artifacts : [])
      .map((item) => normalizeProofArtifactEntry(item))
      .filter((item) => item.path),
    scope: normalizeText(source.scope, null),
    attestation: isPlainObject(source.attestation) ? cloneJson(source.attestation) : null,
    satisfies: normalizeStringArray(source.satisfies),
    supersedes: normalizeText(source.supersedes, null),
    supersededBy: normalizeText(source.supersededBy, null),
  };
}

export function normalizeProofRegistry(payload, defaults = {}) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: PROOF_REGISTRY_SCHEMA_VERSION,
    kind: PROOF_REGISTRY_KIND,
    lane: normalizeText(source.lane, normalizeText(defaults.lane, null)),
    wave: normalizeInteger(source.wave, normalizeInteger(defaults.wave, null)),
    updatedAt: normalizeText(source.updatedAt, toIsoTimestamp()),
    entries: (Array.isArray(source.entries) ? source.entries : [])
      .map((entry) => normalizeProofRegistryEntry(entry))
      .filter((entry) => entry.id && entry.agentId),
  };
}

export function readProofRegistry(filePath, defaults = {}) {
  const payload = readJsonOrNull(filePath);
  if (!payload) {
    return null;
  }
  return normalizeProofRegistry(payload, defaults);
}

export function writeProofRegistry(filePath, payload, defaults = {}) {
  const normalized = normalizeProofRegistry(payload, defaults);
  writeJsonAtomic(filePath, normalized);
  return normalized;
}

export function normalizeWaveControlDeliveryState(payload, defaults = {}) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: WAVE_CONTROL_DELIVERY_STATE_SCHEMA_VERSION,
    kind: WAVE_CONTROL_DELIVERY_STATE_KIND,
    workspaceId: normalizeText(source.workspaceId, normalizeText(defaults.workspaceId, null)),
    lane: normalizeText(source.lane, normalizeText(defaults.lane, null)),
    runId: normalizeText(source.runId, normalizeText(defaults.runId, null)),
    runKind: normalizeWaveControlRunKind(
      source.runKind,
      "waveControlDeliveryState.runKind",
      normalizeText(defaults.runKind, "unknown"),
    ),
    reportMode: normalizeWaveControlReportMode(
      source.reportMode,
      "waveControlDeliveryState.reportMode",
      normalizeText(defaults.reportMode, "metadata-plus-selected"),
    ),
    endpoint: normalizeText(source.endpoint, normalizeText(defaults.endpoint, null)),
    queuePath: normalizeText(source.queuePath, normalizeText(defaults.queuePath, null)),
    eventsPath: normalizeText(source.eventsPath, normalizeText(defaults.eventsPath, null)),
    pendingCount: normalizeNonNegativeInteger(
      source.pendingCount,
      normalizeNonNegativeInteger(defaults.pendingCount, 0),
    ),
    sentCount: normalizeNonNegativeInteger(
      source.sentCount,
      normalizeNonNegativeInteger(defaults.sentCount, 0),
    ),
    failedCount: normalizeNonNegativeInteger(
      source.failedCount,
      normalizeNonNegativeInteger(defaults.failedCount, 0),
    ),
    lastEnqueuedAt: normalizeText(source.lastEnqueuedAt, normalizeText(defaults.lastEnqueuedAt, null)),
    lastFlushAt: normalizeText(source.lastFlushAt, normalizeText(defaults.lastFlushAt, null)),
    lastSuccessAt: normalizeText(source.lastSuccessAt, normalizeText(defaults.lastSuccessAt, null)),
    lastError:
      source.lastError === undefined
        ? defaults.lastError ?? null
        : isPlainObject(source.lastError)
          ? source.lastError
          : normalizeText(source.lastError, null),
    recentEventIds: normalizeStringArray(source.recentEventIds ?? defaults.recentEventIds),
    updatedAt: normalizeText(source.updatedAt, normalizeText(defaults.updatedAt, toIsoTimestamp())),
  };
}

export function readWaveControlDeliveryState(filePath, defaults = {}) {
  const payload = readJsonOrNull(filePath);
  if (!payload) {
    return null;
  }
  return normalizeWaveControlDeliveryState(payload, defaults);
}

export function writeWaveControlDeliveryState(filePath, payload, defaults = {}) {
  const normalized = normalizeWaveControlDeliveryState(payload, defaults);
  writeJsonAtomic(filePath, normalized);
  return normalized;
}

export function cloneArtifactPayload(value) {
  return cloneJson(value);
}

// ── Wave 4: Surface class metadata and additional schema normalizers ──

export const WAVE_STATE_SCHEMA_VERSION = 1;
export const TASK_ENTITY_SCHEMA_VERSION = 1;
export const AGENT_RESULT_ENVELOPE_SCHEMA_VERSION = 1;
export const RESUME_PLAN_SCHEMA_VERSION = 1;
export const HUMAN_INPUT_WORKFLOW_SCHEMA_VERSION = 1;

export const SURFACE_CLASS_CANONICAL_EVENT = "canonical-event";
export const SURFACE_CLASS_CANONICAL_SNAPSHOT = "canonical-snapshot";
export const SURFACE_CLASS_CACHED_DERIVED = "cached-derived";
export const SURFACE_CLASS_HUMAN_PROJECTION = "human-projection";
export const SURFACE_CLASSES = new Set([
  SURFACE_CLASS_CANONICAL_EVENT,
  SURFACE_CLASS_CANONICAL_SNAPSHOT,
  SURFACE_CLASS_CACHED_DERIVED,
  SURFACE_CLASS_HUMAN_PROJECTION,
]);

export const WAVE_STATE_KIND = "wave-state-snapshot";
export const TASK_ENTITY_KIND = "wave-task-entity";
export const AGENT_RESULT_ENVELOPE_KIND = "agent-result-envelope";
export const RESUME_PLAN_KIND = "wave-resume-plan";
export const HUMAN_INPUT_WORKFLOW_KIND = "human-input-workflow-state";

export function normalizeWaveStateSnapshot(payload, defaults = {}) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: WAVE_STATE_SCHEMA_VERSION,
    kind: WAVE_STATE_KIND,
    _meta: { surfaceClass: SURFACE_CLASS_CANONICAL_SNAPSHOT },
    lane: normalizeText(source.lane, normalizeText(defaults.lane, null)),
    wave: normalizeInteger(source.wave, normalizeInteger(defaults.wave, null)),
    ...source,
    schemaVersion: WAVE_STATE_SCHEMA_VERSION,
    kind: WAVE_STATE_KIND,
    _meta: { surfaceClass: SURFACE_CLASS_CANONICAL_SNAPSHOT },
    generatedAt: normalizeText(source.generatedAt, toIsoTimestamp()),
  };
}

export function readWaveStateSnapshot(filePath, defaults = {}) {
  const payload = readJsonOrNull(filePath);
  if (!payload) {
    return null;
  }
  return normalizeWaveStateSnapshot(payload, defaults);
}

export function writeWaveStateSnapshot(filePath, payload, defaults = {}) {
  const normalized = normalizeWaveStateSnapshot(payload, defaults);
  writeJsonAtomic(filePath, normalized);
  return normalized;
}

export function normalizeAgentResultEnvelope(payload) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: AGENT_RESULT_ENVELOPE_SCHEMA_VERSION,
    kind: AGENT_RESULT_ENVELOPE_KIND,
    _meta: { surfaceClass: SURFACE_CLASS_CANONICAL_SNAPSHOT },
    ...source,
    schemaVersion: AGENT_RESULT_ENVELOPE_SCHEMA_VERSION,
    kind: AGENT_RESULT_ENVELOPE_KIND,
    _meta: { surfaceClass: SURFACE_CLASS_CANONICAL_SNAPSHOT },
  };
}

export function normalizeResumePlan(payload) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    schemaVersion: RESUME_PLAN_SCHEMA_VERSION,
    kind: RESUME_PLAN_KIND,
    _meta: { surfaceClass: SURFACE_CLASS_CACHED_DERIVED },
    ...source,
    schemaVersion: RESUME_PLAN_SCHEMA_VERSION,
    kind: RESUME_PLAN_KIND,
    _meta: { surfaceClass: SURFACE_CLASS_CACHED_DERIVED },
  };
}
