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
  appendCoordinationRecord,
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
import { buildQualityMetrics, writeTraceBundle } from "./traces.mjs";
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
  readRelaunchPlan,
  writeAssignmentSnapshot,
  writeDependencySnapshot,
  writeRelaunchPlan,
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

function printUsage(lanePaths, terminalSurface) {
  console.log(`Usage: pnpm exec wave launch [options]

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
  options.orchestratorId ||= sanitizeOrchestratorId(`${lanePaths.lane}-orch-${process.pid}`);
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

export function readWaveContQaGate(wave, agentRuns, options = {}) {
  const mode = String(options.mode || "compat").trim().toLowerCase();
  const strict = mode === "live";
  const contQaAgentId = options.contQaAgentId || wave.contQaAgentId || "A0";
  const contQaRun =
    agentRuns.find((run) => run.agent.agentId === contQaAgentId) ?? null;
  if (!contQaRun) {
    return {
      ok: false,
      agentId: contQaAgentId,
      statusCode: "missing-cont-qa",
      detail: `Agent ${contQaAgentId} is missing.`,
      logPath: null,
    };
  }
  const summary = readRunExecutionSummary(contQaRun, strict ? wave : null);
  if (summary) {
    const validation = validateContQaSummary(contQaRun.agent, summary, { mode });
    return {
      ok: validation.ok,
      agentId: contQaRun.agent.agentId,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: summary.logPath || path.relative(REPO_ROOT, contQaRun.logPath),
    };
  }
  if (strict) {
    return {
      ok: false,
      agentId: contQaRun.agent.agentId,
      statusCode: "missing-wave-gate",
      detail: `Missing structured cont-QA summary for ${contQaRun.agent.agentId}.`,
      logPath: path.relative(REPO_ROOT, contQaRun.logPath),
    };
  }
  const contQaReportPath = wave.contQaReportPath
    ? path.resolve(REPO_ROOT, wave.contQaReportPath)
    : null;
  const reportText =
    contQaReportPath && fs.existsSync(contQaReportPath)
      ? fs.readFileSync(contQaReportPath, "utf8")
      : "";
  const reportVerdict = parseVerdictFromText(reportText, REPORT_VERDICT_REGEX);
  if (reportVerdict.verdict) {
    return {
      ok: reportVerdict.verdict === "pass",
      agentId: contQaRun.agent.agentId,
      statusCode: reportVerdict.verdict === "pass" ? "pass" : `cont-qa-${reportVerdict.verdict}`,
      detail: reportVerdict.detail || "Verdict read from cont-QA report.",
      logPath: path.relative(REPO_ROOT, contQaRun.logPath),
    };
  }
  const logVerdict = parseVerdictFromText(
    readFileTail(contQaRun.logPath, 30000),
    WAVE_VERDICT_REGEX,
  );
  if (logVerdict.verdict) {
    return {
      ok: logVerdict.verdict === "pass",
      agentId: contQaRun.agent.agentId,
      statusCode: logVerdict.verdict === "pass" ? "pass" : `cont-qa-${logVerdict.verdict}`,
      detail: logVerdict.detail || "Verdict read from cont-QA log marker.",
      logPath: path.relative(REPO_ROOT, contQaRun.logPath),
    };
  }
  return {
    ok: false,
    agentId: contQaRun.agent.agentId,
    statusCode: "missing-cont-qa-verdict",
    detail: contQaReportPath
      ? `Missing Verdict line in ${path.relative(REPO_ROOT, contQaReportPath)} and no [wave-verdict] marker in ${path.relative(REPO_ROOT, contQaRun.logPath)}.`
      : `Missing cont-QA report path and no [wave-verdict] marker in ${path.relative(REPO_ROOT, contQaRun.logPath)}.`,
    logPath: path.relative(REPO_ROOT, contQaRun.logPath),
  };
}

export function readWaveContEvalGate(wave, agentRuns, options = {}) {
  const mode = String(options.mode || "compat").trim().toLowerCase();
  const strict = mode === "live";
  const contEvalAgentId = options.contEvalAgentId || wave.contEvalAgentId || "E0";
  const contEvalRun =
    agentRuns.find((run) => run.agent.agentId === contEvalAgentId) ?? null;
  if (!contEvalRun) {
    return {
      ok: true,
      agentId: null,
      statusCode: "pass",
      detail: "Wave does not include cont-EVAL.",
      logPath: null,
    };
  }
  const summary = readRunExecutionSummary(contEvalRun, strict ? wave : null);
  if (summary) {
    const validation = validateContEvalSummary(contEvalRun.agent, summary, {
      mode,
      evalTargets: options.evalTargets || wave.evalTargets,
      benchmarkCatalogPath: options.benchmarkCatalogPath,
    });
    return {
      ok: validation.ok,
      agentId: contEvalRun.agent.agentId,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: summary.logPath || path.relative(REPO_ROOT, contEvalRun.logPath),
    };
  }
  return {
    ok: false,
    agentId: contEvalRun.agent.agentId,
    statusCode: "missing-wave-eval",
    detail: `Missing [wave-eval] marker for ${contEvalRun.agent.agentId}.`,
    logPath: path.relative(REPO_ROOT, contEvalRun.logPath),
  };
}

function materializeAgentExecutionSummaryForRun(wave, runInfo) {
  const statusRecord = readStatusRecordIfPresent(runInfo.statusPath);
  if (!statusRecord) {
    return null;
  }
  const reportPath = (() => {
    if (runInfo.agent.agentId === (wave.contQaAgentId || "A0") && wave.contQaReportPath) {
      return path.resolve(REPO_ROOT, wave.contQaReportPath);
    }
    if (runInfo.agent.agentId === (wave.contEvalAgentId || "E0") && wave.contEvalReportPath) {
      return path.resolve(REPO_ROOT, wave.contEvalReportPath);
    }
    if (isSecurityReviewAgent(runInfo.agent)) {
      const securityReportPath = resolveSecurityReviewReportPath(runInfo.agent);
      return securityReportPath ? path.resolve(REPO_ROOT, securityReportPath) : null;
    }
    return null;
  })();
  const summary = buildAgentExecutionSummary({
    agent: runInfo.agent,
    statusRecord,
    logPath: runInfo.logPath,
    reportPath,
  });
  writeAgentExecutionSummary(runInfo.statusPath, summary);
  return summary;
}

function readRunExecutionSummary(runInfo, wave = null) {
  if (runInfo?.summary && typeof runInfo.summary === "object") {
    return runInfo.summary;
  }
  if (runInfo?.summaryPath && fs.existsSync(runInfo.summaryPath)) {
    return readAgentExecutionSummary(runInfo.summaryPath);
  }
  if (runInfo?.statusPath && fs.existsSync(agentSummaryPathFromStatusPath(runInfo.statusPath))) {
    return readAgentExecutionSummary(runInfo.statusPath);
  }
  if (wave && runInfo?.statusPath && runInfo?.logPath && fs.existsSync(runInfo.statusPath)) {
    return materializeAgentExecutionSummaryForRun(wave, runInfo);
  }
  return null;
}

export function readWaveEvaluatorGate(wave, agentRuns, options = {}) {
  return readWaveContQaGate(wave, agentRuns, {
    ...options,
    contQaAgentId: options.evaluatorAgentId || options.contQaAgentId,
  });
}

function materializeAgentExecutionSummaries(wave, agentRuns) {
  return Object.fromEntries(
    agentRuns.map((runInfo) => [runInfo.agent.agentId, materializeAgentExecutionSummaryForRun(wave, runInfo)]),
  );
}

function waveCoordinationLogPath(lanePaths, waveNumber) {
  return path.join(lanePaths.coordinationDir, `wave-${waveNumber}.jsonl`);
}

function waveInboxDir(lanePaths, waveNumber) {
  return path.join(lanePaths.inboxesDir, `wave-${waveNumber}`);
}

function waveAssignmentsPath(lanePaths, waveNumber) {
  return path.join(lanePaths.assignmentsDir, `wave-${waveNumber}.json`);
}

function waveLedgerPath(lanePaths, waveNumber) {
  return path.join(lanePaths.ledgerDir, `wave-${waveNumber}.json`);
}

function waveDependencySnapshotPath(lanePaths, waveNumber) {
  return path.join(lanePaths.dependencySnapshotsDir, `wave-${waveNumber}.json`);
}

function waveDependencySnapshotMarkdownPath(lanePaths, waveNumber) {
  return path.join(lanePaths.dependencySnapshotsDir, `wave-${waveNumber}.md`);
}

function waveDocsQueuePath(lanePaths, waveNumber) {
  return path.join(lanePaths.docsQueueDir, `wave-${waveNumber}.json`);
}

function waveIntegrationPath(lanePaths, waveNumber) {
  return path.join(lanePaths.integrationDir, `wave-${waveNumber}.json`);
}

function waveIntegrationMarkdownPath(lanePaths, waveNumber) {
  return path.join(lanePaths.integrationDir, `wave-${waveNumber}.md`);
}

function waveRelaunchPlanPath(lanePaths, waveNumber) {
  return path.join(lanePaths.statusDir, `relaunch-plan-wave-${waveNumber}.json`);
}

function readWaveRelaunchPlan(lanePaths, waveNumber) {
  return readRelaunchPlan(waveRelaunchPlanPath(lanePaths, waveNumber), { wave: waveNumber });
}

function writeWaveRelaunchPlan(lanePaths, waveNumber, payload) {
  const filePath = waveRelaunchPlanPath(lanePaths, waveNumber);
  writeRelaunchPlan(filePath, payload, { wave: waveNumber });
  return filePath;
}

function clearWaveRelaunchPlan(lanePaths, waveNumber) {
  const filePath = waveRelaunchPlanPath(lanePaths, waveNumber);
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // no-op
  }
}

function waveSecurityPath(lanePaths, waveNumber) {
  return path.join(lanePaths.securityDir, `wave-${waveNumber}.json`);
}

function waveSecurityMarkdownPath(lanePaths, waveNumber) {
  return path.join(lanePaths.securityDir, `wave-${waveNumber}.md`);
}

function uniqueStringEntries(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function summarizeIntegrationRecord(record, options = {}) {
  const summary = compactSingleLine(
    record?.summary || record?.detail || record?.kind || "coordination item",
    options.maxChars || 180,
  );
  return `${record.id}: ${summary}`;
}

function summarizeDocsQueueItem(item) {
  return `${item.id}: ${compactSingleLine(item.summary || item.path || item.detail || "documentation update required", 180)}`;
}

function summarizeGap(agentId, detail, fallback) {
  return `${agentId}: ${compactSingleLine(detail || fallback, 180)}`;
}

function textMentionsAnyKeyword(value, keywords) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return false;
  }
  return keywords.some((keyword) => text.includes(String(keyword || "").trim().toLowerCase()));
}

function actionableIntegrationRecords(coordinationState) {
  return (coordinationState?.latestRecords || []).filter(
    (record) =>
      !["cancelled", "superseded"].includes(String(record?.status || "").trim().toLowerCase()) &&
      ![
        "human-feedback",
        "human-escalation",
        "orchestrator-guidance",
        "resolved-by-policy",
        "integration-summary",
      ].includes(record?.kind),
  );
}

function normalizeOwnedReference(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function matchesOwnedPathArtifact(artifactRef, ownedPath) {
  const normalizedArtifact = normalizeOwnedReference(artifactRef);
  const normalizedOwnedPath = normalizeOwnedReference(ownedPath);
  if (!normalizedArtifact || !normalizedOwnedPath) {
    return false;
  }
  return (
    normalizedArtifact === normalizedOwnedPath ||
    normalizedArtifact.startsWith(`${normalizedOwnedPath}/`)
  );
}

function resolveArtifactOwners(artifactRef, agents) {
  const owners = [];
  const normalizedArtifact = normalizeOwnedReference(artifactRef);
  if (!normalizedArtifact) {
    return owners;
  }
  for (const agent of agents || []) {
    const ownedComponents = Array.isArray(agent?.components) ? agent.components : [];
    const ownedPaths = Array.isArray(agent?.ownedPaths) ? agent.ownedPaths : [];
    if (
      ownedComponents.some((componentId) => normalizeOwnedReference(componentId) === normalizedArtifact) ||
      ownedPaths.some((ownedPath) => matchesOwnedPathArtifact(normalizedArtifact, ownedPath))
    ) {
      owners.push(agent.agentId);
    }
  }
  return owners;
}

function inferIntegrationRecommendation(evidence) {
  if ((evidence.unresolvedBlockers || []).length > 0) {
    return {
      recommendation: "needs-more-work",
      detail: `${evidence.unresolvedBlockers.length} unresolved blocker(s) remain.`,
    };
  }
  if ((evidence.conflictingClaims || []).length > 0) {
    return {
      recommendation: "needs-more-work",
      detail: `${evidence.conflictingClaims.length} conflicting claim(s) remain.`,
    };
  }
  if ((evidence.proofGaps || []).length > 0) {
    return {
      recommendation: "needs-more-work",
      detail: `${evidence.proofGaps.length} proof gap(s) remain.`,
    };
  }
  if ((evidence.deployRisks || []).length > 0) {
    return {
      recommendation: "needs-more-work",
      detail: `${evidence.deployRisks.length} deploy or ops risk(s) remain.`,
    };
  }
  return {
    recommendation: "ready-for-doc-closure",
    detail:
      "No unresolved blockers, contradictions, proof gaps, or deploy risks remain in integration state.",
  };
}

export function buildWaveSecuritySummary({
  lanePaths,
  wave,
  attempt,
  summariesByAgentId = {},
}) {
  const createdAt = toIsoTimestamp();
  const securityAgents = (wave.agents || []).filter((agent) => isSecurityReviewAgent(agent));
  if (securityAgents.length === 0) {
    return {
      wave: wave.wave,
      lane: lanePaths.lane,
      attempt,
      overallState: "not-applicable",
      totalFindings: 0,
      totalApprovals: 0,
      concernAgentIds: [],
      blockedAgentIds: [],
      detail: "No security reviewer declared for this wave.",
      agents: [],
      createdAt,
      updatedAt: createdAt,
    };
  }
  const agents = securityAgents.map((agent) => {
    const summary = summariesByAgentId?.[agent.agentId] || null;
    const validation = validateSecuritySummary(agent, summary);
    const explicitState = summary?.security?.state || null;
    return {
      agentId: agent.agentId,
      title: agent.title || agent.agentId,
      state: validation.ok
        ? explicitState || "clear"
        : explicitState === "blocked"
          ? "blocked"
          : "pending",
      findings: summary?.security?.findings || 0,
      approvals: summary?.security?.approvals || 0,
      detail: validation.ok
        ? summary?.security?.detail || validation.detail || ""
        : validation.detail,
      reportPath: summary?.reportPath || resolveSecurityReviewReportPath(agent) || null,
      statusCode: validation.statusCode,
      ok: validation.ok,
    };
  });
  const blockedAgentIds = agents
    .filter((entry) => entry.state === "blocked")
    .map((entry) => entry.agentId);
  const concernAgentIds = agents
    .filter((entry) => entry.state === "concerns")
    .map((entry) => entry.agentId);
  const pendingAgentIds = agents
    .filter((entry) => entry.state === "pending")
    .map((entry) => entry.agentId);
  const overallState =
    blockedAgentIds.length > 0
      ? "blocked"
      : pendingAgentIds.length > 0
        ? "pending"
        : concernAgentIds.length > 0
          ? "concerns"
          : "clear";
  const totalFindings = agents.reduce((sum, entry) => sum + (entry.findings || 0), 0);
  const totalApprovals = agents.reduce((sum, entry) => sum + (entry.approvals || 0), 0);
  const detail =
    overallState === "blocked"
      ? `Security review blocked by ${blockedAgentIds.join(", ")}.`
      : overallState === "pending"
        ? `Security review output is incomplete for ${pendingAgentIds.join(", ")}.`
        : overallState === "concerns"
          ? `Security review reported advisory concerns from ${concernAgentIds.join(", ")}.`
          : "Security review is clear.";
  return {
    wave: wave.wave,
    lane: lanePaths.lane,
    attempt,
    overallState,
    totalFindings,
    totalApprovals,
    concernAgentIds,
    blockedAgentIds,
    detail,
    agents,
    createdAt,
    updatedAt: createdAt,
  };
}

function renderWaveSecuritySummaryMarkdown(securitySummary) {
  return [
    `# Wave ${securitySummary.wave} Security Summary`,
    "",
    `- State: ${securitySummary.overallState || "unknown"}`,
    `- Detail: ${securitySummary.detail || "n/a"}`,
    `- Total findings: ${securitySummary.totalFindings || 0}`,
    `- Total approvals: ${securitySummary.totalApprovals || 0}`,
    `- Reviewers: ${(securitySummary.agents || []).length}`,
    "",
    "## Reviews",
    ...((securitySummary.agents || []).length > 0
      ? securitySummary.agents.map(
          (entry) =>
            `- ${entry.agentId}: state=${entry.state || "unknown"} findings=${entry.findings || 0} approvals=${entry.approvals || 0}${entry.reportPath ? ` report=${entry.reportPath}` : ""}${entry.detail ? ` detail=${entry.detail}` : ""}`,
        )
      : ["- None."]),
    "",
  ].join("\n");
}

