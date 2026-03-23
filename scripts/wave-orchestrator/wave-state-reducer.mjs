import { materializeControlPlaneState } from "./control-plane.mjs";
import {
  buildCoordinationResponseMetrics,
  isOpenCoordinationStatus,
  materializeCoordinationState,
  openClarificationLinkedRequests,
} from "./coordination-store.mjs";
import {
  buildTasksFromWaveDefinition,
  buildTasksFromCoordinationState,
  mergeTaskSets,
  evaluateOwnedSliceProven,
} from "./task-entity.mjs";
import {
  buildGateSnapshotPure,
  readWaveImplementationGatePure,
  readWaveContQaGatePure,
  readWaveContEvalGatePure,
  readWaveComponentGatePure,
  readWaveComponentMatrixGatePure,
  readWaveDocumentationGatePure,
  readWaveSecurityGatePure,
  readWaveIntegrationGatePure,
  readWaveInfraGatePure,
} from "./launcher-gates.mjs";
import {
  validateImplementationSummary,
  validateContQaSummary,
  validateContEvalSummary,
  validateDocumentationClosureSummary,
  validateSecuritySummary,
  validateIntegrationSummary,
} from "./agent-state.mjs";
import {
  isSecurityReviewAgent,
  isContEvalImplementationOwningAgent,
} from "./role-helpers.mjs";

const REDUCER_VERSION = 1;

/**
 * Derive the wave phase from the current state.
 *
 * This reuses the same logic as ledger.mjs derivePhase, adapted for
 * the reducer's data structures.
 */
function derivePhase({
  tasks,
  gateSnapshot,
  coordinationState,
  dependencySnapshot,
}) {
  const blockers = (coordinationState?.blockers || []).filter(
    (record) =>
      isOpenCoordinationStatus(record.status) &&
      ["high", "urgent"].includes(record.priority),
  );
  if (blockers.length > 0) {
    return "blocked";
  }

  const openClarifications = (coordinationState?.clarifications || []).filter(
    (record) => isOpenCoordinationStatus(record.status),
  );
  const openClarificationRequests = openClarificationLinkedRequests(coordinationState);
  if (openClarifications.length > 0 || openClarificationRequests.length > 0) {
    return "clarifying";
  }

  const dependencyBlockers =
    (dependencySnapshot?.requiredInbound || []).length +
    (dependencySnapshot?.requiredOutbound || []).length;
  if (dependencyBlockers > 0) {
    return "blocked";
  }

  const blockingHelperTasks = (tasks || []).filter(
    (task) =>
      ["helper", "dependency"].includes(task.taskType) &&
      task.closureState === "open",
  );
  if (blockingHelperTasks.length > 0) {
    return "blocked";
  }

  if ((tasks || []).length === 0) {
    return "running";
  }

  const implementationTasks = (tasks || []).filter(
    (task) => task.taskType === "implementation",
  );
  const allImplementationProven = implementationTasks.every(
    (task) =>
      task.closureState === "owned_slice_proven" ||
      task.closureState === "wave_closure_ready" ||
      task.closureState === "closed",
  );
  if (!allImplementationProven && implementationTasks.length > 0) {
    return "running";
  }

  if (gateSnapshot?.contEvalGate && !gateSnapshot.contEvalGate.ok) {
    return "cont-eval";
  }
  if (gateSnapshot?.securityGate && !gateSnapshot.securityGate.ok) {
    return "security-review";
  }
  if (gateSnapshot?.integrationBarrier && !gateSnapshot.integrationBarrier.ok) {
    return "integrating";
  }
  if (gateSnapshot?.documentationGate && !gateSnapshot.documentationGate.ok) {
    return "docs-closure";
  }
  if (gateSnapshot?.contQaGate && !gateSnapshot.contQaGate.ok) {
    return "cont-qa-closure";
  }
  if (gateSnapshot?.overall?.ok) {
    return "completed";
  }

  return "running";
}

/**
 * Build proof availability per agent from agent results and tasks.
 */
