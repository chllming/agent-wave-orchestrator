# Migration

This page is the operator-facing upgrade guide for adopting repos. It explains how to move from older Wave package versions onto the current `0.8.4` surface without guessing which files are package-owned, which files are repo-owned, and which validations to trust after the bump.

For the completed internal architecture cutover record, see [architecture-hardening-migration.md](./architecture-hardening-migration.md). That document is historical. This one is the practical repo-upgrade checklist.

## What `0.8.4` Changes

`0.8.4` is a hardening release, not a new authoring model.

- contradiction replay no longer depends on component-matrix parsing when the trace does not declare promoted components
- `requireComponentPromotionsFromWave` now disables both component-promotion proof blocking and component-matrix current-level blocking before the configured threshold
- `projection-writer.mjs` is now the single persistence layer for projection outputs, while `derived-state-engine.mjs` computes those payloads without persisting them directly
- starter docs, release notes, README, and publishing guidance now describe the shipped runtime instead of transitional architecture claims

There are no new CLI flags or wave-file section requirements in `0.8.4`.

## Upgrade Contract

- `pnpm up @chllming/wave-orchestration` updates the runtime in `node_modules`.
- `pnpm exec wave upgrade` writes `.wave/install-state.json` and `.wave/upgrade-history/*` only.
- `wave upgrade` does not rewrite repo-owned `wave.config.json`, `docs/agents/*`, `docs/plans/waves/*`, `skills/*`, `docs/context7/*`, or repo-specific reference docs.
- `.tmp/<lane>-wave-launcher/` is runtime state, not migration source of truth. Do not treat old generated artifacts as the thing to preserve.

## Default Adoption Path

Use this when the repo is not already running Wave or you are replacing a very old local starter copy.

1. Install the package from npmjs with `pnpm add -D @chllming/wave-orchestration`.
2. For a fresh repo, run `pnpm exec wave init`.
3. For a repo that already owns Wave config, docs, or waves, run `pnpm exec wave init --adopt-existing`.
4. Review `wave.config.json` for docs roots, roles, validation thresholds, executor defaults, skill attachments, Context7 bundles, and component-cutover matrix paths.
5. Replace starter sample plans, starter skills, and starter prompts with repo-owned versions where needed.
6. Run the validation checklist in this doc before the first live launcher run.

GitHub Packages remains an authenticated fallback install path, but npmjs is the default public distribution channel.

## Safe Upgrade Flow For Any Existing Repo

Use this flow before the version-specific sections below.

### 1. Upgrade When The Lane Is Idle

- Prefer upgrading between waves, not mid-attempt.
- If a lane still has running sessions, finish or intentionally stop that attempt before changing package versions.
- If a repo is stranded after a prior crash, inspect `wave control status` first, then decide whether to relaunch or reconcile on the upgraded package.

### 2. Bump The Package

```bash
pnpm up @chllming/wave-orchestration
pnpm exec wave upgrade
```

### 3. Sync Repo-Owned Starter Surface Only If You Copied It

If your repo copied package-owned starter docs, prompts, or skills instead of treating them as read-only package material, sync the copied files that you still want to match upstream.

The common sync set is:

- `docs/agents/wave-launcher-role.md`
- `docs/agents/wave-orchestrator-role.md`
- `docs/agents/wave-planner-role.md`
- `skills/wave-core/`
- `skills/role-planner/`
- runtime and closure-role starter skills under `skills/`
- `docs/context7/planner-agent/`
- `docs/reference/wave-planning-lessons.md`
- `docs/plans/current-state.md`
- `docs/plans/end-state-architecture.md`
- `docs/plans/wave-orchestrator.md`
- `docs/plans/migration.md`

If your repo never copied those starter files, do not invent migration work. The installed package already carries the new runtime behavior.

### 4. Re-validate Before A Live Run

