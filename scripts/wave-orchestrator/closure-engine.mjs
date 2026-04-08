import path from "node:path";
import { appendCoordinationRecord } from "./coordination-store.mjs";
import {
  parseStructuredSignalsFromLog,
  refreshWaveDashboardAgentStates,
  setWaveDashboardAgent,
  updateWaveDashboardMessageBoard,
} from "./dashboard-state.mjs";
import {
  materializeAgentExecutionSummaryForRun as materializeAgentExecutionSummaryForRunDefault,
  readWaveComponentMatrixGate as readWaveComponentMatrixGateDefault,
  readWaveContEvalGate as readWaveContEvalGateDefault,
  readWaveContQaGate as readWaveContQaGateDefault,
  readWaveDocumentationGate as readWaveDocumentationGateDefault,
  readWaveIntegrationBarrier as readWaveIntegrationBarrierDefault,
  readWaveSecurityGate as readWaveSecurityGateDefault,
  resolveGateMode,
} from "./gate-engine.mjs";
import { applyLaunchResultToRun } from "./launcher-runtime.mjs";
import { REPO_ROOT, toIsoTimestamp } from "./shared.mjs";
import {
  isSecurityReviewAgentForLane,
  resolveAgentClosureRoleKeys,
  resolveWaveRoleBindings,
} from "./role-helpers.mjs";
import { summarizeResolvedSkills } from "./skills.mjs";
import {
  resolveClosureMode as resolveClosurePolicyMode,
  resolveClosurePolicyConfig,
} from "./closure-policy.mjs";

function failureResultFromGate(gate, fallbackLogPath) {
  return {
    failures: [
      {
        agentId: gate.agentId,
        statusCode: gate.statusCode,
        logPath: gate.logPath || fallbackLogPath,
        detail: gate.detail,
      },
    ],
    timedOut: false,
  };
}

function recordClosureGateFailure({
  wave,
  lanePaths,
  gate,
  label,
  recordCombinedEvent,
  appendCoordination,
  actionRequested,
}) {
  recordCombinedEvent({
    level: "error",
    agentId: gate.agentId,
    message: `${label} blocked wave ${wave.wave}: ${gate.detail}`,
  });
  appendCoordination({
    event: "wave_gate_blocked",
    waves: [wave.wave],
    status: "blocked",
    details: `agent=${gate.agentId}; reason=${gate.statusCode}; ${gate.detail}`,
    actionRequested:
      actionRequested ||
      `Lane ${lanePaths.lane} owners should resolve the ${label.toLowerCase()} before wave progression.`,
  });
}

function isForwardableClosureGap(gate) {
  return gate?.statusCode === "wave-proof-gap";
}

function forwardedClosureGapRecord({
  stage,
  wave,
  lanePaths,
  gate,
  attempt,
  targetAgentIds = [],
}) {
  return {
    id: `wave-${wave.wave}-closure-gap-${stage.key}-${gate.agentId}-attempt-${attempt || 1}`,
    kind: "blocker",
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId: gate.agentId,
    status: "open",
    priority: "high",
    blocking: true,
    blockerSeverity: "closure-critical",
    summary: `${stage.label} reported a proof gap and was forwarded to later closure stages.`,
    detail: gate.detail,
    artifactRefs: gate.logPath ? [gate.logPath] : [],
    targets: targetAgentIds.map((agentId) => `agent:${agentId}`),
    attempt: attempt || 1,
  };
}

function stageRequiresRun(stage, wave, lanePaths) {
  switch (stage.key) {
    case "integration": {
      const threshold = lanePaths?.requireIntegrationStewardFromWave;
      if (threshold === null || threshold === undefined) {
        return Array.isArray(wave?.agents) && wave.agents.some((agent) => agent?.agentId === stage.agentId);
      }
      return wave.wave >= threshold;
    }
    case "documentation": {
      const docThreshold = lanePaths?.requireDocumentationStewardFromWave;
      if (docThreshold === null || docThreshold === undefined) {
        return Array.isArray(wave?.agents) && wave.agents.some((agent) => agent?.agentId === stage.agentId);
      }
      return wave.wave >= docThreshold;
    }
    case "cont-qa":
      return true;
    case "cont-eval":
      return Array.isArray(wave?.agents) && wave.agents.some((agent) => agent?.agentId === stage.agentId);
    case "security-review":
      return (
        Array.isArray(wave?.agents) &&
        wave.agents.some((agent) => isSecurityReviewAgentForLane(agent, lanePaths))
      );
    default:
      return false;
  }
}

