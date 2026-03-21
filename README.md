# Wave Orchestration

Wave Orchestration is a generic repository harness for running multi-agent work in bounded waves.

It includes:

- wave parsing and validation
- launcher, dashboard, autonomous, and human-feedback CLIs
- coordination log, generated board projection, compiled inboxes, and a per-wave ledger
- integration stewardship, docs queues, and trace bundles under `.tmp/`
- role prompt imports and closure-sweep gating
- component-cutover tracking and promotion gates
- Context7 bundle selection, prefetch, caching, and prompt injection
- starter docs and a sample wave scaffold

## Quick Start

Published package:
- `@chllming/wave-orchestration@0.3.0`
- Registry: `https://npm.pkg.github.com`
- Release: [v0.3.0](https://github.com/chllming/wave-orchestration/releases/tag/v0.3.0)

Install:

```bash
pnpm add -D @chllming/wave-orchestration
pnpm exec wave init
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
pnpm exec wave coord show --lane main --wave 0 --dry-run
```

If your repo already has Wave config, docs, or waves you want to keep:

```bash
pnpm exec wave init --adopt-existing
```

## Requirements

- Node.js 22+
- `pnpm`
- `tmux` on `PATH` for dashboarded wave runs
- one or more real executors on `PATH`: `codex`, `claude`, or `opencode`
- optional: `CONTEXT7_API_KEY` for launcher-side Context7 prefetch

## Install Into Another Repo

1. Configure GitHub Packages auth as shown in [github-packages-setup.md](/home/coder/wave-orchestration/docs/reference/github-packages-setup.md).

2. Add the package:

```bash
pnpm add -D @chllming/wave-orchestration
```

3. Initialize the repo:

Fresh repo:

```bash
pnpm exec wave init
```

Existing repo with Wave config/docs/waves you want to preserve:

```bash
pnpm exec wave init --adopt-existing
```

4. Run a non-mutating health check:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

5. Upgrade later without overwriting plans or waves:

```bash
pnpm up @chllming/wave-orchestration
pnpm exec wave upgrade
pnpm exec wave changelog --since-installed
```

`wave upgrade` only updates `.wave/install-state.json` and writes upgrade reports under `.wave/upgrade-history/`. It does not overwrite existing `wave.config.json`, role prompts, plan docs, or wave files.

## Develop This Package

1. Install dependencies in this source repo:

```bash
pnpm install
```

2. Review the package-level config and starter assets in [wave.config.json](/home/coder/wave-orchestration/wave.config.json) and [docs](/home/coder/wave-orchestration/docs).

3. Review the starter runbook in [docs/plans/wave-orchestrator.md](/home/coder/wave-orchestration/docs/plans/wave-orchestrator.md), [docs/plans/context7-wave-orchestrator.md](/home/coder/wave-orchestration/docs/plans/context7-wave-orchestrator.md), and [docs/plans/component-cutover-matrix.md](/home/coder/wave-orchestration/docs/plans/component-cutover-matrix.md).

4. Dry-parse the starter wave:

```bash
node scripts/wave.mjs launch --lane main --dry-run --no-dashboard
```

5. When the wave parses cleanly, launch a single wave:

```bash
node scripts/wave.mjs launch --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access
```

Alternative real executors:

```bash
node scripts/wave.mjs launch --lane main --start-wave 0 --end-wave 0 --executor claude
node scripts/wave.mjs launch --lane main --start-wave 0 --end-wave 0 --executor opencode
```

## Documentation Map

- [README.md](/home/coder/wave-orchestration/README.md): package entry point, install flow, executor behavior, Context7 behavior, and command quick reference
- [docs/plans/wave-orchestrator.md](/home/coder/wave-orchestration/docs/plans/wave-orchestrator.md): operator runbook for launch, coordination, closure, and upgrade flow
- [docs/plans/context7-wave-orchestrator.md](/home/coder/wave-orchestration/docs/plans/context7-wave-orchestrator.md): Context7 setup, bundle authoring, injection order, and executor layering
- [docs/plans/current-state.md](/home/coder/wave-orchestration/docs/plans/current-state.md): shipped runtime and package capabilities
- [docs/plans/master-plan.md](/home/coder/wave-orchestration/docs/plans/master-plan.md): next priorities after the current shipped runtime
- [docs/plans/migration.md](/home/coder/wave-orchestration/docs/plans/migration.md): adopt this package into another repository
- [docs/reference/github-packages-setup.md](/home/coder/wave-orchestration/docs/reference/github-packages-setup.md): `.npmrc` and GitHub Packages auth details
- [docs/reference/migration-0.2-to-0.5.md](/home/coder/wave-orchestration/docs/reference/migration-0.2-to-0.5.md): migration guide for older Wave repos
- [docs/roadmap.md](/home/coder/wave-orchestration/docs/roadmap.md): rationale, delivered phases, and remaining roadmap items

## Typical Harness Workflow

1. Initialize or adopt the workspace:
   Use `pnpm exec wave init` for a fresh repo or `pnpm exec wave init --adopt-existing` for an existing repo you do not want seeded with starter content.

2. Configure the repo:
   Edit [wave.config.json](/home/coder/wave-orchestration/wave.config.json) for your docs layout, shared plan docs, role prompt paths, validator thresholds, component-cutover matrix paths, Context7 bundle index path, executor profiles, and per-lane runtime policy.

3. Write or revise the shared docs:
   Keep the shared plan docs aligned with the work you want the harness to execute.

4. Replace or revise the component cutover matrix:
   Keep [docs/plans/component-cutover-matrix.md](/home/coder/wave-orchestration/docs/plans/component-cutover-matrix.md) and [docs/plans/component-cutover-matrix.json](/home/coder/wave-orchestration/docs/plans/component-cutover-matrix.json) aligned with the components and maturity levels your repo actually uses.

5. Create a wave file:
   Put wave markdown under [docs/plans/waves](/home/coder/wave-orchestration/docs/plans/waves) using the same sections as the sample [wave-0.md](/home/coder/wave-orchestration/docs/plans/waves/wave-0.md).

6. Dry-run first:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

7. Inspect the seeded coordination state and generated inboxes:

```bash
pnpm exec wave coord show --lane main --wave 0 --dry-run
pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run
```

8. Reconcile stale state if needed:

```bash
pnpm exec wave launch --lane main --reconcile-status
```

9. Check pending human feedback:

```bash
pnpm exec wave feedback list --lane main --pending
```

The harness now tries to resolve clarification requests before asking a human. Agents should emit `clarification-request` coordination records first; unresolved items are written into `.tmp/<lane>-wave-launcher/feedback/triage/` and only then become human feedback tickets. Routed clarification follow-ups stay blocking until the linked request or escalation is fully resolved.

10. Launch one wave at a time until the plan is stable:

```bash
pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access
```

11. Use autonomous mode only after the wave set is already solid:

```bash
pnpm exec wave autonomous --lane main --executor codex --codex-sandbox danger-full-access
```

## Runtime Artifacts

The launcher writes runtime state under `.tmp/<lane>-wave-launcher/`:

- `coordination/wave-<n>.jsonl`: append-only coordination upsert log
- `messageboards/wave-<n>.md`: generated board projection for humans
- `inboxes/wave-<n>/`: compiled shared summary plus per-agent inboxes
- `ledger/wave-<n>.json`: derived task/blocker/closure state
- `integration/wave-<n>.json|md`: explicit or synthesized integration summary
- `docs-queue/wave-<n>.json`: documentation reconciliation queue
- `traces/wave-<n>/attempt-<k>/`: replay-oriented attempt bundle
- `feedback/triage/wave-<n>.jsonl|/pending-human.md`: clarification triage log plus unresolved human escalations
- `prompts/`, `logs/`, `status/`, `executors/`, and `context7-cache/`: run artifacts, overlays, and cached external-doc snippets

`wave.config.json` can now declare executor profiles and lane runtime policy. In this repo, `main` defaults implementation roles to `codex`, integration/documentation/evaluator roles to `claude`, and research or ops-heavy roles to `opencode`. Runtime mix targets are enforced before launch, retry fallbacks are chosen from the configured fallback chain when a failed agent can move safely, and those fallback decisions are recorded in the ledger, integration summary, and traces. Generic `budget.minutes` now caps attempt timeouts, and `budget.turns` seeds vendor turn or step limits when the executor-specific settings are absent.

## Wave File Shape

Each wave is regular markdown. The harness looks for:

- `## Component promotions`
- `## Context7 defaults`
- `## Agent <id>: <title>`
- `### Executor`
- `### Role prompts`
- `### Context7`
- `### Components`
- `### Capabilities`
- `### Exit contract`
- `### Prompt`

Under the starter config in this repo, wave 0 and later also require:

- `A0` as the evaluator
- `A8` as the integration steward
- `A9` as the documentation steward

Optional standing roles are also available for infra- or rollout-heavy waves:

- `docs/agents/wave-infra-role.md`
- `docs/agents/wave-deploy-verifier-role.md`

The sample [wave-0.md](/home/coder/wave-orchestration/docs/plans/waves/wave-0.md) is a complete valid example. The excerpt below shows the implementation-agent portion of a full wave:

````md
# Wave 1 - Example

## Component promotions

- wave-parser-and-launcher: repo-landed

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

### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.max_turns: 4

### Context7

- bundle: node-typescript
- query: "Node child_process and test execution"

### Components

- wave-parser-and-launcher

### Capabilities

- runtime
- validation

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

`## Component promotions` declares the component levels this wave is responsible for proving. `### Components` assigns each promoted component to one or more implementation agents.

`### Capabilities` is optional. It lets the coordination layer route targeted follow-up work to a capability rather than a single hard-coded agent.

The component matrix is also expected to reflect the landed state. Before a promoted wave closes, `docs/plans/component-cutover-matrix.json` should advance each promoted component's `currentLevel` to the proved target.

`### Executor` is optional. Resolution order is:

- per-agent `### Executor`
- launcher `--executor`
- `wave.config.json` `executors.default`

Supported keys:

- `id`
- `model`
- `codex.sandbox`
- `claude.agent`
- `claude.permission_mode`
- `claude.max_turns`
- `claude.mcp_config`
- `opencode.agent`
- `opencode.attach`
- `opencode.format`
- `opencode.steps`

When an implementation agent owns components, it must emit:

```text
[wave-component] component=<id> level=<level> state=<met|gap> detail=<short-note>
```

The launcher will not accept final completion until every promoted component has at least one matching `state=met` proof marker at the declared level.

## Executor Behavior

- `codex`
  The harness sends the generated task prompt through `codex exec` stdin. `--codex-sandbox` and `wave.config.json` `executors.codex.sandbox` control the default sandbox.
- `claude`
  The harness launches `claude -p` headlessly. The generated task prompt becomes the run message, and a runtime overlay file is injected with `--append-system-prompt-file` by default. Switch to full replacement in `wave.config.json` with `executors.claude.appendSystemPromptMode: "replace"`.
- `opencode`
  The harness launches `opencode run` headlessly. The generated task prompt becomes the run message, and the harness writes an ignored runtime `opencode.json` plus a generated agent prompt under `.tmp/.../executors/`, then points `OPENCODE_CONFIG` at that overlay for the run.
- `local`
  Smoke-test only. It creates placeholder deliverables and emits the expected Wave markers, but it is not a real agent runtime.

The run-level default executor comes from `wave.config.json`:

```json
{
  "executors": {
    "default": "codex",
    "codex": {
      "command": "codex",
      "sandbox": "danger-full-access"
    },
    "claude": {
      "command": "claude",
      "appendSystemPromptMode": "append",
      "outputFormat": "text"
    },
    "opencode": {
      "command": "opencode",
      "format": "default"
    }
  }
}
```

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
- Prefetched text is included before the assigned implementation prompt, regardless of executor.
- Cache output is written under `.tmp/<lane>-wave-launcher/context7-cache/`.
- Executor runtime overlays are written under `.tmp/<lane>-wave-launcher/executors/`.
- Missing API keys or Context7 API failures do not block the wave; the launcher fails open and starts the agent without the prefetched snippets.
- You can disable injection for a run with `--no-context7`.

Layering by executor:

- `codex`: repository rules + generated task prompt with injected Context7 block
- `claude`: repository `CLAUDE.md` / Claude settings + harness append-system-prompt overlay + generated task prompt with injected Context7 block
- `opencode`: repository `AGENTS.md` / project `opencode.json` + harness runtime `OPENCODE_CONFIG` overlay + generated task prompt with injected Context7 block

## Useful Commands

```bash
pnpm exec wave init
pnpm exec wave init --adopt-existing
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
pnpm exec wave coord show --lane main --wave 0 --dry-run --json
pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run
pnpm exec wave coord render --lane main --wave 0 --dry-run
pnpm exec wave coord post --lane main --wave 0 --agent A1 --kind blocker --summary "Need repository decision"
pnpm exec wave launch --lane main --reconcile-status
pnpm exec wave launch --lane main --start-wave 2 --end-wave 2 --executor codex --codex-sandbox danger-full-access
pnpm exec wave launch --lane main --start-wave 2 --end-wave 2 --executor claude
pnpm exec wave launch --lane main --start-wave 2 --end-wave 2 --executor opencode
pnpm exec wave launch --lane main --auto-next --executor codex --codex-sandbox danger-full-access
pnpm exec wave feedback list --lane main --pending
pnpm exec wave feedback show --id <request-id>
pnpm exec wave feedback respond --id <request-id> --response "..." --operator "<name>"
pnpm exec wave autonomous --lane main --executor codex --codex-sandbox danger-full-access
pnpm exec wave autonomous --lane main --executor claude
pnpm exec wave autonomous --lane main --executor opencode
pnpm exec wave upgrade
pnpm exec wave changelog --since-installed
```

## Research Sources

The repository only commits a source index. Hydrated paper or article caches should stay local and ignored under `docs/research/cache/` or `docs/research/agent-context-cache/`.

- [Effective harnesses for long-running agents](./docs/research/agent-context-cache/articles/effective-harnesses-for-long-running-agents.md)
- [Harness engineering: leveraging Codex in an agent-first world](./docs/research/agent-context-cache/articles/harness-engineering-leveraging-codex-in-an-agent-first-world.md)
- [Unlocking the Codex harness: how we built the App Server](./docs/research/agent-context-cache/articles/unlocking-the-codex-harness-how-we-built-the-app-server.md)
- [Building Effective AI Coding Agents for the Terminal: Scaffolding, Harness, Context Engineering, and Lessons Learned](./docs/research/agent-context-cache/papers/building-effective-ai-coding-agents-for-the-terminal-scaffolding-harness-context-engineering-and-lessons-learned.md)
- [VeRO: An Evaluation Harness for Agents to Optimize Agents](./docs/research/agent-context-cache/papers/vero-an-evaluation-harness-for-agents-to-optimize-agents.md)
- [EvoClaw: Evaluating AI Agents on Continuous Software Evolution](./docs/research/agent-context-cache/papers/evoclaw-evaluating-ai-agents-on-continuous-software-evolution.md)
- [LLM-based Multi-Agent Blackboard System for Information Discovery in Data Science](./docs/research/agent-context-cache/papers/llm-based-multi-agent-blackboard-system-for-information-discovery-in-data-science.md)
- [Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture](./docs/research/agent-context-cache/papers/exploring-advanced-llm-multi-agent-systems-based-on-blackboard-architecture.md)
- [DOVA: Deliberation-First Multi-Agent Orchestration for Autonomous Research Automation](./docs/research/agent-context-cache/papers/dova-deliberation-first-multi-agent-orchestration-for-autonomous-research-automation.md)
- [Silo-Bench: A Scalable Environment for Evaluating Distributed Coordination in Multi-Agent LLM Systems](./docs/research/agent-context-cache/papers/silo-bench-a-scalable-environment-for-evaluating-distributed-coordination-in-multi-agent-llm-systems.md)
- [SYMPHONY: Synergistic Multi-agent Planning with Heterogeneous Language Model Assembly](./docs/research/agent-context-cache/papers/symphony-synergistic-multi-agent-planning-with-heterogeneous-language-model-assembly.md)
- [An Open Agent Architecture](./docs/research/agent-context-cache/papers/an-open-agent-architecture.md)
