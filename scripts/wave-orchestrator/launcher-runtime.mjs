import fs from "node:fs";
import path from "node:path";
import { buildExecutionPrompt } from "./coordination.mjs";
import {
  DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS,
  DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS,
  DEFAULT_WAIT_PROGRESS_INTERVAL_MS,
  REPO_ROOT,
  ensureDirectory,
  readJsonOrNull,
  shellQuote,
  sleep,
  writeJsonAtomic,
} from "./shared.mjs";
import { readStatusCodeIfPresent } from "./dashboard-state.mjs";
import { buildExecutorLaunchSpec } from "./executors.mjs";
import { hashAgentPromptFingerprint, prefetchContext7ForSelection } from "./context7.mjs";
import { isDesignAgent, resolveDesignReportPath, resolveWaveRoleBindings } from "./role-helpers.mjs";
import {
  resolveAgentSkills,
  summarizeResolvedSkills,
  writeResolvedSkillArtifacts,
} from "./skills.mjs";
import {
  agentSignalAckPath,
  agentSignalPath,
  agentUsesSignalHygiene,
} from "./signals.mjs";
import {
  spawnAgentProcessRunner,
  terminateAgentProcessRuntime,
} from "./agent-process-runner.mjs";

export function refreshResolvedSkillsForRun(runInfo, waveDefinition, lanePaths) {
  runInfo.agent.skillsResolved = resolveAgentSkills(
    runInfo.agent,
    waveDefinition || { deployEnvironments: [] },
    { laneProfile: lanePaths.laneProfile },
  );
  return runInfo.agent.skillsResolved;
}

export function applyLaunchResultToRun(
  runInfo,
  launchResult,
  {
    attempt = null,
    fallbackExecutorId = null,
    fallbackSkills = null,
  } = {},
) {
  if (!runInfo || !launchResult) {
    return runInfo;
  }
  if (attempt !== null && attempt !== undefined) {
    runInfo.lastLaunchAttempt = attempt;
  }
  runInfo.lastPromptHash = launchResult.promptHash || null;
  runInfo.lastContext7 = launchResult.context7 || null;
  runInfo.lastExecutorId = launchResult.executorId || fallbackExecutorId || null;
  runInfo.lastSkillProjection = launchResult.skills || fallbackSkills || null;
  runInfo.runtimePath = launchResult.runtimePath || runInfo.runtimePath || null;
  runInfo.sessionBackend = launchResult.sessionBackend || runInfo.sessionBackend || "process";
  runInfo.attachMode = launchResult.attachMode || runInfo.attachMode || "log-tail";
  return runInfo;
}

export function collectUnexpectedSessionWarnings(
  lanePaths,
  agentRuns,
  pendingAgentIds,
  { listLaneTmuxSessionNamesFn },
) {
  const warnings = [];
  for (const run of agentRuns) {
    if (!pendingAgentIds.has(run.agent.agentId) || fs.existsSync(run.statusPath)) {
      continue;
    }
    if (!run.runtimePath || !fs.existsSync(run.runtimePath)) {
      continue;
    }
    const runtimeRecord = JSON.parse(fs.readFileSync(run.runtimePath, "utf8"));
    if (!runtimeRecord || typeof runtimeRecord !== "object") {
      continue;
    }
    if (runtimeRecord.terminalDisposition !== "projection-missing") {
      continue;
    }
    warnings.push({
      agentId: run.agent.agentId,
      statusCode: "terminal-session-missing",
      logPath: path.relative(REPO_ROOT, run.logPath),
      detail: `terminal projection for ${run.sessionName} disappeared before ${path.relative(REPO_ROOT, run.statusPath)} was written.`,
    });
  }
  return warnings;
}

