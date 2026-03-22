# Wave Orchestrator Roadmap

This roadmap records the highest-value upgrades for Wave Orchestration while preserving the current architecture:

- lane-scoped runs
- wave markdown as the authored plan surface
- multi-role agents with explicit ownership
- component promotions, exit contracts, documentation stewardship, and evaluator closure

The goal is not to replace waves with a different orchestration model. The goal is to make the existing wave model more durable for long-running, multi-agent, multi-lane repository work.

## Current Status

As of the current repository state:

- the package-first install and upgrade flow is shipped
- the canonical coordination JSONL store, rendered board projection, compiled inboxes, per-wave ledger, docs queue, integration summaries, and trace bundles are shipped
- `A8` integration stewardship and staged closure are shipped
- orchestrator-first clarification triage and human-escalation artifacts are shipped
- per-agent executor profiles, per-lane runtime policy, hard runtime mix targets, retry-time fallback, and generic budgets are shipped
- required inbound cross-lane dependency tickets now block both autonomous wave launch and lane finalization
- integration summaries now carry actionable evidence for claims, interface drift, proof gaps, docs gaps, and deploy or ops risk
- cumulative `quality.json` metrics and internal, read-only hermetic trace replay validation are shipped
- capability-targeted requests now become explicit helper assignments with deterministic assignee selection, ledger/traces coverage, and closure barriers
- typed cross-lane dependency workflows now have operator commands, per-wave dependency snapshots, and replay-visible gating

The remaining roadmap work is mostly about extending those foundations rather than inventing a new orchestration model.

## Design Position

The recent harness and blackboard sources point in the same direction:

- compaction alone is not enough for long-running work
- append-only communication logs are useful, but not sufficient as the canonical coordination substrate
- messaging quality matters less than whether the system can integrate distributed findings into a coherent decision
- runtime choice should be treated as authored plan data, not only as a launch-time default
- clarification should stay inside the harness loop until the orchestrator can prove that human input is actually required
- the harness needs reproducible traces, explicit loop control, and durable state across sessions

Wave Orchestration already has a strong base:

- wave parsing and role imports
- lane-scoped state under `.tmp/`
- canonical coordination JSONL plus generated message boards
- compiled shared summaries and per-agent inboxes
- per-agent executor overrides, profiles, per-lane runtime policy, and retry fallback for Codex, Claude, and OpenCode
- structured proof and documentation markers
- integration, documentation, and evaluator closure sweep
- a file-backed human feedback queue plus orchestrator-first clarification triage
- ledger, docs queue, and trace bundles

The next step is to evolve the harness from “agents write progress notes” into “agents coordinate through typed shared state, compiled inboxes, runtime-aware planning, and an explicit integration phase.”

## What To Keep

These parts of the current model should stay:

- Wave markdown remains the authored planning surface.
- Lanes remain the top-level isolation unit for separate workstreams.
- Agent IDs and role prompts remain the basic execution model.
- The per-agent `### Executor` section remains the planning surface for runtime choice; it just becomes richer and more enforceable.
- Exit contracts, component promotions, documentation stewardship, and evaluator closure remain the primary completion controls.
- The markdown message board remains as a human-readable audit view.

## Highest-Value Addons

### 1. Canonical Coordination Store

Add a lane- and wave-scoped structured coordination store and treat the markdown message board as a rendered view.

Why this is highest value:

- The current board format in `scripts/wave-orchestrator/coordination.mjs` is easy to read but weak as machine state.
- The parser depends on regexes and free-text fields.
- Blackboard-style coordination works best when requests, claims, evidence, blockers, and decisions are explicit typed objects.

Proposed artifact:

- `.tmp/<lane>-wave-launcher/coordination/wave-<n>.jsonl`

Proposed record kinds:

- `request`
- `ack`
- `claim`
- `evidence`
- `decision`
- `blocker`
- `handoff`
- `human-feedback`
- `integration-summary`

Required fields:

- `id`
- `kind`
- `wave`
- `lane`
- `agentId`
- `targets`
- `status`
- `priority`
- `artifactRefs`
- `dependsOn`
- `closureCondition`
- `createdAt`
- `updatedAt`
- `confidence`
- `summary`
- `detail`

Compatibility rule:

