---
title: "Wave Orchestration Migration Guide: 0.2 to 0.5"
summary: "How to migrate a repository from the earlier 0.2 wave baseline to the current post-roadmap Wave model."
---

# Wave Orchestration Migration Guide: 0.2 to 0.5

This guide explains how to migrate a repository from the earlier Wave
Orchestration 0.2 baseline to the current post-roadmap Wave model.

Current mainline note:

- legacy `evaluator` terminology has been retired in favor of `cont-QA`
- waves can now add optional `cont-EVAL` plus `## Eval targets` for iterative benchmark or output tuning
- live closure is stricter than replay compatibility: current waves must emit structured cont-QA and cont-EVAL artifacts even though replay can still read older evaluator-era traces
- the benchmark catalog lives in `docs/evals/benchmark-catalog.json`

It uses two concrete references:

- the 0.2-style baseline in the sibling `~/slowfast.ai` repo
- the current target shape in this standalone `wave-orchestration` repo

This is a migration guide for the current architecture described in
[Roadmap](../roadmap.md), not just a changelog of whatever happens to be landed
in one point-in-time package build. This document is about the shipped runtime
shape, not only the semver label.

## Baseline And Target

Use these files as the concrete examples while migrating:

- 0.2 baseline config: `~/slowfast.ai/wave-orchestration/wave.config.json`
- 0.2 baseline runbook: `~/slowfast.ai/docs/plans/wave-orchestrator.md`
- 0.2 baseline wave example: `~/slowfast.ai/docs/plans/waves/wave-7.md`
- current target config: [wave.config.json](../../wave.config.json)
- current target sample wave: [wave-0.md](../plans/waves/wave-0.md)
- current target architecture: [roadmap.md](../roadmap.md)
- current package workflow: [README.md](../../README.md)

The migration is intentionally evolutionary:

- keep wave markdown as the authored plan surface
- keep lanes
- keep multi-role agents
- keep A0 cont-QA and A9 documentation stewardship
- add stronger runtime planning, typed coordination, optional E0 cont-EVAL, A8 integration, and
  orchestrator-first clarification handling

## What Changes

| Area | 0.2 baseline | 0.5 target | Migration action |
| --- | --- | --- | --- |
| Shared coordination | markdown message board plus status files | canonical coordination JSONL plus rendered board projection | Treat the markdown board as a view, not the source of truth |
| Agent context | raw board snapshots in prompts | compiled shared summary plus per-agent inbox | Switch operator review and agent recovery to inbox artifacts |
| Closure flow | implementation -> A9 -> A0 | implementation -> optional E0 cont-EVAL -> A8 integration -> A9 -> A0 | Add the integration steward and use cont-EVAL when the outcome needs iterative eval tuning |
| Runtime selection | lane default plus limited per-agent overrides | runtime profiles, role defaults, mix targets, fallbacks, budgets | Expand `wave.config.json` and deliberate `### Executor` planning |
| Clarification flow | file-backed human feedback queue | `clarification-request` -> orchestrator triage -> human escalation only if needed | Move humans to the end of the escalation ladder |
| Derived state | status summaries and dashboards | ledger, docs queue, integration summary, traces, triage logs | Update operator workflow and acceptance checks |
| Retry behavior | retry failed agents | retry based on coordination state, capabilities, lane policy, and fallback executor rules | Tighten relaunch logic and audit trail |

## Target 0.5 Policy Defaults

For this migration, use these defaults unless your repo has a strong reason to
do otherwise:

- `runtimeMixTargets` are a hard preflight limit.
- A rerouted clarification remains blocking until the routed follow-up is
  actually resolved or closed.
- Fallback executors are allowed on retry after unavailability, timeout, or
  failed attempt when policy permits.
- Automatic fallback must stay within the declared runtime mix.
- Documentation and cont-QA closure must not run until the integration
  steward reports `ready-for-doc-closure`.

These defaults match the intended 0.5 operating model and keep the runtime
plan authoritative.

