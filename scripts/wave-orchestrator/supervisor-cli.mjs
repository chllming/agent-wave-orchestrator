import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildLanePaths, ensureDirectory, PACKAGE_ROOT, REPO_ROOT, readFileTail, readJsonOrNull, readStatusRecordIfPresent, shellQuote, sleep, toIsoTimestamp, sanitizeAdhocRunId, sanitizeLaneName, parsePositiveInt, parseNonNegativeInt, writeJsonAtomic } from "./shared.mjs";
import { loadWaveConfig } from "./config.mjs";
import { attachSession as attachTmuxSession } from "./tmux-adapter.mjs";
import {
  readLauncherProgress,
} from "./launcher-progress.mjs";
import { readRunState as readWaveRunState } from "./wave-files.mjs";

const DEFAULT_SUPERVISOR_POLL_MS = 2000;
const DEFAULT_SUPERVISOR_LEASE_MS = 15000;
const DEFAULT_SUPERVISOR_RESUME_LIMIT = 1;
const SUPERVISOR_STATUS_VALUES = new Set(["pending", "running", "completed", "failed"]);

export function buildSupervisorPaths(lanePaths) {
  const rootDir = path.join(lanePaths.controlDir, "supervisor");
  return {
    rootDir,
    runsDir: path.join(rootDir, "runs"),
    lockPath: path.join(rootDir, "daemon.lock"),
  };
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

function generateRunId() {
  return `run-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function parseLauncherContext(argv) {
  const config = loadWaveConfig();
  const context = {
    project: config.defaultProject,
    lane: "main",
    adhocRunId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project") {
      context.project = String(argv[index + 1] || "").trim() || context.project;
      index += 1;
    } else if (arg === "--lane") {
      context.lane = sanitizeLaneName(argv[index + 1]);
      index += 1;
    } else if (arg === "--adhoc-run") {
      context.adhocRunId = sanitizeAdhocRunId(argv[index + 1]);
      index += 1;
    }
  }
  return context;
}

function runDirForId(paths, runId) {
  return path.join(paths.runsDir, runId);
}

export function supervisorRunDirForId(paths, runId) {
  return runDirForId(paths, runId);
}

function statePathForRun(paths, runId) {
  return path.join(runDirForId(paths, runId), "state.json");
}

export function supervisorStatePathForRun(paths, runId) {
  return statePathForRun(paths, runId);
}

function requestPathForRun(paths, runId) {
  return path.join(runDirForId(paths, runId), "request.json");
}

function launcherStatusPathForRun(paths, runId) {
  return path.join(runDirForId(paths, runId), "launcher-status.json");
}

function launcherLogPathForRun(paths, runId) {
  return path.join(runDirForId(paths, runId), "launcher.log");
}

function launcherProgressPathForRun(paths, runId) {
  return path.join(runDirForId(paths, runId), "launcher-progress.json");
}

function agentRuntimeDirForRun(paths, runId) {
  return path.join(runDirForId(paths, runId), "agents");
}

export function supervisorAgentRuntimePathForRun(paths, runId, agentId) {
  return path.join(agentRuntimeDirForRun(paths, runId), `${agentId}.runtime.json`);
}

function normalizeRunState(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const status = String(payload.status || "").trim().toLowerCase();
  return {
    ...payload,
    status: SUPERVISOR_STATUS_VALUES.has(status) ? status : "pending",
  };
}

function readRunState(statePath) {
  return normalizeRunState(readJsonOrNull(statePath));
}

function writeRunState(statePath, payload) {
  writeJsonAtomic(statePath, payload);
  return payload;
}

function ensureSupervisorDirectories(paths, runId = null) {
  ensureDirectory(paths.rootDir);
  ensureDirectory(paths.runsDir);
  if (runId) {
    ensureDirectory(runDirForId(paths, runId));
    ensureDirectory(agentRuntimeDirForRun(paths, runId));
  }
}

function eventsPathForRun(paths, runId) {
  return path.join(runDirForId(paths, runId), "events.jsonl");
}

function appendSupervisorEvent(paths, runId, event) {
  fs.appendFileSync(
    eventsPathForRun(paths, runId),
    `${JSON.stringify({ recordedAt: toIsoTimestamp(), ...event })}\n`,
    "utf8",
  );
}

function parseWaveBoundsFromLauncherArgs(launcherArgs = []) {
  let startWave = null;
  let endWave = null;
  for (let index = 0; index < launcherArgs.length; index += 1) {
    const arg = launcherArgs[index];
    if (arg === "--start-wave") {
      startWave = Number.parseInt(String(launcherArgs[index + 1] || ""), 10);
      index += 1;
    } else if (arg === "--end-wave") {
      endWave = Number.parseInt(String(launcherArgs[index + 1] || ""), 10);
      index += 1;
    }
  }
  return {
    startWave: Number.isFinite(startWave) ? startWave : null,
    endWave: Number.isFinite(endWave) ? endWave : null,
  };
}

function parseLauncherWaveSelection(launcherArgs = []) {
  const { startWave, endWave } = parseWaveBoundsFromLauncherArgs(launcherArgs);
  return {
    startWave,
    endWave,
    autoNext: launcherArgsInclude(launcherArgs, "--auto-next"),
  };
}

function deriveActiveWaveFromLauncherArgs(launcherArgs = []) {
  const { startWave, endWave } = parseWaveBoundsFromLauncherArgs(launcherArgs);
  if (Number.isFinite(startWave) && Number.isFinite(endWave) && startWave === endWave) {
    return startWave;
  }
  return Number.isFinite(startWave) ? startWave : null;
}

function launcherArgsInclude(launcherArgs = [], flag) {
  return Array.isArray(launcherArgs) && launcherArgs.includes(flag);
}

function selectedWavesFromLauncherArgs(launcherArgs = []) {
  const { startWave, endWave, autoNext } = parseLauncherWaveSelection(launcherArgs);
  if (autoNext) {
    return [];
  }
  if (Number.isFinite(startWave) && Number.isFinite(endWave) && endWave >= startWave) {
    return Array.from({ length: endWave - startWave + 1 }, (_, index) => startWave + index);
  }
  return [];
}

function activeWaveFromState(state) {
  if (Number.isFinite(Number(state?.activeWave))) {
    return Number(state.activeWave);
  }
  return deriveActiveWaveFromLauncherArgs(state?.launcherArgs);
}

function buildAgentRuntimeSummary(runtimeRecords = []) {
  return runtimeRecords.map((record) => ({
    agentId: record.agentId || null,
    pid: record.pid || record.executorPid || record.runnerPid || null,
    pgid: record.pgid || null,
    runnerPid: record.runnerPid || null,
    executorPid: record.executorPid || null,
    lastHeartbeatAt: record.lastHeartbeatAt || null,
    exitCode: record.exitCode ?? null,
    terminalDisposition: record.terminalDisposition || null,
    sessionBackend: record.sessionBackend || "process",
    attachMode: record.attachMode || "log-tail",
  }));
}

function buildSupervisorLockPayload(context, { supervisorId = null } = {}) {
  const heartbeatAt = toIsoTimestamp();
  return {
    supervisorId: supervisorId || `supervisor-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
    pid: process.pid,
    project: context.project,
    lane: context.lane,
    adhocRunId: context.adhocRunId || null,
    acquiredAt: heartbeatAt,
    heartbeatAt,
    leaseExpiresAt: new Date(Date.now() + DEFAULT_SUPERVISOR_LEASE_MS).toISOString(),
  };
}

