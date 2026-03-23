import { Pool } from "pg";
import {
  buildAnalyticsOverview,
  getBenchmarkRunDetail,
  getRunDetail,
  listBenchmarkRunSummaries,
  listRunSummaries,
} from "./projections.mjs";

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function buildBucketKey(event, upload) {
  const identity = event.identity || {};
  const workspaceId = cleanText(identity.workspaceId, "workspace");
  const projectId = cleanText(identity.projectId, "");
  const benchmarkRunId = cleanText(identity.benchmarkRunId, "");
  const runKind = cleanText(identity.runKind, "unknown");
  const lane = cleanText(identity.lane, "");
  const wave = identity.wave == null ? "" : `wave-${identity.wave}`;
  const runtimeVersion = cleanText(identity.runtimeVersion, "");
  const segments = [
    workspaceId,
    projectId,
    benchmarkRunId || runKind,
    lane,
    wave,
    runtimeVersion,
    event.id,
    upload.artifactId,
  ].filter(Boolean);
  return segments.join("/");
}

function decodeArtifactUpload(upload) {
  if (!upload?.content) {
    return null;
  }
  if (upload.encoding === "base64") {
    return Buffer.from(upload.content, "base64");
  }
  return Buffer.from(upload.content, "utf8");
}

function whereClause(filters = {}) {
  const clauses = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    clauses.push(`${sql} $${values.length}`);
  };
  if (filters.workspaceId) {
    add("workspace_id =", filters.workspaceId);
  }
  if (filters.projectId) {
    add("project_id =", filters.projectId);
  }
  if (filters.runKind) {
    add("run_kind =", filters.runKind);
  }
  if (filters.runId !== undefined && filters.runId !== null && filters.runId !== "") {
    add("run_id =", filters.runId);
  }
  if (filters.lane) {
    add("lane =", filters.lane);
  }
  if (filters.wave != null) {
    add("wave =", Number(filters.wave));
  }
  if (filters.orchestratorId) {
    add("orchestrator_id =", filters.orchestratorId);
  }
  if (filters.runtimeVersion) {
    add("runtime_version =", filters.runtimeVersion);
  }
  if (filters.benchmarkRunId) {
    add("benchmark_run_id =", filters.benchmarkRunId);
  }
  const sql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql, values };
}

