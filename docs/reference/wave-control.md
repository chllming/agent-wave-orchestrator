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
- `selected`: upload metadata plus the artifact body when the runtime is in `metadata-plus-selected`
- `selected`: upload metadata plus the artifact body when the runtime is in `metadata-plus-selected` or `full-artifact-upload` **and** the artifact kind is allowed by `waveControl.uploadArtifactKinds`
- `full`: upload the artifact body in `full-artifact-upload` flows; if `uploadArtifactKinds` is set, keep the kind allowlist aligned with that policy

## Runtime Config

`wave.config.json` can declare:

```json
{
  "waveControl": {
    "endpoint": "https://wave-control.up.railway.app/api/v1",
    "workspaceId": "my-workspace",
    "projectId": "wave-orchestration",
    "authTokenEnvVar": "WAVE_CONTROL_AUTH_TOKEN",
    "reportMode": "metadata-plus-selected",
    "uploadArtifactKinds": [
      "trace-run-metadata",
      "trace-quality",
      "benchmark-results"
    ]
  }
}
```

Lane overrides may refine the same surface under `lanes.<lane>.waveControl`.

For a single run, operators can disable Wave Control reporting entirely with:

```bash
pnpm exec wave launch --lane main --no-telemetry
```

That suppresses the local telemetry spool and remote delivery for that invocation, while leaving the canonical runtime artifacts and local control-plane state intact.

## Delivery Model

Wave Control reporting should:

- append local telemetry first
- queue pending uploads under `.tmp/<lane>-wave-launcher/control-plane/telemetry/`
- respect `waveControl.uploadArtifactKinds` before uploading any selected artifact body
- cap pending remote uploads with `waveControl.maxPendingEvents` by dropping the oldest queued remote-delivery files, while keeping the local `events.jsonl` stream intact
- retry delivery with idempotency keys
- never fail a live run, proof registration, or benchmark because the network is unavailable

The Railway-hosted `services/wave-control` service is an analysis surface, not the scheduler of record.

The service package lives under `services/wave-control/`.

For durable telemetry retention, attach Railway Postgres to `wave-control` so the
service receives `DATABASE_URL`. Without that variable, the service falls back to the
in-memory store and only keeps data until the process restarts.
