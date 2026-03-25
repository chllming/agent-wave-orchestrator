import fs from "node:fs";
import path from "node:path";
import {
  readWaveComponentGate,
  buildSharedComponentSiblingPendingFailure,
  analyzePromotedComponentOwners,
  readRunExecutionSummary,
  readClarificationBarrier,
  readWaveAssignmentBarrier,
  readWaveDependencyBarrier,
} from "./gate-engine.mjs";
import {
  isOpenCoordinationStatus,
  openClarificationLinkedRequests,
} from "./coordination-store.mjs";
import {
  readStatusRecordIfPresent,
  REPO_ROOT,
  toIsoTimestamp,
} from "./shared.mjs";
import {
  readAgentExecutionSummary,
  validateDesignSummary,
  validateImplementationSummary,
} from "./agent-state.mjs";
import {
  agentRequiresProofCentricValidation,
  waveRequiresProofCentricValidation,
  validateWaveRuntimeMixAssignments,
} from "./wave-files.mjs";
import {
  augmentSummaryWithProofRegistry,
} from "./proof-registry.mjs";
import { hashAgentPromptFingerprint } from "./context7.mjs";
import {
  isDocsOnlyDesignAgent,
  isDesignAgent,
  isImplementationOwningDesignAgent,
  isSecurityReviewAgent,
  resolveWaveRoleBindings,
} from "./role-helpers.mjs";
import {
  commandForExecutor,
  isExecutorCommandAvailable,
} from "./executors.mjs";
import {
  readWaveRelaunchPlanSnapshot,
  waveRelaunchPlanPath,
} from "./retry-control.mjs";
import {
  writeRelaunchPlan,
} from "./artifact-schemas.mjs";
import {
  refreshResolvedSkillsForRun,
} from "./launcher-runtime.mjs";
import {
  buildRequestAssignments,
} from "./routing-state.mjs";
import {
  setWaveDashboardAgent,
} from "./dashboard-state.mjs";

export function readWaveRelaunchPlan(lanePaths, waveNumber) {
  return readWaveRelaunchPlanSnapshot(lanePaths, waveNumber);
}

export function writeWaveRelaunchPlan(lanePaths, waveNumber, payload) {
  const filePath = waveRelaunchPlanPath(lanePaths, waveNumber);
  writeRelaunchPlan(filePath, payload, { wave: waveNumber });
  return filePath;
}

export function clearWaveRelaunchPlan(lanePaths, waveNumber) {
  const filePath = waveRelaunchPlanPath(lanePaths, waveNumber);
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // no-op
  }
}

export function resetPersistedWaveLaunchState(lanePaths, waveNumber, options = {}) {
  if (options?.dryRun || options?.resumeControlState) {
    return {
      clearedRelaunchPlan: false,
    };
  }
  const persistedRelaunchPlan = readWaveRelaunchPlan(lanePaths, waveNumber);
  if (!persistedRelaunchPlan) {
    return {
      clearedRelaunchPlan: false,
    };
  }
  clearWaveRelaunchPlan(lanePaths, waveNumber);
  return {
    clearedRelaunchPlan: true,
    relaunchPlan: persistedRelaunchPlan,
  };
}

function proofCentricReuseBlocked(derivedState) {
  if (!derivedState) {
    return false;
  }
  return (
    readClarificationBarrier(derivedState).ok === false ||
    readWaveAssignmentBarrier(derivedState).ok === false ||
    readWaveDependencyBarrier(derivedState).ok === false
  );
}

function sameAgentIdSet(left = [], right = []) {
  const leftIds = Array.from(new Set((left || []).filter(Boolean))).toSorted();
  const rightIds = Array.from(new Set((right || []).filter(Boolean))).toSorted();
  return leftIds.length === rightIds.length && leftIds.every((agentId, index) => agentId === rightIds[index]);
}

export function persistedRelaunchPlanMatchesCurrentState(
  agentRuns,
  persistedPlan,
  lanePaths,
  waveDefinition,
) {
  if (!persistedPlan || !Array.isArray(persistedPlan.selectedAgentIds)) {
    return false;
  }
  const componentGate = readWaveComponentGate(waveDefinition, agentRuns, {
    laneProfile: lanePaths?.laneProfile,
    mode: "live",
  });
  if (componentGate?.statusCode !== "shared-component-sibling-pending") {
    return true;
  }
  return sameAgentIdSet(
    persistedPlan.selectedAgentIds,
    componentGate.waitingOnAgentIds || [],
  );
}

function applyPersistedRelaunchPlan(agentRuns, persistedPlan, lanePaths, waveDefinition) {
  if (!persistedPlan || !Array.isArray(persistedPlan.selectedAgentIds)) {
    return [];
  }
  const runsByAgentId = new Map(agentRuns.map((run) => [run.agent.agentId, run]));
  for (const [agentId, executorState] of Object.entries(persistedPlan.executorStates || {})) {
    const run = runsByAgentId.get(agentId);
    if (!run || !executorState || typeof executorState !== "object") {
      continue;
    }
    run.agent.executorResolved = executorState;
    refreshResolvedSkillsForRun(run, waveDefinition, lanePaths);
  }
  return persistedPlan.selectedAgentIds
    .map((agentId) => runsByAgentId.get(agentId))
    .filter(Boolean);
}

export { applyPersistedRelaunchPlan };

