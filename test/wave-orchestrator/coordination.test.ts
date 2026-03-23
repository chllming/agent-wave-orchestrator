import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeMessageBoardCommunication,
  buildExecutionPrompt,
  buildResidentOrchestratorPrompt,
  parseMessageBoardEntries,
  withFileLock,
} from "../../scripts/wave-orchestrator/coordination.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-coordination-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildExecutionPrompt", () => {
  it("includes the lane, board path, feedback command, and resolved assigned prompt", () => {
    const resolvedPrompt = [
      "You are the standing implementation role for this wave.",
      "",
      "Implement the provider runtime contract.",
    ].join("\n");
    const prompt = buildExecutionPrompt({
      lane: "main",
      wave: 2,
      agent: {
        agentId: "A3",
        title: "Provider Contracts",
        slug: "2-a3",
        prompt: resolvedPrompt,
        exitContract: {
          completion: "integrated",
          durability: "none",
          proof: "integration",
          docImpact: "owned",
        },
        components: ["wave-parser-and-launcher"],
        componentTargets: {
          "wave-parser-and-launcher": "repo-landed",
        },
      },
      orchestratorId: "main-orch",
      messageBoardPath: "/repo/.tmp/main-wave-launcher/messageboards/wave-2.md",
      messageBoardSnapshot: "# Wave 2 Message Board",
      componentPromotions: [
        {
          componentId: "wave-parser-and-launcher",
          targetLevel: "repo-landed",
        },
      ],
    });

    expect(prompt).toContain("You are the Wave executor running Wave 2 / Agent A3: Provider Contracts.");
    expect(prompt).toContain("pnpm exec wave-feedback ask");
    expect(prompt).toContain("--lane main");
    expect(prompt).toContain("/repo/.tmp/main-wave-launcher/messageboards/wave-2.md");
    expect(prompt).toContain("You are the standing implementation role for this wave.");
    expect(prompt).toContain("Implement the provider runtime contract.");
    expect(prompt).toContain("docs/plans/master-plan.md");
    expect(prompt).toContain("docs/plans/current-state.md");
    expect(prompt).toContain("docs/plans/migration.md");
    expect(prompt).toContain("deliver the assigned outcome end-to-end");
    expect(prompt).toContain("your first durable action is to acknowledge it");
    expect(prompt).toContain("post the exact doc paths and exact delta");
    expect(prompt).toContain("stay engaged until they confirm `closed` or `no-change`");
    expect(prompt).toContain("[wave-proof]");
    expect(prompt).toContain("[wave-component]");
    expect(prompt).toContain("Exit contract for this run:");
    expect(prompt).toContain("completion: integrated");
    expect(prompt).toContain("Component promotions for this wave:");
    expect(prompt).toContain("Components you own in this wave:");
    expect(prompt).not.toContain("# Wave 2 Message Board");
    expect(prompt).not.toContain("docs/leap-claw/plans");
  });

  it("adds cont-qa verdict requirements for agent A0", () => {
    const prompt = buildExecutionPrompt({
      lane: "main",
      wave: 0,
      agent: {
        agentId: "A0",
        title: "cont-QA",
        slug: "0-a0",
        prompt: "Review the wave.",
      },
      orchestratorId: "main-orch",
      messageBoardPath: "/repo/.tmp/main-wave-launcher/messageboards/wave-0.md",
      messageBoardSnapshot: "# Wave 0 Message Board",
    });

    expect(prompt).toContain("Verdict: PASS");
    expect(prompt).toContain("[wave-verdict] pass");
    expect(prompt).toContain("[wave-gate]");
    expect(prompt).toContain("documentation gate is closed");
    expect(prompt).toContain("exact remaining doc delta");
    expect(prompt).toContain("explicit `closed` or `no-change` note");
  });

  it("renders strict eval target instructions for report-only cont-EVAL agents", () => {
    const prompt = buildExecutionPrompt({
      lane: "main",
      wave: 4,
      agent: {
        agentId: "E0",
        title: "cont-EVAL",
        slug: "4-e0",
        prompt: "Tune the output surface.",
        ownedPaths: ["docs/plans/waves/reviews/wave-4-cont-eval.md"],
      },
      orchestratorId: "main-orch",
      messageBoardPath: "/repo/.tmp/main-wave-launcher/messageboards/wave-4.md",
      messageBoardSnapshot: "# Wave 4 Message Board",
      evalTargets: [
        {
          id: "response-quality",
          selection: "delegated",
          benchmarkFamily: "service-output",
          benchmarks: [],
          objective: "Tune response quality",
          threshold: "Golden response smoke passes",
        },
      ],
      benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
    });

    expect(prompt).toContain("You are report-only in this wave unless the prompt explicitly assigns additional non-report files.");
    expect(prompt).toContain("Benchmark catalog: docs/evals/benchmark-catalog.json");
    expect(prompt).toContain("allowed-benchmarks=golden-response-smoke, manual-session-review");
    expect(prompt).toContain("target_ids=<csv> benchmark_ids=<csv>");
    expect(prompt).not.toContain("[wave-proof]");
  });

  it("treats implementation-owning cont-EVAL agents like proof-owning workers", () => {
    const prompt = buildExecutionPrompt({
      lane: "main",
      wave: 4,
      agent: {
        agentId: "E0",
        title: "cont-EVAL",
        slug: "4-e0",
        prompt: "Tune the output surface.",
        ownedPaths: [
          "docs/plans/waves/reviews/wave-4-cont-eval.md",
          "src/runtime.ts",
        ],
      },
      orchestratorId: "main-orch",
      messageBoardPath: "/repo/.tmp/main-wave-launcher/messageboards/wave-4.md",
      messageBoardSnapshot: "# Wave 4 Message Board",
    });

    expect(prompt).toContain("You also own explicit non-report files in this wave.");
    expect(prompt).toContain("[wave-proof]");
    expect(prompt).toContain("[wave-doc-delta]");
  });

  it("uses lane-scoped shared plan doc paths for non-default lanes", () => {
    const prompt = buildExecutionPrompt({
      lane: "compat-lane",
      wave: 2,
      agent: {
        agentId: "A3",
        title: "Provider Contracts",
        slug: "2-a3",
        prompt: "Implement the provider runtime contract.",
      },
      orchestratorId: "compat-lane-orch",
      messageBoardPath: "/repo/.tmp/compat-lane-wave-launcher/messageboards/wave-2.md",
      messageBoardSnapshot: "# Wave 2 Message Board",
    });

    expect(prompt).toContain("docs/compat-lane/plans/master-plan.md");
    expect(prompt).toContain("docs/compat-lane/plans/current-state.md");
    expect(prompt).toContain("docs/compat-lane/plans/migration.md");
  });

  it("describes scoped Context7 access and injected external docs when present", () => {
    const prompt = buildExecutionPrompt({
      lane: "main",
      wave: 4,
      agent: {
        agentId: "A1",
        title: "Temporal Bootstrap",
        slug: "4-a1",
        prompt: "Implement Temporal bootstrap.",
        context7Resolved: {
          bundleId: "core-go",
          query: "Temporal schedules and worker bootstrap",
          libraries: [{ libraryName: "temporal", libraryId: "/temporalio/temporal" }],
        },
      },
      orchestratorId: "main-orch",
      messageBoardPath: "/repo/.tmp/main-wave-launcher/messageboards/wave-4.md",
      messageBoardSnapshot: "# Wave 4 Message Board",
      context7: {
        selection: {
          bundleId: "core-go",
          query: "Temporal schedules and worker bootstrap",
          libraries: [{ libraryName: "temporal", libraryId: "/temporalio/temporal" }],
        },
        promptText: "Temporal docs snippet",
      },
    });

    expect(prompt).toContain("Context7 scope for this run:");
    expect(prompt).toContain("Bundle: core-go");
    expect(prompt).toContain("Allowed external libraries: temporal");
    expect(prompt).toContain("External reference only (Context7, non-canonical)");
    expect(prompt).toContain("Temporal docs snippet");
  });

  it("builds a long-running resident orchestrator prompt with explicit non-owning limits", () => {
    const prompt = buildResidentOrchestratorPrompt({
      lane: "main",
      wave: 5,
      waveFile: "docs/plans/waves/wave-5.md",
      orchestratorId: "main-orch",
      coordinationLogPath: "/repo/.tmp/main-wave-launcher/coordination/wave-5.jsonl",
      messageBoardPath: "/repo/.tmp/main-wave-launcher/messageboards/wave-5.md",
      sharedSummaryPath: "/repo/.tmp/main-wave-launcher/inboxes/wave-5/shared-summary.md",
      dashboardPath: "/repo/.tmp/main-wave-launcher/dashboards/wave-5.json",
      triagePath: "/repo/.tmp/main-wave-launcher/feedback/triage/wave-5.jsonl",
      rolePrompt: "Watch coordination timing and reroute stale clarification chains.",
    });

    expect(prompt).toContain("stay alive for the duration of the wave");
    expect(prompt).toContain("Do not edit product code");
    expect(prompt).toContain("Coordination log:");
    expect(prompt).toContain("Human feedback command:");
    expect(prompt).toContain("keep monitoring instead of exiting early");
    expect(prompt).toContain("Watch coordination timing and reroute stale clarification chains.");
  });
});

