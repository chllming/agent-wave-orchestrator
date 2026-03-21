# Wave Orchestrator

The Wave Orchestrator coordinates repository work as bounded execution waves.

## What It Does

- parses wave plans from `docs/plans/waves/`
- fans a wave out into one session per `## Agent ...` section
- supports standing role imports from `docs/agents/*.md`
- seeds a coordination log, generated board, compiled shared summary, and per-agent inboxes
- derives a per-wave ledger, docs queue, integration summary, and per-attempt trace bundle
- validates Context7 declarations and exit contracts from configurable wave thresholds
- validates component promotions and component-owned proof from configurable wave thresholds
- writes prompts, logs, dashboards, coordination state, and status summaries under `.tmp/`
- supports launcher-side Context7 prefetch and injection for headless runs
- supports headless execution through `codex`, `claude`, `opencode`, and the local smoke executor
- supports a file-backed human feedback queue
- performs a closure sweep so integration, documentation, and evaluator gates reflect final landed state

## Main Commands

- `pnpm exec wave init`
- `pnpm exec wave init --adopt-existing`
- `pnpm exec wave doctor`
- `pnpm exec wave launch --lane main --dry-run --no-dashboard`
- `pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access`
- `pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor claude`
- `pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor opencode`
- `pnpm exec wave autonomous --lane main --executor codex --codex-sandbox danger-full-access`
- `pnpm exec wave feedback list --lane main --pending`
- `pnpm exec wave coord show --lane main --wave 0 --dry-run`
- `pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run`
- `pnpm exec wave coord post --lane main --wave 0 --agent A1 --kind blocker --summary "Need repository decision"`
- `pnpm exec wave upgrade`

## Configuration

- `wave.config.json` controls docs roots, shared plan docs, role prompts, validation thresholds, executor defaults, executor profiles, per-lane runtime policy, component-cutover matrix paths, capability-routing preferences, and Context7 bundle-index location.
- `docs/context7/bundles.json` controls allowed external library bundles and lane defaults.
- `docs/plans/component-cutover-matrix.json` is the canonical machine-readable source for component maturity and per-wave promotion targets.
- `.wave/install-state.json` records how the workspace was initialized and which package version is installed.

## Setup

1. Install the package with `pnpm add -D @chllming/wave-orchestration`.
2. Confirm `tmux` and at least one real executor (`codex`, `claude`, or `opencode`) are available if you want real wave execution.
3. Run `pnpm exec wave init` for a fresh repo, or `pnpm exec wave init --adopt-existing` for a repo with existing Wave files you want preserved.
4. Review [wave.config.json](/home/coder/wave-orchestration/wave.config.json).
5. Review the role prompts and docs you want the repo to own.

## Recommended Launch Flow

1. Run health checks:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

2. Reconcile stale state if a prior run died mid-wave:

```bash
pnpm exec wave launch --lane main --reconcile-status
```

3. Inspect pending feedback:

```bash
pnpm exec wave feedback list --lane main --pending
```

4. Launch one wave:

```bash
pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access
```

5. Only move to `wave:autonomous` after single-wave runs are already stable.

## Coordination Surfaces

- `wave coord show` reads the materialized coordination state for a wave.
- `wave coord render` regenerates the markdown board projection from the canonical coordination log.
- `wave coord inbox` writes the compiled shared summary plus the selected agent inbox.
- `wave coord post` appends a structured record to the coordination log. This is the machine-readable path for blockers, handoffs, evidence, targeted requests, and clarification requests.

The canonical state is the JSONL log under `.tmp/<lane>-wave-launcher/coordination/`. The markdown board is a generated projection for humans, not the scheduler's source of truth.

Clarification flow is orchestrator-first:

1. Agent emits `clarification-request` through `wave coord post`.
2. The launcher triages it from repo policy, ownership, prior decisions, or targeted rerouting.
3. Only unresolved items become human feedback tickets.
4. Routed clarification follow-up requests remain blocking until they resolve.
5. Human escalations are written back into coordination state, the ledger, and trace artifacts.

## Upgrade Flow

1. Upgrade the package version:

```bash
pnpm up @chllming/wave-orchestration
```

2. Record the upgrade and review release notes:

```bash
pnpm exec wave upgrade
pnpm exec wave changelog --since-installed
```

3. Review `.wave/upgrade-history/` for any manual follow-up. The upgrade flow does not overwrite repo-owned plans, waves, or config.

## What The Launcher Writes

