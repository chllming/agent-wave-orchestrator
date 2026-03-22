# OpenCode Runtime Configuration

Wave launches OpenCode with `opencode run` and points `OPENCODE_CONFIG` at a generated overlay.

## Supported Configuration

| Behavior | `wave.config.json` / profile key | Wave `### Executor` key | Launch effect |
| --- | --- | --- | --- |
| Command | `executors.opencode.command`, `executors.profiles.<name>.opencode.command` | `opencode.command` | Selects the executable |
| Default model | `executors.opencode.model`, `executors.profiles.<name>.model` | `model` | Adds `--model <name>` |
| Agent name | `executors.opencode.agent`, `executors.profiles.<name>.opencode.agent` | `opencode.agent` | Selects the injected agent name used with `--agent <name>` |
| Single attachment | `executors.opencode.attach`, `executors.profiles.<name>.opencode.attach` | `opencode.attach` | Adds `--attach <path>` |
| Multiple files | `executors.opencode.files`, `executors.profiles.<name>.opencode.files` | `opencode.files` | Adds repeated `--file <path>` |
| Output format | `executors.opencode.format`, `executors.profiles.<name>.opencode.format` | `opencode.format` | Adds `--format default|json` |
| Step limit | `executors.opencode.steps`, `executors.profiles.<name>.opencode.steps` | `opencode.steps` | Stored in the generated agent config |
| Instructions | `executors.opencode.instructions`, `executors.profiles.<name>.opencode.instructions` | `opencode.instructions` | Merged into top-level `instructions` in the generated overlay |
| Permission JSON | `executors.opencode.permission`, `executors.profiles.<name>.opencode.permission` | `opencode.permission` | Stored in the generated agent config |
| Config overlay JSON | `executors.opencode.configJson`, `executors.profiles.<name>.opencode.configJson` | `opencode.config_json` | Deep-merged into the generated `opencode.json` |

## Overlay Behavior

Wave always writes:

- `opencode-agent-prompt.txt`
- `opencode.json`

Merge order for `opencode.json`:

1. inline `configJson` from config, profile, and agent resolution
2. generated `$schema` if the merged config does not already define one
3. merged top-level `instructions`
4. generated or merged `agent.<resolved-name>` entry that points to `opencode-agent-prompt.txt`

Wave then exports `OPENCODE_CONFIG=<generated-path>` for the run.

## Example: `wave.config.json`

```json
{
  "executors": {
    "profiles": {
      "ops-triage": {
        "id": "opencode",
        "model": "anthropic/claude-sonnet-4-20250514",
        "budget": {
          "turns": 8,
          "minutes": 20
        },
        "opencode": {
          "instructions": ["Keep findings concise."],
          "permission": {
            "task": "ask"
          },
          "configJson": {
            "plugins": ["./plugins/runtime.mjs"]
          }
        }
      }
    },
    "opencode": {
      "command": "opencode",
      "format": "default"
    }
  }
}
```

## Example: Wave `### Executor`

````md
### Executor

- id: opencode
- model: anthropic/claude-sonnet-4-20250514
- opencode.agent: docs-runner
- opencode.attach: docs/plans/current-state.md
- opencode.files: README.md,docs/plans/current-state.md
- opencode.format: json
- opencode.steps: 6
- opencode.instructions: Keep shared-plan edits concise.
- opencode.permission: {"task":"ask"}
- opencode.config_json: {"plugins":["./plugins/runtime.mjs"]}
````

## Dry-Run Output

For a dry run, inspect:

- `opencode-agent-prompt.txt`
- `opencode.json`
- `launch-preview.json`

`launch-preview.json` shows the final `opencode run` command, the exported `OPENCODE_CONFIG` path, and the resolved `limits` block for attempt timeout plus known step ceiling.
