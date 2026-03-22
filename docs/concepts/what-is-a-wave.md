# What Is A Wave?

A wave is the main planning and execution unit in Wave Orchestration.

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
  One role inside the wave, such as implementation, integration, documentation, evaluator, infra, or deploy.
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

## Wave Anatomy

Wave markdown is the authored execution surface today. A typical wave can include:

- title and commit message
- project profile details such as oversight mode and lane
- sequencing note
- reference rule
- deploy environments
- component promotions
- Context7 defaults
- one `## Agent ...` block per role

Inside each agent block, the important sections are:

- `### Role prompts`
  Standing role identity imported from `docs/agents/*.md`.
- `### Executor`
  Runtime selection, profile, model, fallbacks, and budgets.
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

The starter runtime expects three closure roles:

- `A8`
  Integration steward
- `A9`
  Documentation steward
- `A0`
  Evaluator

Implementation or specialist agents own the actual work slices. Closure roles do not replace implementation ownership; they decide whether the combined result is closure-ready.

## Lifecycle Of A Wave

1. Author or draft the wave.
2. Run `wave launch --dry-run --no-dashboard`.
3. The launcher validates the wave, resolves executors and skills, builds prompts, and materializes operator surfaces.
4. A live run launches implementation agents first when implementation work remains.
5. Agents write structured coordination events instead of relying on ad hoc terminal output.
6. The launcher checks implementation contracts, promoted-component proof, helper assignments, dependencies, and clarification state.
7. If implementation is ready, closure runs in order: integration, documentation, evaluator.
8. The attempt is captured in per-wave traces, ledgers, inboxes, summaries, and copied artifacts.

## What Makes A Wave "Done"

A wave is not done because an agent said so. It is done only when the runtime surfaces agree:

- implementation exit contracts pass
- required deliverables exist and stay within ownership boundaries
- required component proof and promotions pass
- helper assignments are resolved
- required dependency tickets are resolved
- clarification follow-ups or escalations are resolved
- integration recommends closure
- documentation and evaluator closure pass

## Where The State Lives

The wave file is only part of the story. The runtime writes durable state under `.tmp/<lane>-wave-launcher/`, including:

- prompts and logs
- status summaries
- coordination logs
- rendered message boards
- compiled inboxes
- ledger and docs queue
- integration summaries
- dependency snapshots
- executor overlays
- trace bundles

That is why a wave is better understood as a bounded execution record, not just a markdown file.

## Planner Specs vs Markdown

The planner foundation adds a JSON draft spec at `docs/plans/waves/specs/wave-<n>.json`.

- The JSON spec is the canonical planner artifact.
- The rendered markdown stays compatible with the launcher and parser.
- The launcher still executes the markdown wave file today.

This split keeps authoring structured while preserving the established execution surface.
