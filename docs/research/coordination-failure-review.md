---
title: "Coordination Failure Review"
summary: "Assessment of whether the Wave orchestrator constructively addresses coordination and blackboard failure modes highlighted by recent multi-agent papers."
---

# Coordination Failure Review

## Bottom Line

The Wave orchestrator addresses several coordination failure modes constructively in code, not just in prose. In particular, it has:

- a canonical machine-readable coordination log
- compiled shared summaries plus per-agent inboxes
- explicit clarification, helper-assignment, dependency, integration, documentation, and cont-QA barriers
- structured proof and verdict validation
- replayable trace bundles with coordination-quality metrics

That is materially stronger than the common "agents talk in a shared channel and we hope that was enough" pattern criticized by recent multi-agent papers.

The main weakness is empirical, not architectural. The repo does not yet contain a benchmark family that proves the blackboard actually helps agents reconstruct distributed state under HiddenBench or Silo-Bench style pressure, or that it handles DPBench-style simultaneous coordination reliably.

## What The Papers Warn About

### `Why Do Multi-Agent LLM Systems Fail?`

This paper is the broadest warning. Its failure taxonomy groups problems into:

- system design issues
- inter-agent misalignment
- task verification failures

Those categories are useful here because they distinguish "we gave agents a shared workspace" from "the workspace is actually enforceable and auditable."

### `HiddenBench` / `Systematic Failures in Collective Reasoning under Distributed Information in Multi-Agent LLMs`

This is the clearest warning for blackboard-style systems. The central result is that multi-agent groups often fail not because they never communicated, but because they do not notice latent information asymmetry and do not actively surface unshared evidence. They converge on shared evidence too early.

For this repo, the key question is therefore not "do agents have a board?" but "does the shared state force enough evidence pooling to avoid premature convergence?"

### `Silo-Bench`

Silo-Bench sharpens the same point. Agents can exchange information and even form reasonable communication topologies, yet still fail at the reasoning-integration step. Communication volume is not the same thing as distributed-state synthesis.

For this repo, the corresponding question is whether summaries, inboxes, and integration passes merely move information around, or actually make the final decision depend on the integrated state.

### `DPBench`

DPBench shows that LLM teams can look coordinated in serial settings and still collapse in simultaneous coordination settings, with communication often failing to save them. Its practical lesson is that explicit external coordination mechanisms matter when concurrent access or simultaneous action is involved.

For this repo, the relevant question is whether coordination is only conversational or whether there are explicit external barriers and tickets that serialize or block unsafe progress.

### `Multi-Agent Teams Hold Experts Back`

This paper argues that unconstrained teams underuse expertise. Even when the best agent is identifiable, teams often drift toward integrative compromise instead of properly weighting expert judgment.

For this repo, the key question is whether the design relies on self-organizing consensus or on explicit role ownership, routing, and gating.

## What This Repo Already Does Constructively

### Implemented In Code And Tests

#### 1. It uses a real canonical shared state, not a cosmetic board

The strongest blackboard-like mechanism is the canonical JSONL coordination log plus materialized state in [scripts/wave-orchestrator/coordination-store.mjs](../../scripts/wave-orchestrator/coordination-store.mjs). The markdown board is explicitly a projection for humans, not the scheduler's source of truth, as stated in [docs/plans/wave-orchestrator.md](../plans/wave-orchestrator.md).

That state is then compiled into:

- a wave-level shared summary via `compileSharedSummary()`
- targeted per-agent inboxes via `compileAgentInbox()`

This is a real mitigation against information silos because agents are not expected to reconstruct the whole wave by rereading raw logs. The inbox compiler also pulls in relevant open coordination through `artifactRefs`, ownership, components, docs items, helper assignments, and dependencies. That behavior is exercised in [test/wave-orchestrator/coordination-store.test.ts](../../test/wave-orchestrator/coordination-store.test.ts).

Assessment against the papers:

- `HiddenBench`: partially addressed in design
- `Silo-Bench`: partially addressed in design
- proof that this works under benchmarked distributed-information pressure: missing

#### 2. It makes completion depend on integrated state, not on agent self-report

The launcher's gate stack in [scripts/wave-orchestrator/launcher.mjs](../../scripts/wave-orchestrator/launcher.mjs) is the clearest constructive safeguard in the repo. Closure is blocked by:

- open clarifications
- unresolved clarification-linked follow-up requests
- pending human input
- unresolved helper assignments
- open required dependencies
- integration failures
- documentation closure failures
- cont-EVAL failures
- cont-QA failures

This matters because several paper failure modes are really verification failures: agents say they are done, but the system has no hard check that the distributed state was reconciled. Here, the final decision is made by barrier logic rather than informal consensus.

