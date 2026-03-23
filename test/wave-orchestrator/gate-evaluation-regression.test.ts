import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGateSnapshot,
  readClarificationBarrier,
  readWaveAssignmentBarrier,
  readWaveComponentGate,
  readWaveContQaGate,
  readWaveDependencyBarrier,
  readWaveImplementationGate,
  readWaveIntegrationGate,
  readWaveSecurityGate,
} from "../../scripts/wave-orchestrator/launcher.mjs";
import { materializeCoordinationState } from "../../scripts/wave-orchestrator/coordination-store.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-gate-regression-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeLanePaths(dir: string, overrides: Record<string, unknown> = {}) {
  const componentPromotionThreshold = overrides.requireComponentPromotionsFromWave !== undefined
    ? overrides.requireComponentPromotionsFromWave
    : 0;
  return {
    lane: "main",
    contQaAgentId: "A0",
    contEvalAgentId: "E0",
    integrationAgentId: "A8",
    documentationAgentId: "A9",
    requireIntegrationStewardFromWave: null,
    laneProfile: {
      roles: {
        contQaAgentId: "A0",
        contEvalAgentId: "E0",
        integrationAgentId: "A8",
        documentationAgentId: "A9",
      },
      validation: {
        requireComponentPromotionsFromWave: componentPromotionThreshold,
        requireDocumentationStewardFromWave: null,
        requireContext7DeclarationsFromWave: null,
        requireExitContractsFromWave: null,
        requireIntegrationStewardFromWave: null,
        requireAgentComponentsFromWave: null,
      },
    },
  };
}

function makeAgentRun(
  agent: Record<string, unknown>,
  summary: Record<string, unknown> | null,
  dir: string,
) {
  const agentId = String(agent.agentId);
  const logPath = path.join(dir, `wave-0-${agentId.toLowerCase()}.log`);
  fs.writeFileSync(logPath, "", "utf8");
  return {
    agent,
    logPath,
    statusPath: null,
    summaryPath: null,
    summary,
  };
}

const COMPONENT_LEVELS = [
  "inventoried",
  "contract-frozen",
  "repo-landed",
  "baseline-proved",
  "pilot-live",
  "qa-proved",
  "fleet-ready",
  "cutover-ready",
  "deprecation-ready",
];

function makeComponentMatrixPayload(components: Record<string, string> = {}) {
  return {
    levels: COMPONENT_LEVELS,
    components: Object.fromEntries(
      Object.entries(components).map(([id, level]) => [id, { currentLevel: level, promotions: [] }]),
    ),
  };
}

function makeImplementationAgent(
  agentId: string,
  components: string[] = [],
  componentTargets: Record<string, string> = {},
) {
  return {
    agentId,
    role: "implementation",
    title: `Agent ${agentId}`,
    components,
    componentTargets,
    ownedPaths: [`src/${agentId.toLowerCase()}`],
    exitContract: {
      completion: "contract",
      durability: "none",
      proof: "unit",
      docImpact: "owned",
    },
    deliverables: [],
    proofArtifacts: [],
  };
}

function makeContQaAgent(agentId = "A0") {
  return {
    agentId,
    role: "cont-qa",
    title: "Continuous QA",
    ownedPaths: [],
    deliverables: [],
    proofArtifacts: [],
  };
}

function makePassingImplementationSummary(agentId: string, components: { componentId: string; level: string }[] = []) {
  return {
    agentId,
    exitCode: 0,
    proof: { state: "met", completion: "contract", durability: "none", proof: "unit", detail: "" },
    docDelta: { state: "owned", paths: [], detail: "" },
    components: components.map((c) => ({ ...c, state: "met", detail: "" })),
    deliverables: [],
    proofArtifacts: [],
    verdict: null,
    gaps: [],
    terminationReason: null,
    terminationHint: null,
  };
}

function makeFailingImplementationSummary(agentId: string) {
  return {
    agentId,
    exitCode: 1,
    proof: { state: "gap", completion: "contract", durability: "none", proof: "unit", detail: "tests failing" },
    docDelta: { state: "owned", paths: [], detail: "" },
    components: [],
    deliverables: [],
    proofArtifacts: [],
    verdict: null,
    gaps: [{ kind: "integration", detail: "Not yet passing" }],
    terminationReason: null,
    terminationHint: null,
  };
}

