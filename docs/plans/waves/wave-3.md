# Wave 3 - Structured Result Envelopes and Retry Isolation

**Commit message**: `Arch: add role-aware result envelopes and isolate retry subsystem`

## Component promotions

- executor-abstraction-and-prompt-transport: baseline-proved
- closure-sweep-and-role-gates: baseline-proved

## Context7 defaults

- bundle: node-typescript
- query: "JSON schema validation, discriminated unions, and deterministic state machines in Node.js"

## Agent A0: cont-QA

### Role prompts

- docs/agents/wave-cont-qa-role.md

### Executor

- id: codex
- model: gpt-5-codex
- codex.profile_name: review
- codex.search: true
- codex.json: true

### Context7

- bundle: none

### Prompt

```text
Primary goal:
- Verify that result envelopes are role-aware and that the retry engine is fully deterministic from stored state.

Required context before coding:
- Read docs/plans/end-state-architecture.md (sections: Agent Result Envelope, Retry Engine).
- Read docs/reference/repository-guidance.md.

Specific expectations:
- confirm envelopes use common header + role-specific typed payloads, not one universal blob
- confirm gate engine prefers envelope when present, falls back to legacy adapter
- confirm retry engine is testable from stored state without launching anything
- confirm retry plan contract includes all six fields: why, what invalidated, what reusable, what stage, what executor changes, what human inputs block
- confirm executor adapters locate/read/validate agent-produced envelopes rather than building them from log tails
- do not PASS if any phase engine reads from log tails as primary input

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-3-cont-qa.md
```

## Agent A8: Integration Steward

### Role prompts

- docs/agents/wave-integration-role.md

### Executor

- id: claude
- model: claude-sonnet-4-6

### Context7

- bundle: none

### Capabilities

- integration
- docs-shared-plan

### Prompt

```text
Synthesize the result envelope and retry isolation changes.

Required context before coding:
- Read docs/plans/end-state-architecture.md.
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

Verify:
- envelope migration path is clean: legacy adapter synthesizes envelope from log markers during migration, gate engine always sees the same shape
- retry engine reads only from control-plane materialization and gate verdicts
- all role-specific envelope sections have clear validation rules
- no circular dependencies between retry engine and gate engine

File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-3.md
- .tmp/main-wave-launcher/integration/wave-3.json
```

## Agent A9: Documentation Steward

### Role prompts

- docs/agents/wave-documentation-role.md

### Executor

- id: opencode
- opencode.files: docs/plans/end-state-architecture.md,docs/plans/current-state.md

### Context7

- bundle: none

### Prompt

```text
Update shared plan docs to reflect result envelopes and retry isolation.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
- docs/plans/wave-orchestrator.md
- docs/plans/component-cutover-matrix.md
- docs/plans/component-cutover-matrix.json
```

## Agent A1: Role-Aware Result Envelope

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript
- query: "TypeScript discriminated unions, JSON schema validation, zod or ajv schema patterns"

### Components

- closure-sweep-and-role-gates
- executor-abstraction-and-prompt-transport

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- scripts/wave-orchestrator/result-envelope.mjs
- test/wave-orchestrator/result-envelope.test.ts

### Prompt

```text
Implement role-aware structured result envelopes.

The envelope is NOT one universal blob. It uses a common header with role-specific typed optional payloads.

Common envelope header (all roles):
  {
    schemaVersion:     2,
    agentId:           string,
    waveNumber:        number,
    attempt:           number,
    completedAt:       ISO8601,
    exitCode:          number,
    role:              "implementation" | "integration" | "documentation" | "cont-qa" | "cont-eval" | "security" | "deploy",
    proof:             { state, completion, durability, proofLevel, detail },
    deliverables:      [{ path, exists, sha256 }],
    proofArtifacts:    [{ path, kind, exists, sha256, requiredFor }],
    gaps:              [{ kind, detail }],
    unresolvedBlockers:[{ kind, detail, blocking }],
    riskNotes:         [string]
  }

Role-specific payloads (typed optional sections):
  implementation: { docDelta, components }
  integration:    { integrationState: { state, claims, conflicts, blockers, detail } }
  documentation:  { docClosure: { state, paths, detail } }
  cont-qa:        { verdict, gateClaims }
  cont-eval:      { evalState: { state, targets, benchmarks, regressions, targetIds, benchmarkIds, detail } }
  security:       { securityState: { state, findings, approvals, detail } }
  deploy:         { deployState: { state, environment, healthCheck, rolloutArtifact, detail } }

Implementation:
1. Define the envelope schema with validation (result-envelope.mjs).
2. Add buildEnvelopeFromLegacySignals() adapter in agent-state.mjs that synthesizes an envelope from parsed log markers — so the gate engine always sees the same shape during migration.
3. Update the gate engine to prefer the envelope file when present, fall back to the legacy adapter.
4. Canonical snapshot path must be attempt-scoped: .tmp/<lane>-wave-launcher/results/wave-<N>/attempt-<A>/<agentId>.json (immutability requirement).
5. Update skills to instruct agents to emit the envelope file.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Agent Result Envelope).
- Read scripts/wave-orchestrator/agent-state.mjs (current log parsing).
- Read scripts/wave-orchestrator/launcher-gates.mjs (current gate reads).

File ownership (only touch these paths):
- scripts/wave-orchestrator/result-envelope.mjs
- scripts/wave-orchestrator/agent-state.mjs
- scripts/wave-orchestrator/launcher-gates.mjs
- test/wave-orchestrator/result-envelope.test.ts
```