function buildProofAvailability(tasks, agentResults, controlPlaneState) {
  const byAgentId = {};
  const agentTasks = new Map();

  for (const task of tasks || []) {
    const agentId = task.assigneeAgentId || task.ownerAgentId;
    if (!agentId) {
      continue;
    }
    if (!agentTasks.has(agentId)) {
      agentTasks.set(agentId, []);
    }
    agentTasks.get(agentId).push(task);
  }

  const activeProofBundles = controlPlaneState?.activeProofBundles || [];
  const proofBundlesByAgentId = new Map();
  for (const bundle of activeProofBundles) {
    const agentId = bundle.agentId || bundle.data?.agentId;
    if (!agentId) {
      continue;
    }
    if (!proofBundlesByAgentId.has(agentId)) {
      proofBundlesByAgentId.set(agentId, []);
    }
    proofBundlesByAgentId.get(agentId).push(bundle);
  }

  for (const [agentId, agentTaskList] of agentTasks) {
    const result = agentResults?.[agentId] || null;
    const proofBundleIds = (proofBundlesByAgentId.get(agentId) || []).map(
      (bundle) => bundle.id,
    );
    let ownedSliceProven = true;
    let exitContractMet = true;
    let deliverablesMet = true;
    let componentsMet = true;
    let proofArtifactsMet = true;

    for (const task of agentTaskList) {
      const evaluation = evaluateOwnedSliceProven(task, result);
      if (!evaluation.proven) {
        ownedSliceProven = false;
      }
      if (
        task.proofRequirements?.includes("implementation-exit-met") &&
        !evaluation.proven
      ) {
        exitContractMet = false;
      }
      if (
        task.proofRequirements?.includes("component-level-met") &&
        !evaluation.proven
      ) {
        componentsMet = false;
      }
      if (
        task.proofRequirements?.includes("proof-artifacts-present") &&
        !evaluation.proven
      ) {
        proofArtifactsMet = false;
        deliverablesMet = false;
      }
    }

    byAgentId[agentId] = {
      ownedSliceProven,
      exitContractMet,
      deliverablesMet,
      componentsMet,
      proofArtifactsMet,
      proofBundleIds,
    };
  }

  const allOwnedSlicesProven = Object.values(byAgentId).every(
    (entry) => entry.ownedSliceProven,
  );

  return {
    byAgentId,
    allOwnedSlicesProven,
    activeProofBundles,
  };
}

/**
 * Derive open blockers from coordination state and gate snapshot.
 */
function deriveOpenBlockers(coordinationState, gateSnapshot) {
  const blockers = [];

  for (const record of coordinationState?.blockers || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    blockers.push({
      kind: "coordination-blocker",
      id: record.id,
      detail: record.summary || record.detail || "",
      blockedAgentIds: record.targets || [],
      resolutionHint: record.resolutionHint || null,
    });
  }

  for (const record of coordinationState?.clarifications || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    blockers.push({
      kind: "clarification",
      id: record.id,
      detail: record.summary || record.detail || "",
      blockedAgentIds: record.targets || [],
      resolutionHint: "Resolve clarification before proceeding.",
    });
  }

  for (const record of coordinationState?.humanEscalations || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    blockers.push({
      kind: "human-escalation",
      id: record.id,
      detail: record.summary || record.detail || "",
      blockedAgentIds: record.targets || [],
      resolutionHint: "Human intervention required.",
    });
  }

  for (const record of coordinationState?.humanFeedback || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    blockers.push({
      kind: "human-feedback",
      id: record.id,
      detail: record.summary || record.detail || "",
      blockedAgentIds: record.targets || [],
      resolutionHint: "Awaiting human feedback.",
    });
  }

  if (gateSnapshot) {
    for (const [gateName, gate] of Object.entries(gateSnapshot)) {
      if (gateName === "overall" || !gate || gate.ok !== false) {
        continue;
      }
      blockers.push({
        kind: "gate-failure",
        id: gateName,
        detail: gate.detail || gate.statusCode || "",
        blockedAgentIds: gate.agentId ? [gate.agentId] : [],
        resolutionHint: `Gate ${gateName} must pass before wave closure.`,
      });
    }
  }

  return blockers;
}

/**
 * Derive retry target set from gate snapshot and proof availability.
 */
