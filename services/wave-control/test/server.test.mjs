import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultProviderGrants, createAppUserRecord } from "../src/app-users.mjs";
import { createPersonalAccessToken } from "../src/personal-access-tokens.mjs";
import { createWaveControlServer } from "../src/server.mjs";

const STACK_ME_URL = "https://api.stack-auth.com/api/v1/users/me";
const STACK_TEAMS_URL = "https://api.stack-auth.com/api/v1/teams?user_id=me";
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function testConfig(overrides = {}) {
  return {
    host: "127.0.0.1",
    port: 0,
    logLevel: "info",
    auth: {
      tokens: ["test-token"],
      serviceTokens: [],
      requireAuthForReads: true,
    },
    secrets: {
      encryptionKey: "",
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
    cors: {
      allowedOrigins: [],
    },
    stack: {
      enabled: false,
      projectId: "",
      publishableClientKey: "",
      secretServerKey: "",
      internalTeamIds: [],
      adminTeamIds: [],
      bootstrapSuperuserEmails: [],
    },
    broker: {
      ownedDeployment: false,
      context7Enabled: false,
      context7ApiKey: "",
      corridorEnabled: false,
      corridorApiToken: "",
      openaiEnabled: false,
      openaiApiKey: "",
      anthropicEnabled: false,
      anthropicApiKey: "",
      requestTimeoutMs: 5000,
      maxRetries: 1,
      maxPages: 10,
      corridorProjectMap: {},
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

async function seedAppUser(app, options = {}) {
  const record = createAppUserRecord(options);
  await app.store.createAppUser(record);
  return record;
}

async function seedPersonalAccessToken(app, { label = "Seed token", scopes = ["broker:read"], owner = {} } = {}) {
  const generated = createPersonalAccessToken(label, scopes, owner);
  await app.store.createPersonalAccessToken({
    ...generated.record,
    tokenHash: generated.tokenHash,
  });
  return generated;
}

function stackJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function timeoutError(message = "timed out") {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

function installStackFetchMock(t, handlers = {}) {
  const originalFetch = globalThis.fetch;
  const counts = {
    me: 0,
    teams: 0,
  };
  globalThis.fetch = async (url, options) => {
    const normalized = String(url);
    if (normalized === STACK_ME_URL) {
      counts.me += 1;
      if (!handlers.me) {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return handlers.me(options, counts.me);
    }
    if (normalized === STACK_TEAMS_URL) {
      counts.teams += 1;
      if (!handlers.teams) {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return handlers.teams(options, counts.teams);
    }
    if (handlers.other) {
      return handlers.other(url, options, originalFetch);
    }
    return originalFetch(url, options);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  return counts;
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

test("context7 broker proxies through an owned deployment only", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const normalized = String(url);
    if (!normalized.includes("context7.com/api/v2/libs/search")) {
      return originalFetch(url, options);
    }
    return new Response(JSON.stringify([{ id: "lib-1", name: "react" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = await listen({
    broker: {
      ownedDeployment: true,
      context7Enabled: true,
      context7ApiKey: "ctx-token",
      corridorEnabled: false,
      corridorApiToken: "",
      corridorProjectMap: {},
    },
  });
  t.after(async () => {
    await app.close();
  });

  const unauthorized = await fetch(
    `${app.baseUrl}/api/v1/providers/context7/search?libraryName=react&query=react`,
  );
  assert.equal(unauthorized.status, 401);

  const proxied = await fetch(
    `${app.baseUrl}/api/v1/providers/context7/search?libraryName=react&query=react`,
    {
      headers: { authorization: "Bearer test-token" },
    },
  );
  assert.equal(proxied.status, 200);
  const payload = await proxied.json();
  assert.equal(payload[0].id, "lib-1");
});

test("broker proxy does not retry non-retryable upstream 4xx responses", async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamFetches = 0;
  globalThis.fetch = async (url, options) => {
    const normalized = String(url);
    if (!normalized.includes("context7.com/api/v2/libs/search")) {
      return originalFetch(url, options);
    }
    upstreamFetches += 1;
    return new Response(JSON.stringify({ error: "upstream unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = await listen({
    broker: {
      ownedDeployment: true,
      context7Enabled: true,
      context7ApiKey: "ctx-token",
      corridorEnabled: false,
      corridorApiToken: "",
      maxRetries: 3,
      corridorProjectMap: {},
    },
  });
  t.after(async () => {
    await app.close();
  });

  const response = await fetch(
    `${app.baseUrl}/api/v1/providers/context7/search?libraryName=react&query=react`,
    {
      headers: { authorization: "Bearer test-token" },
    },
  );
  assert.equal(response.status, 502);
  assert.equal(upstreamFetches, 1);
  assert.match((await response.json()).error, /401|unauthorized/i);
});

test("broker proxy retries retryable upstream failures before succeeding", async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamFetches = 0;
  globalThis.fetch = async (url, options) => {
    const normalized = String(url);
    if (!normalized.includes("context7.com/api/v2/libs/search")) {
      return originalFetch(url, options);
    }
    upstreamFetches += 1;
    if (upstreamFetches === 1) {
      return new Response(JSON.stringify({ error: "try again" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify([{ id: "lib-1", name: "react" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = await listen({
    broker: {
      ownedDeployment: true,
      context7Enabled: true,
      context7ApiKey: "ctx-token",
      corridorEnabled: false,
      corridorApiToken: "",
      maxRetries: 3,
      corridorProjectMap: {},
    },
  });
  t.after(async () => {
    await app.close();
  });

  const response = await fetch(
    `${app.baseUrl}/api/v1/providers/context7/search?libraryName=react&query=react`,
    {
      headers: { authorization: "Bearer test-token" },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(upstreamFetches, 2);
  const payload = await response.json();
  assert.equal(payload[0].id, "lib-1");
});

test("corridor broker returns normalized project-scoped findings", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const normalized = String(url);
    if (!normalized.includes("app.corridor.dev/api/")) {
      return originalFetch(url, options);
    }
    if (normalized.endsWith("/projects/corridor-project/reports")) {
      return new Response(
        JSON.stringify({ reports: [{ id: "r1", name: "No secrets", guardrail: "Never commit secrets." }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (normalized.startsWith("https://app.corridor.dev/api/projects/corridor-project/findings")) {
      return new Response(
        JSON.stringify([
          {
            id: "f1",
            title: "Hardcoded token",
            affectedFile: "src/auth/token.ts",
            severity: "critical",
            state: "open",
          },
          {
            id: "f2",
            title: "Docs note",
            affectedFile: "docs/security.md",
            severity: "high",
            state: "open",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch URL: ${normalized}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = await listen({
    broker: {
      ownedDeployment: true,
      context7Enabled: false,
      context7ApiKey: "",
      corridorEnabled: true,
      corridorApiToken: "cor-token",
      corridorProjectMap: {
        app: {
          teamId: "team-1",
          projectId: "corridor-project",
        },
      },
    },
  });
  t.after(async () => {
    await app.close();
  });

  const response = await fetch(`${app.baseUrl}/api/v1/providers/corridor/context`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      projectId: "app",
      ownedPaths: ["src/auth", ".tmp/main-wave-launcher/security/wave-0-review.md"],
      severityThreshold: "critical",
      findingStates: ["open"],
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.error, null);
  assert.equal(payload.blocking, true);
  assert.equal(payload.blockingFindings.length, 1);
  assert.equal(payload.blockingFindings[0].id, "f1");
  assert.equal(payload.guardrails.length, 1);
});

test("corridor broker treats empty findingStates as all states", async (t) => {
  const originalFetch = globalThis.fetch;
  const findingUrls = [];
  globalThis.fetch = async (url, options) => {
    const normalized = String(url);
    if (!normalized.includes("app.corridor.dev/api/")) {
      return originalFetch(url, options);
    }
    if (normalized.endsWith("/projects/corridor-project/reports")) {
      return new Response(
        JSON.stringify({ reports: [{ id: "r1", name: "All findings" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (normalized.startsWith("https://app.corridor.dev/api/projects/corridor-project/findings")) {
      findingUrls.push(normalized);
      return new Response(
        JSON.stringify([
          {
            id: "f-open",
            title: "Open finding",
            affectedFile: "src/auth/token.ts",
            severity: "high",
            state: "open",
          },
          {
            id: "f-closed",
            title: "Closed finding",
            affectedFile: "src/auth/legacy.ts",
            severity: "medium",
            state: "closed",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch URL: ${normalized}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = await listen({
    broker: {
      ownedDeployment: true,
      context7Enabled: false,
      context7ApiKey: "",
      corridorEnabled: true,
      corridorApiToken: "cor-token",
      corridorProjectMap: {
        app: {
          teamId: "team-1",
          projectId: "corridor-project",
        },
      },
    },
  });
  t.after(async () => {
    await app.close();
  });

  const response = await fetch(`${app.baseUrl}/api/v1/providers/corridor/context`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      projectId: "app",
      ownedPaths: ["src/auth"],
      severityThreshold: "critical",
      findingStates: [],
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(findingUrls.length, 1);
  assert.equal(new URL(findingUrls[0]).searchParams.has("state"), false);
  assert.deepEqual(
    payload.matchedFindings.map((finding) => finding.id).sort(),
    ["f-closed", "f-open"],
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
          id: "evt-gate-1",
          recordedAt: "2026-03-22T10:00:30.000Z",
          entityType: "gate",
          entityId: "wave-1:gate",
          action: "evaluated",
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
            gateSnapshot: {
              overall: {
                gate: "pass",
                statusCode: "pass",
              },
            },
          },
        },
        {
          id: "evt-proof-1",
          recordedAt: "2026-03-22T10:00:40.000Z",
          entityType: "proof_bundle",
          entityId: "wave-1:proof",
          action: "recorded",
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
            summary: "proof recorded",
          },
        },
        {
          id: "evt-coord-1",
          recordedAt: "2026-03-22T10:00:50.000Z",
          entityType: "coordination_record",
          entityId: "wave-1:coord",
          action: "noted",
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
            kind: "note",
          },
        },
        {
          id: "evt-run-2",
          recordedAt: "2026-03-22T10:00:55.000Z",
          entityType: "wave_run",
          entityId: "wave-2",
          action: "blocked",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "adhoc",
            lane: "main",
            wave: 2,
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          data: {
            waveId: "wave-2",
          },
        },
        {
          id: "evt-gate-2",
          recordedAt: "2026-03-22T10:01:10.000Z",
          entityType: "gate",
          entityId: "wave-2:gate",
          action: "evaluated",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "adhoc",
            lane: "main",
            wave: 2,
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          data: {
            gateSnapshot: {
              overall: {
                gate: "clarificationBarrier",
                statusCode: "clarification-follow-up-open",
              },
            },
          },
        },
        {
          id: "evt-bench-3",
          recordedAt: "2026-03-22T10:01:40.000Z",
          entityType: "benchmark_run",
          entityId: "bench-3",
          action: "completed",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "benchmark",
            benchmarkRunId: "bench-3",
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          data: {
            adapter: { id: "local-bench" },
            manifest: { id: "pilot-local" },
            selectedArms: ["local-wave"],
            summary: { tasks: 1, solved: 1 },
          },
        },
        {
          id: "evt-bench-1",
          recordedAt: "2026-03-22T10:02:00.000Z",
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
          id: "evt-bench-item-1",
          recordedAt: "2026-03-22T10:02:10.000Z",
          entityType: "benchmark_item",
          entityId: "task-1",
          action: "recorded",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "benchmark",
            benchmarkRunId: "bench-1",
            benchmarkItemId: "task-1:full-wave",
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
        },
        {
          id: "evt-verification-1",
          recordedAt: "2026-03-22T10:02:20.000Z",
          entityType: "verification",
          entityId: "task-1:verify",
          action: "completed",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "benchmark",
            benchmarkRunId: "bench-1",
            benchmarkItemId: "task-1:full-wave",
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
        },
        {
          id: "evt-review-1",
          recordedAt: "2026-03-22T10:02:30.000Z",
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
        {
          id: "evt-bench-2",
          recordedAt: "2026-03-22T10:03:00.000Z",
          entityType: "benchmark_run",
          entityId: "bench-2",
          action: "completed",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "benchmark",
            benchmarkRunId: "bench-2",
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          data: {
            adapter: { id: "swe-bench-lite" },
            manifest: { id: "pilot-2" },
            selectedArms: ["lite-wave"],
            comparisonMode: "comparison",
            comparisonReady: true,
            summary: { tasks: 2, solved: 2 },
          },
        },
        {
          id: "evt-bench-item-2",
          recordedAt: "2026-03-22T10:03:10.000Z",
          entityType: "benchmark_item",
          entityId: "task-2",
          action: "recorded",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "benchmark",
            benchmarkRunId: "bench-2",
            benchmarkItemId: "task-2:lite-wave",
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
        },
        {
          id: "evt-review-2",
          recordedAt: "2026-03-22T10:03:20.000Z",
          entityType: "review",
          entityId: "task-2:review",
          action: "comparison-valid",
          identity: {
            workspaceId: "workspace-1",
            projectId: "wave-orchestration",
            runKind: "benchmark",
            benchmarkRunId: "bench-2",
            benchmarkItemId: "task-2:lite-wave",
            orchestratorId: "main-orch-1",
            runtimeVersion: "0.7.0",
          },
          data: {
            reviewValidity: "comparison-valid",
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
  assert.equal(runList.length, 2);
  assert.equal(runList[0].projectId, "wave-orchestration");
  assert.equal(runList[0].orchestratorId, "main-orch-1");
  assert.equal(runList[0].runtimeVersion, "0.7.0");
  const completedRun = runList.find((entry) => entry.wave === 1);
  assert.equal(completedRun.status, "completed");
  assert.equal(completedRun.latestGate, "pass");
  assert.equal(completedRun.artifactCount, 1);
  assert.equal(completedRun.proofBundleCount, 1);
  assert.equal(completedRun.coordinationRecordCount, 1);
  const blockedRun = runList.find((entry) => entry.wave === 2);
  assert.equal(blockedRun.status, "blocked");
  assert.equal(blockedRun.latestGate, "clarificationBarrier");

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
  assert.equal(benchmarkList.length, 3);
  const benchOne = benchmarkList.find((entry) => entry.benchmarkRunId === "bench-1");
  assert.equal(benchOne.projectId, "wave-orchestration");
  assert.equal(benchOne.status, "completed");
  assert.equal(benchOne.itemCount, 1);
  assert.equal(benchOne.reviewCount, 1);
  assert.equal(benchOne.verificationCount, 1);
  assert.equal(benchOne.adapterId, "swe-bench-pro");
  assert.equal(benchOne.manifestId, "pilot-1");
  assert.equal(benchOne.comparisonReady, false);
  const benchTwo = benchmarkList.find((entry) => entry.benchmarkRunId === "bench-2");
  assert.equal(benchTwo.status, "completed");
  assert.equal(benchTwo.itemCount, 1);
  assert.equal(benchTwo.reviewCount, 1);
  assert.equal(benchTwo.adapterId, "swe-bench-lite");
  assert.equal(benchTwo.manifestId, "pilot-2");
  assert.equal(benchTwo.comparisonReady, true);
  const benchThree = benchmarkList.find((entry) => entry.benchmarkRunId === "bench-3");
  assert.equal(benchThree.status, "completed");
  assert.equal(benchThree.itemCount, 0);
  assert.equal(benchThree.reviewCount, 0);
  assert.equal(benchThree.adapterId, "local-bench");
  assert.equal(benchThree.manifestId, "pilot-local");
  assert.equal(benchThree.comparisonReady, null);

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
  assert.equal(analyticsPayload.runCount, 2);
  assert.equal(analyticsPayload.benchmarkRunCount, 3);
  assert.equal(analyticsPayload.artifactCount, 1);
  assert.equal(analyticsPayload.verificationCount, 1);
  assert.equal(analyticsPayload.reviewCount, 2);
  assert.equal(analyticsPayload.benchmarkComparisonReadyCount, 1);
  assert.equal(analyticsPayload.benchmarkComparisonPendingCount, 1);
  assert.equal(analyticsPayload.benchmarkComparisonUnknownCount, 1);
  assert.equal(analyticsPayload.latestRunUpdatedAt, "2026-03-22T10:01:10.000Z");
  assert.equal(analyticsPayload.latestBenchmarkUpdatedAt, "2026-03-22T10:03:20.000Z");
  assert.equal(analyticsPayload.latestActivityAt, "2026-03-22T10:03:20.000Z");
  assert.deepEqual(analyticsPayload.runStatusCounts, {
    blocked: 1,
    completed: 1,
  });
  assert.deepEqual(analyticsPayload.benchmarkStatusCounts, {
    completed: 3,
  });
  assert.deepEqual(analyticsPayload.gateCounts, {
    clarificationBarrier: 1,
    pass: 1,
  });
  assert.deepEqual(analyticsPayload.reviewValidityCounts, {
    "comparison-valid": 1,
    "review-only": 1,
  });
  assert.equal(analyticsPayload.coordinationRecordCount, 1);
  assert.equal(analyticsPayload.proofBundleCount, 1);

  const scopedAnalytics = await fetch(
    `${app.baseUrl}/api/v1/analytics/overview?workspaceId=workspace-1&projectId=wave-orchestration&lane=main&wave=1&orchestratorId=main-orch-1&runtimeVersion=0.7.0`,
    { headers },
  );
  assert.equal(scopedAnalytics.status, 200);
  const scopedAnalyticsPayload = await scopedAnalytics.json();
  assert.equal(scopedAnalyticsPayload.runCount, 1);
  assert.deepEqual(scopedAnalyticsPayload.runStatusCounts, {
    completed: 1,
  });
  assert.deepEqual(scopedAnalyticsPayload.gateCounts, {
    pass: 1,
  });
  assert.equal(scopedAnalyticsPayload.coordinationRecordCount, 1);
  assert.equal(scopedAnalyticsPayload.proofBundleCount, 1);
  assert.equal(scopedAnalyticsPayload.artifactCount, 1);

  const roadmapBenchmarks = await fetch(
    `${app.baseUrl}/api/v1/benchmarks?workspaceId=workspace-1&projectId=wave-orchestration&runKind=roadmap&orchestratorId=main-orch-1&runtimeVersion=0.7.0`,
    { headers },
  );
  assert.equal(roadmapBenchmarks.status, 200);
  assert.deepEqual(await roadmapBenchmarks.json(), []);

  const roadmapAnalytics = await fetch(
    `${app.baseUrl}/api/v1/analytics/overview?workspaceId=workspace-1&projectId=wave-orchestration&runKind=roadmap&orchestratorId=main-orch-1&runtimeVersion=0.7.0`,
    { headers },
  );
  assert.equal(roadmapAnalytics.status, 200);
  const roadmapAnalyticsPayload = await roadmapAnalytics.json();
  assert.equal(roadmapAnalyticsPayload.benchmarkRunCount, 0);
  assert.deepEqual(roadmapAnalyticsPayload.benchmarkStatusCounts, {});
  assert.equal(roadmapAnalyticsPayload.benchmarkComparisonReadyCount, 0);
  assert.equal(roadmapAnalyticsPayload.benchmarkComparisonPendingCount, 0);
  assert.equal(roadmapAnalyticsPayload.benchmarkComparisonUnknownCount, 0);
  assert.deepEqual(roadmapAnalyticsPayload.reviewValidityCounts, {});

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

test("bootstrap superusers can issue and revoke Wave Control tokens", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-default") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "user-1",
        primaryEmail: "admin@example.com",
        displayName: "Admin User",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-default") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }, { id: "team-admin" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: ["team-admin"],
      bootstrapSuperuserEmails: ["admin@example.com"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const session = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-admin-default",
    },
  });
  assert.equal(session.status, 200);
  const sessionPayload = await session.json();
  assert.equal(sessionPayload.session.isSuperuser, true);
  assert.equal(sessionPayload.session.accessState, "approved");

  const createToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-default",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "CLI token" }),
  });
  assert.equal(createToken.status, 201);
  const created = await createToken.json();
  assert.match(created.token, /^wave_pat_/);
  assert.deepEqual(created.record.scopes, ["broker:read", "credential:read", "ingest:write"]);

  const broker = await fetch(`${app.baseUrl}/api/v1/providers/context7/search?query=react`, {
    headers: {
      authorization: `Bearer ${created.token}`,
    },
  });
  assert.equal(broker.status, 403);

  const revoke = await fetch(`${app.baseUrl}/api/v1/app/tokens/${created.record.id}/revoke`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-default",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assert.equal(revoke.status, 200);
  assert.equal((await revoke.json()).record.revokedAt !== null, true);
});

test("stack app routes fail closed when an email is already bound to a different Stack user", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-rebind-mismatch") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "stack-user-incoming",
        primaryEmail: "shared@example.com",
        displayName: "Incoming User",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-rebind-mismatch") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-rebind-mismatch",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
      bootstrapSuperuserEmails: [],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const existing = await seedAppUser(app, {
    stackUserId: "stack-user-bound",
    email: "shared@example.com",
    displayName: "Bound User",
    role: "member",
    accessState: "approved",
    providerGrants: ["context7"],
  });

  const session = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-rebind-mismatch",
    },
  });
  assert.equal(session.status, 403);
  assert.match((await session.json()).error, /already bound to a different Stack user/i);

  const stored = await app.store.findAppUserById(existing.id);
  assert.equal(stored.stackUserId, "stack-user-bound");
  assert.equal(stored.email, "shared@example.com");
  assert.deepEqual(stored.providerGrants, ["context7"]);
});

test("stack app routes keep the same stack user binding and refresh profile data", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-same-binding") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "stack-user-same",
        primaryEmail: "updated@example.com",
        displayName: "Updated Display Name",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-same-binding") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-same-binding",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
      bootstrapSuperuserEmails: [],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const existing = await seedAppUser(app, {
    stackUserId: "stack-user-same",
    email: "stale@example.com",
    displayName: "Stale Display Name",
    role: "member",
    accessState: "approved",
    providerGrants: ["corridor"],
  });

  const session = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-same-binding",
    },
  });
  assert.equal(session.status, 200);
  const payload = await session.json();
  assert.equal(payload.session.stackUserId, "stack-user-same");
  assert.equal(payload.session.email, "updated@example.com");
  assert.equal(payload.session.accessState, "approved");

  const stored = await app.store.findAppUserById(existing.id);
  assert.equal(stored.stackUserId, "stack-user-same");
  assert.equal(stored.email, "updated@example.com");
  assert.equal(stored.displayName, "Updated Display Name");
  assert.deepEqual(stored.providerGrants, ["corridor"]);
});

test("stack app routes can bind an existing unbound user by email", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-link-unbound") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "stack-user-linked",
        primaryEmail: "link-me@example.com",
        displayName: "Linked User",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-link-unbound") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-link-unbound",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
      bootstrapSuperuserEmails: [],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const existing = await seedAppUser(app, {
    stackUserId: null,
    email: "link-me@example.com",
    displayName: "Invited User",
    role: "member",
    accessState: "approved",
    providerGrants: ["openai"],
  });

  const session = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-link-unbound",
    },
  });
  assert.equal(session.status, 200);
  const payload = await session.json();
  assert.equal(payload.session.stackUserId, "stack-user-linked");
  assert.equal(payload.session.email, "link-me@example.com");

  const stored = await app.store.findAppUserById(existing.id);
  assert.equal(stored.stackUserId, "stack-user-linked");
  assert.equal(stored.email, "link-me@example.com");
  assert.equal(stored.displayName, "Linked User");
  assert.deepEqual(stored.providerGrants, ["openai"]);
});

test("superuser token issuance rejects unknown explicit target owners", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-targeting") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "user-11",
        primaryEmail: "admin@example.com",
        displayName: "Admin User",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-targeting") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-targeting",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
      bootstrapSuperuserEmails: ["admin@example.com"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const createToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-targeting",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      label: "Wrong target",
      ownerEmail: "missing@example.com",
    }),
  });
  assert.equal(createToken.status, 404);
  assert.match((await createToken.json()).error, /Requested token owner was not found/);
  assert.equal((await app.store.listPersonalAccessTokens({ ownerEmail: "admin@example.com" })).length, 0);
});

test("admin user routes reject invalid enums and enforce role transition grant policy", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-users") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "user-12",
        primaryEmail: "admin@example.com",
        displayName: "Admin User",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-users") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-admin-users",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
      bootstrapSuperuserEmails: ["admin@example.com"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const invalidRoleCreate = await fetch(`${app.baseUrl}/api/v1/app/admin/users`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "member-invalid-role@example.com",
      role: "super-user",
    }),
  });
  assert.equal(invalidRoleCreate.status, 400);
  assert.match((await invalidRoleCreate.json()).error, /role must be one of/i);

  const invalidStateCreate = await fetch(`${app.baseUrl}/api/v1/app/admin/users`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "member-invalid-state@example.com",
      accessState: "approvde",
    }),
  });
  assert.equal(invalidStateCreate.status, 400);
  assert.match((await invalidStateCreate.json()).error, /accessState must be one of/i);

  const existing = await seedAppUser(app, {
    email: "member-promote@example.com",
    role: "member",
    accessState: "approved",
    providerGrants: [],
  });

  const promoteExisting = await fetch(`${app.baseUrl}/api/v1/app/admin/users`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "member-promote@example.com",
      role: "superuser",
      accessState: "approved",
    }),
  });
  assert.equal(promoteExisting.status, 200);
  const promoted = await promoteExisting.json();
  assert.deepEqual(
    promoted.user.providerGrants,
    buildDefaultProviderGrants("superuser"),
  );

  const demoteExisting = await fetch(`${app.baseUrl}/api/v1/app/admin/users`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "member-promote@example.com",
      role: "member",
      accessState: "approved",
    }),
  });
  assert.equal(demoteExisting.status, 200);
  assert.deepEqual((await demoteExisting.json()).user.providerGrants, []);

  const explicitMemberGrant = await fetch(`${app.baseUrl}/api/v1/app/admin/users`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "member-promote@example.com",
      role: "member",
      accessState: "approved",
      providerGrants: ["context7"],
    }),
  });
  assert.equal(explicitMemberGrant.status, 200);
  assert.deepEqual((await explicitMemberGrant.json()).user.providerGrants, ["context7"]);

  const invalidStateUpdate = await fetch(`${app.baseUrl}/api/v1/app/admin/users/${existing.id}/state`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({ accessState: "approvde" }),
  });
  assert.equal(invalidStateUpdate.status, 400);
  assert.match((await invalidStateUpdate.json()).error, /accessState must be one of/i);

  const invalidRoleUpdate = await fetch(`${app.baseUrl}/api/v1/app/admin/users/${existing.id}/role`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "super-user" }),
  });
  assert.equal(invalidRoleUpdate.status, 400);
  assert.match((await invalidRoleUpdate.json()).error, /role must be one of/i);

  const promoteRoleUpdate = await fetch(`${app.baseUrl}/api/v1/app/admin/users/${existing.id}/role`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "superuser" }),
  });
  assert.equal(promoteRoleUpdate.status, 200);
  assert.deepEqual(
    (await promoteRoleUpdate.json()).user.providerGrants,
    buildDefaultProviderGrants("superuser"),
  );

  const demoteRoleUpdate = await fetch(`${app.baseUrl}/api/v1/app/admin/users/${existing.id}/role`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-users",
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "member" }),
  });
  assert.equal(demoteRoleUpdate.status, 200);
  assert.deepEqual((await demoteRoleUpdate.json()).user.providerGrants, []);
});

test("approved members can self-issue PATs and provider grants gate broker routes", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-member-scoped") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "user-3",
        primaryEmail: "member-scoped@example.com",
        displayName: "Scoped Member",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-member-scoped") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
    other: (url, options, originalFetch) => {
      const normalized = String(url);
      if (normalized.includes("context7.com/api/v2/libs/search")) {
        return stackJsonResponse([{ id: "lib-1", name: "react" }]);
      }
      return originalFetch(url, options);
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-scoped",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
    },
    broker: {
      ownedDeployment: true,
      context7Enabled: true,
      context7ApiKey: "ctx-token",
      corridorEnabled: false,
      corridorApiToken: "",
      corridorProjectMap: {},
    },
  });
  t.after(async () => {
    await app.close();
  });

  const memberRecord = await seedAppUser(app, {
    stackUserId: "user-3",
    email: "member-scoped@example.com",
    displayName: "Scoped Member",
    role: "member",
    accessState: "approved",
    providerGrants: [],
  });

  const createScopedToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-member-scoped",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      label: "Broker-only token",
      scopes: ["broker:read"],
    }),
  });
  assert.equal(createScopedToken.status, 201);
  const scopedToken = await createScopedToken.json();
  assert.deepEqual(scopedToken.record.scopes, ["broker:read"]);

  const brokerDenied = await fetch(
    `${app.baseUrl}/api/v1/providers/context7/search?libraryName=react&query=react`,
    {
      headers: {
        authorization: `Bearer ${scopedToken.token}`,
      },
    },
  );
  assert.equal(brokerDenied.status, 403);

  await app.store.updateAppUser(memberRecord.id, {
    ...memberRecord,
    providerGrants: ["context7"],
    updatedAt: new Date().toISOString(),
  });

  const brokerAllowed = await fetch(
    `${app.baseUrl}/api/v1/providers/context7/search?libraryName=react&query=react`,
    {
      headers: {
        authorization: `Bearer ${scopedToken.token}`,
      },
    },
  );
  assert.equal(brokerAllowed.status, 200);

  await app.store.updateAppUser(memberRecord.id, {
    ...memberRecord,
    providerGrants: [],
    updatedAt: new Date().toISOString(),
  });

  const brokerRevoked = await fetch(
    `${app.baseUrl}/api/v1/providers/context7/search?libraryName=react&query=react`,
    {
      headers: {
        authorization: `Bearer ${scopedToken.token}`,
      },
    },
  );
  assert.equal(brokerRevoked.status, 403);

  const wildcardToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-member-scoped",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "Wildcard token", scopes: ["*"] }),
  });
  assert.equal(wildcardToken.status, 400);
  assert.match((await wildcardToken.json()).error, /Unsupported token scopes/);
});

