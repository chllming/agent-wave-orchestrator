import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectWorkspacePackageManager,
  selfUpdateWorkspace,
} from "../../scripts/wave-orchestrator/install.mjs";
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

function packagedPlannerContextFiles() {
  const plannerContextRoot = path.join(PACKAGE_ROOT, "docs", "context7", "planner-agent");
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
  visit(plannerContextRoot);
  return files.toSorted();
}

function removePlannerStarterSurface(repoDir) {
  fs.rmSync(path.join(repoDir, "docs", "agents", "wave-planner-role.md"), { force: true });
  fs.rmSync(path.join(repoDir, "skills", "role-planner"), { recursive: true, force: true });
  fs.rmSync(path.join(repoDir, "docs", "context7", "planner-agent"), { recursive: true, force: true });
  fs.rmSync(path.join(repoDir, "docs", "reference", "wave-planning-lessons.md"), { force: true });
  const bundlesPath = path.join(repoDir, "docs", "context7", "bundles.json");
  if (fs.existsSync(bundlesPath)) {
    const bundles = JSON.parse(fs.readFileSync(bundlesPath, "utf8"));
    if (bundles && typeof bundles === "object" && bundles.bundles && typeof bundles.bundles === "object") {
      delete bundles.bundles["planner-agentic"];
      fs.writeFileSync(bundlesPath, `${JSON.stringify(bundles, null, 2)}\n`, "utf8");
    }
  }
}

function runWaveCli(args, options = {}) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd: options.cwd || REPO_ROOT,
    env: {
      ...process.env,
      WAVE_SKIP_UPDATE_CHECK: "1",
      ...(options.env || {}),
    },
    encoding: "utf8",
  });
}

