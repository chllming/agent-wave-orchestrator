---
title: "CLI Reference"
summary: "Complete syntax reference for all wave CLI commands, flags, and operator surfaces."
---

# CLI Reference

Complete syntax for every `wave` command. All commands use `pnpm exec wave` as the entry point.

When a command targets lane-scoped runtime state, it also accepts `--project <id>`. Omit it to use `defaultProject` from `wave.config.json`.

## Command Families

- Runtime:
  `wave launch`, `wave autonomous`, and `wave local` cover dry-run validation, live execution, and executor-specific prompt transport.
- Sandbox async supervision:
  `wave submit`, `wave supervise`, `wave status`, `wave wait`, and `wave attach` provide the sandbox-friendly submit-and-observe surface for long-running waves.
- Operator control:
  `wave control` is the preferred surface for live status, tasks, reruns, proof bundles, and telemetry.
- Compatibility and inspection:
  `wave coord`, `wave retry`, and `wave proof` remain available where older runbooks still depend on them.
- Planning and transient work:
  `wave project`, `wave draft`, and `wave adhoc` cover defaults, authored waves, and operator-driven one-off runs.
- Setup and lifecycle:
  `wave init`, `wave doctor`, `wave upgrade`, and `wave self-update` cover workspace adoption, validation, and package upgrades.

## wave launch

Launch waves for execution.

```
wave launch [options]
```

Defaults below reflect the starter workspace surface in this repo. Lane config can override executor, timeout, retry, and terminal defaults.

Closure-role bindings do not have a CLI override surface. When a wave file declares custom integration, documentation, `cont-QA`, `cont-EVAL`, or security-review role ids, launch, retry, reducer, and closure flows honor those wave-level bindings end to end.

| Flag | Default | Description |
|------|---------|-------------|
| `--project <id>` | config default | Project id |
| `--lane <name>` | `main` | Lane name |
| `--start-wave <n>` | `0` | First wave to launch |
| `--end-wave <n>` | last available | Last wave to launch |
| `--auto-next` | off | Start from next unfinished wave and continue |
| `--resume-control-state` | off | Preserve the prior auto-generated relaunch plan instead of treating the launch as a fresh wave start |
| `--executor <id>` | `codex` | Default executor: `codex`, `claude`, `opencode`, `local` |
| `--codex-sandbox <mode>` | lane config | Codex sandbox isolation override; falls back to `danger-full-access` only when config is unset |
| `--timeout-minutes <n>` | `240` | Max minutes to wait per wave |
| `--max-retries-per-wave <n>` | `1` | Relaunch failed agents per wave |
| `--agent-rate-limit-retries <n>` | `2` | Per-agent retries for 429 errors |
| `--agent-rate-limit-base-delay-seconds <n>` | `20` | Base exponential backoff for 429 |
| `--agent-rate-limit-max-delay-seconds <n>` | `180` | Max backoff delay for 429 |
| `--agent-launch-stagger-ms <n>` | `1200` | Delay between agent launches |
| `--terminal-surface <mode>` | `vscode` | `tmux`, `vscode`, or `none` |
| `--no-dashboard` | off | Disable the per-wave dashboard projection session |
| `--cleanup-sessions` | on | Clean up lane tmux dashboard and projection sessions after each wave |
| `--keep-sessions` | off | Keep lane tmux dashboard and projection sessions |
| `--keep-terminals` | off | Keep temporary terminal entries |
| `--orchestrator-id <id>` | generated | Stable orchestrator identity |
| `--orchestrator-board <path>` | default board path | Write coordination-board updates to a specific shared board |
| `--no-orchestrator-board` | off | Disable shared orchestrator-board writes for this run |
| `--coordination-note <text>` | empty | Append a startup intent note to orchestrator-board updates |
| `--resident-orchestrator` | off | Launch long-running non-owning orchestrator session |
| `--no-telemetry` | off | Disable Wave Control event publication |
| `--no-context7` | off | Disable Context7 prefetch |
| `--dry-run` | off | Parse and validate only; do not execute |
| `--reconcile-status` | off | Reconcile run-state from status files and exit |
| `--state-file <path>` | default | Path to run-state JSON |
| `--manifest-out <path>` | default | Write parsed manifest JSON |

