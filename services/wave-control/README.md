# Wave Control

`services/wave-control` is the Railway-hosted control plane for Wave telemetry.

It ingests typed run and benchmark events, stores selected artifact metadata, and materializes read APIs plus a minimal operator UI for:

- run timelines
- proof bundles
- gate and closure review
- benchmark validity review
- artifact inspection

## Run Locally

```bash
cd services/wave-control
pnpm install
pnpm start
```

The service listens on `HOST` and `PORT` and defaults to `0.0.0.0:3000`.

## Core Environment

Required for authenticated ingest:

- `WAVE_CONTROL_API_TOKEN` or `WAVE_CONTROL_API_TOKENS`

Optional Postgres:

- `DATABASE_URL`
- `PGSSL`
- `WAVE_CONTROL_DB_MAX_CONNECTIONS`

For production on Railway, attach a Postgres service and expose its `DATABASE_URL` to
`wave-control`. When `DATABASE_URL` is unset, the service falls back to the in-memory
store and telemetry is not durable across restarts.

Optional S3-compatible bucket:

- `WAVE_CONTROL_BUCKET_NAME`
- `WAVE_CONTROL_BUCKET_ENDPOINT`
- `WAVE_CONTROL_BUCKET_ACCESS_KEY_ID`
- `WAVE_CONTROL_BUCKET_SECRET_ACCESS_KEY`
- `WAVE_CONTROL_BUCKET_REGION`
- `WAVE_CONTROL_BUCKET_PUBLIC_BASE_URL`
- `WAVE_CONTROL_BUCKET_SIGNED_URL_TTL_SECONDS`
- `WAVE_CONTROL_BUCKET_FORCE_PATH_STYLE`

Other controls:

- `WAVE_CONTROL_REQUIRE_AUTH_FOR_READS`
- `WAVE_CONTROL_MAX_BATCH_EVENTS`
- `WAVE_CONTROL_MAX_INLINE_ARTIFACT_BYTES`
- `WAVE_CONTROL_UI_TITLE`

## API

Public:

- `GET /api/v1/health`
- `GET /`

Authenticated ingest:

- `POST /api/v1/ingest/batches`

Authenticated reads:

- `GET /api/v1/runs`
- `GET /api/v1/run`
- `GET /api/v1/benchmarks`
- `GET /api/v1/benchmark`
- `GET /api/v1/analytics/overview`
- `GET /api/v1/artifact`
- `POST /api/v1/artifacts/signed-upload`

## Storage Model

- Local Wave runtimes remain authoritative.
- The service stores canonical event envelopes and selected artifact metadata.
- Inline artifact uploads are persisted in Postgres when bucket storage is unavailable.
- When a bucket is configured, inline artifact bodies are moved to object storage and exposed through signed or public download URLs.

## Indexed Identity Dimensions

Wave Control stores and filters telemetry by the run identity carried on each event.

The core dimensions are:

- `workspaceId`
- `projectId`
- `runKind`
- `runId`
- `lane`
- `wave`
- `orchestratorId`
- `runtimeVersion`
- `benchmarkRunId`
- `benchmarkItemId`

This allows the service to separate telemetry by repository/workspace, product/project,
resident orchestrator identity, and installed Wave runtime version without relying on
free-form event payloads.

## Railway Notes

Point Railway at `services/wave-control` as the service root.

The included `railway.json` starts the service with:

```bash
node src/server.mjs
```

Recommended Railway service variables:

- `DATABASE_URL` from the attached Postgres service
- `WAVE_CONTROL_API_TOKEN` for authenticated ingest
- optional `PGSSL=true` if your connection mode requires it