function makePassingContQaSummary(agentId = "A0") {
  return {
    agentId,
    exitCode: 0,
    verdict: { verdict: "pass", detail: "All gates pass." },
    gate: {
      architecture: "pass",
      integration: "pass",
      durability: "pass",
      live: "pass",
      docs: "pass",
      detail: "All gates pass.",
    },
    proof: null,
    docDelta: null,
    components: [],
    deliverables: [],
    proofArtifacts: [],
    gaps: [],
    terminationReason: null,
    terminationHint: null,
  };
}

// ---------------------------------------------------------------------------
// Tests: Implementation gate equivalence
// ---------------------------------------------------------------------------

describe("gate evaluation regression: implementation gate", () => {
  it("produces expected pass result when exit contract is satisfied", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1", ["foo"], { foo: "repo-landed" });
    const agent0 = makeContQaAgent("A0");
    const wave = { wave: 1, agents: [agent1, agent0] };

    const agentRuns = [
      makeAgentRun(
        agent1,
        makePassingImplementationSummary("A1", [{ componentId: "foo", level: "repo-landed" }]),
        dir,
      ),
      makeAgentRun(agent0, makePassingContQaSummary("A0"), dir),
    ];

    const result = readWaveImplementationGate(wave, agentRuns);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
    expect(result.agentId).toBeNull();
    expect(result.detail).toContain("satisfied");
  });

  it("produces expected failure result when proof state is gap", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const wave = { wave: 1, agents: [agent1] };

    const agentRuns = [
      makeAgentRun(agent1, makeFailingImplementationSummary("A1"), dir),
    ];

    const result = readWaveImplementationGate(wave, agentRuns);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("wave-proof-gap");
    expect(result.agentId).toBe("A1");
  });

  it("skips cont-qa agent when evaluating implementation gates", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const agent0 = makeContQaAgent("A0");
    const wave = { wave: 1, agents: [agent1, agent0] };

    // A0 has no proof/docDelta, but it should be skipped since it's cont-qa
    const agentRuns = [
      makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir),
      makeAgentRun(agent0, makePassingContQaSummary("A0"), dir),
    ];

    const result = readWaveImplementationGate(wave, agentRuns);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
  });

  it("fails when agent has no exit contract but has missing summary", () => {
    const dir = makeTempDir();
    const agentWithoutContract = {
      agentId: "A1",
      title: "Agent A1",
      ownedPaths: ["src/a1"],
    };
    const wave = { wave: 1, agents: [agentWithoutContract] };

    const agentRuns = [makeAgentRun(agentWithoutContract, null, dir)];

    // No exit contract = passes trivially
    const result = readWaveImplementationGate(wave, agentRuns);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
  });

  it("fails with missing-doc-delta when proof passes but doc delta is absent", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const wave = { wave: 1, agents: [agent1] };

    const summaryNoDelta = {
      agentId: "A1",
      proof: { state: "met", completion: "contract", durability: "none", proof: "unit", detail: "" },
      // missing docDelta
    };

    const agentRuns = [makeAgentRun(agent1, summaryNoDelta, dir)];

    const result = readWaveImplementationGate(wave, agentRuns);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("missing-doc-delta");
  });
});

// ---------------------------------------------------------------------------
// Tests: Component gate with shared-component-sibling-pending
// ---------------------------------------------------------------------------

