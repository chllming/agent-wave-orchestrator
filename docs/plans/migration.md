# Migration

This page is the practical repo-upgrade guide for the current `0.9.0` surface.

Use it when you are:

- adopting Wave in a repo that already has local prompts, docs, or skills
- upgrading from an older package release
- deciding which files to sync from the starter surface and which files to leave repo-owned

For the completed internal architecture cutover record, see [architecture-hardening-migration.md](./architecture-hardening-migration.md). That document is historical. This one is the operator-facing upgrade checklist.

## What `0.9.0` Changes

The current `0.9.0` surface keeps the packaged operator-guidance alignment and adds first-class monorepo project support plus project-aware default telemetry.

The practical changes are:

- `wave.config.json` can now declare `defaultProject` and `projects.<projectId>`, so one repo can host multiple Wave projects without lane-name collisions
- planner defaults, docs roots, ad-hoc runs, dependency tickets, launcher state, and benchmark identity are now scoped by project when you use explicit monorepo projects
- lane-scoped commands now accept `--project`, so the CLI can target the right project without relying on lane names alone
- Wave Control defaults to `https://wave-control.up.railway.app/api/v1` with `reportMode: "metadata-only"` and sends project, lane, and wave metadata unless you explicitly opt out
- the current release surface and tracked install-state fixtures now all move together on `0.9.0`

If your repo copied starter docs, shell automation, runbooks, or `wave.config.json` defaults, these are the areas most likely to need a sync before the `0.9.0` package cut.

For a practical `0.9.0` operating stance after the upgrade, read [../guides/recommendations-0.9.0.md](../guides/recommendations-0.9.0.md).

## What `0.8.6` Changes

`0.8.6` keeps the `0.8.5` design-role surface and adds a new signal-driven operator and long-running-agent model.

The biggest additions are:

- the optional `design` worker role remains part of the published package surface
- starter design bundles still ship in `docs/agents/wave-design-role.md`, `skills/role-design/`, and `skills/tui-design/`
- starter signal bundles now also ship in `skills/signal-hygiene/`, `scripts/wave-status.sh`, and `scripts/wave-watch.sh`
- long-running agents and resident orchestrators now receive prompt-visible signal-state and signal-ack paths
- canonical versioned wave and agent signal snapshots now live under `.tmp/<lane>-wave-launcher/signals/`
- wrapper and signal semantics now treat `completed` and `failed` as truly terminal, with wrapper exit `40` for failed terminal state

There are no new top-level CLI commands for `0.8.6`. The wrapper scripts are starter utilities layered over `wave control status --json`, not a new top-level CLI family.

## Upgrade Contract

- `pnpm up @chllming/wave-orchestration` updates the installed runtime.
- `pnpm exec wave upgrade` writes `.wave/install-state.json` and `.wave/upgrade-history/*` only.
- `wave upgrade` does not rewrite repo-owned `wave.config.json`, `docs/agents/*`, `docs/plans/waves/*`, `skills/*`, `docs/context7/*`, or local runbooks.
- `.tmp/<lane>-wave-launcher/` is runtime state, not migration source of truth. Do not preserve old generated artifacts as if they were authored configuration.

## Package-Owned vs Repo-Owned

Treat these as package-owned starter surface unless your repo intentionally copied and now maintains them:

- `docs/agents/*.md`
- `skills/*`
- `scripts/wave-status.sh`
- `scripts/wave-watch.sh`
- `docs/guides/signal-wrappers.md`
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

The most common sync set for `0.9.0` is:

- `docs/agents/wave-launcher-role.md`
- `docs/agents/wave-orchestrator-role.md`
- `docs/agents/wave-planner-role.md`
- `docs/agents/wave-design-role.md`
- `skills/wave-core/`
- `skills/role-planner/`
- `skills/role-design/`
- `skills/tui-design/`
- `skills/signal-hygiene/`
- `scripts/wave-status.sh`
- `scripts/wave-watch.sh`
- `docs/guides/author-and-run-waves.md`
- `docs/guides/planner.md`
- `docs/guides/terminal-surfaces.md`
- `docs/guides/signal-wrappers.md`
- `docs/context7/planner-agent/`
- `docs/reference/wave-planning-lessons.md`
- `docs/reference/cli-reference.md`
- `docs/reference/skills.md`
- `docs/reference/sample-waves.md`
- `docs/plans/current-state.md`
- `docs/plans/end-state-architecture.md`
- `docs/plans/wave-orchestrator.md`
- `docs/plans/migration.md`