function repoLocalMarkdownLinks(markdown) {
  return Array.from(markdown.matchAll(/\[[^\]]+\]\((\.[^)]+)\)/g))
    .map((match) => String(match[1] || "").trim())
    .filter((href) => href && !href.includes("#"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("wave init", () => {
  it("seeds starter files into a fresh repo and writes install-state", () => {
    const repoDir = makeTempRepo();

    const result = runWaveCli(["init"], { cwd: repoDir });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(repoDir, "wave.config.json"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "waves", "wave-0.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "scripts", "wave-status.sh"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "scripts", "wave-watch.sh"))).toBe(true);
    expect(
      fs.existsSync(path.join(repoDir, "docs", "reference", "runtime-config", "README.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(repoDir, "docs", "context7", "planner-agent", "manifest.json")),
    ).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "reference", "cli-reference.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "reference", "package-publishing-flow.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "reference", "npmjs-token-publishing.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "guides", "sandboxed-environments.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "end-state-architecture.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "sandbox-end-state-architecture.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "CHANGELOG.md"))).toBe(true);
    const docsReadme = fs.readFileSync(path.join(repoDir, "docs", "README.md"), "utf8");
    for (const relativeHref of repoLocalMarkdownLinks(docsReadme)) {
      expect(fs.existsSync(path.resolve(path.join(repoDir, "docs"), relativeHref))).toBe(true);
    }
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
      "CHANGELOG.md",
      "wave.config.json",
      "docs/agents/wave-cont-qa-role.md",
      "docs/agents/wave-cont-eval-role.md",
      "docs/agents/wave-documentation-role.md",
      "docs/agents/wave-integration-role.md",
      "docs/agents/wave-planner-role.md",
      "docs/agents/wave-security-role.md",
      "docs/context7/bundles.json",
      "docs/evals/benchmark-catalog.json",
      "docs/evals/external-benchmarks.json",
      "docs/evals/external-command-config.sample.json",
      "docs/evals/external-command-config.swe-bench-pro.json",
      "docs/evals/wave-benchmark-program.md",
      "docs/evals/pilots/README.md",
      "docs/evals/pilots/swe-bench-pro-public-pilot.json",
      "docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json",
      "docs/evals/arm-templates/README.md",
      "docs/evals/arm-templates/single-agent.json",
      "docs/evals/arm-templates/full-wave.json",
      "docs/evals/cases/README.md",
      "docs/evals/cases/wave-hidden-profile-private-evidence.json",
      "docs/evals/cases/wave-premature-closure-guard.json",
      "docs/evals/cases/wave-silo-cross-agent-state.json",
      "docs/evals/cases/wave-blackboard-inbox-targeting.json",
      "docs/evals/cases/wave-contradiction-conflict.json",
      "docs/evals/cases/wave-simultaneous-lockstep.json",
      "docs/evals/cases/wave-expert-routing-preservation.json",
      "docs/guides/author-and-run-waves.md",
      "docs/guides/monorepo-projects.md",
      "docs/guides/recommendations-0.9.2.md",
      "docs/guides/sandboxed-environments.md",
      "docs/guides/signal-wrappers.md",
      "docs/plans/component-cutover-matrix.json",
      "docs/plans/component-cutover-matrix.md",
      "docs/plans/architecture-hardening-migration.md",
      "docs/plans/context7-wave-orchestrator.md",
      "docs/plans/current-state.md",
      "docs/plans/end-state-architecture.md",
      "docs/plans/master-plan.md",
      "docs/plans/migration.md",
      "docs/plans/sandbox-end-state-architecture.md",
      "docs/plans/wave-orchestrator.md",
      "docs/plans/waves/wave-0.md",
      "docs/plans/examples/wave-benchmark-improvement.md",
      "docs/reference/cli-reference.md",
      "docs/reference/npmjs-token-publishing.md",
      "docs/reference/npmjs-trusted-publishing.md",
      "docs/reference/package-publishing-flow.md",
      "docs/reference/wave-planning-lessons.md",
      "docs/reference/repository-guidance.md",
      "docs/research/agent-context-sources.md",
      ...packagedPlannerContextFiles(),
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
      "docs/agents/wave-cont-qa-role.md",
      "docs/agents/wave-cont-eval-role.md",
      "docs/agents/wave-documentation-role.md",
      "docs/agents/wave-planner-role.md",
      "docs/agents/wave-security-role.md",
      "docs/context7/bundles.json",
      "docs/evals/benchmark-catalog.json",
      "docs/evals/external-benchmarks.json",
      "docs/evals/external-command-config.sample.json",
      "docs/evals/external-command-config.swe-bench-pro.json",
      "docs/evals/wave-benchmark-program.md",
      "docs/evals/pilots/README.md",
      "docs/evals/pilots/swe-bench-pro-public-pilot.json",
      "docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json",
      "docs/evals/arm-templates/README.md",
      "docs/evals/arm-templates/single-agent.json",
      "docs/evals/arm-templates/full-wave.json",
      "docs/evals/cases/README.md",
      "docs/evals/cases/wave-hidden-profile-private-evidence.json",
      "docs/evals/cases/wave-premature-closure-guard.json",
      "docs/evals/cases/wave-silo-cross-agent-state.json",
      "docs/evals/cases/wave-blackboard-inbox-targeting.json",
      "docs/evals/cases/wave-contradiction-conflict.json",
      "docs/evals/cases/wave-simultaneous-lockstep.json",
      "docs/evals/cases/wave-expert-routing-preservation.json",
      "docs/plans/current-state.md",
      "docs/plans/master-plan.md",
      "docs/plans/migration.md",
      "docs/plans/examples/wave-benchmark-improvement.md",
      "docs/reference/wave-planning-lessons.md",
      "docs/reference/repository-guidance.md",
      "docs/research/agent-context-sources.md",
      ...packagedPlannerContextFiles(),
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

  it("adds planner follow-up guidance for adopted repos missing the planner starter surface", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);
    removePlannerStarterSurface(repoDir);

    const installStatePath = path.join(repoDir, ".wave", "install-state.json");
    const installState = JSON.parse(fs.readFileSync(installStatePath, "utf8"));
    installState.initMode = "adopt-existing";
    installState.installedVersion = "0.6.3";
    fs.writeFileSync(installStatePath, `${JSON.stringify(installState, null, 2)}\n`, "utf8");

    const upgradeResult = runWaveCli(["upgrade"], { cwd: repoDir });

    expect(upgradeResult.status).toBe(0);
    const historyDir = path.join(repoDir, ".wave", "upgrade-history");
    const reports = fs.readdirSync(historyDir).filter((fileName) => fileName.endsWith(".md"));
    expect(reports.length).toBe(1);
    const reportText = fs.readFileSync(path.join(historyDir, reports[0]), "utf8");
    expect(reportText).toContain("## Adopted Repo Follow-Up");
    expect(reportText).toContain("wave upgrade` does not copy new planner starter docs, skills, or Context7 bundle entries into adopted repos");
    expect(reportText).toContain("docs/context7/bundles.json#planner-agentic");
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

  it("groups missing planner starter surface into one doctor error", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);
    removePlannerStarterSurface(repoDir);

    const doctorResult = runWaveCli(["doctor", "--json"], { cwd: repoDir });

    expect(doctorResult.status).toBe(0);
    const payload = JSON.parse(doctorResult.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Planner starter surface is incomplete for 0.7.x workspaces."),
      ]),
    );
    const combinedErrors = payload.errors.join("\n");
    expect(combinedErrors).toContain("docs/agents/wave-planner-role.md");
    expect(combinedErrors).toContain("skills/role-planner/");
    expect(combinedErrors).toContain("docs/context7/planner-agent/");
    expect(combinedErrors).toContain("docs/reference/wave-planning-lessons.md");
    expect(combinedErrors).toContain("docs/context7/bundles.json#planner-agentic");
    expect(combinedErrors).not.toContain("Missing planner file:");
  });

  it("fails doctor when brokered providers target the packaged default endpoint", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);
    const configPath = path.join(repoDir, "wave.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.externalProviders = {
      context7: {
        mode: "broker",
      },
    };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const doctorResult = runWaveCli(["doctor", "--json"], { cwd: repoDir });
    expect(doctorResult.status).toBe(0);
    const payload = JSON.parse(doctorResult.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Brokered external providers require an owned Wave Control endpoint"),
      ]),
    );
  });
});

