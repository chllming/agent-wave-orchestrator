import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { EXIT_CONTRACT_COMPLETION_VALUES, EXIT_CONTRACT_DOC_IMPACT_VALUES, EXIT_CONTRACT_DURABILITY_VALUES, EXIT_CONTRACT_PROOF_VALUES } from "./agent-state.mjs";
import {
  DEFAULT_PLANNER_AGENTIC_CORE_CONTEXT_PATHS,
  DEFAULT_PLANNER_AGENTIC_CONTEXT7_BUNDLE,
  DEFAULT_PLANNER_AGENTIC_CONTEXT7_QUERY,
  DEFAULT_PLANNER_AGENTIC_EXECUTOR_PROFILE,
  DEFAULT_PLANNER_AGENTIC_LESSONS_PATHS,
  DEFAULT_PLANNER_AGENTIC_MAX_REPLAN_ITERATIONS,
  DEFAULT_PLANNER_AGENTIC_MAX_WAVES,
  DEFAULT_PLANNER_AGENTIC_RESEARCH_TOPIC_PATHS,
  loadWaveConfig,
} from "./config.mjs";
import {
  describeContext7Libraries,
  loadContext7BundleIndex,
  prefetchContext7ForSelection,
  resolveContext7Selection,
} from "./context7.mjs";
import {
  PLANNER_CONTEXT7_BUNDLE_ID,
  PLANNER_CONTEXT7_DEFAULT_QUERY,
  PLANNER_CONTEXT7_PAPER_PATHS,
  PLANNER_CONTEXT7_SOURCE_DIR,
} from "./planner-context.mjs";
import { loadComponentCutoverMatrix, parseWaveFile, requiredDocumentationStewardPathsForWave, SHARED_PLAN_DOC_PATHS, validateWaveDefinition, applyExecutorSelectionsToWave } from "./wave-files.mjs";
import { buildLanePaths, ensureDirectory, readJsonOrNull, REPO_ROOT, writeJsonAtomic, writeTextAtomic } from "./shared.mjs";
import {
  DEPLOY_ENVIRONMENT_KINDS,
  DRAFT_TEMPLATES,
  buildDefaultProjectProfile,
  normalizeDraftTemplate,
  normalizeOversightMode,
  projectProfilePath,
  PROJECT_OVERSIGHT_MODES,
  PROJECT_PROFILE_TERMINAL_SURFACES,
  readProjectProfile,
  updateProjectProfile,
  writeProjectProfile,
} from "./project-profile.mjs";
import { normalizeTerminalSurface } from "./terminals.mjs";

const COMPONENT_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const WAVE_SPEC_SCHEMA_VERSION = 1;
const AGENTIC_PLANNER_SCHEMA_VERSION = 1;
const PLANNER_RUN_PREFIX = "planner";
const DEFAULT_GENERATED_WAVE_CONTEXT7_BUNDLE = "node-typescript";
const DEFAULT_GENERATED_WAVE_CONTEXT7_QUERY =
  "Architecture-aware wave planning, ownership boundaries, proof surfaces, and closure readiness";
const LIVE_PROOF_REVIEW_DIR = "docs/plans/waves/reviews";
const LIVE_PROOF_OPERATIONS_DIR = "docs/plans/operations";
const PLANNER_CANDIDATE_DIRNAME = "candidate";
const PLANNER_RESULT_STATES = new Set(["planned", "failed", "applied"]);
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
let bufferedNonTtyAnswers = null;
let bufferedNonTtyAnswerIndex = 0;

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function compactSingleLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeListText(value) {
  return String(value ?? "")
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePipeList(value) {
  return String(value ?? "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeComponentId(value, label = "component id") {
  const normalized = cleanText(value).toLowerCase();
  if (!COMPONENT_ID_REGEX.test(normalized)) {
    throw new Error(`${label} must match ${COMPONENT_ID_REGEX}`);
  }
  return normalized;
}

function normalizeRepoPathList(values, label) {
  return values.map((entry, index) => {
    const normalized = cleanText(entry).replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (!normalized) {
      throw new Error(`${label}[${index}] is required`);
    }
    if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../")) {
      throw new Error(`${label}[${index}] must stay inside the repository`);
    }
    return normalized;
  });
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
  );
}

function repoRelativePath(targetPath) {
  return path.relative(REPO_ROOT, targetPath).replaceAll(path.sep, "/");
}

function normalizeRepoRelativePath(value, label) {
  const normalized = cleanText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return normalized;
}

function ensureRepoRelativePathList(values, label) {
  return uniqueStrings(values).map((value, index) =>
    normalizeRepoRelativePath(value, `${label}[${index}]`),
  );
}

function normalizePlannerRunId(value) {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("Planner run id is required");
  }
  return normalized;
}

function buildPlannerRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = crypto.randomBytes(3).toString("hex");
  return normalizePlannerRunId(`${PLANNER_RUN_PREFIX}-${stamp}-${random}`);
}

function buildPlannerRunPaths(runId) {
  const normalizedRunId = normalizePlannerRunId(runId);
  const runDir = path.join(REPO_ROOT, ".wave", "planner", "runs", normalizedRunId);
  const candidateDir = path.join(runDir, PLANNER_CANDIDATE_DIRNAME);
  return {
    runId: normalizedRunId,
    runDir,
    requestPath: path.join(runDir, "request.json"),
    sourcesPath: path.join(runDir, "sources.json"),
    planPath: path.join(runDir, "plan.json"),
    verificationPath: path.join(runDir, "verification.json"),
    resultPath: path.join(runDir, "result.json"),
    promptPath: path.join(runDir, "planner-prompt.md"),
    candidateDir,
    candidateWavesDir: path.join(candidateDir, "waves"),
    candidateSpecsDir: path.join(candidateDir, "specs"),
    previewMatrixJsonPath: path.join(candidateDir, "component-cutover-matrix.json"),
    previewMatrixDocPath: path.join(candidateDir, "component-cutover-matrix.md"),
  };
}