test("pat ownership, listing, and revoke are stack-user-id scoped instead of email scoped", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-pat-owner-scope") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "stack-user-owner-scope",
        primaryEmail: "owner-scope@example.com",
        displayName: "Owner Scope",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-pat-owner-scope") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-pat-owner-scope",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
    },
  });
  t.after(async () => {
    await app.close();
  });

  await seedAppUser(app, {
    stackUserId: "stack-user-owner-scope",
    email: "owner-scope@example.com",
    role: "member",
    accessState: "approved",
    providerGrants: ["context7"],
  });

  const currentToken = await seedPersonalAccessToken(app, {
    label: "Current token",
    scopes: ["broker:read"],
    owner: {
      stackUserId: "stack-user-owner-scope",
      email: "owner-scope@example.com",
    },
  });
  const legacyEmailOnlyToken = await seedPersonalAccessToken(app, {
    label: "Legacy email token",
    scopes: ["broker:read"],
    owner: {
      email: "owner-scope@example.com",
    },
  });
  const mismatchedOwnerToken = await seedPersonalAccessToken(app, {
    label: "Mismatched owner token",
    scopes: ["broker:read"],
    owner: {
      stackUserId: "stack-user-old-owner",
      email: "owner-scope@example.com",
    },
  });

  const listed = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    headers: {
      "x-stack-access-token": "stack-token-pat-owner-scope",
    },
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (await listed.json()).items.map((item) => item.id),
    [currentToken.record.id],
  );

  const revokeLegacy = await fetch(`${app.baseUrl}/api/v1/app/tokens/${legacyEmailOnlyToken.record.id}/revoke`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-pat-owner-scope",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assert.equal(revokeLegacy.status, 403);
  assert.match((await revokeLegacy.json()).error, /Only the token owner or a Wave Control superuser/i);

  const revokeMismatched = await fetch(`${app.baseUrl}/api/v1/app/tokens/${mismatchedOwnerToken.record.id}/revoke`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-pat-owner-scope",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assert.equal(revokeMismatched.status, 403);
  assert.match((await revokeMismatched.json()).error, /Only the token owner or a Wave Control superuser/i);

  const legacyPatAuth = await fetch(`${app.baseUrl}/api/v1/providers/context7/search?query=react`, {
    headers: {
      authorization: `Bearer ${legacyEmailOnlyToken.token}`,
    },
  });
  assert.equal(legacyPatAuth.status, 403);
  assert.match((await legacyPatAuth.json()).error, /not bound to a Stack user/i);
});