function supervisorLeaseIsFresh(payload) {
  const leaseExpiresAt = Date.parse(String(payload?.leaseExpiresAt || ""));
  return Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now();
}

function writeSupervisorLock(lockPath, payload) {
  fs.writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function acquireSupervisorLock(lockPath, context) {
  ensureDirectory(path.dirname(lockPath));
  const payload = buildSupervisorLockPayload(context);
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
    if (isProcessAlive(existingPid) && supervisorLeaseIsFresh(existing)) {
      return null;
    }
    fs.rmSync(lockPath, { force: true });
    return acquireSupervisorLock(lockPath, context);
  }
}

function releaseSupervisorLock(lockPath) {
  fs.rmSync(lockPath, { force: true });
}

function launcherWrapperCommand({ launcherArgs, launcherStatusPath, launcherLogPath }) {
  const entrypoint = path.join(PACKAGE_ROOT, "scripts", "wave-launcher.mjs");
  const argv = launcherArgs.map((arg) => shellQuote(arg)).join(" ");
  return [
    `cd ${shellQuote(REPO_ROOT)}`,
    `node ${shellQuote(entrypoint)} ${argv} >> ${shellQuote(launcherLogPath)} 2>&1`,
    "status=$?",
    `node -e ${shellQuote(
      "const fs=require('node:fs'); const file=process.argv[1]; const payload={exitCode:Number(process.argv[2]),completedAt:new Date().toISOString()}; fs.writeFileSync(file, JSON.stringify(payload, null, 2)+'\\n', 'utf8');",
    )} ${shellQuote(launcherStatusPath)} \"$status\"`,
    "exit 0",
  ].join("\n");
}

