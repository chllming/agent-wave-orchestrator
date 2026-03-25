# End-State Architecture

This document describes the canonical architecture for the current Wave runtime. It is the authoritative reference for the engine boundaries, canonical authority set, and artifact ownership model that the shipped `0.8.6` surface now follows.

The thesis is unchanged: bounded waves, closure roles, proof artifacts, selective rerun, and delivery discipline. What changes is the internal authority model. The launcher stops being the decision engine and becomes a thin orchestrator that reads decisions from canonical state, sequences the engines, and delegates process work to the session supervisor.

---

## Design Principles

1. **Canonical authority set, not a single event log.** The system has three canonical sources: wave definitions (authoritative declarations), the coordination log (authoritative conversational/workflow state), and the control-plane event log (authoritative lifecycle/proof/run state). All summaries, dashboards, caches, and markdown are projections over this authority set — never read back as decision inputs.

2. **Phase engines replace the monolithic launcher loop.** Each distinct concern — implementation orchestration, derived-state materialization, gate evaluation, retry planning, closure sequencing, session supervision — lives in its own deterministic module with an explicit input/output contract.

3. **Planning engines emit intent; the supervisor emits observed facts.** A phase engine may output a run selection or launch request. Only the session supervisor, after the process actually launches, writes `agent_run.started`. This distinction between desired action and observed action is critical for replay and auditability.

4. **Proof and closure are separate first-class states.** An agent can satisfy its own work contract (`owned_slice_proven`) without the wave being closeable (`wave_closure_ready`). These are distinct top-level state transitions, not implicit conditions scattered across gate checks.

5. **Tasks are first-class entities under the wave.** A wave is a bounded task graph with ownership, leases, artifact contracts, and dependency edges — not a set of agent sessions plus inferred coordination state. Tasks and coordination records have a crisp boundary: a task is a durable work unit with ownership, artifact contract, proof rules, and closure semantics; a coordination record is an event or message about a task, dependency, contradiction, or human-input workflow.

6. **Retry is a dedicated deterministic subsystem.** Resumability logic is isolated behind a strict contract, testable from stored state without launching anything.

7. **Structured result envelopes replace log parsing.** Closure decisions rely on typed agent result contracts with a common header and role-specific typed payloads, not text markers extracted from log tails or one universal blob.

8. **One strict artifact hierarchy.** Every persisted artifact has an explicit class label — canonical event, canonical snapshot, derived cache, or human-facing projection — so operators always know what is source-of-truth versus convenience output. Canonical snapshots are immutable and attempt-scoped.

9. **Schema versioning is explicit everywhere.** Every derived-state schema carries a version number and the system supports forward migration.

10. **Replay is a first-class operation.** A single reducer path can rebuild full wave state from the canonical authority set (control-plane events, coordination records, and structured result envelopes), enabling deterministic replay tests and regression testing for orchestration behavior.

11. **Human-input workflow semantics live in the control plane and reducer, not the supervisor.** The supervisor observes, collects, and submits human-input responses. SLA policy, reroute logic, escalation, timeout, and closure blocking are control-plane events materialized by the reducer.

12. **The system stays opinionated about repo work.** Wave is not a general-purpose agent platform. It is a bounded-wave coding orchestrator with closure discipline and delivery proof.

---

## Canonical Authority Set

The system uses **Model B: canonical authority set**, not a single event log. This is an explicit design choice.

| Source | Kind | Authority Over |
|--------|------|----------------|
| Wave definitions (`docs/plans/waves/`) | Parsed declarations, read-only after parse | Goals, agent roles, component promotions, exit contracts, proof artifact requirements, eval targets, skill bindings |
| Control-plane event log (`.tmp/<lane>-wave-launcher/control-plane/wave-<N>.jsonl`) | Append-only JSONL | Lifecycle state: tasks, attempts, proof bundles, rerun requests, gates, contradictions, facts, human inputs, wave runs, agent runs, signal updates, artifacts, benchmarks, verifications, reviews |
| Coordination log (`.tmp/<lane>-wave-launcher/coordination/wave-<N>.jsonl`) | Append-only JSONL | Conversational/workflow state: requests, acks, claims, evidence, decisions, blockers, handoffs, clarifications, human feedback, escalations, orchestrator guidance, integration summaries |

**Everything else is a projection.** Shared summaries, dashboards, inboxes, signal snapshots, proof registries, retry overrides, relaunch plans, assignment snapshots, dependency snapshots, ledgers, docs queues, security summaries, integration summaries, markdown boards, and trace bundles are all derived from these three canonical sources plus immutable agent result envelopes.

The reducer consumes all three canonical sources plus result envelopes to rebuild state. No other input is read for decision-making.

Optional design packets live in repo-owned docs, usually under `docs/plans/waves/design/`. They are not canonical runtime state by themselves, but the validated packet path and final `design` result are captured in summaries, envelopes, reducer state, and traces.

---

## Module Architecture

### Layer 1 — Canonical State

These modules own the authoritative state. Nothing else writes to these stores.