test("signed-in internal users can request access before they are approved", async (t) => {
  installStackFetchMock(t, {
    me: () =>
      stackJsonResponse({
        id: "user-2",
        primaryEmail: "member@example.com",
      }),
    teams: () =>
      stackJsonResponse({
        items: [{ id: "team-internal" }],
      }),
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: ["team-admin"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const session = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-member",
    },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).session.accessState, "none");

  const createRequest = await fetch(`${app.baseUrl}/api/v1/app/access-request`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-member",
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason: "Need operator access for repo runtime support." }),
  });
  assert.equal(createRequest.status, 200);
  const requestPayload = await createRequest.json();
  assert.equal(requestPayload.session.accessState, "pending");
  assert.equal(requestPayload.session.accessRequestReason, "Need operator access for repo runtime support.");

  const overview = await fetch(`${app.baseUrl}/api/v1/app/overview`, {
    headers: {
      "x-stack-access-token": "stack-token-member",
    },
  });
  assert.equal(overview.status, 403);
});

test("runtime provider env leasing returns only granted env providers", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-superuser") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "user-10",
        primaryEmail: "admin@example.com",
        displayName: "Admin User",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-superuser") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-lease",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
      bootstrapSuperuserEmails: ["admin@example.com"],
    },
    broker: {
      ownedDeployment: true,
      context7Enabled: false,
      context7ApiKey: "",
      corridorEnabled: false,
      corridorApiToken: "",
      openaiEnabled: true,
      openaiApiKey: "openai-test-key",
      anthropicEnabled: true,
      anthropicApiKey: "anthropic-test-key",
      corridorProjectMap: {},
    },
  });
  t.after(async () => {
    await app.close();
  });

  await seedAppUser(app, {
    stackUserId: "member-openai-stack",
    email: "member-openai@example.com",
    role: "member",
    accessState: "approved",
    providerGrants: ["openai"],
  });

  const createToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-superuser",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "Lease token", ownerEmail: "member-openai@example.com" }),
  });
  assert.equal(createToken.status, 201);
  const created = await createToken.json();
  assert.deepEqual(created.record.scopes, ["broker:read", "credential:read", "ingest:write"]);

  const runtimeEnv = await fetch(`${app.baseUrl}/api/v1/runtime/provider-env`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${created.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ providers: ["openai"] }),
  });
  assert.equal(runtimeEnv.status, 200);
  assert.deepEqual((await runtimeEnv.json()).env, {
    OPENAI_API_KEY: "openai-test-key",
  });

  const deniedEnv = await fetch(`${app.baseUrl}/api/v1/runtime/provider-env`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${created.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ providers: ["anthropic"] }),
  });
  assert.equal(deniedEnv.status, 403);
});