function stripLauncherArgsForResume(launcherArgs = []) {
  const stripped = [];
  for (let index = 0; index < launcherArgs.length; index += 1) {
    const arg = launcherArgs[index];
    if (["--start-wave", "--end-wave"].includes(arg)) {
      index += 1;
      continue;
    }
    if (["--auto-next", "--resume-control-state"].includes(arg)) {
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

function buildResumedLauncherArgs(state, progressJournal) {
  const baseLauncherArgs = Array.isArray(state?.launcherArgs) ? state.launcherArgs : [];
  const { startWave, endWave, autoNext } = parseLauncherWaveSelection(baseLauncherArgs);
  const waveNumber = Number.isFinite(Number(progressJournal?.waveNumber))
    ? Number(progressJournal.waveNumber)
    : Number.isFinite(Number(state?.activeWave))
      ? Number(state.activeWave)
      : null;
  if (!Number.isFinite(waveNumber)) {
    return null;
  }
  if (Number.isFinite(endWave) && endWave < waveNumber) {
    return null;
  }
  const resumedArgs = [
    ...stripLauncherArgsForResume(baseLauncherArgs),
  ];
  if (autoNext) {
    resumedArgs.push("--auto-next");
    if (Number.isFinite(endWave)) {
      resumedArgs.push("--end-wave", String(endWave));
    }
  } else {
    resumedArgs.push("--start-wave", String(waveNumber));
    if (Number.isFinite(endWave)) {
      resumedArgs.push("--end-wave", String(endWave));
    }
  }
  resumedArgs.push("--resume-control-state");
  return resumedArgs;
}

export function startSupervisorRun(
  state,
  statePath,
  paths,
  { supervisorId = null, launcherArgs = null, recoveryState = "healthy", resumeAction = null } = {},
) {
  const launcherStatusPath = launcherStatusPathForRun(paths, state.runId);
  const launcherLogPath = launcherLogPathForRun(paths, state.runId);
  fs.rmSync(launcherStatusPath, { force: true });
  const effectiveLauncherArgs =
    Array.isArray(launcherArgs) && launcherArgs.length > 0
      ? launcherArgs
      : Array.isArray(state.launcherArgs)
        ? state.launcherArgs
        : [];
  const child = spawn(
    "bash",
    ["-lc", launcherWrapperCommand({
      launcherArgs: effectiveLauncherArgs,
      launcherStatusPath,
      launcherLogPath,
    })],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        WAVE_SUPERVISOR_RUN_ID: state.runId,
      },
    },
  );
  child.unref();
  appendSupervisorEvent(paths, state.runId, {
    type: "launcher-started",
    runId: state.runId,
    launcherPid: child.pid,
    resumed: Array.isArray(launcherArgs) && launcherArgs.length > 0,
  });
  return writeRunState(statePath, {
    ...state,
    launcherArgs: effectiveLauncherArgs,
    status: "running",
    startedAt: state.startedAt || toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
    supervisorId: supervisorId || state.supervisorId || null,
    leaseExpiresAt: new Date(Date.now() + DEFAULT_SUPERVISOR_LEASE_MS).toISOString(),
    launcherPid: child.pid,
    launcherStatusPath,
    launcherLogPath,
    activeWave: state.activeWave ?? deriveActiveWaveFromLauncherArgs(effectiveLauncherArgs),
    terminalDisposition: "running",
    agentRuntimeSummary: Array.isArray(state.agentRuntimeSummary) ? state.agentRuntimeSummary : [],
    sessionBackend: "process",
    recoveryState,
    resumeAction,
    resumeAttempts:
      Array.isArray(launcherArgs) && launcherArgs.length > 0
        ? Number(state.resumeAttempts || 0) + 1
        : Number(state.resumeAttempts || 0),
  });
}

function readAgentRuntimeRecords(paths, runId) {
  const dir = agentRuntimeDirForRun(paths, runId);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".runtime.json"))
    .map((entry) => readJsonOrNull(path.join(dir, entry.name)))
    .filter((record) => record && typeof record === "object");
}

function runtimeHeartbeatIsFresh(runtimeRecord, freshnessMs = DEFAULT_SUPERVISOR_LEASE_MS * 2) {
  const heartbeatAt = Date.parse(String(runtimeRecord?.lastHeartbeatAt || ""));
  return Number.isFinite(heartbeatAt) && heartbeatAt >= Date.now() - freshnessMs;
}

function runtimeRecordIndicatesLiveWork(runtimeRecord) {
  return (
    isProcessAlive(
      Number.parseInt(
        String(runtimeRecord?.executorPid ?? runtimeRecord?.pid ?? runtimeRecord?.runnerPid ?? ""),
        10,
      ),
    ) ||
    runtimeHeartbeatIsFresh(runtimeRecord)
  );
}

function recoverCompletedFromRunState(state, progressJournal, lanePaths) {
  const selectedWaves = selectedWavesFromLauncherArgs(
    Array.isArray(state?.launcherArgs) ? state.launcherArgs : [],
  );
  if (selectedWaves.length === 0) {
    return null;
  }
  const progressPhase = String(progressJournal?.phase || "").trim().toLowerCase();
  if (progressPhase && !["wave-completed", "completed"].includes(progressPhase)) {
    return null;
  }
  const journalWaveNumber = Number.parseInt(String(progressJournal?.waveNumber ?? ""), 10);
  const finalWaveNumber = selectedWaves[selectedWaves.length - 1];
  if (Number.isFinite(journalWaveNumber) && journalWaveNumber !== finalWaveNumber) {
    return null;
  }
  const runState = readWaveRunState(lanePaths.defaultRunStatePath);
  const completedWaves = new Set(
    (Array.isArray(runState?.completedWaves) ? runState.completedWaves : []).map((waveNumber) =>
      Number(waveNumber),
    ),
  );
  if (!selectedWaves.every((waveNumber) => completedWaves.has(Number(waveNumber)))) {
    return null;
  }
  return {
    selectedWaves,
    finalWaveNumber,
  };
}

