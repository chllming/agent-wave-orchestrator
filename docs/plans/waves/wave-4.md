# Wave 4 - State Reducer, Contradiction Entities, and Evidence Lineage

**Commit message**: `Arch: add wave state reducer, contradiction entities, and stable fact ids`

## Component promotions

- state-artifacts-and-feedback: pilot-live

## Context7 defaults

- bundle: node-typescript
- query: "Event sourcing reducers, DAG traversal, content hashing, and deterministic replay in Node.js"

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
- Verify that the reducer is a pure function, contradiction entities are normalized, and fact identity is stable.

Required context before coding:
- Read docs/plans/end-state-architecture.md (sections: Wave State Reducer, Contradiction, Fact/Evidence).
- Read docs/reference/repository-guidance.md.

Specific expectations:
- confirm reducer takes the canonical authority set (control-plane events, coordination records, agent result envelopes) and returns complete wave state
- confirm reducer has no side effects
- confirm contradiction entities have a proper state machine: detected → acknowledged → repair_in_progress → resolved | waived
- confirm fact IDs use stable semantic identity with separate contentHash, NOT pure content-addressable hashing
- confirm gate engine blocks closure on unresolved contradictions
- confirm replay tests feed stored events through the reducer and assert on output
- do not PASS if the reducer reads from any derived cache

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-4-cont-qa.md
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
- docs-shared-plan

### Prompt

```text
Synthesize the reducer, contradiction entities, and evidence lineage changes.

Required context before coding:
- Read docs/plans/end-state-architecture.md.
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

Verify:
- reducer output matches live state produced by the phase engines
- contradiction entities integrate cleanly with the integration summary
- fact lineage connects: introduction → citation → contradiction → supersession → closure decision
- replay tests cover at least: normal completion, gate failure, retry, contradiction repair, human input timeout
- no circular dependency between reducer and any phase engine

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-4.md
- .tmp/main-wave-launcher/integration/wave-4.json
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
Update shared plan docs to reflect the reducer, contradiction entities, and evidence lineage.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/plans/wave-orchestrator.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
- docs/reference/proof-metrics.md
```

## Agent A1: Wave State Reducer

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "Pure function reducers, event sourcing projection, deterministic state rebuild"

### Components

- state-artifacts-and-feedback

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/wave-state-reducer.mjs
- test/wave-orchestrator/wave-state-reducer.test.ts

### Proof artifacts

- path: .tmp/wave-4-state-proof/reducer-replay-summary.json | kind: replay-summary | required-for: pilot-live

### Prompt

```text
Implement the wave state reducer as a pure function.

The reducer consumes the canonical authority set:
- control-plane events (lifecycle, proof, gates, tasks, contradictions, facts)
- coordination records (requests, blockers, handoffs, clarifications, human feedback)
- agent result envelopes (structured results per attempt)

And returns complete wave state:
  reduce(controlPlaneEvents, coordinationRecords, agentResultEnvelopes) → {
    waveState, attempt, tasks (Map), taskGraph (DAG),
    proofAvailability (Map), contradictions (Map), facts (Map),
    openBlockers, gateVerdicts (Map), retryTargetSet,
    closureEligibility: { allSlicesProven, closureReady, blockedReasons },
    humanInputs (Map), assignments (Map), dependencies (Map),
    coordinationMetrics
  }

Design rules:
1. Pure function — no side effects, no file reads, no fs writes.
2. All inputs are passed in, not read from disk.
3. Deterministic — same inputs always produce same output.
4. The launcher calls reduce() at each phase boundary.
5. Replay tests feed stored events through reduce() and assert.

Write comprehensive replay tests:
- Normal wave completion
- Gate failure and retry
- Shared-component sibling wait
- Contradiction detection and repair
- Human input timeout and escalation
- Proof bundle supersession
- Multi-attempt with executor fallback

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Wave State Reducer).
- Read scripts/wave-orchestrator/control-plane.mjs (event shape).
- Read scripts/wave-orchestrator/coordination-store.mjs (record shape).
- Read scripts/wave-orchestrator/task-entity.mjs (task graph shape from Wave 2).

File ownership (only touch these paths):
- scripts/wave-orchestrator/wave-state-reducer.mjs
- test/wave-orchestrator/wave-state-reducer.test.ts
- .tmp/wave-4-state-proof/
```

## Agent A2: Contradiction Entity

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

