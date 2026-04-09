import crypto from "node:crypto";
import { toIsoTimestamp } from "./shared.mjs";
import {
  validateDesignSummary,
  validateImplementationSummary,
  validateContQaSummary,
  validateContEvalSummary,
  validateDocumentationClosureSummary,
  validateSecuritySummary,
  validateIntegrationSummary,
} from "./agent-state.mjs";
import {
  isContEvalImplementationOwningAgent,
  isContEvalReportOnlyAgent,
  isDesignAgent,
  isImplementationOwningDesignAgent,
  isSecurityReviewAgent,
} from "./role-helpers.mjs";
import {
  coordinationRecordBlocksWave,
  isOpenCoordinationStatus,
} from "./coordination-store.mjs";

export const TASK_TYPES = new Set([
  "design",
  "implementation",
  "integration",
  "documentation",
  "cont-qa",
  "cont-eval",
  "security",
  "component",
  "helper",
  "dependency",
  "clarification",
  "human-input",
  "escalation",
]);

export const CLOSURE_STATES = new Set([
  "open",
  "owned_slice_proven",
  "wave_closure_ready",
  "closed",
  "cancelled",
  "superseded",
]);

export const LEASE_STATES = new Set([
  "unleased",
  "leased",
  "released",
  "expired",
]);

export const TASK_STATUSES = new Set([
  "pending",
  "in_progress",
  "proven",
  "blocked",
  "completed",
]);

const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const CLOSURE_TRANSITIONS = {
  open: new Set(["owned_slice_proven", "cancelled", "superseded"]),
  owned_slice_proven: new Set(["open", "wave_closure_ready", "cancelled", "superseded"]),
  wave_closure_ready: new Set(["closed", "cancelled", "superseded"]),
  closed: new Set(),
  cancelled: new Set(),
  superseded: new Set(),
};

function stableId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : null;
}

function slugTaskScopeSegment(value, fallback = "item") {
  const normalized = normalizeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

/**
 * Build a stable semantic task ID.
 * Format: "wave-{waveNumber}:{agentId}:{scope}"
 */
export function buildSemanticTaskId(waveNumber, agentId, scope) {
  const safeWave = Number.isFinite(waveNumber) ? waveNumber : 0;
  const safeAgent = normalizeText(agentId, "unassigned");
  const safeScope = normalizeText(scope, "primary");
  return `wave-${safeWave}:${safeAgent}:${safeScope}`;
}

function buildCoordinationTaskId({
  waveNumber,
  ownerAgentId,
  taskType,
  sourceRecordId,
  title,
  detail,
}) {
  const sourceScope = normalizeText(sourceRecordId);
  const fingerprint = sourceScope || crypto
    .createHash("sha1")
    .update(JSON.stringify({
      taskType: normalizeText(taskType, "task"),
      title: normalizeText(title),
      detail: normalizeText(detail),
      ownerAgentId: normalizeText(ownerAgentId, "system"),
      waveNumber: Number.isFinite(waveNumber) ? waveNumber : 0,
    }))
    .digest("hex")
    .slice(0, 12);
  return buildSemanticTaskId(
    waveNumber,
    normalizeText(ownerAgentId, "system"),
    `${slugTaskScopeSegment(taskType, "task")}-${slugTaskScopeSegment(fingerprint)}`,
  );
}

/**
 * Compute a content hash (SHA256) for change detection over a task definition subset.
 */
export function computeContentHash(definitionSubset) {
  const payload = JSON.stringify(definitionSubset ?? {});
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Normalize a deliverable entry to the end-state schema: { path, exists, sha256 }.
 */
function normalizeDeliverable(entry) {
  if (typeof entry === "string") {
    return { path: entry, exists: false, sha256: null };
  }
  if (entry && typeof entry === "object") {
    return {
      path: normalizeText(entry.path),
      exists: entry.exists === true,
      sha256: normalizeText(entry.sha256, null),
    };
  }
  return { path: "", exists: false, sha256: null };
}

/**
 * Normalize proofRequirements to end-state object shape.
 * Accepts both legacy string[] and new object shape.
 */
function normalizeProofRequirements(raw, defaults) {
  // Already in new object shape
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      proofLevel: normalizeText(raw.proofLevel, "unit"),
      proofCentric: raw.proofCentric === true,
      maturityTarget: normalizeText(raw.maturityTarget, null),
    };
  }
  // Legacy string array: infer from contents
  if (Array.isArray(raw) && raw.length > 0) {
    return {
      proofLevel: "unit",
      proofCentric: raw.includes("proof-artifacts-present"),
      maturityTarget: raw.includes("component-level-met") ? "component" : null,
    };
  }
  // Default from defaults arg
  if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
    return {
      proofLevel: normalizeText(defaults.proofLevel, "unit"),
      proofCentric: defaults.proofCentric === true,
      maturityTarget: normalizeText(defaults.maturityTarget, null),
    };
  }
  return { proofLevel: "unit", proofCentric: false, maturityTarget: null };
}