export function resolveSharedComponentContinuationRuns(
  currentRuns,
  agentRuns,
  failures,
  derivedState,
  lanePaths,
  waveDefinition = null,
) {
  if (!Array.isArray(currentRuns) || currentRuns.length === 0 || !Array.isArray(failures) || failures.length === 0) {
    return [];
  }
  if (!failures.every((failure) => failure.statusCode === "shared-component-sibling-pending")) {
    return [];
  }
  const currentRunIds = new Set(currentRuns.map((run) => run.agent.agentId));
  const waitingAgentIds = new Set(
    failures.flatMap((failure) => failure.waitingOnAgentIds || []).filter(Boolean),
  );
  if (Array.from(currentRunIds).some((agentId) => waitingAgentIds.has(agentId))) {
    return [];
  }
  const relaunchResolution = resolveRelaunchRuns(
    agentRuns,
    failures,
    derivedState,
    lanePaths,
    waveDefinition,
  );
  if (relaunchResolution.barrier || relaunchResolution.runs.length === 0) {
    return [];
  }
  return relaunchResolution.runs.some((run) => !currentRunIds.has(run.agent.agentId))
    ? relaunchResolution.runs
    : [];
}

export function relaunchReasonBuckets(runs, failures, derivedState) {
  const selectedAgentIds = new Set((runs || []).map((run) => run.agent.agentId));
  return {
    clarification: openClarificationLinkedRequests(derivedState?.coordinationState)
      .flatMap((record) => record.targets || [])
      .some((target) => {
        const agentId = String(target || "").startsWith("agent:")
          ? String(target).slice("agent:".length)
          : String(target || "");
        return selectedAgentIds.has(agentId);
      }),
    helperAssignment: (derivedState?.capabilityAssignments || []).some(
      (assignment) => assignment.blocking && selectedAgentIds.has(assignment.assignedAgentId),
    ),
    dependency: ((derivedState?.dependencySnapshot?.openInbound || []).some((record) =>
      selectedAgentIds.has(record.assignedAgentId),
    )),
    blocker: (derivedState?.coordinationState?.blockers || []).some(
      (record) =>
        isOpenCoordinationStatus(record.status) &&
        (selectedAgentIds.has(record.agentId) ||
          (record.targets || []).some((target) => {
            const agentId = String(target || "").startsWith("agent:")
              ? String(target).slice("agent:".length)
              : String(target || "");
            return selectedAgentIds.has(agentId);
          })),
    ),
    closureGate: (failures || []).some(
      (failure) => failure.agentId && selectedAgentIds.has(failure.agentId),
    ),
    sharedComponentSiblingWait: (failures || []).some(
      (failure) =>
        failure.statusCode === "shared-component-sibling-pending" &&
        (failure.waitingOnAgentIds || []).some((agentId) => selectedAgentIds.has(agentId)),
    ),
  };
}

const HUMAN_INPUT_BLOCKER_KINDS = new Set([
  "human-input",
  "human-feedback",
  "human-escalation",
]);

function isHumanInputBlocker(blocker) {
  return HUMAN_INPUT_BLOCKER_KINDS.has(String(blocker?.kind || "").trim().toLowerCase());
}

function normalizeRetryTargets(retryTargetSet) {
  if (Array.isArray(retryTargetSet)) {
    return retryTargetSet;
  }
  if (Array.isArray(retryTargetSet?.targets)) {
    return retryTargetSet.targets;
  }
  if (Array.isArray(retryTargetSet?.agentIds)) {
    return retryTargetSet.agentIds.map((agentId) => ({
      agentId,
      reason: retryTargetSet.reason || null,
      retryOverride: retryTargetSet.retryOverride || null,
    }));
  }
  return [];
}

export function applySharedComponentWaitStateToDashboard(componentGate, dashboardState) {
  const waitingSummary = (componentGate?.waitingOnAgentIds || []).join("/");
  if (!waitingSummary) {
    return;
  }
  for (const agentId of componentGate?.satisfiedAgentIds || []) {
    setWaveDashboardAgent(dashboardState, agentId, {
      state: "completed",
      detail: `Desired-state slice landed; waiting on ${waitingSummary} for shared component closure`,
    });
  }
}

export function reconcileFailuresAgainstSharedComponentState(wave, agentRuns, failures) {
  if (!Array.isArray(failures) || failures.length === 0) {
    return failures;
  }
  const summariesByAgentId = Object.fromEntries(
    (agentRuns || []).map((runInfo) => [
      runInfo.agent.agentId,
      readRunExecutionSummary(runInfo, wave, { mode: "live" }),
    ]),
  );
  const failureAgentIds = new Set(failures.map((failure) => failure.agentId).filter(Boolean));
  const consumedSatisfiedAgentIds = new Set();
  const synthesizedFailures = [];
  for (const promotion of wave?.componentPromotions || []) {
    const componentState = analyzePromotedComponentOwners(
      promotion.componentId,
      agentRuns,
      summariesByAgentId,
    );
    if (
      componentState.satisfiedAgentIds.length === 0 ||
      componentState.waitingOnAgentIds.length === 0 ||
      !componentState.satisfiedAgentIds.some((agentId) => failureAgentIds.has(agentId))
    ) {
      continue;
    }
    for (const agentId of componentState.satisfiedAgentIds) {
      if (failureAgentIds.has(agentId)) {
        consumedSatisfiedAgentIds.add(agentId);
      }
    }
    synthesizedFailures.push(buildSharedComponentSiblingPendingFailure(componentState));
  }
  return [
    ...synthesizedFailures.filter(Boolean),
    ...failures.filter((failure) => !consumedSatisfiedAgentIds.has(failure.agentId)),
  ];
}

