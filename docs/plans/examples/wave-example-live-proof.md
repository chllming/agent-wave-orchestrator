# Wave 14 - Example Full Modern Release Surface

This is a showcase-first sample wave.

Use it as the single reference example for the current `0.7.1` Wave surface.

It intentionally combines more sections than a normal production wave so one file can demonstrate:

- standard closure roles (`A0`, `E0`, `A8`, `A9`)
- `## Eval targets` with delegated and pinned benchmark selection
- richer `### Executor` blocks, budgets, and sticky retry
- `### Skills`
- `### Capabilities`
- `### Deliverables`
- `### Exit contract`
- proof-first live validation with `### Proof artifacts`
- `## Deploy environments`
- infra and deploy-verifier specialists

This example is intentionally denser than a launch-minimal wave. Its job is to teach the full authored surface in one place.

**Commit message**: `Docs: add full modern sample wave`

## Component promotions

- learning-memory-action-plane: pilot-live
- executor-abstraction-and-prompt-transport: baseline-proved

## Deploy environments

- prod: kubernetes default (primary production cluster)
- staging: custom-deploy (manual preflight and recovery flow)

## Eval targets

- id: live-proof-fidelity | selection: delegated | benchmark-family: blackboard-fidelity | objective: Preserve machine-visible live proof through summaries, inboxes, and integration closure | threshold: Critical live-proof facts remain visible through final closure
- id: contradiction-recovery | selection: pinned | benchmarks: claim-conflict-detection,evidence-based-repair | objective: Surface and repair conflicting live claims before PASS | threshold: Material contradictions become explicit repair work before final closure
- id: silo-escape | selection: delegated | benchmark-family: silo-escape | objective: Reconstruct the correct global state from distributed live and repo evidence | threshold: Integration closure reflects the full cross-agent state instead of partial local views

## Context7 defaults

- bundle: node-typescript
- query: "Orchestration state machines, retry policy, summary fidelity, and durable validation for coding agents"

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
- Treat live proof as a real closure input, not as a narrative claim.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/reference/live-proof-waves.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

Specific expectations:
- do not PASS unless the declared proof artifacts exist locally
- do not infer host truth from stale repo-local snapshots
- rely on the declared proof bundle, integration summary, and doc closure state

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-14-cont-qa.md
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
- Evaluate whether the wave actually preserves, integrates, and repairs distributed live-proof evidence before closure.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/evals/README.md.
- Read docs/reference/live-proof-waves.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

Specific expectations:
- for delegated targets, choose the smallest benchmark set that genuinely exercises the failure mode
- for pinned targets, run the exact benchmark ids named in the wave contract
- record the exact selected target ids and benchmark ids in the append-only report

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-14-cont-eval.md
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
- live-proof-reconciliation
- contradiction-recovery
- blackboard-fidelity

### Prompt

```text
Primary goal:
- Reconcile repo changes, proof artifacts, infra state, and deploy-verifier evidence into one closure-ready decision.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/reference/live-proof-waves.md.
- Read docs/plans/master-plan.md and docs/plans/current-state.md.

Specific expectations:
- treat missing proof artifacts as blocking
- prefer explicit follow-up requests over vague warnings
- call out stale or contradictory live-proof claims
- use the `cont-EVAL` report and exact benchmark ids as evidence, not as a suggestion

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-14.md
- .tmp/main-wave-launcher/integration/wave-14.json
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
- Keep shared-plan docs and release-facing notes aligned with the proof-first live workflow.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/reference/live-proof-waves.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/evals/README.md
```

## Agent A1: Runtime And Summary Hardening

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.config: model_reasoning_effort=high
- codex.search: true
- codex.json: true
- codex.add_dirs: docs,scripts,test
- fallbacks: claude, opencode
- budget.minutes: 45

### Context7

- bundle: node-typescript
- query: "Retry orchestration, summary integrity, validation rules, and Vitest coverage for agent systems"

### Skills

- role-implementation
- runtime-codex
- repo-coding-rules

### Components

- executor-abstraction-and-prompt-transport

### Capabilities

- status-reconciliation
- benchmark-integration
- summary-fidelity

### Exit contract

- completion: integrated
- durability: durable
- proof: integration
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/launcher.mjs
- scripts/wave-orchestrator/coordination-store.mjs
- test/wave-orchestrator/launcher.test.ts
- test/wave-orchestrator/coordination-store.test.ts

### Prompt

