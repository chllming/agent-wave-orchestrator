import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runBenchmarkCli,
  runBenchmarkSuite,
} from "../../scripts/wave-orchestrator/benchmark.mjs";
import {
  loadBenchmarkCases,
  loadExternalBenchmarkAdapters,
} from "../../scripts/wave-orchestrator/benchmark-cases.mjs";
import { REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempPaths = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-benchmark-test-"));
  tempPaths.push(dir);
  return dir;
}

afterEach(() => {
  for (const targetPath of tempPaths.splice(0)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("loadBenchmarkCases", () => {
  it("loads the shipped deterministic Wave benchmark corpus", () => {
    const suite = loadBenchmarkCases();
    expect(suite.cases.length).toBeGreaterThanOrEqual(7);
    expect(suite.byId.has("wave-hidden-profile-private-evidence")).toBe(true);
    expect(suite.byId.has("wave-premature-closure-guard")).toBe(true);
    expect(suite.byId.has("wave-simultaneous-lockstep")).toBe(true);
  });
});

describe("loadExternalBenchmarkAdapters", () => {
  it("loads direct and adapted external benchmark adapters", () => {
    const registry = loadExternalBenchmarkAdapters();
    expect(registry.adapters.some((adapter) => adapter.id === "swe-bench-pro")).toBe(true);
    expect(registry.adapters.some((adapter) => adapter.id === "dpbench-style-contention")).toBe(
      true,
    );
  });
});

describe("runBenchmarkSuite", () => {
  it("writes benchmark outputs and shows full-wave outperforming the single-agent baseline", () => {
    const outputDir = makeTempDir();
    const result = runBenchmarkSuite({ outputDir });

    expect(fs.existsSync(path.join(outputDir, "results.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "results.md"))).toBe(true);
    expect(result.cases.length).toBeGreaterThanOrEqual(7);

    const hiddenProfile = result.cases.find((entry) => entry.id === "wave-hidden-profile-private-evidence");
    expect(hiddenProfile?.arms["full-wave"].score).toBeGreaterThan(
      hiddenProfile?.arms["single-agent"].score || 0,
    );

    const expertise = result.cases.find((entry) => entry.id === "wave-expert-routing-preservation");
    expect(expertise?.arms["full-wave"].score).toBe(100);
    expect(expertise?.arms["single-agent"].score).toBeLessThan(100);

    expect(
      result.comparisons.some(
        (comparison) =>
          comparison.scope === "overall" &&
          comparison.challengerArm === "full-wave" &&
          comparison.meanDelta > 0,
      ),
    ).toBe(true);
  });
});

describe("runBenchmarkCli", () => {
  it("prints JSON benchmark output for a selected case", async () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });

    await runBenchmarkCli(["run", "--case", "wave-hidden-profile-private-evidence", "--json"]);

    const payload = JSON.parse(logs.join("\n"));
    expect(payload.cases).toHaveLength(1);
    expect(payload.cases[0].id).toBe("wave-hidden-profile-private-evidence");
  });

  it("lists shipped benchmark cases", async () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });

    await runBenchmarkCli(["list"]);

    expect(logs.some((line) => line.includes("wave-hidden-profile-private-evidence"))).toBe(true);
  });

  it("supports a full-wave-only external review run through the CLI", async () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((value) => {
      logs.push(String(value));
    });

    await runBenchmarkCli([
      "external-run",
      "--adapter",
      "swe-bench-pro",
      "--manifest",
      "docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json",
      "--arm",
      "full-wave",
      "--command-config",
      "docs/evals/external-command-config.swe-bench-pro.json",
      "--dry-run",
      "--model-id",
      "gpt-5-codex",
      "--executor-id",
      "codex",
      "--executor-command",
      "codex exec",
      "--tool-permissions",
      "Read,Write,Edit,Bash",
      "--temperature",
      "0",
      "--reasoning-effort",
      "high",
      "--max-wall-clock-minutes",
      "45",
      "--max-turns",
      "250",
      "--retry-limit",
      "0",
      "--verification-harness",
      "official-swe-bench-pro",
      "--dataset-version",
      "public-v1",
      "--json",
    ]);

    const payload = JSON.parse(logs.join("\n"));
    expect(payload.selectedArms).toEqual(["full-wave"]);
    expect(payload.comparisonReady).toBe(false);
    expect(payload.tasks).toHaveLength(10);
    expect(payload.tasks[0].command).toContain("swe-bench-pro-task.mjs");
  });
});
