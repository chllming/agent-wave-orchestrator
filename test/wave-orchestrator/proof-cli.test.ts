import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-proof-cli-"));
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

describe("wave proof CLI", () => {
  it("registers authoritative proof bundles and mirrors them into coordination evidence", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);
    const artifactPath = path.join(repoDir, ".tmp", "proof", "live-status.json");
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, "{\"live\":true}\n", "utf8");

    const registerResult = runWaveCli(
      [
        "proof",
        "register",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--artifact",
        ".tmp/proof/live-status.json",
        "--authoritative",
        "--completion",
        "integrated",
        "--durability",
        "durable",
        "--proof-level",
        "integration",
        "--operator",
        "tester",
        "--detail",
        "Operator captured a validated local proof artifact.",
        "--json",
      ],
      repoDir,
    );
    expect(registerResult.status).toBe(0);
    expect(JSON.parse(registerResult.stdout)).toMatchObject({
      entry: {
        agentId: "A1",
        authoritative: true,
        artifacts: [
          expect.objectContaining({
            path: ".tmp/proof/live-status.json",
            exists: true,
          }),
        ],
      },
    });

    const showResult = runWaveCli(
      ["proof", "show", "--lane", "main", "--wave", "0", "--json"],
      repoDir,
    );
    expect(showResult.status).toBe(0);
    expect(JSON.parse(showResult.stdout)).toMatchObject({
      entries: [
        expect.objectContaining({
          agentId: "A1",
          authoritative: true,
        }),
      ],
    });

    const coordinationLogPath = path.join(
      repoDir,
      ".tmp",
      "main-wave-launcher",
      "coordination",
      "wave-0.jsonl",
    );
    const coordinationText = fs.readFileSync(coordinationLogPath, "utf8");
    expect(coordinationText).toContain("\"kind\":\"evidence\"");
    expect(coordinationText).toContain(".tmp/proof/live-status.json");
  });
});
