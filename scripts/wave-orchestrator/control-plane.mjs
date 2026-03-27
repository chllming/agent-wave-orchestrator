import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeProofRegistry,
  readProofRegistry,
  normalizeRetryOverride,
  writeProofRegistry,
  writeRetryOverride,
} from "./artifact-schemas.mjs";
import {
  CLARIFICATION_CLOSURE_PREFIX,
  buildCoordinationResponseMetrics,
  coordinationBlockerSeverity,
  coordinationRecordBlocksWave,
} from "./coordination-store.mjs";
import {
  DEFAULT_COORDINATION_ACK_TIMEOUT_MS,
  DEFAULT_COORDINATION_RESOLUTION_STALE_MS,
  ensureDirectory,
  parseNonNegativeInt,
  toIsoTimestamp,
} from "./shared.mjs";
import {
  WAVE_CONTROL_ENTITY_TYPES,
  normalizeWaveControlRunKind,
} from "./wave-control-schema.mjs";
import { safeQueueWaveControlEvent } from "./wave-control-client.mjs";

const TASKABLE_COORDINATION_KINDS = new Set([
  "request",
  "blocker",
  "handoff",
  "evidence",
  "claim",
  "decision",
  "clarification-request",
  "human-feedback",
  "human-escalation",
]);

const PROOF_BUNDLE_STATES = new Set(["active", "superseded", "revoked"]);
const RERUN_REQUEST_STATES = new Set(["active", "applied", "cleared"]);
const ATTEMPT_STATES = new Set(["running", "completed", "failed", "cancelled"]);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? cloneJson(value) : null;
}

function stableId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

function compareRecordedEvents(left, right) {
  const leftTs = Date.parse(left?.recordedAt || "");
  const rightTs = Date.parse(right?.recordedAt || "");
  if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
    return leftTs - rightTs;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new Error(`${label} must be one of ${Array.from(allowed).join(", ")} (got: ${value || "empty"})`);
  }
}

function controlProjectionPaths(lanePaths, waveNumber) {
  const normalizedWave = parseNonNegativeInt(waveNumber, "wave");
  return {
    retryOverridePath: path.join(
      lanePaths.controlDir,
      `retry-override-wave-${normalizedWave}.json`,
    ),
    proofRegistryPath: path.join(lanePaths.proofDir, `wave-${normalizedWave}.json`),
  };
}

export function waveControlPlaneLogPath(lanePaths, waveNumber) {
  return path.join(
    lanePaths.controlPlaneDir,
    `wave-${parseNonNegativeInt(waveNumber, "wave")}.jsonl`,
  );
}

export function normalizeControlPlaneEvent(rawEvent, defaults = {}) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    throw new Error("Control-plane event must be an object");
  }
  const entityType = normalizeText(rawEvent.entityType || defaults.entityType).toLowerCase();
  assertEnum(entityType, WAVE_CONTROL_ENTITY_TYPES, "Control-plane entity type");
  const lane = normalizeText(rawEvent.lane || defaults.lane);
  const wave = Number.parseInt(String(rawEvent.wave ?? defaults.wave ?? ""), 10);
  const entityId = normalizeText(rawEvent.entityId || defaults.entityId);
  const action = normalizeText(rawEvent.action || defaults.action).toLowerCase();
  const runId = normalizeText(rawEvent.runId || defaults.runId, null);
  if (!lane) {
    throw new Error("Control-plane lane is required");
  }
  if (!Number.isFinite(wave) || wave < 0) {
    throw new Error(`Control-plane wave must be a non-negative integer (got: ${rawEvent.wave})`);
  }
  if (!entityId) {
    throw new Error("Control-plane entityId is required");
  }
  if (!action) {
    throw new Error("Control-plane action is required");
  }
  return {
    recordVersion: 1,
    id: normalizeText(rawEvent.id || defaults.id) || stableId(`ctrl-${entityType}`),
    lane,
    wave,
    runKind: normalizeWaveControlRunKind(rawEvent.runKind || defaults.runKind || "roadmap"),
    runId,
    entityType,
    entityId,
    action,
    source: normalizeText(rawEvent.source || defaults.source, "launcher"),
    actor: normalizeText(rawEvent.actor || defaults.actor, ""),
    recordedAt: normalizeText(rawEvent.recordedAt || defaults.recordedAt, toIsoTimestamp()),
    attempt:
      rawEvent.attempt === null || rawEvent.attempt === undefined || rawEvent.attempt === ""
        ? defaults.attempt ?? null
        : parseNonNegativeInt(rawEvent.attempt, "control-plane attempt"),
    data: normalizePlainObject(rawEvent.data || defaults.data) || {},
  };
}

