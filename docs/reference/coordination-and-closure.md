---
title: "Coordination And Closure"
summary: "How agent-to-agent work, deliverables, integration, and final closure behave end to end in the Wave runtime."
---

# Coordination And Closure

This page explains the runtime model behind Wave coordination, helper work, integration, and final closure.

The short version is:

- `exit 0` means an agent process finished
- it does not mean the wave is ready to close
- closure is based on durable coordination state plus the staged closure gates

## Core Model

Wave distinguishes three different things:

1. an agent finishing its own owned work
2. an agent asking another agent or lane for follow-up work
3. the wave being globally coherent enough to pass integration, documentation, and cont-QA closure

Those are related, but they are not the same.

An implementation agent can be locally complete and still leave the wave blocked if it created open helper work, unresolved clarification chains, or required dependencies.

At runtime, those distinctions map onto separate modules:

- `implementation-engine.mjs` selects implementation work
- `derived-state-engine.mjs` rebuilds the blackboard projections
- `gate-engine.mjs` evaluates closure and barrier state from envelopes plus canonical logs
- `retry-engine.mjs` decides what can safely resume
- `closure-engine.mjs` sequences the staged closeout
- `session-supervisor.mjs` only launches sessions and records observed facts

Closure roles are resolved from the wave definition first, then from starter defaults. In other words, integration, documentation, `cont-QA`, `cont-EVAL`, and security review keep the same semantics even when a wave overrides the default role ids such as `A8`, `A9`, `A0`, `E0`, or `A7`.

## Durable State Surfaces

The runtime writes several different artifacts, but they do different jobs:

- canonical coordination log:
  `.tmp/<lane>-wave-launcher/coordination/wave-<n>.jsonl`
- canonical control-plane log:
  `.tmp/<lane>-wave-launcher/control-plane/wave-<n>.jsonl`
- result envelopes:
  `.tmp/<lane>-wave-launcher/results/wave-<n>/attempt-<a>/<agent>.json`
- helper-assignment snapshot:
  `.tmp/<lane>-wave-launcher/assignments/wave-<n>.json`
- dependency snapshot:
  `.tmp/<lane>-wave-launcher/dependencies/wave-<n>.json`
- shared summary:
  `.tmp/<lane>-wave-launcher/inboxes/wave-<n>/shared-summary.md`
- per-agent inboxes:
  `.tmp/<lane>-wave-launcher/inboxes/wave-<n>/<agent>.md`
- integration summary:
  `.tmp/<lane>-wave-launcher/integration/wave-<n>.json`
- wave dashboard:
  `.tmp/<lane>-wave-launcher/dashboards/wave-<n>.json`
- run-state:
  `.tmp/<lane>-wave-launcher/run-state.json`

The important rule is that decisions come from the canonical authority set: wave definitions, the coordination log, the control-plane log, and immutable result envelopes. The markdown board is a projection for humans. See [wave-orchestrator.md](../plans/wave-orchestrator.md).

That control-plane log also carries observed `wave_run`, `attempt`, and `agent_run` lifecycle facts from `session-supervisor.mjs`. When human feedback or escalation remains open, the reducer materializes the wave as `clarifying` with blocked `waveState` instead of flattening it into generic progress.

Live waves now keep refreshing that derived state while agents are still running. Shared summaries, inboxes, dashboard coordination metrics, and clarification routing are not only recomputed at attempt boundaries; they are also refreshed during active wave execution so stale clarification and acknowledgement timing is machine-visible before the attempt ends.

## What Agents Should Use

Use the coordination log for conversational or workflow state:

- `request`
  Use this when you need another agent or capability owner to do work. Target it explicitly. This is the kind that becomes a helper assignment.
- `blocker`
  Use this when the wave is blocked, but not because the runtime needs to route work to a specific assignee.
- `handoff`
  Use this for continuity and context transfer. This is informative by itself; it is not the same as a blocking helper assignment.
- `evidence`
  Use this for durable facts, artifacts, or proof that another agent may need.
- `claim`
  Use this for assertions that integration should reconcile.
- `clarification-request`
  Use this when an ambiguity must be triaged before work can safely continue.

## What Stewards and Orchestrators May Also Use

- `ack`
  Acknowledge receipt of a request or clarification. Resets the acknowledgement timer.
