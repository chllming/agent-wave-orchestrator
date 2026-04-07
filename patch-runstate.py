#!/usr/bin/env python3
"""Patch wave-files.mjs to cap run-state history and improve dedup."""

with open("scripts/wave-orchestrator/wave-files.mjs", "r") as f:
    src = f.read()

# Patch 1: Add history cap constant after RUN_STATE_SCHEMA_VERSION
# Find the REDUCER_VERSION or RUN_STATE constants area
old_seq = '''function nextRunStateSequence(history) {
  return (history || []).reduce((max, entry) => Math.max(max, Number(entry?.seq) || 0), 0) + 1;
}'''

new_seq = '''const RUN_STATE_MAX_HISTORY = 200;
const RUN_STATE_MAX_HISTORY_PER_WAVE = 20;

function nextRunStateSequence(history) {
  return (history || []).reduce((max, entry) => Math.max(max, Number(entry?.seq) || 0), 0) + 1;
}'''

if old_seq in src:
    src = src.replace(old_seq, new_seq)
    print("  Added history cap constants")
else:
    print("  WARN: Could not find nextRunStateSequence")

# Patch 2: Cap history after append and strip evidence from old entries
old_append = '  nextState.history = [...nextState.history, historyEntry];\n  nextState.completedWaves = completedWavesFromStateEntries(nextState.waves);\n  return nextState;\n}'

new_append = '''  nextState.history = [...nextState.history, historyEntry];
  // Cap history to prevent unbounded growth (run-state bloat fix)
  if (nextState.history.length > RUN_STATE_MAX_HISTORY) {
    // Keep the last N entries per wave, plus the most recent entries overall
    const byWave = new Map();
    for (const entry of nextState.history) {
      const key = String(entry.wave ?? "");
      if (!byWave.has(key)) byWave.set(key, []);
      byWave.get(key).push(entry);
    }
    const kept = [];
    for (const [, entries] of byWave) {
      kept.push(...entries.slice(-RUN_STATE_MAX_HISTORY_PER_WAVE));
    }
    // Strip evidence from all but the last entry per wave to reduce size
    const lastPerWave = new Set();
    for (let i = kept.length - 1; i >= 0; i--) {
      const key = String(kept[i].wave ?? "");
      if (!lastPerWave.has(key)) {
        lastPerWave.add(key);
      } else {
        kept[i] = { ...kept[i], evidence: null };
      }
    }
    nextState.history = kept.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }
  nextState.completedWaves = completedWavesFromStateEntries(nextState.waves);
  return nextState;
}'''

if old_append in src:
    src = src.replace(old_append, new_append)
    print("  Patched appendRunStateTransition with history cap")
else:
    print("  WARN: Could not find append target")

# Patch 3: Improve dedup - exclude timestamp from comparison
old_dedup = '''  if (
    previousEntry &&
    currentState === toState &&
    previousEntry.lastSource === source &&
    previousEntry.lastReasonCode === reasonCode &&
    previousEntry.lastDetail === effectiveDetail &&
    JSON.stringify(currentEvidence || null) === JSON.stringify(effectiveEvidence || null)
  ) {
    return nextState;
  }'''

new_dedup = '''  // Dedup: skip if the transition is identical (ignore timestamps in evidence)
  const evidenceForCompare = (ev) => {
    if (!ev || typeof ev !== "object") return null;
    const { statusFiles, ...rest } = ev;
    // Strip completedAt from status files for comparison (changes every cycle)
    const normalizedFiles = Array.isArray(statusFiles)
      ? statusFiles.map(({ completedAt, ...f }) => f)
      : statusFiles;
    return JSON.stringify({ ...rest, statusFiles: normalizedFiles });
  };
  if (
    previousEntry &&
    currentState === toState &&
    previousEntry.lastSource === source &&
    previousEntry.lastReasonCode === reasonCode &&
    previousEntry.lastDetail === effectiveDetail &&
    evidenceForCompare(currentEvidence) === evidenceForCompare(effectiveEvidence)
  ) {
    return nextState;
  }'''

if old_dedup in src:
    src = src.replace(old_dedup, new_dedup)
    print("  Patched dedup to ignore timestamps in evidence")
else:
    print("  WARN: Could not find dedup target")

with open("scripts/wave-orchestrator/wave-files.mjs", "w") as f:
    f.write(src)

print("wave-files.mjs patched successfully")
