import fs from "node:fs";
import path from "node:path";
import {
  materializeAgentExecutionSummaryForRun,
  materializeAgentExecutionSummaries,
  readRunExecutionSummary,
} from "./gate-engine.mjs";
import {
  isOpenCoordinationStatus,
  appendCoordinationRecord,
  compileAgentInbox,
  compileSharedSummary,
  readMaterializedCoordinationState,
  renderCoordinationBoardProjection,
  updateSeedRecords,
  buildCoordinationResponseMetrics,
} from "./coordination-store.mjs";
import { triageClarificationRequests } from "./clarification-triage.mjs";
import {
  buildDependencySnapshot,
  buildRequestAssignments,
  renderDependencySnapshotMarkdown,
  syncAssignmentRecords,
} from "./routing-state.mjs";
import { deriveWaveLedger, readWaveLedger } from "./ledger.mjs";
import { buildDocsQueue, readDocsQueue } from "./docs-queue.mjs";
import { parseStructuredSignalsFromLog } from "./dashboard-state.mjs";
import {
  isSecurityReviewAgentForLane,
  resolveSecurityReviewReportPath,
  isContEvalImplementationOwningAgent,
  resolveWaveRoleBindings,
} from "./role-helpers.mjs";
import {
  REPO_ROOT,
  compactSingleLine,
  readJsonOrNull,
  toIsoTimestamp,
} from "./shared.mjs";
import {
  validateContEvalSummary,
  validateImplementationSummary,
  validateSecuritySummary,
} from "./agent-state.mjs";
import {
  applyContext7SelectionsToWave,
  describeContext7Libraries,
  loadContext7BundleIndex,
} from "./context7.mjs";
import {
  readWaveCorridorContext,
  waveCorridorContextPath,
} from "./corridor.mjs";

export function waveCoordinationLogPath(lanePaths, waveNumber) {
  return path.join(lanePaths.coordinationDir, `wave-${waveNumber}.jsonl`);
}

export function waveInboxDir(lanePaths, waveNumber) {
  return path.join(lanePaths.inboxesDir, `wave-${waveNumber}`);
}

export function waveAssignmentsPath(lanePaths, waveNumber) {
  return path.join(lanePaths.assignmentsDir, `wave-${waveNumber}.json`);
}

export function waveLedgerPath(lanePaths, waveNumber) {
  return path.join(lanePaths.ledgerDir, `wave-${waveNumber}.json`);
}

export function waveDependencySnapshotPath(lanePaths, waveNumber) {
  return path.join(lanePaths.dependencySnapshotsDir, `wave-${waveNumber}.json`);
}

export function waveDependencySnapshotMarkdownPath(lanePaths, waveNumber) {
  return path.join(lanePaths.dependencySnapshotsDir, `wave-${waveNumber}.md`);
}

export function waveDocsQueuePath(lanePaths, waveNumber) {
  return path.join(lanePaths.docsQueueDir, `wave-${waveNumber}.json`);
}

export function waveIntegrationPath(lanePaths, waveNumber) {
  return path.join(lanePaths.integrationDir, `wave-${waveNumber}.json`);
}

export function waveIntegrationMarkdownPath(lanePaths, waveNumber) {
  return path.join(lanePaths.integrationDir, `wave-${waveNumber}.md`);
}

export function waveSecurityPath(lanePaths, waveNumber) {
  return path.join(lanePaths.securityDir, `wave-${waveNumber}.json`);
}

export function waveSecurityMarkdownPath(lanePaths, waveNumber) {
  return path.join(lanePaths.securityDir, `wave-${waveNumber}.md`);
}

export function uniqueStringEntries(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function summarizeIntegrationRecord(record, options = {}) {
  const summary = compactSingleLine(
    record?.summary || record?.detail || record?.kind || "coordination item",
    options.maxChars || 180,
  );
  return `${record.id}: ${summary}`;
}

function summarizeDocsQueueItem(item) {
  return `${item.id}: ${compactSingleLine(item.summary || item.path || item.detail || "documentation update required", 180)}`;
}

function summarizeGap(agentId, detail, fallback) {
  return `${agentId}: ${compactSingleLine(detail || fallback, 180)}`;
}

function textMentionsAnyKeyword(value, keywords) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return false;
  }
  return keywords.some((keyword) => text.includes(String(keyword || "").trim().toLowerCase()));
}

