import { toIsoTimestamp } from "./shared.mjs";

// ── Human Input Workflow State Machine ──
//
// States: open -> pending -> answered -> resolved
//                         -> escalated -> resolved

export const HUMAN_INPUT_STATES = new Set([
  "open",
  "pending",
  "answered",
  "escalated",
  "resolved",
]);

export const HUMAN_INPUT_VALID_TRANSITIONS = {
  open: ["pending", "escalated", "resolved"],
  pending: ["answered", "escalated", "resolved"],
  answered: ["resolved"],
  escalated: ["answered", "resolved"],
  resolved: [],
};

const BLOCKING_STATES = new Set(["open", "pending", "escalated"]);

const DEFAULT_TIMEOUT_POLICY = {
  maxWaitMs: 300000,
  escalateAfterMs: 120000,
};

const DEFAULT_REROUTE_POLICY = {
  rerouteOnTimeout: true,
  rerouteTo: "operator",
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value, fallback = null) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function normalizeHumanInputRequest(request, defaults = {}) {
  const source = isPlainObject(request) ? request : {};
  const defaultSource = isPlainObject(defaults) ? defaults : {};
  const now = toIsoTimestamp();

  const timeoutPolicy = isPlainObject(source.timeoutPolicy)
    ? {
        maxWaitMs: Number.isFinite(source.timeoutPolicy.maxWaitMs)
          ? source.timeoutPolicy.maxWaitMs
          : DEFAULT_TIMEOUT_POLICY.maxWaitMs,
        escalateAfterMs: Number.isFinite(source.timeoutPolicy.escalateAfterMs)
          ? source.timeoutPolicy.escalateAfterMs
          : DEFAULT_TIMEOUT_POLICY.escalateAfterMs,
      }
    : { ...DEFAULT_TIMEOUT_POLICY };

  const reroutePolicy = isPlainObject(source.reroutePolicy)
    ? {
        rerouteOnTimeout: source.reroutePolicy.rerouteOnTimeout !== false,
        rerouteTo: normalizeText(source.reroutePolicy.rerouteTo, DEFAULT_REROUTE_POLICY.rerouteTo),
      }
    : { ...DEFAULT_REROUTE_POLICY };

  const rawState = normalizeText(source.state, normalizeText(defaultSource.state, "open"));
  const state = HUMAN_INPUT_STATES.has(rawState) ? rawState : "open";

  return {
    requestId: normalizeText(source.requestId, normalizeText(defaultSource.requestId, null)),
    kind: normalizeText(source.kind, normalizeText(defaultSource.kind, "human-input")),
    state,
    title: normalizeText(source.title, normalizeText(defaultSource.title, null)),
    detail: normalizeText(source.detail, normalizeText(defaultSource.detail, null)),
    requestedBy: normalizeText(source.requestedBy, normalizeText(defaultSource.requestedBy, null)),
    assignedTo: normalizeText(source.assignedTo, normalizeText(defaultSource.assignedTo, null)),
    timeoutPolicy,
    reroutePolicy,
    createdAt: normalizeText(source.createdAt, normalizeText(defaultSource.createdAt, now)),
    updatedAt: normalizeText(source.updatedAt, normalizeText(defaultSource.updatedAt, now)),
    answeredAt: normalizeText(source.answeredAt, null),
    resolvedAt: normalizeText(source.resolvedAt, null),
    escalatedAt: normalizeText(source.escalatedAt, null),
    answer: normalizeText(source.answer, null),
    resolution: normalizeText(source.resolution, null),
  };
}

export function transitionHumanInputState(currentState, targetState) {
  if (!HUMAN_INPUT_STATES.has(currentState)) {
    throw new Error(`Invalid current state: ${currentState}`);
  }
  if (!HUMAN_INPUT_STATES.has(targetState)) {
    throw new Error(`Invalid target state: ${targetState}`);
  }
  const allowed = HUMAN_INPUT_VALID_TRANSITIONS[currentState];
  if (!allowed || !allowed.includes(targetState)) {
    throw new Error(
      `Invalid transition from "${currentState}" to "${targetState}". Allowed: [${(allowed || []).join(", ")}]`,
    );
  }
  return targetState;
}