If your repo copied starter `wave.config.json` defaults, also sync:

- `defaultProject`
- `projects.<projectId>`
- `roles.designRolePromptPath`
- `skills.byRole.design`
- `executors.profiles.design-pass`

### 4. Re-validate before a live run

Run these from the repo root:

```bash
pnpm exec wave doctor --json
pnpm exec wave launch --lane main --dry-run --no-dashboard
pnpm exec wave control status --lane main --wave 0 --json
scripts/wave-status.sh --lane main --wave 0
scripts/wave-watch.sh --lane main --wave 0 --until-change --refresh-ms 500
pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run
```

Use `pnpm exec wave dashboard --lane <lane> --attach current` or `--attach global` when you need to reattach to a tmux-backed dashboard after the upgrade.

## `0.9.0` Release Model

The current `0.9.0` surface is three changes together:

- the shipped `design` worker role and hybrid design-steward flow introduced in `0.8.5`
- the signal-driven long-running-agent and wrapper model introduced in `0.8.6`
- the policy-consistency, targeted-recovery, capability-specific routing, and stable per-wave session reuse hardening introduced in `0.8.7`
- the packaged recommendations guide and install-state alignment follow-up released in `0.9.0`

### Signal-driven waiting and wrapper model

This is the main new behavior in `0.8.6`.

Starter repos now include:

- `skills/signal-hygiene/`
- `scripts/wave-status.sh`
- `scripts/wave-watch.sh`

Use that model when:

- an external shell loop or CI job should wait for a wave or agent to change state
- a non-resident agent is intentionally long-running and should wake only on orchestrator-written signal changes
- a resident orchestrator should explicitly acknowledge that it observed a reroute, answered feedback, or terminal transition

The contract is:

- the runtime publishes versioned signal snapshots under `.tmp/<lane>-wave-launcher/signals/`
- long-running watchers receive a signal-state path and signal-ack path in the prompt
- the watcher writes the ack file immediately after it observes a new signal version
- wrapper exit codes are now:
  - `0` completed
  - `10` still active or waiting
  - `20` input required
  - `30` signal changed while still active from `wave-watch.sh --until-change`
  - `40` failed

If your repo copied operator docs, shell automation, or starter scripts, this is the main sync set to apply from `0.8.6`.

### `0.8.5` design-steward model

Docs-first design stewards:

- import `docs/agents/wave-design-role.md`
- own at least one packet path such as `docs/plans/waves/design/wave-<n>-<agentId>.md`
- stay docs or spec-first
- finish with `[wave-design] state=<ready-for-implementation|needs-clarification|blocked> ...`

If the wave explicitly assigns non-packet ownership to a design agent, that agent becomes a hybrid design steward.

The runtime treats that as:

1. a design pass first
2. then the same agent rejoins implementation with normal proof obligations

For a hybrid design steward, make sure the wave still includes:

- a design packet path
- any explicit implementation-owned paths
- `### Exit contract` when your lane validation requires it
- `### Components` when your lane validation requires them
- `### Proof artifacts` when the owned slice is proof-centric

The second pass must still re-emit `[wave-design]`, and it must also satisfy the normal implementation proof, doc-delta, and component-marker contract.

The interactive `wave draft` flow supports `design` as a worker role and scaffolds the docs-first default path. If you want a hybrid design steward today, the safest authoring paths are manual edits or an agentic planner payload that already declares the design agent's explicit implementation ownership.

## Version-Specific Upgrade Guidance

## Upgrading From `0.8.5` To `0.8.6`

This is the smallest upgrade, but it changes the live wait-loop contract for external automation and intentionally long-running agents.

### What changed

- versioned signal snapshots are now published under `.tmp/<lane>-wave-launcher/signals/`
- starter repos now include `skills/signal-hygiene/`, `scripts/wave-status.sh`, and `scripts/wave-watch.sh`
- the runtime injects signal-state plus signal-ack paths into long-running agent and resident-orchestrator prompts
- `completed` and `failed` now override stale feedback or coordination wakeups in agent signal state
- wrapper scripts now treat `failed` as terminal with exit `40`

