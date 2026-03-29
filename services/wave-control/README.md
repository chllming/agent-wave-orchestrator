# Wave Control

`services/wave-control` is the backend control plane for Wave telemetry, owned provider brokers, and the authenticated operator surface.

The shipped backend now supports:

- telemetry ingest and analysis APIs
- optional owned-deployment broker routes for Context7 and Corridor
- Stack-authenticated internal app routes
- Wave-managed app-user approval states, roles, and provider grants
- Wave Control-issued personal access tokens for repo runtimes and API clients
- dedicated service tokens for machine-admin workflows
- encrypted per-user arbitrary credentials with write-only management and runtime leasing
- a separate Vite/Lit frontend under `../wave-control-web`

The core design rule is unchanged:

- local Wave runtime state stays authoritative
- remote delivery is best-effort
- the control plane stores typed envelopes and selected artifact metadata rather than becoming the scheduler of record

## Local Development

Backend:

```bash
cd services/wave-control
pnpm install
pnpm dev
```

Tests:

```bash
cd services/wave-control
pnpm test
```

Frontend:

```bash
cd services/wave-control-web
pnpm install
pnpm dev
```

The backend listens on `HOST` and `PORT` and defaults to `0.0.0.0:3000`.

## Deployment Profiles

### Packaged Default Endpoint

The published Wave package defaults to `https://wave-control.up.railway.app/api/v1` with `reportMode: "metadata-only"`.

Use that default only for the packaged telemetry surface.

- typed run and benchmark event ingest
- metadata-first query and artifact inspection
- no provider-secret brokering
- no deployment-owned credential leasing

### Owned Deployment

Use an owned deployment when you want the full control-plane surface:

- Stack-authenticated browser access
- Wave-managed approval states and provider grants
- PATs and service tokens
- encrypted per-user credential storage
- runtime env leasing
- Context7 and Corridor brokering

## Core Environment

Static API tokens for ingest and trusted service-to-service calls:

- `WAVE_CONTROL_API_TOKEN` or `WAVE_API_TOKEN`
- `WAVE_CONTROL_API_TOKENS` or `WAVE_API_TOKENS`

Optional Postgres:

- `DATABASE_URL`
- `PGSSL`
- `WAVE_CONTROL_DB_MAX_CONNECTIONS`

For production on Railway, attach a Postgres service and expose its `DATABASE_URL` to `wave-control`. When `DATABASE_URL` is unset, the service falls back to the in-memory store and telemetry is not durable across restarts.

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
- `WAVE_CONTROL_LOG_LEVEL`

## Stack Browser Auth

Required when enabling the browser-app surface:

- `WAVE_CONTROL_STACK_ENABLED=true`
- `WAVE_CONTROL_STACK_PROJECT_ID`
- `WAVE_CONTROL_STACK_PUBLISHABLE_CLIENT_KEY`
- `STACK_SECRET_SERVER_KEY`
- `WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS`

Optional:

- `WAVE_CONTROL_BOOTSTRAP_SUPERUSER_EMAILS`

Wave Control uses Stack only for browser identity. It then applies its own internal app-user state:

- access states: `pending`, `approved`, `rejected`, `revoked`
- roles: `member`, `superuser`
- provider grants: `anthropic`, `context7`, `corridor`, `openai`

Important distinction:

- Stack proves that the browser user is a confirmed internal user
- Wave Control decides whether that internal user is approved and which providers they may access

## Tokens And Secrets

### Personal Access Tokens

PATs are opaque `wave_pat_*` tokens.

- the service stores only a SHA-256 hash plus metadata
- plaintext is shown once at creation time
- allowed scopes are `broker:read`, `credential:read`, and `ingest:write`
- members may issue PATs for themselves
- superusers may issue or revoke PATs for other approved users
- PAT owners must be bound to a Stack user
- every PAT request is clamped to the owner's current approval state and provider grants

### Service Tokens

`WAVE_CONTROL_SERVICE_TOKENS_JSON` defines separate machine-admin tokens with `service:*` scopes.

Example:

```json
[
  {
    "label": "ops-bot",
    "token": "replace-me",
    "scopes": ["service:read", "service:user:write", "service:credential:write", "service:token:write"]
  }
]
```

Service tokens are intentionally separate from PATs:

- they manage `/api/v1/service/*`
- they can manage users, provider grants, credentials, and PAT issuance for bound users
- they cannot use owner-scoped runtime credential leasing

### Encrypted Stored Credentials

Required for stored per-user credentials and owner-scoped leasing:

- `WAVE_CONTROL_SECRET_ENCRYPTION_KEY`

This must be a base64-encoded 32-byte AES-256-GCM key.

Stored credentials are:

- write-only through admin and service APIs
- encrypted at rest
- never returned through list endpoints
- only revealed through explicit runtime lease responses

## Owned Provider Broker

Use this only on a self-hosted or team-owned deployment.

Base flags:

- `WAVE_BROKER_OWNED_DEPLOYMENT=true`
- `WAVE_BROKER_REQUEST_TIMEOUT_MS`
- `WAVE_BROKER_MAX_RETRIES`
- `WAVE_BROKER_MAX_PAGES`

