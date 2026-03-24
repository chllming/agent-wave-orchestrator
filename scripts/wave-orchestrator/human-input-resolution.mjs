import fs from "node:fs";
import path from "node:path";
import {
  appendCoordinationRecord,
  clarificationClosureCondition,
  clarificationLinkedRequests,
  isOpenCoordinationStatus,
  readMaterializedCoordinationState,
} from "./coordination-store.mjs";
import { readWaveHumanFeedbackRequests } from "./coordination.mjs";
import {
  readControlPlaneEvents,
  readWaveControlPlaneState,
  syncWaveControlPlaneProjections,
  waveControlPlaneLogPath,
} from "./control-plane.mjs";
import { readWaveLedger } from "./ledger.mjs";
import { readRunExecutionSummary } from "./launcher-gates.mjs";
import { buildResumePlan, clearWaveRelaunchPlan } from "./launcher-retry.mjs";
import { readWaveProofRegistry } from "./proof-registry.mjs";
import { buildDependencySnapshot, buildRequestAssignments, syncAssignmentRecords } from "./routing-state.mjs";
import { buildLanePaths } from "./shared.mjs";
import { reduceWaveState } from "./wave-state-reducer.mjs";
import { parseWaveFiles } from "./wave-files.mjs";
import { writeWaveRetryOverride } from "./retry-control.mjs";

function coordinationLogPath(lanePaths, waveNumber) {
  return path.join(lanePaths.coordinationDir, `wave-${waveNumber}.jsonl`);
}

function ledgerPath(lanePaths, waveNumber) {
  return path.join(lanePaths.ledgerDir, `wave-${waveNumber}.json`);
}