Run these from the repo root:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
pnpm exec wave control status --lane main --wave 0 --json
pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run
```

Use `pnpm exec wave dashboard --lane <lane> --attach current` or `--attach global` when you need to reattach to an existing tmux-backed dashboard after the upgrade.

## Version-Specific Upgrade Guidance

## Upgrading From `0.8.3` To `0.8.4`

This is the smallest migration.

### What changed

- contradiction replay for non-promoted traces is now independent of component-matrix parsing
- component-promotion threshold handling is now consistent between proof validation and matrix-current-level validation
- projection output writes are centralized in `projection-writer.mjs`

### Required repo changes

None for wave shape, config keys, or CLI usage.

### Recommended checks

1. Re-run `pnpm exec wave doctor`.
2. Re-run `pnpm exec wave launch --lane main --dry-run --no-dashboard`.
3. If your repo copied starter architecture docs or starter skills, sync them so local runbooks stop describing the older split projection behavior.
4. If you keep historical trace fixtures, replay at least one contradiction-blocked trace and one promoted-component trace after the upgrade.

## Upgrading From `0.8.0`-`0.8.2` To `0.8.4`

Treat this as one upgrade to the current surface.

### What changed across that range

- completed-wave `wave control status` projection hardened in `0.8.2`
- human-input reconciliation and ad-hoc `--run <id>` context hardening landed in `0.8.3`
- contradiction replay, component-threshold consistency, and projection-writer centralization landed in `0.8.4`

### Required repo changes

Usually none for config shape.

### Strongly recommended sync

If your repo copied upstream starter docs or skills, sync:

- the current operator runbook and architecture docs
- the launcher and orchestrator role prompts
- the relevant runtime skills and closure-role starter skills

### Validation focus

- check that completed waves do not show stale blockers through `wave control status`
- answer at least one human-feedback ticket in a test lane and confirm the linked clarification or escalation chain closes cleanly
- replay one contradiction-blocked trace if your repo relies on trace-based regression checks

## Upgrading From `0.6.x` Or `0.7.x` To `0.8.4`

This is the main migration path for older adopted repos.

### Behavioral changes you must account for

- `wave control` is the preferred operator surface for status, rerun, proof, and telemetry work
- `cont-QA` and optional `cont-EVAL` remain distinct closure roles; older overloaded evaluator language should be removed
- planner corpus files are now treated as required starter surface for repos that use planner workflows
- live closure depends on validated result envelopes plus canonical state, not only older summary-era behavior
- control-plane state, reducer state, and replay are now first-class runtime surfaces, not optional internals

### Required repo changes

1. Remove or rename any legacy `evaluator` role/config terminology to `cont-QA`.
2. Keep `A0` as the final closure owner and add `E0` only when the wave needs eval-driven tuning.
3. Add wave-level `## Eval targets` whenever `cont-EVAL` is present.
4. Sync the planner starter corpus if the repo uses `wave project` or `wave draft`:
   - `docs/agents/wave-planner-role.md`
   - `skills/role-planner/`
   - `docs/context7/planner-agent/`
   - `docs/reference/wave-planning-lessons.md`
   - the `planner-agentic` entry in `docs/context7/bundles.json`
5. Review any repo-owned docs or internal runbooks that still describe one overloaded evaluator role, marker-era closure, or pre-control-plane retry/proof workflow.

### Additional validation

Run the default validation set, then also check:

```bash
pnpm exec wave control status --lane main --wave 0 --json
pnpm exec wave control rerun get --lane main --wave 0 --json
pnpm exec wave control proof get --lane main --wave 0 --json
```

If your repo carries proof-first waves, verify that required proof artifacts are still present locally and not only in historical summaries.

## Upgrading From `0.5.x` Or Earlier To `0.8.4`

Do not treat this as a tiny patch bump.

### Recommended approach

1. Read [docs/reference/migration-0.2-to-0.5.md](../reference/migration-0.2-to-0.5.md) first if the repo still looks pre-`0.5`.
2. Run `pnpm exec wave init --adopt-existing` on a branch so the workspace records install state without overwriting repo-owned material.
3. Move the repo onto the `0.6.x` and later surface using the section above.
4. Re-run the full validation checklist before any live executor run.

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

These are the highest-value files to check when a repo copied starter surface instead of reading from the package.

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

### Config and wave contracts

- `wave.config.json`
- `docs/plans/waves/*.md`
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

- check whether the repo is missing planner starter surface it previously copied
- check whether old `evaluator` naming is still present in config or prompts
- check whether wave files now declare closure roles or eval targets inconsistently with the current runtime

### A live lane looks blocked after the bump

- use `wave control status --lane <lane> --wave <n> --json`
- confirm whether the blocker is canonical coordination, dependency, proof, or human-input state
- do not trust old generated markdown alone

### Replay differs from old expectations

- verify whether the trace declares promoted components
- verify whether the repo relied on pre-`0.8.4` component-threshold behavior
- compare `storedOutcome.gateSnapshot` against recomputed replay output before changing live policy

## Summary

`0.8.4` does not introduce a new authoring model. It hardens replay, makes component-promotion thresholds behave consistently, and finishes the projection-writer ownership boundary. For most repos already on `0.8.x`, the upgrade is package bump plus validation. For older adopted repos, the real work is syncing repo-owned prompts, skills, and runbooks so they describe the runtime the package now ships.
