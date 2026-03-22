# Changelog

## Unreleased

## 0.6.0 - 2026-03-22

### Breaking Changes

- Breaking rename: legacy `evaluator` role/config terminology has been removed in favor of `cont-QA`, and config now rejects `roles.evaluator*`, `skills.byRole.evaluator`, and `runtimePolicy.defaultExecutorByRole.evaluator`.
- Closure authoring, prompts, starter bundles, validation, and gate parsing now distinguish optional `cont-EVAL` (`E0`) from the mandatory `cont-QA` (`A0`) role instead of treating them as one overloaded evaluator surface.

### Added

- Added optional `cont-EVAL` as a first-class closure-stage role for iterative service-output and benchmark tuning, with `## Eval targets`, repo-owned benchmark catalog validation, delegated versus pinned benchmark selection, dedicated `E0` sequencing before integration closure, and a new `scripts/wave-orchestrator/evals.mjs` policy layer.
- Added `docs/evals/README.md` plus `docs/evals/benchmark-catalog.json` so waves can authorize benchmark families and pinned checks against repo-governed coordination, latency, contradiction-recovery, and quality targets.
- Added an optional report-only security reviewer role via `docs/agents/wave-security-role.md`, wave parsing support, planner authoring support, a `security-review` executor profile, per-wave security summaries, structured `[wave-security]` markers, and report-path validation that routes fixes back to implementation owners instead of silently folding review into integration.
- Added transient ad-hoc task flows on top of the launcher substrate with `wave adhoc plan`, `wave adhoc run`, `wave adhoc show`, and `wave adhoc promote`, including stored specs under `.wave/adhoc/runs/`, generated launcher-compatible markdown, and launcher-backed dry-run or live execution.
- Added dedicated role-helper logic used by planner, launcher, validation, and trace code to reason about `cont-EVAL`, `cont-QA`, and security-review responsibilities.
- Added dedicated regression suites for eval target parsing and validation, security review validation, ad-hoc run planning and promotion, docs queue behavior, and the expanded research archive topic grouping.

### Changed

- Expanded the authored wave surface and starter docs to match the new closure model: updated role prompts, wave examples, migration guidance, current-state docs, roadmap notes, and package docs so `cont-EVAL`, `cont-QA`, and security review are all first-class authoring concepts.
- Expanded the skills surface substantially: richer `skill.json` manifests, more complete runtime and provider adapters, recursive `references/` material, updated starter role packs, new `skills/README.md`, and clearer runtime-projection/reference docs for role-, runtime-, and deploy-kind-aware skill activation.
- Expanded provider and operator guidance across the shipped skill packs, including richer Railway, AWS, Kubernetes, Docker Compose, SSH/manual, GitHub Release, repo-coding-rules, role-security, and wave-core references.
- Expanded proof-first authoring guidance with new sample waves and reference docs for live-proof work, benchmark-driven closure, sticky executor guidance, and richer example wave surfaces.
- Expanded the local research bibliography and tooling: updated `docs/research/agent-context-sources.md`, added `docs/research/coordination-failure-review.md`, introduced the combined research manifest under `scripts/research/manifests/agent-context-expanded-2026-03-22.mjs`, and taught the archive indexer about planning, skills, blackboard, repo-context, and security topic slices.
- Curated the README research section so the public-facing bibliography points at the specific papers and practice articles the implementation is based on, rather than only a generic source list.

### Fixed And Hardened

