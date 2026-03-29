import assert from "node:assert/strict";
import test from "node:test";
import { createWaveControlServer } from "../src/server.mjs";

const STACK_ME_URL = "https://api.stack-auth.com/api/v1/users/me";
const STACK_TEAMS_URL = "https://api.stack-auth.com/api/v1/teams?user_id=me";

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
    },
    broker: {
      ownedDeployment: false,
      context7Enabled: false,
      context7ApiKey: "",
      corridorEnabled: false,
      corridorApiToken: "",
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

function stackJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  assert.equal(payload.blocking, true);
  assert.equal(payload.blockingFindings.length, 1);
  assert.equal(payload.blockingFindings[0].id, "f1");
  assert.equal(payload.guardrails.length, 1);
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

test("stack-authenticated internal admins can issue and revoke Wave Control tokens", async (t) => {
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
    },
  });
  t.after(async () => {
    await app.close();
  });

  const me = await fetch(`${app.baseUrl}/api/v1/app/me`, {
    headers: {
      "x-stack-access-token": "stack-token-admin-default",
    },
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.isAdmin, true);

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
  assert.deepEqual(created.record.scopes, ["broker:read", "ingest:write"]);

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

test("stack-authenticated admins can issue scoped PATs and reject unsupported scopes", async (t) => {
  installStackFetchMock(t, {
    me: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-scoped") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        id: "user-3",
        primaryEmail: "scope-admin@example.com",
        displayName: "Scope Admin",
      });
    },
    teams: (options) => {
      if (options?.headers?.["x-stack-access-token"] !== "stack-token-admin-scoped") {
        return stackJsonResponse({ error: "unauthorized" }, 401);
      }
      return stackJsonResponse({
        items: [{ id: "team-internal" }, { id: "team-admin" }],
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
      adminTeamIds: ["team-admin"],
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

  const createScopedToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-scoped",
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

  const brokerRead = await fetch(
    `${app.baseUrl}/api/v1/providers/context7/search?libraryName=react&query=react`,
    {
      headers: {
        authorization: `Bearer ${scopedToken.token}`,
      },
    },
  );
  assert.equal(brokerRead.status, 200);

  const ingestWrite = await fetch(`${app.baseUrl}/api/v1/ingest/batches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${scopedToken.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(ingestWrite.status, 403);

  const wildcardToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-scoped",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "Wildcard token", scopes: ["*"] }),
  });
  assert.equal(wildcardToken.status, 400);
  assert.match((await wildcardToken.json()).error, /Unsupported token scopes/);

  const unknownScopeToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-admin-scoped",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "Unknown scope token", scopes: ["broker:read", "deploy:write"] }),
  });
  assert.equal(unknownScopeToken.status, 400);
  assert.match((await unknownScopeToken.json()).error, /deploy:write/);
});

test("stack-authenticated non-admin internal users can read app routes but cannot issue tokens", async (t) => {
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

  const overview = await fetch(`${app.baseUrl}/api/v1/app/overview`, {
    headers: {
      "x-stack-access-token": "stack-token-member",
    },
  });
  assert.equal(overview.status, 200);

  const createToken = await fetch(`${app.baseUrl}/api/v1/app/tokens`, {
    method: "POST",
    headers: {
      "x-stack-access-token": "stack-token-member",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label: "Should fail" }),
  });
  assert.equal(createToken.status, 403);
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

  const me = await fetch(`${app.baseUrl}/api/v1/app/me`, {
    headers: {
      "x-stack-access-token": "stack-token-selected-team",
    },
  });
  assert.equal(me.status, 403);
  assert.match((await me.json()).error, /allowed internal team/);
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

  const response = await fetch(`${app.baseUrl}/api/v1/app/me`, {
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

  const response = await fetch(`${app.baseUrl}/api/v1/app/me`, {
    headers: {
      "x-stack-access-token": "stack-token-broken-teams",
    },
  });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /team membership lookup/i);
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
