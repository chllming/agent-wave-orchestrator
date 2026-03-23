---
summary: "Comparison of CooperBench coordination failure modes against LEAP-Claw Wave 7-10 traces, with concrete examples and the wave-framework countermeasures that helped or still leaked"
read_when:
  - You want to compare LEAP-Claw wave traces to the coordination failure taxonomy in CooperBench
  - You need exact local message examples instead of a general impression
  - You are deciding whether the wave framework mostly mitigates or still exhibits multi-agent coordination failures
title: "CooperBench Versus LEAP-Claw Waves"
---

# CooperBench Versus LEAP-Claw Waves

This report compares the failure taxonomy from
[CooperBench](https://cooperbench.com/static/pdfs/main.pdf) with the concrete
execution history from LEAP-Claw Waves 7-10.

The short conclusion is:

- we do still see the same broad classes of coordination failure that
  CooperBench describes
- the wave framework mitigates many of them by turning them into explicit,
  machine-visible gate failures instead of silent merge-time corruption
- the remaining gaps are mostly around stale state, retry semantics, and
  escalation timing rather than uncontrolled code conflicts

## Scope and evidence base

This comparison uses:

- Wave 7 rerun traces and remediation notes
- Wave 8 execution-gap review
- Wave 9 and Wave 10 launcher dashboards, summaries, and coordination traces
- the current wave role prompts and wave-file structure

Primary local evidence:

- [Wave 7.1 Remediation](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-7.1-remediation.md)
- [Wave 8 Execution Gap Review](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-8-execution-gap-review.md)
- [Wave Planning Lessons](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-planning-lessons.md)
- [Wave 10](/home/coder/slowfast.ai/docs/plans/waves/wave-10.md)
- [Wave Integration Role](/home/coder/slowfast.ai/docs/agents/wave-integration-role.md)
- [Wave Documentation Role](/home/coder/slowfast.ai/docs/agents/wave-documentation-role.md)
- [Wave Evaluator Role](/home/coder/slowfast.ai/docs/agents/wave-evaluator-role.md)

## The paper's three failure buckets

CooperBench groups coordination failure into three buckets:

1. communication channels become noisy, late, or inaccurate
2. agents fail to carry out or preserve their commitments
3. agents form incorrect beliefs about what their partners did, saw, or meant

That grouping fits our traces very well.

## 1. Communication failures: still present, but far more legible

### What CooperBench warns about

The paper highlights communication that is vague, late, repetitive, or
incorrect. The practical problem is not merely "too much chat"; it is that
messages fail to drive timely coordinated action.

### Exact LEAP-Claw example: routed clarification plus immediate human escalation

Wave 10 produced the clearest example.

In the same coordination chain:

- A7 asked for approved rollout drill and rollback commands
- ownership policy routed that clarification to `A1`
- the launcher still opened a human escalation immediately

The exact records are visible in the archived Wave 10 trace:

- clarification moved to `in_progress` with `detail: "Ownership policy resolved this clarification to A1."` in [coordination.raw.jsonl](/home/coder/slowfast.ai/.tmp/retry-archive/wave-10-20260322T195609Z/wave-10-traces/attempt-2/coordination.raw.jsonl#L28)
- routed follow-up opened for `agent:A1` in [coordination.raw.jsonl](/home/coder/slowfast.ai/.tmp/retry-archive/wave-10-20260322T195609Z/wave-10-traces/attempt-2/coordination.raw.jsonl#L29)
- explicit assignment to `A1` recorded in [coordination.raw.jsonl](/home/coder/slowfast.ai/.tmp/retry-archive/wave-10-20260322T195609Z/wave-10-traces/attempt-2/coordination.raw.jsonl#L30)
- a human escalation for the same issue opened immediately afterward in [coordination.raw.jsonl](/home/coder/slowfast.ai/.tmp/retry-archive/wave-10-20260322T195609Z/wave-10-traces/attempt-2/coordination.raw.jsonl#L31)

This is a genuine communication failure mode. The framework did not prevent the
duplication. It created both a machine-routed clarification and a human ticket
for the same issue before the routed path was exhausted.

### What countered it

The wave framework still improved the situation substantially:

- the issue was recorded in durable structured logs rather than disappearing in
  chat
- the queue was inspectable with `pnpm wave:feedback -- list --lane leap-claw --pending`
- the operator could answer the request with an exact command surface, and the
  request file recorded that answer

So the failure was not silent. The framework converted a latent ambiguity into a
visible triage problem. That is better than raw agent-to-agent chat, but it is
still an unresolved planner bug.

### Secondary communication example: accurate but late handoff

`A1` eventually resolved A7's question very clearly. The archived trace shows:

- `A1` handoff: `"A7 clarification answered: approved Wave 10 command surface is on disk"` in [coordination.raw.jsonl](/home/coder/slowfast.ai/.tmp/retry-archive/wave-10-20260322T195609Z/wave-10-traces/attempt-2/coordination.raw.jsonl#L37)
- `A1` resolved-by-policy note: `"Wave 10 A7 clarification resolved by published command surface and stop rules"` in [coordination.raw.jsonl](/home/coder/slowfast.ai/.tmp/retry-archive/wave-10-20260322T195609Z/wave-10-traces/attempt-2/coordination.raw.jsonl#L40)

This is a positive sign: the agents can produce good coordination messages. The
problem is reliability and timing, not total absence of the capability.

## 2. Commitment drift: heavily mitigated, but still common

### What CooperBench warns about

The paper highlights agents making claims they do not operationally cash out,
or failing to preserve agreed coordination points even after substantive work is
done.

### Exact LEAP-Claw example: work landed, protocol still failed

Wave 10 `A1` shows this cleanly.

On attempt 1, the launcher failed `A1` because the final structured proof marker
was missing:

- `"Implementation exit contract blocked wave 10: Missing [wave-proof] marker for A1."` in [wave-10.json](/home/coder/slowfast.ai/.tmp/leap-claw-wave-launcher/dashboards/wave-10.json#L205)

But the agent had already landed the owned files:

- `go/internal/rollout/apply/pilot_integration_test.go`
- `go/internal/rollout/apply/rollback_switch.go`
- `docs/plans/operations/wave-10-rollout-drill.md`

Those deliverables appear in the later clean summary in [wave-10-10-a1.summary.json](/home/coder/slowfast.ai/.tmp/leap-claw-wave-launcher/status/wave-10-10-a1.summary.json#L43).

This is not "the agent did nothing." It is closer to CooperBench's commitment
drift pattern:

- the substantive implementation commitment was met
- the wave-protocol commitment was not met
- the framework therefore refused to infer completion

### Exact LEAP-Claw example: closure agents and formatting discipline

Wave 7 exposed the same class of issue at closure level rather than
implementation level.

The remediation record states:

- structured marker parsing was too brittle for backtick-wrapped or fenced
  markers in [wave-7.1-remediation.md](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-7.1-remediation.md#L17)
- local fixes then required A0, A8, and A9 to emit final markers as plain last
  lines in [wave-7.1-remediation.md](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-7.1-remediation.md#L42)

Again, the framework did not stop the omission. But it did keep the omission
from becoming a false success.

### What countered it

This is where the wave framework helps the most.

The repo now explicitly counteracts commitment drift with:

- structured marker requirements for A8, A9, and A0 in [wave-10.md](/home/coder/slowfast.ai/docs/plans/waves/wave-10.md#L50)
- explicit `### Deliverables` and `### Proof artifacts` in [wave-10.md](/home/coder/slowfast.ai/docs/plans/waves/wave-10.md#L171)
- a standing implementation skill that says landed files without required
  markers are not done
- A8, A9, and A0 closure gates that refuse to treat intent as closure

So yes, we still see commitment drift. But the framework mostly catches it as a
protocol failure before the lane advances.

## 3. Incorrect expectations: this is our biggest remaining problem

### What CooperBench warns about

The paper's third bucket is incorrect expectations about others' plans,
observations, or communication. In practice, this causes duplicate work,
mis-sequencing, or reasoning from stale or partial state.

### Exact LEAP-Claw example: stale status reuse in live-proof waves

Wave 8 documented this explicitly.

The review records:

- stale generated state was reused too aggressively in [wave-8-execution-gap-review.md](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-8-execution-gap-review.md#L122)
- `A3` had exited `0` without a closure-grade summary, yet that stale status
  was treated as reusable in [wave-8-execution-gap-review.md](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-8-execution-gap-review.md#L128)
- `A6` reused an obsolete proof-gap summary after the missing live proof bundle
  already existed in [wave-8-execution-gap-review.md](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-8-execution-gap-review.md#L130)

This maps directly to the paper's "incorrect expectations" bucket. The runtime
was effectively reasoning as if prior agent observations were still current.

### Exact LEAP-Claw example: shared-component retry stranded sibling owners

Wave 10 retry showed an even sharper version.

After the second `A1` attempt, the clean summary explicitly said:

- `proof.state = met` in [wave-10-10-a1.summary.json](/home/coder/slowfast.ai/.tmp/leap-claw-wave-launcher/status/wave-10-10-a1.summary.json#L6)
- the remaining component gap was outside A1 and belonged to live pilot
  authority in [wave-10-10-a1.summary.json](/home/coder/slowfast.ai/.tmp/leap-claw-wave-launcher/status/wave-10-10-a1.summary.json#L25)

But the dashboard still ended the wave at A1:

- `A1` ended `Exit component-gap` in [wave-10.json](/home/coder/slowfast.ai/.tmp/leap-claw-wave-launcher/dashboards/wave-10.json#L116)
- `A2` stayed pending with `"Stale status=0 ignored due to prompt drift or missing metadata"` in [wave-10.json](/home/coder/slowfast.ai/.tmp/leap-claw-wave-launcher/dashboards/wave-10.json#L139)
- `A7` stayed pending with the same stale-state message in [wave-10.json](/home/coder/slowfast.ai/.tmp/leap-claw-wave-launcher/dashboards/wave-10.json#L162)

This is not a simple code-quality problem. It is a coordination-state problem:

- the launcher knew the remaining `pilot-live` gap was sibling-owned
- the launcher still treated `A1` as the terminal failing point

That is very close to the paper's claim that agents or systems form incorrect
expectations about partner state and then act on the wrong mental model.

### Exact LEAP-Claw example: stale integration and closure artifacts

Wave 7 also hit this category. The remediation note records:

- final closure artifacts could stay stale or synthesized instead of reflecting
  the authoritative rerun in [wave-7.1-remediation.md](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-7.1-remediation.md#L21)

That is again an expectations problem: the system continued to act as if earlier
closure state was still authoritative.

### What countered it

The wave framework pushes hard against this class of error, but it does not
eliminate it.

The main countermeasures are:

- A8 as a dedicated integration steward that checks contradictions and proof gaps
  before docs and evaluation in [wave-integration-role.md](/home/coder/slowfast.ai/docs/agents/wave-integration-role.md#L35)
- A9 refusing to treat early doc updates as final if integration is not closed
  in [wave-documentation-role.md](/home/coder/slowfast.ai/docs/agents/wave-documentation-role.md#L57)
- A0 treating the final closure sweep as authoritative in [wave-evaluator-role.md](/home/coder/slowfast.ai/docs/agents/wave-evaluator-role.md#L128)
- explicit proof-bundle doctrine for `pilot-live` and above in
  [wave-planning-lessons.md](/home/coder/slowfast.ai/docs/plans/waves/reviews/wave-planning-lessons.md#L18)

These are real mitigations. They are why stale or wrong expectations usually
show up as blocked waves rather than false passes.

But this is still the area where the runtime leaks most.

## 4. Failure modes we mostly avoid because of the framework

CooperBench centers workspaces with overlapping code and partial observability.
We do share the partial-observability problem, but the wave framework avoids
some of the worst merge-era failure modes by design.

### Resource-division failures are much rarer

Wave files impose explicit resource division.

Wave 10 does this in the open:

- A1 owns `go/internal/rollout/apply/` plus one runbook in [wave-10.md](/home/coder/slowfast.ai/docs/plans/waves/wave-10.md#L192)
- A2 owns `go/internal/rollout/shadow/`, `go/internal/cluster/view/rollout_status_test.go`, and one QA doc in [wave-10.md](/home/coder/slowfast.ai/docs/plans/waves/wave-10.md#L252)
- A7 owns the live proof bundle and review note in [wave-10.md](/home/coder/slowfast.ai/docs/plans/waves/wave-10.md#L258)

This is close to the paper's successful "resource division" pattern. The key
difference is that our framework makes the split declarative up front instead of
hoping the agents negotiate it reliably in freeform chat.

### Role division is strong

The framework also forces role division:

- implementation agents own concrete deliverables
- A8 owns cross-agent coherence, not code delivery
- A9 owns shared-plan synchronization
- A0 owns final gate truth

That division is encoded in the wave file and standing role prompts, not only in
agent memory.

In practice, this means many failures that would become destructive code
overwrites in a looser system instead become:

- missing markers
- unresolved component gaps
- stale-state reuse bugs
- over-eager escalations

Those are still real problems, but they are safer problems.

## 5. What the framework is actually doing

The paper argues that many systems rely on scaffolds and active supervision
rather than raw cooperative ability. That is also true here.

The wave framework is not evidence that the agents have solved social
intelligence. It is evidence that we have built stronger external scaffolding:

- explicit ownership
- explicit deliverables
- explicit proof artifacts
- explicit maturity levels
- explicit integration and evaluator gates
- durable coordination records

This scaffolding does three useful things:

1. it reduces ambiguous coordination space
2. it makes hidden contradictions visible
3. it keeps many failures from being mistaken for success

That is a meaningful mitigation, but it is not the same as eliminating the
underlying coordination problem.

## 6. Bottom line

The honest comparison is:

- yes, we still see the CooperBench failure classes in real wave traces
- no, they usually do not show up as uncontrolled agent chaos
- instead, they show up as:
  - duplicated escalation paths
  - missing marker failures
  - stale closure or status reuse
  - shared-component retry bugs

So the wave framework mostly mitigates these failures by containing them,
surfacing them, and refusing to advance the lane on bad coordination state.

What it does not yet fully solve:

- premature or duplicated escalation
- stale-state invalidation for high-maturity waves
- shared-component retry semantics once one owner becomes clean
- the gap between "agent landed a correct slice" and "the runtime moved the
  whole shared component forward correctly"

That means the right claim is not "the framework solves multi-agent
coordination." The right claim is:

- it meaningfully narrows the failure surface
- it converts many soft coordination mistakes into explicit gate failures
- it still needs better runtime behavior around retries, stale state, and
  escalation timing