function deriveRetryTargetSet(gateSnapshot, proofAvailability) {
  const failedAgentIds = [];
  let reason = "";

  for (const [agentId, entry] of Object.entries(proofAvailability.byAgentId || {})) {
    if (!entry.ownedSliceProven) {
      failedAgentIds.push(agentId);
    }
  }

  if (failedAgentIds.length > 0) {
    reason = `Agent(s) ${failedAgentIds.join(", ")} did not prove their owned slices.`;
  }

  return {
    agentIds: failedAgentIds,
    reason,
    retryOverride: null,
  };
}

/**
 * Derive closure eligibility from gate snapshot and tasks.
 */
function deriveClosureEligibility(gateSnapshot, tasks, proofAvailability) {
  const allGatesPass = gateSnapshot?.overall?.ok === true;
  const allTasksClosed = (tasks || []).every(
    (task) =>
      task.closureState === "closed" ||
      task.closureState === "cancelled" ||
      task.closureState === "superseded",
  );
  const allTasksClosureReady = (tasks || []).every(
    (task) =>
      task.closureState === "wave_closure_ready" ||
      task.closureState === "closed" ||
      task.closureState === "cancelled" ||
      task.closureState === "superseded",
  );
  const waveMayClose = allGatesPass && (allTasksClosed || allTasksClosureReady);

  const ownedSliceProvenAgentIds = [];
  const pendingAgentIds = [];
  for (const [agentId, entry] of Object.entries(proofAvailability.byAgentId || {})) {
    if (entry.ownedSliceProven) {
      ownedSliceProvenAgentIds.push(agentId);
    } else {
      pendingAgentIds.push(agentId);
    }
  }

  return {
    allGatesPass,
    allTasksClosed,
    waveMayClose,
    ownedSliceProvenAgentIds,
    pendingAgentIds,
  };
}

/**
 * Mark tasks with updated closure states based on proof availability.
 */
function applyProofAvailabilityToTasks(tasks, proofAvailability) {
  return (tasks || []).map((task) => {
    const agentId = task.assigneeAgentId || task.ownerAgentId;
    if (!agentId) {
      return task;
    }
    const entry = proofAvailability.byAgentId?.[agentId];
    if (!entry) {
      return task;
    }
    if (task.closureState === "open" && entry.ownedSliceProven) {
      return { ...task, closureState: "owned_slice_proven" };
    }
    return task;
  });
}

/**
 * reduceWaveState - Pure reducer function.
 *
 * Takes pre-read inputs and produces a complete WaveState snapshot.
 * No file I/O.
 */
