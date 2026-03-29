---
title: "Wave Control"
summary: "Canonical telemetry, owned deployment auth, broker routes, credential leasing, and the local-first reporting contract for the Wave control plane."
---

# Wave Control

Wave Control is the control and observability plane for Wave runs.

The design rule is:

- local canonical state stays authoritative
- remote reporting is best-effort
- dashboards, summaries, and the browser UI remain projections over typed local or persisted state

The packaged default endpoint is:

- `https://wave-control.up.railway.app/api/v1`

That packaged endpoint is for the default metadata-reporting surface. The owned-deployment features described below, such as provider brokering and runtime credential leasing, are intentionally meant for self-hosted or team-owned `wave-control` deployments.

## Deployment Profiles

### Packaged Default Endpoint

This is the release default in `@chllming/wave-orchestration@0.9.2`.

- receives local-first telemetry uploads
- supports normal run and benchmark query surfaces
- uses `reportMode: "metadata-only"` by default
- does not act as a provider-secret broker for Corridor, Context7, or leased runtime credentials

### Owned Deployment

This is the full control-plane model backed by `services/wave-control/` and, optionally, `services/wave-control-web/`.

An owned deployment can add:

- Stack-authenticated browser access
- Wave-managed app-user approval states and provider grants
- personal access tokens for repo runtimes and API clients
- dedicated service tokens for machine-admin workflows
- encrypted per-user stored credentials with owner-scoped runtime leasing
- broker routes for Context7 and Corridor
- provider env leasing for deployment-owned OpenAI and Anthropic credentials

## What Gets Reported

Wave Control normalizes these entity types:

- `wave_run`
- `agent_run`
- `wave_signal`
- `agent_signal`
- `coordination_record`
- `task`
- `attempt`
- `gate`
- `proof_bundle`
- `rerun_request`
- `human_input`
- `artifact`
- `contradiction`
- `fact`
- `benchmark_run`
- `benchmark_item`
- `verification`
- `review`

This lets the control plane answer:

- what happened in a run
- which proof and benchmark artifacts back a claim
- whether a benchmark result is comparison-valid or only diagnostic
- which coordination failures blocked closure
- which blockers were hard, soft, stale, or advisory
- whether a blocked wave is terminal or recoverable and which targeted rerun request was queued

## Run Identity

Every Wave Control event carries a normalized run identity.

The key fields are:

- `workspaceId`
- `projectId`
- `runKind`
- `runId`
- `lane`
- `wave`
- `attempt`
- `agentId`
- `orchestratorId`
- `runtimeVersion`
- `benchmarkRunId`
- `benchmarkItemId`

Why these fields matter:

- `workspaceId` separates whole adopted workspaces
- `projectId` separates product or repo identities inside one control plane
- `orchestratorId` separates resident orchestrators or control-plane owners
- `runtimeVersion` lets operators compare behavior across Wave releases without guessing from deploy timestamps

These are first-class query dimensions in the service, not only free-form event payload fields.

## Proof Signals

Wave Control is intended to make the main README claims measurable.

For the explicit README-failure-case-to-signal map, see [proof-metrics.md](./proof-metrics.md).

Signals to preserve:

- canonical-state fidelity:
  `coordination_record`, `wave_run`, `attempt`, `artifact`, `contradiction`, and `fact` telemetry prove decisions came from canonical structured state, not only markdown boards or summaries
- evidence pooling:
  integration and closure telemetry should cite the proof artifacts and evidence refs they relied on
- contradiction repair:
  gate and review telemetry should show unresolved conflicts, repair creation, and repair resolution
- expert routing:
  targeted assignments, reroutes, and final recommendation ownership should remain visible
- premature closure prevention:
  gate snapshots, proof completeness, block reasons, reruns, and `cont-QA` reversal should be durable
- benchmark trust:
  every benchmark item should distinguish capability from validity

## Artifact Contract

Selected artifacts are described with typed descriptors:

```json
{
  "path": ".tmp/main-wave-launcher/traces/wave-1/attempt-1/quality.json",
  "kind": "trace-quality",
  "required": true,
  "present": true,
  "sha256": "abc123...",
  "bytes": 2048,
  "contentType": "application/json",
  "uploadPolicy": "selected"
}
```

Upload policy meanings:

- `local-only`: keep only the descriptor remotely
- `metadata-only`: report path, hash, size, and presence only
- `selected`: upload metadata plus the artifact body when the runtime is in `metadata-plus-selected` or `full-artifact-upload` and the artifact kind is allowed by `waveControl.uploadArtifactKinds`
- `full`: upload the artifact body in `full-artifact-upload` flows; if `uploadArtifactKinds` is set, keep the kind allowlist aligned with that policy

## Repo Runtime Config

`wave.config.json` can declare:

```json
{
  "waveControl": {
    "endpoint": "https://wave-control.up.railway.app/api/v1",
    "workspaceId": "my-workspace",
    "projectId": "app",
    "authTokenEnvVar": "WAVE_API_TOKEN",
    "credentialProviders": ["openai"],
    "credentials": [{ "id": "github_pat", "envVar": "GITHUB_TOKEN" }],
    "reportMode": "metadata-only",
    "uploadArtifactKinds": [
      "trace-run-metadata",
      "trace-quality",
      "benchmark-results"
    ]
  }
}
```

Packaged defaults:

- endpoint: `https://wave-control.up.railway.app/api/v1`
- enabled: `true`
- report mode: `metadata-only`
- identity defaults to the resolved project, lane, wave, run kind, and run id
- primary auth token env var: `WAVE_API_TOKEN`
- compatibility fallback auth token env var: `WAVE_CONTROL_AUTH_TOKEN`

Lane overrides may refine the same surface under `lanes.<lane>.waveControl` or `projects.<projectId>.lanes.<lane>.waveControl`.

For a single run, operators can disable Wave Control reporting entirely with:

```bash
pnpm exec wave launch --lane main --no-telemetry
```

Repo or project config may also opt out with:

```json
{
  "waveControl": {
    "enabled": false
  }
}
```

That suppresses the local telemetry spool and remote delivery for that invocation, while leaving the canonical runtime artifacts and local control-plane state intact.

## API Surfaces

Wave Control exposes five main route families.

### Public

- `GET /api/v1/health`
- `GET /`

### Ingest And Query

- `POST /api/v1/ingest/batches`
- `GET /api/v1/runs`
- `GET /api/v1/run`
- `GET /api/v1/benchmarks`
- `GET /api/v1/benchmark`
- `GET /api/v1/analytics/overview`
- `GET /api/v1/artifact`
- `POST /api/v1/artifacts/signed-upload`

### Browser-App Routes

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

### Provider And Runtime Lease Routes

- `GET /api/v1/providers/context7/search`
- `GET /api/v1/providers/context7/context`
- `POST /api/v1/providers/corridor/context`
- `POST /api/v1/runtime/provider-env`
- `POST /api/v1/runtime/credential-env`

### Service-Token Machine Routes

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

## Access Model

Route access depends on both principal type and scope.

| Principal | How it authenticates | Main routes | Notes |
| --- | --- | --- | --- |
| Static env token | `WAVE_CONTROL_API_TOKEN(S)` or `WAVE_API_TOKEN(S)` | ingest, query, provider brokers, provider env leasing | trusted service-to-service path; bypasses provider-grant checks; does not use browser-app or service-token routes |
| Stack user | `x-stack-access-token` plus internal-team membership | `/api/v1/app/*`; approved users may also call runtime lease routes | Stack proves identity first; Wave Control then applies `pending`, `approved`, `rejected`, or `revoked` plus `member`/`superuser` |
| PAT | `Authorization: Bearer wave_pat_*` | ingest, provider brokers, provider env leasing, owner-scoped credential leasing | PAT scopes and provider grants are both enforced; owner approval state is re-checked on every request |
| Service token | `WAVE_CONTROL_SERVICE_TOKENS_JSON` | `/api/v1/service/*` | machine-admin only; cannot use owner-scoped credential leasing |

Two rules matter:

1. scopes and provider grants are separate
2. browser users do not receive `broker:read`

