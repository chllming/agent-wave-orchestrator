import path from "node:path";
import { buildDocsQueue, readDocsQueue, writeDocsQueue } from "./docs-queue.mjs";
import { readWaveLedger, writeWaveLedger } from "./ledger.mjs";
import {
  buildDependencySnapshot,
  buildRequestAssignments,
  writeDependencySnapshotMarkdown,
} from "./routing-state.mjs";
import {
  appendCoordinationRecord,
  compileAgentInbox,
  compileSharedSummary,
  readJsonArtifact,
  readMaterializedCoordinationState,
  serializeCoordinationState,
  updateSeedRecords,
  writeCompiledInbox,
  writeCoordinationBoardProjection,
  writeJsonArtifact,
} from "./coordination-store.mjs";
import { writeAssignmentSnapshot, writeDependencySnapshot } from "./artifact-schemas.mjs";
import {
  buildLanePaths,
  ensureDirectory,
  parseNonNegativeInt,
  readJsonOrNull,
  REPO_ROOT,
  sanitizeAdhocRunId,
} from "./shared.mjs";
import { parseWaveFiles } from "./wave-files.mjs";

function printUsage() {
  console.log(`Usage:
  wave coord post --lane <lane> --wave <n> --agent <id> --kind <kind> --summary <text> [--dry-run] [options]
  wave coord show --lane <lane> --wave <n> [--dry-run] [--json]
  wave coord render --lane <lane> --wave <n> [--dry-run]
  wave coord inbox --lane <lane> --wave <n> --agent <id> [--dry-run]
  wave coord <subcommand> --run <id> [--wave 0] ...
`);
}

function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const subcommand = String(args[0] || "").trim().toLowerCase();
  const options = {
    lane: "main",
    wave: null,
    runId: "",
    dryRun: false,
    agent: "",
    kind: "",
    summary: "",
    detail: "",
    targets: [],
    priority: "normal",
    dependsOn: [],
    artifactRefs: [],
    status: "open",
    json: false,
  };
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--lane") {
      options.lane = String(args[++i] || "").trim();
    } else if (arg === "--run") {
      options.runId = sanitizeAdhocRunId(args[++i]);
    } else if (arg === "--wave") {
      options.wave = parseNonNegativeInt(args[++i], "--wave");
    } else if (arg === "--agent") {
      options.agent = String(args[++i] || "").trim();
    } else if (arg === "--kind") {
      options.kind = String(args[++i] || "").trim();
    } else if (arg === "--summary") {
      options.summary = String(args[++i] || "").trim();
    } else if (arg === "--detail") {
      options.detail = String(args[++i] || "").trim();
    } else if (arg === "--target") {
      options.targets.push(String(args[++i] || "").trim());
    } else if (arg === "--priority") {
      options.priority = String(args[++i] || "").trim();
    } else if (arg === "--depends-on") {
      options.dependsOn.push(String(args[++i] || "").trim());
    } else if (arg === "--artifact") {
      options.artifactRefs.push(String(args[++i] || "").trim());
    } else if (arg === "--status") {
      options.status = String(args[++i] || "").trim();
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg && arg !== "--") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!subcommand) {
    throw new Error("Expected subcommand");
  }
  return { subcommand, options };
}

function resolveLaneForRun(runId, fallbackLane) {
  const resultPath = path.join(REPO_ROOT, ".wave", "adhoc", "runs", runId, "result.json");
  return readJsonOrNull(resultPath)?.lane || fallbackLane;
}

function loadWave(lanePaths, waveNumber) {
  const waves = parseWaveFiles(lanePaths.wavesDir, { laneProfile: lanePaths.laneProfile });
  const wave = waves.find((item) => item.wave === waveNumber);
  if (!wave) {
    throw new Error(`Wave ${waveNumber} not found in ${lanePaths.wavesDir}`);
  }
  return wave;
}

function coordinationLogPath(lanePaths, waveNumber) {
  return path.join(lanePaths.coordinationDir, `wave-${waveNumber}.jsonl`);
}

function messageBoardPath(lanePaths, waveNumber) {
  return path.join(lanePaths.messageboardsDir, `wave-${waveNumber}.md`);
}

function docsQueuePath(lanePaths, waveNumber) {
  return path.join(lanePaths.docsQueueDir, `wave-${waveNumber}.json`);
}

function ledgerPath(lanePaths, waveNumber) {
  return path.join(lanePaths.ledgerDir, `wave-${waveNumber}.json`);
}

function assignmentsPath(lanePaths, waveNumber) {
  return path.join(lanePaths.assignmentsDir, `wave-${waveNumber}.json`);
}

function dependencySnapshotPath(lanePaths, waveNumber) {
  return path.join(lanePaths.dependencySnapshotsDir, `wave-${waveNumber}.json`);
}

function dependencySnapshotMarkdownPath(lanePaths, waveNumber) {
  return path.join(lanePaths.dependencySnapshotsDir, `wave-${waveNumber}.md`);
}

function integrationPath(lanePaths, waveNumber) {
  return path.join(lanePaths.integrationDir, `wave-${waveNumber}.json`);
}

