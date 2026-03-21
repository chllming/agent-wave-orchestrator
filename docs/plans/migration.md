# Migration

## Default Adoption Path

1. Copy or install the orchestrator into the target repository.
2. Edit `wave.config.json` for the repo's docs, roles, and validation rules.
3. Replace starter plan docs, sample waves, and the component cutover matrix with repository-specific ones.
4. Configure Context7 bundles for the external libraries that repo actually uses.
5. Run `pnpm wave:launch -- --lane main --dry-run --no-dashboard` until validation passes.
