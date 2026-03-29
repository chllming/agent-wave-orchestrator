import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CODEX_SANDBOX_MODE,
  DEFAULT_CONT_EVAL_AGENT_ID,
  DEFAULT_CONT_EVAL_ROLE_PROMPT_PATH,
  DEFAULT_CONT_QA_AGENT_ID,
  DEFAULT_CONT_QA_ROLE_PROMPT_PATH,
  DEFAULT_DESIGN_ROLE_PROMPT_PATH,
  DEFAULT_DOCUMENTATION_AGENT_ID,
  DEFAULT_DOCUMENTATION_ROLE_PROMPT_PATH,
  DEFAULT_INTEGRATION_AGENT_ID,
  DEFAULT_INTEGRATION_ROLE_PROMPT_PATH,
  DEFAULT_SECURITY_ROLE_PROMPT_PATH,
  DEFAULT_WAVE_LANE,
  normalizeClaudeEffort,
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
  toIsoTimestamp,
  writeJsonAtomic,
} from "./shared.mjs";
import { normalizeContext7Config, hashAgentPromptFingerprint } from "./context7.mjs";
import {
  coordinationRecordBlocksWave,
  openClarificationLinkedRequests,
  readMaterializedCoordinationState,
} from "./coordination-store.mjs";
import {
  agentSummaryPathFromStatusPath,
  buildAgentExecutionSummary,
  normalizeExitContract,
  readAgentExecutionSummary,
  validateContEvalSummary,
  validateContQaSummary,
  validateDocumentationClosureSummary,
  validateExitContractShape,
  validateIntegrationSummary,
  validateImplementationSummary,
  validateSecuritySummary,
  writeAgentExecutionSummary,
} from "./agent-state.mjs";
import { parseEvalTargets, validateEvalTargets } from "./evals.mjs";
import { normalizeSkillId, resolveAgentSkills } from "./skills.mjs";
import {
  isContEvalImplementationOwningAgent,
  isContEvalReportOnlyAgent,
  isContEvalReportPath,
  isContQaReportPath,
  isDesignAgent,
  isDocsOnlyDesignAgent,
  isImplementationOwningDesignAgent,
  isDesignRolePromptPath,
  resolveDesignReportPath,
  isSecurityRolePromptPath,
  isSecurityReviewAgent,
  resolveAgentClosureRoleKeys,
  resolveWaveRoleBindings,
  resolveSecurityReviewReportPath,
} from "./role-helpers.mjs";
import {
  RUN_STATE_KIND,
  RUN_STATE_SCHEMA_VERSION,
  normalizeManifest,
  readAssignmentSnapshot,
  readDependencySnapshot,
} from "./artifact-schemas.mjs";

export const WAVE_CONT_QA_ROLE_PROMPT_PATH = DEFAULT_CONT_QA_ROLE_PROMPT_PATH;
export const WAVE_CONT_EVAL_ROLE_PROMPT_PATH = DEFAULT_CONT_EVAL_ROLE_PROMPT_PATH;
export const WAVE_INTEGRATION_ROLE_PROMPT_PATH = DEFAULT_INTEGRATION_ROLE_PROMPT_PATH;
export const WAVE_DOCUMENTATION_ROLE_PROMPT_PATH = DEFAULT_DOCUMENTATION_ROLE_PROMPT_PATH;
export const WAVE_SECURITY_ROLE_PROMPT_PATH = DEFAULT_SECURITY_ROLE_PROMPT_PATH;
export const WAVE_DESIGN_ROLE_PROMPT_PATH = DEFAULT_DESIGN_ROLE_PROMPT_PATH;
export const SHARED_PLAN_DOC_PATHS = [
  "docs/plans/current-state.md",
  "docs/plans/master-plan.md",
  "docs/plans/migration.md",
];

const COMPONENT_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const COMPONENT_MATURITY_LEVELS = [
  "inventoried",
  "contract-frozen",
  "repo-landed",
  "baseline-proved",
  "pilot-live",
  "qa-proved",
  "fleet-ready",
  "cutover-ready",
  "deprecation-ready",
];
const COMPONENT_MATURITY_ORDER = Object.fromEntries(
  COMPONENT_MATURITY_LEVELS.map((level, index) => [level, index]),
);
const PROOF_CENTRIC_COMPONENT_LEVEL = "pilot-live";
const RETRY_POLICY_VALUES = new Set(["sticky", "fallback-allowed"]);
const CLOSURE_ROLE_LABELS = {
  "cont-eval": "cont-EVAL",
  "security-review": "security review",
  integration: "integration steward",
  documentation: "documentation steward",
  "cont-qa": "cont-QA",
};

function resolveLaneProfileForOptions(options = {}) {
  if (options.laneProfile) {
    return options.laneProfile;
  }
  const config = options.config || loadWaveConfig();
  return resolveLaneProfile(
    config,
    options.lane || config.defaultLane || DEFAULT_WAVE_LANE,
    options.project || config.defaultProject,
  );
}

function resolveSecurityRolePromptPath(laneProfile) {
  return laneProfile?.roles?.securityRolePromptPath || DEFAULT_SECURITY_ROLE_PROMPT_PATH;
}

function resolveDesignRolePromptPath(laneProfile) {
  return laneProfile?.roles?.designRolePromptPath || DEFAULT_DESIGN_ROLE_PROMPT_PATH;
}

function normalizeSecurityCapabilities(capabilities, rolePromptPaths, securityRolePromptPath) {
  const normalized = Array.isArray(capabilities) ? [...capabilities] : [];
  const hasSecurityRolePrompt = Array.isArray(rolePromptPaths)
    ? rolePromptPaths.some((rolePromptPath) =>
        isSecurityRolePromptPath(rolePromptPath, securityRolePromptPath),
      )
    : false;
  if (
    hasSecurityRolePrompt &&
    !normalized.some((capability) => String(capability || "").trim().toLowerCase() === "security-review")
  ) {
    normalized.push("security-review");
  }
  return normalized;
}

function normalizeDesignCapabilities(capabilities, rolePromptPaths, designRolePromptPath) {
  const normalized = Array.isArray(capabilities) ? [...capabilities] : [];
  const hasDesignRolePrompt = Array.isArray(rolePromptPaths)
    ? rolePromptPaths.some((rolePromptPath) =>
        isDesignRolePromptPath(rolePromptPath, designRolePromptPath),
      )
    : false;
  if (
    hasDesignRolePrompt &&
    !normalized.some((capability) => String(capability || "").trim().toLowerCase() === "design")
  ) {
    normalized.push("design");
  }
  return normalized;
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

function normalizeComponentId(value, label, filePath) {
  const normalized = String(value || "").trim();
  if (!COMPONENT_ID_REGEX.test(normalized)) {
    throw new Error(`Invalid component id "${value}" in ${label} (${filePath})`);
  }
  return normalized;
}

function parseComponentPromotions(blockText, filePath, label) {
  if (!blockText) {
    return [];
  }
  const promotions = [];
  const seen = new Set();
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+([a-z0-9._-]+)\s*:\s*([a-z0-9._-]+)\s*$/i);
    if (!bulletMatch) {
      throw new Error(`Malformed component promotion "${trimmed}" in ${label} (${filePath})`);
    }
    const componentId = normalizeComponentId(bulletMatch[1], label, filePath);
    const targetLevel = String(bulletMatch[2] || "").trim();
    if (!targetLevel) {
      throw new Error(`Missing component target level for ${componentId} in ${label} (${filePath})`);
    }
    if (seen.has(componentId)) {
      throw new Error(`Duplicate component promotion "${componentId}" in ${label} (${filePath})`);
    }
    seen.add(componentId);
    promotions.push({ componentId, targetLevel });
  }
  return promotions;
}

function parseComponentList(blockText, filePath, label) {
  if (!blockText) {
    return [];
  }
  const components = [];
  const seen = new Set();
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+([a-z0-9._-]+)\s*$/i);
    if (!bulletMatch) {
      throw new Error(`Malformed component entry "${trimmed}" in ${label} (${filePath})`);
    }
    const componentId = normalizeComponentId(bulletMatch[1], label, filePath);
    if (seen.has(componentId)) {
      throw new Error(`Duplicate component "${componentId}" in ${label} (${filePath})`);
    }
    seen.add(componentId);
    components.push(componentId);
  }
  return components;
}

function parsePathList(blockText, filePath, label) {
  if (!blockText) {
    return [];
  }
  const paths = [];
  const seen = new Set();
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+(.+?)\s*$/);
    if (!bulletMatch) {
      throw new Error(`Malformed path entry "${trimmed}" in ${label} (${filePath})`);
    }
    const relPath = bulletMatch[1].replace(/[`"']/g, "").trim();
    if (!isRepoContainedPath(relPath)) {
      throw new Error(`Path "${relPath}" in ${label} (${filePath}) must stay within the repo root`);
    }
    if (seen.has(relPath)) {
      throw new Error(`Duplicate path "${relPath}" in ${label} (${filePath})`);
    }
    seen.add(relPath);
    paths.push(relPath);
  }
  return paths;
}

function parseSkillsList(blockText, filePath, label) {
  if (!blockText) {
    return [];
  }
  const skills = [];
  const seen = new Set();
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+(.+?)\s*$/);
    if (!bulletMatch) {
      throw new Error(`Malformed skill entry "${trimmed}" in ${label} (${filePath})`);
    }
    const skillId = normalizeSkillId(
      bulletMatch[1].replace(/[`"']/g, "").trim(),
      `${label} (${filePath})`,
    );
    if (seen.has(skillId)) {
      throw new Error(`Duplicate skill "${skillId}" in ${label} (${filePath})`);
    }
    seen.add(skillId);
    skills.push(skillId);
  }
  return skills;
}

function parseDeployEnvironments(blockText, filePath) {
  if (!blockText) {
    return [];
  }
  const environments = [];
  const seen = new Set();
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(
      /^-\s+`?([a-z0-9][a-z0-9._-]*)`?\s*:\s*`?([a-z0-9][a-z0-9._-]*)`?\s*(default)?(?:\s+\((.*)\))?$/i,
    );
    if (!match) {
      throw new Error(`Malformed deploy environment "${trimmed}" in ${filePath}`);
    }
    const id = String(match[1] || "").trim().toLowerCase();
    const kind = String(match[2] || "").trim().toLowerCase();
    if (seen.has(id)) {
      throw new Error(`Duplicate deploy environment "${id}" in ${filePath}`);
    }
    seen.add(id);
    environments.push({
      id,
      kind,
      isDefault: cleanBooleanToken(match[3]),
      notes: String(match[4] || "").trim() || null,
    });
  }
  if (!environments.some((environment) => environment.isDefault) && environments.length > 0) {
    environments[0].isDefault = true;
  }
  return environments;
}

function cleanBooleanToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "default";
}