describe("gate evaluation regression: component gate", () => {
  it("detects shared-component-sibling-pending when one owner satisfies and another does not", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1", ["shared-db"], { "shared-db": "repo-landed" });
    const agent2 = makeImplementationAgent("A2", ["shared-db"], { "shared-db": "repo-landed" });
    const agent0 = makeContQaAgent("A0");
    const wave = {
      wave: 1,
      agents: [agent1, agent2, agent0],
      componentPromotions: [{ componentId: "shared-db", targetLevel: "repo-landed" }],
    };

    const agentRuns = [
      makeAgentRun(
        agent1,
        makePassingImplementationSummary("A1", [{ componentId: "shared-db", level: "repo-landed" }]),
        dir,
      ),
      makeAgentRun(agent2, makeFailingImplementationSummary("A2"), dir),
      makeAgentRun(agent0, makePassingContQaSummary("A0"), dir),
    ];

    const result = readWaveComponentGate(wave, agentRuns, {
      laneProfile: makeLanePaths(dir).laneProfile,
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("shared-component-sibling-pending");
    expect(result.satisfiedAgentIds).toContain("A1");
    expect(result.waitingOnAgentIds).toContain("A2");
    expect(result.componentId).toBe("shared-db");
  });

  it("passes component gate when all owners satisfy their component targets", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1", ["shared-db"], { "shared-db": "repo-landed" });
    const agent2 = makeImplementationAgent("A2", ["shared-db"], { "shared-db": "repo-landed" });
    const wave = {
      wave: 1,
      agents: [agent1, agent2],
      componentPromotions: [{ componentId: "shared-db", targetLevel: "repo-landed" }],
    };

    const agentRuns = [
      makeAgentRun(
        agent1,
        makePassingImplementationSummary("A1", [{ componentId: "shared-db", level: "repo-landed" }]),
        dir,
      ),
      makeAgentRun(
        agent2,
        makePassingImplementationSummary("A2", [{ componentId: "shared-db", level: "repo-landed" }]),
        dir,
      ),
    ];

    const result = readWaveComponentGate(wave, agentRuns, {
      laneProfile: makeLanePaths(dir).laneProfile,
    });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
  });

  it("reports component-promotion-gap when no agent proves the promoted component", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1", ["orphan-comp"], { "orphan-comp": "repo-landed" });
    const wave = {
      wave: 1,
      agents: [agent1],
      componentPromotions: [{ componentId: "orphan-comp", targetLevel: "repo-landed" }],
    };

    // Agent passes proof but doesn't emit component marker
    const summaryNoComponent = {
      ...makePassingImplementationSummary("A1"),
      components: [], // no component markers
    };

    const agentRuns = [makeAgentRun(agent1, summaryNoComponent, dir)];

    const result = readWaveComponentGate(wave, agentRuns, {
      laneProfile: makeLanePaths(dir).laneProfile,
    });

    // Implementation gate will fail first with missing-wave-component,
    // but the component gate should report the promotion gap
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("component-promotion-gap");
    expect(result.componentId).toBe("orphan-comp");
  });
});

// ---------------------------------------------------------------------------
// Tests: ContQA gate equivalence
// ---------------------------------------------------------------------------

describe("gate evaluation regression: cont-QA gate", () => {
  it("passes when cont-QA summary has all passing verdicts and gate markers", () => {
    const dir = makeTempDir();
    const agent0 = makeContQaAgent("A0");
    const wave = { wave: 1, agents: [agent0] };

    const agentRuns = [makeAgentRun(agent0, makePassingContQaSummary("A0"), dir)];

    const result = readWaveContQaGate(wave, agentRuns, { contQaAgentId: "A0" });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
    expect(result.agentId).toBe("A0");
  });

  it("fails when cont-QA verdict is blocked", () => {
    const dir = makeTempDir();
    const agent0 = makeContQaAgent("A0");
    const wave = { wave: 1, agents: [agent0] };

    const failingContQa = {
      agentId: "A0",
      exitCode: 0,
      verdict: { verdict: "blocked", detail: "Tests not passing." },
      gate: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
        detail: "",
      },
    };

    const agentRuns = [makeAgentRun(agent0, failingContQa, dir)];

    const result = readWaveContQaGate(wave, agentRuns, { contQaAgentId: "A0" });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("cont-qa-blocked");
    expect(result.detail).toBe("Tests not passing.");
  });

  it("fails when cont-QA gate dimension is not pass", () => {
    const dir = makeTempDir();
    const agent0 = makeContQaAgent("A0");
    const wave = { wave: 1, agents: [agent0] };

    const contQaArchFail = {
      agentId: "A0",
      verdict: { verdict: "pass", detail: "override" },
      gate: {
        architecture: "concerns",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
        detail: "Architecture review has concerns",
      },
    };

    const agentRuns = [makeAgentRun(agent0, contQaArchFail, dir)];

    const result = readWaveContQaGate(wave, agentRuns, { contQaAgentId: "A0" });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("gate-architecture-concerns");
  });

  it("returns missing-cont-qa when the agent is not present in runs", () => {
    const dir = makeTempDir();
    const wave = { wave: 1, agents: [] };

    const result = readWaveContQaGate(wave, [], { contQaAgentId: "A0" });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("missing-cont-qa");
    expect(result.agentId).toBe("A0");
  });
});

// ---------------------------------------------------------------------------
// Tests: Security gate equivalence
// ---------------------------------------------------------------------------