export function hasReusableSuccessStatus(agent, statusPath, options = {}) {
  const statusRecord = readStatusRecordIfPresent(statusPath);
  const basicReuseOk = Boolean(
    statusRecord && statusRecord.code === 0 && statusRecord.promptHash === hashAgentPromptFingerprint(agent),
  );
  if (!basicReuseOk) {
    return false;
  }
  if (isDocsOnlyDesignAgent(agent) || isImplementationOwningDesignAgent(agent)) {
    const summary = readAgentExecutionSummary(statusPath, {
      agent,
      statusPath,
      statusRecord,
      logPath: options.logPath || null,
      reportPath: options.reportPath || null,
    });
    if (!summary) {
      return false;
    }
    const effectiveSummary = options.proofRegistry
      ? augmentSummaryWithProofRegistry(agent, summary, options.proofRegistry)
      : summary;
    if (isDocsOnlyDesignAgent(agent)) {
      return validateDesignSummary(agent, effectiveSummary).ok;
    }
    return (
      validateDesignSummary(agent, effectiveSummary).ok &&
      validateImplementationSummary(agent, effectiveSummary).ok
    );
  }
  const proofCentric =
    agentRequiresProofCentricValidation(agent) || waveRequiresProofCentricValidation(options.wave);
  if (!proofCentric) {
    return true;
  }
  const summary = readAgentExecutionSummary(statusPath, {
    agent,
    statusPath,
    statusRecord,
    logPath: options.logPath || null,
    reportPath: options.reportPath || null,
  });
  if (!summary) {
    return false;
  }
  const effectiveSummary = options.proofRegistry
    ? augmentSummaryWithProofRegistry(agent, summary, options.proofRegistry)
    : summary;
  if (!validateImplementationSummary(agent, effectiveSummary).ok) {
    return false;
  }
  if (proofCentricReuseBlocked(options.derivedState)) {
    return false;
  }
  return true;
}

function hasReusableDesignPassStatus(agent, statusPath, options = {}) {
  if (!isDesignAgent(agent)) {
    return hasReusableSuccessStatus(agent, statusPath, options);
  }
  const statusRecord = readStatusRecordIfPresent(statusPath);
  const basicReuseOk = Boolean(
    statusRecord && statusRecord.code === 0 && statusRecord.promptHash === hashAgentPromptFingerprint(agent),
  );
  if (!basicReuseOk) {
    return false;
  }
  const summary = readAgentExecutionSummary(statusPath, {
    agent: {
      ...agent,
      exitContract: null,
      components: [],
      componentTargets: {},
      deliverables: [],
      proofArtifacts: [],
    },
    statusPath,
    statusRecord,
    logPath: options.logPath || null,
    reportPath: options.reportPath || null,
  });
  if (!summary) {
    return false;
  }
  return validateDesignSummary(agent, summary).ok;
}

function isClosureAgentId(agent, lanePaths, waveDefinition = null) {
  return (
    resolveWaveRoleBindings(waveDefinition, lanePaths, waveDefinition?.agents).closureAgentIds.includes(
      agent?.agentId,
    ) || isSecurityReviewAgent(agent)
  );
}

export function selectReusablePreCompletedAgentIds(
  agentRuns,
  lanePaths,
  { retryOverride = null, wave = null, derivedState = null, proofRegistry = null } = {},
) {
  const retryOverrideClearedAgentIds = new Set(retryOverride?.clearReusableAgentIds || []);
  return new Set(
    (agentRuns || [])
      .filter(
        (run) =>
          !retryOverrideClearedAgentIds.has(run.agent.agentId) &&
          !isClosureAgentId(run.agent, lanePaths, wave) &&
          hasReusableSuccessStatus(run.agent, run.statusPath, {
            wave,
            derivedState,
            proofRegistry,
            logPath: run.logPath,
          }),
      )
      .map((run) => run.agent.agentId),
  );
}

export function selectInitialWaveRuns(agentRuns, lanePaths, waveDefinition = null) {
  const implementationRuns = (agentRuns || []).filter(
    (run) => !isClosureAgentId(run?.agent, lanePaths, waveDefinition),
  );
  const pendingDesignRuns = implementationRuns.filter(
    (run) =>
      isDesignAgent(run.agent) &&
      !hasReusableDesignPassStatus(run.agent, run.statusPath, {
        wave: waveDefinition,
        logPath: run.logPath,
      }),
  );
  if (pendingDesignRuns.length > 0) {
    return pendingDesignRuns;
  }
  const implementationFanoutRuns = implementationRuns.filter(
    (run) => !isDocsOnlyDesignAgent(run.agent),
  );
  if (implementationFanoutRuns.length > 0) {
    return implementationFanoutRuns;
  }
  return implementationRuns.length > 0 ? implementationRuns : agentRuns;
}

function isLauncherSeedRequest(record) {
  return (
    record?.source === "launcher" &&
    /^wave-\d+-agent-[^-]+-request$/.test(String(record.id || "")) &&
    !String(record.closureCondition || "").trim() &&
    (!Array.isArray(record.dependsOn) || record.dependsOn.length === 0)
  );
}