function readTextIfExists(relPath) {
  const absolutePath = path.resolve(REPO_ROOT, relPath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function hashContent(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function splitTaskTerms(task) {
  return uniqueStrings(
    String(task || "")
      .toLowerCase()
      .replace(/[`"'().,:;!?]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4),
  ).slice(0, 10);
}

function isLikelyExternalPathHint(value) {
  const normalized = cleanText(value).replaceAll("\\", "/");
  if (!normalized) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) || normalized.startsWith("//")) {
    return true;
  }
  const firstSegment = normalized.split("/")[0] || "";
  return (
    !firstSegment.startsWith(".") &&
    /^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(firstSegment)
  );
}

function extractRepoPathHints(task) {
  const text = String(task || "");
  const matches = [];
  const pushPath = (value) => {
    const normalized = cleanText(value).replace(/^["'`(]+|["'`),.:;]+$/g, "");
    if (!normalized || isLikelyExternalPathHint(normalized)) {
      return;
    }
    const looksLikePath =
      normalized.includes("/") ||
      /^(README|CHANGELOG|package|pnpm-workspace|tsconfig|wave\.config)\.[a-z0-9._-]+$/i.test(
        normalized,
      );
    if (!looksLikePath) {
      return;
    }
    try {
      matches.push(normalizeRepoRelativePath(normalized, "task path hint"));
    } catch {
      // Ignore invalid hints.
    }
  };
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    pushPath(match[1]);
  }
  for (const match of text.matchAll(/(?:^|\s)([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:\/)?)(?=$|\s)/g)) {
    pushPath(match[1]);
  }
  for (const match of text.matchAll(
    /(?:^|\s)((?:README|CHANGELOG|package|pnpm-workspace|tsconfig|wave\.config)\.[A-Za-z0-9._-]+)(?=$|\s)/g,
  )) {
    pushPath(match[1]);
  }
  return uniqueStrings(matches);
}

function humanizeComponentId(componentId) {
  return cleanText(componentId)
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function defaultWorkerRoleKindForTemplate(template) {
  if (template === "infra") {
    return "infra";
  }
  if (template === "release") {
    return "deploy";
  }
  if (template === "qa") {
    return "qa";
  }
  return "implementation";
}

function defaultWorkerTitle(template, index) {
  if (template === "qa") {
    return `QA Track ${index + 1}`;
  }
  if (template === "infra") {
    return `Infra Track ${index + 1}`;
  }
  if (template === "release") {
    return `Release Track ${index + 1}`;
  }
  return `Implementation Track ${index + 1}`;
}

function defaultTargetLevel(template) {
  if (template === "qa") {
    return "qa-proved";
  }
  if (template === "release") {
    return "fleet-ready";
  }
  if (template === "infra") {
    return "baseline-proved";
  }
  return "repo-landed";
}

function defaultExecutorProfile(roleKind) {
  if (roleKind === "design") {
    return "design-pass";
  }
  if (roleKind === "infra" || roleKind === "deploy" || roleKind === "research") {
    return "ops-triage";
  }
  if (roleKind === "security") {
    return "security-review";
  }
  return "implement-fast";
}

function defaultExitContract(roleKind) {
  if (roleKind === "security" || roleKind === "design") {
    return null;
  }
  if (roleKind === "infra" || roleKind === "deploy") {
    return {
      completion: "live",
      durability: "durable",
      proof: "live",
      docImpact: "owned",
    };
  }
  if (roleKind === "qa") {
    return {
      completion: "integrated",
      durability: "none",
      proof: "integration",
      docImpact: "owned",
    };
  }
  return {
    completion: "contract",
    durability: "none",
    proof: "unit",
    docImpact: "owned",
  };
}

function buildDefaultValidationCommand(template, roleKind) {
  if (roleKind === "design") {
    return "Manual review of the design packet against the wave scope, constraints, and downstream ownership.";
  }
  if (roleKind === "security") {
    return "Manual review of the changed security-sensitive surfaces plus required proofs.";
  }
  if (template === "qa" || roleKind === "qa") {
    return "pnpm test";
  }
  if (roleKind === "infra" || roleKind === "deploy") {
    return "pnpm exec wave launch --dry-run --no-dashboard";
  }
  return "pnpm test";
}

function buildDefaultOutputSummary(template, roleKind) {
  if (roleKind === "design") {
    return "Summarize the design packet, key decisions, assumptions, open questions, and exact implementation handoff.";
  }
  if (roleKind === "security") {
    return "Summarize the threat model, findings, required approvals, requested fixes, and final security disposition.";
  }
  if (template === "qa" || roleKind === "qa") {
    return "Summarize the proved QA coverage, the remaining gaps, and whether the wave is closure-ready.";
  }
  if (roleKind === "infra" || roleKind === "deploy") {
    return "Summarize the environment proof, operator-visible risks, and rollback posture.";
  }
  return "Summarize the landed implementation, proof status, and exact follow-up owners.";
}

function buildDefaultPrimaryGoal(template, roleKind, title) {
  if (roleKind === "design") {
    return `Produce an implementation-ready design packet for the ${title.toLowerCase()} slice before coding starts.`;
  }
  if (roleKind === "security") {
    return `Review the ${title.toLowerCase()} slice for security risks and route exact fixes before integration.`;
  }
  if (template === "qa" || roleKind === "qa") {
    return `Build and validate the ${title.toLowerCase()} QA slice.`;
  }
  if (roleKind === "infra" || roleKind === "deploy") {
    return `Own the ${title.toLowerCase()} environment and deployment proof.`;
  }
  return `Implement and prove the ${title.toLowerCase()} slice.`;
}

class PromptSession {
  constructor() {
    this.interface = stdin.isTTY
      ? readline.createInterface({
          input: stdin,
          output: stderr,
          terminal: true,
        })
      : null;
  }

  static consumeBufferedNonTtyAnswer() {
    if (bufferedNonTtyAnswers === null) {
      bufferedNonTtyAnswers = fs.readFileSync(0, "utf8").split(/\r?\n/);
      bufferedNonTtyAnswerIndex = 0;
    }
    const answer =
      bufferedNonTtyAnswerIndex < bufferedNonTtyAnswers.length
        ? bufferedNonTtyAnswers[bufferedNonTtyAnswerIndex]
        : "";
    bufferedNonTtyAnswerIndex += 1;
    return answer;
  }

  async ask(question, defaultValue = null) {
    const suffix =
      defaultValue !== null && defaultValue !== undefined && String(defaultValue).length > 0
        ? ` [${defaultValue}]`
        : "";
    let answer = "";
    if (this.interface) {
      answer = await this.interface.question(`${question}${suffix}: `);
    } else {
      stderr.write(`${question}${suffix}: `);
      answer = PromptSession.consumeBufferedNonTtyAnswer();
      stderr.write("\n");
    }
    const trimmed = String(answer ?? "").trim();
    if (!trimmed && defaultValue !== null && defaultValue !== undefined) {
      return String(defaultValue);
    }
    return trimmed;
  }

  async askInteger(question, defaultValue = 0, options = {}) {
    const min = Number.isFinite(options.min) ? options.min : 0;
    while (true) {
      const raw = await this.ask(question, String(defaultValue));
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= min) {
        return parsed;
      }
      stderr.write(`Expected an integer >= ${min}.\n`);
    }
  }

  async askBoolean(question, defaultValue = true) {
    const defaultToken = defaultValue ? "y" : "n";
    while (true) {
      const raw = (await this.ask(`${question} (y/n)`, defaultToken)).toLowerCase();
      if (["y", "yes"].includes(raw)) {
        return true;
      }
      if (["n", "no"].includes(raw)) {
        return false;
      }
      stderr.write("Expected y or n.\n");
    }
  }

  async askChoice(question, choices, defaultValue) {
    const normalizedChoices = choices.map((choice) => String(choice).trim()).filter(Boolean);
    while (true) {
      const answer = cleanText(await this.ask(`${question} (${normalizedChoices.join("/")})`, defaultValue));
      if (normalizedChoices.includes(answer)) {
        return answer;
      }
      stderr.write(`Expected one of: ${normalizedChoices.join(", ")}.\n`);
    }
  }

  describe(text) {
    stderr.write(`  ${text}\n`);
  }

  async close() {
    this.interface?.close();
  }
}

function ensureWavePaths(lanePaths, waveNumber) {
  const wavePath = path.join(lanePaths.wavesDir, `wave-${waveNumber}.md`);
  const specPath = path.join(lanePaths.wavesDir, "specs", `wave-${waveNumber}.json`);
  return { wavePath, specPath };
}

function renderBulletLines(items) {
  return items.map((item) => `- ${item}`);
}

function renderPathSection(items) {
  return renderBulletLines(
    (Array.isArray(items) ? items : [])
      .map((item) => cleanText(item))
      .filter(Boolean),
  );
}

function renderProofArtifactsSection(proofArtifacts) {
  if (!Array.isArray(proofArtifacts) || proofArtifacts.length === 0) {
    return [];
  }
  return proofArtifacts.map((artifact) => {
    const pathValue = cleanText(artifact?.path);
    const fields = [`path: ${pathValue}`];
    if (cleanText(artifact?.kind)) {
      fields.push(`kind: ${cleanText(artifact.kind)}`);
    }
    const requiredFor = uniqueStrings(artifact?.requiredFor || []);
    if (requiredFor.length > 0) {
      fields.push(`required-for: ${requiredFor.join(", ")}`);
    }
    return fields.length === 1 && !cleanText(artifact?.kind) && requiredFor.length === 0
      ? `- ${pathValue}`
      : `- ${fields.join(" | ")}`;
  });
}

function stringifyExecutorValue(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderPromptBlock({
  primaryGoal,
  collaborationNotes = [],
  requiredContext = [],
  earlierWaveOutputs = [],
  ownedPaths = [],
  requirements = [],
  validationCommand = "",
  outputSummary = "",
  deployEnvironment = null,
}) {
  const lines = [];
  lines.push("Primary goal:");
  lines.push(`- ${primaryGoal}`);
  if (collaborationNotes.length > 0 || deployEnvironment) {
    lines.push("");
    lines.push("Collaboration notes:");
    for (const note of collaborationNotes) {
      lines.push(`- ${note}`);
    }
    if (deployEnvironment) {
      const suffix = deployEnvironment.notes ? ` (${deployEnvironment.notes})` : "";
      lines.push(
        `- The primary deploy environment for this role is \`${deployEnvironment.id}\` via \`${deployEnvironment.kind}\`${suffix}.`,
      );
    }
  }
  lines.push("");
  lines.push("Required context before coding:");
  lines.push(...renderBulletLines(requiredContext));
  if (earlierWaveOutputs.length > 0) {
    lines.push("");
    lines.push("Earlier wave outputs to read:");
    lines.push(...renderBulletLines(earlierWaveOutputs.map((item) => `\`${item}\``)));
  }
  lines.push("");
  lines.push("File ownership (only touch these paths):");
  lines.push(...renderBulletLines(ownedPaths));
  if (requirements.length > 0) {
    lines.push("");
    lines.push("Requirements:");
    requirements.forEach((requirement, index) => {
      lines.push(`${index + 1}) ${requirement}`);
    });
  }
  lines.push("");
  lines.push("Validation:");
  lines.push(`- ${validationCommand || "Manual review of the changed files and generated proof artifacts."}`);
  lines.push("");
  lines.push("Output:");
  lines.push(`- ${outputSummary || "Summarize the landed work, proof state, and remaining blockers."}`);
  return lines.join("\n");
}

function renderExecutorSection(agent) {
  const executor = agent.executor || null;
  if (!executor) {
    return [];
  }
  const lines = [];
  if (executor.profile) {
    lines.push(`- profile: ${executor.profile}`);
  }
  if (executor.id) {
    lines.push(`- id: ${executor.id}`);
  }
  if (executor.model) {
    lines.push(`- model: ${executor.model}`);
  }
  if (Array.isArray(executor.fallbacks) && executor.fallbacks.length > 0) {
    lines.push(`- fallbacks: ${executor.fallbacks.join(", ")}`);
  }
  if (Array.isArray(executor.tags) && executor.tags.length > 0) {
    lines.push(`- tags: ${executor.tags.join(", ")}`);
  }
  if (executor.retryPolicy) {
    lines.push(`- retry-policy: ${executor.retryPolicy}`);
  }
  if (typeof executor.allowFallbackOnRetry === "boolean") {
    lines.push(
      `- allow-fallback-on-retry: ${executor.allowFallbackOnRetry ? "true" : "false"}`,
    );
  }
  if (executor.budget?.turns) {
    lines.push(`- budget.turns: ${executor.budget.turns}`);
  }
  if (executor.budget?.minutes) {
    lines.push(`- budget.minutes: ${executor.budget.minutes}`);
  }
  for (const [runtimeKey, fields] of [
    ["codex", executor.codex],
    ["claude", executor.claude],
    ["opencode", executor.opencode],
  ]) {
    if (!fields || typeof fields !== "object") {
      continue;
    }
    for (const [fieldKey, fieldValue] of Object.entries(fields)) {
      if (
        fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === "" ||
        (Array.isArray(fieldValue) && fieldValue.length === 0)
      ) {
        continue;
      }
      let normalizedKey = fieldKey;
      if (fieldKey === "profileName") {
        normalizedKey = "profile_name";
      } else if (fieldKey === "addDirs") {
        normalizedKey = "add_dirs";
      } else if (fieldKey === "permissionMode") {
        normalizedKey = "permission_mode";
      } else if (fieldKey === "permissionPromptTool") {
        normalizedKey = "permission_prompt_tool";
      } else if (fieldKey === "maxTurns") {
        normalizedKey = "max_turns";
      } else if (fieldKey === "mcpConfig") {
        normalizedKey = "mcp_config";
      } else if (fieldKey === "settingsJson") {
        normalizedKey = "settings_json";
      } else if (fieldKey === "hooksJson") {
        normalizedKey = "hooks_json";
      } else if (fieldKey === "allowedHttpHookUrls") {
        normalizedKey = "allowed_http_hook_urls";
      } else if (fieldKey === "outputFormat") {
        normalizedKey = "output_format";
      } else if (fieldKey === "allowedTools") {
        normalizedKey = "allowed_tools";
      } else if (fieldKey === "disallowedTools") {
        normalizedKey = "disallowed_tools";
      } else if (fieldKey === "configJson") {
        normalizedKey = "config_json";
      }
      lines.push(`- ${runtimeKey}.${normalizedKey}: ${stringifyExecutorValue(fieldValue)}`);
    }
  }
  return lines;
}

function renderContext7Section(context7) {
  const lines = [`- bundle: ${context7?.bundle || "none"}`];
  if (context7?.query) {
    lines.push(`- query: "${context7.query.replace(/"/g, '\\"')}"`);
  }
  return lines;
}

function renderSkillsSection(skills) {
  return Array.isArray(skills) && skills.length > 0 ? renderBulletLines(skills) : [];
}

function renderEvalTargetsSection(evalTargets) {
  if (!Array.isArray(evalTargets) || evalTargets.length === 0) {
    return [];
  }
  return evalTargets.map((target) =>
    target.selection === "delegated"
      ? `- id: ${target.id} | selection: delegated | benchmark-family: ${target.benchmarkFamily} | objective: ${target.objective} | threshold: ${target.threshold}`
      : `- id: ${target.id} | selection: pinned | benchmarks: ${(target.benchmarks || []).join(", ")} | objective: ${target.objective} | threshold: ${target.threshold}`,
  );
}

export function renderWaveMarkdown(spec, lanePaths) {
  const sections = [];
  sections.push(`# Wave ${spec.wave} - ${spec.title}`);
  sections.push("");
  sections.push(`**Commit message**: \`${spec.commitMessage}\``);
  if (spec.projectProfile?.newProject !== undefined || spec.oversightMode) {
    sections.push("");
    sections.push("## Project profile");
    sections.push("");
    sections.push(`- project: ${spec.projectProfile?.projectName || lanePaths.config.projectName}`);
    sections.push(`- new-project: ${spec.projectProfile?.newProject ? "yes" : "no"}`);
    sections.push(`- oversight-mode: ${spec.oversightMode}`);
    sections.push(`- lane: ${spec.lane}`);
  }
  if (spec.sequencingNote) {
    sections.push("");
    sections.push("## Sequencing note");
    sections.push("");
    sections.push(...renderBulletLines([spec.sequencingNote]));
  }
  if (spec.referenceRule) {
    sections.push("");
    sections.push("## Reference rule");
    sections.push("");
    sections.push(...renderBulletLines([spec.referenceRule]));
  }
  if (spec.deployEnvironments.length > 0) {
    sections.push("");
    sections.push("## Deploy environments");
    sections.push("");
    sections.push(
      ...spec.deployEnvironments.map((environment) => {
        const suffix = environment.notes ? ` (${environment.notes})` : "";
        return `- \`${environment.id}\`: \`${environment.kind}\`${environment.isDefault ? " default" : ""}${suffix}`;
      }),
    );
  }
  sections.push("");
  sections.push("## Component promotions");
  sections.push("");
  sections.push(
    ...spec.componentPromotions.map(
      (promotion) => `- ${promotion.componentId}: ${promotion.targetLevel}`,
    ),
  );
  sections.push("");
  sections.push("## Context7 defaults");
  sections.push("");
  sections.push(...renderContext7Section(spec.context7Defaults));
  if (Array.isArray(spec.evalTargets) && spec.evalTargets.length > 0) {
    sections.push("");
    sections.push("## Eval targets");
    sections.push("");
    sections.push(...renderEvalTargetsSection(spec.evalTargets));
  }
  for (const agent of spec.agents) {
    sections.push("");
    sections.push(`## Agent ${agent.agentId}: ${agent.title}`);
    if (Array.isArray(agent.rolePromptPaths) && agent.rolePromptPaths.length > 0) {
      sections.push("");
      sections.push("### Role prompts");
      sections.push("");
      sections.push(...renderBulletLines(agent.rolePromptPaths));
    }
    sections.push("");
    sections.push("### Executor");
    sections.push("");
    sections.push(...renderExecutorSection(agent));
    sections.push("");
    sections.push("### Context7");
    sections.push("");
    sections.push(...renderContext7Section(agent.context7));
    if (Array.isArray(agent.skills) && agent.skills.length > 0) {
      sections.push("");
      sections.push("### Skills");
      sections.push("");
      sections.push(...renderSkillsSection(agent.skills));
    }
    if (Array.isArray(agent.components) && agent.components.length > 0) {
      sections.push("");
      sections.push("### Components");
      sections.push("");
      sections.push(...renderBulletLines(agent.components));
    }
    if (Array.isArray(agent.capabilities) && agent.capabilities.length > 0) {
      sections.push("");
      sections.push("### Capabilities");
      sections.push("");
      sections.push(...renderBulletLines(agent.capabilities));
    }
    if (Array.isArray(agent.deliverables) && agent.deliverables.length > 0) {
      sections.push("");
      sections.push("### Deliverables");
      sections.push("");
      sections.push(...renderPathSection(agent.deliverables));
    }
    if (Array.isArray(agent.proofArtifacts) && agent.proofArtifacts.length > 0) {
      sections.push("");
      sections.push("### Proof artifacts");
      sections.push("");
      sections.push(...renderProofArtifactsSection(agent.proofArtifacts));
    }
    if (agent.exitContract) {
      sections.push("");
      sections.push("### Exit contract");
      sections.push("");
      sections.push(`- completion: ${agent.exitContract.completion}`);
      sections.push(`- durability: ${agent.exitContract.durability}`);
      sections.push(`- proof: ${agent.exitContract.proof}`);
      sections.push(`- doc-impact: ${agent.exitContract.docImpact}`);
    }
    sections.push("");
    sections.push("### Prompt");
    sections.push("");
    sections.push("```text");
    sections.push(
      renderPromptBlock({
        primaryGoal: agent.primaryGoal,
        collaborationNotes: agent.collaborationNotes,
        requiredContext: agent.requiredContext,
        earlierWaveOutputs: agent.earlierWaveOutputs,
        ownedPaths: agent.ownedPaths,
        requirements: agent.requirements,
        validationCommand: agent.validationCommand,
        outputSummary: agent.outputSummary,
        deployEnvironment:
          agent.deployEnvironmentId &&
          spec.deployEnvironments.find((environment) => environment.id === agent.deployEnvironmentId),
      }),
    );
    sections.push("```");
  }
  sections.push("");
  return sections.join("\n");
}

function renderComponentMatrixMarkdown(matrixPayload) {
  const componentEntries = Object.entries(matrixPayload.components).sort((left, right) =>
    left[0].localeCompare(right[0]),
  );
  const wavePromotions = new Map();
  for (const [componentId, component] of componentEntries) {
    for (const promotion of component.promotions || []) {
      const list = wavePromotions.get(promotion.wave) || [];
      list.push({ componentId, target: promotion.target });
      wavePromotions.set(promotion.wave, list);
    }
  }
  const lines = [
    "# Component Cutover Matrix",
    "",
    "This matrix is the canonical place to answer which harness components are expected to be working at which maturity level.",
    "",
    "## Levels",
    "",
    ...renderBulletLines(matrixPayload.levels.map((level) => `\`${level}\``)),
    "",
    "## Components",
    "",
    ...componentEntries.map(
      ([componentId, component]) => `- \`${componentId}\`: ${component.title || componentId}`,
    ),
    "",
    "## Current Levels",
    "",
    "| Component | Current level | Proof surfaces |",
    "| --- | --- | --- |",
    ...componentEntries.map(
      ([componentId, component]) =>
        `| \`${componentId}\` | \`${component.currentLevel}\` | ${(component.proofSurfaces || []).join(", ")} |`,
    ),
    "",
    "## Promotions By Wave",
    "",
  ];
  for (const waveNumber of Array.from(wavePromotions.keys()).sort((a, b) => a - b)) {
    lines.push(`### Wave ${waveNumber}`);
    lines.push("");
    lines.push(
      ...wavePromotions
        .get(waveNumber)
        .toSorted((left, right) => left.componentId.localeCompare(right.componentId))
        .map(
          (promotion) =>
            `- Wave ${waveNumber} promotes \`${promotion.componentId}\` to \`${promotion.target}\`.`,
        ),
    );
    lines.push("");
  }
  lines.push("## Usage");
  lines.push("");
  lines.push("- Keep architecture and repository guidance docs descriptive.");
  lines.push("- Keep wave-by-wave component maturity and promotion targets here.");
  lines.push("- `currentLevel` is the canonical post-wave state of the repo, not a future plan.");
  lines.push("- When component promotion gating is active, wave files must match this matrix exactly.");
  lines.push("");
  return lines.join("\n");
}

function buildSpecialAgents({ spec, lanePaths, standardRoles }) {
  const sharedDocs = requiredDocumentationStewardPathsForWave(spec.wave, {
    laneProfile: lanePaths.laneProfile,
  });
  const commonRequiredContext = Array.from(
    new Set([
      "docs/reference/repository-guidance.md",
      "docs/research/agent-context-sources.md",
      ...SHARED_PLAN_DOC_PATHS,
    ]),
  );
  const contQaTitle = standardRoles.contQa ? "cont-QA" : "Custom cont-QA";
  const contEvalTitle = standardRoles.contEval ? "cont-EVAL" : "Custom cont-EVAL";
  const integrationTitle = standardRoles.integration ? "Integration Steward" : "Custom Integration Steward";
  const documentationTitle = standardRoles.documentation
    ? "Documentation Steward"
    : "Custom Documentation Steward";
  return [
    {
      agentId: lanePaths.contQaAgentId,
      title: contQaTitle,
      rolePromptPaths: [lanePaths.contQaRolePromptPath],
      skills: [],
      executor: { profile: "deep-review" },
      context7: { bundle: "none", query: "Architecture evaluation only; repository docs remain canonical" },
      components: [],
      capabilities: [],
      deliverables: [`docs/plans/waves/reviews/wave-${spec.wave}-cont-qa.md`],
      proofArtifacts: [],
      exitContract: null,
      primaryGoal: `Run continuous QA for Wave ${spec.wave} and publish the final closure verdict.`,
      collaborationNotes: [
        "Collect explicit verdicts from the implementation-facing agents plus A8 and A9 before closing the wave.",
        "Do not publish PASS unless the evidence, documentation closure, and integration summary are all coherent.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: [`docs/plans/waves/reviews/wave-${spec.wave}-cont-qa.md`],
      requirements: [
        "Verify the wave requirements are covered by landed evidence, not only by intent.",
        "Record any blocker that later waves must not silently assume away.",
      ],
      validationCommand:
        "Re-read the changed reports and end the cont-QA report with `Verdict: PASS`, `Verdict: CONCERNS`, or `Verdict: BLOCKED`.",
      outputSummary: "Summarize the cont-QA verdict and the top unresolved cross-cutting risks.",
      deployEnvironmentId: null,
    },
    ...(standardRoles.contEval
      ? [
          {
            agentId: lanePaths.contEvalAgentId,
            title: contEvalTitle,
            rolePromptPaths: [lanePaths.contEvalRolePromptPath],
            skills: [],
            executor: { profile: "eval-tuning" },
            context7: { bundle: "none", query: "Eval tuning only; repository docs remain canonical" },
            components: [],
            capabilities: ["eval"],
            deliverables: [`docs/plans/waves/reviews/wave-${spec.wave}-cont-eval.md`],
            proofArtifacts: [],
            exitContract: null,
            primaryGoal: `Run the Wave ${spec.wave} eval tuning loop until the declared eval targets are satisfied or explicitly blocked.`,
            collaborationNotes: [
              "Treat the wave's eval targets as the governing contract for benchmark choice and tuning depth.",
              "This standard cont-EVAL role is report-only by default; if fixes belong to another owner, open exact follow-up work instead of broadening scope implicitly.",
            ],
            requiredContext: commonRequiredContext,
            earlierWaveOutputs: [],
            ownedPaths: [`docs/plans/waves/reviews/wave-${spec.wave}-cont-eval.md`],
            requirements: [
              "Record the selected benchmark set, the commands run, observed output gaps, and regressions.",
              "Emit a final `[wave-eval]` marker with target_ids and benchmark_ids that matches the final tuning state.",
            ],
            validationCommand:
              "Re-run the selected benchmarks or service-output checks and end with a final `[wave-eval]` marker that enumerates target_ids and benchmark_ids.",
            outputSummary: "Summarize the selected benchmarks, tuning outcome, regressions, and remaining owners.",
            deployEnvironmentId: null,
          },
        ]
      : []),
    {
      agentId: lanePaths.integrationAgentId,
      title: integrationTitle,
      rolePromptPaths: [lanePaths.integrationRolePromptPath],
      skills: [],
      executor: { profile: "deep-review" },
      context7: { bundle: "none", query: "Integration synthesis only; repository docs remain canonical" },
      components: [],
      capabilities: ["integration", "docs-shared-plan"],
      deliverables: [
        path.join(path.relative(REPO_ROOT, lanePaths.integrationDir), `wave-${spec.wave}.md`).replaceAll("\\", "/"),
        path.join(path.relative(REPO_ROOT, lanePaths.integrationDir), `wave-${spec.wave}.json`).replaceAll("\\", "/"),
      ],
      proofArtifacts: [],
      exitContract: null,
      primaryGoal: `Synthesize the final Wave ${spec.wave} state before documentation and cont-QA closure.`,
      collaborationNotes: [
        "Re-read the message board, compiled inboxes, and latest artifacts before final output.",
        "Treat contradictions, missing proof, or stale shared-plan assumptions as integration failures.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: [
        path.join(path.relative(REPO_ROOT, lanePaths.integrationDir), `wave-${spec.wave}.md`).replaceAll("\\", "/"),
        path.join(path.relative(REPO_ROOT, lanePaths.integrationDir), `wave-${spec.wave}.json`).replaceAll("\\", "/"),
      ],
      requirements: [
        "Produce a closure-ready summary of claims, conflicts, blockers, and remaining follow-up owners.",
        "Decide whether the wave is `ready-for-doc-closure` or `needs-more-work`.",
      ],
      validationCommand: "Re-read the generated integration artifact and the latest changed proof docs before final output.",
      outputSummary: "Summarize the integration verdict, blockers, and exact closure recommendation.",
      deployEnvironmentId: null,
    },
    {
      agentId: lanePaths.documentationAgentId,
      title: documentationTitle,
      rolePromptPaths: [lanePaths.documentationRolePromptPath],
      skills: [],
      executor: { profile: "docs-pass" },
      context7: { bundle: "none", query: "Shared plan documentation only; repository docs remain canonical" },
      components: [],
      capabilities: [],
      deliverables: sharedDocs.filter((entry) => !cleanText(entry).endsWith("/")),
      proofArtifacts: [],
      exitContract: null,
      primaryGoal: `Keep shared plan docs aligned with Wave ${spec.wave} end-to-end.`,
      collaborationNotes: [
        "Coordinate with the implementation-facing agents and A8 before changing shared plan docs.",
        "Treat implementation-owned proof docs as owned deliverables; keep shared-plan deltas in your files.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: sharedDocs,
      requirements: [
        "Track which wave outcomes change shared status, sequencing, ownership, or proof expectations.",
        "Leave an exact-scope closure note when no shared-plan update is required.",
      ],
      validationCommand: "Manual review of shared plan docs against the landed wave deliverables.",
      outputSummary: "Summarize the shared doc updates, deliberate no-change decisions, and remaining follow-ups.",
      deployEnvironmentId: null,
    },
  ];
}

function buildWorkerAgentSpec({
  template,
  lanePaths,
  spec,
  index,
  values,
}) {
  const roleKind = values.roleKind;
  const agentId = values.agentId;
  const title = values.title;
  const requiredContext = Array.from(
    new Set([
      "docs/reference/repository-guidance.md",
      "docs/research/agent-context-sources.md",
      ...values.additionalContext,
    ]),
  );
  const capabilities = values.capabilities.slice();
  if (roleKind === "security" && !capabilities.some((capability) => capability.startsWith("security"))) {
    capabilities.push("security-review");
  }
  if (roleKind === "infra" && !capabilities.includes("infra")) {
    capabilities.push("infra");
  }
  if (roleKind === "deploy" && !capabilities.includes("deploy")) {
    capabilities.push("deploy");
  }
  if (roleKind === "research" && !capabilities.includes("research")) {
    capabilities.push("research");
  }
  if (roleKind === "design" && !capabilities.includes("design")) {
    capabilities.push("design");
  }
  return {
    agentId,
    title,
    rolePromptPaths:
      Array.isArray(values.rolePromptPaths) && values.rolePromptPaths.length > 0
        ? values.rolePromptPaths
        : roleKind === "security"
          ? [lanePaths.securityRolePromptPath]
          : roleKind === "design"
            ? [lanePaths.designRolePromptPath]
          : [],
    skills: values.skills || [],
    executor: {
      ...(values.executor || {}),
      ...(values.executorProfile ? { profile: values.executorProfile } : {}),
    },
    context7: {
      bundle: values.context7Bundle,
      query: values.context7Query || null,
    },
    components: values.components,
    capabilities,
    deliverables: Array.isArray(values.deliverables)
      ? values.deliverables
      : values.ownedPaths.filter((ownedPath) => !cleanText(ownedPath).endsWith("/")),
    proofArtifacts: Array.isArray(values.proofArtifacts) ? values.proofArtifacts : [],
    exitContract: values.exitContract,
    primaryGoal:
      values.primaryGoal || buildDefaultPrimaryGoal(template, roleKind, title),
    collaborationNotes: [
      ...(Array.isArray(values.collaborationNotes) ? values.collaborationNotes : []),
      "Re-read the wave message board before major decisions, before validation, and before final output.",
      `Notify Agent ${lanePaths.contQaAgentId} when your evidence changes the closure picture.`,
    ],
    requiredContext,
    earlierWaveOutputs: values.earlierWaveOutputs,
    ownedPaths: values.ownedPaths,
    requirements: values.requirements,
    validationCommand: values.validationCommand,
    outputSummary: values.outputSummary,
    deployEnvironmentId: values.deployEnvironmentId || null,
  };
}

function buildSpecPayload({ config, lanePaths, profile, draftValues }) {
  const projectDeployEnvironments = profile.deployEnvironments || [];
  const selectedDeployEnvironments = projectDeployEnvironments.filter((environment) =>
    draftValues.workerAgents.some((agent) => agent.deployEnvironmentId === environment.id),
  );
  return {
    schemaVersion: WAVE_SPEC_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    projectProfile: {
      projectName: profile.source?.projectName || config.projectName,
      newProject: profile.newProject === true,
      defaultTerminalSurface: profile.defaultTerminalSurface,
    },
    template: draftValues.template,
    lane: lanePaths.lane,
    wave: draftValues.wave,
    title: draftValues.title,
    commitMessage: draftValues.commitMessage,
    oversightMode: draftValues.oversightMode,
    sequencingNote: draftValues.sequencingNote || null,
    referenceRule: draftValues.referenceRule || null,
    deployEnvironments: selectedDeployEnvironments,
    context7Defaults: {
      bundle: draftValues.context7Bundle,
      query: draftValues.context7Query || null,
    },
    evalTargets: draftValues.evalTargets,
    componentPromotions: draftValues.componentPromotions,
    componentsCatalog: draftValues.componentCatalog,
    agents: [
      ...buildSpecialAgents({
        spec: draftValues,
        lanePaths,
        standardRoles: draftValues.standardRoles,
      }),
      ...draftValues.workerAgents.map((agent, index) =>
        buildWorkerAgentSpec({
          template: draftValues.template,
          lanePaths,
          spec: draftValues,
          index,
          values: agent,
        }),
      ),
    ],
  };
}

function upsertComponentMatrix(matrix, spec) {
  const next = {
    version: matrix.version,
    levels: matrix.levels.slice(),
    components: JSON.parse(JSON.stringify(matrix.components)),
  };
  for (const componentSpec of spec.componentsCatalog) {
    const existing = next.components[componentSpec.componentId];
    next.components[componentSpec.componentId] = {
      title: componentSpec.title,
      canonicalDocs: componentSpec.canonicalDocs,
      currentLevel: componentSpec.currentLevel,
      promotions: (
        existing?.promotions?.filter((promotion) => promotion.wave !== spec.wave) || []
      )
        .concat([{ wave: spec.wave, target: componentSpec.targetLevel }])
        .toSorted((left, right) => left.wave - right.wave),
      proofSurfaces: componentSpec.proofSurfaces,
    };
  }
  return next;
}

function componentMaturityIndex(level) {
  return COMPONENT_MATURITY_ORDER[cleanText(level)] ?? -1;
}

function isProofCentricLevel(level) {
  return componentMaturityIndex(level) >= componentMaturityIndex(PROOF_CENTRIC_COMPONENT_LEVEL);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commandExists(command) {
  const normalized = cleanText(command);
  if (!normalized) {
    return false;
  }
  const result = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(normalized)} >/dev/null 2>&1`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return result.status === 0;
}

function fileExists(relPath) {
  return fs.existsSync(path.resolve(REPO_ROOT, relPath));
}

function listTaskMatchedPaths(task) {
  const terms = splitTaskTerms(task);
  if (terms.length === 0 || !commandExists("rg")) {
    return [];
  }
  const pattern = terms.map((term) => escapeRegExp(term)).join("|");
  const result = spawnSync(
    "rg",
    ["-l", "-i", pattern, "AGENTS.md", "README.md", "docs", "scripts", "test"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  );
  if (result.error) {
    return [];
  }
  return uniqueStrings(
    String(result.stdout || "")
      .split(/\r?\n/)
      .map((entry) => cleanText(entry)),
  ).slice(0, 16);
}

function listExistingWaveArtifacts(fromWave, lanePaths) {
  if (!fs.existsSync(lanePaths.wavesDir)) {
    return [];
  }
  const entries = fs
    .readdirSync(lanePaths.wavesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .map((name) => {
      const match = name.match(/^wave-(\d+)\.md$/);
      return match
        ? {
            wave: Number.parseInt(match[1], 10),
            name,
          }
        : null;
    })
    .filter(Boolean)
    .filter((entry) => entry.wave < fromWave)
    .sort((left, right) => right.wave - left.wave)
    .slice(0, 4);
  const paths = [];
  for (const entry of entries) {
    const wavePath = path.join(lanePaths.wavesDir, entry.name);
    const specPath = path.join(lanePaths.wavesDir, "specs", `wave-${entry.wave}.json`);
    paths.push(repoRelativePath(wavePath));
    if (fs.existsSync(specPath)) {
      paths.push(repoRelativePath(specPath));
    }
  }
  return uniqueStrings(paths);
}

function createPlannerSourceAccumulator() {
  const order = [];
  const entries = new Map();
  return {
    add(sourcePath, category, reason) {
      const normalizedPath = normalizeRepoRelativePath(sourcePath, "planner source path");
      let entry = entries.get(normalizedPath);
      if (!entry) {
        entry = {
          path: normalizedPath,
          categories: new Set(),
          reasons: new Set(),
        };
        entries.set(normalizedPath, entry);
        order.push(normalizedPath);
      }
      if (category) {
        entry.categories.add(cleanText(category));
      }
      if (reason) {
        entry.reasons.add(cleanText(reason));
      }
    },
    finalize() {
      return order.map((sourcePath) => {
        const entry = entries.get(sourcePath);
        const text = readTextIfExists(sourcePath);
        return {
          path: sourcePath,
          exists: text !== null,
          bytes: text === null ? 0 : Buffer.byteLength(text, "utf8"),
          sha256: text === null ? null : hashContent(text),
          categories: Array.from(entry.categories),
          reasons: Array.from(entry.reasons),
        };
      });
    },
  };
}

function collectPlannerSources({ config, lanePaths, task, fromWave }) {
  const plannerConfig = config.planner?.agentic || {};
  const taskPathHints = extractRepoPathHints(task);
  const taskMatchedPaths = listTaskMatchedPaths(task);
  const priorWaveArtifacts = listExistingWaveArtifacts(fromWave, lanePaths);
  const sources = createPlannerSourceAccumulator();
  sources.add("docs/agents/wave-planner-role.md", "planner-role", "standing planner role");
  sources.add("skills/role-planner/SKILL.md", "planner-skill", "planner skill checklist");
  for (const sourcePath of ensureRepoRelativePathList(
    plannerConfig.coreContextPaths || DEFAULT_PLANNER_AGENTIC_CORE_CONTEXT_PATHS,
    "planner.agentic.coreContextPaths",
  )) {
    sources.add(sourcePath, "core-context", "planner core context");
  }
  const plannerProfilePath = projectProfilePath(lanePaths.project || config.defaultProject);
  if (fileExists(plannerProfilePath)) {
    sources.add(repoRelativePath(plannerProfilePath), "project-profile", "saved project profile");
  }
  for (const sourcePath of ensureRepoRelativePathList(
    plannerConfig.lessonsPaths || DEFAULT_PLANNER_AGENTIC_LESSONS_PATHS,
    "planner.agentic.lessonsPaths",
  )) {
    sources.add(sourcePath, "lessons", "repo-local planning lessons");
  }
  for (const sourcePath of ensureRepoRelativePathList(
    plannerConfig.researchTopicPaths || DEFAULT_PLANNER_AGENTIC_RESEARCH_TOPIC_PATHS,
    "planner.agentic.researchTopicPaths",
  )) {
    sources.add(sourcePath, "research-topic", "planning research topic index");
  }
  for (const sourcePath of PLANNER_CONTEXT7_PAPER_PATHS) {
    sources.add(sourcePath, "research-paper", "fixed planning research slice");
  }
  for (const sourcePath of taskPathHints) {
    sources.add(sourcePath, "task-hint", "path mentioned directly in task");
  }
  for (const sourcePath of taskMatchedPaths) {
    sources.add(sourcePath, "task-search", "task term match");
  }
  for (const sourcePath of priorWaveArtifacts) {
    sources.add(sourcePath, "prior-wave", "nearby prior wave artifact");
  }
  return sources.finalize();
}

function summarizeDeployEnvironments(profile) {
  const environments = Array.isArray(profile?.deployEnvironments) ? profile.deployEnvironments : [];
  if (environments.length === 0) {
    return ["- none declared"];
  }
  return environments.map((environment) => {
    const suffix = environment.notes ? ` (${environment.notes})` : "";
    return `- ${environment.id}: ${environment.kind}${environment.isDefault ? " default" : ""}${suffix}`;
  });
}

function summarizeCurrentComponentLevels(matrix) {
  return Object.entries(matrix.components || {})
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([componentId, component]) => `- ${componentId}: ${component.currentLevel}`);
}

function renderPlannerContext7Section(plannerContext7) {
  if (!plannerContext7?.selection) {
    return [];
  }
  const libraries = describeContext7Libraries(plannerContext7.selection) || "none";
  const lines = [
    "## Planner Context7",
    "",
    `- bundle: ${plannerContext7.selection.bundleId}`,
    `- query: ${plannerContext7.selection.query || "none"}`,
    `- libraries: ${libraries}`,
    `- mode: ${plannerContext7.prefetch?.mode || "none"}`,
  ];
  if (plannerContext7.selection.bundleId === PLANNER_CONTEXT7_BUNDLE_ID) {
    lines.push(
      `- repo-export-dir: ${PLANNER_CONTEXT7_SOURCE_DIR}`,
      `- default-query: ${PLANNER_CONTEXT7_DEFAULT_QUERY}`,
    );
  }
  if (plannerContext7.prefetch?.warning) {
    lines.push(`- warning: ${plannerContext7.prefetch.warning}`);
  }
  if (plannerContext7.prefetch?.promptText) {
    lines.push(
      "",
      "### Planner Context7 Snippets",
      "",
      "Treat this block as non-canonical external reference material.",
      "",
      plannerContext7.prefetch.promptText,
    );
  }
  return lines;
}

function buildPlannerPromptText({ request, sources, profile, bundleIndex, matrix, plannerContext7 }) {
  const existingSources = sources.filter((source) => source.exists);
  const missingSources = sources.filter((source) => !source.exists);
  const sourceLines = existingSources.map(
    (source) => `- ${source.path}${source.reasons.length > 0 ? ` (${source.reasons.join("; ")})` : ""}`,
  );
  const missingLines = missingSources.map((source) => `- ${source.path}`);
  const bundleIds = Object.keys(bundleIndex?.bundles || {}).sort();
  const plannerContext7Lines = renderPlannerContext7Section(plannerContext7);
  return [
    "# Agentic Wave Planner",
    "",
    "Read the standing planner role and planner skill first, then read the repo-local planning docs, nearby wave artifacts, and research files listed below before drafting the plan.",
    "",
    "## Request",
    "",
    `- task: ${request.task}`,
    `- lane: ${request.lane}`,
    `- from-wave: ${request.fromWave}`,
    `- max-waves: ${request.maxWaves}`,
    `- planner-executor-profile: ${request.plannerExecutorProfile}`,
    "",
    "## Project Profile",
    "",
    `- new-project: ${profile?.newProject ? "yes" : "no"}`,
    `- default-oversight-mode: ${profile?.defaultOversightMode || "oversight"}`,
    `- default-terminal-surface: ${profile?.defaultTerminalSurface || "codex-cli"}`,
    "- deploy-environments:",
    ...summarizeDeployEnvironments(profile),
    "",
    "## Current Component Levels",
    "",
    ...(summarizeCurrentComponentLevels(matrix).length > 0
      ? summarizeCurrentComponentLevels(matrix)
      : ["- none declared"]),
    "",
    ...plannerContext7Lines,
    ...(plannerContext7Lines.length > 0 ? [""] : []),
    "## Available Context7 Bundles",
    "",
    ...renderBulletLines(bundleIds.length > 0 ? bundleIds : ["none"]),
    "",
    "## Source Files To Read",
    "",
    ...(sourceLines.length > 0 ? sourceLines : ["- none"]),
    ...(missingLines.length > 0
      ? ["", "## Missing Suggested Sources", "", ...missingLines]
      : []),
    "",
    "## Output Rules",
    "",
    "- Return JSON only. No markdown fences. No explanatory prose before or after the JSON.",
    "- Keep the plan reviewable and narrow. Split broad work into multiple waves instead of overclaiming maturity.",
    "- Keep each promoted component to one honest maturity jump per wave unless the request explicitly requires otherwise.",
    "- For pilot-live and above, include an explicit live-proof owner with `.tmp/` proof bundle artifacts, a runbook under `docs/plans/operations/`, and rollback or restart evidence.",
    "- Give every worker agent exact deliverables. Give proof-centric owners exact proof artifacts.",
    "- Keep A8, A9, and A0 as closure gates through `standardRoles` unless there is a repo-specific reason not to.",
    "",
    "## Required JSON Shape",
    "",
    "The top-level object must have this shape:",
    "",
    "{",
    '  "summary": "short decision-ready summary",',
    '  "openQuestions": ["question"],',
    '  "waves": [',
    "    {",
    '      "title": "Wave title",',
    '      "commitMessage": "Feat: ...",',
    '      "template": "implementation",',
    '      "sequencingNote": "optional",',
    '      "referenceRule": "optional",',
    '      "oversightMode": "oversight",',
    '      "context7Defaults": { "bundle": "none", "query": "" },',
    '      "standardRoles": { "contQa": true, "contEval": false, "integration": true, "documentation": true },',
    '      "evalTargets": [],',
    '      "componentCatalog": [',
    '        { "componentId": "component-id", "title": "Title", "currentLevel": "repo-landed", "targetLevel": "baseline-proved", "canonicalDocs": ["docs/..."], "proofSurfaces": ["tests"] }',
    "      ],",
    '      "workerAgents": [',
    '        {',
    '          "agentId": "A1",',
    '          "title": "Implementation Track 1",',
    '          "roleKind": "implementation",',
    '          "executor": { "profile": "implement-fast" },',
    '          "ownedPaths": ["scripts/..."],',
    '          "deliverables": ["scripts/..."],',
    '          "proofArtifacts": [{ "path": ".tmp/...", "kind": "proof-bundle", "requiredFor": ["pilot-live"] }],',
    '          "components": ["component-id"],',
    '          "capabilities": ["implementation"],',
    '          "additionalContext": ["docs/plans/current-state.md"],',
    '          "earlierWaveOutputs": [],',
    '          "requirements": ["exact requirement"],',
    '          "validationCommand": "pnpm test",',
    '          "outputSummary": "what the final report must summarize",',
    '          "primaryGoal": "what this owner is proving",',
    '          "deployEnvironmentId": null,',
    '          "context7Bundle": "none",',
    '          "context7Query": "",',
    '          "exitContract": { "completion": "contract", "durability": "none", "proof": "unit", "docImpact": "owned" }',
    "        }",
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
  ].join("\n");
}

function ensurePlannerRunDirectories(runPaths) {
  ensureDirectory(runPaths.runDir);
  ensureDirectory(runPaths.candidateDir);
  ensureDirectory(runPaths.candidateWavesDir);
  ensureDirectory(runPaths.candidateSpecsDir);
}

function resolvePlannerContext7Selection({ config, lanePaths, bundleIndex, request }) {
  const plannerAgentic = config.planner?.agentic || {};
  return resolveContext7Selection({
    lane: lanePaths.lane,
    waveDefaults: {
      bundle: plannerAgentic.context7Bundle || DEFAULT_PLANNER_AGENTIC_CONTEXT7_BUNDLE,
      query: plannerAgentic.context7Query || DEFAULT_PLANNER_AGENTIC_CONTEXT7_QUERY,
    },
    agentConfig: null,
    agent: {
      agentId: "planner",
      title: "Agentic Wave Planner",
      promptOverlay: request.task,
    },
    bundleIndex,
  });
}

function buildAgenticPlannerRequest({ config, lanePaths, task, fromWave, maxWaves, plannerExecutorProfile }) {
  return {
    schemaVersion: AGENTIC_PLANNER_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    lane: lanePaths.lane,
    task: compactSingleLine(task),
    fromWave,
    maxWaves,
    plannerExecutorProfile,
    plannerConfig: {
      executorProfile:
        config.planner?.agentic?.executorProfile || DEFAULT_PLANNER_AGENTIC_EXECUTOR_PROFILE,
      maxReplanIterations:
        config.planner?.agentic?.maxReplanIterations ||
        DEFAULT_PLANNER_AGENTIC_MAX_REPLAN_ITERATIONS,
      context7Bundle:
        config.planner?.agentic?.context7Bundle || DEFAULT_PLANNER_AGENTIC_CONTEXT7_BUNDLE,
      context7Query:
        config.planner?.agentic?.context7Query || DEFAULT_PLANNER_AGENTIC_CONTEXT7_QUERY,
    },
  };
}

function normalizeGeneratedComponentId(value, fallback = "planned-component") {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return fallback;
  }
  return normalizeComponentId(normalized, "planner component id");
}

function plannerMaterialLevelIndex(level) {
  const normalized = cleanText(level);
  const ladder = [
    "repo-landed",
    "baseline-proved",
    "pilot-live",
    "qa-proved",
    "fleet-ready",
    "cutover-ready",
    "deprecation-ready",
  ];
  const index = ladder.indexOf(normalized);
  return index >= 0 ? index : 0;
}

function detectRequestedTargetLevel(task) {
  const text = String(task || "").toLowerCase();
  if (text.includes("deprecat")) {
    return "deprecation-ready";
  }
  if (text.includes("cutover")) {
    return "cutover-ready";
  }
  if (text.includes("fleet") || text.includes("rollout")) {
    return "fleet-ready";
  }
  if (text.includes("qa")) {
    return "qa-proved";
  }
  if (
    text.includes("pilot") ||
    text.includes("live") ||
    text.includes("deploy") ||
    text.includes("rollback") ||
    text.includes("operator")
  ) {
    return "pilot-live";
  }
  if (text.includes("baseline")) {
    return "baseline-proved";
  }
  return "repo-landed";
}

function buildPlannerWaveTargets(currentLevel, requestedTargetLevel, maxWaves) {
  const ladder = [
    "repo-landed",
    "baseline-proved",
    "pilot-live",
    "qa-proved",
    "fleet-ready",
    "cutover-ready",
    "deprecation-ready",
  ];
  const currentIndex = Math.max(0, plannerMaterialLevelIndex(currentLevel));
  const targetIndex = Math.max(currentIndex, plannerMaterialLevelIndex(requestedTargetLevel));
  const targets = [];
  for (let index = currentIndex; index <= targetIndex && targets.length < maxWaves; index += 1) {
    if (ladder[index] !== cleanText(currentLevel)) {
      targets.push(ladder[index]);
    }
  }
  if (targets.length === 0) {
    targets.push(ladder[targetIndex] || requestedTargetLevel);
  }
  return targets;
}

function findRelevantComponentsForTask(task, matrix) {
  const terms = splitTaskTerms(task);
  const ranked = Object.entries(matrix.components || {})
    .map(([componentId, component]) => {
      const haystack = `${componentId} ${component.title || ""}`.toLowerCase();
      const score = terms.reduce(
        (total, term) => (haystack.includes(term) ? total + 1 : total),
        0,
      );
      return {
        componentId,
        title: component.title || humanizeComponentId(componentId),
        currentLevel: component.currentLevel || "inventoried",
        canonicalDocs: Array.isArray(component.canonicalDocs) ? component.canonicalDocs : [],
        proofSurfaces: Array.isArray(component.proofSurfaces) ? component.proofSurfaces : [],
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.componentId.localeCompare(right.componentId));
  return ranked.slice(0, 2);
}

function selectTaskImplementationFiles(sources) {
  const preferred = (Array.isArray(sources) ? sources : [])
    .filter((source) => source.exists)
    .filter((source) => source.categories.includes("task-hint") || source.categories.includes("task-search"))
    .map((source) => source.path)
    .filter((sourcePath) =>
      /^(?:scripts|test|docs\/guides|docs\/reference|docs\/plans|README\.md|CHANGELOG\.md|package\.json)/.test(
        sourcePath,
      ),
    )
    .filter(
      (sourcePath) =>
        !sourcePath.startsWith("docs/research/agent-context-cache/papers/") &&
        !sourcePath.startsWith("docs/research/") &&
        !sourcePath.startsWith("docs/context7/"),
    );
  return uniqueStrings(preferred).slice(0, 6);
}

function buildHeuristicWorkerAgents({
  waveNumber,
  waveTitle,
  componentId,
  targetLevel,
  taskFiles,
  bundleIndex,
}) {
  const codeFiles = taskFiles.filter((filePath) => filePath.startsWith("scripts/"));
  const testFiles = taskFiles.filter((filePath) => filePath.startsWith("test/"));
  const docFiles = taskFiles.filter((filePath) => filePath.startsWith("docs/"));
  const implementationDeliverables = uniqueStrings(
    [...codeFiles.slice(0, 2), ...testFiles.slice(0, 1), ...docFiles.slice(0, 1)],
  );
  const implementationOwnedPaths =
    implementationDeliverables.length > 0
      ? implementationDeliverables
      : ["README.md"];
  const agents = [
    {
      agentId: "A1",
      title: waveTitle.includes("Planner") ? "Planner Implementation Slice" : "Implementation Slice",
      roleKind: "implementation",
      executor: {
        profile: "implement-fast",
      },
      ownedPaths: implementationOwnedPaths,
      deliverables: implementationDeliverables.length > 0 ? implementationDeliverables : ["README.md"],
      proofArtifacts: [],
      components: [componentId],
      capabilities: ["implementation"],
      additionalContext: ["docs/plans/current-state.md", "docs/plans/master-plan.md"],
      earlierWaveOutputs: [],
      requirements: [
        "Keep ownership boundaries explicit and machine-checkable.",
        "Leave exact follow-up proof gaps in the final output instead of overclaiming maturity.",
      ],
      validationCommand:
        testFiles.length > 0
          ? `pnpm test -- ${testFiles[0]}`
          : "pnpm test -- test/wave-orchestrator/planner.test.ts",
      outputSummary: "Summarize the landed implementation, tests, and any remaining proof gaps.",
      primaryGoal: `Implement the ${componentId} slice to the declared maturity target without broadening scope.`,
      deployEnvironmentId: null,
      context7Bundle: bundleIndex?.bundles?.[DEFAULT_GENERATED_WAVE_CONTEXT7_BUNDLE]
        ? DEFAULT_GENERATED_WAVE_CONTEXT7_BUNDLE
        : "none",
      context7Query: DEFAULT_GENERATED_WAVE_CONTEXT7_QUERY,
      exitContract: defaultExitContract("implementation"),
    },
  ];
  if (isProofCentricLevel(targetLevel)) {
    const liveProofBase = `.tmp/wave-${waveNumber}-${componentId}-proof`;
    const runbookPath = `${LIVE_PROOF_OPERATIONS_DIR}/${componentId}-wave-${waveNumber}.md`;
    const reviewPath = `${LIVE_PROOF_REVIEW_DIR}/wave-${waveNumber}-${componentId}-live-proof.md`;
    agents.push({
      agentId: "A2",
      title: "Live Proof Owner",
      roleKind: "deploy",
      executor: {
        profile: "ops-triage",
        retryPolicy: "sticky",
        budget: { minutes: 30 },
      },
      ownedPaths: [
        runbookPath,
        reviewPath,
        `${liveProofBase}/summary.md`,
        `${liveProofBase}/rollback.md`,
      ],
      deliverables: [runbookPath, reviewPath],
      proofArtifacts: [
        {
          path: `${liveProofBase}/summary.md`,
          kind: "proof-bundle",
          requiredFor: [targetLevel],
        },
        {
          path: `${liveProofBase}/rollback.md`,
          kind: "rollback-evidence",
          requiredFor: [targetLevel],
        },
      ],
      components: [componentId],
      capabilities: ["deploy", "live-proof"],
      additionalContext: ["docs/reference/live-proof-waves.md", "docs/plans/current-state.md"],
      earlierWaveOutputs: [],
      requirements: [
        "Capture restart or rollback evidence, not only one-shot success.",
        "Author the exact operator runbook and keep it aligned with the proof bundle.",
      ],
      validationCommand:
        "Re-read the proof bundle and runbook; fail the wave if rollback or restart evidence is missing.",
      outputSummary: "Summarize the live proof bundle, rollback posture, and operator-visible caveats.",
      primaryGoal: `Own the live-proof surface for ${componentId} and justify the ${targetLevel} claim honestly.`,
      deployEnvironmentId: null,
      context7Bundle: "none",
      context7Query: "",
      exitContract: defaultExitContract("deploy"),
    });
  }
  return agents;
}

function buildHeuristicPlannerPayload({ request, sources, matrix, bundleIndex }) {
  const matchingComponents = findRelevantComponentsForTask(request.task, matrix);
  const component =
    matchingComponents[0] || {
      componentId: normalizeGeneratedComponentId(splitTaskTerms(request.task).join("-") || "planned-slice"),
      title: humanizeComponentId(normalizeGeneratedComponentId(splitTaskTerms(request.task).join("-") || "planned-slice")),
      currentLevel: "inventoried",
      canonicalDocs: ["docs/roadmap.md"],
      proofSurfaces: ["tests", "docs"],
    };
  const requestedTargetLevel = detectRequestedTargetLevel(request.task);
  const targetLevels = buildPlannerWaveTargets(
    component.currentLevel || "inventoried",
    requestedTargetLevel,
    request.maxWaves,
  );
  const taskFiles = selectTaskImplementationFiles(sources);
  const openQuestions = [];
  if (plannerMaterialLevelIndex(requestedTargetLevel) > plannerMaterialLevelIndex(targetLevels[targetLevels.length - 1])) {
    openQuestions.push(
      `The requested end state appears to exceed the configured max-waves limit (${request.maxWaves}); plan review should decide whether to add more waves.`,
    );
  }
  const waves = targetLevels.map((targetLevel, index) => {
    const waveNumber = request.fromWave + index;
    const isProofWave = isProofCentricLevel(targetLevel);
    const titleSuffix = isProofWave ? "Live Proof" : index === 0 ? "Foundation" : "Closure";
    return {
      wave: waveNumber,
      title: `${humanizeComponentId(component.componentId)} ${titleSuffix}`,
      commitMessage:
        targetLevel === "repo-landed"
          ? `Feat: land ${component.componentId} ${titleSuffix.toLowerCase()}`
          : `Docs: plan ${component.componentId} ${targetLevel}`,
      template: "implementation",
      sequencingNote:
        index === 0
          ? "Keep the first wave repo-honest and only promote the next maturity step once closure artifacts exist."
          : `This wave assumes Wave ${waveNumber - 1} closed honestly before raising the maturity claim.`,
      referenceRule:
        "Read the planning lessons, current-state, master-plan, component matrix, and nearby wave artifacts before execution.",
      oversightMode: "oversight",
      context7Defaults: {
        bundle: bundleIndex?.bundles?.[DEFAULT_GENERATED_WAVE_CONTEXT7_BUNDLE]
          ? DEFAULT_GENERATED_WAVE_CONTEXT7_BUNDLE
          : "none",
        query: DEFAULT_GENERATED_WAVE_CONTEXT7_QUERY,
      },
      standardRoles: {
        contQa: true,
        contEval: false,
        integration: true,
        documentation: true,
      },
      evalTargets: [],
      componentCatalog: [
        {
          componentId: component.componentId,
          title: component.title,
          currentLevel:
            index === 0
              ? component.currentLevel || "inventoried"
              : targetLevels[index - 1],
          targetLevel,
          canonicalDocs:
            component.canonicalDocs && component.canonicalDocs.length > 0
              ? component.canonicalDocs
              : ["docs/roadmap.md"],
          proofSurfaces:
            component.proofSurfaces && component.proofSurfaces.length > 0
              ? component.proofSurfaces
              : isProofWave
                ? ["tests", "runbook", "rollback-evidence"]
                : ["tests", "docs"],
        },
      ],
      workerAgents: buildHeuristicWorkerAgents({
        waveNumber,
        waveTitle: `${humanizeComponentId(component.componentId)} ${titleSuffix}`,
        componentId: component.componentId,
        targetLevel,
        taskFiles,
        bundleIndex,
      }),
    };
  });
  return {
    summary: `Draft ${waves.length === 1 ? "one wave" : `${waves.length} waves`} that promote ${component.componentId} without overclaiming maturity.`,
    openQuestions,
    waves,
  };
}

function extractJsonPayload(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    throw new Error("Planner returned empty output");
  }
  const withoutFence = normalized
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {}
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Planner output did not contain a JSON object");
  }
  return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizePlannerProofArtifacts(rawArtifacts) {
  return (Array.isArray(rawArtifacts) ? rawArtifacts : []).map((artifact, index) => {
    if (typeof artifact === "string") {
      return {
        path: normalizeRepoRelativePath(artifact, `proofArtifacts[${index}]`),
        kind: null,
        requiredFor: [],
      };
    }
    return {
      path: normalizeRepoRelativePath(artifact?.path, `proofArtifacts[${index}].path`),
      kind: cleanText(artifact?.kind) || null,
      requiredFor: uniqueStrings(
        (Array.isArray(artifact?.requiredFor) ? artifact.requiredFor : [])
          .map((level) => cleanText(level))
          .filter((level) => COMPONENT_MATURITY_ORDER[level] !== undefined),
      ),
    };
  });
}

function normalizePlannerContext7Bundle(bundle, bundleIndex) {
  const normalized = cleanText(bundle) || "none";
  if (!bundleIndex?.bundles?.[normalized]) {
    throw new Error(`Unknown planner Context7 bundle: ${normalized}`);
  }
  return normalized;
}

function normalizePlannerWorkerAgent(rawAgent, context) {
  const agentId = cleanText(rawAgent?.agentId) || `A${context.index + 1}`;
  const roleKind = [
    "design",
    "implementation",
    "qa",
    "infra",
    "deploy",
    "research",
    "security",
  ].includes(cleanText(rawAgent?.roleKind))
    ? cleanText(rawAgent.roleKind)
    : "implementation";
  const ownedPaths = ensureRepoRelativePathList(
    Array.isArray(rawAgent?.ownedPaths) ? rawAgent.ownedPaths : [],
    `${agentId}.ownedPaths`,
  );
  if (ownedPaths.length === 0) {
    throw new Error(`Planner worker ${agentId} must declare ownedPaths`);
  }
  const deliverables = ensureRepoRelativePathList(
    Array.isArray(rawAgent?.deliverables) && rawAgent.deliverables.length > 0
      ? rawAgent.deliverables
      : ownedPaths.filter((entry) => !cleanText(entry).endsWith("/")),
    `${agentId}.deliverables`,
  ).filter((entry) => !cleanText(entry).endsWith("/"));
  const explicitComponents =
    rawAgent && Object.prototype.hasOwnProperty.call(rawAgent, "components");
  const components = uniqueStrings(
    (
      explicitComponents
        ? Array.isArray(rawAgent?.components)
          ? rawAgent.components
          : []
        : context.componentIds
    ).map((componentId) => normalizeComponentId(componentId, `${agentId}.components`)),
  );
  const context7Bundle = normalizePlannerContext7Bundle(
    rawAgent?.context7Bundle || context.waveContext7Bundle || "none",
    context.bundleIndex,
  );
  const exitDefaults = defaultExitContract(roleKind);
  const rawExitContract = rawAgent?.exitContract || exitDefaults;
  const exitContract = rawExitContract
    ? {
        completion:
          EXIT_CONTRACT_COMPLETION_VALUES.includes(cleanText(rawExitContract.completion))
            ? cleanText(rawExitContract.completion)
            : exitDefaults?.completion,
        durability:
          EXIT_CONTRACT_DURABILITY_VALUES.includes(cleanText(rawExitContract.durability))
            ? cleanText(rawExitContract.durability)
            : exitDefaults?.durability,
        proof:
          EXIT_CONTRACT_PROOF_VALUES.includes(cleanText(rawExitContract.proof))
            ? cleanText(rawExitContract.proof)
            : exitDefaults?.proof,
        docImpact:
          EXIT_CONTRACT_DOC_IMPACT_VALUES.includes(cleanText(rawExitContract.docImpact))
            ? cleanText(rawExitContract.docImpact)
            : exitDefaults?.docImpact,
      }
    : null;
  return {
    agentId,
    title:
      cleanText(rawAgent?.title) ||
      buildDefaultPrimaryGoal(context.template, roleKind, agentId).replace(/^Implement and prove the /, ""),
    roleKind,
    rolePromptPaths: ensureRepoRelativePathList(
      Array.isArray(rawAgent?.rolePromptPaths) ? rawAgent.rolePromptPaths : [],
      `${agentId}.rolePromptPaths`,
    ),
    executorProfile: cleanText(rawAgent?.executorProfile) || null,
    executor:
      rawAgent?.executor && typeof rawAgent.executor === "object" && !Array.isArray(rawAgent.executor)
        ? cloneJson(rawAgent.executor)
        : rawAgent?.executorProfile
          ? { profile: cleanText(rawAgent.executorProfile) }
          : { profile: defaultExecutorProfile(roleKind) },
    ownedPaths,
    deliverables,
    proofArtifacts: normalizePlannerProofArtifacts(rawAgent?.proofArtifacts),
    components,
    capabilities: uniqueStrings(rawAgent?.capabilities || []),
    skills: uniqueStrings(rawAgent?.skills || []),
    additionalContext: ensureRepoRelativePathList(
      Array.isArray(rawAgent?.additionalContext) && rawAgent.additionalContext.length > 0
        ? rawAgent.additionalContext
        : ["docs/plans/current-state.md"],
      `${agentId}.additionalContext`,
    ),
    earlierWaveOutputs: ensureRepoRelativePathList(
      Array.isArray(rawAgent?.earlierWaveOutputs) ? rawAgent.earlierWaveOutputs : [],
      `${agentId}.earlierWaveOutputs`,
    ),
    requirements: uniqueStrings(rawAgent?.requirements || []),
    validationCommand:
      cleanText(rawAgent?.validationCommand) ||
      buildDefaultValidationCommand(context.template, roleKind),
    outputSummary:
      cleanText(rawAgent?.outputSummary) ||
      buildDefaultOutputSummary(context.template, roleKind),
    primaryGoal:
      cleanText(rawAgent?.primaryGoal) ||
      buildDefaultPrimaryGoal(context.template, roleKind, cleanText(rawAgent?.title) || agentId),
    deployEnvironmentId: cleanText(rawAgent?.deployEnvironmentId) || null,
    context7Bundle,
    context7Query: cleanText(rawAgent?.context7Query) || context.waveContext7Query || "",
    exitContract:
      exitContract && Object.values(exitContract).every(Boolean)
        ? exitContract
        : exitDefaults,
    collaborationNotes: uniqueStrings(rawAgent?.collaborationNotes || []),
  };
}

function normalizePlannerWavePlan(rawWave, context) {
  const waveNumber = Number.isFinite(rawWave?.wave)
    ? Number.parseInt(String(rawWave.wave), 10)
    : context.waveNumber;
  const template = normalizeDraftTemplate(rawWave?.template || "implementation");
  const context7Defaults =
    rawWave?.context7Defaults && typeof rawWave.context7Defaults === "object"
      ? rawWave.context7Defaults
      : {};
  const waveContext7Bundle = normalizePlannerContext7Bundle(
    context7Defaults.bundle ||
      (context.bundleIndex?.bundles?.[DEFAULT_GENERATED_WAVE_CONTEXT7_BUNDLE]
        ? DEFAULT_GENERATED_WAVE_CONTEXT7_BUNDLE
        : "none"),
    context.bundleIndex,
  );
  const componentCatalog = (Array.isArray(rawWave?.componentCatalog) ? rawWave.componentCatalog : [])
    .map((entry, index) => {
      const componentId = normalizeGeneratedComponentId(
        entry?.componentId || `component-${waveNumber}-${index + 1}`,
      );
      const matrixEntry = context.matrix.components?.[componentId] || null;
      const currentLevel = cleanText(entry?.currentLevel) || matrixEntry?.currentLevel || "inventoried";
      const targetLevel = cleanText(entry?.targetLevel) || currentLevel || "repo-landed";
      if (COMPONENT_MATURITY_ORDER[currentLevel] === undefined) {
        throw new Error(`Unknown currentLevel "${currentLevel}" for component ${componentId}`);
      }
      if (COMPONENT_MATURITY_ORDER[targetLevel] === undefined) {
        throw new Error(`Unknown targetLevel "${targetLevel}" for component ${componentId}`);
      }
      return {
        componentId,
        title: cleanText(entry?.title) || matrixEntry?.title || humanizeComponentId(componentId),
        currentLevel,
        targetLevel,
        canonicalDocs: ensureRepoRelativePathList(
          Array.isArray(entry?.canonicalDocs) && entry.canonicalDocs.length > 0
            ? entry.canonicalDocs
            : matrixEntry?.canonicalDocs || ["docs/roadmap.md"],
          `${componentId}.canonicalDocs`,
        ),
        proofSurfaces: uniqueStrings(
          Array.isArray(entry?.proofSurfaces) && entry.proofSurfaces.length > 0
            ? entry.proofSurfaces
            : matrixEntry?.proofSurfaces || ["tests", "docs"],
        ),
      };
    });
  if (componentCatalog.length === 0) {
    throw new Error(`Planner wave ${waveNumber} must declare componentCatalog`);
  }
  const componentIds = componentCatalog.map((entry) => entry.componentId);
  const workerAgents = (Array.isArray(rawWave?.workerAgents) ? rawWave.workerAgents : []).map(
    (workerAgent, index) =>
      normalizePlannerWorkerAgent(workerAgent, {
        index,
        componentIds,
        bundleIndex: context.bundleIndex,
        waveContext7Bundle,
        waveContext7Query: cleanText(context7Defaults.query),
        template,
      }),
  );
  if (workerAgents.length === 0) {
    throw new Error(`Planner wave ${waveNumber} must declare at least one worker agent`);
  }
  return {
    wave: waveNumber,
    lane: context.lane,
    template,
    title: cleanText(rawWave?.title) || `Wave ${waveNumber} Planned Slice`,
    commitMessage: cleanText(rawWave?.commitMessage) || `Feat: plan wave ${waveNumber}`,
    sequencingNote: cleanText(rawWave?.sequencingNote) || null,
    referenceRule: cleanText(rawWave?.referenceRule) || null,
    oversightMode: normalizeOversightMode(rawWave?.oversightMode || "oversight"),
    context7Bundle: waveContext7Bundle,
    context7Query: cleanText(context7Defaults.query) || "",
    standardRoles: {
      contQa: rawWave?.standardRoles?.contQa !== false,
      contEval:
        rawWave?.standardRoles?.contEval === true ||
        (Array.isArray(rawWave?.evalTargets) && rawWave.evalTargets.length > 0),
      integration: rawWave?.standardRoles?.integration !== false,
      documentation: rawWave?.standardRoles?.documentation !== false,
    },
    evalTargets: Array.isArray(rawWave?.evalTargets) ? cloneJson(rawWave.evalTargets) : [],
    componentPromotions: componentCatalog.map((entry) => ({
      componentId: entry.componentId,
      targetLevel: entry.targetLevel,
    })),
    componentCatalog,
    workerAgents,
  };
}

function normalizePlannerPlanPayload(rawPlan, context) {
  const payload = rawPlan && typeof rawPlan === "object" && !Array.isArray(rawPlan) ? rawPlan : {};
  const rawWaves = Array.isArray(payload.waves) ? payload.waves.slice(0, context.maxWaves) : [];
  if (rawWaves.length === 0) {
    throw new Error("Planner output must include at least one wave");
  }
  const waves = rawWaves.map((rawWave, index) =>
    normalizePlannerWavePlan(rawWave, {
      ...context,
      waveNumber: context.fromWave + index,
    }),
  );
  return {
    summary: cleanText(payload.summary) || `Drafted ${waves.length} candidate waves.`,
    openQuestions: uniqueStrings(payload.openQuestions || []),
    waveOrder: waves.map((wave) => wave.wave),
    waves,
  };
}

function plannerHonestStepIndex(level) {
  const normalized = cleanText(level);
  if (["inventoried", "contract-frozen", "repo-landed", "baseline-proved"].includes(normalized)) {
    return 0;
  }
  if (normalized === "pilot-live") {
    return 1;
  }
  if (normalized === "qa-proved") {
    return 2;
  }
  if (normalized === "fleet-ready") {
    return 3;
  }
  if (normalized === "cutover-ready") {
    return 4;
  }
  if (normalized === "deprecation-ready") {
    return 5;
  }
  return 0;
}

function plannerPathOwnershipOverlaps(leftPath, rightPath) {
  const left = cleanText(leftPath);
  const right = cleanText(rightPath);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  if (left.endsWith("/")) {
    return right.startsWith(left);
  }
  if (right.endsWith("/")) {
    return left.startsWith(right);
  }
  return false;
}

function collectNonClosureAgents(spec, lanePaths) {
  const reservedAgentIds = new Set([
    lanePaths.contQaAgentId,
    lanePaths.contEvalAgentId,
    lanePaths.integrationAgentId,
    lanePaths.documentationAgentId,
  ]);
  return (Array.isArray(spec.agents) ? spec.agents : []).filter(
    (agent) => !reservedAgentIds.has(agent.agentId),
  );
}

function validateAgenticPlanArtifacts({ waveArtifacts, matrix, lanePaths, bundleIndex }) {
  const errors = [];
  const warnings = [];
  const projectedLevels = Object.fromEntries(
    Object.entries(matrix.components || {}).map(([componentId, component]) => [
      componentId,
      component.currentLevel || "inventoried",
    ]),
  );
  for (const artifact of waveArtifacts) {
    const spec = artifact.spec;
    const workerAgents = collectNonClosureAgents(spec, lanePaths);
    for (const promotion of spec.componentPromotions || []) {
      const previousLevel = projectedLevels[promotion.componentId] || "inventoried";
      if (componentMaturityIndex(promotion.targetLevel) < componentMaturityIndex(previousLevel)) {
        errors.push(
          `Wave ${spec.wave} regresses ${promotion.componentId} from ${previousLevel} to ${promotion.targetLevel}.`,
        );
      }
      if (
        plannerHonestStepIndex(promotion.targetLevel) - plannerHonestStepIndex(previousLevel) >
        1
      ) {
        errors.push(
          `Wave ${spec.wave} overclaims ${promotion.componentId} by jumping from ${previousLevel} to ${promotion.targetLevel}.`,
        );
      }
      projectedLevels[promotion.componentId] = promotion.targetLevel;
    }
    for (const agent of workerAgents) {
      if (!Array.isArray(agent.deliverables) || agent.deliverables.length === 0) {
        errors.push(`Wave ${spec.wave} agent ${agent.agentId} must declare at least one deliverable.`);
      }
    }
    for (let index = 0; index < workerAgents.length; index += 1) {
      for (let peerIndex = index + 1; peerIndex < workerAgents.length; peerIndex += 1) {
        const left = workerAgents[index];
        const right = workerAgents[peerIndex];
        if (
          (left.ownedPaths || []).some((leftPath) =>
            (right.ownedPaths || []).some((rightPath) =>
              plannerPathOwnershipOverlaps(leftPath, rightPath),
            ),
          )
        ) {
          errors.push(
            `Wave ${spec.wave} has overlapping ownership between ${left.agentId} and ${right.agentId}.`,
          );
        }
      }
    }
    const proofCentricWave = (spec.componentPromotions || []).some((promotion) =>
      isProofCentricLevel(promotion.targetLevel),
    );
    if (proofCentricWave) {
      const proofOwners = workerAgents.filter(
        (agent) =>
          Array.isArray(agent.proofArtifacts) &&
          agent.proofArtifacts.length > 0,
      );
      if (proofOwners.length === 0) {
        errors.push(`Wave ${spec.wave} targets pilot-live or above but has no live-proof owner.`);
      }
      const hasRunbook = proofOwners.some((agent) =>
        [...(agent.deliverables || []), ...(agent.ownedPaths || [])].some((entry) =>
          cleanText(entry).startsWith(`${LIVE_PROOF_OPERATIONS_DIR}/`),
        ),
      );
      if (!hasRunbook) {
        errors.push(
          `Wave ${spec.wave} targets pilot-live or above but no proof owner owns a runbook under ${LIVE_PROOF_OPERATIONS_DIR}/.`,
        );
      }
      const hasTmpBundle = proofOwners.some((agent) =>
        (agent.proofArtifacts || []).some((artifact) => cleanText(artifact.path).startsWith(".tmp/")),
      );
      if (!hasTmpBundle) {
        errors.push(
          `Wave ${spec.wave} targets pilot-live or above but no proof owner writes a .tmp/ proof bundle.`,
        );
      }
      const hasRollbackOrRestart = proofOwners.some((agent) =>
        (agent.proofArtifacts || []).some((artifact) =>
          /rollback|restart/i.test(`${artifact.kind || ""} ${artifact.path || ""}`),
        ),
      );
      if (!hasRollbackOrRestart) {
        errors.push(
          `Wave ${spec.wave} targets pilot-live or above but no proof artifact captures rollback or restart evidence.`,
        );
      }
    }
    const documentationAgent = (spec.agents || []).find(
      (agent) => agent.agentId === lanePaths.documentationAgentId,
    );
    if (!documentationAgent) {
      errors.push(`Wave ${spec.wave} is missing ${lanePaths.documentationAgentId}.`);
    } else {
      const requiredDocs = requiredDocumentationStewardPathsForWave(spec.wave, {
        laneProfile: lanePaths.laneProfile,
      });
      for (const requiredDoc of requiredDocs) {
        if (!(documentationAgent.deliverables || []).includes(requiredDoc)) {
          errors.push(
            `Wave ${spec.wave} documentation closure is missing required deliverable ${requiredDoc}.`,
          );
        }
      }
    }
    for (const agent of spec.agents || []) {
      try {
        normalizePlannerContext7Bundle(agent.context7?.bundle || "none", bundleIndex);
      } catch (error) {
        errors.push(`Wave ${spec.wave} agent ${agent.agentId}: ${error.message}`);
      }
    }
    if (!(spec.agents || []).some((agent) => agent.agentId === lanePaths.integrationAgentId)) {
      errors.push(`Wave ${spec.wave} is missing ${lanePaths.integrationAgentId}.`);
    }
    if (!(spec.agents || []).some((agent) => agent.agentId === lanePaths.contQaAgentId)) {
      errors.push(`Wave ${spec.wave} is missing ${lanePaths.contQaAgentId}.`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function writePlannerCandidateArtifacts({ plan, config, lanePaths, profile, matrix, runPaths }) {
  ensurePlannerRunDirectories(runPaths);
  let projectedMatrix = matrix;
  const waveArtifacts = [];
  for (const draftValues of plan.waves) {
    const spec = buildSpecPayload({
      config,
      lanePaths,
      profile,
      draftValues,
    });
    const markdown = renderWaveMarkdown(spec, lanePaths);
    const wavePath = path.join(runPaths.candidateWavesDir, `wave-${spec.wave}.md`);
    const specPath = path.join(runPaths.candidateSpecsDir, `wave-${spec.wave}.json`);
    writeJsonAtomic(specPath, spec);
    writeTextAtomic(wavePath, `${markdown}\n`);
    projectedMatrix = upsertComponentMatrix(projectedMatrix, spec);
    waveArtifacts.push({
      wave: spec.wave,
      wavePath,
      specPath,
      markdown,
      spec,
    });
  }
  writeJsonAtomic(runPaths.previewMatrixJsonPath, projectedMatrix);
  writeTextAtomic(runPaths.previewMatrixDocPath, `${renderComponentMatrixMarkdown(projectedMatrix)}\n`);
  const candidateLaneProfile = {
    ...lanePaths.laneProfile,
    paths: {
      ...lanePaths.laneProfile.paths,
      componentCutoverMatrixJsonPath: repoRelativePath(runPaths.previewMatrixJsonPath),
      componentCutoverMatrixDocPath: repoRelativePath(runPaths.previewMatrixDocPath),
    },
    validation: {
      ...lanePaths.laneProfile.validation,
      requireDocumentationStewardFromWave: null,
      requireComponentPromotionsFromWave: null,
      requireAgentComponentsFromWave: null,
    },
  };
  for (const artifact of waveArtifacts) {
    const parsedWave = parseWaveFile(artifact.wavePath, { laneProfile: candidateLaneProfile });
    validateWaveDefinition(
      applyExecutorSelectionsToWave(parsedWave, { laneProfile: candidateLaneProfile }),
      { laneProfile: candidateLaneProfile },
    );
  }
  return {
    waveArtifacts,
    previewMatrix: projectedMatrix,
  };
}

function buildPlannerVerificationPayload({ plan, verification, waveArtifacts, runPaths }) {
  return {
    schemaVersion: AGENTIC_PLANNER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: verification.ok,
    summary: plan.summary,
    waveOrder: plan.waveOrder,
    errors: verification.errors,
    warnings: verification.warnings,
    candidate: {
      previewMatrixJsonPath: repoRelativePath(runPaths.previewMatrixJsonPath),
      previewMatrixDocPath: repoRelativePath(runPaths.previewMatrixDocPath),
      waves: waveArtifacts.map((artifact) => ({
        wave: artifact.wave,
        markdownPath: repoRelativePath(artifact.wavePath),
        specPath: repoRelativePath(artifact.specPath),
      })),
    },
  };
}

function resolvePlannerExecutorProfile(lanePaths, plannerExecutorProfile) {
  const profileName =
    cleanText(plannerExecutorProfile) || DEFAULT_PLANNER_AGENTIC_EXECUTOR_PROFILE;
  const profile = lanePaths.executors?.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Unknown planner executor profile: ${profileName}`);
  }
  return {
    profileName,
    profile,
  };
}

function resolvePlannerFixturePayload() {
  const inlinePayload =
    process.env.WAVE_PLANNER_AGENTIC_RESPONSE_JSON || process.env.WAVE_PLANNER_AGENTIC_RESPONSE;
  if (cleanText(inlinePayload)) {
    return {
      source: "fixture-inline",
      rawPayload: extractJsonPayload(inlinePayload),
    };
  }
  const fixturePath = cleanText(process.env.WAVE_PLANNER_AGENTIC_RESPONSE_FILE);
  if (!fixturePath) {
    return null;
  }
  const absolutePath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.resolve(REPO_ROOT, fixturePath);
  return {
    source: "fixture-file",
    rawPayload: extractJsonPayload(fs.readFileSync(absolutePath, "utf8")),
    fixturePath: absolutePath,
  };
}

function runPlannerCodexExecutor({ lanePaths, plannerExecutorProfile, promptText, runPaths }) {
  const { profileName, profile } = resolvePlannerExecutorProfile(lanePaths, plannerExecutorProfile);
  const executorId = profile.id || lanePaths.executors?.default || "codex";
  if (executorId !== "codex") {
    throw new Error(
      `Planner executor profile ${profileName} resolves to ${executorId}; agentic draft currently supports codex or fixture input only`,
    );
  }
  const codexRuntime = {
    ...(lanePaths.executors?.codex || {}),
    ...(profile.codex || {}),
  };
  const command = cleanText(codexRuntime.command) || "codex";
  if (!commandExists(command)) {
    throw new Error(`Planner executor command is not available: ${command}`);
  }
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    codexRuntime.sandbox || "read-only",
  ];
  if (profile.model) {
    args.push("--model", profile.model);
  }
  if (codexRuntime.profileName) {
    args.push("--profile", codexRuntime.profileName);
  }
  for (const configValue of codexRuntime.config || []) {
    args.push("-c", configValue);
  }
  if (codexRuntime.search) {
    args.push("--search");
  }
  for (const imagePath of codexRuntime.images || []) {
    args.push("--image", imagePath);
  }
  for (const dirPath of codexRuntime.addDirs || []) {
    args.push("--add-dir", dirPath);
  }
  if (codexRuntime.ephemeral) {
    args.push("--ephemeral");
  }
  args.push("-");
  const timeoutMs = Math.max(
    60_000,
    ((profile.budget?.minutes || DEFAULT_PLANNER_AGENTIC_MAX_REPLAN_ITERATIONS * 10) * 60_000),
  );
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    input: promptText,
    timeout: timeoutMs,
  });
  writeTextAtomic(path.join(runPaths.runDir, "planner-executor.stdout.log"), String(result.stdout || ""));
  writeTextAtomic(path.join(runPaths.runDir, "planner-executor.stderr.log"), String(result.stderr || ""));
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Planner executor exited with status ${result.status}: ${cleanText(result.stderr) || cleanText(result.stdout) || "no output"}`,
    );
  }
  return {
    source: "executor-codex",
    rawPayload: extractJsonPayload(result.stdout),
    runtime: {
      profile: profileName,
      command,
      timeoutMs,
    },
  };
}

function loadPlannerRunBundle(runId) {
  const runPaths = buildPlannerRunPaths(runId);
  const request = readJsonOrNull(runPaths.requestPath);
  const sources = readJsonOrNull(runPaths.sourcesPath);
  const plan = readJsonOrNull(runPaths.planPath);
  const verification = readJsonOrNull(runPaths.verificationPath);
  const result = readJsonOrNull(runPaths.resultPath);
  if (!request || !result) {
    throw new Error(`Planner run ${runPaths.runId} is missing request.json or result.json`);
  }
  return {
    runPaths,
    request,
    sources,
    plan,
    verification,
    result,
  };
}

function parsePlannerWaveSelection(rawValue, waveOrder) {
  const value = cleanText(rawValue);
  if (!value || value === "all") {
    return waveOrder.slice();
  }
  return uniqueStrings(value.split(",")).map((entry) => {
    const parsed = Number.parseInt(entry, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid wave selection token: ${entry}`);
    }
    return parsed;
  });
}

