import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  compactSingleLine,
  ensureDirectory,
  readJsonOrNull,
  toIsoTimestamp,
  truncate,
  writeTextAtomic,
} from "./shared.mjs";

export const COORDINATION_KIND_VALUES = [
  "request",
  "ack",
  "claim",
  "evidence",
  "decision",
  "blocker",
  "handoff",
  "clarification-request",
  "orchestrator-guidance",
  "resolved-by-policy",
  "human-escalation",
  "human-feedback",
  "integration-summary",
];

export const COORDINATION_STATUS_VALUES = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "closed",
  "superseded",
  "cancelled",
];

export const COORDINATION_PRIORITY_VALUES = ["low", "normal", "high", "urgent"];
export const COORDINATION_CONFIDENCE_VALUES = ["low", "medium", "high"];
const OPEN_COORDINATION_STATUSES = new Set(["open", "acknowledged", "in_progress"]);
export const CLARIFICATION_CLOSURE_PREFIX = "clarification:";

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "")
    .trim();
  return normalized || fallback;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeString(value))
        .filter(Boolean),
    ),
  );
}

function validateEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")} (got: ${value || "empty"})`);
  }
}

function stableId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

export function normalizeCoordinationRecord(rawRecord, defaults = {}) {
  if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
    throw new Error("Coordination record must be an object");
  }
  const now = toIsoTimestamp();
  const id =
    normalizeString(rawRecord.id) ||
    normalizeString(defaults.id) ||
    stableId(`coord-${normalizeString(rawRecord.kind || defaults.kind || "record", "record")}`);
  const kind = normalizeString(rawRecord.kind || defaults.kind).toLowerCase();
  const lane = normalizeString(rawRecord.lane || defaults.lane);
  const wave = Number.parseInt(String(rawRecord.wave ?? defaults.wave ?? ""), 10);
  const agentId = normalizeString(rawRecord.agentId || defaults.agentId);
  const status = normalizeString(rawRecord.status || defaults.status || "open").toLowerCase();
  const priority = normalizeString(rawRecord.priority || defaults.priority || "normal").toLowerCase();
  const confidence = normalizeString(rawRecord.confidence || defaults.confidence || "medium").toLowerCase();
  const createdAt = normalizeString(rawRecord.createdAt || defaults.createdAt || now);
  const updatedAt = normalizeString(rawRecord.updatedAt || defaults.updatedAt || createdAt);
  validateEnum(kind, COORDINATION_KIND_VALUES, "Coordination kind");
  validateEnum(status, COORDINATION_STATUS_VALUES, "Coordination status");
  validateEnum(priority, COORDINATION_PRIORITY_VALUES, "Coordination priority");
  validateEnum(confidence, COORDINATION_CONFIDENCE_VALUES, "Coordination confidence");
  if (!lane) {
    throw new Error("Coordination lane is required");
  }
  if (!Number.isFinite(wave) || wave < 0) {
    throw new Error(`Coordination wave must be a non-negative integer (got: ${rawRecord.wave})`);
  }
  if (!agentId) {
    throw new Error("Coordination agentId is required");
  }
  return {
    recordVersion: 1,
    id,
    kind,
    wave,
    lane,
    agentId,
    targets: normalizeStringArray(rawRecord.targets ?? defaults.targets),
    status,
    priority,
    artifactRefs: normalizeStringArray(rawRecord.artifactRefs ?? defaults.artifactRefs),
    dependsOn: normalizeStringArray(rawRecord.dependsOn ?? defaults.dependsOn),
    closureCondition: normalizeString(rawRecord.closureCondition ?? defaults.closureCondition, ""),
    createdAt,
    updatedAt,
    confidence,
    summary: normalizeString(rawRecord.summary ?? defaults.summary),
    detail: normalizeString(rawRecord.detail ?? defaults.detail),
    attempt:
      rawRecord.attempt === null || rawRecord.attempt === undefined || rawRecord.attempt === ""
        ? defaults.attempt ?? null
        : Number.parseInt(String(rawRecord.attempt), 10),
    source: normalizeString(rawRecord.source ?? defaults.source, "launcher"),
    executorId: normalizeString(rawRecord.executorId ?? defaults.executorId, ""),
    requesterLane: normalizeString(rawRecord.requesterLane ?? defaults.requesterLane, ""),
    ownerLane: normalizeString(rawRecord.ownerLane ?? defaults.ownerLane, ""),
    requesterWave:
      rawRecord.requesterWave === null || rawRecord.requesterWave === undefined || rawRecord.requesterWave === ""
        ? defaults.requesterWave ?? null
        : Number.parseInt(String(rawRecord.requesterWave), 10),
    ownerWave:
      rawRecord.ownerWave === null || rawRecord.ownerWave === undefined || rawRecord.ownerWave === ""
        ? defaults.ownerWave ?? null
        : Number.parseInt(String(rawRecord.ownerWave), 10),
    required:
      rawRecord.required === undefined
        ? Boolean(defaults.required)
        : Boolean(rawRecord.required),
  };
}

