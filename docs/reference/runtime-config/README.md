# Runtime Configuration Reference

This directory is the canonical reference for executor configuration in the packaged Wave release.

Use it when you need the full supported surface for:

- `wave.config.json`
- `defaultProject` and `projects.<projectId>`
- `lanes.<lane>.executors`
- `waveControl`
- `externalProviders`
- `executors.profiles.<profile>`
- per-agent `### Executor` blocks inside a wave file

## Naming Conventions

- `wave.config.json` uses camelCase keys such as `profileName`, `addDirs`, `settingsJson`, and `allowedHttpHookUrls`.
- Wave markdown `### Executor` blocks use snake_case after the runtime prefix, such as `codex.profile_name`, `codex.add_dirs`, `claude.settings_json`, and `claude.allowed_http_hook_urls`.

## Resolution Order

Executor id selection resolves in this order:

1. agent `### Executor` `id`
2. agent `### Executor` `profile` -> `executors.profiles.<profile>.id`
3. `lanes.<lane>.runtimePolicy.defaultExecutorByRole`
4. launcher `--executor`
5. `executors.default`

Runtime settings resolve in layers:

1. `executors.<runtime>` global defaults
2. `lanes.<lane>.executors.<runtime>` lane overrides
3. `executors.profiles.<profile>` or `lanes.<lane>.executors.profiles.<profile>`
4. agent `### Executor`

Merge behavior:

- scalar values override from later layers
- list values merge for profile plus agent resolution on top of the lane base
- lane executor overrides replace the corresponding global runtime fields before profile and agent resolution
- a lane profile with the same name as a global profile replaces that profile definition for the lane

Skill settings resolve after executor selection, because runtime and deploy-kind skill attachment depend on the resolved executor id and the wave's default deploy environment kind. The starter layering order is:

1. `skills.base`
2. `lanes.<lane>.skills.base`
3. `skills.byRole[resolvedRole]`
4. `lanes.<lane>.skills.byRole[resolvedRole]`
5. `skills.byRuntime[resolvedExecutorId]`
6. `lanes.<lane>.skills.byRuntime[resolvedExecutorId]`
7. `skills.byDeployKind[defaultDeployEnvironmentKind]`
8. `lanes.<lane>.skills.byDeployKind[defaultDeployEnvironmentKind]`
9. agent `### Skills`

Then Wave filters configured skills through each bundle's activation metadata. Explicit per-agent `### Skills` still force attachment even when activation metadata would not auto-match.

When retry-time fallback changes the runtime, Wave recomputes the effective skill set and rewrites the executor overlay before relaunch.

## Projects

Wave can run multiple project tracks from one monorepo.

- `defaultProject` selects the implicit project when a command does not pass `--project`
- `projects.<projectId>.rootDir` relocates that project's default docs root under the repo
- `projects.<projectId>.paths.*` can relocate that project's docs, launcher-state, terminal-registry, Context7 bundle index, benchmark catalog, and component-matrix surfaces
- `projects.<projectId>.lanes.<lane>` owns lane-local runtime, planner, skill, and Wave Control overrides
- legacy top-level `lanes` still work as the implicit default project for backwards compatibility
- an explicit unknown `--project` is an error; Wave no longer falls back to `defaultProject` for typoed project ids

Example:

```json
{
  "defaultProject": "app",
  "projects": {
    "app": {
      "rootDir": ".",
      "lanes": {
        "main": {}
      }
    },
    "service": {
      "rootDir": "services/api",
      "lanes": {
        "main": {}
      }
    }
  }
}
```

Supported `projects.<projectId>.paths.*` fields:

| Key | Purpose |
| --- | --- |
| `docsDir` | Project-local docs root used as the default base for docs, plans, waves, and matrix defaults |
| `stateRoot` | Base directory for launcher state, logs, overlays, telemetry, and projections |
| `orchestratorStateDir` | Base directory for project-scoped orchestrator message boards, feedback, and dependency state |
| `terminalsPath` | VS Code terminal registry written when `--terminal-surface vscode` is active |
| `context7BundleIndexPath` | Project-specific Context7 bundle index |
| `benchmarkCatalogPath` | Project-specific benchmark catalog for `cont-EVAL` and benchmark commands |
| `componentCutoverMatrixDocPath` | Project-specific component cutover matrix markdown |
| `componentCutoverMatrixJsonPath` | Project-specific component cutover matrix JSON |

Path resolution order:

1. lane-specific override such as `projects.<projectId>.lanes.<lane>.terminalsPath`
2. `projects.<projectId>.paths.*`
3. repo-global `paths.*`
4. built-in derived defaults for `docsDir`, `plansDir`, `wavesDir`, and matrix paths