async function runAgenticDraftFlow(options = {}) {
  const config = options.config || loadWaveConfig();
  const projectId = options.project || config.defaultProject;
  const profile = await ensureProjectProfile({ config, project: projectId });
  const lane = options.lane || profile.plannerDefaults.lane || config.defaultLane;
  const lanePaths = buildLanePaths(lane, { config, project: projectId });
  const matrix = loadComponentCutoverMatrix({ laneProfile: lanePaths.laneProfile });
  const bundleIndex = loadContext7BundleIndex(lanePaths.context7BundleIndexPath);
  const plannerExecutorProfile =
    cleanText(options.plannerExecutorProfile) ||
    config.planner?.agentic?.executorProfile ||
    DEFAULT_PLANNER_AGENTIC_EXECUTOR_PROFILE;
  const maxWaves =
    Number.isFinite(options.maxWaves) && options.maxWaves > 0
      ? options.maxWaves
      : config.planner?.agentic?.defaultMaxWaves || DEFAULT_PLANNER_AGENTIC_MAX_WAVES;
  const request = buildAgenticPlannerRequest({
    config,
    lanePaths,
    task: options.task,
    fromWave: options.fromWave,
    maxWaves,
    plannerExecutorProfile,
  });
  const runPaths = buildPlannerRunPaths(options.runId || buildPlannerRunId());
  ensurePlannerRunDirectories(runPaths);
  const sources = collectPlannerSources({
    config,
    lanePaths,
    task: request.task,
    fromWave: request.fromWave,
  });
  const plannerContext7Selection = resolvePlannerContext7Selection({
    config,
    lanePaths,
    bundleIndex,
    request,
  });
  const plannerContext7Prefetch = await prefetchContext7ForSelection(plannerContext7Selection, {
    lanePaths,
    cacheDir: lanePaths.context7CacheDir,
  });
  const promptText = buildPlannerPromptText({
    request,
    sources,
    profile,
    bundleIndex,
    matrix,
    plannerContext7: {
      selection: plannerContext7Selection,
      prefetch: plannerContext7Prefetch,
    },
  });
  writeJsonAtomic(runPaths.requestPath, request);
  writeJsonAtomic(runPaths.sourcesPath, {
    schemaVersion: AGENTIC_PLANNER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sources,
    plannerContext7: {
      selection: plannerContext7Selection,
      prefetch: {
        mode: plannerContext7Prefetch.mode,
        warning: plannerContext7Prefetch.warning,
        snippetHash: plannerContext7Prefetch.snippetHash,
      },
    },
  });
  writeTextAtomic(runPaths.promptPath, `${promptText}\n`);
  const attempts = [];
  const maxReplanIterations =
    config.planner?.agentic?.maxReplanIterations || DEFAULT_PLANNER_AGENTIC_MAX_REPLAN_ITERATIONS;
  let plan = null;
  let verification = null;
  let waveArtifacts = [];
  let previewMatrix = null;
  let plannerSource = null;
  let plannerRuntime = null;
  let lastError = null;
  for (let attempt = 0; attempt <= maxReplanIterations; attempt += 1) {
    try {
      const attemptSource =
        attempt === 0
          ? resolvePlannerFixturePayload() ||
            runPlannerCodexExecutor({
              lanePaths,
              plannerExecutorProfile,
              promptText,
              runPaths,
            })
          : {
              source: "heuristic-replan",
              rawPayload: buildHeuristicPlannerPayload({
                request,
                sources,
                matrix,
                bundleIndex,
              }),
            };
      plannerSource = attemptSource.source;
      plannerRuntime = attemptSource.runtime || plannerRuntime;
      plan = normalizePlannerPlanPayload(attemptSource.rawPayload, {
        fromWave: request.fromWave,
        maxWaves: request.maxWaves,
        lane: lanePaths.lane,
        matrix,
        bundleIndex,
      });
      const artifactBundle = writePlannerCandidateArtifacts({
        plan,
        config,
        lanePaths,
        profile,
        matrix,
        runPaths,
      });
      waveArtifacts = artifactBundle.waveArtifacts;
      previewMatrix = artifactBundle.previewMatrix;
      verification = validateAgenticPlanArtifacts({
        waveArtifacts,
        matrix,
        lanePaths,
        bundleIndex,
      });
      attempts.push({
        attempt,
        source: plannerSource,
        ok: verification.ok,
        errors: verification.errors,
      });
      if (verification.ok) {
        break;
      }
      lastError = new Error(verification.errors.join("; "));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempts.push({
        attempt,
        source: plannerSource || (attempt === 0 ? "executor" : "heuristic-replan"),
        ok: false,
        errors: [lastError.message],
      });
    }
  }
  if (!plan || !verification) {
    verification = {
      ok: false,
      errors: [lastError?.message || "Planner did not produce a usable plan"],
      warnings: [],
    };
  }
  writeJsonAtomic(runPaths.planPath, {
    schemaVersion: AGENTIC_PLANNER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: plannerSource || "failed",
    runtime: plannerRuntime,
    summary: plan?.summary || null,
    openQuestions: plan?.openQuestions || [],
    waveOrder: plan?.waveOrder || [],
    waves: plan?.waves || [],
    attempts,
  });
  writeJsonAtomic(
    runPaths.verificationPath,
    buildPlannerVerificationPayload({
      plan: plan || { summary: "", waveOrder: [] },
      verification,
      waveArtifacts,
      runPaths,
    }),
  );
  const state = verification.ok ? "planned" : "failed";
  const resultPayload = {
    schemaVersion: AGENTIC_PLANNER_SCHEMA_VERSION,
    runId: runPaths.runId,
    generatedAt: new Date().toISOString(),
    state,
    lane: lanePaths.lane,
    plannerSource,
    plannerExecutorProfile,
    attempts,
    waveOrder: plan?.waveOrder || [],
    openQuestions: plan?.openQuestions || [],
    plannerContext7: {
      bundleId: plannerContext7Selection.bundleId,
      query: plannerContext7Selection.query,
      mode: plannerContext7Prefetch.mode,
      warning: plannerContext7Prefetch.warning,
      snippetHash: plannerContext7Prefetch.snippetHash,
    },
    paths: {
      requestPath: repoRelativePath(runPaths.requestPath),
      sourcesPath: repoRelativePath(runPaths.sourcesPath),
      promptPath: repoRelativePath(runPaths.promptPath),
      planPath: repoRelativePath(runPaths.planPath),
      verificationPath: repoRelativePath(runPaths.verificationPath),
      resultPath: repoRelativePath(runPaths.resultPath),
      candidateDir: repoRelativePath(runPaths.candidateDir),
      previewMatrixJsonPath: repoRelativePath(runPaths.previewMatrixJsonPath),
      previewMatrixDocPath: repoRelativePath(runPaths.previewMatrixDocPath),
    },
    previewMatrixAvailable: Boolean(previewMatrix),
  };
  writeJsonAtomic(runPaths.resultPath, resultPayload);
  updateProjectProfile(
    (current) => ({
      ...current,
      plannerDefaults: {
        ...(current.plannerDefaults || {}),
        lane: lanePaths.lane,
      },
    }),
    { config, project: projectId },
  );
  return resultPayload;
}

