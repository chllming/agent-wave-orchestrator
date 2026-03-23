import fs from "node:fs";
import path from "node:path";
import { appendCoordinationRecord, clarificationClosureCondition, clarificationLinkedRequests, isOpenCoordinationStatus, readMaterializedCoordinationState, updateSeedRecords } from "./coordination-store.mjs";
import { answerFeedbackRequest, createFeedbackRequest } from "./feedback.mjs";
import { readWaveHumanFeedbackRequests } from "./coordination.mjs";
import { readWaveLedger } from "./ledger.mjs";
import { buildDependencySnapshot, buildRequestAssignments } from "./routing-state.mjs";
import { parseWaveFiles } from "./wave-files.mjs";
import {
  buildLanePaths,
  DEFAULT_COORDINATION_ACK_TIMEOUT_MS,
  DEFAULT_COORDINATION_RESOLUTION_STALE_MS,
  ensureDirectory,
  parseNonNegativeInt,
  readJsonOrNull,
  readStatusRecordIfPresent,
  REPO_ROOT,
  sanitizeAdhocRunId,
  sanitizeLaneName,
} from "./shared.mjs";
import {
  appendWaveControlEvent,
  buildTaskSnapshots,
  nextTaskDeadline,
  readWaveControlPlaneState,
  syncWaveControlPlaneProjections,
} from "./control-plane.mjs";
import {
  augmentSummaryWithProofRegistry,
  readWaveProofRegistry,
  registerWaveProofBundle,
  waveProofRegistryPath,
} from "./proof-registry.mjs";
import { readWaveRelaunchPlanSnapshot, readWaveRetryOverride, resolveRetryOverrideAgentIds, writeWaveRetryOverride, clearWaveRetryOverride } from "./retry-control.mjs";
import { flushWaveControlQueue, readWaveControlQueueState } from "./wave-control-client.mjs";
import { readAgentExecutionSummary, validateImplementationSummary } from "./agent-state.mjs";
import { isContEvalReportOnlyAgent, isSecurityReviewAgent } from "./role-helpers.mjs";

function printUsage() {
  console.log(`Usage:
  wave control status --lane <lane> --wave <n> [--agent <id>] [--json]
  wave control telemetry status --lane <lane> [--run <id>] [--json]
  wave control telemetry flush --lane <lane> [--run <id>] [--json]

  wave control task create --lane <lane> --wave <n> --agent <id> --kind <request|blocker|clarification|handoff|evidence|claim|decision|human-input> --summary <text> [options]
  wave control task list --lane <lane> --wave <n> [--agent <id>] [--json]
  wave control task get --lane <lane> --wave <n> --id <task-id> [--json]
  wave control task act <start|resolve|dismiss|cancel|reassign|answer|escalate> --lane <lane> --wave <n> --id <task-id> [options]

  wave control rerun request --lane <lane> --wave <n> [--agent <id> ...] [--resume-cursor <cursor>] [--reuse-attempt <id> ...] [--reuse-proof <id> ...] [--reuse-derived-summaries <true|false>] [--invalidate-component <id> ...] [--clear-reuse <id> ...] [--preserve-reuse <id> ...] [--requested-by <name>] [--reason <text>] [--json]
  wave control rerun get --lane <lane> --wave <n> [--json]
  wave control rerun clear --lane <lane> --wave <n>

  wave control proof register --lane <lane> --wave <n> --agent <id> --artifact <path> [--artifact <path> ...] [--component <id[:level]> ...] [--authoritative] [--satisfy-owned-components] [--completion <level>] [--durability <level>] [--proof-level <level>] [--doc-delta <state>] [--operator <name>] [--detail <text>] [--json]
  wave control proof get --lane <lane> --wave <n> [--agent <id>] [--id <bundle-id>] [--json]
  wave control proof supersede --lane <lane> --wave <n> --id <bundle-id> --agent <id> --artifact <path> [--artifact <path> ...] [options]
  wave control proof revoke --lane <lane> --wave <n> --id <bundle-id> [--operator <name>] [--detail <text>] [--json]
`);
}

