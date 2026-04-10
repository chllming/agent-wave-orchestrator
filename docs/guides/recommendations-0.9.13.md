# Recommendations for 0.9.13

## Upgrade

```bash
wave self-update
# or: npm install -g @chllming/wave-orchestration@0.9.13
```

## What changed

### Marker parsing is more forgiving, proof standards are not

Agents sometimes emit `state=complete` instead of `state=met` in `[wave-proof]` and `[wave-component]` markers. Wave now accepts that alias and normalizes it to the existing `met` semantics.

Practical effect:

- natural completion phrasing no longer breaks proof parsing
- proof standards stay the same because the normalized state still means `met`
- operators can keep asking for machine-visible final markers without retraining every agent prompt immediately

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

## Recommendations

- **Proof markers**: keep requiring explicit final markers, but accept `complete` as an operationally harmless alias while normalizing downstream state to `met`.
- **Restart recovery**: prefer status-backed restart and targeted recovery over reauthoring older completed waves just because the component matrix has since moved on.
- **Credential brokering**: let the detached runner use its per-agent sticky-key default unless you have a clear external reason to override it.
- **Budgets**: keep using `budget.minutes` as the main wall-clock budget. Keep generic `budget.turns` advisory unless you deliberately need a runtime-specific hard ceiling.
- **Coordination severity**: continue to use `mark-advisory`, `mark-stale`, and `resolve-policy` for follow-up that should stay visible without falsely reopening proof-critical closure.
- **Targeted recovery**: prefer targeted recovery when one slice regresses or a restart left run-state behind. The most useful recovery work is still narrow and machine-visible.
