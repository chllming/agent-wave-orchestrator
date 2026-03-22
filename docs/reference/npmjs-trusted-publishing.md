# npmjs Publishing

This repo now includes a dedicated npmjs publish workflow at [publish-npm.yml](../../.github/workflows/publish-npm.yml).

It currently publishes through a repository Actions secret named `NPM_TOKEN`.

## What This Repo Already Does

- `package.json` no longer hardcodes GitHub Packages as the publish registry.
- `publish-npm.yml` publishes tagged releases to `https://registry.npmjs.org`.
- `publish-package.yml` still publishes to GitHub Packages explicitly, so both registries can coexist.
- `publish-npm.yml` expects `NPM_TOKEN` in GitHub Actions secrets.

## One-Time npm Setup

1. Create an npm granular access token with:
   - package or scope access for `@chllming/wave-orchestration`
   - `Read and write` permission
   - `Bypass 2FA` enabled
2. In the GitHub repo `chllming/wave-orchestration`, add that token as an Actions secret named `NPM_TOKEN`.
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

## First Release Checklist

1. Confirm [publish-npm.yml](../../.github/workflows/publish-npm.yml) is on the default branch.
2. Confirm `NPM_TOKEN` exists in the GitHub repo secrets.
3. Confirm the package version has been bumped and committed.
4. Push the release tag, for example `v0.4.1`.
5. Verify the GitHub Actions run publishes successfully to npmjs.
6. After the publish is visible on npmjs, update README install guidance if npmjs should become the primary documented install path.
