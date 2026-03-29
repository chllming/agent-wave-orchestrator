import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-runtime-dry-run-"));
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
    env: {
      ...process.env,
      WAVE_SKIP_UPDATE_CHECK: "1",
    },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime dry-run harness", () => {
  it("documents the no-telemetry launcher flag in help output", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    const helpResult = runWaveCli(["launch", "--help"], repoDir);
    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toContain("--no-telemetry");
  });

  it("materializes prompts and executor overlays for codex, claude, and opencode", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    const initResult = runWaveCli(["init"], repoDir);
    expect(initResult.status).toBe(0);
    const configPath = path.join(repoDir, "wave.config.json");
    const waveConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    waveConfig.externalProviders = {
      ...(waveConfig.externalProviders || {}),
      context7: {
        ...(waveConfig.externalProviders?.context7 || {}),
        mode: "direct",
      },
      corridor: {
        ...(waveConfig.externalProviders?.corridor || {}),
        enabled: true,
        mode: "direct",
        teamId: "team-1",
        projectId: "corridor-project",
      },
    };
    fs.writeFileSync(configPath, `${JSON.stringify(waveConfig, null, 2)}\n`, "utf8");

    const wavePath = path.join(repoDir, "docs", "plans", "waves", "wave-0.md");
    fs.writeFileSync(
      wavePath,
      `# Wave 0 - Runtime Dry Run

**Commit message**: \`Chore: validate runtime dry-run overlays\`

## Component promotions

- wave-parser-and-launcher: repo-landed
- starter-docs-and-adoption-guidance: repo-landed

## Context7 defaults

- bundle: node-typescript
- query: "Node.js and TypeScript basics for orchestrator maintenance"

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- id: codex
- model: gpt-5-codex
- codex.profile_name: review
- codex.config: model_reasoning_effort=high
- codex.search: true
- codex.json: true

### Context7

- bundle: none

### Prompt

\`\`\`text
Primary goal:
- Keep the starter scaffold coherent while the rest of the wave runs.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-0-cont-qa.md
\`\`\`

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- id: claude
- claude.effort: high
- claude.max_turns: 4
- claude.settings_json: {"permissions":{"allow":["Read"]}}
- claude.hooks_json: {"Stop":[{"command":"echo stop"}]}
- claude.allowed_http_hook_urls: https://example.com/hooks

### Context7

- bundle: none

### Capabilities

- integration
- docs-shared-plan

### Prompt

\`\`\`text
Synthesize the wave before documentation and cont-qa closure.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-0.md
- .tmp/main-wave-launcher/integration/wave-0.json
\`\`\`

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- id: opencode
- opencode.steps: 5
- opencode.files: docs/runtime.md,README.md
- opencode.config_json: {"plugins":["./plugins/runtime.mjs"]}

### Context7

- bundle: none

### Prompt

\`\`\`text
Keep the starter shared plan docs aligned with the landed Wave 0 outcomes.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
\`\`\`

## Agent A1: Starter Runtime and Docs Review

### Executor

- profile: implement-fast
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "Node.js module layout, process spawning, and vitest test execution"

### Components

- wave-parser-and-launcher
- starter-docs-and-adoption-guidance

### Capabilities

- schema-migration
- frontend-validation

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Prompt

\`\`\`text
Review and tighten the starter runtime and test harness.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/wave-orchestrator.md and docs/plans/context7-wave-orchestrator.md.

File ownership (only touch these paths):
- README.md
- docs/plans/wave-orchestrator.md
- scripts/wave-orchestrator/wave-files.mjs
- test/wave-orchestrator/wave-files.test.ts
\`\`\`
`,
      "utf8",
    );

    const dryRunResult = runWaveCli(
      ["launch", "--lane", "main", "--dry-run", "--no-dashboard"],
      repoDir,
    );
    expect(dryRunResult.status).toBe(0);

    const dryRunRoot = path.join(repoDir, ".tmp", "main-wave-launcher", "dry-run");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dryRunRoot, "waves.manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: "wave-manifest",
    });
    expect(fs.existsSync(path.join(dryRunRoot, "prompts", "wave-0-0-a0.prompt.md"))).toBe(true);
    expect(fs.existsSync(path.join(dryRunRoot, "prompts", "wave-0-0-a8.prompt.md"))).toBe(true);
    expect(fs.existsSync(path.join(dryRunRoot, "prompts", "wave-0-0-a9.prompt.md"))).toBe(true);
    const implementationPrompt = fs.readFileSync(
      path.join(dryRunRoot, "prompts", "wave-0-0-a1.prompt.md"),
      "utf8",
    );
    expect(implementationPrompt).toContain("Context7 prefetch skipped during dry-run preview.");
    expect(fs.readdirSync(path.join(dryRunRoot, "context7-cache"))).toEqual([]);
    const integrationPrompt = fs.readFileSync(
      path.join(dryRunRoot, "prompts", "wave-0-0-a8.prompt.md"),
      "utf8",
    );
    expect(integrationPrompt).toContain("Corridor context omitted in dry-run preview.");
    expect(integrationPrompt).not.toContain("Corridor context absolute path:");
    expect(fs.existsSync(path.join(dryRunRoot, "security", "wave-0-corridor.json"))).toBe(false);

    const codexPreview = JSON.parse(
      fs.readFileSync(
        path.join(dryRunRoot, "executors", "wave-0", "0-a0", "launch-preview.json"),
        "utf8",
      ),
    );
    expect(codexPreview.executorId).toBe("codex");
    expect(codexPreview.invocationLines.join("\n")).toContain("--profile 'review'");
    expect(codexPreview.invocationLines.join("\n")).toContain("--json");
    expect(codexPreview.limits).toMatchObject({
      attemptTimeoutMinutes: null,
      knownTurnLimit: null,
      turnLimitSource: "not-set-by-wave",
    });
    expect(codexPreview.limits.notes[0]).toContain("Wave emits no Codex turn-limit flag");
    expect(codexPreview.skills.ids).toContain("runtime-codex");
    expect(
      fs.existsSync(path.join(dryRunRoot, "executors", "wave-0", "0-a0", "skills.resolved.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(dryRunRoot, "executors", "wave-0", "0-a0", "skills.expanded.md")),
    ).toBe(true);

    const claudePreview = JSON.parse(
      fs.readFileSync(
        path.join(dryRunRoot, "executors", "wave-0", "0-a8", "launch-preview.json"),
        "utf8",
      ),
    );
    expect(claudePreview.executorId).toBe("claude");
    expect(claudePreview.skills.ids).toContain("runtime-claude");
    expect(claudePreview.invocationLines.join("\n")).toContain("--effort 'high'");
    expect(claudePreview.limits).toMatchObject({
      attemptTimeoutMinutes: null,
      knownTurnLimit: 4,
      turnLimitSource: "claude.maxTurns",
    });
    expect(
      fs.existsSync(path.join(dryRunRoot, "executors", "wave-0", "0-a8", "claude-settings.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(dryRunRoot, "executors", "wave-0", "0-a8", "claude-skills.txt")),
    ).toBe(true);
    const claudeSettings = JSON.parse(
      fs.readFileSync(
        path.join(dryRunRoot, "executors", "wave-0", "0-a8", "claude-settings.json"),
        "utf8",
      ),
    );
    expect(claudeSettings).toMatchObject({
      permissions: {
        allow: ["Read"],
      },
      hooks: {
        Stop: [{ command: "echo stop" }],
      },
      allowedHttpHookUrls: ["https://example.com/hooks"],
    });

    const opencodePreview = JSON.parse(
      fs.readFileSync(
        path.join(dryRunRoot, "executors", "wave-0", "0-a9", "launch-preview.json"),
        "utf8",
      ),
    );
    expect(opencodePreview.executorId).toBe("opencode");
    expect(opencodePreview.skills.ids).toContain("runtime-opencode");
    expect(opencodePreview.invocationLines.join("\n")).toContain("--file 'docs/runtime.md'");
    expect(opencodePreview.limits).toMatchObject({
      attemptTimeoutMinutes: null,
      knownTurnLimit: 5,
      turnLimitSource: "opencode.steps",
    });
    expect(opencodePreview.invocationLines.join("\n")).toContain(
      "skills/role-documentation/skill.json",
    );
    expect(opencodePreview.invocationLines.join("\n")).toContain("skills/role-documentation/SKILL.md");
    expect(opencodePreview.invocationLines.join("\n")).toContain(
      "skills/wave-core/references/marker-syntax.md",
    );
    const opencodeConfig = JSON.parse(
      fs.readFileSync(
        path.join(dryRunRoot, "executors", "wave-0", "0-a9", "opencode.json"),
        "utf8",
      ),
    );
    expect(opencodeConfig.plugins).toEqual(["./plugins/runtime.mjs"]);
  });

  it("prunes stale dry-run executor preview directories when a wave shrinks", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    const initResult = runWaveCli(["init"], repoDir);
    expect(initResult.status).toBe(0);

    const wavePath = path.join(repoDir, "docs", "plans", "waves", "wave-0.md");
    fs.appendFileSync(
      wavePath,
      `

## Agent A2: Extra Implementation Worker

### Executor

- id: codex
- model: gpt-5-codex

### Context7

- bundle: node-typescript
- query: "Node.js and TypeScript basics for orchestrator maintenance"

### Components

- wave-parser-and-launcher

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Prompt

\`\`\`text
Extend the starter runtime coverage.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/README.md
\`\`\`
`,
      "utf8",
    );

    const firstDryRun = runWaveCli(
      ["launch", "--lane", "main", "--start-wave", "0", "--end-wave", "0", "--dry-run", "--no-dashboard", "--no-context7"],
      repoDir,
    );
    expect(firstDryRun.status).toBe(0);

    const extraAgentDir = path.join(
      repoDir,
      ".tmp",
      "main-wave-launcher",
      "dry-run",
      "executors",
      "wave-0",
      "0-a2",
    );
    expect(fs.existsSync(extraAgentDir)).toBe(true);

    const trimmedWave = fs
      .readFileSync(wavePath, "utf8")
      .split("## Agent A2: Extra Implementation Worker")[0]
      .trimEnd();
    fs.writeFileSync(wavePath, `${trimmedWave}\n`, "utf8");

    const secondDryRun = runWaveCli(
      ["launch", "--lane", "main", "--start-wave", "0", "--end-wave", "0", "--dry-run", "--no-dashboard", "--no-context7"],
      repoDir,
    );
    expect(secondDryRun.status).toBe(0);

    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(repoDir, ".tmp", "main-wave-launcher", "dry-run", "waves.manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.waves[0].agents.map((agent) => agent.agentId)).not.toContain("A2");
    expect(fs.existsSync(extraAgentDir)).toBe(false);
  });
});
