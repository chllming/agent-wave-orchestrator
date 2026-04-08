---
title: "Sample Waves"
summary: "Showcase-first sample waves that demonstrate the shipped 0.9.12 authored surface, including the optional design-role path."
---

# Sample Waves

This guide points to showcase-first sample waves that demonstrate the shipped `0.9.12` authored Wave surface.

The examples are intentionally denser than typical production waves. Their job is to teach the current authoring and runtime surface quickly, not to be the smallest possible launch-ready files.

All example `.tmp/main-wave-launcher/...` paths assume the implicit default project. For explicit monorepo projects, rewrite those to `.tmp/projects/<projectId>/main-wave-launcher/...` and run the matching commands with `--project <projectId>`.

## Canonical Examples

- [High-fidelity repo-landed rollout wave](../plans/examples/wave-example-rollout-fidelity.md)
  Shows what a good `repo-landed` outcome looks like when one promoted component only closes honestly if desired-state records, reconcile-loop substrate, and cluster-view surfaces land together. It emphasizes maturity discipline, explicit deliverables, and shared-plan closure without drifting into `pilot-live` claims.

- [Full modern sample wave](../plans/examples/wave-example-live-proof.md)
  Shows the combined `0.9.12` authored surface in one file: closure roles, `E0`, optional security review, delegated and pinned benchmark targets, richer executor config, `### Skills`, `### Capabilities`, `### Deliverables`, `### Exit contract`, `### Proof artifacts`, sticky retry, deploy environments, and proof-first live-wave structure.

- [Optional design-steward handoff wave](../plans/examples/wave-example-design-handoff.md)
  Shows the shipped design-role surface: one pre-implementation design steward publishes a design packet, downstream implementation owners read that packet before coding, and normal closure roles still decide final completion. For terminal or operator-surface work, pair that shape with explicit `tui-design` in the design steward's `### Skills`. For the hybrid variant, explicitly give that same design agent implementation-owned paths and the normal implementation contract sections.

## What These Examples Teach

- the standard closure-role structure with `A0`, `A8`, and `A9`
- `E0` and wave-level `## Eval targets` in the full modern sample
- honest `repo-landed` maturity framing without `pilot-live` drift
- multi-slice component promotion where all sibling owners must land together
- shared-plan and component-matrix closure as part of the architecture truth
- delegated versus pinned benchmark selection
- coordination benchmark families from `docs/evals/benchmark-catalog.json`
- richer executor blocks, runtime budgets, and retry policy
- cross-runtime `### Skills`
- helper-routing hints via `### Capabilities`
- `### Deliverables`
- `### Exit contract`
- proof-first `### Proof artifacts`
- sticky retry for proof-bearing owners
- deploy environments and provider-skill examples
- infra and deploy-verifier specialist slices
- optional pre-implementation design packets and design-to-implementation handoff
- security review before integration closure
- project-aware adaptation for launcher-owned `.tmp/...` paths

## Feature Coverage Map

Together these samples cover the main surfaces added or hardened through `0.9.12`:

- repo-landed maturity discipline and anti-overclaim framing
- explicit shared-plan closure for future-wave safety
- coordinated component slices with per-agent deliverables
- planner-era authored wave structure
- cross-runtime `### Skills`
- richer `### Executor` blocks and runtime budgets
- `cont-EVAL` plus `## Eval targets`
- delegated and pinned benchmark selection
- coordination benchmark families from `docs/evals/benchmark-catalog.json`
- helper-routing hints through `### Capabilities`
- `### Deliverables`
- `### Proof artifacts`
- sticky retry for proof-bearing owners
- proof-first live-wave prompts
- deploy environments and deploy-kind-aware skills
- optional security review before integration closure
- custom closure-role ids when a repo does not want the starter `A0`/`E0`/`A8`/`A9`/`A7` names
- signal-driven long-running watcher agents through `signal-hygiene`
- explicit-project launcher-state path rewrites for monorepos
- integration, documentation, and cont-QA closure-role structure
- optional `design` worker role and `design-pass` executor profile

## Targeted Snippets For Narrower Surfaces

Some current features are real parts of the authored surface, but they do not belong in every full-length teaching wave. Use these snippets when you need those narrower shapes.

