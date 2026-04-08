# Wave Orchestration Architecture

This document is a detailed, ground-truth architecture reference for Wave Orchestration.
It is derived from reading every source module, test file, configuration surface, and design document in the repository.

## Table of Contents

1. [Project Purpose and Design Philosophy](#1-project-purpose-and-design-philosophy)
2. [System Overview](#2-system-overview)
3. [Canonical Authority Model](#3-canonical-authority-model)
4. [Module Architecture](#4-module-architecture)
5. [Wave Execution Lifecycle](#5-wave-execution-lifecycle)
6. [Coordination and Blackboard Model](#6-coordination-and-blackboard-model)
7. [Gate Evaluation and Proof Model](#7-gate-evaluation-and-proof-model)
8. [Closure Sweep: How Waves Actually Close](#8-closure-sweep-how-waves-actually-close)
9. [Retry and Recovery](#9-retry-and-recovery)
10. [Run-State Reconciler](#10-run-state-reconciler)
11. [Sandbox Supervisor Model](#11-sandbox-supervisor-model)
12. [Runtime Abstraction and Executor Adapters](#12-runtime-abstraction-and-executor-adapters)
13. [Skills, Context7, and Compiled Context](#13-skills-context7-and-compiled-context)
14. [Entity Model](#14-entity-model)
15. [Artifact Hierarchy](#15-artifact-hierarchy)
16. [Telemetry and Wave Control](#16-telemetry-and-wave-control)
17. [CLI Surface Map](#17-cli-surface-map)
18. [Research Grounding](#18-research-grounding)

---

## 1. Project Purpose and Design Philosophy

### What Wave Is

Wave Orchestration is a framework for structured, multi-agent repository work. It replaces ad-hoc "vibe coding" sessions with a system where planning, coordination, evidence, proof, and closure are all explicit and machine-inspectable. The core thesis is that agentic coding is fast but fragile: agents hallucinate completion, coordination collapses at scale, and there is no trustworthy record of what actually happened. Wave makes all of those failure modes visible and addressable.

Wave is the orchestration substrate for **LEAP-claw**, the proprietary agent framework built on top of Wave's coordination, proof, and closure model. LEAP-claw agents operate through Wave's runtime abstraction, using Wave's canonical authority set, blackboard coordination, and proof-bounded closure while adding proprietary planning, reasoning, and execution strategies. Wave provides the runtime and coordination guarantees; LEAP-claw provides the agent intelligence.

The framework is **not** a chat wrapper or a prompt library. It is a runtime orchestrator that:

- Parses structured wave definitions from markdown
- Launches multiple coding agents in parallel across different LLM runtimes (Codex, Claude, OpenCode, LEAP-claw)
- Coordinates them through shared canonical state (not chat messages)
- Evaluates structured proof of completion through a multi-stage gate stack
- Closes waves only when all declared goals, proof artifacts, and closure stewards agree

### Design Principles

1. **Canonical authority set, not a single event log.** Three append-only sources of truth (wave definitions, coordination log, control-plane log) replace a single monolithic state store. Each is authoritative over a different domain.

2. **Phase engines replace a monolithic launcher.** Each concern (implementation selection, state derivation, gate evaluation, retry planning, closure sequencing) is a separate module with explicit inputs and outputs. The launcher is a thin orchestrator that wires them together.

3. **Planning engines emit intent; the supervisor emits facts.** The implementation engine says "launch agent A1"; the session supervisor records that A1 actually started at time T. This separation is critical for replay.

4. **Proof and closure are separate states.** An agent's owned slice can be proven (`owned_slice_proven`) without the wave being closure-ready (`wave_closure_ready`). Closure requires all cross-cutting conditions to also pass.

5. **Tasks are first-class entities.** Work units have ownership, leases, artifact contracts, dependency edges, and explicit closure state machines, not just "agent finished" flags.

6. **Retry is a dedicated deterministic subsystem.** Retry decisions are computed from stored state by pure functions, testable without launching any processes.

7. **Structured result envelopes replace log parsing.** Agents write typed JSON envelopes with a common header and role-specific payloads. Gates read envelopes, not log text.

8. **One strict artifact hierarchy.** Every artifact is classified as canonical event, structured snapshot, derived cache, or human-facing projection. Decision logic never reads projections.

9. **Replay is first-class.** A single reducer path (`wave-state-reducer.mjs`) rebuilds full wave state from the canonical authority set. Traces bundle everything needed for offline replay.

10. **The system stays opinionated about repo work.** Wave is a bounded-wave coding orchestrator with closure discipline, not a general-purpose agent framework.

### What Problem It Solves

Multi-agent coding systems fail in predictable ways documented in recent research (see [Section 18](#18-research-grounding)). Wave targets each failure mode with a specific architectural mechanism:

| Failure Mode | Wave Mechanism |
|---|---|
| Cosmetic board, no canonical state | Append-only JSONL authority set; board is a projection |
| Hidden evidence never pooled | Shared summaries, per-agent inboxes, integration gate |
| No global-state reconstruction | Reducer rebuilds full state from canonical sources |
| Simultaneous coordination collapse | Helper assignments, dependency barriers, explicit blocking |
| Expert signal averaged away | Named stewards, capability routing, proof gates |
| Contradictions smoothed over | Contradiction entities, clarification triage, repair tracking |
| Premature closure | Multi-stage gate stack, structured proof markers, closure stewards |

---

## 2. System Overview

### High-Level Architecture

```
                          +--------------------------+
                          |      wave.mjs (CLI)      |
                          |   Subcommand router      |
                          +----------+---------------+
                                     |
         +---------------------------+---------------------------+
         |                           |                           |
   +-----------+            +----------------+           +--------------+
   | install   |            | launcher.mjs   |           | autonomous   |
   | planner   |            | (Thin orch.)   |           | (Multi-wave  |
   | doctor    |            |                |           |  barrier)    |
   | draft     |            +-------+--------+           +--------------+
   | adhoc     |                    |
   +-----------+                    |
                    +---------------+---------------+
                    |               |               |
             +------+------+ +-----+------+ +------+------+
             | Impl Engine | | Derived    | | Gate Engine  |
             | (run select)| | State Eng. | | (evaluate)   |
             +-------------+ +------------+ +--------------+
                    |               |               |
             +------+------+ +-----+------+ +------+------+
             | Retry Engine| | Closure    | | Wave State   |
             | (plan retry)| | Engine     | | Reducer      |
             +-------------+ +------------+ +--------------+
                                    |
                    +---------------+---------------+
                    |                               |
             +------+------+               +-------+-------+
             | Session     |               | Projection    |
             | Supervisor  |               | Writer        |
             | (launch,    |               | (dashboards,  |
             |  wait, tmux)|               |  traces, etc) |
             +-------------+               +---------------+
```

### Four-Layer Model

**Layer 1 -- Canonical State** (append-only, never rewritten)
- `control-plane.mjs`: Lifecycle events (wave runs, agent runs, attempts, proof bundles, gates, contradictions, facts, human inputs)
- `coordination-store.mjs`: Workflow events (requests, acks, claims, evidence, decisions, blockers, handoffs, clarifications, escalations)
- `wave-files.mjs`: Parsed wave definitions from `docs/plans/waves/wave-<N>.md` (read-only)

**Layer 2 -- Phase Engines** (pure functions reading canonical state, emitting decisions)
- `implementation-engine.mjs`: Selects which agents to launch (initial, retry, override, persisted relaunch)
- `derived-state-engine.mjs`: Computes shared summaries, inboxes, assignments, ledger, docs queue, security and integration summaries
- `gate-engine.mjs`: Evaluates all closure gates and returns verdicts
- `closure-engine.mjs`: Sequences the staged closure sweep
- `retry-engine.mjs`: Plans retry targets, reusable work, executor fallbacks
- `wave-state-reducer.mjs`: Rebuilds full deterministic wave state from canonical sources

**Layer 3 -- Supervisor and Projection Writer** (side effects)
- `session-supervisor.mjs`: Launches process-backed runs, manages optional tmux dashboard/projection sessions, writes observed lifecycle events (`agent_run.started`, `agent_run.completed`)
- `projection-writer.mjs`: Persists all human-facing projections (dashboards, traces, boards, summaries, inboxes, ledgers)
- `signals.mjs`: Writes versioned signal-state projections for long-running agents

**Layer 4 -- Launcher Orchestrator** (thin wiring)
- `launcher.mjs`: Parses args, acquires lock, iterates waves, calls engines in correct order, delegates all decisions

---

## 3. Canonical Authority Model

The system's source of truth is split across three canonical sources. Everything else is a derived projection.

### Authority Set

| Source | Storage | Authority Over |
|--------|---------|----------------|
| Wave definitions | Markdown files parsed at startup | Goals, agent roles, deliverables, exit contracts, proof artifacts, eval targets, component promotions, skills |
| Control-plane event log | Append-only JSONL per wave | Entity lifecycle: `wave_run`, `agent_run`, `attempt`, `proof_bundle`, `rerun_request`, `human_input`, `gate`, `contradiction`, `fact`, `artifact`, `benchmark_run`, `verification`, `review` |
| Coordination log | Append-only JSONL per wave | Workflow state: `request`, `ack`, `claim`, `evidence`, `decision`, `blocker`, `handoff`, `clarification-request`, `orchestrator-guidance`, `human-escalation`, `human-feedback`, `integration-summary` |

### Key Invariants

- Canonical logs are append-only. Events are never rewritten or deleted.
- The wave-state reducer can rebuild full wave state from these three sources alone.
- Result envelopes are immutable per attempt. A new attempt creates new envelopes; old ones are preserved.
- Projections (dashboards, boards, summaries, inboxes) are derived from canonical state and are safe to regenerate.
- **Decision logic never reads projections.** Gates, retry planning, and closure read canonical state and structured envelopes.

### Derived Projections

| Projection | Source | Purpose |
|---|---|---|
| Rolling message board | Coordination log + assignments + dependencies | Human-facing coordination view |
| Shared summary | Coordination log + execution summaries | Cross-agent awareness |
| Per-agent inboxes | Coordination log filtered by agent | Targeted awareness |
| Assignment snapshots | Coordination log + capability routing | Helper assignment tracking |
| Dependency snapshots | Cross-lane dependency tickets | Blocking dependency view |
| Wave ledger | Coordination log + feedback + assignments | Audit trail per wave |
| Docs queue | Execution summaries + doc-delta claims | Documentation closure input |
| Integration summary | Execution summaries + integration markers | Integration gate input |
| Security summary | Security review reports | Security gate input |
| Dashboard JSON | All of the above + agent status | Operator monitoring |
| Trace bundles | All canonical + derived state per attempt | Replay and audit |

---

## 4. Module Architecture

### Core Modules (71 `.mjs` files in `scripts/wave-orchestrator/`)

#### Entry Point and Configuration

| Module | Size | Role |
|--------|------|------|
| `wave.mjs` | CLI router | Dispatches subcommands to dedicated modules |
| `config.mjs` | 47KB | Loads and normalizes `wave.config.json`, executor profiles, lane policies, skill routing |
| `shared.mjs` | 19KB | Constants (paths, defaults, regexes), utility functions (timestamps, file I/O, argument parsing) |
| `roots.mjs` | 375B | Resolves `PACKAGE_ROOT` and `WORKSPACE_ROOT` |

#### Canonical State Modules

| Module | Size | Role |
|--------|------|------|
| `wave-files.mjs` | 117KB | Parses wave markdown into structured definitions; validates waves; builds manifests; reconciles run state |
| `coordination-store.mjs` | 49KB | Reads/writes coordination JSONL; materializes coordination state; compiles shared summaries and inboxes |
| `control-plane.mjs` | 25KB | Reads/writes control-plane JSONL; builds task snapshots; manages proof bundles, rerun requests, human-input workflow |
| `coordination.mjs` | 43KB | Builds execution prompts; manages orchestrator boards; human feedback request reading |

#### Phase Engine Modules

| Module | Size | Role |
|--------|------|------|
| `implementation-engine.mjs` | 3KB | `planInitialWaveAttempt()` and `planRetryWaveAttempt()` -- selects which agent runs to launch |
| `derived-state-engine.mjs` | 27KB | `buildWaveDerivedState()` -- computes all blackboard projections from canonical sources |
| `gate-engine.mjs` | 56KB | Evaluates implementation, component, assignment, dependency, clarification, cont-eval, security, integration, documentation, and cont-QA gates |
| `closure-engine.mjs` | 17KB | `runClosureSweepPhase()` and `planClosureStages()` -- orchestrates the staged closure sequence |
| `retry-engine.mjs` | 40KB | Plans retry targets, identifies reusable work, computes executor fallback chains, generates persisted relaunch plans |
| `wave-state-reducer.mjs` | 26KB | `rebuildWaveState()` -- deterministic state reconstruction from canonical authority set for live queries and replay |

#### Session and Output Modules

| Module | Size | Role |
|--------|------|------|
| `session-supervisor.mjs` | 28KB | Process lifecycle: launches detached agent runners, waits for completion, manages locks, records `agent_run.started` / `agent_run.completed` events |
| `launcher-runtime.mjs` | 14KB | Builds agent launch specs: resolves skills, builds execution prompts, handles Context7 prefetch, manages rate-limit retries |
| `projection-writer.mjs` | 10KB | Single persistence layer for all projections: dashboards, traces, summaries, inboxes, boards, ledgers, docs queues |
| `traces.mjs` | 45KB | Builds hermetic trace bundles per attempt with quality metrics |

#### Agent and Task Modules

| Module | Size | Role |
|--------|------|------|
| `agent-state.mjs` | 43KB | Builds and validates agent execution summaries for all roles (implementation, cont-QA, cont-eval, integration, documentation, security, design) |
| `task-entity.mjs` | 31KB | Task entity model with ownership, leases, artifact contracts, dependency edges, closure state machines |
| `result-envelope.mjs` | 19KB | Builds immutable attempt-scoped result envelopes with common header and role-specific payloads |
| `contradiction-entity.mjs` | 13KB | Materializes contradictions from control-plane events; tracks repair work |

#### Executor and Skills

| Module | Size | Role |
|--------|------|------|
| `executors.mjs` | 15KB | Builds executor-specific launch commands for Codex, Claude, OpenCode, and Local |
| `skills.mjs` | 33KB | Skill loading, resolution by role/runtime/deploy-kind, artifact generation |
| `context7.mjs` | 14KB | Context7 bundle integration, prefetch, library resolution, prompt fingerprinting |

#### Coordination and Human Input

| Module | Size | Role |
|--------|------|------|
| `clarification-triage.mjs` | 21KB | Orchestrator-first triage of clarification requests from repo policy, ownership, prior decisions |
| `human-input-workflow.mjs` | 13KB | Human feedback request lifecycle management |
| `human-input-resolution.mjs` | 11KB | Resolution of human input requests back into coordination state |
| `routing-state.mjs` | builds | Deterministic helper assignment from capability routing, explicit targets, least-busy fallback |

#### Specialized Features

| Module | Size | Role |
|--------|------|------|
| `autonomous.mjs` | 16KB | Multi-wave autonomous execution with inter-wave barriers, dependency checks, external attempt limits |
| `planner.mjs` | 131KB | Agentic wave planning, draft generation, component maturity tracking, exit contract authoring |
| `adhoc.mjs` | 46KB | Ad-hoc transient runs on the same runtime surface |
| `benchmark.mjs` | 34KB | Benchmark running and result tracking |
| `swe-bench-pro-task.mjs` | 31KB | SWE-Bench Pro task orchestration |
| `install.mjs` | 31KB | Workspace initialization, upgrades, adoption, `wave doctor` validation |

---

## 5. Wave Execution Lifecycle

### Phase 1: Startup

```
CLI invocation
  -> parseArgs()           -- resolve lane, project, wave range, executor, options
  -> acquireLauncherLock() -- prevent concurrent launchers on same lane
  -> parseWaveFiles()      -- parse all wave-<N>.md into structured definitions
  -> applyExecutorSelectionsToWave()  -- resolve per-agent executor from lane policy
  -> applyContext7SelectionsToWave()  -- resolve Context7 library selections
  -> validateWaveDefinition()         -- validate agents, deliverables, exit contracts
  -> buildManifest()       -- build manifest of all docs and waves
  -> writeManifest()       -- persist manifest JSON
```

### Phase 2: Per-Wave Loop

For each wave in the selected range:

```
1. buildWaveDerivedState()
   Computes shared summary, inboxes, message board, assignments, dependencies,
   ledger, docs queue, security summary, integration summary from canonical state.

2. writeWaveDerivedProjections()
   Persists all derived state to disk.

3. resetPersistedWaveLaunchState()
   Clears stale relaunch plans unless --resume-control-state is set.

4. planInitialWaveAttempt()
   Selects which agents to launch:
   a. Check for reusable pre-completed agents (proven work from prior attempts)
   b. Check for operator retry overrides
   c. Check for persisted relaunch plans (from prior launcher crash)
   d. Fall back to selectInitialWaveRuns() -- all non-pre-completed agents

5. For design-first waves: launch design agents first, wait for design gate,
   then transition to implementation agents.

6. For each selected agent run:
   a. launchAgentSession()  -- build prompt, resolve skills, launch the process-backed agent run
   b. recordAgentRunStarted() -- supervisor writes control-plane event

7. waitForWaveCompletion()
   Polling loop watching status files, with periodic:
   - refreshDerivedState()     -- recompute blackboard projections
   - monitorWaveHumanFeedback() -- reconcile answered feedback
   - syncLiveWaveSignals()     -- update signal projections
   - emitCoordinationAlertEvents() -- flag overdue acks and stale clarifications
   - recordAgentRunFinished()  -- supervisor writes completion events

8. materializeAgentExecutionSummaries()
   Build structured summaries from agent output for gate evaluation.

9. buildGateSnapshot()
   Evaluate all gates: implementation, component, assignment, dependency,
   clarification, design, cont-eval, security, integration, docs, cont-QA.

10. If implementation gate passes and closure agents declared:
    runClosureSweepPhase() -- staged closure (see Section 8)

11. If any gate fails and retries remain:
    planRetryWaveAttempt() -- select agents to relaunch (see Section 9)
    Go to step 6.

12. On wave completion:
    markWaveCompleted()       -- update run-state
    writeWaveAttemptTraceProjection() -- persist trace bundle
    computeReducerSnapshot()  -- persist reducer state for replay
    flushWaveControlTelemetry() -- deliver telemetry events
```

### Phase 3: Cleanup

```
  -> cleanupLaneTmuxSessions()          -- clean up tmux dashboard/projection sessions (unless --keep-sessions)
  -> removeLaneTemporaryTerminalEntries() -- clean terminal registry
  -> releaseLauncherLock()               -- release lock for other launchers
```

### Autonomous Mode

`wave autonomous` adds an outer loop around the per-wave launcher:

```
for each wave in lane order:
  1. Check cross-lane dependency barriers
  2. Check run-state for already-completed waves
  3. Spawn `wave launch --start-wave N --end-wave N` as subprocess
  4. If wave fails after max external attempts, stop
  5. Continue to next wave
```

Autonomous mode disables `--terminal-surface none` and requires a real executor (not `local`).

---

## 6. Coordination and Blackboard Model

### Why a Blackboard

Traditional multi-agent systems fail when agents treat chat output as system of record. Evidence gets lost, contradictions are smoothed over, and there is no way to reconstruct what the system actually knew at any point. Wave uses a blackboard-style architecture where agents work against shared canonical state.

### How It Works

1. **Agents write to canonical logs, not to each other.** An implementation agent posts a `claim`, `evidence`, `blocker`, or `clarification-request` to the coordination log.

2. **The derived-state engine compiles shared awareness.** After any state change, `buildWaveDerivedState()` recomputes:
   - Shared summary: aggregated coordination state visible to all agents
   - Per-agent inboxes: filtered view of state relevant to a specific agent
   - Message board: human-readable markdown projection
   - Assignment snapshot: who owns what capability-targeted requests
   - Dependency snapshot: cross-lane blocking state

3. **Agents receive compiled context, not raw logs.** When an agent is launched or re-contextualized, it receives the shared summary and its inbox, not a dump of raw log lines.

4. **The orchestrator triages clarifications.** When an agent posts a `clarification-request`, the `clarification-triage.mjs` module resolves it from repo policy, ownership, and prior decisions before escalating to human feedback.

5. **Human input flows through the control plane.** Human feedback requests are tracked as `human_input` entities with explicit lifecycle states (`pending -> assigned -> answered|escalated|resolved|timed_out|rerouted`).

### Coordination Record Types

| Kind | Purpose |
|------|---------|
| `request` | Agent asks for something from another agent or the orchestrator |
| `ack` | Agent acknowledges a request |
| `claim` | Agent claims a deliverable is complete |
| `evidence` | Agent provides supporting evidence for a claim |
| `decision` | Orchestrator or agent records a decision |
| `blocker` | Something is blocking progress |
| `handoff` | Work is transferred between agents |
| `clarification-request` | Agent needs clarification before proceeding |
| `orchestrator-guidance` | Orchestrator provides direction |
| `human-escalation` | Issue escalated to human operator |
| `human-feedback` | Human provides feedback |
| `integration-summary` | Cross-agent integration state |

### Blocking Semantics

Coordination records have explicit blocking behavior:

- **Hard blockers** (`hard`, `proof-critical`, `closure-critical`): Block wave progression
- **Soft blockers** (`soft`): Visible but non-blocking
- **Stale/Advisory** (`stale`, `advisory`): Informational only

Operators can downgrade blockers via `wave control task` commands: `defer`, `mark-advisory`, `mark-stale`, `resolve-policy`.

### Helper Assignments

When an agent posts a capability-targeted request, the routing engine assigns it:

1. Check explicit targets in the request
2. Check `capabilityRouting.preferredAgents` in config
3. Match capability owners with demonstrated same-wave completions
4. Fall back to least-busy agent

Assignments remain blocking until the linked follow-up resolves or is explicitly downgraded.

---

## 7. Gate Evaluation and Proof Model

### Two-Phase Proof

Wave separates individual agent proof from wave-level closure:

**Phase 1: `owned_slice_proven`** (per-agent)

An agent's owned slice is proven when:
- All declared deliverables exist on disk
- Proof markers meet or exceed the exit contract
- Proof artifacts (if declared) are present with valid SHA256
- Doc-delta is declared if required
- Component promotions meet target maturity
- No open self-owned blockers

**Phase 2: `wave_closure_ready`** (cross-cutting)

All owned slices are proven AND:
- No unresolved contradictions
- No open clarification barriers
- No open helper assignment barriers
- No open cross-lane dependency barriers
- Integration gate passed
- Documentation gate passed
- cont-EVAL gate passed (if applicable)
- Security review gate passed (if applicable)
- cont-QA final verdict is PASS
- Component matrix promotions validated

Only when `wave_closure_ready = true` does the system emit a `wave_run.completed` event.

### Gate Stack

The `gate-engine.mjs` evaluates gates in this order:

| Gate | Evaluates | Required |
|------|-----------|----------|
| Implementation | All agent exit codes and execution summaries | Always |
| Component | Per-component maturity promotions | When declared |
| Design | Design packets are `ready-for-implementation` | When design agents present |
| Assignment | All helper assignments resolved | When assignments exist |
| Dependency | Cross-lane dependency tickets resolved | When dependencies exist |
| Clarification | All clarification barriers cleared | When clarifications exist |
| cont-EVAL | Eval report artifact + `[wave-eval]` marker + exact target_ids | When E0 declared |
| Security | Security report + `[wave-security]` marker | When security agent declared |
| Integration | Integration evidence aggregation | Always |
| Documentation | Doc closure state | Always |
| Component Matrix | Cross-agent component validation | When components declared |
| cont-QA | Final verdict + `[wave-gate]` marker | Always |

### Result Envelopes

Agents produce structured JSON envelopes (not free-form text). Each envelope has:

**Common header (all roles):**
```
schemaVersion, agentId, waveNumber, attempt, completedAt, exitCode,
role, proof{}, deliverables[], proofArtifacts[], gaps[],
unresolvedBlockers[], riskNotes[], facts[]
```

**Role-specific payloads:**
- `implementation`: docDelta, components[]
- `integration`: state (clean|claims_pending|conflicts_detected|blocked), counts
- `documentation`: docClosure state, paths
- `cont-qa`: verdict, gateClaims (architecture/integration/durability/live/docs)
- `cont-eval`: state, targets, benchmarks, regressions
- `security`: state (clean|findings|blocked), findings/approvals counts
- `deploy`: state, environment, healthCheck

Envelope path: `.tmp/<lane>-wave-launcher/results/wave-<N>/attempt-<A>/<agentId>.json`

---

## 8. Closure Sweep: How Waves Actually Close

### The Core Problem

Agents say "done" before the work is actually done. This is the single most common failure mode in multi-agent coding systems. An agent can produce plausible-looking output, claim PASS, and move on -- but the deliverables don't exist, the tests don't run, the integration breaks, or the proof is narrative rather than structural. Wave's closure model exists to make premature closure impossible.

### Closure Is Not "Agent Finished"

A wave does not close when agents finish running. A wave closes when:

1. Every agent's **owned slice is structurally proven** (deliverables exist, proof markers valid, SHA256 checks pass)
2. Every **cross-cutting concern** is clear (no open blockers, clarifications, dependencies, contradictions)
3. A **staged sweep of closure stewards** has validated the integrated result
4. The **final cont-QA verdict** is PASS based on structural evidence, not agent self-report

This is enforced by the `closure-engine.mjs` module. The launcher cannot bypass closure; the gate stack is fail-closed.

### How the Closure Sweep Executes

The sweep is sequential and staged for semantic closure work. Each required closure stage launches its steward, waits for it to complete, evaluates the gate, and only proceeds to the next stage if the gate passes. This is implemented in `runClosureSweepPhase()`.

Low-entropy waves now use a closure fast-path before any steward is launched:

- `closure-policy.mjs` can auto-satisfy integration from derived state when no contradictions, helper assignments, dependency barriers, security blockers, interface drift, or deploy risks remain.
- Documentation closure can auto-satisfy as `no-change` when no shared-plan or component-matrix delta remains, and can auto-close mechanical component-matrix reconciliation when the canonical matrix is already current.
- cont-QA can be skipped only in bootstrap closure mode, and only when no semantic closure steward had to run.

If the fast-path does not prove closure, the runtime falls back to the normal staged steward sequence below.

```
┌─────────────────────────────────────────────────────────────────────┐
│ IMPLEMENTATION PHASE (parallel)                                      │
│  A1, A2, A3... run concurrently                                      │
│  Each writes: status file, execution summary, result envelope        │
│  Gate: readWaveImplementationGate() checks all exit codes + summaries│
│  If any fail → retry (Section 9), do not enter closure               │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ all agents exit 0 + valid summaries
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 1: cont-EVAL  (optional — only if E0 declared in wave)        │
│  Launch: E0 agent                                                    │
│  Reads: implementation result envelopes, eval target declarations    │
│  Writes: eval report artifact + [wave-eval] structured marker        │
│  Gate: readWaveContEvalGate()                                        │
│    ✓ Report artifact exists                                          │
│    ✓ [wave-eval] marker present with exact target_ids match          │
│    ✓ benchmark_ids valid                                             │
│  On fail: only E0 reruns; all implementation proof preserved         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ gate passes (or stage skipped)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 2: Security Review  (optional — only if security agent exists) │
│  Launch: security review agent (A7)                                  │
│  Reads: implementation envelopes, source diff, dependency state      │
│  Writes: security report + [wave-security] structured marker         │
│  Gate: readWaveSecurityGate()                                        │
│    ✓ Report exists                                                   │
│    ✓ [wave-security] marker with state=clear|concerns|blocked        │
│    ✓ state != blocked (concerns are logged but non-blocking)         │
│  On fail: only A7 reruns; implementation proof preserved             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ gate passes (or stage skipped)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 3: Integration                                                 │
│  Launch: integration steward (A8)                                    │
│  Reads: all implementation envelopes, coordination state,            │
│         contradiction entities, shared summary                       │
│  Writes: integration evidence, contradiction resolutions             │
│  Gate: readWaveIntegrationBarrier()                                  │
│    ✓ Integration state is clean or claims_pending (not blocked)      │
│    ✓ No unresolved hard contradictions                               │
│    ✓ Evidence aggregation shows cross-agent consistency              │
│  On fail: only A8 reruns                                             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ gate passes
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 4: Documentation                                               │
│  Launch: documentation steward (A9)                                  │
│  Reads: doc-delta claims from implementation envelopes,              │
│         component matrix, shared plan docs                           │
│  Writes: documentation closure report                                │
│  Gate: readWaveDocumentationGate() + readWaveComponentMatrixGate()   │
│    ✓ Doc closure state is valid                                      │
│    ✓ Component matrix promotions are consistent across agents        │
│    ✓ Current levels match expected post-promotion state              │
│  On fail: only A9 reruns                                             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ gate passes
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 5: cont-QA  (final verdict)                                    │
│  Launch: cont-QA steward (A0)                                        │
│  Reads: ALL preceding closure evidence, all envelopes,               │
│         full coordination state, forwarded closure gaps               │
│  Writes: final verdict + [wave-gate] structured marker               │
│  Gate: readWaveContQaGate()                                          │
│    ✓ Verdict artifact exists                                         │
│    ✓ [wave-gate] marker present                                      │
│    ✓ Verdict is PASS (not FAIL, not PARTIAL)                         │
│  This is the terminal gate. PASS here = wave_closure_ready           │
└─────────────────────────────────────────────────────────────────────┘
```

### What Each Closure Agent Actually Validates

**cont-EVAL (E0):** Runs declared eval targets from the wave's `### Eval targets` section against the benchmark catalog. Verifies that eval results meet declared thresholds. Writes a typed eval report with `target_ids` linking back to wave declarations. The gate enforces exact match between declared and reported target IDs.

**Security Reviewer (A7):** Reviews source changes for OWASP top-10, dependency vulnerabilities, credential exposure, and wave-declared security concerns. Writes a structured report with `state` field. `clear` = no findings. `concerns` = findings logged but non-blocking. `blocked` = critical findings that must be resolved.

**Integration Steward (A8):** The cross-agent consistency checker. Reads all implementation envelopes to detect contradictions (agent A1 changed an interface that agent A2 depends on), verify that claims from different agents are compatible, and confirm that the integrated codebase is coherent. Works against the materialized contradiction entities from the control plane.

**Documentation Steward (A9):** Validates that all doc-delta claims from implementation agents were actually fulfilled, that the component maturity matrix is consistent (no agent promoted a component that another agent left at a lower level), and that shared plan docs reflect the current state.

**cont-QA (A0):** The final authority. Has access to everything: all envelopes, all coordination state, all forwarded closure gaps, all prior closure-stage reports. Makes the terminal PASS/FAIL decision based on structural evidence. The gate rejects narrative-only verdicts -- the `[wave-gate]` marker must be present with the exact structured format.

### Closure Gap Forwarding

A special case exists for `wave-proof-gap` status codes. When a closure-stage agent (e.g., A7 security review) identifies a gap but the gap is not a hard failure, the system does not stop the closure sweep:

1. Records the gap as a `closure-critical` blocker in the coordination log via `forwardedClosureGapRecord()`
2. Continues launching subsequent closure stages (A8, A9, A0) with the gap as structured input
3. Later closure agents evaluate the available artifacts. They don't refuse to run just because an earlier stage had a gap
4. The final disposition remains blocked until all forwarded gaps are resolved

**Why this matters:** Without gap forwarding, a minor security concern in Stage 2 would prevent the system from collecting integration evidence (Stage 3), documentation validation (Stage 4), and the QA assessment (Stage 5). That evidence is valuable regardless of whether the security gap needs resolution. Gap forwarding collects maximum evidence before blocking.

### Closure Role Bindings

Closure roles are resolved through `resolveWaveRoleBindings()`:

| Role | Default Agent ID | Config Override |
|------|-----------------|----------------|
| cont-QA | A0 | `roles.contQaAgentId` or wave-level `contQaAgentId` |
| cont-EVAL | E0 | `roles.contEvalAgentId` or wave-level `contEvalAgentId` |
| Integration | A8 | `roles.integrationAgentId` or wave-level `integrationAgentId` |
| Documentation | A9 | `roles.documentationAgentId` or wave-level `documentationAgentId` |
| Security | A7 | Detected by `isSecurityReviewAgent()` from role prompt path |

Waves can override these defaults. Starter defaults (`E0`, `A7`, `A8`, `A9`, `A0`) fill gaps only when a wave does not declare its own bindings.

### Design-First Gating (Pre-Closure)

Before the closure sweep, waves can optionally run a **design-first pass**:

1. Design agents (detected by `isDesignAgent()`) run before implementation agents
2. Design agents produce **design packets** under `docs/plans/waves/design/`
3. The design gate blocks implementation until every design packet is `ready-for-implementation`
4. Once the design gate clears, implementation agents fan out normally
5. Hybrid design stewards (flagged by `isImplementationOwningDesignAgent()`) rejoin the implementation fan-out after their design pass

This is orchestrated by `resolvePostDesignPassTransition()` in `launcher.mjs`.

### Infra Gate (Post-Implementation, Pre-Closure)

An additional gate checks infrastructure signal state. `readWaveInfraGate()` in `closure-engine.mjs` scans agent logs for structured infra signals and blocks if any signal ended in a non-conformant state. Conformant states (`conformant`, `setup-required`, `setup-in-progress`, `action-required`, `action-approved`, `action-complete`) are non-blocking.

### Strict Validation Rules

Live closure enforces strict marker validation. This is intentionally unforgiving:

- **cont-EVAL:** Report artifact must exist. `[wave-eval]` marker must be present with `target_ids` exactly matching the wave's declared eval targets. `benchmark_ids` must reference valid catalog entries.
- **Security:** Report must exist. `[wave-security]` marker must be present with `state` in `{clear, concerns, blocked}`.
- **cont-QA:** Final verdict artifact must exist. `[wave-gate]` marker must be present with structured verdict.
- **Legacy tolerance:** Underspecified or evaluator-era artifacts fail in live closure. They are only tolerated in replay mode for historical compatibility.

### Smart Rerun After Closure Failure

When a closure gate fails, the system does not rerun the entire wave:

| Failure Point | What Reruns | What Is Preserved |
|---|---|---|
| cont-EVAL fails | Only E0 | All implementation proof |
| Security fails | Only A7 | All implementation proof + E0 results |
| Integration fails | Only A8 | All implementation proof + E0 + A7 |
| Documentation fails | Only A9 | All proof + E0 + A7 + A8 |
| cont-QA fails | Only A0 | All proof + all closure stages |

This targeted rerun is computed by `planRetryWaveAttempt()` in the implementation engine, which reads the gate snapshot to identify exactly which closure role failed.

---

## 9. Retry and Recovery

### Retry Planning

The `retry-engine.mjs` is a pure-function module that computes retry decisions from stored state:

1. **Identify reusable work.** Agents with valid proof from prior attempts are marked `pre-completed` and skip relaunch. The `selectReusablePreCompletedAgentIds()` function checks:
   - Exit code 0
   - Valid execution summary
   - Proof registry confirms proof is still valid
   - No retry override targeting this agent

2. **Compute relaunch targets.** Failed agents are selected for relaunch. The system considers:
   - Direct failures (non-zero exit, timeout, missing status)
   - Shared component sibling failures (one component failure blocks siblings)
   - Closure gap invalidation (proof revoked by contradiction)

3. **Apply operator overrides.** Operators can set retry overrides via `wave control rerun` to force specific agents to rerun or skip.

4. **Persist relaunch plans.** If the launcher crashes, the relaunch plan survives on disk so the next launch can resume from the same point.

### Executor Fallback

When a runtime fails repeatedly, the retry engine can reassign an agent to a fallback executor from the lane policy's fallback chain. The `executorFallbackChain()` function reads:
1. Agent's explicit executor profile
2. Lane role defaults
3. Global fallback chain in config

### Barriers

Retry can be blocked by barriers that require human intervention:
- Unresolved clarifications requiring human feedback
- Cross-lane dependency barriers
- Helper assignment barriers with no available owner
- Repeated failures exhausting the retry budget

The barrier is surfaced through the coordination log and dashboard so operators can act.

---

## 10. Run-State Reconciler

### What the Reconciler Does

The reconciler answers one question: **which waves are actually complete?** It inspects on-disk artifacts (status files, execution summaries, coordination state, dependency tickets, assignment records) and determines whether each wave's completion evidence is structurally valid. This runs at launcher startup before any new execution begins.

The core function is `reconcileRunStateFromStatusFiles()` in `wave-files.mjs`. It is called from `launcher.mjs` during startup and can also be invoked standalone via `wave launch --reconcile-status`.

### Why It Exists

Several scenarios can leave run state and disk artifacts out of sync:

- The launcher crashes mid-wave, leaving status files on disk but no recorded completion
- A wave completed in a prior launcher run, but the wave definition has changed since (prompt drift)
- Coordination state has changed (new blockers, clarifications, escalations) that invalidate a previous completion
- An operator manually edited artifacts or resolved dependencies outside the launcher

The reconciler detects all of these and produces a correct run state.

### How It Works

```
reconcileRunStateFromStatusFiles(allWaves, runStatePath, statusDir, options)
    │
    ├─ Read existing run-state.json (previous completions, history)
    │
    ├─ For each wave definition:
    │   │
    │   └─ analyzeWaveCompletionFromStatusFiles()
    │       │
    │       ├─ Status File Validation
    │       │   ├─ Read agent status files (wave-<N>-<agentId>.status)
    │       │   ├─ Check exit code == 0
    │       │   └─ Verify metadata (promptHash present)
    │       │
    │       ├─ Prompt Drift Detection
    │       │   ├─ Compare current prompt hash to status file's recorded hash
    │       │   └─ Flag: prompt-hash-missing or prompt-hash-mismatch
    │       │
    │       ├─ Agent Summary Validation (per role)
    │       │   ├─ cont-QA → validateContQaSummary()
    │       │   ├─ cont-EVAL → validateContEvalSummary()
    │       │   ├─ Security → validateSecuritySummary()
    │       │   ├─ Integration → validateIntegrationSummary()
    │       │   ├─ Documentation → validateDocumentationClosureSummary()
    │       │   └─ Implementation → validateImplementationSummary()
    │       │
    │       ├─ Coordination State Checks
    │       │   ├─ Open clarifications → open-clarification
    │       │   ├─ Open clarification-linked requests → open-clarification-request
    │       │   ├─ Unresolved human escalations → open-human-escalation
    │       │   ├─ Pending human feedback → open-human-feedback
    │       │   ├─ Blocking helper assignments → helper-assignment-unresolved / open
    │       │   └─ Open dependency tickets → dependency-open / unresolved
    │       │
    │       ├─ Component Matrix Validation
    │       │   ├─ Promotion consistency across agents
    │       │   └─ Current levels match expected state
    │       │
    │       └─ Returns: { ok: boolean, reasons: [{code, detail}], evidence: {...} }
    │
    ├─ For each analyzed wave, decide outcome:
    │   ├─ ok == true → mark "completed"
    │   ├─ Previously completed + only prompt drift → preserve as "completed_with_drift"
    │   └─ Otherwise → mark "blocked" with reasons
    │
    ├─ Write state transitions to run-state.json history (append-only)
    │
    └─ Return reconciliation report:
        { completedFromStatus, addedFromBefore, blockedFromStatus, preservedWithDrift, state }
```

### Blocking Reason Codes

When a wave fails reconciliation, the reasons are tagged with specific codes:

| Code | Meaning |
|------|---------|
| `nonzero-status` | Agent exited with non-zero code |
| `missing-status` | Agent status file does not exist |
| `prompt-hash-missing` | Status file lacks promptHash metadata |
| `prompt-hash-mismatch` | Prompt has changed since agent ran |
| `invalid-cont-qa-summary` | cont-QA summary validation failed |
| `invalid-cont-eval-summary` | cont-EVAL summary validation failed |
| `invalid-security-summary` | Security summary validation failed |
| `invalid-integration-summary` | Integration summary validation failed |
| `invalid-documentation-summary` | Documentation summary validation failed |
| `invalid-implementation-summary` | Implementation proof validation failed |
| `component-promotions-invalid` | Component matrix promotion inconsistencies |
| `component-matrix-invalid` | Current level mismatches |
| `open-clarification` | Unresolved clarification records in coordination log |
| `open-clarification-request` | Clarification-linked requests still open |
| `open-human-escalation` | Human escalations unresolved |
| `open-human-feedback` | Human feedback still pending |
| `helper-assignment-unresolved` | Blocking assignments not assigned |
| `helper-assignment-open` | Blocking assignments assigned but not completed |
| `dependency-assignment-unresolved` | Inbound dependencies not assigned |
| `dependency-open` | Required cross-lane dependencies remain open |

### Prompt Drift Preservation

When a wave was previously completed by an actual launcher run, but the wave definition has since changed (causing prompt hash mismatch), the reconciler does **not** invalidate the completion. Instead it preserves the wave as `completed_with_drift`.

The logic in `shouldPreserveCompletedWave()` requires both conditions:

1. **Previous completion is authoritative**: the wave's `lastSource` is not empty and not `"legacy-run-state"` (i.e., it was completed by a real execution, not imported from old data)
2. **Only prompt drift reasons exist**: every blocking reason is in `{prompt-hash-missing, prompt-hash-mismatch}` and no other validation failures are present

This is a pragmatic choice: prompt changes alone (e.g., editing a wave description after completion) should not force a full re-execution. But if the agent summary is also invalid, or coordination state has open blockers, the completion is revoked.

### Run State Structure

The persistent run state at `.tmp/<lane>-wave-launcher/run-state.json`:

```javascript
{
  completedWaves: [0, 1, 2],  // derived sorted list
  waves: {
    "0": {
      wave: 0,
      currentState: "completed",           // or "completed_with_drift" or "blocked"
      lastTransitionAt: "2024-03-22T...",
      lastSource: "live-launcher",          // who determined this state
      lastReasonCode: "wave-complete",      // why
      lastDetail: "Wave 0 completed.",      // human-readable
      lastEvidence: {                       // supporting metadata
        waveFileHash: "sha256:...",
        statusFiles: [{ agentId, path, promptHash, code, completedAt, sha256 }],
        summaryFiles: [{ agentId, path, sha256 }],
        coordinationLogSha256: "sha256:...",
        assignmentsSha256: "sha256:...",
        gateSnapshotSha256: "sha256:..."
      }
    }
  },
  history: [                               // append-only audit trail
    { seq: 1, at: "...", wave: 0, fromState: null, toState: "completed", source: "live-launcher", ... }
  ]
}
```

### Evidence Collection

Every state transition records comprehensive evidence via `buildRunStateEvidence()`:

- `waveFileHash`: SHA256 of the wave definition file
- `statusFiles[]`: Per-agent status file metadata (path, promptHash, exit code, SHA256)
- `summaryFiles[]`: Per-agent execution summary metadata (path, SHA256)
- `coordinationLogSha256`: Hash of the coordination log at transition time
- `assignmentsSha256`: Hash of the assignment snapshot
- `dependencySnapshotSha256`: Hash of the dependency snapshot
- `gateSnapshotSha256`: Hash of the gate snapshot
- `blockedReasons[]`: List of blocking reasons (if transition is to "blocked")

This makes every run-state transition auditable: you can verify exactly what evidence supported the decision.

### Reconcile-Only Mode

`wave launch --reconcile-status` runs reconciliation without executing any waves. It also cleans up stale artifacts:

- Removes stale launcher locks (from crashed launchers)
- Kills orphaned tmux sessions
- Prunes stale terminal registry entries
- Clears stale dashboard artifacts

Output format (`reconcile-format.mjs`):
```
[reconcile] added from status files: wave-0, wave-1
[reconcile] wave 2 not reconstructable: nonzero-status=A1 exited 1; open-clarification=CR-001
[reconcile] wave 3 preserved as completed: prompt-hash-mismatch=A2 hash changed
[reconcile] completed waves now: 0, 1, 3
```

---

## 11. Sandbox Supervisor Model

### The Problem

Sandboxed environments (like Codex's sandbox) have constraints that break the standard launcher model:

- **Short-lived sessions**: Sandbox `exec` commands have wall-clock timeouts shorter than real wave execution
- **Process pressure**: Bursty agent spawning can hit `EAGAIN`, `EMFILE`, `ENFILE` limits
- **Launcher death**: The launcher process can die before agents finish, orphaning tmux sessions
- **Ambiguous terminal state**: A missing tmux session does not mean the agent failed

The standard `wave launch` model assumes the launcher process stays alive for the entire wave. In sandboxed environments, this assumption breaks.

### Solution: Async Submit/Observe

The sandbox model separates the client (short-lived) from the daemon (long-running) through five commands:

```
┌──────────────────────────────────────────────────────────────────────┐
│ wave submit [launcher options] [--json]                              │
│                                                                      │
│  Purpose: Quick queue, return runId, exit immediately                │
│  1. Parse and validate launcher flags                                │
│  2. Generate runId: run-<timestamp>-<random>                         │
│  3. Create supervisor/runs/<runId>/                                   │
│  4. Write request.json (immutable) + state.json (status=pending)     │
│  5. Append event to events.jsonl: { type: "submitted" }              │
│  6. Call ensureSupervisorRunning() — spawn daemon if needed           │
│  7. Return { runId, statePath, supervisorPid }                       │
│  8. Exit 0                                                           │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ wave supervise [--project <id>] [--lane <name>] [--once]             │
│                                                                      │
│  Purpose: Long-running daemon that claims and supervises runs        │
│  Loop:                                                               │
│    1. Update heartbeat + lease in daemon.lock (15s renewal)          │
│    2. Scan supervisor/runs/*/state.json for all states               │
│    3. Reconcile "running" states:                                    │
│       - If launcher-status.json exists → read exit code → terminal   │
│       - If PID alive (signal 0) → still running                     │
│       - If PID dead + no status → mark failed                       │
│    4. If no active runs: claim next "pending" run                    │
│       - Spawn detached launcher process                             │
│       - Launcher writes to launcher.log                             │
│       - Launcher writes launcher-status.json atomically on exit     │
│    5. Sleep 2s, repeat (or break if --once)                          │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ wave status --run-id <id> [--project <id>] [--lane <name>] [--json]  │
│                                                                      │
│  Purpose: Read-only state snapshot (no side effects)                 │
│  Reads supervisor/runs/<runId>/state.json and returns current state  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ wave wait --run-id <id> [--timeout-seconds <n>] [--json]             │
│                                                                      │
│  Purpose: Observational poll until terminal or timeout               │
│  Polls state.json every 2s                                           │
│  Returns when status ∈ {completed, failed} or deadline reached       │
│  Non-cancelling: timeout does NOT kill the run                       │
│  Sets process.exitCode from launcher exit code                       │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ wave attach --run-id <id> --project <id> --lane <name> ...           │
│                                                                      │
│  Purpose: Projection-only attach surface                             │
│  --agent <id> attaches to a live session when one exists, otherwise  │
│  follows the recorded agent log                                      │
│  --dashboard reuses the stable lane dashboard attach flow            │
│  Missing projection is an operator error, not a run-health verdict   │
└──────────────────────────────────────────────────────────────────────┘
```

### Run State Machine

```
      ┌─────────────────────────────────────────────┐
      │ "pending"                                   │
      │ • submittedAt set                           │
      │ • launcherPid: null, exitCode: null         │
      └──────────┬──────────────────────────────────┘
                 │ daemon claims run, spawns launcher
      ┌──────────▼──────────────────────────────────┐
      │ "running"                                   │
      │ • startedAt set                             │
      │ • launcherPid: <pid> (detached process)     │
      └──────────┬──────────────────────────────────┘
                 │ launcher writes launcher-status.json
                 │ OR launcher process dies unexpectedly
      ┌──────────▼──────────────────────────────────┐
      │ "completed" | "failed"                      │
      │ • completedAt set                           │
      │ • exitCode: <0|1|...>                       │
      └─────────────────────────────────────────────┘
```

### Daemon Lock and Lease Mechanism

Only one supervisor daemon runs per lane. The lock at `.tmp/<lane>-wave-launcher/supervisor/daemon.lock` contains:

```javascript
{
  supervisorId: "supervisor-<pid>-<random>",
  pid: 45821,
  project: "default",
  lane: "main",
  acquiredAt: "2024-03-22T10:30:00.000Z",
  heartbeatAt: "2024-03-22T10:30:15.000Z",     // renewed every poll cycle
  leaseExpiresAt: "2024-03-22T10:30:17.000Z"   // 15s from heartbeat
}
```

**Acquisition:** Try exclusive file create (`O_EXCL`). If the file exists:
- Read the existing lock
- Check if the PID is alive (`process.kill(pid, 0)`) AND the lease is fresh (`leaseExpiresAt > now`)
- If stale or dead: delete the lock, retry
- If alive and fresh: return `null` (daemon already running)

**Renewal:** Each poll cycle updates `heartbeatAt` and extends `leaseExpiresAt` by 15 seconds.

**Stale detection:** If `leaseExpiresAt < Date.now()` and PID is not responding to signal 0, the lock is considered stale and can be claimed by a new daemon.

### Launcher Spawning

When the daemon claims a pending run, it spawns the launcher as a **detached child process**:

```javascript
spawn('bash', ['-lc', wrapperCommand], {
  cwd: REPO_ROOT,
  detached: true,    // survives daemon exit
  stdio: "ignore",   // no parent I/O dependency
  env: { ...process.env, WAVE_SUPERVISOR_RUN_ID: runId }
});
child.unref();       // parent won't wait for exit
```

The wrapper shell command:
1. Runs `node wave-launcher.mjs <args>`
2. Redirects all output to `launcher.log`
3. Captures the exit code
4. Writes `launcher-status.json` atomically (the terminal state marker)

**Critical design choice:** `detached: true` + `unref()` means the launcher process survives even if the supervisor daemon dies. The daemon does not need to stay alive for the launcher to complete.

### Orphan Adoption

If the supervisor daemon dies and restarts (or a new daemon starts):

1. New daemon acquires the lock (old one is stale)
2. Scans `supervisor/runs/*/state.json` for runs in "running" state
3. For each running run:
   - Check `launcher-status.json`
     - If present: reconcile to `completed` or `failed` based on exit code
   - Else check if the launcher PID is alive (`process.kill(pid, 0)`)
     - If alive: the run is healthy, just supervise it
   - Else inspect any `agents/*.runtime.json`
     - If a runtime PID is alive or heartbeat is fresh: keep the run running with degraded terminal disposition
     - If all runtime records are terminal and no launcher status exists: mark as `failed` with detail "launcher exited before writing status"

This is conservative: the daemon only cleans up after confirming both that the PID is dead and the lease has expired.

### Supervisor State Files

All supervisor state lives under `.tmp/<lane>-wave-launcher/supervisor/`:

```
supervisor/
├── daemon.lock                     Daemon lease file
└── runs/
    └── <runId>/
        ├── request.json            Immutable: submitted request (never changes)
        ├── state.json              Mutable: current daemon snapshot
        ├── events.jsonl            Append-only: supervisor observation history
        ├── launcher-status.json    Atomic: launcher exit record (written once)
        └── launcher.log            Text: launcher stdout/stderr stream
        └── agents/
            └── <agentId>.runtime.json  Runtime pid/heartbeat/disposition snapshot (`agents/<agentId>.runtime.json`)
```

### Canonical Authority in Sandboxed Runs

The sandbox model adds a fourth observation layer but does not change the canonical authority set:

| Authority | What It Covers |
|-----------|---------------|
| Wave definitions | Declared work, closure roles, proof contracts |
| Coordination log | Workflow state, claims, evidence, blockers |
| Control-plane log | Entity lifecycle, proof bundles, gates |
| **Supervisor run state** | **Daemon-observed runtime facts (PIDs, exits, leases)** |

The supervisor state is authoritative for *what the daemon observed about process execution*. It does not override wave definitions or coordination state.

### Typical Sandbox Workflow

For operator setup in LEAPclaw, OpenClaw, Nemoshell, Docker, and similar short-lived exec environments, read [../guides/sandboxed-environments.md](../guides/sandboxed-environments.md) first. The example below shows the runtime shape, not the full operator checklist.

```bash
# Client: quick exit, daemon takes over
runId=$(wave submit --project backend --lane main \
  --executor codex --no-dashboard --json | jq -r .runId)

# Client: wait with timeout (non-cancelling)
wave wait --run-id "$runId" --project backend --lane main --timeout-seconds 600

# Or poll from external automation
wave status --run-id "$runId" --project backend --lane main --json
```

### Current Limitations

The sandbox supervisor model is functional but some design-doc features are still partial:

- **Per-agent runtime records** now exist and carry PID, PGID, heartbeat, runner metadata, and terminal disposition, and the supervisor can now recover completed runs from finalized progress journals or canonical run-state when the launcher exits late
- **Full orphan adoption** across daemon restarts remains partial; the daemon can continue supervising degraded runs, resume the active wave, and recover finalized status from canonical state, but it still refuses to synthesize success from agent runtime files alone
- **Tmux is now dashboard-only**. Agent execution uses detached process runners, `wave attach --agent` falls back to log following when no live interactive session exists, and dashboard attach falls back to the last written dashboard file when no live dashboard session is present
- **Setup guidance is split by intent**. Use [../guides/sandboxed-environments.md](../guides/sandboxed-environments.md) for operator setup, deployment, and container advice, and keep [../plans/sandbox-end-state-architecture.md](../plans/sandbox-end-state-architecture.md) for the deeper design rationale and remaining gap analysis

---

## 12. Runtime Abstraction and Executor Adapters

### What Stays the Same Across Runtimes

- Wave parsing and validation
- State reduction and phase decisions
- Eval targets, deliverables, proof artifacts
- Component and closure gates
- Skill resolution (resolved before executor projection)
- Shared summaries and inboxes
- Authority-set state and projections
- Trace bundles and replay

### Where Runtime-Specific Logic Lives

The `executors.mjs` module builds launch specs for each runtime:

**Codex** (`codex exec`):
- `--sandbox` flags (none, unsafe-full-access, danger-full-access)
- `--add-dir` for skill directory projection
- JSON mode, search, images support
- Full-access sandbox modes for repo-modifying work

**Claude** (`claude -p`):
- System prompt overlay via `--system-prompt`
- Settings merge from `.claude/settings.json`
- Hooks and permission model
- Skill text merged into system prompt

**OpenCode** (`opencode run`):
- Generated `opencode.json` configuration
- Attached files and instruction overlays
- Skill content projected through config

**LEAP-claw** (proprietary agent framework):
- Wave's orchestration substrate serves as the runtime for LEAP-claw agents
- LEAP-claw agents participate in the same blackboard coordination, proof, and closure model as any other executor
- Proprietary planning and reasoning strategies are layered on top of Wave's canonical authority set
- Skill projection, context compilation, and result envelope contracts apply identically
- LEAP-claw agents can be mixed with Codex, Claude, and OpenCode agents within the same wave via the runtime mix policy

**Local** (smoke executor):
- Prompt/closure verification without a real hosted runtime
- Used for testing and dry-run validation

### Runtime Resolution Order

When determining which executor an agent uses:

1. Explicit `### Executor` block in the agent's wave definition
2. Executor profile id from config
3. Lane role default from `wave.config.json`
4. CLI `--executor` flag
5. Global default executor

### Runtime Mix Policy

Waves can use multiple executors simultaneously. The config supports:
- Mix targets capping agents per executor
- Profiles declaring fallback chains
- Lane policy supplying role-based defaults
- Retry-time reassignment to policy-safe fallbacks

---

## 13. Skills, Context7, and Compiled Context

### Skills System

Skills are reusable operating knowledge bundles stored in `skills/<skill-id>/`:

```
skills/<skill-id>/
  skill.json           -- metadata: id, name, description, tags, roles, runtimes
  SKILL.md             -- reusable instructions (runtime-agnostic)
  adapters/
    codex.md           -- Codex-specific overlay
    claude.md          -- Claude-specific overlay
    opencode.md        -- OpenCode-specific overlay
    local.md           -- Local executor overlay
  references/          -- optional reference material
```

**Resolution order:**
1. Base skills (global)
2. Role-specific skills (e.g., `role-design/`, `role-implementation/`)
3. Runtime-specific skills (e.g., `runtime-claude/`, `runtime-codex/`)
4. Deploy-kind skills (e.g., `provider-railway/`)
5. Explicit per-agent `### Skills` in wave definition

The orchestrator resolves skill IDs without knowing the runtime. The executor adapter then projects skills into the runtime's surface:
- Codex: skill directories via `--add-dir`
- Claude: merged skill text in system prompt overlay
- OpenCode: instructions and attached files via generated config
- Local: prompt-only projections

### Context7

Context7 provides external documentation fetched at launch time. The integration works as:

1. `wave.config.json` declares a Context7 bundle index at `docs/context7/bundle-index.json`
2. Wave definitions can declare `### Context7` selections per agent
3. At launch, `prefetchContext7ForSelection()` fetches library documentation
4. Fetched content is cached in `.tmp/<lane>-wave-launcher/context7/`
5. Context7 content is injected into the agent's execution prompt

### Compiled Context

Rather than hand-maintaining separate context files for each runtime, Wave compiles context dynamically:

1. **Project profile** (`.wave/project-profile.json`): Repo-level defaults
2. **Shared summary**: Aggregated coordination state
3. **Per-agent inbox**: Filtered coordination state
4. **Skills**: Resolved and projected for the target runtime
5. **Context7**: External documentation fetched at launch
6. **Signal state**: Versioned signal projections for long-running agents
7. **Design packets**: Output from design-pass agents
8. **Message board**: Human-readable coordination projection

All of this is assembled into a single execution prompt per agent at launch time by `buildExecutionPrompt()` in `coordination.mjs`.

---

## 14. Entity Model

### Core Entities

| Entity | Lifecycle States | Purpose |
|--------|-----------------|---------|
| `wave_run` | planned -> running -> completed\|failed\|blocked | Top-level wave execution |
| `agent_run` | planned -> started -> completed\|failed\|timed_out\|cancelled | Per-agent execution |
| `attempt` | planned -> running -> completed\|failed\|cancelled | One execution pass (wave can have multiple) |
| `proof_bundle` | active -> superseded\|revoked | Proof evidence with SHA256 validation |
| `rerun_request` | active -> applied\|cleared | Operator-requested targeted reruns |
| `human_input` | pending -> assigned -> answered\|escalated\|resolved\|timed_out\|rerouted | Human feedback lifecycle |
| `gate` | pending -> passed\|blocked\|waived | Gate evaluation result |
| `task` | pending -> in_progress -> proven\|blocked -> completed | Durable work unit |
| `contradiction` | detected -> repair_needed -> resolved\|dismissed | Conflict between agents |
| `fact` | active -> superseded | Stable semantic facts with content hashing |
| `coordination_record` | open -> acknowledged -> in_progress -> resolved\|closed\|superseded\|cancelled | Workflow event |

### Task Entity

Tasks are first-class entities defined in `task-entity.mjs`:

- **Task types:** design, implementation, integration, documentation, cont-qa, cont-eval, security, component, helper, dependency, clarification, human-input, escalation
- **Closure states:** open -> owned_slice_proven -> wave_closure_ready -> closed (also: cancelled, superseded)
- **Lease states:** unleased -> leased -> released\|expired
- **Dependency edges:** Tasks can declare `blocks` and `blockedBy` relationships

The `evaluateOwnedSliceProven()` function checks all per-task closure conditions.

### Fact Lineage

Facts have stable semantic IDs with separate content hashing:
- `factId`: Stable identifier across versions
- `contentHash`: Changes when the fact's content changes
- `citedBy`, `contradictedBy`: Cross-referencing for lineage
- `supersedes`, `supersededBy`: Version chain

---

## 15. Artifact Hierarchy

Every artifact in the system belongs to exactly one of four classes:

### Class 1: Canonical Event Streams (append-only, never rewritten)

| Artifact | Path |
|----------|------|
| Control-plane log | `.tmp/<lane>-wave-launcher/control-plane/wave-<N>.jsonl` |
| Coordination log | `.tmp/<lane>-wave-launcher/coordination/wave-<N>.jsonl` |
| Cross-lane dependency tickets | `.tmp/wave-orchestrator/dependencies/<ticket-id>.json` |

### Class 2: Canonical Structured Snapshots (immutable, attempt-scoped)

| Artifact | Path |
|----------|------|
| Agent result envelopes | `.tmp/<lane>-wave-launcher/results/wave-<N>/attempt-<A>/<agentId>.json` |
| Design packets | `docs/plans/waves/design/` (repo-owned) |

### Class 3: Derived Caches (computed from canonical, safe to delete)

| Artifact | Path |
|----------|------|
| Shared summaries | `.tmp/<lane>-wave-launcher/coordination/wave-<N>-shared-summary.md` |
| Per-agent inboxes | `.tmp/<lane>-wave-launcher/inboxes/wave-<N>/<agentId>.md` |
| Assignment snapshots | `.tmp/<lane>-wave-launcher/assignments/wave-<N>.json` |
| Dependency snapshots | `.tmp/<lane>-wave-launcher/dependency-snapshots/wave-<N>.json` |
| Ledgers | `.tmp/<lane>-wave-launcher/ledger/wave-<N>.json` |
| Docs queues | `.tmp/<lane>-wave-launcher/docs-queue/wave-<N>.json` |
| Security summaries | `.tmp/<lane>-wave-launcher/security/wave-<N>.json` |
| Integration summaries | `.tmp/<lane>-wave-launcher/integration/wave-<N>.json` |

### Class 4: Human-Facing Projections (generated from canonical + derived)

| Artifact | Path |
|----------|------|
| Global dashboard | `.tmp/<lane>-wave-launcher/dashboards/global.json` |
| Per-wave dashboard | `.tmp/<lane>-wave-launcher/dashboards/wave-<N>.json` |
| Markdown boards | `.tmp/<lane>-wave-launcher/coordination/wave-<N>-board.md` |
| Status files | `.tmp/<lane>-wave-launcher/status/` |
| Trace bundles | `.tmp/<lane>-wave-launcher/traces/wave-<N>/attempt-<A>/` |
| Signal projections | `.tmp/<lane>-wave-launcher/signals/` |
| Proof registries | `.tmp/<lane>-wave-launcher/proof/wave-<N>.json` |
| Retry overrides | `.tmp/<lane>-wave-launcher/control/retry-override-wave-<N>.json` |

**Critical rule:** Decision-making modules (gates, retry, closure, reducer) read only Class 1 and Class 2 artifacts. Classes 3 and 4 exist for human operators and agent context injection.

---

## 16. Telemetry and Wave Control

### Local-First Model

Wave Control is a local-first telemetry system with optional remote delivery:

1. **Local event spool.** All events are first written to the local control-plane JSONL log.
2. **Queue for remote delivery.** Events are batched into a queue for the Wave Control service.
3. **Best-effort delivery.** Remote delivery is non-blocking. If it fails, the local spool is the authoritative record.
4. **Metadata-only by default.** The packaged default mode is `metadata-only`, sending only structured metadata (not full logs or source code).

### Event Types

The `wave-control-schema.mjs` module normalizes these entity types:
- `wave_run`, `agent_run`, `wave_signal`, `agent_signal`
- `coordination_record`, `task`, `attempt`, `gate`, `proof_bundle`
- `rerun_request`, `human_input`, `artifact`, `contradiction`, `fact`
- `benchmark_run`, `benchmark_item`, `verification`, `review`

### Configuration

```json
// wave.config.json
{
  "waveControl": {
    "enabled": true,
    "endpoint": "https://wave-control.up.railway.app/api/v1",
    "reportMode": "metadata-only",
    "authTokenEnvVar": "WAVE_API_TOKEN"
  }
}
```

Opt-out options:
- `waveControl.enabled: false` in config
- `waveControl.reportMode: "disabled"` in config
- `--no-telemetry` CLI flag

---

## 17. CLI Surface Map

### Command Groups

| Command | Module | Purpose |
|---------|--------|---------|
| `wave init` | `install.mjs` | Initialize workspace with Wave |
| `wave upgrade` | `install.mjs` | Upgrade existing Wave config |
| `wave self-update` | `install.mjs` | Update the Wave package |
| `wave doctor` | `install.mjs` | Validate workspace setup |
| `wave project setup` | `planner.mjs` | Save project defaults |
| `wave draft` | `planner.mjs` | Generate wave definitions |
| `wave launch` | `launcher.mjs` | Execute waves (core orchestrator) |
| `wave autonomous` | `autonomous.mjs` | Multi-wave autonomous execution |
| `wave submit` | `supervisor-cli.mjs` | Submit async run request |
| `wave supervise` | `supervisor-cli.mjs` | Long-running supervisor daemon |
| `wave status` | `supervisor-cli.mjs` | Read supervisor run state |
| `wave wait` | `supervisor-cli.mjs` | Wait for run completion |
| `wave control` | `control-cli.mjs` | Read-only status, task, rerun, proof, telemetry surfaces |
| `wave coord` | `coord-cli.mjs` | Direct coordination log inspection |
| `wave feedback` | `feedback.mjs` | Human feedback collection and delivery |
| `wave dashboard` | `dashboard-renderer.mjs` | Dashboard rendering and display |
| `wave retry` | `retry-cli.mjs` | Retry control (legacy, prefer `wave control rerun`) |
| `wave proof` | `proof-cli.mjs` | Proof registry (legacy, prefer `wave control proof`) |
| `wave dep` | `dep-cli.mjs` | Cross-lane dependency management |
| `wave adhoc` | `adhoc.mjs` | Ad-hoc transient runs |
| `wave benchmark` | `benchmark.mjs` | Benchmark execution and tracking |
| `wave local` | `local-executor.mjs` | Local smoke executor |

### Preferred Operator Surfaces

`wave control` is the preferred operator surface for runtime interaction:
- `wave control status` -- live state projection
- `wave control task` -- create, get, list, act on blocking items
- `wave control rerun` -- targeted rerun management
- `wave control proof` -- proof bundle management
- `wave control telemetry` -- event queue inspection

Legacy surfaces (`wave coord`, `wave retry`, `wave proof`) remain for direct log inspection but `wave control` is the recommended path.

---

## 18. Research Grounding

Wave's architecture is directly informed by published research on multi-agent systems, harness engineering, and coordination failure. The key sources and how they map to the architecture:

### Harness and Runtime

| Source | Architectural Influence |
|--------|------------------------|
| [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Anthropic) | Session supervisor design, structured status files, timeout handling |
| [Harness engineering: leveraging Codex](https://openai.com/index/harness-engineering/) (OpenAI) | Executor adapter model, sandbox modes, launch spec pattern |
| [Building Effective AI Coding Agents for the Terminal](https://arxiv.org/abs/2603.05344) | Terminal surface management, tmux session model, runtime overlays |
| [Verified Multi-Agent Orchestration](https://arxiv.org/abs/2603.11445) | Plan-execute-verify-replan maps to Wave's implementation-gate-retry-closure cycle |

### Coordination and Closure

| Source | Architectural Influence |
|--------|------------------------|
| [LLM-Based Multi-Agent Blackboard System](https://arxiv.org/abs/2510.01285) | Blackboard architecture pattern, shared state over direct messaging |
| [Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture](https://arxiv.org/abs/2507.01701) | Projection model (canonical state -> derived views -> human projections) |
| [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) | Failure taxonomy that Wave's gate stack addresses point by point |
| [Silo-Bench](https://arxiv.org/abs/2603.01045) | Integration barriers, dependency barriers, evidence pooling mechanisms |

### Skills and Context

| Source | Architectural Influence |
|--------|------------------------|
| [SoK: Agentic Skills](https://arxiv.org/abs/2602.20867) | Skill bundle format, resolution order, runtime projection |
| [Agent Workflow Memory](https://arxiv.org/abs/2409.07429) | Compiled context model, dynamic assembly over static files |
| [Agent READMEs](https://arxiv.org/abs/2511.12884) | Project profile, shared plan docs, per-agent context compilation |

### Evaluation and Benchmarking

| Source | Architectural Influence |
|--------|------------------------|
| [EvoClaw: Evaluating AI Agents on Continuous Software Evolution](https://arxiv.org/abs/2603.13428) | Adapted as `evoclaw-style-sequence` benchmark family for measuring long-horizon wave sequencing, dependent wave maintenance, and error accumulation across wave chains |
| [VeRO: An Evaluation Harness for Agents to Optimize Agents](https://arxiv.org/abs/2602.22480) | Proof-oriented evaluation model, benchmark validity buckets, review entity types |
| [MetaClaw: Just Talk](https://arxiv.org/abs/2603.17187) | Failure-driven skill synthesis, zero-downtime evolution of agent capabilities (referenced via OpenClaw platform) |

**Note on naming:** LEAP-claw is the proprietary agent framework built on Wave's orchestration substrate. OpenClaw, EvoClaw, and MetaClaw are unrelated external projects: OpenClaw is an open-source multi-agent platform, EvoClaw and MetaClaw are research papers. Wave adapts their evaluation methodologies into its benchmark catalog (`docs/evals/external-benchmarks.json`) but does not embed or depend on their codebases. The `leap-claw` identifier also appears in test fixtures as a lane name for integration testing.

### Known Gaps

The architecture addresses the documented failure modes structurally but empirical validation is still in progress:
- Limited published results on coordination-oriented benchmarks exercised systematically
- Stress data on simultaneous coordination under contention is limited
- Expertise routing is explicit but shallow (declared capability, not demonstrated quality)
- DPBench-style simultaneous coordination is only indirectly addressed

---

## Appendix: Key File Paths

```
Entry point:           scripts/wave.mjs
Core orchestrator:     scripts/wave-orchestrator/launcher.mjs
Phase engines:         scripts/wave-orchestrator/{implementation,derived-state,gate,closure,retry}-engine.mjs
State reducer:         scripts/wave-orchestrator/wave-state-reducer.mjs
Session supervisor:    scripts/wave-orchestrator/session-supervisor.mjs
Supervisor CLI:        scripts/wave-orchestrator/supervisor-cli.mjs
Projection writer:     scripts/wave-orchestrator/projection-writer.mjs
Wave parser:           scripts/wave-orchestrator/wave-files.mjs
Reconcile formatting:  scripts/wave-orchestrator/reconcile-format.mjs
Agent state:           scripts/wave-orchestrator/agent-state.mjs
Task entities:         scripts/wave-orchestrator/task-entity.mjs
Coordination store:    scripts/wave-orchestrator/coordination-store.mjs
Control plane:         scripts/wave-orchestrator/control-plane.mjs
Executor adapters:     scripts/wave-orchestrator/executors.mjs
Skills:                scripts/wave-orchestrator/skills.mjs
Context7:              scripts/wave-orchestrator/context7.mjs
Config:                scripts/wave-orchestrator/config.mjs
Result envelopes:      scripts/wave-orchestrator/result-envelope.mjs
Contradictions:        scripts/wave-orchestrator/contradiction-entity.mjs
Signals:               scripts/wave-orchestrator/signals.mjs
Traces:                scripts/wave-orchestrator/traces.mjs
Tests:                 test/wave-orchestrator/*.test.ts (61 files)
Wave config:           wave.config.json
Wave definitions:      docs/plans/waves/wave-<N>.md
Skills bundles:        skills/<skill-id>/
Run state:             .tmp/<lane>-wave-launcher/run-state.json
Supervisor state:      .tmp/<lane>-wave-launcher/supervisor/
Supervisor daemon lock: .tmp/<lane>-wave-launcher/supervisor/daemon.lock
Supervisor runs:       .tmp/<lane>-wave-launcher/supervisor/runs/<runId>/
Sandbox setup guide:   docs/guides/sandboxed-environments.md
Sandbox architecture:  docs/plans/sandbox-end-state-architecture.md
```
