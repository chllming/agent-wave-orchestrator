# Changelog

## 0.5.2 - 2026-03-22

- Hardened structured closure marker parsing so fenced or prose example `[wave-*]` lines no longer satisfy implementation, integration, documentation, or evaluator gates.
- Hardened `### Deliverables` so declared outputs must remain repo-relative file paths inside the implementation agent's declared file ownership before the exit contract can pass.
- Added regression coverage for the fenced-marker false-positive path and for deliverables that escape ownership boundaries.

## 0.5.1 - 2026-03-22

- Fixed the Phase 4 autonomous finalization barrier so completed lanes still block on unresolved human feedback or escalation tickets from earlier waves.
- Fixed the launcher-generated trace tests to rewrite seeded agent executor blocks for local-only replay fixtures, preventing accidental live Codex, Claude Code, or OpenCode launches during hermetic trace coverage.
- Added a dedicated npmjs trusted-publishing workflow alongside the existing GitHub Packages workflow, and updated package metadata so `npm publish` targets can be selected by workflow instead of being hardwired in `package.json`.
- Added maintainer documentation for the npmjs bootstrap path and clarified that GitHub Packages remains the current authenticated install path until the first npmjs release is published.

## 0.5.0 - 2026-03-22

- Added Phase 4 runtime coordination: capability-targeted requests now become explicit helper assignments with deterministic assignee selection, assignment snapshots, ledger coverage, inbox visibility, and closure barriers.
- Added typed cross-lane dependency workflows with `wave dep post|show|resolve|render`, per-wave inbound/outbound dependency projections, dependency-aware gating, and replay-visible dependency state.
- Expanded hermetic trace and replay acceptance around the runtime-orchestration layer with stored outcome snapshots, launcher-generated local trace fixtures, and stronger replay comparison coverage for fallback, clarification, and dependency paths.
- Added package repository metadata (`repository`, `homepage`, and `bugs`) so GitHub Packages can link the package back to the source repository more cleanly.

## 0.4.0 - 2026-03-21

- Expanded the runtime surface across Codex, Claude Code, and OpenCode, including Codex `exec` model/profile/config/search/image/add-dir/JSON/ephemeral flags, Claude settings-overlay merging, and OpenCode merged config overlays plus multi-file attachments.
- Added dry-run runtime harness coverage so `wave launch --dry-run --no-dashboard` now materializes prompts, merged runtime overlays, and executor launch previews for all supported real runtimes.
- Added dedicated runtime configuration reference docs under `docs/reference/runtime-config/` and seeded them through `wave init` so repos can configure executor defaults, profiles, lane overrides, and per-agent `### Executor` blocks from one canonical reference.
- Added hermetic `traceVersion: 2` trace bundles with copied launched-agent artifacts, cumulative quality metrics, hash validation, and an internal read-only replay validator for bundle integrity checks.
- Hardened runtime retry and coordination behavior by blocking retry fallback when no policy-safe fallback is available, tightening clarification-follow-up matching, and surfacing artifact-linked coordination in owning-agent inboxes.
- Added regression coverage for runtime config normalization, mixed-runtime dry runs, retry fallback gating, clarification/inbox coordination behavior, and trace replay validation.

## 0.3.0 - 2026-03-21

- Added the Phase 1 and 2 harness runtime: canonical coordination store, compiled inboxes, wave ledger, integration summaries, and clarification triage.
- Added planning-time runtime profiles, lane runtime policy, hard runtime-mix validation, and retry fallback reassignment recording.
- Added integration stewardship and staged closure so integration gates documentation and evaluator closure.

## 0.2.0 - 2026-03-21

- Added workspace-root aware runtime support so the package can run from `node_modules` against an adopting repository.
- Added package management commands: `wave init`, `wave upgrade`, `wave changelog`, and `wave doctor`.
- Added `.wave/install-state.json` and upgrade-history reporting for non-destructive repo upgrades.

## 0.1.0 - 2026-03-21

- Initial generic wave orchestrator runtime.
- Added Context7 bundle resolution and multi-executor support for Codex, Claude Code, and OpenCode.
