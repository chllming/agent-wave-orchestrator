import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadBenchmarkCatalog,
  validateEvalTargets,
} from "../../scripts/wave-orchestrator/evals.mjs";
import { REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const parentDir = path.join(REPO_ROOT, ".tmp");
  fs.mkdirSync(parentDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parentDir, "wave-evals-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeCatalog(dir, payload) {
  const filePath = path.join(dir, "benchmark-catalog.json");
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path.relative(REPO_ROOT, filePath).replaceAll("\\", "/");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadBenchmarkCatalog", () => {
  it("preserves richer coordination benchmark metadata", () => {
    const dir = makeTempDir();
    const benchmarkCatalogPath = writeCatalog(dir, {
      version: 2,
      families: {
        "hidden-profile-pooling": {
          title: "Hidden Profile Pooling",
          summary: "Distributed-information coordination benchmarks.",
          category: "coordination",
          coordinationModel: "blackboard-distributed-information",
          primaryMetric: {
            id: "distributed-info-accuracy",
            title: "Distributed Information Accuracy",
            unit: "percent",
            direction: "higher-is-better",
          },
          secondaryMetrics: [
            {
              id: "premature-convergence-rate",
              title: "Premature Convergence Rate",
              unit: "percent",
              direction: "lower-is-better",
            },
          ],
          paperReferences: [
            {
              title: "Systematic Failures in Collective Reasoning under Distributed Information in Multi-Agent LLMs",
              year: 2025,
              url: "https://arxiv.org/abs/2505.11556",
            },
          ],
          sotaBaseline: {
            source: "paper-static",
            paper: "HiddenBench",
            year: 2025,
            metric: "distributed-info-accuracy",
            value: 30.1,
            notes: "Abstract baseline.",
          },
          benchmarks: {
            "private-evidence-integration": {
              title: "Private Evidence Integration",
              summary: "Use distributed facts in the final answer.",
              goal: "Pool private evidence into the final recommendation.",
              failureModes: ["communication-without-integration", "incorrect-global-reconstruction"],
              signals: ["final-answer-uses-private-facts", "correct-global-state-reconstruction"],
              scoring: {
                primaryMetric: "distributed-info-accuracy",
                successCriterion: "The final answer requires the pooled facts.",
              },
              tuningNotes: "Adjust summary and inbox compression.",
              paperReferences: [
                {
                  id: "hiddenbench-2025",
                  title: "Systematic Failures in Collective Reasoning under Distributed Information in Multi-Agent LLMs",
                  year: 2025,
                },
              ],
              sotaBaseline: {
                source: "paper-static",
                paper: "HiddenBench",
                year: 2025,
                metric: "distributed-info-accuracy",
                value: 30.1,
              },
            },
          },
        },
      },
    });

    const catalog = loadBenchmarkCatalog({ benchmarkCatalogPath });
    const family = catalog.families["hidden-profile-pooling"];
    const benchmark = family.benchmarks["private-evidence-integration"];

    expect(catalog.version).toBe(2);
    expect(family).toMatchObject({
      category: "coordination",
      coordinationModel: "blackboard-distributed-information",
      primaryMetric: {
        id: "distributed-info-accuracy",
        direction: "higher-is-better",
      },
      secondaryMetrics: [
        {
          id: "premature-convergence-rate",
        },
      ],
      paperReferences: [
        {
          id: "systematic-failures-in-collective-reasoning-under-distributed-information-in-multi-agent-llms",
          year: 2025,
        },
      ],
      sotaBaseline: {
        source: "paper-static",
        paper: "HiddenBench",
        metric: "distributed-info-accuracy",
        value: 30.1,
      },
    });
    expect(benchmark).toMatchObject({
      goal: "Pool private evidence into the final recommendation.",
      failureModes: ["communication-without-integration", "incorrect-global-reconstruction"],
      signals: ["final-answer-uses-private-facts", "correct-global-state-reconstruction"],
      scoring: {
        primaryMetric: "distributed-info-accuracy",
        successCriterion: "The final answer requires the pooled facts.",
      },
      tuningNotes: "Adjust summary and inbox compression.",
      sotaBaseline: {
        source: "paper-static",
        paper: "HiddenBench",
        value: 30.1,
      },
    });
  });

  it("keeps the original simple catalog shape valid", () => {
    const dir = makeTempDir();
    const benchmarkCatalogPath = writeCatalog(dir, {
      version: 1,
      families: {
        "service-output": {
          title: "Service Output Quality",
          summary: "Existing minimal family shape.",
          benchmarks: {
            "manual-session-review": {
              title: "Manual Session Review",
              summary: "Minimal entry remains valid.",
            },
          },
        },
      },
    });

    expect(() => loadBenchmarkCatalog({ benchmarkCatalogPath })).not.toThrow();
  });

  it("rejects malformed static paper baselines", () => {
    const dir = makeTempDir();
    const benchmarkCatalogPath = writeCatalog(dir, {
      version: 2,
      families: {
        "hidden-profile-pooling": {
          title: "Hidden Profile Pooling",
          summary: "Distributed-information coordination benchmarks.",
          sotaBaseline: {
            source: "paper-static",
            paper: "HiddenBench",
            year: 2025,
            value: 30.1,
          },
          benchmarks: {
            "private-evidence-integration": {
              title: "Private Evidence Integration",
              summary: "Use distributed facts in the final answer.",
            },
          },
        },
      },
    });

    expect(() => loadBenchmarkCatalog({ benchmarkCatalogPath })).toThrow(
      /sotaBaseline\.metric is required/,
    );
  });

  it("indexes repo-local benchmark cases declared in the catalog", () => {
    const dir = makeTempDir();
    const benchmarkCatalogPath = writeCatalog(dir, {
      version: 2,
      families: {
        "hidden-profile-pooling": {
          title: "Hidden Profile Pooling",
          summary: "Distributed-information coordination benchmarks.",
          localCases: ["wave-family-level-case"],
          benchmarks: {
            "private-evidence-integration": {
              title: "Private Evidence Integration",
              summary: "Use distributed facts in the final answer.",
              localCases: ["wave-hidden-profile-private-evidence"],
            },
          },
        },
      },
    });

    const catalog = loadBenchmarkCatalog({ benchmarkCatalogPath });
    expect(catalog.families["hidden-profile-pooling"].localCases).toEqual(["wave-family-level-case"]);
    expect(
      catalog.families["hidden-profile-pooling"].benchmarks["private-evidence-integration"].localCases,
    ).toEqual(["wave-hidden-profile-private-evidence"]);
    expect(catalog.localCaseIndex["wave-family-level-case"]).toMatchObject({
      familyId: "hidden-profile-pooling",
      benchmarkId: null,
    });
    expect(catalog.localCaseIndex["wave-hidden-profile-private-evidence"]).toMatchObject({
      familyId: "hidden-profile-pooling",
      benchmarkId: "private-evidence-integration",
    });
  });
});

describe("validateEvalTargets", () => {
  it("accepts delegated eval targets that point at coordination benchmark families", () => {
    const dir = makeTempDir();
    const benchmarkCatalogPath = writeCatalog(dir, {
      version: 2,
      families: {
        "hidden-profile-pooling": {
          title: "Hidden Profile Pooling",
          summary: "Distributed-information coordination benchmarks.",
          benchmarks: {
            "private-evidence-integration": {
              title: "Private Evidence Integration",
              summary: "Use distributed facts in the final answer.",
            },
          },
        },
      },
    });

    expect(() =>
      validateEvalTargets(
        [
          {
            id: "coordination-pooling",
            selection: "delegated",
            benchmarkFamily: "hidden-profile-pooling",
            benchmarks: [],
            objective: "Pool distributed evidence before closure.",
            threshold: "Critical private facts appear in the final integrated answer.",
          },
        ],
        { benchmarkCatalogPath },
      ),
    ).not.toThrow();
  });
});