## Agent A2: Retry Engine Isolation

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript

### Components

- closure-sweep-and-role-gates

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: none

### Deliverables

- scripts/wave-orchestrator/launcher-retry.mjs
- test/wave-orchestrator/retry-determinism.test.ts

### Prompt

```text
Harden the retry engine into a fully deterministic subsystem.

The retry engine must be testable from stored state without launching anything.

Retry plan contract (all six fields required):
1. why_resuming:          string    — reason for retry
2. invalidated:           [taskId]  — tasks whose proof is no longer valid
3. reusable_proof:        [{ proofBundleId, agentId }] — proof bundles still valid
4. resume_from_stage:     string    — closure stage to resume from
5. executor_changes:      [{ agentId, from, to }] — executor fallback changes
6. human_inputs_blocking: [requestId] — unresolved human inputs that block resume

Implementation:
1. Refactor launcher-retry.mjs so all retry decisions read from control-plane materialization and task graph, not from override files.
2. Override files become write-only compatibility caches for legacy CLI.
3. Add retry-determinism.test.ts: feed stored control-plane events and task graphs through the retry planner, assert on the output plan without launching any processes.
4. Ensure the retry engine uses the two-phase proof split: only unproven tasks on slice failure, only closure agents on gate failure.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Phase Engines, retry-engine).
- Read scripts/wave-orchestrator/launcher-retry.mjs.
- Read scripts/wave-orchestrator/retry-control.mjs.

File ownership (only touch these paths):
- scripts/wave-orchestrator/launcher-retry.mjs
- scripts/wave-orchestrator/retry-control.mjs
- test/wave-orchestrator/retry-determinism.test.ts
```

## Agent A3: Executor Adapter Contract

### Executor

- profile: implement-fast
- model: gpt-5-codex
- codex.add_dirs: scripts,test
- fallbacks: claude, opencode

### Context7

- bundle: node-typescript

### Components

- executor-abstraction-and-prompt-transport

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: none

### Deliverables

- scripts/wave-orchestrator/executors.mjs
- test/wave-orchestrator/executors.test.ts

### Prompt

```text
Refactor executor adapters to be capability-driven, not launcher-driven.

End-state executor adapter contract:
  ExecutorAdapter {
    executorId, displayName
    capabilities: { sandboxModes, supportsSearch, supportsImages, supportsMcp, supportsHooks, maxTurns, rateLimitRetry, ... }
    buildLaunchSpec(agent, wave, options) → LaunchSpec
    locateResultEnvelope(statusPath, logPath) → path | null   // locate agent-produced envelope
    validateResultEnvelope(envelope) → { valid, errors }       // validate envelope schema
    synthesizeLegacyEnvelope(logPath, statusPath) → envelope   // compatibility mode only
    isAvailable() → boolean
    fallbackEligibility: { canFallbackFrom, canFallbackTo, restrictions }
    supervisionHooks: { onLaunch, onComplete, onTimeout, onRateLimit }
  }

Key change: the end-state adapter reads/validates agent-produced envelopes, NOT builds them from log tails. buildResultEnvelope(logPath, statusPath) is migration-only and named synthesizeLegacyEnvelope to make that clear.

Implementation:
1. Refactor executors.mjs to expose a capability-driven interface.
2. Replace if (executor === 'codex') branching with capability checks.
3. Add locateResultEnvelope and validateResultEnvelope to each adapter.
4. Keep synthesizeLegacyEnvelope as explicit compatibility mode.
5. Update tests to verify capability-driven behavior.

Required context before coding:
- Read docs/reference/repository-guidance.md.
- Read docs/research/agent-context-sources.md.
- Read docs/plans/end-state-architecture.md (section: Runtime Adapter Contract).
- Read scripts/wave-orchestrator/executors.mjs.

File ownership (only touch these paths):
- scripts/wave-orchestrator/executors.mjs
- test/wave-orchestrator/executors.test.ts
```