```
control-plane.mjs          Append-only JSONL event log
                           All entity lifecycle: task, proof_bundle, rerun_request,
                           attempt, human_input, wave_run, agent_run, gate,
                           artifact, contradiction, fact,
                           benchmark_run, benchmark_item, verification, review

coordination-store.mjs     Append-only JSONL coordination log
                           Record kinds: request, ack, claim, evidence, decision,
                           blocker, handoff, clarification-request, human-feedback,
                           human-escalation, orchestrator-guidance, integration-summary,
                           resolved-by-policy

wave-files.mjs             Parsed wave definitions (read-only after parse)
                           Component declarations, exit contracts, proof artifact
                           requirements, eval targets, skill bindings, task declarations
```

### Layer 2 — Phase Engines

Each phase engine is a pure-ish function: it reads from the canonical authority set and emits decisions or state transitions. Phase engines do not launch processes, write dashboards, or interact with terminals.

**Critical rule:** planning engines emit intent (what should happen). Only the session supervisor emits observed lifecycle events (what did happen). This distinction is enforced everywhere.

```
implementation-engine.mjs  Drives the implementation phase
                           Inputs:  wave definition, materialized event state,
                                    task graph, retry plan
                           Outputs: run selections, launch requests,
                                    executor assignments,
                                    prompt construction requests
                           Rule:    optional design workers run before
                                    code-owning implementation workers
                           Does NOT output: agent_run.started, attempt.running
                           (those are observed facts written by the supervisor)

derived-state-engine.mjs   Computes all derived state from canonical sources
                           Inputs:  coordination log, control-plane events,
                                    agent result envelopes
                           Outputs: derived payloads for shared summaries,
                                    per-agent inboxes, assignment snapshots,
                                    dependency snapshots, ledger, docs queue,
                                    security summary, integration summary
                           Rule:    reads only from canonical authority set,
                                    never from its own prior outputs and
                                    never persists projections directly

gate-engine.mjs            Evaluates all closure gates
                           Inputs:  agent result envelopes, proof registry,
                                    coordination state, component matrix,
                                    task graph
                           Outputs: per-gate verdicts (ok/blocked + detail),
                                    per-task owned_slice_proven verdicts
                           Does NOT write: gate events to control-plane
                           (the caller writes gate events after receiving verdicts)
                           Gates:   design, implementation-proof, cont-eval, security,
                                    integration, documentation, cont-qa,
                                    component-matrix, assignment-barrier,
                                    dependency-barrier, clarification-barrier

closure-engine.mjs         Sequences the closure sweep
                           Inputs:  gate verdicts, wave definition, task graph
                           Outputs: closure phase transitions, agent relaunch
                                    requests, wave completion or block events
                           Stages:  implementation+proof → cont-eval → security →
                                    integration → documentation → cont-qa

retry-engine.mjs           Plans all retry and resume operations
                           Inputs:  failure records, proof registry, rerun
                                    requests, executor history, task graph
                           Outputs: retry plan with explicit contract:
                                    - why_resuming
                                    - invalidated (task ids)
                                    - reusable_proof (bundle ids)
                                    - resume_from_stage
                                    - executor_changes
                                    - human_inputs_blocking
                           Rule:    deterministic and testable from stored
                                    state without launching anything

wave-state-reducer.mjs     Rebuilds full wave state from canonical authority set
  (new)                    Inputs:  control-plane events, coordination records,
                                    agent result envelopes
                           Outputs: current wave state, open blockers,
                                    proof availability, retry target set,
                                    closure eligibility, task graph snapshot
                           Rule:    pure function, no side effects,
                                    used for replay, regression tests,
                                    and live state queries
```

### Layer 3 — Session Supervisor and Projection Writer

The supervisor is the only module that interacts with the outside world: launching processes, managing terminals, and monitoring sessions. It reads decisions from phase engines and executes them. It is the only module that writes observed lifecycle events.

`projection-writer.mjs` owns the operator-facing projection writes family: dashboards, traces, summaries, inboxes, ledgers, docs queues, board projections, and assignment or dependency snapshots. `signals.mjs` owns the separate versioned signal projections used by long-running agents and operator wrappers. Workflow-owned compatibility state, clarification triage, and canonical coordination/control-plane mutations stay in their own modules.

```
session-supervisor.mjs     Launches and monitors agent sessions
                           Inputs:  run selections / launch requests from
                                    implementation engine and closure engine,
                                    launch specs from executor adapters
                           Owns:    process lifecycle, tmux sessions,
                                    terminal surfaces, PID tracking,
                                    lock management, rate-limit retry loops,
                                    resident orchestrator sessions
                           Writes:  wave_run.started|completed|failed,
                                    attempt.running|completed|failed,
                                    agent_run.started|completed|failed|timed_out
                           Observes: human feedback responses (collects and
                                    submits, but does NOT own SLA, reroute,
                                    escalation, or timeout policy — those
                                    are control-plane workflow semantics
                                    materialized by the reducer)

projection-writer.mjs      Writes projection outputs
  (new)                    Inputs:  derived state from materializer,
                                    gate verdicts from gate engine,
                                    wave state from reducer
                           Outputs: dashboards (global + per-wave),
                                    markdown board projections,
                                    coordination board projection,
                                    trace bundles, quality metrics,
                                    shared summaries, inboxes, assignment
                                    and dependency snapshots, ledger,
                                    docs queue, security summary,
                                    integration summary
                           Rule:    never reads its own outputs,
                                    always writes atomically,
                                    labels every artifact with its class

signals.mjs                Writes versioned signal projections
                           Inputs:  materialized control status for a wave,
                                    logical-agent state, feedback state
                           Outputs: wave-level signal snapshot,
                                    per-agent signal snapshots,
                                    resident-orchestrator signal snapshot
                           Rule:    versions snapshots only when the normalized
                                    wake payload changes and tracks ack state
                                    for long-running watcher loops
```

