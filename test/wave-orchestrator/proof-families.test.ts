import { describe, expect, it } from "vitest";
import {
  PROOF_FAMILIES,
  DEFAULT_PROOF_FAMILY,
  PROOF_KIND_FAMILIES,
  classifyProofFamily,
  normalizeProofBundle,
  inferProofFamily,
  bundlesByFamily,
  familySatisfied,
  proofFamilyReport,
  gateRequiresFamily,
} from "../../scripts/wave-orchestrator/proof-families.mjs";

describe("PROOF_FAMILIES constant", () => {
  it("contains exactly three families", () => {
    expect(PROOF_FAMILIES.size).toBe(3);
    expect(PROOF_FAMILIES.has("code_proof")).toBe(true);
    expect(PROOF_FAMILIES.has("integration_proof")).toBe(true);
    expect(PROOF_FAMILIES.has("deploy_proof")).toBe(true);
  });

  it("default proof family is code_proof", () => {
    expect(DEFAULT_PROOF_FAMILY).toBe("code_proof");
  });
});

describe("classifyProofFamily", () => {
  it("classifies code_proof artifact kinds", () => {
    expect(classifyProofFamily("test-report")).toBe("code_proof");
    expect(classifyProofFamily("build-output")).toBe("code_proof");
    expect(classifyProofFamily("diff-evidence")).toBe("code_proof");
    expect(classifyProofFamily("deliverable")).toBe("code_proof");
    expect(classifyProofFamily("unit-test")).toBe("code_proof");
  });

  it("classifies integration_proof artifact kinds", () => {
    expect(classifyProofFamily("integration-test")).toBe("integration_proof");
    expect(classifyProofFamily("contract-validation")).toBe("integration_proof");
    expect(classifyProofFamily("dependency-resolution")).toBe("integration_proof");
    expect(classifyProofFamily("cross-component-state")).toBe("integration_proof");
    expect(classifyProofFamily("integration-summary")).toBe("integration_proof");
  });

  it("classifies deploy_proof artifact kinds", () => {
    expect(classifyProofFamily("rollout-evidence")).toBe("deploy_proof");
    expect(classifyProofFamily("health-check")).toBe("deploy_proof");
    expect(classifyProofFamily("runtime-health")).toBe("deploy_proof");
    expect(classifyProofFamily("post-deploy-evidence")).toBe("deploy_proof");
    expect(classifyProofFamily("deployment-receipt")).toBe("deploy_proof");
  });

  it("returns default for unknown artifact kind", () => {
    expect(classifyProofFamily("unknown-kind")).toBe("code_proof");
    expect(classifyProofFamily("some-random-thing")).toBe("code_proof");
  });

  it("returns default for empty or null input", () => {
    expect(classifyProofFamily("")).toBe("code_proof");
    expect(classifyProofFamily(null)).toBe("code_proof");
    expect(classifyProofFamily(undefined)).toBe("code_proof");
  });

  it("all PROOF_KIND_FAMILIES entries are covered", () => {
    for (const [kind, family] of Object.entries(PROOF_KIND_FAMILIES)) {
      expect(classifyProofFamily(kind)).toBe(family);
    }
  });
});

describe("normalizeProofBundle", () => {
  it("adds proofFamily to a bundle without one", () => {
    const bundle = { id: "b1", artifacts: [{ kind: "test-report" }] };
    const result = normalizeProofBundle(bundle);
    expect(result.proofFamily).toBe("code_proof");
    expect(result.id).toBe("b1");
  });

  it("preserves valid existing proofFamily", () => {
    const bundle = { proofFamily: "deploy_proof", artifacts: [{ kind: "test-report" }] };
    const result = normalizeProofBundle(bundle);
    expect(result.proofFamily).toBe("deploy_proof");
  });

  it("infers from artifacts when proofFamily is invalid", () => {
    const bundle = {
      proofFamily: "bogus",
      artifacts: [{ kind: "health-check" }, { kind: "rollout-evidence" }],
    };
    const result = normalizeProofBundle(bundle);
    expect(result.proofFamily).toBe("deploy_proof");
  });

  it("defaults to code_proof when no artifacts", () => {
    const bundle = { id: "b2" };
    const result = normalizeProofBundle(bundle);
    expect(result.proofFamily).toBe("code_proof");
  });

  it("handles null input", () => {
    const result = normalizeProofBundle(null);
    expect(result.proofFamily).toBe("code_proof");
  });
});

