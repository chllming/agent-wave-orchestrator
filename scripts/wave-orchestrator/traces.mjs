import fs from "node:fs";
import path from "node:path";
import { buildAgentExecutionSummary, validateImplementationSummary } from "./agent-state.mjs";
import {
  buildCoordinationResponseMetrics,
  openClarificationLinkedRequests,
  readCoordinationLog,
  serializeCoordinationState,
} from "./coordination-store.mjs";
import { readControlPlaneEvents } from "./control-plane.mjs";
import {
  isContEvalReportOnlyAgent,
  resolveDesignReportPath,
  isDesignAgent,
  isSecurityReviewAgent,
  resolveSecurityReviewReportPath,
} from "./role-helpers.mjs";
import {
  REPO_ROOT,
  ensureDirectory,
  hashText,
  readJsonOrNull,
  readStatusRecordIfPresent,
  toIsoTimestamp,
  writeJsonAtomic,
  writeTextAtomic,
} from "./shared.mjs";
import { summarizeResolvedSkills } from "./skills.mjs";
import {
  buildWaveControlArtifactFromPath,
  safeQueueWaveControlEvent,
} from "./wave-control-client.mjs";

export const TRACE_VERSION = 2;
const LEGACY_TRACE_VERSION = 1;

export function traceWaveDir(tracesDir, waveNumber) {
  return path.join(tracesDir, `wave-${waveNumber}`);
}

export function traceAttemptDir(tracesDir, waveNumber, attemptNumber) {
  return path.join(traceWaveDir(tracesDir, waveNumber), `attempt-${attemptNumber}`);
}

function toTracePath(value) {
  return String(value || "").replaceAll(path.sep, "/");
}

function relativePathOrNull(filePath, rootDir) {
  if (!filePath) {
    return null;
  }
  return toTracePath(path.relative(rootDir, filePath));
}

function fileHashOrNull(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  if (!fs.statSync(filePath).isFile()) {
    return null;
  }
  return hashText(fs.readFileSync(filePath, "utf8"));
}

function copyFileIfExists(sourcePath, destPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }
  if (!fs.statSync(sourcePath).isFile()) {
    return false;
  }
  ensureDirectory(path.dirname(destPath));
  fs.copyFileSync(sourcePath, destPath);
  return true;
}

function writeCoordinationLogSnapshot(sourcePath, destPath, coordinationState) {
  ensureDirectory(path.dirname(destPath));
  if (sourcePath && fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    return true;
  }
  const records = Array.isArray(coordinationState?.records) ? coordinationState.records : [];
  const text =
    records.length > 0
      ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
      : "";
  fs.writeFileSync(destPath, text, "utf8");
  return records.length > 0;
}

function readAttemptMetadataIfPresent(dirPath) {
  const payload = readJsonOrNull(path.join(dirPath, "run-metadata.json"));
  return payload && typeof payload === "object" ? payload : null;
}

function readPriorAttemptMetadata(tracesDir, waveNumber, currentAttempt) {
  const waveDir = traceWaveDir(tracesDir, waveNumber);
  if (!fs.existsSync(waveDir)) {
    return [];
  }
  return fs
    .readdirSync(waveDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^attempt-\d+$/.test(entry.name))
    .map((entry) => ({
      dirPath: path.join(waveDir, entry.name),
      attempt: Number.parseInt(entry.name.replace("attempt-", ""), 10),
    }))
    .filter((entry) => Number.isFinite(entry.attempt) && entry.attempt < currentAttempt)
    .sort((a, b) => a.attempt - b.attempt)
    .map((entry) => readAttemptMetadataIfPresent(entry.dirPath))
    .filter(Boolean);
}

function dedupeByKey(items, keyFn) {
  const byKey = new Map();
  for (const item of items || []) {
    byKey.set(keyFn(item), item);
  }
  return Array.from(byKey.values());
}

function collectLaunchEventsFromMetadata(metadata) {
  return (metadata?.agents || [])
    .filter((agent) => agent?.launchedInAttempt === true)
    .map((agent) => ({
      attempt: metadata.attempt,
      agentId: agent.agentId,
      role: agent.executor?.role || null,
      executorId: agent.executor?.executorId || agent.executor?.id || null,
    }));
}

function collectEvaluatorStatusesFromMetadata(metadata) {
  const statusCode =
    metadata?.gateSnapshot?.contQaGate?.statusCode ||
    metadata?.gateSnapshot?.evaluatorGate?.statusCode ||
    null;
  if (!statusCode) {
    return [];
  }
  return [
    {
      attempt: Number(metadata.attempt),
      statusCode,
    },
  ];
}

function collectLaunchEventsFromCurrent(agentRuns, attempt) {
  return (agentRuns || [])
    .filter((run) => Number(run?.lastLaunchAttempt) === attempt)
    .map((run) => ({
      attempt,
      agentId: run.agent.agentId,
      role: run.agent.executorResolved?.role || null,
      executorId: run.agent.executorResolved?.id || null,
    }));
}

function collectEvaluatorStatusesFromCurrent(gateSnapshot, attempt) {
  const statusCode =
    gateSnapshot?.contQaGate?.statusCode || gateSnapshot?.evaluatorGate?.statusCode || null;
  if (!statusCode) {
    return [];
  }
  return [{ attempt, statusCode }];
}

function emptyHistorySnapshot() {
  return {
    launchEvents: [],
    contQaStatuses: [],
  };
}

function normalizeHistorySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return emptyHistorySnapshot();
  }
  const rawContQaStatuses = Array.isArray(snapshot.contQaStatuses)
    ? snapshot.contQaStatuses
    : Array.isArray(snapshot.evaluatorStatuses)
      ? snapshot.evaluatorStatuses
      : [];
  return {
    launchEvents: dedupeByKey(
      Array.isArray(snapshot.launchEvents)
        ? snapshot.launchEvents
            .filter(Boolean)
            .map((event) => ({
              attempt: Number.parseInt(String(event.attempt), 10),
              agentId: String(event.agentId || "").trim(),
              role: String(event.role || "").trim() || null,
              executorId: String(event.executorId || "").trim() || null,
            }))
            .filter((event) => Number.isFinite(event.attempt) && event.agentId)
        : [],
      (event) => `${event.attempt}:${event.agentId}:${event.executorId || ""}`,
    ).sort((a, b) => a.attempt - b.attempt || a.agentId.localeCompare(b.agentId)),
    contQaStatuses: dedupeByKey(
      rawContQaStatuses
        .filter(Boolean)
        .map((entry) => ({
          attempt: Number.parseInt(String(entry.attempt), 10),
          statusCode: String(entry.statusCode || "").trim() || null,
        }))
        .filter((entry) => Number.isFinite(entry.attempt) && entry.statusCode),
      (entry) => `${entry.attempt}`,
    ).sort((a, b) => a.attempt - b.attempt),
  };
}

