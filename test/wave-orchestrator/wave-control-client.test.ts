import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWaveControlArtifactFromPath,
  flushWaveControlQueue,
  queueWaveControlEvent,
  readWaveControlQueueState,
} from "../../scripts/wave-orchestrator/wave-control-client.mjs";

const tempDirs = [];
const servers = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-control-client-"));
  tempDirs.push(dir);
  return dir;
}

function makeLanePaths(dir, waveControl = {}) {
  return {
    lane: "main",
    runKind: "roadmap",
    runId: null,
    projectId: "wave-orchestration",
    runtimeVersion: "0.7.0",
    orchestratorId: "main-orch-1",
    controlPlaneDir: path.join(dir, "control-plane"),
    telemetryDir: path.join(dir, "control-plane", "telemetry"),
    waveControl: {
      enabled: true,
      reportMode: "metadata-plus-selected",
      flushBatchSize: 10,
      requestTimeoutMs: 5000,
      captureControlPlaneEvents: true,
      captureCoordinationRecords: true,
      captureTraceBundles: true,
      captureBenchmarkRuns: true,
      uploadArtifactKinds: ["trace-quality"],
      ...waveControl,
    },
  };
}

async function startJsonServer(onRequest) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    await onRequest(req, body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}/api/v1`;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((resolve) => server.close(resolve));
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("wave-control client", () => {
  it("queues telemetry locally when no endpoint is configured", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);

    const event = queueWaveControlEvent(lanePaths, {
      category: "runtime",
      entityType: "wave_run",
      entityId: "wave-1",
      action: "started",
      data: { waveNumber: 1 },
    });

    expect(event?.entityType).toBe("wave_run");
    expect(event?.identity).toMatchObject({
      projectId: "wave-orchestration",
      orchestratorId: "main-orch-1",
      runtimeVersion: "0.7.0",
    });
    const state = readWaveControlQueueState(lanePaths);
    expect(state.pendingCount).toBe(1);
    expect(fs.existsSync(path.join(lanePaths.telemetryDir, "events.jsonl"))).toBe(true);
  });

  it("stays inert when telemetry is disabled", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir, {
      enabled: false,
    });

    const event = queueWaveControlEvent(lanePaths, {
      category: "runtime",
      entityType: "wave_run",
      entityId: "wave-1",
      action: "started",
    });

    expect(event).toBeNull();
    expect(readWaveControlQueueState(lanePaths)).toMatchObject({
      lane: "main",
      pendingCount: 0,
      disabled: true,
    });
    expect(await flushWaveControlQueue(lanePaths)).toMatchObject({
      attempted: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      disabled: true,
    });
    expect(fs.existsSync(lanePaths.telemetryDir)).toBe(false);
  });

  it("flushes queued telemetry and uploads selected artifact bodies", async () => {
    const dir = makeTempDir();
    const artifactPath = path.join(dir, "quality.json");
    fs.writeFileSync(artifactPath, JSON.stringify({ finalRecommendation: "pass" }, null, 2), "utf8");

    let receivedBody = null;
    const endpoint = await startJsonServer(async (_req, body) => {
      receivedBody = JSON.parse(body);
    });
    const lanePaths = makeLanePaths(dir, {
      endpoint,
      authTokenEnvVar: "TEST_WAVE_CONTROL_TOKEN",
    });
    process.env.TEST_WAVE_CONTROL_TOKEN = "secret-token";

    queueWaveControlEvent(lanePaths, {
      category: "trace",
      entityType: "artifact",
      entityId: "trace-1",
      action: "bundle-written",
      artifacts: [
        {
          ...buildWaveControlArtifactFromPath(artifactPath, {
            kind: "trace-quality",
            uploadPolicy: "selected",
          }),
          sourcePath: artifactPath,
        },
      ],
      data: { traceDir: ".tmp/main-wave-launcher/traces/wave-1/attempt-1" },
    });

    const result = await flushWaveControlQueue(lanePaths);
    expect(result).toMatchObject({
      attempted: 1,
      sent: 1,
      failed: 0,
    });
    expect(receivedBody.events).toHaveLength(1);
    expect(receivedBody.events[0].artifactUploads).toEqual([
      expect.objectContaining({
        contentType: "application/json",
        encoding: "utf8",
      }),
    ]);
    expect(receivedBody.events[0].artifactUploads[0].content).toContain('"finalRecommendation": "pass"');
    expect(readWaveControlQueueState(lanePaths).pendingCount).toBe(0);
  });

  it("continues a flush when one selected artifact body disappears mid-read", async () => {
    const dir = makeTempDir();
    const survivingArtifactPath = path.join(dir, "quality.json");
    const disappearingArtifactPath = path.join(dir, "results.json");
    fs.writeFileSync(
      survivingArtifactPath,
      JSON.stringify({ finalRecommendation: "pass" }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      disappearingArtifactPath,
      JSON.stringify({ score: 100 }, null, 2),
      "utf8",
    );

    let receivedBody = null;
    const endpoint = await startJsonServer(async (_req, body) => {
      receivedBody = JSON.parse(body);
    });
    const lanePaths = makeLanePaths(dir, {
      endpoint,
      authTokenEnvVar: "TEST_WAVE_CONTROL_TOKEN",
      uploadArtifactKinds: ["trace-quality", "benchmark-results"],
    });
    process.env.TEST_WAVE_CONTROL_TOKEN = "secret-token";

    queueWaveControlEvent(lanePaths, {
      category: "trace",
      entityType: "artifact",
      entityId: "trace-partial-upload",
      action: "bundle-written",
      artifacts: [
        {
          ...buildWaveControlArtifactFromPath(survivingArtifactPath, {
            kind: "trace-quality",
            uploadPolicy: "selected",
          }),
          sourcePath: survivingArtifactPath,
        },
        {
          ...buildWaveControlArtifactFromPath(disappearingArtifactPath, {
            kind: "benchmark-results",
            uploadPolicy: "selected",
          }),
          sourcePath: disappearingArtifactPath,
        },
      ],
    });

    const originalReadFileSync = fs.readFileSync;
    let removed = false;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((filePath, ...args) => {
      if (!removed && String(filePath) === disappearingArtifactPath) {
        fs.rmSync(disappearingArtifactPath, { force: true });
        removed = true;
      }
      return originalReadFileSync.call(fs, filePath, ...args);
    });

    const result = await flushWaveControlQueue(lanePaths);
    readSpy.mockRestore();

    expect(result).toMatchObject({
      attempted: 1,
      sent: 1,
      failed: 0,
      pending: 0,
    });
    expect(receivedBody.events).toHaveLength(1);
    expect(receivedBody.events[0].artifactUploads).toHaveLength(1);
    expect(receivedBody.events[0].artifactUploads[0].content).toContain(
      '"finalRecommendation": "pass"',
    );
  });

  it("tolerates pending files disappearing during a concurrent flush", async () => {
    const dir = makeTempDir();
    let receivedBody = null;
    const endpoint = await startJsonServer(async (_req, body) => {
      receivedBody = JSON.parse(body);
    });
    const lanePaths = makeLanePaths(dir, {
      endpoint,
    });

    queueWaveControlEvent(lanePaths, {
      category: "runtime",
      entityType: "wave_run",
      entityId: "wave-1",
      action: "started",
    });
    queueWaveControlEvent(lanePaths, {
      category: "runtime",
      entityType: "wave_run",
      entityId: "wave-2",
      action: "started",
    });

    const pendingFiles = fs
      .readdirSync(path.join(lanePaths.telemetryDir, "pending"))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => path.join(lanePaths.telemetryDir, "pending", fileName));
    const missingTarget = pendingFiles[0];
    const originalReadFileSync = fs.readFileSync;
    let removed = false;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((filePath, ...args) => {
      if (!removed && String(filePath) === missingTarget) {
        fs.rmSync(missingTarget, { force: true });
        removed = true;
      }
      return originalReadFileSync.call(fs, filePath, ...args);
    });

    const result = await flushWaveControlQueue(lanePaths);
    readSpy.mockRestore();

    expect(result).toMatchObject({
      attempted: 1,
      sent: 1,
      failed: 0,
      pending: 0,
    });
    expect(receivedBody.events).toHaveLength(1);
    expect(readWaveControlQueueState(lanePaths).pendingCount).toBe(0);
  });

  it("respects the configured artifact-kind allowlist for body uploads", async () => {
    const dir = makeTempDir();
    const allowedArtifactPath = path.join(dir, "quality.json");
    const blockedArtifactPath = path.join(dir, "results.json");
    fs.writeFileSync(allowedArtifactPath, JSON.stringify({ finalRecommendation: "pass" }, null, 2), "utf8");
    fs.writeFileSync(blockedArtifactPath, JSON.stringify({ score: 100 }, null, 2), "utf8");

    let receivedBody = null;
    const endpoint = await startJsonServer(async (_req, body) => {
      receivedBody = JSON.parse(body);
    });
    const lanePaths = makeLanePaths(dir, {
      endpoint,
      authTokenEnvVar: "TEST_WAVE_CONTROL_TOKEN",
      uploadArtifactKinds: ["trace-quality"],
    });
    process.env.TEST_WAVE_CONTROL_TOKEN = "secret-token";

    queueWaveControlEvent(lanePaths, {
      category: "trace",
      entityType: "artifact",
      entityId: "trace-allowlist",
      action: "bundle-written",
      artifacts: [
        {
          ...buildWaveControlArtifactFromPath(allowedArtifactPath, {
            kind: "trace-quality",
            uploadPolicy: "selected",
          }),
          sourcePath: allowedArtifactPath,
        },
        {
          ...buildWaveControlArtifactFromPath(blockedArtifactPath, {
            kind: "benchmark-results",
            uploadPolicy: "selected",
          }),
          sourcePath: blockedArtifactPath,
        },
      ],
    });

    await flushWaveControlQueue(lanePaths);
    expect(receivedBody.events).toHaveLength(1);
    expect(receivedBody.events[0].artifactUploads).toHaveLength(1);
    expect(receivedBody.events[0].artifactUploads[0].content).toContain('"finalRecommendation": "pass"');
  });

  it("caps the pending remote-delivery queue without dropping the local event stream", () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir, {
      maxPendingEvents: 2,
    });

    queueWaveControlEvent(lanePaths, {
      category: "runtime",
      entityType: "wave_run",
      entityId: "wave-1",
      action: "started",
    });
    queueWaveControlEvent(lanePaths, {
      category: "runtime",
      entityType: "wave_run",
      entityId: "wave-2",
      action: "started",
    });
    queueWaveControlEvent(lanePaths, {
      category: "runtime",
      entityType: "wave_run",
      entityId: "wave-3",
      action: "started",
    });

    const state = readWaveControlQueueState(lanePaths);
    expect(state.pendingCount).toBe(2);
    expect(state.failedCount).toBe(1);
    expect(String(state.lastError?.message || "")).toContain("maxPendingEvents");
    expect(fs.readFileSync(path.join(lanePaths.telemetryDir, "events.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
    expect(
      fs.readdirSync(path.join(lanePaths.telemetryDir, "failed")).some((fileName) =>
        fileName.startsWith("overflow-"),
      ),
    ).toBe(true);
  });
});
