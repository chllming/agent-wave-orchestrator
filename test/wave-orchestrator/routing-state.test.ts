import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendCoordinationRecord,
  appendDependencyTicket,
  materializeCoordinationState,
  readMaterializedCoordinationState,
} from "../../scripts/wave-orchestrator/coordination-store.mjs";
import {
  buildDependencySnapshot,
  buildRequestAssignments,
  syncAssignmentRecords,
} from "../../scripts/wave-orchestrator/routing-state.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-routing-state-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildRequestAssignments", () => {
  it("routes capability requests deterministically and ignores launcher-owned docs seed requests", () => {
    const state = materializeCoordinationState([
      {
        id: "wave-0-shared-plan-docs",
        kind: "request",
        lane: "main",
        wave: 0,
        agentId: "launcher",
        targets: ["agent:A9"],
        status: "open",
        priority: "high",
        artifactRefs: ["docs/plans/master-plan.md"],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        confidence: "medium",
        summary: "Reconcile shared-plan documentation",
        detail: "Docs steward ownership seed",
        source: "launcher",
      },
      {
        id: "request-runtime-help",
        kind: "request",
        lane: "main",
        wave: 0,
        agentId: "A8",
        targets: ["capability:runtime"],
        status: "open",
        priority: "high",
        artifactRefs: ["src/runtime.ts"],
        dependsOn: [],
        closureCondition: "",
        createdAt: "2026-03-22T00:01:00.000Z",
        updatedAt: "2026-03-22T00:01:00.000Z",
        confidence: "medium",
        summary: "Need runtime follow-up",
        detail: "Target the runtime helper role.",
        source: "agent",
      },
    ]);
    const assignments = buildRequestAssignments({
      coordinationState: state,
      agents: [
        { agentId: "A1", capabilities: ["runtime"] },
        { agentId: "A2", capabilities: ["runtime"] },
        { agentId: "A9", capabilities: ["docs-shared-plan"] },
      ],
      ledger: {
        tasks: [
          { owner: "A1", state: "in_progress" },
          { owner: "A1", state: "planned" },
          { owner: "A2", state: "in_progress" },
        ],
      },
      capabilityRouting: { preferredAgents: {} },
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      requestId: "request-runtime-help",
      target: "capability:runtime",
      assignedAgentId: "A2",
      assignmentReason: "least-busy-capability",
    });
  });
});

describe("syncAssignmentRecords", () => {
  it("writes launcher-owned assignment decisions into the coordination log", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "wave-0.jsonl");

    appendCoordinationRecord(logPath, {
      id: "request-runtime-help",
      lane: "main",
      wave: 0,
      agentId: "A8",
      kind: "request",
      targets: ["capability:runtime"],
      status: "open",
      priority: "high",
      summary: "Need runtime follow-up",
      detail: "Route this to a runtime helper.",
      source: "agent",
    });

    syncAssignmentRecords(logPath, {
      lane: "main",
      wave: 0,
      assignments: [
        {
          id: "assignment:request-runtime-help:capability-runtime",
          requestId: "request-runtime-help",
          priority: "high",
          state: "open",
          assignedAgentId: "A2",
          assignmentReason: "least-busy-capability",
          assignmentDetail: "Capability runtime routed to A2.",
          target: "capability:runtime",
          artifactRefs: ["src/runtime.ts"],
          dependsOn: [],
        },
      ],
    });

    const state = readMaterializedCoordinationState(logPath);
    expect(state.byId.get("assignment:request-runtime-help:capability-runtime")).toMatchObject({
      kind: "decision",
      agentId: "launcher",
      targets: ["agent:A2"],
      summary: "Assignment for request-runtime-help: A2",
    });
  });
});

describe("buildDependencySnapshot", () => {
  it("classifies inbound and outbound tickets and assigns inbound capability targets", () => {
    const dir = makeTempDir();
    appendDependencyTicket(dir, "main", {
      id: "dep-inbound",
      lane: "main",
      wave: 0,
      ownerLane: "main",
      ownerWave: 0,
      requesterLane: "release",
      requesterWave: 2,
      agentId: "launcher",
      kind: "request",
      targets: ["capability:docs-shared-plan"],
      status: "open",
      priority: "high",
      summary: "Need shared-plan note from main",
      detail: "required=true",
      closureCondition: "required=true",
      required: true,
    });
    appendDependencyTicket(dir, "release", {
      id: "dep-outbound",
      lane: "release",
      wave: 3,
      ownerLane: "release",
      ownerWave: 3,
      requesterLane: "main",
      requesterWave: 0,
      agentId: "launcher",
      kind: "request",
      targets: ["capability:deploy-railway"],
      status: "open",
      priority: "high",
      summary: "Need deploy proof from release lane",
      detail: "required=true",
      closureCondition: "required=true",
      required: true,
    });

    const snapshot = buildDependencySnapshot({
      dirPath: dir,
      lane: "main",
      waveNumber: 0,
      agents: [
        { agentId: "A8", capabilities: ["docs-shared-plan"] },
        { agentId: "A1", capabilities: ["runtime"] },
      ],
      ledger: { tasks: [] },
      capabilityRouting: { preferredAgents: { "docs-shared-plan": ["A8"] } },
    });

    expect(snapshot.requiredInbound).toHaveLength(1);
    expect(snapshot.requiredInbound[0]).toMatchObject({
      id: "dep-inbound",
      assignedAgentId: "A8",
      assignmentReason: "preferred-agent",
    });
    expect(snapshot.requiredOutbound).toHaveLength(1);
    expect(snapshot.requiredOutbound[0]).toMatchObject({
      id: "dep-outbound",
      requesterLane: "main",
    });
    expect(snapshot.unresolvedInboundAssignments).toEqual([]);
  });
});
