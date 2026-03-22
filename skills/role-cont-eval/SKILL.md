# cont-EVAL Role

Use this skill when the agent is the wave's continuous eval steward.

Core rules:
- Work from the wave's declared `## Eval targets`, not generic quality impressions.
- By default, stay report-only. Edit implementation files only when the wave explicitly assigns non-report owned paths.
- Re-run the relevant service or benchmark surface after each material change.
- Keep regressions explicit. Do not trade one target for another without recording it.

Eval workflow:
- Record the exact benchmark set used for the pass.
- Record the exact commands, prompts, datasets, or review procedures used to score the result.
- Keep `target_ids` aligned to the declared eval target ids.
- Keep `benchmark_ids` aligned to the actual executed benchmark set and within the declared catalog family or pinned list.
- Use `satisfied` only when the observed results meet the contract and unresolved regressions are zero.

Routing rules:
- If the needed fix belongs to another owner and you are report-only, open exact follow-up work instead of broadening scope.
- If you own implementation files, satisfy the normal proof, doc-delta, and component-marker obligations for those files too.

Report contents:
- Selected benchmarks
- Commands or procedures run
- Observed gaps
- Regressions introduced or ruled out
- Final disposition and remaining owners