Advanced monorepo example:

```json
{
  "defaultProject": "app",
  "paths": {
    "stateRoot": ".tmp",
    "terminalsPath": ".vscode/terminals.json"
  },
  "projects": {
    "app": {
      "rootDir": ".",
      "lanes": {
        "main": {}
      }
    },
    "service": {
      "rootDir": "services/api",
      "paths": {
        "docsDir": "services/api/docs",
        "stateRoot": ".tmp/service-wave",
        "orchestratorStateDir": ".tmp/service-orchestrator",
        "terminalsPath": ".vscode/service-terminals.json",
        "context7BundleIndexPath": "services/api/docs/context7/bundles.json",
        "benchmarkCatalogPath": "services/api/docs/evals/benchmark-catalog.json",
        "componentCutoverMatrixDocPath": "services/api/docs/plans/component-cutover-matrix.md",
        "componentCutoverMatrixJsonPath": "services/api/docs/plans/component-cutover-matrix.json"
      },
      "waveControl": {
        "projectId": "service-api",
        "reportMode": "metadata-plus-selected"
      },
      "lanes": {
        "main": {
          "runtimePolicy": {
            "defaultExecutorByRole": {
              "design": "claude",
              "implementation": "codex",
              "integration": "claude",
              "documentation": "claude",
              "cont-qa": "claude",
              "cont-eval": "codex"
            },
            "runtimeMixTargets": {
              "codex": 4,
              "claude": 3,
              "opencode": 1
            },
            "fallbackExecutorOrder": ["claude", "opencode", "codex"]
          }
        },
        "release": {
          "docsDir": "services/api/docs/release",
          "plansDir": "services/api/docs/release/plans",
          "wavesDir": "services/api/docs/release/plans/waves"
        }
      }
    }
  }
}
```

## Common Fields

These fields are shared across runtimes:

| Surface | `wave.config.json` / profile key | Wave `### Executor` key | Notes |
| --- | --- | --- | --- |
| Executor id | `id` in profile only | `id` | Runtime id: `codex`, `claude`, `opencode`, `local` |
| Profile selection | n/a | `profile` | Selects `executors.profiles.<name>` |
| Model | `model` in profile, `executors.claude.model`, `executors.opencode.model` | `model` | Codex uses shared `model` from profile or agent only |
| Fallbacks | `fallbacks` in profile | `fallbacks` | Runtime ids used for retry-time reassignment |
| Tags | `tags` in profile | `tags` | Stored in resolved executor state for policy and traces |
| Budget turns | `budget.turns` in profile | `budget.turns` | Advisory generic turn budget. Wave records it in resolved metadata, but only runtime-specific settings such as `claude.maxTurns` or `opencode.steps` emit hard turn-limit flags. It does not set a Codex turn limit. |
| Budget minutes | `budget.minutes` in profile | `budget.minutes` | Primary wall-clock attempt budget |

Practical guidance:

- prefer `budget.minutes` for normal synthesis, integration, and closure work
- use generic `budget.turns` as a planning hint, not a hard failure trigger
- only set `claude.maxTurns` or `opencode.steps` when you deliberately want a hard ceiling for that runtime
- see [../../guides/recommendations-0.9.2.md](../../guides/recommendations-0.9.2.md) for the recommended `0.9.2` operating stance that combines advisory turn budgets with softer non-proof coordination states

## Runtime Pages

- [codex.md](./codex.md)
- [claude.md](./claude.md)
- [opencode.md](./opencode.md)

## Wave Control

`wave.config.json` may also declare a `waveControl` block for local-first telemetry delivery.

Packaged defaults in `@chllming/wave-orchestration@0.9.2`:

- `endpoint`: `https://wave-control.up.railway.app/api/v1`
- `reportMode`: `metadata-only`
- `enabled`: `true`
- project-scoped telemetry identity defaults to the resolved `projectId`, then lane and wave metadata from the active run

This package is distributed with the author's personal Wave Control endpoint enabled by default. Anyone who does not want telemetry delivered back to that endpoint must explicitly opt out in config or per run.

