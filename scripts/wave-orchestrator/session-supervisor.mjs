import fs from "node:fs";
import path from "node:path";
import {
  appendOrchestratorBoardEntry,
  buildResidentOrchestratorPrompt,
  feedbackStateSignature,
  readWaveHumanFeedbackRequests,
} from "./coordination.mjs";
import {
  appendCoordinationRecord,
  readMaterializedCoordinationState,
} from "./coordination-store.mjs";
import {
  readStatusCodeIfPresent,
} from "./dashboard-state.mjs";
import { appendWaveControlEvent } from "./control-plane.mjs";
import {
  REPO_ROOT,
  readJsonOrNull,
  readStatusRecordIfPresent,
  ensureDirectory,
  shellQuote,
  PACKAGE_ROOT,
  toIsoTimestamp,
  writeJsonAtomic,
} from "./shared.mjs";
import {
  createWaveAgentSessionName,
  killTmuxSessionIfExists,
  terminalSurfaceUsesTerminalRegistry,
  pruneOrphanLaneTemporaryTerminalEntries,
} from "./terminals.mjs";
import {
  createSession as createTmuxSession,
  listSessions as listTmuxSessions,
  runTmuxCommand,
} from "./tmux-adapter.mjs";
import {
  recordGlobalDashboardEvent,
} from "./dashboard-state.mjs";
import { buildHumanFeedbackWorkflowUpdate } from "./human-input-workflow.mjs";
import {
  collectUnexpectedSessionWarnings as collectUnexpectedSessionWarningsImpl,
  launchAgentSession as launchAgentSessionImpl,
  waitForWaveCompletion as waitForWaveCompletionImpl,
} from "./launcher-runtime.mjs";
import { terminateAgentProcessRuntime } from "./agent-process-runner.mjs";
import {
  buildSupervisorPaths,
  supervisorAgentRuntimePathForRun,
} from "./supervisor-cli.mjs";
import {
  agentUsesSignalHygiene,
  buildSignalStatusLine,
  residentSignalAckPath,
  residentSignalPath,
  syncWaveSignalProjections,
} from "./signals.mjs";

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

function relativeArtifactPath(filePath) {
  return filePath ? path.relative(REPO_ROOT, filePath) : null;
}

function readRuntimeRecord(run) {
  if (!run?.runtimePath || !fs.existsSync(run.runtimePath)) {
    return null;
  }
  return readJsonOrNull(run.runtimePath);
}

export function recordWaveRunState(lanePaths, waveNumber, state, data = {}) {
  return appendWaveControlEvent(lanePaths, waveNumber, {
    entityType: "wave_run",
    entityId: `wave-${waveNumber}`,
    action: state,
    source: "session-supervisor",
    actor: "session-supervisor",
    data: {
      waveId: `wave-${waveNumber}`,
      waveNumber,
      updatedAt: toIsoTimestamp(),
      ...data,
    },
  });
}

