import { describe, it, expect } from "vitest";
import {
  CONTRADICTION_KINDS,
  CONTRADICTION_STATUSES,
  CONTRADICTION_VALID_TRANSITIONS,
  CONTRADICTION_SEVERITIES,
  CONTRADICTION_RESOLUTION_KINDS,
  normalizeContradiction,
  transitionContradictionStatus,
  detectContradictions,
  resolveContradiction,
  waiveContradiction,
  acknowledgeContradiction,
  startRepair,
  unresolvedContradictions,
  contradictionsBlockingGate,
} from "../../scripts/wave-orchestrator/contradiction-entity.mjs";

describe("CONTRADICTION_KINDS / STATUSES / SEVERITIES / RESOLUTION_KINDS", () => {
  it("contains expected kinds", () => {
    expect(CONTRADICTION_KINDS.has("proof_conflict")).toBe(true);
    expect(CONTRADICTION_KINDS.has("integration_conflict")).toBe(true);
    expect(CONTRADICTION_KINDS.has("claim_conflict")).toBe(true);
    expect(CONTRADICTION_KINDS.has("evidence_conflict")).toBe(true);
    expect(CONTRADICTION_KINDS.has("component_conflict")).toBe(true);
    expect(CONTRADICTION_KINDS.size).toBe(5);
  });

  it("contains expected statuses", () => {
    expect(CONTRADICTION_STATUSES.has("detected")).toBe(true);
    expect(CONTRADICTION_STATUSES.has("acknowledged")).toBe(true);
    expect(CONTRADICTION_STATUSES.has("repair_in_progress")).toBe(true);
    expect(CONTRADICTION_STATUSES.has("resolved")).toBe(true);
    expect(CONTRADICTION_STATUSES.has("waived")).toBe(true);
    expect(CONTRADICTION_STATUSES.size).toBe(5);
  });

  it("contains expected severities", () => {
    expect(CONTRADICTION_SEVERITIES.has("blocking")).toBe(true);
    expect(CONTRADICTION_SEVERITIES.has("advisory")).toBe(true);
    expect(CONTRADICTION_SEVERITIES.size).toBe(2);
  });

  it("contains expected resolution kinds", () => {
    expect(CONTRADICTION_RESOLUTION_KINDS.has("party_accepted")).toBe(true);
    expect(CONTRADICTION_RESOLUTION_KINDS.has("all_revised")).toBe(true);
    expect(CONTRADICTION_RESOLUTION_KINDS.has("irrelevant")).toBe(true);
    expect(CONTRADICTION_RESOLUTION_KINDS.has("waived")).toBe(true);
    expect(CONTRADICTION_RESOLUTION_KINDS.has("repair_completed")).toBe(true);
    expect(CONTRADICTION_RESOLUTION_KINDS.size).toBe(5);
  });

  it("has valid transition map for all statuses", () => {
    expect(CONTRADICTION_VALID_TRANSITIONS.detected).toEqual(["acknowledged", "resolved", "waived"]);
    expect(CONTRADICTION_VALID_TRANSITIONS.acknowledged).toEqual(["repair_in_progress", "resolved", "waived"]);
    expect(CONTRADICTION_VALID_TRANSITIONS.repair_in_progress).toEqual(["resolved", "waived"]);
    expect(CONTRADICTION_VALID_TRANSITIONS.resolved).toEqual([]);
    expect(CONTRADICTION_VALID_TRANSITIONS.waived).toEqual([]);
  });
});

