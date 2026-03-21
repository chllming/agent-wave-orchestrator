import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CODEX_SANDBOX_MODE,
  DEFAULT_DOCUMENTATION_AGENT_ID,
  DEFAULT_DOCUMENTATION_ROLE_PROMPT_PATH,
  DEFAULT_EVALUATOR_AGENT_ID,
  DEFAULT_EVALUATOR_ROLE_PROMPT_PATH,
  DEFAULT_WAVE_LANE,
  loadWaveConfig,
  normalizeCodexSandboxMode,
  normalizeExecutorMode,
  resolveLaneProfile,
} from "./config.mjs";
import {
  REPO_ROOT,
  ensureDirectory,
  hashText,
  parseVerdictFromText,
  readJsonOrNull,
  readFileTail,
  readStatusRecordIfPresent,
  REPORT_VERDICT_REGEX,
  WAVE_VERDICT_REGEX,
  walkFiles,
  writeJsonAtomic,
} from "./shared.mjs";
import { normalizeContext7Config, hashAgentPromptFingerprint } from "./context7.mjs";
import {
  normalizeExitContract,
  readAgentExecutionSummary,
  validateDocumentationClosureSummary,
  validateEvaluatorSummary,
  validateExitContractShape,
  validateImplementationSummary,
} from "./agent-state.mjs";

export const WAVE_EVALUATOR_ROLE_PROMPT_PATH = DEFAULT_EVALUATOR_ROLE_PROMPT_PATH;
export const WAVE_DOCUMENTATION_ROLE_PROMPT_PATH = DEFAULT_DOCUMENTATION_ROLE_PROMPT_PATH;
export const SHARED_PLAN_DOC_PATHS = [
  "docs/plans/current-state.md",
  "docs/plans/master-plan.md",
  "docs/plans/migration.md",
];

function resolveLaneProfileForOptions(options = {}) {
  if (options.laneProfile) {
    return options.laneProfile;
  }
  const config = options.config || loadWaveConfig();
  return resolveLaneProfile(config, options.lane || config.defaultLane || DEFAULT_WAVE_LANE);
}

export function waveNumberFromFileName(fileName) {
  const match = fileName.match(/^wave-(\d+)\.md$/);
  if (!match) {
    throw new Error(`Invalid wave filename: ${fileName}`);
  }
  return Number.parseInt(match[1], 10);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAllowedRolePromptPath(relPath, rolePromptDir) {
  const allowedDir = String(rolePromptDir || "docs/agents")
    .replaceAll("\\", "/")
    .replace(/\/+$/, "");
  return (
    isRepoContainedPath(relPath) &&
    relPath.replaceAll("\\", "/").startsWith(`${allowedDir}/`) &&
    /\.md$/i.test(relPath)
  );
}

function extractSectionBody(sectionText, heading, filePath, agentId, options = {}) {
  const headingMatch = sectionText.match(new RegExp(`### ${escapeRegExp(heading)}[\\r\\n]+`));
  if (!headingMatch) {
    if (options.required === false) {
      return null;
    }
    throw new Error(`Missing "### ${heading}" section for agent ${agentId} in ${filePath}`);
  }
  const afterHeading = sectionText.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = /^###\s+/m.exec(afterHeading);
  return (nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading).trim();
}

function extractTopLevelSectionBody(content, heading, filePath, options = {}) {
  const headingMatch = content.match(new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "m"));
  if (!headingMatch) {
    if (options.required === false) {
      return null;
    }
    throw new Error(`Missing "## ${heading}" section in ${filePath}`);
  }
  const afterHeading = content.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = /^##\s+/m.exec(afterHeading);
  return (nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading).trim();
}

function extractFencedBlock(blockText, messagePrefix) {
  const fencedBlockMatch = String(blockText || "").match(
    /```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```/,
  );
  if (!fencedBlockMatch) {
    throw new Error(`${messagePrefix}: missing fenced prompt block`);
  }
  return fencedBlockMatch[1].trim();
}

export function extractPromptFromSection(sectionText, filePath, agentId) {
  const promptBlock = extractSectionBody(sectionText, "Prompt", filePath, agentId);
  return extractFencedBlock(promptBlock, `Agent ${agentId} in ${filePath}`);
}

