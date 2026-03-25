import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-operator-wrapper-test-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture-repo", private: true }, null, 2),
    "utf8",
  );
  return dir;
}

function runWaveCli(args, cwd) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd,
    env: {
      ...process.env,
      WAVE_SKIP_UPDATE_CHECK: "1",
    },
    encoding: "utf8",
  });
}

function installFixtureWaveBin(repoDir) {
  const binDir = path.join(repoDir, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, "wave");
  fs.writeFileSync(
    binPath,
    `#!/usr/bin/env bash
exec node "${path.join(PACKAGE_ROOT, "scripts", "wave.mjs")}" "$@"
`,
    "utf8",
  );
  fs.chmodSync(binPath, 0o755);
}

function runWrapper(repoDir, relPath, args = [], env = {}) {
  return spawnSync("bash", [path.join(repoDir, relPath), ...args], {
    cwd: repoDir,
    env: {
      ...process.env,
      WAVE_SKIP_UPDATE_CHECK: "1",
      ...env,
    },
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("operator wrapper scripts", () => {
  it("reports waiting state with exit code 10", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    installFixtureWaveBin(repoDir);

    const result = runWrapper(repoDir, "scripts/wave-status.sh", ["0"]);

    expect(result.status).toBe(10);
    expect(result.stdout).toContain("signal=waiting");
    expect(result.stdout).toContain("lane=main");
    expect(result.stdout).toContain("wave=0");
  });

  it("reports human-input waits with exit code 20", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    installFixtureWaveBin(repoDir);
    expect(
      runWaveCli(
        [
          "control",
          "task",
          "create",
          "--lane",
          "main",
          "--wave",
          "0",
          "--agent",
          "A1",
          "--kind",
          "human-input",
          "--summary",
          "Need approval",
          "--detail",
          "Operator approval is required before continuing.",
        ],
        repoDir,
      ).status,
    ).toBe(0);

    const result = runWrapper(repoDir, "scripts/wave-status.sh", ["0"]);

    expect(result.status).toBe(20);
    expect(result.stdout).toContain("signal=input-required");
    expect(result.stdout).toContain("blocking=human-input:");
  });

  it("reports completed state with exit code 0 and lets watch exit cleanly", () => {
    const repoDir = makeTempRepo();
    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    installFixtureWaveBin(repoDir);
    const ledgerDir = path.join(repoDir, ".tmp", "main-wave-launcher", "ledger");
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(
      path.join(ledgerDir, "wave-0.json"),
      `${JSON.stringify({ phase: "completed" }, null, 2)}\n`,
      "utf8",
    );

    const statusResult = runWrapper(repoDir, "scripts/wave-status.sh", ["0"]);
    const watchResult = runWrapper(repoDir, "scripts/wave-watch.sh", ["--follow", "0"], {
      WAVE_STATUS_REFRESH_SECONDS: "0.05",
    });

    expect(statusResult.status).toBe(0);
    expect(statusResult.stdout).toContain("signal=completed");
    expect(watchResult.status).toBe(0);
    expect(watchResult.stdout).toContain("signal=completed");
  });
});
