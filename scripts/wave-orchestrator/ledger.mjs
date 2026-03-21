import {
  DEFAULT_DOCUMENTATION_AGENT_ID,
  DEFAULT_EVALUATOR_AGENT_ID,
  DEFAULT_INTEGRATION_AGENT_ID,
} from "./config.mjs";
import {
  validateDocumentationClosureSummary,
  validateEvaluatorSummary,
  validateImplementationSummary,
} from "./agent-state.mjs";
import { readJsonOrNull, toIsoTimestamp, writeJsonAtomic } from "./shared.mjs";

function taskId(prefix, suffix) {
  return `${prefix}:${suffix}`;
}

function taskStateFromValidation(validation) {
  if (validation?.ok) {
    return "done";
  }
  return validation ? "blocked" : "planned";
}

function openHighPriorityBlockers(state) {
  return (state?.blockers || []).filter(
    (record) =>
      ["open", "acknowledged", "in_progress"].includes(record.status) &&
      ["high", "urgent"].includes(record.priority),
  );
}

export function buildSeedWaveLedger({
  lane,
  wave,
  evaluatorAgentId = DEFAULT_EVALUATOR_AGENT_ID,
  integrationAgentId = DEFAULT_INTEGRATION_AGENT_ID,
  documentationAgentId = DEFAULT_DOCUMENTATION_AGENT_ID,
}) {
  const tasks = [];
  for (const agent of wave.agents) {
    const kind =
      agent.agentId === evaluatorAgentId
        ? "evaluator"
        : agent.agentId === integrationAgentId
          ? "integration"
          : agent.agentId === documentationAgentId
            ? "documentation"
            : "implementation";
    tasks.push({
      id: taskId(kind, agent.agentId),
      title: `${agent.agentId}: ${agent.title}`,
      owner: agent.agentId,
      kind,
      dependsOn: [],
      state: "planned",
      proofState: "pending",
      docState: "pending",
      infraState: "n/a",
      priority:
        kind === "implementation" ? "normal" : kind === "integration" ? "high" : "high",
      artifactRefs: agent.ownedPaths || [],
    });
  }
  for (const promotion of wave.componentPromotions || []) {
    tasks.push({
      id: taskId("component", promotion.componentId),
      title: `Promote ${promotion.componentId} to ${promotion.targetLevel}`,
      owner: null,
      kind: "component",
      dependsOn: [],
      state: "planned",
      proofState: "pending",
      docState: "pending",
      infraState: "n/a",
      priority: "high",
      artifactRefs: [promotion.componentId],
    });
  }
  return {
    wave: wave.wave,
    lane,
    attempt: 0,
    phase: "planned",
    tasks,
    blockers: [],
    openRequests: [],
    humanFeedback: [],
    integrationState: "pending",
    docClosureState: "pending",
    evaluatorState: "pending",
    updatedAt: toIsoTimestamp(),
  };
}

function derivePhase({ tasks, integrationSummary, docValidation, evaluatorValidation, state }) {
  const blockers = openHighPriorityBlockers(state);
  if (blockers.length > 0) {
    return "blocked";
  }
  const implementationTasks = tasks.filter((task) => task.kind === "implementation");
  const allImplementationDone = implementationTasks.every((task) => task.state === "done");
  if (!allImplementationDone) {
    return "running";
  }
  if (integrationSummary?.recommendation !== "ready-for-doc-closure") {
    return "integrating";
  }
  if (!docValidation?.ok) {
    return "docs-closure";
  }
  if (!evaluatorValidation?.ok) {
    return "evaluator-closure";
  }
  return "completed";
}

