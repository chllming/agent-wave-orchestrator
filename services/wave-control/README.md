# Wave Control

Wave Control now supports:

- telemetry ingest and analysis APIs
- optional owned-deployment broker routes for Context7 and Corridor
- Stack-authenticated internal app routes
- Wave-managed user approval, superusers, and per-user provider grants
- Wave Control-issued personal access tokens for CLI, broker, and runtime credential leasing
- dedicated service tokens for machine-admin workflows
- encrypted per-user arbitrary credentials with write-only management and runtime leasing
- a separate slowfast-style Vite/Lit frontend under `../wave-control-web`

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
- `WAVE_CONTROL_ALLOWED_ORIGINS`
- `WAVE_CONTROL_SERVICE_TOKENS_JSON` (JSON array of dedicated machine tokens and `service:*` scopes)
- `WAVE_CONTROL_SECRET_ENCRYPTION_KEY` (base64-encoded 32-byte AES-256-GCM key required for stored user credentials)

Stack/browser auth:

- `WAVE_CONTROL_STACK_ENABLED=true`
- `WAVE_CONTROL_STACK_PROJECT_ID`
- `WAVE_CONTROL_STACK_PUBLISHABLE_CLIENT_KEY`
- `STACK_SECRET_SERVER_KEY`
- `WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS` (required; app routes fail closed when it is unset, and internal access is derived from confirmed Stack team memberships only)
- `WAVE_CONTROL_BOOTSTRAP_SUPERUSER_EMAILS` (comma-separated emails that auto-provision as approved Wave Control superusers on first Stack sign-in)

Wave Control now uses its own app-user state on top of Stack identity:

- Stack remains the login system
- only Stack-authenticated members of `WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS` can reach the app surface
- Wave Control then decides whether that internal user is `pending`, `approved`, `rejected`, or `revoked`
- approved users have a Wave role of `member` or `superuser`
- only Wave superusers can approve users, manage roles, and change provider grants

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

Stack-authenticated internal app routes:

- `GET /api/v1/app/session`
- `POST /api/v1/app/access-request`
- `GET /api/v1/app/me`
- `GET /api/v1/app/overview`
- `GET /api/v1/app/runs`
- `GET /api/v1/app/run`
- `GET /api/v1/app/benchmarks`
- `GET /api/v1/app/benchmark`
- `GET /api/v1/app/tokens`
- `POST /api/v1/app/tokens`
- `POST /api/v1/app/tokens/:id/revoke`
- `GET /api/v1/app/admin/users`
- `POST /api/v1/app/admin/users`
- `POST /api/v1/app/admin/users/:id/state`
- `POST /api/v1/app/admin/users/:id/role`
- `POST /api/v1/app/admin/users/:id/providers`
- `GET /api/v1/app/admin/users/:id/credentials`
- `PUT /api/v1/app/admin/users/:id/credentials/:credentialId`
- `DELETE /api/v1/app/admin/users/:id/credentials/:credentialId`

Service-token machine routes:

- `GET /api/v1/service/session`
- `GET /api/v1/service/users`
- `POST /api/v1/service/users`
- `POST /api/v1/service/users/:id/state`
- `POST /api/v1/service/users/:id/role`
- `POST /api/v1/service/users/:id/providers`
- `GET /api/v1/service/users/:id/credentials`
- `PUT /api/v1/service/users/:id/credentials/:credentialId`
- `DELETE /api/v1/service/users/:id/credentials/:credentialId`
- `POST /api/v1/service/users/:id/tokens`
- `POST /api/v1/service/tokens/:id/revoke`

## Storage Model

- Local Wave runtimes remain authoritative.
- The service stores canonical event envelopes and selected artifact metadata.
- Inline artifact uploads are persisted in Postgres when bucket storage is unavailable.
- When a bucket is configured, inline artifact bodies are moved to object storage and exposed through signed or public download URLs.

## Indexed Identity Dimensions

Wave Control stores and filters telemetry by the run identity carried on each event.

## Owned Provider Broker

Use this only on a self-hosted or team-owned deployment.

