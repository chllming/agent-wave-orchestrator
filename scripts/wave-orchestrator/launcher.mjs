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
  buildResidentOrchestratorPrompt,
  ensureOrchestratorBoard,
  feedbackStateSignature,
  readWaveHumanFeedbackRequests,
} from "./coordination.mjs";
import {
  appendCoordinationRecord,
  buildCoordinationResponseMetrics,
  compileAgentInbox,
  compileSharedSummary,
  isOpenCoordinationStatus,
  openClarificationLinkedRequests,
  readMaterializedCoordinationState,
  renderCoordinationBoardProjection,
  updateSeedRecords,
  writeCompiledInbox,
  writeCoordinationBoardProjection,
  writeJsonArtifact,
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
  DEFAULT_COORDINATION_ACK_TIMEOUT_MS,
  DEFAULT_LIVE_COORDINATION_REFRESH_MS,
  DEFAULT_MAX_RETRIES_PER_WAVE,
  DEFAULT_TIMEOUT_MINUTES,
  DEFAULT_WAVE_LANE,
  compactSingleLine,
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
import { buildDocsQueue, readDocsQueue, writeDocsQueue } from "./docs-queue.mjs";
import { deriveWaveLedger, readWaveLedger, writeWaveLedger } from "./ledger.mjs";
import {
  augmentSummaryWithProofRegistry,
  readWaveProofRegistry,
  waveProofRegistryPath,
} from "./proof-registry.mjs";
import {
  clearWaveRetryOverride,
  readWaveRelaunchPlanSnapshot,
  readWaveRetryOverride,
  resolveRetryOverrideRuns,
  waveRelaunchPlanPath,
} from "./retry-control.mjs";
import { appendWaveControlEvent, readControlPlaneEvents } from "./control-plane.mjs";
import { materializeContradictionsFromControlPlaneEvents } from "./contradiction-entity.mjs";
import { buildQualityMetrics, writeTraceBundle } from "./traces.mjs";
import { flushWaveControlQueue } from "./wave-control-client.mjs";
import { reduceWaveState } from "./wave-state-reducer.mjs";
import { triageClarificationRequests } from "./clarification-triage.mjs";
import { readProjectProfile, resolveDefaultTerminalSurface } from "./project-profile.mjs";
import {
  isContEvalImplementationOwningAgent,
  isContEvalReportOnlyAgent,
  isSecurityReviewAgent,
  resolveSecurityReviewReportPath,
} from "./role-helpers.mjs";
import {
  summarizeResolvedSkills,
} from "./skills.mjs";
import {
  buildDependencySnapshot,
  buildRequestAssignments,
  renderDependencySnapshotMarkdown,
  syncAssignmentRecords,
  writeDependencySnapshotMarkdown,
} from "./routing-state.mjs";
import {
  readWaveStateSnapshot,
  writeAssignmentSnapshot,
  writeDependencySnapshot,
  writeRelaunchPlan,
  writeWaveStateSnapshot,
} from "./artifact-schemas.mjs";
import {
  collectUnexpectedSessionFailures as collectUnexpectedSessionFailuresImpl,
  launchAgentSession as launchAgentSessionImpl,
  refreshResolvedSkillsForRun,
  waitForWaveCompletion as waitForWaveCompletionImpl,
} from "./launcher-runtime.mjs";
import {
  readWaveInfraGate as readWaveInfraGateImpl,
  runClosureSweepPhase as runClosureSweepPhaseImpl,
} from "./launcher-closure.mjs";

// --- Re-exports from launcher-gates.mjs ---
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
} from "./launcher-gates.mjs";

export {
  readWaveContQaGate,
  readWaveContEvalGate,
  readWaveEvaluatorGate,
  readWaveImplementationGate,
  readWaveComponentGate,
  readWaveComponentMatrixGate,
  readWaveDocumentationGate,
  readWaveSecurityGate,
  readWaveIntegrationGate,
  readWaveIntegrationBarrier,
  readClarificationBarrier,
  readWaveAssignmentBarrier,
  readWaveDependencyBarrier,
};

// --- Re-exports from launcher-derived-state.mjs ---
import {
  waveAssignmentsPath,
  waveDependencySnapshotPath,
  writeWaveDerivedState,
  applyDerivedStateToDashboard,
  buildWaveSecuritySummary,
  buildWaveIntegrationSummary,
} from "./launcher-derived-state.mjs";

