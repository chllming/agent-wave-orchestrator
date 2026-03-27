import fs from "node:fs";
import path from "node:path";
import {
  coordinationRecordBlocksWave,
  openClarificationLinkedRequests,
  readMaterializedCoordinationState,
} from "./coordination-store.mjs";
import { readWaveHumanFeedbackRequests } from "./coordination.mjs";
import { readControlPlaneEvents } from "./control-plane.mjs";
import {
  readWaveAssignmentBarrier,
  readWaveDependencyBarrier,
  readRunResultEnvelope,
} from "./gate-engine.mjs";
import { buildResumePlan } from "./retry-engine.mjs";
import { reduceWaveState } from "./wave-state-reducer.mjs";
import { resolveWaveRoleBindings } from "./role-helpers.mjs";
import {
  readWaveStateSnapshot,
  writeWaveStateSnapshot,
} from "./artifact-schemas.mjs";
import { ensureDirectory } from "./shared.mjs";

function normalizeShadowGate(gate) {
  if (!gate || typeof gate !== "object") {
    return null;
  }
  return {
    ok: gate.ok === true,
    agentId: gate.agentId || null,
    componentId: gate.componentId || null,
    statusCode: gate.statusCode || null,
    detail: gate.detail || null,
    waitingOnAgentIds: Array.isArray(gate.waitingOnAgentIds)
      ? [...new Set(gate.waitingOnAgentIds.filter(Boolean))].sort()
      : [],
  };
}

function normalizeShadowIdList(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function shadowSlice(compatibility, reducer) {
  return {
    matches: JSON.stringify(compatibility) === JSON.stringify(reducer),
    compatibility,
    reducer,
  };
}

function contradictionIds(value) {
  if (value instanceof Map) {
    return [...value.keys()];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => entry?.contradictionId || entry?.id).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.keys(value);
  }
  return [];
}

function compatibilityBlockerIds(derivedState) {
  const coordinationState = derivedState?.coordinationState || {};
  return normalizeShadowIdList([
    ...(coordinationState.blockers || [])
      .filter((record) => coordinationRecordBlocksWave(record))
      .map((record) => record.id),
    ...(coordinationState.clarifications || [])
      .filter((record) => coordinationRecordBlocksWave(record))
      .map((record) => record.id),
    ...openClarificationLinkedRequests(coordinationState)
      .filter((record) => coordinationRecordBlocksWave(record))
      .map((record) => record.id),
    ...(coordinationState.humanFeedback || [])
      .filter((record) => coordinationRecordBlocksWave(record))
      .map((record) => record.id),
    ...(coordinationState.humanEscalations || [])
      .filter((record) => coordinationRecordBlocksWave(record))
      .map((record) => record.id),
    ...((derivedState?.capabilityAssignments || [])
      .filter((assignment) => assignment.blocking)
      .map((assignment) => assignment.requestId || assignment.id)),
    ...((derivedState?.dependencySnapshot?.requiredInbound || []).map((record) => record.id)),
    ...((derivedState?.dependencySnapshot?.requiredOutbound || []).map((record) => record.id)),
    ...((derivedState?.dependencySnapshot?.unresolvedInboundAssignments || []).map((record) => record.id)),
  ]);
}

function buildReducerShadowDiff({
  derivedState,
  compatibilityGateSnapshot = null,
  compatibilityRelaunchResolution = null,
  reducerState,
  resumePlan,
}) {
  const helperCompatibility = compatibilityGateSnapshot
    ? normalizeShadowGate(compatibilityGateSnapshot.helperAssignmentBarrier)
    : normalizeShadowGate(readWaveAssignmentBarrier(derivedState));
  const dependencyCompatibility = compatibilityGateSnapshot
    ? normalizeShadowGate(compatibilityGateSnapshot.dependencyBarrier)
    : normalizeShadowGate(readWaveDependencyBarrier(derivedState));
  const overallCompatibility = compatibilityGateSnapshot
    ? normalizeShadowGate(compatibilityGateSnapshot.overall)
    : null;
  const retryCompatibility = compatibilityRelaunchResolution
    ? {
        selectedAgentIds: normalizeShadowIdList(
          (compatibilityRelaunchResolution.runs || []).map((run) => run.agent.agentId),
        ),
        barrier: compatibilityRelaunchResolution.barrier
          ? {
              statusCode: compatibilityRelaunchResolution.barrier.statusCode || null,
              detail: compatibilityRelaunchResolution.barrier.detail || null,
            }
          : null,
      }
    : null;
  const blockerCompatibility = compatibilityBlockerIds(derivedState);
  const contradictionCompatibility = normalizeShadowIdList(
    contradictionIds(derivedState?.contradictions),
  );
  const blockerReducer = normalizeShadowIdList(
    (reducerState?.openBlockers || []).map(
      (blocker) => blocker.id || blocker.taskId || blocker.title || blocker.detail,
    ),
  );
  const contradictionReducer = normalizeShadowIdList(
    contradictionIds(reducerState?.contradictions),
  );
  const retryReducer = {
    selectedAgentIds: normalizeShadowIdList(
      reducerState?.retryTargetSet?.agentIds || resumePlan?.invalidatedAgentIds || [],
    ),
    barrier:
      reducerState?.gateSnapshot?.helperAssignmentBarrier?.ok === false
        ? {
            statusCode: reducerState.gateSnapshot.helperAssignmentBarrier.statusCode || null,
            detail: reducerState.gateSnapshot.helperAssignmentBarrier.detail || null,
          }
        : reducerState?.gateSnapshot?.dependencyBarrier?.ok === false
          ? {
              statusCode: reducerState.gateSnapshot.dependencyBarrier.statusCode || null,
              detail: reducerState.gateSnapshot.dependencyBarrier.detail || null,
            }
          : null,
    resumeFromPhase: resumePlan?.resumeFromPhase || null,
  };
  const shadowDiff = {
    helperAssignmentBarrier: shadowSlice(
      helperCompatibility,
      normalizeShadowGate(reducerState?.gateSnapshot?.helperAssignmentBarrier),
    ),
    dependencyBarrier: shadowSlice(
      dependencyCompatibility,
      normalizeShadowGate(reducerState?.gateSnapshot?.dependencyBarrier),
    ),
    overallGate: shadowSlice(
      overallCompatibility,
      normalizeShadowGate(reducerState?.gateSnapshot?.overall),
    ),
    blockers: shadowSlice(blockerCompatibility, blockerReducer),
    contradictions: shadowSlice(contradictionCompatibility, contradictionReducer),
    closureReadiness: shadowSlice(
      overallCompatibility
        ? { allGatesPass: overallCompatibility.ok === true }
        : null,
      {
        allGatesPass: reducerState?.closureEligibility?.allGatesPass === true,
        waveMayClose: reducerState?.closureEligibility?.waveMayClose === true,
        pendingAgentIds: normalizeShadowIdList(
          reducerState?.closureEligibility?.pendingAgentIds || [],
        ),
      },
    ),
    retryPlan: shadowSlice(retryCompatibility, retryReducer),
  };
  const comparedSlices = Object.values(shadowDiff).filter(
    (slice) => slice.compatibility !== null && slice.reducer !== null,
  );
  return {
    comparedSliceCount: comparedSlices.length,
    matches: comparedSlices.every((slice) => slice.matches),
    slices: shadowDiff,
  };
}

