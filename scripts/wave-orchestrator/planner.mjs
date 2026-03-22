import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { EXIT_CONTRACT_COMPLETION_VALUES, EXIT_CONTRACT_DOC_IMPACT_VALUES, EXIT_CONTRACT_DURABILITY_VALUES, EXIT_CONTRACT_PROOF_VALUES } from "./agent-state.mjs";
import { loadWaveConfig } from "./config.mjs";
import { loadComponentCutoverMatrix, parseWaveFile, requiredDocumentationStewardPathsForWave, SHARED_PLAN_DOC_PATHS, validateWaveDefinition, applyExecutorSelectionsToWave } from "./wave-files.mjs";
import { buildLanePaths, ensureDirectory, REPO_ROOT, writeJsonAtomic, writeTextAtomic } from "./shared.mjs";
import {
  DEPLOY_ENVIRONMENT_KINDS,
  DRAFT_TEMPLATES,
  buildDefaultProjectProfile,
  normalizeDraftTemplate,
  normalizeOversightMode,
  PROJECT_OVERSIGHT_MODES,
  PROJECT_PROFILE_PATH,
  PROJECT_PROFILE_TERMINAL_SURFACES,
  readProjectProfile,
  updateProjectProfile,
  writeProjectProfile,
} from "./project-profile.mjs";
import { normalizeTerminalSurface } from "./terminals.mjs";

const COMPONENT_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const WAVE_SPEC_SCHEMA_VERSION = 1;
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
  if (roleKind === "infra" || roleKind === "deploy" || roleKind === "research") {
    return "ops-triage";
  }
  return "implement-fast";
}

function defaultExitContract(roleKind) {
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
  if (template === "qa" || roleKind === "qa") {
    return "pnpm test";
  }
  if (roleKind === "infra" || roleKind === "deploy") {
    return "pnpm exec wave launch --dry-run --no-dashboard";
  }
  return "pnpm test";
}

function buildDefaultOutputSummary(template, roleKind) {
  if (template === "qa" || roleKind === "qa") {
    return "Summarize the proved QA coverage, the remaining gaps, and whether the wave is closure-ready.";
  }
  if (roleKind === "infra" || roleKind === "deploy") {
    return "Summarize the environment proof, operator-visible risks, and rollback posture.";
  }
  return "Summarize the landed implementation, proof status, and exact follow-up owners.";
}

