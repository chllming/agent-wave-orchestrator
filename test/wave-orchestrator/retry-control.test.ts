import { describe, expect, it } from "vitest";
import { resolveRetryOverrideRuns } from "../../scripts/wave-orchestrator/retry-control.mjs";

describe("retry control", () => {
  it("resolves explicit retry overrides to concrete wave runs", () => {
    const lanePaths = {
      integrationAgentId: "A8",
      documentationAgentId: "A9",
      contQaAgentId: "A0",
      contEvalAgentId: "E0",
    };
    const wave = {
      agents: [
        { agentId: "A1" },
        { agentId: "A2" },
        { agentId: "A8" },
        { agentId: "A9" },
      ],
    };
    const runs = wave.agents.map((agent) => ({ agent }));

    expect(
      resolveRetryOverrideRuns(
        runs,
        {
          selectedAgentIds: ["A2", "A8"],
        },
        lanePaths,
        wave,
      ),
    ).toMatchObject({
      selectedAgentIds: ["A2", "A8"],
      unknownAgentIds: [],
      runs: [{ agent: { agentId: "A2" } }, { agent: { agentId: "A8" } }],
    });
  });

  it("can derive retry targets from a resume phase", () => {
    const lanePaths = {
      integrationAgentId: "A8",
      documentationAgentId: "A9",
      contQaAgentId: "A0",
      contEvalAgentId: "E0",
    };
    const wave = {
      agents: [
        { agentId: "A1" },
        { agentId: "A2" },
        { agentId: "A8" },
        { agentId: "A9" },
        { agentId: "A0" },
      ],
    };
    const runs = wave.agents.map((agent) => ({ agent }));

    expect(
      resolveRetryOverrideRuns(
        runs,
        {
          resumePhase: "implementation",
        },
        lanePaths,
        wave,
      ).selectedAgentIds,
    ).toEqual(["A1", "A2"]);
  });

  it("excludes security-review agents from implementation resume targets", () => {
    const lanePaths = {
      integrationAgentId: "A8",
      documentationAgentId: "A9",
      contQaAgentId: "A0",
      contEvalAgentId: "E0",
    };
    const wave = {
      agents: [
        { agentId: "A1" },
        { agentId: "A2" },
        { agentId: "A8" },
        { agentId: "A9" },
        { agentId: "A0" },
        { agentId: "S1", capabilities: ["security-review"] },
      ],
    };
    const runs = wave.agents.map((agent) => ({ agent }));

    expect(
      resolveRetryOverrideRuns(
        runs,
        {
          resumePhase: "implementation",
        },
        lanePaths,
        wave,
      ).selectedAgentIds,
    ).toEqual(["A1", "A2"]);
  });
});
