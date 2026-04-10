import fs from "node:fs";
import path from "node:path";
import { writeClosureAdjudication } from "./artifact-schemas.mjs";
import { REPO_ROOT, ensureDirectory } from "./shared.mjs";
import { parseStructuredSignalCandidate } from "./structured-signal-parser.mjs";
import { validateImplementationSummary } from "./agent-state.mjs";

function isOpenCoordinationStatus(status) {
  return ["open", "acknowledged", "in_progress"].includes(String(status || "").trim().toLowerCase());
}

function blockingCoordinationForAgent(derivedState, agentId) {
  const latestRecords = Array.isArray(derivedState?.coordinationState?.latestRecords)
    ? derivedState.coordinationState.latestRecords
    : [];
  return latestRecords.some((record) => {
    if (!isOpenCoordinationStatus(record?.status) || record?.blocking === false) {
      return false;
    }
    if (record?.agentId === agentId) {
      return true;
    }
    return (record?.targets || []).some((target) => String(target || "").trim() === `agent:${agentId}`);
  });
}

function buildEvidence(summary, envelope, derivedState) {
  return [
    { kind: "exit-code", value: summary?.exitCode ?? null },
    {
      kind: "deliverables",
      value: (summary?.deliverables || []).map((deliverable) => ({
        path: deliverable.path,
        exists: deliverable.exists === true,
      })),
    },
    {
      kind: "proof-artifacts",
      value: (summary?.proofArtifacts || []).map((artifact) => ({
        path: artifact.path,
        exists: artifact.exists === true,
      })),
    },
    {
      kind: "envelope-role",
      value: envelope?.role || null,
    },
    {
      kind: "integration-summary",
      value: derivedState?.integrationSummary?.recommendation || null,
    },
  ];
}

