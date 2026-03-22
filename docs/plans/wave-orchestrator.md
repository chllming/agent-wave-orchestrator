# Wave Orchestrator

The Wave Orchestrator coordinates repository work as bounded execution waves.

For the broader docs map, concept pages, and workflow guides, start at [docs/README.md](../README.md).

## What It Does

- parses wave plans from `docs/plans/waves/`
- supports transient ad-hoc runs from `.wave/adhoc/runs/` on the same launcher substrate
- fans a wave out into one session per `## Agent ...` section
- supports standing role imports from `docs/agents/*.md`
- seeds a coordination log, generated board, compiled shared summary, and per-agent inboxes
- derives a per-wave ledger, security summary, docs queue, integration summary, and versioned per-attempt trace bundle
- versions the runtime JSON surfaces that operators and replay tooling consume, including manifests, dashboards, relaunch plans, assignment snapshots, dependency snapshots, and run-state
- validates Context7 declarations and exit contracts from configurable wave thresholds
- validates component promotions and component-owned proof from configurable wave thresholds
- writes prompts, logs, dashboards, coordination state, and status summaries under `.tmp/`
- supports launcher-side Context7 prefetch and injection for headless runs
- supports headless execution through `codex`, `claude`, `opencode`, and the local smoke executor
- can retry rate-limited `codex`, `claude`, and `opencode` launches with per-agent exponential backoff via `--agent-rate-limit-*`
- supports a file-backed human feedback queue
- performs a closure sweep so optional `cont-EVAL`, optional security review, integration, documentation, and cont-QA gates reflect final landed state

## Main Commands

- `pnpm exec wave project setup`
- `pnpm exec wave project show --json`
- `pnpm exec wave draft --wave 1 --template implementation`
- `pnpm exec wave adhoc plan --task "patch the planner output"`
- `pnpm exec wave adhoc run --task "patch the planner output" --yes`
- `pnpm exec wave adhoc show --run <id>`
- `pnpm exec wave adhoc promote --run <id> --wave 4`
- `pnpm exec wave init`
- `pnpm exec wave init --adopt-existing`
- `pnpm exec wave doctor`
- `pnpm exec wave launch --lane main --dry-run --no-dashboard`
- `pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access`
- `pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor claude`
- `pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor opencode`
- `pnpm exec wave autonomous --lane main --executor codex --codex-sandbox danger-full-access`
- `pnpm exec wave feedback list --lane main --pending`
- `pnpm exec wave coord show --lane main --wave 0 --dry-run`
- `pnpm exec wave coord inbox --lane main --wave 0 --agent A1 --dry-run`
- `pnpm exec wave coord post --lane main --wave 0 --agent A1 --kind blocker --summary "Need repository decision"`
- `pnpm exec wave dep show --lane main --wave 0 --json`
- `pnpm exec wave dep post --owner-lane main --requester-lane release --owner-wave 0 --requester-wave 2 --agent launcher --summary "Need shared-plan reconciliation" --target capability:docs-shared-plan --required`
- `pnpm exec wave upgrade`

## Configuration

- `wave.config.json` controls docs roots, shared plan docs, role prompts, validation thresholds, executor defaults, executor profiles, per-lane runtime policy, skill attachment policy, component-cutover matrix paths, capability-routing preferences, and Context7 bundle-index location. The starter config also wires the optional security reviewer prompt at `docs/agents/wave-security-role.md` and the `security-review` executor profile.
- `docs/context7/bundles.json` controls allowed external library bundles and lane defaults.
- `docs/evals/README.md` explains how to author delegated versus pinned `## Eval targets`, including the coordination-oriented benchmark families.
- `docs/reference/live-proof-waves.md` explains how to author proof-first `pilot-live` and higher-maturity waves with `### Proof artifacts`, sticky executors, and operator command capture.
- `docs/reference/sample-waves.md` points to showcase-first sample waves that combine the modern authored wave surface in concrete examples.
- `docs/plans/component-cutover-matrix.json` is the canonical machine-readable source for component maturity and per-wave promotion targets.
- `.wave/install-state.json` records how the workspace was initialized and which package version is installed.
- `.wave/project-profile.json` records planner defaults such as oversight mode, terminal surface, and deploy-environment memory.
- `.wave/adhoc/runs/<run-id>/` stores transient ad-hoc request, spec, rendered markdown, and result artifacts.
- ad-hoc documentation closure always writes `.wave/adhoc/runs/<run-id>/reports/`, but shared-plan deltas still queue the canonical lane shared-plan docs.
- ad-hoc task ownership inference only accepts repo-local paths; URLs and other external references are ignored.
- `wave adhoc promote` promotes the stored ad-hoc spec into `docs/plans/waves/` instead of re-reading the current project profile.

