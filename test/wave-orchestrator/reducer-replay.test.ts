import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGateSnapshot,
  readClarificationBarrier,
  readWaveAssignmentBarrier,
  readWaveComponentGate,
  readWaveDependencyBarrier,
  readWaveImplementationGate,
  readWaveSecurityGate,
} from "../../scripts/wave-orchestrator/launcher.mjs";
import { materializeCoordinationState } from "../../scripts/wave-orchestrator/coordination-store.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-replay-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Minimal lane paths used by buildGateSnapshot
function makeLanePaths(dir: string) {
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
        requireComponentPromotionsFromWave: 0,
        requireDocumentationStewardFromWave: null,
        requireContext7DeclarationsFromWave: null,
        requireExitContractsFromWave: null,
        requireIntegrationStewardFromWave: null,
        requireAgentComponentsFromWave: null,
      },
    },
  };
}

// Build a minimal agentRun entry with an in-memory summary
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

// Build a component cutover matrix payload for test scenarios.
// Even waves with no componentPromotions may need a valid payload if implementation agents exist
// and requireComponentPromotionsFromWave is set.
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

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

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
// Tests
// ---------------------------------------------------------------------------

describe("deterministic replay: empty wave", () => {
  it("overall gate fails when cont-qa agent is missing in an otherwise empty wave", () => {
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

    // Missing cont-qa means contQaGate fails
    expect(snapshot.contQaGate.ok).toBe(false);
    expect(snapshot.contQaGate.statusCode).toBe("missing-cont-qa");
    expect(snapshot.overall.ok).toBe(false);
  });
});

describe("deterministic replay: single successful implementation agent", () => {
  it("produces an all-pass snapshot when A1 passes and A0 (cont-QA) passes", () => {
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
          detail: "Integration steward signed off.",
        },
      },
      lanePaths: makeLanePaths(dir),
      componentMatrixPayload: makeComponentMatrixPayload({ foo: "repo-landed" }),
      componentMatrixJsonPath: null,
    });

    expect(snapshot.implementationGate.ok).toBe(true);
    expect(snapshot.implementationGate.statusCode).toBe("pass");
    expect(snapshot.componentGate.ok).toBe(true);
    expect(snapshot.contQaGate.ok).toBe(true);
    expect(snapshot.contQaGate.statusCode).toBe("pass");
    expect(snapshot.clarificationBarrier.ok).toBe(true);
    expect(snapshot.integrationBarrier.ok).toBe(true);
    expect(snapshot.overall.ok).toBe(true);
    expect(snapshot.overall.gate).toBe("pass");
  });
});

describe("deterministic replay: multi-agent wave with one failure", () => {
  it("reports implementation gate failure for the failing agent", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const agent2 = makeImplementationAgent("A2");
    const agent3 = makeImplementationAgent("A3");
    const agent0 = makeContQaAgent("A0");
    const wave = {
      wave: 1,
      lane: "main",
      agents: [agent1, agent2, agent3, agent0],
      componentPromotions: [],
    };

    const agentRuns = [
      makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir),
      makeAgentRun(agent2, makeFailingImplementationSummary("A2"), dir),
      makeAgentRun(agent3, makePassingImplementationSummary("A3"), dir),
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
        integrationSummary: null,
      },
      lanePaths: makeLanePaths(dir),
      componentMatrixPayload: makeComponentMatrixPayload(),
      componentMatrixJsonPath: null,
    });

    expect(snapshot.implementationGate.ok).toBe(false);
    expect(snapshot.implementationGate.agentId).toBe("A2");
    expect(snapshot.implementationGate.statusCode).toBe("wave-proof-gap");
    expect(snapshot.overall.ok).toBe(false);
    expect(snapshot.overall.gate).toBe("implementationGate");
    expect(snapshot.overall.agentId).toBe("A2");
  });
});

