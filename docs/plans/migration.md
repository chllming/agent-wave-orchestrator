# Migration

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