- `decision`
  Record a binding decision that downstream agents should follow.
- `orchestrator-guidance`
  Non-binding guidance from the resident orchestrator.

Implementation agents normally do not need these kinds.

Practical rule:

- if you need another agent to take action and you want the wave to stay blocked until it is done, use a targeted `request`
- a plain board note or plain `handoff` is not enough

## Open Versus Resolved

Wave treats these coordination statuses as open:

- `open`
- `acknowledged`
- `in_progress`

It treats these statuses as closed:

- `resolved`
- `closed`
- `superseded`
- `cancelled`

But "open" and "blocking" are now different questions.

Open records can carry a blocker severity:

- `hard`
- `soft`
- `stale`
- `advisory`
- `proof-critical`
- `closure-critical`

Practical rule:

- `proof-critical`, `closure-critical`, and hard required barriers still stop the wave outright
- `soft` blockers stay visible and may still drive repair work or retry targeting
- `stale` and `advisory` records remain in coordination history without owning the active blocking edge

That means a targeted helper request only blocks while it remains open *and* still has blocking severity in coordination state.

This page is documenting runtime semantics first. The important contract is that closure follows the durable coordination state, not that a particular human or agent used one exact command path to mutate it.

## Deliverables Versus Helper Work

Deliverables prove an agent landed its own owned outputs.

For implementation agents with an exit contract, closure validates:

- `[wave-proof]`
- `[wave-doc-delta]`
- any required `[wave-component]` markers
- declared `### Deliverables`
- declared `### Proof artifacts`

Deliverables and proof artifacts are local ownership proof. They do not replace cross-agent follow-up.

That distinction matters:

- if Agent A1 owns `src/foo.ts` and `docs/reviews/foo.md`, those should be modeled as A1 deliverables
- if A1 needs Agent A8 to reconcile a cross-component interface or integration contradiction, that is not an A1 deliverable
- that second case is coordination work, and it should become a targeted request

## End-To-End Example: Agent A1 Needs A8

Assume:

- A1 owns implementation files and its review output
- A8 is the integration steward
- A1 finishes its code and report, but notices an interface contradiction that only A8 can reconcile

### Step 1: A1 Lands Its Owned Work

A1 can still satisfy its own slice by:

- writing its owned files
- emitting a valid `[wave-proof]`
- emitting a valid `[wave-doc-delta]`
- satisfying any declared deliverables and proof artifacts

At this point A1 can be locally done.

### Step 2: A1 Raises A Durable Request

Example:

```bash
pnpm exec wave control task create \
  --lane main \
  --wave 4 \
  --agent A1 \
  --kind request \
  --summary "Need integration decision for auth/session interface change" \
  --detail "A1 landed the auth refactor, but session ownership now spans auth, gateway, and docs surfaces. A8 must reconcile the final contract and closure path." \
  --target agent:A8 \
  --priority high
```

What happens next:

- the request lands in the canonical coordination log
- the runtime derives a helper assignment for `agent:A8`
- that assignment is written into the assignment snapshot
- the shared summary and A8 inbox now show the open helper work

`wave control task list` and `wave control task get` surface both blocking and informative coordination kinds. `wave control status` only turns `request`, `blocker`, `clarification-request`, `human-feedback`, and `human-escalation` into candidate blocking task edges, and then only if the current record still has `blocking=true` plus a blocking severity. Plain `handoff`, `evidence`, `claim`, and `decision` records stay visible without falsely blocking the owner. When a launcher attempt is already running, status scopes the top-level blocking edge to that active attempt instead of letting stale relaunch metadata or unrelated closure tasks dominate the wave-level view.

### Step 3: Why A1 Can Be Done But The Wave Is Still Blocked

This is the important distinction:

- A1 may be done with A1's ownership
- the wave is not done

The reducer and gate engine will still see:

- an open helper assignment for the request
- an integration summary that is not yet ready for doc closure

So the wave remains blocked.

In runtime terms, this becomes:

- `helper-assignment-open` if the request has an assignee
- `helper-assignment-unresolved` if no assignee could be found

### Step 4: A8 Resolves The Follow-Up

A8 reads the shared summary and inbox, reconciles the issue, and updates the integration state.

That usually means:

- closing the targeted follow-up in coordination state
- publishing a final integration position
- emitting a final `[wave-integration] state=ready-for-doc-closure ...` marker only when no meaningful contradiction or blocker remains

