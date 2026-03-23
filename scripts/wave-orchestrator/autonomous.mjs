import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_EXECUTOR_MODE, normalizeExecutorMode, SUPPORTED_EXECUTOR_MODES } from "./config.mjs";
import {
  DEFAULT_AGENT_LAUNCH_STAGGER_MS,
  DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS,
  DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS,
  DEFAULT_AGENT_RATE_LIMIT_RETRIES,
  DEFAULT_MAX_RETRIES_PER_WAVE,
  DEFAULT_TIMEOUT_MINUTES,
  DEFAULT_WAVE_LANE,
  PACKAGE_ROOT,
  REPO_ROOT,
  buildLanePaths,
  parseNonNegativeInt,
  parsePositiveInt,
  sanitizeLaneName,
} from "./shared.mjs";
import {
  DEFAULT_CODEX_SANDBOX_MODE,
  normalizeCodexSandboxMode,
} from "./launcher.mjs";
import {
  maybeAnnouncePackageUpdate,
  WAVE_SUPPRESS_UPDATE_NOTICE_ENV,
} from "./package-update-notice.mjs";
import { readRunState } from "./wave-files.mjs";
import { readDependencyTickets } from "./coordination-store.mjs";
import { readWaveLedger } from "./ledger.mjs";

function printUsage() {
  console.log(`Usage: pnpm exec wave autonomous [options]

Options:
  --lane <name>                 Lane name (default: ${DEFAULT_WAVE_LANE})
  --timeout-minutes <n>         Per-wave timeout passed to launcher (default: ${DEFAULT_TIMEOUT_MINUTES})
  --max-retries-per-wave <n>    Per-wave relaunches inside launcher (default: ${DEFAULT_MAX_RETRIES_PER_WAVE})
  --max-attempts-per-wave <n>   External attempts for each wave (default: 1)
  --agent-rate-limit-retries <n>
                                Per-agent retries for 429 or rate-limit errors (default: ${DEFAULT_AGENT_RATE_LIMIT_RETRIES})
  --agent-rate-limit-base-delay-seconds <n>
                                Base backoff delay for 429 retries (default: ${DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS})
  --agent-rate-limit-max-delay-seconds <n>
                                Max backoff delay for 429 retries (default: ${DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS})
  --agent-launch-stagger-ms <n> Delay between agent launches (default: ${DEFAULT_AGENT_LAUNCH_STAGGER_MS})
  --orchestrator-id <id>        Orchestrator ID for coordination board
  --resident-orchestrator       Launch a resident orchestrator session for each live wave
  --executor <mode>             Default executor passed to launcher: ${SUPPORTED_EXECUTOR_MODES.join(" | ")} (default: lane config)
  --codex-sandbox <mode>        Default Codex sandbox mode passed to launcher (default: ${DEFAULT_CODEX_SANDBOX_MODE})
  --dashboard                   Enable dashboards (default: disabled)
  --keep-sessions               Keep tmux sessions between waves
  --keep-terminals              Keep temporary terminal entries between waves
`);
}

export function parseArgs(argv) {
  const options = {
    lane: DEFAULT_WAVE_LANE,
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
    maxRetriesPerWave: DEFAULT_MAX_RETRIES_PER_WAVE,
    maxAttemptsPerWave: 1,
    agentRateLimitRetries: DEFAULT_AGENT_RATE_LIMIT_RETRIES,
    agentRateLimitBaseDelaySeconds: DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS,
    agentRateLimitMaxDelaySeconds: DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS,
    agentLaunchStaggerMs: DEFAULT_AGENT_LAUNCH_STAGGER_MS,
    orchestratorId: null,
    residentOrchestrator: false,
    executorMode: DEFAULT_EXECUTOR_MODE,
    codexSandboxMode: DEFAULT_CODEX_SANDBOX_MODE,
    noDashboard: true,
    keepSessions: false,
    keepTerminals: false,
  };
  let executorProvided = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, options };
    }
    if (arg === "--lane") {
      options.lane = sanitizeLaneName(argv[++i]);
    } else if (arg === "--timeout-minutes") {
      options.timeoutMinutes = parsePositiveInt(argv[++i], "--timeout-minutes");
    } else if (arg === "--max-retries-per-wave") {
      options.maxRetriesPerWave = parseNonNegativeInt(argv[++i], "--max-retries-per-wave");
    } else if (arg === "--max-attempts-per-wave") {
      options.maxAttemptsPerWave = parsePositiveInt(argv[++i], "--max-attempts-per-wave");
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
    } else if (arg === "--orchestrator-id") {
      options.orchestratorId = String(argv[++i] || "").trim();
    } else if (arg === "--resident-orchestrator") {
      options.residentOrchestrator = true;
    } else if (arg === "--executor") {
      options.executorMode = normalizeExecutorMode(argv[++i], "--executor");
      executorProvided = true;
    } else if (arg === "--codex-sandbox") {
      options.codexSandboxMode = normalizeCodexSandboxMode(argv[++i], "--codex-sandbox");
    } else if (arg === "--dashboard") {
      options.noDashboard = false;
    } else if (arg === "--keep-sessions") {
      options.keepSessions = true;
    } else if (arg === "--keep-terminals") {
      options.keepTerminals = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!executorProvided) {
    options.executorMode = buildLanePaths(options.lane).executors.default;
  }
  options.orchestratorId ||= `${options.lane}-autonomous`;
  if (options.executorMode === "local") {
    throw new Error("Autonomous mode does not support --executor local. Use codex, claude, or opencode.");
  }
  if (options.agentRateLimitMaxDelaySeconds < options.agentRateLimitBaseDelaySeconds) {
    throw new Error(
      "--agent-rate-limit-max-delay-seconds must be >= --agent-rate-limit-base-delay-seconds",
    );
  }
  return { help: false, options };
}

