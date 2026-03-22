import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, ensureDirectory, readJsonOrNull, toIsoTimestamp, writeJsonAtomic, writeTextAtomic } from "./shared.mjs";
import { loadExternalBenchmarkAdapters } from "./benchmark-cases.mjs";

const DEFAULT_EXTERNAL_PILOTS_DIR = "docs/evals/pilots";
const DEFAULT_EXTERNAL_ARM_TEMPLATES_DIR = "docs/evals/arm-templates";
const EXTERNAL_BENCHMARK_ARMS = ["single-agent", "full-wave"];

function cleanText(value) {
  return String(value ?? "").trim();
}

function matchesFailurePattern(detail, patterns) {
  return patterns.some((pattern) => detail.includes(pattern));
}

function isVerifierImageFailureDetail(detail) {
  return matchesFailurePattern(detail, [
    "failed to pull",
    "manifest unknown",
    "no matching manifest",
    "pull access denied",
    "jefzda/sweap-images",
    "docker image",
    "dockerhub_username",
  ]);
}

function isSetupHarnessFailureDetail(detail) {
  return matchesFailurePattern(detail, [
    "wave init failed",
    "wave doctor failed",
    "wave launch failed",
    "git diff failed",
    "git add -n failed",
    "patch extraction failed",
    "repository preparation failed",
    "repo already contained wave bootstrap files",
    "already contained wave bootstrap files",
    "could not parse object",
    "fatal: could not parse object",
    "bootstrap",
    "harness",
    "workspace",
    "task workspace",
    "setup failed",
  ]);
}

function reviewDispositionForCategory(category) {
  switch (cleanText(category)) {
    case "solved":
      return "solved";
    case "dry-run-plan":
      return "dry-run";
    case "verifier-image":
      return "invalidated";
    case "setup-harness":
    case "harness-env":
      return "setup-failure";
    case "incorrect-patch":
      return "scored-failure";
    case "timeout":
      return "timeout";
    case "blocked-proof":
      return "blocked-proof";
    default:
      return "unknown";
  }
}

function sortCountEntries(counts) {
  return Object.entries(counts || {}).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
}

function formatCountSummary(counts) {
  return sortCountEntries(counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|");
}

function normalizeRepoRelativePath(value, label) {
  const normalized = cleanText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${label} must stay within the repository`);
  }
  return normalized;
}

function normalizeId(value, label) {
  const normalized = cleanText(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`${label} must match /^[a-z0-9][a-z0-9._-]*$/`);
  }
  return normalized;
}

function normalizeSelectedExternalArms(arms) {
  if (!Array.isArray(arms) || arms.length === 0) {
    return EXTERNAL_BENCHMARK_ARMS.slice();
  }
  const selected = [];
  for (const arm of arms) {
    const normalized = normalizeId(arm, "arm");
    if (!EXTERNAL_BENCHMARK_ARMS.includes(normalized)) {
      throw new Error(
        `Unsupported external benchmark arm: ${arm}. Allowed arms: ${EXTERNAL_BENCHMARK_ARMS.join(", ")}`,
      );
    }
    if (!selected.includes(normalized)) {
      selected.push(normalized);
    }
  }
  return selected;
}

function normalizeStringArray(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => {
    const normalized = cleanText(entry);
    if (!normalized) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return normalized;
  });
}

function readJsonFile(filePath, label = "JSON file") {
  const payload = readJsonOrNull(filePath);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Invalid ${label}: ${path.relative(REPO_ROOT, filePath)}`);
  }
  return payload;
}

function normalizeExternalTask(rawTask, index, manifest) {
  if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
    throw new Error(`tasks[${index}] in ${manifest.path} must be an object`);
  }
  const taskId = cleanText(rawTask.taskId || rawTask.instanceId);
  if (!taskId) {
    throw new Error(`tasks[${index}].taskId is required in ${manifest.path}`);
  }
  return {
    taskId,
    repo: cleanText(rawTask.repo) || null,
    repoLanguage: cleanText(rawTask.repoLanguage) || null,
    level: cleanText(rawTask.level) || null,
    title: cleanText(rawTask.title) || null,
    protocol: cleanText(rawTask.protocol || manifest.protocol) || null,
    teamSize:
      rawTask.teamSize == null || rawTask.teamSize === ""
        ? null
        : Number.parseInt(String(rawTask.teamSize), 10),
    complexityLevel: cleanText(rawTask.complexityLevel || rawTask.level) || null,
    metadata: rawTask.metadata && typeof rawTask.metadata === "object" && !Array.isArray(rawTask.metadata)
      ? rawTask.metadata
      : {},
    smoke: rawTask.smoke && typeof rawTask.smoke === "object" && !Array.isArray(rawTask.smoke)
      ? rawTask.smoke
      : null,
  };
}