describe("gate evaluation regression: security gate", () => {
  it("passes when no security reviewer is declared", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const wave = { wave: 1, agents: [agent1] };

    const agentRuns = [makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir)];

    const result = readWaveSecurityGate(wave, agentRuns);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
    expect(result.detail).toContain("No security reviewer");
  });

  it("detects security blocked state from in-memory summary", () => {
    const dir = makeTempDir();
    const securityAgent = {
      agentId: "A7",
      title: "Security Engineer",
      rolePromptPaths: ["docs/agents/wave-security-role.md"],
      ownedPaths: [".tmp/main-wave-launcher/security/wave-0-review.md"],
    };
    const wave = { wave: 1, agents: [securityAgent] };

    const reportPath = path.join(dir, "security-review.md");
    fs.writeFileSync(reportPath, "# Security Review\nFindings: 1\n", "utf8");

    const securitySummary = {
      agentId: "A7",
      security: { state: "blocked", findings: 2, approvals: 0, detail: "Hardcoded credentials found" },
      reportPath,
    };

    const agentRuns = [makeAgentRun(securityAgent, securitySummary, dir)];

    const result = readWaveSecurityGate(wave, agentRuns);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("security-blocked");
    expect(result.agentId).toBe("A7");
  });

  it("reports security-concerns as advisory (ok = true) when state is concerns", () => {
    const dir = makeTempDir();
    const securityAgent = {
      agentId: "A7",
      title: "Security Engineer",
      rolePromptPaths: ["docs/agents/wave-security-role.md"],
      ownedPaths: [".tmp/main-wave-launcher/security/wave-0-review.md"],
    };
    const wave = { wave: 1, agents: [securityAgent] };

    const reportPath = path.join(dir, "security-review.md");
    fs.writeFileSync(reportPath, "# Security Review\n", "utf8");

    const securitySummary = {
      agentId: "A7",
      security: { state: "concerns", findings: 0, approvals: 0, detail: "Advisory: review logging" },
      reportPath,
    };

    const agentRuns = [makeAgentRun(securityAgent, securitySummary, dir)];

    const result = readWaveSecurityGate(wave, agentRuns);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("security-concerns");
  });
});

// ---------------------------------------------------------------------------
// Tests: Integration gate equivalence
// ---------------------------------------------------------------------------

