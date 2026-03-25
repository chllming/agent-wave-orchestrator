# Changelog

## Unreleased

## 0.8.4 - 2026-03-25

### Changed

- Updated the shipped package metadata, release manifest, README, migration guide, current-state notes, sample-wave docs, and npm publishing runbook to advertise `0.8.4` as the current release surface.
- Rewrote the operator migration guide so it now covers fresh adoption plus upgrades from `0.8.3`, `0.8.0`-`0.8.2`, `0.6.x`-`0.7.x`, and `0.5.x` or earlier with explicit repo-owned surface sync guidance.
- Clarified the README and architecture docs so `derived-state-engine.mjs` is described as compute-only and `projection-writer.mjs` as the projection persistence boundary.

### Fixed And Hardened

- Hermetic contradiction replay no longer depends on component-matrix parsing when a trace does not declare promoted components.
- `requireComponentPromotionsFromWave` now gates both component-promotion proof validation and component-matrix current-level validation consistently across live and replay paths.
- Projection persistence is now centralized under `projection-writer.mjs`, including dashboards, traces, ledgers, docs queues, summaries, inboxes, assignment snapshots, dependency snapshots, and board projections.

### Testing And Validation

- Added regression coverage for the projection-writer persistence boundary and for component-matrix short-circuiting when no promotions are declared.
- Re-ran the full Vitest suite, `wave doctor --json`, and `wave launch --lane main --dry-run --no-dashboard`.

## 0.8.3 - 2026-03-24

### Changed

- Updated the shipped package metadata, release manifest, README, migration guide, sample-wave docs, current-state notes, and npm publishing runbook to advertise `0.8.3` as the current release surface.
- Documented that `wave feedback respond` is a canonical-state repair path, not a feedback-JSON-only update, and that ad-hoc reconciliation must keep the `--run <id>` context.

### Fixed And Hardened

- Answered human-feedback requests now reconcile linked clarification, escalation, and helper-assignment state back into the canonical coordination log so reducer state, control surfaces, and launcher gates stop reading the wave as still `clarifying`.
- `wave feedback respond --run <id>` now carries the ad-hoc run id through the reconciliation helper, so answered human input repairs the isolated ad-hoc lane state instead of the roadmap state root.
- When a wave is stranded after a human answer arrives and no active attempt is still running, the human-input reconciliation path now writes a safe one-shot continuation request instead of leaving the wave waiting for manual relaunch bookkeeping.

### Testing And Validation

- Added regression coverage for direct `wave feedback respond` reconciliation and for the ad-hoc `--run <id>` answer path.

## 0.8.2 - 2026-03-24

### Changed

- Updated the shipped package metadata, release manifest, README, migration guide, sample-wave docs, and npm publishing runbook to advertise `0.8.2` as the current release surface.

### Fixed And Hardened

- `wave control status` now treats `phase=completed` as terminal in the control-status projection layer instead of replaying stale blocking edges from historical open coordination records.
- Completed waves now return `blockingEdge: null` and `nextTimer: null`, so stale overdue timers or request blockers stop leaking into an already-closed wave view.
- Successful logical-agent state is now preserved for completed waves, so agents that already finished cleanly stay `closed` or `satisfied` even when old request records remain visible in coordination history.

### Testing And Validation

- Added regression coverage for completed-wave control-status projections so historical request records stay visible without reopening blocking state after closure.
- Revalidated the shipped release surface with the full Vitest suite, `wave doctor --json`, and `wave launch --lane main --dry-run --no-dashboard`.

## 0.8.1 - 2026-03-24

### Changed

- Updated the shipped package metadata, release manifest, README, migration guide, sample-wave docs, and npm publishing runbook to advertise `0.8.1` as the current release surface.

### Fixed And Hardened

- Helper-assignment policy resolution now treats `resolved-by-policy` follow-up as authoritative closure without requiring the original request to be rewritten.
- Manual `wave coord post --kind resolved-by-policy` now defaults to `status=resolved`, so operator-authored policy closures stop reopening the assignment they are meant to close.
- Multi-target helper requests now require assignment-specific policy evidence before closure, preventing one request-level `resolved-by-policy` note from accidentally closing sibling assignments.

### Testing And Validation

- Added regression coverage for default `resolved-by-policy` status handling and for multi-target assignment resolution that must not over-close sibling helper assignments.

## 0.8.0 - 2026-03-24

### Changed

- Updated the shipped package metadata, release manifest, README, migration guide, sample-wave docs, and npm publishing runbook to advertise `0.8.0` as the current release surface.
- Added the architecture hardening migration plan and aligned the active README, guides, runbooks, role prompts, and starter skills to the canonical authority-set and thin-launcher architecture model.

