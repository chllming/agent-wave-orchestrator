# Wave 1 - Phase Engine Extraction and Authority Model

**Commit message**: `Arch: extract phase engines and establish canonical authority set`

## Component promotions

- wave-parser-and-launcher: baseline-proved
- closure-sweep-and-role-gates: baseline-proved
- state-artifacts-and-feedback: repo-landed

## Context7 defaults

- bundle: node-typescript
- query: "Node.js module extraction, event sourcing patterns, and vitest test migration"

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
- Verify that the phase engine extraction preserves the full public API surface and that authority boundaries are correct.

Required context before coding:
- Read docs/plans/end-state-architecture.md (sections: Design Principles, Module Architecture, Canonical Authority Set).
- Read docs/reference/repository-guidance.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

Specific expectations:
- confirm all re-exports from launcher.mjs still resolve to the correct phase engine
- confirm no phase engine reads from derived caches or projections as decision input
- confirm gate engine and retry engine do not emit observed lifecycle events (only intent)
- confirm control-plane events and coordination records are the only append-only stores
- do not PASS if launcher.mjs still contains decision logic that belongs in a phase engine

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-1-cont-qa.md
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
Synthesize the phase engine extraction before documentation and cont-QA closure.

Required context before coding:
- Read docs/plans/end-state-architecture.md.
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/master-plan.md, docs/plans/current-state.md, and docs/plans/migration.md.

Verify:
- no circular dependencies between phase engine modules
- supervisor is the only module that interacts with processes, terminals, or the filesystem for non-canonical writes
- derived-state engine reads only from canonical state, never from its own prior outputs
- all gate evaluations are side-effect-free

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-1.md
- .tmp/main-wave-launcher/integration/wave-1.json
```

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- id: opencode
- opencode.files: docs/plans/end-state-architecture.md,docs/plans/current-state.md,docs/plans/wave-orchestrator.md

### Context7

- bundle: none

### Prompt

```text
Update shared plan docs to reflect the landed phase engine architecture.

Required context before coding:
- Read docs/plans/end-state-architecture.md.
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/plans/wave-orchestrator.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
```

## Agent A1: Phase Engine Extraction — Gate Engine

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.config: model_reasoning_effort=medium
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "Node.js module extraction, ES module imports and re-exports, vitest test patterns"

### Components

- closure-sweep-and-role-gates

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/launcher-gates.mjs
- test/wave-orchestrator/launcher-gates.test.ts

### Prompt

```text
Complete the gate engine extraction from launcher.mjs.

The in-progress worktree has already extracted launcher-gates.mjs with 19 functions.
Finish the extraction:

1. Verify all gate evaluation functions are pure (read-only, no side effects).
2. Ensure gate functions never read from derived caches (shared summaries, dashboards, retry overrides) — only from canonical state (control-plane events, coordination records, agent result files).
3. Ensure buildGateSnapshot orchestrates all gates and returns structured verdicts.
4. Write comprehensive tests covering each gate independently.
5. The gate engine must NOT emit observed lifecycle events. It returns verdicts; the caller writes events.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Phase Engines, gate-engine).
- Read scripts/wave-orchestrator/launcher-gates.mjs (current state).
- Read scripts/wave-orchestrator/launcher.mjs (remaining launcher).
- Read test/wave-orchestrator/launcher.test.ts (existing gate tests to migrate).

File ownership (only touch these paths):
- scripts/wave-orchestrator/launcher-gates.mjs
- test/wave-orchestrator/launcher-gates.test.ts
```

## Agent A2: Phase Engine Extraction — Retry Engine

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript

### Components

- wave-parser-and-launcher

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: none

### Deliverables

- scripts/wave-orchestrator/launcher-retry.mjs
- test/wave-orchestrator/launcher-retry.test.ts

### Prompt

```text
Complete the retry engine extraction from launcher.mjs.

The in-progress worktree has already extracted launcher-retry.mjs with 16 functions.
Finish the extraction:

