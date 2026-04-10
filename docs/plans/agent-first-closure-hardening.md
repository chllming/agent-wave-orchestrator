---
title: "Agent-First Closure Hardening"
summary: "Patch plan for lenient closure signal ingestion, deterministic closure adjudication, and clearer runtime state in the Wave orchestrator."
---

# Agent-First Closure Hardening

## Summary

Wave currently holds a strong line on closure quality, which is correct, but some of that strictness sits in the wrong layer.

Today the runtime is strict about marker transport and syntax in `agent-state.mjs`, but relatively coarse in how it projects runtime state after the agent work is already over. That creates a bad failure mode for agent-operated runs:

- the work is actually done
- deliverables and proof artifacts are present
- the only failure is malformed or incomplete closure markers
- the runtime persists a relaunch plan
- `wave control status` can still look like `running` or "not done"
- operators end up manually judging closure even though the orchestrator already has enough evidence to do most of that deterministically

This plan hardens closure for agent-driven use without lowering semantic quality bars. The core change is to make closure transport more forgiving, keep semantic proof requirements strict, and introduce a deterministic adjudication layer before any rework or relaunch plan is persisted.

## Problem Statement

The current runtime has three related issues.

### 1. Marker transport is stricter than closure semantics

Implementation closure currently depends on exact structured marker parsing in `scripts/wave-orchestrator/agent-state.mjs`.

- `buildAgentExecutionSummary()` extracts `[wave-proof]`, `[wave-doc-delta]`, and `[wave-component]` markers with regex-only parsing.
- `validateImplementationSummary()` treats malformed or missing structured markers as terminal closure failures.
- `validateDocumentationClosureSummary()` already has a more pragmatic fallback for empty documentation runs, but implementation closure does not.

That asymmetry means the runtime already accepts deterministic closure leniency in some places, but not in the place where CLI agents are most likely to make transport mistakes.

### 2. Closure transport failures escalate too quickly into relaunch plans

`scripts/wave-orchestrator/retry-engine.mjs` currently folds agent closure failures into `closureGate` selection logic. Once that relaunch state is persisted, `scripts/wave-orchestrator/control-cli.mjs` can surface it as the dominant blocking edge.

That is the right behavior for real semantic failures, but it is too aggressive for syntax-only or transport-only failures where the runtime can still prove that the owned work landed correctly.

### 3. Runtime status conflates live execution with unresolved closure

The current dashboard and control projection can leave a wave feeling "running" even after the launcher and agent processes are no longer doing work.

The runtime needs to distinguish:

- agent execution is still active
- closure evidence is incomplete or ambiguous
- a controller or relaunch plan exists but no process is live

Without that split, agent operators see "not done" when what they really have is "done, pending adjudication" or "done, closure blocked."

## Goals

- Keep closure quality high for semantic proof, deliverables, component promotions, and shared-state coherence.
- Make structured signal ingestion tolerant of key ordering, extra fields, and equivalent state spellings.
- Run deterministic closure adjudication before creating relaunch plans for transport-only failures.
- Expose runtime state so completed agent execution is never mislabeled as ongoing work.
- Improve the CLI surface for Codex, Claude Code, and OpenCode so they do not need to hand-type fragile marker lines.
- Keep the existing marker-based contract backward compatible during rollout.

## Non-Goals

- Do not auto-close waves that still have semantic proof gaps, missing deliverables, missing proof artifacts, or unresolved blocking coordination.
- Do not replace the current closure sweep with an LLM judge as the primary source of truth.
- Do not require repositories to migrate their wave files immediately.
- Do not remove the existing `[wave-*]` markers in the first rollout.

## Design Principles

### Semantic strictness, transport leniency

The orchestrator should remain strict about whether the work is actually proven. It should become more forgiving only about how agents express that proof.

### Deterministic first, specialist fallback second

If the runtime already has enough evidence to make a safe closure decision, it should do so itself. A specialist judge runtime should only run when the deterministic layer cannot decide.

### Execution state is not closure state

The operator surface should tell an agent whether the run is still working, whether closure is still evaluating, and whether the controller is simply holding a relaunch plan.