### Fixed And Hardened

- Hardened reducer and task replay determinism so coordination-derived work uses stable semantic task identity and reducer output is fit for authoritative replay.
- Hardened helper-assignment, contradiction or fact wiring, resume planning, and gate evaluation so the reducer, control-plane schema, and result-envelope path agree on the same live closure and retry state.
- Hardened live launcher evaluation by computing reducer snapshots during real runs instead of keeping that path effectively test-only.

### Testing And Validation

- Added regression coverage that guards the active docs and starter skills against stale launcher-truth wording and asserts the migration surface is anchored on the canonical authority-set architecture.
- Re-ran the full Vitest suite, `wave doctor --json`, and `wave launch --lane main --dry-run --no-dashboard`, while preserving shared `0.7.3` parity behavior where the release-era suites overlap.

## 0.7.3 - 2026-03-23

### Changed

- Updated the shipped package metadata, release manifest, README, migration guide, sample-wave docs, and npm publishing runbook to advertise `0.7.3` as the current release surface.

### Fixed And Hardened

- Implementation summary parsing now falls back to normal line-by-line structured-marker extraction when a log tail ends inside an unmatched fenced block, so malformed prompt or transcript tails cannot hide later final implementation markers.
- Proof-centric summary repair now refreshes stale `.summary.json` files when required proof/doc/component fields are missing, even if a prior run already wrote a `structuredSignalDiagnostics` object with incorrect zero-count data.

### Testing And Validation

- Added regression coverage for unmatched end-of-tail fenced logs and stale diagnostics-backed implementation summaries.

## 0.7.2 - 2026-03-23

### Changed

- Updated the shipped package metadata, release manifest, README, migration guide, sample-wave docs, and npm publishing runbook to advertise `0.7.2` as the current release surface.
- Implementation prompts now require incomplete work to stay inside the final proof, doc-delta, and component markers with `state=gap`, and route unresolved issues through `wave coord post` instead of trailing `[wave-gap]` markers.

### Fixed And Hardened

- Implementation summary parsing now accepts final `[wave-proof]`, `[wave-doc-delta]`, and `[wave-component]` markers when the final structured block is emitted as Markdown list items.
- Validation now distinguishes missing markers from rejected marker syntax with `invalid-wave-proof-format`, `invalid-doc-delta-format`, and `invalid-wave-component-format`.
- Proof-centric summary repair now refreshes legacy `.summary.json` files from source logs only when the stored summary is actually missing required proof/doc/component data, preserving valid historical summaries.
- `reconcile-status` now backfills missing `deliverables` and `proofArtifacts` arrays in older agent summaries before validation, so previously authoritative completed waves can survive summary-schema drift without weakening live closure.
- Codex launch previews now expose `effectiveTurnLimit` and `effectiveTurnLimitSource`, making unresolved external turn ceilings machine-readable before the runtime later reports an observed limit.

## 0.7.1 - 2026-03-23

### Changed

- Updated the shipped package metadata, release manifest, README, migration guide, sample-wave docs, and npm publishing runbook to advertise `0.7.1` as the current release surface.
- Clarified the adopted-repo `0.7.x` upgrade path with explicit planner-corpus remediation, stable dashboard reattach guidance, and current-release examples that match the package tag.

### Fixed And Hardened

- Fresh live launches now clear stale auto-generated relaunch plans by default, with `--resume-control-state` as the explicit opt-in when an operator intentionally wants to preserve prior relaunch intent.
- Fixed `wave control status` so an already-running attempt remains the authoritative live fan-out instead of letting stale relaunch metadata or unrelated closure blockers dominate the wave-level view.
- Fixed `reconcile-status` so waves with prior authoritative closure stay complete as `completed_with_drift` when the only mismatch is historical prompt-hash drift.
- Fixed live executor overlays so `launch-preview.json` is written for real runs as well as dry-runs, and Codex previews record observed turn ceilings when the runtime logs one.
- Updated dashboard, CLI reference, and terminal-surface docs to consistently point operators at the shipped `wave dashboard --attach current|global` surface.

### Testing And Validation

- Updated release-surface regression coverage so package metadata, README, changelog, release manifest, migration guidance, and CLI docs all stay aligned on the current release version.

## 0.7.0 - 2026-03-23

### Added

