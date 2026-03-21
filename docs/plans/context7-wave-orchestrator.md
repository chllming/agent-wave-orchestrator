# Context7 and Wave Orchestrator

Context7 is for external library truth. Repository docs and source are for repository truth.

## Rules

- Prefer a narrow bundle per agent or wave.
- Keep bundle defaults and agent overrides aligned with the components the wave is promoting.
- Do not load broad external docs by default.
- Treat prefetched Context7 text as non-canonical prompt context.
- Keep Context7 bundle definitions in `docs/context7/bundles.json`.
- Launcher-side prefetch writes only to ignored cache paths under `.tmp/`.

## Setup

1. Add `CONTEXT7_API_KEY` to `.env.local` at repo root.
2. Export it before launching the wave runner or any executor directly:

```bash
source scripts/context7-export-env.sh
```

3. Verify the key:

```bash
pnpm context7:api-check
```

4. Review [docs/context7/bundles.json](/home/coder/wave-orchestration/docs/context7/bundles.json) and trim it to the external libraries your repository actually uses.

## Resolution Order

1. Agent `### Context7`
2. Wave `## Context7 defaults`
3. Lane default from `docs/context7/bundles.json`
4. `none`

## Bundle Authoring

Each bundle should be small and task-shaped. A bundle entry can name libraries by `libraryName` and optionally add a `queryHint` to keep fetched docs focused.

Example:

```json
{
  "bundles": {
    "node-typescript": {
      "description": "Node.js and TypeScript runtime docs.",
      "libraries": [
        {
          "libraryName": "nodejs",
          "queryHint": "child processes, streams, filesystem, process lifecycle"
        },
        {
          "libraryName": "typescript",
          "queryHint": "module resolution, declarations, compiler behavior"
        }
      ]
    }
  }
}
```

Keep the `none` bundle defined so agents and waves can opt out explicitly.

## Wave Authoring

Wave-level default:

````md
## Context7 defaults

- bundle: node-typescript
- query: "Node process spawning and test execution"
````

Agent-level override:

````md
### Context7

- bundle: node-typescript
- query: "TypeScript declarations and module resolution"
````

## Injection

When a bundle is active, the launcher injects:

- the resolved bundle id
- the resolved query focus
- the allowed library list
- prefetched third-party snippets when available

The injected block appears before the assigned implementation prompt and is labeled non-canonical. This injection is executor-agnostic.

## Runtime Behavior

- Prefetch happens in the launcher before the agent session starts.
- Cache files are written under `.tmp/<lane>-wave-launcher/context7-cache/`.
- Executor runtime overlays are written under `.tmp/<lane>-wave-launcher/executors/`.
- The resolved Context7 selection becomes part of the prompt fingerprint, so changing bundle or query invalidates prior success reuse.
- If `CONTEXT7_API_KEY` is missing, prefetch is disabled with a warning and the wave continues.
- If the Context7 API errors, the launcher fails open and starts the agent without the injected snippets.
- Use `--no-context7` when you want to force repository-only context for a run.

## Prompt Layering

- `codex`
  The generated task prompt already contains the injected Context7 block. It is piped directly into `codex exec`.
- `claude`
  The generated task prompt contains the injected Context7 block. The harness also writes a runtime system-prompt overlay and passes it with `--append-system-prompt-file` by default, or `--system-prompt-file` if `executors.claude.appendSystemPromptMode` is set to `replace`.
- `opencode`
  The generated task prompt contains the injected Context7 block. The harness writes a temporary `opencode.json` plus an agent prompt file under `.tmp/.../executors/`, points `OPENCODE_CONFIG` at that overlay, and launches `opencode run`.

## Guidance

- Use Context7 for external library truth, setup syntax, SDK details, and version-specific API behavior.
- Do not use Context7 for repository architecture, plan decisions, ownership rules, or internal contracts.
- Prefer one active backend family in a bundle instead of mixing competing frameworks.
- Keep queries specific enough that the prefetched block stays small and useful.
