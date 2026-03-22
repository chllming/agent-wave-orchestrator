import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExecutorLaunchSpec } from "../../scripts/wave-orchestrator/executors.mjs";
import {
  resolveAgentSkills,
  validateLaneSkillConfiguration,
  writeResolvedSkillArtifacts,
} from "../../scripts/wave-orchestrator/skills.mjs";

const tempPaths = [];

function registerTempPath(targetPath) {
  tempPaths.push(targetPath);
  return targetPath;
}

function repoRelative(targetPath) {
  return path.relative(process.cwd(), targetPath).replaceAll(path.sep, "/");
}

function makeAgent(runtimeId, role, extra = {}) {
  return {
    agentId: extra.agentId || "A0",
    skills: extra.skills || [],
    executorResolved: {
      id: runtimeId,
      role,
      ...extra.executorResolved,
    },
    ...extra,
  };
}

function makeLaneProfile(overrides = {}) {
  const base = {
    skills: {
      dir: "skills",
      base: ["wave-core", "repo-coding-rules"],
      byRole: {
        implementation: ["role-implementation"],
        integration: ["role-integration"],
        documentation: ["role-documentation"],
        "cont-qa": ["role-cont-qa"],
        "cont-eval": ["role-cont-eval"],
        security: ["role-security"],
        infra: ["role-infra"],
        deploy: ["role-deploy"],
        research: ["role-research"],
      },
      byRuntime: {
        codex: ["runtime-codex"],
        claude: ["runtime-claude"],
        opencode: ["runtime-opencode"],
        local: ["runtime-local"],
      },
      byDeployKind: {
        "railway-cli": ["provider-railway"],
        "railway-mcp": ["provider-railway"],
        "docker-compose": ["provider-docker-compose"],
        kubernetes: ["provider-kubernetes"],
        aws: ["provider-aws"],
        "github-release": ["provider-github-release"],
        "ssh-manual": ["provider-ssh-manual"],
        custom: ["provider-custom-deploy"],
      },
    },
  };
  return {
    ...base,
    ...overrides,
    skills: {
      ...base.skills,
      ...(overrides.skills || {}),
      byRole: {
        ...base.skills.byRole,
        ...(overrides.skills?.byRole || {}),
      },
      byRuntime: {
        ...base.skills.byRuntime,
        ...(overrides.skills?.byRuntime || {}),
      },
      byDeployKind: {
        ...base.skills.byDeployKind,
        ...(overrides.skills?.byDeployKind || {}),
      },
    },
  };
}

