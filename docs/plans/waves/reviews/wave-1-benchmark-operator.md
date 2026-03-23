# Wave 1 Benchmark Operator Review

## Scope

This document reviews the `SWE-bench Pro` 10-task `full-wave` review-only batch run.

- manifest: `docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json`
- command config: `docs/evals/external-command-config.swe-bench-pro.json`
- source evidence: recorded aggregate results plus per-task verifier stdout/stderr logs and integration summaries from the benchmark worktree pass

Command used:

```bash
node "scripts/wave.mjs" benchmark external-run \
  --adapter swe-bench-pro \
  --manifest docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json \
  --arm full-wave \
  --command-config docs/evals/external-command-config.swe-bench-pro.json \
  --model-id gpt-5-codex \
  --executor-id codex \
  --executor-command "codex exec" \
  --tool-permissions "Read,Write,Edit,Bash" \
  --temperature 0 \
  --reasoning-effort high \
  --max-wall-clock-minutes 15 \
  --max-turns 250 \
  --retry-limit 0 \
  --verification-harness official-swe-bench-pro \
  --dataset-version public-v1 \
  --output-dir .tmp/wave-benchmarks/external/swe-bench-pro-full-wave-review-10 \
  --json
```

This was a `review-only` run, not a matched `single-agent` versus `full-wave` comparison.

## Verdict

- Official resolved score: `0/10`
- Interpretable capability score: `not valid for external comparison`
- Recommendation: `blocked`

Why this is blocked:

- `7/10` tasks reached the official SWE-bench Pro evaluator, but the evaluator could not pull the expected Docker image tag from `jefzda/sweap-images`, so those zeros are not trustworthy model-performance failures.
- `3/10` tasks failed earlier in harness or repository setup before a trustworthy benchmark judgment existed.
- The raw aggregate `reviewBuckets` from the runner said `harness-env=10`; that was directionally closer to the truth than `incorrect-patch`, but still too coarse. The corrected manual buckets below are the review-ready interpretation.

## Aggregate Metrics

Recorded totals from the 10-task batch:

- tasks: `10`
- solved: `0`
- success rate: `0%`
- total wall clock: `2810439 ms`
- token totals:
  - `input_tokens = 59155820`
  - `cached_input_tokens = 54180608`
  - `output_tokens = 278308`

Corrected manual failure buckets:

- `7` verifier-image failures
- `3` setup or harness failures before trustworthy scoring
- `0` trustworthy patch-quality failures established by the official verifier

## Task Scorecard

Scoring convention used here:

- `official score`: the raw `0/1` result recorded by the run artifacts
- `review score`: whether that official score is trustworthy enough to interpret as model capability evidence

| Task | Repo | Official score | Review score | Wall clock | Notes |
| --- | --- | --- | --- | ---: | --- |
| `instance_NodeBB__NodeBB-04998908ba6721d64eba79ae3b65a351dcfbc5b5-vnan` | `NodeBB/NodeBB` | `0` | `invalidated` | `807464 ms` | Full-wave solve ran and produced a patch, but the official evaluator failed to pull `jefzda/sweap-images:nodebb.nodebb-NodeBB__NodeBB-04998908ba6721d64eba79ae3b65a351dcfbc5b5` and returned `None`. |
| `instance_qutebrowser__qutebrowser-f91ace96223cac8161c16dd061907e138fe85111-v059c6fdc75567943479b23ebca7c07b5e9a7f34c` | `qutebrowser/qutebrowser` | `0` | `invalidated` | `369151 ms` | Solve ran and produced a patch, but the official evaluator failed to pull the expected `qutebrowser` image tag and returned `None`. |
| `instance_ansible__ansible-f327e65d11bb905ed9f15996024f857a95592629-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5` | `ansible/ansible` | `0` | `setup-failure` | `499457 ms` | Patch extraction failed during `git diff`; the task workspace had local `.venv` churn, so this never reached a trustworthy verifier judgment. |
| `instance_internetarchive__openlibrary-4a5d2a7d24c9e4c11d3069220c0685b736d5ecde-v13642507b4fc1f8d234172bf8129942da2c2ca26` | `internetarchive/openlibrary` | `0` | `invalidated` | `95 ms` | The official evaluator failed to pull the expected `openlibrary` image tag and returned `None`. |
| `instance_gravitational__teleport-3fa6904377c006497169945428e8197158667910-v626ec2a48416b10a88641359a169d99e935ff037` | `gravitational/teleport` | `0` | `setup-failure` | `64527 ms` | `wave init` failed because the repo already contained Wave bootstrap files and the harness still used the non-adopt path. |
| `instance_navidrome__navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e` | `navidrome/navidrome` | `0` | `invalidated` | `417099 ms` | Solve ran and produced a patch, but the official evaluator failed to pull the expected `navidrome` image tag and returned `None`. |
| `instance_element-hq__element-web-33e8edb3d508d6eefb354819ca693b7accc695e7` | `element-hq/element-web` | `0` | `invalidated` | `510260 ms` | Solve ran and produced a patch, but the official evaluator failed to pull the expected `element-web` image tag and returned `None`. |
| `instance_future-architect__vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904` | `future-architect/vuls` | `0` | `invalidated` | `115 ms` | The official evaluator failed to pull the expected `vuls` image tag and returned `None`. |
| `instance_flipt-io__flipt-e42da21a07a5ae35835ec54f74004ebd58713874` | `flipt-io/flipt` | `0` | `invalidated` | `104 ms` | The official evaluator failed to pull the expected `flipt` image tag and returned `None`. |
| `instance_protonmail__webclients-2c3559cad02d1090985dba7e8eb5a129144d9811` | `protonmail/webclients` | `0` | `setup-failure` | `142167 ms` | Repository preparation failed before solving because the target commit tree could not be read locally (`fatal: Could not parse object ...`). |

## What The Batch Actually Tells Us

This run does establish a few useful things:

- The 10-task `full-wave` review path is now executable end to end through `wave benchmark external-run --arm full-wave`.
- The harness now persists enough task-level evidence to audit failures: patch paths, verifier stdout and stderr, output dirs, and integration summaries.
- At least several tasks did enter real multi-agent execution and produced patches before the verifier step.

This run does **not** establish:

- a trustworthy `SWE-bench Pro` success rate for `full-wave`
- a comparison against public leaderboard systems
- a comparison against our own `single-agent` baseline

## Comparison Context

Context only, not head-to-head:

- The public `SWE-bench Pro` leaderboard reports top public-set systems in roughly the `41%` to `46%` range across the full public benchmark, not `0%`.
- Because this review run was invalidated by verifier-image and setup failures, the current `0/10` should not be treated as a clean external capability comparison against those systems.

Official sources:

- `https://scale.com/leaderboard/swe_bench_pro_public`
- `https://scaleapi.github.io/SWE-bench_Pro-os/`

## Follow-up Required Before Publication

- Fix verifier image resolution so the official evaluator can actually score all selected tasks.
- Fix the `teleport` harness path so repos with existing Wave bootstrap files use the adopt-existing flow when needed.
- Fix the `ansible` patch-extraction path so local environment bootstrapping cannot pollute the generated patch.
- Re-run the same frozen 10-task manifest after those harness fixes before making any external-performance claim.
