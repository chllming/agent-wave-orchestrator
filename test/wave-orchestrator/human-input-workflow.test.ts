import { describe, expect, it } from "vitest";
import {
  HUMAN_INPUT_STATES,
  HUMAN_INPUT_VALID_TRANSITIONS,
  buildHumanInputRequests,
  computeHumanInputMetrics,
  evaluateHumanInputTimeout,
  isHumanInputBlocking,
  normalizeHumanInputRequest,
  transitionHumanInputState,
} from "../../scripts/wave-orchestrator/human-input-workflow.mjs";

describe("human-input-workflow", () => {
  describe("normalizeHumanInputRequest", () => {
    it("returns defaults for empty input", () => {
      const result = normalizeHumanInputRequest({});
      expect(result.state).toBe("open");
      expect(result.kind).toBe("human-input");
      expect(result.requestId).toBeNull();
      expect(result.title).toBeNull();
      expect(result.detail).toBeNull();
      expect(result.requestedBy).toBeNull();
      expect(result.assignedTo).toBeNull();
      expect(result.answeredAt).toBeNull();
      expect(result.resolvedAt).toBeNull();
      expect(result.escalatedAt).toBeNull();
      expect(result.answer).toBeNull();
      expect(result.resolution).toBeNull();
      expect(result.createdAt).toBeTruthy();
      expect(result.updatedAt).toBeTruthy();
      expect(result.timeoutPolicy).toEqual({ maxWaitMs: 300000, escalateAfterMs: 120000 });
      expect(result.reroutePolicy).toEqual({ rerouteOnTimeout: true, rerouteTo: "operator" });
    });

    it("normalizes a fully populated request", () => {
      const result = normalizeHumanInputRequest({
        requestId: "req-123",
        kind: "clarification",
        state: "pending",
        title: "Need approval",
        detail: "Please review the plan",
        requestedBy: "agent-A1",
        assignedTo: "operator",
        timeoutPolicy: { maxWaitMs: 60000, escalateAfterMs: 30000 },
        reroutePolicy: { rerouteOnTimeout: false, rerouteTo: "agent-B1" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        answeredAt: null,
        answer: null,
      });
      expect(result.requestId).toBe("req-123");
      expect(result.kind).toBe("clarification");
      expect(result.state).toBe("pending");
      expect(result.title).toBe("Need approval");
      expect(result.detail).toBe("Please review the plan");
      expect(result.requestedBy).toBe("agent-A1");
      expect(result.assignedTo).toBe("operator");
      expect(result.timeoutPolicy).toEqual({ maxWaitMs: 60000, escalateAfterMs: 30000 });
      expect(result.reroutePolicy).toEqual({ rerouteOnTimeout: false, rerouteTo: "agent-B1" });
    });

    it("falls back to defaults when source fields are missing", () => {
      const result = normalizeHumanInputRequest(
        { requestId: "req-1" },
        { kind: "feedback", state: "pending", title: "default title" },
      );
      expect(result.requestId).toBe("req-1");
      expect(result.kind).toBe("feedback");
      expect(result.state).toBe("pending");
      expect(result.title).toBe("default title");
    });

    it("resets invalid state to open", () => {
      const result = normalizeHumanInputRequest({ state: "bogus" });
      expect(result.state).toBe("open");
    });

    it("handles non-object input gracefully", () => {
      const result = normalizeHumanInputRequest(null);
      expect(result.state).toBe("open");
      expect(result.kind).toBe("human-input");
    });
  });

  describe("transitionHumanInputState", () => {
    it("allows valid transitions from open", () => {
      expect(transitionHumanInputState("open", "pending")).toBe("pending");
      expect(transitionHumanInputState("open", "escalated")).toBe("escalated");
      expect(transitionHumanInputState("open", "resolved")).toBe("resolved");
    });

    it("allows valid transitions from pending", () => {
      expect(transitionHumanInputState("pending", "answered")).toBe("answered");
      expect(transitionHumanInputState("pending", "escalated")).toBe("escalated");
      expect(transitionHumanInputState("pending", "resolved")).toBe("resolved");
    });

    it("allows valid transitions from answered", () => {
      expect(transitionHumanInputState("answered", "resolved")).toBe("resolved");
    });

    it("allows valid transitions from escalated", () => {
      expect(transitionHumanInputState("escalated", "answered")).toBe("answered");
      expect(transitionHumanInputState("escalated", "resolved")).toBe("resolved");
    });

    it("rejects transitions from resolved (terminal state)", () => {
      expect(() => transitionHumanInputState("resolved", "open")).toThrow(/Invalid transition/);
      expect(() => transitionHumanInputState("resolved", "pending")).toThrow(/Invalid transition/);
    });

    it("rejects invalid backward transitions", () => {
      expect(() => transitionHumanInputState("pending", "open")).toThrow(/Invalid transition/);
      expect(() => transitionHumanInputState("answered", "pending")).toThrow(/Invalid transition/);
      expect(() => transitionHumanInputState("answered", "open")).toThrow(/Invalid transition/);
    });

    it("throws on invalid current state", () => {
      expect(() => transitionHumanInputState("bogus", "open")).toThrow(/Invalid current state/);
    });

    it("throws on invalid target state", () => {
      expect(() => transitionHumanInputState("open", "bogus")).toThrow(/Invalid target state/);
    });
  });

  describe("isHumanInputBlocking", () => {
    it("returns true for blocking states", () => {
      expect(isHumanInputBlocking({ state: "open" })).toBe(true);
      expect(isHumanInputBlocking({ state: "pending" })).toBe(true);
      expect(isHumanInputBlocking({ state: "escalated" })).toBe(true);
    });

    it("returns false for non-blocking states", () => {
      expect(isHumanInputBlocking({ state: "answered" })).toBe(false);
      expect(isHumanInputBlocking({ state: "resolved" })).toBe(false);
    });

    it("treats missing state as open (blocking)", () => {
      expect(isHumanInputBlocking({})).toBe(true);
      expect(isHumanInputBlocking(null)).toBe(true);
    });
  });

  describe("buildHumanInputRequests", () => {
    it("builds requests from coordination clarifications", () => {
      const coordinationState = {
        clarifications: [
          {
            id: "clar-1",
            kind: "clarification-request",
            status: "open",
            summary: "Need info on API",
            detail: "Which endpoint?",
            agentId: "A1",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      const results = buildHumanInputRequests(coordinationState, []);
      expect(results).toHaveLength(1);
      expect(results[0].requestId).toBe("clar-1");
      expect(results[0].kind).toBe("clarification");
      expect(results[0].state).toBe("open");
      expect(results[0].title).toBe("Need info on API");
    });

    it("builds requests from human escalations", () => {
      const coordinationState = {
        clarifications: [],
        humanEscalations: [
          {
            id: "esc-1",
            kind: "human-escalation",
            status: "open",
            summary: "Blocked on external",
            detail: "Need operator approval",
            agentId: "A2",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      const results = buildHumanInputRequests(coordinationState, []);
      expect(results).toHaveLength(1);
      expect(results[0].requestId).toBe("esc-1");
      expect(results[0].kind).toBe("escalation");
      expect(results[0].state).toBe("escalated");
      expect(results[0].assignedTo).toBe("operator");
    });

    it("builds requests from feedback requests", () => {
      const feedbackRequests = [
        {
          id: "fb-1",
          status: "pending",
          question: "Should we proceed?",
          context: "wave 3 gate",
          agentId: "A3",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      const results = buildHumanInputRequests({}, feedbackRequests);
      expect(results).toHaveLength(1);
      expect(results[0].requestId).toBe("fb-1");
      expect(results[0].kind).toBe("feedback");
      expect(results[0].state).toBe("pending");
      expect(results[0].title).toBe("Should we proceed?");
    });

    it("combines all sources into a single array", () => {
      const coordinationState = {
        clarifications: [
          {
            id: "clar-1",
            kind: "clarification-request",
            status: "open",
            summary: "Q1",
            agentId: "A1",
          },
        ],
        humanEscalations: [
          {
            id: "esc-1",
            kind: "human-escalation",
            status: "open",
            summary: "E1",
            agentId: "A2",
          },
        ],
      };
      const feedbackRequests = [
        { id: "fb-1", status: "pending", question: "F1", agentId: "A3" },
      ];
      const results = buildHumanInputRequests(coordinationState, feedbackRequests);
      expect(results).toHaveLength(3);
    });

    it("maps resolved coordination status to resolved state", () => {
      const coordinationState = {
        clarifications: [
          {
            id: "clar-done",
            kind: "clarification-request",
            status: "resolved",
            summary: "Done",
            agentId: "A1",
          },
        ],
      };
      const results = buildHumanInputRequests(coordinationState, []);
      expect(results[0].state).toBe("resolved");
    });

    it("maps in_progress coordination status to pending", () => {
      const coordinationState = {
        clarifications: [
          {
            id: "clar-ip",
            kind: "clarification-request",
            status: "in_progress",
            summary: "Working",
            agentId: "A1",
          },
        ],
      };
      const results = buildHumanInputRequests(coordinationState, []);
      expect(results[0].state).toBe("pending");
    });

    it("handles null and empty inputs", () => {
      expect(buildHumanInputRequests(null, null)).toEqual([]);
      expect(buildHumanInputRequests({}, [])).toEqual([]);
    });
  });

  describe("evaluateHumanInputTimeout", () => {
    it("detects an expired request", () => {
      const createdAt = new Date(Date.now() - 400000).toISOString();
      const request = normalizeHumanInputRequest({
        createdAt,
        timeoutPolicy: { maxWaitMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request);
      expect(result.expired).toBe(true);
      expect(result.shouldEscalate).toBe(true);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(300000);
    });

    it("detects a non-expired but escalation-eligible request", () => {
      const createdAt = new Date(Date.now() - 200000).toISOString();
      const request = normalizeHumanInputRequest({
        createdAt,
        timeoutPolicy: { maxWaitMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request);
      expect(result.expired).toBe(false);
      expect(result.shouldEscalate).toBe(true);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(120000);
    });

    it("detects a fresh request", () => {
      const createdAt = new Date(Date.now() - 10000).toISOString();
      const request = normalizeHumanInputRequest({
        createdAt,
        timeoutPolicy: { maxWaitMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request);
      expect(result.expired).toBe(false);
      expect(result.shouldEscalate).toBe(false);
      expect(result.elapsedMs).toBeLessThan(120000);
    });

    it("handles missing createdAt gracefully", () => {
      const result = evaluateHumanInputTimeout({});
      expect(result.expired).toBe(false);
      expect(result.shouldEscalate).toBe(false);
      expect(result.elapsedMs).toBe(0);
    });

    it("uses custom now parameter", () => {
      const createdAt = "2026-01-01T00:00:00.000Z";
      const now = Date.parse("2026-01-01T00:06:00.000Z"); // 6 minutes later
      const request = normalizeHumanInputRequest({
        createdAt,
        timeoutPolicy: { maxWaitMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request, now);
      expect(result.expired).toBe(true);
      expect(result.elapsedMs).toBe(360000);
    });
  });

  describe("computeHumanInputMetrics", () => {
    it("computes metrics for a mix of states", () => {
      const requests = [
        normalizeHumanInputRequest({ state: "open" }),
        normalizeHumanInputRequest({ state: "open" }),
        normalizeHumanInputRequest({ state: "pending" }),
        normalizeHumanInputRequest({ state: "answered" }),
        normalizeHumanInputRequest({ state: "escalated" }),
        normalizeHumanInputRequest({
          state: "resolved",
          createdAt: "2026-01-01T00:00:00.000Z",
          resolvedAt: "2026-01-01T00:05:00.000Z",
        }),
        normalizeHumanInputRequest({
          state: "resolved",
          createdAt: "2026-01-01T00:00:00.000Z",
          resolvedAt: "2026-01-01T00:10:00.000Z",
        }),
      ];
      const metrics = computeHumanInputMetrics(requests);
      expect(metrics.total).toBe(7);
      expect(metrics.open).toBe(2);
      expect(metrics.pending).toBe(1);
      expect(metrics.answered).toBe(1);
      expect(metrics.escalated).toBe(1);
      expect(metrics.resolved).toBe(2);
      expect(metrics.blocking).toBe(4); // 2 open + 1 pending + 1 escalated
      expect(metrics.avgResolutionMs).toBe(450000); // average of 5min + 10min
    });

    it("returns null avgResolutionMs when no resolved requests have timestamps", () => {
      const requests = [
        normalizeHumanInputRequest({ state: "open" }),
        normalizeHumanInputRequest({ state: "resolved" }), // no createdAt/resolvedAt pair
      ];
      const metrics = computeHumanInputMetrics(requests);
      expect(metrics.avgResolutionMs).toBeNull();
    });

    it("counts overdue requests", () => {
      const oldCreatedAt = new Date(Date.now() - 400000).toISOString();
      const requests = [
        normalizeHumanInputRequest({
          state: "open",
          createdAt: oldCreatedAt,
          timeoutPolicy: { maxWaitMs: 300000, escalateAfterMs: 120000 },
        }),
        normalizeHumanInputRequest({
          state: "pending",
          createdAt: new Date().toISOString(),
          timeoutPolicy: { maxWaitMs: 300000, escalateAfterMs: 120000 },
        }),
      ];
      const metrics = computeHumanInputMetrics(requests);
      expect(metrics.overdueCount).toBe(1);
    });

    it("handles empty array", () => {
      const metrics = computeHumanInputMetrics([]);
      expect(metrics.total).toBe(0);
      expect(metrics.blocking).toBe(0);
      expect(metrics.overdueCount).toBe(0);
      expect(metrics.avgResolutionMs).toBeNull();
    });

    it("handles non-array input", () => {
      const metrics = computeHumanInputMetrics(null);
      expect(metrics.total).toBe(0);
    });
  });

  describe("constants", () => {
    it("HUMAN_INPUT_STATES contains all five states", () => {
      expect(HUMAN_INPUT_STATES.size).toBe(5);
      expect(HUMAN_INPUT_STATES.has("open")).toBe(true);
      expect(HUMAN_INPUT_STATES.has("pending")).toBe(true);
      expect(HUMAN_INPUT_STATES.has("answered")).toBe(true);
      expect(HUMAN_INPUT_STATES.has("escalated")).toBe(true);
      expect(HUMAN_INPUT_STATES.has("resolved")).toBe(true);
    });

    it("HUMAN_INPUT_VALID_TRANSITIONS has entries for all states", () => {
      for (const state of HUMAN_INPUT_STATES) {
        expect(HUMAN_INPUT_VALID_TRANSITIONS).toHaveProperty(state);
        expect(Array.isArray(HUMAN_INPUT_VALID_TRANSITIONS[state])).toBe(true);
      }
    });

    it("resolved has no valid transitions", () => {
      expect(HUMAN_INPUT_VALID_TRANSITIONS.resolved).toEqual([]);
    });
  });
});
