# Migration

This page is the practical repo-upgrade guide for the current `0.8.5` surface.

Use it when you are:

- adopting Wave in a repo that already has local prompts, docs, or skills
- upgrading from an older package release
- deciding which files to sync from the starter surface and which files to leave repo-owned

For the completed internal architecture cutover record, see [architecture-hardening-migration.md](./architecture-hardening-migration.md). That document is historical. This one is the operator-facing upgrade checklist.

## What `0.8.5` Changes

`0.8.5` ships a new authored and runtime surface, not just a patch-level hardening change.

The biggest additions are:

- the optional `design` worker role is now part of the published package surface
- starter design bundles now ship in `docs/agents/wave-design-role.md`, `skills/role-design/`, and `skills/tui-design/`
- design stewards are docs-first by default, but a wave may explicitly give one implementation ownership
- hybrid design stewards now run in two phases:
  - design packet first
  - implementation follow-through second
- gates, retry or resume planning, reducer state, prompts, local smoke execution, and result envelopes now all agree on that hybrid-design contract

There are no new top-level CLI commands for `0.8.5`.

## Upgrade Contract

- `pnpm up @chllming/wave-orchestration` updates the installed runtime.
- `pnpm exec wave upgrade` writes `.wave/install-state.json` and `.wave/upgrade-history/*` only.
- `wave upgrade` does not rewrite repo-owned `wave.config.json`, `docs/agents/*`, `docs/plans/waves/*`, `skills/*`, `docs/context7/*`, or local runbooks.
- `.tmp/<lane>-wave-launcher/` is runtime state, not migration source of truth. Do not preserve old generated artifacts as if they were authored configuration.

## Package-Owned vs Repo-Owned

Treat these as package-owned starter surface unless your repo intentionally copied and now maintains them:

- `docs/agents/*.md`
- `skills/*`
- `docs/plans/current-state.md`
- `docs/plans/end-state-architecture.md`
- `docs/plans/wave-orchestrator.md`
- `docs/plans/migration.md`
- `docs/reference/*`
- `docs/context7/planner-agent/*`

Treat these as repo-owned operational surface:

- `wave.config.json`
- `docs/plans/waves/*.md`
- `docs/plans/waves/specs/*.json`
- repo-specific prompts, internal runbooks, and policy docs
- repository source code and deployment config

If your repo never copied a starter file, do not invent migration work for it. The installed package already ships the runtime behavior.

## Safe Upgrade Flow For Any Existing Repo

### 1. Upgrade when the lane is idle

- Prefer upgrading between waves, not mid-attempt.
- If a lane still has running sessions, finish or intentionally stop that attempt before changing package versions.
- If the repo is stranded after a prior crash, inspect `wave control status` first and decide whether to relaunch or reconcile on the upgraded package.

### 2. Bump the package

```bash
pnpm up @chllming/wave-orchestration
pnpm exec wave upgrade
```

### 3. Sync repo-owned starter surface only if you copied it

The most common sync set for `0.8.5` is:

- `docs/agents/wave-launcher-role.md`
- `docs/agents/wave-orchestrator-role.md`
- `docs/agents/wave-planner-role.md`
- `docs/agents/wave-design-role.md`
- `skills/wave-core/`
- `skills/role-planner/`
- `skills/role-design/`
- `skills/tui-design/` when your repo wants the terminal or operator-surface design reference
- `docs/context7/planner-agent/`
- `docs/reference/wave-planning-lessons.md`
- `docs/plans/current-state.md`
- `docs/plans/end-state-architecture.md`
- `docs/plans/wave-orchestrator.md`
- `docs/plans/migration.md`
- `docs/reference/skills.md`
- `docs/reference/sample-waves.md`

If your repo copied starter `wave.config.json` defaults, also sync the design-role entries:

- `roles.designRolePromptPath`
- `skills.byRole.design`
- `executors.profiles.design-pass`

### 4. Re-validate before a live run

Run these from the repo root:

```bash
pnpm exec wave doctor --json
pnpm exec wave launch --lane main --dry-run --no-dashboard
pnpm exec wave control status --lane main --wave 0 --json
pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run
```

Use `pnpm exec wave dashboard --lane <lane> --attach current` or `--attach global` when you need to reattach to a tmux-backed dashboard after the upgrade.

## `0.8.5` Design-Steward Model

This is the main new behavior in the current `0.8.5` surface.

### Docs-first design stewards

Default design stewards:

- import `docs/agents/wave-design-role.md`
- own at least one packet path such as `docs/plans/waves/design/wave-<n>-<agentId>.md`
- stay docs or spec-first
- finish with `[wave-design] state=<ready-for-implementation|needs-clarification|blocked> ...`

### Hybrid design stewards

If the wave explicitly assigns non-packet ownership to a design agent, that agent becomes a hybrid design steward.

The runtime now treats that as:

1. a design pass first
2. then the same agent rejoins implementation with normal proof obligations

For a hybrid design steward, make sure the wave still includes:

- a design packet path
- any explicit implementation-owned paths
- `### Exit contract` when your lane validation requires it
- `### Components` when your lane validation requires them
- `### Proof artifacts` when the owned slice is proof-centric

The second pass must still re-emit `[wave-design]`, and it must also satisfy the normal implementation proof, doc-delta, and component-marker contract.

### Planner note

The interactive `wave draft` flow now supports `design` as a worker role and scaffolds the docs-first default path.

If you want a hybrid design steward today, the safest authoring paths are:

- edit the drafted wave manually
- or use an agentic planner payload that already declares the design agent's explicit implementation ownership

## Version-Specific Upgrade Guidance

## Upgrading From `0.8.3` To `0.8.5`

This is the most common one-step package upgrade path.

### What changed across that range

- `0.8.4` tightened contradiction replay, component-promotion threshold handling, and projection persistence boundaries
- `0.8.5` ships the `design` worker role, the `role-design` and `tui-design` starter bundles, and the hybrid design-steward runtime model as part of the published package
- current operator and planner docs now describe the shipped surface directly instead of splitting behavior between a published package and newer `main`-only additions

### Required repo changes

Usually none if the repo does not copy starter prompts, skills, or planning docs.

### Strongly recommended sync

If the repo copied starter surface, sync:

- `docs/agents/wave-design-role.md`
- `skills/role-design/`
- `skills/tui-design/`
- `docs/guides/author-and-run-waves.md`
- `docs/guides/planner.md`
- `docs/reference/skills.md`
- `docs/reference/sample-waves.md`
- `docs/plans/current-state.md`
- `docs/plans/wave-orchestrator.md`
- `docs/plans/end-state-architecture.md`

If the repo copied starter `wave.config.json` defaults, also sync:

- `roles.designRolePromptPath`
- `skills.byRole.design`
- `executors.profiles.design-pass`

### Validation focus

- confirm contradiction-blocked replay cases still compare cleanly if the repo keeps replay fixtures
- if the repo uses design stewards, confirm packet-only design waves still block implementation until `ready-for-implementation`
- if the repo uses hybrid design stewards, confirm the same agent rejoins implementation only when the authored wave explicitly gives it code ownership

## Upgrading From `0.8.4` To `0.8.5`

This is the smallest upgrade that still changes authored behavior.

### What changed

- the optional `design` worker role is now part of the published package surface
- `role-design` and `tui-design` starter bundles now ship with the release
- design stewards can now be docs-first or explicit hybrid design stewards
- prompts, gates, retry or resume planning, reducer state, and local smoke execution now honor that hybrid-design contract consistently

### Required repo changes

None if your repo does not use design stewards.

### Strongly recommended sync

If your repo copied starter prompts, skills, or authoring docs, sync:

- `docs/agents/wave-design-role.md`
- `skills/role-design/`
- `skills/tui-design/`
- `docs/guides/author-and-run-waves.md`
- `docs/guides/planner.md`
- `docs/reference/skills.md`
- `docs/reference/sample-waves.md`

If your repo copied starter config defaults, also sync the `designRolePromptPath`, `skills.byRole.design`, and `design-pass` profile entries.

### Validation focus

If the repo uses design stewards, dry-run at least one wave that proves:

- the design packet path resolves inside the repo
- design runs before implementation
- implementation does not start until every design packet is `ready-for-implementation`
- hybrid design stewards rejoin implementation when they explicitly own code
- downstream implementation prompts read the same-wave design packet context

## Upgrading From `0.8.0`-`0.8.4` To `0.8.5`

Treat this as one move to the current `0.8.5` surface.

### What changed across that range

- completed-wave control projections hardened
- human-input reconciliation and continuation repair landed
- contradiction replay and component-threshold handling were tightened
- projection persistence centralized under `projection-writer.mjs`
- the design-role surface is now shipped instead of living only on source `main`

### Required repo changes

Usually none for core config shape.

### Strongly recommended sync

If your repo copied starter docs or skills, sync:

- current operator runbook and architecture docs
- planner starter corpus
- design-role starter prompt and skill bundles
- any repo-local docs that still describe design as “main only” or “future”

### Validation focus

- check that completed waves do not show stale blockers through `wave control status`
- answer at least one human-feedback ticket in a test lane and confirm the linked clarification or escalation chain closes cleanly
- replay one contradiction-blocked trace if your repo relies on replay regression coverage
- dry-run one design-steward wave if the repo wants the new authored surface

## Upgrading From `0.6.x` Or `0.7.x` To `0.8.5`

This is the main migration path for older adopted repos.

### Behavioral changes you must account for