## Before You Change Anything

Treat the migration as a lane-runtime cutover, not a doc-only rename.

Before starting:

1. Stop any active launcher for the lane you are migrating.
2. Reconcile stale state so you do not carry an abandoned run into the new
   model.
3. Snapshot the current wave docs, `wave.config.json`, and any repo-local
   role prompts before editing.
4. Assume `.tmp/<lane>-wave-launcher/` is disposable runtime state, not a
   migration source of truth.

Recommended prep commands:

```bash
pnpm exec wave launch --lane <lane> --reconcile-status
pnpm exec wave launch --lane <lane> --dry-run --no-dashboard
pnpm exec wave feedback list --lane <lane> --pending
```

If your repo still uses wrapper scripts like the `slowfast.ai` baseline:

```bash
pnpm wave:launch -- --lane <lane> --reconcile-status
pnpm wave:launch -- --lane <lane> --dry-run --no-dashboard
pnpm wave:feedback -- list --lane <lane> --pending
```

## Step 1: Upgrade The Package And Keep Existing Docs

If the repo consumes Wave as a package:

```bash
pnpm up @chllming/wave-orchestration
pnpm exec wave upgrade
pnpm exec wave doctor
```

If the repo vendors or ports the scripts directly, update the orchestrator
surface first and only then migrate wave docs.

The migration assumes you preserve existing plans and waves. Do not wipe
`docs/plans/` just because the runtime model is getting stronger.

## Step 2: Expand `wave.config.json`

The most obvious config difference between the `slowfast.ai` baseline and the
0.5 target is that 0.2 only models:

- A0 cont-QA
- A9 documentation steward
- global executor defaults
- validation thresholds

The 0.5 target adds:

- A8 integration steward
- executor profiles
- capability routing
- per-lane runtime policy
- integration validation threshold

### 0.2 baseline shape

From `~/slowfast.ai/wave-orchestration/wave.config.json`, the important parts
look like:

```json
{
  "roles": {
    "contQaAgentId": "A0",
    "documentationAgentId": "A9",
    "contQaRolePromptPath": "docs/agents/wave-cont-qa-role.md",
    "documentationRolePromptPath": "docs/agents/wave-documentation-role.md"
  },
  "executors": {
    "default": "codex",
    "codex": { "command": "codex", "sandbox": "danger-full-access" },
    "claude": { "command": "claude", "appendSystemPromptMode": "append", "outputFormat": "text" },
    "opencode": { "command": "opencode", "format": "default" }
  },
  "validation": {
    "requireDocumentationStewardFromWave": 0,
    "requireContext7DeclarationsFromWave": 6,
    "requireExitContractsFromWave": 6,
    "requireComponentPromotionsFromWave": 0,
    "requireAgentComponentsFromWave": 0
  }
}
```

### 0.5 target shape

In the standalone target repo, [wave.config.json](../../wave.config.json)
adds the missing surfaces:

```json
{
  "roles": {
    "contQaAgentId": "A0",
    "integrationAgentId": "A8",
    "documentationAgentId": "A9",
    "contQaRolePromptPath": "docs/agents/wave-cont-qa-role.md",
    "integrationRolePromptPath": "docs/agents/wave-integration-role.md",
    "documentationRolePromptPath": "docs/agents/wave-documentation-role.md"
  },
  "executors": {
    "default": "codex",
    "profiles": {
      "implement-fast": { "id": "codex" },
      "deep-review": { "id": "claude" },
      "docs-pass": { "id": "claude" },
      "ops-triage": { "id": "opencode" }
    }
  },
  "validation": {
    "requireIntegrationStewardFromWave": 0
  },
  "capabilityRouting": {
    "preferredAgents": {}
  },
  "lanes": {
    "main": {
      "runtimePolicy": {
        "runtimeMixTargets": { "codex": 3, "claude": 3, "opencode": 2 },
        "defaultExecutorByRole": {
          "implementation": "codex",
          "integration": "claude",
          "documentation": "claude",
          "cont-qa": "claude",
          "research": "opencode",
          "infra": "opencode",
          "deploy": "opencode"
        },
        "fallbackExecutorOrder": ["claude", "opencode", "codex"]
      }
    }
  }
}
```

