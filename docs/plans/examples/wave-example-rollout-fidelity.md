# Wave 9 - Rollout Substrate + Desired-State Records

This is a showcase-first sample wave for a high-fidelity `repo-landed` outcome.

Use it when you want a concrete example of what "good" looks like for a wave
that lands one cohesive substrate across multiple implementation slices without
over-claiming `pilot-live` or `fleet-ready` proof.

This example is intentionally generic. The component id, deliverable paths, and
Go control-plane slices are illustrative, but the authored Wave structure,
closure expectations, and maturity discipline match the current surface.

All launcher-owned `.tmp/main-wave-launcher/...` paths in this example assume the implicit default project. For explicit monorepo projects, rewrite them to `.tmp/projects/<projectId>/main-wave-launcher/...` and launch the wave with `--project <projectId>`.

**Commit message**: `Feat: land rollout substrate and desired-state records`

## Component promotions

- rollout-cores-and-cluster-view: repo-landed

## Deploy environments

- repo-local: custom default (repo-local rollout substrate work; no live host mutation)

## Context7 defaults

- bundle: go-services
- query: "Desired state, reconcile loops, rollout metadata, and cluster-view surfaces for Go control-plane rollout work"

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- profile: deep-review
- claude.permission_mode: plan
- claude.settings: .claude/settings.json
- claude.output_format: text

### Context7

- bundle: none
- query: "Repository docs remain canonical for cont-QA"

### Prompt

```text
Primary goal:
- Judge whether Wave 9 honestly lands rollout-cores-and-cluster-view at repo-landed without implying pilot-live or fleet-ready proof.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.
- Read docs/plans/component-cutover-matrix.md and docs/reference/wave-planning-lessons.md.

Specific expectations:
- do not PASS unless desired-state records, reconcile-loop substrate, and cluster-view surfaces all land together
- treat repo-landed as a lower bar than pilot-live and fleet-ready
- require shared-plan updates when the future-wave baseline changes
- emit the final `[wave-gate] ...` marker as a plain last line before `Verdict: ...`

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-9-cont-qa.md
```

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- profile: deep-review
- claude.permission_mode: plan
- claude.settings: .claude/settings.json
- claude.output_format: text

### Context7

- bundle: none
- query: "Repository docs remain canonical for integration"

### Prompt

```text
Primary goal:
- Reconcile desired-state, cluster-view, and reconcile-loop slices into one closure-ready repo-landed verdict.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md and docs/plans/current-state.md.
- Read docs/plans/component-cutover-matrix.md and docs/reference/wave-planning-lessons.md.

Specific expectations:
- treat missing rollout substrate pieces as integration failures
- decide `ready-for-doc-closure` vs `needs-more-work` based on the landed substrate, not intent
- emit the final `[wave-integration] ...` marker as a plain last line

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-9.md
- .tmp/main-wave-launcher/integration/wave-9.json
```

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- profile: docs-pass
- claude.settings: .claude/settings.json
- claude.output_format: text

### Context7

- bundle: none
- query: "Shared-plan documentation only"

### Prompt

```text
Primary goal:
- Keep shared plan docs and the component matrix aligned with the real Wave 9 rollout-substrate outcome.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.
- Read docs/plans/component-cutover-matrix.md and docs/reference/wave-planning-lessons.md.

Specific expectations:
- update shared plan docs when Wave 9 changes what later waves may safely assume
- leave an exact `closed` or `no-change` note for A0
- emit the final `[wave-doc-closure] ...` marker as a plain last line

File ownership (only touch these paths):
- docs/plans/master-plan.md
- docs/plans/current-state.md
- docs/plans/migration.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
```

## Agent A1: Desired-State Records And Rollout Store

### Executor

- profile: implement-fast
- model: gpt-5.4
- codex.config: model_reasoning_effort=xhigh,model_verbosity=low

### Context7

- bundle: go-services
- query: "Desired-state persistence, rollout records, and authoritative state transitions"

### Skills

- role-implementation
- runtime-codex
- repo-coding-rules