test("pat issuance fails for approved users without a bound stack account", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-superuser-unbound-owner") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "user-10b",
        primaryEmail: "admin@example.com",
        displayName: "Admin User",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-superuser-unbound-owner") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-unbound-owner",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
      bootstrapSuperuserEmails: ["admin@example.com"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const unboundUser = await seedAppUser(app, {
    email: "unbound-owner@example.com",
    role: "member",
    accessState: "approved",
    providerGrants: ["openai"],
  });

  const appToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-superuser-unbound-owner",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "Unbound owner token", ownerEmail: "unbound-owner@example.com" }),
  });
  assert.equal(appToken.status, 409);
  assert.match((await appToken.json()).error, /bound Stack account/i);

  const serviceApp = await listen({
    auth: {
      tokens: [],
      serviceTokens: [
        {
          label: "ops-bot",
          token: "service-token-unbound-owner",
          scopes: ["service:token:write"],
        },
      ],
      requireAuthForReads: true,
    },
  });
  t.after(async () => {
    await serviceApp.close();
  });
  await serviceApp.store.createAppUser(unboundUser);

  const serviceToken = await fetch(`${serviceApp.baseUrl}/api/v1/service/users/${unboundUser.id}/tokens`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token-unbound-owner",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "Unbound service owner token" }),
  });
  assert.equal(serviceToken.status, 409);
  assert.match((await serviceToken.json()).error, /bound Stack account/i);
});