export function loadExternalPilotManifest(manifestPath) {
  const normalizedPath = normalizeRepoRelativePath(manifestPath, "manifestPath");
  const absolutePath = path.resolve(REPO_ROOT, normalizedPath);
  const payload = readJsonFile(absolutePath, "pilot manifest");
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  return {
    version: Number.parseInt(String(payload.version ?? "1"), 10) || 1,
    id: normalizeId(payload.id, `${normalizedPath}: id`),
    benchmarkId: normalizeId(payload.benchmarkId, `${normalizedPath}: benchmarkId`),
    title: cleanText(payload.title) || normalizeId(payload.id, `${normalizedPath}: id`),
    split: cleanText(payload.split) || null,
    sampleStrategy: cleanText(payload.sampleStrategy) || null,
    sampleSource: cleanText(payload.sampleSource) || null,
    derivedFromManifestPath: cleanText(payload.derivedFromManifestPath) || null,
    reviewOnly: Boolean(payload.reviewOnly),
    reviewScope: cleanText(payload.reviewScope) || null,
    protocol: cleanText(payload.protocol) || null,
    teamSizes: normalizeStringArray(payload.teamSizes, `${normalizedPath}: teamSizes`).map((value) =>
      Number.parseInt(value, 10),
    ),
    path: normalizedPath,
    absolutePath,
    tasks: tasks.map((task, index) =>
      normalizeExternalTask(task, index, { path: normalizedPath, protocol: payload.protocol }),
    ),
  };
}

export function loadExternalArmTemplates(options = {}) {
  const templatesDir = path.resolve(
    REPO_ROOT,
    normalizeRepoRelativePath(
      options.armTemplatesDir || DEFAULT_EXTERNAL_ARM_TEMPLATES_DIR,
      "armTemplatesDir",
    ),
  );
  const files = fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(templatesDir, entry.name))
    .toSorted();
  const templates = new Map();
  for (const filePath of files) {
    const payload = readJsonFile(filePath, "external arm template");
    const armId = normalizeId(payload.armId, `${filePath}: armId`);
    templates.set(armId, {
      armId,
      title: cleanText(payload.title) || armId,
      roles: normalizeStringArray(payload.roles, `${filePath}: roles`),
      includeContEval: Boolean(payload.includeContEval),
      includeIntegrationSteward: Boolean(payload.includeIntegrationSteward),
      includeDocumentationSteward: Boolean(payload.includeDocumentationSteward),
      tracesRequired:
        payload.tracesRequired === undefined ? armId === "full-wave" : Boolean(payload.tracesRequired),
      notes: normalizeStringArray(payload.notes, `${filePath}: notes`),
      path: path.relative(REPO_ROOT, filePath).replaceAll(path.sep, "/"),
    });
  }
  for (const armId of EXTERNAL_BENCHMARK_ARMS) {
    if (!templates.has(armId)) {
      throw new Error(`Missing external arm template for ${armId}`);
    }
  }
  return {
    templatesDir: path.relative(REPO_ROOT, templatesDir).replaceAll(path.sep, "/"),
    absoluteTemplatesDir: templatesDir,
    templates,
  };
}

export function loadExternalPilotManifests(options = {}) {
  const pilotsDir = path.resolve(
    REPO_ROOT,
    normalizeRepoRelativePath(options.pilotsDir || DEFAULT_EXTERNAL_PILOTS_DIR, "pilotsDir"),
  );
  const files = fs
    .readdirSync(pilotsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(pilotsDir, entry.name))
    .toSorted();
  const manifests = files.map((filePath) =>
    loadExternalPilotManifest(path.relative(REPO_ROOT, filePath).replaceAll(path.sep, "/")),
  );
  return {
    pilotsDir: path.relative(REPO_ROOT, pilotsDir).replaceAll(path.sep, "/"),
    absolutePilotsDir: pilotsDir,
    manifests,
    byId: new Map(manifests.map((manifest) => [manifest.id, manifest])),
  };
}

export function loadExternalCommandConfig(configPath) {
  const normalizedPath = normalizeRepoRelativePath(configPath, "commandConfigPath");
  const absolutePath = path.resolve(REPO_ROOT, normalizedPath);
  const payload = readJsonFile(absolutePath, "external command config");
  const adapters =
    payload.adapters && typeof payload.adapters === "object" && !Array.isArray(payload.adapters)
      ? payload.adapters
      : {};
  return {
    path: normalizedPath,
    absolutePath,
    adapters,
  };
}

export function assertComparableExternalRunConfig(runConfig) {
  const required = [
    "benchmarkId",
    "modelId",
    "executorId",
    "executorCommand",
    "toolPermissions",
    "temperature",
    "reasoningEffort",
    "maxWallClockMinutes",
    "maxTurns",
    "retryLimit",
    "verificationHarness",
    "datasetVersion",
  ];
  for (const field of required) {
    if (cleanText(runConfig?.[field]) === "") {
      throw new Error(`Comparable external run config requires ${field}`);
    }
  }
  const baseline = runConfig.armOverrides?.["single-agent"] || {};
  const fullWave = runConfig.armOverrides?.["full-wave"] || {};
  const forbiddenFields = [
    "modelId",
    "executorId",
    "executorCommand",
    "toolPermissions",
    "temperature",
    "reasoningEffort",
    "maxWallClockMinutes",
    "maxTurns",
    "retryLimit",
    "verificationHarness",
    "datasetVersion",
  ];
  for (const field of forbiddenFields) {
    if (baseline[field] !== undefined || fullWave[field] !== undefined) {
      throw new Error(`Arm overrides must not change comparable field ${field}`);
    }
  }
}

function renderTemplate(template, variables) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (!(key in variables)) {
      return "";
    }
    return String(variables[key]);
  });
}

