import crypto from "node:crypto";

export const WAVE_CONTROL_SCHEMA_VERSION = 1;
export const WAVE_CONTROL_EVENT_KIND = "wave-control-event";

export const WAVE_CONTROL_ENTITY_TYPES = new Set([
  "task",
  "proof_bundle",
  "rerun_request",
  "attempt",
  "human_input",
  "contradiction",
  "fact",
  "wave_run",
  "agent_run",
  "coordination_record",
  "gate",
  "artifact",
  "benchmark_run",
  "benchmark_item",
  "verification",
  "review",
]);

export const WAVE_CONTROL_RUN_KINDS = new Set([
  "roadmap",
  "adhoc",
  "benchmark",
  "service",
  "unknown",
]);

export const WAVE_CONTROL_UPLOAD_POLICIES = new Set([
  "local-only",
  "metadata-only",
  "selected",
  "full",
]);

export const WAVE_CONTROL_REPORT_MODES = new Set([
  "disabled",
  "metadata-only",
  "metadata-plus-selected",
  "full-artifact-upload",
]);

export const WAVE_CONTROL_REVIEW_VALIDITIES = new Set([
  "comparison-valid",
  "review-only",
  "benchmark-invalid",
  "harness-setup-failure",
  "proof-blocked",
  "trustworthy-model-failure",
]);

function normalizeText(value, fallback = null) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeNonNegativeInt(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  return value === true;
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {};
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

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new Error(`${label} must be one of ${Array.from(allowed).join(", ")} (got: ${value || "empty"})`);
  }
}

function defaultId(prefix, value) {
  const hash = crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
  return `${prefix}-${hash}`;
}

export function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonValue(value[key])]),
    );
  }
  return value;
}

