---
title: "Benchmark Catalog Guide"
summary: "How to use delegated benchmark families, pinned benchmarks, and coordination-oriented eval targets in Wave."
---

# Benchmark Catalog Guide

Wave's benchmark catalog lives in `docs/evals/benchmark-catalog.json`.

The executable local case corpus lives in `docs/evals/cases/`, and the benchmark runner is available through `wave benchmark`.
Frozen external pilot manifests live in `docs/evals/pilots/`, and external comparison arm templates live in `docs/evals/arm-templates/`.
An example command-template config shape lives in `docs/evals/external-command-config.sample.json`.
A runnable SWE-bench Pro config for the local task harness lives in `docs/evals/external-command-config.swe-bench-pro.json`.

It has two jobs:

- give `cont-EVAL` a repo-governed menu of allowed benchmark families and benchmark ids
- document what each benchmark is trying to catch, including coordination failure modes and static paper baselines
- optionally point from benchmark ids to repo-local deterministic benchmark cases through `localCases`

The catalog is reference metadata, not a run-history database. It tells the wave author and `cont-EVAL` what kinds of checks are allowed and what external benchmark or paper baseline those checks map to.

The local case corpus is the executable side of that metadata. It gives the repo a deterministic way to score the current Wave substrate on summary fidelity, targeted inbox recall, capability routing, contradiction handling, and closure guards before moving on to costlier live suites.

For a full authored wave example that uses these patterns, see [docs/reference/sample-waves.md](../reference/sample-waves.md).

These benchmark families are also Wave's operator-facing vocabulary for common MAS failure modes. For the research-side framing and the current architectural gaps, see [docs/research/coordination-failure-review.md](../research/coordination-failure-review.md).

## Migrating From Legacy Evaluator Waves

If your `0.5.4`-era repo still talks about a single `evaluator` role, split that surface before adopting `0.6.1`:

- keep `A0` as `cont-QA` for the final closure verdict and `[wave-gate]`
- add `E0` only when the wave needs benchmark-driven tuning or service-output evaluation
- treat `cont-EVAL` as report-only unless the wave explicitly gives `E0` owned implementation files
- keep `## Eval targets` at the wave level so `cont-EVAL` has an exact contract to satisfy

`cont-EVAL` is not a rename of `cont-QA`. In `0.6.1`, `E0` proves the eval contract before integration, while `A0` still owns the final release verdict after documentation closure.

## When To Use Delegated Vs Pinned Targets

Use `selection: delegated` when the wave should authorize a benchmark family and let `cont-EVAL` choose the exact benchmark set inside that family.

Use `selection: pinned` when the wave must require specific benchmark ids and does not want `cont-EVAL` to choose alternates.

In practice:

- `delegated` is better when you want flexibility inside a stable area such as `hidden-profile-pooling` or `latency`
- `pinned` is better when you need an exact smoke gate such as `cold-start-smoke` or `private-evidence-integration`

## Example Eval Targets

Delegated family target:

```md
## Eval targets

- id: coordination-pooling | selection: delegated | benchmark-family: hidden-profile-pooling | objective: Pool distributed private evidence before closure | threshold: Critical decision-changing facts appear in the final integrated answer before PASS
```

Pinned benchmark target:

```md
## Eval targets

- id: contradiction-recovery-guard | selection: pinned | benchmarks: claim-conflict-detection,evidence-based-repair | objective: Detect and repair conflicting claims before closure | threshold: Material contradictions become explicit follow-up work and resolve before final pass
```

Mixed target set:

```md
## Eval targets

- id: coordination-pooling | selection: delegated | benchmark-family: hidden-profile-pooling | objective: Pool distributed private evidence before closure | threshold: Critical decision-changing facts appear in the final integrated answer before PASS
- id: summary-integrity | selection: pinned | benchmarks: shared-summary-fact-retention | objective: Preserve decision-changing facts through summary compression | threshold: Shared summaries retain the facts needed for the final recommendation
```

## Coordination Families

The coordination-oriented families currently included in the catalog are:

- `hidden-profile-pooling`
  Use when the main risk is that agents fail to surface or integrate distributed private evidence. This maps most directly to HiddenBench.
- `silo-escape`
  Use when the risk is that agents communicate but still fail to reconstruct the correct global state. This maps most directly to Silo-Bench.
- `simultaneous-coordination`
  Use when the risk is contention, lockstep failure, or convergent reasoning under concurrent decisions. This maps most directly to DPBench.
- `expertise-leverage`
  Use when the risk is expert underuse, bad routing, or low-quality compromise across mixed-skill agents. This maps most directly to `Multi-Agent Teams Hold Experts Back`.
- `blackboard-fidelity`
  Use when the risk is information loss or distortion between the raw coordination log and derived artifacts like shared summaries, inboxes, ledger state, or integration summaries.
