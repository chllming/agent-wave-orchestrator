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
    expect(changelog).toContain(`## ${version}`);
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
    expect(help.stdout).toContain("--project <id>");
    expect(help.stdout).toContain("--attach <current|global>");
    expect(dashboardSection).toContain(
      "wave dashboard --dashboard-file <path> [--project <id>] [--lane <lane>] [--message-board <path>] [--watch] [--refresh-ms <n>]",
    );
    expect(dashboardSection).toContain(
      "wave dashboard --project <id> --lane <lane> --attach current|global",
    );
    expect(dashboardSection).not.toContain("[--wave <n>]");
    expect(terminalGuide).toContain("pnpm exec wave dashboard --lane main --attach current");
    expect(terminalGuide).toContain("pnpm exec wave dashboard --lane main --attach global");
    expect(coordinationGuide).toContain("status scopes the top-level blocking edge to that active attempt");
  });

  it("documents and ships the sandbox supervisor attach surface", () => {
    const cliReference = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "cli-reference.md"),
      "utf8",
    );
    const architectureReadme = fs.readFileSync(
      path.join(repoRoot, "docs", "architecture", "README.md"),
      "utf8",
    );
    const help = spawnSync("node", [path.join(repoRoot, "scripts", "wave.mjs"), "attach", "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WAVE_SKIP_UPDATE_CHECK: "1",
      },
    });

    expect(help.status).toBe(0);
    expect(help.stdout).toContain("wave attach --run-id <id> --project <id> --lane <lane>");
    expect(cliReference).toContain("## wave attach");
    expect(cliReference).toContain("`--agent <id>` attaches to a live session only when the runtime record explicitly exposes one");
    expect(architectureReadme).toContain("agents/<agentId>.runtime.json");
    expect(architectureReadme).toContain("wave attach");
    expect(cliReference).toContain("`supervisor`");
    expect(cliReference).toContain("`forwardedClosureGaps`");
    expect(cliReference).toContain("`sessionBackend`");
    expect(cliReference).toContain("`resumeAction`");
  });

  it("ships a sandbox setup guide from the main doc surfaces", () => {
    const rootReadme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const docsReadme = fs.readFileSync(path.join(repoRoot, "docs", "README.md"), "utf8");
    const guide = fs.readFileSync(
      path.join(repoRoot, "docs", "guides", "sandboxed-environments.md"),
      "utf8",
    );
    const architectureReadme = fs.readFileSync(
      path.join(repoRoot, "docs", "architecture", "README.md"),
      "utf8",
    );

    expect(rootReadme).toContain("docs/guides/sandboxed-environments.md");
    expect(docsReadme).toContain("guides/sandboxed-environments.md");
    expect(guide).toContain("LEAPclaw");
    expect(guide).toContain("OpenClaw");
    expect(guide).toContain("Nemoshell");
    expect(guide).toContain("Docker");
    expect(guide).toContain("wave submit");
    expect(guide).toContain("wave supervise");
    expect(architectureReadme).toContain("guides/sandboxed-environments.md");
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

  it("documents the current operating recommendations for softer states and advisory turns", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const guide = fs.readFileSync(
      path.join(repoRoot, "docs", "guides", `recommendations-${packageJson.version}.md`),
      "utf8",
    );
    const historicalGuide = fs.readFileSync(
      path.join(repoRoot, "docs", "guides", "recommendations-0.9.13.md"),
      "utf8",
    );
    const docsReadme = fs.readFileSync(path.join(repoRoot, "docs", "README.md"), "utf8");

    expect(guide).toContain("budget.minutes");
    expect(guide).toContain("budget.turns");
    expect(guide).toContain("mark-advisory");
    expect(guide).toContain("mark-stale");
    expect(guide).toContain("resolve-policy");
    expect(guide).toContain("targeted recovery");
    expect(docsReadme).toContain(`guides/recommendations-${packageJson.version}.md`);
    expect(historicalGuide).not.toContain("awaiting-adjudication");
    expect(historicalGuide).not.toContain("wave signal");
  });

  it("links the monorepo projects guide from the main doc surfaces", () => {
    const docsReadme = fs.readFileSync(path.join(repoRoot, "docs", "README.md"), "utf8");
    const rootReadme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const monorepoGuide = fs.readFileSync(
      path.join(repoRoot, "docs", "guides", "monorepo-projects.md"),
      "utf8",
    );
    const cliReference = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "cli-reference.md"),
      "utf8",
    );

    expect(rootReadme).toContain("guides/monorepo-projects.md");
    expect(docsReadme).toContain("guides/monorepo-projects.md");
    expect(monorepoGuide).toContain("defaultProject");
    expect(monorepoGuide).toContain("projects.<projectId>");
    expect(monorepoGuide).toContain(".wave/projects/<projectId>/project-profile.json");
    expect(monorepoGuide).toContain(".wave/adhoc/<projectId>/runs/<run-id>/");
    expect(cliReference).toContain("wave control status --project <id> --lane <lane> --wave <n>");
  });

  it("keeps the README setup path agent-first", () => {
    const rootReadme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(rootReadme).toContain("Wave is meant to be operated through an agent");
    expect(rootReadme).toContain("The easiest way to set up Wave in any repo is:");
    expect(rootReadme).toContain("Then give your coding agent this copy-paste prompt:");
    expect(rootReadme).toContain("determine whether this should be a fresh setup, an adopt-existing setup, or a migration");
    expect(rootReadme).toContain("single-project or use monorepo projects with `defaultProject` plus `projects.<projectId>`");
    expect(rootReadme).toContain("Wave sends project, lane, wave, run, proof, and benchmark metadata");
    expect(rootReadme).toContain("what should count as proof");
    expect(rootReadme).toContain("build detailed waves, not vague stubs");
    expect(rootReadme).toContain("The intended interface is an agent using Wave");
    expect(rootReadme).toContain("## Manual Commands");
  });

  it("documents the package publishing flow and lifecycle scripts", () => {
    const rootReadme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const docsReadme = fs.readFileSync(path.join(repoRoot, "docs", "README.md"), "utf8");
    const publishingGuide = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "package-publishing-flow.md"),
      "utf8",
    );
    const tokenPublishingGuide = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "npmjs-token-publishing.md"),
      "utf8",
    );
    const trustedPublishingStub = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "npmjs-trusted-publishing.md"),
      "utf8",
    );

    expect(rootReadme).toContain("docs/reference/package-publishing-flow.md");
    expect(docsReadme).toContain("reference/package-publishing-flow.md");
    expect(publishingGuide).toContain("scripts/wave.mjs");
    expect(publishingGuide).toContain("scripts/wave-orchestrator/install.mjs");
    expect(publishingGuide).toContain("npmjs-token-publishing.md");
    expect(publishingGuide).toContain("wave doctor");
    expect(publishingGuide).toContain("wave changelog");
    expect(publishingGuide).toContain("wave upgrade");
    expect(publishingGuide).toContain("wave self-update");
    expect(publishingGuide).toContain("publish-npm.yml");
    expect(publishingGuide).toContain("publish-package.yml");
    expect(publishingGuide).toContain("pnpm publish --access public --no-git-checks");
    expect(publishingGuide).toContain("pnpm publish --registry=https://npm.pkg.github.com --no-git-checks");
    expect(publishingGuide).toContain("npm view @chllming/wave-orchestration version dist-tags --json");
    expect(tokenPublishingGuide).toContain("NPM_TOKEN");
    expect(trustedPublishingStub).toContain("does not currently use npm trusted publishing");
  });

  it("enforces tag and package version parity in publish workflows", () => {
    const npmWorkflow = fs.readFileSync(
      path.join(repoRoot, ".github", "workflows", "publish-npm.yml"),
      "utf8",
    );
    const packageWorkflow = fs.readFileSync(
      path.join(repoRoot, ".github", "workflows", "publish-package.yml"),
      "utf8",
    );

    expect(npmWorkflow).toContain("Verify tag matches package version");
    expect(npmWorkflow).toContain("GITHUB_REF_NAME");
    expect(npmWorkflow).toContain("package.json");
    expect(packageWorkflow).toContain("Verify tag matches package version");
    expect(packageWorkflow).toContain("GITHUB_REF_NAME");
    expect(packageWorkflow).toContain("package.json");
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