That means:

- a PAT needs `broker:read` plus the matching provider grant to use Corridor or Context7 broker routes
- a PAT or approved browser user needs `credential:read` plus the matching provider grant to use `POST /api/v1/runtime/provider-env`
- `POST /api/v1/runtime/credential-env` is owner-scoped and only works for an approved browser user or the owner's PAT
- static env tokens can still use ingest, query, broker, and provider-env routes as trusted deployment credentials

If `WAVE_CONTROL_REQUIRE_AUTH_FOR_READS=false`, the read/query routes may be public. Auth requirements for app, broker, lease, and service routes do not change.

## Stack App-User Model

Wave Control uses Stack as the browser login system, but it keeps its own authorization state on top of that identity.

Required backend env for browser auth:

- `WAVE_CONTROL_STACK_ENABLED=true`
- `WAVE_CONTROL_STACK_PROJECT_ID`
- `WAVE_CONTROL_STACK_PUBLISHABLE_CLIENT_KEY`
- `STACK_SECRET_SERVER_KEY`
- `WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS`

Flow:

1. Stack authenticates the browser user.
2. Wave Control verifies the user is a confirmed member of `WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS`.
3. Wave Control resolves or creates its own internal app-user record.
4. That app-user record carries:
   - `accessState`: `pending`, `approved`, `rejected`, or `revoked`
   - `role`: `member` or `superuser`
   - `providerGrants`: allowlisted provider ids such as `context7`, `corridor`, `openai`, or `anthropic`

Bootstrap behavior:

- `WAVE_CONTROL_BOOTSTRAP_SUPERUSER_EMAILS` auto-provisions approved superusers on first sign-in for listed emails
- superusers automatically receive all provider grants
- members receive only the grants explicitly assigned to them

Important distinction:

- Stack identity decides who is a real internal user
- Wave Control app-user state decides who is approved and what they may do

## Personal Access Tokens

Wave Control PATs are opaque `wave_pat_*` tokens.

The service stores:

- only a SHA-256 hash of the token
- metadata such as owner, scopes, creation time, last-used time, and revocation time

The plaintext token is shown once at creation time.

PAT rules:

- allowlisted scopes: `broker:read`, `credential:read`, `ingest:write`
- members may issue PATs for themselves
- superusers may issue or revoke PATs for any approved user
- unsupported scopes, including `*`, are rejected
- PAT owners must be bound to a Stack user
- PAT requests are clamped to the owner's current approval state and provider grants every time the token is used

PATs are the intended token type for repo runtimes that need broker access or runtime env leasing without using a long-lived deployment-wide env token.

## Service Tokens

`WAVE_CONTROL_SERVICE_TOKENS_JSON` defines dedicated machine-admin tokens with `service:*` scopes.

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

- they access `/api/v1/service/*`
- they can manage users, provider grants, credentials, and PAT issuance for bound users
- they cannot impersonate a browser user
- they cannot use the owner-scoped `POST /api/v1/runtime/credential-env` route

## Credential Leasing

Wave Control supports two different leasing models.

### Provider Env Leasing

`POST /api/v1/runtime/provider-env` returns deployment-owned provider secrets as runtime env vars.

Current supported providers:

- `openai` -> `OPENAI_API_KEY`
- `anthropic` -> `ANTHROPIC_API_KEY`

Requirements:

- owned deployment only
- provider is enabled on the deployment
- caller has `credential:read`
- caller holds the matching provider grant unless it is a trusted env token

### Arbitrary Per-User Credential Leasing

`POST /api/v1/runtime/credential-env` leases user-owned stored credentials under requested env var names.

Example request:

```json
{
  "credentials": [
    { "id": "github_pat", "envVar": "GITHUB_TOKEN" }
  ]
}
```

Requirements:

- `WAVE_CONTROL_SECRET_ENCRYPTION_KEY` must be configured as a base64-encoded 32-byte AES-256-GCM key
- the caller must be the approved browser user or that user's PAT
- service tokens and env tokens are rejected
- the requested credential id must already exist for that owner

