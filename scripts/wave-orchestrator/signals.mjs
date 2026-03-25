import path from "node:path";
import {
  REPO_ROOT,
  ensureDirectory,
  readJsonOrNull,
  toIsoTimestamp,
  writeJsonAtomic,
} from "./shared.mjs";

export const SIGNAL_HYGIENE_SKILL_ID = "signal-hygiene";
export const RESIDENT_SIGNAL_ID = "resident-orchestrator";

const ACTIONABLE_SIGNAL_KINDS = new Set([
  "feedback-requested",
  "feedback-answered",
  "coordination-action",
  "resume-ready",
  "completed",
  "failed",
]);

const ACTIONABLE_TASK_TYPES = new Set([
  "request",
  "blocker",
  "clarification",
  "human-input",
  "escalation",
]);

function normalizeId(value, fallback = "unknown") {
  return (
    String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

function relativePath(filePath) {
  return filePath ? path.relative(REPO_ROOT, filePath) : null;
}

function normalizeString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeArray(values) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean)),
  ).sort();
}

function terminalWaveSignal(phase) {
  const normalized = String(phase || "").trim().toLowerCase();
  if (normalized === "completed") {
    return "completed";
  }
  if (["failed", "timed_out", "timed-out"].includes(normalized)) {
    return "failed";
  }
  return null;
}

function pendingFeedbackRequests(feedbackRequests, agentId = "") {
  return (Array.isArray(feedbackRequests) ? feedbackRequests : []).filter((request) => {
    if (String(request?.status || "").trim().toLowerCase() !== "pending") {
      return false;
    }
    return !agentId || String(request?.agentId || "").trim() === agentId;
  });
}

function answeredFeedbackRequests(feedbackRequests, agentId = "") {
  return (Array.isArray(feedbackRequests) ? feedbackRequests : []).filter((request) => {
    if (String(request?.status || "").trim().toLowerCase() !== "answered") {
      return false;
    }
    return !agentId || String(request?.agentId || "").trim() === agentId;
  });
}

function isActionableTask(task) {
  const taskType = String(task?.taskType || "").trim().toLowerCase();
  const state = String(task?.state || "").trim().toLowerCase();
  if (!ACTIONABLE_TASK_TYPES.has(taskType)) {
    return false;
  }
  return ["open", "working", "input-required"].includes(state);
}

function firstActionableTask(tasks, agentId = "") {
  return (Array.isArray(tasks) ? tasks : []).find((task) => {
    if (!isActionableTask(task)) {
      return false;
    }
    if (!agentId) {
      return true;
    }
    return task.ownerAgentId === agentId || task.assigneeAgentId === agentId;
  }) || null;
}

function selectedAgentIdsFromStatus(payload) {
  if (Array.isArray(payload?.activeAttempt?.selectedAgentIds) && payload.activeAttempt.selectedAgentIds.length > 0) {
    return normalizeArray(payload.activeAttempt.selectedAgentIds);
  }
  if (Array.isArray(payload?.rerunRequest?.selectedAgentIds) && payload.rerunRequest.selectedAgentIds.length > 0) {
    return normalizeArray(payload.rerunRequest.selectedAgentIds);
  }
  if (Array.isArray(payload?.relaunchPlan?.selectedAgentIds) && payload.relaunchPlan.selectedAgentIds.length > 0) {
    return normalizeArray(payload.relaunchPlan.selectedAgentIds);
  }
  return normalizeArray(
    (Array.isArray(payload?.logicalAgents) ? payload.logicalAgents : [])
      .filter((agent) => agent?.selectedForRerun || agent?.selectedForActiveAttempt)
      .map((agent) => agent.agentId),
  );
}

function readSignalAck(filePath) {
  const payload = readJsonOrNull(filePath);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const version = Number.parseInt(String(payload.version ?? ""), 10);
  return {
    agentId: normalizeString(payload.agentId),
    version: Number.isFinite(version) && version > 0 ? version : 0,
    signal: normalizeString(payload.signal),
    observedAt: normalizeString(payload.observedAt),
  };
}

