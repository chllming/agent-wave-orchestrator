import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeReducerSnapshot,
  readPersistedReducerSnapshot,
} from "../../scripts/wave-orchestrator/launcher.mjs";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reducer-shadow-"));
  tempDirs.push(dir);
  return dir;
}

function makeLanePaths(dir: string) {
  const stateDir = dir;
  const coordinationDir = path.join(dir, "coordination");
  const controlPlaneDir = path.join(dir, "control-plane");
  const feedbackRequestsDir = path.join(dir, "feedback", "requests");
  fs.mkdirSync(coordinationDir, { recursive: true });
  fs.mkdirSync(controlPlaneDir, { recursive: true });
  fs.mkdirSync(feedbackRequestsDir, { recursive: true });

  // Write a minimal component-cutover-matrix that the reducer's gate evaluation needs
  const matrixPath = path.join(dir, "component-cutover-matrix.json");
  fs.writeFileSync(matrixPath, JSON.stringify({
    levels: ["L0", "L1", "L2"],
    components: {},
  }), "utf8");

  return {
    lane: "test-lane",
    stateDir,
    coordinationDir,
    controlPlaneDir,
    feedbackRequestsDir,
    contQaAgentId: "A0",
    contEvalAgentId: "E0",
    integrationAgentId: "A8",
    documentationAgentId: "A9",
    laneProfile: {
      paths: {
        componentCutoverMatrixJsonPath: matrixPath,
      },
      runtimePolicy: { runtimeMixTargets: {} },
      validation: { requireComponentPromotionsFromWave: 0 },
    },
  };
}

function makeMinimalWave(waveNumber = 1) {
  return {
    wave: waveNumber,
    agents: [
      { agentId: "A1", role: "implementation", prompt: "do stuff" },
    ],
    evalTargets: [],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("computeReducerSnapshot", () => {
  it("produces a reducer state and persists a snapshot to disk", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeMinimalWave(1);

    const result = computeReducerSnapshot({
      lanePaths,
      wave,
      agentRuns: [],
      derivedState: {},
      attempt: 1,
      options: {},
    });

    expect(result).toBeDefined();
    expect(result.reducerState).toBeDefined();
    expect(result.resumePlan).toBeDefined();
    expect(result.snapshotPath).toBeDefined();

    // Snapshot file must exist on disk
    expect(fs.existsSync(result.snapshotPath)).toBe(true);

    // Snapshot path should be under stateDir/reducer/
    expect(result.snapshotPath).toContain(path.join("reducer", "wave-1.json"));
  });

  it("includes attempt and resumePlan in the persisted snapshot", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeMinimalWave(2);

    const result = computeReducerSnapshot({
      lanePaths,
      wave,
      agentRuns: [],
      derivedState: {},
      attempt: 3,
      options: {},
    });

    const raw = JSON.parse(fs.readFileSync(result.snapshotPath, "utf8"));
    expect(raw.attempt).toBe(3);
    expect(raw.resumePlan).toBeDefined();
    expect(raw.resumePlan.wave).toBe(2);
  });

  it("handles agentRuns with no summary gracefully", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeMinimalWave(1);
    const agentRuns = [
      {
        agent: { agentId: "A1", role: "implementation" },
        statusPath: path.join(dir, "nonexistent.status"),
        logPath: path.join(dir, "nonexistent.log"),
      },
    ];

    const result = computeReducerSnapshot({
      lanePaths,
      wave,
      agentRuns,
      derivedState: {},
      attempt: 1,
      options: {},
    });

    expect(result.reducerState).toBeDefined();
    expect(fs.existsSync(result.snapshotPath)).toBe(true);
  });

  it("reads control plane events when the log file exists", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeMinimalWave(1);

    // Write a valid control-plane event
    const cpLogPath = path.join(lanePaths.controlPlaneDir, "wave-1.jsonl");
    const event = {
      id: "cp-evt-1",
      entityType: "wave_run",
      entityId: "wave-1",
      action: "start",
      lane: "test-lane",
      wave: 1,
      recordedAt: new Date().toISOString(),
    };
    fs.writeFileSync(cpLogPath, JSON.stringify(event) + "\n", "utf8");

    const result = computeReducerSnapshot({
      lanePaths,
      wave,
      agentRuns: [],
      derivedState: {},
      attempt: 1,
      options: {},
    });

    expect(result.reducerState).toBeDefined();
    expect(fs.existsSync(result.snapshotPath)).toBe(true);
  });
});

describe("readPersistedReducerSnapshot", () => {
  it("reads back a snapshot that was written by computeReducerSnapshot", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeMinimalWave(5);

    const result = computeReducerSnapshot({
      lanePaths,
      wave,
      agentRuns: [],
      derivedState: {},
      attempt: 2,
      options: {},
    });

    const readBack = readPersistedReducerSnapshot(lanePaths, 5);
    expect(readBack).toBeDefined();
    expect(readBack.attempt).toBe(2);
    expect(readBack.resumePlan).toBeDefined();
    expect(readBack.resumePlan.wave).toBe(5);
    expect(readBack.lane).toBe("test-lane");
    expect(readBack.wave).toBe(5);
  });

  it("returns null when no snapshot exists", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);

    const readBack = readPersistedReducerSnapshot(lanePaths, 99);
    expect(readBack).toBeNull();
  });
});
