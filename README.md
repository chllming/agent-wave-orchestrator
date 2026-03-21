# Wave Orchestration

Wave Orchestration is a generic repository harness for running multi-agent work in bounded waves.

It includes:

- wave parsing and validation
- launcher, dashboard, autonomous, and human-feedback CLIs
- role prompt imports and closure-sweep gating
- Context7 bundle selection, prefetch, caching, and prompt injection
- starter docs and a sample wave scaffold

## Requirements

- Node.js 22+
- `pnpm`
- `tmux` on `PATH` for dashboarded wave runs
- `codex` on `PATH` if you want real agent execution
- optional: `CONTEXT7_API_KEY` for launcher-side Context7 prefetch

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Review the repo-level config in [wave.config.json](/home/coder/wave-orchestration/wave.config.json).

3. Review the starter runbook in [docs/plans/wave-orchestrator.md](/home/coder/wave-orchestration/docs/plans/wave-orchestrator.md) and [docs/plans/context7-wave-orchestrator.md](/home/coder/wave-orchestration/docs/plans/context7-wave-orchestrator.md).

4. Dry-parse the starter wave:

```bash
pnpm wave:launch -- --lane main --dry-run --no-dashboard
```

5. When the wave parses cleanly, launch a single wave:

```bash
pnpm wave:launch -- --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access
```

## Typical Harness Workflow

1. Configure the repo:
   Edit [wave.config.json](/home/coder/wave-orchestration/wave.config.json) for your docs layout, shared plan docs, role prompt paths, validator thresholds, and Context7 bundle index path.

2. Write or revise the shared docs:
   Keep [docs/plans/current-state.md](/home/coder/wave-orchestration/docs/plans/current-state.md), [docs/plans/master-plan.md](/home/coder/wave-orchestration/docs/plans/master-plan.md), and [docs/plans/migration.md](/home/coder/wave-orchestration/docs/plans/migration.md) aligned with the work you want the waves to execute.

3. Create a wave file:
   Put wave markdown under [docs/plans/waves](/home/coder/wave-orchestration/docs/plans/waves) using the same sections as the sample [wave-0.md](/home/coder/wave-orchestration/docs/plans/waves/wave-0.md).

4. Dry-run first:

```bash
pnpm wave:launch -- --lane main --dry-run --no-dashboard
```

5. Reconcile stale state if needed:

```bash
pnpm wave:launch -- --lane main --reconcile-status
```

6. Check pending human feedback:

```bash
pnpm wave:feedback -- list --lane main --pending
```

7. Launch one wave at a time until the plan is stable:

```bash
pnpm wave:launch -- --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access
```

8. Use autonomous mode only after the wave set is already solid:

```bash
pnpm wave:autonomous -- --lane main --executor codex --codex-sandbox danger-full-access
```

## Wave File Shape

Each wave is regular markdown. The harness looks for:

- `## Context7 defaults`
- `## Agent <id>: <title>`
- `### Role prompts`
- `### Context7`
- `### Exit contract`
- `### Prompt`

Minimal example:

````md
# Wave 1 - Example

## Context7 defaults

- bundle: node-typescript
- query: "Node process spawning and vitest usage"

## Agent A0: Running Evaluator

### Role prompts

- docs/agents/wave-evaluator-role.md

### Context7

- bundle: none

### Prompt
```text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-1-evaluator.md
```

## Agent A1: Runtime Work

### Context7

- bundle: node-typescript
- query: "Node child_process and test execution"

### Exit contract

- completion: integrated
- durability: none
- proof: integration
- doc-impact: owned

### Prompt
```text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- src/example.ts
- test/example.test.ts
```
````

## Context7 Setup

1. Add `CONTEXT7_API_KEY` to `.env.local` at repo root.

2. Export it into your shell or run commands through the helper:

```bash
source scripts/context7-export-env.sh
```

or

```bash
bash scripts/context7-export-env.sh run pnpm context7:api-check
```

3. Verify the API key works:

```bash
pnpm context7:api-check
```

4. Define or trim bundles in [docs/context7/bundles.json](/home/coder/wave-orchestration/docs/context7/bundles.json).

5. Declare scope in the wave file:
   Use wave-level defaults for the general lane of work, then override per agent only when the agent truly needs a narrower or different external-doc slice.

## How Context7 Works In The Harness

- The launcher resolves Context7 scope in this order: agent `### Context7`, wave `## Context7 defaults`, lane default, then `none`.
- If a bundle is active, the launcher prefetches third-party snippets before starting the agent.
- The generated agent prompt includes a `Context7 scope for this run` block that lists:
  the bundle id, query focus, allowed libraries, and any prefetched non-canonical snippets.
- Prefetched text is included before the assigned implementation prompt.
- Cache output is written under `.tmp/<lane>-wave-launcher/context7-cache/`.
- Missing API keys or Context7 API failures do not block the wave; the launcher fails open and starts the agent without the prefetched snippets.
- You can disable injection for a run with `--no-context7`.

## Useful Commands

```bash
pnpm wave:launch -- --lane main --dry-run --no-dashboard
pnpm wave:launch -- --lane main --reconcile-status
pnpm wave:launch -- --lane main --start-wave 2 --end-wave 2 --executor codex --codex-sandbox danger-full-access
pnpm wave:launch -- --lane main --auto-next --executor codex --codex-sandbox danger-full-access
pnpm wave:feedback -- list --lane main --pending
pnpm wave:autonomous -- --lane main --executor codex --codex-sandbox danger-full-access
```

## Research Sources

The repository only commits a source index. Hydrated paper or article caches should stay local and ignored under `docs/research/cache/` or `docs/research/agent-context-cache/`.
