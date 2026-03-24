import crypto from "node:crypto";
import { toIsoTimestamp } from "./shared.mjs";

// ── Contradiction Entity (P2-13) ──
// End-state schema from docs/plans/end-state-architecture.md

export const CONTRADICTION_KINDS = new Set([
  "proof_conflict",
  "integration_conflict",
  "claim_conflict",
  "evidence_conflict",
  "component_conflict",
]);

export const CONTRADICTION_STATUSES = new Set([
  "detected",
  "acknowledged",
  "repair_in_progress",
  "resolved",
  "waived",
]);

export const CONTRADICTION_VALID_TRANSITIONS = {
  detected: ["acknowledged", "resolved", "waived"],
  acknowledged: ["repair_in_progress", "resolved", "waived"],
  repair_in_progress: ["resolved", "waived"],
  resolved: [],
  waived: [],
};

export const CONTRADICTION_SEVERITIES = new Set(["blocking", "advisory"]);

export const CONTRADICTION_RESOLUTION_KINDS = new Set([
  "party_accepted",
  "all_revised",
  "irrelevant",
  "waived",
  "repair_completed",
]);

function stableId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
}

function normalizeParty(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const agentId = normalizeText(raw.agentId);
  if (!agentId) {
    return null;
  }
  return {
    agentId,
    claim: normalizeText(raw.claim),
    evidence: normalizeText(raw.evidence),
  };
}

function normalizeParties(rawParties) {
  if (!Array.isArray(rawParties)) {
    return [];
  }
  const result = [];
  for (const raw of rawParties) {
    const party = normalizeParty(raw);
    if (party) {
      result.push(party);
    }
  }
  return result;
}

function normalizeRepairWork(raw) {
  if (!Array.isArray(raw)) {
    return null;
  }
  const result = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const taskId = normalizeText(item.taskId);
    if (!taskId) {
      continue;
    }
    result.push({
      taskId,
      status: normalizeText(item.status, "pending"),
    });
  }
  return result.length > 0 ? result : null;
}

function normalizeResolution(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const kind = normalizeText(raw.kind);
  if (!kind) {
    return null;
  }
  if (!CONTRADICTION_RESOLUTION_KINDS.has(kind)) {
    throw new Error(
      `resolution.kind must be one of ${[...CONTRADICTION_RESOLUTION_KINDS].join(", ")} (got: ${kind})`,
    );
  }
  return {
    kind,
    detail: normalizeText(raw.detail),
    evidence: normalizeText(raw.evidence),
  };
}

export function normalizeContradiction(raw, defaults = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Contradiction must be an object");
  }

  const now = toIsoTimestamp();
  const contradictionId =
    normalizeText(raw.contradictionId) ||
    normalizeText(defaults.contradictionId) ||
    stableId("contra");

  const kind = normalizeText(raw.kind) || normalizeText(defaults.kind) || "claim_conflict";
  if (!CONTRADICTION_KINDS.has(kind)) {
    throw new Error(
      `kind must be one of ${[...CONTRADICTION_KINDS].join(", ")} (got: ${kind})`,
    );
  }

  const status = normalizeText(raw.status) || normalizeText(defaults.status) || "detected";
  if (!CONTRADICTION_STATUSES.has(status)) {
    throw new Error(
      `status must be one of ${[...CONTRADICTION_STATUSES].join(", ")} (got: ${status})`,
    );
  }

  const severity = normalizeText(raw.severity) || normalizeText(defaults.severity) || "advisory";
  if (!CONTRADICTION_SEVERITIES.has(severity)) {
    throw new Error(
      `severity must be one of ${[...CONTRADICTION_SEVERITIES].join(", ")} (got: ${severity})`,
    );
  }

  const waveNumber = Number.isFinite(raw.waveNumber)
    ? raw.waveNumber
    : Number.isFinite(defaults.waveNumber)
      ? defaults.waveNumber
      : null;
  const lane = normalizeText(raw.lane) || normalizeText(defaults.lane) || null;

  const resolution = normalizeResolution(raw.resolution);

  return {
    contradictionId,
    waveNumber,
    lane,
    kind,
    status,
    severity,
    reportedBy: normalizeText(raw.reportedBy) || normalizeText(defaults.reportedBy) || "system",
    reportedAt: normalizeText(raw.reportedAt) || normalizeText(defaults.reportedAt) || now,
    resolvedBy: normalizeText(raw.resolvedBy) || null,
    resolvedAt: normalizeText(raw.resolvedAt) || null,
    parties: normalizeParties(raw.parties || defaults.parties),
    affectedTasks: normalizeStringArray(raw.affectedTasks || defaults.affectedTasks),
    affectedFacts: normalizeStringArray(raw.affectedFacts || defaults.affectedFacts),
    repairWork: normalizeRepairWork(raw.repairWork),
    resolution,
    supersedes: normalizeText(raw.supersedes) || null,
    impactedGates: normalizeStringArray(raw.impactedGates || defaults.impactedGates),
    updatedAt: normalizeText(raw.updatedAt) || now,
  };
}

