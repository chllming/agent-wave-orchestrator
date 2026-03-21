import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CODEX_SANDBOX_MODES,
  DEFAULT_CODEX_SANDBOX_MODE,
  normalizeCodexSandboxMode,
  normalizeExecutorMode,
  SUPPORTED_EXECUTOR_MODES,
} from "./config.mjs";
import {
  appendOrchestratorBoardEntry,
  buildExecutionPrompt,
  ensureOrchestratorBoard,
  ensureWaveMessageBoard,
  feedbackStateSignature,
  readMessageBoardSnapshot,
  readWaveHumanFeedbackRequests,
} from "./coordination.mjs";
import {
  applyContext7SelectionsToWave,
  describeContext7Libraries,
  hashAgentPromptFingerprint,
  loadContext7BundleIndex,
  prefetchContext7ForSelection,
} from "./context7.mjs";
import {
  buildGlobalDashboardState,
  buildWaveDashboardState,
  getGlobalWaveEntry,
  parseStructuredSignalsFromLog,
  readStatusCodeIfPresent,
  recordGlobalDashboardEvent,
  recordWaveDashboardEvent,
  refreshWaveDashboardAgentStates,
  setWaveDashboardAgent,
  syncGlobalWaveFromWaveDashboard,
  updateWaveDashboardMessageBoard,
  writeGlobalDashboard,
  writeWaveDashboard,
} from "./dashboard-state.mjs";
import {
  DEFAULT_AGENT_LAUNCH_STAGGER_MS,
  DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS,
  DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS,
  DEFAULT_AGENT_RATE_LIMIT_RETRIES,
  DEFAULT_MAX_RETRIES_PER_WAVE,
  DEFAULT_TIMEOUT_MINUTES,
  DEFAULT_WAIT_PROGRESS_INTERVAL_MS,
  DEFAULT_WAVE_LANE,
  parseVerdictFromText,
  readStatusRecordIfPresent,
  REPO_ROOT,
  buildLanePaths,
  ensureDirectory,
  parseNonNegativeInt,
  parsePositiveInt,
  readFileTail,
  readJsonOrNull,
  REPORT_VERDICT_REGEX,
  sanitizeOrchestratorId,
  shellQuote,
  sleep,
  TMUX_COMMAND_TIMEOUT_MS,
  WAVE_VERDICT_REGEX,
  WAVE_TERMINAL_STATES,
  toIsoTimestamp,
} from "./shared.mjs";
import {
  appendTerminalEntries,
  createGlobalDashboardTerminalEntry,
  createTemporaryTerminalEntries,
  killTmuxSessionIfExists,
  pruneOrphanLaneTemporaryTerminalEntries,
  removeLaneTemporaryTerminalEntries,
  removeTerminalEntries,
} from "./terminals.mjs";
import {
  buildCodexExecInvocation,
  buildExecutorLaunchSpec,
  preflightExecutorsForWaves,
} from "./executors.mjs";
import {
  buildManifest,
  applyExecutorSelectionsToWave,
  markWaveCompleted,
  parseWaveFiles,
  reconcileRunStateFromStatusFiles,
  resolveAutoNextWaveStart,
  validateWaveDefinition,
  writeManifest,
} from "./wave-files.mjs";
import {
  agentSummaryPathFromStatusPath,
  buildAgentExecutionSummary,
  readAgentExecutionSummary,
  validateDocumentationClosureSummary,
  validateEvaluatorSummary,
  validateImplementationSummary,
  writeAgentExecutionSummary,
} from "./agent-state.mjs";
export { CODEX_SANDBOX_MODES, DEFAULT_CODEX_SANDBOX_MODE, normalizeCodexSandboxMode, buildCodexExecInvocation };

function printUsage(lanePaths) {
  console.log(`Usage: node scripts/wave-launcher.mjs [options]

Options:
  --lane <name>          Wave lane name (default: ${DEFAULT_WAVE_LANE})
  --start-wave <n>       Start from wave number (default: 0)
  --end-wave <n>         End at wave number (default: last available)
  --auto-next            Start from the next unfinished wave and continue forward
  --reconcile-status     Reconcile run-state from agent status files and exit
  --state-file <path>    Path to run-state JSON (default: ${path.relative(REPO_ROOT, lanePaths.defaultRunStatePath)})
  --timeout-minutes <n>  Max minutes to wait per wave (default: ${DEFAULT_TIMEOUT_MINUTES})
  --max-retries-per-wave <n>
                        Relaunch failed or missing jobs per wave (default: ${DEFAULT_MAX_RETRIES_PER_WAVE})
  --agent-rate-limit-retries <n>
                        Per-agent retries for 429 or rate-limit errors (default: ${DEFAULT_AGENT_RATE_LIMIT_RETRIES})
  --agent-rate-limit-base-delay-seconds <n>
                        Base exponential backoff delay for 429 retries (default: ${DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS})
  --agent-rate-limit-max-delay-seconds <n>
                        Max backoff delay for 429 retries (default: ${DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS})
  --agent-launch-stagger-ms <n>
                        Delay between agent launches (default: ${DEFAULT_AGENT_LAUNCH_STAGGER_MS})
  --executor <mode>      Default agent executor mode: ${SUPPORTED_EXECUTOR_MODES.join(" | ")} (default: ${lanePaths.executors.default})
  --codex-sandbox <mode> Codex sandbox mode: ${CODEX_SANDBOX_MODES.join(" | ")} (default: ${DEFAULT_CODEX_SANDBOX_MODE})
  --manifest-out <path>  Write parsed wave manifest JSON (default: ${path.relative(REPO_ROOT, lanePaths.defaultManifestPath)})
  --dry-run              Parse waves and update manifest only
  --no-dashboard         Disable per-wave tmux dashboard session
  --cleanup-sessions     Kill lane tmux sessions after each wave (default: on)
  --keep-sessions        Keep lane tmux sessions after each wave
  --keep-terminals       Do not remove temporary terminal entries after each wave
  --orchestrator-id <id> Stable orchestrator identity for cross-lane coordination
  --orchestrator-board <path>
                        Path to shared orchestrator coordination board (default: ${path.relative(REPO_ROOT, lanePaths.defaultOrchestratorBoardPath)})
  --no-orchestrator-board
                        Disable orchestrator coordination board updates for this run
  --coordination-note <text>
                        Optional startup intent note appended to orchestrator board
  --no-context7         Disable launcher-side Context7 prefetch/injection
  --help                 Show this help message
`);
}

