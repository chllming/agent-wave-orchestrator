import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentExecutionSummary,
  readAgentExecutionSummary,
  validateContEvalSummary,
  validateDocumentationClosureSummary,
  validateContQaSummary,
  validateImplementationSummary,
  validateSecuritySummary,
} from "../../scripts/wave-orchestrator/agent-state.mjs";
import { REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-agent-state-"));
  tempDirs.push(dir);
  return dir;
}

function makeRepoTempDir() {
  const dir = path.join(REPO_ROOT, ".tmp", `wave-agent-state-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe("buildAgentExecutionSummary", () => {
  it("parses wrapped structured markers and records deliverable presence", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a8.log");
    fs.writeFileSync(
      logPath,
      [
        "`[wave-proof] completion=integrated durability=durable proof=integration state=met detail=wrapped-proof`",
        "```text",
        "[wave-doc-delta] state=owned paths=docs/example.md detail=fenced-doc-delta",
        "[wave-component] component=wave-parser-and-launcher level=repo-landed state=met detail=fenced-component",
        "[wave-integration] state=needs-more-work claims=1 conflicts=2 blockers=3 detail=fenced-integration",
        "```",
        "`[wave-gate] architecture=pass integration=pass durability=pass live=pass docs=pass detail=wrapped-gate`",
      ].join("\n"),
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: {
        agentId: "A8",
        deliverables: ["README.md"],
      },
      statusRecord: {
        code: 0,
        promptHash: "hash",
      },
      logPath,
    });

    expect(summary.proof).toMatchObject({
      completion: "integrated",
      durability: "durable",
      proof: "integration",
      state: "met",
      detail: "wrapped-proof",
    });
    expect(summary.docDelta).toMatchObject({
      state: "owned",
      paths: ["docs/example.md"],
      detail: "fenced-doc-delta",
    });
    expect(summary.integration).toMatchObject({
      state: "needs-more-work",
      claims: 1,
      conflicts: 2,
      blockers: 3,
      detail: "fenced-integration",
    });
    expect(summary.components).toEqual([
      {
        componentId: "wave-parser-and-launcher",
        level: "repo-landed",
        state: "met",
        detail: "fenced-component",
      },
    ]);
    expect(summary.gate).toMatchObject({
      architecture: "pass",
      integration: "pass",
      durability: "pass",
      live: "pass",
      docs: "pass",
      detail: "wrapped-gate",
    });
    expect(summary.deliverables).toEqual([
      expect.objectContaining({ path: "README.md", exists: true }),
    ]);
  });

  it("ignores fenced example markers that are mixed with prose", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a1.log");
    fs.writeFileSync(
      logPath,
      [
        "I still need to finish this work.",
        "```text",
        "Example output format:",
        "[wave-proof] completion=contract durability=none proof=unit state=met detail=example-only",
        "[wave-doc-delta] state=owned paths=docs/example.md detail=example-only",
        "```",
        "No actual closure markers yet.",
      ].join("\n"),
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: {
        agentId: "A1",
      },
      statusRecord: {
        code: 1,
      },
      logPath,
    });

    expect(summary.proof).toBeNull();
    expect(summary.docDelta).toBeNull();
  });

  it("parses cont-EVAL target_ids and benchmark_ids from the final eval marker", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "e0.log");
    fs.writeFileSync(
      logPath,
      "[wave-eval] state=satisfied targets=2 benchmarks=2 regressions=0 target_ids=response-quality,startup-latency benchmark_ids=golden-response-smoke,http-latency-smoke detail=all-good\n",
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: { agentId: "E0" },
      statusRecord: { code: 0, promptHash: "hash" },
      logPath,
    });

    expect(summary.eval).toMatchObject({
      state: "satisfied",
      targets: 2,
      benchmarks: 2,
      regressions: 0,
      targetIds: ["response-quality", "startup-latency"],
      benchmarkIds: ["golden-response-smoke", "http-latency-smoke"],
      detail: "all-good",
    });
  });

  it("records proof artifact presence for implementation agents", () => {
    const repoDir = makeRepoTempDir();
    const artifactPath = path
      .relative(REPO_ROOT, path.join(repoDir, "live-proof.json"))
      .replaceAll("\\", "/");
    fs.writeFileSync(path.join(REPO_ROOT, artifactPath), "{\"ok\":true}\n", "utf8");
    const logPath = path.join(repoDir, "a6.log");
    fs.writeFileSync(
      logPath,
      "[wave-proof] completion=live durability=durable proof=live state=met detail=live-proof\n[wave-doc-delta] state=none detail=no-docs\n",
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: {
        agentId: "A6",
        proofArtifacts: [
          { path: artifactPath, kind: "live-status", requiredFor: ["pilot-live"] },
        ],
      },
      statusRecord: { code: 0, promptHash: "hash" },
      logPath,
    });

    expect(summary.proofArtifacts).toEqual([
      expect.objectContaining({
        path: artifactPath,
        kind: "live-status",
        requiredFor: ["pilot-live"],
        exists: true,
      }),
    ]);
  });

  it("parses the final wave-security marker", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a7.log");
    fs.writeFileSync(
      logPath,
      "[wave-security] state=concerns findings=2 approvals=1 detail=needs-human-review\n",
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: { agentId: "A7" },
      statusRecord: { code: 0, promptHash: "hash" },
      logPath,
      reportPath: path.join(dir, "wave-0-security-review.md"),
    });

    expect(summary.security).toMatchObject({
      state: "concerns",
      findings: 2,
      approvals: 1,
      detail: "needs-human-review",
    });
  });

  it("parses bullet-prefixed final marker blocks and records diagnostics", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a1.log");
    fs.writeFileSync(
      logPath,
      [
        "Final structured block:",
        "```markdown",
        "- [wave-proof] completion=contract durability=none proof=unit state=met detail=bullet-proof",
        "- [wave-doc-delta] state=owned paths=docs/example.md detail=bullet-doc-delta",
        "- [wave-component] component=wave-parser-and-launcher level=repo-landed state=met detail=bullet-component",
        "```",
      ].join("\n"),
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: { agentId: "A1" },
      statusRecord: { code: 0, promptHash: "hash" },
      logPath,
    });

    expect(summary.proof).toMatchObject({
      completion: "contract",
      durability: "none",
      proof: "unit",
      state: "met",
      detail: "bullet-proof",
    });
    expect(summary.docDelta).toMatchObject({
      state: "owned",
      paths: ["docs/example.md"],
      detail: "bullet-doc-delta",
    });
    expect(summary.components).toEqual([
      {
        componentId: "wave-parser-and-launcher",
        level: "repo-landed",
        state: "met",
        detail: "bullet-component",
      },
    ]);
    expect(summary.structuredSignalDiagnostics).toMatchObject({
      proof: { rawCount: 1, acceptedCount: 1 },
      docDelta: { rawCount: 1, acceptedCount: 1 },
      component: {
        rawCount: 1,
        acceptedCount: 1,
        seenComponentIds: ["wave-parser-and-launcher"],
      },
    });
  });

  it("refreshes stale execution summaries from the source log when diagnostics are missing", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "wave-10-10-a1.status");
    const summaryPath = statusPath.replace(/\.status$/i, ".summary.json");
    const logPath = path.join(dir, "wave-10-10-a1.log");

    fs.writeFileSync(
      logPath,
      [
        "- [wave-proof] completion=contract durability=none proof=unit state=met detail=repo-landed",
        "- [wave-doc-delta] state=owned paths=README.md detail=owned-docs",
        "- [wave-component] component=wave-parser-and-launcher level=repo-landed state=met detail=landed",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          agentId: "A1",
          proof: null,
          docDelta: null,
          components: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const summary = readAgentExecutionSummary(statusPath, {
      agent: {
        agentId: "A1",
        exitContract: {
          completion: "contract",
          durability: "none",
          proof: "unit",
          docImpact: "owned",
        },
        components: ["wave-parser-and-launcher"],
      },
      statusRecord: { code: 0, promptHash: "hash" },
      logPath,
    });

    expect(summary).toMatchObject({
      proof: {
        completion: "contract",
        durability: "none",
        proof: "unit",
        state: "met",
      },
      docDelta: {
        state: "owned",
        paths: ["README.md"],
      },
      components: [
        {
          componentId: "wave-parser-and-launcher",
          level: "repo-landed",
          state: "met",
        },
      ],
      structuredSignalDiagnostics: {
        proof: { rawCount: 1, acceptedCount: 1 },
      },
    });

    const rewritten = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    expect(rewritten.structuredSignalDiagnostics).toBeTruthy();
    expect(rewritten.proof).toMatchObject({ state: "met" });
  });

  it("preserves valid legacy summaries when diagnostics are missing but proof markers already exist", () => {
    const dir = makeTempDir();
    const statusPath = path.join(dir, "wave-10-10-a1.status");
    const summaryPath = statusPath.replace(/\.status$/i, ".summary.json");
    const logPath = path.join(dir, "wave-10-10-a1.log");

    fs.writeFileSync(logPath, "", "utf8");
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["README.md"],
          },
          components: [
            {
              componentId: "wave-parser-and-launcher",
              level: "repo-landed",
              state: "met",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const summary = readAgentExecutionSummary(statusPath, {
      agent: {
        agentId: "A1",
        exitContract: {
          completion: "contract",
          durability: "none",
          proof: "unit",
          docImpact: "owned",
        },
        components: ["wave-parser-and-launcher"],
      },
      statusRecord: { code: 0, promptHash: "hash" },
      logPath,
    });

    expect(summary).toMatchObject({
      proof: {
        completion: "contract",
        durability: "none",
        proof: "unit",
        state: "met",
      },
      docDelta: {
        state: "owned",
        paths: ["README.md"],
      },
      components: [
        {
          componentId: "wave-parser-and-launcher",
          level: "repo-landed",
          state: "met",
        },
      ],
    });
    expect(summary?.structuredSignalDiagnostics).toBeUndefined();

    const persisted = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    expect(persisted.structuredSignalDiagnostics).toBeUndefined();
    expect(persisted.proof).toMatchObject({ state: "met" });
  });
});

