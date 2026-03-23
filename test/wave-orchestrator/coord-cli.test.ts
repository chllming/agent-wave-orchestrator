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

  it("explains targeted blocking requests and can resolve them through coord act", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const postResult = runWaveCli(
      [
        "coord",
        "post",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A8",
        "--kind",
        "request",
        "--summary",
        "Need rollout follow-up",
        "--target",
        "agent:A1",
      ],
      repoDir,
    );
    expect(postResult.status).toBe(0);
    const posted = JSON.parse(postResult.stdout);

    const explainResult = runWaveCli(
      [
        "coord",
        "explain",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A1",
        "--json",
      ],
      repoDir,
    );
    expect(explainResult.status).toBe(0);
    expect(JSON.parse(explainResult.stdout)).toMatchObject({
      agentId: "A1",
      blockedBy: expect.arrayContaining(["targeted open request"]),
    });
    expect(
      JSON.parse(explainResult.stdout).openCoordination.some(
        (record) =>
          record.id === posted.id && record.kind === "request" && record.status === "open",
      ),
    ).toBe(true);

    const resolveResult = runWaveCli(
      [
        "coord",
        "act",
        "resolve",
        "--lane",
        "main",
        "--wave",
        "0",
        "--id",
        posted.id,
        "--detail",
        "Handled by operator",
      ],
      repoDir,
    );
    expect(resolveResult.status).toBe(0);

    const showResult = runWaveCli(
      ["coord", "show", "--lane", "main", "--wave", "0", "--json"],
      repoDir,
    );
    expect(showResult.status).toBe(0);
    expect(JSON.parse(showResult.stdout).byId[posted.id]).toMatchObject({
      status: "resolved",
    });
  });

  it("can reroute a clarification into a new targeted request", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    expect(runWaveCli(["init"], repoDir).status).toBe(0);

    const postResult = runWaveCli(
      [
        "coord",
        "post",
        "--lane",
        "main",
        "--wave",
        "0",
        "--agent",
        "A7",
        "--kind",
        "clarification-request",
        "--summary",
        "Need rollout approval",
      ],
      repoDir,
    );
    expect(postResult.status).toBe(0);
    const clarification = JSON.parse(postResult.stdout);

    const rerouteResult = runWaveCli(
      [
        "coord",
        "act",
        "reroute",
        "--lane",
        "main",
        "--wave",
        "0",
        "--id",
        clarification.id,
        "--to",
        "A1",
      ],
      repoDir,
    );
    expect(rerouteResult.status).toBe(0);
    expect(JSON.parse(rerouteResult.stdout)).toMatchObject({
      kind: "request",
      status: "open",
      targets: ["agent:A1"],
    });

    const showResult = runWaveCli(
      ["coord", "show", "--lane", "main", "--wave", "0", "--json"],
      repoDir,
    );
    expect(showResult.status).toBe(0);
    const payload = JSON.parse(showResult.stdout);
    expect(payload.byId[clarification.id]).toMatchObject({
      kind: "clarification-request",
      status: "in_progress",
    });
    expect(
      payload.latestRecords.some(
        (record) =>
          record.kind === "request" &&
          record.status === "open" &&
          Array.isArray(record.dependsOn) &&
          record.dependsOn.includes(clarification.id),
      ),
    ).toBe(true);
  });
});
