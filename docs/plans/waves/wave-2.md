# Wave 2 - Task Graph and Two-Phase Proof Model

**Commit message**: `Arch: add first-class task entities and two-phase proof separation`

## Component promotions

- state-artifacts-and-feedback: baseline-proved

## Context7 defaults

- bundle: node-typescript
- query: "Event sourcing, DAG task graphs, state machine design in Node.js"

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
- Verify that the task entity model and two-phase proof separation are correctly implemented and do not break existing wave execution.

Required context before coding:
- Read docs/plans/end-state-architecture.md (sections: Entity Model — Task, Two-Phase Proof Model).
- Read docs/reference/repository-guidance.md.

Specific expectations:
- confirm task IDs use stable semantic identity with separate version/hash fields, NOT pure content-addressable hashing
- confirm the distinction between task (durable work unit with ownership, artifact contract, proof rules, closure semantics) and coordination_record (event or message about a task, dependency, contradiction, or workflow)
- confirm owned_slice_proven is evaluated per-task and does not depend on other agents completing
- confirm wave_closure_ready requires all tasks proven PLUS all cross-cutting conditions
- confirm the gate engine now evaluates per-task, not just per-agent
- do not PASS if the task-coordination boundary is ambiguous

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-2-cont-qa.md
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
- docs-shared-plan

### Prompt

```text
Synthesize the task graph and proof model changes before documentation and cont-QA closure.

Required context before coding:
- Read docs/plans/end-state-architecture.md.
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

Verify:
- task graph correctly represents dependency edges between agents
- the two-phase proof split aligns with existing closure stage ordering
- retry engine correctly uses the split: only unproven tasks on slice failure, only closure agents on gate failure
- no regression in existing wave-0 execution behavior

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-2.md
- .tmp/main-wave-launcher/integration/wave-2.json
```

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- id: opencode
- opencode.files: docs/plans/end-state-architecture.md,docs/plans/current-state.md

### Context7

- bundle: none

### Prompt

```text
Update shared plan docs to reflect the task graph model and two-phase proof separation.

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

## Agent A1: Task Entity and Graph Builder

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "DAG construction, topological sort, JSON schema validation in Node.js"

### Components

- state-artifacts-and-feedback

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/task-entity.mjs
- test/wave-orchestrator/task-entity.test.ts

### Prompt

```text
Implement the first-class task entity model.

Design rules from end-state architecture:
- Task is a durable work unit with ownership, artifact contract, proof rules, and closure semantics.
- Coordination record is an event or message about a task, dependency, contradiction, or workflow.
- Tasks and coordination records do NOT overlap. Coordination records reference tasks by taskId.

Task identity:
- taskId is a stable semantic identifier (e.g., "wave-1:A1:wave-parser-and-launcher"), NOT a content hash.
- Tasks carry a separate contentHash and version field for change tracking.
- This avoids identity churn when scope, proof requirements, or dependencies change.

Task schema:
  task {
    taskId:            string        // stable semantic id: "wave-<N>:<agentId>:<component-or-slug>"
    version:           number        // increments on definition change
    contentHash:       string        // SHA256 of current definition content
    waveNumber:        number
    lane:              string
    owningAgentId:     string
    assigneeAgentId:   string
    leaseState:        "unleased" | "leased" | "released" | "expired"
    leaseExpiresAt:    ISO8601 | null
    artifactContract:  { deliverables, proofArtifacts, exitContract }
    proofRequirements: { proofLevel, proofCentric, maturityTarget }
    dependencyEdges:   [{ taskId, kind, status }]
    closureState:      "open" | "owned_slice_proven" | "wave_closure_ready" | "closed"
    components:        [{ componentId, targetLevel }]
    status:            "pending" | "in_progress" | "proven" | "blocked" | "completed"
  }

Implementation:
1. Add task entity type to control-plane schema (wave-control-schema.mjs).
2. Build task graph from wave definitions: each agent's deliverables + components + exit contract become a task node.
3. Build dependency edges from explicit wave dependencies, component ownership overlap, and closure-role ordering.
4. Task lifecycle events go to the control-plane log.
5. The wave-files.mjs parser emits task declarations from parsed wave definitions.
6. Write a materializeTaskGraph(controlPlaneEvents) function that rebuilds the DAG.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (sections: Entity Model — Task, Two-Phase Proof Model).
- Read scripts/wave-orchestrator/wave-control-schema.mjs.
- Read scripts/wave-orchestrator/control-plane.mjs.
- Read scripts/wave-orchestrator/wave-files.mjs (agent definition parsing).

File ownership (only touch these paths):
- scripts/wave-orchestrator/task-entity.mjs
- scripts/wave-orchestrator/wave-control-schema.mjs
- scripts/wave-orchestrator/control-plane.mjs
- test/wave-orchestrator/task-entity.test.ts
```

## Agent A2: Two-Phase Proof Separation

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript

### Components

- state-artifacts-and-feedback

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: none

### Deliverables

- scripts/wave-orchestrator/launcher-gates.mjs
- test/wave-orchestrator/proof-phases.test.ts

### Prompt

```text
Implement the two-phase proof separation: owned_slice_proven and wave_closure_ready.

owned_slice_proven (per-task evaluation):
- deliverables exist on disk
- proof markers meet or exceed the declared exit contract
- proof artifacts (if declared) are present and SHA256-valid
- doc-delta declared if contract requires it
- component promotions meet target maturity level
- no open self-owned blockers

wave_closure_ready (wave-level evaluation):
- ALL tasks are owned_slice_proven
- no unresolved contradictions
- no open clarification barriers
- no open helper assignment barriers
- no open cross-lane dependency barriers
- integration gate passed (A8)
- documentation gate passed (A9)
- cont-eval gate passed (E0) if applicable
- security gate passed if applicable
- cont-qa final verdict is PASS (A0)
- component matrix promotions validated

Rerun implications:
- If an agent's slice fails: only that agent and downstream task dependents need rerun.
- If closure gates fail but slices are proven: only the failing closure agent reruns.
- If a contradiction invalidates proof: affected tasks marked for re-proof, unaffected proof bundles preserved.

Modify the gate engine to:
1. Evaluate owned_slice_proven per-task using the task graph from Wave A1.
2. Evaluate wave_closure_ready as an aggregate of all task proofs plus cross-cutting conditions.
3. Return both states to the closure engine.
4. Update the retry engine to use the split for targeted reruns.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Two-Phase Proof Model).
- Read scripts/wave-orchestrator/launcher-gates.mjs.
- Read scripts/wave-orchestrator/launcher-retry.mjs.
- Read scripts/wave-orchestrator/task-entity.mjs (from A1 in this wave).

File ownership (only touch these paths):
- scripts/wave-orchestrator/launcher-gates.mjs
- scripts/wave-orchestrator/launcher-retry.mjs
- test/wave-orchestrator/proof-phases.test.ts
```