async function runApplyPlannerRun(options = {}) {
  const bundle = loadPlannerRunBundle(options.runId);
  if (!PLANNER_RESULT_STATES.has(cleanText(bundle.result.state))) {
    throw new Error(`Planner run ${bundle.runPaths.runId} is in an unknown state`);
  }
  if (bundle.result.state === "failed" && !options.force) {
    throw new Error(
      `Planner run ${bundle.runPaths.runId} failed verification. Re-run with --force only if you intentionally want to materialize it anyway.`,
    );
  }
  const config = options.config || loadWaveConfig();
  const projectId =
    cleanText(options.project) ||
    cleanText(bundle.request.project) ||
    cleanText(bundle.result?.project) ||
    config.defaultProject;
  const lanePaths = buildLanePaths(bundle.request.lane, { config, project: projectId });
  const selectedWaves = parsePlannerWaveSelection(options.waves, bundle.plan?.waveOrder || []);
  if (selectedWaves.length === 0) {
    throw new Error("No waves selected for apply");
  }
  const selectedArtifacts = [];
  let matrix = loadComponentCutoverMatrix({ laneProfile: lanePaths.laneProfile });
  for (const waveNumber of selectedWaves.toSorted((left, right) => left - right)) {
    const candidateWavePath = path.join(bundle.runPaths.candidateWavesDir, `wave-${waveNumber}.md`);
    const candidateSpecPath = path.join(bundle.runPaths.candidateSpecsDir, `wave-${waveNumber}.json`);
    if (!fs.existsSync(candidateWavePath) || !fs.existsSync(candidateSpecPath)) {
      throw new Error(`Planner run ${bundle.runPaths.runId} is missing candidate files for wave ${waveNumber}`);
    }
    const canonicalPaths = ensureWavePaths(lanePaths, waveNumber);
    if (
      !options.force &&
      (fs.existsSync(canonicalPaths.wavePath) || fs.existsSync(canonicalPaths.specPath))
    ) {
      throw new Error(
        `Wave ${waveNumber} already exists. Re-run with --force to overwrite ${repoRelativePath(canonicalPaths.wavePath)} and ${repoRelativePath(canonicalPaths.specPath)}.`,
      );
    }
    const spec = readJsonOrNull(candidateSpecPath);
    matrix = upsertComponentMatrix(matrix, spec);
    selectedArtifacts.push({
      wave: waveNumber,
      candidateWavePath,
      candidateSpecPath,
      canonicalPaths,
      spec,
    });
  }
  writeJsonAtomic(path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixJsonPath), matrix);
  writeTextAtomic(
    path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixDocPath),
    `${renderComponentMatrixMarkdown(matrix)}\n`,
  );
  const applied = [];
  for (const artifact of selectedArtifacts) {
    ensureDirectory(path.dirname(artifact.canonicalPaths.specPath));
    writeTextAtomic(artifact.canonicalPaths.wavePath, fs.readFileSync(artifact.candidateWavePath, "utf8"));
    writeTextAtomic(artifact.canonicalPaths.specPath, fs.readFileSync(artifact.candidateSpecPath, "utf8"));
    const parsedWave = parseWaveFile(artifact.canonicalPaths.wavePath, { laneProfile: lanePaths.laneProfile });
    validateWaveDefinition(
      applyExecutorSelectionsToWave(parsedWave, { laneProfile: lanePaths.laneProfile }),
      { laneProfile: lanePaths.laneProfile },
    );
    applied.push({
      wave: artifact.wave,
      markdownPath: repoRelativePath(artifact.canonicalPaths.wavePath),
      specPath: repoRelativePath(artifact.canonicalPaths.specPath),
    });
  }
  const priorAppliedWaves = new Set(Array.isArray(bundle.result.appliedWaves) ? bundle.result.appliedWaves : []);
  for (const entry of applied) {
    priorAppliedWaves.add(entry.wave);
  }
  const nextResult = {
    ...bundle.result,
    state: "applied",
    appliedAt: new Date().toISOString(),
    appliedWaves: Array.from(priorAppliedWaves).sort((left, right) => left - right),
    applied,
    matrixJsonPath: repoRelativePath(path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixJsonPath)),
    matrixDocPath: repoRelativePath(path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixDocPath)),
  };
  writeJsonAtomic(bundle.runPaths.resultPath, nextResult);
  return nextResult;
}

