import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  augmentSummaryWithProofRegistry,
  registerWaveProofBundle,
} from "../../scripts/wave-orchestrator/proof-registry.mjs";

const cleanupPaths = [];

function trackFile(filePath) {
  cleanupPaths.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const filePath of cleanupPaths.splice(0)) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
});

describe("proof registry", () => {
  it("can augment a proof-centric summary from authoritative operator evidence", () => {
    const repoRoot = process.cwd();
    const proofDir = trackFile(path.join(repoRoot, ".tmp", "proof-registry-test"));
    const artifactPath = ".tmp/proof-registry-test/live-status.json";
    const deliverablePath = "docs/plans/waves/reviews/proof-registry-test.md";
    trackFile(path.join(repoRoot, deliverablePath));
    fs.mkdirSync(path.join(repoRoot, ".tmp", "proof-registry-test"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, artifactPath), "{\"ok\":true}\n", "utf8");
    fs.mkdirSync(path.dirname(path.join(repoRoot, deliverablePath)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, deliverablePath), "# proof\n", "utf8");

    const lanePaths = {
      lane: "main",
      controlDir: path.join(proofDir, "control"),
      controlPlaneDir: path.join(proofDir, "control-plane"),
      proofDir,
    };
    const wave = { wave: 8 };
    const agent = {
      agentId: "A7",
      components: ["pilot-live-core"],
      componentTargets: {
        "pilot-live-core": "pilot-live",
      },
      deliverables: [deliverablePath],
      exitContract: {
        completion: "live",
        durability: "durable",
        proof: "live",
        docImpact: "owned",
      },
      proofArtifacts: [
        {
          path: artifactPath,
          kind: "live-status",
          requiredFor: ["pilot-live"],
        },
      ],
    };

    const { registry } = registerWaveProofBundle({
      lanePaths,
      wave,
      agent,
      artifactPaths: [artifactPath],
      authoritative: true,
      satisfyOwnedComponents: true,
      completion: "live",
      durability: "durable",
      proofLevel: "live",
      docDeltaState: "owned",
      detail: "Operator confirmed live restart evidence.",
      recordedBy: "tester",
    });

    const augmented = augmentSummaryWithProofRegistry(agent, null, registry);
    expect(augmented).toMatchObject({
      proof: {
        state: "met",
        completion: "live",
        durability: "durable",
        proof: "live",
      },
      docDelta: {
        state: "owned",
      },
    });
    expect(augmented.components).toEqual([
      {
        componentId: "pilot-live-core",
        level: "pilot-live",
        state: "met",
        detail: "Operator confirmed live restart evidence.",
      },
    ]);
    expect(augmented.proofArtifacts).toEqual([
      expect.objectContaining({
        path: artifactPath,
        kind: "live-status",
        exists: true,
      }),
    ]);
    expect(augmented.deliverables).toEqual([
      expect.objectContaining({
        path: deliverablePath,
        exists: true,
      }),
    ]);
  });

  it("upgrades an already-met but weaker summary when authoritative live proof arrives", () => {
    const repoRoot = process.cwd();
    const proofDir = trackFile(path.join(repoRoot, ".tmp", "proof-registry-upgrade-test"));
    const artifactPath = ".tmp/proof-registry-upgrade-test/live-status.json";
    fs.mkdirSync(path.join(repoRoot, ".tmp", "proof-registry-upgrade-test"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, artifactPath), "{\"ok\":true}\n", "utf8");

    const lanePaths = {
      lane: "main",
      controlDir: path.join(proofDir, "control"),
      controlPlaneDir: path.join(proofDir, "control-plane"),
      proofDir,
    };
    const wave = { wave: 9 };
    const agent = {
      agentId: "A6",
      exitContract: {
        completion: "live",
        durability: "durable",
        proof: "live",
        docImpact: "owned",
      },
      proofArtifacts: [
        {
          path: artifactPath,
          kind: "live-status",
          requiredFor: ["pilot-live"],
        },
      ],
    };

    const { registry } = registerWaveProofBundle({
      lanePaths,
      wave,
      agent,
      artifactPaths: [artifactPath],
      authoritative: true,
      completion: "live",
      durability: "durable",
      proofLevel: "live",
      docDeltaState: "owned",
      detail: "Operator captured stronger live evidence.",
      recordedBy: "tester",
    });

    const augmented = augmentSummaryWithProofRegistry(
      agent,
      {
        agentId: "A6",
        proof: {
          state: "met",
          completion: "integrated",
          durability: "durable",
          proof: "integration",
          detail: "Earlier integration-only validation.",
        },
        docDelta: {
          state: "none",
          detail: "Earlier summary claimed no doc delta.",
        },
      },
      registry,
    );

    expect(augmented).toMatchObject({
      proof: {
        state: "met",
        completion: "live",
        durability: "durable",
        proof: "live",
      },
      docDelta: {
        state: "owned",
      },
    });
  });
});
