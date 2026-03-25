import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentSignalAckPath,
  buildSignalProjectionSet,
  syncWaveSignalProjections,
  waveSignalPath,
} from "../../scripts/wave-orchestrator/signals.mjs";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-signals-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function makeLanePaths(root: string) {
  return {
    lane: "main",
    signalsDir: path.join(root, "signals"),
    messageboardsDir: path.join(root, "messageboards"),
    inboxesDir: path.join(root, "inboxes"),
    dashboardsDir: path.join(root, "dashboards"),
    coordinationDir: path.join(root, "coordination"),
    feedbackTriageDir: path.join(root, "feedback", "triage"),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("signal projections", () => {
  it("bumps signal versions only when the normalized signal changes and clears shouldWake after ack", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = { wave: 2 };
    const basePayload = {
      lane: "main",
      wave: 2,
      phase: "running",
      blockingEdge: {
        kind: "human-input",
        id: "feedback-1",
        agentId: "A1",
        detail: "Need rollout window",
      },
      logicalAgents: [
        {
          agentId: "A1",
          state: "blocked",
          reason: "Need rollout window",
          selectedForRerun: false,
          selectedForActiveAttempt: false,
        },
      ],
      tasks: [
        {
          taskId: "feedback-1",
          taskType: "human-input",
          state: "input-required",
          ownerAgentId: "A1",
          assigneeAgentId: "A1",
          title: "Need rollout window",
        },
      ],
      feedbackRequests: [
        {
          id: "feedback-1",
          agentId: "A1",
          status: "pending",
          question: "Need rollout window",
          responseText: "",
        },
      ],
      selectionSource: "none",
      rerunRequest: null,
      relaunchPlan: null,
      activeAttempt: null,
    };

    const first = syncWaveSignalProjections({
      lanePaths,
      wave,
      statusPayload: basePayload,
      includeResident: true,
    });

    expect(first.wave.snapshot).toMatchObject({
      signal: "feedback-requested",
      version: 1,
    });
    expect(first.agents[0].snapshot).toMatchObject({
      agentId: "A1",
      signal: "feedback-requested",
      version: 1,
      shouldWake: true,
    });
    expect(fs.existsSync(waveSignalPath(lanePaths, wave.wave))).toBe(true);

    writeJson(agentSignalAckPath(lanePaths, wave.wave, "A1"), {
      agentId: "A1",
      version: 1,
      signal: "feedback-requested",
      observedAt: "2026-03-25T00:00:00.000Z",
    });

    const second = syncWaveSignalProjections({
      lanePaths,
      wave,
      statusPayload: basePayload,
      includeResident: true,
    });

    expect(second.wave.snapshot.version).toBe(1);
    expect(second.agents[0].snapshot).toMatchObject({
      agentId: "A1",
      signal: "feedback-requested",
      version: 1,
      shouldWake: false,
      ack: {
        version: 1,
      },
    });

    const answered = syncWaveSignalProjections({
      lanePaths,
      wave,
      statusPayload: {
        ...basePayload,
        blockingEdge: null,
        tasks: [],
        feedbackRequests: [
          {
            id: "feedback-1",
            agentId: "A1",
            status: "answered",
            question: "Need rollout window",
            responseText: "Window is approved.",
          },
        ],
      },
      includeResident: true,
    });

    expect(answered.wave.snapshot).toMatchObject({
      signal: "feedback-answered",
      version: 2,
    });
    expect(answered.agents[0].snapshot).toMatchObject({
      signal: "feedback-answered",
      version: 2,
      shouldWake: true,
    });
  });

  it("lets terminal wave state override stale answered feedback and coordination actions for agents", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = { wave: 4 };
    const projections = buildSignalProjectionSet({
      lanePaths,
      wave,
      statusPayload: {
        lane: "main",
        wave: 4,
        phase: "completed",
        logicalAgents: [
          {
            agentId: "A1",
            state: "blocked",
            reason: "Old reason that should not override completion",
            selectedForRerun: false,
            selectedForActiveAttempt: false,
          },
        ],
        tasks: [
          {
            taskId: "task-1",
            taskType: "request",
            state: "open",
            ownerAgentId: "A1",
            assigneeAgentId: "A1",
            title: "Old coordination action",
          },
        ],
        feedbackRequests: [
          {
            id: "feedback-1",
            agentId: "A1",
            status: "answered",
            question: "Old question",
            responseText: "Already answered.",
          },
        ],
      },
      includeResident: false,
    });

    expect(projections.agents[0]).toMatchObject({
      agentId: "A1",
      signal: "completed",
      status: "completed",
      reason: "Wave 4 completed.",
    });
  });

  it("bumps the resident signal version when only target agents reroute", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = { wave: 5 };
    const first = syncWaveSignalProjections({
      lanePaths,
      wave,
      statusPayload: {
        lane: "main",
        wave: 5,
        phase: "running",
        blockingEdge: {
          kind: "human-input",
          id: "feedback-1",
          agentId: "A1",
          detail: "Need rollout window",
        },
        logicalAgents: [
          { agentId: "A1", state: "blocked", selectedForRerun: false, selectedForActiveAttempt: false },
          { agentId: "A2", state: "planned", selectedForRerun: false, selectedForActiveAttempt: false },
        ],
        tasks: [],
        feedbackRequests: [
          {
            id: "feedback-1",
            agentId: "A1",
            status: "pending",
            question: "Need rollout window",
            responseText: "",
          },
        ],
        selectionSource: "none",
        rerunRequest: null,
        relaunchPlan: null,
        activeAttempt: null,
      },
      includeResident: true,
    });

    const rerouted = syncWaveSignalProjections({
      lanePaths,
      wave,
      statusPayload: {
        lane: "main",
        wave: 5,
        phase: "running",
        blockingEdge: {
          kind: "human-input",
          id: "feedback-1",
          agentId: "A2",
          detail: "Need rollout window",
        },
        logicalAgents: [
          { agentId: "A1", state: "planned", selectedForRerun: false, selectedForActiveAttempt: false },
          { agentId: "A2", state: "blocked", selectedForRerun: false, selectedForActiveAttempt: false },
        ],
        tasks: [],
        feedbackRequests: [
          {
            id: "feedback-1",
            agentId: "A2",
            status: "pending",
            question: "Need rollout window",
            responseText: "",
          },
        ],
        selectionSource: "none",
        rerunRequest: null,
        relaunchPlan: null,
        activeAttempt: null,
      },
      includeResident: true,
    });

    expect(first.resident?.snapshot).toMatchObject({
      signal: "feedback-requested",
      version: 1,
      targetAgentIds: ["A1"],
    });
    expect(rerouted.resident?.snapshot).toMatchObject({
      signal: "feedback-requested",
      version: 2,
      targetAgentIds: ["A2"],
    });
  });
});