/**
 * Normalize dependencyEdges to end-state shape: [{ taskId, kind, status }].
 * Accepts both legacy { targetTaskId, kind } and new { taskId, kind, status } shapes.
 */
function normalizeDependencyEdges(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((edge) => ({
    taskId: normalizeText(edge.taskId || edge.targetTaskId),
    kind: normalizeText(edge.kind, "blocks"),
    status: normalizeText(edge.status, "pending"),
  }));
}

/**
 * Normalize components array: [{ componentId, targetLevel }].
 */
function normalizeComponents(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      componentId: normalizeText(c.componentId),
      targetLevel: normalizeText(c.targetLevel, null),
    }));
}

/**
 * Derive components from componentTargets for backward compatibility.
 */
function deriveComponentsFromTargets(componentTargets) {
  if (!componentTargets || typeof componentTargets !== "object" || Array.isArray(componentTargets)) {
    return [];
  }
  return Object.entries(componentTargets).map(([componentId, targetLevel]) => ({
    componentId,
    targetLevel: normalizeText(targetLevel, null),
  }));
}

export function normalizeTask(rawTask, defaults = {}) {
  if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
    throw new Error("Task must be an object");
  }
  const taskId = normalizeText(rawTask.taskId) || defaults.taskId || stableId("task");
  const taskType = normalizeText(rawTask.taskType) || defaults.taskType || "implementation";
  if (!TASK_TYPES.has(taskType)) {
    throw new Error(`taskType must be one of ${[...TASK_TYPES].join(", ")} (got: ${taskType})`);
  }
  const closureState = normalizeText(rawTask.closureState) || defaults.closureState || "open";
  if (!CLOSURE_STATES.has(closureState)) {
    throw new Error(`closureState must be one of ${[...CLOSURE_STATES].join(", ")} (got: ${closureState})`);
  }
  const leaseState = normalizeText(rawTask.leaseState) || defaults.leaseState || "unleased";
  if (!LEASE_STATES.has(leaseState)) {
    throw new Error(`leaseState must be one of ${[...LEASE_STATES].join(", ")} (got: ${leaseState})`);
  }
  const priority = normalizeText(rawTask.priority) || defaults.priority || "normal";
  if (!VALID_PRIORITIES.has(priority)) {
    throw new Error(`priority must be one of ${[...VALID_PRIORITIES].join(", ")} (got: ${priority})`);
  }

  // Status field (end-state P0-4)
  const rawStatus = normalizeText(rawTask.status) || defaults.status || "pending";
  const status = TASK_STATUSES.has(rawStatus) ? rawStatus : "pending";

  const now = toIsoTimestamp();
  const createdAt = normalizeText(rawTask.createdAt) || defaults.createdAt || now;
  const updatedAt = normalizeText(rawTask.updatedAt) || defaults.updatedAt || createdAt;

  // Normalize artifactContract with end-state deliverables shape
  const rawContract = normalizePlainObject(rawTask.artifactContract) || {};
  const deliverables = Array.isArray(rawContract.deliverables)
    ? rawContract.deliverables.map(normalizeDeliverable)
    : [];
  const proofArtifacts = Array.isArray(rawContract.proofArtifacts)
    ? rawContract.proofArtifacts
    : (Array.isArray(rawContract.requiredPaths) ? [] : []);
  const exitContract =
    rawContract.exitContract && typeof rawContract.exitContract === "object"
      ? { ...rawContract.exitContract }
      : null;

  // Also maintain backward-compat: if old shape had requiredPaths + proofArtifacts,
  // keep requiredPaths in the contract for backward-compat readers
  const requiredPaths = Array.isArray(rawContract.requiredPaths) ? rawContract.requiredPaths : [];
  const componentTargets =
    rawContract.componentTargets && typeof rawContract.componentTargets === "object"
      && !Array.isArray(rawContract.componentTargets)
      ? { ...rawContract.componentTargets }
      : {};

  const artifactContract = {
    deliverables,
    proofArtifacts,
    exitContract,
    requiredPaths,
    componentTargets,
  };

  // Version field
  const version = typeof rawTask.version === "number" ? rawTask.version : 1;

  // Wave number and lane
  const waveNumber = typeof rawTask.waveNumber === "number" ? rawTask.waveNumber
    : (typeof defaults.waveNumber === "number" ? defaults.waveNumber : null);
  const lane = normalizeText(rawTask.lane) || defaults.lane || null;

  // Content hash for change detection
  const definitionSubset = {
    taskType,
    title: normalizeText(rawTask.title, defaults.title || ""),
    ownerAgentId: normalizeText(rawTask.ownerAgentId) || defaults.ownerAgentId || null,
    artifactContract,
  };
  const contentHash = normalizeText(rawTask.contentHash) || computeContentHash(definitionSubset);

  // Components (end-state top-level field)
  const components = Array.isArray(rawTask.components)
    ? normalizeComponents(rawTask.components)
    : deriveComponentsFromTargets(componentTargets);

  // ProofRequirements as end-state object
  const proofRequirements = normalizeProofRequirements(
    rawTask.proofRequirements,
    defaults.proofRequirements,
  );

  // Dependency edges with status
  const dependencyEdges = normalizeDependencyEdges(rawTask.dependencyEdges);

  return {
    taskId,
    version,
    contentHash,
    waveNumber,
    lane,
    taskType,
    title: normalizeText(rawTask.title, defaults.title || ""),
    detail: normalizeText(rawTask.detail, defaults.detail || ""),
    ownerAgentId: normalizeText(rawTask.ownerAgentId) || defaults.ownerAgentId || null,
    assigneeAgentId: normalizeText(rawTask.assigneeAgentId) || defaults.assigneeAgentId || null,
    leaseState,
    leaseOwnerAgentId: normalizeText(rawTask.leaseOwnerAgentId) || null,
    leaseAcquiredAt: normalizeText(rawTask.leaseAcquiredAt) || null,
    leaseExpiresAt: normalizeText(rawTask.leaseExpiresAt) || null,
    leaseHeartbeatAt: normalizeText(rawTask.leaseHeartbeatAt) || null,
    artifactContract,
    proofRequirements,
    dependencyEdges,
    components,
    status,
    closureState,
    sourceRecordId: normalizeText(rawTask.sourceRecordId) || defaults.sourceRecordId || null,
    priority,
    createdAt,
    updatedAt,
  };
}