test("stack auth ignores non-membership team-shaped user payload fields", async (t) => {
  installStackFetchMock(t, {
    me: () =>
      stackJsonResponse({
        id: "user-6",
        primaryEmail: "selected@example.com",
        selectedTeam: { id: "team-internal" },
        selected_team: { id: "team-admin" },
        invitation: { teamId: "team-internal" },
        teamIds: ["team-admin"],
      }),
    teams: () =>
      stackJsonResponse({
        items: [{ id: "team-external" }],
      }),
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-selected-team",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: ["team-admin"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const session = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-selected-team",
    },
  });
  assert.equal(session.status, 403);
  assert.match((await session.json()).error, /allowed internal team/);
});

test("stack app routes fail closed when the internal-team allowlist is missing", async (t) => {
  const stackFetches = installStackFetchMock(t, {
    me: () =>
      stackJsonResponse({
        id: "user-4",
        primaryEmail: "misconfig@example.com",
      }),
    teams: () =>
      stackJsonResponse({
        items: [{ id: "team-internal" }],
      }),
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-misconfig",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: [],
      adminTeamIds: ["team-admin"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const response = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-misconfig",
    },
  });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS/);
  assert.equal(stackFetches.me, 0);
  assert.equal(stackFetches.teams, 0);
});

test("stack app routes surface team membership lookup failures", async (t) => {
  installStackFetchMock(t, {
    me: () =>
      stackJsonResponse({
        id: "user-7",
        primaryEmail: "broken-teams@example.com",
      }),
    teams: () => stackJsonResponse({ error: "upstream failure" }, 500),
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-broken-teams",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: ["team-admin"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const response = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-broken-teams",
    },
  });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /team membership lookup/i);
});

