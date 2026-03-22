import fs from "node:fs";
import path from "node:path";
import {
  appendCoordinationRecord,
  isOpenCoordinationStatus,
  materializeCoordinationState,
  readCoordinationLog,
} from "./coordination-store.mjs";
import { compactSingleLine, toIsoTimestamp, writeTextAtomic } from "./shared.mjs";

function normalizeCapability(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function targetSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function openTaskCountForAgent(ledger, agentId) {
  return (ledger?.tasks || []).filter(
    (task) => task.owner === agentId && !["done", "closed", "resolved"].includes(task.state),
  ).length;
}

function resolveTargetAssignment(target, agents, ledger, capabilityRouting = {}) {
  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget) {
    return {
      assignedAgentId: null,
      target: normalizedTarget,
      targetType: "unknown",
      capability: null,
      assignmentReason: "empty-target",
      blocking: true,
      detail: "Request target was empty.",
    };
  }

  const agentsById = new Map((agents || []).map((agent) => [agent.agentId, agent]));
  if (normalizedTarget.startsWith("agent:")) {
    const agentId = normalizedTarget.slice("agent:".length).trim();
    return {
      assignedAgentId: agentsById.has(agentId) ? agentId : null,
      target: normalizedTarget,
      targetType: "agent",
      capability: null,
      assignmentReason: agentsById.has(agentId) ? "explicit-agent" : "missing-agent",
      blocking: true,
      detail: agentsById.has(agentId)
        ? `Assigned explicitly to ${agentId}.`
        : `No matching agent exists for ${normalizedTarget}.`,
    };
  }
  if (agentsById.has(normalizedTarget)) {
    return {
      assignedAgentId: normalizedTarget,
      target: normalizedTarget,
      targetType: "agent",
      capability: null,
      assignmentReason: "exact-agent-id",
      blocking: true,
      detail: `Assigned directly to ${normalizedTarget}.`,
    };
  }
  if (normalizedTarget.startsWith("capability:")) {
    const capability = normalizeCapability(normalizedTarget.slice("capability:".length));
    const preferredAgents = capabilityRouting?.preferredAgents?.[capability] || [];
    for (const preferredAgentId of preferredAgents) {
      const preferredAgent = agentsById.get(preferredAgentId);
      if (
        preferredAgent &&
        Array.isArray(preferredAgent.capabilities) &&
        preferredAgent.capabilities.includes(capability)
      ) {
        return {
          assignedAgentId: preferredAgentId,
          target: normalizedTarget,
          targetType: "capability",
          capability,
          assignmentReason: "preferred-agent",
          blocking: true,
          detail: `Capability ${capability} routed to preferred agent ${preferredAgentId}.`,
        };
      }
    }
    const candidates = (agents || []).filter(
      (agent) => Array.isArray(agent.capabilities) && agent.capabilities.includes(capability),
    );
    candidates.sort((left, right) => {
      const taskDiff = openTaskCountForAgent(ledger, left.agentId) - openTaskCountForAgent(ledger, right.agentId);
      if (taskDiff !== 0) {
        return taskDiff;
      }
      return String(left.agentId).localeCompare(String(right.agentId));
    });
    if (candidates[0]) {
      return {
        assignedAgentId: candidates[0].agentId,
        target: normalizedTarget,
        targetType: "capability",
        capability,
        assignmentReason: "least-busy-capability",
        blocking: true,
        detail: `Capability ${capability} routed to ${candidates[0].agentId}.`,
      };
    }
    return {
      assignedAgentId: null,
      target: normalizedTarget,
      targetType: "capability",
      capability,
      assignmentReason: "missing-capability-owner",
      blocking: true,
      detail: `No agent advertises capability ${capability}.`,
    };
  }
  return {
    assignedAgentId: null,
    target: normalizedTarget,
    targetType: "unknown",
    capability: null,
    assignmentReason: "unsupported-target",
    blocking: true,
    detail: `Unsupported assignment target ${normalizedTarget}.`,
  };
}

function isLauncherSeedRequest(record) {
  return (
    record?.source === "launcher" &&
    /^wave-\d+-agent-[^-]+-request$/.test(String(record.id || "")) &&
    !String(record.closureCondition || "").trim() &&
    (!Array.isArray(record.dependsOn) || record.dependsOn.length === 0)
  );
}

