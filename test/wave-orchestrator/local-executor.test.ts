import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveRepoOwnedDeliverablePath,
  runLocalExecutorCli,
} from "../../scripts/wave-orchestrator/local-executor.mjs";
import { REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempPaths = [];

function registerTempPath(targetPath) {
  tempPaths.push(targetPath);
  return targetPath;
}

afterEach(() => {
  for (const targetPath of tempPaths.splice(0)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("resolveRepoOwnedDeliverablePath", () => {
  it("rejects deliverables that escape the repo root", () => {
    expect(() => resolveRepoOwnedDeliverablePath("../outside.md")).toThrow(/escapes repo root/);
    expect(() => resolveRepoOwnedDeliverablePath("/tmp/outside.md")).toThrow(
      /Unsafe deliverable path/,
    );
  });
});

describe("runLocalExecutorCli", () => {
  it("writes cont-qa placeholders with a verdict and emits a wave verdict marker", () => {
    const promptFile = registerTempPath(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-local-")), "prompt.md"),
    );
    const deliverable = `.tmp/wave-local-executor-test-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}/wave-0-cont-qa.md`;
    registerTempPath(path.join(REPO_ROOT, path.dirname(deliverable)));

    fs.writeFileSync(
      promptFile,
      `You are the Wave executor running Wave 0 / Agent A0: cont-QA.

Assigned implementation prompt:
\`\`\`text
You are the LEAP-Claw running cont-qa for the current wave.

Primary goal:
- Keep the wave coherent.

File ownership (only touch these paths):
- ${deliverable}
\`\`\`
`,
      "utf8",
    );

    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    runLocalExecutorCli(["--prompt-file", promptFile]);

    const reportPath = path.join(REPO_ROOT, deliverable);
    expect(fs.readFileSync(reportPath, "utf8")).toContain("Verdict: PASS");
    expect(logs.some((line) => line.includes("[wave-gate] architecture=pass"))).toBe(true);
    expect(logs.some((line) => line.includes("[wave-verdict] pass"))).toBe(true);
  });

  it("emits integration markers for the integration steward", () => {
    const promptFile = registerTempPath(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-local-")), "prompt.md"),
    );
    const deliverable = `.tmp/wave-local-executor-test-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}/integration.md`;
    registerTempPath(path.join(REPO_ROOT, path.dirname(deliverable)));

    fs.writeFileSync(
      promptFile,
      `You are the Wave executor running Wave 0 / Agent A8: Integration Steward.

- cont-QA agent id: A0
- Integration steward agent id: A8
- Documentation steward agent id: A9

Assigned implementation prompt:
\`\`\`text
File ownership (only touch these paths):
- ${deliverable}
\`\`\`
`,
      "utf8",
    );

    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    runLocalExecutorCli(["--prompt-file", promptFile]);

    expect(
      logs.some((line) =>
        line.includes(
          "[wave-integration] state=ready-for-doc-closure claims=0 conflicts=0 blockers=0",
        ),
      ),
    ).toBe(true);
  });

  it("emits strict cont-EVAL markers with target_ids and benchmark_ids", () => {
    const promptFile = registerTempPath(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-local-")), "prompt.md"),
    );
    const deliverable = `.tmp/wave-local-executor-test-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}/wave-0-cont-eval.md`;
    registerTempPath(path.join(REPO_ROOT, path.dirname(deliverable)));

    fs.writeFileSync(
      promptFile,
      `You are the Wave executor running Wave 0 / Agent E0: cont-EVAL.

- cont-QA agent id: A0
- cont-EVAL agent id: E0
- Integration steward agent id: A8
- Documentation steward agent id: A9

Eval targets for this wave:
- response-quality: delegated family=service-output allowed-benchmarks=golden-response-smoke, manual-session-review objective=Tune response quality threshold=Golden response smoke passes

Assigned implementation prompt:
\`\`\`text
File ownership (only touch these paths):
- ${deliverable}
\`\`\`
`,
      "utf8",
    );

    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    runLocalExecutorCli(["--prompt-file", promptFile]);

    expect(
      logs.some((line) =>
        line.includes(
          "[wave-eval] state=satisfied targets=1 benchmarks=2 regressions=0 target_ids=response-quality benchmark_ids=golden-response-smoke,manual-session-review",
        ),
      ),
    ).toBe(true);
    expect(logs.some((line) => line.includes("[wave-proof]"))).toBe(false);
  });

  it("emits component markers for owned components", () => {
    const promptFile = registerTempPath(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-local-")), "prompt.md"),
    );
    const deliverable = `.tmp/wave-local-executor-test-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}/runtime.ts`;
    registerTempPath(path.join(REPO_ROOT, path.dirname(deliverable)));

    fs.writeFileSync(
      promptFile,
      `You are the Wave executor running Wave 0 / Agent A1: Worker.

Components you own in this wave:
- wave-parser-and-launcher: repo-landed

Assigned implementation prompt:
\`\`\`text
File ownership (only touch these paths):
- ${deliverable}
\`\`\`
`,
      "utf8",
    );

    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    runLocalExecutorCli(["--prompt-file", promptFile]);

    expect(
      logs.some((line) =>
        line.includes(
          "[wave-component] component=wave-parser-and-launcher level=repo-landed state=met",
        ),
      ),
    ).toBe(true);
  });

  it("prefers explicit deliverables over inferred file ownership", () => {
    const promptFile = registerTempPath(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-local-")), "prompt.md"),
    );
    const deliverable = `.tmp/wave-local-executor-test-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}/explicit.md`;
    registerTempPath(path.join(REPO_ROOT, path.dirname(deliverable)));

    fs.writeFileSync(
      promptFile,
      `You are the Wave executor running Wave 0 / Agent A1: Worker.

Deliverables required for this agent:
- ${deliverable}

Assigned implementation prompt:
\`\`\`text
Primary goal:
- Keep the prompt simple.
\`\`\`
`,
      "utf8",
    );

    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    runLocalExecutorCli(["--prompt-file", promptFile]);

    expect(fs.existsSync(path.join(REPO_ROOT, deliverable))).toBe(true);
    expect(logs.some((line) => line.includes(deliverable))).toBe(true);
  });
});
