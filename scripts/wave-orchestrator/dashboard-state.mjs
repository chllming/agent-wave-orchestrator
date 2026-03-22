import fs from "node:fs";
import path from "node:path";
import {
  DASHBOARD_MAX_EVENTS,
  DASHBOARD_MESSAGEBOARD_TAIL_CHARS,
  DASHBOARD_MESSAGEBOARD_TAIL_LINES,
  DEPLOY_SIGNAL_REGEX,
  INFRA_SIGNAL_REGEX,
  PHASE_SIGNAL_REGEX,
  REPO_ROOT,
  WAVE_TERMINAL_STATES,
  ensureDirectory,
  formatAgeFromTimestamp,
  readFileTail,
  readStatusRecordIfPresent,
  toIsoTimestamp,
  truncate,
  writeJsonAtomic,
} from "./shared.mjs";
import {
  normalizeGlobalDashboardState,
  normalizeWaveDashboardState,
} from "./artifact-schemas.mjs";

export function readStatusCodeIfPresent(statusPath) {
  return readStatusRecordIfPresent(statusPath)?.code ?? null;
}

export function readRollingMessageBoardLines(
  messageBoardPath,
  maxLines = DASHBOARD_MESSAGEBOARD_TAIL_LINES,
) {
  if (!fs.existsSync(messageBoardPath)) {
    return ["(message board missing)"];
  }
  const tail = readFileTail(messageBoardPath, DASHBOARD_MESSAGEBOARD_TAIL_CHARS).trim();
  if (!tail) {
    return ["(message board currently empty)"];
  }
  return tail.split(/\r?\n/).slice(-maxLines);
}

export function inferAgentPhaseFromLog(logPath) {
  const text = readFileTail(logPath, 14000).toLowerCase();
  if (!text) {
    return "running";
  }
  if (
    /(deployment_list|deployment_logs|deployment_status|\brailway\b|\bdeploy(ing|ment)?\b|\brollover\b)/.test(
      text,
    )
  ) {
    return "deploying";
  }
  if (/\b(vitest|pytest|pnpm\b.*\b(test|build|check|lint)\b|typecheck|tsc|go test)\b/.test(text)) {
    return "validating";
  }
  if (/\b(git commit|conventional commit|git push|pushed)\b/.test(text)) {
    return "finalizing";
  }
  if (
    /\b(apply_patch|update file|add file|editing|implementing|starting file edits)\b/.test(text)
  ) {
    return "coding";
  }
  return "running";
}

export function parseStructuredSignalsFromLog(logPath) {
  const text = readFileTail(logPath, 30000);
  if (!text) {
    return { phase: null, deployment: null, infra: null };
  }
  let phase = null;
  PHASE_SIGNAL_REGEX.lastIndex = 0;
  let phaseMatch = PHASE_SIGNAL_REGEX.exec(text);
  while (phaseMatch !== null) {
    phase = String(phaseMatch[1] || "").toLowerCase();
    phaseMatch = PHASE_SIGNAL_REGEX.exec(text);
  }
  let deployment = null;
  DEPLOY_SIGNAL_REGEX.lastIndex = 0;
  let deploymentMatch = DEPLOY_SIGNAL_REGEX.exec(text);
  while (deploymentMatch !== null) {
    deployment = {
      service: String(deploymentMatch[1] || "").trim(),
      state: String(deploymentMatch[2] || "").trim(),
      detail: String(deploymentMatch[3] || "").trim(),
    };
    deploymentMatch = DEPLOY_SIGNAL_REGEX.exec(text);
  }
  let infra = null;
  INFRA_SIGNAL_REGEX.lastIndex = 0;
  let infraMatch = INFRA_SIGNAL_REGEX.exec(text);
  while (infraMatch !== null) {
    infra = {
      kind: String(infraMatch[1] || "").trim(),
      target: String(infraMatch[2] || "").trim(),
      state: String(infraMatch[3] || "").trim(),
      detail: String(infraMatch[4] || "").trim(),
    };
    infraMatch = INFRA_SIGNAL_REGEX.exec(text);
  }
  return { phase, deployment, infra };
}

