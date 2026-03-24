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
  it("extracts correct fields from an implementation summary", () => {
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
        { path: "test/output.xml", kind: "test-report", sha256: "abc123", exists: true },
      ],
      deliverables: [{ path: "src/feature.mjs", exists: true }],
      components: [
        { componentId: "wave-parser", level: "repo-landed", state: "met" },
      ],
    };

    const envelope = buildAgentResultEnvelope(agent, summary);

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.agentId).toBe("A1");
    expect(envelope.role).toBe("implementation");
    expect(envelope.proof).toEqual({
      state: "satisfied",
      completion: "contract",
      durability: "none",
      proofLevel: "unit",
      detail: "All tests pass.",
    });
    expect(envelope.proofArtifacts).toEqual([
      {
        path: "test/output.xml",
        kind: "test-report",
        sha256: "abc123",
        exists: true,
        requiredFor: null,
      },
    ]);
    expect(envelope.deliverables).toEqual([
      { path: "src/feature.mjs", exists: true, sha256: null },
    ]);
    expect(envelope.implementation).toEqual({
      docDelta: {
        state: "owned",
        paths: ["docs/api.md"],
        detail: "Updated API docs.",
      },
      components: [
        {
          componentId: "wave-parser",
          level: "repo-landed",
          state: "met",
          detail: null,
        },
      ],
    });
    expect(envelope.gaps).toEqual([]);
    expect(envelope.unresolvedBlockers).toEqual([]);
    expect(envelope.riskNotes).toEqual([]);
    expect(envelope.facts).toEqual([]);
    expect(envelope.integration).toBeUndefined();
    expect(envelope.security).toBeUndefined();
    expect(envelope.contQa).toBeUndefined();
    expect(typeof envelope.completedAt).toBe("string");
  });

  it("extracts correct fields from a cont-QA summary", () => {
    const envelope = buildAgentResultEnvelope(
      { agentId: "A0", role: "cont-qa" },
      {
        agentId: "A0",
        gate: {
          architecture: "pass",
          integration: "pass",
          durability: "pass",
          live: "pass",
          docs: "pass",
        },
        verdict: {
          verdict: "pass",
          detail: "All gates clear.",
        },
      },
    );

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.role).toBe("cont-qa");
    expect(envelope.contQa).toEqual({
      verdict: {
        verdict: "pass",
        detail: "All gates clear.",
      },
      gateClaims: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
      },
    });
  });

  it("extracts correct fields from an integration summary", () => {
    const envelope = buildAgentResultEnvelope(
      { agentId: "A8", role: "integration" },
      {
        agentId: "A8",
        integration: {
          state: "ready-for-doc-closure",
          claims: 2,
          conflicts: 0,
          blockers: 0,
          detail: "Integration ready.",
        },
      },
    );

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.role).toBe("integration");
    expect(envelope.integration).toEqual({
      state: "ready-for-doc-closure",
      claims: 2,
      conflicts: 0,
      blockers: 0,
      detail: "Integration ready.",
    });
  });

  it("returns safe defaults from null summary", () => {
    const envelope = buildAgentResultEnvelope(null, null);

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.agentId).toBeNull();
    expect(envelope.role).toBeNull();
    expect(envelope.proof).toEqual({
      state: "not_applicable",
      completion: null,
      durability: null,
      proofLevel: null,
      detail: null,
    });
    expect(envelope.proofArtifacts).toEqual([]);
    expect(envelope.deliverables).toEqual([]);
    expect(envelope.gaps).toEqual([]);
    expect(envelope.riskNotes).toEqual([]);
    expect(envelope.unresolvedBlockers).toEqual([]);
    expect(envelope.facts).toEqual([]);
    expect(envelope.implementation).toBeUndefined();
  });

  it("returns safe defaults from empty summary", () => {
    const envelope = buildAgentResultEnvelope({}, {});

    expect(envelope.schemaVersion).toBe(2);
    expect(envelope.agentId).toBeNull();
    expect(envelope.proof).toEqual({
      state: "not_applicable",
      completion: null,
      durability: null,
      proofLevel: null,
      detail: null,
    });
    expect(envelope.proofArtifacts).toEqual([]);
    expect(envelope.deliverables).toEqual([]);
    expect(envelope.gaps).toEqual([]);
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

  it("reports partial proof state when proof state is gap", () => {
    const summary = {
      proof: { completion: "contract", durability: "none", proof: "unit", state: "gap" },
    };
    const envelope = buildAgentResultEnvelope({}, summary);
    expect(envelope.proof.state).toBe("partial");
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
    expect(read.schemaVersion).toBe(2);
    expect(read.agentId).toBe("A1");
    expect(read.proof.completion).toBe("contract");
    expect(read.deliverables).toEqual([{ path: "src/main.mjs", exists: true, sha256: null }]);
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
