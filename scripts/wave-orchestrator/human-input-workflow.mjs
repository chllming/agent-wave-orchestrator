import { toIsoTimestamp } from "./shared.mjs";

// ── Human Input Workflow (P1-10) ──
// End-state schema from docs/plans/end-state-architecture.md
//
// States: pending → assigned → answered | escalated | resolved | timed_out | rerouted

export const HUMAN_INPUT_KINDS = new Set([
  "clarification",
  "escalation",
  "approval",
  "decision",
]);

export const HUMAN_INPUT_STATUSES = new Set([
  "pending",
  "assigned",
  "answered",
  "escalated",
  "resolved",
  "timed_out",
  "rerouted",
]);

export const HUMAN_INPUT_VALID_TRANSITIONS = {
  pending: ["assigned", "escalated", "timed_out", "resolved"],
  assigned: ["answered", "escalated", "timed_out", "rerouted", "resolved"],
  answered: ["resolved"],
  escalated: ["assigned", "answered", "resolved", "timed_out"],
  resolved: [],
  timed_out: ["rerouted", "escalated", "resolved"],
  rerouted: ["pending", "assigned", "resolved"],
};

const BLOCKING_STATUSES = new Set(["pending", "assigned", "escalated", "rerouted"]);

const DEFAULT_TIMEOUT_POLICY = {
  ackDeadlineMs: 60000,
  resolveDeadlineMs: 300000,
  escalateAfterMs: 120000,
};

const DEFAULT_REROUTE_POLICY = {
  maxReroutes: 3,
  rerouteHistory: [],
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value, fallback = null) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeRerouteHistory(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    result.push({
      from: normalizeText(entry.from, null),
      to: normalizeText(entry.to, null),
      reason: normalizeText(entry.reason, null),
      at: normalizeText(entry.at, null),
    });
  }
  return result;
}

function normalizeSlaMetrics(raw) {
  if (!isPlainObject(raw)) {
    return {
      timeToAck: null,
      timeToResolve: null,
      wasEscalated: false,
      wasRerouted: false,
      wasTimedOut: false,
    };
  }
  return {
    timeToAck: Number.isFinite(raw.timeToAck) ? raw.timeToAck : null,
    timeToResolve: Number.isFinite(raw.timeToResolve) ? raw.timeToResolve : null,
    wasEscalated: Boolean(raw.wasEscalated),
    wasRerouted: Boolean(raw.wasRerouted),
    wasTimedOut: Boolean(raw.wasTimedOut),
  };
}

export function normalizeHumanInputRequest(request, defaults = {}) {
  const source = isPlainObject(request) ? request : {};
  const defaultSource = isPlainObject(defaults) ? defaults : {};
  const now = toIsoTimestamp();

  const rawKind = normalizeText(source.kind, normalizeText(defaultSource.kind, "clarification"));
  const kind = HUMAN_INPUT_KINDS.has(rawKind) ? rawKind : "clarification";

  const timeoutPolicy = isPlainObject(source.timeoutPolicy)
    ? {
        ackDeadlineMs: Number.isFinite(source.timeoutPolicy.ackDeadlineMs)
          ? source.timeoutPolicy.ackDeadlineMs
          : DEFAULT_TIMEOUT_POLICY.ackDeadlineMs,
        resolveDeadlineMs: Number.isFinite(source.timeoutPolicy.resolveDeadlineMs)
          ? source.timeoutPolicy.resolveDeadlineMs
          : DEFAULT_TIMEOUT_POLICY.resolveDeadlineMs,
        escalateAfterMs: Number.isFinite(source.timeoutPolicy.escalateAfterMs)
          ? source.timeoutPolicy.escalateAfterMs
          : DEFAULT_TIMEOUT_POLICY.escalateAfterMs,
      }
    : { ...DEFAULT_TIMEOUT_POLICY };

  const reroutePolicy = isPlainObject(source.reroutePolicy)
    ? {
        maxReroutes: Number.isFinite(source.reroutePolicy.maxReroutes)
          ? source.reroutePolicy.maxReroutes
          : DEFAULT_REROUTE_POLICY.maxReroutes,
        rerouteHistory: normalizeRerouteHistory(source.reroutePolicy.rerouteHistory),
      }
    : { ...DEFAULT_REROUTE_POLICY, rerouteHistory: [] };

  const rawStatus = normalizeText(source.status, normalizeText(defaultSource.status, "pending"));
  const status = HUMAN_INPUT_STATUSES.has(rawStatus) ? rawStatus : "pending";

  const waveNumber = Number.isFinite(source.waveNumber)
    ? source.waveNumber
    : Number.isFinite(defaultSource.waveNumber)
      ? defaultSource.waveNumber
      : null;
  const lane = normalizeText(source.lane, normalizeText(defaultSource.lane, null));

  const requestedAt = normalizeText(source.requestedAt, normalizeText(source.createdAt, normalizeText(defaultSource.requestedAt, now)));

  const linkedRequests = Array.isArray(source.linkedRequests)
    ? source.linkedRequests.map((r) => normalizeText(r)).filter(Boolean)
    : [];

  return {
    requestId: normalizeText(source.requestId, normalizeText(defaultSource.requestId, null)),
    waveNumber,
    lane,
    kind,
    status,
    title: normalizeText(source.title, normalizeText(defaultSource.title, null)),
    detail: normalizeText(source.detail, normalizeText(defaultSource.detail, null)),
    requestedBy: normalizeText(source.requestedBy, normalizeText(defaultSource.requestedBy, null)),
    requestedAt,
    assignedTo: normalizeText(source.assignedTo, normalizeText(defaultSource.assignedTo, null)),
    assignedAt: normalizeText(source.assignedAt, null),
    answeredAt: normalizeText(source.answeredAt, null),
    resolvedAt: normalizeText(source.resolvedAt, null),
    escalatedAt: normalizeText(source.escalatedAt, null),
    timeoutPolicy,
    reroutePolicy,
    linkedRequests,
    closureCondition: normalizeText(source.closureCondition, null),
    slaMetrics: normalizeSlaMetrics(source.slaMetrics),
    answer: normalizeText(source.answer, null),
    resolution: normalizeText(source.resolution, null),
    updatedAt: normalizeText(source.updatedAt, normalizeText(defaultSource.updatedAt, now)),
  };
}

