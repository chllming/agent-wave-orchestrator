import { describe, it, expect } from "vitest";
import {
  FACT_KINDS,
  FACT_STATUSES,
  normalizeFact,
  generateFactId,
  buildFactLineage,
  addCitation,
  markContradicted,
  markSuperseded,
  retractFact,
  refineFact,
  activeFacts,
  factsForGate,
  factLineageSummary,
} from "../../scripts/wave-orchestrator/fact-lineage.mjs";

describe("FACT_KINDS / FACT_STATUSES", () => {
  it("contains end-state fact kinds", () => {
    expect(FACT_KINDS.has("claim")).toBe(true);
    expect(FACT_KINDS.has("proof")).toBe(true);
    expect(FACT_KINDS.has("observation")).toBe(true);
    expect(FACT_KINDS.has("decision")).toBe(true);
    expect(FACT_KINDS.has("evidence")).toBe(true);
    expect(FACT_KINDS.size).toBe(5);
  });

  it("contains end-state fact statuses", () => {
    expect(FACT_STATUSES.has("active")).toBe(true);
    expect(FACT_STATUSES.has("superseded")).toBe(true);
    expect(FACT_STATUSES.has("retracted")).toBe(true);
    expect(FACT_STATUSES.size).toBe(3);
  });
});

describe("generateFactId", () => {
  it("generates a fact ID with correct prefix", () => {
    const id = generateFactId();
    expect(id).toMatch(/^fact-[0-9a-f]{16}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateFactId()));
    expect(ids.size).toBe(50);
  });
});

