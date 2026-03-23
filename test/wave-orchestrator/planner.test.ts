import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-planner-test-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "planner-fixture", private: true }, null, 2),
    "utf8",
  );
  return dir;
}

function runWaveCli(args, options = {}) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd: options.cwd,
    input: options.input || "",
    encoding: "utf8",
    timeout: options.timeout || 60000,
    env: {
      ...process.env,
      WAVE_SKIP_UPDATE_CHECK: "1",
      ...(options.env || {}),
    },
  });
}

function buildImplementationDraftInput(options = {}) {
  const waveContext7Bundle = options.waveContext7Bundle || "none";
  const waveContext7Query = options.waveContext7Query || "";
  const workerContext7Bundle = options.workerContext7Bundle || "none";
  const workerContext7Query = options.workerContext7Query || "";
  return [
    "Planner Foundation Slice",
    "Feat: land planner foundation slice",
    "Wave 1 builds on the starter scaffold and should stay repo-local.",
    "",
    "oversight",
    waveContext7Bundle,
    waveContext7Query,
    "y",
    "n",
    "y",
    "y",
    "1",
    "executor-abstraction-and-prompt-transport",
    "",
    "repo-landed",
    "",
    "",
    "1",
    "A1",
    "Implementation Track 1",
    "implementation",
    "implement-fast",
    "README.md,scripts/",
    "executor-abstraction-and-prompt-transport",
    "",
    "docs/plans/current-state.md",
    "",
    "Keep the executor transport coherent | Leave exact proof and doc deltas in the final output",
    "pnpm test -- test/wave-orchestrator/runtime-dry-run.test.ts",
    "",
    "",
    workerContext7Bundle,
    workerContext7Query,
    "contract",
    "none",
    "unit",
    "owned",
  ].join("\n");
}

function buildQaDraftInput() {
  return [
    "Wave 6 QA Closure",
    "Test: validate planner wave fidelity",
    "Wave 6 should act as a closure gate before broader rollout work.",
    "",
    "oversight",
    "none",
    "",
    "y",
    "n",
    "y",
    "y",
    "1",
    "state-artifacts-and-feedback",
    "",
    "repo-landed",
    "",
    "",
    "1",
    "A1",
    "QA Track 1",
    "qa",
    "implement-fast",
    "README.md,scripts/",
    "state-artifacts-and-feedback",
    "qa",
    "docs/plans/current-state.md,docs/plans/master-plan.md",
    "",
    "Check the QA evidence against the shared docs | Record any blocker that later waves must not assume away",
    "pnpm test -- test/wave-orchestrator/install.test.ts",
    "",
    "",
    "none",
    "",
    "integrated",
    "none",
    "integration",
    "owned",
  ].join("\n");
}

function buildSecurityDraftInput() {
  return [
    "Wave 6 Security Review",
    "Test: scaffold security reviewer",
    "Wave 6 adds an explicit security review pass before integration closure.",
    "",
    "oversight",
    "none",
    "",
    "y",
    "n",
    "y",
    "y",
    "0",
    "1",
    "A1",
    "Security Engineer",
    "security",
    "security-review",
    "",
    "",
    "",
    "docs/plans/current-state.md",
    "",
    "Review trust boundaries | Route exact fixes and approvals before integration",
    "",
    "",
    "",
    "none",
    "",
  ].join("\n");
}

