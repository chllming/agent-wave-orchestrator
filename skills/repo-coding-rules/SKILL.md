# Repo Coding Rules

<!-- CUSTOMIZE: Add project-specific linting, formatting, or CI requirements below. -->

## Core Rules

- Read `AGENTS.md` before making material edits if it exists.
- Prefer small, reviewable changes that preserve existing repo patterns.
- Run the relevant tests or checks for touched surfaces and fix regressions caused by your changes.
- Keep docs aligned when implementation changes status, ownership, or proof expectations.
- Do not push by default unless the task explicitly asks for it.

## Pre-Edit Checklist

Before editing any file, confirm:

1. You own the file or have an explicit follow-up request granting access.
2. You have read the current file content. Do not edit blindly.
3. You understand the existing patterns in the file (indentation, naming, exports).
4. Your change is the smallest diff that achieves the goal.
5. If the file has a corresponding test file, you will update or extend tests to cover your change.
6. You have checked for other files that import or depend on the symbols you are changing.
7. If the file is a config file (JSON, YAML), you have validated the resulting structure is well-formed.

## Change Hygiene

Follow these conventions unless the repo's own `AGENTS.md` or linter config overrides them:

- **Indentation**: 2-space indent, no tabs.
- **Quotes**: double quotes for strings.
- **Semicolons**: use semicolons at statement ends.
- **Module format**: ESM with `.mjs` extension for JavaScript.
- **File naming**: kebab-case for files and directories (e.g., `agent-state.mjs`, not `agentState.mjs`).
- **Exports**: prefer named exports over default exports.
- **Imports**: keep import order consistent with the existing file. Group node builtins, then external packages, then local imports.
- **No dead code**: do not leave commented-out code blocks. Remove them or explain in a comment why they exist.
- **No speculative changes**: only change what the task requires. Do not refactor adjacent code opportunistically.

## Test Expectations

- Run `pnpm test` (or the repo's declared test command) after making changes.
- Write **focused tests** that cover the specific behavior you changed, not broad integration suites.
- Tests must be **hermetic**: no network calls, no filesystem side effects outside temp directories, no reliance on execution order.
- When fixing a bug, add a **regression test** that fails without the fix and passes with it.
- If a test file does not exist for the module you changed, create one following the repo's test directory structure.
- Name test files to match their source: `scripts/wave-orchestrator/foo.mjs` maps to `test/wave-orchestrator/foo.test.ts`.
- Do not disable or skip existing tests to make your change pass. If an existing test conflicts with your change, understand why before modifying it.
- Test assertions should be specific. Avoid broad `toBeTruthy()` when an exact value comparison is possible.

## Doc Alignment

Update documentation when your change alters any of:

- **Status**: a component or feature moves to a new state (planned, in-progress, landed, deprecated).
- **Ownership**: file ownership or role assignments change.
- **Proof expectations**: exit contracts, component promotions, or verification surfaces change.

Which docs to update:

| What changed | Update |
|---|---|
| Feature status or sequencing | `docs/plans/current-state.md` |
| Component maturity level | `docs/plans/component-cutover-matrix.md` and `.json` |
| Roadmap items completed or reordered | `docs/roadmap.md` |
| Migration steps changed | relevant migration doc under `docs/reference/` |

If you are not the documentation steward, post a coordination record requesting the doc update instead of editing shared-plan docs directly.

## Commit Conventions

- Use imperative mood in the subject line.
- Prefix with a type tag:
  - `Fix:` -- bug fix
  - `Feat:` -- new feature or capability
  - `Docs:` -- documentation-only change
  - `Build:` -- build system, CI, or dependency change
  - `Release:` -- version bump or release artifact
- Keep the subject line under 72 characters.
- Add a body paragraph when the "why" is not obvious from the diff.
- Reference the wave id or issue number in the body when applicable.
- Do not combine unrelated changes in a single commit. Each commit should be a coherent unit.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Project-specific linter commands (eslint, prettier, biome)
  - Required CI checks before merge
  - Branch naming conventions
  - Code review requirements
  - Additional file naming or export conventions
-->
