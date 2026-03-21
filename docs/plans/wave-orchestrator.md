# Wave Orchestrator

The Wave Orchestrator coordinates repository work as bounded execution waves.

## What It Does

- parses wave plans from `docs/plans/waves/`
- fans a wave out into one session per `## Agent ...` section
- supports standing role imports from `docs/agents/*.md`
- validates Context7 declarations and exit contracts from configurable wave thresholds
- validates component promotions and component-owned proof from configurable wave thresholds
- writes prompts, logs, dashboards, message boards, and status summaries under `.tmp/`
- supports launcher-side Context7 prefetch and injection for headless runs
- supports headless execution through `codex`, `claude`, `opencode`, and the local smoke executor
- supports a file-backed human feedback queue
- performs a closure sweep so evaluator and documentation gates reflect final landed state

## Main Commands

- `pnpm wave:launch -- --lane main --dry-run --no-dashboard`
- `pnpm wave:launch -- --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access`
- `pnpm wave:launch -- --lane main --start-wave 0 --end-wave 0 --executor claude`
- `pnpm wave:launch -- --lane main --start-wave 0 --end-wave 0 --executor opencode`
- `pnpm wave:autonomous -- --lane main --executor codex --codex-sandbox danger-full-access`
- `pnpm wave:autonomous -- --lane main --executor claude`
- `pnpm wave:autonomous -- --lane main --executor opencode`
- `pnpm wave:feedback -- list --lane main --pending`

## Configuration

- `wave.config.json` controls docs roots, shared plan docs, role prompts, validation thresholds, executor defaults, component-cutover matrix paths, and Context7 bundle-index location.
- `docs/context7/bundles.json` controls allowed external library bundles and lane defaults.
- `docs/plans/component-cutover-matrix.json` is the canonical machine-readable source for component maturity and per-wave promotion targets.

## Setup

1. Install dependencies with `pnpm install`.
2. Confirm `tmux` and at least one real executor (`codex`, `claude`, or `opencode`) are available if you want real wave execution.
3. Review [wave.config.json](/home/coder/wave-orchestration/wave.config.json).
4. Review the starter role prompts under [docs/agents](/home/coder/wave-orchestration/docs/agents).
5. Review or replace the starter wave files under [docs/plans/waves](/home/coder/wave-orchestration/docs/plans/waves).

## Recommended Launch Flow

1. Dry-run parse:

```bash
pnpm wave:launch -- --lane main --dry-run --no-dashboard
```

2. Reconcile stale state if a prior run died mid-wave:

```bash
pnpm wave:launch -- --lane main --reconcile-status
```

3. Inspect pending feedback:

```bash
pnpm wave:feedback -- list --lane main --pending
```

4. Launch one wave:

```bash
pnpm wave:launch -- --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access
```

5. Only move to `wave:autonomous` after single-wave runs are already stable.

## What The Launcher Writes

- prompts: `.tmp/<lane>-wave-launcher/prompts/`
- logs: `.tmp/<lane>-wave-launcher/logs/`
- status summaries: `.tmp/<lane>-wave-launcher/status/`
- message boards: `.tmp/<lane>-wave-launcher/messageboards/`
- dashboards: `.tmp/<lane>-wave-launcher/dashboards/`
- Context7 cache: `.tmp/<lane>-wave-launcher/context7-cache/`
- executor overlays: `.tmp/<lane>-wave-launcher/executors/`
- cross-wave orchestration board: `.tmp/wave-orchestrator/messageboards/orchestrator.md`

## Authoring Rules

- Every wave must include the configured evaluator agent.
- From the configured thresholds onward, declare `## Component promotions` and keep them aligned with the component cutover matrix.
- From the configured thresholds onward, every non-A0/A9 agent must declare `### Components` and emit `[wave-component]` markers for those components.
- Use `### Executor` only when an agent should override the run-level executor default.
- Use `### Role prompts` for standing-role imports from `docs/agents/*.md`.
- Keep file ownership explicit inside each `### Prompt`.
- From the configured thresholds onward, declare `## Context7 defaults`, per-agent `### Context7`, and per-agent `### Exit contract`.
- Keep shared plan docs and the component cutover matrix owned by the configured documentation steward once that rule becomes active.

## Executor Modes

- `--executor codex` uses `codex exec` with the generated task prompt piped through stdin.
- `--executor claude` uses `claude -p` with the generated task prompt as the message and a harness runtime system-prompt overlay.
- `--executor opencode` uses `opencode run` with a generated runtime `opencode.json` and agent prompt overlay.
- `--executor local` exists only for smoke-testing prompt and closure behavior.
- `--codex-sandbox danger-full-access` is the default because it avoids host bubblewrap assumptions.
- Per-agent overrides in the wave file beat both the CLI `--executor` and `wave.config.json` `executors.default`.
- The launcher writes runtime overlay files under `.tmp/<lane>-wave-launcher/executors/`; these should stay ignored and local.

## Human Feedback Queue

Agents can request clarification through the file-backed feedback queue. Operators can inspect and answer requests with:

```bash
pnpm wave:feedback -- list --lane main --pending
pnpm wave:feedback -- show --id <request-id>
pnpm wave:feedback -- respond --id <request-id> --response "..."
```

## Closure Sweep

If implementation agents ran, the launcher does not stop at `exit 0`. It checks implementation exit contracts, checks promoted component proof, then reruns the documentation steward and evaluator so the final gate reflects the landed state after implementation settles.