describe("normalizeFact", () => {
  it("normalizes a minimal fact with defaults", () => {
    const fact = normalizeFact({});
    expect(fact.factId).toMatch(/^fact-/);
    expect(fact.kind).toBe("claim");
    expect(fact.content).toBe("");
    expect(fact.contentHash).toBeTruthy();
    expect(typeof fact.contentHash).toBe("string");
    expect(fact.contentHash.length).toBe(64); // SHA256 hex
    expect(fact.version).toBe(1);
    expect(fact.waveNumber).toBeNull();
    expect(fact.lane).toBeNull();
    expect(fact.introducedBy).toBeNull();
    expect(fact.introducedAt).toBeTruthy();
    expect(fact.sourceArtifact).toBeNull();
    expect(fact.citedBy).toEqual([]);
    expect(fact.contradictedBy).toEqual([]);
    expect(fact.supersedes).toBeNull();
    expect(fact.supersededBy).toBeNull();
    expect(fact.status).toBe("active");
  });

  it("respects explicit values", () => {
    const fact = normalizeFact({
      factId: "fact-test123",
      kind: "evidence",
      content: "Integration test passes",
      contentHash: "ignored", // should be computed, not passthrough
      version: 3,
      waveNumber: 2,
      lane: "alpha",
      introducedBy: "A1",
      introducedAt: "2025-01-01T00:00:00.000Z",
      sourceArtifact: { path: "src/test.ts", kind: "test", sha256: "abc123" },
      citedBy: [
        { entityType: "agent", entityId: "A2", context: "cited in claim" },
        { entityType: "gate", entityId: "integrationBarrier", context: "" },
      ],
      contradictedBy: ["contra-1", "contra-2"],
      supersedes: "fact-older",
      supersededBy: "fact-newer",
      status: "superseded",
    });
    expect(fact.factId).toBe("fact-test123");
    expect(fact.kind).toBe("evidence");
    expect(fact.content).toBe("Integration test passes");
    expect(fact.contentHash.length).toBe(64);
    expect(fact.version).toBe(3);
    expect(fact.waveNumber).toBe(2);
    expect(fact.lane).toBe("alpha");
    expect(fact.introducedBy).toBe("A1");
    expect(fact.introducedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(fact.sourceArtifact).toEqual({ path: "src/test.ts", kind: "test", sha256: "abc123" });
    expect(fact.citedBy).toHaveLength(2);
    expect(fact.citedBy[0].entityType).toBe("agent");
    expect(fact.citedBy[0].entityId).toBe("A2");
    expect(fact.citedBy[1].entityType).toBe("gate");
    expect(fact.contradictedBy).toEqual(["contra-1", "contra-2"]);
    expect(fact.supersedes).toBe("fact-older");
    expect(fact.supersededBy).toBe("fact-newer");
    expect(fact.status).toBe("superseded");
  });

  it("computes contentHash from content", () => {
    const fact1 = normalizeFact({ content: "hello world" });
    const fact2 = normalizeFact({ content: "hello world" });
    const fact3 = normalizeFact({ content: "different content" });
    expect(fact1.contentHash).toBe(fact2.contentHash);
    expect(fact1.contentHash).not.toBe(fact3.contentHash);
  });

  it("applies defaults from second argument", () => {
    const fact = normalizeFact(
      {},
      {
        kind: "decision",
        content: "Approved by architect",
        introducedBy: "A8",
        waveNumber: 1,
        lane: "beta",
        version: 2,
      },
    );
    expect(fact.kind).toBe("decision");
    expect(fact.content).toBe("Approved by architect");
    expect(fact.introducedBy).toBe("A8");
    expect(fact.waveNumber).toBe(1);
    expect(fact.lane).toBe("beta");
    expect(fact.version).toBe(2);
  });

  it("throws on non-object input", () => {
    expect(() => normalizeFact(null)).toThrow("Fact must be an object");
    expect(() => normalizeFact("invalid")).toThrow("Fact must be an object");
    expect(() => normalizeFact([1, 2])).toThrow("Fact must be an object");
  });

  it("throws on invalid kind", () => {
    expect(() => normalizeFact({ kind: "bogus" })).toThrow("kind must be one of");
  });

  it("accepts all valid kinds", () => {
    const kinds = ["claim", "proof", "observation", "decision", "evidence"];
    for (const kind of kinds) {
      const fact = normalizeFact({ kind });
      expect(fact.kind).toBe(kind);
    }
  });

  it("filters invalid citedBy entries", () => {
    const fact = normalizeFact({
      citedBy: [
        { entityType: "agent", entityId: "A1", context: "" },
        { entityType: "", entityId: "A2", context: "" }, // missing entityType
        null,
        "invalid",
      ],
    });
    expect(fact.citedBy).toHaveLength(1);
    expect(fact.citedBy[0].entityId).toBe("A1");
  });

  it("normalizes sourceArtifact correctly", () => {
    const fact = normalizeFact({
      sourceArtifact: { path: "src/main.ts", kind: "source", sha256: "deadbeef" },
    });
    expect(fact.sourceArtifact).toEqual({ path: "src/main.ts", kind: "source", sha256: "deadbeef" });

    const noPath = normalizeFact({
      sourceArtifact: { kind: "source" }, // missing path
    });
    expect(noPath.sourceArtifact).toBeNull();
  });
});

describe("buildFactLineage", () => {
  it("builds facts from coordination records of claim, evidence, decision kinds", () => {
    const records = [
      {
        id: "coord-1",
        kind: "claim",
        agentId: "A1",
        summary: "Auth is ready",
        detail: "Auth service passes all checks",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "coord-2",
        kind: "evidence",
        agentId: "A2",
        summary: "Tests pass",
        detail: "All integration tests pass",
        createdAt: "2025-01-01T01:00:00.000Z",
      },
      {
        id: "coord-3",
        kind: "decision",
        agentId: "A8",
        summary: "Approved",
        detail: "Architecture approved",
        createdAt: "2025-01-01T02:00:00.000Z",
      },
    ];
    const { facts, factsByAgent } = buildFactLineage(records);
    expect(facts.size).toBe(3);
    expect(factsByAgent.get("A1")?.length).toBe(1);
    expect(factsByAgent.get("A2")?.length).toBe(1);
    expect(factsByAgent.get("A8")?.length).toBe(1);

    // All facts should be active with end-state fields
    for (const fact of facts.values()) {
      expect(fact.status).toBe("active");
      expect(fact.contradictedBy).toEqual([]);
      expect(fact.supersededBy).toBeNull();
      expect(fact.contentHash).toBeTruthy();
      expect(fact.version).toBe(1);
    }
  });

  it("ignores records that are not claim, evidence, or decision", () => {
    const records = [
      { id: "coord-1", kind: "request", agentId: "A1", summary: "Please review" },
      { id: "coord-2", kind: "ack", agentId: "A2", summary: "Acknowledged" },
      { id: "coord-3", kind: "claim", agentId: "A3", summary: "Claim here" },
    ];
    const { facts } = buildFactLineage(records);
    expect(facts.size).toBe(1);
  });

  it("builds facts from proof bundles with kind 'proof'", () => {
    const proofBundles = [
      {
        id: "proof-A1",
        agentId: "A1",
        recordedAt: "2025-01-01T00:00:00.000Z",
        detail: "Proof bundle for A1",
        artifacts: [
          { path: "src/auth.ts", kind: "file" },
          { path: "src/auth.test.ts", kind: "test" },
        ],
      },
    ];
    const { facts, factsByAgent } = buildFactLineage([], proofBundles);
    expect(facts.size).toBe(2);
    expect(factsByAgent.get("A1")?.length).toBe(2);

    const factArray = Array.from(facts.values());
    expect(factArray.every((f) => f.kind === "proof")).toBe(true);
    expect(factArray.some((f) => f.content === "src/auth.ts")).toBe(true);
    expect(factArray.some((f) => f.content === "src/auth.test.ts")).toBe(true);
  });

  it("sets sourceArtifact for proof bundle artifacts", () => {
    const proofBundles = [
      {
        id: "proof-A1",
        agentId: "A1",
        artifacts: [{ path: "src/auth.ts", kind: "file", sha256: "abc123" }],
      },
    ];
    const { facts } = buildFactLineage([], proofBundles);
    const fact = Array.from(facts.values())[0];
    expect(fact.sourceArtifact).toEqual({ path: "src/auth.ts", kind: "file", sha256: "abc123" });
  });

  it("creates a fact for a proof bundle with no artifacts", () => {
    const proofBundles = [
      {
        id: "proof-A1",
        agentId: "A1",
        recordedAt: "2025-01-01T00:00:00.000Z",
        detail: "Manual verification done",
        artifacts: [],
      },
    ];
    const { facts } = buildFactLineage([], proofBundles);
    expect(facts.size).toBe(1);
    const fact = Array.from(facts.values())[0];
    expect(fact.kind).toBe("proof");
    expect(fact.content).toBe("Manual verification done");
  });

  it("cross-references via dependsOn to build structured citations", () => {
    const records = [
      {
        id: "coord-1",
        kind: "claim",
        agentId: "A1",
        summary: "Initial claim",
        dependsOn: [],
      },
      {
        id: "coord-2",
        kind: "evidence",
        agentId: "A2",
        summary: "Evidence citing A1",
        dependsOn: ["coord-1"],
      },
    ];
    const { facts } = buildFactLineage(records);
    expect(facts.size).toBe(2);

    // Find the fact for coord-1 and check it's cited by A2 as structured entry
    let coord1Fact = null;
    for (const fact of facts.values()) {
      if (fact.content.includes("Initial claim") || fact.content === "Initial claim") {
        coord1Fact = fact;
      }
    }
    expect(coord1Fact).not.toBeNull();
    expect(coord1Fact.citedBy).toHaveLength(1);
    expect(coord1Fact.citedBy[0].entityType).toBe("agent");
    expect(coord1Fact.citedBy[0].entityId).toBe("A2");
  });

  it("returns empty maps for null/empty input", () => {
    const { facts, factsByAgent } = buildFactLineage(null);
    expect(facts.size).toBe(0);
    expect(factsByAgent.size).toBe(0);
  });

  it("handles mixed coordination records and proof bundles", () => {
    const records = [
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Claim" },
    ];
    const bundles = [
      {
        id: "proof-A2",
        agentId: "A2",
        artifacts: [{ path: "src/b.ts" }],
      },
    ];
    const { facts, factsByAgent } = buildFactLineage(records, bundles);
    expect(facts.size).toBe(2);
    expect(factsByAgent.get("A1")?.length).toBe(1);
    expect(factsByAgent.get("A2")?.length).toBe(1);
  });
});

describe("addCitation", () => {
  it("adds a structured citation to a fact", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    addCitation(facts, factId, { entityType: "agent", entityId: "A3", context: "review" });
    expect(facts.get(factId).citedBy).toContainEqual({
      entityType: "agent",
      entityId: "A3",
      context: "review",
    });
  });

  it("accepts a simple string (agentId) as citation shorthand", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    addCitation(facts, factId, "A3");
    expect(facts.get(factId).citedBy).toContainEqual({
      entityType: "agent",
      entityId: "A3",
      context: "",
    });
  });

  it("does not duplicate citations", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    addCitation(facts, factId, "A3");
    addCitation(facts, factId, "A3");
    const citedByA3 = facts.get(factId).citedBy.filter(
      (c) => c.entityType === "agent" && c.entityId === "A3",
    );
    expect(citedByA3.length).toBe(1);
  });

  it("throws for non-existent fact", () => {
    const facts = new Map();
    expect(() => addCitation(facts, "fact-nonexistent", "A1")).toThrow("Fact not found");
  });

  it("throws for non-Map input", () => {
    expect(() => addCitation({}, "fact-1", "A1")).toThrow("factMap must be a Map");
  });

  it("throws for empty string citation", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    expect(() => addCitation(facts, factId, "")).toThrow("citation is required");
  });
});