describe("normalizeContradiction", () => {
  it("normalizes a minimal contradiction with defaults", () => {
    const c = normalizeContradiction({});
    expect(c.contradictionId).toMatch(/^contra-/);
    expect(c.kind).toBe("claim_conflict");
    expect(c.status).toBe("detected");
    expect(c.severity).toBe("advisory");
    expect(c.reportedBy).toBe("system");
    expect(c.reportedAt).toBeTruthy();
    expect(c.resolvedBy).toBeNull();
    expect(c.resolvedAt).toBeNull();
    expect(c.parties).toEqual([]);
    expect(c.affectedTasks).toEqual([]);
    expect(c.affectedFacts).toEqual([]);
    expect(c.repairWork).toBeNull();
    expect(c.resolution).toBeNull();
    expect(c.supersedes).toBeNull();
    expect(c.waveNumber).toBeNull();
    expect(c.lane).toBeNull();
    expect(c.impactedGates).toEqual([]);
    expect(c.updatedAt).toBeTruthy();
  });

  it("respects explicit values including waveNumber, lane, and parties", () => {
    const c = normalizeContradiction({
      contradictionId: "contra-test",
      waveNumber: 3,
      lane: "alpha",
      kind: "proof_conflict",
      status: "detected",
      severity: "blocking",
      reportedBy: "A1",
      parties: [
        { agentId: "A1", claim: "Component X is healthy", evidence: "test-results.json" },
        { agentId: "A2", claim: "Component X is failing", evidence: "error-log.txt" },
      ],
      affectedTasks: ["task-1", "task-2"],
      affectedFacts: ["fact-1"],
      impactedGates: ["integrationBarrier"],
      supersedes: "contra-old",
    });
    expect(c.contradictionId).toBe("contra-test");
    expect(c.waveNumber).toBe(3);
    expect(c.lane).toBe("alpha");
    expect(c.kind).toBe("proof_conflict");
    expect(c.severity).toBe("blocking");
    expect(c.reportedBy).toBe("A1");
    expect(c.parties).toHaveLength(2);
    expect(c.parties[0].agentId).toBe("A1");
    expect(c.parties[0].claim).toBe("Component X is healthy");
    expect(c.parties[0].evidence).toBe("test-results.json");
    expect(c.parties[1].agentId).toBe("A2");
    expect(c.affectedTasks).toEqual(["task-1", "task-2"]);
    expect(c.affectedFacts).toEqual(["fact-1"]);
    expect(c.impactedGates).toEqual(["integrationBarrier"]);
    expect(c.supersedes).toBe("contra-old");
  });

  it("applies defaults from second argument", () => {
    const c = normalizeContradiction(
      {},
      {
        status: "resolved",
        severity: "blocking",
        kind: "evidence_conflict",
        waveNumber: 2,
        lane: "beta",
        parties: [{ agentId: "A1", claim: "default claim", evidence: "" }],
      },
    );
    expect(c.status).toBe("resolved");
    expect(c.severity).toBe("blocking");
    expect(c.kind).toBe("evidence_conflict");
    expect(c.waveNumber).toBe(2);
    expect(c.lane).toBe("beta");
    expect(c.parties).toHaveLength(1);
    expect(c.parties[0].agentId).toBe("A1");
  });

  it("normalizes a contradiction with resolution", () => {
    const c = normalizeContradiction({
      status: "resolved",
      resolution: {
        kind: "party_accepted",
        detail: "A1 had latest data",
        evidence: "proof-bundle-123",
      },
    });
    expect(c.resolution).not.toBeNull();
    expect(c.resolution.kind).toBe("party_accepted");
    expect(c.resolution.detail).toBe("A1 had latest data");
    expect(c.resolution.evidence).toBe("proof-bundle-123");
  });

  it("normalizes repair work", () => {
    const c = normalizeContradiction({
      status: "repair_in_progress",
      repairWork: [
        { taskId: "task-repair-1", status: "in_progress" },
        { taskId: "task-repair-2", status: "pending" },
      ],
    });
    expect(c.repairWork).toHaveLength(2);
    expect(c.repairWork[0].taskId).toBe("task-repair-1");
    expect(c.repairWork[0].status).toBe("in_progress");
    expect(c.repairWork[1].taskId).toBe("task-repair-2");
    expect(c.repairWork[1].status).toBe("pending");
  });

  it("filters invalid party entries", () => {
    const c = normalizeContradiction({
      parties: [
        { agentId: "A1", claim: "valid", evidence: "" },
        { claim: "no agent" }, // missing agentId
        null,
        "invalid",
      ],
    });
    expect(c.parties).toHaveLength(1);
    expect(c.parties[0].agentId).toBe("A1");
  });

  it("throws on non-object input", () => {
    expect(() => normalizeContradiction(null)).toThrow("Contradiction must be an object");
    expect(() => normalizeContradiction("invalid")).toThrow("Contradiction must be an object");
    expect(() => normalizeContradiction([1, 2])).toThrow("Contradiction must be an object");
  });

  it("throws on invalid status", () => {
    expect(() => normalizeContradiction({ status: "bogus" })).toThrow("status must be one of");
  });

  it("throws on invalid kind", () => {
    expect(() => normalizeContradiction({ kind: "bogus" })).toThrow("kind must be one of");
  });

  it("throws on invalid severity", () => {
    expect(() => normalizeContradiction({ severity: "critical" })).toThrow("severity must be one of");
  });

  it("throws on invalid resolution kind", () => {
    expect(() =>
      normalizeContradiction({
        resolution: { kind: "invalid-resolution" },
      }),
    ).toThrow("resolution.kind must be one of");
  });
});