## Skill Packs

- Wave skill bundles live under `skills/<skill-id>/`.
- Each bundle requires `skill.json` and `SKILL.md`.
- Bundles can also include runtime adapters at `adapters/<runtime>.md` for `codex`, `claude`, `opencode`, or `local`.
- The starter config resolves skills in this order: global base, lane base, global role map, lane role map, global runtime map, lane runtime map, global deploy-kind map, lane deploy-kind map, then explicit per-agent `### Skills`.
- The effective skill set is recomputed after final executor resolution, including retry-time runtime fallback, so a fallback from one runtime to another also swaps runtime-specific skill overlays.
- Starter bundles in this repo cover:
  - core Wave coordination and repo coding rules
  - runtime packs for Codex, Claude, OpenCode, and local execution
  - role packs for implementation, `cont-EVAL`, security review, integration, documentation, cont-QA, infra, deploy, and research work
  - deploy and environment packs for Railway, Docker Compose, Kubernetes, SSH/manual rollout, and generic custom deploys
  - explicit provider packs for GitHub release flow and AWS norms when a wave or lane wants to attach them

## Setup

1. Install the package with `pnpm add -D @chllming/wave-orchestration`.
2. Confirm `tmux` and at least one real executor (`codex`, `claude`, or `opencode`) are available if you want real wave execution.
3. Run `pnpm exec wave init` for a fresh repo, or `pnpm exec wave init --adopt-existing` for a repo with existing Wave files you want preserved.
4. Review [wave.config.json](../../wave.config.json).
5. Review the role prompts, starter `skills/` bundles, and docs you want the repo to own.

## Recommended Launch Flow

1. Run health checks:

```bash
pnpm exec wave doctor
pnpm exec wave launch --lane main --dry-run --no-dashboard
```

2. Reconcile stale state if a prior run died mid-wave:

```bash
pnpm exec wave launch --lane main --reconcile-status
```

3. Inspect pending feedback:

```bash
pnpm exec wave feedback list --lane main --pending
```

4. Launch one wave:

```bash
pnpm exec wave launch --lane main --start-wave 0 --end-wave 0 --executor codex --codex-sandbox danger-full-access
```

5. Only move to `wave:autonomous` after single-wave runs are already stable.

## Coordination Surfaces

- `wave coord show` is a read-only view of the materialized coordination state for a wave.
- `wave coord render` regenerates the markdown board projection from the canonical coordination log.
- `wave coord inbox` writes the compiled shared summary plus the selected agent inbox.
- `wave coord post` appends a structured record to the coordination log. This is the machine-readable path for blockers, handoffs, evidence, targeted requests, and clarification requests.

The canonical state is the JSONL log under `.tmp/<lane>-wave-launcher/coordination/`. The markdown board is a generated projection for humans, not the scheduler's source of truth.

Capability-targeted requests now become deterministic helper assignments. The launcher resolves the assignee from explicit targets, `capabilityRouting.preferredAgents`, then least-busy matching capability owners, writes that assignment into `.tmp/<lane>-wave-launcher/assignments/`, mirrors the decision into coordination state, and keeps the wave blocked until the linked follow-up resolves.

Clarification flow is orchestrator-first:

1. Agent emits `clarification-request` through `wave coord post`.
2. The launcher triages it from repo policy, ownership, prior decisions, or targeted rerouting.
3. Only unresolved items become human feedback tickets.
4. Routed clarification follow-up requests remain blocking until they resolve.
5. Human escalations are written back into coordination state, the ledger, and trace artifacts.

## Cross-Lane Dependencies

- `wave dep post` appends a typed dependency ticket under `.tmp/wave-orchestrator/dependencies/`.
- `wave dep show` materializes the inbound/outbound dependency snapshot for a lane and wave.
- `wave dep resolve` closes or updates an existing dependency ticket.
- `wave dep render` writes a markdown dependency projection next to the JSONL store for human review.

Required inbound dependencies block autonomous next-wave start and lane finalization. Required outbound dependencies are surfaced in the per-wave dependency snapshot and keep the requester wave from closing while they remain part of that wave's exit conditions.

