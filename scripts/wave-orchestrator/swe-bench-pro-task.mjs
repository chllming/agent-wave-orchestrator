import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildCodexExecInvocation } from "./executors.mjs";
import { REPO_ROOT, ensureDirectory, shellQuote, toIsoTimestamp, writeJsonAtomic, writeTextAtomic } from "./shared.mjs";

const DEFAULT_PYTHON_BIN = path.join(REPO_ROOT, ".tmp", "bench-tools", "swe-bench-pro-venv", "bin", "python");
const DEFAULT_SWE_BENCH_ROOT = path.join(REPO_ROOT, ".tmp", "bench-tools", "SWE-bench_Pro-os");
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, ".tmp", "wave-benchmarks", "swe-bench-pro-live");
const WAVE_ENTRY = path.join(REPO_ROOT, "scripts", "wave.mjs");

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

function normalizeArm(value) {
  const arm = cleanText(value);
  if (!["single-agent", "full-wave"].includes(arm)) {
    throw new Error(`Unsupported SWE-bench Pro arm: ${value}`);
  }
  return arm;
}

function parseArgs(argv) {
  const options = {
    command: "",
    instanceId: "",
    arm: "",
    modelId: "",
    reasoningEffort: "high",
    maxWallClockMinutes: 45,
    maxTurns: 250,
    pythonBin: DEFAULT_PYTHON_BIN,
    sweBenchRoot: DEFAULT_SWE_BENCH_ROOT,
    outputRoot: DEFAULT_OUTPUT_ROOT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!options.command) {
      options.command = cleanText(arg);
      continue;
    }
    if (arg === "--instance") {
      options.instanceId = cleanText(argv[++index]);
    } else if (arg === "--arm") {
      options.arm = cleanText(argv[++index]);
    } else if (arg === "--model") {
      options.modelId = cleanText(argv[++index]);
    } else if (arg === "--reasoning-effort") {
      options.reasoningEffort = cleanText(argv[++index]) || "high";
    } else if (arg === "--max-wall-clock-minutes") {
      options.maxWallClockMinutes = Number.parseInt(String(argv[++index] || "45"), 10) || 45;
    } else if (arg === "--max-turns") {
      options.maxTurns = Number.parseInt(String(argv[++index] || "250"), 10) || 250;
    } else if (arg === "--python-bin") {
      options.pythonBin = cleanText(argv[++index]) || DEFAULT_PYTHON_BIN;
    } else if (arg === "--swe-bench-root") {
      options.sweBenchRoot = cleanText(argv[++index]) || DEFAULT_SWE_BENCH_ROOT;
    } else if (arg === "--output-root") {
      options.outputRoot = cleanText(argv[++index]) || DEFAULT_OUTPUT_ROOT;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.command) {
    throw new Error("Usage: node scripts/wave-orchestrator/swe-bench-pro-task.mjs run --instance <id> --arm <single-agent|full-wave> --model <id>");
  }
  return options;
}

function runShellCommand(command, { cwd, timeoutMs = 0, env = {} } = {}) {
  const startedAt = Date.now();
  const result = spawnSync("bash", ["-lc", `set -o pipefail; ${command}`], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
  });
  return {
    command,
    cwd,
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    signal: result.signal || null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
    wallClockMs: Date.now() - startedAt,
  };
}

function assertSuccess(result, label) {
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`${label} timed out after ${result.wallClockMs}ms`);
  }
  if (result.exitCode !== 0) {
    const detail = cleanText(result.stderr || result.stdout) || "no output";
    throw new Error(`${label} failed (${result.exitCode}): ${detail}`);
  }
}

