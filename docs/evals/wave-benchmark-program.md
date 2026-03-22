---
title: "Wave Benchmark Program"
summary: "Locked benchmark spec for Wave-native coordination evaluations, baseline arms, scoring rules, and external benchmark positioning."
---

# Wave Benchmark Program

This document is the implementation-side contract for Wave benchmarking.

It complements:

- `docs/evals/benchmark-catalog.json` for benchmark vocabulary
- `docs/evals/cases/` for the deterministic local corpus
- `docs/evals/external-benchmarks.json` for external adapters and positioning
- `scripts/wave-orchestrator/benchmark.mjs` for execution and reporting

## First Public Claim

The first claim this benchmark program is designed to support is:

> Under equal executor assumptions, the full Wave orchestration surface improves distributed-state reconstruction, inbox targeting, routing quality, and premature-closure resistance relative to stripped-down baselines.

This is intentionally narrower than "Wave is better than all coding agents."

## Benchmark Arms

The benchmark runner supports these arms:

- `single-agent`
  One primary owner operates from a local view. No compiled shared summary, no targeted inboxes, no capability routing, and no explicit closure guard simulation.
- `multi-agent-minimal`
  Multiple agents exist, but they only share a minimal global summary. There is no targeted inbox routing and no benchmark-aware closure discipline.
- `full-wave`
  The current Wave projection and routing surfaces are used: canonical coordination state, compiled shared summary, targeted inboxes, request assignments, and closure-guard simulation.
- `full-wave-plus-improvement`
  Reserved for later benchmark-improvement loops after a baseline is established. The runner supports the arm id, but the initial local corpus focuses on the first three arms.

## Shipped Native Families

The first shipped deterministic corpus covers one case in each of the core coordination families:

- `hidden-profile-pooling`
- `silo-escape`
- `blackboard-fidelity`
- `contradiction-recovery`
- `simultaneous-coordination`
- `expertise-leverage`

It also includes a cross-cutting premature-closure guard case under `hidden-profile-pooling / premature-consensus-guard`.

## Scoring Rules

Each benchmark case defines:

- `familyId`
- `benchmarkId`
- `supportedArms`
- `fixture`
- `expectations`
- `scoring.kind`
- `scoring.primaryMetric`
- `scoring.thresholds`

The runner computes case-level metrics from deterministic coordination fixtures using current Wave machinery where possible:

- `compileSharedSummary()`
- `compileAgentInbox()`
- `buildRequestAssignments()`
- `openClarificationLinkedRequests()`

The primary metric determines case pass/fail. Directionality comes from the benchmark catalog, not from the case file.

## Significance And Comparative Reporting

Comparative reporting uses:

- mean score delta versus the `single-agent` baseline
- bootstrap confidence intervals over case deltas
- a confidence rule: only report a statistically confident win when the lower bound of the confidence interval is above zero

The initial implementation reports the practical delta directly and leaves final publication thresholds to operator judgment. The runner still records the per-case practical win threshold in the case definition so later work can harden claim logic without changing the corpus format.

## Corpus Design Rules

The local case corpus follows these constraints:

- deterministic and file-backed
- cheap enough to run in ordinary repo CI or local development
- focused on Wave-native surfaces, not generic model capability
- auditable by inspecting the case JSON, generated summaries, inboxes, and assignments
- extensible to live-run and trace-backed variants later

The first corpus deliberately exercises projection, routing, and closure logic before attempting expensive live multi-executor runs.

## External Benchmark Positioning

The external benchmark registry is split into two modes:

- `direct`
  The benchmark is treated as a runnable external suite with a command template or adapter recipe. The current direct target is `SWE-bench Pro`.
- `adapted`
  The benchmark is treated as a design reference whose failure mode should be mirrored with repo-local Wave cases. Current adapted targets are `SkillsBench`, `EvoClaw`, `HiddenBench`, `Silo-Bench`, and `DPBench`.

This keeps the first milestone honest:

- prove the Wave-specific substrate first
- then layer in broader external reality checks

## Current Direct Benchmark

The current direct external benchmark is:

- `SWE-bench Pro`

Why this benchmark now:

- it is contamination-resistant relative to older SWE-bench variants
- it has a public executable harness
- it exercises real repository bug-fix work without changing the Wave coordination claim into a generic terminal benchmark claim

The second direct benchmark slot is intentionally deferred until a later `CooperBench` pass.

The first direct comparison should compare only:

- `single-agent`
- `full-wave`

And both arms must keep the following fixed:

- model id
- executor id and command
- tool permissions
- temperature and reasoning settings
- wall-clock budget
- turn budget
- retry limit
- verification harness
- dataset version or task manifest

Execution should be driven through explicit command templates for the official benchmark harnesses rather than ad hoc shell invocation. The config shape lives at `docs/evals/external-command-config.sample.json`, and the local SWE-bench Pro harness is wired through `docs/evals/external-command-config.swe-bench-pro.json`.

## Review-Only External Subsets

After the canonical SWE-bench Pro pilot is frozen, narrower review batches may be derived for
diagnostic work such as a `full-wave`-only sweep.

Those runs are allowed only when they:

- derive from an already-frozen pilot manifest instead of re-sampling freely
- keep the review scope explicit in the manifest and report
- avoid presenting the result as a matched `single-agent` versus `full-wave` claim

Example:

- `docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json`
  is a 10-task diagnostic subset derived from the frozen 20-task SWE-bench Pro pilot.
  It is suitable for multi-agent review work before a later pairwise rerun, but it does
  not replace the canonical direct comparison.

## Output Contract

`wave benchmark run` writes results under `.tmp/wave-benchmarks/latest/` by default:

- `results.json`
- `results.md`

`wave benchmark external-run` writes the same pair in its selected output directory plus:

- `failure-review.json`
- `failure-review.md`

The failure review is the first artifact to inspect for review-only subsets because it
separates verifier invalidation, setup or harness failures, dry-run planning output, and
trustworthy patch-quality failures.

These artifacts are local and reproducible. They are not intended to be committed as run history.
