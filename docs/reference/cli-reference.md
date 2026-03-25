---
title: "CLI Reference"
summary: "Complete syntax reference for all wave CLI commands, flags, and operator surfaces."
---

# CLI Reference

Complete syntax for every `wave` command. All commands use `pnpm exec wave` as the entry point.

## Command Families

- Runtime:
  `wave launch`, `wave autonomous`, and `wave local` cover dry-run validation, live execution, and executor-specific prompt transport.
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
| `--lane <name>` | `main` | Lane name |
| `--start-wave <n>` | `0` | First wave to launch |
| `--end-wave <n>` | last available | Last wave to launch |
| `--auto-next` | off | Start from next unfinished wave and continue |
| `--resume-control-state` | off | Preserve the prior auto-generated relaunch plan instead of treating the launch as a fresh wave start |
| `--executor <id>` | `codex` | Default executor: `codex`, `claude`, `opencode`, `local` |
| `--codex-sandbox <mode>` | `danger-full-access` | Codex sandbox isolation level |
| `--timeout-minutes <n>` | `240` | Max minutes to wait per wave |
| `--max-retries-per-wave <n>` | `1` | Relaunch failed agents per wave |
| `--agent-rate-limit-retries <n>` | `2` | Per-agent retries for 429 errors |
| `--agent-rate-limit-base-delay-seconds <n>` | `20` | Base exponential backoff for 429 |
| `--agent-rate-limit-max-delay-seconds <n>` | `180` | Max backoff delay for 429 |
| `--agent-launch-stagger-ms <n>` | `1200` | Delay between agent launches |
| `--terminal-surface <mode>` | `vscode` | `tmux`, `vscode`, or `none` |
| `--no-dashboard` | off | Disable per-wave tmux dashboard |
| `--cleanup-sessions` | on | Kill lane tmux sessions after each wave |
| `--keep-sessions` | off | Keep lane tmux sessions |
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
| `--lane <name>` | `main` | Lane name |
| `--executor <id>` | lane config | `codex`, `claude`, or `opencode` (not `local`) |
| `--codex-sandbox <mode>` | `danger-full-access` | Codex sandbox mode |
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
| `--keep-sessions` | off | Keep tmux sessions between waves |
| `--keep-terminals` | off | Keep terminal entries between waves |

## wave control

Unified operator control surface. Preferred over legacy `wave coord`, `wave retry`, and `wave proof`.

### wave control status

Read-only view: blocking edges, logical agent state, tasks, dependencies, rerun intent, proof bundles, and next timers.

When a launcher attempt is already running, `wave control status` treats that active attempt as the authoritative current fan-out. Older relaunch plans or unrelated closure blockers remain visible in the payload, but they do not override the live attempt view.

```
wave control status --lane <lane> --wave <n> [--agent <id>] [--run <id>] [--json]
```

### wave control telemetry

Inspect and deliver the local Wave Control event queue.

```
wave control telemetry status --lane <lane> [--run <id>] [--json]
wave control telemetry flush  --lane <lane> [--run <id>] [--json]
```

### wave control task

Operator task surface for coordination records.

**Create a task:**

```
wave control task create \
  --lane <lane> --wave <n> --agent <id> \
  --kind <kind> --summary "<text>" \
  [--detail "<text>"] [--target <agent-or-capability>] \
  [--priority normal|high] [--depends-on <id>] \
  [--artifact <ref>] [--operator <name>] [--json]
```

Valid `--kind` values: `request`, `blocker`, `clarification`, `handoff`, `evidence`, `claim`, `decision`, `human-input`.

Only `request`, `blocker`, `clarification`, `human-input`, and `escalation` are treated as blocking edges by `wave control status`. The rest (`handoff`, `evidence`, `claim`, `decision`) are informational.

**List tasks:**

```
wave control task list --lane <lane> --wave <n> [--agent <id>] [--json]
```

**Get a single task:**

```
wave control task get --lane <lane> --wave <n> --id <task-id> [--json]
```

**Act on a task:**