function getWaveNumbers(lane) {
  const lanePaths = buildLanePaths(lane);
  if (!fs.existsSync(lanePaths.wavesDir)) {
    throw new Error(`Waves directory not found: ${path.relative(REPO_ROOT, lanePaths.wavesDir)}`);
  }
  const waveNumbers = fs
    .readdirSync(lanePaths.wavesDir)
    .filter((name) => /^wave-\d+\.md$/.test(name))
    .map((name) => Number.parseInt(name.match(/^wave-(\d+)\.md$/)[1], 10))
    .toSorted((a, b) => a - b);
  if (waveNumbers.length === 0) {
    throw new Error(`No wave files found in ${path.relative(REPO_ROOT, lanePaths.wavesDir)}`);
  }
  return waveNumbers;
}

export function nextIncompleteWave(allWaves, completed) {
  const done = new Set(completed);
  for (const wave of allWaves) {
    if (!done.has(wave)) {
      return wave;
    }
  }
  return null;
}

function runCommand(args, envOverrides = {}) {
  const result = spawnSync("node", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
  return Number.isInteger(result.status) ? result.status : 1;
}

function reconcile(lane) {
  return runCommand(
    [path.join(PACKAGE_ROOT, "scripts", "wave-launcher.mjs"), "--lane", lane, "--reconcile-status"],
    { [WAVE_SUPPRESS_UPDATE_NOTICE_ENV]: "1" },
  );
}

function dryRun(lane) {
  return runCommand(
    [path.join(PACKAGE_ROOT, "scripts", "wave-launcher.mjs"), "--lane", lane, "--dry-run", "--no-dashboard"],
    { [WAVE_SUPPRESS_UPDATE_NOTICE_ENV]: "1" },
  );
}

function listPendingFeedback(lane) {
  return runCommand([path.join(PACKAGE_ROOT, "scripts", "wave-human-feedback.mjs"), "list", "--lane", lane, "--pending"]);
}

function launchSingleWave(params) {
  const args = [
    path.join(PACKAGE_ROOT, "scripts", "wave-launcher.mjs"),
    "--lane",
    params.lane,
    "--start-wave",
    String(params.wave),
    "--end-wave",
    String(params.wave),
    "--timeout-minutes",
    String(params.timeoutMinutes),
    "--max-retries-per-wave",
    String(params.maxRetriesPerWave),
    "--agent-rate-limit-retries",
    String(params.agentRateLimitRetries),
    "--agent-rate-limit-base-delay-seconds",
    String(params.agentRateLimitBaseDelaySeconds),
    "--agent-rate-limit-max-delay-seconds",
    String(params.agentRateLimitMaxDelaySeconds),
    "--agent-launch-stagger-ms",
    String(params.agentLaunchStaggerMs),
    "--executor",
    params.executorMode,
    "--codex-sandbox",
    params.codexSandboxMode,
    "--orchestrator-id",
    params.orchestratorId,
    "--coordination-note",
    `autonomous single-wave run wave=${params.wave} attempt=${params.attempt}`,
  ];
  if (params.noDashboard) {
    args.push("--no-dashboard");
  }
  if (params.keepSessions) {
    args.push("--keep-sessions");
  }
  if (params.keepTerminals) {
    args.push("--keep-terminals");
  }
  if (params.residentOrchestrator) {
    args.push("--resident-orchestrator");
  }
  return runCommand(args, { [WAVE_SUPPRESS_UPDATE_NOTICE_ENV]: "1" });
}

function requiredInboundDependenciesOpen(lanePaths, lane) {
  return readDependencyTickets(lanePaths.crossLaneDependenciesDir, lane).filter((record) => {
    const required = record.required === true || String(record.closureCondition || "").includes("required=true");
    return required && ["open", "acknowledged", "in_progress"].includes(record.status);
  });
}

function pendingHumanItemsForWave(lanePaths, wave) {
  const existingLedger = readWaveLedger(path.join(lanePaths.ledgerDir, `wave-${wave}.json`));
  return [
    ...(existingLedger?.humanFeedback || []),
    ...(existingLedger?.humanEscalations || []),
  ];
}

function pendingHumanItemsForLane(lanePaths) {
  if (!fs.existsSync(lanePaths.ledgerDir)) {
    return [];
  }
  return fs
    .readdirSync(lanePaths.ledgerDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^wave-\d+\.json$/i.test(entry.name))
    .map((entry) => ({
      entry,
      wave: Number.parseInt(entry.name.replace(/^wave-|\.json$/gi, ""), 10),
    }))
    .filter((item) => Number.isFinite(item.wave))
    .sort((left, right) => left.wave - right.wave)
    .flatMap((item) =>
      pendingHumanItemsForWave(lanePaths, item.wave).map((id) => ({
        wave: item.wave,
        id,
      })),
    );
}

export function readAutonomousBarrier(lanePaths, lane, wave = null) {
  const dependencyBlockers = requiredInboundDependenciesOpen(lanePaths, lane);
  if (dependencyBlockers.length > 0) {
    return {
      kind: "dependencies",
      dependencyBlockers,
      pendingHumanItems: [],
      message:
        wave === null
          ? `Stopping finalization for lane ${lane}: unresolved required inbound dependencies remain (${dependencyBlockers.map((item) => item.id).join(", ")}).`
          : `Stopping before wave ${wave}: unresolved required inbound dependencies remain (${dependencyBlockers.map((item) => item.id).join(", ")}).`,
    };
  }
  if (wave === null) {
    const pendingHumanEntries = pendingHumanItemsForLane(lanePaths);
    if (pendingHumanEntries.length > 0) {
      return {
        kind: "human-input",
        dependencyBlockers: [],
        pendingHumanItems: pendingHumanEntries.map((entry) => entry.id),
        message: `Stopping finalization for lane ${lane}: pending human input remains (${pendingHumanEntries.map((entry) => `wave ${entry.wave}: ${entry.id}`).join(", ")}).`,
      };
    }
    return null;
  }
  const pendingHumanItems = pendingHumanItemsForWave(lanePaths, wave);
  if (pendingHumanItems.length > 0) {
    return {
      kind: "human-input",
      dependencyBlockers: [],
      pendingHumanItems,
      message: `Stopping before wave ${wave}: pending human input remains in the ledger (${pendingHumanItems.join(", ")}).`,
    };
  }
  return null;
}

export async function runAutonomousCli(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printUsage();
    return;
  }
  await maybeAnnouncePackageUpdate();
  const options = parsed.options;
  const allWaves = getWaveNumbers(options.lane);
  console.log(`[autonomous] lane=${options.lane} orchestrator=${options.orchestratorId}`);
  console.log(`[autonomous] executor=${options.executorMode}`);
  console.log(`[autonomous] codex_sandbox=${options.codexSandboxMode}`);
  console.log(`[autonomous] waves=${allWaves.join(", ")}`);

  const dryRunStatus = dryRun(options.lane);
  if (dryRunStatus !== 0) {
    throw new Error(`[autonomous] dry-run preflight failed with status=${dryRunStatus}`);
  }
  const feedbackListStatus = listPendingFeedback(options.lane);
  if (feedbackListStatus !== 0) {
    throw new Error(`[autonomous] feedback preflight failed with status=${feedbackListStatus}`);
  }
  const reconcileStatus = reconcile(options.lane);
  if (reconcileStatus !== 0) {
    throw new Error(`[autonomous] initial reconcile failed with status=${reconcileStatus}`);
  }

  let launchedCount = 0;
  const lanePaths = buildLanePaths(options.lane);
  while (true) {
    const completed = readRunState(lanePaths.defaultRunStatePath).completedWaves;
    const wave = nextIncompleteWave(allWaves, completed);
    if (wave === null) {
      const finalBarrier = readAutonomousBarrier(lanePaths, options.lane);
      if (finalBarrier) {
        throw new Error(finalBarrier.message);
      }
      console.log(`[autonomous] all waves complete for lane=${options.lane}`);
      break;
    }
    const barrier = readAutonomousBarrier(lanePaths, options.lane, wave);
    if (barrier) {
      throw new Error(barrier.message);
    }
    let success = false;
    for (let attempt = 1; attempt <= options.maxAttemptsPerWave; attempt += 1) {
      console.log(
        `\n[autonomous] launching wave ${wave} (attempt ${attempt}/${options.maxAttemptsPerWave})`,
      );
      const status = launchSingleWave({
        ...options,
        wave,
        attempt,
      });
      reconcile(options.lane);
      if (status === 0) {
        launchedCount += 1;
        success = true;
        console.log(`[autonomous] wave ${wave} completed.`);
        break;
      }
      console.warn(`[autonomous] wave ${wave} failed with status=${status}.`);
      if (attempt < options.maxAttemptsPerWave) {
        console.warn(`[autonomous] retrying wave ${wave}.`);
      }
    }
    if (!success) {
      throw new Error(`Stopping after repeated failures on wave ${wave}.`);
    }
  }
  const finalCompleted = readRunState(lanePaths.defaultRunStatePath).completedWaves;
  console.log(
    `[autonomous] launched waves=${launchedCount}; completed=${finalCompleted.join(", ") || "none"}`,
  );
}
