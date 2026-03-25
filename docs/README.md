# Wave Documentation

These docs are organized around three core ideas:

- one orchestrator, many runtimes across Claude, Codex, OpenCode, and local execution
- a blackboard-style multi-agent system with a canonical authority set, generated projections, and proof-bounded closure
- compiled context from shared state, skills, runtime files, and Context7 instead of hand-maintained per-runtime context files

The useful path is journey-first:

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
  Read [concepts/what-is-a-wave.md](./concepts/what-is-a-wave.md). It covers the blackboard execution model, proof-bounded closure, runtime posture, and durable state model in one place.
- Want the runtime abstraction story:
  Read [concepts/runtime-agnostic-orchestration.md](./concepts/runtime-agnostic-orchestration.md) to see how planning, skills, evals, proof, and traces stay stable across Claude, Codex, OpenCode, and local execution.
- Want the context story:
  Read [concepts/context7-vs-skills.md](./concepts/context7-vs-skills.md) for the compiled-context model: shared summary, inboxes, project defaults, skills, Context7, and runtime overlays.
- Drafting or revising waves:
  Read [guides/author-and-run-waves.md](./guides/author-and-run-waves.md), then use [plans/wave-orchestrator.md](./plans/wave-orchestrator.md) as the operator runbook.
- Adding an optional pre-implementation design steward:
  Read [guides/author-and-run-waves.md](./guides/author-and-run-waves.md), then the standing prompt in [agents/wave-design-role.md](./agents/wave-design-role.md). The shipped `0.8.6` surface includes `role-design` plus `tui-design`, with docs-first design stewards by default and explicit hybrid design stewards when a wave also gives that same agent code ownership.
- Want signal-driven automation or long-running watcher loops:
  Read [guides/signal-wrappers.md](./guides/signal-wrappers.md). It covers the seeded `wave-status.sh` and `wave-watch.sh` wrappers, the versioned signal snapshot files, and the ack-loop contract behind `signal-hygiene`.
- Adding a security review pass:
  Read [plans/wave-orchestrator.md](./plans/wave-orchestrator.md) and the standing reviewer prompt in [agents/wave-security-role.md](./agents/wave-security-role.md).
- Upgrading an existing repo:
  Read [plans/migration.md](./plans/migration.md), then review the release notes in [../CHANGELOG.md](../CHANGELOG.md) before running `pnpm exec wave upgrade`.
- Want the concrete runtime module map:
  Read [plans/end-state-architecture.md](./plans/end-state-architecture.md) for the engine-by-engine architecture and artifact ownership model.
- Want the CLI surface map:
  Read [reference/cli-reference.md](./reference/cli-reference.md) for the shipped commands, flags, and compatibility surfaces.
- Want the historical architecture migration notes:
  Read [plans/architecture-hardening-migration.md](./plans/architecture-hardening-migration.md) for the completed cutover record.
- Looking for concrete example waves:
  Read [reference/sample-waves.md](./reference/sample-waves.md) for showcase-first examples that demonstrate the current authored wave surface.
- Release notes and shipped deltas:
  Use [../CHANGELOG.md](../CHANGELOG.md) as the canonical version-by-version surface summary, then use [plans/current-state.md](./plans/current-state.md) to see what the starter workspace assumes today.
- Running live waves:
  Start with [guides/author-and-run-waves.md](./guides/author-and-run-waves.md), then use [plans/wave-orchestrator.md](./plans/wave-orchestrator.md) for the live operator flow.
- Tuning runtime behavior:
  Read [reference/runtime-config/README.md](./reference/runtime-config/README.md) and [reference/skills.md](./reference/skills.md).
- Want the research framing behind the design:
  Read [research/coordination-failure-review.md](./research/coordination-failure-review.md) for the common MAS failure modes and how Wave tries to mitigate them, then use [research/agent-context-sources.md](./research/agent-context-sources.md) as the bibliography.
- Looking for supporting concept pages:
  Use [concepts/operating-modes.md](./concepts/operating-modes.md) after the main concept, runtime, and context docs.

## Package vs Repo-Owned Material

- Package-owned generic runtime docs live here under `docs/`.
- Repo-specific policy should stay in:
  - `wave.config.json`
  - `docs/agents/*.md`
  - `skills/`
  - `docs/plans/waves/`
  - the repository source itself

That split keeps the engine generic while letting each adopting repository own its actual operating rules.
