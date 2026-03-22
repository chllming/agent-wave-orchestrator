# Railway

<!-- CUSTOMIZE: Add your Railway project ID, service names, environment names, and domain mappings below. -->

## Core Rules

- Prefer the Railway MCP or Railway CLI as the source of truth for deployment, environment, and service state.
- Keep service names, environment names, domains, and deployment IDs exact.
- Record what was verified: build logs, deploy logs, variables, domains, or rollout state.
- If Railway state is degraded or ambiguous, leave a concrete deploy risk instead of implying healthy rollout.
- Do not treat a successful build as proof of a healthy deploy. Build and deploy are separate proof surfaces.

## Source of Truth

Use these sources in preference order:

1. **Railway MCP** -- highest fidelity. Use MCP tools when available for service state, deploy status, and variable queries.
2. **Railway CLI** -- direct CLI commands when MCP is not available. Requires `railway` CLI authenticated and linked to the correct project.
3. **Railway Dashboard** -- lowest preference. Use only when CLI and MCP are both unavailable. Dashboard observations must be recorded with explicit timestamps.

Never mix sources for a single verification claim. State which source you used.

## Verification Procedures

### Service List and Status

```
railway status
railway service list
```

Confirm: service exists, is linked to the correct project and environment, current deploy state.

### Deploy Status

```
railway logs --deploy
railway logs --build
```

Confirm: latest deployment ID, build success or failure, deploy health (running, crashed, pending).

### Environment Variables

```
railway variables
railway variables --environment <env-name>
```

Confirm: required variables are set, no placeholder or empty values for critical keys, no secret leakage in logs.

### Domain Bindings

```
railway domain
```

Confirm: custom domains are bound, SSL provisioned, no dangling or conflicting bindings.

### Health Verification

After confirming deploy status, verify the application is responding:

- Check the service URL or custom domain with a health endpoint.
- Confirm HTTP status code and response body match expectations.
- If health check fails but deploy shows running, classify as deploy-healthy-but-app-unhealthy.

<!-- CUSTOMIZE: Add your project-specific health endpoints, expected responses, and timeout thresholds here. -->

## Evidence Format

When recording Railway verification, use this structure:

```
Service: <exact-service-name>
Environment: <environment-name>
Deploy ID: <deploy-id>
Deploy Status: <building|deploying|running|crashed|removed>
Build Status: <success|failed|pending>
Domains: <comma-separated-domain-list>
Health: <healthy|unhealthy|unknown>
Variables Confirmed: <yes|partial|no>
Source: <MCP|CLI|Dashboard>
Timestamp Context: <when-verified>
```

Omit fields that were not checked. Do not fill in fields with assumed values.

## Failure Classification

Classify Railway failures precisely:

- **Build failure** -- Nixpacks or Dockerfile build step failed. Check build logs for the exact error. Common causes: missing dependency, invalid Dockerfile, incompatible runtime version.
- **Deploy failure** -- build succeeded but the service crashed on startup. Check deploy logs for crash loop, port binding failure, or missing environment variable.
- **Domain failure** -- service is running but the domain is not resolving, SSL is not provisioned, or the domain binding is missing.
- **Variable drift** -- expected environment variables are missing, empty, or have unexpected values. Compare against the wave definition or config source.
- **Region/resource failure** -- service is pending due to resource constraints or region availability.

Name the failure type explicitly in the `[deploy-status]` marker detail field.

## Rollback

When a deploy fails and rollback is needed:

1. Identify the last known healthy deployment ID from deploy logs or service history.
2. Redeploy the previous version using `railway rollback` or by redeploying the previous commit.
3. Verify the rollback deploy reaches running state and health checks pass.
4. If variables were changed as part of the failed deploy, revert them explicitly.
5. Emit `[deploy-status] state=rolled-back service=<name> detail=<reason and target deploy ID>`.

Trigger rollback when: service is crash-looping, health checks fail after a reasonable timeout, or the task explicitly requests rollback.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Railway project ID: <your-project-id>
  - Service names: <comma-separated-list>
  - Environment names: production, staging, development
  - Domain mappings: <service> -> <domain>
  - Health check endpoints: <service> -> <path>
  - Required environment variables per service
  - Build timeout thresholds
-->
