import http from "node:http";
import { loadWaveControlServiceConfig } from "./config.mjs";
import { requireAuthorization } from "./auth.mjs";
import {
  createPersonalAccessToken,
  listInvalidPersonalAccessTokenScopes,
  normalizePersonalAccessTokenScopes,
  sanitizePersonalAccessTokenRecord,
} from "./personal-access-tokens.mjs";
import { createWaveControlStore } from "./store.mjs";
import { renderWaveControlUi } from "./ui.mjs";

const CONTEXT7_SEARCH_URL = "https://context7.com/api/v2/libs/search";
const CONTEXT7_CONTEXT_URL = "https://context7.com/api/v2/context";
const CORRIDOR_BASE_URL = "https://app.corridor.dev/api";
const CORRIDOR_SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
const DEFAULT_APP_TOKEN_SCOPES = ["broker:read", "ingest:write"];

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function setCorsHeaders(req, res, config) {
  const origin = String(req.headers.origin || "").trim();
  const allowedOrigins = new Set(config.cors?.allowedOrigins || []);
  if (origin && (allowedOrigins.has(origin) || allowedOrigins.has("*"))) {
    res.setHeader("access-control-allow-origin", allowedOrigins.has("*") ? "*" : origin);
    res.setHeader("access-control-allow-headers", "authorization, content-type, x-stack-access-token");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("vary", "Origin");
  }
}

async function readResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseJsonOrEmpty(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function requireBrokerEnabled(config, provider) {
  if (!config?.broker?.ownedDeployment) {
    const error = new Error("Provider broker routes are only available on owned Wave Control deployments.");
    error.statusCode = 403;
    throw error;
  }
  if (provider === "context7" && (!config.broker.context7Enabled || !config.broker.context7ApiKey)) {
    const error = new Error("Context7 broker is not configured on this Wave Control deployment.");
    error.statusCode = 403;
    throw error;
  }
  if (provider === "corridor" && (!config.broker.corridorEnabled || !config.broker.corridorApiToken)) {
    const error = new Error("Corridor broker is not configured on this Wave Control deployment.");
    error.statusCode = 403;
    throw error;
  }
}

async function fetchBrokerResponse(url, token, config, { accept = "application/json", method = "GET" } = {}) {
  const attempts = Math.max(1, Number(config.broker?.maxRetries || 0) + 1);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept,
        },
        signal: AbortSignal.timeout(Math.max(1000, Number(config.broker?.requestTimeoutMs || 10000))),
      });
      if (response.ok) {
        return response;
      }
      const text = await response.text();
      const payload = parseJsonOrEmpty(text);
      const error = new Error(
        `Broker upstream request failed (${response.status}): ${payload?.error || payload?.message || text.slice(0, 240) || response.statusText || "unknown error"}`,
      );
      error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
      if (attempt >= attempts || ![408, 429, 500, 502, 503, 504].includes(response.status)) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        throw error;
      }
    }
  }
  throw lastError || new Error("Broker upstream request failed.");
}

async function fetchBrokerJson(url, token, config) {
  const response = await fetchBrokerResponse(url, token, config, { accept: "application/json" });
  return response.json();
}

async function fetchBrokerText(url, token, config) {
  const response = await fetchBrokerResponse(url, token, config, {
    accept: "text/plain, application/json",
  });
  return response.text();
}

