import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CODEX_SANDBOX_MODE } from "../../scripts/wave-orchestrator/config.mjs";
import { buildCodexExecInvocation } from "../../scripts/wave-orchestrator/executors.mjs";
import { resolvePostDesignPassTransition } from "../../scripts/wave-orchestrator/launcher.mjs";
import {
  buildGateSnapshotPure,
  readWaveComponentGate,
  readWaveComponentMatrixGate,
  readWaveContEvalGate,
  readWaveContQaGate,
  readWaveSecurityGate,
} from "../../scripts/wave-orchestrator/gate-engine.mjs";
import { buildWaveIntegrationSummary } from "../../scripts/wave-orchestrator/derived-state-engine.mjs";
import {
  hasReusableSuccessStatus,
  persistedRelaunchPlanMatchesCurrentState,
  resetPersistedWaveLaunchState,
  resolveRelaunchRuns,
  resolveSharedComponentContinuationRuns,
  selectReusablePreCompletedAgentIds,
  selectInitialWaveRuns,
} from "../../scripts/wave-orchestrator/retry-engine.mjs";
import {
  acquireLauncherLock,
  cleanupLaunchedRun,
  collectUnexpectedSessionWarnings,
  markLauncherFailed,
  reconcileStaleLauncherArtifacts,
  releaseLauncherLock,
} from "../../scripts/wave-orchestrator/session-supervisor.mjs";
import {
  planClosureStages,
  readWaveInfraGate,
  runClosureSweepPhase,
  runClosureSweepPhase as runClosureSweepEnginePhase,
} from "../../scripts/wave-orchestrator/closure-engine.mjs";
import {
  formatReconcileBlockedWaveLine,
} from "../../scripts/wave-orchestrator/reconcile-format.mjs";
import { computeReducerSnapshot } from "../../scripts/wave-orchestrator/reducer-snapshot.mjs";
import {
  buildAgentResultEnvelope,
  writeAgentResultEnvelopeForRun,
} from "../../scripts/wave-orchestrator/result-envelope.mjs";
import { writeAgentExecutionSummary } from "../../scripts/wave-orchestrator/agent-state.mjs";
import {
  materializeCoordinationState,
  readMaterializedCoordinationState,
} from "../../scripts/wave-orchestrator/coordination-store.mjs";
import { hashAgentPromptFingerprint } from "../../scripts/wave-orchestrator/context7.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-launcher-"));
  tempDirs.push(dir);
  return dir;
}

function makeLanePaths(dir) {
  const dashboardsDir = path.join(dir, "dashboards");
  const logsDir = path.join(dir, "logs");
  const promptsDir = path.join(dir, "prompts");
  const statusDir = path.join(dir, "status");
  const controlDir = path.join(dir, "control");
  const controlPlaneDir = path.join(dir, "control-plane");
  const coordinationDir = path.join(dir, "coordination");
  const feedbackRequestsDir = path.join(dir, "feedback", "requests");
  const stateDir = path.join(dir, "state");
  const resultsDir = path.join(dir, "results");
  fs.mkdirSync(dashboardsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(statusDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });
  fs.mkdirSync(controlPlaneDir, { recursive: true });
  fs.mkdirSync(coordinationDir, { recursive: true });
  fs.mkdirSync(feedbackRequestsDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(resultsDir, { recursive: true });
  return {
    lane: "leap-claw",
    launcherLockPath: path.join(dir, "launcher.lock"),
    globalDashboardPath: path.join(dashboardsDir, "global.json"),
    dashboardsDir,
    terminalsPath: path.join(dir, "terminals.json"),
    terminalNamePrefix: "leap-claw-wave",
    dashboardTerminalNamePrefix: "leap-claw-wave-dashboard",
    globalDashboardTerminalName: "leap-claw-wave-dashboard-global",
    tmuxSessionPrefix: "oc_leap_claw_wave",
    tmuxDashboardSessionPrefix: "oc_leap_claw_wave_dashboard",
    tmuxGlobalDashboardSessionPrefix: "oc_leap_claw_wave_dashboard_global",
    tmuxSocketName: `test-${path.basename(dir)}`,
    promptsDir,
    logsDir,
    statusDir,
    stateDir,
    controlDir,
    controlPlaneDir,
    coordinationDir,
    feedbackRequestsDir,
    resultsDir,
    integrationAgentId: "A8",
    documentationAgentId: "A9",
    contQaAgentId: "A0",
    securityRolePromptPath: "docs/agents/wave-security-role.md",
    laneProfile: {
      runtimePolicy: {
        runtimeMixTargets: {},
      },
      validation: {
        requireComponentPromotionsFromWave: 0,
      },
    },
    capabilityRouting: { preferredAgents: {} },
  };
}

function makeRunInfo(agentId, statusPath, logPath, extra = {}) {
  const { agent: agentOverrides = {}, ...rest } = extra;
  return {
    agent: {
      agentId,
      ...agentOverrides,
    },
    lane: rest.lane || "leap-claw",
    wave: rest.wave ?? 0,
    resultsDir: rest.resultsDir || path.join(path.dirname(statusPath), "results"),
    statusPath,
    logPath,
    summaryPath: rest.summaryPath || null,
    ...rest,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readWaveContQaGate", () => {
  it("prefers structured cont-qa summaries when present", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-6-cont-qa.md");
    const logPath = path.join(dir, "wave-6-a0.log");
    const statusPath = path.join(dir, "wave-6-a0.status");
    const summaryPath = path.join(dir, "wave-6-a0.summary.json");

    fs.writeFileSync(reportPath, "# Review\n\nVerdict: PASS\n", "utf8");
    fs.writeFileSync(logPath, "[wave-verdict] pass detail=legacy-pass\n", "utf8");
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "hash" }, null, 2), "utf8");
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          agentId: "A0",
          verdict: { verdict: "pass", detail: "final closure sweep" },
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
            detail: "final closure sweep",
          },
          logPath,
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      readWaveContQaGate(
        {
          contQaReportPath: reportPath,
        },
        [
          {
            agent: { agentId: "A0" },
            logPath,
            statusPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
      detail: "final closure sweep",
    });
  });

  it("normalizes legacy HOLD verdicts from cont-qa reports", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-0-cont-qa.md");
    const logPath = path.join(dir, "wave-0-a0.log");

    fs.writeFileSync(reportPath, "# Review\n\nVerdict: HOLD - waiting on QA\n", "utf8");
    fs.writeFileSync(logPath, "", "utf8");

    expect(
      readWaveContQaGate(
        {
          contQaReportPath: reportPath,
        },
        [
          {
            agent: { agentId: "A0" },
            logPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: false,
      agentId: "A0",
      statusCode: "cont-qa-hold",
      detail: "waiting on QA",
    });
  });

  it("falls back to wave verdict markers in the cont-qa log", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-0-a0.log");

    fs.writeFileSync(logPath, "[wave-verdict] fail detail=tests-broken\n", "utf8");

    expect(
      readWaveContQaGate(
        {
          contQaReportPath: path.join(dir, "missing.md"),
        },
        [
          {
            agent: { agentId: "A0" },
            logPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: false,
      agentId: "A0",
      statusCode: "cont-qa-blocked",
      detail: "tests-broken",
    });
  });

  it("fails live cont-qa validation when only a verdict-only report exists", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-0-cont-qa.md");
    const logPath = path.join(dir, "wave-0-a0.log");
    const statusPath = path.join(dir, "wave-0-a0.status");

    fs.writeFileSync(reportPath, "# Review\n\nVerdict: PASS\n", "utf8");
    fs.writeFileSync(logPath, "[wave-verdict] pass detail=legacy-pass\n", "utf8");
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "hash" }, null, 2), "utf8");

    expect(
      readWaveContQaGate(
        {
          contQaReportPath: reportPath,
        },
        [
          {
            agent: { agentId: "A0" },
            logPath,
            statusPath,
          },
        ],
        { mode: "live" },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-result-envelope",
    });
  });
});

describe("readWaveContEvalGate", () => {
  it("fails live cont-EVAL validation when the eval marker does not enumerate target ids", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-4-cont-eval.md");
    const logPath = path.join(dir, "wave-4-e0.log");
    const statusPath = path.join(dir, "wave-4-e0.status");

    fs.writeFileSync(reportPath, "# cont-EVAL\n", "utf8");
    fs.writeFileSync(
      logPath,
      "[wave-eval] state=satisfied targets=1 benchmarks=1 regressions=0 benchmark_ids=golden-response-smoke detail=bad-marker\n",
      "utf8",
    );
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "hash" }, null, 2), "utf8");

    expect(
      readWaveContEvalGate(
        {
          wave: 4,
          contEvalReportPath: reportPath,
          evalTargets: [
            {
              id: "response-quality",
              selection: "delegated",
              benchmarkFamily: "service-output",
              benchmarks: [],
              objective: "Tune response quality",
              threshold: "Golden response smoke passes",
            },
          ],
        },
        [
          {
            agent: { agentId: "E0" },
            logPath,
            statusPath,
          },
        ],
        {
          mode: "live",
          benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-result-envelope",
    });
  });

  it("requires canonical live cont-EVAL envelopes instead of lazy materialization", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-4-cont-eval.md");
    const logPath = path.join(dir, "wave-4-e0.log");
    const statusPath = path.join(dir, "wave-4-e0.status");

    fs.writeFileSync(reportPath, "# cont-EVAL\n", "utf8");
    fs.writeFileSync(
      logPath,
      "[wave-eval] state=satisfied targets=1 benchmarks=1 regressions=0 target_ids=response-quality benchmark_ids=golden-response-smoke detail=ready\n",
      "utf8",
    );
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "hash" }, null, 2), "utf8");

    expect(
      readWaveContEvalGate(
        {
          wave: 4,
          contEvalReportPath: reportPath,
          evalTargets: [
            {
              id: "response-quality",
              selection: "delegated",
              benchmarkFamily: "service-output",
              benchmarks: [],
              objective: "Tune response quality",
              threshold: "Golden response smoke passes",
            },
          ],
        },
        [
          {
            agent: { agentId: "E0" },
            logPath,
            statusPath,
          },
        ],
        {
          mode: "live",
          benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-result-envelope",
    });
  });

  it("prefers result envelopes over stale legacy summaries", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-4-cont-eval.md");
    const logPath = path.join(dir, "wave-4-e0.log");
    const statusPath = path.join(dir, "wave-4-e0.status");

    fs.writeFileSync(reportPath, "# cont-EVAL\n", "utf8");
    fs.writeFileSync(logPath, "[wave-eval] state=blocked targets=0 benchmarks=0 regressions=0 detail=stale-log\n", "utf8");
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "hash" }, null, 2), "utf8");
    writeAgentExecutionSummary(statusPath, {
      agentId: "E0",
      eval: {
        state: "blocked",
        targets: 0,
        benchmarks: 0,
        regressions: 0,
        targetIds: [],
        benchmarkIds: [],
        detail: "Stale summary should be ignored.",
      },
      reportPath,
    });
    writeAgentResultEnvelopeForRun(
      makeRunInfo("E0", statusPath, logPath, {
        wave: 4,
      }),
      {
        wave: 4,
        lane: "main",
      },
      buildAgentResultEnvelope(
        { agentId: "E0", role: "cont-eval" },
        {
          agentId: "E0",
          eval: {
            state: "satisfied",
            targets: 1,
            benchmarks: 1,
            regressions: 0,
            targetIds: ["response-quality"],
            benchmarkIds: ["golden-response-smoke"],
            detail: "Envelope is authoritative.",
          },
        },
      ),
    );

    expect(
      readWaveContEvalGate(
        {
          wave: 4,
          contEvalReportPath: reportPath,
          evalTargets: [
            {
              id: "response-quality",
              selection: "delegated",
              benchmarkFamily: "service-output",
              benchmarks: [],
              objective: "Tune response quality",
              threshold: "Golden response smoke passes",
            },
          ],
        },
        [
          {
            agent: { agentId: "E0" },
            logPath,
            statusPath,
          },
        ],
        {
          mode: "live",
          benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
        },
      ),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
      detail: "Envelope is authoritative.",
    });
  });
});

describe("readWaveInfraGate", () => {
  it("treats setup-oriented infra states as non-blocking runtime signals", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-4-a7.log");

    fs.writeFileSync(
      logPath,
      "[infra-status] kind=dependency target=leapclaw-provider-01 state=setup-required detail=bootstrap task still owned by Wave 4\n",
      "utf8",
    );

    expect(
      readWaveInfraGate([
        {
          agent: { agentId: "A7" },
          logPath,
        },
      ]),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
    });
  });
});