describe("deterministic replay: shared component sibling pending", () => {
  it("detects shared-component-sibling-pending when A1 satisfies component but A2 does not", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1", ["foo"], { foo: "repo-landed" });
    const agent2 = makeImplementationAgent("A2", ["foo"], { foo: "repo-landed" });
    const agent0 = makeContQaAgent("A0");
    const wave = {
      wave: 1,
      lane: "main",
      agents: [agent1, agent2, agent0],
      componentPromotions: [{ componentId: "foo", targetLevel: "repo-landed" }],
    };

    const agentRuns = [
      makeAgentRun(
        agent1,
        makePassingImplementationSummary("A1", [{ componentId: "foo", level: "repo-landed" }]),
        dir,
      ),
      makeAgentRun(agent2, makeFailingImplementationSummary("A2"), dir),
      makeAgentRun(agent0, makePassingContQaSummary("A0"), dir),
    ];

    // The implementation gate should fail first for A2, but let's also check
    // the component gate directly to verify shared-component-sibling-pending logic
    const componentGateResult = readWaveComponentGate(wave, agentRuns, {
      laneProfile: makeLanePaths(dir).laneProfile,
    });

    expect(componentGateResult.ok).toBe(false);
    expect(componentGateResult.statusCode).toBe("shared-component-sibling-pending");
    expect(componentGateResult.satisfiedAgentIds).toContain("A1");
    expect(componentGateResult.waitingOnAgentIds).toContain("A2");
  });
});

describe("deterministic replay: coordination blockers", () => {
  it("reports clarification barrier failure when open clarification exists", () => {
    const coordinationState = materializeCoordinationState([
      {
        id: "clarify-api-contract",
        kind: "clarification-request",
        lane: "main",
        wave: 1,
        agentId: "A1",
        targets: ["agent:A2"],
        status: "open",
        priority: "high",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "medium",
        summary: "API contract needs clarification",
        detail: "Need to agree on endpoint signatures.",
        source: "agent",
      },
    ]);

    const barrier = readClarificationBarrier({
      coordinationState,
    });

    expect(barrier.ok).toBe(false);
    expect(barrier.statusCode).toBe("clarification-open");
    expect(barrier.detail).toContain("clarify-api-contract");
  });

  it("reports clarification barrier failure within a full gate snapshot", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const agent0 = makeContQaAgent("A0");
    const wave = {
      wave: 1,
      lane: "main",
      agents: [agent1, agent0],
      componentPromotions: [],
    };

    const coordinationState = materializeCoordinationState([
      {
        id: "clarify-api-contract",
        kind: "clarification-request",
        lane: "main",
        wave: 1,
        agentId: "A1",
        targets: ["agent:A2"],
        status: "open",
        priority: "high",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "medium",
        summary: "Needs clarification",
        detail: "API contract question.",
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
        integrationSummary: null,
      },
      lanePaths: makeLanePaths(dir),
      componentMatrixPayload: makeComponentMatrixPayload(),
      componentMatrixJsonPath: null,
    });

    expect(snapshot.clarificationBarrier.ok).toBe(false);
    expect(snapshot.clarificationBarrier.statusCode).toBe("clarification-open");
    expect(snapshot.overall.ok).toBe(false);
  });
});

describe("deterministic replay: helper assignment barrier", () => {
  it("reports helper-assignment-unresolved when a blocking assignment has no assignee", () => {
    const barrier = readWaveAssignmentBarrier({
      capabilityAssignments: [
        { requestId: "req-1", blocking: true, assignedAgentId: null },
      ],
    });

    expect(barrier.ok).toBe(false);
    expect(barrier.statusCode).toBe("helper-assignment-unresolved");
    expect(barrier.detail).toContain("req-1");
  });

  it("reports helper-assignment-open when a blocking assignment has an assignee but is still open", () => {
    const barrier = readWaveAssignmentBarrier({
      capabilityAssignments: [
        { requestId: "req-2", blocking: true, assignedAgentId: "A3" },
      ],
    });

    expect(barrier.ok).toBe(false);
    expect(barrier.statusCode).toBe("helper-assignment-open");
  });

  it("passes when no blocking assignments exist", () => {
    const barrier = readWaveAssignmentBarrier({
      capabilityAssignments: [
        { requestId: "req-3", blocking: false, assignedAgentId: null },
      ],
    });

    expect(barrier.ok).toBe(true);
    expect(barrier.statusCode).toBe("pass");
  });
});