## Upgrade Flow

1. Upgrade the package version:

```bash
pnpm up @chllming/wave-orchestration
```

2. Record the upgrade and review release notes:

```bash
pnpm exec wave upgrade
pnpm exec wave changelog --since-installed
```

3. Review `.wave/upgrade-history/` for any manual follow-up. The upgrade flow does not overwrite repo-owned plans, waves, or config.

## What The Launcher Writes

- prompts: `.tmp/<lane>-wave-launcher/prompts/`
- logs: `.tmp/<lane>-wave-launcher/logs/`
- status summaries: `.tmp/<lane>-wave-launcher/status/`
  `run-state.json` keeps compatibility `completedWaves`, but now also stores per-wave current state plus append-only transition history and completion or blocker evidence. Relaunch plans in this directory are schema-versioned.
- coordination logs: `.tmp/<lane>-wave-launcher/coordination/`
- helper-assignment snapshots: `.tmp/<lane>-wave-launcher/assignments/`
- message boards: `.tmp/<lane>-wave-launcher/messageboards/`
- compiled inboxes: `.tmp/<lane>-wave-launcher/inboxes/`
- ledger: `.tmp/<lane>-wave-launcher/ledger/`
- security summaries: `.tmp/<lane>-wave-launcher/security/`
  The launcher writes `wave-<n>.json` and `wave-<n>.md` summaries here, and the starter planner also places the reviewer-owned security report in this directory.
- integration summaries: `.tmp/<lane>-wave-launcher/integration/`
  These summaries now carry actionable evidence for conflicting claims, changed interfaces, cross-component impacts, proof gaps, documentation gaps, and deploy or ops risk.
- dependency snapshots: `.tmp/<lane>-wave-launcher/dependencies/`
- docs queue: `.tmp/<lane>-wave-launcher/docs-queue/`
- trace bundles: `.tmp/<lane>-wave-launcher/traces/`
- clarification triage: `.tmp/<lane>-wave-launcher/feedback/triage/`
- dashboards: `.tmp/<lane>-wave-launcher/dashboards/`
  Dashboard JSON is a versioned contract. `global.json` and `wave-<n>.json` now carry explicit `schemaVersion` and `kind` fields.
- Context7 cache: `.tmp/<lane>-wave-launcher/context7-cache/`
- executor overlays: `.tmp/<lane>-wave-launcher/executors/`
  Each agent overlay can include `skills.resolved.md`, `skills.metadata.json`, and `<runtime>-skills.txt` in addition to the runtime-specific executor files.
- cross-lane dependencies: `.tmp/wave-orchestrator/dependencies/`
  Required inbound tickets in this directory block both autonomous wave launch and lane finalization until they resolve.
- cross-wave orchestration board: `.tmp/wave-orchestrator/messageboards/orchestrator.md`

Ad-hoc runs mirror the same state shape under `.tmp/<lane>-wave-launcher/adhoc/<run-id>/`, including dry-run previews at `.tmp/<lane>-wave-launcher/adhoc/<run-id>/dry-run/`. Their docs queue can still point at canonical shared-plan docs when the run reports a shared-plan delta.

The launcher entrypoint in `scripts/wave-orchestrator/launcher.mjs` now delegates session launch or wait mechanics to `launcher-runtime.mjs` and closure-sweep sequencing to `launcher-closure.mjs`. The CLI and `traceVersion: 2` replay contract stay unchanged.

## Trace Contract

- Dry-run is pre-attempt only. It writes manifest, coordination, board projection, inboxes, ledger, docs queue, and integration state under `.tmp/<lane>-wave-launcher/dry-run/`.
- Dry-run does not write `attempt-<k>` snapshots. The dry-run `traces/` directory can exist, but it should remain file-empty.
- A live attempt writes a hermetic `traceVersion: 2` bundle at `.tmp/<lane>-wave-launcher/traces/wave-<n>/attempt-<k>/` with:
  - `manifest.json`
  - `coordination.raw.jsonl`
  - `coordination.materialized.json`
  - `ledger.json`
  - `docs-queue.json`
  - `security.json`
  - `integration.json`
  - `outcome.json`
  - `shared-summary.md`
  - copied prompt, log, status, inbox, and summary artifacts per launched agent
  - `structured-signals.json`
  - `quality.json`
  - `run-metadata.json`
