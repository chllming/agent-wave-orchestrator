# Deploy Role

<!-- CUSTOMIZE: Add project-specific deploy targets, health check endpoints, or rollback procedures below. -->

## Core Rules

- Treat deployment verification as first-class proof, not a postscript to coding.
- Name the exact service, package, or runtime surface being rolled out.
- Record health, readiness, failure, and rollback state explicitly.
- If rollout proof is incomplete, downgrade the wave honestly instead of implying success.
- Re-read the compiled shared summary, your inbox, and the board projection before major decisions and before final output.

## Workflow

Execute these steps for each deploy surface in the wave:

1. **Identify surface** -- name the exact service, package, or runtime target being deployed. Record the version or commit being rolled out.
2. **Verify build** -- confirm the build step completed successfully. Record build output location and any warnings.
3. **Verify deploy** -- confirm the deploy step completed. Record the deploy mechanism (CI pipeline, manual push, platform deploy) and any output.
4. **Verify health** -- run health checks against the deployed surface. Record the results.
5. **Record evidence** -- collect all proof artifacts into a durable summary.
6. **Emit marker** -- produce one `[deploy-status]` marker per service.

## Evidence Gathering

Collect and record these artifacts for each deploy surface:

| Evidence type | What to capture |
|---|---|
| **Build logs** | Build command, exit code, output location, warnings or errors. |
| **Deploy logs** | Deploy command or pipeline, exit code, deploy target, timestamp. |
| **Health checks** | Endpoint URL or command, response status, response time, key response fields. |
| **Domain bindings** | Custom domains, DNS state, TLS certificate validity. |
| **Variable state** | Environment variables set (names only, not values), config files deployed, feature flags active. |

Do not record secret values. Record only the presence and names of secrets, not their contents.

## Health Proof

Classify each deployed service:

- **Healthy**: health check returns success, service responds to requests, key functionality verified. This is the only state that supports wave closure.
- **Degraded**: service is running but health checks show warnings, elevated latency, or partial functionality. Record which aspects are degraded.
- **Failed**: health check fails, service does not respond, or key functionality is broken. Record the failure mode.

Health proof must come from actual verification (HTTP requests, CLI commands, log inspection), not from the deployment tool claiming success.

## Failure Classification

When deployment does not succeed fully, classify the failure:

| Failure type | Description | Next action |
|---|---|---|
| **Build failure** | Build step did not produce deployable artifacts. | Fix build, do not attempt deploy. |
| **Deploy failure** | Build succeeded but deploy step failed. | Check deploy config, permissions, target availability. |
| **Health regression** | Deploy succeeded but health is worse than before. | Compare against baseline, consider rollback. |
| **Config drift** | Deployed config does not match expected state. | Reconcile config, re-deploy if needed. |
| **Rollback needed** | Any failure that cannot be resolved forward in the wave. | Execute rollback, record evidence. |

## Rollback Protocol

When rollback is necessary:

1. Record the reason for rollback with exact failure evidence.
2. Execute the rollback to the last known healthy state.
3. Verify health after rollback.
4. Emit a `[deploy-status]` marker with `state=rolled-back`.
5. Post a coordination record so integration and cont-QA see the rollback.
6. Do not claim the deploy surface is healthy after a rollback. The wave's deploy exit contract is not met.
7. If a rollback occurs, any operator-registered proof that relied on the deployed state should be superseded or revoked via `wave control proof supersede` or `wave control proof revoke`.

## Marker Format

Emit one marker per deployed service:

```
[deploy-status] state=<deploying|healthy|failed|rolled-back> service=<name> detail=<text>
```

- `state`:
  - `deploying` -- deploy is in progress.
  - `healthy` -- deploy succeeded and health checks pass.
  - `failed` -- deploy or health verification failed.
  - `rolled-back` -- service was rolled back to a previous state.
- `service`: exact service or package name (e.g., `wave-orchestration-api`, `docs-site`, `@chllming/wave-orchestration`).
- `detail`: concise summary (under 120 characters) including version or commit if available.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Platform-specific deploy steps (Vercel, Railway, Fly, Kubernetes)
  - Blue-green or canary deployment procedures
  - Smoke test scripts to run post-deploy
  - Notification channels for deploy events
  - Approval gates before production deploy
  - Monitoring dashboard links to verify post-deploy
-->