export function normalizePhaseState(value) {
  const state = String(value || "")
    .trim()
    .toLowerCase();
  return new Set([
    "pending",
    "launching",
    "running",
    "coding",
    "validating",
    "deploying",
    "finalizing",
    "completed",
    "failed",
    "timed_out",
  ]).has(state)
    ? state
    : null;
}

export function buildWaveDashboardState({
  lane,
  wave,
  waveFile,
  runTag,
  maxAttempts,
  messageBoardPath,
  agentRuns,
}) {
  const now = toIsoTimestamp();
  return normalizeWaveDashboardState({
    lane,
    wave,
    waveFile,
    runTag,
    status: "running",
    attempt: 0,
    maxAttempts,
    startedAt: now,
    updatedAt: now,
    messageBoardPath: path.relative(REPO_ROOT, messageBoardPath),
    messageBoardTail: readRollingMessageBoardLines(messageBoardPath),
    helperAssignmentsOpen: 0,
    inboundDependenciesOpen: 0,
    outboundDependenciesOpen: 0,
    agents: agentRuns.map((run) => ({
      agentId: run.agent.agentId,
      title: run.agent.title,
      slug: run.agent.slug,
      state: "pending",
      attempts: 0,
      sessionName: run.sessionName,
      promptPath: path.relative(REPO_ROOT, run.promptPath),
      logPath: path.relative(REPO_ROOT, run.logPath),
      statusPath: path.relative(REPO_ROOT, run.statusPath),
      startedAt: null,
      completedAt: null,
      lastUpdateAt: now,
      exitCode: null,
      deploymentService: null,
      deploymentState: null,
      deploymentDetail: "",
      infraKind: null,
      infraTarget: null,
      infraState: null,
      infraDetail: "",
      detail: "",
    })),
    events: [],
  });
}

export function buildGlobalDashboardState({
  lane,
  selectedWaves,
  options,
  runStatePath,
  manifestOut,
  feedbackRequestsDir,
}) {
  const now = toIsoTimestamp();
  return normalizeGlobalDashboardState({
    lane,
    runId: Math.random().toString(16).slice(2, 14),
    status: "running",
    startedAt: now,
    updatedAt: now,
    options: {
      lane: options.lane,
      startWave: options.startWave,
      endWave: options.endWave,
      autoNext: options.autoNext,
      timeoutMinutes: options.timeoutMinutes,
      maxRetriesPerWave: options.maxRetriesPerWave,
      dashboard: options.dashboard,
      cleanupSessions: options.cleanupSessions,
      orchestratorId: options.orchestratorId,
      orchestratorBoardPath: options.orchestratorBoardPath
        ? path.relative(REPO_ROOT, options.orchestratorBoardPath)
        : null,
      coordinationNote: options.coordinationNote || "",
    },
    paths: {
      runState: path.relative(REPO_ROOT, runStatePath),
      manifest: path.relative(REPO_ROOT, manifestOut),
      feedbackRequests: path.relative(REPO_ROOT, feedbackRequestsDir),
    },
    waves: selectedWaves.map((wave) => ({
      wave: wave.wave,
      waveFile: wave.file,
      status: "pending",
      attempt: 0,
      maxAttempts: options.maxRetriesPerWave + 1,
      dashboardPath: path.relative(
        REPO_ROOT,
        path.join(path.dirname(runStatePath), "dashboards", `wave-${wave.wave}.json`),
      ),
      messageBoardPath: path.relative(
        REPO_ROOT,
        path.join(path.dirname(runStatePath), "messageboards", `wave-${wave.wave}.md`),
      ),
      startedAt: null,
      completedAt: null,
      agentsTotal: wave.agents.length,
      agentsCompleted: 0,
      agentsFailed: 0,
      helperAssignmentsOpen: 0,
      inboundDependenciesOpen: 0,
      outboundDependenciesOpen: 0,
      lastMessage: "",
      deployments: [],
      infraFindings: [],
    })),
    events: [],
  });
}

export function writeWaveDashboard(dashboardPath, state) {
  ensureDirectory(path.dirname(dashboardPath));
  const normalized = normalizeWaveDashboardState({
    ...state,
    updatedAt: toIsoTimestamp(),
  });
  Object.assign(state, normalized);
  writeJsonAtomic(dashboardPath, normalized);
}

