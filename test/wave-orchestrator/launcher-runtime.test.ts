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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("launchAgentSession", () => {
  it("wraps rate-limit aware executors in the retry shell loop", async () => {
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
        spawnRunnerFn: (payload) => {
          captured.push(payload);
          return { runnerPid: 1001, payloadPath: payload.payloadPath };
        },
      },
    );

    expect(captured).toHaveLength(1);
    const command = captured[0].command;
    expect(command).toContain("max_rate_attempts=3");
    expect(command).toContain('while [ "$rate_attempt" -le "$max_rate_attempts" ]; do');
    expect(command).toContain("attempt_log_offset=$(wc -c <");
    expect(command).toContain("tail -c +$((attempt_log_offset + 1))");
    expect(command).toContain("grep -Eqi");
    expect(command).toContain("rate-limit detected for A1");
    expect(command).toContain("sleep_seconds=$((rate_delay_base * (2 ** (rate_attempt - 1))))");
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
        spawnRunnerFn: () => ({ runnerPid: 1002 }),
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

  it("threads supervisor runtime metadata into the launched shell wrapper", async () => {
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
    const captured = [];

    const result = await launchAgentSession(
      lanePaths,
      {
        wave: 0,
        attempt: 2,
        agent,
        sessionName: "wave-a1",
        promptPath: path.join(dir, "prompts", "wave-a1.prompt.md"),
        logPath: path.join(dir, "logs", "wave-a1.log"),
        statusPath: path.join(dir, "status", "wave-a1.status.json"),
        runtimePath: path.join(dir, "supervisor", "runs", "run-1", "agents", "A1.runtime.json"),
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
        spawnRunnerFn: (payload) => {
          captured.push(payload);
          return { runnerPid: 1003, payloadPath: payload.payloadPath };
        },
      },
    );

    expect(result.runtimePath).toContain(path.join("run-1", "agents", "A1.runtime.json"));
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      runtimePath: expect.stringContaining(path.join("run-1", "agents", "A1.runtime.json")),
      sessionName: "wave-a1",
      executorId: "codex",
    });
    expect(captured[0].command).toContain("set -o pipefail");
    expect(captured[0].command).toContain("WAVE_EXECUTOR_MODE");
  });
});
