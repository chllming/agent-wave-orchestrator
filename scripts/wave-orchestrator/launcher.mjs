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
  ensureOrchestratorBoard,
  feedbackStateSignature,
  readWaveHumanFeedbackRequests,
} from "./coordination.mjs";
import {
  buildCoordinationResponseMetrics,
} from "./coordination-store.mjs";
import {
  applyContext7SelectionsToWave,
  describeContext7Libraries,
  hashAgentPromptFingerprint,
  loadContext7BundleIndex,
} from "./context7.mjs";
import {
  buildGlobalDashboardState,
  buildWaveDashboardState,
  getGlobalWaveEntry,
  readStatusCodeIfPresent,
  recordGlobalDashboardEvent,
  recordWaveDashboardEvent,
  refreshWaveDashboardAgentStates,
  setWaveDashboardAgent,
  updateWaveDashboardMessageBoard,
} from "./dashboard-state.mjs";
import {
  DEFAULT_AGENT_LAUNCH_STAGGER_MS,
  DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS,
  DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS,
  DEFAULT_AGENT_RATE_LIMIT_RETRIES,
  DEFAULT_COORDINATION_ACK_TIMEOUT_MS,
  DEFAULT_LIVE_COORDINATION_REFRESH_MS,
  DEFAULT_MAX_RETRIES_PER_WAVE,
  DEFAULT_TIMEOUT_MINUTES,
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
  sanitizeAdhocRunId,
  sanitizeOrchestratorId,
  shellQuote,
  sleep,
  PACKAGE_ROOT,
  TMUX_COMMAND_TIMEOUT_MS,
  WAVE_VERDICT_REGEX,
  WAVE_TERMINAL_STATES,
  toIsoTimestamp,
  writeJsonAtomic,
  writeTextAtomic,
} from "./shared.mjs";
import {
  createCurrentWaveDashboardTerminalEntry,
  appendTerminalEntries,
  createGlobalDashboardTerminalEntry,
  createTemporaryTerminalEntries,
  killTmuxSessionIfExists,
  normalizeTerminalSurface,
  pruneOrphanLaneTemporaryTerminalEntries,
  removeLaneTemporaryTerminalEntries,
  removeTerminalEntries,
  terminalSurfaceUsesTerminalRegistry,
  TERMINAL_SURFACES,
} from "./terminals.mjs";
import {
  buildCodexExecInvocation,
  commandForExecutor,
  isExecutorCommandAvailable,
} from "./executors.mjs";
import { maybeAnnouncePackageUpdate } from "./package-update-notice.mjs";
import {
  agentRequiresProofCentricValidation,
  buildRunStateEvidence,
  buildManifest,
  applyExecutorSelectionsToWave,
  markWaveCompleted,
  parseWaveFiles,
  reconcileRunStateFromStatusFiles,
  resolveAutoNextWaveStart,
  validateWaveRuntimeMixAssignments,
  validateWaveComponentMatrixCurrentLevels,
  validateWaveComponentPromotions,
  validateWaveDefinition,
  waveRequiresProofCentricValidation,
  writeManifest,
} from "./wave-files.mjs";
import {
  agentSummaryPathFromStatusPath,
  buildAgentExecutionSummary,
  readAgentExecutionSummary,
  validateContEvalSummary,
  validateContQaSummary,
  validateDocumentationClosureSummary,
  validateIntegrationSummary,
  validateImplementationSummary,
  validateSecuritySummary,
  writeAgentExecutionSummary,
} from "./agent-state.mjs";
import {
  augmentSummaryWithProofRegistry,
  readWaveProofRegistry,
  waveProofRegistryPath,
} from "./proof-registry.mjs";
import {
  clearWaveRetryOverride,
  readWaveRetryOverride,
} from "./retry-control.mjs";
import { appendWaveControlEvent, readControlPlaneEvents } from "./control-plane.mjs";
import { materializeContradictionsFromControlPlaneEvents } from "./contradiction-entity.mjs";
import { flushWaveControlQueue } from "./wave-control-client.mjs";
import { readProjectProfile, resolveDefaultTerminalSurface } from "./project-profile.mjs";
import {
  isContEvalImplementationOwningAgent,
  isContEvalReportOnlyAgent,
  isClosureRoleAgentId,
  isDesignAgent,
  isImplementationOwningDesignAgent,
  isSecurityReviewAgent,
  resolveWaveRoleBindings,
  resolveSecurityReviewReportPath,
} from "./role-helpers.mjs";
import {
  summarizeResolvedSkills,
} from "./skills.mjs";
import {
  collectUnexpectedSessionFailures as collectUnexpectedSessionFailuresImpl,
  launchAgentSession as launchAgentSessionImpl,
  refreshResolvedSkillsForRun,
  waitForWaveCompletion as waitForWaveCompletionImpl,
} from "./launcher-runtime.mjs";
import {
  readWaveInfraGate as readWaveInfraGateImpl,
  runClosureSweepPhase as runClosureSweepPhaseImpl,
} from "./closure-engine.mjs";
import {
  materializeAgentExecutionSummaryForRun,
  readRunExecutionSummary,
  materializeAgentExecutionSummaries,
  readWaveContQaGate,
  readWaveContEvalGate,
  readWaveEvaluatorGate,
  readWaveImplementationGate,
  analyzePromotedComponentOwners,
  buildSharedComponentSiblingPendingFailure,
  readWaveComponentGate,
  readWaveComponentMatrixGate,
  readWaveDocumentationGate,
  readWaveSecurityGate,
  readWaveIntegrationGate,
  readWaveIntegrationBarrier,
  readClarificationBarrier,
  readWaveAssignmentBarrier,
  readWaveDependencyBarrier,
  buildGateSnapshot as buildGateSnapshotImpl,
} from "./gate-engine.mjs";
import {
  waveAssignmentsPath,
  waveDependencySnapshotPath,
  buildWaveDerivedState,
  applyDerivedStateToDashboard,
} from "./derived-state-engine.mjs";
import {
  readWaveRelaunchPlan,
  clearWaveRelaunchPlan,
  resetPersistedWaveLaunchState,
  persistedRelaunchPlanMatchesCurrentState,
  resolveSharedComponentContinuationRuns,
  applySharedComponentWaitStateToDashboard,
  reconcileFailuresAgainstSharedComponentState,
  hasReusableSuccessStatus,
  selectReusablePreCompletedAgentIds,
  selectInitialWaveRuns,
  resolveRelaunchRuns,
  executorFallbackChain,
  preflightWavesForExecutorAvailability,
} from "./retry-engine.mjs";
import {
  markLauncherFailed,
  acquireLauncherLock,
  releaseLauncherLock,
  reconcileStaleLauncherArtifacts,
  collectUnexpectedSessionFailures,
  launchAgentSession,
  waitForWaveCompletion,
  monitorWaveHumanFeedback,
  buildResidentOrchestratorRun,
  monitorResidentOrchestratorSession,
  launchWaveDashboardSession,
  cleanupLaneTmuxSessions,
  pruneDryRunExecutorPreviewDirs,
  recordAttemptState,
  recordWaveRunState,
  runTmux,
  syncLiveWaveSignals,
} from "./session-supervisor.mjs";
import { buildControlStatusPayload } from "./control-cli.mjs";
import {
  planInitialWaveAttempt,
  planRetryWaveAttempt,
} from "./implementation-engine.mjs";
import {
  writeDashboardProjections,
  writeWaveDerivedProjections,
  writeWaveAttemptTraceProjection,
  writeWaveRelaunchProjection,
} from "./projection-writer.mjs";
import {
  formatReconcileBlockedWaveLine,
  formatReconcilePreservedWaveLine,
} from "./reconcile-format.mjs";
import { computeReducerSnapshot } from "./reducer-snapshot.mjs";

