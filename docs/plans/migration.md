# Migration

For the staged internal cutover from the legacy launcher-centric runtime to the authority-set / reducer / phase-engine architecture, see [architecture-hardening-migration.md](./architecture-hardening-migration.md). This page stays focused on package adoption and upgrade steps for repo operators.

## Default Adoption Path

1. Install the package from npmjs with `pnpm add -D @chllming/wave-orchestration`.
2. For a fresh repo, run `pnpm exec wave init`.
3. For a repo that already has Wave config, docs, or waves you want to preserve, run `pnpm exec wave init --adopt-existing`.
4. Edit `wave.config.json` for the repo's docs, roles, validation rules, executor defaults, skill attachment policy, and component-cutover matrix paths.
5. Replace the starter plan docs, sample waves, starter `skills/` bundles, and component cutover matrix with repository-specific ones.
6. Configure Context7 bundles for the external libraries that repo actually uses.
7. Run `pnpm exec wave doctor` and `pnpm exec wave launch --lane main --dry-run --no-dashboard` until validation passes.
8. Inspect seeded coordination and inbox artifacts with `pnpm exec wave coord show --lane main --wave 0 --dry-run --json` and `pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run`.
9. Upgrade later with `pnpm up @chllming/wave-orchestration` and `pnpm exec wave upgrade`.

GitHub Packages remains available as an authenticated fallback path, and maintainer npm publishing setup is documented in [npmjs-trusted-publishing.md](../reference/npmjs-trusted-publishing.md).

## Upgrade Contract

- Package upgrades change the runtime behavior in `node_modules`; they do not copy a new starter scaffold into the repo.
- `wave upgrade` writes `.wave/install-state.json` and `.wave/upgrade-history/*` only.
- Existing `wave.config.json`, role prompts, plan docs, `skills/` bundles, Context7 bundles, and wave files are never overwritten by the upgrade flow.
- Fresh `wave init` seeds the starter `skills/` library. `wave init --adopt-existing` records existing repo-owned skill bundles when they are already present, but does not replace or rewrite them.
- The current runtime expects the post-roadmap model: typed coordination, compiled inboxes, `A8` integration, staged closure, orchestrator-first clarification, and operational runtime policy.

## Upgrading From 0.6.x To 0.8.3

Read `CHANGELOG.md` first, then treat this section as the repo-owned migration checklist for adopted `0.6.x` workspaces.

`wave upgrade` updates the installed runtime only. It does not copy planner starter files into a repo that already owns its docs, skills, and Context7 bundles.

`0.8.3` carries forward the `0.8.2` completed-wave control-status hardening and fixes the human-answer reconciliation path: answered feedback now closes the linked clarification or escalation chain in canonical coordination, re-syncs helper-assignment projections, and preserves ad-hoc `--run <id>` context when writing safe continuation intent.

### Required Repo Changes

If the repo adopted Wave before the planner corpus became a tracked required surface, sync:

- `docs/agents/wave-planner-role.md`
- `skills/role-planner/`
- `docs/context7/planner-agent/`
- `docs/reference/wave-planning-lessons.md`
- the `planner-agentic` bundle entry in `docs/context7/bundles.json`

If the repo copied the shipped starter architecture docs or skills and wants the `0.8.3` authority-model language, also sync:

- `docs/agents/wave-launcher-role.md`
- `docs/agents/wave-orchestrator-role.md`
- `skills/wave-core/`
- the relevant runtime and closure-role starter skills under `skills/`
- `docs/plans/architecture-hardening-migration.md`

### Recommended Upgrade Validation

After syncing those repo-owned files:

1. Run `pnpm exec wave doctor`.
2. Run `pnpm exec wave launch --lane main --dry-run --no-dashboard`.
3. Use `pnpm exec wave dashboard --lane <lane> --attach current` or `--attach global` when you need to reattach to a live tmux-backed dashboard without reverse-engineering the socket or session name.
4. If your operators answer human-input tickets through `wave feedback respond`, update any repo-local runbooks so ad-hoc runs always pass `--run <id>` when responding outside the main roadmap lane.

## Upgrading From 0.5.4 To 0.6.1

Read `CHANGELOG.md` first, then treat the rest of this page as the manual repo-owned migration checklist for the `0.6.1` release. `wave upgrade` will update package-owned runtime code only; it will not rewrite the docs, prompts, config, or wave files that your repo already owns.

### Required Repo Changes

1. Rename legacy `evaluator` config and prompt terminology to `cont-QA`.
2. Keep `A0` as the final closure owner that emits both the final verdict and `[wave-gate]`.
3. Add `E0` only when the wave needs benchmark-driven tuning or service-output evaluation.
4. Add wave-level `## Eval targets` whenever `cont-EVAL` is present.
5. Update any starter docs or examples that still describe the pre-`0.6.1` evaluator model.

In practice that means checking:

- `wave.config.json`
  Remove or rename `roles.evaluator*`, `skills.byRole.evaluator`, and `runtimePolicy.defaultExecutorByRole.evaluator`.
- `docs/agents/*.md`
  Rename or replace any legacy evaluator prompt files so the repo clearly distinguishes `cont-QA`, `cont-EVAL`, and optional security review.
- `docs/plans/waves/*.md`
  Update wave agent headings, role prompts, and closure expectations to use `A0` for `cont-QA`, optional `E0` for eval tuning, and optional security review before integration.
- `docs/reference/` and other operator docs
  Refresh any examples or internal runbooks that still describe one overloaded evaluator role.

### Closure And Marker Changes

Live `0.6.1` closure is stricter than `0.5.4`.

- `cont-EVAL` must leave a report plus a final `[wave-eval]` marker whose `target_ids` exactly matches the wave contract and whose `benchmark_ids` stays within the benchmark catalog.
- Security review, when present, must leave a report plus a final `[wave-security]` marker.
- `cont-QA` must leave both the final `Verdict:` line and the final `[wave-gate]` marker.
- Older evaluator-era or verdict-only artifacts remain replay-readable, but they do not satisfy live completion anymore.

### Recommended Upgrade Validation

After updating repo-owned files:

1. Run `pnpm exec wave doctor`.
2. Run `pnpm exec wave launch --lane main --dry-run --no-dashboard`.
3. Use `pnpm exec wave coord show --lane main --wave 0 --dry-run --json` as a read-only inspection path for the coordination state.
4. Use `pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run` when you want the launcher to materialize shared-summary and inbox artifacts for review.
5. If the repo adopts `cont-EVAL`, verify that every live eval wave declares `## Eval targets` and that the benchmark ids exist in `docs/evals/benchmark-catalog.json`.
