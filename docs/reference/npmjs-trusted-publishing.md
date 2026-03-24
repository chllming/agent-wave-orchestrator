# npmjs Publishing

This repo now includes a dedicated npmjs publish workflow at [publish-npm.yml](../../.github/workflows/publish-npm.yml).

The current `0.8.3` release procedure publishes through a repository Actions secret named `NPM_TOKEN`.

## What This Repo Already Does

- `package.json` no longer hardcodes GitHub Packages as the publish registry.
- `publish-npm.yml` publishes tagged releases to `https://registry.npmjs.org`.
- `publish-package.yml` still publishes to GitHub Packages explicitly, so both registries can coexist.
- `publish-npm.yml` expects `NPM_TOKEN` in GitHub Actions secrets.
- The public install path is already npmjs; GitHub Packages remains the authenticated fallback path.

## One-Time npm Setup

1. Create an npm granular access token with:
   - package or scope access for `@chllming/wave-orchestration`
   - `Read and write` permission
   - `Bypass 2FA` enabled
2. In the GitHub repo `chllming/agent-wave-orchestrator`, add that token as an Actions secret named `NPM_TOKEN`.
3. Rotate or revoke the token when no longer needed.

## GitHub Workflow Behavior

The npmjs workflow:

- runs on GitHub-hosted runners
- requires `contents: read`
- installs dependencies with `pnpm install --frozen-lockfile`
- runs `pnpm test`
- publishes with `pnpm publish --access public --no-git-checks`
- authenticates with `NODE_AUTH_TOKEN=${{ secrets.NPM_TOKEN }}`

## Security Follow-Up

After a successful npm publish:

1. Keep the token scoped only to this package or scope.
2. Rotate the token periodically.
3. Revoke emergency or temporary tokens once they are no longer needed.

If this repo later needs private npm dependencies during CI, consider a separate read-only install token rather than reusing the publish token.

## Release Checklist

1. Confirm [publish-npm.yml](../../.github/workflows/publish-npm.yml) is on the default branch.
2. Confirm `NPM_TOKEN` exists in the GitHub repo secrets.
3. Confirm the package version has been bumped and committed.
4. Push the release commit and release tag, for example `v0.8.3`.
5. Verify both `publish-npm.yml` and `publish-package.yml` start from the tag push.
6. Verify the npmjs publish completes successfully for the tagged source.