export class PostgresWaveControlStore {
  constructor({ config, storage = null }) {
    this.config = config;
    this.storage = storage;
    this.pool = new Pool({
      connectionString: config.postgres.databaseUrl,
      max: config.postgres.maxConnections,
      ssl: config.postgres.ssl ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wave_control_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        run_kind TEXT,
        run_id TEXT,
        lane TEXT,
        wave INTEGER,
        orchestrator_id TEXT,
        runtime_version TEXT,
        benchmark_run_id TEXT,
        benchmark_item_id TEXT,
        entity_type TEXT NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL,
        event JSONB NOT NULL
      );
    `);
    await this.pool.query(`
      ALTER TABLE wave_control_events
      ADD COLUMN IF NOT EXISTS project_id TEXT,
      ADD COLUMN IF NOT EXISTS orchestrator_id TEXT,
      ADD COLUMN IF NOT EXISTS runtime_version TEXT;
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wave_control_events_workspace_idx
      ON wave_control_events (workspace_id, recorded_at DESC);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wave_control_events_project_idx
      ON wave_control_events (project_id, recorded_at DESC);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wave_control_events_run_idx
      ON wave_control_events (workspace_id, project_id, run_kind, run_id, lane, wave, orchestrator_id, runtime_version);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wave_control_events_benchmark_idx
      ON wave_control_events (workspace_id, project_id, benchmark_run_id, runtime_version, recorded_at DESC);
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wave_control_artifact_uploads (
        event_id TEXT NOT NULL REFERENCES wave_control_events(id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL,
        content_type TEXT,
        encoding TEXT,
        inline_content TEXT,
        bucket_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (event_id, artifact_id)
      );
    `);
  }

  async close() {
    await this.pool.end();
  }

  async ingestBatch(batch) {
    const client = await this.pool.connect();
    let accepted = 0;
    let duplicates = 0;
    try {
      await client.query("BEGIN");
      for (const event of batch.events || []) {
        const identity = event.identity || {};
        const inserted = await client.query(
          `
            INSERT INTO wave_control_events (
              id,
              workspace_id,
              project_id,
              run_kind,
              run_id,
              lane,
              wave,
              orchestrator_id,
              runtime_version,
              benchmark_run_id,
              benchmark_item_id,
              entity_type,
              recorded_at,
              event
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `,
          [
            event.id,
            cleanText(identity.workspaceId, ""),
            cleanText(identity.projectId, ""),
            cleanText(identity.runKind, ""),
            identity.runId ?? null,
            identity.lane ?? null,
            identity.wave ?? null,
            identity.orchestratorId ?? null,
            identity.runtimeVersion ?? null,
            identity.benchmarkRunId ?? null,
            identity.benchmarkItemId ?? null,
            event.entityType,
            event.recordedAt,
            JSON.stringify(event),
          ],
        );
        if (inserted.rowCount === 0) {
          duplicates += 1;
          continue;
        }
        accepted += 1;
        for (const upload of event.artifactUploads || []) {
          let inlineContent = upload.content || null;
          let bucketKey = null;
          if (this.storage && upload.content) {
            bucketKey = buildBucketKey(event, upload);
            const body = decodeArtifactUpload(upload);
            await this.storage.putObject({
              key: bucketKey,
              body,
              contentType: upload.contentType || "application/octet-stream",
            });
            inlineContent = null;
          }
          await client.query(
            `
              INSERT INTO wave_control_artifact_uploads (
                event_id,
                artifact_id,
                content_type,
                encoding,
                inline_content,
                bucket_key
              )
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (event_id, artifact_id) DO NOTHING
            `,
            [
              event.id,
              upload.artifactId,
              upload.contentType || null,
              upload.encoding || null,
              inlineContent,
              bucketKey,
            ],
          );
        }
      }
      await client.query("COMMIT");
      return { accepted, duplicates };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async fetchEvents(filters = {}) {
    const where = whereClause(filters);
    const result = await this.pool.query(
      `
        SELECT event
        FROM wave_control_events
        ${where.sql}
        ORDER BY recorded_at ASC, id ASC
      `,
      where.values,
    );
    return result.rows.map((row) => row.event);
  }

  async listRuns(filters = {}) {
    return listRunSummaries(await this.fetchEvents(filters), filters);
  }

  async getRun(filters = {}) {
    return getRunDetail(await this.fetchEvents(filters), filters);
  }

  async listBenchmarkRuns(filters = {}) {
    return listBenchmarkRunSummaries(await this.fetchEvents(filters), filters);
  }

  async getBenchmarkRun(filters = {}) {
    return getBenchmarkRunDetail(await this.fetchEvents(filters), filters);
  }

  async getAnalytics(filters = {}) {
    return buildAnalyticsOverview(await this.fetchEvents(filters), filters);
  }

  async getArtifact({ eventId, artifactId, inline = false }) {
    const eventResult = await this.pool.query(
      `SELECT event FROM wave_control_events WHERE id = $1 LIMIT 1`,
      [eventId],
    );
    const event = eventResult.rows[0]?.event || null;
    if (!event) {
      return null;
    }
    const metadata = (event.artifacts || []).find((artifact) => artifact.artifactId === artifactId) || null;
    if (!metadata) {
      return null;
    }
    const uploadResult = await this.pool.query(
      `
        SELECT artifact_id, content_type, encoding, inline_content, bucket_key
        FROM wave_control_artifact_uploads
        WHERE event_id = $1 AND artifact_id = $2
        LIMIT 1
      `,
      [eventId, artifactId],
    );
    const upload = uploadResult.rows[0] || null;
    const downloadUrl =
      upload?.bucket_key && this.storage ? await this.storage.getDownloadUrl(upload.bucket_key) : null;
    return {
      eventId,
      artifactId,
      metadata,
      downloadUrl,
      inlineContent:
        inline && upload?.inline_content
          ? {
              artifactId,
              contentType: upload.content_type,
              encoding: upload.encoding,
              content: upload.inline_content,
            }
          : null,
    };
  }
}
