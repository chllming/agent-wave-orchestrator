import { describe, expect, it } from "vitest";
import {
  buildTaskSnapshots,
  nextTaskDeadline,
  normalizeControlPlaneEvent,
} from "../../scripts/wave-orchestrator/control-plane.mjs";
import { materializeCoordinationState } from "../../scripts/wave-orchestrator/coordination-store.mjs";

describe("control-plane normalization", () => {
  it("accepts contradiction entities", () => {
    expect(
      normalizeControlPlaneEvent({
        lane: "main",
        wave: 3,
        entityType: "contradiction",
        entityId: "contra-1",
        action: "create",
      }),
    ).toMatchObject({
      entityType: "contradiction",
      entityId: "contra-1",
      action: "create",
    });
  });

  it("accepts fact entities", () => {
    expect(
      normalizeControlPlaneEvent({
        lane: "main",
        wave: 3,
        entityType: "fact",
        entityId: "fact-1",
        action: "create",
      }),
    ).toMatchObject({
      entityType: "fact",
      entityId: "fact-1",
      action: "create",
    });
  });
});

describe("task snapshots", () => {
  it("keeps advisory clarifications visible without letting them own the next blocking deadline", () => {
    const tasks = buildTaskSnapshots({
      coordinationState: materializeCoordinationState([
        {
          id: "clarify-advisory",
          kind: "clarification-request",
          lane: "main",
          wave: 3,
          agentId: "A1",
          targets: ["agent:A9"],
          status: "open",
          priority: "high",
          blocking: false,
          blockerSeverity: "advisory",
          summary: "Optional docs clarification",
          detail: "Helpful context, but it should not stall the wave.",
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:00:00.000Z",
        },
        {
          id: "request-blocking",
          kind: "request",
          lane: "main",
          wave: 3,
          agentId: "launcher",
          targets: ["agent:A9"],
          status: "open",
          priority: "high",
          summary: "Blocking shared-plan update",
          detail: "This request still needs an acknowledgement.",
          createdAt: "2026-03-22T00:10:00.000Z",
          updatedAt: "2026-03-22T00:10:00.000Z",
        },
      ]),
      ackTimeoutMs: 5 * 60 * 1000,
      resolutionStaleMs: 10 * 60 * 1000,
    });

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "clarify-advisory",
          taskType: "clarification",
          blocking: false,
          blockerSeverity: "advisory",
          resolveDeadlineAt: "2026-03-22T00:10:00.000Z",
        }),
        expect.objectContaining({
          taskId: "request-blocking",
          taskType: "request",
          blocking: true,
          ackDeadlineAt: "2026-03-22T00:15:00.000Z",
        }),
      ]),
    );

    expect(nextTaskDeadline(tasks)).toMatchObject({
      taskId: "request-blocking",
      kind: "ack",
    });
  });
});
