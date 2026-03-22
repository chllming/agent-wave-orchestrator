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
      contQaAgentId: "A0",
      integrationAgentId: "A8",
      documentationAgentId: "A9",
      contQaRolePromptPath: "docs/agents/wave-cont-qa-role.md",
      integrationRolePromptPath: "docs/agents/wave-integration-role.md",
      documentationRolePromptPath: "docs/agents/wave-documentation-role.md",
      securityRolePromptPath: "docs/agents/wave-security-role.md",
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
        profileName: null,
        config: [],
        search: false,
        images: [],
        addDirs: [],
        json: false,
        ephemeral: false,
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
        settingsJson: null,
        hooksJson: null,
        allowedHttpHookUrls: [],
        outputFormat: "text",
        allowedTools: [],
        disallowedTools: [],
      },
      opencode: {
        command: "opencode",
        model: "anthropic/claude-sonnet-4-20250514",
        agent: null,
        attach: null,
        files: [],
        format: "default",
        steps: null,
        instructions: [],
        permission: null,
        configJson: null,
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
        "cont-qa": "claude",
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
      retryPolicy: null,
      allowFallbackOnRetry: null,
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

  it("parses advanced Codex, Claude, and OpenCode executor settings", () => {
    const wave = applyExecutorSelectionsToWave(
      parseWaveContent(
        `# Wave 5 - Runtime Surface

## Agent A1: Codex Reviewer

### Executor

- id: codex
- model: gpt-5-codex
- codex.profile_name: review
- codex.config: model_reasoning_effort=high,model_verbosity=low
- codex.search: true
- codex.images: docs/mock-ui.png
- codex.add_dirs: ../shared,../infra
- codex.json: true
- codex.ephemeral: true

### Prompt
\`\`\`text
File ownership (only touch these paths):
- src/runtime.ts
\`\`\`

## Agent A2: Claude Worker

### Executor

- id: claude
- claude.settings_json: {"permissions":{"allow":["Read"]}}
- claude.hooks_json: {"Stop":[{"command":"echo stop"}]}
- claude.allowed_http_hook_urls: https://example.com/hook

### Prompt
\`\`\`text
File ownership (only touch these paths):
- docs/runtime.md
\`\`\`

## Agent A3: OpenCode Worker

### Executor

- id: opencode
- opencode.files: docs/runtime.md,README.md
- opencode.config_json: {"plugins":["./plugins/runtime.mjs"]}

### Prompt
\`\`\`text
File ownership (only touch these paths):
- scripts/runtime.ts
\`\`\`
`,
        "/tmp/wave-5.md",
      ),
      { lane: "main" },
    );

    expect(wave.agents[0]?.executorResolved).toMatchObject({
      id: "codex",
      model: "gpt-5-codex",
      codex: {
        profileName: "review",
        config: ["model_reasoning_effort=high", "model_verbosity=low"],
        search: true,
        images: ["docs/mock-ui.png"],
        addDirs: ["../shared", "../infra"],
        json: true,
        ephemeral: true,
      },
    });
    expect(wave.agents[1]?.executorResolved).toMatchObject({
      id: "claude",
      claude: {
        settingsJson: {
          permissions: {
            allow: ["Read"],
          },
        },
        hooksJson: {
          Stop: [{ command: "echo stop" }],
        },
        allowedHttpHookUrls: ["https://example.com/hook"],
      },
    });
    expect(wave.agents[2]?.executorResolved).toMatchObject({
      id: "opencode",
      opencode: {
        files: ["docs/runtime.md", "README.md"],
        configJson: {
          plugins: ["./plugins/runtime.mjs"],
        },
      },
    });
  });
});

