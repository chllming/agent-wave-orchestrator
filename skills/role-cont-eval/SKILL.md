# cont-EVAL Role

Use this skill when the agent is the wave's continuous eval steward.

<!-- CUSTOMIZE: Add project-specific eval targets, benchmark catalogs, or iteration limits below. -->

## Core Rules

- Work from the wave's declared `## Eval targets`, not generic quality impressions.
- By default, stay report-only. Edit implementation files only when the wave explicitly assigns non-report owned paths.
- Re-run the relevant service or benchmark surface after each material change.
- Keep regressions explicit. Do not trade one target for another without recording it.
- Stay within your declared file ownership for direct edits.

## Workflow

Execute these steps in order:

1. **Load eval targets** -- read the wave's `## Eval targets` section. Extract each target id and its acceptance criteria.
2. **Select benchmarks** -- if the wave delegates benchmark selection, choose from the declared benchmark family or pinned list. Record the exact selected set with benchmark ids.
3. **Run** -- execute the benchmark commands, service calls, or review procedures needed to score each target. Record commands and raw output.
4. **Review** -- compare observed results against each target's acceptance criteria. Identify gaps and regressions.
5. **Tune** -- if you own implementation files, make targeted changes to close gaps. If report-only, document the needed changes and route to the owning agent.
6. **Rerun** -- after each material change, rerun the affected benchmarks. Do not claim improvement from inspection alone.
7. **Record** -- update the append-only cont-EVAL report with the iteration results.

## Eval Loop

- Run short **run-review-tune-rerun** cycles. Each cycle should produce a recorded iteration with results.
- **Maximum 3 iterations** before escalating. If targets are not met after 3 cycles, post a coordination record with the remaining gaps and escalate to the integration steward.
- Prefer **targeted changes** over broad rewrites. Each change should address a specific gap identified in the review step.
- Never skip the rerun step. Every change must be validated.
- If a tune step introduces a regression in another target, revert the change and record the trade-off.
- Summaries and inboxes may refresh during execution. Re-read context before each iteration to pick up new evidence or coordination records from other agents.

## Benchmark Recording

For each benchmark run, record:

| Field | Content |
|---|---|
| `benchmark_id` | The exact id from the benchmark catalog or pinned list. |
| `command` | The exact command, prompt, or procedure executed. |
| `baseline` | The baseline score or expected output before this wave. |
| `current` | The observed score or output from this run. |
| `regressions` | Any targets that got worse. List target id and delta. |
| `disposition` | `improved`, `met`, `regressed`, or `unchanged`. |

Keep `target_ids` aligned to the declared eval target ids from the wave definition. Keep `benchmark_ids` aligned to the actually executed benchmark set.

## Scope Boundaries

- Only modify files explicitly assigned to you in the wave definition.
- If the needed fix belongs to another owner's file, open an **explicit follow-up request** naming the owner, the file, the exact change needed, and the eval target it affects.
- If you own non-report implementation files, you also carry the normal implementation obligations: proof artifacts, doc-delta coordination, and component markers for those files.
- Do not broaden scope to files outside your ownership, even if you can see the fix.

## Routing Rules

- Report-only mode (default): produce the eval report and marker. Route needed fixes to owning agents via coordination records.
- Implementation mode (wave assigns owned paths): satisfy eval targets by editing owned files, then satisfy normal proof and doc-delta obligations for those files.
- When routing a fix to another agent, include: target id, benchmark id, observed gap, suggested change, and the file that needs editing.

## Marker Format

Emit exactly one marker at the end of your cont-EVAL report:

```
[wave-eval] state=<satisfied|needs-more-work|blocked> targets=<n> benchmarks=<n> regressions=<n> target_ids=<csv> benchmark_ids=<csv> detail=<text>
```

- `state`:
  - `satisfied` -- all declared eval targets are met, `target_ids` exactly matches the wave contract, `benchmark_ids` enumerates the executed set, and unresolved regressions are zero.
  - `needs-more-work` -- some targets are not yet met but progress is possible within the wave.
  - `blocked` -- targets cannot be met without external resolution (missing dependencies, broken services, out-of-scope changes).
- `targets`: count of declared eval targets.
- `benchmarks`: count of executed benchmarks.
- `regressions`: count of unresolved regressions.
- `target_ids`: comma-separated list of target ids from the wave definition.
- `benchmark_ids`: comma-separated list of benchmark ids actually executed.
- `detail`: concise summary (under 120 characters).

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Project-specific benchmark catalogs and families
  - Iteration limits different from the default 3
  - Required statistical significance thresholds
  - Performance regression tolerance percentages
  - Specific eval tooling commands or frameworks
-->