function normalizeOwnedPath(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

function isCorridorRelevantOwnedPath(value) {
  const normalized = normalizeOwnedPath(value);
  if (!normalized || normalized.startsWith(".tmp/")) {
    return false;
  }
  if (normalized.startsWith("docs/")) {
    return false;
  }
  return !/\.(?:md|txt)$/i.test(normalized);
}

function findingMatchesOwnedPath(findingPath, ownedPath) {
  const normalizedFinding = normalizeOwnedPath(findingPath);
  const normalizedOwned = normalizeOwnedPath(ownedPath);
  if (!normalizedFinding || !normalizedOwned) {
    return false;
  }
  return normalizedFinding === normalizedOwned || normalizedFinding.startsWith(`${normalizedOwned}/`);
}

function summarizeCorridorContext({ findings, guardrails, ownedPaths, severityThreshold, project }) {
  const relevantOwnedPaths = (Array.isArray(ownedPaths) ? ownedPaths : []).filter(isCorridorRelevantOwnedPath);
  const thresholdRank = CORRIDOR_SEVERITY_RANK[String(severityThreshold || "critical").toLowerCase()] || 4;
  const matchedFindings = (Array.isArray(findings) ? findings : [])
    .map((finding) => {
      const matches = relevantOwnedPaths.filter((ownedPath) =>
        findingMatchesOwnedPath(finding.affectedFile, ownedPath),
      );
      return matches.length > 0 ? { ...finding, matchedOwnedPaths: matches } : null;
    })
    .filter(Boolean);
  const blockingFindings = matchedFindings.filter((finding) => {
    const rank = CORRIDOR_SEVERITY_RANK[String(finding.severity || "").toLowerCase()] || 0;
    return rank >= thresholdRank;
  });
  return {
    schemaVersion: 1,
    source: "broker",
    fetchedAt: new Date().toISOString(),
    project,
    relevantOwnedPaths,
    severityThreshold,
    guardrails: Array.isArray(guardrails?.reports) ? guardrails.reports : [],
    matchedFindings,
    blockingFindings,
    blocking: blockingFindings.length > 0,
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) {
    return {};
  }
  return JSON.parse(body);
}

function buildAppOverview(analytics, runs, benchmarks) {
  return {
    overview: analytics,
    recentRuns: runs.slice(0, 10),
    recentBenchmarks: benchmarks.slice(0, 10),
  };
}

function defaultTokenScopes(scopes) {
  if (scopes !== undefined && scopes !== null && !Array.isArray(scopes)) {
    const error = new Error("Token scopes must be an array of strings.");
    error.statusCode = 400;
    throw error;
  }
  const requestedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : DEFAULT_APP_TOKEN_SCOPES;
  const invalidScopes = listInvalidPersonalAccessTokenScopes(requestedScopes);
  if (invalidScopes.length > 0) {
    const error = new Error(
      `Unsupported token scopes: ${invalidScopes.join(", ")}. Allowed scopes: ${DEFAULT_APP_TOKEN_SCOPES.join(", ")}.`,
    );
    error.statusCode = 400;
    throw error;
  }
  const normalized = normalizePersonalAccessTokenScopes(requestedScopes);
  return normalized.length > 0 ? normalized : [...DEFAULT_APP_TOKEN_SCOPES];
}

function requireStackPrincipal(principal) {
  if (!principal || principal.type !== "stack-user") {
    const error = new Error("This route requires a Stack-authenticated internal user.");
    error.statusCode = 403;
    throw error;
  }
}

function requireStackAdmin(principal) {
  requireStackPrincipal(principal);
  if (!principal.isAdmin) {
    const error = new Error("This route requires Stack admin-team membership.");
    error.statusCode = 403;
    throw error;
  }
}

async function listCorridorFindings(config, projectId, token, findingStates) {
  const findings = [];
  const seenPages = new Set();
  for (const state of findingStates) {
    let page = 1;
    let nextUrl = new URL(`${CORRIDOR_BASE_URL}/projects/${projectId}/findings`);
    nextUrl.searchParams.set("state", String(state));
    while (nextUrl && page <= Math.max(1, Number(config.broker?.maxPages || 10))) {
      const dedupeKey = nextUrl.toString();
      if (seenPages.has(dedupeKey)) {
        break;
      }
      seenPages.add(dedupeKey);
      const payload = await fetchBrokerJson(nextUrl, token, config);
      if (Array.isArray(payload)) {
        findings.push(...payload);
        break;
      }
      const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.findings)
          ? payload.findings
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      findings.push(...items);
      if (payload?.nextPageUrl) {
        nextUrl = new URL(payload.nextPageUrl);
      } else if (payload?.nextCursor) {
        nextUrl = new URL(`${CORRIDOR_BASE_URL}/projects/${projectId}/findings`);
        nextUrl.searchParams.set("state", String(state));
        nextUrl.searchParams.set("cursor", String(payload.nextCursor));
      } else if (payload?.page && payload?.totalPages && Number(payload.page) < Number(payload.totalPages)) {
        nextUrl = new URL(`${CORRIDOR_BASE_URL}/projects/${projectId}/findings`);
        nextUrl.searchParams.set("state", String(state));
        nextUrl.searchParams.set("page", String(Number(payload.page) + 1));
      } else {
        nextUrl = null;
      }
      page += 1;
    }
  }
  return findings;
}

function queryFilters(url) {
  return {
    workspaceId: url.searchParams.get("workspaceId") || undefined,
    projectId: url.searchParams.get("projectId") || undefined,
    runKind: url.searchParams.get("runKind") || undefined,
    runId: url.searchParams.get("runId") || undefined,
    lane: url.searchParams.get("lane") || undefined,
    wave:
      url.searchParams.get("wave") === null ? undefined : Number(url.searchParams.get("wave")),
    orchestratorId: url.searchParams.get("orchestratorId") || undefined,
    runtimeVersion: url.searchParams.get("runtimeVersion") || undefined,
    benchmarkRunId: url.searchParams.get("benchmarkRunId") || undefined,
  };
}