function padReportedEntries(entries, minimumCount, label) {
  const padded = [...entries];
  for (let index = padded.length + 1; index <= minimumCount; index += 1) {
    padded.push(`${label} #${index}`);
  }
  return padded;
}

function buildIntegrationEvidence({
  lanePaths,
  wave,
  coordinationState,
  summariesByAgentId,
  docsQueue,
  agentRuns,
  dependencySnapshot = null,
  capabilityAssignments = [],
  securitySummary = null,
}) {
  const openClaims = (coordinationState?.claims || [])
    .filter((record) => isOpenCoordinationStatus(record.status))
    .map((record) => summarizeIntegrationRecord(record));
  const conflictingClaims = (coordinationState?.claims || [])
    .filter(
      (record) =>
        isOpenCoordinationStatus(record.status) &&
        /conflict|contradict/i.test(`${record.summary || ""}\n${record.detail || ""}`),
    )
    .map((record) => summarizeIntegrationRecord(record));
  const unresolvedBlockers = (coordinationState?.blockers || [])
    .filter((record) => isOpenCoordinationStatus(record.status))
    .map((record) => summarizeIntegrationRecord(record));

  const interfaceKeywords = ["interface", "contract", "api", "schema", "migration", "signature"];
  const changedInterfaces = actionableIntegrationRecords(coordinationState)
    .filter((record) =>
      textMentionsAnyKeyword(
        [record.summary, record.detail, ...(record.artifactRefs || [])].join("\n"),
        interfaceKeywords,
      ),
    )
    .map((record) => summarizeIntegrationRecord(record));

  const crossComponentImpacts = actionableIntegrationRecords(coordinationState)
    .flatMap((record) => {
      const owners = new Set();
      for (const artifactRef of record.artifactRefs || []) {
        for (const owner of resolveArtifactOwners(artifactRef, wave.agents)) {
          owners.add(owner);
        }
      }
      for (const target of record.targets || []) {
        if (String(target).startsWith("agent:")) {
          owners.add(String(target).slice("agent:".length));
        } else if ((wave.agents || []).some((agent) => agent.agentId === target)) {
          owners.add(String(target));
        }
      }
      if (owners.size <= 1) {
        return [];
      }
      return [
        `${summarizeIntegrationRecord(record)} [owners: ${Array.from(owners).toSorted().join(", ")}]`,
      ];
    });

  const proofGapEntries = [];
  const docGapEntries = Array.isArray(docsQueue?.items)
    ? docsQueue.items.map((item) => summarizeDocsQueueItem(item))
    : [];
  const deployRiskEntries = [];
  const securityFindingEntries = [];
  const securityApprovalEntries = [];
  for (const agent of wave.agents || []) {
    const summary = summariesByAgentId?.[agent.agentId] || null;
    const contEvalImplementationOwning =
      agent.agentId === lanePaths.contEvalAgentId &&
      isContEvalImplementationOwningAgent(agent, {
        contEvalAgentId: lanePaths.contEvalAgentId,
      });
    if (isSecurityReviewAgent(agent)) {
      continue;
    }
    if (agent.agentId === lanePaths.contEvalAgentId) {
      const validation = validateContEvalSummary(agent, summary, {
        mode: "live",
        evalTargets: wave.evalTargets,
        benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
      });
      if (!validation.ok) {
        proofGapEntries.push(
          summarizeGap(agent.agentId, validation.detail, "cont-EVAL target is not yet satisfied."),
        );
      }
    }
    if (
      ![
        lanePaths.contQaAgentId,
        lanePaths.integrationAgentId,
        lanePaths.documentationAgentId,
      ].includes(agent.agentId) &&
      (agent.agentId !== lanePaths.contEvalAgentId || contEvalImplementationOwning)
    ) {
      const validation = validateImplementationSummary(agent, summary);
      if (!validation.ok) {
        const entry = summarizeGap(agent.agentId, validation.detail, "Implementation validation failed.");
        if (["missing-doc-delta", "doc-impact-gap"].includes(validation.statusCode)) {
          docGapEntries.push(entry);
        } else {
          proofGapEntries.push(entry);
        }
      }
    }
    for (const gap of summary?.gaps || []) {
      const entry = summarizeGap(
        agent.agentId,
        gap.detail,
        `${gap.kind || "unknown"} gap reported.`,
      );
      if (gap.kind === "docs") {
        docGapEntries.push(entry);
      } else if (gap.kind === "ops") {
        deployRiskEntries.push(entry);
      } else {
        proofGapEntries.push(entry);
      }
    }
  }

  for (const run of agentRuns || []) {
    const signals = parseStructuredSignalsFromLog(run.logPath);
    if (signals?.deployment && signals.deployment.state !== "healthy") {
      deployRiskEntries.push(
        summarizeGap(
          run.agent.agentId,
          `Deployment ${signals.deployment.service} ended in state ${signals.deployment.state}${signals.deployment.detail ? ` (${signals.deployment.detail})` : ""}.`,
          "Deployment did not finish healthy.",
        ),
      );
    }
    if (
      signals?.infra &&
      !["conformant", "action-complete"].includes(
        String(signals.infra.state || "").trim().toLowerCase(),
      )
    ) {
      deployRiskEntries.push(
        summarizeGap(
          run.agent.agentId,
          `Infra ${signals.infra.kind || "unknown"} on ${signals.infra.target || "unknown"} ended in state ${signals.infra.state || "unknown"}${signals.infra.detail ? ` (${signals.infra.detail})` : ""}.`,
          "Infra risk remains open.",
        ),
      );
    }
  }

  const inboundDependencies = (dependencySnapshot?.openInbound || []).map(
    (record) =>
      `${record.id}: ${compactSingleLine(record.summary || record.detail || "inbound dependency", 180)}${record.assignedAgentId ? ` -> ${record.assignedAgentId}` : ""}`,
  );
  const outboundDependencies = (dependencySnapshot?.openOutbound || []).map(
    (record) =>
      `${record.id}: ${compactSingleLine(record.summary || record.detail || "outbound dependency", 180)}`,
  );
  const helperAssignments = (capabilityAssignments || [])
    .filter((assignment) => assignment.blocking)
    .map(
      (assignment) =>
        `${assignment.requestId}: ${assignment.target}${assignment.assignedAgentId ? ` -> ${assignment.assignedAgentId}` : " -> unresolved"} (${assignment.assignmentReason || "n/a"})`,
    );

  for (const review of securitySummary?.agents || []) {
    if (review.state === "blocked" || review.state === "concerns") {
      securityFindingEntries.push(
        summarizeGap(
          review.agentId,
          review.detail,
          review.state === "blocked"
            ? "Security review blocked the wave."
            : "Security review reported advisory concerns.",
        ),
      );
    }
    if ((review.approvals || 0) > 0) {
      securityApprovalEntries.push(
        summarizeGap(
          review.agentId,
          review.detail,
          `${review.approvals} security approval(s) remain open.`,
        ),
      );
    }
  }

  return {
    openClaims: uniqueStringEntries(openClaims),
    conflictingClaims: uniqueStringEntries(conflictingClaims),
    unresolvedBlockers: uniqueStringEntries(unresolvedBlockers),
    changedInterfaces: uniqueStringEntries(changedInterfaces),
    crossComponentImpacts: uniqueStringEntries(crossComponentImpacts),
    proofGaps: uniqueStringEntries(proofGapEntries),
    docGaps: uniqueStringEntries(docGapEntries),
    deployRisks: uniqueStringEntries(deployRiskEntries),
    inboundDependencies: uniqueStringEntries(inboundDependencies),
    outboundDependencies: uniqueStringEntries(outboundDependencies),
    helperAssignments: uniqueStringEntries(helperAssignments),
    securityState: securitySummary?.overallState || "not-applicable",
    securityFindings: uniqueStringEntries(securityFindingEntries),
    securityApprovals: uniqueStringEntries(securityApprovalEntries),
  };
}