- `contradiction-recovery`
  Use when the risk is false consensus, unresolved conflicting claims, or clarification chains that appear resolved without real repair.

## Local Case Corpus

The repo now ships deterministic local benchmark cases under `docs/evals/cases/`.

Each case:

- binds to one benchmark family and benchmark id
- defines a coordination fixture plus expected facts, inboxes, assignments, or closure guards
- is executable through `wave benchmark run`

Useful commands:

```bash
pnpm exec wave benchmark list
pnpm exec wave benchmark show --case wave-hidden-profile-private-evidence --json
pnpm exec wave benchmark run --json
```

The default output path is `.tmp/wave-benchmarks/latest/`.

These case runs are local benchmark artifacts, not committed run history.

## External Benchmark Workflow

The current direct external benchmark path starts with `SWE-bench Pro`.

Why:

- it keeps the first direct benchmark grounded in real repository bug-fix work
- it has a public harness and official verifier path
- it lets Wave compare `single-agent` and `full-wave` arms under matched settings

The second direct benchmark slot is intentionally deferred until a later CooperBench-oriented pass.

The frozen direct pilot is:

- `docs/evals/pilots/swe-bench-pro-public-pilot.json`

There is also a review-only diagnostic subset:

- `docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json`

Useful commands:

```bash
pnpm exec wave benchmark external-list
pnpm exec wave benchmark external-show --adapter swe-bench-pro --json
pnpm exec wave benchmark external-pilots --json
pnpm exec wave benchmark external-run --adapter swe-bench-pro --command-config docs/evals/external-command-config.swe-bench-pro.json --dry-run --json
pnpm exec wave benchmark external-run --adapter swe-bench-pro --manifest docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json --arm full-wave --command-config docs/evals/external-command-config.swe-bench-pro.json --json
```

For the first honest comparison:

- compare only `single-agent` and `full-wave`
- do not change model, executor, or budget assumptions between those two arms
- treat review-only subsets as diagnostic material, not as canonical pairwise comparison evidence

Each `wave benchmark external-run` output directory now includes:

- `results.json`
- `results.md`
- `failure-review.json`
- `failure-review.md`

Start with `failure-review.md` when a review-only batch returns many failures. It splits
verifier-image issues, setup or harness failures, trustworthy patch failures, and dry-run
planning-only output so the batch is easier to interpret.

## How To Choose The Right Family

Choose the family based on the failure you are most worried about, not just on the surface area being changed.

Use:

- `hidden-profile-pooling` when the hard part is discovering missing facts
- `silo-escape` when the hard part is integrating already-shared facts into one correct state
- `simultaneous-coordination` when multiple owners or resources must move together
- `expertise-leverage` when the right answer depends on preserving the best expert signal
- `blackboard-fidelity` when summaries, inboxes, or integration artifacts may be dropping important evidence
- `contradiction-recovery` when you expect conflicting claims and need the framework to turn them into bounded repair work

## How `cont-EVAL` Should Use The Catalog

When a wave delegates benchmark selection:

1. Read the wave's `## Eval targets`.
2. Resolve the allowed benchmark family from the catalog.
3. Choose the smallest benchmark set that genuinely tests the target's failure mode.
4. Record the exact selected benchmark ids in the `cont-EVAL` report.
5. Emit the final `[wave-eval]` marker with the exact executed `benchmark_ids`.

When a wave pins benchmarks:

1. Run the named benchmark ids directly.
2. Do not silently swap to nearby checks.
3. Treat missing or unrun pinned benchmarks as an unsatisfied target.

## How To Read The Static Baselines

Some coordination families now include static paper baselines such as HiddenBench, Silo-Bench, DPBench, and `Multi-Agent Teams Hold Experts Back`.

These baselines are:

- reference points from papers
- useful for framing whether Wave is still far from the broader state of the art
- not the same thing as local run history

They should answer:

- what failure mode this benchmark family is grounded in
- what the paper reported
- what metric the paper used

They should not be treated as:

- a promise that Wave already matches the paper's best system
- a local regression history
- a substitute for actually running evals

## Authoring Guidance

Prefer one eval target per distinct risk.

Good:

- one target for distributed-information pooling
- one target for contradiction recovery
- one target for latency guardrails

Avoid:

- one overloaded target that mixes every coordination risk into a single vague threshold

Prefer delegated targets early when the family is stable but the exact check should remain flexible.

Prefer pinned targets when:

- the wave is release-sensitive
- the benchmark is small and repeatable
- you need a precise regression gate

## Current Limits

The benchmark catalog does not yet store:

- local benchmark run history
- local-vs-paper delta computation
- a second direct benchmark beyond the current SWE-bench Pro path

For now it is the schema and policy layer that keeps eval authoring, `cont-EVAL`, and coordination benchmarking aligned.