function buildAgenticPlannerFixture() {
  return {
    summary: "Plan the planner-agent rollout in two narrow waves.",
    openQuestions: [],
    waves: [
      {
        wave: 3,
        title: "Agentic Planner Foundation",
        commitMessage: "Feat: add agentic planner draft flow",
        template: "implementation",
        sequencingNote: "Keep the first wave repo-landed and transient.",
        referenceRule: "Read roadmap, planning lessons, and prior waves before drafting.",
        oversightMode: "oversight",
        context7Defaults: {
          bundle: "node-typescript",
          query: "Planner drafting, JSON validation, and CLI flow",
        },
        standardRoles: {
          contQa: true,
          contEval: false,
          integration: true,
          documentation: true,
        },
        componentCatalog: [
          {
            componentId: "agentic-planner-turn",
            title: "Agentic Planner Turn",
            currentLevel: "inventoried",
            targetLevel: "repo-landed",
            canonicalDocs: [
              "docs/guides/planner.md",
              "docs/reference/wave-planning-lessons.md",
            ],
            proofSurfaces: ["tests", "docs"],
          },
        ],
        workerAgents: [
          {
            agentId: "A1",
            title: "Planner Runtime Slice",
            roleKind: "implementation",
            executor: {
              profile: "implement-fast",
              budget: { minutes: 20 },
              codex: {
                sandbox: "workspace-write",
                search: true,
              },
            },
            ownedPaths: [
              "scripts/wave-orchestrator/planner.mjs",
              "test/wave-orchestrator/planner.test.ts",
              "docs/guides/planner.md",
            ],
            deliverables: [
              "scripts/wave-orchestrator/planner.mjs",
              "test/wave-orchestrator/planner.test.ts",
              "docs/guides/planner.md",
            ],
            proofArtifacts: [],
            components: ["agentic-planner-turn"],
            capabilities: ["implementation"],
            additionalContext: [
              "docs/roadmap.md",
              "docs/plans/current-state.md",
              "docs/reference/wave-planning-lessons.md",
            ],
            earlierWaveOutputs: ["docs/plans/waves/wave-0.md"],
            requirements: [
              "Keep planning output transient until apply-run materializes it.",
              "Emit exact candidate artifacts and verifier output for every run.",
            ],
            validationCommand: "pnpm exec vitest run --config vitest.config.ts test/wave-orchestrator/planner.test.ts",
            outputSummary: "Summarize the transient planner artifacts and remaining gaps.",
            primaryGoal: "Implement the agentic planner draft flow and keep the result reviewable before apply.",
            context7Bundle: "node-typescript",
            context7Query: "Planner CLI implementation and JSON artifact handling",
            exitContract: {
              completion: "contract",
              durability: "none",
              proof: "unit",
              docImpact: "owned",
            },
          },
        ],
      },
      {
        wave: 4,
        title: "Agentic Planner Live-Proof Shape",
        commitMessage: "Docs: add planner live-proof closure shape",
        template: "implementation",
        sequencingNote: "Only promote after the repo-landed substrate exists.",
        referenceRule: "Proof-centric waves need an explicit live-proof owner and rollback evidence.",
        oversightMode: "oversight",
        context7Defaults: {
          bundle: "node-typescript",
          query: "Planner proof bundles, closure gates, and rollout evidence",
        },
        standardRoles: {
          contQa: true,
          contEval: false,
          integration: true,
          documentation: true,
        },
        componentCatalog: [
          {
            componentId: "agentic-planner-turn",
            title: "Agentic Planner Turn",
            currentLevel: "repo-landed",
            targetLevel: "pilot-live",
            canonicalDocs: [
              "docs/guides/planner.md",
              "docs/reference/live-proof-waves.md",
            ],
            proofSurfaces: ["runbook", "rollback-evidence", "tests"],
          },
        ],
        workerAgents: [
          {
            agentId: "A2",
            title: "Planner Live Proof Owner",
            roleKind: "deploy",
            executor: {
              profile: "ops-triage",
              retryPolicy: "sticky",
              budget: { minutes: 30 },
              codex: {
                sandbox: "read-only",
                search: true,
              },
            },
            ownedPaths: [
              "docs/plans/operations/agentic-planner-turn-wave-4.md",
              "docs/plans/waves/reviews/wave-4-agentic-planner-turn-live-proof.md",
              ".tmp/wave-4-agentic-planner-turn-proof/summary.md",
              ".tmp/wave-4-agentic-planner-turn-proof/rollback.md",
            ],
            deliverables: [
              "docs/plans/operations/agentic-planner-turn-wave-4.md",
              "docs/plans/waves/reviews/wave-4-agentic-planner-turn-live-proof.md",
            ],
            proofArtifacts: [
              {
                path: ".tmp/wave-4-agentic-planner-turn-proof/summary.md",
                kind: "proof-bundle",
                requiredFor: ["pilot-live"],
              },
              {
                path: ".tmp/wave-4-agentic-planner-turn-proof/rollback.md",
                kind: "rollback-evidence",
                requiredFor: ["pilot-live"],
              },
            ],
            components: ["agentic-planner-turn"],
            capabilities: ["deploy", "live-proof"],
            additionalContext: [
              "docs/reference/live-proof-waves.md",
              "docs/plans/current-state.md",
            ],
            requirements: [
              "Capture rollback evidence and the canonical runbook inside the wave.",
            ],
            validationCommand: "Manual review of the proof bundle and operator runbook.",
            outputSummary: "Summarize the proof bundle, rollback posture, and operator steps.",
            primaryGoal: "Own the explicit live-proof bundle for the planner pilot-live claim.",
            context7Bundle: "none",
            context7Query: "",
            exitContract: {
              completion: "live",
              durability: "durable",
              proof: "live",
              docImpact: "owned",
            },
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("wave project setup", () => {
  it("persists a saved project profile and reports it through project show", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);

    const setupResult = runWaveCli(["project", "setup", "--json"], {
      cwd: repoDir,
      input: [
        "y",
        "dark-factory",
        "tmux",
        "qa",
        "main",
        "1",
        "prod",
        "Production",
        "railway-mcp",
        "y",
        "Managed Railway deployment",
      ].join("\n"),
    });

    expect(setupResult.status).toBe(0);
    const setupPayload = JSON.parse(setupResult.stdout);
    expect(setupPayload.profile).toMatchObject({
      newProject: true,
      defaultOversightMode: "dark-factory",
      defaultTerminalSurface: "tmux",
      plannerDefaults: {
        template: "qa",
        lane: "main",
      },
      deployEnvironments: [
        {
          id: "prod",
          kind: "railway-mcp",
          isDefault: true,
        },
      ],
    });

    const showResult = runWaveCli(["project", "show", "--json"], { cwd: repoDir });
    expect(showResult.status).toBe(0);
    const showPayload = JSON.parse(showResult.stdout);
    expect(showPayload.profile).toMatchObject({
      defaultTerminalSurface: "tmux",
      defaultOversightMode: "dark-factory",
    });
    expect(fs.existsSync(path.join(repoDir, ".wave", "project-profile.json"))).toBe(true);
  });
});

describe("wave draft", () => {
  it("generates an implementation wave plus spec and passes launcher dry-run validation", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);
    expect(
      runWaveCli(["project", "setup"], {
        cwd: repoDir,
        input: ["n", "", "", "", "main", "0"].join("\n"),
      }).status,
    ).toBe(0);

    const draftResult = runWaveCli(["draft", "--wave", "1", "--template", "implementation", "--json"], {
      cwd: repoDir,
      input: buildImplementationDraftInput(),
    });

    expect(draftResult.status).toBe(0);
    const payload = JSON.parse(draftResult.stdout);
    expect(fs.existsSync(path.join(repoDir, payload.wavePath))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, payload.specPath))).toBe(true);

    const waveMarkdown = fs.readFileSync(path.join(repoDir, payload.wavePath), "utf8");
    expect(waveMarkdown).toContain("# Wave 1 - Planner Foundation Slice");
    expect(waveMarkdown).toContain("## Sequencing note");
    expect(waveMarkdown).toContain("### Exit contract");

    const matrixJson = JSON.parse(
      fs.readFileSync(path.join(repoDir, "docs", "plans", "component-cutover-matrix.json"), "utf8"),
    );
    expect(
      matrixJson.components["executor-abstraction-and-prompt-transport"].promotions.some(
        (entry) => entry.wave === 1 && entry.target === "repo-landed",
      ),
    ).toBe(true);

    const dryRunResult = runWaveCli(
      ["launch", "--lane", "main", "--start-wave", "1", "--end-wave", "1", "--dry-run", "--no-dashboard"],
      { cwd: repoDir },
    );
    expect(dryRunResult.status).toBe(0);
  });

  it("accepts configured Context7 bundle ids in interactive draft mode", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);
    expect(
      runWaveCli(["project", "setup"], {
        cwd: repoDir,
        input: ["n", "", "", "", "main", "0"].join("\n"),
      }).status,
    ).toBe(0);

    const draftResult = runWaveCli(["draft", "--wave", "2", "--template", "implementation", "--json"], {
      cwd: repoDir,
      input: buildImplementationDraftInput({
        waveContext7Bundle: "planner-agentic",
        waveContext7Query: "Planner bundle for interactive authoring",
        workerContext7Bundle: "planner-agentic",
        workerContext7Query: "Planner bundle for worker context selection",
      }),
    });

    expect(draftResult.status).toBe(0);
    const payload = JSON.parse(draftResult.stdout);
    const waveMarkdown = fs.readFileSync(path.join(repoDir, payload.wavePath), "utf8");
    expect(waveMarkdown).toContain("## Context7 defaults");
    expect(waveMarkdown).toContain("- bundle: planner-agentic");
    expect(waveMarkdown).toContain("Planner bundle for interactive authoring");
    expect(waveMarkdown).toContain("### Context7");
    expect(waveMarkdown).toContain("Planner bundle for worker context selection");
  });

  it("generates a qa wave with required Context7 and exit-contract sections for wave 6", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);
    expect(
      runWaveCli(["project", "setup"], {
        cwd: repoDir,
        input: ["n", "", "", "", "main", "0"].join("\n"),
      }).status,
    ).toBe(0);

    const draftResult = runWaveCli(["draft", "--wave", "6", "--template", "qa", "--json"], {
      cwd: repoDir,
      input: buildQaDraftInput(),
    });

    expect(draftResult.status).toBe(0);
    const payload = JSON.parse(draftResult.stdout);
    const waveMarkdown = fs.readFileSync(path.join(repoDir, payload.wavePath), "utf8");
    expect(waveMarkdown).toContain("# Wave 6 - Wave 6 QA Closure");
    expect(waveMarkdown).toContain("### Context7");
    expect(waveMarkdown).toContain("### Exit contract");
    expect(waveMarkdown).toContain("Validation:");

    const dryRunResult = runWaveCli(
      ["launch", "--lane", "main", "--start-wave", "6", "--end-wave", "6", "--dry-run", "--no-dashboard"],
      { cwd: repoDir },
    );
    expect(dryRunResult.status).toBe(0);
  });

  it("generates a security-review wave without an exit-contract section", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);
    expect(
      runWaveCli(["project", "setup"], {
        cwd: repoDir,
        input: ["n", "", "", "", "main", "0"].join("\n"),
      }).status,
    ).toBe(0);

    const draftResult = runWaveCli(["draft", "--wave", "6", "--template", "implementation", "--json"], {
      cwd: repoDir,
      input: buildSecurityDraftInput(),
    });

    expect(draftResult.status).toBe(0);
    const payload = JSON.parse(draftResult.stdout);
    const waveMarkdown = fs.readFileSync(path.join(repoDir, payload.wavePath), "utf8");
    expect(waveMarkdown).toContain("# Wave 6 - Wave 6 Security Review");
    expect(waveMarkdown).toContain("docs/agents/wave-security-role.md");
    expect(waveMarkdown).toContain("- profile: security-review");
    expect(waveMarkdown).not.toContain("### Exit contract");

    const dryRunResult = runWaveCli(
      ["launch", "--lane", "main", "--start-wave", "6", "--end-wave", "6", "--dry-run", "--no-dashboard"],
      { cwd: repoDir },
    );
    expect(dryRunResult.status).toBe(0);
  });

  it("generates, shows, and applies an agentic planner run without touching canonical waves until apply", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], { cwd: repoDir }).status).toBe(0);
    expect(
      runWaveCli(["project", "setup"], {
        cwd: repoDir,
        input: ["n", "", "", "", "main", "0"].join("\n"),
      }).status,
    ).toBe(0);

    const fixturePath = path.join(repoDir, "planner-response.json");
    fs.writeFileSync(fixturePath, `${JSON.stringify(buildAgenticPlannerFixture(), null, 2)}\n`, "utf8");

    const draftResult = runWaveCli(
      [
        "draft",
        "--agentic",
        "--task",
        "Add an architecture-aware planner agent that drafts best-practice wave plans",
        "--from-wave",
        "3",
        "--max-waves",
        "2",
        "--json",
      ],
      {
        cwd: repoDir,
        env: {
          WAVE_PLANNER_AGENTIC_RESPONSE_FILE: fixturePath,
        },
      },
    );

    expect(draftResult.status).toBe(0);
    const draftPayload = JSON.parse(draftResult.stdout);
    expect(draftPayload).toMatchObject({
      state: "planned",
      lane: "main",
      waveOrder: [3, 4],
    });
    expect(fs.existsSync(path.join(repoDir, draftPayload.paths.candidateDir))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "waves", "wave-3.md"))).toBe(false);
    expect(fs.existsSync(path.join(repoDir, "docs", "agents", "wave-planner-role.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "reference", "wave-planning-lessons.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "context7", "planner-agent", "manifest.json"))).toBe(true);

    const candidateWave = fs.readFileSync(
      path.join(repoDir, ".wave", "planner", "runs", draftPayload.runId, "candidate", "waves", "wave-4.md"),
      "utf8",
    );
    expect(candidateWave).toContain("### Deliverables");
    expect(candidateWave).toContain("### Proof artifacts");
    expect(candidateWave).toContain("- retry-policy: sticky");
    expect(candidateWave).toContain("- budget.minutes: 30");

    const plannerPrompt = fs.readFileSync(
      path.join(repoDir, ".wave", "planner", "runs", draftPayload.runId, "planner-prompt.md"),
      "utf8",
    );
    expect(plannerPrompt).toContain("## Planner Context7");
    expect(plannerPrompt).toContain("- bundle: planner-agentic");
    expect(plannerPrompt).toContain("docs/context7/planner-agent");

    const sourcesPayload = JSON.parse(
      fs.readFileSync(path.join(repoDir, ".wave", "planner", "runs", draftPayload.runId, "sources.json"), "utf8"),
    );
    expect(sourcesPayload.plannerContext7).toMatchObject({
      selection: expect.objectContaining({
        bundleId: "planner-agentic",
      }),
      prefetch: expect.objectContaining({
        mode: expect.any(String),
      }),
    });

    const showResult = runWaveCli(["draft", "--show-run", draftPayload.runId, "--json"], {
      cwd: repoDir,
    });
    expect(showResult.status).toBe(0);
    const showPayload = JSON.parse(showResult.stdout);
    expect(showPayload.request.task).toContain("planner agent");
    expect(showPayload.result.state).toBe("planned");

    const applyWaveThreeResult = runWaveCli(
      ["draft", "--apply-run", draftPayload.runId, "--waves", "3", "--json"],
      { cwd: repoDir },
    );
    expect(applyWaveThreeResult.status).toBe(0);
    const applyWaveThreePayload = JSON.parse(applyWaveThreeResult.stdout);
    expect(applyWaveThreePayload.state).toBe("applied");
    expect(applyWaveThreePayload.appliedWaves).toEqual([3]);
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "waves", "wave-3.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "waves", "wave-4.md"))).toBe(false);

    const applyWaveFourResult = runWaveCli(
      ["draft", "--apply-run", draftPayload.runId, "--waves", "4", "--json"],
      { cwd: repoDir },
    );
    expect(applyWaveFourResult.status).toBe(0);
    const applyWaveFourPayload = JSON.parse(applyWaveFourResult.stdout);
    expect(applyWaveFourPayload.appliedWaves).toEqual([3, 4]);
    expect(fs.existsSync(path.join(repoDir, "docs", "plans", "waves", "wave-4.md"))).toBe(true);

    const matrixJson = JSON.parse(
      fs.readFileSync(path.join(repoDir, "docs", "plans", "component-cutover-matrix.json"), "utf8"),
    );
    expect(matrixJson.components["agentic-planner-turn"].promotions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ wave: 3, target: "repo-landed" }),
        expect.objectContaining({ wave: 4, target: "pilot-live" }),
      ]),
    );
  });
});