```
wave control task act <action> \
  --lane <lane> --wave <n> --id <task-id> \
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

**Operator answer example** (responding to a human-input escalation):

```bash
pnpm exec wave control task act answer \
  --lane main --wave 4 --id escalation-clarify-a7-rollout \
  --response "The rollout strategy is canary-then-full. Use the Railway MCP health endpoint." \
  --operator ops-lead
```

### wave control rerun

Targeted rerun intent with agent selection, reuse control, and component invalidation.

**Request a rerun:**

```
wave control rerun request \
  --lane <lane> --wave <n> \
  [--agent <id> ...] \
  [--clear-reuse <id> ...] [--preserve-reuse <id> ...] \
  [--invalidate-component <id> ...] \
  [--resume-cursor <cursor>] \
  [--reuse-attempt <id> ...] [--reuse-proof <id> ...] \
  [--reuse-derived-summaries true|false] \
  [--requested-by <name>] [--reason "<text>"] [--json]
```

`--agent` is repeatable or comma-separated. At least one of `--agent` or `--resume-cursor` is required.

**Get active rerun request:**

```
wave control rerun get --lane <lane> --wave <n> [--json]
```

**Clear rerun request:**

```
wave control rerun clear --lane <lane> --wave <n>
```

### wave control proof

Authoritative proof bundle lifecycle (active → superseded → revoked).

**Register a proof bundle:**

```
wave control proof register \
  --lane <lane> --wave <n> --agent <id> \
  --artifact <path> [--artifact <path> ...] \
  [--component <id[:level]> ...] \
  [--authoritative] [--satisfy-owned-components] \
  [--completion <level>] [--durability <level>] [--proof-level <level>] \
  [--doc-delta <state>] [--operator <name>] [--detail "<text>"] [--json]
```

**Get proof bundles:**

```
wave control proof get --lane <lane> --wave <n> [--agent <id>] [--id <bundle-id>] [--json]
```

**Supersede a bundle** (register new evidence and mark the old bundle superseded):

```
wave control proof supersede \
  --lane <lane> --wave <n> --id <old-bundle-id> \
  --agent <id> --artifact <path> [--artifact <path> ...] \
  [same options as register] [--json]
```

**Revoke a bundle:**

```
wave control proof revoke \
  --lane <lane> --wave <n> --id <bundle-id> \
  [--operator <name>] [--detail "<text>"] [--json]
```

## wave coord

Coordination log access. Legacy surface; prefer `wave control task` for new work.

**Post a coordination record:**

```
wave coord post \
  --lane <lane> --wave <n> --agent <id> \
  --kind <kind> --summary "<text>" \
  [--detail "<text>"] [--target <agent>] \
  [--priority normal|high] [--depends-on <id>] \
  [--artifact <ref>] [--status <status>] [--dry-run]
```

**Show materialized coordination state:**

```
wave coord show --lane <lane> --wave <n> [--dry-run] [--json]
```

**Render markdown board from JSONL log:**

```
wave coord render --lane <lane> --wave <n> [--dry-run]
```

**Compile shared summary and agent inbox:**

```
wave coord inbox --lane <lane> --wave <n> --agent <id> [--dry-run]
```

**Explain why blocked or retrying:**

```
wave coord explain --lane <lane> --wave <n> [--agent <id>] [--json]
```

**Act on a coordination record:**

```
wave coord act <operation> --lane <lane> --wave <n> --id <id> [options]
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
  --lane <lane> --wave <n> --agent <id> \
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
wave feedback list [--lane <lane>] [--wave <n>] [--agent <id>] [--pending] [--json]
```

**Watch for new requests:**

```
wave feedback watch [--lane <lane>] [--wave <n>] [--agent <id>] [--pending] [--refresh-ms <n>]
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
  --owner-lane <lane> --requester-lane <lane> \
  --owner-wave <n> --requester-wave <n> \
  --agent <id> --summary "<text>" \
  [--detail "<text>"] [--target <agent>] \
  [--artifact <ref>] [--priority normal|high] \
  [--closure-condition "<text>"] [--required] [--json]