export function reconcileSupervisorRun(state, statePath) {
  const runId = state?.runId || path.basename(path.dirname(statePath));
  const lanePaths = buildLanePaths(state?.lane || "main", {
    project: state?.project,
    adhocRunId: state?.adhocRunId,
  });
  const paths = buildSupervisorPaths(lanePaths);
  const launcherStatus = state?.launcherStatusPath ? readJsonOrNull(state.launcherStatusPath) : null;
  const runtimeRecords = readAgentRuntimeRecords(paths, runId);
  const liveRuntimeRecords = runtimeRecords.filter((record) => runtimeRecordIndicatesLiveWork(record));
  const progressJournal = readLauncherProgress(
    launcherProgressPathForRun(paths, runId),
    { runId, waveNumber: state?.activeWave ?? null },
  );
  const launcherPid = Number.parseInt(String(state?.launcherPid ?? ""), 10);
  const launcherAlive = isProcessAlive(launcherPid);
  if (launcherStatus && typeof launcherStatus === "object") {
    const exitCode = Number.parseInt(String(launcherStatus.exitCode ?? ""), 10);
    appendSupervisorEvent(paths, runId, {
      type: "launcher-status-reconciled",
      runId,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
    });
    return writeRunState(statePath, {
      ...state,
      status: exitCode === 0 ? "completed" : "failed",
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      completedAt: launcherStatus.completedAt || toIsoTimestamp(),
      updatedAt: toIsoTimestamp(),
      terminalDisposition: exitCode === 0 ? "completed" : "failed",
      agentRuntimeSummary: buildAgentRuntimeSummary(runtimeRecords),
      sessionBackend: "process",
      recoveryState: "healthy",
      resumeAction: null,
    });
  }
  if (state?.status === "running" && launcherAlive) {
    return writeRunState(statePath, {
      ...state,
      updatedAt: toIsoTimestamp(),
      terminalDisposition: "running",
      agentRuntimeSummary: buildAgentRuntimeSummary(runtimeRecords),
      sessionBackend: "process",
      recoveryState: "healthy",
      resumeAction: null,
    });
  }
  if (state?.status === "running" && liveRuntimeRecords.length > 0) {
    if (state?.terminalDisposition !== "launcher-lost-agents-running") {
      appendSupervisorEvent(paths, runId, {
        type: "agent-runtime-adopted",
        runId,
        agentIds: liveRuntimeRecords.map((record) => record.agentId).filter(Boolean),
      });
    }
    return writeRunState(statePath, {
      ...state,
      updatedAt: toIsoTimestamp(),
      terminalDisposition: "launcher-lost-agents-running",
      agentRuntimeSummary: buildAgentRuntimeSummary(runtimeRecords),
      sessionBackend: "process",
      recoveryState: "degraded",
      resumeAction: "wait-for-live-agents",
      detail: "Launcher exited while agent runtime work is still live.",
    });
  }
  if (
    state?.status === "running" &&
    progressJournal?.finalized === true &&
    ["completed", "failed"].includes(String(progressJournal.finalDisposition || ""))
  ) {
    const exitCode = Number.parseInt(String(progressJournal.exitCode ?? ""), 10);
    appendSupervisorEvent(paths, runId, {
      type: "launcher-status-reconciled",
      runId,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      source: "progress-journal",
    });
    return writeRunState(statePath, {
      ...state,
      status: progressJournal.finalDisposition === "completed" ? "completed" : "failed",
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      completedAt: progressJournal.updatedAt || toIsoTimestamp(),
      updatedAt: toIsoTimestamp(),
      terminalDisposition: progressJournal.finalDisposition,
      agentRuntimeSummary: buildAgentRuntimeSummary(runtimeRecords),
      activeWave: progressJournal.waveNumber ?? state?.activeWave ?? null,
      sessionBackend: "process",
      recoveryState: "recovered-from-progress",
      resumeAction: null,
      detail:
        progressJournal.finalDisposition === "completed"
          ? "Recovered final supervisor state from launcher progress journal."
          : "Recovered terminal failure from launcher progress journal.",
    });
  }
  if (state?.status === "running" && !launcherAlive) {
    const recoveredCompletion = recoverCompletedFromRunState(state, progressJournal, lanePaths);
    if (recoveredCompletion) {
      appendSupervisorEvent(paths, runId, {
        type: "launcher-status-reconciled",
        runId,
        exitCode: 0,
        source: "run-state",
      });
      return writeRunState(statePath, {
        ...state,
        status: "completed",
        exitCode: 0,
        completedAt: toIsoTimestamp(),
        updatedAt: toIsoTimestamp(),
        terminalDisposition: "completed",
        agentRuntimeSummary: buildAgentRuntimeSummary(runtimeRecords),
        activeWave: recoveredCompletion.finalWaveNumber,
        sessionBackend: "process",
        recoveryState: "recovered-from-run-state",
        resumeAction: null,
        detail: `Recovered completed supervisor state from canonical run-state after launcher exit for waves ${recoveredCompletion.selectedWaves.join(", ")}.`,
      });
    }
    const resumedArgs = buildResumedLauncherArgs(state, progressJournal);
    if (resumedArgs && Number(state?.resumeAttempts || 0) < DEFAULT_SUPERVISOR_RESUME_LIMIT) {
      return startSupervisorRun(
        {
          ...state,
          activeWave: progressJournal?.waveNumber ?? state?.activeWave ?? null,
        },
        statePath,
        paths,
        {
          supervisorId: state?.supervisorId || null,
          launcherArgs: resumedArgs,
          recoveryState: "resuming",
          resumeAction: "resume-current-wave",
        },
      );
    }
    appendSupervisorEvent(paths, runId, {
      type: "failed-before-status",
      runId,
      launcherPid: state.launcherPid || null,
    });
    return writeRunState(statePath, {
      ...state,
      status: "failed",
      exitCode: null,
      completedAt: toIsoTimestamp(),
      updatedAt: toIsoTimestamp(),
      detail: "Launcher exited before writing supervisor status.",
      terminalDisposition: "launcher-lost-before-status",
      agentRuntimeSummary: buildAgentRuntimeSummary(runtimeRecords),
      sessionBackend: "process",
      recoveryState: "failed",
      resumeAction: null,
    });
  }
  if (runtimeRecords.length === 0) {
    return state;
  }
  return writeRunState(statePath, {
    ...state,
    updatedAt: toIsoTimestamp(),
    agentRuntimeSummary: buildAgentRuntimeSummary(runtimeRecords),
    sessionBackend: "process",
  });
}

