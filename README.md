# Wave Orchestration

Wave Orchestration is my framework for "vibe-coding." It keeps the speed of agentic coding, but makes the runtime, coordination, and context model explicit enough to inspect, replay, and improve.

The framework does three things:

1. It abstracts the agent runtime away without flattening everything to the lowest common denominator. The same waves, skills, planning, evaluation, proof, and traces can run across Claude, Codex, and OpenCode while still preserving runtime-native features through executor adapters.
2. It runs work as a blackboard-style multi-agent system. Agents do not just exchange chat messages; they work against shared state, generated inboxes, explicit ownership, and staged closure, and a wave keeps going until the declared goals, proof, production-live criteria, or eval targets are actually satisfied.
3. It compiles context dynamically for the task at hand. Shared memory, generated runtime files, project defaults, skills, Context7, and cached external docs are assembled at runtime so you do not have to hand-maintain separate Claude, Codex, or other context files.

## Core Ideas

- `One orchestrator, many runtimes.`
  Planning, skills, evals, proof, and traces stay constant while the executor adapter changes.
- `A blackboard-style multi-agent system.`
  Wave definitions, the coordination log, the control-plane log, and immutable result envelopes form the machine-trustable authority set; the rolling board, shared summary, inboxes, ledger, and integration views are generated projections over that state.
- `Completion is goal-driven and proof-bounded.`
  Waves close only when deliverables, proof artifacts, eval targets, dependencies, and closure stewards agree.
- `Context is compiled, not hand-maintained.`
  Wave builds runtime context from repo state, project memory, skills, Context7, and generated overlays.
- `The system is inspectable and replayable.`
  Dry-run previews, logs, dashboards, ledgers, traces, and replay make the system debuggable instead of mysterious.
- `Telemetry is local-first and proof-oriented.`
  Wave Control records typed run, proof, and benchmark events without making remote delivery part of the scheduler's critical path.

## How The Architecture Works

1. Define shared docs plus `docs/plans/waves/wave-<n>.md` files, or generate them with `wave draft`.
2. Run `wave launch --dry-run` to validate the wave and materialize prompts, shared summaries, inboxes, dashboards, and executor previews before any live execution.
3. During live execution, implementation agents write claims, evidence, requests, and decisions into the canonical coordination log instead of relying on ad hoc terminal narration.
4. The reducer and derived-state engines materialize blackboard projections from the canonical authority set: rolling board, shared summary, per-agent inboxes, ledger, docs queue, dependency views, and integration summaries.
5. Closure runs only when the integrated state is ready: optional `cont-EVAL` (`E0`), optional security review, integration (`A8`), documentation (`A9`), and `cont-QA` (`A0`).

## Architecture Surfaces

- `Wave contract`
  Shared plan docs, wave markdown, deliverables, proof artifacts, and eval targets define the goal.
- `Shared state`
  Decisions come from the canonical authority set; boards, inboxes, dashboards, and other summaries are human-facing or operator-facing projections.
- `Runtime abstraction`
  Executor adapters preserve Codex, Claude, and OpenCode-specific launch features without changing the higher-level wave contract.
- `Compiled context`
  Project profile memory, shared summary, inboxes, skills, Context7, and runtime overlays are generated for the chosen executor.
- `Proof and closure`
  Exit contracts, proof artifacts, eval markers, and closure stewards stop waves from closing on narrative-only PASS.
- `Replay and audit`
  Traces capture the attempt so failures can be inspected and replayed instead of guessed from screenshots.
- `Telemetry and control plane`
  Local-first event spools plus the Railway-hosted Wave Control service keep proof, benchmark validity, and selected artifacts queryable across runs.

## Example Output

Representative rolling message board output from a real wave run:

<img src="./docs/image.png" alt="Example rolling message board output showing claims, evidence, requests, and cont-QA closure for a wave run" width="100%" />

## Common MAS Failure Cases

Recent multi-agent research keeps returning to the same failure modes:

- `Cosmetic board, no canonical state`
  Agents appear coordinated, but there is no machine-trustable authority set underneath the conversation.
- `Hidden evidence never gets pooled`
  One agent has the critical fact, but it never reaches shared state before closure.
- `Communication without global-state reconstruction`
  Agents exchange information, but nobody reconstructs the correct cross-agent picture.
- `Simultaneous coordination collapse`
  A team that looks fine in serial work falls apart when multiple owners, blockers, or resources must move together.