function coordinationTriagePath(lanePaths, waveNumber) {
  return path.join(lanePaths.feedbackTriageDir, `wave-${waveNumber}.jsonl`);
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

function appendTriageEscalationUpdateIfPresent(lanePaths, waveNumber, record) {
  const triagePath = coordinationTriagePath(lanePaths, waveNumber);
  if (!fs.existsSync(triagePath) || record?.kind !== "human-escalation") {
    return;
  }
  appendCoordinationRecord(triagePath, record);
}

function loadWave(lanePaths, waveNumber) {
  const waves = parseWaveFiles(lanePaths.wavesDir, { laneProfile: lanePaths.laneProfile });
  const wave = waves.find((entry) => entry.wave === waveNumber);
  if (!wave) {
    throw new Error(`Wave ${waveNumber} not found in ${lanePaths.wavesDir}`);
  }
  return wave;
}

function taskRunInfoForAgent(lanePaths, wave, agent, proofRegistry) {
  const safeName = `wave-${wave.wave}-${agent.slug}`;
  return {
    agent,
    logPath: path.join(lanePaths.logsDir, `${safeName}.log`),
    statusPath: path.join(lanePaths.statusDir, `${safeName}.status`),
    proofRegistry,
  };
}

function feedbackLinkMatchesRecord(record, requestId) {
  const normalizedRequestId = String(requestId || "").trim();
  if (!normalizedRequestId) {
    return false;
  }
  if (String(record?.id || "").trim() === normalizedRequestId) {
    return true;
  }
  if (
    Array.isArray(record?.artifactRefs) &&
    record.artifactRefs.some((ref) => String(ref || "").trim() === normalizedRequestId)
  ) {
    return true;
  }
  if (
    Array.isArray(record?.dependsOn) &&
    record.dependsOn.some((value) => String(value || "").trim() === normalizedRequestId)
  ) {
    return true;
  }
  return false;
}

function linkedClarificationIdsForRecords(records) {
  const ids = new Set();
  for (const record of records || []) {
    if (record?.kind === "clarification-request" && record?.id) {
      ids.add(record.id);
      continue;
    }
    const closureCondition = String(record?.closureCondition || "").trim();
    if (closureCondition.startsWith("clarification:")) {
      ids.add(closureCondition.slice("clarification:".length));
    }
  }
  return [...ids].filter(Boolean);
}

export function resolveFeedbackLinkedCoordination({
  lanePaths,
  wave,
  requestId,
  operator = "human-operator",
  detail = "",
}) {
  const logPath = coordinationLogPath(lanePaths, wave.wave);
  const state = readMaterializedCoordinationState(logPath);
  const resolvedRecords = [];

  const directlyLinked = state.latestRecords.filter((record) =>
    isOpenCoordinationStatus(record.status) && feedbackLinkMatchesRecord(record, requestId),
  );

  for (const record of directlyLinked) {
    const updated = appendCoordinationStatusUpdate(logPath, record, "resolved", {
      detail: detail || `Resolved after answered human input ${requestId}.`,
      summary: record.summary,
      source: operator,
    });
    resolvedRecords.push(updated);
    appendTriageEscalationUpdateIfPresent(lanePaths, wave.wave, updated);
  }

  const nextState = readMaterializedCoordinationState(logPath);
  const clarificationIds = linkedClarificationIdsForRecords([
    ...directlyLinked,
    ...resolvedRecords,
  ]);
  for (const clarificationId of clarificationIds) {
    const clarification = nextState.byId.get(clarificationId);
    if (!clarification || !isOpenCoordinationStatus(clarification.status)) {
      continue;
    }
    const updatedClarification = appendCoordinationStatusUpdate(logPath, clarification, "resolved", {
      detail: detail || `Resolved after answered human input ${requestId}.`,
      summary: clarification.summary,
      source: operator,
    });
    resolvedRecords.push(updatedClarification);
  }

  const resolvedState = readMaterializedCoordinationState(logPath);
  for (const clarificationId of clarificationIds) {
    const linkedRequests = clarificationLinkedRequests(resolvedState, clarificationId).filter((entry) =>
      isOpenCoordinationStatus(entry.status),
    );
    for (const linked of linkedRequests) {
      const updatedLinked = appendCoordinationStatusUpdate(logPath, linked, "resolved", {
        detail: `Resolved via clarification ${clarificationId}.`,
        summary: linked.summary,
        source: operator,
      });
      resolvedRecords.push(updatedLinked);
    }
    for (const escalation of (resolvedState.humanEscalations || []).filter(
      (entry) =>
        isOpenCoordinationStatus(entry.status) &&
        entry.closureCondition === clarificationClosureCondition(clarificationId),
    )) {
      const updatedEscalation = appendCoordinationStatusUpdate(logPath, escalation, "resolved", {
        detail: detail || `Resolved via clarification ${clarificationId}.`,
        summary: escalation.summary,
        source: operator,
      });
      resolvedRecords.push(updatedEscalation);
      appendTriageEscalationUpdateIfPresent(lanePaths, wave.wave, updatedEscalation);
    }
  }

  const assignmentState = readMaterializedCoordinationState(logPath);
  const ledger = readWaveLedger(ledgerPath(lanePaths, wave.wave)) || { phase: "planned" };
  const assignments = buildRequestAssignments({
    coordinationState: assignmentState,
    agents: wave.agents,
    ledger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  syncAssignmentRecords(logPath, {
    lane: lanePaths.lane,
    wave: wave.wave,
    assignments,
  });

  return {
    resolvedRecords,
    clarificationIds,
  };
}

export function buildResumePlanFromDisk({ lanePaths, wave }) {
  const proofRegistry = readWaveProofRegistry(lanePaths, wave.wave);
  const agentRuns = wave.agents.map((agent) =>
    taskRunInfoForAgent(lanePaths, wave, agent, proofRegistry),
  );
  const agentResults = Object.fromEntries(
    agentRuns
      .map((runInfo) => [runInfo.agent.agentId, readRunExecutionSummary(runInfo, wave)])
      .filter(([, summary]) => Boolean(summary)),
  );
  const coordinationState = readMaterializedCoordinationState(coordinationLogPath(lanePaths, wave.wave));
  const feedbackRequests = readWaveHumanFeedbackRequests({
    feedbackRequestsDir: lanePaths.feedbackRequestsDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agentIds: wave.agents.map((agent) => agent.agentId),
    orchestratorId: "",
  });
  const ledger = readWaveLedger(ledgerPath(lanePaths, wave.wave)) || { phase: "planned" };
  const dependencySnapshot = buildDependencySnapshot({
    dirPath: lanePaths.crossLaneDependenciesDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agents: wave.agents,
    ledger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  const reducerState = reduceWaveState({
    controlPlaneEvents: readControlPlaneEvents(waveControlPlaneLogPath(lanePaths, wave.wave)),
    coordinationRecords: coordinationState.latestRecords || [],
    agentResults,
    waveDefinition: wave,
    dependencyTickets: dependencySnapshot,
    feedbackRequests,
    laneConfig: {
      lane: lanePaths.lane,
      contQaAgentId: lanePaths.contQaAgentId || "A0",
      contEvalAgentId: lanePaths.contEvalAgentId || "E0",
      integrationAgentId: lanePaths.integrationAgentId || "A8",
      documentationAgentId: lanePaths.documentationAgentId || "A9",
      validationMode: "live",
      evalTargets: wave.evalTargets,
      benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
      laneProfile: lanePaths.laneProfile,
      requireIntegrationStewardFromWave: lanePaths.requireIntegrationStewardFromWave,
      capabilityRouting: lanePaths.capabilityRouting,
    },
  });
  return buildResumePlan(reducerState, {
    waveDefinition: wave,
    lanePaths,
  });
}

export function maybeWriteAutoResumeRequest({
  lanePaths,
  wave,
  requestedBy = "human-operator",
  reason = "",
}) {
  const controlState = readWaveControlPlaneState(lanePaths, wave.wave);
  if (controlState.activeAttempt || controlState.activeRerunRequest) {
    return null;
  }
  const resumePlan = buildResumePlanFromDisk({ lanePaths, wave });
  if (!resumePlan.canResume || resumePlan.reason === "human-request") {
    return { resumePlan, request: null };
  }
  if (resumePlan.resumeFromPhase === "completed") {
    return { resumePlan, request: null };
  }
  clearWaveRelaunchPlan(lanePaths, wave.wave);
  const payload = {
    requestedBy,
    reason:
      reason ||
      `Auto continuation after answered human input; resume from ${resumePlan.resumeFromPhase}.`,
    preserveReusableAgentIds: resumePlan.reusableAgentIds,
    reuseProofBundleIds: resumePlan.reusableProofBundleIds,
    applyOnce: true,
  };
  if (resumePlan.resumeFromPhase === "implementation") {
    payload.selectedAgentIds = resumePlan.invalidatedAgentIds;
  } else {
    payload.resumePhase = resumePlan.resumeFromPhase;
  }
  const request = writeWaveRetryOverride(lanePaths, wave.wave, payload);
  return { resumePlan, request };
}

export function answerHumanInputAndReconcile({
  lanePaths,
  wave,
  requestId,
  answeredPayload,
  operator = "human-operator",
}) {
  const detail =
    `Resolved after human input ${requestId} was answered by ${operator}` +
    (answeredPayload?.response?.text ? `: ${answeredPayload.response.text}` : ".");
  const resolution = resolveFeedbackLinkedCoordination({
    lanePaths,
    wave,
    requestId,
    operator,
    detail,
  });
  syncWaveControlPlaneProjections(
    lanePaths,
    wave.wave,
    readWaveControlPlaneState(lanePaths, wave.wave),
  );
  const autoResume = maybeWriteAutoResumeRequest({
    lanePaths,
    wave,
    requestedBy: operator,
    reason: `Auto continuation after answered human input ${requestId}.`,
  });
  return {
    resolution,
    autoResume,
  };
}

export function answerHumanInputByRequest({
  lane,
  waveNumber,
  requestId,
  operator = "human-operator",
  runId = null,
}) {
  const lanePaths = buildLanePaths(lane, { adhocRunId: runId || null });
  const wave = loadWave(lanePaths, waveNumber);
  return answerHumanInputAndReconcile({
    lanePaths,
    wave,
    requestId,
    operator,
  });
}