## wave autonomous

Continuous wave execution without manual wave-by-wave invocation.

```
wave autonomous [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--project <id>` | config default | Project id |
| `--lane <name>` | `main` | Lane name |
| `--executor <id>` | lane config | `codex`, `claude`, or `opencode` (not `local`) |
| `--codex-sandbox <mode>` | lane config | Codex sandbox override passed to launcher; falls back to `danger-full-access` only when config is unset |
| `--timeout-minutes <n>` | `240` | Per-wave timeout passed to launcher |
| `--max-retries-per-wave <n>` | `1` | Per-wave relaunches inside launcher |
| `--max-attempts-per-wave <n>` | `1` | External attempts per wave |
| `--agent-rate-limit-retries <n>` | `2` | Per-agent 429 retries |
| `--agent-rate-limit-base-delay-seconds <n>` | `20` | Base 429 backoff |
| `--agent-rate-limit-max-delay-seconds <n>` | `180` | Max 429 backoff |
| `--agent-launch-stagger-ms <n>` | `1200` | Delay between agent launches |
| `--orchestrator-id <id>` | `<lane>-autonomous` | Orchestrator identity |
| `--resident-orchestrator` | off | Launch resident orchestrator for each wave |
| `--dashboard` | off | Enable dashboards |
| `--keep-sessions` | off | Keep tmux dashboard and projection sessions between waves |
| `--keep-terminals` | off | Keep terminal entries between waves |

When you run Wave in a sandbox with short-lived `exec` sessions, prefer the async supervisor surface instead of binding the whole run to one long-lived `wave autonomous` client process. The end-state sandbox model is documented in [../plans/sandbox-end-state-architecture.md](../plans/sandbox-end-state-architecture.md).

## wave submit

Submit a launcher request for daemon-owned execution and return quickly with a `runId`.

``` 
wave submit [launcher options] [--json]
```

Current implementation status: this is a file-backed wrapper over `wave-launcher.mjs` with daemon leases, exact-context lookup, launcher-status reconciliation, progress journaling, and process-backed agent execution. It is the preferred sandbox-facing entrypoint for LEAPclaw, OpenClaw, Nemoshell, Docker, and similar short-lived exec environments, even though the broader daemon convergence described in [../plans/sandbox-end-state-architecture.md](../plans/sandbox-end-state-architecture.md) is still conservative in some recovery paths.

`wave submit` accepts the same launcher options you would pass to `wave launch`, for example `--project`, `--lane`, `--start-wave`, `--end-wave`, `--executor`, `--codex-sandbox`, `--timeout-minutes`, `--agent-launch-stagger-ms`, `--resident-orchestrator`, `--no-dashboard`, and `--dry-run`. Use `--json` when you want a structured payload containing `runId`, `project`, `lane`, optional `adhocRunId`, and `statePath`.

For concrete setup guidance, read [../guides/sandboxed-environments.md](../guides/sandboxed-environments.md).

## wave supervise

Run the supervisor loop that claims queued submitted runs and reconciles launcher status.

```
wave supervise [--project <id>] [--lane <name>] [--once]
```

Use `--once` for a single reconciliation pass in tests or wrapper scripts. The shipped daemon now renews a lease, reconciles detached launcher status, and can adopt already-running submitted runs from the same lane-scoped supervisor root.

## wave status

Read the current supervisor-owned state for a submitted run.

```
wave status --run-id <id> --project <id> --lane <name> [--adhoc-run <id>] [--json]
```

Current implementation status: reads the thin file-backed supervisor state from the exact lane-scoped supervisor root. `--project` and `--lane` are required so status does not guess across unrelated state trees.

## wave wait

Wait for a submitted run to reach terminal state or until the wait timeout expires.

```
wave wait --run-id <id> --project <id> --lane <name> [--adhoc-run <id>] [--timeout-seconds <n>] [--json]
```

`wave wait` is observational only. Timing out does not cancel or kill the underlying run.

## wave attach

Attach to a projection for a submitted run.