function supervisorStatePathForRunId(runId, context = {}) {
  if (!runId || !context?.lane) {
    return null;
  }
  const lanePaths = buildLanePaths(context.lane, {
    project: context.project,
    adhocRunId: context.adhocRunId,
  });
  return statePathForRun(buildSupervisorPaths(lanePaths), runId);
}

export function findSupervisorRunState(runId, context = {}) {
  const statePath = supervisorStatePathForRunId(runId, context);
  if (!statePath || !fs.existsSync(statePath)) {
    return null;
  }
  return {
    statePath,
    runDir: path.dirname(statePath),
    state: readRunState(statePath),
  };
}

function formatRunState(state) {
  const exitCode = state?.exitCode ?? "n/a";
  return [
    `run_id=${state?.runId || "unknown"}`,
    `status=${state?.status || "unknown"}`,
    `lane=${state?.lane || "unknown"}`,
    `project=${state?.project || "unknown"}`,
    `pid=${state?.launcherPid || "none"}`,
    `exit_code=${exitCode}`,
    `terminal_disposition=${state?.terminalDisposition || "unknown"}`,
    `recovery_state=${state?.recoveryState || "unknown"}`,
    `resume_action=${state?.resumeAction || "none"}`,
  ].join(" ");
}

function parseSubmitArgs(argv) {
  const options = {
    json: false,
    help: false,
    launcherArgs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      options.launcherArgs.push(arg);
    }
  }
  return options;
}

