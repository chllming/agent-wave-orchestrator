import path from "node:path";
import { augmentSummaryWithProofRegistry } from "./proof-registry.mjs";
import { readJsonOrNull } from "./shared.mjs";
import { buildGateSnapshot } from "./launcher.mjs";
import {
  buildQualityMetrics,
  loadTraceBundle,
  normalizeGateSnapshotForBundle,
  validateTraceBundle,
} from "./traces.mjs";

function absoluteBundlePath(dir, relativePath) {
  if (!relativePath) {
    return null;
  }
  return path.join(dir, relativePath);
}

function buildReplayLanePaths(metadata) {
  const replayContext =
    metadata?.replayContext && typeof metadata.replayContext === "object"
      ? metadata.replayContext
      : null;
  const roles = replayContext?.roles || metadata?.roles || {};
  const validation = replayContext?.validation || metadata?.validation || {};
  const contQaAgentId = roles.contQaAgentId || roles.evaluatorAgentId || "A0";
  const contEvalAgentId = roles.contEvalAgentId || "E0";
  const integrationAgentId = roles.integrationAgentId || "A8";
  const documentationAgentId = roles.documentationAgentId || "A9";
  return {
    lane: replayContext?.lane || metadata?.lane || "main",
    contQaAgentId,
    contEvalAgentId,
    integrationAgentId,
    documentationAgentId,
    requireIntegrationStewardFromWave:
      validation.requireIntegrationStewardFromWave ?? null,
    laneProfile: {
      roles: {
        contQaAgentId,
        contEvalAgentId,
        integrationAgentId,
        documentationAgentId,
      },
      validation: {
        requireDocumentationStewardFromWave:
          validation.requireDocumentationStewardFromWave ?? null,
        requireContext7DeclarationsFromWave:
          validation.requireContext7DeclarationsFromWave ?? null,
        requireExitContractsFromWave:
          validation.requireExitContractsFromWave ?? null,
        requireIntegrationStewardFromWave:
          validation.requireIntegrationStewardFromWave ?? null,
        requireComponentPromotionsFromWave:
          validation.requireComponentPromotionsFromWave ?? null,
        requireAgentComponentsFromWave:
          validation.requireAgentComponentsFromWave ?? null,
      },
    },
  };
}

function buildReplayAgentRuns(dir, wave, metadata, proofRegistry = null) {
  const isHermeticTrace = Number(metadata?.traceVersion) >= 2;
  return (metadata?.agents || []).map((agentMetadata) => {
    const waveAgent =
      wave.agents.find((agent) => agent.agentId === agentMetadata.agentId) || {
        agentId: agentMetadata.agentId,
        title: agentMetadata.title || agentMetadata.agentId,
      };
    const summaryPath = absoluteBundlePath(dir, agentMetadata.summaryPath);
    const summaryPayload = summaryPath ? readJsonOrNull(summaryPath) : null;
    const augmentedSummary = augmentSummaryWithProofRegistry(
      waveAgent,
      summaryPayload && typeof summaryPayload === "object" ? summaryPayload : null,
      proofRegistry,
    );
    return {
      agent: {
        ...waveAgent,
        executorResolved: agentMetadata.executor
          ? {
              ...waveAgent.executorResolved,
              ...agentMetadata.executor,
              id: agentMetadata.executor.executorId || agentMetadata.executor.id || null,
            }
          : waveAgent.executorResolved,
        context7Resolved: agentMetadata.context7?.selection || waveAgent.context7Resolved || null,
      },
      promptPath: absoluteBundlePath(dir, agentMetadata.promptPath),
      logPath: absoluteBundlePath(dir, agentMetadata.logPath),
      statusPath: absoluteBundlePath(dir, agentMetadata.statusPath),
      summaryPath,
      summary:
        augmentedSummary
          ? augmentedSummary
          : !isHermeticTrace
            ? agentMetadata.summary || null
            : null,
      inboxPath: absoluteBundlePath(dir, agentMetadata.inboxPath),
      lastLaunchAttempt: agentMetadata.launchedInAttempt ? metadata.attempt : null,
    };
  });
}

function diffStructuredValues(expected, actual, basePath = "") {
  if (JSON.stringify(expected) === JSON.stringify(actual)) {
    return [];
  }
  const expectedIsObject =
    expected !== null && typeof expected === "object" && !Array.isArray(expected);
  const actualIsObject = actual !== null && typeof actual === "object" && !Array.isArray(actual);
  if (expectedIsObject && actualIsObject) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return Array.from(keys)
      .toSorted()
      .flatMap((key) =>
        diffStructuredValues(
          expected[key],
          actual[key],
          basePath ? `${basePath}.${key}` : key,
        ),
      );
  }
  const expectedIsArray = Array.isArray(expected);
  const actualIsArray = Array.isArray(actual);
  if (expectedIsArray && actualIsArray) {
    if (expected.length !== actual.length) {
      return [basePath || "<root>"];
    }
    return expected.flatMap((value, index) =>
      diffStructuredValues(value, actual[index], `${basePath}[${index}]`),
    );
  }
  return [basePath || "<root>"];
}

