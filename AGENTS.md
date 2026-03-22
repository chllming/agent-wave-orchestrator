# Repository Guidelines

## Project Structure & Module Organization

`scripts/` contains the shipped CLI entrypoints. Keep top-level wrappers such as `wave.mjs`, `wave-launcher.mjs`, and `wave-dashboard.mjs` thin, and put reusable runtime logic in `scripts/wave-orchestrator/`. Tests live under `test/`; `test/wave-orchestrator/` mirrors orchestrator modules, while `test/research/` covers research import and indexing utilities. `docs/` is part of the product surface: `plans/` holds runbooks and sample waves, `reference/` holds operator docs, `agents/` holds role prompts, and `context7/` holds bundle metadata. `wave.config.json` and `releases/manifest.json` are repo-level configuration artifacts. Generated state under `.tmp/`, `.wave/`, `.vscode/terminals.json`, `coverage/`, and research caches is ignored and should not be committed, except for the source repo's tracked `.wave/install-state.json` fixture.

## Build, Test, and Development Commands

Use Node.js 22+ with `pnpm@10.23.0`.

- `pnpm install`: install dependencies from the lockfile.
- `pnpm test`: run the full Vitest suite.
- `pnpm test -- test/wave-orchestrator/config.test.ts`: run a focused regression while iterating.
- `node scripts/wave.mjs doctor --json`: validate the adopted workspace configuration.
- `node scripts/wave.mjs launch --lane main --dry-run --no-dashboard`: parse waves and generate state without launching real executors.
- `pnpm context7:api-check`: verify Context7 wiring when touching that integration.

There is no separate build step; the package ships `scripts/`, `docs/`, and config files directly.

## Coding Style & Naming Conventions

Match the existing ESM style: `.mjs` modules, 2-space indentation, double quotes, and semicolons. Prefer named exports and small helper functions over large monolithic CLI files. Use kebab-case filenames such as `coordination-store.mjs`; name matching tests `coordination-store.test.ts`.

## Testing Guidelines

Vitest picks up `test/**/*.test.ts` and `test/**/*.spec.ts`. Add or update targeted regression tests for every behavior change; no numeric coverage gate is enforced here. Prefer hermetic tests that validate generated artifacts and control flow without invoking real Codex, Claude, or OpenCode sessions.

## Commit & Pull Request Guidelines

Follow the existing commit style from `git log`: `Fix: ...`, `Docs: ...`, `Build: ...`, and `Release: ...`, written in the imperative mood and scoped to one change. Pull requests should summarize the behavior change, list the validation commands run, and link the relevant issue or release task. Include terminal output or screenshots only when dashboard or operator-facing output changes.
