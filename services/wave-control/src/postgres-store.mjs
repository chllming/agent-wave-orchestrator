import { Pool } from "pg";
import {
  buildAnalyticsOverview,
  getBenchmarkRunDetail,
  getRunDetail,
  listBenchmarkRunSummaries,
  listRunSummaries,
} from "./projections.mjs";
import { sanitizeUserCredentialRecord } from "./user-credentials.mjs";

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
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wave_control_pat_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        owner_stack_user_id TEXT,
        owner_email TEXT,
        created_by_stack_user_id TEXT,
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wave_control_pat_owner_idx
      ON wave_control_pat_tokens (owner_stack_user_id, created_at DESC);
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wave_control_app_users (
        id TEXT PRIMARY KEY,
        stack_user_id TEXT UNIQUE,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        role TEXT NOT NULL,
        access_state TEXT NOT NULL,
        provider_grants JSONB NOT NULL DEFAULT '[]'::jsonb,
        access_request_reason TEXT,
        access_requested_at TIMESTAMPTZ,
        access_reviewed_at TIMESTAMPTZ,
        access_reviewed_by_stack_user_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wave_control_app_users_access_idx
      ON wave_control_app_users (access_state, updated_at DESC);
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wave_control_audit_events (
        id TEXT PRIMARY KEY,
        actor_stack_user_id TEXT,
        actor_email TEXT,
        event_type TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL
      );
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wave_control_user_credentials (
        app_user_id TEXT NOT NULL REFERENCES wave_control_app_users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        key_version TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_by_type TEXT,
        created_by_id TEXT,
        updated_by_type TEXT,
        updated_by_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (app_user_id, credential_id)
      );
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wave_control_user_credentials_updated_idx
      ON wave_control_user_credentials (app_user_id, updated_at DESC);
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

  async listPersonalAccessTokens({ ownerStackUserId, ownerEmail } = {}) {
    const values = [];
    if (ownerStackUserId) {
      values.push(ownerStackUserId);
    } else if (ownerEmail) {
      values.push(ownerEmail);
    }
    const where = ownerStackUserId
      ? `WHERE owner_stack_user_id = $${values.length}`
      : ownerEmail
        ? `WHERE owner_email = $${values.length}`
        : "";
    const result = await this.pool.query(
      `
        SELECT id, label, owner_stack_user_id, owner_email, created_by_stack_user_id, scopes, created_at, last_used_at, revoked_at
        FROM wave_control_pat_tokens
        ${where}
        ORDER BY created_at DESC
      `,
      values,
    );
    return result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      ownerStackUserId: row.owner_stack_user_id,
      ownerEmail: row.owner_email,
      createdByStackUserId: row.created_by_stack_user_id,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      lastUsedAt: row.last_used_at?.toISOString?.() || row.last_used_at || null,
      revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at || null,
    }));
  }

  async createPersonalAccessToken(record) {
    await this.pool.query(
      `
        INSERT INTO wave_control_pat_tokens (
          id, token_hash, label, owner_stack_user_id, owner_email, created_by_stack_user_id, scopes, created_at, last_used_at, revoked_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
      `,
      [
        record.id,
        record.tokenHash,
        record.label,
        record.ownerStackUserId,
        record.ownerEmail,
        record.createdByStackUserId,
        JSON.stringify(record.scopes || []),
        record.createdAt,
        record.lastUsedAt,
        record.revokedAt,
      ],
    );
    return record;
  }

  async findPersonalAccessTokenByHash(tokenHash) {
    const result = await this.pool.query(
      `
        SELECT id, token_hash, label, owner_stack_user_id, owner_email, created_by_stack_user_id, scopes, created_at, last_used_at, revoked_at
        FROM wave_control_pat_tokens
        WHERE token_hash = $1
        LIMIT 1
      `,
      [tokenHash],
    );
    const row = result.rows[0] || null;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      tokenHash: row.token_hash,
      label: row.label,
      ownerStackUserId: row.owner_stack_user_id,
      ownerEmail: row.owner_email,
      createdByStackUserId: row.created_by_stack_user_id,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      lastUsedAt: row.last_used_at?.toISOString?.() || row.last_used_at || null,
      revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at || null,
    };
  }

  async findPersonalAccessTokenById(id) {
    const result = await this.pool.query(
      `
        SELECT id, token_hash, label, owner_stack_user_id, owner_email, created_by_stack_user_id, scopes, created_at, last_used_at, revoked_at
        FROM wave_control_pat_tokens
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );
    const row = result.rows[0] || null;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      tokenHash: row.token_hash,
      label: row.label,
      ownerStackUserId: row.owner_stack_user_id,
      ownerEmail: row.owner_email,
      createdByStackUserId: row.created_by_stack_user_id,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      lastUsedAt: row.last_used_at?.toISOString?.() || row.last_used_at || null,
      revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at || null,
    };
  }

  async touchPersonalAccessTokenLastUsed(id, usedAt) {
    await this.pool.query(
      `UPDATE wave_control_pat_tokens SET last_used_at = $2 WHERE id = $1`,
      [id, usedAt],
    );
  }

  async revokePersonalAccessToken(id, revokedAt) {
    const result = await this.pool.query(
      `
        UPDATE wave_control_pat_tokens
        SET revoked_at = $2
        WHERE id = $1
        RETURNING id, label, owner_stack_user_id, owner_email, created_by_stack_user_id, scopes, created_at, last_used_at, revoked_at
      `,
      [id, revokedAt],
    );
    const row = result.rows[0] || null;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      label: row.label,
      ownerStackUserId: row.owner_stack_user_id,
      ownerEmail: row.owner_email,
      createdByStackUserId: row.created_by_stack_user_id,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      lastUsedAt: row.last_used_at?.toISOString?.() || row.last_used_at || null,
      revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at || null,
    };
  }

  async listAppUsers() {
    const result = await this.pool.query(
      `
        SELECT id, stack_user_id, email, display_name, role, access_state, provider_grants,
               access_request_reason, access_requested_at, access_reviewed_at,
               access_reviewed_by_stack_user_id, created_at, updated_at
        FROM wave_control_app_users
        ORDER BY updated_at DESC, created_at DESC
      `,
    );
    return result.rows.map((row) => ({
      id: row.id,
      stackUserId: row.stack_user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      accessState: row.access_state,
      providerGrants: Array.isArray(row.provider_grants) ? row.provider_grants : [],
      accessRequestReason: row.access_request_reason,
      accessRequestedAt: row.access_requested_at?.toISOString?.() || row.access_requested_at || null,
      accessReviewedAt: row.access_reviewed_at?.toISOString?.() || row.access_reviewed_at || null,
      accessReviewedByStackUserId: row.access_reviewed_by_stack_user_id,
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
    }));
  }

  async findAppUserByStackUserId(stackUserId) {
    const result = await this.pool.query(
      `
        SELECT id, stack_user_id, email, display_name, role, access_state, provider_grants,
               access_request_reason, access_requested_at, access_reviewed_at,
               access_reviewed_by_stack_user_id, created_at, updated_at
        FROM wave_control_app_users
        WHERE stack_user_id = $1
        LIMIT 1
      `,
      [stackUserId],
    );
    const row = result.rows[0] || null;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      stackUserId: row.stack_user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      accessState: row.access_state,
      providerGrants: Array.isArray(row.provider_grants) ? row.provider_grants : [],
      accessRequestReason: row.access_request_reason,
      accessRequestedAt: row.access_requested_at?.toISOString?.() || row.access_requested_at || null,
      accessReviewedAt: row.access_reviewed_at?.toISOString?.() || row.access_reviewed_at || null,
      accessReviewedByStackUserId: row.access_reviewed_by_stack_user_id,
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
    };
  }

  async findAppUserById(id) {
    const result = await this.pool.query(
      `
        SELECT id, stack_user_id, email, display_name, role, access_state, provider_grants,
               access_request_reason, access_requested_at, access_reviewed_at,
               access_reviewed_by_stack_user_id, created_at, updated_at
        FROM wave_control_app_users
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );
    const row = result.rows[0] || null;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      stackUserId: row.stack_user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      accessState: row.access_state,
      providerGrants: Array.isArray(row.provider_grants) ? row.provider_grants : [],
      accessRequestReason: row.access_request_reason,
      accessRequestedAt: row.access_requested_at?.toISOString?.() || row.access_requested_at || null,
      accessReviewedAt: row.access_reviewed_at?.toISOString?.() || row.access_reviewed_at || null,
      accessReviewedByStackUserId: row.access_reviewed_by_stack_user_id,
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
    };
  }

  async findAppUserByEmail(email) {
    const result = await this.pool.query(
      `
        SELECT id, stack_user_id, email, display_name, role, access_state, provider_grants,
               access_request_reason, access_requested_at, access_reviewed_at,
               access_reviewed_by_stack_user_id, created_at, updated_at
        FROM wave_control_app_users
        WHERE email = $1
        LIMIT 1
      `,
      [email],
    );
    const row = result.rows[0] || null;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      stackUserId: row.stack_user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      accessState: row.access_state,
      providerGrants: Array.isArray(row.provider_grants) ? row.provider_grants : [],
      accessRequestReason: row.access_request_reason,
      accessRequestedAt: row.access_requested_at?.toISOString?.() || row.access_requested_at || null,
      accessReviewedAt: row.access_reviewed_at?.toISOString?.() || row.access_reviewed_at || null,
      accessReviewedByStackUserId: row.access_reviewed_by_stack_user_id,
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
    };
  }

  async createAppUser(record) {
    await this.pool.query(
      `
        INSERT INTO wave_control_app_users (
          id, stack_user_id, email, display_name, role, access_state, provider_grants,
          access_request_reason, access_requested_at, access_reviewed_at,
          access_reviewed_by_stack_user_id, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)
      `,
      [
        record.id,
        record.stackUserId,
        record.email,
        record.displayName,
        record.role,
        record.accessState,
        JSON.stringify(record.providerGrants || []),
        record.accessRequestReason,
        record.accessRequestedAt,
        record.accessReviewedAt,
        record.accessReviewedByStackUserId,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return record;
  }

  async updateAppUser(id, record) {
    const result = await this.pool.query(
      `
        UPDATE wave_control_app_users
        SET stack_user_id = $2,
            email = $3,
            display_name = $4,
            role = $5,
            access_state = $6,
            provider_grants = $7::jsonb,
            access_request_reason = $8,
            access_requested_at = $9,
            access_reviewed_at = $10,
            access_reviewed_by_stack_user_id = $11,
            created_at = $12,
            updated_at = $13
        WHERE id = $1
        RETURNING id
      `,
      [
        id,
        record.stackUserId,
        record.email,
        record.displayName,
        record.role,
        record.accessState,
        JSON.stringify(record.providerGrants || []),
        record.accessRequestReason,
        record.accessRequestedAt,
        record.accessReviewedAt,
        record.accessReviewedByStackUserId,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return result.rowCount > 0 ? record : null;
  }

  async appendAuditEvent(record) {
    await this.pool.query(
      `
        INSERT INTO wave_control_audit_events (
          id, actor_stack_user_id, actor_email, event_type, subject_type, subject_id, payload, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      `,
      [
        record.id,
        record.actorStackUserId,
        record.actorEmail,
        record.eventType,
        record.subjectType,
        record.subjectId,
        JSON.stringify(record.payload || {}),
        record.createdAt,
      ],
    );
    return record;
  }

  async listUserCredentials(appUserId) {
    const result = await this.pool.query(
      `
        SELECT app_user_id, credential_id, algorithm, key_version, ciphertext, iv, auth_tag,
               created_by_type, created_by_id, updated_by_type, updated_by_id,
               created_at, updated_at
        FROM wave_control_user_credentials
        WHERE app_user_id = $1
        ORDER BY updated_at DESC, created_at DESC
      `,
      [appUserId],
    );
    return result.rows.map((row) =>
      sanitizeUserCredentialRecord({
        appUserId: row.app_user_id,
        credentialId: row.credential_id,
        algorithm: row.algorithm,
        keyVersion: row.key_version,
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
        createdByType: row.created_by_type,
        createdById: row.created_by_id,
        updatedByType: row.updated_by_type,
        updatedById: row.updated_by_id,
        createdAt: row.created_at?.toISOString?.() || row.created_at || null,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
      }),
    );
  }

  async findUserCredential(appUserId, credentialId) {
    const result = await this.pool.query(
      `
        SELECT app_user_id, credential_id, algorithm, key_version, ciphertext, iv, auth_tag,
               created_by_type, created_by_id, updated_by_type, updated_by_id,
               created_at, updated_at
        FROM wave_control_user_credentials
        WHERE app_user_id = $1 AND credential_id = $2
        LIMIT 1
      `,
      [appUserId, credentialId],
    );
    const row = result.rows[0] || null;
    if (!row) {
      return null;
    }
    return sanitizeUserCredentialRecord({
      appUserId: row.app_user_id,
      credentialId: row.credential_id,
      algorithm: row.algorithm,
      keyVersion: row.key_version,
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
      createdByType: row.created_by_type,
      createdById: row.created_by_id,
      updatedByType: row.updated_by_type,
      updatedById: row.updated_by_id,
      createdAt: row.created_at?.toISOString?.() || row.created_at || null,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
    });
  }

  async upsertUserCredential(record) {
    const normalized = sanitizeUserCredentialRecord(record);
    await this.pool.query(
      `
        INSERT INTO wave_control_user_credentials (
          app_user_id, credential_id, algorithm, key_version, ciphertext, iv, auth_tag,
          created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (app_user_id, credential_id)
        DO UPDATE SET
          algorithm = EXCLUDED.algorithm,
          key_version = EXCLUDED.key_version,
          ciphertext = EXCLUDED.ciphertext,
          iv = EXCLUDED.iv,
          auth_tag = EXCLUDED.auth_tag,
          updated_by_type = EXCLUDED.updated_by_type,
          updated_by_id = EXCLUDED.updated_by_id,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.appUserId,
        normalized.credentialId,
        normalized.algorithm,
        normalized.keyVersion,
        normalized.ciphertext,
        normalized.iv,
        normalized.authTag,
        normalized.createdByType,
        normalized.createdById,
        normalized.updatedByType,
        normalized.updatedById,
        normalized.createdAt,
        normalized.updatedAt,
      ],
    );
    return normalized;
  }

  async deleteUserCredential(appUserId, credentialId) {
    const existing = await this.findUserCredential(appUserId, credentialId);
    if (!existing) {
      return null;
    }
    await this.pool.query(
      `
        DELETE FROM wave_control_user_credentials
        WHERE app_user_id = $1 AND credential_id = $2
      `,
      [appUserId, credentialId],
    );
    return existing;
  }
}
