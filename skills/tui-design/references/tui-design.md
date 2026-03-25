# TUI Design Reference

This reference distills reusable design guidance for Wave's terminal UX and operator-review work.

## What a TUI is for

A TUI is for live operation of a changing system:

- observe
- decide
- act
- verify
- repeat

That means the UX must prioritize:

- stable state visibility
- continuous feedback
- keyboard throughput
- interruptibility
- recovery

It should not behave like:

- a one-shot CLI with colors
- a browser dashboard squeezed into a terminal

## Core operating principles

### Operational honesty

The TUI must make these obvious:

- what it knows
- how fresh that knowledge is
- what it is currently doing
- what is only requested versus confirmed
- what is partial, stale, blocked, or degraded

Never imply:

- "done" when the backend only accepted a request
- "live" when the data is cached or lagged
- "success" when verification has not happened

### Keyboard-first interaction

Good TUIs separate input into four lanes:

1. navigation
2. actions
3. command entry
4. escapes and cancellation

Required behaviors:

- visible focus
- predictable pane switching
- context-sensitive help
- cancel and back semantics that always work

### Stable information architecture

The screen should answer:

- where am I operating?
- what changed?
- what is wrong?
- what needs action now?

Use three state layers:

- global: scope, identity, connectivity, freshness
- session: filters, selected object, follow mode
- local: pane scroll, cursor, input buffer

### Progressive disclosure

Default views should summarize:

- what's broken
- what changed
- what is actionable

Details should be one step away:

- inspect
- drill down
- open logs
- open proof
- open events

### Recovery-first UX

Every serious TUI needs:

- retry
- resume
- replay or event history
- clear next-step messaging on failure

Errors should distinguish:

- what failed
- what scope it affected
- whether the system is safe
- what the operator can do next

## Focus and navigation heuristics

### Good focus rules

- the active pane is visually obvious
- the selected row is visually obvious
- streaming updates never steal focus
- selection stays pinned unless the operator changes it

### Good navigation rules

- tab and shift-tab always get the user unstuck
- direct hotkeys may exist, but there is always a universal path
- search and filter are first-class
- command palette or command bar is ideal for power actions

### Bad signs

- mode confusion
- accidental action keys
- focus ambiguity
- selection jumps during refresh

## Visual system guidance

### Use color semantically

Recommended semantic roles:

- critical
- warning
- success
- info
- muted
- focus
- selection

Rules:

- never rely on color alone
- support monochrome or no-color use
- avoid decorative rainbow dashboards

### Respect terminal constraints

Design for:

- limited width
- resizing
- unicode width issues
- non-uniform terminal support

Implications:

- keep glyph choices conservative
- use ASCII fallbacks where needed
- degrade gracefully on small terminals

## Live-system feedback rules

### Loading and streaming

The operator must be able to tell:

- loading
- syncing
- replaying
- paused
- lagging
- dropping updates

If the system is slow:

- say what is happening
- show progress if possible
- show completed-so-far if total work is unknown
- provide interruption

### Success and failure

For low-risk actions:

- a small confirmation is enough

For high-risk or asynchronous actions:

- show a receipt
- show the exact target
- show request versus applied versus verified state

## Layout patterns that work

### Best default pattern

For serious ops TUIs, prefer:

- dashboard or navigation pane
- list or queue pane
- inspector or detail pane

This supports:

- fast scanning
- stable orientation
- low-friction drill-down

### Good drill-down flow

The path should be predictable:

- summary
- selected entity
- details
- logs, proof, events, or raw view

### Narrow terminal fallback

When width collapses:

- reduce columns
- stack panels
- keep the same semantics
- prefer honest condensed output over broken split panes

## Trust checklist for operator surfaces

Before approving a TUI or operator UX, ask:

- Is scope always visible?
- Is freshness always visible?
- Are action states honest?
- Are filters and selection visible?
- Can the user recover from errors?
- Can the user cancel?
- Can the user tell replay from live?
- Can the user tell pending from complete?
- Can the user audit what happened?

## Anti-patterns

Reject designs that:

- flicker or constantly reflow
- hide scope or auth context
- overload color
- force memorization without help
- provide no cancel path
- show fake success
- use unstable alignment-critical glyphs
- stream in ways that steal focus
- hide blockers behind decorative dashboards