function writeSignalSnapshot(filePath, nextSnapshot, comparablePayload, decorateSnapshot = null) {
  ensureDirectory(path.dirname(filePath));
  const previous = readJsonOrNull(filePath);
  const previousComparable = previous?.comparable || null;
  const comparableChanged =
    JSON.stringify(previousComparable || null) !== JSON.stringify(comparablePayload || null);
  const previousVersion = Number.parseInt(String(previous?.version ?? ""), 10);
  const version =
    comparableChanged || !Number.isFinite(previousVersion) || previousVersion <= 0
      ? Math.max(1, Number.isFinite(previousVersion) ? previousVersion + 1 : 1)
      : previousVersion;
  const changedAt =
    comparableChanged || !normalizeString(previous?.changedAt)
      ? toIsoTimestamp()
      : previous.changedAt;
  let payload = {
    ...nextSnapshot,
    version,
    changedAt,
    comparable: comparablePayload,
  };
  if (typeof decorateSnapshot === "function") {
    payload = decorateSnapshot(payload) || payload;
  }
  writeJsonAtomic(filePath, payload);
  return {
    snapshot: payload,
    changed: comparableChanged,
  };
}

function finalizePersistedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const { comparable, ...rest } = snapshot;
  return rest;
}

export function waveSignalPath(lanePaths, waveNumber) {
  return path.join(lanePaths.signalsDir, `wave-${waveNumber}.json`);
}

export function waveSignalAgentDir(lanePaths, waveNumber) {
  return path.join(lanePaths.signalsDir, `wave-${waveNumber}`);
}

export function agentSignalPath(lanePaths, waveNumber, agentId) {
  return path.join(waveSignalAgentDir(lanePaths, waveNumber), `${normalizeId(agentId)}.json`);
}

export function agentSignalAckPath(lanePaths, waveNumber, agentId) {
  return path.join(
    waveSignalAgentDir(lanePaths, waveNumber),
    "acks",
    `${normalizeId(agentId)}.json`,
  );
}

export function residentSignalPath(lanePaths, waveNumber) {
  return agentSignalPath(lanePaths, waveNumber, RESIDENT_SIGNAL_ID);
}

export function residentSignalAckPath(lanePaths, waveNumber) {
  return agentSignalAckPath(lanePaths, waveNumber, RESIDENT_SIGNAL_ID);
}

export function agentUsesSignalHygiene(agent) {
  const resolvedIds = Array.isArray(agent?.skillsResolved?.ids) ? agent.skillsResolved.ids : [];
  const explicitIds = Array.isArray(agent?.skills) ? agent.skills : [];
  return [...resolvedIds, ...explicitIds].some(
    (skillId) => String(skillId || "").trim().toLowerCase() === SIGNAL_HYGIENE_SKILL_ID,
  );
}

export function waveSignalExitCode(signalSnapshot) {
  const signal = String(signalSnapshot?.signal || "").trim().toLowerCase();
  if (signal === "completed") {
    return 0;
  }
  if (signal === "failed") {
    return 40;
  }
  if (signal === "feedback-requested") {
    return 20;
  }
  return 10;
}

export function buildSignalStatusLine(signalSnapshot, context = {}) {
  const lane = normalizeString(context.lane) || normalizeString(signalSnapshot?.lane) || "main";
  const wave = Number.parseInt(String(context.wave ?? signalSnapshot?.wave ?? 0), 10);
  const agentId = normalizeString(context.agentId) || normalizeString(signalSnapshot?.agentId);
  const targetKey = agentId ? "agent" : "agents";
  const targetValue = agentId
    ? agentId
    : normalizeArray(signalSnapshot?.targetAgentIds || []).join(",") || "none";
  const blocking = normalizeString(signalSnapshot?.blocking?.kind) || "none";
  const attempt = Number.parseInt(String(signalSnapshot?.attempt ?? 0), 10) || 0;
  const shouldWake =
    typeof signalSnapshot?.shouldWake === "boolean"
      ? signalSnapshot.shouldWake
        ? "yes"
        : "no"
      : "n/a";
  return [
    `signal=${normalizeString(signalSnapshot?.signal) || "waiting"}`,
    `lane=${lane}`,
    `wave=${Number.isFinite(wave) ? wave : 0}`,
    `phase=${normalizeString(signalSnapshot?.phase) || "unknown"}`,
    `status=${normalizeString(signalSnapshot?.status) || "running"}`,
    `blocking=${blocking}`,
    `attempt=${attempt}`,
    `${targetKey}=${targetValue}`,
    `version=${Number.parseInt(String(signalSnapshot?.version ?? 0), 10) || 0}`,
    `should_wake=${shouldWake}`,
  ].join(" ");
}

