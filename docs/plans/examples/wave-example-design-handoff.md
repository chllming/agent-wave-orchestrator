# Wave 12 - Optional Design Steward Handoff

This is a showcase-first sample wave for the shipped `design` worker role in `0.8.7`.

This example demonstrates the docs-first design-steward path where a design packet is published before code-owning implementation begins.

Use this shape when:

- the task has interface or architecture ambiguity
- multiple implementation owners need the same decisions and assumptions
- you want explicit design lineage instead of re-deriving the same plan in each coding prompt

If you want the hybrid design-steward variant instead, keep the same packet path but also assign that same design agent implementation-owned files plus the normal implementation contract sections. The runtime will then run the design pass first and include that same agent in the later implementation fan-out.

**Commit message**: `Feat: add design packet before implementation fan-out`

## Component promotions

- api-boundary: repo-landed
- runtime-integration: repo-landed

## Context7 defaults

- bundle: node-typescript
- query: "Interface boundaries, migration sequencing, and implementation handoff patterns for repository work"

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- profile: deep-review

### Context7

- bundle: none

### Prompt

```text
Primary goal:
- Judge whether the design packet, implementation slices, and closure evidence line up without hidden architectural drift.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/plans/current-state.md and docs/plans/migration.md.
- Read docs/plans/waves/design/wave-12-D1.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-12-cont-qa.md
```

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- profile: deep-review

### Context7

- bundle: none

### Prompt

```text
Primary goal:
- Reconcile the landed implementation against the design packet and the actual repo changes.

Required context before coding:
- Read docs/plans/current-state.md.
- Read docs/plans/waves/design/wave-12-D1.md.

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-12.md
- .tmp/main-wave-launcher/integration/wave-12.json
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
- Keep the shared docs and migration notes aligned with the design packet and final implementation outcome.

Required context before coding:
- Read docs/plans/current-state.md.
- Read docs/plans/migration.md.
- Read docs/plans/waves/design/wave-12-D1.md.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/migration.md
```

## Agent D1: Design Steward

### Role prompts

- docs/agents/wave-design-role.md

### Executor

- profile: design-pass

### Context7

- bundle: none

### Skills

- role-design

Add `tui-design` here too when the design packet owns terminal UX, dashboards, or other operator-surface behavior. Omit it for generic API or migration design.

### Capabilities

- design
- interface-handoff
- decision-lineage

### Prompt

```text
Primary goal:
- Produce the implementation-ready design packet for the Wave 12 slice before coding starts.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/plans/current-state.md.
- Read docs/plans/migration.md.

Specific expectations:
- make the implementation handoff concrete enough that A1 and A2 can start without re-deriving the same architecture
- keep assumptions and open questions explicit
- do not silently expand into source-code changes

File ownership (only touch these paths):
- docs/plans/waves/design/wave-12-D1.md
```

## Agent A1: API Boundary Update

### Executor

- profile: implement-fast

### Context7

- bundle: node-typescript
- query: "API boundary refactors and compatibility-safe migration sequencing"

### Skills

- role-implementation
- runtime-codex
- repo-coding-rules

### Components

- api-boundary

### Deliverables

- scripts/wave-orchestrator/api-boundary.mjs
- test/wave-orchestrator/api-boundary.test.ts

### Exit contract

- completion: integrated
- durability: durable
- proof: integration
- doc-impact: none

### Prompt

```text
Primary goal:
- Land the API-boundary changes described in the Wave 12 design packet.

Required context before coding:
- Read docs/plans/waves/design/wave-12-D1.md before changing code.

File ownership (only touch these paths):
- scripts/wave-orchestrator/api-boundary.mjs
- test/wave-orchestrator/api-boundary.test.ts
```

## Agent A2: Runtime Integration Update

### Executor

- profile: implement-fast

### Context7

- bundle: node-typescript
- query: "Runtime integration updates and handoff-safe staged migration"

### Skills

- role-implementation
- runtime-codex
- repo-coding-rules

### Components

- runtime-integration

### Deliverables

- scripts/wave-orchestrator/runtime-integration.mjs
- test/wave-orchestrator/runtime-integration.test.ts

### Exit contract

- completion: integrated
- durability: durable
- proof: integration
- doc-impact: none

### Prompt

```text
Primary goal:
- Land the runtime integration changes described in the Wave 12 design packet.

Required context before coding:
- Read docs/plans/waves/design/wave-12-D1.md before changing code.

File ownership (only touch these paths):
- scripts/wave-orchestrator/runtime-integration.mjs
- test/wave-orchestrator/runtime-integration.test.ts
```

## Why This Example Exists

This example demonstrates the intended boundary:

- the design steward is report-first and docs/spec-owned
- implementation owners still own code changes and proof
- closure roles stay the same
- the design packet becomes an explicit handoff artifact instead of hidden reasoning inside one agent transcript