describe("deterministic replay: dependency barrier", () => {
  it("reports dependency-open when required inbound dependencies remain", () => {
    const barrier = readWaveDependencyBarrier({
      dependencySnapshot: {
        requiredInbound: [{ id: "dep-1" }],
        requiredOutbound: [],
        unresolvedInboundAssignments: [],
      },
    });

    expect(barrier.ok).toBe(false);
    expect(barrier.statusCode).toBe("dependency-open");
  });

  it("reports dependency-assignment-unresolved when inbound dependencies have no assignees", () => {
    const barrier = readWaveDependencyBarrier({
      dependencySnapshot: {
        requiredInbound: [],
        requiredOutbound: [],
        unresolvedInboundAssignments: [{ id: "dep-assign-1" }],
      },
    });

    expect(barrier.ok).toBe(false);
    expect(barrier.statusCode).toBe("dependency-assignment-unresolved");
  });

  it("passes when all dependencies are resolved", () => {
    const barrier = readWaveDependencyBarrier({
      dependencySnapshot: {
        requiredInbound: [],
        requiredOutbound: [],
        unresolvedInboundAssignments: [],
      },
    });

    expect(barrier.ok).toBe(true);
    expect(barrier.statusCode).toBe("pass");
  });
});

describe("deterministic replay: full gate snapshot with all gates", () => {
  it("produces the correct gate ordering in the snapshot", () => {
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

    // Verify every gate exists in the snapshot
    expect(snapshot).toHaveProperty("implementationGate");
    expect(snapshot).toHaveProperty("componentGate");
    expect(snapshot).toHaveProperty("integrationGate");
    expect(snapshot).toHaveProperty("integrationBarrier");
    expect(snapshot).toHaveProperty("documentationGate");
    expect(snapshot).toHaveProperty("componentMatrixGate");
    expect(snapshot).toHaveProperty("contEvalGate");
    expect(snapshot).toHaveProperty("securityGate");
    expect(snapshot).toHaveProperty("contQaGate");
    expect(snapshot).toHaveProperty("infraGate");
    expect(snapshot).toHaveProperty("clarificationBarrier");
    expect(snapshot).toHaveProperty("helperAssignmentBarrier");
    expect(snapshot).toHaveProperty("dependencyBarrier");
    expect(snapshot).toHaveProperty("overall");

    // All gates should pass in this fully-satisfied scenario
    expect(snapshot.implementationGate.ok).toBe(true);
    expect(snapshot.componentGate.ok).toBe(true);
    expect(snapshot.integrationBarrier.ok).toBe(true);
    expect(snapshot.contQaGate.ok).toBe(true);
    expect(snapshot.clarificationBarrier.ok).toBe(true);
    expect(snapshot.helperAssignmentBarrier.ok).toBe(true);
    expect(snapshot.dependencyBarrier.ok).toBe(true);
    expect(snapshot.infraGate.ok).toBe(true);
    expect(snapshot.overall.ok).toBe(true);
  });
});