function normalizeSmokeOutcome(outcome, label) {
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    success: Boolean(outcome.success),
    wallClockMs:
      outcome.wallClockMs == null ? null : Number.parseInt(String(outcome.wallClockMs), 10),
    totalCostUsd:
      outcome.totalCostUsd == null ? null : Number.parseFloat(String(outcome.totalCostUsd)),
    tokenUsage:
      outcome.tokenUsage && typeof outcome.tokenUsage === "object" && !Array.isArray(outcome.tokenUsage)
        ? outcome.tokenUsage
        : null,
    partialCorrectness:
      outcome.partialCorrectness == null ? null : Number.parseFloat(String(outcome.partialCorrectness)),
    communicationDensity:
      outcome.communicationDensity == null ? null : Number.parseFloat(String(outcome.communicationDensity)),
    detail: cleanText(outcome.detail) || "",
  };
}

function executeCommand(command, workingDirectory) {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd: workingDirectory,
    shell: true,
    encoding: "utf8",
    env: process.env,
  });
  return {
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    wallClockMs: Date.now() - startedAt,
  };
}

function parseStructuredCommandOutput(text) {
  const normalized = cleanText(text);
  if (!normalized) {
    return null;
  }
  const candidates = [normalized];
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    candidates.push(lines[lines.length - 1]);
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to the next candidate.
    }
  }
  return null;
}

function normalizeStructuredCommandOutcome(outcome, label) {
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
    return null;
  }
  const payload = {
    success: outcome.success == null ? null : Boolean(outcome.success),
    wallClockMs:
      outcome.wallClockMs == null ? null : Number.parseInt(String(outcome.wallClockMs), 10),
    totalCostUsd:
      outcome.totalCostUsd == null ? null : Number.parseFloat(String(outcome.totalCostUsd)),
    tokenUsage:
      outcome.tokenUsage && typeof outcome.tokenUsage === "object" && !Array.isArray(outcome.tokenUsage)
        ? outcome.tokenUsage
        : null,
    partialCorrectness:
      outcome.partialCorrectness == null ? null : Number.parseFloat(String(outcome.partialCorrectness)),
    communicationDensity:
      outcome.communicationDensity == null ? null : Number.parseFloat(String(outcome.communicationDensity)),
    artifactPath: cleanText(outcome.artifactPath) || null,
    patchPath: cleanText(outcome.patchPath) || null,
    tracePath: cleanText(outcome.tracePath) || null,
    summaryPath: cleanText(outcome.summaryPath) || null,
    verificationStdoutPath: cleanText(outcome.verificationStdoutPath) || null,
    verificationStderrPath: cleanText(outcome.verificationStderrPath) || null,
    verificationOutputDir: cleanText(outcome.verificationOutputDir) || null,
    reviewCategory: cleanText(outcome.reviewCategory) || null,
    detail: cleanText(outcome.detail) || "",
  };
  if (
    payload.wallClockMs != null &&
    (!Number.isFinite(payload.wallClockMs) || payload.wallClockMs < 0)
  ) {
    throw new Error(`${label}.wallClockMs must be a non-negative integer when provided`);
  }
  if (
    payload.totalCostUsd != null &&
    (!Number.isFinite(payload.totalCostUsd) || payload.totalCostUsd < 0)
  ) {
    throw new Error(`${label}.totalCostUsd must be a non-negative number when provided`);
  }
  if (
    payload.partialCorrectness != null &&
    (!Number.isFinite(payload.partialCorrectness) || payload.partialCorrectness < 0)
  ) {
    throw new Error(`${label}.partialCorrectness must be a non-negative number when provided`);
  }
  if (
    payload.communicationDensity != null &&
    (!Number.isFinite(payload.communicationDensity) || payload.communicationDensity < 0)
  ) {
    throw new Error(`${label}.communicationDensity must be a non-negative number when provided`);
  }
  return payload;
}

function aggregateTokenUsage(taskResults) {
  const totals = {};
  let hasUsage = false;
  for (const result of taskResults) {
    if (!result.tokenUsage || typeof result.tokenUsage !== "object" || Array.isArray(result.tokenUsage)) {
      continue;
    }
    hasUsage = true;
    for (const [key, value] of Object.entries(result.tokenUsage)) {
      const numeric = Number.parseInt(String(value), 10);
      if (!Number.isFinite(numeric)) {
        continue;
      }
      totals[key] = (totals[key] || 0) + numeric;
    }
  }
  return hasUsage ? totals : null;
}

function classifyTaskReviewCategory({ success, commandExitCode, detail, structuredCategory }) {
  const normalizedDetail = cleanText(detail).toLowerCase();
  const normalizedStructuredCategory = cleanText(structuredCategory).toLowerCase();
  if (normalizedStructuredCategory && normalizedStructuredCategory !== "harness-env") {
    return normalizedStructuredCategory;
  }
  if (success) {
    return "solved";
  }
  if (normalizedDetail.includes("dry-run plan only") || normalizedDetail.includes("planning only")) {
    return "dry-run-plan";
  }
  if (normalizedDetail.includes("timed out") || normalizedDetail.includes("timeout")) {
    return "timeout";
  }
  if (isVerifierImageFailureDetail(normalizedDetail)) {
    return "verifier-image";
  }
  if (
    normalizedDetail.includes("needs-more-work") ||
    normalizedDetail.includes("proof gap") ||
    normalizedDetail.includes("missing execution summary") ||
    normalizedDetail.includes("blocked")
  ) {
    return "blocked-proof";
  }
  if (isSetupHarnessFailureDetail(normalizedDetail)) {
    return "setup-harness";
  }
  if (commandExitCode !== 0) {
    return "setup-harness";
  }
  return "incorrect-patch";
}

