---
title: "Corridor"
summary: "How Wave loads Corridor security context, matches findings against implementation-owned paths, and uses the result during closure."
---

# Corridor

Corridor is Wave's optional external security-context provider.

It does not replace the report-owning security reviewer. Instead, it adds a machine-readable guardrail and findings input that Wave can materialize before security and integration closure run.

Use it when you want Wave to:

- pull guardrail or findings context for a project
- filter that context down to the implementation-owned paths in the current wave
- persist the normalized result as a runtime artifact
- fail closure automatically when the fetch fails or matched findings cross a configured severity threshold

## Modes

Wave supports three Corridor modes under `externalProviders.corridor`:

```json
{
  "externalProviders": {
    "corridor": {
      "enabled": true,
      "mode": "hybrid",
      "baseUrl": "https://app.corridor.dev/api",
      "apiTokenEnvVar": "CORRIDOR_API_TOKEN",
      "apiKeyFallbackEnvVar": "CORRIDOR_API_KEY",
      "teamId": "corridor-team-id",
      "projectId": "corridor-project-id",
      "severityThreshold": "critical",
      "findingStates": ["open", "potential"],
      "requiredAtClosure": true
    }
  }
}
```

- `direct`
  Wave calls Corridor from the repo runtime with `CORRIDOR_API_TOKEN` or the fallback `CORRIDOR_API_KEY`.
- `broker`
  Wave calls an owned `wave-control` deployment with `WAVE_API_TOKEN`, and that service uses deployment-owned Corridor credentials.
- `hybrid`
  Wave tries the owned `wave-control` broker first and falls back to direct auth if broker setup or broker delivery fails.

Notes:

- direct mode requires both `teamId` and `projectId` in config; the live fetches use `projectId`, while `teamId` keeps the project identity explicit in repo config
- broker mode requires an owned Wave Control endpoint; the packaged default endpoint intentionally rejects Corridor brokering
- if `findingStates` is omitted or set to `[]`, Wave does not filter by finding state and the provider may return all states
- if you only want active findings, set `findingStates` explicitly, for example `["open", "potential"]`

## What Wave Matches

Wave does not send every file in the repo to Corridor matching.

The runtime builds the relevant path set from implementation-owned paths in the current wave:

- security reviewers are excluded
- design stewards are excluded
- integration, documentation, and `cont-QA` owners are excluded
- `cont-EVAL` only contributes owned paths when that agent is implementation-owning
- `.tmp/` paths are excluded
- `docs/` paths are excluded
- `.md` and `.txt` files are excluded

That means Corridor is aimed at code and implementation-owned assets, not shared-plan markdown or generated launcher state.

Matching is path-prefix based:

- an exact file match counts
- a finding under a matched owned directory also counts
- unmatched findings remain in the upstream provider but are dropped from the normalized Wave artifact

## Generated Artifact

Wave writes the normalized Corridor artifact to:

- `.tmp/<lane>-wave-launcher/security/wave-<n>-corridor.json`
- `.tmp/projects/<projectId>/<lane>-wave-launcher/security/wave-<n>-corridor.json` for explicit projects

Representative shape:

```json
{
  "schemaVersion": 1,
  "wave": 7,
  "lane": "main",
  "projectId": "app",
  "providerMode": "broker",
  "source": "wave-control-broker",
  "requiredAtClosure": true,
  "severityThreshold": "critical",
  "fetchedAt": "2026-03-29T12:00:00.000Z",
  "relevantOwnedPaths": ["src/auth", "src/session"],
  "guardrails": [{ "id": "r1", "name": "No secrets" }],
  "matchedFindings": [
    {
      "id": "f1",
      "title": "Hardcoded token",
      "affectedFile": "src/auth/token.ts",
      "severity": "critical",
      "state": "open",
      "matchedOwnedPaths": ["src/auth"]
    }
  ],
  "blockingFindings": [
    {
      "id": "f1",
      "title": "Hardcoded token",
      "affectedFile": "src/auth/token.ts",
      "severity": "critical",
      "state": "open",
      "matchedOwnedPaths": ["src/auth"]
    }
  ],
  "blocking": true,
  "error": null
}
```

