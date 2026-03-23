import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalWorkflowBackend,
  createWorkflowBackend,
} from "../../scripts/wave-orchestrator/workflow-backend.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-workflow-backend-"));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Event persistence: appendEvent / readEvents
// ---------------------------------------------------------------------------

describe("appendEvent / readEvents", () => {
  it("persists an event and reads it back", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    const record = await backend.appendEvent({
      entityType: "wave_run",
      wave: 1,
      lane: "main",
      action: "started",
    });
    expect(record.eventId).toBeTruthy();
    expect(record.persistedAt).toBeTruthy();

    const events = await backend.readEvents();
    expect(events.length).toBe(1);
    expect(events[0].entityType).toBe("wave_run");
    expect(events[0].action).toBe("started");
  });

  it("filters events by entityType", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    await backend.appendEvent({ entityType: "wave_run", wave: 1 });
    await backend.appendEvent({ entityType: "agent_run", wave: 1, agentId: "A1" });
    await backend.appendEvent({ entityType: "wave_run", wave: 2 });

    const waveRuns = await backend.readEvents({ entityType: "wave_run" });
    expect(waveRuns.length).toBe(2);
    const agentRuns = await backend.readEvents({ entityType: "agent_run" });
    expect(agentRuns.length).toBe(1);
  });

  it("filters events by wave", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    await backend.appendEvent({ entityType: "wave_run", wave: 1, lane: "main" });
    await backend.appendEvent({ entityType: "wave_run", wave: 2, lane: "main" });

    const wave1 = await backend.readEvents({ wave: 1 });
    expect(wave1.length).toBe(1);
    expect(wave1[0].wave).toBe(1);
  });

  it("filters events by lane", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    await backend.appendEvent({ entityType: "wave_run", wave: 1, lane: "main" });
    await backend.appendEvent({ entityType: "wave_run", wave: 1, lane: "hotfix" });

    const mainEvents = await backend.readEvents({ lane: "main" });
    expect(mainEvents.length).toBe(1);
    expect(mainEvents[0].lane).toBe("main");
  });

  it("returns empty array when no events file exists", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const events = await backend.readEvents();
    expect(events).toEqual([]);
  });

  it("throws on null event", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    await expect(backend.appendEvent(null)).rejects.toThrow("Event must be an object");
  });
});

// ---------------------------------------------------------------------------
// State queries: getWaveState, getTaskState, getOpenBlockers, getClosureEligibility
// ---------------------------------------------------------------------------

