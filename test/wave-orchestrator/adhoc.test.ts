import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-adhoc-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runWaveCli(args, cwd) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

function initFixtureRepo() {
  const repoDir = makeTempDir();
  writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });
  const initResult = runWaveCli(["init"], repoDir);
  expect(initResult.status).toBe(0);
  return repoDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("adhoc task generation", () => {
  it("writes transient request, spec, markdown, and result artifacts for adhoc planning", () => {
    const repoDir = initFixtureRepo();
    const planResult = runWaveCli(
      [
        "adhoc",
        "plan",
        "--task",
        "Update `docs/reference/runtime-config/README.md` and `scripts/wave-orchestrator/planner.mjs`",
        "--json",
      ],
      repoDir,
    );
    expect(planResult.status).toBe(0);

    const summary = JSON.parse(planResult.stdout);
    const runDir = path.join(repoDir, ".wave", "adhoc", "runs", summary.runId);
    expect(fs.existsSync(path.join(runDir, "request.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "spec.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "wave-0.md"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "result.json"))).toBe(true);

    const spec = JSON.parse(fs.readFileSync(path.join(runDir, "spec.json"), "utf8"));
    expect(spec.runKind).toBe("adhoc");
    expect(spec.requestedTasks).toHaveLength(1);
    expect(spec.agents.map((agent) => agent.agentId)).toEqual(
      expect.arrayContaining(["A0", "A8", "A9", "A1"]),
    );
    expect(spec.agents.map((agent) => agent.agentId)).not.toContain("A7");

    const result = JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf8"));
    expect(result.status).toBe("planned");
    expect(result.launcherStateDir).toBe(`.tmp/main-wave-launcher/adhoc/${summary.runId}`);

    const showResult = runWaveCli(["adhoc", "show", "--run", summary.runId, "--json"], repoDir);
    expect(showResult.status).toBe(0);
    const shown = JSON.parse(showResult.stdout);
    expect(shown.runId).toBe(summary.runId);
    expect(shown.status).toBe("planned");
  });

  it("runs dry-run in an isolated adhoc state root and synthesizes security review when needed", () => {
    const repoDir = initFixtureRepo();
    const runResult = runWaveCli(
      [
        "adhoc",
        "run",
        "--task",
        "Harden auth token handling in `scripts/wave-orchestrator/launcher.mjs` and update `docs/reference/runtime-config/README.md`",
        "--yes",
        "--dry-run",
        "--no-dashboard",
        "--no-context7",
      ],
      repoDir,
    );
    expect(runResult.status).toBe(0);

    const listResult = runWaveCli(["adhoc", "list", "--json"], repoDir);
    expect(listResult.status).toBe(0);
    const runs = JSON.parse(listResult.stdout);
    expect(runs).toHaveLength(1);
    const runId = runs[0].runId;

    const result = JSON.parse(
      fs.readFileSync(path.join(repoDir, ".wave", "adhoc", "runs", runId, "result.json"), "utf8"),
    );
    expect(result.status).toBe("completed");
    expect(result.launcherStateDir).toBe(`.tmp/main-wave-launcher/adhoc/${runId}/dry-run`);

    const dryRunRoot = path.join(repoDir, ".tmp", "main-wave-launcher", "adhoc", runId, "dry-run");
    const securityPreviewPath = path.join(
      dryRunRoot,
      "executors",
      "wave-0",
      "0-a7",
      "launch-preview.json",
    );
    expect(fs.existsSync(securityPreviewPath)).toBe(true);
    const securityPreview = JSON.parse(fs.readFileSync(securityPreviewPath, "utf8"));
    expect(securityPreview.skills.ids).toContain("role-security");
    expect(securityPreview.skills.ids).toContain("runtime-claude");

    expect(
      fs.existsSync(path.join(repoDir, ".tmp", "main-wave-launcher", "dry-run", "executors", "wave-0")),
    ).toBe(false);

    const showResult = runWaveCli(["adhoc", "show", "--run", runId, "--json"], repoDir);
    expect(showResult.status).toBe(0);
    const shown = JSON.parse(showResult.stdout);
    expect(shown.status).toBe("completed");
    expect(shown.agents.map((agent) => agent.agentId)).toContain("A7");
  });

  it("promotes an adhoc run into numbered roadmap artifacts and records the promotion", () => {
    const repoDir = initFixtureRepo();
    const planResult = runWaveCli(
      [
        "adhoc",
        "plan",
        "--task",
        "Investigate and document the root cause in `docs/plans/current-state.md`",
        "--json",
      ],
      repoDir,
    );
    expect(planResult.status).toBe(0);
    const summary = JSON.parse(planResult.stdout);

    const promoteResult = runWaveCli(
      ["adhoc", "promote", "--run", summary.runId, "--wave", "3", "--json"],
      repoDir,
    );
    expect(promoteResult.status).toBe(0);
    const promoted = JSON.parse(promoteResult.stdout);

    expect(fs.existsSync(path.join(repoDir, promoted.specPath))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, promoted.wavePath))).toBe(true);

    const storedResult = JSON.parse(
      fs.readFileSync(path.join(repoDir, ".wave", "adhoc", "runs", summary.runId, "result.json"), "utf8"),
    );
    expect(storedResult.promotedWave).toBe(3);
  });
});
