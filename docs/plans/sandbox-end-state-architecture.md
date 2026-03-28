# Sandbox End-State Architecture

This document is the sandbox-runtime companion to [end-state-architecture.md](./end-state-architecture.md). The core architecture still applies: the canonical authority set remains wave definitions, the coordination log, and the control-plane event log. This page narrows that model to the execution environments that impose short-lived `exec` sessions, process ceilings, or terminal instability.

The goal is straightforward: sandbox client commands must stay short and disposable, while long-running wave ownership moves to a durable supervisor that can survive launcher exit, sandbox timeout, and terminal churn.

---

## Problem Statement

Sandboxed runtimes have failure modes that the generic architecture does not need to describe in detail:

- the sandbox `exec` session may have a wall-clock timeout that is much shorter than a real wave
- bursty `spawnSync` and `tmux` probes can hit `EAGAIN`, `EMFILE`, or related process pressure limits
- the launcher process can die before child agents finish, leaving orphaned sessions and ambiguous status
- a missing `tmux` session is not enough evidence that the actual agent process failed

The shipped runtime now has an initial async supervisor wrapper plus forwarded closure-gap handling, but it does not yet satisfy the full sandbox ownership model described here.

---

## Target Command Model

Sandbox-facing commands should follow an async submit/observe pattern:

- `wave submit [launcher options]`
  Validate the request, persist a run request, print a `runId`, and exit quickly.
- `wave supervise`
  Long-running daemon command that owns launch, monitoring, retry, adoption, and cleanup. This command is not intended to be bound to a short sandbox `exec` lifetime.
- `wave status --run-id <id>`
  Read canonical supervisor state for a run.
- `wave wait --run-id <id> --timeout-seconds <n>`
  Observe until a state change or timeout. Timing out never cancels the run.
- `wave attach --run-id <id>`
  Optional operator projection surface for `tmux` or another terminal UI. This is not a liveness authority.

Compatibility rules:

- `wave launch` remains the canonical full launcher surface for direct local execution and dry-run validation.
- `wave autonomous` must stop depending on one long blocking `spawnSync` call when it is used in sandbox-oriented flows.
- `wave submit`, `wave supervise`, `wave status`, and `wave wait` are the preferred sandbox-facing surface, even while some internals remain partial.

---

## Canonical Authority In Sandboxed Runs

The canonical authority set does not change, but sandbox supervision adds one more durable runtime layer:

- wave definitions remain authoritative for declared work, closure roles, proof artifacts, and task contracts
- coordination and control-plane logs remain authoritative for workflow, lifecycle, proof, and blocker state
- supervisor run state becomes the canonical record of daemon-owned runtime observation for a submitted run

The supervisor-owned state should converge on this per-run structure under `.tmp/<lane>-wave-launcher/supervisor/runs/<runId>/`:

- `request.json`
  Immutable submitted request.
- `state.json`
  Current daemon-owned run snapshot, including `runId`, `status`, `submittedAt`, `startedAt`, `completedAt`, `launcherPid`, `supervisorId`, `leaseExpiresAt`, `terminalDisposition`, and the latest observed launcher status.
- `events.jsonl`
  Supervisor-local observation history for adoption, retries, reconciliation, and cleanup decisions.
- `launcher-status.json`
  Canonical launcher completion status written atomically by the detached launcher wrapper.
- `launcher.log`
  Human-facing log stream only.
- `agents/<agentId>.runtime.json`
  Agent runtime observation record with fields such as `pid`, `pgid`, `attempt`, `startedAt`, `lastHeartbeatAt`, `exitCode`, `exitReason`, `statusPath`, and optional projection metadata like `tmuxSessionName`.

Authority rules:

- `tmux` is projection-only
- dashboards, summaries, inboxes, and board markdown remain projections only
- missing `tmux` state cannot by itself fail a run
- pid checks, heartbeats, and atomic status files outrank terminal presence for liveness

---

## Daemon Ownership, Adoption, And Process Control

The end state requires one daemon-owned control path for long-running work:

1. `wave submit` writes the request and exits.
2. `wave supervise` claims or renews a lease, launches work, and records observed runtime facts.
3. `wave status` and `wave wait` read canonical state only.
4. If the daemon dies, a later daemon instance can adopt active runs after lease expiry and continue observation without relaunching healthy agents.

The daemon must own:

- bounded process launch concurrency
- async retry with jittered backoff for `EAGAIN`, `EMFILE`, and `ENFILE`
- orphan adoption after stale lease detection
- conservative orphan cleanup only after lease expiry, stale heartbeat, and failed pid confirmation
- reconciliation between launcher status files, live pid state, and control-plane events

The daemon must not depend on:

- repeated `spawnSync("tmux", "list-sessions")` calls in the steady-state wait loop
- one sandbox client process staying alive for the full wave duration
- terminal presence as the source of truth for agent or wave health

---

## Closure Semantics For Forwarded Proof Gaps

Closure staging still runs in the normal order:

`implementation + proof -> cont-EVAL -> security/A7 -> integration/A8 -> docs/A9 -> cont-QA/A0`

Sandbox stability does not change closure authority, but the daemon must preserve one special case:

- `wave-proof-gap` from a closure-stage agent is a forwarded soft blocker, not an immediate full-wave stop

Forwarding rules:

- if A7 returns `wave-proof-gap`, the daemon still dispatches A8, A9, and A0 with the gap included as structured input
- if A8 returns `wave-proof-gap`, the daemon still dispatches A9 and A0
- if A9 returns `wave-proof-gap`, the daemon still dispatches A0
- later closure agents must evaluate the currently available artifacts and report what is true; they must not refuse to run only because an earlier closure-stage agent reported `wave-proof-gap`
- the final wave disposition remains blocked until the forwarded closure gaps are resolved

Non-forwardable closure failures remain hard stops. Examples include malformed outputs, missing proof envelopes, explicit integration blockers, or invalid marker formats.

---

## Current Implementation Status

Already landed:

- `wave submit`, `wave supervise`, `wave status`, and `wave wait` exist as a thin file-backed async wrapper over the existing launcher
- closure-stage `wave-proof-gap` forwarding now continues later closure stages and records the blocker instead of failing the whole sweep immediately

Still missing for the true end state:

- durable supervisor leases and heartbeat renewal across daemon restarts
- full adoption of active runs after daemon failure
- canonical `events.jsonl` supervisor history and explicit per-agent heartbeat state
- removal of `tmux` and `spawnSync` from the broader hot monitoring path
- retry invalidation from the earliest forwarded closure-gap stage
- a fully converged sandbox path where `wave autonomous` no longer binds multi-hour work to one blocking client command

---

## Remaining Gap Plan

1. Implement supervisor lease, heartbeat, and stale-lock reclamation so a restarted daemon can adopt active runs without relaunching healthy work.
2. Move liveness authority to pid, heartbeat, and atomic status files; keep `tmux` as projection-only and remove sync terminal probes from steady-state monitoring.
3. Materialize supervisor events and per-agent runtime records as canonical daemon state, not only ad hoc wrapper files.
4. Extend forwarded closure-gap handling into retry planning so the earliest forwarded gap invalidates later closure outputs for reuse while still preserving them for operator evidence.
5. Converge sandbox-facing entrypoints so `submit/status/wait` become the default operator path and `autonomous` no longer owns a multi-hour blocking launcher process.
