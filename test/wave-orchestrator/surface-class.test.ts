import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_RESULT_ENVELOPE_KIND,
  AGENT_RESULT_ENVELOPE_SCHEMA_VERSION,
  HUMAN_INPUT_WORKFLOW_KIND,
  HUMAN_INPUT_WORKFLOW_SCHEMA_VERSION,
  RESUME_PLAN_KIND,
  RESUME_PLAN_SCHEMA_VERSION,
  SURFACE_CLASS_CACHED_DERIVED,
  SURFACE_CLASS_CANONICAL_EVENT,
  SURFACE_CLASS_CANONICAL_SNAPSHOT,
  SURFACE_CLASS_HUMAN_PROJECTION,
  SURFACE_CLASSES,
  TASK_ENTITY_KIND,
  TASK_ENTITY_SCHEMA_VERSION,
  WAVE_STATE_KIND,
  WAVE_STATE_SCHEMA_VERSION,
  normalizeAgentResultEnvelope,
  normalizeResumePlan,
  normalizeWaveStateSnapshot,
  readWaveStateSnapshot,
  writeWaveStateSnapshot,
} from "../../scripts/wave-orchestrator/artifact-schemas.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-surface-class-"));
  tempDirs.push(dir);
  return dir;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("surface class metadata", () => {
  describe("SURFACE_CLASSES set", () => {
    it("contains all four surface class values", () => {
      expect(SURFACE_CLASSES.size).toBe(4);
      expect(SURFACE_CLASSES.has(SURFACE_CLASS_CANONICAL_EVENT)).toBe(true);
      expect(SURFACE_CLASSES.has(SURFACE_CLASS_CANONICAL_SNAPSHOT)).toBe(true);
      expect(SURFACE_CLASSES.has(SURFACE_CLASS_CACHED_DERIVED)).toBe(true);
      expect(SURFACE_CLASSES.has(SURFACE_CLASS_HUMAN_PROJECTION)).toBe(true);
    });

    it("surface class constants have expected string values", () => {
      expect(SURFACE_CLASS_CANONICAL_EVENT).toBe("canonical-event");
      expect(SURFACE_CLASS_CANONICAL_SNAPSHOT).toBe("canonical-snapshot");
      expect(SURFACE_CLASS_CACHED_DERIVED).toBe("cached-derived");
      expect(SURFACE_CLASS_HUMAN_PROJECTION).toBe("human-projection");
    });
  });

  describe("schema version constants", () => {
    it("all Wave 4 schema version constants are 1", () => {
      expect(WAVE_STATE_SCHEMA_VERSION).toBe(1);
      expect(TASK_ENTITY_SCHEMA_VERSION).toBe(1);
      expect(AGENT_RESULT_ENVELOPE_SCHEMA_VERSION).toBe(1);
      expect(RESUME_PLAN_SCHEMA_VERSION).toBe(1);
      expect(HUMAN_INPUT_WORKFLOW_SCHEMA_VERSION).toBe(1);
    });
  });

  describe("kind constants", () => {
    it("all Wave 4 kind constants have expected values", () => {
      expect(WAVE_STATE_KIND).toBe("wave-state-snapshot");
      expect(TASK_ENTITY_KIND).toBe("wave-task-entity");
      expect(AGENT_RESULT_ENVELOPE_KIND).toBe("agent-result-envelope");
      expect(RESUME_PLAN_KIND).toBe("wave-resume-plan");
      expect(HUMAN_INPUT_WORKFLOW_KIND).toBe("human-input-workflow-state");
    });
  });

  describe("normalizeWaveStateSnapshot", () => {
    it("wraps payload with correct schema version, kind, and surfaceClass", () => {
      const result = normalizeWaveStateSnapshot({ lane: "main", wave: 3, status: "running" });
      expect(result.schemaVersion).toBe(WAVE_STATE_SCHEMA_VERSION);
      expect(result.kind).toBe(WAVE_STATE_KIND);
      expect(result._meta).toEqual({ surfaceClass: SURFACE_CLASS_CANONICAL_SNAPSHOT });
      expect(result.lane).toBe("main");
      expect(result.wave).toBe(3);
      expect(result.status).toBe("running");
      expect(result.generatedAt).toBeTruthy();
    });

    it("overrides stale schema fields from source", () => {
      const result = normalizeWaveStateSnapshot({
        schemaVersion: 999,
        kind: "old-kind",
        _meta: { surfaceClass: "wrong" },
        lane: "main",
        wave: 5,
      });
      expect(result.schemaVersion).toBe(WAVE_STATE_SCHEMA_VERSION);
      expect(result.kind).toBe(WAVE_STATE_KIND);
      expect(result._meta.surfaceClass).toBe(SURFACE_CLASS_CANONICAL_SNAPSHOT);
    });

    it("uses defaults for lane and wave when not in payload", () => {
      const result = normalizeWaveStateSnapshot({}, { lane: "dev", wave: 7 });
      expect(result.lane).toBe("dev");
      expect(result.wave).toBe(7);
    });

    it("handles non-object input", () => {
      const result = normalizeWaveStateSnapshot(null);
      expect(result.schemaVersion).toBe(WAVE_STATE_SCHEMA_VERSION);
      expect(result.kind).toBe(WAVE_STATE_KIND);
      expect(result.lane).toBeNull();
      expect(result.wave).toBeNull();
    });

    it("preserves source generatedAt when present", () => {
      const result = normalizeWaveStateSnapshot({
        generatedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(result.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("normalizeAgentResultEnvelope", () => {
    it("wraps payload with correct schema/kind/surfaceClass", () => {
      const result = normalizeAgentResultEnvelope({
        agentId: "A1",
        exitCode: 0,
        summary: "done",
      });
      expect(result.schemaVersion).toBe(AGENT_RESULT_ENVELOPE_SCHEMA_VERSION);
      expect(result.kind).toBe(AGENT_RESULT_ENVELOPE_KIND);
      expect(result._meta).toEqual({ surfaceClass: SURFACE_CLASS_CANONICAL_SNAPSHOT });
      expect(result.agentId).toBe("A1");
      expect(result.exitCode).toBe(0);
      expect(result.summary).toBe("done");
    });

    it("overrides stale schema fields from source", () => {
      const result = normalizeAgentResultEnvelope({
        schemaVersion: 42,
        kind: "stale",
        _meta: { surfaceClass: "wrong" },
      });
      expect(result.schemaVersion).toBe(AGENT_RESULT_ENVELOPE_SCHEMA_VERSION);
      expect(result.kind).toBe(AGENT_RESULT_ENVELOPE_KIND);
      expect(result._meta.surfaceClass).toBe(SURFACE_CLASS_CANONICAL_SNAPSHOT);
    });

    it("handles non-object input", () => {
      const result = normalizeAgentResultEnvelope(null);
      expect(result.schemaVersion).toBe(AGENT_RESULT_ENVELOPE_SCHEMA_VERSION);
      expect(result.kind).toBe(AGENT_RESULT_ENVELOPE_KIND);
    });
  });

  describe("normalizeResumePlan", () => {
    it("wraps payload with correct schema/kind/surfaceClass (cached-derived)", () => {
      const result = normalizeResumePlan({
        selectedAgentIds: ["A1"],
        strategy: "retry",
      });
      expect(result.schemaVersion).toBe(RESUME_PLAN_SCHEMA_VERSION);
      expect(result.kind).toBe(RESUME_PLAN_KIND);
      expect(result._meta).toEqual({ surfaceClass: SURFACE_CLASS_CACHED_DERIVED });
      expect(result.selectedAgentIds).toEqual(["A1"]);
      expect(result.strategy).toBe("retry");
    });

    it("overrides stale schema fields from source", () => {
      const result = normalizeResumePlan({
        schemaVersion: 99,
        kind: "old-resume",
        _meta: { surfaceClass: "wrong" },
      });
      expect(result.schemaVersion).toBe(RESUME_PLAN_SCHEMA_VERSION);
      expect(result.kind).toBe(RESUME_PLAN_KIND);
      expect(result._meta.surfaceClass).toBe(SURFACE_CLASS_CACHED_DERIVED);
    });

    it("handles non-object input", () => {
      const result = normalizeResumePlan(null);
      expect(result.schemaVersion).toBe(RESUME_PLAN_SCHEMA_VERSION);
      expect(result.kind).toBe(RESUME_PLAN_KIND);
    });
  });

  describe("writeWaveStateSnapshot / readWaveStateSnapshot round-trip", () => {
    it("writes and reads back a normalized wave state snapshot", () => {
      const dir = makeTempDir();
      const filePath = path.join(dir, "wave-state.json");
      const written = writeWaveStateSnapshot(
        filePath,
        { lane: "main", wave: 2, status: "completed", agents: [] },
        { lane: "main", wave: 2 },
      );
      expect(written.schemaVersion).toBe(WAVE_STATE_SCHEMA_VERSION);
      expect(written.kind).toBe(WAVE_STATE_KIND);
      expect(written._meta.surfaceClass).toBe(SURFACE_CLASS_CANONICAL_SNAPSHOT);
      expect(written.lane).toBe("main");
      expect(written.wave).toBe(2);

      const onDisk = readJson(filePath);
      expect(onDisk.schemaVersion).toBe(WAVE_STATE_SCHEMA_VERSION);
      expect(onDisk.kind).toBe(WAVE_STATE_KIND);

      const readBack = readWaveStateSnapshot(filePath, { lane: "main", wave: 2 });
      expect(readBack.schemaVersion).toBe(WAVE_STATE_SCHEMA_VERSION);
      expect(readBack.kind).toBe(WAVE_STATE_KIND);
      expect(readBack._meta.surfaceClass).toBe(SURFACE_CLASS_CANONICAL_SNAPSHOT);
      expect(readBack.lane).toBe("main");
      expect(readBack.wave).toBe(2);
      expect(readBack.status).toBe("completed");
    });

    it("returns null when reading a non-existent file", () => {
      const result = readWaveStateSnapshot("/tmp/nonexistent-wave-state-snapshot-test.json");
      expect(result).toBeNull();
    });
  });
});