function normalizeTaskArmResult({
  benchmarkId,
  manifest,
  adapter,
  task,
  arm,
  runConfig,
  armTemplate,
  execution,
  verification,
}) {
  const detail = verification.detail || execution.detail || "";
  const reviewCategory = classifyTaskReviewCategory({
    success: Boolean(verification.success),
    commandExitCode: execution.exitCode,
    detail,
    structuredCategory: verification.reviewCategory || null,
  });
  const reviewDisposition = reviewDispositionForCategory(reviewCategory);
  return {
    benchmarkId,
    benchmarkTitle: adapter.title,
    split: manifest.split,
    taskId: task.taskId,
    repo: task.repo,
    repoLanguage: task.repoLanguage,
    complexityLevel: task.complexityLevel,
    protocol: task.protocol,
    teamSize: task.teamSize,
    arm,
    armTemplate: armTemplate.path,
    modelId: runConfig.modelId,
    executorId: runConfig.executorId,
    executorCommand: runConfig.executorCommand,
    toolPermissions: runConfig.toolPermissions,
    temperature: runConfig.temperature,
    reasoningEffort: runConfig.reasoningEffort,
    maxWallClockMinutes: Number.parseInt(String(runConfig.maxWallClockMinutes), 10),
    maxTurns: Number.parseInt(String(runConfig.maxTurns), 10),
    retryLimit: Number.parseInt(String(runConfig.retryLimit), 10),
    verificationHarness: runConfig.verificationHarness,
    datasetVersion: runConfig.datasetVersion,
    success: Boolean(verification.success),
    wallClockMs: verification.wallClockMs ?? execution.wallClockMs ?? null,
    totalCostUsd: verification.totalCostUsd ?? null,
    tokenUsage: verification.tokenUsage ?? null,
    partialCorrectness: verification.partialCorrectness ?? null,
    communicationDensity: verification.communicationDensity ?? null,
    verificationArtifactPath: verification.artifactPath || null,
    patchPath: verification.patchPath || null,
    tracePath:
      armTemplate.tracesRequired && execution.tracePath ? execution.tracePath : null,
    summaryPath: execution.summaryPath || null,
    verificationStdoutPath: verification.verificationStdoutPath || null,
    verificationStderrPath: verification.verificationStderrPath || null,
    verificationOutputDir: verification.verificationOutputDir || null,
    command: execution.command || null,
    commandExitCode: execution.exitCode,
    reviewCategory,
    reviewDisposition,
    detail,
  };
}

function aggregateExternalResults(taskResults, adapter, runConfig, selectedArms) {
  const arms = selectedArms;
  const overall = {};
  for (const arm of arms) {
    const armResults = taskResults.filter((result) => result.arm === arm);
    const solved = armResults.filter((result) => result.success).length;
    const costValues = armResults.map((result) => result.totalCostUsd).filter((value) => value != null);
    const hasCompleteCost = armResults.length > 0 && costValues.length === armResults.length;
    const totalCost = hasCompleteCost
      ? armResults.reduce((total, result) => total + (result.totalCostUsd || 0), 0)
      : null;
    const totalWallClock = armResults.reduce((total, result) => total + (result.wallClockMs || 0), 0);
    const reviewBuckets = {};
    const reviewDispositions = {};
    for (const result of armResults) {
      const bucket = result.reviewCategory || "unknown";
      reviewBuckets[bucket] = (reviewBuckets[bucket] || 0) + 1;
      const disposition = result.reviewDisposition || "unknown";
      reviewDispositions[disposition] = (reviewDispositions[disposition] || 0) + 1;
    }
    overall[arm] = {
      tasks: armResults.length,
      solved,
      successRate: armResults.length === 0 ? 0 : Number(((solved / armResults.length) * 100).toFixed(2)),
      totalCostUsd: totalCost == null ? null : Number(totalCost.toFixed(4)),
      totalWallClockMs: totalWallClock,
      tokenUsageTotals: aggregateTokenUsage(armResults),
      reviewBuckets,
      reviewDispositions,
      costPerSolvedTask:
        solved === 0 || totalCost == null ? null : Number((totalCost / solved).toFixed(4)),
      wallClockPerSolvedTaskMs: solved === 0 ? null : Math.round(totalWallClock / solved),
    };
  }
  const breakdownByLevel = {};
  const levels = Array.from(new Set(taskResults.map((result) => result.complexityLevel).filter(Boolean)));
  for (const level of levels) {
    breakdownByLevel[level] = {};
    for (const arm of arms) {
      const levelResults = taskResults.filter(
        (result) => result.arm === arm && result.complexityLevel === level,
      );
      const solved = levelResults.filter((result) => result.success).length;
      breakdownByLevel[level][arm] = {
        tasks: levelResults.length,
        solved,
        successRate:
          levelResults.length === 0 ? 0 : Number(((solved / levelResults.length) * 100).toFixed(2)),
      };
    }
  }
  const breakdownByTeamSize = {};
  const teamSizes = Array.from(new Set(taskResults.map((result) => result.teamSize).filter(Number.isFinite)));
  for (const teamSize of teamSizes) {
    breakdownByTeamSize[teamSize] = {};
    for (const arm of arms) {
      const grouped = taskResults.filter((result) => result.arm === arm && result.teamSize === teamSize);
      const solved = grouped.filter((result) => result.success).length;
      breakdownByTeamSize[teamSize][arm] = {
        tasks: grouped.length,
        solved,
        successRate: grouped.length === 0 ? 0 : Number(((solved / grouped.length) * 100).toFixed(2)),
      };
    }
  }
  return {
    benchmarkId: adapter.id,
    benchmarkTitle: adapter.title,
    datasetVersion: runConfig.datasetVersion,
    verificationHarness: runConfig.verificationHarness,
    overall,
    breakdownByLevel,
    breakdownByTeamSize,
  };
}