```
wave attach --run-id <id> --project <id> --lane <name> [--adhoc-run <id>] (--agent <id> | --dashboard)
```

`--agent <id>` attaches to a live session only when the runtime record explicitly exposes one; otherwise it follows the recorded log, or prints the recent log tail if the agent is already terminal. `--dashboard` reuses the current lane dashboard attach surface and falls back to the last written dashboard file when no live dashboard session exists. Missing projections are treated as operator errors, not as run-health failures.

## wave control

Unified operator control surface. Preferred over legacy `wave coord`, `wave retry`, and `wave proof`.

### wave control status

Read-only view: blocking edges, logical agent state, tasks, dependencies, rerun intent, proof bundles, next timers, and derived wave or agent signal snapshots.

When a launcher attempt is already running, `wave control status` treats that active attempt as the authoritative current fan-out. Older relaunch plans or unrelated closure blockers remain visible in the payload, but they do not override the live attempt view.

```
wave control status --project <id> --lane <lane> --wave <n> [--agent <id>] [--run <id>] [--json]
```

The JSON payload now includes:

- `signals.wave`
  Versioned wave-level signal state for wrappers and external operators.
- `signals.agents`
  Versioned per-agent signal state, including `shouldWake` plus any observed ack metadata.
- `supervisor`
  The most relevant lane-scoped supervisor run for this wave, including degraded states such as `launcher-lost-agents-running`, recovery fields such as `sessionBackend`, `recoveryState`, and `resumeAction`, plus any recorded per-agent runtime summary.
- `forwardedClosureGaps`
  Earliest-first forwarded `wave-proof-gap` records from the relaunch plan, including the stage key, originating agent, attempt, detail, and downstream closure targets.

Starter repos also include `scripts/wave-status.sh` and `scripts/wave-watch.sh` as thin readers over this JSON payload. They use exit `0` for completed, `20` for input-required, `40` for failed, and `30` from `wave-watch.sh --until-change` when the signal changed but the wave stayed active. For the full wrapper contract, read [../guides/signal-wrappers.md](../guides/signal-wrappers.md).

### wave control telemetry

Inspect and deliver the local Wave Control event queue.

```
wave control telemetry status --project <id> --lane <lane> [--run <id>] [--json]
wave control telemetry flush  --project <id> --lane <lane> [--run <id>] [--json]
```

### wave control task

Operator task surface for coordination records.

**Create a task:**

```
wave control task create \
  --project <id> --lane <lane> --wave <n> --agent <id> \
  --kind <kind> --summary "<text>" \
  [--detail "<text>"] [--target <agent-or-capability>] \
  [--priority normal|high] [--blocking true|false] \
  [--severity hard|soft|stale|advisory|proof-critical|closure-critical] \
  [--depends-on <id>] \
  [--artifact <ref>] [--operator <name>] [--json]
```

Valid `--kind` values: `request`, `blocker`, `clarification`, `handoff`, `evidence`, `claim`, `decision`, `human-input`.

`wave control status` only treats `request`, `blocker`, `clarification`, `human-input`, and `escalation` as potentially blocking. Tasks of those kinds can still be downgraded with `blocking=false` or non-blocking severities such as `advisory` and `stale`, so they remain visible without owning the active blocking edge.

**List tasks:**

```
wave control task list --project <id> --lane <lane> --wave <n> [--agent <id>] [--json]
```

**Get a single task:**

```
wave control task get --project <id> --lane <lane> --wave <n> --id <task-id> [--json]
```

**Act on a task:**

```
wave control task act <action> \
  --project <id> --lane <lane> --wave <n> --id <task-id> \
  [--detail "<text>"] [--operator <name>] [--json]
```

Actions:

| Action | Extra flags | Effect |
|--------|------------|--------|
| `start` | — | Mark task in-progress |
| `resolve` | `[--detail]` | Close the task as resolved |
| `dismiss` | `[--detail]` | Close the task as not applicable |
| `cancel` | `[--detail]` | Cancel the task |
| `reassign` | `--to <agent>` | Supersede the original, reroute to a new agent |
| `answer` | `--response "<text>"` | Answer a human-input or escalation task |
| `escalate` | `[--detail]` | Escalate to human feedback queue |
| `defer` | `[--detail]` | Keep the task open but mark it non-blocking soft work |
| `mark-advisory` | `[--detail]` | Keep the task visible but non-blocking with advisory severity |
| `mark-stale` | `[--detail]` | Keep the task as historical context without blocking closure |
| `resolve-policy` | `[--detail]` | Close the task by operator policy and downgrade linked clarification follow-up when applicable |

**Operator answer example** (responding to a human-input escalation):

```bash
pnpm exec wave control task act answer \
  --project app --lane main --wave 4 --id escalation-clarify-a7-rollout \
  --response "The rollout strategy is canary-then-full. Use the Railway MCP health endpoint." \
  --operator ops-lead
```

### wave control rerun

Targeted rerun intent with agent selection, reuse control, and component invalidation.

**Request a rerun:**

```
wave control rerun request \
  --project <id> --lane <lane> --wave <n> \
  [--agent <id> ...] \
  [--clear-reuse <id> ...] [--preserve-reuse <id> ...] \
  [--invalidate-component <id> ...] \
  [--resume-cursor <cursor>] \
  [--reuse-attempt <id> ...] [--reuse-proof <id> ...] \
  [--reuse-derived-summaries true|false] \
  [--requested-by <name>] [--reason "<text>"] [--json]
```

`--agent` is repeatable or comma-separated. At least one of `--agent` or `--resume-cursor` is required.

The launcher may also write a rerun request automatically after recoverable failures such as timeout, max-turn, rate-limit, or missing-status outcomes. Those requests still appear through `wave control rerun get`, so operators can inspect or replace the targeted recovery plan before the next attempt.

**Get active rerun request:**

```
wave control rerun get --project <id> --lane <lane> --wave <n> [--json]
```

**Clear rerun request:**

```
wave control rerun clear --project <id> --lane <lane> --wave <n>
```

### wave control proof

Authoritative proof bundle lifecycle (active → superseded → revoked).

**Register a proof bundle:**

```
wave control proof register \
  --project <id> --lane <lane> --wave <n> --agent <id> \
  --artifact <path> [--artifact <path> ...] \
  [--component <id[:level]> ...] \
  [--authoritative] [--satisfy-owned-components] \
  [--completion <level>] [--durability <level>] [--proof-level <level>] \
  [--doc-delta <state>] [--operator <name>] [--detail "<text>"] [--json]
```

**Get proof bundles:**

```
wave control proof get --project <id> --lane <lane> --wave <n> [--agent <id>] [--id <bundle-id>] [--json]
```

**Supersede a bundle** (register new evidence and mark the old bundle superseded):

```
wave control proof supersede \
  --project <id> --lane <lane> --wave <n> --id <old-bundle-id> \
  --agent <id> --artifact <path> [--artifact <path> ...] \
  [same options as register] [--json]
```

**Revoke a bundle:**

```
wave control proof revoke \
  --project <id> --lane <lane> --wave <n> --id <bundle-id> \
  [--operator <name>] [--detail "<text>"] [--json]
```

## wave coord

Coordination log access. Legacy surface; prefer `wave control task` for new work.

**Post a coordination record:**

```
wave coord post \
  --project <id> --lane <lane> --wave <n> --agent <id> \
  --kind <kind> --summary "<text>" \
  [--detail "<text>"] [--target <agent>] \
  [--priority normal|high] [--depends-on <id>] \
  [--artifact <ref>] [--status <status>] [--dry-run]
```

**Show materialized coordination state:**

```
wave coord show --project <id> --lane <lane> --wave <n> [--dry-run] [--json]
```

**Render markdown board from JSONL log:**

```
wave coord render --project <id> --lane <lane> --wave <n> [--dry-run]
```

**Compile shared summary and agent inbox:**

```
wave coord inbox --project <id> --lane <lane> --wave <n> --agent <id> [--dry-run]
```

**Explain why blocked or retrying:**

```
wave coord explain --project <id> --lane <lane> --wave <n> [--agent <id>] [--json]
```

**Act on a coordination record:**