describe("workspace package manager detection", () => {
  it("prefers packageManager from package.json", () => {
    const repoDir = makeTempRepo();
    fs.writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "fixture-repo", private: true, packageManager: "pnpm@10.23.0" }, null, 2),
      "utf8",
    );

    expect(detectWorkspacePackageManager(repoDir)).toMatchObject({
      id: "pnpm",
      source: "packageManager",
    });
  });
});

describe("wave self-update", () => {
  it("runs only `wave upgrade` when the dependency is already current but install-state is behind", async () => {
    const repoDir = makeTempRepo();
    fs.writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "fixture-repo", private: true, packageManager: "pnpm@10.23.0" }, null, 2),
      "utf8",
    );
    fs.mkdirSync(path.join(repoDir, ".wave"), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, ".wave", "install-state.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          packageName: "@chllming/wave-orchestration",
          installedVersion: "0.6.1",
        },
        null,
        2,
      ),
      "utf8",
    );
    const calls = [];
    const spawnImpl = vi.fn((command, args) => {
      calls.push([command, args]);
      return { status: 0 };
    });

    const result = await selfUpdateWorkspace({
      workspaceRoot: repoDir,
      packageMetadata: {
        name: "@chllming/wave-orchestration",
        version: CURRENT_PACKAGE_VERSION,
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ version: CURRENT_PACKAGE_VERSION }),
      }),
      spawnImpl,
      emit: () => {},
    });

    expect(result.mode).toBe("upgrade-only");
    expect(calls).toEqual([["pnpm", ["exec", "wave", "upgrade"]]]);
  });

  it("updates the dependency, shows changelog delta, and records the upgrade", async () => {
    const repoDir = makeTempRepo();
    fs.writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "fixture-repo", private: true, packageManager: "pnpm@10.23.0" }, null, 2),
      "utf8",
    );
    const calls = [];
    const spawnImpl = vi.fn((command, args) => {
      calls.push([command, args]);
      return { status: 0 };
    });

    const result = await selfUpdateWorkspace({
      workspaceRoot: repoDir,
      packageMetadata: {
        name: "@chllming/wave-orchestration",
        version: CURRENT_PACKAGE_VERSION,
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ version: "9.9.9" }),
      }),
      spawnImpl,
      emit: () => {},
    });

    expect(result.mode).toBe("updated");
    expect(calls).toEqual([
      ["pnpm", ["add", "-D", "@chllming/wave-orchestration@latest"]],
      ["pnpm", ["exec", "wave", "changelog", "--since-installed"]],
      ["pnpm", ["exec", "wave", "upgrade"]],
    ]);
  });
});
