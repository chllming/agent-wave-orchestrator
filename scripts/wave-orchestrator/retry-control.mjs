import fs from "node:fs";
import path from "node:path";
import {
  readRetryOverride,
  readRelaunchPlan,
  writeRetryOverride,
} from "./artifact-schemas.mjs";
import { ensureDirectory, parseNonNegativeInt } from "./shared.mjs";

function uniqueAgentIds(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

export function waveRetryOverridePath(lanePaths, waveNumber) {
  return path.join(lanePaths.controlDir, `retry-override-wave-${parseNonNegativeInt(waveNumber, "wave")}.json`);
}

export function waveRelaunchPlanPath(lanePaths, waveNumber) {
  return path.join(lanePaths.statusDir, `relaunch-plan-wave-${parseNonNegativeInt(waveNumber, "wave")}.json`);
}

export function readWaveRetryOverride(lanePaths, waveNumber) {
  return readRetryOverride(waveRetryOverridePath(lanePaths, waveNumber), {
    lane: lanePaths?.lane || null,
    wave: waveNumber,
  });
}

export function writeWaveRetryOverride(lanePaths, waveNumber, payload) {
  const filePath = waveRetryOverridePath(lanePaths, waveNumber);
  ensureDirectory(path.dirname(filePath));
  return writeRetryOverride(filePath, payload, {
    lane: lanePaths?.lane || null,
    wave: waveNumber,
  });
}

export function clearWaveRetryOverride(lanePaths, waveNumber) {
  try {
    fs.rmSync(waveRetryOverridePath(lanePaths, waveNumber), { force: true });
  } catch {
    // no-op
  }
}

export function readWaveRelaunchPlanSnapshot(lanePaths, waveNumber) {
  return readRelaunchPlan(waveRelaunchPlanPath(lanePaths, waveNumber), {
    wave: waveNumber,
  });
}

export function resolveRetryOverrideAgentIds(waveDefinition, lanePaths, override) {
  const selectedAgentIds = uniqueAgentIds(override?.selectedAgentIds);
  if (selectedAgentIds.length > 0) {
    return selectedAgentIds;
  }
  const resumePhase = String(override?.resumePhase || "")
    .trim()
    .toLowerCase();
  if (!resumePhase) {
    return [];
  }
  const agents = Array.isArray(waveDefinition?.agents) ? waveDefinition.agents : [];
  const closureAgentIds = new Set(
    [
      lanePaths?.contEvalAgentId || "E0",
      lanePaths?.integrationAgentId || "A8",
      lanePaths?.documentationAgentId || "A9",
      lanePaths?.contQaAgentId || "A0",
    ].filter(Boolean),
  );
  if (resumePhase === "implementation") {
    return agents
      .map((agent) => agent.agentId)
      .filter((agentId) => agentId && !closureAgentIds.has(agentId));
  }
  if (resumePhase === "integrating") {
    return [lanePaths?.integrationAgentId || "A8"];
  }
  if (resumePhase === "docs-closure") {
    return [lanePaths?.documentationAgentId || "A9"];
  }
  if (resumePhase === "cont-qa-closure") {
    return [lanePaths?.contQaAgentId || "A0"];
  }
  if (resumePhase === "cont-eval") {
    return [lanePaths?.contEvalAgentId || "E0"];
  }
  return [];
}

export function resolveRetryOverrideRuns(agentRuns, override, lanePaths, waveDefinition) {
  const selectedAgentIds = resolveRetryOverrideAgentIds(waveDefinition, lanePaths, override);
  if (selectedAgentIds.length === 0) {
    return {
      runs: [],
      selectedAgentIds: [],
      unknownAgentIds: [],
    };
  }
  const runsByAgentId = new Map((agentRuns || []).map((run) => [run?.agent?.agentId, run]));
  const unknownAgentIds = selectedAgentIds.filter((agentId) => !runsByAgentId.has(agentId));
  return {
    runs: selectedAgentIds.map((agentId) => runsByAgentId.get(agentId)).filter(Boolean),
    selectedAgentIds,
    unknownAgentIds,
  };
}
