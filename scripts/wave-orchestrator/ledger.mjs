import {
  DEFAULT_CONT_EVAL_AGENT_ID,
  DEFAULT_DOCUMENTATION_AGENT_ID,
  DEFAULT_CONT_QA_AGENT_ID,
  DEFAULT_INTEGRATION_AGENT_ID,
} from "./config.mjs";
import {
  validateContEvalSummary,
  validateDesignSummary,
  validateDocumentationClosureSummary,
  validateContQaSummary,
  validateImplementationSummary,
  validateSecuritySummary,
} from "./agent-state.mjs";
import {
  isContEvalImplementationOwningAgent,
  isDesignAgent,
  isImplementationOwningDesignAgent,
  isSecurityReviewAgent,
} from "./role-helpers.mjs";
import { openClarificationLinkedRequests } from "./coordination-store.mjs";
import { buildHelperTasks } from "./routing-state.mjs";
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

function openClarifications(state) {
  return (state?.clarifications || []).filter((record) =>
    ["open", "acknowledged", "in_progress"].includes(record.status),
  );
}

export function buildSeedWaveLedger({
  lane,
  wave,
  contQaAgentId = DEFAULT_CONT_QA_AGENT_ID,
  contEvalAgentId = DEFAULT_CONT_EVAL_AGENT_ID,
  integrationAgentId = DEFAULT_INTEGRATION_AGENT_ID,
  documentationAgentId = DEFAULT_DOCUMENTATION_AGENT_ID,
}) {
  const tasks = [];
  for (const agent of wave.agents) {
    const hybridDesignAgent = isImplementationOwningDesignAgent(agent);
    const kind =
      agent.agentId === contQaAgentId
        ? "cont-qa"
        : agent.agentId === contEvalAgentId
          ? "cont-eval"
        : agent.agentId === integrationAgentId
          ? "integration"
        : agent.agentId === documentationAgentId
            ? "documentation"
            : isDesignAgent(agent)
              ? "design"
            : isSecurityReviewAgent(agent)
              ? "security"
              : "implementation";
    const runtime = agent.executorResolved
      ? {
          executorId: agent.executorResolved.id,
          role: agent.executorResolved.role,
          profile: agent.executorResolved.profile,
          selectedBy: agent.executorResolved.selectedBy,
          retryPolicy: agent.executorResolved.retryPolicy || null,
          allowFallbackOnRetry: agent.executorResolved.allowFallbackOnRetry !== false,
          fallbacks: agent.executorResolved.fallbacks || [],
          fallbackUsed: agent.executorResolved.fallbackUsed === true,
        }
      : null;
    const pushTask = (taskKind) => {
      tasks.push({
        id: taskId(taskKind, agent.agentId),
        title: `${agent.agentId}: ${agent.title}`,
        owner: agent.agentId,
        kind: taskKind,
        dependsOn: [],
        state: "planned",
        proofState: "pending",
        docState: "pending",
        infraState: "n/a",
        priority:
          taskKind === "implementation" ? "normal" : taskKind === "integration" ? "high" : "high",
        artifactRefs: agent.ownedPaths || [],
        runtime,
      });
    };
    if (hybridDesignAgent && kind === "design") {
      pushTask("design");
      pushTask("implementation");
      continue;
    }
    pushTask(kind);
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
      runtime: null,
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
    openClarifications: [],
    clarificationLinkedRequests: [],
    humanFeedback: [],
    humanEscalations: [],
    contEvalState: "pending",
    securityState: "pending",
    integrationState: "pending",
    docClosureState: "pending",
    contQaState: "pending",
    updatedAt: toIsoTimestamp(),
  };
}