describe("readWaveSecurityGate", () => {
  it("fails when a security reviewer reports blocked", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-0-security-review.md");
    const logPath = path.join(dir, "wave-0-a7.log");
    const statusPath = path.join(dir, "wave-0-a7.status");

    fs.writeFileSync(reportPath, "# Security Review\n", "utf8");
    fs.writeFileSync(
      logPath,
      "[wave-security] state=blocked findings=1 approvals=0 detail=unreviewed-authz-regression\n",
      "utf8",
    );
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ code: 0, promptHash: "hash", attempt: 1 }, null, 2),
      "utf8",
    );
    const runInfo = makeRunInfo("A7", statusPath, logPath, {
      wave: 0,
      agent: {
        title: "Security Engineer",
        rolePromptPaths: ["docs/agents/wave-security-role.md"],
        ownedPaths: [path.relative(process.cwd(), reportPath)],
      },
    });
    writeAgentResultEnvelopeForRun(
      runInfo,
      { wave: 0, lane: "main" },
      buildAgentResultEnvelope(
        { agentId: "A7", role: "security" },
        {
          agentId: "A7",
          security: {
            state: "blocked",
            findings: 1,
            approvals: 0,
            detail: "unreviewed-authz-regression",
          },
        },
      ),
      { statusRecord: { attempt: 1 } },
    );

    expect(
      readWaveSecurityGate(
        {
          wave: 0,
        },
        [runInfo],
      ),
    ).toMatchObject({
      ok: false,
      agentId: "A7",
      statusCode: "security-blocked",
    });
  });

  it("recognizes security reviewers declared through a custom lane security prompt path", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-0-security-review.md");
    const logPath = path.join(dir, "wave-0-a7.log");
    const statusPath = path.join(dir, "wave-0-a7.status");

    fs.writeFileSync(reportPath, "# Security Review\n", "utf8");
    fs.writeFileSync(
      logPath,
      "[wave-security] state=clear findings=0 approvals=0 detail=custom-security-role\n",
      "utf8",
    );
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ code: 0, promptHash: "hash", attempt: 1 }, null, 2),
      "utf8",
    );
    const runInfo = makeRunInfo("A7", statusPath, logPath, {
      wave: 0,
      agent: {
        title: "Security Engineer",
        rolePromptPaths: ["docs/agents/custom-security-role.md"],
        ownedPaths: [path.relative(process.cwd(), reportPath)],
      },
    });
    writeAgentResultEnvelopeForRun(
      runInfo,
      { wave: 0, lane: "main" },
      buildAgentResultEnvelope(
        { agentId: "A7", role: "security" },
        {
          agentId: "A7",
          security: {
            state: "clear",
            findings: 0,
            approvals: 0,
            detail: "custom-security-role",
          },
        },
      ),
      { statusRecord: { attempt: 1 } },
    );

    expect(
      readWaveSecurityGate(
        {
          wave: 0,
        },
        [runInfo],
        { securityRolePromptPath: "docs/agents/custom-security-role.md" },
      ),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
    });
  });
});

describe("buildWaveIntegrationSummary", () => {
  it("derives actionable integration evidence from coordination, docs, validation, and runtime signals", () => {
    const dir = makeTempDir();
    const a1LogPath = path.join(dir, "wave-0-a1.log");
    const a2LogPath = path.join(dir, "wave-0-a2.log");
    fs.writeFileSync(
      a1LogPath,
      "[deploy-status] service=api state=failed detail=healthcheck-failed\n",
      "utf8",
    );
    fs.writeFileSync(
      a2LogPath,
      "[infra-status] kind=dependency target=database state=setup-required detail=waiting-on-operator\n",
      "utf8",
    );

    const wave = {
      wave: 0,
      agents: [
        {
          agentId: "A1",
          title: "Runtime",
          ownedPaths: ["src/runtime"],
          exitContract: {
            completion: "integrated",
            durability: "durable",
            proof: "integration",
            docImpact: "shared-plan",
          },
        },
        {
          agentId: "A2",
          title: "UI",
          ownedPaths: ["src/ui"],
          components: ["ui-shell"],
        },
        { agentId: "A8", title: "Integration" },
        { agentId: "A9", title: "Docs" },
        { agentId: "A0", title: "cont-QA" },
      ],
    };
    const coordinationState = materializeCoordinationState([
      {
        id: "claim-conflict",
        kind: "claim",
        lane: "main",
        wave: 0,
        agentId: "A1",
        targets: [],
        status: "open",
        priority: "high",
        artifactRefs: ["runtime-engine"],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "medium",
        summary: "Runtime contract conflicts with UI expectations",
        detail: "Conflicting interface contract remains open.",
        source: "agent",
      },
      {
        id: "block-release",
        kind: "blocker",
        lane: "main",
        wave: 0,
        agentId: "A2",
        targets: [],
        status: "open",
        priority: "high",
        artifactRefs: ["ui-shell"],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "medium",
        summary: "Release blocker remains open",
        detail: "Need rollout proof before release.",
        source: "agent",
      },
      {
        id: "decision-interface",
        kind: "decision",
        lane: "main",
        wave: 0,
        agentId: "A8",
        targets: ["agent:A1", "agent:A2"],
        status: "resolved",
        priority: "normal",
        artifactRefs: ["runtime-engine", "ui-shell"],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "high",
        summary: "Interface contract changed between runtime and UI",
        detail: "Cross-component interface update requires coordinated rollout.",
        source: "agent",
      },
    ]);

    const integrationSummary = buildWaveIntegrationSummary({
      lanePaths: makeLanePaths(dir),
      wave,
      attempt: 1,
      coordinationState,
      summariesByAgentId: {
        A1: {
          gaps: [{ kind: "integration", detail: "Need end-to-end runtime proof." }],
        },
        A2: {
          gaps: [{ kind: "ops", detail: "Operational rollout evidence is still missing." }],
        },
      },
      docsQueue: {
        items: [
          {
            id: "A1:shared:docs/plans/master-plan.md",
            summary: "Shared-plan reconciliation required in docs/plans/master-plan.md",
          },
        ],
      },
      runtimeAssignments: [],
      agentRuns: [
        { agent: { agentId: "A1" }, logPath: a1LogPath },
        { agent: { agentId: "A2" }, logPath: a2LogPath },
      ],
    });

    expect(integrationSummary.recommendation).toBe("needs-more-work");
    expect(integrationSummary.openClaims).toContain(
      "claim-conflict: Runtime contract conflicts with UI expectations",
    );
    expect(integrationSummary.conflictingClaims[0]).toContain("claim-conflict:");
    expect(integrationSummary.unresolvedBlockers[0]).toContain("block-release:");
    expect(
      integrationSummary.changedInterfaces.some((entry) => entry.includes("decision-interface:")),
    ).toBe(true);
    expect(
      integrationSummary.crossComponentImpacts.some((entry) => entry.includes("[owners: A1, A2]")),
    ).toBe(true);
    expect(integrationSummary.proofGaps.some((entry) => entry.includes("Need end-to-end runtime proof."))).toBe(
      true,
    );
    expect(
      integrationSummary.docGaps.some((entry) =>
        entry.includes("A1:shared:docs/plans/master-plan.md"),
      ),
    ).toBe(true);
    expect(
      integrationSummary.deployRisks.some((entry) => entry.includes("Deployment api ended in state failed")),
    ).toBe(true);
    expect(
      integrationSummary.deployRisks.some((entry) =>
        entry.includes("Infra dependency on database ended in state setup-required"),
      ),
    ).toBe(true);
  });

  it("keeps the integration steward recommendation authoritative while enriching supporting evidence", () => {
    const dir = makeTempDir();
    const wave = {
      wave: 0,
      agents: [
        {
          agentId: "A1",
          title: "Runtime",
          ownedPaths: ["src/runtime"],
          components: ["runtime-engine"],
          exitContract: {
            completion: "integrated",
            durability: "durable",
            proof: "integration",
            docImpact: "shared-plan",
          },
        },
        { agentId: "A8", title: "Integration" },
        { agentId: "A9", title: "Docs" },
        { agentId: "A0", title: "cont-QA" },
      ],
    };

    const integrationSummary = buildWaveIntegrationSummary({
      lanePaths: makeLanePaths(dir),
      wave,
      attempt: 2,
      coordinationState: materializeCoordinationState([]),
      summariesByAgentId: {
        A1: {
          proof: {
            completion: "integrated",
            durability: "durable",
            proof: "integration",
            state: "met",
            detail: "",
          },
          docDelta: {
            state: "shared-plan",
            paths: ["docs/plans/master-plan.md"],
            detail: "Update shared plan docs.",
          },
          gaps: [{ kind: "integration", detail: "Need integration proof." }],
        },
        A8: {
          integration: {
            state: "ready-for-doc-closure",
            claims: 1,
            conflicts: 2,
            blockers: 1,
            detail: "Integration steward signed off the wave.",
          },
        },
      },
      docsQueue: { items: [] },
      runtimeAssignments: [],
      agentRuns: [],
    });

    expect(integrationSummary.recommendation).toBe("ready-for-doc-closure");
    expect(integrationSummary.detail).toBe("Integration steward signed off the wave.");
    expect(integrationSummary.openClaims).toHaveLength(1);
    expect(integrationSummary.conflictingClaims).toHaveLength(2);
    expect(integrationSummary.unresolvedBlockers).toHaveLength(1);
    expect(
      integrationSummary.proofGaps.some((entry) => entry.includes("Need integration proof.")),
    ).toBe(true);
  });

  it("honors a wave-specific integration steward when building integration summaries", () => {
    const dir = makeTempDir();
    const wave = {
      wave: 8,
      integrationAgentId: "I8",
      agents: [
        { agentId: "A1", title: "Implementation" },
        { agentId: "I8", title: "Integration" },
        { agentId: "A0", title: "cont-QA" },
      ],
    };

    const integrationSummary = buildWaveIntegrationSummary({
      lanePaths: makeLanePaths(dir),
      wave,
      attempt: 1,
      coordinationState: materializeCoordinationState([]),
      summariesByAgentId: {
        I8: {
          integration: {
            state: "ready-for-doc-closure",
            claims: 0,
            conflicts: 0,
            blockers: 0,
            detail: "Wave-specific steward is authoritative.",
          },
        },
      },
      docsQueue: { items: [] },
      runtimeAssignments: [],
      agentRuns: [],
    });

    expect(integrationSummary.agentId).toBe("I8");
    expect(integrationSummary.recommendation).toBe("ready-for-doc-closure");
    expect(integrationSummary.detail).toBe("Wave-specific steward is authoritative.");
  });

  it("surfaces advisory security concerns without turning them into an automatic integration blocker", () => {
    const dir = makeTempDir();
    const wave = {
      wave: 0,
      agents: [
        {
          agentId: "A1",
          title: "Runtime",
          ownedPaths: ["src/runtime"],
          components: ["runtime-engine"],
          exitContract: {
            completion: "integrated",
            durability: "durable",
            proof: "integration",
            docImpact: "owned",
          },
        },
        {
          agentId: "A7",
          title: "Security Engineer",
          rolePromptPaths: ["docs/agents/wave-security-role.md"],
          ownedPaths: [".tmp/main-wave-launcher/security/wave-0-review.md"],
        },
        { agentId: "A8", title: "Integration" },
        { agentId: "A9", title: "Docs" },
        { agentId: "A0", title: "cont-QA" },
      ],
    };

    const integrationSummary = buildWaveIntegrationSummary({
      lanePaths: makeLanePaths(dir),
      wave,
      attempt: 1,
      coordinationState: materializeCoordinationState([]),
      summariesByAgentId: {
        A1: {
          proof: {
            completion: "integrated",
            durability: "durable",
            proof: "integration",
            state: "met",
            detail: "",
          },
          docDelta: {
            state: "owned",
            paths: [],
            detail: "",
          },
        },
        A8: {
          integration: {
            state: "ready-for-doc-closure",
            claims: 0,
            conflicts: 0,
            blockers: 0,
            detail: "Security concerns are advisory for this wave.",
          },
        },
      },
      docsQueue: { items: [] },
      runtimeAssignments: [],
      agentRuns: [],
      securitySummary: {
        overallState: "concerns",
        agents: [
          {
            agentId: "A7",
            state: "concerns",
            findings: 2,
            approvals: 1,
            detail: "manual review required for auth boundary changes",
          },
        ],
      },
    });

    expect(integrationSummary.recommendation).toBe("ready-for-doc-closure");
    expect(integrationSummary.securityState).toBe("concerns");
    expect(integrationSummary.securityFindings[0]).toContain("A7:");
    expect(integrationSummary.securityApprovals[0]).toContain("A7:");
  });

  it("keeps gate snapshots aligned when inferred integration and doc no-change are auto-satisfied", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.gateModeThresholds = { bootstrap: 0, standard: 4, strict: 10 };
    lanePaths.autoClosure = {
      allowInferredIntegration: true,
      allowAutoDocNoChange: true,
      allowAutoDocProjection: false,
      allowSkipContQaInBootstrap: false,
    };
    lanePaths.laneProfile.validation.autoClosure = lanePaths.autoClosure;

    const gateSnapshot = buildGateSnapshotPure({
      wave: {
        wave: 4,
        agents: [{ agentId: "A8" }, { agentId: "A9" }, { agentId: "A0" }],
        integrationAgentId: "A8",
        documentationAgentId: "A9",
        contQaAgentId: "A0",
      },
      agentResults: {
        A0: {
          verdict: { verdict: "pass", detail: "ready" },
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
            detail: "ready",
          },
        },
      },
      derivedState: {
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "Inferred integration is coherent.",
          openClaims: [],
          conflictingClaims: [],
          unresolvedBlockers: [],
          changedInterfaces: [],
          crossComponentImpacts: [],
          proofGaps: [],
          docGaps: [],
          deployRisks: [],
          inboundDependencies: [],
          outboundDependencies: [],
          helperAssignments: [],
        },
        docsQueue: { items: [] },
        coordinationState: {
          clarifications: [],
          humanEscalations: [],
          humanFeedback: [],
        },
        capabilityAssignments: [],
        dependencySnapshot: {
          openInbound: [],
          openOutbound: [],
          unresolvedInboundAssignments: [],
        },
        clarificationBarrier: { ok: true, statusCode: "pass", detail: "" },
        helperAssignmentBarrier: { ok: true, statusCode: "pass", detail: "" },
        dependencyBarrier: { ok: true, statusCode: "pass", detail: "" },
      },
      validationMode: "compat",
      laneConfig: {
        gateMode: "standard",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        documentationAgentId: "A9",
        requireIntegrationStewardFromWave: 0,
        laneProfile: lanePaths.laneProfile,
        autoClosure: lanePaths.autoClosure,
      },
    });

    expect(gateSnapshot.integrationGate).toMatchObject({
      ok: true,
      agentId: null,
      integrationState: "inferred",
    });
    expect(gateSnapshot.documentationGate).toMatchObject({
      ok: true,
      agentId: null,
      docClosureState: "no-change",
    });
    expect(gateSnapshot.overall).toMatchObject({
      ok: true,
      statusCode: "pass",
    });
  });
});