function loadDatasetRow(instanceId, pythonBin) {
  const pythonScript = `
import json
import sys
from datasets import load_dataset

instance_id = sys.argv[1]
dataset = load_dataset("ScaleAI/SWE-bench_Pro", split="test")
row = next((entry for entry in dataset if entry["instance_id"] == instance_id), None)
if row is None:
    raise SystemExit(f"unknown instance: {instance_id}")
print(json.dumps(row))
`;
  const result = spawnSync(pythonBin, ["-c", pythonScript, instanceId], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to load SWE-bench Pro row for ${instanceId}: ${cleanText(result.stderr || result.stdout)}`);
  }
  return JSON.parse(result.stdout);
}

function normalizeSerializedList(value) {
  if (value == null || value === "" || value === "None") {
    return "[]";
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

function normalizeRawSampleRow(row) {
  return {
    instance_id: cleanText(row.instance_id),
    repo: cleanText(row.repo),
    problem_statement: String(row.problem_statement || ""),
    base_commit: cleanText(row.base_commit),
    before_repo_set_cmd: String(row.before_repo_set_cmd || ""),
    selected_test_files_to_run: normalizeSerializedList(
      row.selected_test_files_to_run ?? row.SELECTED_TEST_FILES_TO_RUN,
    ),
    fail_to_pass: normalizeSerializedList(row.fail_to_pass ?? row.FAIL_TO_PASS),
    pass_to_pass: normalizeSerializedList(row.pass_to_pass ?? row.PASS_TO_PASS),
    base_dockerfile: String(row.base_dockerfile || ""),
    instance_dockerfile: String(row.instance_dockerfile || ""),
  };
}

function ensureFreshDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function prepareTaskWorkspace(row, arm, outputRoot) {
  const runId = `${row.instance_id}-${arm}-${crypto.randomBytes(4).toString("hex")}`;
  const taskRoot = path.resolve(REPO_ROOT, outputRoot, runId);
  const repoDir = path.join(taskRoot, "repo");
  ensureFreshDir(taskRoot);
  return {
    runId,
    taskRoot,
    repoDir,
    artifactsDir: path.join(taskRoot, "artifacts"),
    logsDir: path.join(taskRoot, "logs"),
    evalDir: path.join(taskRoot, "eval"),
  };
}

function cloneRepo(row, repoDir) {
  ensureDirectory(path.dirname(repoDir));
  const clone = runShellCommand(
    `git clone https://github.com/${row.repo}.git ${shellQuote(repoDir)}`,
    { cwd: REPO_ROOT, timeoutMs: 20 * 60 * 1000 },
  );
  assertSuccess(clone, `clone ${row.repo}`);
  const prep = runShellCommand(String(row.before_repo_set_cmd || ""), {
    cwd: repoDir,
    timeoutMs: 10 * 60 * 1000,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  assertSuccess(prep, `prepare ${row.instance_id}`);
}

function parseCodexUsageFromLog(logPath) {
  if (!fs.existsSync(logPath)) {
    return { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  }
  const usage = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
  };
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const payload = JSON.parse(trimmed);
      if (payload.type === "turn.completed" && payload.usage && typeof payload.usage === "object") {
        usage.input_tokens += Number(payload.usage.input_tokens || 0);
        usage.cached_input_tokens += Number(payload.usage.cached_input_tokens || 0);
        usage.output_tokens += Number(payload.usage.output_tokens || 0);
      }
    } catch {
      // Ignore non-JSON or partial lines.
    }
  }
  return usage;
}

