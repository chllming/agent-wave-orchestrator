---
title: "External Benchmark Pilots"
summary: "Frozen pilot manifests for the first honest direct benchmark runs."
---

# External Benchmark Pilots

These manifests freeze the first-run task selections for direct external benchmarks.

They exist to prevent:

- ad hoc task picking
- silent pilot drift between runs
- unfair re-sampling after seeing results

The current frozen direct pilot is:

- `SWE-bench Pro`

Each manifest records:

- benchmark id
- split assumptions
- sample strategy
- exact task ids
- task-level metadata needed for later aggregation

These manifests are benchmark inputs, not run history.

If a smaller or narrower batch is needed after the canonical pilot is frozen, create a
new derivative manifest rather than editing the original file in place.

Derivative manifests must:

- name the parent frozen manifest they were derived from
- explain the deterministic subset rule they use
- state whether they are review-only or comparison-ready

Example:

- `docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json`
  is a review-only 10-task subset derived from the frozen 20-task SWE-bench Pro public pilot.
  It exists for a multi-agent diagnostic sweep and does not replace the canonical
  single-agent versus full-wave comparison.

When a derivative review batch is run, inspect the generated `failure-review.md` before
treating any aggregate score as capability evidence.