### Layer 4 — Launcher Orchestrator

The top-level launcher is now a thin orchestrator that wires the phase engines together in the correct order. It owns the wave-level control flow but delegates all decisions.

```
launcher.mjs               Thin orchestrator
                           1. Parse args, acquire lock
                           2. Parse wave files, build manifest
                           3. For each wave:
                              a. reducer.rebuild() → current state
                              b. retry-engine.plan() → retry decisions
                              c. implementation-engine.select() → run selections
                                 (design-first when the wave declares design workers)
                              d. derived-state-engine.materialize() → derived payloads
                              e. supervisor.launch(run selections) → agent sessions
                                 (supervisor writes agent_run.started)
                              f. supervisor.wait() → completion
                                 (supervisor writes agent_run.completed)
                              g. gate-engine.evaluate() → gate verdicts
                              h. closure-engine.sequence() → closure phases
                              i. projection-writer.write() → persisted projections
                           4. Release lock, exit
```

---

## Entity Model

### Task vs Coordination Record — The Boundary

This boundary is enforced everywhere:

- **Task** = durable work unit with ownership, artifact contract, proof rules, and closure semantics. Tasks have identity, lifecycle, and deliverables. A task can be `pending`, `in_progress`, `proven`, `blocked`, or `completed`.

- **Coordination record** = event or message about a task, dependency, contradiction, or human-input workflow. Coordination records are conversational artifacts: requests, acks, claims, evidence, decisions, blockers, handoffs, clarifications. They reference tasks by `taskId` but do not own deliverables or proof.

Tasks and coordination records do not overlap. If something has an artifact contract and closure semantics, it is a task. If it is a message or event about work, it is a coordination record.

### Existing Entities (retained, tightened)

| Entity | Authority | State Machine |
|--------|-----------|---------------|
| `wave_run` | control-plane | `planned → running → completed \| failed \| blocked` |
| `agent_run` | control-plane | `planned → started → completed \| failed \| timed_out \| cancelled` |
| `attempt` | control-plane | `planned → running → completed \| failed \| cancelled` |
| `proof_bundle` | control-plane | `active → superseded \| revoked` |
| `rerun_request` | control-plane | `active → applied \| cleared` |
| `human_input` | control-plane | `pending → assigned → answered \| escalated \| resolved \| timed_out \| rerouted` |
| `gate` | control-plane | `pending → passed \| blocked \| waived` |
| `coordination_record` | coordination log | `open → acknowledged → in_progress → resolved \| closed \| superseded \| cancelled` |
| `artifact` | control-plane | `declared → materialized \| missing` |
| `benchmark_run` | control-plane | `running → completed \| failed` |
| `benchmark_item` | control-plane | `running → completed \| failed \| skipped` |
| `verification` | control-plane | `pending → passed \| failed` |
| `review` | control-plane | `pending → accepted \| rejected \| deferred` |

Note: `agent_run` now has `planned → started` to distinguish intent (emitted by implementation engine) from observation (emitted by supervisor).

### New Entities

#### Task (P0-4)

A first-class unit of work under a wave. Waves become bounded task graphs.

Task identity uses a **stable semantic identifier**, not a content hash. This avoids identity churn when scope, proof requirements, or dependencies change during reruns or helper assignments.

```
task {
  taskId:            string        // stable semantic id, e.g. "wave-1:A1:wave-parser-and-launcher"
  version:           number        // increments on definition change
  contentHash:       string        // SHA256 of current definition (for change detection, not identity)
  waveNumber:        number
  lane:              string
  owningAgentId:     string        // agent that owns the deliverable
  assigneeAgentId:   string        // agent currently working on it
  leaseState:        "unleased" | "leased" | "released" | "expired"
  leaseExpiresAt:    ISO8601 | null
  artifactContract: {
    deliverables:    [{ path, exists, sha256 }]
    proofArtifacts:  [{ path, kind, requiredFor }]
    exitContract:    { completion, durability, proof, docImpact }
  }
  proofRequirements: {
    proofLevel:      "unit" | "integration" | "live"
    proofCentric:    boolean
    maturityTarget:  string | null
  }
  dependencyEdges:   [{ taskId, kind, status }]
  closureState:      "open" | "owned_slice_proven" | "wave_closure_ready" | "closed"
  components:        [{ componentId, targetLevel }]
  status:            "pending" | "in_progress" | "proven" | "blocked" | "completed"
  createdAt:         ISO8601
  updatedAt:         ISO8601
}
```

Task lifecycle events are recorded in the control-plane log. The task graph is materialized by the reducer.

#### Contradiction (P2-13)

A normalized entity for conflicts between agents, proof claims, or integration state.

```
contradiction {
  contradictionId:   string        // stable id, not content-addressed
  waveNumber:        number
  lane:              string
  kind:              "proof_conflict" | "integration_conflict" | "claim_conflict" |
                     "evidence_conflict" | "component_conflict"
  status:            "detected" | "acknowledged" | "repair_in_progress" |
                     "resolved" | "waived"
  reportedBy:        string        // agentId or "system"
  reportedAt:        ISO8601
  resolvedBy:        string | null
  resolvedAt:        ISO8601 | null
  parties:           [{ agentId, claim, evidence }]
  affectedTasks:     [taskId]
  affectedFacts:     [factId]
  repairWork:        [{ taskId, status }] | null
  resolution:        { kind, detail, evidence } | null
  supersedes:        contradictionId | null
}
```

