import fs from "node:fs";
import path from "node:path";
import {
  appendCoordinationRecord,
  clarificationClosureCondition,
  clarificationLinkedRequests,
  coordinationRecordBlocksWave,
  isOpenCoordinationStatus,
  readMaterializedCoordinationState,
} from "./coordination-store.mjs";
import { createFeedbackRequest } from "./feedback.mjs";
import {
  DEFAULT_COORDINATION_ACK_TIMEOUT_MS,
  ensureDirectory,
  writeTextAtomic,
} from "./shared.mjs";

const MAX_ROUTED_CLARIFICATION_CYCLES = 2;

function triageLogPath(lanePaths, waveNumber) {
  return path.join(lanePaths.feedbackTriageDir, `wave-${waveNumber}.jsonl`);
}

function pendingHumanPath(lanePaths, waveNumber) {
  return path.join(lanePaths.feedbackTriageDir, `wave-${waveNumber}`, "pending-human.md");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function lowerText(value) {
  return normalizeText(value).toLowerCase();
}

function routeRequestId(clarificationId, cycle) {
  return `route-${clarificationId}-${cycle}`;
}

function routeCycleForRecord(recordId) {
  const match = String(recordId || "").match(/-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function appendTriageRecord(filePath, payload) {
  return appendCoordinationRecord(filePath, payload);
}

function writePendingHumanSummary(filePath, triageState) {
  const openEscalations = (triageState?.humanEscalations || []).filter((record) =>
    isOpenCoordinationStatus(record.status),
  );
  ensureDirectory(path.dirname(filePath));
  const text = [
    "# Pending Human Escalations",
    "",
    ...(openEscalations.length > 0
      ? openEscalations.map(
          (record) =>
            `- ${record.id}: ${record.summary}${record.artifactRefs?.length ? ` [tickets: ${record.artifactRefs.join(", ")}]` : ""}`,
        )
      : ["- None."]),
    "",
  ].join("\n");
  writeTextAtomic(filePath, text);
}

function artifactRefSet(record) {
  return new Set((record?.artifactRefs || []).map((value) => lowerText(value)));
}

function recordMatchesArtifactRefs(record, candidates) {
  const refs = artifactRefSet(record);
  if (refs.size === 0) {
    return false;
  }
  return candidates.some((candidate) => refs.has(lowerText(candidate)));
}

function textMentionsAny(text, values) {
  const haystack = lowerText(text);
  return values.some((value) => haystack.includes(lowerText(value)));
}

function findOwnedPathOwners(wave, text) {
  return wave.agents.filter((agent) =>
    Array.isArray(agent.ownedPaths) &&
    agent.ownedPaths.some((ownedPath) => lowerText(text).includes(lowerText(ownedPath))),
  );
}

function findComponentOwners(wave, text) {
  return wave.agents.filter((agent) =>
    Array.isArray(agent.components) &&
    agent.components.some((componentId) => lowerText(text).includes(lowerText(componentId))),
  );
}

function findDecisionResolution(record, resolutionContext = {}) {
  const searchableText = [
    record.summary,
    record.detail,
    ...(record.artifactRefs || []),
  ].join("\n");
  const matchingDecision = (resolutionContext.coordinationState?.decisions || []).find((decision) => {
    if (recordMatchesArtifactRefs(record, decision.artifactRefs || [])) {
      return true;
    }
    return textMentionsAny(searchableText, [
      decision.summary,
      decision.detail,
      ...(decision.artifactRefs || []),
    ]);
  });
  if (!matchingDecision) {
    return null;
  }
  return {
    type: "policy",
    guidance:
      matchingDecision.detail ||
      matchingDecision.summary ||
      `Resolved from coordination decision ${matchingDecision.id}.`,
  };
}

function findDocsQueueResolution(record, lanePaths, resolutionContext = {}) {
  const searchableText = [
    record.summary,
    record.detail,
    ...(record.artifactRefs || []),
  ].join("\n");
  const matchingItem = (resolutionContext.docsQueue?.items || []).find((item) => {
    if (recordMatchesArtifactRefs(record, [item.path, item.id])) {
      return true;
    }
    return textMentionsAny(searchableText, [item.id, item.path, item.summary]);
  });
  if (!matchingItem) {
    return null;
  }
  return {
    type: "route",
    routeAgentId: lanePaths.documentationAgentId,
    guidance:
      matchingItem.summary ||
      `Documentation reconciliation item ${matchingItem.id} is owned by ${lanePaths.documentationAgentId}.`,
  };
}

function findIntegrationResolution(record, lanePaths, resolutionContext = {}) {
  const searchableText = [
    record.summary,
    record.detail,
    ...(record.artifactRefs || []),
  ].join("\n");
  const integrationSummary = resolutionContext.integrationSummary || null;
  if (!integrationSummary) {
    return null;
  }
  const mentionsIntegration = textMentionsAny(searchableText, [
    ...(integrationSummary.openClaims || []),
    "contradict",
    "cross-component",
    "cross component",
    "interface",
    "integration",
    ...(integrationSummary.conflictingClaims || []),
    ...(integrationSummary.unresolvedBlockers || []),
    ...(integrationSummary.changedInterfaces || []),
    ...(integrationSummary.crossComponentImpacts || []),
    ...(integrationSummary.proofGaps || []),
    ...(integrationSummary.deployRisks || []),
    ...(integrationSummary.docGaps || []),
  ]);
  if (!mentionsIntegration) {
    return null;
  }
  return {
    type: "route",
    routeAgentId: lanePaths.integrationAgentId,
    guidance:
      integrationSummary.detail ||
      `Integration state is owned by ${lanePaths.integrationAgentId}.`,
  };
}

function findSummaryOwnerResolution(record, wave, resolutionContext = {}) {
  const searchableText = [
    record.summary,
    record.detail,
    ...(record.artifactRefs || []),
  ].join("\n");
  for (const agent of wave.agents) {
    const summary = resolutionContext.summariesByAgentId?.[agent.agentId];
    if (!summary) {
      continue;
    }
    const matchedDocPath =
      summary.docDelta?.paths?.some((docPath) => textMentionsAny(searchableText, [docPath])) ||
      false;
    const matchedComponent =
      summary.components?.some((component) =>
        textMentionsAny(searchableText, [component.componentId]),
      ) || false;
    if (matchedDocPath || matchedComponent) {
      return {
        type: "route",
        routeAgentId: agent.agentId,
        guidance: `Latest summary evidence points to ${agent.agentId} for this clarification.`,
      };
    }
  }
  return null;
}

function buildPolicyResolution(record, wave, lanePaths, resolutionContext = {}) {
  const combinedText = [record.summary, record.detail, ...(record.artifactRefs || [])].join("\n");
  const lower = lowerText(combinedText);
  const decisionResolution = findDecisionResolution(record, resolutionContext);
  if (decisionResolution) {
    return decisionResolution;
  }
  const docsQueueResolution = findDocsQueueResolution(record, lanePaths, resolutionContext);
  if (docsQueueResolution) {
    return docsQueueResolution;
  }
  const pathOwners = findOwnedPathOwners(wave, combinedText).filter(
    (agent) => agent.agentId !== record.agentId,
  );
  if (pathOwners.length > 0) {
    return {
      type: "route",
      routeAgentId: pathOwners[0].agentId,
      guidance: `Ownership policy resolved this clarification to ${pathOwners[0].agentId}.`,
    };
  }
  const componentOwners = findComponentOwners(wave, combinedText).filter(
    (agent) => agent.agentId !== record.agentId,
  );
  if (componentOwners.length > 0) {
    return {
      type: "route",
      routeAgentId: componentOwners[0].agentId,
      guidance: `Component ownership resolved this clarification to ${componentOwners[0].agentId}.`,
    };
  }
  const summaryOwnerResolution = findSummaryOwnerResolution(record, wave, resolutionContext);
  if (summaryOwnerResolution) {
    return summaryOwnerResolution;
  }
  const integrationResolution = findIntegrationResolution(record, lanePaths, resolutionContext);
  if (integrationResolution) {
    return integrationResolution;
  }
  if (
    lower.includes("shared-plan") ||
    lower.includes("shared plan") ||
    lower.includes("docs/plans/") ||
    lower.includes("component-cutover-matrix")
  ) {
    return {
      type: "route",
      routeAgentId: lanePaths.documentationAgentId,
      guidance: `Shared plan and component matrix updates are owned by ${lanePaths.documentationAgentId}.`,
    };
  }
  if (lower.includes("cont-eval") || lower.includes("benchmark") || lower.includes("eval target")) {
    return {
      type: "route",
      routeAgentId: lanePaths.contEvalAgentId,
      guidance: `Eval target selection and tuning are owned by ${lanePaths.contEvalAgentId}.`,
    };
  }
  if (lower.includes("cont-qa") || lower.includes("evaluator") || lower.includes("gate")) {
    return {
      type: "route",
      routeAgentId: lanePaths.contQaAgentId,
      guidance: `Final cont-QA pass/fail judgement and gate interpretation are owned by ${lanePaths.contQaAgentId}.`,
    };
  }
  return null;
}

function updateClarificationRecord(coordinationLogPath, record, status, detail, attempt) {
  appendCoordinationRecord(coordinationLogPath, {
    ...record,
    status,
    detail,
    attempt,
    updatedAt: undefined,
  });
}

function resolvedEscalationForClarification(coordinationState, clarificationId) {
  return (coordinationState?.humanEscalations || []).find(
    (record) =>
      record.closureCondition === clarificationClosureCondition(clarificationId) &&
      ["resolved", "closed"].includes(record.status),
  );
}

function openEscalationForClarification(coordinationState, clarificationId) {
  return (coordinationState?.humanEscalations || []).find(
    (record) =>
      record.closureCondition === clarificationClosureCondition(clarificationId) &&
      isOpenCoordinationStatus(record.status),
  );
}

function recordAgeMs(record, nowMs = Date.now()) {
  const startedAtMs = Date.parse(record?.createdAt || record?.updatedAt || "");
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }
  return Math.max(0, nowMs - startedAtMs);
}

function supersedeOpenRequests(coordinationLogPath, requests, attempt) {
  for (const request of requests) {
    if (!isOpenCoordinationStatus(request.status)) {
      continue;
    }
    appendCoordinationRecord(coordinationLogPath, {
      ...request,
      status: "superseded",
      detail: `Superseded by clarification reroute at attempt ${attempt}.`,
      attempt,
      updatedAt: undefined,
    });
  }
}

function supersedeOpenEscalations(triagePath, coordinationLogPath, escalations, attempt, detail) {
  for (const escalation of escalations) {
    if (!isOpenCoordinationStatus(escalation.status)) {
      continue;
    }
    const nextRecord = {
      ...escalation,
      status: "superseded",
      detail,
      attempt,
      updatedAt: undefined,
    };
    appendTriageRecord(triagePath, nextRecord);
    appendCoordinationRecord(coordinationLogPath, nextRecord);
  }
}

function createClarificationRoute({
  triagePath,
  coordinationLogPath,
  lanePaths,
  wave,
  record,
  routeAgentId,
  guidance,
  cycle,
  attempt,
}) {
  const routeId = routeRequestId(record.id, cycle);
  const closureCondition = clarificationClosureCondition(record.id);
  updateClarificationRecord(coordinationLogPath, record, "in_progress", guidance, attempt);
  appendTriageRecord(triagePath, {
    id: `triage-${record.id}-route-${cycle}`,
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId: "launcher",
    kind: "orchestrator-guidance",
    targets: [`agent:${record.agentId}`],
    dependsOn: [record.id],
    priority: record.priority || "high",
    summary: `Clarification ${record.id} routed to ${routeAgentId}`,
    detail: guidance,
    status: "resolved",
    attempt,
    source: "launcher",
  });
  appendTriageRecord(triagePath, {
    id: routeId,
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId: "launcher",
    kind: "request",
    targets: [`agent:${routeAgentId}`],
    dependsOn: [record.id],
    closureCondition,
    priority: record.priority || "high",
    summary: `Clarification follow-up for ${record.agentId}`,
    detail: `${record.summary}\n\n${guidance}`,
    artifactRefs: record.artifactRefs || [],
    status: "open",
    attempt,
    source: "launcher",
  });
  appendCoordinationRecord(coordinationLogPath, {
    id: routeId,
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId: "launcher",
    kind: "request",
    targets: [`agent:${routeAgentId}`],
    dependsOn: [record.id],
    closureCondition,
    priority: record.priority || "high",
    summary: `Clarification follow-up for ${record.agentId}`,
    detail: `${record.summary}\n\n${guidance}`,
    artifactRefs: record.artifactRefs || [],
    status: "open",
    attempt,
    source: "launcher",
  });
}

function escalateClarificationToHuman({
  triagePath,
  lanePaths,
  wave,
  record,
  orchestratorId,
  attempt,
  reason,
}) {
  const humanRequest = createFeedbackRequest({
    feedbackStateDir: lanePaths.feedbackStateDir,
    feedbackRequestsDir: lanePaths.feedbackRequestsDir,
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId: record.agentId,
    orchestratorId,
    question: record.summary || "Clarification requested",
    context: record.detail || "",
    recordTelemetry: true,
  });
  const escalationId = `escalation-${humanRequest.requestId}`;
  const escalationRecord = {
    id: escalationId,
    lane: lanePaths.lane,
    wave: wave.wave,
    agentId: "launcher",
    kind: "human-escalation",
    targets: [`agent:${record.agentId}`],
    dependsOn: [record.id],
    closureCondition: clarificationClosureCondition(record.id),
    priority: record.priority || "high",
    summary: record.summary || "Human escalation required",
    detail: reason || record.detail || "",
    artifactRefs: [humanRequest.requestId],
    status: "open",
    attempt,
    source: "launcher",
  };
  appendTriageRecord(triagePath, escalationRecord);
  return escalationRecord;
}

export function triageClarificationRequests({
  lanePaths,
  wave,
  coordinationLogPath,
  coordinationState,
  orchestratorId,
  attempt = 0,
  resolutionContext = {},
  ackTimeoutMs = DEFAULT_COORDINATION_ACK_TIMEOUT_MS,
}) {
  ensureDirectory(lanePaths.feedbackTriageDir);
  const triagePath = triageLogPath(lanePaths, wave.wave);
  const openClarifications = (coordinationState?.clarifications || []).filter((record) =>
    coordinationRecordBlocksWave(record),
  );
  let changed = false;

  for (const record of openClarifications) {
    const linkedRequests = clarificationLinkedRequests(coordinationState, record.id);
    const openLinkedRequests = linkedRequests.filter((entry) =>
      coordinationRecordBlocksWave(entry),
    );
    const openAckPendingLinkedRequests = openLinkedRequests.filter(
      (entry) => entry.status === "open",
    );
    const activeLinkedRequests = openLinkedRequests.filter((entry) => entry.status !== "open");
    const resolvedLinkedRequest = linkedRequests.find((entry) =>
      ["resolved", "closed"].includes(entry.status),
    );
    const resolvedEscalation = resolvedEscalationForClarification(coordinationState, record.id);
    const openEscalations = (coordinationState?.humanEscalations || []).filter(
      (entry) =>
        entry.closureCondition === clarificationClosureCondition(record.id) &&
        coordinationRecordBlocksWave(entry),
    );
    if (resolvedLinkedRequest || resolvedEscalation) {
      if (openEscalations.length > 0) {
        supersedeOpenEscalations(
          triagePath,
          coordinationLogPath,
          openEscalations,
          attempt,
          `Superseded because clarification ${record.id} was already resolved.`,
        );
      }
      updateClarificationRecord(
        coordinationLogPath,
        record,
        "resolved",
        resolvedLinkedRequest
          ? `Resolved via ${resolvedLinkedRequest.id}.`
          : `Resolved via ${resolvedEscalation.id}.`,
        attempt,
      );
      changed = true;
      continue;
    }

    const resolution = buildPolicyResolution(record, wave, lanePaths, {
      ...resolutionContext,
      coordinationState,
    });
    if (resolution?.type === "policy") {
      if (openEscalations.length > 0) {
        supersedeOpenEscalations(
          triagePath,
          coordinationLogPath,
          openEscalations,
          attempt,
          `Superseded by policy resolution for clarification ${record.id}.`,
        );
      }
      updateClarificationRecord(coordinationLogPath, record, "resolved", resolution.guidance, attempt);
      appendTriageRecord(triagePath, {
        id: `triage-${record.id}-policy`,
        lane: lanePaths.lane,
        wave: wave.wave,
        agentId: "launcher",
        kind: "resolved-by-policy",
        targets: [`agent:${record.agentId}`],
        dependsOn: [record.id],
        priority: record.priority || "high",
        summary: `Clarification ${record.id} resolved from repo state`,
        detail: resolution.guidance,
        status: "resolved",
        attempt,
        source: "launcher",
      });
      appendCoordinationRecord(coordinationLogPath, {
        id: `triage-${record.id}-policy`,
        lane: lanePaths.lane,
        wave: wave.wave,
        agentId: "launcher",
        kind: "resolved-by-policy",
        targets: [`agent:${record.agentId}`],
        dependsOn: [record.id],
        priority: record.priority || "high",
        summary: `Clarification ${record.id} resolved from repo state`,
        detail: resolution.guidance,
        status: "resolved",
        attempt,
        source: "launcher",
      });
      changed = true;
      continue;
    }

    if (resolution?.type === "route") {
      if (openEscalations.length > 0) {
        supersedeOpenEscalations(
          triagePath,
          coordinationLogPath,
          openEscalations,
          attempt,
          `Superseded by routed clarification follow-up for ${record.id}.`,
        );
        changed = true;
      }
      const routeCycles = linkedRequests.length;
      if (openLinkedRequests.length === 0) {
        createClarificationRoute({
          triagePath,
          coordinationLogPath,
          lanePaths,
          wave,
          record,
          routeAgentId: resolution.routeAgentId,
          guidance: resolution.guidance,
          cycle: routeCycles + 1,
          attempt,
        });
        changed = true;
        continue;
      }
      if (activeLinkedRequests.length > 0) {
        continue;
      }
      const timedOutLinkedRequests = openAckPendingLinkedRequests.filter((entry) => {
        const ageMs = recordAgeMs(entry);
        return Number.isFinite(ageMs) && ageMs >= ackTimeoutMs;
      });
      if (timedOutLinkedRequests.length > 0 && routeCycles < MAX_ROUTED_CLARIFICATION_CYCLES) {
        supersedeOpenRequests(coordinationLogPath, timedOutLinkedRequests, attempt);
        createClarificationRoute({
          triagePath,
          coordinationLogPath,
          lanePaths,
          wave,
          record,
          routeAgentId: resolution.routeAgentId,
          guidance: resolution.guidance,
          cycle: routeCycles + 1,
          attempt,
        });
        changed = true;
        continue;
      }
      if (timedOutLinkedRequests.length > 0 && routeCycles >= MAX_ROUTED_CLARIFICATION_CYCLES) {
        if (openEscalations.length > 0 || openEscalationForClarification(coordinationState, record.id)) {
          continue;
        }
        const escalationRecord = escalateClarificationToHuman({
          triagePath,
          lanePaths,
          wave,
          record,
          orchestratorId,
          attempt,
          reason:
            resolution.guidance ||
            `Clarification remained unresolved after ${MAX_ROUTED_CLARIFICATION_CYCLES} routed cycles.`,
        });
        appendCoordinationRecord(coordinationLogPath, escalationRecord);
        updateClarificationRecord(
          coordinationLogPath,
          record,
          "in_progress",
          `Escalated to human via ${escalationRecord.artifactRefs[0]}.`,
          attempt,
        );
        changed = true;
      }
      continue;
    }

    if (openEscalationForClarification(coordinationState, record.id)) {
      continue;
    }
    const escalationRecord = escalateClarificationToHuman({
      triagePath,
      lanePaths,
      wave,
      record,
      orchestratorId,
      attempt,
      reason: record.detail || "No repo-state or owner resolution was available.",
    });
    appendCoordinationRecord(coordinationLogPath, escalationRecord);
    updateClarificationRecord(
      coordinationLogPath,
      record,
      "in_progress",
      `Escalated to human via ${escalationRecord.artifactRefs[0]}.`,
      attempt,
    );
    changed = true;
  }

  const refreshedTriageState = fs.existsSync(triagePath)
    ? readMaterializedCoordinationState(triagePath)
    : {
        byId: new Map(),
        humanEscalations: [],
      };
  writePendingHumanSummary(pendingHumanPath(lanePaths, wave.wave), refreshedTriageState);
  return {
    changed,
    triagePath,
    pendingHumanPath: pendingHumanPath(lanePaths, wave.wave),
    state: refreshedTriageState,
  };
}
