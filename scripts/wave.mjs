#!/usr/bin/env node

import { bootstrapWaveArgs } from "./wave-cli-bootstrap.mjs";

const argv = bootstrapWaveArgs(process.argv.slice(2));
const subcommand = String(argv[0] || "")
  .trim()
  .toLowerCase();
const rest = argv.slice(1);

function printHelp() {
  console.log(`Usage:
  wave init [options]
  wave upgrade [options]
  wave self-update
  wave changelog [options]
  wave doctor [options]
  wave project setup [options]
  wave project show [options]
  wave draft [draft options]
  wave adhoc [adhoc options]
  wave launch [launcher options]
  wave autonomous [autonomous options]
  wave feedback [feedback options]
  wave dashboard [dashboard options]
  wave local [local executor options]
  wave control [control-plane options]
  wave coord [coordination options]
  wave retry [retry control options]
  wave proof [proof registry options]
  wave dep [dependency options]
  wave benchmark [benchmark options]

Global options:
  --repo-root <path>   Run the command against a target workspace root
`);
}

if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
  printHelp();
  process.exit(0);
}

if (["init", "upgrade", "self-update", "changelog", "doctor"].includes(subcommand)) {
  try {
    const { runInstallCli } = await import("./wave-orchestrator/install.mjs");
    await runInstallCli([subcommand, ...rest]);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(Number.isInteger(error?.exitCode) ? error.exitCode : 1);
  }
} else if (subcommand === "project" || subcommand === "draft") {
  try {
    const { runPlannerCli } = await import("./wave-orchestrator/planner.mjs");
    await runPlannerCli([subcommand, ...rest]);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(Number.isInteger(error?.exitCode) ? error.exitCode : 1);
  }
} else if (subcommand === "adhoc") {
  try {
    const { runAdhocCli } = await import("./wave-orchestrator/adhoc.mjs");
    await runAdhocCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(Number.isInteger(error?.exitCode) ? error.exitCode : 1);
  }
} else if (subcommand === "launch") {
  try {
    const { runLauncherCli } = await import("./wave-orchestrator/launcher.mjs");
    await runLauncherCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(Number.isInteger(error?.exitCode) ? error.exitCode : 1);
  }
} else if (subcommand === "autonomous") {
  const { runAutonomousCli } = await import("./wave-orchestrator/autonomous.mjs");
  try {
    await runAutonomousCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "feedback") {
  try {
    const { runFeedbackCli } = await import("./wave-orchestrator/feedback.mjs");
    await runFeedbackCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "dashboard") {
  try {
    const { runDashboardCli } = await import("./wave-orchestrator/dashboard-renderer.mjs");
    await runDashboardCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "local") {
  const { runLocalExecutorCli } = await import("./wave-orchestrator/local-executor.mjs");
  try {
    runLocalExecutorCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "control") {
  try {
    const { runControlCli } = await import("./wave-orchestrator/control-cli.mjs");
    await runControlCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "coord") {
  try {
    const { runCoordinationCli } = await import("./wave-orchestrator/coord-cli.mjs");
    await runCoordinationCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "retry") {
  try {
    const { runRetryCli } = await import("./wave-orchestrator/retry-cli.mjs");
    await runRetryCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "proof") {
  try {
    const { runProofCli } = await import("./wave-orchestrator/proof-cli.mjs");
    await runProofCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "dep") {
  try {
    const { runDependencyCli } = await import("./wave-orchestrator/dep-cli.mjs");
    await runDependencyCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else if (subcommand === "benchmark") {
  try {
    const { runBenchmarkCli } = await import("./wave-orchestrator/benchmark.mjs");
    await runBenchmarkCli(rest);
  } catch (error) {
    console.error(`[wave] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
} else {
  console.error(`[wave] Unknown subcommand: ${subcommand}`);
  printHelp();
  process.exit(1);
}
