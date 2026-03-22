---
title: "Sample Waves"
summary: "A showcase-first sample wave that demonstrates the current 0.6.1 Wave surface."
---

# Sample Waves

This guide points to one showcase-first sample wave that demonstrates the current `0.6.1` authored Wave surface.

The example is intentionally denser than a typical production wave. Its job is to teach the current authoring and runtime surface quickly, not to be the smallest possible launch-ready file.

## Canonical Example

- [Full modern sample wave](../plans/examples/wave-example-live-proof.md)
  Shows the combined `0.6.1` authored surface in one file: closure roles, `E0`, optional security review, delegated and pinned benchmark targets, richer executor config, `### Skills`, `### Capabilities`, `### Deliverables`, `### Exit contract`, `### Proof artifacts`, sticky retry, deploy environments, and proof-first live-wave structure.

## What This Example Teaches

- the standard closure-role structure with `A0`, `E0`, `A8`, and `A9`
- wave-level `## Eval targets`
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

## Feature Coverage Map

This sample covers the main surfaces added or hardened for `0.6.1`:

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

## When To Copy Literally Vs Adapt

Copy more literally when:

- you need the section layout
- you want concrete wording for delegated versus pinned benchmark targets
- you want a proof-first owner example with local artifact bundles and sticky retry

Adapt more aggressively when:

- your repo has different role ids or role prompts
- your component promotions and maturity levels differ
- your runtime policy uses different executor profiles or runtime mix targets
- your deploy environments or provider skills differ from the example

## How This Example Maps To Other Docs

- Use [docs/guides/planner.md](../guides/planner.md) for the planner-generated baseline, then use this sample to see how a human would enrich the generated draft.
- Use [docs/evals/README.md](../evals/README.md) with this sample when you need to see delegated and pinned benchmark targets in a real wave.
- Use [docs/reference/live-proof-waves.md](./live-proof-waves.md) with this sample when you need proof-first authoring for `pilot-live` and above.
- Use [docs/plans/wave-orchestrator.md](../plans/wave-orchestrator.md) for the operational runbook that explains how the launcher interprets these sections.

## Suggested Reading Order

1. Start with [Full modern sample wave](../plans/examples/wave-example-live-proof.md).
2. Read [docs/evals/README.md](../evals/README.md) if you want more background on benchmark target selection.
3. Read [docs/reference/live-proof-waves.md](./live-proof-waves.md) if you want more detail on proof-first `pilot-live` authoring.

## Why This Example Lives In `docs/plans/examples/`

The example lives outside `docs/plans/waves/` on purpose.

That keeps it:

- easy to browse as teaching material
- clearly separate from the repo's real launcher-facing wave sequence
- safe to evolve as reference material without implying that it is part of the current lane's actual plan history