- scripts/wave-orchestrator/contradiction-entity.mjs
- test/wave-orchestrator/contradiction-entity.test.ts

### Proof artifacts

- path: .tmp/wave-4-state-proof/contradiction-lifecycle.json | kind: contradiction-log | required-for: pilot-live

### Prompt

```text
Implement the contradiction entity as a first-class control-plane type.

Contradiction schema:
  {
    contradictionId:   string,       // stable id, not content-addressed
    waveNumber:        number,
    lane:              string,
    kind:              "proof_conflict" | "integration_conflict" | "claim_conflict" |
                       "evidence_conflict" | "component_conflict",
    status:            "detected" | "acknowledged" | "repair_in_progress" |
                       "resolved" | "waived",
    reportedBy:        string,
    reportedAt:        ISO8601,
    resolvedBy:        string | null,
    resolvedAt:        ISO8601 | null,
    parties:           [{ agentId, claim, evidence }],
    affectedTasks:     [taskId],
    affectedFacts:     [factId],
    repairWork:        [{ taskId, status }] | null,
    resolution:        { kind, detail, evidence } | null,
    supersedes:        contradictionId | null
  }

Implementation:
1. Add contradiction entity type to control-plane schema.
2. Add appendContradictionEvent to control-plane.mjs.
3. Add materializeContradictions to the reducer.
4. Update gate engine to block closure on unresolved material contradictions.
5. Update integration summary to reference active contradictions by id.
6. Write tests for the full contradiction lifecycle.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Entity Model — Contradiction).
- Read docs/reference/proof-metrics.md (section: Current Limits).
- Read scripts/wave-orchestrator/wave-control-schema.mjs.
- Read scripts/wave-orchestrator/control-plane.mjs.

File ownership (only touch these paths):
- scripts/wave-orchestrator/contradiction-entity.mjs
- scripts/wave-orchestrator/wave-control-schema.mjs
- scripts/wave-orchestrator/control-plane.mjs
- scripts/wave-orchestrator/launcher-gates.mjs
- test/wave-orchestrator/contradiction-entity.test.ts
- .tmp/wave-4-state-proof/
```

## Agent A3: Stable Fact and Evidence Lineage

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

- scripts/wave-orchestrator/fact-entity.mjs
- test/wave-orchestrator/fact-entity.test.ts

### Proof artifacts

- path: .tmp/wave-4-state-proof/fact-lineage-report.json | kind: lineage-report | required-for: pilot-live

### Prompt

```text
Implement stable fact identifiers and evidence lineage.

Fact identity is NOT purely content-addressable. Facts carry:
- factId:        stable semantic identifier (survives refinement, normalization, supersession)
- contentHash:   SHA256 of canonical statement (useful for dedup, but not the identity)
- version:       increments when content is refined
- supersedes:    factId of prior version
- status:        "active" | "superseded" | "retracted"

Fact schema:
  {
    factId:            string,
    contentHash:       string,
    version:           number,
    waveNumber:        number,
    lane:              string,
    introducedBy:      string,
    introducedAt:      ISO8601,
    kind:              "claim" | "proof" | "observation" | "decision" | "evidence",
    content:           string,
    sourceArtifact:    { path, kind, sha256 } | null,
    citedBy:           [{ entityType, entityId, context }],
    contradictedBy:    [contradictionId],
    supersedes:        factId | null,
    supersededBy:      factId | null,
    status:            "active" | "superseded" | "retracted"
  }

The system should be able to answer:
- what fact was introduced
- where it was cited
- what contradicted it
- what superseded it
- which closure decision depended on it

Implementation:
1. Add fact entity type to control-plane schema.
2. Implement fact lifecycle in fact-entity.mjs.
3. Link facts to contradictions via affectedFacts.
4. Link facts to proof bundles and gate decisions via citedBy.
5. Add fact materialization to the reducer.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Entity Model — Fact/Evidence).
- Read docs/reference/proof-metrics.md (section: Current Limits re stable fact ids).
- Read scripts/wave-orchestrator/wave-control-schema.mjs.

File ownership (only touch these paths):
- scripts/wave-orchestrator/fact-entity.mjs
- scripts/wave-orchestrator/wave-control-schema.mjs
- scripts/wave-orchestrator/control-plane.mjs
- test/wave-orchestrator/fact-entity.test.ts
- .tmp/wave-4-state-proof/
```