function buildWaveComparable(snapshot) {
  return {
    status: snapshot.status,
    phase: snapshot.phase,
    signal: snapshot.signal,
    reason: snapshot.reason,
    attempt: snapshot.attempt,
    blocking: snapshot.blocking,
    selectionSource: snapshot.selectionSource,
    targetAgentIds: snapshot.targetAgentIds,
  };
}

function buildAgentComparable(snapshot) {
  return {
    status: snapshot.status,
    phase: snapshot.phase,
    signal: snapshot.signal,
    reason: snapshot.reason,
    attempt: snapshot.attempt,
    targetAgentIds: normalizeArray(snapshot.targetAgentIds),
    logicalState: snapshot.logicalState,
    selectedForRerun: snapshot.selectedForRerun,
    selectedForActiveAttempt: snapshot.selectedForActiveAttempt,
    blocking: snapshot.blocking,
    openFeedbackRequestIds: snapshot.openFeedbackRequestIds,
    answeredFeedbackRequestIds: snapshot.answeredFeedbackRequestIds,
    pendingCoordinationAction: snapshot.pendingCoordinationAction,
    pendingTaskIds: snapshot.pendingTaskIds,
  };
}

function buildWaveSignalCore(lanePaths, wave, statusPayload) {
  const phase = normalizeString(statusPayload?.phase) || "unknown";
  const blocking = statusPayload?.blockingEdge || null;
  const selectedAgentIds = selectedAgentIdsFromStatus(statusPayload);
  const terminal = terminalWaveSignal(phase);
  if (terminal) {
    return {
      kind: "wave-signal",
      lane: lanePaths.lane,
      wave: wave.wave,
      status: terminal === "completed" ? "completed" : "failed",
      phase,
      signal: terminal,
      reason:
        terminal === "completed"
          ? `Wave ${wave.wave} completed.`
          : `Wave ${wave.wave} entered a terminal failure state.`,
      attempt: statusPayload?.activeAttempt?.attemptNumber || 0,
      blocking,
      selectionSource: normalizeString(statusPayload?.selectionSource) || "none",
      targetAgentIds: [],
      artifacts: {
        signalPath: relativePath(waveSignalPath(lanePaths, wave.wave)),
        messageBoardPath: relativePath(path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`)),
        sharedSummaryPath: relativePath(
          path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, "shared-summary.md"),
        ),
        dashboardPath: relativePath(path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`)),
      },
    };
  }
  const pendingFeedback = pendingFeedbackRequests(statusPayload?.feedbackRequests);
  if (
    pendingFeedback.length > 0 ||
    ["human-input", "human-escalation"].includes(String(blocking?.kind || "").trim().toLowerCase())
  ) {
    return {
      kind: "wave-signal",
      lane: lanePaths.lane,
      wave: wave.wave,
      status: "blocked",
      phase,
      signal: "feedback-requested",
      reason:
        normalizeString(pendingFeedback[0]?.question) ||
        normalizeString(blocking?.detail) ||
        "Human feedback is required before the wave can continue.",
      attempt: statusPayload?.activeAttempt?.attemptNumber || 0,
      blocking,
      selectionSource: normalizeString(statusPayload?.selectionSource) || "none",
      targetAgentIds: normalizeArray(
        pendingFeedback.map((request) => request.agentId).filter(Boolean),
      ),
      artifacts: {
        signalPath: relativePath(waveSignalPath(lanePaths, wave.wave)),
        messageBoardPath: relativePath(path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`)),
        sharedSummaryPath: relativePath(
          path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, "shared-summary.md"),
        ),
        dashboardPath: relativePath(path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`)),
      },
    };
  }
  const answeredFeedback = answeredFeedbackRequests(statusPayload?.feedbackRequests);
  if (answeredFeedback.length > 0) {
    return {
      kind: "wave-signal",
      lane: lanePaths.lane,
      wave: wave.wave,
      status: "running",
      phase,
      signal: "feedback-answered",
      reason:
        normalizeString(answeredFeedback[0]?.responseText) ||
        `Human feedback ${answeredFeedback[0]?.id || ""} was answered.`,
      attempt: statusPayload?.activeAttempt?.attemptNumber || 0,
      blocking,
      selectionSource: normalizeString(statusPayload?.selectionSource) || "none",
      targetAgentIds: normalizeArray(
        answeredFeedback.map((request) => request.agentId).filter(Boolean),
      ),
      artifacts: {
        signalPath: relativePath(waveSignalPath(lanePaths, wave.wave)),
        messageBoardPath: relativePath(path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`)),
        sharedSummaryPath: relativePath(
          path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, "shared-summary.md"),
        ),
        dashboardPath: relativePath(path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`)),
      },
    };
  }
  const coordinationAction = firstActionableTask(statusPayload?.tasks);
  if (coordinationAction) {
    return {
      kind: "wave-signal",
      lane: lanePaths.lane,
      wave: wave.wave,
      status: blocking ? "blocked" : "running",
      phase,
      signal: "coordination-action",
      reason: normalizeString(coordinationAction.title) || "Targeted coordination action is pending.",
      attempt: statusPayload?.activeAttempt?.attemptNumber || 0,
      blocking,
      selectionSource: normalizeString(statusPayload?.selectionSource) || "none",
      targetAgentIds: normalizeArray([
        coordinationAction.assigneeAgentId,
        coordinationAction.ownerAgentId,
      ]),
      artifacts: {
        signalPath: relativePath(waveSignalPath(lanePaths, wave.wave)),
        messageBoardPath: relativePath(path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`)),
        sharedSummaryPath: relativePath(
          path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, "shared-summary.md"),
        ),
        dashboardPath: relativePath(path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`)),
      },
    };
  }
  if (
    !statusPayload?.activeAttempt &&
    selectedAgentIds.length > 0 &&
    ["rerun-request", "relaunch-plan"].includes(String(statusPayload?.selectionSource || ""))
  ) {
    return {
      kind: "wave-signal",
      lane: lanePaths.lane,
      wave: wave.wave,
      status: "running",
      phase,
      signal: "resume-ready",
      reason: `Wave ${wave.wave} is ready to relaunch selected agents.`,
      attempt: statusPayload?.activeAttempt?.attemptNumber || 0,
      blocking,
      selectionSource: normalizeString(statusPayload?.selectionSource) || "none",
      targetAgentIds: selectedAgentIds,
      artifacts: {
        signalPath: relativePath(waveSignalPath(lanePaths, wave.wave)),
        messageBoardPath: relativePath(path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`)),
        sharedSummaryPath: relativePath(
          path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, "shared-summary.md"),
        ),
        dashboardPath: relativePath(path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`)),
      },
    };
  }
  return {
    kind: "wave-signal",
    lane: lanePaths.lane,
    wave: wave.wave,
    status: blocking ? "blocked" : "running",
    phase,
    signal: statusPayload?.activeAttempt || blocking ? "waiting" : "stable",
    reason:
      normalizeString(blocking?.detail) ||
      (statusPayload?.activeAttempt ? "Wave is still running." : "No new actionable signal."),
    attempt: statusPayload?.activeAttempt?.attemptNumber || 0,
    blocking,
    selectionSource: normalizeString(statusPayload?.selectionSource) || "none",
    targetAgentIds: selectedAgentIds,
    artifacts: {
      signalPath: relativePath(waveSignalPath(lanePaths, wave.wave)),
      messageBoardPath: relativePath(path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`)),
      sharedSummaryPath: relativePath(
        path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, "shared-summary.md"),
      ),
      dashboardPath: relativePath(path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`)),
    },
  };
}