function assignmentStateForRecord(record) {
  const status = String(record?.status || "").trim().toLowerCase();
  if (["resolved", "closed", "superseded", "cancelled"].includes(status)) {
    return "resolved";
  }
  if (status === "in_progress") {
    return "in_progress";
  }
  if (status === "acknowledged") {
    return "acknowledged";
  }
  return "open";
}

export function buildRequestAssignments({
  coordinationState,
  agents,
  ledger = null,
  capabilityRouting = {},
}) {
  const assignments = [];
  for (const record of coordinationState?.requests || []) {
    if (isLauncherSeedRequest(record)) {
      continue;
    }
    if (
      record?.source === "launcher" &&
      (!Array.isArray(record.dependsOn) || record.dependsOn.length === 0) &&
      !String(record.closureCondition || "").trim()
    ) {
      continue;
    }
    const targets = Array.isArray(record.targets) ? record.targets : [];
    if (targets.length === 0) {
      continue;
    }
    for (const target of targets) {
      const resolution = resolveTargetAssignment(target, agents, ledger, capabilityRouting);
      assignments.push({
        id: `assignment:${record.id}:${targetSlug(target) || "target"}`,
        requestId: record.id,
        recordId: record.id,
        sourceKind: record.kind,
        sourceAgentId: record.agentId,
        summary: record.summary || "",
        detail: record.detail || "",
        priority: record.priority || "normal",
        requestStatus: record.status,
        state: assignmentStateForRecord(record),
        target: resolution.target,
        targetType: resolution.targetType,
        capability: resolution.capability,
        assignedAgentId: resolution.assignedAgentId,
        assignmentReason: resolution.assignmentReason,
        assignmentDetail: resolution.detail,
        blocking: isOpenCoordinationStatus(record.status),
        artifactRefs: Array.isArray(record.artifactRefs) ? record.artifactRefs : [],
        dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn : [],
        closureCondition: String(record.closureCondition || ""),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }
  }
  return assignments;
}

function comparableRecordValue(record, key) {
  return JSON.stringify(record?.[key]);
}

export function syncAssignmentRecords(filePath, { lane, wave, assignments }) {
  const existing = readCoordinationLog(filePath);
  const latestById = materializeCoordinationState(existing).byId;
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
  for (const assignment of assignments || []) {
    const status =
      assignment.state === "resolved"
        ? "resolved"
        : assignment.assignedAgentId
          ? assignment.state === "in_progress"
            ? "in_progress"
            : assignment.state === "acknowledged"
              ? "acknowledged"
              : "open"
          : "open";
    const record = {
      id: assignment.id,
      kind: "decision",
      lane,
      wave,
      agentId: "launcher",
      targets: assignment.assignedAgentId ? [`agent:${assignment.assignedAgentId}`] : [],
      status,
      priority: assignment.priority || "normal",
      artifactRefs: assignment.artifactRefs || [],
      dependsOn: [assignment.requestId, ...(assignment.dependsOn || [])],
      closureCondition: "",
      confidence: assignment.assignedAgentId ? "high" : "medium",
      summary: assignment.assignedAgentId
        ? `Assignment for ${assignment.requestId}: ${assignment.assignedAgentId}`
        : `Assignment unresolved for ${assignment.requestId}`,
      detail: compactSingleLine(
        `target=${assignment.target || "n/a"}; reason=${assignment.assignmentReason || "n/a"}; ${assignment.assignmentDetail || assignment.detail || "No detail."}`,
        240,
      ),
      source: "launcher",
    };
    const existingRecord = latestById.get(record.id);
    const unchanged =
      existingRecord &&
      comparableKeys.every((key) => comparableRecordValue(existingRecord, key) === comparableRecordValue(record, key));
    if (!unchanged) {
      appendCoordinationRecord(filePath, record, {
        createdAt: existingRecord?.createdAt || toIsoTimestamp(),
      });
    }
  }
}

export function readAllDependencyTickets(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .flatMap((entry) => readCoordinationLog(path.join(dirPath, entry.name)));
}

export function isRequiredDependencyTicket(record) {
  return record?.required === true || String(record?.closureCondition || "").includes("required=true");
}

function isDependencyRelevantToWave(recordWave, waveNumber) {
  return recordWave === null || recordWave === undefined || Number(recordWave) === Number(waveNumber);
}

function buildDependencyAssignment(record, agents, ledger, capabilityRouting) {
  const targets = Array.isArray(record.targets) ? record.targets : [];
  const resolutions = targets.map((target) =>
    resolveTargetAssignment(target, agents, ledger, capabilityRouting),
  );
  const resolved = resolutions.find((item) => item.assignedAgentId);
  return {
    assignedAgentId: resolved?.assignedAgentId || null,
    assignmentReason: resolved?.assignmentReason || (targets.length === 0 ? "untargeted" : "unresolved-target"),
    assignmentDetail:
      resolved?.detail ||
      (targets.length === 0
        ? "Dependency ticket is not targeted to a local agent or capability."
        : resolutions.map((item) => item.detail).join(" ")),
  };
}

function summarizeDependency(record, direction, assignment) {
  return {
    id: record.id,
    direction,
    lane: record.lane,
    requesterLane: record.requesterLane || "",
    ownerLane: record.ownerLane || "",
    requesterWave: record.requesterWave ?? null,
    ownerWave: record.ownerWave ?? null,
    required: isRequiredDependencyTicket(record),
    status: record.status,
    summary: record.summary || "",
    detail: record.detail || "",
    priority: record.priority || "normal",
    targets: Array.isArray(record.targets) ? record.targets : [],
    artifactRefs: Array.isArray(record.artifactRefs) ? record.artifactRefs : [],
    assignedAgentId: assignment?.assignedAgentId || null,
    assignmentReason: assignment?.assignmentReason || null,
    assignmentDetail: assignment?.assignmentDetail || "",
    blocking:
      isRequiredDependencyTicket(record) &&
      isOpenCoordinationStatus(record.status),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function buildDependencySnapshot({
  dirPath,
  lane,
  waveNumber,
  agents = [],
  ledger = null,
  capabilityRouting = {},
}) {
  const allTickets = readAllDependencyTickets(dirPath);
  const inbound = [];
  const outbound = [];
  for (const record of allTickets) {
    if (
      String(record.ownerLane || record.lane || "").trim() === String(lane).trim() &&
      isDependencyRelevantToWave(record.ownerWave, waveNumber)
    ) {
      inbound.push(
        summarizeDependency(
          record,
          "inbound",
          buildDependencyAssignment(record, agents, ledger, capabilityRouting),
        ),
      );
    }
    if (
      String(record.requesterLane || "").trim() === String(lane).trim() &&
      isDependencyRelevantToWave(record.requesterWave, waveNumber)
    ) {
      outbound.push(summarizeDependency(record, "outbound", null));
    }
  }
  const openInbound = inbound.filter((record) => isOpenCoordinationStatus(record.status));
  const openOutbound = outbound.filter((record) => isOpenCoordinationStatus(record.status));
  const requiredInbound = openInbound.filter((record) => record.required);
  const requiredOutbound = openOutbound.filter((record) => record.required);
  return {
    lane,
    wave: waveNumber,
    generatedAt: toIsoTimestamp(),
    inbound,
    outbound,
    openInbound,
    openOutbound,
    requiredInbound,
    requiredOutbound,
    unresolvedInboundAssignments: requiredInbound.filter((record) => !record.assignedAgentId),
  };
}

export function renderDependencySnapshotMarkdown(snapshot) {
  const renderEntries = (items) =>
    items.length > 0
      ? items.map(
          (item) =>
            `- [${item.priority}] ${item.id} ${item.status}${item.required ? " required" : ""}: ${compactSingleLine(item.summary || item.detail || "dependency", 160)}${item.assignedAgentId ? ` -> ${item.assignedAgentId}` : ""}`,
        )
      : ["- None."];
  return [
    `# Lane ${snapshot?.lane || "unknown"} Dependency Snapshot`,
    "",
    `- Wave: ${snapshot?.wave ?? "n/a"}`,
    `- Generated: ${snapshot?.generatedAt || toIsoTimestamp()}`,
    `- Open inbound: ${(snapshot?.openInbound || []).length}`,
    `- Open outbound: ${(snapshot?.openOutbound || []).length}`,
    `- Required inbound: ${(snapshot?.requiredInbound || []).length}`,
    `- Required outbound: ${(snapshot?.requiredOutbound || []).length}`,
    "",
    "## Inbound",
    ...renderEntries(snapshot?.inbound || []),
    "",
    "## Outbound",
    ...renderEntries(snapshot?.outbound || []),
    "",
  ].join("\n");
}

export function writeDependencySnapshotMarkdown(filePath, snapshot) {
  writeTextAtomic(filePath, `${renderDependencySnapshotMarkdown(snapshot)}\n`);
}

export function buildHelperTasks({
  wave,
  assignments = [],
  dependencySnapshot = null,
  docsQueue = null,
  documentationAgentId = "A9",
}) {
  const tasks = [];
  for (const assignment of assignments) {
    if (!assignment.blocking) {
      continue;
    }
    tasks.push({
      id: `helper:${assignment.id}`,
      title: assignment.summary || `Follow-up for ${assignment.requestId}`,
      owner: assignment.assignedAgentId || null,
      kind: "helper",
      dependsOn: [assignment.requestId],
      state:
        assignment.state === "resolved"
          ? "done"
          : assignment.assignedAgentId
            ? assignment.state === "in_progress"
              ? "in_progress"
              : assignment.state === "acknowledged"
                ? "acknowledged"
                : "planned"
            : "blocked",
      proofState: "pending",
      docState: "pending",
      infraState: "n/a",
      priority: assignment.priority || "normal",
      artifactRefs: assignment.artifactRefs || [],
      assignment: {
        target: assignment.target,
        targetType: assignment.targetType,
        capability: assignment.capability,
        assignmentReason: assignment.assignmentReason,
      },
    });
  }
  for (const dependency of dependencySnapshot?.inbound || []) {
    if (!isOpenCoordinationStatus(dependency.status)) {
      continue;
    }
    tasks.push({
      id: `dependency:${dependency.id}`,
      title: dependency.summary || `Inbound dependency ${dependency.id}`,
      owner: dependency.assignedAgentId || null,
      kind: "dependency",
      dependsOn: [],
      state:
        dependency.required && !dependency.assignedAgentId
          ? "blocked"
          : dependency.status === "in_progress"
            ? "in_progress"
            : dependency.status === "acknowledged"
              ? "acknowledged"
              : "planned",
      proofState: "pending",
      docState: "pending",
      infraState: "n/a",
      priority: dependency.priority || "high",
      artifactRefs: dependency.artifactRefs || [],
      assignment: {
        target: dependency.targets?.[0] || null,
        targetType:
          dependency.targets?.[0] && String(dependency.targets[0]).startsWith("capability:")
            ? "capability"
            : "agent",
        capability:
          dependency.targets?.[0] && String(dependency.targets[0]).startsWith("capability:")
            ? normalizeCapability(String(dependency.targets[0]).slice("capability:".length))
            : null,
        assignmentReason: dependency.assignmentReason,
      },
      dependency,
    });
  }
  for (const item of docsQueue?.items || []) {
    if (!["shared-plan", "component-matrix"].includes(String(item.kind || ""))) {
      continue;
    }
    tasks.push({
      id: `doc-helper:${item.id}`,
      title: item.summary || `Documentation follow-up for ${item.path || item.id}`,
      owner: item.ownerAgentId || documentationAgentId,
      kind: "documentation-helper",
      dependsOn: [],
      state: "planned",
      proofState: "n/a",
      docState: "pending",
      infraState: "n/a",
      priority: "high",
      artifactRefs: item.path ? [item.path] : [],
      assignment: null,
    });
  }
  const outboundBlocking = (dependencySnapshot?.requiredOutbound || []).map((dependency) => ({
    id: `dependency-outbound:${dependency.id}`,
    title: dependency.summary || `Outbound dependency ${dependency.id}`,
    owner: null,
    kind: "dependency-outbound",
    dependsOn: [],
    state: "blocked",
    proofState: "pending",
    docState: "pending",
    infraState: "n/a",
    priority: dependency.priority || "high",
    artifactRefs: dependency.artifactRefs || [],
    assignment: null,
    dependency,
  }));
  return [...tasks, ...outboundBlocking];
}