```
wave coord act <operation> --project <id> --lane <lane> --wave <n> --id <id> [options]
```

| Operation | Extra flags | Effect |
|-----------|------------|--------|
| `resolve` | `[--detail]` | Resolve the record |
| `dismiss` | `[--detail]` | Dismiss the record |
| `reroute` | `--to <agent>` | Reroute to another agent |
| `reassign` | `--to <agent>` | Reassign to another agent |
| `escalate` | `[--detail]` | Escalate to human feedback |
| `answer-human` | `--response "<text>"` | Answer a human feedback request |

All `wave coord` subcommands accept `--run <id>` as a shorthand that sets the lane and wave to 0 for ad-hoc runs.

## wave feedback

Human feedback request queue. Final escalation layer after orchestrator-first triage.

**Create a feedback request:**

```
wave feedback ask \
  --project <id> --lane <lane> --wave <n> --agent <id> \
  --question "<text>" [--context "<text>"] \
  [--orchestrator-id <id>] [--wait] [--timeout-seconds <n>]
```

**Respond to a feedback request:**

```
wave feedback respond \
  [--run <id>] --id <request-id> --response "<text>" \
  [--operator <name>] [--force]
```

`--force` overrides a previously answered request.

When the answered request belongs to a live wave or ad-hoc run, `wave feedback respond` also reconciles the linked clarification, escalation, and helper-assignment state in canonical coordination. If no attempt is still running and the reducer can safely continue, it writes a one-shot continuation request instead of relaunching directly. Use `--run <id>` when answering an ad-hoc request so reconciliation targets the isolated ad-hoc state root.

**List feedback requests:**

```
wave feedback list [--project <id>] [--lane <lane>] [--wave <n>] [--agent <id>] [--pending] [--json]
```

**Watch for new requests:**

```
wave feedback watch [--project <id>] [--lane <lane>] [--wave <n>] [--agent <id>] [--pending] [--refresh-ms <n>]
```

**Show a single request:**

```
wave feedback show --id <request-id>
```

All `wave feedback` subcommands accept `--run <id>` for ad-hoc runs.

## wave dep

Cross-lane dependency management.

**Post a dependency ticket:**

```
wave dep post \
  --owner-project <id> --owner-lane <lane> --requester-project <id> --requester-lane <lane> \
  --owner-wave <n> --requester-wave <n> \
  --agent <id> --summary "<text>" \
  [--detail "<text>"] [--target <agent>] \
  [--artifact <ref>] [--priority normal|high] \
  [--closure-condition "<text>"] [--required] [--json]
```

`--required` means the dependency blocks autonomous launch and lane finalization.

**Show dependencies:**

```
wave dep show --project <id> --lane <lane> [--wave <n>] [--json]
```

**Resolve a dependency:**

```
wave dep resolve --project <id> --lane <lane> --id <id> --agent <id> [--detail "<text>"] [--status resolved|closed]
```

**Render dependency snapshot:**

```
wave dep render --project <id> --lane <lane> [--wave <n>] [--json]
```

## wave benchmark

Local and external benchmark execution.

**List local cases:**

```
wave benchmark list [--json]
```

**Show a case definition:**

```
wave benchmark show --case <id> [--json]
```

**Run local benchmark cases:**

```
wave benchmark run [--project <id>] [--lane <lane>] [--case <id>] [--family <id>] [--benchmark <id>] [--arm <id>] [--output-dir <path>] [--json]
```

**List external adapters:**

```
wave benchmark adapters [--json]
```

**External benchmark commands:**

```
wave benchmark external-list [--adapter <id>] [--json]
wave benchmark external-show --adapter <id> --manifest <path> [--json]
wave benchmark external-run --adapter <id> [--project <id>] [--lane <lane>] --manifest <path> [--arm <id>] [--model <id>] [options]
wave benchmark external-pilots [--project <id>] [--lane <lane>] [--json]
```

## wave retry

Legacy retry control. Prefer `wave control rerun`.

**Show active retry override:**

```
wave retry show --project <id> --lane <lane> --wave <n> [--json]
```

**Apply a retry override:**

