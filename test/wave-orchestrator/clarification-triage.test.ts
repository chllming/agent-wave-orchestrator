import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendCoordinationRecord,
  readMaterializedCoordinationState,
} from "../../scripts/wave-orchestrator/coordination-store.mjs";
import { triageClarificationRequests } from "../../scripts/wave-orchestrator/clarification-triage.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-clarification-triage-"));
  tempDirs.push(dir);
  return dir;
}

function makeLanePaths(dir) {
  return {
    lane: "main",
    feedbackStateDir: path.join(dir, "feedback"),
    feedbackRequestsDir: path.join(dir, "feedback", "requests"),
    feedbackTriageDir: path.join(dir, "feedback", "triage"),
    documentationAgentId: "A9",
    integrationAgentId: "A8",
    evaluatorAgentId: "A0",
  };
}

function makeWave() {
  return {
    wave: 0,
    agents: [
      {
        agentId: "A1",
        title: "Implementation",
        ownedPaths: ["src/runtime.ts"],
        components: ["runtime-engine"],
      },
      {
        agentId: "A8",
        title: "Integration Steward",
        ownedPaths: ["docs/plans/current-state.md"],
        components: [],
      },
      {
        agentId: "A9",
        title: "Documentation Steward",
        ownedPaths: ["docs/plans/master-plan.md"],
        components: [],
      },
    ],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("triageClarificationRequests", () => {
  it("keeps routed clarifications open until the linked follow-up request resolves", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeWave();
    const coordinationLogPath = path.join(dir, "coordination", "wave-0.jsonl");

    appendCoordinationRecord(coordinationLogPath, {
      id: "clarify-docs",
      lane: "main",
      wave: 0,
      agentId: "A1",
      kind: "clarification-request",
      targets: ["launcher"],
      priority: "high",
      summary: "Need shared plan update in docs/plans/master-plan.md",
      detail: "Unsure whether this belongs to implementation or documentation closure.",
      artifactRefs: ["docs/plans/master-plan.md"],
      status: "open",
      source: "agent",
    });

    const outcome = triageClarificationRequests({
      lanePaths,
      wave,
      coordinationLogPath,
      coordinationState: readMaterializedCoordinationState(coordinationLogPath),
      orchestratorId: "orch-1",
    });

    expect(outcome.changed).toBe(true);
    const updatedState = readMaterializedCoordinationState(coordinationLogPath);
    expect(updatedState.byId.get("clarify-docs")).toMatchObject({
      status: "in_progress",
    });
    expect(updatedState.byId.get("route-clarify-docs-1")).toMatchObject({
      kind: "request",
      targets: ["agent:A9"],
      status: "open",
      closureCondition: "clarification:clarify-docs",
      dependsOn: ["clarify-docs"],
    });
    expect(outcome.state.orchestratorGuidance).toHaveLength(1);
    expect(fs.existsSync(path.join(lanePaths.feedbackRequestsDir))).toBe(false);
  });

  it("resolves clarifications directly from prior coordination decisions before escalating", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeWave();
    const coordinationLogPath = path.join(dir, "coordination", "wave-0.jsonl");

    appendCoordinationRecord(coordinationLogPath, {
      id: "decision-shared-plan-owner",
      lane: "main",
      wave: 0,
      agentId: "A8",
      kind: "decision",
      targets: ["agent:A1"],
      priority: "normal",
      summary: "Shared plan changes belong to documentation stewardship.",
      detail: "Use A9 for docs/plans/master-plan.md updates.",
      artifactRefs: ["docs/plans/master-plan.md"],
      status: "resolved",
      source: "agent",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "clarify-policy",
      lane: "main",
      wave: 0,
      agentId: "A1",
      kind: "clarification-request",
      targets: ["launcher"],
      priority: "high",
      summary: "Who owns docs/plans/master-plan.md updates?",
      detail: "Need the standing ownership answer before I continue.",
      artifactRefs: ["docs/plans/master-plan.md"],
      status: "open",
      source: "agent",
    });

    const outcome = triageClarificationRequests({
      lanePaths,
      wave,
      coordinationLogPath,
      coordinationState: readMaterializedCoordinationState(coordinationLogPath),
      orchestratorId: "orch-1",
    });

    expect(outcome.changed).toBe(true);
    const updatedState = readMaterializedCoordinationState(coordinationLogPath);
    expect(updatedState.byId.get("clarify-policy")).toMatchObject({
      status: "resolved",
      detail: "Use A9 for docs/plans/master-plan.md updates.",
    });
    expect(updatedState.byId.get("triage-clarify-policy-policy")).toMatchObject({
      kind: "resolved-by-policy",
      status: "resolved",
    });
    expect(fs.existsSync(path.join(lanePaths.feedbackRequestsDir))).toBe(false);
  });

  it("keeps multi-clarification chains isolated when one follow-up resolves", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeWave();
    const coordinationLogPath = path.join(dir, "coordination", "wave-0.jsonl");

    appendCoordinationRecord(coordinationLogPath, {
      id: "clarify-a",
      lane: "main",
      wave: 0,
      agentId: "A1",
      kind: "clarification-request",
      targets: ["launcher"],
      priority: "high",
      summary: "Need a docs answer",
      detail: "Still waiting on the docs owner.",
      artifactRefs: ["docs/plans/master-plan.md"],
      status: "in_progress",
      source: "agent",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "route-clarify-a-1",
      lane: "main",
      wave: 0,
      agentId: "launcher",
      kind: "request",
      targets: ["agent:A9"],
      priority: "high",
      summary: "Clarification follow-up for A1",
      detail: "Please answer the docs ownership question.",
      artifactRefs: ["docs/plans/master-plan.md"],
      dependsOn: ["clarify-a"],
      closureCondition: "clarification:clarify-a",
      status: "open",
      source: "launcher",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "clarify-b",
      lane: "main",
      wave: 0,
      agentId: "A1",
      kind: "clarification-request",
      targets: ["launcher"],
      priority: "high",
      summary: "Need a runtime answer",
      detail: "This one has already been answered.",
      artifactRefs: ["src/runtime.ts"],
      status: "in_progress",
      source: "agent",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "route-clarify-b-1",
      lane: "main",
      wave: 0,
      agentId: "launcher",
      kind: "request",
      targets: ["agent:A8"],
      priority: "high",
      summary: "Clarification follow-up for A1",
      detail: "Please answer the runtime question.",
      artifactRefs: ["src/runtime.ts"],
      dependsOn: ["clarify-b"],
      closureCondition: "clarification:clarify-b",
      status: "resolved",
      source: "launcher",
    });

    const outcome = triageClarificationRequests({
      lanePaths,
      wave,
      coordinationLogPath,
      coordinationState: readMaterializedCoordinationState(coordinationLogPath),
      orchestratorId: "orch-1",
    });

    expect(outcome.changed).toBe(true);
    const updatedState = readMaterializedCoordinationState(coordinationLogPath);
    expect(updatedState.byId.get("clarify-a")).toMatchObject({
      status: "in_progress",
    });
    expect(updatedState.byId.get("clarify-b")).toMatchObject({
      status: "resolved",
      detail: "Resolved via route-clarify-b-1.",
    });
  });

  it("escalates unresolved clarification requests to human feedback and writes the pending summary", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    const wave = makeWave();
    const coordinationLogPath = path.join(dir, "coordination", "wave-0.jsonl");

    appendCoordinationRecord(coordinationLogPath, {
      id: "clarify-product",
      lane: "main",
      wave: 0,
      agentId: "A1",
      kind: "clarification-request",
      targets: ["launcher"],
      priority: "urgent",
      summary: "Which external product tier should this launch against?",
      detail: "No repo policy or ownership rule answers this.",
      artifactRefs: [],
      status: "open",
      source: "agent",
    });

    const outcome = triageClarificationRequests({
      lanePaths,
      wave,
      coordinationLogPath,
      coordinationState: readMaterializedCoordinationState(coordinationLogPath),
      orchestratorId: "orch-1",
    });

    expect(outcome.changed).toBe(true);
    const requestFiles = fs.readdirSync(lanePaths.feedbackRequestsDir);
    expect(requestFiles).toHaveLength(1);
    const requestPayload = JSON.parse(
      fs.readFileSync(path.join(lanePaths.feedbackRequestsDir, requestFiles[0]), "utf8"),
    );
    expect(requestPayload.status).toBe("pending");
    const updatedState = readMaterializedCoordinationState(coordinationLogPath);
    expect(updatedState.humanEscalations).toHaveLength(1);
    expect(updatedState.humanEscalations[0]).toMatchObject({
      status: "open",
      artifactRefs: [requestPayload.id],
      closureCondition: "clarification:clarify-product",
    });
    expect(updatedState.byId.get("clarify-product")).toMatchObject({
      status: "in_progress",
    });
    expect(fs.readFileSync(outcome.pendingHumanPath, "utf8")).toContain(requestPayload.id);
  });
});