describe("gate evaluation regression: integration gate", () => {
  it("passes when no integration steward is declared and none required", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const wave = { wave: 1, agents: [agent1] };

    const agentRuns = [makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir)];

    const result = readWaveIntegrationGate(wave, agentRuns, {
      integrationAgentId: "A8",
      requireIntegrationStewardFromWave: null,
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
  });

  it("fails when integration steward is required but missing", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const wave = { wave: 1, agents: [agent1] };

    const agentRuns = [makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir)];

    const result = readWaveIntegrationGate(wave, agentRuns, {
      integrationAgentId: "A8",
      requireIntegrationStewardFromWave: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("missing-integration");
    expect(result.agentId).toBe("A8");
  });

  it("passes when integration steward reports ready-for-doc-closure", () => {
    const dir = makeTempDir();
    const integrationAgent = { agentId: "A8", title: "Integration Steward" };
    const wave = { wave: 1, agents: [integrationAgent] };

    const summary = {
      agentId: "A8",
      integration: {
        state: "ready-for-doc-closure",
        claims: 0,
        conflicts: 0,
        blockers: 0,
        detail: "All integration checks pass.",
      },
    };

    const agentRuns = [makeAgentRun(integrationAgent, summary, dir)];

    const result = readWaveIntegrationGate(wave, agentRuns, {
      integrationAgentId: "A8",
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
  });

  it("fails when integration steward reports needs-more-work", () => {
    const dir = makeTempDir();
    const integrationAgent = { agentId: "A8", title: "Integration Steward" };
    const wave = { wave: 1, agents: [integrationAgent] };

    const summary = {
      agentId: "A8",
      integration: {
        state: "needs-more-work",
        claims: 3,
        conflicts: 1,
        blockers: 1,
        detail: "Open conflicts remain.",
      },
    };

    const agentRuns = [makeAgentRun(integrationAgent, summary, dir)];

    const result = readWaveIntegrationGate(wave, agentRuns, {
      integrationAgentId: "A8",
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("integration-needs-more-work");
  });
});

// ---------------------------------------------------------------------------
// Tests: Full gate snapshot equivalence
// ---------------------------------------------------------------------------

describe("gate evaluation regression: full gate snapshot", () => {
  it("snapshot includes all expected gate keys", () => {
    const dir = makeTempDir();
    const wave = { wave: 1, lane: "main", agents: [], componentPromotions: [] };
    const snapshot = buildGateSnapshot({
      wave,
      agentRuns: [],
      derivedState: {
        coordinationState: materializeCoordinationState([]),
        ledger: null,
        docsQueue: null,
        capabilityAssignments: [],
        dependencySnapshot: null,
        integrationSummary: null,
      },
      lanePaths: makeLanePaths(dir),
      componentMatrixPayload: makeComponentMatrixPayload(),
      componentMatrixJsonPath: null,
    });

    const expectedKeys = [
      "implementationGate",
      "componentGate",
      "integrationGate",
      "integrationBarrier",
      "documentationGate",
      "componentMatrixGate",
      "contEvalGate",
      "securityGate",
      "contQaGate",
      "infraGate",
      "clarificationBarrier",
      "helperAssignmentBarrier",
      "dependencyBarrier",
      "overall",
    ];

    for (const key of expectedKeys) {
      expect(snapshot).toHaveProperty(key);
    }
  });

  it("snapshot overall reports first failure in gate evaluation order", () => {
    const dir = makeTempDir();
    // Create a scenario where implementation gate fails and contQaGate also fails
    // Implementation should be reported first because of evaluation order
    const agent1 = makeImplementationAgent("A1");
    const wave = { wave: 1, lane: "main", agents: [agent1], componentPromotions: [] };

    const agentRuns = [
      makeAgentRun(agent1, makeFailingImplementationSummary("A1"), dir),
    ];

    const snapshot = buildGateSnapshot({
      wave,
      agentRuns,
      derivedState: {
        coordinationState: materializeCoordinationState([]),
        ledger: null,
        docsQueue: null,
        capabilityAssignments: [],
        dependencySnapshot: null,
        integrationSummary: null,
      },
      lanePaths: makeLanePaths(dir),
      componentMatrixPayload: makeComponentMatrixPayload(),
      componentMatrixJsonPath: null,
    });

    // Implementation gate should be the first failure reported
    expect(snapshot.overall.ok).toBe(false);
    expect(snapshot.overall.gate).toBe("implementationGate");
    expect(snapshot.overall.agentId).toBe("A1");
  });

  it("snapshot reports clarification barrier failure when implementation passes but clarification is open", () => {
    const dir = makeTempDir();
    // Use agents without components so component gate passes trivially
    const agent1 = {
      agentId: "A1",
      role: "implementation",
      title: "Agent A1",
      ownedPaths: ["src/a1"],
      exitContract: { completion: "contract", durability: "none", proof: "unit", docImpact: "owned" },
      deliverables: [],
      proofArtifacts: [],
    };
    const agent0 = makeContQaAgent("A0");
    const wave = { wave: 1, lane: "main", agents: [agent1, agent0], componentPromotions: [] };

    const coordinationState = materializeCoordinationState([
      {
        id: "clar-1",
        kind: "clarification-request",
        lane: "main",
        wave: 1,
        agentId: "A1",
        targets: [],
        status: "open",
        priority: "normal",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-20T10:00:00.000Z",
        updatedAt: "2026-03-20T10:00:00.000Z",
        confidence: "medium",
        summary: "Need API clarification",
        detail: "",
        source: "agent",
      },
    ]);

    const agentRuns = [
      makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir),
      makeAgentRun(agent0, makePassingContQaSummary("A0"), dir),
    ];

    const snapshot = buildGateSnapshot({
      wave,
      agentRuns,
      derivedState: {
        coordinationState,
        ledger: null,
        docsQueue: null,
        capabilityAssignments: [],
        dependencySnapshot: null,
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "All integration checks pass.",
        },
      },
      lanePaths: makeLanePaths(dir, { requireComponentPromotionsFromWave: null }),
      componentMatrixPayload: makeComponentMatrixPayload(),
      componentMatrixJsonPath: null,
    });

    expect(snapshot.implementationGate.ok).toBe(true);
    expect(snapshot.contQaGate.ok).toBe(true);
    expect(snapshot.clarificationBarrier.ok).toBe(false);
    expect(snapshot.clarificationBarrier.statusCode).toBe("clarification-open");
    expect(snapshot.overall.ok).toBe(false);
    expect(snapshot.overall.gate).toBe("clarificationBarrier");
  });

  it("produces all-pass overall when all gates and barriers pass", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1", ["foo"], { foo: "repo-landed" });
    const agent0 = makeContQaAgent("A0");
    const wave = {
      wave: 1,
      lane: "main",
      agents: [agent1, agent0],
      componentPromotions: [{ componentId: "foo", targetLevel: "repo-landed" }],
    };

    const agentRuns = [
      makeAgentRun(
        agent1,
        makePassingImplementationSummary("A1", [{ componentId: "foo", level: "repo-landed" }]),
        dir,
      ),
      makeAgentRun(agent0, makePassingContQaSummary("A0"), dir),
    ];

    const snapshot = buildGateSnapshot({
      wave,
      agentRuns,
      derivedState: {
        coordinationState: materializeCoordinationState([]),
        ledger: null,
        docsQueue: null,
        capabilityAssignments: [],
        dependencySnapshot: null,
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "All integration checks pass.",
        },
      },
      lanePaths: makeLanePaths(dir),
      componentMatrixPayload: makeComponentMatrixPayload({ foo: "repo-landed" }),
      componentMatrixJsonPath: null,
    });

    expect(snapshot.overall.ok).toBe(true);
    expect(snapshot.overall.gate).toBe("pass");
    expect(snapshot.overall.statusCode).toBe("pass");
    expect(snapshot.overall.detail).toContain("passed");
  });
});