- keep writing the markdown board, but generate it from the coordination store and append a short human-readable projection

### 2. Agent Inbox Compiler

Stop injecting a raw board tail into every agent prompt. Compile role-specific inboxes from the canonical coordination state.

Why this is high value:

- Long-running harness guidance favors explicit handoff artifacts and short “get up to speed” paths.
- Raw tail snapshots are noisy and lose important old-but-still-open obligations.
- Multi-agent blackboard systems work when the current blackboard state determines who should act next and what they should see.

Proposed artifacts:

- `.tmp/<lane>-wave-launcher/inboxes/wave-<n>/<agent-id>.md`
- `.tmp/<lane>-wave-launcher/inboxes/wave-<n>/shared-summary.md`

Each inbox should contain:

- owned open requests
- claims that conflict with this agent’s work
- unresolved blockers affecting owned files or components
- required doc deltas
- human feedback relevant to that agent
- integration findings from prior attempts
- only the minimal recent audit context needed for recovery

Prompt change:

- `buildExecutionPrompt` should inject the compiled inbox plus the shared wave summary, not the last N characters of the board

### 3. Explicit Integration Phase Before Final Closure

Add a dedicated integration phase between implementation completion and documentation/evaluator closure.

Why this is essential:

- Silo-Bench shows a communication-reasoning gap: agents can exchange enough information and still fail to integrate it.
- DOVA’s strongest pattern is ensemble breadth, blackboard transparency, then iterative refinement.
- The current closure sweep checks implementation, docs, evaluator, and infra, but does not assign integration as a first-class role.

Proposed model:

- reserve a configurable integration steward, default `A8`
- the integration steward does not own feature implementation
- it owns synthesis, conflict detection, integration risk, and open dependency reconciliation

Integration outputs:

- `.tmp/<lane>-wave-launcher/integration/wave-<n>.json`
- `.tmp/<lane>-wave-launcher/integration/wave-<n>.md`

Required fields:

- open claims
- conflicting claims
- unresolved blockers
- changed interfaces
- cross-component impacts
- proof gaps
- doc gaps
- release/deploy risks
- final recommendation: `ready-for-doc-closure` or `needs-more-work`

Gate rule:

- the documentation steward and evaluator do not run their final pass until the integration steward emits a final integration summary

### 4. Durable Wave Task Ledger

Add a machine-readable wave ledger separate from the coordination log.

Why this matters:

- Anthropic’s initializer/progress/feature-list pattern and OpenAI’s repository-as-system-of-record point to the same need: durable task state
- a coordination stream is not the same thing as a canonical ledger of what is left

Proposed artifact:

- `.tmp/<lane>-wave-launcher/ledger/wave-<n>.json`

Track:

- tasks and subgoals derived from the wave
- owner agent
- current state
- proof status
- docs status
- infra/deploy status
- dependent tasks
- baseline verification status

Use:

- the autonomous runner should use the ledger, not only run-state, to decide whether to continue, relaunch a role, or stop

### 5. Communication-Aware Scheduling

Use coordination state to drive execution decisions.

Why this matters:

- the current dashboard renders communication health, but the launcher and autonomous runner do not meaningfully act on it
- blackboard systems are strongest when blackboard state affects who runs next

Additions:

- if an agent has unacknowledged targeted requests, prioritize or relaunch that agent
- if a high-priority blocker remains unresolved, prevent wave completion
- if integration detects unresolved cross-agent contradictions, force a focused follow-up round
- if only documentation deltas remain, relaunch only the documentation steward
- if only deployment or infra proof remains, relaunch only the relevant infra/deploy role

### 6. Mixed-Runtime Planning And Runtime Profiles

Treat executor choice as authored plan data at wave design time, not only as a launcher default.

Why this is useful:

- The current harness already supports per-agent executor selection, but the planning surface is too narrow for real mixed-runtime lane design.
- Different roles benefit from different runtimes: implementation, evaluation, documentation, integration, and infra/deploy do not need identical execution substrates.
- The OpenAI App Server pattern and OPENDEV's provider-conditional harness design both point toward a stable harness loop with swappable underlying runtimes.

Wave file change:

- strengthen `### Executor` from optional override into a first-class planning section for roles that need non-default runtime behavior
- allow runtime profiles plus inline overrides