function runtimeMixValidationForRuns(agentRuns, lanePaths) {
  return validateWaveRuntimeMixAssignments(
    {
      wave: 0,
      agents: agentRuns.map((run) => run.agent),
    },
    { laneProfile: lanePaths.laneProfile },
  );
}

function nextExecutorModel(executorState, executorId) {
  if (executorId === "claude") {
    return executorState?.claude?.model || null;
  }
  if (executorId === "opencode") {
    return executorState?.opencode?.model || null;
  }
  return null;
}

export function executorFallbackChain(executorState) {
  if (
    executorState?.retryPolicy === "sticky" ||
    executorState?.allowFallbackOnRetry === false
  ) {
    return [];
  }
  return Array.isArray(executorState?.fallbacks)
    ? executorState.fallbacks.filter(Boolean)
    : [];
}

function buildFallbackExecutorState(executorState, executorId, attempt, reason) {
  const history = Array.isArray(executorState?.executorHistory)
    ? executorState.executorHistory
    : [];
  return {
    ...executorState,
    id: executorId,
    model: nextExecutorModel(executorState, executorId),
    selectedBy: "retry-fallback",
    fallbackUsed: true,
    fallbackReason: reason,
    initialExecutorId: executorState?.initialExecutorId || executorState?.id || executorId,
    executorHistory: [
      ...history,
      {
        attempt,
        executorId,
        reason,
      },
    ],
  };
}

function applyRetryFallbacks(agentRuns, failures, lanePaths, attemptNumber, waveDefinition = null) {
  const failedAgentIds = new Set(
    failures
      .filter((failure) => failure.statusCode !== "shared-component-sibling-pending")
      .map((failure) => failure.agentId),
  );
  let changed = false;
  const outcomes = new Map();
  for (const run of agentRuns) {
    if (!failedAgentIds.has(run.agent.agentId)) {
      continue;
    }
    const executorState = run.agent.executorResolved;
    if (!executorState) {
      outcomes.set(run.agent.agentId, {
        applied: false,
        blocking: false,
        statusCode: "no-executor-state",
        detail: `Agent ${run.agent.agentId} has no resolved executor state.`,
      });
      continue;
    }
    const fallbackChain = executorFallbackChain(executorState);
    if (fallbackChain.length === 0) {
      outcomes.set(run.agent.agentId, {
        applied: false,
        blocking: false,
        statusCode: "no-fallback-configured",
        detail: `Agent ${run.agent.agentId} has no configured fallback executors.`,
      });
      continue;
    }
    const attemptedExecutors = new Set(
      Array.isArray(executorState.executorHistory)
        ? executorState.executorHistory.map((entry) => entry.executorId)
        : [executorState.id],
    );
    const fallbackReason = failures.find((failure) => failure.agentId === run.agent.agentId);
    const blockedCandidates = [];
    for (const candidate of fallbackChain) {
      if (!candidate || candidate === executorState.id || attemptedExecutors.has(candidate)) {
        if (candidate) {
          blockedCandidates.push(`${candidate}: already tried`);
        }
        continue;
      }
      const command = commandForExecutor(executorState, candidate);
      if (!isExecutorCommandAvailable(command)) {
        blockedCandidates.push(`${candidate}: command unavailable`);
        continue;
      }
      const nextState = buildFallbackExecutorState(
        executorState,
        candidate,
        attemptNumber,
        `retry:${fallbackReason?.statusCode || "failed-attempt"}`,
      );
      const validation = runtimeMixValidationForRuns(
        agentRuns.map((entry) =>
          entry.agent.agentId === run.agent.agentId
            ? { ...entry, agent: { ...entry.agent, executorResolved: nextState } }
            : entry,
        ),
        lanePaths,
      );
      if (!validation.ok) {
        blockedCandidates.push(`${candidate}: ${validation.detail}`);
        continue;
      }
      run.agent.executorResolved = nextState;
      refreshResolvedSkillsForRun(run, waveDefinition, lanePaths);
      changed = true;
      outcomes.set(run.agent.agentId, {
        applied: true,
        blocking: false,
        statusCode: "fallback-applied",
        detail: `Agent ${run.agent.agentId} will retry on ${candidate}.`,
        executorId: candidate,
      });
      break;
    }
    if (!outcomes.has(run.agent.agentId)) {
      outcomes.set(run.agent.agentId, {
        applied: false,
        blocking: true,
        statusCode: "retry-fallback-blocked",
        detail: `Agent ${run.agent.agentId} cannot retry safely on a configured fallback (${blockedCandidates.join("; ") || "no safe fallback remained"}).`,
      });
    }
  }
  return {
    changed,
    outcomes,
  };
}

function retryBarrierFromOutcomes(outcomes, failures) {
  const blockingFailures = [];
  for (const failure of failures) {
    const outcome = outcomes.get(failure.agentId);
    if (!outcome?.blocking) {
      continue;
    }
    blockingFailures.push({
      agentId: failure.agentId,
      statusCode: outcome.statusCode,
      logPath: failure.logPath,
      detail: outcome.detail,
    });
  }
  if (blockingFailures.length === 0) {
    return null;
  }
  return {
    statusCode: "retry-fallback-blocked",
    detail: blockingFailures.map((failure) => failure.detail).join(" "),
    failures: blockingFailures,
  };
}

