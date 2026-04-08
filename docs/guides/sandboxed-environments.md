# Running Wave In Sandboxed Environments

Use this guide when Wave is running under a short-lived shell or exec environment rather than a normal long-lived operator shell.

Typical examples:

- LEAPclaw or OpenClaw-style agent harnesses that give you short `exec` windows
- Nemoshell or similar hosted terminal sandboxes
- Docker or devcontainer setups where the client process is disposable but the workspace and state volume persist

The core rule in `0.9.12` is simple:

- clients should be short-lived
- supervision should be long-lived
- agent execution should be process-backed, not tmux-backed

Wave now launches agents through detached process runners by default, which lowers tmux session churn and memory pressure compared with the old “every live agent owns a tmux session” shape. Tmux is now optional and dashboard-only.

## Recommended Model

For sandboxes, prefer the async supervisor surface:

```bash
pnpm exec wave submit ...
pnpm exec wave supervise ...
pnpm exec wave status ...
pnpm exec wave wait ...
pnpm exec wave attach ...
```

Use direct `wave launch` when:

- you control a normal long-lived shell
- the launcher process can stay alive for the whole run
- you are doing local debugging or dry-run validation

Do not bind a multi-hour wave to one short-lived sandbox client process.

## Baseline Configuration

Set the Codex sandbox default in `wave.config.json` for the lane or executor profile instead of retyping `--codex-sandbox` on every command.

Typical sandbox-safe pattern:

```json
{
  "executors": {
    "codex": {
      "sandbox": "workspace-write"
    }
  }
}
```

Use a stricter mode such as `read-only` when the task truly should not write. Use `danger-full-access` only when the outer environment is already providing the isolation you want.

Treat `tmux` as optional:

- install it only if you want live dashboard attach
- use `--no-dashboard` in constrained environments when you do not need the extra projection process

## LEAPclaw / OpenClaw / Nemoshell Pattern

In these environments, the common failure mode is a short-lived client exec timeout while the wave itself needs much longer.

Preferred shape:

1. A disposable client submits work.
2. A durable daemon owns the run.
3. Clients poll or wait observationally.

Example:

```bash
runId=$(pnpm exec wave submit \
  --project backend \
  --lane main \
  --start-wave 2 \
  --end-wave 2 \
  --no-dashboard \
  --json | jq -r .runId)

pnpm exec wave status --run-id "$runId" --project backend --lane main --json
pnpm exec wave wait --run-id "$runId" --project backend --lane main --timeout-seconds 300 --json
```

Keep `wave supervise` alive outside the short-lived client call:

- a long-lived host shell
- a background service
- a job runner that can outlive the client request

If the sandbox only gives you short exec windows, `wave autonomous` should not be the thing owning the run. Use submit plus observe instead.

## Docker And Containerized Setups

Docker works well with the `0.9.12` process-backed runner model, but only if the state directories survive container restarts.

Recommended container posture:

- mount the repo root as a persistent volume
- preserve `.tmp/` and `.wave/`
- run `wave supervise` in a long-lived container or sidecar
- use `wave submit/status/wait` from short-lived execs
- disable dashboards unless the image actually includes `tmux` and you want the extra process

Practical rules:

- dashboard attach is optional; log-follow attach is enough for most sandbox automation
- `wave attach --agent <id>` now follows the recorded log when no live interactive session exists
- `wave attach --dashboard` falls back to the last written dashboard file when no live dashboard session exists

## Terminal Surface Recommendations

For constrained sandboxes:

- `--terminal-surface vscode`
  Good when the repo is local and the editor integration is useful.
- `--terminal-surface tmux`
  Good only when `tmux` is installed and you actually want live dashboard attach.
- `--terminal-surface none`
  Dry-run only.

The important distinction is that terminal surface is now an operator preference, not the agent execution backend.

## Validation Checklist

Run these after setup changes:

```bash
pnpm exec wave doctor --json
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

For a sandboxed lane, also verify:

- `wave submit --json` returns a `runId`
- `wave status` and `wave wait` work with exact `--project` and `--lane`
- the supervisor run tree exists under `.tmp/.../control/supervisor/runs/<runId>/`
- dashboards are either intentionally disabled or intentionally backed by a real `tmux` install

## When To Keep Using `wave launch`

Use `wave launch` directly when:

- you are on a normal workstation shell
- the launcher can stay alive for the entire run
- you want the fastest direct local workflow
- you are debugging wave behavior and want the simplest path

Use `wave submit` plus `wave supervise` when the surrounding environment, not the wave itself, is the unstable part.

## Related Docs

- [author-and-run-waves.md](./author-and-run-waves.md)
- [terminal-surfaces.md](./terminal-surfaces.md)
- [../reference/cli-reference.md](../reference/cli-reference.md)
- [../plans/sandbox-end-state-architecture.md](../plans/sandbox-end-state-architecture.md)