export function buildWaveControlConfigAttestationHash(value) {
  return crypto.createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

export function normalizeWaveControlUploadPolicy(
  value,
  label = "waveControl.uploadPolicy",
  fallback = "metadata-only",
) {
  const normalized = normalizeText(value, fallback)?.toLowerCase() || fallback;
  assertEnum(normalized, WAVE_CONTROL_UPLOAD_POLICIES, label);
  return normalized;
}

export function normalizeWaveControlReportMode(
  value,
  label = "waveControl.reportMode",
  fallback = "metadata-plus-selected",
) {
  const normalized = normalizeText(value, fallback)?.toLowerCase() || fallback;
  assertEnum(normalized, WAVE_CONTROL_REPORT_MODES, label);
  return normalized;
}

export function normalizeWaveControlReviewValidity(
  value,
  label = "waveControl.reviewValidity",
  fallback = "review-only",
) {
  const normalized = normalizeText(value, fallback)?.toLowerCase() || fallback;
  assertEnum(normalized, WAVE_CONTROL_REVIEW_VALIDITIES, label);
  return normalized;
}

export function normalizeWaveControlRunKind(
  value,
  label = "waveControl.runKind",
  fallback = "unknown",
) {
  const normalized = normalizeText(value, fallback)?.toLowerCase() || fallback;
  assertEnum(normalized, WAVE_CONTROL_RUN_KINDS, label);
  return normalized;
}

export function normalizeWaveControlRunIdentity(rawIdentity = {}, defaults = {}) {
  const source = normalizePlainObject(rawIdentity);
  const fallback = normalizePlainObject(defaults);
  return {
    workspaceId: normalizeText(source.workspaceId, normalizeText(fallback.workspaceId, null)),
    projectId: normalizeText(source.projectId, normalizeText(fallback.projectId, null)),
    runId: normalizeText(source.runId, normalizeText(fallback.runId, null)),
    runKind: normalizeWaveControlRunKind(
      source.runKind,
      "waveControl.runKind",
      normalizeText(fallback.runKind, "unknown"),
    ),
    lane: normalizeText(source.lane, normalizeText(fallback.lane, null)),
    wave: normalizeNonNegativeInt(source.wave, normalizeNonNegativeInt(fallback.wave, null)),
    attempt: normalizeNonNegativeInt(
      source.attempt,
      normalizeNonNegativeInt(fallback.attempt, null),
    ),
    agentId: normalizeText(source.agentId, normalizeText(fallback.agentId, null)),
    orchestratorId: normalizeText(
      source.orchestratorId,
      normalizeText(fallback.orchestratorId, null),
    ),
    runtimeVersion: normalizeText(
      source.runtimeVersion,
      normalizeText(fallback.runtimeVersion, null),
    ),
    benchmarkRunId: normalizeText(
      source.benchmarkRunId,
      normalizeText(fallback.benchmarkRunId, null),
    ),
    benchmarkItemId: normalizeText(
      source.benchmarkItemId,
      normalizeText(fallback.benchmarkItemId, null),
    ),
  };
}

export function normalizeWaveControlArtifactDescriptor(rawArtifact = {}, defaults = {}) {
  const source = normalizePlainObject(rawArtifact);
  const fallback = normalizePlainObject(defaults);
  const path = normalizeText(source.path, normalizeText(fallback.path, null));
  const kind = normalizeText(source.kind, normalizeText(fallback.kind, "artifact"));
  const descriptor = {
    path,
    kind,
    required: normalizeBoolean(source.required, Boolean(fallback.required)),
    present:
      source.present === undefined
        ? normalizeBoolean(fallback.present, false)
        : normalizeBoolean(source.present, false),
    sha256: normalizeText(source.sha256, normalizeText(fallback.sha256, null)),
    bytes: normalizeNonNegativeInt(source.bytes, normalizeNonNegativeInt(fallback.bytes, null)),
    contentType: normalizeText(source.contentType, normalizeText(fallback.contentType, null)),
    uploadPolicy: normalizeWaveControlUploadPolicy(
      source.uploadPolicy,
      "waveControl.artifact.uploadPolicy",
      normalizeText(fallback.uploadPolicy, "metadata-only"),
    ),
    label: normalizeText(source.label, normalizeText(fallback.label, null)),
    recordedAt: normalizeText(source.recordedAt, normalizeText(fallback.recordedAt, null)),
  };
  return {
    artifactId:
      normalizeText(source.artifactId, normalizeText(fallback.artifactId, null)) ||
      defaultId("artifact", stableJsonStringify({ path, kind, sha256: descriptor.sha256 })),
    ...descriptor,
  };
}

export function normalizeWaveControlEventEnvelope(rawEvent = {}, defaults = {}) {
  const source = normalizePlainObject(rawEvent);
  const fallback = normalizePlainObject(defaults);
  const entityType = normalizeText(source.entityType, normalizeText(fallback.entityType, null))?.toLowerCase();
  assertEnum(entityType, WAVE_CONTROL_ENTITY_TYPES, "waveControl.entityType");
  const entityId = normalizeText(source.entityId, normalizeText(fallback.entityId, null));
  const action = normalizeText(source.action, normalizeText(fallback.action, null))?.toLowerCase();
  if (!entityId) {
    throw new Error("waveControl.entityId is required");
  }
  if (!action) {
    throw new Error("waveControl.action is required");
  }
  const recordedAt = normalizeText(
    source.recordedAt,
    normalizeText(fallback.recordedAt, new Date().toISOString()),
  );
  const identity = normalizeWaveControlRunIdentity(
    source.identity,
    fallback.identity || {
      workspaceId: fallback.workspaceId,
      projectId: fallback.projectId,
      runId: fallback.runId,
      runKind: fallback.runKind,
      lane: fallback.lane,
      wave: fallback.wave,
      attempt: fallback.attempt,
      agentId: fallback.agentId,
      orchestratorId: fallback.orchestratorId,
      runtimeVersion: fallback.runtimeVersion,
      benchmarkRunId: fallback.benchmarkRunId,
      benchmarkItemId: fallback.benchmarkItemId,
    },
  );
  const artifacts = (Array.isArray(source.artifacts) ? source.artifacts : fallback.artifacts || [])
    .map((artifact) => normalizeWaveControlArtifactDescriptor(artifact))
    .filter((artifact) => artifact.path || artifact.sha256 || artifact.kind);
  const payload = {
    schemaVersion: WAVE_CONTROL_SCHEMA_VERSION,
    kind: WAVE_CONTROL_EVENT_KIND,
    id:
      normalizeText(source.id, normalizeText(fallback.id, null)) ||
      defaultId(
        "wctl",
        stableJsonStringify({
          workspaceId: identity.workspaceId,
          projectId: identity.projectId,
          runId: identity.runId,
          lane: identity.lane,
          wave: identity.wave,
          attempt: identity.attempt,
          orchestratorId: identity.orchestratorId,
          runtimeVersion: identity.runtimeVersion,
          entityType,
          entityId,
          action,
          recordedAt,
        }),
      ),
    category: normalizeText(source.category, normalizeText(fallback.category, "runtime")),
    source: normalizeText(source.source, normalizeText(fallback.source, "wave")),
    actor: normalizeText(source.actor, normalizeText(fallback.actor, null)),
    recordedAt,
    entityType,
    entityId,
    action,
    identity,
    tags: normalizeStringArray(source.tags ?? fallback.tags),
    metrics: normalizePlainObject(source.metrics ?? fallback.metrics),
    data: normalizePlainObject(source.data ?? fallback.data),
    artifacts,
  };
  return payload;
}