function missingClosureRunGate(stage) {
  return {
    ok: false,
    agentId: stage.agentId,
    statusCode: "missing-closure-run",
    detail: `${stage.label} is required for this wave but no matching closure run was provided.`,
    logPath: null,
  };
}

function shouldEvaluateStageBeforeLaunch(stage) {
  return stage.key === "integration" || stage.key === "documentation";
}

function shouldSkipContQaStage({
  stage,
  wave,
  lanePaths,
  semanticClosureStagesRan,
}) {
  if (stage.key !== "cont-qa" || semanticClosureStagesRan) {
    return false;
  }
  const closurePolicy = resolveClosurePolicyConfig(lanePaths);
  if (!closurePolicy.autoClosure.allowSkipContQaInBootstrap) {
    return false;
  }
  const closureMode = resolveClosurePolicyMode(
    wave.wave,
    closurePolicy.closureModeThresholds,
  );
  return closureMode === "bootstrap";
}

export async function runClosureSweepPhase({
  lanePaths,
  wave,
  closureRuns,
  coordinationLogPath,
  refreshDerivedState,
  dashboardState,
  recordCombinedEvent,
  flushDashboards,
  options,
  feedbackStateByRequestId,
  appendCoordination,
  launchAgentSessionFn,
  waitForWaveCompletionFn,
  readWaveContEvalGateFn,
  readWaveSecurityGateFn,
  readWaveIntegrationBarrierFn,
  readWaveDocumentationGateFn,
  readWaveComponentMatrixGateFn,
  readWaveContQaGateFn,
  materializeAgentExecutionSummaryForRunFn,
  monitorWaveHumanFeedbackFn,
}) {
  const materializeSummary =
    typeof materializeAgentExecutionSummaryForRunFn === "function"
      ? materializeAgentExecutionSummaryForRunFn
      : materializeAgentExecutionSummaryForRunDefault;
  const monitorHumanFeedback =
    typeof monitorWaveHumanFeedbackFn === "function"
      ? monitorWaveHumanFeedbackFn
      : () => false;
  const readContEvalGate =
    typeof readWaveContEvalGateFn === "function"
      ? readWaveContEvalGateFn
      : readWaveContEvalGateDefault;
  const readSecurityGate =
    typeof readWaveSecurityGateFn === "function"
      ? readWaveSecurityGateFn
      : readWaveSecurityGateDefault;
  const readIntegrationBarrier =
    typeof readWaveIntegrationBarrierFn === "function"
      ? readWaveIntegrationBarrierFn
      : readWaveIntegrationBarrierDefault;
  const readDocumentationGate =
    typeof readWaveDocumentationGateFn === "function"
      ? readWaveDocumentationGateFn
      : readWaveDocumentationGateDefault;
  const readComponentMatrixGate =
    typeof readWaveComponentMatrixGateFn === "function"
      ? readWaveComponentMatrixGateFn
      : readWaveComponentMatrixGateDefault;
  const readContQaGate =
    typeof readWaveContQaGateFn === "function"
      ? readWaveContQaGateFn
      : readWaveContQaGateDefault;
  const stagedRuns = planClosureStages({ lanePaths, wave, closureRuns });
  const forwardedFailures = [];
  const { contQaAgentId, contEvalAgentId, integrationAgentId, documentationAgentId } =
    resolveWaveRoleBindings(wave, lanePaths);
  const _gateThresholds = lanePaths?.gateModeThresholds || lanePaths?.validation?.gateModeThresholds || options?.gateModeThresholds || null;
  const _resolvedGateMode = resolveGateMode(wave.wave, _gateThresholds);
  let semanticClosureStagesRan = false;
  for (const [stageIndex, stage] of stagedRuns.entries()) {
    const currentDerivedState = refreshDerivedState?.(dashboardState?.attempt || 0) || null;
    if (shouldEvaluateStageBeforeLaunch(stage)) {
      const preLaunchGate = evaluateClosureStage({
        stage,
        wave,
        closureRuns,
        lanePaths,
        dashboardState,
        derivedState: currentDerivedState,
        refreshDerivedState,
        readWaveContEvalGateFn: readContEvalGate,
        readWaveSecurityGateFn: readSecurityGate,
        readWaveIntegrationBarrierFn: readIntegrationBarrier,
        readWaveDocumentationGateFn: readDocumentationGate,
        readWaveComponentMatrixGateFn: readComponentMatrixGate,
        readWaveContQaGateFn: readContQaGate,
        contEvalAgentId,
        integrationAgentId,
        documentationAgentId,
        contQaAgentId,
      });
      const autoSatisfiedStage =
        preLaunchGate.ok &&
        !preLaunchGate.agentId &&
        (preLaunchGate.integrationState || preLaunchGate.docClosureState);
      if (autoSatisfiedStage) {
        recordCombinedEvent({
          agentId: stage.agentId || null,
          message: `${stage.label} already satisfied before launch: ${preLaunchGate.detail}`,
        });
        continue;
      }
    }
    if (
      shouldSkipContQaStage({
        stage,
        wave,
        lanePaths,
        semanticClosureStagesRan,
      })
    ) {
      recordCombinedEvent({
        agentId: stage.agentId || null,
        message:
          "cont-QA gate skipped in bootstrap because closure remained on the low-entropy fast path.",
      });
      continue;
    }
    if (stage.runs.length === 0) {
      if (_resolvedGateMode === "bootstrap" && stage.key !== "cont-qa") {
        continue;
      }
      if (stageRequiresRun(stage, wave, lanePaths)) {
        const gate = missingClosureRunGate(stage);
        recordClosureGateFailure({
          wave,
          lanePaths,
          gate,
          label: stage.label,
          recordCombinedEvent,
          appendCoordination,
          actionRequested: stage.actionRequested,
        });
        return failureResultFromGate(gate, null);
      }
      continue;
    }
    if (stage.key !== "cont-qa") {
      semanticClosureStagesRan = true;
    }
    for (const runInfo of stage.runs) {
      const existing = dashboardState.agents.find((entry) => entry.agentId === runInfo.agent.agentId);
      setWaveDashboardAgent(dashboardState, runInfo.agent.agentId, {
        state: "launching",
        attempts: (existing?.attempts || 0) + 1,
        startedAt: existing?.startedAt || toIsoTimestamp(),
        completedAt: null,
        exitCode: null,
        detail: "Launching closure sweep",
      });
      flushDashboards();
      const launchResult = await launchAgentSessionFn(lanePaths, {
        wave: wave.wave,
        waveDefinition: wave,
        agent: runInfo.agent,
        sessionName: runInfo.sessionName,
        promptPath: runInfo.promptPath,
        logPath: runInfo.logPath,
        statusPath: runInfo.statusPath,
        runtimePath: runInfo.runtimePath,
        messageBoardPath: runInfo.messageBoardPath,
        messageBoardSnapshot: runInfo.messageBoardSnapshot || "",
        sharedSummaryPath: runInfo.sharedSummaryPath,
        sharedSummaryText: runInfo.sharedSummaryText,
        inboxPath: runInfo.inboxPath,
        inboxText: runInfo.inboxText,
        orchestratorId: options.orchestratorId,
        executorMode: options.executorMode,
        codexSandboxMode: options.codexSandboxMode,
        agentRateLimitRetries: options.agentRateLimitRetries,
        agentRateLimitBaseDelaySeconds: options.agentRateLimitBaseDelaySeconds,
        agentRateLimitMaxDelaySeconds: options.agentRateLimitMaxDelaySeconds,
        context7Enabled: options.context7Enabled,
        attempt: dashboardState?.attempt || 1,
        controlPlane: {
          waveNumber: wave.wave,
          attempt: dashboardState?.attempt || 1,
        },
      });
      applyLaunchResultToRun(runInfo, launchResult, {
        attempt: dashboardState?.attempt || null,
        fallbackExecutorId: runInfo.agent.executorResolved?.id || null,
        fallbackSkills: summarizeResolvedSkills(runInfo.agent.skillsResolved),
      });
      setWaveDashboardAgent(dashboardState, runInfo.agent.agentId, {
        state: "running",
        detail: `Closure sweep launched${launchResult?.context7?.mode ? ` (${launchResult.context7.mode})` : ""}`,
      });
      recordCombinedEvent({
        agentId: runInfo.agent.agentId,
        message: `Closure sweep launched via ${launchResult?.sessionBackend || "process"} backend`,
      });
      flushDashboards();
      const result = await waitForWaveCompletionFn(
        lanePaths,
        [runInfo],
        options.timeoutMinutes,
        ({ pendingAgentIds }) => {
          refreshWaveDashboardAgentStates(dashboardState, [runInfo], pendingAgentIds, (event) =>
            recordCombinedEvent(event),
          );
          const feedbackChanged = monitorHumanFeedback({
            lanePaths,
            waveNumber: wave.wave,
            agentRuns: [runInfo],
            orchestratorId: options.orchestratorId,
            coordinationLogPath,
            feedbackStateByRequestId,
            recordCombinedEvent,
            appendCoordination,
          });
          if (feedbackChanged) {
            refreshDerivedState?.(dashboardState?.attempt || 0);
          }
          updateWaveDashboardMessageBoard(dashboardState, runInfo.messageBoardPath);
          flushDashboards();
        },
        {
          controlPlane: {
            waveNumber: wave.wave,
            attempt: dashboardState?.attempt || 1,
          },
        },
      );
      materializeSummary(wave, runInfo);
      refreshDerivedState?.(dashboardState?.attempt || 0);
      if (result.failures.length > 0) {
        return result;
      }
    }
    const gate = evaluateClosureStage({
      stage,
      wave,
      closureRuns,
      lanePaths,
      dashboardState,
      derivedState: refreshDerivedState?.(dashboardState?.attempt || 0) || currentDerivedState,
      refreshDerivedState,
      readWaveContEvalGateFn: readContEvalGate,
      readWaveSecurityGateFn: readSecurityGate,
      readWaveIntegrationBarrierFn: readIntegrationBarrier,
      readWaveDocumentationGateFn: readDocumentationGate,
      readWaveComponentMatrixGateFn: readComponentMatrixGate,
      readWaveContQaGateFn: readContQaGate,
      contEvalAgentId,
      integrationAgentId,
      documentationAgentId,
      contQaAgentId,
    });
    if (!gate.ok) {
      if (isForwardableClosureGap(gate)) {
        const targetAgentIds = stagedRuns
          .slice(stageIndex + 1)
          .flatMap((candidate) => candidate.runs.map((run) => run.agent.agentId))
          .filter(Boolean);
        forwardedFailures.push({
          agentId: gate.agentId,
          statusCode: gate.statusCode,
          logPath: gate.logPath || (stage.runs[0]?.logPath ? path.relative(REPO_ROOT, stage.runs[0].logPath) : null),
          detail: gate.detail,
        });
        appendCoordinationRecord(
          coordinationLogPath,
          forwardedClosureGapRecord({
            stage,
            wave,
            lanePaths,
            gate,
            attempt: dashboardState?.attempt || 1,
            targetAgentIds,
          }),
        );
        recordCombinedEvent({
          level: "warn",
          agentId: gate.agentId,
          message: `${stage.label} reported a proof gap; continuing later closure stages with the gap as input.`,
        });
        appendCoordination({
          event: "closure_gap_forwarded",
          waves: [wave.wave],
          status: "blocked",
          details: `agent=${gate.agentId}; reason=${gate.statusCode}; ${gate.detail}`,
          actionRequested: `Lane ${lanePaths.lane} owners should resolve the forwarded closure proof gap after downstream closure evidence is collected.`,
        });
        refreshDerivedState?.(dashboardState?.attempt || 0);
        continue;
      }
      recordClosureGateFailure({
        wave,
        lanePaths,
        gate,
        label: stage.label,
        recordCombinedEvent,
        appendCoordination,
        actionRequested: stage.actionRequested,
      });
      return failureResultFromGate(
        gate,
        stage.runs[0]?.logPath ? path.relative(REPO_ROOT, stage.runs[0].logPath) : null,
      );
    }
  }
  return { failures: forwardedFailures, timedOut: false };
}