function showPlannerRun(options = {}) {
  const bundle = loadPlannerRunBundle(options.runId);
  return {
    runId: bundle.runPaths.runId,
    request: bundle.request,
    sources: bundle.sources,
    plan: bundle.plan,
    verification: bundle.verification,
    result: bundle.result,
  };
}

async function ensureProjectProfile(options = {}) {
  const config = options.config || loadWaveConfig();
  const existing = readProjectProfile({ config, project: options.project });
  if (existing) {
    return existing;
  }
  return runProjectSetupFlow({
    config,
    project: options.project,
    json: false,
    fromDraft: true,
  });
}

async function runProjectSetupFlow(options = {}) {
  const config = options.config || loadWaveConfig();
  const projectId = cleanText(options.project || config.defaultProject);
  const existing = readProjectProfile({ config, project: projectId });
  const base = existing || buildDefaultProjectProfile(config);
  const prompt = new PromptSession();
  try {
    const projectLanes = Object.keys(config.projects?.[projectId]?.lanes || {});
    const laneChoices = Array.from(
      new Set([config.defaultLane, ...projectLanes, ...Object.keys(config.lanes || {})].filter(Boolean)),
    );
    stderr.write("\n  Wave project setup — answer a few questions so Wave can tailor defaults for this repo.\n  Press Enter to accept the default shown in [brackets].\n\n");
    prompt.describe("Is this a fresh start, or has Wave been used in this repo before?");
    const newProject = await prompt.askBoolean("Treat this repository as a new project?", base.newProject);

    prompt.describe("\nShould you review agent progress yourself, or let them run autonomously?");
    prompt.describe("  oversight    — you review progress and approve risky steps (recommended)");
    prompt.describe("  dark-factory — agents run end-to-end without human checkpoints");
    const defaultOversightMode = normalizeOversightMode(
      await prompt.askChoice(
        "Default execution posture",
        PROJECT_OVERSIGHT_MODES,
        base.defaultOversightMode,
      ),
    );

    prompt.describe("\nHow do you want to follow live runs?");
    prompt.describe("Live agent execution stays process-backed either way; this only changes the operator surface.");
    prompt.describe("  vscode — VS Code gets temporary terminal entries for agent logs and dashboards");
    prompt.describe("  tmux   — terminal-native dashboard and projection surface with no VS Code integration");
    const defaultTerminalSurface = normalizeTerminalSurface(
      await prompt.askChoice(
        "Default terminal surface",
        PROJECT_PROFILE_TERMINAL_SURFACES,
        base.defaultTerminalSurface,
      ),
    );

    prompt.describe("\nWhat kind of work will waves usually do?");
    prompt.describe("  implementation — building features, fixing bugs, writing code (most common)");
    prompt.describe("  qa             — test coverage, test infrastructure, validation work");
    prompt.describe("  infra          — deployment, CI/CD, infrastructure changes");
    prompt.describe("  release        — versioning, changelog, release coordination");
    const template = normalizeDraftTemplate(
      await prompt.askChoice(
        "Default draft template",
        DRAFT_TEMPLATES,
        base.plannerDefaults.template,
      ),
    );

    prompt.describe("\nWhich lane should new waves go into? A lane is just an ordered sequence of waves.");
    prompt.describe("'main' is the default and usually fine to start with.");
    const lane = await prompt.askChoice(
      "Default draft lane",
      laneChoices,
      base.plannerDefaults.lane,
    );

    prompt.describe("\nDo you have deploy environments (e.g. staging, production) you want Wave to know about?");
    prompt.describe("This helps Wave attach the right deployment skills when agents do infra or release work.");
    prompt.describe("Supported providers: railway, docker-compose, kubernetes, ssh-manual.");
    prompt.describe("Use 'custom' for anything else (GitHub Actions, Vercel, Cloudflare, etc.).");
    prompt.describe("You can skip this now (enter 0) and add them later with 'wave project setup'.");
    const deployEnvironmentCount = await prompt.askInteger(
      "How many deploy environments should the planner remember?",
      base.deployEnvironments.length,
      { min: 0 },
    );
    const deployEnvironments = [];
    for (let index = 0; index < deployEnvironmentCount; index += 1) {
      const existingEnvironment = base.deployEnvironments[index] || null;
      const id = normalizeComponentId(
        await prompt.ask(
          `Deploy environment ${index + 1} id`,
          existingEnvironment?.id || (index === 0 ? "default" : `env-${index + 1}`),
        ),
        `deploy environment ${index + 1} id`,
      );
      const name = cleanText(
        await prompt.ask(`Deploy environment ${index + 1} name`, existingEnvironment?.name || id),
      );
      const kind = await prompt.askChoice(
        `Deploy environment ${index + 1} provider`,
        DEPLOY_ENVIRONMENT_KINDS,
        existingEnvironment?.kind || "custom",
      );
      const isDefault = await prompt.askBoolean(
        `Mark deploy environment ${id} as the default?`,
        existingEnvironment?.isDefault === true || (index === 0 && base.deployEnvironments.length === 0),
      );
      const notes = cleanText(
        await prompt.ask(
          `Deploy environment ${id} notes`,
          existingEnvironment?.notes || "",
        ),
      );
      deployEnvironments.push({
        id,
        name,
        kind,
        isDefault,
        notes: notes || null,
      });
    }
    const profile = writeProjectProfile(
      {
        ...base,
        newProject,
        defaultOversightMode,
        defaultTerminalSurface,
        deployEnvironments,
        plannerDefaults: {
          template,
          lane,
        },
      },
      { config, project: projectId },
    );
    return profile;
  } finally {
    await prompt.close();
  }
}