### Required config migration actions

1. Add `roles.integrationAgentId`.
2. Add `roles.integrationRolePromptPath`.
3. Add `validation.requireIntegrationStewardFromWave`.
4. Add `executors.profiles`.
5. Add `capabilityRouting`.
6. Add per-lane `runtimePolicy`.
7. Keep existing `sharedPlanDocs`, Context7 config, and component matrix paths
   unless your repo layout changed.

### Recommended runtime-profile starter set

Use four profiles first:

- `implement-fast`: default implementation work
- `deep-review`: integration, cont-QA, and review-heavy work
- `docs-pass`: documentation steward work
- `ops-triage`: research, infra, and deployment triage work

Do not start with ten profiles. Keep the first migration small and legible.

## Step 3: Add The Integration Steward Role

The biggest behavior change from 0.2 to 0.5 is that A9 and A0 are no longer
the only closure agents. A8 becomes the explicit integration steward.

Add [wave-integration-role.md](../agents/wave-integration-role.md) or an
equivalent repo-local role prompt.

What A8 owns in 0.5:

- synthesize cross-agent state
- detect unresolved contradictions
- detect interface drift and unowned work
- decide whether the wave is ready for documentation closure
- emit the final `[wave-integration]` marker

What A8 does not own:

- feature implementation
- documentation closure
- cont-QA verdict

If your 0.2 repo used cont-QA prose to absorb integration work implicitly,
move that responsibility out of A0 and into A8.

## Step 4: Migrate Wave Files

The baseline `slowfast.ai` waves already have several good habits:

- explicit A0 cont-QA
- explicit A9 documentation steward
- Context7 declarations
- component promotions
- exit contracts
- explicit owned files

Keep those.

The 0.5 migration changes the wave shape in four places:

1. Add A8.
2. Add `### Executor` for deliberate mixed-runtime waves.
3. Add `### Capabilities` where dynamic routing is useful.
4. Make integration and clarification flow explicit in prompts and ownership.

### Minimum wave-file delta

For each migrated wave:

- keep `## Component promotions`
- keep `## Context7 defaults`
- keep A0
- add A8
- keep A9
- keep implementation agents
- preserve `### Exit contract` and `### Components`
- add `### Executor` to every agent when you want a deliberate runtime mix

### Example: 0.2 baseline to 0.5 target

The `~/slowfast.ai/docs/plans/waves/wave-7.md` baseline already has A0 and A9
plus strong implementation sections, but no dedicated A8 integration steward
and no explicit runtime planning model.

A minimal 0.5 upgrade looks like this:

````md
## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- profile: deep-review

### Context7

- bundle: none

### Capabilities

- integration
- docs-shared-plan

### Prompt
```text
Synthesize cross-agent state before documentation and cont-QA closure.

File ownership (only touch these paths):
- .tmp/<lane>-wave-launcher/integration/wave-<n>.md
- .tmp/<lane>-wave-launcher/integration/wave-<n>.json
```
````

For implementation agents in a mixed-runtime wave, prefer explicit executor
sections instead of relying on lane defaults:

````md
### Executor

- profile: implement-fast
- fallbacks: claude, opencode
````

For documentation or cont-QA roles:

````md
### Executor

- profile: deep-review
````

### Planning rules for mixed-runtime waves

If the wave is intentionally mixed-runtime, declare `### Executor` on every
agent. Do not leave half the wave implicit and expect the lane defaults to
communicate the runtime plan clearly.

Recommended first mapping:

- implementation and test-fix roles: `codex`
- integration steward: `claude`
- documentation steward: `claude`
- cont-QA: `claude`
- infra or deploy roles: `opencode` or `codex`, chosen deliberately
- research helpers: `opencode`

## Step 5: Change Clarification Semantics

