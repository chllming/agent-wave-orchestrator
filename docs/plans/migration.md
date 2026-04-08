# Migration

This page is the practical repo-upgrade guide for the current `0.9.12` surface.

Use it when you are:

- adopting Wave in a repo that already has local prompts, docs, or skills
- upgrading from an older package release
- deciding which files to sync from the starter surface and which files to leave repo-owned

For the completed internal architecture cutover record, see [architecture-hardening-migration.md](./architecture-hardening-migration.md). That document is historical. This one is the operator-facing upgrade checklist.

For the sandbox-specific long-running execution target, including async `submit/status/wait` semantics and daemon ownership goals, see [sandbox-end-state-architecture.md](./sandbox-end-state-architecture.md).


## What `0.9.12` Changes

The `0.9.12` surface keeps the existing proof-first runtime and adds one focused closure fix plus a broad operator-surface cleanup.

- **Hybrid closure fast path**: bootstrap closure still supports low-entropy waves, but a wave no longer skips missing `cont-QA` once semantic closure stewards already ran.
- **Closure policy wiring**: `closureModeThresholds.bootstrap` now actually affects runtime mode resolution, and derived closure-complexity metadata now includes the real barrier set.
- **Optional TMUX language**: setup prompts, launcher help, docs, and canned commands now all describe TMUX as an optional dashboard/projection layer instead of a required execution backend.
- **Wave Control operator UI**: the browser surface is now dashboard-first and exposes richer run, benchmark, and access summaries.

There are no breaking changes. Existing repos can upgrade in place with `pnpm up @chllming/wave-orchestration` and `pnpm exec wave upgrade`.

For the practical `0.9.12` operating stance after the upgrade, read [../guides/recommendations-0.9.12.md](../guides/recommendations-0.9.12.md).

## What `0.9.4` Changes

The current `0.9.12` surface keeps everything from `0.9.2` and adds two focused improvements with no breaking changes.

The practical changes are:

- `WAVE_GATE_REGEX` now accepts `gap` alongside `pass|concerns|blocked` for all five gate dimensions (architecture, integration, durability, live, docs), so agents that report a documented gap no longer have their marker rejected entirely
- `validateContQaSummary` treats `gap` dimension values as a conditional pass (`ok: true`, `statusCode: conditional-pass`) instead of a hard blocker
- the cont-QA coordination prompt now documents `gap` as a valid dimension value
- first-time `wave launch` now auto-triggers `wave project setup` when no project profile exists, matching existing `wave draft` behavior
- `wave project setup` now shows descriptive help text before each prompt, explains all template and posture options inline, and adds whitespace between question groups for readability
- `PromptSession` gains a `describe(text)` method for writing contextual help to stderr during interactive setup flows
- `parseArgs` now passes the loaded config object through to `runLauncherCli`, avoiding a redundant `loadWaveConfig()` call

There are no breaking changes. Just upgrade with `pnpm up @chllming/wave-orchestration` and run `pnpm exec wave upgrade`.

If your repo uses wave-gate markers, you can now use `gap` for dimensions where the gap is documented and not an actionable blocker.

For the practical `0.9.12` operating stance after the upgrade, read [../guides/recommendations-0.9.12.md](../guides/recommendations-0.9.12.md).

## What `0.9.2` Changes

The `0.9.2` release established the packaged operator-guidance alignment, monorepo project support, and project-aware default telemetry from `0.9.0`, then added a more sandbox-friendly execution model and lower-overhead live orchestration.

The practical changes are:

- live agent execution now uses detached process runners instead of per-agent tmux execution sessions, which reduces tmux churn and lowers memory pressure during broader fan-out
- `wave submit`, `wave supervise`, `wave status`, `wave wait`, and `wave attach` are now the preferred path for short-lived clients and sandbox automation
- supervisor recovery now reconciles launcher status and progress more conservatively, preserves the correct remaining wave range during multi-wave reruns, and keeps read-side status/wait calls aligned even after daemon loss
- the packaged docs now cover the actual shipped owned-deployment Wave Control surface: Stack-authenticated browser access, Wave-managed approval states and provider grants, PATs, service tokens, encrypted per-user credentials, runtime env leasing, and the separate `services/wave-control-web` frontend
- Corridor is now documented as a first-class security input, including direct versus broker versus hybrid mode, implementation-owned path matching, generated artifact paths, and the closure-gate interaction with the human security reviewer
- a dedicated setup guide now ships for LEAPclaw, OpenClaw, Nemoshell, Docker, and similar constrained environments
- the `0.9.0` monorepo and project-aware state layout remains part of the release surface, including `defaultProject`, `projects.<projectId>`, project-scoped state roots, and project-aware CLI routing
- the current release surface and tracked install-state fixtures now move together on the active package version

If your repo copied starter docs, shell automation, runbooks, or `wave.config.json` defaults, these are the areas most likely to need a sync before the current package cut.