describe("markContradicted", () => {
  it("appends a contradictionId to the contradictedBy array", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    markContradicted(facts, factId, "contra-abc");
    expect(facts.get(factId).contradictedBy).toContain("contra-abc");
  });

  it("does not duplicate contradictionIds", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    markContradicted(facts, factId, "contra-abc");
    markContradicted(facts, factId, "contra-abc");
    expect(facts.get(factId).contradictedBy).toEqual(["contra-abc"]);
  });

  it("supports multiple contradictions on the same fact", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    markContradicted(facts, factId, "contra-1");
    markContradicted(facts, factId, "contra-2");
    expect(facts.get(factId).contradictedBy).toEqual(["contra-1", "contra-2"]);
  });

  it("throws for non-existent fact", () => {
    const facts = new Map();
    expect(() => markContradicted(facts, "fact-nonexistent", "contra-1")).toThrow("Fact not found");
  });

  it("throws for non-Map input", () => {
    expect(() => markContradicted({}, "fact-1", "contra-1")).toThrow("factMap must be a Map");
  });
});

describe("markSuperseded", () => {
  it("sets supersededBy and changes status to superseded", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    markSuperseded(facts, factId, "fact-newer");
    expect(facts.get(factId).supersededBy).toBe("fact-newer");
    expect(facts.get(factId).status).toBe("superseded");
  });

  it("throws for non-existent fact", () => {
    const facts = new Map();
    expect(() => markSuperseded(facts, "fact-nonexistent", "fact-newer")).toThrow("Fact not found");
  });

  it("throws for non-Map input", () => {
    expect(() => markSuperseded({}, "fact-1", "fact-2")).toThrow("factMap must be a Map");
  });
});

