# Terminal Surfaces And Dashboards

If you want the end-to-end drafting and live-run workflow, start with [author-and-run-waves.md](./author-and-run-waves.md). This page stays focused on terminal-surface details.

Wave has separate concepts for execution substrate and operator surface.

The important detail is:

- live agent runs use detached process runners
- terminal surfaces control how operators follow logs and attach to dashboard projections
- sandbox-safe submission and supervision are documented separately in [sandboxed-environments.md](./sandboxed-environments.md)

## The Three Terminal Surfaces

- `vscode`
  The launcher writes temporary entries to `.vscode/terminals.json` so VS Code can follow process-backed agent logs and attach to stable dashboard projections.
- `tmux`
  The launcher uses tmux only for dashboard and operator projection sessions and never touches `.vscode/terminals.json`.
- `none`
  Dry-run only. No live terminal surface is allowed in this mode.

## What `vscode` Really Means

`vscode` is not a second process host. It is a convenience attachment surface.

The actual live agent work runs in detached processes. The VS Code terminal registry exposes stable log-follow commands for agents plus stable attach commands for dashboard projections.

Use `vscode` when:

- your main operator flow is inside VS Code
- you want one-click attach behavior for agent logs and dashboards
- touching `.vscode/terminals.json` is acceptable in the repo

## What `tmux` Really Means

`tmux` is the cleanest fully terminal-native operator surface.

Use `tmux` when:

- you are on a remote shell or devbox
- you want zero VS Code coupling
- you want a headless or low-friction terminal operator workflow
- the repo should never be mutated with temporary VS Code terminal entries

## Dashboard Behavior

By default the launcher can start per-wave dashboard sessions in tmux.

Wave now maintains stable tmux attach targets for both the current-wave dashboard and the global dashboard on the lane socket.

Wave agent execution no longer depends on tmux. `wave attach --agent` uses a live interactive session only when the runtime explicitly exposes one; otherwise it follows the recorded agent log or prints the terminal log tail.

Use:

```bash
pnpm exec wave dashboard --lane main --attach current
pnpm exec wave dashboard --lane main --attach global
```

Those commands work for both `tmux` and `vscode` terminal surfaces because live dashboard projection sessions currently use the lane tmux socket when dashboards are enabled. If no live dashboard session exists, the attach command falls back to the last written dashboard JSON instead of failing immediately.

When `--terminal-surface vscode` is active, Wave also maintains a stable current-wave dashboard terminal entry instead of creating a new wave-numbered dashboard attach target for every wave transition.

Important flags:

- `--no-dashboard`
  Disable the per-wave dashboard projection session.
- `--cleanup-sessions`
  Kill lane tmux dashboard and projection sessions after each wave. This is the default.
- `--keep-sessions`
  Preserve tmux dashboard and projection sessions after the wave for inspection.
- `--keep-terminals`
  Keep temporary VS Code terminal entries instead of cleaning them up.

## Best Practices

- Use `vscode` for local interactive operator work when the temporary terminal registry is useful.
- Use `tmux` for remote, CI-like, or editor-independent operation.
- Use `none` only with `--dry-run`.
- In constrained sandboxes or containers, treat dashboards as optional and prefer `--no-dashboard` unless `tmux` is installed and you actually want the extra projection process.
- Prefer `wave dashboard --attach current|global` over manual `tmux -L <socket> attach ...` lookups; it will fall back to the last written dashboard file when no live session exists.
- Pair `--keep-sessions` with incident review or deep debugging, not as a default steady-state mode.
- Pair `--no-dashboard` with scripted dry-runs or when the board and summaries are sufficient.

## Operator Wrappers

Starter repos now include two thin helper scripts:

- `scripts/wave-status.sh`
  Reads `wave control status --json`, prints a single machine-friendly line, and exits `0` for completed, `10` for waiting/running, `20` for input-required, and `40` for failed.
- `scripts/wave-watch.sh`
  Polls the same status JSON until the watched signal version changes. `--until-change` exits `30` when the signal changed but the wave is still active, and both follow mode and until-change mode terminate immediately with `40` on failed terminal signals.

Both wrappers are convenience readers only. The canonical surface is the versioned signal projection under `.tmp/<lane>-wave-launcher/signals/`.

For the full wrapper contract, long-running-agent ack loop, and external automation patterns, read [signal-wrappers.md](./signal-wrappers.md).

## Suggested Defaults

- Local development:
  `vscode`
- Remote shell or devbox:
  `tmux`
- CI validation:
  `none` with `--dry-run`

## Example Commands

```bash
pnpm exec wave launch --lane main --start-wave 2 --end-wave 2 --terminal-surface vscode
pnpm exec wave launch --lane main --start-wave 2 --end-wave 2 --terminal-surface tmux --keep-sessions
pnpm exec wave launch --lane main --start-wave 2 --end-wave 2 --dry-run --no-dashboard --terminal-surface none
```