### Components

- rollout-cores-and-cluster-view

### Capabilities

- rollout-authority
- desired-state

### Exit contract

- completion: integrated
- durability: durable
- proof: integration
- doc-impact: owned

### Deliverables

- go/internal/rollout/desiredstate/store.go
- go/internal/rollout/desiredstate/store_test.go
- docs/plans/operations/wave-9-rollout-state-model.md

### Prompt

```text
Primary goal:
- Land the durable desired-state store and revision model for rollout ownership inside the Go control plane.

Specific expectations:
- Emit the final `[wave-proof]`, `[wave-doc-delta]`, and `[wave-component]`
  markers as plain lines by themselves at the end of the output. Do not wrap
  them in backticks, quotes, or code fences.
- Do not stop after code or tests alone. Treat the missing final marker lines
  as an incomplete attempt even if the deliverables already exist on disk.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/migration.md and docs/reference/wave-planning-lessons.md.

File ownership (only touch these paths):
- go/internal/rollout/desiredstate/
- docs/plans/operations/wave-9-rollout-state-model.md
```

## Agent A2: Cluster View And Observed-State Projections

### Executor

- profile: implement-fast
- model: gpt-5.4
- codex.config: model_reasoning_effort=xhigh,model_verbosity=low

### Context7

- bundle: go-services
- query: "Cluster-view, observed-state projections, and rollout-facing status surfaces"

### Skills

- role-implementation
- runtime-codex
- repo-coding-rules

### Components

- rollout-cores-and-cluster-view

### Capabilities

- cluster-view
- observed-state

### Exit contract

- completion: integrated
- durability: durable
- proof: integration
- doc-impact: owned

### Deliverables

- go/internal/cluster/view/status.go
- go/internal/cluster/view/status_test.go
- docs/plans/qa/wave-9-cluster-view-projections.md

### Prompt

```text
Primary goal:
- Land repo-visible cluster-view and observed-state projections that later rollout and cutover waves can trust.

Specific expectations:
- Emit the final `[wave-proof]`, `[wave-doc-delta]`, and `[wave-component]`
  markers as plain lines by themselves at the end of the output. Do not wrap
  them in backticks, quotes, or code fences.
- Do not stop after code or tests alone. Treat the missing final marker lines
  as an incomplete attempt even if the deliverables already exist on disk.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/migration.md and docs/reference/wave-planning-lessons.md.

File ownership (only touch these paths):
- go/internal/cluster/view/
- docs/plans/qa/wave-9-cluster-view-projections.md
```

## Agent A3: Task Plane And Reconcile Loop Skeleton

### Executor

- profile: implement-fast
- model: gpt-5.4
- codex.config: model_reasoning_effort=xhigh,model_verbosity=low

### Context7

- bundle: go-services
- query: "Worker task planes, reconcile loops, and rollout-safe execution boundaries"

### Skills

- role-implementation
- runtime-codex
- repo-coding-rules

### Components

- rollout-cores-and-cluster-view

### Capabilities

- reconcile-loop
- task-plane

### Exit contract

- completion: integrated
- durability: durable
- proof: integration
- doc-impact: owned

### Deliverables

- go/internal/rollout/reconcile/worker.go
- go/internal/rollout/reconcile/worker_test.go
- docs/plans/operations/wave-9-reconcile-loop.md

### Prompt

```text
Primary goal:
- Land the narrow task-plane and reconcile-loop substrate without turning workers into peer control planes.

Specific expectations:
- Emit the final `[wave-proof]`, `[wave-doc-delta]`, and `[wave-component]`
  markers as plain lines by themselves at the end of the output. Do not wrap
  them in backticks, quotes, or code fences.
- Do not stop after code or tests alone. Treat the missing final marker lines
  as an incomplete attempt even if the deliverables already exist on disk.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/migration.md and docs/reference/wave-planning-lessons.md.

File ownership (only touch these paths):
- go/internal/rollout/reconcile/
- docs/plans/operations/wave-9-reconcile-loop.md
```
