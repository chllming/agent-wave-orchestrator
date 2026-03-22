# Wave Orchestration

Wave Orchestration is a generic repository harness for running multi-agent work in bounded waves.

It includes:

- wave parsing and validation
- launcher, dashboard, autonomous, and human-feedback CLIs
- coordination log, helper-assignment decisions, generated board projection, compiled inboxes, and a per-wave ledger
- integration stewardship, docs queues, and versioned trace bundles under `.tmp/`
- typed cross-lane dependency tickets plus `wave dep` operator commands
- role prompt imports and closure-sweep gating
- component-cutover tracking and promotion gates
- Context7 bundle selection, prefetch, caching, and prompt injection
- starter docs and a sample wave scaffold

## Quick Start

Published package:
- `@chllming/wave-orchestration@0.5.2`
- Current release registry: `https://registry.npmjs.org`
- Release: [v0.5.2](https://github.com/chllming/wave-orchestration/releases/tag/v0.5.2)
- npmjs trusted publishing workflow: [publish-npm.yml](./.github/workflows/publish-npm.yml)

Install directly from npmjs:

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

## New In 0.5.2

- Example `[wave-*]` markers inside fenced snippets or prose no longer satisfy closure; only real standalone structured signals count.
- `### Deliverables` is now enforced as an ownership-scoped file contract, so declared outputs must stay inside that agent's `File ownership` block.
- Regression coverage now includes both of those failure paths directly.

## New In 0.5.1

- Phase 4 finalization now correctly stays blocked on unresolved human feedback and escalation items from completed waves.
- Hermetic trace fixtures now force local executor coverage for seeded control-plane agents, so replay tests cannot accidentally launch real Codex, Claude Code, or OpenCode sessions.
- npmjs is now the primary public install path.

## New In 0.5.0

- Capability-targeted work is now first-class: open capability requests become explicit helper assignments with deterministic assignee resolution, ledger visibility, inbox coverage, and closure barriers.
- Cross-lane work is now first-class too: `wave dep post|show|resolve|render` manages typed dependency tickets, and required inbound or outbound dependencies now surface directly in lane state and gating.
- Hermetic replay acceptance is now stronger around the runtime-orchestration layer, with stored outcome snapshots and launcher-generated local trace fixtures covering fallback, clarification, and dependency paths.
- The package now carries explicit repository metadata for package and release provenance.

## Requirements

- Node.js 22+
- `pnpm`
- `tmux` on `PATH` for dashboarded wave runs
- one or more real executors on `PATH`: `codex`, `claude`, or `opencode`
- optional: `CONTEXT7_API_KEY` for launcher-side Context7 prefetch

## Install Into Another Repo

1. Install from the public npmjs release:

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

2. Review the package-level config and starter assets in [wave.config.json](./wave.config.json) and [docs](./docs).

   This source repo is kept as an adopted Wave workspace; `node scripts/wave.mjs doctor --json` should stay green here.

3. Review the starter runbook in [docs/plans/wave-orchestrator.md](./docs/plans/wave-orchestrator.md), [docs/plans/context7-wave-orchestrator.md](./docs/plans/context7-wave-orchestrator.md), and [docs/plans/component-cutover-matrix.md](./docs/plans/component-cutover-matrix.md).

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

- [README.md](./README.md): package entry point, install flow, executor behavior, Context7 behavior, and command quick reference
- [docs/plans/wave-orchestrator.md](./docs/plans/wave-orchestrator.md): operator runbook for launch, coordination, closure, and upgrade flow
- [docs/plans/context7-wave-orchestrator.md](./docs/plans/context7-wave-orchestrator.md): Context7 setup, bundle authoring, injection order, and executor layering
- [docs/plans/current-state.md](./docs/plans/current-state.md): shipped runtime and package capabilities
- [docs/plans/master-plan.md](./docs/plans/master-plan.md): next priorities after the current shipped runtime
- [docs/plans/migration.md](./docs/plans/migration.md): adopt this package into another repository
- [docs/reference/github-packages-setup.md](./docs/reference/github-packages-setup.md): `.npmrc` and GitHub Packages auth details
- [docs/reference/npmjs-trusted-publishing.md](./docs/reference/npmjs-trusted-publishing.md): maintainer setup for zero-token npmjs publishing from GitHub Actions
- [docs/reference/runtime-config/README.md](./docs/reference/runtime-config/README.md): runtime precedence, merge rules, and generated artifact paths
- [docs/reference/runtime-config/codex.md](./docs/reference/runtime-config/codex.md): full Codex configuration reference
- [docs/reference/runtime-config/claude.md](./docs/reference/runtime-config/claude.md): full Claude configuration reference
- [docs/reference/runtime-config/opencode.md](./docs/reference/runtime-config/opencode.md): full OpenCode configuration reference
- [docs/reference/migration-0.2-to-0.5.md](./docs/reference/migration-0.2-to-0.5.md): migration guide for older Wave repos
- [docs/roadmap.md](./docs/roadmap.md): rationale, delivered phases, and remaining roadmap items

## Typical Harness Workflow

1. Initialize or adopt the workspace:
   Use `pnpm exec wave init` for a fresh repo or `pnpm exec wave init --adopt-existing` for an existing repo you do not want seeded with starter content.

2. Configure the repo:
   Edit [wave.config.json](./wave.config.json) for your docs layout, shared plan docs, role prompt paths, validator thresholds, component-cutover matrix paths, Context7 bundle index path, executor profiles, and per-lane runtime policy.

3. Write or revise the shared docs:
   Keep the shared plan docs aligned with the work you want the harness to execute.

4. Replace or revise the component cutover matrix:
   Keep [docs/plans/component-cutover-matrix.md](./docs/plans/component-cutover-matrix.md) and [docs/plans/component-cutover-matrix.json](./docs/plans/component-cutover-matrix.json) aligned with the components and maturity levels your repo actually uses.

5. Create a wave file:
   Put wave markdown under [docs/plans/waves](./docs/plans/waves) using the same sections as the sample [wave-0.md](./docs/plans/waves/wave-0.md).

6. Dry-run first:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

Dry-run now writes compiled prompts and executor previews under `.tmp/<lane>-wave-launcher/dry-run/`, including `executors/wave-<n>/<agent-slug>/launch-preview.json`.

7. Inspect the seeded coordination state and generated inboxes:

```bash
pnpm exec wave coord show --lane main --wave 0 --dry-run
pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run
pnpm exec wave dep show --lane main --wave 0 --json
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

Cross-lane work is also explicit and operator-visible:

```bash
pnpm exec wave dep post --owner-lane main --requester-lane release --owner-wave 0 --requester-wave 2 --agent launcher --summary "Need shared-plan reconciliation" --target capability:docs-shared-plan --required
pnpm exec wave dep show --lane main --wave 0 --json
pnpm exec wave dep resolve --lane main --id <dependency-id> --agent A8
```

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
- `assignments/wave-<n>.json`: resolved helper-assignment snapshot derived from open requests
- `messageboards/wave-<n>.md`: generated board projection for humans
- `inboxes/wave-<n>/`: compiled shared summary plus per-agent inboxes
- `ledger/wave-<n>.json`: derived task/blocker/closure state
- `integration/wave-<n>.json|md`: explicit or synthesized integration summary
- `dependencies/wave-<n>.json|md`: per-wave inbound/outbound dependency snapshot
- `docs-queue/wave-<n>.json`: documentation reconciliation queue
- `traces/wave-<n>/attempt-<k>/`: versioned attempt bundle with run metadata, quality metrics, prompts, logs, statuses, inboxes, and structured signals
- `feedback/triage/wave-<n>.jsonl|/pending-human.md`: clarification triage log plus unresolved human escalations
- `prompts/`, `logs/`, `status/`, `executors/`, and `context7-cache/`: run artifacts, overlays, and cached external-doc snippets

`wave.config.json` can now declare executor profiles and lane runtime policy. In this repo, `main` defaults implementation roles to `codex`, integration/documentation/evaluator roles to `claude`, and research or ops-heavy roles to `opencode`. Runtime mix targets are enforced before launch, retry fallbacks are chosen from the configured fallback chain when a failed agent can move safely, and those fallback decisions are recorded in the ledger, integration summary, and traces. Generic `budget.minutes` now caps attempt timeouts, and `budget.turns` seeds vendor turn or step limits when the executor-specific settings are absent.

## Trace And Replay

- `--dry-run` is still pre-attempt only. It writes the manifest, coordination log, rendered board, ledger, docs queue, integration summary, and compiled inboxes under `.tmp/<lane>-wave-launcher/dry-run/`.
- `--dry-run` does not write `attempt-<k>` trace snapshots. The `traces/` directory may exist in dry-run state, but it should remain file-empty.
- Real attempts write a full hermetic `traceVersion: 2` bundle under `.tmp/<lane>-wave-launcher/traces/wave-<n>/attempt-<k>/`.
- `run-metadata.json` is the canonical bundle index. It records the wave hash, attempt number, launcher settings, agent prompt hashes, executor history, Context7 snippet hashes, gate snapshot, artifact-presence map, `replayContext`, and `historySnapshot`.
- `outcome.json` is the stored replay baseline for the bundle. It carries the normalized stored gate snapshot plus the stored cumulative quality report so replay can compare recomputed results against a hashed bundle-local source of truth.
- For `traceVersion: 2`, every launched agent must have copied prompt, log, status, inbox, and summary artifacts inside the bundle. Waves with `## Component promotions` must also carry the copied component matrix JSON.
- `quality.json` is cumulative through the current attempt. It reports unresolved request and clarification counts, human-escalation and orchestrator-resolution counts, contradiction and documentation-drift counts, proof completeness, relaunch counts, fallback rate, acknowledgement and blocker timing, evaluator reversal, helper-assignment and dependency timing, and the final integration recommendation.
- Hermetic replay is read-only. Replay uses only the stored bundle contents, ignores inline summary duplicates in `run-metadata.json`, revalidates recorded artifact hashes, reports stored-vs-recomputed diffs for gate and quality state, and does not rewrite summaries or other bundle files.
- Legacy `traceVersion: 1` bundles are still accepted in best-effort mode with explicit warnings. They are not treated as fully hermetic.
- Replay validation is internal today. The source tree exposes helper modules for loading, validating, and replaying trace bundles, but there is no supported `wave replay` public CLI yet.

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
- `### Deliverables`
- `### Exit contract`
- `### Prompt`

Under the starter config in this repo, wave 0 and later also require:

- `A0` as the evaluator
- `A8` as the integration steward
- `A9` as the documentation steward

Optional standing roles are also available for infra- or rollout-heavy waves:

- `docs/agents/wave-infra-role.md`
- `docs/agents/wave-deploy-verifier-role.md`

The sample [wave-0.md](./docs/plans/waves/wave-0.md) is a complete valid example. The excerpt below shows the implementation-agent portion of a full wave:

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

### Deliverables

- src/example.ts
- test/example.test.ts

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

`### Deliverables` is also optional. When present, the launcher validates that each listed repo-relative file both exists and stays within the implementation agent's declared file ownership before the exit contract can pass.

Open capability-targeted requests now become explicit helper assignments. The launcher resolves them deterministically, writes the assignment snapshot under `.tmp/`, mirrors the decision into the coordination log for the board and replay surface, and keeps the wave blocked until the linked follow-up resolves.

The component matrix is also expected to reflect the landed state. Before a promoted wave closes, `docs/plans/component-cutover-matrix.json` should advance each promoted component's `currentLevel` to the proved target.

`### Executor` is optional. Resolution order is:

- per-agent `### Executor`
- selected executor profile id
- lane role default
- launcher `--executor`
- `wave.config.json` `executors.default`

Common keys:

- `id`
- `profile`
- `model`
- `fallbacks`
- `tags`
- `budget.turns`
- `budget.minutes`

The full supported runtime surface lives in:

- [docs/reference/runtime-config/README.md](./docs/reference/runtime-config/README.md)
- [docs/reference/runtime-config/codex.md](./docs/reference/runtime-config/codex.md)
- [docs/reference/runtime-config/claude.md](./docs/reference/runtime-config/claude.md)
- [docs/reference/runtime-config/opencode.md](./docs/reference/runtime-config/opencode.md)

Example runtime blocks:

````md
### Executor

- id: codex
- model: gpt-5-codex
- codex.profile_name: review
- codex.config: model_reasoning_effort=high
- codex.search: true
- codex.json: true
````

````md
### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.settings_json: {"permissions":{"allow":["Read"]}}
- claude.hooks_json: {"Stop":[{"command":"echo stop"}]}
- claude.allowed_http_hook_urls: https://example.com/hooks
````

````md
### Executor

- id: opencode
- opencode.files: README.md,docs/plans/current-state.md
- opencode.config_json: {"instructions":["Keep shared-plan edits concise."]}
````

When an implementation agent owns components, it must emit:

```text
[wave-component] component=<id> level=<level> state=<met|gap> detail=<short-note>
```

The launcher will not accept final completion until every promoted component has at least one matching `state=met` proof marker at the declared level.

## Executor Behavior

- `codex`
  The harness sends the generated task prompt through `codex exec` stdin. `--codex-sandbox` and `wave.config.json` `executors.codex.sandbox` control the default sandbox. Current runtime support includes CLI profile selection, inline `-c` overrides, search, images, extra directories, JSON mode, and ephemeral sessions.
- `claude`
  The harness launches `claude -p` headlessly. The generated task prompt becomes the run message, and a runtime overlay file is injected with `--append-system-prompt-file` by default. Current runtime support includes merged per-run settings overlays from a base `claude.settings` file plus inline settings JSON, hooks JSON, and allowed HTTP hook URLs. Switch to full replacement in `wave.config.json` with `executors.claude.appendSystemPromptMode: "replace"`.
- `opencode`
  The harness launches `opencode run` headlessly. The generated task prompt becomes the run message, and the harness writes an ignored runtime `opencode.json` plus a generated agent prompt under `.tmp/.../executors/`, then points `OPENCODE_CONFIG` at that overlay for the run. Current runtime support includes merged config JSON and repeated file attachments.
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

Dry-run executor previews are written under the same `executors/` tree as live overlays. For each agent, `launch-preview.json` records the resolved executor id, exported env vars, rate-limit retry mode, and the exact invocation lines that would be used in a real run.

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

4. Define or trim bundles in [docs/context7/bundles.json](./docs/context7/bundles.json).

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

The canonical source index is [docs/research/agent-context-sources.md](./docs/research/agent-context-sources.md). Hydrated paper or article caches should stay local and ignored under `docs/research/cache/` or `docs/research/agent-context-cache/`.

- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)
- [Building Effective AI Coding Agents for the Terminal: Scaffolding, Harness, Context Engineering, and Lessons Learned](https://arxiv.org/abs/2603.05344)
- [VeRO: An Evaluation Harness for Agents to Optimize Agents](https://arxiv.org/abs/2602.22480)
- [EvoClaw: Evaluating AI Agents on Continuous Software Evolution](https://arxiv.org/abs/2603.13428)
- [LLM-Based Multi-Agent Blackboard System for Information Discovery in Data Science](https://arxiv.org/abs/2510.01285)
- [Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture](https://arxiv.org/abs/2507.01701)
- [DOVA: Deliberation-First Multi-Agent Orchestration for Autonomous Research Automation](https://arxiv.org/abs/2603.13327)
- [Silo-Bench: A Scalable Environment for Evaluating Distributed Coordination in Multi-Agent LLM Systems](https://arxiv.org/abs/2603.01045)
- [SYMPHONY: Synergistic Multi-agent Planning with Heterogeneous Language Model Assembly](https://arxiv.org/abs/2601.22623)
- [An Open Agent Architecture](https://cdn.aaai.org/Symposia/Spring/1994/SS-94-03/SS94-03-001.pdf)
