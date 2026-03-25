import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  buildLanePaths,
  buildWorkspaceTmuxToken,
} from "../../scripts/wave-orchestrator/shared.mjs";

describe("buildLanePaths", () => {
  it("isolates dry-run artifacts under a dry-run state root", () => {
    const production = buildLanePaths("main");
    const dryRun = buildLanePaths("main", { runVariant: "dry-run" });

    expect(dryRun.runVariant).toBe("dry-run");
    expect(dryRun.stateDir).toBe(path.join(production.stateDir, "dry-run"));
    expect(dryRun.defaultManifestPath).toBe(path.join(dryRun.stateDir, "waves.manifest.json"));
    expect(dryRun.defaultRunStatePath).toBe(path.join(dryRun.stateDir, "run-state.json"));
    expect(dryRun.logsDir).toBe(path.join(dryRun.stateDir, "logs"));
    expect(dryRun.statusDir).toBe(path.join(dryRun.stateDir, "status"));
    expect(dryRun.messageboardsDir).toBe(path.join(dryRun.stateDir, "messageboards"));
    expect(dryRun.dashboardsDir).toBe(path.join(dryRun.stateDir, "dashboards"));
    expect(dryRun.signalsDir).toBe(path.join(dryRun.stateDir, "signals"));
    expect(dryRun.launcherLockPath).toBe(path.join(dryRun.stateDir, "launcher.lock"));
    expect(dryRun.defaultOrchestratorBoardPath).toBe(
      path.join(dryRun.stateDir, "orchestrator", "messageboards", "orchestrator.md"),
    );
    expect(dryRun.feedbackRequestsDir).toBe(
      path.join(dryRun.stateDir, "orchestrator", "feedback", "requests"),
    );
    expect(dryRun.docsDir).toBe(path.join(REPO_ROOT, "docs"));
  });

  it("names tmux resources uniquely per workspace root", () => {
    const tokenA = buildWorkspaceTmuxToken("/tmp/wave-test-a");
    const tokenB = buildWorkspaceTmuxToken("/tmp/wave-test-b");

    expect(tokenA).not.toBe(tokenB);
    expect(tokenA).toMatch(/^[a-z0-9_]+$/);
    expect(tokenB).toMatch(/^[a-z0-9_]+$/);
  });
});