function buildDefaultPrimaryGoal(template, roleKind, title) {
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
  const lines = [];
  if (agent.executor?.profile) {
    lines.push(`- profile: ${agent.executor.profile}`);
  }
  if (agent.executor?.id) {
    lines.push(`- id: ${agent.executor.id}`);
  }
  if (agent.executor?.model) {
    lines.push(`- model: ${agent.executor.model}`);
  }
  if (Array.isArray(agent.executor?.fallbacks) && agent.executor.fallbacks.length > 0) {
    lines.push(`- fallbacks: ${agent.executor.fallbacks.join(", ")}`);
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

function renderWaveMarkdown(spec, lanePaths) {
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
  const evaluatorTitle = standardRoles.evaluator ? "Running Evaluator" : "Custom Evaluator";
  const integrationTitle = standardRoles.integration ? "Integration Steward" : "Custom Integration Steward";
  const documentationTitle = standardRoles.documentation
    ? "Documentation Steward"
    : "Custom Documentation Steward";
  return [
    {
      agentId: lanePaths.evaluatorAgentId,
      title: evaluatorTitle,
      rolePromptPaths: [lanePaths.evaluatorRolePromptPath],
      skills: [],
      executor: { profile: "deep-review" },
      context7: { bundle: "none", query: "Architecture evaluation only; repository docs remain canonical" },
      components: [],
      capabilities: [],
      exitContract: null,
      primaryGoal: `Evaluate Wave ${spec.wave} and publish the final verdict.`,
      collaborationNotes: [
        "Collect explicit verdicts from the implementation-facing agents plus A8 and A9 before closing the wave.",
        "Do not publish PASS unless the evidence, documentation closure, and integration summary are all coherent.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: [`docs/plans/waves/reviews/wave-${spec.wave}-evaluator.md`],
      requirements: [
        "Verify the wave requirements are covered by landed evidence, not only by intent.",
        "Record any blocker that later waves must not silently assume away.",
      ],
      validationCommand:
        "Re-read the changed reports and end the evaluator report with `Verdict: PASS`, `Verdict: CONCERNS`, or `Verdict: BLOCKED`.",
      outputSummary: "Summarize the gate verdict and the top unresolved cross-cutting risks.",
      deployEnvironmentId: null,
    },
    {
      agentId: lanePaths.integrationAgentId,
      title: integrationTitle,
      rolePromptPaths: [lanePaths.integrationRolePromptPath],
      skills: [],
      executor: { profile: "deep-review" },
      context7: { bundle: "none", query: "Integration synthesis only; repository docs remain canonical" },
      components: [],
      capabilities: ["integration", "docs-shared-plan"],
      exitContract: null,
      primaryGoal: `Synthesize the final Wave ${spec.wave} state before documentation and evaluator closure.`,
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
  if (roleKind === "infra" && !capabilities.includes("infra")) {
    capabilities.push("infra");
  }
  if (roleKind === "deploy" && !capabilities.includes("deploy")) {
    capabilities.push("deploy");
  }
  if (roleKind === "research" && !capabilities.includes("research")) {
    capabilities.push("research");
  }
  return {
    agentId,
    title,
    rolePromptPaths: [],
    skills: values.skills || [],
    executor: {
      profile: values.executorProfile,
    },
    context7: {
      bundle: values.context7Bundle,
      query: values.context7Query || null,
    },
    components: values.components,
    capabilities,
    exitContract: values.exitContract,
    primaryGoal:
      values.primaryGoal || buildDefaultPrimaryGoal(template, roleKind, title),
    collaborationNotes: [
      "Re-read the wave message board before major decisions, before validation, and before final output.",
      `Notify Agent ${lanePaths.evaluatorAgentId} when your evidence changes the closure picture.`,
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

async function ensureProjectProfile(options = {}) {
  const config = options.config || loadWaveConfig();
  const existing = readProjectProfile({ config });
  if (existing) {
    return existing;
  }
  return runProjectSetupFlow({
    config,
    json: false,
    fromDraft: true,
  });
}

async function runProjectSetupFlow(options = {}) {
  const config = options.config || loadWaveConfig();
  const existing = readProjectProfile({ config });
  const base = existing || buildDefaultProjectProfile(config);
  const prompt = new PromptSession();
  try {
    const laneChoices = Array.from(
      new Set([config.defaultLane, ...Object.keys(config.lanes || {})].filter(Boolean)),
    );
    const newProject = await prompt.askBoolean("Treat this repository as a new project?", base.newProject);
    const defaultOversightMode = normalizeOversightMode(
      await prompt.askChoice(
        "Default execution posture",
        PROJECT_OVERSIGHT_MODES,
        base.defaultOversightMode,
      ),
    );
    const defaultTerminalSurface = normalizeTerminalSurface(
      await prompt.askChoice(
        "Default terminal surface",
        PROJECT_PROFILE_TERMINAL_SURFACES,
        base.defaultTerminalSurface,
      ),
    );
    const template = normalizeDraftTemplate(
      await prompt.askChoice(
        "Default draft template",
        DRAFT_TEMPLATES,
        base.plannerDefaults.template,
      ),
    );
    const lane = await prompt.askChoice(
      "Default draft lane",
      laneChoices,
      base.plannerDefaults.lane,
    );
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
      { config },
    );
    return profile;
  } finally {
    await prompt.close();
  }
}

async function collectComponentPromotions({ prompt, matrix, template, waveNumber }) {
  const targetLevel = defaultTargetLevel(template);
  const promotionCount = await prompt.askInteger("How many component promotions belong in this wave?", 1, {
    min: 1,
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

async function collectWorkerAgents({ prompt, template, profile, componentPromotions, waveNumber }) {
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
      ["implementation", "qa", "infra", "deploy", "research"],
      defaultRoleKind,
    );
    const executorProfile = await prompt.askChoice(
      `Worker ${agentId} executor profile`,
      ["implement-fast", "deep-review", "docs-pass", "ops-triage"],
      defaultExecutorProfile(roleKind),
    );
    const ownedPaths = normalizeRepoPathList(
      normalizeListText(
        await prompt.ask(
          `Worker ${agentId} owned paths (comma or | separated)`,
          template === "infra"
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
        componentPromotions.map((promotion) => promotion.componentId).join(", "),
      ),
    ).map((componentId) => normalizeComponentId(componentId, `${agentId}.components`));
    const capabilities = normalizeListText(
      await prompt.ask(`Worker ${agentId} capabilities (comma or | separated)`, roleKind === "implementation" ? "" : roleKind),
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
      ["none"],
      "none",
    );
    const context7Query = cleanText(await prompt.ask(`Worker ${agentId} Context7 query`, ""));
    const exitDefaults = defaultExitContract(roleKind);
    const exitContract = {
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
    };
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

async function runDraftFlow(options = {}) {
  const config = options.config || loadWaveConfig();
  const profile = await ensureProjectProfile({ config });
  const waveNumber = options.wave;
  const lane = options.lane || profile.plannerDefaults.lane || config.defaultLane;
  const lanePaths = buildLanePaths(lane, { config });
  const matrix = loadComponentCutoverMatrix({ laneProfile: lanePaths.laneProfile });
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
    const context7Bundle = await prompt.askChoice("Wave Context7 bundle", ["none"], "none");
    const context7Query = cleanText(await prompt.ask("Wave Context7 query", ""));
    const standardRoles = {
      evaluator: await prompt.askBoolean("Use the standard evaluator role?", true),
      integration: await prompt.askBoolean("Use the standard integration role?", true),
      documentation: await prompt.askBoolean("Use the standard documentation role?", true),
    };
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
      { config },
    );
    return {
      wave: waveNumber,
      lane: lanePaths.lane,
      template,
      wavePath: path.relative(REPO_ROOT, wavePath),
      specPath: path.relative(REPO_ROOT, specPath),
      matrixJsonPath: path.relative(REPO_ROOT, path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixJsonPath)),
      matrixDocPath: path.relative(REPO_ROOT, path.resolve(REPO_ROOT, lanePaths.componentCutoverMatrixDocPath)),
      profilePath: path.relative(REPO_ROOT, PROJECT_PROFILE_PATH),
    };
  } finally {
    await prompt.close();
  }
}

function printPlannerHelp() {
  console.log(`Usage:
  wave project setup [--json]
  wave project show [--json]
  wave draft --wave <n> [--lane <lane>] [--template implementation|qa|infra|release] [--force] [--json]
`);
}

export async function runPlannerCli(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const subcommand = cleanText(args.shift()).toLowerCase();
  const options = {
    json: false,
    force: false,
    wave: null,
    lane: null,
    template: null,
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
      } else if (arg === "--help" || arg === "-h") {
        printPlannerHelp();
        return;
      } else {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
    if (action === "setup") {
      const profile = await runProjectSetupFlow({ json: options.json });
      if (options.json) {
        printJson({
          profilePath: path.relative(REPO_ROOT, PROJECT_PROFILE_PATH),
          profile,
        });
        return;
      }
      console.log(`[wave:project] profile: ${path.relative(REPO_ROOT, PROJECT_PROFILE_PATH)}`);
      console.log(`[wave:project] lane=${profile.plannerDefaults.lane}`);
      console.log(`[wave:project] template=${profile.plannerDefaults.template}`);
      console.log(`[wave:project] oversight=${profile.defaultOversightMode}`);
      console.log(`[wave:project] terminal_surface=${profile.defaultTerminalSurface}`);
      return;
    }
    if (action === "show") {
      const profile = readProjectProfile();
      if (options.json) {
        printJson({
          profilePath: path.relative(REPO_ROOT, PROJECT_PROFILE_PATH),
          profile,
        });
        return;
      }
      if (!profile) {
        console.log(`[wave:project] no saved profile at ${path.relative(REPO_ROOT, PROJECT_PROFILE_PATH)}`);
        return;
      }
      console.log(`[wave:project] profile: ${path.relative(REPO_ROOT, PROJECT_PROFILE_PATH)}`);
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
    } else if (arg === "--wave") {
      options.wave = Number.parseInt(String(args[++index] || ""), 10);
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
