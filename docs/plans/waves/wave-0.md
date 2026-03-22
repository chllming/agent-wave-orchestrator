# Wave 0 - Starter Scaffold Validation

**Commit message**: `Chore: validate starter wave scaffold`

## Component promotions

- wave-parser-and-launcher: repo-landed
- starter-docs-and-adoption-guidance: repo-landed

## Context7 defaults

- bundle: node-typescript
- query: "Node.js and TypeScript basics for orchestrator maintenance"

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- id: codex
- model: gpt-5-codex
- codex.profile_name: review
- codex.search: true
- codex.json: true

### Context7

- bundle: none

### Prompt

```text
Primary goal:
- Keep the starter scaffold coherent while the rest of the wave runs.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-0-cont-qa.md
```

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.settings_json: {"permissions":{"allow":["Read"]}}
- claude.hooks_json: {"Stop":[{"command":"echo integration-stop"}]}

### Context7

- bundle: none

### Capabilities

- integration
- docs-shared-plan

### Prompt

```text
Synthesize the wave before documentation and cont-QA closure.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-0.md
- .tmp/main-wave-launcher/integration/wave-0.json
```

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- id: opencode
- opencode.files: README.md,docs/plans/current-state.md
- opencode.config_json: {"instructions":["Keep shared plan docs concise and factual."]}

### Context7

- bundle: none

### Prompt

```text
Keep the starter shared plan docs aligned with the landed Wave 0 outcomes.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
```

## Agent A1: Starter Runtime and Docs Review

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.config: model_reasoning_effort=medium
- codex.add_dirs: docs,scripts
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "Node.js module layout, process spawning, and vitest test execution"

### Components

- wave-parser-and-launcher
- starter-docs-and-adoption-guidance

### Capabilities

- schema-migration
- frontend-validation

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Prompt

```text
Review and tighten the starter runtime and test harness.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/wave-orchestrator.md and docs/plans/context7-wave-orchestrator.md.

File ownership (only touch these paths):
- README.md
- docs/plans/wave-orchestrator.md
- scripts/wave-orchestrator/wave-files.mjs
- test/wave-orchestrator/wave-files.test.ts
```