### Agent ergonomics are a product requirement

Wave is primarily operated through agents. The ergonomics should fit a CLI-driving coding agent, not assume a careful human operator babysitting marker syntax.

## Proposal

## 1. Replace regex-only signal parsing with normalized structured signal ingestion

### Current surface

The current extraction path in `scripts/wave-orchestrator/agent-state.mjs` is regex-driven:

- `WAVE_PROOF_REGEX`
- `WAVE_DOC_DELTA_REGEX`
- `WAVE_DOC_CLOSURE_REGEX`
- `WAVE_INTEGRATION_REGEX`
- `WAVE_COMPONENT_REGEX`

This is brittle when agents emit valid intent with slightly different key order or extra keys.

### Patch

Add a normalized structured signal parser that treats each `[wave-*]` line as:

- a marker type
- an unordered key/value map
- an optional free-text suffix

Implementation shape:

- add `scripts/wave-orchestrator/structured-signal-parser.mjs`
- move signal normalization into reusable functions such as:
  - `parseWaveSignalLine(line)`
  - `normalizeWaveProofSignal(record)`
  - `normalizeWaveDocDeltaSignal(record)`
  - `normalizeWaveComponentSignal(record)`
  - `normalizeWaveIntegrationSignal(record)`
- keep the existing regexes as compatibility parsers for older logs and edge cases

### Parsing rules

- Required keys remain required.
- Unknown keys are ignored for gating but preserved in diagnostics.
- Key order is irrelevant.
- Equivalent spellings are normalized:
  - `state=complete` -> `state=met`
  - optional aliases may be accepted where unambiguous
- Extra keys do not invalidate the marker.
- The normalized parser should accept lines that the current regex rejects when the required semantic fields are still present.

### Diagnostics

Extend `structuredSignalDiagnostics` so it records:

- `rawCount`
- `acceptedCount`
- `normalizedCount`
- `rejectedCount`
- rejected samples
- accepted-but-normalized samples
- unknown keys seen

This preserves debuggability while making transport more resilient.

### Backward compatibility

`buildAgentExecutionSummary()` should prefer normalized records when present, then fall back to regex-derived legacy parsing. Existing marker lines remain valid.

## 2. Add explicit closure transport versus semantic failure classification

### Current surface

`validateImplementationSummary()` in `scripts/wave-orchestrator/agent-state.mjs` currently returns terminal failures such as:

- `missing-wave-proof`
- `invalid-wave-proof-format`
- `missing-doc-delta`
- `invalid-doc-delta-format`
- `missing-wave-component`
- `invalid-wave-component-format`

Those are all treated similarly by downstream retry logic even though they are not equally severe.

### Patch

Introduce a formal closure failure taxonomy:

- `transport-failure`
  Marker missing, malformed, or only partially parseable.
- `semantic-failure`
  Marker is valid but says the proof is insufficient.
- `artifact-failure`
  Required deliverable or proof artifact is missing.
- `state-failure`
  Shared closure state is contradictory or blocking.

Implementation shape:

- extend validation results in `agent-state.mjs` with:
  - `failureClass`
  - `eligibleForAdjudication`
  - `adjudicationHint`

Examples:

- `invalid-wave-proof-format` -> `failureClass: "transport-failure"`
- `missing-wave-proof` with exit code `0`, deliverables present, proof artifacts present -> `failureClass: "transport-failure"`
- `wave-proof-gap` -> `failureClass: "semantic-failure"`
- `missing-deliverable` -> `failureClass: "artifact-failure"`

This gives downstream engines enough shape to react proportionally.

## 3. Add deterministic closure adjudication before relaunch

### Current surface

`scripts/wave-orchestrator/closure-engine.mjs` forwards some closure blockers, and `scripts/wave-orchestrator/retry-engine.mjs` can turn them into a relaunch plan. There is no deterministic layer that asks: "is the work actually proven despite a bad marker?"

### Patch

Add a new deterministic adjudication module:

- `scripts/wave-orchestrator/closure-adjudicator.mjs`

Primary interface:

- `evaluateClosureAdjudication({ wave, lanePaths, gate, summary, derivedState, agentRun, envelope, options })`

Outputs:

- `status: "pass"`
- `status: "rework-required"`
- `status: "ambiguous"`
- `reason`
- `evidence`
- `synthesizedSignals`

### Eligibility rules

Only attempt deterministic adjudication when all of the following are true:

- the failure class is `transport-failure`
- the agent exit code is `0`
- required deliverables exist
- required proof artifacts exist
- there is no explicit negative semantic signal such as `wave-proof-gap`
- there is no unresolved blocking coordination owned by the same closure slice that would still fail the wave

### Evidence sources

The adjudicator may use:

- result envelopes
- deliverable existence summaries
- proof artifact existence summaries
- component matrix expectations
- derived integration and documentation state
- structured diagnostics
- explicit negative gap markers

It should not inspect free-form narration as primary truth when durable artifacts already exist.

### Adjudication outcomes

#### `pass`

If the work is semantically proven and only the transport failed:

- closure succeeds
- the gate result is marked as adjudicated
- a normalized synthetic signal record may be stored for replay/debugging
- no relaunch plan is created

#### `rework-required`

If the evidence is clear that the closure contract is not met:

- preserve current relaunch behavior

#### `ambiguous`

If the deterministic layer cannot decide:

- do not report the wave as still running
- mark closure as awaiting adjudication or specialist review
- only then consider a specialist judge runtime or explicit rerun policy

### Persistence

Persist deterministic adjudication artifacts under a new path:

- `.tmp/<lane>-wave-launcher/closure/wave-<n>/attempt-<a>/<agent>.json`

That keeps replay and postmortems explainable.

## 4. Use the adjudicator inside gate and closure sequencing

### `gate-engine.mjs`

Add adjudication handling to implementation-gate reads, following the same spirit as the existing documentation auto-close path.

Patch points:

- implementation gate readers should call the adjudicator when validation returns `eligibleForAdjudication`
- returned gate payloads should carry:
  - `adjudicated: true|false`
  - `adjudicationStatus`
  - `adjudicationArtifactPath`

This gives implementation closure the same kind of pragmatic recovery path that documentation closure already has for empty runs.

### `closure-engine.mjs`

Refine forwarding behavior:

- keep forwarding true semantic proof gaps
- do not forward transport-only failures as closure-critical blockers before adjudication
- add a new intermediate stage status such as `awaiting-adjudication`

`isForwardableClosureGap()` should stop treating every proof-related failure the same way. It should forward only semantic gaps or adjudication-confirmed failures.

## 5. Change retry planning so transport failures do not immediately become relaunch plans

### Current surface

`retry-engine.mjs` computes `closureGate` from selected-agent failures without distinguishing syntax-only failures from true rework conditions.

### Patch

Update retry planning to use the new failure taxonomy:

- `transport-failure` + adjudication pending -> do not create relaunch plan yet
- `transport-failure` + adjudication pass -> no relaunch plan
- `transport-failure` + adjudication ambiguous -> create a narrower adjudication or judge action, not a general relaunch
- `semantic-failure` or `artifact-failure` -> preserve current relaunch planning behavior

Add a more precise reason bucket split:

- `closureTransport`
- `closureSemantic`
- `closureArtifacts`
- `closureState`

This keeps the retry engine honest about what actually failed.

## 6. Split execution, closure, and controller state in status projections

### Current surface

`control-cli.mjs`, `dashboard-state.mjs`, and the dashboard schema mostly project a single top-level "running-like" state. That is not enough once closure and live process state diverge.

### Patch

Introduce explicit projected state fields:

- `executionState`
  - `pending`
  - `active`
  - `settled`
- `closureState`
  - `pending`
  - `evaluating`
  - `awaiting-adjudication`
  - `blocked`
  - `passed`
  - `failed`
- `controllerState`
  - `active`
  - `idle`
  - `stale`
  - `relaunch-planned`

Top-level `status` can remain for compatibility, but it should be derived from those three states instead of hiding them.

### Projection rules

