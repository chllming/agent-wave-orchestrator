import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("release surface alignment", () => {
  it("keeps package metadata, README, changelog, and release manifest on the same version", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const installState = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ".wave", "install-state.json"), "utf8"),
    );
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "releases", "manifest.json"), "utf8"),
    );

    const version = packageJson.version;
    expect(installState.installedVersion).toBe(version);
    expect(manifest.releases[0]?.version).toBe(version);
    expect(readme).toContain(`@chllming/wave-orchestration@${version}`);
    expect(readme).toContain(
      `https://github.com/chllming/agent-wave-orchestrator/releases/tag/v${version}`,
    );
    expect(changelog).toMatch(new RegExp(`^## ${version.replaceAll(".", "\\.")} - \\d{4}-\\d{2}-\\d{2}$`, "m"));
    expect(packageJson.repository.url).toBe(
      "git+https://github.com/chllming/agent-wave-orchestrator.git",
    );
    expect(packageJson.homepage).toBe(
      "https://github.com/chllming/agent-wave-orchestrator#readme",
    );
    expect(packageJson.bugs.url).toBe(
      "https://github.com/chllming/agent-wave-orchestrator/issues",
    );
  });

  it("documents Codex turn ceilings as opaque and keeps budget.turns scoped to Claude/OpenCode", () => {
    const runtimeReadme = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "runtime-config", "README.md"),
      "utf8",
    );
    const codexDoc = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "runtime-config", "codex.md"),
      "utf8",
    );
    const runbook = fs.readFileSync(
      path.join(repoRoot, "docs", "plans", "wave-orchestrator.md"),
      "utf8",
    );

    expect(runtimeReadme).toContain("Advisory generic turn budget.");
    expect(runtimeReadme).toContain(
      "only runtime-specific settings such as `claude.maxTurns` or `opencode.steps` emit hard turn-limit flags.",
    );
    expect(runtimeReadme).toContain("Wave emitted no turn-limit flag");
    expect(codexDoc).toContain("Generic `budget.turns` does not set a Codex turn limit.");
    expect(codexDoc).toContain("limits.observedTurnLimit");
    expect(codexDoc).not.toContain(`"turns": 12`);
    expect(runbook).toContain("Generic `budget.turns` remains advisory metadata");
    expect(runbook).toContain("Codex turn ceilings remain external to Wave");
  });

  it("keeps dashboard docs aligned with the shipped attach surface", () => {
    const cliReference = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "cli-reference.md"),
      "utf8",
    );
    const dashboardSection = cliReference.split("## wave dashboard")[1]?.split("## ")[0] || "";
    const terminalGuide = fs.readFileSync(
      path.join(repoRoot, "docs", "guides", "terminal-surfaces.md"),
      "utf8",
    );
    const coordinationGuide = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "coordination-and-closure.md"),
      "utf8",
    );
    const help = spawnSync("node", [path.join(repoRoot, "scripts", "wave.mjs"), "dashboard", "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WAVE_SKIP_UPDATE_CHECK: "1",
      },
    });

    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--attach <current|global>");
    expect(dashboardSection).toContain(
      "wave dashboard --dashboard-file <path> [--lane <lane>] [--message-board <path>] [--watch] [--refresh-ms <n>]",
    );
    expect(dashboardSection).toContain("wave dashboard --lane <lane> --attach current|global");
    expect(dashboardSection).not.toContain("[--wave <n>]");
    expect(terminalGuide).toContain("pnpm exec wave dashboard --lane main --attach current");
    expect(terminalGuide).toContain("pnpm exec wave dashboard --lane main --attach global");
    expect(coordinationGuide).toContain("status scopes the top-level blocking edge to that active attempt");
  });

  it("documents the adopted-repo planner migration surface", () => {
    const plannerGuide = fs.readFileSync(path.join(repoRoot, "docs", "guides", "planner.md"), "utf8");
    const migrationGuide = fs.readFileSync(path.join(repoRoot, "docs", "plans", "migration.md"), "utf8");
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "releases", "manifest.json"), "utf8"),
    );

    expect(plannerGuide).toContain("docs/agents/wave-planner-role.md");
    expect(plannerGuide).toContain("skills/role-planner/");
    expect(plannerGuide).toContain("docs/context7/planner-agent/");
    expect(plannerGuide).toContain("docs/reference/wave-planning-lessons.md");
    expect(plannerGuide).toContain("planner-agentic");
    expect(migrationGuide).toContain(`current \`${packageJson.version}\` surface`);
    expect(migrationGuide).toContain(`## Upgrading From \`0.8.3\` To \`${packageJson.version}\``);
    expect(migrationGuide).toContain(`## Upgrading From \`0.6.x\` Or \`0.7.x\` To \`${packageJson.version}\``);
    expect(migrationGuide).toContain("wave dashboard --lane <lane> --attach current");
    expect(JSON.stringify(manifest.releases[0])).toContain("planner-agentic");
  });

  it("documents the 0.8.7 operating recommendations for softer states and advisory turns", () => {
    const guide = fs.readFileSync(
      path.join(repoRoot, "docs", "guides", "recommendations-0.8.7.md"),
      "utf8",
    );
    const docsReadme = fs.readFileSync(path.join(repoRoot, "docs", "README.md"), "utf8");

    expect(guide).toContain("budget.minutes");
    expect(guide).toContain("budget.turns");
    expect(guide).toContain("mark-advisory");
    expect(guide).toContain("mark-stale");
    expect(guide).toContain("resolve-policy");
    expect(guide).toContain("targeted recovery");
    expect(docsReadme).toContain("guides/recommendations-0.8.7.md");
  });

  it("documents fresh-launch relaunch-plan reset behavior", () => {
    const cliReference = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "cli-reference.md"),
      "utf8",
    );
    const runbook = fs.readFileSync(
      path.join(repoRoot, "docs", "plans", "wave-orchestrator.md"),
      "utf8",
    );
    const help = spawnSync("node", [path.join(repoRoot, "scripts", "wave.mjs"), "launch", "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WAVE_SKIP_UPDATE_CHECK: "1",
      },
    });

    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--resume-control-state");
    expect(cliReference).toContain("`--resume-control-state`");
    expect(runbook).toContain("clears the previous auto-generated relaunch plan");
  });

  it("documents pinned Context7 library ids and keeps the planner bundle as a placeholder until published", () => {
    const context7Guide = fs.readFileSync(
      path.join(repoRoot, "docs", "plans", "context7-wave-orchestrator.md"),
      "utf8",
    );
    const plannerGuide = fs.readFileSync(
      path.join(repoRoot, "docs", "guides", "planner.md"),
      "utf8",
    );
    const plannerCorpusGuide = fs.readFileSync(
      path.join(repoRoot, "docs", "context7", "planner-agent", "README.md"),
      "utf8",
    );
    const bundles = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "docs", "context7", "bundles.json"), "utf8"),
    );

    expect(context7Guide).toContain("Prefer exact `libraryId` values.");
    expect(context7Guide).toContain("Do not commit a guessed `libraryName`.");
    expect(context7Guide).toContain("## Making Attachment Explicit");
    expect(context7Guide).toContain("pnpm context7:api-check");
    expect(plannerGuide).toContain("starter repo keeps that bundle as a placeholder");
    expect(plannerGuide).toContain("exact `libraryId` is known");
    expect(plannerCorpusGuide).toContain("exact `libraryId`");
    expect(bundles.bundles["planner-agentic"].libraries).toEqual([]);
    expect(bundles.bundles["node-typescript"].libraries[0].libraryId).toBe("/nodejs/node");
    expect(bundles.bundles["react-web"].libraries[0].libraryId).toBe("/reactjs/react.dev");
  });
});