function parseSupervisorArgs(argv) {
  const options = {
    project: loadWaveConfig().defaultProject,
    lane: "main",
    adhocRunId: null,
    once: false,
    pollMs: DEFAULT_SUPERVISOR_POLL_MS,
    timeoutSeconds: 30,
    json: false,
    runId: "",
    projectProvided: false,
    laneProvided: false,
    adhocRunProvided: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project") {
      options.project = String(argv[++index] || "").trim() || options.project;
      options.projectProvided = true;
    } else if (arg === "--lane") {
      options.lane = sanitizeLaneName(argv[++index]);
      options.laneProvided = true;
    } else if (arg === "--adhoc-run") {
      options.adhocRunId = sanitizeAdhocRunId(argv[++index]);
      options.adhocRunProvided = true;
    } else if (arg === "--once") {
      options.once = true;
    } else if (arg === "--poll-ms") {
      options.pollMs = parsePositiveInt(argv[++index], "--poll-ms");
    } else if (arg === "--timeout-seconds") {
      options.timeoutSeconds = parseNonNegativeInt(argv[++index], "--timeout-seconds");
    } else if (arg === "--run-id") {
      options.runId = String(argv[++index] || "").trim();
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg && arg !== "--") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage(command) {
  if (command === "submit") {
    console.log("Usage: wave submit [launcher options] [--json]");
    return;
  }
  if (command === "supervise") {
    console.log("Usage: wave supervise [--project <id>] [--lane <lane>] [--adhoc-run <id>] [--poll-ms <n>] [--once]");
    return;
  }
  if (command === "status") {
    console.log("Usage: wave status --run-id <id> --project <id> --lane <lane> [--adhoc-run <id>] [--json]");
    return;
  }
  if (command === "wait") {
    console.log("Usage: wave wait --run-id <id> --project <id> --lane <lane> [--adhoc-run <id>] [--timeout-seconds <n>] [--json]");
    return;
  }
  if (command === "attach") {
    console.log("Usage: wave attach --run-id <id> --project <id> --lane <lane> [--adhoc-run <id>] (--agent <id> | --dashboard)");
  }
}

function parseAttachArgs(argv) {
  const options = {
    project: loadWaveConfig().defaultProject,
    lane: "main",
    adhocRunId: null,
    runId: "",
    json: false,
    help: false,
    projectProvided: false,
    laneProvided: false,
    adhocRunProvided: false,
    agentId: "",
    dashboard: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project") {
      options.project = String(argv[++index] || "").trim() || options.project;
      options.projectProvided = true;
    } else if (arg === "--lane") {
      options.lane = sanitizeLaneName(argv[++index]);
      options.laneProvided = true;
    } else if (arg === "--adhoc-run") {
      options.adhocRunId = sanitizeAdhocRunId(argv[++index]);
      options.adhocRunProvided = true;
    } else if (arg === "--run-id") {
      options.runId = String(argv[++index] || "").trim();
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--agent") {
      options.agentId = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg === "--dashboard") {
      options.dashboard = true;
    } else if (arg && arg !== "--") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function ensureSupervisorRunning(context) {
  const lanePaths = buildLanePaths(context.lane, {
    project: context.project,
    adhocRunId: context.adhocRunId,
  });
  const paths = buildSupervisorPaths(lanePaths);
  ensureSupervisorDirectories(paths);
  const existing = readJsonOrNull(paths.lockPath);
  const existingPid = Number.parseInt(String(existing?.pid ?? ""), 10);
  if (isProcessAlive(existingPid) && supervisorLeaseIsFresh(existing)) {
    return existingPid;
  }
  const args = [
    path.join(PACKAGE_ROOT, "scripts", "wave.mjs"),
    "supervise",
    "--project",
    context.project,
    "--lane",
    context.lane,
    "--poll-ms",
    String(DEFAULT_SUPERVISOR_POLL_MS),
  ];
  if (context.adhocRunId) {
    args.push("--adhoc-run", context.adhocRunId);
  }
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child.pid;
}

export function submitLauncherRun(argv) {
  const context = parseLauncherContext(argv);
  const lanePaths = buildLanePaths(context.lane, {
    project: context.project,
    adhocRunId: context.adhocRunId,
  });
  const paths = buildSupervisorPaths(lanePaths);
  const runId = generateRunId();
  ensureSupervisorDirectories(paths, runId);
  const state = {
    runId,
    project: context.project,
    lane: context.lane,
    adhocRunId: context.adhocRunId || null,
    status: "pending",
    submittedAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
    launcherArgs: argv,
    launcherPid: null,
    exitCode: null,
    activeWave: deriveActiveWaveFromLauncherArgs(argv),
    terminalDisposition: "pending",
    agentRuntimeSummary: [],
    sessionBackend: "process",
    recoveryState: "pending",
    resumeAction: null,
    resumeAttempts: 0,
  };
  writeJsonAtomic(requestPathForRun(paths, runId), state);
  writeRunState(statePathForRun(paths, runId), state);
  const supervisorPid = ensureSupervisorRunning(context);
  appendSupervisorEvent(paths, runId, {
    type: "submitted",
    runId,
    project: context.project,
    lane: context.lane,
    adhocRunId: context.adhocRunId || null,
  });
  return {
    runId,
    project: context.project,
    lane: context.lane,
    adhocRunId: context.adhocRunId || null,
    supervisorPid,
    statePath: statePathForRun(paths, runId),
  };
}

function pendingRunStates(paths) {
  ensureSupervisorDirectories(paths);
  const runDirs = fs.readdirSync(paths.runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(paths.runsDir, entry.name));
  return runDirs
    .map((runDir) => {
      const statePath = path.join(runDir, "state.json");
      return {
        statePath,
        state: readRunState(statePath),
      };
    })
    .filter((entry) => entry.state)
    .sort((left, right) => String(left.state.submittedAt || "").localeCompare(String(right.state.submittedAt || "")));
}

export async function runSupervisorLoop(options) {
  const lanePaths = buildLanePaths(options.lane, {
    project: options.project,
    adhocRunId: options.adhocRunId,
  });
  const paths = buildSupervisorPaths(lanePaths);
  ensureSupervisorDirectories(paths);
  const lock = acquireSupervisorLock(paths.lockPath, options);
  if (!lock) {
    return { alreadyRunning: true };
  }
  try {
    const runningStates = pendingRunStates(paths).filter((entry) => entry.state.status === "running");
    for (const entry of runningStates) {
      appendSupervisorEvent(paths, entry.state.runId, {
        type: "daemon-adopted",
        runId: entry.state.runId,
        supervisorId: lock.supervisorId,
      });
      writeRunState(entry.statePath, {
        ...entry.state,
        supervisorId: lock.supervisorId,
        leaseExpiresAt: lock.leaseExpiresAt,
        updatedAt: toIsoTimestamp(),
      });
      reconcileSupervisorRun(entry.state, entry.statePath);
    }
    while (true) {
      writeSupervisorLock(paths.lockPath, {
        ...lock,
        heartbeatAt: toIsoTimestamp(),
        leaseExpiresAt: new Date(Date.now() + DEFAULT_SUPERVISOR_LEASE_MS).toISOString(),
      });
      const entries = pendingRunStates(paths);
      let running = false;
      for (const entry of entries) {
        if (entry.state.status === "running") {
          reconcileSupervisorRun(entry.state, entry.statePath);
        }
      }
      const refreshedEntries = pendingRunStates(paths);
      for (const entry of refreshedEntries) {
        if (entry.state.status === "running") {
          running = true;
          break;
        }
      }
      if (!running) {
        const nextPending = refreshedEntries.find((entry) => entry.state.status === "pending");
        if (nextPending) {
          appendSupervisorEvent(paths, nextPending.state.runId, {
            type: "daemon-claimed",
            runId: nextPending.state.runId,
            supervisorId: lock.supervisorId,
          });
          startSupervisorRun(nextPending.state, nextPending.statePath, paths, {
            supervisorId: lock.supervisorId,
          });
          running = true;
        }
      }
      if (options.once && !running && !refreshedEntries.some((entry) => entry.state.status === "pending")) {
        break;
      }
      await sleep(options.pollMs);
    }
    return { alreadyRunning: false };
  } finally {
    releaseSupervisorLock(paths.lockPath);
  }
}

export async function waitForRunState(options) {
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  while (true) {
    const located = findSupervisorRunState(options.runId, options);
    if (!located?.state) {
      throw new Error(`Run ${options.runId} not found.`);
    }
    if (["completed", "failed"].includes(located.state.status)) {
      return located;
    }
    if (Date.now() >= deadline) {
      return located;
    }
    await sleep(DEFAULT_SUPERVISOR_POLL_MS);
  }
}

function compareSupervisorEntries(left, right) {
  const rank = {
    running: 0,
    pending: 1,
    failed: 2,
    completed: 3,
  };
  const leftRank = rank[left?.state?.status] ?? 99;
  const rightRank = rank[right?.state?.status] ?? 99;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  const leftUpdatedAt = Date.parse(String(left?.state?.updatedAt || left?.state?.submittedAt || ""));
  const rightUpdatedAt = Date.parse(String(right?.state?.updatedAt || right?.state?.submittedAt || ""));
  return rightUpdatedAt - leftUpdatedAt;
}

export function summarizeSupervisorStateForWave(lanePaths, waveNumber, { agentId = "" } = {}) {
  const paths = buildSupervisorPaths(lanePaths);
  if (!fs.existsSync(paths.runsDir)) {
    return null;
  }
  const matching = pendingRunStates(paths).filter((entry) => activeWaveFromState(entry.state) === Number(waveNumber));
  if (matching.length === 0) {
    return null;
  }
  const selected = matching.sort(compareSupervisorEntries)[0];
  const runtimeSummary = Array.isArray(selected.state?.agentRuntimeSummary)
    ? selected.state.agentRuntimeSummary
    : [];
  return {
    runId: selected.state.runId,
    status: selected.state.status || "pending",
    terminalDisposition: selected.state.terminalDisposition || null,
    launcherPid: selected.state.launcherPid || null,
    exitCode: selected.state.exitCode ?? null,
    detail: selected.state.detail || null,
    updatedAt: selected.state.updatedAt || null,
    leaseExpiresAt: selected.state.leaseExpiresAt || null,
    supervisorId: selected.state.supervisorId || null,
    sessionBackend: selected.state.sessionBackend || "process",
    recoveryState: selected.state.recoveryState || null,
    resumeAction: selected.state.resumeAction || null,
    agentRuntimeSummary: agentId
      ? runtimeSummary.filter((record) => record?.agentId === agentId)
      : runtimeSummary,
  };
}

function runtimeRecordForAgent(runDir, agentId) {
  const runtimePath = path.join(runDir, "agents", `${agentId}.runtime.json`);
  if (!fs.existsSync(runtimePath)) {
    return null;
  }
  return {
    runtimePath,
    runtime: readJsonOrNull(runtimePath),
  };
}

async function attachAgentRuntimeSession(options) {
  const located = findSupervisorRunState(options.runId, options);
  if (!located?.state) {
    throw new Error(`Run ${options.runId} not found.`);
  }
  const runtimeEntry = runtimeRecordForAgent(located.runDir, options.agentId);
  const runtime = runtimeEntry?.runtime;
  if (!runtime || typeof runtime !== "object") {
    throw new Error(`No runtime record found for agent ${options.agentId}.`);
  }
  const attachMode = String(runtime.attachMode || "log-tail").trim() || "log-tail";
  const sessionName = String(runtime.tmuxSessionName || runtime.sessionName || "").trim();
  const lanePaths = buildLanePaths(options.lane, {
    project: options.project,
    adhocRunId: options.adhocRunId,
  });
  if (attachMode === "session" && sessionName) {
    await attachTmuxSession(lanePaths.tmuxSocketName, sessionName);
    return;
  }
  const logPath = String(runtime.logPath || "").trim();
  if (!logPath) {
    throw new Error(`No log path recorded for agent ${options.agentId}.`);
  }
  const terminal =
    Boolean(readStatusRecordIfPresent(String(runtime.statusPath || "").trim())) ||
    ["completed", "failed", "terminated"].includes(String(runtime.terminalDisposition || ""));
  if (terminal) {
    const tail = readFileTail(logPath, 12000);
    if (tail) {
      process.stdout.write(tail.endsWith("\n") ? tail : `${tail}\n`);
    }
    return;
  }
  const result = spawn("tail", ["-n", "200", "-F", logPath], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  await new Promise((resolve, reject) => {
    result.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`log follow exited ${code ?? 1}.`));
    });
    result.on("error", (error) => {
      reject(new Error(`log follow failed: ${error.message}`));
    });
  });
}

