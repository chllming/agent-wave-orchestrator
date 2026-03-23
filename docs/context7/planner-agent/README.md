# Planner Agent Context7 Corpus

This folder contains the tracked planner corpus that can be published as a
custom Context7 library for the agentic planner.

Why it exists:

- the original planning research cache lives under `docs/research/agent-context-cache/`
- that cache is intentionally ignored in repository workspaces
- the planner feature needs a shippable, reviewable, repo-local copy of the
  exact subset we want to publish and consume

Publish target:

- bundle id: `planner-agentic`
- library name: `wave-planner-agentic`

Refresh the copied corpus after updating the agent-context cache:

```bash
pnpm research:sync-planner-context7
```

The generated `manifest.json` records the copied files, their source paths, and
their hashes so drift is reviewable in git.