export async function launchAgentSession(
  lanePaths,
  params,
  { spawnRunnerFn = spawnAgentProcessRunner } = {},
) {
  const {
    wave,
    waveDefinition = null,
    agent,
    sessionName,
    promptPath,
    logPath,
    statusPath,
    messageBoardPath,
    messageBoardSnapshot,
    sharedSummaryPath,
    sharedSummaryText,
    inboxPath,
    inboxText,
    promptOverride = "",
    orchestratorId,
    attempt = 1,
    agentRateLimitRetries,
    agentRateLimitBaseDelaySeconds,
    agentRateLimitMaxDelaySeconds,
    context7Enabled,
    designExecutionMode = null,
    dryRun = false,
    runtimePath = null,
  } = params;
  ensureDirectory(path.dirname(promptPath));
  ensureDirectory(path.dirname(logPath));
  ensureDirectory(path.dirname(statusPath));
  if (runtimePath && fs.existsSync(runtimePath)) {
    const priorRuntime = readJsonOrNull(runtimePath);
    if (priorRuntime && typeof priorRuntime === "object") {
      await terminateAgentProcessRuntime(priorRuntime);
    }
  }
  fs.rmSync(statusPath, { force: true });
  if (runtimePath) {
    ensureDirectory(path.dirname(runtimePath));
    fs.rmSync(runtimePath, { force: true });
  }

  const context7 = await prefetchContext7ForSelection(agent.context7Resolved, {
    cacheDir: lanePaths.context7CacheDir,
    disabled: !context7Enabled,
  });
  const overlayDir = path.join(lanePaths.executorOverlaysDir, `wave-${wave}`, agent.slug);
  ensureDirectory(overlayDir);
  const resolvedWaveDefinition = waveDefinition || { deployEnvironments: [] };
  const skillsResolved =
    agent.skillsResolved ||
    resolveAgentSkills(agent, resolvedWaveDefinition, {
      laneProfile: lanePaths.laneProfile,
    });
  agent.skillsResolved = skillsResolved;
  const skillArtifacts = writeResolvedSkillArtifacts(overlayDir, skillsResolved);
  if (skillArtifacts) {
    agent.skillsResolved = {
      ...skillsResolved,
      artifacts: skillArtifacts,
    };
  }
  const prompt =
    String(promptOverride || "").trim() ||
    buildExecutionPrompt({
      ...resolveWaveRoleBindings(resolvedWaveDefinition, lanePaths),
      lane: lanePaths.lane,
      wave,
      agent,
      orchestratorId,
      messageBoardPath,
      messageBoardSnapshot,
      sharedSummaryPath,
      sharedSummaryText,
      inboxPath,
      inboxText,
      context7,
      componentPromotions: resolvedWaveDefinition.componentPromotions,
      evalTargets: resolvedWaveDefinition.evalTargets,
      benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
      sharedPlanDocs: lanePaths.sharedPlanDocs,
      designPacketPaths: (resolvedWaveDefinition.agents || [])
        .filter((waveAgent) => isDesignAgent(waveAgent))
        .map((waveAgent) => resolveDesignReportPath(waveAgent))
        .filter(Boolean),
      designExecutionMode,
      signalStatePath: agentUsesSignalHygiene(agent)
        ? agentSignalPath(lanePaths, wave, agent.agentId)
        : null,
      signalAckPath: agentUsesSignalHygiene(agent)
        ? agentSignalAckPath(lanePaths, wave, agent.agentId)
        : null,
    });
  const promptHash = hashAgentPromptFingerprint(agent);
  fs.writeFileSync(promptPath, `${prompt}\n`, "utf8");
  const launchSpec = buildExecutorLaunchSpec({
    agent,
    promptPath,
    logPath,
    overlayDir,
    skillProjection: agent.skillsResolved,
  });
  const resolvedExecutorMode = launchSpec.executorId || agent.executorResolved?.id || "codex";
  writeJsonAtomic(path.join(overlayDir, "launch-preview.json"), {
    executorId: resolvedExecutorMode,
    command: launchSpec.command,
    env: launchSpec.env || {},
    useRateLimitRetries: launchSpec.useRateLimitRetries === true,
    invocationLines: launchSpec.invocationLines,
    limits: launchSpec.limits || null,
    skills: summarizeResolvedSkills(agent.skillsResolved),
  });
  if (dryRun) {
    return {
      promptHash,
      context7,
      executorId: resolvedExecutorMode,
      launchSpec,
      dryRun: true,
      skills: summarizeResolvedSkills(agent.skillsResolved),
    };
  }

  const executionLines = [];
  if (launchSpec.env) {
    for (const [key, value] of Object.entries(launchSpec.env)) {
      executionLines.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  if (!launchSpec.useRateLimitRetries) {
    executionLines.push(...launchSpec.invocationLines);
    executionLines.push("status=$?");
  } else {
    executionLines.push(`: > ${shellQuote(logPath)}`);
    executionLines.push(
      `max_rate_attempts=${Math.max(1, Number.parseInt(String(agentRateLimitRetries || 0), 10) + 1)}`,
    );
    executionLines.push(
      `rate_delay_base=${Math.max(1, Number.parseInt(String(agentRateLimitBaseDelaySeconds || DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS), 10))}`,
    );
    executionLines.push(
      `rate_delay_max=${Math.max(1, Number.parseInt(String(agentRateLimitMaxDelaySeconds || DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS), 10))}`,
    );
    executionLines.push("rate_attempt=1");
    executionLines.push("status=1");
    executionLines.push('while [ "$rate_attempt" -le "$max_rate_attempts" ]; do');
    executionLines.push(
      `  attempt_log_offset=$(wc -c < ${shellQuote(logPath)} 2>/dev/null || echo 0)`,
    );
    for (const line of launchSpec.invocationLines) {
      executionLines.push(`  ${line}`);
    }
    executionLines.push("  status=$?");
    executionLines.push('  if [ "$status" -eq 0 ]; then');
    executionLines.push("    break");
    executionLines.push("  fi");
    executionLines.push('  if [ "$rate_attempt" -ge "$max_rate_attempts" ]; then');
    executionLines.push("    break");
    executionLines.push("  fi");
    executionLines.push(
      `  if tail -c +$((attempt_log_offset + 1)) ${shellQuote(logPath)} | grep -Eqi '429 Too Many Requests|exceeded retry limit|last status: 429|rate limit'; then`,
    );
    executionLines.push("    sleep_seconds=$((rate_delay_base * (2 ** (rate_attempt - 1))))");
    executionLines.push(
      '    if [ "$sleep_seconds" -gt "$rate_delay_max" ]; then sleep_seconds=$rate_delay_max; fi',
    );
    executionLines.push("    jitter=$((RANDOM % 5))");
    executionLines.push("    sleep_seconds=$((sleep_seconds + jitter))");
    executionLines.push(
      `    echo "[${lanePaths.lane}-wave-launcher] rate-limit detected for ${agent.agentId}; retry \${rate_attempt}/\${max_rate_attempts} after \${sleep_seconds}s" | tee -a ${shellQuote(logPath)}`,
    );
    executionLines.push('    sleep "$sleep_seconds"');
    executionLines.push("    rate_attempt=$((rate_attempt + 1))");
    executionLines.push("    continue");
    executionLines.push("  fi");
    executionLines.push("  break");
    executionLines.push("done");
  }

  const command = [
    `cd ${shellQuote(REPO_ROOT)}`,
    "set -o pipefail",
    `export WAVE_ORCHESTRATOR_ID=${shellQuote(orchestratorId || "")}`,
    `export WAVE_EXECUTOR_MODE=${shellQuote(resolvedExecutorMode)}`,
    ...executionLines,
  ].join("\n");
  const payloadPath = path.join(overlayDir, "runner-payload.json");
  const initialRuntimeRecord = runtimePath
    ? {
      runId: process.env.WAVE_SUPERVISOR_RUN_ID || null,
      waveNumber: wave,
      attempt: Number(attempt || 1),
      agentId: agent.agentId,
      sessionName,
      tmuxSessionName: null,
      sessionBackend: "process",
      attachMode: "log-tail",
      runnerPid: null,
      executorPid: null,
      pid: null,
      pgid: null,
      startedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      statusPath,
      logPath,
      exitCode: null,
      exitReason: null,
      terminalDisposition: "launching",
    }
    : null;
  if (runtimePath && initialRuntimeRecord) {
    writeJsonAtomic(runtimePath, initialRuntimeRecord);
  }
  const runner = spawnRunnerFn({
    payloadPath,
    runId: process.env.WAVE_SUPERVISOR_RUN_ID || null,
    lane: lanePaths.lane,
    waveNumber: wave,
    attempt: Number(attempt || 1),
    agentId: agent.agentId,
    sessionName,
    runtimePath,
    statusPath,
    logPath,
    promptHash,
    orchestratorId: orchestratorId || "",
    executorId: resolvedExecutorMode,
    env: launchSpec.env || {},
    command,
  });
  if (runtimePath && initialRuntimeRecord) {
    writeJsonAtomic(runtimePath, {
      ...initialRuntimeRecord,
      runnerPid: runner?.runnerPid || null,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }
  return {
    promptHash,
    context7,
    executorId: resolvedExecutorMode,
    skills: summarizeResolvedSkills(agent.skillsResolved),
    runtimePath,
    sessionBackend: "process",
    attachMode: "log-tail",
  };
}

export async function waitForWaveCompletion(
  lanePaths,
  agentRuns,
  timeoutMinutes,
  onProgress = null,
  { collectUnexpectedSessionWarningsFn = () => [] },
) {
  const defaultTimeoutMs = timeoutMinutes * 60 * 1000;
  const startedAt = Date.now();
  const timeoutAtByAgentId = new Map(
    agentRuns.map((run) => {
      const budgetMinutes = Number(run.agent.executorResolved?.budget?.minutes || 0);
      const effectiveBudgetMs =
        Number.isFinite(budgetMinutes) && budgetMinutes > 0
          ? Math.min(defaultTimeoutMs, budgetMinutes * 60 * 1000)
          : defaultTimeoutMs;
      return [run.agent.agentId, startedAt + effectiveBudgetMs];
    }),
  );
  const pending = new Set(agentRuns.map((run) => run.agent.agentId));
  const timedOutAgentIds = new Set();
  let sessionWarnings = [];
  const refreshPending = () => {
    for (const run of agentRuns) {
      if (pending.has(run.agent.agentId) && fs.existsSync(run.statusPath)) {
        pending.delete(run.agent.agentId);
      }
    }
  };

  while (true) {
    refreshPending();
    onProgress?.({ pendingAgentIds: new Set(pending), timedOut: false });
    if (pending.size === 0) {
      break;
    }
    sessionWarnings = collectUnexpectedSessionWarningsFn(lanePaths, agentRuns, pending);
    if (sessionWarnings.length > 0) {
      onProgress?.({
        pendingAgentIds: new Set(pending),
        timedOut: false,
        warnings: sessionWarnings,
      });
    }
    const now = Date.now();
    for (const run of agentRuns) {
      if (!pending.has(run.agent.agentId)) {
        continue;
      }
      if (run.runtimePath && fs.existsSync(run.runtimePath)) {
        try {
          const runtimeRecord = readJsonOrNull(run.runtimePath);
          if (
            runtimeRecord &&
            typeof runtimeRecord === "object" &&
            ["completed", "failed", "terminated"].includes(
              String(runtimeRecord.terminalDisposition || ""),
            )
          ) {
            pending.delete(run.agent.agentId);
            continue;
          }
        } catch {
          // best-effort runtime observation only
        }
      }
      const deadline = timeoutAtByAgentId.get(run.agent.agentId) || startedAt + defaultTimeoutMs;
      if (now <= deadline) {
        continue;
      }
      timedOutAgentIds.add(run.agent.agentId);
      pending.delete(run.agent.agentId);
      const runtimeRecord =
        run.runtimePath && fs.existsSync(run.runtimePath) ? readJsonOrNull(run.runtimePath) : null;
      if (runtimeRecord) {
        await terminateAgentProcessRuntime(runtimeRecord);
      }
    }
    if (pending.size === 0) {
      break;
    }
    await sleep(DEFAULT_WAIT_PROGRESS_INTERVAL_MS);
  }

  const failures = [];
  for (const run of agentRuns) {
    const code = readStatusCodeIfPresent(run.statusPath);
    if (code === 0) {
      continue;
    }
    if (code === null || timedOutAgentIds.has(run.agent.agentId)) {
      let runtimeRecord = null;
      if (run.runtimePath && fs.existsSync(run.runtimePath)) {
        runtimeRecord = readJsonOrNull(run.runtimePath);
      }
      failures.push({
        agentId: run.agent.agentId,
        statusCode: timedOutAgentIds.has(run.agent.agentId)
          ? "timeout-no-status"
          : runtimeRecord?.terminalDisposition === "failed"
            ? "runtime-failed-before-status"
            : "missing-status",
        logPath: path.relative(REPO_ROOT, run.logPath),
        detail: runtimeRecord?.exitReason || null,
      });
      continue;
    }
    failures.push({
      agentId: run.agent.agentId,
      statusCode: String(code),
      logPath: path.relative(REPO_ROOT, run.logPath),
    });
  }
  onProgress?.({ pendingAgentIds: new Set(), timedOut: timedOutAgentIds.size > 0 });
  return { failures, timedOut: timedOutAgentIds.size > 0 };
}