export function appendCoordinationRecord(filePath, rawRecord, defaults = {}) {
  const record = normalizeCoordinationRecord(rawRecord, defaults);
  ensureDirectory(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export function readCoordinationLog(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const records = [];
  for (const line of lines) {
    const parsed = JSON.parse(line);
    records.push(normalizeCoordinationRecord(parsed));
  }
  return records;
}

function coordinationSort(a, b) {
  const updatedDiff = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }
  return String(a.id).localeCompare(String(b.id));
}

export function materializeCoordinationState(records) {
  const ordered = [...records].sort(coordinationSort);
  const byId = new Map();
  for (const record of ordered) {
    const existing = byId.get(record.id);
    byId.set(record.id, existing ? { ...existing, ...record, id: existing.id, createdAt: existing.createdAt } : record);
  }
  const latestRecords = Array.from(byId.values()).sort(coordinationSort);
  const openRecords = latestRecords.filter((record) => OPEN_COORDINATION_STATUSES.has(record.status));
  const recordsByAgentId = new Map();
  const recordsByTarget = new Map();
  for (const record of latestRecords) {
    const agentList = recordsByAgentId.get(record.agentId) || [];
    agentList.push(record);
    recordsByAgentId.set(record.agentId, agentList);
    for (const target of record.targets || []) {
      const targetList = recordsByTarget.get(target) || [];
      targetList.push(record);
      recordsByTarget.set(target, targetList);
    }
  }
  return {
    records: ordered,
    latestRecords,
    openRecords,
    byId,
    recordsByAgentId,
    recordsByTarget,
    requests: latestRecords.filter((record) => record.kind === "request"),
    blockers: latestRecords.filter((record) => record.kind === "blocker"),
    claims: latestRecords.filter((record) => record.kind === "claim"),
    evidence: latestRecords.filter((record) => record.kind === "evidence"),
    decisions: latestRecords.filter((record) => record.kind === "decision"),
    handoffs: latestRecords.filter((record) => record.kind === "handoff"),
    clarifications: latestRecords.filter((record) => record.kind === "clarification-request"),
    orchestratorGuidance: latestRecords.filter(
      (record) => record.kind === "orchestrator-guidance",
    ),
    resolvedByPolicy: latestRecords.filter((record) => record.kind === "resolved-by-policy"),
    humanEscalations: latestRecords.filter((record) => record.kind === "human-escalation"),
    humanFeedback: latestRecords.filter((record) => record.kind === "human-feedback"),
    integrationSummaries: latestRecords.filter((record) => record.kind === "integration-summary"),
  };
}

export function isOpenCoordinationStatus(status) {
  return OPEN_COORDINATION_STATUSES.has(String(status || "").trim().toLowerCase());
}

export function clarificationClosureCondition(clarificationId) {
  return `${CLARIFICATION_CLOSURE_PREFIX}${String(clarificationId || "").trim()}`;
}

export function clarificationIdFromClosureCondition(value) {
  const normalized = String(value || "").trim();
  if (!normalized.startsWith(CLARIFICATION_CLOSURE_PREFIX)) {
    return null;
  }
  const clarificationId = normalized.slice(CLARIFICATION_CLOSURE_PREFIX.length).trim();
  return clarificationId || null;
}

export function isClarificationLinkedRequest(record, clarificationIds = null) {
  const clarificationIdSet =
    clarificationIds instanceof Set
      ? clarificationIds
      : clarificationIds === null
        ? null
        : new Set(Array.isArray(clarificationIds) ? clarificationIds : []);
  const closureClarificationId = clarificationIdFromClosureCondition(record?.closureCondition);
  if (closureClarificationId) {
    return clarificationIdSet === null
      ? true
      : clarificationIdSet.has(closureClarificationId);
  }
  if (clarificationIdSet === null) {
    return false;
  }
  return Array.isArray(record?.dependsOn)
    ? record.dependsOn.some((dependencyId) => clarificationIdSet.has(String(dependencyId || "").trim()))
    : false;
}

export function clarificationLinkedRequests(state, clarificationId = null) {
  const clarificationIds =
    clarificationId === null
      ? new Set((state?.clarifications || []).map((record) => String(record.id || "").trim()))
      : new Set([String(clarificationId || "").trim()]);
  return (state?.requests || []).filter((record) =>
    isClarificationLinkedRequest(record, clarificationIds),
  );
}

export function openClarificationLinkedRequests(state, clarificationId = null) {
  return clarificationLinkedRequests(state, clarificationId).filter((record) =>
    isOpenCoordinationStatus(record.status),
  );
}

export function readMaterializedCoordinationState(filePath) {
  return materializeCoordinationState(readCoordinationLog(filePath));
}

export function serializeCoordinationState(state) {
  return {
    records: state?.records || [],
    latestRecords: state?.latestRecords || [],
    openRecords: state?.openRecords || [],
    byId: Object.fromEntries(state?.byId?.entries?.() || []),
    recordsByAgentId: Object.fromEntries(
      Array.from(state?.recordsByAgentId?.entries?.() || []).map(([agentId, records]) => [
        agentId,
        records,
      ]),
    ),
    recordsByTarget: Object.fromEntries(
      Array.from(state?.recordsByTarget?.entries?.() || []).map(([target, records]) => [
        target,
        records,
      ]),
    ),
    requests: state?.requests || [],
    blockers: state?.blockers || [],
    claims: state?.claims || [],
    evidence: state?.evidence || [],
    decisions: state?.decisions || [],
    handoffs: state?.handoffs || [],
    clarifications: state?.clarifications || [],
    orchestratorGuidance: state?.orchestratorGuidance || [],
    resolvedByPolicy: state?.resolvedByPolicy || [],
    humanEscalations: state?.humanEscalations || [],
    humanFeedback: state?.humanFeedback || [],
    integrationSummaries: state?.integrationSummaries || [],
  };
}

function renderOpenRecord(record) {
  const targets = record.targets.length > 0 ? ` -> ${record.targets.join(", ")}` : "";
  const artifacts =
    record.artifactRefs.length > 0 ? ` [artifacts: ${record.artifactRefs.join(", ")}]` : "";
  return `- [${record.priority}] ${record.kind}/${record.status} ${record.agentId}${targets}: ${compactSingleLine(record.summary || record.detail || "no summary", 160)}${artifacts}`;
}

function renderActivityRecord(record) {
  const targets = record.targets.length > 0 ? ` -> ${record.targets.join(", ")}` : "";
  const summary = compactSingleLine(record.summary || record.detail || "no summary", 180);
  return `- ${record.updatedAt} | ${record.agentId} | ${record.kind}/${record.status}${targets} | ${summary}`;
}

function renderIntegrationItems(title, items, options = {}) {
  const normalized = Array.isArray(items)
    ? items.map((item) => compactSingleLine(item, options.maxChars || 180)).filter(Boolean)
    : [];
  const visible = normalized.slice(0, options.maxItems || 4);
  return [
    title,
    ...(visible.length > 0 ? visible.map((item) => `- ${item}`) : ["- None."]),
    ...(normalized.length > visible.length
      ? [`- ... ${normalized.length - visible.length} more item(s)`]
      : []),
  ];
}

export function renderCoordinationBoardProjection({
  wave,
  waveFile,
  agents,
  state,
  capabilityAssignments = [],
  dependencySnapshot = null,
}) {
  const latestRecords = Array.isArray(state?.latestRecords) ? state.latestRecords : [];
  const openRecords = latestRecords.filter((record) => OPEN_COORDINATION_STATUSES.has(record.status));
  const activityRecords = [...latestRecords].sort(coordinationSort);
  const openAssignments = (capabilityAssignments || []).filter((assignment) => assignment.blocking);
  const openInboundDependencies = dependencySnapshot?.openInbound || [];
  const openOutboundDependencies = dependencySnapshot?.openOutbound || [];
  return [
    `# Wave ${wave} Message Board`,
    "",
    `- Wave file: \`${waveFile}\``,
    `- Agents: ${(agents || []).map((agent) => agent.agentId).join(", ")}`,
    `- Generated: ${toIsoTimestamp()}`,
    "",
    "## Open Coordination State",
    ...(openRecords.length > 0
      ? openRecords.map((record) => renderOpenRecord(record))
      : ["- None."]),
    "",
    "## Helper Assignments",
    ...(openAssignments.length > 0
      ? openAssignments.map(
          (assignment) =>
            `- [${assignment.priority || "normal"}] ${assignment.requestId} -> ${assignment.target}${assignment.assignedAgentId ? ` => ${assignment.assignedAgentId}` : " => unresolved"} (${assignment.assignmentReason || "n/a"})`,
        )
      : ["- None."]),
    "",
    "## Cross-Lane Dependencies",
    ...(openInboundDependencies.length + openOutboundDependencies.length > 0
      ? [
          ...openInboundDependencies.map(
            (record) =>
              `- [inbound${record.required ? ", required" : ""}] ${record.id}: ${compactSingleLine(record.summary || record.detail || "dependency", 160)}${record.assignedAgentId ? ` -> ${record.assignedAgentId}` : ""}`,
          ),
          ...openOutboundDependencies.map(
            (record) =>
              `- [outbound${record.required ? ", required" : ""}] ${record.id}: ${compactSingleLine(record.summary || record.detail || "dependency", 160)}`,
          ),
        ]
      : ["- None."]),
    "",
    "## Activity Feed",
    ...(activityRecords.length > 0
      ? activityRecords.map((record) => renderActivityRecord(record))
      : ["- No activity yet."]),
    "",
  ].join("\n");
}

function isTargetedToAgent(record, agent) {
  const targets = Array.isArray(record.targets) ? record.targets : [];
  if (targets.length === 0) {
    return false;
  }
  const agentTargets = new Set([agent.agentId, `agent:${agent.agentId}`]);
  for (const target of targets) {
    if (agentTargets.has(target)) {
      return true;
    }
    if (String(target).startsWith("capability:")) {
      const capability = String(target).slice("capability:".length);
      if (Array.isArray(agent.capabilities) && agent.capabilities.includes(capability)) {
        return true;
      }
    }
  }
  return false;
}

function normalizeOwnedReference(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function matchesOwnedPathArtifact(artifactRef, ownedPath) {
  const normalizedArtifact = normalizeOwnedReference(artifactRef);
  const normalizedOwnedPath = normalizeOwnedReference(ownedPath);
  if (!normalizedArtifact || !normalizedOwnedPath) {
    return false;
  }
  return (
    normalizedArtifact === normalizedOwnedPath ||
    normalizedArtifact.startsWith(`${normalizedOwnedPath}/`)
  );
}

function isArtifactRelevantToAgent(record, agent) {
  const artifactRefs = Array.isArray(record?.artifactRefs) ? record.artifactRefs : [];
  if (artifactRefs.length === 0) {
    return false;
  }
  const ownedPaths = Array.isArray(agent?.ownedPaths) ? agent.ownedPaths : [];
  const ownedComponents = Array.isArray(agent?.components) ? agent.components : [];
  return artifactRefs.some((artifactRef) => {
    const normalizedArtifact = normalizeOwnedReference(artifactRef);
    if (!normalizedArtifact) {
      return false;
    }
    if (ownedComponents.some((componentId) => normalizedArtifact === String(componentId || "").trim())) {
      return true;
    }
    return ownedPaths.some((ownedPath) => matchesOwnedPathArtifact(normalizedArtifact, ownedPath));
  });
}

export function compileSharedSummary({
  wave,
  state,
  ledger = null,
  integrationSummary = null,
  capabilityAssignments = [],
  dependencySnapshot = null,
  maxChars = 4000,
}) {
  const openBlockers = state.blockers.filter((record) => OPEN_COORDINATION_STATUSES.has(record.status));
  const openRequests = state.requests.filter((record) => OPEN_COORDINATION_STATUSES.has(record.status));
  const openClarifications = state.clarifications.filter((record) =>
    OPEN_COORDINATION_STATUSES.has(record.status),
  );
  const openHumanEscalations = state.humanEscalations.filter((record) =>
    OPEN_COORDINATION_STATUSES.has(record.status),
  );
  const openHelperAssignments = (capabilityAssignments || []).filter((assignment) => assignment.blocking);
  const openInboundDependencies = dependencySnapshot?.openInbound || [];
  const openOutboundDependencies = dependencySnapshot?.openOutbound || [];
  const summary = [
    `# Wave ${wave.wave} Shared Summary`,
    "",
    `- Open requests: ${openRequests.length}`,
    `- Open blockers: ${openBlockers.length}`,
    `- Open clarifications: ${openClarifications.length}`,
    `- Open human escalations: ${openHumanEscalations.length}`,
    `- Open coordination items: ${state.openRecords.length}`,
    `- Open helper assignments: ${openHelperAssignments.length}`,
    `- Open inbound dependencies: ${openInboundDependencies.length}`,
    `- Open outbound dependencies: ${openOutboundDependencies.length}`,
    ...(integrationSummary
      ? [`- Integration recommendation: ${integrationSummary.recommendation || "n/a"}`]
      : []),
    ...(integrationSummary
      ? [
          `- Integration conflicts: ${(integrationSummary.conflictingClaims || []).length}`,
          `- Integration proof gaps: ${(integrationSummary.proofGaps || []).length}`,
          `- Integration deploy risks: ${(integrationSummary.deployRisks || []).length}`,
          `- Integration doc gaps: ${(integrationSummary.docGaps || []).length}`,
          `- Security review: ${integrationSummary.securityState || "not-applicable"}`,
          `- Security findings: ${(integrationSummary.securityFindings || []).length}`,
          `- Security approvals: ${(integrationSummary.securityApprovals || []).length}`,
        ]
      : []),
    ...(ledger ? [`- Ledger phase: ${ledger.phase || "n/a"}`] : []),
    "",
    "## Current blockers",
    ...(openBlockers.length > 0
      ? openBlockers.map((record) => renderOpenRecord(record))
      : ["- None."]),
    "",
    "## Current clarifications",
    ...(openClarifications.length > 0
      ? openClarifications.map((record) => renderOpenRecord(record))
      : ["- None."]),
    "",
    "## Helper assignments",
    ...(openHelperAssignments.length > 0
      ? openHelperAssignments.map(
          (assignment) =>
            `- ${assignment.requestId}: ${assignment.target}${assignment.assignedAgentId ? ` -> ${assignment.assignedAgentId}` : " -> unresolved"} (${assignment.assignmentReason || "n/a"})`,
        )
      : ["- None."]),
    "",
    "## Cross-lane dependencies",
    ...(openInboundDependencies.length + openOutboundDependencies.length > 0
      ? [
          ...openInboundDependencies.map(
            (item) =>
              `- inbound${item.required ? " required" : ""}: ${compactSingleLine(item.summary || item.detail || item.id, 160)}${item.assignedAgentId ? ` -> ${item.assignedAgentId}` : ""}`,
          ),
          ...openOutboundDependencies.map(
            (item) =>
              `- outbound${item.required ? " required" : ""}: ${compactSingleLine(item.summary || item.detail || item.id, 160)}`,
          ),
        ]
      : ["- None."]),
    "",
    "## Current decisions",
    ...(state.decisions.length > 0
      ? state.decisions.slice(-5).map((record) => renderActivityRecord(record))
      : ["- None."]),
    ...(integrationSummary
      ? [
          "",
          ...renderIntegrationItems("## Integration conflicts", integrationSummary.conflictingClaims),
          "",
          ...renderIntegrationItems("## Changed interfaces", integrationSummary.changedInterfaces),
          "",
          ...renderIntegrationItems(
            "## Cross-component impacts",
            integrationSummary.crossComponentImpacts,
          ),
          "",
          ...renderIntegrationItems("## Proof gaps", integrationSummary.proofGaps),
          "",
          ...renderIntegrationItems("## Deploy risks", integrationSummary.deployRisks),
          "",
          ...renderIntegrationItems("## Security findings", integrationSummary.securityFindings),
          "",
          ...renderIntegrationItems("## Security approvals", integrationSummary.securityApprovals),
          "",
          ...renderIntegrationItems("## Documentation gaps", integrationSummary.docGaps),
        ]
      : []),
    ...(Array.isArray(integrationSummary?.runtimeAssignments) &&
    integrationSummary.runtimeAssignments.length > 0
      ? [
          "",
          "## Runtime assignments",
          ...integrationSummary.runtimeAssignments.map(
            (assignment) =>
              `- ${assignment.agentId}: ${assignment.executorId || "n/a"} (${assignment.role || "n/a"})${assignment.profile ? ` profile=${assignment.profile}` : ""}${assignment.fallbackUsed ? " fallback-used" : ""}`,
          ),
        ]
      : []),
    "",
  ].join("\n");
  if (summary.length <= maxChars) {
    return { text: summary, truncated: false };
  }
  const suffix = "\n\n[Shared summary truncated; see generated artifact for full details]";
  return {
    text: `${summary.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`,
    truncated: true,
  };
}

export function compileAgentInbox({
  wave,
  agent,
  state,
  ledger = null,
  docsQueue = null,
  integrationSummary = null,
  capabilityAssignments = [],
  dependencySnapshot = null,
  maxChars = 8000,
}) {
  const targetedRecords = state.openRecords.filter((record) => isTargetedToAgent(record, agent));
  const ownedRecords = (state.recordsByAgentId.get(agent.agentId) || []).filter((record) =>
    OPEN_COORDINATION_STATUSES.has(record.status),
  );
  const clarificationRecords = state.clarifications.filter((record) =>
    OPEN_COORDINATION_STATUSES.has(record.status) &&
    (record.agentId === agent.agentId || isTargetedToAgent(record, agent)),
  );
  const excludedRecordIds = new Set([
    ...targetedRecords.map((record) => record.id),
    ...ownedRecords.map((record) => record.id),
    ...clarificationRecords.map((record) => record.id),
  ]);
  const relevantRecords = state.openRecords.filter(
    (record) =>
      !excludedRecordIds.has(record.id) &&
      record.kind !== "clarification-request" &&
      isArtifactRelevantToAgent(record, agent),
  );
  const docsItems =
    Array.isArray(docsQueue?.items) && docsQueue.items.length > 0
      ? docsQueue.items.filter(
          (item) =>
            item.ownerAgentId === agent.agentId ||
            item.agentId === agent.agentId ||
            (Array.isArray(item.targets) && item.targets.includes(agent.agentId)),
        )
      : [];
  const ledgerTasks =
    Array.isArray(ledger?.tasks) && ledger.tasks.length > 0
      ? ledger.tasks.filter((task) => task.owner === agent.agentId)
      : [];
  const helperAssignments = (capabilityAssignments || []).filter(
    (assignment) => assignment.blocking && assignment.assignedAgentId === agent.agentId,
  );
  const dependencyItems = [
    ...((dependencySnapshot?.inbound || []).filter(
      (record) =>
        isOpenCoordinationStatus(record.status) &&
        (record.assignedAgentId === agent.agentId ||
          isArtifactRelevantToAgent(record, agent) ||
          isTargetedToAgent(record, agent)),
    )),
    ...((dependencySnapshot?.outbound || []).filter(
      (record) =>
        isOpenCoordinationStatus(record.status) &&
        (isArtifactRelevantToAgent(record, agent) || isTargetedToAgent(record, agent)),
    )),
  ];
  const text = [
    `# Wave ${wave.wave} Inbox for ${agent.agentId}`,
    "",
    "## Targeted open coordination",
    ...(targetedRecords.length > 0
      ? targetedRecords.map((record) => renderOpenRecord(record))
      : ["- None."]),
    "",
    "## Your open coordination items",
    ...(ownedRecords.length > 0
      ? ownedRecords.map((record) => renderOpenRecord(record))
      : ["- None."]),
    "",
    "## Clarifications",
    ...(clarificationRecords.length > 0
      ? clarificationRecords.map((record) => renderOpenRecord(record))
      : ["- None."]),
    "",
    "## Relevant open coordination",
    ...(relevantRecords.length > 0
      ? relevantRecords.map((record) => renderOpenRecord(record))
      : ["- None."]),
    "",
    "## Helper assignments",
    ...(helperAssignments.length > 0
      ? helperAssignments.map(
          (assignment) =>
            `- [${assignment.priority || "normal"}] ${compactSingleLine(assignment.summary || assignment.requestId, 140)} (${assignment.target}${assignment.assignmentReason ? `; ${assignment.assignmentReason}` : ""})`,
        )
      : ["- None."]),
    "",
    "## Cross-lane dependencies",
    ...(dependencyItems.length > 0
      ? dependencyItems.map(
          (record) =>
            `- [${record.priority || "normal"}] ${record.direction || "dependency"}${record.required ? " required" : ""}: ${compactSingleLine(record.summary || record.detail || record.id, 140)}${record.assignedAgentId ? ` -> ${record.assignedAgentId}` : ""}`,
        )
      : ["- None."]),
    "",
    "## Ledger tasks",
    ...(ledgerTasks.length > 0
      ? ledgerTasks.map(
          (task) =>
            `- [${task.priority || "normal"}] ${task.id}: ${compactSingleLine(task.title || task.kind || "task", 140)} (${task.state || "unknown"})`,
        )
      : ["- None."]),
    "",
    "## Documentation obligations",
    ...(docsItems.length > 0
      ? docsItems.map(
          (item) =>
            `- ${item.kind || "doc"}: ${compactSingleLine(item.summary || item.path || item.detail || "update required", 140)}`,
        )
      : ["- None."]),
    ...(integrationSummary
      ? [
          "",
          "## Integration note",
          `- Recommendation: ${integrationSummary.recommendation || "n/a"}`,
          `- Detail: ${compactSingleLine(integrationSummary.detail || "n/a", 180)}`,
          `- Conflicts: ${(integrationSummary.conflictingClaims || []).length}`,
          `- Proof gaps: ${(integrationSummary.proofGaps || []).length}`,
          `- Deploy risks: ${(integrationSummary.deployRisks || []).length}`,
          `- Documentation gaps: ${(integrationSummary.docGaps || []).length}`,
          `- Security review: ${integrationSummary.securityState || "not-applicable"}`,
          `- Security findings: ${(integrationSummary.securityFindings || []).length}`,
          `- Security approvals: ${(integrationSummary.securityApprovals || []).length}`,
          ...renderIntegrationItems(
            "- Changed interfaces",
            integrationSummary.changedInterfaces,
            { maxItems: 3 },
          ),
          ...renderIntegrationItems(
            "- Cross-component impacts",
            integrationSummary.crossComponentImpacts,
            { maxItems: 3 },
          ),
          ...renderIntegrationItems("- Proof gaps", integrationSummary.proofGaps, {
            maxItems: 3,
          }),
          ...renderIntegrationItems("- Deploy risks", integrationSummary.deployRisks, {
            maxItems: 3,
          }),
          ...renderIntegrationItems("- Security findings", integrationSummary.securityFindings, {
            maxItems: 3,
          }),
          ...renderIntegrationItems("- Security approvals", integrationSummary.securityApprovals, {
            maxItems: 3,
          }),
          ...renderIntegrationItems("- Documentation gaps", integrationSummary.docGaps, {
            maxItems: 3,
          }),
          ...(Array.isArray(integrationSummary.runtimeAssignments) &&
          integrationSummary.runtimeAssignments.length > 0
            ? [
                "- Runtime assignments:",
                ...integrationSummary.runtimeAssignments.map(
                  (assignment) =>
                    `  ${assignment.agentId}: ${assignment.executorId || "n/a"} (${assignment.role || "n/a"})`,
                ),
              ]
            : []),
        ]
      : []),
    "",
  ].join("\n");
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const suffix = "\n\n[Inbox truncated; see generated artifact for full details]";
  return {
    text: `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`,
    truncated: true,
  };
}

export function writeCoordinationBoardProjection(filePath, params) {
  writeTextAtomic(filePath, `${renderCoordinationBoardProjection(params)}\n`);
}

export function writeCompiledInbox(filePath, payload) {
  writeTextAtomic(filePath, `${String(payload || "")}\n`);
}

function baseRecord({
  id,
  kind,
  lane,
  wave,
  agentId,
  targets = [],
  priority = "normal",
  summary,
  detail = "",
  artifactRefs = [],
  status = "open",
}) {
  return normalizeCoordinationRecord({
    id,
    kind,
    lane,
    wave,
    agentId,
    targets,
    priority,
    summary,
    detail,
    artifactRefs,
    status,
    confidence: "medium",
    source: "launcher",
  });
}

export function buildSeedCoordinationRecords({
  lane,
  wave,
  agents,
  componentPromotions = [],
  sharedPlanDocs = [],
  contQaAgentId = "A0",
  contEvalAgentId = "E0",
  integrationAgentId = "A8",
  documentationAgentId = "A9",
  feedbackRequests = [],
}) {
  const records = [];
  for (const agent of agents) {
    const targets =
      agent.agentId === contQaAgentId ||
      agent.agentId === contEvalAgentId ||
      agent.agentId === documentationAgentId ||
      agent.agentId === integrationAgentId
        ? []
        : [`agent:${agent.agentId}`];
    records.push(
      baseRecord({
        id: `wave-${wave}-agent-${agent.agentId}-request`,
        kind: "request",
        lane,
        wave,
        agentId: "launcher",
        targets,
        priority:
          agent.agentId === contQaAgentId ||
          agent.agentId === contEvalAgentId ||
          agent.agentId === documentationAgentId
            ? "high"
            : "normal",
        summary: `Wave ${wave} assigned to ${agent.agentId}: ${agent.title}`,
        detail: agent.promptOverlay || agent.prompt || agent.title,
        artifactRefs: agent.ownedPaths || [],
      }),
    );
  }
  for (const promotion of componentPromotions) {
    records.push(
      baseRecord({
        id: `wave-${wave}-component-${promotion.componentId}`,
        kind: "decision",
        lane,
        wave,
        agentId: "launcher",
        summary: `Promote ${promotion.componentId} to ${promotion.targetLevel}`,
        detail: `Wave ${wave} requires component ${promotion.componentId} at ${promotion.targetLevel}.`,
        artifactRefs: [promotion.componentId],
        priority: "high",
        status: "in_progress",
      }),
    );
  }
  if (sharedPlanDocs.length > 0) {
    records.push(
      baseRecord({
        id: `wave-${wave}-shared-plan-docs`,
        kind: "request",
        lane,
        wave,
        agentId: "launcher",
        targets: [`agent:${documentationAgentId}`],
        priority: "high",
        summary: `Reconcile shared-plan documentation for wave ${wave}`,
        detail: `Documentation steward must reconcile ${sharedPlanDocs.join(", ")}`,
        artifactRefs: sharedPlanDocs,
      }),
    );
  }
  if (agents.some((agent) => agent.agentId === integrationAgentId)) {
    records.push(
      baseRecord({
        id: `wave-${wave}-integration-summary`,
        kind: "integration-summary",
        lane,
        wave,
        agentId: "launcher",
        targets: [`agent:${integrationAgentId}`],
        priority: "high",
        summary: `Synthesize wave ${wave} before documentation and cont-QA closure`,
        detail: "Integration steward must reconcile open claims, blockers, interfaces, and release risk.",
      }),
    );
  }
  for (const request of feedbackRequests) {
    records.push(
      baseRecord({
        id: request.id,
        kind: "human-feedback",
        lane,
        wave,
        agentId: request.agentId || "human",
        targets: request.agentId ? [`agent:${request.agentId}`] : [],
        priority: "high",
        summary: request.question || "Human feedback requested",
        detail: request.context || "",
        status: request.status === "answered" ? "resolved" : "open",
      }),
    );
  }
  return records;
}

export function updateSeedRecords(filePath, params) {
  const existing = readCoordinationLog(filePath);
  const latestById = materializeCoordinationState(existing).byId;
  const seed = buildSeedCoordinationRecords(params);
  const comparableKeys = [
    "kind",
    "wave",
    "lane",
    "agentId",
    "targets",
    "status",
    "priority",
    "artifactRefs",
    "dependsOn",
    "closureCondition",
    "confidence",
    "summary",
    "detail",
    "attempt",
    "source",
    "executorId",
    "requesterLane",
    "ownerLane",
    "requesterWave",
    "ownerWave",
    "required",
  ];
  for (const record of seed) {
    const existingRecord = latestById.get(record.id);
    const unchanged =
      existingRecord &&
      comparableKeys.every((key) => JSON.stringify(existingRecord[key]) === JSON.stringify(record[key]));
    if (!unchanged) {
      appendCoordinationRecord(filePath, record, {
        createdAt: existingRecord?.createdAt || record.createdAt,
      });
    }
  }
  return readCoordinationLog(filePath);
}

export function deriveIntegrationSummaryFromState({
  lane,
  wave,
  state,
  attempt = null,
}) {
  const openClaims = state.claims.filter((record) => OPEN_COORDINATION_STATUSES.has(record.status));
  const unresolvedBlockers = state.blockers.filter((record) =>
    OPEN_COORDINATION_STATUSES.has(record.status),
  );
  const conflictingClaims = openClaims.filter((record) =>
    /conflict|contradict/i.test(record.detail || record.summary || ""),
  );
  const changedInterfaces = (state.latestRecords || [])
    .filter(
      (record) =>
        !["cancelled", "superseded"].includes(String(record?.status || "").trim().toLowerCase()) &&
        /interface|contract|api|schema|migration|signature/i.test(
          [record.summary, record.detail, ...(record.artifactRefs || [])].join("\n"),
        ),
    )
    .map((record) => summarizeIntegrationRecord(record));
  return {
    wave,
    lane,
    agentId: "launcher",
    attempt,
    openClaims: openClaims.map((record) => summarizeIntegrationRecord(record)),
    conflictingClaims: conflictingClaims.map((record) => summarizeIntegrationRecord(record)),
    unresolvedBlockers: unresolvedBlockers.map((record) => summarizeIntegrationRecord(record)),
    changedInterfaces,
    crossComponentImpacts: [],
    proofGaps: [],
    docGaps: [],
    deployRisks: [],
    recommendation:
      unresolvedBlockers.length > 0 || conflictingClaims.length > 0
        ? "needs-more-work"
        : "ready-for-doc-closure",
    detail:
      unresolvedBlockers.length > 0
        ? `${unresolvedBlockers.length} unresolved blocker(s) remain.`
        : conflictingClaims.length > 0
          ? `${conflictingClaims.length} conflicting claim(s) remain.`
          : "No unresolved blockers or conflicting claims remain in coordination state.",
    createdAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
  };
}

export function readDependencyTickets(dirPath, lane) {
  const filePath = path.join(dirPath, `${lane}.jsonl`);
  return readCoordinationLog(filePath);
}

export function appendDependencyTicket(dirPath, lane, record) {
  const filePath = path.join(dirPath, `${lane}.jsonl`);
  return appendCoordinationRecord(filePath, record);
}

export function writeJsonArtifact(filePath, payload) {
  writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function readJsonArtifact(filePath) {
  return readJsonOrNull(filePath);
}
