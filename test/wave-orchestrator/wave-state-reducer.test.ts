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
      expect(state.reducerVersion).toBe(1);
      expect(state.wave).toBe(0);
      expect(state.lane).toBe("main");
      expect(state.phase).toBe("running");
      expect(state.tasks).toEqual([]);
      expect(state.tasksByAgentId).toEqual({});
      expect(state.proofAvailability).toBeTruthy();
      expect(state.proofAvailability.byAgentId).toEqual({});
      expect(state.proofAvailability.allOwnedSlicesProven).toBe(true);
      // Gate failures appear as blockers even with empty inputs (e.g. missing cont-QA, integration)
      expect(Array.isArray(state.openBlockers)).toBe(true);
      expect(state.gateSnapshot).toBeTruthy();
      expect(state.gateSnapshot.overall).toBeTruthy();
      expect(state.retryTargetSet).toBeTruthy();
      expect(state.retryTargetSet.agentIds).toEqual([]);
      expect(state.closureEligibility).toBeTruthy();
      expect(state.coordinationMetrics).toBeTruthy();
      expect(state.controlPlaneState).toBeTruthy();
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
  });

  describe("phase derivation", () => {
    it("returns running for fresh wave with no results", () => {
      const state = reduceWaveState({
        waveDefinition: makeWaveDefinition(),
      });
      expect(state.phase).toBe("running");
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
});
