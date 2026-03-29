import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ID } from "../../scripts/wave-orchestrator/config.mjs";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-terminal-surface-test-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "terminal-surface-fixture", private: true }, null, 2),
    "utf8",
  );
  return dir;
}

function runWaveCli(args, cwd) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      WAVE_SKIP_UPDATE_CHECK: "1",
    },
    timeout: 90000,
  });
}

function readDefaultProject(repoDir) {
  const configPath = path.join(repoDir, "wave.config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")).defaultProject || DEFAULT_PROJECT_ID;
}

function listRuntimeFiles(rootDir) {
  const found = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.name.endsWith(".runtime.json")) {
        found.push(entryPath);
      }
    }
  }
  return found;
}

function writeLocalExecutorWave(repoDir) {
  fs.writeFileSync(
    path.join(repoDir, "docs", "plans", "waves", "wave-0.md"),
    `# Wave 0 - Terminal Surface Verification

**Commit message**: \`Test: validate terminal surfaces\`

## Component promotions

- wave-parser-and-launcher: repo-landed
- starter-docs-and-adoption-guidance: repo-landed

## Context7 defaults

- bundle: none

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- id: local

### Context7

- bundle: none

### Prompt

\`\`\`text
Primary goal:
- Evaluate the local-executor based wave.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-0-cont-qa.md
\`\`\`

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- id: local

### Context7

- bundle: none

### Capabilities

- integration

### Prompt

\`\`\`text
Primary goal:
- Synthesize the local-executor wave.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-0.md
- .tmp/main-wave-launcher/integration/wave-0.json
\`\`\`

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- id: local

### Context7

- bundle: none

### Prompt

\`\`\`text
Primary goal:
- Keep shared docs aligned with the local-executor wave.

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

## Agent A1: Local Worker

### Executor

- id: local

### Context7

- bundle: none

### Components

- wave-parser-and-launcher
- starter-docs-and-adoption-guidance

### Prompt

\`\`\`text
Primary goal:
- Validate the local executor launch path.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- README.md
\`\`\`
`,
    "utf8",
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("terminal surfaces", () => {
  it("writes terminals.json for vscode surfaces but skips it for tmux and none", () => {
    const vscodeRepo = makeTempRepo();
    expect(runWaveCli(["init"], vscodeRepo).status).toBe(0);
    writeLocalExecutorWave(vscodeRepo);
    const vscodeResult = runWaveCli(
      [
        "launch",
        "--lane",
        "main",
        "--start-wave",
        "0",
        "--end-wave",
        "0",
        "--no-dashboard",
        "--agent-launch-stagger-ms",
        "0",
        "--keep-terminals",
        "--terminal-surface",
        "vscode",
      ],
      vscodeRepo,
    );
    expect(vscodeResult.status).toBe(0);
    expect(fs.existsSync(path.join(vscodeRepo, ".vscode", "terminals.json"))).toBe(true);
    expect(listRuntimeFiles(path.join(vscodeRepo, ".tmp")).length).toBeGreaterThan(0);

    const tmuxRepo = makeTempRepo();
    expect(runWaveCli(["init"], tmuxRepo).status).toBe(0);
    writeLocalExecutorWave(tmuxRepo);
    const defaultProject = readDefaultProject(tmuxRepo);
    const tmuxResult = runWaveCli(
      [
        "launch",
        "--terminal-surface",
        "tmux",
        "--project",
        defaultProject,
        "--lane",
        "main",
        "--start-wave",
        "0",
        "--end-wave",
        "0",
        "--no-dashboard",
        "--agent-launch-stagger-ms",
        "0",
        "--keep-terminals",
      ],
      tmuxRepo,
    );
    expect(tmuxResult.status).toBe(0);
    expect(fs.existsSync(path.join(tmuxRepo, ".vscode", "terminals.json"))).toBe(false);
    expect(listRuntimeFiles(path.join(tmuxRepo, ".tmp")).length).toBeGreaterThan(0);

    const noneRepo = makeTempRepo();
    expect(runWaveCli(["init"], noneRepo).status).toBe(0);
    writeLocalExecutorWave(noneRepo);
    const noneResult = runWaveCli(
      ["launch", "--lane", "main", "--start-wave", "0", "--end-wave", "0", "--dry-run", "--no-dashboard", "--terminal-surface", "none"],
      noneRepo,
    );
    expect(noneResult.status).toBe(0);
    expect(fs.existsSync(path.join(noneRepo, ".vscode", "terminals.json"))).toBe(false);
  }, 60000);
});