function buildReplayComparison(storedGateSnapshot, gateSnapshot, storedQuality, quality) {
  const gateDiffPaths = diffStructuredValues(storedGateSnapshot || null, gateSnapshot || null);
  const qualityDiffPaths = diffStructuredValues(storedQuality || null, quality || null);
  return {
    gateSnapshot: {
      matches: gateDiffPaths.length === 0,
      diffPaths: gateDiffPaths,
    },
    quality: {
      matches: qualityDiffPaths.length === 0,
      diffPaths: qualityDiffPaths,
    },
  };
}

export function replayTraceBundle(dir) {
  const bundle = loadTraceBundle(dir);
  const validation = validateTraceBundle(bundle);
  const warnings = [...(validation.warnings || [])];
  if (!validation.ok) {
    return {
      ok: false,
      replayMode: validation.replayMode || "invalid",
      validation,
      warnings,
      bundle,
    };
  }
  const wave =
    bundle.manifest?.waves?.find((entry) => Number(entry.wave) === Number(bundle.metadata.wave)) ||
    bundle.manifest?.waves?.[0];
  if (!wave) {
    return {
      ok: false,
      replayMode: validation.replayMode || "invalid",
      validation: {
        ...validation,
        ok: false,
        errors: [...(validation.errors || []), "Trace manifest does not include a replayable wave definition."],
      },
      warnings,
      bundle,
    };
  }
  const lanePaths = buildReplayLanePaths(bundle.metadata);
  const agentRuns = buildReplayAgentRuns(dir, wave, bundle.metadata, bundle.proofRegistry || null);
  const derivedState = {
    coordinationState: bundle.coordinationState,
    ledger: bundle.ledger,
    docsQueue: bundle.docsQueue,
    capabilityAssignments: bundle.capabilityAssignments || [],
    dependencySnapshot: bundle.dependencySnapshot || null,
    integrationSummary: bundle.integrationSummary,
  };
  const gateSnapshot = normalizeGateSnapshotForBundle(
    buildGateSnapshot({
      wave,
      agentRuns,
      derivedState,
      lanePaths,
      componentMatrixPayload: bundle.componentMatrix,
      componentMatrixJsonPath: bundle.componentMatrixPath,
    }),
    bundle.metadata.artifacts?.agents || {},
  );
  const summariesByAgentId = Object.fromEntries(
    agentRuns
      .map((run) => [run.agent.agentId, run.summary || null])
      .filter(([, summary]) => summary),
  );
  const historySnapshot =
    bundle.metadata.traceVersion >= 2
      ? bundle.metadata.historySnapshot || null
      : null;
  if (!historySnapshot) {
    warnings.push(
      "Legacy replay is best-effort: cumulative quality may depend on sibling attempts or available trace history.",
    );
  }
  const quality = buildQualityMetrics({
    historySnapshot,
    tracesDir:
      historySnapshot || bundle.metadata.traceVersion >= 2
        ? null
        : path.dirname(path.dirname(dir)),
    wave,
    attempt: bundle.metadata.attempt,
    coordinationLogPath: path.join(dir, "coordination.raw.jsonl"),
    coordinationState: bundle.coordinationState,
    integrationSummary: bundle.integrationSummary,
    ledger: bundle.ledger,
    docsQueue: bundle.docsQueue,
    capabilityAssignments: bundle.capabilityAssignments || [],
    dependencySnapshot: bundle.dependencySnapshot || null,
    summariesByAgentId,
    agentRuns,
    gateSnapshot,
  });
  const storedGateSnapshot =
    bundle.storedOutcome?.gateSnapshot || bundle.metadata.gateSnapshot || null;
  const storedQuality = bundle.storedOutcome?.quality || bundle.quality || null;
  const comparison = buildReplayComparison(storedGateSnapshot, gateSnapshot, storedQuality, quality);
  return {
    ok: validation.ok && gateSnapshot.overall.ok === true,
    replayMode: validation.replayMode,
    validation,
    warnings,
    bundle,
    wave,
    gateSnapshot,
    quality,
    storedGateSnapshot,
    storedQuality,
    comparison,
    matchesStoredGateSnapshot: comparison.gateSnapshot.matches,
    matchesStoredQuality: comparison.quality.matches,
  };
}