function mergeUsageTotals(list) {
  return list.reduce(
    (total, entry) => ({
      input_tokens: total.input_tokens + Number(entry.input_tokens || 0),
      cached_input_tokens: total.cached_input_tokens + Number(entry.cached_input_tokens || 0),
      output_tokens: total.output_tokens + Number(entry.output_tokens || 0),
    }),
    { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
  );
}

function buildSingleAgentPrompt(row) {
  return [
    `You are solving one SWE-bench Pro task in the repository ${row.repo}.`,
    "",
    "Solve the issue using only the repository checkout and the issue text below.",
    "Do not use gold patches, benchmark answers, evaluator outputs, or any external answer source.",
    "Prefer the smallest correct patch that fixes the described bug.",
    "You may inspect and edit files and run lightweight local checks if helpful, but do not spend most of your budget on heavyweight environment reconstruction.",
    "Leave your code changes in the working tree and do not create commits.",
    "",
    "Issue statement:",
    String(row.problem_statement || ""),
    "",
    `Official target tests: ${normalizeSerializedList(row.selected_test_files_to_run)}`,
    "",
    "Final response requirements:",
    "- summarize the root cause and files changed",
    "- mention any local checks you ran, or state that you relied on static reasoning only",
  ].join("\n");
}

function buildFullWaveMarkdown(row, modelId, reasoningEffort, maxWallClockMinutes, maxTurns) {
  const testList = normalizeSerializedList(row.selected_test_files_to_run);
  return `# Wave 1 - SWE-bench Pro Task Solve

**Commit message**: \`Feat: solve ${row.instance_id}\`

## Sequencing note

- This is a frozen benchmark solve attempt for \`${row.instance_id}\`. Use only the issue statement, repository checkout, and your own reasoning. Do not use gold patches, verifier outputs, or benchmark answer sources.

## Reference rule

- The benchmark contract is fixed before launch. Agents may solve the task, validate locally when practical, and close the wave, but they must not tune against hidden verifier feedback.

## Component promotions

- benchmark-program-and-evals: baseline-proved

## Context7 defaults

- bundle: none

## Eval targets

- id: issue-acceptance-review | selection: pinned | benchmarks: manual-session-review | objective: Re-check the landed diff against the issue statement and the official target tests before closure | threshold: The landed diff addresses the issue requirements without obvious unresolved gaps

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- id: codex
- model: ${modelId}
- budget.minutes: ${maxWallClockMinutes}
- budget.turns: ${maxTurns}
- codex.json: true
- codex.config: model_reasoning_effort=${reasoningEffort}

### Context7

- bundle: none

### Prompt

\`\`\`text
Primary goal:
- Close this benchmark solve attempt fail-closed.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/current-state.md, docs/plans/master-plan.md, and docs/plans/migration.md.

Specific expectations:
- do not treat effort or plausible narration as proof
- do not use any benchmark answer source outside this repository checkout and the issue statement
- BLOCKED is acceptable if the landed evidence is not strong enough

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-1-cont-qa.md
\`\`\`

## Agent E0: cont-EVAL

### Role prompts

- docs/agents/wave-cont-eval-role.md

### Executor

- id: codex
- model: ${modelId}
- budget.minutes: ${maxWallClockMinutes}
- budget.turns: ${maxTurns}
- codex.json: true
- codex.config: model_reasoning_effort=${reasoningEffort}

### Context7

- bundle: none

### Prompt

\`\`\`text
Primary goal:
- Review the landed implementation against the issue statement and the official target test scope without changing source files directly.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/evals/README.md.

Specific expectations:
- stay report-only for this wave
- use the issue statement and target test scope below as the acceptance contract
- do not use verifier output or hidden benchmark answers as solve hints

Issue statement:
${String(row.problem_statement || "")}

Official target tests:
- ${testList}

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-1-cont-eval.md
\`\`\`

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- id: codex
- model: ${modelId}
- budget.minutes: ${maxWallClockMinutes}
- budget.turns: ${maxTurns}
- codex.json: true
- codex.config: model_reasoning_effort=${reasoningEffort}

### Context7

- bundle: none

### Prompt

\`\`\`text
Primary goal:
- Integrate the implementation and review evidence into one closure-ready judgment.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/current-state.md and docs/plans/master-plan.md.

Specific expectations:
- keep benchmark fairness explicit
- name blockers instead of smoothing them over

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-1.md
- .tmp/main-wave-launcher/integration/wave-1.json
\`\`\`

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- id: codex
- model: ${modelId}
- budget.minutes: ${maxWallClockMinutes}
- budget.turns: ${maxTurns}
- codex.json: true
- codex.config: model_reasoning_effort=${reasoningEffort}

### Context7

- bundle: none

### Prompt

\`\`\`text
Primary goal:
- Close the documentation surface without polluting the benchmark patch with Wave scaffolding changes.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/current-state.md, docs/plans/master-plan.md, and docs/plans/migration.md.

Specific expectations:
- prefer no-change when shared-plan docs are unrelated to the repository bug fix
- do not treat Wave scaffold changes as part of the benchmark patch

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
\`\`\`

## Agent A1: Root Cause And Patch

### Executor

- id: codex
- model: ${modelId}
- budget.minutes: ${maxWallClockMinutes}
- budget.turns: ${maxTurns}
- codex.json: true
- codex.config: model_reasoning_effort=${reasoningEffort}

### Context7

- bundle: none

### Components

- benchmark-program-and-evals

### Exit contract

- completion: integrated
- durability: none
- proof: integration
- doc-impact: owned

### Prompt

\`\`\`text
Primary goal:
- Diagnose the bug and land the smallest correct source patch.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read README.md if it helps orient the repository.

Specific expectations:
- use only this issue statement and the repository checkout
- do not use gold patches, evaluator outputs, or hidden benchmark answers
- coordinate with A2 when a regression test should change
- prefer a minimal diff that fixes the root cause

Issue statement:
${String(row.problem_statement || "")}

Official target tests:
- ${testList}

File ownership (only touch these paths):
- src/
- source/
- lib/
- server/
- client/
- public/
- package.json
- pnpm-lock.yaml
- package-lock.json
- yarn.lock
- README.md
\`\`\`

## Agent A2: Regression Tests And Acceptance

### Executor

- id: codex
- model: ${modelId}
- budget.minutes: ${maxWallClockMinutes}
- budget.turns: ${maxTurns}
- codex.json: true
- codex.config: model_reasoning_effort=${reasoningEffort}

### Context7

- bundle: none

### Components

- benchmark-program-and-evals

### Exit contract

- completion: integrated
- durability: none
- proof: integration
- doc-impact: owned

### Prompt

\`\`\`text
Primary goal:
- Add or adjust the narrowest regression coverage needed and independently check that the patch matches the issue requirements.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read the issue statement and the files A1 changes before editing.

Specific expectations:
- keep tests tightly scoped to the bug
- do not broaden the patch unless the issue requires it
- if a reliable local test run is not practical in this environment, say so explicitly rather than fabricating proof

Issue statement:
${String(row.problem_statement || "")}

Official target tests:
- ${testList}

File ownership (only touch these paths):
- test/
- tests/
- __tests__/
- spec/
\`\`\`
`;
}

function renderWaveRepoGuide() {
  return `# Repository Guidance

- This repository is being used as a benchmark task workspace.
- Only edit source files needed for the task and the Wave-owned closure reports.
- Do not use benchmark gold patches, hidden answers, or verifier outputs as solve hints.
- Keep changes minimal and reviewable.
`;
}

function normalizeBenchmarkWaveConfig(repoDir) {
  const configPath = path.join(repoDir, "wave.config.json");
  if (!fs.existsSync(configPath)) {
    return;
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const runtimePolicy = {
    ...(config.lanes?.main?.runtimePolicy || {}),
    runtimeMixTargets: {
      codex: 10,
      claude: 0,
      opencode: 0,
    },
    defaultExecutorByRole: {
      implementation: "codex",
      integration: "codex",
      documentation: "codex",
      "cont-qa": "codex",
      "cont-eval": "codex",
      security: "codex",
      research: "codex",
      infra: "codex",
      deploy: "codex",
    },
    fallbackExecutorOrder: ["codex", "claude", "opencode"],
  };
  config.executors = {
    ...(config.executors || {}),
    default: "codex",
  };
  config.lanes = {
    ...(config.lanes || {}),
    main: {
      ...(config.lanes?.main || {}),
      runtimePolicy,
    },
  };
  writeJsonAtomic(configPath, config);
}

function writeFullWaveScaffold(row, repoDir, modelId, reasoningEffort, maxWallClockMinutes, maxTurns) {
  const docsRefDir = path.join(repoDir, "docs", "reference");
  ensureDirectory(docsRefDir);
  const repoGuidePath = path.join(docsRefDir, "repository-guidance.md");
  if (!fs.existsSync(repoGuidePath)) {
    writeTextAtomic(repoGuidePath, `${renderWaveRepoGuide()}\n`);
  }
  const wavePath = path.join(repoDir, "docs", "plans", "waves", "wave-1.md");
  writeTextAtomic(
    wavePath,
    `${buildFullWaveMarkdown(row, modelId, reasoningEffort, maxWallClockMinutes, maxTurns)}\n`,
  );
  return wavePath;
}

function removeSeededStarterWave(repoDir) {
  fs.rmSync(path.join(repoDir, "docs", "plans", "waves", "wave-0.md"), { force: true });
  fs.rmSync(path.join(repoDir, "docs", "plans", "waves", "specs", "wave-0.json"), { force: true });
}

function parseGitStatusPorcelain(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2),
      path: line.slice(3).trim(),
    }));
}