describe("message board parsing", () => {
  it("recognizes A-style agent ids in action requests", () => {
    const board = `# Wave 0 Message Board

## Entries

## 2026-03-19T00:00:00.000Z | Agent A0
- Change: Reviewed the plan.
- Reason: Keep scope aligned.
- Impact on other agents: A1 owns the next fix.
- Action requested (if any): A1 should update the provider contract notes.

## 2026-03-19T00:01:00.000Z | Agent A1
- Change: Acknowledged and resolved the request.
- Reason: Address the request.
- Impact on other agents: None.
- Action requested (if any): None.
`;

    const entries = parseMessageBoardEntries(board);
    expect(entries[0]?.targetOwners).toEqual(["A1"]);

    const dir = makeTempDir();
    const boardPath = path.join(dir, "wave-0.md");
    fs.writeFileSync(boardPath, board, "utf8");

    expect(analyzeMessageBoardCommunication(boardPath)).toMatchObject({
      actionableRequests: 1,
      unresolvedRequests: 0,
      unacknowledgedRequests: 0,
    });
  });
});

describe("withFileLock", () => {
  it("recovers stale lock files", () => {
    const dir = makeTempDir();
    const lockPath = path.join(dir, "requests.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: 999999,
          createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = withFileLock(lockPath, () => "ok", 250);

    expect(result).toBe("ok");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("releases the lock after async work completes", async () => {
    const dir = makeTempDir();
    const lockPath = path.join(dir, "requests.lock");

    await withFileLock(lockPath, async () => {
      expect(fs.existsSync(lockPath)).toBe(true);
    });

    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
