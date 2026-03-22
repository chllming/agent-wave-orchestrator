# Runtime Configuration Reference

This directory is the canonical reference for executor configuration in Wave `0.5.x`.

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

## Common Fields

These fields are shared across runtimes:

| Surface | `wave.config.json` / profile key | Wave `### Executor` key | Notes |
| --- | --- | --- | --- |
| Executor id | `id` in profile only | `id` | Runtime id: `codex`, `claude`, `opencode`, `local` |
| Profile selection | n/a | `profile` | Selects `executors.profiles.<name>` |
| Model | `model` in profile, `executors.claude.model`, `executors.opencode.model` | `model` | Codex uses shared `model` from profile or agent only |
| Fallbacks | `fallbacks` in profile | `fallbacks` | Runtime ids used for retry-time reassignment |
| Tags | `tags` in profile | `tags` | Stored in resolved executor state for policy and traces |
| Budget turns | `budget.turns` in profile | `budget.turns` | Seeds Claude `maxTurns` and OpenCode `steps` when runtime-specific values are absent |
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

- `launch-preview.json`: resolved invocation lines, env vars, and retry mode
- `claude-system-prompt.txt`: generated Claude harness prompt overlay
- `claude-settings.json`: generated Claude settings overlay when inline settings data is present
- `opencode-agent-prompt.txt`: generated OpenCode harness prompt overlay
- `opencode.json`: generated OpenCode runtime config overlay

## Recommended Validation Path

Use dry-run before relying on a new runtime configuration:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

Then inspect the generated preview and overlay files under `.tmp/<lane>-wave-launcher/dry-run/executors/`.