```text
Primary goal:
- Tighten the runtime's handling of retries, summaries, and benchmark-facing evidence so proof-centric closure stays machine-visible.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/evals/README.md.
- Read docs/reference/live-proof-waves.md.
- Read docs/plans/current-state.md and docs/plans/wave-orchestrator.md.

Specific expectations:
- preserve prompt-hash-based reuse safety
- keep distributed evidence visible through the shared summary and inbox layers
- add or update regression coverage for any retry or summary behavior you change

File ownership (only touch these paths):
- scripts/wave-orchestrator/launcher.mjs
- scripts/wave-orchestrator/coordination-store.mjs
- test/wave-orchestrator/launcher.test.ts
- test/wave-orchestrator/coordination-store.test.ts
```

## Agent A6: Learning Plane Live Validation

### Executor

- id: codex
- retry-policy: sticky
- budget.minutes: 30
- codex.search: true
- codex.json: true

### Context7

- bundle: none

### Skills

- role-infra
- provider-kubernetes
- provider-custom-deploy

### Components

- learning-memory-action-plane

### Capabilities

- live-proof
- restart-safety
- deploy-validation

### Exit contract

- completion: live
- durability: durable
- proof: live
- doc-impact: owned

### Deliverables

- docs/plans/waves/reviews/wave-14-live-proof.md

### Proof artifacts

- path: .tmp/wave-14-learning-proof/learning-dry-run-status.json | kind: live-status | required-for: pilot-live
- path: .tmp/wave-14-learning-proof/learning-plane-before-restart.json | kind: live-status | required-for: pilot-live
- path: .tmp/wave-14-learning-proof/learning-plane-after-restart.json | kind: restart-check | required-for: pilot-live
- path: .tmp/wave-14-learning-proof/learning-vector-manifest.json | kind: manifest | required-for: pilot-live

### Prompt

```text
Primary goal:
- Capture restart-safe learning-plane proof as a local machine-visible bundle and write the review note that closure roles will trust.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/reference/live-proof-waves.md.
- Read docs/plans/current-state.md and docs/plans/wave-orchestrator.md.

Operator command sequence:
- leapctl learning status --json > .tmp/wave-14-learning-proof/learning-plane-before-restart.json
- leapctl learning dry-run --json > .tmp/wave-14-learning-proof/learning-dry-run-status.json
- leapctl learning restart --env prod
- leapctl learning status --json > .tmp/wave-14-learning-proof/learning-plane-after-restart.json
- leapctl learning manifest --json > .tmp/wave-14-learning-proof/learning-vector-manifest.json

Specific expectations:
- closure only counts when the declared proof artifacts exist locally
- if live host state and cached state disagree, prefer current control-plane truth and log the discrepancy explicitly
- if proof arrives after a failed attempt, expect a targeted rerun on the same executor instead of generic fallback
- post exact artifact paths and machine-visible evidence through coordination instead of assuming closure agents will rediscover host state

File ownership (only touch these paths):
- .tmp/wave-14-learning-proof/
- docs/plans/waves/reviews/wave-14-live-proof.md
```

## Agent A7: Infra Proof Steward

### Role prompts

- docs/agents/wave-infra-role.md

### Executor

- id: opencode
- opencode.format: json
- opencode.steps: 12

### Context7

- bundle: none

### Skills

- role-infra
- provider-kubernetes

### Prompt

```text
Primary goal:
- Verify infra and workload identity assumptions around the live proof owner's commands.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/reference/live-proof-waves.md.

Specific expectations:
- emit infra markers instead of vague prose
- call out drift or setup-required states explicitly
- open targeted follow-up work if the live proof owner depends on unresolved infra setup

File ownership (only touch these paths):
- .tmp/main-wave-launcher/logs/wave-14-a7.log
```

## Agent D1: Deploy Verifier

### Role prompts

- docs/agents/wave-deploy-verifier-role.md

### Executor

- id: opencode
- opencode.format: json
- opencode.steps: 10

### Context7

- bundle: none

### Skills

- role-deploy
- provider-kubernetes
- provider-custom-deploy

### Prompt

```text
Primary goal:
- Verify that the rollout associated with the live proof owner is healthy enough to preserve the `pilot-live` claim.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/reference/live-proof-waves.md.

Specific expectations:
- use explicit deploy status markers for healthy, failed, or rolled-over states
- do not sign off on implied host health
- if rollout evidence is incomplete, leave an explicit deploy-risk trail for integration and cont-QA

File ownership (only touch these paths):
- .tmp/main-wave-launcher/logs/wave-14-d1.log
```
