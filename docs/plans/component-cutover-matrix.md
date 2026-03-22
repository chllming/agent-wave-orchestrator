# Component Cutover Matrix

This matrix is the canonical place to answer which harness components are expected to be working at which maturity level.

The starter entries reflect the snapshot shipped in this repository. Replace the component catalog and promotion map when you adapt the harness to a real product repo.

## Levels

- `inventoried`
- `contract-frozen`
- `repo-landed`
- `baseline-proved`
- `pilot-live`
- `qa-proved`
- `fleet-ready`
- `cutover-ready`
- `deprecation-ready`

## Components

- `wave-parser-and-launcher`: parser, manifest, launcher, and dry-run execution flow
- `executor-abstraction-and-prompt-transport`: executor selection, prompt overlays, and transport into `codex`, `claude`, `opencode`, or `local`
- `closure-sweep-and-role-gates`: documentation steward, cont-QA, and post-implementation closure logic
- `context7-scope-and-prefetch`: Context7 bundle resolution, prefetch, cache, and prompt injection
- `state-artifacts-and-feedback`: status summaries, dashboards, logs, message boards, and human feedback queue
- `starter-docs-and-adoption-guidance`: starter README, shared-plan docs, and adoption instructions

## Current Starter Levels

| Component | Current level | Proof surfaces |
| --- | --- | --- |
| `wave-parser-and-launcher` | `repo-landed` | wave parsing, launcher dry-run, wave parser tests |
| `executor-abstraction-and-prompt-transport` | `repo-landed` | executor launch specs, runtime overlays, executor tests |
| `closure-sweep-and-role-gates` | `repo-landed` | structured gate markers, closure sweep, launcher tests |
| `context7-scope-and-prefetch` | `repo-landed` | bundle resolution, prefetch cache, prompt injection |
| `state-artifacts-and-feedback` | `repo-landed` | status summaries, dashboards, feedback queue |
| `starter-docs-and-adoption-guidance` | `repo-landed` | starter wave docs, adoption guidance, shared-plan closure |

## Starter Wave Promotions

- Wave 0 promotes `wave-parser-and-launcher` to `repo-landed`.
- Wave 0 promotes `starter-docs-and-adoption-guidance` to `repo-landed`.

## Usage

- Keep architecture and repository guidance docs descriptive.
- Keep wave-by-wave component maturity and promotion targets here.
- `currentLevel` is the canonical post-wave state of the repo, not a future plan. When a wave promotes a component, update `currentLevel` to the promoted target before closure.
- When component promotion gating is active, wave files must match this matrix exactly.