export async function runCoordinationCli(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const { subcommand, options } = parseArgs(argv);
  if (options.runId) {
    options.lane = resolveLaneForRun(options.runId, options.lane);
  }
  const lanePaths = buildLanePaths(options.lane, {
    runVariant: options.dryRun ? "dry-run" : undefined,
    adhocRunId: options.runId || null,
  });
  if (options.wave === null && options.runId) {
    options.wave = 0;
  }
  if (options.wave === null) {
    throw new Error("--wave is required");
  }
  const wave = loadWave(lanePaths, options.wave);
  const logPath = coordinationLogPath(lanePaths, wave.wave);
  if (subcommand === "show") {
    const state = readMaterializedCoordinationState(logPath);
    if (options.json) {
      console.log(JSON.stringify(serializeCoordinationState(state), null, 2));
    } else {
      for (const record of state.latestRecords) {
        console.log(`${record.updatedAt} ${record.agentId} ${record.kind}/${record.status} ${record.summary}`);
      }
    }
    return;
  }
  ensureDirectory(lanePaths.coordinationDir);
  ensureDirectory(lanePaths.assignmentsDir);
  ensureDirectory(lanePaths.inboxesDir);
  ensureDirectory(lanePaths.messageboardsDir);
  ensureDirectory(lanePaths.docsQueueDir);
  ensureDirectory(lanePaths.ledgerDir);
  ensureDirectory(lanePaths.integrationDir);
  ensureDirectory(lanePaths.dependencySnapshotsDir);
  updateSeedRecords(logPath, {
    lane: lanePaths.lane,
    wave: wave.wave,
    agents: wave.agents,
    componentPromotions: wave.componentPromotions,
    sharedPlanDocs: lanePaths.sharedPlanDocs,
    contQaAgentId: lanePaths.contQaAgentId,
    contEvalAgentId: lanePaths.contEvalAgentId,
    integrationAgentId: lanePaths.integrationAgentId,
    documentationAgentId: lanePaths.documentationAgentId,
    feedbackRequests: [],
  });
  if (subcommand === "post") {
    if (!options.agent || !options.kind || !options.summary) {
      throw new Error("--agent, --kind, and --summary are required for post");
    }
    const record = appendCoordinationRecord(logPath, {
      lane: lanePaths.lane,
      wave: wave.wave,
      agentId: options.agent,
      kind: options.kind,
      summary: options.summary,
      detail: options.detail,
      targets: options.targets,
      priority: options.priority,
      dependsOn: options.dependsOn,
      artifactRefs: options.artifactRefs,
      status: options.status,
      source: "agent",
    });
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  const state = readMaterializedCoordinationState(logPath);
  const queue =
    readDocsQueue(docsQueuePath(lanePaths, wave.wave)) ||
    buildDocsQueue({
      lane: lanePaths.lane,
      wave,
      summariesByAgentId: {},
      sharedPlanDocs: lanePaths.sharedPlanDocs,
      componentPromotions: wave.componentPromotions,
    });
  writeDocsQueue(docsQueuePath(lanePaths, wave.wave), queue);
  const ledger = readWaveLedger(ledgerPath(lanePaths, wave.wave)) || {
    wave: wave.wave,
    lane: lanePaths.lane,
    phase: "planned",
    tasks: [],
  };
  writeWaveLedger(ledgerPath(lanePaths, wave.wave), ledger);
  const integrationSummary = readJsonArtifact(integrationPath(lanePaths, wave.wave));
  const capabilityAssignments = buildRequestAssignments({
    coordinationState: state,
    agents: wave.agents,
    ledger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  const dependencySnapshot = buildDependencySnapshot({
    dirPath: lanePaths.crossLaneDependenciesDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agents: wave.agents,
    ledger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  writeAssignmentSnapshot(assignmentsPath(lanePaths, wave.wave), capabilityAssignments, {
    lane: lanePaths.lane,
    wave: wave.wave,
  });
  writeDependencySnapshot(dependencySnapshotPath(lanePaths, wave.wave), dependencySnapshot, {
    lane: lanePaths.lane,
    wave: wave.wave,
  });
  writeDependencySnapshotMarkdown(
    dependencySnapshotMarkdownPath(lanePaths, wave.wave),
    dependencySnapshot,
  );
  if (subcommand === "render") {
    const boardPath = messageBoardPath(lanePaths, wave.wave);
    writeCoordinationBoardProjection(boardPath, {
      wave: wave.wave,
      waveFile: wave.file,
      agents: wave.agents,
      state,
      capabilityAssignments,
      dependencySnapshot,
    });
    console.log(path.relative(process.cwd(), boardPath));
    return;
  }
  if (subcommand === "inbox") {
    if (!options.agent) {
      throw new Error("--agent is required for inbox");
    }
    const agent = wave.agents.find((item) => item.agentId === options.agent);
    if (!agent) {
      throw new Error(`Agent ${options.agent} not found in wave ${wave.wave}`);
    }
    const shared = compileSharedSummary({
      wave,
      state,
      ledger,
      integrationSummary,
      capabilityAssignments,
      dependencySnapshot,
    });
    const inbox = compileAgentInbox({
      wave,
      agent,
      state,
      ledger,
      docsQueue: queue,
      integrationSummary,
      capabilityAssignments,
      dependencySnapshot,
    });
    const baseDir = path.join(lanePaths.inboxesDir, `wave-${wave.wave}`);
    ensureDirectory(baseDir);
    const sharedPath = path.join(baseDir, "shared-summary.md");
    const inboxPath = path.join(baseDir, `${agent.agentId}.md`);
    writeCompiledInbox(sharedPath, shared.text);
    writeCompiledInbox(inboxPath, inbox.text);
    writeJsonArtifact(path.join(baseDir, `${agent.agentId}.json`), {
      sharedPath,
      inboxPath,
    });
    console.log(JSON.stringify({ sharedPath, inboxPath }, null, 2));
    return;
  }
  throw new Error(`Unknown coord subcommand: ${subcommand}`);
}