Stored credentials are:

- write-only through the admin and service management APIs
- encrypted at rest
- never returned through list endpoints
- only revealed through explicit lease responses

## Provider Brokers

Broker routes are intended for owned deployments only.

### Context7

- `GET /api/v1/providers/context7/search`
- `GET /api/v1/providers/context7/context`

Requirements:

- `WAVE_BROKER_OWNED_DEPLOYMENT=true`
- `WAVE_BROKER_ENABLE_CONTEXT7=true`
- `WAVE_BROKER_CONTEXT7_API_KEY`
- PAT or env token with `broker:read`
- matching `context7` provider grant for PAT callers

### Corridor

- `POST /api/v1/providers/corridor/context`

Requirements:

- `WAVE_BROKER_OWNED_DEPLOYMENT=true`
- `WAVE_BROKER_ENABLE_CORRIDOR=true`
- `WAVE_BROKER_CORRIDOR_API_TOKEN`
- `WAVE_BROKER_CORRIDOR_PROJECT_MAP`
- PAT or env token with `broker:read`
- matching `corridor` provider grant for PAT callers

Example project map:

```json
{
  "app": {
    "teamId": "team-uuid",
    "projectId": "corridor-project-uuid"
  }
}
```

Example request:

```json
{
  "projectId": "app",
  "ownedPaths": ["src/auth", "src/session"],
  "severityThreshold": "critical",
  "findingStates": ["open", "potential"]
}
```

Broker semantics:

- if `findingStates` is omitted, the service defaults to `open` and `potential`
- if the caller sends `findingStates: []`, the service queries all states
- the service returns a normalized summary with `guardrails`, `matchedFindings`, `blockingFindings`, `blocking`, and `error`
- upstream provider secrets never leave the owned deployment

For the runtime-side lifecycle, owned-path matching, and closure semantics, see [corridor.md](./corridor.md).

## Browser App

The frontend package lives at `services/wave-control-web/`.

It is a Vite/Lit app with Stack browser auth and a static shell.

Frontend env:

- `VITE_WAVE_CONTROL_API_BASE_URL`
- `VITE_STACK_PROJECT_ID`
- `VITE_STACK_PUBLISHABLE_CLIENT_KEY`
- `WAVE_CONTROL_WEB_BASE_PATH` for non-root deploy paths

Compatibility fallbacks:

- `NEXT_PUBLIC_STACK_PROJECT_ID`
- `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY`

`VITE_WAVE_CONTROL_API_BASE_URL` may point at either:

- the Wave Control origin, such as `https://control.example.test`
- or the full `/api/v1` base

The frontend normalizes either form before appending route paths.

Runtime behavior:

- persists the Stack browser session across reloads
- completes OAuth and magic-link callbacks on the same app path
- only renders sign-in methods enabled in the Stack project
- loads `/api/v1/app/session` first after sign-in
- shows the request-access flow for internal users who are not yet approved
- exposes a superuser-only Users tab for approvals, role changes, provider grants, and write-only user credential rotation

## Delivery Model

Wave Control reporting should:

- append local telemetry first
- queue pending uploads under `.tmp/<lane>-wave-launcher/control-plane/telemetry/` for the implicit default project, or `.tmp/projects/<projectId>/<lane>-wave-launcher/control-plane/telemetry/` for explicit projects
- respect `waveControl.uploadArtifactKinds` before uploading any selected artifact body
- cap pending remote uploads with `waveControl.maxPendingEvents` by dropping the oldest queued remote-delivery files, while keeping the local `events.jsonl` stream intact
- retry delivery with idempotency keys
- never fail a live run, proof registration, or benchmark because the network is unavailable

The Railway-hosted `services/wave-control` service is an analysis surface, not the scheduler of record.

## Storage And Durability

For durable telemetry retention, attach Railway Postgres to `wave-control` so the service receives `DATABASE_URL`.

Without that variable, the service falls back to the in-memory store and only keeps data until the process restarts.

Optional object storage may be configured through the `WAVE_CONTROL_BUCKET_*` variables for larger inline artifact bodies and signed-download URLs.
