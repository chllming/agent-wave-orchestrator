import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CODEX_COMMAND,
  DEFAULT_CODEX_SANDBOX_MODE,
  DEFAULT_EXECUTOR_MODE,
  normalizeExecutorMode,
} from "./config.mjs";
import {
  PACKAGE_ROOT,
  REPO_ROOT,
  ensureDirectory,
  shellQuote,
  writeJsonAtomic,
  writeTextAtomic,
} from "./shared.mjs";

function appendSingleValueFlag(tokens, flag, value) {
  if (value === null || value === undefined || value === "") {
    return;
  }
  tokens.push(flag, shellQuote(value));
}

function appendRepeatedFlag(tokens, flag, values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (list.length === 0) {
    return;
  }
  for (const value of list) {
    tokens.push(flag, shellQuote(value));
  }
}

function appendBooleanFlag(tokens, flag, enabled) {
  if (!enabled) {
    return;
  }
  tokens.push(flag);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeJsonObjects(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!isPlainObject(source)) {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (isPlainObject(value) && isPlainObject(merged[key])) {
        merged[key] = mergeJsonObjects(merged[key], value);
      } else {
        merged[key] = cloneJson(value);
      }
    }
  }
  return merged;
}

function mergeUniqueStringArrays(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      const normalized = String(value || "").trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
    }
  }
  return merged;
}