describe("resolveRelaunchRuns", () => {
  it("does not treat launcher-seeded assignment requests as retry targets", () => {
    const agentRuns = [
      { agent: { agentId: "A1", capabilities: ["runtime"] } },
      { agent: { agentId: "A2", capabilities: ["docs"] } },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A2", statusCode: "failed" }],
      {
        coordinationState: {
          humanFeedback: [],
          requests: [
            {
              id: "wave-0-agent-A1-request",
              kind: "request",
              source: "launcher",
              status: "open",
              targets: ["agent:A1"],
            },
          ],
          blockers: [],
        },
        ledger: { phase: "running", tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A2"]);
  });

  it("routes capability-targeted retries to the least-busy matching agent", () => {
    const agentRuns = [
      { agent: { agentId: "A1", capabilities: ["runtime"] } },
      { agent: { agentId: "A2", capabilities: ["runtime"] } },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A1", statusCode: "failed" }],
      {
        coordinationState: {
          humanFeedback: [],
          requests: [
            {
              id: "request-runtime",
              kind: "request",
              source: "agent",
              status: "open",
              targets: ["capability:runtime"],
            },
          ],
          blockers: [],
        },
        ledger: {
          phase: "running",
          tasks: [
            { id: "t1", owner: "A1", state: "in_progress" },
            { id: "t2", owner: "A1", state: "planned" },
            { id: "t3", owner: "A2", state: "in_progress" },
          ],
        },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A2"]);
  });

  it("prefers same-wave capability owners before least-busy fallback", () => {
    const agentRuns = [
      { agent: { agentId: "A1", capabilities: ["runtime"] } },
      { agent: { agentId: "A2", capabilities: ["runtime"] } },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A2", statusCode: "failed" }],
      {
        coordinationState: {
          humanFeedback: [],
          requests: [
            {
              id: "request-runtime",
              kind: "request",
              source: "agent",
              status: "open",
              targets: ["capability:runtime"],
            },
          ],
          blockers: [],
        },
        ledger: {
          phase: "running",
          tasks: [
            { id: "done-1", owner: "A1", state: "done", capability: "docs" },
            { id: "t3", owner: "A1", state: "in_progress" },
          ],
          capabilityAssignments: [
            {
              id: "assignment-runtime-a1",
              assignedAgentId: "A1",
              capability: "runtime",
              state: "resolved",
            },
          ],
        },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A1"]);
  });

  it("halts retries while human escalation remains unresolved", () => {
    const agentRuns = [{ agent: { agentId: "A1", capabilities: ["runtime"] } }];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A1", statusCode: "failed" }],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [
            {
              id: "escalation-1",
              kind: "human-escalation",
              status: "open",
              targets: ["agent:A1"],
            },
          ],
          requests: [],
          blockers: [],
        },
        ledger: { phase: "running", tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected).toEqual({ runs: [], barrier: null });
  });

  it("does not halt retries for non-blocking human escalations", () => {
    const agentRuns = [{ agent: { agentId: "A1", capabilities: ["runtime"] } }];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A1", statusCode: "failed" }],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [
            {
              id: "escalation-1",
              kind: "human-escalation",
              status: "open",
              blocking: false,
              blockerSeverity: "advisory",
              targets: ["agent:A1"],
            },
          ],
          requests: [],
          blockers: [],
        },
        ledger: { phase: "running", tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A1"]);
  });

  it("prioritizes launcher-routed clarification follow-up requests", () => {
    const agentRuns = [
      { agent: { agentId: "A1", capabilities: ["runtime"] } },
      { agent: { agentId: "A9", capabilities: ["docs-shared-plan"] } },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A1", statusCode: "failed" }],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [],
          clarifications: [
            {
              id: "clarify-docs",
              kind: "clarification-request",
              status: "in_progress",
            },
          ],
          requests: [
            {
              id: "route-clarify-docs-1",
              kind: "request",
              source: "launcher",
              status: "open",
              targets: ["agent:A9"],
              dependsOn: ["clarify-docs"],
              closureCondition: "clarification:clarify-docs",
            },
          ],
          blockers: [],
        },
        ledger: { phase: "clarifying", tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        laneProfile: { runtimePolicy: { runtimeMixTargets: {} } },
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A9"]);
  });

  it("uses reducer capability assignments as the authoritative relaunch source when provided", () => {
    const agentRuns = [
      { agent: { agentId: "A1", capabilities: ["runtime"] } },
      { agent: { agentId: "A2", capabilities: ["docs"] } },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A1", statusCode: "failed" }],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [],
          requests: [],
          blockers: [],
        },
        capabilityAssignments: [],
        dependencySnapshot: {
          openInbound: [],
          unresolvedInboundAssignments: [],
        },
        ledger: { phase: "running", attempt: 1, tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        capabilityRouting: { preferredAgents: {} },
      },
      { wave: 0, agents: [{ agentId: "A1" }, { agentId: "A2" }] },
      {
        waveState: {
          wave: 0,
          lane: "leap-claw",
          coordinationState: {
            humanFeedback: [],
            humanEscalations: [],
            blockers: [],
            clarifications: [],
            requests: [],
          },
          capabilityAssignments: [
            {
              requestId: "request-docs",
              assignedAgentId: "A2",
              blocking: true,
            },
          ],
          dependencySnapshot: {
            openInbound: [],
            unresolvedInboundAssignments: [],
          },
          retryTargetSet: {
            agentIds: ["A1"],
            targets: [{ agentId: "A1", reason: "owned-slice-not-proven" }],
          },
          openBlockers: [],
          closureEligibility: {
            waveMayClose: false,
            pendingAgentIds: ["A1"],
            ownedSliceProvenAgentIds: [],
          },
          gateSnapshot: {
            overall: {
              ok: false,
              gate: "helperAssignmentBarrier",
              statusCode: "helper-assignment-open",
              detail: "Helper assignments remain open.",
              agentId: null,
            },
            helperAssignmentBarrier: {
              ok: false,
              statusCode: "helper-assignment-open",
              detail: "Helper assignments remain open.",
            },
          },
        },
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A2"]);
  });

  it("uses wave-specific integration stewards for reducer snapshots and integrating resume targets", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const componentMatrixJsonPath = path.join(dir, "component-cutover-matrix.json");
    const componentMatrixDocPath = path.join(dir, "component-cutover-matrix.md");
    fs.writeFileSync(
      componentMatrixJsonPath,
      JSON.stringify({ levels: ["repo-landed"], components: {} }, null, 2),
      "utf8",
    );
    fs.writeFileSync(componentMatrixDocPath, "# Component Matrix\n", "utf8");
    lanePaths.componentCutoverMatrixJsonPath = componentMatrixJsonPath;
    lanePaths.componentCutoverMatrixDocPath = componentMatrixDocPath;
    lanePaths.laneProfile.validation.requireComponentPromotionsFromWave = 99;
    lanePaths.laneProfile.paths = {
      componentCutoverMatrixJsonPath: componentMatrixJsonPath,
      componentCutoverMatrixDocPath: componentMatrixDocPath,
    };
    const wave = {
      wave: 11,
      integrationAgentId: "I8",
      agents: [
        {
          agentId: "A1",
          title: "Implementation",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "none",
          },
        },
        { agentId: "I8", title: "Integration" },
        { agentId: "A9", title: "Docs" },
        { agentId: "A0", title: "cont-QA" },
      ],
      componentPromotions: [],
    };
    const i8StatusPath = path.join(lanePaths.statusDir, "wave-11-i8.status");
    const i8LogPath = path.join(lanePaths.logsDir, "wave-11-i8.log");
    fs.mkdirSync(path.dirname(i8StatusPath), { recursive: true });
    fs.mkdirSync(path.dirname(i8LogPath), { recursive: true });
    fs.writeFileSync(
      i8StatusPath,
      JSON.stringify({ code: 0, promptHash: "hash-i8", attempt: 1 }, null, 2),
      "utf8",
    );
    fs.writeFileSync(i8LogPath, "", "utf8");

    const integrationRun = makeRunInfo("I8", i8StatusPath, i8LogPath, {
      lane: lanePaths.lane,
      wave: 11,
      resultsDir: lanePaths.resultsDir,
      agent: wave.agents[1],
    });
    writeAgentResultEnvelopeForRun(
      integrationRun,
      wave,
      buildAgentResultEnvelope(
        { agentId: "I8", role: "integration" },
        {
          agentId: "I8",
          integration: {
            state: "needs-review",
            claims: 0,
            conflicts: 0,
            blockers: 0,
            detail: "Integration steward ran.",
          },
        },
      ),
      { statusRecord: { attempt: 1 } },
    );

    const agentRuns = [
      makeRunInfo(
        "A1",
        path.join(lanePaths.statusDir, "wave-11-a1.status"),
        path.join(lanePaths.logsDir, "wave-11-a1.log"),
        {
          lane: lanePaths.lane,
          wave: 11,
          resultsDir: lanePaths.resultsDir,
          agent: wave.agents[0],
        },
      ),
      integrationRun,
      makeRunInfo(
        "A9",
        path.join(lanePaths.statusDir, "wave-11-a9.status"),
        path.join(lanePaths.logsDir, "wave-11-a9.log"),
        {
          lane: lanePaths.lane,
          wave: 11,
          resultsDir: lanePaths.resultsDir,
          agent: wave.agents[2],
        },
      ),
      makeRunInfo(
        "A0",
        path.join(lanePaths.statusDir, "wave-11-a0.status"),
        path.join(lanePaths.logsDir, "wave-11-a0.log"),
        {
          lane: lanePaths.lane,
          wave: 11,
          resultsDir: lanePaths.resultsDir,
          agent: wave.agents[3],
        },
      ),
    ];

    fs.writeFileSync(
      agentRuns[0].statusPath,
      JSON.stringify({ code: 0, promptHash: "hash-a1", attempt: 1 }, null, 2),
      "utf8",
    );
    fs.writeFileSync(agentRuns[0].logPath, "", "utf8");

    writeAgentResultEnvelopeForRun(
      agentRuns[0],
      wave,
      buildAgentResultEnvelope(
        {
          agentId: "A1",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "none",
          },
        },
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "none",
            paths: [],
          },
        },
      ),
      { statusRecord: { attempt: 1 } },
    );

    const derivedState = {
      ledger: { attempt: 1, phase: "integrating" },
      coordinationState: materializeCoordinationState([]),
      capabilityAssignments: [],
      dependencySnapshot: null,
      integrationSummary: {
        recommendation: "needs-review",
        detail: "Integration steward still needs to reconcile output.",
      },
    };

    const snapshot = computeReducerSnapshot({
      lanePaths,
      wave,
      agentRuns,
      derivedState,
      attempt: 1,
      options: { orchestratorId: "orch" },
    });

    expect(snapshot.reducerState.gateSnapshot.integrationGate.agentId).toBe("I8");
    expect(snapshot.resumePlan.resumeFromPhase).toBe("integrating");

    const relaunch = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "I8", statusCode: "integration-needs-more-work", logPath: "logs/wave-11-i8.log" }],
      derivedState,
      lanePaths,
      wave,
      { waveState: snapshot.reducerState },
    );

    expect(relaunch.runs.map((run) => run.agent.agentId)).toEqual(["I8"]);
  });

  it("retries only waiting sibling owners for shared promoted components", () => {
    const agentRuns = [
      { agent: { agentId: "A1", capabilities: ["runtime"] } },
      { agent: { agentId: "A2", capabilities: ["runtime"] } },
      { agent: { agentId: "A3", capabilities: ["runtime"] } },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [
        {
          agentId: "A2",
          statusCode: "shared-component-sibling-pending",
          componentId: "rollout-cores-and-cluster-view",
          satisfiedAgentIds: ["A1"],
          waitingOnAgentIds: ["A2", "A3"],
        },
      ],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [],
          clarifications: [],
          requests: [],
          blockers: [],
        },
        capabilityAssignments: [],
        dependencySnapshot: {
          openInbound: [],
        },
        ledger: { phase: "running", attempt: 1, tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        laneProfile: {
          runtimePolicy: {
            runtimeMixTargets: {},
          },
        },
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A2", "A3"]);
  });

  it("continues shared-component closure with sibling owners without retrying the landed owner", () => {
    const currentRuns = [{ agent: { agentId: "A1", capabilities: ["runtime"] } }];
    const agentRuns = [
      ...currentRuns,
      { agent: { agentId: "A2", capabilities: ["runtime"] } },
      { agent: { agentId: "A7", capabilities: ["runtime"] } },
    ];

    const selected = resolveSharedComponentContinuationRuns(
      currentRuns,
      agentRuns,
      [
        {
          agentId: "A2",
          statusCode: "shared-component-sibling-pending",
          componentId: "pilot-live",
          satisfiedAgentIds: ["A1"],
          waitingOnAgentIds: ["A2", "A7"],
          failedOwnContractAgentIds: ["A2", "A7"],
        },
      ],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [],
          clarifications: [],
          requests: [],
          blockers: [],
        },
        capabilityAssignments: [],
        dependencySnapshot: {
          openInbound: [],
        },
        ledger: { phase: "running", attempt: 1, tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        laneProfile: {
          runtimePolicy: {
            runtimeMixTargets: {},
          },
        },
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.map((run) => run.agent.agentId)).toEqual(["A2", "A7"]);
  });

  it("invalidates a persisted relaunch plan when shared-component ownership now waits on different agents", () => {
    const dir = makeTempDir();
    const a1StatusPath = path.join(dir, "wave-10-a1.status");
    const a1SummaryPath = path.join(dir, "wave-10-a1.summary.json");
    const a1LogPath = path.join(dir, "wave-10-a1.log");
    const a2StatusPath = path.join(dir, "wave-10-a2.status");
    const a2LogPath = path.join(dir, "wave-10-a2.log");
    const a7StatusPath = path.join(dir, "wave-10-a7.status");
    const a7LogPath = path.join(dir, "wave-10-a7.log");

    fs.writeFileSync(a1StatusPath, JSON.stringify({ code: 0, promptHash: "hash-a1" }, null, 2), "utf8");
    fs.writeFileSync(a1LogPath, "", "utf8");
    fs.writeFileSync(
      a1SummaryPath,
      JSON.stringify(
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["src/a1.ts"],
          },
          components: [
            {
              componentId: "pilot-live",
              level: "pilot-live",
              state: "met",
            },
          ],
          logPath: a1LogPath,
        },
        null,
        2,
      ),
      "utf8",
    );
    writeAgentResultEnvelopeForRun(
      makeRunInfo("A1", a1StatusPath, a1LogPath, {
        wave: 10,
        summaryPath: a1SummaryPath,
      }),
      {
        wave: 10,
        lane: "main",
      },
      buildAgentResultEnvelope(
        {
          agentId: "A1",
          components: ["pilot-live"],
          componentTargets: {
            "pilot-live": "pilot-live",
          },
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
        {
        agentId: "A1",
        proof: {
          completion: "contract",
          durability: "none",
          proof: "unit",
          state: "met",
        },
        docDelta: {
          state: "owned",
          paths: ["src/a1.ts"],
        },
        components: [
          {
            componentId: "pilot-live",
            level: "pilot-live",
            state: "met",
          },
        ],
        },
      ),
    );

    fs.writeFileSync(a2StatusPath, JSON.stringify({ code: 0, promptHash: "stale-a2" }, null, 2), "utf8");
    fs.writeFileSync(a2LogPath, "", "utf8");
    fs.writeFileSync(a7StatusPath, JSON.stringify({ code: 0, promptHash: "stale-a7" }, null, 2), "utf8");
    fs.writeFileSync(a7LogPath, "", "utf8");

    const wave = {
      wave: 10,
      componentPromotions: [
        {
          componentId: "pilot-live",
          targetLevel: "pilot-live",
        },
      ],
      agents: [
        {
          agentId: "A1",
          components: ["pilot-live"],
          componentTargets: {
            "pilot-live": "pilot-live",
          },
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
        {
          agentId: "A2",
          components: ["pilot-live"],
          componentTargets: {
            "pilot-live": "pilot-live",
          },
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
        {
          agentId: "A7",
          components: ["pilot-live"],
          componentTargets: {
            "pilot-live": "pilot-live",
          },
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
      ],
    };
    const agentRuns = [
      {
        agent: wave.agents[0],
        statusPath: a1StatusPath,
        logPath: a1LogPath,
      },
      {
        agent: wave.agents[1],
        statusPath: a2StatusPath,
        logPath: a2LogPath,
      },
      {
        agent: wave.agents[2],
        statusPath: a7StatusPath,
        logPath: a7LogPath,
      },
    ];

    expect(
      persistedRelaunchPlanMatchesCurrentState(
        agentRuns,
        {
          selectedAgentIds: ["A1"],
        },
        {
          laneProfile: {
            validation: {
              requireComponentPromotionsFromWave: 0,
            },
            roles: {
              contQaAgentId: "A0",
              contEvalAgentId: "E0",
              integrationAgentId: "A8",
              documentationAgentId: "A9",
            },
          },
        },
        wave,
      ),
    ).toBe(false);
  });

  it("clears persisted relaunch plans for fresh live launches by default", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const relaunchPlanPath = path.join(lanePaths.statusDir, "relaunch-plan-wave-10.json");
    fs.writeFileSync(
      relaunchPlanPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "wave-relaunch-plan",
          wave: 10,
          selectedAgentIds: ["A1"],
          createdAt: "2026-03-23T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = resetPersistedWaveLaunchState(lanePaths, 10, {});

    expect(result).toMatchObject({
      clearedRelaunchPlan: true,
      relaunchPlan: {
        selectedAgentIds: ["A1"],
      },
    });
    expect(fs.existsSync(relaunchPlanPath)).toBe(false);
  });

  it("preserves persisted relaunch plans when resume-control-state is requested", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const relaunchPlanPath = path.join(lanePaths.statusDir, "relaunch-plan-wave-10.json");
    fs.writeFileSync(
      relaunchPlanPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "wave-relaunch-plan",
          wave: 10,
          selectedAgentIds: ["A1"],
          createdAt: "2026-03-23T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = resetPersistedWaveLaunchState(lanePaths, 10, {
      resumeControlState: true,
    });

    expect(result).toEqual({
      clearedRelaunchPlan: false,
    });
    expect(fs.existsSync(relaunchPlanPath)).toBe(true);
  });

  it("switches failed agents to an allowed fallback executor on retry", () => {
    const agentRuns = [
      {
        agent: {
          agentId: "A1",
          capabilities: ["runtime"],
          skillsResolved: {
            ids: ["runtime-codex"],
            role: "implementation",
            runtime: "codex",
            deployKind: null,
            promptHash: "codex-skill-hash",
            bundles: [],
          },
          executorResolved: {
            id: "codex",
            initialExecutorId: "codex",
            model: null,
            role: "implementation",
            profile: null,
            selectedBy: "lane-role-default",
            fallbacks: ["claude"],
            tags: [],
            budget: null,
            fallbackUsed: false,
            fallbackReason: null,
            executorHistory: [{ attempt: 0, executorId: "codex", reason: "initial" }],
            codex: { command: "missing-codex", sandbox: "danger-full-access" },
            claude: {
              command: "bash",
              model: "claude-sonnet-4-6",
              appendSystemPromptMode: "append",
              permissionMode: null,
              permissionPromptTool: null,
              maxTurns: null,
              mcpConfig: [],
              strictMcpConfig: false,
              settings: null,
              outputFormat: "text",
              allowedTools: [],
              disallowedTools: [],
            },
            opencode: {
              command: "missing-opencode",
              model: null,
              agent: null,
              attach: null,
              format: "default",
              steps: null,
              instructions: [],
              permission: null,
            },
          },
        },
      },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A1", statusCode: "127" }],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [],
          clarifications: [],
          requests: [],
          blockers: [],
        },
        ledger: { phase: "running", attempt: 1, tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        laneProfile: {
          skills: {
            dir: "skills",
            base: [],
            byRole: {},
            byRuntime: {
              codex: ["runtime-codex"],
              claude: ["runtime-claude"],
            },
            byDeployKind: {},
          },
          runtimePolicy: {
            runtimeMixTargets: {
              claude: 1,
            },
          },
        },
        capabilityRouting: { preferredAgents: {} },
      },
      {
        deployEnvironments: [],
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A1"]);
    expect(agentRuns[0].agent.executorResolved).toMatchObject({
      id: "claude",
      fallbackUsed: true,
      fallbackReason: "retry:127",
      initialExecutorId: "codex",
    });
    expect(agentRuns[0].agent.skillsResolved).toMatchObject({
      runtime: "claude",
    });
    expect(agentRuns[0].agent.skillsResolved.ids).toContain("runtime-claude");
  });

  it("blocks retry when a configured fallback would violate runtime mix targets", () => {
    const agentRuns = [
      {
        agent: {
          agentId: "A1",
          capabilities: ["runtime"],
          executorResolved: {
            id: "codex",
            initialExecutorId: "codex",
            model: null,
            role: "implementation",
            profile: null,
            selectedBy: "lane-role-default",
            fallbacks: ["claude"],
            tags: [],
            budget: null,
            fallbackUsed: false,
            fallbackReason: null,
            executorHistory: [{ attempt: 0, executorId: "codex", reason: "initial" }],
            codex: { command: "missing-codex", sandbox: "danger-full-access" },
            claude: {
              command: "bash",
              model: "claude-sonnet-4-6",
              appendSystemPromptMode: "append",
              permissionMode: null,
              permissionPromptTool: null,
              maxTurns: null,
              mcpConfig: [],
              strictMcpConfig: false,
              settings: null,
              outputFormat: "text",
              allowedTools: [],
              disallowedTools: [],
            },
            opencode: {
              command: "missing-opencode",
              model: null,
              agent: null,
              attach: null,
              format: "default",
              steps: null,
              instructions: [],
              permission: null,
            },
          },
        },
      },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A1", statusCode: "127", logPath: "logs/a1.log" }],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [],
          clarifications: [],
          requests: [],
          blockers: [],
        },
        ledger: { phase: "running", attempt: 1, tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        laneProfile: {
          runtimePolicy: {
            runtimeMixTargets: {
              claude: 0,
            },
          },
        },
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.runs).toEqual([]);
    expect(selected.barrier).toMatchObject({
      statusCode: "retry-fallback-blocked",
    });
    expect(selected.barrier.failures).toMatchObject([
      {
        agentId: "A1",
        statusCode: "retry-fallback-blocked",
      },
    ]);
    expect(agentRuns[0].agent.executorResolved).toMatchObject({
      id: "codex",
      fallbackUsed: false,
    });
  });

  it("keeps proof-centric agents on a sticky executor when fallback is disabled", () => {
    const agentRuns = [
      {
        agent: {
          agentId: "A6",
          capabilities: ["deploy"],
          executorResolved: {
            id: "codex",
            initialExecutorId: "codex",
            model: null,
            role: "implementation",
            profile: null,
            selectedBy: "agent-id",
            retryPolicy: "sticky",
            allowFallbackOnRetry: false,
            fallbacks: ["claude"],
            tags: [],
            budget: null,
            fallbackUsed: false,
            fallbackReason: null,
            executorHistory: [{ attempt: 0, executorId: "codex", reason: "initial" }],
            codex: { command: "bash", sandbox: "danger-full-access" },
            claude: {
              command: "bash",
              model: "claude-sonnet-4-6",
              appendSystemPromptMode: "append",
              permissionMode: null,
              permissionPromptTool: null,
              maxTurns: null,
              mcpConfig: [],
              strictMcpConfig: false,
              settings: null,
              outputFormat: "text",
              allowedTools: [],
              disallowedTools: [],
            },
            opencode: {
              command: "missing-opencode",
              model: null,
              agent: null,
              attach: null,
              format: "default",
              steps: null,
              instructions: [],
              permission: null,
            },
          },
        },
      },
    ];

    const selected = resolveRelaunchRuns(
      agentRuns,
      [{ agentId: "A6", statusCode: "127" }],
      {
        coordinationState: {
          humanFeedback: [],
          humanEscalations: [],
          clarifications: [],
          requests: [],
          blockers: [],
        },
        ledger: { phase: "running", attempt: 1, tasks: [] },
      },
      {
        documentationAgentId: "A9",
        contQaAgentId: "A0",
        integrationAgentId: "A8",
        laneProfile: {
          runtimePolicy: {
            runtimeMixTargets: {},
          },
        },
        capabilityRouting: { preferredAgents: {} },
      },
    );

    expect(selected.barrier).toBe(null);
    expect(selected.runs.map((run) => run.agent.agentId)).toEqual(["A6"]);
    expect(agentRuns[0].agent.executorResolved).toMatchObject({
      id: "codex",
      retryPolicy: "sticky",
      allowFallbackOnRetry: false,
      fallbackUsed: false,
    });
  });
});

