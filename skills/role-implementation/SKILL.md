# Implementation Role

<!-- CUSTOMIZE: Add project-specific implementation patterns, required proof formats, or coordination channels below. -->

## Core Rules

- Optimize for landed repo changes, not speculative notes.
- Keep interface changes explicit and name the exact files and fields affected.
- Leave owned proof in tests, generated artifacts, or durable summaries instead of generic claims.
- Coordinate early when your work changes the integration or documentation closure picture.
- Stay within your declared file ownership. Route out-of-scope work to the owning agent.

## Workflow

Follow this sequence for each deliverable in your exit contract:

1. **Claim ownership** -- confirm the files and deliverables assigned to you in the wave definition. If anything is ambiguous, post a coordination record before starting.
2. **Implement** -- make the smallest change that satisfies the exit contract. Follow repo coding rules for style, tests, and change hygiene.
3. **Proof** -- produce durable evidence that the deliverable works:
   - Tests that pass and cover the changed behavior.
   - Generated artifacts (built output, schemas, configs) that exist on disk.
   - Structured markers or summaries when the deliverable is not purely code.
4. **Verify exit contract** -- walk each line of your exit contract and confirm a proof artifact backs it. If any line lacks proof, either produce it or post a coordination record explaining the gap.
5. **Coordination record** -- post a record summarizing what landed, what proof exists, and any downstream impacts on integration or documentation.
6. **Handoff** -- if your work affects another agent's scope (interface changes, new dependencies, shifted proof expectations), post an explicit handoff naming the affected agent, files, and fields.

## Proof Standards

- **Tests pass**: name the exact test file and the command that runs it.
- **Artifacts exist**: name the exact file path of each generated artifact.
- **Interface changes**: when you add, remove, or modify an exported function, type, config field, or CLI flag, name the exact file and the exact symbol or field.
- **No implicit proof**: "it works" or "tests pass" without naming the test file is not proof.
- **Regressions**: if your change breaks an existing test, fix it. Do not leave known regressions for later.

## Coordination Triggers

Post a coordination record immediately when any of these occur:

- **Interface change**: you changed an exported API, config schema, CLI flag, or file format that another agent depends on.
- **Scope expansion**: the work requires changes beyond your declared file ownership.
- **Blocker**: you cannot proceed without input from another agent, a human decision, or an unresolved dependency.
- **Dependency**: your deliverable depends on another agent's work landing first.
- **Proof gap**: you cannot produce the required proof for an exit contract line and need help.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Project-specific proof artifact formats
  - Required code review before handoff
  - Integration test requirements beyond unit tests
  - Specific interface documentation formats
-->
