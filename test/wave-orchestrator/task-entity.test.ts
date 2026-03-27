import { describe, it, expect } from "vitest";
import {
  normalizeTask,
  TASK_TYPES,
  CLOSURE_STATES,
  LEASE_STATES,
  transitionClosureState,
  acquireLease,
  releaseLease,
  heartbeatLease,
  isLeaseExpired,
  buildTasksFromWaveDefinition,
  buildTasksFromCoordinationState,
  mergeTaskSets,
  evaluateOwnedSliceProven,
  evaluateWaveClosureReady,
} from "../../scripts/wave-orchestrator/task-entity.mjs";

describe("normalizeTask", () => {
  it("normalizes a minimal task with defaults", () => {
    const task = normalizeTask({ title: "Test task" });
    expect(task.taskId).toMatch(/^task-/);
    expect(task.taskType).toBe("implementation");
    expect(task.title).toBe("Test task");
    expect(task.closureState).toBe("open");
    expect(task.leaseState).toBe("unleased");
    expect(task.priority).toBe("normal");
    expect(task.ownerAgentId).toBeNull();
    expect(task.assigneeAgentId).toBeNull();
    expect(task.artifactContract).toEqual({
      deliverables: [],
      requiredPaths: [],
      proofArtifacts: [],
      exitContract: null,
      componentTargets: {},
    });
    expect(task.proofRequirements).toEqual({
      proofLevel: "unit",
      proofCentric: false,
      maturityTarget: null,
    });
    expect(task.dependencyEdges).toEqual([]);
    expect(task.createdAt).toBeTruthy();
    expect(task.updatedAt).toBeTruthy();
  });

  it("respects explicit values", () => {
    const task = normalizeTask({
      taskType: "security",
      title: "Security review",
      ownerAgentId: "S1",
      closureState: "open",
      priority: "urgent",
      proofRequirements: {
        proofLevel: "integration",
        proofCentric: true,
        maturityTarget: "component",
      },
      dependencyEdges: [{ targetTaskId: "task-abc", kind: "blocks" }],
    });
    expect(task.taskType).toBe("security");
    expect(task.ownerAgentId).toBe("S1");
    expect(task.priority).toBe("urgent");
    expect(task.proofRequirements).toEqual({
      proofLevel: "integration",
      proofCentric: true,
      maturityTarget: "component",
    });
    expect(task.dependencyEdges).toEqual([
      { taskId: "task-abc", kind: "blocks", status: "pending" },
    ]);
  });

  it("throws on non-object input", () => {
    expect(() => normalizeTask(null)).toThrow("Task must be an object");
    expect(() => normalizeTask("invalid")).toThrow("Task must be an object");
    expect(() => normalizeTask([1, 2])).toThrow("Task must be an object");
  });

  it("throws on invalid taskType", () => {
    expect(() => normalizeTask({ taskType: "bogus" })).toThrow("taskType must be one of");
  });

  it("throws on invalid closureState", () => {
    expect(() => normalizeTask({ closureState: "nope" })).toThrow("closureState must be one of");
  });

  it("throws on invalid leaseState", () => {
    expect(() => normalizeTask({ leaseState: "invalid" })).toThrow("leaseState must be one of");
  });

  it("throws on invalid priority", () => {
    expect(() => normalizeTask({ priority: "extreme" })).toThrow("priority must be one of");
  });

  it("applies defaults from second argument", () => {
    const task = normalizeTask({}, { taskType: "security", priority: "high" });
    expect(task.taskType).toBe("security");
    expect(task.priority).toBe("high");
  });

  it("normalizes artifactContract sub-fields", () => {
    const task = normalizeTask({
      artifactContract: {
        requiredPaths: ["src/a.ts"],
        exitContract: { completion: "contract", durability: "durable" },
        componentTargets: { comp1: "repo-landed" },
      },
    });
    expect(task.artifactContract.requiredPaths).toEqual(["src/a.ts"]);
    expect(task.artifactContract.exitContract).toEqual({
      completion: "contract",
      durability: "durable",
    });
    expect(task.artifactContract.componentTargets).toEqual({ comp1: "repo-landed" });
    expect(task.artifactContract.proofArtifacts).toEqual([]);
  });
});