export function computeReducerSnapshot({
  lanePaths,
  wave,
  agentRuns,
  derivedState,
  attempt,
  options = {},
  compatibilityGateSnapshot = null,
  compatibilityRelaunchResolution = null,
}) {
  const agentEnvelopes = {};
  for (const run of agentRuns) {
    const envelopeResult = readRunResultEnvelope(run, wave, { mode: "live" });
    if (envelopeResult?.valid && envelopeResult.envelope) {
      agentEnvelopes[run.agent.agentId] = envelopeResult.envelope;
    }
  }

  const controlPlaneLogPath = path.join(
    lanePaths.controlPlaneDir,
    `wave-${wave.wave}.jsonl`,
  );
  const controlPlaneEvents = fs.existsSync(controlPlaneLogPath)
    ? readControlPlaneEvents(controlPlaneLogPath)
    : [];

  const coordinationLogPath = path.join(
    lanePaths.coordinationDir,
    `wave-${wave.wave}.jsonl`,
  );
  const coordinationRecords = fs.existsSync(coordinationLogPath)
    ? readMaterializedCoordinationState(coordinationLogPath)
    : null;

  const feedbackRequests = readWaveHumanFeedbackRequests({
    feedbackRequestsDir: lanePaths.feedbackRequestsDir,
    lane: lanePaths.lane,
    waveNumber: wave.wave,
    agentIds: (agentRuns || []).map((run) => run.agent.agentId),
    orchestratorId: options.orchestratorId,
  });
  const roleBindings = resolveWaveRoleBindings(wave, lanePaths, wave.agents);

  const reducerState = reduceWaveState({
    controlPlaneEvents,
    coordinationRecords: coordinationRecords?.latestRecords || [],
    agentEnvelopes,
    waveDefinition: wave,
    dependencyTickets: derivedState?.dependencySnapshot || null,
    feedbackRequests: feedbackRequests || [],
    laneConfig: {
      lane: lanePaths.lane,
      contQaAgentId: roleBindings.contQaAgentId,
      contEvalAgentId: roleBindings.contEvalAgentId,
      integrationAgentId: roleBindings.integrationAgentId,
      documentationAgentId: roleBindings.documentationAgentId,
      validationMode: "live",
      evalTargets: wave.evalTargets,
      benchmarkCatalogPath: lanePaths.laneProfile?.paths?.benchmarkCatalogPath,
      laneProfile: lanePaths.laneProfile,
      requireIntegrationStewardFromWave: lanePaths.requireIntegrationStewardFromWave,
      capabilityRouting: lanePaths.capabilityRouting,
    },
  });

  const resumePlan = buildResumePlan(reducerState, {
    waveDefinition: wave,
    lanePaths,
  });
  const shadowDiff = buildReducerShadowDiff({
    derivedState,
    compatibilityGateSnapshot,
    compatibilityRelaunchResolution,
    reducerState,
    resumePlan,
  });

  const stateDir = path.join(lanePaths.stateDir, "reducer");
  ensureDirectory(stateDir);
  const snapshotPath = path.join(stateDir, `wave-${wave.wave}.json`);
  writeWaveStateSnapshot(
    snapshotPath,
    {
      ...reducerState,
      attempt,
      resumePlan,
      shadowDiff,
    },
    {
      lane: lanePaths.lane,
      wave: wave.wave,
    },
  );

  return {
    reducerState,
    resumePlan,
    shadowDiff,
    snapshotPath,
  };
}

export function readPersistedReducerSnapshot(lanePaths, waveNumber) {
  const stateDir = path.join(lanePaths.stateDir, "reducer");
  const snapshotPath = path.join(stateDir, `wave-${waveNumber}.json`);
  return readWaveStateSnapshot(snapshotPath, {
    lane: lanePaths.lane,
    wave: waveNumber,
  });
}