Contradiction events are appended to the control-plane log. The gate engine blocks closure while material contradictions remain unresolved. The integration summary references active contradictions by id.

#### Fact / Evidence (P2-14)

Stable identifiers for evidence lineage.

Fact identity is **not purely content-addressable**. Facts carry a stable semantic `factId` that survives refinement, normalization, and supersession, plus a separate `contentHash` for deduplication and change detection.

```
fact {
  factId:            string        // stable semantic identifier
  contentHash:       string        // SHA256 of canonical statement (for dedup, not identity)
  version:           number        // increments when content is refined
  waveNumber:        number
  lane:              string
  introducedBy:      string        // agentId
  introducedAt:      ISO8601
  kind:              "claim" | "proof" | "observation" | "decision" | "evidence"
  content:           string        // canonical statement
  sourceArtifact:    { path, kind, sha256 } | null
  citedBy:           [{ entityType, entityId, context }]
  contradictedBy:    [contradictionId]
  supersedes:        factId | null
  supersededBy:      factId | null
  status:            "active" | "superseded" | "retracted"
}
```

Facts give the system stable handles for answering: what was introduced, where was it cited, what contradicted it, what superseded it, and which closure decision depended on it.

---

## Two-Phase Proof Model (P0-3)

The current implicit separation between "agent finished its work" and "wave can close" becomes two explicit top-level states.

### `owned_slice_proven`

An agent's own deliverables satisfy its exit contract. This is evaluated per-task:

- deliverables exist on disk
- proof markers meet or exceed the declared contract
- proof artifacts (if declared) are present and SHA256-valid
- doc-delta is declared if the contract requires it
- component promotions meet the target maturity level
- no open self-owned blockers

This state is set by the gate engine after reading the agent result envelope. It does not require any other agent to be finished.

### `wave_closure_ready`

All tasks in the wave are `owned_slice_proven` AND all cross-cutting closure conditions are satisfied:

- no unresolved contradictions
- no open clarification barriers
- no open helper assignment barriers
- no open cross-lane dependency barriers
- integration gate passed (effective integration steward; starter default `A8`)
- documentation gate passed (effective documentation steward; starter default `A9`)
- cont-eval gate passed (effective `cont-EVAL`; starter default `E0`) if applicable
- security gate passed if applicable
- cont-qa final verdict is PASS (effective `cont-QA`; starter default `A0`)
- component matrix promotions validated

Only when `wave_closure_ready` is true does the closure engine emit the `wave_run.completed` event.

### Rerun implications

The retry engine uses this split directly:

- If an agent's slice fails: only that agent and its downstream task dependents need rerun
- If closure gates fail but agent slices are proven: only the failing closure agent reruns; implementation proof is reused
- If a contradiction invalidates proof: the retry engine marks affected tasks for re-proof while preserving unaffected proof bundles

---

## Agent Result Envelope (P1-6)

Agents emit a structured JSON result file alongside their log. Closure reads from this envelope, not from log-tail parsing.

The envelope is **not one universal blob**. It uses a common header with role-specific typed optional payloads. Roles that do not apply leave their section absent, not null-filled.

### Common envelope header (all roles)

```
agent_result_envelope {
  schemaVersion:     2
  agentId:           string
  waveNumber:        number
  attempt:           number
  completedAt:       ISO8601
  exitCode:          number
  role:              "implementation" | "integration" | "documentation" |
                     "cont-qa" | "cont-eval" | "security" | "deploy"

  // Common sections (all roles)
  proof: {
    state:           "satisfied" | "partial" | "failed" | "not_applicable"
    completion:      "contract" | "integrated" | "authoritative" | "live"
    durability:      "none" | "ephemeral" | "durable"
    proofLevel:      "unit" | "integration" | "live"
    detail:          string
  }
  deliverables:      [{ path, exists, sha256 }]
  proofArtifacts:    [{ path, kind, exists, sha256, requiredFor }]
  gaps:              [{ kind, detail }]
  unresolvedBlockers:[{ kind, detail, blocking }]
  riskNotes:         [string]
  facts:             [{ factId, kind, content }]
}
```

### Role-specific typed payloads (optional, present only when applicable)

```
// role: "implementation"
implementation: {
  docDelta: {
    state:           "none" | "owned" | "shared-plan"
    paths:           [string]
    detail:          string
  }
  components:        [{ componentId, level, state, detail }]
}

// role: "integration"
integration: {
  state:             "clean" | "claims_pending" | "conflicts_detected" | "blocked"
  claims:            number
  conflicts:         number
  blockers:          number
  detail:            string
}

// role: "documentation"
documentation: {
  docClosure: {
    state:           "closed" | "no-change" | "delta"
    paths:           [string]
    detail:          string
  }
}

// role: "cont-qa"
contQa: {
  verdict: {
    verdict:         "pass" | "concerns" | "blocked"
    detail:          string
  }
  gateClaims: {
    architecture:    "pass" | "concern" | "blocked" | null
    integration:     "pass" | "concern" | "blocked" | null
    durability:      "pass" | "concern" | "blocked" | null
    live:            "pass" | "concern" | "blocked" | null
    docs:            "pass" | "concern" | "blocked" | null
  }
}

// role: "cont-eval"
contEval: {
  state:             "passed" | "partial" | "failed" | "not_applicable"
  targets:           number
  benchmarks:        number
  regressions:       number
  targetIds:         [string]
  benchmarkIds:      [string]
  detail:            string
}

// role: "security"
security: {
  state:             "clean" | "findings" | "blocked"
  findings:          number
  approvals:         number
  detail:            string
}

// role: "deploy"
deploy: {
  state:             "succeeded" | "failed" | "not_applicable"
  environment:       string
  healthCheck:       { passed, detail } | null
  rolloutArtifact:   { path, exists, sha256 } | null
  detail:            string
}
```

