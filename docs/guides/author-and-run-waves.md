# Authoring And Running Waves

This is the shortest path from "I need a new wave" to "the launcher is ready to run it."

Use this guide first. The narrower planner and terminal-surface pages remain useful when you need extra detail, but most operators should not need to assemble the workflow from multiple docs.

## 1. Set Repo Defaults Once

Start by teaching the planner how this repo usually works:

```bash
pnpm exec wave project setup
pnpm exec wave project show --json
```

The saved project profile remembers:

- default oversight mode
- default terminal surface
- default draft template
- default lane
- typed deploy environments

That keeps later drafts consistent and removes repeated bootstrap questions.

## 2. Draft The Wave

Generate a structured draft:

```bash
pnpm exec wave draft --wave 1 --template implementation
```

The planner writes two artifacts:

- `docs/plans/waves/specs/wave-<n>.json`
- `docs/plans/waves/wave-<n>.md`

The JSON spec is the planner-owned structured artifact. The markdown wave is still the launcher-owned execution surface.

When you review the generated wave, tighten the parts the planner cannot fully infer:

- file ownership
- validation commands
- proof artifacts
- `cont-EVAL` targets when needed
- security review expectations when needed
- explicit `### Skills` only where defaults are not enough

If you want examples of denser hand-authored waves, read [docs/reference/sample-waves.md](../reference/sample-waves.md).

## 3. Choose The Execution Posture

Every wave should be authored with an explicit operating posture in mind:

- `oversight`
  Best default. Use when a human may need to inspect progress, answer clarifications, or approve risky steps.
- `dark-factory`
  Use only when environments, validation, rollback, and closure evidence are already explicit enough for routine execution without human intervention.

Human feedback is an escalation path, not the operating mode itself. The launcher still tries to resolve clarification inside the orchestration loop before creating a human ticket.

## 4. Choose The Operator Surface

Live runs always execute in `tmux`. The terminal surface only decides how you attach:

- `vscode`
  VS Code gets temporary attach entries for the live tmux sessions.
- `tmux`
  Terminal-native operation with no VS Code integration.
- `none`
  Dry-run only.

Recommended defaults:

- local interactive work: `vscode`
- remote shell or devbox: `tmux`
- CI or validation-only work: `none` with `--dry-run`

## 5. Dry-Run Before Live Execution

Treat dry-run as the quality gate for the authored wave:

```bash
pnpm exec wave launch --lane main --start-wave 1 --end-wave 1 --dry-run --no-dashboard
```

Check that the dry-run artifacts reflect the wave you meant to author:

- resolved executors and overlays look correct
- ownership is narrow and explicit
- skills and Context7 inputs are attached where expected
- proof and closure requirements match the actual task
- no ambiguous prompts or missing deliverables remain

## 6. Launch Live

When the dry-run artifacts look correct, launch the wave with the operator surface you actually want:

```bash
pnpm exec wave launch --lane main --start-wave 1 --end-wave 1 --terminal-surface vscode
pnpm exec wave launch --lane main --start-wave 1 --end-wave 1 --terminal-surface tmux --keep-sessions
```

Useful flags:

- `--no-dashboard`
  Skip the dashboard session.
- `--keep-sessions`
  Preserve tmux sessions for inspection after the wave completes.
- `--keep-terminals`
  Preserve temporary VS Code terminal entries.

## 7. Understand Closure

A wave is not done when an implementation agent says it is done. Closure depends on the combined runtime surfaces:

- implementation contracts pass
- required deliverables exist
- proof artifacts exist when the wave requires them
- dependencies and helper assignments are resolved
- `cont-EVAL` satisfies declared targets when present
- security review publishes its report and final marker when present
- integration, docs, and `cont-QA` all pass

For the detailed execution model, read [docs/concepts/what-is-a-wave.md](../concepts/what-is-a-wave.md).

## Supporting Detail

Use these pages when you need deeper detail rather than the main workflow:

- [docs/guides/planner.md](./planner.md)
- [docs/guides/terminal-surfaces.md](./terminal-surfaces.md)
- [docs/concepts/operating-modes.md](../concepts/operating-modes.md)
- [docs/reference/runtime-config/README.md](../reference/runtime-config/README.md)