export function recordAttemptState(lanePaths, waveNumber, attemptNumber, state, data = {}) {
  return appendWaveControlEvent(lanePaths, waveNumber, {
    entityType: "attempt",
    entityId: `wave-${waveNumber}-attempt-${attemptNumber}`,
    action: state,
    source: "session-supervisor",
    actor: "session-supervisor",
    attempt: attemptNumber,
    data: {
      attemptId: `wave-${waveNumber}-attempt-${attemptNumber}`,
      attemptNumber,
      state,
      selectedAgentIds: data.selectedAgentIds || [],
      detail: data.detail || null,
      updatedAt: toIsoTimestamp(),
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  });
}

export function recordAgentRunStarted(lanePaths, { waveNumber, attempt, runInfo }) {
  if (!runInfo?.agent?.agentId || !Number.isFinite(Number(waveNumber))) {
    return null;
  }
  return appendWaveControlEvent(lanePaths, waveNumber, {
    entityType: "agent_run",
    entityId: `wave-${waveNumber}-attempt-${attempt}-agent-${runInfo.agent.agentId}`,
    action: "started",
    source: "session-supervisor",
    actor: "session-supervisor",
    attempt,
    data: {
      agentId: runInfo.agent.agentId,
      attemptNumber: attempt,
      sessionName: runInfo.sessionName || null,
      executorId: runInfo.lastExecutorId || runInfo.agent.executorResolved?.id || null,
      promptPath: relativeArtifactPath(runInfo.promptPath),
      statusPath: relativeArtifactPath(runInfo.statusPath),
      logPath: relativeArtifactPath(runInfo.logPath),
      startedAt: toIsoTimestamp(),
    },
  });
}

export function recordAgentRunFinished(
  lanePaths,
  { waveNumber, attempt, runInfo, failure = null, statusRecord = null },
) {
  if (!runInfo?.agent?.agentId || !Number.isFinite(Number(waveNumber))) {
    return null;
  }
  const effectiveStatusRecord = statusRecord || readStatusRecordIfPresent(runInfo.statusPath);
  const timedOut =
    failure?.statusCode === "timeout-no-status" || failure?.statusCode === "timed_out";
  const action =
    timedOut
      ? "timed_out"
      : Number(effectiveStatusRecord?.code) === 0
        ? "completed"
        : "failed";
  return appendWaveControlEvent(lanePaths, waveNumber, {
    entityType: "agent_run",
    entityId: `wave-${waveNumber}-attempt-${attempt}-agent-${runInfo.agent.agentId}`,
    action,
    source: "session-supervisor",
    actor: "session-supervisor",
    attempt,
    data: {
      agentId: runInfo.agent.agentId,
      attemptNumber: attempt,
      exitCode: effectiveStatusRecord?.code ?? null,
      completedAt: effectiveStatusRecord?.completedAt || toIsoTimestamp(),
      promptHash: effectiveStatusRecord?.promptHash || runInfo.lastPromptHash || null,
      executorId: runInfo.lastExecutorId || runInfo.agent.executorResolved?.id || null,
      statusCode: failure?.statusCode || null,
      detail: failure?.detail || null,
      logPath: relativeArtifactPath(runInfo.logPath),
      statusPath: relativeArtifactPath(runInfo.statusPath),
    },
  });
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

async function listLaneTmuxSessionNames(lanePaths) {
  return (await listTmuxSessionNames(lanePaths)).filter((sessionName) =>
    isLaneSessionName(lanePaths, sessionName),
  );
}

function residentOrchestratorRolePromptPath() {
  return path.join(REPO_ROOT, "docs", "agents", "wave-orchestrator-role.md");
}

function loadResidentOrchestratorRolePrompt() {
  const filePath = residentOrchestratorRolePromptPath();
  if (!fs.existsSync(filePath)) {
    return "Monitor the wave, triage clarification timing, and intervene through coordination records only.";
  }
  return fs.readFileSync(filePath, "utf8");
}

function defaultResidentExecutorState(options) {
  if (options.executorMode === "claude") {
    return {
      id: "claude",
      role: "orchestrator",
      selectedBy: "resident-orchestrator",
      budget: { minutes: options.timeoutMinutes },
      claude: {
        command: "claude",
      },
    };
  }
  if (options.executorMode === "opencode") {
    return {
      id: "opencode",
      role: "orchestrator",
      selectedBy: "resident-orchestrator",
      budget: { minutes: options.timeoutMinutes },
      opencode: {
        command: "opencode",
      },
    };
  }
  return {
    id: "codex",
    role: "orchestrator",
    selectedBy: "resident-orchestrator",
    budget: { minutes: options.timeoutMinutes },
    codex: {
      command: "codex",
      sandbox: options.codexSandboxMode,
    },
  };
}

function buildResidentExecutorState(executorTemplate, options) {
  const source = executorTemplate
    ? JSON.parse(JSON.stringify(executorTemplate))
    : defaultResidentExecutorState(options);
  source.role = "orchestrator";
  source.selectedBy = "resident-orchestrator";
  source.budget = {
    ...(source.budget || {}),
    minutes: Math.max(
      Number.parseInt(String(source?.budget?.minutes || 0), 10) || 0,
      options.timeoutMinutes,
    ),
  };
  if (source.id === "codex") {
    source.codex = {
      ...(source.codex || {}),
      command: source?.codex?.command || "codex",
      sandbox: source?.codex?.sandbox || options.codexSandboxMode,
    };
  } else if (source.id === "claude") {
    source.claude = {
      ...(source.claude || {}),
      command: source?.claude?.command || "claude",
    };
  } else if (source.id === "opencode") {
    source.opencode = {
      ...(source.opencode || {}),
      command: source?.opencode?.command || "opencode",
    };
  }
  return source;
}

export function buildResidentOrchestratorRun({
  lanePaths,
  wave,
  agentRuns,
  derivedState,
  dashboardPath,
  runTag,
  options,
}) {
  const executorTemplate =
    agentRuns.find((run) => run.agent.executorResolved?.id === options.executorMode)?.agent
      ?.executorResolved ||
    agentRuns.find((run) => run.agent.executorResolved)?.agent?.executorResolved ||
    null;
  const executorResolved = buildResidentExecutorState(executorTemplate, options);
  if (executorResolved.id === "local") {
    return {
      run: null,
      skipReason: "Resident orchestrator requires codex, claude, or opencode; local executor is not suitable.",
    };
  }
  const agent = {
    agentId: "ORCH",
    title: "Resident Orchestrator",
    slug: `${wave.wave}-resident-orchestrator`,
    prompt: loadResidentOrchestratorRolePrompt(),
    executorResolved,
  };
  const baseName = `wave-${wave.wave}-resident-orchestrator`;
  const sessionName = createWaveAgentSessionName(
    lanePaths,
    wave.wave,
    "resident_orchestrator",
  );
  return {
    run: {
      agent,
      sessionName,
      promptPath: path.join(lanePaths.promptsDir, `${baseName}.prompt.md`),
      logPath: path.join(lanePaths.logsDir, `${baseName}.log`),
      statusPath: path.join(lanePaths.statusDir, `${baseName}.status`),
      runtimePath: path.join(lanePaths.statusDir, `${baseName}.runtime.json`),
      promptOverride: buildResidentOrchestratorPrompt({
        lane: lanePaths.lane,
        wave: wave.wave,
        waveFile: wave.file,
        orchestratorId: options.orchestratorId,
        coordinationLogPath: derivedState.coordinationLogPath,
        messageBoardPath: derivedState.messageBoardPath,
        sharedSummaryPath: derivedState.sharedSummaryPath,
        dashboardPath,
        triagePath: derivedState.clarificationTriage?.triagePath || null,
        signalStatePath: residentSignalPath(lanePaths, wave.wave),
        signalAckPath: residentSignalAckPath(lanePaths, wave.wave),
        rolePrompt: agent.prompt,
      }),
    },
    skipReason: "",
  };
}

export function monitorResidentOrchestratorSession({
  lanePaths,
  run,
  waveNumber,
  recordCombinedEvent,
  appendCoordination,
  sessionState,
}) {
  if (!run || sessionState?.closed === true) {
    return false;
  }
  if (fs.existsSync(run.statusPath)) {
    sessionState.closed = true;
    const exitCode = readStatusCodeIfPresent(run.statusPath);
    recordCombinedEvent({
      level: exitCode === 0 ? "info" : "warn",
      agentId: run.agent.agentId,
      message:
        exitCode === 0
          ? "Resident orchestrator exited; launcher continues as the control plane."
          : `Resident orchestrator exited with code ${exitCode}; launcher continues as the control plane.`,
    });
    appendCoordination({
      event: "resident_orchestrator_exit",
      waves: [waveNumber],
      status: exitCode === 0 ? "resolved" : "warn",
      details:
        exitCode === 0
          ? "Resident orchestrator session ended before wave completion."
          : `Resident orchestrator session ended with code ${exitCode} before wave completion.`,
      actionRequested: "None",
    });
    return true;
  }
  const runtimeRecord = readRuntimeRecord(run);
  if (
    runtimeRecord &&
    ["completed", "failed", "terminated"].includes(
      String(runtimeRecord.terminalDisposition || ""),
    )
  ) {
    sessionState.closed = true;
    const exitCode = Number.parseInt(String(runtimeRecord.exitCode ?? ""), 10);
    recordCombinedEvent({
      level: Number.isFinite(exitCode) && exitCode === 0 ? "info" : "warn",
      agentId: run.agent.agentId,
      message:
        Number.isFinite(exitCode) && exitCode === 0
          ? "Resident orchestrator ended via runtime record before writing a status file; launcher continues as the control plane."
          : "Resident orchestrator ended via runtime record before writing a status file; launcher continues as the control plane.",
    });
    appendCoordination({
      event: "resident_orchestrator_runtime_terminal",
      waves: [waveNumber],
      status: Number.isFinite(exitCode) && exitCode === 0 ? "resolved" : "warn",
      details: `runtime record reached ${runtimeRecord.terminalDisposition} before ${path.relative(REPO_ROOT, run.statusPath)} was written.`,
      actionRequested: "None",
    });
    return true;
  }
  return false;
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
  const agentPrefix = `${lanePaths.tmuxSessionPrefix}${waveNumber}_`;
  for (const sessionName of activeSessionNames) {
    if (sessionName.startsWith(agentPrefix)) {
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

export function pruneDryRunExecutorPreviewDirs(lanePaths, waves) {
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

export async function reconcileStaleLauncherArtifacts(lanePaths, options = {}) {
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

  outcome.removedSessions = await cleanupLaneTmuxSessions(lanePaths);
  const activeSessionNames = new Set(await listLaneTmuxSessionNames(lanePaths));
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

export function runTmux(lanePaths, args, description) {
  return runTmuxCommand(lanePaths.tmuxSocketName, args, {
    description,
    mutate: ["new-session", "kill-session"].includes(String(args?.[0] || "")),
  });
}

function listTmuxSessionNames(lanePaths) {
  return listTmuxSessions(lanePaths.tmuxSocketName);
}

export async function cleanupLaneTmuxSessions(lanePaths, { excludeSessionNames = new Set() } = {}) {
  const sessionNames = await listTmuxSessionNames(lanePaths);
  const killed = [];
  for (const sessionName of sessionNames) {
    if (excludeSessionNames.has(sessionName) || !isLaneSessionName(lanePaths, sessionName)) {
      continue;
    }
    await killTmuxSessionIfExists(lanePaths.tmuxSocketName, sessionName);
    killed.push(sessionName);
  }
  return killed;
}

export function collectUnexpectedSessionWarnings(lanePaths, agentRuns, pendingAgentIds) {
  return collectUnexpectedSessionWarningsImpl(lanePaths, agentRuns, pendingAgentIds, {});
}

export async function launchWaveDashboardSession(lanePaths, { sessionName, dashboardPath, messageBoardPath }) {
  await killTmuxSessionIfExists(lanePaths.tmuxSocketName, sessionName);
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
  await createTmuxSession(
    lanePaths.tmuxSocketName,
    sessionName,
    `bash -lc ${shellQuote(command)}`,
    { description: `launch dashboard session ${sessionName}` },
  );
}

export async function launchAgentSession(lanePaths, params) {
  const supervisorRunId = String(process.env.WAVE_SUPERVISOR_RUN_ID || "").trim();
  const runtimePath = supervisorRunId
    ? supervisorAgentRuntimePathForRun(
      buildSupervisorPaths(lanePaths),
      supervisorRunId,
      params?.agent?.agentId || "unknown-agent",
    )
    : params?.runtimePath || null;
  const result = await launchAgentSessionImpl(
    lanePaths,
    {
      ...params,
      runtimePath,
    },
    { runTmuxFn: runTmux },
  );
  const controlPlane = params?.controlPlane || null;
  if (!params?.dryRun && controlPlane?.waveNumber !== undefined && controlPlane?.attempt) {
    recordAgentRunStarted(lanePaths, {
      waveNumber: controlPlane.waveNumber,
      attempt: controlPlane.attempt,
      runInfo: {
        ...params,
        runtimePath,
        lastExecutorId: result?.executorId || params?.agent?.executorResolved?.id || null,
      },
    });
  }
  return {
    ...result,
    runtimePath,
  };
}

export async function cleanupLaunchedRun(
  lanePaths,
  run,
  {
    terminateRuntimeFn = terminateAgentProcessRuntime,
    killSessionFn = killTmuxSessionIfExists,
  } = {},
) {
  const runtimeRecord = readRuntimeRecord(run);
  if (runtimeRecord && typeof runtimeRecord === "object") {
    await terminateRuntimeFn(runtimeRecord);
  }
  if (run?.sessionName) {
    await killSessionFn(lanePaths.tmuxSocketName, run.sessionName);
  }
}

export async function waitForWaveCompletion(
  lanePaths,
  agentRuns,
  timeoutMinutes,
  onProgress = null,
  options = {},
) {
  const result = await waitForWaveCompletionImpl(lanePaths, agentRuns, timeoutMinutes, onProgress, {
    collectUnexpectedSessionWarningsFn: collectUnexpectedSessionWarnings,
  });
  const controlPlane = options?.controlPlane || null;
  if (controlPlane?.waveNumber !== undefined && controlPlane?.attempt) {
    const failuresByAgentId = new Map(
      (result?.failures || []).map((failure) => [failure.agentId, failure]),
    );
    for (const runInfo of agentRuns || []) {
      recordAgentRunFinished(lanePaths, {
        waveNumber: controlPlane.waveNumber,
        attempt: controlPlane.attempt,
        runInfo,
        failure: failuresByAgentId.get(runInfo.agent.agentId) || null,
      });
    }
  }
  return result;
}

export function monitorWaveHumanFeedback({
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
  let changed = false;
  for (const request of requests) {
    const signature = feedbackStateSignature(request);
    if (feedbackStateByRequestId.get(request.id) === signature) {
      continue;
    }
    feedbackStateByRequestId.set(request.id, signature);
    changed = true;
    const question = request.question || "n/a";
    const context = request.context ? `; context=${request.context}` : "";
    const responseOperator = request.responseOperator || "human-operator";
    const responseText = request.responseText || "(empty response)";
    const escalationId = `escalation-${request.id}`;
    const existingEscalation =
      (fs.existsSync(triageLogPath)
        ? readMaterializedCoordinationState(triageLogPath).byId.get(escalationId)
        : null) ||
      readMaterializedCoordinationState(coordinationLogPath).byId.get(escalationId) ||
      null;
    const workflowUpdate = buildHumanFeedbackWorkflowUpdate({
      request,
      lane: lanePaths.lane,
      waveNumber,
      existingEscalation,
    });
    if (request.status === "pending") {
      if (workflowUpdate?.combinedEvent) {
        recordCombinedEvent(workflowUpdate.combinedEvent);
      }
      for (const line of workflowUpdate?.consoleLines || []) {
        console.warn(line);
      }
      if (workflowUpdate?.coordinationNotice) {
        appendCoordination(workflowUpdate.coordinationNotice);
      }
      if (coordinationLogPath) {
        for (const update of workflowUpdate?.coordinationUpdates || []) {
          appendCoordinationRecord(coordinationLogPath, update);
        }
      }
    } else if (request.status === "answered") {
      if (workflowUpdate?.combinedEvent) {
        recordCombinedEvent(workflowUpdate.combinedEvent);
      }
      if (workflowUpdate?.coordinationNotice) {
        appendCoordination(workflowUpdate.coordinationNotice);
      }
      if (coordinationLogPath) {
        if (fs.existsSync(triageLogPath)) {
          for (const update of workflowUpdate?.triageUpdates || []) {
            appendCoordinationRecord(triageLogPath, update);
          }
        }
        for (const update of workflowUpdate?.coordinationUpdates || []) {
          appendCoordinationRecord(coordinationLogPath, update);
        }
      }
    }
  }
  return changed;
}

export function syncLiveWaveSignals({
  lanePaths,
  wave,
  statusPayload,
  agentRuns,
  residentEnabled = false,
  recordCombinedEvent,
  appendCoordination,
}) {
  const activeSignalAgents = new Set(
    (Array.isArray(agentRuns) ? agentRuns : [])
      .filter((run) => agentUsesSignalHygiene(run?.agent))
      .map((run) => run.agent.agentId),
  );
  const syncResult = syncWaveSignalProjections({
    lanePaths,
    wave,
    statusPayload,
    includeResident: residentEnabled,
  });
  if (syncResult.wave?.changed) {
    appendWaveControlEvent(lanePaths, wave.wave, {
      entityType: "wave_signal",
      entityId: `wave-${wave.wave}`,
      action: "updated",
      source: "session-supervisor",
      actor: "session-supervisor",
      data: syncResult.wave.snapshot,
    });
    if (typeof recordCombinedEvent === "function") {
      recordCombinedEvent({
        level: syncResult.wave.snapshot.shouldWake ? "warn" : "info",
        message: `Wave signal updated: ${buildSignalStatusLine(syncResult.wave.snapshot)}`,
      });
    }
  }
  for (const agentResult of syncResult.agents || []) {
    if (!agentResult.changed) {
      continue;
    }
    appendWaveControlEvent(lanePaths, wave.wave, {
      entityType: "agent_signal",
      entityId: `wave-${wave.wave}-agent-${agentResult.agentId}`,
      action: "updated",
      source: "session-supervisor",
      actor: "session-supervisor",
      data: agentResult.snapshot,
    });
    if (
      agentResult.snapshot?.shouldWake &&
      activeSignalAgents.has(agentResult.agentId) &&
      typeof recordCombinedEvent === "function"
    ) {
      recordCombinedEvent({
        level: "info",
        agentId: agentResult.agentId,
        message: `Signal changed: ${buildSignalStatusLine(agentResult.snapshot, {
          lane: lanePaths.lane,
          wave: wave.wave,
          agentId: agentResult.agentId,
        })}`,
      });
    }
  }
  if (syncResult.resident?.changed) {
    appendWaveControlEvent(lanePaths, wave.wave, {
      entityType: "agent_signal",
      entityId: `wave-${wave.wave}-agent-resident-orchestrator`,
      action: "updated",
      source: "session-supervisor",
      actor: "session-supervisor",
      data: syncResult.resident.snapshot,
    });
    if (syncResult.resident.snapshot?.shouldWake && typeof recordCombinedEvent === "function") {
      recordCombinedEvent({
        level: "info",
        agentId: "ORCH",
        message: `Resident orchestrator signal changed: ${buildSignalStatusLine(
          syncResult.resident.snapshot,
          {
            lane: lanePaths.lane,
            wave: wave.wave,
            agentId: "resident-orchestrator",
          },
        )}`,
      });
    }
    if (
      syncResult.resident.snapshot?.shouldWake &&
      typeof appendCoordination === "function"
    ) {
      appendCoordination({
        event: "resident_signal_updated",
        waves: [wave.wave],
        status: "running",
        details: syncResult.resident.snapshot.reason || syncResult.resident.snapshot.signal,
        actionRequested:
          "Resident orchestrator should re-read the signal snapshot, shared summary, dashboard, and coordination log.",
      });
    }
  }
  return syncResult;
}