Supported top-level fields:

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch for local queueing and remote delivery |
| `endpoint` | string | `https://wave-control.up.railway.app/api/v1` | Base URL for the Railway-hosted `services/wave-control` API |
| `workspaceId` | string | derived from repo path | Stable workspace identity used across runs |
| `projectId` | string | resolved project id | Stable project identity used for cross-workspace reporting and filtering |
| `authTokenEnvVar` | string | `WAVE_API_TOKEN` | Primary environment variable name holding the bearer token |
| `authTokenEnvVars` | string[] | `["WAVE_API_TOKEN", "WAVE_CONTROL_AUTH_TOKEN"]` | Ordered fallback env var list consulted when Wave resolves a bearer token for owned Wave Control routes |
| `credentialProviders` | string[] | `[]` | Allowlisted runtime credential leases requested from an owned Wave Control deployment before executor launch. Supported values: `openai`, `anthropic` |
| `credentials` | `{ id, envVar }[]` | `[]` | Arbitrary per-user credential leases requested from an owned Wave Control deployment before executor launch |
| `reportMode` | string | `metadata-only` | `disabled`, `metadata-only`, `metadata-plus-selected`, or `full-artifact-upload` |
| `uploadArtifactKinds` | string[] | selected proof/trace/benchmark kinds | Artifact classes eligible for body upload when an artifact's upload policy requests a body |
| `requestTimeoutMs` | integer | `5000` | Per-batch network timeout |
| `flushBatchSize` | integer | `25` | Max queued telemetry events flushed per batch |
| `maxPendingEvents` | integer | `1000` | Cap for pending remote-delivery queue files; oldest pending uploads are dropped from the remote queue while the local `events.jsonl` stream remains authoritative |
| `captureCoordinationRecords` | boolean | `true` | Emit `coordination_record` telemetry |
| `captureControlPlaneEvents` | boolean | `true` | Emit `wave_run`, `attempt`, `proof_bundle`, and related control-plane events |
| `captureTraceBundles` | boolean | `true` | Emit finalized trace-bundle artifacts and gate snapshots |
| `captureBenchmarkRuns` | boolean | `true` | Emit `benchmark_run`, `benchmark_item`, `verification`, and `review` events |

Lane overrides may refine the same keys under `lanes.<lane>.waveControl` or `projects.<projectId>.lanes.<lane>.waveControl`.

Wave resolves the Wave Control bearer token from `authTokenEnvVars` when that list is present. Otherwise it resolves `authTokenEnvVar` first and keeps `WAVE_CONTROL_AUTH_TOKEN` as a compatibility fallback.

One-run override:

- `wave launch --no-telemetry` disables Wave Control queueing and remote delivery for that launcher invocation without changing the repo config.
- `waveControl.enabled: false` disables queueing and remote delivery for the repo or project.
- `waveControl.reportMode: "disabled"` disables remote reporting while leaving the config surface explicit.

Example:

```json
{
  "waveControl": {
    "endpoint": "https://wave-control.up.railway.app/api/v1",
    "workspaceId": "wave-main",
    "projectId": "app",
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

Runtime-emitted Wave Control events also attach:

- `orchestratorId` from the active launcher or resident orchestrator
- `runtimeVersion` from the installed Wave package metadata

## External Providers

Wave can resolve third-party auth directly in the repo runtime or through an owned Wave Control broker.

```json
{
  "externalProviders": {
    "context7": {
      "mode": "direct",
      "apiKeyEnvVar": "CONTEXT7_API_KEY"
    },
    "corridor": {
      "enabled": false,
      "mode": "direct",
      "baseUrl": "https://app.corridor.dev/api",
      "apiTokenEnvVar": "CORRIDOR_API_TOKEN",
      "apiKeyFallbackEnvVar": "CORRIDOR_API_KEY",
      "teamId": "team-id-for-direct-mode",
      "projectId": "project-id-for-direct-mode",
      "severityThreshold": "critical",
      "findingStates": ["open", "potential"],
      "requiredAtClosure": true
    }
  }
}
```

- `direct`: use repo/runtime env vars directly
- `broker`: use the owned Wave Control endpoint with `WAVE_API_TOKEN`
- `hybrid`: try the broker first, then fall back to direct auth if broker setup fails or a broker request fails at runtime
- direct Corridor mode requires both `teamId` and `projectId` in config; broker mode instead requires a matching `WAVE_BROKER_CORRIDOR_PROJECT_MAP` entry on the owned Wave Control deployment
- Wave auto-loads an allowlisted repo-root `.env.local` for `CONTEXT7_API_KEY`, `CORRIDOR_API_TOKEN`, `CORRIDOR_API_KEY`, `WAVE_API_TOKEN`, and `WAVE_CONTROL_AUTH_TOKEN`
- `wave doctor` now warns or fails early when brokered providers target the packaged default endpoint or no Wave Control auth token is available
- Context7 remains fail-open
- Corridor writes `.tmp/<lane>-wave-launcher/security/wave-<n>-corridor.json`, filters findings down to the wave's implementation-owned non-doc, non-`.tmp/`, non-markdown paths, and can fail closure when the fetch fails or matched findings meet the configured threshold
- Broker mode is intended for self-hosted or team-owned Wave Control only; the packaged default endpoint is rejected as a provider-secret proxy
- if `findingStates` is omitted or set to `[]`, Wave does not apply a state filter and the provider may return all states
- for the full Corridor lifecycle, including broker mapping, generated artifact shape, and gate semantics, see [../corridor.md](../corridor.md)

`waveControl.credentialProviders` is related but separate from `externalProviders`:

- use `externalProviders.context7` and `externalProviders.corridor` for brokered or direct API access during planning / closure flows
- use `waveControl.credentialProviders` only when an executor needs env vars leased into its runtime
- use `waveControl.credentials` when an executor needs arbitrary user-owned secrets leased into env vars such as `GITHUB_TOKEN` or `NPM_TOKEN`
- only `openai` and `anthropic` are valid leased providers today
- `context7` and `corridor` remain broker-only and are never returned as raw env secrets
- `waveControl.credentials[*].id` must match `/^[a-z0-9][a-z0-9._-]*$/`
- `waveControl.credentials[*].envVar` must match `/^[A-Z_][A-Z0-9_]*$/`
- when provider or arbitrary credentials are leased, Wave injects them into the live executor environment and redacts those keys in `launch-preview.json`

Those fields are queryable in the `wave-control` service alongside `workspaceId`,
`projectId`, `runKind`, `runId`, `lane`, and benchmark ids.

See [../wave-control.md](../wave-control.md) for the event contract and upload-policy model.

## Generated Artifacts

Wave writes runtime artifacts here:

- live runs: `.tmp/<lane>-wave-launcher/executors/wave-<n>/<agent-slug>/` for the implicit default project, or `.tmp/projects/<projectId>/<lane>-wave-launcher/executors/wave-<n>/<agent-slug>/` for explicit projects
- dry-run previews: `.tmp/<lane>-wave-launcher/dry-run/executors/wave-<n>/<agent-slug>/` for the implicit default project, or `.tmp/projects/<projectId>/<lane>-wave-launcher/dry-run/executors/wave-<n>/<agent-slug>/` for explicit projects

Common files:

- `launch-preview.json`: resolved invocation lines, env vars, retry mode, and structured attempt/turn-limit metadata for both dry-run and live launches
- `skills.resolved.md`: compact metadata-first skill catalog for the selected agent and runtime
- `skills.expanded.md`: full canonical/debug skill payload with `SKILL.md` bodies and adapters
- `skills.metadata.json`: resolved skill ids, activation metadata, permissions, hashes, and generated artifact paths
- `<runtime>-skills.txt`: runtime-projected compact skill text used by the selected executor
- `claude-system-prompt.txt`: generated Claude harness prompt overlay
- `claude-settings.json`: generated Claude settings overlay when inline settings data is present
- `opencode-agent-prompt.txt`: generated OpenCode harness prompt overlay
- `opencode.json`: generated OpenCode runtime config overlay
- `.tmp/<lane>-wave-launcher/control-plane/telemetry/events.jsonl`: local-first Wave Control event stream for the implicit default project
- `.tmp/projects/<projectId>/<lane>-wave-launcher/control-plane/telemetry/events.jsonl`: same stream for explicit projects
- `.tmp/.../control-plane/telemetry/pending/`: queued event batches awaiting remote delivery
- `.tmp/.../control-plane/telemetry/delivery-state.json`: remote-delivery counters and last-error state

Runtime-specific delivery:

- Codex uses the compact catalog in the compiled prompt and attaches bundle directories through `--add-dir`.
- Claude appends the compact catalog to the generated system-prompt overlay.
- OpenCode injects the compact catalog into `opencode.json` and attaches `skill.json`, `SKILL.md`, the selected adapter, and recursive `references/**` files through `--file`.
- Local keeps skills prompt-only.

`launch-preview.json` also records the resolved skill metadata plus a `limits` section. For Claude and OpenCode, that section reports the runtime-specific turn ceiling when one was actually configured; when only generic `budget.turns` exists, the preview keeps it as advisory metadata and notes that Wave emitted no hard turn-limit flag. For Codex, it explicitly records that Wave emitted no turn-limit flag and that any effective ceiling may come from the selected Codex profile or upstream runtime. If a live Codex run later terminates with a visible `Reached max turns (N)` log line, Wave appends that observed ceiling back into the live `launch-preview.json` as runtime evidence rather than pretending Wave set it.

## Recommended Validation Path

Use dry-run before relying on a new runtime configuration:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

Then inspect the generated preview and overlay files under `.tmp/<lane>-wave-launcher/dry-run/executors/`.
