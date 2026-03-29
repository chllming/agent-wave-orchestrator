---
title: "Wave Control"
summary: "Canonical telemetry, artifact upload policy, and the local-first reporting contract for the Railway-hosted Wave control plane."
---

# Wave Control

Wave Control is the telemetry and analysis plane for Wave runs.

The design rule is:

- local canonical state stays authoritative
- remote reporting is best-effort
- dashboards and markdown remain projections over typed local state

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
  gate snapshots, proof completeness, block reasons, reruns, and cont-QA reversal should be durable
- benchmark trust:
  every benchmark item should distinguish capability from validity

## Blocker And Recovery Metadata

Wave Control should preserve the softer runtime policy, not flatten it away.

In practice that means `coordination_record`, `task`, `gate`, `wave_run`, and `rerun_request` payloads should keep fields such as:

- `blocking`
- `blockerSeverity`
- `recoverable`
- `recoveryReason`
- queued rerun request ids or resume targets

That distinction matters because a wave that is `blocked` by a proof-critical gate is different from a wave that is `blocked` only long enough to surface a targeted recovery after timeout, max-turn, rate-limit, or missing-status failure. The control plane should let operators ask which barriers still stop closure outright and which ones were intentionally downgraded to advisory or stale context.

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
- `selected`: upload metadata plus the artifact body when the runtime is in `metadata-plus-selected` or `full-artifact-upload` **and** the artifact kind is allowed by `waveControl.uploadArtifactKinds`
- `full`: upload the artifact body in `full-artifact-upload` flows; if `uploadArtifactKinds` is set, keep the kind allowlist aligned with that policy

## Runtime Config

`wave.config.json` can declare:

```json
{
  "waveControl": {
    "endpoint": "https://wave-control.up.railway.app/api/v1",
    "workspaceId": "my-workspace",
    "projectId": "app",
    "authTokenEnvVar": "WAVE_API_TOKEN",
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

This package is distributed with the author's personal Wave Control endpoint enabled by default. Repos that do not want telemetry delivered there must explicitly opt out.

Wave Control can also act as an owned broker for Context7 and Corridor when that service-side surface is explicitly enabled. In that mode, the repo runtime authenticates once with `WAVE_API_TOKEN`, and the service uses deployment-owned provider secrets such as `WAVE_BROKER_CONTEXT7_API_KEY` and `WAVE_BROKER_CORRIDOR_API_TOKEN`. Broker routes are intentionally rejected on the packaged default endpoint.

Wave Control now also supports a separate browser app and browser-authenticated app routes:

- Stack Auth verifies internal-team browser users on the backend with `STACK_SECRET_SERVER_KEY`, and `WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS` is required when that surface is enabled
- internal/admin access comes from confirmed Stack team memberships, not `selected_team` or other team-shaped user payload fields
- admin-team members can issue and revoke Wave Control PATs
- PATs are intended for CLI/runtime use such as `WAVE_API_TOKEN`, with the allowlisted scopes `broker:read` and `ingest:write`
- the frontend package lives at `services/wave-control-web`, persists the Stack browser session across reloads, and mirrors the Stack project's enabled auth methods

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

## Delivery Model

Wave Control reporting should:

- append local telemetry first
- queue pending uploads under `.tmp/<lane>-wave-launcher/control-plane/telemetry/` for the implicit default project, or `.tmp/projects/<projectId>/<lane>-wave-launcher/control-plane/telemetry/` for explicit projects
- respect `waveControl.uploadArtifactKinds` before uploading any selected artifact body
- cap pending remote uploads with `waveControl.maxPendingEvents` by dropping the oldest queued remote-delivery files, while keeping the local `events.jsonl` stream intact
- retry delivery with idempotency keys
- never fail a live run, proof registration, or benchmark because the network is unavailable

The Railway-hosted `services/wave-control` service is an analysis surface, not the scheduler of record.

The service package lives under `services/wave-control/`.

The web frontend package lives under `services/wave-control-web/`.

For durable telemetry retention, attach Railway Postgres to `wave-control` so the
service receives `DATABASE_URL`. Without that variable, the service falls back to the
in-memory store and only keeps data until the process restarts.
