export const PLANNER_CONTEXT7_BUNDLE_ID = "planner-agentic";
export const PLANNER_CONTEXT7_LIBRARY_NAME = "wave-planner-agentic";
export const PLANNER_CONTEXT7_SOURCE_DIR = "docs/context7/planner-agent";
export const PLANNER_CONTEXT7_DEFAULT_QUERY =
  "Wave planning best practices, maturity alignment, closure gates, proof surfaces, rollout evidence, and coordination failure prevention";

export const PLANNER_CONTEXT7_SOURCE_FILES = [
  {
    sourcePath: "docs/research/agent-context-cache/topics/planning-and-orchestration.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/topics/planning-and-orchestration.md`,
    kind: "topic",
  },
  {
    sourcePath:
      "docs/research/agent-context-cache/papers/verified-multi-agent-orchestration-a-plan-execute-verify-replan-framework-for-complex-query-resolution.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/papers/verified-multi-agent-orchestration-a-plan-execute-verify-replan-framework-for-complex-query-resolution.md`,
    kind: "paper",
  },
  {
    sourcePath:
      "docs/research/agent-context-cache/papers/todoevolve-learning-to-architect-agent-planning-systems.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/papers/todoevolve-learning-to-architect-agent-planning-systems.md`,
    kind: "paper",
  },
  {
    sourcePath:
      "docs/research/agent-context-cache/papers/dova-deliberation-first-multi-agent-orchestration-for-autonomous-research-automation.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/papers/dova-deliberation-first-multi-agent-orchestration-for-autonomous-research-automation.md`,
    kind: "paper",
  },
  {
    sourcePath:
      "docs/research/agent-context-cache/papers/why-do-multi-agent-llm-systems-fail.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/papers/why-do-multi-agent-llm-systems-fail.md`,
    kind: "paper",
  },
  {
    sourcePath:
      "docs/research/agent-context-cache/papers/silo-bench-a-scalable-environment-for-evaluating-distributed-coordination-in-multi-agent-llm-systems.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/papers/silo-bench-a-scalable-environment-for-evaluating-distributed-coordination-in-multi-agent-llm-systems.md`,
    kind: "paper",
  },
  {
    sourcePath:
      "docs/research/agent-context-cache/papers/dpbench-large-language-models-struggle-with-simultaneous-coordination.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/papers/dpbench-large-language-models-struggle-with-simultaneous-coordination.md`,
    kind: "paper",
  },
  {
    sourcePath:
      "docs/research/agent-context-cache/papers/cooperbench-why-coding-agents-cannot-be-your-teammates-yet.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/papers/cooperbench-why-coding-agents-cannot-be-your-teammates-yet.md`,
    kind: "paper",
  },
  {
    sourcePath:
      "docs/research/agent-context-cache/papers/incremental-planning-to-control-a-blackboard-based-problem-solver.md",
    targetPath: `${PLANNER_CONTEXT7_SOURCE_DIR}/papers/incremental-planning-to-control-a-blackboard-based-problem-solver.md`,
    kind: "paper",
  },
];

export const PLANNER_CONTEXT7_TEMPLATE_PATHS = [
  `${PLANNER_CONTEXT7_SOURCE_DIR}/README.md`,
  `${PLANNER_CONTEXT7_SOURCE_DIR}/manifest.json`,
  ...PLANNER_CONTEXT7_SOURCE_FILES.map((entry) => entry.targetPath),
];

export const PLANNER_CONTEXT7_RESEARCH_TOPIC_PATHS = PLANNER_CONTEXT7_SOURCE_FILES.filter(
  (entry) => entry.kind === "topic",
).map((entry) => entry.targetPath);

export const PLANNER_CONTEXT7_PAPER_PATHS = PLANNER_CONTEXT7_SOURCE_FILES.filter(
  (entry) => entry.kind === "paper",
).map((entry) => entry.targetPath);
