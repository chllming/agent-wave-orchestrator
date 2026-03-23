import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ENVELOPE_VALID_ROLES,
  agentEnvelopePath,
  agentEnvelopePathFromStatusPath,
  buildAgentResultEnvelope,
  buildEnvelopeFromLegacySignals,
  readAgentResultEnvelope,
  writeAgentResultEnvelope,
} from "../../scripts/wave-orchestrator/agent-state.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-agent-envelope-"));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// agentEnvelopePath (attempt-scoped canonical path)
// ---------------------------------------------------------------------------

describe("agentEnvelopePath", () => {
  it("builds attempt-scoped canonical path", () => {
    const result = agentEnvelopePath({
      lane: "main",
      waveNumber: 3,
      attempt: 1,
      agentId: "A1",
    });
    expect(result).toBe(".tmp/main-wave-launcher/results/wave-3/attempt-1/A1.json");
  });

  it("uses defaults for missing fields", () => {
    const result = agentEnvelopePath({});
    expect(result).toBe(".tmp/main-wave-launcher/results/wave-0/attempt-1/unknown.json");
  });

  it("handles different lanes", () => {
    const result = agentEnvelopePath({
      lane: "hotfix",
      waveNumber: 5,
      attempt: 2,
      agentId: "A8",
    });
    expect(result).toBe(".tmp/hotfix-wave-launcher/results/wave-5/attempt-2/A8.json");
  });
});

// ---------------------------------------------------------------------------
// agentEnvelopePathFromStatusPath (legacy compatibility)
// ---------------------------------------------------------------------------

describe("agentEnvelopePathFromStatusPath", () => {
  it("replaces .status extension with .envelope.json", () => {
    expect(agentEnvelopePathFromStatusPath("/tmp/wave/A1.status")).toBe(
      "/tmp/wave/A1.envelope.json",
    );
  });

  it("replaces .summary.json extension with .envelope.json", () => {
    expect(agentEnvelopePathFromStatusPath("/tmp/wave/A1.summary.json")).toBe(
      "/tmp/wave/A1.envelope.json",
    );
  });

  it("appends .envelope.json for unrecognized extensions", () => {
    expect(agentEnvelopePathFromStatusPath("/tmp/wave/A1.log")).toBe(
      "/tmp/wave/A1.log.envelope.json",
    );
  });
});

// ---------------------------------------------------------------------------
// ENVELOPE_VALID_ROLES
// ---------------------------------------------------------------------------