describe("computeReducerSnapshot", () => {
  it("persists machine-readable shadow diffs for reducer-vs-compatibility slices", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.laneProfile.validation.requireComponentPromotionsFromWave = null;
    const result = computeReducerSnapshot({
      lanePaths,
      wave: {
        wave: 4,
        agents: [{ agentId: "A1" }, { agentId: "A0" }],
      },
      agentRuns: [],
      derivedState: {
        coordinationState: {
          blockers: [{ id: "blocker-1", status: "open" }],
          clarifications: [],
          humanFeedback: [],
          humanEscalations: [],
          requests: [],
        },
        capabilityAssignments: [],
        dependencySnapshot: {
          openInbound: [],
          requiredInbound: [],
          requiredOutbound: [],
          unresolvedInboundAssignments: [],
        },
        contradictions: new Map([["c-1", { contradictionId: "c-1" }]]),
      },
      attempt: 2,
      compatibilityGateSnapshot: {
        helperAssignmentBarrier: { ok: true, statusCode: "pass", detail: "" },
        dependencyBarrier: { ok: true, statusCode: "pass", detail: "" },
        overall: { ok: true, gate: "pass", statusCode: "pass", detail: "" },
      },
      compatibilityRelaunchResolution: {
        runs: [{ agent: { agentId: "A1" } }],
        barrier: null,
      },
    });

    expect(result.shadowDiff).toBeTruthy();
    expect(result.shadowDiff.slices.helperAssignmentBarrier).toBeTruthy();
    expect(result.shadowDiff.slices.retryPlan).toBeTruthy();
    expect(fs.existsSync(result.snapshotPath)).toBe(true);
    const snapshot = JSON.parse(fs.readFileSync(result.snapshotPath, "utf8"));
    expect(snapshot.shadowDiff.slices.helperAssignmentBarrier).toBeTruthy();
    expect(snapshot.shadowDiff.slices.retryPlan.reducer.resumeFromPhase).toBeTruthy();
  });
});

