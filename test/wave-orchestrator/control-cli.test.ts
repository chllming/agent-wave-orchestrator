import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-control-cli-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("wave control CLI", () => {
  it("writes rerun requests without crashing on legacy proof projections and preserves rich rerun metadata", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    writeJson(path.join(repoDir, ".tmp", "main-wave-launcher", "proof", "wave-0.json"), {
      lane: "main",
      wave: 0,
      entries: [],
    });

    const requestResult = runWaveCli(
      [
        "control",
        "rerun",
        "request",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--reuse-attempt",
        "attempt-7",
        "--reuse-proof",
        "proof-A1-1",
        "--reuse-derived-summaries",
        "false",
        "--invalidate-component",
        "component-1",
        "--clear-reuse",
        "A1",
        "--preserve-reuse",
        "A2",
        "--requested-by",
        "tester",
        "--reason",
        "resume targeted implementation work",
      ],
      repoDir,
    );
    expect(requestResult.status).toBe(0);
    expect(JSON.parse(requestResult.stdout)).toMatchObject({
      rerunRequest: {
        selectedAgentIds: ["A1"],
        reuseAttemptIds: ["attempt-7"],
        reuseProofBundleIds: ["proof-A1-1"],
        reuseDerivedSummaries: false,
        invalidateComponentIds: ["component-1"],
        clearReusableAgentIds: ["A1"],
        preserveReusableAgentIds: ["A2"],
        requestedBy: "tester",
      },
      effectiveSelectedAgentIds: ["A1"],
    });

    writeJson(path.join(repoDir, ".tmp", "main-wave-launcher", "control", "retry-override-wave-0.json"), {
      schemaVersion: 1,
      kind: "wave-retry-override",
      lane: "main",
      wave: 0,
      selectedAgentIds: ["A1"],
      clearReusableAgentIds: ["A1"],
      preserveReusableAgentIds: ["A2"],
      resumePhase: null,
      requestedBy: "tester",
      reason: "resume targeted implementation work",
      applyOnce: true,
      createdAt: "2026-03-23T00:00:00.000Z",
    });

    const getResult = runWaveCli(
      ["control", "rerun", "get", "--lane", "main", "--wave", "0"],
      repoDir,
    );
    expect(getResult.status).toBe(0);
    expect(JSON.parse(getResult.stdout)).toMatchObject({
      rerunRequest: {
        selectedAgentIds: ["A1"],
        reuseAttemptIds: ["attempt-7"],
        reuseProofBundleIds: ["proof-A1-1"],
        reuseDerivedSummaries: false,
        invalidateComponentIds: ["component-1"],
        clearReusableAgentIds: ["A1"],
        preserveReusableAgentIds: ["A2"],
      },
      effectiveSelectedAgentIds: ["A1"],
    });

    const clearResult = runWaveCli(
      ["control", "rerun", "clear", "--lane", "main", "--wave", "0"],
      repoDir,
    );
    expect(clearResult.status).toBe(0);

    const clearedGet = runWaveCli(
      ["control", "rerun", "get", "--lane", "main", "--wave", "0"],
      repoDir,
    );
    expect(clearedGet.status).toBe(0);
    expect(JSON.parse(clearedGet.stdout).rerunRequest).toBeNull();
  });

  it("surfaces informational task kinds through task list/get without blocking agent status", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const createResult = runWaveCli(
      [
        "control",
        "task",
        "create",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--kind",
        "handoff",
        "--summary",
        "Passing context to the integration steward",
        "--detail",
        "Carry forward the local findings without reopening implementation work.",
      ],
      repoDir,
    );
    expect(createResult.status).toBe(0);
    const createdTask = JSON.parse(createResult.stdout);

    const listResult = runWaveCli(
      ["control", "task", "list", "--lane", "main", "--wave", "0", "--agent", "A1", "--json"],
      repoDir,
    );
    expect(listResult.status).toBe(0);
    expect(JSON.parse(listResult.stdout)).toEqual([
      expect.objectContaining({
        taskId: createdTask.id,
        taskType: "handoff",
        ownerAgentId: "A1",
        state: "open",
      }),
    ]);

    const getResult = runWaveCli(
      ["control", "task", "get", "--lane", "main", "--wave", "0", "--id", createdTask.id],
      repoDir,
    );
    expect(getResult.status).toBe(0);
    expect(JSON.parse(getResult.stdout)).toMatchObject({
      taskId: createdTask.id,
      taskType: "handoff",
      ownerAgentId: "A1",
    });

    const statusResult = runWaveCli(
      ["control", "status", "--lane", "main", "--wave", "0", "--agent", "A1", "--json"],
      repoDir,
    );
    expect(statusResult.status).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      agentId: "A1",
      blockingEdge: null,
      logicalAgents: [
        expect.objectContaining({
          agentId: "A1",
          state: "planned",
        }),
      ],
      tasks: [
        expect.objectContaining({
          taskId: createdTask.id,
          taskType: "handoff",
        }),
      ],
    });
  });

  it("surfaces pending human-input tasks in control status", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const createResult = runWaveCli(
      [
        "control",
        "task",
        "create",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--kind",
        "human-input",
        "--summary",
        "Need rollout window",
        "--detail",
        "Confirm the live maintenance window before continuing.",
      ],
      repoDir,
    );
    expect(createResult.status).toBe(0);

    const statusResult = runWaveCli(
      [
        "control",
        "status",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--json",
      ],
      repoDir,
    );
    expect(statusResult.status).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      agentId: "A1",
      blockingEdge: {
        kind: "human-input",
      },
      signals: {
        wave: {
          signal: "feedback-requested",
        },
        agents: [
          expect.objectContaining({
            agentId: "A1",
            signal: "feedback-requested",
            shouldWake: true,
          }),
        ],
      },
      tasks: [
        expect.objectContaining({
          taskType: "human-input",
          state: "input-required",
          ownerAgentId: "A1",
        }),
      ],
      logicalAgents: [
        expect.objectContaining({
          agentId: "A1",
          state: "blocked",
        }),
      ],
    });
  });

  it("can downgrade an open task to advisory without leaving a blocking edge behind", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const createResult = runWaveCli(
      [
        "control",
        "task",
        "create",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--kind",
        "request",
        "--summary",
        "Need docs steward follow-up",
        "--detail",
        "Keep the request visible, but allow the wave to keep moving.",
      ],
      repoDir,
    );
    expect(createResult.status).toBe(0);
    const createdTask = JSON.parse(createResult.stdout);

    const downgradeResult = runWaveCli(
      [
        "control",
        "task",
        "act",
        "mark-advisory",
        "--lane",
        "main",
        "--wave",
        "0",
        "--id",
        createdTask.id,
      ],
      repoDir,
    );
    expect(downgradeResult.status).toBe(0);

    const getResult = runWaveCli(
      ["control", "task", "get", "--lane", "main", "--wave", "0", "--id", createdTask.id],
      repoDir,
    );
    expect(getResult.status).toBe(0);
    expect(JSON.parse(getResult.stdout)).toMatchObject({
      taskId: createdTask.id,
      taskType: "request",
      state: "open",
      blocking: false,
      blockerSeverity: "advisory",
    });

    const statusResult = runWaveCli(
      ["control", "status", "--lane", "main", "--wave", "0", "--agent", "A1", "--json"],
      repoDir,
    );
    expect(statusResult.status).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      agentId: "A1",
      blockingEdge: null,
      tasks: [
        expect.objectContaining({
          taskId: createdTask.id,
          blocking: false,
          blockerSeverity: "advisory",
        }),
      ],
    });
  });

  it("resolves clarification-linked requests by policy without leaving them blocking", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const clarificationResult = runWaveCli(
      [
        "control",
        "task",
        "create",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--kind",
        "clarification",
        "--summary",
        "Need shared-plan guidance",
      ],
      repoDir,
    );
    expect(clarificationResult.status).toBe(0);
    const clarificationTask = JSON.parse(clarificationResult.stdout);

    const linkedRequestResult = runWaveCli(
      [
        "control",
        "task",
        "create",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A9",
        "--kind",
        "request",
        "--summary",
        "Follow up on the clarification",
        "--depends-on",
        clarificationTask.id,
      ],
      repoDir,
    );
    expect(linkedRequestResult.status).toBe(0);
    const linkedTask = JSON.parse(linkedRequestResult.stdout);

    const resolveResult = runWaveCli(
      [
        "control",
        "task",
        "act",
        "resolve-policy",
        "--lane",
        "main",
        "--wave",
        "0",
        "--id",
        clarificationTask.id,
      ],
      repoDir,
    );
    expect(resolveResult.status).toBe(0);

    const clarifiedGet = runWaveCli(
      ["control", "task", "get", "--lane", "main", "--wave", "0", "--id", clarificationTask.id],
      repoDir,
    );
    expect(clarifiedGet.status).toBe(0);
    expect(JSON.parse(clarifiedGet.stdout)).toMatchObject({
      taskId: clarificationTask.id,
      taskType: "clarification",
      state: "resolved",
      blocking: false,
      blockerSeverity: "advisory",
    });

    const linkedGet = runWaveCli(
      ["control", "task", "get", "--lane", "main", "--wave", "0", "--id", linkedTask.id],
      repoDir,
    );
    expect(linkedGet.status).toBe(0);
    expect(JSON.parse(linkedGet.stdout)).toMatchObject({
      taskId: linkedTask.id,
      taskType: "request",
      state: "resolved",
      blocking: false,
      blockerSeverity: "advisory",
    });
  });

  it("keeps agent-scoped status from leaking unrelated unresolved helper assignments", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    expect(
      runWaveCli(
        [
          "control",
          "task",
          "create",
          "--lane",
          "main",
          "--wave",
          "0",
          "--agent",
          "A2",
          "--kind",
          "request",
          "--summary",
          "Need a capability owner",
          "--target",
          "capability:does-not-exist",
        ],
        repoDir,
      ).status,
    ).toBe(0);

    const unrelatedStatus = runWaveCli(
      ["control", "status", "--lane", "main", "--wave", "0", "--agent", "A1", "--json"],
      repoDir,
    );
    expect(unrelatedStatus.status).toBe(0);
    expect(JSON.parse(unrelatedStatus.stdout)).toMatchObject({
      agentId: "A1",
      blockingEdge: null,
      tasks: [],
      helperAssignments: [],
    });

    const ownerStatus = runWaveCli(
      ["control", "status", "--lane", "main", "--wave", "0", "--agent", "A2", "--json"],
      repoDir,
    );
    expect(ownerStatus.status).toBe(0);
    expect(JSON.parse(ownerStatus.stdout)).toMatchObject({
      agentId: "A2",
      blockingEdge: {
        kind: "helper-assignment-unresolved",
      },
      helperAssignments: [
        expect.objectContaining({
          sourceAgentId: "A2",
          assignedAgentId: null,
        }),
      ],
    });
  });

  it("prefers the active attempt over stale relaunch plans and unrelated closure blockers", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    expect(
      runWaveCli(
        [
          "control",
          "task",
          "create",
          "--lane",
          "main",
          "--wave",
          "0",
          "--agent",
          "A9",
          "--kind",
          "human-input",
          "--summary",
          "Need stale docs closure input",
          "--detail",
          "Old closure blocker should not dominate while A1 is actively running.",
        ],
        repoDir,
      ).status,
    ).toBe(0);
    writeJson(path.join(repoDir, ".tmp", "main-wave-launcher", "status", "relaunch-plan-wave-0.json"), {
      schemaVersion: 1,
      kind: "wave-relaunch-plan",
      wave: 0,
      selectedAgentIds: ["A9"],
      createdAt: "2026-03-23T00:00:00.000Z",
    });
    appendJsonl(path.join(repoDir, ".tmp", "main-wave-launcher", "control-plane", "wave-0.jsonl"), {
      recordVersion: 1,
      id: "ctrl-attempt-1",
      lane: "main",
      wave: 0,
      runKind: "roadmap",
      runId: "run-1",
      entityType: "attempt",
      entityId: "wave-0-attempt-1",
      action: "running",
      source: "launcher",
      actor: "launcher",
      recordedAt: "2026-03-23T01:00:00.000Z",
      data: {
        attemptId: "wave-0-attempt-1",
        attemptNumber: 1,
        state: "running",
        selectedAgentIds: ["A1"],
        detail: "Launching A1.",
        createdAt: "2026-03-23T01:00:00.000Z",
        updatedAt: "2026-03-23T01:00:00.000Z",
      },
    });

    const statusResult = runWaveCli(
      ["control", "status", "--lane", "main", "--wave", "0", "--json"],
      repoDir,
    );

    expect(statusResult.status).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      selectionSource: "active-attempt",
      blockingEdge: null,
      relaunchPlan: {
        selectedAgentIds: ["A9"],
      },
      activeAttempt: {
        selectedAgentIds: ["A1"],
      },
      logicalAgents: expect.arrayContaining([
        expect.objectContaining({
          agentId: "A1",
          state: "working",
          selectedForActiveAttempt: true,
        }),
        expect.objectContaining({
          agentId: "A9",
          state: "blocked",
        }),
      ]),
    });
  });

  it("suppresses stale blocking projections after the wave is already completed", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    expect(
      runWaveCli(
        [
          "control",
          "task",
          "create",
          "--lane",
          "main",
          "--wave",
          "0",
          "--agent",
          "A9",
          "--kind",
          "request",
          "--summary",
          "Reconcile shared-plan documentation",
          "--detail",
          "Historical request record should stay visible without blocking a completed wave.",
        ],
        repoDir,
      ).status,
    ).toBe(0);

    writeJson(path.join(repoDir, ".tmp", "main-wave-launcher", "ledger", "wave-0.json"), {
      phase: "completed",
    });
    writeJson(path.join(repoDir, ".tmp", "main-wave-launcher", "status", "wave-0-0-a9.status"), {
      code: 0,
      promptHash: "completed-wave-a9",
      completedAt: "2026-03-24T00:00:00.000Z",
    });

    const statusResult = runWaveCli(
      ["control", "status", "--lane", "main", "--wave", "0", "--json"],
      repoDir,
    );

    expect(statusResult.status).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      phase: "completed",
      blockingEdge: null,
      nextTimer: null,
      logicalAgents: expect.arrayContaining([
        expect.objectContaining({
          agentId: "A9",
          state: "closed",
          reason: "Completed wave preserves the latest satisfied agent state.",
        }),
      ]),
      tasks: expect.arrayContaining([
        expect.objectContaining({
          taskType: "request",
          assigneeAgentId: "A9",
          state: "open",
        }),
      ]),
    });
  });

  it("preserves revoked proof state in control reads and excludes revoked bundles from active proof ids", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    const artifactPath = path.join(repoDir, ".tmp", "proof", "live-status.json");
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, "{\"live\":true}\n", "utf8");

    const registerResult = runWaveCli(
      [
        "control",
        "proof",
        "register",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--artifact",
        ".tmp/proof/live-status.json",
        "--authoritative",
        "--operator",
        "tester",
        "--json",
      ],
      repoDir,
    );
    expect(registerResult.status).toBe(0);
    const bundleId = JSON.parse(registerResult.stdout).entry.id;

    const revokeResult = runWaveCli(
      [
        "control",
        "proof",
        "revoke",
        "--lane",
        "main",
        "--wave",
        "0",
        "--id",
        bundleId,
        "--operator",
        "tester",
        "--detail",
        "Superseded by newer operator evidence.",
        "--json",
      ],
      repoDir,
    );
    expect(revokeResult.status).toBe(0);

    const getResult = runWaveCli(
      ["control", "proof", "get", "--lane", "main", "--wave", "0", "--id", bundleId, "--json"],
      repoDir,
    );
    expect(getResult.status).toBe(0);
    expect(JSON.parse(getResult.stdout)).toMatchObject({
      entries: [
        expect.objectContaining({
          id: bundleId,
          agentId: "A1",
          state: "revoked",
        }),
      ],
    });

    const statusResult = runWaveCli(
      ["control", "status", "--lane", "main", "--wave", "0", "--agent", "A1", "--json"],
      repoDir,
    );
    expect(statusResult.status).toBe(0);
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      agentId: "A1",
      proofBundles: [
        expect.objectContaining({
          id: bundleId,
          state: "revoked",
        }),
      ],
      logicalAgents: [
        expect.objectContaining({
          agentId: "A1",
          activeProofBundleIds: [],
        }),
      ],
    });
  });

  it("reports queued telemetry and supports a no-endpoint flush", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    expect(
      runWaveCli(
        [
          "control",
          "rerun",
          "request",
          "--lane",
          "main",
          "--wave",
          "0",
          "--agent",
          "A1",
          "--requested-by",
          "tester",
        ],
        repoDir,
      ).status,
    ).toBe(0);

    const statusResult = runWaveCli(
      ["control", "telemetry", "status", "--lane", "main", "--json"],
      repoDir,
    );
    expect(statusResult.status).toBe(0);
    const telemetryStatus = JSON.parse(statusResult.stdout);
    expect(telemetryStatus.lane).toBe("main");
    expect(telemetryStatus.pendingCount).toBeGreaterThan(0);

    const flushResult = runWaveCli(
      ["control", "telemetry", "flush", "--lane", "main", "--json"],
      repoDir,
    );
    expect(flushResult.status).toBe(0);
    const flushPayload = JSON.parse(flushResult.stdout);
    expect(flushPayload.attempted).toBe(0);
    expect(flushPayload.sent).toBe(0);
    expect(flushPayload.pending).toBeGreaterThan(0);
  });
});
