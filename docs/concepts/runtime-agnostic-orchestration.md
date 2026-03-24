# Runtime-Agnostic Orchestration

In short: one orchestrator, many runtimes.

Wave is runtime agnostic at the orchestration layer.

That means planning, skills, evaluation, proof, coordination, closure, and traces do not depend on whether the selected executor is Codex, Claude Code, OpenCode, or the local smoke executor.

Wave abstracts the runtime away without flattening everything to the lowest common denominator. The wave contract stays stable while the executor adapter preserves the useful runtime-native features.

## What Stays The Same Across Runtimes

These layers are runtime-neutral:

- wave parsing and validation
- planner-produced wave specs and authored wave markdown
- reducer state and phase-engine decisions
- eval targets, deliverables, and proof artifacts
- component and closure gates
- skill resolution and attachment policy
- compiled shared summaries and per-agent inboxes
- canonical authority-set state plus rendered projections
- helper assignments and dependency handling
- integration summaries, docs queues, and ledgers
- dry-run previews
- trace bundles and replay metadata

The runtime only changes at the last step, when the session supervisor and executor adapter translate the resolved assignment into an executor-specific invocation.

## Where Runtime-Specific Logic Lives

Runtime-specific behavior is isolated to the executor adapter layer:

- Codex
  `codex exec` invocation, sandbox flags, `--add-dir`, JSON mode, search, images, and other `exec` flags.
- Claude
  `claude -p` plus system-prompt overlay, settings merge, hooks, and permission surface.
- OpenCode
  `opencode run` plus generated `opencode.json`, attached files, and runtime instruction overlays.
- Local
  A smoke executor used for prompt and closure verification without a real hosted runtime.

The orchestration substrate above those adapters does not need to know how the runtime transports prompts.

This is the important distinction:

- the orchestration layer owns goals, ownership, proof, and shared state
- the executor adapter owns prompt transport, runtime-native flags, files, and settings

That split is what lets Wave stay portable without giving up runtime-specific leverage.

## Why This Matters

Runtime agnosticism gives you:

- the same plan, skill, and closure model across vendors
- the same eval and proof model across vendors
- replay and audit surfaces that do not care which runtime produced the work
- per-role runtime choice without rewriting authoring conventions
- retry-time fallback without inventing a second planning model

## Runtime Resolution

Executor choice resolves in a fixed order:

1. explicit agent `### Executor` id
2. executor profile id
3. lane role default
4. CLI `--executor`
5. global default

After that choice is final, the orchestrator resolves runtime-specific overlays and any runtime-attached skill packs.

## Fallback And Mix Policy

Wave is not runtime blind. It is runtime agnostic, but still runtime aware.

- runtime mix targets can cap how many agents use a given executor
- executor profiles can declare fallbacks
- lane policy can supply default executor choices by role
- retries can reassign an agent to a policy-safe fallback runtime

The important part is that fallback does not change the higher-level wave contract. The runtime changes, but the ownership, closure, and trace model remain the same.

## Skills Across Runtimes

The skill system follows the same pattern:

- `skills/` is the canonical repo-owned source
- the orchestrator resolves skill ids without caring which runtime will consume them
- the executor adapter projects those skills into the surface each runtime understands

Examples:

- Codex receives skill bundle directories through `--add-dir`
- Claude receives merged skill text through the generated system prompt overlay
- OpenCode receives skill instructions and attached files through `opencode.json` and `--file`
- Local receives prompt-only projections

The bundle is shared. The projection is runtime specific.

## Best Practice

Keep planning, ownership, and proof requirements runtime neutral whenever possible. Use runtime-specific settings only for:

- transport details
- model or budget selection
- safety and permission settings
- runtime-native adapter instructions

That separation is what keeps the orchestrator portable instead of turning it into a Codex-only or Claude-only harness.