export function buildWaveIntegrationSummary({
  lanePaths,
  wave,
  attempt,
  coordinationState,
  summariesByAgentId,
  docsQueue,
  runtimeAssignments,
  agentRuns,
  capabilityAssignments = [],
  dependencySnapshot = null,
  securitySummary = null,
}) {
  const explicitIntegration = summariesByAgentId[lanePaths.integrationAgentId]?.integration || null;
  const evidence = buildIntegrationEvidence({
    lanePaths,
    wave,
    coordinationState,
    summariesByAgentId,
    docsQueue,
    agentRuns,
    capabilityAssignments,
    dependencySnapshot,
    securitySummary,
  });
  if (explicitIntegration) {
    return {
      wave: wave.wave,
      lane: lanePaths.lane,
      agentId: lanePaths.integrationAgentId,
      attempt,
      openClaims: padReportedEntries(
        evidence.openClaims,
        explicitIntegration.claims || 0,
        "Integration steward reported unresolved claim",
      ),
      conflictingClaims: padReportedEntries(
        evidence.conflictingClaims,
        explicitIntegration.conflicts || 0,
        "Integration steward reported unresolved conflict",
      ),
      unresolvedBlockers: padReportedEntries(
        evidence.unresolvedBlockers,
        explicitIntegration.blockers || 0,
        "Integration steward reported unresolved blocker",
      ),
      changedInterfaces: evidence.changedInterfaces,
      crossComponentImpacts: evidence.crossComponentImpacts,
      proofGaps: evidence.proofGaps,
      docGaps: evidence.docGaps,
      deployRisks: evidence.deployRisks,
      securityState: evidence.securityState,
      securityFindings: evidence.securityFindings,
      securityApprovals: evidence.securityApprovals,
      inboundDependencies: evidence.inboundDependencies,
      outboundDependencies: evidence.outboundDependencies,
      helperAssignments: evidence.helperAssignments,
      runtimeAssignments,
      recommendation: explicitIntegration.state,
      detail: explicitIntegration.detail || "",
      createdAt: toIsoTimestamp(),
      updatedAt: toIsoTimestamp(),
    };
  }
  const inferred = inferIntegrationRecommendation(evidence);
  return {
    wave: wave.wave,
    lane: lanePaths.lane,
    agentId: "launcher",
    attempt,
    ...evidence,
    runtimeAssignments,
    recommendation: inferred.recommendation,
    detail: inferred.detail,
    createdAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
  };
}

