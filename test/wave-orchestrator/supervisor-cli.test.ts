import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { loadWaveConfig } from "../../scripts/wave-orchestrator/config.mjs";
import { buildLanePaths, REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";
import {
  buildSupervisorPaths,
  findSupervisorRunState,
  reconcileSupervisorRun,
  submitLauncherRun,
  runSupervisorLoop,
  waitForRunState,
} from "../../scripts/wave-orchestrator/supervisor-cli.mjs";

const cleanupPaths = [];

function trackCleanup(targetPath) {
  cleanupPaths.push(targetPath);
  return targetPath;
}

afterEach(() => {
  for (const targetPath of cleanupPaths.splice(0)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

describe("supervisor-cli", () => {
  it("finds run state by run id under the supervisor tree", () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-${Date.now()}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-lookup`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const statePath = path.join(runDir, "state.json");
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          status: "pending",
        },
        null,
        2,
      ),
      "utf8",
    );

    const located = findSupervisorRunState(runId, {
      project: config.defaultProject,
      lane,
    });

    expect(located?.statePath).toBe(statePath);
    expect(located?.state).toMatchObject({
      runId,
      lane,
      status: "pending",
    });
  });

  it("processes a queued dry-run launcher request to completion", async () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const laneWaveDir = trackCleanup(path.join(REPO_ROOT, "docs", lane, "plans", "waves"));
    fs.mkdirSync(laneWaveDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, "docs", "plans", "waves", "wave-1.md"),
      path.join(laneWaveDir, "wave-1.md"),
    );
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-dry`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const baseState = {
      runId,
      project: config.defaultProject,
      lane,
      adhocRunId: null,
      status: "pending",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      launcherArgs: [
        "--project",
        config.defaultProject,
        "--lane",
        lane,
        "--dry-run",
        "--no-dashboard",
        "--start-wave", "1",
        "--end-wave", "1",
      ],
      launcherPid: null,
      exitCode: null,
    };
    fs.writeFileSync(path.join(runDir, "request.json"), JSON.stringify(baseState, null, 2), "utf8");
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(baseState, null, 2), "utf8");

    const result = await runSupervisorLoop({
      project: config.defaultProject,
      lane,
      adhocRunId: null,
      once: true,
      pollMs: 50,
    });

    expect(result.alreadyRunning).toBe(false);
    const finalState = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
    expect(finalState.status).toBe("completed");
    expect(finalState.exitCode).toBe(0);
    expect(fs.existsSync(path.join(runDir, "launcher-status.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "launcher.log"))).toBe(true);
  }, 30000);

  it("adopts a running run and reconciles launcher status without scanning outside the lane", async () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-adopt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-adopt`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
    const startedAt = new Date().toISOString();
    const baseState = {
      runId,
      project: config.defaultProject,
      lane,
      adhocRunId: null,
      status: "running",
      submittedAt: startedAt,
      startedAt,
      updatedAt: startedAt,
      launcherArgs: [
        "--project",
        config.defaultProject,
        "--lane",
        lane,
        "--start-wave",
        "1",
        "--end-wave",
        "1",
      ],
      launcherPid: process.pid,
      launcherStatusPath: path.join(runDir, "launcher-status.json"),
      launcherLogPath: path.join(runDir, "launcher.log"),
      exitCode: null,
    };
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(baseState, null, 2), "utf8");
    fs.writeFileSync(
      path.join(runDir, "launcher-status.json"),
      JSON.stringify({ exitCode: 0, completedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );

    await runSupervisorLoop({
      project: config.defaultProject,
      lane,
      adhocRunId: null,
      once: true,
      pollMs: 20,
    });

    const finalState = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
    expect(finalState.status).toBe("completed");
    const events = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8");
    expect(events).toContain("\"type\":\"daemon-adopted\"");
    expect(events).toContain("\"type\":\"launcher-status-reconciled\"");
  });

  it("recovers terminal state from the launcher progress journal when launcher status is missing", async () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-progress-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-progress`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
    const startedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          adhocRunId: null,
          status: "running",
          submittedAt: startedAt,
          startedAt,
          updatedAt: startedAt,
          launcherArgs: [
            "--project",
            config.defaultProject,
            "--lane",
            lane,
            "--dry-run",
            "--no-dashboard",
            "--start-wave",
            "1",
            "--end-wave",
            "1",
          ],
          launcherPid: 999999,
          activeWave: 1,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "launcher-progress.json"),
      JSON.stringify(
        {
          runId,
          waveNumber: 1,
          attemptNumber: 1,
          phase: "completed",
          selectedAgentIds: ["A1"],
          launchedAgentIds: ["A1"],
          completedAgentIds: ["A1"],
          finalized: true,
          finalDisposition: "completed",
          exitCode: 0,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    await runSupervisorLoop({
      project: config.defaultProject,
      lane,
      adhocRunId: null,
      once: true,
      pollMs: 20,
    });

    const finalState = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
    expect(finalState).toMatchObject({
      status: "completed",
      terminalDisposition: "completed",
      recoveryState: "recovered-from-progress",
      exitCode: 0,
    });
  });

  it("does not recover completion from stale lane run-state when the launcher dies before terminal artifacts exist", () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-run-state-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-run-state`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
    const startedAt = new Date().toISOString();
    fs.writeFileSync(
      lanePaths.defaultRunStatePath,
      JSON.stringify(
        {
          schemaVersion: 2,
          completedWaves: [1],
          waves: {
            "1": {
              wave: 1,
              currentState: "completed",
              lastTransitionAt: startedAt,
              lastSource: "live-launcher",
              lastReasonCode: "wave-complete",
              lastDetail: "Wave 1 completed.",
              lastEvidence: null,
            },
          },
          history: [],
          lastUpdatedAt: startedAt,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          adhocRunId: null,
          status: "running",
          submittedAt: startedAt,
          startedAt,
          updatedAt: startedAt,
          launcherArgs: [
            "--project",
            config.defaultProject,
            "--lane",
            lane,
            "--start-wave",
            "1",
            "--end-wave",
            "1",
            "--no-dashboard",
          ],
          launcherPid: 999997,
          activeWave: 1,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "launcher-progress.json"),
      JSON.stringify(
        {
          runId,
          waveNumber: 1,
          attemptNumber: 1,
          phase: "wave-completed",
          selectedAgentIds: [],
          launchedAgentIds: [],
          completedAgentIds: ["A1"],
          finalized: false,
          finalDisposition: null,
          updatedAt: startedAt,
        },
        null,
        2,
      ),
      "utf8",
    );

    const resumedState = reconcileSupervisorRun(
      JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")),
      path.join(runDir, "state.json"),
    );
    try {
      expect(resumedState.status).toBe("running");
      expect(resumedState.recoveryState).toBe("resuming");
      expect(resumedState.recoveryState).not.toBe("recovered-from-run-state");
      expect(resumedState.launcherArgs).toEqual([
        "--project",
        config.defaultProject,
        "--lane",
        lane,
        "--no-dashboard",
        "--start-wave",
        "1",
        "--end-wave",
        "1",
        "--resume-control-state",
      ]);
    } finally {
      try {
        process.kill(resumedState.launcherPid, "SIGKILL");
      } catch {
        // no-op
      }
    }
  });

  it("resumes the active wave after launcher loss using preserved control state", async () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-resume-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const laneWaveDir = trackCleanup(path.join(REPO_ROOT, "docs", lane, "plans", "waves"));
    fs.mkdirSync(laneWaveDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, "docs", "plans", "waves", "wave-1.md"),
      path.join(laneWaveDir, "wave-1.md"),
    );
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-resume`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
    const startedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          adhocRunId: null,
          status: "running",
          submittedAt: startedAt,
          startedAt,
          updatedAt: startedAt,
          launcherArgs: [
            "--project",
            config.defaultProject,
            "--lane",
            lane,
            "--dry-run",
            "--no-dashboard",
            "--start-wave",
            "1",
            "--end-wave",
            "1",
          ],
          launcherPid: 999998,
          activeWave: 1,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "launcher-progress.json"),
      JSON.stringify(
        {
          runId,
          waveNumber: 1,
          attemptNumber: 1,
          phase: "attempt-running",
          selectedAgentIds: ["A1"],
          launchedAgentIds: [],
          completedAgentIds: [],
          finalized: false,
          finalDisposition: null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    await runSupervisorLoop({
      project: config.defaultProject,
      lane,
      adhocRunId: null,
      once: true,
      pollMs: 50,
    });

    const finalState = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
    expect(finalState.status).toBe("completed");
    const events = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8");
    expect(events).toContain("\"type\":\"launcher-started\"");
    expect(events).toContain("\"resumed\":true");
  }, 30000);

  it("reconciles launcher terminal artifacts before status reads", () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-status-read-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-status-read`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          status: "running",
          submittedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          launcherArgs: ["--project", config.defaultProject, "--lane", lane, "--start-wave", "1", "--end-wave", "1"],
          launcherPid: 999994,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "launcher-status.json"),
      JSON.stringify({ exitCode: 0, completedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );

    const located = findSupervisorRunState(
      runId,
      { project: config.defaultProject, lane },
      { reconcile: true },
    );

    expect(located?.state).toMatchObject({
      status: "completed",
      terminalDisposition: "completed",
      exitCode: 0,
    });
  });

  it("reconciles terminal artifacts before wait timing out", async () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-wait-read-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-wait-read`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          status: "running",
          submittedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          launcherArgs: ["--project", config.defaultProject, "--lane", lane, "--start-wave", "2", "--end-wave", "3"],
          launcherPid: 999993,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "launcher-progress.json"),
      JSON.stringify(
        {
          runId,
          waveNumber: 3,
          attemptNumber: 1,
          phase: "completed",
          selectedAgentIds: [],
          launchedAgentIds: [],
          completedAgentIds: [],
          finalized: true,
          finalDisposition: "completed",
          exitCode: 0,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    const located = await waitForRunState({
      runId,
      project: config.defaultProject,
      lane,
      timeoutSeconds: 0,
    });

    expect(located.state).toMatchObject({
      status: "completed",
      terminalDisposition: "completed",
      activeWave: 3,
    });
  });

  it("resumes the remaining explicit wave range instead of truncating a multi-wave submission", async () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-resume-range-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-resume-range`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
    const startedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          adhocRunId: null,
          status: "running",
          submittedAt: startedAt,
          startedAt,
          updatedAt: startedAt,
          launcherArgs: [
            "--project",
            config.defaultProject,
            "--lane",
            lane,
            "--dry-run",
            "--no-dashboard",
            "--start-wave",
            "1",
            "--end-wave",
            "3",
          ],
          launcherPid: 999996,
          activeWave: 2,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "launcher-progress.json"),
      JSON.stringify(
        {
          runId,
          waveNumber: 2,
          attemptNumber: 1,
          phase: "attempt-running",
          selectedAgentIds: ["A1"],
          launchedAgentIds: ["A1"],
          completedAgentIds: [],
          finalized: false,
          finalDisposition: null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    const resumedState = reconcileSupervisorRun(
      JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")),
      path.join(runDir, "state.json"),
    );
    try {
      expect(resumedState.status).toBe("running");
      expect(resumedState.launcherArgs).toEqual([
        "--project",
        config.defaultProject,
        "--lane",
        lane,
        "--dry-run",
        "--no-dashboard",
        "--start-wave",
        "2",
        "--end-wave",
        "3",
        "--resume-control-state",
      ]);
    } finally {
      try {
        process.kill(resumedState.launcherPid, "SIGKILL");
      } catch {
        // no-op
      }
    }
  });

  it("updates activeWave from launcher progress while the launcher is still healthy", () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-active-wave-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-active-wave`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          status: "running",
          submittedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          launcherArgs: ["--project", config.defaultProject, "--lane", lane, "--start-wave", "1", "--end-wave", "3"],
          launcherPid: process.pid,
          activeWave: 1,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "launcher-progress.json"),
      JSON.stringify(
        {
          runId,
          waveNumber: 2,
          attemptNumber: 1,
          phase: "attempt-running",
          selectedAgentIds: ["A2"],
          launchedAgentIds: ["A2"],
          completedAgentIds: [],
          finalized: false,
          finalDisposition: null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    const reconciled = reconcileSupervisorRun(
      JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")),
      path.join(runDir, "state.json"),
    );

    expect(reconciled).toMatchObject({
      status: "running",
      activeWave: 2,
      terminalDisposition: "running",
    });
  });

  it("does not recover auto-next runs from canonical run-state before the remaining waves execute", () => {
    const config = loadWaveConfig();
    const lane = `test-supervisor-auto-next-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-auto-next`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
    const startedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          adhocRunId: null,
          status: "running",
          submittedAt: startedAt,
          startedAt,
          updatedAt: startedAt,
          launcherArgs: [
            "--project",
            config.defaultProject,
            "--lane",
            lane,
            "--dry-run",
            "--no-dashboard",
            "--auto-next",
          ],
          launcherPid: 999995,
          activeWave: 1,
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "launcher-progress.json"),
      JSON.stringify(
        {
          runId,
          waveNumber: 1,
          attemptNumber: 1,
          phase: "wave-completed",
          selectedAgentIds: [],
          launchedAgentIds: [],
          completedAgentIds: ["A1"],
          finalized: false,
          finalDisposition: null,
          updatedAt: startedAt,
        },
        null,
        2,
      ),
      "utf8",
    );

    const resumedState = reconcileSupervisorRun(
      JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")),
      path.join(runDir, "state.json"),
    );
    try {
      expect(resumedState.status).toBe("running");
      expect(resumedState.recoveryState).toBe("resuming");
      expect(resumedState.recoveryState).not.toBe("recovered-from-run-state");
      expect(resumedState.launcherArgs).toEqual([
        "--project",
        config.defaultProject,
        "--lane",
        lane,
        "--dry-run",
        "--no-dashboard",
        "--auto-next",
        "--resume-control-state",
      ]);
    } finally {
      try {
        process.kill(resumedState.launcherPid, "SIGKILL");
      } catch {
        // no-op
      }
    }
  });

  it("submits launcher flags without rejecting normal launch options", () => {
    const config = loadWaveConfig();
    const lane = `test-submit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);

    const result = submitLauncherRun([
      "--project",
      config.defaultProject,
      "--lane",
      lane,
      "--dry-run",
      "--no-dashboard",
      "--start-wave",
      "1",
      "--end-wave",
      "1",
    ]);

    expect(result.project).toBe(config.defaultProject);
    expect(result.lane).toBe(lane);
    const state = JSON.parse(fs.readFileSync(result.statePath, "utf8"));
    expect(state.launcherArgs).toEqual([
      "--project",
      config.defaultProject,
      "--lane",
      lane,
      "--dry-run",
      "--no-dashboard",
      "--start-wave",
      "1",
      "--end-wave",
      "1",
    ]);
  });

  it("prints structured submit output from the CLI", () => {
    const config = loadWaveConfig();
    const lane = `test-submit-json-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);

    const result = spawnSync(
      "node",
      [
        path.join(REPO_ROOT, "scripts", "wave.mjs"),
        "submit",
        "--project",
        config.defaultProject,
        "--lane",
        lane,
        "--dry-run",
        "--json",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          WAVE_SKIP_UPDATE_CHECK: "1",
        },
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      project: config.defaultProject,
      lane,
      adhocRunId: null,
    });
    expect(String(payload.runId)).toMatch(/^run-/);
    expect(String(payload.statePath)).toContain(path.join("supervisor", "runs", payload.runId, "state.json"));
  });

  it("falls back to log output for process-backed agent attach", () => {
    const config = loadWaveConfig();
    const lane = `test-attach-log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lanePaths = buildLanePaths(lane, { config, project: config.defaultProject });
    trackCleanup(lanePaths.stateDir);
    const supervisorPaths = buildSupervisorPaths(lanePaths);
    const runId = `run-${Date.now()}-attach`;
    const runDir = path.join(supervisorPaths.runsDir, runId);
    const logPath = path.join(runDir, "agents", "A1.log");
    const statusPath = path.join(runDir, "agents", "A1.status.json");
    fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(
        {
          runId,
          project: config.defaultProject,
          lane,
          status: "running",
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(logPath, "recent process-backed log output\n", "utf8");
    fs.writeFileSync(statusPath, JSON.stringify({ code: 0 }, null, 2), "utf8");
    fs.writeFileSync(
      path.join(runDir, "agents", "A1.runtime.json"),
      JSON.stringify(
        {
          agentId: "A1",
          attachMode: "log-tail",
          sessionBackend: "process",
          logPath,
          statusPath,
          terminalDisposition: "completed",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(
      "node",
      [
        path.join(REPO_ROOT, "scripts", "wave.mjs"),
        "attach",
        "--run-id",
        runId,
        "--project",
        config.defaultProject,
        "--lane",
        lane,
        "--agent",
        "A1",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          WAVE_SKIP_UPDATE_CHECK: "1",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("recent process-backed log output");
  });
});