export function transitionClosureState(currentState, targetState) {
  if (!CLOSURE_STATES.has(currentState)) {
    throw new Error(`Invalid closure state: ${currentState}`);
  }
  if (!CLOSURE_STATES.has(targetState)) {
    throw new Error(`Invalid target closure state: ${targetState}`);
  }
  const allowed = CLOSURE_TRANSITIONS[currentState];
  if (!allowed || !allowed.has(targetState)) {
    throw new Error(
      `Invalid closure transition from ${currentState} to ${targetState}`,
    );
  }
  return targetState;
}

export function acquireLease(task, agentId, expiresAt) {
  if (!task || typeof task !== "object") {
    throw new Error("task must be an object");
  }
  if (!agentId) {
    throw new Error("agentId is required to acquire a lease");
  }
  if (task.leaseState === "leased") {
    throw new Error(`Task ${task.taskId} is already leased by ${task.leaseOwnerAgentId}`);
  }
  const now = toIsoTimestamp();
  return {
    ...task,
    leaseState: "leased",
    leaseOwnerAgentId: String(agentId).trim(),
    leaseAcquiredAt: now,
    leaseExpiresAt: expiresAt || null,
    leaseHeartbeatAt: now,
    updatedAt: now,
  };
}

export function releaseLease(task) {
  if (!task || typeof task !== "object") {
    throw new Error("task must be an object");
  }
  const now = toIsoTimestamp();
  return {
    ...task,
    leaseState: "released",
    leaseOwnerAgentId: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    leaseHeartbeatAt: null,
    updatedAt: now,
  };
}

