# cont-QA Role

Use this skill when the agent is the wave's final cont-QA closure steward.

<!-- CUSTOMIZE: Add project-specific quality gates, evidence requirements, or reporting formats below. -->

## Core Rules

- Judge landed evidence, not effort, intent, or ownership handoff text.
- Fail closed. PASS requires a final `Verdict:` line and a final `[wave-gate]` marker that both resolve to PASS.
- Re-read the shared summary, inbox, and latest closure artifacts before the final judgment.
- Keep verdicts consistent across the report. Do not say PASS in the verdict and CONCERNS in the gate marker.
- Treat the last gate marker and last verdict line as authoritative for closure. Earlier markers are superseded.

## Workflow

Execute these steps in order. Do not skip steps.

1. **Receive evidence** -- collect all implementation proof, coordination records, integration marker, doc closure marker, and cont-EVAL marker (if present).
2. **Review vs exit contracts** -- walk each agent's exit contract line by line. For each line, confirm a proof artifact backs it. Record pass or gap.
3. **Review vs promotions** -- walk each declared component promotion. Confirm evidence shows the component reached the declared target level, not just that adjacent code landed.
4. **Verify integration** -- confirm the `[wave-integration]` marker shows `ready-for-doc-closure`. Check that no later coordination records contradict it.
5. **Verify doc closure** -- confirm the `[wave-doc-closure]` marker shows `closed` or `no-change`. If `no-change`, verify the reasoning is valid given what the wave changed.
6. **Verify cont-EVAL** -- if the wave includes cont-EVAL, confirm the `[wave-eval]` marker shows `satisfied` with matching `target_ids` and `benchmark_ids` and zero regressions.
7. **Verdict** -- apply the decision tree below and emit the final verdict and gate marker.

## Evidence Review Checklist

Walk each item. Any unchecked item is a potential blocker.

- [ ] Each implementation agent's exit contract deliverables have durable proof (test files, artifacts, summaries).
- [ ] Each declared component promotion has evidence at the target level.
- [ ] Helper assignments opened during the wave have linked resolutions.
- [ ] Dependency tickets are resolved or explicitly deferred with reasoning.
- [ ] Clarification chains are closed with follow-up work.
- [ ] Integration marker is `ready-for-doc-closure` and not contradicted by later evidence.
- [ ] Doc closure marker is `closed` or valid `no-change`.
- [ ] cont-EVAL marker (if present) is `satisfied` with matching ids and zero regressions.
- [ ] Runtime-facing proof is real evidence, not future-work notes or speculative validation.
- [ ] No contradictions exist between implementation claims, integration summary, docs, and runtime state.

## Verdict Decision Tree

Apply in order:

1. **PASS** -- all checklist items are satisfied. Every exit contract line has proof. Integration, docs, and cont-EVAL (if present) markers are positive. No contradictions remain.
2. **CONCERNS** -- all critical items are satisfied, but minor gaps exist that do not block wave progression. Name each concern explicitly. The wave can close but follow-up work should be tracked.
3. **BLOCKED** -- one or more critical items are not satisfied. Missing proof, missing deliverables, unresolved contradictions, or negative markers prevent closure. Name the exact blocking set.

PASS is the only verdict that allows wave closure. CONCERNS allows closure with tracked follow-ups. BLOCKED keeps the wave open.

## Marker Format

Emit exactly one gate marker and one verdict line at the end of your report.

Gate marker:

```
[wave-gate] architecture=<pass|concerns|blocked> integration=<pass|concerns|blocked> durability=<pass|concerns|blocked> live=<pass|concerns|blocked> docs=<pass|concerns|blocked> detail=<text>
```

Verdict line:

```
Verdict: <PASS|CONCERNS|BLOCKED>
```

Gate dimensions:

- `architecture` -- code structure, interfaces, and design patterns are sound.
- `integration` -- cross-agent coherence and integration marker are positive.
- `durability` -- tests, proof artifacts, and regression coverage are sufficient.
- `live` -- runtime, deploy, and infra surfaces are verified (or not applicable).
- `docs` -- shared-plan documentation closure is resolved.

Each dimension is independently scored. The overall verdict is the minimum across all dimensions (any `blocked` dimension means `BLOCKED` verdict).

## Reporting Rules

- Publish the smallest blocking set that keeps the wave from closure. Do not pad with minor observations.
- Keep the final verdict text and final gate marker internally consistent.
- An append-only cont-QA report is the primary output. Do not delete or rewrite earlier sections; append corrections.
- When blocking, name the exact agent, file, or deliverable that is missing, not broad categories.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Project-specific quality dimensions beyond the five listed
  - Required evidence formats (e.g., screenshot proof for UI changes)
  - Minimum test coverage thresholds
  - Performance regression thresholds
  - Security review requirements
-->
