import fs from "node:fs";
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
  clarificationClosureCondition,
  clarificationLinkedRequests,
  compileAgentInbox,
  compileSharedSummary,
  isOpenCoordinationStatus,
  readJsonArtifact,
  readMaterializedCoordinationState,
  serializeCoordinationState,
  updateSeedRecords,
  writeCompiledInbox,
  writeCoordinationBoardProjection,
  writeJsonArtifact,
} from "./coordination-store.mjs";
import { answerFeedbackRequest } from "./feedback.mjs";
import { answerHumanInputAndReconcile } from "./human-input-resolution.mjs";
import { readWaveHumanFeedbackRequests } from "./coordination.mjs";
import { readWaveProofRegistry } from "./proof-registry.mjs";
import {
  readWaveRelaunchPlanSnapshot,
  readWaveRetryOverride,
  resolveRetryOverrideAgentIds,
} from "./retry-control.mjs";
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
  wave coord explain --lane <lane> --wave <n> [--agent <id>] [--json]
  wave coord act <resolve|dismiss|reroute|reassign|escalate|answer-human> --lane <lane> --wave <n> [options]
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
    status: "",
    id: "",
    to: "",
    response: "",
    operator: "human-operator",
    operation: "",
    json: false,
  };
  let startIndex = 1;
  if (subcommand === "act") {
    options.operation = String(args[1] || "").trim().toLowerCase();
    startIndex = 2;
  }
  for (let i = startIndex; i < args.length; i += 1) {
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
    } else if (arg === "--id") {
      options.id = String(args[++i] || "").trim();
    } else if (arg === "--to") {
      options.to = String(args[++i] || "").trim();
    } else if (arg === "--response") {
      options.response = String(args[++i] || "").trim();
    } else if (arg === "--operator") {
      options.operator = String(args[++i] || "").trim() || "human-operator";
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

function coordinationTriagePath(lanePaths, waveNumber) {
  return path.join(lanePaths.feedbackTriageDir, `wave-${waveNumber}.jsonl`);
}

function targetAgentId(target) {
  const value = String(target || "").trim();
  if (!value) {
    return "";
  }
  return value.startsWith("agent:") ? value.slice("agent:".length) : value;
}

function recordTargetsAgent(record, agentId) {
  return (
    String(record?.agentId || "").trim() === agentId ||
    (Array.isArray(record?.targets) &&
      record.targets.some((target) => targetAgentId(target) === agentId))
  );
}

function isLauncherSeedRequest(record) {
  return (
    record?.source === "launcher" &&
    record?.kind === "request" &&
    /^wave-\d+-agent-[^-]+-request$/.test(String(record?.id || "")) &&
    (!Array.isArray(record?.dependsOn) || record.dependsOn.length === 0) &&
    !String(record?.closureCondition || "").trim()
  );
}

function summarizeExplainPayload({
  lanePaths,
  wave,
  agentId = "",
  state,
  ledger,
  capabilityAssignments,
  dependencySnapshot,
  feedbackRequests,
  relaunchPlan,
  retryOverride,
  proofRegistry,
}) {
  const scopedOpenRecords = (state?.openRecords || []).filter((record) =>
    agentId ? recordTargetsAgent(record, agentId) : true,
  );
  const scopedAssignments = (capabilityAssignments || []).filter((assignment) =>
    agentId ? assignment.assignedAgentId === agentId : assignment.blocking,
  );
  const scopedDependencies = [
    ...((dependencySnapshot?.openInbound || []).filter((record) =>
      agentId ? record.assignedAgentId === agentId : true,
    )),
    ...((dependencySnapshot?.openOutbound || []).filter((record) =>
      agentId ? record.agentId === agentId : true,
    )),
  ];
  const scopedFeedback = (feedbackRequests || []).filter((request) =>
    agentId ? request.agentId === agentId : true,
  );
  const scopedProofEntries = (proofRegistry?.entries || []).filter((entry) =>
    agentId ? entry.agentId === agentId : true,
  );
  const blockedBy = [];
  if (
    scopedOpenRecords.some(
      (record) => record.kind === "clarification-request" && isOpenCoordinationStatus(record.status),
    )
  ) {
    blockedBy.push("open clarification chain");
  }
  if (scopedAssignments.some((assignment) => assignment.blocking)) {
    blockedBy.push("blocking helper assignment");
  }
  if (scopedDependencies.length > 0) {
    blockedBy.push("open dependency");
  }
  if (scopedFeedback.some((request) => request.status === "pending")) {
    blockedBy.push("pending human feedback");
  }
  if (
    (state?.humanEscalations || []).some(
      (record) => isOpenCoordinationStatus(record.status) && (!agentId || recordTargetsAgent(record, agentId)),
    )
  ) {
    blockedBy.push("open human escalation");
  }
  if (
    scopedOpenRecords.some(
      (record) =>
        record.kind === "request" &&
        isOpenCoordinationStatus(record.status) &&
        !isLauncherSeedRequest(record),
    )
  ) {
    blockedBy.push("targeted open request");
  }
  return {
    lane: lanePaths.lane,
    wave: wave.wave,
    phase: ledger?.phase || "unknown",
    agentId: agentId || null,
    blockedBy,
    openCoordination: scopedOpenRecords.map((record) => ({
      id: record.id,
      kind: record.kind,
      status: record.status,
      agentId: record.agentId,
      targets: record.targets || [],
      summary: record.summary || record.detail || "",
    })),
    helperAssignments: scopedAssignments,
    dependencies: scopedDependencies,
    humanFeedback: scopedFeedback,
    relaunchPlan,
    retryOverride,
    effectiveRetryTargets: resolveRetryOverrideAgentIds(wave, lanePaths, retryOverride).length > 0
      ? resolveRetryOverrideAgentIds(wave, lanePaths, retryOverride)
      : relaunchPlan?.selectedAgentIds || [],
    proofEntries: scopedProofEntries,
  };
}

function appendCoordinationStatusUpdate(logPath, record, status, options = {}) {
  return appendCoordinationRecord(logPath, {
    ...record,
    status,
    summary: options.summary || record.summary,
    detail: options.detail || record.detail,
    source: options.source || "operator",
  });
}

function defaultStatusForKind(kind) {
  return String(kind || "").trim().toLowerCase() === "resolved-by-policy" ? "resolved" : "open";
}

function appendTriageEscalationUpdateIfPresent(lanePaths, waveNumber, record) {
  const triagePath = coordinationTriagePath(lanePaths, waveNumber);
  if (!fs.existsSync(triagePath) || record?.kind !== "human-escalation") {
    return;
  }
  appendCoordinationRecord(triagePath, record);
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
  if (subcommand === "explain") {
    const state = readMaterializedCoordinationState(logPath);
    const ledger = readWaveLedger(ledgerPath(lanePaths, wave.wave)) || { phase: "planned" };
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
    const feedbackRequests = readWaveHumanFeedbackRequests({
      feedbackRequestsDir: lanePaths.feedbackRequestsDir,
      lane: lanePaths.lane,
      waveNumber: wave.wave,
      agentIds: wave.agents.map((agent) => agent.agentId),
      orchestratorId: "",
    });
    const payload = summarizeExplainPayload({
      lanePaths,
      wave,
      agentId: options.agent || "",
      state,
      ledger,
      capabilityAssignments,
      dependencySnapshot,
      feedbackRequests,
      relaunchPlan: readWaveRelaunchPlanSnapshot(lanePaths, wave.wave),
      retryOverride: readWaveRetryOverride(lanePaths, wave.wave),
      proofRegistry: readWaveProofRegistry(lanePaths, wave.wave),
    });
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }
  ensureDirectory(lanePaths.coordinationDir);
  ensureDirectory(lanePaths.controlDir);
  ensureDirectory(lanePaths.assignmentsDir);
  ensureDirectory(lanePaths.inboxesDir);
  ensureDirectory(lanePaths.messageboardsDir);
  ensureDirectory(lanePaths.docsQueueDir);
  ensureDirectory(lanePaths.ledgerDir);
  ensureDirectory(lanePaths.integrationDir);
  ensureDirectory(lanePaths.proofDir);
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
    feedbackRequests: readWaveHumanFeedbackRequests({
      feedbackRequestsDir: lanePaths.feedbackRequestsDir,
      lane: lanePaths.lane,
      waveNumber: wave.wave,
      agentIds: wave.agents.map((agent) => agent.agentId),
      orchestratorId: "",
    }),
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
      status: options.status || defaultStatusForKind(options.kind),
      source: "agent",
    });
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  if (subcommand === "act") {
    if (!options.operation) {
      throw new Error("act requires an operation");
    }
    if (options.operation === "answer-human") {
      if (!options.id || !options.response) {
        throw new Error("answer-human requires --id and --response");
      }
      const answered = answerFeedbackRequest({
        feedbackStateDir: lanePaths.feedbackStateDir,
        feedbackRequestsDir: lanePaths.feedbackRequestsDir,
        requestId: options.id,
        response: options.response,
        operator: options.operator,
        force: true,
        recordTelemetry: true,
      });
      answerHumanInputAndReconcile({
        lanePaths,
        wave,
        requestId: options.id,
        answeredPayload: answered,
        operator: options.operator,
      });
      console.log(JSON.stringify(answered, null, 2));
      return;
    }
    if (!options.id) {
      throw new Error("act requires --id");
    }
    const state = readMaterializedCoordinationState(logPath);
    const record = state.byId.get(options.id);
    if (!record) {
      throw new Error(`Coordination record not found: ${options.id}`);
    }
    if (options.operation === "resolve" || options.operation === "dismiss") {
      const nextStatus = options.operation === "resolve" ? "resolved" : "cancelled";
      const updated = appendCoordinationStatusUpdate(logPath, record, nextStatus, {
        detail: options.detail || record.detail,
        summary: options.summary || record.summary,
      });
      if (record.kind === "clarification-request") {
        const linkedRequests = clarificationLinkedRequests(state, record.id).filter((entry) =>
          isOpenCoordinationStatus(entry.status),
        );
        for (const linked of linkedRequests) {
          appendCoordinationStatusUpdate(logPath, linked, nextStatus, {
            detail:
              options.detail ||
              `${options.operation === "resolve" ? "Resolved" : "Cancelled"} via clarification ${record.id}.`,
            summary: linked.summary,
          });
        }
        for (const escalation of (state.humanEscalations || []).filter(
          (entry) =>
            isOpenCoordinationStatus(entry.status) &&
            entry.closureCondition === clarificationClosureCondition(record.id),
        )) {
          const updatedEscalation = appendCoordinationStatusUpdate(logPath, escalation, nextStatus, {
            detail:
              options.detail ||
              `${options.operation === "resolve" ? "Resolved" : "Cancelled"} via clarification ${record.id}.`,
            summary: escalation.summary,
          });
          appendTriageEscalationUpdateIfPresent(lanePaths, wave.wave, updatedEscalation);
        }
      }
      appendTriageEscalationUpdateIfPresent(lanePaths, wave.wave, updated);
      console.log(JSON.stringify(updated, null, 2));
      return;
    }
    if (options.operation === "reroute" || options.operation === "reassign") {
      if (!options.to) {
        throw new Error(`${options.operation} requires --to`);
      }
      const closureCondition =
        record.kind === "clarification-request"
          ? clarificationClosureCondition(record.id)
          : record.closureCondition || "";
      appendCoordinationStatusUpdate(logPath, record, "superseded", {
        detail:
          options.detail ||
          `${record.id} superseded by operator ${options.operation} to ${options.to}.`,
        summary: record.summary,
      });
      const rerouted = appendCoordinationRecord(logPath, {
        lane: lanePaths.lane,
        wave: wave.wave,
        agentId: options.agent || "operator",
        kind: "request",
        targets: [`agent:${options.to}`],
        priority: record.priority,
        artifactRefs: record.artifactRefs,
        dependsOn:
          record.kind === "clarification-request"
            ? [record.id]
            : Array.from(new Set([record.id, ...(record.dependsOn || [])])),
        closureCondition,
        summary: record.summary,
        detail:
          options.detail ||
          `${record.kind === "clarification-request" ? "Clarification" : "Request"} rerouted to ${options.to}.`,
        status: "open",
        source: "operator",
      });
      if (record.kind === "clarification-request") {
        appendCoordinationStatusUpdate(logPath, record, "in_progress", {
          detail: `Awaiting routed follow-up from ${options.to}.`,
          summary: record.summary,
        });
      }
      console.log(JSON.stringify(rerouted, null, 2));
      return;
    }
    if (options.operation === "escalate") {
      const escalation = appendCoordinationRecord(logPath, {
        id: `escalation-${record.id}`,
        lane: lanePaths.lane,
        wave: wave.wave,
        agentId: options.agent || "operator",
        kind: "human-escalation",
        targets: record.targets,
        priority: "high",
        artifactRefs: record.artifactRefs,
        dependsOn: [record.id],
        closureCondition:
          record.kind === "clarification-request"
            ? clarificationClosureCondition(record.id)
            : record.closureCondition || "",
        summary: record.summary,
        detail: options.detail || record.detail,
        status: "open",
        source: "operator",
      });
      appendTriageEscalationUpdateIfPresent(lanePaths, wave.wave, escalation);
      console.log(JSON.stringify(escalation, null, 2));
      return;
    }
    throw new Error(`Unknown coord action: ${options.operation}`);
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
