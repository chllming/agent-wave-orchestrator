import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchAgentSession } from "../../scripts/wave-orchestrator/launcher-runtime.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-launcher-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function makeFakeTmuxBin(dir) {
  const binDir = path.join(dir, "bin");
  const tmuxPath = path.join(binDir, "tmux");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    tmuxPath,
    "#!/usr/bin/env bash\necho \"can't find session\" >&2\nexit 1\n",
    { encoding: "utf8", mode: 0o755 },
  );
  return binDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("launchAgentSession", () => {
  it("wraps rate-limit aware executors in the retry shell loop", async () => {
    const dir = makeTempDir();
    const fakeTmuxDir = makeFakeTmuxBin(dir);
    const originalPath = process.env.PATH || "";
    process.env.PATH = `${fakeTmuxDir}:${originalPath}`;

    try {
      const lanePaths = {
        lane: "main",
        tmuxSocketName: "test-socket",
        context7CacheDir: path.join(dir, "context7"),
        executorOverlaysDir: path.join(dir, "overlays"),
        laneProfile: { skills: { dir: "skills", base: [], byRole: {}, byRuntime: {}, byDeployKind: {} } },
        sharedPlanDocs: [],
        contQaAgentId: "A0",
        contEvalAgentId: "E0",
        integrationAgentId: "A8",
        documentationAgentId: "A9",
      };
      const agent = {
        agentId: "A1",
        slug: "0-a1",
        title: "Implementation",
        prompt: "Ship the assigned implementation safely.",
        context7Resolved: {
          bundleId: "none",
          libraries: [],
        },
        executorResolved: {
          id: "codex",
          model: "gpt-5-codex",
          codex: {
            command: "codex",
            sandbox: "workspace-write",
            profileName: "review",
            config: [],
            search: false,
            images: [],
            addDirs: [],
            json: false,
            ephemeral: false,
          },
        },
      };
      const captured = [];

      await launchAgentSession(
        lanePaths,
        {
          wave: 0,
          agent,
          sessionName: "wave-a1",
          promptPath: path.join(dir, "prompts", "wave-a1.prompt.md"),
          logPath: path.join(dir, "logs", "wave-a1.log"),
          statusPath: path.join(dir, "status", "wave-a1.status.json"),
          messageBoardPath: path.join(dir, "messageboards", "wave-0.md"),
          messageBoardSnapshot: "",
          sharedSummaryPath: path.join(dir, "inboxes", "shared.md"),
          sharedSummaryText: "",
          inboxPath: path.join(dir, "inboxes", "A1.md"),
          inboxText: "",
          orchestratorId: "orch",
          agentRateLimitRetries: 2,
          agentRateLimitBaseDelaySeconds: 5,
          agentRateLimitMaxDelaySeconds: 30,
          context7Enabled: false,
        },
        {
          runTmuxFn: (_lanePaths, args) => {
            captured.push(args);
          },
        },
      );

      expect(captured).toHaveLength(1);
      const command = captured[0][4];
      expect(command).toContain("max_rate_attempts=3");
      expect(command).toContain('while [ \"$rate_attempt\" -le \"$max_rate_attempts\" ]; do');
      expect(command).toContain("tail -n 120");
      expect(command).toContain("grep -Eqi");
      expect(command).toContain("rate-limit detected for A1");
      expect(command).toContain("sleep_seconds=$((rate_delay_base * (2 ** (rate_attempt - 1))))");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("writes launch-preview.json for live launches before tmux attach", async () => {
    const dir = makeTempDir();
    const lanePaths = {
      lane: "main",
      tmuxSocketName: "test-socket",
      context7CacheDir: path.join(dir, "context7"),
      executorOverlaysDir: path.join(dir, "overlays"),
      laneProfile: { skills: { dir: "skills", base: [], byRole: {}, byRuntime: {}, byDeployKind: {} } },
      sharedPlanDocs: [],
      contQaAgentId: "A0",
      contEvalAgentId: "E0",
      integrationAgentId: "A8",
      documentationAgentId: "A9",
    };
    const agent = {
      agentId: "A1",
      slug: "0-a1",
      title: "Implementation",
      prompt: "Ship the assigned implementation safely.",
      context7Resolved: {
        bundleId: "none",
        libraries: [],
      },
      executorResolved: {
        id: "codex",
        model: "gpt-5-codex",
        codex: {
          command: "codex",
          sandbox: "workspace-write",
          profileName: "review",
          config: [],
          search: false,
          images: [],
          addDirs: [],
          json: false,
          ephemeral: false,
        },
      },
    };

    await launchAgentSession(
      lanePaths,
      {
        wave: 0,
        agent,
        sessionName: "wave-a1",
        promptPath: path.join(dir, "prompts", "wave-a1.prompt.md"),
        logPath: path.join(dir, "logs", "wave-a1.log"),
        statusPath: path.join(dir, "status", "wave-a1.status.json"),
        messageBoardPath: path.join(dir, "messageboards", "wave-0.md"),
        messageBoardSnapshot: "",
        sharedSummaryPath: path.join(dir, "inboxes", "shared.md"),
        sharedSummaryText: "",
        inboxPath: path.join(dir, "inboxes", "A1.md"),
        inboxText: "",
        orchestratorId: "orch",
        context7Enabled: false,
      },
      {
        runTmuxFn: () => {},
      },
    );

    const previewPath = path.join(dir, "overlays", "wave-0", "0-a1", "launch-preview.json");
    expect(fs.existsSync(previewPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(previewPath, "utf8"))).toMatchObject({
      executorId: "codex",
      command: "codex",
      useRateLimitRetries: true,
      invocationLines: expect.any(Array),
      limits: {
        turnLimitSource: "not-set-by-wave",
      },
    });
  });
});