### Required repo changes

Usually none if the repo did not copy starter scripts, operator docs, or skill bundles.

### Strongly recommended sync

If the repo copied starter surface, sync:

- `skills/signal-hygiene/`
- `scripts/wave-status.sh`
- `scripts/wave-watch.sh`
- `docs/guides/signal-wrappers.md`
- `docs/guides/terminal-surfaces.md`
- `docs/reference/cli-reference.md`
- `docs/reference/skills.md`
- `docs/plans/current-state.md`
- `docs/plans/end-state-architecture.md`
- `docs/plans/wave-orchestrator.md`

### Validation focus

- confirm any existing shell automation treats wrapper exit `40` as terminal failure
- if the repo uses long-running watchers, confirm they can write the ack file where the prompt tells them to
- reroute one targeted feedback or coordination request and confirm the resident signal version changes even when the signal kind stays the same

## Upgrading From `0.8.4` To `0.8.6`

### What changed

- `0.8.5` added the optional `design` worker role plus the `role-design` and `tui-design` starter bundles
- design stewards can now be docs-first or explicit hybrid design stewards
- `0.8.6` adds signal-driven waiting, `signal-hygiene`, and the seeded wrapper scripts

### Required repo changes

None if your repo does not use design stewards, long-running watcher agents, or copied starter scripts.

### Strongly recommended sync

If your repo copied starter prompts, skills, or authoring docs, sync:

- `docs/agents/wave-design-role.md`
- `skills/role-design/`
- `skills/tui-design/`
- `skills/signal-hygiene/`
- `scripts/wave-status.sh`
- `scripts/wave-watch.sh`
- `docs/guides/author-and-run-waves.md`
- `docs/guides/signal-wrappers.md`
- `docs/guides/planner.md`
- `docs/reference/skills.md`
- `docs/reference/sample-waves.md`

If your repo copied starter config defaults, also sync the `designRolePromptPath`, `skills.byRole.design`, and `design-pass` profile entries.

### Validation focus

- the design packet path resolves inside the repo
- design runs before implementation
- implementation does not start until every design packet is `ready-for-implementation`
- hybrid design stewards rejoin implementation when they explicitly own code
- long-running prompts receive signal-state and ack paths when the repo uses the new waiting model

## Upgrading From `0.8.3` To `0.8.6`

This is the most common one-step package upgrade path.

### What changed across that range

- `0.8.4` tightened contradiction replay, component-promotion threshold handling, and projection persistence boundaries
- `0.8.5` ships the `design` worker role, the `role-design` and `tui-design` starter bundles, and the hybrid design-steward runtime model as part of the published package
- `0.8.6` adds versioned signal snapshots, `signal-hygiene`, prompt-injected signal ack loops, and the seeded operator wrappers
- current operator and planner docs now describe the shipped surface directly instead of splitting behavior between a published package and newer `main`-only additions

### Required repo changes

Usually none if the repo does not copy starter prompts, skills, planning docs, or wrapper scripts.

### Strongly recommended sync

If the repo copied starter surface, sync:

- `docs/agents/wave-design-role.md`
- `skills/role-design/`
- `skills/tui-design/`
- `skills/signal-hygiene/`
- `scripts/wave-status.sh`
- `scripts/wave-watch.sh`
- `docs/guides/author-and-run-waves.md`
- `docs/guides/signal-wrappers.md`
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
- if the repo uses long-running agents or shell automation, confirm the new wrapper exit contract and ack-loop semantics before relying on an older polling script

## Upgrading From `0.8.3` To `0.9.0`

Treat this as one move to the current `0.9.0` surface.

### What changed across that range

- completed-wave control projections hardened
- human-input reconciliation and continuation repair landed
- contradiction replay and component-threshold handling were tightened
- projection persistence centralized under `projection-writer.mjs`
- the design-role surface is now shipped instead of living only on source `main`
- versioned signal snapshots, wrapper scripts, and long-running signal ack loops are now part of the shipped operator surface

