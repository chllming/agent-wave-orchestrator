import path from "node:path";
import {
  writeAssignmentSnapshot,
  writeDependencySnapshot,
} from "./artifact-schemas.mjs";
import {
  syncGlobalWaveFromWaveDashboard,
  writeGlobalDashboard,
  writeWaveDashboard,
} from "./dashboard-state.mjs";
import { writeDocsQueue } from "./docs-queue.mjs";
import { writeWaveLedger } from "./ledger.mjs";
import { writeDependencySnapshotMarkdown } from "./routing-state.mjs";
import {
  writeCompiledInbox,
  writeCoordinationBoardProjection,
  writeJsonArtifact,
} from "./coordination-store.mjs";
import { parseStructuredSignalsFromLog } from "./dashboard-state.mjs";
import { readRunExecutionSummary } from "./gate-engine.mjs";
import { waveProofRegistryPath } from "./proof-registry.mjs";
import { relaunchReasonBuckets, writeWaveRelaunchPlan } from "./retry-engine.mjs";
import { toIsoTimestamp, writeTextAtomic } from "./shared.mjs";
import { buildQualityMetrics, writeTraceBundle } from "./traces.mjs";

export function writeWaveDerivedProjections({ lanePaths, wave, derivedState }) {
  if (!derivedState) {
    return null;
  }
  writeAssignmentSnapshot(derivedState.assignmentSnapshotPath, derivedState.capabilityAssignments, {
    lane: lanePaths.lane,
    wave: wave.wave,
  });
  writeDependencySnapshot(
    derivedState.dependencySnapshotPath,
    derivedState.dependencySnapshot,
    {
      lane: lanePaths.lane,
      wave: wave.wave,
    },
  );
  writeDependencySnapshotMarkdown(
    derivedState.dependencySnapshotMarkdownPath,
    derivedState.dependencySnapshot,
  );
  writeDocsQueue(derivedState.docsQueuePath, derivedState.docsQueue);
  writeJsonArtifact(derivedState.securitySummaryPath, derivedState.securitySummary);
  writeTextAtomic(
    derivedState.securityMarkdownPath,
    `${derivedState.securitySummary ? renderWaveSecuritySummaryMarkdown(derivedState.securitySummary) : ""}\n`,
  );
  writeJsonArtifact(derivedState.integrationSummaryPath, derivedState.integrationSummary);
  writeTextAtomic(
    derivedState.integrationMarkdownPath,
    `${derivedState.integrationSummary ? renderIntegrationSummaryMarkdown(derivedState.integrationSummary) : ""}\n`,
  );
  writeWaveLedger(derivedState.ledgerPath, derivedState.ledger);
  writeCompiledInbox(derivedState.sharedSummaryPath, derivedState.sharedSummaryText);
  for (const inbox of Object.values(derivedState.inboxesByAgentId || {})) {
    writeCompiledInbox(inbox.path, inbox.text);
  }
  writeCoordinationBoardProjection(derivedState.messageBoardPath, {
    wave: wave.wave,
    waveFile: wave.file,
    agents: wave.agents,
    state: derivedState.coordinationState,
    capabilityAssignments: derivedState.capabilityAssignments,
    dependencySnapshot: derivedState.dependencySnapshot,
  });
  return derivedState;
}

export function writeDashboardProjections({
  lanePaths,
  globalDashboard = null,
  dashboardState = null,
  dashboardPath = null,
}) {
  if (dashboardState && dashboardPath) {
    writeWaveDashboard(dashboardPath, dashboardState);
  }
  if (globalDashboard && dashboardState) {
    syncGlobalWaveFromWaveDashboard(globalDashboard, dashboardState);
  }
  if (globalDashboard) {
    writeGlobalDashboard(lanePaths.globalDashboardPath, globalDashboard);
  }
}

export function writeWaveAttemptTraceProjection({
  lanePaths,
  wave,
  attempt,
  launcherOptions,
  derivedState,
  manifest,
  agentRuns,
  gateSnapshot,
  tracesDir,
}) {
  const structuredSignals = Object.fromEntries(
    agentRuns.map((run) => [run.agent.agentId, parseStructuredSignalsFromLog(run.logPath)]),
  );
  const summariesByAgentId = Object.fromEntries(
    agentRuns
      .map((run) => [run.agent.agentId, readRunExecutionSummary(run, wave, { mode: "compat" })])
      .filter(([, summary]) => summary),
  );
  const traceDir = writeTraceBundle({
    tracesDir,
    lanePaths,
    launcherOptions,
    wave,
    attempt,
    manifest,
    coordinationLogPath: derivedState.coordinationLogPath,
    coordinationState: derivedState.coordinationState,
    ledger: derivedState.ledger,
    docsQueue: derivedState.docsQueue,
    capabilityAssignments: derivedState.capabilityAssignments,
    dependencySnapshot: derivedState.dependencySnapshot,
    securitySummary: derivedState.securitySummary,
    integrationSummary: derivedState.integrationSummary,
    integrationMarkdownPath: derivedState.integrationMarkdownPath,
    proofRegistryPath: lanePaths.proofDir ? waveProofRegistryPath(lanePaths, wave.wave) : null,
    controlPlanePath: path.join(lanePaths.controlPlaneDir, `wave-${wave.wave}.jsonl`),
    clarificationTriage: derivedState.clarificationTriage,
    agentRuns,
    structuredSignals,
    gateSnapshot,
    quality: buildQualityMetrics({
      tracesDir,
      wave,
      coordinationState: derivedState.coordinationState,
      integrationSummary: derivedState.integrationSummary,
      ledger: derivedState.ledger,
      docsQueue: derivedState.docsQueue,
      capabilityAssignments: derivedState.capabilityAssignments,
      dependencySnapshot: derivedState.dependencySnapshot,
      summariesByAgentId,
      agentRuns,
      gateSnapshot,
      attempt,
      coordinationLogPath: derivedState.coordinationLogPath,
    }),
  });
  return {
    traceDir,
    structuredSignals,
    summariesByAgentId,
  };
}

export function writeWaveRelaunchProjection({
  lanePaths,
  wave,
  attempt,
  runs,
  failures,
  derivedState,
}) {
  writeWaveRelaunchPlan(lanePaths, wave.wave, {
    wave: wave.wave,
    attempt,
    phase: derivedState?.ledger?.phase || null,
    selectedAgentIds: runs.map((run) => run.agent.agentId),
    reasonBuckets: relaunchReasonBuckets(runs, failures, derivedState),
    executorStates: Object.fromEntries(
      runs.map((run) => [run.agent.agentId, run.agent.executorResolved || null]),
    ),
    fallbackHistory: Object.fromEntries(
      runs.map((run) => [
        run.agent.agentId,
        run.agent.executorResolved?.executorHistory || [],
      ]),
    ),
    createdAt: toIsoTimestamp(),
  });
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