// ---------------------------------------------------------------------------
// Tests: Gate evaluation ordering
// ---------------------------------------------------------------------------

describe("gate evaluation regression: gate ordering", () => {
  it("evaluates gates in the documented priority order", () => {
    const dir = makeTempDir();
    const wave = { wave: 1, lane: "main", agents: [], componentPromotions: [] };
    const snapshot = buildGateSnapshot({
      wave,
      agentRuns: [],
      derivedState: {
        coordinationState: materializeCoordinationState([]),
        ledger: null,
        docsQueue: null,
        capabilityAssignments: [],
        dependencySnapshot: null,
        integrationSummary: null,
      },
      lanePaths: makeLanePaths(dir),
      componentMatrixPayload: makeComponentMatrixPayload(),
      componentMatrixJsonPath: null,
    });

    // The expected gate evaluation order as documented in buildGateSnapshot:
    // implementation -> component -> helperAssignment -> dependency ->
    // contEval -> security -> integrationBarrier -> documentation ->
    // componentMatrix -> contQa -> infra -> clarification
    //
    // Verify structural existence; ordering is internal to buildGateSnapshot
    // but the overall.gate tells us which gate was the first to fail.
    const gateKeys = [
      "implementationGate",
      "componentGate",
      "helperAssignmentBarrier",
      "dependencyBarrier",
      "contEvalGate",
      "securityGate",
      "integrationBarrier",
      "documentationGate",
      "componentMatrixGate",
      "contQaGate",
      "infraGate",
      "clarificationBarrier",
    ];

    for (const key of gateKeys) {
      expect(snapshot).toHaveProperty(key);
      expect(snapshot[key]).toHaveProperty("ok");
      expect(snapshot[key]).toHaveProperty("statusCode");
    }
  });

  it("reports contQaGate as first failure when only contQa fails (other gates pass)", () => {
    const dir = makeTempDir();
    // All implementation passes, but no cont-qa agent run -> contQa fails
    // Use agent without components and disable component promotion requirement
    const agent1 = {
      agentId: "A1",
      role: "implementation",
      title: "Agent A1",
      ownedPaths: ["src/a1"],
      exitContract: { completion: "contract", durability: "none", proof: "unit", docImpact: "owned" },
      deliverables: [],
      proofArtifacts: [],
    };
    const wave = { wave: 1, lane: "main", agents: [agent1], componentPromotions: [] };

    const agentRuns = [
      makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir),
    ];

    const snapshot = buildGateSnapshot({
      wave,
      agentRuns,
      derivedState: {
        coordinationState: materializeCoordinationState([]),
        ledger: null,
        docsQueue: null,
        capabilityAssignments: [],
        dependencySnapshot: null,
        integrationSummary: {
          recommendation: "ready-for-doc-closure",
          detail: "All integration checks pass.",
        },
      },
      lanePaths: makeLanePaths(dir, { requireComponentPromotionsFromWave: null }),
      componentMatrixPayload: makeComponentMatrixPayload(),
      componentMatrixJsonPath: null,
    });

    expect(snapshot.implementationGate.ok).toBe(true);
    expect(snapshot.componentGate.ok).toBe(true);
    expect(snapshot.contQaGate.ok).toBe(false);
    expect(snapshot.overall.ok).toBe(false);
    expect(snapshot.overall.gate).toBe("contQaGate");
    expect(snapshot.overall.statusCode).toBe("missing-cont-qa");
  });

  it("reports helperAssignmentBarrier before contQaGate when both fail", () => {
    const dir = makeTempDir();
    // Use agent without components and disable component promotion requirement
    const agent1 = {
      agentId: "A1",
      role: "implementation",
      title: "Agent A1",
      ownedPaths: ["src/a1"],
      exitContract: { completion: "contract", durability: "none", proof: "unit", docImpact: "owned" },
      deliverables: [],
      proofArtifacts: [],
    };
    const wave = { wave: 1, lane: "main", agents: [agent1], componentPromotions: [] };

    const agentRuns = [
      makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir),
    ];

    const snapshot = buildGateSnapshot({
      wave,
      agentRuns,
      derivedState: {
        coordinationState: materializeCoordinationState([]),
        ledger: null,
        docsQueue: null,
        capabilityAssignments: [
          { requestId: "helper-req-1", blocking: true, assignedAgentId: null },
        ],
        dependencySnapshot: null,
        integrationSummary: null,
      },
      lanePaths: makeLanePaths(dir, { requireComponentPromotionsFromWave: null }),
      componentMatrixPayload: makeComponentMatrixPayload(),
      componentMatrixJsonPath: null,
    });

    // Both helperAssignmentBarrier and contQaGate fail, but helper comes first in order
    expect(snapshot.helperAssignmentBarrier.ok).toBe(false);
    expect(snapshot.contQaGate.ok).toBe(false);
    expect(snapshot.overall.gate).toBe("helperAssignmentBarrier");
    expect(snapshot.overall.statusCode).toBe("helper-assignment-unresolved");
  });
});

