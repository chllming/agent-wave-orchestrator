# Custom Deploy

<!-- CUSTOMIZE: Add your custom verification commands, health endpoints, deployment scripts, and environment-specific conventions below. -->

## Core Rules

- Make the custom environment contract explicit before treating it as proved.
- Name the exact verification surface, command, or operator artifact used as evidence.
- If the environment lacks a stable verification path, record the resulting deploy risk.
- Do not borrow verification assumptions from standard providers. Custom environments have custom proof requirements.
- Every claim of "verified" must reference a concrete command, output, or artifact.

## Contract Definition

Before claiming any deploy target is verified in a custom environment, define the contract:

1. **Verification surface** -- what tool, command, API, or artifact serves as the source of truth for this environment's state? Name it exactly.
2. **Healthy signal** -- what specific output, status code, or artifact state means the deploy is healthy? Define the exact match criteria.
3. **Degraded signal** -- what output means the deploy is running but not fully healthy? Define the boundary between degraded and healthy.
4. **Failed signal** -- what output means the deploy has failed? Define the criteria that distinguish failure from degraded.
5. **Unknown signal** -- if the verification surface is unreachable or returns unexpected output, the state is unknown. Do not default to healthy or failed.

If any of these cannot be defined, record the gap as deploy risk before proceeding.

## Verification Surface

Name the exact verification mechanism:

- **Command-based** -- a CLI command that returns structured output. Preferred. Record the exact command, expected output format, and how to parse healthy/degraded/failed from it.
- **API-based** -- an HTTP endpoint that returns status. Record the URL, expected status code, expected response body or fields, and authentication method.
- **Artifact-based** -- a file, database record, or log entry that serves as proof. Record the exact path or query, expected content, and how freshness is determined.
- **Process-based** -- a running process or service that can be checked. Record the process name, how to check it, and what constitutes healthy state.

Prefer verification surfaces with machine-readable output. If the only evidence is human-readable prose (e.g., a dashboard screenshot), record that as a proof quality limitation.

If no stable verification surface exists for the custom environment, this is itself a deploy risk. Record:

```
Deploy Risk: No stable verification surface for <environment-name>.
Attempted: <what-was-tried>
Observed: <what-was-seen>
Gap: <what-remains-unknown>
```

## Risk Recording

When the custom environment lacks standard verification capabilities, record the full state:

1. **What was attempted** -- the exact commands, API calls, or checks that were run.
2. **What was observed** -- the exact output, including partial or ambiguous results.
3. **What remains unknown** -- the specific questions that could not be answered.
4. **Risk assessment** -- how the unknowns affect confidence in the deploy state. Be specific: "cannot confirm database migration ran" is useful; "some things are unclear" is not.

Include this risk record in the `[deploy-status]` marker detail field or as a separate coordination record.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Custom verification commands: <command> -> <expected-output>
  - Health endpoints: <url> -> <expected-status> -> <expected-body>
  - Deployment scripts: <script-path> -> <usage>
  - Environment-specific conventions: <env-name> -> <verification-approach>
  - Known proof gaps and accepted risk levels
-->
