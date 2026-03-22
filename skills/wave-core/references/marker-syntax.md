# Structured Marker Syntax Reference

This reference documents the exact format for all structured markers used in wave coordination.

## wave-gate (cont-QA closure)
Emitted by: cont-QA agent (A0)
Format:
`[wave-gate] architecture=<pass|concerns|blocked> integration=<pass|concerns|blocked> durability=<pass|concerns|blocked> live=<pass|concerns|blocked> docs=<pass|concerns|blocked> detail=<short-note>`

Must be accompanied by a verdict line:
`Verdict: PASS` or `Verdict: CONCERNS` or `Verdict: BLOCKED`

Example:
`[wave-gate] architecture=pass integration=pass durability=pass live=pass docs=pass detail=all-exit-contracts-met`
`Verdict: PASS`

## wave-eval (cont-EVAL closure)
Emitted by: cont-EVAL agent (E0)
Format:
`[wave-eval] state=<satisfied|needs-more-work|blocked> target_ids=<comma-separated-ids> benchmark_ids=<comma-separated-ids> detail=<short-note>`

Example:
`[wave-eval] state=satisfied target_ids=prompt-quality,response-accuracy benchmark_ids=bench-01,bench-02 detail=all-targets-within-threshold`

## wave-integration (integration closure)
Emitted by: Integration steward (A8)
Format:
`[wave-integration] state=<ready-for-doc-closure|needs-more-work> blockers=<count> detail=<short-note>`

Example:
`[wave-integration] state=ready-for-doc-closure blockers=0 detail=all-agents-coherent-no-contradictions`

## wave-doc-closure (documentation closure)
Emitted by: Documentation steward (A9)
Format:
`[wave-doc-closure] state=<closed|no-change|needs-work> affected=<comma-separated-file-list> detail=<short-note>`

Example:
`[wave-doc-closure] state=closed affected=docs/plans/current-state.md,docs/plans/component-cutover-matrix.md detail=status-and-ownership-updated`

## infra-status (infrastructure verification)
Emitted by: Infra agent
Format:
`[infra-status] kind=<conformance|role-drift|dependency|identity|admission|action> surface=<name> state=<pass|warn|fail> detail=<short-note>`

Example:
`[infra-status] kind=dependency surface=node-22 state=pass detail=node-v22.15.0-confirmed`

## deploy-status (deployment verification)
Emitted by: Deploy agent
Format:
`[deploy-status] state=<deploying|healthy|failed|rolled-back> service=<name> detail=<short-note>`

Example:
`[deploy-status] state=healthy service=api-server detail=health-endpoint-200-latency-under-50ms`

## Rules
- Markers must appear on a single line, not wrapped across lines.
- Field values must not contain spaces; use hyphens for compound values.
- Markers are machine-parsed; do not add extra fields or change field order.
- Each closure role emits exactly one final marker per wave attempt.
- Markers in agent output are the authoritative proof surface for orchestrator validation.
