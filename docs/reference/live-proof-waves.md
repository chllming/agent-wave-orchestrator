---
title: "Live Proof Waves"
summary: "How to author proof-first `pilot-live` and higher-maturity waves with explicit proof artifacts, sticky executors, and operator-visible closure evidence."
---

# Live Proof Waves

`pilot-live`, `fleet-ready`, `cutover-ready`, and `deprecation-ready` waves are not normal repo-only implementation waves.

For the general runtime model behind helper requests, integration, and final staged closure, see [docs/reference/coordination-and-closure.md](./coordination-and-closure.md).

For these waves:

- operator-run commands are part of closure
- local proof artifacts are part of closure
- stale success is dangerous
- sticky executors are safer than loose retry fallback
- targeted reruns after new proof arrives are normal

## Core Rule

Repo-landed waves can stay repo-centric.

`pilot-live` and above should be proof-centric.

That means the wave should declare:

- the exact proof owner
- the exact operator command sequence
- the exact artifact bundle written locally
- the exact proof surfaces that closure should trust

For a full authored example wave that uses this pattern, see [docs/reference/sample-waves.md](./sample-waves.md) and the linked proof-first live-wave sample.

## Recommended Authoring Pattern

For live-proof owners:

- declare `### Deliverables` for the review/report surface
- declare `### Proof artifacts` for machine-visible local evidence
- keep the executor sticky unless fallback is explicitly required
- prefer wall-clock budgets over tiny hard turn caps

Example:

````md
## Agent A6: Learning Plane Live Validation

### Executor

- id: codex
- retry-policy: sticky
- budget.minutes: 30

### Exit contract

- completion: live
- durability: durable
- proof: live
- doc-impact: owned

### Deliverables

- docs/plans/waves/reviews/wave-8-live-proof.md

### Proof artifacts

- path: .tmp/wave-8-learning-proof/learning-plane-before-restart.json | kind: live-status | required-for: pilot-live
- path: .tmp/wave-8-learning-proof/learning-plane-after-restart.json | kind: restart-check | required-for: pilot-live
- path: .tmp/wave-8-learning-proof/learning-vector-manifest.json | kind: manifest | required-for: pilot-live

### Prompt
```text
Operator command sequence:
- leapctl learning status --json > .tmp/wave-8-learning-proof/learning-plane-before-restart.json
- leapctl learning restart ...
- leapctl learning status --json > .tmp/wave-8-learning-proof/learning-plane-after-restart.json

Closure only counts when the declared proof artifacts exist locally and match the claimed live state.

File ownership (only touch these paths):
- .tmp/wave-8-learning-proof/
- docs/plans/waves/reviews/wave-8-live-proof.md
```
````

## `### Proof artifacts`

Use `### Proof artifacts` for the local machine-visible evidence that must exist before closure can trust a live claim.

Supported shape:

```md
### Proof artifacts

- path: .tmp/example/live-status.json | kind: live-status | required-for: pilot-live
- path: .tmp/example/after-restart.json | kind: restart-check | required-for: pilot-live
```

Guidance:

- keep artifact paths repo-relative
- keep artifact paths inside the agent's owned paths
- use one file per important proof surface
- prefer canonical JSON or markdown artifacts over ad hoc screenshots or ephemeral terminal output

## Retry And Executor Guidance

For proof-bearing owners, default to sticky retry:

```md
### Executor

- id: codex
- retry-policy: sticky
- budget.minutes: 45
```

Only enable cross-executor retry when there is a deliberate reason to do so.

If you do allow fallback, declare it explicitly:

```md
### Executor

- id: codex
- retry-policy: fallback-allowed
- fallbacks: claude
```

## What Closure Should Trust

Closure roles should trust:

- declared proof artifacts that exist locally
- structured markers
- integration summaries grounded in current artifacts

Closure roles should not trust:

- implied host state
- stale cached snapshots
- repo-local inference when the wave claims live proof
- old `status=0` results that no longer match the current proof surface

## Targeted Reruns

When new proof artifacts arrive after an earlier failed attempt, the right response is usually a targeted rerun, not a full implementation replay.

Typical pattern:

1. operator captures the missing proof bundle locally
2. operator can register that bundle directly:

```bash
pnpm exec wave control proof register \
  --lane main \
  --wave 8 \
  --agent A6 \
  --artifact .tmp/wave-8-learning-proof/learning-plane-before-restart.json \
  --artifact .tmp/wave-8-learning-proof/learning-plane-after-restart.json \
  --authoritative \
  --satisfy-owned-components \
  --completion live \
  --durability durable \
  --proof-level live \
  --doc-delta owned \
  --detail "Operator captured and verified restart evidence."
```

3. the proof owner reruns on the same executor only if additional synthesis is still needed
4. any stale integration or closure owner reruns if needed
5. already-valid implementation slices stay reused

Authoritative proof registration is the supported way to make operator-produced evidence visible to A8, A0, rerun control, and hermetic traces without forcing an implementation agent to rediscover the same local artifacts in a fresh session. The canonical proof bundle now lands in `.tmp/<lane>-wave-launcher/control-plane/` and is projected into `.tmp/<lane>-wave-launcher/proof/` for compatibility.

## Suggested Eval Targets For Live-Proof Waves

Good live-proof waves often pair the proof owner with `cont-EVAL` targets that check coordination quality as well as service behavior.

Useful examples:

```md
## Eval targets

- id: blackboard-fidelity | selection: delegated | benchmark-family: blackboard-fidelity | objective: Preserve machine-visible proof through summaries and integration | threshold: Critical live proof facts remain visible through closure
- id: contradiction-recovery | selection: pinned | benchmarks: claim-conflict-detection,evidence-based-repair | objective: Surface and repair conflicting live claims before PASS | threshold: Material contradictions become explicit repair work before final closure
```

## Promotion-Level Guidance

- `pilot-live`
  Require explicit proof artifacts and prefer sticky executors for proof owners.
- `fleet-ready`
  Require the `pilot-live` discipline plus stronger infra/deploy readiness evidence.
- `cutover-ready`
  Require the `fleet-ready` discipline plus explicit rollback or cutover evidence.

The important principle is that higher maturity should mean stronger machine-visible proof, not just more prose.
