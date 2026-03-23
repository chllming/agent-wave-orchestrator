import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DASHBOARD_TERMINAL_COLOR,
  DASHBOARD_TERMINAL_ICON,
  REPO_ROOT,
  TERMINAL_COLOR,
  TERMINAL_ICON,
  TMUX_COMMAND_TIMEOUT_MS,
  ensureDirectory,
  writeJsonAtomic,
} from "./shared.mjs";

export const TERMINAL_SURFACES = ["vscode", "tmux", "none"];

export function normalizeTerminalSurface(value, label = "terminal surface") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!TERMINAL_SURFACES.includes(normalized)) {
    throw new Error(`${label} must be one of: ${TERMINAL_SURFACES.join(", ")}`);
  }
  return normalized;
}

export function terminalSurfaceUsesTerminalRegistry(surface) {
  return normalizeTerminalSurface(surface) === "vscode";
}

function defaultTerminalsConfig() {
  return {
    terminals: [],
    autorun: true,
    env: {},
  };
}

export function readTerminalsConfig(filePath) {
  ensureDirectory(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    writeJsonAtomic(filePath, defaultTerminalsConfig());
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed.terminals)) {
    parsed.terminals = [];
  }
  if (typeof parsed.autorun !== "boolean") {
    parsed.autorun = true;
  }
  if (!parsed.env || typeof parsed.env !== "object") {
    parsed.env = {};
  }
  return parsed;
}

export function writeTerminalsConfig(filePath, config) {
  writeJsonAtomic(filePath, config);
}

function isLaneTemporaryTerminalName(name, lanePaths) {
  return (
    name === lanePaths.globalDashboardTerminalName ||
    name === currentWaveDashboardTerminalName(lanePaths) ||
    name.startsWith(lanePaths.terminalNamePrefix) ||
    name.startsWith(lanePaths.dashboardTerminalNamePrefix)
  );
}

function currentWaveDashboardTerminalName(lanePaths) {
  return lanePaths.lane === "main"
    ? "Current Wave Dashboard"
    : `Current Wave Dashboard (${lanePaths.lane})`;
}

function extractTmuxSessionName(command, socketName) {
  const text = String(command || "").trim();
  const marker = `tmux -L ${socketName} new -As `;
  const index = text.indexOf(marker);
  if (index === -1) {
    return null;
  }
  const sessionName = text.slice(index + marker.length).trim();
  return sessionName || null;
}

