# Signal Wrappers And Long-Running Wake Loops

Use this guide when you want shell-friendly monitoring, external automation hooks, or intentionally long-running agents that should wake only when the orchestrator publishes a new signal version.

If you want the broader tmux or VS Code operator flow, read [terminal-surfaces.md](./terminal-surfaces.md). This page stays focused on the signal snapshots, wrapper scripts, and ack-loop contract.

## What The Runtime Writes

Wave now publishes versioned signal snapshots under:

- `.tmp/<lane>-wave-launcher/signals/wave-<n>.json`
  Wave-level signal for the whole wave.
- `.tmp/<lane>-wave-launcher/signals/wave-<n>/<agentId>.json`
  Per-agent signal state.
- `.tmp/<lane>-wave-launcher/signals/wave-<n>/acks/<agentId>.json`
  Per-agent acknowledgement file written by a long-running watcher after it observes a new signal version.

The resident orchestrator uses the same pattern with `resident-orchestrator` as the agent id.

Signal snapshots are derived projections, not canonical decision state. They are machine-friendly wake surfaces built from `wave control status --json`.

## Signal Kinds

The shipped signal vocabulary is:

- `stable`
- `waiting`
- `feedback-requested`
- `feedback-answered`
- `coordination-action`
- `resume-ready`
- `completed`
- `failed`

`completed` and `failed` are terminal. Long-running watchers should stop waiting once either one appears.

## Wrapper Scripts

Starter repos now include two thin helper scripts:

- `scripts/wave-status.sh`
- `scripts/wave-watch.sh`

They read `wave control status --json`. They do not recompute status independently.

### `wave-status.sh`

Examples:

```bash
scripts/wave-status.sh --lane main --wave 3
scripts/wave-status.sh --lane main --wave 3 --agent A1
scripts/wave-status.sh --lane main --wave 3 --agent A1 --json
```

Exit codes:

- `0`
  Terminal success (`signal=completed`)
- `10`
  Still active or waiting (`stable`, `waiting`, `feedback-answered`, `coordination-action`, `resume-ready`)
- `20`
  Input required (`signal=feedback-requested`)
- `40`
  Terminal failure (`signal=failed`)

The printed machine line includes `signal`, `phase`, `status`, `version`, `blocking`, and `should_wake`.

### `wave-watch.sh`

Examples:

```bash
scripts/wave-watch.sh --lane main --wave 3 --agent A1 --follow
scripts/wave-watch.sh --lane main --wave 3 --agent A1 --until-change --refresh-ms 500
```

Modes:

- `--follow`
  Keep polling until the signal becomes terminal or input-required.
- `--until-change`
  Exit as soon as the watched signal version changes.

Exit codes:

- `0`
  Terminal success
- `20`
  Input required
- `30`
  The watched signal version changed, but the wave is still active
- `40`
  Terminal failure

Use `--until-change` when an outer supervisor or CI job should re-enter only after a new signal is published.

## Long-Running Agents

For non-resident agents, opt in explicitly with:

```md
### Skills

- signal-hygiene
```

That skill is only for intentionally long-running agents. Do not attach it to normal one-shot implementation agents.

When `signal-hygiene` is active, the runtime injects two prompt-visible paths:

- the signal-state JSON path
- the signal-ack JSON path

The watcher loop is:

1. Read the signal state.
2. Compare its `version` with the version already recorded in the ack file.
3. If the version did not change, stay idle.
4. If the version increased, write the ack file immediately.
5. Re-read the inbox, shared summary, message board, and any referenced artifacts.
6. Act once for that version.
7. Stop entirely when the signal becomes `completed` or `failed`.

Ack payload shape:

```json
{
  "agentId": "A1",
  "version": 4,
  "signal": "coordination-action",
  "observedAt": "2026-03-25T19:00:00.000Z"
}
```

## Resident Orchestrator Behavior

The resident orchestrator does not need the `signal-hygiene` skill. It always receives the same signal-state and ack-path contract when `--resident-orchestrator` is enabled.

That lets the launcher know whether the resident monitor actually observed a reroute, feedback answer, or terminal state change.

## External Automation Pattern

Typical shell loop:

```bash
while true; do
  scripts/wave-watch.sh --lane main --wave 3 --agent A1 --until-change --refresh-ms 500
  code=$?
  if [ "$code" -eq 0 ]; then
    echo "wave completed"
    break
  fi
  if [ "$code" -eq 20 ]; then
    echo "human input required"
    break
  fi
  if [ "$code" -eq 40 ]; then
    echo "wave failed"
    break
  fi
done
```

Use `wave control status --json` directly when you need the full structured payload. Use the wrapper scripts when you want stable exit codes and a single machine-readable line.
