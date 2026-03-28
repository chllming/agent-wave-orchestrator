import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWaveConfig } from "../../scripts/wave-orchestrator/config.mjs";
import {
  REPO_ROOT,
  buildLanePaths,
  buildWorkspaceTmuxToken,
} from "../../scripts/wave-orchestrator/shared.mjs";

describe("buildLanePaths", () => {
  it("isolates dry-run artifacts under a dry-run state root", () => {
    const production = buildLanePaths("main");
    const dryRun = buildLanePaths("main", { runVariant: "dry-run" });

    expect(dryRun.runVariant).toBe("dry-run");
    expect(dryRun.stateDir).toBe(path.join(production.stateDir, "dry-run"));
    expect(dryRun.defaultManifestPath).toBe(path.join(dryRun.stateDir, "waves.manifest.json"));
    expect(dryRun.defaultRunStatePath).toBe(path.join(dryRun.stateDir, "run-state.json"));
    expect(dryRun.logsDir).toBe(path.join(dryRun.stateDir, "logs"));
    expect(dryRun.statusDir).toBe(path.join(dryRun.stateDir, "status"));
    expect(dryRun.messageboardsDir).toBe(path.join(dryRun.stateDir, "messageboards"));
    expect(dryRun.dashboardsDir).toBe(path.join(dryRun.stateDir, "dashboards"));
    expect(dryRun.signalsDir).toBe(path.join(dryRun.stateDir, "signals"));
    expect(dryRun.launcherLockPath).toBe(path.join(dryRun.stateDir, "launcher.lock"));
    expect(dryRun.defaultOrchestratorBoardPath).toBe(
      path.join(dryRun.stateDir, "orchestrator", "messageboards", "orchestrator.md"),
    );
    expect(dryRun.feedbackRequestsDir).toBe(
      path.join(dryRun.stateDir, "orchestrator", "feedback", "requests"),
    );
    expect(dryRun.docsDir).toBe(path.join(REPO_ROOT, "docs"));
  });

  it("names tmux resources uniquely per workspace root", () => {
    const tokenA = buildWorkspaceTmuxToken("/tmp/wave-test-a");
    const tokenB = buildWorkspaceTmuxToken("/tmp/wave-test-b");

    expect(tokenA).not.toBe(tokenB);
    expect(tokenA).toMatch(/^[a-z0-9_]+$/);
    expect(tokenB).toMatch(/^[a-z0-9_]+$/);
  });

  it("isolates explicit project state under a project-scoped launcher root", () => {
    const configPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "wave-shared-project-")),
      "wave.config.json",
    );
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultProject: "app",
          projects: {
            app: {
              rootDir: ".",
              lanes: {
                main: {},
              },
            },
            service: {
              rootDir: "services/api",
              lanes: {
                main: {},
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lanePaths = buildLanePaths("main", { config, project: "service" });

    expect(lanePaths.project).toBe("service");
    expect(lanePaths.docsDir).toBe(path.join(REPO_ROOT, "services/api/docs"));
    expect(lanePaths.stateDir).toBe(path.join(REPO_ROOT, ".tmp", "projects", "service", "main-wave-launcher"));
    expect(lanePaths.orchestratorStateDir).toBe(
      path.join(REPO_ROOT, ".tmp", "wave-orchestrator", "projects", "service"),
    );
  });

  it("propagates project-level path overrides through buildLanePaths", () => {
    const configPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "wave-shared-project-paths-")),
      "wave.config.json",
    );
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          defaultProject: "app",
          projects: {
            app: {
              rootDir: ".",
              lanes: {
                main: {},
              },
            },
            service: {
              rootDir: "services/api",
              paths: {
                docsDir: "services/api/custom-docs",
                stateRoot: ".tmp/custom-project-state",
                orchestratorStateDir: ".tmp/custom-project-orchestrator",
                terminalsPath: ".vscode/service-terminals.json",
                benchmarkCatalogPath: "services/api/custom-docs/evals/catalog.json",
                componentCutoverMatrixDocPath:
                  "services/api/custom-docs/plans/custom-component-cutover.md",
                componentCutoverMatrixJsonPath:
                  "services/api/custom-docs/plans/custom-component-cutover.json",
              },
              lanes: {
                main: {},
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadWaveConfig(configPath);
    const lanePaths = buildLanePaths("main", { config, project: "service" });

    expect(lanePaths.docsDir).toBe(path.join(REPO_ROOT, "services/api/custom-docs"));
    expect(lanePaths.stateDir).toBe(
      path.join(REPO_ROOT, ".tmp/custom-project-state", "projects", "service", "main-wave-launcher"),
    );
    expect(lanePaths.orchestratorStateDir).toBe(
      path.join(REPO_ROOT, ".tmp/custom-project-orchestrator", "projects", "service"),
    );
    expect(lanePaths.terminalsPath).toBe(
      path.join(REPO_ROOT, ".vscode/service-terminals.json"),
    );
    expect(lanePaths.benchmarkCatalogPath).toBe(
      path.join(REPO_ROOT, "services/api/custom-docs/evals/catalog.json"),
    );
    expect(lanePaths.componentCutoverMatrixDocPath).toBe(
      path.join(REPO_ROOT, "services/api/custom-docs/plans/custom-component-cutover.md"),
    );
    expect(lanePaths.componentCutoverMatrixJsonPath).toBe(
      path.join(REPO_ROOT, "services/api/custom-docs/plans/custom-component-cutover.json"),
    );
  });
});
