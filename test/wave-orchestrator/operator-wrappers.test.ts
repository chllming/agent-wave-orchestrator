import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-wrapper-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, text: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function runWaveCli(args: string[], cwd: string) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      WAVE_SKIP_UPDATE_CHECK: "1",
    },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("operator wrappers", () => {
  it("returns human-input exit codes from wave-status.sh", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });
    expect(runWaveCli(["init"], repoDir).status).toBe(0);
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
          "Need rollout window",
        ],
        repoDir,
      ).status,
    ).toBe(0);

    const result = spawnSync("bash", [path.join(PACKAGE_ROOT, "scripts", "wave-status.sh"), "--wave", "0", "--agent", "A1"], {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        ...process.env,
        WAVE_WRAPPER_ENTRY: path.join(PACKAGE_ROOT, "scripts", "wave.mjs"),
        WAVE_SKIP_UPDATE_CHECK: "1",
      },
    });

    expect(result.status).toBe(20);
    expect(result.stdout).toContain("signal=feedback-requested");
    expect(result.stdout).toContain("should_wake=yes");
  });

  it("returns until-change exit 30 when a watched signal version changes but remains active", async () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });
    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const child = spawn(
      "bash",
      [
        path.join(PACKAGE_ROOT, "scripts", "wave-watch.sh"),
        "--wave",
        "0",
        "--agent",
        "A1",
        "--until-change",
        "--refresh-ms",
        "100",
      ],
      {
        cwd: repoDir,
        env: {
          ...process.env,
          WAVE_WRAPPER_ENTRY: path.join(PACKAGE_ROOT, "scripts", "wave.mjs"),
          WAVE_SKIP_UPDATE_CHECK: "1",
        },
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
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
          "request",
          "--summary",
          "Re-read the shared summary before resuming.",
        ],
        repoDir,
      ).status,
    ).toBe(0);

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });

    expect(stderr).toBe("");
    expect(exitCode).toBe(30);
    expect(stdout).toContain("signal=coordination-action");
  });

  it("treats failed signals as terminal in wave-status.sh and wave-watch.sh", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });
    const mockWavePath = path.join(repoDir, "mock-wave.mjs");
    writeText(
      mockWavePath,
      `const payload = {
  lane: "main",
  wave: 0,
  phase: "failed",
  signals: {
    wave: {
      signal: "failed",
      lane: "main",
      wave: 0,
      phase: "failed",
      status: "failed",
      version: 3,
      targetAgentIds: ["A1"],
    },
    agents: [
      {
        agentId: "A1",
        signal: "failed",
        lane: "main",
        wave: 0,
        phase: "failed",
        status: "failed",
        version: 3,
        shouldWake: true,
      },
    ],
  },
};
process.stdout.write(JSON.stringify(payload));
`,
    );

    const env = {
      ...process.env,
      WAVE_WRAPPER_ENTRY: mockWavePath,
      WAVE_SKIP_UPDATE_CHECK: "1",
    };
    const statusResult = spawnSync(
      "bash",
      [path.join(PACKAGE_ROOT, "scripts", "wave-status.sh"), "--wave", "0", "--agent", "A1"],
      {
        cwd: repoDir,
        encoding: "utf8",
        env,
      },
    );
    expect(statusResult.status).toBe(40);
    expect(statusResult.stdout).toContain("signal=failed");

    const watchResult = spawnSync(
      "bash",
      [
        path.join(PACKAGE_ROOT, "scripts", "wave-watch.sh"),
        "--wave",
        "0",
        "--agent",
        "A1",
        "--follow",
        "--refresh-ms",
        "100",
      ],
      {
        cwd: repoDir,
        encoding: "utf8",
        env,
        timeout: 2000,
      },
    );
    expect(watchResult.status).toBe(40);
    expect(watchResult.stdout).toContain("signal=failed");
  });
});
