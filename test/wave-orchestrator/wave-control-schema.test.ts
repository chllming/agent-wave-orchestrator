import { describe, expect, it } from "vitest";
import {
  buildWaveControlConfigAttestationHash,
  normalizeWaveControlArtifactDescriptor,
  normalizeWaveControlEventEnvelope,
  normalizeWaveControlRunIdentity,
  WAVE_CONTROL_ENTITY_TYPES,
} from "../../scripts/wave-orchestrator/wave-control-schema.mjs";

describe("wave-control schema", () => {
  it("normalizes run identity and preserves benchmark linkage", () => {
    expect(
      normalizeWaveControlRunIdentity({
        workspaceId: "wave_repo_1234abcd",
        projectId: "wave-orchestration",
        runId: "adhoc-001",
        runKind: "adhoc",
        lane: "main",
        wave: "4",
        attempt: "2",
        agentId: "A7",
        orchestratorId: "main-orch-1",
        runtimeVersion: "0.7.0",
        benchmarkRunId: "bench-1",
        benchmarkItemId: "task-9",
      }),
    ).toEqual({
      workspaceId: "wave_repo_1234abcd",
      projectId: "wave-orchestration",
      runId: "adhoc-001",
      runKind: "adhoc",
      lane: "main",
      wave: 4,
      attempt: 2,
      agentId: "A7",
      orchestratorId: "main-orch-1",
      runtimeVersion: "0.7.0",
      benchmarkRunId: "bench-1",
      benchmarkItemId: "task-9",
    });
  });

  it("normalizes artifact descriptors with upload policy and hash metadata", () => {
    expect(
      normalizeWaveControlArtifactDescriptor({
        path: ".tmp/main-wave-launcher/traces/wave-1/attempt-1/quality.json",
        kind: "trace-quality",
        required: true,
        present: true,
        sha256: "abc123",
        bytes: 42,
        contentType: "application/json",
        uploadPolicy: "selected",
      }),
    ).toMatchObject({
      kind: "trace-quality",
      required: true,
      present: true,
      sha256: "abc123",
      bytes: 42,
      contentType: "application/json",
      uploadPolicy: "selected",
    });
  });

  it("builds deterministic attestation hashes for equivalent payloads", () => {
    const left = buildWaveControlConfigAttestationHash({
      modelId: "gpt-5-codex",
      budget: { turns: 250, minutes: 45 },
      executorId: "codex",
    });
    const right = buildWaveControlConfigAttestationHash({
      executorId: "codex",
      budget: { minutes: 45, turns: 250 },
      modelId: "gpt-5-codex",
    });
    expect(left).toBe(right);
  });

  it("normalizes the canonical telemetry event envelope", () => {
    const event = normalizeWaveControlEventEnvelope({
      category: "benchmark",
      entityType: "benchmark_item",
      entityId: "task-1",
      action: "verified",
      identity: {
        workspaceId: "wave_repo_1234abcd",
        projectId: "wave-orchestration",
        runKind: "benchmark",
        orchestratorId: "main-orch-1",
        runtimeVersion: "0.7.0",
        benchmarkRunId: "bench-123",
        benchmarkItemId: "task-1",
      },
      data: {
        reviewValidity: "review-only",
      },
      artifacts: [
        {
          path: ".tmp/wave-benchmarks/external/swe-bench-pro/results.json",
          kind: "benchmark-results",
          uploadPolicy: "selected",
          present: true,
        },
      ],
    });

    expect(event).toMatchObject({
      schemaVersion: 1,
      kind: "wave-control-event",
      category: "benchmark",
      entityType: "benchmark_item",
      entityId: "task-1",
      action: "verified",
      identity: {
        workspaceId: "wave_repo_1234abcd",
        projectId: "wave-orchestration",
        runKind: "benchmark",
        orchestratorId: "main-orch-1",
        runtimeVersion: "0.7.0",
        benchmarkRunId: "bench-123",
        benchmarkItemId: "task-1",
      },
      artifacts: [
        expect.objectContaining({
          kind: "benchmark-results",
          uploadPolicy: "selected",
          present: true,
        }),
      ],
    });
  });

  it("declares contradiction and fact as canonical control-plane entity types", () => {
    expect(WAVE_CONTROL_ENTITY_TYPES.has("contradiction")).toBe(true);
    expect(WAVE_CONTROL_ENTITY_TYPES.has("fact")).toBe(true);
  });
});
