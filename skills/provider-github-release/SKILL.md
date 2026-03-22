# GitHub Release

<!-- CUSTOMIZE: Add your tag naming convention, required assets, release note template, and dependent deploys below. -->

## Core Rules

- Keep tag names, release IDs, asset names, and notes exact.
- Distinguish draft, prerelease, and published release state explicitly.
- Treat release notes, attached artifacts, and publication state as separate proof surfaces.
- If publication depends on another deploy system, keep that dependency explicit.
- Do not claim "released" until the release is published (not draft), all required assets are uploaded, and dependent deploys are confirmed.

## Release State Model

GitHub releases have three distinct states. Each is a separate proof surface:

### Draft

- Not visible to the public.
- Editable: notes, assets, tag, and title can all be modified.
- Use drafts for staging releases before all verification is complete.
- A draft release is NOT a published release. Do not emit success markers for draft state.

### Prerelease

- Visible to the public but flagged as prerelease.
- Appears in the releases list with a "Pre-release" badge.
- Use for release candidates, beta builds, or staged rollouts.
- A prerelease is public but carries an explicit "not stable" signal.

### Published

- Full release, visible to all users.
- Appears as the "Latest release" if it has the highest semver tag (unless another release is pinned).
- This is the only state that satisfies "release complete" in exit contracts.

When reporting release state, name which of the three states the release is in. Do not use ambiguous terms like "created" or "exists."

## Verification Procedures

### Release Status

```
gh release view <tag> --repo <owner/repo>
gh release view <tag> --repo <owner/repo> --json tagName,isDraft,isPrerelease,publishedAt,name
```

Confirm: release exists, state matches expectations (draft/prerelease/published), tag is correct, title and body are present.

### Tag Existence

```
git tag -l <tag>
gh api repos/<owner>/<repo>/git/refs/tags/<tag>
```

Confirm: tag exists in the repository, points to the correct commit. If the tag does not exist, the release cannot be finalized.

### Asset Listing

```
gh release view <tag> --repo <owner/repo> --json assets
```

Confirm: all required assets are listed, each asset has size > 0, names match expected conventions. If checksums are required, verify checksum files are present.

### Release Notes Content

```
gh release view <tag> --repo <owner/repo> --json body
```

Confirm: release notes contain required sections (changelog, breaking changes, migration notes as applicable), no placeholder text remains, links are valid.

<!-- CUSTOMIZE: Add your project-specific verification commands or asset naming conventions here. -->

## Asset Management

Verify each asset individually:

1. **Presence** -- the asset appears in the asset list with the expected name.
2. **Size** -- the asset size is greater than zero. A zero-byte asset indicates an upload failure.
3. **Checksum** -- if the project requires checksums (SHA256, MD5), verify the checksum file is present and its content matches the corresponding asset.
4. **Content type** -- if specific MIME types are expected, verify them.

Do not claim the release is complete until all required assets are uploaded and verified. If any asset is missing or zero-byte, the release is incomplete.

Upload assets using:

```
gh release upload <tag> <file> --repo <owner/repo>
```

## Cross-System Dependencies

Releases often depend on other systems being in a verified state before publication:

- **Deployment dependency** -- if the release depends on a successful deploy (e.g., Railway, AWS, npm), verify the deploy is healthy before publishing the release.
- **Registry dependency** -- if the release includes a package published to npm, PyPI, or another registry, verify the package is available in the registry before publishing the GitHub release.
- **CI dependency** -- if the release requires CI checks to pass on the release commit, verify all required checks are green.

Keep each dependency explicit:

```
Dependency: <system> must be <state> before release can be published.
Status: <verified|pending|failed>
Evidence: <how-verified>
```

Do not publish a release with unverified dependencies. Record the unverified dependency as a blocker.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Tag naming convention: v<major>.<minor>.<patch>, v<major>.<minor>.<patch>-rc.<n>
  - Required assets: <comma-separated-list-of-filenames>
  - Checksum requirements: SHA256, MD5, none
  - Release note template sections: Changelog, Breaking Changes, Migration Guide
  - Dependent deploys: <system> -> <verification-command>
  - Auto-publish conditions: all CI checks green + all assets uploaded
-->
