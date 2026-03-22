import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentExecutionSummary,
  validateDocumentationClosureSummary,
  validateEvaluatorSummary,
  validateImplementationSummary,
} from "../../scripts/wave-orchestrator/agent-state.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-agent-state-"));
  tempDirs.push(dir);
  return dir;
}

describe("buildAgentExecutionSummary", () => {
  it("parses wrapped structured markers and records deliverable presence", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a8.log");
    fs.writeFileSync(
      logPath,
      [
        "`[wave-proof] completion=integrated durability=durable proof=integration state=met detail=wrapped-proof`",
        "```text",
        "[wave-doc-delta] state=owned paths=docs/example.md detail=fenced-doc-delta",
        "[wave-component] component=wave-parser-and-launcher level=repo-landed state=met detail=fenced-component",
        "[wave-integration] state=needs-more-work claims=1 conflicts=2 blockers=3 detail=fenced-integration",
        "```",
        "`[wave-gate] architecture=pass integration=pass durability=pass live=pass docs=pass detail=wrapped-gate`",
      ].join("\n"),
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: {
        agentId: "A8",
        deliverables: ["README.md"],
      },
      statusRecord: {
        code: 0,
        promptHash: "hash",
      },
      logPath,
    });

    expect(summary.proof).toMatchObject({
      completion: "integrated",
      durability: "durable",
      proof: "integration",
      state: "met",
      detail: "wrapped-proof",
    });
    expect(summary.docDelta).toMatchObject({
      state: "owned",
      paths: ["docs/example.md"],
      detail: "fenced-doc-delta",
    });
    expect(summary.integration).toMatchObject({
      state: "needs-more-work",
      claims: 1,
      conflicts: 2,
      blockers: 3,
      detail: "fenced-integration",
    });
    expect(summary.components).toEqual([
      {
        componentId: "wave-parser-and-launcher",
        level: "repo-landed",
        state: "met",
        detail: "fenced-component",
      },
    ]);
    expect(summary.gate).toMatchObject({
      architecture: "pass",
      integration: "pass",
      durability: "pass",
      live: "pass",
      docs: "pass",
      detail: "wrapped-gate",
    });
    expect(summary.deliverables).toEqual([{ path: "README.md", exists: true }]);
  });
});

describe("validateImplementationSummary", () => {
  it("rejects package-level proof when the exit contract requires integration", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A2",
          exitContract: {
            completion: "integrated",
            durability: "none",
            proof: "integration",
            docImpact: "owned",
          },
        },
        {
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: [],
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "completion-gap",
    });
  });

  it("rejects ephemeral durability when the exit contract requires durable state", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A2",
          exitContract: {
            completion: "authoritative",
            durability: "durable",
            proof: "integration",
            docImpact: "owned",
          },
        },
        {
          proof: {
            completion: "authoritative",
            durability: "ephemeral",
            proof: "integration",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: [],
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "durability-gap",
    });
  });

  it("rejects missing component markers for owned components", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A2",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
          components: ["wave-parser-and-launcher"],
          componentTargets: {
            "wave-parser-and-launcher": "repo-landed",
          },
        },
        {
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: [],
          },
          components: [],
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-wave-component",
    });
  });

  it("rejects missing declared deliverables", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A2",
          exitContract: {
            completion: "integrated",
            durability: "none",
            proof: "integration",
            docImpact: "owned",
          },
          deliverables: ["docs/missing.md"],
        },
        {
          proof: {
            completion: "integrated",
            durability: "none",
            proof: "integration",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: [],
          },
          deliverables: [{ path: "docs/missing.md", exists: false }],
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-deliverable",
    });
  });
});

describe("validateDocumentationClosureSummary", () => {
  it("rejects open shared-plan deltas", () => {
    expect(
      validateDocumentationClosureSummary(
        { agentId: "A9" },
        {
          docClosure: {
            state: "delta",
            paths: ["docs/plans/current-state.md"],
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "doc-closure-open",
    });
  });

  it("includes termination hints when a closure marker is missing", () => {
    expect(
      validateDocumentationClosureSummary(
        { agentId: "A9" },
        {
          terminationHint: "Reached max turns (10)",
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-doc-closure",
      detail: expect.stringContaining("Reached max turns (10)"),
    });
  });
});

describe("validateEvaluatorSummary", () => {
  it("rejects final gates that still report concerns", () => {
    expect(
      validateEvaluatorSummary(
        { agentId: "A0" },
        {
          verdict: { verdict: "pass", detail: "stale report text" },
          gate: {
            architecture: "pass",
            integration: "concerns",
            durability: "pass",
            live: "pass",
            docs: "pass",
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "gate-integration-concerns",
    });
  });
});
