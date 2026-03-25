import fs from "node:fs";
import path from "node:path";
import { buildExecutionPrompt } from "./coordination.mjs";
import {
  DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS,
  DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS,
  DEFAULT_WAIT_PROGRESS_INTERVAL_MS,
  REPO_ROOT,
  ensureDirectory,
  shellQuote,
  writeJsonAtomic,
} from "./shared.mjs";
import { readStatusCodeIfPresent } from "./dashboard-state.mjs";
import { buildExecutorLaunchSpec } from "./executors.mjs";
import { hashAgentPromptFingerprint, prefetchContext7ForSelection } from "./context7.mjs";
import { killTmuxSessionIfExists } from "./terminals.mjs";
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

export function refreshResolvedSkillsForRun(runInfo, waveDefinition, lanePaths) {
  runInfo.agent.skillsResolved = resolveAgentSkills(
    runInfo.agent,
    waveDefinition || { deployEnvironments: [] },
    { laneProfile: lanePaths.laneProfile },
  );
  return runInfo.agent.skillsResolved;
}

export function collectUnexpectedSessionFailures(
  lanePaths,
  agentRuns,
  pendingAgentIds,
  { listLaneTmuxSessionNamesFn },
) {
  const activeSessionNames = new Set(listLaneTmuxSessionNamesFn(lanePaths));
  const failures = [];
  for (const run of agentRuns) {
    if (!pendingAgentIds.has(run.agent.agentId) || fs.existsSync(run.statusPath)) {
      continue;
    }
    if (activeSessionNames.has(run.sessionName)) {
      continue;
    }
    failures.push({
      agentId: run.agent.agentId,
      statusCode: "session-missing",
      logPath: path.relative(REPO_ROOT, run.logPath),
      detail: `tmux session ${run.sessionName} disappeared before ${path.relative(REPO_ROOT, run.statusPath)} was written.`,
    });
  }
  return failures;
}

export async function launchAgentSession(lanePaths, params, { runTmuxFn }) {
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
  } = params;
  ensureDirectory(path.dirname(promptPath));
  ensureDirectory(path.dirname(logPath));
  ensureDirectory(path.dirname(statusPath));
  fs.rmSync(statusPath, { force: true });

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
  killTmuxSessionIfExists(lanePaths.tmuxSocketName, sessionName);

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
      `  if tail -n 120 ${shellQuote(logPath)} | grep -Eqi '429 Too Many Requests|exceeded retry limit|last status: 429|rate limit'; then`,
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
    `node -e ${shellQuote(
      "const fs=require('node:fs'); const statusPath=process.argv[1]; const payload={code:Number(process.argv[2]),promptHash:process.argv[3]||null,orchestratorId:process.argv[4]||null,attempt:Number(process.argv[5])||1,completedAt:new Date().toISOString()}; fs.writeFileSync(statusPath, JSON.stringify(payload, null, 2)+'\\n', 'utf8');",
    )} ${shellQuote(statusPath)} "$status" ${shellQuote(promptHash)} ${shellQuote(orchestratorId || "")} ${shellQuote(String(attempt || 1))}`,
    `echo "[${lanePaths.lane}-wave-launcher] ${sessionName} finished with code $status"`,
    "exec bash -l",
  ].join("\n");

  runTmuxFn(
    lanePaths,
    ["new-session", "-d", "-s", sessionName, `bash -lc ${shellQuote(command)}`],
    `launch session ${sessionName}`,
  );
  return {
    promptHash,
    context7,
    executorId: resolvedExecutorMode,
    skills: summarizeResolvedSkills(agent.skillsResolved),
  };
}

export async function waitForWaveCompletion(
  lanePaths,
  agentRuns,
  timeoutMinutes,
  onProgress = null,
  { collectUnexpectedSessionFailuresFn },
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
  let sessionFailures = [];

  const refreshPending = () => {
    for (const run of agentRuns) {
      if (pending.has(run.agent.agentId) && fs.existsSync(run.statusPath)) {
        pending.delete(run.agent.agentId);
      }
    }
  };

  await new Promise((resolve) => {
    const interval = setInterval(() => {
      refreshPending();
      onProgress?.({ pendingAgentIds: new Set(pending), timedOut: false });
      if (pending.size === 0) {
        clearInterval(interval);
        resolve();
        return;
      }
      sessionFailures = collectUnexpectedSessionFailuresFn(lanePaths, agentRuns, pending);
      if (sessionFailures.length > 0) {
        onProgress?.({
          pendingAgentIds: new Set(pending),
          timedOut: false,
          failures: sessionFailures,
        });
        clearInterval(interval);
        resolve();
        return;
      }
      const now = Date.now();
      for (const run of agentRuns) {
        if (!pending.has(run.agent.agentId)) {
          continue;
        }
        const deadline = timeoutAtByAgentId.get(run.agent.agentId) || startedAt + defaultTimeoutMs;
        if (now <= deadline) {
          continue;
        }
        timedOutAgentIds.add(run.agent.agentId);
        pending.delete(run.agent.agentId);
        killTmuxSessionIfExists(lanePaths.tmuxSocketName, run.sessionName);
      }
      if (pending.size === 0) {
        clearInterval(interval);
        resolve();
      }
    }, DEFAULT_WAIT_PROGRESS_INTERVAL_MS);
    refreshPending();
    onProgress?.({ pendingAgentIds: new Set(pending), timedOut: false });
  });

  if (sessionFailures.length > 0) {
    onProgress?.({ pendingAgentIds: new Set(), timedOut: false, failures: sessionFailures });
    return { failures: sessionFailures, timedOut: false };
  }

  const failures = [];
  for (const run of agentRuns) {
    const code = readStatusCodeIfPresent(run.statusPath);
    if (code === 0) {
      continue;
    }
    if (code === null || timedOutAgentIds.has(run.agent.agentId)) {
      failures.push({
        agentId: run.agent.agentId,
        statusCode: timedOutAgentIds.has(run.agent.agentId) ? "timeout-no-status" : "missing-status",
        logPath: path.relative(REPO_ROOT, run.logPath),
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