describe("transitionContradictionStatus", () => {
  it("allows detected -> acknowledged", () => {
    expect(transitionContradictionStatus("detected", "acknowledged")).toBe("acknowledged");
  });

  it("allows detected -> resolved", () => {
    expect(transitionContradictionStatus("detected", "resolved")).toBe("resolved");
  });

  it("allows detected -> waived", () => {
    expect(transitionContradictionStatus("detected", "waived")).toBe("waived");
  });

  it("allows acknowledged -> repair_in_progress", () => {
    expect(transitionContradictionStatus("acknowledged", "repair_in_progress")).toBe("repair_in_progress");
  });

  it("allows acknowledged -> resolved", () => {
    expect(transitionContradictionStatus("acknowledged", "resolved")).toBe("resolved");
  });

  it("allows acknowledged -> waived", () => {
    expect(transitionContradictionStatus("acknowledged", "waived")).toBe("waived");
  });

  it("allows repair_in_progress -> resolved", () => {
    expect(transitionContradictionStatus("repair_in_progress", "resolved")).toBe("resolved");
  });

  it("allows repair_in_progress -> waived", () => {
    expect(transitionContradictionStatus("repair_in_progress", "waived")).toBe("waived");
  });

  it("rejects resolved -> anything (terminal)", () => {
    expect(() => transitionContradictionStatus("resolved", "detected")).toThrow(
      "Invalid contradiction transition",
    );
    expect(() => transitionContradictionStatus("resolved", "acknowledged")).toThrow(
      "Invalid contradiction transition",
    );
  });

  it("rejects waived -> anything (terminal)", () => {
    expect(() => transitionContradictionStatus("waived", "detected")).toThrow(
      "Invalid contradiction transition",
    );
  });

  it("rejects detected -> detected (no self-transition)", () => {
    expect(() => transitionContradictionStatus("detected", "detected")).toThrow(
      "Invalid contradiction transition",
    );
  });

  it("rejects invalid current status", () => {
    expect(() => transitionContradictionStatus("bogus", "resolved")).toThrow(
      "Invalid contradiction status",
    );
  });

  it("rejects invalid target status", () => {
    expect(() => transitionContradictionStatus("detected", "bogus")).toThrow(
      "Invalid target contradiction status",
    );
  });
});