describe("inferProofFamily", () => {
  it("uses majority vote for mixed artifacts", () => {
    const artifacts = [
      { kind: "integration-test" },
      { kind: "contract-validation" },
      { kind: "test-report" },
    ];
    expect(inferProofFamily(artifacts)).toBe("integration_proof");
  });

  it("returns code_proof for code artifacts", () => {
    const artifacts = [
      { kind: "test-report" },
      { kind: "build-output" },
    ];
    expect(inferProofFamily(artifacts)).toBe("code_proof");
  });

  it("returns deploy_proof for deploy artifacts", () => {
    const artifacts = [
      { kind: "health-check" },
      { kind: "rollout-evidence" },
      { kind: "deployment-receipt" },
    ];
    expect(inferProofFamily(artifacts)).toBe("deploy_proof");
  });

  it("returns default for empty array", () => {
    expect(inferProofFamily([])).toBe("code_proof");
  });

  it("returns default for null input", () => {
    expect(inferProofFamily(null)).toBe("code_proof");
  });

  it("handles artifacts without kind", () => {
    const artifacts = [{ path: "some/path" }];
    expect(inferProofFamily(artifacts)).toBe("code_proof");
  });
});

describe("bundlesByFamily", () => {
  it("groups bundles into three families", () => {
    const bundles = [
      { proofFamily: "code_proof", id: "b1" },
      { proofFamily: "integration_proof", id: "b2" },
      { proofFamily: "deploy_proof", id: "b3" },
      { artifacts: [{ kind: "test-report" }], id: "b4" },
    ];
    const grouped = bundlesByFamily(bundles);
    expect(grouped.code_proof.length).toBe(2);
    expect(grouped.integration_proof.length).toBe(1);
    expect(grouped.deploy_proof.length).toBe(1);
  });

  it("returns empty arrays for missing families", () => {
    const grouped = bundlesByFamily([]);
    expect(grouped.code_proof).toEqual([]);
    expect(grouped.integration_proof).toEqual([]);
    expect(grouped.deploy_proof).toEqual([]);
  });

  it("handles null input", () => {
    const grouped = bundlesByFamily(null);
    expect(grouped.code_proof).toEqual([]);
    expect(grouped.integration_proof).toEqual([]);
    expect(grouped.deploy_proof).toEqual([]);
  });
});

describe("familySatisfied", () => {
  it("returns true when active bundle exists for family", () => {
    const bundles = [
      { proofFamily: "code_proof", state: "active" },
    ];
    expect(familySatisfied(bundles, "code_proof")).toBe(true);
  });

  it("returns true when state is absent (defaults to active)", () => {
    const bundles = [
      { proofFamily: "code_proof" },
    ];
    expect(familySatisfied(bundles, "code_proof")).toBe(true);
  });

  it("returns false when only revoked bundles exist", () => {
    const bundles = [
      { proofFamily: "code_proof", state: "revoked" },
    ];
    expect(familySatisfied(bundles, "code_proof")).toBe(false);
  });

  it("returns false when no bundles match the family", () => {
    const bundles = [
      { proofFamily: "code_proof", state: "active" },
    ];
    expect(familySatisfied(bundles, "deploy_proof")).toBe(false);
  });

  it("returns false for empty bundles", () => {
    expect(familySatisfied([], "code_proof")).toBe(false);
  });

  it("handles bundles needing normalization", () => {
    const bundles = [
      { artifacts: [{ kind: "health-check" }], state: "active" },
    ];
    expect(familySatisfied(bundles, "deploy_proof")).toBe(true);
    expect(familySatisfied(bundles, "code_proof")).toBe(false);
  });
});

describe("proofFamilyReport", () => {
  it("aggregates report across all three families", () => {
    const bundles = [
      { proofFamily: "code_proof", state: "active" },
      { proofFamily: "code_proof", state: "revoked" },
      { proofFamily: "integration_proof", state: "active" },
    ];
    const report = proofFamilyReport(bundles);
    expect(report.code_proof).toEqual({ count: 2, active: 1, satisfied: true });
    expect(report.integration_proof).toEqual({ count: 1, active: 1, satisfied: true });
    expect(report.deploy_proof).toEqual({ count: 0, active: 0, satisfied: false });
  });

  it("reports all unsatisfied for empty bundles", () => {
    const report = proofFamilyReport([]);
    expect(report.code_proof.satisfied).toBe(false);
    expect(report.integration_proof.satisfied).toBe(false);
    expect(report.deploy_proof.satisfied).toBe(false);
  });
});

describe("gateRequiresFamily", () => {
  it("maps implementation gates to code_proof", () => {
    expect(gateRequiresFamily("implementationGate")).toBe("code_proof");
    expect(gateRequiresFamily("componentGate")).toBe("code_proof");
    expect(gateRequiresFamily("contQaGate")).toBe("code_proof");
  });

  it("maps integration gates to integration_proof", () => {
    expect(gateRequiresFamily("integrationBarrier")).toBe("integration_proof");
    expect(gateRequiresFamily("integrationGate")).toBe("integration_proof");
  });

  it("maps infra gate to deploy_proof", () => {
    expect(gateRequiresFamily("infraGate")).toBe("deploy_proof");
  });

  it("returns null for unknown gate names", () => {
    expect(gateRequiresFamily("unknownGate")).toBeNull();
    expect(gateRequiresFamily("")).toBeNull();
    expect(gateRequiresFamily(null)).toBeNull();
  });
});
