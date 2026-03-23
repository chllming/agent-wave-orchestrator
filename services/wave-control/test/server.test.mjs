import assert from "node:assert/strict";
import test from "node:test";
import { createWaveControlServer } from "../src/server.mjs";

function testConfig(overrides = {}) {
  return {
    host: "127.0.0.1",
    port: 0,
    logLevel: "info",
    auth: {
      tokens: ["test-token"],
      requireAuthForReads: true,
    },
    postgres: {
      databaseUrl: "",
      ssl: false,
      maxConnections: 1,
    },
    storage: {
      bucketName: "",
      endpoint: "",
      accessKeyId: "",
      secretAccessKey: "",
      region: "auto",
      publicBaseUrl: "",
      signedUrlTtlSeconds: 900,
      forcePathStyle: true,
    },
    ingest: {
      maxBatchEvents: 50,
      maxInlineArtifactBytes: 512 * 1024,
    },
    ui: {
      title: "Wave Control",
    },
    ...overrides,
  };
}

async function listen(configOverrides = {}) {
  const app = await createWaveControlServer({
    config: testConfig(configOverrides),
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  return {
    ...app,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test("health is public and ingest requires bearer auth", async (t) => {
  const app = await listen();
  t.after(async () => {
    await app.close();
  });

  const health = await fetch(`${app.baseUrl}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const ui = await fetch(`${app.baseUrl}/`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /Wave Control/);

  const unauthorized = await fetch(`${app.baseUrl}/api/v1/ingest/batches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${app.baseUrl}/api/v1/ingest/batches`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({
      events: [
        {
          id: "evt-run-1",
          recordedAt: "2026-03-22T10:00:00.000Z",
          entityType: "wave_run",
          entityId: "wave-1",
          action: "completed",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "roadmap",
            lane: "main",
            wave: 1,
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          tags: ["runtime"],
          data: {
            waveId: "wave-1",
          },
        },
      ],
    }),
  });
  assert.equal(authorized.status, 200);
  const payload = await authorized.json();
  assert.deepEqual(
    {
      ok: payload.ok,
      accepted: payload.accepted,
      duplicates: payload.duplicates,
      received: payload.received,
    },
    { ok: true, accepted: 1, duplicates: 0, received: 1 },
  );
});

test("run, benchmark, analytics, and artifact endpoints project ingested telemetry", async (t) => {
  const app = await listen();
  t.after(async () => {
    await app.close();
  });

  const batchResponse = await fetch(`${app.baseUrl}/api/v1/ingest/batches`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({
      events: [
        {
          id: "evt-run-1",
          recordedAt: "2026-03-22T10:00:00.000Z",
          entityType: "wave_run",
          entityId: "wave-1",
          action: "completed",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "roadmap",
            lane: "main",
            wave: 1,
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          data: {
            waveId: "wave-1",
          },
          artifacts: [
            {
              artifactId: "artifact-inline",
              path: ".tmp/run-metadata.json",
              kind: "trace-run-metadata",
              present: true,
              uploadPolicy: "selected",
            },
          ],
          artifactUploads: [
            {
              artifactId: "artifact-inline",
              contentType: "application/json",
              encoding: "utf8",
              content: "{\"ok\":true}\n",
            },
          ],
        },
        {
          id: "evt-bench-1",
          recordedAt: "2026-03-22T10:01:00.000Z",
          entityType: "benchmark_run",
          entityId: "bench-1",
          action: "completed",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "benchmark",
            benchmarkRunId: "bench-1",
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          data: {
            adapter: { id: "swe-bench-pro" },
            manifest: { id: "pilot-1" },
            selectedArms: ["full-wave"],
            comparisonMode: "review-only",
            comparisonReady: false,
            summary: { tasks: 1, solved: 0 },
          },
        },
        {
          id: "evt-review-1",
          recordedAt: "2026-03-22T10:02:00.000Z",
          entityType: "review",
          entityId: "task-1:review",
          action: "review-only",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "benchmark",
            benchmarkRunId: "bench-1",
            benchmarkItemId: "task-1:full-wave",
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          data: {
            reviewValidity: "review-only",
          },
        },
      ],
    }),
  });
  assert.equal(batchResponse.status, 200);

  const headers = { authorization: "Bearer test-token" };
  const runs = await fetch(
    `${app.baseUrl}/api/v1/runs?workspaceId=workspace-1&projectId=wave-orchestration&orchestratorId=main-orch-1&runtimeVersion=0.7.0`,
    { headers },
  );
  assert.equal(runs.status, 200);
  const runList = await runs.json();
  assert.equal(runList.length, 1);
  assert.equal(runList[0].status, "completed");
  assert.equal(runList[0].projectId, "wave-orchestration");
  assert.equal(runList[0].orchestratorId, "main-orch-1");
  assert.equal(runList[0].runtimeVersion, "0.7.0");

  const runDetail = await fetch(
    `${app.baseUrl}/api/v1/run?workspaceId=workspace-1&projectId=wave-orchestration&lane=main&wave=1&orchestratorId=main-orch-1&runtimeVersion=0.7.0`,
    { headers },
  );
  assert.equal(runDetail.status, 200);
  const runPayload = await runDetail.json();
  assert.equal(runPayload.summary.wave, 1);
  assert.equal(runPayload.summary.projectId, "wave-orchestration");
  assert.equal(runPayload.artifacts.length, 1);

  const benchmarks = await fetch(
    `${app.baseUrl}/api/v1/benchmarks?workspaceId=workspace-1&projectId=wave-orchestration&orchestratorId=main-orch-1&runtimeVersion=0.7.0`,
    { headers },
  );
  assert.equal(benchmarks.status, 200);
  const benchmarkList = await benchmarks.json();
  assert.equal(benchmarkList.length, 1);
  assert.equal(benchmarkList[0].benchmarkRunId, "bench-1");
  assert.equal(benchmarkList[0].projectId, "wave-orchestration");

  const benchmarkDetail = await fetch(
    `${app.baseUrl}/api/v1/benchmark?workspaceId=workspace-1&projectId=wave-orchestration&benchmarkRunId=bench-1&orchestratorId=main-orch-1&runtimeVersion=0.7.0`,
    { headers },
  );
  assert.equal(benchmarkDetail.status, 200);
  const benchmarkPayload = await benchmarkDetail.json();
  assert.equal(benchmarkPayload.summary.benchmarkRunId, "bench-1");
  assert.equal(benchmarkPayload.summary.runtimeVersion, "0.7.0");
  assert.equal(benchmarkPayload.reviews.length, 1);

  const analytics = await fetch(
    `${app.baseUrl}/api/v1/analytics/overview?workspaceId=workspace-1&projectId=wave-orchestration&orchestratorId=main-orch-1&runtimeVersion=0.7.0`,
    { headers },
  );
  assert.equal(analytics.status, 200);
  const analyticsPayload = await analytics.json();
  assert.equal(analyticsPayload.runCount, 1);
  assert.equal(analyticsPayload.benchmarkRunCount, 1);

  const artifact = await fetch(
    `${app.baseUrl}/api/v1/artifact?eventId=evt-run-1&artifactId=artifact-inline&inline=1`,
    { headers },
  );
  assert.equal(artifact.status, 200);
  const artifactPayload = await artifact.json();
  assert.equal(artifactPayload.metadata.kind, "trace-run-metadata");
  assert.equal(artifactPayload.inlineContent.content, "{\"ok\":true}\n");

  const signedUpload = await fetch(`${app.baseUrl}/api/v1/artifacts/signed-upload`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({
      workspaceId: "workspace-1",
      eventId: "evt-run-1",
      artifactId: "artifact-inline",
      contentType: "application/json",
    }),
  });
  assert.equal(signedUpload.status, 501);
});
