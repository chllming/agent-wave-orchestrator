# Claude Runtime Configuration

Wave launches Claude headlessly with `claude -p --no-session-persistence`.

## Supported Configuration

| Behavior | `wave.config.json` / profile key | Wave `### Executor` key | Launch effect |
| --- | --- | --- | --- |
| Command | `executors.claude.command`, `executors.profiles.<name>.claude.command` | `claude.command` | Selects the executable |
| Default model | `executors.claude.model`, `executors.profiles.<name>.model` | `model` | Adds `--model <name>` |
| Agent | `executors.claude.agent`, `executors.profiles.<name>.claude.agent` | `claude.agent` | Adds `--agent <name>` |
| Prompt mode | `executors.claude.appendSystemPromptMode` | n/a | Uses `--append-system-prompt-file` or `--system-prompt-file` |
| Permission mode | `executors.claude.permissionMode`, `executors.profiles.<name>.claude.permissionMode` | `claude.permission_mode` | Adds `--permission-mode <mode>` |
| Permission prompt tool | `executors.claude.permissionPromptTool`, `executors.profiles.<name>.claude.permissionPromptTool` | `claude.permission_prompt_tool` | Adds `--permission-prompt-tool <tool>` |
| Effort | `executors.claude.effort`, `executors.profiles.<name>.claude.effort` | `claude.effort` | Adds `--effort low|medium|high|max` |
| Max turns | `executors.claude.maxTurns`, `executors.profiles.<name>.claude.maxTurns` | `claude.max_turns` | Adds `--max-turns <n>` |
| MCP config | `executors.claude.mcpConfig`, `executors.profiles.<name>.claude.mcpConfig` | `claude.mcp_config` | Adds repeated `--mcp-config <path>` |
| Strict MCP mode | `executors.claude.strictMcpConfig`, `executors.profiles.<name>.claude.strictMcpConfig` | n/a | Adds `--strict-mcp-config` |
| Base settings file | `executors.claude.settings`, `executors.profiles.<name>.claude.settings` | `claude.settings` | Passed through `--settings` when no inline overlay is generated, or used as the base for the generated overlay |
| Inline settings JSON | `executors.claude.settingsJson`, `executors.profiles.<name>.claude.settingsJson` | `claude.settings_json` | Merged into generated settings overlay |
| Inline hooks JSON | `executors.claude.hooksJson`, `executors.profiles.<name>.claude.hooksJson` | `claude.hooks_json` | Written under top-level `hooks` in the generated settings overlay |
| Allowed HTTP hook URLs | `executors.claude.allowedHttpHookUrls`, `executors.profiles.<name>.claude.allowedHttpHookUrls` | `claude.allowed_http_hook_urls` | Written under top-level `allowedHttpHookUrls` in the generated settings overlay |
| Output format | `executors.claude.outputFormat`, `executors.profiles.<name>.claude.outputFormat` | `claude.output_format` | Adds `--output-format text|json|stream-json` |
| Allowed tools | `executors.claude.allowedTools`, `executors.profiles.<name>.claude.allowedTools` | `claude.allowed_tools` | Adds repeated `--allowedTools <tool>` |
| Disallowed tools | `executors.claude.disallowedTools`, `executors.profiles.<name>.claude.disallowedTools` | `claude.disallowed_tools` | Adds repeated `--disallowedTools <tool>` |

## Overlay Behavior

Wave always writes `claude-system-prompt.txt` for the harness runtime instructions.

Wave validates the effort enum only. Model-specific compatibility for values such as `max` remains enforced by Claude Code itself.

Wave writes `claude-settings.json` only when at least one inline overlay input is present:

- `settingsJson`
- `hooksJson`
- `allowedHttpHookUrls`

Merge order:

1. base `claude.settings` JSON file, if provided
2. inline `settingsJson`
3. inline `hooksJson` under top-level `hooks`
4. inline `allowedHttpHookUrls` under top-level `allowedHttpHookUrls`

If no inline overlay data is present, Wave passes the base `claude.settings` file directly through `--settings` without generating `claude-settings.json`.

## Example: `wave.config.json`

```json
{
  "executors": {
    "profiles": {
      "deep-review": {
        "id": "claude",
        "model": "claude-sonnet-4-6",
        "budget": {
          "turns": 10,
          "minutes": 30
        },
        "claude": {
          "agent": "reviewer",
          "effort": "high",
          "permissionMode": "plan",
          "allowedTools": ["Read"],
          "disallowedTools": ["Edit"]
        }
      }
    },
    "claude": {
      "command": "claude",
      "appendSystemPromptMode": "append",
      "outputFormat": "text",
      "settingsJson": {
        "permissions": {
          "allow": ["Read"]
        }
      }
    }
  }
}
```

## Example: Wave `### Executor`

````md
### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.effort: high
- claude.permission_mode: plan
- claude.max_turns: 4
- claude.settings_json: {"permissions":{"allow":["Read"]}}
- claude.hooks_json: {"Stop":[{"command":"echo stop"}]}
- claude.allowed_http_hook_urls: https://example.com/hooks
- claude.output_format: json
- claude.allowed_tools: Read
- claude.disallowed_tools: Edit
````

## Dry-Run Output

For a dry run, inspect:

- `claude-system-prompt.txt`
- `claude-settings.json`, when generated
- `launch-preview.json`

`launch-preview.json` shows the final `claude -p` invocation, whether `--effort`, `--settings`, `--allowedTools`, `--disallowedTools`, `--mcp-config`, or `--system-prompt-file` were included, and the resolved `limits` block for attempt timeout plus known turn ceiling.
