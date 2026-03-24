import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-human-input-resolution-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath, payloads) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${payloads.map((payload) => JSON.stringify(payload)).join("\n")}\n`,
    "utf8",
  );
}

function runWaveCli(args, cwd) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      WAVE_SKIP_UPDATE_CHECK: "1",
    },
  });
}

function seedAnsweredHumanInputFixture(repoDir) {
  const stateDir = path.join(repoDir, ".tmp", "main-wave-launcher");
  const feedbackRequestsDir = path.join(repoDir, ".tmp", "wave-orchestrator", "feedback", "requests");
  const requestId = "202603240000-main-w0-A9-abc123";

  writeJson(path.join(stateDir, "status", "wave-0-a1.status"), {
    code: 0,
    completedAt: "2026-03-24T00:00:00.000Z",
  });
  writeJson(path.join(stateDir, "status", "wave-0-a1.summary.json"), {
    agentId: "A1",
    exitCode: 0,
    completedAt: "2026-03-24T00:00:00.000Z",
    proof: {
      completion: "contract",
      durability: "none",
      proof: "unit",
      state: "met",
      detail: "Starter runtime slice landed.",
    },
    docDelta: {
      state: "owned",
      paths: ["README.md"],
      detail: "Implementation docs refreshed.",
    },
    components: [
      {
        componentId: "wave-parser-and-launcher",
        level: "repo-landed",
        state: "met",
        detail: "Parser/runtime slice is landed.",
      },
      {
        componentId: "starter-docs-and-adoption-guidance",
        level: "repo-landed",
        state: "met",
        detail: "Starter docs are landed.",
      },
    ],
    structuredSignalDiagnostics: {
      proof: { rawCount: 1, acceptedCount: 1, rejectedSamples: [] },
      docDelta: { rawCount: 1, acceptedCount: 1, rejectedSamples: [] },
      docClosure: { rawCount: 0, acceptedCount: 0, rejectedSamples: [] },
      integration: { rawCount: 0, acceptedCount: 0, rejectedSamples: [] },
      eval: { rawCount: 0, acceptedCount: 0, rejectedSamples: [] },
      security: { rawCount: 0, acceptedCount: 0, rejectedSamples: [] },
      gate: { rawCount: 0, acceptedCount: 0, rejectedSamples: [] },
      gap: { rawCount: 0, acceptedCount: 0, rejectedSamples: [] },
      component: {
        rawCount: 2,
        acceptedCount: 2,
        rejectedSamples: [],
        seenComponentIds: [
          "starter-docs-and-adoption-guidance",
          "wave-parser-and-launcher",
        ],
      },
    },
    deliverables: [],
    proofArtifacts: [],
    terminationReason: "completed",
    terminationHint: null,
    terminationObservedTurnLimit: null,
    logPath: ".tmp/main-wave-launcher/logs/wave-0-a1.log",
    reportPath: null,
  });
  writeJsonl(path.join(stateDir, "coordination", "wave-0.jsonl"), [
    {
      id: "clarify-1",
      kind: "clarification-request",
      lane: "main",
      wave: 0,
      agentId: "A9",
      targets: ["agent:operator"],
      status: "open",
      priority: "high",
      artifactRefs: [],
      dependsOn: [],
      closureCondition: "",
      createdAt: "2026-03-24T00:10:00.000Z",
      updatedAt: "2026-03-24T00:10:00.000Z",
      confidence: "medium",
      summary: "Need operator confirmation",
      detail: "Need the approved documentation location before closure.",
      source: "agent",
    },
    {
      id: "req-1",
      kind: "request",
      lane: "main",
      wave: 0,
      agentId: "A9",
      targets: ["agent:A1"],
      status: "open",
      priority: "normal",
      artifactRefs: [],
      dependsOn: ["clarify-1"],
      closureCondition: "",
      createdAt: "2026-03-24T00:11:00.000Z",
      updatedAt: "2026-03-24T00:11:00.000Z",
      confidence: "medium",
      summary: "Need implementation follow-up after clarification",
      detail: "Wait for the operator answer before continuing closure.",
      source: "agent",
    },
    {
      id: "esc-1",
      kind: "human-escalation",
      lane: "main",
      wave: 0,
      agentId: "A9",
      targets: ["agent:operator"],
      status: "open",
      priority: "urgent",
      artifactRefs: [requestId],
      dependsOn: [],
      closureCondition: "clarification:clarify-1",
      createdAt: "2026-03-24T00:12:00.000Z",
      updatedAt: "2026-03-24T00:12:00.000Z",
      confidence: "medium",
      summary: "Human answer required",
      detail: "Approve the documentation location.",
      source: "launcher",
    },
  ]);
  writeJson(path.join(feedbackRequestsDir, `${requestId}.json`), {
    id: requestId,
    createdAt: "2026-03-24T00:12:00.000Z",
    updatedAt: "2026-03-24T00:12:00.000Z",
    lane: "main",
    wave: 0,
    agentId: "A9",
    orchestratorId: null,
    status: "pending",
    question: "Where is the approved docs path?",
    context: "Need operator answer before closure can continue.",
    response: null,
  });
  return { requestId };
}

function expectResolvedCoordinationAndResume(repoDir) {
  const coordShow = runWaveCli(
    ["coord", "show", "--lane", "main", "--wave", "0", "--json"],
    repoDir,
  );
  expect(coordShow.status).toBe(0);
  const coordination = JSON.parse(coordShow.stdout);
  expect(coordination.byId["clarify-1"]).toMatchObject({ status: "resolved" });
  expect(coordination.byId["req-1"]).toMatchObject({ status: "resolved" });
  expect(coordination.byId["esc-1"]).toMatchObject({ status: "resolved" });
  expect(coordination.byId["assignment:req-1:agent:a1"]).toMatchObject({
    status: "resolved",
  });

  const rerunGet = runWaveCli(
    ["control", "rerun", "get", "--lane", "main", "--wave", "0"],
    repoDir,
  );
  expect(rerunGet.status).toBe(0);
  expect(JSON.parse(rerunGet.stdout)).toMatchObject({
    rerunRequest: expect.objectContaining({
      requestedBy: "human-operator",
      applyOnce: true,
    }),
    effectiveSelectedAgentIds: expect.any(Array),
  });
  expect(JSON.parse(rerunGet.stdout).effectiveSelectedAgentIds.length).toBeGreaterThan(0);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("human input resolution", () => {
  it("resolves linked clarification state and writes a continuation request when control task answer is used", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });
    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const { requestId } = seedAnsweredHumanInputFixture(repoDir);

    const answerResult = runWaveCli(
      [
        "control",
        "task",
        "act",
        "answer",
        "--lane",
        "main",
        "--wave",
        "0",
        "--id",
        requestId,
        "--response",
        "Use docs/plans/current-state.md",
      ],
      repoDir,
    );
    expect(answerResult.status).toBe(0);

    const answered = JSON.parse(
      fs.readFileSync(
        path.join(repoDir, ".tmp", "wave-orchestrator", "feedback", "requests", `${requestId}.json`),
        "utf8",
      ),
    );
    expect(answered).toMatchObject({
      id: requestId,
      status: "answered",
      response: {
        operator: "human-operator",
        text: "Use docs/plans/current-state.md",
      },
    });
    expectResolvedCoordinationAndResume(repoDir);
  });

  it("reconciles linked clarification state when feedback respond is used directly", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });
    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const { requestId } = seedAnsweredHumanInputFixture(repoDir);

    const answerResult = runWaveCli(
      [
        "feedback",
        "respond",
        "--id",
        requestId,
        "--response",
        "Use docs/plans/current-state.md",
      ],
      repoDir,
    );
    expect(answerResult.status).toBe(0);
    expect(answerResult.stdout).toContain(`[wave-human-feedback] answered ${requestId}`);
    expectResolvedCoordinationAndResume(repoDir);
  });
});