export {
  buildWaveSecuritySummary,
  buildWaveIntegrationSummary,
};

// --- Re-exports from launcher-retry.mjs ---
import {
  buildResumePlan,
  readWaveRelaunchPlan,
  writeWaveRelaunchPlan,
  clearWaveRelaunchPlan,
  resetPersistedWaveLaunchState,
  persistedRelaunchPlanMatchesCurrentState,
  resolveSharedComponentContinuationRuns,
  relaunchReasonBuckets,
  applySharedComponentWaitStateToDashboard,
  reconcileFailuresAgainstSharedComponentState,
  hasReusableSuccessStatus,
  selectReusablePreCompletedAgentIds,
  selectInitialWaveRuns,
  resolveRelaunchRuns,
  applyPersistedRelaunchPlan,
  executorFallbackChain,
  preflightWavesForExecutorAvailability,
} from "./launcher-retry.mjs";

export {
  resetPersistedWaveLaunchState,
  persistedRelaunchPlanMatchesCurrentState,
  resolveSharedComponentContinuationRuns,
  hasReusableSuccessStatus,
  selectReusablePreCompletedAgentIds,
  selectInitialWaveRuns,
  resolveRelaunchRuns,
};

// --- Re-exports from launcher-supervisor.mjs ---
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
  runTmux,
} from "./launcher-supervisor.mjs";

export {
  markLauncherFailed,
  acquireLauncherLock,
  releaseLauncherLock,
  reconcileStaleLauncherArtifacts,
  collectUnexpectedSessionFailures,
};

// --- Original re-exports that stay ---
export { CODEX_SANDBOX_MODES, DEFAULT_CODEX_SANDBOX_MODE, normalizeCodexSandboxMode, buildCodexExecInvocation };

export function formatReconcileBlockedWaveLine(blockedWave) {
  const parts = Array.isArray(blockedWave?.reasons)
    ? blockedWave.reasons
        .map((reason) => {
          const code = compactSingleLine(reason?.code || "", 80);
          const detail = compactSingleLine(reason?.detail || "", 240);
          return code && detail ? `${code}=${detail}` : "";
        })
        .filter(Boolean)
    : [];
  return `[reconcile] wave ${blockedWave?.wave ?? "unknown"} not reconstructable: ${
    parts.join("; ") || "unknown reason"
  }`;
}

export function formatReconcilePreservedWaveLine(preservedWave) {
  const parts = Array.isArray(preservedWave?.reasons)
    ? preservedWave.reasons
        .map((reason) => {
          const code = compactSingleLine(reason?.code || "", 80);
          const detail = compactSingleLine(reason?.detail || "", 240);
          return code && detail ? `${code}=${detail}` : "";
        })
        .filter(Boolean)
    : [];
  const previousState = compactSingleLine(preservedWave?.previousState || "completed", 80);
  return `[reconcile] wave ${preservedWave?.wave ?? "unknown"} preserved as ${previousState}: ${
    parts.join("; ") || "unknown reason"
  }`;
}

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

// --- Wrappers that bind local scope ---

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

export function readWaveInfraGate(agentRuns) {
  return readWaveInfraGateImpl(agentRuns);
}