### Canonical snapshot path (attempt-scoped)

Agent result envelopes are classified as canonical structured snapshots and must be immutable after write. To support reruns without overwriting, the path is attempt-scoped:

```
.tmp/<lane>-wave-launcher/results/wave-<N>/attempt-<A>/<agentId>.json
```

### Current runtime behavior

- Live runs read and write the attempt-scoped canonical envelope path directly.
- Legacy sibling `*.envelope.json` files and marker-era artifacts are compatibility import inputs for replay, reconcile, and historical trace materialization only.
- `synthesizeLegacyEnvelope()` remains explicit migration-only compatibility code; live gate, retry, closure, and reducer decisions do not use it as a correctness path.

---

## Artifact Hierarchy (P1-7)

Every persisted artifact carries an explicit class label.

### Class 1 — Canonical Event Streams

Append-only, never rewritten, never read as cached state.

| Artifact | Path | Format |
|----------|------|--------|
| Control-plane log | `.tmp/<lane>-wave-launcher/control-plane/wave-<N>.jsonl` | JSONL |
| Coordination log | `.tmp/<lane>-wave-launcher/coordination/wave-<N>.jsonl` | JSONL |
| Cross-lane dependency log | `.tmp/wave-orchestrator/dependencies/<ticket-id>.json` | JSON |

### Class 2 — Canonical Structured Snapshots

Written once per event, immutable after write, attempt-scoped paths. Used for replay and audit.

| Artifact | Path | Format |
|----------|------|--------|
| Agent result envelope | `.tmp/<lane>-wave-launcher/results/wave-<N>/attempt-<A>/<agentId>.json` | JSON |
| Trace outcome | `.tmp/<lane>-wave-launcher/traces/wave-<N>/attempt-<A>/outcome.json` | JSON |
| Run metadata | `.tmp/<lane>-wave-launcher/traces/wave-<N>/attempt-<A>/run-metadata.json` | JSON |
| Gate snapshot | `.tmp/<lane>-wave-launcher/traces/wave-<N>/attempt-<A>/gate-snapshot.json` | JSON |

### Class 3 — Derived Caches

Projections materialized from Class 1 and Class 2 sources. Can be deleted and rebuilt.

| Artifact | Path | Format |
|----------|------|--------|
| Proof registry | `.tmp/<lane>-wave-launcher/proof/wave-<N>.json` | JSON |
| Retry override | `.tmp/<lane>-wave-launcher/control/retry-override-wave-<N>.json` | JSON |
| Relaunch plan | `.tmp/<lane>-wave-launcher/status/relaunch-plan-wave-<N>.json` | JSON |
| Assignment snapshot | `.tmp/<lane>-wave-launcher/assignments/wave-<N>.json` | JSON |
| Dependency snapshot | `.tmp/<lane>-wave-launcher/dependencies/wave-<N>.json` | JSON |
| Shared summary | `.tmp/<lane>-wave-launcher/inboxes/wave-<N>/shared-summary.md` | Markdown |
| Per-agent inbox | `.tmp/<lane>-wave-launcher/inboxes/wave-<N>/<agentId>.md` | Markdown |
| Ledger | `.tmp/<lane>-wave-launcher/ledger/wave-<N>.json` | JSON |
| Docs queue | `.tmp/<lane>-wave-launcher/docs-queue/wave-<N>.json` | JSON |
| Security summary JSON | `.tmp/<lane>-wave-launcher/security/wave-<N>.json` | JSON |
| Security summary markdown | `.tmp/<lane>-wave-launcher/security/wave-<N>.md` | Markdown |
| Integration summary JSON | `.tmp/<lane>-wave-launcher/integration/wave-<N>.json` | JSON |
| Integration summary markdown | `.tmp/<lane>-wave-launcher/integration/wave-<N>.md` | Markdown |
| Run state | `.tmp/<lane>-wave-launcher/run-state.json` | JSON |
| Quality metrics | `.tmp/<lane>-wave-launcher/traces/wave-<N>/attempt-<A>/quality.json` | JSON |
| Reducer snapshot | `.tmp/<lane>-wave-launcher/reducer/wave-<N>.json` | JSON |
| Wave signal snapshot | `.tmp/<lane>-wave-launcher/signals/wave-<N>.json` | JSON |
| Agent signal snapshot | `.tmp/<lane>-wave-launcher/signals/wave-<N>/<agentId>.json` | JSON |

### Class 4 — Human-Facing Projections

Convenience outputs for operator dashboards and review. Never read by the system.