function latestHistoricalSnapshot(priorMetadata) {
  const latest = Array.isArray(priorMetadata) && priorMetadata.length > 0 ? priorMetadata.at(-1) : null;
  if (latest?.traceVersion >= TRACE_VERSION && latest?.historySnapshot) {
    return normalizeHistorySnapshot(latest.historySnapshot);
  }
  return null;
}

function buildHistorySnapshotFromPriorMetadata(priorMetadata) {
  const latest = latestHistoricalSnapshot(priorMetadata);
  if (latest) {
    return latest;
  }
  return normalizeHistorySnapshot({
    launchEvents: (priorMetadata || []).flatMap((metadata) => collectLaunchEventsFromMetadata(metadata)),
    contQaStatuses: (priorMetadata || []).flatMap((metadata) =>
      collectEvaluatorStatusesFromMetadata(metadata),
    ),
  });
}

function mergeHistorySnapshot(baseSnapshot, currentSnapshot) {
  const base = normalizeHistorySnapshot(baseSnapshot);
  const current = normalizeHistorySnapshot(currentSnapshot);
  return normalizeHistorySnapshot({
    launchEvents: [...base.launchEvents, ...current.launchEvents],
    contQaStatuses: [...base.contQaStatuses, ...current.contQaStatuses],
  });
}

function buildHistorySnapshot({
  tracesDir,
  waveNumber,
  attempt,
  agentRuns,
  gateSnapshot,
}) {
  const priorMetadata = tracesDir
    ? readPriorAttemptMetadata(tracesDir, waveNumber, attempt)
    : [];
  const priorSnapshot = buildHistorySnapshotFromPriorMetadata(priorMetadata);
  const currentSnapshot = {
    launchEvents: collectLaunchEventsFromCurrent(agentRuns, attempt),
    contQaStatuses: collectEvaluatorStatusesFromCurrent(gateSnapshot, attempt),
  };
  return mergeHistorySnapshot(priorSnapshot, currentSnapshot);
}

function buildRelaunchCounts(events) {
  const launchCountsByAgent = new Map();
  const byRole = {};
  const byExecutor = {};
  let totalLaunches = 0;
  for (const event of events.sort((a, b) => a.attempt - b.attempt || a.agentId.localeCompare(b.agentId))) {
    totalLaunches += 1;
    const priorLaunches = launchCountsByAgent.get(event.agentId) || 0;
    if (priorLaunches > 0) {
      const role = event.role || "unknown";
      const executorId = event.executorId || "unknown";
      byRole[role] = (byRole[role] || 0) + 1;
      byExecutor[executorId] = (byExecutor[executorId] || 0) + 1;
    }
    launchCountsByAgent.set(event.agentId, priorLaunches + 1);
  }
  return { byRole, byExecutor, totalLaunches };
}