afterEach(() => {
  for (const targetPath of tempPaths.splice(0)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

describe("skill resolution", () => {
  it("layers base, role, runtime, deploy-kind, and explicit agent skills with metadata-first prompts", () => {
    const resolved = resolveAgentSkills(
      makeAgent("claude", "deploy", {
        agentId: "A7",
        skills: ["provider-github-release"],
      }),
      {
        deployEnvironments: [{ id: "prod", kind: "railway-cli", isDefault: true }],
      },
      { laneProfile: makeLaneProfile() },
    );

    expect(resolved.ids).toEqual([
      "wave-core",
      "repo-coding-rules",
      "role-deploy",
      "runtime-claude",
      "provider-railway",
      "provider-github-release",
    ]);
    expect(resolved.runtime).toBe("claude");
    expect(resolved.deployKind).toBe("railway-cli");
    expect(resolved.promptText).toContain("Active skill packs for this run:");
    expect(resolved.promptText).toContain("## Skill provider-railway");
    expect(resolved.promptText).toContain("- Canonical instructions: skills/provider-railway/SKILL.md");
    expect(resolved.promptText).toContain(
      "- Runtime adapter (claude): skills/provider-railway/adapters/claude.md",
    );
    expect(resolved.expandedPromptText).toContain(
      "### claude adapter (skills/provider-railway/adapters/claude.md)",
    );
  });

  it("auto-attaches provider skills only for allowed roles and keeps explicit per-agent overrides", () => {
    const laneProfile = makeLaneProfile();
    const railwayWave = {
      deployEnvironments: [{ id: "prod", kind: "railway-cli", isDefault: true }],
    };

    expect(
      resolveAgentSkills(makeAgent("opencode", "deploy"), railwayWave, { laneProfile }).ids,
    ).toContain("provider-railway");
    expect(
      resolveAgentSkills(makeAgent("claude", "integration"), railwayWave, { laneProfile }).ids,
    ).toContain("provider-railway");
    expect(
      resolveAgentSkills(makeAgent("claude", "cont-qa"), railwayWave, { laneProfile }).ids,
    ).toContain("provider-railway");
    expect(
      resolveAgentSkills(makeAgent("opencode", "documentation"), railwayWave, { laneProfile }).ids,
    ).not.toContain("provider-railway");
    expect(
      resolveAgentSkills(makeAgent("codex", "implementation"), railwayWave, { laneProfile }).ids,
    ).not.toContain("provider-railway");
    expect(
      resolveAgentSkills(
        makeAgent("opencode", "documentation", {
          skills: ["provider-railway"],
        }),
        railwayWave,
        { laneProfile },
      ).ids,
    ).toContain("provider-railway");
  });

  it("validates bundle loading, evaluates shipped routing cases, and rejects unsupported deploy-kind selectors", () => {
    expect(
      validateLaneSkillConfiguration(makeLaneProfile(), {
        allowedDeployKinds: ["railway-cli", "railway-mcp"],
      }),
    ).toMatchObject({
      ok: true,
      evaluatedBundles: expect.any(Number),
      evaluatedCases: expect.any(Number),
    });
    expect(
      validateLaneSkillConfiguration(
        makeLaneProfile({
          skills: {
            base: ["missing-skill"],
          },
        }),
      ),
    ).toMatchObject({
      ok: false,
    });
    expect(
      validateLaneSkillConfiguration(
        makeLaneProfile({
          skills: {
            byDeployKind: {
              railawy: ["provider-railway"],
            },
          },
        }),
        {
          allowedDeployKinds: ["railway-cli", "railway-mcp"],
        },
      ),
    ).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("skills.byDeployKind.railawy")],
    });
  });

  it("lists runtime adapters in the compact prompt and preserves full adapter bodies in the expanded artifact", () => {
    const laneProfile = makeLaneProfile();
    const contQaSkills = resolveAgentSkills(makeAgent("claude", "cont-qa", { agentId: "A0" }), {}, {
      laneProfile,
    });
    const contEvalSkills = resolveAgentSkills(
      makeAgent("codex", "cont-eval", { agentId: "E0" }),
      {},
      { laneProfile },
    );

    expect(contQaSkills.ids).toContain("role-cont-qa");
    expect(contQaSkills.promptText).toContain("## Skill role-cont-qa");
    expect(contQaSkills.promptText).toContain(
      "- Runtime adapter (claude): skills/role-cont-qa/adapters/claude.md",
    );
    expect(contQaSkills.expandedPromptText).toContain(
      "### claude adapter (skills/role-cont-qa/adapters/claude.md)",
    );

    expect(contEvalSkills.ids).toContain("role-cont-eval");
    expect(contEvalSkills.promptText).toContain("## Skill role-cont-eval");
    expect(contEvalSkills.promptText).toContain(
      "- Runtime adapter (codex): skills/role-cont-eval/adapters/codex.md",
    );
    expect(contEvalSkills.expandedPromptText).toContain(
      "### codex adapter (skills/role-cont-eval/adapters/codex.md)",
    );
  });

  it("attaches the security role skill for security reviewers", () => {
    const laneProfile = makeLaneProfile();
    const resolved = resolveAgentSkills(makeAgent("claude", "security", { agentId: "A7" }), {}, {
      laneProfile,
    });

    expect(resolved.ids).toContain("role-security");
  });
});