```

`--required` means the dependency blocks autonomous launch and lane finalization.

**Show dependencies:**

```
wave dep show --lane <lane> [--wave <n>] [--json]
```

**Resolve a dependency:**

```
wave dep resolve --lane <lane> --id <id> --agent <id> [--detail "<text>"] [--status resolved|closed]
```

**Render dependency snapshot:**

```
wave dep render --lane <lane> [--wave <n>] [--json]
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
wave benchmark run [--case <id>] [--family <id>] [--benchmark <id>] [--arm <id>] [--output-dir <path>] [--json]
```

**List external adapters:**

```
wave benchmark adapters [--json]
```

**External benchmark commands:**

```
wave benchmark external-list [--adapter <id>] [--json]
wave benchmark external-show --adapter <id> --manifest <path> [--json]
wave benchmark external-run --adapter <id> --manifest <path> [--arm <id>] [--model <id>] [options]
wave benchmark external-pilots --adapter <id> [--json]
```

## wave retry

Legacy retry control. Prefer `wave control rerun`.

**Show active retry override:**

```
wave retry show --lane <lane> --wave <n> [--json]
```

**Apply a retry override:**

```
wave retry apply --lane <lane> --wave <n> \
  [--agent <id> ...] \
  [--clear-reuse <id> ...] [--preserve-reuse <id> ...] \
  [--resume-phase <phase>] \
  [--requested-by <name>] [--reason "<text>"] [--json]
```

Requires either `--agent` or `--resume-phase`.

**Clear retry override:**

```
wave retry clear --lane <lane> --wave <n>
```

## wave proof

Legacy proof registration. Prefer `wave control proof`.

**Show proof registry:**

```
wave proof show --lane <lane> --wave <n> [--agent <id>] [--json]
```

**Register proof:**

```
wave proof register --lane <lane> --wave <n> --agent <id> \
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
wave dashboard --dashboard-file <path> [--lane <lane>] [--message-board <path>] [--watch] [--refresh-ms <n>]
wave dashboard --lane <lane> --attach current|global
```

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
wave project setup
wave project show [--json]
```

**Draft waves:**

```
wave draft --wave <n> [--template implementation|qa|infra|release]
wave draft --agentic --task "<description>" --from-wave <n>
wave draft --show-run <run-id>
wave draft --apply-run <run-id>
```

Interactive draft currently offers worker role kinds:

- `design`
- `implementation`
- `qa`
- `infra`
- `deploy`
- `research`
- `security`

Agentic planner payloads also accept `workerAgents[].roleKind = "design"`. The shipped `0.8.5` surface uses `design-pass` as the default executor profile for that role and typically assigns a packet path like `docs/plans/waves/design/wave-<n>-<agentId>.md`. Interactive draft scaffolds the docs-first default; hybrid design stewards are authored by explicitly adding implementation-owned paths and the normal implementation contract sections.

## Ad-Hoc Task Commands

**Plan and run ad-hoc tasks:**

```
wave adhoc plan --task "<description>"
wave adhoc run --task "<description>" [--yes] [--executor <id>]
wave adhoc list [--json]
wave adhoc show --run <id> [--json]
wave adhoc promote --run <id> --wave <n>
```

## Common Patterns

### Lane and wave targeting

Most coordination commands accept `--lane` (default: `main`) and `--wave` (required). For ad-hoc runs, use `--run <id>` which sets the lane and defaults wave to 0.

### JSON output

Most commands accept `--json` for machine-readable output.

### Operator attribution

Commands that modify state accept `--operator <name>` (default: `human-operator`) for audit trails.

### Repeatable flags

Flags like `--agent`, `--artifact`, `--component`, `--target`, and `--depends-on` can be repeated or comma-separated:

```bash
# These are equivalent:
wave control rerun request --lane main --wave 0 --agent A2 --agent A7
wave control rerun request --lane main --wave 0 --agent A2,A7
```
