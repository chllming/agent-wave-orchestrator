import path from "node:path";
import {
  parseStructuredSignalsFromLog,
  refreshWaveDashboardAgentStates,
  setWaveDashboardAgent,
  updateWaveDashboardMessageBoard,
} from "./dashboard-state.mjs";
import { REPO_ROOT, toIsoTimestamp } from "./shared.mjs";
import { isSecurityReviewAgent } from "./role-helpers.mjs";
import { summarizeResolvedSkills } from "./skills.mjs";

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
  const contQaAgentId = wave.contQaAgentId || "A0";
  const contEvalAgentId = wave.contEvalAgentId || lanePaths.contEvalAgentId || "E0";
  const integrationAgentId = wave.integrationAgentId || lanePaths.integrationAgentId || "A8";
  const documentationAgentId = wave.documentationAgentId || "A9";
  const stagedRuns = [
    {
      agentId: contEvalAgentId,
      label: "cont-EVAL gate",
      runs: closureRuns.filter((run) => run.agent.agentId === contEvalAgentId),
      validate: () =>
        readWaveContEvalGateFn(wave, closureRuns, {
          contEvalAgentId,
          mode: "live",
          evalTargets: wave.evalTargets,
          benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
        }),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve cont-EVAL tuning gaps before integration closure.`,
    },
    {
      agentId: "security",
      label: "Security review",
      runs: closureRuns.filter((run) => isSecurityReviewAgent(run.agent)),
      validate: () => readWaveSecurityGateFn(wave, closureRuns),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve blocked security findings or missing approvals before integration closure.`,
    },
    {
      agentId: integrationAgentId,
      label: "Integration gate",
      runs: closureRuns.filter((run) => run.agent.agentId === integrationAgentId),
      validate: () =>
        readWaveIntegrationBarrierFn(
          wave,
          closureRuns,
          refreshDerivedState?.(dashboardState?.attempt || 0),
          {
            integrationAgentId,
            requireIntegrationStewardFromWave: lanePaths.requireIntegrationStewardFromWave,
          },
        ),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve integration contradictions or blockers before documentation and cont-QA closure.`,
    },
    {
      agentId: documentationAgentId,
      label: "Documentation closure",
      runs: closureRuns.filter((run) => run.agent.agentId === documentationAgentId),
      validate: () => {
        const documentationGate = readWaveDocumentationGateFn(wave, closureRuns);
        if (!documentationGate.ok) {
          return documentationGate;
        }
        return readWaveComponentMatrixGateFn(wave, closureRuns, {
          laneProfile: lanePaths.laneProfile,
          documentationAgentId,
        });
      },
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve the shared-plan or component-matrix closure state before cont-QA progression.`,
    },
    {
      agentId: contQaAgentId,
      label: "cont-QA gate",
      runs: closureRuns.filter((run) => run.agent.agentId === contQaAgentId),
      validate: () => readWaveContQaGateFn(wave, closureRuns, { contQaAgentId, mode: "live" }),
      actionRequested:
        `Lane ${lanePaths.lane} owners should resolve the cont-QA gate before wave progression.`,
    },
  ];
  for (const stage of stagedRuns) {
    if (stage.runs.length === 0) {
      continue;
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
      });
      runInfo.lastLaunchAttempt = dashboardState?.attempt || null;
      runInfo.lastPromptHash = launchResult?.promptHash || null;
      runInfo.lastContext7 = launchResult?.context7 || null;
      runInfo.lastExecutorId = launchResult?.executorId || runInfo.agent.executorResolved?.id || null;
      runInfo.lastSkillProjection =
        launchResult?.skills || summarizeResolvedSkills(runInfo.agent.skillsResolved);
      setWaveDashboardAgent(dashboardState, runInfo.agent.agentId, {
        state: "running",
        detail: `Closure sweep launched${launchResult?.context7?.mode ? ` (${launchResult.context7.mode})` : ""}`,
      });
      recordCombinedEvent({
        agentId: runInfo.agent.agentId,
        message: `Closure sweep launched in tmux session ${runInfo.sessionName}`,
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
          const feedbackChanged = monitorWaveHumanFeedbackFn({
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
      );
      materializeAgentExecutionSummaryForRunFn(wave, runInfo);
      refreshDerivedState?.(dashboardState?.attempt || 0);
      if (result.failures.length > 0) {
        return result;
      }
    }
    const gate = stage.validate();
    if (!gate.ok) {
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
  return { failures: [], timedOut: false };
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
