# Skills Reference

Skills are repo-owned reusable instruction bundles. Wave resolves them by config layer, then filters them through each bundle's activation metadata before projecting them into the selected runtime.
They shape runtime behavior, but they are not part of the canonical authority set.

## Canonical Bundle Layout

Each bundle lives under `skills/<skill-id>/` and requires:

- `skill.json`
- `SKILL.md`

Optional files:

- `adapters/codex.md`
- `adapters/claude.md`
- `adapters/opencode.md`
- `adapters/local.md`
- `references/**` for on-demand reference material

Minimal example:

```text
skills/provider-railway/
  skill.json
  SKILL.md
  adapters/
    codex.md
    claude.md
    opencode.md
  references/
    verification-commands.md
```

## `skill.json`

Required fields:

- `id`
- `title`
- `description`
- `activation.when`

Optional fields:

- `version`
- `tags`
- `activation.roles`
- `activation.runtimes`
- `activation.deployKinds`
- `termination.when`
- `permissions.network`
- `permissions.shell`
- `permissions.mcpServers`
- `trust.tier`
- `evalCases[]`

Example:

```json
{
  "id": "provider-railway",
  "title": "Railway",
  "description": "Provider-aware Railway verification and rollback guidance.",
  "activation": {
    "when": "Attach when the wave deploy surface is Railway and the agent is acting in deploy, infra, integration, or cont-qa scope.",
    "roles": ["deploy", "infra", "integration", "cont-qa"],
    "runtimes": [],
    "deployKinds": ["railway-cli", "railway-mcp"]
  },
  "termination": "Stop when Railway evidence is recorded or the blocking surface is explicit.",
  "permissions": {
    "network": ["railway.app"],
    "shell": ["railway"],
    "mcpServers": ["railway"]
  },
  "trust": {
    "tier": "repo-owned"
  },
  "evalCases": [
    {
      "id": "deploy-railway-cli",
      "role": "deploy",
      "runtime": "opencode",
      "deployKind": "railway-cli",
      "expectActive": true
    }
  ]
}
```

The bundle directory name and manifest `id` must match the normalized skill id.

## `SKILL.md`

`SKILL.md` is the canonical instruction body. Keep it reusable and procedural:

- reusable across many waves
- free of assignment-specific details that belong in the wave prompt
- compact enough that long catalogs and command references can move into `references/`

## `wave.config.json` Surface

Top-level and lane-local skill attachment use the same shape:

```json
{
  "skills": {
    "dir": "skills",
    "base": ["wave-core", "repo-coding-rules"],
    "byRole": {
      "design": ["role-design"],
      "deploy": ["role-deploy"]
    },
    "byRuntime": {
      "claude": ["runtime-claude"]
    },
    "byDeployKind": {
      "railway-mcp": ["provider-railway"]
    }
  }
}
```

Lane-local `lanes.<lane>.skills` extends the global config instead of replacing it.

Optional design workers in the shipped `0.9.2` surface normally attach `role-design`. That bundle is intended for docs/spec-first design packets and explicit implementation handoff work before implementation starts. When the design packet covers terminal UX, dashboards, or other operator surfaces, add `tui-design` explicitly in the wave's `### Skills`.

Long-running agents that should stay resident and react only to orchestrator signal changes can add `signal-hygiene` explicitly in `### Skills`. That bundle is not auto-attached and is not meant for normal one-shot implementation agents.

## Resolution Order

Resolved skills are gathered in this order:

1. global `skills.base`
2. lane `skills.base`
3. global `skills.byRole[resolvedRole]`
4. lane `skills.byRole[resolvedRole]`
5. global `skills.byRuntime[resolvedExecutorId]`
6. lane `skills.byRuntime[resolvedExecutorId]`
7. global `skills.byDeployKind[defaultDeployEnvironmentKind]`
8. lane `skills.byDeployKind[defaultDeployEnvironmentKind]`
9. agent `### Skills`

