import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentEnvelopePathFromStatusPath,
  buildAgentResultEnvelope,
  readAgentResultEnvelope,
  writeAgentResultEnvelope,
} from "../../scripts/wave-orchestrator/agent-state.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-agent-envelope-"));
  tempDirs.push(dir);
  return dir;
}

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

describe("buildAgentResultEnvelope", () => {
  it("extracts correct fields from a full summary", () => {
    const agent = { agentId: "A1" };
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
        { path: "test/output.xml", kind: "test-report", sha256: "abc123", exists: true },
      ],
      deliverables: [{ path: "src/feature.mjs", exists: true }],
      components: [
        { componentId: "wave-parser", level: "repo-landed", state: "met" },
      ],
      gate: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
        detail: "All gates clear.",
      },
      security: {
        state: "clear",
        findings: 0,
        approvals: 0,
        detail: "No security issues.",
      },
      integration: {
        state: "ready-for-doc-closure",
        claims: 2,
        conflicts: 0,
        blockers: 0,
        detail: "Integration ready.",
      },
    };

    const envelope = buildAgentResultEnvelope(agent, summary);

    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.agentId).toBe("A1");
    expect(envelope.exitContract).toEqual({
      completion: "contract",
      durability: "none",
      proof: "unit",
      docImpact: "owned",
    });
    expect(envelope.proofArtifacts).toEqual([
      { path: "test/output.xml", kind: "test-report", sha256: "abc123", exists: true },
    ]);
    expect(envelope.deliverables).toEqual([{ path: "src/feature.mjs", exists: true }]);
    expect(envelope.components).toEqual([
      { componentId: "wave-parser", level: "repo-landed", state: "met" },
    ]);
    expect(envelope.gateClaims).toEqual([
      { gateId: "architecture", claim: "pass", detail: "All gates clear." },
      { gateId: "integration", claim: "pass", detail: "All gates clear." },
      { gateId: "durability", claim: "pass", detail: "All gates clear." },
      { gateId: "live", claim: "pass", detail: "All gates clear." },
      { gateId: "docs", claim: "pass", detail: "All gates clear." },
    ]);
    expect(envelope.validationOutputs.testsPassed).toBe(true);
    expect(envelope.validationOutputs.buildPassed).toBe(true);
    expect(envelope.securityFindings).toEqual([
      { state: "clear", findings: 0, approvals: 0, detail: "No security issues." },
    ]);
    expect(envelope.integrationClaims).toEqual([
      {
        state: "ready-for-doc-closure",
        claims: 2,
        conflicts: 0,
        blockers: 0,
        detail: "Integration ready.",
      },
    ]);
    expect(envelope.docsDeltas).toEqual([
      { state: "owned", paths: ["docs/api.md"], detail: "Updated API docs." },
    ]);
    expect(envelope.riskNotes).toEqual([]);
    expect(envelope.unresolvedBlockers).toEqual([]);
    expect(typeof envelope.createdAt).toBe("string");
  });

  it("returns safe defaults from null summary", () => {
    const envelope = buildAgentResultEnvelope(null, null);

    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.agentId).toBeNull();
    expect(envelope.exitContract).toEqual({
      completion: null,
      durability: null,
      proof: null,
      docImpact: null,
    });
    expect(envelope.proofArtifacts).toEqual([]);
    expect(envelope.deliverables).toEqual([]);
    expect(envelope.components).toEqual([]);
    expect(envelope.gateClaims).toEqual([]);
    expect(envelope.validationOutputs).toEqual({
      testsPassed: false,
      buildPassed: false,
    });
    expect(envelope.riskNotes).toEqual([]);
    expect(envelope.unresolvedBlockers).toEqual([]);
    expect(envelope.docsDeltas).toEqual([]);
    expect(envelope.securityFindings).toEqual([]);
    expect(envelope.integrationClaims).toEqual([]);
  });

  it("returns safe defaults from empty summary", () => {
    const envelope = buildAgentResultEnvelope({}, {});

    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.agentId).toBeNull();
    expect(envelope.exitContract).toEqual({
      completion: null,
      durability: null,
      proof: null,
      docImpact: null,
    });
    expect(envelope.proofArtifacts).toEqual([]);
    expect(envelope.deliverables).toEqual([]);
    expect(envelope.components).toEqual([]);
    expect(envelope.gateClaims).toEqual([]);
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

  it("reports testsPassed false when proof state is gap", () => {
    const summary = {
      proof: { completion: "contract", durability: "none", proof: "unit", state: "gap" },
    };
    const envelope = buildAgentResultEnvelope({}, summary);
    expect(envelope.validationOutputs.testsPassed).toBe(false);
    expect(envelope.validationOutputs.buildPassed).toBe(false);
  });
});

describe("writeAgentResultEnvelope / readAgentResultEnvelope round-trip", () => {
  it("round-trips an envelope through the filesystem", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "A1.status");
    fs.writeFileSync(statusPath, "{}", "utf8");

    const envelope = buildAgentResultEnvelope(
      { agentId: "A1" },
      {
        proof: { completion: "contract", durability: "none", proof: "unit", state: "met" },
        docDelta: { state: "owned", paths: [], detail: "" },
        deliverables: [{ path: "src/main.mjs", exists: true }],
        components: [{ componentId: "core", level: "repo-landed", state: "met" }],
      },
    );

    const writtenPath = writeAgentResultEnvelope(statusPath, envelope);
    expect(writtenPath).toBe(path.join(dir, "A1.envelope.json"));
    expect(fs.existsSync(writtenPath)).toBe(true);

    const read = readAgentResultEnvelope(statusPath);
    expect(read).not.toBeNull();
    expect(read.envelopeVersion).toBe(1);
    expect(read.agentId).toBe("A1");
    expect(read.exitContract.completion).toBe("contract");
    expect(read.deliverables).toEqual([{ path: "src/main.mjs", exists: true }]);
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
