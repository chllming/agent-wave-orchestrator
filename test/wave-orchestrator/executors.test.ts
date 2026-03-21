import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExecutorLaunchSpec } from "../../scripts/wave-orchestrator/executors.mjs";
import {
  applyExecutorSelectionsToWave,
  parseWaveContent,
} from "../../scripts/wave-orchestrator/wave-files.mjs";

const tempPaths = [];

function registerTempPath(targetPath) {
  tempPaths.push(targetPath);
  return targetPath;
}

afterEach(() => {
  for (const targetPath of tempPaths.splice(0)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

describe("executor parsing and resolution", () => {
  it("parses per-agent executor settings and resolves mixed executors", () => {
    const wave = applyExecutorSelectionsToWave(
      parseWaveContent(
        `# Wave 3 - Executor Mix

## Agent A1: Claude Worker

### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.agent: reviewer
- claude.permission_mode: plan
- claude.max_turns: 4
- claude.mcp_config: .tmp/mcp.json

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/example.md
\`\`\`

## Agent A2: Default Worker

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- src/example.ts
\`\`\`
`,
        "/tmp/wave-3.md",
      ),
      {
        lane: "main",
        executorMode: "opencode",
      },
    );

    expect(wave.agents[0]?.executorConfig).toEqual({
      id: "claude",
      model: "claude-sonnet-4-6",
      codex: null,
      claude: {
        agent: "reviewer",
        permissionMode: "plan",
        maxTurns: 4,
        mcpConfig: ".tmp/mcp.json",
      },
      opencode: null,
    });
    expect(wave.agents[0]?.executorResolved).toMatchObject({
      id: "claude",
      model: "claude-sonnet-4-6",
      claude: {
        agent: "reviewer",
        permissionMode: "plan",
        maxTurns: 4,
        mcpConfig: [".tmp/mcp.json"],
      },
    });
    expect(wave.agents[1]?.executorResolved).toMatchObject({
      id: "opencode",
    });
  });
});

describe("buildExecutorLaunchSpec", () => {
  it("writes a Claude overlay file and builds a headless invocation", () => {
    const dir = registerTempPath(fs.mkdtempSync(path.join(os.tmpdir(), "wave-executor-claude-")));
    const promptPath = path.join(dir, "prompt.md");
    const logPath = path.join(dir, "agent.log");
    const overlayDir = path.join(dir, "claude");
    fs.writeFileSync(promptPath, "Prompt body\n", "utf8");

    const spec = buildExecutorLaunchSpec({
      agent: {
        agentId: "A1",
        title: "Claude Worker",
        executorResolved: {
          id: "claude",
          model: "claude-sonnet-4-6",
          codex: { command: "codex", sandbox: "danger-full-access" },
          claude: {
            command: "claude",
            model: "claude-sonnet-4-6",
            agent: "reviewer",
            appendSystemPromptMode: "append",
            permissionMode: "plan",
            permissionPromptTool: null,
            maxTurns: 3,
            mcpConfig: [".tmp/mcp.json"],
            strictMcpConfig: true,
            settings: ".tmp/claude-settings.json",
            outputFormat: "text",
            allowedTools: ["Read"],
            disallowedTools: ["Edit"],
          },
          opencode: {
            command: "opencode",
            model: null,
            agent: null,
            attach: null,
            format: "default",
            steps: null,
            instructions: [],
            permission: null,
          },
        },
      },
      promptPath,
      logPath,
      overlayDir,
    });

    expect(spec.executorId).toBe("claude");
    expect(fs.readFileSync(path.join(overlayDir, "claude-system-prompt.txt"), "utf8")).toContain(
      "Wave orchestration harness",
    );
    const invocation = spec.invocationLines.join("\n");
    expect(invocation).toContain("claude -p --no-session-persistence");
    expect(invocation).toContain("--append-system-prompt-file");
    expect(invocation).toContain("--max-turns '3'");
    expect(invocation).toContain("--strict-mcp-config");
  });

  it("writes an OpenCode overlay config and builds a headless invocation", () => {
    const dir = registerTempPath(fs.mkdtempSync(path.join(os.tmpdir(), "wave-executor-opencode-")));
    const promptPath = path.join(dir, "prompt.md");
    const logPath = path.join(dir, "agent.log");
    const overlayDir = path.join(dir, "opencode");
    fs.writeFileSync(promptPath, "Prompt body\n", "utf8");

    const spec = buildExecutorLaunchSpec({
      agent: {
        agentId: "A2",
        title: "OpenCode Worker",
        executorResolved: {
          id: "opencode",
          model: "anthropic/claude-sonnet-4-20250514",
          codex: { command: "codex", sandbox: "danger-full-access" },
          claude: {
            command: "claude",
            model: null,
            agent: null,
            appendSystemPromptMode: "append",
            permissionMode: null,
            permissionPromptTool: null,
            maxTurns: null,
            mcpConfig: [],
            strictMcpConfig: false,
            settings: null,
            outputFormat: "text",
            allowedTools: [],
            disallowedTools: [],
          },
          opencode: {
            command: "opencode",
            model: "anthropic/claude-sonnet-4-20250514",
            agent: "wave-open",
            attach: "http://localhost:4096",
            format: "json",
            steps: 5,
            instructions: ["docs/reference/repository-guidance.md"],
            permission: {
              edit: "ask",
            },
          },
        },
      },
      promptPath,
      logPath,
      overlayDir,
    });

    expect(spec.executorId).toBe("opencode");
    expect(spec.env?.OPENCODE_CONFIG).toBe(path.join(overlayDir, "opencode.json"));
    const config = JSON.parse(fs.readFileSync(path.join(overlayDir, "opencode.json"), "utf8"));
    expect(config.instructions).toEqual(["docs/reference/repository-guidance.md"]);
    expect(config.agent["wave-open"]).toMatchObject({
      mode: "primary",
      steps: 5,
      permission: {
        edit: "ask",
      },
    });
    const invocation = spec.invocationLines.join("\n");
    expect(invocation).toContain("opencode run --agent 'wave-open'");
    expect(invocation).toContain("--attach 'http://localhost:4096'");
    expect(invocation).toContain("--format 'json'");
  });
});
