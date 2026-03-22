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
      ...(options.env || {}),
    },
  });
}

function buildImplementationDraftInput() {
  return [
    "Planner Foundation Slice",
    "Feat: land planner foundation slice",
    "Wave 1 builds on the starter scaffold and should stay repo-local.",
    "",
    "oversight",
    "none",
    "",
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
    "none",
    "",
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
});
