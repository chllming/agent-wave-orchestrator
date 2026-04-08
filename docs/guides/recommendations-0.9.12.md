# Recommendations for 0.9.12

## Upgrade

```bash
wave self-update
# or: npm install -g @chllming/wave-orchestration@0.9.12
```

## What changed

### Low-entropy closure is now explicit

Bootstrap closure keeps its fast path, but it is now constrained to the cases where closure actually stayed lightweight. If semantic closure stewards already ran, the launcher no longer skips a missing `cont-QA` run as if nothing meaningful happened.

Practical effect:

- low-entropy bootstrap waves still avoid unnecessary closeout churn
- waves that escalated into real semantic closure work now keep the stronger closeout contract
- closure metadata and mode resolution now agree about when bootstrap behavior applies

### TMUX is optional, not the execution backend

The packaged docs, setup flow, and launcher help now all say the same thing:

- live agents run as detached processes
- `vscode` and `tmux` only change the operator-facing dashboard or projection surface
- `tmux` matters only when you actually want terminal-native dashboard attach

If you launch with `--terminal-surface tmux --no-dashboard`, Wave now prints an explicit note that TMUX is optional in that shape.

### Wave Control dashboard-first UI

The shipped `wave-control-web` surface is now organized around:

- `Dashboard`
- `Operations`
- `Access`
- `Account`

Operators get a cleaner summary-first landing page, better access-review routing, and richer benchmark or run analytics without hunting across flat tabs.

## Recommendations

- **Closure policy**: keep the bootstrap fast path for genuinely low-entropy work, but do not treat it as a general excuse to skip `cont-QA` after integration or documentation stewards already had to intervene.
- **Operator surfaces**: choose `vscode` or `tmux` based on where you want to follow logs and dashboards. Do not encode TMUX as if it were required for live execution.
- **Budgets**: keep using `budget.minutes` as the main wall-clock budget. Keep generic `budget.turns` advisory unless you deliberately need a runtime-specific hard ceiling.
- **Coordination severity**: continue to use `mark-advisory`, `mark-stale`, and `resolve-policy` for follow-up that should stay visible without falsely reopening proof-critical closure.
- **Targeted recovery**: prefer targeted recovery when one slice regresses. The lower-entropy closure path is most useful when the remaining work is genuinely narrow and machine-visible.