Then Wave applies manifest activation filtering:

- configured skills only stay active if their `activation.roles`, `activation.runtimes`, and `activation.deployKinds` match the agent context
- explicit agent `### Skills` still attach even if activation metadata would not auto-match

Duplicates are removed while preserving first-seen order.

## Deploy-Kind Attachment

Deploy-kind mapping uses the wave's default deploy environment from `## Deploy environments`.

If the wave declares:

````md
## Deploy environments

- `prod`: `railway-mcp` default
````

then `byDeployKind.railway-mcp` skills become eligible for that wave. Whether they actually attach still depends on each bundle's activation metadata.

Config-time validation rules:

- `skills.byRole` keys must be supported Wave roles
- `skills.byRuntime` keys must be supported runtimes
- `skills.byDeployKind` keys are validated by `wave doctor` against built-in kinds plus kinds declared in wave files

Built-in deploy kinds shipped by the starter profile are:

- `railway-cli`
- `railway-mcp`
- `docker-compose`
- `kubernetes`
- `ssh-manual`
- `custom`
- `aws`
- `github-release`

## Runtime Projection

Wave now projects skills metadata-first:

- `skills.resolved.md` is a compact catalog with bundle summaries, activation scope, permissions, manifest paths, adapter paths, and available references
- `skills.expanded.md` contains the full canonical `SKILL.md` bodies plus runtime adapters for debugging and audit

Runtime delivery:

- Codex
  Bundle directories become `--add-dir` inputs. The compact catalog stays in the compiled prompt, and the agent can read bundle files directly from disk.
- Claude
  The compact catalog is appended to the generated system-prompt overlay.
- OpenCode
  The compact catalog is injected into `opencode.json`, and `skill.json`, `SKILL.md`, the selected adapter, and every recursive `references/**` file are attached through `--file`.
- Local
  The compact catalog stays prompt-only.

These runtime projections are guidance surfaces. They should stay aligned with the canonical authority model, but they are not replay inputs or decision state on their own.

For the optional `design` worker role, the default pattern is:

- `role-design` for the design packet contract
- `tui-design` only when the packet covers terminal UX, dashboards, or other operator surfaces
- no runtime-specific coding bundle unless the wave explicitly gives the design steward code ownership and makes it a hybrid design steward

For long-running watcher agents, the default pattern is:

- no special bundle by default
- add `signal-hygiene` only when the agent should stay alive and wait for signal-version changes
- use the provided signal state path plus signal ack path instead of inventing a second wakeup loop

## Generated Artifacts

Executor overlay directories can contain:

- `skills.resolved.md`
- `skills.expanded.md`
- `skills.metadata.json`
- `<runtime>-skills.txt`

Dry-run `launch-preview.json` and live trace metadata also record the resolved skill ids, bundle metadata, hashes, activation metadata, and artifact paths.

## Validation

`wave doctor` validates the skill surface end to end:

- referenced bundles exist and load
- every bundle under the skills directory has a valid manifest and `SKILL.md`
- `skills.byRole`, `skills.byRuntime`, and `skills.byDeployKind` selectors are valid
- config mapping does not contradict manifest activation metadata
- every shipped `evalCases[]` route resolves to the expected active or inactive outcome

Missing or malformed bundles are configuration errors, not silent no-ops.

## Best Practices

- Keep `SKILL.md` procedural and move long catalogs into `references/`.
- Put routing intent into `activation.*`, not only prose.
- Use explicit per-agent `### Skills` for true exceptions, not as a substitute for missing activation metadata.
- Keep provider skills role-scoped unless every role genuinely needs the provider context.
- Keep bundle ids stable so traces and prompt fingerprints remain intelligible across runs.
- Keep `role-design` docs/spec-first by default; add `tui-design` when terminal or operator-surface work is in scope, and only attach broader coding bundles when the wave explicitly assigns code ownership and expects the same design steward to return for implementation.
