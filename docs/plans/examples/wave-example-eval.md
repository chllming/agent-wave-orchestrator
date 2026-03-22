# Wave 13 - Example cont-EVAL And Benchmarking

This is a showcase-first sample wave.

Use it to learn:

- how `E0` fits before integration, documentation, and cont-QA closure
- how to write `## Eval targets`
- when to use delegated benchmark families vs pinned benchmark ids
- how coordination-oriented benchmark families can sit beside service or output tuning

This example keeps `E0` report-only on purpose so the benchmark/eval structure is easy to read.

**Commit message**: `Docs: add cont-EVAL and benchmark sample wave`

## Component promotions

- closure-sweep-and-role-gates: qa-proved

## Eval targets

- id: coordination-pooling | selection: delegated | benchmark-family: hidden-profile-pooling | objective: Pool distributed private evidence before closure | threshold: Critical decision-changing facts appear in the final integrated answer before PASS
- id: contradiction-recovery | selection: pinned | benchmarks: claim-conflict-detection,evidence-based-repair | objective: Surface and repair conflicting claims before closure | threshold: Material contradictions become explicit repair work before final closure
- id: summary-integrity | selection: pinned | benchmarks: shared-summary-fact-retention | objective: Preserve critical facts through summary compression | threshold: Shared summaries retain the facts needed for the final recommendation

## Context7 defaults

- bundle: none

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.allowed_tools: Read,Glob

### Context7

- bundle: none

### Prompt

```text
Primary goal:
- Gate the wave only when both the implementation and the eval contract are coherent.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/evals/README.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-13-cont-qa.md
```

## Agent E0: cont-EVAL

### Role prompts

- docs/agents/wave-cont-eval-role.md

### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.allowed_tools: Read,Glob
- claude.output_format: json

### Context7

- bundle: none

### Skills

- role-cont-eval

### Prompt

```text
Primary goal:
- Evaluate whether the wave actually pools distributed information correctly and catches contradictions before closure.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/evals/README.md.
- Read docs/plans/wave-orchestrator.md and docs/plans/current-state.md.

Specific expectations:
- when a target is delegated, choose the smallest benchmark set inside the allowed family that genuinely exercises the failure mode
- when a target is pinned, run exactly the declared benchmark ids
- keep the report append-only and record exact target ids and exact benchmark ids

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-13-cont-eval.md
```

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- id: claude
- model: claude-sonnet-4-6

### Context7

- bundle: none

### Capabilities

- integration
- contradiction-recovery
- blackboard-fidelity

### Prompt

```text
Primary goal:
- Reconcile implementation and eval output into one closure-ready integration state.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/evals/README.md.
- Read docs/plans/master-plan.md and docs/plans/current-state.md.

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-13.md
- .tmp/main-wave-launcher/integration/wave-13.json
```

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- profile: docs-pass

### Context7

- bundle: none

### Prompt

```text
Primary goal:
- Keep the benchmark-facing docs and shared plan notes aligned with the landed evaluation workflow.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/evals/README.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

File ownership (only touch these paths):
- docs/evals/README.md
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
```

## Agent A1: Blackboard Summary Compression

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.search: true
- codex.json: true
- codex.config: model_reasoning_effort=high

### Context7

- bundle: node-typescript
- query: "State summarization, reduction strategies, and durable regression coverage for orchestration systems"

### Skills

- role-implementation
- runtime-codex

### Components

- closure-sweep-and-role-gates

### Capabilities

- hidden-profile-pooling
- blackboard-fidelity
- contradiction-recovery

### Exit contract

- completion: integrated
- durability: durable
- proof: integration
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/coordination-store.mjs
- scripts/wave-orchestrator/evals.mjs
- test/wave-orchestrator/coordination-store.test.ts

### Prompt

```text
Primary goal:
- Tighten summary and inbox generation so benchmark-driven closure can distinguish pooled evidence from merely repeated evidence.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/evals/README.md.
- Read docs/reference/sample-waves.md once it exists, then keep this sample aligned with it.

Specific expectations:
- make benchmark-facing evidence machine-visible in summaries or reports
- preserve critical facts that would matter for hidden-profile or contradiction-recovery checks
- keep implementation proof grounded in tests or other durable evidence

File ownership (only touch these paths):
- scripts/wave-orchestrator/coordination-store.mjs
- scripts/wave-orchestrator/evals.mjs
- test/wave-orchestrator/coordination-store.test.ts
```