export function appendControlPlaneEvent(filePath, rawEvent, defaults = {}) {
  const event = normalizeControlPlaneEvent(rawEvent, defaults);
  ensureDirectory(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function readControlPlaneEvents(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeControlPlaneEvent(JSON.parse(line)))
    .sort(compareRecordedEvents);
}

function normalizeProofArtifactEntry(entry) {
  const source = normalizePlainObject(entry) || {};
  return {
    path: normalizeText(source.path),
    kind: normalizeText(source.kind, null),
    requiredFor: normalizeStringArray(source.requiredFor),
    exists: source.exists === true,
    sha256: normalizeText(source.sha256, null),
  };
}

function normalizeProofComponentEntry(entry) {
  const source = normalizePlainObject(entry) || {};
  return {
    componentId: normalizeText(source.componentId),
    level: normalizeText(source.level, null),
    state: normalizeText(source.state, null),
    detail: normalizeText(source.detail, null),
  };
}

function normalizeProofBundleSnapshot(rawBundle, defaults = {}) {
  const source = normalizePlainObject(rawBundle) || {};
  const state = normalizeText(source.state, normalizeText(defaults.state, "active")).toLowerCase();
  assertEnum(state, PROOF_BUNDLE_STATES, "Proof bundle state");
  const recordedAt = normalizeText(source.recordedAt, normalizeText(defaults.recordedAt, toIsoTimestamp()));
  return {
    proofBundleId: normalizeText(source.proofBundleId, normalizeText(defaults.proofBundleId)),
    agentId: normalizeText(source.agentId, normalizeText(defaults.agentId)),
    state,
    authoritative: source.authoritative === true,
    recordedAt,
    updatedAt: normalizeText(source.updatedAt, normalizeText(defaults.updatedAt, recordedAt)),
    recordedBy: normalizeText(source.recordedBy, normalizeText(defaults.recordedBy, null)),
    detail: normalizeText(source.detail, normalizeText(defaults.detail, null)),
    summary: normalizeText(source.summary, normalizeText(defaults.summary, null)),
    satisfyOwnedComponents: source.satisfyOwnedComponents === true,
    proof: normalizePlainObject(source.proof),
    docDelta: normalizePlainObject(source.docDelta),
    components: (Array.isArray(source.components) ? source.components : [])
      .map((entry) => normalizeProofComponentEntry(entry))
      .filter((entry) => entry.componentId),
    artifacts: (Array.isArray(source.artifacts) ? source.artifacts : [])
      .map((entry) => normalizeProofArtifactEntry(entry))
      .filter((entry) => entry.path),
    scope: normalizeText(source.scope, normalizeText(defaults.scope, "wave")),
    attestation: normalizePlainObject(source.attestation),
    satisfies: normalizeStringArray(source.satisfies),
    supersedes: normalizeText(source.supersedes, normalizeText(defaults.supersedes, null)),
    supersededBy: normalizeText(source.supersededBy, normalizeText(defaults.supersededBy, null)),
  };
}

function normalizeRerunRequestSnapshot(rawRequest, defaults = {}) {
  const source = normalizePlainObject(rawRequest) || {};
  const createdAt = normalizeText(source.createdAt, normalizeText(defaults.createdAt, toIsoTimestamp()));
  const state = normalizeText(source.state, normalizeText(defaults.state, "active")).toLowerCase();
  assertEnum(state, RERUN_REQUEST_STATES, "Rerun request state");
  return {
    requestId: normalizeText(source.requestId, normalizeText(defaults.requestId)),
    state,
    selectedAgentIds: normalizeStringArray(source.selectedAgentIds),
    resumeCursor: normalizeText(
      source.resumeCursor,
      normalizeText(source.resumePhase, normalizeText(defaults.resumeCursor, null)),
    ),
    reuseAttemptIds: normalizeStringArray(source.reuseAttemptIds),
    reuseProofBundleIds: normalizeStringArray(source.reuseProofBundleIds),
    reuseDerivedSummaries: source.reuseDerivedSummaries !== false,
    invalidateComponentIds: normalizeStringArray(source.invalidateComponentIds),
    clearReusableAgentIds: normalizeStringArray(source.clearReusableAgentIds),
    preserveReusableAgentIds: normalizeStringArray(source.preserveReusableAgentIds),
    requestedBy: normalizeText(source.requestedBy, normalizeText(defaults.requestedBy, "human-operator")),
    reason: normalizeText(source.reason, normalizeText(defaults.reason, null)),
    applyOnce: source.applyOnce !== false,
    createdAt,
    updatedAt: normalizeText(source.updatedAt, normalizeText(defaults.updatedAt, createdAt)),
  };
}

function normalizeAttemptSnapshot(rawAttempt, defaults = {}) {
  const source = normalizePlainObject(rawAttempt) || {};
  const createdAt = normalizeText(source.createdAt, normalizeText(defaults.createdAt, toIsoTimestamp()));
  const state = normalizeText(source.state, normalizeText(defaults.state, "running")).toLowerCase();
  assertEnum(state, ATTEMPT_STATES, "Attempt state");
  return {
    attemptId: normalizeText(source.attemptId, normalizeText(defaults.attemptId)),
    attemptNumber: Number.parseInt(String(source.attemptNumber ?? defaults.attemptNumber ?? ""), 10) || 0,
    state,
    selectedAgentIds: normalizeStringArray(source.selectedAgentIds),
    detail: normalizeText(source.detail, normalizeText(defaults.detail, null)),
    createdAt,
    updatedAt: normalizeText(source.updatedAt, normalizeText(defaults.updatedAt, createdAt)),
  };
}

function normalizeHumanInputSnapshot(rawInput, defaults = {}) {
  const source = normalizePlainObject(rawInput) || {};
  const createdAt = normalizeText(source.createdAt, normalizeText(defaults.createdAt, toIsoTimestamp()));
  return {
    humanInputId: normalizeText(source.humanInputId, normalizeText(defaults.humanInputId)),
    requestId: normalizeText(source.requestId, normalizeText(defaults.requestId, null)),
    state: normalizeText(source.state, normalizeText(defaults.state, "pending")).toLowerCase(),
    operator: normalizeText(source.operator, normalizeText(defaults.operator, null)),
    response: normalizeText(source.response, normalizeText(defaults.response, null)),
    createdAt,
    updatedAt: normalizeText(source.updatedAt, normalizeText(defaults.updatedAt, createdAt)),
  };
}

function materializeByEntity(events, entityType, normalizer) {
  const snapshotsById = new Map();
  const ordered = events.filter((event) => event.entityType === entityType);
  for (const event of ordered) {
    const existing = snapshotsById.get(event.entityId) || {};
    const snapshot = normalizer({
      ...existing,
      ...(normalizePlainObject(event.data) || {}),
    }, existing);
    snapshotsById.set(event.entityId, snapshot);
  }
  return {
    byId: snapshotsById,
    all: Array.from(snapshotsById.values()).sort((left, right) =>
      String(left.updatedAt || left.recordedAt || "").localeCompare(String(right.updatedAt || right.recordedAt || "")),
    ),
  };
}

function bundleToRegistryEntry(bundle) {
  return {
    id: bundle.proofBundleId,
    agentId: bundle.agentId,
    state: bundle.state,
    authoritative: bundle.authoritative,
    recordedAt: bundle.recordedAt,
    recordedBy: bundle.recordedBy,
    detail: bundle.detail,
    summary: bundle.summary,
    satisfyOwnedComponents: bundle.satisfyOwnedComponents,
    proof: cloneJson(bundle.proof),
    docDelta: cloneJson(bundle.docDelta),
    components: cloneJson(bundle.components),
    artifacts: cloneJson(bundle.artifacts),
    scope: bundle.scope,
    attestation: cloneJson(bundle.attestation),
    satisfies: cloneJson(bundle.satisfies),
    supersedes: bundle.supersedes,
    supersededBy: bundle.supersededBy,
  };
}

export function materializeControlPlaneState(events) {
  const orderedEvents = [...(Array.isArray(events) ? events : [])].sort(compareRecordedEvents);
  const proofBundles = materializeByEntity(
    orderedEvents,
    "proof_bundle",
    normalizeProofBundleSnapshot,
  );
  const rerunRequests = materializeByEntity(
    orderedEvents,
    "rerun_request",
    normalizeRerunRequestSnapshot,
  );
  const attempts = materializeByEntity(
    orderedEvents,
    "attempt",
    normalizeAttemptSnapshot,
  );
  const humanInputs = materializeByEntity(
    orderedEvents,
    "human_input",
    normalizeHumanInputSnapshot,
  );
  const activeProofBundles = proofBundles.all.filter((bundle) => bundle.state === "active");
  const activeRerunRequest =
    [...rerunRequests.all]
      .sort((left, right) =>
        String(left.updatedAt || "").localeCompare(String(right.updatedAt || "")),
      )
      .filter((request) => request.state === "active")
      .at(-1) || null;
  const activeAttempt =
    [...attempts.all]
      .sort((left, right) =>
        String(left.updatedAt || "").localeCompare(String(right.updatedAt || "")),
      )
      .filter((attempt) => attempt.state === "running")
      .at(-1) || null;
  return {
    events: orderedEvents,
    proofBundlesById: proofBundles.byId,
    proofBundles: proofBundles.all,
    activeProofBundles,
    rerunRequestsById: rerunRequests.byId,
    rerunRequests: rerunRequests.all,
    activeRerunRequest,
    attemptsById: attempts.byId,
    attempts: attempts.all,
    activeAttempt,
    humanInputsById: humanInputs.byId,
    humanInputs: humanInputs.all,
  };
}

export function readWaveControlPlaneState(lanePaths, waveNumber) {
  return materializeControlPlaneState(readControlPlaneEvents(waveControlPlaneLogPath(lanePaths, waveNumber)));
}

export function appendWaveControlEvent(lanePaths, waveNumber, rawEvent, defaults = {}) {
  const filePath = waveControlPlaneLogPath(lanePaths, waveNumber);
  const event = appendControlPlaneEvent(filePath, rawEvent, {
    lane: lanePaths?.lane || defaults.lane || null,
    wave: waveNumber,
    runKind: lanePaths?.runKind || defaults.runKind || "roadmap",
    runId: lanePaths?.runId || defaults.runId || null,
    ...defaults,
  });
  if (lanePaths?.waveControl?.captureControlPlaneEvents !== false) {
    safeQueueWaveControlEvent(lanePaths, {
      category: "control-plane",
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      source: event.source,
      actor: event.actor,
      recordedAt: event.recordedAt,
      identity: {
        lane: event.lane,
        wave: event.wave,
        attempt: event.attempt,
        runKind: event.runKind,
        runId: event.runId,
      },
      tags: ["control-plane", event.entityType],
      data: event.data,
    });
  }
  return event;
}

function materializeProofRegistryProjection(lanePaths, waveNumber, controlState) {
  return normalizeProofRegistry(
    {
      lane: lanePaths?.lane || null,
      wave: waveNumber,
      updatedAt:
        controlState?.activeProofBundles?.at(-1)?.updatedAt ||
        controlState?.proofBundles?.at(-1)?.updatedAt ||
        toIsoTimestamp(),
      entries: (controlState?.proofBundles || []).map((bundle) => bundleToRegistryEntry(bundle)),
    },
    {
      lane: lanePaths?.lane || null,
      wave: waveNumber,
    },
  );
}

function materializeRetryOverrideProjection(lanePaths, waveNumber, controlState) {
  const activeRequest = controlState?.activeRerunRequest;
  if (!activeRequest) {
    return null;
  }
  return normalizeRetryOverride(
    {
      lane: lanePaths?.lane || null,
      wave: waveNumber,
      selectedAgentIds: activeRequest.selectedAgentIds,
      reuseAttemptIds: activeRequest.reuseAttemptIds,
      reuseProofBundleIds: activeRequest.reuseProofBundleIds,
      reuseDerivedSummaries: activeRequest.reuseDerivedSummaries,
      invalidateComponentIds: activeRequest.invalidateComponentIds,
      clearReusableAgentIds: activeRequest.clearReusableAgentIds,
      preserveReusableAgentIds: activeRequest.preserveReusableAgentIds,
      resumePhase: activeRequest.resumeCursor,
      requestedBy: activeRequest.requestedBy,
      reason: activeRequest.reason,
      applyOnce: activeRequest.applyOnce,
      createdAt: activeRequest.createdAt,
    },
    {
      lane: lanePaths?.lane || null,
      wave: waveNumber,
    },
  );
}

export function syncWaveControlPlaneProjections(lanePaths, waveNumber, controlState = null) {
  const state = controlState || readWaveControlPlaneState(lanePaths, waveNumber);
  const filePaths = controlProjectionPaths(lanePaths, waveNumber);
  ensureDirectory(lanePaths.controlDir);
  ensureDirectory(lanePaths.proofDir);
  const hasProofEvents = Array.isArray(state?.proofBundles) && state.proofBundles.length > 0;
  const proofRegistry = hasProofEvents
    ? materializeProofRegistryProjection(lanePaths, waveNumber, state)
    : null;
  if (proofRegistry) {
    writeProofRegistry(filePaths.proofRegistryPath, proofRegistry, {
      lane: lanePaths?.lane || null,
      wave: waveNumber,
    });
  }
  const retryOverride = materializeRetryOverrideProjection(lanePaths, waveNumber, state);
  if (retryOverride) {
    writeRetryOverride(filePaths.retryOverridePath, retryOverride, {
      lane: lanePaths?.lane || null,
      wave: waveNumber,
    });
  } else if (Array.isArray(state?.rerunRequests) && state.rerunRequests.length > 0) {
    fs.rmSync(filePaths.retryOverridePath, { force: true });
  }
  return {
    proofRegistry:
      proofRegistry ||
      (fs.existsSync(filePaths.proofRegistryPath)
        ? readProofRegistry(filePaths.proofRegistryPath, {
            lane: lanePaths?.lane || null,
            wave: waveNumber,
          })
        : null),
    retryOverride,
  };
}

function firstTargetAgentId(record) {
  for (const target of Array.isArray(record?.targets) ? record.targets : []) {
    const normalized = normalizeText(target);
    if (normalized.startsWith("agent:")) {
      return normalized.slice("agent:".length);
    }
  }
  return null;
}

function isLauncherSeedTaskRecord(record) {
  return (
    record?.source === "launcher" &&
    /^wave-\d+-agent-[^-]+-request$/.test(String(record.id || "")) &&
    !String(record.closureCondition || "").trim() &&
    (!Array.isArray(record.dependsOn) || record.dependsOn.length === 0)
  );
}

function taskTypeForCoordinationKind(kind) {
  if (kind === "clarification-request") {
    return "clarification";
  }
  if (kind === "human-feedback") {
    return "human-input";
  }
  if (kind === "human-escalation") {
    return "escalation";
  }
  return kind;
}

function taskStateForCoordinationRecord(record, feedbackRequest = null) {
  if (feedbackRequest?.status === "answered") {
    return "resolved";
  }
  const status = normalizeText(record?.status).toLowerCase();
  if (status === "open") {
    return record?.kind === "human-feedback" ? "input-required" : "open";
  }
  if (["acknowledged", "in_progress"].includes(status)) {
    return "working";
  }
  if (["resolved", "closed"].includes(status)) {
    return "resolved";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "superseded") {
    return "superseded";
  }
  return "dismissed";
}

function deadlineAt(baseTimestamp, offsetMs) {
  const baseMs = Date.parse(baseTimestamp || "");
  if (!Number.isFinite(baseMs)) {
    return null;
  }
  return new Date(baseMs + offsetMs).toISOString();
}

function clarificationIdFromCondition(value) {
  const normalized = normalizeText(value);
  if (!normalized.startsWith(CLARIFICATION_CLOSURE_PREFIX)) {
    return null;
  }
  return normalized.slice(CLARIFICATION_CLOSURE_PREFIX.length) || null;
}

export function buildTaskSnapshots({
  coordinationState,
  feedbackRequests = [],
  ackTimeoutMs = DEFAULT_COORDINATION_ACK_TIMEOUT_MS,
  resolutionStaleMs = DEFAULT_COORDINATION_RESOLUTION_STALE_MS,
}) {
  const feedbackById = new Map((feedbackRequests || []).map((request) => [request.id, request]));
  const responseMetrics = buildCoordinationResponseMetrics(coordinationState, {
    ackTimeoutMs,
    resolutionStaleMs,
  });
  const tasks = [];
  for (const record of coordinationState?.latestRecords || []) {
    if (!TASKABLE_COORDINATION_KINDS.has(record.kind)) {
      continue;
    }
    if (isLauncherSeedTaskRecord(record)) {
      continue;
    }
    const metrics = responseMetrics.recordMetricsById.get(record.id) || {};
    const feedbackRequest = feedbackById.get(record.id) || null;
    const taskState = taskStateForCoordinationRecord(record, feedbackRequest);
    const blocking = coordinationRecordBlocksWave(record);
    const blockerSeverity = coordinationBlockerSeverity(record);
    tasks.push({
      taskId: record.id,
      sourceRecordId: record.id,
      taskType: taskTypeForCoordinationKind(record.kind),
      state: taskState,
      title: record.summary || record.detail || "Untitled task",
      detail: record.detail || record.summary || "",
      priority: record.priority || "normal",
      ownerAgentId: record.agentId || null,
      assigneeAgentId: firstTargetAgentId(record),
      leaseOwnerAgentId:
        ["acknowledged", "in_progress"].includes(record.status) ? firstTargetAgentId(record) : null,
      blocking,
      blockerSeverity,
      needsHuman:
        record.kind === "human-feedback" ||
        feedbackRequest?.status === "pending" ||
        taskState === "input-required",
      dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn : [],
      evidenceRefs: Array.isArray(record.artifactRefs) ? record.artifactRefs : [],
      blockerReason: record.kind === "blocker" ? record.detail || record.summary || "" : null,
      retryReason: record.kind === "request" ? record.detail || record.summary || "" : null,
      supersedes: record.status === "superseded" ? record.id : null,
      clarificationId:
        record.kind === "clarification-request"
          ? record.id
          : clarificationIdFromCondition(record.closureCondition),
      createdAt: record.createdAt,
      updatedAt: feedbackRequest?.updatedAt || record.updatedAt || record.createdAt,
      ackDeadlineAt:
        metrics.ackTracked && taskState === "open"
          ? deadlineAt(record.createdAt || record.updatedAt, ackTimeoutMs)
          : null,
      resolveDeadlineAt:
        (record.kind === "clarification-request" || metrics.clarificationLinked) &&
        ["open", "working", "input-required"].includes(taskState)
          ? deadlineAt(record.createdAt || record.updatedAt, resolutionStaleMs)
          : null,
      lastHeartbeatAt:
        taskState === "working"
          ? feedbackRequest?.updatedAt || record.updatedAt || record.createdAt
          : null,
      overdueAck: metrics.overdueAck === true,
      stale: metrics.staleClarification === true || blockerSeverity === "stale",
      feedbackRequestId: feedbackRequest?.id || null,
      humanResponse: feedbackRequest?.responseText || null,
      humanOperator: feedbackRequest?.responseOperator || null,
    });
  }
  for (const request of feedbackRequests || []) {
    if (tasks.some((task) => task.taskId === request.id)) {
      continue;
    }
    tasks.push({
      taskId: request.id,
      sourceRecordId: null,
      taskType: "human-input",
      state: request.status === "answered" ? "resolved" : "input-required",
      title: request.question || "Human feedback requested",
      detail: request.context || "",
      priority: "high",
      ownerAgentId: request.agentId || null,
      assigneeAgentId: request.agentId || null,
      leaseOwnerAgentId: null,
      blocking: true,
      blockerSeverity: "hard",
      needsHuman: request.status !== "answered",
      dependsOn: [],
      evidenceRefs: [],
      blockerReason: request.context || "",
      retryReason: null,
      supersedes: null,
      clarificationId: null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt || request.createdAt,
      ackDeadlineAt: null,
      resolveDeadlineAt:
        request.status === "answered" ? null : deadlineAt(request.createdAt, resolutionStaleMs),
      lastHeartbeatAt: null,
      overdueAck: false,
      stale: false,
      feedbackRequestId: request.id,
      humanResponse: request.responseText || null,
      humanOperator: request.responseOperator || null,
    });
  }
  return tasks.sort((left, right) =>
    String(left.createdAt || left.updatedAt || "").localeCompare(String(right.createdAt || right.updatedAt || "")),
  );
}

export function nextTaskDeadline(tasks) {
  const candidates = [];
  for (const task of tasks || []) {
    if (task?.blocking === false) {
      continue;
    }
    for (const [kind, value] of [
      ["ack", task.ackDeadlineAt],
      ["resolve", task.resolveDeadlineAt],
    ]) {
      const ts = Date.parse(value || "");
      if (!Number.isFinite(ts)) {
        continue;
      }
      candidates.push({
        kind,
        taskId: task.taskId,
        at: value,
        title: task.title,
        assigneeAgentId: task.assigneeAgentId || null,
      });
    }
  }
  return candidates.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0] || null;
}