In the 0.2 baseline, the human feedback queue is visible early in the launcher
workflow. The `slowfast.ai` launcher role even says pending feedback is an
inspection signal, not a strongly orchestrated triage path.

In 0.5, the intended flow is:

1. an agent emits a `clarification-request`
2. the orchestrator tries to resolve or reroute it
3. only unresolved product, policy, safety, or external-intent questions become
   human tickets

### Required migration action

Update role prompts and operator guidance so the human feedback CLI is no longer
the first reflex.

Agents should be taught to:

- read the shared summary and inbox first
- emit structured clarification records
- continue with a logged best assumption when safe
- use human feedback only when the orchestrator cannot resolve the issue

### Blocking rule

A routed clarification is still blocking until the routed follow-up request is
actually resolved or closed.

A reroute is not resolution. It is just reassignment.

## Step 6: Change Operator Workflow

The 0.2 operator loop is centered on:

- wave dry run
- message board inspection
- status files
- dashboards
- human feedback queue

The 0.5 operator loop must center on derived state:

- coordination log
- board projection
- shared summary
- per-agent inboxes
- ledger
- integration summary
- docs queue
- clarification triage
- traces

### Old review habit

Inspect:

- `.tmp/<lane>-wave-launcher/messageboards/`
- `.tmp/<lane>-wave-launcher/status/`
- `.tmp/<lane>-wave-launcher/dashboards/`

### New review habit

Inspect:

- `.tmp/<lane>-wave-launcher/coordination/wave-<n>.jsonl`
- `.tmp/<lane>-wave-launcher/messageboards/wave-<n>.md`
- `.tmp/<lane>-wave-launcher/inboxes/wave-<n>/shared-summary.md`
- `.tmp/<lane>-wave-launcher/inboxes/wave-<n>/<agent>.md`
- `.tmp/<lane>-wave-launcher/ledger/wave-<n>.json`
- `.tmp/<lane>-wave-launcher/integration/wave-<n>.md`
- `.tmp/<lane>-wave-launcher/feedback/triage/wave-<n>.jsonl`
- `.tmp/<lane>-wave-launcher/traces/wave-<n>/attempt-<k>/run-metadata.json`
- `.tmp/<lane>-wave-launcher/traces/wave-<n>/attempt-<k>/quality.json`
- `.tmp/<lane>-wave-launcher/traces/wave-<n>/attempt-<k>/structured-signals.json`

Trace review note:

- `wave launch --dry-run` still seeds only pre-attempt state. It should not create `attempt-<k>` trace snapshots.
- New `traceVersion: 2` bundles are hermetic: replay uses only the stored bundle, validates recorded hashes, and stays read-only.
- Launched-agent summary files and promoted-wave component matrix files are part of that hermetic v2 contract.
- Legacy `traceVersion: 1` bundles still replay in best-effort warning mode.
- Trace replay support is internal in the current package. Use the stored bundle for regression review, but do not assume a supported `wave replay` CLI yet.