describe("retractFact", () => {
  it("sets status to retracted", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Test" },
    ]);
    const factId = Array.from(facts.keys())[0];
    retractFact(facts, factId);
    expect(facts.get(factId).status).toBe("retracted");
  });

  it("throws for non-existent fact", () => {
    const facts = new Map();
    expect(() => retractFact(facts, "fact-nonexistent")).toThrow("Fact not found");
  });

  it("throws for non-Map input", () => {
    expect(() => retractFact({}, "fact-1")).toThrow("factMap must be a Map");
  });
});

describe("refineFact", () => {
  it("updates content, recomputes contentHash, and increments version", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Original" },
    ]);
    const factId = Array.from(facts.keys())[0];
    const originalHash = facts.get(factId).contentHash;
    expect(facts.get(factId).version).toBe(1);

    refineFact(facts, factId, "Refined content");
    expect(facts.get(factId).content).toBe("Refined content");
    expect(facts.get(factId).contentHash).not.toBe(originalHash);
    expect(facts.get(factId).version).toBe(2);
  });

  it("increments version on each refinement", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "V1" },
    ]);
    const factId = Array.from(facts.keys())[0];
    refineFact(facts, factId, "V2");
    refineFact(facts, factId, "V3");
    expect(facts.get(factId).version).toBe(3);
    expect(facts.get(factId).content).toBe("V3");
  });

  it("throws for non-existent fact", () => {
    expect(() => refineFact(new Map(), "fact-nonexistent", "new")).toThrow("Fact not found");
  });

  it("throws for non-Map input", () => {
    expect(() => refineFact({}, "fact-1", "new")).toThrow("factMap must be a Map");
  });
});

describe("activeFacts", () => {
  it("returns only facts with status active", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Active" },
      { id: "coord-2", kind: "evidence", agentId: "A2", summary: "Will be contradicted" },
      { id: "coord-3", kind: "decision", agentId: "A3", summary: "Will be superseded" },
    ]);
    const factIds = Array.from(facts.keys());
    markContradicted(facts, factIds[1], "contra-1");
    markSuperseded(facts, factIds[2], "fact-new");

    const active = activeFacts(facts);
    // contradicted fact still has status "active" (just has contradictedBy populated)
    // superseded fact has status "superseded"
    expect(active.length).toBe(2);
  });

  it("returns empty for non-Map input", () => {
    expect(activeFacts(null)).toEqual([]);
    expect(activeFacts({})).toEqual([]);
  });

  it("returns all facts when none are superseded or retracted", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "A" },
      { id: "coord-2", kind: "claim", agentId: "A2", summary: "B" },
    ]);
    expect(activeFacts(facts).length).toBe(2);
  });
});

