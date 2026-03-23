import path from "node:path";
import { appendCoordinationRecord } from "./coordination-store.mjs";
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
  readWaveProofRegistry,
  registerWaveProofBundle,
} from "./proof-registry.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm exec wave proof show --lane <lane> --wave <n> [--agent <id>] [--json]
  pnpm exec wave proof register --lane <lane> --wave <n> --agent <id> --artifact <path> [--artifact <path> ...] [--component <id[:level]> ...] [--authoritative] [--satisfy-owned-components] [--completion <level>] [--durability <level>] [--proof-level <level>] [--doc-delta <state>] [--operator <name>] [--detail <text>] [--json]
  pnpm exec wave proof <subcommand> --run <id> [--wave 0] ...
`);
}

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const subcommand = String(args[0] || "").trim().toLowerCase();
  const options = {
    lane: "main",
    wave: null,
    runId: "",
    agentId: "",
    artifactPaths: [],
    components: [],
    authoritative: false,
    satisfyOwnedComponents: false,
    completion: "",
    durability: "",
    proofLevel: "",
    docDeltaState: "",
    operator: "human-operator",
    detail: "",
    json: false,
  };
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--lane") {
      options.lane = sanitizeLaneName(args[++i]);
    } else if (arg === "--run") {
      options.runId = sanitizeAdhocRunId(args[++i]);
    } else if (arg === "--wave") {
      options.wave = parseNonNegativeInt(args[++i], "--wave");
    } else if (arg === "--agent") {
      options.agentId = String(args[++i] || "").trim();
    } else if (arg === "--artifact") {
      options.artifactPaths.push(String(args[++i] || "").trim());
    } else if (arg === "--component") {
      options.components.push(String(args[++i] || "").trim());
    } else if (arg === "--authoritative") {
      options.authoritative = true;
    } else if (arg === "--satisfy-owned-components") {
      options.satisfyOwnedComponents = true;
    } else if (arg === "--completion") {
      options.completion = String(args[++i] || "").trim();
    } else if (arg === "--durability") {
      options.durability = String(args[++i] || "").trim();
    } else if (arg === "--proof-level") {
      options.proofLevel = String(args[++i] || "").trim();
    } else if (arg === "--doc-delta") {
      options.docDeltaState = String(args[++i] || "").trim();
    } else if (arg === "--operator") {
      options.operator = String(args[++i] || "").trim() || "human-operator";
    } else if (arg === "--detail") {
      options.detail = String(args[++i] || "").trim();
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

function loadWave(lanePaths, waveNumber) {
  const waves = parseWaveFiles(lanePaths.wavesDir, { laneProfile: lanePaths.laneProfile });
  const wave = waves.find((entry) => entry.wave === waveNumber);
  if (!wave) {
    throw new Error(`Wave ${waveNumber} not found in ${lanePaths.wavesDir}`);
  }
  return wave;
}

function resolveLaneForRun(runId, fallbackLane) {
  return (
    readJsonOrNull(path.join(REPO_ROOT, ".wave", "adhoc", "runs", runId, "result.json"))?.lane ||
    fallbackLane
  );
}

function coordinationLogPath(lanePaths, waveNumber) {
  return path.join(lanePaths.coordinationDir, `wave-${waveNumber}.jsonl`);
}

export async function runProofCli(argv) {
  const { help, subcommand, options } = parseArgs(argv);
  if (help || !subcommand) {
    printUsage();
    return;
  }
  if (!["show", "register"].includes(subcommand)) {
    throw new Error("Expected subcommand: show | register");
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
  if (subcommand === "show") {
    const registry = readWaveProofRegistry(lanePaths, wave.wave);
    const entries = options.agentId
      ? (registry?.entries || []).filter((entry) => entry.agentId === options.agentId)
      : (registry?.entries || []);
    const payload = {
      lane: lanePaths.lane,
      wave: wave.wave,
      entries,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (!options.agentId) {
    throw new Error("register requires --agent");
  }
  if (options.artifactPaths.length === 0) {
    throw new Error("register requires at least one --artifact");
  }
  const agent = (wave.agents || []).find((entry) => entry.agentId === options.agentId);
  if (!agent) {
    throw new Error(`Unknown wave agent id: ${options.agentId}`);
  }
  const { entry, registry } = registerWaveProofBundle({
    lanePaths,
    wave,
    agent,
    artifactPaths: options.artifactPaths,
    componentIds: options.components,
    authoritative: options.authoritative,
    satisfyOwnedComponents: options.satisfyOwnedComponents,
    completion: options.completion || null,
    durability: options.durability || null,
    proofLevel: options.proofLevel || null,
    docDeltaState: options.docDeltaState || null,
    detail: options.detail || "",
    recordedBy: options.operator || "human-operator",
  });
  appendCoordinationRecord(coordinationLogPath(lanePaths, wave.wave), {
    id: entry.id,
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId: options.operator || "human-operator",
    kind: "evidence",
    targets: [
      `agent:${agent.agentId}`,
      `agent:${wave.integrationAgentId || lanePaths.integrationAgentId || "A8"}`,
      `agent:${wave.contQaAgentId || lanePaths.contQaAgentId || "A0"}`,
    ],
    priority: options.authoritative ? "high" : "normal",
    artifactRefs: entry.artifacts.map((artifact) => artifact.path),
    summary:
      entry.summary ||
      `${entry.authoritative ? "Authoritative" : "Registered"} proof bundle for ${agent.agentId}`,
    detail:
      entry.detail ||
      `Proof bundle recorded for ${agent.agentId} by ${options.operator || "human-operator"}.`,
    status: "resolved",
    source: "operator",
  });
  const payload = {
    lane: lanePaths.lane,
    wave: wave.wave,
    entry,
    registry,
  };
  console.log(JSON.stringify(payload, null, 2));
}