describe("deterministic replay: replay determinism", () => {
  it("produces identical snapshots when run twice with the same inputs", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1", ["foo"], { foo: "repo-landed" });
    const agent0 = makeContQaAgent("A0");
    const wave = {
      wave: 1,
      lane: "main",
      agents: [agent1, agent0],
      componentPromotions: [{ componentId: "foo", targetLevel: "repo-landed" }],
    };

    const coordRecords = [
      {
        id: "decision-api",
        kind: "decision",
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
        updatedAt: "2026-03-20T10:00:00.000Z",
        confidence: "high",
        summary: "API contract resolved.",
        detail: "Interface contract accepted.",
        source: "agent",
      },
    ];

    const integrationSummary = {
      recommendation: "ready-for-doc-closure",
      detail: "Integration steward signed off.",
    };

    const buildSnapshot = () => {
      const coordinationState = materializeCoordinationState(coordRecords);
      const agentRuns = [
        makeAgentRun(
          agent1,
          makePassingImplementationSummary("A1", [{ componentId: "foo", level: "repo-landed" }]),
          dir,
        ),
        makeAgentRun(agent0, makePassingContQaSummary("A0"), dir),
      ];
      return buildGateSnapshot({
        wave,
        agentRuns,
        derivedState: {
          coordinationState,
          ledger: null,
          docsQueue: null,
          capabilityAssignments: [],
          dependencySnapshot: null,
          integrationSummary,
        },
        lanePaths: makeLanePaths(dir),
        componentMatrixPayload: makeComponentMatrixPayload({ foo: "repo-landed" }),
        componentMatrixJsonPath: null,
      });
    };

    const snapshot1 = buildSnapshot();
    const snapshot2 = buildSnapshot();

    // Deep equality on serialized form
    expect(JSON.stringify(snapshot1)).toBe(JSON.stringify(snapshot2));
  });

  it("produces deterministic results even with multi-agent complex fixtures", () => {
    const dir = makeTempDir();
    const agents = [
      makeImplementationAgent("A1", ["auth"], { auth: "repo-landed" }),
      makeImplementationAgent("A2", ["api"], { api: "repo-landed" }),
      makeImplementationAgent("A3", ["ui"], { ui: "repo-landed" }),
      makeContQaAgent("A0"),
    ];
    const wave = {
      wave: 2,
      lane: "main",
      agents,
      componentPromotions: [
        { componentId: "auth", targetLevel: "repo-landed" },
        { componentId: "api", targetLevel: "repo-landed" },
        { componentId: "ui", targetLevel: "repo-landed" },
      ],
    };

    const integrationSummary = {
      recommendation: "ready-for-doc-closure",
      detail: "All integration checks pass.",
    };

    const buildSnapshot = () => {
      const agentRuns = [
        makeAgentRun(
          agents[0],
          makePassingImplementationSummary("A1", [{ componentId: "auth", level: "repo-landed" }]),
          dir,
        ),
        makeAgentRun(
          agents[1],
          makePassingImplementationSummary("A2", [{ componentId: "api", level: "repo-landed" }]),
          dir,
        ),
        makeAgentRun(
          agents[2],
          makePassingImplementationSummary("A3", [{ componentId: "ui", level: "repo-landed" }]),
          dir,
        ),
        makeAgentRun(agents[3], makePassingContQaSummary("A0"), dir),
      ];
      return buildGateSnapshot({
        wave,
        agentRuns,
        derivedState: {
          coordinationState: materializeCoordinationState([]),
          ledger: null,
          docsQueue: null,
          capabilityAssignments: [],
          dependencySnapshot: null,
          integrationSummary,
        },
        lanePaths: makeLanePaths(dir),
        componentMatrixPayload: makeComponentMatrixPayload({
          auth: "repo-landed",
          api: "repo-landed",
          ui: "repo-landed",
        }),
        componentMatrixJsonPath: null,
      });
    };

    const snapshot1 = buildSnapshot();
    const snapshot2 = buildSnapshot();

    expect(JSON.stringify(snapshot1)).toBe(JSON.stringify(snapshot2));
    expect(snapshot1.overall.ok).toBe(true);
  });
});

