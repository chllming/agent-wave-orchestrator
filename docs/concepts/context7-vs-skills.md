# Context7 vs Skills

Context7 and skills solve different problems.

Use Context7 for external library truth. Use skills for repo-owned, reusable operating knowledge.

## Short Version

- Context7
  Up-to-date third-party library or API context.
- Skills
  Reusable guidance tailored to your repository, environments, roles, and runtime choices.

## Comparison

| Surface | Context7 | Skills |
| --- | --- | --- |
| Primary purpose | External docs and SDK truth | Internal reusable operating guidance |
| Typical source | `docs/context7/bundles.json` and fetched snippets | `skills/<skill-id>/skill.json` and `SKILL.md` |
| Ownership | Package or repo operator config | Repository maintainers |
| Scope | Library versions, APIs, setup syntax | Coding rules, deploy norms, repo conventions, workflow rules |
| Selection | Wave defaults plus per-agent `### Context7` | Base plus role, runtime, deploy-kind, and per-agent `### Skills` |
| Change rate | Often changes with external libraries | Changes when your repo or environment changes |
| Projection | Injected as prompt context | Projected into runtime-specific overlays and prompt context |

## When To Use Context7

Use Context7 when the agent needs information that lives outside the repo and can change over time, such as:

- framework APIs
- SDK method signatures
- library setup syntax
- version-specific behavior
- hosted service docs

Context7 is intentionally narrow. It is for third-party truth, not for your repo's own architecture or policies.

## When To Use Skills

Use skills when the guidance is reusable, repo-owned, and should survive across waves, roles, or runtimes, such as:

- coding norms
- review expectations
- environment-specific rules
- Railway, Kubernetes, or GitHub release procedures
- runtime-specific instructions for Codex, Claude, or OpenCode
- role-oriented heuristics for implementation, deploy, cont-QA, or research agents

## What Remains Authoritative

Neither Context7 nor skills replace the actual repo.

The highest-authority sources are still:

- repository source
- `wave.config.json`
- wave markdown
- role prompts in `docs/agents/*.md`
- shared plan docs
- the generated shared summary and inboxes for the active run

Skills are additive guidance. Context7 is non-canonical external context. The repo and wave artifacts remain authoritative.

## How They Work Together

A typical deploy-focused wave might use both:

- Context7
  For the latest official framework or platform docs.
- Skills
  For repo-specific deploy rules, Railway conventions, and runtime-specific execution guidance.

That combination keeps the agent grounded in both external truth and local operating rules.

## Runtime Behavior

Both surfaces are runtime aware, but in different ways:

- Context7 is fetched and injected into the compiled prompt.
- Skills are resolved after executor selection and then projected into the runtime-specific overlay surface for that executor.

Because of that:

- changing Context7 selection changes the prompt fingerprint
- changing resolved skills also changes the prompt fingerprint and trace metadata

## Best Practice

- Put version-sensitive third-party docs into Context7.
- Put stable repo or environment playbooks into skills.
- Keep wave prompts focused on the specific assignment, not long-lived reusable rules.
- If the same guidance is repeated across waves, promote it into a skill.

For exact skill bundle layout and resolution order, see [reference/skills.md](../reference/skills.md).
