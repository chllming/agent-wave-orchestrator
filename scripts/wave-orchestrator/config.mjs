import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_WAVE_CONFIG_PATH = path.join(REPO_ROOT, "wave.config.json");
export const DEFAULT_WAVE_LANE = "main";
export const DEFAULT_EVALUATOR_AGENT_ID = "A0";
export const DEFAULT_DOCUMENTATION_AGENT_ID = "A9";
export const DEFAULT_ROLE_PROMPT_DIR = "docs/agents";
export const DEFAULT_EVALUATOR_ROLE_PROMPT_PATH = "docs/agents/wave-evaluator-role.md";
export const DEFAULT_DOCUMENTATION_ROLE_PROMPT_PATH =
  "docs/agents/wave-documentation-role.md";
export const DEFAULT_TERMINALS_PATH = ".vscode/terminals.json";
export const DEFAULT_DOCS_DIR = "docs";
export const DEFAULT_STATE_ROOT = ".tmp";
export const DEFAULT_ORCHESTRATOR_STATE_DIR = ".tmp/wave-orchestrator";
export const DEFAULT_CONTEXT7_BUNDLE_INDEX_PATH = "docs/context7/bundles.json";
export const DEFAULT_COMPONENT_CUTOVER_MATRIX_DOC_PATH = "docs/plans/component-cutover-matrix.md";
export const DEFAULT_COMPONENT_CUTOVER_MATRIX_JSON_PATH = "docs/plans/component-cutover-matrix.json";
export const DEFAULT_REQUIRED_PROMPT_REFERENCES = [
  "docs/reference/repository-guidance.md",
  "docs/research/agent-context-sources.md",
];
export const SUPPORTED_EXECUTOR_MODES = ["codex", "claude", "opencode", "local"];
export const DEFAULT_EXECUTOR_MODE = "codex";
export const DEFAULT_CODEX_COMMAND = "codex";
export const DEFAULT_CODEX_SANDBOX_MODE = "danger-full-access";
export const CODEX_SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"];
export const DEFAULT_CLAUDE_COMMAND = "claude";
export const DEFAULT_OPENCODE_COMMAND = "opencode";

export function normalizeExecutorMode(value, label = "executor") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!SUPPORTED_EXECUTOR_MODES.includes(normalized)) {
    throw new Error(
      `${label} must be one of: ${SUPPORTED_EXECUTOR_MODES.join(", ")} (got: ${normalized || "empty"})`,
    );
  }
  return normalized;
}

export function normalizeCodexSandboxMode(value, flagName = "--codex-sandbox") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!CODEX_SANDBOX_MODES.includes(normalized)) {
    throw new Error(
      `${flagName} must be one of: ${CODEX_SANDBOX_MODES.join(", ")} (got: ${normalized || "empty"})`,
    );
  }
  return normalized;
}

function sanitizeLaneName(value) {
  const lane = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!lane) {
    throw new Error("Lane name is required");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(lane)) {
    throw new Error(`Invalid lane: ${value}`);
  }
  return lane;
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeRepoRelativePath(value, label) {
  const raw = String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  if (!raw) {
    throw new Error(`${label} is required`);
  }
  if (raw.startsWith("/") || raw.startsWith("../") || raw.includes("/../")) {
    throw new Error(`${label} must stay within the repository: ${value}`);
  }
  return raw;
}

function normalizeOptionalPathArray(values, label) {
  if (!Array.isArray(values)) {
    return null;
  }
  return values.map((entry, index) =>
    normalizeRepoRelativePath(entry, `${label}[${index}]`),
  );
}

function normalizeOptionalStringArray(values, fallback = []) {
  if (!Array.isArray(values)) {
    return fallback;
  }
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function normalizeOptionalString(value, fallback = null) {
  const normalized = String(value ?? "")
    .trim();
  return normalized || fallback;
}

function normalizeOptionalPositiveInt(value, label, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

function normalizeOptionalBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function normalizeOptionalStringOrStringArray(value, label) {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => normalizeOptionalString(entry, null))
      .filter(Boolean)
      .map((entry, index) => {
        if (!entry) {
          throw new Error(`${label}[${index}] is required`);
        }
        return entry;
      });
  }
  const normalized = normalizeOptionalString(value, null);
  return normalized ? [normalized] : [];
}

function normalizeOptionalJsonObject(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return JSON.parse(JSON.stringify(value));
  }
  throw new Error(`${label} must be a JSON object`);
}

