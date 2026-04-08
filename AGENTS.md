# Repository Guidelines

## Project Structure & Module Organization

This repo currently ships `@chllming/wave-orchestration@0.9.12`. Keep top-level entrypoints in `scripts/` thin: `wave.mjs`, `wave-launcher.mjs`, `wave-autonomous.mjs`, `wave-human-feedback.mjs`, `wave-dashboard.mjs`, `wave-local-executor.mjs`, plus the seeded operator wrappers `wave-status.sh` and `wave-watch.sh`. Put reusable runtime logic in `scripts/wave-orchestrator/`. `services/wave-control/` is the companion control-plane service with its own `src/` and `test/`. `skills/` is packaged starter surface. `docs/` is shipped product, not scratch space: `concepts/`, `guides/`, `reference/`, `plans/`, `agents/`, `context7/`, `research/`, and `evals/` should stay aligned with the current release surface. Tests live under `test/wave-orchestrator/` and `test/research/`. Repo-level release artifacts include `wave.config.json`, `releases/manifest.json`, `.wave/install-state.json`, and the tracked `.wave/upgrade-history/` fixtures.

Generated state under `.tmp/`, `coverage/`, `.vscode/terminals.json`, hydrated research caches, and `.wave/package-update-check.json` is local-only and should not be committed unless the repo already tracks a specific fixture. In contrast, `.wave/install-state.json` and the checked-in `.wave/upgrade-history/` records are part of the repo-owned release surface here.

## Release-Surface Sync

When bumping `package.json` version, keep the shipped surface aligned across `README.md`, `CHANGELOG.md`, `docs/README.md`, `docs/plans/current-state.md`, `docs/plans/migration.md`, `docs/reference/coordination-and-closure.md`, `docs/reference/runtime-config/README.md`, `releases/manifest.json`, `.wave/install-state.json`, tracked `.wave/upgrade-history/`, and this file. The current versioned operating guide is `docs/guides/recommendations-0.9.12.md`; when the package version moves, update that guide name and every reference to it in the same change. When the release also changes project or telemetry defaults, update the monorepo guide and the Wave Control docs in the same patch.

## Build, Test, and Development Commands

Use Node.js 22+ with `pnpm@10.23.0`.

- `pnpm install`: install root dependencies from the lockfile.
- `pnpm test`: run the full root Vitest suite.
- `pnpm test -- test/wave-orchestrator/release-surface.test.ts`: validate version-surface alignment after docs or release edits.
- `node scripts/wave.mjs doctor --json`: validate the repo as an adopted Wave workspace.
- `node scripts/wave.mjs launch --lane main --dry-run --no-dashboard`: materialize the dry-run surface without starting live executors.
- `pnpm context7:api-check`: verify pinned Context7 wiring when editing planner or bundle docs.
- `cd services/wave-control && pnpm test`: run the Wave Control service tests when touching `services/wave-control/`.

There is no separate build step for the root package; it ships `scripts/`, `skills/`, `docs/`, `releases/`, `wave.config.json`, and root docs directly.

## Coding Style & Naming Conventions

Match the existing ESM style: `.mjs` modules, 2-space indentation, semicolons, and double-quoted strings. Prefer named exports and small helper modules over large CLI files. Keep wrapper scripts thin and move reusable behavior into `scripts/wave-orchestrator/`. Use kebab-case filenames such as `coordination-store.mjs`; keep tests named `<area>.test.ts`.

## Reasoning And Runtime Guidance

After reviewing the current repo surface, prefer `medium` reasoning effort as the normal default for coding agents here.

- Use `medium` for routine implementation, ordinary bug fixes, most refactors, test updates, and normal documentation passes.
- Escalate to `high` only when the task is genuinely planning-heavy or uncertainty-heavy, such as planner or design work, integration or closure review, or hard debugging that requires reconciling conflicting evidence.
- Use `low` only for narrowly scoped mechanical edits when the repo context is already clear.
- Do not make `high` the default just because a task touches multiple files. First narrow ownership, deliverables, proof artifacts, and validation; only raise effort when the work still needs broader search or deeper hypothesis testing.
- When you explicitly set runtime reasoning knobs in authored waves or config examples, prefer `codex.config: model_reasoning_effort=medium` and `claude.effort: medium` unless the task is one of the exceptions above. OpenCode has no separate Wave reasoning knob today, so keep its instructions narrow instead of simulating deep-reasoning defaults through prompt bloat.

## Testing Guidelines

Vitest picks up `test/**/*.test.ts` and `test/**/*.spec.ts`. Add or update focused regression coverage for every runtime behavior change, and prefer hermetic tests that use temp directories instead of real Codex, Claude, or OpenCode sessions. Docs-only edits do not need the full suite, but release-surface edits should at least run `pnpm test -- test/wave-orchestrator/release-surface.test.ts`. If you change launcher or runtime behavior, also run `node scripts/wave.mjs doctor --json` and `node scripts/wave.mjs launch --lane main --dry-run --no-dashboard`.

## Commit & Pull Request Guidelines

Follow the visible history: `Release: ...`, `Docs: ...`, `Fix: ...`, `Build: ...`. Keep each commit scoped to one release-surface or behavior change. Pull requests should summarize the operator-visible impact, list the validation commands run, and link the relevant issue or release task. Include terminal output or screenshots only when dashboard, operator, or Wave Control surfaces change.
