import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("projection writer boundary", () => {
  it("centralizes projection persistence in projection-writer.mjs", () => {
    const projectionWriterSource = read("scripts/wave-orchestrator/projection-writer.mjs");
    const derivedStateSource = read("scripts/wave-orchestrator/derived-state-engine.mjs");
    const launcherSource = read("scripts/wave-orchestrator/launcher.mjs");
    const supervisorSource = read("scripts/wave-orchestrator/session-supervisor.mjs");

    expect(projectionWriterSource).toContain("export function writeWaveDerivedProjections");
    expect(projectionWriterSource).toContain("export function writeDashboardProjections");
    expect(projectionWriterSource).toContain("writeAssignmentSnapshot(");
    expect(projectionWriterSource).toContain("writeDependencySnapshot(");
    expect(projectionWriterSource).toContain("writeDocsQueue(");
    expect(projectionWriterSource).toContain("writeWaveLedger(");
    expect(projectionWriterSource).toContain("writeCompiledInbox(");
    expect(projectionWriterSource).toContain("writeCoordinationBoardProjection(");
    expect(projectionWriterSource).toContain("writeWaveDashboard(");
    expect(projectionWriterSource).toContain("writeGlobalDashboard(");

    expect(derivedStateSource).not.toContain("writeAssignmentSnapshot(");
    expect(derivedStateSource).not.toContain("writeDependencySnapshot(");
    expect(derivedStateSource).not.toContain("writeDependencySnapshotMarkdown(");
    expect(derivedStateSource).not.toContain("writeDocsQueue(");
    expect(derivedStateSource).not.toContain("writeWaveLedger(");
    expect(derivedStateSource).not.toContain("writeCompiledInbox(");
    expect(derivedStateSource).not.toContain("writeCoordinationBoardProjection(");
    expect(derivedStateSource).not.toContain("writeJsonArtifact(");

    expect(launcherSource).toContain("writeWaveDerivedProjections(");
    expect(launcherSource).toContain("writeDashboardProjections(");
    expect(launcherSource).not.toContain("writeWaveDashboard(");
    expect(launcherSource).not.toContain("writeGlobalDashboard(");
    expect(launcherSource).not.toContain("syncGlobalWaveFromWaveDashboard(");

    expect(supervisorSource).not.toContain("writeGlobalDashboard(");
  });
});