describe("runClosureSweepPhase", () => {
  it("skips low-entropy bootstrap closure agents when auto closure is enabled", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.gateModeThresholds = { bootstrap: 0, standard: 4, strict: 10 };
    lanePaths.closureModeThresholds = { bootstrap: 0, standard: 4, strict: 10 };
    lanePaths.autoClosure = {
      allowInferredIntegration: true,
      allowAutoDocNoChange: true,
      allowAutoDocProjection: false,
      allowSkipContQaInBootstrap: true,
    };
    lanePaths.laneProfile.validation.autoClosure = lanePaths.autoClosure;
    lanePaths.laneProfile.validation.closureModeThresholds = lanePaths.closureModeThresholds;
    const closureRuns = ["A8", "A9", "A0"].map((agentId) => ({
      agent: { agentId, title: agentId },
      sessionName: `wave-${agentId.toLowerCase()}`,
      promptPath: path.join(dir, `${agentId}.prompt.md`),
      logPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.log`),
      statusPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.status`),
      messageBoardPath: path.join(dir, "board.md"),
      messageBoardSnapshot: "",
      sharedSummaryPath: path.join(dir, "shared.md"),
      sharedSummaryText: "",
      inboxPath: path.join(dir, `${agentId}.inbox.md`),
      inboxText: "",
    }));
    const launched = [];

    const result = await runClosureSweepPhase({
      lanePaths,
      wave: {
        wave: 0,
        agents: [{ agentId: "A8" }, { agentId: "A9" }, { agentId: "A0" }],
        integrationAgentId: "A8",
        documentationAgentId: "A9",
        contQaAgentId: "A0",
      },
      closureRuns,
      coordinationLogPath: path.join(dir, "coordination", "wave-0.jsonl"),
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "Integration is coherent.",
          openClaims: [],
          conflictingClaims: [],
          unresolvedBlockers: [],
          changedInterfaces: [],
          crossComponentImpacts: [],
          proofGaps: [],
          docGaps: [],
          deployRisks: [],
          inboundDependencies: [],
          outboundDependencies: [],
          helperAssignments: [],
        },
        docsQueue: { items: [] },
        coordinationState: {
          clarifications: [],
          humanEscalations: [],
          humanFeedback: [],
        },
        capabilityAssignments: [],
        dependencySnapshot: {
          openInbound: [],
          openOutbound: [],
          unresolvedInboundAssignments: [],
        },
        clarificationBarrier: { ok: true, statusCode: "pass", detail: "" },
        helperAssignmentBarrier: { ok: true, statusCode: "pass", detail: "" },
        dependencyBarrier: { ok: true, statusCode: "pass", detail: "" },
      }),
      dashboardState: {
        attempt: 1,
        agents: closureRuns.map((run) => ({ agentId: run.agent.agentId, attempts: 0 })),
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async (_lanePaths, params) => {
        launched.push(params.agent.agentId);
        return { executorId: "codex" };
      },
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
    });

    expect(launched).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("fails bootstrap closure when cont-QA is missing after semantic closure stages run", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.gateModeThresholds = { bootstrap: 0, standard: 4, strict: 10 };
    lanePaths.closureModeThresholds = { bootstrap: 0, standard: 4, strict: 10 };
    lanePaths.autoClosure = {
      allowInferredIntegration: false,
      allowAutoDocNoChange: false,
      allowAutoDocProjection: false,
      allowSkipContQaInBootstrap: true,
    };
    lanePaths.laneProfile.validation.autoClosure = lanePaths.autoClosure;
    lanePaths.laneProfile.validation.closureModeThresholds = lanePaths.closureModeThresholds;
    const closureRuns = ["A8", "A9"].map((agentId) => ({
      agent: { agentId, title: agentId },
      sessionName: `wave-${agentId.toLowerCase()}`,
      promptPath: path.join(dir, `${agentId}.prompt.md`),
      logPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.log`),
      statusPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.status`),
      messageBoardPath: path.join(dir, "board.md"),
      messageBoardSnapshot: "",
      sharedSummaryPath: path.join(dir, "shared.md"),
      sharedSummaryText: "",
      inboxPath: path.join(dir, `${agentId}.inbox.md`),
      inboxText: "",
    }));

    const result = await runClosureSweepPhase({
      lanePaths,
      wave: {
        wave: 0,
        agents: [{ agentId: "A8" }, { agentId: "A9" }, { agentId: "A0" }],
        integrationAgentId: "A8",
        documentationAgentId: "A9",
        contQaAgentId: "A0",
      },
      closureRuns,
      coordinationLogPath: path.join(dir, "coordination", "wave-0.jsonl"),
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "needs-more-work",
          detail: "semantic review required",
          openClaims: [],
          conflictingClaims: [],
          unresolvedBlockers: [],
          changedInterfaces: [],
          crossComponentImpacts: [],
          proofGaps: [],
          docGaps: [],
          deployRisks: [],
          inboundDependencies: [],
          outboundDependencies: [],
          helperAssignments: [],
        },
        docsQueue: { items: [{ id: "doc-1", kind: "shared-plan" }] },
      }),
      dashboardState: {
        attempt: 1,
        agents: [{ agentId: "A8", attempts: 0 }, { agentId: "A9", attempts: 0 }],
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async () => ({ executorId: "codex" }),
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
      readWaveIntegrationBarrierFn: (() => {
        let count = 0;
        return () => {
          count += 1;
          return count === 1
            ? {
                ok: false,
                agentId: "A8",
                statusCode: "integration-needs-more-work",
                detail: "semantic integration stage required",
                logPath: "logs/a8.log",
              }
            : {
                ok: true,
                agentId: "A8",
                statusCode: "pass",
                detail: "ready",
                logPath: "logs/a8.log",
              };
        };
      })(),
      readWaveDocumentationGateFn: (() => {
        let count = 0;
        return () => {
          count += 1;
          return count === 1
            ? {
                ok: false,
                agentId: "A9",
                statusCode: "doc-closure-open",
                detail: "doc stage required",
                logPath: "logs/a9.log",
              }
            : {
                ok: true,
                agentId: "A9",
                statusCode: "pass",
                detail: "ready",
                logPath: "logs/a9.log",
              };
        };
      })(),
      readWaveComponentMatrixGateFn: () => ({
        ok: true,
        agentId: "A9",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/a9.log",
      }),
      materializeAgentExecutionSummaryForRunFn: () => null,
      monitorWaveHumanFeedbackFn: () => false,
    });

    expect(result.failures).toEqual([
      expect.objectContaining({
        agentId: "A0",
        statusCode: "missing-closure-run",
      }),
    ]);
  });

  it("runs cont-EVAL before integration, documentation, and cont-QA when present", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.contEvalAgentId = "E0";
    lanePaths.laneProfile.validation.requireComponentPromotionsFromWave = null;
    const contEvalReportPath = path.join(dir, "wave-0-cont-eval.md");
    const contQaReportPath = path.join(dir, "wave-0-cont-qa.md");
    const closureRuns = ["E0", "A8", "A9", "A0"].map((agentId) => ({
      agent: { agentId, title: agentId },
      sessionName: `wave-${agentId.toLowerCase()}`,
      promptPath: path.join(dir, `${agentId}.prompt.md`),
      logPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.log`),
      statusPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.status`),
      messageBoardPath: path.join(dir, "board.md"),
      messageBoardSnapshot: "",
      sharedSummaryPath: path.join(dir, "shared.md"),
      sharedSummaryText: "",
      inboxPath: path.join(dir, `${agentId}.inbox.md`),
      inboxText: "",
    }));
    const launched = [];

    const result = await runClosureSweepPhase({
      lanePaths,
      wave: {
        wave: 0,
        contQaAgentId: "A0",
        contQaReportPath,
        contEvalAgentId: "E0",
        contEvalReportPath,
        evalTargets: [
          {
            id: "response-quality",
            selection: "delegated",
            benchmarkFamily: "service-output",
            benchmarks: [],
            objective: "Tune response quality",
            threshold: "Golden response smoke passes",
          },
        ],
        integrationAgentId: "A8",
        documentationAgentId: "A9",
      },
      closureRuns,
      coordinationLogPath: path.join(dir, "coordination", "wave-0.jsonl"),
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "Integration is coherent.",
        },
      }),
      dashboardState: {
        attempt: 1,
        agents: closureRuns.map((run) => ({ agentId: run.agent.agentId, attempts: 0 })),
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async (_lanePaths, params) => {
        launched.push(params.agent.agentId);
        fs.writeFileSync(
          params.statusPath,
          JSON.stringify({ code: 0, promptHash: "hash" }, null, 2),
          "utf8",
        );
        if (params.agent.agentId === "E0") {
          fs.writeFileSync(contEvalReportPath, "# cont-EVAL\n", "utf8");
        }
        if (params.agent.agentId === "A0") {
          fs.writeFileSync(contQaReportPath, "# cont-QA\n\nVerdict: PASS\n", "utf8");
        }
        const logText =
          params.agent.agentId === "E0"
            ? "[wave-eval] state=satisfied targets=1 benchmarks=1 regressions=0 target_ids=response-quality benchmark_ids=golden-response-smoke detail=targets-satisfied\n"
            : params.agent.agentId === "A8"
              ? "[wave-integration] state=ready-for-doc-closure claims=0 conflicts=0 blockers=0 detail=ready\n"
              : params.agent.agentId === "A9"
                ? "[wave-doc-closure] state=closed paths=docs/plans/current-state.md detail=shared-plan-updated\n"
                : [
                    "[wave-gate] architecture=pass integration=pass durability=pass live=pass docs=pass detail=ready",
                    "[wave-verdict] pass detail=ready",
                  ].join("\n");
        fs.writeFileSync(params.logPath, `${logText}\n`, "utf8");
        return { executorId: "codex" };
      },
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
    });

    expect(launched).toEqual(["E0", "A8", "A9", "A0"]);
    expect(result.failures).toEqual([]);
  });

  it("stops after integration when the integration summary is not ready for doc closure", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const runLog = path.join(dir, "wave-0-a8.log");
    const runStatus = path.join(dir, "wave-0-a8.status");
    const closureRuns = [
      {
        agent: { agentId: "A8", title: "Integration" },
        sessionName: "wave-a8",
        promptPath: path.join(dir, "a8.prompt.md"),
        logPath: runLog,
        statusPath: runStatus,
        messageBoardPath: path.join(dir, "board.md"),
        messageBoardSnapshot: "",
        sharedSummaryPath: path.join(dir, "shared.md"),
        sharedSummaryText: "",
        inboxPath: path.join(dir, "a8.inbox.md"),
        inboxText: "",
      },
      {
        agent: { agentId: "A9", title: "Docs" },
        sessionName: "wave-a9",
        promptPath: path.join(dir, "a9.prompt.md"),
        logPath: path.join(dir, "wave-0-a9.log"),
        statusPath: path.join(dir, "wave-0-a9.status"),
        messageBoardPath: path.join(dir, "board.md"),
        messageBoardSnapshot: "",
        sharedSummaryPath: path.join(dir, "shared.md"),
        sharedSummaryText: "",
        inboxPath: path.join(dir, "a9.inbox.md"),
        inboxText: "",
      },
      {
        agent: { agentId: "A0", title: "cont-QA" },
        sessionName: "wave-a0",
        promptPath: path.join(dir, "a0.prompt.md"),
        logPath: path.join(dir, "wave-0-a0.log"),
        statusPath: path.join(dir, "wave-0-a0.status"),
        messageBoardPath: path.join(dir, "board.md"),
        messageBoardSnapshot: "",
        sharedSummaryPath: path.join(dir, "shared.md"),
        sharedSummaryText: "",
        inboxPath: path.join(dir, "a0.inbox.md"),
        inboxText: "",
      },
    ];
    const launched = [];

    const result = await runClosureSweepPhase({
      lanePaths,
      wave: { wave: 0, contQaAgentId: "A0", integrationAgentId: "A8", documentationAgentId: "A9" },
      closureRuns,
      coordinationLogPath: path.join(dir, "coordination", "wave-0.jsonl"),
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "needs-more-work",
          detail: "integration still has contradictions",
        },
      }),
      dashboardState: {
        attempt: 1,
        agents: closureRuns.map((run) => ({ agentId: run.agent.agentId, attempts: 0 })),
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async (_lanePaths, params) => {
        launched.push(params.agent.agentId);
        fs.writeFileSync(
          params.statusPath,
          JSON.stringify({ code: 0, promptHash: "hash" }, null, 2),
          "utf8",
        );
        fs.writeFileSync(
          params.logPath,
          "[wave-integration] state=needs-more-work claims=0 conflicts=1 blockers=0 detail=integration-still-has-contradictions\n",
          "utf8",
        );
        return { executorId: "codex" };
      },
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
    });

    expect(launched).toEqual(["A8"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      agentId: "A8",
      statusCode: "integration-needs-more-work",
    });
  });

  it("stops after integration when blocking contradictions remain open", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const runLog = path.join(dir, "wave-0-a8.log");
    const runStatus = path.join(dir, "wave-0-a8.status");
    const closureRuns = [
      {
        agent: { agentId: "A8", title: "Integration" },
        sessionName: "wave-a8",
        promptPath: path.join(dir, "a8.prompt.md"),
        logPath: runLog,
        statusPath: runStatus,
        messageBoardPath: path.join(dir, "board.md"),
        messageBoardSnapshot: "",
        sharedSummaryPath: path.join(dir, "shared.md"),
        sharedSummaryText: "",
        inboxPath: path.join(dir, "a8.inbox.md"),
        inboxText: "",
      },
    ];
    const launched = [];

    const result = await runClosureSweepPhase({
      lanePaths,
      wave: { wave: 0, integrationAgentId: "A8" },
      closureRuns,
      coordinationLogPath: path.join(dir, "coordination", "wave-0.jsonl"),
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "Integration summary itself is clean.",
        },
        contradictions: new Map([
          [
            "contra-1",
            {
              contradictionId: "contra-1",
              status: "detected",
              severity: "blocking",
              impactedGates: ["integrationBarrier"],
            },
          ],
        ]),
      }),
      dashboardState: {
        attempt: 1,
        agents: closureRuns.map((run) => ({ agentId: run.agent.agentId, attempts: 0 })),
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async (_lanePaths, params) => {
        launched.push(params.agent.agentId);
        fs.writeFileSync(
          params.statusPath,
          JSON.stringify({ code: 0, promptHash: "hash" }, null, 2),
          "utf8",
        );
        fs.writeFileSync(
          params.logPath,
          "[wave-integration] state=ready-for-doc-closure claims=0 conflicts=0 blockers=0 detail=ready\n",
          "utf8",
        );
        return { executorId: "codex" };
      },
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
    });

    expect(launched).toEqual(["A8"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      agentId: "A8",
      statusCode: "integration-contradiction-open",
    });
  });

  it("validates closure against a wave-specific integration steward id", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const runLog = path.join(dir, "wave-0-i8.log");
    const runStatus = path.join(dir, "wave-0-i8.status");
    const contQaReportPath = path.join(dir, "wave-0-cont-qa.md");
    const closureRuns = ["I8", "A9", "A0"].map((agentId) => ({
      agent: { agentId, title: agentId === "I8" ? "Integration" : agentId },
      sessionName: `wave-${agentId.toLowerCase()}`,
      promptPath: path.join(dir, `${agentId.toLowerCase()}.prompt.md`),
      logPath: agentId === "I8" ? runLog : path.join(dir, `wave-0-${agentId.toLowerCase()}.log`),
      statusPath: agentId === "I8" ? runStatus : path.join(dir, `wave-0-${agentId.toLowerCase()}.status`),
      messageBoardPath: path.join(dir, "board.md"),
      messageBoardSnapshot: "",
      sharedSummaryPath: path.join(dir, "shared.md"),
      sharedSummaryText: "",
      inboxPath: path.join(dir, `${agentId.toLowerCase()}.inbox.md`),
      inboxText: "",
    }));
    const launched = [];

    const result = await runClosureSweepPhase({
      lanePaths,
      wave: {
        wave: 0,
        integrationAgentId: "I8",
        contQaReportPath: path.relative(process.cwd(), contQaReportPath),
      },
      closureRuns,
      coordinationLogPath: path.join(dir, "coordination", "wave-0.jsonl"),
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "Integration is coherent.",
        },
      }),
      dashboardState: {
        attempt: 1,
        agents: closureRuns.map((run) => ({ agentId: run.agent.agentId, attempts: 0 })),
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async (_lanePaths, params) => {
        launched.push(params.agent.agentId);
        fs.writeFileSync(
          params.statusPath,
          JSON.stringify({ code: 0, promptHash: "hash" }, null, 2),
          "utf8",
        );
        if (params.agent.agentId === "A0") {
          fs.writeFileSync(contQaReportPath, "# cont-QA\n\nVerdict: PASS\n", "utf8");
        }
        const logText =
          params.agent.agentId === "I8"
            ? "[wave-integration] state=ready-for-doc-closure claims=0 conflicts=0 blockers=0 detail=ready\n"
            : params.agent.agentId === "A9"
              ? "[wave-doc-closure] state=closed paths=docs/plans/current-state.md detail=shared-plan-updated\n"
              : [
                  "[wave-gate] architecture=pass integration=pass durability=pass live=pass docs=pass detail=ready",
                  "[wave-verdict] pass detail=ready",
                ].join("\n");
        fs.writeFileSync(
          params.logPath,
          `${logText}\n`,
          "utf8",
        );
        return { executorId: "codex" };
      },
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
    });

    expect(launched).toEqual(["I8", "A9", "A0"]);
    expect(result.failures).toEqual([]);
  });

  it("runs security review after cont-EVAL and before integration", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.contEvalAgentId = "E0";
    lanePaths.laneProfile.validation.requireComponentPromotionsFromWave = null;
    const contEvalReportPath = path.join(dir, "wave-0-cont-eval.md");
    const securityReportPath = path.join(dir, "wave-0-security-review.md");
    const contQaReportPath = path.join(dir, "wave-0-cont-qa.md");
    const closureRuns = ["E0", "A7", "A8", "A9", "A0"].map((agentId) => ({
      agent: agentId === "A7"
        ? {
            agentId,
            title: "Security Engineer",
            rolePromptPaths: ["docs/agents/wave-security-role.md"],
            ownedPaths: [path.relative(process.cwd(), securityReportPath)],
          }
        : { agentId, title: agentId },
      sessionName: `wave-${agentId.toLowerCase()}`,
      promptPath: path.join(dir, `${agentId}.prompt.md`),
      logPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.log`),
      statusPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.status`),
      messageBoardPath: path.join(dir, "board.md"),
      messageBoardSnapshot: "",
      sharedSummaryPath: path.join(dir, "shared.md"),
      sharedSummaryText: "",
      inboxPath: path.join(dir, `${agentId}.inbox.md`),
      inboxText: "",
    }));
    const launched = [];

    const result = await runClosureSweepPhase({
      lanePaths,
      wave: {
        wave: 0,
        contQaAgentId: "A0",
        contQaReportPath,
        contEvalAgentId: "E0",
        contEvalReportPath,
        evalTargets: [
          {
            id: "response-quality",
            selection: "delegated",
            benchmarkFamily: "service-output",
            benchmarks: [],
            objective: "Tune response quality",
            threshold: "Golden response smoke passes",
          },
        ],
        integrationAgentId: "A8",
        documentationAgentId: "A9",
      },
      closureRuns,
      coordinationLogPath: path.join(dir, "coordination", "wave-0.jsonl"),
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "Integration is coherent.",
        },
      }),
      dashboardState: {
        attempt: 1,
        agents: closureRuns.map((run) => ({ agentId: run.agent.agentId, attempts: 0 })),
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async (_lanePaths, params) => {
        launched.push(params.agent.agentId);
        fs.writeFileSync(
          params.statusPath,
          JSON.stringify({ code: 0, promptHash: "hash" }, null, 2),
          "utf8",
        );
        if (params.agent.agentId === "E0") {
          fs.writeFileSync(contEvalReportPath, "# cont-EVAL\n", "utf8");
        }
        if (params.agent.agentId === "A7") {
          fs.writeFileSync(securityReportPath, "# Security Review\n", "utf8");
        }
        if (params.agent.agentId === "A0") {
          fs.writeFileSync(contQaReportPath, "# cont-QA\n\nVerdict: PASS\n", "utf8");
        }
        const logText =
          params.agent.agentId === "E0"
            ? "[wave-eval] state=satisfied targets=1 benchmarks=1 regressions=0 target_ids=response-quality benchmark_ids=golden-response-smoke detail=targets-satisfied\n"
            : params.agent.agentId === "A7"
              ? "[wave-security] state=clear findings=0 approvals=0 detail=security-clear\n"
              : params.agent.agentId === "A8"
                ? "[wave-integration] state=ready-for-doc-closure claims=0 conflicts=0 blockers=0 detail=ready\n"
                : params.agent.agentId === "A9"
                  ? "[wave-doc-closure] state=closed paths=docs/plans/current-state.md detail=shared-plan-updated\n"
                  : [
                      "[wave-gate] architecture=pass integration=pass durability=pass live=pass docs=pass detail=ready",
                      "[wave-verdict] pass detail=ready",
                    ].join("\n");
        fs.writeFileSync(params.logPath, `${logText}\n`, "utf8");
        return { executorId: "codex" };
      },
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
    });

    expect(launched).toEqual(["E0", "A7", "A8", "A9", "A0"]);
    expect(result.failures).toEqual([]);
  });

  it("forwards closure-stage wave-proof-gap records and continues later closure stages", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const coordinationLogPath = path.join(dir, "coordination", "wave-0.jsonl");
    const closureRuns = ["A7", "A8", "A9", "A0"].map((agentId) => ({
      agent: agentId === "A7"
        ? {
            agentId,
            title: agentId,
            rolePromptPaths: ["docs/agents/wave-security-role.md"],
            ownedPaths: ["docs/security-review.md"],
          }
        : { agentId, title: agentId },
      sessionName: `wave-${agentId.toLowerCase()}`,
      promptPath: path.join(dir, `${agentId}.prompt.md`),
      logPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.log`),
      statusPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.status`),
      messageBoardPath: path.join(dir, "board.md"),
      messageBoardSnapshot: "",
      sharedSummaryPath: path.join(dir, "shared.md"),
      sharedSummaryText: "",
      inboxPath: path.join(dir, `${agentId}.inbox.md`),
      inboxText: "",
    }));
    const launched = [];

    const result = await runClosureSweepEnginePhase({
      lanePaths,
      wave: {
        wave: 0,
        integrationAgentId: "A8",
        documentationAgentId: "A9",
        contQaAgentId: "A0",
      },
      closureRuns,
      coordinationLogPath,
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "Integration is coherent.",
        },
      }),
      dashboardState: {
        attempt: 1,
        agents: closureRuns.map((run) => ({ agentId: run.agent.agentId, attempts: 0 })),
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async (_lanePaths, params) => {
        launched.push(params.agent.agentId);
        fs.writeFileSync(
          params.statusPath,
          JSON.stringify({ code: 0, promptHash: "hash" }, null, 2),
          "utf8",
        );
        fs.writeFileSync(params.logPath, "closure output\n", "utf8");
        return { executorId: "codex" };
      },
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
      readWaveContEvalGateFn: () => ({ ok: true, agentId: null, statusCode: "pass", detail: "pass", logPath: null }),
      readWaveSecurityGateFn: () => ({
        ok: false,
        agentId: "A7",
        statusCode: "wave-proof-gap",
        detail: "A7 reported a proof gap.",
        logPath: "logs/wave-0-a7.log",
      }),
      readWaveIntegrationBarrierFn: () => ({
        ok: true,
        agentId: "A8",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/wave-0-a8.log",
      }),
      readWaveDocumentationGateFn: () => ({
        ok: true,
        agentId: "A9",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/wave-0-a9.log",
      }),
      readWaveComponentMatrixGateFn: () => ({
        ok: true,
        agentId: "A9",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/wave-0-a9.log",
      }),
      readWaveContQaGateFn: () => ({
        ok: true,
        agentId: "A0",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/wave-0-a0.log",
      }),
      materializeAgentExecutionSummaryForRunFn: () => null,
      monitorWaveHumanFeedbackFn: () => false,
    });

    expect(launched).toEqual(["A7", "A8", "A9", "A0"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      agentId: "A7",
      statusCode: "wave-proof-gap",
    });

    const coordinationState = readMaterializedCoordinationState(coordinationLogPath);
    const forwarded = coordinationState.byId.get("wave-0-closure-gap-security-review-A7-attempt-1");
    expect(forwarded).toMatchObject({
      kind: "blocker",
      agentId: "A7",
      blockerSeverity: "closure-critical",
    });
    expect(forwarded.targets).toEqual(["agent:A8", "agent:A9", "agent:A0"]);
  });

  it("still stops immediately on non-forwardable closure failures", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const closureRuns = ["A7", "A8", "A9", "A0"].map((agentId) => ({
      agent: agentId === "A7"
        ? {
            agentId,
            title: agentId,
            rolePromptPaths: ["docs/agents/wave-security-role.md"],
            ownedPaths: ["docs/security-review.md"],
          }
        : { agentId, title: agentId },
      sessionName: `wave-${agentId.toLowerCase()}`,
      promptPath: path.join(dir, `${agentId}.prompt.md`),
      logPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.log`),
      statusPath: path.join(dir, `wave-0-${agentId.toLowerCase()}.status`),
      messageBoardPath: path.join(dir, "board.md"),
      messageBoardSnapshot: "",
      sharedSummaryPath: path.join(dir, "shared.md"),
      sharedSummaryText: "",
      inboxPath: path.join(dir, `${agentId}.inbox.md`),
      inboxText: "",
    }));
    const launched = [];

    const result = await runClosureSweepEnginePhase({
      lanePaths,
      wave: {
        wave: 0,
        integrationAgentId: "A8",
        documentationAgentId: "A9",
        contQaAgentId: "A0",
      },
      closureRuns,
      coordinationLogPath: path.join(dir, "coordination", "wave-0.jsonl"),
      refreshDerivedState: () => ({
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "Integration is coherent.",
        },
      }),
      dashboardState: {
        attempt: 1,
        agents: closureRuns.map((run) => ({ agentId: run.agent.agentId, attempts: 0 })),
      },
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        orchestratorId: "orch",
        executorMode: "codex",
        codexSandboxMode: "danger-full-access",
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
        timeoutMinutes: 5,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async (_lanePaths, params) => {
        launched.push(params.agent.agentId);
        fs.writeFileSync(
          params.statusPath,
          JSON.stringify({ code: 0, promptHash: "hash" }, null, 2),
          "utf8",
        );
        fs.writeFileSync(params.logPath, "closure output\n", "utf8");
        return { executorId: "codex" };
      },
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
      readWaveContEvalGateFn: () => ({ ok: true, agentId: null, statusCode: "pass", detail: "pass", logPath: null }),
      readWaveSecurityGateFn: () => ({
        ok: false,
        agentId: "A7",
        statusCode: "missing-wave-proof",
        detail: "A7 is missing proof.",
        logPath: "logs/wave-0-a7.log",
      }),
      readWaveIntegrationBarrierFn: () => ({
        ok: true,
        agentId: "A8",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/wave-0-a8.log",
      }),
      readWaveDocumentationGateFn: () => ({
        ok: true,
        agentId: "A9",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/wave-0-a9.log",
      }),
      readWaveComponentMatrixGateFn: () => ({
        ok: true,
        agentId: "A9",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/wave-0-a9.log",
      }),
      readWaveContQaGateFn: () => ({
        ok: true,
        agentId: "A0",
        statusCode: "pass",
        detail: "ready",
        logPath: "logs/wave-0-a0.log",
      }),
      materializeAgentExecutionSummaryForRunFn: () => null,
      monitorWaveHumanFeedbackFn: () => false,
    });

    expect(launched).toEqual(["A7"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      agentId: "A7",
      statusCode: "missing-wave-proof",
    });
  });
});

describe("selectInitialWaveRuns", () => {
  it("launches only implementation agents before the closure sweep", () => {
    const lanePaths = makeLanePaths(makeTempDir());
    const runs = [
      { agent: { agentId: "A1", title: "Implementation" } },
      {
        agent: {
          agentId: "A7",
          title: "Security Engineer",
          rolePromptPaths: ["docs/agents/wave-security-role.md"],
        },
      },
      { agent: { agentId: "A8", title: "Integration" } },
      { agent: { agentId: "A9", title: "Docs" } },
      { agent: { agentId: "A0", title: "cont-QA" } },
    ];

    expect(selectInitialWaveRuns(runs, lanePaths).map((run) => run.agent.agentId)).toEqual([
      "A1",
    ]);
  });

  it("preserves closure-only retries when no implementation agents remain", () => {
    const lanePaths = makeLanePaths(makeTempDir());
    const runs = [
      { agent: { agentId: "A8", title: "Integration" } },
      { agent: { agentId: "A9", title: "Docs" } },
      { agent: { agentId: "A0", title: "cont-QA" } },
    ];

    expect(selectInitialWaveRuns(runs, lanePaths).map((run) => run.agent.agentId)).toEqual([
      "A8",
      "A9",
      "A0",
    ]);
  });

  it("runs design agents before implementation agents when present", () => {
    const lanePaths = makeLanePaths(makeTempDir());
    const designStatusPath = path.join(makeTempDir(), "wave-0-d1.status");
    const implementationStatusPath = path.join(makeTempDir(), "wave-0-a1.status");
    const runs = [
      {
        agent: {
          agentId: "D1",
          title: "Design Steward",
          rolePromptPaths: ["docs/agents/wave-design-role.md"],
        },
        statusPath: designStatusPath,
        logPath: path.join(path.dirname(designStatusPath), "wave-0-d1.log"),
      },
      {
        agent: { agentId: "A1", title: "Implementation" },
        statusPath: implementationStatusPath,
        logPath: path.join(path.dirname(implementationStatusPath), "wave-0-a1.log"),
      },
      { agent: { agentId: "A8", title: "Integration" } },
      { agent: { agentId: "A9", title: "Docs" } },
      { agent: { agentId: "A0", title: "cont-QA" } },
    ];

    expect(selectInitialWaveRuns(runs, lanePaths).map((run) => run.agent.agentId)).toEqual([
      "D1",
    ]);
  });

  it("includes hybrid design stewards in the post-design implementation fan-out", () => {
    const lanePaths = makeLanePaths(makeTempDir());
    const reportDir = path.join(
      process.cwd(),
      `.tmp/test-design-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    tempDirs.push(reportDir);
    const reportPath = path.relative(process.cwd(), path.join(reportDir, "wave-0-D1.md"));
    const reportAbsPath = path.join(process.cwd(), reportPath);
    fs.mkdirSync(path.dirname(reportAbsPath), { recursive: true });
    fs.writeFileSync(reportAbsPath, "# Design Packet\n", "utf8");

    const designAgent = {
      agentId: "D1",
      title: "Design Steward",
      rolePromptPaths: ["docs/agents/wave-design-role.md"],
      ownedPaths: [reportPath, "src/runtime.ts"],
      prompt: "Design and implement the runtime follow-through.",
      exitContract: {
        completion: "contract",
        durability: "durable",
        proof: "integration",
        docImpact: "owned",
      },
    };
    const designStatusPath = path.join(makeTempDir(), "wave-0-d1.status");
    const designLogPath = path.join(path.dirname(designStatusPath), "wave-0-d1.log");
    fs.writeFileSync(
      designStatusPath,
      JSON.stringify({ code: 0, promptHash: hashAgentPromptFingerprint(designAgent) }, null, 2),
      "utf8",
    );
    writeAgentExecutionSummary(designStatusPath, {
      agentId: "D1",
      reportPath,
      logPath: designLogPath,
      design: {
        state: "ready-for-implementation",
        decisions: 2,
        assumptions: 1,
        openQuestions: 0,
        detail: "packet-ready",
      },
    });
    fs.writeFileSync(designLogPath, "", "utf8");

    const implementationStatusPath = path.join(makeTempDir(), "wave-0-a1.status");
    const implementationLogPath = path.join(path.dirname(implementationStatusPath), "wave-0-a1.log");
    const runs = [
      {
        agent: designAgent,
        statusPath: designStatusPath,
        logPath: designLogPath,
      },
      {
        agent: { agentId: "A1", title: "Implementation", prompt: "Implement runtime." },
        statusPath: implementationStatusPath,
        logPath: implementationLogPath,
      },
      { agent: { agentId: "A8", title: "Integration" } },
      { agent: { agentId: "A9", title: "Docs" } },
      { agent: { agentId: "A0", title: "cont-QA" } },
    ];

    expect(selectInitialWaveRuns(runs, lanePaths).map((run) => run.agent.agentId)).toEqual([
      "D1",
      "A1",
    ]);
  });

  it("surfaces blocked design passes before implementation-gate failures", () => {
    const transition = resolvePostDesignPassTransition({
      waveNumber: 18,
      designGate: {
        ok: false,
        agentId: "D1",
        statusCode: "missing-design-packet",
        detail: "Missing design packet path for D1.",
        logPath: "logs/wave-18-d1.log",
      },
      remainingImplementationRuns: [
        {
          agent: { agentId: "A1" },
        },
      ],
      currentRuns: [
        {
          agent: { agentId: "D1" },
        },
      ],
      fallbackLogPath: "messageboards/wave-18.md",
    });

    expect(transition).toMatchObject({
      kind: "blocked",
      failure: {
        agentId: "D1",
        statusCode: "missing-design-packet",
        detail: "Missing design packet path for D1.",
        logPath: "logs/wave-18-d1.log",
      },
    });
  });
});