```
wave retry apply --project <id> --lane <lane> --wave <n> \
  [--agent <id> ...] \
  [--clear-reuse <id> ...] [--preserve-reuse <id> ...] \
  [--resume-phase <phase>] \
  [--requested-by <name>] [--reason "<text>"] [--json]
```

Requires either `--agent` or `--resume-phase`.

**Clear retry override:**

```
wave retry clear --project <id> --lane <lane> --wave <n>
```

## wave proof

Legacy proof registration. Prefer `wave control proof`.

**Show proof registry:**

```
wave proof show --project <id> --lane <lane> --wave <n> [--agent <id>] [--json]
```

**Register proof:**

```
wave proof register --project <id> --lane <lane> --wave <n> --agent <id> \
  --artifact <path> [--artifact <path> ...] \
  [--component <id[:level]> ...] \
  [--authoritative] [--satisfy-owned-components] \
  [--completion <level>] [--durability <level>] [--proof-level <level>] \
  [--doc-delta <state>] [--operator <name>] [--detail "<text>"] [--json]
```

## wave local

Smoke executor for testing prompt generation and closure signal extraction.

```
wave local --prompt <path> [--log <path>] [--status <path>]
```

## wave dashboard

Live dashboard viewer.

```
wave dashboard --dashboard-file <path> [--project <id>] [--lane <lane>] [--message-board <path>] [--watch] [--refresh-ms <n>]
wave dashboard --project <id> --lane <lane> --attach current|global
```

`wave dashboard --attach current|global` attaches to the live dashboard session when one exists; otherwise it follows the last written dashboard JSON for that target.

## Workspace Commands

**Initialize workspace:**

```
wave init [--adopt-existing]
```

**Upgrade workspace after package update:**

```
wave upgrade
```

**One-command package update:**

```
wave self-update
```

**Show changelog since installed version:**

```
wave changelog [--since-installed]
```

**Health check:**

```
wave doctor [--json]
```

## Planner Commands

**Setup project profile:**

```
wave project setup [--project <id>] [--json]
wave project show [--project <id>] [--json]
```

**Draft waves:**

```
wave draft --wave <n> [--project <id>] [--lane <lane>] [--template implementation|qa|infra|release]
wave draft --agentic --task "<description>" --from-wave <n> [--project <id>] [--lane <lane>]
wave draft --show-run <run-id>
wave draft --apply-run <run-id> [--project <id>]
```

Interactive draft currently offers worker role kinds:

- `design`
- `implementation`
- `qa`
- `infra`
- `deploy`
- `research`
- `security`

Agentic planner payloads also accept `workerAgents[].roleKind = "design"`. The shipped `0.9.12` surface uses `design-pass` as the default executor profile for that role and typically assigns a packet path like `docs/plans/waves/design/wave-<n>-<agentId>.md`. Interactive draft scaffolds the docs-first default; hybrid design stewards are authored by explicitly adding implementation-owned paths and the normal implementation contract sections.

## Ad-Hoc Task Commands

**Plan and run ad-hoc tasks:**

```
wave adhoc plan --task "<description>" [--project <id>] [--lane <lane>]
wave adhoc run --task "<description>" [--project <id>] [--lane <lane>] [--yes] [--executor <id>]
wave adhoc list [--project <id>] [--lane <lane>] [--json]
wave adhoc show --run <id> [--json]
wave adhoc promote --run <id> [--project <id>] --wave <n>
```

## Common Patterns

### Lane and wave targeting

Most coordination commands accept `--project` plus `--lane` (default lane: `main`) and `--wave` (required). For ad-hoc runs, use `--run <id>` which resolves the matching project and lane and defaults wave to 0.

### JSON output

Most commands accept `--json` for machine-readable output.

### Operator attribution

Commands that modify state accept `--operator <name>` (default: `human-operator`) for audit trails.

### Repeatable flags

Flags like `--agent`, `--artifact`, `--component`, `--target`, and `--depends-on` can be repeated or comma-separated:

```bash
# These are equivalent:
wave control rerun request --project app --lane main --wave 0 --agent A2 --agent A7
wave control rerun request --project app --lane main --wave 0 --agent A2,A7
```