- If no launcher process is live and no agent runtime is live, `executionState` must not be `active`.
- A persisted relaunch plan without a live launcher should project `controllerState: "relaunch-planned"`, not imply active execution.
- A wave with all agent processes done and only transport-level closure ambiguity should project `closureState: "awaiting-adjudication"`.

### Module impact

- `scripts/wave-orchestrator/control-cli.mjs`
- `scripts/wave-orchestrator/dashboard-state.mjs`
- `scripts/wave-orchestrator/artifact-schemas.mjs`
- possibly `scripts/wave-orchestrator/session-supervisor.mjs` for stronger live-runtime detection

## 7. Add agent-friendly signal helper commands

### Current surface

Agents currently have to type fragile marker lines directly into their terminal output.

### Patch

Add a `wave signal` family to the CLI:

- `pnpm exec wave signal proof --completion <level> --durability <level> --proof <level> --state <state> --detail "..."`
- `pnpm exec wave signal doc-delta --state <state> --path <file> --detail "..."`
- `pnpm exec wave signal component --id <component> --level <level> --state <state> --detail "..."`
- `pnpm exec wave signal integration --state <state> --claims <n> --conflicts <n> --blockers <n> --detail "..."`
- `pnpm exec wave signal doc-closure --state <state> --path <file> --detail "..."`

Behavior:

- print the canonical marker line to stdout so it lands in the captured log
- optionally support `--json` for machine-driven wrappers
- optionally support `--append-file <path>` for direct marker-file output in environments that want it

This is intentionally small. It reduces agent error without forcing a breaking transport rewrite.

### Docs impact

Update:

- `docs/reference/cli-reference.md`
- `docs/guides/signal-wrappers.md`
- `docs/reference/coordination-and-closure.md`

## 8. Add a specialist closure judge only as the last fallback

### Why not first

A specialist judge runtime is useful, but it should not become the main closure authority. If used too early, it becomes an expensive manual-review simulator and weakens deterministic reproducibility.

### Patch

Add an optional specialist adjudication mode behind config:

- `closurePolicy.adjudication.specialistJudge.enabled`
- `closurePolicy.adjudication.specialistJudge.thresholds`
- `closurePolicy.adjudication.specialistJudge.executorProfile`

When to use it:

- deterministic adjudication returns `ambiguous`
- closure ambiguity has lasted beyond a configured timeout
- the wave is otherwise settled

What it should do:

- evaluate the specific closure contract for the blocked slice
- emit one of:
  - `pass`
  - `rework-required`
  - `insufficient-evidence`

What it should not do:

- re-implement code
- reopen the whole wave
- override clear semantic failures

This makes the judge a narrow specialist, not the default closure judge for every bad marker.

## Module-Level Patch Map

## `scripts/wave-orchestrator/agent-state.mjs`

- adopt the normalized structured signal parser
- enrich diagnostics
- extend validation payloads with failure classes and adjudication eligibility
- preserve current status codes for compatibility while adding richer metadata

## `scripts/wave-orchestrator/structured-signal-parser.mjs`

- new shared parser/normalizer for `[wave-*]` lines
- house alias normalization, unknown-key handling, and diagnostics support

## `scripts/wave-orchestrator/gate-engine.mjs`

- invoke deterministic adjudication for implementation transport failures
- expose adjudicated closure results in gate payloads
- mirror the existing documentation fallback style for implementation closure where safe

## `scripts/wave-orchestrator/closure-engine.mjs`

- stop forwarding transport-only failures as closure-critical gaps before adjudication
- add `awaiting-adjudication` flow
- persist adjudication state into traceable closure artifacts

## `scripts/wave-orchestrator/closure-adjudicator.mjs`

- new deterministic adjudication layer
- evaluate artifact-backed proof for syntax-only closure failures

## `scripts/wave-orchestrator/retry-engine.mjs`

- distinguish transport, semantic, artifact, and state failures
- avoid relaunch plans when adjudication can still resolve the issue
- persist narrower adjudication intent where appropriate

## `scripts/wave-orchestrator/control-cli.mjs`