/**
 * Expire a lease: transition from leased to expired.
 */
export function expireLease(task) {
  if (!task || typeof task !== "object") {
    throw new Error("task must be an object");
  }
  if (task.leaseState !== "leased") {
    throw new Error(`Cannot expire task ${task.taskId} in leaseState ${task.leaseState}`);
  }
  const now = toIsoTimestamp();
  return {
    ...task,
    leaseState: "expired",
    leaseExpiresAt: now,
    updatedAt: now,
  };
}

export function heartbeatLease(task) {
  if (!task || typeof task !== "object") {
    throw new Error("task must be an object");
  }
  if (task.leaseState !== "leased") {
    throw new Error(`Cannot heartbeat task ${task.taskId} in leaseState ${task.leaseState}`);
  }
  const now = toIsoTimestamp();
  return {
    ...task,
    leaseHeartbeatAt: now,
    updatedAt: now,
  };
}

export function isLeaseExpired(task) {
  if (!task || task.leaseState !== "leased") {
    return false;
  }
  if (!task.leaseExpiresAt) {
    return false;
  }
  const expiresMs = Date.parse(task.leaseExpiresAt);
  if (!Number.isFinite(expiresMs)) {
    return false;
  }
  return Date.now() > expiresMs;
}

export function buildTasksFromWaveDefinition(waveDefinition, laneConfig = {}) {
  if (!waveDefinition || typeof waveDefinition !== "object") {
    return [];
  }
  const agents = Array.isArray(waveDefinition.agents) ? waveDefinition.agents : [];
  const contQaAgentId = laneConfig.contQaAgentId || "A0";
  const contEvalAgentId = laneConfig.contEvalAgentId || "E0";
  const integrationAgentId = laneConfig.integrationAgentId || "A8";
  const documentationAgentId = laneConfig.documentationAgentId || "A9";
  const waveNumber = typeof waveDefinition.wave === "number" ? waveDefinition.wave : 0;
  const lane = laneConfig.lane || "main";
  const seededAt = normalizeText(
    laneConfig.seededAt,
    normalizeText(waveDefinition.generatedAt, "1970-01-01T00:00:00.000Z"),
  );
  const tasks = [];

  for (const agent of agents) {
    const agentId = agent.agentId;
    const hybridDesignAgent = isImplementationOwningDesignAgent(agent);
    const baseTaskType =
      agentId === contQaAgentId
        ? "cont-qa"
        : agentId === contEvalAgentId
          ? "cont-eval"
          : agentId === integrationAgentId
            ? "integration"
            : agentId === documentationAgentId
              ? "documentation"
              : isDesignAgent(agent)
                ? "design"
                : isSecurityReviewAgent(agent)
                  ? "security"
                  : "implementation";
    const exitContract =
      agent.exitContract && typeof agent.exitContract === "object"
        ? { ...agent.exitContract }
        : null;
    const componentTargets =
      agent.componentTargets && typeof agent.componentTargets === "object"
        ? { ...agent.componentTargets }
        : {};

    // Build end-state proofRequirements object
    const proofLevel = exitContract?.proof || "unit";
    let proofCentric = false;
    let maturityTarget = null;
    if (baseTaskType === "implementation" || hybridDesignAgent) {
      if (Array.isArray(agent.deliverables) && agent.deliverables.length > 0) {
        proofCentric = true;
      }
      if (Object.keys(componentTargets).length > 0) {
        maturityTarget = "component";
      }
    }

    // Build deliverables in end-state shape: [{ path, exists, sha256 }]
    const deliverables = Array.isArray(agent.deliverables)
      ? agent.deliverables.map(normalizeDeliverable)
      : [];

    // Build proofArtifacts in existing shape
    const proofArtifacts = Array.isArray(agent.deliverables)
      ? agent.deliverables.map((deliverable) => ({
          path: typeof deliverable === "string" ? deliverable : deliverable?.path || "",
          kind: typeof deliverable === "object" ? deliverable?.kind || "file" : "file",
          requiredFor: typeof deliverable === "object" ? deliverable?.requiredFor || null : null,
        }))
      : [];

    // Components from componentTargets
    const components = deriveComponentsFromTargets(componentTargets);

    // Semantic task ID
    const scope = agent.title
      ? normalizeText(agent.title).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
      : "primary";
    const pushAgentTask = (taskType, taskScope, overrides = {}) => {
      tasks.push(
        normalizeTask(
          {
            taskId: buildSemanticTaskId(waveNumber, agentId, `${scope}-${taskScope}`),
            taskType,
            title: `${agentId}: ${agent.title || ""}`.trim(),
            detail: agent.detail || "",
            ownerAgentId: agentId,
            assigneeAgentId: agentId,
            waveNumber,
            lane,
            artifactContract: {
              deliverables,
              proofArtifacts,
              requiredPaths: normalizeStringArray(agent.ownedPaths || []),
              exitContract,
              componentTargets,
            },
            proofRequirements: {
              proofLevel,
              proofCentric,
              maturityTarget,
            },
            dependencyEdges: [],
            components,
            status: "pending",
            closureState: "open",
            priority: taskType === "implementation" ? "normal" : "high",
            ...overrides,
          },
          {
            createdAt: seededAt,
            updatedAt: seededAt,
            waveNumber,
            lane,
          },
        ),
      );
    };

    if (hybridDesignAgent && baseTaskType === "design") {
      pushAgentTask("design", "design");
      pushAgentTask("implementation", "implementation");
      continue;
    }

    pushAgentTask(baseTaskType, baseTaskType);
  }

  for (const promotion of waveDefinition.componentPromotions || []) {
    const semanticId = buildSemanticTaskId(waveNumber, "system", `promote-${promotion.componentId}`);
    tasks.push(
      normalizeTask(
        {
          taskId: semanticId,
          taskType: "component",
          title: `Promote ${promotion.componentId} to ${promotion.targetLevel}`,
          detail: "",
          ownerAgentId: null,
          waveNumber,
          lane,
          artifactContract: {
            deliverables: [],
            proofArtifacts: [],
            requiredPaths: [promotion.componentId],
            exitContract: null,
            componentTargets: { [promotion.componentId]: promotion.targetLevel },
          },
          proofRequirements: {
            proofLevel: "unit",
            proofCentric: false,
            maturityTarget: promotion.targetLevel,
          },
          dependencyEdges: [],
          components: [{ componentId: promotion.componentId, targetLevel: promotion.targetLevel }],
          status: "pending",
          closureState: "open",
          priority: "high",
        },
        {
          createdAt: seededAt,
          updatedAt: seededAt,
          waveNumber,
          lane,
        },
      ),
    );
  }

  return tasks;
}