- prompts: `.tmp/<lane>-wave-launcher/prompts/`
- logs: `.tmp/<lane>-wave-launcher/logs/`
- status summaries: `.tmp/<lane>-wave-launcher/status/`
- coordination logs: `.tmp/<lane>-wave-launcher/coordination/`
- message boards: `.tmp/<lane>-wave-launcher/messageboards/`
- compiled inboxes: `.tmp/<lane>-wave-launcher/inboxes/`
- ledger: `.tmp/<lane>-wave-launcher/ledger/`
- integration summaries: `.tmp/<lane>-wave-launcher/integration/`
- docs queue: `.tmp/<lane>-wave-launcher/docs-queue/`
- trace bundles: `.tmp/<lane>-wave-launcher/traces/`
- clarification triage: `.tmp/<lane>-wave-launcher/feedback/triage/`
- dashboards: `.tmp/<lane>-wave-launcher/dashboards/`
- Context7 cache: `.tmp/<lane>-wave-launcher/context7-cache/`
- executor overlays: `.tmp/<lane>-wave-launcher/executors/`
- cross-lane dependencies: `.tmp/wave-orchestrator/dependencies/`
- cross-wave orchestration board: `.tmp/wave-orchestrator/messageboards/orchestrator.md`

## Authoring Rules

- Every wave must include the configured evaluator agent.
- Under the starter config, every wave must also include the configured integration steward and documentation steward.
- From the configured thresholds onward, declare `## Component promotions` and keep them aligned with the component cutover matrix.
- From the configured thresholds onward, every non-A0/A8/A9 agent must declare `### Components` and emit `[wave-component]` markers for those components.
- `### Capabilities` is optional and lets the scheduler route targeted follow-up work by capability.
- `### Executor` can declare `profile`, `fallbacks`, `tags`, and runtime budgets in addition to vendor-specific overrides.
- Lane runtime policy can assign a default executor by role even when the wave omits `### Executor`.
- Use `### Role prompts` for standing-role imports from `docs/agents/*.md`.
- Optional standing roles available in this repo include `docs/agents/wave-infra-role.md` for infra proof and `docs/agents/wave-deploy-verifier-role.md` for rollout verification.
- Keep file ownership explicit inside each `### Prompt`.
- From the configured thresholds onward, declare `## Context7 defaults`, per-agent `### Context7`, and per-agent `### Exit contract`.
- Agents should use `wave coord post` for durable blockers, handoffs, evidence, and requests instead of relying on ad hoc board edits.
- Keep shared plan docs and the component cutover matrix owned by the configured documentation steward once that rule becomes active.

## Executor Modes

- `--executor codex` uses `codex exec` with the generated task prompt piped through stdin.
- `--executor claude` uses `claude -p` with the generated task prompt as the message and a harness runtime system-prompt overlay.
- `--executor opencode` uses `opencode run` with a generated runtime `opencode.json` and agent prompt overlay.
- `--executor local` exists only for smoke-testing prompt and closure behavior.
- `--codex-sandbox danger-full-access` is the default because it avoids host bubblewrap assumptions.
- Resolution order is: per-agent explicit executor id, executor profile id, lane role default, CLI `--executor`, then `executors.default`.
- Runtime mix targets are enforced before launch and again before any retry-time fallback reassignment.
- Fallbacks are declared in profiles or lane policy, can be applied automatically on retry when the next executor is available and still satisfies mix targets, and are recorded in the ledger, integration summary, and traces when used.
- Generic `budget.minutes` caps per-agent attempt timeouts. Generic `budget.turns` seeds `claude.maxTurns` and `opencode.steps` when executor-specific values are not set.
- The launcher writes runtime overlay files under `.tmp/<lane>-wave-launcher/executors/`; these should stay ignored and local.

## Human Feedback Queue

The file-backed feedback queue is now the final escalation layer, not the first-line clarification path. Operators can inspect and answer unresolved tickets with:

```bash
pnpm exec wave feedback list --lane main --pending
pnpm exec wave feedback show --id <request-id>
pnpm exec wave feedback respond --id <request-id> --response "..."
```

## Closure Sweep

If implementation agents ran, the launcher does not stop at `exit 0`. It checks implementation exit contracts, promoted component proof, and the integration recommendation first. Documentation and evaluator closure only run after integration is explicitly ready for doc closure; if integration reports `needs-more-work`, the wave stops there and retries only the implicated owners plus the integration steward.