function normalizeBooleanish(value, fallback = true) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Expected boolean value, got: ${value}`);
}

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const surface = String(args[0] || "").trim().toLowerCase();
  const operation = String(args[1] || "").trim().toLowerCase();
  const action = String(args[2] || "").trim().toLowerCase();
  const options = {
    lane: "main",
    wave: null,
    runId: "",
    dryRun: false,
    json: false,
    agent: "",
    kind: "",
    summary: "",
    detail: "",
    targets: [],
    priority: "normal",
    dependsOn: [],
    artifactRefs: [],
    status: "open",
    id: "",
    to: "",
    response: "",
    operator: "human-operator",
    selectedAgentIds: [],
    reuseAttemptIds: [],
    reuseProofBundleIds: [],
    invalidateComponentIds: [],
    clearReusableAgentIds: [],
    preserveReusableAgentIds: [],
    requestedBy: "",
    reason: "",
    resumeCursor: "",
    reuseDerivedSummaries: true,
    componentIds: [],
    authoritative: false,
    satisfyOwnedComponents: false,
    completion: "",
    durability: "",
    proofLevel: "",
    docDeltaState: "",
  };
  const startIndex =
    surface === "status"
      ? 1
      : surface === "telemetry"
        ? 2
        : surface === "task" || surface === "rerun" || surface === "proof"
          ? operation === "act"
            ? 3
            : 2
          : 0;
  for (let i = startIndex; i < args.length; i += 1) {
    const arg = args[i];
    if (i < startIndex) {
      continue;
    }
    if (arg === "--lane") {
      options.lane = sanitizeLaneName(args[++i]);
    } else if (arg === "--run") {
      options.runId = sanitizeAdhocRunId(args[++i]);
    } else if (arg === "--wave") {
      options.wave = parseNonNegativeInt(args[++i], "--wave");
    } else if (arg === "--agent" || arg === "--agents") {
      options.selectedAgentIds.push(String(args[++i] || "").trim());
      if (!options.agent) {
        options.agent = options.selectedAgentIds.at(-1) || "";
      }
    } else if (arg === "--kind") {
      options.kind = String(args[++i] || "").trim();
    } else if (arg === "--summary") {
      options.summary = String(args[++i] || "").trim();
    } else if (arg === "--detail") {
      options.detail = String(args[++i] || "").trim();
    } else if (arg === "--target") {
      options.targets.push(String(args[++i] || "").trim());
    } else if (arg === "--priority") {
      options.priority = String(args[++i] || "").trim();
    } else if (arg === "--depends-on") {
      options.dependsOn.push(String(args[++i] || "").trim());
    } else if (arg === "--artifact") {
      options.artifactRefs.push(String(args[++i] || "").trim());
    } else if (arg === "--status") {
      options.status = String(args[++i] || "").trim();
    } else if (arg === "--id") {
      options.id = String(args[++i] || "").trim();
    } else if (arg === "--to") {
      options.to = String(args[++i] || "").trim();
    } else if (arg === "--response") {
      options.response = String(args[++i] || "").trim();
    } else if (arg === "--operator") {
      options.operator = String(args[++i] || "").trim() || "human-operator";
    } else if (arg === "--requested-by") {
      options.requestedBy = String(args[++i] || "").trim();
    } else if (arg === "--reason") {
      options.reason = String(args[++i] || "").trim();
    } else if (arg === "--resume-cursor" || arg === "--resume-phase") {
      options.resumeCursor = String(args[++i] || "").trim();
    } else if (arg === "--reuse-attempt") {
      options.reuseAttemptIds.push(String(args[++i] || "").trim());
    } else if (arg === "--reuse-proof") {
      options.reuseProofBundleIds.push(String(args[++i] || "").trim());
    } else if (arg === "--reuse-derived-summaries") {
      options.reuseDerivedSummaries = normalizeBooleanish(args[++i], true);
    } else if (arg === "--invalidate-component") {
      options.invalidateComponentIds.push(String(args[++i] || "").trim());
    } else if (arg === "--clear-reuse") {
      options.clearReusableAgentIds.push(String(args[++i] || "").trim());
    } else if (arg === "--preserve-reuse") {
      options.preserveReusableAgentIds.push(String(args[++i] || "").trim());
    } else if (arg === "--component") {
      options.componentIds.push(String(args[++i] || "").trim());
    } else if (arg === "--authoritative") {
      options.authoritative = true;
    } else if (arg === "--satisfy-owned-components") {
      options.satisfyOwnedComponents = true;
    } else if (arg === "--completion") {
      options.completion = String(args[++i] || "").trim();
    } else if (arg === "--durability") {
      options.durability = String(args[++i] || "").trim();
    } else if (arg === "--proof-level") {
      options.proofLevel = String(args[++i] || "").trim();
    } else if (arg === "--doc-delta") {
      options.docDeltaState = String(args[++i] || "").trim();
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, surface, operation, action, options };
    } else if (arg && arg !== "--") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { help: false, surface, operation, action, options };
}

function resolveLaneForRun(runId, fallbackLane) {
  return (
    readJsonOrNull(path.join(REPO_ROOT, ".wave", "adhoc", "runs", runId, "result.json"))?.lane ||
    fallbackLane
  );
}

function loadWave(lanePaths, waveNumber) {
  const waves = parseWaveFiles(lanePaths.wavesDir, { laneProfile: lanePaths.laneProfile });
  const wave = waves.find((entry) => entry.wave === waveNumber);
  if (!wave) {
    throw new Error(`Wave ${waveNumber} not found in ${lanePaths.wavesDir}`);
  }
  return wave;
}

function coordinationLogPath(lanePaths, waveNumber) {
  return path.join(lanePaths.coordinationDir, `wave-${waveNumber}.jsonl`);
}

function ledgerPath(lanePaths, waveNumber) {
  return path.join(lanePaths.ledgerDir, `wave-${waveNumber}.json`);
}

function targetAgentId(target) {
  const value = String(target || "").trim();
  return value.startsWith("agent:") ? value.slice("agent:".length) : value;
}

function recordTargetsAgent(record, agentId) {
  return (
    String(record?.agentId || "").trim() === agentId ||
    (Array.isArray(record?.targets) &&
      record.targets.some((target) => targetAgentId(target) === agentId))
  );
}

function statusPathForAgent(lanePaths, wave, agent) {
  return path.join(lanePaths.statusDir, `wave-${wave.wave}-${agent.slug}.status`);
}

const BLOCKING_TASK_TYPES = new Set([
  "request",
  "blocker",
  "clarification",
  "human-input",
  "escalation",
]);

function taskBlocksAgent(task) {
  return BLOCKING_TASK_TYPES.has(String(task?.taskType || "").trim().toLowerCase());
}

function assignmentRelevantToAgent(assignment, agentId = "") {
  return (
    !agentId ||
    assignment?.assignedAgentId === agentId ||
    assignment?.sourceAgentId === agentId
  );
}

function buildEffectiveSelection(lanePaths, wave, { activeAttempt = null, rerunRequest = null, relaunchPlan = null } = {}) {
  const activeAttemptSelected = Array.isArray(activeAttempt?.selectedAgentIds)
    ? Array.from(new Set(activeAttempt.selectedAgentIds.filter(Boolean)))
    : [];
  if (activeAttemptSelected.length > 0) {
    return {
      source: "active-attempt",
      selectedAgentIds: activeAttemptSelected,
      detail: activeAttempt?.detail || null,
    };
  }
  const rerunSelected = rerunRequest?.selectedAgentIds?.length
    ? rerunRequest.selectedAgentIds
    : resolveRetryOverrideAgentIds(wave, lanePaths, rerunRequest);
  if (rerunSelected.length > 0) {
    return {
      source: "rerun-request",
      selectedAgentIds: rerunSelected,
      detail: rerunRequest?.reason || null,
    };
  }
  const relaunchSelected = Array.isArray(relaunchPlan?.selectedAgentIds)
    ? Array.from(new Set(relaunchPlan.selectedAgentIds.filter(Boolean)))
    : [];
  if (relaunchSelected.length > 0) {
    return {
      source: "relaunch-plan",
      selectedAgentIds: relaunchSelected,
      detail: null,
    };
  }
  return {
    source: "none",
    selectedAgentIds: [],
    detail: null,
  };
}

function buildLogicalAgents({ lanePaths, wave, tasks, dependencySnapshot, capabilityAssignments, selection, proofRegistry }) {
  const selectedAgentIds = new Set(selection?.selectedAgentIds || []);
  const helperAssignments = Array.isArray(capabilityAssignments) ? capabilityAssignments : [];
  const openInbound = dependencySnapshot?.openInbound || [];
  return wave.agents.map((agent) => {
    const statusPath = statusPathForAgent(lanePaths, wave, agent);
    const statusRecord = readStatusRecordIfPresent(statusPath);
    const summary = augmentSummaryWithProofRegistry(
      agent,
      readAgentExecutionSummary(statusPath),
      proofRegistry || { entries: [] },
    );
    const proofValidation =
      !isSecurityReviewAgent(agent) && !isContEvalReportOnlyAgent(agent, { contEvalAgentId: lanePaths.contEvalAgentId })
        ? validateImplementationSummary(agent, summary ? summary : null)
        : { ok: statusRecord?.code === 0, statusCode: statusRecord?.code === 0 ? "pass" : "pending" };
    const targetedTasks = tasks.filter(
      (task) =>
        task.ownerAgentId === agent.agentId ||
        task.assigneeAgentId === agent.agentId,
    );
    const targetedOpenTasks = targetedTasks.filter((task) =>
      ["open", "working", "input-required"].includes(task.state),
    );
    const targetedBlockingTasks = targetedOpenTasks.filter((task) => taskBlocksAgent(task));
    const helperAssignment = helperAssignments.find(
      (assignment) => assignment.blocking && assignment.assignedAgentId === agent.agentId,
    );
    const dependency = openInbound.find((record) => record.assignedAgentId === agent.agentId);
    let state = "planned";
    let reason = "";
    if (selection?.source === "active-attempt" && selectedAgentIds.has(agent.agentId)) {
      state = "working";
      reason = selection?.detail || "Selected by the active launcher attempt.";
    } else if (selectedAgentIds.has(agent.agentId)) {
      state = "needs-rerun";
      reason =
        selection?.source === "relaunch-plan"
          ? "Selected by the persisted relaunch plan."
          : "Selected by active rerun request.";
    } else if (targetedBlockingTasks.some((task) => task.state === "working")) {
      state = "working";
      reason = targetedBlockingTasks.find((task) => task.state === "working")?.title || "";
    } else if (targetedBlockingTasks.length > 0 || helperAssignment || dependency) {
      state = "blocked";
      reason =
        targetedBlockingTasks[0]?.title ||
        helperAssignment?.assignmentDetail ||
        helperAssignment?.summary ||
        dependency?.summary ||
        "";
    } else if (statusRecord?.code === 0 && (proofValidation.ok || isSecurityReviewAgent(agent) || isContEvalReportOnlyAgent(agent, { contEvalAgentId: lanePaths.contEvalAgentId }))) {
      state = [
        lanePaths.contEvalAgentId || "E0",
        lanePaths.integrationAgentId || "A8",
        lanePaths.documentationAgentId || "A9",
        lanePaths.contQaAgentId || "A0",
      ].includes(agent.agentId) || isSecurityReviewAgent(agent)
        ? "closed"
        : "satisfied";
      reason = "Latest attempt satisfied current control-plane state.";
    } else if (Number.isInteger(statusRecord?.code) && statusRecord.code !== 0) {
      state = "needs-rerun";
      reason = `Latest attempt exited with code ${statusRecord.code}.`;
    }
    return {
      agentId: agent.agentId,
      state,
      reason: reason || null,
      taskIds: targetedTasks.map((task) => task.taskId),
      selectedForRerun: selectedAgentIds.has(agent.agentId) && selection?.source !== "active-attempt",
      selectedForActiveAttempt: selection?.source === "active-attempt" && selectedAgentIds.has(agent.agentId),
      activeProofBundleIds: (proofRegistry?.entries || [])
        .filter(
          (entry) =>
            entry.agentId === agent.agentId &&
            !["revoked", "superseded"].includes(String(entry.state || "").trim().toLowerCase()),
        )
        .map((entry) => entry.id),
    };
  });
}

function selectionTargetsAgent(agentId, selectionSet) {
  return Boolean(agentId) && selectionSet.has(agentId);
}

function buildBlockingEdge({ tasks, capabilityAssignments, dependencySnapshot, activeAttempt, rerunRequest, relaunchPlan, agentId = "" }) {
  const attemptSelection = new Set(activeAttempt?.selectedAgentIds || []);
  const scopeToActiveAttempt = !agentId && attemptSelection.size > 0;
  const scopedTasks = (agentId
    ? tasks.filter((task) => task.ownerAgentId === agentId || task.assigneeAgentId === agentId)
    : tasks
  ).filter((task) => {
    if (!scopeToActiveAttempt) {
      return true;
    }
    return (
      selectionTargetsAgent(task.ownerAgentId, attemptSelection) ||
      selectionTargetsAgent(task.assigneeAgentId, attemptSelection)
    );
  });
  const pendingHuman = scopedTasks.find((task) => task.state === "input-required");
  if (pendingHuman) {
    return {
      kind: "human-input",
      id: pendingHuman.taskId,
      agentId: pendingHuman.assigneeAgentId || pendingHuman.ownerAgentId || null,
      detail: pendingHuman.title,
    };
  }
  const escalation = scopedTasks.find(
    (task) => task.taskType === "escalation" && ["open", "working"].includes(task.state),
  );
  if (escalation) {
    return {
      kind: "human-escalation",
      id: escalation.taskId,
      agentId: escalation.assigneeAgentId || escalation.ownerAgentId || null,
      detail: escalation.title,
    };
  }
  const clarification = scopedTasks.find(
    (task) => task.taskType === "clarification" && ["open", "working"].includes(task.state),
  );
  if (clarification) {
    return {
      kind: "clarification",
      id: clarification.taskId,
      agentId: clarification.assigneeAgentId || clarification.ownerAgentId || null,
      detail: clarification.title,
    };
  }
  const scopedAssignments = (capabilityAssignments || []).filter((assignment) => {
    if (!scopeToActiveAttempt) {
      return assignmentRelevantToAgent(assignment, agentId);
    }
    return (
      selectionTargetsAgent(assignment.assignedAgentId, attemptSelection) ||
      selectionTargetsAgent(assignment.sourceAgentId, attemptSelection)
    );
  });
  const unresolvedAssignment = scopedAssignments.find(
    (assignment) =>
      assignment.blocking &&
      !assignment.assignedAgentId,
  );
  if (unresolvedAssignment) {
    return {
      kind: "helper-assignment-unresolved",
      id: unresolvedAssignment.requestId,
      agentId: unresolvedAssignment.sourceAgentId || null,
      detail: unresolvedAssignment.assignmentDetail || unresolvedAssignment.summary || unresolvedAssignment.requestId,
    };
  }
  const blockingAssignment = scopedAssignments.find((assignment) => assignment.blocking);
  if (blockingAssignment) {
    return {
      kind: "helper-assignment",
      id: blockingAssignment.requestId,
      agentId: blockingAssignment.assignedAgentId || blockingAssignment.sourceAgentId || null,
      detail: blockingAssignment.assignmentDetail || blockingAssignment.summary || blockingAssignment.requestId,
    };
  }
  const dependency = [
    ...(dependencySnapshot?.openInbound || []),
    ...(dependencySnapshot?.openOutbound || []),
  ].find((record) => {
    if (agentId) {
      return record.assignedAgentId === agentId || record.agentId === agentId;
    }
    if (!scopeToActiveAttempt) {
      return true;
    }
    return (
      selectionTargetsAgent(record.assignedAgentId, attemptSelection) ||
      selectionTargetsAgent(record.agentId, attemptSelection)
    );
  });
  if (dependency) {
    return {
      kind: "dependency",
      id: dependency.id,
      agentId: dependency.assignedAgentId || dependency.agentId || null,
      detail: dependency.summary || dependency.detail || dependency.id,
    };
  }
  if (!scopeToActiveAttempt && rerunRequest) {
    return {
      kind: "rerun-request",
      id: rerunRequest.requestId || "active-rerun",
      agentId: null,
      detail: rerunRequest.reason || "Active rerun request controls next attempt selection.",
    };
  }
  if (!scopeToActiveAttempt && relaunchPlan) {
    return {
      kind: "relaunch-plan",
      id: `wave-${relaunchPlan.wave ?? "unknown"}-relaunch-plan`,
      agentId: null,
      detail: "Persisted relaunch plan controls the next safe launcher selection.",
    };
  }
  const blocker = scopedTasks.find(
    (task) => task.taskType === "blocker" && ["open", "working"].includes(task.state),
  );
  if (blocker) {
    return {
      kind: "blocker",
      id: blocker.taskId,
      agentId: blocker.ownerAgentId || null,
      detail: blocker.title,
    };
  }
  const request = scopedTasks.find(
    (task) => task.taskType === "request" && ["open", "working"].includes(task.state),
  );
  if (request) {
    return {
      kind: "request",
      id: request.taskId,
      agentId: request.assigneeAgentId || request.ownerAgentId || null,
      detail: request.title,
    };
  }
  return null;
}

export function buildControlStatusPayload({ lanePaths, wave, agentId = "" }) {
  const logPath = coordinationLogPath(lanePaths, wave.wave);
  const coordinationState = readMaterializedCoordinationState(logPath);
  const ledger = readWaveLedger(ledgerPath(lanePaths, wave.wave)) || { phase: "planned" };
  const capabilityAssignments = buildRequestAssignments({
    coordinationState,
    agents: wave.agents,
    ledger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  const dependencySnapshot = buildDependencySnapshot({
    dirPath: lanePaths.crossLaneDependenciesDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agents: wave.agents,
    ledger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  const feedbackRequests = readWaveHumanFeedbackRequests({
    feedbackRequestsDir: lanePaths.feedbackRequestsDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agentIds: wave.agents.map((agent) => agent.agentId),
    orchestratorId: "",
  });
  const tasks = buildTaskSnapshots({
    coordinationState,
    feedbackRequests,
    ackTimeoutMs: DEFAULT_COORDINATION_ACK_TIMEOUT_MS,
    resolutionStaleMs: DEFAULT_COORDINATION_RESOLUTION_STALE_MS,
  }).filter((task) => !agentId || task.ownerAgentId === agentId || task.assigneeAgentId === agentId);
  const controlState = readWaveControlPlaneState(lanePaths, wave.wave);
  const proofRegistry = readWaveProofRegistry(lanePaths, wave.wave) || { entries: [] };
  const relaunchPlan = readWaveRelaunchPlanSnapshot(lanePaths, wave.wave);
  const rerunRequest = controlState.activeRerunRequest
    ? {
        ...controlState.activeRerunRequest,
        selectedAgentIds:
          controlState.activeRerunRequest.selectedAgentIds.length > 0
            ? controlState.activeRerunRequest.selectedAgentIds
            : resolveRetryOverrideAgentIds(wave, lanePaths, {
                selectedAgentIds: controlState.activeRerunRequest.selectedAgentIds,
                resumePhase: controlState.activeRerunRequest.resumeCursor,
              }),
      }
    : null;
  const selection = buildEffectiveSelection(lanePaths, wave, {
    activeAttempt: controlState.activeAttempt,
    rerunRequest,
    relaunchPlan,
  });
  return {
    lane: lanePaths.lane,
    wave: wave.wave,
    phase: ledger.phase || "unknown",
    agentId: agentId || null,
    blockingEdge: buildBlockingEdge({
      tasks,
      capabilityAssignments,
      dependencySnapshot,
      activeAttempt: controlState.activeAttempt,
      rerunRequest,
      relaunchPlan,
      agentId,
    }),
    logicalAgents: buildLogicalAgents({
      lanePaths,
      wave,
      tasks,
      dependencySnapshot,
      capabilityAssignments,
      selection,
      proofRegistry,
    }).filter((agent) => !agentId || agent.agentId === agentId),
    tasks,
    helperAssignments: (capabilityAssignments || []).filter(
      (assignment) => assignment.blocking && assignmentRelevantToAgent(assignment, agentId),
    ),
    dependencies: [
      ...(dependencySnapshot?.openInbound || []).filter(
        (record) => !agentId || record.assignedAgentId === agentId,
      ),
      ...(dependencySnapshot?.openOutbound || []).filter(
        (record) => !agentId || record.agentId === agentId,
      ),
    ],
    proofBundles: (proofRegistry?.entries || []).filter(
      (entry) => !agentId || entry.agentId === agentId,
    ),
    selectionSource: selection.source,
    rerunRequest,
    relaunchPlan,
    nextTimer: nextTaskDeadline(tasks),
    activeAttempt: controlState.activeAttempt,
  };
}

function ensureWaveStateDirs(lanePaths) {
  ensureDirectory(lanePaths.coordinationDir);
  ensureDirectory(lanePaths.controlDir);
  ensureDirectory(lanePaths.controlPlaneDir);
  ensureDirectory(lanePaths.assignmentsDir);
  ensureDirectory(lanePaths.inboxesDir);
  ensureDirectory(lanePaths.messageboardsDir);
  ensureDirectory(lanePaths.docsQueueDir);
  ensureDirectory(lanePaths.ledgerDir);
  ensureDirectory(lanePaths.integrationDir);
  ensureDirectory(lanePaths.proofDir);
  ensureDirectory(lanePaths.dependencySnapshotsDir);
}

function kindForTaskCreate(input) {
  const normalized = String(input || "").trim().toLowerCase();
  if (normalized === "clarification") {
    return "clarification-request";
  }
  if (normalized === "human-input") {
    return "human-feedback";
  }
  return normalized;
}

function printStatus(payload) {
  const blocking = payload.blockingEdge
    ? `${payload.blockingEdge.kind} ${payload.blockingEdge.id}: ${payload.blockingEdge.detail}`
    : "none";
  console.log(`lane=${payload.lane} wave=${payload.wave} phase=${payload.phase}`);
  console.log(`blocking=${blocking}`);
  if (payload.nextTimer) {
    console.log(`next-timer=${payload.nextTimer.kind} ${payload.nextTimer.taskId} at ${payload.nextTimer.at}`);
  }
  if (payload.logicalAgents.length > 0) {
    console.log("logical-agents:");
    for (const agent of payload.logicalAgents) {
      console.log(`- ${agent.agentId} ${agent.state}${agent.reason ? `: ${agent.reason}` : ""}`);
    }
  }
}

function appendCoordinationStatusUpdate(logPath, record, status, options = {}) {
  return appendCoordinationRecord(logPath, {
    ...record,
    status,
    summary: options.summary || record.summary,
    detail: options.detail || record.detail,
    source: options.source || "operator",
  });
}

function appendTaskCoordinationEvent(logPath, lanePaths, wave, record, action, options) {
  if (action === "start") {
    return appendCoordinationStatusUpdate(logPath, record, "in_progress", {
      detail: options.detail || record.detail,
      summary: options.summary || record.summary,
    });
  }
  if (action === "resolve") {
    return appendCoordinationStatusUpdate(logPath, record, "resolved", {
      detail: options.detail || record.detail,
      summary: options.summary || record.summary,
    });
  }
  if (action === "dismiss" || action === "cancel") {
    return appendCoordinationStatusUpdate(logPath, record, "cancelled", {
      detail: options.detail || record.detail,
      summary: options.summary || record.summary,
    });
  }
  if (action === "reassign") {
    if (!options.to) {
      throw new Error("reassign requires --to");
    }
    const closureCondition =
      record.kind === "clarification-request"
        ? clarificationClosureCondition(record.id)
        : record.closureCondition || "";
    appendCoordinationStatusUpdate(logPath, record, "superseded", {
      detail: options.detail || `${record.id} re-assigned to ${options.to}.`,
      summary: record.summary,
    });
    const rerouted = appendCoordinationRecord(logPath, {
      lane: lanePaths.lane,
      wave: wave.wave,
      agentId: options.agent || "operator",
      kind: "request",
      targets: [`agent:${options.to}`],
      priority: record.priority,
      artifactRefs: record.artifactRefs,
      dependsOn:
        record.kind === "clarification-request"
          ? [record.id]
          : Array.from(new Set([record.id, ...(record.dependsOn || [])])),
      closureCondition,
      summary: record.summary,
      detail: options.detail || `${record.summary} reassigned to ${options.to}.`,
      status: "open",
      source: "operator",
    });
    if (record.kind === "clarification-request") {
      appendCoordinationStatusUpdate(logPath, record, "in_progress", {
        detail: `Awaiting routed follow-up from ${options.to}.`,
        summary: record.summary,
      });
    }
    return rerouted;
  }
  if (action === "escalate") {
    return appendCoordinationRecord(logPath, {
      id: `escalation-${record.id}`,
      lane: lanePaths.lane,
      wave: wave.wave,
      agentId: options.agent || "operator",
      kind: "human-escalation",
      targets: record.targets,
      priority: "high",
      artifactRefs: record.artifactRefs,
      dependsOn: [record.id],
      closureCondition:
        record.kind === "clarification-request"
          ? clarificationClosureCondition(record.id)
          : record.closureCondition || "",
      summary: record.summary,
      detail: options.detail || record.detail,
      status: "open",
      source: "operator",
    });
  }
  throw new Error(`Unsupported task action: ${action}`);
}

function appendAttemptEvent(lanePaths, waveNumber, payload) {
  const attemptId = payload.attemptId || `attempt-${payload.attemptNumber || 0}`;
  return appendWaveControlEvent(lanePaths, waveNumber, {
    entityType: "attempt",
    entityId: attemptId,
    action: payload.state || "running",
    source: "launcher",
    actor: "launcher",
    data: {
      attemptId,
      attemptNumber: payload.attemptNumber || 0,
      state: payload.state || "running",
      selectedAgentIds: payload.selectedAgentIds || [],
      detail: payload.detail || null,
      createdAt: payload.createdAt || undefined,
    },
  });
}

export async function runControlCli(argv) {
  const { help, surface, operation, action, options } = parseArgs(argv);
  if (help || !surface) {
    printUsage();
    return;
  }
  if (surface !== "status" && !["telemetry", "task", "rerun", "proof"].includes(surface)) {
    throw new Error("Expected control surface: status | telemetry | task | rerun | proof");
  }
  if (options.runId) {
    options.lane = resolveLaneForRun(options.runId, options.lane);
  }
  const lanePaths = buildLanePaths(options.lane, {
    runVariant: options.dryRun ? "dry-run" : undefined,
    adhocRunId: options.runId || null,
  });
  if (surface === "telemetry") {
    if (!["status", "flush"].includes(operation)) {
      throw new Error("Expected telemetry operation: status | flush");
    }
    const payload =
      operation === "flush"
        ? await flushWaveControlQueue(lanePaths)
        : readWaveControlQueueState(lanePaths);
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }
  if (options.wave === null && options.runId) {
    options.wave = 0;
  }
  if (options.wave === null) {
    throw new Error("--wave is required");
  }
  const wave = loadWave(lanePaths, options.wave);
  ensureWaveStateDirs(lanePaths);
  const logPath = coordinationLogPath(lanePaths, wave.wave);
  updateSeedRecords(logPath, {
    lane: lanePaths.lane,
    wave: wave.wave,
    agents: wave.agents,
    componentPromotions: wave.componentPromotions,
    sharedPlanDocs: lanePaths.sharedPlanDocs,
    contQaAgentId: lanePaths.contQaAgentId,
    contEvalAgentId: lanePaths.contEvalAgentId,
    integrationAgentId: lanePaths.integrationAgentId,
    documentationAgentId: lanePaths.documentationAgentId,
    feedbackRequests: readWaveHumanFeedbackRequests({
      feedbackRequestsDir: lanePaths.feedbackRequestsDir,
      lane: lanePaths.lane,
      waveNumber: wave.wave,
      agentIds: wave.agents.map((agent) => agent.agentId),
      orchestratorId: "",
    }),
  });

  if (surface === "status") {
    const payload = buildControlStatusPayload({
      lanePaths,
      wave,
      agentId: options.agent || "",
    });
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printStatus(payload);
    }
    return;
  }

  if (surface === "task") {
    const coordinationState = readMaterializedCoordinationState(logPath);
    if (operation === "create") {
      if (!options.agent || !options.kind || !options.summary) {
        throw new Error("task create requires --agent, --kind, and --summary");
      }
      const kind = kindForTaskCreate(options.kind);
      if (kind === "human-feedback") {
        const created = createFeedbackRequest({
          feedbackStateDir: lanePaths.feedbackStateDir,
          feedbackRequestsDir: lanePaths.feedbackRequestsDir,
          lane: lanePaths.lane,
          wave: wave.wave,
          agentId: options.agent,
          orchestratorId: "",
          question: options.summary,
          context: options.detail,
        });
        appendWaveControlEvent(lanePaths, wave.wave, {
          entityType: "human_input",
          entityId: created.requestId,
          action: "requested",
          source: "operator",
          actor: options.operator,
          data: {
            humanInputId: created.requestId,
            requestId: created.requestId,
            state: "pending",
            createdAt: created.payload.createdAt,
          },
        });
        console.log(JSON.stringify(created.payload, null, 2));
        return;
      }
      const record = appendCoordinationRecord(logPath, {
        lane: lanePaths.lane,
        wave: wave.wave,
        agentId: options.agent,
        kind,
        summary: options.summary,
        detail: options.detail,
        targets: options.targets,
        priority: options.priority,
        dependsOn: options.dependsOn,
        artifactRefs: options.artifactRefs,
        status: options.status,
        source: "operator",
      });
      console.log(JSON.stringify(record, null, 2));
      return;
    }
    if (operation === "list") {
      const feedbackRequests = readWaveHumanFeedbackRequests({
        feedbackRequestsDir: lanePaths.feedbackRequestsDir,
        lane: lanePaths.lane,
        waveNumber: wave.wave,
        agentIds: wave.agents.map((agent) => agent.agentId),
        orchestratorId: "",
      });
      const tasks = buildTaskSnapshots({
        coordinationState,
        feedbackRequests,
      }).filter((task) => !options.agent || task.ownerAgentId === options.agent || task.assigneeAgentId === options.agent);
      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
      } else {
        for (const task of tasks) {
          console.log(`${task.taskId} ${task.taskType}/${task.state} ${task.title}`);
        }
      }
      return;
    }
    if (operation === "get") {
      if (!options.id) {
        throw new Error("task get requires --id");
      }
      const feedbackRequests = readWaveHumanFeedbackRequests({
        feedbackRequestsDir: lanePaths.feedbackRequestsDir,
        lane: lanePaths.lane,
        waveNumber: wave.wave,
        agentIds: wave.agents.map((agent) => agent.agentId),
        orchestratorId: "",
      });
      const task = buildTaskSnapshots({
        coordinationState,
        feedbackRequests,
      }).find((entry) => entry.taskId === options.id);
      if (!task) {
        throw new Error(`Task not found: ${options.id}`);
      }
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    if (operation === "act") {
      if (!action || !options.id) {
        throw new Error("task act requires an action and --id");
      }
      if (action === "answer") {
        if (!options.response) {
          throw new Error("task act answer requires --response");
        }
        const answered = answerFeedbackRequest({
          feedbackStateDir: lanePaths.feedbackStateDir,
          feedbackRequestsDir: lanePaths.feedbackRequestsDir,
          requestId: options.id,
          response: options.response,
          operator: options.operator,
          force: true,
        });
        appendWaveControlEvent(lanePaths, wave.wave, {
          entityType: "human_input",
          entityId: options.id,
          action: "answered",
          source: "operator",
          actor: options.operator,
          data: {
            humanInputId: options.id,
            requestId: options.id,
            state: "answered",
            operator: options.operator,
            response: options.response,
            createdAt: answered.createdAt,
          },
        });
        console.log(JSON.stringify(answered, null, 2));
        return;
      }
      const record = coordinationState.byId.get(options.id);
      if (!record) {
        throw new Error(`Task not found: ${options.id}`);
      }
      const updated = appendTaskCoordinationEvent(logPath, lanePaths, wave, record, action, options);
      if (record.kind === "clarification-request" && ["resolve", "dismiss"].includes(action)) {
        const nextStatus = action === "resolve" ? "resolved" : "cancelled";
        for (const linked of clarificationLinkedRequests(coordinationState, record.id).filter((entry) =>
          isOpenCoordinationStatus(entry.status),
        )) {
          appendCoordinationStatusUpdate(logPath, linked, nextStatus, {
            detail: `${action === "resolve" ? "Resolved" : "Cancelled"} via clarification ${record.id}.`,
            summary: linked.summary,
          });
        }
      }
      console.log(JSON.stringify(updated, null, 2));
      return;
    }
    throw new Error("Expected task operation: create | list | get | act");
  }

  if (surface === "rerun") {
    if (operation === "get") {
      const payload = {
        lane: lanePaths.lane,
        wave: wave.wave,
        rerunRequest: readWaveRetryOverride(lanePaths, wave.wave),
        effectiveSelectedAgentIds: resolveRetryOverrideAgentIds(
          wave,
          lanePaths,
          readWaveRetryOverride(lanePaths, wave.wave),
        ),
        relaunchPlan: readWaveRelaunchPlanSnapshot(lanePaths, wave.wave),
      };
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (operation === "clear") {
      clearWaveRetryOverride(lanePaths, wave.wave);
      console.log(`[wave-control] cleared rerun request for wave ${wave.wave}`);
      return;
    }
    if (operation === "request") {
      const selectedAgentIds = Array.from(new Set(options.selectedAgentIds.filter(Boolean)));
      const request = writeWaveRetryOverride(lanePaths, wave.wave, {
        lane: lanePaths.lane,
        wave: wave.wave,
        selectedAgentIds,
        resumeCursor: options.resumeCursor || null,
        reuseAttemptIds: options.reuseAttemptIds,
        reuseProofBundleIds: options.reuseProofBundleIds,
        reuseDerivedSummaries: options.reuseDerivedSummaries,
        invalidateComponentIds: options.invalidateComponentIds,
        clearReusableAgentIds: options.clearReusableAgentIds,
        preserveReusableAgentIds: options.preserveReusableAgentIds,
        requestedBy: options.requestedBy || "human-operator",
        reason: options.reason || null,
        applyOnce: true,
      });
      console.log(JSON.stringify({
        lane: lanePaths.lane,
        wave: wave.wave,
        rerunRequest: request,
        effectiveSelectedAgentIds: resolveRetryOverrideAgentIds(wave, lanePaths, request),
      }, null, 2));
      return;
    }
    throw new Error("Expected rerun operation: request | get | clear");
  }

  if (surface === "proof") {
    if (operation === "get") {
      const registry = readWaveProofRegistry(lanePaths, wave.wave);
      const entries = (registry?.entries || []).filter((entry) => {
        if (options.id && entry.id !== options.id) {
          return false;
        }
        if (options.agent && entry.agentId !== options.agent) {
          return false;
        }
        return true;
      });
      console.log(JSON.stringify({
        lane: lanePaths.lane,
        wave: wave.wave,
        entries,
        registryPath: waveProofRegistryPath(lanePaths, wave.wave),
      }, null, 2));
      return;
    }
    if (["register", "supersede"].includes(operation) && !options.agent) {
      throw new Error(`proof ${operation} requires --agent`);
    }
    const agent = options.agent
      ? (wave.agents || []).find((entry) => entry.agentId === options.agent)
      : null;
    if (options.agent && !agent) {
      throw new Error(`Unknown wave agent id: ${options.agent}`);
    }
    if (operation === "register") {
      if (options.artifactRefs.length === 0) {
        throw new Error("proof register requires at least one --artifact");
      }
      const result = registerWaveProofBundle({
        lanePaths,
        wave,
        agent,
        artifactPaths: options.artifactRefs,
        componentIds: options.componentIds,
        authoritative: options.authoritative,
        satisfyOwnedComponents: options.satisfyOwnedComponents,
        completion: options.completion || null,
        durability: options.durability || null,
        proofLevel: options.proofLevel || null,
        docDeltaState: options.docDeltaState || null,
        detail: options.detail || "",
        recordedBy: options.operator || "human-operator",
      });
      const payload = {
        lane: lanePaths.lane,
        wave: wave.wave,
        entry: result.entry,
        registry: result.registry,
      };
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (operation === "supersede") {
      if (!options.id) {
        throw new Error("proof supersede requires --id");
      }
      const state = readWaveControlPlaneState(lanePaths, wave.wave);
      const current = state.proofBundlesById.get(options.id);
      if (!current) {
        throw new Error(`Proof bundle not found: ${options.id}`);
      }
      appendWaveControlEvent(lanePaths, wave.wave, {
        entityType: "proof_bundle",
        entityId: options.id,
        action: "superseded",
        source: "operator",
        actor: options.operator,
        data: {
          ...current,
          state: "superseded",
        },
      });
      const result = registerWaveProofBundle({
        lanePaths,
        wave,
        agent,
        artifactPaths: options.artifactRefs.length > 0 ? options.artifactRefs : current.artifacts.map((artifact) => artifact.path),
        componentIds: options.componentIds.length > 0 ? options.componentIds : current.components.map((component) => component.componentId),
        authoritative: options.authoritative || current.authoritative,
        satisfyOwnedComponents: options.satisfyOwnedComponents || current.satisfyOwnedComponents,
        completion: options.completion || current.proof?.completion || null,
        durability: options.durability || current.proof?.durability || null,
        proofLevel: options.proofLevel || current.proof?.proof || null,
        docDeltaState: options.docDeltaState || current.docDelta?.state || null,
        detail: options.detail || current.detail || "",
        recordedBy: options.operator || "human-operator",
      });
      appendWaveControlEvent(lanePaths, wave.wave, {
        entityType: "proof_bundle",
        entityId: result.entry.id,
        action: "linked-supersession",
        source: "operator",
        actor: options.operator,
        data: {
          ...state.proofBundlesById.get(result.entry.id),
          supersedes: options.id,
        },
      });
      syncWaveControlPlaneProjections(
        lanePaths,
        wave.wave,
        readWaveControlPlaneState(lanePaths, wave.wave),
      );
      console.log(JSON.stringify({
        lane: lanePaths.lane,
        wave: wave.wave,
        superseded: options.id,
        entry: result.entry,
        registry: result.registry,
      }, null, 2));
      return;
    }
    if (operation === "revoke") {
      if (!options.id) {
        throw new Error("proof revoke requires --id");
      }
      const state = readWaveControlPlaneState(lanePaths, wave.wave);
      const current = state.proofBundlesById.get(options.id);
      if (!current) {
        throw new Error(`Proof bundle not found: ${options.id}`);
      }
      appendWaveControlEvent(lanePaths, wave.wave, {
        entityType: "proof_bundle",
        entityId: options.id,
        action: "revoked",
        source: "operator",
        actor: options.operator,
        data: {
          ...current,
          state: "revoked",
          detail: options.detail || current.detail || "Revoked by operator.",
        },
      });
      const projections = syncWaveControlPlaneProjections(
        lanePaths,
        wave.wave,
        readWaveControlPlaneState(lanePaths, wave.wave),
      );
      console.log(JSON.stringify({
        lane: lanePaths.lane,
        wave: wave.wave,
        revokedId: options.id,
        registry: projections.proofRegistry,
      }, null, 2));
      return;
    }
    throw new Error("Expected proof operation: register | get | supersede | revoke");
  }

  throw new Error(`Unknown control surface: ${surface}`);
}

export { appendAttemptEvent };
