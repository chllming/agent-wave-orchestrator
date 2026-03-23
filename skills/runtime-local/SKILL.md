# Local Runtime

<!-- CUSTOMIZE: Add project-specific smoke validation targets, artifact paths, or local test commands below. -->

## Core Rules

- The local executor is a smoke surface, not a substitute for real external integrations.
- Focus on prompt shape, file ownership, and artifact expectations.
- Do not claim live deploy or external-environment proof from local smoke execution alone.
- Treat local validation as a pre-flight check. It catches structural errors, not runtime correctness.

## Scope Limitations

The local runtime cannot prove certain categories of state:

- **No live deploy proof** -- local execution cannot verify that a service is running in Railway, AWS, Kubernetes, or any remote environment.
- **No external state proof** -- local execution cannot confirm database state, DNS propagation, certificate validity, or third-party API health.
- **No real executor sessions** -- local smoke runs do not invoke Claude, Codex, or OpenCode. They validate the prompt and artifacts that would be sent to those runtimes.
- **No network-dependent verification** -- health checks, endpoint tests, and webhook confirmations require a real runtime with network access.

When a deliverable requires any of the above, record the gap explicitly. Do not approximate.

## Smoke Validation Checklist

When running a local smoke validation, verify each of the following:

1. **Prompt structure** -- the compiled task prompt is valid, contains all required sections (role, exit contracts, file ownership, shared context), and is within size limits.
2. **File ownership declarations** -- every file listed in ownership exists in the repo or has a clear creation expectation. No ownership conflicts between agents.
3. **Deliverable paths** -- every exit contract deliverable references a concrete path or artifact. No dangling references.
4. **Marker syntax** -- all marker templates in the prompt match the expected format from wave-core. Parsers will reject malformed markers.
5. **Skill resolution** -- all skills referenced in the wave definition resolve to existing skill directories with valid `skill.json` and `SKILL.md` files.
6. **Context bundle integrity** -- if overlays or context bundles are generated, they exist at the declared paths and are non-empty.
7. **Role assignment consistency** -- each agent has exactly one role, and the role matches a known role skill.
8. **Proof artifact declarations** -- if the wave declares `### Proof artifacts`, verify the paths are concrete and plausible. Local smoke cannot verify artifact content but can validate declaration structure.
9. **Control-plane readiness** -- verify the control-plane directory structure exists. Local smoke validates directory layout, not event content.

Report each check as pass, fail, or skip with a one-line reason.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Project-specific artifact paths to validate
  - Additional structural checks for your wave definitions
  - Custom prompt size limits
  - Local test commands to run as part of smoke validation
-->