function normalizeRepoRelativePath(relPath) {
  return String(relPath || "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .trim();
}

function isOwnedDirectoryPath(relPath) {
  return normalizeRepoRelativePath(relPath).endsWith("/");
}

function deliverableIsOwned(deliverablePath, ownedPath) {
  const deliverable = normalizeRepoRelativePath(deliverablePath);
  const owned = normalizeRepoRelativePath(ownedPath);
  if (!deliverable || !owned) {
    return false;
  }
  if (isOwnedDirectoryPath(owned)) {
    return deliverable.startsWith(owned);
  }
  return deliverable === owned;
}

function validateAgentDeliverables(deliverables, ownedPaths, filePath, agentId) {
  if (!Array.isArray(deliverables) || deliverables.length === 0) {
    return;
  }
  const owned = Array.isArray(ownedPaths) ? ownedPaths : [];
  for (const deliverablePath of deliverables) {
    const normalized = normalizeRepoRelativePath(deliverablePath);
    if (normalized.endsWith("/")) {
      throw new Error(
        `Deliverable "${deliverablePath}" for agent ${agentId} in ${filePath} must be a file path, not a directory path`,
      );
    }
    if (!owned.some((ownedPath) => deliverableIsOwned(normalized, ownedPath))) {
      throw new Error(
        `Deliverable "${deliverablePath}" for agent ${agentId} in ${filePath} must stay within the agent's declared file ownership`,
      );
    }
  }
}

function normalizeMaturityLevel(value, label, filePath) {
  const normalized = String(value || "").trim();
  if (!COMPONENT_MATURITY_ORDER.hasOwnProperty(normalized)) {
    throw new Error(`Invalid maturity level "${value}" in ${label} (${filePath})`);
  }
  return normalized;
}

function proofCentricLevelReached(level) {
  return (
    COMPONENT_MATURITY_ORDER[String(level || "").trim()] >=
    COMPONENT_MATURITY_ORDER[PROOF_CENTRIC_COMPONENT_LEVEL]
  );
}

export function waveRequiresProofCentricValidation(wave) {
  return Array.isArray(wave?.componentPromotions)
    ? wave.componentPromotions.some((promotion) => proofCentricLevelReached(promotion?.targetLevel))
    : false;
}

function agentHighestComponentTargetLevel(agent) {
  const levels = Array.isArray(agent?.components)
    ? agent.components
        .map((componentId) => agent?.componentTargets?.[componentId] || null)
        .filter(Boolean)
    : [];
  if (levels.length === 0) {
    return null;
  }
  return levels.sort((left, right) => COMPONENT_MATURITY_ORDER[right] - COMPONENT_MATURITY_ORDER[left])[0];
}

export function agentRequiresProofCentricValidation(agent) {
  const highestTarget = agentHighestComponentTargetLevel(agent);
  if (highestTarget && proofCentricLevelReached(highestTarget)) {
    return true;
  }
  return Array.isArray(agent?.proofArtifacts) && agent.proofArtifacts.some((artifact) => {
    if (!Array.isArray(artifact?.requiredFor) || artifact.requiredFor.length === 0) {
      return true;
    }
    return artifact.requiredFor.some((level) => proofCentricLevelReached(level));
  });
}

function parseProofArtifacts(blockText, filePath, label) {
  if (!blockText) {
    return [];
  }
  const artifacts = [];
  const seenPaths = new Set();
  for (const line of String(blockText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const bulletMatch = trimmed.match(/^-\s+(.+?)\s*$/);
    if (!bulletMatch) {
      throw new Error(`Malformed proof artifact entry "${trimmed}" in ${label} (${filePath})`);
    }
    const rawEntry = bulletMatch[1].trim();
    let artifact = null;
    if (!rawEntry.includes("|") && !/^path\s*:/i.test(rawEntry)) {
      const relPath = rawEntry.replace(/[`"']/g, "").trim();
      if (!isRepoContainedPath(relPath)) {
        throw new Error(`Path "${relPath}" in ${label} (${filePath}) must stay within the repo root`);
      }
      artifact = {
        path: relPath,
        kind: null,
        requiredFor: [],
      };
    } else {
      const fields = {};
      for (const segment of rawEntry.split("|")) {
        const pair = segment.trim();
        if (!pair) {
          continue;
        }
        const separatorIndex = pair.indexOf(":");
        if (separatorIndex <= 0) {
          throw new Error(`Malformed proof artifact field "${pair}" in ${label} (${filePath})`);
        }
        const key = pair.slice(0, separatorIndex).trim().toLowerCase();
        const value = pair
          .slice(separatorIndex + 1)
          .trim()
          .replace(/^["'`]|["'`]$/g, "");
        if (!key || !value) {
          throw new Error(`Malformed proof artifact field "${pair}" in ${label} (${filePath})`);
        }
        fields[key] = value;
      }
      const relPath = String(fields.path || "").trim();
      if (!relPath) {
        throw new Error(`Proof artifact entry in ${label} (${filePath}) must include path`);
      }
      if (!isRepoContainedPath(relPath)) {
        throw new Error(`Path "${relPath}" in ${label} (${filePath}) must stay within the repo root`);
      }
      const requiredFor = String(fields["required-for"] || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => normalizeMaturityLevel(entry, label, filePath));
      artifact = {
        path: relPath,
        kind: String(fields.kind || "").trim() || null,
        requiredFor,
      };
    }
    if (normalizeRepoRelativePath(artifact.path).endsWith("/")) {
      throw new Error(
        `Proof artifact "${artifact.path}" in ${label} (${filePath}) must be a file path, not a directory path`,
      );
    }
    if (seenPaths.has(artifact.path)) {
      throw new Error(`Duplicate proof artifact "${artifact.path}" in ${label} (${filePath})`);
    }
    seenPaths.add(artifact.path);
    artifacts.push(artifact);
  }
  return artifacts;
}

function validateAgentProofArtifacts(proofArtifacts, ownedPaths, filePath, agentId) {
  if (!Array.isArray(proofArtifacts) || proofArtifacts.length === 0) {
    return;
  }
  const owned = Array.isArray(ownedPaths) ? ownedPaths : [];
  for (const artifact of proofArtifacts) {
    const normalized = normalizeRepoRelativePath(artifact?.path);
    if (!owned.some((ownedPath) => deliverableIsOwned(normalized, ownedPath))) {
      throw new Error(
        `Proof artifact "${artifact?.path}" for agent ${agentId} in ${filePath} must stay within the agent's declared file ownership`,
      );
    }
  }
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

function extractAgentSkillsFromSection(sectionText, filePath, agentId) {
  const skillsBlock = extractSectionBody(sectionText, "Skills", filePath, agentId, {
    required: false,
  });
  return parseSkillsList(skillsBlock, filePath, `agent ${agentId} skills`);
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

function parseExecutorBoolean(value, label, filePath) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid ${label} "${value}" in ${filePath}`);
}

function parseExecutorStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cleanExecutorValue(entry)).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((entry) => cleanExecutorValue(entry))
    .filter(Boolean);
}

function parseExecutorJson(value, label, filePath) {
  try {
    return JSON.parse(String(value || ""));
  } catch (error) {
    throw new Error(`Invalid JSON for ${label} in ${filePath}: ${error.message}`);
  }
}

function parseExecutorJsonObject(value, label, filePath) {
  const parsed = parseExecutorJson(value, label, filePath);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object for ${label} in ${filePath}`);
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
    profile: null,
    model: null,
    fallbacks: [],
    tags: [],
    budget: null,
    retryPolicy: null,
    allowFallbackOnRetry: null,
    codex: null,
    claude: null,
    opencode: null,
  };
  const allowedKeys = new Set([
    "id",
    "profile",
    "model",
    "fallbacks",
    "tags",
    "retry-policy",
    "allow-fallback-on-retry",
    "budget.turns",
    "budget.minutes",
    "codex.command",
    "codex.sandbox",
    "codex.profile_name",
    "codex.config",
    "codex.search",
    "codex.images",
    "codex.add_dirs",
    "codex.json",
    "codex.ephemeral",
    "claude.command",
    "claude.agent",
    "claude.permission_mode",
    "claude.permission_prompt_tool",
    "claude.effort",
    "claude.max_turns",
    "claude.mcp_config",
    "claude.settings",
    "claude.settings_json",
    "claude.hooks_json",
    "claude.allowed_http_hook_urls",
    "claude.output_format",
    "claude.allowed_tools",
    "claude.disallowed_tools",
    "opencode.command",
    "opencode.agent",
    "opencode.attach",
    "opencode.files",
    "opencode.format",
    "opencode.steps",
    "opencode.instructions",
    "opencode.permission",
    "opencode.config_json",
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
    } else if (key === "profile") {
      executorConfig.profile = value.toLowerCase();
    } else if (key === "model") {
      executorConfig.model = value;
    } else if (key === "fallbacks") {
      executorConfig.fallbacks = parseExecutorStringList(value).map((entry, index) =>
        normalizeExecutorMode(entry, `${label}.fallbacks[${index}]`),
      );
    } else if (key === "tags") {
      executorConfig.tags = parseExecutorStringList(value);
    } else if (key === "retry-policy") {
      const normalizedPolicy = value.toLowerCase();
      if (!RETRY_POLICY_VALUES.has(normalizedPolicy)) {
        throw new Error(
          `Invalid ${label}.retry-policy "${value}" in ${filePath}; expected sticky or fallback-allowed`,
        );
      }
      executorConfig.retryPolicy = normalizedPolicy;
    } else if (key === "allow-fallback-on-retry") {
      executorConfig.allowFallbackOnRetry = parseExecutorBoolean(
        value,
        `${label}.allow-fallback-on-retry`,
        filePath,
      );
    } else if (key === "budget.turns" || key === "budget.minutes") {
      executorConfig.budget = {
        ...(executorConfig.budget || { turns: null, minutes: null }),
        [key.endsWith(".turns") ? "turns" : "minutes"]: parsePositiveExecutorInt(
          value,
          `${label}.${key}`,
          filePath,
        ),
      };
    } else if (key === "codex.command") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        command: value,
      };
    } else if (key === "codex.sandbox") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        sandbox: normalizeCodexSandboxMode(value, `${label}.codex.sandbox`),
      };
    } else if (key === "codex.profile_name") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        profileName: value,
      };
    } else if (key === "codex.config") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        config: parseExecutorStringList(value),
      };
    } else if (key === "codex.search") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        search: parseExecutorBoolean(value, `${label}.codex.search`, filePath),
      };
    } else if (key === "codex.images") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        images: parseExecutorStringList(value),
      };
    } else if (key === "codex.add_dirs") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        addDirs: parseExecutorStringList(value),
      };
    } else if (key === "codex.json") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        json: parseExecutorBoolean(value, `${label}.codex.json`, filePath),
      };
    } else if (key === "codex.ephemeral") {
      executorConfig.codex = {
        ...(executorConfig.codex || {}),
        ephemeral: parseExecutorBoolean(value, `${label}.codex.ephemeral`, filePath),
      };
    } else if (key === "claude.command") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        command: value,
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
    } else if (key === "claude.permission_prompt_tool") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        permissionPromptTool: value,
      };
    } else if (key === "claude.effort") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        effort: normalizeClaudeEffort(value, `${label}.claude.effort`),
      };
    } else if (key === "claude.max_turns") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        maxTurns: parsePositiveExecutorInt(value, `${label}.claude.max_turns`, filePath),
      };
    } else if (key === "claude.mcp_config") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        mcpConfig: parseExecutorStringList(value),
      };
    } else if (key === "claude.settings") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        settings: value,
      };
    } else if (key === "claude.settings_json") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        settingsJson: parseExecutorJsonObject(value, `${label}.claude.settings_json`, filePath),
      };
    } else if (key === "claude.hooks_json") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        hooksJson: parseExecutorJsonObject(value, `${label}.claude.hooks_json`, filePath),
      };
    } else if (key === "claude.allowed_http_hook_urls") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        allowedHttpHookUrls: parseExecutorStringList(value),
      };
    } else if (key === "claude.output_format") {
      const normalizedOutputFormat = value.toLowerCase();
      if (!["text", "json", "stream-json"].includes(normalizedOutputFormat)) {
        throw new Error(
          `Invalid ${label}.claude.output_format "${value}" in ${filePath}; expected text, json, or stream-json`,
        );
      }
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        outputFormat: normalizedOutputFormat,
      };
    } else if (key === "claude.allowed_tools") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        allowedTools: parseExecutorStringList(value),
      };
    } else if (key === "claude.disallowed_tools") {
      executorConfig.claude = {
        ...(executorConfig.claude || {}),
        disallowedTools: parseExecutorStringList(value),
      };
    } else if (key === "opencode.command") {
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        command: value,
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
    } else if (key === "opencode.files") {
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        files: parseExecutorStringList(value),
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
    } else if (key === "opencode.instructions") {
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        instructions: parseExecutorStringList(value),
      };
    } else if (key === "opencode.permission") {
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        permission: parseExecutorJson(value, `${label}.opencode.permission`, filePath),
      };
    } else if (key === "opencode.config_json") {
      executorConfig.opencode = {
        ...(executorConfig.opencode || {}),
        configJson: parseExecutorJsonObject(value, `${label}.opencode.config_json`, filePath),
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

export function extractWaveComponentPromotions(content, filePath) {
  const block = extractTopLevelSectionBody(content, "Component promotions", filePath, {
    required: false,
  });
  return parseComponentPromotions(block, filePath, "wave component promotions");
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

export function extractAgentComponentsFromSection(sectionText, filePath, agentId) {
  const block = extractSectionBody(sectionText, "Components", filePath, agentId, {
    required: false,
  });
  return parseComponentList(block, filePath, `agent ${agentId} components`);
}

export function extractAgentCapabilitiesFromSection(sectionText, filePath, agentId) {
  const block = extractSectionBody(sectionText, "Capabilities", filePath, agentId, {
    required: false,
  });
  return parseComponentList(block, filePath, `agent ${agentId} capabilities`);
}

export function extractAgentDeliverablesFromSection(sectionText, filePath, agentId) {
  const block = extractSectionBody(sectionText, "Deliverables", filePath, agentId, {
    required: false,
  });
  return parsePathList(block, filePath, `agent ${agentId} deliverables`);
}

export function extractAgentProofArtifactsFromSection(sectionText, filePath, agentId) {
  const block = extractSectionBody(sectionText, "Proof artifacts", filePath, agentId, {
    required: false,
  });
  return parseProofArtifacts(block, filePath, `agent ${agentId} proof artifacts`);
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

function resolveAgentReportPath(wave, agentId, pattern) {
  const agent = wave?.agents?.find((entry) => entry.agentId === agentId);
  if (!agent) {
    return null;
  }
  return (
    agent.ownedPaths.find((ownedPath) =>
      pattern.test(ownedPath),
    ) ??
    agent.ownedPaths[0] ??
    null
  );
}

export function resolveContQaReportPath(wave, options = {}) {
  const contQaAgentId = options.contQaAgentId || DEFAULT_CONT_QA_AGENT_ID;
  return resolveAgentReportPath(
    wave,
    contQaAgentId,
    { test: isContQaReportPath },
  );
}

export function resolveContEvalReportPath(wave, options = {}) {
  const contEvalAgentId = options.contEvalAgentId || DEFAULT_CONT_EVAL_AGENT_ID;
  return resolveAgentReportPath(
    wave,
    contEvalAgentId,
    { test: isContEvalReportPath },
  );
}

function isImplementationOwningWaveAgent(
  agent,
  {
    contQaAgentId,
    contEvalAgentId,
    integrationAgentId,
    documentationAgentId,
    designRolePromptPath,
    securityRolePromptPath,
  },
) {
  return (
    ![contQaAgentId, integrationAgentId, documentationAgentId].includes(agent.agentId) &&
    !isContEvalReportOnlyAgent(agent, { contEvalAgentId }) &&
    !isDocsOnlyDesignAgent(agent, { designRolePromptPath }) &&
    !isSecurityReviewAgent(agent, { securityRolePromptPath })
  );
}

function resolveAgentSummaryReportPath(
  wave,
  agentId,
  { contQaAgentId, contEvalAgentId, securityRolePromptPath } = {},
) {
  if (agentId === contQaAgentId && wave.contQaReportPath) {
    return path.resolve(REPO_ROOT, wave.contQaReportPath);
  }
  if (agentId === contEvalAgentId && wave.contEvalReportPath) {
    return path.resolve(REPO_ROOT, wave.contEvalReportPath);
  }
  const agent = wave?.agents?.find((entry) => entry.agentId === agentId);
  if (isDesignAgent(agent)) {
    const designReportPath = resolveDesignReportPath(agent);
    if (designReportPath) {
      return path.resolve(REPO_ROOT, designReportPath);
    }
  }
  if (isSecurityReviewAgent(agent, { securityRolePromptPath })) {
    const securityReportPath = resolveSecurityReviewReportPath(agent);
    if (securityReportPath) {
      return path.resolve(REPO_ROOT, securityReportPath);
    }
  }
  return null;
}

function materializeLiveExecutionSummaryIfMissing({
  wave,
  agent,
  statusPath,
  statusRecord,
  logsDir,
  contQaAgentId,
  contEvalAgentId,
  securityRolePromptPath = null,
}) {
  const logPath = logsDir ? path.join(logsDir, `wave-${wave.wave}-${agent.slug}.log`) : null;
  const existing = readAgentExecutionSummary(statusPath, {
    agent,
    statusPath,
    statusRecord,
    logPath,
    reportPath: resolveAgentSummaryReportPath(wave, agent.agentId, {
      contQaAgentId,
      contEvalAgentId,
      securityRolePromptPath,
    }),
  });
  if (existing) {
    return existing;
  }
  if (!statusRecord || !logPath || !fs.existsSync(logPath)) {
    return null;
  }
  const summary = buildAgentExecutionSummary({
    agent,
    statusRecord,
    logPath,
    reportPath: resolveAgentSummaryReportPath(wave, agent.agentId, {
      contQaAgentId,
      contEvalAgentId,
      securityRolePromptPath,
    }),
  });
  writeAgentExecutionSummary(statusPath, summary);
  return summary;
}

function normalizeMatrixStringArray(values, label, filePath) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value, index) => String(value || "").trim())
    .filter(Boolean)
    .map((value, index) => {
      if (!value) {
        throw new Error(`Empty ${label}[${index}] in ${filePath}`);
      }
      return value;
    });
}

export function loadComponentCutoverMatrix(options = {}) {
  const laneProfile =
    options.componentMatrixPayload !== undefined ? null : resolveLaneProfileForOptions(options);
  const matrixJsonPath =
    options.componentMatrixJsonPath ||
    (laneProfile
      ? path.resolve(
          REPO_ROOT,
          laneProfile?.paths?.componentCutoverMatrixJsonPath ||
            "trace-bundle/component-cutover-matrix.json",
        )
      : "trace-bundle/component-cutover-matrix.json");
  const payload =
    options.componentMatrixPayload !== undefined
      ? options.componentMatrixPayload
      : readJsonOrNull(matrixJsonPath);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      `Component cutover matrix is missing or invalid: ${path.relative(REPO_ROOT, matrixJsonPath)}`,
    );
  }
  const levels = Array.isArray(payload.levels)
    ? payload.levels.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (levels.length === 0) {
    throw new Error(
      `Component cutover matrix must define a non-empty "levels" array in ${path.relative(REPO_ROOT, matrixJsonPath)}`,
    );
  }
  const levelSet = new Set(levels);
  const levelOrder = Object.fromEntries(levels.map((level, index) => [level, index]));
  const rawComponents =
    payload.components && typeof payload.components === "object" && !Array.isArray(payload.components)
      ? payload.components
      : null;
  if (!rawComponents) {
    throw new Error(
      `Component cutover matrix must define a "components" object in ${path.relative(REPO_ROOT, matrixJsonPath)}`,
    );
  }
  const components = Object.fromEntries(
    Object.entries(rawComponents).map(([rawComponentId, rawComponent]) => {
      const componentId = normalizeComponentId(
        rawComponentId,
        "component cutover matrix",
        path.relative(REPO_ROOT, matrixJsonPath),
      );
      if (!rawComponent || typeof rawComponent !== "object" || Array.isArray(rawComponent)) {
        throw new Error(
          `Component "${componentId}" must be an object in ${path.relative(REPO_ROOT, matrixJsonPath)}`,
        );
      }
      const currentLevel = String(rawComponent.currentLevel || "").trim();
      if (!levelSet.has(currentLevel)) {
        throw new Error(
          `Component "${componentId}" has invalid currentLevel "${rawComponent.currentLevel}" in ${path.relative(REPO_ROOT, matrixJsonPath)}`,
        );
      }
      const promotions = Array.isArray(rawComponent.promotions)
        ? rawComponent.promotions.map((promotion, index) => {
            if (!promotion || typeof promotion !== "object" || Array.isArray(promotion)) {
              throw new Error(
                `Component "${componentId}" has malformed promotion[${index}] in ${path.relative(REPO_ROOT, matrixJsonPath)}`,
              );
            }
            const wave = Number.parseInt(String(promotion.wave), 10);
            const target = String(promotion.target || "").trim();
            if (!Number.isFinite(wave) || wave < 0) {
              throw new Error(
                `Component "${componentId}" has invalid promotion wave "${promotion.wave}" in ${path.relative(REPO_ROOT, matrixJsonPath)}`,
              );
            }
            if (!levelSet.has(target)) {
              throw new Error(
                `Component "${componentId}" has invalid promotion target "${promotion.target}" in ${path.relative(REPO_ROOT, matrixJsonPath)}`,
              );
            }
            return { wave, target };
          })
        : [];
      return [
        componentId,
        {
          title: String(rawComponent.title || componentId).trim() || componentId,
          canonicalDocs: normalizeMatrixStringArray(
            rawComponent.canonicalDocs,
            `${componentId}.canonicalDocs`,
            path.relative(REPO_ROOT, matrixJsonPath),
          ),
          currentLevel,
          promotions,
          proofSurfaces: normalizeMatrixStringArray(
            rawComponent.proofSurfaces,
            `${componentId}.proofSurfaces`,
            path.relative(REPO_ROOT, matrixJsonPath),
          ),
        },
      ];
    }),
  );
  return {
    version: Number.parseInt(String(payload.version ?? "1"), 10) || 1,
    levels,
    levelSet,
    levelOrder,
    components,
    docPath:
      laneProfile?.paths?.componentCutoverMatrixDocPath ??
      options.componentMatrixDocPath ??
      null,
    jsonPath:
      laneProfile?.paths?.componentCutoverMatrixJsonPath ??
      options.componentMatrixJsonPath ??
      "trace-bundle/component-cutover-matrix.json",
  };
}

