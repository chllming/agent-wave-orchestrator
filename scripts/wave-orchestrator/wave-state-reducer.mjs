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
import { buildHumanInputRequests } from "./human-input-workflow.mjs";

const REDUCER_VERSION = 2;

/**
 * Detect contradictions from control-plane events.
 * Returns a Map<contradictionId, contradiction>.
 */
function detectContradictions(controlPlaneState) {
  const contradictions = new Map();
  if (!controlPlaneState?.events) {
    return contradictions;
  }
  for (const event of controlPlaneState.events) {
    if (event.entityType !== "contradiction") {
      continue;
    }
    const existing = contradictions.get(event.entityId) || {};
    const data = event.data || {};
    contradictions.set(event.entityId, {
      contradictionId: event.entityId,
      waveNumber: event.wave ?? null,
      lane: event.lane || null,
      kind: data.kind || existing.kind || "claim_conflict",
      status: data.status || existing.status || "detected",
      reportedBy: data.reportedBy || existing.reportedBy || "system",
      reportedAt: data.reportedAt || existing.reportedAt || event.recordedAt,
      resolvedBy: data.resolvedBy || existing.resolvedBy || null,
      resolvedAt: data.resolvedAt || existing.resolvedAt || null,
      parties: data.parties || existing.parties || [],
      affectedTasks: data.affectedTasks || existing.affectedTasks || [],
      affectedFacts: data.affectedFacts || existing.affectedFacts || [],
      repairWork: data.repairWork || existing.repairWork || null,
      resolution: data.resolution || existing.resolution || null,
      supersedes: data.supersedes || existing.supersedes || null,
    });
  }
  return contradictions;
}

/**
 * Build fact lineage from control-plane events.
 * Returns a Map<factId, fact>.
 */
function buildFactLineage(controlPlaneState) {
  const facts = new Map();
  if (!controlPlaneState?.events) {
    return facts;
  }
  for (const event of controlPlaneState.events) {
    if (event.entityType !== "fact") {
      continue;
    }
    const existing = facts.get(event.entityId) || {};
    const data = event.data || {};
    facts.set(event.entityId, {
      factId: event.entityId,
      contentHash: data.contentHash || existing.contentHash || null,
      version: data.version || existing.version || 1,
      waveNumber: event.wave ?? null,
      lane: event.lane || null,
      introducedBy: data.introducedBy || existing.introducedBy || null,
      introducedAt: data.introducedAt || existing.introducedAt || event.recordedAt,
      kind: data.kind || existing.kind || "claim",
      content: data.content || existing.content || "",
      sourceArtifact: data.sourceArtifact || existing.sourceArtifact || null,
      citedBy: data.citedBy || existing.citedBy || [],
      contradictedBy: data.contradictedBy || existing.contradictedBy || [],
      supersedes: data.supersedes || existing.supersedes || null,
      supersededBy: data.supersededBy || existing.supersededBy || null,
      status: data.status || existing.status || "active",
    });
  }
  return facts;
}

/**
 * Build task graph DAG from task dependency edges.
 * Returns { nodes: [taskId], edges: [{ from, to, kind }] }
 */
function buildTaskGraph(tasks) {
  const nodes = [];
  const edges = [];
  for (const task of tasks || []) {
    nodes.push(task.taskId);
    for (const edge of task.dependencyEdges || []) {
      if (edge.taskId) {
        edges.push({
          from: task.taskId,
          to: edge.taskId,
          kind: edge.kind || "blocks",
        });
      }
    }
  }
  return { nodes, edges };
}

/**
 * Build assignments Map from coordination state.
 */
function buildAssignments(coordinationState) {
  const assignments = new Map();
  const requests = coordinationState?.requests || [];
  for (const record of requests) {
    if (!record.id) continue;
    if (record.assignedAgentId || record.targets?.length > 0) {
      assignments.set(record.id, {
        requestId: record.id,
        assignedAgentId: record.assignedAgentId || record.targets?.[0] || null,
        status: record.status || "open",
        summary: record.summary || "",
      });
    }
  }
  return assignments;
}

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
 * Map waveState from phase for end-state output.
 */
