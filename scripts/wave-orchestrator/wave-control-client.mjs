import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  readWaveControlDeliveryState,
  writeWaveControlDeliveryState,
} from "./artifact-schemas.mjs";
import { REPO_ROOT, buildWorkspaceTmuxToken, ensureDirectory, toIsoTimestamp } from "./shared.mjs";
import {
  buildWaveControlConfigAttestationHash,
  normalizeWaveControlArtifactDescriptor,
  normalizeWaveControlEventEnvelope,
} from "./wave-control-schema.mjs";
import { readInstalledPackageMetadata } from "./package-version.mjs";

const MAX_INLINE_ARTIFACT_BYTES = 512 * 1024;

function normalizeText(value, fallback = null) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeTelemetryId(value, fallback = null) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function sanitizeToken(value, fallback = "item") {
  const token = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || fallback;
}

function telemetryPaths(lanePaths) {
  const telemetryDir = lanePaths?.telemetryDir || path.join(lanePaths.controlPlaneDir, "telemetry");
  return {
    telemetryDir,
    pendingDir: path.join(telemetryDir, "pending"),
    sentDir: path.join(telemetryDir, "sent"),
    failedDir: path.join(telemetryDir, "failed"),
    eventsPath: path.join(telemetryDir, "events.jsonl"),
    deliveryStatePath: path.join(telemetryDir, "delivery-state.json"),
  };
}

function listPendingQueueFiles(paths) {
  return fs
    .readdirSync(paths.pendingDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => path.join(paths.pendingDir, fileName));
}

function ensureTelemetryDirs(paths) {
  ensureDirectory(paths.telemetryDir);
  ensureDirectory(paths.pendingDir);
  ensureDirectory(paths.sentDir);
  ensureDirectory(paths.failedDir);
}

function isMissingFileError(error) {
  return error && typeof error === "object" && ["ENOENT", "ESTALE"].includes(error.code);
}

function readQueuedEventOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function renameIfExists(sourcePath, destinationPath) {
  try {
    fs.renameSync(sourcePath, destinationPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function copyIfExists(sourcePath, destinationPath) {
  try {
    fs.copyFileSync(sourcePath, destinationPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function repoRelativePathOrNull(filePath) {
  if (!filePath) {
    return null;
  }
  const absolute = path.resolve(String(filePath));
  const relative = path.relative(REPO_ROOT, absolute);
  if (!relative || relative.startsWith("..")) {
    return null;
  }
  return relative.replaceAll(path.sep, "/");
}

function fileHashOrNull(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function contentTypeForPath(filePath) {
  const ext = path.extname(String(filePath || "").toLowerCase());
  if (ext === ".json") {
    return "application/json";
  }
  if (ext === ".jsonl") {
    return "application/x-ndjson";
  }
  if (ext === ".md") {
    return "text/markdown";
  }
  if ([".txt", ".log", ".status"].includes(ext)) {
    return "text/plain";
  }
  if (ext === ".html") {
    return "text/html";
  }
  if ([".js", ".mjs", ".ts"].includes(ext)) {
    return "text/plain";
  }
  return "application/octet-stream";
}

function resolveWaveControlConfig(lanePaths, overrides = {}) {
  return {
    ...(lanePaths?.waveControl || lanePaths?.laneProfile?.waveControl || {}),
    ...(overrides || {}),
  };
}

function buildWorkspaceId(lanePaths, config) {
  return normalizeText(config.workspaceId, buildWorkspaceTmuxToken(REPO_ROOT));
}

function buildProjectId(lanePaths, config) {
  const projectName =
    lanePaths?.projectId ||
    config.projectId ||
    lanePaths?.config?.projectId ||
    lanePaths?.config?.projectName ||
    path.basename(REPO_ROOT);
  return normalizeTelemetryId(projectName, "wave");
}

function buildRuntimeVersion(lanePaths) {
  return normalizeText(
    lanePaths?.runtimeVersion,
    normalizeText(readInstalledPackageMetadata()?.version, null),
  );
}

function shouldUploadArtifactBody(descriptor, config) {
  if (!descriptor?.present) {
    return false;
  }
  if (descriptor.uploadPolicy === "local-only" || descriptor.uploadPolicy === "metadata-only") {
    return false;
  }
  const allowedKinds = Array.isArray(config.uploadArtifactKinds) ? config.uploadArtifactKinds : [];
  const kindAllowed = allowedKinds.includes(descriptor.kind);
  if (descriptor.uploadPolicy === "full") {
    return config.reportMode === "full-artifact-upload" && (allowedKinds.length === 0 || kindAllowed);
  }
  if (!kindAllowed) {
    return false;
  }
  return ["metadata-plus-selected", "full-artifact-upload"].includes(config.reportMode);
}

function buildInlineArtifactPayload(artifactDescriptor, sourcePath, config) {
  if (!shouldUploadArtifactBody(artifactDescriptor, config) || !sourcePath || !fs.existsSync(sourcePath)) {
    return null;
  }
  let stat;
  try {
    stat = fs.statSync(sourcePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
  if (!stat.isFile() || stat.size > MAX_INLINE_ARTIFACT_BYTES) {
    return null;
  }
  const contentType = artifactDescriptor.contentType || contentTypeForPath(sourcePath);
  const textLike = contentType.startsWith("text/") || contentType === "application/json";
  let content;
  try {
    content = textLike
      ? fs.readFileSync(sourcePath, "utf8")
      : fs.readFileSync(sourcePath).toString("base64");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
  return {
    artifactId: artifactDescriptor.artifactId,
    contentType,
    encoding: textLike ? "utf8" : "base64",
    content,
  };
}

function deliveryStateDefaults(lanePaths, config, paths) {
  return {
    workspaceId: buildWorkspaceId(lanePaths, config),
    lane: lanePaths?.lane || null,
    runId: lanePaths?.runId || null,
    runKind: lanePaths?.runKind || "unknown",
    reportMode: config.reportMode || "metadata-plus-selected",
    endpoint: config.endpoint || null,
    queuePath: repoRelativePathOrNull(paths.pendingDir),
    eventsPath: repoRelativePathOrNull(paths.eventsPath),
  };
}

function readDeliveryStateOrDefault(lanePaths, config, paths) {
  return (
    readWaveControlDeliveryState(paths.deliveryStatePath, deliveryStateDefaults(lanePaths, config, paths)) ||
    writeWaveControlDeliveryState(paths.deliveryStatePath, {}, deliveryStateDefaults(lanePaths, config, paths))
  );
}

function writeDeliveryState(lanePaths, config, paths, payload) {
  return writeWaveControlDeliveryState(
    paths.deliveryStatePath,
    payload,
    deliveryStateDefaults(lanePaths, config, paths),
  );
}

function attestationForEvent(rawEvent, config) {
  if (!rawEvent?.attestation && !rawEvent?.data?.attestation) {
    return null;
  }
  const attestationInput = rawEvent.attestation || rawEvent.data?.attestation;
  return {
    ...(typeof attestationInput === "object" && attestationInput ? attestationInput : {}),
    configHash: buildWaveControlConfigAttestationHash(attestationInput),
    reportMode: config.reportMode,
  };
}

function queueFilePath(paths, event) {
  return path.join(
    paths.pendingDir,
    `${event.recordedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${sanitizeToken(event.id)}.json`,
  );
}

function sentFilePath(paths, event) {
  return path.join(paths.sentDir, `${sanitizeToken(event.id)}.json`);
}

function failedFilePath(paths, event) {
  return path.join(paths.failedDir, `${sanitizeToken(event.id)}.json`);
}

function overflowQueueFilePath(paths, filePath) {
  return path.join(paths.failedDir, `overflow-${path.basename(filePath)}`);
}

function enforcePendingQueueCap(paths, config) {
  const maxPendingEvents = Number(config.maxPendingEvents || 0);
  const pendingFiles = listPendingQueueFiles(paths);
  if (!maxPendingEvents || pendingFiles.length <= maxPendingEvents) {
    return { dropped: 0, pendingCount: pendingFiles.length };
  }
  const overflowFiles = pendingFiles.slice(0, pendingFiles.length - maxPendingEvents);
  for (const filePath of overflowFiles) {
    fs.renameSync(filePath, overflowQueueFilePath(paths, filePath));
  }
  return {
    dropped: overflowFiles.length,
    pendingCount: maxPendingEvents,
  };
}

export function buildWaveControlArtifactFromPath(filePath, options = {}) {
  const absolutePath = path.isAbsolute(String(filePath || ""))
    ? String(filePath)
    : path.resolve(REPO_ROOT, String(filePath || ""));
  const relativePath = repoRelativePathOrNull(absolutePath) || normalizeText(options.path, null);
  const stat = absolutePath && fs.existsSync(absolutePath) ? fs.statSync(absolutePath) : null;
  return normalizeWaveControlArtifactDescriptor({
    path: relativePath,
    kind: normalizeText(options.kind, "artifact"),
    required: options.required === true,
    present: Boolean(stat?.isFile()),
    sha256: stat?.isFile() ? fileHashOrNull(absolutePath) : null,
    bytes: stat?.isFile() ? stat.size : null,
    contentType: normalizeText(options.contentType, contentTypeForPath(absolutePath)),
    uploadPolicy: normalizeText(options.uploadPolicy, "metadata-only"),
    label: normalizeText(options.label, null),
    recordedAt: normalizeText(options.recordedAt, null),
  });
}

export function queueWaveControlEvent(lanePaths, rawEvent, options = {}) {
  const config = resolveWaveControlConfig(lanePaths, options.config);
  if (config.enabled === false) {
    return null;
  }
  const paths = telemetryPaths(lanePaths);
  ensureTelemetryDirs(paths);
  const artifacts = (Array.isArray(rawEvent?.artifacts) ? rawEvent.artifacts : []).map((artifact) =>
    normalizeWaveControlArtifactDescriptor(artifact),
  );
  const event = normalizeWaveControlEventEnvelope(
    {
      ...rawEvent,
      identity: {
        workspaceId: buildWorkspaceId(lanePaths, config),
        projectId: buildProjectId(lanePaths, config),
        runId: lanePaths?.runId || null,
        runKind: lanePaths?.runKind || "roadmap",
        lane: lanePaths?.lane || null,
        orchestratorId: lanePaths?.orchestratorId || null,
        runtimeVersion: buildRuntimeVersion(lanePaths),
        ...(rawEvent?.identity || {}),
      },
      data: {
        ...(rawEvent?.data || {}),
        ...(attestationForEvent(rawEvent, config)
          ? { attestation: attestationForEvent(rawEvent, config) }
          : {}),
      },
      artifacts,
    },
    options.defaults || {},
  );
  const sourcePaths = Object.fromEntries(
    artifacts
      .map((artifact, index) => {
        const sourcePath =
          rawEvent?.artifactSourcePaths?.[artifact.artifactId] ||
          rawEvent?.artifactSourcePaths?.[artifact.path] ||
          rawEvent?.artifacts?.[index]?.sourcePath ||
          (artifact.path ? path.resolve(REPO_ROOT, artifact.path) : null);
        return sourcePath ? [artifact.artifactId, sourcePath] : null;
      })
      .filter(Boolean),
  );
  const queuePath = queueFilePath(paths, event);
  fs.appendFileSync(paths.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  fs.writeFileSync(
    queuePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "wave-control-queued-event",
        enqueuedAt: toIsoTimestamp(),
        event,
        artifactSourcePaths: sourcePaths,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const deliveryState = readDeliveryStateOrDefault(lanePaths, config, paths);
  const queueCap = enforcePendingQueueCap(paths, config);
  const queueOverflowMessage =
    queueCap.dropped > 0
      ? `Wave Control pending queue exceeded maxPendingEvents=${config.maxPendingEvents}; dropped ${queueCap.dropped} oldest pending event(s) from remote delivery queue.`
      : null;
  writeDeliveryState(lanePaths, config, paths, {
    ...deliveryState,
    pendingCount: queueCap.pendingCount,
    failedCount: (deliveryState.failedCount || 0) + queueCap.dropped,
    lastEnqueuedAt: event.recordedAt,
    ...(queueOverflowMessage
      ? {
          lastError: {
            message: queueOverflowMessage,
            failedAt: toIsoTimestamp(),
          },
        }
      : {}),
    recentEventIds: [...(deliveryState.recentEventIds || []).slice(-19), event.id],
    updatedAt: toIsoTimestamp(),
  });
  return event;
}

export function safeQueueWaveControlEvent(lanePaths, rawEvent, options = {}) {
  try {
    return queueWaveControlEvent(lanePaths, rawEvent, options);
  } catch {
    return null;
  }
}

function resolveIngestUrl(endpoint) {
  const normalized = normalizeText(endpoint, null);
  if (!normalized) {
    return null;
  }
  if (/\/ingest\/batches\/?$/.test(normalized)) {
    return normalized;
  }
  return `${normalized.replace(/\/$/, "")}/ingest/batches`;
}

async function postBatch(url, token, timeoutMs, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Wave Control ingest failed (${response.status}): ${body || response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function flushWaveControlQueue(lanePaths, options = {}) {
  const config = resolveWaveControlConfig(lanePaths, options.config);
  if (config.enabled === false) {
    return { attempted: 0, sent: 0, failed: 0, pending: 0, disabled: true };
  }
  const paths = telemetryPaths(lanePaths);
  ensureTelemetryDirs(paths);
  const deliveryState = readDeliveryStateOrDefault(lanePaths, config, paths);
  const pendingFiles = listPendingQueueFiles(paths)
    .slice(0, options.limit || config.flushBatchSize || 25)
  if (!config.endpoint) {
    writeDeliveryState(lanePaths, config, paths, {
      ...deliveryState,
      pendingCount: listPendingQueueFiles(paths).length,
      updatedAt: toIsoTimestamp(),
    });
    return { attempted: 0, sent: 0, failed: 0, pending: listPendingQueueFiles(paths).length };
  }
  if (pendingFiles.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, pending: 0 };
  }

  const queuedEvents = [];
  for (const filePath of pendingFiles) {
    const payload = readQueuedEventOrNull(filePath);
    if (!payload) {
      continue;
    }
    queuedEvents.push({ filePath, payload });
  }
  if (queuedEvents.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, pending: listPendingQueueFiles(paths).length };
  }
  const hydratedEvents = queuedEvents.map(({ payload }) => {
    const artifactUploads = (payload.event.artifacts || [])
      .map((artifact) =>
        buildInlineArtifactPayload(
          artifact,
          payload.artifactSourcePaths?.[artifact.artifactId] || null,
          config,
        ),
      )
      .filter(Boolean);
    return {
      ...payload.event,
      artifactUploads,
    };
  });

  try {
    const ingestUrl = resolveIngestUrl(config.endpoint);
    const authToken = config.authTokenEnvVar ? process.env[config.authTokenEnvVar] || "" : "";
    await postBatch(
      ingestUrl,
      authToken,
      options.timeoutMs || config.requestTimeoutMs || 5000,
      {
        workspaceId: buildWorkspaceId(lanePaths, config),
        lane: lanePaths?.lane || null,
        runKind: lanePaths?.runKind || "unknown",
        runId: lanePaths?.runId || null,
        sentAt: toIsoTimestamp(),
        events: hydratedEvents,
      },
    );
    let sentCount = 0;
    for (const { filePath, payload } of queuedEvents) {
      if (renameIfExists(filePath, sentFilePath(paths, payload.event))) {
        sentCount += 1;
      }
    }
    writeDeliveryState(lanePaths, config, paths, {
      ...deliveryState,
      pendingCount: listPendingQueueFiles(paths).length,
      sentCount: (deliveryState.sentCount || 0) + sentCount,
      lastFlushAt: toIsoTimestamp(),
      lastSuccessAt: toIsoTimestamp(),
      lastError: null,
      updatedAt: toIsoTimestamp(),
    });
    return {
      attempted: queuedEvents.length,
      sent: sentCount,
      failed: 0,
      pending: listPendingQueueFiles(paths).length,
    };
  } catch (error) {
    let failedCount = 0;
    for (const { filePath, payload } of queuedEvents) {
      if (copyIfExists(filePath, failedFilePath(paths, payload.event))) {
        failedCount += 1;
      }
    }
    writeDeliveryState(lanePaths, config, paths, {
      ...deliveryState,
      pendingCount: listPendingQueueFiles(paths).length,
      failedCount: (deliveryState.failedCount || 0) + failedCount,
      lastFlushAt: toIsoTimestamp(),
      lastError: {
        message: error instanceof Error ? error.message : String(error),
        failedAt: toIsoTimestamp(),
      },
      updatedAt: toIsoTimestamp(),
    });
    return {
      attempted: queuedEvents.length,
      sent: 0,
      failed: failedCount,
      pending: listPendingQueueFiles(paths).length,
      error,
    };
  }
}

export function readWaveControlQueueState(lanePaths, options = {}) {
  const config = resolveWaveControlConfig(lanePaths, options.config);
  if (config.enabled === false) {
    return {
      workspaceId: buildWorkspaceId(lanePaths, config),
      lane: lanePaths?.lane || null,
      runId: lanePaths?.runId || null,
      runKind: lanePaths?.runKind || "unknown",
      reportMode: config.reportMode || "metadata-plus-selected",
      endpoint: config.endpoint || null,
      pendingCount: 0,
      sentCount: 0,
      failedCount: 0,
      telemetryDir: repoRelativePathOrNull(
        lanePaths?.telemetryDir || path.join(lanePaths.controlPlaneDir, "telemetry"),
      ),
      disabled: true,
      updatedAt: toIsoTimestamp(),
    };
  }
  const paths = telemetryPaths(lanePaths);
  ensureTelemetryDirs(paths);
  const state = readDeliveryStateOrDefault(lanePaths, config, paths);
  const pendingFiles = fs.readdirSync(paths.pendingDir).filter((fileName) => fileName.endsWith(".json"));
  return {
    ...state,
    pendingCount: pendingFiles.length,
    telemetryDir: repoRelativePathOrNull(paths.telemetryDir),
  };
}
