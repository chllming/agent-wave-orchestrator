# Recommendations for 0.9.11

## Upgrade

```bash
wave self-update
# or: npm install -g @chllming/wave-orchestration@0.9.11
```

## What changed

### Verdict parsing (P0 fix)

The `parseVerdictFromText()` function now returns the **first** regex match instead of the last. This fixes a critical bug where append-only cont-QA report files accumulated `Verdict:` lines across retries, and the stale `Verdict: BLOCKED` at the bottom would override newer `Verdict: PASS` entries above it.

**If you have waves stuck in cont-QA retry loops**, upgrading to 0.9.11 should unblock them on the next attempt. No manual intervention needed — the runner will re-evaluate the gate with the fixed parser.

**For ongoing work**: the log-based `[wave-verdict]` marker is now preferred over the report file `Verdict:` line. Both still work, but if both are present, the log marker wins. This is more reliable because the log is per-run while report files persist across attempts.

### Log verdict priority

`buildAgentExecutionSummary()` now reads verdicts in this order:
1. `[wave-verdict]` from the agent's log (authoritative per-run)
2. `Verdict:` from the cont-QA report file (fallback)

Previously the report file took priority. If your cont-QA role prompt instructs the agent to write `Verdict: PASS/BLOCKED` in the report, that still works — it just won't override a contradicting `[wave-verdict]` marker in the same run's log.

### Integration steward sticky closure

When A8 (integration steward) explicitly reports `state=ready-for-doc-closure` with zero blockers, the orchestrator no longer re-injects synthesized proof/doc gaps on the next `refreshDerivedState()` cycle. This prevents the pattern where:

1. A8 closes all gaps → integration summary says "ready-for-doc-closure"
2. Launcher calls `refreshDerivedState()` on next attempt
3. `buildIntegrationEvidence()` re-derives gaps from agent summaries
4. Integration summary regresses to "needs-more-work"
5. Retry → goto 1

**No action required** — the fix is automatic. If your waves were stuck in integration retry loops, they should resolve on the next attempt.

## Recommendations

- **Stuck cont-QA waves**: Just upgrade and let the runner retry. The fixed verdict parser will read the correct verdict.
- **Stuck integration loops**: Same — upgrade and let the runner retry.
- **Report file hygiene**: Consider having your cont-QA role prompt write verdicts with a clear section header (e.g., `## Final Verdict`) to make the file structure unambiguous. The first-match-wins behavior rewards putting the definitive verdict early in the file.