export function buildGateSnapshot(params) {
  return buildGateSnapshotImpl({
    ...params,
    readWaveInfraGateFn: readWaveInfraGate,
  });
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
        ({
          ...applyContext7SelectionsToWave(wave, {
            lane: lanePaths.lane,
            bundleIndex: context7BundleIndex,
          }),
          contQaAgentId: lanePaths.contQaAgentId,
          contEvalAgentId: lanePaths.contEvalAgentId,
          integrationAgentId: lanePaths.integrationAgentId,
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
        const derivedState = writeWaveDerivedState({
          lanePaths,
          wave,
          summariesByAgentId: {},
          feedbackRequests: [],
          attempt: 0,
          orchestratorId: options.orchestratorId,
        });
        const agentRuns = wave.agents.map((agent) => {
          const safeName = `wave-${wave.wave}-${agent.slug}`;
          return {
            agent,
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
    writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);

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
    writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);

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
      writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);

      const runTag = crypto.randomBytes(3).toString("hex");
      let derivedState = writeWaveDerivedState({
        lanePaths,
        wave,
        summariesByAgentId: {},
        feedbackRequests: [],
        attempt: 0,
        orchestratorId: options.orchestratorId,
      });
      const messageBoardPath = derivedState.messageBoardPath;
      console.log(`Wave message board: ${path.relative(REPO_ROOT, messageBoardPath)}`);

      const dashboardPath = path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`);
      let dashboardState = null;
      let terminalEntries = [];
      let terminalsAppended = false;
      let residentOrchestratorRun = null;
      const residentOrchestratorState = { closed: false };

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
          derivedState = writeWaveDerivedState({
            lanePaths,
            wave,
            agentRuns,
            summariesByAgentId,
            feedbackRequests,
            attempt: attemptNumber,
            orchestratorId: options.orchestratorId,
          });
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

        const proofRegistryForReuse = readWaveProofRegistry(lanePaths, wave.wave);
        const preCompletedAgentIds = selectReusablePreCompletedAgentIds(agentRuns, lanePaths, {
          retryOverride,
          wave,
          derivedState,
          proofRegistry: proofRegistryForReuse,
        });
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
        emitCoordinationAlertEvents(derivedState);

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
          }
        }

        const availableRuns = agentRuns.filter((run) => !preCompletedAgentIds.has(run.agent.agentId));
        if (
          persistedRelaunchPlan &&
          !persistedRelaunchPlanMatchesCurrentState(
            agentRuns,
            persistedRelaunchPlan,
            lanePaths,
            wave,
          )
        ) {
          clearWaveRelaunchPlan(lanePaths, wave.wave);
          persistedRelaunchPlan = null;
        }
        const persistedRuns = applyPersistedRelaunchPlan(
          availableRuns,
          persistedRelaunchPlan,
          lanePaths,
          wave,
        );
        const overrideRuns = resolveRetryOverrideRuns(availableRuns, retryOverride, lanePaths, wave);
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
        let runsToLaunch =
          overrideRuns.unknownAgentIds.length === 0 && overrideRuns.runs.length > 0
            ? overrideRuns.runs
            : persistedRuns.length > 0
              ? persistedRuns
              : selectInitialWaveRuns(availableRuns, lanePaths);
        if (overrideRuns.runs.length > 0) {
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
        const recordAttemptState = (attemptNumber, state, data = {}) =>
          appendWaveControlEvent(lanePaths, wave.wave, {
            entityType: "attempt",
            entityId: `wave-${wave.wave}-attempt-${attemptNumber}`,
            action: state,
            source: "launcher",
            actor: "launcher",
            data: {
              attemptId: `wave-${wave.wave}-attempt-${attemptNumber}`,
              attemptNumber,
              state,
              selectedAgentIds: data.selectedAgentIds || [],
              detail: data.detail || null,
              updatedAt: toIsoTimestamp(),
              ...(data.createdAt ? { createdAt: data.createdAt } : {}),
            },
          });
        appendWaveControlEvent(lanePaths, wave.wave, {
          entityType: "wave_run",
          entityId: `wave-${wave.wave}`,
          action: "started",
          source: "launcher",
          actor: "launcher",
          data: {
            waveId: `wave-${wave.wave}`,
            waveNumber: wave.wave,
            agentIds: wave.agents.map((agent) => agent.agentId),
            runVariant: lanePaths.runVariant || "live",
          },
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
          recordAttemptState(attempt, "running", {
            selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
            detail: `Launching ${runsToLaunch.map((run) => run.agent.agentId).join(", ") || "no"} agents.`,
            createdAt: toIsoTimestamp(),
          });

          const launchedImplementationRuns = runsToLaunch.filter(
            (run) =>
              ![
                lanePaths.contEvalAgentId,
                lanePaths.contQaAgentId,
                lanePaths.integrationAgentId,
                lanePaths.documentationAgentId,
              ].includes(
                run.agent.agentId,
              ),
          );
          const closureOnlyRetry =
            runsToLaunch.length > 0 &&
            launchedImplementationRuns.length === 0 &&
            runsToLaunch.every((run) =>
              [
                lanePaths.contEvalAgentId,
                lanePaths.contQaAgentId,
                lanePaths.integrationAgentId,
                lanePaths.documentationAgentId,
              ].includes(
                run.agent.agentId,
              ),
            );

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
              appendWaveControlEvent(lanePaths, wave.wave, {
                entityType: "agent_run",
                entityId: `wave-${wave.wave}-attempt-${attempt}-agent-${runInfo.agent.agentId}`,
                action: "started",
                source: "launcher",
                actor: runInfo.agent.agentId,
                attempt,
                data: {
                  agentId: runInfo.agent.agentId,
                  attemptNumber: attempt,
                  sessionName: runInfo.sessionName,
                  executorId: runInfo.lastExecutorId,
                  promptPath: path.relative(REPO_ROOT, runInfo.promptPath),
                  statusPath: path.relative(REPO_ROOT, runInfo.statusPath),
                  logPath: path.relative(REPO_ROOT, runInfo.logPath),
                },
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
              },
            );
            failures = waitResult.failures;
            timedOut = waitResult.timedOut;
          }

          materializeAgentExecutionSummaries(wave, agentRuns);
          for (const runInfo of runsToLaunch) {
            const statusRecord = readStatusRecordIfPresent(runInfo.statusPath);
            const action = Number(statusRecord?.code) === 0 ? "completed" : "failed";
            appendWaveControlEvent(lanePaths, wave.wave, {
              entityType: "agent_run",
              entityId: `wave-${wave.wave}-attempt-${attempt}-agent-${runInfo.agent.agentId}`,
              action,
              source: "launcher",
              actor: runInfo.agent.agentId,
              attempt,
              data: {
                agentId: runInfo.agent.agentId,
                attemptNumber: attempt,
                exitCode: statusRecord?.code ?? null,
                completedAt: statusRecord?.completedAt || null,
                promptHash: statusRecord?.promptHash || runInfo.lastPromptHash || null,
                executorId: runInfo.lastExecutorId || null,
                logPath: path.relative(REPO_ROOT, runInfo.logPath),
                statusPath: path.relative(REPO_ROOT, runInfo.statusPath),
              },
            });
          }
          refreshDerivedState(attempt);
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
                const helperAssignmentBarrier = readWaveAssignmentBarrier(derivedState);
                const dependencyBarrier = readWaveDependencyBarrier(derivedState);
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
                      [
                        lanePaths.contEvalAgentId,
                        lanePaths.contQaAgentId,
                        lanePaths.integrationAgentId,
                        lanePaths.documentationAgentId,
                      ].includes(
                        run.agent.agentId,
                      ),
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
            const helperAssignmentBarrier = readWaveAssignmentBarrier(derivedState);
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
            const dependencyBarrier = readWaveDependencyBarrier(derivedState);
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
            const contEvalGate = readWaveContEvalGate(wave, agentRuns, {
              contEvalAgentId: lanePaths.contEvalAgentId,
              mode: "live",
              evalTargets: wave.evalTargets,
              benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
            });
            if (!contEvalGate.ok) {
              failures = [
                {
                  agentId: contEvalGate.agentId,
                  statusCode: contEvalGate.statusCode,
                  logPath: contEvalGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: contEvalGate.agentId,
                message: `cont-EVAL blocked wave ${wave.wave}: ${contEvalGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `agent=${contEvalGate.agentId}; reason=${contEvalGate.statusCode}; ${contEvalGate.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve cont-EVAL tuning gaps before integration closure.`,
              });
            }
          }

          if (failures.length === 0) {
            const integrationGate = readWaveIntegrationGate(wave, agentRuns, {
              integrationAgentId: lanePaths.integrationAgentId,
              requireIntegrationStewardFromWave: lanePaths.requireIntegrationStewardFromWave,
            });
            if (!integrationGate.ok) {
              failures = [
                {
                  agentId: integrationGate.agentId,
                  statusCode: integrationGate.statusCode,
                  logPath: integrationGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: integrationGate.agentId,
                message: `Integration gate blocked wave ${wave.wave}: ${integrationGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `agent=${integrationGate.agentId}; reason=${integrationGate.statusCode}; ${integrationGate.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve integration contradictions or blockers before documentation and cont-QA closure.`,
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
            const componentMatrixGate = readWaveComponentMatrixGate(wave, agentRuns, {
              laneProfile: lanePaths.laneProfile,
              documentationAgentId: lanePaths.documentationAgentId,
            });
            if (!componentMatrixGate.ok) {
              failures = [
                {
                  agentId: componentMatrixGate.agentId,
                  statusCode: componentMatrixGate.statusCode,
                  logPath:
                    componentMatrixGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: componentMatrixGate.agentId,
                message: `Component matrix update blocked wave ${wave.wave}: ${componentMatrixGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `component=${componentMatrixGate.componentId || "unknown"}; reason=${componentMatrixGate.statusCode}; ${componentMatrixGate.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should update the component cutover matrix current levels before wave progression.`,
              });
            }
          }

          if (failures.length === 0) {
            const contQaGate = readWaveContQaGate(wave, agentRuns, { mode: "live" });
            if (!contQaGate.ok) {
              failures = [
                {
                  agentId: contQaGate.agentId,
                  statusCode: contQaGate.statusCode,
                  logPath: contQaGate.logPath || path.relative(REPO_ROOT, messageBoardPath),
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: contQaGate.agentId,
                message: `cont-QA gate blocked wave ${wave.wave}: ${contQaGate.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `agent=${contQaGate.agentId}; reason=${contQaGate.statusCode}; ${contQaGate.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve the cont-QA gate before wave progression.`,
              });
            } else {
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
            const clarificationBarrier = readClarificationBarrier(derivedState);
            if (!clarificationBarrier.ok) {
              failures = [
                {
                  agentId: lanePaths.integrationAgentId,
                  statusCode: clarificationBarrier.statusCode,
                  logPath: path.relative(REPO_ROOT, messageBoardPath),
                  detail: clarificationBarrier.detail,
                },
              ];
              recordCombinedEvent({
                level: "error",
                agentId: lanePaths.integrationAgentId,
                message: `Clarification barrier blocked wave ${wave.wave}: ${clarificationBarrier.detail}`,
              });
              appendCoordination({
                event: "wave_gate_blocked",
                waves: [wave.wave],
                status: "blocked",
                details: `reason=${clarificationBarrier.statusCode}; ${clarificationBarrier.detail}`,
                actionRequested: `Lane ${lanePaths.lane} owners should resolve open clarification chains before wave progression.`,
              });
            }
          }

          const structuredSignals = Object.fromEntries(
            agentRuns.map((run) => [run.agent.agentId, parseStructuredSignalsFromLog(run.logPath)]),
          );
          const summariesByAgentId = Object.fromEntries(
            agentRuns
              .map((run) => [run.agent.agentId, readRunExecutionSummary(run, wave)])
              .filter(([, summary]) => summary),
          );
          const gateSnapshot = buildGateSnapshot({
            wave,
            agentRuns,
            derivedState,
            lanePaths,
            validationMode: "live",
          });
          completionGateSnapshot = gateSnapshot;
          try {
            computeReducerSnapshot({
              lanePaths,
              wave,
              agentRuns,
              derivedState,
              attempt,
              options,
            });
          } catch (error) {
            recordCombinedEvent({
              level: "warn",
              agentId: lanePaths.integrationAgentId,
              message: `Reducer shadow snapshot failed for wave ${wave.wave}: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
          const traceDir = writeTraceBundle({
            tracesDir: lanePaths.tracesDir,
            lanePaths,
            launcherOptions: options,
            wave,
            attempt: traceAttempt,
            manifest: buildManifest(lanePaths, [wave]),
            coordinationLogPath: derivedState.coordinationLogPath,
            coordinationState: derivedState.coordinationState,
            ledger: derivedState.ledger,
            docsQueue: derivedState.docsQueue,
            capabilityAssignments: derivedState.capabilityAssignments,
            dependencySnapshot: derivedState.dependencySnapshot,
            securitySummary: derivedState.securitySummary,
            integrationSummary: derivedState.integrationSummary,
            integrationMarkdownPath: derivedState.integrationMarkdownPath,
            proofRegistryPath: waveProofRegistryPath(lanePaths, wave.wave),
            controlPlanePath: path.join(lanePaths.controlPlaneDir, `wave-${wave.wave}.jsonl`),
            clarificationTriage: derivedState.clarificationTriage,
            agentRuns,
            structuredSignals,
            gateSnapshot,
            quality: buildQualityMetrics({
              tracesDir: lanePaths.tracesDir,
              wave,
              coordinationState: derivedState.coordinationState,
              integrationSummary: derivedState.integrationSummary,
              ledger: derivedState.ledger,
              docsQueue: derivedState.docsQueue,
              capabilityAssignments: derivedState.capabilityAssignments,
              dependencySnapshot: derivedState.dependencySnapshot,
              summariesByAgentId,
              agentRuns,
              gateSnapshot,
              attempt: traceAttempt,
              coordinationLogPath: derivedState.coordinationLogPath,
            }),
          });
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
            recordAttemptState(attempt, "completed", {
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
            writeWaveRelaunchPlan(lanePaths, wave.wave, {
              wave: wave.wave,
              attempt,
              phase: derivedState?.ledger?.phase || null,
              selectedAgentIds: nextAgentIds,
              reasonBuckets: relaunchReasonBuckets(runsToLaunch, failures, derivedState),
              executorStates: Object.fromEntries(
                runsToLaunch.map((run) => [run.agent.agentId, run.agent.executorResolved || null]),
              ),
              fallbackHistory: Object.fromEntries(
                runsToLaunch.map((run) => [
                  run.agent.agentId,
                  run.agent.executorResolved?.executorHistory || [],
                ]),
              ),
              createdAt: toIsoTimestamp(),
            });
            flushDashboards();
            traceAttempt += 1;
            continue;
          }

          if (failures.length === 0) {
            recordAttemptState(attempt, "completed", {
              selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
              detail: "Wave gates passed for this attempt.",
            });
            appendWaveControlEvent(lanePaths, wave.wave, {
              entityType: "wave_run",
              entityId: `wave-${wave.wave}`,
              action: "completed",
              source: "launcher",
              actor: "launcher",
              data: {
                waveId: `wave-${wave.wave}`,
                waveNumber: wave.wave,
                attempts: attempt,
                traceDir: completionTraceDir ? path.relative(REPO_ROOT, completionTraceDir) : null,
                gateSnapshot: completionGateSnapshot,
              },
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
            recordAttemptState(attempt, "failed", {
              selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
              detail: failures
                .map((failure) => `${failure.agentId || "wave"}:${failure.statusCode}`)
                .join(", "),
            });
            appendWaveControlEvent(lanePaths, wave.wave, {
              entityType: "wave_run",
              entityId: `wave-${wave.wave}`,
              action: "failed",
              source: "launcher",
              actor: "launcher",
              data: {
                waveId: `wave-${wave.wave}`,
                waveNumber: wave.wave,
                attempts: attempt,
                traceDir: completionTraceDir ? path.relative(REPO_ROOT, completionTraceDir) : null,
                gateSnapshot: completionGateSnapshot,
                failures: failures.map((failure) => ({
                  agentId: failure.agentId || null,
                  statusCode: failure.statusCode,
                  detail: failure.detail || null,
                })),
              },
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
          recordAttemptState(attempt, "failed", {
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
          const relaunchResolution = resolveRelaunchRuns(
            agentRuns,
            failures,
            derivedState,
            lanePaths,
            wave,
          );
          retryOverride = readWaveRetryOverride(lanePaths, wave.wave);
          const overrideResolution = resolveRetryOverrideRuns(
            agentRuns,
            retryOverride,
            lanePaths,
            wave,
          );
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
          } else if (overrideResolution.runs.length > 0) {
            runsToLaunch = overrideResolution.runs;
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
            runsToLaunch = relaunchResolution.runs;
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
          writeWaveRelaunchPlan(lanePaths, wave.wave, {
            wave: wave.wave,
            attempt: attempt + 1,
            phase: derivedState?.ledger?.phase || null,
            selectedAgentIds: runsToLaunch.map((run) => run.agent.agentId),
            reasonBuckets: relaunchReasonBuckets(runsToLaunch, failures, derivedState),
            executorStates: Object.fromEntries(
              runsToLaunch.map((run) => [run.agent.agentId, run.agent.executorResolved || null]),
            ),
            fallbackHistory: Object.fromEntries(
              runsToLaunch.map((run) => [
                run.agent.agentId,
                run.agent.executorResolved?.executorHistory || [],
              ]),
            ),
            createdAt: toIsoTimestamp(),
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

/**
 * Compute and persist a reducer snapshot alongside the traditional gate evaluation.
 * Shadow mode: the reducer runs and its output is written to disk, but decisions
 * still come from the traditional gate readers. This enables comparison and validation.
 *
 * @param {object} params
 * @param {object} params.lanePaths
 * @param {object} params.wave - Wave definition
 * @param {object} params.agentRuns - Array of run info objects
 * @param {object} params.derivedState - Current derived state
 * @param {number} params.attempt - Current attempt number
 * @param {object} params.options - Launcher options
 * @returns {object} { reducerState, resumePlan, snapshotPath }
 */
export function computeReducerSnapshot({
  lanePaths,
  wave,
  agentRuns,
  derivedState,
  attempt,
  options = {},
}) {
  // Build agentResults from agentRuns
  const agentResults = {};
  for (const run of agentRuns) {
    const summary = readRunExecutionSummary(run, wave);
    if (summary) {
      agentResults[run.agent.agentId] = summary;
    }
  }

  // Load canonical event sources
  const controlPlaneLogPath = path.join(
    lanePaths.controlPlaneDir,
    `wave-${wave.wave}.jsonl`,
  );
  const controlPlaneEvents = fs.existsSync(controlPlaneLogPath)
    ? readControlPlaneEvents(controlPlaneLogPath)
    : [];

  const coordinationLogPath = path.join(
    lanePaths.coordinationDir,
    `wave-${wave.wave}.jsonl`,
  );
  const coordinationRecords = fs.existsSync(coordinationLogPath)
    ? readMaterializedCoordinationState(coordinationLogPath)
    : null;

  const feedbackRequests = readWaveHumanFeedbackRequests({
    feedbackRequestsDir: lanePaths.feedbackRequestsDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agentIds: (agentRuns || []).map((run) => run.agent.agentId),
    orchestratorId: options.orchestratorId,
  });

  // Build dependency tickets from derivedState
  const dependencyTickets = derivedState?.dependencySnapshot || null;

  // Run the reducer
  const reducerState = reduceWaveState({
    controlPlaneEvents,
    coordinationRecords: coordinationRecords?.latestRecords || [],
    agentResults,
    waveDefinition: wave,
    dependencyTickets,
    feedbackRequests: feedbackRequests || [],
    laneConfig: {
      lane: lanePaths.lane,
      contQaAgentId: lanePaths.contQaAgentId || "A0",
      contEvalAgentId: lanePaths.contEvalAgentId || "E0",
      integrationAgentId: lanePaths.integrationAgentId || "A8",
      documentationAgentId: lanePaths.documentationAgentId || "A9",
      validationMode: "live",
      evalTargets: wave.evalTargets,
      benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
      laneProfile: lanePaths.laneProfile,
      requireIntegrationStewardFromWave: lanePaths.requireIntegrationStewardFromWave,
      capabilityRouting: lanePaths.capabilityRouting,
    },
  });

  // Build resume plan
  const resumePlan = buildResumePlan(reducerState, {
    waveDefinition: wave,
    lanePaths,
  });

  // Persist snapshot
  const stateDir = path.join(lanePaths.stateDir, "reducer");
  ensureDirectory(stateDir);
  const snapshotPath = path.join(stateDir, `wave-${wave.wave}.json`);
  writeWaveStateSnapshot(snapshotPath, {
    ...reducerState,
    attempt,
    resumePlan,
  }, {
    lane: lanePaths.lane,
    wave: wave.wave,
  });

  return {
    reducerState,
    resumePlan,
    snapshotPath,
  };
}

/**
 * Read a previously persisted reducer snapshot from disk.
 *
 * @param {object} lanePaths
 * @param {number} waveNumber
 * @returns {object|null} The persisted snapshot, or null if not found
 */
export function readPersistedReducerSnapshot(lanePaths, waveNumber) {
  const stateDir = path.join(lanePaths.stateDir, "reducer");
  const snapshotPath = path.join(stateDir, `wave-${waveNumber}.json`);
  return readWaveStateSnapshot(snapshotPath, {
    lane: lanePaths.lane,
    wave: waveNumber,
  });
}