### Step 5: Closure Can Continue

Only after that does the closure engine allow the wave to move on to:

1. documentation closure
2. cont-QA closure

So the correct mental model is:

- A1 can finish first
- A8 may still owe wave-level closure work
- the wave does not pass just because the original implementation owner exited successfully

## End-To-End Example: Clarification Chain

Assume an agent cannot safely choose between two interpretations of a migration rule.

The agent should emit a clarification request:

```bash
pnpm exec wave coord post \
  --lane main \
  --wave 6 \
  --agent A3 \
  --kind clarification-request \
  --summary "Need policy answer for backward-compat migration path" \
  --detail "I checked the current-state doc and migration plan, but the required compatibility window is still ambiguous."
```

What happens next:

1. the orchestrator triages the clarification from repo policy, ownership, prior decisions, and routing context
2. if it can answer inside the wave, it writes the resolution back into coordination state
3. if another owner can answer it, the runtime opens a targeted follow-up request and keeps the clarification chain blocking
4. only after policy and routed follow-up paths are exhausted does it create human feedback or escalation artifacts
5. until that chain is resolved, clarification remains a closure barrier and any routed follow-up also remains blocking helper work

Important implication:

- even if code is landed, an open clarification chain can still block the wave
- a routed clarification that stays `open` past the acknowledgement policy can be rerouted during the same live attempt instead of waiting for a full retry cycle
- operators can now inspect and intervene through one command surface, including downgrade or policy-close actions when the remaining issue is no longer proof-critical:

```bash
pnpm exec wave control status --lane main --wave 10 --agent A7 --json
pnpm exec wave control task act reassign --lane main --wave 10 --id clarify-a7-rollout --to A1
pnpm exec wave control task act mark-stale --lane main --wave 10 --id clarify-a7-rollout
pnpm exec wave control task act mark-advisory --lane main --wave 10 --id request-clarify-a7-rollout
pnpm exec wave control task act defer --lane main --wave 10 --id blocker-doc-follow-up
pnpm exec wave control task act resolve-policy --lane main --wave 10 --id clarify-a7-rollout --detail "Policy already covered in the published rollout guide."
pnpm exec wave control task act resolve --lane main --wave 10 --id escalation-clarify-a7-rollout --detail "Published command surface covers this question."
```

That keeps clarification routing, downgrade, dismissal, escalation, policy closure, and human-answer handling inside the canonical coordination state instead of forcing ad hoc file edits.

When the operator answers through the feedback queue directly, the answer path now repairs the same canonical state:

```bash
pnpm exec wave feedback respond \
  --id 202603240000-main-w6-A3-abc123 \
  --response "Use the 90-day compatibility window documented in docs/plans/migration.md." \
  --operator ops-lead
```

For ad-hoc runs, include `--run <id>` on that command. The response path will reconcile the linked clarification or escalation chain, re-sync helper-assignment projections, and write a safe one-shot continuation request when the reducer can resume but no active attempt is still running.

## End-To-End Example: Required Dependency

Assume the wave needs another lane to land a required API first.

That should be modeled as a required dependency ticket, not as a local deliverable.

Example:

```bash
pnpm exec wave dep post \
  --owner-lane release \
  --requester-lane main \
  --owner-wave 2 \
  --requester-wave 4 \
  --agent launcher \
  --summary "Need release lane to publish session token contract before Wave 4 can close" \
  --target capability:integration \
  --required
```

What happens next:

- the dependency appears in the per-wave dependency snapshot
- integration and inboxes surface it
- required inbound or outbound dependencies keep the wave blocked

This is separate from helper assignment logic:

- helper assignments are intra-wave follow-up work
- dependencies are cross-wave or cross-lane prerequisites

## What Integration Actually Does

Integration is not a generic summary pass. It is the place where Wave asks:

- are there still unresolved blockers?
- do any agent claims contradict each other?
- are there still proof gaps?
- are there still deploy or infra risks?
- are there still documentation gaps?
- are helper assignments or dependencies still open?

If any of those remain material, the recommendation is `needs-more-work`.

Only when that synthesized state is clean does integration become `ready-for-doc-closure`.

This is why integration sits between raw implementation success and final docs or QA closure.

