import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadWaveConfig } from "./config.mjs";
import { analyzeMessageBoardCommunication } from "./coordination.mjs";
import { commsAgeSummary, deploymentSummary } from "./dashboard-state.mjs";
import {
  buildLanePaths,
  DEFAULT_REFRESH_MS,
  DEFAULT_WAVE_LANE,
  FINAL_EXIT_DELAY_MS,
  REPO_ROOT,
  TERMINAL_STATES,
  formatAgeFromTimestamp,
  formatElapsed,
  pad,
  sleep,
  truncate,
} from "./shared.mjs";
import {
  createCurrentWaveDashboardTerminalEntry,
  createGlobalDashboardTerminalEntry,
} from "./terminals.mjs";

const DASHBOARD_ATTACH_TARGETS = ["current", "global"];

function normalizeDashboardAttachTarget(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!DASHBOARD_ATTACH_TARGETS.includes(normalized)) {
    throw new Error(`--attach must be one of: ${DASHBOARD_ATTACH_TARGETS.join(", ")}`);
  }
  return normalized;
}

export function parseDashboardArgs(argv) {
  const options = {
    lane: DEFAULT_WAVE_LANE,
    dashboardFile: null,
    messageBoard: null,
    attach: null,
    watch: false,
    refreshMs: DEFAULT_REFRESH_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--watch") {
      options.watch = true;
    } else if (arg === "--lane") {
      options.lane =
        String(argv[++i] || "")
          .trim()
          .toLowerCase() || DEFAULT_WAVE_LANE;
    } else if (arg === "--dashboard-file") {
      options.dashboardFile = path.resolve(REPO_ROOT, argv[++i] || "");
    } else if (arg === "--message-board") {
      options.messageBoard = path.resolve(REPO_ROOT, argv[++i] || "");
    } else if (arg === "--attach") {
      options.attach = normalizeDashboardAttachTarget(argv[++i] || "");
    } else if (arg === "--refresh-ms") {
      options.refreshMs = Number.parseInt(String(argv[++i] || ""), 10);
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, options };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.dashboardFile && !options.attach) {
    throw new Error("--dashboard-file is required unless --attach is used");
  }
  return { help: false, options };
}

function tmuxSessionExists(socketName, sessionName) {
  const result = spawnSync("tmux", ["-L", socketName, "has-session", "-t", sessionName], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, TMUX: "" },
  });
  if (result.error) {
    throw new Error(`tmux session lookup failed: ${result.error.message}`);
  }
  if (result.status === 0) {
    return true;
  }
  const combined = `${String(result.stderr || "").toLowerCase()}\n${String(result.stdout || "").toLowerCase()}`;
  if (
    combined.includes("can't find session") ||
    combined.includes("no server running") ||
    combined.includes("error connecting")
  ) {
    return false;
  }
  throw new Error((result.stderr || result.stdout || "tmux has-session failed").trim());
}

