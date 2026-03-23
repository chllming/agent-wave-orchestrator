import fs from "node:fs";
import path from "node:path";
import {
  materializeAgentExecutionSummaryForRun,
  materializeAgentExecutionSummaries,
  readRunExecutionSummary,
} from "./launcher-gates.mjs";
import {
  isOpenCoordinationStatus,
  appendCoordinationRecord,
  compileAgentInbox,
  compileSharedSummary,
  readMaterializedCoordinationState,
  renderCoordinationBoardProjection,
  updateSeedRecords,
  writeCompiledInbox,
  writeCoordinationBoardProjection,
  writeJsonArtifact,
  buildCoordinationResponseMetrics,
} from "./coordination-store.mjs";
import { triageClarificationRequests } from "./clarification-triage.mjs";
import {
  buildDependencySnapshot,
  buildRequestAssignments,
  renderDependencySnapshotMarkdown,
  syncAssignmentRecords,
  writeDependencySnapshotMarkdown,
} from "./routing-state.mjs";
import {
  writeAssignmentSnapshot,
  writeDependencySnapshot,
} from "./artifact-schemas.mjs";
import { deriveWaveLedger, readWaveLedger, writeWaveLedger } from "./ledger.mjs";
import { buildDocsQueue, readDocsQueue, writeDocsQueue } from "./docs-queue.mjs";
import {
  parseStructuredSignalsFromLog,
} from "./dashboard-state.mjs";
import {
  isSecurityReviewAgent,
  resolveSecurityReviewReportPath,
  isContEvalImplementationOwningAgent,
} from "./role-helpers.mjs";
import {
  REPO_ROOT,
  compactSingleLine,
  ensureDirectory,
  readJsonOrNull,
  toIsoTimestamp,
  writeTextAtomic,
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
}) {
  const createdAt = toIsoTimestamp();
  const securityAgents = (wave.agents || []).filter((agent) => isSecurityReviewAgent(agent));
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
    overallState === "blocked"
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
    agents,
    createdAt,
    updatedAt: createdAt,
  };
}

