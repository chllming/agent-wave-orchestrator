# Railway Verification Commands

Reference for verifying Railway deployment state. Prefer MCP when available; fall back to CLI.

## Service Discovery
- MCP: Use railway_service_list to enumerate all services in the project.
- CLI: `railway service list`

## Deploy Status
- MCP: Use railway_deployment_list with service ID to see recent deployments.
- CLI: `railway status`
- Key fields: deployment ID, status (SUCCESS/BUILDING/DEPLOYING/FAILED/CRASHED), created timestamp.

## Build Logs
- MCP: Use railway_deployment_logs with deployment ID.
- CLI: `railway logs --deployment <id>`
- Look for: build completion, Nixpacks/Dockerfile detection, dependency install success, start command.

## Environment Variables
- MCP: Use railway_variable_list with service and environment IDs.
- CLI: `railway variables`
- Verify: required variables are set, no stale values, no accidentally exposed secrets.

## Domain Bindings
- MCP: Use railway_custom_domain_list or railway_service_domain_list.
- CLI: `railway domain`
- Verify: custom domains are attached, DNS is configured, SSL certificates are active.

## Service Health
- After deploy, verify the service is actually responding:
  - Check deploy status is SUCCESS, not BUILDING or CRASHED.
  - If the service has a health endpoint, verify it returns 200.
  - Check for crash loops: multiple rapid deployments with CRASHED status.

## Rollback
- Redeploy a previous known-good deployment:
  - MCP: Use railway_deployment_redeploy with the last healthy deployment ID.
  - CLI: `railway redeploy --deployment <id>`
- Revert variables if the failure was config-related.