function attachDashboardSession(lane, target) {
  const config = loadWaveConfig();
  const lanePaths = buildLanePaths(lane, { config });
  const entry =
    target === "global"
      ? createGlobalDashboardTerminalEntry(lanePaths, "current")
      : createCurrentWaveDashboardTerminalEntry(lanePaths);
  if (!tmuxSessionExists(lanePaths.tmuxSocketName, entry.sessionName)) {
    const dashboardsRel = path.relative(REPO_ROOT, path.dirname(lanePaths.globalDashboardPath));
    throw new Error(
      `No ${target} dashboard session is live for lane ${lanePaths.lane}. Launch a dashboarded run on that lane, then inspect ${dashboardsRel} if you need the last written dashboard state.`,
    );
  }
  const result = spawnSync("tmux", ["-L", lanePaths.tmuxSocketName, "attach", "-t", entry.sessionName], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, TMUX: "" },
  });
  if (result.error) {
    throw new Error(`tmux attach failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `tmux attach exited ${result.status} for lane ${lanePaths.lane} ${target} dashboard session ${entry.sessionName}.`,
    );
  }
}

function readMessageBoardTail(messageBoardPath, maxLines = 24) {
  if (!messageBoardPath) {
    return ["(message board path unavailable)"];
  }
  if (!fs.existsSync(messageBoardPath)) {
    return ["(message board missing)"];
  }
  const raw = fs.readFileSync(messageBoardPath, "utf8").trim();
  if (!raw) {
    return ["(message board currently empty)"];
  }
  return raw.split(/\r?\n/).slice(-maxLines);
}

function resolveMessageBoardPath(state, overridePath) {
  if (overridePath) {
    return overridePath;
  }
  if (typeof state?.messageBoardPath === "string") {
    return path.resolve(REPO_ROOT, state.messageBoardPath);
  }
  return null;
}

function isGlobalDashboardState(state) {
  return Boolean(state && Array.isArray(state.waves) && !Array.isArray(state.agents));
}

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
};

function paint(text, color, colorize = false) {
  if (!colorize || !color) {
    return text;
  }
  return `${color}${text}${ANSI.reset}`;
}

function paintState(text, state, colorize = false) {
  const normalized = String(state || "").trim().toLowerCase();
  const color =
    normalized === "completed"
      ? ANSI.green
      : normalized === "failed" || normalized === "timed_out"
        ? ANSI.red
        : normalized === "deploying" || normalized === "finalizing" || normalized === "validating"
          ? ANSI.yellow
          : normalized === "running" || normalized === "coding" || normalized === "launching"
            ? ANSI.cyan
            : normalized === "pending"
              ? ANSI.dim
              : normalized === "dry-run"
                ? ANSI.magenta
                : null;
  return paint(text, color, colorize);
}

function paintLevel(text, level, colorize = false) {
  const normalized = String(level || "").trim().toLowerCase();
  const color =
    normalized === "error"
      ? ANSI.red
      : normalized === "warn"
        ? ANSI.yellow
        : normalized === "info"
          ? ANSI.blue
          : null;
  return paint(text, color, colorize);
}

function paintExitCode(text, exitCode, colorize = false) {
  if (exitCode === 0 || exitCode === "0") {
    return paint(text, ANSI.green, colorize);
  }
  if (exitCode === null || exitCode === undefined || exitCode === "-") {
    return text;
  }
  return paint(text, ANSI.red, colorize);
}

function paintDeploymentSummary(text, deploymentState, colorize = false) {
  const normalized = String(deploymentState || "").trim().toLowerCase();
  const color =
    normalized === "healthy"
      ? ANSI.green
      : normalized === "failed"
        ? ANSI.red
        : normalized === "deploying" || normalized === "rolledover"
          ? ANSI.yellow
          : null;
  return paint(text, color, colorize);
}

function renderColoredCountsByState(agents, colorize = false) {
  const counts = new Map();
  for (const agent of agents || []) {
    const key = agent?.state || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([state, count]) => `${paintState(state, state, colorize)}:${count}`)
    .join("  ");
}

function paintWaveAgentSummary(summary, wave, colorize = false) {
  const failed = Number(wave?.agentsFailed ?? 0) || 0;
  const active = Number(wave?.agentsActive ?? 0) || 0;
  const total = Number(wave?.agentsTotal ?? 0) || 0;
  const completed = Number(wave?.agentsCompleted ?? 0) || 0;
  const color =
    failed > 0
      ? ANSI.red
      : active > 0
        ? ANSI.cyan
        : total > 0 && completed >= total
          ? ANSI.green
          : ANSI.dim;
  return paint(summary, color, colorize);
}

function formatDurationMs(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function renderWaveDashboard({ state, dashboardPath, messageBoardPath, lane, colorize = false }) {
  if (!state) {
    return `Dashboard file not found or invalid: ${dashboardPath}`;
  }
  const lines = [];
  const laneName = String(state?.lane || lane || "").trim() || DEFAULT_WAVE_LANE;
  lines.push(
    `${laneName} Wave Dashboard | wave=${state.wave ?? "?"} | status=${paintState(
      state.status ?? "unknown",
      state.status,
      colorize,
    )} | attempt=${state.attempt ?? "?"}/${state.maxAttempts ?? "?"}`,
  );
  lines.push(
    `Updated ${formatAgeFromTimestamp(Date.parse(state.updatedAt || ""))} | Started ${state.startedAt || "n/a"} | Elapsed ${formatElapsed(state.startedAt)}`,
  );
  lines.push(`Run tag: ${state.runTag || "n/a"} | Wave file: ${state.waveFile || "n/a"}`);
  lines.push(`Counts: ${renderColoredCountsByState(state.agents || [], colorize) || "none"}`);
  lines.push(
    `Coordination: open=${state.coordinationOpen ?? 0} clarifications=${state.openClarifications ?? 0} human=${state.openHumanEscalations ?? 0} overdue-ack=${state.overdueAckCount ?? 0} overdue-clarification=${state.overdueClarificationCount ?? 0}`,
  );
  lines.push(
    `Coordination age: oldest-open=${formatDurationMs(state.oldestOpenCoordinationAgeMs)} oldest-unack=${formatDurationMs(state.oldestUnackedRequestAgeMs)}`,
  );
  const comms = analyzeMessageBoardCommunication(messageBoardPath);
  if (!comms.available) {
    lines.push(`Board comms: unavailable ${comms.reason || ""}`.trim());
  } else {
    lines.push(
      `Board comms: requests=${comms.actionableRequests} unresolved=${comms.unresolvedRequests} unacknowledged=${comms.unacknowledgedRequests} malformed=${comms.malformedEntries} placeholder-ts=${comms.placeholderTimestampEntries}`,
    );
    lines.push(
      `Board comms age: last-ack=${commsAgeSummary(comms.lastAcknowledgementTimestamp)} oldest-unack=${commsAgeSummary(comms.oldestUnacknowledgedTimestamp)}`,
    );
  }
  lines.push("");
  lines.push("Agents:");
  lines.push(
    `${pad("ID", 8)} ${pad("State", 12)} ${pad("Attempts", 8)} ${pad("Exit", 6)} ${pad("Deploy", 24)} ${pad("Last Update", 12)} Detail`,
  );
  lines.push(
    `${"-".repeat(8)} ${"-".repeat(12)} ${"-".repeat(8)} ${"-".repeat(6)} ${"-".repeat(24)} ${"-".repeat(12)} ${"-".repeat(36)}`,
  );
  for (const agent of state.agents || []) {
    lines.push(
      `${pad(agent.agentId || "-", 8)} ${paintState(
        pad(agent.state || "-", 12),
        agent.state,
        colorize,
      )} ${pad(agent.attempts ?? 0, 8)} ${paintExitCode(
        pad(agent.exitCode ?? "-", 6),
        agent.exitCode,
        colorize,
      )} ${paintDeploymentSummary(
        pad(deploymentSummary({ service: agent.deploymentService, state: agent.deploymentState }), 24),
        agent.deploymentState,
        colorize,
      )} ${pad(
        formatAgeFromTimestamp(Date.parse(agent.lastUpdateAt || "")),
        12,
      )} ${truncate(agent.detail || "", 72)}`,
    );
  }
  lines.push("");
  lines.push("Recent events:");
  for (const event of (state.events || []).slice(-12)) {
    const prefix = event.agentId ? `[${event.agentId}]` : "[wave]";
    lines.push(
      `${event.at || "n/a"} ${paintLevel(pad(event.level || "info", 5), event.level, colorize)} ${prefix} ${event.message || ""}`,
    );
  }
  if ((state.events || []).length === 0) {
    lines.push("(none)");
  }
  lines.push("");
  lines.push("Rolling message board:");
  lines.push(`Path: ${messageBoardPath || "n/a"}`);
  lines.push(...readMessageBoardTail(messageBoardPath));
  return lines.join("\n");
}

function renderGlobalDashboard({ state, dashboardPath, lane, colorize = false }) {
  if (!state) {
    return `Dashboard file not found or invalid: ${dashboardPath}`;
  }
  const formatGlobalWaveAgentSummary = (wave) => {
    const total = Number(wave?.agentsTotal ?? 0) || 0;
    const completed = Number(wave?.agentsCompleted ?? 0) || 0;
    const failed = Number(wave?.agentsFailed ?? 0) || 0;
    const active = Number(wave?.agentsActive ?? 0) || 0;
    const pending =
      wave?.agentsPending === undefined || wave?.agentsPending === null
        ? Math.max(0, total - completed - failed - active)
        : Number(wave.agentsPending ?? 0) || 0;
    return `done ${completed}/${total} active ${active} pending ${pending} fail ${failed}`;
  };
  const lines = [];
  const laneName = String(state?.lane || lane || "").trim() || DEFAULT_WAVE_LANE;
  lines.push(
    `${laneName} Wave Global Dashboard | run=${state.runId || "n/a"} | status=${paintState(
      state.status || "unknown",
      state.status,
      colorize,
    )}`,
  );
  lines.push(
    `Updated ${formatAgeFromTimestamp(Date.parse(state.updatedAt || ""))} | Started ${state.startedAt || "n/a"} | Elapsed ${formatElapsed(state.startedAt)}`,
  );
  lines.push(
    `Options: autoNext=${state.options?.autoNext ? "true" : "false"} start=${state.options?.startWave ?? "?"} end=${state.options?.endWave ?? "last"} retries=${state.options?.maxRetriesPerWave ?? "?"}`,
  );
  lines.push("");
  lines.push("Waves:");
  lines.push(
    `${pad("Wave", 6)} ${pad("Status", 10)} ${pad("Attempt", 9)} ${pad("Agents", 36)} ${pad("Started", 12)} ${pad("Last Message", 70)}`,
  );
  lines.push(
    `${"-".repeat(6)} ${"-".repeat(10)} ${"-".repeat(9)} ${"-".repeat(36)} ${"-".repeat(12)} ${"-".repeat(70)}`,
  );
  for (const wave of state.waves || []) {
    const agents = formatGlobalWaveAgentSummary(wave);
    lines.push(
      `${pad(wave.wave ?? "-", 6)} ${paintState(pad(wave.status || "-", 10), wave.status, colorize)} ${pad(
        `${wave.attempt ?? 0}/${wave.maxAttempts ?? 0}`,
        9,
      )} ${paintWaveAgentSummary(pad(agents, 36), wave, colorize)} ${pad(
        formatAgeFromTimestamp(Date.parse(wave.startedAt || "")),
        12,
      )} ${truncate(wave.lastMessage || "", 70)}`,
    );
    if (
      Number(wave?.coordinationOpen ?? 0) > 0 ||
      Number(wave?.overdueAckCount ?? 0) > 0 ||
      Number(wave?.overdueClarificationCount ?? 0) > 0 ||
      Number(wave?.openHumanEscalations ?? 0) > 0
    ) {
      lines.push(
        `      Coord: open ${wave.coordinationOpen ?? 0} clarifications ${wave.openClarifications ?? 0} human ${wave.openHumanEscalations ?? 0} overdue-ack ${wave.overdueAckCount ?? 0} overdue-clarification ${wave.overdueClarificationCount ?? 0}`,
      );
      lines.push(
        `      Ages: oldest-open ${formatDurationMs(wave.oldestOpenCoordinationAgeMs)} oldest-unack ${formatDurationMs(wave.oldestUnackedRequestAgeMs)}`,
      );
    }
    const deployments = Array.isArray(wave.deployments) ? wave.deployments : [];
    if (deployments.length > 0) {
      const deployLine = deployments
        .slice(-3)
        .map((deployment) => `${deployment.agentId}:${deployment.service}:${deployment.state}`)
        .join(" | ");
      lines.push(`      Deploy: ${truncate(deployLine, 120)}`);
    }
  }
  lines.push("");
  lines.push("Recent events:");
  for (const event of (state.events || []).slice(-16)) {
    const waveTag = event.wave ? `wave:${event.wave}` : "wave:-";
    lines.push(
      `${event.at || "n/a"} ${paintLevel(pad(event.level || "info", 5), event.level, colorize)} [${waveTag}] ${event.message || ""}`,
    );
  }
  if ((state.events || []).length === 0) {
    lines.push("(none)");
  }
  return lines.join("\n");
}

export function renderDashboard({ state, dashboardPath, messageBoardPath, lane, colorize = false }) {
  return isGlobalDashboardState(state)
    ? renderGlobalDashboard({ state, dashboardPath, lane, colorize })
    : renderWaveDashboard({ state, dashboardPath, messageBoardPath, lane, colorize });
}

export async function runDashboardCli(argv) {
  const { help, options } = parseDashboardArgs(argv);
  if (help) {
    console.log(`Usage: pnpm exec wave dashboard --dashboard-file <path> [options]

Options:
  --lane <name>            Wave lane name (default: ${DEFAULT_WAVE_LANE})
  --dashboard-file <path>  Path to wave/global dashboard JSON
  --message-board <path>   Optional message board path override
  --attach <current|global>
                          Attach to the stable tmux-backed dashboard session for the lane
  --watch                  Refresh continuously
  --refresh-ms <n>         Refresh interval in ms (default: ${DEFAULT_REFRESH_MS})
`);
    return;
  }

  if (options.attach) {
    attachDashboardSession(options.lane, options.attach);
    return;
  }

  let terminalStateReachedAt = null;
  while (true) {
    const raw = fs.existsSync(options.dashboardFile)
      ? JSON.parse(fs.readFileSync(options.dashboardFile, "utf8"))
      : null;
    const boardPath = resolveMessageBoardPath(raw, options.messageBoard);
    const rendered = renderDashboard({
      state: raw,
      dashboardPath: options.dashboardFile,
      messageBoardPath: boardPath,
      lane: options.lane,
      colorize: process.stdout.isTTY,
    });
    if (process.stdout.isTTY) {
      process.stdout.write("\u001bc");
    }
    process.stdout.write(`${rendered}\n`);
    if (!options.watch) {
      return;
    }
    const currentStatus = raw?.status || "";
    if (TERMINAL_STATES.has(currentStatus)) {
      terminalStateReachedAt ??= Date.now();
      if (Date.now() - terminalStateReachedAt >= FINAL_EXIT_DELAY_MS) {
        return;
      }
    } else {
      terminalStateReachedAt = null;
    }
    await sleep(options.refreshMs);
  }
}