- `WAVE_API_TOKEN` or `WAVE_API_TOKENS`: bearer tokens accepted by the service
- `WAVE_BROKER_OWNED_DEPLOYMENT=true`: required to enable provider broker routes
- `WAVE_BROKER_ENABLE_CONTEXT7=true`
- `WAVE_BROKER_CONTEXT7_API_KEY=<key>`
- `WAVE_BROKER_ENABLE_CORRIDOR=true`
- `WAVE_BROKER_CORRIDOR_API_TOKEN=<token>`
- `WAVE_BROKER_CORRIDOR_PROJECT_MAP=<json>`
- `WAVE_BROKER_ENABLE_OPENAI=true`
- `WAVE_BROKER_OPENAI_API_KEY=<key>`
- `WAVE_BROKER_ENABLE_ANTHROPIC=true`
- `WAVE_BROKER_ANTHROPIC_API_KEY=<key>`

Broker routes:

- `GET /api/v1/providers/context7/search`
- `GET /api/v1/providers/context7/context`
- `POST /api/v1/providers/corridor/context`
- `POST /api/v1/runtime/provider-env`
- `POST /api/v1/runtime/credential-env`

`WAVE_BROKER_CORRIDOR_PROJECT_MAP` should map Wave project ids to Corridor ids, for example:

```json
{
  "app": {
    "teamId": "team-uuid",
    "projectId": "corridor-project-uuid"
  }
}
```

These routes require the normal Wave bearer token. Context7 and Corridor remain broker-only: the service never returns those upstream secrets.

`POST /api/v1/runtime/provider-env` is the fixed-provider credential-leasing route. It accepts a provider list and returns only the enabled, granted environment variables for env-leased providers:

- `openai` -> `OPENAI_API_KEY`
- `anthropic` -> `ANTHROPIC_API_KEY`

Runtime leasing requires:

- a PAT or env token with `credential:read`
- the caller to hold the matching provider grant
- the provider to be enabled on the owned deployment

`POST /api/v1/runtime/credential-env` is the arbitrary per-user credential-leasing route. It accepts an explicit list of `{ id, envVar }` mappings and returns only the caller's own stored secrets under those env var names. Service tokens cannot call this route.

Stored user credentials are:

- write-only through the admin and service management APIs
- encrypted at rest with `WAVE_CONTROL_SECRET_ENCRYPTION_KEY`
- returned only through lease responses, never through list or management reads

`WAVE_CONTROL_SERVICE_TOKENS_JSON` configures the separate machine-admin surface. Example:

```json
[
  {
    "label": "ops-bot",
    "token": "replace-me",
    "scopes": ["service:read", "service:user:write", "service:credential:write", "service:token:write"]
  }
]
```

## Personal Access Tokens

Wave Control PATs are opaque `wave_pat_*` tokens. The service stores only a SHA-256 hash plus metadata and shows the plaintext value once at creation time.

PATs are user-owned and are clamped to the owner's current approval state and provider grants.

Scope behavior:

- approved-user PAT scopes: `broker:read`, `credential:read`, `ingest:write`
- members may issue PATs for themselves
- superusers may issue or revoke PATs for any approved user
- PAT scope requests outside the allowlist are rejected, including `*`
- PAT lease and broker requests still re-check the owner's current provider grants and approval state on every request

Broker routes also require a matching provider grant:

- `context7` grant for Context7 broker reads
- `corridor` grant for Corridor broker reads

Static env tokens still work and keep full service access. PATs are intended for repo runtimes and the owned broker / credential-leasing path.

## Web Frontend

The new browser app lives in `services/wave-control-web` and mirrors the sibling `slowfast.ai` stack shape:

- Vite
- Lit
- small runtime config module
- static-shell styling, not server-rendered HTML

Run it locally with:

```bash
cd services/wave-control-web
pnpm install
pnpm dev
```

Frontend env vars:

- `VITE_WAVE_CONTROL_API_BASE_URL`
- `VITE_STACK_PROJECT_ID`
- `VITE_STACK_PUBLISHABLE_CLIENT_KEY`

The frontend also accepts `NEXT_PUBLIC_STACK_PROJECT_ID` and `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY` as compatibility fallbacks.
`VITE_WAVE_CONTROL_API_BASE_URL` may be set to either the service origin (for example
`https://control.example.test`) or the full API base ending in `/api/v1`; the web app normalizes the
configured value before appending its route paths.

The browser app persists the Stack session across reloads, completes OAuth and magic-link callbacks on the same app path, and only renders sign-in methods that are enabled in the Stack project configuration.

After sign-in, the app loads `/api/v1/app/session` first:

- approved users continue into the main control-plane UI
- internal users who are not yet approved see the request-access flow
- superusers get an additional Users tab for approvals, role changes, provider grants, and write-only user credential rotation

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
