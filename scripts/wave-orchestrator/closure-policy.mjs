function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeThreshold(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function contradictionList(value) {
  if (!value) {
    return [];
  }
  if (value instanceof Map) {
    return Array.from(value.values());
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object") {
    return Object.values(value);
  }
  return [];
}

function openCoordinationRecords(records = []) {
  return (Array.isArray(records) ? records : []).filter(
    (record) =>
      !["resolved", "closed", "cancelled", "superseded"].includes(
        String(record?.status || "")
          .trim()
          .toLowerCase(),
      ),
  );
}

function closureSignalsFromDerivedState(derivedState = {}) {
  const integrationSummary = derivedState?.integrationSummary || {};
  const docsQueueItems = Array.isArray(derivedState?.docsQueue?.items)
    ? derivedState.docsQueue.items
    : [];
  const coordinationState = derivedState?.coordinationState || {};
  const clarificationBarrier = derivedState?.clarificationBarrier || { ok: true };
  const helperAssignmentBarrier = derivedState?.helperAssignmentBarrier || { ok: true };
  const dependencyBarrier = derivedState?.dependencyBarrier || { ok: true };
  const securitySummary = derivedState?.securitySummary || null;
  const corridorSummary =
    derivedState?.corridorSummary || derivedState?.securitySummary?.corridor || null;
  const blockingContradictions = contradictionList(derivedState?.contradictions).filter(
    (entry) =>
      ["blocking", "high"].includes(String(entry?.severity || "").trim().toLowerCase()) &&
      ((Array.isArray(entry?.impactedGates) && entry.impactedGates.includes("integrationBarrier")) ||
        !Array.isArray(entry?.impactedGates) ||
        entry.impactedGates.length === 0) &&
      !["resolved", "closed", "cleared"].includes(
        String(entry?.status || "")
          .trim()
          .toLowerCase(),
      ),
  );
  const openClarifications = openCoordinationRecords(coordinationState?.clarifications);
  const openHuman = [
    ...openCoordinationRecords(coordinationState?.humanEscalations),
    ...openCoordinationRecords(coordinationState?.humanFeedback),
  ];
  const blockingAssignments = (Array.isArray(derivedState?.capabilityAssignments)
    ? derivedState.capabilityAssignments
    : []
  ).filter((assignment) => assignment?.blocking !== false);
  const openDependencies = [
    ...((Array.isArray(derivedState?.dependencySnapshot?.openInbound)
      ? derivedState.dependencySnapshot.openInbound
      : []) || []),
    ...((Array.isArray(derivedState?.dependencySnapshot?.openOutbound)
      ? derivedState.dependencySnapshot.openOutbound
      : []) || []),
    ...((Array.isArray(derivedState?.dependencySnapshot?.unresolvedInboundAssignments)
      ? derivedState.dependencySnapshot.unresolvedInboundAssignments
      : []) || []),
  ];
  const sharedPlanItems = docsQueueItems.filter((item) => item?.kind === "shared-plan");
  const componentMatrixItems = docsQueueItems.filter((item) => item?.kind === "component-matrix");
  return {
    integrationReady:
      integrationSummary?.recommendation === "ready-for-doc-closure",
    openClaims: Array.isArray(integrationSummary?.openClaims) ? integrationSummary.openClaims : [],
    conflictingClaims: Array.isArray(integrationSummary?.conflictingClaims)
      ? integrationSummary.conflictingClaims
      : [],
    unresolvedBlockers: Array.isArray(integrationSummary?.unresolvedBlockers)
      ? integrationSummary.unresolvedBlockers
      : [],
    changedInterfaces: Array.isArray(integrationSummary?.changedInterfaces)
      ? integrationSummary.changedInterfaces
      : [],
    crossComponentImpacts: Array.isArray(integrationSummary?.crossComponentImpacts)
      ? integrationSummary.crossComponentImpacts
      : [],
    proofGaps: Array.isArray(integrationSummary?.proofGaps) ? integrationSummary.proofGaps : [],
    docGaps: Array.isArray(integrationSummary?.docGaps) ? integrationSummary.docGaps : [],
    deployRisks: Array.isArray(integrationSummary?.deployRisks)
      ? integrationSummary.deployRisks
      : [],
    inboundDependencies: Array.isArray(integrationSummary?.inboundDependencies)
      ? integrationSummary.inboundDependencies
      : [],
    outboundDependencies: Array.isArray(integrationSummary?.outboundDependencies)
      ? integrationSummary.outboundDependencies
      : [],
    helperAssignments: Array.isArray(integrationSummary?.helperAssignments)
      ? integrationSummary.helperAssignments
      : [],
    sharedPlanItems,
    componentMatrixItems,
    blockingContradictions,
    openClarifications,
    openHuman,
    blockingAssignments,
    openDependencies,
    clarificationBarrier,
    helperAssignmentBarrier,
    dependencyBarrier,
    securityState:
      integrationSummary?.securityState || securitySummary?.overallState || "not-applicable",
    corridorSummary,
  };
}

export function resolveClosureMode(waveNumber, thresholds) {
  if (!thresholds) {
    return "strict";
  }
  const bootstrapStart = normalizeThreshold(thresholds.bootstrap, 0);
  const standardStart = Math.max(
    bootstrapStart,
    normalizeThreshold(thresholds.standard, 4),
  );
  const strictStart = Math.max(
    standardStart,
    normalizeThreshold(thresholds.strict, 10),
  );
  if (waveNumber >= strictStart) {
    return "strict";
  }
  if (waveNumber >= standardStart) {
    return "standard";
  }
  return "bootstrap";
}

export function resolveClosurePolicyConfig(source = {}) {
  const validation = source?.laneProfile?.validation || source?.validation || {};
  const rawThresholds =
    source?.closureModeThresholds || validation?.closureModeThresholds || null;
  const rawAutoClosure = source?.autoClosure || validation?.autoClosure || {};
  return {
    closureModeThresholds: {
      bootstrap: normalizeThreshold(rawThresholds?.bootstrap, 0),
      standard: normalizeThreshold(rawThresholds?.standard, 4),
      strict: normalizeThreshold(rawThresholds?.strict, 10),
    },
    autoClosure: {
      allowInferredIntegration: normalizeBoolean(
        rawAutoClosure?.allowInferredIntegration,
        false,
      ),
      allowAutoDocNoChange: normalizeBoolean(
        rawAutoClosure?.allowAutoDocNoChange,
        false,
      ),
      allowAutoDocProjection: normalizeBoolean(
        rawAutoClosure?.allowAutoDocProjection,
        false,
      ),
      allowSkipContQaInBootstrap: normalizeBoolean(
        rawAutoClosure?.allowSkipContQaInBootstrap,
        false,
      ),
    },
  };
}

export function classifyClosureComplexity(derivedState = {}) {
  const signals = closureSignalsFromDerivedState(derivedState);
  const hasStrictSignals =
    signals.blockingContradictions.length > 0 ||
    signals.openClarifications.length > 0 ||
    signals.openHuman.length > 0 ||
    signals.clarificationBarrier?.ok === false ||
    signals.helperAssignmentBarrier?.ok === false ||
    signals.dependencyBarrier?.ok === false ||
    signals.securityState === "blocked" ||
    signals.corridorSummary?.blocking === true ||
    (signals.corridorSummary?.ok === false &&
      signals.corridorSummary?.requiredAtClosure !== false);
  if (hasStrictSignals) {
    return "strict-full-closure";
  }
  const hasSemanticIntegrationSignals =
    signals.openClaims.length > 0 ||
    signals.conflictingClaims.length > 0 ||
    signals.unresolvedBlockers.length > 0 ||
    signals.changedInterfaces.length > 0 ||
    signals.crossComponentImpacts.length > 0 ||
    signals.proofGaps.length > 0 ||
    signals.deployRisks.length > 0 ||
    signals.helperAssignments.length > 0 ||
    signals.inboundDependencies.length > 0 ||
    signals.outboundDependencies.length > 0 ||
    signals.blockingAssignments.length > 0 ||
    signals.openDependencies.length > 0;
  if (hasSemanticIntegrationSignals) {
    return "semantic-integration";
  }
  if (signals.sharedPlanItems.length > 0) {
    return "semantic-docs";
  }
  return "low-entropy";
}

export function evaluateInferredIntegrationClosure(derivedState = {}, source = {}) {
  const policy = resolveClosurePolicyConfig(source);
  if (!policy.autoClosure.allowInferredIntegration) {
    return null;
  }
  const signals = closureSignalsFromDerivedState(derivedState);
  if (!signals.integrationReady) {
    return null;
  }
  const hasSemanticSignals =
    signals.openClaims.length > 0 ||
    signals.conflictingClaims.length > 0 ||
    signals.unresolvedBlockers.length > 0 ||
    signals.changedInterfaces.length > 0 ||
    signals.crossComponentImpacts.length > 0 ||
    signals.proofGaps.length > 0 ||
    signals.deployRisks.length > 0 ||
    signals.helperAssignments.length > 0 ||
    signals.inboundDependencies.length > 0 ||
    signals.outboundDependencies.length > 0 ||
    signals.blockingContradictions.length > 0 ||
    signals.openClarifications.length > 0 ||
    signals.openHuman.length > 0 ||
    signals.clarificationBarrier?.ok === false ||
    signals.helperAssignmentBarrier?.ok === false ||
    signals.dependencyBarrier?.ok === false ||
    signals.blockingAssignments.length > 0 ||
    signals.openDependencies.length > 0 ||
    signals.securityState === "blocked" ||
    signals.corridorSummary?.blocking === true ||
    (signals.corridorSummary?.ok === false &&
      signals.corridorSummary?.requiredAtClosure !== false);
  if (hasSemanticSignals) {
    return null;
  }
  return {
    ok: true,
    state: "inferred",
    statusCode: "pass",
    detail:
      "Integration closure was inferred from derived state; no semantic integration contradictions or blockers remain.",
  };
}

export function evaluateDocumentationAutoClosure(
  derivedState = {},
  source = {},
  options = {},
) {
  const policy = resolveClosurePolicyConfig(source);
  const signals = closureSignalsFromDerivedState(derivedState);
  const componentMatrixGate = options.componentMatrixGate || { ok: true };
  if (
    policy.autoClosure.allowAutoDocNoChange &&
    signals.sharedPlanItems.length === 0 &&
    signals.componentMatrixItems.length === 0
  ) {
    return {
      ok: true,
      state: "no-change",
      statusCode: "pass",
      detail:
        "Documentation closure was auto-satisfied because derived state shows no shared-plan or component-matrix delta.",
    };
  }
  if (
    policy.autoClosure.allowAutoDocProjection &&
    signals.sharedPlanItems.length === 0 &&
    signals.componentMatrixItems.length > 0 &&
    componentMatrixGate.ok
  ) {
    return {
      ok: true,
      state: "auto-closed",
      statusCode: "pass",
      detail:
        "Documentation closure was auto-satisfied because only mechanical component-matrix reconciliation remained and the canonical matrix is already current.",
    };
  }
  return null;
}
