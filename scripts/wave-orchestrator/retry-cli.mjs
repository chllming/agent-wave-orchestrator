import path from "node:path";
import { parseWaveFiles } from "./wave-files.mjs";
import {
  buildLanePaths,
  parseNonNegativeInt,
  readJsonOrNull,
  REPO_ROOT,
  sanitizeAdhocRunId,
  sanitizeLaneName,
} from "./shared.mjs";
import {
  clearWaveRetryOverride,
  readWaveRelaunchPlanSnapshot,
  readWaveRetryOverride,
  resolveRetryOverrideAgentIds,
  writeWaveRetryOverride,
} from "./retry-control.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm exec wave retry show --lane <lane> --wave <n> [--json]
  pnpm exec wave retry apply --lane <lane> --wave <n> [--agent <id> ...] [--clear-reuse <id> ...] [--preserve-reuse <id> ...] [--resume-phase <phase>] [--requested-by <name>] [--reason <text>] [--json]
  pnpm exec wave retry clear --lane <lane> --wave <n>
  pnpm exec wave retry <subcommand> --run <id> [--wave 0] ...
`);
}

function normalizeAgentList(values) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const subcommand = String(args[0] || "").trim().toLowerCase();
  const options = {
    lane: "main",
    wave: null,
    runId: "",
    json: false,
    selectedAgentIds: [],
    clearReusableAgentIds: [],
    preserveReusableAgentIds: [],
    resumePhase: "",
    requestedBy: "",
    reason: "",
  };
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--lane") {
      options.lane = sanitizeLaneName(args[++i]);
    } else if (arg === "--run") {
      options.runId = sanitizeAdhocRunId(args[++i]);
    } else if (arg === "--wave") {
      options.wave = parseNonNegativeInt(args[++i], "--wave");
    } else if (arg === "--agent" || arg === "--agents") {
      options.selectedAgentIds.push(args[++i]);
    } else if (arg === "--clear-reuse") {
      options.clearReusableAgentIds.push(args[++i]);
    } else if (arg === "--preserve-reuse") {
      options.preserveReusableAgentIds.push(args[++i]);
    } else if (arg === "--resume-phase") {
      options.resumePhase = String(args[++i] || "").trim();
    } else if (arg === "--requested-by") {
      options.requestedBy = String(args[++i] || "").trim();
    } else if (arg === "--reason") {
      options.reason = String(args[++i] || "").trim();
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, subcommand, options };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { help: false, subcommand, options };
}

function resolveLaneForRun(runId, fallbackLane) {
  return (
    readJsonOrNull(path.join(REPO_ROOT, ".wave", "adhoc", "runs", runId, "result.json"))?.lane ||
    fallbackLane
  );
}

function loadWave(lanePaths, waveNumber) {
  const waves = parseWaveFiles(lanePaths.wavesDir, { laneProfile: lanePaths.laneProfile });
  const wave = waves.find((entry) => entry.wave === waveNumber);
  if (!wave) {
    throw new Error(`Wave ${waveNumber} not found in ${lanePaths.wavesDir}`);
  }
  return wave;
}

export async function runRetryCli(argv) {
  const { help, subcommand, options } = parseArgs(argv);
  if (help || !subcommand) {
    printUsage();
    return;
  }
  if (!["show", "apply", "clear"].includes(subcommand)) {
    throw new Error("Expected subcommand: show | apply | clear");
  }
  if (options.runId) {
    options.lane = resolveLaneForRun(options.runId, options.lane);
  }
  const lanePaths = buildLanePaths(options.lane, {
    adhocRunId: options.runId || null,
  });
  if (options.wave === null && options.runId) {
    options.wave = 0;
  }
  if (options.wave === null) {
    throw new Error("--wave is required");
  }
  const wave = loadWave(lanePaths, options.wave);
  if (subcommand === "clear") {
    clearWaveRetryOverride(lanePaths, wave.wave);
    console.log(`[wave-retry] cleared override for wave ${wave.wave}`);
    return;
  }

  const existingOverride = readWaveRetryOverride(lanePaths, wave.wave);
  const relaunchPlan = readWaveRelaunchPlanSnapshot(lanePaths, wave.wave);
  if (subcommand === "show") {
    const payload = {
      wave: wave.wave,
      lane: lanePaths.lane,
      override: existingOverride,
      effectiveSelectedAgentIds: resolveRetryOverrideAgentIds(wave, lanePaths, existingOverride),
      relaunchPlan,
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }

  const selectedAgentIds = normalizeAgentList(options.selectedAgentIds);
  const clearReusableAgentIds = normalizeAgentList(options.clearReusableAgentIds);
  const preserveReusableAgentIds = normalizeAgentList(options.preserveReusableAgentIds);
  const knownAgentIds = new Set((wave.agents || []).map((agent) => agent.agentId));
  const unknownAgentIds = [
    ...selectedAgentIds,
    ...clearReusableAgentIds,
    ...preserveReusableAgentIds,
  ].filter((agentId) => !knownAgentIds.has(agentId));
  if (unknownAgentIds.length > 0) {
    throw new Error(`Unknown wave agent ids: ${unknownAgentIds.join(", ")}`);
  }
  if (selectedAgentIds.length === 0 && !String(options.resumePhase || "").trim()) {
    throw new Error("apply requires --agent/--agents or --resume-phase");
  }
  const override = writeWaveRetryOverride(lanePaths, wave.wave, {
    lane: lanePaths.lane,
    wave: wave.wave,
    selectedAgentIds,
    clearReusableAgentIds,
    preserveReusableAgentIds,
    resumePhase: options.resumePhase || null,
    requestedBy: options.requestedBy || "human-operator",
    reason: options.reason || null,
    applyOnce: true,
  });
  const payload = {
    wave: wave.wave,
    lane: lanePaths.lane,
    override,
    effectiveSelectedAgentIds: resolveRetryOverrideAgentIds(wave, lanePaths, override),
  };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}