export function transitionContradictionStatus(currentStatus, targetStatus) {
  if (!CONTRADICTION_STATUSES.has(currentStatus)) {
    throw new Error(`Invalid contradiction status: ${currentStatus}`);
  }
  if (!CONTRADICTION_STATUSES.has(targetStatus)) {
    throw new Error(`Invalid target contradiction status: ${targetStatus}`);
  }
  const allowed = CONTRADICTION_VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new Error(
      `Invalid contradiction transition from ${currentStatus} to ${targetStatus}`,
    );
  }
  return targetStatus;
}

export function detectContradictions(coordinationState, options = {}) {
  if (!coordinationState || typeof coordinationState !== "object") {
    return [];
  }

  const records = [];
  for (const category of [
    "claims",
    "evidence",
    "decisions",
    "clarifications",
    "blockers",
    "handoffs",
    "requests",
    "humanFeedback",
    "humanEscalations",
  ]) {
    const items = coordinationState[category];
    if (!Array.isArray(items)) {
      continue;
    }
    for (const record of items) {
      if (!record || typeof record !== "object") {
        continue;
      }
      const kind = normalizeText(record.kind);
      if (kind === "claim" || kind === "evidence" || kind === "decision") {
        records.push(record);
      }
    }
  }

  // Also scan flat records array if present
  if (Array.isArray(coordinationState.records)) {
    for (const record of coordinationState.records) {
      if (!record || typeof record !== "object") {
        continue;
      }
      const kind = normalizeText(record.kind);
      if (kind === "claim" || kind === "evidence" || kind === "decision") {
        records.push(record);
      }
    }
  }

  if (records.length < 2) {
    return [];
  }

  // Group by subject: component, path, or summary keyword
  function subjectKey(record) {
    if (record.component) {
      return `component:${normalizeText(record.component)}`;
    }
    const refs = Array.isArray(record.artifactRefs) ? record.artifactRefs : [];
    if (refs.length > 0) {
      return `path:${normalizeText(refs[0])}`;
    }
    const targets = Array.isArray(record.targets) ? record.targets : [];
    if (targets.length > 0) {
      return `target:${normalizeText(targets[0])}`;
    }
    const summary = normalizeText(record.summary).toLowerCase();
    if (summary) {
      return `summary:${summary}`;
    }
    return null;
  }

  const groups = new Map();
  for (const record of records) {
    const key = subjectKey(record);
    if (!key) {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  }

  const now = toIsoTimestamp();
  const contradictions = [];
  const severityOverride = options.severity || null;
  const impactedGatesDefault = options.impactedGates || [];
  const defaultKind = options.kind || "claim_conflict";

  for (const [, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        const agentA = normalizeText(a.agentId);
        const agentB = normalizeText(b.agentId);
        if (!agentA || !agentB || agentA === agentB) {
          continue;
        }

        const stateA = normalizeText(a.state || a.status);
        const stateB = normalizeText(b.state || b.status);
        const hasConflictingStates =
          stateA && stateB && stateA !== stateB;

        const contentA = normalizeText(a.detail || a.summary);
        const contentB = normalizeText(b.detail || b.summary);

        if (!hasConflictingStates) {
          continue;
        }

        contradictions.push(
          normalizeContradiction({
            status: "detected",
            kind: defaultKind,
            parties: [
              { agentId: agentA, claim: contentA, evidence: "" },
              { agentId: agentB, claim: contentB, evidence: "" },
            ],
            severity: severityOverride || "advisory",
            impactedGates: impactedGatesDefault,
            reportedBy: "system",
            reportedAt: now,
          }),
        );
      }
    }
  }

  return contradictions;
}

