import path from "node:path";
import {
  appendDependencyTicket,
  materializeCoordinationState,
  readDependencyTickets,
} from "./coordination-store.mjs";
import { writeDependencySnapshot } from "./artifact-schemas.mjs";
import {
  buildDependencySnapshot,
  readAllDependencyTickets,
  renderDependencySnapshotMarkdown,
} from "./routing-state.mjs";
import { buildLanePaths, ensureDirectory, parseNonNegativeInt, writeTextAtomic } from "./shared.mjs";
import { parseWaveFiles } from "./wave-files.mjs";

function printUsage() {
  console.log(`Usage:
  wave dep post --owner-lane <lane> --requester-lane <lane> --owner-wave <n> --requester-wave <n> --agent <id> --summary <text> [options]
  wave dep show --lane <lane> [--wave <n>] [--json]
  wave dep resolve --lane <lane> --id <id> --agent <id> [--detail <text>] [--status resolved|closed]
  wave dep render --lane <lane> [--wave <n>] [--json]
`);
}

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const subcommand = String(args[0] || "").trim().toLowerCase();
  const options = {
    lane: "",
    ownerLane: "",
    requesterLane: "",
    wave: null,
    ownerWave: null,
    requesterWave: null,
    agent: "",
    id: "",
    summary: "",
    detail: "",
    targets: [],
    artifacts: [],
    closureCondition: "",
    priority: "high",
    status: "",
    required: false,
    json: false,
  };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--lane") {
      options.lane = String(args[++index] || "").trim();
    } else if (arg === "--owner-lane") {
      options.ownerLane = String(args[++index] || "").trim();
    } else if (arg === "--requester-lane") {
      options.requesterLane = String(args[++index] || "").trim();
    } else if (arg === "--wave") {
      options.wave = parseNonNegativeInt(args[++index], "--wave");
    } else if (arg === "--owner-wave") {
      options.ownerWave = parseNonNegativeInt(args[++index], "--owner-wave");
    } else if (arg === "--requester-wave") {
      options.requesterWave = parseNonNegativeInt(args[++index], "--requester-wave");
    } else if (arg === "--agent") {
      options.agent = String(args[++index] || "").trim();
    } else if (arg === "--id") {
      options.id = String(args[++index] || "").trim();
    } else if (arg === "--summary") {
      options.summary = String(args[++index] || "").trim();
    } else if (arg === "--detail") {
      options.detail = String(args[++index] || "").trim();
    } else if (arg === "--target") {
      options.targets.push(String(args[++index] || "").trim());
    } else if (arg === "--artifact") {
      options.artifacts.push(String(args[++index] || "").trim());
    } else if (arg === "--closure-condition") {
      options.closureCondition = String(args[++index] || "").trim();
    } else if (arg === "--priority") {
      options.priority = String(args[++index] || "").trim();
    } else if (arg === "--status") {
      options.status = String(args[++index] || "").trim();
    } else if (arg === "--required") {
      options.required = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg && arg !== "--") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!subcommand) {
    throw new Error("Expected subcommand");
  }
  return { subcommand, options };
}

function dependencyFilePath(lanePaths, lane) {
  return path.join(lanePaths.crossLaneDependenciesDir, `${lane}.jsonl`);
}

function dependencyMarkdownPath(lanePaths, lane) {
  return path.join(lanePaths.crossLaneDependenciesDir, `${lane}.md`);
}

function loadWaveAgents(lanePaths, waveNumber) {
  if (waveNumber === null || waveNumber === undefined) {
    return [];
  }
  const waves = parseWaveFiles(lanePaths.wavesDir, { laneProfile: lanePaths.laneProfile });
  return waves.find((wave) => wave.wave === waveNumber)?.agents || [];
}