Tests in [test/wave-orchestrator/clarification-triage.test.ts](../../test/wave-orchestrator/clarification-triage.test.ts) and [test/wave-orchestrator/launcher.test.ts](../../test/wave-orchestrator/launcher.test.ts) confirm that routed clarification work remains blocking until the linked follow-up is resolved and that integration evidence is derived from coordination, docs, validation, and runtime signals.

Assessment against the papers:

- `Why Do Multi-Agent LLM Systems Fail?`: strong mitigation of task-verification failures
- `Silo-Bench`: helps because integrated state has operational consequences
- `DPBench`: helps by using external barriers instead of relying on emergent coordination alone

#### 3. It validates structured evidence instead of trusting narrative summaries

[scripts/wave-orchestrator/agent-state.mjs](../../scripts/wave-orchestrator/agent-state.mjs) validates structured markers for implementation proof, integration, cont-EVAL, documentation closure, and cont-QA verdicts. That means the orchestrator can reject:

- missing proof markers
- weaker completion or durability than promised
- missing doc-delta markers
- missing component evidence
- missing deliverables
- non-ready integration summaries
- non-satisfied cont-EVAL outcomes
- non-pass cont-QA gates

This directly addresses the "don't kid yourself" critique behind the failure-taxonomy paper. A system that validates explicit proof contracts is much less vulnerable to premature closure than a system that trusts free-form role reports.

Assessment against the papers:

- `Why Do Multi-Agent LLM Systems Fail?`: strong mitigation for verification and termination failures
- `Multi-Agent Teams Hold Experts Back`: indirect mitigation, because expert or steward judgment must still be grounded in evidence

#### 4. It reduces naive self-organizing compromise through explicit ownership and routing

The repo does not rely on free-form team consensus in the way criticized by `Multi-Agent Teams Hold Experts Back`. Instead it uses:

- named stewardship roles such as integration and cont-QA in [docs/agents/wave-integration-role.md](../agents/wave-integration-role.md) and [docs/agents/wave-cont-qa-role.md](../agents/wave-cont-qa-role.md)
- capability-targeted request routing in [scripts/wave-orchestrator/routing-state.mjs](../../scripts/wave-orchestrator/routing-state.mjs)
- deterministic assignment based on explicit target, preferred agent, or least-busy capability owner
- staged closure order documented in [docs/plans/current-state.md](../plans/current-state.md) and enforced in the launcher

This is a constructive response to the paper's warning about teams averaging expert and non-expert views. The repo favors explicit owner selection and role-specific closure authority over emergent compromise.

Assessment against the papers:

- `Multi-Agent Teams Hold Experts Back`: partially addressed and better than unconstrained collaboration
- not fully solved, because routing is based mostly on declared capability and load, not demonstrated expertise quality

#### 5. It is unusually observable and replayable

[scripts/wave-orchestrator/traces.mjs](../../scripts/wave-orchestrator/traces.mjs) and [scripts/wave-orchestrator/replay.mjs](../../scripts/wave-orchestrator/replay.mjs) give the system an unusually strong postmortem surface. A trace bundle includes:

- raw coordination log
- materialized coordination state
- ledger
- docs queue
- integration summary
- shared summary
- copied prompts, logs, status, and inbox artifacts
- structured signals
- `quality.json`
- replay metadata and outcome baseline

The quality metrics include unresolved clarifications, contradiction count, capability-assignment timing, dependency-resolution timing, blocker-resolution timing, and fallback counts. Tests in [test/wave-orchestrator/traces.test.ts](../../test/wave-orchestrator/traces.test.ts) verify replay integrity and hash validation.

This does not by itself solve coordination failure, but it is a serious safeguard against hidden failure modes because it makes them inspectable and replayable.

Assessment against the papers:

- `Why Do Multi-Agent LLM Systems Fail?`: strong support for diagnosis and failure analysis
- `Silo-Bench` and `HiddenBench`: useful observability layer, but not yet a direct capability benchmark

### Stated In Docs And Also Reflected In The Software

The docs are not purely aspirational here. The main claims in [docs/plans/current-state.md](../plans/current-state.md) and [docs/plans/wave-orchestrator.md](../plans/wave-orchestrator.md) are broadly backed by the code:

- canonical coordination log plus generated board
- compiled shared summaries and per-agent inboxes
- orchestrator-first clarification triage
- blocking helper assignments and cross-lane dependencies
- staged closure order
- trace bundles and replay validation

That alignment matters. In many MAS projects the docs promise a blackboard, but the runtime still reduces to prompt-only coordination. Here the repo's architectural claims are mostly real.

## What Is Still Missing To Make The Claim Credible

