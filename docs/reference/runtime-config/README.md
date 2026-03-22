# Runtime Configuration Reference

This directory is the canonical reference for executor configuration in the packaged Wave release.

Use it when you need the full supported surface for:

- `wave.config.json`
- `lanes.<lane>.executors`
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

## Common Fields

These fields are shared across runtimes:

| Surface | `wave.config.json` / profile key | Wave `### Executor` key | Notes |
| --- | --- | --- | --- |
| Executor id | `id` in profile only | `id` | Runtime id: `codex`, `claude`, `opencode`, `local` |
| Profile selection | n/a | `profile` | Selects `executors.profiles.<name>` |
| Model | `model` in profile, `executors.claude.model`, `executors.opencode.model` | `model` | Codex uses shared `model` from profile or agent only |
| Fallbacks | `fallbacks` in profile | `fallbacks` | Runtime ids used for retry-time reassignment |
| Tags | `tags` in profile | `tags` | Stored in resolved executor state for policy and traces |
| Budget turns | `budget.turns` in profile | `budget.turns` | Seeds Claude `maxTurns` and OpenCode `steps` when runtime-specific values are absent; it does not set a Codex turn limit |
| Budget minutes | `budget.minutes` in profile | `budget.minutes` | Caps attempt timeout |

## Runtime Pages

- [codex.md](./codex.md)
- [claude.md](./claude.md)
- [opencode.md](./opencode.md)

## Generated Artifacts

Wave writes runtime artifacts here:

- live runs: `.tmp/<lane>-wave-launcher/executors/wave-<n>/<agent-slug>/`
- dry-run previews: `.tmp/<lane>-wave-launcher/dry-run/executors/wave-<n>/<agent-slug>/`

Common files:

- `launch-preview.json`: resolved invocation lines, env vars, retry mode, and structured attempt/turn-limit metadata
- `skills.resolved.md`: compact metadata-first skill catalog for the selected agent and runtime
- `skills.expanded.md`: full canonical/debug skill payload with `SKILL.md` bodies and adapters
- `skills.metadata.json`: resolved skill ids, activation metadata, permissions, hashes, and generated artifact paths
- `<runtime>-skills.txt`: runtime-projected compact skill text used by the selected executor
- `claude-system-prompt.txt`: generated Claude harness prompt overlay
- `claude-settings.json`: generated Claude settings overlay when inline settings data is present
- `opencode-agent-prompt.txt`: generated OpenCode harness prompt overlay
- `opencode.json`: generated OpenCode runtime config overlay

Runtime-specific delivery:

- Codex uses the compact catalog in the compiled prompt and attaches bundle directories through `--add-dir`.
- Claude appends the compact catalog to the generated system-prompt overlay.
- OpenCode injects the compact catalog into `opencode.json` and attaches `skill.json`, `SKILL.md`, the selected adapter, and recursive `references/**` files through `--file`.
- Local keeps skills prompt-only.

`launch-preview.json` also records the resolved skill metadata plus a `limits` section. For Claude and OpenCode, that section reports the known turn ceiling and whether it came from the runtime-specific setting or generic `budget.turns`. For Codex, it explicitly records that Wave emitted no turn-limit flag and that any effective ceiling may come from the selected Codex profile or upstream runtime.

## Recommended Validation Path

Use dry-run before relying on a new runtime configuration:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

Then inspect the generated preview and overlay files under `.tmp/<lane>-wave-launcher/dry-run/executors/`.
