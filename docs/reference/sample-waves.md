---
title: "Sample Waves"
summary: "Showcase-first example waves that demonstrate the modern Wave surface after 0.5.4."
---

# Sample Waves

This guide points to a small set of showcase-first sample waves that demonstrate the modern Wave surface after `0.5.4`.

These examples are intentionally denser than a typical production wave. Their job is to teach the current authoring and runtime surface quickly, not to be the smallest possible launch-ready files.

## Example Set

- [Implementation and coordination sample](../plans/examples/wave-example-implementation.md)
  Shows the standard closure-role structure, executor profiles, cross-runtime skills, capabilities, deliverables, exit contracts, component ownership, and Context7 defaults.
- [cont-EVAL and benchmarking sample](../plans/examples/wave-example-eval.md)
  Shows `E0`, `## Eval targets`, delegated versus pinned benchmark selection, and the new coordination benchmark families.
- [Proof-first live-wave sample](../plans/examples/wave-example-live-proof.md)
  Shows `pilot-live` promotion, `### Proof artifacts`, sticky retry, operator command capture, deploy environments, and proof-centric closure expectations.

## What Each Example Teaches

| Example | Main focus | Best for learning |
| --- | --- | --- |
| `wave-example-implementation.md` | Modern baseline authored wave | executor blocks, skills, capabilities, deliverables, exit contracts, component promotions, closure roles |
| `wave-example-eval.md` | `cont-EVAL` and benchmark authoring | `E0`, `## Eval targets`, delegated vs pinned benchmarks, coordination benchmark families |
| `wave-example-live-proof.md` | Proof-first live validation | `### Proof artifacts`, sticky retry, operator evidence, deploy environments, infra/deploy verifier patterns |

## Feature Coverage Map

Together these samples cover the main surfaces added or hardened after `0.5.4`:

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
- your deploy environments or provider skills differ from the examples

## How These Samples Map To Other Docs

- Use [docs/guides/planner.md](../guides/planner.md) for the planner-generated baseline, then use these samples to see how a human would enrich the generated draft.
- Use [docs/evals/README.md](../evals/README.md) with the eval sample when you need to choose between delegated and pinned benchmark targets.
- Use [docs/reference/live-proof-waves.md](./live-proof-waves.md) with the live-proof sample when you need proof-first authoring for `pilot-live` and above.
- Use [docs/plans/wave-orchestrator.md](../plans/wave-orchestrator.md) for the operational runbook that explains how the launcher interprets these sections.

## Suggested Reading Order

1. Start with [Implementation and coordination sample](../plans/examples/wave-example-implementation.md).
2. Read [cont-EVAL and benchmarking sample](../plans/examples/wave-example-eval.md) next if the wave includes `E0`.
3. Read [Proof-first live-wave sample](../plans/examples/wave-example-live-proof.md) whenever the wave claims `pilot-live` or above.

## Why These Are In `docs/plans/examples/`

The examples live outside `docs/plans/waves/` on purpose.

That keeps them:

- easy to browse as teaching material
- clearly separate from the repo's real launcher-facing wave sequence
- safe to evolve as reference material without implying that they are part of the current lane's actual plan history
