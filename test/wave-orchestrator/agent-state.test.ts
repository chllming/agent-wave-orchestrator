import { describe, expect, it } from "vitest";
import {
  validateDocumentationClosureSummary,
  validateEvaluatorSummary,
  validateImplementationSummary,
} from "../../scripts/wave-orchestrator/agent-state.mjs";

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
