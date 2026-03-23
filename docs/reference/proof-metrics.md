---
title: "Proof Metrics"
summary: "How Wave maps README multi-agent failure modes to concrete runtime telemetry and benchmark evidence."
---

# Proof Metrics

This document turns the README failure cases into concrete proof obligations.

Wave does not treat these as narrative quality goals. The point of native telemetry is to gather enough durable evidence that we can answer:

- did the runtime behave as intended
- which proof signals back that claim
- where the system still fails or only partially proves the claim

For the event and artifact contract, see [wave-control.md](./wave-control.md).

## Signal Map

| Failure case | Native telemetry to inspect | Benchmark evidence to inspect | What success should look like |
| --- | --- | --- | --- |
| `Cosmetic board, no canonical state` | `coordination_record`, `wave_run`, `attempt`, `artifact`, trace bundle metadata, control-plane raw log | `benchmark_run` attestation plus linked trace metadata for `full-wave` arms | The board, shared summary, and dashboards are projections over a durable JSONL/event trail, not the only record |
| `Hidden evidence never gets pooled` | evidence refs in `coordination_record`, proof-bundle artifacts, integration summary artifacts, closure timeline | `benchmark_item` review validity plus linked proof/verification artifacts | Decision-changing evidence can be traced from the owner agent into shared summary, integration, and final closure |
| `Communication without global-state reconstruction` | `gate` snapshots, integration summary artifacts, contradiction-repair traces, attempt timeline | distributed-reasoning benchmark items and validity buckets | Shared state converges on the correct integrated recommendation rather than only showing message traffic |
| `Simultaneous coordination collapse` | coordination backlog counts, open blockers, request/ack timing from task snapshots, dependency and helper-assignment barriers | `benchmark_item` wall clock, timeout reviews, harness-vs-model validity split | Multiple active blockers and cross-owner dependencies stay visible and closure is blocked until they resolve |
| `Expert signal gets averaged away` | targeted routing in assignments, `coordination_record.targets`, final owner on accepted recommendation, reroute history | task-level arm telemetry and benchmark outcome grouped by routing-heavy tasks | The accepted recommendation still comes from the appropriate owner or shows an explicit override reason |
| `Contradictions get smoothed over` | `gate` artifacts, contradiction-related coordination records, proof bundle supersession chain, retry/rerun control events | `review` validity and contradiction-oriented benchmark families | Material conflicts remain explicit and either produce repair work or block PASS |
| `Premature closure` | `gate` transitions, `proof_bundle`, `attempt`, `review`, final `wave_run` state, trace `outcome.json` | `review` validity buckets like `proof-blocked`, `benchmark-invalid`, and `trustworthy-model-failure` | PASS only appears after proof completeness, integration, and closure stewardship agree; reopen/rerun remains visible when PASS was premature |

## Native Benchmark Metrics As Proof

`wave benchmark run` is the native proof surface for the coordination substrate. It matters because it lets us evaluate the Wave mechanics directly before live-model noise, runtime variance, or external harness issues enter the picture.

The native metric groups line up with the README claims:

- evidence pooling:
  `distributed-info-accuracy`, `global-state-reconstruction-rate`, and `communication-reasoning-gap` tell us whether distributed facts became one correct integration-visible state instead of remaining split across private owner views
- projection fidelity:
  `summary-fact-retention-rate`, `projection-consistency-rate`, `targeted-inbox-recall`, and `integration-coherence-rate` tell us whether the blackboard projections stayed faithful enough to be useful
- routing quality:
  `capability-routing-precision`, `expert-preservation-rate`, and `expert-performance-gap` tell us whether specialization survives routing and synthesis
- contradiction handling:
  `contradiction-detection-rate`, `repair-closure-rate`, and `false-consensus-rate` tell us whether conflicts become explicit repair work instead of narrative consensus
- closure discipline:
  `latent-asymmetry-surfacing-rate` and `premature-convergence-rate` tell us whether the system notices missing evidence and keeps closure blocked until it is integrated
- simultaneous coordination:
  `deadlock-rate`, `contention-resolution-rate`, and `symmetry-breaking-rate` tell us whether the team can coordinate under concurrent blockers rather than collapsing into lockstep failure

These metrics matter because Wave's core promise is not just "many agents talked." The promise is that the system reconstructs shared state, routes work intelligently, preserves important evidence through projections, and refuses to close while critical uncertainty remains.

The deterministic runner is strict about that distinction:

- global reconstruction is scored from integration-visible artifacts, not the union of every inbox
- clarification surfacing is scored from explicit record ids, so a metric only moves when the missing-evidence record is actually preserved in the generated artifacts
- family summaries and deltas are direction-aligned, so lower-is-better guard metrics do not invert the headline comparison

## Native Views To Build Around

The minimum useful derived views are:

- closure fidelity:
  track gate transitions, proof completeness, blocked reasons, and any rerun after a would-be PASS
- evidence pooling:
  track whether integration and closure cite the proof artifacts and evidence refs that mattered
- contradiction handling:
  track open conflicts, superseded proof bundles, repair work, and unresolved contradiction count at finish
- coordination pressure:
  track open tasks, human escalations, stale clarifications, assignment lag, and dependency barriers
- benchmark trust:
  keep verifier/setup invalidation separate from real capability failure

## Recommended Success Criteria

For a run to count as evidence that Wave is working as intended, prefer all of the following:

1. The run has a durable `wave_run` plus `attempt` timeline.
2. The trace bundle contains `run-metadata.json`, `quality.json`, and `outcome.json`.
3. Closure evidence is visible through `gate` and `proof_bundle` events rather than only markdown text.
4. If the run includes a benchmark, the result has explicit `benchmark_run`, `benchmark_item`, `verification`, and `review` records.
5. Invalid or unpublishable benchmark outcomes are still retained, but labeled as such.

## Current Limits

Current telemetry proves more than the old file-by-file reporting, but it is not yet perfect:

- v1 tracks evidence refs and artifact lineage at the event/artifact level, not stable fact ids
- expert-routing proof currently comes from assignment/reroute ownership and accepted final owner, not a dedicated expert-override schema
- contradiction evidence is visible through gate state, review disposition, and coordination records, but not yet as a standalone normalized contradiction entity

Those gaps should be treated as visibility work, not as permission to fall back to narrative-only conclusions.
