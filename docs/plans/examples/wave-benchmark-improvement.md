# Wave 99 - Benchmark Improvement Loop

This example shows how to author a Wave whose job is to improve benchmark outcomes after a baseline already exists.

## Eval targets

- id: hidden-profile-pooling | selection: pinned | benchmarks: private-evidence-integration,premature-consensus-guard | objective: Improve distributed evidence pooling without allowing premature closure | threshold: Full-wave benchmark scores improve without regressing closure discipline
- id: routing-quality | selection: pinned | benchmarks: expert-routing-preservation,lockstep-resolution | objective: Improve capability routing and simultaneous coordination | threshold: Routing benchmarks improve and no new deadlock-like regressions appear

## Agent A0: cont-QA

### Prompt

```text
Primary goal:
- Block any claimed improvement that is not backed by rerun benchmark output.

Specific expectations:
- require benchmark reruns after each material change
- do not PASS on inspection-only claims
- treat benchmark regressions as blocking until they are resolved or explicitly accepted

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-99-cont-qa.md
```

## Agent E0: cont-EVAL

### Prompt

```text
Primary goal:
- Run the benchmark loop, identify the narrowest failing coordination surfaces, and keep benchmark ids explicit in every iteration.

Specific expectations:
- choose the smallest benchmark subset that still proves the claimed improvement
- record baseline, current score, regressions, and exact benchmark ids
- stay report-only unless this wave explicitly grants implementation ownership

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-99-cont-eval.md
```

## Agent A8: Integration Steward

### Prompt

```text
Primary goal:
- Synthesize benchmark evidence, implementation deltas, and regression risk into one integrated recommendation.

Specific expectations:
- call out any contradiction between benchmark wins and runtime or docs regressions
- prefer explicit follow-up requests over vague risk notes

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-99.md
```

## Agent A1: Coordination Store Hardening

### Deliverables

- scripts/wave-orchestrator/coordination-store.mjs
- test/wave-orchestrator/coordination-store.test.ts

### Prompt

```text
Primary goal:
- Improve targeted inbox recall or summary fidelity for the benchmark cases that E0 reports as failing.

Specific expectations:
- keep changes tightly scoped to the failing benchmark signals
- add regression coverage for any changed behavior
- coordinate doc-impact with A9 if the benchmark semantics or operator surfaces change

File ownership (only touch these paths):
- scripts/wave-orchestrator/coordination-store.mjs
- test/wave-orchestrator/coordination-store.test.ts
```

## Agent A2: Routing And Closure Hardening

### Deliverables

- scripts/wave-orchestrator/routing-state.mjs
- scripts/wave-orchestrator/benchmark.mjs
- test/wave-orchestrator/routing-state.test.ts
- test/wave-orchestrator/benchmark.test.ts

### Prompt

```text
Primary goal:
- Improve routing or closure benchmark outcomes without weakening evidence requirements.

Specific expectations:
- preserve deterministic benchmark behavior
- prefer narrow routing and guard changes over broad orchestration rewrites
- rerun the affected benchmark cases after each material change

File ownership (only touch these paths):
- scripts/wave-orchestrator/routing-state.mjs
- scripts/wave-orchestrator/benchmark.mjs
- test/wave-orchestrator/routing-state.test.ts
- test/wave-orchestrator/benchmark.test.ts
```