- `run-metadata.json` is the canonical trace index. It records attempt settings, artifact presence, executor history, prompt hashes, Context7 snippet hashes, resolved skill ids and bundle metadata, the gate snapshot, `replayContext`, and the cumulative `historySnapshot` for that attempt.
- `outcome.json` is the stored replay baseline. Replay compares recomputed gates and quality against it instead of trusting only inline metadata.
- For `traceVersion: 2`, launched agents must have copied prompt/log/status/inbox/summary artifacts, and promoted-component waves must include the copied component matrix JSON.
- `security.json` stores the derived per-wave security state that feeds integration summaries, gate snapshots, and replay.
- `quality.json` is cumulative through the current attempt. It is intended for regression comparison, not only for one-shot pass/fail reporting.
- `quality.json` also reports capability-assignment and dependency-resolution metrics in addition to the Phase 2/3 communication, fallback, and closure metrics.
- Replay support is internal. The source tree contains helpers to load, validate, and replay trace bundles against the same gate logic the launcher uses, but there is no public replay CLI yet.
- Replay is read-only and hash-validating for `traceVersion: 2` bundles. It ignores inline summary duplicates in `run-metadata.json` and returns a stored-vs-recomputed comparison report for gate and quality state. Legacy `traceVersion: 1` bundles remain best-effort and emit warnings instead of claiming full hermetic replay.

## Authoring Rules

- Every wave must include the configured cont-QA agent.
- Under the starter config, every wave must also include the configured integration steward and documentation steward.
- From the configured thresholds onward, declare `## Component promotions` and keep them aligned with the component cutover matrix.
- From the configured thresholds onward, every non-A0/A8/A9 agent must declare `### Components` and emit `[wave-component]` markers for those components.
- `### Capabilities` is optional and lets the scheduler route targeted follow-up work by capability.
- `### Deliverables` is optional and lets a wave declare exact repo-relative file outputs that must exist, and that stay within the agent's declared file ownership, before an implementation agent can satisfy its exit contract.
- `### Skills` is optional and adds explicit skill ids from `skills/` on top of the lane, role, runtime, and deploy-kind defaults.
- `### Executor` can declare `profile`, `fallbacks`, `tags`, and runtime budgets in addition to vendor-specific overrides.
- `### Proof artifacts` is optional for repo-only waves and recommended for `pilot-live` and above; use it to declare machine-visible local evidence required for closure.
- `## Deploy environments` lets the wave declare named deployment targets. The default deploy environment kind is also used for deploy-kind skill attachment.
- Lane runtime policy can assign a default executor by role even when the wave omits `### Executor`.
- Use `### Role prompts` for standing-role imports from `docs/agents/*.md`.
- Optional security review is declared by importing `docs/agents/wave-security-role.md` on a report-owning reviewer agent. The starter planner uses a report path under `.tmp/<lane>-wave-launcher/security/` and the `security-review` executor profile.
- A security reviewer must own at least one security report path. Any owned `.md` or `.txt` path containing `security` is accepted by the validator.
- Security reviewers are report-only by default. They should route fixes to the owning implementation agent instead of taking over product-code ownership.
- Security closure requires one final structured marker: `[wave-security] state=<clear|concerns|blocked> findings=<n> approvals=<n> detail=<short-note>`.
- Optional standing roles available in this repo include `docs/agents/wave-infra-role.md` for infra proof and `docs/agents/wave-deploy-verifier-role.md` for rollout verification.
- Keep file ownership explicit inside each `### Prompt`.
- From the configured thresholds onward, declare `## Context7 defaults`, per-agent `### Context7`, and per-agent `### Exit contract`.
- For benchmark-family guidance and delegated-versus-pinned eval examples, see [docs/evals/README.md](../evals/README.md).
- For proof-first live-wave patterns, sticky retry guidance, and `### Proof artifacts` examples, see [docs/reference/live-proof-waves.md](../reference/live-proof-waves.md).
- Agents should use `wave coord post` for durable blockers, handoffs, evidence, and requests instead of relying on ad hoc board edits.
- Keep shared plan docs and the component cutover matrix owned by the configured documentation steward once that rule becomes active.
- Use the runtime reference pages for the full executor surface instead of relying on this runbook to enumerate every key:
  [docs/reference/runtime-config/README.md](../reference/runtime-config/README.md),
  [codex.md](../reference/runtime-config/codex.md),
  [claude.md](../reference/runtime-config/claude.md),
  [opencode.md](../reference/runtime-config/opencode.md).