export function transitionHumanInputStatus(currentStatus, targetStatus) {
  if (!HUMAN_INPUT_STATUSES.has(currentStatus)) {
    throw new Error(`Invalid current status: ${currentStatus}`);
  }
  if (!HUMAN_INPUT_STATUSES.has(targetStatus)) {
    throw new Error(`Invalid target status: ${targetStatus}`);
  }
  const allowed = HUMAN_INPUT_VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new Error(
      `Invalid transition from "${currentStatus}" to "${targetStatus}". Allowed: [${(allowed || []).join(", ")}]`,
    );
  }
  return targetStatus;
}

export function assignRequest(request, assignedTo) {
  if (!isPlainObject(request)) {
    throw new Error("Request must be an object");
  }
  const now = toIsoTimestamp();
  transitionHumanInputStatus(request.status, "assigned");
  const requestedAtMs = Date.parse(request.requestedAt || "");
  const assignedAtMs = Date.parse(now);
  const timeToAck =
    Number.isFinite(requestedAtMs) && Number.isFinite(assignedAtMs)
      ? assignedAtMs - requestedAtMs
      : null;
  return {
    ...request,
    status: "assigned",
    assignedTo: normalizeText(assignedTo, request.assignedTo),
    assignedAt: now,
    updatedAt: now,
    slaMetrics: {
      ...request.slaMetrics,
      timeToAck,
    },
  };
}

export function answerRequest(request, answer) {
  if (!isPlainObject(request)) {
    throw new Error("Request must be an object");
  }
  const now = toIsoTimestamp();
  transitionHumanInputStatus(request.status, "answered");
  return {
    ...request,
    status: "answered",
    answer: normalizeText(answer, null),
    answeredAt: now,
    updatedAt: now,
  };
}

export function resolveRequest(request, resolution) {
  if (!isPlainObject(request)) {
    throw new Error("Request must be an object");
  }
  const now = toIsoTimestamp();
  transitionHumanInputStatus(request.status, "resolved");
  const requestedAtMs = Date.parse(request.requestedAt || "");
  const resolvedAtMs = Date.parse(now);
  const timeToResolve =
    Number.isFinite(requestedAtMs) && Number.isFinite(resolvedAtMs)
      ? resolvedAtMs - requestedAtMs
      : null;
  return {
    ...request,
    status: "resolved",
    resolution: normalizeText(resolution, null),
    resolvedAt: now,
    updatedAt: now,
    slaMetrics: {
      ...request.slaMetrics,
      timeToResolve,
    },
  };
}

export function escalateRequest(request) {
  if (!isPlainObject(request)) {
    throw new Error("Request must be an object");
  }
  const now = toIsoTimestamp();
  transitionHumanInputStatus(request.status, "escalated");
  return {
    ...request,
    status: "escalated",
    escalatedAt: now,
    updatedAt: now,
    slaMetrics: {
      ...request.slaMetrics,
      wasEscalated: true,
    },
  };
}