function averageOrNull(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function groupCoordinationHistory(records) {
  const grouped = new Map();
  for (const record of records || []) {
    const list = grouped.get(record.id) || [];
    list.push(record);
    grouped.set(record.id, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  }
  return grouped;
}

function computeAckAndBlockerTimings(coordinationRecords) {
  const grouped = groupCoordinationHistory(coordinationRecords);
  const ackedStatuses = new Set(["acknowledged", "in_progress", "resolved", "closed"]);
  const resolvedStatuses = new Set(["resolved", "closed", "superseded", "cancelled"]);
  const ackDurations = [];
  const blockerDurations = [];
  const resolutionDurations = [];
  for (const history of grouped.values()) {
    const first = history[0];
    const startMs = Date.parse(first.createdAt || first.updatedAt || "");
    if (!Number.isFinite(startMs)) {
      continue;
    }
    if (["request", "clarification-request", "human-feedback", "human-escalation"].includes(first.kind)) {
      const acknowledged = history.find((record) => ackedStatuses.has(record.status));
      const ackMs = Date.parse(acknowledged?.updatedAt || "");
      if (Number.isFinite(ackMs) && ackMs >= startMs) {
        ackDurations.push(ackMs - startMs);
      }
    }
    if (["request", "clarification-request", "human-feedback", "human-escalation"].includes(first.kind)) {
      const resolved = history.find((record) => resolvedStatuses.has(record.status));
      const resolvedMs = Date.parse(resolved?.updatedAt || "");
      if (Number.isFinite(resolvedMs) && resolvedMs >= startMs) {
        resolutionDurations.push(resolvedMs - startMs);
      }
    }
    if (first.kind === "blocker") {
      const resolved = history.find((record) => resolvedStatuses.has(record.status));
      const resolvedMs = Date.parse(resolved?.updatedAt || "");
      if (Number.isFinite(resolvedMs) && resolvedMs >= startMs) {
        blockerDurations.push(resolvedMs - startMs);
      }
    }
  }
  return {
    meanTimeToFirstAckMs: averageOrNull(ackDurations),
    meanTimeToResolutionMs: averageOrNull(resolutionDurations),
    meanTimeToBlockerResolutionMs: averageOrNull(blockerDurations),
  };
}

function latestRecordTimestampMs(record) {
  const updatedAtMs = Date.parse(record?.updatedAt || "");
  if (Number.isFinite(updatedAtMs)) {
    return updatedAtMs;
  }
  const createdAtMs = Date.parse(record?.createdAt || "");
  return Number.isFinite(createdAtMs) ? createdAtMs : null;
}

function resolveCoordinationSnapshotNowMs(coordinationRecords, coordinationState) {
  const records = Array.isArray(coordinationRecords) && coordinationRecords.length > 0
    ? coordinationRecords
    : Array.isArray(coordinationState?.records) && coordinationState.records.length > 0
      ? coordinationState.records
      : Array.isArray(coordinationState?.latestRecords)
        ? coordinationState.latestRecords
        : [];
  let latestMs = null;
  for (const record of records) {
    const recordMs = latestRecordTimestampMs(record);
    if (!Number.isFinite(recordMs)) {
      continue;
    }
    latestMs = latestMs === null ? recordMs : Math.max(latestMs, recordMs);
  }
  return latestMs;
}

function computeAssignmentAndDependencyTimings(coordinationRecords, dependencySnapshot = null) {
  const grouped = groupCoordinationHistory(coordinationRecords);
  const requestStartById = new Map();
  for (const history of grouped.values()) {
    const first = history[0];
    if (first?.kind === "request") {
      const startMs = Date.parse(first.createdAt || first.updatedAt || "");
      if (Number.isFinite(startMs)) {
        requestStartById.set(first.id, startMs);
      }
    }
  }
  const assignmentDurations = [];
  for (const history of grouped.values()) {
    const first = history[0];
    if (first?.kind !== "decision" || !String(first.id || "").startsWith("assignment:")) {
      continue;
    }
    const requestId = Array.isArray(first.dependsOn) ? first.dependsOn[0] : null;
    const startMs = requestStartById.get(requestId);
    const assignedMs = Date.parse(first.updatedAt || first.createdAt || "");
    if (Number.isFinite(startMs) && Number.isFinite(assignedMs) && assignedMs >= startMs) {
      assignmentDurations.push(assignedMs - startMs);
    }
  }
  const dependencyDurations = [];
  for (const item of [
    ...(dependencySnapshot?.inbound || []),
    ...(dependencySnapshot?.outbound || []),
  ]) {
    if (!["resolved", "closed", "superseded", "cancelled"].includes(String(item.status || ""))) {
      continue;
    }
    const startMs = Date.parse(item.createdAt || "");
    const endMs = Date.parse(item.updatedAt || "");
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      dependencyDurations.push(endMs - startMs);
    }
  }
  return {
    meanTimeToCapabilityAssignmentMs: averageOrNull(assignmentDurations),
    meanTimeToDependencyResolutionMs: averageOrNull(dependencyDurations),
  };
}

function computeProofCompletenessRatio(wave, summariesByAgentId) {
  const contQaAgentId = wave?.contQaAgentId || wave?.evaluatorAgentId || "A0";
  const contEvalAgentId = wave?.contEvalAgentId || "E0";
  const integrationAgentId = wave?.integrationAgentId || "A8";
  const documentationAgentId = wave?.documentationAgentId || "A9";
  const implementationAgents = (wave?.agents || []).filter((agent) =>
    agent.agentId !== contQaAgentId &&
    agent.agentId !== integrationAgentId &&
    agent.agentId !== documentationAgentId &&
    !isContEvalReportOnlyAgent(agent, { contEvalAgentId }) &&
    !isSecurityReviewAgent(agent),
  );
  const contractAgents = implementationAgents.filter((agent) => agent.exitContract);
  if (contractAgents.length === 0) {
    return 1;
  }
  const proofMet = contractAgents.filter((agent) =>
    validateImplementationSummary(agent, summariesByAgentId?.[agent.agentId]).ok,
  );
  return Number((proofMet.length / contractAgents.length).toFixed(2));
}

function countRuntimeFallbacks(agentRuns) {
  return (agentRuns || []).reduce((sum, run) => {
    const history = Array.isArray(run?.agent?.executorResolved?.executorHistory)
      ? run.agent.executorResolved.executorHistory
      : [];
    return sum + Math.max(0, history.length - 1);
  }, 0);
}

function contQaReversalFromHistory(historySnapshot, gateSnapshot) {
  const currentStatus =
    gateSnapshot?.contQaGate?.statusCode || gateSnapshot?.evaluatorGate?.statusCode || null;
  if (!currentStatus) {
    return false;
  }
  const priorStatuses = normalizeHistorySnapshot(historySnapshot).contQaStatuses
    .map((entry) => entry.statusCode)
    .filter(Boolean)
    .filter((status) => status !== currentStatus);
  return priorStatuses.length > 0;
}

function resolveHistorySnapshot({
  historySnapshot,
  tracesDir,
  wave,
  attempt,
  agentRuns,
  gateSnapshot,
}) {
  if (historySnapshot) {
    return normalizeHistorySnapshot(historySnapshot);
  }
  return buildHistorySnapshot({
    tracesDir,
    waveNumber: wave.wave,
    attempt,
    agentRuns,
    gateSnapshot,
  });
}

export function buildQualityMetrics({
  historySnapshot = null,
  tracesDir,
  wave,
  attempt,
  coordinationLogPath,
  coordinationState,
  integrationSummary,
  ledger,
  docsQueue,
  summariesByAgentId,
  agentRuns,
  capabilityAssignments = [],
  dependencySnapshot = null,
  gateSnapshot = null,
}) {
  const effectiveHistory = resolveHistorySnapshot({
    historySnapshot,
    tracesDir,
    wave,
    attempt,
    agentRuns,
    gateSnapshot,
  });
  const relaunchCounts = buildRelaunchCounts(effectiveHistory.launchEvents);
  const fallbackCount = countRuntimeFallbacks(agentRuns);
  const coordinationRecords = coordinationLogPath ? readCoordinationLog(coordinationLogPath) : [];
  const timings = computeAckAndBlockerTimings(coordinationRecords);
  const assignmentTimings = computeAssignmentAndDependencyTimings(
    coordinationRecords,
    dependencySnapshot,
  );
  const coordinationSnapshotNowMs = resolveCoordinationSnapshotNowMs(
    coordinationRecords,
    coordinationState,
  );
  const responseMetrics = buildCoordinationResponseMetrics(coordinationState, {
    ...(Number.isFinite(coordinationSnapshotNowMs)
      ? { nowMs: coordinationSnapshotNowMs }
      : {}),
  });
  const documentationItems = Array.isArray(docsQueue?.items) ? docsQueue.items : [];
  const unresolvedClarificationCount = (coordinationState?.clarifications || []).filter((record) =>
    ["open", "acknowledged", "in_progress"].includes(record.status),
  ).length;
  const clarificationLinkedCount = openClarificationLinkedRequests(coordinationState).length;
  return {
    attempt,
    unresolvedRequestCount: (coordinationState?.requests || []).filter((record) =>
      ["open", "acknowledged", "in_progress"].includes(record.status),
    ).length,
    unresolvedClarificationCount: unresolvedClarificationCount + clarificationLinkedCount,
    humanEscalationCount: (coordinationState?.humanEscalations || []).length,
    orchestratorResolvedClarificationCount:
      (coordinationState?.resolvedByPolicy || []).length +
      (coordinationState?.orchestratorGuidance || []).filter((record) =>
        ["resolved", "closed"].includes(record.status),
      ).length,
    contradictionCount: integrationSummary?.conflictingClaims?.length || 0,
    documentationDriftCount:
      documentationItems.length > 0
        ? documentationItems.length
        : (ledger?.tasks || []).filter(
            (task) => task.kind === "documentation" && task.state !== "done",
          ).length,
    proofCompletenessRatio: computeProofCompletenessRatio(wave, summariesByAgentId),
    relaunchCountByRole: relaunchCounts.byRole,
    relaunchCountByExecutor: relaunchCounts.byExecutor,
    runtimeFallbackCount: fallbackCount,
    runtimeFallbackRate:
      relaunchCounts.totalLaunches > 0
        ? Number((fallbackCount / relaunchCounts.totalLaunches).toFixed(2))
        : 0,
    openCapabilityRequestCount: (capabilityAssignments || []).filter((assignment) => assignment.blocking).length,
    openRequiredDependencyCount:
      (dependencySnapshot?.requiredInbound || []).length +
      (dependencySnapshot?.requiredOutbound || []).length,
    meanTimeToCapabilityAssignmentMs: assignmentTimings.meanTimeToCapabilityAssignmentMs,
    meanTimeToDependencyResolutionMs: assignmentTimings.meanTimeToDependencyResolutionMs,
    helperTaskAssignmentCount: (capabilityAssignments || []).filter((assignment) => assignment.assignedAgentId).length,
    oldestOpenCoordinationAgeMs: responseMetrics.oldestOpenCoordinationAgeMs,
    oldestUnackedRequestAgeMs: responseMetrics.oldestUnackedRequestAgeMs,
    overdueAckCount: responseMetrics.overdueAckCount,
    overdueClarificationCount: responseMetrics.overdueClarificationCount,
    openHumanEscalationCount: responseMetrics.openHumanEscalationCount,
    meanTimeToFirstAckMs: timings.meanTimeToFirstAckMs,
    meanTimeToResolutionMs: timings.meanTimeToResolutionMs,
    meanTimeToBlockerResolutionMs: timings.meanTimeToBlockerResolutionMs,
    contQaReversal: contQaReversalFromHistory(effectiveHistory, gateSnapshot),
    finalRecommendation: integrationSummary?.recommendation || "unknown",
  };
}

function buildReplayContext({ lanePaths, wave }) {
  return {
    lane: lanePaths?.lane || null,
    roles: {
      contQaAgentId: lanePaths?.contQaAgentId || wave.contQaAgentId || wave.evaluatorAgentId || "A0",
      contEvalAgentId: lanePaths?.contEvalAgentId || wave.contEvalAgentId || "E0",
      integrationAgentId: lanePaths?.integrationAgentId || wave.integrationAgentId || "A8",
      documentationAgentId: lanePaths?.documentationAgentId || wave.documentationAgentId || "A9",
    },
    validation: {
      requireDocumentationStewardFromWave:
        lanePaths?.requireDocumentationStewardFromWave ?? null,
      requireContext7DeclarationsFromWave:
        lanePaths?.requireContext7DeclarationsFromWave ?? null,
      requireExitContractsFromWave:
        lanePaths?.requireExitContractsFromWave ?? null,
      requireIntegrationStewardFromWave: lanePaths?.requireIntegrationStewardFromWave ?? null,
      requireComponentPromotionsFromWave:
        lanePaths?.requireComponentPromotionsFromWave ??
        lanePaths?.laneProfile?.validation?.requireComponentPromotionsFromWave ??
        null,
      requireAgentComponentsFromWave:
        lanePaths?.requireAgentComponentsFromWave ?? null,
    },
  };
}

function normalizeGateLogPath(gate, agentArtifacts) {
  if (!gate || typeof gate !== "object") {
    return gate;
  }
  if (!gate.logPath || !gate.agentId) {
    return gate;
  }
  const artifact = agentArtifacts?.[gate.agentId]?.log;
  if (!artifact?.present || !artifact?.path) {
    return gate;
  }
  return {
    ...gate,
    // Log artifacts are already described in the bundle manifest. Nulling the
    // inline path keeps replay parity focused on gate semantics instead of the
    // copied artifact layout.
    logPath: null,
  };
}

export function normalizeGateSnapshotForBundle(gateSnapshot, agentArtifacts) {
  if (!gateSnapshot || typeof gateSnapshot !== "object") {
    return gateSnapshot;
  }
  const normalized = { ...gateSnapshot };
  const overallGate = String(gateSnapshot.overall?.gate || "").trim();
  for (const key of [
    "implementationGate",
    "componentGate",
    "helperAssignmentBarrier",
    "dependencyBarrier",
    "contEvalGate",
    "securityGate",
    "integrationGate",
    "integrationBarrier",
    "documentationGate",
    "componentMatrixGate",
    "contQaGate",
    "evaluatorGate",
    "infraGate",
  ]) {
    const nextValue = normalizeGateLogPath(gateSnapshot[key], agentArtifacts);
    if (key === "documentationGate") {
      normalized[key] =
        overallGate === "documentationGate" && nextValue
          ? {
              ok: Boolean(nextValue.ok),
              statusCode: nextValue.statusCode || null,
            }
          : null;
      continue;
    }
    if (key === "integrationGate" || key === "integrationBarrier") {
      normalized[key] = nextValue
        ? {
            ok: Boolean(nextValue.ok),
            statusCode: nextValue.statusCode || null,
          }
        : null;
      continue;
    }
    normalized[key] = nextValue;
  }
  return normalized;
}

function buildStoredOutcomeSnapshot(gateSnapshot, quality) {
  return {
    gateSnapshot: gateSnapshot || null,
    quality: quality || null,
  };
}

function writeArtifactDescriptor(dir, filePath, payload, mode = "json", required = true) {
  if (mode === "json") {
    writeJsonAtomic(filePath, payload || {});
  } else {
    writeTextAtomic(filePath, `${String(payload || "")}\n`);
  }
  return {
    path: relativePathOrNull(filePath, dir),
    required,
    present: true,
    sha256: fileHashOrNull(filePath),
  };
}

function copyArtifactDescriptor(dir, sourcePath, destPath, required = false) {
  const present = copyFileIfExists(sourcePath, destPath);
  return {
    path: relativePathOrNull(destPath, dir),
    required,
    present,
    sha256: present ? fileHashOrNull(destPath) : null,
  };
}

function summaryPathFromStatusPath(statusPath) {
  return statusPath ? statusPath.replace(/\.status$/i, ".summary.json") : null;
}

function readSummaryPayload(filePath) {
  const payload = readJsonOrNull(filePath);
  return payload && typeof payload === "object" ? payload : null;
}

function resolveRunSummaryPayload(wave, run) {
  if (run?.summary && typeof run.summary === "object") {
    return run.summary;
  }
  const sourceSummaryPath = summaryPathFromStatusPath(run?.statusPath);
  if (sourceSummaryPath) {
    const sourceSummary = readSummaryPayload(sourceSummaryPath);
    if (sourceSummary) {
      return sourceSummary;
    }
  }
  const statusRecord = run?.statusPath ? readStatusRecordIfPresent(run.statusPath) : null;
  if (!statusRecord || !run?.logPath || !fs.existsSync(run.logPath)) {
    return null;
  }
  const reportPath =
    run.agent?.agentId === (wave?.contQaAgentId || wave?.evaluatorAgentId || "A0") &&
    (wave?.contQaReportPath || wave?.evaluatorReportPath)
      ? path.resolve(REPO_ROOT, wave.contQaReportPath || wave.evaluatorReportPath)
      : run.agent?.agentId === (wave?.contEvalAgentId || "E0") && wave?.contEvalReportPath
        ? path.resolve(REPO_ROOT, wave.contEvalReportPath)
        : isDesignAgent(run.agent)
          ? (() => {
              const designReportPath = resolveDesignReportPath(run.agent);
              return designReportPath ? path.resolve(REPO_ROOT, designReportPath) : null;
            })()
        : isSecurityReviewAgent(run.agent)
          ? (() => {
              const securityReportPath = resolveSecurityReviewReportPath(run.agent);
              return securityReportPath ? path.resolve(REPO_ROOT, securityReportPath) : null;
            })()
        : null;
  return buildAgentExecutionSummary({
    agent: run.agent,
    statusRecord,
    logPath: run.logPath,
    reportPath,
  });
}

function writeSummaryArtifactDescriptor(dir, wave, run, attempt, slug) {
  const destPath = path.join(dir, "summaries", `${slug}.summary.json`);
  const launchedInAttempt = Number(run?.lastLaunchAttempt) === attempt;
  const payload = resolveRunSummaryPayload(wave, run);
  if (payload && typeof payload === "object") {
    return writeArtifactDescriptor(dir, destPath, payload, "json", launchedInAttempt);
  }
  return {
    path: relativePathOrNull(destPath, dir),
    required: launchedInAttempt,
    present: false,
    sha256: null,
  };
}

function buildAgentMetadata(dir, run, attempt, artifacts) {
  const launchedInAttempt = Number(run.lastLaunchAttempt) === attempt;
  const promptTracePath = artifacts.prompt.path;
  const logTracePath = artifacts.log.path;
  const statusTracePath = artifacts.status.path;
  const summaryTracePath = artifacts.summary.path;
  const inboxTracePath = artifacts.inbox.path;
  return {
    agentId: run.agent.agentId,
    title: run.agent.title,
    launchedInAttempt,
    promptPath: promptTracePath,
    promptHash: promptTracePath ? fileHashOrNull(path.join(dir, promptTracePath)) : null,
    logPath: logTracePath,
    statusPath: statusTracePath,
    status: run.statusPath ? readStatusRecordIfPresent(run.statusPath) : null,
    summaryPath: summaryTracePath,
    inboxPath: inboxTracePath,
    executor: run.agent.executorResolved
      ? {
          role: run.agent.executorResolved.role || null,
          profile: run.agent.executorResolved.profile || null,
          initialExecutorId: run.agent.executorResolved.initialExecutorId || null,
          executorId: run.agent.executorResolved.id || null,
          selectedBy: run.agent.executorResolved.selectedBy || null,
          budget: run.agent.executorResolved.budget || null,
          fallbacks: run.agent.executorResolved.fallbacks || [],
          fallbackUsed: run.agent.executorResolved.fallbackUsed === true,
          fallbackReason: run.agent.executorResolved.fallbackReason || null,
          executorHistory: run.agent.executorResolved.executorHistory || [],
        }
      : null,
    context7: {
      selection: run.agent.context7Resolved || null,
      mode: run.lastContext7?.mode || null,
      warning: run.lastContext7?.warning || "",
      snippetHash:
        run.lastContext7?.snippetHash ||
        (run.lastContext7?.promptText ? hashText(run.lastContext7.promptText) : ""),
    },
    skills:
      run.lastSkillProjection ||
      (run.agent?.skillsResolved ? summarizeResolvedSkills(run.agent.skillsResolved) : null),
  };
}

export function writeTraceBundle({
  tracesDir,
  lanePaths,
  launcherOptions,
  wave,
  attempt,
  manifest,
  coordinationLogPath,
  coordinationState,
  ledger,
  docsQueue,
  capabilityAssignments = [],
  dependencySnapshot = null,
  securitySummary = null,
  corridorSummary = null,
  corridorSummaryPath = null,
  integrationSummary,
  integrationMarkdownPath,
  proofRegistryPath = null,
  controlPlanePath = null,
  clarificationTriage,
  agentRuns,
  quality,
  structuredSignals,
  gateSnapshot = null,
}) {
  const dir = traceAttemptDir(tracesDir, wave.wave, attempt);
  ensureDirectory(dir);

  const manifestArtifact = writeArtifactDescriptor(dir, path.join(dir, "manifest.json"), manifest, "json", true);
  const coordinationMaterializedArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "coordination.materialized.json"),
    serializeCoordinationState(coordinationState || {}),
    "json",
    true,
  );
  const coordinationRawPath = path.join(dir, "coordination.raw.jsonl");
  const coordinationRawPresent = writeCoordinationLogSnapshot(
    coordinationLogPath,
    coordinationRawPath,
    coordinationState,
  );
  const coordinationRawArtifact = {
    path: relativePathOrNull(coordinationRawPath, dir),
    required: true,
    present: coordinationRawPresent || fs.existsSync(coordinationRawPath),
    sha256: fileHashOrNull(coordinationRawPath),
  };
  const ledgerArtifact = writeArtifactDescriptor(dir, path.join(dir, "ledger.json"), ledger, "json", true);
  const docsQueueArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "docs-queue.json"),
    docsQueue,
    "json",
    true,
  );
  const capabilityAssignmentsArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "capability-assignments.json"),
    capabilityAssignments,
    "json",
    true,
  );
  const dependencySnapshotArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "dependency-snapshot.json"),
    dependencySnapshot || {},
    "json",
    true,
  );
  const securityArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "security.json"),
    securitySummary || {},
    "json",
    true,
  );
  const corridorArtifact =
    corridorSummaryPath || corridorSummary
      ? corridorSummaryPath
        ? copyArtifactDescriptor(
            dir,
            corridorSummaryPath,
            path.join(dir, "corridor.json"),
            false,
          )
        : writeArtifactDescriptor(
            dir,
            path.join(dir, "corridor.json"),
            corridorSummary || {},
            "json",
            false,
          )
      : {
          path: "corridor.json",
          required: false,
          present: false,
          sha256: null,
        };
  const integrationArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "integration.json"),
    integrationSummary,
    "json",
    true,
  );
  const integrationMarkdownArtifact = copyArtifactDescriptor(
    dir,
    integrationMarkdownPath,
    path.join(dir, "integration.md"),
    false,
  );
  const proofRegistryArtifact = copyArtifactDescriptor(
    dir,
    proofRegistryPath,
    path.join(dir, "proof-registry.json"),
    false,
  );
  const controlPlaneArtifact = copyArtifactDescriptor(
    dir,
    controlPlanePath,
    path.join(dir, "control-plane.raw.jsonl"),
    false,
  );
  const qualityArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "quality.json"),
    quality,
    "json",
    true,
  );
  const structuredSignalsArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "structured-signals.json"),
    structuredSignals || {},
    "json",
    true,
  );
  const sharedSummaryArtifact = agentRuns?.[0]?.sharedSummaryPath
    ? copyArtifactDescriptor(
        dir,
        agentRuns[0].sharedSummaryPath,
        path.join(dir, "shared-summary.md"),
        true,
      )
    : {
        path: "shared-summary.md",
        required: true,
        present: false,
        sha256: null,
      };
  const feedbackTriageArtifact = copyArtifactDescriptor(
    dir,
    clarificationTriage?.triagePath,
    path.join(dir, "feedback", "triage.jsonl"),
    false,
  );
  const pendingHumanArtifact = copyArtifactDescriptor(
    dir,
    clarificationTriage?.pendingHumanPath,
    path.join(dir, "feedback", "pending-human.md"),
    false,
  );
  const componentMatrixRequired = Array.isArray(wave.componentPromotions) && wave.componentPromotions.length > 0;
  const componentMatrixArtifact = copyArtifactDescriptor(
    dir,
    lanePaths?.componentCutoverMatrixJsonPath,
    path.join(dir, "component-cutover-matrix.json"),
    componentMatrixRequired,
  );
  const componentMatrixMarkdownArtifact = copyArtifactDescriptor(
    dir,
    lanePaths?.componentCutoverMatrixDocPath,
    path.join(dir, "component-cutover-matrix.md"),
    false,
  );
  const historySnapshot = buildHistorySnapshot({
    tracesDir,
    waveNumber: wave.wave,
    attempt,
    agentRuns,
    gateSnapshot,
  });

  const agentArtifacts = {};
  const agentsMetadata = [];
  for (const run of agentRuns || []) {
    const slug = run.agent.slug || run.agent.agentId;
    const artifacts = {
      prompt: copyArtifactDescriptor(
        dir,
        run.promptPath,
        path.join(dir, "prompts", `${slug}.prompt.md`),
        Number(run.lastLaunchAttempt) === attempt,
      ),
      log: copyArtifactDescriptor(
        dir,
        run.logPath,
        path.join(dir, "logs", `${slug}.log`),
        Number(run.lastLaunchAttempt) === attempt,
      ),
      status: copyArtifactDescriptor(
        dir,
        run.statusPath,
        path.join(dir, "status", `${slug}.status`),
        Number(run.lastLaunchAttempt) === attempt || Boolean(readStatusRecordIfPresent(run.statusPath)),
      ),
      summary: writeSummaryArtifactDescriptor(dir, wave, run, attempt, slug),
      inbox: copyArtifactDescriptor(
        dir,
        run.inboxPath,
        path.join(dir, "inboxes", `${slug}.md`),
        true,
      ),
    };
    agentArtifacts[run.agent.agentId] = artifacts;
    agentsMetadata.push(buildAgentMetadata(dir, run, attempt, artifacts));
  }
  const replayContext = buildReplayContext({ lanePaths, wave });
  const normalizedGateSnapshot = normalizeGateSnapshotForBundle(gateSnapshot || null, agentArtifacts);
  const outcomeArtifact = writeArtifactDescriptor(
    dir,
    path.join(dir, "outcome.json"),
    buildStoredOutcomeSnapshot(normalizedGateSnapshot, quality),
    "json",
    true,
  );

  const metadata = {
    traceVersion: TRACE_VERSION,
    replayMode: "hermetic",
    runKind: lanePaths?.runKind || "roadmap",
    runId: lanePaths?.runId || null,
    wave: wave.wave,
    lane: lanePaths?.lane || null,
    waveFile: wave.file,
    requestPath: lanePaths?.adhocRequestPath ? relativePathOrNull(lanePaths.adhocRequestPath, REPO_ROOT) : null,
    specPath: lanePaths?.adhocSpecPath ? relativePathOrNull(lanePaths.adhocSpecPath, REPO_ROOT) : null,
    waveFileHash: fileHashOrNull(path.resolve(REPO_ROOT, wave.file || "")),
    attempt,
    cumulativeAttemptCount: attempt,
    capturedAt: toIsoTimestamp(),
    launcher: {
      timeoutMinutes: launcherOptions?.timeoutMinutes ?? null,
      maxRetriesPerWave: launcherOptions?.maxRetriesPerWave ?? null,
      dryRun: Boolean(launcherOptions?.dryRun),
      runVariant: lanePaths?.runVariant || "live",
    },
    roles: replayContext.roles,
    validation: replayContext.validation,
    replayContext,
    historySnapshot,
    gateSnapshot: normalizedGateSnapshot,
    artifacts: {
      manifest: manifestArtifact,
      coordinationRaw: coordinationRawArtifact,
      coordinationMaterialized: coordinationMaterializedArtifact,
      ledger: ledgerArtifact,
      docsQueue: docsQueueArtifact,
      capabilityAssignments: capabilityAssignmentsArtifact,
      dependencySnapshot: dependencySnapshotArtifact,
      security: securityArtifact,
      corridor: corridorArtifact,
      integration: integrationArtifact,
      integrationMarkdown: integrationMarkdownArtifact,
      proofRegistry: proofRegistryArtifact,
      controlPlane: controlPlaneArtifact,
      componentMatrix: componentMatrixArtifact,
      componentMatrixMarkdown: componentMatrixMarkdownArtifact,
      outcome: outcomeArtifact,
      sharedSummary: sharedSummaryArtifact,
      structuredSignals: structuredSignalsArtifact,
      quality: qualityArtifact,
      feedbackTriage: feedbackTriageArtifact,
      pendingHuman: pendingHumanArtifact,
      agents: agentArtifacts,
    },
    agents: agentsMetadata,
  };

  metadata.artifacts.runMetadata = {
    path: "run-metadata.json",
    required: true,
    present: true,
    sha256: null,
  };
  const runMetadataPath = path.join(dir, "run-metadata.json");
  writeJsonAtomic(runMetadataPath, metadata);
  if (lanePaths?.waveControl?.captureTraceBundles !== false) {
    safeQueueWaveControlEvent(lanePaths, {
      category: "trace",
      entityType: "artifact",
      entityId: `wave-${wave.wave}-attempt-${attempt}-trace-bundle`,
      action: "bundle-written",
      source: "launcher",
      actor: "launcher",
      recordedAt: metadata.capturedAt,
      identity: {
        lane: lanePaths?.lane || null,
        wave: wave.wave,
        attempt,
        runKind: lanePaths?.runKind || "roadmap",
        runId: lanePaths?.runId || null,
      },
      tags: ["trace", "attempt-bundle"],
      data: {
        traceDir: relativePathOrNull(dir, REPO_ROOT),
        finalRecommendation: quality?.finalRecommendation || null,
        gate: normalizedGateSnapshot?.overall?.gate || null,
      },
      artifacts: [
        {
          ...buildWaveControlArtifactFromPath(runMetadataPath, {
            kind: "trace-run-metadata",
            required: true,
            uploadPolicy: "selected",
          }),
          sourcePath: runMetadataPath,
        },
        {
          ...buildWaveControlArtifactFromPath(path.join(dir, "quality.json"), {
            kind: "trace-quality",
            required: true,
            uploadPolicy: "selected",
          }),
          sourcePath: path.join(dir, "quality.json"),
        },
        {
          ...buildWaveControlArtifactFromPath(path.join(dir, "outcome.json"), {
            kind: "trace-outcome",
            required: true,
            uploadPolicy: "selected",
          }),
          sourcePath: path.join(dir, "outcome.json"),
        },
        {
          ...buildWaveControlArtifactFromPath(path.join(dir, "integration.json"), {
            kind: "integration-summary",
            required: true,
            uploadPolicy: "selected",
          }),
          sourcePath: path.join(dir, "integration.json"),
        },
        {
          ...buildWaveControlArtifactFromPath(path.join(dir, "proof-registry.json"), {
            kind: "proof-registry",
            required: false,
            uploadPolicy: "selected",
          }),
          sourcePath: path.join(dir, "proof-registry.json"),
        },
        {
          ...buildWaveControlArtifactFromPath(path.join(dir, "control-plane.raw.jsonl"), {
            kind: "control-plane-log",
            required: false,
            uploadPolicy: "metadata-only",
          }),
          sourcePath: path.join(dir, "control-plane.raw.jsonl"),
        },
      ],
    });
  }
  return dir;
}