| Artifact | Path | Format |
|----------|------|--------|
| Global dashboard | `.tmp/<lane>-wave-launcher/dashboards/global.json` | JSON |
| Wave dashboard | `.tmp/<lane>-wave-launcher/dashboards/wave-<N>.json` | JSON |
| Coordination board | `.tmp/<lane>-wave-launcher/messageboards/wave-<N>.md` | Markdown |
| Orchestrator board | `.tmp/wave-orchestrator/messageboards/orchestrator.md` | Markdown |
| Wave manifest | `.tmp/<lane>-wave-launcher/waves.manifest.json` | JSON |

Each artifact file includes a `_meta` field (or frontmatter for markdown) declaring:

```json
{
  "_meta": {
    "artifactClass": "canonical-event | canonical-snapshot | derived-cache | human-projection",
    "schemaVersion": 2,
    "generatedAt": "ISO8601",
    "source": "description of canonical input"
  }
}
```

---

## Schema Versioning (P1-8)

Every derived-state schema carries an explicit version. The system enforces:

1. **Forward compatibility.** Readers must tolerate unknown fields.
2. **Version-gated migration.** When a schema version advances, the materializer runs a migration function before processing.
3. **Version declaration.** Every schema file starts with `schemaVersion: N`.

Schemas that require explicit versioning:

| Schema | Current | Owner |
|--------|---------|-------|
| Agent result envelope | 2 | `result-envelope.mjs` |
| Gate snapshot | 2 | `gate-engine.mjs` |
| Task graph | 1 | `wave-state-reducer.mjs` |
| Integration summary | 2 | `derived-state-engine.mjs` |
| Security summary | 1 | `derived-state-engine.mjs` |
| Docs queue | 1 | `derived-state-engine.mjs` |
| Ledger | 1 | `derived-state-engine.mjs` |
| Retry plan | 2 | `retry-engine.mjs` |
| Proof registry | 2 | `proof-registry.mjs` |
| Relaunch plan | 2 | `artifact-schemas.mjs` |
| Assignment snapshot | 1 | `artifact-schemas.mjs` |
| Dependency snapshot | 1 | `artifact-schemas.mjs` |
| Trace bundle | 3 | `traces.mjs` |
| Run state | 3 | `wave-files.mjs` |
| Contradiction | 1 | `contradiction-entity.mjs` |
| Fact | 1 | `fact-entity.mjs` |
| Control-plane event | 2 | `control-plane.mjs` |
| Coordination record | 2 | `coordination-store.mjs` |
| Wave manifest | 2 | `wave-files.mjs` |
| Dashboard (global) | 2 | `projection-writer.mjs` |
| Dashboard (wave) | 2 | `projection-writer.mjs` |

---

## Wave State Reducer (P1-9)

The reducer is a pure function that rebuilds the complete wave state from the canonical authority set.

```
reduce(controlPlaneEvents, coordinationRecords, agentResultEnvelopes) → {
  waveState:          "running" | "completed" | "failed" | "blocked"
  attempt:            number
  tasks:              Map<taskId, TaskState>
  taskGraph:          DAG<taskId>
  proofAvailability:  Map<agentId, { sliceProven, bundles }>
  contradictions:     Map<contradictionId, ContradictionState>
  facts:              Map<factId, FactState>
  openBlockers:       [{ kind, detail, blocking }]
  gateVerdicts:       Map<gateName, { ok, detail }>
  retryTargetSet:     [agentId]
  closureEligibility: {
    allSlicesProven:  boolean
    closureReady:     boolean
    blockedReasons:   [{ gate, detail }]
  }
  humanInputs:        Map<requestId, HumanInputState>
  assignments:        Map<requestId, AssignmentState>
  dependencies:       Map<ticketId, DependencyState>
  coordinationMetrics:{ ackTimeout, staleAge, openCount }
}
```

The reducer takes all three canonical sources (control-plane events, coordination records, and result envelopes) as explicit input arguments — it does not read from disk.

### Usage

- **Live queries:** the launcher calls `reduce()` at each phase boundary to get current state.
- **Replay tests:** test harnesses feed stored events through `reduce()` and assert on the output.
- **Regression testing:** new orchestration logic is tested by replaying historical event streams and verifying that state transitions match expectations.
- **Benchmark harness:** the deterministic benchmark runner uses `reduce()` to evaluate coordination quality without live agents.

---

## Human Input Workflow (P1-10)

Human input handling becomes a proper workflow subsystem with explicit states, timeouts, and SLA tracking.

**Ownership rule:** The session supervisor observes, collects, and submits human-input responses. All workflow semantics — SLA, reroute, escalation, timeout, and closure blocking — live in:

- control-plane events (state transitions)
- the reducer (materialized state)
- `human-input-workflow.mjs` (workflow logic)

The supervisor does NOT own SLA or escalation logic. It is a process-lifecycle concern, not a workflow concern.

```
human_input {
  requestId:         string
  waveNumber:        number
  lane:              string
  kind:              "clarification" | "escalation" | "approval" | "decision"
  status:            "pending" | "assigned" | "answered" | "escalated" |
                     "resolved" | "timed_out" | "rerouted"
  requestedBy:       string        // agentId or "system"
  requestedAt:       ISO8601
  assignedTo:        string | null // operator identity
  assignedAt:        ISO8601 | null
  answeredAt:        ISO8601 | null
  resolvedAt:        ISO8601 | null
  timeoutPolicy: {
    ackDeadlineMs:   number        // time to assign
    resolveDeadlineMs: number      // time to resolve after assignment
    escalateAfterMs: number        // auto-escalate if unresolved
  }
  reroutePolicy: {
    maxReroutes:     number
    rerouteHistory:  [{ from, to, reason, at }]
  }
  linkedRequests:    [requestId]
  closureCondition:  string | null
  slaMetrics: {
    timeToAck:       number | null
    timeToResolve:   number | null
    wasEscalated:    boolean
    wasRerouted:     boolean
    wasTimedOut:     boolean
  }
}
```