### Custom Closure Role Ids

Wave resolves closure roles from the wave definition first, then from starter defaults. You can keep the same closure semantics while changing the ids:

```md
## Agent Q4: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

## Agent V2: cont-EVAL

### Role prompts

- docs/agents/wave-cont-eval-role.md

## Agent I6: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

## Agent D8: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

## Agent S3: Security Review

### Role prompts

- docs/agents/wave-security-role.md
```

Keep the role prompt and closure meaning aligned even when the ids change. Launch, retry, derived state, and closure sequencing will honor the wave-level bindings.

### Long-Running Watchers With `signal-hygiene`

Use `signal-hygiene` only for intentionally long-running non-resident agents that should wait on orchestrator-written signal changes instead of inventing their own polling protocol.

````md
## Agent R5: Runtime Watcher

### Executor

- id: codex
- retry-policy: sticky

### Skills

- role-research
- runtime-codex
- signal-hygiene

### Prompt

```text
Primary goal:
- Stay alive between orchestrator signal changes and only resume work after acknowledging the next visible signal version.

Specific expectations:
- use the prompt-visible signal state path and ack path exactly as provided
- do not create a second polling file or custom wakeup loop
- emit normal structured coordination records when new evidence or blockers appear
```
````

Pair that snippet with [signal-wrappers.md](../guides/signal-wrappers.md) when shell automation or external wait loops also need to observe the same signal surface.

### Project-Aware Launcher-Owned Paths

When copying a proof-first example into an explicit monorepo project, update launcher-owned file paths as well as the runtime command:

```md
File ownership (only touch these paths):
- .tmp/projects/service/main-wave-launcher/integration/wave-14.md
- .tmp/projects/service/main-wave-launcher/integration/wave-14.json
```

The same rewrite applies to proof bundles, logs, dashboards, coordination state, and telemetry spools under `.tmp/<lane>-wave-launcher/...`.

## When To Copy Literally Vs Adapt

Copy more literally when:

- you need the section layout
- you want a concrete example of what good repo-landed wave fidelity looks like
- you want concrete wording for delegated versus pinned benchmark targets
- you want a proof-first owner example with local artifact bundles and sticky retry

Adapt more aggressively when:

- your repo has different role ids or role prompts
- your component promotions and maturity levels differ
- your runtime policy uses different executor profiles or runtime mix targets
- your deploy environments or provider skills differ from the example

## How This Example Maps To Other Docs

- Use [docs/guides/planner.md](../guides/planner.md) for the planner-generated baseline, then use these samples to see how a human would enrich the generated draft for either repo-landed or proof-first work.
- Use [Optional design-steward handoff wave](../plans/examples/wave-example-design-handoff.md) when the wave should start with a reusable design packet before implementation begins.
- Use [docs/evals/README.md](../evals/README.md) with the full modern sample when you need to see delegated and pinned benchmark targets in a real wave.
- Use [docs/reference/live-proof-waves.md](./live-proof-waves.md) with the full modern sample when you need proof-first authoring for `pilot-live` and above.
- Use [docs/plans/wave-orchestrator.md](../plans/wave-orchestrator.md) for the operational runbook that explains how the launcher interprets these sections.

## Suggested Reading Order

1. Start with [High-fidelity repo-landed rollout wave](../plans/examples/wave-example-rollout-fidelity.md) if you want the clearest example of good closure-ready wave fidelity for a repo-only outcome.
2. Read [Full modern sample wave](../plans/examples/wave-example-live-proof.md) if you want the denser proof-first and eval-heavy `0.9.12` surface.
3. Read [Optional design-steward handoff wave](../plans/examples/wave-example-design-handoff.md) if the task needs a design packet before implementation fan-out.
4. Read [docs/evals/README.md](../evals/README.md) if you want more background on benchmark target selection.
5. Read [docs/reference/live-proof-waves.md](./live-proof-waves.md) if you want more detail on proof-first `pilot-live` authoring.

## Why These Examples Live In `docs/plans/examples/`

The examples live outside `docs/plans/waves/` on purpose.

That keeps it:

- easy to browse as teaching material
- clearly separate from the repo's real launcher-facing wave sequence
- safe to evolve as reference material without implying that they are part of the current lane's actual plan history