function resolveRepoFilePath(filePath) {
  if (!filePath) {
    return null;
  }
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function readJsonObjectFile(filePath, label) {
  const absolutePath = resolveRepoFilePath(filePath);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label} JSON at ${filePath}: ${error.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${label} must be a JSON object: ${filePath}`);
  }
  return parsed;
}

function buildClaudeSettingsPath(executor, overlayDir) {
  const inlineSettings = executor.claude.settingsJson || null;
  const inlineHooks = executor.claude.hooksJson || null;
  const inlineAllowedHttpHookUrls = Array.isArray(executor.claude.allowedHttpHookUrls)
    ? executor.claude.allowedHttpHookUrls.filter(Boolean)
    : [];
  const hasInlineOverlay =
    Boolean(inlineSettings) ||
    Boolean(inlineHooks) ||
    inlineAllowedHttpHookUrls.length > 0;
  if (!hasInlineOverlay) {
    return executor.claude.settings || null;
  }
  const baseSettings = executor.claude.settings
    ? readJsonObjectFile(executor.claude.settings, "Claude settings")
    : {};
  const merged = mergeJsonObjects(
    baseSettings,
    inlineSettings,
    inlineHooks ? { hooks: inlineHooks } : null,
    inlineAllowedHttpHookUrls.length > 0
      ? { allowedHttpHookUrls: inlineAllowedHttpHookUrls }
      : null,
  );
  const settingsPath = path.join(overlayDir, "claude-settings.json");
  writeJsonAtomic(settingsPath, merged);
  return settingsPath;
}

function buildOpenCodeConfig({ agent, executor, agentName, promptFileName, overlayDir, skillProjection }) {
  const promptAgent = {
    description: `Wave agent ${agent.agentId}: ${agent.title}`,
    mode: "primary",
    prompt: `{file:./${promptFileName}}`,
    ...(executor.opencode.model || executor.model
      ? { model: executor.opencode.model || executor.model }
      : {}),
    ...(executor.opencode.steps ? { steps: executor.opencode.steps } : {}),
    ...(executor.opencode.permission ? { permission: executor.opencode.permission } : {}),
  };
  const baseConfig = isPlainObject(executor.opencode.configJson) ? executor.opencode.configJson : {};
  const baseAgentConfig = isPlainObject(baseConfig.agent) ? baseConfig.agent : {};
  const config = mergeJsonObjects(baseConfig, {
    $schema: baseConfig.$schema || "https://opencode.ai/config.json",
    instructions: mergeUniqueStringArrays(
      baseConfig.instructions,
      executor.opencode.instructions,
      skillProjection?.opencodeInstructions,
    ),
    agent: {
      ...baseAgentConfig,
      [agentName]: mergeJsonObjects(baseAgentConfig[agentName], promptAgent),
    },
  });
  const configPath = path.join(overlayDir, "opencode.json");
  writeJsonAtomic(configPath, config);
  return configPath;
}

function renderHarnessSystemPrompt(agent, executorId) {
  return [
    "You are running inside the Wave orchestration harness.",
    `Resolved executor: ${executorId}.`,
    `Assigned wave agent: ${agent.agentId} (${agent.title}).`,
    "Treat the incoming task prompt as the authoritative assignment.",
    "Preserve structured Wave markers exactly when they are required by the task.",
    "Do not omit or rewrite message-board requirements, exit-contract requirements, or ownership boundaries.",
    "Prefer plain text output unless the task explicitly requires code blocks.",
  ].join("\n");
}

export function buildCodexExecInvocation(
  promptPath,
  logPath,
  codexSandboxMode,
  command = DEFAULT_CODEX_COMMAND,
  options = {},
) {
  const tokens = [
    command,
    "--ask-for-approval never",
    "exec",
    "--skip-git-repo-check",
    `--sandbox ${shellQuote(codexSandboxMode || DEFAULT_CODEX_SANDBOX_MODE)}`,
  ];
  appendSingleValueFlag(tokens, "--model", options.model);
  appendSingleValueFlag(tokens, "--profile", options.profileName);
  appendRepeatedFlag(tokens, "-c", options.config);
  appendBooleanFlag(tokens, "--search", options.search);
  appendRepeatedFlag(tokens, "--image", options.images);
  appendRepeatedFlag(tokens, "--add-dir", options.addDirs);
  appendBooleanFlag(tokens, "--json", options.json);
  appendBooleanFlag(tokens, "--ephemeral", options.ephemeral);
  tokens.push("-", `< ${shellQuote(promptPath)}`, `2>&1 | tee -a ${shellQuote(logPath)}`);
  return tokens.join(" ");
}

function buildClaudeLaunchSpec({ agent, promptPath, logPath, overlayDir }) {
  const executor = agent.executorResolved;
  const systemPromptPath = path.join(overlayDir, "claude-system-prompt.txt");
  const skillText = String(agent?.skillsResolved?.promptText || "").trim();
  writeTextAtomic(
    systemPromptPath,
    `${renderHarnessSystemPrompt(agent, "claude")}${skillText ? `\n\n${skillText}` : ""}\n`,
  );
  const tokens = [executor.claude.command, "-p", "--no-session-persistence"];
  const settingsPath = buildClaudeSettingsPath(executor, overlayDir);
  appendSingleValueFlag(tokens, "--output-format", executor.claude.outputFormat || "text");
  appendSingleValueFlag(tokens, "--model", executor.claude.model || executor.model);
  appendSingleValueFlag(tokens, "--agent", executor.claude.agent);
  appendSingleValueFlag(tokens, "--permission-mode", executor.claude.permissionMode);
  appendSingleValueFlag(tokens, "--permission-prompt-tool", executor.claude.permissionPromptTool);
  appendSingleValueFlag(tokens, "--effort", executor.claude.effort);
  appendSingleValueFlag(tokens, "--max-turns", executor.claude.maxTurns);
  appendRepeatedFlag(tokens, "--mcp-config", executor.claude.mcpConfig);
  appendSingleValueFlag(tokens, "--settings", settingsPath);
  appendRepeatedFlag(tokens, "--allowedTools", executor.claude.allowedTools);
  appendRepeatedFlag(tokens, "--disallowedTools", executor.claude.disallowedTools);
  if (executor.claude.strictMcpConfig) {
    tokens.push("--strict-mcp-config");
  }
  tokens.push(
    executor.claude.appendSystemPromptMode === "replace"
      ? "--system-prompt-file"
      : "--append-system-prompt-file",
    shellQuote(systemPromptPath),
  );
  return {
    executorId: "claude",
    command: executor.claude.command,
    useRateLimitRetries: true,
    invocationLines: [
      `task_prompt=$(cat ${shellQuote(promptPath)})`,
      `${tokens.join(" ")} "$task_prompt" 2>&1 | tee -a ${shellQuote(logPath)}`,
    ],
  };
}

function buildOpenCodeLaunchSpec({ agent, promptPath, logPath, overlayDir, skillProjection }) {
  const executor = agent.executorResolved;
  const requestedAgentName = String(executor.opencode.agent || `wave-${agent.agentId}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const agentName = requestedAgentName || `wave-${agent.agentId.toLowerCase()}`;
  const promptFileName = "opencode-agent-prompt.txt";
  const promptFilePath = path.join(overlayDir, promptFileName);
  writeTextAtomic(promptFilePath, `${renderHarnessSystemPrompt(agent, "opencode")}\n`);
  const configPath = buildOpenCodeConfig({
    agent,
    executor,
    agentName,
    promptFileName,
    overlayDir,
    skillProjection,
  });
  const tokens = [executor.opencode.command, "run", "--agent", shellQuote(agentName)];
  appendSingleValueFlag(tokens, "--model", executor.opencode.model || executor.model);
  appendSingleValueFlag(tokens, "--format", executor.opencode.format || "default");
  appendSingleValueFlag(tokens, "--attach", executor.opencode.attach);
  appendRepeatedFlag(
    tokens,
    "--file",
    mergeUniqueStringArrays(executor.opencode.files, skillProjection?.opencodeFiles),
  );
  appendSingleValueFlag(tokens, "--title", `wave-${agent.agentId}`);
  return {
    executorId: "opencode",
    command: executor.opencode.command,
    useRateLimitRetries: true,
    env: {
      OPENCODE_CONFIG: configPath,
    },
    invocationLines: [
      `task_prompt=$(cat ${shellQuote(promptPath)})`,
      `${tokens.join(" ")} "$task_prompt" 2>&1 | tee -a ${shellQuote(logPath)}`,
    ],
  };
}

function buildLocalLaunchSpec({ promptPath, logPath }) {
  return {
    executorId: "local",
    command: "node",
    useRateLimitRetries: false,
    invocationLines: [
      `node ${shellQuote(path.join(PACKAGE_ROOT, "scripts", "wave-local-executor.mjs"))} --prompt-file ${shellQuote(
        promptPath,
      )} 2>&1 | tee ${shellQuote(logPath)}`,
    ],
  };
}

function buildLaunchLimitsMetadata(agent) {
  const executor = agent?.executorResolved || {};
  const executorId = normalizeExecutorMode(executor.id || DEFAULT_EXECUTOR_MODE);
  const attemptTimeoutMinutes = executor?.budget?.minutes ?? null;
  if (executorId === "claude") {
    const source = executor?.claude?.maxTurnsSource || null;
    return {
      attemptTimeoutMinutes,
      knownTurnLimit: executor?.claude?.maxTurns ?? null,
      turnLimitSource: source,
      notes:
        source === "budget.turns"
          ? ["Known turn limit was derived from generic budget.turns."]
          : [],
    };
  }
  if (executorId === "opencode") {
    const source = executor?.opencode?.stepsSource || null;
    return {
      attemptTimeoutMinutes,
      knownTurnLimit: executor?.opencode?.steps ?? null,
      turnLimitSource: source,
      notes:
        source === "budget.turns"
          ? ["Known turn limit was derived from generic budget.turns."]
          : [],
    };
  }
  if (executorId === "codex") {
    const profileNote = executor?.codex?.profileName
      ? ` via Codex profile ${executor.codex.profileName}`
      : "";
    return {
      attemptTimeoutMinutes,
      knownTurnLimit: null,
      turnLimitSource: "not-set-by-wave",
      notes: [
        `Wave emits no Codex turn-limit flag; any effective ceiling may come from the selected Codex profile${profileNote} or the upstream Codex runtime.`,
      ],
    };
  }
  return {
    attemptTimeoutMinutes,
    knownTurnLimit: null,
    turnLimitSource: "not-applicable",
    notes: ["Local executor does not use model turn limits."],
  };
}

function buildCodexLaunchSpec({ agent, promptPath, logPath, skillProjection }) {
  const executor = agent.executorResolved;
  return {
    executorId: "codex",
    command: executor.codex.command,
    useRateLimitRetries: true,
    invocationLines: [
      buildCodexExecInvocation(
        promptPath,
        logPath,
        executor.codex.sandbox,
        executor.codex.command,
        {
          model: executor.model,
          profileName: executor.codex.profileName,
          config: executor.codex.config,
          search: executor.codex.search,
          images: executor.codex.images,
          addDirs: mergeUniqueStringArrays(executor.codex.addDirs, skillProjection?.codexAddDirs),
          json: executor.codex.json,
          ephemeral: executor.codex.ephemeral,
        },
      ),
    ],
  };
}

export function buildExecutorLaunchSpec({ agent, promptPath, logPath, overlayDir, skillProjection }) {
  const executorId = normalizeExecutorMode(agent?.executorResolved?.id || DEFAULT_EXECUTOR_MODE);
  ensureDirectory(overlayDir);
  const limits = buildLaunchLimitsMetadata(agent);
  if (executorId === "local") {
    return {
      ...buildLocalLaunchSpec({ promptPath, logPath }),
      limits,
    };
  }
  if (executorId === "claude") {
    return {
      ...buildClaudeLaunchSpec({ agent, promptPath, logPath, overlayDir, skillProjection }),
      limits,
    };
  }
  if (executorId === "opencode") {
    return {
      ...buildOpenCodeLaunchSpec({ agent, promptPath, logPath, overlayDir, skillProjection }),
      limits,
    };
  }
  return {
    ...buildCodexLaunchSpec({ agent, promptPath, logPath, skillProjection }),
    limits,
  };
}

export function commandForExecutor(executor, executorId = executor?.id) {
  if (executorId === "codex") {
    return executor?.codex?.command || DEFAULT_CODEX_COMMAND;
  }
  if (executorId === "claude") {
    return executor?.claude?.command || "claude";
  }
  if (executorId === "opencode") {
    return executor?.opencode?.command || "opencode";
  }
  return "node";
}

export function isExecutorCommandAvailable(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(command)}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  return result.status === 0;
}

export function preflightExecutorCommand(command, executorId) {
  if (isExecutorCommandAvailable(command)) {
    return;
  }
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(command)}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  const detail = (result.stderr || result.stdout || "").trim();
  throw new Error(
    `Executor "${executorId}" requires "${command}" on PATH${detail ? ` (${detail})` : ""}`,
  );
}

export function preflightExecutorsForWaves(waves) {
  const seen = new Map();
  for (const wave of waves) {
    for (const agent of wave.agents) {
      const executor = agent.executorResolved;
      if (!executor) {
        continue;
      }
      const command = commandForExecutor(executor, executor.id);
      const key = `${executor.id}:${command}`;
      if (seen.has(key)) {
        continue;
      }
      seen.set(key, true);
      preflightExecutorCommand(command, executor.id);
    }
  }
}