function attachDashboard(options) {
  const args = [
    path.join(PACKAGE_ROOT, "scripts", "wave-dashboard.mjs"),
    "--project",
    options.project,
    "--lane",
    options.lane,
    "--attach",
    "current",
  ];
  const result = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return new Promise((resolve, reject) => {
    result.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`dashboard attach exited ${code ?? 1}.`));
    });
    result.on("error", (error) => {
      reject(new Error(`dashboard attach failed: ${error.message}`));
    });
  });
}

export async function runSupervisorCli(command, argv) {
  if (command === "submit") {
    const submitOptions = parseSubmitArgs(argv);
    if (submitOptions.help) {
      printUsage(command);
      return;
    }
    const result = submitLauncherRun(submitOptions.launcherArgs);
    if (submitOptions.json) {
      console.log(JSON.stringify({
        runId: result.runId,
        project: result.project,
        lane: result.lane,
        adhocRunId: result.adhocRunId,
        statePath: path.relative(REPO_ROOT, result.statePath),
      }, null, 2));
      return;
    }
    console.log(`run_id=${result.runId}`);
    console.log(`project=${result.project}`);
    console.log(`lane=${result.lane}`);
    if (result.adhocRunId) {
      console.log(`adhoc_run=${result.adhocRunId}`);
    }
    console.log(`state_path=${path.relative(REPO_ROOT, result.statePath)}`);
    return;
  }
  const options = command === "attach" ? parseAttachArgs(argv) : parseSupervisorArgs(argv);
  if (options.help) {
    printUsage(command);
    return;
  }
  if (command === "supervise") {
    const result = await runSupervisorLoop(options);
    if (result.alreadyRunning) {
      console.log(`[supervise] daemon already running for ${options.project}/${options.lane}`);
    }
    return;
  }
  if (command === "status") {
    if (!options.runId) {
      throw new Error("--run-id is required");
    }
    if (!options.projectProvided || !options.laneProvided) {
      throw new Error("--project and --lane are required");
    }
    const located = findSupervisorRunState(options.runId, options);
    if (!located?.state) {
      throw new Error(`Run ${options.runId} not found.`);
    }
    console.log(options.json ? JSON.stringify(located.state, null, 2) : formatRunState(located.state));
    return;
  }
  if (command === "wait") {
    if (!options.runId) {
      throw new Error("--run-id is required");
    }
    if (!options.projectProvided || !options.laneProvided) {
      throw new Error("--project and --lane are required");
    }
    const located = await waitForRunState(options);
    console.log(options.json ? JSON.stringify(located.state, null, 2) : formatRunState(located.state));
    if (located.state.status === "failed") {
      process.exitCode = Number.isInteger(located.state.exitCode) ? located.state.exitCode : 1;
    }
    return;
  }
  if (command === "attach") {
    if (!options.runId) {
      throw new Error("--run-id is required");
    }
    if (!options.projectProvided || !options.laneProvided) {
      throw new Error("--project and --lane are required");
    }
    if (Boolean(options.dashboard) === Boolean(options.agentId)) {
      throw new Error("Specify exactly one of --agent <id> or --dashboard");
    }
    if (options.dashboard) {
      await attachDashboard(options);
      return;
    }
    await attachAgentRuntimeSession(options);
    return;
  }
  throw new Error(`Unknown supervisor command: ${command}`);
}