describe("state query methods", () => {
  it("getWaveState returns null when no events exist", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const state = await backend.getWaveState("main", 1);
    expect(state).toBeNull();
  });

  it("getWaveState returns reducer output when events exist", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    await backend.appendEvent({ entityType: "wave_run", wave: 1, lane: "main" });
    await backend.appendEvent({ entityType: "agent_run", wave: 1, lane: "main" });

    const state = await backend.getWaveState("main", 1);
    expect(state).not.toBeNull();
    expect(state.lane).toBe("main");
    expect(typeof state.reducerVersion).toBe("number");
    expect(Array.isArray(state.openBlockers)).toBe(true);
    expect(state.closureEligibility).toBeTruthy();
    expect(typeof state.closureEligibility.waveMayClose).toBe("boolean");
  });

  it("getTaskState returns null (stub)", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const state = await backend.getTaskState("wave-1:A1:test");
    expect(state).toBeNull();
  });

  it("getTaskState returns null for falsy taskId", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const state = await backend.getTaskState("");
    expect(state).toBeNull();
  });

  it("getOpenBlockers returns empty array by default", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const blockers = await backend.getOpenBlockers("main", 1);
    expect(blockers).toEqual([]);
  });

  it("getClosureEligibility returns null when no events", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const eligibility = await backend.getClosureEligibility("main", 1);
    expect(eligibility).toBeNull();
  });

  it("getClosureEligibility returns reducer closure state when events exist", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    await backend.appendEvent({ entityType: "wave_run", wave: 1, lane: "main" });

    const eligibility = await backend.getClosureEligibility("main", 1);
    expect(eligibility).not.toBeNull();
    expect(typeof eligibility.waveMayClose).toBe("boolean");
    expect(typeof eligibility.allGatesPass).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Timer management: scheduleTimer, cancelTimer, getExpiredTimers
// ---------------------------------------------------------------------------

describe("timer management", () => {
  it("scheduleTimer returns a timer handle with expected fields", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const timer = await backend.scheduleTimer("t1", 60000, () => {});
    expect(timer.timerId).toBe("t1");
    expect(timer.scheduledAt).toBeTruthy();
    expect(timer.expiresAt).toBeTruthy();
    expect(typeof timer.cancel).toBe("function");
    timer.cancel();
  });

  it("scheduleTimer generates an id when not provided", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const timer = await backend.scheduleTimer(null, 60000, () => {});
    expect(timer.timerId).toBeTruthy();
    expect(timer.timerId.startsWith("timer-")).toBe(true);
    timer.cancel();
  });

  it("cancelTimer cancels an active timer", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    await backend.scheduleTimer("t1", 60000, () => {});
    const cancelled = await backend.cancelTimer("t1");
    expect(cancelled).toBe(true);

    // Cancelling again should return false
    const again = await backend.cancelTimer("t1");
    expect(again).toBe(false);
  });

  it("cancelTimer returns false for unknown timer", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const result = await backend.cancelTimer("nonexistent");
    expect(result).toBe(false);
  });

  it("getExpiredTimers returns empty when no timers are set", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const expired = await backend.getExpiredTimers();
    expect(expired).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Human input: createHumanInput, resolveHumanInput, getOpenHumanInputs
// ---------------------------------------------------------------------------

describe("human input workflow", () => {
  it("creates a human input request and reads it back", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    const requestId = await backend.createHumanInput({
      kind: "clarification",
      requestedBy: "A1",
      question: "What should we do here?",
    });
    expect(requestId).toBeTruthy();

    const open = await backend.getOpenHumanInputs();
    expect(open.length).toBe(1);
    expect(open[0].requestId).toBe(requestId);
    expect(open[0].kind).toBe("clarification");
    expect(open[0].status).toBe("pending");
    expect(open[0].question).toBe("What should we do here?");
  });

  it("resolves a human input request", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    const requestId = await backend.createHumanInput({
      kind: "approval",
      requestedBy: "A2",
    });

    await backend.resolveHumanInput(requestId, { approved: true, detail: "LGTM" });

    const open = await backend.getOpenHumanInputs();
    expect(open.length).toBe(0);
  });

  it("throws when resolving unknown requestId", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    await expect(
      backend.resolveHumanInput("nonexistent", {}),
    ).rejects.toThrow("Human input request not found");
  });

  it("filters open human inputs by kind", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    await backend.createHumanInput({ kind: "clarification", requestedBy: "A1" });
    await backend.createHumanInput({ kind: "approval", requestedBy: "A2" });

    const clarifications = await backend.getOpenHumanInputs({ kind: "clarification" });
    expect(clarifications.length).toBe(1);
    expect(clarifications[0].kind).toBe("clarification");
  });

  it("filters open human inputs by requestedBy", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    await backend.createHumanInput({ kind: "clarification", requestedBy: "A1" });
    await backend.createHumanInput({ kind: "approval", requestedBy: "A2" });

    const a1 = await backend.getOpenHumanInputs({ requestedBy: "A1" });
    expect(a1.length).toBe(1);
    expect(a1[0].requestedBy).toBe("A1");
  });

  it("persists human input events to the event log", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    const requestId = await backend.createHumanInput({
      kind: "decision",
      requestedBy: "system",
    });

    await backend.resolveHumanInput(requestId, { decision: "proceed" });

    const events = await backend.readEvents({ entityType: "human_input" });
    expect(events.length).toBe(2);
    expect(events[0].action).toBe("created");
    expect(events[1].action).toBe("resolved");
  });

  it("throws on null request", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    await expect(backend.createHumanInput(null)).rejects.toThrow(
      "Request must be an object",
    );
  });
});

// ---------------------------------------------------------------------------
// Lease management (retained from v1)
// ---------------------------------------------------------------------------

describe("lease management", () => {
  it("acquires and checks a lease", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    const lease = await backend.acquireLease("lease-1", "A1", 60000);
    expect(lease).not.toBeNull();
    expect(lease.leaseId).toBe("lease-1");
    expect(lease.ownerId).toBe("A1");

    const held = await backend.isLeaseHeld("lease-1");
    expect(held).toBe(true);
  });

  it("rejects acquiring a held lease", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    await backend.acquireLease("lease-1", "A1", 60000);
    const second = await backend.acquireLease("lease-1", "A2", 60000);
    expect(second).toBeNull();
  });

  it("releases a lease", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    await backend.acquireLease("lease-1", "A1", 60000);
    const released = await backend.releaseLease("lease-1");
    expect(released).toBe(true);

    const held = await backend.isLeaseHeld("lease-1");
    expect(held).toBe(false);
  });

  it("returns false for releasing non-existent lease", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const released = await backend.releaseLease("nonexistent");
    expect(released).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Key-value state (retained from v1)
// ---------------------------------------------------------------------------

describe("key-value state", () => {
  it("round-trips state by key", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);

    await backend.setState("test-key", { count: 42 });
    const value = await backend.getState("test-key");
    expect(value).toEqual({ count: 42 });
  });

  it("returns null for missing key", async () => {
    const dir = makeTempDir();
    const backend = new LocalWorkflowBackend(dir);
    const value = await backend.getState("nonexistent");
    expect(value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("createWorkflowBackend", () => {
  it("creates a LocalWorkflowBackend with default basePath", () => {
    const backend = createWorkflowBackend();
    expect(backend).toBeInstanceOf(LocalWorkflowBackend);
    expect(backend.basePath).toBe(".tmp/workflow");
  });

  it("creates a LocalWorkflowBackend with custom basePath", () => {
    const backend = createWorkflowBackend({ basePath: "/custom/path" });
    expect(backend.basePath).toBe("/custom/path");
  });
});