function parseContext7Settings(blockText, filePath, label) {
  if (!blockText) {
    return null;
  }
  const settings = {};
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+([a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (!bulletMatch) {
      throw new Error(`Malformed Context7 setting "${trimmed}" in ${label} (${filePath})`);
    }
    settings[bulletMatch[1]] = bulletMatch[2];
  }
  return normalizeContext7Config(settings);
}

export function extractContext7ConfigFromSection(sectionText, filePath, agentId) {
  const context7Block = extractSectionBody(sectionText, "Context7", filePath, agentId, {
    required: false,
  });
  return parseContext7Settings(context7Block, filePath, `agent ${agentId}`);
}

function parseExitContractSettings(blockText, filePath, label) {
  if (!blockText) {
    return null;
  }
  const settings = {};
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+([a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (!bulletMatch) {
      throw new Error(`Malformed Exit contract setting "${trimmed}" in ${label} (${filePath})`);
    }
    settings[bulletMatch[1]] = bulletMatch[2];
  }
  return normalizeExitContract(settings);
}

function parsePositiveExecutorInt(value, label, filePath) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label} "${value}" in ${filePath}`);
  }
  return parsed;
}

function cleanExecutorValue(value) {
  return String(value || "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "");
}

function parseExecutorSettings(blockText, filePath, label) {
  if (!blockText) {
    return null;
  }
  const settings = {};
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+([a-zA-Z0-9._-]+)\s*:\s*(.+?)\s*$/);
    if (!bulletMatch) {
      throw new Error(`Malformed Executor setting "${trimmed}" in ${label} (${filePath})`);
    }
    settings[bulletMatch[1]] = cleanExecutorValue(bulletMatch[2]);
  }
  return settings;
}

export function normalizeAgentExecutorConfig(rawSettings, filePath, label) {
  if (!rawSettings || typeof rawSettings !== "object") {
    return null;
  }
  const executorConfig = {
    id: null,
    model: null,
    codex: null,
    claude: null,
    opencode: null,
  };
  const allowedKeys = new Set([
    "id",
    "model",
    "codex.sandbox",
    "claude.agent",
    "claude.permission_mode",
    "claude.max_turns",
    "claude.mcp_config",
    "opencode.agent",
    "opencode.attach",
    "opencode.format",
    "opencode.steps",
  ]);
  for (const [key, rawValue] of Object.entries(rawSettings)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported Executor setting "${key}" in ${label} (${filePath})`);
    }
    const value = cleanExecutorValue(rawValue);
    if (!value) {
      throw new Error(`Empty Executor setting "${key}" in ${label} (${filePath})`);
    }
    if (key === "id") {
      executorConfig.id = normalizeExecutorMode(value, `${label}.id`);
    } else if (key === "model") {
      executorConfig.model = value;
    } else if (key === "codex.sandbox") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        sandbox: normalizeCodexSandboxMode(value, `${label}.codex.sandbox`),
      };
    } else if (key === "claude.agent") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        agent: value,
      };
    } else if (key === "claude.permission_mode") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        permissionMode: value,
      };
    } else if (key === "claude.max_turns") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        maxTurns: parsePositiveExecutorInt(value, `${label}.claude.max_turns`, filePath),
      };
    } else if (key === "claude.mcp_config") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        mcpConfig: value,
      };
    } else if (key === "opencode.agent") {
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        agent: value,
      };
    } else if (key === "opencode.attach") {
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        attach: value,
      };
    } else if (key === "opencode.format") {
      const normalizedFormat = value.toLowerCase();
      if (!["default", "json"].includes(normalizedFormat)) {
        throw new Error(
          `Invalid ${label}.opencode.format "${value}" in ${filePath}; expected default or json`,
        );
      }
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        format: normalizedFormat,
      };
    } else if (key === "opencode.steps") {
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        steps: parsePositiveExecutorInt(value, `${label}.opencode.steps`, filePath),
      };
    }
  }
  return executorConfig;
}

export function extractExitContractFromSection(sectionText, filePath, agentId) {
  const exitContractBlock = extractSectionBody(sectionText, "Exit contract", filePath, agentId, {
    required: false,
  });
  return parseExitContractSettings(exitContractBlock, filePath, `agent ${agentId}`);
}

