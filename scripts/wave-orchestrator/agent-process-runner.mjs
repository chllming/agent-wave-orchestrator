import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  ensureDirectory,
  readFileTail,
  readJsonOrNull,
  sleep,
  toIsoTimestamp,
  writeJsonAtomic,
} from "./shared.mjs";

export const AGENT_RUNTIME_HEARTBEAT_INTERVAL_MS = 10_000;

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

function parsePositiveInt(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRuntimeRecord(runtimePath) {
  return runtimePath ? readJsonOrNull(runtimePath) || {} : {};
}

function writeRuntimeRecord(runtimePath, payload) {
  if (!runtimePath) {
    return payload;
  }
  ensureDirectory(path.dirname(runtimePath));
  writeJsonAtomic(runtimePath, payload);
  return payload;
}

function updateRuntimeRecord(runtimePath, transform) {
  const current = readRuntimeRecord(runtimePath);
  const next = transform(current) || current;
  return writeRuntimeRecord(runtimePath, next);
}

function appendLogLine(logPath, message) {
  ensureDirectory(path.dirname(logPath));
  fs.appendFileSync(logPath, `${String(message || "").trimEnd()}\n`, "utf8");
}

function normalizeExitCode(code, signal) {
  if (Number.isInteger(code)) {
    return code;
  }
  if (!signal) {
    return 1;
  }
  if (signal === "SIGTERM") {
    return 143;
  }
  if (signal === "SIGINT") {
    return 130;
  }
  if (signal === "SIGKILL") {
    return 137;
  }
  return 1;
}

function exitReasonForOutcome(code, signal) {
  if (signal) {
    return signal.toLowerCase();
  }
  return Number(code) === 0 ? "completed" : "failed";
}

function terminalDispositionForOutcome(code, signal) {
  if (signal === "SIGTERM" || signal === "SIGINT" || signal === "SIGKILL") {
    return "terminated";
  }
  return Number(code) === 0 ? "completed" : "failed";
}

export async function terminateAgentProcessRuntime(runtimeRecord, { graceMs = 1000 } = {}) {
  const pgid = parsePositiveInt(runtimeRecord?.pgid, null);
  const candidatePid = parsePositiveInt(
    runtimeRecord?.executorPid ?? runtimeRecord?.pid ?? runtimeRecord?.runnerPid,
    null,
  );
  if (!pgid && !candidatePid) {
    return false;
  }
  const terminate = (signal) => {
    if (pgid) {
      try {
        process.kill(-pgid, signal);
        return true;
      } catch {
        // fall through
      }
    }
    if (candidatePid) {
      try {
        process.kill(candidatePid, signal);
        return true;
      } catch {
        // no-op
      }
    }
    return false;
  };
  const sent = terminate("SIGTERM");
  if (!sent) {
    return false;
  }
  await sleep(graceMs);
  if (
    (pgid && isProcessAlive(pgid)) ||
    (candidatePid && isProcessAlive(candidatePid))
  ) {
    terminate("SIGKILL");
  }
  return true;
}

export function buildAgentAttachInfo(runtimeRecord) {
  return {
    sessionBackend: String(runtimeRecord?.sessionBackend || "process").trim() || "process",
    attachMode: String(runtimeRecord?.attachMode || "log-tail").trim() || "log-tail",
    sessionName: String(runtimeRecord?.sessionName || "").trim() || null,
    tmuxSessionName: String(runtimeRecord?.tmuxSessionName || "").trim() || null,
    logPath: String(runtimeRecord?.logPath || "").trim() || null,
    statusPath: String(runtimeRecord?.statusPath || "").trim() || null,
    terminalDisposition: String(runtimeRecord?.terminalDisposition || "").trim() || null,
  };
}

export function renderAgentAttachFallback(runtimeRecord, { terminal = false } = {}) {
  const logPath = String(runtimeRecord?.logPath || "").trim();
  if (!logPath || !fs.existsSync(logPath)) {
    return "";
  }
  return terminal ? readFileTail(logPath, 12000) : logPath;
}

export function spawnAgentProcessRunner(payload, { env = process.env } = {}) {
  const payloadPath = String(payload?.payloadPath || "").trim();
  if (!payloadPath) {
    throw new Error("Detached agent runner requires payloadPath.");
  }
  ensureDirectory(path.dirname(payloadPath));
  writeJsonAtomic(payloadPath, payload);
  const runnerPath = fileURLToPath(new URL("./agent-process-runner.mjs", import.meta.url));
  const child = spawn(process.execPath, [runnerPath, "--payload-file", payloadPath], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  return {
    runnerPid: child.pid,
    payloadPath,
  };
}

function parseArgs(argv) {
  const options = {
    payloadFile: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--payload-file") {
      options.payloadFile = String(argv[++index] || "").trim();
    } else if (arg && arg !== "--") {
      throw new Error(`Unknown agent-process-runner argument: ${arg}`);
    }
  }
  if (!options.payloadFile) {
    throw new Error("--payload-file is required");
  }
  return options;
}

async function runAgentProcessRunner(payloadFile) {
  const payload = readJsonOrNull(payloadFile);
  if (!payload || typeof payload !== "object") {
    throw new Error(`Invalid detached agent runner payload: ${payloadFile}`);
  }
  const runtimePath = String(payload.runtimePath || "").trim();
  const statusPath = String(payload.statusPath || "").trim();
  const logPath = String(payload.logPath || "").trim();
  const command = String(payload.command || "").trim();
  if (!statusPath || !logPath || !command) {
    throw new Error("Detached agent runner payload is missing statusPath, logPath, or command.");
  }

  const startedAt = toIsoTimestamp();
  writeRuntimeRecord(runtimePath, {
    runId: payload.runId || null,
    waveNumber: Number(payload.waveNumber) || null,
    attempt: Number(payload.attempt) || 1,
    agentId: payload.agentId || null,
    sessionName: payload.sessionName || null,
    tmuxSessionName: null,
    sessionBackend: "process",
    attachMode: "log-tail",
    runnerPid: process.pid,
    executorPid: null,
    pid: null,
    pgid: null,
    startedAt,
    lastHeartbeatAt: startedAt,
    statusPath,
    logPath,
    exitCode: null,
    exitReason: null,
    terminalDisposition: "launching",
  });

  ensureDirectory(path.dirname(logPath));
  const child = spawn("bash", ["-lc", command], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...(payload.env && typeof payload.env === "object" ? payload.env : {}),
      WAVE_ORCHESTRATOR_ID: String(payload.orchestratorId || ""),
      WAVE_EXECUTOR_MODE: String(payload.executorId || ""),
      // Unique broker sticky key per agent so multiple agents on the same node
      // can acquire separate credentials concurrently.
      LPM_AUTH_STICKY_KEY: payload.executorId
        ? `wave:${payload.executorId}`
        : undefined,
    },
  });
  const executorPid = parsePositiveInt(child.pid, null);
  const pgid = executorPid;
  const markRuntime = (patch = {}) =>
    updateRuntimeRecord(runtimePath, (current) => ({
      ...current,
      ...patch,
      lastHeartbeatAt: toIsoTimestamp(),
    }));
  markRuntime({
    runnerPid: process.pid,
    executorPid,
    pid: executorPid,
    pgid,
    terminalDisposition: "running",
  });

  const heartbeat = setInterval(() => {
    if (fs.existsSync(statusPath)) {
      return;
    }
    markRuntime({
      terminalDisposition: "running",
    });
  }, AGENT_RUNTIME_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  let forwardedSignal = "";
  const handleSignal = async (signal) => {
    forwardedSignal = signal;
    try {
      await terminateAgentProcessRuntime({ pgid, executorPid, pid: executorPid });
    } catch {
      // best-effort only
    }
  };
  process.once("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });
  process.once("SIGINT", () => {
    void handleSignal("SIGINT");
  });

  await new Promise((resolve, reject) => {
    child.once("error", (error) => {
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearInterval(heartbeat);
      const completedAt = toIsoTimestamp();
      const exitCode = normalizeExitCode(code, signal || forwardedSignal);
      const exitReason = exitReasonForOutcome(exitCode, signal || forwardedSignal);
      const terminalDisposition = terminalDispositionForOutcome(exitCode, signal || forwardedSignal);
      writeJsonAtomic(statusPath, {
        code: exitCode,
        promptHash: payload.promptHash || null,
        orchestratorId: payload.orchestratorId || null,
        attempt: Number(payload.attempt) || 1,
        completedAt,
      });
      markRuntime({
        exitCode,
        exitReason,
        terminalDisposition,
      });
      appendLogLine(
        logPath,
        `[${payload.lane || "wave"}-wave-launcher] ${payload.sessionName || payload.agentId || "agent"} finished with code ${exitCode}`,
      );
      resolve();
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  runAgentProcessRunner(options.payloadFile).catch((error) => {
    const payload = readJsonOrNull(options.payloadFile);
    const runtimePath = String(payload?.runtimePath || "").trim();
    const statusPath = String(payload?.statusPath || "").trim();
    const logPath = String(payload?.logPath || "").trim();
    if (logPath) {
      appendLogLine(logPath, `[wave-agent-runner] ${error instanceof Error ? error.message : String(error)}`);
    }
    if (runtimePath) {
      updateRuntimeRecord(runtimePath, (current) => ({
        ...current,
        runnerPid: process.pid,
        exitCode: 1,
        exitReason: error instanceof Error ? error.message : String(error),
        terminalDisposition: "failed",
        lastHeartbeatAt: toIsoTimestamp(),
      }));
    }
    if (statusPath && !fs.existsSync(statusPath)) {
      writeJsonAtomic(statusPath, {
        code: 1,
        promptHash: payload?.promptHash || null,
        orchestratorId: payload?.orchestratorId || null,
        attempt: Number(payload?.attempt) || 1,
        completedAt: toIsoTimestamp(),
      });
    }
    process.exit(1);
  });
}