describe("TASK_TYPES / CLOSURE_STATES / LEASE_STATES", () => {
  it("TASK_TYPES contains expected types", () => {
    expect(TASK_TYPES.has("design")).toBe(true);
    expect(TASK_TYPES.has("implementation")).toBe(true);
    expect(TASK_TYPES.has("cont-qa")).toBe(true);
    expect(TASK_TYPES.has("security")).toBe(true);
    expect(TASK_TYPES.has("escalation")).toBe(true);
    expect(TASK_TYPES.size).toBe(13);
  });

  it("CLOSURE_STATES contains expected states", () => {
    expect(CLOSURE_STATES.has("open")).toBe(true);
    expect(CLOSURE_STATES.has("owned_slice_proven")).toBe(true);
    expect(CLOSURE_STATES.has("wave_closure_ready")).toBe(true);
    expect(CLOSURE_STATES.has("closed")).toBe(true);
    expect(CLOSURE_STATES.has("cancelled")).toBe(true);
    expect(CLOSURE_STATES.has("superseded")).toBe(true);
    expect(CLOSURE_STATES.size).toBe(6);
  });

  it("LEASE_STATES contains expected states", () => {
    expect(LEASE_STATES.has("unleased")).toBe(true);
    expect(LEASE_STATES.has("leased")).toBe(true);
    expect(LEASE_STATES.has("released")).toBe(true);
    expect(LEASE_STATES.has("expired")).toBe(true);
    expect(LEASE_STATES.size).toBe(4);
  });
});

describe("transitionClosureState", () => {
  it("allows valid transitions", () => {
    expect(transitionClosureState("open", "owned_slice_proven")).toBe("owned_slice_proven");
    expect(transitionClosureState("owned_slice_proven", "wave_closure_ready")).toBe("wave_closure_ready");
    expect(transitionClosureState("wave_closure_ready", "closed")).toBe("closed");
  });

  it("allows cancellation from any non-terminal state", () => {
    expect(transitionClosureState("open", "cancelled")).toBe("cancelled");
    expect(transitionClosureState("owned_slice_proven", "cancelled")).toBe("cancelled");
    expect(transitionClosureState("wave_closure_ready", "cancelled")).toBe("cancelled");
  });

  it("allows superseded from any non-terminal state", () => {
    expect(transitionClosureState("open", "superseded")).toBe("superseded");
    expect(transitionClosureState("owned_slice_proven", "superseded")).toBe("superseded");
    expect(transitionClosureState("wave_closure_ready", "superseded")).toBe("superseded");
  });

  it("rejects invalid transitions", () => {
    expect(() => transitionClosureState("closed", "open")).toThrow("Invalid closure transition");
    expect(() => transitionClosureState("cancelled", "open")).toThrow("Invalid closure transition");
    expect(() => transitionClosureState("open", "closed")).toThrow("Invalid closure transition");
    expect(() => transitionClosureState("open", "wave_closure_ready")).toThrow("Invalid closure transition");
  });

  it("rejects invalid states", () => {
    expect(() => transitionClosureState("bogus", "open")).toThrow("Invalid closure state");
    expect(() => transitionClosureState("open", "bogus")).toThrow("Invalid target closure state");
  });
});