describe("validateImplementationSummary", () => {
  it("rejects package-level proof when the exit contract requires integration", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A2",
          exitContract: {
            completion: "integrated",
            durability: "none",
            proof: "integration",
            docImpact: "owned",
          },
        },
        {
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: [],
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "completion-gap",
    });
  });

  it("rejects ephemeral durability when the exit contract requires durable state", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A2",
          exitContract: {
            completion: "authoritative",
            durability: "durable",
            proof: "integration",
            docImpact: "owned",
          },
        },
        {
          proof: {
            completion: "authoritative",
            durability: "ephemeral",
            proof: "integration",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: [],
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "durability-gap",
    });
  });

  it("rejects missing component markers for owned components", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A2",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
          components: ["wave-parser-and-launcher"],
          componentTargets: {
            "wave-parser-and-launcher": "repo-landed",
          },
        },
        {
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: [],
          },
          components: [],
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-wave-component",
    });
  });

  it("rejects missing declared deliverables", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A2",
          exitContract: {
            completion: "integrated",
            durability: "none",
            proof: "integration",
            docImpact: "owned",
          },
          deliverables: ["docs/missing.md"],
        },
        {
          proof: {
            completion: "integrated",
            durability: "none",
            proof: "integration",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: [],
          },
          deliverables: [{ path: "docs/missing.md", exists: false }],
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-deliverable",
    });
  });

  it("rejects missing required proof artifacts for proof-centric owners", () => {
    expect(
      validateImplementationSummary(
        {
          agentId: "A6",
          exitContract: {
            completion: "live",
            durability: "durable",
            proof: "live",
            docImpact: "none",
          },
          components: ["learning-memory-action-plane"],
          componentTargets: {
            "learning-memory-action-plane": "pilot-live",
          },
          proofArtifacts: [
            {
              path: ".tmp/wave-8-learning-proof/learning-plane-after-restart.json",
              kind: "restart-check",
              requiredFor: ["pilot-live"],
            },
          ],
        },
        {
          proof: {
            completion: "live",
            durability: "durable",
            proof: "live",
            state: "met",
          },
          docDelta: {
            state: "none",
            paths: [],
          },
          components: [
            {
              componentId: "learning-memory-action-plane",
              level: "pilot-live",
              state: "met",
            },
          ],
          proofArtifacts: [
            {
              path: ".tmp/wave-8-learning-proof/learning-plane-after-restart.json",
              kind: "restart-check",
              requiredFor: ["pilot-live"],
              exists: false,
            },
          ],
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-proof-artifact",
    });
  });

  it("rejects example markers that only appear inside a prose fence", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a1.log");
    fs.writeFileSync(
      logPath,
      [
        "The work is not complete yet.",
        "```text",
        "Example marker format:",
        "[wave-proof] completion=contract durability=none proof=unit state=met detail=example-only",
        "[wave-doc-delta] state=owned paths=docs/example.md detail=example-only",
        "```",
      ].join("\n"),
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: {
        agentId: "A1",
      },
      statusRecord: {
        code: 1,
      },
      logPath,
    });

    expect(
      validateImplementationSummary(
        {
          agentId: "A1",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
        summary,
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-wave-proof",
    });
  });

  it("adds Codex launch-preview guidance to max-turn termination hints", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a1.log");
    fs.writeFileSync(logPath, "Reached max turns (12)\n", "utf8");

    const summary = buildAgentExecutionSummary({
      agent: {
        agentId: "A1",
        executorResolved: {
          id: "codex",
          codex: {
            profileName: "review",
          },
        },
      },
      statusRecord: {
        code: 1,
      },
      logPath,
    });

    expect(summary).toMatchObject({
      terminationReason: "max-turns",
      terminationObservedTurnLimit: 12,
    });

    expect(
      validateImplementationSummary(
        {
          agentId: "A1",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
        summary,
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-wave-proof",
      detail: expect.stringContaining("Wave does not set a Codex turn-limit flag"),
    });
  });

  it("returns a parse-specific proof error when raw proof markers were seen but rejected", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a1-invalid-proof.log");
    fs.writeFileSync(
      logPath,
      [
        "- [wave-proof] completion=contract detail=missing-required-fields",
        "- [wave-doc-delta] state=owned paths=docs/example.md detail=owned-docs",
      ].join("\n"),
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: { agentId: "A1" },
      statusRecord: { code: 1 },
      logPath,
    });

    expect(summary.structuredSignalDiagnostics.proof).toMatchObject({
      rawCount: 1,
      acceptedCount: 0,
    });

    expect(
      validateImplementationSummary(
        {
          agentId: "A1",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
        summary,
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "invalid-wave-proof-format",
      detail: expect.stringContaining("Rejected sample: - [wave-proof] completion=contract detail=missing-required-fields"),
    });
  });

  it("returns a parse-specific doc-delta error when raw doc markers were seen but rejected", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a1-invalid-doc.log");
    fs.writeFileSync(
      logPath,
      [
        "- [wave-proof] completion=contract durability=none proof=unit state=met detail=proof-met",
        "- [wave-doc-delta] detail=missing-state",
      ].join("\n"),
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: { agentId: "A1" },
      statusRecord: { code: 1 },
      logPath,
    });

    expect(
      validateImplementationSummary(
        {
          agentId: "A1",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
        summary,
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "invalid-doc-delta-format",
      detail: expect.stringContaining("Rejected sample: - [wave-doc-delta] detail=missing-state"),
    });
  });

  it("returns a parse-specific component error when a raw component marker was seen but rejected", () => {
    const dir = makeTempDir();
    const logPath = path.join(dir, "a1-invalid-component.log");
    fs.writeFileSync(
      logPath,
      [
        "- [wave-proof] completion=contract durability=none proof=unit state=met detail=proof-met",
        "- [wave-doc-delta] state=owned paths=docs/example.md detail=owned-docs",
        "- [wave-component] component=wave-parser-and-launcher level=repo-landed detail=missing-state",
      ].join("\n"),
      "utf8",
    );

    const summary = buildAgentExecutionSummary({
      agent: { agentId: "A1" },
      statusRecord: { code: 1 },
      logPath,
    });

    expect(
      validateImplementationSummary(
        {
          agentId: "A1",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
          components: ["wave-parser-and-launcher"],
          componentTargets: {
            "wave-parser-and-launcher": "repo-landed",
          },
        },
        summary,
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "invalid-wave-component-format",
      detail: expect.stringContaining("Expected a valid component marker for wave-parser-and-launcher."),
    });
  });
});