function shouldExcludeFromBenchmarkPatch(relPath, seededFiles) {
  const normalized = relPath.replaceAll(path.sep, "/");
  if (!normalized) {
    return true;
  }
  if (normalized.startsWith(".wave/") || normalized.startsWith(".tmp/")) {
    return true;
  }
  if (seededFiles.has(normalized)) {
    return true;
  }
  return [
    "docs/agents/",
    "docs/context7/",
    "docs/evals/",
    "docs/guides/",
    "docs/plans/",
    "docs/reference/",
    "docs/research/",
    "skills/",
  ].some((prefix) => normalized.startsWith(prefix)) || normalized === "wave.config.json";
}

function buildDiffPathspecs(seededFiles) {
  const exactFiles = Array.from(seededFiles).map((filePath) => `:(exclude)${filePath}`);
  const globExcludes = [
    ".wave/**",
    ".tmp/**",
    "docs/agents/**",
    "docs/context7/**",
    "docs/evals/**",
    "docs/guides/**",
    "docs/plans/**",
    "docs/reference/**",
    "docs/research/**",
    "skills/**",
  ].map((pattern) => `:(glob,exclude)${pattern}`);
  return Array.from(new Set([...exactFiles, ":(exclude)wave.config.json", ...globExcludes]));
}

function buildPatch(repoDir, seededFiles = new Set()) {
  const status = runShellCommand("git status --porcelain=v1 -uall", { cwd: repoDir });
  assertSuccess(status, "git status");
  const untracked = parseGitStatusPorcelain(status.stdout)
    .filter((entry) => entry.code === "??")
    .map((entry) => entry.path)
    .filter((entry) => !shouldExcludeFromBenchmarkPatch(entry, seededFiles));
  if (untracked.length > 0) {
    const addIntent = runShellCommand(
      `git add -N -- ${untracked.map((filePath) => shellQuote(filePath)).join(" ")}`,
      { cwd: repoDir },
    );
    assertSuccess(addIntent, "git add -N");
  }
  const pathspecs = buildDiffPathspecs(seededFiles);
  const diffCommand = `git diff --binary HEAD -- . ${pathspecs.map((entry) => shellQuote(entry)).join(" ")}`.trim();
  const diff = runShellCommand(diffCommand, { cwd: repoDir });
  assertSuccess(diff, "git diff");
  return diff.stdout;
}

