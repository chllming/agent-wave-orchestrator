# Wave 12 - Example Modern Implementation And Coordination

This is a showcase-first sample wave.

Use it to see the modern authored wave shape in one place:

- standard closure roles (`A0`, `A8`, `A9`)
- explicit executor blocks
- Context7 defaults and per-agent overrides
- cross-runtime `### Skills`
- helper-routing hints through `### Capabilities`
- `### Deliverables`
- `### Exit contract`
- component promotions and component ownership

It is intentionally denser than a normal production wave so it can teach the surface area quickly.

**Commit message**: `Docs: add modern implementation and coordination sample wave`

## Component promotions

- wave-parser-and-launcher: baseline-proved
- starter-docs-and-adoption-guidance: baseline-proved

## Context7 defaults

- bundle: node-typescript
- query: "Node.js orchestration patterns, TypeScript maintenance, and Vitest test updates for repository tooling"

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.allowed_tools: Read,Glob
- claude.output_format: stream-json

### Context7

- bundle: none

### Prompt

```text
Primary goal:
- Keep the implementation and documentation slices aligned while the wave is still in progress.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.
- Read docs/plans/wave-orchestrator.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-12-cont-qa.md
```

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- profile: deep-review
- claude.allowed_tools: Read,Glob

### Context7

- bundle: none

### Capabilities

- integration
- docs-shared-plan
- interface-reconciliation

### Prompt

```text
Primary goal:
- Reconcile cross-agent changes before documentation and cont-QA closure.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.
- Read docs/plans/wave-orchestrator.md.

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-12.md
- .tmp/main-wave-launcher/integration/wave-12.json
```

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- profile: docs-pass
- claude.allowed_tools: Read,Glob

### Context7

- bundle: none

### Prompt

```text
Primary goal:
- Keep shared-plan docs and the component matrix aligned with the landed implementation.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.
- Read docs/plans/component-cutover-matrix.md and docs/plans/component-cutover-matrix.json.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
```

## Agent A1: Runtime Contract Hardening

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.config: model_reasoning_effort=medium
- codex.search: true
- codex.json: true
- codex.add_dirs: docs,scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "Node child_process orchestration, status reconciliation, and Vitest regression patterns"

### Skills

- role-implementation
- repo-coding-rules

### Components

- wave-parser-and-launcher

### Capabilities

- status-reconciliation
- runtime-policy
- trace-hardening

### Exit contract

- completion: integrated
- durability: durable
- proof: integration
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/launcher.mjs
- test/wave-orchestrator/launcher.test.ts
- docs/reference/runtime-config/codex.md

### Prompt

```text
Primary goal:
- Tighten launcher-side runtime policy and reconciliation behavior for modern multi-runtime waves.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/wave-orchestrator.md and docs/plans/current-state.md.
- Read docs/reference/runtime-config/README.md and docs/reference/runtime-config/codex.md.

Specific expectations:
- keep runtime policy changes machine-visible in summaries and traces
- preserve prompt-hash-based reuse guarantees
- add regression coverage for any reuse or retry behavior you change

File ownership (only touch these paths):
- scripts/wave-orchestrator/launcher.mjs
- scripts/wave-orchestrator/traces.mjs
- test/wave-orchestrator/launcher.test.ts
- docs/reference/runtime-config/codex.md
```

## Agent A2: Shared Summary And Inbox Quality

### Executor

- id: opencode
- opencode.format: json
- opencode.steps: 10
- opencode.files: docs/plans/wave-orchestrator.md,docs/plans/current-state.md
- opencode.instructions: Keep summary and inbox examples concrete, preserve operator-facing clarity.

### Context7

- bundle: none

### Skills

- role-documentation
- runtime-opencode

### Components

- starter-docs-and-adoption-guidance

### Capabilities

- summary-compilation
- inbox-targeting
- docs-shared-plan

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: shared-plan

### Deliverables

- scripts/wave-orchestrator/coordination-store.mjs
- test/wave-orchestrator/coordination-store.test.ts
- docs/plans/current-state.md

### Prompt

```text
Primary goal:
- Improve the shared summary and inbox projection so operators and closure roles can reason about the current wave state quickly.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/wave-orchestrator.md and docs/plans/current-state.md.
- Read docs/reference/live-proof-waves.md for proof-centric expectations even though this sample is not a live-proof wave.

Specific expectations:
- preserve the canonical coordination log as the source of truth
- keep derived inboxes targeted by ownership, components, and blocking requests
- if shared-plan docs need wording changes, coordinate them through A9

File ownership (only touch these paths):
- scripts/wave-orchestrator/coordination-store.mjs
- test/wave-orchestrator/coordination-store.test.ts
- docs/plans/current-state.md
```
