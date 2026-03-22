# Codex Runtime

<!-- CUSTOMIZE: Add project-specific sandbox paths, allowed network targets, or codex CLI flags below. -->

## Core Rules

- Treat the compiled task prompt as the authoritative assignment. It is the single source of scope and deliverables.
- Keep terminal work concise and deterministic where possible.
- Use repo-local files and generated overlays before broad external lookup.
- Preserve required structured markers exactly in terminal output.
- Do not assume interactive input is available. All commands must run non-interactively.

## Tool Profile

Codex sessions operate through terminal-only execution:

- **Shell commands** -- your primary interface. All verification, builds, tests, and file operations happen through the terminal.
- **`--add-dir` bundles** -- the orchestrator may provide additional directories as readable context. These appear as local paths in the sandbox.
- **File I/O** -- read and write files through standard shell tools (cat, sed, tee, etc.).
- **No interactive prompts** -- stdin is not connected. Commands requiring user input will hang or fail. Use flags like `-y`, `--non-interactive`, or `--batch` where available.
- **No MCP servers** -- MCP tools are not available in Codex sessions.

## Prompt Contract

The compiled task prompt is the single authority for a Codex session:

1. **Compiled task prompt** -- contains role assignment, exit contracts, file ownership, shared context, and all coordination state.
2. **Added directories** -- supplementary context provided via `--add-dir`. Treat as read-only reference material.
3. **Appended skill guidance** -- this file and any other resolved skills.

All context is in the prompt and added directories. There is no system prompt layer beyond what Codex provides natively.

## Output Format

- Emit structured markers exactly as defined in wave-core. Place each marker on its own line in terminal output.
- Use deterministic, reproducible commands. Prefer explicit paths and flags over relying on shell state.
- When running verification commands, capture and report the exact output. Do not paraphrase.
- Final output must include all required markers for your role before the session ends.

## Sandbox Constraints

- **Network** -- may be restricted or unavailable depending on Codex configuration. Do not assume outbound network access unless the task explicitly requires it.
- **Repo-local preference** -- prefer files already in the repo or provided via `--add-dir` over fetching external resources.
- **No persistent state** -- each session starts clean. Do not rely on artifacts from previous sessions unless they are committed to the repo.
- **Filesystem scope** -- write only to paths within the workspace. The sandbox may reject writes outside the project root.
- **External APIs** -- avoid calling external APIs unless the task explicitly requires live verification. If network is unavailable, record the gap as a proof limitation.

<!-- CUSTOMIZE: List allowed network targets or external API endpoints for your project here. -->

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Allowed outbound network targets
  - Project-specific --add-dir paths and their contents
  - Custom sandbox filesystem restrictions
  - Pre-installed tools available in the Codex sandbox
-->