export function isHumanInputBlocking(request) {
  const source = isPlainObject(request) ? request : {};
  const state = normalizeText(source.state, "open");
  return BLOCKING_STATES.has(state);
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
    const kind = normalizeText(record.kind, null);
    if (
      kind !== "clarification-request" &&
      kind !== "human-escalation" &&
      kind !== "human-feedback"
    ) {
      continue;
    }
    const mappedKind =
      kind === "clarification-request"
        ? "clarification"
        : kind === "human-escalation"
          ? "escalation"
          : "feedback";
    const rawStatus = normalizeText(record.status, "open");
    let mappedState = "open";
    if (rawStatus === "in_progress" || rawStatus === "pending") {
      mappedState = "pending";
    } else if (rawStatus === "resolved" || rawStatus === "closed") {
      mappedState = "resolved";
    } else if (rawStatus === "answered") {
      mappedState = "answered";
    }
    results.push(
      normalizeHumanInputRequest({
        requestId: normalizeText(record.id, null),
        kind: mappedKind,
        state: mappedState,
        title: normalizeText(record.summary, null),
        detail: normalizeText(record.detail, null),
        requestedBy: normalizeText(record.agentId, null),
        assignedTo: null,
        createdAt: normalizeText(record.createdAt, now),
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
    const rawStatus = normalizeText(record.status, "open");
    let mappedState = "escalated";
    if (rawStatus === "resolved" || rawStatus === "closed") {
      mappedState = "resolved";
    } else if (rawStatus === "answered") {
      mappedState = "answered";
    }
    results.push(
      normalizeHumanInputRequest({
        requestId: normalizeText(record.id, null),
        kind: "escalation",
        state: mappedState,
        title: normalizeText(record.summary, null),
        detail: normalizeText(record.detail, null),
        requestedBy: normalizeText(record.agentId, null),
        assignedTo: "operator",
        createdAt: normalizeText(record.createdAt, now),
        updatedAt: normalizeText(record.updatedAt, now),
        escalatedAt: normalizeText(record.createdAt, now),
      }),
    );
  }

  // Process feedback requests
  for (const record of feedbackList) {
    if (!isPlainObject(record)) continue;
    const rawStatus = normalizeText(record.status, "pending");
    let mappedState = "pending";
    if (rawStatus === "answered") {
      mappedState = "answered";
    } else if (rawStatus === "resolved" || rawStatus === "closed") {
      mappedState = "resolved";
    }
    results.push(
      normalizeHumanInputRequest({
        requestId: normalizeText(record.id, null),
        kind: "feedback",
        state: mappedState,
        title: normalizeText(record.question, null),
        detail: normalizeText(record.context, null),
        requestedBy: normalizeText(record.agentId, null),
        assignedTo: "operator",
        createdAt: normalizeText(record.createdAt, now),
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
  const createdAtMs = Date.parse(source.createdAt || "");
  if (!Number.isFinite(createdAtMs)) {
    return { expired: false, shouldEscalate: false, elapsedMs: 0 };
  }
  const elapsedMs = Math.max(0, now - createdAtMs);
  const policy = isPlainObject(source.timeoutPolicy)
    ? source.timeoutPolicy
    : DEFAULT_TIMEOUT_POLICY;
  const maxWaitMs = Number.isFinite(policy.maxWaitMs)
    ? policy.maxWaitMs
    : DEFAULT_TIMEOUT_POLICY.maxWaitMs;
  const escalateAfterMs = Number.isFinite(policy.escalateAfterMs)
    ? policy.escalateAfterMs
    : DEFAULT_TIMEOUT_POLICY.escalateAfterMs;
  const expired = elapsedMs >= maxWaitMs;
  const shouldEscalate = elapsedMs >= escalateAfterMs;
  return { expired, shouldEscalate, elapsedMs };
}

export function computeHumanInputMetrics(requests) {
  const list = Array.isArray(requests) ? requests : [];
  const counts = { open: 0, pending: 0, answered: 0, escalated: 0, resolved: 0 };
  let blocking = 0;
  let overdueCount = 0;
  let totalResolutionMs = 0;
  let resolvedWithTimesCount = 0;

  for (const request of list) {
    const source = isPlainObject(request) ? request : {};
    const state = normalizeText(source.state, "open");
    if (state in counts) {
      counts[state] += 1;
    }
    if (BLOCKING_STATES.has(state)) {
      blocking += 1;
    }
    // Check overdue based on timeout policy
    const timeout = evaluateHumanInputTimeout(source);
    if (timeout.expired && BLOCKING_STATES.has(state)) {
      overdueCount += 1;
    }
    // Compute resolution time for resolved requests
    if (state === "resolved" && source.createdAt && source.resolvedAt) {
      const createdMs = Date.parse(source.createdAt);
      const resolvedMs = Date.parse(source.resolvedAt);
      if (Number.isFinite(createdMs) && Number.isFinite(resolvedMs) && resolvedMs >= createdMs) {
        totalResolutionMs += resolvedMs - createdMs;
        resolvedWithTimesCount += 1;
      }
    }
  }

  return {
    total: list.length,
    open: counts.open,
    pending: counts.pending,
    answered: counts.answered,
    escalated: counts.escalated,
    resolved: counts.resolved,
    blocking,
    overdueCount,
    avgResolutionMs: resolvedWithTimesCount > 0
      ? Math.round(totalResolutionMs / resolvedWithTimesCount)
      : null,
  };
}