test("stack app routes fail fast when Stack user verification times out", async (t) => {
  installStackFetchMock(t, {
    me: async () => {
      throw timeoutError("Stack users/me timed out");
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-timeout",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: ["team-admin"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const response = await fetch(`${app.baseUrl}/api/v1/app/session`, {
    headers: {
      "x-stack-access-token": "stack-token-timeout",
    },
  });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /user verification timed out/i);
});

test("concurrent app reads reuse one Stack user verification per access token", async (t) => {
  const stackFetches = installStackFetchMock(t, {
    me: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return stackJsonResponse({
        id: "user-5",
        primaryEmail: "fanout@example.com",
      });
    },
    teams: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-fanout",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: ["team-admin"],
      bootstrapSuperuserEmails: ["fanout@example.com"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const headers = {
    "x-stack-access-token": "stack-token-fanout",
  };
  const responses = await Promise.all([
    fetch(`${app.baseUrl}/api/v1/app/me`, { headers }),
    fetch(`${app.baseUrl}/api/v1/app/overview`, { headers }),
    fetch(`${app.baseUrl}/api/v1/app/runs`, { headers }),
    fetch(`${app.baseUrl}/api/v1/app/benchmarks`, { headers }),
    fetch(`${app.baseUrl}/api/v1/app/tokens`, { headers }),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200);
  }
  assert.equal(stackFetches.me, 1);
  assert.equal(stackFetches.teams, 1);
});

test("service routes require a dedicated service token principal", async (t) => {
  const app = await listen({
    auth: {
      tokens: ["test-token"],
      serviceTokens: [
        {
          label: "ops-bot",
          token: "service-token",
          scopes: ["service:read"],
        },
      ],
      requireAuthForReads: true,
    },
  });
  t.after(async () => {
    await app.close();
  });

  const serviceSession = await fetch(`${app.baseUrl}/api/v1/service/session`, {
    headers: {
      authorization: "Bearer service-token",
    },
  });
  assert.equal(serviceSession.status, 200);
  assert.deepEqual((await serviceSession.json()).serviceToken, {
    label: "ops-bot",
    scopes: ["service:read"],
  });

  const envTokenDenied = await fetch(`${app.baseUrl}/api/v1/service/session`, {
    headers: {
      authorization: "Bearer test-token",
    },
  });
  assert.equal(envTokenDenied.status, 403);
  assert.match((await envTokenDenied.json()).error, /service token/i);
});

test("service tokens can manage users, credentials, and PATs while runtime leases stay user-owned", async (t) => {
  const app = await listen({
    auth: {
      tokens: [],
      serviceTokens: [
        {
          label: "ops-bot",
          token: "service-token",
          scopes: [
            "service:read",
            "service:user:write",
            "service:credential:write",
            "service:token:write",
          ],
        },
      ],
      requireAuthForReads: true,
    },
    secrets: {
      encryptionKey: TEST_ENCRYPTION_KEY,
    },
  });
  t.after(async () => {
    await app.close();
  });

  const createUser = await fetch(`${app.baseUrl}/api/v1/service/users`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "service-managed@example.com",
      role: "member",
      accessState: "approved",
    }),
  });
  assert.equal(createUser.status, 201);
  const createdUser = (await createUser.json()).user;

  const storeCredential = await fetch(
    `${app.baseUrl}/api/v1/service/users/${createdUser.id}/credentials/github_pat`,
    {
      method: "PUT",
      headers: {
        authorization: "Bearer service-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ value: "ghp_example_secret" }),
    },
  );
  assert.equal(storeCredential.status, 200);
  const storedCredential = (await storeCredential.json()).credential;
  assert.equal(storedCredential.credentialId, "github_pat");
  assert.equal("ciphertext" in storedCredential, false);

  const listCredentials = await fetch(`${app.baseUrl}/api/v1/service/users/${createdUser.id}/credentials`, {
    headers: {
      authorization: "Bearer service-token",
    },
  });
  assert.equal(listCredentials.status, 200);
  const credentialItems = (await listCredentials.json()).items;
  assert.equal(credentialItems.length, 1);
  assert.equal(credentialItems[0].credentialId, "github_pat");
  assert.equal("value" in credentialItems[0], false);

  const createUnboundPat = await fetch(`${app.baseUrl}/api/v1/service/users/${createdUser.id}/tokens`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      label: "Runtime credential lease token",
      scopes: ["credential:read"],
    }),
  });
  assert.equal(createUnboundPat.status, 409);
  assert.match((await createUnboundPat.json()).error, /bound Stack account/i);

  const boundUser = await seedAppUser(app, {
    stackUserId: "service-managed-stack-user",
    email: "service-managed-bound@example.com",
    role: "member",
    accessState: "approved",
    providerGrants: [],
  });

  const storeBoundCredential = await fetch(
    `${app.baseUrl}/api/v1/service/users/${boundUser.id}/credentials/github_pat`,
    {
      method: "PUT",
      headers: {
        authorization: "Bearer service-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ value: "ghp_bound_secret" }),
    },
  );
  assert.equal(storeBoundCredential.status, 200);

  const createPat = await fetch(`${app.baseUrl}/api/v1/service/users/${boundUser.id}/tokens`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      label: "Runtime credential lease token",
      scopes: ["credential:read"],
    }),
  });
  assert.equal(createPat.status, 201);
  const patPayload = await createPat.json();
  assert.deepEqual(patPayload.record.scopes, ["credential:read"]);

  const leaseWithPat = await fetch(`${app.baseUrl}/api/v1/runtime/credential-env`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${patPayload.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      credentials: [{ id: "github_pat", envVar: "GITHUB_TOKEN" }],
    }),
  });
  assert.equal(leaseWithPat.status, 200);
  assert.deepEqual((await leaseWithPat.json()).env, {
    GITHUB_TOKEN: "ghp_bound_secret",
  });

  const leaseWithServiceToken = await fetch(`${app.baseUrl}/api/v1/runtime/credential-env`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      credentials: [{ id: "github_pat", envVar: "GITHUB_TOKEN" }],
    }),
  });
  assert.equal(leaseWithServiceToken.status, 403);
  assert.match((await leaseWithServiceToken.json()).error, /missing required scopes/i);

  const revokePat = await fetch(`${app.baseUrl}/api/v1/service/tokens/${patPayload.record.id}/revoke`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assert.equal(revokePat.status, 200);
  assert.equal((await revokePat.json()).record.revokedAt !== null, true);
});

