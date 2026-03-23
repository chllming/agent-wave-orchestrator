import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-retry-cli-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runWaveCli(args, cwd) {
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

describe("wave retry CLI", () => {
  it("writes, shows, and clears targeted retry overrides", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const applyResult = runWaveCli(
      [
        "retry",
        "apply",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--clear-reuse",
        "A1",
        "--requested-by",
        "tester",
        "--reason",
        "resume sibling-owned implementation work",
        "--json",
      ],
      repoDir,
    );
    expect(applyResult.status).toBe(0);
    expect(JSON.parse(applyResult.stdout)).toMatchObject({
      override: {
        selectedAgentIds: ["A1"],
        clearReusableAgentIds: ["A1"],
        requestedBy: "tester",
      },
      effectiveSelectedAgentIds: ["A1"],
    });

    const showResult = runWaveCli(
      ["retry", "show", "--lane", "main", "--wave", "0", "--json"],
      repoDir,
    );
    expect(showResult.status).toBe(0);
    expect(JSON.parse(showResult.stdout)).toMatchObject({
      override: {
        selectedAgentIds: ["A1"],
        clearReusableAgentIds: ["A1"],
      },
      effectiveSelectedAgentIds: ["A1"],
    });

    const clearResult = runWaveCli(
      ["retry", "clear", "--lane", "main", "--wave", "0"],
      repoDir,
    );
    expect(clearResult.status).toBe(0);

    const clearedShow = runWaveCli(
      ["retry", "show", "--lane", "main", "--wave", "0", "--json"],
      repoDir,
    );
    expect(clearedShow.status).toBe(0);
    expect(JSON.parse(clearedShow.stdout).override).toBeNull();
  });
});