function printUsage(lanePaths, terminalSurface) {
  console.log(`Usage: pnpm exec wave launch [options]

Options:
  --lane <name>          Wave lane name (default: ${DEFAULT_WAVE_LANE})
  --start-wave <n>       Start from wave number (default: 0)
  --end-wave <n>         End at wave number (default: last available)
  --auto-next            Start from the next unfinished wave and continue forward
  --resume-control-state Preserve the prior auto-generated relaunch plan for this wave
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
  --terminal-surface <mode>
                        Terminal surface: ${TERMINAL_SURFACES.join(" | ")} (default: ${terminalSurface})
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
  --resident-orchestrator
                        Launch an additional long-running resident orchestrator session for the wave
  --no-telemetry        Disable Wave Control reporting for this launcher run
  --no-context7         Disable launcher-side Context7 prefetch/injection
  --help                 Show this help message
`);
}

function parseArgs(argv) {
  let lanePaths = buildLanePaths(DEFAULT_WAVE_LANE);
  const projectProfile = readProjectProfile();
  const options = {
    lane: DEFAULT_WAVE_LANE,
    startWave: 0,
    endWave: null,
    autoNext: false,
    resumeControlState: false,
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
    terminalSurface: resolveDefaultTerminalSurface(projectProfile),
    dashboard: true,
    cleanupSessions: true,
    keepTerminals: false,
    context7Enabled: true,
    telemetryEnabled: true,
    residentOrchestrator: false,
    orchestratorId: null,
    orchestratorBoardPath: null,
    coordinationNote: "",
    adhocRunId: null,
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
    } else if (arg === "--terminal-surface") {
      options.terminalSurface = normalizeTerminalSurface(argv[++i], "--terminal-surface");
    } else if (arg === "--no-dashboard") {
      options.dashboard = false;
    } else if (arg === "--cleanup-sessions") {
      options.cleanupSessions = true;
    } else if (arg === "--keep-sessions") {
      options.cleanupSessions = false;
    } else if (arg === "--auto-next") {
      options.autoNext = true;
    } else if (arg === "--resume-control-state") {
      options.resumeControlState = true;
    } else if (arg === "--reconcile-status") {
      options.reconcileStatus = true;
    } else if (arg === "--keep-terminals") {
      options.keepTerminals = true;
    } else if (arg === "--no-context7") {
      options.context7Enabled = false;
    } else if (arg === "--no-telemetry") {
      options.telemetryEnabled = false;
    } else if (arg === "--no-orchestrator-board") {
      options.orchestratorBoardPath = null;
      orchestratorBoardProvided = true;
    } else if (arg === "--lane") {
      options.lane = String(argv[++i] || "").trim();
      lanePaths = buildLanePaths(options.lane, {
        adhocRunId: options.adhocRunId,
      });
    } else if (arg === "--adhoc-run") {
      options.adhocRunId = sanitizeAdhocRunId(argv[++i]);
      lanePaths = buildLanePaths(options.lane, {
        adhocRunId: options.adhocRunId,
      });
    } else if (arg === "--orchestrator-id") {
      options.orchestratorId = sanitizeOrchestratorId(argv[++i]);
    } else if (arg === "--orchestrator-board") {
      options.orchestratorBoardPath = path.resolve(REPO_ROOT, argv[++i] || "");
      orchestratorBoardProvided = true;
    } else if (arg === "--coordination-note") {
      options.coordinationNote = String(argv[++i] || "").trim();
    } else if (arg === "--resident-orchestrator") {
      options.residentOrchestrator = true;
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
    adhocRunId: options.adhocRunId,
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
  if (!options.telemetryEnabled) {
    lanePaths.waveControl = {
      ...(lanePaths.waveControl || {}),
      enabled: false,
    };
    lanePaths.laneProfile = {
      ...(lanePaths.laneProfile || {}),
      waveControl: lanePaths.waveControl,
    };
  }
  options.orchestratorId ||= sanitizeOrchestratorId(`${lanePaths.lane}-orch-${process.pid}`);
  lanePaths.orchestratorId = options.orchestratorId;
  if (options.agentRateLimitMaxDelaySeconds < options.agentRateLimitBaseDelaySeconds) {
    throw new Error(
      "--agent-rate-limit-max-delay-seconds must be >= --agent-rate-limit-base-delay-seconds",
    );
  }
  if (!options.autoNext && options.endWave !== null && options.endWave < options.startWave) {
    throw new Error("--end-wave must be >= --start-wave");
  }
  if (!options.dryRun && options.terminalSurface === "none") {
    throw new Error("--terminal-surface none is only supported with --dry-run");
  }
  return { help: false, lanePaths, options };
}

// --- Local wrappers that bind engine calls to launcher scope ---

async function runClosureSweepPhase({
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
  launchAgentSessionFn = launchAgentSession,
  waitForWaveCompletionFn = waitForWaveCompletion,
}) {
  return runClosureSweepPhaseImpl({
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
    readWaveContEvalGateFn: readWaveContEvalGate,
    readWaveSecurityGateFn: readWaveSecurityGate,
    readWaveIntegrationBarrierFn: readWaveIntegrationBarrier,
    readWaveDocumentationGateFn: readWaveDocumentationGate,
    readWaveComponentMatrixGateFn: readWaveComponentMatrixGate,
    readWaveContQaGateFn: readWaveContQaGate,
    materializeAgentExecutionSummaryForRunFn: materializeAgentExecutionSummaryForRun,
    monitorWaveHumanFeedbackFn: monitorWaveHumanFeedback,
  });
}

function readWaveInfraGate(agentRuns) {
  return readWaveInfraGateImpl(agentRuns);
}

function buildGateSnapshot(params) {
  return buildGateSnapshotImpl({
    ...params,
    readWaveInfraGateFn: readWaveInfraGate,
  });
}

function waveGateLabel(gateName) {
  switch (gateName) {
    case "designGate":
      return "Design packet";
    case "implementationGate":
      return "Implementation exit contract";
    case "componentGate":
      return "Component promotion";
    case "helperAssignmentBarrier":
      return "Helper assignment barrier";
    case "dependencyBarrier":
      return "Dependency barrier";
    case "contEvalGate":
      return "cont-EVAL";
    case "securityGate":
      return "Security review";
    case "integrationBarrier":
      return "Integration gate";
    case "documentationGate":
      return "Documentation closure";
    case "componentMatrixGate":
      return "Component matrix update";
    case "contQaGate":
      return "cont-QA gate";
    case "infraGate":
      return "Infra gate";
    case "clarificationBarrier":
      return "Clarification barrier";
    default:
      return "Wave gate";
  }
}

function waveGateActionRequested(gateName, lanePaths) {
  switch (gateName) {
    case "designGate":
      return `Lane ${lanePaths.lane} owners should close the design packet or clarification gap before implementation starts.`;
    case "implementationGate":
      return `Lane ${lanePaths.lane} owners should resolve the implementation contract gap before wave progression.`;
    case "componentGate":
      return `Lane ${lanePaths.lane} owners should close the component promotion gap before wave progression.`;
    case "helperAssignmentBarrier":
      return `Lane ${lanePaths.lane} owners should resolve helper assignments before wave progression.`;
    case "dependencyBarrier":
      return `Lane ${lanePaths.lane} owners should resolve required dependencies before wave progression.`;
    case "contEvalGate":
      return `Lane ${lanePaths.lane} owners should resolve cont-EVAL tuning gaps before integration closure.`;
    case "securityGate":
      return `Lane ${lanePaths.lane} owners should resolve blocked security findings or missing approvals before integration closure.`;
    case "integrationBarrier":
      return `Lane ${lanePaths.lane} owners should resolve integration contradictions or blockers before documentation and cont-QA closure.`;
    case "documentationGate":
      return `Lane ${lanePaths.lane} owners should resolve the shared-plan closure state before wave progression.`;
    case "componentMatrixGate":
      return `Lane ${lanePaths.lane} owners should update the component cutover matrix current levels before wave progression.`;
    case "contQaGate":
      return `Lane ${lanePaths.lane} owners should resolve the cont-QA gate before wave progression.`;
    case "infraGate":
      return `Lane ${lanePaths.lane} owners should resolve the infra gate before wave progression.`;
    case "clarificationBarrier":
      return `Lane ${lanePaths.lane} owners should resolve open clarification chains before wave progression.`;
    default:
      return `Lane ${lanePaths.lane} owners should resolve the failing gate before wave progression.`;
  }
}

function buildFailureFromGate(gateName, gate, fallbackLogPath) {
  return {
    agentId: gate?.agentId || null,
    statusCode: gate?.statusCode || gateName,
    logPath: gate?.logPath || fallbackLogPath,
    detail: gate?.detail || null,
    componentId: gate?.componentId || null,
    ownerAgentIds: gate?.ownerAgentIds || [],
    satisfiedAgentIds: gate?.satisfiedAgentIds || [],
    waitingOnAgentIds: gate?.waitingOnAgentIds || [],
    failedOwnContractAgentIds: gate?.failedOwnContractAgentIds || [],
  };
}

// --- Main entry point ---

export async function runLauncherCli(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printUsage(parsed.lanePaths, parsed.options.terminalSurface);
    return;
  }
  const { lanePaths, options } = parsed;
  if (!options.reconcileStatus) {
    await maybeAnnouncePackageUpdate();
  }
  let lockHeld = false;
  let globalDashboard = null;
  let globalDashboardTerminalEntry = null;
  let globalDashboardTerminalAppended = false;
  let currentWaveDashboardTerminalEntry = null;
  let currentWaveDashboardTerminalAppended = false;
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
  ensureDirectory(lanePaths.coordinationDir);
  ensureDirectory(lanePaths.controlDir);
  ensureDirectory(lanePaths.assignmentsDir);
  ensureDirectory(lanePaths.inboxesDir);
  ensureDirectory(lanePaths.signalsDir);
  ensureDirectory(lanePaths.ledgerDir);
  ensureDirectory(lanePaths.integrationDir);
  ensureDirectory(lanePaths.proofDir);
  ensureDirectory(lanePaths.securityDir);
  ensureDirectory(lanePaths.dependencySnapshotsDir);
  ensureDirectory(lanePaths.docsQueueDir);
  ensureDirectory(lanePaths.tracesDir);
  ensureDirectory(lanePaths.context7CacheDir);
  ensureDirectory(lanePaths.executorOverlaysDir);
  ensureDirectory(lanePaths.feedbackRequestsDir);
  ensureDirectory(lanePaths.feedbackTriageDir);
  ensureDirectory(lanePaths.crossLaneDependenciesDir);
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
    const staleArtifactCleanup = reconcileStaleLauncherArtifacts(lanePaths, {
      terminalSurface: options.terminalSurface,
    });
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
        {
          const waveWithContext7 = applyContext7SelectionsToWave(wave, {
            lane: lanePaths.lane,
            bundleIndex: context7BundleIndex,
          });
          return {
            ...waveWithContext7,
            lane: lanePaths.lane,
            ...resolveWaveRoleBindings(waveWithContext7, lanePaths, waveWithContext7.agents),
          };
        },
      )
      .map((wave) => validateWaveDefinition(wave, { laneProfile: lanePaths.laneProfile }));
    const reconciliation = reconcileRunStateFromStatusFiles(
      allWaves,
      options.runStatePath,
      lanePaths.statusDir,
      {
        logsDir: lanePaths.logsDir,
        coordinationDir: lanePaths.coordinationDir,
        contQaAgentId: lanePaths.contQaAgentId,
        contEvalAgentId: lanePaths.contEvalAgentId,
        integrationAgentId: lanePaths.integrationAgentId,
        documentationAgentId: lanePaths.documentationAgentId,
        requireExitContractsFromWave: lanePaths.requireExitContractsFromWave,
        requireIntegrationStewardFromWave: lanePaths.requireIntegrationStewardFromWave,
        requireComponentPromotionsFromWave: lanePaths.requireComponentPromotionsFromWave,
        laneProfile: lanePaths.laneProfile,
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
      for (const blockedWave of reconciliation.blockedFromStatus || []) {
        console.log(formatReconcileBlockedWaveLine(blockedWave));
      }
      for (const preservedWave of reconciliation.preservedWithDrift || []) {
        console.log(formatReconcilePreservedWaveLine(preservedWave));
      }
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
      details: `pid=${process.pid}; run_kind=${lanePaths.runKind}; run_id=${lanePaths.runId || "none"}; range=${filteredWaves[0]?.wave ?? "?"}..${filteredWaves.at(-1)?.wave ?? "?"}; timeout_minutes=${options.timeoutMinutes}; retries=${options.maxRetriesPerWave}; ${options.coordinationNote ? `note=${options.coordinationNote}` : "note=n/a"}`,
    });

    if (options.dryRun) {
      pruneDryRunExecutorPreviewDirs(lanePaths, allWaves);
      for (const wave of filteredWaves) {
        const derivedState = buildWaveDerivedState({
          lanePaths,
          wave,
          summariesByAgentId: {},
          feedbackRequests: [],
          attempt: 0,
          orchestratorId: options.orchestratorId,
        });
        writeWaveDerivedProjections({ lanePaths, wave, derivedState });
        const agentRuns = wave.agents.map((agent) => {
          const safeName = `wave-${wave.wave}-${agent.slug}`;
          return {
            agent,
            lane: lanePaths.lane,
            wave: wave.wave,
            resultsDir: lanePaths.resultsDir,
            sessionName: `dry-run-wave-${wave.wave}-${agent.slug}`,
            promptPath: path.join(lanePaths.promptsDir, `${safeName}.prompt.md`),
            logPath: path.join(lanePaths.logsDir, `${safeName}.log`),
            statusPath: path.join(lanePaths.statusDir, `${safeName}.status`),
            messageBoardPath: derivedState.messageBoardPath,
            messageBoardSnapshot: derivedState.messageBoardText,
            sharedSummaryPath: derivedState.sharedSummaryPath,
            sharedSummaryText: derivedState.sharedSummaryText,
            inboxPath: derivedState.inboxesByAgentId[agent.agentId]?.path || null,
            inboxText: derivedState.inboxesByAgentId[agent.agentId]?.text || "",
          };
        });
        for (const runInfo of agentRuns) {
          await launchAgentSession(lanePaths, {
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
            agentRateLimitRetries: options.agentRateLimitRetries,
            agentRateLimitBaseDelaySeconds: options.agentRateLimitBaseDelaySeconds,
            agentRateLimitMaxDelaySeconds: options.agentRateLimitMaxDelaySeconds,
            context7Enabled: false,
            dryRun: true,
          });
        }
      }
      console.log(`[dry-run] state root: ${path.relative(REPO_ROOT, lanePaths.stateDir)}`);
      console.log(
        `[dry-run] prompts and executor overlays written: ${path.relative(REPO_ROOT, lanePaths.executorOverlaysDir)}`,
      );
      console.log("Dry run enabled, skipping tmux and executor launch.");
      return;
    }

    preflightWavesForExecutorAvailability(filteredWaves, lanePaths);
    const terminalRegistryEnabled = terminalSurfaceUsesTerminalRegistry(
      options.terminalSurface,
    );

    globalDashboard = buildGlobalDashboardState({
      lane: lanePaths.lane,
      selectedWaves: filteredWaves,
      options,
      runStatePath: options.runStatePath,
      manifestOut: options.manifestOut,
      feedbackRequestsDir: lanePaths.feedbackRequestsDir,
    });
    writeDashboardProjections({ lanePaths, globalDashboard });

    if (terminalRegistryEnabled && !options.keepTerminals) {
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
    writeDashboardProjections({ lanePaths, globalDashboard });

    if (options.dashboard) {
      globalDashboardTerminalEntry = createGlobalDashboardTerminalEntry(
        lanePaths,
        globalDashboard.runId || "global",
      );
      currentWaveDashboardTerminalEntry = createCurrentWaveDashboardTerminalEntry(lanePaths);
      if (terminalRegistryEnabled) {
        appendTerminalEntries(lanePaths.terminalsPath, [
          globalDashboardTerminalEntry,
          currentWaveDashboardTerminalEntry,
        ]);
        globalDashboardTerminalAppended = true;
        currentWaveDashboardTerminalAppended = true;
      }
      launchWaveDashboardSession(lanePaths, {
        sessionName: globalDashboardTerminalEntry.sessionName,
        dashboardPath: lanePaths.globalDashboardPath,
      });
      console.log(
        `[dashboard] attach global: pnpm exec wave dashboard --lane ${lanePaths.lane} --attach global`,
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
      writeDashboardProjections({ lanePaths, globalDashboard });

      const runTag = crypto.randomBytes(3).toString("hex");
      let derivedState = buildWaveDerivedState({
        lanePaths,
        wave,
        summariesByAgentId: {},
        feedbackRequests: [],
        attempt: 0,
        orchestratorId: options.orchestratorId,
      });
      writeWaveDerivedProjections({ lanePaths, wave, derivedState });
      const messageBoardPath = derivedState.messageBoardPath;
      console.log(`Wave message board: ${path.relative(REPO_ROOT, messageBoardPath)}`);

      const dashboardPath = path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`);
      let dashboardState = null;
      let terminalEntries = [];
      let terminalsAppended = false;
      let residentOrchestratorRun = null;
      const residentOrchestratorState = { closed: false };

      const flushDashboards = () => {
        if (!dashboardState && !globalDashboard) {
          return;
        }
        writeDashboardProjections({
          lanePaths,
          globalDashboard,
          dashboardState,
          dashboardPath,
        });
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
      const flushWaveControlTelemetry = async () => {
        try {
          await flushWaveControlQueue(lanePaths);
        } catch {
          // Remote telemetry delivery is best-effort only.
        }
      };

      try {
        terminalEntries = createTemporaryTerminalEntries(
          lanePaths,
          wave.wave,
          wave.agents,
          runTag,
          false,
        );
        if (terminalRegistryEnabled) {
          appendTerminalEntries(lanePaths.terminalsPath, terminalEntries);
          terminalsAppended = true;
        }

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
            lane: lanePaths.lane,
            wave: wave.wave,
            resultsDir: lanePaths.resultsDir,
            sessionName,
            promptPath: path.join(lanePaths.promptsDir, `${safeName}.prompt.md`),
            logPath: path.join(lanePaths.logsDir, `${safeName}.log`),
            statusPath: path.join(lanePaths.statusDir, `${safeName}.status`),
            previewPath: path.join(
              lanePaths.executorOverlaysDir,
              `wave-${wave.wave}`,
              agent.slug,
              "launch-preview.json",
            ),
            messageBoardPath,
            messageBoardSnapshot: derivedState.messageBoardText,
            sharedSummaryPath: derivedState.sharedSummaryPath,
            sharedSummaryText: derivedState.sharedSummaryText,
            inboxPath: derivedState.inboxesByAgentId[agent.agentId]?.path || null,
            inboxText: derivedState.inboxesByAgentId[agent.agentId]?.text || "",
          };
        });
        const roleBindings = resolveWaveRoleBindings(wave, lanePaths, wave.agents);

        const refreshDerivedState = (attemptNumber = 0) => {
          const proofRegistry = readWaveProofRegistry(lanePaths, wave.wave);
          for (const run of agentRuns) {
            run.proofRegistry = proofRegistry;
          }
          const summariesByAgentId = Object.fromEntries(
            agentRuns
              .map((run) => [run.agent.agentId, readRunExecutionSummary(run, wave)])
              .filter(([, summary]) => summary),
          );
          const feedbackRequests = readWaveHumanFeedbackRequests({
            feedbackRequestsDir: lanePaths.feedbackRequestsDir,
            lane: lanePaths.lane,
            waveNumber: wave.wave,
            agentIds: agentRuns.map((run) => run.agent.agentId),
            orchestratorId: options.orchestratorId,
          });
          derivedState = buildWaveDerivedState({
            lanePaths,
            wave,
            agentRuns,
            summariesByAgentId,
            feedbackRequests,
            attempt: attemptNumber,
            orchestratorId: options.orchestratorId,
          });
          writeWaveDerivedProjections({ lanePaths, wave, derivedState });
          const controlPlaneLogPath = path.join(
            lanePaths.controlPlaneDir,
            `wave-${wave.wave}.jsonl`,
          );
          const controlPlaneEvents = fs.existsSync(controlPlaneLogPath)
            ? readControlPlaneEvents(controlPlaneLogPath)
            : [];
          derivedState = {
            ...derivedState,
            controlPlaneEvents,
            contradictions: materializeContradictionsFromControlPlaneEvents(controlPlaneEvents),
          };
          for (const run of agentRuns) {
            run.messageBoardSnapshot = derivedState.messageBoardText;
            run.sharedSummaryPath = derivedState.sharedSummaryPath;
            run.sharedSummaryText = derivedState.sharedSummaryText;
            run.inboxPath = derivedState.inboxesByAgentId[run.agent.agentId]?.path || null;
            run.inboxText = derivedState.inboxesByAgentId[run.agent.agentId]?.text || "";
          }
          applyDerivedStateToDashboard(dashboardState, derivedState);
          return derivedState;
        };

        let latestReducerSnapshot = null;
        const refreshReducerSnapshot = (attemptNumber = 0, extra = {}) => {
          latestReducerSnapshot = computeReducerSnapshot({
            lanePaths,
            wave,
            agentRuns,
            derivedState,
            attempt: attemptNumber,
            options,
            ...extra,
          });
          return latestReducerSnapshot;
        };

        refreshDerivedState(0);
        const launchStateReset = resetPersistedWaveLaunchState(lanePaths, wave.wave, options);
        if (launchStateReset.clearedRelaunchPlan) {
          appendCoordination({
            event: "wave_launch_state_reset",
            waves: [wave.wave],
            status: "running",
            details: `cleared_relaunch_plan=yes; previous_agents=${(launchStateReset.relaunchPlan?.selectedAgentIds || []).join(",") || "none"}`,
            actionRequested: "None",
          });
        }
        let persistedRelaunchPlan = readWaveRelaunchPlan(lanePaths, wave.wave);
        let retryOverride = readWaveRetryOverride(lanePaths, wave.wave);

        dashboardState = buildWaveDashboardState({
          lane: lanePaths.lane,
          wave: wave.wave,
          waveFile: wave.file,
          runTag,
          maxAttempts: options.maxRetriesPerWave + 1,
          messageBoardPath,
          agentRuns,
        });
        applyDerivedStateToDashboard(dashboardState, derivedState);
        const feedbackStateByRequestId = new Map();
        const coordinationAlertState = {
          overdueAckSignature: "",
          overdueClarificationSignature: "",
        };
        let lastLiveCoordinationRefreshAt = 0;
        const emitCoordinationAlertEvents = (currentDerivedState = derivedState) => {
          const responseMetrics =
            currentDerivedState?.responseMetrics ||
            buildCoordinationResponseMetrics(currentDerivedState?.coordinationState);
          const overdueAckSignature = (responseMetrics?.overdueAckRecordIds || []).join(",");
          if (
            overdueAckSignature &&
            overdueAckSignature !== coordinationAlertState.overdueAckSignature
          ) {
            recordCombinedEvent({
              level: "warn",
              message: `Overdue acknowledgements in coordination state: ${overdueAckSignature}.`,
            });
            appendCoordination({
              event: "coordination_ack_overdue",
              waves: [wave.wave],
              status: "warn",
              details: `records=${overdueAckSignature}; ack_timeout_ms=${DEFAULT_COORDINATION_ACK_TIMEOUT_MS}`,
              actionRequested:
                "Assigned owners should acknowledge, resolve, or reroute the targeted coordination items.",
            });
          }
          coordinationAlertState.overdueAckSignature = overdueAckSignature;
          const overdueClarificationSignature = (responseMetrics?.overdueClarificationIds || []).join(
            ",",
          );
          if (
            overdueClarificationSignature &&
            overdueClarificationSignature !== coordinationAlertState.overdueClarificationSignature
          ) {
            recordCombinedEvent({
              level: "warn",
              message: `Stale clarification chains remain open: ${overdueClarificationSignature}.`,
            });
            appendCoordination({
              event: "clarification_chain_stale",
              waves: [wave.wave],
              status: "warn",
              details: `clarifications=${overdueClarificationSignature}`,
              actionRequested:
                "The orchestrator should reroute, resolve, or escalate the stale clarification chain.",
            });
          }
          coordinationAlertState.overdueClarificationSignature = overdueClarificationSignature;
        };
        const refreshActiveCoordinationState = (attemptNumber = 0, { force = false } = {}) => {
          const nowMs = Date.now();
          if (!force && nowMs - lastLiveCoordinationRefreshAt < DEFAULT_LIVE_COORDINATION_REFRESH_MS) {
            return false;
          }
          refreshDerivedState(attemptNumber);
          lastLiveCoordinationRefreshAt = nowMs;
          updateWaveDashboardMessageBoard(dashboardState, messageBoardPath);
          emitCoordinationAlertEvents(derivedState);
          flushDashboards();
          return true;
        };
        const syncWaveSignals = () =>
          syncLiveWaveSignals({
            lanePaths,
            wave,
            statusPayload: buildControlStatusPayload({
              lanePaths,
              wave,
            }),
            agentRuns,
            residentEnabled: Boolean(residentOrchestratorRun),
            recordCombinedEvent,
            appendCoordination,
          });

        const proofRegistryForReuse = readWaveProofRegistry(lanePaths, wave.wave);
        const initialAttemptPlan = planInitialWaveAttempt({
          agentRuns,
          lanePaths,
          wave,
          derivedState,
          proofRegistry: proofRegistryForReuse,
          retryOverride,
          persistedRelaunchPlan,
        });
        const preCompletedAgentIds = initialAttemptPlan.preCompletedAgentIds;
        for (const agentId of preCompletedAgentIds) {
          setWaveDashboardAgent(dashboardState, agentId, {
            state: "completed",
            exitCode: 0,
            completedAt: toIsoTimestamp(),
            detail: "Pre-existing status=0",
          });
        }
        const staleCompletedAgentIds = initialAttemptPlan.staleCompletedAgentIds;
        for (const agentId of staleCompletedAgentIds) {
          setWaveDashboardAgent(dashboardState, agentId, {
            state: "pending",
            detail: "Stale status=0 ignored due to prompt drift or missing metadata",
          });
        }
        flushDashboards();
        emitCoordinationAlertEvents(derivedState);
        syncWaveSignals();

        if (options.dashboard && currentWaveDashboardTerminalEntry) {
          launchWaveDashboardSession(lanePaths, {
            sessionName: currentWaveDashboardTerminalEntry.sessionName,
            dashboardPath,
            messageBoardPath,
          });
          console.log(
            `[dashboard] attach current: pnpm exec wave dashboard --lane ${lanePaths.lane} --attach current`,
          );
        }

        if (options.residentOrchestrator) {
          const residentSetup = buildResidentOrchestratorRun({
            lanePaths,
            wave,
            agentRuns,
            derivedState,
            dashboardPath,
            runTag,
            options,
          });
          if (residentSetup.skipReason) {
            recordCombinedEvent({
              level: "warn",
              message: residentSetup.skipReason,
            });
          } else if (residentSetup.run) {
            residentOrchestratorRun = residentSetup.run;
            const launchResult = await launchAgentSession(lanePaths, {
              wave: wave.wave,
              waveDefinition: wave,
              agent: residentOrchestratorRun.agent,
              sessionName: residentOrchestratorRun.sessionName,
              promptPath: residentOrchestratorRun.promptPath,
              logPath: residentOrchestratorRun.logPath,
              statusPath: residentOrchestratorRun.statusPath,
              messageBoardPath: derivedState.messageBoardPath,
              messageBoardSnapshot: derivedState.messageBoardText,
              sharedSummaryPath: derivedState.sharedSummaryPath,
              sharedSummaryText: derivedState.sharedSummaryText,
              inboxPath: null,
              inboxText: "",
              promptOverride: residentOrchestratorRun.promptOverride,
              orchestratorId: options.orchestratorId,
              agentRateLimitRetries: options.agentRateLimitRetries,
              agentRateLimitBaseDelaySeconds: options.agentRateLimitBaseDelaySeconds,
              agentRateLimitMaxDelaySeconds: options.agentRateLimitMaxDelaySeconds,
              context7Enabled: options.context7Enabled,
            });
            residentOrchestratorRun.lastPromptHash = launchResult?.promptHash || null;
            residentOrchestratorRun.lastExecutorId =
              launchResult?.executorId || residentOrchestratorRun.agent.executorResolved?.id || null;
            recordCombinedEvent({
              agentId: residentOrchestratorRun.agent.agentId,
              message: `Resident orchestrator launched in tmux session ${residentOrchestratorRun.sessionName}`,
            });
            appendCoordination({
              event: "resident_orchestrator_start",
              waves: [wave.wave],
              status: "running",
              details: `session=${residentOrchestratorRun.sessionName}; executor=${residentOrchestratorRun.lastExecutorId || "unknown"}`,
              actionRequested: "None",
            });
            syncWaveSignals();
          }
        }

        if (initialAttemptPlan.shouldClearPersistedRelaunchPlan) {
          clearWaveRelaunchPlan(lanePaths, wave.wave);
          persistedRelaunchPlan = null;
        }
        const overrideRuns = initialAttemptPlan.overrideResolution;
        if (overrideRuns.unknownAgentIds.length > 0) {
          appendCoordination({
            event: "retry_override_invalid",
            waves: [wave.wave],
            status: "warn",
            details: `unknown_agents=${overrideRuns.unknownAgentIds.join(",")}`,
            actionRequested:
              "Retry override references agent ids that do not exist in the current wave definition.",
          });
          clearWaveRetryOverride(lanePaths, wave.wave);
          retryOverride = null;
        }
        let runsToLaunch = initialAttemptPlan.selectedRuns;
        if (initialAttemptPlan.source === "override" && overrideRuns.runs.length > 0) {
          appendCoordination({
            event: "retry_override_applied",
            waves: [wave.wave],
            status: "running",
            details: `agents=${overrideRuns.selectedAgentIds.join(",")}; requested_by=${retryOverride?.requestedBy || "human-operator"}`,
            actionRequested: "None",
          });
          if (retryOverride?.applyOnce !== false) {
            clearWaveRetryOverride(lanePaths, wave.wave);
            retryOverride = null;
          }
        }
        let attempt = 1;
        let traceAttempt = 1;
        let completionGateSnapshot = null;
        let completionTraceDir = null;
        recordWaveRunState(lanePaths, wave.wave, "started", {
          agentIds: wave.agents.map((agent) => agent.agentId),
          runVariant: lanePaths.runVariant || "live",
        });

        while (attempt <= options.maxRetriesPerWave + 1) {
          refreshDerivedState(attempt - 1);
          lastLiveCoordinationRefreshAt = Date.now();
          dashboardState.attempt = attempt;
          updateWaveDashboardMessageBoard(dashboardState, messageBoardPath);
          emitCoordinationAlertEvents(derivedState);
          flushDashboards();
          recordCombinedEvent({
            message: `Attempt ${attempt}/${options.maxRetriesPerWave + 1}; launching agents: ${runsToLaunch.map((run) => run.agent.agentId).join(", ") || "none"}`,
          });
          recordAttemptState(lanePaths, wave.wave, attempt, "running", {
            selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
            detail: `Launching ${runsToLaunch.map((run) => run.agent.agentId).join(", ") || "no"} agents.`,
            createdAt: toIsoTimestamp(),
          });

          const launchedImplementationRuns = runsToLaunch.filter(
            (run) =>
              !isClosureRoleAgentId(run.agent.agentId, roleBindings) &&
              (!isDesignAgent(run.agent) || isImplementationOwningDesignAgent(run.agent)),
          );
          const launchedDesignRuns = runsToLaunch.filter((run) => isDesignAgent(run.agent));
          const closureOnlyRetry =
            runsToLaunch.length > 0 &&
            launchedImplementationRuns.length === 0 &&
            runsToLaunch.every((run) => isClosureRoleAgentId(run.agent.agentId, roleBindings));

          let failures = [];
          let timedOut = false;
          if (closureOnlyRetry) {
            const closureResult = await runClosureSweepPhase({
              lanePaths,
              wave,
              closureRuns: runsToLaunch,
              coordinationLogPath: derivedState.coordinationLogPath,
              refreshDerivedState,
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
                designExecutionMode:
                  isDesignAgent(runInfo.agent)
                    ? launchedImplementationRuns.some(
                        (candidate) => candidate.agent.agentId === runInfo.agent.agentId,
                      )
                      ? "implementation-pass"
                      : "design-pass"
                    : null,
                attempt,
                controlPlane: {
                  waveNumber: wave.wave,
                  attempt,
                },
              });
              runInfo.lastLaunchAttempt = attempt;
              runInfo.lastPromptHash = launchResult?.promptHash || null;
              runInfo.lastContext7 = launchResult?.context7 || null;
              runInfo.lastExecutorId = launchResult?.executorId || runInfo.agent.executorResolved?.id || null;
              runInfo.lastSkillProjection =
                launchResult?.skills || summarizeResolvedSkills(runInfo.agent.skillsResolved);
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
              runsToLaunch,
              options.timeoutMinutes,
              ({ pendingAgentIds }) => {
                refreshWaveDashboardAgentStates(
                  dashboardState,
                  runsToLaunch,
                  pendingAgentIds,
                  (event) => recordCombinedEvent(event),
                );
                const feedbackChanged = monitorWaveHumanFeedback({
                  lanePaths,
                  waveNumber: wave.wave,
                  agentRuns: runsToLaunch,
                  orchestratorId: options.orchestratorId,
                  coordinationLogPath: derivedState.coordinationLogPath,
                  feedbackStateByRequestId,
                  recordCombinedEvent,
                  appendCoordination,
                });
                const residentChanged = monitorResidentOrchestratorSession({
                  lanePaths,
                  run: residentOrchestratorRun,
                  waveNumber: wave.wave,
                  recordCombinedEvent,
                  appendCoordination,
                  sessionState: residentOrchestratorState,
                });
                const refreshed = refreshActiveCoordinationState(attempt, {
                  force: feedbackChanged || residentChanged,
                });
                if (!refreshed) {
                  updateWaveDashboardMessageBoard(dashboardState, messageBoardPath);
                  flushDashboards();
                }
                syncWaveSignals();
              },
              {
                controlPlane: {
                  waveNumber: wave.wave,
                  attempt,
                },
              },
            );
            failures = waitResult.failures;
            timedOut = waitResult.timedOut;
          }

          materializeAgentExecutionSummaries(wave, agentRuns);
          refreshDerivedState(attempt);
          syncWaveSignals();
          lastLiveCoordinationRefreshAt = Date.now();
          emitCoordinationAlertEvents(derivedState);
          failures = reconcileFailuresAgainstSharedComponentState(wave, agentRuns, failures);
          for (const failure of failures) {
            if (failure.statusCode === "shared-component-sibling-pending") {
              applySharedComponentWaitStateToDashboard(failure, dashboardState);
            }
          }

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
            if (launchedDesignRuns.length > 0 && launchedImplementationRuns.length === 0) {
              const reducerDecision = refreshReducerSnapshot(attempt);
              const designGate = reducerDecision?.reducerState?.gateSnapshot?.designGate || null;
              const remainingImplementationRuns = agentRuns.filter(
                (run) =>
                  !preCompletedAgentIds.has(run.agent.agentId) &&
                  !isClosureRoleAgentId(run.agent.agentId, roleBindings) &&
                  (!isDesignAgent(run.agent) || isImplementationOwningDesignAgent(run.agent)),
              );
              if (designGate?.ok && remainingImplementationRuns.length > 0) {
                recordAttemptState(lanePaths, wave.wave, attempt, "completed", {
                  selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
                  detail: `Design pass complete; continuing with implementation agents ${remainingImplementationRuns.map((run) => run.agent.agentId).join(", ")}.`,
                });
                recordCombinedEvent({
                  message: `Design pass complete; launching implementation agents next: ${remainingImplementationRuns.map((run) => run.agent.agentId).join(", ")}.`,
                });
                appendCoordination({
                  event: "wave_design_ready",
                  waves: [wave.wave],
                  status: "running",
                  details: `next_agents=${remainingImplementationRuns.map((run) => run.agent.agentId).join(",")}`,
                  actionRequested: "None",
                });
                runsToLaunch = remainingImplementationRuns;
                for (const run of runsToLaunch) {
                  setWaveDashboardAgent(dashboardState, run.agent.agentId, {
                    state: "pending",
                    detail: "Queued after design handoff",
                  });
                }
                flushDashboards();
                attempt += 1;
                traceAttempt += 1;
                continue;
              }
            }
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
            } else {
              const componentGate = readWaveComponentGate(wave, agentRuns, {
                laneProfile: lanePaths.laneProfile,
                mode: "live",
              });
              if (!componentGate.ok) {
                if (componentGate.statusCode === "shared-component-sibling-pending") {
                  applySharedComponentWaitStateToDashboard(componentGate, dashboardState);
                }
                failures = [
                  {
                    agentId: componentGate.agentId,
                    statusCode: componentGate.statusCode,
                    logPath:
                      componentGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                    detail: componentGate.detail,
                    ownerAgentIds: componentGate.ownerAgentIds || [],
                    satisfiedAgentIds: componentGate.satisfiedAgentIds || [],
                    waitingOnAgentIds: componentGate.waitingOnAgentIds || [],
                    failedOwnContractAgentIds: componentGate.failedOwnContractAgentIds || [],
                  },
                ];
                recordCombinedEvent({
                  level: "error",
                  agentId: componentGate.agentId,
                  message: `Component promotion blocked wave ${wave.wave}: ${componentGate.detail}`,
                });
                appendCoordination({
                  event: "wave_gate_blocked",
                  waves: [wave.wave],
                  status: "blocked",
                  details: `component=${componentGate.componentId || "unknown"}; reason=${componentGate.statusCode}; ${componentGate.detail}`,
                  actionRequested: `Lane ${lanePaths.lane} owners should close the component promotion gap before wave progression.`,
                });
              } else if (launchedImplementationRuns.length > 0) {
                const reducerDecision = refreshReducerSnapshot(attempt);
                const helperAssignmentBarrier =
                  reducerDecision?.reducerState?.gateSnapshot?.helperAssignmentBarrier ||
                  readWaveAssignmentBarrier(derivedState);
                const dependencyBarrier =
                  reducerDecision?.reducerState?.gateSnapshot?.dependencyBarrier ||
                  readWaveDependencyBarrier(derivedState);
                if (!helperAssignmentBarrier.ok) {
                  failures = [
                    {
                      agentId: null,
                      statusCode: helperAssignmentBarrier.statusCode,
                      logPath: path.relative(REPO_ROOT, messageBoardPath),
                      detail: helperAssignmentBarrier.detail,
                    },
                  ];
                  recordCombinedEvent({
                    level: "error",
                    message: `Helper assignment barrier blocked wave ${wave.wave}: ${helperAssignmentBarrier.detail}`,
                  });
                  appendCoordination({
                    event: "wave_gate_blocked",
                    waves: [wave.wave],
                    status: "blocked",
                    details: `reason=${helperAssignmentBarrier.statusCode}; ${helperAssignmentBarrier.detail}`,
                    actionRequested: `Lane ${lanePaths.lane} owners should resolve helper assignments before closure.`,
                  });
                } else if (!dependencyBarrier.ok) {
                  failures = [
                    {
                      agentId: null,
                      statusCode: dependencyBarrier.statusCode,
                      logPath: path.relative(REPO_ROOT, messageBoardPath),
                      detail: dependencyBarrier.detail,
                    },
                  ];
                  recordCombinedEvent({
                    level: "error",
                    message: `Dependency barrier blocked wave ${wave.wave}: ${dependencyBarrier.detail}`,
                  });
                  appendCoordination({
                    event: "wave_gate_blocked",
                    waves: [wave.wave],
                    status: "blocked",
                    details: `reason=${dependencyBarrier.statusCode}; ${dependencyBarrier.detail}`,
                    actionRequested: `Lane ${lanePaths.lane} owners should resolve required dependency tickets before closure.`,
                  });
                } else {
                  recordCombinedEvent({
                    message: `Implementation pass complete; running closure sweep for ${wave.wave}.`,
                  });
                  const closureResult = await runClosureSweepPhase({
                    lanePaths,
                    wave,
                    closureRuns: agentRuns.filter((run) =>
                      isClosureRoleAgentId(run.agent.agentId, roleBindings),
                    ),
                    coordinationLogPath: derivedState.coordinationLogPath,
                    refreshDerivedState,
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
                  refreshDerivedState(attempt);
                }
              } else {
                recordCombinedEvent({
                  message: "Implementation exit contracts and component promotions are satisfied.",
                });
              }
            }
          }

          if (failures.length === 0) {
            const reducerDecision = refreshReducerSnapshot(attempt);
            const helperAssignmentBarrier =
              reducerDecision?.reducerState?.gateSnapshot?.helperAssignmentBarrier ||
              readWaveAssignmentBarrier(derivedState);
            if (!helperAssignmentBarrier.ok) {
              failures = [
                {
                  agentId: null,
                  statusCode: helperAssignmentBarrier.statusCode,
                  logPath: path.relative(REPO_ROOT, messageBoardPath),
                  detail: helperAssignmentBarrier.detail,
                },
              ];
              recordCombinedEvent({
                level: "error",
                message: `Helper assignment barrier blocked wave ${wave.wave}: ${helperAssignmentBarrier.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `reason=${helperAssignmentBarrier.statusCode}; ${helperAssignmentBarrier.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve helper assignments before wave progression.`,
              });
            }
          }

          if (failures.length === 0) {
            const reducerDecision = refreshReducerSnapshot(attempt);
            const dependencyBarrier =
              reducerDecision?.reducerState?.gateSnapshot?.dependencyBarrier ||
              readWaveDependencyBarrier(derivedState);
            if (!dependencyBarrier.ok) {
              failures = [
                {
                  agentId: null,
                  statusCode: dependencyBarrier.statusCode,
                  logPath: path.relative(REPO_ROOT, messageBoardPath),
                  detail: dependencyBarrier.detail,
                },
              ];
              recordCombinedEvent({
                level: "error",
                message: `Dependency barrier blocked wave ${wave.wave}: ${dependencyBarrier.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `reason=${dependencyBarrier.statusCode}; ${dependencyBarrier.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve required dependencies before wave progression.`,
              });
            }
          }

          if (failures.length === 0) {
            const reducerDecision = refreshReducerSnapshot(attempt);
            const authoritativeGateSnapshot = reducerDecision?.reducerState?.gateSnapshot;
            completionGateSnapshot = authoritativeGateSnapshot;
            const failingGateName = authoritativeGateSnapshot?.overall?.ok === false
              ? authoritativeGateSnapshot.overall.gate
              : null;
            const failingGate =
              failingGateName && authoritativeGateSnapshot
                ? authoritativeGateSnapshot[failingGateName]
                : null;
            if (failingGateName && failingGate) {
              if (
                failingGateName === "componentGate" &&
                failingGate.statusCode === "shared-component-sibling-pending"
              ) {
                applySharedComponentWaitStateToDashboard(failingGate, dashboardState);
              }
              failures = [
                buildFailureFromGate(
                  failingGateName,
                  failingGate,
                  path.relative(REPO_ROOT, messageBoardPath),
                ),
              ];
              recordCombinedEvent({
                level: "error",
                agentId: failingGate.agentId || null,
                message: `${waveGateLabel(failingGateName)} blocked wave ${wave.wave}: ${failingGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `${failingGate.componentId ? `component=${failingGate.componentId}; ` : ""}${failingGate.agentId ? `agent=${failingGate.agentId}; ` : ""}reason=${failingGate.statusCode}; ${failingGate.detail}`,
                actionRequested: waveGateActionRequested(failingGateName, lanePaths),
              });
            } else if (authoritativeGateSnapshot?.contQaGate?.ok) {
              const contQaGate = authoritativeGateSnapshot.contQaGate;
              setWaveDashboardAgent(dashboardState, contQaGate.agentId, {
                detail: contQaGate.detail
                  ? `Exit 0; cont-QA PASS (${contQaGate.detail})`
                  : "Exit 0; cont-QA PASS",
              });
              recordCombinedEvent({
                agentId: contQaGate.agentId,
                message: contQaGate.detail
                  ? `cont-QA verdict PASS: ${contQaGate.detail}`
                  : "cont-QA verdict PASS.",
              });
            }
          }

          const gateSnapshot =
            completionGateSnapshot || refreshReducerSnapshot(attempt).reducerState.gateSnapshot;
          completionGateSnapshot = gateSnapshot;
          const traceProjection = writeWaveAttemptTraceProjection({
            tracesDir: lanePaths.tracesDir,
            lanePaths,
            launcherOptions: options,
            wave,
            attempt: traceAttempt,
            manifest: buildManifest(lanePaths, [wave]),
            agentRuns,
            gateSnapshot,
            derivedState,
          });
          const traceDir = traceProjection.traceDir;
          completionTraceDir = traceDir;
          appendWaveControlEvent(lanePaths, wave.wave, {
            entityType: "gate",
            entityId: `wave-${wave.wave}-attempt-${attempt}-gate`,
            action: "evaluated",
            source: "launcher",
            actor: "launcher",
            attempt,
            data: {
              attemptNumber: attempt,
              traceDir: path.relative(REPO_ROOT, traceDir),
              gateSnapshot,
              qualitySummary: {
                contradictionCount: Array.isArray(derivedState?.contradictions)
                  ? derivedState.contradictions.length
                  : derivedState?.contradictions instanceof Map
                    ? derivedState.contradictions.size
                    : 0,
                finalRecommendation: derivedState.integrationSummary?.recommendation || "unknown",
              },
            },
          });
          await flushWaveControlTelemetry();

          const sharedComponentContinuationRuns = resolveSharedComponentContinuationRuns(
            runsToLaunch,
            agentRuns,
            failures,
            derivedState,
            lanePaths,
            wave,
          );
          if (sharedComponentContinuationRuns.length > 0) {
            recordAttemptState(lanePaths, wave.wave, attempt, "completed", {
              selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
              detail: `Attempt completed; continuing with sibling owners ${sharedComponentContinuationRuns.map((run) => run.agent.agentId).join(", ")}.`,
            });
            runsToLaunch = sharedComponentContinuationRuns;
            const nextAgentIds = runsToLaunch.map((run) => run.agent.agentId);
            const nextAgentSummary = nextAgentIds.join(", ");
            recordCombinedEvent({
              message: `Shared component closure now depends on sibling owners: ${nextAgentSummary}.`,
            });
            appendCoordination({
              event: "wave_shared_component_continue",
              waves: [wave.wave],
              status: "running",
              details: `attempt=${attempt}/${options.maxRetriesPerWave + 1}; next_agents=${nextAgentSummary}`,
              actionRequested: `Lane ${lanePaths.lane} owners should let the remaining shared-component owners finish their proof before further retries.`,
            });
            for (const run of runsToLaunch) {
              setWaveDashboardAgent(dashboardState, run.agent.agentId, {
                state: "pending",
                detail: "Queued for shared component closure",
              });
            }
            writeWaveRelaunchProjection({
              lanePaths,
              wave,
              attempt,
              runs: runsToLaunch,
              failures,
              derivedState,
            });
            flushDashboards();
            traceAttempt += 1;
            continue;
          }

          if (failures.length === 0) {
            recordAttemptState(lanePaths, wave.wave, attempt, "completed", {
              selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
              detail: "Wave gates passed for this attempt.",
            });
            recordWaveRunState(lanePaths, wave.wave, "completed", {
              attempts: attempt,
              traceDir: completionTraceDir ? path.relative(REPO_ROOT, completionTraceDir) : null,
              gateSnapshot: completionGateSnapshot,
            });
            dashboardState.status = "completed";
            recordCombinedEvent({ message: `Wave ${wave.wave} completed successfully.` });
            refreshWaveDashboardAgentStates(dashboardState, agentRuns, new Set(), (event) =>
              recordCombinedEvent(event),
            );
            updateWaveDashboardMessageBoard(dashboardState, messageBoardPath);
            flushDashboards();
            await flushWaveControlTelemetry();
            break;
          }

          if (attempt >= options.maxRetriesPerWave + 1) {
            recordAttemptState(lanePaths, wave.wave, attempt, "failed", {
              selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
              detail: failures
                .map((failure) => `${failure.agentId || "wave"}:${failure.statusCode}`)
                .join(", "),
            });
            recordWaveRunState(lanePaths, wave.wave, "failed", {
              attempts: attempt,
              traceDir: completionTraceDir ? path.relative(REPO_ROOT, completionTraceDir) : null,
              gateSnapshot: completionGateSnapshot,
              failures: failures.map((failure) => ({
                agentId: failure.agentId || null,
                statusCode: failure.statusCode,
                detail: failure.detail || null,
              })),
            });
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
            await flushWaveControlTelemetry();
            if (
              failures.every(
                (failure) =>
                  String(failure.statusCode).startsWith("cont-qa-") ||
                  String(failure.statusCode) === "missing-cont-qa-verdict",
              )
            ) {
              error.exitCode = 42;
            }
            throw error;
          }

          const failedAgentIds = new Set(failures.map((failure) => failure.agentId));
          const failedList = Array.from(failedAgentIds).join(", ");
          recordAttemptState(lanePaths, wave.wave, attempt, "failed", {
            selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
            detail: failures
              .map((failure) => `${failure.agentId || "wave"}:${failure.statusCode}`)
              .join(", "),
          });
          console.warn(
            `[retry] Wave ${wave.wave} had failures for agents: ${failedList}. Evaluating safe relaunch targets.`,
          );
          appendCoordination({
            event: "wave_retry",
            waves: [wave.wave],
            status: "retrying",
            details: `attempt=${attempt + 1}/${options.maxRetriesPerWave + 1}; failed_agents=${failedList}; timed_out=${timedOut ? "yes" : "no"}`,
            actionRequested: `Lane ${lanePaths.lane} owners should inspect failed agent logs before retry completion.`,
          });
          retryOverride = readWaveRetryOverride(lanePaths, wave.wave);
          const reducerDecision = refreshReducerSnapshot(attempt);
          const retryPlan = planRetryWaveAttempt({
            agentRuns,
            failures,
            derivedState,
            lanePaths,
            wave,
            retryOverride,
            waveState: reducerDecision?.reducerState || null,
          });
          const relaunchResolution = retryPlan.relaunchResolution;
          const overrideResolution = retryPlan.overrideResolution;
          if (overrideResolution.unknownAgentIds.length > 0) {
            appendCoordination({
              event: "retry_override_invalid",
              waves: [wave.wave],
              status: "warn",
              details: `unknown_agents=${overrideResolution.unknownAgentIds.join(",")}`,
              actionRequested:
                "Retry override references agent ids that do not exist in the current wave definition.",
            });
            clearWaveRetryOverride(lanePaths, wave.wave);
            retryOverride = null;
          } else if (retryPlan.source === "override" && overrideResolution.runs.length > 0) {
            runsToLaunch = retryPlan.selectedRuns;
            appendCoordination({
              event: "retry_override_applied",
              waves: [wave.wave],
              status: "running",
              details: `agents=${overrideResolution.selectedAgentIds.join(",")}; requested_by=${retryOverride?.requestedBy || "human-operator"}`,
              actionRequested: "None",
            });
            if (retryOverride?.applyOnce !== false) {
              clearWaveRetryOverride(lanePaths, wave.wave);
              retryOverride = null;
            }
          } else if (relaunchResolution.barrier) {
            clearWaveRelaunchPlan(lanePaths, wave.wave);
            for (const failure of relaunchResolution.barrier.failures) {
              recordCombinedEvent({
                level: "error",
                agentId: failure.agentId,
                message: failure.detail,
              });
              setWaveDashboardAgent(dashboardState, failure.agentId, {
                state: "failed",
                detail: failure.detail,
              });
            }
            flushDashboards();
            appendCoordination({
              event: "wave_retry_blocked",
              waves: [wave.wave],
              status: "blocked",
              details: relaunchResolution.barrier.detail,
              actionRequested: `Lane ${lanePaths.lane} owners should resolve runtime policy or executor availability before retrying.`,
            });
            const error = new Error(
              `Wave ${wave.wave} retry blocked: ${relaunchResolution.barrier.detail}`,
            );
            error.exitCode = 43;
            throw error;
          } else {
            runsToLaunch = retryPlan.selectedRuns;
          }
          if (runsToLaunch.length === 0) {
            clearWaveRelaunchPlan(lanePaths, wave.wave);
            const error = new Error(
              `Wave ${wave.wave} is waiting on human feedback or unresolved coordination state; no safe relaunch target is available.`,
            );
            error.exitCode = 43;
            throw error;
          }
          for (const run of runsToLaunch) {
            setWaveDashboardAgent(dashboardState, run.agent.agentId, {
              state: "pending",
              detail: "Queued for retry",
            });
          }
          writeWaveRelaunchProjection({
            lanePaths,
            wave,
            attempt: attempt + 1,
            runs: runsToLaunch,
            failures,
            derivedState,
          });
          flushDashboards();
          attempt += 1;
          traceAttempt += 1;
        }

        clearWaveRelaunchPlan(lanePaths, wave.wave);
        const runState = markWaveCompleted(options.runStatePath, wave.wave, {
          source: "live-launcher",
          reasonCode: "wave-complete",
          detail: `Wave ${wave.wave} completed after ${dashboardState?.attempt || 1} attempt(s).`,
          evidence: buildRunStateEvidence({
            wave,
            agentRuns,
            coordinationLogPath: derivedState.coordinationLogPath,
            assignmentsPath: waveAssignmentsPath(lanePaths, wave.wave),
            dependencySnapshotPath: waveDependencySnapshotPath(lanePaths, wave.wave),
            gateSnapshot: completionGateSnapshot,
            traceDir: completionTraceDir,
          }),
        });
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
        if (residentOrchestratorRun) {
          killTmuxSessionIfExists(lanePaths.tmuxSocketName, residentOrchestratorRun.sessionName);
        }
        if (terminalsAppended && !options.keepTerminals) {
          removeTerminalEntries(lanePaths.terminalsPath, terminalEntries);
        }
        if (options.cleanupSessions) {
          const excludeSessionNames = new Set();
          if (globalDashboardTerminalEntry) {
            excludeSessionNames.add(globalDashboardTerminalEntry.sessionName);
          }
          if (currentWaveDashboardTerminalEntry) {
            excludeSessionNames.add(currentWaveDashboardTerminalEntry.sessionName);
          }
          cleanupLaneTmuxSessions(lanePaths, { excludeSessionNames });
        }
        if (globalWave && globalWave.status === "running") {
          globalWave.status = dashboardState?.status || "failed";
          if (WAVE_TERMINAL_STATES.has(globalWave.status)) {
            globalWave.completedAt = toIsoTimestamp();
          }
          writeDashboardProjections({ lanePaths, globalDashboard });
        }
      }
    }

    globalDashboard.status = "completed";
    recordGlobalDashboardEvent(globalDashboard, { message: "All selected waves completed." });
    writeDashboardProjections({ lanePaths, globalDashboard });
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
    writeDashboardProjections({ lanePaths, globalDashboard });
    throw error;
  } finally {
    if (globalDashboardTerminalAppended && globalDashboardTerminalEntry && !options.keepTerminals) {
      removeTerminalEntries(lanePaths.terminalsPath, [globalDashboardTerminalEntry]);
    }
    if (
      currentWaveDashboardTerminalAppended &&
      currentWaveDashboardTerminalEntry &&
      !options.keepTerminals
    ) {
      removeTerminalEntries(lanePaths.terminalsPath, [currentWaveDashboardTerminalEntry]);
    }
    if (options.cleanupSessions && globalDashboardTerminalEntry) {
      try {
        killTmuxSessionIfExists(lanePaths.tmuxSocketName, globalDashboardTerminalEntry.sessionName);
      } catch {
        // no-op
      }
    }
    if (options.cleanupSessions && currentWaveDashboardTerminalEntry) {
      try {
        killTmuxSessionIfExists(
          lanePaths.tmuxSocketName,
          currentWaveDashboardTerminalEntry.sessionName,
        );
      } catch {
        // no-op
      }
    }
    if (lockHeld) {
      releaseLauncherLock(lanePaths.launcherLockPath);
    }
  }
}