export function resolveContradiction(contradiction, resolution) {
  if (!contradiction || typeof contradiction !== "object") {
    throw new Error("Contradiction must be an object");
  }
  if (!resolution || typeof resolution !== "object") {
    throw new Error("Resolution must be an object");
  }

  const kind = normalizeText(resolution.kind);
  if (!CONTRADICTION_RESOLUTION_KINDS.has(kind)) {
    throw new Error(
      `resolution.kind must be one of ${[...CONTRADICTION_RESOLUTION_KINDS].join(", ")} (got: ${kind})`,
    );
  }

  const now = toIsoTimestamp();
  return {
    ...contradiction,
    status: "resolved",
    resolution: {
      kind,
      detail: normalizeText(resolution.detail),
      evidence: normalizeText(resolution.evidence),
    },
    resolvedBy: normalizeText(resolution.resolvedBy) || null,
    resolvedAt: now,
    updatedAt: now,
  };
}

export function waiveContradiction(contradiction, reason = "") {
  if (!contradiction || typeof contradiction !== "object") {
    throw new Error("Contradiction must be an object");
  }
  const now = toIsoTimestamp();
  return {
    ...contradiction,
    status: "waived",
    resolution: {
      kind: "waived",
      detail: normalizeText(reason),
      evidence: "",
    },
    updatedAt: now,
  };
}

export function acknowledgeContradiction(contradiction, acknowledgedBy) {
  if (!contradiction || typeof contradiction !== "object") {
    throw new Error("Contradiction must be an object");
  }
  const now = toIsoTimestamp();
  return {
    ...contradiction,
    status: "acknowledged",
    updatedAt: now,
  };
}

export function startRepair(contradiction, repairTasks) {
  if (!contradiction || typeof contradiction !== "object") {
    throw new Error("Contradiction must be an object");
  }
  const now = toIsoTimestamp();
  const repairWork = normalizeRepairWork(repairTasks) || [];
  return {
    ...contradiction,
    status: "repair_in_progress",
    repairWork: repairWork.length > 0 ? repairWork : null,
    updatedAt: now,
  };
}

export function unresolvedContradictions(contradictions) {
  if (!Array.isArray(contradictions)) {
    return [];
  }
  return contradictions.filter(
    (c) =>
      c &&
      typeof c === "object" &&
      c.status !== "resolved" &&
      c.status !== "waived",
  );
}

export function contradictionsBlockingGate(contradictions, gateName) {
  if (!Array.isArray(contradictions) || !gateName) {
    return [];
  }
  return contradictions.filter(
    (c) =>
      c &&
      typeof c === "object" &&
      c.status !== "resolved" &&
      c.status !== "waived" &&
      c.severity === "blocking" &&
      Array.isArray(c.impactedGates) &&
      c.impactedGates.includes(gateName),
  );
}

export function materializeContradictionsFromControlPlaneEvents(controlPlaneEvents = []) {
  const contradictions = new Map();
  for (const event of Array.isArray(controlPlaneEvents) ? controlPlaneEvents : []) {
    if (event?.entityType !== "contradiction") {
      continue;
    }
    const existing = contradictions.get(event.entityId) || null;
    const data = event.data && typeof event.data === "object" ? event.data : {};
    contradictions.set(
      event.entityId,
      normalizeContradiction(
        {
          ...(existing || {}),
          ...data,
          contradictionId: event.entityId,
          waveNumber: event.wave ?? existing?.waveNumber ?? null,
          lane: event.lane || existing?.lane || null,
          reportedAt: data.reportedAt || existing?.reportedAt || event.recordedAt,
          updatedAt: data.updatedAt || event.recordedAt || existing?.updatedAt || null,
          reportedBy: data.reportedBy || existing?.reportedBy || "system",
          severity: data.severity || existing?.severity || "blocking",
          impactedGates: data.impactedGates || existing?.impactedGates || ["integrationBarrier"],
        },
        {
          contradictionId: event.entityId,
          waveNumber: event.wave ?? null,
          lane: event.lane || null,
          reportedAt: event.recordedAt || null,
          updatedAt: event.recordedAt || null,
          reportedBy: "system",
          severity: "blocking",
          impactedGates: ["integrationBarrier"],
        },
      ),
    );
  }
  return contradictions;
}