test("service admin routes apply the same role transition grant policy", async (t) => {
  const app = await listen({
    auth: {
      tokens: [],
      serviceTokens: [
        {
          label: "ops-bot",
          token: "service-token",
          scopes: ["service:read", "service:user:write"],
        },
      ],
      requireAuthForReads: true,
    },
  });
  t.after(async () => {
    await app.close();
  });

  const createUser = await fetch(`${app.baseUrl}/api/v1/service/users`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "service-role-policy@example.com",
      role: "member",
      accessState: "approved",
    }),
  });
  assert.equal(createUser.status, 201);
  const createdUser = (await createUser.json()).user;
  assert.deepEqual(createdUser.providerGrants, []);

  const promoteUser = await fetch(`${app.baseUrl}/api/v1/service/users/${createdUser.id}/role`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "superuser" }),
  });
  assert.equal(promoteUser.status, 200);
  assert.deepEqual(
    (await promoteUser.json()).user.providerGrants,
    buildDefaultProviderGrants("superuser"),
  );

  const demoteUser = await fetch(`${app.baseUrl}/api/v1/service/users/${createdUser.id}/role`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "member" }),
  });
  assert.equal(demoteUser.status, 200);
  assert.deepEqual((await demoteUser.json()).user.providerGrants, []);

  const explicitMemberGrant = await fetch(`${app.baseUrl}/api/v1/service/users`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "service-role-policy@example.com",
      role: "member",
      accessState: "approved",
      providerGrants: ["anthropic"],
    }),
  });
  assert.equal(explicitMemberGrant.status, 200);
  assert.deepEqual((await explicitMemberGrant.json()).user.providerGrants, ["anthropic"]);
});