describe("readWaveComponentGate", () => {
  it("requires promoted components to be proven at the declared level", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "wave-0-a1.status");
    const summaryPath = path.join(dir, "wave-0-a1.summary.json");
    const logPath = path.join(dir, "wave-0-a1.log");

    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "hash" }, null, 2), "utf8");
    fs.writeFileSync(logPath, "", "utf8");
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          agentId: "A1",
          components: [
            {
              componentId: "wave-parser-and-launcher",
              level: "baseline-proved",
              state: "met",
            },
          ],
          logPath,
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      readWaveComponentGate(
        {
          wave: 0,
          componentPromotions: [
            {
              componentId: "wave-parser-and-launcher",
              targetLevel: "repo-landed",
            },
          ],
          agents: [
            {
              agentId: "A1",
              components: ["wave-parser-and-launcher"],
              componentTargets: {
                "wave-parser-and-launcher": "repo-landed",
              },
            },
          ],
        },
        [
          {
            agent: {
              agentId: "A1",
              components: ["wave-parser-and-launcher"],
              componentTargets: {
                "wave-parser-and-launcher": "repo-landed",
              },
            },
            statusPath,
            logPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "component-promotion-gap",
      componentId: "wave-parser-and-launcher",
    });
  });

  it("treats shared promoted components as waiting on sibling proof instead of blaming the landed owner", () => {
    const dir = makeTempDir();
    const a1StatusPath = path.join(dir, "wave-0-a1.status");
    const a1SummaryPath = path.join(dir, "wave-0-a1.summary.json");
    const a1LogPath = path.join(dir, "wave-0-a1.log");
    const a2StatusPath = path.join(dir, "wave-0-a2.status");
    const a2SummaryPath = path.join(dir, "wave-0-a2.summary.json");
    const a2LogPath = path.join(dir, "wave-0-a2.log");

    fs.writeFileSync(a1StatusPath, JSON.stringify({ code: 0, promptHash: "hash-a1" }, null, 2), "utf8");
    fs.writeFileSync(a1LogPath, "", "utf8");
    fs.writeFileSync(
      a1SummaryPath,
      JSON.stringify(
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["src/a1.ts"],
          },
          components: [
            {
              componentId: "rollout-cores-and-cluster-view",
              level: "repo-landed",
              state: "met",
            },
          ],
          logPath: a1LogPath,
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.writeFileSync(a2StatusPath, JSON.stringify({ code: 1, promptHash: "hash-a2" }, null, 2), "utf8");
    fs.writeFileSync(a2LogPath, "", "utf8");
    fs.writeFileSync(
      a2SummaryPath,
      JSON.stringify(
        {
          agentId: "A2",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["src/a2.ts"],
          },
          components: [],
          logPath: a2LogPath,
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      readWaveComponentGate(
        {
          wave: 0,
          componentPromotions: [
            {
              componentId: "rollout-cores-and-cluster-view",
              targetLevel: "repo-landed",
            },
          ],
          agents: [
            {
              agentId: "A1",
              components: ["rollout-cores-and-cluster-view"],
              componentTargets: {
                "rollout-cores-and-cluster-view": "repo-landed",
              },
              exitContract: {
                completion: "contract",
                durability: "none",
                proof: "unit",
                docImpact: "owned",
              },
            },
            {
              agentId: "A2",
              components: ["rollout-cores-and-cluster-view"],
              componentTargets: {
                "rollout-cores-and-cluster-view": "repo-landed",
              },
              exitContract: {
                completion: "contract",
                durability: "none",
                proof: "unit",
                docImpact: "owned",
              },
            },
          ],
        },
        [
          {
            agent: {
              agentId: "A1",
              components: ["rollout-cores-and-cluster-view"],
              componentTargets: {
                "rollout-cores-and-cluster-view": "repo-landed",
              },
              exitContract: {
                completion: "contract",
                durability: "none",
                proof: "unit",
                docImpact: "owned",
              },
            },
            statusPath: a1StatusPath,
            logPath: a1LogPath,
          },
          {
            agent: {
              agentId: "A2",
              components: ["rollout-cores-and-cluster-view"],
              componentTargets: {
                "rollout-cores-and-cluster-view": "repo-landed",
              },
              exitContract: {
                completion: "contract",
                durability: "none",
                proof: "unit",
                docImpact: "owned",
              },
            },
            statusPath: a2StatusPath,
            logPath: a2LogPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "shared-component-sibling-pending",
      agentId: "A2",
      componentId: "rollout-cores-and-cluster-view",
      satisfiedAgentIds: ["A1"],
      waitingOnAgentIds: ["A2"],
    });
  });
});

describe("readWaveComponentMatrixGate", () => {
  it("requires the matrix currentLevel to match the promoted target after closure", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-2-a9.log");
    const matrixJsonPath = path.join(dir, "component-cutover-matrix.json");
    fs.writeFileSync(logPath, "", "utf8");
    fs.writeFileSync(
      matrixJsonPath,
      JSON.stringify(
        {
          version: 1,
          levels: ["repo-landed", "baseline-proved"],
          components: {
            "wave-parser-and-launcher": {
              title: "Wave parser and launcher",
              currentLevel: "repo-landed",
              promotions: [{ wave: 2, target: "baseline-proved" }],
              canonicalDocs: ["README.md"],
              proofSurfaces: ["launcher dry-run"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      readWaveComponentMatrixGate(
        {
          wave: 2,
          documentationAgentId: "A9",
          componentPromotions: [
            {
              componentId: "wave-parser-and-launcher",
              targetLevel: "baseline-proved",
            },
          ],
        },
        [
          {
            agent: { agentId: "A9" },
            logPath,
          },
        ],
        {
          documentationAgentId: "A9",
          laneProfile: {
            validation: { requireComponentPromotionsFromWave: 0 },
            paths: {
              componentCutoverMatrixJsonPath: path.relative(process.cwd(), matrixJsonPath),
              componentCutoverMatrixDocPath: "docs/plans/component-cutover-matrix.md",
            },
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      agentId: "A9",
      componentId: "wave-parser-and-launcher",
      statusCode: "component-current-level-stale",
    });
  });
});

describe("markLauncherFailed", () => {
  it("marks the global dashboard as failed and records coordination output", () => {
    const dir = makeTempDir();
    const coordinationEvents = [];
    const globalDashboard = {
      status: "running",
      events: [],
      waves: [],
    };

    markLauncherFailed(
      globalDashboard,
      {
        lane: "leap-claw",
        globalDashboardPath: path.join(dir, "global.json"),
      },
      [0],
      (entry) => coordinationEvents.push(entry),
      new Error("boom"),
    );

    expect(globalDashboard.status).toBe("failed");
    expect(globalDashboard.events.at(-1)).toMatchObject({
      level: "error",
      message: "boom",
    });
    expect(coordinationEvents[0]).toMatchObject({
      event: "launcher_finish",
      status: "failed",
    });
  });
});

describe("lifecycle control-plane authorship", () => {
  it("keeps wave/attempt/agent lifecycle event definitions in the session supervisor", () => {
    const launcherSource = fs.readFileSync(
      path.join(process.cwd(), "scripts", "wave-orchestrator", "launcher.mjs"),
      "utf8",
    );
    const supervisorSource = fs.readFileSync(
      path.join(process.cwd(), "scripts", "wave-orchestrator", "session-supervisor.mjs"),
      "utf8",
    );

    expect(launcherSource).not.toContain('entityType: "agent_run"');
    expect(launcherSource).not.toContain('entityType: "wave_run"');
    expect(launcherSource).not.toContain('entityType: "attempt"');
    expect(supervisorSource).toContain('entityType: "agent_run"');
    expect(supervisorSource).toContain('entityType: "wave_run"');
    expect(supervisorSource).toContain('entityType: "attempt"');
  });
});

describe("hasReusableSuccessStatus", () => {
  it("requires matching prompt metadata including resolved Context7 scope", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "wave-0-a1.status");
    const agent = {
      prompt: [
        "You are the standing implementation role for this wave.",
        "",
        "Implement the provider runtime contract.",
      ].join("\n"),
      context7Resolved: {
        bundleId: "plugins",
        query: "TypeScript module resolution and declarations",
        libraries: [{ libraryName: "typescript", libraryId: "/microsoft/typescript" }],
        selectionHash: "context7-hash-one",
      },
    };

    fs.writeFileSync(statusPath, "0\n", "utf8");
    expect(hasReusableSuccessStatus(agent, statusPath)).toBe(false);

    fs.writeFileSync(
      statusPath,
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(agent),
        },
        null,
        2,
      ),
      "utf8",
    );
    expect(hasReusableSuccessStatus(agent, statusPath)).toBe(true);

    const changedAgent = {
      ...agent,
      context7Resolved: {
        ...agent.context7Resolved,
        selectionHash: "context7-hash-two",
      },
    };
    expect(hashAgentPromptFingerprint(changedAgent)).not.toBe(hashAgentPromptFingerprint(agent));
    expect(hasReusableSuccessStatus(changedAgent, statusPath)).toBe(false);
  });

  it("rejects proof-centric reuse when required proof artifacts are missing", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "wave-8-a6.status");
    const summaryPath = statusPath.replace(/\.status$/, ".summary.json");
    const agent = {
      agentId: "A6",
      prompt: "Validate live proof.",
      components: ["learning-memory-action-plane"],
      componentTargets: {
        "learning-memory-action-plane": "pilot-live",
      },
      exitContract: {
        completion: "live",
        durability: "durable",
        proof: "live",
        docImpact: "none",
      },
      proofArtifacts: [
        {
          path: ".tmp/wave-8-learning-proof/learning-plane-after-restart.json",
          kind: "restart-check",
          requiredFor: ["pilot-live"],
        },
      ],
    };

    fs.writeFileSync(
      statusPath,
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(agent),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          proof: {
            completion: "live",
            durability: "durable",
            proof: "live",
            state: "met",
          },
          docDelta: {
            state: "none",
            paths: [],
          },
          proofArtifacts: [
            {
              path: ".tmp/wave-8-learning-proof/learning-plane-after-restart.json",
              kind: "restart-check",
              requiredFor: ["pilot-live"],
              exists: false,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      hasReusableSuccessStatus(agent, statusPath, {
        wave: {
          componentPromotions: [
            {
              componentId: "learning-memory-action-plane",
              targetLevel: "pilot-live",
            },
          ],
        },
        derivedState: {
          coordinationState: {
            clarifications: [],
            humanEscalations: [],
            humanFeedback: [],
          },
          capabilityAssignments: [],
          dependencySnapshot: {
            requiredInbound: [],
            requiredOutbound: [],
            unresolvedInboundAssignments: [],
          },
        },
      }),
    ).toBe(false);
  });

  it("refreshes stale proof-centric summaries from the agent log before reuse validation", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "wave-8-a6.status");
    const summaryPath = statusPath.replace(/\.status$/, ".summary.json");
    const logPath = path.join(dir, "wave-8-a6.log");
    const agent = {
      agentId: "A6",
      prompt: "Validate live proof.",
      components: ["learning-memory-action-plane"],
      componentTargets: {
        "learning-memory-action-plane": "pilot-live",
      },
      exitContract: {
        completion: "live",
        durability: "durable",
        proof: "live",
        docImpact: "none",
      },
    };

    fs.writeFileSync(
      statusPath,
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(agent),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          proof: null,
          docDelta: null,
          components: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      logPath,
      [
        "- [wave-proof] completion=live durability=durable proof=live state=met detail=live-proof",
        "- [wave-doc-delta] state=none detail=no-docs",
        "- [wave-component] component=learning-memory-action-plane level=pilot-live state=met detail=component-met",
      ].join("\n"),
      "utf8",
    );

    expect(
      hasReusableSuccessStatus(agent, statusPath, {
        wave: {
          componentPromotions: [
            {
              componentId: "learning-memory-action-plane",
              targetLevel: "pilot-live",
            },
          ],
        },
        derivedState: {
          coordinationState: {
            clarifications: [],
            humanEscalations: [],
            humanFeedback: [],
          },
          capabilityAssignments: [],
          dependencySnapshot: {
            requiredInbound: [],
            requiredOutbound: [],
            unresolvedInboundAssignments: [],
          },
        },
        logPath,
      }),
    ).toBe(true);

    const refreshed = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    expect(refreshed.proof).toMatchObject({ state: "met", proof: "live" });
    expect(refreshed.structuredSignalDiagnostics).toBeTruthy();
  });
});

describe("selectReusablePreCompletedAgentIds", () => {
  it("excludes closure agents from precompleted reuse selection", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const a1StatusPath = path.join(dir, "wave-0-a1.status");
    const a8StatusPath = path.join(dir, "wave-0-a8.status");
    const a1 = {
      agentId: "A1",
      prompt: "Implement the runtime fix.",
    };
    const a8 = {
      agentId: "A8",
      prompt: "Integrate the implementation slices.",
    };

    fs.writeFileSync(
      a1StatusPath,
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(a1),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      a8StatusPath,
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(a8),
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      Array.from(
        selectReusablePreCompletedAgentIds(
          [
            { agent: a1, statusPath: a1StatusPath },
            { agent: a8, statusPath: a8StatusPath },
          ],
          lanePaths,
        ),
      ),
    ).toEqual(["A1"]);
  });

  it("treats custom security reviewers as closure agents for reuse selection", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.securityRolePromptPath = "docs/agents/custom-security-role.md";
    const a1StatusPath = path.join(dir, "wave-0-a1.status");
    const a7StatusPath = path.join(dir, "wave-0-a7.status");
    const a1 = {
      agentId: "A1",
      prompt: "Implement the runtime fix.",
    };
    const a7 = {
      agentId: "A7",
      title: "Security Engineer",
      rolePromptPaths: ["docs/agents/custom-security-role.md"],
      ownedPaths: ["docs/security-review.md"],
      prompt: "Review the implementation for security risks.",
    };

    fs.writeFileSync(
      a1StatusPath,
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(a1),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      a7StatusPath,
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(a7),
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      Array.from(
        selectReusablePreCompletedAgentIds(
          [
            { agent: a1, statusPath: a1StatusPath },
            { agent: a7, statusPath: a7StatusPath },
          ],
          lanePaths,
          {
            wave: {
              agents: [a1, a7],
            },
          },
        ),
      ),
    ).toEqual(["A1"]);
  });
});

