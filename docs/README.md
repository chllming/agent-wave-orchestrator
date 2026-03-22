# Wave Documentation

This repository now uses a layered docs structure so operators, maintainers, and adopting repos can find the right level of detail quickly.

## Suggested Structure

- `docs/concepts/`
  Mental models and architecture. Read these first if you want to understand what a wave is, how runtime-agnostic execution works, or how Context7 differs from skills.
- `docs/guides/`
  Task-oriented workflows. Use these when you need to set up the planner, choose an operating mode, or decide how to run tmux and terminal surfaces.
- `docs/reference/`
  Exact command, config, and file-format details. Use this when you need precise key names, runtime options, or bundle structure.
- `docs/plans/`
  Starter plan docs, runbooks, roadmap, and current-state pages that ship with the package and seed adopting repositories.
- `docs/research/`
  Source index for the external papers and articles that informed the harness design. Hydrated caches stay local and ignored.

## Start Here

- New to Wave:
  Read [concepts/what-is-a-wave.md](./concepts/what-is-a-wave.md), [concepts/runtime-agnostic-orchestration.md](./concepts/runtime-agnostic-orchestration.md), and [concepts/context7-vs-skills.md](./concepts/context7-vs-skills.md).
- Drafting or revising waves:
  Read [guides/planner.md](./guides/planner.md) and then the operator runbook in [plans/wave-orchestrator.md](./plans/wave-orchestrator.md).
- Running live waves:
  Read [guides/terminal-surfaces.md](./guides/terminal-surfaces.md), [concepts/operating-modes.md](./concepts/operating-modes.md), and [plans/wave-orchestrator.md](./plans/wave-orchestrator.md).
- Tuning runtime behavior:
  Read [reference/runtime-config/README.md](./reference/runtime-config/README.md) and [reference/skills.md](./reference/skills.md).

## Package vs Repo-Owned Material

- Package-owned generic runtime docs live here under `docs/`.
- Repo-specific policy should stay in:
  - `wave.config.json`
  - `docs/agents/*.md`
  - `skills/`
  - `docs/plans/waves/`
  - the repository source itself

That split keeps the engine generic while letting each adopting repository own its actual operating rules.
