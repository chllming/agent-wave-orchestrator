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

afterEach(() => {
  for (const targetPath of tempPaths.splice(0)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

function makeLaneProfile() {
  return {
    skills: {
      dir: "skills",
      base: ["wave-core", "repo-coding-rules"],
      byRole: {
        deploy: ["role-deploy"],
      },
      byRuntime: {
        codex: ["runtime-codex"],
        claude: ["runtime-claude"],
        opencode: ["runtime-opencode"],
      },
      byDeployKind: {
        "railway-cli": ["provider-railway"],
      },
    },
  };
}

describe("skill resolution", () => {
  it("layers base, role, runtime, deploy-kind, and explicit agent skills", () => {
    const resolved = resolveAgentSkills(
      {
        agentId: "A7",
        skills: ["provider-github-release"],
        executorResolved: {
          id: "claude",
          role: "deploy",
        },
      },
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
    expect(resolved.promptText).toContain("## Skill provider-railway");
    expect(resolved.promptText).toContain("### claude adapter");
  });

  it("validates configured starter skill references", () => {
    expect(validateLaneSkillConfiguration(makeLaneProfile())).toMatchObject({ ok: true });
    expect(
      validateLaneSkillConfiguration({
        skills: {
          ...makeLaneProfile().skills,
          base: ["missing-skill"],
        },
      }),
    ).toMatchObject({
      ok: false,
    });
  });
});

describe("skill runtime projection", () => {
  it("writes skill artifacts and projects them into codex, claude, and opencode launch specs", () => {
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
    const opencodeArtifacts = writeResolvedSkillArtifacts(path.join(overlayDir, "opencode"), opencodeSkills);
    expect(codexArtifacts?.promptPath).toContain("skills.resolved.md");
    expect(claudeArtifacts?.runtimePromptPath).toContain("claude-skills.txt");
    expect(opencodeArtifacts?.runtimePromptPath).toContain("opencode-skills.txt");
    const codexMetadata = JSON.parse(
      fs.readFileSync(path.join(overlayDir, "codex", "skills.metadata.json"), "utf8"),
    );
    expect(codexMetadata.artifacts).toMatchObject(codexArtifacts);

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
    ).toContain("provider-railway");

    buildExecutorLaunchSpec({
      agent: opencodeAgent,
      promptPath: path.join(overlayDir, "opencode", "prompt.md"),
      logPath: path.join(overlayDir, "opencode", "log.txt"),
      overlayDir: path.join(overlayDir, "opencode"),
      skillProjection: opencodeSkills,
    });
    const opencodeConfig = JSON.parse(
      fs.readFileSync(path.join(overlayDir, "opencode", "opencode.json"), "utf8"),
    );
    expect(opencodeConfig.instructions.join("\n")).toContain("provider-railway");
  });
});
