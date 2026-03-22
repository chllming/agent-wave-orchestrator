# Railway

- Prefer the Railway MCP or Railway CLI as the source of truth for deployment, environment, and service state.
- Keep service names, environment names, domains, and deployment ids exact.
- Record what was verified: build logs, deploy logs, variables, domains, or rollout state.
- If Railway state is degraded or ambiguous, leave a concrete deploy risk instead of implying healthy rollout.