- project `executionState`, `closureState`, and `controllerState`
- stop surfacing persisted relaunch plans as if work is still actively running
- add `wave signal ...` subcommands
- optionally add `wave control adjudication get --lane <lane> --wave <n> --json`

## `scripts/wave-orchestrator/dashboard-state.mjs`

- project settled-versus-active execution cleanly
- distinguish closure evaluation from live runtime progress

## `scripts/wave-orchestrator/session-supervisor.mjs`

- tighten live-process detection so status surfaces can tell when the controller is no longer active

## `scripts/wave-orchestrator/artifact-schemas.mjs`

- version and normalize the new projected state fields and adjudication artifacts

## Docs

- `docs/reference/coordination-and-closure.md`
- `docs/reference/cli-reference.md`
- `docs/guides/signal-wrappers.md`
- `docs/plans/wave-orchestrator.md`

## Rollout Plan

### Phase 1: transport hardening

- land normalized structured signal parsing
- keep current regex parsing as compatibility fallback
- add new diagnostics fields
- no change yet to retry policy

### Phase 2: deterministic adjudication

- land `closure-adjudicator.mjs`
- wire implementation transport failures through adjudication before relaunch planning
- persist adjudication artifacts

### Phase 3: status projection split

- add `executionState`, `closureState`, and `controllerState`
- update `wave control status`, dashboards, and artifact schemas
- keep legacy top-level status fields for compatibility

### Phase 4: agent ergonomics

- add `wave signal ...` commands
- update docs and starter prompts to recommend helper usage

### Phase 5: specialist judge fallback

- add optional judge runtime only for unresolved ambiguous cases after deterministic adjudication

## Test Plan

### Unit tests

- parser accepts reordered proof keys
- parser accepts extra unknown keys
- parser normalizes `state=complete` to `met`
- parser still accepts existing canonical marker lines unchanged
- parser rejects truly incomplete proof markers
- validation classifies malformed markers as `transport-failure`
- validation classifies proof gaps as `semantic-failure`

### Integration tests

- implementation agent with exit code `0`, deliverables present, proof artifacts present, malformed proof marker, and coherent derived state is auto-adjudicated to pass
- implementation agent with malformed marker but missing deliverable still fails
- implementation agent with explicit `[wave-gap]` or `wave-proof-gap` still fails
- relaunch plan is not written for adjudication-pass cases
- a settled wave with only unresolved closure ambiguity projects `executionState: settled`, not active running
- `wave control status` shows `controllerState: relaunch-planned` when a relaunch plan exists but no live runtime is active

### Regression tests

- preserve current documentation auto-close behavior for empty doc runs
- preserve current semantic failure behavior for real proof gaps
- preserve replay compatibility with older logs and envelopes

### Eval additions

Add or extend eval coverage for:

- marker transport failure with semantically complete work
- stale relaunch plan with no live processes
- ambiguous closure requiring specialist adjudication

## Risks And Mitigations

### Risk: accidental premature closure

Mitigation:

- adjudication is only allowed for transport failures
- deliverables and proof artifacts must still exist
- explicit negative proof signals still fail closed
- component and shared-state gates remain active

### Risk: status surface churn for existing tooling

Mitigation:

- keep legacy top-level `status`
- add new fields as additive schema changes first
- document projection precedence clearly

### Risk: helper CLI commands add another surface to maintain

Mitigation:

- keep helpers thin
- have helpers emit the same canonical marker lines already used today
- do not require helper adoption on day one

## Recommended Success Criteria

- closure transport errors stop causing unnecessary relaunches when evidence already proves the work landed
- `wave control status` no longer implies active work when the system is only waiting on closure adjudication or a stale relaunch decision
- agent-authored runs require fewer manual closure fixes
- documentation fallback behavior and implementation closure behavior follow the same design philosophy
- specialist judge runtimes are rare, narrow, and explainable

## Suggested Execution Order

1. land normalized signal parsing plus richer diagnostics
2. land deterministic adjudication for implementation closure
3. land state projection split for control status and dashboards
4. land `wave signal ...` helper commands
5. add optional specialist judge fallback

That order keeps risk low and makes each step independently reviewable.