Recommended keys:

- `id`
- `profile`
- `model`
- `fallbacks`
- `tags`
- `budget.turns`
- `budget.minutes`
- `codex.command`
- `codex.sandbox`
- `claude.command`
- `claude.agent`
- `claude.permission_mode`
- `claude.permission_prompt_tool`
- `claude.max_turns`
- `claude.mcp_config`
- `claude.settings`
- `claude.output_format`
- `claude.allowed_tools`
- `claude.disallowed_tools`
- `opencode.command`
- `opencode.agent`
- `opencode.attach`
- `opencode.format`
- `opencode.steps`
- `opencode.instructions`
- `opencode.permission`

Lane config additions:

- `executors.profiles.<profile-name>`
- `lanes.<lane>.runtimeMixTargets`
- `lanes.<lane>.defaultExecutorByRole`
- `lanes.<lane>.fallbackExecutorOrder`

Example runtime mix target:

- `codex: 3`
- `claude: 3`
- `opencode: 2`

Use:

- planners assign runtime and runtime profile inside the wave, not only at launch time
- launcher validation accepts only supported runtime fields and rejects silent drift
- the orchestrator can reassign an agent only when the fallback policy allows it
- dashboards, ledgers, and traces report runtime by agent, by role, and by fallback path

### 7. Capability-Based Volunteer Roles

Extend fixed roles with optional capability-based volunteering.

Why this is useful:

- the blackboard papers show that rigid controller knowledge does not scale well
- the current wave format already supports multiple roles; capability tags make routing smarter without removing explicit ownership

Wave file addition:

- optional `### Capabilities`

Examples:

- `integration`
- `docs-shared-plan`
- `infra-k8s`
- `deploy-railway`
- `schema-migration`
- `frontend-validation`

Use:

- requests can target a named agent or a capability class
- the launcher can assign the next step to the least-busy matching agent or a configured preferred role

### 8. Orchestrator-First Clarification And Feedback Triage

Put the orchestrator, not the human, on the first line for unresolved questions.

Why:

- the current feedback queue is useful but separate from the main shared workspace
- autonomous mode currently treats pending feedback as a blocking condition rather than as a triage problem the harness should try to solve
- many requests can be resolved from repository guidance, ownership rules, prior wave decisions, or current coordination state without asking a human

Clarification ladder:

1. the agent checks its inbox, ledger, coordination store, owned files, and repo guidance
2. if still blocked, it emits a typed `clarification-request`
3. the orchestrator triages the request and either:
   - answers directly with `orchestrator-guidance`
   - routes it to another agent as a targeted request
   - resolves it from existing policy or prior decisions
   - escalates to a human when external intent is truly missing
4. only unresolved product, policy, safety, or externally-owned decisions become human tickets

Proposed record kinds:

- `clarification-request`
- `orchestrator-guidance`
- `resolved-by-policy`
- `human-escalation`
- `human-feedback`

Proposed artifacts:

- `.tmp/<lane>-wave-launcher/feedback/triage/wave-<n>.jsonl`
- `.tmp/<lane>-wave-launcher/feedback/triage/wave-<n>/pending-human.md`

Escalation policy:

- escalate only for missing business intent, conflicting top-level instructions, security or compliance ambiguity, external-system risk, or repeated failed orchestrator resolution attempts
- autonomous mode should drain orchestrator-resolvable clarification items before refusing to continue
- answered human feedback should be written back into the coordination store and wave ledger so the same question is not asked twice

### 9. Reproducible Harness Traces

The base trace-and-replay layer is now shipped. The remaining work is operator-facing replay tooling and larger continuous-history scenario sets.

Why this is mandatory:

- VeRO and EvoClaw both argue that long-running agent systems need reproducible traces and continuous-history evaluation
- without this, harness changes are anecdotal

Current per-attempt trace bundle:

- wave file hash
- prompt fingerprints
- compiled inboxes
- coordination store snapshot
- structured markers from logs
- exit contract outcomes
- integration summary
- evaluator verdict
- docs closure state
- runtime budgets and retries
- cumulative quality metrics
- gate snapshot and artifact-presence metadata
- replay context and cumulative history snapshot for hermetic replay