- Added a unified `wave control` operator CLI that replaces `wave coord`, `wave retry`, and `wave proof` as the preferred command surface:
  - `wave control status` materializes a single control-plane view with blocking edges, logical agent state, tasks, dependencies, rerun intent, active proof bundles, and next-timer projections.
  - `wave control task create|get|list|act` is the operator task surface for blocking requests, blockers, clarification chains, human-input tickets, escalations, and informative handoffs, evidence, claims, and decisions.
  - `wave control rerun request|get|clear` manages targeted rerun intent with selected agents, explicit reuse selectors, invalidated components, clear-or-preserve reuse lists, and resume cursors.
  - `wave control proof register|get|supersede|revoke` manages authoritative proof bundles with full lifecycle state (active, superseded, revoked).
  - `wave control telemetry status|flush` inspects and delivers the local Wave Control event queue.
- Added a canonical control-plane event log under `.tmp/<lane>-wave-launcher/control-plane/` as append-only JSONL with event-sourced materialization. Proof registries and retry overrides under `proof/` and `control/` are now projections from this log rather than independent state files.
- Added Wave Control telemetry, a local-first event system that queues typed events under `control-plane/telemetry/` and delivers them in best-effort batches to a Railway-hosted analysis endpoint:
  - Configurable report modes: `disabled`, `metadata-only`, `metadata-plus-selected`, `full-artifact-upload`.
  - Selective artifact upload by kind via `uploadArtifactKinds`.
  - New `waveControl` config section in `wave.config.json` with global and per-lane overrides for endpoint, workspace, auth, report mode, batch size, and per-category capture toggles.
  - New `--no-telemetry` launcher flag to disable event publication for a single run.
  - Telemetry capture across coordination records, control-plane events, trace bundles, feedback requests, and benchmark runs.
- Added native benchmark telemetry publishing so `wave benchmark run` emits `benchmark_run`, `benchmark_item`, `verification`, and `review` events with deterministic run IDs and config attestation hashes.
- Added external benchmark telemetry with failure-review validity classification (`comparison-valid`, `review-only`, `benchmark-invalid`, `harness-setup-failure`, `proof-blocked`, `trustworthy-model-failure`) and artifact descriptors for patches, summaries, and verification output.
- Added `docs/reference/wave-control.md` documenting the Wave Control telemetry contract, entity types, artifact upload policies, and local-first delivery model.
- Added `docs/reference/proof-metrics.md` mapping README failure cases to concrete telemetry signals and success criteria.
- Added `docs/evals/wave-benchmark-program.md` enhancements for native benchmarking mode with deterministic coordination-substrate tests.
- Added a showcase-first `repo-landed` rollout-fidelity sample wave plus refreshed sample-wave docs so `0.7.0` includes both a dense proof-first example and a narrower closure-ready authoring reference.
- Added resident orchestrator support via `--resident-orchestrator`, with a standing role prompt at `docs/agents/wave-orchestrator-role.md` and explicit non-owning session boundaries.
- Added live-wave orchestration refresh that keeps shared summaries, inboxes, clarification triage, and dashboard coordination metrics current while agents are still running, including overdue acknowledgement tracking and stale clarification rerouting.
- Added `docs/reference/runtime-config/README.md` section for `waveControl` configuration with defaults and artifact-kind filtering.

### Changed

- `wave coord`, `wave retry`, and `wave proof` remain available as compatibility surfaces, but new operator docs and runbooks now prefer `wave control`.
- Proof registries and retry overrides are now projections from the canonical control-plane event log rather than independently managed state files. Legacy file paths are maintained for compatibility.
- Trace bundles now copy `control-plane.raw.jsonl`, `capability-assignments.json`, and `dependency-snapshot.json` alongside the existing coordination, ledger, and proof artifacts.
- `wave control task` supports informational coordination kinds (handoff, evidence, claim, decision) without falsely treating them as blocking edges in status views.
- Proof bundles now carry lifecycle state so revoked or superseded operator evidence cannot keep satisfying closure gates.
- Rerun requests now support explicit reuse selectors, component invalidation, resume cursors, and clear-or-preserve reuse lists alongside the existing agent selection.
- Coordination store, feedback, clarification triage, traces, and benchmark modules now publish telemetry events when Wave Control capture is enabled.
- Wave Control storage and queries now support durable Postgres-backed filtering by `workspaceId`, `projectId`, `orchestratorId`, and `runtimeVersion`.
- Skill resolution description and documentation now accurately reflects the merge-then-resolve code path (base → role → runtime → deploy-kind → explicit).
- Updated all documentation to reflect `0.7.0` release surface, including the operational runbook, coordination reference, sample waves, and live-proof examples.
- Dashboard docs and CLI reference now document the stable `wave dashboard --attach current|global` surface instead of older speculative flags.
- Upgrade and planner docs now call out the repo-owned planner corpus required by adopted `0.7.x` repos and explain that `wave upgrade` stays non-destructive.
- Fresh live launches now clear stale auto-generated relaunch plans by default, with an explicit `--resume-control-state` escape hatch when an operator intentionally wants to preserve the previous relaunch selection.