describe("detectContradictions", () => {
  it("detects contradiction when two agents claim different states for same component", () => {
    const coordinationState = {
      records: [
        {
          id: "coord-1",
          kind: "claim",
          agentId: "A1",
          component: "auth-service",
          state: "healthy",
          summary: "Auth service is healthy",
          detail: "All tests pass",
        },
        {
          id: "coord-2",
          kind: "claim",
          agentId: "A2",
          component: "auth-service",
          state: "failing",
          summary: "Auth service is failing",
          detail: "Integration tests fail",
        },
      ],
    };
    const result = detectContradictions(coordinationState);
    expect(result.length).toBe(1);
    expect(result[0].status).toBe("detected");
    expect(result[0].kind).toBe("claim_conflict");
    expect(result[0].parties).toHaveLength(2);
    expect(result[0].parties[0].agentId).toBe("A1");
    expect(result[0].parties[1].agentId).toBe("A2");
    expect(result[0].reportedBy).toBe("system");
  });

  it("returns empty when no conflicts exist", () => {
    const coordinationState = {
      records: [
        {
          id: "coord-1",
          kind: "claim",
          agentId: "A1",
          component: "auth-service",
          state: "healthy",
          summary: "Auth service is healthy",
        },
        {
          id: "coord-2",
          kind: "claim",
          agentId: "A2",
          component: "auth-service",
          state: "healthy",
          summary: "Auth service is healthy too",
        },
      ],
    };
    const result = detectContradictions(coordinationState);
    expect(result.length).toBe(0);
  });

  it("returns empty for null/empty state", () => {
    expect(detectContradictions(null)).toEqual([]);
    expect(detectContradictions({})).toEqual([]);
    expect(detectContradictions({ records: [] })).toEqual([]);
  });

  it("ignores same-agent records", () => {
    const coordinationState = {
      records: [
        {
          id: "coord-1",
          kind: "claim",
          agentId: "A1",
          component: "auth-service",
          state: "healthy",
          summary: "Initially healthy",
        },
        {
          id: "coord-2",
          kind: "claim",
          agentId: "A1",
          component: "auth-service",
          state: "failing",
          summary: "Now failing",
        },
      ],
    };
    const result = detectContradictions(coordinationState);
    expect(result.length).toBe(0);
  });

  it("detects contradictions from categorized coordination state", () => {
    const coordinationState = {
      claims: [
        {
          id: "c-1",
          kind: "claim",
          agentId: "A1",
          targets: ["api-gateway"],
          state: "stable",
          summary: "API is stable",
        },
      ],
      evidence: [
        {
          id: "e-1",
          kind: "evidence",
          agentId: "A3",
          targets: ["api-gateway"],
          state: "degraded",
          summary: "API is degraded",
        },
      ],
    };
    const result = detectContradictions(coordinationState);
    expect(result.length).toBe(1);
  });

  it("respects severity option", () => {
    const coordinationState = {
      records: [
        {
          id: "coord-1",
          kind: "claim",
          agentId: "A1",
          component: "db",
          state: "ok",
          summary: "DB ok",
        },
        {
          id: "coord-2",
          kind: "evidence",
          agentId: "A2",
          component: "db",
          state: "failing",
          summary: "DB failing",
        },
      ],
    };
    const result = detectContradictions(coordinationState, { severity: "blocking" });
    expect(result.length).toBe(1);
    expect(result[0].severity).toBe("blocking");
  });

  it("includes impactedGates from options", () => {
    const coordinationState = {
      records: [
        {
          id: "coord-1",
          kind: "claim",
          agentId: "A1",
          component: "cache",
          state: "ready",
          summary: "Cache ready",
        },
        {
          id: "coord-2",
          kind: "claim",
          agentId: "A2",
          component: "cache",
          state: "stale",
          summary: "Cache stale",
        },
      ],
    };
    const result = detectContradictions(coordinationState, {
      impactedGates: ["integrationBarrier"],
    });
    expect(result.length).toBe(1);
    expect(result[0].impactedGates).toEqual(["integrationBarrier"]);
  });

  it("requires at least 2 records to detect contradictions", () => {
    const coordinationState = {
      records: [
        {
          id: "coord-1",
          kind: "claim",
          agentId: "A1",
          component: "x",
          state: "ok",
          summary: "ok",
        },
      ],
    };
    expect(detectContradictions(coordinationState)).toEqual([]);
  });
});