- `wave control` is the preferred operator surface for status, rerun, proof, and telemetry work
- `cont-QA` and optional `cont-EVAL` are distinct closure roles
- planner starter files are now treated as required repo-owned surface when the repo uses planner workflows
- live closure depends on validated result envelopes plus canonical state
- control-plane state, reducer state, and replay are first-class runtime surfaces
- optional design stewards are now a supported authored shape

### Required repo changes

1. Remove or rename legacy `evaluator` terminology to `cont-QA`.
2. Keep `A0` as the final closure owner and add `E0` only when the wave needs eval-driven tuning.
3. Add wave-level `## Eval targets` whenever `cont-EVAL` is present.
4. Sync the planner starter corpus if the repo uses `wave project` or `wave draft`:
   - `docs/agents/wave-planner-role.md`
   - `skills/role-planner/`
   - `docs/context7/planner-agent/`
   - `docs/reference/wave-planning-lessons.md`
   - the `planner-agentic` entry in `docs/context7/bundles.json`
5. Review any repo-owned docs or runbooks that still describe summary-era closure, pre-control-plane retry or proof behavior, or a single overloaded evaluator role.
6. If the repo wants design stewards, sync the design starter surface listed above and update local authoring docs accordingly.

### Additional validation

Run the default validation set, then also check:

```bash
pnpm exec wave control status --lane main --wave 0 --json
pnpm exec wave control rerun get --lane main --wave 0 --json
pnpm exec wave control proof get --lane main --wave 0 --json
```

If the repo carries proof-first waves, verify that required proof artifacts still exist locally and not only in historical summaries.

## Upgrading From `0.5.x` Or Earlier To `0.8.5`

Do not treat this as a tiny patch bump.

### Recommended approach

1. Read [docs/reference/migration-0.2-to-0.5.md](../reference/migration-0.2-to-0.5.md) first if the repo still looks pre-`0.5`.
2. Run `pnpm exec wave init --adopt-existing` on a branch so the workspace records install state without overwriting repo-owned material.
3. Move the repo onto the `0.6.x` and later surface using the section above.
4. Sync the planner corpus and, if needed, the design starter surface.
5. Re-run the full validation checklist before any live executor run.

### Why

Older repos often differ in:

- role naming
- closure ordering
- runtime config keys
- planner starter corpus
- proof and retry operator surfaces
- generated state layout under `.tmp/`

Trying to jump directly with ad hoc edits usually leaves hidden drift in prompts, docs, or config.

## Repo-Owned Files To Audit During Any Upgrade

### Prompts and skills

- `docs/agents/*.md`
- `skills/*`
- `docs/context7/bundles.json`
- `docs/context7/planner-agent/`

### Operator docs and runbooks

- `docs/plans/current-state.md`
- `docs/plans/wave-orchestrator.md`
- `docs/plans/end-state-architecture.md`
- `docs/plans/migration.md`
- `docs/reference/cli-reference.md`
- `docs/reference/wave-control.md`
- `docs/reference/sample-waves.md`
- `docs/reference/skills.md`

### Config and wave contracts

- `wave.config.json`
- `docs/plans/waves/*.md`
- `docs/plans/waves/specs/*.json`
- `docs/evals/benchmark-catalog.json`
- component-cutover matrix files under `docs/plans/`

## Validation Checklist After The Upgrade

Use this exact sequence unless your repo has a better repo-specific smoke suite.

```bash
pnpm exec wave doctor --json
pnpm exec wave launch --lane main --dry-run --no-dashboard
pnpm exec wave control status --lane main --wave 0 --json
pnpm exec wave coord show --lane main --wave 0 --dry-run --json
pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run
```

For repos that extend or test the runtime itself, also run:

```bash
pnpm test
```

For repos that depend on replay parity, replay at least:

- one contradiction-blocked trace
- one promoted-component trace
- one retry-history trace

## Troubleshooting

### `wave doctor` fails after the upgrade

- check whether the repo is missing copied planner starter surface
- check whether old `evaluator` naming is still present in config or prompts
- check whether local docs still describe unpublished main-branch behavior instead of the current package surface
- if the repo uses hybrid design stewards, check that each one still owns a design packet path and any required implementation-contract fields

### A live lane looks blocked after the bump

- use `wave control status --lane <lane> --wave <n> --json`
- confirm whether the blocker is canonical coordination, dependency, proof, human-input, or design-gate state
- do not trust generated markdown alone

### Replay differs from old expectations

- verify whether the trace declares promoted components
- compare `storedOutcome.gateSnapshot` against recomputed replay output before changing live policy
- if the repo copied local replay docs, update them to the current reducer and envelope model

## Summary

The current `0.8.5` surface keeps the same authority-set and phase-engine architecture, but it now ships the design-role starter surface and the hybrid design-steward runtime model as part of the published package. For most repos already on `0.8.x`, the upgrade is package bump plus validation. For older adopted repos, the real work is syncing repo-owned prompts, skills, planner corpus, and runbooks so they describe the runtime the package now ships.