For a practical `0.9.12` operating stance after the upgrade, read [../guides/recommendations-0.9.12.md](../guides/recommendations-0.9.12.md).
For the concrete operator setup in Nemoshell, Docker, and other sandboxed shells, also read [../guides/sandboxed-environments.md](../guides/sandboxed-environments.md).

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

The most common sync set for the current release line is:

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
- `docs/guides/sandboxed-environments.md`
- `docs/guides/planner.md`
- `docs/guides/terminal-surfaces.md`
- `docs/guides/signal-wrappers.md`
- `docs/context7/planner-agent/`
- `docs/reference/wave-planning-lessons.md`
- `docs/reference/cli-reference.md`
- `docs/reference/corridor.md`
- `docs/reference/skills.md`
- `docs/reference/sample-waves.md`
- `docs/reference/wave-control.md`
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

## `0.9.12` Release Model

The current `0.9.12` surface combines these strands:

- the gap-value wave-gate fix and first-time setup UX improvements released in `0.9.4`
- the detached process-runner and sandbox supervisor hardening released in `0.9.2`
- the shipped `0.9.0` monorepo project support and project-aware runtime isolation
- the shipped `design` worker role and hybrid design-steward flow introduced in `0.8.5`
- the signal-driven long-running-agent and wrapper model introduced in `0.8.6`
- the policy-consistency, targeted-recovery, capability-specific routing, and stable per-wave session reuse hardening introduced in `0.8.7`
- the current owned-deployment Wave Control surface: Stack-authenticated app access, provider grants, PATs, service tokens, encrypted per-user credentials, and runtime credential leasing
- the Corridor-backed security surface: direct or brokered provider fetches, normalized per-wave artifacts, and closure gating before integration
- the packaged recommendations guide, sandbox setup guide, and release-surface alignment follow-up that make the current docs describe that combined surface consistently

### Sandbox-safe execution and lower-overhead live runs

This remains the main execution-model shift introduced in `0.9.2`.

The runtime now:

- launches live agents through detached process runners instead of per-agent tmux sessions
- treats tmux as dashboard-only and optional
- keeps `wave attach --agent` usable through log-follow attach even when no live interactive terminal session exists
- uses `wave submit/supervise/status/wait/attach` as the preferred sandbox-safe surface for short-lived clients

If your repo copied sandbox, CI, or container runbooks, this is the main sync set to apply from that `0.9.2` execution-model cut:

- `README.md`
- `docs/README.md`
- `docs/guides/sandboxed-environments.md`
- `docs/guides/terminal-surfaces.md`
- `docs/reference/cli-reference.md`
- `docs/plans/sandbox-end-state-architecture.md`

### Authenticated Wave Control and Corridor-backed security

That same `0.9.2` doc surface also describes the current control-plane and security model as shipped:

- owned Wave Control deployments use Stack for browser sign-in, then apply Wave-managed approval states and provider grants on top of that identity
- approved users and superusers can issue PATs for scoped repo-runtime access, while dedicated service tokens keep machine-admin workflows separate from user-owned runtime credentials
- arbitrary stored credentials are encrypted at rest and only returned through explicit runtime lease responses
- `externalProviders.corridor` can run direct, brokered through an owned Wave Control deployment, or hybrid; the result is persisted as a normalized security artifact and can block closure before integration

If your repo copied release docs, security runbooks, or Wave Control setup docs, this is the main sync set to apply from that `0.9.2` security-surface cut:

- `README.md`
- `docs/README.md`
- `docs/reference/runtime-config/README.md`
- `docs/reference/coordination-and-closure.md`
- `docs/reference/corridor.md`
- `docs/reference/wave-control.md`

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

## Upgrading From `0.8.5` To `0.9.12`

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

## Upgrading From `0.8.4` To `0.9.12`

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

## Upgrading From `0.9.9` To `0.9.12`

Run-state history is now capped at 200 entries (20 per wave). Existing bloated run-state files will be automatically pruned on the next write. No config changes needed.

## Upgrading From `0.9.8` To `0.9.9`

Helper assignment barriers are now advisory in bootstrap gate mode. No config changes needed.

## Upgrading From `0.8.3` To `0.9.12`

Treat this as one move to the current `0.9.12` surface.

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

## Upgrading From `0.6.x` Or `0.7.x` To `0.9.12`

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

## Upgrading From `0.5.x` Or Earlier To `0.9.12`

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

The current `0.9.12` surface keeps the same authority-set and phase-engine architecture, ships both the design-role starter surface and the signal-driven long-running-agent starter surface, keeps the `0.8.7` policy and routing hardening, adds the hybrid closure fast-path fixes, and now packages the practical operator recommendations guide inside the release line. For most repos already on `0.8.x`, the upgrade is package bump plus validation. For older adopted repos, the real work is syncing repo-owned prompts, skills, planner corpus, wrapper scripts, and runbooks so they describe the runtime the package now ships.