function synthesizedSignals(summary) {
  const signals = [];
  if (summary?.proof) {
    signals.push(
      `[wave-proof] completion=${summary.proof.completion} durability=${summary.proof.durability} proof=${summary.proof.proof} state=${summary.proof.state}${summary.proof.detail ? ` detail=${summary.proof.detail}` : ""}`,
    );
  }
  if (summary?.docDelta) {
    signals.push(
      `[wave-doc-delta] state=${summary.docDelta.state}${(summary.docDelta.paths || []).length > 0 ? ` paths=${summary.docDelta.paths.join(",")}` : ""}${summary.docDelta.detail ? ` detail=${summary.docDelta.detail}` : ""}`,
    );
  }
  for (const component of summary?.components || []) {
    signals.push(
      `[wave-component] component=${component.componentId} level=${component.level} state=${component.state}${component.detail ? ` detail=${component.detail}` : ""}`,
    );
  }
  return signals;
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanState(value) {
  const normalized = cleanText(value).toLowerCase();
  return normalized === "complete" ? "met" : normalized;
}

function proofLineFromRawValues(rawValues) {
  const completion = cleanText(rawValues?.completion).toLowerCase();
  const durability = cleanText(rawValues?.durability).toLowerCase();
  const proof = cleanText(rawValues?.proof).toLowerCase();
  const state = cleanState(rawValues?.state);
  const line = `[wave-proof] completion=${completion} durability=${durability} proof=${proof} state=${state}`;
  const candidate = parseStructuredSignalCandidate(line);
  return candidate?.accepted ? candidate.normalizedLine : null;
}

function docDeltaLineFromRawValues(rawValues) {
  const state = cleanText(rawValues?.state).toLowerCase();
  const line = `[wave-doc-delta] state=${state}`;
  const candidate = parseStructuredSignalCandidate(line);
  return candidate?.accepted ? candidate.normalizedLine : null;
}

function componentLineFromRawValues(rawValues) {
  const componentId = cleanText(rawValues?.component);
  const level = cleanText(rawValues?.level).toLowerCase();
  const state = cleanState(rawValues?.state);
  const line = `[wave-component] component=${componentId} level=${level} state=${state}`;
  const candidate = parseStructuredSignalCandidate(line);
  return candidate?.accepted ? candidate.normalizedLine : null;
}

function rejectedStructuredSignalSamples(summary, key) {
  const bucket = summary?.structuredSignalDiagnostics?.[key];
  return Array.isArray(bucket?.rejectedSamples) ? bucket.rejectedSamples : [];
}

function recoverStructuredSignalLine(gate, summary, agentRun) {
  if (gate?.statusCode === "invalid-wave-proof-format") {
    for (const sample of rejectedStructuredSignalSamples(summary, "proof")) {
      const line = proofLineFromRawValues(sample?.rawValues);
      if (line) {
        return line;
      }
    }
    return null;
  }
  if (gate?.statusCode === "invalid-doc-delta-format") {
    for (const sample of rejectedStructuredSignalSamples(summary, "docDelta")) {
      const line = docDeltaLineFromRawValues(sample?.rawValues);
      if (line) {
        return line;
      }
    }
    return null;
  }
  if (gate?.statusCode === "invalid-wave-component-format") {
    const ownedComponents = new Set(Array.isArray(agentRun?.agent?.components) ? agentRun.agent.components : []);
    for (const sample of rejectedStructuredSignalSamples(summary, "component")) {
      if (!ownedComponents.has(cleanText(sample?.componentId))) {
        continue;
      }
      const line = componentLineFromRawValues(sample?.rawValues);
      if (line) {
        return line;
      }
    }
    return null;
  }
  return null;
}

function recoverSummaryFromRejectedSignals(gate, summary, agentRun) {
  const recoveredLine = recoverStructuredSignalLine(gate, summary, agentRun);
  if (!recoveredLine) {
    return null;
  }
  const candidate = parseStructuredSignalCandidate(recoveredLine);
  if (!candidate?.accepted) {
    return null;
  }
  const recoveredSummary = {
    ...summary,
  };
  if (candidate.kind === "proof") {
    recoveredSummary.proof = {
      completion: candidate.rawValues.completion.toLowerCase(),
      durability: candidate.rawValues.durability.toLowerCase(),
      proof: candidate.rawValues.proof.toLowerCase(),
      state: cleanState(candidate.rawValues.state),
      detail: "",
    };
  } else if (candidate.kind === "docDelta") {
    recoveredSummary.docDelta = {
      state: candidate.rawValues.state.toLowerCase(),
      paths: [],
      detail: "",
    };
  } else if (candidate.kind === "component") {
    const recoveredComponent = {
      componentId: cleanText(candidate.rawValues.component),
      level: cleanText(candidate.rawValues.level).toLowerCase(),
      state: cleanState(candidate.rawValues.state),
      detail: "",
    };
    const existingComponents = Array.isArray(summary?.components) ? summary.components : [];
    recoveredSummary.components = [
      ...existingComponents.filter((component) => component.componentId !== recoveredComponent.componentId),
      recoveredComponent,
    ];
  }
  return {
    recoveredLine,
    recoveredSummary,
    recoveredValidation: validateImplementationSummary(agentRun?.agent || null, recoveredSummary),
  };
}

export function closureAdjudicationPath(lanePaths, waveNumber, attempt, agentId) {
  return path.join(
    lanePaths.statusDir,
    "..",
    "closure",
    `wave-${waveNumber}`,
    `attempt-${attempt || 1}`,
    `${agentId}.json`,
  );
}

export function evaluateClosureAdjudication({
  wave,
  lanePaths,
  gate,
  summary,
  derivedState,
  agentRun,
  envelope,
}) {
  if (gate?.failureClass !== "transport-failure" || gate?.eligibleForAdjudication !== true) {
    return {
      status: "ambiguous",
      reason: "not-eligible",
      detail: "Closure failure is not eligible for deterministic adjudication.",
      evidence: [],
      synthesizedSignals: [],
    };
  }
  if (summary?.proof?.state === "gap" || (summary?.gaps || []).length > 0) {
    return {
      status: "rework-required",
      reason: "semantic-negative-signal",
      detail: "Explicit negative semantic proof signals remain.",
      evidence: buildEvidence(summary, envelope, derivedState),
      synthesizedSignals: synthesizedSignals(summary),
    };
  }
  if (blockingCoordinationForAgent(derivedState, agentRun?.agent?.agentId)) {
    return {
      status: "ambiguous",
      reason: "blocking-coordination",
      detail: "Blocking coordination owned by the same agent slice remains open.",
      evidence: buildEvidence(summary, envelope, derivedState),
      synthesizedSignals: synthesizedSignals(summary),
    };
  }
  const recovered = recoverSummaryFromRejectedSignals(gate, summary, agentRun);
  if (!recovered) {
    return {
      status: "rework-required",
      reason: "reconstruction-failed",
      detail: "Rejected marker text did not preserve enough safe contract data to reconstruct a canonical closure signal.",
      evidence: buildEvidence(summary, envelope, derivedState),
      synthesizedSignals: synthesizedSignals(summary),
    };
  }
  if (!recovered.recoveredValidation?.ok) {
    return {
      status: "rework-required",
      reason: "recovered-signal-failed-validation",
      detail: recovered.recoveredValidation?.detail || "Recovered closure signal still does not satisfy the implementation exit contract.",
      evidence: buildEvidence(summary, envelope, derivedState),
      synthesizedSignals: [...synthesizedSignals(summary), recovered.recoveredLine],
    };
  }
  return {
    status: "pass",
    reason: "recovered-canonical-signal",
    detail: "Rejected marker text preserved enough contract data to recover a canonical closure signal that satisfies the implementation exit contract.",
    evidence: buildEvidence(summary, envelope, derivedState),
    synthesizedSignals: [...synthesizedSignals(summary), recovered.recoveredLine],
  };
}

export function persistClosureAdjudication({
  lanePaths,
  waveNumber,
  attempt,
  agentId,
  payload,
}) {
  const filePath = closureAdjudicationPath(lanePaths, waveNumber, attempt, agentId);
  ensureDirectory(path.dirname(filePath));
  return {
    filePath,
    adjudication: writeClosureAdjudication(
      filePath,
      {
        lane: lanePaths?.lane || null,
        wave: waveNumber,
        attempt,
        agentId,
        ...payload,
      },
      {
        lane: lanePaths?.lane || null,
        wave: waveNumber,
        attempt,
        agentId,
      },
    ),
  };
}

export function readPersistedClosureAdjudication(filePath, defaults = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    ...payload,
    filePath: path.isAbsolute(filePath) ? path.relative(REPO_ROOT, filePath) : filePath,
    ...defaults,
  };
}