function validateBatch(config, batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    const error = new Error("Batch body must be an object");
    error.statusCode = 400;
    throw error;
  }
  const events = Array.isArray(batch.events) ? batch.events : null;
  if (!events) {
    const error = new Error("Batch body must include an events array");
    error.statusCode = 400;
    throw error;
  }
  if (events.length > config.ingest.maxBatchEvents) {
    const error = new Error(`Batch exceeds max events (${config.ingest.maxBatchEvents})`);
    error.statusCode = 400;
    throw error;
  }
  for (const event of events) {
    for (const upload of event.artifactUploads || []) {
      const bytes = Buffer.byteLength(String(upload.content || ""), "utf8");
      if (bytes > config.ingest.maxInlineArtifactBytes * 1.4) {
        const error = new Error(
          `Inline artifact exceeds limit (${config.ingest.maxInlineArtifactBytes} bytes)`,
        );
        error.statusCode = 400;
        throw error;
      }
    }
  }
}

async function handleApiRequest(req, res, url, context) {
  const { config, store } = context;

  if (req.method === "GET" && url.pathname === "/api/v1/health") {
    sendJson(res, 200, {
      ok: true,
      service: "wave-control",
      store: store.constructor.name,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/ingest/batches") {
    await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["ingest:write"],
    });
    const batch = await readJsonBody(req);
    validateBatch(config, batch);
    const result = await store.ingestBatch(batch);
    sendJson(res, 200, {
      ok: true,
      ...result,
      received: batch.events.length,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/runs") {
    await requireAuthorization(req, config, store, { mode: "read" });
    sendJson(res, 200, await store.listRuns(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/run") {
    await requireAuthorization(req, config, store, { mode: "read" });
    const payload = await store.getRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/benchmarks") {
    await requireAuthorization(req, config, store, { mode: "read" });
    sendJson(res, 200, await store.listBenchmarkRuns(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/benchmark") {
    await requireAuthorization(req, config, store, { mode: "read" });
    const payload = await store.getBenchmarkRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Benchmark run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/analytics/overview") {
    await requireAuthorization(req, config, store, { mode: "read" });
    sendJson(res, 200, await store.getAnalytics(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/artifact") {
    await requireAuthorization(req, config, store, { mode: "read" });
    const eventId = url.searchParams.get("eventId") || "";
    const artifactId = url.searchParams.get("artifactId") || "";
    const inline = url.searchParams.get("inline") === "1";
    if (!eventId || !artifactId) {
      sendJson(res, 400, { error: "eventId and artifactId are required" });
      return;
    }
    const artifact = await store.getArtifact({ eventId, artifactId, inline });
    if (!artifact) {
      sendJson(res, 404, { error: "Artifact not found" });
      return;
    }
    if (url.searchParams.get("download") === "1" && artifact.downloadUrl) {
      res.writeHead(302, { location: artifact.downloadUrl });
      res.end();
      return;
    }
    sendJson(res, 200, artifact);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/artifacts/signed-upload") {
    await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["ingest:write"],
    });
    if (!store.storage || typeof store.storage.getUploadUrl !== "function") {
      sendJson(res, 501, { error: "Bucket storage is not configured" });
      return;
    }
    const body = await readJsonBody(req);
    const workspaceId = body.workspaceId || "workspace";
    const eventId = body.eventId || "event";
    const artifactId = body.artifactId || "artifact";
    const contentType = body.contentType || "application/octet-stream";
    const key = [workspaceId, eventId, artifactId].map((entry) => String(entry || "").trim()).filter(Boolean).join("/");
    const uploadUrl = await store.storage.getUploadUrl(key, contentType);
    sendJson(res, 200, {
      ok: true,
      key,
      uploadUrl,
      contentType,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/providers/context7/search") {
    await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["broker:read"],
    });
    requireBrokerEnabled(config, "context7");
    const proxyUrl = new URL(CONTEXT7_SEARCH_URL);
    url.searchParams.forEach((value, key) => proxyUrl.searchParams.set(key, value));
    sendJson(res, 200, await fetchBrokerJson(proxyUrl, config.broker.context7ApiKey, config));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/providers/context7/context") {
    await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["broker:read"],
    });
    requireBrokerEnabled(config, "context7");
    const proxyUrl = new URL(CONTEXT7_CONTEXT_URL);
    url.searchParams.forEach((value, key) => proxyUrl.searchParams.set(key, value));
    sendText(res, 200, await fetchBrokerText(proxyUrl, config.broker.context7ApiKey, config));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/providers/corridor/context") {
    await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["broker:read"],
    });
    requireBrokerEnabled(config, "corridor");
    const body = await readJsonBody(req);
    const waveProjectId = String(body.projectId || "").trim();
    const mapping = config.broker.corridorProjectMap?.[waveProjectId];
    if (!mapping?.projectId) {
      sendJson(res, 404, { error: `No Corridor project mapping found for Wave project ${waveProjectId || "unknown"}.` });
      return;
    }
    const findingStates = Array.isArray(body.findingStates) ? body.findingStates : ["open", "potential"];
    const findings = await listCorridorFindings(
      config,
      mapping.projectId,
      config.broker.corridorApiToken,
      findingStates,
    );
    const guardrails = await fetchBrokerJson(
      `${CORRIDOR_BASE_URL}/projects/${mapping.projectId}/reports`,
      config.broker.corridorApiToken,
      config,
    );
    sendJson(
      res,
      200,
      summarizeCorridorContext({
        findings,
        guardrails,
        ownedPaths: body.ownedPaths,
        severityThreshold: body.severityThreshold,
        project: {
          waveProjectId,
          corridorProjectId: mapping.projectId,
          teamId: mapping.teamId || null,
        },
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/me") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireStackPrincipal(principal);
    sendJson(res, 200, {
      ok: true,
      user: {
        stackUserId: principal.stackUserId,
        email: principal.email,
        displayName: principal.displayName,
        teamIds: principal.teamIds,
        isAdmin: principal.isAdmin,
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/overview") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireStackPrincipal(principal);
    const filters = queryFilters(url);
    sendJson(
      res,
      200,
      buildAppOverview(
        await store.getAnalytics(filters),
        await store.listRuns(filters),
        await store.listBenchmarkRuns(filters),
      ),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/runs") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireStackPrincipal(principal);
    sendJson(res, 200, { items: await store.listRuns(queryFilters(url)) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/run") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireStackPrincipal(principal);
    const payload = await store.getRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/benchmarks") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireStackPrincipal(principal);
    sendJson(res, 200, { items: await store.listBenchmarkRuns(queryFilters(url)) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/benchmark") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireStackPrincipal(principal);
    const payload = await store.getBenchmarkRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Benchmark run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/app/tokens") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "read",
      requiredScopes: ["app:read"],
    });
    requireStackPrincipal(principal);
    const records = await store.listPersonalAccessTokens({
      ownerStackUserId: principal.stackUserId,
    });
    sendJson(res, 200, {
      items: records.map((record) => sanitizePersonalAccessTokenRecord(record)),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/app/tokens") {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:token:write"],
    });
    requireStackAdmin(principal);
    const body = await readJsonBody(req);
    const generated = createPersonalAccessToken(body.label, defaultTokenScopes(body.scopes), {
      stackUserId: body.ownerStackUserId || principal.stackUserId,
      email: body.ownerEmail || principal.email,
      createdByStackUserId: principal.stackUserId,
    });
    await store.createPersonalAccessToken({
      ...generated.record,
      tokenHash: generated.tokenHash,
    });
    sendJson(res, 201, {
      ok: true,
      token: generated.token,
      record: sanitizePersonalAccessTokenRecord(generated.record),
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/v1\/app\/tokens\/[^/]+\/revoke$/.test(url.pathname)) {
    const principal = await requireAuthorization(req, config, store, {
      mode: "write",
      requiredScopes: ["app:token:write"],
    });
    requireStackAdmin(principal);
    const tokenId = url.pathname.split("/")[5] || "";
    const revoked = await store.revokePersonalAccessToken(tokenId, new Date().toISOString());
    if (!revoked) {
      sendJson(res, 404, { error: "Token not found" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      record: sanitizePersonalAccessTokenRecord(revoked),
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

export async function createWaveControlServer(options = {}) {
  const config = options.config || loadWaveControlServiceConfig();
  const store = options.store || (await createWaveControlStore(config));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://wave-control.local");
    setCorsHeaders(req, res, config);
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
        sendHtml(res, 200, renderWaveControlUi(config));
        return;
      }
      await handleApiRequest(req, res, url, { config, store });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, statusCode, { error: message });
    }
  });
  return {
    config,
    store,
    server,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      if (typeof store.close === "function") {
        await store.close();
      }
    },
  };
}

export async function startWaveControlServer(options = {}) {
  const app = await createWaveControlServer(options);
  await new Promise((resolve) =>
    app.server.listen(app.config.port, app.config.host, resolve),
  );
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await startWaveControlServer();
  console.log(
    `[wave-control] listening on http://${app.config.host}:${app.config.port}`,
  );
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