export function planClosureStages({ lanePaths, wave, closureRuns }) {
  const roleBindings = resolveWaveRoleBindings(wave, lanePaths);
  const { contQaAgentId, contEvalAgentId, integrationAgentId, documentationAgentId } =
    roleBindings;
  const runHasRole = (run, roleKey) =>
    resolveAgentClosureRoleKeys(run.agent, roleBindings, lanePaths).includes(roleKey);
  return [
    {
      key: "cont-eval",
      agentId: contEvalAgentId,
      label: "cont-EVAL gate",
      runs: closureRuns.filter((run) => runHasRole(run, "cont-eval")),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve cont-EVAL tuning gaps before integration closure.`,
    },
    {
      key: "security-review",
      agentId: "security",
      label: "Security review",
      runs: closureRuns.filter((run) => runHasRole(run, "security-review")),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve blocked security findings or missing approvals before integration closure.`,
    },
    {
      key: "integration",
      agentId: integrationAgentId,
      label: "Integration gate",
      runs: closureRuns.filter((run) => runHasRole(run, "integration")),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve integration contradictions or blockers before documentation and cont-QA closure.`,
    },
    {
      key: "documentation",
      agentId: documentationAgentId,
      label: "Documentation closure",
      runs: closureRuns.filter((run) => runHasRole(run, "documentation")),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve the shared-plan or component-matrix closure state before cont-QA progression.`,
    },
    {
      key: "cont-qa",
      agentId: contQaAgentId,
      label: "cont-QA gate",
      runs: closureRuns.filter((run) => runHasRole(run, "cont-qa")),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve the cont-QA gate before wave progression.`,
    },
  ];
}

function evaluateClosureStage({
  stage,
  wave,
  closureRuns,
  lanePaths,
  dashboardState,
  derivedState,
  refreshDerivedState,
  readWaveContEvalGateFn,
  readWaveSecurityGateFn,
  readWaveIntegrationBarrierFn,
  readWaveDocumentationGateFn,
  readWaveComponentMatrixGateFn,
  readWaveContQaGateFn,
  contEvalAgentId,
  integrationAgentId,
  documentationAgentId,
  contQaAgentId,
}) {
  switch (stage.key) {
    case "cont-eval":
      return readWaveContEvalGateFn(wave, closureRuns, {
        contEvalAgentId,
        mode: "live",
        evalTargets: wave.evalTargets,
        benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
      });
    case "security-review":
      return readWaveSecurityGateFn(wave, closureRuns, {
        mode: "live",
        securityRolePromptPath: lanePaths?.securityRolePromptPath,
      });
    case "integration":
      return readWaveIntegrationBarrierFn(
        wave,
        closureRuns,
        derivedState || refreshDerivedState?.(dashboardState?.attempt || 0),
        {
          integrationAgentId,
          mode: "live",
          requireIntegrationStewardFromWave: lanePaths.requireIntegrationStewardFromWave,
          laneProfile: lanePaths.laneProfile,
          autoClosure: lanePaths.autoClosure,
        },
      );
    case "documentation": {
      const componentMatrixGate = readWaveComponentMatrixGateFn(wave, closureRuns, {
        laneProfile: lanePaths.laneProfile,
        documentationAgentId,
      });
      const documentationGate = readWaveDocumentationGateFn(wave, closureRuns, {
        mode: "live",
        derivedState: derivedState || refreshDerivedState?.(dashboardState?.attempt || 0),
        documentationAgentId,
        laneProfile: lanePaths.laneProfile,
        autoClosure: lanePaths.autoClosure,
        componentMatrixGate,
      });
      if (!documentationGate.ok) {
        return documentationGate;
      }
      return {
        ...componentMatrixGate,
        docClosureState: documentationGate.docClosureState || null,
        detail:
          documentationGate.docClosureState && componentMatrixGate.ok
            ? documentationGate.detail
            : componentMatrixGate.detail,
      };
    }
    case "cont-qa":
      return readWaveContQaGateFn(wave, closureRuns, {
        contQaAgentId,
        mode: "live",
      });
    default:
      return {
        ok: true,
        agentId: null,
        statusCode: "pass",
        detail: "No closure stage configured.",
        logPath: null,
      };
  }
}

const NON_BLOCKING_INFRA_SIGNAL_STATES = new Set([
  "conformant",
  "setup-required",
  "setup-in-progress",
  "action-required",
  "action-approved",
  "action-complete",
]);

export function readWaveInfraGate(agentRuns) {
  for (const run of agentRuns) {
    const signals = parseStructuredSignalsFromLog(run.logPath);
    if (!signals?.infra) {
      continue;
    }
    const infra = signals.infra;
    const normalizedState = String(infra.state || "")
      .trim()
      .toLowerCase();
    if (NON_BLOCKING_INFRA_SIGNAL_STATES.has(normalizedState)) {
      continue;
    }
    return {
      ok: false,
      agentId: run.agent.agentId,
      statusCode: `infra-${normalizedState || "blocked"}`,
      detail: `Infra signal ${infra.kind || "unknown"} on ${infra.target || "unknown"} ended in state ${normalizedState || "unknown"}${infra.detail ? ` (${infra.detail})` : ""}.`,
      logPath: path.relative(REPO_ROOT, run.logPath),
    };
  }
  return {
    ok: true,
    agentId: null,
    statusCode: "pass",
    detail: "No blocking infra signals detected.",
    logPath: null,
  };
}
