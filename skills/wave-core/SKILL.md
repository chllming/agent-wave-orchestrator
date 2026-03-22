# Wave Core

<!-- CUSTOMIZE: Add project-specific coordination channels, artifact locations, or naming conventions below. -->

## Core Rules

- Re-read the compiled shared summary, inbox, and board projection before major decisions and before final output.
- Treat file ownership, exit contracts, and structured markers as hard requirements.
- Post coordination records for meaningful progress, blockers, decisions, and handoffs.
- Make gaps explicit with exact files, exact fields, and exact follow-up owners.
- Do not infer closure from intent alone. Closure requires proof artifacts and consistent shared state.
- Silence is not evidence. If a deliverable is not mentioned in landed artifacts, it is not done.
- When two sources conflict, prefer the one backed by landed code or durable proof over the one backed by prose.

## Coordination Protocol

1. Read the shared summary and your inbox at the start of every major step.
2. Post a coordination record when any of these occur:
   - meaningful progress on an exit contract deliverable
   - a blocker is discovered or resolved
   - a decision changes scope, ownership, or interface
   - a handoff to another agent is needed
   - a helper assignment is opened or resolved
3. Each coordination record must include: agent id, timestamp context, topic, and actionable detail.
4. Do not batch coordination. Post records as events occur so downstream agents see them promptly.
5. When a record references another agent, name that agent explicitly.

## Ownership & Boundaries

- Only modify files you own. File ownership is declared in the wave definition under each agent.
- If you need a change in a file you do not own, open a follow-up request naming the owning agent, the exact file, and the exact change needed.
- Shared-plan docs (current-state.md, component matrix, roadmap) are owned by the documentation steward, not implementation agents.
- Implementation-specific docs (inline comments, subsystem READMEs) stay with the implementation owner.
- When ownership is ambiguous, post a coordination record requesting clarification before editing.

## Proof Requirements

- Every exit contract deliverable must have a corresponding proof artifact: a passing test, a generated file, a durable summary, or an explicit structured marker.
- Generic claims ("tests pass", "works correctly") are not proof. Name the exact test file, command, or artifact.
- Component promotions require evidence that the component actually reached the declared level, not just that adjacent code landed.
- Runtime-facing proof must be real evidence (logs, health checks, build output), not future-work notes.

## Closure Checklist

A wave is closable only when all nine conditions are satisfied:

1. **Exit contracts pass** -- every agent's declared exit contract deliverables are present and backed by proof artifacts.
2. **Deliverables exist within ownership** -- each deliverable lives in files owned by the agent that produced it.
3. **Component proof/promotions pass** -- promoted components reached their declared target level with evidence.
4. **Helper assignments resolved** -- every helper assignment posted during the wave has a linked resolution.
5. **Dependency tickets resolved** -- all inbound cross-lane dependency tickets are resolved or explicitly deferred.
6. **Clarification follow-ups resolved** -- every routed clarification chain has a linked follow-up that is closed.
7. **cont-EVAL satisfies targets** -- if the wave includes cont-EVAL, the eval marker shows `satisfied` with matching target and benchmark ids.
8. **Integration recommends closure** -- the integration marker shows `ready-for-doc-closure` and is not contradicted by later evidence.
9. **Documentation and cont-QA pass** -- doc closure marker is `closed` or `no-change`, and the cont-QA verdict is `PASS` with a matching gate marker.

If any condition is not met, the wave remains open. Do not approximate closure.

## Structured Markers Reference

Emit markers exactly as shown. Parsers depend on the format.

| Marker | Format |
|---|---|
| `[wave-gate]` | `[wave-gate] architecture=<pass\|concerns\|blocked> integration=<pass\|concerns\|blocked> durability=<pass\|concerns\|blocked> live=<pass\|concerns\|blocked> docs=<pass\|concerns\|blocked> detail=<text>` |
| `[wave-eval]` | `[wave-eval] state=<satisfied\|needs-more-work\|blocked> targets=<n> benchmarks=<n> regressions=<n> target_ids=<csv> benchmark_ids=<csv> detail=<text>` |
| `[wave-integration]` | `[wave-integration] state=<ready-for-doc-closure\|needs-more-work> claims=<n> conflicts=<n> blockers=<n> detail=<text>` |
| `[wave-doc-closure]` | `[wave-doc-closure] state=<closed\|no-change\|delta> paths=<comma-separated-paths> detail=<text>` |
| `[infra-status]` | `[infra-status] kind=<conformance\|role-drift\|dependency\|identity\|admission\|action> target=<surface> state=<checking\|setup-required\|setup-in-progress\|conformant\|drift\|blocked\|failed\|action-required\|action-approved\|action-complete> detail=<text>` |
| `[deploy-status]` | `[deploy-status] state=<deploying\|healthy\|failed\|rolled-back> service=<name> detail=<text>` |

- Every marker must appear on a single line.
- The `detail` field is free text but should be concise (under 120 characters).
- Only the role that owns the marker type should emit it. Do not emit markers for other roles.

<!-- CUSTOMIZE: Add project-specific marker types or extend existing formats here. -->

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Project-specific coordination record format
  - Additional closure conditions beyond the nine listed
  - Custom marker types for project-specific workflows
  - Ownership rules for monorepo sub-packages
-->
