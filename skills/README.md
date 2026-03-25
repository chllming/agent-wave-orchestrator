# Skills

Skills are repo-owned procedural bundles that Wave attaches to agents at runtime. They capture durable operating knowledge such as coding norms, role checklists, runtime behavior, provider verification, and closure rules.

Skills are not one-off prompts. They are reusable procedures with explicit routing metadata.
They are runtime inputs and overlays, not canonical runtime state.

## Bundle Layout

Each skill lives under `skills/<skill-id>/`:

```text
skills/<skill-id>/
  skill.json
  SKILL.md
  adapters/
    claude.md
    codex.md
    opencode.md
    local.md
  references/
    ...
```

- `skill.json` is required.
- `SKILL.md` is required.
- `adapters/` is optional and runtime-specific.
- `references/` is optional and can be nested recursively.

## `skill.json`

Required fields:

| Field | Purpose |
| --- | --- |
| `id` | Must match the directory name. |
| `title` | Human-readable name. |
| `description` | Short routing summary. |
| `activation.when` | Human-readable statement of when the skill should apply. |

Optional fields:

| Field | Purpose |
| --- | --- |
| `version` | Bundle version for traceability. |
| `tags` | Lightweight grouping tags. |
| `activation.roles` | Restrict auto-attachment to specific roles. |
| `activation.runtimes` | Restrict auto-attachment to specific runtimes. |
| `activation.deployKinds` | Restrict auto-attachment to specific deploy kinds. |
| `termination.when` | Explicit stop condition for the procedure. |
| `permissions.network` | Declared network expectations. |
| `permissions.shell` | Declared shell/tool expectations. |
| `permissions.mcpServers` | Declared MCP expectations. |
| `trust.tier` | Provenance marker such as `repo-owned`. |
| `evalCases[]` | Deterministic routing checks exercised by `wave doctor`. |

## `SKILL.md`

`SKILL.md` is the canonical instruction body. Keep it:

- procedural
- reusable across many waves
- smaller than a full reference manual
- free of assignment-specific details

Use `references/` for detailed catalogs, command inventories, and longer examples that would otherwise bloat the canonical skill.

## `adapters/`

Adapters are small runtime-specific overlays. Use them only when the runtime interaction materially differs.

Common reasons:

- Claude should prefer MCP or system-prompt-aware behavior.
- Codex should stay terminal-first and deterministic.
- OpenCode should lean on file attachments and direct edits.
- Local should stay within smoke-validation limits.

## `references/`

Reference files are progressive-disclosure material. Wave lists them in the compact catalog and, for OpenCode, attaches them as files. The agent reads them on demand rather than paying the token cost up front.

Use references for:

- command catalogs
- provider failure-mode inventories
- longer examples
- repo-specific extensions that do not belong in the core procedure

## Resolution Model

Wave stacks skills in this order:

1. global `skills.base`
2. lane `skills.base`
3. global `skills.byRole[role]`
4. lane `skills.byRole[role]`
5. global `skills.byRuntime[runtime]`
6. lane `skills.byRuntime[runtime]`
7. global `skills.byDeployKind[kind]`
8. lane `skills.byDeployKind[kind]`
9. agent `### Skills`

Then it filters configured skills through manifest activation:

- role skills should declare their role
- runtime skills should declare their runtime
- provider skills should usually declare both deploy kinds and the roles that genuinely need provider context

Explicit per-agent `### Skills` still force attachment. Use that only for real exceptions.

## Metadata-First Delivery

Wave no longer inlines every skill body into every runtime prompt by default.

Generated artifacts:

| File | Purpose |
| --- | --- |
| `skills.resolved.md` | Compact skill catalog for the active run. |
| `skills.expanded.md` | Full canonical/debug view with `SKILL.md` bodies and adapters. |
| `skills.metadata.json` | Structured ids, activation, permissions, hashes, paths, and artifacts. |
| `<runtime>-skills.txt` | Runtime-specific compact projection. |

Runtime behavior:

| Runtime | Delivery model |
| --- | --- |
| Codex | Compact catalog in prompt plus bundle directories through `--add-dir`. |
| Claude | Compact catalog appended to the generated system prompt. |
| OpenCode | Compact catalog injected into `opencode.json`; `skill.json`, `SKILL.md`, the selected adapter, and recursive references attached via `--file`. |
| Local | Compact catalog only. |

Skills guide how agents interpret canonical state and projections. They do not become canonical runtime state, control-plane records, or replay inputs by themselves.

## Validation

Run:

```sh
node scripts/wave.mjs doctor --json
```

Doctor validates:

- bundle existence
- manifest schema
- selector-key correctness
- config-to-manifest activation consistency
- every declared `evalCases[]`

This is fail-closed. Selector typos and malformed bundles are errors, not silent no-ops.

## Skill Categories

Base:

- `wave-core`
- `repo-coding-rules`

Role:

- `role-design`
- `role-implementation`
- `role-integration`
- `role-documentation`
- `role-infra`
- `role-deploy`
- `role-research`
- `role-cont-qa`
- `role-cont-eval`

Runtime:

- `runtime-codex`
- `runtime-claude`
- `runtime-opencode`
- `runtime-local`

Design reference:

- `tui-design`
- `signal-hygiene`

Provider:

- `provider-railway`
- `provider-aws`
- `provider-kubernetes`
- `provider-docker-compose`
- `provider-ssh-manual`
- `provider-custom-deploy`
- `provider-github-release`

Provider skills are configured by deploy kind, but the shipped manifests further restrict them to `deploy`, `infra`, `integration`, and `cont-qa` auto-attachment.

## Creating or Updating a Skill

1. Create `skills/<skill-id>/`.
2. Add `skill.json` with at least `id`, `title`, `description`, and `activation.when`.
3. Add `SKILL.md`.
4. Add adapters or references only where they materially help.
5. Register the bundle in `wave.config.json` if it should auto-attach.
6. Add meaningful `evalCases[]`.
7. Run `node scripts/wave.mjs doctor --json`.

For terminal or operator-surface design work, keep `role-design` as the packet contract and add `tui-design` explicitly in the wave's `### Skills`.

For long-running watcher agents, add `signal-hygiene` explicitly in the wave's `### Skills`. Do not attach it to normal one-shot implementation agents. For the wrapper and ack-loop contract, read [../docs/guides/signal-wrappers.md](../docs/guides/signal-wrappers.md).

## Further Reading

- [Skills Reference](../docs/reference/skills.md)
- [Context7 vs Skills](../docs/concepts/context7-vs-skills.md)
- [What Is A Wave](../docs/concepts/what-is-a-wave.md)