function renderIntegrationSection(title, items) {
  return [
    title,
    ...((items || []).length > 0 ? items.map((item) => `- ${item}`) : ["- None."]),
    "",
  ];
}

function renderIntegrationSummaryMarkdown(integrationSummary) {
  return [
    `# Wave ${integrationSummary.wave} Integration Summary`,
    "",
    `- Recommendation: ${integrationSummary.recommendation || "unknown"}`,
    `- Detail: ${integrationSummary.detail || "n/a"}`,
    `- Open claims: ${(integrationSummary.openClaims || []).length}`,
    `- Conflicting claims: ${(integrationSummary.conflictingClaims || []).length}`,
    `- Unresolved blockers: ${(integrationSummary.unresolvedBlockers || []).length}`,
    `- Changed interfaces: ${(integrationSummary.changedInterfaces || []).length}`,
    `- Cross-component impacts: ${(integrationSummary.crossComponentImpacts || []).length}`,
    `- Proof gaps: ${(integrationSummary.proofGaps || []).length}`,
    `- Deploy risks: ${(integrationSummary.deployRisks || []).length}`,
    `- Documentation gaps: ${(integrationSummary.docGaps || []).length}`,
    `- Security review: ${integrationSummary.securityState || "not-applicable"}`,
    `- Security findings: ${(integrationSummary.securityFindings || []).length}`,
    `- Security approvals: ${(integrationSummary.securityApprovals || []).length}`,
    `- Inbound dependencies: ${(integrationSummary.inboundDependencies || []).length}`,
    `- Outbound dependencies: ${(integrationSummary.outboundDependencies || []).length}`,
    `- Helper assignments: ${(integrationSummary.helperAssignments || []).length}`,
    "",
    ...renderIntegrationSection("## Open Claims", integrationSummary.openClaims),
    ...renderIntegrationSection("## Conflicting Claims", integrationSummary.conflictingClaims),
    ...renderIntegrationSection("## Unresolved Blockers", integrationSummary.unresolvedBlockers),
    ...renderIntegrationSection("## Changed Interfaces", integrationSummary.changedInterfaces),
    ...renderIntegrationSection(
      "## Cross-Component Impacts",
      integrationSummary.crossComponentImpacts,
    ),
    ...renderIntegrationSection("## Proof Gaps", integrationSummary.proofGaps),
    ...renderIntegrationSection("## Deploy Risks", integrationSummary.deployRisks),
    ...renderIntegrationSection("## Security Findings", integrationSummary.securityFindings),
    ...renderIntegrationSection("## Security Approvals", integrationSummary.securityApprovals),
    ...renderIntegrationSection("## Inbound Dependencies", integrationSummary.inboundDependencies),
    ...renderIntegrationSection("## Outbound Dependencies", integrationSummary.outboundDependencies),
    ...renderIntegrationSection("## Helper Assignments", integrationSummary.helperAssignments),
    "## Runtime Assignments",
    ...((integrationSummary.runtimeAssignments || []).length > 0
      ? integrationSummary.runtimeAssignments.map(
          (assignment) =>
            `- ${assignment.agentId}: executor=${assignment.executorId || "n/a"} role=${assignment.role || "n/a"} profile=${assignment.profile || "none"} fallback_used=${assignment.fallbackUsed ? "yes" : "no"}`,
        )
      : ["- None."]),
    "",
    ...renderIntegrationSection("## Documentation Gaps", integrationSummary.docGaps),
  ].join("\n");
}

