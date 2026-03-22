import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_ROOT } from "./roots.mjs";
import {
  emptySkillsConfig,
  mergeSkillsConfig,
  normalizeSkillsConfig,
} from "./skills.mjs";

const REPO_ROOT = WORKSPACE_ROOT;

export const DEFAULT_WAVE_CONFIG_PATH = path.join(REPO_ROOT, "wave.config.json");
export const DEFAULT_WAVE_LANE = "main";
export const DEFAULT_CONT_QA_AGENT_ID = "A0";
export const DEFAULT_CONT_EVAL_AGENT_ID = "E0";
export const DEFAULT_INTEGRATION_AGENT_ID = "A8";
export const DEFAULT_DOCUMENTATION_AGENT_ID = "A9";
export const DEFAULT_ROLE_PROMPT_DIR = "docs/agents";
export const DEFAULT_CONT_QA_ROLE_PROMPT_PATH = "docs/agents/wave-cont-qa-role.md";
export const DEFAULT_CONT_EVAL_ROLE_PROMPT_PATH = "docs/agents/wave-cont-eval-role.md";
export const DEFAULT_INTEGRATION_ROLE_PROMPT_PATH = "docs/agents/wave-integration-role.md";
export const DEFAULT_DOCUMENTATION_ROLE_PROMPT_PATH =
  "docs/agents/wave-documentation-role.md";
