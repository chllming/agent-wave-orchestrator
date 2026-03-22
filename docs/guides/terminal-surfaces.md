# Terminal Surfaces And Dashboards

Wave has separate concepts for execution substrate and operator surface.

The important detail is:

- live runs use `tmux` sessions
- terminal surfaces control how operators attach to those sessions

## The Three Terminal Surfaces

- `vscode`
  The launcher writes temporary entries to `.vscode/terminals.json` so VS Code can attach to the tmux sessions.
- `tmux`
  The launcher uses tmux only and never touches `.vscode/terminals.json`.
- `none`
  Dry-run only. No live terminal surface is allowed in this mode.

## What `vscode` Really Means

`vscode` is not a second process host. It is a convenience attachment surface.

The actual live sessions still run in tmux. The VS Code terminal registry just exposes stable attach commands for those tmux sessions.

Use `vscode` when:

- your main operator flow is inside VS Code
- you want one-click attach behavior for agent sessions and dashboards
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

Important flags:

- `--no-dashboard`
  Disable the per-wave tmux dashboard session.
- `--cleanup-sessions`
  Kill lane tmux sessions after each wave. This is the default.
- `--keep-sessions`
  Preserve tmux sessions after the wave for inspection.
- `--keep-terminals`
  Keep temporary VS Code terminal entries instead of cleaning them up.

## Best Practices

- Use `vscode` for local interactive operator work when the temporary terminal registry is useful.
- Use `tmux` for remote, CI-like, or editor-independent operation.
- Use `none` only with `--dry-run`.
- Pair `--keep-sessions` with incident review or deep debugging, not as a default steady-state mode.
- Pair `--no-dashboard` with scripted dry-runs or when the board and summaries are sufficient.

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