Context7:

- `WAVE_BROKER_ENABLE_CONTEXT7=true`
- `WAVE_BROKER_CONTEXT7_API_KEY=<key>`

Corridor:

- `WAVE_BROKER_ENABLE_CORRIDOR=true`
- `WAVE_BROKER_CORRIDOR_API_TOKEN=<token>`
- `WAVE_BROKER_CORRIDOR_PROJECT_MAP=<json>`

Deployment-owned provider env leasing:

- `WAVE_BROKER_ENABLE_OPENAI=true`
- `WAVE_BROKER_OPENAI_API_KEY=<key>`
- `WAVE_BROKER_ENABLE_ANTHROPIC=true`
- `WAVE_BROKER_ANTHROPIC_API_KEY=<key>`

Broker and runtime routes:

- `GET /api/v1/providers/context7/search`
- `GET /api/v1/providers/context7/context`
- `POST /api/v1/providers/corridor/context`
- `POST /api/v1/runtime/provider-env`
- `POST /api/v1/runtime/credential-env`

### Corridor Project Mapping

`WAVE_BROKER_CORRIDOR_PROJECT_MAP` maps Wave project ids to Corridor project ids.

Example:

```json
{
  "app": {
    "teamId": "team-uuid",
    "projectId": "corridor-project-uuid"
  }
}
```

The broker route accepts:

```json
{
  "projectId": "app",
  "ownedPaths": ["src/auth", "src/session"],
  "severityThreshold": "critical",
  "findingStates": ["open", "potential"]
}
```

Notes:

- if `findingStates` is omitted, the service defaults to `open` and `potential`
- if the caller sends `findingStates: []`, the service queries all states
- the response is a normalized summary with `guardrails`, `matchedFindings`, `blockingFindings`, `blocking`, and `error`
- upstream Corridor credentials never leave the service

## Runtime Credential Leasing

### Provider Env Leasing

`POST /api/v1/runtime/provider-env` returns deployment-owned provider credentials as env vars.

Currently supported:

- `openai` -> `OPENAI_API_KEY`
- `anthropic` -> `ANTHROPIC_API_KEY`

Requirements:

- owned deployment only
- provider is enabled on the deployment
- caller has `credential:read`
- caller holds the matching provider grant unless it is a trusted env token

### Owner-Scoped Arbitrary Credential Leasing

`POST /api/v1/runtime/credential-env` leases stored user credentials under explicit env var names.

Example:

```json
{
  "credentials": [{ "id": "github_pat", "envVar": "GITHUB_TOKEN" }]
}
```

Requirements:

- approved browser user or the owner's PAT
- `WAVE_CONTROL_SECRET_ENCRYPTION_KEY` configured
- credential already stored for that owner

Service tokens and static env tokens cannot use this route.

## Access Model

| Principal | Main routes | Notes |
| --- | --- | --- |
| Static env token | ingest, query, provider brokers, provider env leasing | trusted deployment credential; bypasses provider grants; not a browser or service principal |
| Approved Stack user | `/api/v1/app/*`, runtime leasing | browser identity plus Wave approval state |
| PAT | ingest, provider brokers, runtime leasing | scopes and provider grants are both enforced |
| Service token | `/api/v1/service/*` | machine-admin only |

One subtle but important rule:

- browser users do not receive `broker:read`

That means broker routes are for PATs or trusted env tokens, while approved browser users are for the app surface and owner-scoped runtime leasing.

## API Surface

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

Stack-authenticated app routes:

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

Wave Control stores and filters telemetry by the run identity carried on each event:

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

## Web Frontend

The browser app lives in `services/wave-control-web` and mirrors the sibling `slowfast.ai` stack shape:

- Vite
- Lit
- small runtime config module
- static-shell styling, not server-rendered HTML

Frontend env vars:

- `VITE_WAVE_CONTROL_API_BASE_URL`
- `VITE_STACK_PROJECT_ID`
- `VITE_STACK_PUBLISHABLE_CLIENT_KEY`
- `WAVE_CONTROL_WEB_BASE_PATH`

Compatibility fallbacks:

- `NEXT_PUBLIC_STACK_PROJECT_ID`
- `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY`

`VITE_WAVE_CONTROL_API_BASE_URL` may be set to either the service origin or the full API base ending in `/api/v1`; the web app normalizes the configured value before appending route paths.

The browser app:

- persists the Stack session across reloads
- completes OAuth and magic-link callbacks on the same app path
- only renders sign-in methods enabled in the Stack project
- loads `/api/v1/app/session` first after sign-in
- shows access-request flows for internal users who are not yet approved
- exposes a superuser-only Users tab for approvals, role changes, provider grants, and write-only user credential rotation

## Railway Notes

Point Railway at `services/wave-control` as the service root.

The included `railway.json` starts the service with:

```bash
node src/server.mjs
```

Recommended Railway service variables:

- `DATABASE_URL` from the attached Postgres service
- `WAVE_CONTROL_API_TOKEN` or `WAVE_API_TOKEN` for authenticated ingest
- optional `PGSSL=true` if your connection mode requires it
