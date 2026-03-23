# Planner Guide

The planner foundation is the first structured authoring layer on top of the existing wave runtime.

If you want the full author-to-launch workflow, start with [author-and-run-waves.md](./author-and-run-waves.md). This page stays focused on planner-specific behavior.

It reduces repeated setup questions, stores project defaults, and generates wave specs plus markdown that already fit the launcher.

## What Ships Today

- `wave project setup`
- `wave project show`
- interactive `wave draft --wave <n>`
- agentic `wave draft --agentic --task "..."`
- planner run review via `wave draft --show-run <run-id>`
- explicit materialization via `wave draft --apply-run <run-id>`
- persistent project memory in `.wave/project-profile.json`
- transient planner packets in `.wave/planner/runs/<run-id>/`
- planner-run Context7 injection via `planner.agentic.context7Bundle`
- JSON specs in `docs/plans/waves/specs/wave-<n>.json`
- rendered markdown waves in `docs/plans/waves/wave-<n>.md`
- candidate matrix previews plus canonical component matrix updates on apply

## What The Planner Does Not Yet Ship

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

Interactive draft:

```bash
pnpm exec wave draft --wave 1 --template implementation
```

Agentic draft:

```bash
pnpm exec wave draft --agentic --task "Add X according to the current architecture" --from-wave 3 --max-waves 2
pnpm exec wave draft --show-run <run-id> --json
pnpm exec wave draft --apply-run <run-id> --waves all
```

The planner agent reads repo-local planning sources directly, and it can also
prefetch a planner-specific Context7 bundle when
`planner.agentic.context7Bundle` points at a published library. The tracked
source corpus for that library lives under `docs/context7/planner-agent/`.

Supported templates today:

- `implementation`
- `qa`
- `infra`
- `release`

Interactive draft writes canonical waves immediately:

- `docs/plans/waves/specs/wave-<n>.json`
- `docs/plans/waves/wave-<n>.md`

Agentic draft writes a transient review packet first:

- `.wave/planner/runs/<run-id>/request.json`
- `.wave/planner/runs/<run-id>/sources.json`
- `.wave/planner/runs/<run-id>/plan.json`
- `.wave/planner/runs/<run-id>/verification.json`
- `.wave/planner/runs/<run-id>/candidate/specs/wave-<n>.json`
- `.wave/planner/runs/<run-id>/candidate/waves/wave-<n>.md`

Canonical `docs/plans/waves/` files are only written by `--apply-run`.

The transient packet also includes the exact planner prompt and the resolved
planner Context7 selection, so review can see which external planning corpus was
attached before the planner drafted waves.

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

Interactive `wave draft --wave <n>` now resolves bundle names from
`docs/context7/bundles.json`, so wave-level and per-agent Context7 selections
can use any configured bundle instead of only `none`.

The more important interaction is indirect:

- project profile remembers deploy environments
- planner-generated waves carry `## Deploy environments`
- deploy-kind skill attachment uses the wave's default deploy environment kind

So planner structure and skill resolution already reinforce each other.

## Recommended Workflow

1. Run `pnpm exec wave project setup` once for the repo.
2. Use either `pnpm exec wave draft --wave <n> --template <template>` or `pnpm exec wave draft --agentic --task "..." --from-wave <n>`.
3. Review the generated JSON spec, markdown wave, or agentic run packet.
4. Adjust repo-specific prompts, file ownership, deliverables, proof artifacts, skills, and validation commands.
5. If you used agentic draft, materialize only the accepted waves with `pnpm exec wave draft --apply-run <run-id>`.
6. Run `pnpm exec wave launch --lane <lane> --start-wave <n> --end-wave <n> --dry-run --no-dashboard`.
7. Only launch live once the dry-run artifacts look correct.

If you want concrete authored examples after the planner baseline, see [docs/reference/sample-waves.md](../reference/sample-waves.md).

## Best Practices

- Treat the generated draft as a strong starting point, not untouchable output.
- Tighten validation commands before launch.
- Keep file ownership narrow and explicit.
- Treat `### Deliverables` and `### Proof artifacts` as part of the plan contract, not optional polish.
- Keep `docs/context7/planner-agent/` in sync with the selected planning cache slice before publishing the planner bundle to Context7.
- Add explicit `### Skills` only when the lane, role, runtime, and deploy-kind defaults are not enough.
- Use the component matrix as a planning contract, not just a reporting surface.
- Prefer updating the project profile when the same answers recur across waves.
- Use [docs/reference/sample-waves.md](../reference/sample-waves.md) when you want examples of denser human-authored waves that combine multiple modern surfaces such as `cont-EVAL`, delegated benchmark families, or proof-first live validation.
