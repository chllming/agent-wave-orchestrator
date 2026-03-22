import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-coord-cli-"));
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
    env: process.env,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("wave coord CLI", () => {
  it("keeps coord show read-only for dry-run inspection", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    const initResult = runWaveCli(["init"], repoDir);
    expect(initResult.status).toBe(0);

    const dryRunRoot = path.join(repoDir, ".tmp", "main-wave-launcher", "dry-run");
    expect(fs.existsSync(dryRunRoot)).toBe(false);

    const showResult = runWaveCli(
      ["coord", "show", "--lane", "main", "--wave", "0", "--dry-run", "--json"],
      repoDir,
    );
    expect(showResult.status).toBe(0);
    expect(JSON.parse(showResult.stdout)).toMatchObject({
      records: [],
      latestRecords: [],
      openRecords: [],
    });
    expect(fs.existsSync(dryRunRoot)).toBe(false);
  });
});