export function writeGlobalDashboard(globalDashboardPath, state) {
  ensureDirectory(path.dirname(globalDashboardPath));
  const normalized = normalizeGlobalDashboardState({
    ...state,
    updatedAt: toIsoTimestamp(),
  });
  Object.assign(state, normalized);
  writeJsonAtomic(globalDashboardPath, normalized);
}

export function recordWaveDashboardEvent(state, { level = "info", agentId = null, message }) {
  state.events.push({
    at: toIsoTimestamp(),
    level,
    agentId,
    message,
  });
  if (state.events.length > DASHBOARD_MAX_EVENTS) {
    state.events = state.events.slice(state.events.length - DASHBOARD_MAX_EVENTS);
  }
}

export function recordGlobalDashboardEvent(globalState, { level = "info", wave = null, message }) {
  globalState.events.push({
    at: toIsoTimestamp(),
    level,
    wave,
    message,
  });
  if (globalState.events.length > DASHBOARD_MAX_EVENTS) {
    globalState.events = globalState.events.slice(globalState.events.length - DASHBOARD_MAX_EVENTS);
  }
}

export function updateWaveDashboardMessageBoard(state, messageBoardPath) {
  state.messageBoardTail = readRollingMessageBoardLines(messageBoardPath);
}

export function getGlobalWaveEntry(globalState, waveNumber) {
  return globalState.waves.find((entry) => entry.wave === waveNumber) || null;
}

export function syncGlobalWaveFromWaveDashboard(globalState, waveDashboard) {
  const entry = getGlobalWaveEntry(globalState, waveDashboard.wave);
  if (!entry) {
    return;
  }
  entry.status = waveDashboard.status;
  entry.attempt = waveDashboard.attempt;
  entry.startedAt = waveDashboard.startedAt;
  if (WAVE_TERMINAL_STATES.has(waveDashboard.status)) {
    entry.completedAt = entry.completedAt || toIsoTimestamp();
  }
  const agents = Array.isArray(waveDashboard.agents) ? waveDashboard.agents : [];
  entry.agentsTotal = agents.length;
  entry.agentsCompleted = agents.filter((agent) => agent.state === "completed").length;
  entry.agentsFailed = agents.filter(
    (agent) => agent.state === "failed" || agent.state === "timed_out",
  ).length;
  const latestEvent = waveDashboard.events.at(-1);
  entry.lastMessage = latestEvent?.message || entry.lastMessage || "";
  entry.helperAssignmentsOpen = waveDashboard.helperAssignmentsOpen || 0;
  entry.inboundDependenciesOpen = waveDashboard.inboundDependenciesOpen || 0;
  entry.outboundDependenciesOpen = waveDashboard.outboundDependenciesOpen || 0;
  entry.deployments = agents
    .filter((agent) => agent.deploymentState)
    .map((agent) => ({
      agentId: agent.agentId,
      service: agent.deploymentService || "",
      state: agent.deploymentState,
      detail: agent.deploymentDetail || "",
      updatedAt: agent.lastUpdateAt || "",
    }));
  entry.infraFindings = agents
    .filter((agent) => agent.infraState)
    .map((agent) => ({
      agentId: agent.agentId,
      kind: agent.infraKind || "",
      target: agent.infraTarget || "",
      state: agent.infraState,
      detail: agent.infraDetail || "",
      updatedAt: agent.lastUpdateAt || "",
    }));
}

export function setWaveDashboardAgent(state, agentId, updates) {
  const agent = state.agents.find((entry) => entry.agentId === agentId);
  if (!agent) {
    return;
  }
  Object.assign(agent, updates);
  agent.lastUpdateAt = toIsoTimestamp();
}

