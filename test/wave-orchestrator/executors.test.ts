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

function makeLaneProfile() {
  return {
    lane: "main",
    sharedPlanDocs: [],
    roles: {
      rolePromptDir: "docs/agents",
      evaluatorAgentId: "A0",
      integrationAgentId: "A8",
      documentationAgentId: "A9",
      evaluatorRolePromptPath: "docs/agents/wave-evaluator-role.md",
      integrationRolePromptPath: "docs/agents/wave-integration-role.md",
      documentationRolePromptPath: "docs/agents/wave-documentation-role.md",
    },
    validation: {
      requiredPromptReferences: [],
      requireDocumentationStewardFromWave: 0,
      requireContext7DeclarationsFromWave: null,
      requireExitContractsFromWave: null,
      requireIntegrationStewardFromWave: 0,
      requireComponentPromotionsFromWave: null,
      requireAgentComponentsFromWave: null,
    },
    executors: {
      default: "codex",
      profiles: {
        "docs-pass": {
          id: "claude",
          tags: ["documentation"],
          budget: { turns: 8, minutes: 20 },
          fallbacks: ["opencode"],
          claude: { agent: "docs-reviewer" },
        },
      },
      codex: {
        command: "codex",
        sandbox: "danger-full-access",
      },
      claude: {
        command: "claude",
        model: "claude-sonnet-4-6",
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
        agent: null,
        attach: null,
        format: "default",
        steps: null,
        instructions: [],
        permission: null,
      },
    },
    capabilityRouting: {
      preferredAgents: {},
    },
    runtimePolicy: {
      runtimeMixTargets: { codex: 3, claude: 2, opencode: 2 },
      defaultExecutorByRole: {
        implementation: "codex",
        integration: "claude",
        documentation: "claude",
        evaluator: "claude",
        research: "opencode",
        infra: "opencode",
        deploy: "opencode",
      },
      fallbackExecutorOrder: ["claude", "opencode", "codex"],
    },
  };
}

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
      profile: null,
      model: "claude-sonnet-4-6",
      fallbacks: [],
      tags: [],
      budget: null,
      codex: null,
      claude: {
        agent: "reviewer",
        permissionMode: "plan",
        maxTurns: 4,
        mcpConfig: [".tmp/mcp.json"],
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
      id: "codex",
      selectedBy: "lane-role-default",
    });
  });

  it("applies lane role defaults and executor profiles", () => {
    const laneProfile = makeLaneProfile();
    const wave = applyExecutorSelectionsToWave(
      parseWaveContent(
        `# Wave 4 - Runtime Plan

## Agent A1: Implementation Worker

### Prompt
\`\`\`text
File ownership (only touch these paths):
- src/example.ts
\`\`\`

## Agent A9: Documentation Steward

### Executor

- profile: docs-pass

### Prompt
\`\`\`text
File ownership (only touch these paths):
- docs/plans/master-plan.md
\`\`\`
`,
        "/tmp/wave-4.md",
        { laneProfile },
      ),
      { laneProfile },
    );

    expect(wave.agents[0]?.executorResolved).toMatchObject({
      id: "codex",
      role: "implementation",
      selectedBy: "lane-role-default",
      fallbacks: ["claude", "opencode"],
    });
    expect(wave.agents[1]?.executorResolved).toMatchObject({
      id: "claude",
      role: "documentation",
      profile: "docs-pass",
      selectedBy: "agent-profile",
      tags: ["documentation"],
      budget: { turns: 8, minutes: 20 },
      fallbacks: ["opencode"],
      claude: {
        agent: "docs-reviewer",
      },
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