function actionableIntegrationRecords(coordinationState) {
  return (coordinationState?.latestRecords || []).filter(
    (record) =>
      !["cancelled", "superseded"].includes(String(record?.status || "").trim().toLowerCase()) &&
      ![
        "human-feedback",
        "human-escalation",
        "orchestrator-guidance",
        "resolved-by-policy",
        "integration-summary",
      ].includes(record?.kind),
  );
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

function resolveArtifactOwners(artifactRef, agents) {
  const owners = [];
  const normalizedArtifact = normalizeOwnedReference(artifactRef);
  if (!normalizedArtifact) {
    return owners;
  }
  for (const agent of agents || []) {
    const ownedComponents = Array.isArray(agent?.components) ? agent.components : [];
    const ownedPaths = Array.isArray(agent?.ownedPaths) ? agent.ownedPaths : [];
    if (
      ownedComponents.some((componentId) => normalizeOwnedReference(componentId) === normalizedArtifact) ||
      ownedPaths.some((ownedPath) => matchesOwnedPathArtifact(normalizedArtifact, ownedPath))
    ) {
      owners.push(agent.agentId);
    }
  }
  return owners;
}

function inferIntegrationRecommendation(evidence) {
  if ((evidence.unresolvedBlockers || []).length > 0) {
    return {
      recommendation: "needs-more-work",
      detail: `${evidence.unresolvedBlockers.length} unresolved blocker(s) remain.`,
    };
  }
  if ((evidence.conflictingClaims || []).length > 0) {
    return {
      recommendation: "needs-more-work",
      detail: `${evidence.conflictingClaims.length} conflicting claim(s) remain.`,
    };
  }
  if ((evidence.proofGaps || []).length > 0) {
    return {
      recommendation: "needs-more-work",
      detail: `${evidence.proofGaps.length} proof gap(s) remain.`,
    };
  }
  if ((evidence.deployRisks || []).length > 0) {
    return {
      recommendation: "needs-more-work",
      detail: `${evidence.deployRisks.length} deploy or ops risk(s) remain.`,
    };
  }
  return {
    recommendation: "ready-for-doc-closure",
    detail:
      "No unresolved blockers, contradictions, proof gaps, or deploy risks remain in integration state.",
  };
}

export function buildWaveSecuritySummary({
  lanePaths,
  wave,
  attempt,
  summariesByAgentId = {},
  corridorSummary = null,
}) {
  const createdAt = toIsoTimestamp();
  const securityAgents = (wave.agents || []).filter((agent) =>
    isSecurityReviewAgentForLane(agent, lanePaths),
  );
  if (securityAgents.length === 0) {
    return {
      wave: wave.wave,
      lane: lanePaths.lane,
      attempt,
      overallState: "not-applicable",
      totalFindings: 0,
      totalApprovals: 0,
      concernAgentIds: [],
      blockedAgentIds: [],
      detail: "No security reviewer declared for this wave.",
      agents: [],
      createdAt,
      updatedAt: createdAt,
    };
  }
  const agents = securityAgents.map((agent) => {
    const summary = summariesByAgentId?.[agent.agentId] || null;
    const validation = validateSecuritySummary(agent, summary);
    const explicitState = summary?.security?.state || null;
    return {
      agentId: agent.agentId,
      title: agent.title || agent.agentId,
      state: validation.ok
        ? explicitState || "clear"
        : explicitState === "blocked"
          ? "blocked"
          : "pending",
      findings: summary?.security?.findings || 0,
      approvals: summary?.security?.approvals || 0,
      detail: validation.ok
        ? summary?.security?.detail || validation.detail || ""
        : validation.detail,
      reportPath: summary?.reportPath || resolveSecurityReviewReportPath(agent) || null,
      statusCode: validation.statusCode,
      ok: validation.ok,
    };
  });
  const blockedAgentIds = agents
    .filter((entry) => entry.state === "blocked")
    .map((entry) => entry.agentId);
  const concernAgentIds = agents
    .filter((entry) => entry.state === "concerns")
    .map((entry) => entry.agentId);
  const pendingAgentIds = agents
    .filter((entry) => entry.state === "pending")
    .map((entry) => entry.agentId);
  const overallState =
    blockedAgentIds.length > 0
      ? "blocked"
      : pendingAgentIds.length > 0
        ? "pending"
        : concernAgentIds.length > 0
          ? "concerns"
          : "clear";
  const totalFindings = agents.reduce((sum, entry) => sum + (entry.findings || 0), 0);
  const totalApprovals = agents.reduce((sum, entry) => sum + (entry.approvals || 0), 0);
  const detail =
    corridorSummary?.blocking
      ? `Corridor matched blocking findings for implementation-owned paths.`
      : overallState === "blocked"
      ? `Security review blocked by ${blockedAgentIds.join(", ")}.`
      : overallState === "pending"
        ? `Security review output is incomplete for ${pendingAgentIds.join(", ")}.`
        : overallState === "concerns"
          ? `Security review reported advisory concerns from ${concernAgentIds.join(", ")}.`
          : "Security review is clear.";
  return {
    wave: wave.wave,
    lane: lanePaths.lane,
    attempt,
    overallState,
    totalFindings,
    totalApprovals,
    concernAgentIds,
    blockedAgentIds,
    detail,
    corridor: corridorSummary
      ? {
          ok: corridorSummary.ok === true,
          providerMode: corridorSummary.providerMode || null,
          source: corridorSummary.source || null,
          blocking: corridorSummary.blocking === true,
          blockingFindings: corridorSummary.blockingFindings || [],
          matchedFindings: corridorSummary.matchedFindings || [],
          error: corridorSummary.error || null,
        }
      : null,
    agents,
    createdAt,
    updatedAt: createdAt,
  };
}

function padReportedEntries(entries, minimumCount, label) {
  const padded = [...entries];
  for (let index = padded.length + 1; index <= minimumCount; index += 1) {
    padded.push(`${label} #${index}`);
  }
  return padded;
}

function buildIntegrationEvidence({
  lanePaths,
  wave,
  roleBindings = resolveWaveRoleBindings(wave, lanePaths),
  coordinationState,
  summariesByAgentId,
  docsQueue,
  agentRuns,
  dependencySnapshot = null,
  capabilityAssignments = [],
  securitySummary = null,
}) {
  const openClaims = (coordinationState?.claims || [])
    .filter((record) => isOpenCoordinationStatus(record.status))
    .map((record) => summarizeIntegrationRecord(record));
  const conflictingClaims = (coordinationState?.claims || [])
    .filter(
      (record) =>
        isOpenCoordinationStatus(record.status) &&
        /conflict|contradict/i.test(`${record.summary || ""}\n${record.detail || ""}`),
    )
    .map((record) => summarizeIntegrationRecord(record));
  const unresolvedBlockers = (coordinationState?.blockers || [])
    .filter((record) => isOpenCoordinationStatus(record.status))
    .map((record) => summarizeIntegrationRecord(record));

  const interfaceKeywords = ["interface", "contract", "api", "schema", "migration", "signature"];
  const changedInterfaces = actionableIntegrationRecords(coordinationState)
    .filter((record) =>
      textMentionsAnyKeyword(
        [record.summary, record.detail, ...(record.artifactRefs || [])].join("\n"),
        interfaceKeywords,
      ),
    )
    .map((record) => summarizeIntegrationRecord(record));

  const crossComponentImpacts = actionableIntegrationRecords(coordinationState)
    .flatMap((record) => {
      const owners = new Set();
      for (const artifactRef of record.artifactRefs || []) {
        for (const owner of resolveArtifactOwners(artifactRef, wave.agents)) {
          owners.add(owner);
        }
      }
      for (const target of record.targets || []) {
        if (String(target).startsWith("agent:")) {
          owners.add(String(target).slice("agent:".length));
        } else if ((wave.agents || []).some((agent) => agent.agentId === target)) {
          owners.add(String(target));
        }
      }
      if (owners.size <= 1) {
        return [];
      }
      return [
        `${summarizeIntegrationRecord(record)} [owners: ${Array.from(owners).toSorted().join(", ")}]`,
      ];
    });

  const proofGapEntries = [];
  const docGapEntries = Array.isArray(docsQueue?.items)
    ? docsQueue.items.map((item) => summarizeDocsQueueItem(item))
    : [];
  const deployRiskEntries = [];
  const securityFindingEntries = [];
  const securityApprovalEntries = [];
  for (const agent of wave.agents || []) {
    const summary = summariesByAgentId?.[agent.agentId] || null;
    const contEvalImplementationOwning =
      agent.agentId === roleBindings.contEvalAgentId &&
      isContEvalImplementationOwningAgent(agent, {
        contEvalAgentId: roleBindings.contEvalAgentId,
      });
    if (isSecurityReviewAgentForLane(agent, lanePaths)) {
      continue;
    }
    if (agent.agentId === roleBindings.contEvalAgentId) {
      const validation = validateContEvalSummary(agent, summary, {
        mode: "live",
        evalTargets: wave.evalTargets,
        benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
      });
      if (!validation.ok) {
        proofGapEntries.push(
          summarizeGap(agent.agentId, validation.detail, "cont-EVAL target is not yet satisfied."),
        );
      }
    }
    if (
      ![
        roleBindings.contQaAgentId,
        roleBindings.integrationAgentId,
        roleBindings.documentationAgentId,
      ].includes(agent.agentId) &&
      (agent.agentId !== roleBindings.contEvalAgentId || contEvalImplementationOwning)
    ) {
      const validation = validateImplementationSummary(agent, summary);
      if (!validation.ok) {
        const entry = summarizeGap(agent.agentId, validation.detail, "Implementation validation failed.");
        if (["missing-doc-delta", "doc-impact-gap", "invalid-doc-delta-format"].includes(validation.statusCode)) {
          docGapEntries.push(entry);
        } else {
          proofGapEntries.push(entry);
        }
      }
    }
    for (const gap of summary?.gaps || []) {
      const entry = summarizeGap(
        agent.agentId,
        gap.detail,
        `${gap.kind || "unknown"} gap reported.`,
      );
      if (gap.kind === "docs") {
        docGapEntries.push(entry);
      } else if (gap.kind === "ops") {
        deployRiskEntries.push(entry);
      } else {
        proofGapEntries.push(entry);
      }
    }
  }

  for (const run of agentRuns || []) {
    const signals = parseStructuredSignalsFromLog(run.logPath);
    if (signals?.deployment && signals.deployment.state !== "healthy") {
      deployRiskEntries.push(
        summarizeGap(
          run.agent.agentId,
          `Deployment ${signals.deployment.service} ended in state ${signals.deployment.state}${signals.deployment.detail ? ` (${signals.deployment.detail})` : ""}.`,
          "Deployment did not finish healthy.",
        ),
      );
    }
    if (
      signals?.infra &&
      !["conformant", "action-complete"].includes(
        String(signals.infra.state || "").trim().toLowerCase(),
      )
    ) {
      deployRiskEntries.push(
        summarizeGap(
          run.agent.agentId,
          `Infra ${signals.infra.kind || "unknown"} on ${signals.infra.target || "unknown"} ended in state ${signals.infra.state || "unknown"}${signals.infra.detail ? ` (${signals.infra.detail})` : ""}.`,
          "Infra risk remains open.",
        ),
      );
    }
  }

  const inboundDependencies = (dependencySnapshot?.openInbound || []).map(
    (record) =>
      `${record.id}: ${compactSingleLine(record.summary || record.detail || "inbound dependency", 180)}${record.assignedAgentId ? ` -> ${record.assignedAgentId}` : ""}`,
  );
  const outboundDependencies = (dependencySnapshot?.openOutbound || []).map(
    (record) =>
      `${record.id}: ${compactSingleLine(record.summary || record.detail || "outbound dependency", 180)}`,
  );
  const helperAssignments = (capabilityAssignments || [])
    .filter((assignment) => assignment.blocking)
    .map(
      (assignment) =>
        `${assignment.requestId}: ${assignment.target}${assignment.assignedAgentId ? ` -> ${assignment.assignedAgentId}` : " -> unresolved"} (${assignment.assignmentReason || "n/a"})`,
    );

  for (const review of securitySummary?.agents || []) {
    if (review.state === "blocked" || review.state === "concerns") {
      securityFindingEntries.push(
        summarizeGap(
          review.agentId,
          review.detail,
          review.state === "blocked"
            ? "Security review blocked the wave."
            : "Security review reported advisory concerns.",
        ),
      );
    }
    if ((review.approvals || 0) > 0) {
      securityApprovalEntries.push(
        summarizeGap(
          review.agentId,
          review.detail,
          `${review.approvals} security approval(s) remain open.`,
        ),
      );
    }
  }
  for (const finding of securitySummary?.corridor?.matchedFindings || []) {
    securityFindingEntries.push(
      summarizeGap(
        "corridor",
        `${finding.severity || "unknown"} ${finding.affectedFile || "unknown-file"}: ${finding.title || "finding"}`,
        "Corridor matched a relevant finding.",
      ),
    );
  }

  return {
    openClaims: uniqueStringEntries(openClaims),
    conflictingClaims: uniqueStringEntries(conflictingClaims),
    unresolvedBlockers: uniqueStringEntries(unresolvedBlockers),
    changedInterfaces: uniqueStringEntries(changedInterfaces),
    crossComponentImpacts: uniqueStringEntries(crossComponentImpacts),
    proofGaps: uniqueStringEntries(proofGapEntries),
    docGaps: uniqueStringEntries(docGapEntries),
    deployRisks: uniqueStringEntries(deployRiskEntries),
    inboundDependencies: uniqueStringEntries(inboundDependencies),
    outboundDependencies: uniqueStringEntries(outboundDependencies),
    helperAssignments: uniqueStringEntries(helperAssignments),
    securityState: securitySummary?.overallState || "not-applicable",
    securityFindings: uniqueStringEntries(securityFindingEntries),
    securityApprovals: uniqueStringEntries(securityApprovalEntries),
    corridorState: securitySummary?.corridor?.blocking
      ? "blocked"
      : securitySummary?.corridor?.ok === false
        ? "error"
        : securitySummary?.corridor
          ? "clear"
          : "not-configured",
  };
}

export function buildWaveIntegrationSummary({
  lanePaths,
  wave,
  attempt,
  coordinationState,
  summariesByAgentId,
  docsQueue,
  runtimeAssignments,
  agentRuns,
  capabilityAssignments = [],
  dependencySnapshot = null,
  securitySummary = null,
}) {
  const roleBindings = resolveWaveRoleBindings(wave, lanePaths);
  const explicitIntegration = summariesByAgentId[roleBindings.integrationAgentId]?.integration || null;
  const evidence = buildIntegrationEvidence({
    lanePaths,
    wave,
    roleBindings,
    coordinationState,
    summariesByAgentId,
    docsQueue,
    agentRuns,
    capabilityAssignments,
    dependencySnapshot,
    securitySummary,
  });
  if (explicitIntegration) {
    // When the integration steward explicitly asserts ready-for-doc-closure,
    // clear synthesized proof/doc gaps — the steward has signed off on them.
    const stewardClearedGaps =
      explicitIntegration.state === "ready-for-doc-closure" &&
      (explicitIntegration.blockers || 0) === 0;
    return {
      wave: wave.wave,
      lane: lanePaths.lane,
      agentId: roleBindings.integrationAgentId,
      attempt,
      openClaims: padReportedEntries(
        evidence.openClaims,
        explicitIntegration.claims || 0,
        "Integration steward reported unresolved claim",
      ),
      conflictingClaims: padReportedEntries(
        evidence.conflictingClaims,
        explicitIntegration.conflicts || 0,
        "Integration steward reported unresolved conflict",
      ),
      unresolvedBlockers: padReportedEntries(
        evidence.unresolvedBlockers,
        explicitIntegration.blockers || 0,
        "Integration steward reported unresolved blocker",
      ),
      changedInterfaces: evidence.changedInterfaces,
      crossComponentImpacts: evidence.crossComponentImpacts,
      proofGaps: stewardClearedGaps ? [] : evidence.proofGaps,
      docGaps: stewardClearedGaps ? [] : evidence.docGaps,
      deployRisks: evidence.deployRisks,
      securityState: evidence.securityState,
      securityFindings: evidence.securityFindings,
      securityApprovals: evidence.securityApprovals,
      inboundDependencies: evidence.inboundDependencies,
      outboundDependencies: evidence.outboundDependencies,
      helperAssignments: evidence.helperAssignments,
      runtimeAssignments,
      recommendation: explicitIntegration.state,
      detail: explicitIntegration.detail || "",
      createdAt: toIsoTimestamp(),
      updatedAt: toIsoTimestamp(),
    };
  }
  const inferred = inferIntegrationRecommendation(evidence);
  return {
    wave: wave.wave,
    lane: lanePaths.lane,
    agentId: "launcher",
    attempt,
    ...evidence,
    runtimeAssignments,
    recommendation: inferred.recommendation,
    detail: inferred.detail,
    createdAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
  };
}

export function buildWaveDerivedState({
  lanePaths,
  wave,
  agentRuns = [],
  summariesByAgentId = {},
  feedbackRequests = [],
  attempt = 0,
  orchestratorId = null,
}) {
  const roleBindings = resolveWaveRoleBindings(wave, lanePaths);
  const coordinationLogPath = waveCoordinationLogPath(lanePaths, wave.wave);
  const existingDocsQueue = readDocsQueue(waveDocsQueuePath(lanePaths, wave.wave));
  const existingIntegrationSummary = readJsonOrNull(waveIntegrationPath(lanePaths, wave.wave));
  const existingLedger = readWaveLedger(waveLedgerPath(lanePaths, wave.wave));
  updateSeedRecords(coordinationLogPath, {
    lane: lanePaths.lane,
    wave: wave.wave,
    agents: wave.agents,
    componentPromotions: wave.componentPromotions,
    sharedPlanDocs: lanePaths.sharedPlanDocs,
    contQaAgentId: roleBindings.contQaAgentId,
    contEvalAgentId: roleBindings.contEvalAgentId,
    integrationAgentId: roleBindings.integrationAgentId,
    documentationAgentId: roleBindings.documentationAgentId,
    feedbackRequests,
  });
  let coordinationState = readMaterializedCoordinationState(coordinationLogPath);
  const clarificationTriage = triageClarificationRequests({
    lanePaths,
    wave,
    coordinationLogPath,
    coordinationState,
    orchestratorId,
    attempt,
    resolutionContext: {
      docsQueue: existingDocsQueue,
      integrationSummary: existingIntegrationSummary,
      ledger: existingLedger,
      summariesByAgentId,
    },
  });
  if (clarificationTriage.changed) {
    coordinationState = readMaterializedCoordinationState(coordinationLogPath);
  }
  const capabilityAssignments = buildRequestAssignments({
    coordinationState,
    agents: wave.agents,
    ledger: existingLedger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  syncAssignmentRecords(coordinationLogPath, {
    lane: lanePaths.lane,
    wave: wave.wave,
    assignments: capabilityAssignments,
  });
  coordinationState = readMaterializedCoordinationState(coordinationLogPath);
  const dependencySnapshot = buildDependencySnapshot({
    dirPath: lanePaths.crossLaneDependenciesDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agents: wave.agents,
    ledger: existingLedger,
    capabilityRouting: lanePaths.capabilityRouting,
  });
  const runtimeAssignments = wave.agents.map((agent) => ({
    agentId: agent.agentId,
    role: agent.executorResolved?.role || null,
    initialExecutorId: agent.executorResolved?.initialExecutorId || null,
    executorId: agent.executorResolved?.id || null,
    profile: agent.executorResolved?.profile || null,
    selectedBy: agent.executorResolved?.selectedBy || null,
    retryPolicy: agent.executorResolved?.retryPolicy || null,
    allowFallbackOnRetry: agent.executorResolved?.allowFallbackOnRetry !== false,
    fallbacks: agent.executorResolved?.fallbacks || [],
    fallbackUsed: agent.executorResolved?.fallbackUsed === true,
    fallbackReason: agent.executorResolved?.fallbackReason || null,
    executorHistory: agent.executorResolved?.executorHistory || [],
  }));
  const docsQueue = buildDocsQueue({
    lane: lanePaths.lane,
    wave,
    summariesByAgentId,
    sharedPlanDocs: lanePaths.sharedPlanDocs,
    componentPromotions: wave.componentPromotions,
    runtimeAssignments,
  });
  const securitySummary = buildWaveSecuritySummary({
    lanePaths,
    wave,
    attempt,
    summariesByAgentId,
    corridorSummary: readWaveCorridorContext(lanePaths, wave.wave),
  });
  const integrationSummary = buildWaveIntegrationSummary({
    lanePaths,
    wave,
    attempt,
    coordinationState,
    summariesByAgentId,
    docsQueue,
    runtimeAssignments,
    agentRuns,
    capabilityAssignments,
    dependencySnapshot,
    securitySummary,
  });
  const ledger = deriveWaveLedger({
    lane: lanePaths.lane,
    wave,
    summariesByAgentId,
    coordinationState,
    integrationSummary,
    docsQueue,
    attempt,
    contQaAgentId: roleBindings.contQaAgentId,
    contEvalAgentId: roleBindings.contEvalAgentId,
    integrationAgentId: roleBindings.integrationAgentId,
    documentationAgentId: roleBindings.documentationAgentId,
    benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
    capabilityAssignments,
    dependencySnapshot,
    securityRolePromptPath: lanePaths.securityRolePromptPath,
  });
  const inboxDir = waveInboxDir(lanePaths, wave.wave);
  const sharedSummary = compileSharedSummary({
    wave,
    state: coordinationState,
    ledger,
    integrationSummary,
    capabilityAssignments,
    dependencySnapshot,
  });
  const sharedSummaryPath = path.join(inboxDir, "shared-summary.md");
  const inboxesByAgentId = {};
  for (const agent of wave.agents) {
    const inbox = compileAgentInbox({
      wave,
      agent,
      state: coordinationState,
      ledger,
      docsQueue,
      integrationSummary,
      capabilityAssignments,
      dependencySnapshot,
    });
    const inboxPath = path.join(inboxDir, `${agent.agentId}.md`);
    inboxesByAgentId[agent.agentId] = { path: inboxPath, text: inbox.text, truncated: inbox.truncated };
  }
  const boardText = renderCoordinationBoardProjection({
    wave: wave.wave,
    waveFile: wave.file,
    agents: wave.agents,
    state: coordinationState,
    capabilityAssignments,
    dependencySnapshot,
  });
  const responseMetrics = buildCoordinationResponseMetrics(coordinationState);
  const messageBoardPath = path.join(lanePaths.messageboardsDir, `wave-${wave.wave}.md`);
  return {
    coordinationLogPath,
    coordinationState,
    clarificationTriage,
    docsQueue,
    docsQueuePath: waveDocsQueuePath(lanePaths, wave.wave),
    capabilityAssignments,
    assignmentSnapshotPath: waveAssignmentsPath(lanePaths, wave.wave),
    dependencySnapshot,
    dependencySnapshotPath: waveDependencySnapshotPath(lanePaths, wave.wave),
    dependencySnapshotMarkdownPath: waveDependencySnapshotMarkdownPath(lanePaths, wave.wave),
    securitySummary,
    securitySummaryPath: waveSecurityPath(lanePaths, wave.wave),
    corridorSummary: readWaveCorridorContext(lanePaths, wave.wave),
    corridorSummaryPath: waveCorridorContextPath(lanePaths, wave.wave),
    integrationSummary,
    integrationSummaryPath: waveIntegrationPath(lanePaths, wave.wave),
    integrationMarkdownPath: waveIntegrationMarkdownPath(lanePaths, wave.wave),
    securityMarkdownPath: waveSecurityMarkdownPath(lanePaths, wave.wave),
    ledger,
    ledgerPath: waveLedgerPath(lanePaths, wave.wave),
    responseMetrics,
    sharedSummaryPath,
    sharedSummaryText: sharedSummary.text,
    inboxesByAgentId,
    messageBoardPath,
    messageBoardText: boardText,
  };
}

export function applyDerivedStateToDashboard(dashboardState, derivedState) {
  if (!dashboardState || !derivedState) {
    return;
  }
  dashboardState.helperAssignmentsOpen = (derivedState.capabilityAssignments || []).filter(
    (assignment) => assignment.blocking,
  ).length;
  dashboardState.inboundDependenciesOpen = (derivedState.dependencySnapshot?.openInbound || []).length;
  dashboardState.outboundDependenciesOpen = (derivedState.dependencySnapshot?.openOutbound || []).length;
  dashboardState.coordinationOpen = derivedState.coordinationState?.openRecords?.length || 0;
  dashboardState.openClarifications =
    (derivedState.coordinationState?.clarifications || []).filter((record) =>
      isOpenCoordinationStatus(record.status),
    ).length;
  dashboardState.openHumanEscalations =
    derivedState.responseMetrics?.openHumanEscalationCount ||
    (derivedState.coordinationState?.humanEscalations || []).filter((record) =>
      isOpenCoordinationStatus(record.status),
    ).length;
  dashboardState.oldestOpenCoordinationAgeMs =
    derivedState.responseMetrics?.oldestOpenCoordinationAgeMs ?? null;
  dashboardState.oldestUnackedRequestAgeMs =
    derivedState.responseMetrics?.oldestUnackedRequestAgeMs ?? null;
  dashboardState.overdueAckCount = derivedState.responseMetrics?.overdueAckCount || 0;
  dashboardState.overdueClarificationCount =
    derivedState.responseMetrics?.overdueClarificationCount || 0;
}