function renderExternalResultsMarkdown(output) {
  const formatTokenUsage = (tokenUsage) => (tokenUsage ? formatCountSummary(tokenUsage) : "n/a");
  const lines = [
    `# External Benchmark Pilot Results`,
    "",
    `- Benchmark: \`${output.adapter.id}\``,
    `- Manifest: \`${output.manifest.path}\``,
    `- Arms: \`${output.selectedArms.join("`, `")}\``,
    `- Comparison-ready: ${output.comparisonReady ? "yes" : "no"}`,
    `- Comparison mode: \`${output.comparisonMode}\``,
    `- Review-only manifest: ${output.manifest.reviewOnly ? "yes" : "no"}`,
    `- Review scope: \`${output.manifest.reviewScope || "n/a"}\``,
    `- Generated: ${output.generatedAt}`,
    `- Mode: ${output.mode}`,
    `- Dry run: ${output.dryRun ? "yes" : "no"}`,
    `- Failure review: \`${output.failureReviewPath}\``,
    `- Failure review JSON: \`${output.failureReviewJsonPath}\``,
    "",
    "## Overall",
  ];
  for (const [arm, stats] of Object.entries(output.summary.overall || {})) {
    lines.push(
      `- ${arm}: solved=${stats.solved}/${stats.tasks} success_rate=${stats.successRate}% cost_per_solved=${stats.costPerSolvedTask ?? "n/a"} wall_clock_per_solved_ms=${stats.wallClockPerSolvedTaskMs ?? "n/a"} token_usage=${formatTokenUsage(stats.tokenUsageTotals)}`,
    );
  }
  if (Object.keys(output.summary.overall || {}).length > 0) {
    lines.push("", "## Review Buckets");
    for (const [arm, stats] of Object.entries(output.summary.overall || {})) {
      const buckets = formatCountSummary(stats.reviewBuckets || {});
      lines.push(`- ${arm}: ${buckets || "n/a"}`);
    }
    lines.push("", "## Review Dispositions");
    for (const [arm, stats] of Object.entries(output.summary.overall || {})) {
      const dispositions = formatCountSummary(stats.reviewDispositions || {});
      lines.push(`- ${arm}: ${dispositions || "n/a"}`);
    }
  }
  if (Object.keys(output.summary.breakdownByLevel || {}).length > 0) {
    lines.push("", "## Complexity Breakdown");
    for (const [level, armStats] of Object.entries(output.summary.breakdownByLevel)) {
      lines.push(`### ${level}`);
      for (const [arm, stats] of Object.entries(armStats)) {
        lines.push(`- ${arm}: solved=${stats.solved}/${stats.tasks} success_rate=${stats.successRate}%`);
      }
    }
  }
  if (Object.keys(output.summary.breakdownByTeamSize || {}).length > 0) {
    lines.push("", "## Team Size Breakdown");
    for (const [teamSize, armStats] of Object.entries(output.summary.breakdownByTeamSize)) {
      lines.push(`### team_size_${teamSize}`);
      for (const [arm, stats] of Object.entries(armStats)) {
        lines.push(`- ${arm}: solved=${stats.solved}/${stats.tasks} success_rate=${stats.successRate}%`);
      }
    }
  }
  return lines.join("\n");
}

function buildExternalFailureReview(output) {
  const byArm = {};
  for (const arm of output.selectedArms) {
    const armResults = output.tasks.filter((result) => result.arm === arm);
    const reviewBuckets = {};
    const reviewDispositions = {};
    for (const result of armResults) {
      const bucket = result.reviewCategory || "unknown";
      reviewBuckets[bucket] = (reviewBuckets[bucket] || 0) + 1;
      const disposition = result.reviewDisposition || "unknown";
      reviewDispositions[disposition] = (reviewDispositions[disposition] || 0) + 1;
    }
    const solved = armResults.filter((result) => result.success).length;
    const blocked =
      output.dryRun ||
      (reviewDispositions["dry-run"] || 0) > 0 ||
      (reviewDispositions["invalidated"] || 0) > 0 ||
      (reviewDispositions["setup-failure"] || 0) > 0 ||
      (reviewDispositions["timeout"] || 0) > 0 ||
      (reviewDispositions["blocked-proof"] || 0) > 0;
    const verdict = output.dryRun
      ? "planning-only"
      : blocked
        ? "blocked"
        : solved === armResults.length
          ? "clean"
          : (reviewDispositions["scored-failure"] || 0) > 0
            ? "scored-failure"
            : "mixed";
    byArm[arm] = {
      taskCount: armResults.length,
      solved,
      officialScore: `${solved}/${armResults.length}`,
      verdict,
      reviewBuckets,
      reviewDispositions,
      invalidatesExternalComparison: blocked || output.comparisonMode !== "pairwise-comparison",
      tasksByDisposition: {
        invalidated: reviewDispositions["invalidated"] || 0,
        setupFailure: reviewDispositions["setup-failure"] || 0,
        trustworthyPatchFailure: reviewDispositions["scored-failure"] || 0,
        timeout: reviewDispositions["timeout"] || 0,
        blockedProof: reviewDispositions["blocked-proof"] || 0,
        dryRun: reviewDispositions["dry-run"] || 0,
      },
      taskResults: armResults.map((result) => ({
        arm: result.arm,
        taskId: result.taskId,
        repo: result.repo,
        officialScore: result.success ? 1 : 0,
        reviewCategory: result.reviewCategory,
        reviewDisposition: result.reviewDisposition,
        wallClockMs: result.wallClockMs,
        detail: result.detail,
        patchPath: result.patchPath,
        summaryPath: result.summaryPath,
        tracePath: result.tracePath,
        verificationArtifactPath: result.verificationArtifactPath,
        verificationStdoutPath: result.verificationStdoutPath,
        verificationStderrPath: result.verificationStderrPath,
        verificationOutputDir: result.verificationOutputDir,
      })),
    };
  }
  return {
    generatedAt: output.generatedAt,
    benchmarkId: output.adapter.id,
    benchmarkTitle: output.adapter.title,
    manifestPath: output.manifest.path,
    manifestId: output.manifest.id,
    comparisonMode: output.comparisonMode,
    comparisonReady: output.comparisonReady,
    reviewOnlyManifest: output.manifest.reviewOnly,
    reviewScope: output.manifest.reviewScope || null,
    dryRun: output.dryRun,
    mode: output.mode,
    selectedArms: output.selectedArms,
    byArm,
  };
}