function buildAgentSignalCore(lanePaths, wave, statusPayload, logicalAgent) {
  const agentId = logicalAgent.agentId;
  const phase = normalizeString(statusPayload?.phase) || "unknown";
  const terminal = terminalWaveSignal(phase);
  const pendingFeedback = pendingFeedbackRequests(statusPayload?.feedbackRequests, agentId);
  const answeredFeedback = answeredFeedbackRequests(statusPayload?.feedbackRequests, agentId);
  const coordinationAction = firstActionableTask(statusPayload?.tasks, agentId);
  const blocking =
    statusPayload?.blockingEdge?.agentId === agentId ? statusPayload.blockingEdge : null;
  const pendingTaskIds = normalizeArray(
    (Array.isArray(statusPayload?.tasks) ? statusPayload.tasks : [])
      .filter((task) => task.ownerAgentId === agentId || task.assigneeAgentId === agentId)
      .filter((task) => isActionableTask(task))
      .map((task) => task.taskId),
  );
  let signal = "stable";
  let status = "waiting";
  let reason = "No new actionable signal.";
  if (terminal === "completed") {
    signal = "completed";
    status = "completed";
    reason = `Wave ${wave.wave} completed.`;
  } else if (terminal === "failed") {
    signal = "failed";
    status = "failed";
    reason =
      normalizeString(logicalAgent.reason) ||
      `Wave ${wave.wave} entered a terminal failure state.`;
  } else if (pendingFeedback.length > 0) {
    signal = "feedback-requested";
    status = "blocked";
    reason = normalizeString(pendingFeedback[0]?.question) || "Human feedback is pending.";
  } else if (answeredFeedback.length > 0) {
    signal = "feedback-answered";
    status = "running";
    reason =
      normalizeString(answeredFeedback[0]?.responseText) ||
      `Human feedback ${answeredFeedback[0]?.id || ""} was answered.`;
  } else if (coordinationAction) {
    signal = "coordination-action";
    status = String(coordinationAction.state || "").trim().toLowerCase() === "input-required"
      ? "blocked"
      : "running";
    reason = normalizeString(coordinationAction.title) || "Targeted coordination action is pending.";
  } else if (logicalAgent.state === "needs-rerun") {
    signal = "failed";
    status = "failed";
    reason =
      normalizeString(logicalAgent.reason) ||
      `Agent ${agentId} needs another run before the wave can complete.`;
  } else if (logicalAgent.selectedForRerun && !logicalAgent.selectedForActiveAttempt) {
    signal = "resume-ready";
    status = "running";
    reason = `Agent ${agentId} was selected for the next resume pass.`;
  } else if (logicalAgent.state === "working" || logicalAgent.selectedForActiveAttempt) {
    signal = "waiting";
    status = "running";
    reason = normalizeString(logicalAgent.reason) || `Agent ${agentId} is currently working.`;
  } else if (logicalAgent.state === "blocked") {
    signal = "waiting";
    status = "blocked";
    reason = normalizeString(logicalAgent.reason) || "Agent is blocked on an external dependency.";
  }
  return {
    kind: "agent-signal",
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId,
    status,
    phase,
    signal,
    reason,
    attempt: statusPayload?.activeAttempt?.attemptNumber || 0,
    logicalState: normalizeString(logicalAgent.state) || "planned",
    selectedForRerun: logicalAgent.selectedForRerun === true,
    selectedForActiveAttempt: logicalAgent.selectedForActiveAttempt === true,
    blocking,
    pendingTaskIds,
    pendingCoordinationAction: coordinationAction
      ? {
          taskId: coordinationAction.taskId,
          taskType: coordinationAction.taskType,
          state: coordinationAction.state,
          title: coordinationAction.title,
        }
      : null,
    openFeedbackRequestIds: normalizeArray(pendingFeedback.map((request) => request.id)),
    answeredFeedbackRequestIds: normalizeArray(answeredFeedback.map((request) => request.id)),
    artifacts: {
      signalPath: relativePath(agentSignalPath(lanePaths, wave.wave, agentId)),
      ackPath: relativePath(agentSignalAckPath(lanePaths, wave.wave, agentId)),
      messageBoardPath: relativePath(path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`)),
      sharedSummaryPath: relativePath(
        path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, "shared-summary.md"),
      ),
      inboxPath: relativePath(path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, `${agentId}.md`)),
    },
  };
}

function buildResidentSignalCore(lanePaths, wave, waveSignal) {
  return {
    kind: "resident-orchestrator-signal",
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId: RESIDENT_SIGNAL_ID,
    status: waveSignal.status,
    phase: waveSignal.phase,
    signal: waveSignal.signal,
    reason: waveSignal.reason,
    attempt: waveSignal.attempt,
    targetAgentIds: normalizeArray(waveSignal.targetAgentIds),
    artifacts: {
      signalPath: relativePath(residentSignalPath(lanePaths, wave.wave)),
      ackPath: relativePath(residentSignalAckPath(lanePaths, wave.wave)),
      coordinationLogPath: relativePath(path.join(lanePaths.coordinationDir, `wave-${wave.wave}.jsonl`)),
      messageBoardPath: relativePath(path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`)),
      sharedSummaryPath: relativePath(
        path.join(lanePaths.inboxesDir, `wave-${wave.wave}`, "shared-summary.md"),
      ),
      dashboardPath: relativePath(path.join(lanePaths.dashboardsDir, `wave-${wave.wave}.json`)),
      triagePath: relativePath(path.join(lanePaths.feedbackTriageDir, `wave-${wave.wave}.jsonl`)),
    },
  };
}

