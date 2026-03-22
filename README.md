# Wave Orchestration

Wave Orchestration is a repository harness for running multi-agent work in bounded waves. You define shared plan docs plus per-wave markdown, the launcher validates the wave, compiles prompts and inboxes, runs implementation agents first, then performs staged closure. Every run writes durable state under `.tmp/<lane>-wave-launcher/` so humans can inspect progress, replay outcomes, and intervene only when needed.

## How It Works

1. Write shared docs and one or more `docs/plans/waves/wave-<n>.md` files.
2. Run `wave launch --dry-run` to validate the wave and materialize prompts, inboxes, dashboards, and executor previews.
3. A real launch runs implementation agents first. Agents post claims, evidence, requests, and decisions into the coordination log and rolling message board.
4. When implementation gates pass, closure runs in order: integration (`A8`), documentation (`A9`), evaluator (`A0`).
5. Operators use the generated ledgers, inboxes, feedback queue, dependency views, and traces instead of guessing from raw terminal output.

## Features

- Implementation-first execution with staged closure and retry support
- Durable coordination log, rolling message board, compiled inboxes, and per-wave ledger
- Dry-run prompt and executor preview mode before any real agent launch
- Context7 bundle selection, caching, and prompt injection
- Multi-executor support for Codex, Claude Code, OpenCode, and a local smoke executor
- Human feedback routing, clarification triage, helper assignment, and cross-lane dependencies
- Replayable trace bundles for regression and release verification

## Example Output

Representative rolling message board output from a real wave run:

<img src="./docs/image.png" alt="Example rolling message board output showing claims, evidence, requests, and evaluator closure for a wave run" width="100%" />

## Quick Start

Requirements:

- Node.js 22+
- `pnpm`
- `tmux` on `PATH` for dashboarded runs
- at least one executor on `PATH`: `codex`, `claude`, or `opencode`
- optional: `CONTEXT7_API_KEY` for launcher-side prefetch

Install into another repo:

```bash
pnpm add -D @chllming/wave-orchestration
pnpm exec wave init
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
pnpm exec wave coord show --lane main --wave 0 --dry-run
```

If the repo already has Wave config, plans, or waves you want to keep:

```bash
pnpm exec wave init --adopt-existing
```

## Common Commands

```bash
# Run one wave with a real executor
pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access

# Inspect operator surfaces
pnpm exec wave feedback list --lane main --pending
pnpm exec wave dep show --lane main --wave 0 --json

# Run autonomous mode after the wave set is stable
pnpm exec wave autonomous --lane main --executor codex --codex-sandbox danger-full-access
```

## Develop This Package

```bash
pnpm install
pnpm test
node scripts/wave.mjs launch --lane main --dry-run --no-dashboard
```

## Learn More

- [docs/plans/wave-orchestrator.md](./docs/plans/wave-orchestrator.md): operator runbook
- [docs/plans/context7-wave-orchestrator.md](./docs/plans/context7-wave-orchestrator.md): Context7 setup and bundle authoring
- [docs/reference/runtime-config/README.md](./docs/reference/runtime-config/README.md): executor and runtime configuration
- [CHANGELOG.md](./CHANGELOG.md): release history