describe("acquireLease", () => {
  it("acquires a lease on an unleased task", () => {
    const task = normalizeTask({ title: "Test" });
    const leased = acquireLease(task, "A1", "2099-01-01T00:00:00.000Z");
    expect(leased.leaseState).toBe("leased");
    expect(leased.leaseOwnerAgentId).toBe("A1");
    expect(leased.leaseExpiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(leased.leaseAcquiredAt).toBeTruthy();
    expect(leased.leaseHeartbeatAt).toBeTruthy();
  });

  it("throws when task is already leased", () => {
    const task = normalizeTask({ title: "Test" });
    const leased = acquireLease(task, "A1", null);
    expect(() => acquireLease(leased, "A2", null)).toThrow("already leased");
  });

  it("throws when agentId is missing", () => {
    const task = normalizeTask({ title: "Test" });
    expect(() => acquireLease(task, "", null)).toThrow("agentId is required");
  });
});

describe("releaseLease", () => {
  it("releases a leased task", () => {
    const task = acquireLease(normalizeTask({ title: "Test" }), "A1", null);
    const released = releaseLease(task);
    expect(released.leaseState).toBe("released");
    expect(released.leaseOwnerAgentId).toBeNull();
    expect(released.leaseAcquiredAt).toBeNull();
    expect(released.leaseExpiresAt).toBeNull();
    expect(released.leaseHeartbeatAt).toBeNull();
  });
});

describe("heartbeatLease", () => {
  it("updates heartbeat on a leased task", () => {
    const task = acquireLease(normalizeTask({ title: "Test" }), "A1", null);
    const heartbeated = heartbeatLease(task);
    expect(heartbeated.leaseHeartbeatAt).toBeTruthy();
    expect(heartbeated.leaseState).toBe("leased");
  });

  it("throws when task is not leased", () => {
    const task = normalizeTask({ title: "Test" });
    expect(() => heartbeatLease(task)).toThrow("Cannot heartbeat");
  });
});

describe("isLeaseExpired", () => {
  it("returns false for unleased task", () => {
    const task = normalizeTask({ title: "Test" });
    expect(isLeaseExpired(task)).toBe(false);
  });

  it("returns false when no expiration set", () => {
    const task = acquireLease(normalizeTask({ title: "Test" }), "A1", null);
    expect(isLeaseExpired(task)).toBe(false);
  });

  it("returns true when lease has expired", () => {
    const task = acquireLease(
      normalizeTask({ title: "Test" }),
      "A1",
      "2000-01-01T00:00:00.000Z",
    );
    expect(isLeaseExpired(task)).toBe(true);
  });

  it("returns false when lease has not expired", () => {
    const task = acquireLease(
      normalizeTask({ title: "Test" }),
      "A1",
      "2099-12-31T23:59:59.999Z",
    );
    expect(isLeaseExpired(task)).toBe(false);
  });
});

describe("buildTasksFromWaveDefinition", () => {
  const wave = {
    wave: 3,
    agents: [
      { agentId: "A1", title: "Core feature", ownedPaths: ["src/core.ts"], deliverables: ["README.md"] },
      { agentId: "A2", title: "API feature", ownedPaths: ["src/api.ts"] },
      { agentId: "A0", title: "QA", ownedPaths: [] },
      { agentId: "A9", title: "Docs", ownedPaths: [] },
    ],
    componentPromotions: [
      { componentId: "core-engine", targetLevel: "repo-landed" },
    ],
  };

  it("creates tasks for all agents", () => {
    const tasks = buildTasksFromWaveDefinition(wave);
    expect(tasks.length).toBe(5); // 4 agents + 1 component promotion
  });

  it("assigns correct task types based on agent roles", () => {
    const tasks = buildTasksFromWaveDefinition(wave);
    const byType = {};
    for (const task of tasks) {
      byType[task.taskType] = (byType[task.taskType] || 0) + 1;
    }
    expect(byType.implementation).toBe(2);
    expect(byType["cont-qa"]).toBe(1);
    expect(byType.documentation).toBe(1);
    expect(byType.component).toBe(1);
  });

  it("sets ownerAgentId for agent tasks", () => {
    const tasks = buildTasksFromWaveDefinition(wave);
    const a1Task = tasks.find((t) => t.ownerAgentId === "A1");
    expect(a1Task).toBeTruthy();
    expect(a1Task.taskType).toBe("implementation");
    expect(a1Task.title).toBe("A1: Core feature");
  });

  it("includes proof requirements for implementation tasks", () => {
    const tasks = buildTasksFromWaveDefinition(wave);
    const a1Task = tasks.find((t) => t.ownerAgentId === "A1");
    expect(a1Task.proofRequirements).toEqual({
      proofLevel: "unit",
      proofCentric: true,
      maturityTarget: null,
    });
  });

  it("creates component task with componentTargets", () => {
    const tasks = buildTasksFromWaveDefinition(wave);
    const compTask = tasks.find((t) => t.taskType === "component");
    expect(compTask).toBeTruthy();
    expect(compTask.title).toBe("Promote core-engine to repo-landed");
    expect(compTask.artifactContract.componentTargets).toEqual({ "core-engine": "repo-landed" });
  });

  it("returns empty array for null input", () => {
    expect(buildTasksFromWaveDefinition(null)).toEqual([]);
  });

  it("emits separate design and implementation tasks for hybrid design stewards", () => {
    const tasks = buildTasksFromWaveDefinition({
      wave: 4,
      agents: [
        {
          agentId: "D1",
          title: "Design Steward",
          rolePromptPaths: ["docs/agents/wave-design-role.md"],
          ownedPaths: ["docs/plans/waves/design/wave-4-D1.md", "src/runtime.ts"],
          exitContract: {
            completion: "contract",
            durability: "durable",
            proof: "integration",
            docImpact: "owned",
          },
        },
      ],
      componentPromotions: [],
    });

    expect(tasks.map((task) => task.taskType)).toEqual(["design", "implementation"]);
    expect(new Set(tasks.map((task) => task.taskId)).size).toBe(2);
  });
});

describe("buildTasksFromCoordinationState", () => {
  it("creates tasks for open clarifications", () => {
    const state = {
      clarifications: [
        { id: "clar-1", kind: "clarification-request", status: "open", summary: "Need input", agentId: "A1" },
        { id: "clar-2", kind: "clarification-request", status: "resolved", summary: "Done" },
      ],
      humanFeedback: [],
      humanEscalations: [],
    };
    const tasks = buildTasksFromCoordinationState(state);
    expect(tasks.length).toBe(1);
    expect(tasks[0].taskType).toBe("clarification");
    expect(tasks[0].sourceRecordId).toBe("clar-1");
  });

  it("creates tasks for open human feedback", () => {
    const state = {
      clarifications: [],
      humanFeedback: [{ id: "fb-1", kind: "human-feedback", status: "open", summary: "Review needed" }],
      humanEscalations: [],
    };
    const tasks = buildTasksFromCoordinationState(state);
    expect(tasks.length).toBe(1);
    expect(tasks[0].taskType).toBe("human-input");
  });

  it("creates tasks for open escalations", () => {
    const state = {
      clarifications: [],
      humanFeedback: [],
      humanEscalations: [{ id: "esc-1", kind: "human-escalation", status: "open", summary: "Urgent" }],
    };
    const tasks = buildTasksFromCoordinationState(state);
    expect(tasks.length).toBe(1);
    expect(tasks[0].taskType).toBe("escalation");
    expect(tasks[0].priority).toBe("urgent");
  });

  it("skips non-blocking advisory clarification and human-input records", () => {
    const state = {
      clarifications: [
        {
          id: "clar-1",
          kind: "clarification-request",
          status: "open",
          summary: "Need input",
          agentId: "A1",
          blocking: false,
          blockerSeverity: "advisory",
        },
      ],
      humanFeedback: [
        {
          id: "fb-1",
          kind: "human-feedback",
          status: "open",
          summary: "Review needed",
          agentId: "A1",
          blocking: false,
          blockerSeverity: "advisory",
        },
      ],
      humanEscalations: [
        {
          id: "esc-1",
          kind: "human-escalation",
          status: "open",
          summary: "Urgent",
          agentId: "A1",
          blocking: false,
          blockerSeverity: "stale",
        },
      ],
    };
    expect(buildTasksFromCoordinationState(state)).toEqual([]);
  });

  it("builds deterministic task ids and timestamps for coordination-derived tasks", () => {
    const state = {
      clarifications: [
        {
          id: "clar-1",
          kind: "clarification-request",
          wave: 7,
          lane: "beta",
          status: "open",
          summary: "Need input",
          detail: "Clarify the API contract.",
          agentId: "A1",
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T01:00:00.000Z",
        },
      ],
      humanFeedback: [],
      humanEscalations: [],
    };

    const first = buildTasksFromCoordinationState(state);
    const second = buildTasksFromCoordinationState(state);

    expect(first).toEqual(second);
    expect(first[0].taskId).toBe("wave-7:A1:clarification-clar-1");
    expect(first[0].createdAt).toBe("2026-03-23T00:00:00.000Z");
    expect(first[0].updatedAt).toBe("2026-03-23T01:00:00.000Z");
  });

  it("returns empty for null/empty state", () => {
    expect(buildTasksFromCoordinationState(null)).toEqual([]);
    expect(buildTasksFromCoordinationState({})).toEqual([]);
  });
});

describe("mergeTaskSets", () => {
  it("merges seed and coordination tasks", () => {
    const seed = [normalizeTask({ title: "A" })];
    const coord = [normalizeTask({ title: "B" })];
    const merged = mergeTaskSets(seed, coord);
    expect(merged.length).toBe(2);
  });

  it("deduplicates by sourceRecordId", () => {
    const seed = [normalizeTask({ title: "A", sourceRecordId: "coord-1" })];
    const coord = [normalizeTask({ title: "B", sourceRecordId: "coord-1" })];
    const merged = mergeTaskSets(seed, coord);
    expect(merged.length).toBe(1);
    expect(merged[0].title).toBe("A");
  });

  it("handles null/empty inputs", () => {
    expect(mergeTaskSets(null, null)).toEqual([]);
    expect(mergeTaskSets([], [])).toEqual([]);
  });
});

describe("evaluateOwnedSliceProven", () => {
  it("returns not proven with no agent result", () => {
    const task = normalizeTask({ taskType: "implementation", ownerAgentId: "A1" });
    const result = evaluateOwnedSliceProven(task, null);
    expect(result.proven).toBe(false);
    expect(result.reason).toContain("No agent result");
  });

  it("returns proven for implementation task with valid summary", () => {
    const task = normalizeTask({
      taskType: "implementation",
      ownerAgentId: "A1",
      artifactContract: {
        requiredPaths: ["src/a.ts"],
        exitContract: {
          completion: "contract",
          durability: "durable",
          proof: "unit",
          docImpact: "none",
        },
      },
    });
    const summary = {
      agentId: "A1",
      proof: {
        completion: "contract",
        durability: "durable",
        proof: "unit",
        state: "met",
      },
      docDelta: {
        state: "none",
      },
    };
    const result = evaluateOwnedSliceProven(task, summary);
    expect(result.proven).toBe(true);
  });

  it("returns not proven for implementation task with gap", () => {
    const task = normalizeTask({
      taskType: "implementation",
      ownerAgentId: "A1",
      artifactContract: {
        requiredPaths: ["src/a.ts"],
        exitContract: {
          completion: "contract",
          durability: "durable",
          proof: "unit",
          docImpact: "none",
        },
      },
    });
    const summary = {
      agentId: "A1",
      proof: {
        completion: "contract",
        durability: "durable",
        proof: "unit",
        state: "gap",
      },
      docDelta: {
        state: "none",
      },
    };
    const result = evaluateOwnedSliceProven(task, summary);
    expect(result.proven).toBe(false);
  });

  it("returns not proven for invalid task", () => {
    const result = evaluateOwnedSliceProven(null, {});
    expect(result.proven).toBe(false);
    expect(result.reason).toContain("Invalid task");
  });
});

describe("evaluateWaveClosureReady", () => {
  it("returns ready when all gates pass and no open tasks", () => {
    const tasks = [
      normalizeTask({ closureState: "wave_closure_ready" }),
      normalizeTask({ closureState: "closed" }),
    ];
    const gateSnapshot = {
      overall: { ok: true, gate: "pass", statusCode: "pass", detail: "OK" },
    };
    const result = evaluateWaveClosureReady(tasks, gateSnapshot);
    expect(result.ready).toBe(true);
  });

  it("returns not ready when a gate fails", () => {
    const tasks = [
      normalizeTask({ closureState: "wave_closure_ready" }),
    ];
    const gateSnapshot = {
      overall: { ok: false, gate: "implementationGate", statusCode: "missing-proof", detail: "Missing proof" },
    };
    const result = evaluateWaveClosureReady(tasks, gateSnapshot);
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("implementationGate");
  });

  it("returns not ready when tasks are still open", () => {
    const tasks = [
      normalizeTask({ closureState: "open" }),
    ];
    const gateSnapshot = {
      overall: { ok: true, gate: "pass", statusCode: "pass", detail: "OK" },
    };
    const result = evaluateWaveClosureReady(tasks, gateSnapshot);
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("not yet closure-ready");
  });

  it("returns not ready when no gate snapshot", () => {
    const result = evaluateWaveClosureReady([], null);
    expect(result.ready).toBe(false);
  });
});