describe("skill runtime projection", () => {
  it("writes compact and expanded artifacts and projects manifests, adapters, and references into executor launch specs", () => {
    const overlayDir = registerTempPath(
      fs.mkdtempSync(path.join(os.tmpdir(), "wave-skill-overlay-")),
    );
    const laneProfile = makeLaneProfile();
    const wave = {
      deployEnvironments: [{ id: "prod", kind: "railway-cli", isDefault: true }],
    };

    const codexAgent = {
      agentId: "A1",
      title: "Deploy Worker",
      executorResolved: {
        id: "codex",
        role: "deploy",
        codex: {
          command: "codex",
          sandbox: "danger-full-access",
          profileName: null,
          config: [],
          search: false,
          images: [],
          addDirs: [],
          json: false,
          ephemeral: false,
        },
      },
    };
    const claudeAgent = {
      agentId: "A2",
      title: "Deploy Review",
      executorResolved: {
        id: "claude",
        role: "deploy",
        model: "claude-sonnet-4-6",
        claude: {
          command: "bash",
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
      },
    };
    const opencodeAgent = {
      agentId: "A3",
      title: "Deploy Docs",
      executorResolved: {
        id: "opencode",
        role: "deploy",
        model: "anthropic/claude-sonnet-4-20250514",
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
    };

    const codexSkills = resolveAgentSkills(codexAgent, wave, { laneProfile });
    codexAgent.skillsResolved = codexSkills;
    const claudeSkills = resolveAgentSkills(claudeAgent, wave, { laneProfile });
    claudeAgent.skillsResolved = claudeSkills;
    const opencodeSkills = resolveAgentSkills(opencodeAgent, wave, { laneProfile });
    opencodeAgent.skillsResolved = opencodeSkills;

    const codexArtifacts = writeResolvedSkillArtifacts(path.join(overlayDir, "codex"), codexSkills);
    const claudeArtifacts = writeResolvedSkillArtifacts(path.join(overlayDir, "claude"), claudeSkills);
    const opencodeArtifacts = writeResolvedSkillArtifacts(
      path.join(overlayDir, "opencode"),
      opencodeSkills,
    );
    expect(codexArtifacts?.promptPath).toContain("skills.resolved.md");
    expect(codexArtifacts?.expandedPromptPath).toContain("skills.expanded.md");
    expect(claudeArtifacts?.runtimePromptPath).toContain("claude-skills.txt");
    expect(opencodeArtifacts?.runtimePromptPath).toContain("opencode-skills.txt");
    const codexMetadata = JSON.parse(
      fs.readFileSync(path.join(overlayDir, "codex", "skills.metadata.json"), "utf8"),
    );
    expect(codexMetadata.artifacts).toMatchObject(codexArtifacts);
    expect(
      fs.readFileSync(path.join(overlayDir, "codex", "skills.resolved.md"), "utf8"),
    ).toContain("Use this catalog first.");
    expect(
      fs.readFileSync(path.join(overlayDir, "codex", "skills.expanded.md"), "utf8"),
    ).toContain("### Canonical instructions");

    const codexSpec = buildExecutorLaunchSpec({
      agent: codexAgent,
      promptPath: path.join(overlayDir, "codex", "prompt.md"),
      logPath: path.join(overlayDir, "codex", "log.txt"),
      overlayDir: path.join(overlayDir, "codex"),
      skillProjection: codexSkills,
    });
    expect(codexSpec.invocationLines[0]).toContain("skills/provider-railway");

    buildExecutorLaunchSpec({
      agent: claudeAgent,
      promptPath: path.join(overlayDir, "claude", "prompt.md"),
      logPath: path.join(overlayDir, "claude", "log.txt"),
      overlayDir: path.join(overlayDir, "claude"),
      skillProjection: claudeSkills,
    });
    expect(
      fs.readFileSync(path.join(overlayDir, "claude", "claude-system-prompt.txt"), "utf8"),
    ).toContain("- Canonical instructions: skills/provider-railway/SKILL.md");

    const opencodeSpec = buildExecutorLaunchSpec({
      agent: opencodeAgent,
      promptPath: path.join(overlayDir, "opencode", "prompt.md"),
      logPath: path.join(overlayDir, "opencode", "log.txt"),
      overlayDir: path.join(overlayDir, "opencode"),
      skillProjection: opencodeSkills,
    });
    expect(opencodeSpec.invocationLines.join("\n")).toContain("skills/provider-railway/skill.json");
    expect(opencodeSpec.invocationLines.join("\n")).toContain(
      "skills/provider-railway/references/verification-commands.md",
    );
    const opencodeConfig = JSON.parse(
      fs.readFileSync(path.join(overlayDir, "opencode", "opencode.json"), "utf8"),
    );
    expect(opencodeConfig.instructions.join("\n")).toContain("Use this catalog first.");
  });

  it("includes nested reference files in OpenCode attachments", () => {
    fs.mkdirSync(path.join(process.cwd(), ".tmp"), { recursive: true });
    const tempRoot = registerTempPath(
      fs.mkdtempSync(path.join(path.join(process.cwd(), ".tmp"), "wave-skill-recursive-")),
    );
    const skillsDir = path.join(tempRoot, "skills");
    const bundleDir = path.join(skillsDir, "nested-skill");
    fs.mkdirSync(path.join(bundleDir, "references", "deep"), { recursive: true });
    fs.mkdirSync(path.join(bundleDir, "adapters"), { recursive: true });
    fs.writeFileSync(
      path.join(bundleDir, "skill.json"),
      `${JSON.stringify(
        {
          id: "nested-skill",
          title: "Nested Skill",
          description: "Test fixture for recursive references.",
          activation: {
            when: "Attach when explicitly requested in tests.",
            roles: [],
            runtimes: [],
            deployKinds: [],
          },
          termination: "Stop when the recursive reference projection has been validated.",
          permissions: {
            network: [],
            shell: [],
            mcpServers: [],
          },
          trust: {
            tier: "repo-owned",
          },
          evalCases: [
            {
              id: "explicit-opencode",
              role: "research",
              runtime: "opencode",
              expectActive: true,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(bundleDir, "SKILL.md"), "# Nested Skill\n", "utf8");
    fs.writeFileSync(path.join(bundleDir, "adapters", "opencode.md"), "Use nested refs.\n", "utf8");
    fs.writeFileSync(
      path.join(bundleDir, "references", "deep", "failure-modes.md"),
      "# Failure Modes\n",
      "utf8",
    );

    const resolved = resolveAgentSkills(
      makeAgent("opencode", "research", {
        skills: ["nested-skill"],
      }),
      {},
      {
        laneProfile: {
          skills: {
            dir: repoRelative(skillsDir),
            base: [],
            byRole: {},
            byRuntime: {},
            byDeployKind: {},
          },
        },
      },
    );

    expect(resolved.opencodeFiles).toContain(
      `${repoRelative(skillsDir)}/nested-skill/references/deep/failure-modes.md`,
    );
  });
});