test("credential admin routes fail closed when the encryption key is missing", async (t) => {
  const app = await listen({
    auth: {
      tokens: [],
      serviceTokens: [
        {
          label: "ops-bot",
          token: "service-token",
          scopes: ["service:user:write", "service:credential:write"],
        },
      ],
      requireAuthForReads: true,
    },
  });
  t.after(async () => {
    await app.close();
  });

  const createUser = await fetch(`${app.baseUrl}/api/v1/service/users`, {
    method: "POST",
    headers: {
      authorization: "Bearer service-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "missing-key@example.com",
      role: "member",
      accessState: "approved",
    }),
  });
  assert.equal(createUser.status, 201);
  const createdUser = (await createUser.json()).user;

  const storeCredential = await fetch(
    `${app.baseUrl}/api/v1/service/users/${createdUser.id}/credentials/npm_token`,
    {
      method: "PUT",
      headers: {
        authorization: "Bearer service-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ value: "npm-secret" }),
    },
  );
  assert.equal(storeCredential.status, 500);
  assert.match((await storeCredential.json()).error, /WAVE_CONTROL_SECRET_ENCRYPTION_KEY/);
});

test("app superusers can manage user credentials through app admin routes", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-creds") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "user-admin-creds",
        primaryEmail: "admin@example.com",
        displayName: "Admin User",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-creds") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }],
      });
    },
  });

  const app = await listen({
    auth: {
      tokens: [],
      requireAuthForReads: true,
    },
    secrets: {
      encryptionKey: TEST_ENCRYPTION_KEY,
    },
    stack: {
      enabled: true,
      projectId: "stack-project-admin-creds",
      publishableClientKey: "pk_test",
      secretServerKey: "ss_test",
      internalTeamIds: ["team-internal"],
      adminTeamIds: [],
      bootstrapSuperuserEmails: ["admin@example.com"],
    },
  });
  t.after(async () => {
    await app.close();
  });

  const targetUser = await seedAppUser(app, {
    email: "browser-managed@example.com",
    role: "member",
    accessState: "approved",
  });

  const storeCredential = await fetch(
    `${app.baseUrl}/api/v1/app/admin/users/${targetUser.id}/credentials/openai_key`,
    {
      method: "PUT",
      headers: {
        "x-stack-access-token": "stack-token-admin-creds",
        "content-type": "application/json",
      },
      body: JSON.stringify({ value: "sk-browser-secret" }),
    },
  );
  assert.equal(storeCredential.status, 200);
  assert.equal((await storeCredential.json()).credential.credentialId, "openai_key");

  const listCredentials = await fetch(`${app.baseUrl}/api/v1/app/admin/users/${targetUser.id}/credentials`, {
    headers: {
      "x-stack-access-token": "stack-token-admin-creds",
    },
  });
  assert.equal(listCredentials.status, 200);
  const items = (await listCredentials.json()).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].credentialId, "openai_key");
  assert.equal("value" in items[0], false);

  const deleteCredential = await fetch(
    `${app.baseUrl}/api/v1/app/admin/users/${targetUser.id}/credentials/openai_key`,
    {
      method: "DELETE",
      headers: {
        "x-stack-access-token": "stack-token-admin-creds",
      },
    },
  );
  assert.equal(deleteCredential.status, 200);
  assert.equal((await deleteCredential.json()).credential.credentialId, "openai_key");
});
