import fs from "node:fs";
import path from "node:path";
import { serializeCoordinationState } from "./coordination-store.mjs";
import { ensureDirectory, readJsonOrNull, readStatusRecordIfPresent, toIsoTimestamp, writeJsonAtomic, writeTextAtomic } from "./shared.mjs";

export function traceAttemptDir(tracesDir, waveNumber, attemptNumber) {
  return path.join(tracesDir, `wave-${waveNumber}`, `attempt-${attemptNumber}`);
}

function copyFileIfExists(sourcePath, destPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }
  ensureDirectory(path.dirname(destPath));
  fs.copyFileSync(sourcePath, destPath);
  return true;
}

export function writeTraceBundle({
  tracesDir,
  wave,
  attempt,
  manifest,
  coordinationLogPath,
  coordinationState,
  ledger,
  docsQueue,
  integrationSummary,
  integrationMarkdownPath,
  clarificationTriage,
  agentRuns,
  quality,
}) {
  const dir = traceAttemptDir(tracesDir, wave.wave, attempt);
  ensureDirectory(dir);
  writeJsonAtomic(path.join(dir, "manifest.json"), manifest);
  writeJsonAtomic(
    path.join(dir, "coordination.materialized.json"),
    serializeCoordinationState(coordinationState || {}),
  );
  if (coordinationLogPath && fs.existsSync(coordinationLogPath)) {
    copyFileIfExists(coordinationLogPath, path.join(dir, "coordination.raw.jsonl"));
  }
  writeJsonAtomic(path.join(dir, "ledger.json"), ledger || {});
  writeJsonAtomic(path.join(dir, "docs-queue.json"), docsQueue || {});
  writeJsonAtomic(path.join(dir, "integration.json"), integrationSummary || {});
  writeJsonAtomic(path.join(dir, "quality.json"), quality || {});
  copyFileIfExists(integrationMarkdownPath, path.join(dir, "integration.md"));
  copyFileIfExists(clarificationTriage?.triagePath, path.join(dir, "feedback", "triage.jsonl"));
  copyFileIfExists(
    clarificationTriage?.pendingHumanPath,
    path.join(dir, "feedback", "pending-human.md"),
  );
  writeJsonAtomic(path.join(dir, "run-metadata.json"), {
    wave: wave.wave,
    file: wave.file,
    attempt,
    capturedAt: toIsoTimestamp(),
    agents: (agentRuns || []).map((run) => ({
      agentId: run.agent.agentId,
      promptPath: run.promptPath,
      logPath: run.logPath,
      statusPath: run.statusPath,
      status: readStatusRecordIfPresent(run.statusPath),
      summary: readJsonOrNull(run.statusPath.replace(/\.status$/i, ".summary.json")),
      executor: run.agent.executorResolved || null,
      context7: run.agent.context7Resolved || null,
    })),
  });
  for (const run of agentRuns || []) {
    const slug = run.agent.slug || run.agent.agentId;
    copyFileIfExists(run.promptPath, path.join(dir, "prompts", `${slug}.prompt.md`));
    copyFileIfExists(run.logPath, path.join(dir, "logs", `${slug}.log`));
    copyFileIfExists(run.statusPath, path.join(dir, "status", `${slug}.status`));
    copyFileIfExists(
      run.statusPath.replace(/\.status$/i, ".summary.json"),
      path.join(dir, "summaries", `${slug}.summary.json`),
    );
    copyFileIfExists(run.inboxPath, path.join(dir, "inboxes", `${slug}.md`));
  }
  if (agentRuns?.[0]?.sharedSummaryPath) {
    copyFileIfExists(agentRuns[0].sharedSummaryPath, path.join(dir, "shared-summary.md"));
  }
  return dir;
}

export function writeStructuredSignalsSnapshot(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

export function writeMarkdownArtifact(filePath, text) {
  writeTextAtomic(filePath, `${String(text || "")}\n`);
}
