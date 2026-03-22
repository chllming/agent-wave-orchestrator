# Wave Documentation

This repository now uses a layered docs structure, but the useful path is journey-first:

- start with one core concept doc
- then use one end-to-end workflow guide
- then drop into reference or narrower concept pages only when needed

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
  Read [concepts/what-is-a-wave.md](./concepts/what-is-a-wave.md). It now covers the core execution model, runtime posture, closure, and state model in one place.
- Drafting or revising waves:
  Read [guides/author-and-run-waves.md](./guides/author-and-run-waves.md), then use [plans/wave-orchestrator.md](./plans/wave-orchestrator.md) as the operator runbook.
- Adding a security review pass:
  Read [plans/wave-orchestrator.md](./plans/wave-orchestrator.md) and the standing reviewer prompt in [agents/wave-security-role.md](./agents/wave-security-role.md).
- Upgrading an existing repo:
  Read [plans/migration.md](./plans/migration.md), then review the release notes in [../CHANGELOG.md](../CHANGELOG.md) before running `pnpm exec wave upgrade`.
- Looking for concrete example waves:
  Read [reference/sample-waves.md](./reference/sample-waves.md) for showcase-first examples that demonstrate the current authored wave surface.
- Release notes and shipped deltas:
  Use [../CHANGELOG.md](../CHANGELOG.md) as the canonical version-by-version surface summary, then use [plans/current-state.md](./plans/current-state.md) to see what the starter workspace assumes today.
- Running live waves:
  Start with [guides/author-and-run-waves.md](./guides/author-and-run-waves.md), then use [plans/wave-orchestrator.md](./plans/wave-orchestrator.md) for the live operator flow.
- Tuning runtime behavior:
  Read [reference/runtime-config/README.md](./reference/runtime-config/README.md) and [reference/skills.md](./reference/skills.md).
- Looking for supporting concept pages:
  Use [concepts/runtime-agnostic-orchestration.md](./concepts/runtime-agnostic-orchestration.md), [concepts/operating-modes.md](./concepts/operating-modes.md), and [concepts/context7-vs-skills.md](./concepts/context7-vs-skills.md) after the main concept and workflow docs.

## Package vs Repo-Owned Material

- Package-owned generic runtime docs live here under `docs/`.
- Repo-specific policy should stay in:
  - `wave.config.json`
  - `docs/agents/*.md`
  - `skills/`
  - `docs/plans/waves/`
  - the repository source itself

That split keeps the engine generic while letting each adopting repository own its actual operating rules.