function parseWaveCodexUsage(repoDir) {
  const logsDir = path.join(repoDir, ".tmp", "main-wave-launcher", "logs");
  if (!fs.existsSync(logsDir)) {
    return { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  }
  const usages = fs
    .readdirSync(logsDir)
    .filter((name) => name.startsWith("wave-1-") && name.endsWith(".log"))
    .map((name) => parseCodexUsageFromLog(path.join(logsDir, name)));
  return mergeUsageTotals(usages);
}

function buildSingleAgentSolve(row, taskWorkspace, options) {
  ensureDirectory(taskWorkspace.logsDir);
  const promptPath = path.join(taskWorkspace.logsDir, "single-agent-prompt.txt");
  const logPath = path.join(taskWorkspace.logsDir, "single-agent-codex.jsonl");
  writeTextAtomic(promptPath, `${buildSingleAgentPrompt(row)}\n`);
  const command = buildCodexExecInvocation(promptPath, logPath, "danger-full-access", "codex", {
    model: options.modelId,
    config: [`model_reasoning_effort=${options.reasoningEffort}`],
    search: false,
    json: true,
    ephemeral: false,
  });
  const result = runShellCommand(command, {
    cwd: taskWorkspace.repoDir,
    timeoutMs: options.maxWallClockMinutes * 60 * 1000,
  });
  return {
    execution: result,
    tokenUsage: parseCodexUsageFromLog(logPath),
    tracePath: null,
    summaryPath: path.relative(REPO_ROOT, logPath).replaceAll(path.sep, "/"),
  };
}

function buildFullWaveSolve(row, taskWorkspace, options) {
  const init = runShellCommand(`node ${shellQuote(WAVE_ENTRY)} init --json`, {
    cwd: taskWorkspace.repoDir,
    timeoutMs: 2 * 60 * 1000,
  });
  assertSuccess(init, "wave init");
  const initPayload = JSON.parse(init.stdout);
  const seededFiles = new Set((initPayload.seededFiles || []).map((filePath) => String(filePath).replaceAll("\\", "/")));
  normalizeBenchmarkWaveConfig(taskWorkspace.repoDir);
  removeSeededStarterWave(taskWorkspace.repoDir);
  writeFullWaveScaffold(
    row,
    taskWorkspace.repoDir,
    options.modelId,
    options.reasoningEffort,
    options.maxWallClockMinutes,
    options.maxTurns,
  );
  const doctor = runShellCommand(`node ${shellQuote(WAVE_ENTRY)} doctor --json`, {
    cwd: taskWorkspace.repoDir,
    timeoutMs: 2 * 60 * 1000,
  });
  assertSuccess(doctor, "wave doctor");
  const launch = runShellCommand(
    `node ${shellQuote(WAVE_ENTRY)} launch --lane main --start-wave 1 --end-wave 1 --no-dashboard`,
    {
      cwd: taskWorkspace.repoDir,
      timeoutMs: options.maxWallClockMinutes * 60 * 1000,
    },
  );
  const integrationSummaryPath = path.join(
    taskWorkspace.repoDir,
    ".tmp",
    "main-wave-launcher",
    "integration",
    "wave-1.md",
  );
  const tracePath = path.join(taskWorkspace.repoDir, "traces", "wave-1");
  return {
    execution: launch,
    tokenUsage: parseWaveCodexUsage(taskWorkspace.repoDir),
    seededFiles,
    tracePath: fs.existsSync(tracePath) ? path.relative(REPO_ROOT, tracePath).replaceAll(path.sep, "/") : null,
    summaryPath: fs.existsSync(integrationSummaryPath)
      ? path.relative(REPO_ROOT, integrationSummaryPath).replaceAll(path.sep, "/")
      : null,
  };
}

function evaluatePatch(row, patch, taskWorkspace, options, arm) {
  ensureDirectory(taskWorkspace.evalDir);
  const rawSamplePath = path.join(taskWorkspace.evalDir, "raw-sample.jsonl");
  const patchPath = path.join(taskWorkspace.evalDir, "patches.json");
  const outputDir = path.join(taskWorkspace.evalDir, "output");
  const stdoutPath = path.join(taskWorkspace.evalDir, "official-eval.stdout.log");
  const stderrPath = path.join(taskWorkspace.evalDir, "official-eval.stderr.log");
  const commandPath = path.join(taskWorkspace.evalDir, "official-eval.command.txt");
  ensureDirectory(outputDir);
  const rawRow = normalizeRawSampleRow(row);
  fs.writeFileSync(rawSamplePath, `${JSON.stringify(rawRow)}\n`, "utf8");
  fs.writeFileSync(
    patchPath,
    `${JSON.stringify([{ instance_id: row.instance_id, patch, prefix: arm }], null, 2)}\n`,
    "utf8",
  );
  const evalCommand = [
    shellQuote(options.pythonBin),
    shellQuote(path.join(options.sweBenchRoot, "swe_bench_pro_eval.py")),
    `--raw_sample_path=${shellQuote(rawSamplePath)}`,
    `--patch_path=${shellQuote(patchPath)}`,
    `--output_dir=${shellQuote(outputDir)}`,
    `--scripts_dir=${shellQuote(path.join(options.sweBenchRoot, "run_scripts"))}`,
    "--num_workers=1",
    "--dockerhub_username=jefzda",
    "--use_local_docker",
  ].join(" ");
  fs.writeFileSync(commandPath, `${evalCommand}\n`, "utf8");
  const result = runShellCommand(evalCommand, {
    cwd: options.sweBenchRoot,
    timeoutMs: 60 * 60 * 1000,
  });
  fs.writeFileSync(stdoutPath, result.stdout || "", "utf8");
  fs.writeFileSync(stderrPath, result.stderr || "", "utf8");
  const evalResultsPath = path.join(outputDir, "eval_results.json");
  if (result.error?.code === "ETIMEDOUT") {
    return {
      success: false,
      artifactPath: null,
      verificationStdoutPath: path.relative(REPO_ROOT, stdoutPath).replaceAll(path.sep, "/"),
      verificationStderrPath: path.relative(REPO_ROOT, stderrPath).replaceAll(path.sep, "/"),
      verificationOutputDir: path.relative(REPO_ROOT, outputDir).replaceAll(path.sep, "/"),
      reviewCategory: "timeout",
      detail: `official SWE-bench Pro evaluation timed out after ${result.wallClockMs}ms`,
    };
  }
  if (result.exitCode !== 0) {
    const detail = cleanText(result.stderr || result.stdout) || "no output";
    return {
      success: false,
      artifactPath: fs.existsSync(evalResultsPath)
        ? path.relative(REPO_ROOT, evalResultsPath).replaceAll(path.sep, "/")
        : null,
      verificationStdoutPath: path.relative(REPO_ROOT, stdoutPath).replaceAll(path.sep, "/"),
      verificationStderrPath: path.relative(REPO_ROOT, stderrPath).replaceAll(path.sep, "/"),
      verificationOutputDir: path.relative(REPO_ROOT, outputDir).replaceAll(path.sep, "/"),
      reviewCategory: isVerifierImageFailureDetail(detail.toLowerCase()) ? "verifier-image" : "setup-harness",
      detail: `official SWE-bench Pro evaluation failed (${result.exitCode}): ${detail}`,
    };
  }
  const evalResults = JSON.parse(fs.readFileSync(evalResultsPath, "utf8"));
  const success = Boolean(evalResults[row.instance_id]);
  return {
    success,
    artifactPath: path.relative(REPO_ROOT, evalResultsPath).replaceAll(path.sep, "/"),
    verificationStdoutPath: path.relative(REPO_ROOT, stdoutPath).replaceAll(path.sep, "/"),
    verificationStderrPath: path.relative(REPO_ROOT, stderrPath).replaceAll(path.sep, "/"),
    verificationOutputDir: path.relative(REPO_ROOT, outputDir).replaceAll(path.sep, "/"),
    detail: cleanText(result.stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) || "evaluation completed",
  };
}

function classifyReviewCategory({ solve, evaluation }) {
  if (evaluation.reviewCategory) {
    return evaluation.reviewCategory;
  }
  if (evaluation.success) {
    return "solved";
  }
  const detail = cleanText(evaluation.detail).toLowerCase();
  if (detail.includes("dry-run plan only") || detail.includes("planning only")) {
    return "dry-run-plan";
  }
  if (solve.execution.error?.code === "ETIMEDOUT" || detail.includes("timed out") || detail.includes("timeout")) {
    return "timeout";
  }
  if (isVerifierImageFailureDetail(detail)) {
    return "verifier-image";
  }
  if (detail.includes("needs-more-work") || detail.includes("proof gap") || detail.includes("blocked")) {
    return "blocked-proof";
  }
  if (isSetupHarnessFailureDetail(detail)) {
    return "setup-harness";
  }
  if (solve.execution.exitCode !== 0) {
    return "setup-harness";
  }
  return "incorrect-patch";
}

function buildResultPayload({
  row,
  arm,
  solve,
  evaluation,
  patch,
  taskWorkspace,
}) {
  const patchPath = path.join(taskWorkspace.artifactsDir, `${arm}.patch.diff`);
  const resultPath = path.join(taskWorkspace.artifactsDir, `${arm}.result.json`);
  ensureDirectory(taskWorkspace.artifactsDir);
  fs.writeFileSync(patchPath, patch, "utf8");
  const payload = {
    generatedAt: toIsoTimestamp(),
    instanceId: row.instance_id,
    repo: row.repo,
    arm,
    success: evaluation.success,
    wallClockMs: solve.execution.wallClockMs,
    totalCostUsd: null,
    tokenUsage: solve.tokenUsage,
    tracePath: solve.tracePath,
    summaryPath: solve.summaryPath,
    artifactPath: evaluation.artifactPath,
    patchPath: path.relative(REPO_ROOT, patchPath).replaceAll(path.sep, "/"),
    verificationStdoutPath: evaluation.verificationStdoutPath,
    verificationStderrPath: evaluation.verificationStderrPath,
    verificationOutputDir: evaluation.verificationOutputDir,
    reviewCategory: classifyReviewCategory({ solve, evaluation }),
    detail: evaluation.detail,
  };
  writeJsonAtomic(resultPath, payload);
  return payload;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== "run") {
    throw new Error(`Unsupported command: ${options.command}`);
  }
  const arm = normalizeArm(options.arm);
  if (!options.instanceId) {
    throw new Error("--instance is required");
  }
  if (!options.modelId) {
    throw new Error("--model is required");
  }
  if (!fs.existsSync(options.pythonBin)) {
    throw new Error(`Python runtime not found: ${options.pythonBin}`);
  }
  if (!fs.existsSync(options.sweBenchRoot)) {
    throw new Error(`SWE-bench Pro repo not found: ${options.sweBenchRoot}`);
  }
  const row = loadDatasetRow(options.instanceId, options.pythonBin);
  const taskWorkspace = prepareTaskWorkspace(row, arm, options.outputRoot);
  cloneRepo(row, taskWorkspace.repoDir);
  const solve =
    arm === "single-agent"
      ? buildSingleAgentSolve(row, taskWorkspace, options)
      : buildFullWaveSolve(row, taskWorkspace, options);
  const patch = buildPatch(taskWorkspace.repoDir, solve.seededFiles || new Set());
  const evaluation = evaluatePatch(row, patch, taskWorkspace, options, arm);
  const payload = buildResultPayload({
    row,
    arm,
    solve,
    evaluation,
    patch,
    taskWorkspace,
  });
  console.log(JSON.stringify(payload));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