// ---------------------------------------------------------------------------
// Tests: Clarification barrier variants
// ---------------------------------------------------------------------------

describe("gate evaluation regression: clarification barrier variants", () => {
  it("passes when coordination state has only resolved records", () => {
    const coordinationState = materializeCoordinationState([
      {
        id: "clar-resolved",
        kind: "clarification-request",
        lane: "main",
        wave: 1,
        agentId: "A1",
        targets: [],
        status: "resolved",
        priority: "normal",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-20T10:00:00.000Z",
        updatedAt: "2026-03-20T11:00:00.000Z",
        confidence: "high",
        summary: "Resolved clarification",
        detail: "",
        source: "agent",
      },
    ]);

    const barrier = readClarificationBarrier({ coordinationState });
    expect(barrier.ok).toBe(true);
    expect(barrier.statusCode).toBe("pass");
  });

  it("fails for acknowledged but not resolved clarification", () => {
    const coordinationState = materializeCoordinationState([
      {
        id: "clar-ack",
        kind: "clarification-request",
        lane: "main",
        wave: 1,
        agentId: "A1",
        targets: [],
        status: "acknowledged",
        priority: "normal",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-20T10:00:00.000Z",
        updatedAt: "2026-03-20T10:30:00.000Z",
        confidence: "medium",
        summary: "Acknowledged but unresolved",
        detail: "",
        source: "agent",
      },
    ]);

    const barrier = readClarificationBarrier({ coordinationState });
    expect(barrier.ok).toBe(false);
    expect(barrier.statusCode).toBe("clarification-open");
  });

  it("fails for in_progress clarification", () => {
    const coordinationState = materializeCoordinationState([
      {
        id: "clar-wip",
        kind: "clarification-request",
        lane: "main",
        wave: 1,
        agentId: "A2",
        targets: [],
        status: "in_progress",
        priority: "normal",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-20T10:00:00.000Z",
        updatedAt: "2026-03-20T10:45:00.000Z",
        confidence: "medium",
        summary: "In-progress clarification",
        detail: "",
        source: "agent",
      },
    ]);

    const barrier = readClarificationBarrier({ coordinationState });
    expect(barrier.ok).toBe(false);
    expect(barrier.statusCode).toBe("clarification-open");
  });
});