export async function runDependencyCli(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const { subcommand, options } = parseArgs(argv);
  const baseLane = options.lane || options.ownerLane || options.requesterLane || "main";
  const lanePaths = buildLanePaths(baseLane);
  ensureDirectory(lanePaths.crossLaneDependenciesDir);

  if (subcommand === "post") {
    const ownerLane = options.ownerLane || options.lane;
    const requesterLane = options.requesterLane || lanePaths.lane;
    if (!ownerLane || !requesterLane || options.ownerWave === null || options.requesterWave === null) {
      throw new Error("--owner-lane, --requester-lane, --owner-wave, and --requester-wave are required");
    }
    if (!options.agent || !options.summary) {
      throw new Error("--agent and --summary are required");
    }
    const record = appendDependencyTicket(lanePaths.crossLaneDependenciesDir, ownerLane, {
      id: options.id || `dep-${Date.now().toString(36)}`,
      kind: "request",
      lane: ownerLane,
      wave: options.ownerWave,
      ownerLane,
      ownerWave: options.ownerWave,
      requesterLane,
      requesterWave: options.requesterWave,
      agentId: options.agent,
      targets: options.targets,
      priority: options.priority,
      summary: options.summary,
      detail: options.detail,
      artifactRefs: options.artifacts,
      status: options.status || "open",
      closureCondition:
        options.closureCondition || (options.required ? "required=true" : ""),
      source: "launcher",
      required: options.required,
    });
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (subcommand === "resolve") {
    const lane = options.lane || options.ownerLane;
    if (!lane || !options.id || !options.agent) {
      throw new Error("--lane, --id, and --agent are required for resolve");
    }
    const filePath = dependencyFilePath(lanePaths, lane);
    const latest = materializeCoordinationState(readDependencyTickets(lanePaths.crossLaneDependenciesDir, lane)).byId.get(
      options.id,
    );
    if (!latest) {
      throw new Error(`Dependency ${options.id} not found for lane ${lane}`);
    }
    const record = appendDependencyTicket(lanePaths.crossLaneDependenciesDir, lane, {
      ...latest,
      agentId: options.agent,
      status: options.status || "resolved",
      detail: options.detail || latest.detail,
      updatedAt: undefined,
    });
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (subcommand === "show") {
    const lane = options.lane || options.ownerLane || lanePaths.lane;
    const records =
      options.wave === null
        ? readAllDependencyTickets(lanePaths.crossLaneDependenciesDir).filter(
            (record) => record.ownerLane === lane || record.requesterLane === lane || record.lane === lane,
          )
        : buildDependencySnapshot({
            dirPath: lanePaths.crossLaneDependenciesDir,
            lane,
            waveNumber: options.wave,
            agents: loadWaveAgents(lanePaths, options.wave),
            capabilityRouting: lanePaths.capabilityRouting,
          });
    if (options.json || options.wave !== null) {
      console.log(JSON.stringify(records, null, 2));
    } else {
      for (const record of records) {
        console.log(
          `${record.updatedAt} ${record.id} ${record.status} ${record.summary || record.detail || ""}`,
        );
      }
    }
    return;
  }

  if (subcommand === "render") {
    const lane = options.lane || options.ownerLane || lanePaths.lane;
    const snapshot = buildDependencySnapshot({
      dirPath: lanePaths.crossLaneDependenciesDir,
      lane,
      waveNumber: options.wave ?? 0,
      agents: loadWaveAgents(lanePaths, options.wave ?? 0),
      capabilityRouting: lanePaths.capabilityRouting,
    });
    const markdownPath = dependencyMarkdownPath(lanePaths, lane);
    writeDependencySnapshot(path.join(lanePaths.crossLaneDependenciesDir, `${lane}.json`), snapshot, {
      lane,
      wave: options.wave ?? 0,
    });
    writeTextAtomic(markdownPath, `${renderDependencySnapshotMarkdown(snapshot)}\n`);
    console.log(JSON.stringify({ markdownPath, jsonPath: path.join(lanePaths.crossLaneDependenciesDir, `${lane}.json`) }, null, 2));
    return;
  }

  throw new Error(`Unknown dep subcommand: ${subcommand}`);
}