function runsFromAgentIds(agentRuns, agentIds) {
  const runsByAgentId = new Map((agentRuns || []).map((run) => [run.agent.agentId, run]));
  return Array.from(new Set((agentIds || []).filter(Boolean)))
    .map((agentId) => runsByAgentId.get(agentId))
    .filter(Boolean);
}

function resolveRunsForResumePhase(agentRuns, lanePaths, resumePhase, waveDefinition = null) {
  const roleBindings = resolveWaveRoleBindings(waveDefinition, lanePaths, waveDefinition?.agents);
  if (resumePhase === "design") {
    return (agentRuns || []).filter((run) => isDesignAgent(run.agent));
  }
  if (resumePhase === "integrating") {
    return runsFromAgentIds(agentRuns, [roleBindings.integrationAgentId]);
  }
  if (resumePhase === "security-review") {
    return (agentRuns || []).filter((run) => isSecurityReviewAgent(run.agent));
  }
  if (resumePhase === "docs-closure") {
    return runsFromAgentIds(agentRuns, [roleBindings.documentationAgentId]);
  }
  if (resumePhase === "cont-qa-closure") {
    return runsFromAgentIds(agentRuns, [roleBindings.contQaAgentId]);
  }
  if (resumePhase === "cont-eval") {
    return runsFromAgentIds(agentRuns, [roleBindings.contEvalAgentId]);
  }
  return [];
}

function resolveRelaunchRunsLegacy(agentRuns, failures, derivedState, lanePaths, waveDefinition = null) {
  const roleBindings = resolveWaveRoleBindings(waveDefinition, lanePaths, waveDefinition?.agents);
  const runsByAgentId = new Map(agentRuns.map((run) => [run.agent.agentId, run]));
  const pendingFeedback = (derivedState?.coordinationState?.humanFeedback || []).filter((record) =>
    isOpenCoordinationStatus(record.status),
  );
  const pendingHumanEscalations = (derivedState?.coordinationState?.humanEscalations || []).filter(
    (record) => isOpenCoordinationStatus(record.status),
  );
  if (pendingFeedback.length > 0 || pendingHumanEscalations.length > 0) {
    return { runs: [], barrier: null };
  }
  const nextAttemptNumber = Number(derivedState?.ledger?.attempt || 0) + 1;
  const fallbackResolution = applyRetryFallbacks(
    agentRuns,
    failures,
    lanePaths,
    nextAttemptNumber,
    waveDefinition,
  );
  const retryBarrier = retryBarrierFromOutcomes(fallbackResolution.outcomes, failures);
  if (retryBarrier) {
    return { runs: [], barrier: retryBarrier };
  }
  const clarificationTargets = new Set();
  for (const record of openClarificationLinkedRequests(derivedState?.coordinationState)) {
    for (const target of record.targets || []) {
      if (String(target).startsWith("agent:")) {
        clarificationTargets.add(String(target).slice("agent:".length));
      } else if (runsByAgentId.has(target)) {
        clarificationTargets.add(target);
      }
    }
  }
  if (clarificationTargets.size > 0) {
    return {
      runs: Array.from(clarificationTargets)
        .map((agentId) => runsByAgentId.get(agentId))
        .filter(Boolean),
      barrier: null,
    };
  }
  const blockingAssignments = (derivedState?.capabilityAssignments || []).filter(
    (assignment) => assignment.blocking,
  );
  const effectiveAssignments =
    blockingAssignments.length > 0
      ? blockingAssignments
      : buildRequestAssignments({
          coordinationState: derivedState?.coordinationState,
          agents: agentRuns.map((run) => run.agent),
          ledger: derivedState?.ledger,
          capabilityRouting: lanePaths?.capabilityRouting,
        }).filter((assignment) => assignment.blocking);
  const assignmentSource = effectiveAssignments.length > 0 ? effectiveAssignments : blockingAssignments;
  const unresolvedFromSource = assignmentSource.filter((assignment) => !assignment.assignedAgentId);
  if (unresolvedFromSource.length > 0) {
    return {
      runs: [],
      barrier: {
        statusCode: "helper-assignment-unresolved",
        detail: `No matching assignee exists for helper requests (${unresolvedFromSource.map((assignment) => assignment.requestId).join(", ")}).`,
        failures: unresolvedFromSource.map((assignment) => ({
          agentId: null,
          statusCode: "helper-assignment-unresolved",
          logPath: null,
          detail: assignment.assignmentDetail || assignment.summary || assignment.requestId,
        })),
      },
    };
  }
  const assignedAgentIds = new Set(
    assignmentSource.map((assignment) => assignment.assignedAgentId).filter(Boolean),
  );
  if (assignedAgentIds.size > 0) {
    return {
      runs: Array.from(assignedAgentIds)
        .map((agentId) => runsByAgentId.get(agentId))
        .filter(Boolean),
      barrier: null,
    };
  }
  const unresolvedInboundAssignments =
    derivedState?.dependencySnapshot?.unresolvedInboundAssignments || [];
  if (unresolvedInboundAssignments.length > 0) {
    return {
      runs: [],
      barrier: {
        statusCode: "dependency-assignment-unresolved",
        detail: `Required inbound dependencies are not assigned (${unresolvedInboundAssignments.map((record) => record.id).join(", ")}).`,
        failures: unresolvedInboundAssignments.map((record) => ({
          agentId: null,
          statusCode: "dependency-assignment-unresolved",
          logPath: null,
          detail: record.assignmentDetail || record.summary || record.id,
        })),
      },
    };
  }
  const inboundDependencyAgentIds = new Set(
    (derivedState?.dependencySnapshot?.openInbound || [])
      .map((record) => record.assignedAgentId)
      .filter(Boolean),
  );
  if (inboundDependencyAgentIds.size > 0) {
    return {
      runs: Array.from(inboundDependencyAgentIds)
        .map((agentId) => runsByAgentId.get(agentId))
        .filter(Boolean),
      barrier: null,
    };
  }
  const blockerAgentIds = new Set();
  for (const record of derivedState?.coordinationState?.blockers || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    blockerAgentIds.add(record.agentId);
    for (const target of record.targets || []) {
      if (String(target).startsWith("agent:")) {
        blockerAgentIds.add(String(target).slice("agent:".length));
      }
    }
  }
  if (blockerAgentIds.size > 0) {
    return {
      runs: Array.from(blockerAgentIds)
        .map((agentId) => runsByAgentId.get(agentId))
        .filter(Boolean),
      barrier: null,
    };
  }
  if (derivedState?.ledger?.phase === "docs-closure") {
    return {
      runs: [runsByAgentId.get(roleBindings.documentationAgentId)].filter(Boolean),
      barrier: null,
    };
  }
  if (derivedState?.ledger?.phase === "design") {
    return {
      runs: agentRuns.filter((run) => isDesignAgent(run.agent)),
      barrier: null,
    };
  }
  if (derivedState?.ledger?.phase === "security-review") {
    return {
      runs: agentRuns.filter((run) => isSecurityReviewAgent(run.agent)),
      barrier: null,
    };
  }
  if (derivedState?.ledger?.phase === "cont-eval") {
    return {
      runs: [runsByAgentId.get(roleBindings.contEvalAgentId)].filter(Boolean),
      barrier: null,
    };
  }
  if (derivedState?.ledger?.phase === "cont-qa-closure") {
    return {
      runs: [runsByAgentId.get(roleBindings.contQaAgentId)].filter(Boolean),
      barrier: null,
    };
  }
  if (derivedState?.ledger?.phase === "integrating") {
    return {
      runs: [runsByAgentId.get(roleBindings.integrationAgentId)].filter(Boolean),
      barrier: null,
    };
  }
  const sharedComponentWaitingAgentIds = new Set(
    (failures || [])
      .filter((failure) => failure.statusCode === "shared-component-sibling-pending")
      .flatMap((failure) => failure.waitingOnAgentIds || [])
      .filter((agentId) => runsByAgentId.has(agentId)),
  );
  if (sharedComponentWaitingAgentIds.size > 0) {
    return {
      runs: Array.from(sharedComponentWaitingAgentIds)
        .map((agentId) => runsByAgentId.get(agentId))
        .filter(Boolean),
      barrier: null,
    };
  }
  const failedAgentIds = new Set(failures.map((failure) => failure.agentId));
  return {
    runs: agentRuns.filter((run) => failedAgentIds.has(run.agent.agentId)),
    barrier: null,
  };
}

