import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadWaveConfig,
  resolveLaneProfile,
  resolveProjectProfile,
} from "../../scripts/wave-orchestrator/config.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-config-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime configuration normalization", () => {
  it("rejects an explicit unknown project instead of falling back to the default project", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultProject: "app",
          projects: {
            app: {
              projectName: "App",
              rootDir: ".",
              lanes: {
                main: {},
              },
            },
            service: {
              projectName: "Service",
              rootDir: "services/api",
              lanes: {
                main: {},
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    expect(() => resolveProjectProfile(config, "typo-project")).toThrow(
      /Unknown project: typo-project/,
    );
  });

  it("resolves project-level path overrides into the lane profile", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultProject: "app",
          projects: {
            app: {
              rootDir: ".",
              lanes: {
                main: {},
              },
            },
            service: {
              rootDir: "services/api",
              paths: {
                docsDir: "services/api/custom-docs",
                stateRoot: ".tmp/service-state",
                orchestratorStateDir: ".tmp/service-orchestrator",
                terminalsPath: ".vscode/service-terminals.json",
                context7BundleIndexPath: "services/api/custom-docs/context7/bundles.json",
                benchmarkCatalogPath: "services/api/custom-docs/evals/benchmark-catalog.json",
                componentCutoverMatrixDocPath:
                  "services/api/custom-docs/plans/custom-component-cutover.md",
                componentCutoverMatrixJsonPath:
                  "services/api/custom-docs/plans/custom-component-cutover.json",
              },
              lanes: {
                main: {},
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lane = resolveLaneProfile(config, "main", "service");

    expect(lane.docsDir).toBe("services/api/custom-docs");
    expect(lane.plansDir).toBe("services/api/custom-docs/plans");
    expect(lane.wavesDir).toBe("services/api/custom-docs/plans/waves");
    expect(lane.paths).toMatchObject({
      stateRoot: ".tmp/service-state",
      orchestratorStateDir: ".tmp/service-orchestrator",
      terminalsPath: ".vscode/service-terminals.json",
      context7BundleIndexPath: "services/api/custom-docs/context7/bundles.json",
      benchmarkCatalogPath: "services/api/custom-docs/evals/benchmark-catalog.json",
      componentCutoverMatrixDocPath:
        "services/api/custom-docs/plans/custom-component-cutover.md",
      componentCutoverMatrixJsonPath:
        "services/api/custom-docs/plans/custom-component-cutover.json",
    });
  });

  it("derives project default cutover paths from a project docs override", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultProject: "app",
          projects: {
            app: {
              rootDir: ".",
              lanes: {
                main: {},
              },
            },
            service: {
              rootDir: "services/api",
              paths: {
                docsDir: "services/api/custom-docs",
              },
              lanes: {
                main: {},
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lane = resolveLaneProfile(config, "main", "service");

    expect(lane.docsDir).toBe("services/api/custom-docs");
    expect(lane.paths.componentCutoverMatrixDocPath).toBe(
      "services/api/custom-docs/plans/component-cutover-matrix.md",
    );
    expect(lane.paths.componentCutoverMatrixJsonPath).toBe(
      "services/api/custom-docs/plans/component-cutover-matrix.json",
    );
  });

  it("loads and resolves advanced runtime settings from wave.config.json", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultLane: "main",
          skills: {
            dir: "skills",
            base: ["wave-core"],
            byRole: {
              implementation: ["role-implementation"],
              security: ["role-security"],
            },
            byRuntime: {
              codex: ["runtime-codex"],
            },
            byDeployKind: {
              "railway-cli": ["provider-railway"],
            },
          },
          executors: {
            default: "codex",
            profiles: {
              "deep-review": {
                id: "claude",
                model: "claude-sonnet-4-6",
                fallbacks: ["opencode"],
                tags: ["review"],
                budget: {
                  turns: 9,
                  minutes: 20,
                },
                claude: {
                  agent: "reviewer",
                  effort: "high",
                  permissionMode: "plan",
                  permissionPromptTool: "wave-feedback",
                  maxTurns: 7,
                  mcpConfig: [".tmp/review-mcp.json"],
                  strictMcpConfig: true,
                  settingsJson: {
                    permissions: {
                      allow: ["Read"],
                    },
                  },
                  hooksJson: {
                    Stop: [{ command: "echo stop" }],
                  },
                  allowedHttpHookUrls: ["https://example.com/hooks"],
                  outputFormat: "json",
                  allowedTools: ["Read"],
                  disallowedTools: ["Edit"],
                },
              },
            },
            codex: {
              command: "codex-beta",
              profileName: "implement",
              config: ["model_reasoning_effort=medium"],
              search: true,
              images: ["docs/mock-ui.png"],
              addDirs: ["../shared"],
              json: true,
              ephemeral: true,
              sandbox: "workspace-write",
            },
            claude: {
              command: "claude-beta",
              model: "claude-sonnet-4-6",
              agent: "default-reviewer",
              appendSystemPromptMode: "replace",
              effort: "medium",
              permissionMode: "plan",
              permissionPromptTool: "wave-feedback",
              maxTurns: 5,
              mcpConfig: [".tmp/default-mcp.json"],
              strictMcpConfig: true,
              settings: "config/claude-settings.json",
              settingsJson: {
                permissions: {
                  allow: ["Read"],
                },
              },
              hooksJson: {
                Stop: [{ command: "echo done" }],
              },
              allowedHttpHookUrls: ["https://example.com/default-hook"],
              outputFormat: "stream-json",
              allowedTools: ["Read"],
              disallowedTools: ["Edit"],
            },
            opencode: {
              command: "opencode-beta",
              model: "anthropic/claude-sonnet-4-20250514",
              agent: "ops-runner",
              attach: "docs/runtime.md",
              files: ["README.md"],
              format: "json",
              steps: 6,
              instructions: ["Keep findings concise."],
              permission: {
                task: "ask",
              },
              configJson: {
                plugins: ["./plugins/runtime.mjs"],
              },
            },
          },
          waveControl: {
            endpoint: "https://wave-control.example/api/v1",
            workspaceId: "wave-control-workspace",
            projectId: "wave-orchestration",
            authTokenEnvVar: "CUSTOM_WAVE_CONTROL_TOKEN",
            credentialProviders: ["openai"],
            credentials: [{ id: "github_pat", envVar: "GITHUB_TOKEN" }],
            uploadArtifactKinds: ["trace-quality", "trace-outcome"],
            requestTimeoutMs: 9000,
            flushBatchSize: 12,
          },
          lanes: {
            main: {
              waveControl: {
                credentialProviders: ["anthropic"],
                credentials: [{ id: "npm_token", envVar: "NPM_TOKEN" }],
                uploadArtifactKinds: ["trace-quality", "benchmark-results"],
                captureBenchmarkRuns: false,
              },
              skills: {
                base: ["repo-coding-rules"],
                byRuntime: {
                  claude: ["runtime-claude"],
                },
              },
              executors: {
                codex: {
                  config: ["model_reasoning_effort=high"],
                },
                claude: {
                  effort: "low",
                  allowedTools: ["Read", "Glob"],
                },
                opencode: {
                  files: ["docs/runtime.md"],
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lane = resolveLaneProfile(config, "main");

    expect(lane.executors.codex).toMatchObject({
      command: "codex-beta",
      profileName: "implement",
      config: ["model_reasoning_effort=high"],
      search: true,
      images: ["docs/mock-ui.png"],
      addDirs: ["../shared"],
      json: true,
      ephemeral: true,
      sandbox: "workspace-write",
    });
    expect(lane.executors.claude).toMatchObject({
      command: "claude-beta",
      model: "claude-sonnet-4-6",
      appendSystemPromptMode: "replace",
      effort: "low",
      permissionMode: "plan",
      permissionPromptTool: "wave-feedback",
      maxTurns: 5,
      mcpConfig: [".tmp/default-mcp.json"],
      strictMcpConfig: true,
      settings: "config/claude-settings.json",
      settingsJson: {
        permissions: {
          allow: ["Read"],
        },
      },
      hooksJson: {
        Stop: [{ command: "echo done" }],
      },
      allowedHttpHookUrls: ["https://example.com/default-hook"],
      outputFormat: "stream-json",
      allowedTools: ["Read", "Glob"],
      disallowedTools: ["Edit"],
    });
    expect(lane.executors.opencode).toMatchObject({
      command: "opencode-beta",
      model: "anthropic/claude-sonnet-4-20250514",
      agent: "ops-runner",
      attach: "docs/runtime.md",
      files: ["docs/runtime.md"],
      format: "json",
      steps: 6,
      instructions: ["Keep findings concise."],
      permission: {
        task: "ask",
      },
      configJson: {
        plugins: ["./plugins/runtime.mjs"],
      },
    });
    expect(lane.executors.profiles["deep-review"]).toMatchObject({
      id: "claude",
      model: "claude-sonnet-4-6",
      fallbacks: ["opencode"],
      tags: ["review"],
      budget: {
        turns: 9,
        minutes: 20,
      },
      claude: {
        agent: "reviewer",
        effort: "high",
        permissionMode: "plan",
        permissionPromptTool: "wave-feedback",
        maxTurns: 7,
        mcpConfig: [".tmp/review-mcp.json"],
        strictMcpConfig: true,
        settingsJson: {
          permissions: {
            allow: ["Read"],
          },
        },
        hooksJson: {
          Stop: [{ command: "echo stop" }],
        },
        allowedHttpHookUrls: ["https://example.com/hooks"],
        outputFormat: "json",
        allowedTools: ["Read"],
        disallowedTools: ["Edit"],
      },
    });
    expect(lane.skills).toEqual({
      dir: "skills",
      base: ["wave-core", "repo-coding-rules"],
      byRole: {
        implementation: ["role-implementation"],
        security: ["role-security"],
      },
      byRuntime: {
        claude: ["runtime-claude"],
        codex: ["runtime-codex"],
      },
      byDeployKind: {
        "railway-cli": ["provider-railway"],
      },
    });
    expect(lane.roles.securityRolePromptPath).toBe("docs/agents/wave-security-role.md");
    expect(config.waveControl).toMatchObject({
      enabled: true,
      endpoint: "https://wave-control.example/api/v1",
      workspaceId: "wave-control-workspace",
      projectId: "wave-orchestration",
      authTokenEnvVar: "CUSTOM_WAVE_CONTROL_TOKEN",
      authTokenEnvVars: ["CUSTOM_WAVE_CONTROL_TOKEN", "WAVE_CONTROL_AUTH_TOKEN"],
      credentialProviders: ["openai"],
      credentials: [{ id: "github_pat", envVar: "GITHUB_TOKEN" }],
      reportMode: "metadata-only",
      uploadArtifactKinds: ["trace-quality", "trace-outcome"],
      requestTimeoutMs: 9000,
      flushBatchSize: 12,
    });
    expect(lane.waveControl).toMatchObject({
      enabled: true,
      endpoint: "https://wave-control.example/api/v1",
      workspaceId: "wave-control-workspace",
      projectId: "default",
      credentialProviders: ["anthropic"],
      credentials: [{ id: "npm_token", envVar: "NPM_TOKEN" }],
      uploadArtifactKinds: ["trace-quality", "benchmark-results"],
      captureBenchmarkRuns: false,
    });
  });

  it("rejects unknown waveControl credential providers", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          waveControl: {
            credentialProviders: ["openai", "context7"],
          },
          lanes: {
            main: {},
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(() => loadWaveConfig(configPath)).toThrow(/waveControl\.credentialProviders\[1\]/);
  });

  it("normalizes waveControl credential env leases and rejects duplicate env vars", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          waveControl: {
            credentials: [
              { id: "github_pat", envVar: "GITHUB_TOKEN" },
              { id: "npm-token", envVar: "NPM_TOKEN" },
            ],
          },
          lanes: {
            main: {},
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    expect(config.waveControl.credentials).toEqual([
      { id: "github_pat", envVar: "GITHUB_TOKEN" },
      { id: "npm-token", envVar: "NPM_TOKEN" },
    ]);

    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          waveControl: {
            credentials: [
              { id: "github_pat", envVar: "GITHUB_TOKEN" },
              { id: "another", envVar: "GITHUB_TOKEN" },
            ],
          },
          lanes: {
            main: {},
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(() => loadWaveConfig(configPath)).toThrow(/duplicate envVar mappings/i);
  });

  it("normalizes external provider config with project and lane overrides", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultProject: "app",
          externalProviders: {
            context7: {
              mode: "broker",
            },
            corridor: {
              enabled: true,
              mode: "broker",
              severityThreshold: "high",
            },
          },
          projects: {
            app: {
              rootDir: ".",
              externalProviders: {
                corridor: {
                  mode: "direct",
                  teamId: "team-1",
                  projectId: "project-1",
                },
              },
              lanes: {
                main: {
                  externalProviders: {
                    context7: {
                      mode: "hybrid",
                    },
                  },
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lane = resolveLaneProfile(config, "main", "app");

    expect(lane.externalProviders).toMatchObject({
      context7: {
        mode: "hybrid",
        apiKeyEnvVar: "CONTEXT7_API_KEY",
      },
      corridor: {
        enabled: true,
        mode: "direct",
        teamId: "team-1",
        projectId: "project-1",
        severityThreshold: "high",
        requiredAtClosure: true,
      },
    });
  });

  it("preserves a global custom skills dir when lane skills omit dir", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultLane: "main",
          skills: {
            dir: "repo-skills",
            base: ["wave-core"],
          },
          lanes: {
            main: {
              skills: {
                byRole: {
                  implementation: ["role-implementation"],
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lane = resolveLaneProfile(config, "main");

    expect(lane.skills).toMatchObject({
      dir: "repo-skills",
      base: ["wave-core"],
      byRole: {
        implementation: ["role-implementation"],
      },
    });
  });

  it("rejects legacy evaluator role config keys", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultLane: "main",
          roles: {
            evaluatorAgentId: "A0",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(() => loadWaveConfig(configPath)).toThrow(
      /roles\.evaluatorAgentId was renamed to roles\.contQaAgentId/,
    );
  });

  it("rejects legacy evaluator role mappings in runtime policy and skills", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultLane: "main",
          skills: {
            byRole: {
              evaluator: ["role-cont-qa"],
            },
          },
          lanes: {
            main: {
              runtimePolicy: {
                defaultExecutorByRole: {
                  evaluator: "claude",
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(() => loadWaveConfig(configPath)).toThrow(/byRole\.evaluator was renamed to .*cont-qa/);
  });

  it("rejects unsupported role and runtime selector keys", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultLane: "main",
          skills: {
            byRole: {
              implemntation: ["role-implementation"],
            },
            byRuntime: {
              cluade: ["runtime-claude"],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(() => loadWaveConfig(configPath)).toThrow(/skills\.byRole\.implemntation/);
  });

  it("preserves deploy-kind selectors for doctor-time validation", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultLane: "main",
          skills: {
            byDeployKind: {
              railawy: ["provider-railway"],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    expect(resolveLaneProfile(config, "main").skills.byDeployKind.railawy).toEqual([
      "provider-railway",
    ]);
  });

  it("normalizes planner agentic defaults from wave.config.json", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultLane: "main",
          planner: {
            agentic: {
              executorProfile: "planning-readonly",
              defaultMaxWaves: 4,
              maxReplanIterations: 2,
              context7Bundle: "planner-agentic",
              context7Query: "Planner bundle query",
              coreContextPaths: ["AGENTS.md", "docs/roadmap.md"],
              lessonsPaths: ["docs/reference/wave-planning-lessons.md"],
              researchTopicPaths: ["docs/context7/planner-agent/topics/planning-and-orchestration.md"],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    expect(config.planner).toEqual({
      agentic: {
        executorProfile: "planning-readonly",
        defaultMaxWaves: 4,
        maxReplanIterations: 2,
        context7Bundle: "planner-agentic",
        context7Query: "Planner bundle query",
        coreContextPaths: ["AGENTS.md", "docs/roadmap.md"],
        lessonsPaths: ["docs/reference/wave-planning-lessons.md"],
        researchTopicPaths: ["docs/context7/planner-agent/topics/planning-and-orchestration.md"],
      },
    });
  });

  it("normalizes the optional design role prompt path", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          roles: {
            designRolePromptPath: "docs/agents/wave-design-role.md",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lane = resolveLaneProfile(config, "main");

    expect(config.roles.designRolePromptPath).toBe("docs/agents/wave-design-role.md");
    expect(lane.roles.designRolePromptPath).toBe("docs/agents/wave-design-role.md");
  });

  it("normalizes closure fast-path validation settings", () => {
    const repoDir = makeTempDir();
    const configPath = path.join(repoDir, "wave.config.json");
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultProject: "app",
          projects: {
            app: {
              rootDir: ".",
              lanes: {
                main: {
                  validation: {
                    closureModeThresholds: {
                      bootstrap: 0,
                      standard: 3,
                      strict: 8,
                    },
                    autoClosure: {
                      allowInferredIntegration: true,
                      allowAutoDocNoChange: true,
                      allowAutoDocProjection: true,
                      allowSkipContQaInBootstrap: true,
                    },
                  },
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lane = resolveLaneProfile(config, "main", "app");

    expect(lane.validation.closureModeThresholds).toEqual({
      bootstrap: 0,
      standard: 3,
      strict: 8,
    });
    expect(lane.validation.autoClosure).toEqual({
      allowInferredIntegration: true,
      allowAutoDocNoChange: true,
      allowAutoDocProjection: true,
      allowSkipContQaInBootstrap: true,
    });
  });
});