- Hardened agent-state, launcher, ledger, replay, traces, local-executor, config, and wave-file validation so `cont-EVAL`, `cont-QA`, and security review all use the correct markers, report ownership, gate sequencing, exit expectations, and replay-visible state.
- Hardened runtime artifact normalization so versioned dashboard payloads always rewrite stale `kind` and `schemaVersion` fields to the canonical `0.6` metadata contract.
- Hardened closure-sweep validation so waves that override the integration or documentation steward ids are validated against the same role ids that the launcher actually runs.
- Hardened coordination and clarification handling so new integration-summary, security-review, and human-follow-up surfaces stay visible in the canonical coordination state, generated board projections, inboxes, and trace artifacts.
- Hardened `wave coord show` into a read-only inspection path again; artifact materialization stays on `wave coord render` and `wave coord inbox`.
- Hardened skill and runtime overlays so invalid manifests, mismatched selectors, missing adapters or references, and runtime-specific projection mistakes fail loudly instead of degrading silently at launch time.
- Hardened ad-hoc planning and promotion so `wave adhoc promote` promotes the stored ad-hoc spec instead of re-reading the current project profile, shared-plan deltas still queue the canonical lane docs correctly, and ownership inference ignores external URL-style hints rather than treating them as repo paths.
- Hardened install and starter-surface updates so newly seeded workspaces pick up the renamed closure roles, eval catalog, security review role, and expanded skill/reference materials consistently.

### Testing And Validation

- Expanded regression coverage across `agent-state`, `config`, `coordination`, `launcher`, `planner`, `skills`, `traces`, `wave-files`, `install`, `local-executor`, and the new `adhoc` and `evals` modules to cover the release's new closure, security, skills, and ad-hoc execution behavior end to end.
- Added focused regression coverage for dashboard metadata normalization, custom closure-role ids, read-only `wave coord show`, and the per-agent rate-limit retry wrapper.

## 0.5.4 - 2026-03-22

- Added the planner foundation: project bootstrap memory in `.wave/project-profile.json`, `wave project setup|show`, and interactive `wave draft` generation of structured wave specs plus launcher-compatible markdown.
- Added the cross-runtime skill system: canonical `skills/` bundles, lane and per-agent attachment, deploy-kind and runtime-aware resolution, and runtime projections for Codex, Claude Code, OpenCode, and local execution.
- Expanded package docs with a docs index plus concept, guide, and reference pages covering waves, planner workflow, operating modes, Context7 vs skills, terminal surfaces, and runtime-agnostic orchestration.
- Clarified `--reconcile-status` failures by surfacing why incomplete waves are not reconstructable instead of failing with opaque output.

## 0.5.3 - 2026-03-22

- Deferred integration, documentation, and cont-QA agents until the closure sweep whenever implementation work is still pending, so the runtime now matches the documented closure model.
- Scoped wave wait/progress and human-feedback monitoring to the runs actually launched in the current pass, preventing deferred closure agents from surfacing as false pending or missing-status failures.
- Added regression coverage for mixed implementation/closure waves and for closure-only retry waves.
- Published `@chllming/wave-orchestration@0.5.3` successfully to npmjs and GitHub Releases.

## 0.5.2 - 2026-03-22

- Hardened structured closure marker parsing so fenced or prose example `[wave-*]` lines no longer satisfy implementation, integration, documentation, or cont-QA gates.
- Hardened `### Deliverables` so declared outputs must remain repo-relative file paths inside the implementation agent's declared file ownership before the exit contract can pass.
- Added regression coverage for the fenced-marker false-positive path and for deliverables that escape ownership boundaries.
- Published `@chllming/wave-orchestration@0.5.2` successfully to npmjs, making npmjs the working public install path instead of a pending rollout target.

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
- Added integration stewardship and staged closure so integration gates documentation and cont-QA closure.

## 0.2.0 - 2026-03-21

- Added workspace-root aware runtime support so the package can run from `node_modules` against an adopting repository.
- Added package management commands: `wave init`, `wave upgrade`, `wave changelog`, and `wave doctor`.
- Added `.wave/install-state.json` and upgrade-history reporting for non-destructive repo upgrades.

## 0.1.0 - 2026-03-21

- Initial generic wave orchestrator runtime.
- Added Context7 bundle resolution and multi-executor support for Codex, Claude Code, and OpenCode.