export function reduceWaveState({
  controlPlaneEvents = [],
  coordinationRecords = [],
  agentResults = {},
  waveDefinition = null,
  dependencyTickets = null,
  feedbackRequests = [],
  laneConfig = {},
}) {
  // Step 1: Materialize control-plane state
  const controlPlaneState = materializeControlPlaneState(controlPlaneEvents);

  // Step 2: Materialize coordination state
  const coordinationState = materializeCoordinationState(coordinationRecords);

  // Step 3: Build tasks
  const seedTasks = buildTasksFromWaveDefinition(waveDefinition, laneConfig);
  const coordinationTasks = buildTasksFromCoordinationState(
    coordinationState,
    feedbackRequests,
  );
  let tasks = mergeTaskSets(seedTasks, coordinationTasks);

  // Step 4: Evaluate proof availability per agent
  const proofAvailability = buildProofAvailability(
    tasks,
    agentResults,
    controlPlaneState,
  );

  // Apply proof state to tasks (auto-transition from open -> owned_slice_proven)
  tasks = applyProofAvailabilityToTasks(tasks, proofAvailability);

  // Step 5: Build derived state for barriers
  const clarificationBarrier = (() => {
    const openClarifications = (coordinationState?.clarifications || []).filter(
      (record) => isOpenCoordinationStatus(record.status),
    );
    if (openClarifications.length > 0) {
      return {
        ok: false,
        statusCode: "clarification-open",
        detail: `Open clarifications remain (${openClarifications.map((record) => record.id).join(", ")}).`,
      };
    }
    const openClarificationReqs = openClarificationLinkedRequests(coordinationState);
    if (openClarificationReqs.length > 0) {
      return {
        ok: false,
        statusCode: "clarification-follow-up-open",
        detail: `Clarification follow-up requests remain open (${openClarificationReqs.map((record) => record.id).join(", ")}).`,
      };
    }
    const pendingHuman = [
      ...(coordinationState?.humanEscalations || []).filter((record) =>
        isOpenCoordinationStatus(record.status),
      ),
      ...(coordinationState?.humanFeedback || []).filter((record) =>
        isOpenCoordinationStatus(record.status),
      ),
    ];
    if (pendingHuman.length > 0) {
      return {
        ok: false,
        statusCode: "human-feedback-open",
        detail: `Pending human input remains (${pendingHuman.map((record) => record.id).join(", ")}).`,
      };
    }
    return { ok: true, statusCode: "pass", detail: "" };
  })();

  const helperAssignmentBarrier = { ok: true, statusCode: "pass", detail: "" };
  const dependencyBarrier = (() => {
    if (!dependencyTickets) {
      return { ok: true, statusCode: "pass", detail: "" };
    }
    const requiredInbound = dependencyTickets.requiredInbound || [];
    const requiredOutbound = dependencyTickets.requiredOutbound || [];
    const unresolvedInboundAssignments =
      dependencyTickets.unresolvedInboundAssignments || [];
    if (unresolvedInboundAssignments.length > 0) {
      return {
        ok: false,
        statusCode: "dependency-assignment-unresolved",
        detail: `Required inbound dependencies are unassigned (${unresolvedInboundAssignments.map((record) => record.id).join(", ")}).`,
      };
    }
    if (requiredInbound.length > 0 || requiredOutbound.length > 0) {
      return {
        ok: false,
        statusCode: "dependency-open",
        detail: `Open required dependencies remain (${[...requiredInbound, ...requiredOutbound].map((record) => record.id).join(", ")}).`,
      };
    }
    return { ok: true, statusCode: "pass", detail: "" };
  })();

  const derivedState = {
    clarificationBarrier,
    helperAssignmentBarrier,
    dependencyBarrier,
    integrationSummary: null,
    coordinationState,
    dependencySnapshot: dependencyTickets,
  };

  // Try to derive integration summary from agent results
  const integrationAgentId = laneConfig.integrationAgentId || "A8";
  const integrationSummary = agentResults?.[integrationAgentId]?.integration || null;
  if (integrationSummary) {
    derivedState.integrationSummary = {
      recommendation: integrationSummary.state === "ready-for-doc-closure"
        ? "ready-for-doc-closure"
        : integrationSummary.state || "needs-more-work",
      detail: integrationSummary.detail || null,
    };
  }

  // Step 5: Evaluate gates using pure variants
  const gateSnapshot = buildGateSnapshotPure({
    wave: waveDefinition || { wave: 0, agents: [] },
    agentResults,
    derivedState,
    validationMode: laneConfig.validationMode || "live",
    laneConfig,
  });

  // Step 6: Derive open blockers
  const openBlockers = deriveOpenBlockers(coordinationState, gateSnapshot);

  // Step 7: Derive retry target set
  const retryTargetSet = deriveRetryTargetSet(gateSnapshot, proofAvailability);

  // Step 8: Derive closure eligibility
  const closureEligibility = deriveClosureEligibility(
    gateSnapshot,
    tasks,
    proofAvailability,
  );

  // Step 9: Derive phase
  const phase = derivePhase({
    tasks,
    gateSnapshot,
    coordinationState,
    dependencySnapshot: dependencyTickets,
  });

  // Build coordination metrics
  const coordinationMetrics = buildCoordinationResponseMetrics(coordinationState);

  // Build tasksByAgentId
  const tasksByAgentId = {};
  for (const task of tasks) {
    const agentId = task.assigneeAgentId || task.ownerAgentId;
    if (!agentId) {
      continue;
    }
    if (!tasksByAgentId[agentId]) {
      tasksByAgentId[agentId] = [];
    }
    tasksByAgentId[agentId].push(task);
  }

  return {
    reducerVersion: REDUCER_VERSION,
    wave: waveDefinition?.wave ?? 0,
    lane: laneConfig.lane || "main",
    attempt: controlPlaneState?.activeAttempt?.attempt ?? 0,
    phase,

    tasks,
    tasksByAgentId,

    proofAvailability,

    openBlockers,

    gateSnapshot,

    retryTargetSet,

    closureEligibility,

    coordinationMetrics,
    controlPlaneState,
  };
}
