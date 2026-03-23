import crypto from "node:crypto";
import { toIsoTimestamp } from "./shared.mjs";

export const PROOF_FAMILIES = new Set(["code_proof", "integration_proof", "deploy_proof"]);
export const DEFAULT_PROOF_FAMILY = "code_proof";

/**
 * Mapping of proof artifact kinds to their proof family.
 */
export const PROOF_KIND_FAMILIES = {
  "test-report": "code_proof",
  "build-output": "code_proof",
  "diff-evidence": "code_proof",
  "deliverable": "code_proof",
  "unit-test": "code_proof",
  "integration-test": "integration_proof",
  "contract-validation": "integration_proof",
  "dependency-resolution": "integration_proof",
  "cross-component-state": "integration_proof",
  "integration-summary": "integration_proof",
  "rollout-evidence": "deploy_proof",
  "health-check": "deploy_proof",
  "runtime-health": "deploy_proof",
  "post-deploy-evidence": "deploy_proof",
  "deployment-receipt": "deploy_proof",
};

const GATE_FAMILY_MAP = {
  implementationGate: "code_proof",
  componentGate: "code_proof",
  contQaGate: "code_proof",
  integrationBarrier: "integration_proof",
  integrationGate: "integration_proof",
  infraGate: "deploy_proof",
};

/**
 * Returns the proof family for a given artifact kind.
 * Falls back to DEFAULT_PROOF_FAMILY if the kind is unknown.
 */
export function classifyProofFamily(artifactKind) {
  const kind = String(artifactKind || "").trim();
  if (!kind) {
    return DEFAULT_PROOF_FAMILY;
  }
  return PROOF_KIND_FAMILIES[kind] || DEFAULT_PROOF_FAMILY;
}

/**
 * Given an array of proof artifacts, infer the proof family.
 * Uses majority vote of classifyProofFamily over artifact kinds.
 * Returns DEFAULT_PROOF_FAMILY if no artifacts are provided.
 */
export function inferProofFamily(artifacts) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  if (list.length === 0) {
    return DEFAULT_PROOF_FAMILY;
  }
  const counts = {};
  for (const artifact of list) {
    const kind = String(artifact?.kind || "").trim();
    const family = classifyProofFamily(kind);
    counts[family] = (counts[family] || 0) + 1;
  }
  let bestFamily = DEFAULT_PROOF_FAMILY;
  let bestCount = 0;
  for (const [family, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestCount = count;
      bestFamily = family;
    }
  }
  return bestFamily;
}

/**
 * Returns a bundle with proofFamily field added.
 * If proofFamily is present and valid, keep it.
 * If absent, infer from artifact kinds (majority vote).
 * If no artifacts, default to code_proof.
 */
export function normalizeProofBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    return { proofFamily: DEFAULT_PROOF_FAMILY };
  }
  const existingFamily = String(bundle.proofFamily || "").trim();
  if (existingFamily && PROOF_FAMILIES.has(existingFamily)) {
    return { ...bundle, proofFamily: existingFamily };
  }
  const artifacts = Array.isArray(bundle.artifacts) ? bundle.artifacts : [];
  const inferred = inferProofFamily(artifacts);
  return { ...bundle, proofFamily: inferred };
}

/**
 * Group bundles by proofFamily.
 * Returns { code_proof: [...], integration_proof: [...], deploy_proof: [...] }
 */
export function bundlesByFamily(bundles) {
  const result = {
    code_proof: [],
    integration_proof: [],
    deploy_proof: [],
  };
  const list = Array.isArray(bundles) ? bundles : [];
  for (const bundle of list) {
    const normalized = normalizeProofBundle(bundle);
    const family = normalized.proofFamily;
    if (result[family]) {
      result[family].push(normalized);
    } else {
      result[DEFAULT_PROOF_FAMILY].push(normalized);
    }
  }
  return result;
}

/**
 * Returns true if at least one active bundle exists for the given family.
 */
export function familySatisfied(bundles, family) {
  const list = Array.isArray(bundles) ? bundles : [];
  for (const bundle of list) {
    const normalized = normalizeProofBundle(bundle);
    if (normalized.proofFamily !== family) {
      continue;
    }
    const state = String(bundle?.state || "active").trim().toLowerCase();
    if (state === "active") {
      return true;
    }
  }
  return false;
}

/**
 * Returns a report of proof family status:
 * { code_proof: { count, active, satisfied }, integration_proof: {...}, deploy_proof: {...} }
 */
export function proofFamilyReport(bundles) {
  const grouped = bundlesByFamily(bundles);
  const report = {};
  for (const family of PROOF_FAMILIES) {
    const familyBundles = grouped[family] || [];
    const activeBundles = familyBundles.filter((bundle) => {
      const state = String(bundle?.state || "active").trim().toLowerCase();
      return state === "active";
    });
    report[family] = {
      count: familyBundles.length,
      active: activeBundles.length,
      satisfied: activeBundles.length > 0,
    };
  }
  return report;
}

/**
 * Returns which proof family a gate primarily depends on.
 * implementationGate, componentGate, contQaGate -> code_proof
 * integrationBarrier, integrationGate -> integration_proof
 * infraGate -> deploy_proof
 * Others -> null (no specific family requirement)
 */
export function gateRequiresFamily(gateName) {
  const name = String(gateName || "").trim();
  return GATE_FAMILY_MAP[name] || null;
}