export function timeoutRequest(request) {
  if (!isPlainObject(request)) {
    throw new Error("Request must be an object");
  }
  const now = toIsoTimestamp();
  transitionHumanInputStatus(request.status, "timed_out");
  return {
    ...request,
    status: "timed_out",
    updatedAt: now,
    slaMetrics: {
      ...request.slaMetrics,
      wasTimedOut: true,
    },
  };
}

export function rerouteRequest(request, to, reason) {
  if (!isPlainObject(request)) {
    throw new Error("Request must be an object");
  }
  const now = toIsoTimestamp();
  transitionHumanInputStatus(request.status, "rerouted");

  const currentHistory = Array.isArray(request.reroutePolicy?.rerouteHistory)
    ? request.reroutePolicy.rerouteHistory
    : [];

  const maxReroutes = request.reroutePolicy?.maxReroutes ?? DEFAULT_REROUTE_POLICY.maxReroutes;
  if (currentHistory.length >= maxReroutes) {
    throw new Error(`Max reroutes (${maxReroutes}) exceeded`);
  }

  const newHistory = [
    ...currentHistory,
    {
      from: request.assignedTo || null,
      to: normalizeText(to, null),
      reason: normalizeText(reason, null),
      at: now,
    },
  ];

  return {
    ...request,
    status: "rerouted",
    assignedTo: normalizeText(to, null),
    updatedAt: now,
    reroutePolicy: {
      ...request.reroutePolicy,
      rerouteHistory: newHistory,
    },
    slaMetrics: {
      ...request.slaMetrics,
      wasRerouted: true,
    },
  };
}

export function isHumanInputBlocking(request) {
  const source = isPlainObject(request) ? request : {};
  const status = normalizeText(source.status, "pending");
  return BLOCKING_STATUSES.has(status);
}

export function buildHumanInputRequests(coordinationState, feedbackRequests, options = {}) {
  const results = [];
  const coordState = isPlainObject(coordinationState) ? coordinationState : {};
  const feedbackList = Array.isArray(feedbackRequests) ? feedbackRequests : [];
  const now = toIsoTimestamp();

  // Process clarification-request records from coordination state
  const clarifications = Array.isArray(coordState.clarifications)
    ? coordState.clarifications
    : [];
  for (const record of clarifications) {
    if (!isPlainObject(record)) continue;
    const rawKind = normalizeText(record.kind, null);
    if (
      rawKind !== "clarification-request" &&
      rawKind !== "human-escalation" &&
      rawKind !== "human-feedback"
    ) {
      continue;
    }
    const mappedKind =
      rawKind === "clarification-request"
        ? "clarification"
        : rawKind === "human-escalation"
          ? "escalation"
          : "clarification";
    const rawStatus = normalizeText(record.status, "pending");
    let mappedStatus = "pending";
    if (rawStatus === "in_progress" || rawStatus === "assigned") {
      mappedStatus = "assigned";
    } else if (rawStatus === "resolved" || rawStatus === "closed") {
      mappedStatus = "resolved";
    } else if (rawStatus === "answered") {
      mappedStatus = "answered";
    }
    results.push(
      normalizeHumanInputRequest({
        requestId: normalizeText(record.id, null),
        kind: mappedKind,
        status: mappedStatus,
        title: normalizeText(record.summary, null),
        detail: normalizeText(record.detail, null),
        requestedBy: normalizeText(record.agentId, null),
        assignedTo: null,
        requestedAt: normalizeText(record.createdAt, now),
        updatedAt: normalizeText(record.updatedAt, now),
      }),
    );
  }

  // Process human escalations from coordination state
  const humanEscalations = Array.isArray(coordState.humanEscalations)
    ? coordState.humanEscalations
    : [];
  for (const record of humanEscalations) {
    if (!isPlainObject(record)) continue;
    const rawStatus = normalizeText(record.status, "pending");
    let mappedStatus = "escalated";
    if (rawStatus === "resolved" || rawStatus === "closed") {
      mappedStatus = "resolved";
    } else if (rawStatus === "answered") {
      mappedStatus = "answered";
    }
    results.push(
      normalizeHumanInputRequest({
        requestId: normalizeText(record.id, null),
        kind: "escalation",
        status: mappedStatus,
        title: normalizeText(record.summary, null),
        detail: normalizeText(record.detail, null),
        requestedBy: normalizeText(record.agentId, null),
        assignedTo: "operator",
        assignedAt: normalizeText(record.createdAt, now),
        requestedAt: normalizeText(record.createdAt, now),
        updatedAt: normalizeText(record.updatedAt, now),
        escalatedAt: normalizeText(record.createdAt, now),
      }),
    );
  }

  // Process feedback requests
  for (const record of feedbackList) {
    if (!isPlainObject(record)) continue;
    const rawStatus = normalizeText(record.status, "pending");
    let mappedStatus = "pending";
    if (rawStatus === "assigned") {
      mappedStatus = "assigned";
    } else if (rawStatus === "answered") {
      mappedStatus = "answered";
    } else if (rawStatus === "resolved" || rawStatus === "closed") {
      mappedStatus = "resolved";
    }
    results.push(
      normalizeHumanInputRequest({
        requestId: normalizeText(record.id, null),
        kind: "clarification",
        status: mappedStatus,
        title: normalizeText(record.question, null),
        detail: normalizeText(record.context, null),
        requestedBy: normalizeText(record.agentId, null),
        assignedTo: "operator",
        requestedAt: normalizeText(record.createdAt, now),
        updatedAt: normalizeText(record.updatedAt, now),
        answeredAt: normalizeText(record.response?.answeredAt, null),
        answer: normalizeText(record.response?.text, null),
      }),
    );
  }

  return results;
}