describe("factsForGate", () => {
  it("returns facts cited by a specific gate", () => {
    const facts = new Map();
    const f1 = normalizeFact({
      kind: "claim",
      content: "Gate A relevant",
      citedBy: [{ entityType: "gate", entityId: "integrationBarrier", context: "" }],
    });
    const f2 = normalizeFact({
      kind: "evidence",
      content: "Gate B relevant",
      citedBy: [{ entityType: "gate", entityId: "securityGate", context: "" }],
    });
    const f3 = normalizeFact({
      kind: "decision",
      content: "Both gates",
      citedBy: [
        { entityType: "gate", entityId: "integrationBarrier", context: "" },
        { entityType: "gate", entityId: "securityGate", context: "" },
      ],
    });
    facts.set(f1.factId, f1);
    facts.set(f2.factId, f2);
    facts.set(f3.factId, f3);

    const result = factsForGate(facts, "integrationBarrier");
    expect(result.length).toBe(2);
    expect(result.some((f) => f.content === "Gate A relevant")).toBe(true);
    expect(result.some((f) => f.content === "Both gates")).toBe(true);
  });

  it("returns empty for non-Map or empty gate name", () => {
    expect(factsForGate(null, "gate:x")).toEqual([]);
    expect(factsForGate(new Map(), "")).toEqual([]);
    expect(factsForGate(new Map(), null)).toEqual([]);
  });

  it("returns empty when no facts match the gate", () => {
    const facts = new Map();
    const f1 = normalizeFact({
      kind: "claim",
      citedBy: [{ entityType: "gate", entityId: "otherGate", context: "" }],
    });
    facts.set(f1.factId, f1);
    expect(factsForGate(facts, "integrationBarrier")).toEqual([]);
  });
});

describe("factLineageSummary", () => {
  it("aggregates counts correctly including retracted", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "Active" },
      { id: "coord-2", kind: "evidence", agentId: "A2", summary: "Contradicted" },
      { id: "coord-3", kind: "decision", agentId: "A3", summary: "Superseded" },
      { id: "coord-4", kind: "claim", agentId: "A4", summary: "Retracted" },
      { id: "coord-5", kind: "claim", agentId: "A5", summary: "Active2" },
    ]);
    const factIds = Array.from(facts.keys());

    // Add citations
    addCitation(facts, factIds[0], "A5");
    addCitation(facts, factIds[0], { entityType: "gate", entityId: "gateA", context: "" });
    addCitation(facts, factIds[1], "A7");

    // Mark contradicted, superseded, retracted
    markContradicted(facts, factIds[1], "contra-1");
    markSuperseded(facts, factIds[2], "fact-new");
    retractFact(facts, factIds[3]);

    const summary = factLineageSummary(facts);
    expect(summary.totalFacts).toBe(5);
    // coord-2 has contradictedBy populated but status remains "active"
    // only coord-3 (superseded) and coord-4 (retracted) are non-active
    expect(summary.activeFacts).toBe(3); // coord-1, coord-2, coord-5
    expect(summary.supersededFacts).toBe(1);
    expect(summary.retractedFacts).toBe(1);
    expect(summary.contradictedFacts).toBe(1); // coord-2 has non-empty contradictedBy
    expect(summary.citationCount).toBe(3);
  });

  it("returns zero counts for non-Map input", () => {
    const summary = factLineageSummary(null);
    expect(summary).toEqual({
      totalFacts: 0,
      activeFacts: 0,
      supersededFacts: 0,
      retractedFacts: 0,
      contradictedFacts: 0,
      citationCount: 0,
    });
  });

  it("returns correct counts for empty map", () => {
    const summary = factLineageSummary(new Map());
    expect(summary.totalFacts).toBe(0);
    expect(summary.activeFacts).toBe(0);
  });

  it("counts all facts as active when none are superseded or retracted", () => {
    const { facts } = buildFactLineage([
      { id: "coord-1", kind: "claim", agentId: "A1", summary: "A" },
      { id: "coord-2", kind: "claim", agentId: "A2", summary: "B" },
    ]);
    const summary = factLineageSummary(facts);
    expect(summary.totalFacts).toBe(2);
    expect(summary.activeFacts).toBe(2);
    expect(summary.contradictedFacts).toBe(0);
    expect(summary.supersededFacts).toBe(0);
    expect(summary.retractedFacts).toBe(0);
  });
});