function derivePhase({
  tasks,
  integrationSummary,
  contEvalValidation,
  securityValidation,
  docValidation,
  contQaValidation,
  state,
  dependencySnapshot = null,
}) {
  const blockers = openHighPriorityBlockers(state);
  if (blockers.length > 0) {
    return "blocked";
  }
  if (
    openClarifications(state).length > 0 ||
    openClarificationLinkedRequests(state).length > 0
  ) {
    return "clarifying";
  }
  const dependencyBlockers =
    (dependencySnapshot?.requiredInbound || []).length + (dependencySnapshot?.requiredOutbound || []).length;
  if (dependencyBlockers > 0) {
    return "blocked";
  }
  const blockingHelperTasks = tasks.filter((task) =>
    ["helper", "dependency", "dependency-outbound"].includes(task.kind) &&
    !["done", "closed", "resolved"].includes(task.state),
  );
  if (blockingHelperTasks.length > 0) {
    return blockingHelperTasks.some((task) => task.state === "blocked") ? "blocked" : "running";
  }
  const implementationTasks = tasks.filter((task) => task.kind === "implementation");
  const designTasks = tasks.filter((task) => task.kind === "design");
  const allDesignDone = designTasks.every((task) => task.state === "done");
  if (!allDesignDone && designTasks.length > 0) {
    return "design";
  }
  const allImplementationDone = implementationTasks.every((task) => task.state === "done");
  if (!allImplementationDone) {
    return "running";
  }
  if (tasks.some((task) => task.kind === "cont-eval") && !contEvalValidation?.ok) {
    return "cont-eval";
  }
  if (tasks.some((task) => task.kind === "security") && !securityValidation?.ok) {
    return "security-review";
  }
  if (integrationSummary?.recommendation !== "ready-for-doc-closure") {
    return "integrating";
  }
  if (!docValidation?.ok) {
    return "docs-closure";
  }
  if (!contQaValidation?.ok) {
    return "cont-qa-closure";
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
  contQaAgentId = DEFAULT_CONT_QA_AGENT_ID,
  contEvalAgentId = DEFAULT_CONT_EVAL_AGENT_ID,
  integrationAgentId = DEFAULT_INTEGRATION_AGENT_ID,
  documentationAgentId = DEFAULT_DOCUMENTATION_AGENT_ID,
  benchmarkCatalogPath = null,
  capabilityAssignments = [],
  dependencySnapshot = null,
}) {
  const seed = buildSeedWaveLedger({
    lane,
    wave,
    contQaAgentId,
    contEvalAgentId,
    integrationAgentId,
    documentationAgentId,
  });
  const primaryTasks = seed.tasks.map((task) => {
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
    if (task.kind === "design" && agent) {
      const validation = validateDesignSummary(agent, summary);
      return {
        ...task,
        state: taskStateFromValidation(validation),
        proofState: validation.ok ? "met" : "gap",
        docState: validation.ok ? "met" : "gap",
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
    if (task.kind === "cont-eval" && agent) {
      const evalValidation = validateContEvalSummary(agent, summary, {
        mode: "live",
        evalTargets: wave.evalTargets,
        benchmarkCatalogPath,
      });
      const implementationValidation = isContEvalImplementationOwningAgent(agent, {
        contEvalAgentId,
      })
        ? validateImplementationSummary(agent, summary)
        : { ok: true, statusCode: "pass", detail: "cont-EVAL is report-only." };
      const validation = !evalValidation.ok ? evalValidation : implementationValidation;
      return {
        ...task,
        state: taskStateFromValidation(validation),
        proofState: validation.ok ? "met" : "gap",
        docState: "n/a",
      };
    }
    if (task.kind === "cont-qa" && agent) {
      const validation = validateContQaSummary(agent, summary, {
        mode: "live",
      });
      return {
        ...task,
        state: taskStateFromValidation(validation),
        proofState: validation.ok ? "met" : "gap",
        docState: "n/a",
      };
    }
    if (task.kind === "security" && agent) {
      const validation = validateSecuritySummary(agent, summary);
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
  const helperTasks = buildHelperTasks({
    wave,
    assignments: capabilityAssignments,
    dependencySnapshot,
    docsQueue,
    documentationAgentId,
  });
  const tasks = [...primaryTasks, ...helperTasks];
  const docAgent = wave.agents.find((agent) => agent.agentId === documentationAgentId);
  const contEvalAgent = wave.agents.find((agent) => agent.agentId === contEvalAgentId);
  const contQaAgent = wave.agents.find((agent) => agent.agentId === contQaAgentId);
  const securityAgents = (wave.agents || []).filter((agent) => isSecurityReviewAgent(agent));
  const contEvalValidation = (() => {
    if (!contEvalAgent) {
      return { ok: true };
    }
    const summary = summariesByAgentId[contEvalAgentId];
    const evalValidation = validateContEvalSummary(contEvalAgent, summary, {
      mode: "live",
      evalTargets: wave.evalTargets,
      benchmarkCatalogPath,
    });
    if (!evalValidation.ok) {
      return evalValidation;
    }
    if (
      isContEvalImplementationOwningAgent(contEvalAgent, {
        contEvalAgentId,
      })
    ) {
      return validateImplementationSummary(contEvalAgent, summary);
    }
    return evalValidation;
  })();
  const docValidation = docAgent
    ? validateDocumentationClosureSummary(docAgent, summariesByAgentId[documentationAgentId])
    : { ok: true };
  const securityValidation = (() => {
    if (securityAgents.length === 0) {
      return { ok: true, statusCode: "pass" };
    }
    for (const agent of securityAgents) {
      const validation = validateSecuritySummary(agent, summariesByAgentId[agent.agentId]);
      if (!validation.ok) {
        return validation;
      }
    }
    return securityAgents.some(
      (agent) => summariesByAgentId[agent.agentId]?.security?.state === "concerns",
    )
      ? { ok: true, statusCode: "security-concerns" }
      : { ok: true, statusCode: "pass" };
  })();
  const contQaValidation = contQaAgent
    ? validateContQaSummary(contQaAgent, summariesByAgentId[contQaAgentId], {
        mode: "live",
      })
    : { ok: true };
  return {
    wave: wave.wave,
    lane,
    attempt,
    phase: derivePhase({
      tasks,
      integrationSummary,
      contEvalValidation,
      securityValidation,
      docValidation,
      contQaValidation,
      state: coordinationState,
      dependencySnapshot,
    }),
    tasks,
    blockers: (coordinationState?.blockers || []).map((record) => record.id),
    openClarifications: openClarifications(coordinationState).map((record) => record.id),
    clarificationLinkedRequests: openClarificationLinkedRequests(coordinationState).map(
      (record) => record.id,
    ),
    openRequests: (coordinationState?.requests || [])
      .filter((record) => ["open", "acknowledged", "in_progress"].includes(record.status))
      .map((record) => record.id),
    capabilityAssignments: (capabilityAssignments || []).map((assignment) => ({
      id: assignment.id,
      requestId: assignment.requestId,
      assignedAgentId: assignment.assignedAgentId,
      target: assignment.target,
      targetType: assignment.targetType,
      capability: assignment.capability,
      blocking: assignment.blocking,
      assignmentReason: assignment.assignmentReason,
      state: assignment.state,
    })),
    dependencySnapshot: dependencySnapshot
      ? {
          openInbound: dependencySnapshot.openInbound.map((record) => record.id),
          openOutbound: dependencySnapshot.openOutbound.map((record) => record.id),
          requiredInbound: dependencySnapshot.requiredInbound.map((record) => record.id),
          requiredOutbound: dependencySnapshot.requiredOutbound.map((record) => record.id),
          unresolvedInboundAssignments: dependencySnapshot.unresolvedInboundAssignments.map(
            (record) => record.id,
          ),
        }
      : null,
    humanFeedback: [
      ...(coordinationState?.humanFeedback || [])
        .filter((record) => ["open", "acknowledged", "in_progress"].includes(record.status))
        .map((record) => record.id),
      ...(coordinationState?.humanEscalations || [])
        .filter((record) => ["open", "acknowledged", "in_progress"].includes(record.status))
      .map((record) => record.id),
    ],
    humanEscalations: (coordinationState?.humanEscalations || [])
      .filter((record) => ["open", "acknowledged", "in_progress"].includes(record.status))
      .map((record) => record.id),
    contEvalState: contEvalValidation.ok ? "pass" : "open",
    securityState: securityValidation.ok ? securityValidation.statusCode || "pass" : "open",
    integrationState: integrationSummary?.recommendation || "pending",
    docClosureState: docValidation.ok ? "closed" : "open",
    contQaState: contQaValidation.ok ? "pass" : "open",
    updatedAt: toIsoTimestamp(),
  };
}

export function writeWaveLedger(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

export function readWaveLedger(filePath) {
  return readJsonOrNull(filePath);
}
