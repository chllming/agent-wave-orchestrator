---
name: tui-design
description: Reviews terminal UI and operator-surface design against world-class TUI principles for focus, trust, navigation, information architecture, and recovery. Use when designing or reviewing TUIs, operator shells, dashboards, keyboard flows, or live terminal UX.
---

# TUI Design

Use this skill when the work involves terminal UX, operator shells, dashboards, or live operator-facing review.

## Core stance

- Treat the TUI as an operating instrument, not a styled CLI.
- Optimize for observe, decide, act, verify loops rather than one-shot command execution.
- Keep the surface keyboard-first, focus-driven, interruptible, and operationally honest.
- Prefer stable information architecture over visual cleverness.
- Treat trust, recovery, and state visibility as first-class UX requirements.

## Review priorities

When reviewing or designing a TUI, check these in order:

1. **Operational honesty**
   - Can the operator tell what is live, stale, partial, pending, failed, or only requested?
   - Does the UI ever imply success before backend confirmation?

2. **Focus and keyboard flow**
   - Is the focused pane or widget always obvious?
   - Are navigation, action, command-entry, and escape keys separated cleanly?
   - Is there always a safe back, cancel, help, and quit path?

3. **Information architecture**
   - Are scope, identity, freshness, and top-level health always visible?
   - Does the default view answer what changed, what is broken, and what needs action?
   - Is detail one step away instead of dumped everywhere at once?

4. **Streaming and live-state behavior**
   - Do updates preserve selection and focus?
   - Can users pause or freeze moving views when they need to read?
   - Are lag, dropped updates, or replay versus live mode visible?

5. **Recovery and trust**
   - Are retries, resume paths, and error next steps explicit?
   - Are destructive or high-risk actions confirmed and auditable?

## Design rules

- Keep layouts stable. Avoid reflow and selection jumps during streaming updates.
- Use color semantically, never decoratively or as the only signal.
- Prefer compact summaries with drill-down over dense unreadable dashboards.
- Use explicit action-state ladders such as requested, accepted, running, applied, failed.
- Make filters, scopes, and auth context visible at all times.
- Support narrow-terminal degradation gracefully instead of forcing broken split panes.
- Avoid ambiguous-width glyphs or emoji for alignment-critical UI.

## Output guidance

For design review, prefer findings shaped like:

- exact surface
- exact failure mode
- operator impact
- blocking or advisory status
- concrete fix direction

For design proposals, prefer:

- interaction model
- layout model
- keyboard model
- trust and recovery model
- drill-down model

## Reference

For the full TUI design guidance distilled for this repo, read:

- [references/tui-design.md](./references/tui-design.md)