describe("deterministic replay: security gate scenarios", () => {
  it("passes security gate when no security reviewer is declared", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const wave = { wave: 1, agents: [agent1] };

    const agentRuns = [
      makeAgentRun(agent1, makePassingImplementationSummary("A1"), dir),
    ];

    const result = readWaveSecurityGate(wave, agentRuns);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe("pass");
  });

  it("detects security blocked when security reviewer reports blocked state", () => {
    const dir = makeTempDir();
    const securityAgent = {
      agentId: "A7",
      title: "Security Engineer",
      rolePromptPaths: ["docs/agents/wave-security-role.md"],
      ownedPaths: [".tmp/main-wave-launcher/security/wave-0-review.md"],
    };
    const wave = { wave: 1, agents: [securityAgent] };

    // Security gate uses readRunExecutionSummary which prefers runInfo.summary
    // But validateSecuritySummary checks summary.reportPath existence on disk
    // So we need to create the report file
    const reportPath = path.join(dir, "wave-0-review.md");
    fs.writeFileSync(reportPath, "# Security Review\nBlocked: unpatched dependency\n", "utf8");

    const securitySummary = {
      agentId: "A7",
      exitCode: 0,
      security: { state: "blocked", findings: 1, approvals: 0, detail: "unpatched dependency" },
      reportPath: reportPath,
      proof: null,
      docDelta: null,
      components: [],
      deliverables: [],
      proofArtifacts: [],
      gaps: [],
    };

    const agentRuns = [makeAgentRun(securityAgent, securitySummary, dir)];

    const result = readWaveSecurityGate(wave, agentRuns);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("security-blocked");
    expect(result.agentId).toBe("A7");
  });
});

describe("deterministic replay: implementation gate with missing proof", () => {
  it("fails implementation gate when agent has no summary", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const agent0 = makeContQaAgent("A0");
    const wave = { wave: 1, agents: [agent1, agent0] };

    const agentRuns = [
      makeAgentRun(agent1, null, dir),
      makeAgentRun(agent0, makePassingContQaSummary("A0"), dir),
    ];

    const result = readWaveImplementationGate(wave, agentRuns);
    expect(result.ok).toBe(false);
    expect(result.agentId).toBe("A1");
    expect(result.statusCode).toBe("missing-summary");
  });

  it("fails implementation gate when proof state is gap", () => {
    const dir = makeTempDir();
    const agent1 = makeImplementationAgent("A1");
    const wave = { wave: 1, agents: [agent1] };

    const failingSummary = {
      agentId: "A1",
      proof: { state: "gap", completion: "contract", durability: "none", proof: "unit", detail: "flaky tests" },
      docDelta: { state: "owned", paths: [], detail: "" },
    };

    const agentRuns = [makeAgentRun(agent1, failingSummary, dir)];

    const result = readWaveImplementationGate(wave, agentRuns);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("wave-proof-gap");
    expect(result.detail).toContain("flaky tests");
  });

  it("fails implementation gate when completion level is below exit contract", () => {
    const dir = makeTempDir();
    const agent1 = {
      ...makeImplementationAgent("A1"),
      exitContract: { completion: "integrated", durability: "none", proof: "unit", docImpact: "owned" },
    };
    const wave = { wave: 1, agents: [agent1] };

    const summary = {
      agentId: "A1",
      proof: { state: "met", completion: "contract", durability: "none", proof: "unit", detail: "" },
      docDelta: { state: "owned", paths: [], detail: "" },
    };

    const agentRuns = [makeAgentRun(agent1, summary, dir)];

    const result = readWaveImplementationGate(wave, agentRuns);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe("completion-gap");
    expect(result.detail).toContain("contract");
    expect(result.detail).toContain("integrated");
  });
});

describe("deterministic replay: human feedback barrier", () => {
  it("reports human-feedback-open when pending escalation exists", () => {
    const coordinationState = materializeCoordinationState([
      {
        id: "esc-1",
        kind: "human-escalation",
        lane: "main",
        wave: 1,
        agentId: "A1",
        targets: [],
        status: "open",
        priority: "urgent",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "high",
        summary: "Need human decision on architecture",
        detail: "Architecture fork requires operator sign-off.",
        source: "agent",
      },
    ]);

    const barrier = readClarificationBarrier({ coordinationState });

    expect(barrier.ok).toBe(false);
    expect(barrier.statusCode).toBe("human-feedback-open");
    expect(barrier.detail).toContain("esc-1");
  });
});
