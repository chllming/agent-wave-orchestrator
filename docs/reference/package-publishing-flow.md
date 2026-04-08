# Package Publishing Flow

This document describes how this repo publishes `@chllming/wave-orchestration` end to end, including the scripts, workflows, release artifacts, and verification steps involved.

## Overview

The package publish flow has two layers:

1. repo-owned release preparation
2. tag-triggered registry publishing

Release preparation happens in the repository itself:

- bump `package.json`
- update release-surface docs and fixtures
- validate the repo
- merge the release changes to `main`
- push a version tag such as `v0.9.12`

Registry publishing happens in GitHub Actions after the tag push:

- [publish-npm.yml](../../.github/workflows/publish-npm.yml) publishes to npmjs
- [publish-package.yml](../../.github/workflows/publish-package.yml) publishes to GitHub Packages
- [npmjs-token-publishing.md](./npmjs-token-publishing.md) documents the npm token setup used by `publish-npm.yml`

Both workflows run on tag pushes matching `v*`, and each workflow now fails fast unless `github.ref_name` exactly matches `v${package.json.version}`.

## Release Artifacts That Move Together

These files are part of the release surface and should be updated in the same change when the package version changes:

- `package.json`
- `README.md`
- `CHANGELOG.md`
- `docs/README.md`
- `docs/plans/current-state.md`
- `docs/plans/migration.md`
- `docs/guides/sandboxed-environments.md`
- `docs/reference/coordination-and-closure.md`
- `docs/reference/runtime-config/README.md`
- `releases/manifest.json`
- `.wave/install-state.json`
- tracked `.wave/upgrade-history/*`
- versioned docs such as `docs/guides/recommendations-<version>.md`
- `AGENTS.md`

This repo treats those files as part of the package-facing release contract, not just internal documentation.

## Scripts And Commands Involved

### Main CLI entrypoint

- `scripts/wave.mjs`
  Routes install and lifecycle commands into `scripts/wave-orchestrator/install.mjs`.

The lifecycle commands relevant to publishing are:

- `wave doctor`
- `wave changelog`
- `wave upgrade`
- `wave self-update`

### Install and release-state module

- `scripts/wave-orchestrator/install.mjs`

This module owns the local package-lifecycle surfaces:

- `wave init`
  Seeds or adopts starter workspace files.
- `wave doctor`
  Validates that the current workspace matches the installed package expectations.
- `wave changelog`
  Reads `releases/manifest.json` and prints release notes.
- `wave upgrade`
  Writes `.wave/install-state.json` and a markdown/json report into `.wave/upgrade-history/`.
- `wave self-update`
  Updates the dependency in the target workspace, prints changelog deltas, and then runs `wave upgrade`.

### Release-validation commands

These are the normal validation commands before tagging:

```bash
pnpm test
pnpm test -- test/wave-orchestrator/release-surface.test.ts
node scripts/wave.mjs doctor --json
node scripts/wave.mjs launch --lane main --dry-run --no-dashboard
```

### Registry verification commands

After publish:

```bash
npm view @chllming/wave-orchestration version dist-tags --json
gh run list --limit 10
```

## End-to-End Flow

### 1. Prepare the release change

Update the release artifacts together, then validate locally.

Typical local flow:

```bash
pnpm test -- test/wave-orchestrator/release-surface.test.ts
node scripts/wave.mjs doctor --json
node scripts/wave.mjs launch --lane main --dry-run --no-dashboard
```

If the version changed, also refresh the tracked workspace lifecycle state:

```bash
pnpm exec wave upgrade
pnpm exec wave changelog --since-installed
```

In this source repo, `.wave/install-state.json` and tracked `.wave/upgrade-history/` records are intentionally part of the release surface.

### 2. Merge the release change to `main`

This repository normally protects `main`, so release changes should land through a pull request unless the repo policy has been intentionally relaxed for a one-off release cut.

Typical git flow:

```bash
git checkout -b release/0.9.12
git push -u origin release/0.9.12
gh pr create --base main --head release/0.9.12
gh pr merge <pr-number> --merge --delete-branch
```

### 3. Push the release tag

After the release commit is on `main`, push the version tag:

```bash
git tag v0.9.12
git push origin v0.9.12
```

That tag push is the event that starts both publishing workflows.

The tag must match the checked-in package version exactly. Example: if `package.json.version` is `0.9.12`, the pushed tag must be `v0.9.12`.

## GitHub Actions Workflows

### npmjs publish

- workflow: [publish-npm.yml](../../.github/workflows/publish-npm.yml)
- trigger: push tags matching `v*`
- runtime: Node 22
- auth secret: `NPM_TOKEN`
- publish command:

```bash
pnpm publish --access public --no-git-checks
```

The workflow does:

1. `actions/checkout`
2. `pnpm/action-setup`
3. `actions/setup-node` with `registry-url: https://registry.npmjs.org`
4. verify `github.ref_name === "v" + package.json.version`
5. `pnpm install --frozen-lockfile`
6. `pnpm test`
7. `pnpm publish --access public --no-git-checks`

### GitHub Packages publish

- workflow: [publish-package.yml](../../.github/workflows/publish-package.yml)
- trigger: push tags matching `v*`
- runtime: Node 22
- auth token: `GITHUB_TOKEN`
- publish command:

```bash
pnpm publish --registry=https://npm.pkg.github.com --no-git-checks
```

The workflow does:

1. `actions/checkout`
2. `pnpm/action-setup`
3. `actions/setup-node` with `registry-url: https://npm.pkg.github.com`
4. verify `github.ref_name === "v" + package.json.version`
5. `pnpm install --frozen-lockfile`
6. `pnpm test`
7. `pnpm publish --registry=https://npm.pkg.github.com --no-git-checks`

## Verification After Tag Push

Use GitHub Actions first:

```bash
gh run list --limit 10 --json workflowName,headBranch,headSha,status,conclusion,url
gh run watch <run-id> --exit-status
gh run view <run-id> --log-failed
```

Then verify the public registry:

```bash
npm view @chllming/wave-orchestration version dist-tags --json
```

Expected result after a successful publish:

```json
{
  "version": "0.9.12",
  "dist-tags": {
    "latest": "0.9.12"
  }
}
```

## Repair Flow When Publish Fails

If a tag-triggered publish fails before the package is actually published, the fastest repair path is:

1. fix the repo issue in a new commit
2. move the tag to the fixed commit
3. force-push the tag
4. watch the rerun

Example:

```bash
git tag -f v0.9.12 <fixed-commit>
git push origin refs/tags/v0.9.12 --force
```

Use that only before the package is live on npmjs. Once npmjs has accepted a version, do not try to republish the same version; cut a new version instead.

Common failure classes:

- release-surface drift
  A versioned doc or fixture did not move with `package.json`.
- workflow-environment drift
  The CI runtime differs from the runtime that was locally validated.
- missing secrets
  `NPM_TOKEN` is missing or invalid for npmjs.
- test assumptions on ignored files
  CI cannot see local-only workstation files such as `.vscode/terminals.json`.

## Security And Secrets

For npmjs publishing:

- keep `NPM_TOKEN` scoped as narrowly as possible
- use `Read and write` only for the target package or scope
- rotate the token periodically
- revoke temporary or emergency tokens after use

GitHub Packages publishing uses the workflow `GITHUB_TOKEN`, so it does not require a separate package-publish secret.

## What This Flow Does Not Do

There is no dedicated local `release` shell script in this repo that bumps versions, tags commits, and publishes in one command.

The flow today is intentionally split:

- repo release preparation is explicit and reviewable
- package lifecycle state is recorded by `wave upgrade`
- actual registry publishing is delegated to tag-triggered GitHub Actions

That split keeps release metadata, workspace upgrade history, and package publication visible and auditable.
