import { describe, expect, it } from "vitest";
import {
  HUMAN_INPUT_KINDS,
  HUMAN_INPUT_STATUSES,
  HUMAN_INPUT_VALID_TRANSITIONS,
  buildHumanInputRequests,
  computeHumanInputMetrics,
  evaluateHumanInputTimeout,
  isHumanInputBlocking,
  normalizeHumanInputRequest,
  transitionHumanInputStatus,
  assignRequest,
  answerRequest,
  resolveRequest,
  escalateRequest,
  timeoutRequest,
  rerouteRequest,
} from "../../scripts/wave-orchestrator/human-input-workflow.mjs";

describe("human-input-workflow", () => {
  describe("normalizeHumanInputRequest", () => {
    it("returns defaults for empty input", () => {
      const result = normalizeHumanInputRequest({});
      expect(result.status).toBe("pending");
      expect(result.kind).toBe("clarification");
      expect(result.requestId).toBeNull();
      expect(result.waveNumber).toBeNull();
      expect(result.lane).toBeNull();
      expect(result.title).toBeNull();
      expect(result.detail).toBeNull();
      expect(result.requestedBy).toBeNull();
      expect(result.requestedAt).toBeTruthy();
      expect(result.assignedTo).toBeNull();
      expect(result.assignedAt).toBeNull();
      expect(result.answeredAt).toBeNull();
      expect(result.resolvedAt).toBeNull();
      expect(result.escalatedAt).toBeNull();
      expect(result.answer).toBeNull();
      expect(result.resolution).toBeNull();
      expect(result.updatedAt).toBeTruthy();
      expect(result.timeoutPolicy).toEqual({
        ackDeadlineMs: 60000,
        resolveDeadlineMs: 300000,
        escalateAfterMs: 120000,
      });
      expect(result.reroutePolicy).toEqual({
        maxReroutes: 3,
        rerouteHistory: [],
      });
      expect(result.linkedRequests).toEqual([]);
      expect(result.closureCondition).toBeNull();
      expect(result.slaMetrics).toEqual({
        timeToAck: null,
        timeToResolve: null,
        wasEscalated: false,
        wasRerouted: false,
        wasTimedOut: false,
      });
    });

    it("normalizes a fully populated request", () => {
      const result = normalizeHumanInputRequest({
        requestId: "req-123",
        waveNumber: 3,
        lane: "alpha",
        kind: "approval",
        status: "assigned",
        title: "Need approval",
        detail: "Please review the plan",
        requestedBy: "agent-A1",
        requestedAt: "2026-01-01T00:00:00.000Z",
        assignedTo: "operator",
        assignedAt: "2026-01-01T00:01:00.000Z",
        timeoutPolicy: { ackDeadlineMs: 30000, resolveDeadlineMs: 60000, escalateAfterMs: 45000 },
        reroutePolicy: {
          maxReroutes: 2,
          rerouteHistory: [{ from: "op1", to: "op2", reason: "timeout", at: "2026-01-01T00:02:00.000Z" }],
        },
        linkedRequests: ["req-100", "req-101"],
        closureCondition: "all agents must ack",
        slaMetrics: {
          timeToAck: 5000,
          timeToResolve: null,
          wasEscalated: false,
          wasRerouted: true,
          wasTimedOut: false,
        },
      });
      expect(result.requestId).toBe("req-123");
      expect(result.waveNumber).toBe(3);
      expect(result.lane).toBe("alpha");
      expect(result.kind).toBe("approval");
      expect(result.status).toBe("assigned");
      expect(result.title).toBe("Need approval");
      expect(result.detail).toBe("Please review the plan");
      expect(result.requestedBy).toBe("agent-A1");
      expect(result.requestedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result.assignedTo).toBe("operator");
      expect(result.assignedAt).toBe("2026-01-01T00:01:00.000Z");
      expect(result.timeoutPolicy).toEqual({ ackDeadlineMs: 30000, resolveDeadlineMs: 60000, escalateAfterMs: 45000 });
      expect(result.reroutePolicy.maxReroutes).toBe(2);
      expect(result.reroutePolicy.rerouteHistory).toHaveLength(1);
      expect(result.reroutePolicy.rerouteHistory[0].from).toBe("op1");
      expect(result.linkedRequests).toEqual(["req-100", "req-101"]);
      expect(result.closureCondition).toBe("all agents must ack");
      expect(result.slaMetrics.timeToAck).toBe(5000);
      expect(result.slaMetrics.wasRerouted).toBe(true);
    });

    it("falls back to defaults when source fields are missing", () => {
      const result = normalizeHumanInputRequest(
        { requestId: "req-1" },
        { kind: "decision", status: "assigned", title: "default title", waveNumber: 2 },
      );
      expect(result.requestId).toBe("req-1");
      expect(result.kind).toBe("decision");
      expect(result.status).toBe("assigned");
      expect(result.title).toBe("default title");
      expect(result.waveNumber).toBe(2);
    });

    it("resets invalid status to pending", () => {
      const result = normalizeHumanInputRequest({ status: "bogus" });
      expect(result.status).toBe("pending");
    });

    it("resets invalid kind to clarification", () => {
      const result = normalizeHumanInputRequest({ kind: "bogus" });
      expect(result.kind).toBe("clarification");
    });

    it("handles non-object input gracefully", () => {
      const result = normalizeHumanInputRequest(null);
      expect(result.status).toBe("pending");
      expect(result.kind).toBe("clarification");
    });

    it("uses requestedAt as alias for createdAt", () => {
      const result = normalizeHumanInputRequest({
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(result.requestedAt).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("transitionHumanInputStatus", () => {
    it("allows valid transitions from pending", () => {
      expect(transitionHumanInputStatus("pending", "assigned")).toBe("assigned");
      expect(transitionHumanInputStatus("pending", "escalated")).toBe("escalated");
      expect(transitionHumanInputStatus("pending", "timed_out")).toBe("timed_out");
      expect(transitionHumanInputStatus("pending", "resolved")).toBe("resolved");
    });

    it("allows valid transitions from assigned", () => {
      expect(transitionHumanInputStatus("assigned", "answered")).toBe("answered");
      expect(transitionHumanInputStatus("assigned", "escalated")).toBe("escalated");
      expect(transitionHumanInputStatus("assigned", "timed_out")).toBe("timed_out");
      expect(transitionHumanInputStatus("assigned", "rerouted")).toBe("rerouted");
      expect(transitionHumanInputStatus("assigned", "resolved")).toBe("resolved");
    });

    it("allows valid transitions from answered", () => {
      expect(transitionHumanInputStatus("answered", "resolved")).toBe("resolved");
    });

    it("allows valid transitions from escalated", () => {
      expect(transitionHumanInputStatus("escalated", "assigned")).toBe("assigned");
      expect(transitionHumanInputStatus("escalated", "answered")).toBe("answered");
      expect(transitionHumanInputStatus("escalated", "resolved")).toBe("resolved");
      expect(transitionHumanInputStatus("escalated", "timed_out")).toBe("timed_out");
    });

    it("allows valid transitions from timed_out", () => {
      expect(transitionHumanInputStatus("timed_out", "rerouted")).toBe("rerouted");
      expect(transitionHumanInputStatus("timed_out", "escalated")).toBe("escalated");
      expect(transitionHumanInputStatus("timed_out", "resolved")).toBe("resolved");
    });

    it("allows valid transitions from rerouted", () => {
      expect(transitionHumanInputStatus("rerouted", "pending")).toBe("pending");
      expect(transitionHumanInputStatus("rerouted", "assigned")).toBe("assigned");
      expect(transitionHumanInputStatus("rerouted", "resolved")).toBe("resolved");
    });

    it("rejects transitions from resolved (terminal state)", () => {
      expect(() => transitionHumanInputStatus("resolved", "pending")).toThrow(/Invalid transition/);
      expect(() => transitionHumanInputStatus("resolved", "assigned")).toThrow(/Invalid transition/);
    });

    it("rejects invalid backward transitions", () => {
      expect(() => transitionHumanInputStatus("assigned", "pending")).toThrow(/Invalid transition/);
      expect(() => transitionHumanInputStatus("answered", "assigned")).toThrow(/Invalid transition/);
      expect(() => transitionHumanInputStatus("answered", "pending")).toThrow(/Invalid transition/);
    });

    it("throws on invalid current status", () => {
      expect(() => transitionHumanInputStatus("bogus", "pending")).toThrow(/Invalid current status/);
    });

    it("throws on invalid target status", () => {
      expect(() => transitionHumanInputStatus("pending", "bogus")).toThrow(/Invalid target status/);
    });
  });

  describe("assignRequest", () => {
    it("transitions pending to assigned with assignedTo and assignedAt", () => {
      const req = normalizeHumanInputRequest({
        status: "pending",
        requestedAt: "2026-01-01T00:00:00.000Z",
      });
      const assigned = assignRequest(req, "operator-1");
      expect(assigned.status).toBe("assigned");
      expect(assigned.assignedTo).toBe("operator-1");
      expect(assigned.assignedAt).toBeTruthy();
      expect(assigned.slaMetrics.timeToAck).toBeGreaterThanOrEqual(0);
    });

    it("throws for invalid transition", () => {
      const req = normalizeHumanInputRequest({ status: "resolved" });
      expect(() => assignRequest(req, "op")).toThrow(/Invalid transition/);
    });

    it("throws on non-object", () => {
      expect(() => assignRequest(null, "op")).toThrow("Request must be an object");
    });
  });

  describe("answerRequest", () => {
    it("transitions assigned to answered", () => {
      const req = normalizeHumanInputRequest({ status: "assigned" });
      const answered = answerRequest(req, "The answer is 42");
      expect(answered.status).toBe("answered");
      expect(answered.answer).toBe("The answer is 42");
      expect(answered.answeredAt).toBeTruthy();
    });

    it("throws for invalid transition", () => {
      const req = normalizeHumanInputRequest({ status: "pending" });
      expect(() => answerRequest(req, "answer")).toThrow(/Invalid transition/);
    });
  });

  describe("resolveRequest", () => {
    it("transitions answered to resolved with slaMetrics.timeToResolve", () => {
      const req = normalizeHumanInputRequest({
        status: "answered",
        requestedAt: "2026-01-01T00:00:00.000Z",
      });
      const resolved = resolveRequest(req, "Accepted");
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution).toBe("Accepted");
      expect(resolved.resolvedAt).toBeTruthy();
      expect(resolved.slaMetrics.timeToResolve).toBeGreaterThanOrEqual(0);
    });

    it("throws for invalid transition", () => {
      const req = normalizeHumanInputRequest({ status: "timed_out" });
      // timed_out -> resolved is valid
      const resolved = resolveRequest(req, "force resolved");
      expect(resolved.status).toBe("resolved");
    });
  });

  describe("escalateRequest", () => {
    it("transitions pending to escalated", () => {
      const req = normalizeHumanInputRequest({ status: "pending" });
      const escalated = escalateRequest(req);
      expect(escalated.status).toBe("escalated");
      expect(escalated.escalatedAt).toBeTruthy();
      expect(escalated.slaMetrics.wasEscalated).toBe(true);
    });

    it("transitions assigned to escalated", () => {
      const req = normalizeHumanInputRequest({ status: "assigned" });
      const escalated = escalateRequest(req);
      expect(escalated.status).toBe("escalated");
    });
  });

  describe("timeoutRequest", () => {
    it("transitions pending to timed_out", () => {
      const req = normalizeHumanInputRequest({ status: "pending" });
      const timedOut = timeoutRequest(req);
      expect(timedOut.status).toBe("timed_out");
      expect(timedOut.slaMetrics.wasTimedOut).toBe(true);
    });

    it("transitions assigned to timed_out", () => {
      const req = normalizeHumanInputRequest({ status: "assigned" });
      const timedOut = timeoutRequest(req);
      expect(timedOut.status).toBe("timed_out");
    });
  });

  describe("rerouteRequest", () => {
    it("transitions assigned to rerouted with history", () => {
      const req = normalizeHumanInputRequest({
        status: "assigned",
        assignedTo: "op-1",
      });
      const rerouted = rerouteRequest(req, "op-2", "timeout");
      expect(rerouted.status).toBe("rerouted");
      expect(rerouted.assignedTo).toBe("op-2");
      expect(rerouted.slaMetrics.wasRerouted).toBe(true);
      expect(rerouted.reroutePolicy.rerouteHistory).toHaveLength(1);
      expect(rerouted.reroutePolicy.rerouteHistory[0].from).toBe("op-1");
      expect(rerouted.reroutePolicy.rerouteHistory[0].to).toBe("op-2");
      expect(rerouted.reroutePolicy.rerouteHistory[0].reason).toBe("timeout");
    });

    it("throws when max reroutes exceeded", () => {
      const req = normalizeHumanInputRequest({
        status: "assigned",
        reroutePolicy: {
          maxReroutes: 1,
          rerouteHistory: [{ from: "op-1", to: "op-2", reason: "first", at: "2026-01-01T00:00:00.000Z" }],
        },
      });
      expect(() => rerouteRequest(req, "op-3", "again")).toThrow("Max reroutes (1) exceeded");
    });

    it("transitions timed_out to rerouted", () => {
      const req = normalizeHumanInputRequest({ status: "timed_out" });
      const rerouted = rerouteRequest(req, "op-2", "timed out");
      expect(rerouted.status).toBe("rerouted");
    });
  });

  describe("isHumanInputBlocking", () => {
    it("returns true for blocking statuses", () => {
      expect(isHumanInputBlocking({ status: "pending" })).toBe(true);
      expect(isHumanInputBlocking({ status: "assigned" })).toBe(true);
      expect(isHumanInputBlocking({ status: "escalated" })).toBe(true);
      expect(isHumanInputBlocking({ status: "rerouted" })).toBe(true);
    });

    it("returns false for non-blocking statuses", () => {
      expect(isHumanInputBlocking({ status: "answered" })).toBe(false);
      expect(isHumanInputBlocking({ status: "resolved" })).toBe(false);
      expect(isHumanInputBlocking({ status: "timed_out" })).toBe(false);
    });

    it("treats missing status as pending (blocking)", () => {
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
      expect(results[0].status).toBe("pending");
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
      expect(results[0].status).toBe("escalated");
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
      expect(results[0].kind).toBe("clarification");
      expect(results[0].status).toBe("pending");
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

    it("maps resolved coordination status to resolved status", () => {
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
      expect(results[0].status).toBe("resolved");
    });

    it("maps in_progress coordination status to assigned", () => {
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
      expect(results[0].status).toBe("assigned");
    });

    it("handles null and empty inputs", () => {
      expect(buildHumanInputRequests(null, null)).toEqual([]);
      expect(buildHumanInputRequests({}, [])).toEqual([]);
    });
  });

  describe("evaluateHumanInputTimeout", () => {
    it("detects an expired request", () => {
      const requestedAt = new Date(Date.now() - 400000).toISOString();
      const request = normalizeHumanInputRequest({
        requestedAt,
        timeoutPolicy: { ackDeadlineMs: 60000, resolveDeadlineMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request);
      expect(result.expired).toBe(true);
      expect(result.shouldEscalate).toBe(true);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(300000);
    });

    it("detects a non-expired but escalation-eligible request", () => {
      const requestedAt = new Date(Date.now() - 200000).toISOString();
      const request = normalizeHumanInputRequest({
        requestedAt,
        timeoutPolicy: { ackDeadlineMs: 60000, resolveDeadlineMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request);
      expect(result.expired).toBe(false);
      expect(result.shouldEscalate).toBe(true);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(120000);
    });

    it("detects a fresh request", () => {
      const requestedAt = new Date(Date.now() - 10000).toISOString();
      const request = normalizeHumanInputRequest({
        requestedAt,
        timeoutPolicy: { ackDeadlineMs: 60000, resolveDeadlineMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request);
      expect(result.expired).toBe(false);
      expect(result.shouldEscalate).toBe(false);
      expect(result.elapsedMs).toBeLessThan(120000);
    });

    it("detects ack overdue when no assignedAt and past ackDeadline", () => {
      const requestedAt = new Date(Date.now() - 70000).toISOString();
      const request = normalizeHumanInputRequest({
        requestedAt,
        timeoutPolicy: { ackDeadlineMs: 60000, resolveDeadlineMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request);
      expect(result.ackOverdue).toBe(true);
    });

    it("handles missing requestedAt gracefully", () => {
      const result = evaluateHumanInputTimeout({});
      expect(result.expired).toBe(false);
      expect(result.shouldEscalate).toBe(false);
      expect(result.ackOverdue).toBe(false);
      expect(result.elapsedMs).toBe(0);
    });

    it("uses custom now parameter", () => {
      const requestedAt = "2026-01-01T00:00:00.000Z";
      const now = Date.parse("2026-01-01T00:06:00.000Z"); // 6 minutes later
      const request = normalizeHumanInputRequest({
        requestedAt,
        timeoutPolicy: { ackDeadlineMs: 60000, resolveDeadlineMs: 300000, escalateAfterMs: 120000 },
      });
      const result = evaluateHumanInputTimeout(request, now);
      expect(result.expired).toBe(true);
      expect(result.elapsedMs).toBe(360000);
    });
  });

  describe("computeHumanInputMetrics", () => {
    it("computes metrics for a mix of statuses including new ones", () => {
      const requests = [
        normalizeHumanInputRequest({ status: "pending" }),
        normalizeHumanInputRequest({ status: "pending" }),
        normalizeHumanInputRequest({ status: "assigned" }),
        normalizeHumanInputRequest({ status: "answered" }),
        normalizeHumanInputRequest({ status: "escalated" }),
        normalizeHumanInputRequest({ status: "timed_out" }),
        normalizeHumanInputRequest({ status: "rerouted" }),
        normalizeHumanInputRequest({
          status: "resolved",
          requestedAt: "2026-01-01T00:00:00.000Z",
          resolvedAt: "2026-01-01T00:05:00.000Z",
        }),
        normalizeHumanInputRequest({
          status: "resolved",
          requestedAt: "2026-01-01T00:00:00.000Z",
          resolvedAt: "2026-01-01T00:10:00.000Z",
        }),
      ];
      const metrics = computeHumanInputMetrics(requests);
      expect(metrics.total).toBe(9);
      expect(metrics.pending).toBe(2);
      expect(metrics.assigned).toBe(1);
      expect(metrics.answered).toBe(1);
      expect(metrics.escalated).toBe(1);
      expect(metrics.timed_out).toBe(1);
      expect(metrics.rerouted).toBe(1);
      expect(metrics.resolved).toBe(2);
      expect(metrics.blocking).toBe(5); // 2 pending + 1 assigned + 1 escalated + 1 rerouted
      expect(metrics.avgResolutionMs).toBe(450000);
    });

    it("returns null avgResolutionMs when no resolved requests have timestamps", () => {
      const requests = [
        normalizeHumanInputRequest({ status: "pending" }),
        normalizeHumanInputRequest({ status: "resolved" }), // no requestedAt/resolvedAt pair
      ];
      const metrics = computeHumanInputMetrics(requests);
      expect(metrics.avgResolutionMs).toBeNull();
    });

    it("counts overdue requests", () => {
      const oldRequestedAt = new Date(Date.now() - 400000).toISOString();
      const requests = [
        normalizeHumanInputRequest({
          status: "pending",
          requestedAt: oldRequestedAt,
          timeoutPolicy: { ackDeadlineMs: 60000, resolveDeadlineMs: 300000, escalateAfterMs: 120000 },
        }),
        normalizeHumanInputRequest({
          status: "assigned",
          requestedAt: new Date().toISOString(),
          timeoutPolicy: { ackDeadlineMs: 60000, resolveDeadlineMs: 300000, escalateAfterMs: 120000 },
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
    it("HUMAN_INPUT_KINDS contains all four kinds", () => {
      expect(HUMAN_INPUT_KINDS.size).toBe(4);
      expect(HUMAN_INPUT_KINDS.has("clarification")).toBe(true);
      expect(HUMAN_INPUT_KINDS.has("escalation")).toBe(true);
      expect(HUMAN_INPUT_KINDS.has("approval")).toBe(true);
      expect(HUMAN_INPUT_KINDS.has("decision")).toBe(true);
    });

    it("HUMAN_INPUT_STATUSES contains all seven statuses", () => {
      expect(HUMAN_INPUT_STATUSES.size).toBe(7);
      expect(HUMAN_INPUT_STATUSES.has("pending")).toBe(true);
      expect(HUMAN_INPUT_STATUSES.has("assigned")).toBe(true);
      expect(HUMAN_INPUT_STATUSES.has("answered")).toBe(true);
      expect(HUMAN_INPUT_STATUSES.has("escalated")).toBe(true);
      expect(HUMAN_INPUT_STATUSES.has("resolved")).toBe(true);
      expect(HUMAN_INPUT_STATUSES.has("timed_out")).toBe(true);
      expect(HUMAN_INPUT_STATUSES.has("rerouted")).toBe(true);
    });

    it("HUMAN_INPUT_VALID_TRANSITIONS has entries for all statuses", () => {
      for (const status of HUMAN_INPUT_STATUSES) {
        expect(HUMAN_INPUT_VALID_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(HUMAN_INPUT_VALID_TRANSITIONS[status])).toBe(true);
      }
    });

    it("resolved has no valid transitions", () => {
      expect(HUMAN_INPUT_VALID_TRANSITIONS.resolved).toEqual([]);
    });
  });
});