function resolveRelaunchRunsFromWaveState(
  agentRuns,
  failures,
  derivedState,
  lanePaths,
  waveDefinition,
  waveState,
) {
  const roleBindings = resolveWaveRoleBindings(waveDefinition, lanePaths, waveDefinition?.agents);
  const pendingFeedback = (waveState?.coordinationState?.humanFeedback || []).filter((record) =>
    isOpenCoordinationStatus(record.status),
  );
  const pendingHumanEscalations = (waveState?.coordinationState?.humanEscalations || []).filter(
    (record) => isOpenCoordinationStatus(record.status),
  );
  if (pendingFeedback.length > 0 || pendingHumanEscalations.length > 0) {
    return { runs: [], barrier: null };
  }

  const nextAttemptNumber = Number(derivedState?.ledger?.attempt || 0) + 1;
  const fallbackResolution = applyRetryFallbacks(
    agentRuns,
    failures,
    lanePaths,
    nextAttemptNumber,
    waveDefinition,
  );
  const retryBarrier = retryBarrierFromOutcomes(fallbackResolution.outcomes, failures);
  if (retryBarrier) {
    return { runs: [], barrier: retryBarrier };
  }

  const clarificationTargets = new Set();
  for (const record of openClarificationLinkedRequests(waveState?.coordinationState)) {
    for (const target of record.targets || []) {
      if (String(target).startsWith("agent:")) {
        clarificationTargets.add(String(target).slice("agent:".length));
      } else {
        clarificationTargets.add(target);
      }
    }
  }
  if (clarificationTargets.size > 0) {
    return {
      runs: runsFromAgentIds(agentRuns, Array.from(clarificationTargets)),
      barrier: null,
    };
  }

  const blockingAssignments = (waveState?.capabilityAssignments || []).filter(
    (assignment) => assignment.blocking,
  );
  if (blockingAssignments.length > 0) {
    const unresolvedAssignments = blockingAssignments.filter((assignment) => !assignment.assignedAgentId);
    if (unresolvedAssignments.length > 0) {
      return {
        runs: [],
        barrier: {
          statusCode: "helper-assignment-unresolved",
          detail: `No matching assignee exists for helper requests (${unresolvedAssignments.map((assignment) => assignment.requestId).join(", ")}).`,
          failures: unresolvedAssignments.map((assignment) => ({
            agentId: null,
            statusCode: "helper-assignment-unresolved",
            logPath: null,
            detail: assignment.assignmentDetail || assignment.summary || assignment.requestId,
          })),
        },
      };
    }
    return {
      runs: runsFromAgentIds(
        agentRuns,
        blockingAssignments.map((assignment) => assignment.assignedAgentId),
      ),
      barrier: null,
    };
  }

  const unresolvedInboundAssignments =
    waveState?.dependencySnapshot?.unresolvedInboundAssignments || [];
  if (unresolvedInboundAssignments.length > 0) {
    return {
      runs: [],
      barrier: {
        statusCode: "dependency-assignment-unresolved",
        detail: `Required inbound dependencies are not assigned (${unresolvedInboundAssignments.map((record) => record.id).join(", ")}).`,
        failures: unresolvedInboundAssignments.map((record) => ({
          agentId: null,
          statusCode: "dependency-assignment-unresolved",
          logPath: null,
          detail: record.assignmentDetail || record.summary || record.id,
        })),
      },
    };
  }

  const inboundDependencyAgentIds = new Set(
    (waveState?.dependencySnapshot?.openInbound || [])
      .map((record) => record.assignedAgentId)
      .filter(Boolean),
  );
  if (inboundDependencyAgentIds.size > 0) {
    return {
      runs: runsFromAgentIds(agentRuns, Array.from(inboundDependencyAgentIds)),
      barrier: null,
    };
  }

  const blockerAgentIds = new Set();
  for (const record of waveState?.coordinationState?.blockers || []) {
    if (!isOpenCoordinationStatus(record.status)) {
      continue;
    }
    blockerAgentIds.add(record.agentId);
    for (const target of record.targets || []) {
      if (String(target).startsWith("agent:")) {
        blockerAgentIds.add(String(target).slice("agent:".length));
      }
    }
  }
  if (blockerAgentIds.size > 0) {
    return {
      runs: runsFromAgentIds(agentRuns, Array.from(blockerAgentIds)),
      barrier: null,
    };
  }

  const sharedComponentWaitingAgentIds = new Set(
    (failures || [])
      .filter((failure) => failure.statusCode === "shared-component-sibling-pending")
      .flatMap((failure) => failure.waitingOnAgentIds || [])
      .filter(Boolean),
  );
  if (sharedComponentWaitingAgentIds.size > 0) {
    return {
      runs: runsFromAgentIds(agentRuns, Array.from(sharedComponentWaitingAgentIds)),
      barrier: null,
    };
  }

  const resumePlan = buildResumePlan(waveState, {
    waveDefinition,
    lanePaths,
  });
  if (!resumePlan.canResume || resumePlan.reason === "human-request") {
    return { runs: [], barrier: null };
  }

  const phaseRuns = resolveRunsForResumePhase(
    agentRuns,
    lanePaths,
    resumePlan.resumeFromPhase,
    waveDefinition,
  );
  if (phaseRuns.length > 0 && resumePlan.resumeFromPhase !== "implementation") {
    return {
      runs: phaseRuns,
      barrier: null,
    };
  }

  const retryTargetAgentIds = normalizeRetryTargets(waveState?.retryTargetSet).map(
    (target) => target.agentId,
  );
  const implementationAgentIds =
    resumePlan.invalidatedAgentIds.length > 0
      ? resumePlan.invalidatedAgentIds
      : retryTargetAgentIds;
  if (implementationAgentIds.length > 0) {
    return {
      runs: runsFromAgentIds(agentRuns, implementationAgentIds),
      barrier: null,
    };
  }

  const failedAgentIds = new Set(failures.map((failure) => failure.agentId));
  return {
    runs: agentRuns.filter((run) => failedAgentIds.has(run.agent.agentId)),
    barrier: null,
  };
}

