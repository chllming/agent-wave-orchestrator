import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT, REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];
const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
).version;

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-install-test-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture-repo", private: true }, null, 2),
    "utf8",
  );
  return dir;
}

function packagedSkillFiles() {
  const skillsRoot = path.join(PACKAGE_ROOT, "skills");
  const files = [];
  const visit = (targetDir) => {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      const fullPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else {
        files.push(path.relative(PACKAGE_ROOT, fullPath).replaceAll(path.sep, "/"));
      }
    }
  };
  visit(skillsRoot);
  return files.toSorted();
}

function runWaveCli(args, options = {}) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd: options.cwd || REPO_ROOT,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("wave init", () => {
  it("seeds starter files into a fresh repo and writes install-state", () => {
    const repoDir = makeTempRepo();

    const result = runWaveCli(["init"], { cwd: repoDir });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(repoDir, "wave.config.json"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "waves", "wave-0.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(repoDir, "docs", "reference", "runtime-config", "README.md")),
    ).toBe(true);
    const installState = JSON.parse(
      fs.readFileSync(path.join(repoDir, ".wave", "install-state.json"), "utf8"),
    );
    expect(installState).toMatchObject({
      packageName: "@chllming/wave-orchestration",
      installedVersion: CURRENT_PACKAGE_VERSION,
      initMode: "fresh",
    });
    expect(installState.seededFiles).toContain("wave.config.json");
  });

  it("requires adopt-existing when bootstrap files already exist", () => {
    const repoDir = makeTempRepo();
    fs.writeFileSync(path.join(repoDir, "wave.config.json"), "{\n  \"version\": 99\n}\n", "utf8");

    const result = runWaveCli(["init"], { cwd: repoDir });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--adopt-existing");
    expect(fs.readFileSync(path.join(repoDir, "wave.config.json"), "utf8")).toContain("\"version\": 99");
  });

  it("adopts existing config and waves without overwriting them", () => {
    const repoDir = makeTempRepo();
    fs.mkdirSync(path.join(repoDir, "docs", "plans", "waves"), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "wave.config.json"),
      "{\n  \"projectName\": \"Existing Repo\"\n}\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(repoDir, "docs", "plans", "waves", "wave-0.md"),
      "# Existing Wave\n",
      "utf8",
    );

    const result = runWaveCli(["init", "--adopt-existing"], { cwd: repoDir });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(repoDir, "wave.config.json"), "utf8")).toContain(
      "Existing Repo",
    );
    expect(fs.readFileSync(path.join(repoDir, "docs", "plans", "waves", "wave-0.md"), "utf8")).toBe(
      "# Existing Wave\n",
    );
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "current-state.md"))).toBe(false);
    const installState = JSON.parse(
      fs.readFileSync(path.join(repoDir, ".wave", "install-state.json"), "utf8"),
    );
    expect(installState.initMode).toBe("adopt-existing");
    expect(installState.adoptedFiles).toEqual(
      expect.arrayContaining(["wave.config.json", "docs/plans/waves/wave-0.md"]),
    );
  });

  it("lets an adopted workspace pass doctor without rewriting repo-owned files", () => {
    const repoDir = makeTempRepo();
    fs.mkdirSync(path.join(repoDir, "docs", "plans", "waves"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "agents"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "context7"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "plans"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "reference"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "research"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".gitignore"), ".tmp/\ndocs/research/cache/\ndocs/research/agent-context-cache/\ndocs/research/papers/\ndocs/research/articles/\n", "utf8");
    for (const relPath of [
      "wave.config.json",
      "docs/agents/wave-evaluator-role.md",
      "docs/agents/wave-documentation-role.md",
      "docs/agents/wave-integration-role.md",
      "docs/context7/bundles.json",
      "docs/plans/component-cutover-matrix.json",
      "docs/plans/component-cutover-matrix.md",
      "docs/plans/context7-wave-orchestrator.md",
      "docs/plans/current-state.md",
      "docs/plans/master-plan.md",
      "docs/plans/migration.md",
      "docs/plans/wave-orchestrator.md",
      "docs/plans/waves/wave-0.md",
      "docs/reference/repository-guidance.md",
      "docs/research/agent-context-sources.md",
      ...packagedSkillFiles(),
    ]) {
      const targetPath = path.join(repoDir, relPath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, fs.readFileSync(path.join(PACKAGE_ROOT, relPath), "utf8"), "utf8");
    }

    const initResult = runWaveCli(["init", "--adopt-existing"], { cwd: repoDir });
    expect(initResult.status).toBe(0);

    const doctorResult = runWaveCli(["doctor", "--json"], { cwd: repoDir });
    expect(doctorResult.status).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({ ok: true });
  });
});