function writeWaveDerivedState({
  lanePaths,
  wave,
  agentRuns = [],
  summariesByAgentId = {},
  feedbackRequests = [],
  attempt = 0,
  orchestratorId = null,
}) {
  const coordinationLogPath = waveCoordinationLogPath(lanePaths, wave.wave);
  const existingDocsQueue = readDocsQueue(waveDocsQueuePath(lanePaths, wave.wave));
  const existingIntegrationSummary = readJsonOrNull(waveIntegrationPath(lanePaths, wave.wave));
  const existingLedger = readWaveLedger(waveLedgerPath(lanePaths, wave.wave));
  updateSeedRecords(coordinationLogPath, {
    lane: lanePaths.lane,
    wave: wave.wave,
    agents: wave.agents,
    componentPromotions: wave.componentPromotions,
    sharedPlanDocs: lanePaths.sharedPlanDocs,
    contQaAgentId: lanePaths.contQaAgentId,
    contEvalAgentId: lanePaths.contEvalAgentId,
    integrationAgentId: lanePaths.integrationAgentId,
    documentationAgentId: lanePaths.documentationAgentId,
    feedbackRequests,
  });
  let coordinationState = readMaterializedCoordinationState(coordinationLogPath);
  const clarificationTriage = triageClarificationRequests({
    lanePaths,
    wave,
    coordinationLogPath,
    coordinationState,
    orchestratorId,
    attempt,
    resolutionContext: {
      docsQueue: existingDocsQueue,
      integrationSummary: existingIntegrationSummary,
      ledger: existingLedger,
      summariesByAgentId,
    },
  });
  if (clarificationTriage.changed) {
    coordinationState = readMaterializedCoordinationState(coordinationLogPath);
  }
  const capabilityAssignments = buildRequestAssignments({
    coordinationState,
    agents: wave.agents,
    ledger: existingLedger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  syncAssignmentRecords(coordinationLogPath, {
    lane: lanePaths.lane,
    wave: wave.wave,
    assignments: capabilityAssignments,
  });
  coordinationState = readMaterializedCoordinationState(coordinationLogPath);
  const dependencySnapshot = buildDependencySnapshot({
    dirPath: lanePaths.crossLaneDependenciesDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agents: wave.agents,
    ledger: existingLedger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  writeAssignmentSnapshot(waveAssignmentsPath(lanePaths, wave.wave), capabilityAssignments, {
    lane: lanePaths.lane,
    wave: wave.wave,
  });
  writeDependencySnapshot(waveDependencySnapshotPath(lanePaths, wave.wave), dependencySnapshot, {
    lane: lanePaths.lane,
    wave: wave.wave,
  });
  writeDependencySnapshotMarkdown(
    waveDependencySnapshotMarkdownPath(lanePaths, wave.wave),
    dependencySnapshot,
  );
  const runtimeAssignments = wave.agents.map((agent) => ({
    agentId: agent.agentId,
    role: agent.executorResolved?.role || null,
    initialExecutorId: agent.executorResolved?.initialExecutorId || null,
    executorId: agent.executorResolved?.id || null,
    profile: agent.executorResolved?.profile || null,
    selectedBy: agent.executorResolved?.selectedBy || null,
    retryPolicy: agent.executorResolved?.retryPolicy || null,
    allowFallbackOnRetry: agent.executorResolved?.allowFallbackOnRetry !== false,
    fallbacks: agent.executorResolved?.fallbacks || [],
    fallbackUsed: agent.executorResolved?.fallbackUsed === true,
    fallbackReason: agent.executorResolved?.fallbackReason || null,
    executorHistory: agent.executorResolved?.executorHistory || [],
  }));
  const docsQueue = buildDocsQueue({
    lane: lanePaths.lane,
    wave,
    summariesByAgentId,
    sharedPlanDocs: lanePaths.sharedPlanDocs,
    componentPromotions: wave.componentPromotions,
    runtimeAssignments,
  });
  writeDocsQueue(waveDocsQueuePath(lanePaths, wave.wave), docsQueue);
  const securitySummary = buildWaveSecuritySummary({
    lanePaths,
    wave,
    attempt,
    summariesByAgentId,
  });
  writeJsonArtifact(waveSecurityPath(lanePaths, wave.wave), securitySummary);
  writeTextAtomic(
    waveSecurityMarkdownPath(lanePaths, wave.wave),
    `${renderWaveSecuritySummaryMarkdown(securitySummary)}\n`,
  );
  const integrationSummary = buildWaveIntegrationSummary({
    lanePaths,
    wave,
    attempt,
    coordinationState,
    summariesByAgentId,
    docsQueue,
    runtimeAssignments,
    agentRuns,
    capabilityAssignments,
    dependencySnapshot,
    securitySummary,
  });
  writeJsonArtifact(waveIntegrationPath(lanePaths, wave.wave), integrationSummary);
  writeTextAtomic(
    waveIntegrationMarkdownPath(lanePaths, wave.wave),
    `${renderIntegrationSummaryMarkdown(integrationSummary)}\n`,
  );
  const ledger = deriveWaveLedger({
    lane: lanePaths.lane,
    wave,
    summariesByAgentId,
    coordinationState,
    integrationSummary,
    docsQueue,
    attempt,
    contQaAgentId: lanePaths.contQaAgentId,
    contEvalAgentId: lanePaths.contEvalAgentId,
    integrationAgentId: lanePaths.integrationAgentId,
    documentationAgentId: lanePaths.documentationAgentId,
    benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
    capabilityAssignments,
    dependencySnapshot,
  });
  writeWaveLedger(waveLedgerPath(lanePaths, wave.wave), ledger);
  const inboxDir = waveInboxDir(lanePaths, wave.wave);
  ensureDirectory(inboxDir);
  const sharedSummary = compileSharedSummary({
    wave,
    state: coordinationState,
    ledger,
    integrationSummary,
    capabilityAssignments,
    dependencySnapshot,
  });
  const sharedSummaryPath = path.join(inboxDir, "shared-summary.md");
  writeCompiledInbox(sharedSummaryPath, sharedSummary.text);
  const inboxesByAgentId = {};
  for (const agent of wave.agents) {
    const inbox = compileAgentInbox({
      wave,
      agent,
      state: coordinationState,
      ledger,
      docsQueue,
      integrationSummary,
      capabilityAssignments,
      dependencySnapshot,
    });
    const inboxPath = path.join(inboxDir, `${agent.agentId}.md`);
    writeCompiledInbox(inboxPath, inbox.text);
    inboxesByAgentId[agent.agentId] = { path: inboxPath, text: inbox.text, truncated: inbox.truncated };
  }
  const boardText = renderCoordinationBoardProjection({
    wave: wave.wave,
    waveFile: wave.file,
    agents: wave.agents,
    state: coordinationState,
    capabilityAssignments,
    dependencySnapshot,
  });
  const messageBoardPath = path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`);
  writeCoordinationBoardProjection(messageBoardPath, {
    wave: wave.wave,
    waveFile: wave.file,
    agents: wave.agents,
    state: coordinationState,
    capabilityAssignments,
    dependencySnapshot,
  });
  return {
    coordinationLogPath,
    coordinationState,
    clarificationTriage,
    docsQueue,
    capabilityAssignments,
    dependencySnapshot,
    securitySummary,
    integrationSummary,
    integrationMarkdownPath: waveIntegrationMarkdownPath(lanePaths, wave.wave),
    securityMarkdownPath: waveSecurityMarkdownPath(lanePaths, wave.wave),
    ledger,
    sharedSummaryPath,
    sharedSummaryText: sharedSummary.text,
    inboxesByAgentId,
    messageBoardPath,
    messageBoardText: boardText,
  };
}

function applyDerivedStateToDashboard(dashboardState, derivedState) {
  if (!dashboardState || !derivedState) {
    return;
  }
  dashboardState.helperAssignmentsOpen = (derivedState.capabilityAssignments || []).filter(
    (assignment) => assignment.blocking,
  ).length;
  dashboardState.inboundDependenciesOpen = (derivedState.dependencySnapshot?.openInbound || []).length;
  dashboardState.outboundDependenciesOpen = (derivedState.dependencySnapshot?.openOutbound || []).length;
}

export function readWaveImplementationGate(wave, agentRuns) {
  const contQaAgentId = wave.contQaAgentId || "A0";
  const contEvalAgentId = wave.contEvalAgentId || "E0";
  const integrationAgentId = wave.integrationAgentId || "A8";
  const documentationAgentId = wave.documentationAgentId || "A9";
  for (const runInfo of agentRuns) {
    if (
      [contQaAgentId, integrationAgentId, documentationAgentId].includes(runInfo.agent.agentId) ||
      isContEvalReportOnlyAgent(runInfo.agent, { contEvalAgentId }) ||
      isSecurityReviewAgent(runInfo.agent)
    ) {
      continue;
    }
    const summary = readRunExecutionSummary(runInfo, wave);
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

function analyzePromotedComponentOwners(componentId, agentRuns, summariesByAgentId) {
  const ownerRuns = (agentRuns || []).filter((runInfo) =>
    runInfo.agent.components?.includes(componentId),
  );
  const ownerAgentIds = ownerRuns.map((runInfo) => runInfo.agent.agentId);
  const satisfiedAgentIds = [];
  const waitingOnAgentIds = [];
  const failedOwnContractAgentIds = [];
  for (const runInfo of ownerRuns) {
    const summary = summariesByAgentId?.[runInfo.agent.agentId] || null;
    const implementationValidation = validateImplementationSummary(runInfo.agent, summary);
    const componentMarkers = new Map(
      Array.isArray(summary?.components)
        ? summary.components.map((component) => [component.componentId, component])
        : [],
    );
    const marker = componentMarkers.get(componentId);
    const expectedLevel = runInfo.agent.componentTargets?.[componentId] || null;
    const componentSatisfied =
      marker &&
      marker.state === "met" &&
      (!expectedLevel || marker.level === expectedLevel);
    if (implementationValidation.ok && componentSatisfied) {
      satisfiedAgentIds.push(runInfo.agent.agentId);
      continue;
    }
    waitingOnAgentIds.push(runInfo.agent.agentId);
    if (!implementationValidation.ok) {
      failedOwnContractAgentIds.push(runInfo.agent.agentId);
    }
  }
  return {
    componentId,
    ownerRuns,
    ownerAgentIds,
    satisfiedAgentIds,
    waitingOnAgentIds,
    failedOwnContractAgentIds,
  };
}

function buildSharedComponentSiblingPendingFailure(componentState) {
  if (
    !componentState ||
    componentState.satisfiedAgentIds.length === 0 ||
    componentState.waitingOnAgentIds.length === 0
  ) {
    return null;
  }
  const landedSummary =
    componentState.satisfiedAgentIds.length === 1
      ? `${componentState.satisfiedAgentIds[0]} desired-state slice landed`
      : `${componentState.satisfiedAgentIds.join(", ")} desired-state slices landed`;
  const ownerRun =
    componentState.ownerRuns.find((runInfo) =>
      componentState.waitingOnAgentIds.includes(runInfo.agent.agentId),
    ) ||
    componentState.ownerRuns[0] ||
    null;
  return {
    ok: false,
    agentId: componentState.waitingOnAgentIds[0] || ownerRun?.agent?.agentId || null,
    componentId: componentState.componentId || null,
    statusCode: "shared-component-sibling-pending",
    detail: `${landedSummary}; shared component closure still depends on ${componentState.waitingOnAgentIds.join("/")}.`,
    logPath: ownerRun ? path.relative(REPO_ROOT, ownerRun.logPath) : null,
    ownerAgentIds: componentState.ownerAgentIds,
    satisfiedAgentIds: componentState.satisfiedAgentIds,
    waitingOnAgentIds: componentState.waitingOnAgentIds,
    failedOwnContractAgentIds: componentState.failedOwnContractAgentIds,
  };
}

export function readWaveComponentGate(wave, agentRuns, options = {}) {
  const summariesByAgentId = Object.fromEntries(
    agentRuns.map((runInfo) => [runInfo.agent.agentId, readRunExecutionSummary(runInfo, wave)]),
  );
  const validation = validateWaveComponentPromotions(wave, summariesByAgentId, options);
  const sharedPending = (wave.componentPromotions || [])
    .map((promotion) =>
      buildSharedComponentSiblingPendingFailure(
        analyzePromotedComponentOwners(promotion.componentId, agentRuns, summariesByAgentId),
      ),
    )
    .find(Boolean);
  if (sharedPending) {
    return sharedPending;
  }
  if (validation.ok) {
    return {
      ok: true,
      agentId: null,
      componentId: null,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: null,
    };
  }
  const componentState = analyzePromotedComponentOwners(
    validation.componentId,
    agentRuns,
    summariesByAgentId,
  );
  const ownerRun = componentState.ownerRuns[0] ?? null;
  return {
    ok: false,
    agentId: ownerRun?.agent?.agentId || null,
    componentId: validation.componentId || null,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: ownerRun ? path.relative(REPO_ROOT, ownerRun.logPath) : null,
    ownerAgentIds: componentState.ownerAgentIds,
    satisfiedAgentIds: componentState.satisfiedAgentIds,
    waitingOnAgentIds: componentState.waitingOnAgentIds,
    failedOwnContractAgentIds: componentState.failedOwnContractAgentIds,
  };
}

export function readWaveComponentMatrixGate(wave, agentRuns, options = {}) {
  const validation = validateWaveComponentMatrixCurrentLevels(wave, options);
  if (validation.ok) {
    return {
      ok: true,
      agentId: null,
      componentId: null,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: null,
    };
  }
  const documentationAgentId =
    options.documentationAgentId || wave.documentationAgentId || "A9";
  const docRun =
    agentRuns.find((runInfo) => runInfo.agent.agentId === documentationAgentId) ?? null;
  return {
    ok: false,
    agentId: docRun?.agent?.agentId || null,
    componentId: validation.componentId || null,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: docRun ? path.relative(REPO_ROOT, docRun.logPath) : null,
  };
}

export function readWaveDocumentationGate(wave, agentRuns) {
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
  const summary = readRunExecutionSummary(docRun, wave);
  const validation = validateDocumentationClosureSummary(docRun.agent, summary);
  return {
    ok: validation.ok,
    agentId: docRun.agent.agentId,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: summary?.logPath || path.relative(REPO_ROOT, docRun.logPath),
  };
}

export function readWaveSecurityGate(wave, agentRuns) {
  const securityRuns = (agentRuns || []).filter((run) => isSecurityReviewAgent(run.agent));
  if (securityRuns.length === 0) {
    return {
      ok: true,
      agentId: null,
      statusCode: "pass",
      detail: "No security reviewer declared for this wave.",
      logPath: null,
    };
  }
  const concernAgentIds = [];
  for (const runInfo of securityRuns) {
    const summary = readRunExecutionSummary(runInfo, wave);
    const validation = validateSecuritySummary(runInfo.agent, summary);
    if (!validation.ok) {
      return {
        ok: false,
        agentId: runInfo.agent.agentId,
        statusCode: validation.statusCode,
        detail: validation.detail,
        logPath: summary?.logPath || path.relative(REPO_ROOT, runInfo.logPath),
      };
    }
    if (summary?.security?.state === "concerns") {
      concernAgentIds.push(runInfo.agent.agentId);
    }
  }
  if (concernAgentIds.length > 0) {
    return {
      ok: true,
      agentId: null,
      statusCode: "security-concerns",
      detail: `Security review reported advisory concerns (${concernAgentIds.join(", ")}).`,
      logPath: null,
    };
  }
  return {
    ok: true,
    agentId: null,
    statusCode: "pass",
    detail: "Security review is clear.",
    logPath: null,
  };
}

export function readWaveIntegrationGate(wave, agentRuns, options = {}) {
  const integrationAgentId =
    options.integrationAgentId || wave.integrationAgentId || "A8";
  const requireIntegration =
    options.requireIntegrationSteward === true ||
    (options.requireIntegrationStewardFromWave !== null &&
      options.requireIntegrationStewardFromWave !== undefined &&
      wave.wave >= options.requireIntegrationStewardFromWave);
  const integrationRun =
    agentRuns.find((run) => run.agent.agentId === integrationAgentId) ?? null;
  if (!integrationRun) {
    return {
      ok: !requireIntegration,
      agentId: requireIntegration ? integrationAgentId : null,
      statusCode: requireIntegration ? "missing-integration" : "pass",
      detail: requireIntegration
        ? `Agent ${integrationAgentId} is missing.`
        : "No explicit integration steward declared for this wave.",
      logPath: null,
    };
  }
  const summary = readRunExecutionSummary(integrationRun, wave);
  const validation = validateIntegrationSummary(integrationRun.agent, summary);
  return {
    ok: validation.ok,
    agentId: integrationRun.agent.agentId,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: summary?.logPath || path.relative(REPO_ROOT, integrationRun.logPath),
  };
}

export function readWaveIntegrationBarrier(wave, agentRuns, derivedState, options = {}) {
  const markerGate = readWaveIntegrationGate(wave, agentRuns, options);
  if (!markerGate.ok) {
    return markerGate;
  }
  const integrationSummary = derivedState?.integrationSummary || null;
  if (!integrationSummary) {
    return {
      ok: false,
      agentId: markerGate.agentId,
      statusCode: "missing-integration-summary",
      detail: `Missing integration summary artifact for wave ${wave.wave}.`,
      logPath: markerGate.logPath,
    };
  }
  if (integrationSummary.recommendation !== "ready-for-doc-closure") {
    return {
      ok: false,
      agentId: markerGate.agentId,
      statusCode: "integration-needs-more-work",
      detail:
        integrationSummary.detail ||
        `Integration summary still reports ${integrationSummary.recommendation}.`,
      logPath: markerGate.logPath,
    };
  }
  return markerGate;
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

function pruneDryRunExecutorPreviewDirs(lanePaths, waves) {
  if (!fs.existsSync(lanePaths.executorOverlaysDir)) {
    return [];
  }
  const expectedSlugsByWave = new Map(
    (waves || []).map((wave) => [wave.wave, new Set((wave.agents || []).map((agent) => agent.slug))]),
  );
  const removedPaths = [];
  for (const entry of fs.readdirSync(lanePaths.executorOverlaysDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^wave-\d+$/.test(entry.name)) {
      continue;
    }
    const waveNumber = Number.parseInt(entry.name.slice("wave-".length), 10);
    const waveDir = path.join(lanePaths.executorOverlaysDir, entry.name);
    const expectedSlugs = expectedSlugsByWave.get(waveNumber);
    if (!expectedSlugs) {
      fs.rmSync(waveDir, { recursive: true, force: true });
      removedPaths.push(path.relative(REPO_ROOT, waveDir));
      continue;
    }
    for (const child of fs.readdirSync(waveDir, { withFileTypes: true })) {
      if (!child.isDirectory() || expectedSlugs.has(child.name)) {
        continue;
      }
      const childPath = path.join(waveDir, child.name);
      fs.rmSync(childPath, { recursive: true, force: true });
      removedPaths.push(path.relative(REPO_ROOT, childPath));
    }
  }
  return removedPaths.toSorted();
}

export function reconcileStaleLauncherArtifacts(lanePaths, options = {}) {
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
  if (terminalSurfaceUsesTerminalRegistry(options.terminalSurface || "vscode")) {
    const terminalCleanup = pruneOrphanLaneTemporaryTerminalEntries(
      lanePaths.terminalsPath,
      lanePaths,
      activeSessionNames,
    );
    outcome.removedTerminalNames = terminalCleanup.removedNames;
  }

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
  return collectUnexpectedSessionFailuresImpl(lanePaths, agentRuns, pendingAgentIds, {
    listLaneTmuxSessionNamesFn: listLaneTmuxSessionNames,
  });
}

function launchWaveDashboardSession(lanePaths, { sessionName, dashboardPath, messageBoardPath }) {
  killTmuxSessionIfExists(lanePaths.tmuxSocketName, sessionName);
  const messageBoardArg = messageBoardPath
    ? ` --message-board ${shellQuote(messageBoardPath)}`
    : "";
  const command = [
    `cd ${shellQuote(REPO_ROOT)}`,
    `node ${shellQuote(path.join(PACKAGE_ROOT, "scripts", "wave-dashboard.mjs"))} --dashboard-file ${shellQuote(
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
  return launchAgentSessionImpl(lanePaths, params, { runTmuxFn: runTmux });
}

async function waitForWaveCompletion(lanePaths, agentRuns, timeoutMinutes, onProgress = null) {
  return waitForWaveCompletionImpl(lanePaths, agentRuns, timeoutMinutes, onProgress, {
    collectUnexpectedSessionFailuresFn: collectUnexpectedSessionFailures,
  });
}

function monitorWaveHumanFeedback({
  lanePaths,
  waveNumber,
  agentRuns,
  orchestratorId,
  coordinationLogPath,
  feedbackStateByRequestId,
  recordCombinedEvent,
  appendCoordination,
}) {
  const triageLogPath = path.join(lanePaths.feedbackTriageDir, `wave-${waveNumber}.jsonl`);
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
        `[human-feedback] respond with: pnpm exec wave-feedback respond --id ${request.id} --response "<answer>" --operator "<name>"`,
      );
      appendCoordination({
        event: "human_feedback_requested",
        waves: [waveNumber],
        status: "waiting-human",
        details: `request_id=${request.id}; agent=${request.agentId}; question=${question}${context}`,
        actionRequested: `Launcher operator should ask or answer in the parent session, then run: pnpm exec wave-feedback respond --id ${request.id} --response "<answer>" --operator "<name>"`,
      });
      if (coordinationLogPath) {
        appendCoordinationRecord(coordinationLogPath, {
          id: request.id,
          lane: lanePaths.lane,
          wave: waveNumber,
          agentId: request.agentId || "human",
          kind: "human-feedback",
          targets: request.agentId ? [`agent:${request.agentId}`] : [],
          priority: "high",
          summary: question,
          detail: request.context || "",
          status: "open",
          source: "feedback",
        });
      }
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
      if (coordinationLogPath) {
        const escalationId = `escalation-${request.id}`;
        const existingEscalation =
          (fs.existsSync(triageLogPath)
            ? readMaterializedCoordinationState(triageLogPath).byId.get(escalationId)
            : null) ||
          readMaterializedCoordinationState(coordinationLogPath).byId.get(escalationId) ||
          null;
        if (fs.existsSync(triageLogPath)) {
          appendCoordinationRecord(triageLogPath, {
            id: escalationId,
            lane: lanePaths.lane,
            wave: waveNumber,
            agentId: request.agentId || "human",
            kind: "human-escalation",
            targets:
              existingEscalation?.targets ||
              (request.agentId ? [`agent:${request.agentId}`] : []),
            dependsOn: existingEscalation?.dependsOn || [],
            closureCondition: existingEscalation?.closureCondition || "",
            priority: "high",
            summary: question,
            detail: responseText,
            artifactRefs: [request.id],
            status: "resolved",
            source: "feedback",
          });
        }
        appendCoordinationRecord(coordinationLogPath, {
          id: escalationId,
          lane: lanePaths.lane,
          wave: waveNumber,
          agentId: request.agentId || "human",
          kind: "human-escalation",
          targets:
            existingEscalation?.targets ||
            (request.agentId ? [`agent:${request.agentId}`] : []),
          dependsOn: existingEscalation?.dependsOn || [],
          closureCondition: existingEscalation?.closureCondition || "",
          priority: "high",
          summary: question,
          detail: responseText,
          artifactRefs: [request.id],
          status: "resolved",
          source: "feedback",
        });
        appendCoordinationRecord(coordinationLogPath, {
          id: request.id,
          lane: lanePaths.lane,
          wave: waveNumber,
          agentId: request.agentId || "human",
          kind: "human-feedback",
          targets: request.agentId ? [`agent:${request.agentId}`] : [],
          priority: "high",
          summary: question,
          detail: responseText,
          status: "resolved",
          source: "feedback",
        });
      }
    }
  }
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

function relaunchReasonBuckets(runs, failures, derivedState) {
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

function applySharedComponentWaitStateToDashboard(componentGate, dashboardState) {
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

function reconcileFailuresAgainstSharedComponentState(wave, agentRuns, failures) {
  if (!Array.isArray(failures) || failures.length === 0) {
    return failures;
  }
  const summariesByAgentId = Object.fromEntries(
    (agentRuns || []).map((runInfo) => [runInfo.agent.agentId, readRunExecutionSummary(runInfo, wave)]),
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
  const proofCentric =
    agentRequiresProofCentricValidation(agent) || waveRequiresProofCentricValidation(options.wave);
  if (!proofCentric) {
    return true;
  }
  const summary = readAgentExecutionSummary(statusPath);
  if (!summary) {
    return false;
  }
  if (!validateImplementationSummary(agent, summary).ok) {
    return false;
  }
  if (proofCentricReuseBlocked(options.derivedState)) {
    return false;
  }
  return true;
}

function isClosureAgentId(agent, lanePaths) {
  return [
    lanePaths.contEvalAgentId || "E0",
    lanePaths.integrationAgentId || "A8",
    lanePaths.documentationAgentId || "A9",
    lanePaths.contQaAgentId || "A0",
  ].includes(agent?.agentId) || isSecurityReviewAgent(agent);
}

export function selectInitialWaveRuns(agentRuns, lanePaths) {
  const implementationRuns = (agentRuns || []).filter(
    (run) => !isClosureAgentId(run?.agent, lanePaths),
  );
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

function executorFallbackChain(executorState) {
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

export function readClarificationBarrier(derivedState) {
  const openClarifications = (derivedState?.coordinationState?.clarifications || []).filter(
    (record) => isOpenCoordinationStatus(record.status),
  );
  if (openClarifications.length > 0) {
    return {
      ok: false,
      statusCode: "clarification-open",
      detail: `Open clarifications remain (${openClarifications.map((record) => record.id).join(", ")}).`,
    };
  }
  const openClarificationRequests = openClarificationLinkedRequests(
    derivedState?.coordinationState,
  );
  if (openClarificationRequests.length > 0) {
    return {
      ok: false,
      statusCode: "clarification-follow-up-open",
      detail: `Clarification follow-up requests remain open (${openClarificationRequests.map((record) => record.id).join(", ")}).`,
    };
  }
  const pendingHuman = [
    ...((derivedState?.coordinationState?.humanEscalations || []).filter((record) =>
      isOpenCoordinationStatus(record.status),
    )),
    ...((derivedState?.coordinationState?.humanFeedback || []).filter((record) =>
      isOpenCoordinationStatus(record.status),
    )),
  ];
  if (pendingHuman.length > 0) {
    return {
      ok: false,
      statusCode: "human-feedback-open",
      detail: `Pending human input remains (${pendingHuman.map((record) => record.id).join(", ")}).`,
    };
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: "",
  };
}

export function readWaveAssignmentBarrier(derivedState) {
  const blockingAssignments = (derivedState?.capabilityAssignments || []).filter(
    (assignment) => assignment.blocking,
  );
  if (blockingAssignments.length === 0) {
    return {
      ok: true,
      statusCode: "pass",
      detail: "",
    };
  }
  const unresolvedAssignments = blockingAssignments.filter((assignment) => !assignment.assignedAgentId);
  if (unresolvedAssignments.length > 0) {
    return {
      ok: false,
      statusCode: "helper-assignment-unresolved",
      detail: `Helper assignments remain unresolved (${unresolvedAssignments.map((assignment) => assignment.requestId).join(", ")}).`,
    };
  }
  return {
    ok: false,
    statusCode: "helper-assignment-open",
    detail: `Helper assignments remain open (${blockingAssignments.map((assignment) => assignment.requestId).join(", ")}).`,
  };
}

export function readWaveDependencyBarrier(derivedState) {
  const requiredInbound = derivedState?.dependencySnapshot?.requiredInbound || [];
  const requiredOutbound = derivedState?.dependencySnapshot?.requiredOutbound || [];
  const unresolvedInboundAssignments =
    derivedState?.dependencySnapshot?.unresolvedInboundAssignments || [];
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
  return {
    ok: true,
    statusCode: "pass",
    detail: "",
  };
}

export function buildGateSnapshot({
  wave,
  agentRuns,
  derivedState,
  lanePaths,
  componentMatrixPayload,
  componentMatrixJsonPath,
  validationMode = "compat",
}) {
  const implementationGate = readWaveImplementationGate(wave, agentRuns);
  const componentGate = readWaveComponentGate(wave, agentRuns, {
    laneProfile: lanePaths?.laneProfile,
  });
  const integrationGate = readWaveIntegrationGate(wave, agentRuns, {
    integrationAgentId: lanePaths?.integrationAgentId,
    requireIntegrationStewardFromWave: lanePaths?.requireIntegrationStewardFromWave,
  });
  const integrationBarrier = readWaveIntegrationBarrier(wave, agentRuns, derivedState, {
    integrationAgentId: lanePaths?.integrationAgentId,
    requireIntegrationStewardFromWave: lanePaths?.requireIntegrationStewardFromWave,
  });
  const documentationGate = readWaveDocumentationGate(wave, agentRuns);
  const componentMatrixGate = readWaveComponentMatrixGate(wave, agentRuns, {
    laneProfile: lanePaths?.laneProfile,
    documentationAgentId: lanePaths?.documentationAgentId,
    componentMatrixPayload,
    componentMatrixJsonPath,
  });
  const contEvalGate = readWaveContEvalGate(wave, agentRuns, {
    contEvalAgentId: lanePaths?.contEvalAgentId,
    mode: validationMode,
    evalTargets: wave.evalTargets,
    benchmarkCatalogPath: lanePaths?.laneProfile?.paths?.benchmarkCatalogPath,
  });
  const securityGate = readWaveSecurityGate(wave, agentRuns);
  const contQaGate = readWaveContQaGate(wave, agentRuns, {
    contQaAgentId: lanePaths?.contQaAgentId,
    mode: validationMode,
  });
  const infraGate = readWaveInfraGate(agentRuns);
  const clarificationBarrier = readClarificationBarrier(derivedState);
  const helperAssignmentBarrier = readWaveAssignmentBarrier(derivedState);
  const dependencyBarrier = readWaveDependencyBarrier(derivedState);
  const orderedGates = [
    ["implementationGate", implementationGate],
    ["componentGate", componentGate],
    ["helperAssignmentBarrier", helperAssignmentBarrier],
    ["dependencyBarrier", dependencyBarrier],
    ["contEvalGate", contEvalGate],
    ["securityGate", securityGate],
    ["integrationBarrier", integrationBarrier],
    ["documentationGate", documentationGate],
    ["componentMatrixGate", componentMatrixGate],
    ["contQaGate", contQaGate],
    ["infraGate", infraGate],
    ["clarificationBarrier", clarificationBarrier],
  ];
  const firstFailure = orderedGates.find(([, gate]) => gate?.ok === false);
  return {
    implementationGate,
    componentGate,
    integrationGate,
    integrationBarrier,
    documentationGate,
    componentMatrixGate,
    contEvalGate,
    securityGate,
    contQaGate,
    infraGate,
    clarificationBarrier,
    helperAssignmentBarrier,
    dependencyBarrier,
    overall: firstFailure
      ? {
          ok: false,
          gate: firstFailure[0],
          statusCode: firstFailure[1].statusCode,
          detail: firstFailure[1].detail,
          agentId: firstFailure[1].agentId || null,
        }
      : {
          ok: true,
          gate: "pass",
          statusCode: "pass",
          detail: "All replayed wave gates passed.",
          agentId: null,
        },
  };
}

export function resolveRelaunchRuns(agentRuns, failures, derivedState, lanePaths, waveDefinition = null) {
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
      runs: [runsByAgentId.get(lanePaths.documentationAgentId)].filter(Boolean),
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
      runs: [runsByAgentId.get(lanePaths.contEvalAgentId)].filter(Boolean),
      barrier: null,
    };
  }
  if (derivedState?.ledger?.phase === "cont-qa-closure") {
    return {
      runs: [runsByAgentId.get(lanePaths.contQaAgentId)].filter(Boolean),
      barrier: null,
    };
  }
  if (derivedState?.ledger?.phase === "integrating") {
    return {
      runs: [runsByAgentId.get(lanePaths.integrationAgentId)].filter(Boolean),
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

function preflightWavesForExecutorAvailability(waves, lanePaths) {
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
  ensureDirectory(lanePaths.assignmentsDir);
  ensureDirectory(lanePaths.inboxesDir);
  ensureDirectory(lanePaths.ledgerDir);
  ensureDirectory(lanePaths.integrationDir);
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
            messageBoardPath,
            messageBoardSnapshot: derivedState.messageBoardText,
            sharedSummaryPath: derivedState.sharedSummaryPath,
            sharedSummaryText: derivedState.sharedSummaryText,
            inboxPath: derivedState.inboxesByAgentId[agent.agentId]?.path || null,
            inboxText: derivedState.inboxesByAgentId[agent.agentId]?.text || "",
          };
        });

        const refreshDerivedState = (attemptNumber = 0) => {
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
        const persistedRelaunchPlan = readWaveRelaunchPlan(lanePaths, wave.wave);

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

        const preCompletedAgentIds = new Set(
          agentRuns
            .filter(
              (run) =>
                !isClosureAgentId(run.agent.agentId, lanePaths) &&
                hasReusableSuccessStatus(run.agent, run.statusPath, {
                  wave,
                  derivedState,
                }),
            )
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

        if (options.dashboard && currentWaveDashboardTerminalEntry) {
          launchWaveDashboardSession(lanePaths, {
            sessionName: currentWaveDashboardTerminalEntry.sessionName,
            dashboardPath,
            messageBoardPath,
          });
        }

        const availableRuns = agentRuns.filter((run) => !preCompletedAgentIds.has(run.agent.agentId));
        const persistedRuns = applyPersistedRelaunchPlan(
          availableRuns,
          persistedRelaunchPlan,
          lanePaths,
          wave,
        );
        let runsToLaunch =
          persistedRuns.length > 0 ? persistedRuns : selectInitialWaveRuns(availableRuns, lanePaths);
        let attempt = 1;
        const feedbackStateByRequestId = new Map();
        let completionGateSnapshot = null;
        let completionTraceDir = null;

        while (attempt <= options.maxRetriesPerWave + 1) {
          refreshDerivedState(attempt - 1);
          dashboardState.attempt = attempt;
          updateWaveDashboardMessageBoard(dashboardState, messageBoardPath);
          flushDashboards();
          recordCombinedEvent({
            message: `Attempt ${attempt}/${options.maxRetriesPerWave + 1}; launching agents: ${runsToLaunch.map((run) => run.agent.agentId).join(", ") || "none"}`,
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
                monitorWaveHumanFeedback({
                  lanePaths,
                  waveNumber: wave.wave,
                  agentRuns: runsToLaunch,
                  orchestratorId: options.orchestratorId,
                  coordinationLogPath: derivedState.coordinationLogPath,
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
          refreshDerivedState(attempt);
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
          const traceDir = writeTraceBundle({
            tracesDir: lanePaths.tracesDir,
            lanePaths,
            launcherOptions: options,
            wave,
            attempt,
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
              attempt,
              coordinationLogPath: derivedState.coordinationLogPath,
            }),
          });
          completionTraceDir = traceDir;

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
          if (relaunchResolution.barrier) {
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
          }
          runsToLaunch = relaunchResolution.runs;
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