### 1. No distributed-information benchmark family yet

The biggest gap is in [docs/evals/benchmark-catalog.json](../evals/benchmark-catalog.json). The current families are:

- `service-output`
- `latency`
- `quality-regression`

There is nothing yet for:

- hidden-profile reconstruction
- silo escape under partial information
- blackboard consistency across raw log, summary, inboxes, ledger, and integration state
- contradiction injection and recovery
- simultaneous coordination under contention

So the repo can reasonably claim "we built mechanisms intended to mitigate these failures," but it cannot yet claim "we demonstrated that these mechanisms overcome the failures highlighted by HiddenBench, Silo-Bench, or DPBench."

### 2. Information integration is supported, but not measured directly

The shared summary, inboxes, and integration pass are all constructive. But there is still no metric that asks:

- Did the team reconstruct the globally correct hidden state?
- Did the summary preserve the critical fact that was originally siloed?
- Did a wave converge too early on shared evidence while missing private evidence?

This is the central failure highlighted by `HiddenBench` and `Silo-Bench`, and the repo does not yet score it directly.

### 3. Expertise routing is explicit, but shallow

[scripts/wave-orchestrator/routing-state.mjs](../../scripts/wave-orchestrator/routing-state.mjs) is better than unconstrained self-organization, but it still routes mostly by:

- explicit target
- configured preferred agents
- declared capability ownership
- least-busy fallback

It does not yet weight:

- historical success on a capability
- evidence quality by agent
- confidence calibration
- expert-leverage metrics

So the repo partially addresses the concern from `Multi-Agent Teams Hold Experts Back`, but it does not yet prove that the best agent's expertise is actually being exploited rather than merely named.

### 4. Clarification and contradiction handling are still somewhat heuristic

Clarification triage and integration evidence aggregation are real safeguards, but they still lean heavily on:

- ownership mappings
- artifact references
- structured markers
- text-level summaries and conflict extraction

That is enough to make the runtime operationally safer, but it is not yet a richer semantic evidence-integration layer. Subtle contradictions or latent information asymmetries may still be missed.

### 5. DPBench-style simultaneous coordination is only indirectly addressed

The repo already uses external coordination mechanisms such as blocking assignments, dependency tickets, and closure barriers. That is directionally aligned with DPBench's lesson that explicit external coordination beats naive emergent coordination.

But there is still no direct stress harness for:

- simultaneous resource contention
- many-way concurrent dependencies
- lock-step coordination failures
- deadlock-like patterns caused by convergent reasoning

So the design points in the right direction, but the claim is not yet validated.

## Gap Matrix

| Paper | Main warning | Repo response | Assessment |
| --- | --- | --- | --- |
| [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) | MAS fail through bad system design, misalignment, and weak verification | Canonical coordination state, barrier-based closure, structured evidence validation, replayable traces | Addressed materially in architecture and software |
| [Systematic Failures in Collective Reasoning under Distributed Information in Multi-Agent LLMs](https://arxiv.org/abs/2505.11556) | Teams miss latent information asymmetry and converge too early on shared evidence | Shared summaries, per-agent inboxes, integration steward, clarification flow | Partially addressed in design, not validated empirically |
| [Silo-Bench](https://arxiv.org/abs/2603.01045) | Communication is not enough; reasoning integration is the bottleneck | Integration evidence aggregation and barrier-driven closure | Partially addressed in design, but no direct integration-quality benchmark |
| [DPBench](https://arxiv.org/abs/2602.13255) | Simultaneous coordination can fail badly even with communication | External helper assignments, dependency barriers, explicit blocking workflow | Directionally addressed, but not benchmarked under simultaneous contention |
| [Multi-Agent Teams Hold Experts Back](https://arxiv.org/abs/2602.01011) | Self-organizing teams underuse experts and drift toward compromise | Named stewards, explicit role authority, capability routing, proof gates | Better than naive teams, but expertise leverage is not measured or optimized deeply |

## Final Assessment

If the standard is "does this repo merely claim multi-agent coordination," the answer is no. It has real machinery for blackboard-like state sharing, evidence-based closure, clarification handling, and coordination diagnostics.

If the standard is "has this repo already demonstrated that its design beats the core failure modes isolated by HiddenBench, Silo-Bench, DPBench, and related work," the answer is also no. The design is substantially more credible than most MAS stacks, but the empirical proof is still missing.

The most accurate claim today is:

> Wave already implements several constructive anti-failure mechanisms for coordination and blackboard-style orchestration, especially around shared state, gating, and observability. What it still lacks is a benchmark suite that proves those mechanisms actually overcome distributed-information and simultaneous-coordination failures rather than simply organizing them better.