export function evaluateHumanInputTimeout(request, now = Date.now()) {
  const source = isPlainObject(request) ? request : {};
  const requestedAtMs = Date.parse(source.requestedAt || source.createdAt || "");
  if (!Number.isFinite(requestedAtMs)) {
    return { expired: false, shouldEscalate: false, ackOverdue: false, elapsedMs: 0 };
  }
  const elapsedMs = Math.max(0, now - requestedAtMs);
  const policy = isPlainObject(source.timeoutPolicy)
    ? source.timeoutPolicy
    : DEFAULT_TIMEOUT_POLICY;

  const resolveDeadlineMs = Number.isFinite(policy.resolveDeadlineMs)
    ? policy.resolveDeadlineMs
    : DEFAULT_TIMEOUT_POLICY.resolveDeadlineMs;
  const escalateAfterMs = Number.isFinite(policy.escalateAfterMs)
    ? policy.escalateAfterMs
    : DEFAULT_TIMEOUT_POLICY.escalateAfterMs;
  const ackDeadlineMs = Number.isFinite(policy.ackDeadlineMs)
    ? policy.ackDeadlineMs
    : DEFAULT_TIMEOUT_POLICY.ackDeadlineMs;

  const expired = elapsedMs >= resolveDeadlineMs;
  const shouldEscalate = elapsedMs >= escalateAfterMs;
  const ackOverdue = !source.assignedAt && elapsedMs >= ackDeadlineMs;

  return { expired, shouldEscalate, ackOverdue, elapsedMs };
}

export function computeHumanInputMetrics(requests) {
  const list = Array.isArray(requests) ? requests : [];
  const counts = {
    pending: 0,
    assigned: 0,
    answered: 0,
    escalated: 0,
    resolved: 0,
    timed_out: 0,
    rerouted: 0,
  };
  let blocking = 0;
  let overdueCount = 0;
  let totalResolutionMs = 0;
  let resolvedWithTimesCount = 0;

  for (const request of list) {
    const source = isPlainObject(request) ? request : {};
    const status = normalizeText(source.status, "pending");
    if (status in counts) {
      counts[status] += 1;
    }
    if (BLOCKING_STATUSES.has(status)) {
      blocking += 1;
    }
    // Check overdue based on timeout policy
    const timeout = evaluateHumanInputTimeout(source);
    if (timeout.expired && BLOCKING_STATUSES.has(status)) {
      overdueCount += 1;
    }
    // Compute resolution time for resolved requests
    if (status === "resolved" && (source.requestedAt || source.createdAt) && source.resolvedAt) {
      const createdMs = Date.parse(source.requestedAt || source.createdAt);
      const resolvedMs = Date.parse(source.resolvedAt);
      if (Number.isFinite(createdMs) && Number.isFinite(resolvedMs) && resolvedMs >= createdMs) {
        totalResolutionMs += resolvedMs - createdMs;
        resolvedWithTimesCount += 1;
      }
    }
  }

  return {
    total: list.length,
    pending: counts.pending,
    assigned: counts.assigned,
    answered: counts.answered,
    escalated: counts.escalated,
    resolved: counts.resolved,
    timed_out: counts.timed_out,
    rerouted: counts.rerouted,
    blocking,
    overdueCount,
    avgResolutionMs: resolvedWithTimesCount > 0
      ? Math.round(totalResolutionMs / resolvedWithTimesCount)
      : null,
  };
}