### New operator commands

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane <lane> --dry-run --no-dashboard
pnpm exec wave coord show --lane <lane> --wave <n> --dry-run
pnpm exec wave coord inbox --lane <lane> --wave <n> --agent A8 --dry-run
pnpm exec wave feedback list --lane <lane> --pending
```

If the repo still exposes wrapper scripts:

```bash
pnpm wave:launch -- --lane <lane> --dry-run --no-dashboard
pnpm wave:feedback -- list --lane <lane> --pending
```

## Step 7: Migrate Closure And Retry Rules

The 0.2 baseline already had a useful closure sweep, but it was effectively:

- implementation settles
- A9 reruns
- A0 reruns

The 0.5 target changes this to:

- implementation settles
- A8 emits a final integration summary
- if A8 says `needs-more-work`, relaunch the right owners
- only after A8 says `ready-for-doc-closure`, run A9
- only after A9 closes or confirms `no-change`, run A0

### Runtime fallback policy

0.5 should allow fallback executor reassignment on retry when policy allows it,
including:

- executor unavailable
- timeout
- failed attempt

But fallback must:

- follow the declared fallback order
- stay within hard `runtimeMixTargets`
- record the reassignment in the ledger, integration summary, and traces

### Runtime mix policy

Treat lane `runtimeMixTargets` as a hard fail at validation or launch
preflight.

That means:

- if the wave resolves to `4 codex / 2 claude / 1 opencode` but the lane says
  `3 / 2 / 2`, the wave should not launch
- if a retry fallback would violate the mix, the fallback should be rejected
  and the wave should remain blocked

## Step 8: Migrate Acceptance Criteria

A 0.2 wave often feels complete when:

- all agents exit `0`
- A9 closes docs
- A0 passes

The 0.5 target adds more explicit acceptance state:

- no unresolved integration contradiction
- no unresolved blocking clarification
- no unresolved high-priority blocker
- runtime plan is within policy
- documentation closure is explicit
- cont-QA verdict is explicit
- the ledger says the wave is actually complete
- traces capture the final state for replay

Use this acceptance checklist after the migration:

1. `wave doctor` passes.
2. `wave launch --dry-run` passes.
3. Seeded coordination state exists.
4. Shared summary and inboxes exist.
5. A8 exists and is validated.
6. Runtime profiles resolve correctly for every agent.
7. No resolved executor count exceeds lane mix targets.
8. Clarification triage works without immediately creating human tickets for
   obvious ownership questions.
9. Documentation and cont-QA closure run only after the integration steward
   is ready.
10. A live attempt writes a trace bundle with coordination, inbox, ledger,
    integration, structured signals, `run-metadata.json`, and cumulative
    `quality.json`.

## Step 9: Roll Out In Two Passes

Do not flip a large repo from 0.2 to full 0.5 autonomy in one step.

Recommended rollout:

### Pass 1: Structural migration

- update `wave.config.json`
- add A8 role prompt
- update one or two wave files
- keep launches manual
- validate coordination, inbox, ledger, and integration artifacts

### Pass 2: Behavioral migration

- enable mixed-runtime planning
- enable hard runtime-mix preflight
- enable orchestrator-first clarification handling
- enable fallback-on-retry policy
- only then trust autonomous mode for the lane

## Common Pitfalls

### 1. Adding A8 only in config

Adding `integrationAgentId` to config is not enough. Each migrated wave must
actually declare the A8 agent and import the integration role prompt.

### 2. Leaving runtime choice implicit in mixed-runtime waves

If the lane intentionally runs `codex + claude + opencode`, declare
`### Executor` on every agent. Otherwise the runtime plan is real but hidden.

### 3. Treating the generated board as canonical state

The markdown board is now an audit projection. Read the coordination JSONL and
the compiled inboxes when debugging scheduler behavior.

### 4. Escalating to humans too early

If the question is really ownership, shared-plan scope, component ownership, or
integration routing, the orchestrator should resolve it first.

### 5. Reusing stale runtime state

Do not trust old `.tmp/<lane>-wave-launcher/` artifacts after the migration.
Reconcile or clear stale run state before validating the new model.

## Minimal Migration Checklist

- Add A8 config and prompt.
- Add executor profiles.
- Add lane runtime policy.
- Add or update `### Executor` blocks.
- Add or update `### Capabilities` blocks where needed.
- Update launcher/operator guidance to use inboxes, ledger, and integration.
- Make clarification escalation orchestrator-first.
- Enforce hard runtime-mix preflight.
- Keep routed clarifications blocking until final resolution.
- Allow fallback executors only within declared policy and with traceable audit.

## Final Recommendation

If the repo looks like the `slowfast.ai` 0.2 baseline, do not try to migrate
every historical wave at once.

Migrate in this order:

1. `wave.config.json`
2. role prompts
3. one representative active wave
4. operator workflow
5. autonomous and retry policy

That sequence keeps the migration reviewable and avoids a large, ambiguous
"orchestrator rewrite" commit.
