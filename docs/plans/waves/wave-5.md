# Wave 5 - Schema Versioning, Artifact Hierarchy, and Human Input Workflow

**Commit message**: `Arch: harden schema versioning, artifact classification, and human input workflow`

## Component promotions

- state-artifacts-and-feedback: qa-proved

## Context7 defaults

- bundle: node-typescript
- query: "JSON schema migration, artifact metadata, workflow state machines, SLA tracking in Node.js"

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
- Verify schema versioning is explicit on all derived-state schemas, artifact classes are labeled, and human input workflow semantics are in the control plane — not the supervisor.

Required context before coding:
- Read docs/plans/end-state-architecture.md (sections: Schema Versioning, Artifact Hierarchy, Human Input Workflow).
- Read docs/reference/repository-guidance.md.

Specific expectations:
- confirm every persisted artifact carries _meta.artifactClass
- confirm every derived-state schema carries schemaVersion
- confirm readers tolerate unknown fields (forward compatibility)
- confirm human input SLA, reroute, escalation, and timeout semantics live in control-plane events and the reducer, NOT in the supervisor
- confirm the supervisor only observes/collects/submits human-input responses
- do not PASS if any derived cache is missing _meta or schemaVersion

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-5-cont-qa.md
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
Synthesize schema versioning, artifact hierarchy, and human input workflow changes.

Required context before coding:
- Read docs/plans/end-state-architecture.md.
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

Verify:
- schema migration functions exist for all version transitions
- artifact classes are consistent between the hierarchy doc and actual file writes
- human input workflow integrates with existing clarification triage and escalation paths
- no regression in existing coordination flows

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-5.md
- .tmp/main-wave-launcher/integration/wave-5.json
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
Update shared plan docs to reflect schema versioning, artifact classification, and human input workflow.

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
- docs/reference/wave-control.md
```

## Agent A1: Schema Versioning and Artifact Classification

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "JSON schema migration, semver, forward compatibility patterns"

### Components

- state-artifacts-and-feedback

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/schema-versioning.mjs
- test/wave-orchestrator/schema-versioning.test.ts

### Proof artifacts

- path: .tmp/wave-5-state-proof/schema-migration-report.json | kind: migration-report | required-for: pilot-live

### Prompt

```text
Add explicit schema versioning to all derived-state schemas and artifact class labels to all persisted artifacts.

Schema versioning rules:
1. Forward compatibility: readers tolerate unknown fields.
2. Version-gated migration: materializer runs migration function when version advances.
3. Every schema file declares schemaVersion: N.

Every persisted artifact includes _meta:
  {
    "_meta": {
      "artifactClass": "canonical-event" | "canonical-snapshot" | "derived-cache" | "human-projection",
      "schemaVersion": N,
      "generatedAt": ISO8601,
      "source": "description of canonical input"
    }
  }

Artifact class definitions:
- canonical-event: append-only, never rewritten (control-plane JSONL, coordination JSONL)
- canonical-snapshot: written once per event, immutable, attempt-scoped paths
- derived-cache: materialized from canonical sources, can be deleted and rebuilt
- human-projection: convenience output, never read by the system

Schemas requiring versioning (add migration functions):
- Agent result envelope (v2)
- Gate snapshot (v2)
- Task graph (v1)
- Integration summary (v2)
- Retry plan (v2)
- Proof registry (v2)
- Relaunch plan (v2)
- Run state (v3)
- Trace bundle (v3)
- Control-plane event (v2)
- Coordination record (v2)
- Contradiction (v1)
- Fact (v1)
- Wave manifest (v2)
- Dashboard (v2)
- Assignment snapshot (v1)
- Dependency snapshot (v1)
- Ledger (v1)
- Docs queue (v1)
- Security summary (v1)

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (sections: Schema Versioning, Artifact Hierarchy).
- Read scripts/wave-orchestrator/artifact-schemas.mjs.
- Read scripts/wave-orchestrator/dashboard-state.mjs.