async function collectComponentPromotions({ prompt, matrix, template, waveNumber }) {
  const targetLevel = defaultTargetLevel(template);
  const promotionCount = await prompt.askInteger("How many component promotions belong in this wave?", 1, {
    min: 0,
  });
  const componentPromotions = [];
  const componentCatalog = [];
  for (let index = 0; index < promotionCount; index += 1) {
    const componentId = normalizeComponentId(
      await prompt.ask(
        `Promotion ${index + 1} component id`,
        index === 0 ? "new-component" : `component-${index + 1}`,
      ),
      `promotion ${index + 1} component id`,
    );
    const existing = matrix.components[componentId] || null;
    const title = cleanText(
      await prompt.ask(`Component ${componentId} title`, existing?.title || componentId),
    );
    const currentLevel = existing?.currentLevel
      ? existing.currentLevel
      : await prompt.askChoice(
          `Component ${componentId} current level`,
          matrix.levels,
          "inventoried",
        );
    const target = await prompt.askChoice(
      `Wave ${waveNumber} target level for ${componentId}`,
      matrix.levels,
      existing?.promotions?.find((promotion) => promotion.wave === waveNumber)?.target || targetLevel,
    );
    const canonicalDocs = normalizeRepoPathList(
      normalizeListText(
        await prompt.ask(
          `Canonical docs for ${componentId} (comma or | separated)`,
          (existing?.canonicalDocs || ["README.md"]).join(", "),
        ),
      ),
      `${componentId}.canonicalDocs`,
    );
    const proofSurfaces = normalizeListText(
      await prompt.ask(
        `Proof surfaces for ${componentId} (comma or | separated)`,
        (existing?.proofSurfaces || ["tests"]).join(", "),
      ),
    );
    componentPromotions.push({ componentId, targetLevel: target });
    componentCatalog.push({
      componentId,
      title,
      currentLevel,
      targetLevel: target,
      canonicalDocs,
      proofSurfaces,
    });
  }
  return { componentPromotions, componentCatalog };
}

