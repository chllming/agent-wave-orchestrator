# Migration

## Default Adoption Path

1. Configure GitHub Packages auth as described in [github-packages-setup.md](/home/coder/wave-orchestration/docs/reference/github-packages-setup.md).
2. Install the package with `pnpm add -D @chllming/wave-orchestration`.
3. For a fresh repo, run `pnpm exec wave init`.
4. For a repo that already has Wave config, docs, or waves you want to preserve, run `pnpm exec wave init --adopt-existing`.
5. Edit `wave.config.json` for the repo's docs, roles, validation rules, executor defaults, and component-cutover matrix paths.
6. Replace the starter plan docs, sample waves, and component cutover matrix with repository-specific ones.
7. Configure Context7 bundles for the external libraries that repo actually uses.
8. Run `pnpm exec wave doctor` and `pnpm exec wave launch --lane main --dry-run --no-dashboard` until validation passes.
9. Inspect seeded coordination and inbox artifacts with `pnpm exec wave coord show --lane main --wave 0 --dry-run --json` and `pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run`.
10. Upgrade later with `pnpm up @chllming/wave-orchestration` and `pnpm exec wave upgrade`.

## Upgrade Contract

- Package upgrades change the runtime behavior in `node_modules`; they do not copy a new starter scaffold into the repo.
- `wave upgrade` writes `.wave/install-state.json` and `.wave/upgrade-history/*` only.
- Existing `wave.config.json`, role prompts, plan docs, Context7 bundles, and wave files are never overwritten by the upgrade flow.
- The current runtime expects the post-roadmap model: typed coordination, compiled inboxes, `A8` integration, staged closure, orchestrator-first clarification, and operational runtime policy.