function parseArgs(argv) {
  let lanePaths = buildLanePaths(DEFAULT_WAVE_LANE);
  const options = {
    lane: DEFAULT_WAVE_LANE,
    startWave: 0,
    endWave: null,
    autoNext: false,
    reconcileStatus: false,
    runStatePath: lanePaths.defaultRunStatePath,
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
    maxRetriesPerWave: DEFAULT_MAX_RETRIES_PER_WAVE,
    agentRateLimitRetries: DEFAULT_AGENT_RATE_LIMIT_RETRIES,
    agentRateLimitBaseDelaySeconds: DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS,
    agentRateLimitMaxDelaySeconds: DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS,
    agentLaunchStaggerMs: DEFAULT_AGENT_LAUNCH_STAGGER_MS,
    executorMode: lanePaths.executors.default,
    codexSandboxMode: DEFAULT_CODEX_SANDBOX_MODE,
    manifestOut: lanePaths.defaultManifestPath,
    dryRun: false,
    dashboard: true,
    cleanupSessions: true,
    keepTerminals: false,
    context7Enabled: true,
    orchestratorId: null,
    orchestratorBoardPath: null,
    coordinationNote: "",
  };
  let stateFileProvided = false;
  let manifestOutProvided = false;
  let orchestratorBoardProvided = false;
  let executorProvided = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, lanePaths, options };
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-dashboard") {
      options.dashboard = false;
    } else if (arg === "--cleanup-sessions") {
      options.cleanupSessions = true;
    } else if (arg === "--keep-sessions") {
      options.cleanupSessions = false;
    } else if (arg === "--auto-next") {
      options.autoNext = true;
    } else if (arg === "--reconcile-status") {
      options.reconcileStatus = true;
    } else if (arg === "--keep-terminals") {
      options.keepTerminals = true;
    } else if (arg === "--no-context7") {
      options.context7Enabled = false;
    } else if (arg === "--no-orchestrator-board") {
      options.orchestratorBoardPath = null;
      orchestratorBoardProvided = true;
    } else if (arg === "--lane") {
      options.lane = String(argv[++i] || "").trim();
      lanePaths = buildLanePaths(options.lane);
    } else if (arg === "--orchestrator-id") {
      options.orchestratorId = sanitizeOrchestratorId(argv[++i]);
    } else if (arg === "--orchestrator-board") {
      options.orchestratorBoardPath = path.resolve(REPO_ROOT, argv[++i] || "");
      orchestratorBoardProvided = true;
    } else if (arg === "--coordination-note") {
      options.coordinationNote = String(argv[++i] || "").trim();
    } else if (arg === "--state-file") {
      options.runStatePath = path.resolve(REPO_ROOT, argv[++i] || "");
      stateFileProvided = true;
    } else if (arg === "--start-wave") {
      options.startWave = parseNonNegativeInt(argv[++i], "--start-wave");
    } else if (arg === "--end-wave") {
      options.endWave = parseNonNegativeInt(argv[++i], "--end-wave");
    } else if (arg === "--timeout-minutes") {
      options.timeoutMinutes = parsePositiveInt(argv[++i], "--timeout-minutes");
    } else if (arg === "--max-retries-per-wave") {
      options.maxRetriesPerWave = parseNonNegativeInt(argv[++i], "--max-retries-per-wave");
    } else if (arg === "--agent-rate-limit-retries") {
      options.agentRateLimitRetries = parseNonNegativeInt(argv[++i], "--agent-rate-limit-retries");
    } else if (arg === "--agent-rate-limit-base-delay-seconds") {
      options.agentRateLimitBaseDelaySeconds = parsePositiveInt(
        argv[++i],
        "--agent-rate-limit-base-delay-seconds",
      );
    } else if (arg === "--agent-rate-limit-max-delay-seconds") {
      options.agentRateLimitMaxDelaySeconds = parsePositiveInt(
        argv[++i],
        "--agent-rate-limit-max-delay-seconds",
      );
    } else if (arg === "--agent-launch-stagger-ms") {
      options.agentLaunchStaggerMs = parseNonNegativeInt(argv[++i], "--agent-launch-stagger-ms");
    } else if (arg === "--executor") {
      options.executorMode = normalizeExecutorMode(argv[++i], "--executor");
      executorProvided = true;
    } else if (arg === "--codex-sandbox") {
      options.codexSandboxMode = normalizeCodexSandboxMode(argv[++i], "--codex-sandbox");
    } else if (arg === "--manifest-out") {
      options.manifestOut = path.resolve(REPO_ROOT, argv[++i] || "");
      manifestOutProvided = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  lanePaths = buildLanePaths(options.lane, {
    runVariant: options.dryRun ? "dry-run" : undefined,
  });
  if (!stateFileProvided) {
    options.runStatePath = lanePaths.defaultRunStatePath;
  }
  if (!manifestOutProvided) {
    options.manifestOut = lanePaths.defaultManifestPath;
  }
  if (!orchestratorBoardProvided) {
    options.orchestratorBoardPath = lanePaths.defaultOrchestratorBoardPath;
  }
  if (!executorProvided) {
    options.executorMode = lanePaths.executors.default;
  }
  options.orchestratorId ||= sanitizeOrchestratorId(`${lanePaths.lane}-orch-${process.pid}`);
  if (options.agentRateLimitMaxDelaySeconds < options.agentRateLimitBaseDelaySeconds) {
    throw new Error(
      "--agent-rate-limit-max-delay-seconds must be >= --agent-rate-limit-base-delay-seconds",
    );
  }
  if (!options.autoNext && options.endWave !== null && options.endWave < options.startWave) {
    throw new Error("--end-wave must be >= --start-wave");
  }
  return { help: false, lanePaths, options };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readWaveEvaluatorGate(wave, agentRuns, options = {}) {
  const evaluatorAgentId = options.evaluatorAgentId || wave.evaluatorAgentId || "A0";
  const evaluatorRun =
    agentRuns.find((run) => run.agent.agentId === evaluatorAgentId) ?? null;
  if (!evaluatorRun) {
    return {
      ok: false,
      agentId: evaluatorAgentId,
      statusCode: "missing-evaluator",
      detail: `Agent ${evaluatorAgentId} is missing.`,
      logPath: null,
    };
  }
  const summary =
    evaluatorRun.statusPath && fs.existsSync(agentSummaryPathFromStatusPath(evaluatorRun.statusPath))
      ? readAgentExecutionSummary(evaluatorRun.statusPath)
      : null;
  if (summary) {
    const validation = validateEvaluatorSummary(evaluatorRun.agent, summary);
    return {
      ok: validation.ok,
      agentId: evaluatorRun.agent.agentId,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: summary.logPath || path.relative(REPO_ROOT, evaluatorRun.logPath),
    };
  }
  const evaluatorReportPath = wave.evaluatorReportPath
    ? path.resolve(REPO_ROOT, wave.evaluatorReportPath)
    : null;
  const reportText =
    evaluatorReportPath && fs.existsSync(evaluatorReportPath)
      ? fs.readFileSync(evaluatorReportPath, "utf8")
      : "";
  const reportVerdict = parseVerdictFromText(reportText, REPORT_VERDICT_REGEX);
  if (reportVerdict.verdict) {
    return {
      ok: reportVerdict.verdict === "pass",
      agentId: evaluatorRun.agent.agentId,
      statusCode: reportVerdict.verdict === "pass" ? "pass" : `evaluator-${reportVerdict.verdict}`,
      detail: reportVerdict.detail || "Verdict read from evaluator report.",
      logPath: path.relative(REPO_ROOT, evaluatorRun.logPath),
    };
  }
  const logVerdict = parseVerdictFromText(
    readFileTail(evaluatorRun.logPath, 30000),
    WAVE_VERDICT_REGEX,
  );
  if (logVerdict.verdict) {
    return {
      ok: logVerdict.verdict === "pass",
      agentId: evaluatorRun.agent.agentId,
      statusCode: logVerdict.verdict === "pass" ? "pass" : `evaluator-${logVerdict.verdict}`,
      detail: logVerdict.detail || "Verdict read from evaluator log marker.",
      logPath: path.relative(REPO_ROOT, evaluatorRun.logPath),
    };
  }
  return {
    ok: false,
    agentId: evaluatorRun.agent.agentId,
    statusCode: "missing-evaluator-verdict",
    detail: evaluatorReportPath
      ? `Missing Verdict line in ${path.relative(REPO_ROOT, evaluatorReportPath)} and no [wave-verdict] marker in ${path.relative(REPO_ROOT, evaluatorRun.logPath)}.`
      : `Missing evaluator report path and no [wave-verdict] marker in ${path.relative(REPO_ROOT, evaluatorRun.logPath)}.`,
    logPath: path.relative(REPO_ROOT, evaluatorRun.logPath),
  };
}

function materializeAgentExecutionSummaryForRun(wave, runInfo) {
  const statusRecord = readStatusRecordIfPresent(runInfo.statusPath);
  if (!statusRecord) {
    return null;
  }
  const reportPath =
    runInfo.agent.agentId === (wave.evaluatorAgentId || "A0") && wave.evaluatorReportPath
      ? path.resolve(REPO_ROOT, wave.evaluatorReportPath)
      : null;
  const summary = buildAgentExecutionSummary({
    agent: runInfo.agent,
    statusRecord,
    logPath: runInfo.logPath,
    reportPath,
  });
  writeAgentExecutionSummary(runInfo.statusPath, summary);
  return summary;
}

function materializeAgentExecutionSummaries(wave, agentRuns) {
  return Object.fromEntries(
    agentRuns.map((runInfo) => [runInfo.agent.agentId, materializeAgentExecutionSummaryForRun(wave, runInfo)]),
  );
}

function readWaveImplementationGate(wave, agentRuns) {
  const evaluatorAgentId = wave.evaluatorAgentId || "A0";
  const documentationAgentId = wave.documentationAgentId || "A9";
  for (const runInfo of agentRuns) {
    if ([evaluatorAgentId, documentationAgentId].includes(runInfo.agent.agentId)) {
      continue;
    }
    const summary = readAgentExecutionSummary(runInfo.statusPath);
    const validation = validateImplementationSummary(runInfo.agent, summary);
    if (!validation.ok) {
      return {
        ok: false,
        agentId: runInfo.agent.agentId,
        statusCode: validation.statusCode,
        detail: validation.detail,
        logPath: summary?.logPath || path.relative(REPO_ROOT, runInfo.logPath),
      };
    }
  }
  return {
    ok: true,
    agentId: null,
    statusCode: "pass",
    detail: "All implementation exit contracts are satisfied.",
    logPath: null,
  };
}

function readWaveDocumentationGate(wave, agentRuns) {
  const documentationAgentId = wave.documentationAgentId || "A9";
  const docRun =
    agentRuns.find((run) => run.agent.agentId === documentationAgentId) ?? null;
  if (!docRun) {
    return {
      ok: true,
      agentId: null,
      statusCode: "pass",
      detail: "No documentation steward declared for this wave.",
      logPath: null,
    };
  }
  const summary = readAgentExecutionSummary(docRun.statusPath);
  const validation = validateDocumentationClosureSummary(docRun.agent, summary);
  return {
    ok: validation.ok,
    agentId: docRun.agent.agentId,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: summary?.logPath || path.relative(REPO_ROOT, docRun.logPath),
  };
}

async function runClosureSweepPhase({
  lanePaths,
  wave,
  closureRuns,
  dashboardState,
  recordCombinedEvent,
  flushDashboards,
  options,
  feedbackStateByRequestId,
  appendCoordination,
}) {
  const evaluatorAgentId = wave.evaluatorAgentId || "A0";
  const documentationAgentId = wave.documentationAgentId || "A9";
  const orderedRuns = [
    ...closureRuns.filter((run) => run.agent.agentId === documentationAgentId),
    ...closureRuns.filter((run) => run.agent.agentId === evaluatorAgentId),
  ];
  for (const runInfo of orderedRuns) {
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
    const launchResult = await launchAgentSession(lanePaths, {
      wave: wave.wave,
      agent: runInfo.agent,
      sessionName: runInfo.sessionName,
      promptPath: runInfo.promptPath,
      logPath: runInfo.logPath,
      statusPath: runInfo.statusPath,
      messageBoardPath: runInfo.messageBoardPath,
      orchestratorId: options.orchestratorId,
      executorMode: options.executorMode,
      codexSandboxMode: options.codexSandboxMode,
      agentRateLimitRetries: options.agentRateLimitRetries,
      agentRateLimitBaseDelaySeconds: options.agentRateLimitBaseDelaySeconds,
      agentRateLimitMaxDelaySeconds: options.agentRateLimitMaxDelaySeconds,
      context7Enabled: options.context7Enabled,
    });
    setWaveDashboardAgent(dashboardState, runInfo.agent.agentId, {
      state: "running",
      detail: `Closure sweep launched${launchResult?.context7?.mode ? ` (${launchResult.context7.mode})` : ""}`,
    });
    recordCombinedEvent({
      agentId: runInfo.agent.agentId,
      message: `Closure sweep launched in tmux session ${runInfo.sessionName}`,
    });
    flushDashboards();
    const result = await waitForWaveCompletion(
      lanePaths,
      [runInfo],
      options.timeoutMinutes,
      ({ pendingAgentIds }) => {
        refreshWaveDashboardAgentStates(dashboardState, [runInfo], pendingAgentIds, (event) =>
          recordCombinedEvent(event),
        );
        monitorWaveHumanFeedback({
          lanePaths,
          waveNumber: wave.wave,
          agentRuns: [runInfo],
          orchestratorId: options.orchestratorId,
          feedbackStateByRequestId,
          recordCombinedEvent,
          appendCoordination,
        });
        updateWaveDashboardMessageBoard(dashboardState, runInfo.messageBoardPath);
        flushDashboards();
      },
    );
    materializeAgentExecutionSummaryForRun(wave, runInfo);
    if (result.failures.length > 0) {
      return result;
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
    detail: "",
    logPath: null,
  };
}

export function markLauncherFailed(
  globalDashboard,
  lanePaths,
  selectedWaves,
  appendCoordination,
  error,
) {
  if (globalDashboard) {
    globalDashboard.status = "failed";
    recordGlobalDashboardEvent(globalDashboard, {
      level: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);
  }
  appendCoordination({
    event: "launcher_finish",
    waves: selectedWaves,
    status: "failed",
    details: error instanceof Error ? error.message : String(error),
    actionRequested: `Lane ${lanePaths.lane} owners should inspect the failing wave logs and dashboards before retrying.`,
  });
}

export function acquireLauncherLock(lockPath, options) {
  ensureDirectory(path.dirname(lockPath));
  const payload = {
    lane: options.lane,
    pid: process.pid,
    startedAt: toIsoTimestamp(),
    argv: process.argv.slice(2),
    cwd: REPO_ROOT,
    mode: options.reconcileStatus ? "reconcile" : "launch",
  };
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.closeSync(fd);
    return payload;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
    const existing = readJsonOrNull(lockPath);
    const existingPid = Number.parseInt(String(existing?.pid ?? ""), 10);
    if (isProcessAlive(existingPid)) {
      const lockError = new Error(
        `Another launcher is active (pid ${existingPid}, started ${existing?.startedAt || "unknown"}). Lock: ${path.relative(REPO_ROOT, lockPath)}`,
        { cause: error },
      );
      lockError.exitCode = 32;
      throw lockError;
    }
    fs.rmSync(lockPath, { force: true });
    const retryFd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(retryFd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.closeSync(retryFd);
    return payload;
  }
}

export function releaseLauncherLock(lockPath) {
  fs.rmSync(lockPath, { force: true });
}

function isLaneSessionName(lanePaths, sessionName) {
  return (
    sessionName.startsWith(lanePaths.tmuxSessionPrefix) ||
    sessionName.startsWith(lanePaths.tmuxDashboardSessionPrefix) ||
    sessionName.startsWith(lanePaths.tmuxGlobalDashboardSessionPrefix)
  );
}

function listLaneTmuxSessionNames(lanePaths) {
  return listTmuxSessionNames(lanePaths).filter((sessionName) =>
    isLaneSessionName(lanePaths, sessionName),
  );
}

function isWaveDashboardBackedByLiveSession(lanePaths, dashboardPath, activeSessionNames) {
  const waveMatch = path.basename(dashboardPath).match(/^wave-(\d+)\.json$/);
  if (!waveMatch) {
    return false;
  }
  const waveNumber = Number.parseInt(waveMatch[1], 10);
  if (!Number.isFinite(waveNumber)) {
    return false;
  }
  const dashboardState = readJsonOrNull(dashboardPath);
  const runTag = String(dashboardState?.runTag || "").trim();
  const agentPrefix = `${lanePaths.tmuxSessionPrefix}${waveNumber}_`;
  const dashboardPrefix = `${lanePaths.tmuxDashboardSessionPrefix}${waveNumber}_`;
  for (const sessionName of activeSessionNames) {
    if (!(sessionName.startsWith(agentPrefix) || sessionName.startsWith(dashboardPrefix))) {
      continue;
    }
    if (!runTag || sessionName.endsWith(`_${runTag}`)) {
      return true;
    }
  }
  return false;
}

function removeOrphanWaveDashboards(lanePaths, activeSessionNames) {
  if (!fs.existsSync(lanePaths.dashboardsDir)) {
    return [];
  }
  const removedDashboardPaths = [];
  for (const fileName of fs.readdirSync(lanePaths.dashboardsDir)) {
    if (!/^wave-\d+\.json$/.test(fileName)) {
      continue;
    }
    const dashboardPath = path.join(lanePaths.dashboardsDir, fileName);
    if (isWaveDashboardBackedByLiveSession(lanePaths, dashboardPath, activeSessionNames)) {
      continue;
    }
    fs.rmSync(dashboardPath, { force: true });
    removedDashboardPaths.push(path.relative(REPO_ROOT, dashboardPath));
  }
  return removedDashboardPaths;
}

export function reconcileStaleLauncherArtifacts(lanePaths) {
  const outcome = {
    removedLock: false,
    removedSessions: [],
    removedTerminalNames: [],
    clearedDashboards: false,
    removedDashboardPaths: [],
    staleWaves: [],
    activeLockPid: null,
  };

  if (fs.existsSync(lanePaths.launcherLockPath)) {
    const existing = readJsonOrNull(lanePaths.launcherLockPath);
    const existingPid = Number.parseInt(String(existing?.pid ?? ""), 10);
    if (isProcessAlive(existingPid)) {
      outcome.activeLockPid = existingPid;
      return outcome;
    }
    fs.rmSync(lanePaths.launcherLockPath, { force: true });
    outcome.removedLock = true;
  }

  outcome.removedSessions = cleanupLaneTmuxSessions(lanePaths);
  const activeSessionNames = new Set(listLaneTmuxSessionNames(lanePaths));
  const terminalCleanup = pruneOrphanLaneTemporaryTerminalEntries(
    lanePaths.terminalsPath,
    lanePaths,
    activeSessionNames,
  );
  outcome.removedTerminalNames = terminalCleanup.removedNames;

  const globalDashboard = readJsonOrNull(lanePaths.globalDashboardPath);
  if (globalDashboard && typeof globalDashboard === "object" && Array.isArray(globalDashboard.waves)) {
    const staleWaves = new Set();
    for (const waveEntry of globalDashboard.waves) {
      const waveNumber = Number.parseInt(String(waveEntry?.wave ?? ""), 10);
      if (Number.isFinite(waveNumber)) {
        staleWaves.add(waveNumber);
      }
    }
    outcome.staleWaves = Array.from(staleWaves).toSorted((a, b) => a - b);
  }

  if (fs.existsSync(lanePaths.globalDashboardPath)) {
    fs.rmSync(lanePaths.globalDashboardPath, { force: true });
    outcome.removedDashboardPaths.push(path.relative(REPO_ROOT, lanePaths.globalDashboardPath));
  }
  outcome.removedDashboardPaths.push(
    ...removeOrphanWaveDashboards(lanePaths, activeSessionNames),
  );
  outcome.clearedDashboards = outcome.removedDashboardPaths.length > 0;
  return outcome;
}

function runTmux(lanePaths, args, description) {
  const result = spawnSync("tmux", ["-L", lanePaths.tmuxSocketName, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, TMUX: "" },
    timeout: TMUX_COMMAND_TIMEOUT_MS,
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(
        `${description} failed: tmux command timed out after ${TMUX_COMMAND_TIMEOUT_MS}ms`,
      );
    }
    throw new Error(`${description} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${description} failed: ${(result.stderr || "").trim() || "tmux command failed"}`,
    );
  }
}

function listTmuxSessionNames(lanePaths) {
  const result = spawnSync(
    "tmux",
    ["-L", lanePaths.tmuxSocketName, "list-sessions", "-F", "#{session_name}"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, TMUX: "" },
      timeout: TMUX_COMMAND_TIMEOUT_MS,
    },
  );
  if (result.error) {
    if (result.error.code === "ENOENT") {
      return [];
    }
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`list tmux sessions failed: timed out after ${TMUX_COMMAND_TIMEOUT_MS}ms`);
    }
    throw new Error(`list tmux sessions failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const combined = `${String(result.stderr || "").toLowerCase()}\n${String(result.stdout || "").toLowerCase()}`;
    if (
      combined.includes("no server running") ||
      combined.includes("failed to connect") ||
      combined.includes("error connecting")
    ) {
      return [];
    }
    throw new Error(
      `list tmux sessions failed: ${(result.stderr || "").trim() || "unknown error"}`,
    );
  }
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanupLaneTmuxSessions(lanePaths, { excludeSessionNames = new Set() } = {}) {
  const sessionNames = listTmuxSessionNames(lanePaths);
  const killed = [];
  for (const sessionName of sessionNames) {
    if (excludeSessionNames.has(sessionName) || !isLaneSessionName(lanePaths, sessionName)) {
      continue;
    }
    killTmuxSessionIfExists(lanePaths.tmuxSocketName, sessionName);
    killed.push(sessionName);
  }
  return killed;
}

export function collectUnexpectedSessionFailures(lanePaths, agentRuns, pendingAgentIds) {
  const activeSessionNames = new Set(listLaneTmuxSessionNames(lanePaths));
  const failures = [];
  for (const run of agentRuns) {
    if (!pendingAgentIds.has(run.agent.agentId) || fs.existsSync(run.statusPath)) {
      continue;
    }
    if (activeSessionNames.has(run.sessionName)) {
      continue;
    }
    failures.push({
      agentId: run.agent.agentId,
      statusCode: "session-missing",
      logPath: path.relative(REPO_ROOT, run.logPath),
      detail: `tmux session ${run.sessionName} disappeared before ${path.relative(REPO_ROOT, run.statusPath)} was written.`,
    });
  }
  return failures;
}

function launchWaveDashboardSession(lanePaths, { sessionName, dashboardPath, messageBoardPath }) {
  killTmuxSessionIfExists(lanePaths.tmuxSocketName, sessionName);
  const messageBoardArg = messageBoardPath
    ? ` --message-board ${shellQuote(messageBoardPath)}`
    : "";
  const command = [
    `cd ${shellQuote(REPO_ROOT)}`,
    `node ${shellQuote(path.join(REPO_ROOT, "scripts", "wave-dashboard.mjs"))} --dashboard-file ${shellQuote(
      dashboardPath,
    )}${messageBoardArg} --lane ${shellQuote(lanePaths.lane)} --watch`,
    "exec bash -l",
  ].join("; ");
  runTmux(
    lanePaths,
    ["new-session", "-d", "-s", sessionName, `bash -lc ${shellQuote(command)}`],
    `launch dashboard session ${sessionName}`,
  );
}

async function launchAgentSession(lanePaths, params) {
  const {
    wave,
    agent,
    sessionName,
    promptPath,
    logPath,
    statusPath,
    messageBoardPath,
    orchestratorId,
    agentRateLimitRetries,
    agentRateLimitBaseDelaySeconds,
    agentRateLimitMaxDelaySeconds,
    context7Enabled,
  } = params;
  ensureDirectory(path.dirname(promptPath));
  ensureDirectory(path.dirname(logPath));
  ensureDirectory(path.dirname(statusPath));
  fs.rmSync(statusPath, { force: true });

  const context7 = await prefetchContext7ForSelection(agent.context7Resolved, {
    cacheDir: lanePaths.context7CacheDir,
    disabled: !context7Enabled,
  });
  const prompt = buildExecutionPrompt({
    lane: lanePaths.lane,
    wave,
    agent,
    orchestratorId,
    messageBoardPath,
    messageBoardSnapshot: readMessageBoardSnapshot(messageBoardPath),
    context7,
    sharedPlanDocs: lanePaths.sharedPlanDocs,
    evaluatorAgentId: lanePaths.evaluatorAgentId,
    documentationAgentId: lanePaths.documentationAgentId,
  });
  const promptHash = hashAgentPromptFingerprint(agent);
  fs.writeFileSync(promptPath, `${prompt}\n`, "utf8");
  killTmuxSessionIfExists(lanePaths.tmuxSocketName, sessionName);
  const overlayDir = path.join(lanePaths.executorOverlaysDir, `wave-${wave}`, agent.slug);
  const launchSpec = buildExecutorLaunchSpec({
    agent,
    promptPath,
    logPath,
    overlayDir,
  });
  const resolvedExecutorMode = launchSpec.executorId || agent.executorResolved?.id || "codex";

  const executionLines = [];
  if (launchSpec.env) {
    for (const [key, value] of Object.entries(launchSpec.env)) {
      executionLines.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  if (!launchSpec.useRateLimitRetries) {
    executionLines.push(...launchSpec.invocationLines);
    executionLines.push("status=$?");
  } else {
    executionLines.push(`: > ${shellQuote(logPath)}`);
    executionLines.push(
      `max_rate_attempts=${Math.max(1, Number.parseInt(String(agentRateLimitRetries || 0), 10) + 1)}`,
    );
    executionLines.push(
      `rate_delay_base=${Math.max(1, Number.parseInt(String(agentRateLimitBaseDelaySeconds || DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS), 10))}`,
    );
    executionLines.push(
      `rate_delay_max=${Math.max(1, Number.parseInt(String(agentRateLimitMaxDelaySeconds || DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS), 10))}`,
    );
    executionLines.push("rate_attempt=1");
    executionLines.push("status=1");
    executionLines.push('while [ "$rate_attempt" -le "$max_rate_attempts" ]; do');
    for (const line of launchSpec.invocationLines) {
      executionLines.push(`  ${line}`);
    }
    executionLines.push("  status=$?");
    executionLines.push('  if [ "$status" -eq 0 ]; then');
    executionLines.push("    break");
    executionLines.push("  fi");
    executionLines.push('  if [ "$rate_attempt" -ge "$max_rate_attempts" ]; then');
    executionLines.push("    break");
    executionLines.push("  fi");
    executionLines.push(
      `  if tail -n 120 ${shellQuote(logPath)} | grep -Eqi '429 Too Many Requests|exceeded retry limit|last status: 429|rate limit'; then`,
    );
    executionLines.push("    sleep_seconds=$((rate_delay_base * (2 ** (rate_attempt - 1))))");
    executionLines.push(
      '    if [ "$sleep_seconds" -gt "$rate_delay_max" ]; then sleep_seconds=$rate_delay_max; fi',
    );
    executionLines.push("    jitter=$((RANDOM % 5))");
    executionLines.push("    sleep_seconds=$((sleep_seconds + jitter))");
    executionLines.push(
      `    echo "[${lanePaths.lane}-wave-launcher] rate-limit detected for ${agent.agentId}; retry \${rate_attempt}/\${max_rate_attempts} after \${sleep_seconds}s" | tee -a ${shellQuote(logPath)}`,
    );
    executionLines.push('    sleep "$sleep_seconds"');
    executionLines.push("    rate_attempt=$((rate_attempt + 1))");
    executionLines.push("    continue");
    executionLines.push("  fi");
    executionLines.push("  break");
    executionLines.push("done");
  }

  const command = [
    `cd ${shellQuote(REPO_ROOT)}`,
    "set -o pipefail",
    `export WAVE_ORCHESTRATOR_ID=${shellQuote(orchestratorId || "")}`,
    `export WAVE_EXECUTOR_MODE=${shellQuote(resolvedExecutorMode)}`,
    ...executionLines,
    `node -e ${shellQuote(
      "const fs=require('node:fs'); const statusPath=process.argv[1]; const payload={code:Number(process.argv[2]),promptHash:process.argv[3]||null,orchestratorId:process.argv[4]||null,completedAt:new Date().toISOString()}; fs.writeFileSync(statusPath, JSON.stringify(payload, null, 2)+'\\n', 'utf8');",
    )} ${shellQuote(statusPath)} "$status" ${shellQuote(promptHash)} ${shellQuote(orchestratorId || "")}`,
    `echo "[${lanePaths.lane}-wave-launcher] ${sessionName} finished with code $status"`,
    "exec bash -l",
  ].join("\n");

  runTmux(
    lanePaths,
    ["new-session", "-d", "-s", sessionName, `bash -lc ${shellQuote(command)}`],
    `launch session ${sessionName}`,
  );
  return { promptHash, context7, executorId: resolvedExecutorMode };
}

async function waitForWaveCompletion(lanePaths, agentRuns, timeoutMinutes, onProgress = null) {
  const timeoutAt = Date.now() + timeoutMinutes * 60 * 1000;
  const pending = new Set(agentRuns.map((run) => run.agent.agentId));
  let timedOut = false;
  let sessionFailures = [];

  const refreshPending = () => {
    for (const run of agentRuns) {
      if (pending.has(run.agent.agentId) && fs.existsSync(run.statusPath)) {
        pending.delete(run.agent.agentId);
      }
    }
  };

  await new Promise((resolve) => {
    const interval = setInterval(() => {
      refreshPending();
      onProgress?.({ pendingAgentIds: new Set(pending), timedOut: false });
      if (pending.size === 0) {
        clearInterval(interval);
        resolve();
        return;
      }
      sessionFailures = collectUnexpectedSessionFailures(lanePaths, agentRuns, pending);
      if (sessionFailures.length > 0) {
        onProgress?.({
          pendingAgentIds: new Set(pending),
          timedOut: false,
          failures: sessionFailures,
        });
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() > timeoutAt) {
        timedOut = true;
        clearInterval(interval);
        resolve();
      }
    }, DEFAULT_WAIT_PROGRESS_INTERVAL_MS);
    refreshPending();
    onProgress?.({ pendingAgentIds: new Set(pending), timedOut: false });
  });

  if (sessionFailures.length > 0) {
    onProgress?.({ pendingAgentIds: new Set(), timedOut: false, failures: sessionFailures });
    return { failures: sessionFailures, timedOut: false };
  }

  const failures = [];
  for (const run of agentRuns) {
    const code = readStatusCodeIfPresent(run.statusPath);
    if (code === 0) {
      continue;
    }
    if (code === null) {
      failures.push({
        agentId: run.agent.agentId,
        statusCode: timedOut ? "timeout-no-status" : "missing-status",
        logPath: path.relative(REPO_ROOT, run.logPath),
      });
      continue;
    }
    failures.push({
      agentId: run.agent.agentId,
      statusCode: String(code),
      logPath: path.relative(REPO_ROOT, run.logPath),
    });
  }
  onProgress?.({ pendingAgentIds: new Set(), timedOut });
  return { failures, timedOut };
}

function monitorWaveHumanFeedback({
  lanePaths,
  waveNumber,
  agentRuns,
  orchestratorId,
  feedbackStateByRequestId,
  recordCombinedEvent,
  appendCoordination,
}) {
  const requests = readWaveHumanFeedbackRequests({
    feedbackRequestsDir: lanePaths.feedbackRequestsDir,
    lane: lanePaths.lane,
    waveNumber,
    agentIds: agentRuns.map((run) => run.agent.agentId),
    orchestratorId,
  });
  for (const request of requests) {
    const signature = feedbackStateSignature(request);
    if (feedbackStateByRequestId.get(request.id) === signature) {
      continue;
    }
    feedbackStateByRequestId.set(request.id, signature);
    const question = request.question || "n/a";
    const context = request.context ? `; context=${request.context}` : "";
    const responseOperator = request.responseOperator || "human-operator";
    const responseText = request.responseText || "(empty response)";
    if (request.status === "pending") {
      recordCombinedEvent({
        level: "warn",
        agentId: request.agentId,
        message: `Human feedback requested (${request.id}): ${question}`,
      });
      console.warn(
        `[human-feedback] wave=${waveNumber} agent=${request.agentId} request=${request.id} pending: ${question}`,
      );
      console.warn(
        `[human-feedback] respond with: node scripts/wave-human-feedback.mjs respond --id ${request.id} --response "<answer>" --operator "<name>"`,
      );
      appendCoordination({
        event: "human_feedback_requested",
        waves: [waveNumber],
        status: "waiting-human",
        details: `request_id=${request.id}; agent=${request.agentId}; question=${question}${context}`,
        actionRequested: `Launcher operator should ask or answer in the parent session, then run: node scripts/wave-human-feedback.mjs respond --id ${request.id} --response "<answer>" --operator "<name>"`,
      });
    } else if (request.status === "answered") {
      recordCombinedEvent({
        level: "info",
        agentId: request.agentId,
        message: `Human feedback answered (${request.id}) by ${responseOperator}: ${responseText}`,
      });
      appendCoordination({
        event: "human_feedback_answered",
        waves: [waveNumber],
        status: "resolved",
        details: `request_id=${request.id}; agent=${request.agentId}; operator=${responseOperator}; response=${responseText}`,
      });
    }
  }
}

export function hasReusableSuccessStatus(agent, statusPath) {
  const statusRecord = readStatusRecordIfPresent(statusPath);
  return Boolean(
    statusRecord && statusRecord.code === 0 && statusRecord.promptHash === hashAgentPromptFingerprint(agent),
  );
}

export async function runLauncherCli(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printUsage(parsed.lanePaths);
    return;
  }
  const { lanePaths, options } = parsed;
  let lockHeld = false;
  let globalDashboard = null;
  let globalDashboardTerminalEntry = null;
  let globalDashboardTerminalAppended = false;
  let selectedWavesForCoordination = [];

  const appendCoordination = ({
    event,
    waves = [],
    status = "info",
    details = "",
    actionRequested = "None",
  }) =>
    appendOrchestratorBoardEntry({
      boardPath: options.orchestratorBoardPath,
      lane: lanePaths.lane,
      orchestratorId: options.orchestratorId,
      event,
      waves,
      status,
      details,
      actionRequested,
    });

  ensureDirectory(lanePaths.stateDir);
  ensureDirectory(lanePaths.promptsDir);
  ensureDirectory(lanePaths.logsDir);
  ensureDirectory(lanePaths.statusDir);
  ensureDirectory(lanePaths.messageboardsDir);
  ensureDirectory(lanePaths.dashboardsDir);
  ensureDirectory(lanePaths.context7CacheDir);
  ensureDirectory(lanePaths.executorOverlaysDir);
  ensureDirectory(lanePaths.feedbackRequestsDir);
  if (options.orchestratorBoardPath) {
    ensureOrchestratorBoard(options.orchestratorBoardPath);
  }

  if (!options.reconcileStatus) {
    try {
      acquireLauncherLock(lanePaths.launcherLockPath, options);
      lockHeld = true;
      appendCoordination({
        event: "launcher_lock_acquired",
        status: "running",
        details: `lock=${path.relative(REPO_ROOT, lanePaths.launcherLockPath)}; pid=${process.pid}`,
      });
    } catch (error) {
      appendCoordination({
        event: "launcher_lock_blocked",
        status: "blocked",
        details: error instanceof Error ? error.message : String(error),
        actionRequested: `Lane ${lanePaths.lane} owner should wait for the active launcher to finish or choose another lane.`,
      });
      throw error;
    }
  }

  try {
    const staleArtifactCleanup = reconcileStaleLauncherArtifacts(lanePaths);
    const context7BundleIndex = loadContext7BundleIndex(lanePaths.context7BundleIndexPath);
    const allWaves = parseWaveFiles(lanePaths.wavesDir, { laneProfile: lanePaths.laneProfile })
      .map((wave) =>
        applyExecutorSelectionsToWave(wave, {
          laneProfile: lanePaths.laneProfile,
          executorMode: options.executorMode,
          codexSandboxMode: options.codexSandboxMode,
        }),
      )
      .map((wave) =>
        ({
          ...applyContext7SelectionsToWave(wave, {
            lane: lanePaths.lane,
            bundleIndex: context7BundleIndex,
          }),
          evaluatorAgentId: lanePaths.evaluatorAgentId,
          documentationAgentId: lanePaths.documentationAgentId,
        }),
      )
      .map((wave) => validateWaveDefinition(wave, { laneProfile: lanePaths.laneProfile }));
    const reconciliation = reconcileRunStateFromStatusFiles(
      allWaves,
      options.runStatePath,
      lanePaths.statusDir,
      {
        logsDir: lanePaths.logsDir,
        evaluatorAgentId: lanePaths.evaluatorAgentId,
        documentationAgentId: lanePaths.documentationAgentId,
        requireExitContractsFromWave: lanePaths.requireExitContractsFromWave,
      },
    );
    if (options.reconcileStatus) {
      if (staleArtifactCleanup.removedLock) {
        console.log(
          `[reconcile] removed stale launcher lock: ${path.relative(REPO_ROOT, lanePaths.launcherLockPath)}`,
        );
      }
      if (staleArtifactCleanup.removedSessions.length > 0) {
        console.log(
          `[reconcile] removed stale lane tmux sessions: ${staleArtifactCleanup.removedSessions.join(", ")}`,
        );
      }
      if (staleArtifactCleanup.removedTerminalNames.length > 0) {
        console.log(
          `[reconcile] pruned stale lane terminal entries: ${staleArtifactCleanup.removedTerminalNames.join(", ")}`,
        );
      }
      if (staleArtifactCleanup.clearedDashboards) {
        const removedDashboards = staleArtifactCleanup.removedDashboardPaths.join(", ");
        const staleWaves =
          staleArtifactCleanup.staleWaves.length > 0
            ? staleArtifactCleanup.staleWaves.join(", ")
            : "unknown";
        console.log(
          `[reconcile] cleared stale dashboard artifacts for wave(s) ${staleWaves}: ${removedDashboards}`,
        );
      } else if (staleArtifactCleanup.activeLockPid) {
        console.log(
          `[reconcile] stale dashboard cleanup skipped because launcher lock is active for pid ${staleArtifactCleanup.activeLockPid}`,
        );
      }
      const addedSummary =
        reconciliation.addedFromBefore.length > 0
          ? reconciliation.addedFromBefore.join(", ")
          : "none";
      const completedSummary =
        reconciliation.state.completedWaves.length > 0
          ? reconciliation.state.completedWaves.join(", ")
          : "none";
      console.log(`[reconcile] added from status files: ${addedSummary}`);
      console.log(`[reconcile] completed waves now: ${completedSummary}`);
      return;
    }

    let effectiveStartWave = options.startWave;
    if (options.autoNext) {
      const { nextWave, state } = resolveAutoNextWaveStart(allWaves, options.runStatePath);
      if (nextWave === null) {
        console.log(
          `[auto-next] All known waves are already marked complete in ${path.relative(REPO_ROOT, options.runStatePath)}.`,
        );
        return;
      }
      const lastCompleted = state.completedWaves.at(-1) ?? "none";
      effectiveStartWave = nextWave;
      console.log(
        `[auto-next] last completed wave: ${lastCompleted}; starting from wave ${effectiveStartWave}.`,
      );
    }

    const filteredWaves = allWaves.filter((wave) => {
      if (wave.wave < effectiveStartWave) {
        return false;
      }
      if (options.endWave !== null && wave.wave > options.endWave) {
        return false;
      }
      return true;
    });
    if (filteredWaves.length === 0) {
      throw new Error(
        `No waves available for range start=${effectiveStartWave}, end=${options.endWave ?? "last"}`,
      );
    }
    selectedWavesForCoordination = filteredWaves.map((wave) => wave.wave);

    const manifest = buildManifest(lanePaths, allWaves);
    writeManifest(options.manifestOut, manifest);
    console.log(`Manifest written: ${path.relative(REPO_ROOT, options.manifestOut)}`);
    console.log(`Loaded ${manifest.docs.length} docs files and ${allWaves.length} wave files.`);
    appendCoordination({
      event: "launcher_start",
      waves: selectedWavesForCoordination,
      status: options.dryRun ? "dry-run" : "running",
      details: `pid=${process.pid}; range=${filteredWaves[0]?.wave ?? "?"}..${filteredWaves.at(-1)?.wave ?? "?"}; timeout_minutes=${options.timeoutMinutes}; retries=${options.maxRetriesPerWave}; ${options.coordinationNote ? `note=${options.coordinationNote}` : "note=n/a"}`,
    });

    if (options.dryRun) {
      console.log(`[dry-run] state root: ${path.relative(REPO_ROOT, lanePaths.stateDir)}`);
      console.log("Dry run enabled, skipping tmux and executor launch.");
      return;
    }

    preflightExecutorsForWaves(filteredWaves);

    globalDashboard = buildGlobalDashboardState({
      lane: lanePaths.lane,
      selectedWaves: filteredWaves,
      options,
      runStatePath: options.runStatePath,
      manifestOut: options.manifestOut,
      feedbackRequestsDir: lanePaths.feedbackRequestsDir,
    });
    writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);

    if (!options.keepTerminals) {
      const removed = removeLaneTemporaryTerminalEntries(lanePaths.terminalsPath, lanePaths);
      if (removed > 0) {
        recordGlobalDashboardEvent(globalDashboard, {
          message: `Removed ${removed} stale temporary terminal entries for lane ${lanePaths.lane}.`,
        });
      }
    }

    if (options.cleanupSessions) {
      const killed = cleanupLaneTmuxSessions(lanePaths);
      if (killed.length > 0) {
        recordGlobalDashboardEvent(globalDashboard, {
          message: `Pre-run cleanup removed ${killed.length} stale tmux sessions for lane ${lanePaths.lane}.`,
        });
      }
    }
    writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);

    if (options.dashboard) {
      globalDashboardTerminalEntry = createGlobalDashboardTerminalEntry(
        lanePaths,
        globalDashboard.runId || "global",
      );
      appendTerminalEntries(lanePaths.terminalsPath, [globalDashboardTerminalEntry]);
      globalDashboardTerminalAppended = true;
      launchWaveDashboardSession(lanePaths, {
        sessionName: globalDashboardTerminalEntry.sessionName,
        dashboardPath: lanePaths.globalDashboardPath,
      });
      console.log(
        `[dashboard] tmux -L ${lanePaths.tmuxSocketName} attach -t ${globalDashboardTerminalEntry.sessionName}`,
      );
    }

    for (const wave of filteredWaves) {
      console.log(`\n=== Wave ${wave.wave} (${wave.file}) ===`);
      console.log(`Agents: ${wave.agents.map((agent) => agent.agentId).join(", ")}`);

      const globalWave = getGlobalWaveEntry(globalDashboard, wave.wave);
      if (globalWave) {
        globalWave.status = "running";
        globalWave.startedAt ||= toIsoTimestamp();
      }
      recordGlobalDashboardEvent(globalDashboard, {
        wave: wave.wave,
        message: `Starting wave ${wave.wave}.`,
      });
      appendCoordination({
        event: "wave_start",
        waves: [wave.wave],
        status: "running",
        details: `agents=${wave.agents.map((agent) => agent.agentId).join(", ")}; wave_file=${wave.file}`,
      });
      writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);

      const runTag = crypto.randomBytes(3).toString("hex");
      const messageBoardPath = path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`);
      ensureWaveMessageBoard({
        wave: wave.wave,
        waveFile: wave.file,
        agents: wave.agents,
        messageBoardPath,
      });
      console.log(`Wave message board: ${path.relative(REPO_ROOT, messageBoardPath)}`);

      const dashboardPath = path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`);
      let dashboardState = null;
      let terminalEntries = [];
      let terminalsAppended = false;

      const flushDashboards = () => {
        if (!dashboardState) {
          return;
        }
        writeWaveDashboard(dashboardPath, dashboardState);
        syncGlobalWaveFromWaveDashboard(globalDashboard, dashboardState);
        writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);
      };

      const recordCombinedEvent = ({ level = "info", agentId = null, message }) => {
        if (!dashboardState) {
          return;
        }
        const globalMessagePrefix =
          typeof agentId === "string" && agentId.length > 0 ? "[" + agentId + "] " : "";
        recordWaveDashboardEvent(dashboardState, { level, agentId, message });
        recordGlobalDashboardEvent(globalDashboard, {
          level,
          wave: wave.wave,
          message: `${globalMessagePrefix}${message}`,
        });
      };

      try {
        terminalEntries = createTemporaryTerminalEntries(
          lanePaths,
          wave.wave,
          wave.agents,
          runTag,
          options.dashboard,
        );
        appendTerminalEntries(lanePaths.terminalsPath, terminalEntries);
        terminalsAppended = true;

        const agentRuns = wave.agents.map((agent) => {
          const safeName = `wave-${wave.wave}-${agent.slug}`;
          const terminalName = `${lanePaths.terminalNamePrefix}${wave.wave}-${agent.slug}`;
          const sessionName = terminalEntries.find(
            (entry) => entry.terminalName === terminalName,
          )?.sessionName;
          if (!sessionName) {
            throw new Error(`Failed to resolve session name for ${agent.agentId}`);
          }
          return {
            agent,
            sessionName,
            promptPath: path.join(lanePaths.promptsDir, `${safeName}.prompt.md`),
            logPath: path.join(lanePaths.logsDir, `${safeName}.log`),
            statusPath: path.join(lanePaths.statusDir, `${safeName}.status`),
            messageBoardPath,
          };
        });

        dashboardState = buildWaveDashboardState({
          lane: lanePaths.lane,
          wave: wave.wave,
          waveFile: wave.file,
          runTag,
          maxAttempts: options.maxRetriesPerWave + 1,
          messageBoardPath,
          agentRuns,
        });

        const preCompletedAgentIds = new Set(
          agentRuns
            .filter((run) => hasReusableSuccessStatus(run.agent, run.statusPath))
            .map((run) => run.agent.agentId),
        );
        for (const agentId of preCompletedAgentIds) {
          setWaveDashboardAgent(dashboardState, agentId, {
            state: "completed",
            exitCode: 0,
            completedAt: toIsoTimestamp(),
            detail: "Pre-existing status=0",
          });
        }
        const staleCompletedAgentIds = agentRuns
          .filter(
            (run) =>
              !preCompletedAgentIds.has(run.agent.agentId) &&
              readStatusCodeIfPresent(run.statusPath) === 0,
          )
          .map((run) => run.agent.agentId);
        for (const agentId of staleCompletedAgentIds) {
          setWaveDashboardAgent(dashboardState, agentId, {
            state: "pending",
            detail: "Stale status=0 ignored due to prompt drift or missing metadata",
          });
        }
        flushDashboards();

        const dashboardEntry = terminalEntries.find(
          (entry) => entry.terminalName === `${lanePaths.dashboardTerminalNamePrefix}${wave.wave}`,
        );
        if (options.dashboard && dashboardEntry) {
          launchWaveDashboardSession(lanePaths, {
            sessionName: dashboardEntry.sessionName,
            dashboardPath,
            messageBoardPath,
          });
        }

        let runsToLaunch = agentRuns.filter((run) => !preCompletedAgentIds.has(run.agent.agentId));
        let attempt = 1;
        const feedbackStateByRequestId = new Map();

        while (attempt <= options.maxRetriesPerWave + 1) {
          dashboardState.attempt = attempt;
          updateWaveDashboardMessageBoard(dashboardState, messageBoardPath);
          flushDashboards();
          recordCombinedEvent({
            message: `Attempt ${attempt}/${options.maxRetriesPerWave + 1}; launching agents: ${runsToLaunch.map((run) => run.agent.agentId).join(", ") || "none"}`,
          });

          const launchedImplementationRuns = runsToLaunch.filter(
            (run) =>
              ![lanePaths.evaluatorAgentId, lanePaths.documentationAgentId].includes(
                run.agent.agentId,
              ),
          );
          const evaluatorOnlyRetry =
            runsToLaunch.length > 0 &&
            launchedImplementationRuns.length === 0 &&
            runsToLaunch.every((run) =>
              [lanePaths.evaluatorAgentId, lanePaths.documentationAgentId].includes(
                run.agent.agentId,
              ),
            );

          let failures = [];
          let timedOut = false;
          if (evaluatorOnlyRetry) {
            const closureResult = await runClosureSweepPhase({
              lanePaths,
              wave,
              closureRuns: runsToLaunch,
              dashboardState,
              recordCombinedEvent,
              flushDashboards,
              options,
              feedbackStateByRequestId,
              appendCoordination,
            });
            failures = closureResult.failures;
            timedOut = closureResult.timedOut;
          } else {
            for (const runInfo of runsToLaunch) {
              const existing = dashboardState.agents.find(
                (entry) => entry.agentId === runInfo.agent.agentId,
              );
              setWaveDashboardAgent(dashboardState, runInfo.agent.agentId, {
                state: "launching",
                attempts: (existing?.attempts || 0) + 1,
                startedAt: existing?.startedAt || toIsoTimestamp(),
                completedAt: null,
                exitCode: null,
                detail: `Launching (attempt ${attempt})`,
              });
              flushDashboards();
              const launchResult = await launchAgentSession(lanePaths, {
                wave: wave.wave,
                agent: runInfo.agent,
                sessionName: runInfo.sessionName,
                promptPath: runInfo.promptPath,
                logPath: runInfo.logPath,
                statusPath: runInfo.statusPath,
                messageBoardPath: runInfo.messageBoardPath,
                orchestratorId: options.orchestratorId,
                executorMode: options.executorMode,
                codexSandboxMode: options.codexSandboxMode,
                agentRateLimitRetries: options.agentRateLimitRetries,
                agentRateLimitBaseDelaySeconds: options.agentRateLimitBaseDelaySeconds,
                agentRateLimitMaxDelaySeconds: options.agentRateLimitMaxDelaySeconds,
                context7Enabled: options.context7Enabled,
              });
              setWaveDashboardAgent(dashboardState, runInfo.agent.agentId, {
                state: "running",
                detail: "Session launched",
              });
              recordCombinedEvent({
                agentId: runInfo.agent.agentId,
                message: `Launched in tmux session ${runInfo.sessionName}`,
              });
              const context7Mode = launchResult?.context7?.mode || "none";
              if (runInfo.agent.context7Resolved?.bundleId !== "none") {
                const librarySummary = describeContext7Libraries(runInfo.agent.context7Resolved);
                recordCombinedEvent({
                  level:
                    context7Mode === "fetched" || context7Mode === "cached" ? "info" : "warn",
                  agentId: runInfo.agent.agentId,
                  message:
                    context7Mode === "fetched" || context7Mode === "cached"
                      ? `Context7 bundle ${runInfo.agent.context7Resolved.bundleId} attached (${context7Mode}); libraries=${librarySummary || "none"}`
                      : `Context7 bundle ${runInfo.agent.context7Resolved.bundleId} not attached (${context7Mode})${launchResult?.context7?.warning ? `: ${launchResult.context7.warning}` : ""}`,
                });
              }
              flushDashboards();
              if (options.agentLaunchStaggerMs > 0) {
                await sleep(options.agentLaunchStaggerMs);
              }
            }

            const waitResult = await waitForWaveCompletion(
              lanePaths,
              agentRuns,
              options.timeoutMinutes,
              ({ pendingAgentIds }) => {
                refreshWaveDashboardAgentStates(dashboardState, agentRuns, pendingAgentIds, (event) =>
                  recordCombinedEvent(event),
                );
                monitorWaveHumanFeedback({
                  lanePaths,
                  waveNumber: wave.wave,
                  agentRuns,
                  orchestratorId: options.orchestratorId,
                  feedbackStateByRequestId,
                  recordCombinedEvent,
                  appendCoordination,
                });
                updateWaveDashboardMessageBoard(dashboardState, messageBoardPath);
                flushDashboards();
              },
            );
            failures = waitResult.failures;
            timedOut = waitResult.timedOut;
          }

          materializeAgentExecutionSummaries(wave, agentRuns);

          if (failures.length > 0) {
            for (const failure of failures) {
              if (!failure.detail) {
                continue;
              }
              recordCombinedEvent({
                level: "error",
                agentId: failure.agentId,
                message: failure.detail,
              });
            }
          }

          if (failures.length === 0) {
            const implementationGate = readWaveImplementationGate(wave, agentRuns);
            if (!implementationGate.ok) {
              failures = [
                {
                  agentId: implementationGate.agentId,
                  statusCode: implementationGate.statusCode,
                  logPath: implementationGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: implementationGate.agentId,
                message: `Implementation exit contract blocked wave ${wave.wave}: ${implementationGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `agent=${implementationGate.agentId}; reason=${implementationGate.statusCode}; ${implementationGate.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve the implementation contract gap before wave progression.`,
              });
            } else if (launchedImplementationRuns.length > 0) {
              recordCombinedEvent({
                message: `Implementation pass complete; running closure sweep for ${wave.wave}.`,
              });
              const closureResult = await runClosureSweepPhase({
                lanePaths,
                wave,
                closureRuns: agentRuns.filter((run) =>
                  [lanePaths.evaluatorAgentId, lanePaths.documentationAgentId].includes(
                    run.agent.agentId,
                  ),
                ),
                dashboardState,
                recordCombinedEvent,
                flushDashboards,
                options,
                feedbackStateByRequestId,
                appendCoordination,
              });
              failures = closureResult.failures;
              timedOut = timedOut || closureResult.timedOut;
              materializeAgentExecutionSummaries(wave, agentRuns);
            } else {
              recordCombinedEvent({
                message: "Implementation exit contracts satisfied.",
              });
            }
          }

          if (failures.length === 0) {
            const documentationGate = readWaveDocumentationGate(wave, agentRuns);
            if (!documentationGate.ok) {
              failures = [
                {
                  agentId: documentationGate.agentId,
                  statusCode: documentationGate.statusCode,
                  logPath: documentationGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: documentationGate.agentId,
                message: `Documentation closure blocked wave ${wave.wave}: ${documentationGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `agent=${documentationGate.agentId}; reason=${documentationGate.statusCode}; ${documentationGate.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve the shared-plan closure state before wave progression.`,
              });
            }
          }

          if (failures.length === 0) {
            const evaluatorGate = readWaveEvaluatorGate(wave, agentRuns);
            if (!evaluatorGate.ok) {
              failures = [
                {
                  agentId: evaluatorGate.agentId,
                  statusCode: evaluatorGate.statusCode,
                  logPath: evaluatorGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: evaluatorGate.agentId,
                message: `Evaluator gate blocked wave ${wave.wave}: ${evaluatorGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `agent=${evaluatorGate.agentId}; reason=${evaluatorGate.statusCode}; ${evaluatorGate.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve the evaluator gate before wave progression.`,
              });
            } else {
              setWaveDashboardAgent(dashboardState, evaluatorGate.agentId, {
                detail: evaluatorGate.detail
                  ? `Exit 0; evaluator PASS (${evaluatorGate.detail})`
                  : "Exit 0; evaluator PASS",
              });
              recordCombinedEvent({
                agentId: evaluatorGate.agentId,
                message: evaluatorGate.detail
                  ? `Evaluator verdict PASS: ${evaluatorGate.detail}`
                  : "Evaluator verdict PASS.",
              });
            }
          }

          if (failures.length === 0) {
            const infraGate = readWaveInfraGate(agentRuns);
            if (!infraGate.ok) {
              failures = [
                {
                  agentId: infraGate.agentId,
                  statusCode: infraGate.statusCode,
                  logPath: infraGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: infraGate.agentId,
                message: `Infra gate blocked wave ${wave.wave}: ${infraGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `agent=${infraGate.agentId}; reason=${infraGate.statusCode}; ${infraGate.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve the infra gate before wave progression.`,
              });
            }
          }

          if (failures.length === 0) {
            dashboardState.status = "completed";
            recordCombinedEvent({ message: `Wave ${wave.wave} completed successfully.` });
            refreshWaveDashboardAgentStates(dashboardState, agentRuns, new Set(), (event) =>
              recordCombinedEvent(event),
            );
            updateWaveDashboardMessageBoard(dashboardState, messageBoardPath);
            flushDashboards();
            break;
          }

          if (attempt >= options.maxRetriesPerWave + 1) {
            dashboardState.status = timedOut ? "timed_out" : "failed";
            for (const failure of failures) {
              setWaveDashboardAgent(dashboardState, failure.agentId, {
                state: timedOut ? "timed_out" : "failed",
                detail: failure.detail || `Exit ${failure.statusCode}`,
              });
            }
            flushDashboards();
            const details = failures
              .map(
                (failure) =>
                  `  - ${failure.agentId}: exit=${failure.statusCode}, log=${failure.logPath}${failure.detail ? `, detail=${failure.detail}` : ""}`,
              )
              .join("\n");
            const error = new Error(
              `Wave ${wave.wave} failed after ${attempt} attempt(s):\n${details}`,
            );
            if (
              failures.every(
                (failure) =>
                  String(failure.statusCode).startsWith("evaluator-") ||
                  String(failure.statusCode) === "missing-evaluator-verdict",
              )
            ) {
              error.exitCode = 42;
            }
            throw error;
          }

          const failedAgentIds = new Set(failures.map((failure) => failure.agentId));
          const failedList = Array.from(failedAgentIds).join(", ");
          console.warn(
            `[retry] Wave ${wave.wave} had failures for agents: ${failedList}. Relaunching failed or missing agents.`,
          );
          appendCoordination({
            event: "wave_retry",
            waves: [wave.wave],
            status: "retrying",
            details: `attempt=${attempt + 1}/${options.maxRetriesPerWave + 1}; failed_agents=${failedList}; timed_out=${timedOut ? "yes" : "no"}`,
            actionRequested: `Lane ${lanePaths.lane} owners should inspect failed agent logs before retry completion.`,
          });
          runsToLaunch = agentRuns.filter((run) => failedAgentIds.has(run.agent.agentId));
          for (const run of runsToLaunch) {
            setWaveDashboardAgent(dashboardState, run.agent.agentId, {
              state: "pending",
              detail: "Queued for retry",
            });
          }
          flushDashboards();
          attempt += 1;
        }

        const runState = markWaveCompleted(options.runStatePath, wave.wave);
        console.log(
          `[state] completed waves (${path.relative(REPO_ROOT, options.runStatePath)}): ${runState.completedWaves.join(", ") || "none"}`,
        );
        appendCoordination({
          event: "wave_complete",
          waves: [wave.wave],
          status: "completed",
          details: `attempts_used=${dashboardState?.attempt ?? "n/a"}; completed_waves=${runState.completedWaves.join(", ") || "none"}`,
        });
      } finally {
        if (terminalsAppended && !options.keepTerminals) {
          removeTerminalEntries(lanePaths.terminalsPath, terminalEntries);
        }
        if (options.cleanupSessions) {
          const excludeSessionNames = new Set();
          if (globalDashboardTerminalEntry) {
            excludeSessionNames.add(globalDashboardTerminalEntry.sessionName);
          }
          cleanupLaneTmuxSessions(lanePaths, { excludeSessionNames });
        }
        if (globalWave && globalWave.status === "running") {
          globalWave.status = dashboardState?.status || "failed";
          if (WAVE_TERMINAL_STATES.has(globalWave.status)) {
            globalWave.completedAt = toIsoTimestamp();
          }
          writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);
        }
      }
    }

    globalDashboard.status = "completed";
    recordGlobalDashboardEvent(globalDashboard, { message: "All selected waves completed." });
    writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);
    appendCoordination({
      event: "launcher_finish",
      waves: selectedWavesForCoordination,
      status: "completed",
      details: "All selected waves completed successfully.",
    });
  } catch (error) {
    markLauncherFailed(
      globalDashboard,
      lanePaths,
      selectedWavesForCoordination,
      appendCoordination,
      error,
    );
    throw error;
  } finally {
    if (globalDashboardTerminalAppended && globalDashboardTerminalEntry && !options.keepTerminals) {
      removeTerminalEntries(lanePaths.terminalsPath, [globalDashboardTerminalEntry]);
    }
    if (options.cleanupSessions && globalDashboardTerminalEntry) {
      try {
        killTmuxSessionIfExists(lanePaths.tmuxSocketName, globalDashboardTerminalEntry.sessionName);
      } catch {
        // no-op
      }
    }
    if (lockHeld) {
      releaseLauncherLock(lanePaths.launcherLockPath);
    }
  }
}