export function createTemporaryTerminalEntries(
  lanePaths,
  wave,
  agents,
  runTag,
  includeDashboard = false,
) {
  const agentEntries = agents.map((agent) => {
    const terminalName = `${lanePaths.terminalNamePrefix}${wave}-${agent.slug}`;
    const sessionName = `${lanePaths.tmuxSessionPrefix}${wave}_${agent.slug}_${runTag}`.replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    return {
      terminalName,
      sessionName,
      config: {
        name: terminalName,
        icon: TERMINAL_ICON,
        color: TERMINAL_COLOR,
        command: `TMUX= tmux -L ${lanePaths.tmuxSocketName} new -As ${sessionName}`,
      },
    };
  });
  if (!includeDashboard) {
    return agentEntries;
  }
  const dashboardSessionName = `${lanePaths.tmuxDashboardSessionPrefix}${wave}_${runTag}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  agentEntries.push({
    terminalName: `${lanePaths.dashboardTerminalNamePrefix}${wave}`,
    sessionName: dashboardSessionName,
    config: {
      name: `${lanePaths.dashboardTerminalNamePrefix}${wave}`,
      icon: DASHBOARD_TERMINAL_ICON,
      color: DASHBOARD_TERMINAL_COLOR,
      command: `TMUX= tmux -L ${lanePaths.tmuxSocketName} new -As ${dashboardSessionName}`,
    },
  });
  return agentEntries;
}

export function createGlobalDashboardTerminalEntry(lanePaths, runTag) {
  const sessionName = `${lanePaths.tmuxGlobalDashboardSessionPrefix}_current`.replace(
    /[^a-zA-Z0-9:_-]/g,
    "_",
  );
  return {
    terminalName: lanePaths.globalDashboardTerminalName,
    sessionName,
    config: {
      name: lanePaths.globalDashboardTerminalName,
      icon: DASHBOARD_TERMINAL_ICON,
      color: DASHBOARD_TERMINAL_COLOR,
      command: `TMUX= tmux -L ${lanePaths.tmuxSocketName} new -As ${sessionName}`,
    },
  };
}

export function createCurrentWaveDashboardTerminalEntry(lanePaths) {
  const sessionName = `${lanePaths.tmuxDashboardSessionPrefix}_current`.replace(
    /[^a-zA-Z0-9:_-]/g,
    "_",
  );
  const terminalName = currentWaveDashboardTerminalName(lanePaths);
  return {
    terminalName,
    sessionName,
    config: {
      name: terminalName,
      icon: DASHBOARD_TERMINAL_ICON,
      color: DASHBOARD_TERMINAL_COLOR,
      command: `TMUX= tmux -L ${lanePaths.tmuxSocketName} new -As ${sessionName}`,
    },
  };
}

export function appendTerminalEntries(terminalsPath, entries) {
  const config = readTerminalsConfig(terminalsPath);
  const namesToReplace = new Set(entries.map((entry) => entry.terminalName));
  config.terminals = config.terminals.filter((terminal) => !namesToReplace.has(terminal?.name));
  config.terminals.push(...entries.map((entry) => entry.config));
  writeTerminalsConfig(terminalsPath, config);
}

export function removeTerminalEntries(terminalsPath, entries) {
  const config = readTerminalsConfig(terminalsPath);
  const namesToRemove = new Set(entries.map((entry) => entry.terminalName));
  config.terminals = config.terminals.filter((terminal) => !namesToRemove.has(terminal?.name));
  writeTerminalsConfig(terminalsPath, config);
}

export function removeLaneTemporaryTerminalEntries(terminalsPath, lanePaths) {
  const config = readTerminalsConfig(terminalsPath);
  const before = config.terminals.length;
  config.terminals = config.terminals.filter(
    (terminal) => !isLaneTemporaryTerminalName(String(terminal?.name || ""), lanePaths),
  );
  const removed = before - config.terminals.length;
  if (removed > 0) {
    writeTerminalsConfig(terminalsPath, config);
  }
  return removed;
}

export function pruneOrphanLaneTemporaryTerminalEntries(
  terminalsPath,
  lanePaths,
  activeSessionNames = [],
) {
  const activeSessions =
    activeSessionNames instanceof Set ? activeSessionNames : new Set(activeSessionNames || []);
  const config = readTerminalsConfig(terminalsPath);
  const removedNames = [];
  config.terminals = config.terminals.filter((terminal) => {
    const name = String(terminal?.name || "");
    if (!isLaneTemporaryTerminalName(name, lanePaths)) {
      return true;
    }
    const sessionName = extractTmuxSessionName(terminal?.command, lanePaths.tmuxSocketName);
    if (sessionName && activeSessions.has(sessionName)) {
      return true;
    }
    removedNames.push(name);
    return false;
  });
  if (removedNames.length > 0) {
    writeTerminalsConfig(terminalsPath, config);
  }
  return {
    removed: removedNames.length,
    removedNames,
  };
}

export function killTmuxSessionIfExists(socketName, sessionName) {
  const result = spawnSync("tmux", ["-L", socketName, "kill-session", "-t", sessionName], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, TMUX: "" },
    timeout: TMUX_COMMAND_TIMEOUT_MS,
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`kill existing session ${sessionName} failed: tmux command timed out`);
    }
    throw new Error(`kill existing session ${sessionName} failed: ${result.error.message}`);
  }
  if (result.status === 0) {
    return;
  }
  const combined = `${String(result.stderr || "").toLowerCase()}\n${String(result.stdout || "").toLowerCase()}`;
  if (
    combined.includes("can't find session") ||
    combined.includes("no server running") ||
    combined.includes("no current target") ||
    combined.includes("error connecting")
  ) {
    return;
  }
  throw new Error(`kill existing session ${sessionName} failed: ${(result.stderr || "").trim()}`);
}
