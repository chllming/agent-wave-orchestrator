import { describe, expect, it } from "vitest";
import { buildResumePlan } from "../../scripts/wave-orchestrator/launcher-retry.mjs";

function makeClosureEligibility(overrides = {}) {
  return {
    waveMayClose: false,
    pendingAgentIds: [],
    ownedSliceProvenAgentIds: [],
    proofBundles: [],
    ...overrides,
  };
}

function makeGateSnapshot(overrides = {}) {
  const base = {
    implementationGate: { ok: true, statusCode: "pass", detail: "" },
    componentGate: { ok: true, statusCode: "pass", detail: "" },
    integrationBarrier: { ok: true, statusCode: "pass", detail: "" },
    documentationGate: { ok: true, statusCode: "pass", detail: "" },
    contEvalGate: { ok: true, statusCode: "pass", detail: "" },
    contQaGate: { ok: true, statusCode: "pass", detail: "" },
    overall: { ok: true, gate: "pass", statusCode: "pass", detail: "All gates passed.", agentId: null },
    ...overrides,
  };
  return base;
}

describe("buildResumePlan", () => {
  it("returns all-gates-pass and canResume false when wave may close", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({ waveMayClose: true }),
      gateSnapshot: makeGateSnapshot(),
      openBlockers: [],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState, {
      waveDefinition: { wave: 3 },
      lanePaths: { lane: "main" },
    });

    expect(plan.reason).toBe("all-gates-pass");
    expect(plan.canResume).toBe(false);
    expect(plan.resumePlanVersion).toBe(1);
    expect(plan.wave).toBe(3);
    expect(plan.lane).toBe("main");
    expect(plan.deterministic).toBe(true);
    expect(plan.resumeFromPhase).toBe("completed");
    expect(plan.invalidatedAgentIds).toEqual([]);
    expect(plan.reusableAgentIds).toEqual([]);
  });

  it("detects gate-failure with implementation gate failing", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({
        waveMayClose: false,
        pendingAgentIds: ["A2"],
        ownedSliceProvenAgentIds: ["A1", "A3"],
        proofBundles: [
          { id: "proof-A1-abc", agentId: "A1", state: "active" },
          { id: "proof-A3-def", agentId: "A3", state: "active" },
        ],
      }),
      gateSnapshot: makeGateSnapshot({
        implementationGate: {
          ok: false,
          agentId: "A2",
          statusCode: "exit-contract-not-met",
          detail: "Agent A2 did not meet exit contract.",
        },
        overall: {
          ok: false,
          gate: "implementationGate",
          statusCode: "exit-contract-not-met",
          detail: "Agent A2 did not meet exit contract.",
          agentId: "A2",
        },
      }),
      openBlockers: [],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState, {
      waveDefinition: { wave: 3 },
      lanePaths: { lane: "main" },
    });

    expect(plan.reason).toBe("gate-failure");
    expect(plan.canResume).toBe(true);
    expect(plan.invalidatedAgentIds).toEqual(["A2"]);
    expect(plan.reusableAgentIds).toEqual(["A1", "A3"]);
    expect(plan.reusableProofBundleIds).toEqual(["proof-A1-abc", "proof-A3-def"]);
    expect(plan.resumeFromPhase).toBe("implementation");
    expect(plan.gateBlockers).toEqual([
      {
        gate: "implementationGate",
        statusCode: "exit-contract-not-met",
        detail: "Agent A2 did not meet exit contract.",
        agentId: "A2",
      },
    ]);
  });

  it("detects human input blockers", () => {
    const waveState = {
      wave: 2,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({ waveMayClose: false }),
      gateSnapshot: makeGateSnapshot({
        overall: { ok: true, gate: "pass", statusCode: "pass", detail: "", agentId: null },
      }),
      openBlockers: [
        {
          kind: "human-input",
          taskId: "task-001",
          title: "Need API key from team lead",
          agentId: "A1",
        },
      ],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState);

    expect(plan.reason).toBe("human-request");
    expect(plan.canResume).toBe(true);
    expect(plan.humanInputBlockers).toEqual([
      {
        taskId: "task-001",
        title: "Need API key from team lead",
        assigneeAgentId: "A1",
      },
    ]);
  });

  it("detects shared-component sibling pending", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({
        waveMayClose: false,
        pendingAgentIds: ["A2"],
      }),
      gateSnapshot: makeGateSnapshot({
        overall: { ok: true, gate: "pass", statusCode: "pass", detail: "", agentId: null },
      }),
      openBlockers: [
        { kind: "shared-component-sibling-pending", agentId: "A2", detail: "wave-parser not met" },
      ],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState);

    expect(plan.reason).toBe("shared-component-sibling-pending");
    expect(plan.canResume).toBe(true);
    expect(plan.invalidatedAgentIds).toEqual(["A2"]);
  });

  it("maps integrationBarrier to resumeFromPhase integrating", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 2,
      closureEligibility: makeClosureEligibility({ waveMayClose: false }),
      gateSnapshot: makeGateSnapshot({
        integrationBarrier: {
          ok: false,
          agentId: "A8",
          statusCode: "integration-needs-more-work",
          detail: "Integration steward reported needs-more-work.",
        },
        overall: {
          ok: false,
          gate: "integrationBarrier",
          statusCode: "integration-needs-more-work",
          detail: "Integration steward reported needs-more-work.",
          agentId: "A8",
        },
      }),
      openBlockers: [],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState);

    expect(plan.resumeFromPhase).toBe("integrating");
    expect(plan.reason).toBe("gate-failure");
  });

  it("maps documentationGate to resumeFromPhase docs-closure", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({ waveMayClose: false }),
      gateSnapshot: makeGateSnapshot({
        documentationGate: {
          ok: false,
          agentId: "A9",
          statusCode: "doc-closure-open",
          detail: "Docs still open.",
        },
        overall: {
          ok: false,
          gate: "documentationGate",
          statusCode: "doc-closure-open",
          detail: "Docs still open.",
          agentId: "A9",
        },
      }),
      openBlockers: [],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState);

    expect(plan.resumeFromPhase).toBe("docs-closure");
  });

  it("maps contQaGate to resumeFromPhase cont-qa-closure", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({ waveMayClose: false }),
      gateSnapshot: makeGateSnapshot({
        contQaGate: {
          ok: false,
          agentId: "A0",
          statusCode: "cont-qa-fail",
          detail: "QA failed.",
        },
        overall: {
          ok: false,
          gate: "contQaGate",
          statusCode: "cont-qa-fail",
          detail: "QA failed.",
          agentId: "A0",
        },
      }),
      openBlockers: [],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState);

    expect(plan.resumeFromPhase).toBe("cont-qa-closure");
  });

  it("suggests executor fallback for rate-limit-exhausted agents", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 2,
      closureEligibility: makeClosureEligibility({
        waveMayClose: false,
        pendingAgentIds: ["A2"],
      }),
      gateSnapshot: makeGateSnapshot({
        implementationGate: {
          ok: false,
          agentId: "A2",
          statusCode: "exit-contract-not-met",
          detail: "Rate limit.",
        },
        overall: {
          ok: false,
          gate: "implementationGate",
          statusCode: "exit-contract-not-met",
          detail: "Rate limit.",
          agentId: "A2",
        },
      }),
      openBlockers: [],
      retryTargetSet: [
        {
          agentId: "A2",
          currentExecutor: "codex",
          reason: "rate-limit-exhausted",
          retriesExhausted: true,
        },
      ],
    };

    const plan = buildResumePlan(waveState);

    expect(plan.executorChanges).toEqual([
      {
        agentId: "A2",
        currentExecutor: "codex",
        suggestedFallback: "claude",
        reason: "rate-limit-exhausted",
      },
    ]);
  });

  it("is deterministic: same input produces same output (modulo createdAt)", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({
        waveMayClose: false,
        pendingAgentIds: ["A2"],
        ownedSliceProvenAgentIds: ["A1"],
        proofBundles: [{ id: "proof-A1-xyz", agentId: "A1", state: "active" }],
      }),
      gateSnapshot: makeGateSnapshot({
        implementationGate: {
          ok: false,
          agentId: "A2",
          statusCode: "missing-wave-proof",
          detail: "Missing proof.",
        },
        overall: {
          ok: false,
          gate: "implementationGate",
          statusCode: "missing-wave-proof",
          detail: "Missing proof.",
          agentId: "A2",
        },
      }),
      openBlockers: [],
      retryTargetSet: [],
    };

    const opts = { waveDefinition: { wave: 3 }, lanePaths: { lane: "main" } };
    const plan1 = buildResumePlan(waveState, opts);
    const plan2 = buildResumePlan(waveState, opts);

    // Compare everything except createdAt
    const { createdAt: _c1, ...rest1 } = plan1;
    const { createdAt: _c2, ...rest2 } = plan2;
    expect(rest1).toEqual(rest2);
  });

  it("filters reusable proof bundles to only active ones for reusable agents", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({
        waveMayClose: false,
        pendingAgentIds: ["A2"],
        ownedSliceProvenAgentIds: ["A1", "A3"],
        proofBundles: [
          { id: "proof-A1-active", agentId: "A1", state: "active" },
          { id: "proof-A1-superseded", agentId: "A1", state: "superseded" },
          { id: "proof-A2-active", agentId: "A2", state: "active" },
          { id: "proof-A3-active", agentId: "A3", state: "active" },
        ],
      }),
      gateSnapshot: makeGateSnapshot({
        overall: {
          ok: false,
          gate: "implementationGate",
          statusCode: "exit-contract-not-met",
          detail: "A2 failed.",
          agentId: "A2",
        },
      }),
      openBlockers: [],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState);

    // Only active bundles for reusable agents (A1 and A3)
    expect(plan.reusableProofBundleIds).toEqual(["proof-A1-active", "proof-A3-active"]);
    // A2's active bundle should NOT be included since A2 is not reusable
    expect(plan.reusableProofBundleIds).not.toContain("proof-A2-active");
    // Superseded bundles should NOT be included
    expect(plan.reusableProofBundleIds).not.toContain("proof-A1-superseded");
  });

  it("handles timeout blocker reason", () => {
    const waveState = {
      wave: 3,
      lane: "main",
      attempt: 1,
      closureEligibility: makeClosureEligibility({ waveMayClose: false }),
      gateSnapshot: makeGateSnapshot({
        overall: { ok: true, gate: "pass", statusCode: "pass", detail: "", agentId: null },
      }),
      openBlockers: [{ kind: "timeout", agentId: "A1", detail: "Agent timed out." }],
      retryTargetSet: [],
    };

    const plan = buildResumePlan(waveState);

    expect(plan.reason).toBe("timeout");
    expect(plan.canResume).toBe(true);
  });

  it("returns safe defaults for minimal waveState", () => {
    const plan = buildResumePlan({});

    expect(plan.resumePlanVersion).toBe(1);
    expect(plan.canResume).toBe(true);
    expect(plan.invalidatedAgentIds).toEqual([]);
    expect(plan.reusableAgentIds).toEqual([]);
    expect(plan.reusableProofBundleIds).toEqual([]);
    expect(plan.humanInputBlockers).toEqual([]);
    expect(plan.gateBlockers).toEqual([]);
    expect(plan.executorChanges).toEqual([]);
    expect(plan.deterministic).toBe(true);
    expect(typeof plan.createdAt).toBe("string");
  });

  it("populates wave and lane from options when provided", () => {
    const plan = buildResumePlan(
      { closureEligibility: makeClosureEligibility({ waveMayClose: false }) },
      { waveDefinition: { wave: 5 }, lanePaths: { lane: "staging" } },
    );

    expect(plan.wave).toBe(5);
    expect(plan.lane).toBe("staging");
  });

  it("populates attempt from waveState", () => {
    const plan = buildResumePlan({
      attempt: 3,
      closureEligibility: makeClosureEligibility({ waveMayClose: false }),
    });

    expect(plan.attempt).toBe(3);
  });
});
