import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLauncherLock,
  buildCodexExecInvocation,
  collectUnexpectedSessionFailures,
  DEFAULT_CODEX_SANDBOX_MODE,
  hasReusableSuccessStatus,
    markLauncherFailed,
    reconcileStaleLauncherArtifacts,
    readWaveComponentMatrixGate,
    releaseLauncherLock,
    readWaveComponentGate,
    readWaveEvaluatorGate,
  readWaveInfraGate,
} from "../../scripts/wave-orchestrator/launcher.mjs";
import { hashAgentPromptFingerprint } from "../../scripts/wave-orchestrator/context7.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-launcher-"));
  tempDirs.push(dir);
  return dir;
}

function makeLanePaths(dir) {
  const dashboardsDir = path.join(dir, "dashboards");
  fs.mkdirSync(dashboardsDir, { recursive: true });
  return {
    lane: "leap-claw",
    launcherLockPath: path.join(dir, "launcher.lock"),
    globalDashboardPath: path.join(dashboardsDir, "global.json"),
    dashboardsDir,
    terminalsPath: path.join(dir, "terminals.json"),
    terminalNamePrefix: "leap-claw-wave",
    dashboardTerminalNamePrefix: "leap-claw-wave-dashboard",
    globalDashboardTerminalName: "leap-claw-wave-dashboard-global",
    tmuxSessionPrefix: "oc_leap_claw_wave",
    tmuxDashboardSessionPrefix: "oc_leap_claw_wave_dashboard",
    tmuxGlobalDashboardSessionPrefix: "oc_leap_claw_wave_dashboard_global",
    tmuxSocketName: `test-${path.basename(dir)}`,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readWaveEvaluatorGate", () => {
  it("prefers structured evaluator summaries when present", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-6-evaluator.md");
    const logPath = path.join(dir, "wave-6-a0.log");
    const statusPath = path.join(dir, "wave-6-a0.status");
    const summaryPath = path.join(dir, "wave-6-a0.summary.json");

    fs.writeFileSync(reportPath, "# Review\n\nVerdict: PASS\n", "utf8");
    fs.writeFileSync(logPath, "[wave-verdict] pass detail=legacy-pass\n", "utf8");
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "hash" }, null, 2), "utf8");
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          agentId: "A0",
          verdict: { verdict: "pass", detail: "final closure sweep" },
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
            detail: "final closure sweep",
          },
          logPath,
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      readWaveEvaluatorGate(
        {
          evaluatorReportPath: reportPath,
        },
        [
          {
            agent: { agentId: "A0" },
            logPath,
            statusPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
      detail: "final closure sweep",
    });
  });

  it("normalizes legacy HOLD verdicts from evaluator reports", () => {
    const dir = makeTempDir();
    const reportPath = path.join(dir, "wave-0-evaluator.md");
    const logPath = path.join(dir, "wave-0-a0.log");

    fs.writeFileSync(reportPath, "# Review\n\nVerdict: HOLD - waiting on QA\n", "utf8");
    fs.writeFileSync(logPath, "", "utf8");

    expect(
      readWaveEvaluatorGate(
        {
          evaluatorReportPath: reportPath,
        },
        [
          {
            agent: { agentId: "A0" },
            logPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: false,
      agentId: "A0",
      statusCode: "evaluator-concerns",
      detail: "waiting on QA",
    });
  });

  it("falls back to wave verdict markers in the evaluator log", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-0-a0.log");

    fs.writeFileSync(logPath, "[wave-verdict] fail detail=tests-broken\n", "utf8");

    expect(
      readWaveEvaluatorGate(
        {
          evaluatorReportPath: path.join(dir, "missing.md"),
        },
        [
          {
            agent: { agentId: "A0" },
            logPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: false,
      agentId: "A0",
      statusCode: "evaluator-blocked",
      detail: "tests-broken",
    });
  });
});

describe("readWaveInfraGate", () => {
  it("treats setup-oriented infra states as non-blocking runtime signals", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-4-a7.log");

    fs.writeFileSync(
      logPath,
      "[infra-status] kind=dependency target=leapclaw-provider-01 state=setup-required detail=bootstrap task still owned by Wave 4\n",
      "utf8",
    );

    expect(
      readWaveInfraGate([
        {
          agent: { agentId: "A7" },
          logPath,
        },
      ]),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
    });
  });
});

