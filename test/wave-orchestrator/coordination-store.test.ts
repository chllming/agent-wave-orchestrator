import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCoordinationResponseMetrics,
  compileAgentInbox,
  compileSharedSummary,
  coordinationBlockerSeverity,
  coordinationRecordBlocksWave,
  isClarificationLinkedRequest,
  materializeCoordinationState,
  normalizeCoordinationRecord,
  readMaterializedCoordinationState,
  serializeCoordinationState,
  updateSeedRecords,
} from "../../scripts/wave-orchestrator/coordination-store.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-coordination-store-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("updateSeedRecords", () => {
  it("refreshes launcher seed records when the wave definition changes", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-0.jsonl");

    updateSeedRecords(logPath, {
      lane: "main",
      wave: 0,
      agents: [
        {
          agentId: "A1",
          title: "Initial title",
          prompt: "First prompt",
          ownedPaths: ["src/first.ts"],
        },
      ],
      componentPromotions: [],
      sharedPlanDocs: [],
      feedbackRequests: [],
    });

    updateSeedRecords(logPath, {
      lane: "main",
      wave: 0,
      agents: [
        {
          agentId: "A1",
          title: "Updated title",
          prompt: "Second prompt",
          ownedPaths: ["src/second.ts"],
        },
      ],
      componentPromotions: [],
      sharedPlanDocs: [],
      feedbackRequests: [],
    });

    const state = readMaterializedCoordinationState(logPath);
    expect(state.latestRecords).toHaveLength(1);
    expect(state.latestRecords[0]).toMatchObject({
      id: "wave-0-agent-A1-request",
      summary: "Wave 0 assigned to A1: Updated title",
      detail: "Second prompt",
      artifactRefs: ["src/second.ts"],
    });
  });
});

describe("normalizeCoordinationRecord", () => {
  it("defaults resolved-by-policy records to resolved status", () => {
    const record = normalizeCoordinationRecord({
      kind: "resolved-by-policy",
      lane: "main",
      wave: 11,
      agentId: "A9",
      summary: "Resolved helper assignment coord-request-6a0e96cf",
    });

    expect(record.status).toBe("resolved");
  });

  it("derives blocker severity and blocking defaults from coordination kind", () => {
    const request = normalizeCoordinationRecord({
      kind: "request",
      lane: "main",
      wave: 11,
      agentId: "A1",
      summary: "Need a shared-plan follow-up",
      targets: ["agent:A9"],
    });
    const advisory = normalizeCoordinationRecord({
      kind: "blocker",
      lane: "main",
      wave: 11,
      agentId: "A2",
      summary: "Historical note only",
      blocking: false,
    });

    expect(request.blocking).toBe(true);
    expect(request.blockerSeverity).toBe("closure-critical");
    expect(coordinationBlockerSeverity(request)).toBe("closure-critical");
    expect(coordinationRecordBlocksWave(request)).toBe(true);

    expect(advisory.blocking).toBe(false);
    expect(advisory.blockerSeverity).toBe("advisory");
    expect(coordinationBlockerSeverity(advisory)).toBe("advisory");
    expect(coordinationRecordBlocksWave(advisory)).toBe(false);
  });
});

describe("serializeCoordinationState", () => {
  it("converts materialized maps to plain JSON-safe objects", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-0.jsonl");

    updateSeedRecords(logPath, {
      lane: "main",
      wave: 0,
      agents: [
        {
          agentId: "A1",
          title: "Runtime",
          prompt: "Own the runtime",
          ownedPaths: ["src/runtime.ts"],
        },
      ],
      componentPromotions: [],
      sharedPlanDocs: [],
      feedbackRequests: [],
    });

    const serialized = serializeCoordinationState(readMaterializedCoordinationState(logPath));
    expect(serialized.byId["wave-0-agent-A1-request"]).toMatchObject({
      agentId: "launcher",
      summary: "Wave 0 assigned to A1: Runtime",
    });
    expect(serialized.recordsByTarget["agent:A1"]).toHaveLength(1);
  });
});

describe("clarification linking", () => {
  it("requires an exact clarification id match for closureCondition links", () => {
    expect(
      isClarificationLinkedRequest(
        { closureCondition: "clarification:clarify-b" },
        new Set(["clarify-a"]),
      ),
    ).toBe(false);
    expect(
      isClarificationLinkedRequest(
        { closureCondition: "clarification:clarify-b" },
        new Set(["clarify-b"]),
      ),
    ).toBe(true);
  });
});