export function buildTasksFromCoordinationState(coordinationState, feedbackRequests = []) {
  if (!coordinationState || typeof coordinationState !== "object") {
    return [];
  }
  const fallbackTimestamp = "1970-01-01T00:00:00.000Z";
  const tasks = [];

  for (const record of coordinationState.clarifications || []) {
    if (!coordinationRecordBlocksWave(record)) {
      continue;
    }
    const waveNumber = Number.isFinite(record.wave) ? record.wave : 0;
    const lane = normalizeText(record.lane) || null;
    const createdAt = normalizeText(record.createdAt, fallbackTimestamp);
    const updatedAt = normalizeText(record.updatedAt, createdAt);
    tasks.push(
      normalizeTask(
        {
          taskId: buildCoordinationTaskId({
            waveNumber,
            ownerAgentId: record.agentId,
            taskType: "clarification",
            sourceRecordId: record.id,
            title: record.summary || record.id,
            detail: record.detail || "",
          }),
          taskType: "clarification",
          title: `Clarification: ${record.summary || record.id}`,
          detail: record.detail || "",
          ownerAgentId: record.agentId || null,
          sourceRecordId: record.id || null,
          waveNumber,
          lane,
          closureState: "open",
          priority: record.priority || "normal",
          createdAt,
          updatedAt,
        },
        { createdAt, updatedAt, waveNumber, lane },
      ),
    );
  }

  for (const record of coordinationState.humanFeedback || []) {
    if (!coordinationRecordBlocksWave(record)) {
      continue;
    }
    const waveNumber = Number.isFinite(record.wave) ? record.wave : 0;
    const lane = normalizeText(record.lane) || null;
    const createdAt = normalizeText(record.createdAt, fallbackTimestamp);
    const updatedAt = normalizeText(record.updatedAt, createdAt);
    tasks.push(
      normalizeTask(
        {
          taskId: buildCoordinationTaskId({
            waveNumber,
            ownerAgentId: record.agentId,
            taskType: "human-input",
            sourceRecordId: record.id,
            title: record.summary || record.id,
            detail: record.detail || "",
          }),
          taskType: "human-input",
          title: `Human feedback: ${record.summary || record.id}`,
          detail: record.detail || "",
          ownerAgentId: record.agentId || null,
          sourceRecordId: record.id || null,
          waveNumber,
          lane,
          closureState: "open",
          priority: record.priority || "high",
          createdAt,
          updatedAt,
        },
        { createdAt, updatedAt, waveNumber, lane },
      ),
    );
  }

  for (const record of coordinationState.humanEscalations || []) {
    if (!coordinationRecordBlocksWave(record)) {
      continue;
    }
    const waveNumber = Number.isFinite(record.wave) ? record.wave : 0;
    const lane = normalizeText(record.lane) || null;
    const createdAt = normalizeText(record.createdAt, fallbackTimestamp);
    const updatedAt = normalizeText(record.updatedAt, createdAt);
    tasks.push(
      normalizeTask(
        {
          taskId: buildCoordinationTaskId({
            waveNumber,
            ownerAgentId: record.agentId,
            taskType: "escalation",
            sourceRecordId: record.id,
            title: record.summary || record.id,
            detail: record.detail || "",
          }),
          taskType: "escalation",
          title: `Escalation: ${record.summary || record.id}`,
          detail: record.detail || "",
          ownerAgentId: record.agentId || null,
          sourceRecordId: record.id || null,
          waveNumber,
          lane,
          closureState: "open",
          priority: "urgent",
          createdAt,
          updatedAt,
        },
        { createdAt, updatedAt, waveNumber, lane },
      ),
    );
  }

  for (const request of feedbackRequests || []) {
    if (!isOpenCoordinationStatus(request.status || "open")) {
      continue;
    }
    const waveNumber = Number.isFinite(request.wave) ? request.wave : 0;
    const lane = normalizeText(request.lane) || null;
    const createdAt = normalizeText(request.createdAt, fallbackTimestamp);
    const updatedAt = normalizeText(request.updatedAt, createdAt);
    tasks.push(
      normalizeTask(
        {
          taskId: buildCoordinationTaskId({
            waveNumber,
            ownerAgentId: request.agentId,
            taskType: "human-input",
            sourceRecordId: request.id,
            title: request.summary || request.id || "",
            detail: request.detail || "",
          }),
          taskType: "human-input",
          title: `Feedback request: ${request.summary || request.id || ""}`,
          detail: request.detail || "",
          ownerAgentId: request.agentId || null,
          sourceRecordId: request.id || null,
          waveNumber,
          lane,
          closureState: "open",
          priority: request.priority || "high",
          createdAt,
          updatedAt,
        },
        { createdAt, updatedAt, waveNumber, lane },
      ),
    );
  }

  return tasks;
}