describe("cleanupLaunchedRun", () => {
  it("terminates process-backed runtime records before tmux cleanup", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const runtimePath = path.join(dir, "wave-0-orch.runtime.json");
    fs.writeFileSync(
      runtimePath,
      JSON.stringify(
        {
          agentId: "ORCH",
          sessionBackend: "process",
          runnerPid: 1234,
          pgid: 1234,
        },
        null,
        2,
      ),
      "utf8",
    );
    const calls = [];

    await cleanupLaunchedRun(
      lanePaths,
      {
        sessionName: "oc_leap_claw_wave0_orch",
        runtimePath,
      },
      {
        terminateRuntimeFn: async (runtimeRecord) => {
          calls.push({ type: "terminate", runtimeRecord });
          return true;
        },
        killSessionFn: async (_socketName, sessionName) => {
          calls.push({ type: "tmux", sessionName });
        },
      },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      type: "terminate",
      runtimeRecord: { agentId: "ORCH", sessionBackend: "process" },
    });
    expect(calls[1]).toMatchObject({
      type: "tmux",
      sessionName: "oc_leap_claw_wave0_orch",
    });
  });
});

describe("buildCodexExecInvocation", () => {
  it("uses danger-full-access by default for codex wave runs", () => {
    const command = buildCodexExecInvocation(
      "/repo/.tmp/prompts/wave-4-a0.prompt.md",
      "/repo/.tmp/logs/wave-4-a0.log",
      DEFAULT_CODEX_SANDBOX_MODE,
    );

    expect(command).toContain("codex --ask-for-approval never exec");
    expect(command).toContain("--ask-for-approval never");
    expect(command).toContain(`--sandbox '${DEFAULT_CODEX_SANDBOX_MODE}'`);
  });
});