describe("compileAgentInbox", () => {
  it("surfaces open coordination relevant to owned paths and components via artifactRefs", () => {
    const state = materializeCoordinationState([
      {
        id: "block-owned-file",
        kind: "blocker",
        lane: "main",
        wave: 0,
        agentId: "A2",
        targets: [],
        status: "open",
        priority: "high",
        artifactRefs: ["src/owned.ts"],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "medium",
        summary: "Owned file blocked",
        detail: "Need follow-up on src/owned.ts",
        source: "agent",
      },
      {
        id: "evidence-owned-dir",
        kind: "evidence",
        lane: "main",
        wave: 0,
        agentId: "A3",
        targets: [],
        status: "open",
        priority: "normal",
        artifactRefs: ["src/runtime/helpers.ts"],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "medium",
        summary: "Owned directory evidence",
        detail: "Runtime helper changed",
        source: "agent",
      },
      {
        id: "request-owned-component",
        kind: "request",
        lane: "main",
        wave: 0,
        agentId: "A8",
        targets: [],
        status: "open",
        priority: "normal",
        artifactRefs: ["runtime-engine"],
        dependsOn: [],
        closureCondition: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: "medium",
        summary: "Runtime component follow-up",
        detail: "Need more proof for the runtime-engine component.",
        source: "agent",
      },
    ]);

    const inbox = compileAgentInbox({
      wave: { wave: 0 },
      agent: {
        agentId: "A1",
        ownedPaths: ["src/owned.ts", "src/runtime"],
        components: ["runtime-engine"],
      },
      state,
    });

    expect(inbox.text).toContain("## Relevant open coordination");
    expect(inbox.text).toContain("Owned file blocked");
    expect(inbox.text).toContain("Owned directory evidence");
    expect(inbox.text).toContain("Runtime component follow-up");
  });

  it("computes overdue acknowledgement and clarification timing from canonical state", () => {
    const state = materializeCoordinationState([
      {
        id: "clarify-runtime",
        kind: "clarification-request",
        lane: "main",
        wave: 0,
        agentId: "A1",
        targets: ["launcher"],
        status: "in_progress",
        priority: "high",
        artifactRefs: ["src/runtime.ts"],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:01:00.000Z",
        confidence: "medium",
        summary: "Need runtime guidance",
        detail: "Clarification remains unresolved.",
        source: "agent",
      },
      {
        id: "route-clarify-runtime-1",
        kind: "request",
        lane: "main",
        wave: 0,
        agentId: "launcher",
        targets: ["agent:A8"],
        status: "open",
        priority: "high",
        artifactRefs: ["src/runtime.ts"],
        dependsOn: ["clarify-runtime"],
        closureCondition: "clarification:clarify-runtime",
        createdAt: "2026-03-22T00:00:30.000Z",
        updatedAt: "2026-03-22T00:00:30.000Z",
        confidence: "high",
        summary: "Clarification follow-up",
        detail: "Please answer the runtime question.",
        source: "launcher",
      },
    ]);

    const responseMetrics = buildCoordinationResponseMetrics(state, {
      nowMs: Date.parse("2026-03-22T00:12:00.000Z"),
      ackTimeoutMs: 5 * 60 * 1000,
      resolutionStaleMs: 10 * 60 * 1000,
    });

    expect(responseMetrics.overdueAckCount).toBe(1);
    expect(responseMetrics.overdueAckRecordIds).toEqual(["route-clarify-runtime-1"]);
    expect(responseMetrics.overdueClarificationCount).toBe(1);
    expect(responseMetrics.overdueClarificationIds).toEqual(["clarify-runtime"]);
    expect(responseMetrics.oldestUnackedRequestAgeMs).toBe(690000);
  });

  it("ignores non-blocking coordination when computing overdue and oldest-open metrics", () => {
    const state = materializeCoordinationState([
      {
        id: "advisory-request",
        kind: "request",
        lane: "main",
        wave: 0,
        agentId: "A1",
        targets: ["agent:A9"],
        status: "open",
        priority: "high",
        blocking: false,
        blockerSeverity: "advisory",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        confidence: "medium",
        summary: "Optional follow-up",
        detail: "Keep visible but do not block.",
        source: "launcher",
      },
      {
        id: "blocking-request",
        kind: "request",
        lane: "main",
        wave: 0,
        agentId: "A1",
        targets: ["agent:A9"],
        status: "open",
        priority: "high",
        artifactRefs: [],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-22T00:10:00.000Z",
        updatedAt: "2026-03-22T00:10:00.000Z",
        confidence: "medium",
        summary: "Blocking follow-up",
        detail: "This one still needs an acknowledgement.",
        source: "agent",
      },
    ]);

    const responseMetrics = buildCoordinationResponseMetrics(state, {
      nowMs: Date.parse("2026-03-22T00:20:00.000Z"),
      ackTimeoutMs: 5 * 60 * 1000,
      resolutionStaleMs: 10 * 60 * 1000,
    });

    expect(responseMetrics.overdueAckRecordIds).toEqual(["blocking-request"]);
    expect(responseMetrics.overdueAckCount).toBe(1);
    expect(responseMetrics.oldestOpenCoordinationAgeMs).toBe(10 * 60 * 1000);
  });

  it("renders enriched integration evidence in shared summaries and inboxes", () => {
    const state = materializeCoordinationState([]);
    const integrationSummary = {
      recommendation: "needs-more-work",
      detail: "Integration still has open cross-component issues.",
      changedInterfaces: ["decision-1: API contract changed for runtime-engine"],
      crossComponentImpacts: ["decision-1: API contract changed [owners: A1, A2]"],
      proofGaps: ["A1: Missing integration proof."],
      deployRisks: ["A2: Deployment api ended in state failed (healthcheck-failed)."],
      docGaps: ["A1:shared:docs/plans/master-plan.md: Shared-plan reconciliation required"],
      runtimeAssignments: [],
      conflictingClaims: [],
    };

    const shared = compileSharedSummary({
      wave: { wave: 0 },
      state,
      integrationSummary,
    });
    const inbox = compileAgentInbox({
      wave: { wave: 0 },
      agent: { agentId: "A1", ownedPaths: [], components: [] },
      state,
      integrationSummary,
    });

    expect(shared.text).toContain("## Changed interfaces");
    expect(shared.text).toContain("## Deploy risks");
    expect(shared.text).toContain("API contract changed for runtime-engine");
    expect(inbox.text).toContain("Changed interfaces");
    expect(inbox.text).toContain("Cross-component impacts");
    expect(inbox.text).toContain("Deployment api ended in state failed");
  });
});