### Required repo changes

Usually none for core config shape.

### Strongly recommended sync

If your repo copied starter docs or skills, sync:

- current operator runbook and architecture docs
- planner starter corpus
- design-role starter prompt and skill bundles
- signal-wrapper starter scripts and docs
- any repo-local docs that still describe design as “main only” or “future”

### Validation focus

- check that completed waves do not show stale blockers through `wave control status`
- answer at least one human-feedback ticket in a test lane and confirm the linked clarification or escalation chain closes cleanly
- replay one contradiction-blocked trace if your repo relies on replay regression coverage
- dry-run one design-steward wave if the repo wants the new authored surface
- if the repo uses long-running watcher agents or shell automation, validate `scripts/wave-status.sh` and `scripts/wave-watch.sh` against a live or staged lane

## Upgrading From `0.6.x` Or `0.7.x` To `0.9.0`

This is the main migration path for older adopted repos.

### Behavioral changes you must account for

- `wave control` is the preferred operator surface for status, rerun, proof, and telemetry work
- `cont-QA` and optional `cont-EVAL` are distinct closure roles
- planner starter files are now treated as required repo-owned surface when the repo uses planner workflows
- live closure depends on validated result envelopes plus canonical state
- control-plane state, reducer state, and replay are first-class runtime surfaces
- optional design stewards are now a supported authored shape
- signal-driven long-running watchers are now a supported operator shape

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
7. If the repo wants signal-driven long-running watchers or shell automation, sync `skills/signal-hygiene/`, `scripts/wave-status.sh`, `scripts/wave-watch.sh`, and the wrapper docs before relying on local polling scripts.

### Additional validation

Run the default validation set, then also check:

```bash
pnpm exec wave control status --lane main --wave 0 --json
pnpm exec wave control rerun get --lane main --wave 0 --json
pnpm exec wave control proof get --lane main --wave 0 --json
```

If the repo carries proof-first waves, verify that required proof artifacts still exist locally and not only in historical summaries.

## Upgrading From `0.5.x` Or Earlier To `0.9.0`

Do not treat this as a tiny patch bump.

### Recommended approach

1. Read [docs/reference/migration-0.2-to-0.5.md](../reference/migration-0.2-to-0.5.md) first if the repo still looks pre-`0.5`.
2. Run `pnpm exec wave init --adopt-existing` on a branch so the workspace records install state without overwriting repo-owned material.
3. Move the repo onto the `0.6.x` and later surface using the section above.
4. Sync the planner corpus and, if needed, the design starter surface plus the signal-wrapper starter surface.
5. Re-run the full validation checklist before any live executor run.

### Why

Older repos often differ in:

- role naming
- closure ordering
- runtime config keys
- planner starter corpus
- proof and retry operator surfaces
- wrapper and signal-monitoring expectations
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
- `docs/guides/signal-wrappers.md`
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
scripts/wave-status.sh --lane main --wave 0
scripts/wave-watch.sh --lane main --wave 0 --until-change --refresh-ms 500
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
- confirm whether the blocker is canonical coordination, dependency, proof, human-input, design-gate, or signal-ready state
- do not trust generated markdown alone

### External automation hangs after the upgrade

- confirm your wrapper loop treats exit `40` as terminal failure
- confirm `wave-watch.sh --until-change` expects exit `30` only for non-terminal signal changes
- if a long-running agent never wakes, inspect its ack file under `.tmp/<lane>-wave-launcher/signals/wave-<n>/acks/`

### Replay differs from old expectations

- verify whether the trace declares promoted components
- compare `storedOutcome.gateSnapshot` against recomputed replay output before changing live policy
- if the repo copied local replay docs, update them to the current reducer, envelope, and signal model

## Summary

The current `0.9.0` surface keeps the same authority-set and phase-engine architecture, ships both the design-role starter surface and the signal-driven long-running-agent starter surface, keeps the `0.8.7` policy and routing hardening, and now also packages the practical operator recommendations guide inside the release line. For most repos already on `0.8.x`, the upgrade is package bump plus validation. For older adopted repos, the real work is syncing repo-owned prompts, skills, planner corpus, wrapper scripts, and runbooks so they describe the runtime the package now ships.
