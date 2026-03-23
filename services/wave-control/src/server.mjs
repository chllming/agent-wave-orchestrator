import http from "node:http";
import { loadWaveControlServiceConfig } from "./config.mjs";
import { requireAuthorization } from "./auth.mjs";
import { createWaveControlStore } from "./store.mjs";
import { renderWaveControlUi } from "./ui.mjs";

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
    requireAuthorization(req, config, "write");
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
    requireAuthorization(req, config, "read");
    sendJson(res, 200, await store.listRuns(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/run") {
    requireAuthorization(req, config, "read");
    const payload = await store.getRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/benchmarks") {
    requireAuthorization(req, config, "read");
    sendJson(res, 200, await store.listBenchmarkRuns(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/benchmark") {
    requireAuthorization(req, config, "read");
    const payload = await store.getBenchmarkRun(queryFilters(url));
    if (!payload) {
      sendJson(res, 404, { error: "Benchmark run not found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/analytics/overview") {
    requireAuthorization(req, config, "read");
    sendJson(res, 200, await store.getAnalytics(queryFilters(url)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/artifact") {
    requireAuthorization(req, config, "read");
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
    requireAuthorization(req, config, "write");
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

  sendJson(res, 404, { error: "Not found" });
}

export async function createWaveControlServer(options = {}) {
  const config = options.config || loadWaveControlServiceConfig();
  const store = options.store || (await createWaveControlStore(config));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://wave-control.local");
    try {
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
