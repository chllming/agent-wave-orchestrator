import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertComparableExternalRunConfig,
  loadExternalArmTemplates,
  loadExternalPilotManifest,
  runExternalBenchmarkPilot,
} from "../../scripts/wave-orchestrator/benchmark-external.mjs";
import { REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";
import { runBenchmarkCli } from "../../scripts/wave-orchestrator/benchmark.mjs";
import * as waveControlClient from "../../scripts/wave-orchestrator/wave-control-client.mjs";

const tempDirs = [];

function makeRepoTempDir() {
  const parent = path.join(REPO_ROOT, ".tmp");
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, "wave-external-benchmark-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("external benchmark manifests", () => {
  it("loads the shipped pilot manifests and arm templates", () => {
    const sweManifest = loadExternalPilotManifest("docs/evals/pilots/swe-bench-pro-public-pilot.json");
    const sweReviewManifest = loadExternalPilotManifest(
      "docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json",
    );
    const templates = loadExternalArmTemplates();

    expect(sweManifest.tasks.length).toBe(20);
    expect(sweReviewManifest.tasks.length).toBe(10);
    expect(sweReviewManifest.reviewOnly).toBe(true);
    expect(sweReviewManifest.reviewScope).toBe("multi-agent-only-diagnostic");
    expect(sweReviewManifest.tasks[0].taskId).toBe(
      "instance_NodeBB__NodeBB-04998908ba6721d64eba79ae3b65a351dcfbc5b5-vnan",
    );
    expect(templates.templates.has("single-agent")).toBe(true);
    expect(templates.templates.has("full-wave")).toBe(true);
  });
});

describe("external benchmark fairness guardrails", () => {
  it("requires comparable shared run config fields", () => {
    expect(() =>
      assertComparableExternalRunConfig({
        benchmarkId: "swe-bench-pro",
        modelId: "gpt-5-codex",
        executorId: "codex",
        executorCommand: "codex",
        toolPermissions: "",
        temperature: "0",
        reasoningEffort: "high",
        maxWallClockMinutes: "45",
        maxTurns: "250",
        retryLimit: "0",
        verificationHarness: "official",
        datasetVersion: "public-v1",
      }),
    ).toThrow(/toolPermissions/);
  });
});

