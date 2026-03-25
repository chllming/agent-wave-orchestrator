# What Is A Wave?

A wave is the main planning and execution unit in Wave Orchestration.

It turns free-form agent runs into a bounded blackboard-style work package with shared state, explicit ownership, dynamic context, goal-driven execution, and proof-bounded closure.

It is not just a prompt file. A wave is a bounded slice of repository work with:

- explicit scope
- named owners
- runtime and context requirements
- proof and closure rules
- durable coordination state
- replayable execution artifacts

## Core Terms

- Lane
  An ordered sequence of waves. The default lane in this repo is `main`.
- Wave
  One numbered work package inside a lane, usually stored as `docs/plans/waves/wave-<n>.md`.
- Agent
  One role inside the wave, such as design, implementation, `cont-EVAL`, security review, integration, documentation, cont-QA, infra, or deploy.
- Attempt
  One execution pass of a wave. A wave can have multiple attempts due to retries or fallback.
- Closure
  The final proof pass that decides whether the wave is actually done, not just partially implemented.

## Why Waves Exist

Waves force a higher planning bar than ad hoc prompts. A good wave answers:

- What is changing now, and why now?
- Which components or docs are in scope?
- Which agent owns each slice?
- What evidence closes the wave?
- Which dependencies, helper requests, or escalations can still block completion?

## Why This Is A Blackboard-Style Model

Wave is blackboard-style because agents work against shared canonical state instead of treating chat output as the system of record.

- wave definitions, the coordination log, and the control-plane log form the canonical authority set
- attempt-scoped result envelopes are the immutable structured outcome surface for completed agent work
- the rolling board is a human projection over that state, not a decision input
- shared summaries and per-agent inboxes are compiled views over the same authority set
- helper assignments, clarification flow, dependencies, and integration all operate on that shared state
- closure depends on the integrated state, not on whether an agent says "done"

## Wave Anatomy

Wave markdown is one authored declaration surface today. A typical wave can include:

- title and commit message
- project profile details such as oversight mode and lane
- sequencing note
- reference rule
- deploy environments
- component promotions
- eval targets
- Context7 defaults
- one `## Agent ...` block per role

Inside each agent block, the important sections are:

- `### Role prompts`
  Standing role identity imported from `docs/agents/*.md`.
- `### Executor`
  Runtime selection, profile, model, fallbacks, and budgets.
- `## Eval targets`
  Optional wave-level contract for `cont-EVAL`, including benchmark family or pinned benchmarks, objective, and stop condition.
  See [docs/evals/README.md](../evals/README.md) for guidance on delegated versus pinned targets and the coordination benchmark families.
- `### Proof artifacts`
  Optional machine-visible local evidence required for proof-centric waves, especially `pilot-live` and above.
- `### Context7`
  External library truth to prefetch and inject.
- `### Skills`
  Reusable repo-owned environment or workflow guidance resolved after runtime selection.
- `### Components`
  The components that agent is responsible for proving or promoting.
- `### Capabilities`
  Optional routing hints for follow-up work.
- `### Deliverables`
  Exact repo-relative outputs that must exist before closure can pass.
- `### Prompt`
  The specific task, file ownership, requirements, and validation instructions.
- `### Exit contract`
  The completion, durability, proof, and documentation expectations that gate closure.

## Standard Roles

The starter runtime ships with three default closure roles plus optional specialists. A wave may override the role ids, but the closure semantics stay the same:

- `A8`
  Integration steward
- `A9`
  Documentation steward
- `A0`
  cont-QA
- `E0`
  Optional `cont-EVAL` for iterative benchmark or output tuning; report-only by default, implementation-owning only when explicitly assigned non-report files
- `A7`
  Optional security reviewer; report-only by default and used to publish a threat-model-first security review before integration closure
- `D1` or another custom id
  Optional design steward; report-first and docs/spec-owned by default, used to publish a design packet before code-owning implementation fans out. If the wave explicitly gives that same agent source-code ownership, it becomes a hybrid design steward that rejoins the later implementation fan-out.

Implementation or specialist agents own the actual work slices. Closure roles do not replace implementation ownership; they decide whether the combined result is closure-ready. `cont-EVAL` is the one hybrid role: most waves keep it report-only, but human-authored waves may assign explicit tuning files to `E0`, in which case it must satisfy both implementation proof and eval proof.

## Lifecycle Of A Wave

