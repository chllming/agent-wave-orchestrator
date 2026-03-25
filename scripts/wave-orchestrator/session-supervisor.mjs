import { spawnSync } from "node:child_process";
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
  TMUX_COMMAND_TIMEOUT_MS,
  toIsoTimestamp,
  writeJsonAtomic,
} from "./shared.mjs";
import {
  killTmuxSessionIfExists,
  terminalSurfaceUsesTerminalRegistry,
  pruneOrphanLaneTemporaryTerminalEntries,
} from "./terminals.mjs";
import {
  recordGlobalDashboardEvent,
} from "./dashboard-state.mjs";
import { buildHumanFeedbackWorkflowUpdate } from "./human-input-workflow.mjs";
import {
  collectUnexpectedSessionFailures as collectUnexpectedSessionFailuresImpl,
  launchAgentSession as launchAgentSessionImpl,
  waitForWaveCompletion as waitForWaveCompletionImpl,
} from "./launcher-runtime.mjs";

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

function listLaneTmuxSessionNames(lanePaths) {
  return listTmuxSessionNames(lanePaths).filter((sessionName) =>
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
  const sessionName = `${lanePaths.tmuxSessionPrefix}${wave.wave}_resident_orchestrator_${runTag}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  return {
    run: {
      agent,
      sessionName,
      promptPath: path.join(lanePaths.promptsDir, `${baseName}.prompt.md`),
      logPath: path.join(lanePaths.logsDir, `${baseName}.log`),
      statusPath: path.join(lanePaths.statusDir, `${baseName}.status`),
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
  const activeSessions = new Set(listLaneTmuxSessionNames(lanePaths));
  if (!activeSessions.has(run.sessionName)) {
    sessionState.closed = true;
    recordCombinedEvent({
      level: "warn",
      agentId: run.agent.agentId,
      message:
        "Resident orchestrator session disappeared before writing a status file; launcher continues as the control plane.",
    });
    appendCoordination({
      event: "resident_orchestrator_missing",
      waves: [waveNumber],
      status: "warn",
      details: `tmux session ${run.sessionName} disappeared before ${path.relative(REPO_ROOT, run.statusPath)} was written.`,
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

export function runTmux(lanePaths, args, description) {
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

export function cleanupLaneTmuxSessions(lanePaths, { excludeSessionNames = new Set() } = {}) {
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

export function launchWaveDashboardSession(lanePaths, { sessionName, dashboardPath, messageBoardPath }) {
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

export async function launchAgentSession(lanePaths, params) {
  const result = await launchAgentSessionImpl(lanePaths, params, { runTmuxFn: runTmux });
  const controlPlane = params?.controlPlane || null;
  if (!params?.dryRun && controlPlane?.waveNumber !== undefined && controlPlane?.attempt) {
    recordAgentRunStarted(lanePaths, {
      waveNumber: controlPlane.waveNumber,
      attempt: controlPlane.attempt,
      runInfo: {
        ...params,
        lastExecutorId: result?.executorId || params?.agent?.executorResolved?.id || null,
      },
    });
  }
  return result;
}

export async function waitForWaveCompletion(
  lanePaths,
  agentRuns,
  timeoutMinutes,
  onProgress = null,
  options = {},
) {
  const result = await waitForWaveCompletionImpl(lanePaths, agentRuns, timeoutMinutes, onProgress, {
    collectUnexpectedSessionFailuresFn: collectUnexpectedSessionFailures,
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