export function requiredDocumentationStewardPathsForWave(waveNumber, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const out = [...laneProfile.sharedPlanDocs];
  const componentThreshold = laneProfile.validation.requireComponentPromotionsFromWave;
  if (componentThreshold !== null && waveNumber >= componentThreshold) {
    out.push(
      laneProfile?.paths?.componentCutoverMatrixDocPath,
      laneProfile?.paths?.componentCutoverMatrixJsonPath,
    );
  }
  return Array.from(new Set(out));
}

export function validateWaveDefinition(wave, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const lane = laneProfile.lane;
  const contQaAgentId = laneProfile.roles.contQaAgentId || DEFAULT_CONT_QA_AGENT_ID;
  const contEvalAgentId = laneProfile.roles.contEvalAgentId || DEFAULT_CONT_EVAL_AGENT_ID;
  const integrationAgentId =
    laneProfile.roles.integrationAgentId || DEFAULT_INTEGRATION_AGENT_ID;
  const documentationAgentId =
    laneProfile.roles.documentationAgentId || DEFAULT_DOCUMENTATION_AGENT_ID;
  const securityRolePromptPath = resolveSecurityRolePromptPath(laneProfile);
  const designRolePromptPath = resolveDesignRolePromptPath(laneProfile);
  const documentationThreshold = laneProfile.validation.requireDocumentationStewardFromWave;
  const context7Threshold = laneProfile.validation.requireContext7DeclarationsFromWave;
  const exitContractThreshold = laneProfile.validation.requireExitContractsFromWave;
  const integrationThreshold = laneProfile.validation.requireIntegrationStewardFromWave;
  const componentPromotionThreshold =
    laneProfile.validation.requireComponentPromotionsFromWave;
  const agentComponentsThreshold = laneProfile.validation.requireAgentComponentsFromWave;
  const componentPromotionRuleActive =
    componentPromotionThreshold !== null && wave.wave >= componentPromotionThreshold;
  const agentComponentsRuleActive =
    agentComponentsThreshold !== null && wave.wave >= agentComponentsThreshold;
  const integrationRuleActive =
    integrationThreshold !== null && wave.wave >= integrationThreshold;
  const errors = [];
  const promotedComponents = new Map(
    Array.isArray(wave.componentPromotions)
      ? wave.componentPromotions.map((promotion) => [promotion.componentId, promotion.targetLevel])
      : [],
  );
  const componentOwners = new Map(
    Array.from(promotedComponents.keys()).map((componentId) => [componentId, new Set()]),
  );
  let componentMatrix = null;
  if (componentPromotionRuleActive || promotedComponents.size > 0 || agentComponentsRuleActive) {
    try {
      componentMatrix = loadComponentCutoverMatrix({ laneProfile });
    } catch (error) {
      errors.push(error.message);
    }
  }
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
  const contEvalAgent = wave.agents.find((agent) => agent.agentId === contEvalAgentId) || null;
  const contEvalImplementationOwning = contEvalAgent
    ? isContEvalImplementationOwningAgent(contEvalAgent, { contEvalAgentId })
    : false;
  const implementationOwningAgents = wave.agents.filter((agent) =>
    isImplementationOwningWaveAgent(agent, {
      contQaAgentId,
      contEvalAgentId,
      integrationAgentId,
      documentationAgentId,
      designRolePromptPath,
      securityRolePromptPath,
    }),
  );
  if (!wave.agents.some((agent) => agent.agentId === contQaAgentId)) {
    errors.push(`must include Agent ${contQaAgentId} as the cont-QA closure role`);
  }
  if (
    componentPromotionRuleActive &&
    promotedComponents.size === 0 &&
    implementationOwningAgents.length > 0
  ) {
    errors.push(
      `Wave ${wave.wave} must declare a ## Component promotions section in waves ${componentPromotionThreshold} and later`,
    );
  }
  if (componentMatrix) {
    for (const [componentId, targetLevel] of promotedComponents.entries()) {
      const component = componentMatrix.components[componentId];
      if (!component) {
        errors.push(
          `Wave ${wave.wave} references unknown component "${componentId}" from ${componentMatrix.jsonPath}`,
        );
        continue;
      }
      if (!componentMatrix.levelSet.has(targetLevel)) {
        errors.push(
          `Wave ${wave.wave} uses invalid component level "${targetLevel}" for ${componentId}`,
        );
        continue;
      }
      const matrixPromotion = component.promotions.find((promotion) => promotion.wave === wave.wave);
      if (!matrixPromotion) {
        errors.push(
          `Component "${componentId}" is missing a wave ${wave.wave} promotion entry in ${componentMatrix.jsonPath}`,
        );
      } else if (matrixPromotion.target !== targetLevel) {
        errors.push(
          `Wave ${wave.wave} promotes ${componentId} to ${targetLevel}, but ${componentMatrix.jsonPath} declares ${matrixPromotion.target}`,
        );
      } else if (componentMatrix.levelOrder[targetLevel] < componentMatrix.levelOrder[component.currentLevel]) {
        errors.push(
          `Wave ${wave.wave} promotes ${componentId} to ${targetLevel}, but ${componentMatrix.jsonPath} already records currentLevel ${component.currentLevel}`,
        );
      }
    }
    const matrixWavePromotions = Object.entries(componentMatrix.components)
      .flatMap(([componentId, component]) =>
        component.promotions
          .filter((promotion) => promotion.wave === wave.wave)
          .map((promotion) => ({ componentId, targetLevel: promotion.target })),
      );
    for (const promotion of matrixWavePromotions) {
      if (promotedComponents.get(promotion.componentId) !== promotion.targetLevel) {
        errors.push(
          `Wave ${wave.wave} must declare component promotion ${promotion.componentId}: ${promotion.targetLevel} to match ${componentMatrix.jsonPath}`,
        );
      }
    }
  }
  for (const agent of wave.agents) {
    const docsOnlyDesignAgent = isDocsOnlyDesignAgent(agent, { designRolePromptPath });
    const implementationOwningDesignAgent = isImplementationOwningDesignAgent(agent, {
      designRolePromptPath,
    });
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
    if (
      [contQaAgentId, integrationAgentId, documentationAgentId].includes(agent.agentId) ||
      isContEvalReportOnlyAgent(agent, { contEvalAgentId }) ||
      docsOnlyDesignAgent ||
      isSecurityReviewAgent(agent, { securityRolePromptPath })
    ) {
      if (Array.isArray(agent.components) && agent.components.length > 0) {
        errors.push(`Agent ${agent.agentId} must not declare a ### Components section`);
      }
    } else {
      if (agentComponentsRuleActive && (!Array.isArray(agent.components) || agent.components.length === 0)) {
        errors.push(
          `Agent ${agent.agentId} must declare a ### Components section in waves ${agentComponentsThreshold} and later`,
        );
      }
      for (const componentId of agent.components || []) {
        if (componentMatrix && !componentMatrix.components[componentId]) {
          errors.push(
            `Agent ${agent.agentId} references unknown component "${componentId}" from ${componentMatrix.jsonPath}`,
          );
          continue;
        }
        if (!promotedComponents.has(componentId)) {
          errors.push(
            `Agent ${agent.agentId} declares component "${componentId}" that is not promoted in wave ${wave.wave}`,
          );
          continue;
        }
        componentOwners.get(componentId)?.add(agent.agentId);
      }
    }
    if (exitContractThreshold !== null && wave.wave >= exitContractThreshold) {
      if (
        ![contQaAgentId, integrationAgentId, documentationAgentId].includes(agent.agentId) &&
        !isContEvalReportOnlyAgent(agent, { contEvalAgentId }) &&
        !docsOnlyDesignAgent &&
        !isSecurityReviewAgent(agent, { securityRolePromptPath })
      ) {
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
    if (
      agentRequiresProofCentricValidation(agent) &&
      (!Array.isArray(agent.proofArtifacts) || agent.proofArtifacts.length === 0) &&
      ![contQaAgentId, integrationAgentId, documentationAgentId].includes(agent.agentId) &&
      !isContEvalReportOnlyAgent(agent, { contEvalAgentId }) &&
      !docsOnlyDesignAgent &&
      !isSecurityReviewAgent(agent, { securityRolePromptPath })
    ) {
      errors.push(
        `Agent ${agent.agentId} must declare a ### Proof artifacts section when it targets ${PROOF_CENTRIC_COMPONENT_LEVEL} or above`,
      );
    }
    if (
      agentRequiresProofCentricValidation(agent) &&
      (agent.executorConfig?.id === "local" || agent.executorResolved?.id === "local")
    ) {
      errors.push(
        `Agent ${agent.agentId} must not use executor=local when it carries proof-centric validation artifacts`,
      );
    }
  }
  for (const agent of wave.agents) {
    for (const requiredRef of laneProfile.validation.requiredPromptReferences || []) {
      if (!agent.prompt.includes(requiredRef)) {
        errors.push(`Agent ${agent.agentId} must reference ${requiredRef}`);
      }
    }
  }
  const contQaAgent = wave.agents.find((agent) => agent.agentId === contQaAgentId);
  if (!contQaAgent?.rolePromptPaths?.includes(laneProfile.roles.contQaRolePromptPath)) {
    errors.push(
      `Agent ${contQaAgentId} must import ${laneProfile.roles.contQaRolePromptPath}`,
    );
  }
  if (!resolveContQaReportPath(wave, { contQaAgentId })) {
    errors.push(`Agent ${contQaAgentId} must own a cont-QA report path`);
  }
  if (contEvalAgent) {
    if (!contEvalAgent.rolePromptPaths?.includes(laneProfile.roles.contEvalRolePromptPath)) {
      errors.push(
        `Agent ${contEvalAgentId} must import ${laneProfile.roles.contEvalRolePromptPath}`,
      );
    }
    if (!resolveContEvalReportPath(wave, { contEvalAgentId })) {
      errors.push(`Agent ${contEvalAgentId} must own a cont-EVAL report path`);
    }
    if (!Array.isArray(wave.evalTargets) || wave.evalTargets.length === 0) {
      errors.push(`Wave ${wave.wave} must declare a ## Eval targets section when ${contEvalAgentId} is present`);
    } else {
      try {
        validateEvalTargets(wave.evalTargets, {
          benchmarkCatalogPath: laneProfile.paths.benchmarkCatalogPath,
        });
      } catch (error) {
        errors.push(error.message);
      }
    }
  } else if (Array.isArray(wave.evalTargets) && wave.evalTargets.length > 0) {
    errors.push(`Wave ${wave.wave} declares ## Eval targets but does not include Agent ${contEvalAgentId}`);
  }
  const securityReviewers = wave.agents.filter((agent) =>
    isSecurityReviewAgent(agent, { securityRolePromptPath }),
  );
  for (const securityReviewer of securityReviewers) {
    if (!securityReviewer.rolePromptPaths?.includes(securityRolePromptPath)) {
      errors.push(
        `Security reviewer ${securityReviewer.agentId} must import ${securityRolePromptPath}`,
      );
    }
    if (!resolveSecurityReviewReportPath(securityReviewer)) {
      errors.push(`Security reviewer ${securityReviewer.agentId} must own a security review report path`);
    }
  }
  const designAgents = wave.agents.filter((agent) =>
    isDesignAgent(agent, { designRolePromptPath }),
  );
  for (const designAgent of designAgents) {
    const hybridDesignAgent = isImplementationOwningDesignAgent(designAgent, {
      designRolePromptPath,
    });
    if (!designAgent.rolePromptPaths?.includes(designRolePromptPath)) {
      errors.push(
        `Design agent ${designAgent.agentId} must import ${designRolePromptPath}`,
      );
    }
    if (!resolveDesignReportPath(designAgent)) {
      errors.push(`Design agent ${designAgent.agentId} must own a design packet path`);
    }
    if (
      !hybridDesignAgent &&
      Array.isArray(designAgent.components) &&
      designAgent.components.length > 0
    ) {
      errors.push(`Design agent ${designAgent.agentId} must stay docs/spec-only unless it explicitly owns implementation files`);
    }
  }
  const closureRoleBindings = resolveWaveRoleBindings(wave, laneProfile.roles, wave.agents);
  for (const agent of wave.agents) {
    const closureRoles = resolveAgentClosureRoleKeys(
      agent,
      closureRoleBindings,
      laneProfile.roles,
    );
    if (closureRoles.length > 1) {
      errors.push(
        `Agent ${agent.agentId} must not overlap closure roles (${closureRoles.map((role) => CLOSURE_ROLE_LABELS[role] || role).join(", ")})`,
      );
    }
  }
  if (integrationRuleActive) {
    const integrationStewards = wave.agents.filter((agent) =>
      agent.rolePromptPaths?.includes(laneProfile.roles.integrationRolePromptPath),
    );
    if (integrationStewards.length !== 1) {
      errors.push(
        `Wave ${wave.wave} must include exactly one integration steward importing ${laneProfile.roles.integrationRolePromptPath}`,
      );
    }
  }
  const documentationRuleActive =
    (documentationThreshold !== null && wave.wave >= documentationThreshold) ||
    componentPromotionRuleActive;
  if (documentationRuleActive) {
    const documentationStewards = wave.agents.filter((agent) =>
      agent.rolePromptPaths?.includes(laneProfile.roles.documentationRolePromptPath),
    );
    if (documentationStewards.length !== 1) {
      errors.push(
        `Wave ${wave.wave} must include exactly one documentation steward importing ${laneProfile.roles.documentationRolePromptPath}`,
      );
    } else {
      const documentationSteward = documentationStewards[0];
      const requiredDocPaths = requiredDocumentationStewardPathsForWave(wave.wave, { laneProfile });
      const missingSharedPlanDocs = requiredDocPaths.filter(
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
          agent.ownedPaths.some((ownedPath) => requiredDocPaths.includes(ownedPath)),
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
  const runtimeMixValidation = validateWaveRuntimeMixAssignments(wave, { laneProfile });
  if (!runtimeMixValidation.ok) {
    errors.push(
      `Wave ${wave.wave} exceeds lane runtime mix targets (${runtimeMixValidation.detail})`,
    );
  }
  for (const [componentId, owners] of componentOwners.entries()) {
    if (owners.size === 0) {
      const requiredOwnerIds = [
        contQaAgentId,
        ...(contEvalImplementationOwning ? [] : [contEvalAgentId]),
        documentationAgentId,
      ];
      errors.push(
        `Wave ${wave.wave} must assign promoted component "${componentId}" to at least one non-${requiredOwnerIds.join("/")} agent`,
      );
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid wave ${wave.wave} (${wave.file}): ${errors.join("; ")}`);
  }
  return wave;
}

export function parseWaveContent(content, filePath, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const securityRolePromptPath = resolveSecurityRolePromptPath(laneProfile);
  const designRolePromptPath = resolveDesignRolePromptPath(laneProfile);
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
    const components = extractAgentComponentsFromSection(sectionText, filePath, current.agentId);
    const capabilities = normalizeSecurityCapabilities(
      normalizeDesignCapabilities(
        extractAgentCapabilitiesFromSection(sectionText, filePath, current.agentId),
        rolePromptPaths,
        designRolePromptPath,
      ),
      rolePromptPaths,
      securityRolePromptPath,
    );
    const skills = extractAgentSkillsFromSection(sectionText, filePath, current.agentId);
    const deliverables = extractAgentDeliverablesFromSection(
      sectionText,
      filePath,
      current.agentId,
    );
    const proofArtifacts = extractAgentProofArtifactsFromSection(
      sectionText,
      filePath,
      current.agentId,
    );
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
    validateAgentDeliverables(deliverables, ownedPaths, filePath, current.agentId);
    validateAgentProofArtifacts(proofArtifacts, ownedPaths, filePath, current.agentId);
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
      components,
      capabilities,
      skills,
      deliverables,
      proofArtifacts,
      ownedPaths,
    });
  }

  const componentPromotions = extractWaveComponentPromotions(content, filePath);
  const componentTargetById = Object.fromEntries(
    componentPromotions.map((promotion) => [promotion.componentId, promotion.targetLevel]),
  );
  const agentsWithComponentTargets = agents.map((agent) => ({
    ...agent,
    componentTargets: Object.fromEntries(
      (agent.components || []).map((componentId) => [componentId, componentTargetById[componentId] || null]),
    ),
  }));

  return {
    wave: waveNumber,
    file: path.relative(REPO_ROOT, filePath),
    commitMessage: commitMessageMatch ? commitMessageMatch[1] : null,
    deployEnvironments: parseDeployEnvironments(
      extractTopLevelSectionBody(content, "Deploy environments", filePath, {
        required: false,
      }),
      filePath,
    ),
    evalTargets: parseEvalTargets(
      extractTopLevelSectionBody(content, "Eval targets", filePath, {
        required: false,
      }),
      filePath,
    ),
    context7Defaults: extractWaveContext7Defaults(content, filePath),
    componentPromotions,
    agents: agentsWithComponentTargets,
    contQaReportPath: resolveContQaReportPath(
      { agents: agentsWithComponentTargets },
      { contQaAgentId: laneProfile.roles.contQaAgentId },
    ),
    contEvalReportPath: resolveContEvalReportPath(
      { agents: agentsWithComponentTargets },
      { contEvalAgentId: laneProfile.roles.contEvalAgentId },
    ),
  };
}

function cloneExecutorValue(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function mergeUniqueStringArrays(...lists) {
  return Array.from(
    new Set(
      lists.flatMap((list) => (Array.isArray(list) ? list.map((entry) => String(entry || "").trim()) : []))
        .filter(Boolean),
    ),
  );
}

function mergeDefinedExecutorValues(...sections) {
  const merged = {};
  for (const section of sections) {
    if (!section || typeof section !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(section)) {
      if (value === null || value === undefined) {
        continue;
      }
      merged[key] = cloneExecutorValue(value);
    }
  }
  return merged;
}

function mergeExecutorSections(baseSection, profileSection, inlineSection, arrayKeys = []) {
  const merged = mergeDefinedExecutorValues(baseSection, profileSection, inlineSection);
  for (const key of arrayKeys) {
    const mergedArray = mergeUniqueStringArrays(
      baseSection?.[key],
      profileSection?.[key],
      inlineSection?.[key],
    );
    if (mergedArray.length > 0) {
      merged[key] = mergedArray;
    }
  }
  return merged;
}

function inferAgentRuntimeRole(agent, laneProfile) {
  if (agent?.agentId === laneProfile.roles.contQaAgentId) {
    return "cont-qa";
  }
  if (agent?.agentId === laneProfile.roles.contEvalAgentId) {
    return "cont-eval";
  }
  if (agent?.agentId === laneProfile.roles.integrationAgentId) {
    return "integration";
  }
  if (agent?.agentId === laneProfile.roles.documentationAgentId) {
    return "documentation";
  }
  if (
    isDesignAgent(agent, {
      designRolePromptPath: laneProfile?.roles?.designRolePromptPath,
    })
  ) {
    return "design";
  }
  if (isSecurityReviewAgent(agent, {
    securityRolePromptPath: laneProfile?.roles?.securityRolePromptPath,
  })) {
    return "security";
  }
  const capabilities = Array.isArray(agent?.capabilities)
    ? agent.capabilities.map((entry) => String(entry || "").trim().toLowerCase())
    : [];
  const title = String(agent?.title || "").trim().toLowerCase();
  if (capabilities.some((capability) => capability.startsWith("infra")) || /\binfra\b/.test(title)) {
    return "infra";
  }
  if (capabilities.some((capability) => capability.startsWith("deploy")) || /\bdeploy\b/.test(title)) {
    return "deploy";
  }
  if (capabilities.some((capability) => capability.startsWith("research")) || /\bresearch\b/.test(title)) {
    return "research";
  }
  return "implementation";
}

export function validateWaveRuntimeMixAssignments(wave, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const targets = laneProfile.runtimePolicy?.runtimeMixTargets || {};
  if (Object.keys(targets).length === 0) {
    return {
      ok: true,
      statusCode: "pass",
      detail: "No runtime mix targets configured.",
      counts: {},
      targets,
    };
  }
  const counts = {};
  for (const agent of wave.agents || []) {
    const executorId =
      agent?.executorResolved?.id ||
      options.executorMode ||
      laneProfile.executors.default;
    counts[executorId] = (counts[executorId] || 0) + 1;
  }
  const violations = Object.entries(counts).filter(
    ([executorId, count]) =>
      Number.isFinite(targets[executorId]) && count > Number(targets[executorId]),
  );
  if (violations.length > 0) {
    return {
      ok: false,
      statusCode: "runtime-mix-exceeded",
      detail: violations
        .map(
          ([executorId, count]) =>
            `${executorId}=${count} exceeds target ${targets[executorId]}`,
        )
        .join("; "),
      counts,
      targets,
    };
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: "Runtime mix assignments are within configured targets.",
    counts,
    targets,
  };
}

export function resolveAgentExecutor(agent, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const executorConfig = agent?.executorConfig || null;
  const role = inferAgentRuntimeRole(agent, laneProfile);
  const proofCentricAgent =
    agentRequiresProofCentricValidation(agent) || waveRequiresProofCentricValidation(options.wave);
  const profileName = executorConfig?.profile || null;
  if (profileName && !laneProfile.executors.profiles?.[profileName]) {
    throw new Error(
      `Agent ${agent?.agentId || "unknown"} references unknown executor profile "${profileName}"`,
    );
  }
  const profile =
    profileName && laneProfile.executors.profiles?.[profileName]
      ? laneProfile.executors.profiles[profileName]
      : null;
  const selectedBy = executorConfig?.id
    ? "agent-id"
    : profile?.id
      ? "agent-profile"
      : laneProfile.runtimePolicy?.defaultExecutorByRole?.[role]
        ? "lane-role-default"
        : options.executorMode
          ? "cli-default"
          : "lane-default";
  const executorId = normalizeExecutorMode(
    executorConfig?.id ||
      profile?.id ||
      laneProfile.runtimePolicy?.defaultExecutorByRole?.[role] ||
      options.executorMode ||
      laneProfile.executors.default,
    `agent ${agent?.agentId || "unknown"} executor`,
  );
  const resolvedModel =
    executorConfig?.model ||
    profile?.model ||
    (executorId === "claude"
      ? laneProfile.executors.claude.model
      : executorId === "opencode"
        ? laneProfile.executors.opencode.model
        : null);
  const fallbacks = mergeUniqueStringArrays(
    profile?.fallbacks,
    executorConfig?.fallbacks,
  );
  const explicitAllowFallback =
    executorConfig?.allowFallbackOnRetry ??
    profile?.allowFallbackOnRetry ??
    null;
  const explicitRetryPolicy =
    executorConfig?.retryPolicy ||
    profile?.retryPolicy ||
    null;
  const allowFallbackOnRetry =
    explicitAllowFallback !== null
      ? explicitAllowFallback
      : explicitRetryPolicy
        ? explicitRetryPolicy !== "sticky"
        : !proofCentricAgent;
  const retryPolicy =
    explicitRetryPolicy ||
    (allowFallbackOnRetry ? "fallback-allowed" : "sticky");
  const runtimeFallbacks =
    allowFallbackOnRetry && fallbacks.length > 0
      ? fallbacks
      : allowFallbackOnRetry
        ? (laneProfile.runtimePolicy?.fallbackExecutorOrder || []).filter(
          (candidate) => candidate !== executorId,
        )
        : [];
  const runtimeTags = mergeUniqueStringArrays(profile?.tags, executorConfig?.tags);
  const runtimeBudget = {
    turns:
      executorConfig?.budget?.turns ??
      profile?.budget?.turns ??
      null,
    minutes:
      executorConfig?.budget?.minutes ??
      profile?.budget?.minutes ??
      null,
  };
  const claudeMaxTurnsSource =
    executorConfig?.claude?.maxTurns !== null && executorConfig?.claude?.maxTurns !== undefined
      ? "claude.maxTurns"
      : profile?.claude?.maxTurns !== null && profile?.claude?.maxTurns !== undefined
        ? "claude.maxTurns"
        : laneProfile.executors.claude.maxTurns !== null &&
            laneProfile.executors.claude.maxTurns !== undefined
          ? "claude.maxTurns"
          : null;
  const opencodeStepsSource =
    executorConfig?.opencode?.steps !== null && executorConfig?.opencode?.steps !== undefined
      ? "opencode.steps"
      : profile?.opencode?.steps !== null && profile?.opencode?.steps !== undefined
        ? "opencode.steps"
        : laneProfile.executors.opencode.steps !== null &&
            laneProfile.executors.opencode.steps !== undefined
          ? "opencode.steps"
          : null;
  return {
    id: executorId,
    initialExecutorId: executorId,
    model: resolvedModel || null,
    role,
    profile: profileName,
    selectedBy,
    fallbacks: runtimeFallbacks,
    tags: runtimeTags,
    retryPolicy,
    allowFallbackOnRetry,
    budget:
      runtimeBudget.turns !== null || runtimeBudget.minutes !== null ? runtimeBudget : null,
    fallbackUsed: false,
    fallbackReason: null,
    executorHistory: [{ attempt: 0, executorId, reason: "initial" }],
    codex: {
      ...mergeExecutorSections(
        laneProfile.executors.codex,
        profile?.codex,
        executorConfig?.codex,
        ["config", "images", "addDirs"],
      ),
      command:
        executorConfig?.codex?.command ||
        profile?.codex?.command ||
        laneProfile.executors.codex.command,
      sandbox:
        executorConfig?.codex?.sandbox ||
        profile?.codex?.sandbox ||
        (executorId === "codex"
          ? normalizeCodexSandboxMode(
              options.codexSandboxMode ?? laneProfile.executors.codex.sandbox ?? DEFAULT_CODEX_SANDBOX_MODE,
              "executor.codex.sandbox",
            )
          : laneProfile.executors.codex.sandbox || DEFAULT_CODEX_SANDBOX_MODE),
      profileName:
        executorConfig?.codex?.profileName ||
        profile?.codex?.profileName ||
        laneProfile.executors.codex.profileName,
      config: mergeUniqueStringArrays(
        laneProfile.executors.codex.config,
        profile?.codex?.config,
        executorConfig?.codex?.config,
      ),
      search:
        executorConfig?.codex?.search ??
        profile?.codex?.search ??
        laneProfile.executors.codex.search,
      images: mergeUniqueStringArrays(
        laneProfile.executors.codex.images,
        profile?.codex?.images,
        executorConfig?.codex?.images,
      ),
      addDirs: mergeUniqueStringArrays(
        laneProfile.executors.codex.addDirs,
        profile?.codex?.addDirs,
        executorConfig?.codex?.addDirs,
      ),
      json:
        executorConfig?.codex?.json ??
        profile?.codex?.json ??
        laneProfile.executors.codex.json,
      ephemeral:
        executorConfig?.codex?.ephemeral ??
        profile?.codex?.ephemeral ??
        laneProfile.executors.codex.ephemeral,
    },
    claude: {
      ...mergeExecutorSections(
        laneProfile.executors.claude,
        profile?.claude,
        executorConfig?.claude,
        ["mcpConfig", "allowedTools", "disallowedTools", "allowedHttpHookUrls"],
      ),
      model:
        executorId === "claude"
          ? resolvedModel || laneProfile.executors.claude.model
          : laneProfile.executors.claude.model,
      maxTurns:
        executorConfig?.claude?.maxTurns ??
        profile?.claude?.maxTurns ??
        laneProfile.executors.claude.maxTurns,
      maxTurnsSource: claudeMaxTurnsSource,
    },
    opencode: {
      ...mergeExecutorSections(
        laneProfile.executors.opencode,
        profile?.opencode,
        executorConfig?.opencode,
        ["instructions", "files"],
      ),
      model:
        executorId === "opencode"
          ? resolvedModel || laneProfile.executors.opencode.model
          : laneProfile.executors.opencode.model,
      steps:
        executorConfig?.opencode?.steps ??
        profile?.opencode?.steps ??
        laneProfile.executors.opencode.steps,
      stepsSource: opencodeStepsSource,
    },
  };
}

export function applyExecutorSelectionsToWave(wave, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const withExecutors = {
    ...wave,
    agents: wave.agents.map((agent) => ({
      ...agent,
      executorResolved: resolveAgentExecutor(agent, { ...options, laneProfile }),
    })),
  };
  return {
    ...withExecutors,
    agents: withExecutors.agents.map((agent) => ({
      ...agent,
      skillsResolved: resolveAgentSkills(agent, withExecutors, { laneProfile }),
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

  return normalizeManifest({
    generatedAt: new Date().toISOString(),
    source: `${path.relative(REPO_ROOT, lanePaths.docsDir).replaceAll(path.sep, "/")}/**/*`,
    waves,
    docs,
  });
}

export function validateWaveComponentPromotions(wave, summariesByAgentId = {}, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const componentThreshold = laneProfile.validation.requireComponentPromotionsFromWave;
  if (componentThreshold === null || wave.wave < componentThreshold) {
    return {
      ok: true,
      statusCode: "pass",
      detail: "Component promotion gate is not active for this wave.",
      componentId: null,
    };
  }
  const promotions = Array.isArray(wave.componentPromotions) ? wave.componentPromotions : [];
  const roles = laneProfile.roles || {};
  const contQaAgentId = roles.contQaAgentId || DEFAULT_CONT_QA_AGENT_ID;
  const contEvalAgentId = roles.contEvalAgentId || DEFAULT_CONT_EVAL_AGENT_ID;
  const integrationAgentId = roles.integrationAgentId || DEFAULT_INTEGRATION_AGENT_ID;
  const documentationAgentId =
    roles.documentationAgentId || DEFAULT_DOCUMENTATION_AGENT_ID;
  const securityRolePromptPath = resolveSecurityRolePromptPath(laneProfile);
  const designRolePromptPath = resolveDesignRolePromptPath(laneProfile);
  const implementationOwningAgents = (wave.agents || []).filter((agent) =>
    isImplementationOwningWaveAgent(agent, {
      contQaAgentId,
      contEvalAgentId,
      integrationAgentId,
      documentationAgentId,
      designRolePromptPath,
      securityRolePromptPath,
    }),
  );
  if (promotions.length === 0) {
    return {
      ok: implementationOwningAgents.length === 0,
      statusCode:
        implementationOwningAgents.length === 0 ? "pass" : "missing-component-promotions",
      detail:
        implementationOwningAgents.length === 0
          ? `Wave ${wave.wave} has no implementation-owned component promotions to prove.`
          : `Wave ${wave.wave} is missing component promotions.`,
      componentId: null,
    };
  }
  const satisfied = new Set();
  for (const agent of wave.agents) {
    if (!isImplementationOwningWaveAgent(agent, {
      contQaAgentId,
      contEvalAgentId,
      integrationAgentId,
      documentationAgentId,
      designRolePromptPath,
      securityRolePromptPath,
    })) {
      continue;
    }
    const summary = summariesByAgentId[agent.agentId] || null;
    const markers = new Map(
      Array.isArray(summary?.components)
        ? summary.components.map((component) => [component.componentId, component])
        : [],
    );
    for (const componentId of agent.components || []) {
      const expectedLevel = agent.componentTargets?.[componentId] || null;
      const marker = markers.get(componentId);
      if (marker && marker.state === "met" && (!expectedLevel || marker.level === expectedLevel)) {
        satisfied.add(componentId);
      }
    }
  }
  for (const promotion of promotions) {
    if (!satisfied.has(promotion.componentId)) {
      return {
        ok: false,
        statusCode: "component-promotion-gap",
        detail: `Wave ${wave.wave} does not yet prove component ${promotion.componentId} at ${promotion.targetLevel}.`,
        componentId: promotion.componentId,
      };
    }
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: "All promoted components are proven at the declared level.",
    componentId: null,
  };
}

export function validateWaveComponentMatrixCurrentLevels(wave, options = {}) {
  const laneProfile = resolveLaneProfileForOptions(options);
  const componentThreshold = laneProfile.validation.requireComponentPromotionsFromWave;
  const promotions = Array.isArray(wave.componentPromotions) ? wave.componentPromotions : [];
  const roles = laneProfile.roles || {};
  const contQaAgentId = roles.contQaAgentId || DEFAULT_CONT_QA_AGENT_ID;
  const contEvalAgentId = roles.contEvalAgentId || DEFAULT_CONT_EVAL_AGENT_ID;
  const integrationAgentId = roles.integrationAgentId || DEFAULT_INTEGRATION_AGENT_ID;
  const documentationAgentId = roles.documentationAgentId || DEFAULT_DOCUMENTATION_AGENT_ID;
  const securityRolePromptPath = resolveSecurityRolePromptPath(laneProfile);
  const designRolePromptPath = resolveDesignRolePromptPath(laneProfile);
  const implementationOwningAgents = (wave.agents || []).filter((agent) =>
    isImplementationOwningWaveAgent(agent, {
      contQaAgentId,
      contEvalAgentId,
      integrationAgentId,
      documentationAgentId,
      designRolePromptPath,
      securityRolePromptPath,
    }),
  );
  if (promotions.length === 0) {
    return {
      ok: true,
      statusCode: "pass",
      detail:
        implementationOwningAgents.length === 0
          ? `Wave ${wave.wave} has no implementation-owned component promotions to reconcile.`
          : componentThreshold === null || wave.wave < componentThreshold
            ? "Component current-level gate is not active for this wave."
            : `Wave ${wave.wave} declares no promoted components to reconcile against the component matrix.`,
      componentId: null,
    };
  }

  const componentMatrix = loadComponentCutoverMatrix({
    laneProfile,
    componentMatrixPayload: options.componentMatrixPayload,
    componentMatrixJsonPath: options.componentMatrixJsonPath,
  });
  for (const promotion of promotions) {
    const component = componentMatrix.components[promotion.componentId];
    if (!component) {
      return {
        ok: false,
        statusCode: "unknown-component",
        detail: `Wave ${wave.wave} references unknown component ${promotion.componentId}.`,
        componentId: promotion.componentId,
      };
    }
    if (component.currentLevel !== promotion.targetLevel) {
      return {
        ok: false,
        statusCode: "component-current-level-stale",
        detail: `Component ${promotion.componentId} is still recorded at ${component.currentLevel} in ${componentMatrix.jsonPath}; expected ${promotion.targetLevel}.`,
        componentId: promotion.componentId,
      };
    }
  }

  return {
    ok: true,
    statusCode: "pass",
    detail: "Component matrix current levels match the promoted targets.",
    componentId: null,
  };
}

export function writeManifest(manifestPath, manifest) {
  writeJsonAtomic(manifestPath, normalizeManifest(manifest));
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

function fileHashOrNull(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return hashText(fs.readFileSync(filePath, "utf8"));
}

function relativeRepoPathOrNull(filePath) {
  return filePath ? path.relative(REPO_ROOT, filePath) : null;
}

const RUN_STATE_COMPLETED_VALUES = new Set(["completed", "completed_with_drift"]);
const PROMPT_DRIFT_REASON_CODES = new Set(["prompt-hash-mismatch", "prompt-hash-missing"]);

function isCompletedRunStateValue(value) {
  return RUN_STATE_COMPLETED_VALUES.has(String(value || "").trim().toLowerCase());
}

function completedRunStateEntries(waves) {
  return Object.values(waves || {}).filter((entry) => isCompletedRunStateValue(entry?.currentState));
}

function normalizeRunStateWaveEntry(rawEntry, waveNumber) {
  const source = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? rawEntry : {};
  const normalizedWave = normalizeCompletedWaves([waveNumber])[0] ?? normalizeCompletedWaves([source.wave])[0] ?? null;
  return {
    wave: normalizedWave,
    currentState: String(source.currentState || "completed").trim().toLowerCase() || "completed",
    lastTransitionAt:
      typeof source.lastTransitionAt === "string"
        ? source.lastTransitionAt
        : typeof source.updatedAt === "string"
          ? source.updatedAt
          : typeof source.completedAt === "string"
            ? source.completedAt
            : null,
    lastSource: typeof source.lastSource === "string" ? source.lastSource : null,
    lastReasonCode: typeof source.lastReasonCode === "string" ? source.lastReasonCode : null,
    lastDetail: typeof source.lastDetail === "string" ? source.lastDetail : "",
    lastEvidence:
      source.lastEvidence && typeof source.lastEvidence === "object" && !Array.isArray(source.lastEvidence)
        ? source.lastEvidence
        : null,
  };
}

function normalizeRunStateHistoryEntry(rawEntry, seqFallback) {
  const source = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? rawEntry : {};
  return {
    seq: normalizeCompletedWaves([source.seq])[0] ?? seqFallback,
    at: typeof source.at === "string" ? source.at : toIsoTimestamp(),
    wave: normalizeCompletedWaves([source.wave])[0] ?? null,
    fromState: typeof source.fromState === "string" ? source.fromState : null,
    toState: typeof source.toState === "string" ? source.toState : null,
    source: typeof source.source === "string" ? source.source : null,
    reasonCode: typeof source.reasonCode === "string" ? source.reasonCode : null,
    detail: typeof source.detail === "string" ? source.detail : "",
    evidence:
      source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence)
        ? source.evidence
        : null,
  };
}

function completedWavesFromStateEntries(waves) {
  return normalizeCompletedWaves(
    completedRunStateEntries(waves).map((entry) => entry.wave),
  );
}

function normalizeRunStateWaves(rawWaves, completedWaves, lastUpdatedAt) {
  const normalized = {};
  for (const waveNumber of completedWaves) {
    normalized[String(waveNumber)] = {
      wave: waveNumber,
      currentState: "completed",
      lastTransitionAt: lastUpdatedAt,
      lastSource: "legacy-run-state",
      lastReasonCode: "legacy-completed-wave",
      lastDetail: "Imported from legacy completedWaves state.",
      lastEvidence: null,
    };
  }
  if (!rawWaves || typeof rawWaves !== "object" || Array.isArray(rawWaves)) {
    return normalized;
  }
  for (const [waveKey, rawEntry] of Object.entries(rawWaves)) {
    const waveNumber = normalizeCompletedWaves([waveKey])[0];
    if (waveNumber === undefined) {
      continue;
    }
    normalized[String(waveNumber)] = normalizeRunStateWaveEntry(rawEntry, waveNumber);
  }
  return normalized;
}

function normalizeRunStateInternal(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const completedWaves = normalizeCompletedWaves(source.completedWaves);
  const lastUpdatedAt = typeof source.lastUpdatedAt === "string" ? source.lastUpdatedAt : undefined;
  const waves = normalizeRunStateWaves(source.waves, completedWaves, lastUpdatedAt);
  const history = Array.isArray(source.history)
    ? source.history
        .map((entry, index) => normalizeRunStateHistoryEntry(entry, index + 1))
        .filter((entry) => Number.isFinite(entry.seq) && entry.wave !== null)
    : [];
  return {
    schemaVersion: RUN_STATE_SCHEMA_VERSION,
    kind: RUN_STATE_KIND,
    completedWaves: completedWavesFromStateEntries(waves),
    lastUpdatedAt,
    waves,
    history,
  };
}

export function readRunState(runStatePath) {
  return normalizeRunStateInternal(readJsonOrNull(runStatePath));
}

export function writeRunState(runStatePath, state) {
  ensureDirectory(path.dirname(runStatePath));
  const normalized = normalizeRunStateInternal(state);
  const payload = {
    ...normalized,
    completedWaves: completedWavesFromStateEntries(normalized.waves),
    lastUpdatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(runStatePath, payload);
  return payload;
}

function nextRunStateSequence(history) {
  return (history || []).reduce((max, entry) => Math.max(max, Number(entry?.seq) || 0), 0) + 1;
}

function appendRunStateTransition(state, {
  waveNumber,
  toState,
  source,
  reasonCode,
  detail,
  evidence = null,
  at = toIsoTimestamp(),
}) {
  const nextState = normalizeRunStateInternal(state);
  const waveKey = String(waveNumber);
  const previousEntry = nextState.waves[waveKey] || null;
  const currentState = previousEntry?.currentState || null;
  const currentEvidence = previousEntry?.lastEvidence || null;
  const effectiveDetail = String(detail || "").trim();
  const effectiveEvidence =
    evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : null;
  if (
    previousEntry &&
    currentState === toState &&
    previousEntry.lastSource === source &&
    previousEntry.lastReasonCode === reasonCode &&
    previousEntry.lastDetail === effectiveDetail &&
    JSON.stringify(currentEvidence || null) === JSON.stringify(effectiveEvidence || null)
  ) {
    return nextState;
  }
  const historyEntry = {
    seq: nextRunStateSequence(nextState.history),
    at,
    wave: waveNumber,
    fromState: currentState,
    toState,
    source,
    reasonCode,
    detail: effectiveDetail,
    evidence: effectiveEvidence,
  };
  nextState.waves[waveKey] = {
    wave: waveNumber,
    currentState: toState,
    lastTransitionAt: at,
    lastSource: source,
    lastReasonCode: reasonCode,
    lastDetail: effectiveDetail,
    lastEvidence: effectiveEvidence,
  };
  nextState.history = [...nextState.history, historyEntry];
  nextState.completedWaves = completedWavesFromStateEntries(nextState.waves);
  return nextState;
}

export function buildRunStateEvidence({
  wave,
  agentRuns = [],
  statusEntries = [],
  coordinationLogPath = null,
  assignmentsPath = null,
  dependencySnapshotPath = null,
  gateSnapshot = null,
  traceDir = null,
  blockedReasons = [],
}) {
  const observations =
    statusEntries.length > 0
      ? statusEntries
      : agentRuns.map((run) => ({
          agentId: run.agent?.agentId || null,
          statusPath: run.statusPath,
          summaryPath: agentSummaryPathFromStatusPath(run.statusPath),
          statusRecord: readStatusRecordIfPresent(run.statusPath),
        }));
  return {
    waveFileHash: wave?.file ? fileHashOrNull(path.resolve(REPO_ROOT, wave.file)) : null,
    traceDir: relativeRepoPathOrNull(traceDir),
    statusFiles: observations
      .filter((entry) => entry?.statusPath)
      .map((entry) => ({
        agentId: entry.agentId || null,
        path: relativeRepoPathOrNull(entry.statusPath),
        promptHash: entry.statusRecord?.promptHash || null,
        code:
          entry.statusRecord && Number.isFinite(Number(entry.statusRecord.code))
            ? Number(entry.statusRecord.code)
            : null,
        completedAt: entry.statusRecord?.completedAt || null,
        sha256: fileHashOrNull(entry.statusPath),
      })),
    summaryFiles: observations
      .filter((entry) => entry?.summaryPath && fs.existsSync(entry.summaryPath))
      .map((entry) => ({
        agentId: entry.agentId || null,
        path: relativeRepoPathOrNull(entry.summaryPath),
        sha256: fileHashOrNull(entry.summaryPath),
      })),
    coordinationLogSha256: fileHashOrNull(coordinationLogPath),
    assignmentsSha256: fileHashOrNull(assignmentsPath),
    dependencySnapshotSha256: fileHashOrNull(dependencySnapshotPath),
    gateSnapshotSha256: gateSnapshot ? hashText(JSON.stringify(gateSnapshot)) : null,
    blockedReasons: Array.isArray(blockedReasons)
      ? blockedReasons.map((reason) => ({
          code: String(reason?.code || "").trim(),
          detail: String(reason?.detail || "").trim(),
        }))
      : [],
  };
}

export function markWaveCompleted(runStatePath, waveNumber, options = {}) {
  const state = readRunState(runStatePath);
  const nextState = appendRunStateTransition(state, {
    waveNumber,
    toState: "completed",
    source: options.source || "live-launcher",
    reasonCode: options.reasonCode || "wave-complete",
    detail: options.detail || `Wave ${waveNumber} completed.`,
    evidence: options.evidence || null,
    at: options.at || toIsoTimestamp(),
  });
  return writeRunState(runStatePath, nextState);
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

export function readWaveContQaArtifacts(wave, { logsDir, contQaAgentId } = {}) {
  const resolvedContQaAgentId = contQaAgentId || DEFAULT_CONT_QA_AGENT_ID;
  const contQa = wave.agents.find((agent) => agent.agentId === resolvedContQaAgentId) ?? null;
  if (!contQa) {
    return {
      ok: false,
      statusCode: "missing-cont-qa",
      detail: `Agent ${resolvedContQaAgentId} is missing.`,
    };
  }
  const contQaReportPath = wave.contQaReportPath
    ? path.resolve(REPO_ROOT, wave.contQaReportPath)
    : null;
  const reportText =
    contQaReportPath && fs.existsSync(contQaReportPath)
      ? fs.readFileSync(contQaReportPath, "utf8")
      : "";
  const reportVerdict = parseVerdictFromText(reportText, REPORT_VERDICT_REGEX);
  if (reportVerdict.verdict) {
    return {
      ok: reportVerdict.verdict === "pass",
      statusCode: reportVerdict.verdict === "pass" ? "pass" : `cont-qa-${reportVerdict.verdict}`,
      detail: reportVerdict.detail || "Verdict read from cont-QA report.",
    };
  }
  const contQaLogPath = logsDir
    ? path.join(logsDir, `wave-${wave.wave}-${contQa.slug}.log`)
    : null;
  const logVerdict = parseVerdictFromText(
    contQaLogPath ? readFileTail(contQaLogPath, 30000) : "",
    WAVE_VERDICT_REGEX,
  );
  if (logVerdict.verdict) {
    return {
      ok: logVerdict.verdict === "pass",
      statusCode: logVerdict.verdict === "pass" ? "pass" : `cont-qa-${logVerdict.verdict}`,
      detail: logVerdict.detail || "Verdict read from cont-QA log marker.",
    };
  }
  return {
    ok: false,
    statusCode: "missing-cont-qa-verdict",
    detail: contQaReportPath
      ? `Missing cont-QA verdict in ${path.relative(REPO_ROOT, contQaReportPath)}.`
      : "Missing cont-QA report path and cont-QA log verdict.",
  };
}

function pushWaveCompletionReason(reasons, code, detail) {
  const normalizedCode = String(code || "").trim();
  const normalizedDetail = String(detail || "").trim();
  if (!normalizedCode || !normalizedDetail) {
    return;
  }
  if (
    reasons.some((reason) => reason.code === normalizedCode && reason.detail === normalizedDetail)
  ) {
    return;
  }
  reasons.push({ code: normalizedCode, detail: normalizedDetail });
}

function promptDriftReasonForStatus(agent, statusPath, statusRecord, expectedPromptHash) {
  const actualPromptHash = String(statusRecord?.promptHash || "").trim();
  if (!actualPromptHash) {
    return {
      code: "prompt-hash-missing",
      detail: `${agent.agentId} status in ${path.relative(REPO_ROOT, statusPath)} is missing prompt-hash metadata required to match the current prompt fingerprint.`,
    };
  }
  if (actualPromptHash !== expectedPromptHash) {
    return {
      code: "prompt-hash-mismatch",
      detail: `${agent.agentId} status in ${path.relative(REPO_ROOT, statusPath)} does not match the current prompt fingerprint.`,
    };
  }
  return null;
}

function diagnosticHasOnlyPromptDriftReasons(diagnostic) {
  return (
    Array.isArray(diagnostic?.reasons) &&
    diagnostic.reasons.length > 0 &&
    diagnostic.reasons.every((reason) => PROMPT_DRIFT_REASON_CODES.has(String(reason?.code || "").trim()))
  );
}

function isAuthoritativeCompletedRunStateEntry(entry) {
  if (!isCompletedRunStateValue(entry?.currentState)) {
    return false;
  }
  const source = String(entry?.lastSource || "").trim().toLowerCase();
  return source !== "" && source !== "legacy-run-state";
}

function buildPreservedCompletionEvidence(previousEntry, diagnostic) {
  const baseEvidence =
    diagnostic?.evidence && typeof diagnostic.evidence === "object" && !Array.isArray(diagnostic.evidence)
      ? { ...diagnostic.evidence }
      : {};
  baseEvidence.preservedCompletion = {
    preserved: true,
    preservedFromState: previousEntry?.currentState || "completed",
    preservedFromSource: previousEntry?.lastSource || null,
    preservedFromReasonCode: previousEntry?.lastReasonCode || null,
    driftReasons: (diagnostic?.reasons || [])
      .filter((reason) => PROMPT_DRIFT_REASON_CODES.has(String(reason?.code || "").trim()))
      .map((reason) => ({
        code: String(reason?.code || "").trim(),
        detail: String(reason?.detail || "").trim(),
      })),
    previousEvidence: previousEntry?.lastEvidence || null,
  };
  return baseEvidence;
}

function shouldPreserveCompletedWave(previousEntry, diagnostic) {
  return isAuthoritativeCompletedRunStateEntry(previousEntry) && diagnosticHasOnlyPromptDriftReasons(diagnostic);
}

function analyzeWaveCompletionFromStatusFiles(wave, statusDir, options = {}) {
  const logsDir = options.logsDir || path.join(path.resolve(statusDir, ".."), "logs");
  const coordinationDir =
    options.coordinationDir || path.join(path.resolve(statusDir, ".."), "coordination");
  const assignmentsDir =
    options.assignmentsDir || path.join(path.resolve(statusDir, ".."), "assignments");
  const dependencySnapshotsDir =
    options.dependencySnapshotsDir || path.join(path.resolve(statusDir, ".."), "dependencies");
  const contQaAgentId = options.contQaAgentId || DEFAULT_CONT_QA_AGENT_ID;
  const contEvalAgentId = options.contEvalAgentId || DEFAULT_CONT_EVAL_AGENT_ID;
  const integrationAgentId = options.integrationAgentId || DEFAULT_INTEGRATION_AGENT_ID;
  const documentationAgentId =
    options.documentationAgentId || DEFAULT_DOCUMENTATION_AGENT_ID;
  const laneProfile = resolveLaneProfileForOptions(options);
  const integrationThreshold =
    options.requireIntegrationStewardFromWave ??
    laneProfile.validation.requireIntegrationStewardFromWave;
  const componentThreshold =
    options.requireComponentPromotionsFromWave ??
    laneProfile.validation.requireComponentPromotionsFromWave;
  const securityRolePromptPath = resolveSecurityRolePromptPath(laneProfile);

  const reasons = [];
  const summariesByAgentId = {};
  const statusEntries = [];
  const missingStatusAgents = [];
  let statusesReady = wave.agents.length > 0;
  let summaryValidationReady = wave.agents.length > 0;
  const coordinationLogPath = path.join(coordinationDir, `wave-${wave.wave}.jsonl`);
  const assignmentsPath = path.join(assignmentsDir, `wave-${wave.wave}.json`);
  const dependencySnapshotPath = path.join(dependencySnapshotsDir, `wave-${wave.wave}.json`);

  for (const agent of wave.agents) {
    const statusPath = path.join(statusDir, `wave-${wave.wave}-${agent.slug}.status`);
    const statusRecord = readStatusRecordIfPresent(statusPath);
    if (!statusRecord) {
      missingStatusAgents.push(agent.agentId);
      statusesReady = false;
      summaryValidationReady = false;
      continue;
    }
    const summaryPath = agentSummaryPathFromStatusPath(statusPath);
    statusEntries.push({
      agentId: agent.agentId,
      statusPath,
      summaryPath,
      statusRecord,
    });
    const expectedPromptHash = hashAgentPromptFingerprint(agent);
    if (statusRecord.code !== 0) {
      pushWaveCompletionReason(
        reasons,
        "nonzero-status",
        `${agent.agentId} exited ${statusRecord.code} in ${path.relative(REPO_ROOT, statusPath)}.`,
      );
      statusesReady = false;
      summaryValidationReady = false;
      continue;
    }
    const promptDriftReason = promptDriftReasonForStatus(
      agent,
      statusPath,
      statusRecord,
      expectedPromptHash,
    );
    if (promptDriftReason) {
      pushWaveCompletionReason(reasons, promptDriftReason.code, promptDriftReason.detail);
      statusesReady = false;
    }
    const summary = materializeLiveExecutionSummaryIfMissing({
      wave,
      agent,
      statusPath,
      statusRecord,
      logsDir,
      contQaAgentId,
      contEvalAgentId,
      securityRolePromptPath,
    });
    summariesByAgentId[agent.agentId] = summary;
    if (agent.agentId === contQaAgentId) {
      const validation = validateContQaSummary(agent, summary, { mode: "live" });
      if (!validation.ok) {
        pushWaveCompletionReason(
          reasons,
          "invalid-cont-qa-summary",
          `${agent.agentId}: ${validation.statusCode}: ${validation.detail}`,
        );
        statusesReady = false;
      }
      continue;
    }
    if (agent.agentId === contEvalAgentId) {
      const evalValidation = validateContEvalSummary(agent, summary, {
        mode: "live",
        evalTargets: wave.evalTargets,
        benchmarkCatalogPath: laneProfile.paths.benchmarkCatalogPath,
      });
      if (!evalValidation.ok) {
        pushWaveCompletionReason(
          reasons,
          "invalid-cont-eval-summary",
          `${agent.agentId}: ${evalValidation.statusCode}: ${evalValidation.detail}`,
        );
        statusesReady = false;
      }
      if (isContEvalImplementationOwningAgent(agent, { contEvalAgentId })) {
        const implementationValidation = validateImplementationSummary(agent, summary);
        if (!implementationValidation.ok) {
          pushWaveCompletionReason(
            reasons,
            "invalid-cont-eval-implementation-summary",
            `${agent.agentId}: ${implementationValidation.statusCode}: ${implementationValidation.detail}`,
          );
          statusesReady = false;
        }
      }
      continue;
    }
    if (isSecurityReviewAgent(agent, { securityRolePromptPath })) {
      const validation = validateSecuritySummary(agent, summary);
      if (!validation.ok) {
        pushWaveCompletionReason(
          reasons,
          "invalid-security-summary",
          `${agent.agentId}: ${validation.statusCode}: ${validation.detail}`,
        );
        statusesReady = false;
      }
      continue;
    }
    if (
      agent.agentId === integrationAgentId &&
      integrationThreshold !== null &&
      wave.wave >= integrationThreshold
    ) {
      const validation = validateIntegrationSummary(agent, summary);
      if (!validation.ok) {
        pushWaveCompletionReason(
          reasons,
          "invalid-integration-summary",
          `${agent.agentId}: ${validation.statusCode}: ${validation.detail}`,
        );
        statusesReady = false;
      }
      continue;
    }
    if (agent.agentId === documentationAgentId) {
      const validation = validateDocumentationClosureSummary(agent, summary);
      if (!validation.ok) {
        pushWaveCompletionReason(
          reasons,
          "invalid-documentation-summary",
          `${agent.agentId}: ${validation.statusCode}: ${validation.detail}`,
        );
        statusesReady = false;
      }
      continue;
    }
    const validation = validateImplementationSummary(agent, summary);
    if (!validation.ok) {
      pushWaveCompletionReason(
        reasons,
        "invalid-implementation-summary",
        `${agent.agentId}: ${validation.statusCode}: ${validation.detail}`,
      );
      statusesReady = false;
    }
  }

  if (missingStatusAgents.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "missing-status",
      `Missing status files for ${missingStatusAgents.join(", ")}.`,
    );
  }

  if (
    summaryValidationReady &&
    componentThreshold !== null &&
    wave.wave >= componentThreshold
  ) {
    const promotionsValidation = validateWaveComponentPromotions(wave, summariesByAgentId, options);
    if (!promotionsValidation.ok) {
      pushWaveCompletionReason(
        reasons,
        "component-promotions-invalid",
        promotionsValidation.detail,
      );
      statusesReady = false;
    }
    const matrixValidation = validateWaveComponentMatrixCurrentLevels(wave, {
      ...options,
      laneProfile,
    });
    if (!matrixValidation.ok) {
      pushWaveCompletionReason(
        reasons,
        "component-matrix-invalid",
        matrixValidation.detail,
      );
      statusesReady = false;
    }
  }

  const coordinationState = readMaterializedCoordinationState(
    coordinationLogPath,
  );
  const openClarificationIds = coordinationState.clarifications
    .filter((record) => coordinationRecordBlocksWave(record))
    .map((record) => record.id);
  if (openClarificationIds.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "open-clarification",
      `Open clarification records: ${openClarificationIds.join(", ")}.`,
    );
  }
  const openClarificationRequestIds = openClarificationLinkedRequests(coordinationState)
    .filter((record) => coordinationRecordBlocksWave(record))
    .map((record) => record.id);
  if (openClarificationRequestIds.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "open-clarification-request",
      `Open clarification-linked requests: ${openClarificationRequestIds.join(", ")}.`,
    );
  }
  const openHumanEscalationIds = coordinationState.humanEscalations
    .filter((record) => coordinationRecordBlocksWave(record))
    .map((record) => record.id);
  if (openHumanEscalationIds.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "open-human-escalation",
      `Open human escalation records: ${openHumanEscalationIds.join(", ")}.`,
    );
  }
  const openHumanFeedbackIds = coordinationState.humanFeedback
    .filter((record) => coordinationRecordBlocksWave(record))
    .map((record) => record.id);
  if (openHumanFeedbackIds.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "open-human-feedback",
      `Open human feedback records: ${openHumanFeedbackIds.join(", ")}.`,
    );
  }
  const capabilityAssignments = readAssignmentSnapshot(assignmentsPath, {
    lane: options.lane || null,
    wave: wave.wave,
  });
  const blockingAssignments = Array.isArray(capabilityAssignments?.assignments)
    ? capabilityAssignments.assignments.filter((assignment) => assignment?.blocking)
    : [];
  const unresolvedAssignments = blockingAssignments.filter((assignment) => !assignment?.assignedAgentId);
  if (unresolvedAssignments.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "helper-assignment-unresolved",
      `Helper assignments remain unresolved (${unresolvedAssignments.map((assignment) => assignment.requestId || assignment.id).join(", ")}).`,
    );
  } else if (blockingAssignments.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "helper-assignment-open",
      `Helper assignments remain open (${blockingAssignments.map((assignment) => assignment.requestId || assignment.id).join(", ")}).`,
    );
  }
  const dependencySnapshot = readDependencySnapshot(dependencySnapshotPath, {
    lane: options.lane || null,
    wave: wave.wave,
  });
  const unresolvedInboundAssignments = Array.isArray(dependencySnapshot?.unresolvedInboundAssignments)
    ? dependencySnapshot.unresolvedInboundAssignments
    : [];
  if (unresolvedInboundAssignments.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "dependency-assignment-unresolved",
      `Required inbound dependencies are not assigned (${unresolvedInboundAssignments.map((record) => record.id || record).join(", ")}).`,
    );
  }
  const requiredInbound = Array.isArray(dependencySnapshot?.requiredInbound)
    ? dependencySnapshot.requiredInbound
    : [];
  const requiredOutbound = Array.isArray(dependencySnapshot?.requiredOutbound)
    ? dependencySnapshot.requiredOutbound
    : [];
  if (requiredInbound.length > 0 || requiredOutbound.length > 0) {
    pushWaveCompletionReason(
      reasons,
      "dependency-open",
      `Open required dependencies remain (${[...requiredInbound, ...requiredOutbound].map((record) => record.id || record).join(", ")}).`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    evidence: buildRunStateEvidence({
      wave,
      statusEntries,
      coordinationLogPath,
      assignmentsPath,
      dependencySnapshotPath,
      blockedReasons: reasons,
    }),
  };
}

export function completedWavesFromStatusFiles(allWaves, statusDir, options = {}) {
  const completed = [];
  for (const wave of allWaves) {
    if (analyzeWaveCompletionFromStatusFiles(wave, statusDir, options).ok) {
      completed.push(wave.wave);
    }
  }
  return normalizeCompletedWaves(completed);
}

export function reconcileRunStateFromStatusFiles(allWaves, runStatePath, statusDir, options = {}) {
  const diagnostics = allWaves.map((wave) => ({
    wave: wave.wave,
    ...analyzeWaveCompletionFromStatusFiles(wave, statusDir, options),
  }));
  const completedFromStatus = diagnostics
    .filter((diagnostic) => diagnostic.ok)
    .map((diagnostic) => diagnostic.wave);
  const before = readRunState(runStatePath);
  const firstMerge = normalizeCompletedWaves(
    diagnostics
      .filter((diagnostic) => {
        if (diagnostic.ok) {
          return true;
        }
        const previousEntry = before.waves[String(diagnostic.wave)] || null;
        return shouldPreserveCompletedWave(previousEntry, diagnostic);
      })
      .map((diagnostic) => diagnostic.wave)
      .concat(
        before.completedWaves.filter((waveNumber) => {
          const diagnostic = diagnostics.find((entry) => entry.wave === waveNumber);
          if (!diagnostic) {
            return true;
          }
          const previousEntry = before.waves[String(waveNumber)] || null;
          return diagnostic.ok || shouldPreserveCompletedWave(previousEntry, diagnostic);
        }),
      ),
  );
  const latest = readRunState(runStatePath);
  let nextState = latest;
  const preservedWithDrift = [];
  for (const diagnostic of diagnostics) {
    const previousEntry = before.waves[String(diagnostic.wave)] || null;
    const preserveCompleted = shouldPreserveCompletedWave(previousEntry, diagnostic);
    const toState = diagnostic.ok
      ? "completed"
      : preserveCompleted
        ? "completed_with_drift"
        : "blocked";
    const reasonCode = diagnostic.ok
      ? "status-reconcile-complete"
      : preserveCompleted
        ? "status-reconcile-completed-with-drift"
        : diagnostic.reasons[0]?.code || "status-reconcile-blocked";
    const detail = diagnostic.ok
      ? `Wave ${diagnostic.wave} reconstructed as complete from status files.`
      : preserveCompleted
        ? `Wave ${diagnostic.wave} preserved as completed with prompt drift: ${diagnostic.reasons.map((reason) => reason.detail).filter(Boolean).join(" ")}`
        : diagnostic.reasons.map((reason) => reason.detail).filter(Boolean).join(" ");
    const evidence = preserveCompleted
      ? buildPreservedCompletionEvidence(previousEntry, diagnostic)
      : diagnostic.evidence || null;
    if (preserveCompleted) {
      preservedWithDrift.push({
        wave: diagnostic.wave,
        reasons: diagnostic.reasons,
        previousState: previousEntry?.currentState || "completed",
      });
    }
    nextState = appendRunStateTransition(nextState, {
      waveNumber: diagnostic.wave,
      toState,
      source: "status-reconcile",
      reasonCode,
      detail,
      evidence,
      at: diagnostic.evidence?.statusFiles?.find((entry) => entry.completedAt)?.completedAt || toIsoTimestamp(),
    });
  }
  const state = writeRunState(runStatePath, nextState);
  const merged = state.completedWaves;
  return {
    completedFromStatus,
    addedFromBefore: firstMerge.filter((waveNumber) => !before.completedWaves.includes(waveNumber)),
    addedFromLatest: merged.filter((waveNumber) => !latest.completedWaves.includes(waveNumber)),
    blockedFromStatus: diagnostics.filter((diagnostic) => {
      if (diagnostic.ok) {
        return false;
      }
      const previousEntry = before.waves[String(diagnostic.wave)] || null;
      return !shouldPreserveCompletedWave(previousEntry, diagnostic);
    }),
    preservedWithDrift,
    state,
  };
}