## Why Closure Is Staged

Closure runs in order:

1. `cont-EVAL`
2. optional security review
3. integration
4. documentation
5. `cont-QA`

That ordering exists to prevent false PASS outcomes.

Examples:

- `cont-EVAL` should not PASS if the declared eval contract is still unsatisfied
- security should run before final closure if findings could still change integration or rollout readiness
- documentation should not close while integration still says the story is unstable
- cont-QA should be last, because it is supposed to judge the final landed state

## What Each Closure Role Must Prove

### Implementation Owners

Implementation owners must prove their own exit contract, not just exit cleanly.

That means:

- proof state is `met`
- completion, durability, and proof level meet the contract
- documentation impact is reported correctly
- all declared deliverables exist
- all required proof artifacts exist

### `cont-EVAL`

`cont-EVAL` must emit a final `[wave-eval]` marker and satisfy the declared target and benchmark contract.

For live closure, it is not enough to say "looks good." The target ids and benchmark ids must match the declared wave contract.

### Security Review

If present, security review must emit a final `[wave-security]` marker and publish its report artifact.

- `blocked` stops the wave before integration
- `concerns` remains visible in summaries and traces
- `clear` is only valid when no unresolved findings or approvals remain

### Integration

Integration must reconcile cross-agent state and report `ready-for-doc-closure` only when there is no remaining meaningful contradiction, blocker, proof gap, or deploy risk.

### Documentation Steward

Documentation closure must emit `[wave-doc-closure]`.

The important distinction is:

- `closed` means the shared-plan delta was reconciled
- `no-change` means no shared-plan changes were required
- `delta` means documentation closure is still open

### `cont-QA`

`cont-QA` must emit:

- a final verdict
- a final `[wave-gate]` marker

Final PASS requires all gate dimensions to pass in the final state.

## Why The Closure Model Works

The closure model is deliberately conservative.

It works because it refuses to trust weak signals:

- a process exiting successfully
- a board note saying "done"
- one agent claiming success while another still reports contradiction
- stale prior attempt output

Instead, it trusts machine-visible current state:

- current coordination log state
- current assignment and dependency snapshots
- current integration summary
- current docs closure state
- current cont-QA and cont-EVAL markers
- current proof artifacts and deliverables

That gives Wave two useful properties:

- already-valid work can stay reusable
- the wave still refuses to PASS while open follow-up work remains

## Targeted Retry Behavior

When closure fails, the runtime does not always relaunch the entire wave.

It tries to relaunch only the implicated owners:

- agents named by the failure
- sibling owners that still owe shared promoted-component proof after a landed owner already passed its slice
- helper assignees
- dependency owners where relevant
- the closure stewards needed after that state changes

That is why the system can safely reuse already-valid implementation slices while still forcing the wave to stay blocked until the right follow-up work is done.

Operators now have a first-class override path for that recovery flow:

```bash
pnpm exec wave control rerun get --lane main --wave 10 --json
pnpm exec wave control rerun request --lane main --wave 10 --agent A2 --agent A7 --clear-reuse A2 --reason "Resume sibling-owned component closure"
```

The canonical rerun request is written under `.tmp/<lane>-wave-launcher/control-plane/`, projected to `.tmp/<lane>-wave-launcher/control/` for compatibility, consumed by the retry engine on the next retry decision, and then cleared by default after one application. This is the supported path for:

- rerunning only specific owners
- preserving explicit reuse selectors such as attempt ids, proof bundle ids, derived-summary reuse, and invalidated component ids through the compatibility projection
- clearing reuse for selected agents without wiping the whole wave state
- resuming at the real remaining implementation owners instead of restarting or stopping at the wrong sibling

## Common Mistakes

- Treating `exit 0` as wave completion.
- Using a board note or `handoff` when the work should be a blocking targeted `request`.
- Modeling cross-agent follow-up as a deliverable instead of coordination work.
- Declaring integration ready while helper assignments or dependencies are still open.
- Treating documentation closure as optional after plan-affecting outcomes.
- Treating `cont-QA` as an implementation reviewer instead of the final closure gate.

## Practical Rule Of Thumb

Ask two questions:

1. "Did this agent finish its own owned outputs?"
2. "Is the wave globally coherent enough that no other blocking owner still owes follow-up work?"

Wave only closes when both are true.
