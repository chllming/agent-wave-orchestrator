# Wave 6 - Proof Families, Workflow Backend, and Architecture Completion

**Commit message**: `Arch: add proof families, workflow backend boundary, and complete architecture refactor`

## Component promotions

- wave-parser-and-launcher: pilot-live
- closure-sweep-and-role-gates: pilot-live
- executor-abstraction-and-prompt-transport: pilot-live

## Context7 defaults

- bundle: node-typescript
- query: "Workflow backend abstraction, deployment verification, proof family validation in Node.js"

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
- Verify that the full end-state architecture is landed, internally consistent, and tested.

Required context before coding:
- Read docs/plans/end-state-architecture.md (all sections).
- Read docs/reference/repository-guidance.md.

Specific expectations:
- confirm proof families (code_proof, integration_proof, deploy_proof) are independently evaluated
- confirm the workflow backend boundary abstracts event persistence, state queries, timer management, and human input behind a clean interface
- confirm the local-file backend is the only implementation and passes all tests
- confirm the full end-state module architecture is realized:
  Layer 1: canonical authority set (control-plane, coordination-store, wave-files)
  Layer 2: phase engines (implementation, derived-state, gate, closure, retry, reducer)
  Layer 3: session supervisor + projection writer
  Layer 4: thin launcher orchestrator
- confirm every design principle from the architecture doc is implemented
- confirm all 10 feedback corrections are addressed
- do not PASS if any phase engine still reads from derived caches or projections

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-6-cont-qa.md
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
- contradiction-recovery

### Prompt

```text
Final integration synthesis for the architecture refactor.

Required context before coding:
- Read docs/plans/end-state-architecture.md.
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

Verify end-to-end:
- a wave can run through the full pipeline: parse → reduce → plan → select → materialize → launch → wait → evaluate → close
- retry correctly uses task graph and two-phase proof for targeted reruns
- contradiction detection, repair, and resolution work end-to-end
- human input workflow blocks closure and supports escalation/reroute
- replay tests pass using stored events from waves 0-5
- the workflow backend boundary is clean enough that swapping the implementation would not require changes to phase engines

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-6.md
- .tmp/main-wave-launcher/integration/wave-6.json
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
Final documentation update reflecting the completed architecture refactor.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

Update all shared plan docs to reflect the final landed state.
Mark the end-state architecture doc as landed (not aspirational).
Update the component cutover matrix with all promotions.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/plans/wave-orchestrator.md
- docs/plans/end-state-architecture.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
- docs/reference/proof-metrics.md
- docs/reference/wave-control.md
```

## Agent A1: Proof Family Split

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "Proof validation, deployment health checks, test runner integration"

### Components

- closure-sweep-and-role-gates

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/proof-families.mjs
- test/wave-orchestrator/proof-families.test.ts

### Proof artifacts

- path: .tmp/wave-6-proof/proof-family-report.json | kind: proof-family-report | required-for: pilot-live

### Prompt

```text
Implement the three proof families: code_proof, integration_proof, deploy_proof.

code_proof — validates agent's owned deliverables:
- tests pass (unit/integration/live per contract)
- build succeeds
- diff clean outside owned paths
- deliverables exist and non-empty
- proof artifacts present and SHA256-valid
- component promotions meet target maturity

integration_proof — validates cross-cutting contracts:
- interface contracts consistent between components
- dependency resolution clean
- no open integration conflicts
- no open contradictions on shared state
- cross-lane dependencies resolved
- integration summary: zero unresolved blockers

deploy_proof — validates runtime behavior (opt-in):
- rollout artifact exists (if declared)
- runtime health check passes (if declared)
- post-deploy evidence collected (if declared)
- no deployment-blocking regressions
- deploy-kind specific validation (Railway, Docker, k8s, etc.)

The gate engine evaluates each family independently. A wave can be:
  code_proof: satisfied, integration_proof: satisfied, deploy_proof: not_applicable

Implementation:
1. Define proof family schema in proof-families.mjs.
2. Update gate engine to evaluate each family.
3. Update proof registry to tag bundles with proof family.
4. Update result envelope role-specific payloads for deploy role.
5. Write tests covering each family independently.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Proof Families).
- Read scripts/wave-orchestrator/proof-registry.mjs.
- Read scripts/wave-orchestrator/launcher-gates.mjs.

File ownership (only touch these paths):
- scripts/wave-orchestrator/proof-families.mjs
- scripts/wave-orchestrator/proof-registry.mjs
- scripts/wave-orchestrator/launcher-gates.mjs
- test/wave-orchestrator/proof-families.test.ts
- .tmp/wave-6-proof/
```

## Agent A2: Workflow Backend Boundary

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "Workflow engine abstraction, repository pattern, dependency injection in Node.js"

### Components

- wave-parser-and-launcher
- executor-abstraction-and-prompt-transport

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: none

### Deliverables

- scripts/wave-orchestrator/workflow-backend.mjs
- scripts/wave-orchestrator/workflow-backend-local.mjs
- test/wave-orchestrator/workflow-backend.test.ts

### Proof artifacts

- path: .tmp/wave-6-proof/workflow-backend-trace.json | kind: backend-trace | required-for: pilot-live

### Prompt

```text
Introduce the workflow backend abstraction boundary.

The workflow backend interface:
  WorkflowBackend {
    // Event persistence
    appendEvent(event) → void
    readEvents(filter) → [Event]

    // State queries (backed by reducer)
    getWaveState(lane, wave) → WaveState
    getTaskState(taskId) → TaskState
    getOpenBlockers(lane, wave) → [Blocker]
    getClosureEligibility(lane, wave) → ClosureState

    // Timer management
    scheduleTimer(id, dueAt, payload) → void
    cancelTimer(id) → void
    getExpiredTimers() → [Timer]

    // Human input
    createHumanInput(request) → requestId
    resolveHumanInput(requestId, response) → void
    getOpenHumanInputs(filter) → [HumanInput]
  }

Local-file backend implementation:
- appendEvent → JSONL append to control-plane log
- readEvents → parse JSONL with filter
- getWaveState → call wave-state-reducer.reduce()
- Timer management → file-based tracking under .tmp/<lane>-wave-launcher/timers/
- Human input → existing feedback queue + human-input-workflow.mjs

Design rules:
1. Phase engines interact with state ONLY through the backend interface.
2. The local-file backend is the only implementation for now.
3. The interface is clean enough that a Temporal-backed or service-backed backend could replace it without rewriting phase engines.
4. The backend does NOT own business logic — it persists events and answers queries.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Workflow Backend Boundary).
- Read scripts/wave-orchestrator/control-plane.mjs (current event persistence).
- Read scripts/wave-orchestrator/wave-state-reducer.mjs (state queries).

File ownership (only touch these paths):
- scripts/wave-orchestrator/workflow-backend.mjs
- scripts/wave-orchestrator/workflow-backend-local.mjs
- test/wave-orchestrator/workflow-backend.test.ts
- .tmp/wave-6-proof/
```