describe("launcher lock handling", () => {
  it("rejects a live lock and reclaims a stale one", () => {
    const dir = makeTempDir();
    const lockPath = path.join(dir, "launcher.lock");

    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    expect(() =>
      acquireLauncherLock(lockPath, {
        lane: "leap-claw",
        reconcileStatus: false,
      }),
    ).toThrow(/Another launcher is active/);

    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: 999999,
          startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    expect(
      acquireLauncherLock(lockPath, {
        lane: "leap-claw",
        reconcileStatus: false,
      }),
    ).toMatchObject({
      lane: "leap-claw",
      pid: process.pid,
    });
    releaseLauncherLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("reconcileStaleLauncherArtifacts", () => {
  it("removes stale lane artifacts while preserving reusable state and non-lane terminals", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const lockPath = lanePaths.launcherLockPath;
    const globalDashboardPath = lanePaths.globalDashboardPath;
    const waveDashboardPath = path.join(lanePaths.dashboardsDir, "wave-4.json");
    const statusPath = path.join(dir, "status", "wave-4-a1.status");

    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: 999999,
          startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "abc123" }, null, 2), "utf8");
    fs.writeFileSync(waveDashboardPath, JSON.stringify({ status: "running" }, null, 2), "utf8");
    fs.writeFileSync(
      globalDashboardPath,
      JSON.stringify(
        {
          status: "running",
          waves: [
            {
              wave: 4,
              status: "running",
              dashboardPath: path.relative(process.cwd(), waveDashboardPath),
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      lanePaths.terminalsPath,
      JSON.stringify(
        {
          terminals: [
            {
              name: "leap-claw-wave4-a1",
              command: `TMUX= tmux -L ${lanePaths.tmuxSocketName} new -As oc_leap_claw_wave4_a1`,
            },
            {
              name: "codex1",
              command: "bash -lc 'echo helper'",
            },
          ],
          autorun: true,
          env: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(reconcileStaleLauncherArtifacts(lanePaths)).resolves.toMatchObject({
      removedLock: true,
      clearedDashboards: true,
      staleWaves: [4],
    });
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(globalDashboardPath)).toBe(false);
    expect(fs.existsSync(waveDashboardPath)).toBe(false);
    expect(fs.existsSync(statusPath)).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(lanePaths.terminalsPath, "utf8")).terminals.map((terminal) => terminal.name),
    ).toEqual(["codex1"]);
  });
});

describe("collectUnexpectedSessionWarnings", () => {
  it("reads warning-only terminal projection loss from runtime records", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const logPath = path.join(dir, "wave-4-a1.log");
    const statusPath = path.join(dir, "wave-4-a1.status");
    const runtimePath = path.join(dir, "wave-4-a1.runtime.json");

    fs.writeFileSync(logPath, "", "utf8");
    fs.writeFileSync(
      runtimePath,
      JSON.stringify(
        {
          agentId: "A1",
          terminalDisposition: "projection-missing",
          lastHeartbeatAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      collectUnexpectedSessionWarnings(
        lanePaths,
        [
          {
            agent: { agentId: "A1" },
            sessionName: "oc_leap_claw_wave4_a1",
            statusPath,
            logPath,
            runtimePath,
          },
        ],
        new Set(["A1"]),
      ),
    ).toMatchObject([
      {
        agentId: "A1",
        statusCode: "terminal-session-missing",
      },
    ]);
  });
});

describe("runClosureSweepPhase required stage checks", () => {
  it("fails when a required closure stage is missing from the closure run set", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const coordinationLogPath = path.join(dir, "coordination.jsonl");
    const dashboardState = { agents: [], attempt: 1 };

    const result = await runClosureSweepEnginePhase({
      lanePaths,
      wave: {
        wave: 4,
        agents: [{ agentId: "A8" }, { agentId: "A9" }, { agentId: "A0" }],
      },
      closureRuns: [
        {
          agent: { agentId: "A9" },
          sessionName: "wave-4-a9",
          promptPath: path.join(dir, "A9.prompt.md"),
          logPath: path.join(dir, "A9.log"),
          statusPath: path.join(dir, "A9.status.json"),
          messageBoardPath: path.join(dir, "board.md"),
          sharedSummaryPath: path.join(dir, "shared.md"),
          inboxPath: path.join(dir, "A9.md"),
        },
        {
          agent: { agentId: "A0" },
          sessionName: "wave-4-a0",
          promptPath: path.join(dir, "A0.prompt.md"),
          logPath: path.join(dir, "A0.log"),
          statusPath: path.join(dir, "A0.status.json"),
          messageBoardPath: path.join(dir, "board.md"),
          sharedSummaryPath: path.join(dir, "shared.md"),
          inboxPath: path.join(dir, "A0.md"),
        },
      ],
      coordinationLogPath,
      refreshDerivedState: () => ({}),
      dashboardState,
      recordCombinedEvent: () => {},
      flushDashboards: () => {},
      options: {
        timeoutMinutes: 1,
        codexSandboxMode: null,
        agentRateLimitRetries: 0,
        agentRateLimitBaseDelaySeconds: 1,
        agentRateLimitMaxDelaySeconds: 1,
        context7Enabled: false,
      },
      feedbackStateByRequestId: new Map(),
      appendCoordination: () => {},
      launchAgentSessionFn: async () => ({}),
      waitForWaveCompletionFn: async () => ({ failures: [], timedOut: false }),
    });

    expect(result).toMatchObject({
      timedOut: false,
      failures: [
        {
          statusCode: "missing-closure-run",
          agentId: "A8",
        },
      ],
    });
  });

  it("keeps custom security reviewers in the security-review stage", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.securityRolePromptPath = "docs/agents/custom-security-role.md";
    const securityRun = {
      agent: {
        agentId: "A7",
        title: "Security Engineer",
        rolePromptPaths: ["docs/agents/custom-security-role.md"],
        ownedPaths: ["docs/security-review.md"],
      },
      sessionName: "wave-a7",
      promptPath: path.join(dir, "A7.prompt.md"),
      logPath: path.join(dir, "A7.log"),
      statusPath: path.join(dir, "A7.status.json"),
    };

    const stages = planClosureStages({
      lanePaths,
      wave: {
        wave: 4,
        agents: [securityRun.agent, { agentId: "A8" }, { agentId: "A9" }, { agentId: "A0" }],
        integrationAgentId: "A8",
        documentationAgentId: "A9",
        contQaAgentId: "A0",
      },
      closureRuns: [securityRun],
    });

    expect(stages.find((stage) => stage.key === "security-review")?.runs).toEqual([securityRun]);
  });
});

describe("formatReconcileBlockedWaveLine", () => {
  it("renders blocked reconciliation reasons in a single operator-facing line", () => {
    expect(
      formatReconcileBlockedWaveLine({
        wave: 200,
        reasons: [
          {
            code: "missing-status",
            detail: "Missing status files for A0, A9.",
          },
          {
            code: "open-human-escalation",
            detail: "Open human escalation records: escalation-1.",
          },
        ],
      }),
    ).toBe(
      "[reconcile] wave 200 not reconstructable: missing-status=Missing status files for A0, A9.; open-human-escalation=Open human escalation records: escalation-1.",
    );
  });
});