Important fields:

- `providerMode`: the configured mode after runtime resolution
- `source`: the actual fetch source such as direct Corridor API or owned Wave Control broker
- `relevantOwnedPaths`: the implementation-owned paths Wave considered eligible for matching
- `guardrails`: normalized provider-side guardrail/report metadata
- `matchedFindings`: findings that hit the wave's eligible owned paths
- `blockingFindings`: matched findings whose severity meets or exceeds `severityThreshold`
- `blocking`: whether the Corridor result alone is enough to fail the security gate
- `error`: the fetch or broker error when the load failed

If the wave has no eligible implementation-owned paths, Wave still writes a successful artifact with `blocking: false` and a `detail` explaining that nothing qualified for matching.

## Closure Behavior

Corridor is evaluated before security review finishes.

The security gate behaves like this:

1. If Corridor is disabled, Wave ignores it.
2. If Corridor is enabled and the fetch fails:
   - `requiredAtClosure: true` turns that into `corridor-fetch-failed`
   - `requiredAtClosure: false` keeps the failure visible in summaries without hard-failing the gate
3. If Corridor loads and matched findings meet the configured threshold:
   - the gate fails as `corridor-blocked`
4. If Corridor loads cleanly:
   - security review still runs and still owns the human-readable report plus `[wave-security]`

That separation matters:

- Corridor provides machine-readable blocking evidence
- the security reviewer still provides the threat-model-first narrative review, approvals, and final marker
- `concerns` from the human reviewer remain advisory, while `blocked` from either the reviewer or Corridor stops closure before integration

Matched Corridor findings are also copied into the generated security and integration summaries, so they remain visible even when the human reviewer reports advisory concerns rather than a hard block.

## Broker Mode Through Wave Control

In broker mode, the repo runtime sends a normalized request to:

- `POST /api/v1/providers/corridor/context`

The request body contains:

- `projectId`: the active Wave project id
- `wave`: current wave number
- `ownedPaths`: the filtered implementation-owned paths
- `severityThreshold`
- `findingStates`

The owned `wave-control` deployment then:

- looks up the Wave project id inside `WAVE_BROKER_CORRIDOR_PROJECT_MAP`
- fetches Corridor reports and findings with the deployment-owned `WAVE_BROKER_CORRIDOR_API_TOKEN`
- returns the same normalized shape Wave would have produced in direct mode

Example mapping:

```json
{
  "app": {
    "teamId": "corridor-team-uuid",
    "projectId": "corridor-project-uuid"
  }
}
```

Broker mode requirements:

- `waveControl.endpoint` must point at an owned Wave Control deployment, not the packaged default endpoint
- Wave must have a bearer token, normally `WAVE_API_TOKEN`
- the service deployment must enable Corridor brokering with `WAVE_BROKER_OWNED_DEPLOYMENT=true`, `WAVE_BROKER_ENABLE_CORRIDOR=true`, `WAVE_BROKER_CORRIDOR_API_TOKEN`, and `WAVE_BROKER_CORRIDOR_PROJECT_MAP`

## Prompt And Summary Surfaces

When Corridor loads during a live run, Wave also projects a compact text summary into the generated runtime context. That summary includes:

- the actual source used
- whether Corridor is currently blocking
- the configured threshold
- matched finding count
- up to five blocking findings

The same Corridor result then appears in:

- the generated security summary
- the integration summary
- the trace bundle's copied `corridor.json`

This keeps security context visible to humans without turning the provider response into the sole authority.

## Recommended Pattern

For most repos:

- use `hybrid` if you want an owned Wave Control deployment in normal operation but still want direct-repo fallback during outages or incomplete broker setup
- set `findingStates` explicitly if you only want open or potential findings considered live
- leave `requiredAtClosure` enabled when Corridor is meant to be part of the actual release gate
- keep a report-owning security reviewer in the wave; Corridor should strengthen that review, not replace it

See [runtime-config/README.md](./runtime-config/README.md) for the config keys, [wave-control.md](./wave-control.md) for the owned broker surface, and [coordination-and-closure.md](./coordination-and-closure.md) for the closure-stage gate ordering.