function renderWaveSecuritySummaryMarkdown(securitySummary) {
  return [
    `# Wave ${securitySummary.wave} Security Summary`,
    "",
    `- State: ${securitySummary.overallState || "unknown"}`,
    `- Detail: ${securitySummary.detail || "n/a"}`,
    `- Total findings: ${securitySummary.totalFindings || 0}`,
    `- Total approvals: ${securitySummary.totalApprovals || 0}`,
    `- Reviewers: ${(securitySummary.agents || []).length}`,
    "",
    "## Reviews",
    ...((securitySummary.agents || []).length > 0
      ? securitySummary.agents.map(
          (entry) =>
            `- ${entry.agentId}: state=${entry.state || "unknown"} findings=${entry.findings || 0} approvals=${entry.approvals || 0}${entry.reportPath ? ` report=${entry.reportPath}` : ""}${entry.detail ? ` detail=${entry.detail}` : ""}`,
        )
      : ["- None."]),
    "",
  ].join("\n");
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
      agent.agentId === lanePaths.contEvalAgentId &&
      isContEvalImplementationOwningAgent(agent, {
        contEvalAgentId: lanePaths.contEvalAgentId,
      });
    if (isSecurityReviewAgent(agent)) {
      continue;
    }
    if (agent.agentId === lanePaths.contEvalAgentId) {
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
        lanePaths.contQaAgentId,
        lanePaths.integrationAgentId,
        lanePaths.documentationAgentId,
      ].includes(agent.agentId) &&
      (agent.agentId !== lanePaths.contEvalAgentId || contEvalImplementationOwning)
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
  const explicitIntegration = summariesByAgentId[lanePaths.integrationAgentId]?.integration || null;
  const evidence = buildIntegrationEvidence({
    lanePaths,
    wave,
    coordinationState,
    summariesByAgentId,
    docsQueue,
    agentRuns,
    capabilityAssignments,
    dependencySnapshot,
    securitySummary,
  });
  if (explicitIntegration) {
    return {
      wave: wave.wave,
      lane: lanePaths.lane,
      agentId: lanePaths.integrationAgentId,
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
      proofGaps: evidence.proofGaps,
      docGaps: evidence.docGaps,
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

function renderIntegrationSection(title, items) {
  return [
    title,
    ...((items || []).length > 0 ? items.map((item) => `- ${item}`) : ["- None."]),
    "",
  ];
}

function renderIntegrationSummaryMarkdown(integrationSummary) {
  return [
    `# Wave ${integrationSummary.wave} Integration Summary`,
    "",
    `- Recommendation: ${integrationSummary.recommendation || "unknown"}`,
    `- Detail: ${integrationSummary.detail || "n/a"}`,
    `- Open claims: ${(integrationSummary.openClaims || []).length}`,
    `- Conflicting claims: ${(integrationSummary.conflictingClaims || []).length}`,
    `- Unresolved blockers: ${(integrationSummary.unresolvedBlockers || []).length}`,
    `- Changed interfaces: ${(integrationSummary.changedInterfaces || []).length}`,
    `- Cross-component impacts: ${(integrationSummary.crossComponentImpacts || []).length}`,
    `- Proof gaps: ${(integrationSummary.proofGaps || []).length}`,
    `- Deploy risks: ${(integrationSummary.deployRisks || []).length}`,
    `- Documentation gaps: ${(integrationSummary.docGaps || []).length}`,
    `- Security review: ${integrationSummary.securityState || "not-applicable"}`,
    `- Security findings: ${(integrationSummary.securityFindings || []).length}`,
    `- Security approvals: ${(integrationSummary.securityApprovals || []).length}`,
    `- Inbound dependencies: ${(integrationSummary.inboundDependencies || []).length}`,
    `- Outbound dependencies: ${(integrationSummary.outboundDependencies || []).length}`,
    `- Helper assignments: ${(integrationSummary.helperAssignments || []).length}`,
    "",
    ...renderIntegrationSection("## Open Claims", integrationSummary.openClaims),
    ...renderIntegrationSection("## Conflicting Claims", integrationSummary.conflictingClaims),
    ...renderIntegrationSection("## Unresolved Blockers", integrationSummary.unresolvedBlockers),
    ...renderIntegrationSection("## Changed Interfaces", integrationSummary.changedInterfaces),
    ...renderIntegrationSection(
      "## Cross-Component Impacts",
      integrationSummary.crossComponentImpacts,
    ),
    ...renderIntegrationSection("## Proof Gaps", integrationSummary.proofGaps),
    ...renderIntegrationSection("## Deploy Risks", integrationSummary.deployRisks),
    ...renderIntegrationSection("## Security Findings", integrationSummary.securityFindings),
    ...renderIntegrationSection("## Security Approvals", integrationSummary.securityApprovals),
    ...renderIntegrationSection("## Inbound Dependencies", integrationSummary.inboundDependencies),
    ...renderIntegrationSection("## Outbound Dependencies", integrationSummary.outboundDependencies),
    ...renderIntegrationSection("## Helper Assignments", integrationSummary.helperAssignments),
    "## Runtime Assignments",
    ...((integrationSummary.runtimeAssignments || []).length > 0
      ? integrationSummary.runtimeAssignments.map(
          (assignment) =>
            `- ${assignment.agentId}: executor=${assignment.executorId || "n/a"} role=${assignment.role || "n/a"} profile=${assignment.profile || "none"} fallback_used=${assignment.fallbackUsed ? "yes" : "no"}`,
        )
      : ["- None."]),
    "",
    ...renderIntegrationSection("## Documentation Gaps", integrationSummary.docGaps),
  ].join("\n");
}

export function writeWaveDerivedState({
  lanePaths,
  wave,
  agentRuns = [],
  summariesByAgentId = {},
  feedbackRequests = [],
  attempt = 0,
  orchestratorId = null,
}) {
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
    contQaAgentId: lanePaths.contQaAgentId,
    contEvalAgentId: lanePaths.contEvalAgentId,
    integrationAgentId: lanePaths.integrationAgentId,
    documentationAgentId: lanePaths.documentationAgentId,
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
  writeAssignmentSnapshot(waveAssignmentsPath(lanePaths, wave.wave), capabilityAssignments, {
    lane: lanePaths.lane,
    wave: wave.wave,
  });
  writeDependencySnapshot(waveDependencySnapshotPath(lanePaths, wave.wave), dependencySnapshot, {
    lane: lanePaths.lane,
    wave: wave.wave,
  });
  writeDependencySnapshotMarkdown(
    waveDependencySnapshotMarkdownPath(lanePaths, wave.wave),
    dependencySnapshot,
  );
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
  writeDocsQueue(waveDocsQueuePath(lanePaths, wave.wave), docsQueue);
  const securitySummary = buildWaveSecuritySummary({
    lanePaths,
    wave,
    attempt,
    summariesByAgentId,
  });
  writeJsonArtifact(waveSecurityPath(lanePaths, wave.wave), securitySummary);
  writeTextAtomic(
    waveSecurityMarkdownPath(lanePaths, wave.wave),
    `${renderWaveSecuritySummaryMarkdown(securitySummary)}\n`,
  );
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
  writeJsonArtifact(waveIntegrationPath(lanePaths, wave.wave), integrationSummary);
  writeTextAtomic(
    waveIntegrationMarkdownPath(lanePaths, wave.wave),
    `${renderIntegrationSummaryMarkdown(integrationSummary)}\n`,
  );
  const ledger = deriveWaveLedger({
    lane: lanePaths.lane,
    wave,
    summariesByAgentId,
    coordinationState,
    integrationSummary,
    docsQueue,
    attempt,
    contQaAgentId: lanePaths.contQaAgentId,
    contEvalAgentId: lanePaths.contEvalAgentId,
    integrationAgentId: lanePaths.integrationAgentId,
    documentationAgentId: lanePaths.documentationAgentId,
    benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
    capabilityAssignments,
    dependencySnapshot,
  });
  writeWaveLedger(waveLedgerPath(lanePaths, wave.wave), ledger);
  const inboxDir = waveInboxDir(lanePaths, wave.wave);
  ensureDirectory(inboxDir);
  const sharedSummary = compileSharedSummary({
    wave,
    state: coordinationState,
    ledger,
    integrationSummary,
    capabilityAssignments,
    dependencySnapshot,
  });
  const sharedSummaryPath = path.join(inboxDir, "shared-summary.md");
  writeCompiledInbox(sharedSummaryPath, sharedSummary.text);
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
    writeCompiledInbox(inboxPath, inbox.text);
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
  writeCoordinationBoardProjection(messageBoardPath, {
    wave: wave.wave,
    waveFile: wave.file,
    agents: wave.agents,
    state: coordinationState,
    capabilityAssignments,
    dependencySnapshot,
  });
  return {
    coordinationLogPath,
    coordinationState,
    clarificationTriage,
    docsQueue,
    capabilityAssignments,
    dependencySnapshot,
    securitySummary,
    integrationSummary,
    integrationMarkdownPath: waveIntegrationMarkdownPath(lanePaths, wave.wave),
    securityMarkdownPath: waveSecurityMarkdownPath(lanePaths, wave.wave),
    ledger,
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