describe("buildExecutorLaunchSpec", () => {
  it("builds a Codex invocation with advanced runtime flags", () => {
    const dir = registerTempPath(fs.mkdtempSync(path.join(os.tmpdir(), "wave-executor-codex-")));
    const promptPath = path.join(dir, "prompt.md");
    const logPath = path.join(dir, "agent.log");
    const overlayDir = path.join(dir, "codex");
    fs.writeFileSync(promptPath, "Prompt body\n", "utf8");

    const spec = buildExecutorLaunchSpec({
      agent: {
        agentId: "A0",
        title: "Codex Reviewer",
        executorResolved: {
          id: "codex",
          model: "gpt-5-codex",
          codex: {
            command: "codex",
            sandbox: "workspace-write",
            profileName: "review",
            config: ["model_reasoning_effort=high", "model_verbosity=low"],
            search: true,
            images: ["docs/mock-ui.png"],
            addDirs: ["../shared"],
            json: true,
            ephemeral: true,
          },
          claude: null,
          opencode: null,
        },
      },
      promptPath,
      logPath,
      overlayDir,
    });

    expect(spec.executorId).toBe("codex");
    const invocation = spec.invocationLines.join("\n");
    expect(invocation).toContain("codex --ask-for-approval never exec");
    expect(invocation).toContain("--model 'gpt-5-codex'");
    expect(invocation).toContain("--profile 'review'");
    expect(invocation).toContain("-c 'model_reasoning_effort=high'");
    expect(invocation).toContain("-c 'model_verbosity=low'");
    expect(invocation).toContain("--search");
    expect(invocation).toContain("--image 'docs/mock-ui.png'");
    expect(invocation).toContain("--add-dir '../shared'");
    expect(invocation).toContain("--json");
    expect(invocation).toContain("--ephemeral");
  });

  it("writes a Claude overlay file and builds a headless invocation", () => {
    const dir = registerTempPath(fs.mkdtempSync(path.join(os.tmpdir(), "wave-executor-claude-")));
    const promptPath = path.join(dir, "prompt.md");
    const logPath = path.join(dir, "agent.log");
    const overlayDir = path.join(dir, "claude");
    const baseSettingsPath = path.join(dir, "claude-base-settings.json");
    fs.writeFileSync(promptPath, "Prompt body\n", "utf8");
    fs.writeFileSync(
      baseSettingsPath,
      JSON.stringify(
        {
          permissions: {
            deny: ["Bash(rm -rf *)"],
          },
          hooks: {
            SessionStart: [{ command: "echo start" }],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

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
            settings: baseSettingsPath,
            settingsJson: {
              permissions: {
                allow: ["Read"],
              },
            },
            hooksJson: {
              Stop: [{ command: "echo stop" }],
            },
            allowedHttpHookUrls: ["https://example.com/hooks"],
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
    const settings = JSON.parse(
      fs.readFileSync(path.join(overlayDir, "claude-settings.json"), "utf8"),
    );
    expect(settings).toMatchObject({
      permissions: {
        deny: ["Bash(rm -rf *)"],
        allow: ["Read"],
      },
      hooks: {
        SessionStart: [{ command: "echo start" }],
        Stop: [{ command: "echo stop" }],
      },
      allowedHttpHookUrls: ["https://example.com/hooks"],
    });
    const invocation = spec.invocationLines.join("\n");
    expect(invocation).toContain("claude -p --no-session-persistence");
    expect(invocation).toContain("--append-system-prompt-file");
    expect(invocation).toContain(`--settings '${path.join(overlayDir, "claude-settings.json")}'`);
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
            files: ["docs/runtime.md", "README.md"],
            format: "json",
            steps: 5,
            instructions: ["docs/reference/repository-guidance.md"],
            permission: {
              edit: "ask",
            },
            configJson: {
              plugins: ["./plugins/runtime.mjs"],
              provider: {
                anthropic: {
                  options: {
                    temperature: 0.1,
                  },
                },
              },
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
    expect(config.plugins).toEqual(["./plugins/runtime.mjs"]);
    expect(config.provider).toMatchObject({
      anthropic: {
        options: {
          temperature: 0.1,
        },
      },
    });
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
    expect(invocation).toContain("--file 'docs/runtime.md'");
    expect(invocation).toContain("--file 'README.md'");
    expect(invocation).toContain("--format 'json'");
  });
});