export function deriveWaveLedger({
  lane,
  wave,
  summariesByAgentId = {},
  coordinationState = null,
  integrationSummary = null,
  docsQueue = null,
  attempt = 0,
  evaluatorAgentId = DEFAULT_EVALUATOR_AGENT_ID,
  integrationAgentId = DEFAULT_INTEGRATION_AGENT_ID,
  documentationAgentId = DEFAULT_DOCUMENTATION_AGENT_ID,
}) {
  const seed = buildSeedWaveLedger({
    lane,
    wave,
    evaluatorAgentId,
    integrationAgentId,
    documentationAgentId,
  });
  const tasks = seed.tasks.map((task) => {
    const agent = wave.agents.find((item) => item.agentId === task.owner);
    const summary = task.owner ? summariesByAgentId[task.owner] : null;
    if (task.kind === "implementation" && agent) {
      const validation = validateImplementationSummary(agent, summary);
      return {
        ...task,
        state: taskStateFromValidation(validation),
        proofState: validation.ok ? "met" : "gap",
        docState: summary?.docDelta?.state || "pending",
      };
    }
    if (task.kind === "documentation" && agent) {
      const validation = validateDocumentationClosureSummary(agent, summary);
      return {
        ...task,
        state: taskStateFromValidation(validation),
        proofState: "n/a",
        docState: validation.ok ? "closed" : "open",
      };
    }
    if (task.kind === "evaluator" && agent) {
      const validation = validateEvaluatorSummary(agent, summary);
      return {
        ...task,
        state: taskStateFromValidation(validation),
        proofState: validation.ok ? "met" : "gap",
        docState: "n/a",
      };
    }
    if (task.kind === "integration") {
      const ready = integrationSummary?.recommendation === "ready-for-doc-closure";
      return {
        ...task,
        state: ready ? "done" : integrationSummary ? "blocked" : "planned",
        proofState: ready ? "met" : "pending",
        docState: "n/a",
      };
    }
    if (task.kind === "component") {
      const owners = wave.agents.filter((agent) =>
        Array.isArray(agent.components) && agent.components.includes(task.artifactRefs[0]),
      );
      const complete = owners.length > 0 && owners.every((agent) => {
        const summary = summariesByAgentId[agent.agentId];
        return Array.isArray(summary?.components)
          ? summary.components.some(
              (component) =>
                component.componentId === task.artifactRefs[0] && component.state === "met",
            )
          : false;
      });
      return {
        ...task,
        state: complete ? "done" : "blocked",
        proofState: complete ? "met" : "gap",
        docState:
          Array.isArray(docsQueue?.items) && docsQueue.items.some((item) => item.kind === "component-matrix")
            ? "pending"
            : "n/a",
      };
    }
    return task;
  });
  const docAgent = wave.agents.find((agent) => agent.agentId === documentationAgentId);
  const evaluatorAgent = wave.agents.find((agent) => agent.agentId === evaluatorAgentId);
  const docValidation = docAgent
    ? validateDocumentationClosureSummary(docAgent, summariesByAgentId[documentationAgentId])
    : { ok: true };
  const evaluatorValidation = evaluatorAgent
    ? validateEvaluatorSummary(evaluatorAgent, summariesByAgentId[evaluatorAgentId])
    : { ok: true };
  return {
    wave: wave.wave,
    lane,
    attempt,
    phase: derivePhase({
      tasks,
      integrationSummary,
      docValidation,
      evaluatorValidation,
      state: coordinationState,
    }),
    tasks,
    blockers: (coordinationState?.blockers || []).map((record) => record.id),
    openRequests: (coordinationState?.requests || [])
      .filter((record) => ["open", "acknowledged", "in_progress"].includes(record.status))
      .map((record) => record.id),
    humanFeedback: (coordinationState?.humanFeedback || [])
      .filter((record) => ["open", "acknowledged", "in_progress"].includes(record.status))
      .map((record) => record.id),
    integrationState: integrationSummary?.recommendation || "pending",
    docClosureState: docValidation.ok ? "closed" : "open",
    evaluatorState: evaluatorValidation.ok ? "pass" : "open",
    updatedAt: toIsoTimestamp(),
  };
}

export function writeWaveLedger(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

export function readWaveLedger(filePath) {
  return readJsonOrNull(filePath);
}