async function collectWorkerAgents({
  prompt,
  template,
  profile,
  componentPromotions,
  waveNumber,
  lane,
  context7BundleChoices,
}) {
  const defaultRoleKind = defaultWorkerRoleKindForTemplate(template);
  const workerCount = await prompt.askInteger("How many worker agents should this wave include?", 1, {
    min: 1,
  });
  const agentDefaultsByIndex = Array.from({ length: workerCount }, (_, index) => ({
    agentId: `A${index + 1}`,
    title: defaultWorkerTitle(template, index),
  }));
  const workerAgents = [];
  for (let index = 0; index < workerCount; index += 1) {
    const defaults = agentDefaultsByIndex[index];
    const agentId = cleanText(await prompt.ask(`Worker ${index + 1} agent id`, defaults.agentId));
    const title = cleanText(await prompt.ask(`Worker ${agentId} title`, defaults.title));
    const roleKind = await prompt.askChoice(
      `Worker ${agentId} role kind`,
      ["design", "implementation", "qa", "infra", "deploy", "research", "security"],
      defaultRoleKind,
    );
    const executorProfile = await prompt.askChoice(
      `Worker ${agentId} executor profile`,
      ["implement-fast", "design-pass", "deep-review", "eval-tuning", "docs-pass", "ops-triage", "security-review"],
      defaultExecutorProfile(roleKind),
    );
    const ownedPaths = normalizeRepoPathList(
      normalizeListText(
        await prompt.ask(
          `Worker ${agentId} owned paths (comma or | separated)`,
          roleKind === "security"
            ? `.tmp/${lane}-wave-launcher/security/wave-${waveNumber}-review.md`
            : roleKind === "design"
              ? `docs/plans/waves/design/wave-${waveNumber}-${agentId}.md`
            : template === "infra"
            ? "scripts/,docs/plans/"
            : template === "release"
              ? "CHANGELOG.md,README.md"
              : "README.md,scripts/",
        ),
      ),
      `${agentId}.ownedPaths`,
    );
    const components = normalizeListText(
      await prompt.ask(
        `Worker ${agentId} component ids (comma or | separated)`,
        roleKind === "security" || roleKind === "design"
          ? ""
          : componentPromotions.map((promotion) => promotion.componentId).join(", "),
      ),
    ).map((componentId) => normalizeComponentId(componentId, `${agentId}.components`));
    const capabilities = normalizeListText(
      await prompt.ask(
        `Worker ${agentId} capabilities (comma or | separated)`,
        roleKind === "implementation" ? "" : roleKind === "security" ? "security-review" : roleKind,
      ),
    );
    const additionalContext = normalizeRepoPathList(
      normalizeListText(
        await prompt.ask(
          `Worker ${agentId} additional required context docs (comma or | separated)`,
          template === "qa"
            ? "docs/plans/current-state.md,docs/plans/master-plan.md"
            : "docs/plans/current-state.md",
        ),
      ),
      `${agentId}.requiredContext`,
    );
    const earlierWaveOutputs = normalizeRepoPathList(
      normalizeListText(
        await prompt.ask(`Worker ${agentId} earlier wave outputs to read (comma or | separated)`, ""),
      ),
      `${agentId}.earlierWaveOutputs`,
    );
    const requirements = normalizePipeList(
      await prompt.ask(
        `Worker ${agentId} requirements (use | between items)`,
        "Keep ownership explicit | Leave exact proof and doc deltas in the final output",
      ),
    );
    const validationCommand = cleanText(
      await prompt.ask(
        `Worker ${agentId} validation command`,
        buildDefaultValidationCommand(template, roleKind),
      ),
    );
    const outputSummary = cleanText(
      await prompt.ask(
        `Worker ${agentId} output summary`,
        buildDefaultOutputSummary(template, roleKind),
      ),
    );
    const primaryGoal = cleanText(
      await prompt.ask(
        `Worker ${agentId} primary goal`,
        buildDefaultPrimaryGoal(template, roleKind, title),
      ),
    );
    let deployEnvironmentId = null;
    if ((roleKind === "infra" || roleKind === "deploy") && profile.deployEnvironments.length > 0) {
      const deployChoices = ["none", ...profile.deployEnvironments.map((environment) => environment.id)];
      const defaultEnvironment =
        profile.deployEnvironments.find((environment) => environment.isDefault)?.id || "none";
      const selectedEnvironment = await prompt.askChoice(
        `Worker ${agentId} deploy environment`,
        deployChoices,
        defaultEnvironment,
      );
      deployEnvironmentId = selectedEnvironment === "none" ? null : selectedEnvironment;
    }
    const context7Bundle = await prompt.askChoice(
      `Worker ${agentId} Context7 bundle`,
      context7BundleChoices,
      "none",
    );
    const context7Query = cleanText(await prompt.ask(`Worker ${agentId} Context7 query`, ""));
    const exitDefaults = defaultExitContract(roleKind);
    const exitContract = exitDefaults
      ? {
          completion: await prompt.askChoice(
            `Worker ${agentId} exit completion`,
            EXIT_CONTRACT_COMPLETION_VALUES,
            exitDefaults.completion,
          ),
          durability: await prompt.askChoice(
            `Worker ${agentId} exit durability`,
            EXIT_CONTRACT_DURABILITY_VALUES,
            exitDefaults.durability,
          ),
          proof: await prompt.askChoice(
            `Worker ${agentId} exit proof`,
            EXIT_CONTRACT_PROOF_VALUES,
            exitDefaults.proof,
          ),
          docImpact: await prompt.askChoice(
            `Worker ${agentId} exit doc impact`,
            EXIT_CONTRACT_DOC_IMPACT_VALUES,
            exitDefaults.docImpact,
          ),
        }
      : null;
    workerAgents.push({
      agentId,
      title,
      roleKind,
      executorProfile,
      ownedPaths,
      components,
      capabilities,
      additionalContext,
      earlierWaveOutputs,
      requirements,
      validationCommand,
      outputSummary,
      primaryGoal,
      deployEnvironmentId,
      context7Bundle,
      context7Query,
      exitContract,
    });
  }
  return workerAgents;
}

