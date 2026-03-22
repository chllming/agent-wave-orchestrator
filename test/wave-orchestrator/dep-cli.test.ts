import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-dep-cli-"));
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

describe("wave dep CLI", () => {
  it("posts, renders, and resolves dependency tickets", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    const initResult = runWaveCli(["init"], repoDir);
    expect(initResult.status).toBe(0);

    const postResult = runWaveCli(
      [
        "dep",
        "post",
        "--owner-lane",
        "main",
        "--requester-lane",
        "release",
        "--owner-wave",
        "0",
        "--requester-wave",
        "2",
        "--agent",
        "launcher",
        "--summary",
        "Need shared-plan reconciliation from main",
        "--target",
        "capability:docs-shared-plan",
        "--required",
      ],
      repoDir,
    );
    expect(postResult.status).toBe(0);
    const posted = JSON.parse(postResult.stdout);

    const showResult = runWaveCli(
      ["dep", "show", "--lane", "main", "--wave", "0", "--json"],
      repoDir,
    );
    expect(showResult.status).toBe(0);
    const snapshot = JSON.parse(showResult.stdout);
    expect(snapshot.requiredInbound).toHaveLength(1);
    expect(snapshot.requiredInbound[0]).toMatchObject({
      summary: "Need shared-plan reconciliation from main",
      assignedAgentId: "A8",
    });

    const renderResult = runWaveCli(["dep", "render", "--lane", "main", "--wave", "0"], repoDir);
    expect(renderResult.status).toBe(0);
    const renderPayload = JSON.parse(renderResult.stdout);
    expect(fs.existsSync(renderPayload.markdownPath)).toBe(true);

    const resolveResult = runWaveCli(
      ["dep", "resolve", "--lane", "main", "--id", posted.id, "--agent", "A8"],
      repoDir,
    );
    expect(resolveResult.status).toBe(0);
  });
});
