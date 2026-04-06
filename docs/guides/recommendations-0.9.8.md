---
title: "0.9.8 Recommendations"
summary: "How to use 0.9.8's softer blocker states, advisory turn budgets, and targeted recovery without weakening proof and closure."
---

# 0.9.8 Recommendations

Use this guide when you are adopting `0.9.8` and want one practical operating stance for the softer blocker states, advisory turn-budget behavior, and targeted recovery flow that the current package line ships.

## Recommended Default

For most repos, the safest `0.9.8` default is:

- bound work with `budget.minutes`
- leave generic `budget.turns` as advisory metadata
- author non-proof follow-up as `soft`, `stale`, or `advisory` instead of silently treating every open record as a hard blocker
- use `resolve-policy` when the answer already exists in repo policy or shipped docs
- prefer targeted rerun or resume after timeout, max-turn, rate-limit, or missing-status outcomes instead of relaunching the whole wave
- in short-lived sandboxes, prefer `wave submit`, `wave supervise`, `wave status`, and `wave wait` instead of binding the full run to one client shell
- when a wave-gate dimension has a documented gap that is not an actionable blocker, use `gap` instead of `pass` or `blocked` — the runtime treats it as a conditional pass

That recommendation matches the runtime:

- executor launch metadata only emits hard turn-limit flags from `claude.maxTurns` or `opencode.steps`
- open `stale` and `advisory` coordination records stay visible without reopening the active blocking edge
- recoverable launcher failures queue targeted retry state instead of immediately escalating to broad terminal wave failure

## 1. Budgets

Treat the two budget knobs differently:

- `budget.minutes` is the primary attempt budget
- generic `budget.turns` is only a planning hint
- `claude.maxTurns` or `opencode.steps` are the hard runtime ceilings when you actually want deterministic turn stopping

Recommended pattern for synthesis-heavy implementation or closure work:

```json
{
  "executors": {
    "profiles": {
      "implementation-default": {
        "id": "claude",
        "model": "claude-sonnet-4-6",
        "budget": {
          "minutes": 35,
          "turns": 12
        }
      }
    }
  }
}
```

In that pattern, `35` minutes is real policy. `12` turns is only guidance for planning and preview metadata.

Only set a hard runtime ceiling when you deliberately want the runtime itself to stop:

```json
{
  "executors": {
    "profiles": {
      "bounded-closure": {
        "id": "claude",
        "model": "claude-sonnet-4-6",
        "budget": {
          "minutes": 20
        },
        "claude": {
          "maxTurns": 6
        }
      }
    }
  }
}
```

## 2. Softer Coordination States

`0.9.2` keeps “still visible” separate from “still blocking”.

Use these states intentionally:

| State | Use it for | What the runtime does |
| --- | --- | --- |
| `soft` | follow-up that still matters but should not be treated like proof failure | remains visible and may still drive repair or retry targeting |
| `stale` | outdated clarification or blocker context kept for history | visible in control state, but does not reopen blocking by itself |
| `advisory` | known issue, note, or human context that should stay visible without blocking closure | visible in control state, but does not own the active blocking edge |

Practical command paths:

```bash
pnpm exec wave control task act defer --lane main --wave 10 --id blocker-doc-follow-up
pnpm exec wave control task act mark-stale --lane main --wave 10 --id clarify-a7-rollout
pnpm exec wave control task act mark-advisory --lane main --wave 10 --id request-clarify-a7-rollout
pnpm exec wave control task act resolve-policy --lane main --wave 10 --id clarify-a7-rollout --detail "Policy already covered in the rollout guide."
```

Use them when the repo already knows the answer, the remaining item is informational, or the follow-up should stay visible for the next wave without holding the current wave hostage.

## 3. What Should Stay Hard

Do not relax everything.

Keep these hard or closure-critical unless you are intentionally changing wave policy:

- missing proof or required deliverables
- failed integration, documentation, or cont-QA closure gates
- real human-feedback or escalation requirements that block safe continuation
- requests or clarifications that still represent unresolved ownership or policy ambiguity for the current wave

Use `gap` in wave-gate markers when a dimension has a documented gap that is not actionable in the current wave. For example, `live=gap` is appropriate when an infrastructure topology constraint prevents full live validation but the constraint is known, documented, and does not represent a regression. Do not use `gap` to hide actual failures or unreviewed work.

If the current wave cannot truthfully close without the answer, keep it blocking.

## 4. Recovery Recommendation

My recommendation after reviewing the current `0.9.8` code path is:

- let timeout, max-turn, rate-limit, and missing-status failures go through the built-in targeted recovery path first
- inspect the queued rerun or resume request before manually relaunching the whole wave
- preserve reusable proof from successful sibling owners whenever the reducer already identified it as reusable

That is the shape the launcher now prefers. It only broadens failure when the remaining blockers are still proof-critical or otherwise non-recoverable.

## 5. Suggested Operator Policy

For most repo-owned runbooks:

- teach authors to use `budget.minutes` first
- teach operators to downgrade only non-proof follow-up
- treat `resolve-policy` as the preferred path when the answer already exists in docs or repo policy
- escalate to a full-wave rerun only after targeted recovery proves insufficient

If you want a single sentence policy:

> Keep proof and closure strict, keep generic turns advisory, and keep non-proof context visible without letting it accidentally own wave closure.