export function resolveRelaunchRuns(
  agentRuns,
  failures,
  derivedState,
  lanePaths,
  waveDefinition = null,
  options = {},
) {
  const waveState = options?.waveState || null;
  if (!waveState) {
    return resolveRelaunchRunsLegacy(
      agentRuns,
      failures,
      derivedState,
      lanePaths,
      waveDefinition,
    );
  }
  return resolveRelaunchRunsFromWaveState(
    agentRuns,
    failures,
    derivedState,
    lanePaths,
    waveDefinition,
    waveState,
  );
}

export function preflightWavesForExecutorAvailability(waves, lanePaths) {
  for (const wave of waves) {
    const mixValidation = validateWaveRuntimeMixAssignments(wave, {
      laneProfile: lanePaths.laneProfile,
    });
    if (!mixValidation.ok) {
      throw new Error(
        `Wave ${wave.wave} exceeds lane runtime mix targets (${mixValidation.detail})`,
      );
    }
    for (const agent of wave.agents) {
      const executorState = agent.executorResolved;
      if (!executorState) {
        continue;
      }
      const chain = [executorState.id, ...executorFallbackChain(executorState)];
      const availableExecutorId = chain.find((executorId) =>
        isExecutorCommandAvailable(commandForExecutor(executorState, executorId)),
      );
      if (!availableExecutorId) {
        throw new Error(
          `Agent ${agent.agentId} has no available executor command in its configured chain (${chain.join(" -> ")})`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Resume plan — pure function, no file I/O (Wave 3)
// ---------------------------------------------------------------------------

function phaseFromGate(gateName) {
  switch (gateName) {
    case "designGate":
      return "design";
    case "implementationGate":
    case "componentGate":
    case "helperAssignmentBarrier":
    case "dependencyBarrier":
    case "clarificationBarrier":
      return "implementation";
    case "contEvalGate":
      return "cont-eval";
    case "securityGate":
      return "security-review";
    case "integrationBarrier":
      return "integrating";
    case "componentMatrixGate":
    case "documentationGate":
      return "docs-closure";
    case "contQaGate":
      return "cont-qa-closure";
    default:
      return "implementation";
  }
}

function classifyResumeReason(waveState) {
  if (waveState.closureEligibility?.waveMayClose) {
    return "all-gates-pass";
  }
  const humanBlockers = (waveState.openBlockers || []).filter(
    (blocker) => isHumanInputBlocker(blocker),
  );
  if (humanBlockers.length > 0) {
    return "human-request";
  }
  const componentPending = (waveState.openBlockers || []).some(
    (blocker) => blocker.kind === "shared-component-sibling-pending",
  );
  if (componentPending && (waveState.closureEligibility?.pendingAgentIds || []).length > 0) {
    return "shared-component-sibling-pending";
  }
  const gateSnapshot = waveState.gateSnapshot || {};
  if (gateSnapshot.overall && !gateSnapshot.overall.ok) {
    return "gate-failure";
  }
  if ((waveState.openBlockers || []).some((b) => b.kind === "timeout")) {
    return "timeout";
  }
  return "gate-failure";
}

function collectResumeHumanInputBlockers(waveState) {
  return (waveState.openBlockers || [])
    .filter((b) => isHumanInputBlocker(b))
    .map((b) => ({
      taskId: b.taskId || b.id || null,
      title: b.title || b.detail || null,
      assigneeAgentId:
        b.agentId ||
        b.assigneeAgentId ||
        (Array.isArray(b.blockedAgentIds) ? b.blockedAgentIds[0] || null : null),
    }));
}

function collectResumeGateBlockers(gateSnapshot) {
  if (!gateSnapshot?.overall || gateSnapshot.overall.ok) {
    return [];
  }
  return [{
    gate: gateSnapshot.overall.gate,
    statusCode: gateSnapshot.overall.statusCode,
    detail: gateSnapshot.overall.detail || null,
    agentId: gateSnapshot.overall.agentId || null,
  }];
}

function collectResumeExecutorChanges(waveState) {
  const retryTargets = normalizeRetryTargets(waveState.retryTargetSet);
  return retryTargets
    .filter((t) => t.reason === "rate-limit-exhausted" || t.reason === "rate-limit" || t.retriesExhausted === true)
    .map((t) => ({
      agentId: t.agentId,
      currentExecutor: t.currentExecutor || t.executor || null,
      suggestedFallback: t.retryOverride?.executorId || "claude",
      reason: t.reason || "rate-limit-exhausted",
    }));
}

/**
 * Deterministic resume planner operating on reducer output (WaveState).
 * Pure function — no file I/O.
 */
export function buildResumePlan(waveState, options = {}) {
  const waveDefinition = options.waveDefinition || {};
  const lanePaths = options.lanePaths || {};
  const reason = classifyResumeReason(waveState);
  const canResume = reason !== "all-gates-pass";
  const pendingAgentIds = waveState.closureEligibility?.pendingAgentIds || [];
  const provenAgentIds = waveState.closureEligibility?.ownedSliceProvenAgentIds || [];
  const invalidatedAgentIds = [...pendingAgentIds].sort();
  const reusableAgentIds = [...provenAgentIds].sort();
  const proofBundles =
    waveState.closureEligibility?.proofBundles ||
    waveState.proofAvailability?.activeProofBundles ||
    [];
  const reusableProofBundleIds = proofBundles
    .filter((b) => b.state === "active" && reusableAgentIds.includes(b.agentId))
    .map((b) => b.proofBundleId || b.id)
    .sort();
  const gateSnapshot = waveState.gateSnapshot || {};
  let resumeFromPhase = "completed";
  if (canResume && gateSnapshot.overall && !gateSnapshot.overall.ok) {
    resumeFromPhase = phaseFromGate(gateSnapshot.overall.gate);
  } else if (canResume) {
    resumeFromPhase = "implementation";
  }
  return {
    resumePlanVersion: 1,
    wave: waveDefinition.wave ?? waveState.wave ?? null,
    lane: lanePaths.lane ?? waveState.lane ?? null,
    attempt: waveState.attempt ?? null,
    reason,
    canResume,
    invalidatedAgentIds,
    reusableAgentIds,
    reusableProofBundleIds,
    resumeFromPhase,
    executorChanges: collectResumeExecutorChanges(waveState),
    humanInputBlockers: collectResumeHumanInputBlockers(waveState),
    gateBlockers: collectResumeGateBlockers(gateSnapshot),
    closureEligibility: waveState.closureEligibility || null,
    deterministic: true,
    createdAt: toIsoTimestamp(),
  };
}