- `Expert signal gets averaged away`
  The strongest specialist view is diluted into a weaker compromise.
- `Contradictions get smoothed over`
  Conflicts are narrated away instead of being turned into explicit repair work.
- `Premature closure`
  Agents say they are done before proof, evals, or integrated state actually support PASS.

Wave is built to mitigate those failures with a canonical authority set, generated blackboard projections, explicit ownership, goal-driven, proof-bounded closure, replayable traces, and local-first telemetry. For the research framing and the current gaps, see [docs/research/coordination-failure-review.md](./docs/research/coordination-failure-review.md). For the concrete signal map, see [docs/reference/proof-metrics.md](./docs/reference/proof-metrics.md).

## Quick Start

Current release:

- `@chllming/wave-orchestration@0.8.0`
- Release tag: [`v0.8.0`](https://github.com/chllming/agent-wave-orchestrator/releases/tag/v0.8.0)
- Public install path: npmjs
- Authenticated fallback: GitHub Packages

Highlights in `0.8.0`:

- Reducer and task replay hardening now keeps coordination-derived task identity deterministic and strengthens authoritative replay of live wave state.
- Gate evaluation, contradiction or fact schema wiring, and resume planning are aligned around control-plane state plus typed result-envelope reads.
- Live launcher evaluation now computes reducer snapshots during real runs instead of leaving that path effectively test-only.
- The package now ships a dedicated architecture hardening migration plan and aligns the active README, guides, role prompts, and starter skills to the canonical authority-set and thin-launcher model.
- Upgrade and operator docs now cover the full `0.8.0` package surface end to end.

Requirements:

- Node.js 22+
- `pnpm`
- `tmux` on `PATH` for dashboarded runs
- at least one executor on `PATH`: `codex`, `claude`, or `opencode`
- optional: `CONTEXT7_API_KEY` for launcher-side prefetch
- optional: `WAVE_CONTROL_AUTH_TOKEN` for remote Wave Control reporting

Install into another repo:

```bash
pnpm add -D @chllming/wave-orchestration
pnpm exec wave init
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
pnpm exec wave coord show --lane main --wave 0 --dry-run --json
```

If the repo already has Wave config, plans, or waves you want to keep:

```bash
pnpm exec wave init --adopt-existing
```

Fresh init also seeds a starter `skills/` library plus `docs/evals/benchmark-catalog.json`. The launcher projects those skill bundles into Codex, Claude, OpenCode, and local executor overlays after the final runtime for each agent is resolved, and waves that include `cont-EVAL` can declare `## Eval targets` against that catalog.

When runtime launch commands detect a newer npmjs release, Wave prints a non-blocking update notice on stderr. The fast path is `pnpm exec wave self-update`, which updates the dependency, prints the changelog delta, and then records the workspace upgrade report.

## Common Commands

```bash
# Save project defaults and draft a new wave
pnpm exec wave project setup
pnpm exec wave draft --wave 1 --template implementation

# Run one wave with a real executor
pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access

# Disable Wave Control reporting for a single launcher run
pnpm exec wave launch --lane main --no-telemetry

# Inspect operator surfaces
pnpm exec wave feedback list --lane main --pending
pnpm exec wave dep show --lane main --wave 0 --json

# Run autonomous mode after the wave set is stable
pnpm exec wave autonomous --lane main --executor codex --codex-sandbox danger-full-access

# Pull the latest published package and record the workspace upgrade
pnpm exec wave self-update
```

## Develop This Package

```bash
pnpm install
pnpm test
node scripts/wave.mjs launch --lane main --dry-run --no-dashboard
```

## Railway MCP

This repo includes a repo-local Railway MCP launcher so Codex, Claude, and Cursor can all talk to the same Railway project from the same checkout.

- launcher: `.codex-tools/railway-mcp/start.sh`
- project MCP config: `.mcp.json`
- Cursor MCP config: `.cursor/.mcp.json`
- Claude project settings: `.claude/settings.json`
- Railway project id: `b2427e79-3de9-49c3-aa5a-c86db83123c0`

One-time local checks:

```bash
railway whoami
railway link --project b2427e79-3de9-49c3-aa5a-c86db83123c0
codex mcp list
```

## Learn More

- [docs/README.md](./docs/README.md): docs map and suggested structure
- [docs/concepts/what-is-a-wave.md](./docs/concepts/what-is-a-wave.md): wave anatomy, blackboard execution model, and proof-bounded closure
- [docs/concepts/runtime-agnostic-orchestration.md](./docs/concepts/runtime-agnostic-orchestration.md): how one orchestration substrate spans Claude, Codex, OpenCode, and local execution
- [docs/concepts/context7-vs-skills.md](./docs/concepts/context7-vs-skills.md): compiled context, external truth, and repo-owned operating knowledge
- [docs/guides/planner.md](./docs/guides/planner.md): `wave project` and `wave draft` workflow
- [docs/guides/terminal-surfaces.md](./docs/guides/terminal-surfaces.md): tmux, VS Code terminal registry, and dry-run surfaces
- [docs/reference/sample-waves.md](./docs/reference/sample-waves.md): showcase-first authored waves, including a high-fidelity repo-landed rollout example
- [docs/plans/examples/wave-example-rollout-fidelity.md](./docs/plans/examples/wave-example-rollout-fidelity.md): concrete example of what good wave fidelity looks like for a narrow, closure-ready outcome
- [docs/reference/cli-reference.md](./docs/reference/cli-reference.md): complete CLI syntax for all commands and flags
- [docs/plans/wave-orchestrator.md](./docs/plans/wave-orchestrator.md): operator runbook
- [docs/plans/architecture-hardening-migration.md](./docs/plans/architecture-hardening-migration.md): staged cutover from the transitional launcher-centric runtime to the authority-set / reducer / phase-engine architecture
- [docs/plans/context7-wave-orchestrator.md](./docs/plans/context7-wave-orchestrator.md): Context7 setup and bundle authoring
- [docs/reference/runtime-config/README.md](./docs/reference/runtime-config/README.md): executor, runtime, and skill-projection configuration
- [docs/reference/wave-control.md](./docs/reference/wave-control.md): local-first telemetry contract and Railway control-plane model
- [docs/reference/proof-metrics.md](./docs/reference/proof-metrics.md): README failure cases mapped to concrete telemetry and benchmark evidence
- [docs/reference/skills.md](./docs/reference/skills.md): skill bundle format, resolution order, and runtime projection
- [docs/research/coordination-failure-review.md](./docs/research/coordination-failure-review.md): MAS failure modes from the research and how Wave responds
- [CHANGELOG.md](./CHANGELOG.md): release history

## Research Sources

Canonical source index:
- [docs/research/agent-context-sources.md](./docs/research/agent-context-sources.md)

The implementation is based on the following research:

**Harness and Runtime Surfaces**
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)
- [Building Effective AI Coding Agents for the Terminal: Scaffolding, Harness, Context Engineering, and Lessons Learned](https://arxiv.org/abs/2603.05344)
- [VeRO: An Evaluation Harness for Agents to Optimize Agents](https://arxiv.org/abs/2602.22480)
- [EvoClaw: Evaluating AI Agents on Continuous Software Evolution](https://arxiv.org/abs/2603.13428)
- [Verified Multi-Agent Orchestration: A Plan-Execute-Verify-Replan Framework for Complex Query Resolution](https://arxiv.org/abs/2603.11445)
- [Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models](https://arxiv.org/abs/2510.04618)

**Shared Coordination and Closure**
- [LLM-Based Multi-Agent Blackboard System for Information Discovery in Data Science](https://arxiv.org/abs/2510.01285)
- [Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture](https://arxiv.org/abs/2507.01701)
- [DOVA: Deliberation-First Multi-Agent Orchestration for Autonomous Research Automation](https://arxiv.org/abs/2603.13327)
- [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657)
- [Silo-Bench: A Scalable Environment for Evaluating Distributed Coordination in Multi-Agent LLM Systems](https://arxiv.org/abs/2603.01045)
- [An Open Agent Architecture](https://cdn.aaai.org/Symposia/Spring/1994/SS-94-03/SS94-03-001.pdf)

**Skills, Repo Context, and Reusable Operating Knowledge**
- [SoK: Agentic Skills -- Beyond Tool Use in LLM Agents](https://arxiv.org/abs/2602.20867)
- [Agent Skills for Large Language Models: Architecture, Acquisition, Security, and the Path Forward](https://arxiv.org/abs/2602.12430)
- [SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks](https://arxiv.org/abs/2602.12670)
- [Agent Workflow Memory](https://arxiv.org/abs/2409.07429)
- [Agent READMEs: An Empirical Study of Context Files for Agentic Coding](https://arxiv.org/abs/2511.12884)
- [Context Engineering for AI Agents in Open-Source Software](https://arxiv.org/abs/2510.21413)