describe("resolveContradiction", () => {
  it("resolves a contradiction with party_accepted", () => {
    const c = normalizeContradiction({
      status: "detected",
      parties: [
        { agentId: "A1", claim: "A says X", evidence: "" },
        { agentId: "A2", claim: "B says Y", evidence: "" },
      ],
    });
    const resolved = resolveContradiction(c, {
      kind: "party_accepted",
      resolvedBy: "A8",
      detail: "A1 provided more evidence",
      evidence: "proof-bundle-1",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution.kind).toBe("party_accepted");
    expect(resolved.resolution.detail).toBe("A1 provided more evidence");
    expect(resolved.resolution.evidence).toBe("proof-bundle-1");
    expect(resolved.resolvedBy).toBe("A8");
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it("resolves with all_revised", () => {
    const c = normalizeContradiction({ status: "detected" });
    const resolved = resolveContradiction(c, {
      kind: "all_revised",
      resolvedBy: "operator",
      detail: "Both agents revised their claims",
    });
    expect(resolved.resolution.kind).toBe("all_revised");
  });

  it("resolves with irrelevant", () => {
    const c = normalizeContradiction({ status: "detected" });
    const resolved = resolveContradiction(c, {
      kind: "irrelevant",
      resolvedBy: "operator",
      detail: "Not relevant to current wave",
    });
    expect(resolved.resolution.kind).toBe("irrelevant");
  });

  it("throws on invalid resolution kind", () => {
    const c = normalizeContradiction({ status: "detected" });
    expect(() =>
      resolveContradiction(c, { kind: "bad-decision" }),
    ).toThrow("resolution.kind must be one of");
  });

  it("throws on null contradiction", () => {
    expect(() => resolveContradiction(null, { kind: "party_accepted" })).toThrow(
      "Contradiction must be an object",
    );
  });

  it("throws on null resolution", () => {
    const c = normalizeContradiction({ status: "detected" });
    expect(() => resolveContradiction(c, null)).toThrow("Resolution must be an object");
  });

  it("sets updatedAt on resolution", () => {
    const c = normalizeContradiction({ status: "detected" });
    const resolved = resolveContradiction(c, {
      kind: "party_accepted",
      resolvedBy: "A8",
      detail: "B was correct",
    });
    expect(resolved.updatedAt).toBeTruthy();
    const diff = Date.now() - Date.parse(resolved.updatedAt);
    expect(diff).toBeLessThan(5000);
  });
});

describe("waiveContradiction", () => {
  it("waives a detected contradiction", () => {
    const c = normalizeContradiction({ status: "detected" });
    const waived = waiveContradiction(c, "Not relevant to this wave");
    expect(waived.status).toBe("waived");
    expect(waived.resolution.kind).toBe("waived");
    expect(waived.resolution.detail).toBe("Not relevant to this wave");
    expect(waived.updatedAt).toBeTruthy();
  });

  it("throws on null contradiction", () => {
    expect(() => waiveContradiction(null)).toThrow("Contradiction must be an object");
  });
});

describe("acknowledgeContradiction", () => {
  it("acknowledges a detected contradiction", () => {
    const c = normalizeContradiction({ status: "detected" });
    const ack = acknowledgeContradiction(c, "A8");
    expect(ack.status).toBe("acknowledged");
    expect(ack.updatedAt).toBeTruthy();
  });

  it("throws on null contradiction", () => {
    expect(() => acknowledgeContradiction(null, "A8")).toThrow("Contradiction must be an object");
  });
});

describe("startRepair", () => {
  it("transitions to repair_in_progress with repair tasks", () => {
    const c = normalizeContradiction({ status: "acknowledged" });
    const repaired = startRepair(c, [
      { taskId: "task-fix-1", status: "pending" },
      { taskId: "task-fix-2", status: "in_progress" },
    ]);
    expect(repaired.status).toBe("repair_in_progress");
    expect(repaired.repairWork).toHaveLength(2);
    expect(repaired.repairWork[0].taskId).toBe("task-fix-1");
    expect(repaired.updatedAt).toBeTruthy();
  });

  it("sets repairWork to null when no valid tasks provided", () => {
    const c = normalizeContradiction({ status: "acknowledged" });
    const repaired = startRepair(c, []);
    expect(repaired.status).toBe("repair_in_progress");
    expect(repaired.repairWork).toBeNull();
  });

  it("throws on null contradiction", () => {
    expect(() => startRepair(null, [])).toThrow("Contradiction must be an object");
  });
});

describe("unresolvedContradictions", () => {
  it("filters out resolved and waived contradictions", () => {
    const contradictions = [
      normalizeContradiction({ status: "detected" }),
      normalizeContradiction({ status: "acknowledged" }),
      normalizeContradiction({ status: "repair_in_progress" }),
      normalizeContradiction({ status: "resolved", resolution: { kind: "party_accepted", detail: "", evidence: "" } }),
      normalizeContradiction({ status: "waived", resolution: { kind: "waived", detail: "", evidence: "" } }),
      normalizeContradiction({ status: "detected" }),
    ];
    const unresolved = unresolvedContradictions(contradictions);
    expect(unresolved.length).toBe(4); // detected + acknowledged + repair_in_progress + detected
    for (const c of unresolved) {
      expect(c.status).not.toBe("resolved");
      expect(c.status).not.toBe("waived");
    }
  });

  it("returns empty for null/empty input", () => {
    expect(unresolvedContradictions(null)).toEqual([]);
    expect(unresolvedContradictions([])).toEqual([]);
  });

  it("returns empty when all are resolved or waived", () => {
    const contradictions = [
      normalizeContradiction({ status: "resolved", resolution: { kind: "party_accepted", detail: "", evidence: "" } }),
      normalizeContradiction({ status: "waived", resolution: { kind: "waived", detail: "", evidence: "" } }),
    ];
    expect(unresolvedContradictions(contradictions).length).toBe(0);
  });
});

describe("contradictionsBlockingGate", () => {
  it("filters by gate name, blocking severity, and unresolved status", () => {
    const contradictions = [
      normalizeContradiction({
        status: "detected",
        severity: "blocking",
        impactedGates: ["integrationBarrier"],
      }),
      normalizeContradiction({
        status: "detected",
        severity: "advisory",
        impactedGates: ["integrationBarrier"],
      }),
      normalizeContradiction({
        status: "detected",
        severity: "blocking",
        impactedGates: ["otherGate"],
      }),
      normalizeContradiction({
        status: "resolved",
        severity: "blocking",
        impactedGates: ["integrationBarrier"],
        resolution: { kind: "party_accepted", detail: "", evidence: "" },
      }),
      normalizeContradiction({
        status: "waived",
        severity: "blocking",
        impactedGates: ["integrationBarrier"],
        resolution: { kind: "waived", detail: "", evidence: "" },
      }),
    ];
    const blocking = contradictionsBlockingGate(contradictions, "integrationBarrier");
    expect(blocking.length).toBe(1);
    expect(blocking[0].severity).toBe("blocking");
    expect(blocking[0].status).toBe("detected");
    expect(blocking[0].impactedGates).toContain("integrationBarrier");
  });

  it("returns empty for null/empty input", () => {
    expect(contradictionsBlockingGate(null, "integrationBarrier")).toEqual([]);
    expect(contradictionsBlockingGate([], "integrationBarrier")).toEqual([]);
  });

  it("returns empty when no gate name provided", () => {
    const contradictions = [
      normalizeContradiction({
        status: "detected",
        severity: "blocking",
        impactedGates: ["integrationBarrier"],
      }),
    ];
    expect(contradictionsBlockingGate(contradictions, "")).toEqual([]);
    expect(contradictionsBlockingGate(contradictions, null)).toEqual([]);
  });

  it("returns empty when no blocking contradictions for given gate", () => {
    const contradictions = [
      normalizeContradiction({
        status: "detected",
        severity: "advisory",
        impactedGates: ["integrationBarrier"],
      }),
    ];
    expect(contradictionsBlockingGate(contradictions, "integrationBarrier").length).toBe(0);
  });
});
