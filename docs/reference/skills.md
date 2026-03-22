# Skills Reference

Skills are repo-owned reusable instruction bundles that can be attached by lane, role, runtime, deploy kind, or explicit per-agent declaration.

## Canonical Bundle Layout

Each bundle lives under `skills/<skill-id>/` and requires:

- `skill.json`
- `SKILL.md`

Optional runtime adapters live under:

- `adapters/codex.md`
- `adapters/claude.md`
- `adapters/opencode.md`
- `adapters/local.md`

Minimal example:

```text
skills/provider-railway/
  skill.json
  SKILL.md
  adapters/
    codex.md
    claude.md
    opencode.md
    local.md
```

## `skill.json`

Required fields in practice:

- `id`
- `title`
- `description`

The bundle directory name and manifest `id` must match the normalized skill id.

## `SKILL.md`

This is the canonical human-authored instruction body for the skill.

Keep it focused on reusable guidance that should survive across:

- many waves
- multiple roles
- multiple runtimes

Do not duplicate volatile assignment-specific details that belong in the wave prompt instead.

## `wave.config.json` Surface

Top-level and lane-local skill attachment use the same shape:

```json
{
  "skills": {
    "dir": "skills",
    "base": ["wave-core"],
    "byRole": {
      "implementation": ["role-implementation"]
    },
    "byRuntime": {
      "codex": ["runtime-codex"]
    },
    "byDeployKind": {
      "railway-mcp": ["provider-railway"]
    }
  }
}
```

Lane-local `lanes.<lane>.skills` extends the global config instead of replacing it.

## Resolution Order

Resolved skills attach in this order:

1. global `skills.base`
2. lane `skills.base`
3. global `skills.byRole[resolvedRole]`
4. lane `skills.byRole[resolvedRole]`
5. global `skills.byRuntime[resolvedExecutorId]`
6. lane `skills.byRuntime[resolvedExecutorId]`
7. global `skills.byDeployKind[defaultDeployEnvironmentKind]`
8. lane `skills.byDeployKind[defaultDeployEnvironmentKind]`
9. agent `### Skills`

Duplicates are removed while preserving first-seen order.

## Per-Agent Attachment

Wave markdown can add explicit skills:

````md
### Skills

- provider-github-release
- provider-aws
````

These are additive. They do not replace the base, role, runtime, or deploy-kind skill layers.

## Deploy-Kind Attachment

Deploy-kind mapping uses the wave's default deploy environment from `## Deploy environments`.

If the wave declares:

````md
## Deploy environments

- `prod`: `railway-mcp` default
````

then `byDeployKind.railway-mcp` skills become eligible for agents in that wave.

## Runtime Projection

The canonical bundle is shared, but projection is runtime specific:

- Codex
  Skill bundle directories become `--add-dir` inputs, and the merged skill text is included in the compiled prompt.
- Claude
  The merged skill payload is appended to the generated system-prompt overlay.
- OpenCode
  Skill instructions flow into `opencode.json`, and relevant files are attached through `--file`.
- Local
  Skill text stays prompt-only.

## Generated Artifacts

Executor overlay directories can contain:

- `skills.resolved.md`
- `skills.metadata.json`
- `<runtime>-skills.txt`

Dry-run `launch-preview.json` and live trace metadata also record the resolved skill ids and bundle metadata.

## Validation

`wave doctor` validates that all configured skill bundles referenced by lane skill config exist and can be loaded.

Missing or malformed bundles are treated as configuration errors, not silent no-ops.

## Best Practices

- Put repo-specific norms into skills, not repeated wave prompts.
- Keep skills short and reusable.
- Use runtime adapters only for runtime-specific instructions.
- Prefer deploy-kind mapping for environment conventions and explicit `### Skills` only for special cases.
- Keep bundle ids stable so traces and prompt fingerprints stay intelligible across runs.