export function refreshWaveDashboardAgentStates(
  state,
  agentRuns,
  pendingAgentIds,
  eventSink = null,
) {
  for (const run of agentRuns) {
    const code = readStatusCodeIfPresent(run.statusPath);
    const current = state.agents.find((entry) => entry.agentId === run.agent.agentId);
    if (!current) {
      continue;
    }
    if (code === 0) {
      setWaveDashboardAgent(state, run.agent.agentId, {
        state: "completed",
        exitCode: 0,
        completedAt: toIsoTimestamp(),
        detail: "Exit 0",
      });
      continue;
    }
    if (code !== null) {
      setWaveDashboardAgent(state, run.agent.agentId, {
        state: code === 124 ? "timed_out" : "failed",
        exitCode: code,
        completedAt: toIsoTimestamp(),
        detail: `Exit ${code}`,
      });
      continue;
    }
    if (!pendingAgentIds.has(run.agent.agentId)) {
      continue;
    }

    const signals = parseStructuredSignalsFromLog(run.logPath);
    const signaledState = normalizePhaseState(signals.phase);
    if (signaledState && signaledState !== current.state) {
      setWaveDashboardAgent(state, run.agent.agentId, {
        state: signaledState,
        detail: `Signaled from log (${signaledState})`,
      });
      eventSink?.({
        level: "info",
        agentId: run.agent.agentId,
        message: `Phase signaled: ${signaledState}`,
      });
    } else {
      const inferred = inferAgentPhaseFromLog(run.logPath);
      if (inferred !== current.state) {
        setWaveDashboardAgent(state, run.agent.agentId, {
          state: inferred,
          detail: `Inferred from log (${inferred})`,
        });
      }
    }

    if (signals.deployment) {
      const changed =
        current.deploymentService !== signals.deployment.service ||
        current.deploymentState !== signals.deployment.state ||
        current.deploymentDetail !== signals.deployment.detail;
      if (changed) {
        setWaveDashboardAgent(state, run.agent.agentId, {
          deploymentService: signals.deployment.service,
          deploymentState: signals.deployment.state,
          deploymentDetail: signals.deployment.detail,
          detail: `Deploy ${signals.deployment.service}: ${signals.deployment.state}`,
        });
        eventSink?.({
          level: signals.deployment.state === "failed" ? "error" : "info",
          agentId: run.agent.agentId,
          message: `Deployment ${signals.deployment.service} => ${signals.deployment.state}${
            signals.deployment.detail ? ` (${signals.deployment.detail})` : ""
          }`,
        });
      }
    }
    if (signals.infra) {
      const changed =
        current.infraKind !== signals.infra.kind ||
        current.infraTarget !== signals.infra.target ||
        current.infraState !== signals.infra.state ||
        current.infraDetail !== signals.infra.detail;
      if (changed) {
        setWaveDashboardAgent(state, run.agent.agentId, {
          infraKind: signals.infra.kind,
          infraTarget: signals.infra.target,
          infraState: signals.infra.state,
          infraDetail: signals.infra.detail,
          detail: `Infra ${signals.infra.kind}:${signals.infra.state}`,
        });
        const infraState = String(signals.infra.state || "").trim().toLowerCase();
        eventSink?.({
          level:
            infraState === "drift" || infraState === "blocked" || infraState === "failed"
              ? "error"
              : infraState === "setup-required" ||
                  infraState === "setup-in-progress" ||
                  infraState === "action-required" ||
                  infraState === "action-approved"
                ? "warn"
                : "info",
          agentId: run.agent.agentId,
          message: `Infra ${signals.infra.kind} ${signals.infra.target} => ${signals.infra.state}${
            signals.infra.detail ? ` (${signals.infra.detail})` : ""
          }`,
        });
      }
    }
  }
}

export function renderCountsByState(agents) {
  const counts = new Map();
  for (const agent of agents || []) {
    const key = agent?.state || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([state, count]) => `${state}:${count}`)
    .join("  ");
}

export function resolveWaveMessageBoardPathForLane(lanePaths, waveNumber) {
  return path.join(lanePaths.messageboardsDir, `wave-${waveNumber}.md`);
}

export function deploymentSummary(deployment) {
  if (!deployment?.state) {
    return "-";
  }
  return truncate(`${deployment.service || "service"}:${deployment.state}`, 24);
}

export function commsAgeSummary(value) {
  return formatAgeFromTimestamp(value);
}
