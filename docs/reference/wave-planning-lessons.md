---
summary: "Lessons from Waves 4-9 on what makes future waves succeed or fail."
read_when:
  - Drafting a new wave
  - Splitting or renumbering future waves
  - Deciding whether a wave should target repo-landed, pilot-live, or above
title: "Wave Planning Lessons"
---

# Wave Planning Lessons

This document captures the practical lessons from Waves 4-9. The main theme is
simple: waves succeed when the declared maturity target, the owned slices, the
runtime setup, and the closure artifacts all describe the same truth.

## 1. One honest maturity jump per wave

- Treat `repo-landed`, `pilot-live`, `qa-proved`, `fleet-ready`,
  `cutover-ready`, and `deprecation-ready` as materially different bars.
- A wave should promote a component by one honest maturity step, not silently
  combine multiple levels of proof in one broad plan.
- If a wave only lands code and tests, the target is usually `repo-landed`, not
  `pilot-live`.
- If a wave claims `pilot-live` or above, the wave must own real deploy/live
  proof and rollback evidence.

## 2. Live-proof waves are a different class of wave

- `pilot-live` and above need an explicit live-proof owner, not just
  implementation agents plus A8/A9/A0.
- Live-proof waves need a canonical proof bundle under `.tmp/` and one owned
  operations runbook under `docs/plans/operations/`.
- The proof bundle must contain restart or rollback evidence, not only one-shot
  success.
- External operator commands and captured evidence must be part of the authored
  wave, not improvised during execution.

## 3. Component promotions must map to owned slices

- Every promoted component needs one or more implementation owners and one
  shared proof story.
- If multiple agents contribute to one promoted component, their slices must be
  obviously complementary, not overlapping guesses.
- Shared components should not cause one agent to be retried just because a
  sibling owner is still finishing; each agent must be able to complete its own
  slice honestly.

## 4. Deliverables must be explicit and machine-checkable

- Every implementation agent should declare `### Deliverables`.
- For live-proof waves, use `### Proof artifacts` in addition to deliverables.
- Deliverables should be exact files or artifact manifests, not vague “test
  coverage” or “docs updated” expectations.
- Missing deliverables should fail the wave even if the code mostly landed.

## 5. Closure must update the shared planning truth

- A9 should always update `current-state`, `master-plan`, `migration`, and the
  component cutover matrix when a wave changes what later waves may safely
  assume.
- The evaluator should reject a wave if the repo’s planning truth still implies
  an older maturity level after the code has landed.
- Shared-plan closure is not paperwork; it is part of architecture truth.

## 6. Use A8 to reconcile reality before docs and evaluation

- A8 is the place to detect contradictions between slices, missing ownership,
  and proof gaps before A9 and A0 run.
- A8 should judge `ready-for-doc-closure` versus `needs-more-work` based on the
  landed artifact set, not on agent intent.
- Waves were materially more reliable once A8 became a true closure gate rather
  than optional synthesis.

## 7. Runtime setup matters as much as wave prose

- Do not use small fixed turn caps for synthesis-heavy or closure-heavy agents.
  Bound them with `budget.minutes`, not `budget.turns`.
- Pin exact model and reasoning settings for each runtime. Ambiguous profiles
  create unclear failure modes.
- Avoid cross-runtime fallback on live-proof or deploy-sensitive slices unless
  there is a very good reason.
- Context7 should be explicit and real; unresolved bundles create noise instead
  of help.

## 8. Repo-local proof and live proof are different

- Repo-local tests and docs can justify `repo-landed`.
- Live host validation, admitted runtime behavior, rollback drills, and operator
  surfaces are what justify `pilot-live` and above.
- Do not let “the code exists” be treated as “the deployment works.”

## 9. Architecture-facing status surfaces must be future-safe

- Status and projection code should be keyed to the real future topology, not
  the smallest test case that passes today.
- If a status model will later carry multiple runtime classes, providers, or
  lanes, the substrate must preserve that identity now.
- Closed enums and typed contracts should be validated as closed enums and typed
  contracts, not accepted as arbitrary strings.

## 10. The best waves are narrow, layered, and boring

- Narrow waves close more reliably than broad waves.
- A good wave answers:
  - what exact maturity level is being claimed
  - what exact artifacts prove it
  - who owns repo implementation
  - who owns live proof, if any
  - what A9 must update
  - what A0 must refuse to overclaim
- If a wave still sounds ambitious and fuzzy after writing the deliverables,
  split it again.

## 11. Future-wave checklist

- Does the component promotion match the real maturity level being claimed?
- Does every promoted component have an implementation owner?
- If the target is `pilot-live` or above, is there an explicit live-proof owner?
- Are deliverables and proof artifacts exact and machine-checkable?
- Are current-state and matrix updates part of A9 closure?
- Are A8 and A0 told what would make the wave fail honestly?
- Are runtime pins, Context7 bundles, and budgets specific enough to avoid
  preventable execution failures?
- Would a reviewer understand the difference between “code landed” and
  “component promoted” just by reading the wave file?

## Bottom line

The successful waves were not the ones with the most code. They were the ones
where the wave file, the runtime setup, the artifacts, and the planning docs all
made the same claim at the same level of maturity.
