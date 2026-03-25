---
title: "Sample Waves"
summary: "Showcase-first sample waves that demonstrate the shipped 0.8.5 authored surface, including the optional design-role path."
---

# Sample Waves

This guide points to showcase-first sample waves that demonstrate the shipped `0.8.5` authored Wave surface.

The examples are intentionally denser than typical production waves. Their job is to teach the current authoring and runtime surface quickly, not to be the smallest possible launch-ready files.

## Canonical Examples

- [High-fidelity repo-landed rollout wave](../plans/examples/wave-example-rollout-fidelity.md)
  Shows what a good `repo-landed` outcome looks like when one promoted component only closes honestly if desired-state records, reconcile-loop substrate, and cluster-view surfaces land together. It emphasizes maturity discipline, explicit deliverables, and shared-plan closure without drifting into `pilot-live` claims.

- [Full modern sample wave](../plans/examples/wave-example-live-proof.md)
  Shows the combined `0.8.5` authored surface in one file: closure roles, `E0`, optional security review, delegated and pinned benchmark targets, richer executor config, `### Skills`, `### Capabilities`, `### Deliverables`, `### Exit contract`, `### Proof artifacts`, sticky retry, deploy environments, and proof-first live-wave structure.

- [Optional design-steward handoff wave](../plans/examples/wave-example-design-handoff.md)
  Shows the shipped design-role surface: one pre-implementation design steward publishes a design packet, downstream implementation owners read that packet before coding, and normal closure roles still decide final completion. For terminal or operator-surface work, pair that shape with explicit `tui-design` in the design steward's `### Skills`. For the hybrid variant, explicitly give that same design agent implementation-owned paths and the normal implementation contract sections.

## What These Examples Teach

- the standard closure-role structure with `A0`, `A8`, and `A9`
- `E0` and wave-level `## Eval targets` in the full modern sample
- honest `repo-landed` maturity framing without `pilot-live` drift
- multi-slice component promotion where all sibling owners must land together
- shared-plan and component-matrix closure as part of the architecture truth
- delegated versus pinned benchmark selection
- coordination benchmark families from `docs/evals/benchmark-catalog.json`
- richer executor blocks, runtime budgets, and retry policy
- cross-runtime `### Skills`
- helper-routing hints via `### Capabilities`
- `### Deliverables`
- `### Exit contract`
- proof-first `### Proof artifacts`
- sticky retry for proof-bearing owners
- deploy environments and provider-skill examples
- infra and deploy-verifier specialist slices
- optional pre-implementation design packets and design-to-implementation handoff

## Feature Coverage Map

Together these samples cover the main surfaces added or hardened through `0.8.5`:

- repo-landed maturity discipline and anti-overclaim framing
- explicit shared-plan closure for future-wave safety
- coordinated component slices with per-agent deliverables
- planner-era authored wave structure
- cross-runtime `### Skills`
- richer `### Executor` blocks and runtime budgets
- `cont-EVAL` plus `## Eval targets`
- delegated and pinned benchmark selection
- coordination benchmark families from `docs/evals/benchmark-catalog.json`
- helper-routing hints through `### Capabilities`
- `### Deliverables`
- `### Proof artifacts`
- sticky retry for proof-bearing owners
- proof-first live-wave prompts
- deploy environments and deploy-kind-aware skills
- integration, documentation, and cont-QA closure-role structure
- optional `design` worker role and `design-pass` executor profile

## When To Copy Literally Vs Adapt

Copy more literally when:

- you need the section layout
- you want a concrete example of what good repo-landed wave fidelity looks like
- you want concrete wording for delegated versus pinned benchmark targets
- you want a proof-first owner example with local artifact bundles and sticky retry

Adapt more aggressively when:

- your repo has different role ids or role prompts
- your component promotions and maturity levels differ
- your runtime policy uses different executor profiles or runtime mix targets
- your deploy environments or provider skills differ from the example

## How This Example Maps To Other Docs

- Use [docs/guides/planner.md](../guides/planner.md) for the planner-generated baseline, then use these samples to see how a human would enrich the generated draft for either repo-landed or proof-first work.
- Use [Optional design-steward handoff wave](../plans/examples/wave-example-design-handoff.md) when the wave should start with a reusable design packet before implementation begins.
- Use [docs/evals/README.md](../evals/README.md) with the full modern sample when you need to see delegated and pinned benchmark targets in a real wave.
- Use [docs/reference/live-proof-waves.md](./live-proof-waves.md) with the full modern sample when you need proof-first authoring for `pilot-live` and above.
- Use [docs/plans/wave-orchestrator.md](../plans/wave-orchestrator.md) for the operational runbook that explains how the launcher interprets these sections.

## Suggested Reading Order

1. Start with [High-fidelity repo-landed rollout wave](../plans/examples/wave-example-rollout-fidelity.md) if you want the clearest example of good closure-ready wave fidelity for a repo-only outcome.
2. Read [Full modern sample wave](../plans/examples/wave-example-live-proof.md) if you want the denser proof-first and eval-heavy `0.8.5` surface.
3. Read [Optional design-steward handoff wave](../plans/examples/wave-example-design-handoff.md) if the task needs a design packet before implementation fan-out.
4. Read [docs/evals/README.md](../evals/README.md) if you want more background on benchmark target selection.
5. Read [docs/reference/live-proof-waves.md](./live-proof-waves.md) if you want more detail on proof-first `pilot-live` authoring.

## Why These Examples Live In `docs/plans/examples/`

The examples live outside `docs/plans/waves/` on purpose.

That keeps it:

- easy to browse as teaching material
- clearly separate from the repo's real launcher-facing wave sequence
- safe to evolve as reference material without implying that they are part of the current lane's actual plan history
