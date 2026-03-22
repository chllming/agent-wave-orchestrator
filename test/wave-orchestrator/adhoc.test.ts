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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
    const documentationAgent = spec.agents.find((agent) => agent.agentId === "A9");
    expect(documentationAgent.ownedPaths).toEqual(
      expect.arrayContaining([
        `.wave/adhoc/runs/${summary.runId}/reports/wave-0-doc-closure.md`,
        "docs/plans/current-state.md",
        "docs/plans/master-plan.md",
        "docs/plans/migration.md",
      ]),
    );

    const result = JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf8"));
    expect(result.status).toBe("planned");
    expect(result.launcherStateDir).toBe(`.tmp/main-wave-launcher/adhoc/${summary.runId}`);

    const showResult = runWaveCli(["adhoc", "show", "--run", summary.runId, "--json"], repoDir);
    expect(showResult.status).toBe(0);
    const shown = JSON.parse(showResult.stdout);
    expect(shown.runId).toBe(summary.runId);
    expect(shown.status).toBe("planned");
  });

  it("filters external path hints and keeps repo-local new paths", () => {
    const repoDir = initFixtureRepo();
    const planResult = runWaveCli(
      [
        "adhoc",
        "plan",
        "--task",
        "Update `https://example.com/foo/bar`, `docs/reference/runtime-config/README.md`, and `docs/generated/new-guide.md`",
        "--json",
      ],
      repoDir,
    );
    expect(planResult.status).toBe(0);

    const summary = JSON.parse(planResult.stdout);
    const spec = readJson(path.join(repoDir, ".wave", "adhoc", "runs", summary.runId, "spec.json"));
    const worker = spec.agents.find((agent) => agent.agentId === "A1");

    expect(worker.ownedPaths).toEqual(
      expect.arrayContaining([
        "docs/reference/runtime-config/README.md",
        "docs/generated/new-guide.md",
      ]),
    );
    expect(worker.ownedPaths).not.toContain("https://example.com/foo/bar/");
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
    const docsQueue = readJson(path.join(dryRunRoot, "docs-queue", "wave-0.json"));
    expect(docsQueue.wave).toBe(0);

    const showResult = runWaveCli(["adhoc", "show", "--run", runId, "--json"], repoDir);
    expect(showResult.status).toBe(0);
    const shown = JSON.parse(showResult.stdout);
    expect(shown.status).toBe("completed");
    expect(shown.agents.map((agent) => agent.agentId)).toContain("A7");
  });

  it("promotes the stored adhoc spec into numbered roadmap artifacts and records the promotion", () => {
    const repoDir = initFixtureRepo();
    const planResult = runWaveCli(
      [
        "adhoc",
        "plan",
        "--task",
        "Benchmark auth token handling in `scripts/wave-orchestrator/launcher.mjs` and update `docs/plans/current-state.md`",
        "--json",
      ],
      repoDir,
    );
    expect(planResult.status).toBe(0);
    const summary = JSON.parse(planResult.stdout);
    const runDir = path.join(repoDir, ".wave", "adhoc", "runs", summary.runId);
    const originalSpec = readJson(path.join(runDir, "spec.json"));
    writeJson(path.join(repoDir, ".wave", "project-profile.json"), {
      schemaVersion: 1,
      initializedAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
      newProject: false,
      defaultOversightMode: "dark-factory",
      defaultTerminalSurface: "vscode",
      deployEnvironments: [],
      plannerDefaults: {
        template: "implementation",
        lane: "main",
      },
      source: {
        projectName: "fixture-repo",
        configPath: "wave.config.json",
      },
    });

    const promoteResult = runWaveCli(
      ["adhoc", "promote", "--run", summary.runId, "--wave", "3", "--json"],
      repoDir,
    );
    expect(promoteResult.status).toBe(0);
    const promoted = JSON.parse(promoteResult.stdout);

    expect(fs.existsSync(path.join(repoDir, promoted.specPath))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, promoted.wavePath))).toBe(true);
    const promotedSpec = readJson(path.join(repoDir, promoted.specPath));
    expect(promotedSpec.runKind).toBe("roadmap");
    expect(promotedSpec.runId).toBe(null);
    expect(promotedSpec.sourceRunId).toBe(summary.runId);
    expect(promotedSpec.wave).toBe(3);
    expect(promotedSpec.oversightMode).toBe(originalSpec.oversightMode);
    expect(promotedSpec.agents.map((agent) => agent.agentId)).toEqual(
      expect.arrayContaining(["E0", "A7", "A8", "A9"]),
    );
    const documentationAgent = promotedSpec.agents.find((agent) => agent.agentId === "A9");
    expect(documentationAgent.primaryGoal).toContain("Keep shared plan docs aligned with Wave 3");
    expect(documentationAgent.ownedPaths).toEqual(
      expect.arrayContaining([
        "docs/plans/current-state.md",
        "docs/plans/master-plan.md",
        "docs/plans/migration.md",
      ]),
    );
    expect(documentationAgent.ownedPaths.some((ownedPath) => ownedPath.startsWith(".wave/adhoc/"))).toBe(
      false,
    );
    const securityAgent = promotedSpec.agents.find((agent) => agent.agentId === "A7");
    expect(securityAgent.ownedPaths).toEqual([".tmp/main-wave-launcher/security/wave-3-review.md"]);
    const evalAgent = promotedSpec.agents.find((agent) => agent.agentId === "E0");
    expect(evalAgent.ownedPaths).toEqual(["docs/plans/waves/reviews/wave-3-cont-eval.md"]);

    const storedResult = JSON.parse(
      fs.readFileSync(path.join(repoDir, ".wave", "adhoc", "runs", summary.runId, "result.json"), "utf8"),
    );
    expect(storedResult.promotedWave).toBe(3);
  });
});