function deriveWaveState(phase) {
  if (phase === "completed") return "completed";
  if (phase === "blocked") return "blocked";
  if (phase === "clarifying") return "blocked";
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
      // End-state proofRequirements is an object: { proofLevel, proofCentric, maturityTarget }
      const pr = task.proofRequirements;
      if (pr && typeof pr === "object" && !Array.isArray(pr)) {
        if (!evaluation.proven) {
          exitContractMet = false;
          if (pr.maturityTarget) {
            componentsMet = false;
          }
          if (pr.proofCentric) {
            proofArtifactsMet = false;
            deliverablesMet = false;
          }
        }
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
 * Includes both agents with unproven slices AND agents identified by failed gates.
 */
function deriveRetryTargetSet(gateSnapshot, proofAvailability) {
  const failedAgentIds = new Set();
  const reasons = [];

  // Include agents with unproven slices
  for (const [agentId, entry] of Object.entries(proofAvailability.byAgentId || {})) {
    if (!entry.ownedSliceProven) {
      failedAgentIds.add(agentId);
    }
  }

  if (failedAgentIds.size > 0) {
    reasons.push(`Agent(s) ${[...failedAgentIds].join(", ")} did not prove their owned slices.`);
  }

  // Include agents identified by failed gates
  if (gateSnapshot) {
    for (const [gateName, gate] of Object.entries(gateSnapshot)) {
      if (gateName === "overall" || !gate || gate.ok !== false) {
        continue;
      }
      if (gate.agentId && !failedAgentIds.has(gate.agentId)) {
        failedAgentIds.add(gate.agentId);
        reasons.push(`Agent ${gate.agentId} identified by failed gate ${gateName}.`);
      }
    }
  }

  return {
    agentIds: [...failedAgentIds],
    reason: reasons.join(" "),
    retryOverride: null,
  };
}

/**
 * Derive closure eligibility from gate snapshot and tasks.
 * Includes proofBundles so buildResumePlan can access them.
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
    proofBundles: proofAvailability.activeProofBundles || [],
  };
}

/**
 * Mark tasks with updated closure states based on proof availability.
 * Supports bidirectional: open -> owned_slice_proven when proved,
 * and owned_slice_proven -> open when proof is invalidated.
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
    // Forward: open -> owned_slice_proven when proven
    if (task.closureState === "open" && entry.ownedSliceProven) {
      return { ...task, closureState: "owned_slice_proven", status: "proven" };
    }
    // Bidirectional: owned_slice_proven -> open when proof is invalidated
    if (task.closureState === "owned_slice_proven" && !entry.ownedSliceProven) {
      return { ...task, closureState: "open", status: "in_progress" };
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

  // Apply proof state to tasks (bidirectional transitions)
  tasks = applyProofAvailabilityToTasks(tasks, proofAvailability);

  // Step 5: Build integration summary BEFORE creating derivedState for gates
  const integrationAgentId = laneConfig.integrationAgentId || "A8";
  const integrationResult = agentResults?.[integrationAgentId]?.integration || null;
  const integrationSummary = integrationResult
    ? {
        recommendation: integrationResult.state === "ready-for-doc-closure"
          ? "ready-for-doc-closure"
          : integrationResult.state || "needs-more-work",
        detail: integrationResult.detail || null,
      }
    : null;

  // Step 6: Build derived state for barriers (with integrationSummary already computed)
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
    integrationSummary,
    coordinationState,
    dependencySnapshot: dependencyTickets,
  };

  // Step 7: Evaluate gates using pure variants (integrationSummary already in derivedState)
  const gateSnapshot = buildGateSnapshotPure({
    wave: waveDefinition || { wave: 0, agents: [] },
    agentResults,
    derivedState,
    validationMode: laneConfig.validationMode || "live",
    laneConfig,
  });

  // Step 8: Derive open blockers
  const openBlockers = deriveOpenBlockers(coordinationState, gateSnapshot);

  // Step 9: Derive retry target set (includes gate-identified agents)
  const retryTargetSet = deriveRetryTargetSet(gateSnapshot, proofAvailability);

  // Step 10: Derive closure eligibility (with proofBundles for buildResumePlan)
  const closureEligibility = deriveClosureEligibility(
    gateSnapshot,
    tasks,
    proofAvailability,
  );

  // Step 11: Derive phase
  const phase = derivePhase({
    tasks,
    gateSnapshot,
    coordinationState,
    dependencySnapshot: dependencyTickets,
  });

  // Step 12: Derive waveState from phase
  const waveState = deriveWaveState(phase);

  // Step 13: Build contradictions and facts from control-plane events
  const contradictions = detectContradictions(controlPlaneState);
  const facts = buildFactLineage(controlPlaneState);

  // Step 14: Build human inputs from coordination state and feedback requests
  const humanInputs = new Map();
  const humanInputList = buildHumanInputRequests(coordinationState, feedbackRequests);
  for (const input of humanInputList) {
    if (input.requestId) {
      humanInputs.set(input.requestId, input);
    }
  }

  // Step 15: Build task graph DAG
  const taskGraph = buildTaskGraph(tasks);

  // Step 16: Build assignments
  const assignments = buildAssignments(coordinationState);

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
    waveState,

    tasks,
    tasksByAgentId,
    taskGraph,

    proofAvailability,

    openBlockers,

    // Renamed: gateSnapshot -> gateVerdicts (end-state P1-9), keep gateSnapshot for backward compat
    gateSnapshot,
    gateVerdicts: gateSnapshot,

    retryTargetSet,

    closureEligibility,

    contradictions,
    facts,
    humanInputs,
    assignments,

    coordinationMetrics,
    controlPlaneState,
  };
}