File ownership (only touch these paths):
- scripts/wave-orchestrator/schema-versioning.mjs
- scripts/wave-orchestrator/artifact-schemas.mjs
- test/wave-orchestrator/schema-versioning.test.ts
- .tmp/wave-5-state-proof/
```

## Agent A2: Human Input Workflow Subsystem

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "Workflow state machines, SLA tracking, timeout policies in event-sourced systems"

### Components

- state-artifacts-and-feedback

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: none

### Deliverables

- scripts/wave-orchestrator/human-input-workflow.mjs
- test/wave-orchestrator/human-input-workflow.test.ts

### Proof artifacts

- path: .tmp/wave-5-state-proof/human-input-sla-log.json | kind: workflow-log | required-for: pilot-live

### Prompt

```text
Implement the human input workflow subsystem.

Key design rule: human-input workflow semantics (SLA, reroute, escalation, timeout, closure blocking) live in:
- control-plane events
- reducer state
- this workflow module

The session supervisor only observes, collects, and submits responses. It does NOT own SLA or escalation logic.

Human input entity (extended from existing):
  {
    requestId, waveNumber, lane,
    kind:              "clarification" | "escalation" | "approval" | "decision",
    status:            "pending" | "assigned" | "answered" | "escalated" | "resolved" | "timed_out" | "rerouted",
    requestedBy, requestedAt,
    assignedTo:        string | null,
    assignedAt:        ISO8601 | null,
    answeredAt:        ISO8601 | null,
    resolvedAt:        ISO8601 | null,
    timeoutPolicy: {
      ackDeadlineMs, resolveDeadlineMs, escalateAfterMs
    },
    reroutePolicy: {
      maxReroutes, rerouteHistory: [{ from, to, reason, at }]
    },
    linkedRequests:    [requestId],
    closureCondition:  string | null,
    slaMetrics: {
      timeToAck, timeToResolve, wasEscalated, wasRerouted, wasTimedOut
    }
  }

Implementation:
1. Add human-input workflow logic to human-input-workflow.mjs.
2. Workflow state transitions go to control-plane events.
3. The reducer materializes human input state from events.
4. The closure engine treats unresolved human inputs as hard blockers.
5. The retry engine can plan around timed-out requests by escalating or rerouting.
6. SLA metrics are computed by the reducer, not by the supervisor.
7. Integrate with existing clarification-triage.mjs for backward compatibility.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Human Input Workflow).
- Read scripts/wave-orchestrator/clarification-triage.mjs.
- Read scripts/wave-orchestrator/feedback.mjs.
- Read scripts/wave-orchestrator/launcher-supervisor.mjs (human feedback monitoring to keep but not expand).

File ownership (only touch these paths):
- scripts/wave-orchestrator/human-input-workflow.mjs
- scripts/wave-orchestrator/clarification-triage.mjs
- test/wave-orchestrator/human-input-workflow.test.ts
- .tmp/wave-5-state-proof/
```

## Agent A3: Projection Writer

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

- scripts/wave-orchestrator/projection-writer.mjs
- test/wave-orchestrator/projection-writer.test.ts

### Proof artifacts

- path: .tmp/wave-5-state-proof/projection-artifact-manifest.json | kind: artifact-manifest | required-for: pilot-live

### Prompt

```text
Implement the projection writer — the single module responsible for all non-canonical file writes.

The projection writer takes derived state from the materializer, gate verdicts from the gate engine, and wave state from the reducer, and writes:
- dashboards (global + per-wave) — artifactClass: human-projection
- markdown board projections — artifactClass: human-projection
- coordination board projection — artifactClass: human-projection
- trace bundles — artifactClass: canonical-snapshot
- quality metrics — artifactClass: derived-cache
- human-facing status summaries — artifactClass: human-projection
- wave manifest — artifactClass: human-projection

Rules:
1. Never reads its own outputs.
2. Always writes atomically (writeJsonAtomic / writeTextAtomic).
3. Labels every artifact with _meta including artifactClass and schemaVersion.
4. Consolidates dashboard writes currently scattered across launcher.mjs and dashboard-state.mjs.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (sections: Layer 3, Artifact Hierarchy).
- Read scripts/wave-orchestrator/dashboard-state.mjs (current dashboard writes to consolidate).
- Read scripts/wave-orchestrator/traces.mjs (trace bundle writes).

File ownership (only touch these paths):
- scripts/wave-orchestrator/projection-writer.mjs
- test/wave-orchestrator/projection-writer.test.ts
- .tmp/wave-5-state-proof/
```
