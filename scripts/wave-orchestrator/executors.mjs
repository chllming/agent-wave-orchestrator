import { spawnSync } from "node:child_process";
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
  tokens.push(flag, ...list.map((value) => shellQuote(value)));
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
) {
  return [
    command,
    "--ask-for-approval never",
    "exec",
    "--skip-git-repo-check",
    `--sandbox ${shellQuote(codexSandboxMode || DEFAULT_CODEX_SANDBOX_MODE)}`,
    "-",
    `< ${shellQuote(promptPath)}`,
    `2>&1 | tee -a ${shellQuote(logPath)}`,
  ].join(" ");
}

function buildClaudeLaunchSpec({ agent, promptPath, logPath, overlayDir }) {
  const executor = agent.executorResolved;
  const systemPromptPath = path.join(overlayDir, "claude-system-prompt.txt");
  writeTextAtomic(systemPromptPath, `${renderHarnessSystemPrompt(agent, "claude")}\n`);
  const tokens = [executor.claude.command, "-p", "--no-session-persistence"];
  appendSingleValueFlag(tokens, "--output-format", executor.claude.outputFormat || "text");
  appendSingleValueFlag(tokens, "--model", executor.claude.model || executor.model);
  appendSingleValueFlag(tokens, "--agent", executor.claude.agent);
  appendSingleValueFlag(tokens, "--permission-mode", executor.claude.permissionMode);
  appendSingleValueFlag(tokens, "--permission-prompt-tool", executor.claude.permissionPromptTool);
  appendSingleValueFlag(tokens, "--max-turns", executor.claude.maxTurns);
  appendRepeatedFlag(tokens, "--mcp-config", executor.claude.mcpConfig);
  appendSingleValueFlag(tokens, "--settings", executor.claude.settings);
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

function buildOpenCodeLaunchSpec({ agent, promptPath, logPath, overlayDir }) {
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
  const configPath = path.join(overlayDir, "opencode.json");
  writeTextAtomic(promptFilePath, `${renderHarnessSystemPrompt(agent, "opencode")}\n`);
  writeJsonAtomic(configPath, {
    $schema: "https://opencode.ai/config.json",
    instructions: executor.opencode.instructions || [],
    agent: {
      [agentName]: {
        description: `Wave agent ${agent.agentId}: ${agent.title}`,
        mode: "primary",
        prompt: `{file:./${promptFileName}}`,
        ...(executor.opencode.model || executor.model ? { model: executor.opencode.model || executor.model } : {}),
        ...(executor.opencode.steps ? { steps: executor.opencode.steps } : {}),
        ...(executor.opencode.permission ? { permission: executor.opencode.permission } : {}),
      },
    },
  });
  const tokens = [executor.opencode.command, "run", "--agent", shellQuote(agentName)];
  appendSingleValueFlag(tokens, "--model", executor.opencode.model || executor.model);
  appendSingleValueFlag(tokens, "--format", executor.opencode.format || "default");
  appendSingleValueFlag(tokens, "--attach", executor.opencode.attach);
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

function buildCodexLaunchSpec({ agent, promptPath, logPath }) {
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
      ),
    ],
  };
}

export function buildExecutorLaunchSpec({ agent, promptPath, logPath, overlayDir }) {
  const executorId = normalizeExecutorMode(agent?.executorResolved?.id || DEFAULT_EXECUTOR_MODE);
  ensureDirectory(overlayDir);
  if (executorId === "local") {
    return buildLocalLaunchSpec({ promptPath, logPath });
  }
  if (executorId === "claude") {
    return buildClaudeLaunchSpec({ agent, promptPath, logPath, overlayDir });
  }
  if (executorId === "opencode") {
    return buildOpenCodeLaunchSpec({ agent, promptPath, logPath, overlayDir });
  }
  return buildCodexLaunchSpec({ agent, promptPath, logPath });
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