describe("readWaveComponentGate", () => {
  it("requires promoted components to be proven at the declared level", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "wave-0-a1.status");
    const summaryPath = path.join(dir, "wave-0-a1.summary.json");
    const logPath = path.join(dir, "wave-0-a1.log");

    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "hash" }, null, 2), "utf8");
    fs.writeFileSync(logPath, "", "utf8");
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          agentId: "A1",
          components: [
            {
              componentId: "wave-parser-and-launcher",
              level: "baseline-proved",
              state: "met",
            },
          ],
          logPath,
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      readWaveComponentGate(
        {
          wave: 0,
          componentPromotions: [
            {
              componentId: "wave-parser-and-launcher",
              targetLevel: "repo-landed",
            },
          ],
          agents: [
            {
              agentId: "A1",
              components: ["wave-parser-and-launcher"],
              componentTargets: {
                "wave-parser-and-launcher": "repo-landed",
              },
            },
          ],
        },
        [
          {
            agent: {
              agentId: "A1",
              components: ["wave-parser-and-launcher"],
              componentTargets: {
                "wave-parser-and-launcher": "repo-landed",
              },
            },
            statusPath,
            logPath,
          },
        ],
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "component-promotion-gap",
      componentId: "wave-parser-and-launcher",
    });
  });
});

