# Architecture Hardening Migration

This document is the staged cutover plan from the legacy launcher-centric runtime to the end-state architecture described in [end-state-architecture.md](./end-state-architecture.md).

The target model is fixed:

- decisions come from the canonical authority set, not from projections
- the reducer is deterministic and replayable
- gate and closure reads are result-envelope-first
- the launcher is a thin orchestrator over explicit phase engines plus the session supervisor

## Invariants

These rules stay true at every migration stage:

- Canonical authority set:
  wave definitions, the coordination log, and the control-plane event log are the authoritative decision inputs.
- Immutable structured snapshots:
  attempt-scoped result envelopes are the canonical structured output surface for completed agent work.
- Projection-only rule:
  dashboards, boards, summaries, inboxes, ledgers, proof registries, retry overrides, and status files are derived outputs only.
- Deterministic replay:
  the reducer must rebuild the same wave state from the same inputs with no random ids or launch-time side effects.
- Thin-launcher direction:
  the launcher may sequence engines and invoke the supervisor, but it must not remain the long-term decision brain.

## Baseline And Parity Gate

Every stage must preserve the shipped `0.7.3` behavior where the shared release-era suite overlaps.

Required baseline checks:

```bash
pnpm test
node scripts/wave.mjs doctor --json
node scripts/wave.mjs launch --lane main --dry-run --no-dashboard
```

Required parity checks:

- keep the shared `v0.7.3` release-era suites green
- preserve the CLI and runtime artifact contracts already shipped in `0.7.3`
- require any new architecture-only tests to be additive, not replacements for release parity

Rollback rule:

- if a migration stage breaks the baseline or parity checks, revert that stage to shadow or compatibility mode before taking the next cutover step

## Staged Cutover

### Stage 0: Baseline Lock

Objective:
capture the current parity baseline and make the architecture vocabulary explicit in docs, prompts, skills, and tests.

Work:

- lock the `0.7.3` parity suite and validation commands
- document the authority-set model and thin-launcher target everywhere operators and agents read first
- add wording guardrails so the repo stops reintroducing launcher-as-brain language

Exit criteria:

- baseline and parity checks pass
- active docs, prompts, and skills use the same authority-set vocabulary

### Stage 1: Shadow Reducer With Diff Reporting

Objective:
run the reducer on live canonical inputs and compare its view against the compatibility decision path without making reducer output authoritative yet.

Work:

- compute reducer snapshots during live runs
- persist machine-readable diffs for helper assignments, blockers, retry targets, contradiction state, and closure readiness
- treat mismatches as regression signals, not silent telemetry

Proof artifacts:

- reducer shadow test coverage
- replay fixtures that rebuild the same state from stored canonical inputs

Exit criteria:

- repeated live and replay runs show stable reducer output
- high-value decision slices have zero unexplained shadow diffs

Rollback trigger:

- non-deterministic reducer output or persistent unexplained diffs in helper-assignment, retry, or closure slices

### Stage 2: Reducer-Authoritative Helper Assignment And Retry

Objective:
promote the reducer to authority for a narrow but critical slice before broader cutover.

Decision owner:

- helper-assignment blocking state
- retry target selection and resume-plan inputs

Work:

- drive helper-assignment barrier reads from reducer state
- drive retry planning from reducer-produced blocker and retry-target state
- keep compatibility projections, but stop letting them decide these slices independently

Proof artifacts:

- deterministic task-identity tests
- retry-plan regressions from stored state
- helper-assignment parity tests against `0.7.3` behavior

Exit criteria:

- live retry planning and helper blocking match replay
- no launcher-only special cases remain in those decision paths

Rollback trigger:

- reducer-driven helper or retry behavior diverges from replay or loses blocking information

### Stage 3: Envelope-Authoritative Gate Evaluation

Objective:
make typed result envelopes the primary closure read path.

Work:

- gate evaluation reads validated result envelopes first
- summary, report, and marker parsing stays only as named compatibility adapters
- contradictions, facts, proof bundles, and gate results use one schema vocabulary end to end

Proof artifacts:

- gate-engine regressions that prove envelopes dominate when present
- compatibility tests that legacy marker/report inputs still replay correctly

Exit criteria:

- all live closure gates can succeed or block from envelope + canonical state input
- marker parsing is clearly documented and tested as compatibility-only

Rollback trigger:

- missing envelope coverage for a live role or any gate that still depends on ad hoc log parsing for correctness

### Stage 4: Phase-Engine Ownership Expansion

Objective:
move remaining decision logic out of the launcher loop and into explicit engines.

Work:

- keep derived-state, gate, retry, closure, and supervision boundaries explicit
- have the launcher sequence engines instead of recomputing policy inline
- keep human-input workflow semantics in control-plane events and reducer state, not supervisor-local rules

Proof artifacts:

- engine-level tests from stored state
- replay tests that reconstruct closure sequencing without launching sessions

Exit criteria:

- decisions come from engine outputs, not launcher-local branches
- the supervisor writes observed lifecycle facts only

Rollback trigger:

- any stage requires relanding launcher-only branches to preserve correctness

### Stage 5: Compatibility Removal And Thin-Launcher Finish

Objective:
finish the migration by removing transitional authority seams.

Work:

- remove stale compatibility-only decision branches once replay and live coverage prove they are no longer needed
- keep compatibility artifacts only where needed for operator ergonomics or historical replay
- reduce launcher responsibilities to argument parsing, lock management, engine sequencing, supervisor invocation, and projection writes

Exit criteria:

- reducer-authoritative state drives live queries and replay
- gate reads are envelope-first
- compatibility parsing no longer decides live correctness
- active docs no longer describe the launcher as the scheduler brain

## Final Exit Criteria

The architecture hardening migration is complete only when all of the following are true:

- the canonical authority set is the only decision input model documented and enforced
- reducer replay is deterministic and trusted for live state queries
- retry and helper-assignment decisions are reducer-authoritative
- gate and closure evaluation are result-envelope-first
- projections remain operator aids only
- the shared `0.7.3` parity suites still pass

## Risks And Defaults

- Structural debt may remain after behavioral cutover. A large `launcher.mjs` file is not by itself a migration failure if decisions already come from explicit engines, but finishing the thin-launcher cleanup is still required before calling the architecture complete.
- Historical docs may still describe older behavior. Keep that wording explicitly historical instead of mixing it into active operator guidance.
- When there is doubt between projection output and canonical state, trust canonical state and treat the projection as stale until rebuilt.
