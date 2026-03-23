import crypto from "node:crypto";
import { toIsoTimestamp } from "./shared.mjs";
import {
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
  isSecurityReviewAgent,
} from "./role-helpers.mjs";
import {
  isOpenCoordinationStatus,
  openClarificationLinkedRequests,
} from "./coordination-store.mjs";

export const TASK_TYPES = new Set([
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

const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const CLOSURE_TRANSITIONS = {
  open: new Set(["owned_slice_proven", "cancelled", "superseded"]),
  owned_slice_proven: new Set(["wave_closure_ready", "cancelled", "superseded"]),
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
  const now = toIsoTimestamp();
  const artifactContract = normalizePlainObject(rawTask.artifactContract) || {
    requiredPaths: [],
    proofArtifacts: [],
    exitContract: null,
    componentTargets: {},
  };
  if (!Array.isArray(artifactContract.requiredPaths)) {
    artifactContract.requiredPaths = [];
  }
  if (!Array.isArray(artifactContract.proofArtifacts)) {
    artifactContract.proofArtifacts = [];
  }
  if (!artifactContract.exitContract || typeof artifactContract.exitContract !== "object") {
    artifactContract.exitContract = null;
  }
  if (!artifactContract.componentTargets || typeof artifactContract.componentTargets !== "object" || Array.isArray(artifactContract.componentTargets)) {
    artifactContract.componentTargets = {};
  }

  return {
    taskId,
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
    proofRequirements: normalizeStringArray(rawTask.proofRequirements || defaults.proofRequirements || []),
    dependencyEdges: Array.isArray(rawTask.dependencyEdges)
      ? rawTask.dependencyEdges.map((edge) => ({
          targetTaskId: normalizeText(edge.targetTaskId),
          kind: normalizeText(edge.kind, "blocks"),
        }))
      : [],
    closureState,
    sourceRecordId: normalizeText(rawTask.sourceRecordId) || defaults.sourceRecordId || null,
    priority,
    createdAt: normalizeText(rawTask.createdAt) || defaults.createdAt || now,
    updatedAt: normalizeText(rawTask.updatedAt) || now,
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
  const now = toIsoTimestamp();
  const tasks = [];

  for (const agent of agents) {
    const agentId = agent.agentId;
    const taskType =
      agentId === contQaAgentId
        ? "cont-qa"
        : agentId === contEvalAgentId
          ? "cont-eval"
          : agentId === integrationAgentId
            ? "integration"
            : agentId === documentationAgentId
              ? "documentation"
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
    const proofRequirements = [];
    if (taskType === "implementation") {
      proofRequirements.push("implementation-exit-met");
      if (Object.keys(componentTargets).length > 0) {
        proofRequirements.push("component-level-met");
      }
      if (Array.isArray(agent.deliverables) && agent.deliverables.length > 0) {
        proofRequirements.push("proof-artifacts-present");
      }
    }
    tasks.push(
      normalizeTask(
        {
          taskType,
          title: `${agentId}: ${agent.title || ""}`.trim(),
          detail: agent.detail || "",
          ownerAgentId: agentId,
          assigneeAgentId: agentId,
          artifactContract: {
            requiredPaths: normalizeStringArray(agent.ownedPaths || []),
            proofArtifacts: Array.isArray(agent.deliverables)
              ? agent.deliverables.map((deliverable) => ({
                  path: typeof deliverable === "string" ? deliverable : deliverable?.path || "",
                  kind: typeof deliverable === "object" ? deliverable?.kind || "file" : "file",
                  requiredFor: typeof deliverable === "object" ? deliverable?.requiredFor || null : null,
                }))
              : [],
            exitContract,
            componentTargets,
          },
          proofRequirements,
          closureState: "open",
          priority:
            taskType === "implementation"
              ? "normal"
              : "high",
        },
        { createdAt: now },
      ),
    );
  }

  for (const promotion of waveDefinition.componentPromotions || []) {
    tasks.push(
      normalizeTask(
        {
          taskType: "component",
          title: `Promote ${promotion.componentId} to ${promotion.targetLevel}`,
          detail: "",
          ownerAgentId: null,
          artifactContract: {
            requiredPaths: [promotion.componentId],
            proofArtifacts: [],
            exitContract: null,
            componentTargets: { [promotion.componentId]: promotion.targetLevel },
          },
          proofRequirements: ["component-level-met"],
          closureState: "open",
          priority: "high",
        },
        { createdAt: now },
      ),
    );
  }

  return tasks;
}

export function buildTasksFromCoordinationState(coordinationState, feedbackRequests = []) {
  if (!coordinationState || typeof coordinationState !== "object") {
    return [];
  }
  const now = toIsoTimestamp();
  const tasks = [];

  for (const record of coordinationState.clarifications || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    tasks.push(
      normalizeTask(
        {
          taskType: "clarification",
          title: `Clarification: ${record.summary || record.id}`,
          detail: record.detail || "",
          ownerAgentId: record.agentId || null,
          sourceRecordId: record.id || null,
          closureState: "open",
          priority: record.priority || "normal",
        },
        { createdAt: now },
      ),
    );
  }

  for (const record of coordinationState.humanFeedback || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    tasks.push(
      normalizeTask(
        {
          taskType: "human-input",
          title: `Human feedback: ${record.summary || record.id}`,
          detail: record.detail || "",
          ownerAgentId: record.agentId || null,
          sourceRecordId: record.id || null,
          closureState: "open",
          priority: record.priority || "high",
        },
        { createdAt: now },
      ),
    );
  }

  for (const record of coordinationState.humanEscalations || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    tasks.push(
      normalizeTask(
        {
          taskType: "escalation",
          title: `Escalation: ${record.summary || record.id}`,
          detail: record.detail || "",
          ownerAgentId: record.agentId || null,
          sourceRecordId: record.id || null,
          closureState: "open",
          priority: "urgent",
        },
        { createdAt: now },
      ),
    );
  }

  for (const request of feedbackRequests || []) {
    if (!isOpenCoordinationStatus(request.status || "open")) {
      continue;
    }
    tasks.push(
      normalizeTask(
        {
          taskType: "human-input",
          title: `Feedback request: ${request.summary || request.id || ""}`,
          detail: request.detail || "",
          ownerAgentId: request.agentId || null,
          sourceRecordId: request.id || null,
          closureState: "open",
          priority: request.priority || "high",
        },
        { createdAt: now },
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
    if (isContEvalImplementationOwningAgent(agent, { contEvalAgentId: agent.agentId })) {
      const implValidation = validateImplementationSummary(agent, agentResult);
      if (!implValidation.ok) {
        return { proven: false, reason: implValidation.detail || implValidation.statusCode };
      }
    }
    return { proven: true, reason: "Cont-EVAL satisfied" };
  }

  if (task.taskType === "documentation") {
    const validation = validateDocumentationClosureSummary(agent, agentResult);
    return validation.ok
      ? { proven: true, reason: "Documentation closure satisfied" }
      : { proven: false, reason: validation.detail || validation.statusCode };
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