export function extractExecutorConfigFromSection(sectionText, filePath, agentId) {
  const executorBlock = extractSectionBody(sectionText, "Executor", filePath, agentId, {
    required: false,
  });
  return normalizeAgentExecutorConfig(
    parseExecutorSettings(executorBlock, filePath, `agent ${agentId}`),
    filePath,
    `agent ${agentId}`,
  );
}

export function extractWaveContext7Defaults(content, filePath) {
  const topLevelContext7 = extractTopLevelSectionBody(content, "Context7 defaults", filePath, {
    required: false,
  });
  return parseContext7Settings(topLevelContext7, filePath, "wave defaults");
}

export function extractRolePromptPaths(sectionText, filePath, agentId) {
  const rolePromptsBlock = extractSectionBody(sectionText, "Role prompts", filePath, agentId, {
    required: false,
  });
  if (!rolePromptsBlock) {
    return [];
  }
  const rolePromptPaths = [];
  for (const line of rolePromptsBlock.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+(.+?)\s*$/);
    if (!bulletMatch) {
      throw new Error(`Malformed role prompt entry "${trimmed}" for agent ${agentId} in ${filePath}`);
    }
    const rolePromptPath = bulletMatch[1].replace(/[`"']/g, "").trim();
    if (!rolePromptPath) {
      throw new Error(`Empty role prompt entry for agent ${agentId} in ${filePath}`);
    }
    rolePromptPaths.push(rolePromptPath);
  }
  if (rolePromptPaths.length === 0) {
    throw new Error(`Missing role prompt paths for agent ${agentId} in ${filePath}`);
  }
  return Array.from(new Set(rolePromptPaths));
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function extractOwnedPaths(promptText) {
  const ownedPaths = [];
  let inFileOwnership = false;
  for (const line of String(promptText || "").split(/\r?\n/)) {
    if (/^\s*File ownership\b/i.test(line)) {
      inFileOwnership = true;
      continue;
    }
    if (inFileOwnership && /^\s*[A-Za-z][A-Za-z0-9 _/-]*:\s*$/.test(line)) {
      inFileOwnership = false;
    }
    if (!inFileOwnership) {
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!bulletMatch) {
      continue;
    }
    const cleaned = bulletMatch[1].replace(/[`"']/g, "").trim();
    if (!cleaned) {
      continue;
    }
    ownedPaths.push(cleaned);
  }
  return Array.from(new Set(ownedPaths));
}

function isRepoContainedPath(relPath) {
  if (!relPath || path.isAbsolute(relPath)) {
    return false;
  }
  const resolved = path.resolve(REPO_ROOT, relPath);
  const relative = path.relative(REPO_ROOT, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRolePromptAbsolutePath(rolePromptPath, filePath, agentId, rolePromptDir) {
  if (!isAllowedRolePromptPath(rolePromptPath, rolePromptDir)) {
    throw new Error(
      `Role prompt path ${rolePromptPath} for agent ${agentId} in ${filePath} must stay within ${rolePromptDir}/*.md`,
    );
  }
  return path.resolve(REPO_ROOT, rolePromptPath);
}

export function extractStandingPromptFromRoleDoc(
  rolePromptPath,
  filePath,
  agentId,
  options = {},
) {
  const absoluteRolePromptPath = resolveRolePromptAbsolutePath(
    rolePromptPath,
    filePath,
    agentId,
    options.rolePromptDir || "docs/agents",
  );
  if (!fs.existsSync(absoluteRolePromptPath)) {
    throw new Error(
      `Missing role prompt ${rolePromptPath} for agent ${agentId} in ${filePath}`,
    );
  }
  const rolePromptContent = fs.readFileSync(absoluteRolePromptPath, "utf8");
  const standingPromptBlock = rolePromptContent.match(/## Standing prompt[\r\n]+/);
  if (!standingPromptBlock) {
    throw new Error(
      `Missing "## Standing prompt" section in ${rolePromptPath} required by agent ${agentId} in ${filePath}`,
    );
  }
  const afterStandingPrompt = rolePromptContent.slice(
    standingPromptBlock.index + standingPromptBlock[0].length,
  );
  return extractFencedBlock(
    afterStandingPrompt,
    `Role prompt ${rolePromptPath} required by agent ${agentId} in ${filePath}`,
  );
}

export function composeResolvedPrompt(rolePromptPaths, localPrompt, filePath, agentId, options = {}) {
  return [
    ...rolePromptPaths.map((rolePath) =>
      extractStandingPromptFromRoleDoc(rolePath, filePath, agentId, options),
    ),
    localPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function resolveEvaluatorReportPath(wave, options = {}) {
  const evaluatorAgentId = options.evaluatorAgentId || DEFAULT_EVALUATOR_AGENT_ID;
  const evaluator = wave?.agents?.find((agent) => agent.agentId === evaluatorAgentId);
  if (!evaluator) {
    return null;
  }
  return (
    evaluator.ownedPaths.find((ownedPath) =>
      /(?:^|\/)(?:reviews?|.*evaluator).*\.(?:md|txt)$/i.test(ownedPath),
    ) ??
    evaluator.ownedPaths[0] ??
    null
  );
}

export function validateWaveDefinition(wave, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const lane = laneProfile.lane;
  const evaluatorAgentId = laneProfile.roles.evaluatorAgentId || DEFAULT_EVALUATOR_AGENT_ID;
  const documentationAgentId =
    laneProfile.roles.documentationAgentId || DEFAULT_DOCUMENTATION_AGENT_ID;
  const documentationThreshold = laneProfile.validation.requireDocumentationStewardFromWave;
  const context7Threshold = laneProfile.validation.requireContext7DeclarationsFromWave;
  const exitContractThreshold = laneProfile.validation.requireExitContractsFromWave;
  const errors = [];
  const agentIds = wave.agents.map((agent) => agent.agentId);
  const duplicateAgentIds = agentIds.filter(
    (agentId, index) => agentIds.indexOf(agentId) !== index,
  );
  if (wave.agents.length === 0) {
    errors.push("must declare at least one agent");
  }
  if (duplicateAgentIds.length > 0) {
    errors.push(`must not repeat agent ids (${Array.from(new Set(duplicateAgentIds)).join(", ")})`);
  }
  if (!wave.agents.some((agent) => agent.agentId === evaluatorAgentId)) {
    errors.push(`must include Agent ${evaluatorAgentId} as the running evaluator`);
  }
  for (const agent of wave.agents) {
    if (!Array.isArray(agent.ownedPaths) || agent.ownedPaths.length === 0) {
      errors.push(`Agent ${agent.agentId} must declare at least one owned path`);
      continue;
    }
    const unsafeOwnedPaths = agent.ownedPaths.filter(
      (ownedPath) => !isRepoContainedPath(ownedPath),
    );
    if (unsafeOwnedPaths.length > 0) {
      errors.push(
        `Agent ${agent.agentId} has non-repo-owned paths (${unsafeOwnedPaths.join(", ")})`,
      );
    }
    const invalidRolePromptPaths = Array.isArray(agent.rolePromptPaths)
      ? agent.rolePromptPaths.filter(
          (rolePromptPath) =>
            !isAllowedRolePromptPath(rolePromptPath, laneProfile.roles.rolePromptDir),
        )
      : [];
    if (invalidRolePromptPaths.length > 0) {
      errors.push(
        `Agent ${agent.agentId} has invalid role prompt paths (${invalidRolePromptPaths.join(", ")})`,
      );
    }
    if (
      agent.executorConfig?.id === "claude" &&
      (agent.executorConfig?.codex || agent.executorConfig?.opencode)
    ) {
      errors.push(`Agent ${agent.agentId} declares executor=claude but includes non-Claude overrides`);
    }
    if (
      agent.executorConfig?.id === "opencode" &&
      (agent.executorConfig?.codex || agent.executorConfig?.claude)
    ) {
      errors.push(
        `Agent ${agent.agentId} declares executor=opencode but includes non-OpenCode overrides`,
      );
    }
    if (
      agent.executorConfig?.id === "codex" &&
      (agent.executorConfig?.claude || agent.executorConfig?.opencode)
    ) {
      errors.push(`Agent ${agent.agentId} declares executor=codex but includes non-Codex overrides`);
    }
    if (
      agent.executorConfig?.id === "local" &&
      (agent.executorConfig?.codex || agent.executorConfig?.claude || agent.executorConfig?.opencode)
    ) {
      errors.push(`Agent ${agent.agentId} declares executor=local but includes vendor overrides`);
    }
    if (context7Threshold !== null && wave.wave >= context7Threshold) {
      if (!agent.context7Config) {
        errors.push(
          `Agent ${agent.agentId} must declare a ### Context7 section in waves ${context7Threshold} and later`,
        );
      }
    }
    if (exitContractThreshold !== null && wave.wave >= exitContractThreshold) {
      if (![evaluatorAgentId, documentationAgentId].includes(agent.agentId)) {
        if (!agent.exitContract) {
          errors.push(
            `Agent ${agent.agentId} must declare a ### Exit contract section in waves ${exitContractThreshold} and later`,
          );
        } else {
          const exitContractErrors = validateExitContractShape(agent.exitContract);
          if (exitContractErrors.length > 0) {
            errors.push(
              `Agent ${agent.agentId} has invalid exit contract (${exitContractErrors.join(", ")})`,
            );
          }
        }
      }
    }
  }
  for (const agent of wave.agents) {
    for (const requiredRef of laneProfile.validation.requiredPromptReferences) {
      if (!agent.prompt.includes(requiredRef)) {
        errors.push(`Agent ${agent.agentId} must reference ${requiredRef}`);
      }
    }
  }
  const evaluator = wave.agents.find((agent) => agent.agentId === evaluatorAgentId);
  if (!evaluator?.rolePromptPaths?.includes(laneProfile.roles.evaluatorRolePromptPath)) {
    errors.push(
      `Agent ${evaluatorAgentId} must import ${laneProfile.roles.evaluatorRolePromptPath}`,
    );
  }
  if (!resolveEvaluatorReportPath(wave, { evaluatorAgentId })) {
    errors.push(`Agent ${evaluatorAgentId} must own an evaluator report path`);
  }
  if (documentationThreshold !== null && wave.wave >= documentationThreshold) {
    const documentationStewards = wave.agents.filter((agent) =>
      agent.rolePromptPaths?.includes(laneProfile.roles.documentationRolePromptPath),
    );
    if (documentationStewards.length !== 1) {
      errors.push(
        `Wave ${wave.wave} must include exactly one documentation steward importing ${laneProfile.roles.documentationRolePromptPath}`,
      );
    } else {
      const documentationSteward = documentationStewards[0];
      const missingSharedPlanDocs = laneProfile.sharedPlanDocs.filter(
        (docPath) => !documentationSteward.ownedPaths.includes(docPath),
      );
      if (missingSharedPlanDocs.length > 0) {
        errors.push(
          `Documentation steward ${documentationSteward.agentId} must own ${missingSharedPlanDocs.join(", ")}`,
        );
      }
      const sharedPlanDocOwners = wave.agents.filter(
        (agent) =>
          agent.agentId !== documentationSteward.agentId &&
          agent.ownedPaths.some((ownedPath) => laneProfile.sharedPlanDocs.includes(ownedPath)),
      );
      if (sharedPlanDocOwners.length > 0) {
        errors.push(
          `Shared plan docs must be owned only by ${documentationSteward.agentId} (also owned by ${sharedPlanDocOwners.map((agent) => agent.agentId).join(", ")})`,
        );
      }
    }
  }
  if (context7Threshold !== null && wave.wave >= context7Threshold && !wave.context7Defaults) {
    errors.push(`Waves ${context7Threshold} and later must declare a ## Context7 defaults section`);
  }
  if (errors.length > 0) {
    throw new Error(`Invalid wave ${wave.wave} (${wave.file}): ${errors.join("; ")}`);
  }
  return wave;
}

export function parseWaveContent(content, filePath, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const fileName = path.basename(filePath);
  const waveNumber = waveNumberFromFileName(fileName);
  const commitMessageMatch = content.match(/\*\*Commit message\*\*:\s*`([^`]+)`/);
  const agentHeaders = [];
  const headerRegex = /^## Agent ([^:]+):\s*(.+)$/gm;
  let match = headerRegex.exec(content);
  while (match !== null) {
    agentHeaders.push({
      agentId: match[1].trim(),
      title: match[2].trim(),
      startIndex: match.index,
      headerLength: match[0].length,
    });
    match = headerRegex.exec(content);
  }

  const agents = [];
  for (let i = 0; i < agentHeaders.length; i += 1) {
    const current = agentHeaders[i];
    const next = agentHeaders[i + 1];
    const sectionStart = current.startIndex + current.headerLength;
    const sectionEnd = next ? next.startIndex : content.length;
    const sectionText = content.slice(sectionStart, sectionEnd);
    const rolePromptPaths = extractRolePromptPaths(sectionText, filePath, current.agentId);
    const context7Config = extractContext7ConfigFromSection(sectionText, filePath, current.agentId);
    const exitContract = extractExitContractFromSection(sectionText, filePath, current.agentId);
    const executorConfig = extractExecutorConfigFromSection(sectionText, filePath, current.agentId);
    const promptOverlay = extractPromptFromSection(sectionText, filePath, current.agentId);
    const prompt = composeResolvedPrompt(
      rolePromptPaths,
      promptOverlay,
      filePath,
      current.agentId,
      {
        rolePromptDir: laneProfile.roles.rolePromptDir,
      },
    );
    const ownedPaths = extractOwnedPaths(promptOverlay);
    agents.push({
      agentId: current.agentId,
      title: current.title,
      slug: slugify(`${waveNumber}-${current.agentId}`),
      prompt,
      promptOverlay,
      rolePromptPaths,
      context7Config,
      exitContract,
      executorConfig,
      ownedPaths,
    });
  }

  return {
    wave: waveNumber,
    file: path.relative(REPO_ROOT, filePath),
    commitMessage: commitMessageMatch ? commitMessageMatch[1] : null,
    context7Defaults: extractWaveContext7Defaults(content, filePath),
    agents,
    evaluatorReportPath: resolveEvaluatorReportPath(
      { agents },
      { evaluatorAgentId: laneProfile.roles.evaluatorAgentId },
    ),
  };
}

function cloneExecutorValue(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

export function resolveAgentExecutor(agent, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const defaultExecutorMode = normalizeExecutorMode(
    options.executorMode || laneProfile.executors.default,
    "executor",
  );
  const executorConfig = agent?.executorConfig || null;
  const executorId = normalizeExecutorMode(
    executorConfig?.id || defaultExecutorMode,
    `agent ${agent?.agentId || "unknown"} executor`,
  );
  const resolvedModel =
    executorConfig?.model ||
    (executorId === "claude"
      ? laneProfile.executors.claude.model
      : executorId === "opencode"
        ? laneProfile.executors.opencode.model
        : null);
  return {
    id: executorId,
    model: resolvedModel || null,
    codex: {
      command: laneProfile.executors.codex.command,
      sandbox:
        executorConfig?.codex?.sandbox ||
        (executorId === "codex"
          ? normalizeCodexSandboxMode(
              options.codexSandboxMode || laneProfile.executors.codex.sandbox,
              "executor.codex.sandbox",
            )
          : laneProfile.executors.codex.sandbox || DEFAULT_CODEX_SANDBOX_MODE),
    },
    claude: {
      ...cloneExecutorValue(laneProfile.executors.claude),
      model: executorId === "claude" ? resolvedModel || laneProfile.executors.claude.model : laneProfile.executors.claude.model,
      agent: executorConfig?.claude?.agent || laneProfile.executors.claude.agent,
      permissionMode:
        executorConfig?.claude?.permissionMode || laneProfile.executors.claude.permissionMode,
      maxTurns: executorConfig?.claude?.maxTurns ?? laneProfile.executors.claude.maxTurns,
      mcpConfig:
        executorConfig?.claude?.mcpConfig
          ? [executorConfig.claude.mcpConfig]
          : cloneExecutorValue(laneProfile.executors.claude.mcpConfig),
    },
    opencode: {
      ...cloneExecutorValue(laneProfile.executors.opencode),
      model:
        executorId === "opencode"
          ? resolvedModel || laneProfile.executors.opencode.model
          : laneProfile.executors.opencode.model,
      agent: executorConfig?.opencode?.agent || laneProfile.executors.opencode.agent,
      attach: executorConfig?.opencode?.attach || laneProfile.executors.opencode.attach,
      format: executorConfig?.opencode?.format || laneProfile.executors.opencode.format,
      steps: executorConfig?.opencode?.steps ?? laneProfile.executors.opencode.steps,
    },
  };
}

export function applyExecutorSelectionsToWave(wave, options = {}) {
  return {
    ...wave,
    agents: wave.agents.map((agent) => ({
      ...agent,
      executorResolved: resolveAgentExecutor(agent, options),
    })),
  };
}

export function parseWaveFile(filePath, options = {}) {
  return parseWaveContent(fs.readFileSync(filePath, "utf8"), filePath, options);
}

export function parseWaveFiles(wavesDir, options = {}) {
  if (!fs.existsSync(wavesDir)) {
    throw new Error(`Waves directory not found: ${path.relative(REPO_ROOT, wavesDir)}`);
  }
  const files = fs
    .readdirSync(wavesDir)
    .filter((fileName) => /^wave-\d+\.md$/.test(fileName))
    .toSorted((a, b) => waveNumberFromFileName(a) - waveNumberFromFileName(b));
  if (files.length === 0) {
    throw new Error(`No wave files found in ${path.relative(REPO_ROOT, wavesDir)}`);
  }
  return files.map((fileName) => parseWaveFile(path.join(wavesDir, fileName), options));
}

export function buildManifest(lanePaths, waves) {
  const docs = walkFiles(lanePaths.docsDir)
    .map((fullPath) => {
      const data = fs.readFileSync(fullPath, "utf8");
      return {
        path: path.relative(REPO_ROOT, fullPath),
        bytes: Buffer.byteLength(data, "utf8"),
        sha256: crypto.createHash("sha256").update(data).digest("hex"),
      };
    })
    .toSorted((a, b) => a.path.localeCompare(b.path));

  return {
    generatedAt: new Date().toISOString(),
    source: `${path.relative(REPO_ROOT, lanePaths.docsDir).replaceAll(path.sep, "/")}/**/*`,
    waves,
    docs,
  };
}

export function writeManifest(manifestPath, manifest) {
  writeJsonAtomic(manifestPath, manifest);
}

export function normalizeCompletedWaves(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => Number.isFinite(value) && value >= 0),
    ),
  ).toSorted((a, b) => a - b);
}

export function readRunState(runStatePath) {
  const payload = readJsonOrNull(runStatePath);
  return {
    completedWaves: normalizeCompletedWaves(payload?.completedWaves),
    lastUpdatedAt: typeof payload?.lastUpdatedAt === "string" ? payload.lastUpdatedAt : undefined,
  };
}

export function writeRunState(runStatePath, state) {
  ensureDirectory(path.dirname(runStatePath));
  const payload = {
    completedWaves: normalizeCompletedWaves(state.completedWaves),
    lastUpdatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(runStatePath, payload);
  return payload;
}

export function markWaveCompleted(runStatePath, waveNumber) {
  const state = readRunState(runStatePath);
  state.completedWaves = normalizeCompletedWaves([...state.completedWaves, waveNumber]);
  return writeRunState(runStatePath, state);
}

export function resolveAutoNextWaveStart(allWaves, runStatePath) {
  const state = readRunState(runStatePath);
  const completed = new Set(state.completedWaves);
  for (const waveNumber of allWaves.map((wave) => wave.wave).toSorted((a, b) => a - b)) {
    if (!completed.has(waveNumber)) {
      return { nextWave: waveNumber, state };
    }
  }
  return { nextWave: null, state };
}

export function arraysEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function readWaveEvaluatorArtifacts(wave, { logsDir, evaluatorAgentId } = {}) {
  const resolvedEvaluatorAgentId = evaluatorAgentId || DEFAULT_EVALUATOR_AGENT_ID;
  const evaluator =
    wave.agents.find((agent) => agent.agentId === resolvedEvaluatorAgentId) ?? null;
  if (!evaluator) {
    return {
      ok: false,
      statusCode: "missing-evaluator",
      detail: `Agent ${resolvedEvaluatorAgentId} is missing.`,
    };
  }
  const evaluatorReportPath = wave.evaluatorReportPath
    ? path.resolve(REPO_ROOT, wave.evaluatorReportPath)
    : null;
  const reportText =
    evaluatorReportPath && fs.existsSync(evaluatorReportPath)
      ? fs.readFileSync(evaluatorReportPath, "utf8")
      : "";
  const reportVerdict = parseVerdictFromText(reportText, REPORT_VERDICT_REGEX);
  if (reportVerdict.verdict) {
    return {
      ok: reportVerdict.verdict === "pass",
      statusCode: reportVerdict.verdict === "pass" ? "pass" : `evaluator-${reportVerdict.verdict}`,
      detail: reportVerdict.detail || "Verdict read from evaluator report.",
    };
  }
  const evaluatorLogPath = logsDir
    ? path.join(logsDir, `wave-${wave.wave}-${evaluator.slug}.log`)
    : null;
  const logVerdict = parseVerdictFromText(
    evaluatorLogPath ? readFileTail(evaluatorLogPath, 30000) : "",
    WAVE_VERDICT_REGEX,
  );
  if (logVerdict.verdict) {
    return {
      ok: logVerdict.verdict === "pass",
      statusCode: logVerdict.verdict === "pass" ? "pass" : `evaluator-${logVerdict.verdict}`,
      detail: logVerdict.detail || "Verdict read from evaluator log marker.",
    };
  }
  return {
    ok: false,
    statusCode: "missing-evaluator-verdict",
    detail: evaluatorReportPath
      ? `Missing evaluator verdict in ${path.relative(REPO_ROOT, evaluatorReportPath)}.`
      : "Missing evaluator report path and evaluator log verdict.",
  };
}

export function completedWavesFromStatusFiles(allWaves, statusDir, options = {}) {
  const logsDir = options.logsDir || path.join(path.resolve(statusDir, ".."), "logs");
  const evaluatorAgentId = options.evaluatorAgentId || DEFAULT_EVALUATOR_AGENT_ID;
  const documentationAgentId =
    options.documentationAgentId || DEFAULT_DOCUMENTATION_AGENT_ID;
  const exitContractThreshold = options.requireExitContractsFromWave ?? 6;
  const completed = [];
  for (const wave of allWaves) {
    let waveIsComplete = wave.agents.length > 0;
    for (const agent of wave.agents) {
      const statusPath = path.join(statusDir, `wave-${wave.wave}-${agent.slug}.status`);
      const statusRecord = readStatusRecordIfPresent(statusPath);
      if (!statusRecord) {
        waveIsComplete = false;
        break;
      }
      const expectedPromptHash = hashAgentPromptFingerprint(agent);
      if (statusRecord.code !== 0 || statusRecord.promptHash !== expectedPromptHash) {
        waveIsComplete = false;
        break;
      }
      const summary = readAgentExecutionSummary(statusPath);
      if (
        exitContractThreshold !== null &&
        agent.agentId === evaluatorAgentId &&
        wave.wave >= exitContractThreshold
      ) {
        if (!validateEvaluatorSummary(agent, summary).ok) {
          waveIsComplete = false;
          break;
        }
        continue;
      }
      if (
        exitContractThreshold !== null &&
        agent.agentId === documentationAgentId &&
        wave.wave >= exitContractThreshold
      ) {
        if (!validateDocumentationClosureSummary(agent, summary).ok) {
          waveIsComplete = false;
          break;
        }
        continue;
      }
      if (
        exitContractThreshold !== null &&
        wave.wave >= exitContractThreshold &&
        !validateImplementationSummary(agent, summary).ok
      ) {
        waveIsComplete = false;
        break;
      }
    }
    if (
      waveIsComplete &&
      !readWaveEvaluatorArtifacts(wave, { logsDir, evaluatorAgentId }).ok
    ) {
      waveIsComplete = false;
    }
    if (waveIsComplete) {
      completed.push(wave.wave);
    }
  }
  return normalizeCompletedWaves(completed);
}

export function reconcileRunStateFromStatusFiles(allWaves, runStatePath, statusDir, options = {}) {
  const completedFromStatus = completedWavesFromStatusFiles(allWaves, statusDir, options);
  const before = readRunState(runStatePath);
  const firstMerge = normalizeCompletedWaves([...before.completedWaves, ...completedFromStatus]);
  const latest = readRunState(runStatePath);
  const merged = normalizeCompletedWaves([...latest.completedWaves, ...completedFromStatus]);
  let state = latest;
  if (!arraysEqual(merged, latest.completedWaves)) {
    state = writeRunState(runStatePath, { completedWaves: merged });
  }
  return {
    completedFromStatus,
    addedFromBefore: firstMerge.filter((waveNumber) => !before.completedWaves.includes(waveNumber)),
    addedFromLatest: merged.filter((waveNumber) => !latest.completedWaves.includes(waveNumber)),
    state,
  };
}
