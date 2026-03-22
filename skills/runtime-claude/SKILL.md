# Claude Runtime

<!-- CUSTOMIZE: Add project-specific tool restrictions, MCP server names, or prompt assembly conventions below. -->

## Core Rules

- Treat appended system prompt guidance and the compiled task prompt as one combined contract. Both are binding.
- Keep the final answer aligned with the exact gate or ownership requirement for the run.
- Preserve Wave marker syntax exactly when emitting structured status lines.
- Prefer concise, explicit evidence summaries over long narrative explanations.
- Re-read shared state (summary, inbox, board projection) before major decisions and before final output.
- Do not infer deliverable completion from intent. Completion requires landed proof artifacts.

## Tool Profile

You have full tool access in Claude runtime sessions:

- **Read** -- read files from the workspace.
- **Edit** -- apply targeted edits to owned files.
- **Write** -- create new files when required by the task.
- **Bash** -- run shell commands for builds, tests, verification, and git operations.
- **Grep** -- search file contents by pattern.
- **Glob** -- find files by name pattern.
- **Agent** -- spawn parallel sub-agents for research or independent subtasks.
- **WebSearch / WebFetch** -- retrieve external documentation or verify live endpoints when the task requires it.
- **MCP** -- invoke project-configured MCP servers (e.g., Railway MCP, context7).

Use the narrowest tool for each job. Prefer Grep over Bash grep. Prefer Read over cat. Use Agent for parallel research to avoid context bloat in the main thread.

<!-- CUSTOMIZE: List restricted tools or additional MCP servers available in your project here. -->

## Prompt Contract

The effective contract for a Claude runtime session is assembled from three layers:

1. **System prompt** -- platform-level instructions appended by the runtime.
2. **Compiled task prompt** -- the wave-orchestrator-generated prompt containing role, exit contracts, file ownership, and shared context.
3. **Appended skill guidance** -- this file and any other resolved skills.

All three layers are binding. When they conflict, prefer the compiled task prompt for scope and deliverables, and prefer skill guidance for procedural rules.

## Output Format

- Emit structured markers exactly as defined in wave-core. Parsers depend on the format.
- Each marker must appear on its own line with no surrounding decoration.
- Only emit markers for your assigned role. Do not emit markers owned by other roles.
- Prefer concise evidence over narrative. Name the exact file, test, command, or artifact.
- When summarizing verification results, lead with the conclusion, then the evidence, then caveats.

## Context Management

- Re-read the shared summary and inbox before starting work and before emitting final markers.
- Use Agent for parallel research tasks that would otherwise consume main-thread context.
- Avoid pasting large file contents into reasoning when a targeted Grep or Read with offset suffices.
- When context grows large, summarize intermediate findings into a working note rather than re-reading raw sources.
- Do not re-read files you have already read in the current session unless the file may have changed.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Project-specific MCP server names and usage patterns
  - Additional output format requirements
  - Custom tool restrictions or approval workflows
  - Context size budget or parallel agent limits
-->
