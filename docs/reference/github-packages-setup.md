# GitHub Packages Setup

Use this page only if you intentionally want the legacy GitHub Packages install path.

GitHub's npm registry still requires authentication for installs from `npm.pkg.github.com`, even when the package and backing repository are public.
This is now the optional authenticated fallback path. The primary public install path is npmjs. Maintainer npm publishing setup is documented in [npmjs-token-publishing.md](./npmjs-token-publishing.md).

## `.npmrc`

Add a repository-local or user-level `.npmrc` entry like this:

```ini
@chllming:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
always-auth=true
```

`GITHUB_TOKEN` should be a GitHub personal access token or an injected CI token with package read access.

## Install

```bash
pnpm add -D @chllming/wave-orchestration
```

Then initialize the workspace:

```bash
pnpm exec wave init
```

For repositories that already have Wave config, docs, or waves:

```bash
pnpm exec wave init --adopt-existing
```

Then verify the package and starter runtime against the target repo:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

## Upgrade

```bash
pnpm up @chllming/wave-orchestration
pnpm exec wave upgrade
```

The package upgrade changes the runtime version. `wave upgrade` writes the upgrade report and changelog files under `.wave/` without overwriting repo-owned plans, waves, or config.