The closure engine treats unresolved human inputs as hard blockers. The retry engine can plan around timed-out requests by escalating or rerouting.

---

## Proof Families (P2-11)

Proof is split into three named families with distinct validation rules.

### `code_proof`

Validates that the agent's owned deliverables are correct.

- Tests pass (unit, integration, or live depending on contract)
- Build succeeds
- Diff is clean (no untracked changes outside owned paths)
- Deliverables exist and are non-empty
- Proof artifacts present and SHA256-valid
- Component promotions meet target maturity

### `integration_proof`

Validates that cross-cutting contracts are satisfied.

- Interface contracts between components are consistent
- Dependency resolution is clean
- No open integration conflicts
- No open contradictions affecting shared state
- Cross-lane dependencies resolved
- Integration summary shows zero unresolved blockers

### `deploy_proof`

Validates runtime behavior in a deployment context.

- Rollout artifact exists (if declared)
- Runtime health check passes (if declared)
- Post-deploy evidence collected (if declared)
- No deployment-blocking regressions
- Deploy-kind specific validation passes (Railway, Docker, k8s, etc.)

The gate engine evaluates each family independently. A wave can be `code_proof: satisfied, integration_proof: satisfied, deploy_proof: not_applicable` — which is the common case for non-deployment waves.

---

## Runtime Adapter Contract (P2-12)

The launcher sees executors only through a capability-driven adapter interface.

In the end state, the adapter **locates, reads, and validates agent-produced result envelopes** — it does not build them from log tails. Building envelopes from logs is an explicit migration-only compatibility shim, named `synthesizeLegacyEnvelope` to make this clear.

```
ExecutorAdapter {
  // Identity
  executorId:        string        // "codex" | "claude" | "opencode" | "local"
  displayName:       string

  // Capability declaration
  capabilities: {
    sandboxModes:    [string]
    supportsSearch:  boolean
    supportsImages:  boolean
    supportsAddDirs: boolean
    supportsMcp:     boolean
    supportsHooks:   boolean
    supportsJson:    boolean
    maxTurns:        number | null
    rateLimitRetry:  boolean
  }

  // Contracts
  buildLaunchSpec(agent, wave, options) → LaunchSpec
  locateResultEnvelope(statusPath, logPath) → path | null
  validateResultEnvelope(envelope) → { valid, errors }
  synthesizeLegacyEnvelope(logPath, statusPath) → envelope  // migration-only
  isAvailable() → boolean

  // Fallback
  fallbackEligibility: {
    canFallbackFrom:  [executorId]
    canFallbackTo:    [executorId]
    restrictions:     [string]
  }

  // Supervision
  supervisionHooks: {
    onLaunch:        (spec) → void
    onComplete:      (result) → void
    onTimeout:       (spec) → void
    onRateLimit:     (spec, attempt) → RetryDecision
  }
}
```

Runtime-specific branching in orchestration code is eliminated. The implementation engine asks "does this adapter support X?" instead of checking `if (executor === 'codex')`.

---

## Workflow Backend Boundary (P2-15)

The architecture introduces an internal workflow backend abstraction, even though the first implementation is local files plus the reducer.

```
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
```

The local-file backend implements this with:
- JSONL append for `appendEvent`
- `reduce()` for all state queries
- File-based timer tracking for deadlines
- Existing feedback queue for human input

This boundary means a future Temporal-backed or service-backed orchestrator can be introduced without rewriting the decision model — only the backend implementation changes.

---

## Runtime Module Layout

The runtime tree now uses the engine-oriented module names directly.

| Runtime Module | Responsibility |
|---------------|----------------|
| `launcher.mjs` | Thin orchestrator and CLI entrypoint |
| `implementation-engine.mjs` | Implementation fan-out planning |
| `derived-state-engine.mjs` | Derived state computation from canonical inputs |
| `gate-engine.mjs` | Live gate evaluation |
| `closure-engine.mjs` | Closure sequencing |
| `retry-engine.mjs` | Retry and resume planning |
| `wave-state-reducer.mjs` | Deterministic wave-state reconstruction |
| `session-supervisor.mjs` | Session launch and observation |
| `projection-writer.mjs` | Projection writes |
| `result-envelope.mjs` | Envelope schema, validation, and compatibility synthesis |
| `launcher-runtime.mjs` | Low-level launch and wait helpers used by the session supervisor |
| `control-plane.mjs` | Canonical control-plane event log |
| `coordination-store.mjs` | Canonical coordination log |
| `wave-files.mjs` | Parsed wave definitions |

Historical note:

- earlier transition builds used `launcher-gates.mjs`, `launcher-retry.mjs`, `launcher-derived-state.mjs`, `launcher-closure.mjs`, and `launcher-supervisor.mjs` as extracted runtime modules
- those compatibility names are no longer part of the live runtime tree
| (new) | `contradiction-entity.mjs` | Contradiction lifecycle |
| (new) | `fact-entity.mjs` | Fact/evidence lineage |
| (new) | `human-input-workflow.mjs` | Human input workflow logic |
| (new) | `proof-families.mjs` | Proof family split + validation |
| (new) | `schema-versioning.mjs` | Version migration registry |
| (new) | `workflow-backend.mjs` | Backend interface |
| (new) | `workflow-backend-local.mjs` | Local-file backend |
| `control-plane.mjs` | `control-plane.mjs` | Gains contradiction + fact entities |
| `coordination-store.mjs` | `coordination-store.mjs` | Unchanged authority |
| `agent-state.mjs` | `agent-state.mjs` | Gains legacy envelope adapter |
| `proof-registry.mjs` | `proof-registry.mjs` | Gains proof-family tags |
| `retry-control.mjs` | `retry-control.mjs` | Thin adapter for retry-engine |
| `executors.mjs` | `executor-adapters.mjs` | Capability-driven interface |
| `wave-files.mjs` | `wave-files.mjs` | Gains task graph builder |
| `dashboard-state.mjs` | `projection-writer.mjs` | Moved to projection layer |
| `traces.mjs` | `projection-writer.mjs` | Trace bundles are projections |

---

## Wave Plan

The refactor is implemented across Waves 1–6. Each wave is independently shippable and backward-compatible.

| Wave | Focus | Component Promotions |
|------|-------|---------------------|
| **Wave 1** | Phase engine extraction + authority model | `wave-parser-and-launcher` → baseline-proved, `closure-sweep-and-role-gates` → baseline-proved |
| **Wave 2** | Task graph + two-phase proof separation | `state-artifacts-and-feedback` → baseline-proved |
| **Wave 3** | Result envelopes + retry isolation + executor adapters | `executor-abstraction-and-prompt-transport` → baseline-proved, `closure-sweep-and-role-gates` → baseline-proved |
| **Wave 4** | State reducer + contradictions + evidence lineage | `state-artifacts-and-feedback` → pilot-live |
| **Wave 5** | Schema versioning + artifact classification + human input workflow + projection writer | `state-artifacts-and-feedback` → qa-proved |
| **Wave 6** | Proof families + workflow backend + architecture completion | `wave-parser-and-launcher` → pilot-live, `closure-sweep-and-role-gates` → pilot-live, `executor-abstraction-and-prompt-transport` → pilot-live |

Detailed wave definitions are in `docs/plans/waves/wave-1.md` through `wave-6.md`.

---

## Feedback Corrections Applied

This section documents the 10 feedback corrections incorporated from architectural review.

1. **Authority model:** replaced "event log is the single authority" with Model B — a named canonical authority set of wave definitions, control-plane log, and coordination log. The wording now says "canonical authority set" everywhere, not "single authority."

2. **Task vs coordination_record boundary:** added an explicit section defining the crisp rule. Task = durable work unit with ownership, artifact contract, proof rules, closure semantics. Coordination record = event or message about a task. They do not overlap.

3. **Intent vs observation:** planning engines emit run selections or launch requests (intent). Only the session supervisor writes `wave_run.*`, `attempt.*`, and `agent_run.*` observed lifecycle facts after those events actually happen.

4. **Reducer input model:** the reducer explicitly takes all three canonical sources (control-plane events, coordination records, agent result envelopes) as arguments. The doc no longer claims a single event log.

5. **Attempt-scoped canonical snapshots:** agent result envelope path changed from `.tmp/<lane>-wave-launcher/results/wave-<N>-<agentId>.json` to `.tmp/<lane>-wave-launcher/results/wave-<N>/attempt-<A>/<agentId>.json`. Immutability is enforced.

6. **Task identity:** `taskId` is now a stable semantic identifier (e.g. `wave-1:A1:wave-parser-and-launcher`), not a content hash. Tasks carry separate `version` and `contentHash` fields for change tracking.

7. **Fact identity:** `factId` is now a stable semantic identifier with separate `contentHash` and `version` fields. Content hashing is for dedup and change detection, not identity.

8. **Role-aware result envelopes:** the envelope is now a common header plus role-specific typed optional payloads (implementation, integration, documentation, cont-qa, cont-eval, security, deploy). Roles that do not apply leave their section absent.

9. **Human input workflow ownership:** explicitly moved SLA, reroute, escalation, and timeout logic out of the supervisor. The supervisor observes and submits; workflow semantics live in control-plane events, the reducer, and `human-input-workflow.mjs`.

10. **Executor adapter contract:** `locateResultEnvelope()` + `validateResultEnvelope()` define the live end state, and `synthesizeLegacyEnvelope()` is explicitly named as migration-only compatibility code.

---

## What This Architecture Does NOT Do

- **General-purpose agent platform.** Wave stays opinionated about repo work, bounded waves, closure roles, and delivery discipline.
- **Distributed execution.** The orchestrator is single-node. The workflow backend boundary exists for future flexibility, not for immediate distribution.
- **Plugin architecture.** Phase engines are internal modules with known interfaces, not dynamically loaded plugins.
- **Breaking the CLI surface.** All existing `wave` commands continue to work. New capabilities are additive.
- **Rewriting working subsystems.** Coordination store, skills, context7, terminals, and wave-file parsing are retained as-is. The refactor targets the launcher core and the authority model, not the periphery.