describe("validateSecuritySummary", () => {
  it("accepts clear security output when the report exists", () => {
    const reportDir = makeRepoTempDir();
    const reportPath = path.join(reportDir, "wave-0-security-review.md");
    fs.writeFileSync(reportPath, "# Security Review\n", "utf8");

    expect(
      validateSecuritySummary(
        {
          agentId: "A7",
        },
        {
          reportPath: path.relative(REPO_ROOT, reportPath),
          security: {
            state: "clear",
            findings: 0,
            approvals: 0,
            detail: "clear",
          },
        },
      ),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
    });
  });

  it("treats blocked security output as a hard failure", () => {
    const reportDir = makeRepoTempDir();
    const reportPath = path.join(reportDir, "wave-0-security-review.md");
    fs.writeFileSync(reportPath, "# Security Review\n", "utf8");

    expect(
      validateSecuritySummary(
        {
          agentId: "A7",
        },
        {
          reportPath: path.relative(REPO_ROOT, reportPath),
          security: {
            state: "blocked",
            findings: 1,
            approvals: 0,
            detail: "untrusted-shell-execution",
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "security-blocked",
    });
  });

  it("rejects clear security output when findings remain open", () => {
    const reportDir = makeRepoTempDir();
    const reportPath = path.join(reportDir, "wave-0-security-review.md");
    fs.writeFileSync(reportPath, "# Security Review\n", "utf8");

    expect(
      validateSecuritySummary(
        {
          agentId: "A7",
        },
        {
          reportPath: path.relative(REPO_ROOT, reportPath),
          security: {
            state: "clear",
            findings: 1,
            approvals: 0,
            detail: "incorrectly-cleared",
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "invalid-security-clear-state",
    });
  });
});

describe("validateDocumentationClosureSummary", () => {
  it("rejects open shared-plan deltas", () => {
    expect(
      validateDocumentationClosureSummary(
        { agentId: "A9" },
        {
          docClosure: {
            state: "delta",
            paths: ["docs/plans/current-state.md"],
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "doc-closure-open",
    });
  });

  it("includes termination hints when a closure marker is missing", () => {
    expect(
      validateDocumentationClosureSummary(
        { agentId: "A9" },
        {
          terminationHint: "Reached max turns (10)",
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-doc-closure",
      detail: expect.stringContaining("Reached max turns (10)"),
    });
  });
});

describe("validateContEvalSummary", () => {
  it("rejects cont-EVAL summaries that still need more work", () => {
    expect(
      validateContEvalSummary(
        { agentId: "E0" },
        {
          eval: {
            state: "needs-more-work",
            detail: "Golden response smoke still drifts from target output.",
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "cont-eval-needs-more-work",
    });
  });

  it("requires the owned cont-EVAL report when the summary references one", () => {
    expect(
      validateContEvalSummary(
        { agentId: "E0" },
        {
          eval: {
            state: "satisfied",
            detail: "Targets satisfied.",
          },
          reportPath: "docs/plans/waves/reviews/missing-cont-eval.md",
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-cont-eval-report",
    });
  });

  it("rejects live cont-EVAL summaries that do not enumerate the declared target ids", () => {
    const repoDir = makeRepoTempDir();
    const reportRelPath = path.relative(REPO_ROOT, path.join(repoDir, "wave-4-cont-eval.md")).replaceAll(path.sep, "/");
    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# cont-EVAL\n", "utf8");

    expect(
      validateContEvalSummary(
        { agentId: "E0" },
        {
          eval: {
            state: "satisfied",
            targets: 1,
            benchmarks: 1,
            regressions: 0,
            targetIds: [],
            benchmarkIds: ["golden-response-smoke"],
          },
          reportPath: reportRelPath,
        },
        {
          mode: "live",
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
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-cont-eval-target-ids",
    });
  });

  it("rejects live cont-EVAL summaries that still report regressions", () => {
    const repoDir = makeRepoTempDir();
    const reportRelPath = path.relative(REPO_ROOT, path.join(repoDir, "wave-4-cont-eval.md")).replaceAll(path.sep, "/");
    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# cont-EVAL\n", "utf8");

    expect(
      validateContEvalSummary(
        { agentId: "E0" },
        {
          eval: {
            state: "satisfied",
            targets: 1,
            benchmarks: 1,
            regressions: 1,
            targetIds: ["response-quality"],
            benchmarkIds: ["golden-response-smoke"],
          },
          reportPath: reportRelPath,
        },
        {
          mode: "live",
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
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "cont-eval-regressions",
    });
  });

  it("accepts live cont-EVAL summaries only when target and benchmark ids match the contract", () => {
    const repoDir = makeRepoTempDir();
    const reportRelPath = path.relative(REPO_ROOT, path.join(repoDir, "wave-4-cont-eval.md")).replaceAll(path.sep, "/");
    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# cont-EVAL\n", "utf8");

    expect(
      validateContEvalSummary(
        { agentId: "E0" },
        {
          eval: {
            state: "satisfied",
            targets: 2,
            benchmarks: 2,
            regressions: 0,
            targetIds: ["response-quality", "startup-latency"],
            benchmarkIds: ["golden-response-smoke", "http-latency-smoke"],
            detail: "Targets satisfied.",
          },
          reportPath: reportRelPath,
        },
        {
          mode: "live",
          evalTargets: [
            {
              id: "response-quality",
              selection: "delegated",
              benchmarkFamily: "service-output",
              benchmarks: [],
              objective: "Tune response quality",
              threshold: "Golden response smoke passes",
            },
            {
              id: "startup-latency",
              selection: "pinned",
              benchmarkFamily: "latency",
              benchmarks: ["http-latency-smoke"],
              objective: "Hold request latency",
              threshold: "Latency remains acceptable",
            },
          ],
          benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
        },
      ),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
    });
  });
});

describe("validateContQaSummary", () => {
  it("rejects final gates that still report concerns", () => {
    expect(
      validateContQaSummary(
        { agentId: "A0" },
        {
          verdict: { verdict: "pass", detail: "stale report text" },
          gate: {
            architecture: "pass",
            integration: "concerns",
            durability: "pass",
            live: "pass",
            docs: "pass",
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "gate-integration-concerns",
    });
  });

  it("requires the owned cont-QA report for live validation", () => {
    expect(
      validateContQaSummary(
        { agentId: "A0" },
        {
          verdict: { verdict: "pass", detail: "ready" },
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
          },
        },
        { mode: "live" },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "missing-cont-qa-report",
    });
  });
});