describe("wave upgrade", () => {
  it("writes an upgrade report and leaves adopted files unchanged", () => {
    const repoDir = makeTempRepo();
    fs.mkdirSync(path.join(repoDir, "docs", "plans", "waves"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, ".gitignore"), ".tmp/\ndocs/research/cache/\ndocs/research/agent-context-cache/\ndocs/research/papers/\ndocs/research/articles/\n", "utf8");
    fs.writeFileSync(
      path.join(repoDir, "wave.config.json"),
      fs.readFileSync(path.join(PACKAGE_ROOT, "wave.config.json"), "utf8"),
      "utf8",
    );
    fs.mkdirSync(path.join(repoDir, "docs", "agents"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "context7"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "plans"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "reference"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "docs", "research"), { recursive: true });
    for (const relPath of [
      "docs/agents/wave-evaluator-role.md",
      "docs/agents/wave-documentation-role.md",
      "docs/context7/bundles.json",
      "docs/plans/current-state.md",
      "docs/plans/master-plan.md",
      "docs/plans/migration.md",
      "docs/reference/repository-guidance.md",
      "docs/research/agent-context-sources.md",
      ...packagedSkillFiles(),
    ]) {
      const targetPath = path.join(repoDir, relPath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, fs.readFileSync(path.join(PACKAGE_ROOT, relPath), "utf8"), "utf8");
    }
    const customWavePath = path.join(repoDir, "docs", "plans", "waves", "wave-0.md");
    fs.writeFileSync(customWavePath, fs.readFileSync(path.join(PACKAGE_ROOT, "docs", "plans", "waves", "wave-0.md"), "utf8"), "utf8");

    const initResult = runWaveCli(["init", "--adopt-existing"], { cwd: repoDir });
    expect(initResult.status).toBe(0);

    const installStatePath = path.join(repoDir, ".wave", "install-state.json");
    const installState = JSON.parse(fs.readFileSync(installStatePath, "utf8"));
    installState.installedVersion = "0.1.0";
    fs.writeFileSync(installStatePath, `${JSON.stringify(installState, null, 2)}\n`, "utf8");

    const upgradeResult = runWaveCli(["upgrade"], { cwd: repoDir });

    expect(upgradeResult.status).toBe(0);
    const updatedState = JSON.parse(fs.readFileSync(installStatePath, "utf8"));
    expect(updatedState.installedVersion).toBe(CURRENT_PACKAGE_VERSION);
    expect(fs.readFileSync(customWavePath, "utf8")).toBe(
      fs.readFileSync(path.join(PACKAGE_ROOT, "docs", "plans", "waves", "wave-0.md"), "utf8"),
    );
    const historyDir = path.join(repoDir, ".wave", "upgrade-history");
    const reports = fs.readdirSync(historyDir).filter((fileName) => fileName.endsWith(".md"));
    expect(reports.length).toBe(1);
    expect(fs.readFileSync(path.join(historyDir, reports[0]), "utf8")).toContain(
      CURRENT_PACKAGE_VERSION,
    );
    expect(fs.readFileSync(path.join(historyDir, reports[0]), "utf8")).toContain(
      "No repo-owned plans, waves, role prompts, or config files were overwritten.",
    );
  });
});

describe("wave doctor", () => {
  it("passes for the adopted package source repo", () => {
    const doctorResult = runWaveCli(["doctor", "--json"], { cwd: REPO_ROOT });

    expect(doctorResult.status).toBe(0);
    expect(JSON.parse(doctorResult.stdout)).toMatchObject({ ok: true });
  });

  it("supports --repo-root from outside the target workspace", () => {
    const repoDir = makeTempRepo();
    const initResult = runWaveCli(["init"], { cwd: repoDir });
    expect(initResult.status).toBe(0);

    const doctorResult = runWaveCli(["--repo-root", repoDir, "doctor", "--json"], {
      cwd: REPO_ROOT,
    });

    expect(doctorResult.status).toBe(0);
    const payload = JSON.parse(doctorResult.stdout);
    expect(payload.workspaceRoot).toBe(repoDir);
    expect(payload.ok).toBe(true);
  });

  it("warns when generated-state ignore entries for .wave and VS Code terminals are missing", () => {
    const repoDir = makeTempRepo();
    const initResult = runWaveCli(["init"], { cwd: repoDir });
    expect(initResult.status).toBe(0);
    fs.writeFileSync(
      path.join(repoDir, ".gitignore"),
      ".tmp/\ndocs/research/cache/\ndocs/research/agent-context-cache/\ndocs/research/papers/\ndocs/research/articles/\n",
      "utf8",
    );

    const doctorResult = runWaveCli(["doctor", "--json"], { cwd: repoDir });
    expect(doctorResult.status).toBe(0);
    const payload = JSON.parse(doctorResult.stdout);
    expect(payload.warnings).toEqual(
      expect.arrayContaining([
        "Missing recommended .gitignore entry: .wave/",
        "Missing recommended .gitignore entry: .vscode/terminals.json",
      ]),
    );
  });
});