## Executor Modes

- `--executor codex` uses `codex exec` with the generated task prompt piped through stdin.
- `--executor claude` uses `claude -p` with the generated task prompt as the message and a harness runtime system-prompt overlay.
- `--executor opencode` uses `opencode run` with a generated runtime `opencode.json` and agent prompt overlay.
- `--executor local` exists only for smoke-testing prompt and closure behavior.
- `--codex-sandbox danger-full-access` is the default because it avoids host bubblewrap assumptions.
- Resolution order is: per-agent explicit executor id, executor profile id, lane role default, CLI `--executor`, then `executors.default`.
- The starter config includes a `security-review` profile for the optional security reviewer. It is intended for read-heavy closure passes and pairs with `docs/agents/wave-security-role.md`.
- Skills resolve only after that executor choice is known. Runtime-specific skill overlays are regenerated whenever retry-time fallback changes the selected executor.
- Runtime mix targets are enforced before launch and again before any retry-time fallback reassignment.
- Fallbacks are declared in profiles or lane policy, can be applied automatically on retry when the next executor is available and still satisfies mix targets, and are recorded in the ledger, integration summary, and traces when used.
- Generic `budget.minutes` caps per-agent attempt timeouts. Generic `budget.turns` seeds `claude.maxTurns` and `opencode.steps` when executor-specific values are not set.
- The launcher writes runtime overlay files under `.tmp/<lane>-wave-launcher/executors/`; these should stay ignored and local.

Runtime authoring examples:

````md
### Executor

- id: codex
- model: gpt-5-codex
- codex.profile_name: review
- codex.config: model_reasoning_effort=high
- codex.search: true
- codex.json: true
````

````md
### Executor

- id: claude
- model: claude-sonnet-4-6
- claude.settings_json: {"permissions":{"allow":["Read"]}}
- claude.hooks_json: {"Stop":[{"command":"echo stop"}]}
- claude.allowed_http_hook_urls: https://example.com/hooks
````

````md
### Executor

- id: opencode
- opencode.files: README.md,docs/plans/current-state.md
- opencode.config_json: {"instructions":["Keep shared-plan edits concise."]}
````

Dry-run is the intended validation path for these runtime surfaces. `wave launch --dry-run --no-dashboard` now writes compiled prompts, merged runtime overlays, and `launch-preview.json` files under `.tmp/<lane>-wave-launcher/dry-run/` so the harness can verify invocation shape without requiring the executor binaries to run.

## Human Feedback Queue

The file-backed feedback queue is now the final escalation layer, not the first-line clarification path. Operators can inspect and answer unresolved tickets with:

```bash
pnpm exec wave feedback list --lane main --pending
pnpm exec wave feedback show --id <request-id>
pnpm exec wave feedback respond --id <request-id> --response "..."
```

## Closure Sweep

If implementation agents ran, the launcher does not stop at `exit 0`. It checks implementation exit contracts, promoted component proof, helper assignments, required dependencies, and the integration recommendation first. When present, `cont-EVAL` must satisfy its declared eval targets before integration can close. Optional security review then runs before integration so the reviewer can publish findings and approval-sensitive actions while the wave is still active. In the default planner shape `E0` is report-only; if a wave explicitly assigns `E0` non-report files, the launcher also applies the normal implementation proof gates to that role. Security reviewers stay report-only by default. Documentation and cont-QA closure only run after integration is explicitly ready for doc closure; if `cont-EVAL`, security review, or integration reports more work, or if helper assignments or required dependency tickets remain open, the wave stops there and retries only the implicated owners plus the relevant closure steward.

Live closure is fail-closed:

- `cont-EVAL` PASS requires a report artifact plus a structured `[wave-eval]` marker whose `target_ids` exactly matches the wave contract and whose `benchmark_ids` stays within the declared benchmark catalog surface.
- Security review requires a report artifact plus a structured `[wave-security]` marker. `state=blocked` stops the wave before integration, while `state=concerns` is preserved in summaries and traces without automatically failing closure.
- `cont-QA` PASS requires both the final verdict and the final `[wave-gate]` marker.
- Legacy evaluator-era or underspecified closure artifacts are still readable in replay and trace analysis, but they no longer satisfy live completion.
