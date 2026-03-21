---
title: "Repository Guidance"
summary: "Default repository-level guidance for orchestrated wave work."
---

# Repository Guidance

Use this page as the default in-repo guidance for wave agents.

## Defaults

- Keep file ownership explicit in every agent prompt.
- Prefer small, reviewable changes over broad speculative edits.
- Update impacted docs when work changes interfaces, status, sequencing, or proof expectations.
- When the repo defines a component cutover matrix, keep wave promotions, agent ownership, and shared-plan status aligned with it.
- Run the relevant validation commands for touched workspaces.
- Record blockers, assumptions, clarifications, and handoffs with `wave coord post`; treat the markdown message board as the human-readable projection of that durable state.
- Treat external docs as non-canonical unless the task is specifically about third-party APIs or tooling behavior.