export function loadTraceBundle(dir) {
  const metadata = readJsonOrNull(path.join(dir, "run-metadata.json"));
  const manifest = readJsonOrNull(path.join(dir, "manifest.json"));
  const coordinationState = readJsonOrNull(path.join(dir, "coordination.materialized.json"));
  const coordinationRecords = readCoordinationLog(path.join(dir, "coordination.raw.jsonl"));
  return {
    dir,
    metadata,
    manifest,
    coordinationState,
    coordinationRecords,
    controlPlaneEvents: readControlPlaneEvents(path.join(dir, "control-plane.raw.jsonl")),
    ledger: readJsonOrNull(path.join(dir, "ledger.json")),
    docsQueue: readJsonOrNull(path.join(dir, "docs-queue.json")),
    capabilityAssignments: readJsonOrNull(path.join(dir, "capability-assignments.json")),
    dependencySnapshot: readJsonOrNull(path.join(dir, "dependency-snapshot.json")),
    securitySummary: readJsonOrNull(path.join(dir, "security.json")),
    integrationSummary: readJsonOrNull(path.join(dir, "integration.json")),
    proofRegistry: readJsonOrNull(path.join(dir, "proof-registry.json")),
    quality: readJsonOrNull(path.join(dir, "quality.json")),
    storedOutcome: readJsonOrNull(path.join(dir, "outcome.json")),
    structuredSignals: readJsonOrNull(path.join(dir, "structured-signals.json")),
    componentMatrix: readJsonOrNull(path.join(dir, "component-cutover-matrix.json")),
    componentMatrixPath: path.join(dir, "component-cutover-matrix.json"),
  };
}

