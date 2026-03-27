import { describe, it, expect } from "vitest";
import { reduceWaveState } from "../../scripts/wave-orchestrator/wave-state-reducer.mjs";

function makeWaveDefinition(overrides = {}) {
  return {
    wave: 3,
    agents: [
      {
        agentId: "A1",
        title: "Core implementation",
        ownedPaths: ["src/core.ts"],
        deliverables: [],
        exitContract: {
          completion: "contract",
          durability: "durable",
          proof: "unit",
          docImpact: "none",
        },
      },
      {
        agentId: "A2",
        title: "API implementation",
        ownedPaths: ["src/api.ts"],
        deliverables: [],
        exitContract: {
          completion: "contract",
          durability: "durable",
          proof: "unit",
          docImpact: "none",
        },
      },
      {
        agentId: "A0",
        title: "Cont-QA",
        ownedPaths: [],
      },
    ],
    componentPromotions: [],
    ...overrides,
  };
}

function makePassingSummary(agentId) {
  return {
    agentId,
    proof: {
      completion: "contract",
      durability: "durable",
      proof: "unit",
      state: "met",
    },
    docDelta: {
      state: "none",
    },
  };
}

function makeContQaPassingSummary() {
  return {
    agentId: "A0",
    proof: {
      completion: "contract",
      durability: "durable",
      proof: "unit",
      state: "met",
    },
    docDelta: {
      state: "none",
    },
    verdict: {
      verdict: "pass",
      detail: "All checks passed.",
    },
  };
}

function makeFailingSummary(agentId) {
  return {
    agentId,
    proof: {
      completion: "contract",
      durability: "durable",
      proof: "unit",
      state: "gap",
    },
    docDelta: {
      state: "none",
    },
  };
}

