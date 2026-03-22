# Codex Runtime Configuration

Wave launches Codex with `codex exec` and pipes the generated task prompt through stdin.

## Supported Configuration

| Behavior | `wave.config.json` / profile key | Wave `### Executor` key | Launch effect |
| --- | --- | --- | --- |
| Command | `executors.codex.command`, `executors.profiles.<name>.codex.command` | `codex.command` | Selects the executable |
| Sandbox | `executors.codex.sandbox`, `executors.profiles.<name>.codex.sandbox` | `codex.sandbox` | Sets `--sandbox`; if absent on a selected Codex agent, launcher `--codex-sandbox` can supply the runtime default |
| CLI profile | `executors.codex.profileName`, `executors.profiles.<name>.codex.profileName` | `codex.profile_name` | Adds `--profile <name>` |
| Inline config overrides | `executors.codex.config`, `executors.profiles.<name>.codex.config` | `codex.config` | Adds repeated `-c key=value` |
| Search | `executors.codex.search`, `executors.profiles.<name>.codex.search` | `codex.search` | Adds `--search` |
| Images | `executors.codex.images`, `executors.profiles.<name>.codex.images` | `codex.images` | Adds repeated `--image <path>` |
| Extra directories | `executors.codex.addDirs`, `executors.profiles.<name>.codex.addDirs` | `codex.add_dirs` | Adds repeated `--add-dir <path>` |
| JSON mode | `executors.codex.json`, `executors.profiles.<name>.codex.json` | `codex.json` | Adds `--json` |
| Ephemeral session | `executors.codex.ephemeral`, `executors.profiles.<name>.codex.ephemeral` | `codex.ephemeral` | Adds `--ephemeral` |
| Model | `executors.profiles.<name>.model` | `model` | Adds `--model <name>` |

## Notes

- There is no `executors.codex.model` key today. Use profile `model` or per-agent `model`.
- Generic `budget.turns` does not set a Codex turn limit. If Codex stops on a turn ceiling, that limit came from the selected Codex profile or upstream Codex runtime, not from a Wave-emitted CLI flag.
- `codex.images`, `codex.add_dirs`, and `codex.config` accept either a string array in `wave.config.json` or a comma-separated list in a wave file.
- Relative paths are passed to Codex relative to the repository root because Wave launches the executor from the repo workspace.

## Example: `wave.config.json`

```json
{
  "executors": {
    "default": "codex",
    "profiles": {
      "implement-fast": {
        "id": "codex",
        "model": "gpt-5-codex",
        "fallbacks": ["claude", "opencode"],
        "budget": {
          "minutes": 45
        },
        "codex": {
          "profileName": "review",
          "config": ["model_reasoning_effort=medium"],
          "search": true
        }
      }
    },
    "codex": {
      "command": "codex",
      "sandbox": "danger-full-access",
      "json": false,
      "ephemeral": false
    }
  }
}
```

## Example: Wave `### Executor`

````md
### Executor

- id: codex
- model: gpt-5-codex
- codex.profile_name: review
- codex.config: model_reasoning_effort=high,model_verbosity=low
- codex.search: true
- codex.images: docs/mock-ui.png
- codex.add_dirs: ../shared,../infra
- codex.json: true
- codex.ephemeral: true
````

## Dry-Run Output

For a dry run, inspect:

- `launch-preview.json` for the final `codex exec` command
- any referenced prompt file under `.tmp/<lane>-wave-launcher/dry-run/prompts/`

The preview records the exact `--profile`, repeated `-c`, `--image`, and `--add-dir` flags that Wave would use in a live launch. It also includes a `limits` block that makes Wave's Codex visibility explicit: `turnLimitSource: "not-set-by-wave"` means Wave emitted no Codex turn-limit flag, so any effective ceiling is external to the Wave CLI invocation.