describe("runExternalBenchmarkPilot", () => {
  it("supports dry-run planning for the shipped direct adapter", () => {
    const result = runExternalBenchmarkPilot({
      adapterId: "swe-bench-pro",
      dryRun: true,
      taskIds: ["instance_NodeBB__NodeBB-04998908ba6721d64eba79ae3b65a351dcfbc5b5-vnan"],
      modelId: "gpt-5-codex",
      executorId: "codex",
      executorCommand: "codex",
      toolPermissions: "Read,Write,Edit,Bash",
      temperature: "0",
      reasoningEffort: "high",
      maxWallClockMinutes: "45",
      maxTurns: "250",
      retryLimit: "0",
      verificationHarness: "official-swe-bench-pro",
      datasetVersion: "public-v1",
      commandConfigPath: "docs/evals/external-command-config.swe-bench-pro.json",
      outputDir: ".tmp/wave-benchmarks/external-test-dry-run",
    });

    expect(result.selectedArms).toEqual(["single-agent", "full-wave"]);
    expect(result.comparisonReady).toBe(true);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.every((task) => task.reviewCategory === "dry-run-plan")).toBe(true);
    expect(result.summary.overall["single-agent"]).toBeDefined();
    expect(result.summary.overall["full-wave"]).toBeDefined();
    expect(result.summary.overall["single-agent"].reviewBuckets["dry-run-plan"]).toBe(1);
    expect(result.summary.overall["full-wave"].reviewBuckets["dry-run-plan"]).toBe(1);
    const failureReview = readJson(path.join(REPO_ROOT, result.outputDir, "failure-review.json"));
    expect(failureReview.byArm["single-agent"].verdict).toBe("planning-only");
    expect(failureReview.byArm["single-agent"].reviewBuckets["dry-run-plan"]).toBe(1);
    expect(failureReview.byArm["full-wave"].reviewBuckets["dry-run-plan"]).toBe(1);
  });

  it("supports a full-wave-only review batch with the shipped SWE-bench Pro config", () => {
    const result = runExternalBenchmarkPilot({
      adapterId: "swe-bench-pro",
      manifestPath: "docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json",
      arms: ["full-wave"],
      dryRun: true,
      modelId: "gpt-5-codex",
      executorId: "codex",
      executorCommand: "codex exec",
      toolPermissions: "Read,Write,Edit,Bash",
      temperature: "0",
      reasoningEffort: "high",
      maxWallClockMinutes: "45",
      maxTurns: "250",
      retryLimit: "0",
      verificationHarness: "official-swe-bench-pro",
      datasetVersion: "public-v1",
      commandConfigPath: "docs/evals/external-command-config.swe-bench-pro.json",
      outputDir: ".tmp/wave-benchmarks/external-test-full-wave-review",
    });

    expect(result.selectedArms).toEqual(["full-wave"]);
    expect(result.manifest.reviewOnly).toBe(true);
    expect(result.comparisonReady).toBe(false);
    expect(result.comparisonMode).toBe("review-only");
    expect(result.tasks).toHaveLength(10);
    expect(Object.keys(result.summary.overall)).toEqual(["full-wave"]);
    expect(result.tasks[0]?.command).toContain("swe-bench-pro-task.mjs");
  });

  it("uses smoke fixtures for runnable adapter validation", () => {
    const dir = makeRepoTempDir();
    const registryPath = path.join(dir, "external-benchmarks.json");
    const manifestPath = path.join(dir, "pilot.json");
    const armTemplatesDir = path.join(dir, "arm-templates");
    writeJson(registryPath, {
      version: 1,
      adapters: [
        {
          id: "swe-bench-pro",
          title: "SWE-bench Pro",
          mode: "direct",
          sourceBenchmark: "SWE-bench Pro",
          pilotManifestPath: path.relative(REPO_ROOT, manifestPath).replaceAll(path.sep, "/"),
          metrics: ["task-success-rate"],
        },
      ],
    });
    writeJson(manifestPath, {
      version: 1,
      id: "pilot",
      benchmarkId: "swe-bench-pro",
      title: "Pilot",
      split: "public",
      tasks: [
        {
          taskId: "task-1",
          repo: "repo/a",
          repoLanguage: "python",
          smoke: {
            "single-agent": {
              success: false,
              wallClockMs: 1200,
              totalCostUsd: 0.21,
              detail: "baseline failed",
            },
            "full-wave": {
              success: true,
              wallClockMs: 1500,
              totalCostUsd: 0.33,
              detail: "wave solved",
            },
          },
        },
      ],
    });
    writeJson(path.join(armTemplatesDir, "single-agent.json"), {
      armId: "single-agent",
      title: "Single Agent",
      roles: ["implementation"],
      includeContEval: false,
      includeIntegrationSteward: false,
      includeDocumentationSteward: false,
      tracesRequired: false,
      notes: [],
    });
    writeJson(path.join(armTemplatesDir, "full-wave.json"), {
      armId: "full-wave",
      title: "Full Wave",
      roles: ["implementation", "cont-eval", "integration", "documentation", "cont-qa"],
      includeContEval: true,
      includeIntegrationSteward: true,
      includeDocumentationSteward: true,
      tracesRequired: true,
      notes: [],
    });

    const result = runExternalBenchmarkPilot({
      adapterId: "swe-bench-pro",
      dryRun: false,
      externalBenchmarksPath: path.relative(REPO_ROOT, registryPath).replaceAll(path.sep, "/"),
      armTemplatesDir: path.relative(REPO_ROOT, armTemplatesDir).replaceAll(path.sep, "/"),
      modelId: "gpt-5-codex",
      executorId: "codex",
      executorCommand: "codex",
      toolPermissions: "Read,Write,Edit,Bash",
      temperature: "0",
      reasoningEffort: "high",
      maxWallClockMinutes: "45",
      maxTurns: "250",
      retryLimit: "0",
      verificationHarness: "official-swe-bench-pro",
      datasetVersion: "public-v1",
      outputDir: path.relative(REPO_ROOT, path.join(dir, "output")).replaceAll(path.sep, "/"),
    });

    expect(result.summary.overall["single-agent"].successRate).toBe(0);
    expect(result.summary.overall["full-wave"].successRate).toBe(100);
    expect(fs.existsSync(path.join(REPO_ROOT, result.outputDir, "results.json"))).toBe(true);
  });

  it("downgrades external benchmark telemetry flush failures to warnings", async () => {
    const warnings = [];
    vi.spyOn(console, "warn").mockImplementation((value) => {
      warnings.push(String(value));
    });
    vi.spyOn(waveControlClient, "flushWaveControlQueue").mockRejectedValue(
      new Error("telemetry unavailable"),
    );

    const result = runExternalBenchmarkPilot({
      adapterId: "swe-bench-pro",
      dryRun: true,
      taskIds: ["instance_NodeBB__NodeBB-04998908ba6721d64eba79ae3b65a351dcfbc5b5-vnan"],
      modelId: "gpt-5-codex",
      executorId: "codex",
      executorCommand: "codex",
      toolPermissions: "Read,Write,Edit,Bash",
      temperature: "0",
      reasoningEffort: "high",
      maxWallClockMinutes: "45",
      maxTurns: "250",
      retryLimit: "0",
      verificationHarness: "official-swe-bench-pro",
      datasetVersion: "public-v1",
      commandConfigPath: "docs/evals/external-command-config.swe-bench-pro.json",
      outputDir: ".tmp/wave-benchmarks/external-test-telemetry-warning",
    });
    await Promise.resolve();

    expect(result.selectedArms).toEqual(["single-agent", "full-wave"]);
    expect(warnings).toContain(
      "[wave:benchmark] telemetry flush skipped: telemetry unavailable",
    );
  });

  it("writes failure review artifacts and separates verifier-image from setup-harness failures", () => {
    const dir = makeRepoTempDir();
    const outputDir = path.join(dir, "output");
    const jsonCommand = (payload) => {
      const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
      return `${process.execPath} -e "console.log(Buffer.from('${encoded}','base64').toString())"`;
    };

    const result = runExternalBenchmarkPilot({
      adapterId: "swe-bench-pro",
      manifestPath: "docs/evals/pilots/swe-bench-pro-public-pilot.json",
      dryRun: false,
      taskIds: ["instance_NodeBB__NodeBB-04998908ba6721d64eba79ae3b65a351dcfbc5b5-vnan"],
      modelId: "gpt-5-codex",
      executorId: "codex",
      executorCommand: "codex exec",
      toolPermissions: "Read,Write,Edit,Bash",
      temperature: "0",
      reasoningEffort: "high",
      maxWallClockMinutes: "45",
      maxTurns: "250",
      retryLimit: "0",
      verificationHarness: "official-swe-bench-pro",
      datasetVersion: "public-v1",
      outputDir: path.relative(REPO_ROOT, outputDir).replaceAll(path.sep, "/"),
      commandTemplates: {
        "swe-bench-pro": {
          "single-agent": jsonCommand({
            success: false,
            detail:
              "official SWE-bench Pro evaluation failed (1): failed to pull jefzda/sweap-images:nodebb manifest unknown",
            reviewCategory: "harness-env",
          }),
          "full-wave": jsonCommand({
            success: false,
            detail: "wave init failed (1): repo already contains Wave bootstrap files",
            reviewCategory: "harness-env",
          }),
        },
      },
    });

    const baselineTask = result.tasks.find((task) => task.arm === "single-agent");
    const waveTask = result.tasks.find((task) => task.arm === "full-wave");
    expect(baselineTask?.reviewCategory).toBe("verifier-image");
    expect(baselineTask?.reviewDisposition).toBe("invalidated");
    expect(waveTask?.reviewCategory).toBe("setup-harness");
    expect(waveTask?.reviewDisposition).toBe("setup-failure");
    expect(result.summary.overall["single-agent"].reviewDispositions.invalidated).toBe(1);
    expect(result.summary.overall["full-wave"].reviewDispositions["setup-failure"]).toBe(1);

    const failureReviewJsonPath = path.join(REPO_ROOT, result.outputDir, "failure-review.json");
    const failureReviewMarkdownPath = path.join(REPO_ROOT, result.outputDir, "failure-review.md");
    expect(fs.existsSync(failureReviewJsonPath)).toBe(true);
    expect(fs.existsSync(failureReviewMarkdownPath)).toBe(true);
    const failureReview = readJson(failureReviewJsonPath);
    expect(failureReview.byArm["single-agent"].reviewBuckets["verifier-image"]).toBe(1);
    expect(failureReview.byArm["full-wave"].reviewBuckets["setup-harness"]).toBe(1);
    const markdown = fs.readFileSync(failureReviewMarkdownPath, "utf8");
    expect(markdown).toContain("verifier-image=1");
    expect(markdown).toContain("setup-harness=1");
  });

  it("ingests structured command output from live command templates", () => {
    const dir = makeRepoTempDir();
    const outputDir = path.join(dir, "output");
    const jsonCommand = (payload) => {
      const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
      return `${process.execPath} -e "console.log(Buffer.from('${encoded}','base64').toString())"`;
    };

    const result = runExternalBenchmarkPilot({
      adapterId: "swe-bench-pro",
      manifestPath: "docs/evals/pilots/swe-bench-pro-public-pilot.json",
      dryRun: false,
      taskIds: ["instance_NodeBB__NodeBB-04998908ba6721d64eba79ae3b65a351dcfbc5b5-vnan"],
      modelId: "gpt-5-codex",
      executorId: "codex",
      executorCommand: "codex exec",
      toolPermissions: "Read,Write,Edit,Bash",
      temperature: "0",
      reasoningEffort: "high",
      maxWallClockMinutes: "45",
      maxTurns: "250",
      retryLimit: "0",
      verificationHarness: "official-swe-bench-pro",
      datasetVersion: "public-v1",
      outputDir: path.relative(REPO_ROOT, outputDir).replaceAll(path.sep, "/"),
      commandTemplates: {
        "swe-bench-pro": {
          "single-agent": jsonCommand({
            success: false,
            wallClockMs: 111,
            totalCostUsd: 0.42,
            tokenUsage: { input_tokens: 10, output_tokens: 5 },
            detail: "baseline failed",
          }),
          "full-wave": jsonCommand({
            success: true,
            wallClockMs: 222,
            totalCostUsd: 0.84,
            tokenUsage: { input_tokens: 20, output_tokens: 9 },
            tracePath: "traces/example/full-wave",
            summaryPath: "summaries/example/full-wave.json",
            patchPath: "artifacts/example/full-wave.patch.diff",
            verificationStdoutPath: "eval/example/stdout.log",
            verificationStderrPath: "eval/example/stderr.log",
            verificationOutputDir: "eval/example/output",
            reviewCategory: "solved",
            detail: "wave solved",
          }),
        },
      },
    });

    const baselineTask = result.tasks.find((task) => task.arm === "single-agent");
    const waveTask = result.tasks.find((task) => task.arm === "full-wave");
    expect(baselineTask?.success).toBe(false);
    expect(baselineTask?.totalCostUsd).toBe(0.42);
    expect(baselineTask?.tokenUsage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(baselineTask?.reviewCategory).toBe("incorrect-patch");
    expect(baselineTask?.reviewDisposition).toBe("scored-failure");
    expect(waveTask?.success).toBe(true);
    expect(waveTask?.tracePath).toBe("traces/example/full-wave");
    expect(waveTask?.summaryPath).toBe("summaries/example/full-wave.json");
    expect(waveTask?.patchPath).toBe("artifacts/example/full-wave.patch.diff");
    expect(waveTask?.verificationStdoutPath).toBe("eval/example/stdout.log");
    expect(waveTask?.verificationStderrPath).toBe("eval/example/stderr.log");
    expect(waveTask?.verificationOutputDir).toBe("eval/example/output");
    expect(waveTask?.reviewCategory).toBe("solved");
    expect(result.summary.overall["full-wave"].costPerSolvedTask).toBe(0.84);
    expect(result.summary.overall["full-wave"].tokenUsageTotals).toEqual({
      input_tokens: 20,
      output_tokens: 9,
    });
  });
});

describe("benchmark CLI external subcommands", () => {
  it("lists direct external benchmarks", async () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((value) => logs.push(String(value)));

    await runBenchmarkCli(["external-list"]);

    expect(logs.some((line) => line.includes("swe-bench-pro"))).toBe(true);
    expect(logs.some((line) => line.includes("silo-bench"))).toBe(false);
  });
});