describe("reduceWaveState", () => {
  describe("empty inputs", () => {
    it("produces valid initial state with completely empty inputs", () => {
      const state = reduceWaveState({});
      expect(state.reducerVersion).toBe(2);
      expect(state.wave).toBe(0);
      expect(state.lane).toBe("main");
      expect(state.phase).toBe("running");
      expect(state.waveState).toBe("running");
      expect(state.tasks).toEqual([]);
      expect(state.tasksByAgentId).toEqual({});
      expect(state.proofAvailability).toBeTruthy();
      expect(state.proofAvailability.byAgentId).toEqual({});
      expect(state.proofAvailability.allOwnedSlicesProven).toBe(true);
      // Gate failures appear as blockers even with empty inputs (e.g. missing cont-QA, integration)
      expect(Array.isArray(state.openBlockers)).toBe(true);
      expect(state.gateSnapshot).toBeTruthy();
      expect(state.gateSnapshot.overall).toBeTruthy();
      // gateVerdicts is same reference as gateSnapshot
      expect(state.gateVerdicts).toBe(state.gateSnapshot);
      expect(state.retryTargetSet).toBeTruthy();
      // Gate-identified agents (e.g. A0 from cont-QA gate) may appear even with empty inputs
      expect(Array.isArray(state.retryTargetSet.agentIds)).toBe(true);
      expect(state.closureEligibility).toBeTruthy();
      expect(state.coordinationMetrics).toBeTruthy();
      expect(state.controlPlaneState).toBeTruthy();
      // New end-state fields
      expect(state.contradictions).toBeInstanceOf(Map);
      expect(state.contradictions.size).toBe(0);
      expect(state.facts).toBeInstanceOf(Map);
      expect(state.facts.size).toBe(0);
      expect(state.humanInputs).toBeInstanceOf(Map);
      expect(state.humanInputs.size).toBe(0);
      expect(state.taskGraph).toBeTruthy();
      expect(state.taskGraph.nodes).toEqual([]);
      expect(state.taskGraph.edges).toEqual([]);
      expect(state.assignments).toBeInstanceOf(Map);
      expect(state.assignments.size).toBe(0);
      expect(Array.isArray(state.capabilityAssignments)).toBe(true);
      expect(state.coordinationState).toBeTruthy();
      expect(state.dependencySnapshot).toBe(null);
    });
  });

  describe("single agent wave", () => {
    it("produces tasks for a single-agent wave", () => {
      const wave = {
        wave: 1,
        agents: [
          {
            agentId: "A1",
            title: "Solo agent",
            ownedPaths: ["src/main.ts"],
            exitContract: { completion: "contract", durability: "durable", proof: "unit", docImpact: "none" },
          },
        ],
        componentPromotions: [],
      };
      const state = reduceWaveState({ waveDefinition: wave });
      expect(state.wave).toBe(1);
      expect(state.tasks.length).toBe(1);
      expect(state.tasks[0].taskType).toBe("implementation");
      expect(state.tasks[0].ownerAgentId).toBe("A1");
    });

    it("marks agent proof available when summary passes", () => {
      const wave = {
        wave: 1,
        agents: [
          {
            agentId: "A1",
            title: "Solo agent",
            ownedPaths: ["src/main.ts"],
            exitContract: { completion: "contract", durability: "durable", proof: "unit", docImpact: "none" },
          },
        ],
        componentPromotions: [],
      };
      const state = reduceWaveState({
        waveDefinition: wave,
        agentResults: {
          A1: makePassingSummary("A1"),
        },
      });
      expect(state.proofAvailability.byAgentId.A1.ownedSliceProven).toBe(true);
      expect(state.proofAvailability.allOwnedSlicesProven).toBe(true);
    });

    it("marks agent proof not available when summary fails", () => {
      const wave = {
        wave: 1,
        agents: [
          {
            agentId: "A1",
            title: "Solo agent",
            ownedPaths: ["src/main.ts"],
            exitContract: { completion: "contract", durability: "durable", proof: "unit", docImpact: "none" },
          },
        ],
        componentPromotions: [],
      };
      const state = reduceWaveState({
        waveDefinition: wave,
        agentResults: {
          A1: makeFailingSummary("A1"),
        },
      });
      expect(state.proofAvailability.byAgentId.A1.ownedSliceProven).toBe(false);
      expect(state.proofAvailability.allOwnedSlicesProven).toBe(false);
    });

    it("tracks hybrid design stewards across design and implementation tasks", () => {
      const wave = {
        wave: 1,
        agents: [
          {
            agentId: "D1",
            title: "Design Steward",
            rolePromptPaths: ["docs/agents/wave-design-role.md"],
            ownedPaths: ["docs/plans/waves/design/wave-1-D1.md", "src/main.ts"],
            exitContract: {
              completion: "contract",
              durability: "durable",
              proof: "unit",
              docImpact: "none",
            },
          },
        ],
        componentPromotions: [],
      };
      const state = reduceWaveState({
        waveDefinition: wave,
        agentResults: {
          D1: {
            agentId: "D1",
            reportPath: "README.md",
            design: {
              state: "ready-for-implementation",
              decisions: 2,
              assumptions: 1,
              openQuestions: 0,
              detail: "packet-ready",
            },
            proof: {
              completion: "contract",
              durability: "durable",
              proof: "unit",
              state: "gap",
            },
            docDelta: {
              state: "none",
            },
          },
        },
      });

      expect(state.tasks.filter((task) => task.ownerAgentId === "D1").map((task) => task.taskType)).toEqual([
        "design",
        "implementation",
      ]);
      expect(state.tasks.find((task) => task.taskType === "design")?.closureState).toBe("owned_slice_proven");
      expect(state.tasks.find((task) => task.taskType === "implementation")?.closureState).toBe("open");
      expect(state.phase).toBe("running");
    });
  });

  describe("multi-agent wave", () => {
    it("only reports all owned slices proven when every agent passes", () => {
      const wave = makeWaveDefinition();
      const state = reduceWaveState({
        waveDefinition: wave,
        agentResults: {
          A1: makePassingSummary("A1"),
          A2: makeFailingSummary("A2"),
          A0: makeContQaPassingSummary(),
        },
      });
      expect(state.proofAvailability.byAgentId.A1.ownedSliceProven).toBe(true);
      expect(state.proofAvailability.byAgentId.A2.ownedSliceProven).toBe(false);
      expect(state.proofAvailability.allOwnedSlicesProven).toBe(false);
    });

    it("tasks grouped correctly by agent ID", () => {
      const wave = makeWaveDefinition();
      const state = reduceWaveState({ waveDefinition: wave });
      expect(state.tasksByAgentId.A1).toBeTruthy();
      expect(state.tasksByAgentId.A1.length).toBe(1);
      expect(state.tasksByAgentId.A2).toBeTruthy();
      expect(state.tasksByAgentId.A0).toBeTruthy();
    });
  });

  describe("gate evaluation", () => {
    it("gateSnapshot contains expected gate keys", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.gateSnapshot).toBeTruthy();
      expect(state.gateSnapshot.implementationGate).toBeTruthy();
      expect(state.gateSnapshot.componentGate).toBeTruthy();
      expect(state.gateSnapshot.contQaGate).toBeTruthy();
      expect(state.gateSnapshot.securityGate).toBeTruthy();
      expect(state.gateSnapshot.documentationGate).toBeTruthy();
      expect(state.gateSnapshot.integrationBarrier).toBeTruthy();
      expect(state.gateSnapshot.infraGate).toBeTruthy();
      expect(state.gateSnapshot.clarificationBarrier).toBeTruthy();
      expect(state.gateSnapshot.helperAssignmentBarrier).toBeTruthy();
      expect(state.gateSnapshot.dependencyBarrier).toBeTruthy();
      expect(state.gateSnapshot.overall).toBeTruthy();
    });

    it("gateVerdicts is the same object as gateSnapshot", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.gateVerdicts).toBe(state.gateSnapshot);
    });

    it("implementation gate fails when agent missing proof", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        agentResults: {
          A1: makeFailingSummary("A1"),
        },
      });
      expect(state.gateSnapshot.implementationGate.ok).toBe(false);
    });

    it("implementation gate passes when all agents have passing proofs", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        agentResults: {
          A1: makePassingSummary("A1"),
          A2: makePassingSummary("A2"),
          A0: makeContQaPassingSummary(),
        },
      });
      expect(state.gateSnapshot.implementationGate.ok).toBe(true);
    });

    it("uses request assignments to block helper-assignment closure deterministically", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition({
          agents: [
            {
              agentId: "A1",
              title: "Core implementation",
              ownedPaths: ["src/core.ts"],
              capabilities: ["core"],
              exitContract: {
                completion: "contract",
                durability: "durable",
                proof: "unit",
                docImpact: "none",
              },
            },
            {
              agentId: "A0",
              title: "Cont-QA",
              ownedPaths: [],
            },
          ],
        }),
        coordinationRecords: [
          {
            id: "req-helper-1",
            kind: "request",
            status: "open",
            priority: "normal",
            agentId: "A1",
            targets: ["capability:missing-capability"],
            summary: "Need another owner to take this slice",
            detail: "No helper exists yet.",
            source: "agent",
            createdAt: "2026-03-23T00:00:00.000Z",
            updatedAt: "2026-03-23T00:00:00.000Z",
          },
        ],
      });

      expect(state.gateSnapshot.helperAssignmentBarrier).toMatchObject({
        ok: false,
        statusCode: "helper-assignment-unresolved",
      });
      expect(state.phase).toBe("blocked");
      expect(state.assignments.size).toBe(1);
    });

    it("blocks integration closure when unresolved contradictions remain", () => {
      const state = reduceWaveState({
        controlPlaneEvents: [
          {
            id: "evt-contra-1",
            entityType: "contradiction",
            entityId: "contra-1",
            action: "create",
            lane: "main",
            wave: 3,
            recordedAt: "2026-03-23T00:00:00.000Z",
            data: {
              kind: "integration_conflict",
              status: "detected",
              severity: "blocking",
              impactedGates: ["integrationBarrier"],
            },
          },
        ],
        waveDefinition: {
          wave: 3,
          agents: [
            {
              agentId: "A8",
              title: "Integration",
              ownedPaths: [],
            },
            {
              agentId: "A0",
              title: "Cont-QA",
              ownedPaths: [],
            },
          ],
          componentPromotions: [],
        },
        agentResults: {
          A8: {
            agentId: "A8",
            integration: {
              state: "ready-for-doc-closure",
              claims: 0,
              conflicts: 0,
              blockers: 0,
              detail: "Ready on summary alone.",
            },
          },
          A0: makeContQaPassingSummary(),
        },
      });

      expect(state.gateSnapshot.integrationBarrier).toMatchObject({
        ok: false,
        statusCode: "integration-contradiction-open",
      });
    });
  });

  describe("closure eligibility", () => {
    it("waveMayClose is false when gates fail", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.closureEligibility.waveMayClose).toBe(false);
    });

    it("reports pending agent IDs", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        agentResults: {
          A1: makePassingSummary("A1"),
          A2: makeFailingSummary("A2"),
          A0: makeContQaPassingSummary(),
        },
      });
      expect(state.closureEligibility.ownedSliceProvenAgentIds).toContain("A1");
      expect(state.closureEligibility.pendingAgentIds).toContain("A2");
    });

    it("includes proofBundles for buildResumePlan", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      expect(Array.isArray(state.closureEligibility.proofBundles)).toBe(true);
    });
  });

  describe("phase derivation", () => {
    it("returns running for fresh wave with no results", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.phase).toBe("running");
      expect(state.waveState).toBe("running");
    });

    it("returns clarifying when open clarifications exist", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "clar-1",
            kind: "clarification-request",
            status: "open",
            agentId: "A1",
            summary: "Need clarification",
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      expect(state.phase).toBe("clarifying");
      expect(state.waveState).toBe("blocked");
    });

    it("keeps advisory clarifications visible without reopening clarifying phase", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "clar-1",
            kind: "clarification-request",
            status: "open",
            agentId: "A1",
            summary: "Need clarification",
            recordedAt: new Date().toISOString(),
            blocking: false,
            blockerSeverity: "advisory",
          },
        ],
      });
      expect(state.phase).toBe("running");
      expect(state.waveState).toBe("running");
      expect(state.gateSnapshot.clarificationBarrier).toMatchObject({
        ok: true,
        statusCode: "pass",
      });
      expect(state.openBlockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "clar-1",
            blocking: false,
            blockerSeverity: "advisory",
          }),
        ]),
      );
    });

    it("returns clarifying when human feedback is still open", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "human-1",
            kind: "human-feedback",
            status: "open",
            agentId: "A1",
            summary: "Need operator answer",
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      expect(state.phase).toBe("clarifying");
      expect(state.waveState).toBe("blocked");
      expect(state.gateSnapshot.clarificationBarrier).toMatchObject({
        ok: false,
        statusCode: "human-feedback-open",
      });
    });

    it("does not reopen clarifying when human feedback is downgraded non-blocking", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "human-1",
            kind: "human-feedback",
            status: "open",
            agentId: "A1",
            summary: "Need operator answer",
            recordedAt: new Date().toISOString(),
            blocking: false,
            blockerSeverity: "advisory",
          },
        ],
      });
      expect(state.phase).toBe("running");
      expect(state.waveState).toBe("running");
      expect(state.gateSnapshot.clarificationBarrier).toMatchObject({
        ok: true,
        statusCode: "pass",
      });
    });

    it("returns blocked when high-priority blockers exist", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "blocker-1",
            kind: "blocker",
            status: "open",
            priority: "high",
            agentId: "A1",
            summary: "Critical blocker",
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      expect(state.phase).toBe("blocked");
      expect(state.waveState).toBe("blocked");
    });
  });

  describe("blockers", () => {
    it("open coordination blockers appear in openBlockers", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "blocker-1",
            kind: "blocker",
            status: "open",
            priority: "normal",
            agentId: "A2",
            summary: "Build broken",
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      const blockerEntry = state.openBlockers.find((b) => b.id === "blocker-1");
      expect(blockerEntry).toBeTruthy();
      expect(blockerEntry.kind).toBe("coordination-blocker");
    });

    it("gate failures appear in openBlockers", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      const gateBlockers = state.openBlockers.filter((b) => b.kind === "gate-failure");
      expect(gateBlockers.length).toBeGreaterThan(0);
    });
  });

  describe("retry targets", () => {
    it("failed agents appear in retryTargetSet", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        agentResults: {
          A1: makePassingSummary("A1"),
          A2: makeFailingSummary("A2"),
          A0: makeContQaPassingSummary(),
        },
      });
      expect(state.retryTargetSet.agentIds).toContain("A2");
      expect(state.retryTargetSet.agentIds).not.toContain("A1");
    });

    it("no retry targets when all agents pass", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        agentResults: {
          A1: makePassingSummary("A1"),
          A2: makePassingSummary("A2"),
          A0: makeContQaPassingSummary(),
        },
      });
      expect(state.retryTargetSet.agentIds).not.toContain("A1");
      expect(state.retryTargetSet.agentIds).not.toContain("A2");
    });

    it("includes agents identified by failed gates", () => {
      // When a gate has an agentId and fails, that agent should appear in retry targets
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        agentResults: {
          A1: makePassingSummary("A1"),
          A2: makePassingSummary("A2"),
          // A0 has no result -> cont-QA gate should fail and reference A0
        },
      });
      // A0 should be in retry targets because it has unproven slice (no result)
      expect(state.retryTargetSet.agentIds).toContain("A0");
    });

    it("keeps deterministic retry target metadata for reducer-driven resume planning", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        agentResults: {
          A1: makePassingSummary("A1"),
          A2: makeFailingSummary("A2"),
          A0: makeContQaPassingSummary(),
        },
      });

      expect(state.retryTargetSet.targets).toContainEqual(
        expect.objectContaining({
          agentId: "A2",
          reason: "wave-proof-gap",
          statusCode: "wave-proof-gap",
          gate: "implementationGate",
        }),
      );
    });
  });

  describe("control plane state", () => {
    it("materializes control plane state from events", () => {
      const events = [
        {
          id: "evt-1",
          entityType: "proof_bundle",
          entityId: "proof-A1-abc",
          action: "create",
          data: { agentId: "A1", state: "active" },
          recordedAt: new Date().toISOString(),
        },
      ];
      const state = reduceWaveState({
        controlPlaneEvents: events,
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.controlPlaneState).toBeTruthy();
      expect(state.controlPlaneState.proofBundles.length).toBe(1);
    });
  });

  describe("coordination metrics", () => {
    it("produces coordination metrics", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "req-1",
            kind: "request",
            status: "open",
            agentId: "A1",
            summary: "Help needed",
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      expect(state.coordinationMetrics).toBeTruthy();
      expect(typeof state.coordinationMetrics.ackTimeoutMs).toBe("number");
    });
  });

  describe("lane config", () => {
    it("respects lane config for wave and lane", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        laneConfig: { lane: "beta" },
      });
      expect(state.lane).toBe("beta");
      expect(state.wave).toBe(3);
    });
  });

  describe("contradictions and facts", () => {
    it("materializes contradictions from control-plane events", () => {
      const events = [
        {
          id: "evt-c1",
          entityType: "contradiction",
          entityId: "contradiction-1",
          action: "create",
          data: {
            kind: "proof_conflict",
            status: "detected",
            reportedBy: "A1",
            parties: [{ agentId: "A1", claim: "tests pass" }],
            affectedTasks: ["task-1"],
          },
          recordedAt: new Date().toISOString(),
        },
      ];
      const state = reduceWaveState({
        controlPlaneEvents: events,
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.contradictions.size).toBe(1);
      expect(state.contradictions.has("contradiction-1")).toBe(true);
      const c = state.contradictions.get("contradiction-1");
      expect(c.kind).toBe("proof_conflict");
      expect(c.status).toBe("detected");
      expect(c.reportedBy).toBe("A1");
    });

    it("materializes facts from control-plane events", () => {
      const events = [
        {
          id: "evt-f1",
          entityType: "fact",
          entityId: "fact-1",
          action: "create",
          data: {
            kind: "claim",
            content: "All unit tests pass",
            introducedBy: "A1",
            status: "active",
          },
          recordedAt: new Date().toISOString(),
        },
      ];
      const state = reduceWaveState({
        controlPlaneEvents: events,
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.facts.size).toBe(1);
      expect(state.facts.has("fact-1")).toBe(true);
      const f = state.facts.get("fact-1");
      expect(f.kind).toBe("claim");
      expect(f.content).toBe("All unit tests pass");
      expect(f.introducedBy).toBe("A1");
    });
  });

  describe("humanInputs", () => {
    it("materializes human inputs from feedback requests", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        feedbackRequests: [
          {
            id: "fb-1",
            status: "pending",
            agentId: "A1",
            question: "Need approval",
            context: "Approval needed for deployment",
            createdAt: new Date().toISOString(),
          },
        ],
      });
      expect(state.humanInputs).toBeInstanceOf(Map);
      expect(state.humanInputs.size).toBeGreaterThanOrEqual(1);
    });

    it("materializes human inputs from clarification records", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "clar-1",
            kind: "clarification-request",
            status: "open",
            agentId: "A1",
            summary: "Need clarification on API design",
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      expect(state.humanInputs).toBeInstanceOf(Map);
      expect(state.humanInputs.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe("determinism", () => {
    it("produces stable coordination-derived tasks across identical reducer calls", () => {
      const input = {
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "clar-1",
            kind: "clarification-request",
            status: "open",
            agentId: "A1",
            summary: "Need clarification on API design",
            detail: "Clarify API shape",
            lane: "main",
            wave: 3,
            createdAt: "2026-03-23T00:00:00.000Z",
            updatedAt: "2026-03-23T00:00:00.000Z",
          },
        ],
      };

      const first = reduceWaveState(input);
      const second = reduceWaveState(input);

      expect(first.tasks).toEqual(second.tasks);
      expect(first.tasks.find((task) => task.sourceRecordId === "clar-1")?.taskId).toBe(
        "wave-3:A1:clarification-clar-1",
      );
    });
  });

  describe("taskGraph", () => {
    it("builds a DAG from task dependency edges", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.taskGraph).toBeTruthy();
      expect(Array.isArray(state.taskGraph.nodes)).toBe(true);
      expect(Array.isArray(state.taskGraph.edges)).toBe(true);
      // Should have as many nodes as tasks
      expect(state.taskGraph.nodes.length).toBe(state.tasks.length);
    });
  });

  describe("integrationSummary ordering", () => {
    it("computes integrationSummary BEFORE passing to gate snapshot", () => {
      // If a passing integration summary is provided, the integration barrier
      // in the gate snapshot should reflect it
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        agentResults: {
          A1: makePassingSummary("A1"),
          A2: makePassingSummary("A2"),
          A0: makeContQaPassingSummary(),
          A8: {
            agentId: "A8",
            proof: { completion: "contract", durability: "durable", proof: "unit", state: "met" },
            docDelta: { state: "none" },
            integration: { state: "ready-for-doc-closure", detail: "Clean integration" },
          },
        },
        laneConfig: { integrationAgentId: "A8" },
      });
      // The integration barrier should pass because integrationSummary is computed first
      expect(state.gateSnapshot.integrationBarrier.ok).toBe(true);
    });
  });

  describe("bidirectional proof transitions", () => {
    it("transitions open to owned_slice_proven when proof passes", () => {
      const wave = {
        wave: 1,
        agents: [
          {
            agentId: "A1",
            title: "Solo",
            ownedPaths: ["src/a.ts"],
            exitContract: { completion: "contract", durability: "durable", proof: "unit", docImpact: "none" },
          },
        ],
        componentPromotions: [],
      };
      const state = reduceWaveState({
        waveDefinition: wave,
        agentResults: { A1: makePassingSummary("A1") },
      });
      const a1Task = state.tasks.find((t) => t.ownerAgentId === "A1");
      expect(a1Task.closureState).toBe("owned_slice_proven");
      expect(a1Task.status).toBe("proven");
    });

    it("transitions owned_slice_proven back to open when proof is invalidated", () => {
      // This tests the bidirectional logic.
      // When an agent previously had proof but now doesn't, the task should revert.
      // We simulate by having an agent with no result after it was previously proven.
      const wave = {
        wave: 1,
        agents: [
          {
            agentId: "A1",
            title: "Solo",
            ownedPaths: ["src/a.ts"],
            exitContract: { completion: "contract", durability: "durable", proof: "unit", docImpact: "none" },
          },
        ],
        componentPromotions: [],
      };
      // First reduce with passing results
      const state1 = reduceWaveState({
        waveDefinition: wave,
        agentResults: { A1: makePassingSummary("A1") },
      });
      expect(state1.tasks[0].closureState).toBe("owned_slice_proven");

      // Now reduce with failing results - proof invalidated
      const state2 = reduceWaveState({
        waveDefinition: wave,
        agentResults: { A1: makeFailingSummary("A1") },
      });
      // Task should remain open since proof fails
      expect(state2.tasks[0].closureState).toBe("open");
    });
  });

  describe("waveState field", () => {
    it("maps running phase to running waveState", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.waveState).toBe("running");
    });

    it("maps blocked phase to blocked waveState", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "blocker-1",
            kind: "blocker",
            status: "open",
            priority: "high",
            agentId: "A1",
            summary: "Blocked",
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      expect(state.waveState).toBe("blocked");
    });

    it("maps clarifying phase to blocked waveState", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
        coordinationRecords: [
          {
            id: "clar-1",
            kind: "clarification-request",
            status: "open",
            agentId: "A1",
            summary: "Clarification",
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      expect(state.waveState).toBe("blocked");
    });
  });
});