async function collectEvalTargets({ prompt }) {
  const targetCount = await prompt.askInteger(
    "How many eval targets should cont-EVAL own?",
    1,
    { min: 1 },
  );
  const evalTargets = [];
  for (let index = 0; index < targetCount; index += 1) {
    const id = normalizeComponentId(
      await prompt.ask(`Eval target ${index + 1} id`, index === 0 ? "service-output" : `eval-target-${index + 1}`),
      `eval target ${index + 1} id`,
    );
    const selection = await prompt.askChoice(
      `Eval target ${id} benchmark selection`,
      ["delegated", "pinned"],
      "delegated",
    );
    const benchmarkFamily =
      selection === "delegated"
        ? normalizeComponentId(
            await prompt.ask(`Eval target ${id} benchmark family`, "service-output"),
            `eval target ${id} benchmark family`,
          )
        : null;
    const benchmarks =
      selection === "pinned"
        ? normalizeListText(
            await prompt.ask(
              `Eval target ${id} benchmark ids (comma or | separated)`,
              "golden-response-smoke, manual-session-review",
            ),
          ).map((entry) => normalizeComponentId(entry, `eval target ${id} benchmark id`))
        : [];
    const objective = cleanText(
      await prompt.ask(`Eval target ${id} objective`, "Improve the observable service output against the selected benchmark set."),
    );
    const threshold = cleanText(
      await prompt.ask(`Eval target ${id} success threshold`, "All selected checks green with no unresolved regressions."),
    );
    evalTargets.push({
      id,
      selection,
      benchmarkFamily,
      benchmarks,
      objective,
      threshold,
    });
  }
  return evalTargets;
}

async function runDraftFlow(options = {}) {
  const config = options.config || loadWaveConfig();
  const projectId = options.project || config.defaultProject;
  const profile = await ensureProjectProfile({ config, project: projectId });
  const waveNumber = options.wave;
  const lane = options.lane || profile.plannerDefaults.lane || config.defaultLane;
  const lanePaths = buildLanePaths(lane, { config, project: projectId });
  const matrix = loadComponentCutoverMatrix({ laneProfile: lanePaths.laneProfile });
  const bundleIndex = loadContext7BundleIndex(lanePaths.context7BundleIndexPath);
  const context7BundleChoices = Object.keys(bundleIndex.bundles || {}).sort((left, right) =>
    left.localeCompare(right),
  );
  const template = normalizeDraftTemplate(options.template || profile.plannerDefaults.template);
  const prompt = new PromptSession();
  try {
    const { wavePath, specPath } = ensureWavePaths(lanePaths, waveNumber);
    if (!options.force && (fs.existsSync(wavePath) || fs.existsSync(specPath))) {
      throw new Error(
        `Wave ${waveNumber} already exists. Re-run with --force to overwrite ${path.relative(REPO_ROOT, wavePath)} and ${path.relative(REPO_ROOT, specPath)}.`,
      );
    }
    const title = cleanText(
      await prompt.ask(
        "Wave title",
        template === "qa"
          ? "QA Closure"
          : template === "infra"
            ? "Infra Planning Slice"
            : template === "release"
              ? "Release Readiness"
              : "Implementation Slice",
      ),
    );
    const commitMessage = cleanText(
      await prompt.ask(
        "Commit message",
        template === "release"
          ? "Release: prepare next cut"
          : template === "qa"
            ? "Test: validate planned slice"
            : "Feat: land planned slice",
      ),
    );
    const sequencingNote = cleanText(await prompt.ask("Sequencing note", ""));
    const referenceRule = cleanText(await prompt.ask("Reference rule", ""));
    const oversightMode = normalizeOversightMode(
      await prompt.askChoice(
        "Wave execution posture",
        PROJECT_OVERSIGHT_MODES,
        profile.defaultOversightMode,
      ),
    );
    const context7Bundle = await prompt.askChoice(
      "Wave Context7 bundle",
      context7BundleChoices,
      "none",
    );
    const context7Query = cleanText(await prompt.ask("Wave Context7 query", ""));
    const standardRoles = {
      contQa: await prompt.askBoolean("Use the standard cont-QA role?", true),
      contEval: await prompt.askBoolean("Include the standard cont-EVAL role?", false),
      integration: await prompt.askBoolean("Use the standard integration role?", true),
      documentation: await prompt.askBoolean("Use the standard documentation role?", true),
    };
    const evalTargets = standardRoles.contEval
      ? await collectEvalTargets({ prompt })
      : [];
    const { componentPromotions, componentCatalog } = await collectComponentPromotions({
      prompt,
      matrix,
      template,
      waveNumber,
    });
    const workerAgents = await collectWorkerAgents({
      prompt,
      template,
      profile,
      componentPromotions,
      waveNumber,
      lane: lanePaths.lane,
      context7BundleChoices,
    });
    const draftValues = {
      wave: waveNumber,
      lane: lanePaths.lane,
      template,
      title,
      commitMessage,
      sequencingNote,
      referenceRule,
      oversightMode,
      context7Bundle,
      context7Query,
      standardRoles,
      evalTargets,
      componentPromotions,
      componentCatalog,
      workerAgents,
    };
    const spec = buildSpecPayload({
      config,
      lanePaths,
      profile,
      draftValues,
    });
    const markdown = renderWaveMarkdown(spec, lanePaths);
    const nextMatrixPayload = upsertComponentMatrix(matrix, spec);
    ensureDirectory(path.dirname(specPath));
    writeJsonAtomic(specPath, spec);
    writeTextAtomic(wavePath, markdown);
    writeJsonAtomic(path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixJsonPath), nextMatrixPayload);
    writeTextAtomic(
      path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixDocPath),
      `${renderComponentMatrixMarkdown(nextMatrixPayload)}\n`,
    );
    const parsedWave = parseWaveFile(wavePath, { laneProfile: lanePaths.laneProfile });
    validateWaveDefinition(
      applyExecutorSelectionsToWave(parsedWave, { laneProfile: lanePaths.laneProfile }),
      { laneProfile: lanePaths.laneProfile },
    );
    updateProjectProfile(
      (current) => ({
        ...current,
        plannerDefaults: {
          template,
          lane: lanePaths.lane,
        },
      }),
      { config, project: projectId },
    );
    return {
      project: projectId,
      wave: waveNumber,
      lane: lanePaths.lane,
      template,
      wavePath: path.relative(REPO_ROOT, wavePath),
      specPath: path.relative(REPO_ROOT, specPath),
      matrixJsonPath: path.relative(REPO_ROOT, path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixJsonPath)),
      matrixDocPath: path.relative(REPO_ROOT, path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixDocPath)),
      profilePath: path.relative(REPO_ROOT, projectProfilePath(projectId)),
    };
  } finally {
    await prompt.close();
  }
}

function printPlannerHelp() {
  console.log(`Usage:
  wave project setup [--project <id>] [--json]
  wave project show [--project <id>] [--json]
  wave draft --wave <n> [--project <id>] [--lane <lane>] [--template implementation|qa|infra|release] [--force] [--json]
  wave draft --agentic --task "<text>" --from-wave <n> [--project <id>] [--lane <lane>] [--max-waves <n>] [--planner-executor <profile>] [--json]
  wave draft --show-run <run-id> [--json]
  wave draft --apply-run <run-id> [--project <id>] [--waves <list>|all] [--force] [--json]
`);
}

export async function runPlannerCli(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const subcommand = cleanText(args.shift()).toLowerCase();
  const options = {
    json: false,
    force: false,
    wave: null,
    project: null,
    lane: null,
    template: null,
    agentic: false,
    task: null,
    fromWave: null,
    maxWaves: null,
    plannerExecutorProfile: null,
    showRun: null,
    applyRun: null,
    waves: null,
  };
  if (!subcommand) {
    printPlannerHelp();
    return;
  }
  if (subcommand === "project") {
    const action = cleanText(args.shift()).toLowerCase();
    for (const arg of args) {
      if (arg === "--json") {
        options.json = true;
      } else if (arg === "--project") {
        options.project = cleanText(args.shift());
      } else if (arg === "--help" || arg === "-h") {
        printPlannerHelp();
        return;
      } else {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
    if (action === "setup") {
      const projectId = options.project || loadWaveConfig().defaultProject;
      const profile = await runProjectSetupFlow({ json: options.json, project: projectId });
      if (options.json) {
        printJson({
          profilePath: path.relative(REPO_ROOT, projectProfilePath(projectId)),
          profile,
        });
        return;
      }
      console.log(`[wave:project] profile: ${path.relative(REPO_ROOT, projectProfilePath(projectId))}`);
      console.log(`[wave:project] project_id=${projectId}`);
      console.log(`[wave:project] lane=${profile.plannerDefaults.lane}`);
      console.log(`[wave:project] template=${profile.plannerDefaults.template}`);
      console.log(`[wave:project] oversight=${profile.defaultOversightMode}`);
      console.log(`[wave:project] terminal_surface=${profile.defaultTerminalSurface}`);
      return;
    }
    if (action === "show") {
      const projectId = options.project || loadWaveConfig().defaultProject;
      const profile = readProjectProfile({ project: projectId });
      if (options.json) {
        printJson({
          profilePath: path.relative(REPO_ROOT, projectProfilePath(projectId)),
          profile,
        });
        return;
      }
      if (!profile) {
        console.log(`[wave:project] no saved profile at ${path.relative(REPO_ROOT, projectProfilePath(projectId))}`);
        return;
      }
      console.log(`[wave:project] profile: ${path.relative(REPO_ROOT, projectProfilePath(projectId))}`);
      console.log(`[wave:project] project_id=${projectId}`);
      console.log(`[wave:project] project=${profile.source.projectName}`);
      console.log(`[wave:project] lane=${profile.plannerDefaults.lane}`);
      console.log(`[wave:project] template=${profile.plannerDefaults.template}`);
      console.log(`[wave:project] new_project=${profile.newProject ? "yes" : "no"}`);
      console.log(`[wave:project] deploy_envs=${profile.deployEnvironments.length}`);
      return;
    }
    throw new Error(`Unknown project action: ${action || "(empty)"}`);
  }
  if (subcommand !== "draft") {
    throw new Error(`Unknown planner subcommand: ${subcommand}`);
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--agentic") {
      options.agentic = true;
    } else if (arg === "--task") {
      options.task = cleanText(args[++index]);
    } else if (arg === "--from-wave") {
      options.fromWave = Number.parseInt(String(args[++index] || ""), 10);
    } else if (arg === "--max-waves") {
      options.maxWaves = Number.parseInt(String(args[++index] || ""), 10);
    } else if (arg === "--planner-executor") {
      options.plannerExecutorProfile = cleanText(args[++index]);
    } else if (arg === "--show-run") {
      options.showRun = cleanText(args[++index]);
    } else if (arg === "--apply-run") {
      options.applyRun = cleanText(args[++index]);
    } else if (arg === "--waves") {
      options.waves = cleanText(args[++index]);
    } else if (arg === "--wave") {
      options.wave = Number.parseInt(String(args[++index] || ""), 10);
    } else if (arg === "--project") {
      options.project = cleanText(args[++index]);
    } else if (arg === "--lane") {
      options.lane = cleanText(args[++index]);
    } else if (arg === "--template") {
      options.template = cleanText(args[++index]);
    } else if (arg === "--help" || arg === "-h") {
      printPlannerHelp();
      return;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.showRun && options.applyRun) {
    throw new Error("--show-run and --apply-run are mutually exclusive.");
  }
  if (options.showRun) {
    const result = showPlannerRun({ runId: options.showRun });
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`[wave:draft] run=${result.runId}`);
    console.log(`[wave:draft] state=${result.result?.state || "unknown"}`);
    console.log(`[wave:draft] lane=${result.request?.lane || "unknown"}`);
    console.log(`[wave:draft] waves=${(result.plan?.waveOrder || []).join(", ") || "none"}`);
    return;
  }
  if (options.applyRun) {
    const result = await runApplyPlannerRun({
      ...options,
      runId: options.applyRun,
    });
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`[wave:draft] run=${result.runId}`);
    console.log(`[wave:draft] state=${result.state}`);
    console.log(`[wave:draft] applied_waves=${(result.appliedWaves || []).join(", ")}`);
    console.log(`[wave:draft] matrix_json=${result.matrixJsonPath}`);
    console.log(`[wave:draft] matrix_md=${result.matrixDocPath}`);
    return;
  }
  if (options.agentic) {
    if (!cleanText(options.task)) {
      throw new Error("--task \"...\" is required for `wave draft --agentic`.");
    }
    if (!Number.isFinite(options.fromWave) || options.fromWave < 0) {
      throw new Error("--from-wave <n> is required for `wave draft --agentic`.");
    }
    const result = await runAgenticDraftFlow(options);
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`[wave:draft] run=${result.runId}`);
    console.log(`[wave:draft] state=${result.state}`);
    console.log(`[wave:draft] lane=${result.lane}`);
    console.log(`[wave:draft] planner_source=${result.plannerSource || "unknown"}`);
    console.log(`[wave:draft] waves=${(result.waveOrder || []).join(", ") || "none"}`);
    console.log(`[wave:draft] candidate_dir=${result.paths.candidateDir}`);
    return;
  }
  if (!Number.isFinite(options.wave) || options.wave < 0) {
    throw new Error("--wave <n> is required for `wave draft`.");
  }
  const result = await runDraftFlow(options);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`[wave:draft] wave=${result.wave}`);
  console.log(`[wave:draft] lane=${result.lane}`);
  console.log(`[wave:draft] template=${result.template}`);
  console.log(`[wave:draft] markdown=${result.wavePath}`);
  console.log(`[wave:draft] spec=${result.specPath}`);
  console.log(`[wave:draft] matrix_json=${result.matrixJsonPath}`);
  console.log(`[wave:draft] matrix_md=${result.matrixDocPath}`);
}