1. Verify all retry planning functions are deterministic from stored state.
2. The retry engine reads from control-plane materialization and gate verdicts, never from override files as primary input.
3. Override files (.tmp/<lane>-wave-launcher/control/) become write-only compatibility caches — the retry engine writes them for legacy CLI compatibility but never reads them for decisions.
4. Ensure the retry plan contract is explicit: why resuming, what invalidated, what proof reusable, what closure stage to resume from, what executor changes allowed, what human inputs block resume.
5. Write tests that exercise retry planning from stored state without launching processes.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Phase Engines, retry-engine).
- Read scripts/wave-orchestrator/launcher-retry.mjs (current state).
- Read scripts/wave-orchestrator/retry-control.mjs (existing retry primitives).

File ownership (only touch these paths):
- scripts/wave-orchestrator/launcher-retry.mjs
- test/wave-orchestrator/launcher-retry.test.ts
```

## Agent A3: Phase Engine Extraction — Derived State and Supervisor

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

- scripts/wave-orchestrator/launcher-derived-state.mjs
- scripts/wave-orchestrator/launcher-supervisor.mjs
- test/wave-orchestrator/launcher-derived-state.test.ts
- test/wave-orchestrator/launcher-supervisor.test.ts

### Prompt

```text
Complete the derived-state engine and session supervisor extraction.

The in-progress worktree has:
- launcher-derived-state.mjs (915 lines, 16 functions)
- launcher-supervisor.mjs (704 lines, 14 functions)

Finish the extraction:

Derived-state engine:
1. Verify it reads only from canonical state (coordination log, control-plane events).
2. Verify it never reads from its own prior outputs.
3. All path builders are co-located in this module.

Session supervisor:
1. Confirm it is the ONLY module that launches processes, manages tmux sessions, writes to terminals, or handles PID tracking.
2. Human feedback monitoring stays here for process observation, but human-input workflow semantics (SLA, reroute, escalation, timeout policy, closure blocking) must remain in the control-plane event model and reducer — not in the supervisor.
3. The supervisor emits observed lifecycle events (agent_run.started, agent_run.completed) — planning engines only emit intent.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (sections: Session Supervisor, Layer 3).
- Read scripts/wave-orchestrator/launcher-derived-state.mjs (current state).
- Read scripts/wave-orchestrator/launcher-supervisor.mjs (current state).

File ownership (only touch these paths):
- scripts/wave-orchestrator/launcher-derived-state.mjs
- scripts/wave-orchestrator/launcher-supervisor.mjs
- test/wave-orchestrator/launcher-derived-state.test.ts
- test/wave-orchestrator/launcher-supervisor.test.ts
```

## Agent A4: Thin Launcher Orchestrator

### Executor

- id: codex
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude

### Context7

- bundle: node-typescript

### Components

- wave-parser-and-launcher

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/launcher.mjs
- test/wave-orchestrator/launcher.test.ts

### Prompt

```text
Reduce launcher.mjs to a thin orchestrator that delegates all decisions to phase engines.

After A1-A3 complete their extractions, launcher.mjs should contain only:
1. CLI argument parsing (parseArgs).
2. The wave-level control loop that wires phase engines in order.
3. Re-exports for backward compatibility.

The orchestration loop should follow this pattern:
  a. reducer.rebuild() → current state
  b. retry-engine.plan() → retry decisions
  c. implementation-engine.select() → run selections (emit intent, not observed events)
  d. derived-state-engine.materialize() → projections
  e. supervisor.launch() → agent sessions (supervisor emits agent_run.started)
  f. supervisor.wait() → completion (supervisor emits agent_run.completed)
  g. gate-engine.evaluate() → gate verdicts
  h. closure-engine.sequence() → closure phases
  i. projection-writer.write() → dashboards, traces

Verify:
- launcher.mjs has no direct fs writes to derived caches or dashboards
- launcher.mjs does not parse log tails or read status files directly
- all existing tests pass via re-exported symbols
- the public CLI surface is unchanged

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Layer 4 — Launcher Orchestrator).
- Read scripts/wave-orchestrator/launcher.mjs (current state in worktree).

File ownership (only touch these paths):
- scripts/wave-orchestrator/launcher.mjs
- test/wave-orchestrator/launcher.test.ts
```