export function mergeTaskSets(seedTasks, coordinationTasks) {
  const merged = [...(Array.isArray(seedTasks) ? seedTasks : [])];
  const existingSourceIds = new Set(
    merged.map((task) => task.sourceRecordId).filter(Boolean),
  );
  for (const task of Array.isArray(coordinationTasks) ? coordinationTasks : []) {
    if (task.sourceRecordId && existingSourceIds.has(task.sourceRecordId)) {
      continue;
    }
    merged.push(task);
    if (task.sourceRecordId) {
      existingSourceIds.add(task.sourceRecordId);
    }
  }
  return merged;
}

export function evaluateOwnedSliceProven(task, agentResult, proofBundles = []) {
  if (!task || !task.taskType) {
    return { proven: false, reason: "Invalid task" };
  }
  if (!agentResult) {
    return { proven: false, reason: "No agent result available" };
  }
  const agent = {
    agentId: task.assigneeAgentId || task.ownerAgentId,
    ownedPaths: task.artifactContract?.requiredPaths || [],
    deliverables: (task.artifactContract?.proofArtifacts || []).map((artifact) => artifact.path),
    exitContract: task.artifactContract?.exitContract || null,
    components: Object.keys(task.artifactContract?.componentTargets || {}),
    componentTargets: task.artifactContract?.componentTargets || {},
  };

  if (task.taskType === "implementation") {
    const validation = validateImplementationSummary(agent, agentResult);
    if (!validation.ok) {
      return { proven: false, reason: validation.detail || validation.statusCode };
    }
    const componentTargets = task.artifactContract?.componentTargets || {};
    const componentIds = Object.keys(componentTargets);
    if (componentIds.length > 0) {
      const componentMarkers = new Map(
        Array.isArray(agentResult?.components)
          ? agentResult.components.map((component) => [component.componentId, component])
          : [],
      );
      for (const componentId of componentIds) {
        const expectedLevel = componentTargets[componentId];
        const marker = componentMarkers.get(componentId);
        if (!marker || marker.state !== "met" || (expectedLevel && marker.level !== expectedLevel)) {
          return { proven: false, reason: `Component ${componentId} not proven at ${expectedLevel || "any level"}` };
        }
      }
    }
    return { proven: true, reason: "Exit contract satisfied" };
  }

  if (task.taskType === "design") {
    const validation = validateDesignSummary(agent, agentResult);
    return validation.ok
      ? { proven: true, reason: "Design packet satisfied" }
      : { proven: false, reason: validation.detail || validation.statusCode };
  }

  if (task.taskType === "component") {
    // Component promotion task: validate that all relevant owners have promoted
    const componentTargets = task.artifactContract?.componentTargets || {};
    const componentIds = Object.keys(componentTargets);
    if (componentIds.length === 0) {
      return { proven: false, reason: "No component targets declared" };
    }
    const componentMarkers = new Map(
      Array.isArray(agentResult?.components)
        ? agentResult.components.map((component) => [component.componentId, component])
        : [],
    );
    for (const componentId of componentIds) {
      const expectedLevel = componentTargets[componentId];
      const marker = componentMarkers.get(componentId);
      if (!marker || marker.state !== "met" || (expectedLevel && marker.level !== expectedLevel)) {
        return { proven: false, reason: `Component ${componentId} not promoted to ${expectedLevel || "target level"}` };
      }
    }
    return { proven: true, reason: "Component promotion validated" };
  }

  if (task.taskType === "cont-qa") {
    const validation = validateContQaSummary(agent, agentResult, { mode: "live" });
    return validation.ok
      ? { proven: true, reason: "Cont-QA satisfied" }
      : { proven: false, reason: validation.detail || validation.statusCode };
  }

  if (task.taskType === "cont-eval") {
    const evalValidation = validateContEvalSummary(agent, agentResult, { mode: "live" });
    if (!evalValidation.ok) {
      return { proven: false, reason: evalValidation.detail || evalValidation.statusCode };
    }
    // Differentiate: report-only vs implementation-owning cont-eval
    if (isContEvalReportOnlyAgent(agent, { contEvalAgentId: agent.agentId })) {
      return { proven: true, reason: "Cont-EVAL report-only satisfied" };
    }
    if (isContEvalImplementationOwningAgent(agent, { contEvalAgentId: agent.agentId })) {
      const implValidation = validateImplementationSummary(agent, agentResult);
      if (!implValidation.ok) {
        return { proven: false, reason: implValidation.detail || implValidation.statusCode };
      }
    }
    return { proven: true, reason: "Cont-EVAL satisfied" };
  }

  if (task.taskType === "documentation") {
    const validation = validateDocumentationClosureSummary(agent, agentResult, {
      allowFallbackOnEmptyRun: true,
    });
    if (validation.ok) {
      return { proven: true, reason: "Documentation closure satisfied" };
    }
    // Allow fallback-eligible empty runs to pass at the task level;
    // the gate engine will make the final call on whether surrounding
    // state justifies auto-closure.
    if (validation.eligibleForFallback) {
      return { proven: true, reason: "Documentation closure fallback (empty run, deferred to gate)" };
    }
    return { proven: false, reason: validation.detail || validation.statusCode };
  }

  if (task.taskType === "security") {
    const validation = validateSecuritySummary(agent, agentResult);
    return validation.ok
      ? { proven: true, reason: "Security review satisfied" }
      : { proven: false, reason: validation.detail || validation.statusCode };
  }

  if (task.taskType === "integration") {
    const validation = validateIntegrationSummary(agent, agentResult);
    return validation.ok
      ? { proven: true, reason: "Integration summary satisfied" }
      : { proven: false, reason: validation.detail || validation.statusCode };
  }

  return { proven: false, reason: `Unsupported task type: ${task.taskType}` };
}

export function evaluateWaveClosureReady(tasks, gateSnapshot) {
  if (!gateSnapshot || !gateSnapshot.overall) {
    return { ready: false, reason: "No gate snapshot available" };
  }
  if (!gateSnapshot.overall.ok) {
    return {
      ready: false,
      reason: `Gate ${gateSnapshot.overall.gate || "unknown"} failed: ${gateSnapshot.overall.detail || gateSnapshot.overall.statusCode}`,
    };
  }
  const openTasks = (tasks || []).filter(
    (task) => task.closureState === "open" || task.closureState === "owned_slice_proven",
  );
  if (openTasks.length > 0) {
    return {
      ready: false,
      reason: `${openTasks.length} task(s) are not yet closure-ready`,
    };
  }
  return { ready: true, reason: "All gates pass and all tasks are closure-ready" };
}