function withAck(snapshot, ack) {
  const version = Number.parseInt(String(snapshot?.version ?? 0), 10) || 0;
  const ackVersion = Number.parseInt(String(ack?.version ?? 0), 10) || 0;
  const actionable = ACTIONABLE_SIGNAL_KINDS.has(String(snapshot?.signal || "").trim().toLowerCase());
  return {
    ...snapshot,
    ack: ack
      ? {
          agentId: ack.agentId,
          version: ackVersion,
          signal: ack.signal,
          observedAt: ack.observedAt,
        }
      : null,
    shouldWake: actionable && ackVersion < version,
  };
}

export function buildSignalProjectionSet({ lanePaths, wave, statusPayload, includeResident = false }) {
  const waveSignal = buildWaveSignalCore(lanePaths, wave, statusPayload);
  const agentSignals = (Array.isArray(statusPayload?.logicalAgents) ? statusPayload.logicalAgents : []).map(
    (logicalAgent) => buildAgentSignalCore(lanePaths, wave, statusPayload, logicalAgent),
  );
  return {
    wave: waveSignal,
    agents: agentSignals,
    resident: includeResident ? buildResidentSignalCore(lanePaths, wave, waveSignal) : null,
  };
}

export function syncWaveSignalProjections({
  lanePaths,
  wave,
  statusPayload,
  includeResident = false,
}) {
  ensureDirectory(lanePaths.signalsDir);
  ensureDirectory(waveSignalAgentDir(lanePaths, wave.wave));
  ensureDirectory(path.join(waveSignalAgentDir(lanePaths, wave.wave), "acks"));
  const built = buildSignalProjectionSet({
    lanePaths,
    wave,
    statusPayload,
    includeResident,
  });
  const waveWrite = writeSignalSnapshot(
    waveSignalPath(lanePaths, wave.wave),
    built.wave,
    buildWaveComparable(built.wave),
  );
  const agentResults = [];
  for (const agentSignal of built.agents) {
    const ack = readSignalAck(agentSignalAckPath(lanePaths, wave.wave, agentSignal.agentId));
    const agentWrite = writeSignalSnapshot(
      agentSignalPath(lanePaths, wave.wave, agentSignal.agentId),
      agentSignal,
      buildAgentComparable(agentSignal),
      (snapshot) => withAck(snapshot, ack),
    );
    agentResults.push({
      agentId: agentSignal.agentId,
      changed: agentWrite.changed,
      snapshot: finalizePersistedSnapshot(agentWrite.snapshot),
    });
  }
  let residentResult = null;
  if (built.resident) {
    const ack = readSignalAck(residentSignalAckPath(lanePaths, wave.wave));
    const residentWrite = writeSignalSnapshot(
      residentSignalPath(lanePaths, wave.wave),
      built.resident,
      buildAgentComparable({
        ...built.resident,
        logicalState: null,
        selectedForRerun: false,
        selectedForActiveAttempt: false,
        blocking: null,
        pendingTaskIds: [],
        pendingCoordinationAction: null,
        openFeedbackRequestIds: [],
        answeredFeedbackRequestIds: [],
      }),
      (snapshot) => withAck(snapshot, ack),
    );
    residentResult = {
      agentId: RESIDENT_SIGNAL_ID,
      changed: residentWrite.changed,
      snapshot: finalizePersistedSnapshot(residentWrite.snapshot),
    };
  }
  return {
    wave: {
      changed: waveWrite.changed,
      snapshot: finalizePersistedSnapshot(waveWrite.snapshot),
    },
    agents: agentResults,
    resident: residentResult,
  };
}