describe("ENVELOPE_VALID_ROLES", () => {
  it("contains all expected roles", () => {
    expect(ENVELOPE_VALID_ROLES).toContain("implementation");
    expect(ENVELOPE_VALID_ROLES).toContain("integration");
    expect(ENVELOPE_VALID_ROLES).toContain("documentation");
    expect(ENVELOPE_VALID_ROLES).toContain("cont-qa");
    expect(ENVELOPE_VALID_ROLES).toContain("cont-eval");
    expect(ENVELOPE_VALID_ROLES).toContain("security");
    expect(ENVELOPE_VALID_ROLES).toContain("deploy");
    expect(ENVELOPE_VALID_ROLES.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// buildAgentResultEnvelope — schemaVersion 2
// ---------------------------------------------------------------------------

describe("buildAgentResultEnvelope", () => {
  it("builds v2 envelope with common header for implementation role", () => {
    const agent = { agentId: "A1", role: "implementation" };
    const summary = {
      agentId: "A1",
      proof: {
        completion: "contract",
        durability: "none",
        proof: "unit",
        state: "met",
        detail: "All tests pass.",
      },
      docDelta: {
        state: "owned",
        paths: ["docs/api.md"],
        detail: "Updated API docs.",
      },
      proofArtifacts: [
        { path: "test/output.xml", kind: "test-report", sha256: "abc123", exists: true, requiredFor: "code_proof" },
      ],
      deliverables: [{ path: "src/feature.mjs", exists: true, sha256: "def456" }],
      components: [
        { componentId: "wave-parser", level: "repo-landed", state: "met", detail: "Component complete" },
      ],
    };

    const envelope = buildAgentResultEnvelope(agent, summary, { waveNumber: 3, attempt: 1, exitCode: 0 });

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.agentId).toBe("A1");
    expect(envelope.waveNumber).toBe(3);
    expect(envelope.attempt).toBe(1);
    expect(envelope.exitCode).toBe(0);
    expect(envelope.role).toBe("implementation");
    expect(typeof envelope.completedAt).toBe("string");

    // Common proof section
    expect(envelope.proof).toEqual({
      state: "satisfied",
      completion: "contract",
      durability: "none",
      proofLevel: "unit",
      detail: "All tests pass.",
    });

    // Deliverables with sha256
    expect(envelope.deliverables).toEqual([
      { path: "src/feature.mjs", exists: true, sha256: "def456" },
    ]);

    // Proof artifacts with sha256 and requiredFor
    expect(envelope.proofArtifacts).toEqual([
      { path: "test/output.xml", kind: "test-report", exists: true, sha256: "abc123", requiredFor: "code_proof" },
    ]);

    // Gaps, facts
    expect(envelope.gaps).toEqual([]);
    expect(envelope.facts).toEqual([]);

    // Implementation role-specific payload
    expect(envelope.implementation).toBeDefined();
    expect(envelope.implementation.docDelta).toEqual({
      state: "owned",
      paths: ["docs/api.md"],
      detail: "Updated API docs.",
    });
    expect(envelope.implementation.components).toEqual([
      { componentId: "wave-parser", level: "repo-landed", state: "met", detail: "Component complete" },
    ]);

    // No other role payloads present
    expect(envelope.integration).toBeUndefined();
    expect(envelope.documentation).toBeUndefined();
    expect(envelope.contQa).toBeUndefined();
    expect(envelope.contEval).toBeUndefined();
    expect(envelope.security).toBeUndefined();
    expect(envelope.deploy).toBeUndefined();
  });

  it("builds v2 envelope for integration role", () => {
    const agent = { agentId: "A8", role: "integration" };
    const summary = {
      integration: {
        state: "clean",
        claims: 5,
        conflicts: 0,
        blockers: 0,
        detail: "All integrations clean.",
      },
    };
    const envelope = buildAgentResultEnvelope(agent, summary, { waveNumber: 2, attempt: 1 });

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.role).toBe("integration");
    expect(envelope.integration).toEqual({
      state: "clean",
      claims: 5,
      conflicts: 0,
      blockers: 0,
      detail: "All integrations clean.",
    });
    expect(envelope.implementation).toBeUndefined();
  });

  it("builds v2 envelope for documentation role", () => {
    const agent = { agentId: "A9", role: "documentation" };
    const summary = {
      docDelta: {
        state: "closed",
        paths: ["docs/api.md"],
        detail: "All docs closed.",
      },
    };
    const envelope = buildAgentResultEnvelope(agent, summary);

    expect(envelope.role).toBe("documentation");
    expect(envelope.documentation).toBeDefined();
    expect(envelope.documentation.docClosure).toEqual({
      state: "closed",
      paths: ["docs/api.md"],
      detail: "All docs closed.",
    });
    expect(envelope.implementation).toBeUndefined();
  });

  it("builds v2 envelope for cont-qa role", () => {
    const agent = { agentId: "A0", role: "cont-qa" };
    const summary = {
      verdict: {
        verdict: "pass",
        detail: "All checks passed.",
      },
      gate: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
      },
    };
    const envelope = buildAgentResultEnvelope(agent, summary);

    expect(envelope.role).toBe("cont-qa");
    expect(envelope.contQa).toBeDefined();
    expect(envelope.contQa.verdict).toEqual({
      verdict: "pass",
      detail: "All checks passed.",
    });
    expect(envelope.contQa.gateClaims).toEqual({
      architecture: "pass",
      integration: "pass",
      durability: "pass",
      live: "pass",
      docs: "pass",
    });
  });

  it("builds v2 envelope for cont-eval role", () => {
    const agent = { agentId: "E0", role: "cont-eval" };
    const summary = {
      eval: {
        state: "satisfied",
        targets: 3,
        benchmarks: 5,
        regressions: 0,
        targetIds: ["t1", "t2", "t3"],
        benchmarkIds: ["b1", "b2", "b3", "b4", "b5"],
        detail: "All evals passed.",
      },
    };
    const envelope = buildAgentResultEnvelope(agent, summary);

    expect(envelope.role).toBe("cont-eval");
    expect(envelope.contEval).toEqual({
      state: "satisfied",
      targets: 3,
      benchmarks: 5,
      regressions: 0,
      targetIds: ["t1", "t2", "t3"],
      benchmarkIds: ["b1", "b2", "b3", "b4", "b5"],
      detail: "All evals passed.",
    });
  });

  it("builds v2 envelope for security role", () => {
    const agent = { agentId: "S0", role: "security" };
    const summary = {
      security: {
        state: "clean",
        findings: 0,
        approvals: 2,
        detail: "No security issues.",
      },
    };
    const envelope = buildAgentResultEnvelope(agent, summary);

    expect(envelope.role).toBe("security");
    expect(envelope.security).toEqual({
      state: "clean",
      findings: 0,
      approvals: 2,
      detail: "No security issues.",
    });
  });

  it("builds v2 envelope for deploy role", () => {
    const agent = { agentId: "D0", role: "deploy" };
    const summary = {
      deploy: {
        state: "succeeded",
        environment: "staging",
        healthCheck: { passed: true, detail: "All healthy" },
        rolloutArtifact: { path: "deploy/rollout.json", exists: true, sha256: "xyz" },
        detail: "Deployed successfully.",
      },
    };
    const envelope = buildAgentResultEnvelope(agent, summary);

    expect(envelope.role).toBe("deploy");
    expect(envelope.deploy).toEqual({
      state: "succeeded",
      environment: "staging",
      healthCheck: { passed: true, detail: "All healthy" },
      rolloutArtifact: { path: "deploy/rollout.json", exists: true, sha256: "xyz" },
      detail: "Deployed successfully.",
    });
  });

  it("returns safe defaults from null inputs", () => {
    const envelope = buildAgentResultEnvelope(null, null);

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.agentId).toBeNull();
    expect(envelope.role).toBeNull();
    expect(envelope.waveNumber).toBeNull();
    expect(envelope.attempt).toBeNull();
    expect(envelope.exitCode).toBe(0);
    expect(envelope.proof).toEqual({
      state: "not_applicable",
      completion: null,
      durability: null,
      proofLevel: null,
      detail: null,
    });
    expect(envelope.deliverables).toEqual([]);
    expect(envelope.proofArtifacts).toEqual([]);
    expect(envelope.gaps).toEqual([]);
    expect(envelope.unresolvedBlockers).toEqual([]);
    expect(envelope.riskNotes).toEqual([]);
    expect(envelope.facts).toEqual([]);
    // No role payload present for null role
    expect(envelope.implementation).toBeUndefined();
    expect(envelope.integration).toBeUndefined();
  });

  it("returns safe defaults from empty inputs", () => {
    const envelope = buildAgentResultEnvelope({}, {});

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.agentId).toBeNull();
    expect(envelope.role).toBeNull();
    expect(envelope.proof.state).toBe("not_applicable");
    expect(envelope.deliverables).toEqual([]);
  });

  it("takes agentId from agent when summary has none", () => {
    const envelope = buildAgentResultEnvelope({ agentId: "A5" }, {});
    expect(envelope.agentId).toBe("A5");
  });

  it("takes agentId from summary when agent has none", () => {
    const envelope = buildAgentResultEnvelope({}, { agentId: "A7" });
    expect(envelope.agentId).toBe("A7");
  });

  it("prefers agent.agentId over summary.agentId", () => {
    const envelope = buildAgentResultEnvelope(
      { agentId: "A1" },
      { agentId: "A2" },
    );
    expect(envelope.agentId).toBe("A1");
  });

  it("maps proof state 'met' to 'satisfied'", () => {
    const envelope = buildAgentResultEnvelope({}, {
      proof: { state: "met", completion: "contract", durability: "durable", proof: "unit" },
    });
    expect(envelope.proof.state).toBe("satisfied");
  });

  it("maps proof state 'gap' to 'partial'", () => {
    const envelope = buildAgentResultEnvelope({}, {
      proof: { state: "gap" },
    });
    expect(envelope.proof.state).toBe("partial");
  });

  it("maps proof state 'failed' to 'failed'", () => {
    const envelope = buildAgentResultEnvelope({}, {
      proof: { state: "failed" },
    });
    expect(envelope.proof.state).toBe("failed");
  });

  it("maps unknown proof state to 'not_applicable'", () => {
    const envelope = buildAgentResultEnvelope({}, {
      proof: { state: "unknown-state" },
    });
    expect(envelope.proof.state).toBe("not_applicable");
  });

  it("includes gaps when present", () => {
    const envelope = buildAgentResultEnvelope(
      { agentId: "A1", role: "implementation" },
      {
        gaps: [
          { kind: "missing-test", detail: "No unit tests for parser.mjs" },
          { kind: "missing-docs", detail: "API reference not updated" },
        ],
      },
    );
    expect(envelope.gaps).toEqual([
      { kind: "missing-test", detail: "No unit tests for parser.mjs" },
      { kind: "missing-docs", detail: "API reference not updated" },
    ]);
  });

  it("includes facts when present", () => {
    const envelope = buildAgentResultEnvelope(
      { agentId: "A1", role: "implementation" },
      {
        facts: [
          { factId: "f-1", kind: "claim", content: "Parser handles nested blocks" },
        ],
      },
    );
    expect(envelope.facts).toEqual([
      { factId: "f-1", kind: "claim", content: "Parser handles nested blocks" },
    ]);
  });

  it("options override waveNumber, attempt, exitCode", () => {
    const envelope = buildAgentResultEnvelope(
      { agentId: "A1", role: "implementation" },
      { waveNumber: 1, attempt: 1, exitCode: 1 },
      { waveNumber: 5, attempt: 3, exitCode: 0 },
    );
    expect(envelope.waveNumber).toBe(5);
    expect(envelope.attempt).toBe(3);
    expect(envelope.exitCode).toBe(0);
  });

  it("falls back to summary waveNumber/attempt when options omit them", () => {
    const envelope = buildAgentResultEnvelope(
      { agentId: "A1" },
      { waveNumber: 4, attempt: 2 },
    );
    expect(envelope.waveNumber).toBe(4);
    expect(envelope.attempt).toBe(2);
  });

  it("normalizes unresolvedBlockers from objects", () => {
    const envelope = buildAgentResultEnvelope(
      { agentId: "A1", role: "implementation" },
      {
        unresolvedBlockers: [
          { kind: "dependency", detail: "Waiting for A3", blocking: "wave-1:A1:feature" },
        ],
      },
    );
    expect(envelope.unresolvedBlockers).toEqual([
      { kind: "dependency", detail: "Waiting for A3", blocking: "wave-1:A1:feature" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildEnvelopeFromLegacySignals
// ---------------------------------------------------------------------------

describe("buildEnvelopeFromLegacySignals", () => {
  it("builds a v2 envelope with legacy marker", () => {
    const agent = { agentId: "A1", role: "implementation" };
    const summary = {
      proof: { state: "met", completion: "contract", durability: "none", proof: "unit" },
      docDelta: { state: "owned", paths: ["docs/api.md"], detail: "Updated." },
      components: [{ componentId: "core", level: "repo-landed", state: "met" }],
    };
    const envelope = buildEnvelopeFromLegacySignals(agent, summary, { waveNumber: 2, attempt: 1 });

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope._synthesizedFromLegacy).toBe(true);
    expect(envelope.agentId).toBe("A1");
    expect(envelope.role).toBe("implementation");
    expect(envelope.proof.state).toBe("satisfied");
    expect(envelope.implementation).toBeDefined();
    expect(envelope.implementation.docDelta.state).toBe("owned");
  });

  it("handles empty inputs gracefully", () => {
    const envelope = buildEnvelopeFromLegacySignals(null, null);
    expect(envelope.schemaVersion).toBe(2);
    expect(envelope._synthesizedFromLegacy).toBe(true);
    expect(envelope.agentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeAgentResultEnvelope / readAgentResultEnvelope round-trip
// ---------------------------------------------------------------------------

describe("writeAgentResultEnvelope / readAgentResultEnvelope round-trip", () => {
  it("round-trips a v2 envelope through the filesystem", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "A1.status");
    fs.writeFileSync(statusPath, "{}", "utf8");

    const envelope = buildAgentResultEnvelope(
      { agentId: "A1", role: "implementation" },
      {
        proof: { completion: "contract", durability: "none", proof: "unit", state: "met" },
        docDelta: { state: "owned", paths: [], detail: "" },
        deliverables: [{ path: "src/main.mjs", exists: true, sha256: "abc" }],
        components: [{ componentId: "core", level: "repo-landed", state: "met" }],
      },
      { waveNumber: 1, attempt: 1, exitCode: 0 },
    );

    const writtenPath = writeAgentResultEnvelope(statusPath, envelope);
    expect(writtenPath).toBe(path.join(dir, "A1.envelope.json"));
    expect(fs.existsSync(writtenPath)).toBe(true);

    const read = readAgentResultEnvelope(statusPath);
    expect(read).not.toBeNull();
    expect(read.schemaVersion).toBe(2);
    expect(read.agentId).toBe("A1");
    expect(read.role).toBe("implementation");
    expect(read.deliverables).toEqual([{ path: "src/main.mjs", exists: true, sha256: "abc" }]);
    expect(read.implementation).toBeDefined();
  });

  it("returns null when no envelope file exists", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "A99.status");
    const result = readAgentResultEnvelope(statusPath);
    expect(result).toBeNull();
  });

  it("writes envelope alongside .summary.json path", () => {
    const dir = makeTempDir();
    const summaryPath = path.join(dir, "A2.summary.json");
    fs.writeFileSync(summaryPath, "{}", "utf8");

    const envelope = buildAgentResultEnvelope({ agentId: "A2" }, {});
    const writtenPath = writeAgentResultEnvelope(summaryPath, envelope);
    expect(writtenPath).toBe(path.join(dir, "A2.envelope.json"));
    expect(fs.existsSync(writtenPath)).toBe(true);

    const read = readAgentResultEnvelope(summaryPath);
    expect(read).not.toBeNull();
    expect(read.agentId).toBe("A2");
  });
});