function renderExternalFailureReviewMarkdown(review) {
  const lines = [
    "# External Benchmark Failure Review",
    "",
    `- Benchmark: \`${review.benchmarkId}\``,
    `- Manifest: \`${review.manifestPath}\``,
    `- Comparison-ready: ${review.comparisonReady ? "yes" : "no"}`,
    `- Comparison mode: \`${review.comparisonMode}\``,
    `- Review-only manifest: ${review.reviewOnlyManifest ? "yes" : "no"}`,
    `- Review scope: \`${review.reviewScope || "n/a"}\``,
    `- Generated: ${review.generatedAt}`,
    `- Mode: ${review.mode}`,
    `- Dry run: ${review.dryRun ? "yes" : "no"}`,
    "",
    "## Verdict",
  ];
  for (const [arm, summary] of Object.entries(review.byArm || {})) {
    lines.push(
      `- ${arm}: verdict=${summary.verdict} official_score=${summary.officialScore} invalidated=${summary.tasksByDisposition.invalidated} setup_failure=${summary.tasksByDisposition.setupFailure} trustworthy_patch_failure=${summary.tasksByDisposition.trustworthyPatchFailure} timeout=${summary.tasksByDisposition.timeout} blocked_proof=${summary.tasksByDisposition.blockedProof} dry_run=${summary.tasksByDisposition.dryRun}`,
    );
  }
  if (Object.keys(review.byArm || {}).length > 0) {
    lines.push("", "## Failure Buckets");
    for (const [arm, summary] of Object.entries(review.byArm || {})) {
      lines.push(`- ${arm}: ${formatCountSummary(summary.reviewBuckets) || "n/a"}`);
    }
    lines.push("", "## Review Dispositions");
    for (const [arm, summary] of Object.entries(review.byArm || {})) {
      lines.push(`- ${arm}: ${formatCountSummary(summary.reviewDispositions) || "n/a"}`);
    }
    lines.push("", "## Task Scorecard");
    lines.push("| Arm | Task | Repo | Official | Review bucket | Review disposition | Wall clock ms | Notes |");
    lines.push("| --- | --- | --- | ---: | --- | --- | ---: | --- |");
    for (const [arm, summary] of Object.entries(review.byArm || {})) {
      for (const task of summary.taskResults || []) {
        lines.push(
          `| ${escapeMarkdownCell(arm)} | \`${escapeMarkdownCell(task.taskId)}\` | \`${escapeMarkdownCell(task.repo || "n/a")}\` | ${task.officialScore} | \`${escapeMarkdownCell(task.reviewCategory || "unknown")}\` | \`${escapeMarkdownCell(task.reviewDisposition || "unknown")}\` | ${task.wallClockMs ?? 0} | ${escapeMarkdownCell(task.detail || "")} |`,
        );
      }
    }
  }
  return lines.join("\n");
}