function normalizeThreshold(value, fallback) {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid wave threshold: ${value}`);
  }
  return parsed;
}

function defaultDocsDirForLane(lane, defaultLane, repoMode) {
  if (repoMode === "single-repo" && lane === defaultLane) {
    return DEFAULT_DOCS_DIR;
  }
  return `${DEFAULT_DOCS_DIR}/${lane}`;
}

function defaultPlansDir(docsDir) {
  return `${docsDir}/plans`;
}

function defaultWavesDir(plansDir) {
  return `${plansDir}/waves`;
}

function defaultComponentCutoverMatrixDocPath(plansDir) {
  return `${plansDir}/component-cutover-matrix.md`;
}

function defaultComponentCutoverMatrixJsonPath(plansDir) {
  return `${plansDir}/component-cutover-matrix.json`;
}

function defaultSharedPlanDocs(plansDir) {
  return ["current-state.md", "master-plan.md", "migration.md"].map(
    (fileName) => `${plansDir}/${fileName}`,
  );
}

function normalizeRoles(rawRoles = {}) {
  const rolePromptDir = normalizeRepoRelativePath(
    rawRoles.rolePromptDir || DEFAULT_ROLE_PROMPT_DIR,
    "roles.rolePromptDir",
  );
  return {
    rolePromptDir,
    evaluatorAgentId: String(rawRoles.evaluatorAgentId || DEFAULT_EVALUATOR_AGENT_ID).trim(),
    documentationAgentId: String(
      rawRoles.documentationAgentId || DEFAULT_DOCUMENTATION_AGENT_ID,
    ).trim(),
    evaluatorRolePromptPath: normalizeRepoRelativePath(
      rawRoles.evaluatorRolePromptPath || DEFAULT_EVALUATOR_ROLE_PROMPT_PATH,
      "roles.evaluatorRolePromptPath",
    ),
    documentationRolePromptPath: normalizeRepoRelativePath(
      rawRoles.documentationRolePromptPath || DEFAULT_DOCUMENTATION_ROLE_PROMPT_PATH,
      "roles.documentationRolePromptPath",
    ),
  };
}

function normalizeValidation(rawValidation = {}) {
  return {
    requiredPromptReferences: normalizeOptionalStringArray(
      rawValidation.requiredPromptReferences,
      DEFAULT_REQUIRED_PROMPT_REFERENCES,
    ),
    requireDocumentationStewardFromWave: normalizeThreshold(
      rawValidation.requireDocumentationStewardFromWave,
      0,
    ),
    requireContext7DeclarationsFromWave: normalizeThreshold(
      rawValidation.requireContext7DeclarationsFromWave,
      6,
    ),
    requireExitContractsFromWave: normalizeThreshold(
      rawValidation.requireExitContractsFromWave,
      6,
    ),
    requireComponentPromotionsFromWave: normalizeThreshold(
      rawValidation.requireComponentPromotionsFromWave,
      0,
    ),
    requireAgentComponentsFromWave: normalizeThreshold(
      rawValidation.requireAgentComponentsFromWave,
      0,
    ),
  };
}

function normalizeClaudePromptMode(value, label = "executors.claude.appendSystemPromptMode") {
  const normalized = String(value || "append")
    .trim()
    .toLowerCase();
  if (!["append", "replace"].includes(normalized)) {
    throw new Error(`${label} must be "append" or "replace"`);
  }
  return normalized;
}

function normalizeClaudeOutputFormat(value, label = "executors.claude.outputFormat") {
  const normalized = String(value || "text")
    .trim()
    .toLowerCase();
  if (!["text", "json", "stream-json"].includes(normalized)) {
    throw new Error(`${label} must be one of: text, json, stream-json`);
  }
  return normalized;
}

function normalizeOpenCodeFormat(value, label = "executors.opencode.format") {
  const normalized = String(value || "default")
    .trim()
    .toLowerCase();
  if (!["default", "json"].includes(normalized)) {
    throw new Error(`${label} must be one of: default, json`);
  }
  return normalized;
}

function mergeExecutors(baseExecutors = {}, overrideExecutors = {}) {
  return {
    ...baseExecutors,
    ...overrideExecutors,
    codex: {
      ...(baseExecutors.codex || {}),
      ...(overrideExecutors.codex || {}),
    },
    claude: {
      ...(baseExecutors.claude || {}),
      ...(overrideExecutors.claude || {}),
    },
    opencode: {
      ...(baseExecutors.opencode || {}),
      ...(overrideExecutors.opencode || {}),
    },
  };
}

function normalizeExecutors(rawExecutors = {}) {
  const executors = rawExecutors && typeof rawExecutors === "object" ? rawExecutors : {};
  return {
    default: normalizeExecutorMode(executors.default || DEFAULT_EXECUTOR_MODE, "executors.default"),
    codex: {
      command: normalizeOptionalString(
        executors.codex?.command,
        DEFAULT_CODEX_COMMAND,
      ),
      sandbox: normalizeCodexSandboxMode(
        executors.codex?.sandbox || DEFAULT_CODEX_SANDBOX_MODE,
        "executors.codex.sandbox",
      ),
    },
    claude: {
      command: normalizeOptionalString(
        executors.claude?.command,
        DEFAULT_CLAUDE_COMMAND,
      ),
      model: normalizeOptionalString(executors.claude?.model, null),
      agent: normalizeOptionalString(executors.claude?.agent, null),
      appendSystemPromptMode: normalizeClaudePromptMode(
        executors.claude?.appendSystemPromptMode,
      ),
      permissionMode: normalizeOptionalString(executors.claude?.permissionMode, null),
      permissionPromptTool: normalizeOptionalString(
        executors.claude?.permissionPromptTool,
        null,
      ),
      maxTurns: normalizeOptionalPositiveInt(executors.claude?.maxTurns, "executors.claude.maxTurns"),
      mcpConfig: normalizeOptionalStringOrStringArray(
        executors.claude?.mcpConfig,
        "executors.claude.mcpConfig",
      ),
      strictMcpConfig: normalizeOptionalBoolean(executors.claude?.strictMcpConfig, false),
      settings: normalizeOptionalString(executors.claude?.settings, null),
      outputFormat: normalizeClaudeOutputFormat(executors.claude?.outputFormat),
      allowedTools: normalizeOptionalStringArray(executors.claude?.allowedTools, []),
      disallowedTools: normalizeOptionalStringArray(executors.claude?.disallowedTools, []),
    },
    opencode: {
      command: normalizeOptionalString(
        executors.opencode?.command,
        DEFAULT_OPENCODE_COMMAND,
      ),
      model: normalizeOptionalString(executors.opencode?.model, null),
      agent: normalizeOptionalString(executors.opencode?.agent, null),
      attach: normalizeOptionalString(executors.opencode?.attach, null),
      format: normalizeOpenCodeFormat(executors.opencode?.format),
      steps: normalizeOptionalPositiveInt(executors.opencode?.steps, "executors.opencode.steps"),
      instructions: normalizeOptionalStringArray(executors.opencode?.instructions, []),
      permission: normalizeOptionalJsonObject(executors.opencode?.permission, "executors.opencode.permission"),
    },
  };
}

export function loadWaveConfig(configPath = DEFAULT_WAVE_CONFIG_PATH) {
  const rawConfig = readJsonOrNull(configPath) || {};
  const repoMode =
    String(rawConfig.repoMode || "single-repo")
      .trim()
      .toLowerCase() || "single-repo";
  if (!["single-repo", "multi-lane"].includes(repoMode)) {
    throw new Error(`Unsupported repoMode in ${path.relative(REPO_ROOT, configPath)}: ${repoMode}`);
  }
  const defaultLane = sanitizeLaneName(rawConfig.defaultLane || DEFAULT_WAVE_LANE);
  const paths = {
    docsDir: normalizeRepoRelativePath(rawConfig.paths?.docsDir || DEFAULT_DOCS_DIR, "paths.docsDir"),
    stateRoot: normalizeRepoRelativePath(
      rawConfig.paths?.stateRoot || DEFAULT_STATE_ROOT,
      "paths.stateRoot",
    ),
    orchestratorStateDir: normalizeRepoRelativePath(
      rawConfig.paths?.orchestratorStateDir || DEFAULT_ORCHESTRATOR_STATE_DIR,
      "paths.orchestratorStateDir",
    ),
    terminalsPath: normalizeRepoRelativePath(
      rawConfig.paths?.terminalsPath || DEFAULT_TERMINALS_PATH,
      "paths.terminalsPath",
    ),
    context7BundleIndexPath: normalizeRepoRelativePath(
      rawConfig.paths?.context7BundleIndexPath || DEFAULT_CONTEXT7_BUNDLE_INDEX_PATH,
      "paths.context7BundleIndexPath",
    ),
    componentCutoverMatrixDocPath: normalizeRepoRelativePath(
      rawConfig.paths?.componentCutoverMatrixDocPath ||
        defaultComponentCutoverMatrixDocPath(defaultPlansDir(rawConfig.paths?.docsDir || DEFAULT_DOCS_DIR)),
      "paths.componentCutoverMatrixDocPath",
    ),
    componentCutoverMatrixJsonPath: normalizeRepoRelativePath(
      rawConfig.paths?.componentCutoverMatrixJsonPath ||
        defaultComponentCutoverMatrixJsonPath(defaultPlansDir(rawConfig.paths?.docsDir || DEFAULT_DOCS_DIR)),
      "paths.componentCutoverMatrixJsonPath",
    ),
  };
  const sharedPlanDocs =
    normalizeOptionalPathArray(rawConfig.sharedPlanDocs, "sharedPlanDocs") || null;
  const lanes = Object.fromEntries(
    Object.entries(rawConfig.lanes || {}).map(([laneName, laneConfig]) => [
      sanitizeLaneName(laneName),
      laneConfig || {},
    ]),
  );
  return {
    version: Number.parseInt(String(rawConfig.version ?? "1"), 10) || 1,
    projectName: String(rawConfig.projectName || "Wave Orchestrator").trim(),
    repoMode,
    defaultLane,
    paths,
    roles: normalizeRoles(rawConfig.roles),
    validation: normalizeValidation(rawConfig.validation),
    executors: normalizeExecutors(rawConfig.executors),
    sharedPlanDocs,
    lanes,
    configPath,
  };
}

export function resolveLaneProfile(config, laneInput = config.defaultLane) {
  const lane = sanitizeLaneName(laneInput || config.defaultLane);
  const laneConfig = config.lanes[lane] || {};
  const docsDir = normalizeRepoRelativePath(
    laneConfig.docsDir || defaultDocsDirForLane(lane, config.defaultLane, config.repoMode),
    `${lane}.docsDir`,
  );
  const plansDir = normalizeRepoRelativePath(
    laneConfig.plansDir || defaultPlansDir(docsDir),
    `${lane}.plansDir`,
  );
  const wavesDir = normalizeRepoRelativePath(
    laneConfig.wavesDir || defaultWavesDir(plansDir),
    `${lane}.wavesDir`,
  );
  const roles = normalizeRoles({
    ...config.roles,
    ...(laneConfig.roles || {}),
  });
  const validation = normalizeValidation({
    ...config.validation,
    ...(laneConfig.validation || {}),
  });
  const executors = normalizeExecutors(
    mergeExecutors(config.executors, laneConfig.executors),
  );
  return {
    lane,
    docsDir,
    plansDir,
    wavesDir,
    sharedPlanDocs:
      normalizeOptionalPathArray(laneConfig.sharedPlanDocs, `${lane}.sharedPlanDocs`) ||
      config.sharedPlanDocs ||
      defaultSharedPlanDocs(plansDir),
    roles,
    validation,
    executors,
    paths: {
      terminalsPath: normalizeRepoRelativePath(
        laneConfig.terminalsPath || config.paths.terminalsPath,
        `${lane}.terminalsPath`,
      ),
      stateRoot: normalizeRepoRelativePath(
        laneConfig.stateRoot || config.paths.stateRoot,
        `${lane}.stateRoot`,
      ),
      orchestratorStateDir: normalizeRepoRelativePath(
        laneConfig.orchestratorStateDir || config.paths.orchestratorStateDir,
        `${lane}.orchestratorStateDir`,
      ),
      context7BundleIndexPath: normalizeRepoRelativePath(
        laneConfig.context7BundleIndexPath || config.paths.context7BundleIndexPath,
        `${lane}.context7BundleIndexPath`,
      ),
      componentCutoverMatrixDocPath: normalizeRepoRelativePath(
        laneConfig.componentCutoverMatrixDocPath ||
          config.paths.componentCutoverMatrixDocPath ||
          defaultComponentCutoverMatrixDocPath(plansDir),
        `${lane}.componentCutoverMatrixDocPath`,
      ),
      componentCutoverMatrixJsonPath: normalizeRepoRelativePath(
        laneConfig.componentCutoverMatrixJsonPath ||
          config.paths.componentCutoverMatrixJsonPath ||
          defaultComponentCutoverMatrixJsonPath(plansDir),
        `${lane}.componentCutoverMatrixJsonPath`,
      ),
    },
  };
}
