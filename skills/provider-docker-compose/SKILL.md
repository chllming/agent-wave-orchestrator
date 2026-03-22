# Docker Compose

<!-- CUSTOMIZE: Add your compose file paths, service names, and health check endpoints below. -->

## Core Rules

- Use compose file names, service names, ports, and health checks exactly.
- Distinguish local container health from production readiness.
- Record the exact compose commands or logs used as proof.
- Make service dependency and readiness ordering explicit when rollout depends on it.
- Container running is not the same as application healthy. Always verify beyond container state.

## Service Identification

Every Docker Compose verification must specify:

- **Compose file path** -- the exact path to the compose file (e.g., `docker-compose.yml`, `docker-compose.prod.yml`, `compose.yaml`).
- **Service names** -- exact names as defined in the compose file.
- **Exposed ports** -- host:container port mappings for each service.
- **Volume mounts** -- named volumes or bind mounts that carry persistent state.
- **Network names** -- custom networks defined in the compose file, if any.

Do not use shorthand. `the database service` is insufficient. `service postgres in docker-compose.yml, port 5432:5432, volume pgdata:/var/lib/postgresql/data` is correct.

## Verification Procedures

### Container State

```
docker compose -f <file> ps
docker compose -f <file> ps --format json
```

Confirm: all expected services are listed, state is `running` (not `exited`, `restarting`, or `created`), health status is `healthy` if healthcheck is defined.

### Service Logs

```
docker compose -f <file> logs <service> --tail=50
docker compose -f <file> logs <service> --since 5m
```

Confirm: no fatal errors, startup completed successfully, application-level health indicators are positive.

### Health Checks

```
docker compose -f <file> exec <service> <health-command>
curl -s http://localhost:<port>/health
```

Confirm: health endpoint returns expected status code and body. If the service defines a Docker healthcheck, verify it shows `healthy` in `docker compose ps`.

### Detailed Container State

```
docker inspect <container-name-or-id>
docker inspect --format='{{.State.Health.Status}}' <container-name-or-id>
```

Use for: investigating restart reasons, checking exact health check output, verifying environment variables and mount points inside the container.

<!-- CUSTOMIZE: Add project-specific verification commands or health endpoints here. -->

## Local vs Production

Do not conflate container state with application readiness:

- **Container running** -- the process started. This does not mean it is accepting requests or connected to its dependencies.
- **Container healthy** -- the Docker healthcheck passed. This confirms a basic liveness check but may not cover all application functionality.
- **Application healthy** -- the application responds correctly to real requests, is connected to all dependencies, and is processing work as expected.
- **Production ready** -- the full stack is up, all integration points are verified, and the environment matches production configuration.

When reporting status, be precise about which level of health you verified. If you only confirmed container state, say so.

## Dependency Ordering

Compose services often depend on each other. Verify startup order:

1. **`depends_on` declarations** -- confirm they are present in the compose file for services that need them.
2. **Healthcheck-based readiness** -- `depends_on` with `condition: service_healthy` ensures the dependency is ready, not just started. Prefer this over bare `depends_on`.
3. **Startup order verification** -- after `docker compose up`, check logs to confirm services started in the correct order and downstream services did not fail due to missing upstream dependencies.
4. **Retry behavior** -- if a service connects to a dependency on startup, verify it has retry logic or that the dependency was healthy before the service started.

When dependency ordering issues cause failures, record the exact failure chain: which service failed, which dependency was not ready, and what error appeared.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Compose file paths: <comma-separated-list>
  - Service names: <comma-separated-list>
  - Health check endpoints: <service> -> <url>
  - Required environment variables per service
  - Volume backup and restore procedures
  - Network topology notes
-->