function executeTaskArm({
  adapter,
  manifest,
  task,
  arm,
  armTemplate,
  runConfig,
  outputDir,
  dryRun,
}) {
  const variables = {
    benchmark_id: adapter.id,
    benchmark_title: adapter.title,
    split: manifest.split || "",
    task_id: task.taskId,
    repo: task.repo || "",
    repo_language: task.repoLanguage || "",
    level: task.level || "",
    complexity_level: task.complexityLevel || "",
    protocol: task.protocol || "",
    team_size: task.teamSize ?? "",
    arm,
    model_id: runConfig.modelId,
    executor_id: runConfig.executorId,
    executor_command: runConfig.executorCommand,
    temperature: runConfig.temperature,
    reasoning_effort: runConfig.reasoningEffort,
    max_wall_clock_minutes: runConfig.maxWallClockMinutes,
    max_turns: runConfig.maxTurns,
    retry_limit: runConfig.retryLimit,
    verification_harness: runConfig.verificationHarness,
    dataset_version: runConfig.datasetVersion,
  };
  const commands = runConfig.commandTemplates || {};
  const commandTemplate = commands[adapter.id]?.[arm] || "";
  const verifyTemplate = commands[adapter.id]?.verify || "";
  const command = commandTemplate ? renderTemplate(commandTemplate, variables) : null;
  const verifyCommand = verifyTemplate ? renderTemplate(verifyTemplate, variables) : null;
  if (task.smoke?.[arm]) {
    const smokeOutcome = normalizeSmokeOutcome(task.smoke[arm], `smoke.${arm}`);
    const artifactPath = path.join(outputDir, "smoke", `${adapter.id}-${arm}-${task.taskId}.json`);
    writeJsonAtomic(artifactPath, smokeOutcome);
    return normalizeTaskArmResult({
      benchmarkId: adapter.id,
      manifest,
      adapter,
      task,
      arm,
      runConfig,
      armTemplate,
      execution: {
        command,
        exitCode: 0,
        wallClockMs: smokeOutcome.wallClockMs,
        tracePath: armTemplate.tracesRequired ? `traces/${task.taskId}/${arm}` : null,
        summaryPath: `summaries/${task.taskId}/${arm}.json`,
      },
      verification: {
        ...smokeOutcome,
        artifactPath: path.relative(REPO_ROOT, artifactPath).replaceAll(path.sep, "/"),
      },
    });
  }
  if (dryRun) {
    return normalizeTaskArmResult({
      benchmarkId: adapter.id,
      manifest,
      adapter,
      task,
      arm,
      runConfig,
      armTemplate,
      execution: {
        command,
        exitCode: 0,
        wallClockMs: 0,
        tracePath: armTemplate.tracesRequired ? `traces/${task.taskId}/${arm}` : null,
        summaryPath: `plans/${task.taskId}/${arm}.json`,
        detail: "dry-run plan only",
      },
      verification: {
        success: false,
        wallClockMs: 0,
        totalCostUsd: null,
        tokenUsage: null,
        partialCorrectness: null,
        communicationDensity: null,
        artifactPath: null,
        detail: "dry-run plan only",
      },
    });
  }
  if (!command) {
    throw new Error(
      `Missing execution command template for adapter ${adapter.id} arm ${arm}; use --dry-run or provide commandTemplates.`,
    );
  }
  const execution = executeCommand(command, REPO_ROOT);
  const executionStructured = normalizeStructuredCommandOutcome(
    parseStructuredCommandOutput(execution.stdout),
    "execution output",
  );
  let verification = {
    success: executionStructured?.success ?? execution.exitCode === 0,
    wallClockMs: executionStructured?.wallClockMs ?? execution.wallClockMs,
    totalCostUsd: executionStructured?.totalCostUsd ?? null,
    tokenUsage: executionStructured?.tokenUsage ?? null,
    partialCorrectness: executionStructured?.partialCorrectness ?? null,
    communicationDensity: executionStructured?.communicationDensity ?? null,
    artifactPath: executionStructured?.artifactPath || null,
    patchPath: executionStructured?.patchPath || null,
    verificationStdoutPath: executionStructured?.verificationStdoutPath || null,
    verificationStderrPath: executionStructured?.verificationStderrPath || null,
    verificationOutputDir: executionStructured?.verificationOutputDir || null,
    reviewCategory: executionStructured?.reviewCategory || null,
    detail:
      executionStructured?.detail ||
      (execution.exitCode === 0 ? "command completed" : execution.stderr || execution.stdout),
  };
  if (verifyCommand) {
    const verifyResult = executeCommand(verifyCommand, REPO_ROOT);
    const verifyStructured = normalizeStructuredCommandOutcome(
      parseStructuredCommandOutput(verifyResult.stdout),
      "verification output",
    );
    verification = {
      ...verification,
      success: verifyStructured?.success ?? verifyResult.exitCode === 0,
      wallClockMs: verifyStructured?.wallClockMs ?? executionStructured?.wallClockMs ?? execution.wallClockMs,
      totalCostUsd: verifyStructured?.totalCostUsd ?? verification.totalCostUsd,
      tokenUsage: verifyStructured?.tokenUsage ?? verification.tokenUsage,
      partialCorrectness: verifyStructured?.partialCorrectness ?? verification.partialCorrectness,
      communicationDensity: verifyStructured?.communicationDensity ?? verification.communicationDensity,
      artifactPath: verifyStructured?.artifactPath || verification.artifactPath,
      patchPath: verifyStructured?.patchPath || verification.patchPath,
      verificationStdoutPath:
        verifyStructured?.verificationStdoutPath || verification.verificationStdoutPath,
      verificationStderrPath:
        verifyStructured?.verificationStderrPath || verification.verificationStderrPath,
      verificationOutputDir:
        verifyStructured?.verificationOutputDir || verification.verificationOutputDir,
      reviewCategory: verifyStructured?.reviewCategory || verification.reviewCategory,
      detail:
        verifyStructured?.detail ||
        (verifyResult.exitCode === 0 ? verifyResult.stdout.trim() : verifyResult.stderr.trim()),
    };
  }
  return normalizeTaskArmResult({
    benchmarkId: adapter.id,
    manifest,
    adapter,
    task,
    arm,
    runConfig,
    armTemplate,
    execution: {
      command,
      exitCode: execution.exitCode,
      wallClockMs: execution.wallClockMs,
      tracePath:
        armTemplate.tracesRequired ? executionStructured?.tracePath || `traces/${task.taskId}/${arm}` : null,
      summaryPath: executionStructured?.summaryPath || null,
      detail: executionStructured?.detail || execution.stderr || execution.stdout,
    },
    verification,
  });
}

