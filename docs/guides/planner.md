# Planner Guide

The planner foundation is the first structured authoring layer on top of the existing wave runtime.

If you want the full author-to-launch workflow, start with [author-and-run-waves.md](./author-and-run-waves.md). This page stays focused on planner-specific behavior.

It reduces repeated setup questions, stores project defaults, and generates wave specs plus markdown that already fit the launcher.

## What Ships Today

- `wave project setup`
- `wave project show`
- `wave draft`
- persistent project memory in `.wave/project-profile.json`
- JSON specs in `docs/plans/waves/specs/wave-<n>.json`
- rendered markdown waves in `docs/plans/waves/wave-<n>.md`
- component matrix updates for promoted components

## What The Planner Does Not Yet Ship

- ad hoc transient runs
- forward replanning of later waves
- separate runtime enforcement for oversight vs dark-factory

Those remain roadmap work. The planner foundation is about better structured authoring, not a second execution engine.

## Project Profile

Run:

```bash
pnpm exec wave project setup
pnpm exec wave project show --json
```

The saved profile remembers:

- whether the repo is a new project
- default oversight mode
- default terminal surface for live runs (`vscode` or `tmux`; `none` remains dry-run only)
- default draft template
- default lane
- typed deploy environments

This lets later drafts inherit repo-specific defaults instead of asking the same bootstrap questions every time.

## Drafting A Wave

Run:

```bash
pnpm exec wave draft --wave 1 --template implementation
```

Supported templates today:

- `implementation`
- `qa`
- `infra`
- `release`

The planner writes:

- `docs/plans/waves/specs/wave-<n>.json`
- `docs/plans/waves/wave-<n>.md`

The JSON spec is the canonical planner artifact. The markdown wave remains the launcher-compatible execution surface.

## What The Planner Asks For

The draft flow asks for structured inputs such as:

- wave title and commit message
- sequencing notes and reference rules
- oversight mode
- deploy environments in scope
- component promotions and target levels
- worker count and worker roles
- executor profiles
- file ownership
- Context7 defaults and per-agent bundles
- validation commands
- exit contracts

That gives you a wave that is much closer to launch-ready than a blank markdown template.

## Planner And Skills

The planner does not auto-discover every possible skill bundle yet, but it supports explicit per-agent `### Skills` in the rendered output.

The more important interaction is indirect:

- project profile remembers deploy environments
- planner-generated waves carry `## Deploy environments`
- deploy-kind skill attachment uses the wave's default deploy environment kind

So planner structure and skill resolution already reinforce each other.

## Recommended Workflow

1. Run `pnpm exec wave project setup` once for the repo.
2. Use `pnpm exec wave draft --wave <n> --template <template>`.
3. Review the generated JSON spec and markdown wave.
4. Adjust repo-specific prompts, file ownership, skills, and validation commands.
5. Run `pnpm exec wave launch --lane <lane> --start-wave <n> --end-wave <n> --dry-run --no-dashboard`.
6. Only launch live once the dry-run artifacts look correct.

If you want concrete authored examples after the planner baseline, see [docs/reference/sample-waves.md](../reference/sample-waves.md).

## Best Practices

- Treat the generated draft as a strong starting point, not untouchable output.
- Tighten validation commands before launch.
- Keep file ownership narrow and explicit.
- Add explicit `### Skills` only when the lane, role, runtime, and deploy-kind defaults are not enough.
- Use the component matrix as a planning contract, not just a reporting surface.
- Prefer updating the project profile when the same answers recur across waves.
- Use [docs/reference/sample-waves.md](../reference/sample-waves.md) when you want examples of denser human-authored waves that combine multiple modern surfaces such as `cont-EVAL`, delegated benchmark families, or proof-first live validation.
