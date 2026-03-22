# Wave Orchestrator Roadmap

Wave Orchestrator should keep wave markdown as the authored plan surface, but it needs a higher planning-fidelity bar and a better authoring loop.

The same planning and execution substrate should also support ad-hoc operator requests without forcing every one-off task into the long-lived numbered roadmap sequence.

The target is the level of specificity shown in [Wave 7](/home/coder/slowfast.ai/docs/plans/waves/wave-7.md): explicit sequencing, hard requirements, exact validation commands, earlier-wave inputs, concrete ownership, and clear closure rules. This roadmap focuses on how to get this repo there without replacing the current architecture.

## Current Position

The repository already has the right runtime substrate:

- lane-scoped state under `.tmp/`
- wave parsing and validation
- role-based execution with cont-qa, integration, and documentation stewards
- executor profiles and lane runtime policy
- compiled inboxes, ledgers, docs queues, dependency snapshots, and trace bundles
- orchestrator-first clarification handling and human feedback workflows

The biggest remaining gap is not runtime execution. It is authored planning quality, the tooling around planning, and a lower-friction entry point for ad-hoc work that still preserves the same coordination and trace surfaces.

## Planning Fidelity Target

Every serious wave should be able to answer these questions before launch:

- What earlier waves or artifacts are prerequisites?
- What exact components are being promoted and why now?
- What is the required runtime mix and fallback policy?
- Which deploy environment or infra substrate is in scope?
- Is the run `oversight` or `dark-factory`?
- What exact validation commands must pass?
- What exact artifact closes the role?

Generated waves and transient ad-hoc runs should default to these sections when relevant:

- sequencing note
- reference rule or source-of-truth note
- project bootstrap context
- deploy environments
- component promotions
- Context7 defaults
- per-agent required context
- earlier-wave outputs to read
- requirements
- validation
- output or closure contract

## Phase 1: Planner Foundation

Status: shipped in `0.5.4`.

- Add saved project bootstrap memory in `.wave/project-profile.json`.
- Ask once whether the repo is a new project and keep that answer for future drafts.
- Add `wave project setup` and `wave project show`.
- Add interactive `wave draft` that writes:
  - `docs/plans/waves/specs/wave-<n>.json`
  - `docs/plans/waves/wave-<n>.md`
- Treat the JSON draft spec as the canonical authoring artifact and render markdown from it.
- Keep generated waves fully compatible with the current parser and launcher.
- Add `wave launch --terminal-surface vscode|tmux|none`.
- Support a tmux-only operator mode that never touches `.vscode/terminals.json`.

Why first:

- Better planning is the highest-leverage missing piece.
- The repo already has strong runtime and closure machinery.
- Project memory removes repeated setup questions and gives future planner steps a durable baseline.

## Phase 2: Ad-Hoc Task Runs

The orchestrator should support operator-driven one-off requests without requiring the user to author or commit a numbered roadmap wave first.

CLI target:

- `wave adhoc plan --task "..."`
- `wave adhoc run --task "..." [--task "..."]`
- `wave adhoc list`
- `wave adhoc show --run <id>`
- `wave adhoc promote --run <id> --wave <n>`

Behavior:

- accept one or more free-form task requests
- normalize them into a single transient plan or spec
- synthesize the worker roles needed for the request while still preserving cont-qa, integration, and documentation closure when relevant
- run that transient plan through the existing launcher, coordination, inbox, ledger, docs queue, integration, and trace machinery
- keep ad-hoc runs logged, inspectable, and replayable with the same basic operator surfaces as roadmap waves
- route shared-plan documentation deltas into the canonical shared docs queue, plus an ad-hoc closure report for the run
- treat only repo-local paths as ownership hints and ignore external references such as URLs

Storage model:

- do not write ad-hoc runs into the canonical numbered wave sequence under `docs/plans/waves/`
- store the original request, generated spec, rendered markdown, and final result under `.wave/adhoc/runs/<run-id>/`
- keep runtime state isolated under `.tmp/<lane>-wave-launcher/adhoc/<run-id>/`
- extend trace metadata with `runKind: adhoc` and `runId`

Design constraints:

- reuse the planner and launcher instead of building a second runtime
- treat ad-hoc as a transient single-run execution unit, not a fake roadmap wave
- do not let ad-hoc completion mutate normal `completedWaves` lane state
- give `wave coord`, `wave feedback`, and future replay or reporting flows a way to target `--run <id>`
- promote numbered roadmap artifacts from the stored ad-hoc spec instead of recomputing them from the current project profile

Why this matters:

- many real operator requests are one-off bugfix, investigation, doc, infra, or release tasks
- the framework's coordination, closure, and traceability should apply to ad-hoc work too
- isolated ad-hoc runs preserve auditability without polluting the long-lived roadmap

## Phase 3: Forward Replanning

Add `wave update --from-wave <n>`.

Rules:

- closed waves are immutable
- the current open wave and later waves may be regenerated
- replanning must record what changed and why
- new repo state, new user intent, and refreshed research may all trigger a replan

Outputs:

- updated draft JSON specs
- regenerated markdown waves
- a short replan summary for operator review

Why this matters:

- multi-wave plans drift as code lands
- research and infra assumptions change
- forward-only replanning preserves auditability without pretending older waves never existed

## Phase 4: Infra and Deploy-Aware Planning

Infra and deploy roles need typed environment context, not free-form prompt notes only.

Project profile should support typed deploy providers with a `custom` escape hatch:

- `railway-mcp`
- `railway-cli`
- `docker-compose`
- `kubernetes`
- `ssh-manual`
- `custom`

Planner-generated infra or deploy roles should know:

- which environment they own
- which substrate is authoritative
- what credentials or executors are expected
- what validation commands prove readiness
- what rollback or recovery guidance applies

This is especially important for `dark-factory` mode. Fully autonomous infra work should require stronger environment modeling than human-overseen work.

## Phase 5: Oversight and Dark-Factory Modes

Execution posture must be explicit plan data.

Default:

- `oversight`

Opt-in:

- `dark-factory`

`oversight` means:

- human checkpoints remain normal for live mutation, deploy, release, or risky infra work
- the planner should generate explicit review gates

`dark-factory` means:

- the wave is intended to run end-to-end without routine human approvals
- deploy environment, validation, rollback, and closure signals must be stricter
- missing environment context is a planning error, not a runtime surprise

## Phase 6: Coordination and Integration Upgrades

The runtime already has strong coordination primitives, but the roadmap should still push these areas:

- keep the canonical coordination store as the source of truth and the markdown board as a rendered view
- keep compiled per-agent inboxes and shared summaries central to prompt construction
- strengthen the integration steward output as the single closure-ready synthesis artifact
- add `wave lint` for ownership, component promotion, runtime mix, deploy environment, and closure completeness
- expand replay scenarios for replanning, autonomy modes, and infra-heavy waves

## Additional Features Worth Scheduling

- template packs for common wave shapes: implementation, QA, infra, release, migration
- doc-delta extraction plus changelog or release-note queues when waves change public behavior
- executor and credential preflight checks before launch
- project-profile-aware defaults for lane, template, terminal surface, and oversight mode
- richer branch and PR guidance in draft specs when the wave is release or deploy oriented
- benchmark scenarios that compare oversight vs dark-factory outcomes

## Research Notes

The direction above is consistent with the local source set and the current external references:

- OpenAI, “Harness engineering: leveraging Codex in an agent-first world”
  - repository-local plans and environment design matter more than prompt-only control
- Anthropic, “Effective harnesses for long-running agents”
  - first-run initialization and durable progress artifacts are critical
- DOVA
  - deliberation-first orchestration and transparent intermediate state support better refinement loops
- Silo-Bench
  - communication alone is not enough; integration quality is the real bottleneck
- Evaluating AGENTS.md
  - repository-level context files help, but they should complement executable and versioned planning artifacts rather than replace them

## Immediate Recommendation

The next shipping sequence should be:

1. planner foundation
2. ad-hoc task runs on the same substrate
3. forward replanning
4. typed infra and deploy planning
5. explicit oversight vs dark-factory workflows
6. stronger linting, replay, and benchmark coverage

That sequence keeps the current harness intact while making planning, execution posture, and infra ownership much more explicit and durable.