describe("readWaveComponentMatrixGate", () => {
  it("requires the matrix currentLevel to match the promoted target after closure", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-2-a9.log");
    const matrixJsonPath = path.join(dir, "component-cutover-matrix.json");
    fs.writeFileSync(logPath, "", "utf8");
    fs.writeFileSync(
      matrixJsonPath,
      JSON.stringify(
        {
          version: 1,
          levels: ["repo-landed", "baseline-proved"],
          components: {
            "wave-parser-and-launcher": {
              title: "Wave parser and launcher",
              currentLevel: "repo-landed",
              promotions: [{ wave: 2, target: "baseline-proved" }],
              canonicalDocs: ["README.md"],
              proofSurfaces: ["launcher dry-run"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      readWaveComponentMatrixGate(
        {
          wave: 2,
          documentationAgentId: "A9",
          componentPromotions: [
            {
              componentId: "wave-parser-and-launcher",
              targetLevel: "baseline-proved",
            },
          ],
        },
        [
          {
            agent: { agentId: "A9" },
            logPath,
          },
        ],
        {
          documentationAgentId: "A9",
          laneProfile: {
            validation: { requireComponentPromotionsFromWave: 0 },
            paths: {
              componentCutoverMatrixJsonPath: path.relative(process.cwd(), matrixJsonPath),
              componentCutoverMatrixDocPath: "docs/plans/component-cutover-matrix.md",
            },
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      agentId: "A9",
      componentId: "wave-parser-and-launcher",
      statusCode: "component-current-level-stale",
    });
  });
});

describe("markLauncherFailed", () => {
  it("marks the global dashboard as failed and records coordination output", () => {
    const dir = makeTempDir();
    const dashboardPath = path.join(dir, "global.json");
    const coordinationEvents = [];
    const globalDashboard = {
      status: "running",
      events: [],
      waves: [],
    };

    markLauncherFailed(
      globalDashboard,
      {
        lane: "leap-claw",
        globalDashboardPath: dashboardPath,
      },
      [0],
      (entry) => coordinationEvents.push(entry),
      new Error("boom"),
    );

    expect(globalDashboard.status).toBe("failed");
    expect(JSON.parse(fs.readFileSync(dashboardPath, "utf8")).status).toBe("failed");
    expect(coordinationEvents[0]).toMatchObject({
      event: "launcher_finish",
      status: "failed",
    });
  });
});

describe("hasReusableSuccessStatus", () => {
  it("requires matching prompt metadata including resolved Context7 scope", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "wave-0-a1.status");
    const agent = {
      prompt: [
        "You are the standing implementation role for this wave.",
        "",
        "Implement the provider runtime contract.",
      ].join("\n"),
      context7Resolved: {
        bundleId: "plugins",
        query: "TypeScript module resolution and declarations",
        libraries: [{ libraryName: "typescript", libraryId: "/microsoft/typescript" }],
        selectionHash: "context7-hash-one",
      },
    };

    fs.writeFileSync(statusPath, "0\n", "utf8");
    expect(hasReusableSuccessStatus(agent, statusPath)).toBe(false);

    fs.writeFileSync(
      statusPath,
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(agent),
        },
        null,
        2,
      ),
      "utf8",
    );
    expect(hasReusableSuccessStatus(agent, statusPath)).toBe(true);

    const changedAgent = {
      ...agent,
      context7Resolved: {
        ...agent.context7Resolved,
        selectionHash: "context7-hash-two",
      },
    };
    expect(hashAgentPromptFingerprint(changedAgent)).not.toBe(hashAgentPromptFingerprint(agent));
    expect(hasReusableSuccessStatus(changedAgent, statusPath)).toBe(false);
  });
});

describe("buildCodexExecInvocation", () => {
  it("uses danger-full-access by default for codex wave runs", () => {
    const command = buildCodexExecInvocation(
      "/repo/.tmp/prompts/wave-4-a0.prompt.md",
      "/repo/.tmp/logs/wave-4-a0.log",
      DEFAULT_CODEX_SANDBOX_MODE,
    );

    expect(command).toContain("codex --ask-for-approval never exec");
    expect(command).toContain("--ask-for-approval never");
    expect(command).toContain(`--sandbox '${DEFAULT_CODEX_SANDBOX_MODE}'`);
  });
});

describe("launcher lock handling", () => {
  it("rejects a live lock and reclaims a stale one", () => {
    const dir = makeTempDir();
    const lockPath = path.join(dir, "launcher.lock");

    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    expect(() =>
      acquireLauncherLock(lockPath, {
        lane: "leap-claw",
        reconcileStatus: false,
      }),
    ).toThrow(/Another launcher is active/);

    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: 999999,
          startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    expect(
      acquireLauncherLock(lockPath, {
        lane: "leap-claw",
        reconcileStatus: false,
      }),
    ).toMatchObject({
      lane: "leap-claw",
      pid: process.pid,
    });
    releaseLauncherLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("reconcileStaleLauncherArtifacts", () => {
  it("removes stale lane artifacts while preserving reusable state and non-lane terminals", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const lockPath = lanePaths.launcherLockPath;
    const globalDashboardPath = lanePaths.globalDashboardPath;
    const waveDashboardPath = path.join(lanePaths.dashboardsDir, "wave-4.json");
    const statusPath = path.join(dir, "status", "wave-4-a1.status");

    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: 999999,
          startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0, promptHash: "abc123" }, null, 2), "utf8");
    fs.writeFileSync(waveDashboardPath, JSON.stringify({ status: "running" }, null, 2), "utf8");
    fs.writeFileSync(
      globalDashboardPath,
      JSON.stringify(
        {
          status: "running",
          waves: [
            {
              wave: 4,
              status: "running",
              dashboardPath: path.relative(process.cwd(), waveDashboardPath),
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      lanePaths.terminalsPath,
      JSON.stringify(
        {
          terminals: [
            {
              name: "leap-claw-wave4-a1",
              command: `TMUX= tmux -L ${lanePaths.tmuxSocketName} new -As oc_leap_claw_wave4_a1_deadbeef`,
            },
            {
              name: "codex1",
              command: "bash -lc 'echo helper'",
            },
          ],
          autorun: true,
          env: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(reconcileStaleLauncherArtifacts(lanePaths)).toMatchObject({
      removedLock: true,
      clearedDashboards: true,
      staleWaves: [4],
    });
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(globalDashboardPath)).toBe(false);
    expect(fs.existsSync(waveDashboardPath)).toBe(false);
    expect(fs.existsSync(statusPath)).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(lanePaths.terminalsPath, "utf8")).terminals.map((terminal) => terminal.name),
    ).toEqual(["codex1"]);
  });
});

describe("collectUnexpectedSessionFailures", () => {
  it("reports pending agents whose tmux sessions disappear before status writes", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const logPath = path.join(dir, "wave-4-a1.log");
    const statusPath = path.join(dir, "wave-4-a1.status");

    fs.writeFileSync(logPath, "", "utf8");

    expect(
      collectUnexpectedSessionFailures(
        lanePaths,
        [
          {
            agent: { agentId: "A1" },
            sessionName: "oc_leap_claw_wave4_a1_deadbeef",
            statusPath,
            logPath,
          },
        ],
        new Set(["A1"]),
      ),
    ).toMatchObject([
      {
        agentId: "A1",
        statusCode: "session-missing",
      },
    ]);
  });
});
