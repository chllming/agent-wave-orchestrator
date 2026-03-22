import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeGlobalDashboardState,
  normalizeManifest,
  normalizeWaveDashboardState,
  readAssignmentSnapshot,
  readDependencySnapshot,
  readRelaunchPlan,
  writeAssignmentSnapshot,
  writeDependencySnapshot,
  writeRelaunchPlan,
} from "../../scripts/wave-orchestrator/artifact-schemas.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-artifact-schemas-"));
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

describe("artifact schemas", () => {
  it("versions manifest and dashboard payloads", () => {
    expect(
      normalizeManifest({
        source: "docs/**/*",
        waves: [{ wave: 0 }],
        docs: [{ path: "docs/README.md" }],
      }),
    ).toMatchObject({
      schemaVersion: 1,
      kind: "wave-manifest",
      source: "docs/**/*",
    });
    expect(normalizeGlobalDashboardState({ lane: "main", status: "running" })).toMatchObject({
      schemaVersion: 1,
      kind: "global-dashboard",
      lane: "main",
      status: "running",
    });
    expect(normalizeWaveDashboardState({ wave: 3, status: "completed" })).toMatchObject({
      schemaVersion: 1,
      kind: "wave-dashboard",
      wave: 3,
      status: "completed",
    });
  });

  it("overrides stale dashboard metadata with the canonical schema fields", () => {
    expect(
      normalizeGlobalDashboardState({
        schemaVersion: 999,
        kind: "legacy-global-dashboard",
        lane: "main",
      }),
    ).toMatchObject({
      schemaVersion: 1,
      kind: "global-dashboard",
      lane: "main",
    });
    expect(
      normalizeWaveDashboardState({
        schemaVersion: 999,
        kind: "legacy-wave-dashboard",
        wave: 8,
      }),
    ).toMatchObject({
      schemaVersion: 1,
      kind: "wave-dashboard",
      wave: 8,
    });
  });

  it("reads legacy and wrapped assignment snapshots and writes the wrapped form", () => {
    const dir = makeTempDir();
    const legacyPath = path.join(dir, "legacy-assignments.json");
    const wrappedPath = path.join(dir, "wrapped-assignments.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify([{ id: "assignment:1", requestId: "request-1", blocking: true }], null, 2),
      "utf8",
    );

    expect(readAssignmentSnapshot(legacyPath, { lane: "main", wave: 4 })).toMatchObject({
      schemaVersion: 1,
      kind: "wave-assignment-snapshot",
      lane: "main",
      wave: 4,
      assignments: [{ id: "assignment:1", requestId: "request-1", blocking: true }],
    });

    writeAssignmentSnapshot(
      wrappedPath,
      [{ id: "assignment:2", requestId: "request-2", blocking: false }],
      { lane: "main", wave: 5 },
    );
    expect(readJson(wrappedPath)).toMatchObject({
      schemaVersion: 1,
      kind: "wave-assignment-snapshot",
      lane: "main",
      wave: 5,
      assignments: [{ id: "assignment:2", requestId: "request-2", blocking: false }],
    });
  });

  it("reads legacy and wrapped dependency snapshots and writes the wrapped form", () => {
    const dir = makeTempDir();
    const legacyPath = path.join(dir, "legacy-dependencies.json");
    const wrappedPath = path.join(dir, "wrapped-dependencies.json");
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ requiredInbound: [{ id: "dep-1" }], requiredOutbound: [] }, null, 2),
      "utf8",
    );

    expect(readDependencySnapshot(legacyPath, { lane: "main", wave: 6 })).toMatchObject({
      schemaVersion: 1,
      kind: "wave-dependency-snapshot",
      lane: "main",
      wave: 6,
      requiredInbound: [{ id: "dep-1" }],
      requiredOutbound: [],
    });

    writeDependencySnapshot(
      wrappedPath,
      {
        requiredInbound: [],
        requiredOutbound: [{ id: "dep-2" }],
        unresolvedInboundAssignments: [],
      },
      { lane: "main", wave: 7 },
    );
    expect(readJson(wrappedPath)).toMatchObject({
      schemaVersion: 1,
      kind: "wave-dependency-snapshot",
      lane: "main",
      wave: 7,
      requiredInbound: [],
      requiredOutbound: [{ id: "dep-2" }],
    });
  });

  it("writes and reads versioned relaunch plans", () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "relaunch-plan.json");
    writeRelaunchPlan(
      filePath,
      {
        attempt: 2,
        selectedAgentIds: ["A1"],
        reasonBuckets: { blocker: true },
        executorStates: { A1: { id: "local" } },
      },
      { wave: 9 },
    );

    expect(readJson(filePath)).toMatchObject({
      schemaVersion: 1,
      kind: "wave-relaunch-plan",
      wave: 9,
      attempt: 2,
      selectedAgentIds: ["A1"],
      reasonBuckets: { blocker: true },
      executorStates: { A1: { id: "local" } },
    });
    expect(readRelaunchPlan(filePath, { wave: 9 })).toMatchObject({
      schemaVersion: 1,
      kind: "wave-relaunch-plan",
      wave: 9,
      attempt: 2,
      selectedAgentIds: ["A1"],
    });
  });
});
