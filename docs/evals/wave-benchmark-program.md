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
  One primary owner operates from a local view of records they authored. No inbound targeted coordination is compiled into that arm, and there is no compiled shared summary, no targeted inboxes, no capability routing, and no explicit closure guard simulation.
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

For reporting above the case level, the runner also computes a direction-aligned score:

- `higher-is-better` metrics keep their raw score
- `lower-is-better` metrics are flipped to `100 - rawScore`

That rule applies to:

- family `meanScore`
- overall and family `meanDelta`
- the `statisticallyConfident` comparison flag

This keeps a positive delta semantically stable: positive always means "better than baseline" even when a case's raw primary metric is lower-is-better.

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

## Native Benchmarking Mode

`wave benchmark run` is the native deterministic benchmarking mode.

This mode is intentionally narrow:

- it tests the Wave substrate, not generic model capability
- it holds the coordination fixture constant and varies only the arm behavior
- it uses current Wave machinery to compile summaries, inboxes, assignments, and closure guards
- it is cheap and reproducible enough to run in local development and CI

What it is meant to prove:

- the blackboard projections preserve decision-changing state
- targeted inboxes reduce silos instead of creating them
- capability routing sends the right work to the right owner
- contradiction handling becomes explicit repair work
- closure guards resist premature PASS

What it does not prove by itself:

- raw coding ability on live repos
- leaderboard-ready external benchmark performance
- runtime-specific agent behavior under real tool pressure

That separation is intentional. Native mode is the first honest proof layer for a MAS tool whose core claim is about shared state, routing, synthesis, and closure discipline.

## Native Metric Contract

For each case and arm, the native runner records:

- `score`
  The case's primary metric value.
- `alignedScore`
  The direction-aligned case score used for family summaries and deltas.
- `passed`
  Whether the primary metric satisfied the case threshold.
- `direction`
  Whether the metric is `higher-is-better` or `lower-is-better`.
- `threshold`
  The configured case threshold for the primary metric.
- `metrics`
  The full metric map computed from the deterministic fixture.
- `details`
  Supporting breakdowns such as matched global facts, summary facts, targeted inbox recall, assignment precision, distinct assigned agents, and whether the blocking guard tripped.
- `artifacts`
  The generated `sharedSummary`, `inboxes`, `assignments`, and `blockingGuard` state used to score the arm.

The runner also records:

- `familySummary`
  Direction-aligned mean score and pass rate per family and arm.
- `comparisons`
  Direction-aligned mean delta versus `single-agent`, bootstrap confidence intervals, and a conservative `statisticallyConfident` flag.

When `waveControl` reporting is enabled, native runs also publish:

- `benchmark_run`
  Suite-level metadata, selected arms, family summary, and comparison summary.
- `benchmark_item`
  Full per-case, per-arm payloads including `score`, `alignedScore`, `passed`, `metrics`, `details`, and generated artifacts.

Native mode does **not** emit `verification` or `review` events, because there is no external verifier and no benchmark-validity split to interpret. Those are reserved for `wave benchmark external-run`.

## Native Metric Set

The current deterministic runner logs the following metrics:

| Metric | Native signal used today | Why it matters for the MAS claim |
| --- | --- | --- |
| `distributed-info-accuracy` | Percent of expected global facts visible in the integration-visible state: shared summary, integration-owner view when present, and structured assignment artifacts | Proves the team pooled distributed evidence rather than leaving it siloed |
| `latent-asymmetry-surfacing-rate` | Clarification recall by explicit record id when a case expects missing-fact surfacing, otherwise targeted inbox recall | Proves the system notices that important evidence is still missing before closure |
| `premature-convergence-rate` | `100` when a case required a blocking guard and the arm failed to keep it active, else `0` | Proves whether closure discipline resists converging on incomplete state |
| `global-state-reconstruction-rate` | Percent of required cross-agent facts reconstructed in the integration-visible state rather than only in owner-private inboxes | Proves communication turned into a correct shared picture, not only message traffic |
| `summary-fact-retention-rate` | Percent of required summary facts preserved in the shared summary | Proves summary compression is trustworthy enough to support downstream synthesis |
| `communication-reasoning-gap` | `100 - global-state-reconstruction-rate` | Makes failure explicit when agents talk but still fail to integrate correctly |
| `projection-consistency-rate` | Same summary-fidelity signal, framed for projection integrity | Proves the blackboard projections remain semantically aligned with canonical state |
| `targeted-inbox-recall` | Percent of expected owner-specific facts present in the right inboxes | Proves targeted context actually reaches the agents who own the work |
| `integration-coherence-rate` | Global-fact recall used as a proxy for integration fidelity in the deterministic corpus | Proves the synthesis layer reflects the underlying coordination state |
| `contradiction-detection-rate` | Targeted-fact recall on contradiction-oriented fixtures | Proves conflicting claims become visible instead of being smoothed away |
| `repair-closure-rate` | Assignment precision for required repair or follow-up work | Proves contradictions and blockers turn into owner-bound resolution work |
| `false-consensus-rate` | `100` when a contradiction/premature-close guard should have held and did not, else `0` | Proves whether the system is narrating consensus where the state is still unresolved |
| `deadlock-rate` | `100` when the arm failed to reach the required number of distinct owners in simultaneous-coordination cases, else `0` | Proves whether the team collapses under concurrent coordination pressure |
| `contention-resolution-rate` | Assignment precision in concurrent blocker cases | Proves simultaneous work can resolve rather than stall |
| `symmetry-breaking-rate` | Percent of the required distinct owners/choices achieved | Proves the team can break lockstep and avoid same-plan collapse |
| `expert-preservation-rate` | Targeted-fact recall used on expert-preservation fixtures | Proves the strongest specialist signal survives into the visible decision path |
| `capability-routing-precision` | Correct assignment rate for capability-routed requests | Proves the routing layer is steering work to the intended owner |
| `expert-performance-gap` | `100 - expert-preservation-rate` | Makes expert-signal dilution explicit as a failure measure rather than an anecdote |

Several of these metrics intentionally reuse the same deterministic signals under different benchmark families. That is not accidental. The goal is not to create an unnecessarily large metric vocabulary; it is to ask the same core question from multiple MAS failure angles:

- did the right facts reach shared state
- did the right owners receive the right context
- did conflicts become explicit repair work
- did closure wait for integrated proof

The important constraint is that "shared state" here does **not** mean "the union of every owner inbox." The native runner scores global reconstruction from the integration-visible artifacts, so facts that remain split across private owner views do not count as reconstructed.

## Why These Metrics Matter

The first public claim is not "Wave is a better model." It is that Wave is a better multi-agent coordination substrate.

That means the most valuable native metrics are the ones that expose the failure cases from the README:

- distributed-evidence metrics matter because a MAS that cannot pool private facts has no credible shared-state claim
- summary and inbox metrics matter because a blackboard is only useful if the projections stay faithful and owner-relevant
- routing metrics matter because specialist structure only helps if work actually lands on the right owner
- contradiction and repair metrics matter because visible disagreement without repair is still coordination failure
- premature-closure metrics matter because a MAS that can always narrate PASS is not proving anything
- simultaneous-coordination metrics matter because many systems look fine in serial but collapse under concurrent blockers

In other words, these metrics matter because they test the *coordination mechanism itself*, which is the actual product claim of Wave.

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