1. Author or draft the wave.
2. Run `wave launch --dry-run --no-dashboard`.
3. The launcher parses the wave, resolves executors and skills, rebuilds reducer state, and materializes operator surfaces.
4. A live run launches design agents first when the wave declares them.
5. Code-owning implementation agents start only after every design packet is `ready-for-implementation`; hybrid design stewards rejoin that implementation fan-out once the design gate clears.
6. Agents write structured coordination events instead of relying on ad hoc terminal output.
7. The reducer, gate engine, and retry or closure engines evaluate design readiness, implementation contracts, promoted-component proof, helper assignments, dependencies, contradictions, and clarification state.
8. If implementation is ready, closure runs in order: optional `cont-EVAL`, optional security review, integration, documentation, then cont-QA.
9. The attempt is captured in per-wave traces, ledgers, inboxes, summaries, and copied artifacts.

## Runtime And Operating Posture

Wave is runtime agnostic at the orchestration layer.

Planning, ownership, closure, durable state, and traces do not depend on whether an agent runs on Codex, Claude Code, OpenCode, or the local smoke executor. Runtime-specific behavior is isolated to executor adapters and overlays.

That means a wave should usually be authored in runtime-neutral terms:

- ownership and deliverables
- proof and validation
- closure order
- dependencies and helper flow
- promoted component expectations

The runtime choice resolves later, from the agent executor block, profile defaults, lane defaults, CLI overrides, and fallback policy.

Wave also has an execution posture:

- `oversight`
  Human review or intervention is expected for risky or ambiguous work.
- `dark-factory`
  The wave is authored for routine execution without normal human intervention.

Today these postures are planning vocabulary and saved project defaults, not two separate execution engines. Human feedback is still an escalation mechanism inside the orchestration loop, not the definition of the operating mode itself.

If you need the narrower supporting pages, see [runtime-agnostic-orchestration.md](./runtime-agnostic-orchestration.md) and [operating-modes.md](./operating-modes.md).

Current live waves are strict about closure artifacts:

- `cont-EVAL` must emit a structured `[wave-eval]` marker whose `target_ids` matches the declared eval targets and whose `benchmark_ids` enumerates the executed benchmark set.
- Security reviewers must leave a security review report and emit a final `[wave-security]` marker with `state=<clear|concerns|blocked>`, finding count, and approval count.
- `cont-QA` must emit both a final `Verdict:` line and a final `[wave-gate]` marker.
- Replay keeps read-only compatibility with older traces and older evaluator-era artifacts, but live waves do not pass on verdict-only or underspecified closure markers.

## Context Is Compiled At Runtime

Wave also treats context as something to compile for the current task, not something humans should hand-maintain separately for each runtime.

The active context for an agent is assembled from:

- repository source and owned files
- wave markdown and shared plan docs
- saved project defaults such as `.wave/project-profile.json`
- the generated shared summary and the agent's inbox
- resolved skills and runtime-specific skill projections
- selected Context7 snippets for external library truth
- generated executor overlays and launch artifacts

That is why switching an agent between Codex, Claude, or OpenCode does not require maintaining separate parallel context files. The orchestrator recomputes the context package for the selected runtime and the current wave state.

## What Makes A Wave "Done"

A wave is not done because an agent said so. It is done only when the runtime surfaces agree:

- implementation exit contracts pass
- if present, design packets are complete and every design worker reports `ready-for-implementation`
- required deliverables exist and stay within ownership boundaries
- required proof artifacts exist when the wave declares proof-first live evidence
- required component proof and promotions pass
- helper assignments are resolved
- required dependency tickets are resolved
- clarification follow-ups or escalations are resolved
- if present, `cont-EVAL` satisfies its declared eval targets
- if present, the security reviewer publishes a report plus a final `[wave-security]` marker; `blocked` stops closure while `concerns` stays advisory
- integration recommends closure
- documentation and cont-QA closure pass

For proof-first live-wave examples, see [docs/reference/live-proof-waves.md](../reference/live-proof-waves.md).

## Where The State Lives

The wave file is only part of the story. The runtime writes durable state under `.tmp/<lane>-wave-launcher/`, including:

- prompts and logs
- result envelopes
- status summaries
- coordination logs
- rendered message boards
- compiled inboxes
- ledger and docs queue
- security summaries
- integration summaries
- dependency snapshots
- executor overlays
- trace bundles

That is why a wave is better understood as a bounded execution record, not just a markdown file.

## Planner Specs vs Markdown

The planner foundation adds a JSON draft spec at `docs/plans/waves/specs/wave-<n>.json`.

- The JSON spec is the canonical planner artifact.
- The rendered markdown stays compatible with the current parser and operator workflow.
- Live execution decisions come from parsed wave definitions plus canonical state, not from treating markdown as the only execution authority.

This split keeps authoring structured while preserving the established declaration surface.