export function runExternalBenchmarkPilot(options = {}) {
  const adapters = loadExternalBenchmarkAdapters(options);
  const adapterId = normalizeId(options.adapterId, "adapterId");
  const adapter = adapters.adapters.find((entry) => entry.id === adapterId);
  if (!adapter) {
    throw new Error(`Unknown external benchmark adapter: ${adapterId}`);
  }
  const manifest = loadExternalPilotManifest(
    options.manifestPath || adapter.pilotManifestPath || `${DEFAULT_EXTERNAL_PILOTS_DIR}/${adapterId}.json`,
  );
  if (manifest.benchmarkId !== adapter.id) {
    throw new Error(`Pilot manifest ${manifest.path} is for ${manifest.benchmarkId}, not ${adapter.id}`);
  }
  const templates = loadExternalArmTemplates(options);
  const selectedArms = normalizeSelectedExternalArms(options.arms);
  const runConfig = {
    benchmarkId: adapter.id,
    modelId: cleanText(options.modelId),
    executorId: cleanText(options.executorId),
    executorCommand: cleanText(options.executorCommand),
    toolPermissions: cleanText(options.toolPermissions),
    temperature: cleanText(options.temperature),
    reasoningEffort: cleanText(options.reasoningEffort),
    maxWallClockMinutes: cleanText(options.maxWallClockMinutes),
    maxTurns: cleanText(options.maxTurns),
    retryLimit: cleanText(options.retryLimit),
    verificationHarness: cleanText(options.verificationHarness),
    datasetVersion: cleanText(options.datasetVersion),
    armOverrides:
      options.armOverrides && typeof options.armOverrides === "object" && !Array.isArray(options.armOverrides)
        ? options.armOverrides
        : {},
    commandTemplates:
      options.commandTemplates && typeof options.commandTemplates === "object" && !Array.isArray(options.commandTemplates)
        ? options.commandTemplates
        : {},
  };
  if (options.commandConfigPath) {
    const commandConfig = loadExternalCommandConfig(options.commandConfigPath);
    runConfig.commandTemplates = commandConfig.adapters;
  }
  assertComparableExternalRunConfig(runConfig);
  const outputDir = path.resolve(
    REPO_ROOT,
    normalizeRepoRelativePath(
      options.outputDir || `.tmp/wave-benchmarks/external/${adapter.id}`,
      "outputDir",
    ),
  );
  ensureDirectory(outputDir);
  const selectedTaskIds = options.taskIds?.length
    ? new Set(options.taskIds.map((taskId) => cleanText(taskId)))
    : null;
  const expandedTasks = manifest.tasks
    .filter((task) => !selectedTaskIds || selectedTaskIds.has(task.taskId))
    .flatMap((task) => {
      const teamSizes = task.teamSize != null ? [task.teamSize] : manifest.teamSizes;
      if (!Array.isArray(teamSizes) || teamSizes.length === 0) {
        return [task];
      }
      return teamSizes.map((teamSize) => ({
        ...task,
        teamSize,
        complexityLevel: task.complexityLevel || task.level,
      }));
    });
  const taskResults = [];
  for (const task of expandedTasks) {
    for (const arm of selectedArms) {
      const armTemplate = templates.templates.get(arm);
      taskResults.push(
        executeTaskArm({
          adapter,
          manifest,
          task,
          arm,
          armTemplate,
          runConfig,
          outputDir,
          dryRun: options.dryRun !== false ? Boolean(options.dryRun) : false,
        }),
      );
    }
  }
  const comparisonReady =
    !manifest.reviewOnly &&
    selectedArms.length === EXTERNAL_BENCHMARK_ARMS.length &&
    EXTERNAL_BENCHMARK_ARMS.every((arm) => selectedArms.includes(arm));
  const summary = aggregateExternalResults(taskResults, adapter, runConfig, selectedArms);
  const output = {
    generatedAt: toIsoTimestamp(),
    dryRun: Boolean(options.dryRun),
    mode: options.dryRun ? "plan" : "execution",
    selectedArms,
    comparisonReady,
    comparisonMode: comparisonReady ? "pairwise-comparison" : "review-only",
    adapter,
    manifest,
    armTemplates: Object.fromEntries(
      selectedArms.map((arm) => [arm, templates.templates.get(arm)]),
    ),
    failureReviewPath: path.relative(REPO_ROOT, path.join(outputDir, "failure-review.md")).replaceAll(path.sep, "/"),
    failureReviewJsonPath: path
      .relative(REPO_ROOT, path.join(outputDir, "failure-review.json"))
      .replaceAll(path.sep, "/"),
    runConfig: {
      ...runConfig,
      commandTemplates: undefined,
      armOverrides: undefined,
    },
    tasks: taskResults,
    summary,
  };
  const failureReview = buildExternalFailureReview(output);
  writeJsonAtomic(path.join(outputDir, "results.json"), output);
  writeTextAtomic(path.join(outputDir, "results.md"), `${renderExternalResultsMarkdown(output)}\n`);
  writeJsonAtomic(path.join(outputDir, "failure-review.json"), failureReview);
  writeTextAtomic(path.join(outputDir, "failure-review.md"), `${renderExternalFailureReviewMarkdown(failureReview)}\n`);
  return {
    ...output,
    outputDir: path.relative(REPO_ROOT, outputDir).replaceAll(path.sep, "/"),
  };
}
