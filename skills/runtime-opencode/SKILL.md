# OpenCode Runtime

<!-- CUSTOMIZE: Add project-specific opencode.json settings, agent prompt conventions, or file overlay paths below. -->

## Core Rules

- Treat injected instructions and the selected agent prompt as authoritative.
- Keep edits and summaries tightly scoped to the assigned files and closure target.
- Prefer explicit repo files and generated overlays over ad hoc runtime assumptions.
- Preserve Wave marker syntax exactly in output and logs.
- Do not modify files outside your declared ownership without explicit coordination.

## Tool Profile

OpenCode sessions are edit-focused with the following capabilities:

- **Agent prompt** -- the primary instruction set, configured in `opencode.json` or passed at invocation. Defines the agent's persona and constraints.
- **`--file` flags** -- specific files provided to the session as editable context. These are your primary workspace.
- **File reading** -- read project files to gather context for edits.
- **File editing** -- apply targeted changes to owned files. Edits should be minimal and scoped.
- **Shell execution** -- run commands for builds, tests, and verification within the project directory.
- **No MCP servers** -- MCP tools are not available in OpenCode sessions.

## Prompt Contract

OpenCode sessions have a dual-authority prompt structure:

1. **Agent prompt** -- the opencode agent configuration that defines behavioral rules and persona. Set in `opencode.json` or at invocation.
2. **Injected instructions** -- the wave-orchestrator-compiled prompt containing role, exit contracts, file ownership, and shared context.
3. **Appended skill guidance** -- this file and any other resolved skills.

Both the agent prompt and injected instructions are authoritative. When they conflict on scope or deliverables, prefer the injected instructions (the compiled task prompt). When they conflict on behavioral rules, prefer the agent prompt.

## Output Format

- Emit structured markers exactly as defined in wave-core. Place each marker on its own line.
- Only emit markers for your assigned role.
- Keep edit descriptions concise. Name the file, the change, and the reason.
- When reporting verification results, include the exact command and its output.
- Preserve marker syntax in both terminal output and any log files generated.

## Edit Discipline

- Scope edits tightly to the assigned files listed in file ownership.
- Prefer targeted replacements over full file rewrites.
- When an edit depends on understanding adjacent code, read the relevant context first.
- If a needed change falls outside your ownership, record it as a follow-up request naming the owning agent, the file, and the change.
- Generated overlays (context bundles, summaries) are read-only reference. Do not edit overlay files.
- Do not edit files under `.tmp/` (coordination logs, control-plane events, result artifacts, proof registries, dashboards, traces). These are canonical runtime artifacts or projections managed by the orchestration runtime.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Project-specific opencode.json agent configurations
  - Additional --file paths commonly provided
  - Edit scope restrictions for sensitive files
  - Custom output format requirements
-->
