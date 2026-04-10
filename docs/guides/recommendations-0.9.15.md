# Recommendations for 0.9.15

## Upgrade

```bash
wave self-update
# or: npm install -g @chllming/wave-orchestration@0.9.15
```

## What changed

### Marker parsing is more forgiving, proof standards are not

Agents sometimes emit `state=complete` instead of `state=met` in `[wave-proof]` and `[wave-component]` markers. Wave now accepts that alias and normalizes it to the existing `met` semantics.

Practical effect:

- natural completion phrasing no longer breaks proof parsing
- proof standards stay the same because the normalized state still means `met`
- operators can keep asking for machine-visible final markers without retraining every agent prompt immediately

### Signal parsing is now normalized behind one path

Implementation closure now normalizes wrapped, fenced, list-prefixed, and JSON-embedded marker output through one parser instead of relying on a narrower mix of ad hoc extraction paths.

Practical effect:

- wrappers and coding agents have more room to emit markers in realistic output shapes
- diagnostics are better when markers are seen but rejected
- the closure contract is still strict because missing or malformed markers remain visible as machine-classified failures

### Restart-safe validation matters more than stale matrices

Historical completed waves can promote a component to an older level than the matrix's current level after later waves advanced it further. On restart, the launcher now consults both `run-state.json` and status-recoverable completions before stale promotion checks.

Practical effect:

- resumed launches stop reopening already completed historical waves
- component-matrix validation stays strict for active or genuinely incomplete work
- targeted recovery remains the right tool when only one later slice actually needs attention

### Concurrent detached runners need unique broker identity

When detached runners broker provider credentials, each agent now gets a unique default `LPM_AUTH_STICKY_KEY`. Explicit overrides still win.

Practical effect:

- same-node agents can lease credentials concurrently without trampling one shared sticky key
- local policy can still provide an explicit sticky key when a deployment needs custom routing
- retry or resume flows stay deterministic because the default key now scopes down to one agent attempt

### Transport-only closure failures can pause for adjudication before rerun

When implementation closure has exit `0`, landed artifacts, and a valid result envelope but the final machine markers are malformed, Wave can now hold the slice in deterministic adjudication instead of immediately relaunching it. Fully missing required markers still fail closure until the agent emits them or a narrower rerun lands them.

Practical effect:

- transport-only proof failures stop looking identical to real semantic regressions
- operators can inspect the recorded adjudication artifact with `wave control adjudication get`
- targeted rerun stays reserved for semantic, artifact, or runtime-state failures that actually need more work

### Control status is now split into execution, closure, and controller intent

`wave control status --json` now reports additive `executionState`, `closureState`, and `controllerState` fields, with matching per-agent execution and closure projections.

Practical effect:

- live execution is no longer conflated with blocked closure
- stale relaunch plans are visible without masquerading as active runtime work
- operators can make better decisions about whether to wait, adjudicate, or rerun

## Recommendations

- **Proof markers**: keep requiring explicit final markers, but accept `complete` as an operationally harmless alias while normalizing downstream state to `met`.
- **Signal helpers**: prefer `wave signal ...` instead of hand-typing marker syntax in orchestrator prompts, shell wrappers, or local helper scripts. The helper now fails fast when a value would not round-trip through the shipped parser.
- **Restart recovery**: prefer status-backed restart and targeted recovery over reauthoring older completed waves just because the component matrix has since moved on.
- **Credential brokering**: let the detached runner use its per-agent sticky-key default unless you have a clear external reason to override it.
- **Status interpretation**: read `executionState`, `closureState`, and `controllerState` together when deciding whether a wave is actively running, blocked only in closure, or merely carrying stale controller intent.
- **Closure adjudication**: treat `awaiting-adjudication` as distinct from both success and rerun-needed. Inspect the persisted evidence first; do not auto-relaunch transport-only failures by habit.
- **Canonical signals**: prefer `wave signal ...` when wrappers or custom prompts need to emit final markers. It keeps marker syntax canonical and avoids accidental format drift.
- **Budgets**: keep using `budget.minutes` as the main wall-clock budget. Keep generic `budget.turns` advisory unless you deliberately need a runtime-specific hard ceiling.
- **Coordination severity**: continue to use `mark-advisory`, `mark-stale`, and `resolve-policy` for follow-up that should stay visible without falsely reopening proof-critical closure.
- **Targeted recovery**: prefer targeted recovery when one slice regresses or a restart left run-state behind. The most useful recovery work is still narrow and machine-visible.