### Fixed And Hardened

- Fixed executor-profile inheritance so a Claude profile that only overrides `claude.effort` or other scalar runtime fields now keeps the inherited global Claude command and runtime settings instead of nulling them out.
- Fixed shared promoted-component retries so landed owners stay reusable, stale relaunch plans are invalidated against current sibling ownership, and continuation can advance to the remaining owners without burning another retry on the already-clean agent.
- Fixed clarification triage so routed follow-up work supersedes stale human escalations, keeps the routed chain blocking through the linked request, and only opens human escalation after orchestrator-side routing is actually exhausted.
- Fixed `reconcile-status` so waves with prior authoritative closure stay complete as `completed_with_drift` when the only mismatch is historical prompt-hash drift.
- Fixed live executor overlays so `launch-preview.json` is written for real runs as well as dry-runs, and Codex previews record an observed turn ceiling when the runtime logs one.
- Fixed `wave control status` so an already-running attempt is treated as the authoritative live fan-out instead of letting stale relaunch metadata or unrelated closure blockers dominate the wave-level view.
- Hardened proof registry projections from the control-plane so revoked and superseded bundles are excluded from closure evaluation.
- Hardened the "What The Launcher Writes" path reference to correctly place `run-state.json` at the state root (not under `status/`), and added `control-plane/`, `proof/`, and `control/` directories.
- Closed 11 documentation-to-code gaps identified by end-to-end audit, including trace contract completeness, skill pack enumeration, benchmark CLI surface, and steward coordination kinds.

### Testing And Validation

- Added new test suites for `wave-control-schema`, `wave-control-client`, and `control-cli` covering event envelope normalization, telemetry queueing, delivery state tracking, and unified control-plane operations.
- Expanded config tests for `waveControl` normalization and lane-level overrides.
- Added regression coverage for Claude scalar inheritance, sibling-owner shared-component continuation, stale relaunch-plan invalidation, and launcher-generated routed-clarification trace replay.
- Added regression coverage for proof-cli, proof-registry, retry-cli, and retry-control modules.

## 0.6.3 - 2026-03-22

- Added a best-effort npmjs update notice on `wave launch`, `wave autonomous`, and `wave adhoc run`, with cached lookup state under `.wave/package-update-check.json` and opt-out via `WAVE_SKIP_UPDATE_CHECK=1`.
- Added `wave self-update`, which detects the workspace package manager, updates `@chllming/wave-orchestration`, prints the changelog delta since the recorded install, and then runs `wave upgrade`.
- Suppressed duplicate notices for nested launcher calls so autonomous and ad-hoc runs announce at most once, while keeping JSON-oriented stdout surfaces clean by emitting notices on stderr.
- Documented the new update flow and added regression coverage for notice caching, package-manager-aware self-update, and nested-launch suppression.

## 0.6.2 - 2026-03-22

- Added first-class `claude.effort` support across config profiles, lane overrides, and per-agent `### Executor` blocks, and now emit `--effort` in Claude launch previews and live runs.
- Clarified operator runtime visibility with additive `launch-preview.json` `limits` metadata, including explicit known turn ceilings for Claude/OpenCode and explicit Codex opacity when Wave does not emit a turn-limit flag.
- Clarified dashboard and terminal UX: global wave counts now distinguish done, active, pending, and failed agents; the current-wave dashboard keeps a stable terminal name; and TTY dashboards use simple color cues for faster scanning.
- Pruned stale dry-run executor preview directories when wave agent sets shrink, so manual inspection of `.tmp/.../dry-run/executors/` matches the current manifest.
- Improved shared promoted-component retry selection so common sibling-owned closure cases avoid immediately replaying the already-landed owner.
- Added release-surface alignment regression coverage and updated the shipped docs so README, runtime-config references, changelog, and release metadata match the `0.6.2` package surface.

## 0.6.1 - 2026-03-22

- Published the post-merge `main` source as `0.6.1` so the default branch, tagged source, and package docs all agree on the current release.
- Updated shipped package docs and release metadata to advertise `0.6.1` as the current release surface, including the runtime-config reference that still said `0.5.x` during the `0.6.0` cut.
- No additional runtime behavior changes beyond the `0.6.0` workspace-scoped tmux isolation fix; this patch release aligns the published package with the merged source tree.

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