export const DEFAULT_SECURITY_ROLE_PROMPT_PATH = "docs/agents/wave-security-role.md";
export const DEFAULT_TERMINALS_PATH = ".vscode/terminals.json";
export const DEFAULT_DOCS_DIR = "docs";
export const DEFAULT_STATE_ROOT = ".tmp";
export const DEFAULT_ORCHESTRATOR_STATE_DIR = ".tmp/wave-orchestrator";
export const DEFAULT_CONTEXT7_BUNDLE_INDEX_PATH = "docs/context7/bundles.json";
export const DEFAULT_BENCHMARK_CATALOG_PATH = "docs/evals/benchmark-catalog.json";
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
const LEGACY_EVALUATOR_ROLE_KEYS = new Map([
  ["evaluatorAgentId", "contQaAgentId"],
  ["evaluatorRolePromptPath", "contQaRolePromptPath"],
]);

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
  if (value === undefined || value === null || value === "") {
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

function normalizeExecutorModeArray(value, label) {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  const list = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  return list.map((entry, index) => normalizeExecutorMode(entry, `${label}[${index}]`));
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

function normalizeExecutorBudget(rawBudget = {}, label = "budget") {
  const budget =
    rawBudget && typeof rawBudget === "object" && !Array.isArray(rawBudget) ? rawBudget : {};
  const turns = normalizeOptionalPositiveInt(budget.turns, `${label}.turns`, null);
  const minutes = normalizeOptionalPositiveInt(budget.minutes, `${label}.minutes`, null);
  if (turns === null && minutes === null) {
    return null;
  }
  return { turns, minutes };
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
  for (const [legacyKey, replacementKey] of LEGACY_EVALUATOR_ROLE_KEYS.entries()) {
    if (Object.prototype.hasOwnProperty.call(rawRoles, legacyKey)) {
      throw new Error(`roles.${legacyKey} was renamed to roles.${replacementKey}`);
    }
  }
  const rolePromptDir = normalizeRepoRelativePath(
    rawRoles.rolePromptDir || DEFAULT_ROLE_PROMPT_DIR,
    "roles.rolePromptDir",
  );
  return {
    rolePromptDir,
    contQaAgentId: String(rawRoles.contQaAgentId || DEFAULT_CONT_QA_AGENT_ID).trim(),
    contEvalAgentId: String(rawRoles.contEvalAgentId || DEFAULT_CONT_EVAL_AGENT_ID).trim(),
    integrationAgentId: String(rawRoles.integrationAgentId || DEFAULT_INTEGRATION_AGENT_ID).trim(),
    documentationAgentId: String(
      rawRoles.documentationAgentId || DEFAULT_DOCUMENTATION_AGENT_ID,
    ).trim(),
    contQaRolePromptPath: normalizeRepoRelativePath(
      rawRoles.contQaRolePromptPath || DEFAULT_CONT_QA_ROLE_PROMPT_PATH,
      "roles.contQaRolePromptPath",
    ),
    contEvalRolePromptPath: normalizeRepoRelativePath(
      rawRoles.contEvalRolePromptPath || DEFAULT_CONT_EVAL_ROLE_PROMPT_PATH,
      "roles.contEvalRolePromptPath",
    ),
    integrationRolePromptPath: normalizeRepoRelativePath(
      rawRoles.integrationRolePromptPath || DEFAULT_INTEGRATION_ROLE_PROMPT_PATH,
      "roles.integrationRolePromptPath",
    ),
    documentationRolePromptPath: normalizeRepoRelativePath(
      rawRoles.documentationRolePromptPath || DEFAULT_DOCUMENTATION_ROLE_PROMPT_PATH,
      "roles.documentationRolePromptPath",
    ),
    securityRolePromptPath: normalizeRepoRelativePath(
      rawRoles.securityRolePromptPath || DEFAULT_SECURITY_ROLE_PROMPT_PATH,
      "roles.securityRolePromptPath",
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
    requireIntegrationStewardFromWave: normalizeThreshold(
      rawValidation.requireIntegrationStewardFromWave,
      null,
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

function normalizeCapabilityRouting(rawCapabilityRouting = {}) {
  const preferredAgentsInput =
    rawCapabilityRouting && typeof rawCapabilityRouting === "object"
      ? rawCapabilityRouting.preferredAgents
      : null;
  const preferredAgents =
    preferredAgentsInput &&
    typeof preferredAgentsInput === "object" &&
    !Array.isArray(preferredAgentsInput)
      ? Object.fromEntries(
          Object.entries(preferredAgentsInput).map(([capability, agentIds]) => [
            String(capability || "")
              .trim()
              .toLowerCase(),
            normalizeOptionalStringArray(agentIds, []),
          ]),
        )
      : {};
  return {
    preferredAgents,
  };
}

function normalizeRuntimeMixTargets(rawRuntimeMixTargets = {}) {
  if (
    !rawRuntimeMixTargets ||
    typeof rawRuntimeMixTargets !== "object" ||
    Array.isArray(rawRuntimeMixTargets)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(rawRuntimeMixTargets).map(([executorId, rawCount]) => {
      const normalizedExecutor = normalizeExecutorMode(
        executorId,
        `runtimeMixTargets.${executorId}`,
      );
      const count = Number.parseInt(String(rawCount), 10);
      if (!Number.isFinite(count) || count < 0) {
        throw new Error(`runtimeMixTargets.${executorId} must be a non-negative integer`);
      }
      return [normalizedExecutor, count];
    }),
  );
}

function normalizeDefaultExecutorByRole(rawDefaultExecutorByRole = {}) {
  if (
    !rawDefaultExecutorByRole ||
    typeof rawDefaultExecutorByRole !== "object" ||
    Array.isArray(rawDefaultExecutorByRole)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(rawDefaultExecutorByRole).map(([role, executorId]) => {
      const normalizedRole = String(role || "")
        .trim()
        .toLowerCase();
      if (normalizedRole === "evaluator") {
        throw new Error("defaultExecutorByRole.evaluator was renamed to defaultExecutorByRole.cont-qa");
      }
      return [
        normalizedRole,
        normalizeExecutorMode(executorId, `defaultExecutorByRole.${role}`),
      ];
    }),
  );
}

function normalizeRuntimePolicy(rawRuntimePolicy = {}) {
  const runtimePolicy =
    rawRuntimePolicy && typeof rawRuntimePolicy === "object" && !Array.isArray(rawRuntimePolicy)
      ? rawRuntimePolicy
      : {};
  return {
    runtimeMixTargets: normalizeRuntimeMixTargets(runtimePolicy.runtimeMixTargets),
    defaultExecutorByRole: normalizeDefaultExecutorByRole(
      runtimePolicy.defaultExecutorByRole,
    ),
    fallbackExecutorOrder: normalizeExecutorModeArray(
      runtimePolicy.fallbackExecutorOrder,
      "runtimePolicy.fallbackExecutorOrder",
    ),
  };
}

function normalizeLaneSkills(rawSkills = {}, lane = "skills", options = {}) {
  return normalizeSkillsConfig(rawSkills, lane, options);
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

function normalizeExecutorProfile(rawProfile = {}, label = "executors.profiles.<profile>") {
  if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    id:
      rawProfile.id === undefined || rawProfile.id === null || rawProfile.id === ""
        ? null
        : normalizeExecutorMode(rawProfile.id, `${label}.id`),
    model: normalizeOptionalString(rawProfile.model, null),
    fallbacks: normalizeExecutorModeArray(rawProfile.fallbacks, `${label}.fallbacks`),
    tags: normalizeOptionalStringArray(rawProfile.tags, []),
    budget: normalizeExecutorBudget(rawProfile.budget, `${label}.budget`),
    codex: rawProfile.codex
      ? {
          command: normalizeOptionalString(rawProfile.codex.command, null),
          profileName: normalizeOptionalString(rawProfile.codex.profileName, null),
          config: normalizeOptionalStringOrStringArray(
            rawProfile.codex.config,
            `${label}.codex.config`,
          ),
          search:
            rawProfile.codex.search === undefined
              ? null
              : normalizeOptionalBoolean(rawProfile.codex.search, false),
          images: normalizeOptionalStringOrStringArray(
            rawProfile.codex.images,
            `${label}.codex.images`,
          ),
          addDirs: normalizeOptionalStringOrStringArray(
            rawProfile.codex.addDirs,
            `${label}.codex.addDirs`,
          ),
          json:
            rawProfile.codex.json === undefined
              ? null
              : normalizeOptionalBoolean(rawProfile.codex.json, false),
          ephemeral:
            rawProfile.codex.ephemeral === undefined
              ? null
              : normalizeOptionalBoolean(rawProfile.codex.ephemeral, false),
          sandbox:
            rawProfile.codex.sandbox === undefined ||
            rawProfile.codex.sandbox === null ||
            rawProfile.codex.sandbox === ""
              ? null
              : normalizeCodexSandboxMode(
                  rawProfile.codex.sandbox,
                  `${label}.codex.sandbox`,
                ),
        }
      : null,
    claude: rawProfile.claude
      ? {
          command: normalizeOptionalString(rawProfile.claude.command, null),
          agent: normalizeOptionalString(rawProfile.claude.agent, null),
          permissionMode: normalizeOptionalString(
            rawProfile.claude.permissionMode,
            null,
          ),
          permissionPromptTool: normalizeOptionalString(
            rawProfile.claude.permissionPromptTool,
            null,
          ),
          maxTurns: normalizeOptionalPositiveInt(
            rawProfile.claude.maxTurns,
            `${label}.claude.maxTurns`,
            null,
          ),
          mcpConfig: normalizeOptionalStringOrStringArray(
            rawProfile.claude.mcpConfig,
            `${label}.claude.mcpConfig`,
          ),
          strictMcpConfig:
            rawProfile.claude.strictMcpConfig === undefined
              ? null
              : normalizeOptionalBoolean(
                  rawProfile.claude.strictMcpConfig,
                  false,
                ),
          settings: normalizeOptionalString(rawProfile.claude.settings, null),
          settingsJson: normalizeOptionalJsonObject(
            rawProfile.claude.settingsJson,
            `${label}.claude.settingsJson`,
          ),
          hooksJson: normalizeOptionalJsonObject(
            rawProfile.claude.hooksJson,
            `${label}.claude.hooksJson`,
          ),
          allowedHttpHookUrls: normalizeOptionalStringOrStringArray(
            rawProfile.claude.allowedHttpHookUrls,
            `${label}.claude.allowedHttpHookUrls`,
          ),
          outputFormat:
            rawProfile.claude.outputFormat === undefined ||
            rawProfile.claude.outputFormat === null ||
            rawProfile.claude.outputFormat === ""
              ? null
              : normalizeClaudeOutputFormat(
                  rawProfile.claude.outputFormat,
                  `${label}.claude.outputFormat`,
                ),
          allowedTools: normalizeOptionalStringArray(rawProfile.claude.allowedTools, []),
          disallowedTools: normalizeOptionalStringArray(
            rawProfile.claude.disallowedTools,
            [],
          ),
        }
      : null,
    opencode: rawProfile.opencode
      ? {
          command: normalizeOptionalString(rawProfile.opencode.command, null),
          agent: normalizeOptionalString(rawProfile.opencode.agent, null),
          attach: normalizeOptionalString(rawProfile.opencode.attach, null),
          files: normalizeOptionalStringOrStringArray(
            rawProfile.opencode.files,
            `${label}.opencode.files`,
          ),
          format:
            rawProfile.opencode.format === undefined ||
            rawProfile.opencode.format === null ||
            rawProfile.opencode.format === ""
              ? null
              : normalizeOpenCodeFormat(
                  rawProfile.opencode.format,
                  `${label}.opencode.format`,
                ),
          steps: normalizeOptionalPositiveInt(
            rawProfile.opencode.steps,
            `${label}.opencode.steps`,
            null,
          ),
          instructions: normalizeOptionalStringArray(rawProfile.opencode.instructions, []),
          permission: normalizeOptionalJsonObject(
            rawProfile.opencode.permission,
            `${label}.opencode.permission`,
          ),
          configJson: normalizeOptionalJsonObject(
            rawProfile.opencode.configJson,
            `${label}.opencode.configJson`,
          ),
        }
      : null,
  };
}

function mergeExecutors(baseExecutors = {}, overrideExecutors = {}) {
  return {
    ...baseExecutors,
    ...overrideExecutors,
    profiles: {
      ...(baseExecutors.profiles || {}),
      ...(overrideExecutors.profiles || {}),
    },
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
    profiles:
      executors.profiles &&
      typeof executors.profiles === "object" &&
      !Array.isArray(executors.profiles)
        ? Object.fromEntries(
            Object.entries(executors.profiles).map(([profileName, profile]) => [
              String(profileName || "")
                .trim()
                .toLowerCase(),
              normalizeExecutorProfile(
                profile,
                `executors.profiles.${profileName}`,
              ),
            ]),
          )
        : {},
    codex: {
      command: normalizeOptionalString(
        executors.codex?.command,
        DEFAULT_CODEX_COMMAND,
      ),
      profileName: normalizeOptionalString(executors.codex?.profileName, null),
      config: normalizeOptionalStringOrStringArray(
        executors.codex?.config,
        "executors.codex.config",
      ),
      search: normalizeOptionalBoolean(executors.codex?.search, false),
      images: normalizeOptionalStringOrStringArray(
        executors.codex?.images,
        "executors.codex.images",
      ),
      addDirs: normalizeOptionalStringOrStringArray(
        executors.codex?.addDirs,
        "executors.codex.addDirs",
      ),
      json: normalizeOptionalBoolean(executors.codex?.json, false),
      ephemeral: normalizeOptionalBoolean(executors.codex?.ephemeral, false),
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
      settingsJson: normalizeOptionalJsonObject(
        executors.claude?.settingsJson,
        "executors.claude.settingsJson",
      ),
      hooksJson: normalizeOptionalJsonObject(
        executors.claude?.hooksJson,
        "executors.claude.hooksJson",
      ),
      allowedHttpHookUrls: normalizeOptionalStringOrStringArray(
        executors.claude?.allowedHttpHookUrls,
        "executors.claude.allowedHttpHookUrls",
      ),
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
      files: normalizeOptionalStringOrStringArray(
        executors.opencode?.files,
        "executors.opencode.files",
      ),
      format: normalizeOpenCodeFormat(executors.opencode?.format),
      steps: normalizeOptionalPositiveInt(executors.opencode?.steps, "executors.opencode.steps"),
      instructions: normalizeOptionalStringArray(executors.opencode?.instructions, []),
      permission: normalizeOptionalJsonObject(executors.opencode?.permission, "executors.opencode.permission"),
      configJson: normalizeOptionalJsonObject(
        executors.opencode?.configJson,
        "executors.opencode.configJson",
      ),
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
    benchmarkCatalogPath: normalizeRepoRelativePath(
      rawConfig.paths?.benchmarkCatalogPath || DEFAULT_BENCHMARK_CATALOG_PATH,
      "paths.benchmarkCatalogPath",
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
    skills: normalizeLaneSkills(rawConfig.skills, "skills"),
    capabilityRouting: normalizeCapabilityRouting(rawConfig.capabilityRouting),
    runtimePolicy: normalizeRuntimePolicy(rawConfig.runtimePolicy),
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
  const skills = mergeSkillsConfig(
    config.skills || emptySkillsConfig(),
    normalizeLaneSkills(laneConfig.skills, `${lane}.skills`, {
      preserveOmittedDir: true,
    }),
  );
  const capabilityRouting = normalizeCapabilityRouting({
    ...config.capabilityRouting,
    ...(laneConfig.capabilityRouting || {}),
  });
  const runtimePolicy = normalizeRuntimePolicy({
    ...config.runtimePolicy,
    ...(laneConfig.runtimePolicy || {}),
    ...(laneConfig.runtimeMixTargets ? { runtimeMixTargets: laneConfig.runtimeMixTargets } : {}),
    ...(laneConfig.defaultExecutorByRole
      ? { defaultExecutorByRole: laneConfig.defaultExecutorByRole }
      : {}),
    ...(laneConfig.fallbackExecutorOrder
      ? { fallbackExecutorOrder: laneConfig.fallbackExecutorOrder }
      : {}),
  });
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
    skills,
    capabilityRouting,
    runtimePolicy,
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
      benchmarkCatalogPath: normalizeRepoRelativePath(
        laneConfig.benchmarkCatalogPath || config.paths.benchmarkCatalogPath,
        `${lane}.benchmarkCatalogPath`,
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
