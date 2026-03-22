import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { loadWaveConfig } from "./config.mjs";
import {
  buildDefaultProjectProfile,
  readProjectProfile,
} from "./project-profile.mjs";
import { runLauncherCli } from "./launcher.mjs";
import { renderWaveMarkdown } from "./planner.mjs";
import {
  applyExecutorSelectionsToWave,
  parseWaveFile,
  requiredDocumentationStewardPathsForWave,
  SHARED_PLAN_DOC_PATHS,
  validateWaveDefinition,
} from "./wave-files.mjs";
import {
  buildLanePaths,
  compactSingleLine,
  ensureDirectory,
  parseNonNegativeInt,
  readJsonOrNull,
  REPO_ROOT,
  sanitizeAdhocRunId,
  toIsoTimestamp,
  writeJsonAtomic,
  writeTextAtomic,
} from "./shared.mjs";

const ADHOC_SCHEMA_VERSION = 1;
const ADHOC_WAVE_NUMBER = 0;
const TASK_ROLE_VALUES = ["implementation", "research", "infra", "deploy"];
const SECURITY_KEYWORDS = [
  "auth",
  "authn",
  "authz",
  "permission",
  "secret",
  "token",
  "credential",
  "security",
  "vuln",
  "vulnerability",
  "inject",
  "injection",
  "xss",
  "csrf",
  "oauth",
  "login",
  "shell",
  "command",
  "file upload",
  "external input",
  "sensitive",
];
const EVAL_KEYWORDS = [
  "eval",
  "benchmark",
  "quality",
  "tune",
  "tuning",
  "score",
  "regression",
  "latency",
  "output",
  "compare",
];
const RESEARCH_KEYWORDS = [
  "investigate",
  "analysis",
  "analyze",
  "research",
  "root cause",
  "triage",
  "audit",
  "inspect",
  "review",
];
const DEPLOY_KEYWORDS = [
  "deploy",
  "deployment",
  "release",
  "rollout",
  "publish",
  "ship",
  "domain",
  "rollback",
  "production",
  "prod",
];
const INFRA_KEYWORDS = [
  "infra",
  "infrastructure",
  "environment",
  "env",
  "kubernetes",
  "docker",
  "compose",
  "cluster",
  "service",
  "ci",
  "workflow",
  "pipeline",
  "migration",
  "ops",
];
const DOC_KEYWORDS = [
  "doc",
  "docs",
  "readme",
  "guide",
  "reference",
  "changelog",
  "write up",
];
const PROVIDER_KEYWORDS = [
  ["railway", "railway-cli"],
  ["docker compose", "docker-compose"],
  ["docker-compose", "docker-compose"],
  ["kubernetes", "kubernetes"],
  ["k8s", "kubernetes"],
  ["aws", "aws"],
  ["github release", "github-release"],
  ["release artifact", "github-release"],
  ["ssh", "ssh-manual"],
];
const GENERATED_SPECIAL_AGENT_TITLES = new Set([
  "cont-QA",
  "cont-EVAL",
  "Integration Steward",
  "Documentation Steward",
  "Security Reviewer",
]);

function cleanText(value) {
  return String(value ?? "").trim();
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
    .replace(/^\.\/+/, "");
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return normalized;
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

function buildAdhocRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = crypto.randomBytes(3).toString("hex");
  return sanitizeAdhocRunId(`adhoc-${stamp}-${random}`);
}

function readEffectiveProjectProfile(config) {
  return readProjectProfile({ config }) || buildDefaultProjectProfile(config);
}

function detectKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function inferDeployKind(taskText, profile) {
  for (const [needle, kind] of PROVIDER_KEYWORDS) {
    if (taskText.includes(needle)) {
      return kind;
    }
  }
  if (Array.isArray(profile?.deployEnvironments) && profile.deployEnvironments.length > 0) {
    return (
      profile.deployEnvironments.find((entry) => entry.isDefault)?.kind ||
      profile.deployEnvironments[0]?.kind ||
      null
    );
  }
  if (detectKeyword(taskText, DEPLOY_KEYWORDS) || detectKeyword(taskText, INFRA_KEYWORDS)) {
    return "custom";
  }
  return null;
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
    let repoPath = null;
    try {
      repoPath = normalizeRepoRelativePath(normalized, "task path hint");
    } catch {
      return;
    }
    const lastSegment = repoPath.split("/").at(-1) || repoPath;
    const looksLikeFile = lastSegment.includes(".");
    matches.push(looksLikeFile || repoPath.endsWith("/") ? repoPath : `${repoPath}/`);
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

function fallbackOwnedPathsForRole(roleKind) {
  if (roleKind === "deploy") {
    return ["deploy/", ".github/", "scripts/", "docs/"];
  }
  if (roleKind === "infra") {
    return ["infra/", "ops/", "deploy/", "scripts/", ".github/", "docs/"];
  }
  if (roleKind === "research") {
    return ["docs/", "scripts/", "test/", "tests/"];
  }
  return [
    "README.md",
    "docs/",
    "scripts/",
    "src/",
    "app/",
    "lib/",
    "packages/",
    "services/",
    "test/",
    "tests/",
    "package.json",
  ];
}

function inferTaskRole(taskText) {
  if (detectKeyword(taskText, DEPLOY_KEYWORDS)) {
    return "deploy";
  }
  if (detectKeyword(taskText, INFRA_KEYWORDS)) {
    return "infra";
  }
  if (detectKeyword(taskText, RESEARCH_KEYWORDS)) {
    return "research";
  }
  return "implementation";
}

function inferTaskTitle(roleKind, taskText, index) {
  const compactTask = compactSingleLine(taskText, 80);
  if (detectKeyword(taskText, DOC_KEYWORDS) && roleKind === "implementation") {
    return `Documentation Task ${index + 1}`;
  }
  if (roleKind === "deploy") {
    return compactTask ? `Deploy Task ${index + 1}` : `Deploy Task ${index + 1}`;
  }
  if (roleKind === "infra") {
    return compactTask ? `Infra Task ${index + 1}` : `Infra Task ${index + 1}`;
  }
  if (roleKind === "research") {
    return compactTask ? `Research Task ${index + 1}` : `Research Task ${index + 1}`;
  }
  return compactTask ? `Implementation Task ${index + 1}` : `Implementation Task ${index + 1}`;
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
  return {
    completion: "contract",
    durability: "none",
    proof: "unit",
    docImpact: "owned",
  };
}

function defaultValidationCommand(roleKind) {
  if (roleKind === "research") {
    return "Manual review of captured evidence, exact findings, and named follow-up owners.";
  }
  if (roleKind === "infra" || roleKind === "deploy") {
    return "pnpm exec wave launch --dry-run --no-dashboard";
  }
  return "pnpm test";
}

function defaultOutputSummary(roleKind) {
  if (roleKind === "research") {
    return "Summarize the findings, the exact evidence consulted, and the recommended next owners.";
  }
  if (roleKind === "infra" || roleKind === "deploy") {
    return "Summarize the environment or rollout proof, the operator-visible risks, and rollback posture.";
  }
  return "Summarize the landed implementation, proof state, and exact follow-up owners.";
}

function deriveTemplate(workerRoles) {
  if (workerRoles.length > 0 && workerRoles.every((role) => role === "deploy")) {
    return "release";
  }
  if (workerRoles.length > 0 && workerRoles.every((role) => role === "infra")) {
    return "infra";
  }
  return "implementation";
}

function analyzeTask(task, index, profile, lanePaths) {
  const normalizedTask = cleanText(task);
  const loweredTask = normalizedTask.toLowerCase();
  const roleKind = inferTaskRole(loweredTask);
  const pathHints = extractRepoPathHints(normalizedTask);
  const sharedPlanDocs = new Set(lanePaths?.sharedPlanDocs || []);
  const nonSharedPlanPathHints = pathHints.filter((ownedPath) => !sharedPlanDocs.has(ownedPath));
  const touchesSharedPlanDocs = pathHints.some((ownedPath) => sharedPlanDocs.has(ownedPath));
  const ownedPaths =
    nonSharedPlanPathHints.length > 0 ? nonSharedPlanPathHints : fallbackOwnedPathsForRole(roleKind);
  return {
    index,
    task: normalizedTask,
    roleKind,
    title: inferTaskTitle(roleKind, normalizedTask, index),
    ownedPaths,
    needsSecurity:
      detectKeyword(loweredTask, SECURITY_KEYWORDS) ||
      roleKind === "deploy" ||
      roleKind === "infra",
    needsEval: detectKeyword(loweredTask, EVAL_KEYWORDS),
    docsHeavy:
      touchesSharedPlanDocs ||
      detectKeyword(loweredTask, DOC_KEYWORDS) ||
      ownedPaths.every((ownedPath) =>
        ["docs/", "README.md", "CHANGELOG.md"].some((prefix) => ownedPath.startsWith(prefix)),
      ),
    deployKind: inferDeployKind(loweredTask, profile),
  };
}

function resolveDeployEnvironments(profile, analyzedTasks) {
  const explicitKinds = uniqueStrings(
    analyzedTasks.map((task) => task.deployKind).filter(Boolean),
  );
  if (explicitKinds.length === 0) {
    return [];
  }
  if (Array.isArray(profile?.deployEnvironments) && profile.deployEnvironments.length > 0) {
    return profile.deployEnvironments
      .filter((environment) => explicitKinds.includes(environment.kind))
      .map((environment) => ({
        id: environment.id,
        kind: environment.kind,
        isDefault: environment.isDefault === true,
        notes: environment.notes || null,
      }));
  }
  return explicitKinds.map((kind, index) => ({
    id: index === 0 ? "adhoc-default" : `adhoc-${index + 1}`,
    kind,
    isDefault: index === 0,
    notes: "Synthesized from the ad-hoc task request.",
  }));
}

function relativeStatePath(targetPath) {
  return repoRelativePath(targetPath).replaceAll("\\", "/");
}

function buildCommonRequiredContext() {
  return Array.from(
    new Set([
      "docs/reference/repository-guidance.md",
      "docs/research/agent-context-sources.md",
      ...SHARED_PLAN_DOC_PATHS,
    ]),
  );
}

function buildDocumentationOwnedPaths({ lanePaths, waveNumber, mode }) {
  const canonicalPaths = requiredDocumentationStewardPathsForWave(waveNumber, {
    laneProfile: lanePaths.laneProfile,
  });
  if (mode === "roadmap") {
    return canonicalPaths;
  }
  return uniqueStrings([
    `.wave/adhoc/runs/${lanePaths.runId}/reports/wave-${waveNumber}-doc-closure.md`,
    ...canonicalPaths,
  ]);
}

function buildSpecialAgents({
  lanePaths,
  waveNumber,
  includeContEval,
  includeSecurity,
  evalTargets,
  mode,
}) {
  const commonRequiredContext = buildCommonRequiredContext();
  const contQaReportPath =
    mode === "roadmap"
      ? `docs/plans/waves/reviews/wave-${waveNumber}-cont-qa.md`
      : `.wave/adhoc/runs/${lanePaths.runId}/reports/wave-${waveNumber}-cont-qa.md`;
  const contEvalReportPath =
    mode === "roadmap"
      ? `docs/plans/waves/reviews/wave-${waveNumber}-cont-eval.md`
      : `.wave/adhoc/runs/${lanePaths.runId}/reports/wave-${waveNumber}-cont-eval.md`;
  const documentationOwnedPaths = buildDocumentationOwnedPaths({
    lanePaths,
    waveNumber,
    mode,
  });
  const securityReportPath =
    mode === "roadmap"
      ? relativeStatePath(path.join(lanePaths.securityDir, `wave-${waveNumber}-review.md`))
      : `.wave/adhoc/runs/${lanePaths.runId}/reports/wave-${waveNumber}-security-review.md`;
  const integrationOwnedPaths = [
    relativeStatePath(path.join(lanePaths.integrationDir, `wave-${waveNumber}.md`)),
    relativeStatePath(path.join(lanePaths.integrationDir, `wave-${waveNumber}.json`)),
  ];
  const agents = [
    {
      agentId: lanePaths.contQaAgentId,
      title: "cont-QA",
      rolePromptPaths: [lanePaths.contQaRolePromptPath],
      skills: [],
      executor: { profile: "deep-review" },
      context7: { bundle: "none", query: "Architecture evaluation only; repository docs remain canonical" },
      components: [],
      capabilities: [],
      exitContract: null,
      primaryGoal: `Run continuous QA for Wave ${waveNumber} and publish the final closure verdict.`,
      collaborationNotes: [
        `Collect explicit verdicts from the implementation-facing agents plus ${lanePaths.integrationAgentId} and ${lanePaths.documentationAgentId} before closing the run.`,
        "Do not publish PASS unless the evidence, documentation closure, and integration summary are all coherent.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: [contQaReportPath],
      requirements: [
        "Verify the generated run requirements are covered by landed evidence, not only by intent.",
        "Record the smallest blocking set that prevents closure.",
      ],
      validationCommand:
        "Re-read the changed reports and end the cont-QA report with `Verdict: PASS`, `Verdict: CONCERNS`, or `Verdict: BLOCKED`.",
      outputSummary: "Summarize the cont-QA verdict and the top unresolved cross-cutting risks.",
      deployEnvironmentId: null,
    },
    {
      agentId: lanePaths.integrationAgentId,
      title: "Integration Steward",
      rolePromptPaths: [lanePaths.integrationRolePromptPath],
      skills: [],
      executor: { profile: "deep-review" },
      context7: { bundle: "none", query: "Integration synthesis only; repository docs remain canonical" },
      components: [],
      capabilities: ["integration", "docs-shared-plan"],
      exitContract: null,
      primaryGoal: `Synthesize the final Wave ${waveNumber} state before documentation and cont-QA closure.`,
      collaborationNotes: [
        "Re-read the message board, compiled inboxes, and latest artifacts before final output.",
        "Treat contradictions, missing proof, or stale assumptions as integration failures.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: integrationOwnedPaths,
      requirements: [
        "Produce a closure-ready summary of claims, conflicts, blockers, and remaining follow-up owners.",
        "Decide whether the wave is `ready-for-doc-closure` or `needs-more-work`.",
      ],
      validationCommand:
        "Re-read the generated integration artifact and the latest changed proof docs before final output.",
      outputSummary: "Summarize the integration verdict, blockers, and exact closure recommendation.",
      deployEnvironmentId: null,
    },
    {
      agentId: lanePaths.documentationAgentId,
      title: "Documentation Steward",
      rolePromptPaths: [lanePaths.documentationRolePromptPath],
      skills: [],
      executor: { profile: "docs-pass" },
      context7: { bundle: "none", query: "Documentation closure only; repository docs remain canonical" },
      components: [],
      capabilities: [],
      exitContract: null,
      primaryGoal:
        mode === "roadmap"
          ? `Keep shared plan docs aligned with Wave ${waveNumber} end-to-end.`
          : `Close the ad-hoc run documentation surface and reconcile canonical shared-plan docs when the run changes them.`,
      collaborationNotes: [
        `Coordinate with implementation-facing agents and ${lanePaths.integrationAgentId} before final output.`,
        "When no shared-plan delta is required, leave an exact-scope `no-change` closure note instead of editing shared docs.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: documentationOwnedPaths,
      requirements: [
        "Track which landed outcomes change status, sequencing, ownership, or proof expectations.",
        "Leave an explicit `closed` or `no-change` documentation closure marker.",
      ],
      validationCommand: "Manual review of documentation closure against the landed run deliverables.",
      outputSummary: "Summarize the documentation closure decision and remaining follow-ups.",
      deployEnvironmentId: null,
    },
  ];
  if (includeContEval) {
    agents.splice(1, 0, {
      agentId: lanePaths.contEvalAgentId,
      title: "cont-EVAL",
      rolePromptPaths: [lanePaths.contEvalRolePromptPath],
      skills: [],
      executor: { profile: "eval-tuning" },
      context7: { bundle: "none", query: "Eval tuning only; repository docs remain canonical" },
      components: [],
      capabilities: ["eval"],
      exitContract: null,
      primaryGoal: `Run the Wave ${waveNumber} eval tuning loop until the declared eval targets are satisfied or explicitly blocked.`,
      collaborationNotes: [
        "Treat the run's eval targets as the governing contract for benchmark choice and tuning depth.",
        "Stay report-only unless the run explicitly assigns non-report owned paths.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: [contEvalReportPath],
      requirements: [
        "Record the selected benchmark set, the commands run, observed output gaps, and regressions.",
        `Emit a final \`[wave-eval]\` marker whose target_ids match ${(evalTargets || []).map((target) => target.id).join(", ")}.`,
      ],
      validationCommand:
        "Re-run the selected benchmarks or service-output checks and end with a final `[wave-eval]` marker.",
      outputSummary: "Summarize the selected benchmarks, tuning outcome, regressions, and remaining owners.",
      deployEnvironmentId: null,
    });
  }
  if (includeSecurity) {
    agents.splice(Math.max(agents.length - 2, 1), 0, {
      agentId: "A7",
      title: "Security Reviewer",
      rolePromptPaths: [lanePaths.securityRolePromptPath],
      skills: [],
      executor: { profile: "security-review" },
      context7: { bundle: "none", query: "Threat-model-first security review only; repository docs remain canonical" },
      components: [],
      capabilities: ["security-review"],
      exitContract: null,
      primaryGoal: `Review Wave ${waveNumber} for security risks and route exact fixes before integration closure.`,
      collaborationNotes: [
        "Do a threat-model pass before finalizing conclusions.",
        "Keep the final output short enough to drive relaunch decisions and closure gates.",
      ],
      requiredContext: commonRequiredContext,
      earlierWaveOutputs: [],
      ownedPaths: [securityReportPath],
      requirements: [
        "Record findings with severity, concrete surface, exploit or failure mode, and the owner expected to fix it.",
        "Emit one final `[wave-security]` marker with a fail-closed disposition.",
      ],
      validationCommand:
        "Re-read the final security report and ensure the `[wave-security]` marker matches the findings and approval counts.",
      outputSummary: "Summarize the threat model, findings, required approvals, and final security disposition.",
      deployEnvironmentId: null,
    });
  }
  return agents;
}

function buildEvalTargets(analyzedTasks) {
  const scopedTasks = analyzedTasks.filter((task) => task.needsEval);
  if (scopedTasks.length === 0) {
    return [];
  }
  return scopedTasks.map((task, index) => ({
    id: index === 0 ? "adhoc-service-output" : `adhoc-eval-${index + 1}`,
    selection: "delegated",
    benchmarkFamily: "service-output",
    benchmarks: [],
    objective: compactSingleLine(task.task, 140),
    threshold: "Selected checks green with no unresolved regressions.",
  }));
}

function workerAgentIdForIndex(index) {
  return index < 6 ? `A${index + 1}` : `A${index + 4}`;
}

function buildWorkerAgent(taskSpec, index, lanePaths, deployEnvironments) {
  const defaultDeployEnvironment =
    deployEnvironments.find((environment) => environment.isDefault)?.id ||
    deployEnvironments[0]?.id ||
    null;
  const capabilities = [];
  if (taskSpec.roleKind !== "implementation") {
    capabilities.push(taskSpec.roleKind);
  }
  if (taskSpec.docsHeavy && !capabilities.includes("docs-shared-plan")) {
    capabilities.push("docs-shared-plan");
  }
  return {
    agentId: workerAgentIdForIndex(index),
    title: taskSpec.title,
    rolePromptPaths: [],
    skills: [],
    executor: {
      profile: defaultExecutorProfile(taskSpec.roleKind),
    },
    context7: {
      bundle: "none",
      query: null,
    },
    components: [],
    capabilities,
    exitContract: defaultExitContract(taskSpec.roleKind),
    primaryGoal: taskSpec.task,
    collaborationNotes: [
      "Re-read the wave message board before major decisions, before validation, and before final output.",
      `Notify Agent ${lanePaths.contQaAgentId} when your evidence changes the closure picture.`,
    ],
    requiredContext: buildCommonRequiredContext(),
    earlierWaveOutputs: [],
    ownedPaths: taskSpec.ownedPaths,
    requirements: [
      `Execute this task exactly: ${taskSpec.task}`,
      "Keep ownership explicit and leave exact proof and doc deltas in the final output.",
    ],
    validationCommand: defaultValidationCommand(taskSpec.roleKind),
    outputSummary: defaultOutputSummary(taskSpec.roleKind),
    deployEnvironmentId:
      taskSpec.roleKind === "deploy" || taskSpec.roleKind === "infra"
        ? defaultDeployEnvironment
        : null,
  };
}

function buildRunTitle(tasks) {
  const firstTask = compactSingleLine(tasks[0] || "Ad-Hoc Task", 80);
  return tasks.length === 1 ? `Ad-Hoc: ${firstTask}` : `Ad-Hoc: ${firstTask} +${tasks.length - 1}`;
}

function buildCommitMessage(analyzedTasks) {
  if (analyzedTasks.every((task) => task.docsHeavy)) {
    return "Docs: land ad-hoc documentation slice";
  }
  if (analyzedTasks.some((task) => task.roleKind === "deploy" || task.roleKind === "infra")) {
    return "Build: land ad-hoc deploy or infra slice";
  }
  return "Feat: land ad-hoc implementation slice";
}

function buildAdhocRequest({ runId, lanePaths, profile, tasks, launcherArgs = [] }) {
  return {
    schemaVersion: ADHOC_SCHEMA_VERSION,
    runKind: "adhoc",
    runId,
    lane: lanePaths.lane,
    createdAt: toIsoTimestamp(),
    oversightMode: profile.defaultOversightMode,
    defaultTerminalSurface: profile.defaultTerminalSurface,
    tasks: tasks.map((task, index) => ({
      id: `task-${index + 1}`,
      text: cleanText(task),
    })),
    launcherArgs,
  };
}

function buildAdhocSpec({ runId, lanePaths, profile, request, mode = "adhoc", waveNumber = ADHOC_WAVE_NUMBER }) {
  const tasks = request.tasks.map((task) => task.text);
  const analyzedTasks = tasks.map((task, index) => analyzeTask(task, index, profile, lanePaths));
  const deployEnvironments = resolveDeployEnvironments(profile, analyzedTasks);
  const evalTargets = buildEvalTargets(analyzedTasks);
  const workerAgents = analyzedTasks.map((taskSpec, index) =>
    buildWorkerAgent(taskSpec, index, lanePaths, deployEnvironments),
  );
  const includeContEval = evalTargets.length > 0;
  const includeSecurity = analyzedTasks.some((task) => task.needsSecurity);
  return {
    schemaVersion: 1,
    generatedAt: toIsoTimestamp(),
    runKind: mode === "roadmap" ? "roadmap" : "adhoc",
    runId: mode === "roadmap" ? null : runId,
    sourceRunId: mode === "roadmap" ? runId : null,
    projectProfile: {
      projectName: profile.source?.projectName || lanePaths.config.projectName,
      newProject: profile.newProject === true,
      defaultTerminalSurface: profile.defaultTerminalSurface,
    },
    template: deriveTemplate(analyzedTasks.map((task) => task.roleKind)),
    lane: lanePaths.lane,
    wave: waveNumber,
    title: buildRunTitle(tasks),
    commitMessage: buildCommitMessage(analyzedTasks),
    oversightMode: profile.defaultOversightMode,
    sequencingNote:
      "Generated from an operator ad-hoc request. Treat the stored task list as the authoritative scope for this run.",
    referenceRule:
      "Repository source, resolved runtime skills, and generated coordination artifacts remain authoritative over request paraphrases.",
    deployEnvironments,
    context7Defaults: {
      bundle: "none",
      query: null,
    },
    evalTargets,
    componentPromotions: [],
    componentsCatalog: [],
    requestedTasks: request.tasks,
    agents: [
      ...buildSpecialAgents({
        lanePaths,
        waveNumber,
        includeContEval,
        includeSecurity,
        evalTargets,
        mode,
      }),
      ...workerAgents,
    ],
  };
}

function isGeneratedSpecialAgent(agent) {
  return GENERATED_SPECIAL_AGENT_TITLES.has(cleanText(agent?.title));
}

function buildPromotedRoadmapSpec(storedSpec, lanePaths, waveNumber, runId) {
  const includeContEval =
    (Array.isArray(storedSpec?.evalTargets) && storedSpec.evalTargets.length > 0) ||
    (storedSpec?.agents || []).some((agent) => cleanText(agent?.title) === "cont-EVAL");
  const includeSecurity = (storedSpec?.agents || []).some(
    (agent) => cleanText(agent?.title) === "Security Reviewer",
  );
  const workerAgents = (storedSpec?.agents || []).filter((agent) => !isGeneratedSpecialAgent(agent));
  return {
    ...storedSpec,
    runKind: "roadmap",
    runId: null,
    sourceRunId: cleanText(storedSpec?.sourceRunId) || cleanText(storedSpec?.runId) || runId || null,
    lane: lanePaths.lane,
    wave: waveNumber,
    agents: [
      ...buildSpecialAgents({
        lanePaths,
        waveNumber,
        includeContEval,
        includeSecurity,
        evalTargets: storedSpec?.evalTargets || [],
        mode: "roadmap",
      }),
      ...workerAgents,
    ],
  };
}

function validateGeneratedRun(lanePaths) {
  const parsedWave = parseWaveFile(lanePaths.adhocWavePath, {
    laneProfile: lanePaths.laneProfile,
  });
  validateWaveDefinition(
    applyExecutorSelectionsToWave(parsedWave, {
      laneProfile: lanePaths.laneProfile,
    }),
    { laneProfile: lanePaths.laneProfile },
  );
}

function buildResultRecord(lanePaths, request, spec, status, extra = {}) {
  const now = toIsoTimestamp();
  const previous = readJsonOrNull(lanePaths.adhocResultPath) || {};
  const { stateLanePaths = lanePaths, ...rest } = extra;
  return {
    schemaVersion: ADHOC_SCHEMA_VERSION,
    runKind: "adhoc",
    runId: request.runId,
    lane: request.lane,
    title: spec.title,
    status,
    createdAt: previous.createdAt || request.createdAt || now,
    updatedAt: now,
    taskCount: request.tasks.length,
    tasks: request.tasks,
    requestPath: repoRelativePath(lanePaths.adhocRequestPath),
    specPath: repoRelativePath(lanePaths.adhocSpecPath),
    wavePath: repoRelativePath(lanePaths.adhocWavePath),
    launcherStateDir: repoRelativePath(stateLanePaths.stateDir),
    tracesDir: repoRelativePath(stateLanePaths.tracesDir),
    promotedWave: previous.promotedWave || null,
    ...rest,
  };
}

function readAdhocIndex(indexPath) {
  const payload = readJsonOrNull(indexPath);
  if (!payload || typeof payload !== "object") {
    return {
      schemaVersion: ADHOC_SCHEMA_VERSION,
      updatedAt: toIsoTimestamp(),
      runs: [],
    };
  }
  return {
    schemaVersion: ADHOC_SCHEMA_VERSION,
    updatedAt: cleanText(payload.updatedAt) || toIsoTimestamp(),
    runs: Array.isArray(payload.runs) ? payload.runs : [],
  };
}

function writeAdhocIndex(indexPath, index) {
  ensureDirectory(path.dirname(indexPath));
  writeJsonAtomic(indexPath, {
    schemaVersion: ADHOC_SCHEMA_VERSION,
    updatedAt: toIsoTimestamp(),
    runs: (index.runs || []).toSorted((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")),
    ),
  });
}

function upsertAdhocIndexEntry(indexPath, result) {
  const index = readAdhocIndex(indexPath);
  const entry = {
    runId: result.runId,
    lane: result.lane,
    title: result.title,
    status: result.status,
    taskCount: result.taskCount,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    promotedWave: result.promotedWave || null,
  };
  const nextRuns = index.runs.filter((run) => run.runId !== result.runId);
  nextRuns.push(entry);
  writeAdhocIndex(indexPath, { ...index, runs: nextRuns });
}

function ensureAdhocRunArtifacts(lanePaths, request, spec) {
  ensureDirectory(lanePaths.adhocRunDir);
  writeJsonAtomic(lanePaths.adhocRequestPath, request);
  writeJsonAtomic(lanePaths.adhocSpecPath, spec);
  writeTextAtomic(lanePaths.adhocWavePath, `${renderWaveMarkdown(spec, lanePaths)}\n`);
  validateGeneratedRun(lanePaths);
}

function summarizePlan(spec, lanePaths) {
  return {
    runId: lanePaths.runId,
    lane: lanePaths.lane,
    title: spec.title,
    tasks: spec.requestedTasks || [],
    agents: spec.agents.map((agent) => ({
      agentId: agent.agentId,
      title: agent.title,
      profile: agent.executor?.profile || null,
      deployEnvironmentId: agent.deployEnvironmentId || null,
    })),
    requestPath: repoRelativePath(lanePaths.adhocRequestPath),
    specPath: repoRelativePath(lanePaths.adhocSpecPath),
    wavePath: repoRelativePath(lanePaths.adhocWavePath),
    stateDir: repoRelativePath(lanePaths.stateDir),
  };
}

async function confirmLaunch(runSummary) {
  if (!stdin.isTTY) {
    throw new Error("Non-interactive ad-hoc launch requires --yes.");
  }
  const rl = readline.createInterface({
    input: stdin,
    output: stderr,
    terminal: true,
  });
  try {
    const answer = cleanText(await rl.question(`Launch ad-hoc run ${runSummary.runId}? (y/n): `)).toLowerCase();
    if (!["y", "yes"].includes(answer)) {
      throw new Error(`Ad-hoc run ${runSummary.runId} cancelled.`);
    }
  } finally {
    rl.close();
  }
}

function renderHumanPlanSummary(runSummary) {
  console.log(`[wave:adhoc] run=${runSummary.runId}`);
  console.log(`[wave:adhoc] lane=${runSummary.lane}`);
  console.log(`[wave:adhoc] title=${runSummary.title}`);
  console.log(`[wave:adhoc] request=${runSummary.requestPath}`);
  console.log(`[wave:adhoc] spec=${runSummary.specPath}`);
  console.log(`[wave:adhoc] markdown=${runSummary.wavePath}`);
  console.log(`[wave:adhoc] state=${runSummary.stateDir}`);
  for (const task of runSummary.tasks) {
    console.log(`[wave:adhoc] task=${task.text}`);
  }
  for (const agent of runSummary.agents) {
    console.log(
      `[wave:adhoc] agent=${agent.agentId}:${agent.title} profile=${agent.profile || "none"}${agent.deployEnvironmentId ? ` env=${agent.deployEnvironmentId}` : ""}`,
    );
  }
}

function collectStoredRuns(indexPath) {
  const index = readAdhocIndex(indexPath);
  const runsRoot = path.join(path.dirname(indexPath), "runs");
  const runDirs = fs.existsSync(runsRoot)
    ? fs
        .readdirSync(runsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
  const known = new Set(index.runs.map((run) => run.runId));
  const materialized = [...index.runs];
  for (const runId of runDirs) {
    if (known.has(runId)) {
      continue;
    }
    const result = readJsonOrNull(path.join(path.dirname(indexPath), "runs", runId, "result.json"));
    if (result) {
      materialized.push({
        runId: result.runId,
        lane: result.lane,
        title: result.title,
        status: result.status,
        taskCount: result.taskCount,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        promotedWave: result.promotedWave || null,
      });
    }
  }
  return materialized.toSorted((left, right) =>
    String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")),
  );
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const subcommand = cleanText(args.shift()).toLowerCase();
  const options = {
    lane: "",
    runId: "",
    wave: null,
    tasks: [],
    yes: false,
    json: false,
    force: false,
    launcherArgs: [],
  };
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--task") {
      options.tasks.push(cleanText(args.shift()));
    } else if (arg === "--lane") {
      options.lane = cleanText(args.shift());
    } else if (arg === "--run") {
      options.runId = sanitizeAdhocRunId(args.shift());
    } else if (arg === "--wave") {
      options.wave = parseNonNegativeInt(args.shift(), "--wave");
    } else if (arg === "--yes") {
      options.yes = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (
      [
        "--dry-run",
        "--no-dashboard",
        "--keep-sessions",
        "--cleanup-sessions",
        "--keep-terminals",
        "--no-context7",
      ].includes(arg)
    ) {
      options.launcherArgs.push(arg);
    } else if (
      [
        "--terminal-surface",
        "--executor",
        "--codex-sandbox",
        "--timeout-minutes",
        "--max-retries-per-wave",
        "--agent-rate-limit-retries",
        "--agent-rate-limit-base-delay-seconds",
        "--agent-rate-limit-max-delay-seconds",
        "--agent-launch-stagger-ms",
        "--coordination-note",
        "--orchestrator-id",
        "--orchestrator-board",
      ].includes(arg)
    ) {
      const value = cleanText(args.shift());
      options.launcherArgs.push(arg, value);
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, subcommand, options };
    } else if (arg) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { help: false, subcommand, options };
}

function printUsage() {
  console.log(`Usage:
  wave adhoc plan --task <text> [--task <text>] [--lane <lane>] [--json]
  wave adhoc run --task <text> [--task <text>] [--lane <lane>] [--yes] [--json] [launcher options]
  wave adhoc list [--lane <lane>] [--json]
  wave adhoc show --run <id> [--json]
  wave adhoc promote --run <id> --wave <n> [--force] [--json]
`);
}

function resolveLaneForOptions(config, options) {
  const profile = readEffectiveProjectProfile(config);
  return cleanText(options.lane) || profile.plannerDefaults?.lane || config.defaultLane;
}

function createStoredRun({ config, options }) {
  const profile = readEffectiveProjectProfile(config);
  const lane = resolveLaneForOptions(config, options);
  const runId = buildAdhocRunId();
  const lanePaths = buildLanePaths(lane, { config, adhocRunId: runId });
  const request = buildAdhocRequest({
    runId,
    lanePaths,
    profile,
    tasks: options.tasks,
    launcherArgs: options.launcherArgs,
  });
  const spec = buildAdhocSpec({
    runId,
    lanePaths,
    profile,
    request,
    mode: "adhoc",
  });
  ensureAdhocRunArtifacts(lanePaths, request, spec);
  const result = buildResultRecord(lanePaths, request, spec, "planned");
  writeJsonAtomic(lanePaths.adhocResultPath, result);
  upsertAdhocIndexEntry(lanePaths.adhocIndexPath, result);
  return { lanePaths, request, spec, result };
}

function readStoredRun(runId) {
  const lanePaths = buildLanePaths(DEFAULT_LANE_PLACEHOLDER, { adhocRunId: runId });
  const request = readJsonOrNull(lanePaths.adhocRequestPath);
  const spec = readJsonOrNull(lanePaths.adhocSpecPath);
  const result = readJsonOrNull(lanePaths.adhocResultPath);
  if (!request || !spec || !result) {
    throw new Error(`Ad-hoc run not found: ${runId}`);
  }
  return { lanePaths, request, spec, result };
}

const DEFAULT_LANE_PLACEHOLDER = "main";

export async function runAdhocCli(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.subcommand) {
    printUsage();
    return;
  }
  const { subcommand, options } = parsed;
  const config = loadWaveConfig();

  if (subcommand === "plan") {
    if (options.tasks.length === 0) {
      throw new Error("At least one --task is required for `wave adhoc plan`.");
    }
    const { lanePaths, spec } = createStoredRun({ config, options });
    const summary = summarizePlan(spec, lanePaths);
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    renderHumanPlanSummary(summary);
    return;
  }

  if (subcommand === "run") {
    if (options.tasks.length === 0) {
      throw new Error("At least one --task is required for `wave adhoc run`.");
    }
    const stored = createStoredRun({ config, options });
    const summary = summarizePlan(stored.spec, stored.lanePaths);
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      renderHumanPlanSummary(summary);
    }
    if (!options.yes) {
      await confirmLaunch(summary);
    }
    const launchLanePaths = buildLanePaths(stored.lanePaths.lane, {
      config,
      adhocRunId: stored.lanePaths.runId,
      runVariant: options.launcherArgs.includes("--dry-run") ? "dry-run" : undefined,
    });
    const runningResult = buildResultRecord(stored.lanePaths, stored.request, stored.spec, "running", {
      launcherArgs: options.launcherArgs,
      stateLanePaths: launchLanePaths,
    });
    writeJsonAtomic(stored.lanePaths.adhocResultPath, runningResult);
    upsertAdhocIndexEntry(stored.lanePaths.adhocIndexPath, runningResult);
    try {
      await runLauncherCli([
        "--lane",
        stored.lanePaths.lane,
        "--adhoc-run",
        stored.lanePaths.runId,
        "--start-wave",
        String(ADHOC_WAVE_NUMBER),
        "--end-wave",
        String(ADHOC_WAVE_NUMBER),
        ...options.launcherArgs,
      ]);
      const completedResult = buildResultRecord(
        stored.lanePaths,
        stored.request,
        stored.spec,
        "completed",
        {
          launcherArgs: options.launcherArgs,
          stateLanePaths: launchLanePaths,
        },
      );
      writeJsonAtomic(stored.lanePaths.adhocResultPath, completedResult);
      upsertAdhocIndexEntry(stored.lanePaths.adhocIndexPath, completedResult);
      if (!options.json) {
        console.log(`[wave:adhoc] completed=${stored.lanePaths.runId}`);
      }
      return;
    } catch (error) {
      const failedResult = buildResultRecord(stored.lanePaths, stored.request, stored.spec, "failed", {
        launcherArgs: options.launcherArgs,
        error: error instanceof Error ? error.message : String(error),
        stateLanePaths: launchLanePaths,
      });
      writeJsonAtomic(stored.lanePaths.adhocResultPath, failedResult);
      upsertAdhocIndexEntry(stored.lanePaths.adhocIndexPath, failedResult);
      throw error;
    }
  }

  if (subcommand === "list") {
    const lane = cleanText(options.lane);
    const lanePaths = buildLanePaths(lane || config.defaultLane, { config });
    const runs = collectStoredRuns(lanePaths.adhocIndexPath).filter((run) =>
      lane ? run.lane === lane : true,
    );
    if (options.json) {
      console.log(JSON.stringify(runs, null, 2));
      return;
    }
    for (const run of runs) {
      console.log(
        `${run.runId} ${run.status} lane=${run.lane} tasks=${run.taskCount} updated=${run.updatedAt} ${run.title}`,
      );
    }
    return;
  }

  if (subcommand === "show") {
    if (!options.runId) {
      throw new Error("--run <id> is required for `wave adhoc show`.");
    }
    const { lanePaths, request, spec, result } = readStoredRun(options.runId);
    const payload = {
      runId: options.runId,
      lane: result.lane,
      status: result.status,
      title: result.title,
      tasks: request.tasks,
      requestPath: repoRelativePath(lanePaths.adhocRequestPath),
      specPath: repoRelativePath(lanePaths.adhocSpecPath),
      wavePath: repoRelativePath(lanePaths.adhocWavePath),
      launcherStateDir: result.launcherStateDir,
      tracesDir: result.tracesDir,
      agents: spec.agents.map((agent) => ({
        agentId: agent.agentId,
        title: agent.title,
        profile: agent.executor?.profile || null,
      })),
      promotedWave: result.promotedWave || null,
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`[wave:adhoc] run=${payload.runId}`);
    console.log(`[wave:adhoc] lane=${payload.lane}`);
    console.log(`[wave:adhoc] status=${payload.status}`);
    console.log(`[wave:adhoc] title=${payload.title}`);
    console.log(`[wave:adhoc] request=${payload.requestPath}`);
    console.log(`[wave:adhoc] spec=${payload.specPath}`);
    console.log(`[wave:adhoc] markdown=${payload.wavePath}`);
    console.log(`[wave:adhoc] traces=${payload.tracesDir}`);
    for (const task of payload.tasks) {
      console.log(`[wave:adhoc] task=${task.text}`);
    }
    for (const agent of payload.agents) {
      console.log(`[wave:adhoc] agent=${agent.agentId}:${agent.title} profile=${agent.profile || "none"}`);
    }
    if (payload.promotedWave !== null) {
      console.log(`[wave:adhoc] promoted_wave=${payload.promotedWave}`);
    }
    return;
  }

  if (subcommand === "promote") {
    if (!options.runId) {
      throw new Error("--run <id> is required for `wave adhoc promote`.");
    }
    if (!Number.isFinite(options.wave) || options.wave < 0) {
      throw new Error("--wave <n> is required for `wave adhoc promote`.");
    }
    const stored = readStoredRun(options.runId);
    const lane = cleanText(options.lane) || stored.result.lane || config.defaultLane;
    const lanePaths = buildLanePaths(lane, { config });
    const wavePath = path.join(lanePaths.wavesDir, `wave-${options.wave}.md`);
    const specPath = path.join(lanePaths.wavesDir, "specs", `wave-${options.wave}.json`);
    if (!options.force && (fs.existsSync(wavePath) || fs.existsSync(specPath))) {
      throw new Error(
        `Wave ${options.wave} already exists. Re-run with --force to overwrite ${repoRelativePath(wavePath)} and ${repoRelativePath(specPath)}.`,
      );
    }
    const promotedSpec = buildPromotedRoadmapSpec(
      stored.spec,
      lanePaths,
      options.wave,
      stored.result.runId,
    );
    ensureDirectory(path.dirname(specPath));
    writeJsonAtomic(specPath, promotedSpec);
    writeTextAtomic(wavePath, `${renderWaveMarkdown(promotedSpec, lanePaths)}\n`);
    let validationError = null;
    try {
      const parsedWave = parseWaveFile(wavePath, { laneProfile: lanePaths.laneProfile });
      validateWaveDefinition(
        applyExecutorSelectionsToWave(parsedWave, {
          laneProfile: lanePaths.laneProfile,
        }),
        { laneProfile: lanePaths.laneProfile },
      );
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
    }
    const nextResult = {
      ...stored.result,
      promotedWave: options.wave,
      updatedAt: toIsoTimestamp(),
      promotionValidationError: validationError,
    };
    writeJsonAtomic(stored.lanePaths.adhocResultPath, nextResult);
    upsertAdhocIndexEntry(stored.lanePaths.adhocIndexPath, nextResult);
    const payload = {
      runId: stored.result.runId,
      wave: options.wave,
      specPath: repoRelativePath(specPath),
      wavePath: repoRelativePath(wavePath),
      validationError,
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`[wave:adhoc] promoted=${payload.runId}`);
    console.log(`[wave:adhoc] spec=${payload.specPath}`);
    console.log(`[wave:adhoc] markdown=${payload.wavePath}`);
    if (payload.validationError) {
      console.log(`[wave:adhoc] validation_warning=${payload.validationError}`);
    }
    return;
  }

  throw new Error(`Unknown adhoc subcommand: ${subcommand}`);
}