Artifact:

- `.tmp/<lane>-wave-launcher/traces/wave-<n>/attempt-<k>/`

Current contract:

- dry-run remains pre-attempt only and should not create `attempt-<k>` snapshots
- `traceVersion: 2` bundles are hermetic and replayable in isolation
- replay is read-only and revalidates recorded artifact hashes
- launched agents carry copied summary artifacts, and promoted-component waves carry the copied component matrix JSON
- legacy `traceVersion: 1` bundles remain best-effort with explicit warnings
- replay validation is internal today, not a public CLI

## Upgraded Architecture

### Current Model

Current flow, simplified:

1. Parse wave file.
2. Launch one session per agent.
3. Ask all agents to coordinate on a markdown board.
4. Parse logs and structured markers.
5. Run documentation closure and evaluator closure.

This is workable, but it leaves five gaps:

- communication is mostly free-text
- integration is implicit
- runtime planning is still too lane-default and not expressive enough for deliberate mixed-runtime teams
- clarification escalates too early to a human queue
- scheduling is not strongly driven by shared state

### Proposed Model

Upgraded flow, still wave- and lane-native:

1. Parse the wave file into the manifest, runtime plan, and wave ledger.
2. Resolve executor profiles, fallback policy, and runtime-mix targets for the lane.
3. Build or update the canonical coordination store.
4. Compile the shared summary and per-agent inboxes.
5. Launch implementation, infra, deploy, docs, research, or evaluation roles based on the ledger, runtime plan, and open requests.
6. Let the orchestrator triage clarification requests and resolve or route them before escalating to a human.
7. Continuously ingest structured outputs into the coordination store and ledger.
8. Run a dedicated integration phase to synthesize all claims and remaining gaps.
9. Run documentation closure using the integration summary.
10. Run evaluator closure using the integration summary plus final doc state.
11. Persist the attempt trace bundle for replay and evaluation.

## Recommended Role Model

This role model works with the current multi-role architecture and extends it rather than replacing it:

- `A0` evaluator
- `A8` integration steward
- `A9` documentation steward
- implementation roles, each owning explicit files and components
- optional infra role for identity, admission, machine conformance, or deployment substrates
- optional deploy verifier role for rollout, health, and operational proof

Responsibilities:

- implementation roles produce code, proofs, and doc deltas
- infra/deploy roles produce structured environment proof
- integration steward synthesizes cross-role state
- documentation steward reconciles shared docs and component matrix
- evaluator decides whether the wave is coherent enough to pass

## Runtime Planning And Lane Mix

Wave orchestration should support a deliberate runtime mix inside one lane. A lane can run `3 codex`, `2 claude`, and `2 opencode` agents as long as the wave declares which agent prefers which runtime and what fallbacks are allowed.

Recommended starting mapping for this repo:

- implementation and test-fix roles: `codex`
- integration steward, evaluator, and documentation steward: `claude`
- exploratory helper, research, and CLI-heavy ops roles: `opencode`
- infra and deploy roles: choose `codex` or `opencode` based on the command workflow and tooling needs, not by habit

Planning rules:

- every agent in a deliberate mixed-runtime wave should declare `### Executor`
- runtime reassignment during execution must preserve ownership and leave an audit record
- runtime profiles should capture the common presets such as `implement-fast`, `deep-review`, `docs-pass`, and `ops-triage`
- integration summaries should report the final runtime used by each agent and whether any fallback fired

This keeps runtime choice visible in the authored plan instead of hiding it inside CLI defaults.

## Lanes And Cross-Lane Coordination

Lanes should remain isolated in execution state but gain typed cross-lane dependency tickets.

Current strength:

- lane-scoped paths already exist
- an orchestrator board already exists

Upgrade:

- add `.tmp/wave-orchestrator/dependencies/<lane>.jsonl`
- each cross-lane dependency is a typed ticket with owner lane, requester lane, closure condition, and related waves
- lane autonomous mode should refuse to finalize if it has unresolved required inbound dependencies

This keeps lane isolation while making cross-lane work explicit and schedulable.

## Documentation Upgrades

The current documentation steward role is good, but it is overloaded.

Improve it by adding:

- doc delta extraction from implementation markers into a machine-readable queue
- explicit shared-plan reconciliation checklist
- component-matrix reconciliation checklist
- release-notes or changelog queue when a wave changes public package behavior
- a per-wave runtime assignment summary so doc and eval roles can see which runtime owned which artifacts

Documentation should consume integration outputs, not rediscover them from raw logs.

## Evaluation Upgrades

The harness should move from “wave passed or failed” to “wave quality is replayable and comparable.”

Add:

- per-wave regression datasets
- replayable trace bundles
- scoring for communication health, integration quality, and proof quality
- continuous-history benchmark scenarios, not only single-wave success
- runtime-mix reporting so success can be segmented by executor and by role
- clarification reporting so orchestrator-resolved questions and human escalations are both measurable

Suggested metrics:

- unresolved request count at closure
- integration contradiction count
- documentation drift count
- proof completeness ratio
- relaunch count by role
- relaunch count by executor
- runtime fallback rate
- mean time to first acknowledgement
- mean time to blocker resolution
- orchestrator clarification resolution rate
- human escalation rate
- evaluator reversal rate between early and final verdicts

## Infra And DevOps Upgrades

The harness already has structured deploy and infra markers. The next step is to make them durable and wave-aware.

Add:

- infra proof records into the coordination store and ledger
- deploy readiness and deploy verification as separate states
- environment baseline checks at wave start
- executor binary, credential, and profile availability checks for every runtime referenced by the wave
- required rollback or recovery guidance for waves that touch live systems

For infra- or deploy-heavy lanes, the integration steward should treat infra proof as first-class, not as a side detail in implementation logs.

## Prioritized Delivery Order

### Phase 1: Coordination And Planning Foundation

- canonical coordination store
- markdown board as rendered view
- per-agent inbox compiler
- full per-agent `### Executor` schema with runtime profiles
- typed clarification and human-feedback events

Why first:

- every other improvement depends on better shared state, a durable runtime plan, and a typed clarification model

### Phase 2: Integration And Scheduling

- integration steward role
- integration summary artifacts
- communication-aware relaunch and closure rules
- orchestrator-first clarification resolver
- wave ledger

Why second:

- this closes the communication-reasoning gap and the too-early human escalation loop without changing the authored wave format

### Phase 3: Evaluation And Replay

- shipped:
  - trace bundles
  - cumulative wave quality metrics
  - runtime-mix and clarification metrics
  - internal replay validation against stored attempt bundles
  - launcher-generated replay acceptance coverage for hermetic pass, clarification, blocking, and retry/fallback traces
- still open:
  - larger continuous-history replay scenario sets across more than one wave
  - a public replay CLI if the internal helper proves stable

Why third:

- once state and flow are structured, evaluation becomes meaningful

### Phase 4: Capability Routing And Cross-Lane Dependencies

- shipped:
  - capability tags
  - deterministic helper-assignment routing from open requests
  - helper-assignment snapshots under `.tmp/<lane>-wave-launcher/assignments/`
  - typed `wave dep post|show|resolve|render` operator workflows
  - per-wave inbound/outbound dependency snapshots under `.tmp/<lane>-wave-launcher/dependencies/`
  - dependency-aware gating, inboxes, dashboards, and trace/replay artifacts
- still open:
  - larger multi-lane benchmark scenarios that stress dependency resolution across more than one wave
  - richer dependency-specific operator dashboards if the current JSON and markdown projections prove insufficient

Why fourth:

- this only became high leverage once the coordination, integration, and replay layers were already trustworthy

## Immediate Recommendation

The highest-value near-term upgrade is:

1. canonical coordination store
2. compiled agent inboxes
3. explicit integration steward and integration summary
4. full planning-time runtime profiles in `### Executor`
5. orchestrator-first clarification triage

That combination gives the harness the biggest improvement in:

- long-running robustness
- intra-agent messaging quality
- mixed-runtime planning quality
- reduced unnecessary human interruption
- closure reliability
- lane and multi-role scalability

without forcing a rewrite of wave files, lane structure, or existing proof markers.

## Source References

The canonical source list now lives at the bottom of [README.md](../../README.md). Keep the committed source manifest in [docs/research/agent-context-sources.md](./research/agent-context-sources.md) and keep hydrated caches local-only.