function visitArtifactDescriptors(artifacts, callback, prefix = "") {
  if (!artifacts || typeof artifacts !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(artifacts)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (!value || typeof value !== "object") {
      continue;
    }
    if ("path" in value && "present" in value) {
      callback(name, value);
      continue;
    }
    visitArtifactDescriptors(value, callback, name);
  }
}

function validateArtifactPresence(errors, bundle, name, artifact) {
  if (!artifact?.required) {
    return;
  }
  if (!artifact.present) {
    errors.push(`Missing required artifact ${name}.`);
    return;
  }
  if (!artifact.path) {
    errors.push(`Required artifact ${name} is missing a bundle path.`);
    return;
  }
  const absolutePath = path.join(bundle.dir, artifact.path);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`Artifact ${name} is marked present but missing on disk: ${artifact.path}`);
  }
}

export function validateTraceBundle(bundle) {
  const errors = [];
  const warnings = [];
  if (!bundle?.metadata || typeof bundle.metadata !== "object") {
    return { ok: false, errors: ["Missing run-metadata.json"], warnings, replayMode: "invalid" };
  }
  if (bundle.metadata.traceVersion === LEGACY_TRACE_VERSION) {
    warnings.push(
      "Legacy traceVersion 1 bundle detected; replay is best-effort and may depend on sibling attempts or live repo context.",
    );
  } else if (bundle.metadata.traceVersion !== TRACE_VERSION) {
    errors.push(
      `Unsupported traceVersion ${bundle.metadata.traceVersion}; expected ${TRACE_VERSION}.`,
    );
  }
  if (bundle.metadata.traceVersion >= TRACE_VERSION) {
    if (!bundle.metadata.replayContext || typeof bundle.metadata.replayContext !== "object") {
      errors.push("Hermetic trace bundle is missing replayContext.");
    }
    if (!bundle.metadata.historySnapshot || typeof bundle.metadata.historySnapshot !== "object") {
      errors.push("Hermetic trace bundle is missing historySnapshot.");
    }
    if (!bundle.storedOutcome || typeof bundle.storedOutcome !== "object") {
      errors.push("Hermetic trace bundle is missing outcome.json.");
    }
  }
  if (!bundle.metadata.artifacts || typeof bundle.metadata.artifacts !== "object") {
    errors.push("Hermetic trace bundle is missing artifacts metadata.");
  }
  visitArtifactDescriptors(bundle.metadata.artifacts, (name, artifact) => {
    validateArtifactPresence(errors, bundle, name, artifact);
    if (!artifact?.present || !artifact?.path) {
      return;
    }
    const absolutePath = path.join(bundle.dir, artifact.path);
    if (!fs.existsSync(absolutePath)) {
      return;
    }
    if (typeof artifact.sha256 === "string" && artifact.sha256.length > 0) {
      const actual = fileHashOrNull(absolutePath);
      if (actual !== artifact.sha256) {
        errors.push(
          `Artifact ${name} hash mismatch: expected ${artifact.sha256}, got ${actual || "missing"}.`,
        );
      }
    }
  });
  const wave =
    bundle.manifest?.waves?.find((entry) => Number(entry.wave) === Number(bundle.metadata.wave)) ||
    bundle.manifest?.waves?.[0] ||
    null;
  if (bundle.metadata.traceVersion >= TRACE_VERSION && wave) {
    const hasPromotions =
      Array.isArray(wave.componentPromotions) && wave.componentPromotions.length > 0;
    const componentMatrixArtifact = bundle.metadata.artifacts?.componentMatrix;
    if (hasPromotions) {
      if (!componentMatrixArtifact || typeof componentMatrixArtifact !== "object") {
        errors.push("Promoted-component trace bundle is missing componentMatrix artifact metadata.");
      } else {
        if (componentMatrixArtifact.required !== true) {
          errors.push(
            "Promoted-component trace bundle must mark componentMatrix as a required artifact.",
          );
        }
      }
    }
  }
  for (const agent of bundle.metadata.agents || []) {
    const artifacts = bundle.metadata.artifacts?.agents?.[agent.agentId];
    if (agent.launchedInAttempt) {
      for (const key of ["prompt", "log", "status", "summary", "inbox"]) {
        if (bundle.metadata.traceVersion >= TRACE_VERSION) {
          if (!artifacts?.[key]) {
            errors.push(
              `Hermetic trace bundle is missing ${key} artifact metadata for launched agent ${agent.agentId}.`,
            );
            continue;
          }
          if (artifacts?.[key]?.required !== true) {
            errors.push(
              `Hermetic trace bundle must mark ${key} as required for launched agent ${agent.agentId}.`,
            );
          }
        } else if (key !== "summary" && !artifacts?.[key]?.present) {
          errors.push(`Missing ${key} artifact for launched agent ${agent.agentId}.`);
        }
      }
    }
  }
  if (!Array.isArray(bundle.manifest?.waves) || bundle.manifest.waves.length === 0) {
    errors.push("Trace manifest is missing wave definitions.");
  }
  if (bundle.metadata.traceVersion >= TRACE_VERSION && bundle.storedOutcome) {
    if (
      JSON.stringify(bundle.storedOutcome.quality || null) !==
      JSON.stringify(bundle.quality || null)
    ) {
      errors.push("Stored outcome quality snapshot does not match quality.json.");
    }
    if (
      bundle.metadata.gateSnapshot &&
      JSON.stringify(bundle.storedOutcome.gateSnapshot || null) !==
        JSON.stringify(bundle.metadata.gateSnapshot || null)
    ) {
      warnings.push("Stored outcome gate snapshot differs from inline run-metadata gateSnapshot.");
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    replayMode: bundle.metadata.traceVersion >= TRACE_VERSION ? "hermetic" : "legacy-best-effort",
  };
}

export function writeStructuredSignalsSnapshot(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

export function writeMarkdownArtifact(filePath, text) {
  writeTextAtomic(filePath, `${String(text || "")}\n`);
}
