import fs from "node:fs";
import path from "node:path";
import {
  agentSummaryPathFromStatusPath,
  buildAgentExecutionSummary,
  readAgentExecutionSummary,
  validateDesignSummary,
  validateContQaSummary,
  validateContEvalSummary,
  validateImplementationSummary,
  validateDocumentationClosureSummary,
  validateSecuritySummary,
  validateIntegrationSummary,
  writeAgentExecutionSummary,
} from "./agent-state.mjs";
import {
  projectLegacySummaryFromEnvelope,
  readAgentResultEnvelope,
  readAgentResultEnvelopeForRun,
  resolveRunEnvelopeContext,
  synthesizeLegacyEnvelope,
  validateResultEnvelope,
  writeAgentResultEnvelope,
  writeAgentResultEnvelopeForRun,
} from "./result-envelope.mjs";
import {
  REPO_ROOT,
  readFileTail,
  readJsonOrNull,
  readStatusRecordIfPresent,
  parseVerdictFromText,
  REPORT_VERDICT_REGEX,
  WAVE_VERDICT_REGEX,
  writeJsonAtomic,
} from "./shared.mjs";
import {
  isDocsOnlyDesignAgent,
  isSecurityReviewAgent,
  isDesignAgent,
  resolveDesignReportPath,
  resolveSecurityReviewReportPath,
  isContEvalReportOnlyAgent,
} from "./role-helpers.mjs";
import {
  augmentSummaryWithProofRegistry,
} from "./proof-registry.mjs";
import {
  validateWaveComponentPromotions,
  validateWaveComponentMatrixCurrentLevels,
} from "./wave-files.mjs";
import {
  coordinationRecordBlocksWave,
  openClarificationLinkedRequests,
} from "./coordination-store.mjs";
import { contradictionsBlockingGate } from "./contradiction-entity.mjs";

function contradictionList(value) {
  if (value instanceof Map) {
    return [...value.values()];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return Object.values(value);
  }
  return [];
}

function readIntegrationContradictionBarrier(derivedState, agentId, logPath) {
  const blockingContradictions = contradictionsBlockingGate(
    contradictionList(derivedState?.contradictions),
    "integrationBarrier",
  );
  if (blockingContradictions.length === 0) {
    return null;
  }
  return {
    ok: false,
    agentId,
    statusCode: "integration-contradiction-open",
    detail: `Unresolved blocking contradictions remain (${blockingContradictions.map((c) => c.contradictionId).join(", ")}).`,
    logPath,
  };
}

function isSecurityReviewAgentWithOptions(agent, options = {}) {
  return isSecurityReviewAgent(agent, {
    securityRolePromptPath: options.securityRolePromptPath,
  });
}

function resolveRunReportPath(wave, runInfo, options = {}) {
  if (!wave || !runInfo?.agent) {
    return null;
  }
  if (runInfo.agent.agentId === (wave.contQaAgentId || "A0") && wave.contQaReportPath) {
    return path.resolve(REPO_ROOT, wave.contQaReportPath);
  }
  if (runInfo.agent.agentId === (wave.contEvalAgentId || "E0") && wave.contEvalReportPath) {
    return path.resolve(REPO_ROOT, wave.contEvalReportPath);
  }
  if (isSecurityReviewAgentWithOptions(runInfo.agent, options)) {
    const securityReportPath = resolveSecurityReviewReportPath(runInfo.agent);
    return securityReportPath ? path.resolve(REPO_ROOT, securityReportPath) : null;
  }
  if (isDesignAgent(runInfo.agent)) {
    const designReportPath = resolveDesignReportPath(runInfo.agent);
    return designReportPath ? path.resolve(REPO_ROOT, designReportPath) : null;
  }
  return null;
}

function normalizeReadMode(mode) {
  return String(mode || "compat").trim().toLowerCase() === "live" ? "live" : "compat";
}

function buildEnvelopeReadOptions(runInfo, wave, statusRecord, reportPath) {
  return {
    agent: runInfo?.agent,
    waveNumber: wave?.wave ?? null,
    attempt: statusRecord?.attempt ?? null,
    logPath: runInfo?.logPath || null,
    reportPath,
  };
}

function validateEnvelopeForRun(runInfo, envelope, options = {}) {
  const validation = validateResultEnvelope(envelope, {
    agent: runInfo?.agent,
    waveNumber: options.wave?.wave ?? null,
  });
  return {
    valid: validation.valid,
    errors: validation.errors || [],
    detail: validation.valid ? null : validation.errors.join(" "),
    envelope: validation.valid ? envelope : null,
  };
}

export function materializeAgentExecutionSummaryForRun(wave, runInfo, options = {}) {
  const statusRecord = readStatusRecordIfPresent(runInfo.statusPath);
  if (!statusRecord) {
    return null;
  }
  const reportPath = resolveRunReportPath(wave, runInfo, options);
  const summary = buildAgentExecutionSummary({
    agent: runInfo.agent,
    statusRecord,
    logPath: runInfo.logPath,
    reportPath,
  });
  writeAgentExecutionSummary(runInfo.statusPath, summary);
  writeAgentResultEnvelopeForRun(
    runInfo,
    wave,
    synthesizeLegacyEnvelope(runInfo.agent, summary, {
      waveNumber: wave?.wave ?? null,
      attempt: statusRecord.attempt ?? null,
      exitCode: typeof statusRecord.code === "number" ? statusRecord.code : 0,
    }),
    {
      statusRecord,
    },
  );
  if (runInfo?.previewPath && fs.existsSync(runInfo.previewPath)) {
    const previewPayload = readJsonOrNull(runInfo.previewPath);
    if (previewPayload && typeof previewPayload === "object") {
      const nextLimits =
        previewPayload.limits && typeof previewPayload.limits === "object" && !Array.isArray(previewPayload.limits)
          ? { ...previewPayload.limits }
          : {};
      const observedTurnLimit = Number(summary?.terminationObservedTurnLimit);
      if (Number.isFinite(observedTurnLimit) && observedTurnLimit > 0) {
        nextLimits.observedTurnLimit = observedTurnLimit;
        nextLimits.observedTurnLimitSource = "runtime-log";
        if (runInfo.agent.executorResolved?.id === "codex") {
          const existingNotes = Array.isArray(nextLimits.notes) ? nextLimits.notes.slice() : [];
          const observedNote = `Observed runtime stop at ${observedTurnLimit} turns from executor log output.`;
          if (!existingNotes.includes(observedNote)) {
            existingNotes.push(observedNote);
          }
          nextLimits.notes = existingNotes;
        }
      }
      writeJsonAtomic(runInfo.previewPath, {
        ...previewPayload,
        limits: nextLimits,
      });
    }
  }
  return summary;
}

export function readRunResultEnvelope(runInfo, wave = null, options = {}) {
  const mode = normalizeReadMode(options.mode);
  const statusRecord = runInfo?.statusPath ? readStatusRecordIfPresent(runInfo.statusPath) : null;
  const reportPath = wave ? resolveRunReportPath(wave, runInfo, options) : null;
  const runEnvelopeContext = resolveRunEnvelopeContext(runInfo, wave, { statusRecord });
  const envelopeReadOptions = buildEnvelopeReadOptions(runInfo, wave, statusRecord, reportPath);
  const synthesizeFromSummary = (summary, source) => {
    if (!summary || mode === "live") {
      return null;
    }
    const envelope = synthesizeLegacyEnvelope(runInfo?.agent, summary, {
      waveNumber: wave?.wave ?? null,
      attempt: statusRecord?.attempt ?? null,
      exitCode:
        typeof statusRecord?.code === "number"
          ? statusRecord.code
          : typeof summary?.exitCode === "number"
            ? summary.exitCode
            : 0,
    });
    return {
      source,
      ...validateEnvelopeForRun(runInfo, envelope, { wave }),
    };
  };

  if (runInfo?.summary && typeof runInfo.summary === "object") {
    if (runInfo.summary.schemaVersion === 2) {
      return {
        source: "inline-envelope",
        ...validateEnvelopeForRun(runInfo, runInfo.summary, { wave }),
      };
    }
    const synthesized = synthesizeFromSummary(runInfo.summary, "inline-legacy-summary");
    if (synthesized) {
      return synthesized;
    }
  }
  if (runInfo?.statusPath && fs.existsSync(runInfo.statusPath)) {
    const envelope = readAgentResultEnvelopeForRun(runInfo, wave, { statusRecord });
    if (envelope) {
      const validation = {
        source: "run-envelope",
        ...validateEnvelopeForRun(runInfo, envelope, { wave }),
      };
      if (validation.valid || mode === "live") {
        return validation;
      }
    }
  }
  if (mode !== "live" && runInfo?.statusPath && fs.existsSync(runInfo.statusPath)) {
    const envelope = readAgentResultEnvelope(runInfo.statusPath);
    if (envelope) {
      const validation = {
        source: "legacy-status-envelope",
        ...validateEnvelopeForRun(runInfo, envelope, { wave }),
      };
      if (validation.valid) {
        return validation;
      }
    }
  }
  if (mode !== "live" && runInfo?.summaryPath && fs.existsSync(runInfo.summaryPath)) {
    const summary = readAgentExecutionSummary(runInfo.summaryPath, {
      agent: runInfo.agent,
      statusPath: runInfo.summaryPath,
      statusRecord,
      logPath: runInfo.logPath,
      reportPath,
    });
    const synthesized = synthesizeFromSummary(summary, "summary-file-legacy");
    if (synthesized) {
      return synthesized;
    }
  }
  if (
    mode !== "live" &&
    runInfo?.statusPath &&
    fs.existsSync(agentSummaryPathFromStatusPath(runInfo.statusPath))
  ) {
    const summary = readAgentExecutionSummary(runInfo.statusPath, {
      agent: runInfo.agent,
      statusPath: runInfo.statusPath,
      statusRecord,
      logPath: runInfo.logPath,
      reportPath,
    });
    const synthesized = synthesizeFromSummary(summary, "status-summary-legacy");
    if (synthesized) {
      return synthesized;
    }
  }
  if (
    mode !== "live" &&
    wave &&
    runInfo?.statusPath &&
    runInfo?.logPath &&
    fs.existsSync(runInfo.statusPath)
  ) {
    materializeAgentExecutionSummaryForRun(wave, runInfo, options);
    const envelope =
      readAgentResultEnvelopeForRun(runInfo, wave, { statusRecord }) ||
      readAgentResultEnvelope(runInfo.statusPath);
    if (envelope) {
      return {
        source: "materialized-legacy-envelope",
        ...validateEnvelopeForRun(runInfo, envelope, { wave }),
      };
    }
  }
  return {
    source: "missing-envelope",
    valid: false,
    errors: [
      `Missing result envelope for ${runInfo?.agent?.agentId || "unknown-agent"} at ${path.relative(REPO_ROOT, runEnvelopeContext.envelopePath)}.`,
    ],
    detail: `Missing result envelope for ${runInfo?.agent?.agentId || "unknown-agent"} at ${path.relative(REPO_ROOT, runEnvelopeContext.envelopePath)}.`,
    envelope: null,
    envelopeReadOptions,
  };
}

export function readRunExecutionSummary(runInfo, wave = null, options = {}) {
  const mode = normalizeReadMode(options.mode);
  const applyProofRegistry = (summary) =>
    runInfo?.proofRegistry ? augmentSummaryWithProofRegistry(runInfo.agent, summary, runInfo.proofRegistry) : summary;
  const statusRecord = runInfo?.statusPath ? readStatusRecordIfPresent(runInfo.statusPath) : null;
  const reportPath = wave ? resolveRunReportPath(wave, runInfo, options) : null;
  const envelopeReadOptions = buildEnvelopeReadOptions(runInfo, wave, statusRecord, reportPath);
  const envelopeResult = readRunResultEnvelope(runInfo, wave, {
    mode,
    securityRolePromptPath: options.securityRolePromptPath,
  });
  if (envelopeResult?.valid && envelopeResult.envelope) {
    return applyProofRegistry(
      projectLegacySummaryFromEnvelope(envelopeResult.envelope, envelopeReadOptions),
    );
  }
  if (mode === "live") {
    return null;
  }
  if (runInfo?.summary && typeof runInfo.summary === "object") {
    return applyProofRegistry(runInfo.summary);
  }
  if (runInfo?.summaryPath && fs.existsSync(runInfo.summaryPath)) {
    return applyProofRegistry(readAgentExecutionSummary(runInfo.summaryPath, {
      agent: runInfo.agent,
      statusPath: runInfo.summaryPath,
      statusRecord,
      logPath: runInfo.logPath,
      reportPath,
    }));
  }
  if (runInfo?.statusPath && fs.existsSync(agentSummaryPathFromStatusPath(runInfo.statusPath))) {
    return applyProofRegistry(readAgentExecutionSummary(runInfo.statusPath, {
      agent: runInfo.agent,
      statusPath: runInfo.statusPath,
      statusRecord,
      logPath: runInfo.logPath,
      reportPath,
    }));
  }
  return null;
}

export function materializeAgentExecutionSummaries(wave, agentRuns, options = {}) {
  return Object.fromEntries(
    agentRuns.map((runInfo) => [
      runInfo.agent.agentId,
      materializeAgentExecutionSummaryForRun(wave, runInfo, options),
    ]),
  );
}

export function readWaveContQaGate(wave, agentRuns, options = {}) {
  const mode = String(options.mode || "compat").trim().toLowerCase();
  const strict = mode === "live";
  const contQaAgentId = options.contQaAgentId || wave.contQaAgentId || "A0";
  const contQaRun =
    agentRuns.find((run) => run.agent.agentId === contQaAgentId) ?? null;
  if (!contQaRun) {
    return {
      ok: false,
      agentId: contQaAgentId,
      statusCode: "missing-cont-qa",
      detail: `Agent ${contQaAgentId} is missing.`,
      logPath: null,
    };
  }
  const envelopeResult = readRunResultEnvelope(contQaRun, wave, {
    mode,
    securityRolePromptPath: options.securityRolePromptPath,
  });
  const summary = envelopeResult.valid
    ? projectLegacySummaryFromEnvelope(
        envelopeResult.envelope,
        buildEnvelopeReadOptions(
          contQaRun,
          wave,
          contQaRun?.statusPath ? readStatusRecordIfPresent(contQaRun.statusPath) : null,
          resolveRunReportPath(wave, contQaRun, options),
        ),
      )
    : readRunExecutionSummary(contQaRun, wave, {
      mode,
      securityRolePromptPath: options.securityRolePromptPath,
    });
  if (summary) {
    const validation = validateContQaSummary(contQaRun.agent, summary, { mode });
    return {
      ok: validation.ok,
      agentId: contQaRun.agent.agentId,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: summary.logPath || path.relative(REPO_ROOT, contQaRun.logPath),
    };
  }
  if (strict) {
    return {
      ok: false,
      agentId: contQaRun.agent.agentId,
      statusCode:
        envelopeResult.source === "missing-envelope"
          ? "missing-result-envelope"
          : "invalid-result-envelope",
      detail:
        envelopeResult.detail ||
        `Missing structured cont-QA result envelope for ${contQaRun.agent.agentId}.`,
      logPath: path.relative(REPO_ROOT, contQaRun.logPath),
    };
  }
  const contQaReportPath = wave.contQaReportPath
    ? path.resolve(REPO_ROOT, wave.contQaReportPath)
    : null;
  const reportText =
    contQaReportPath && fs.existsSync(contQaReportPath)
      ? fs.readFileSync(contQaReportPath, "utf8")
      : "";
  const reportVerdict = parseVerdictFromText(reportText, REPORT_VERDICT_REGEX);
  if (reportVerdict.verdict) {
    return {
      ok: reportVerdict.verdict === "pass",
      agentId: contQaRun.agent.agentId,
      statusCode: reportVerdict.verdict === "pass" ? "pass" : `cont-qa-${reportVerdict.verdict}`,
      detail: reportVerdict.detail || "Verdict read from cont-QA report.",
      logPath: path.relative(REPO_ROOT, contQaRun.logPath),
    };
  }
  const logVerdict = parseVerdictFromText(
    readFileTail(contQaRun.logPath, 30000),
    WAVE_VERDICT_REGEX,
  );
  if (logVerdict.verdict) {
    return {
      ok: logVerdict.verdict === "pass",
      agentId: contQaRun.agent.agentId,
      statusCode: logVerdict.verdict === "pass" ? "pass" : `cont-qa-${logVerdict.verdict}`,
      detail: logVerdict.detail || "Verdict read from cont-QA log marker.",
      logPath: path.relative(REPO_ROOT, contQaRun.logPath),
    };
  }
  return {
    ok: false,
    agentId: contQaRun.agent.agentId,
    statusCode: "missing-cont-qa-verdict",
    detail: contQaReportPath
      ? `Missing Verdict line in ${path.relative(REPO_ROOT, contQaReportPath)} and no [wave-verdict] marker in ${path.relative(REPO_ROOT, contQaRun.logPath)}.`
      : `Missing cont-QA report path and no [wave-verdict] marker in ${path.relative(REPO_ROOT, contQaRun.logPath)}.`,
    logPath: path.relative(REPO_ROOT, contQaRun.logPath),
  };
}

export function readWaveContEvalGate(wave, agentRuns, options = {}) {
  const mode = String(options.mode || "compat").trim().toLowerCase();
  const strict = mode === "live";
  const contEvalAgentId = options.contEvalAgentId || wave.contEvalAgentId || "E0";
  const contEvalRun =
    agentRuns.find((run) => run.agent.agentId === contEvalAgentId) ?? null;
  if (!contEvalRun) {
    return {
      ok: true,
      agentId: null,
      statusCode: "pass",
      detail: "Wave does not include cont-EVAL.",
      logPath: null,
    };
  }
  const envelopeResult = readRunResultEnvelope(contEvalRun, wave, {
    mode,
    securityRolePromptPath: options.securityRolePromptPath,
  });
  const summary = envelopeResult.valid
    ? projectLegacySummaryFromEnvelope(
        envelopeResult.envelope,
        buildEnvelopeReadOptions(
          contEvalRun,
          wave,
          contEvalRun?.statusPath ? readStatusRecordIfPresent(contEvalRun.statusPath) : null,
          resolveRunReportPath(wave, contEvalRun, options),
        ),
      )
    : readRunExecutionSummary(contEvalRun, wave, {
      mode,
      securityRolePromptPath: options.securityRolePromptPath,
    });
  if (summary) {
    const validation = validateContEvalSummary(contEvalRun.agent, summary, {
      mode,
      evalTargets: options.evalTargets || wave.evalTargets,
      benchmarkCatalogPath: options.benchmarkCatalogPath,
    });
    return {
      ok: validation.ok,
      agentId: contEvalRun.agent.agentId,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: summary.logPath || path.relative(REPO_ROOT, contEvalRun.logPath),
    };
  }
  return {
    ok: false,
    agentId: contEvalRun.agent.agentId,
    statusCode:
      strict && envelopeResult.source !== "missing-envelope"
        ? "invalid-result-envelope"
        : strict
          ? "missing-result-envelope"
          : "missing-wave-eval",
    detail:
      strict && envelopeResult.detail
        ? envelopeResult.detail
        : `Missing [wave-eval] marker for ${contEvalRun.agent.agentId}.`,
    logPath: path.relative(REPO_ROOT, contEvalRun.logPath),
  };
}

export function readWaveEvaluatorGate(wave, agentRuns, options = {}) {
  return readWaveContQaGate(wave, agentRuns, {
    ...options,
    contQaAgentId: options.evaluatorAgentId || options.contQaAgentId,
  });
}

export function readWaveImplementationGate(wave, agentRuns, options = {}) {
  const mode = normalizeReadMode(options.mode || "live");
  const contQaAgentId = wave.contQaAgentId || "A0";
  const contEvalAgentId = wave.contEvalAgentId || "E0";
  const integrationAgentId = wave.integrationAgentId || "A8";
  const documentationAgentId = wave.documentationAgentId || "A9";
  for (const runInfo of agentRuns) {
    if (
      [contQaAgentId, integrationAgentId, documentationAgentId].includes(runInfo.agent.agentId) ||
      isContEvalReportOnlyAgent(runInfo.agent, { contEvalAgentId }) ||
      isDocsOnlyDesignAgent(runInfo.agent) ||
      isSecurityReviewAgentWithOptions(runInfo.agent, options)
    ) {
      continue;
    }
    const envelopeResult = readRunResultEnvelope(runInfo, wave, {
      mode,
      securityRolePromptPath: options.securityRolePromptPath,
    });
    if (mode === "live" && !envelopeResult.valid) {
      return {
        ok: false,
        agentId: runInfo.agent.agentId,
        statusCode:
          envelopeResult.source === "missing-envelope"
            ? "missing-result-envelope"
            : "invalid-result-envelope",
        detail:
          envelopeResult.detail ||
          `Missing structured implementation result envelope for ${runInfo.agent.agentId}.`,
        logPath: path.relative(REPO_ROOT, runInfo.logPath),
      };
    }
    const summary = envelopeResult.valid
      ? projectLegacySummaryFromEnvelope(
          envelopeResult.envelope,
          buildEnvelopeReadOptions(
            runInfo,
            wave,
            runInfo?.statusPath ? readStatusRecordIfPresent(runInfo.statusPath) : null,
            resolveRunReportPath(wave, runInfo, options),
          ),
        )
      : readRunExecutionSummary(runInfo, wave, {
        mode,
        securityRolePromptPath: options.securityRolePromptPath,
      });
    const validation = validateImplementationSummary(runInfo.agent, summary);
    if (!validation.ok) {
      return {
        ok: false,
        agentId: runInfo.agent.agentId,
        statusCode: validation.statusCode,
        detail: validation.detail,
        logPath: summary?.logPath || path.relative(REPO_ROOT, runInfo.logPath),
      };
    }
  }
  return {
    ok: true,
    agentId: null,
    statusCode: "pass",
    detail: "All implementation exit contracts are satisfied.",
    logPath: null,
  };
}

export function readWaveDesignGate(wave, agentRuns, options = {}) {
  const mode = normalizeReadMode(options.mode || "live");
  const designRuns = (agentRuns || []).filter((run) => isDesignAgent(run.agent));
  if (designRuns.length === 0) {
    return {
      ok: true,
      agentId: null,
      statusCode: "pass",
      detail: "No design agent declared for this wave.",
      logPath: null,
    };
  }
  for (const runInfo of designRuns) {
    const envelopeResult = readRunResultEnvelope(runInfo, wave, {
      mode,
      securityRolePromptPath: options.securityRolePromptPath,
    });
    if (mode === "live" && !envelopeResult.valid) {
      return {
        ok: false,
        agentId: runInfo.agent.agentId,
        statusCode:
          envelopeResult.source === "missing-envelope"
            ? "missing-result-envelope"
            : "invalid-result-envelope",
        detail:
          envelopeResult.detail ||
          `Missing structured design result envelope for ${runInfo.agent.agentId}.`,
        logPath: path.relative(REPO_ROOT, runInfo.logPath),
      };
    }
    const summary = envelopeResult.valid
      ? projectLegacySummaryFromEnvelope(
          envelopeResult.envelope,
          buildEnvelopeReadOptions(
            runInfo,
            wave,
            runInfo?.statusPath ? readStatusRecordIfPresent(runInfo.statusPath) : null,
            resolveRunReportPath(wave, runInfo, options),
          ),
        )
      : readRunExecutionSummary(runInfo, wave, {
        mode,
        securityRolePromptPath: options.securityRolePromptPath,
      });
    const validation = validateDesignSummary(runInfo.agent, summary);
    if (!validation.ok) {
      return {
        ok: false,
        agentId: runInfo.agent.agentId,
        statusCode: validation.statusCode,
        detail: validation.detail,
        logPath: summary?.logPath || path.relative(REPO_ROOT, runInfo.logPath),
      };
    }
  }
  return {
    ok: true,
    agentId: null,
    statusCode: "pass",
    detail: "All design packets are ready for implementation.",
    logPath: null,
  };
}

export function analyzePromotedComponentOwners(componentId, agentRuns, summariesByAgentId) {
  const ownerRuns = (agentRuns || []).filter((runInfo) =>
    runInfo.agent.components?.includes(componentId),
  );
  const ownerAgentIds = ownerRuns.map((runInfo) => runInfo.agent.agentId);
  const satisfiedAgentIds = [];
  const waitingOnAgentIds = [];
  const failedOwnContractAgentIds = [];
  for (const runInfo of ownerRuns) {
    const summary = summariesByAgentId?.[runInfo.agent.agentId] || null;
    const implementationValidation = validateImplementationSummary(runInfo.agent, summary);
    const componentMarkers = new Map(
      Array.isArray(summary?.components)
        ? summary.components.map((component) => [component.componentId, component])
        : [],
    );
    const marker = componentMarkers.get(componentId);
    const expectedLevel = runInfo.agent.componentTargets?.[componentId] || null;
    const componentSatisfied =
      marker &&
      marker.state === "met" &&
      (!expectedLevel || marker.level === expectedLevel);
    if (implementationValidation.ok && componentSatisfied) {
      satisfiedAgentIds.push(runInfo.agent.agentId);
      continue;
    }
    waitingOnAgentIds.push(runInfo.agent.agentId);
    if (!implementationValidation.ok) {
      failedOwnContractAgentIds.push(runInfo.agent.agentId);
    }
  }
  return {
    componentId,
    ownerRuns,
    ownerAgentIds,
    satisfiedAgentIds,
    waitingOnAgentIds,
    failedOwnContractAgentIds,
  };
}

export function buildSharedComponentSiblingPendingFailure(componentState) {
  if (
    !componentState ||
    componentState.satisfiedAgentIds.length === 0 ||
    componentState.waitingOnAgentIds.length === 0
  ) {
    return null;
  }
  const landedSummary =
    componentState.satisfiedAgentIds.length === 1
      ? `${componentState.satisfiedAgentIds[0]} desired-state slice landed`
      : `${componentState.satisfiedAgentIds.join(", ")} desired-state slices landed`;
  const ownerRun =
    componentState.ownerRuns.find((runInfo) =>
      componentState.waitingOnAgentIds.includes(runInfo.agent.agentId),
    ) ||
    componentState.ownerRuns[0] ||
    null;
  return {
    ok: false,
    agentId: componentState.waitingOnAgentIds[0] || ownerRun?.agent?.agentId || null,
    componentId: componentState.componentId || null,
    statusCode: "shared-component-sibling-pending",
    detail: `${landedSummary}; shared component closure still depends on ${componentState.waitingOnAgentIds.join("/")}.`,
    logPath: ownerRun ? path.relative(REPO_ROOT, ownerRun.logPath) : null,
    ownerAgentIds: componentState.ownerAgentIds,
    satisfiedAgentIds: componentState.satisfiedAgentIds,
    waitingOnAgentIds: componentState.waitingOnAgentIds,
    failedOwnContractAgentIds: componentState.failedOwnContractAgentIds,
  };
}

export function readWaveComponentGate(wave, agentRuns, options = {}) {
  const mode = normalizeReadMode(options.mode);
  const summariesByAgentId = Object.fromEntries(
    agentRuns.map((runInfo) => [
      runInfo.agent.agentId,
      readRunExecutionSummary(runInfo, wave, {
        mode,
        securityRolePromptPath: options.securityRolePromptPath,
      }),
    ]),
  );
  const validation = validateWaveComponentPromotions(wave, summariesByAgentId, options);
  const sharedPending = (wave.componentPromotions || [])
    .map((promotion) =>
      buildSharedComponentSiblingPendingFailure(
        analyzePromotedComponentOwners(promotion.componentId, agentRuns, summariesByAgentId),
      ),
    )
    .find(Boolean);
  if (sharedPending) {
    return sharedPending;
  }
  if (validation.ok) {
    return {
      ok: true,
      agentId: null,
      componentId: null,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: null,
    };
  }
  const componentState = analyzePromotedComponentOwners(
    validation.componentId,
    agentRuns,
    summariesByAgentId,
  );
  const ownerRun = componentState.ownerRuns[0] ?? null;
  return {
    ok: false,
    agentId: ownerRun?.agent?.agentId || null,
    componentId: validation.componentId || null,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: ownerRun ? path.relative(REPO_ROOT, ownerRun.logPath) : null,
    ownerAgentIds: componentState.ownerAgentIds,
    satisfiedAgentIds: componentState.satisfiedAgentIds,
    waitingOnAgentIds: componentState.waitingOnAgentIds,
    failedOwnContractAgentIds: componentState.failedOwnContractAgentIds,
  };
}

export function readWaveComponentMatrixGate(wave, agentRuns, options = {}) {
  const validation = validateWaveComponentMatrixCurrentLevels(wave, options);
  if (validation.ok) {
    return {
      ok: true,
      agentId: null,
      componentId: null,
      statusCode: validation.statusCode,
      detail: validation.detail,
      logPath: null,
    };
  }
  const documentationAgentId =
    options.documentationAgentId || wave.documentationAgentId || "A9";
  const docRun =
    agentRuns.find((runInfo) => runInfo.agent.agentId === documentationAgentId) ?? null;
  return {
    ok: false,
    agentId: docRun?.agent?.agentId || null,
    componentId: validation.componentId || null,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: docRun ? path.relative(REPO_ROOT, docRun.logPath) : null,
  };
}

export function readWaveDocumentationGate(wave, agentRuns, options = {}) {
  const mode = normalizeReadMode(options.mode || "live");
  const documentationAgentId = wave.documentationAgentId || "A9";
  const docRun =
    agentRuns.find((run) => run.agent.agentId === documentationAgentId) ?? null;
  if (!docRun) {
    return {
      ok: true,
      agentId: null,
      statusCode: "pass",
      detail: "No documentation steward declared for this wave.",
      logPath: null,
    };
  }
  const envelopeResult = readRunResultEnvelope(docRun, wave, {
    mode,
    securityRolePromptPath: options.securityRolePromptPath,
  });
  if (mode === "live" && !envelopeResult.valid) {
    return {
      ok: false,
      agentId: docRun.agent.agentId,
      statusCode:
        envelopeResult.source === "missing-envelope"
          ? "missing-result-envelope"
          : "invalid-result-envelope",
      detail:
        envelopeResult.detail ||
        `Missing structured documentation result envelope for ${docRun.agent.agentId}.`,
      logPath: path.relative(REPO_ROOT, docRun.logPath),
    };
  }
  const summary = envelopeResult.valid
    ? projectLegacySummaryFromEnvelope(
        envelopeResult.envelope,
        buildEnvelopeReadOptions(
          docRun,
          wave,
          docRun?.statusPath ? readStatusRecordIfPresent(docRun.statusPath) : null,
          resolveRunReportPath(wave, docRun, options),
        ),
      )
    : readRunExecutionSummary(docRun, wave, {
      mode,
      securityRolePromptPath: options.securityRolePromptPath,
    });
  const validation = validateDocumentationClosureSummary(docRun.agent, summary);
  return {
    ok: validation.ok,
    agentId: docRun.agent.agentId,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: summary?.logPath || path.relative(REPO_ROOT, docRun.logPath),
  };
}

export function readWaveSecurityGate(wave, agentRuns, options = {}) {
  const mode = normalizeReadMode(options.mode || "live");
  const securityRuns = (agentRuns || []).filter((run) =>
    isSecurityReviewAgentWithOptions(run.agent, options),
  );
  if (securityRuns.length === 0) {
    return {
      ok: true,
      agentId: null,
      statusCode: "pass",
      detail: "No security reviewer declared for this wave.",
      logPath: null,
    };
  }
  const concernAgentIds = [];
  for (const runInfo of securityRuns) {
    const envelopeResult = readRunResultEnvelope(runInfo, wave, {
      mode,
      securityRolePromptPath: options.securityRolePromptPath,
    });
    if (mode === "live" && !envelopeResult.valid) {
      return {
        ok: false,
        agentId: runInfo.agent.agentId,
        statusCode:
          envelopeResult.source === "missing-envelope"
            ? "missing-result-envelope"
            : "invalid-result-envelope",
        detail:
          envelopeResult.detail ||
          `Missing structured security result envelope for ${runInfo.agent.agentId}.`,
        logPath: path.relative(REPO_ROOT, runInfo.logPath),
      };
    }
    const summary = envelopeResult.valid
      ? projectLegacySummaryFromEnvelope(
          envelopeResult.envelope,
          buildEnvelopeReadOptions(
            runInfo,
            wave,
            runInfo?.statusPath ? readStatusRecordIfPresent(runInfo.statusPath) : null,
            resolveRunReportPath(wave, runInfo, options),
          ),
        )
      : readRunExecutionSummary(runInfo, wave, {
        mode,
        securityRolePromptPath: options.securityRolePromptPath,
      });
    const validation = validateSecuritySummary(runInfo.agent, summary);
    if (!validation.ok) {
      return {
        ok: false,
        agentId: runInfo.agent.agentId,
        statusCode: validation.statusCode,
        detail: validation.detail,
        logPath: summary?.logPath || path.relative(REPO_ROOT, runInfo.logPath),
      };
    }
    if (summary?.security?.state === "concerns") {
      concernAgentIds.push(runInfo.agent.agentId);
    }
  }
  if (concernAgentIds.length > 0) {
    return {
      ok: true,
      agentId: null,
      statusCode: "security-concerns",
      detail: `Security review reported advisory concerns (${concernAgentIds.join(", ")}).`,
      logPath: null,
    };
  }
  return {
    ok: true,
    agentId: null,
    statusCode: "pass",
    detail: "Security review is clear.",
    logPath: null,
  };
}

export function readWaveIntegrationGate(wave, agentRuns, options = {}) {
  const mode = normalizeReadMode(options.mode || "live");
  const integrationAgentId =
    options.integrationAgentId || wave.integrationAgentId || "A8";
  const requireIntegration =
    options.requireIntegrationSteward === true ||
    (options.requireIntegrationStewardFromWave !== null &&
      options.requireIntegrationStewardFromWave !== undefined &&
      wave.wave >= options.requireIntegrationStewardFromWave);
  const integrationRun =
    agentRuns.find((run) => run.agent.agentId === integrationAgentId) ?? null;
  if (!integrationRun) {
    return {
      ok: !requireIntegration,
      agentId: requireIntegration ? integrationAgentId : null,
      statusCode: requireIntegration ? "missing-integration" : "pass",
      detail: requireIntegration
        ? `Agent ${integrationAgentId} is missing.`
        : "No explicit integration steward declared for this wave.",
      logPath: null,
    };
  }
  const envelopeResult = readRunResultEnvelope(integrationRun, wave, {
    mode,
    securityRolePromptPath: options.securityRolePromptPath,
  });
  if (mode === "live" && !envelopeResult.valid) {
    return {
      ok: false,
      agentId: integrationRun.agent.agentId,
      statusCode:
        envelopeResult.source === "missing-envelope"
          ? "missing-result-envelope"
          : "invalid-result-envelope",
      detail:
        envelopeResult.detail ||
        `Missing structured integration result envelope for ${integrationRun.agent.agentId}.`,
      logPath: path.relative(REPO_ROOT, integrationRun.logPath),
    };
  }
  const summary = envelopeResult.valid
    ? projectLegacySummaryFromEnvelope(
        envelopeResult.envelope,
        buildEnvelopeReadOptions(
          integrationRun,
          wave,
          integrationRun?.statusPath ? readStatusRecordIfPresent(integrationRun.statusPath) : null,
          resolveRunReportPath(wave, integrationRun, options),
        ),
      )
    : readRunExecutionSummary(integrationRun, wave, {
      mode,
      securityRolePromptPath: options.securityRolePromptPath,
    });
  const validation = validateIntegrationSummary(integrationRun.agent, summary);
  return {
    ok: validation.ok,
    agentId: integrationRun.agent.agentId,
    statusCode: validation.statusCode,
    detail: validation.detail,
    logPath: summary?.logPath || path.relative(REPO_ROOT, integrationRun.logPath),
  };
}

export function readWaveIntegrationBarrier(wave, agentRuns, derivedState, options = {}) {
  const markerGate = readWaveIntegrationGate(wave, agentRuns, options);
  if (!markerGate.ok) {
    return markerGate;
  }
  const integrationSummary = derivedState?.integrationSummary || null;
  if (!integrationSummary) {
    return {
      ok: false,
      agentId: markerGate.agentId,
      statusCode: "missing-integration-summary",
      detail: `Missing integration summary artifact for wave ${wave.wave}.`,
      logPath: markerGate.logPath,
    };
  }
  if (integrationSummary.recommendation !== "ready-for-doc-closure") {
    return {
      ok: false,
      agentId: markerGate.agentId,
      statusCode: "integration-needs-more-work",
      detail:
        integrationSummary.detail ||
        `Integration summary still reports ${integrationSummary.recommendation}.`,
      logPath: markerGate.logPath,
    };
  }
  const contradictionBarrier = readIntegrationContradictionBarrier(
    derivedState,
    markerGate.agentId,
    markerGate.logPath,
  );
  if (contradictionBarrier) {
    return contradictionBarrier;
  }
  return markerGate;
}

export function readClarificationBarrier(derivedState) {
  const openClarifications = (derivedState?.coordinationState?.clarifications || []).filter(
    (record) => coordinationRecordBlocksWave(record),
  );
  if (openClarifications.length > 0) {
    return {
      ok: false,
      statusCode: "clarification-open",
      detail: `Open clarifications remain (${openClarifications.map((record) => record.id).join(", ")}).`,
    };
  }
  const openClarificationRequests = openClarificationLinkedRequests(
    derivedState?.coordinationState,
  ).filter((record) => coordinationRecordBlocksWave(record));
  if (openClarificationRequests.length > 0) {
    return {
      ok: false,
      statusCode: "clarification-follow-up-open",
      detail: `Clarification follow-up requests remain open (${openClarificationRequests.map((record) => record.id).join(", ")}).`,
    };
  }
  const pendingHuman = [
    ...((derivedState?.coordinationState?.humanEscalations || []).filter((record) =>
      coordinationRecordBlocksWave(record),
    )),
    ...((derivedState?.coordinationState?.humanFeedback || []).filter((record) =>
      coordinationRecordBlocksWave(record),
    )),
  ];
  if (pendingHuman.length > 0) {
    return {
      ok: false,
      statusCode: "human-feedback-open",
      detail: `Pending human input remains (${pendingHuman.map((record) => record.id).join(", ")}).`,
    };
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: "",
  };
}

export function readWaveAssignmentBarrier(derivedState) {
  const blockingAssignments = (derivedState?.capabilityAssignments || []).filter(
    (assignment) => assignment.blocking,
  );
  if (blockingAssignments.length === 0) {
    return {
      ok: true,
      statusCode: "pass",
      detail: "",
    };
  }
  const unresolvedAssignments = blockingAssignments.filter((assignment) => !assignment.assignedAgentId);
  if (unresolvedAssignments.length > 0) {
    return {
      ok: false,
      statusCode: "helper-assignment-unresolved",
      detail: `Helper assignments remain unresolved (${unresolvedAssignments.map((assignment) => assignment.requestId).join(", ")}).`,
    };
  }
  return {
    ok: false,
    statusCode: "helper-assignment-open",
    detail: `Helper assignments remain open (${blockingAssignments.map((assignment) => assignment.requestId).join(", ")}).`,
  };
}

export function readWaveDependencyBarrier(derivedState) {
  const requiredInbound = derivedState?.dependencySnapshot?.requiredInbound || [];
  const requiredOutbound = derivedState?.dependencySnapshot?.requiredOutbound || [];
  const unresolvedInboundAssignments =
    derivedState?.dependencySnapshot?.unresolvedInboundAssignments || [];
  if (unresolvedInboundAssignments.length > 0) {
    return {
      ok: false,
      statusCode: "dependency-assignment-unresolved",
      detail: `Required inbound dependencies are unassigned (${unresolvedInboundAssignments.map((record) => record.id).join(", ")}).`,
    };
  }
  if (requiredInbound.length > 0 || requiredOutbound.length > 0) {
    return {
      ok: false,
      statusCode: "dependency-open",
      detail: `Open required dependencies remain (${[...requiredInbound, ...requiredOutbound].map((record) => record.id).join(", ")}).`,
    };
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: "",
  };
}

export function buildGateSnapshot({
  wave,
  agentRuns,
  derivedState,
  lanePaths,
  componentMatrixPayload,
  componentMatrixJsonPath,
  validationMode = "compat",
  readWaveInfraGateFn,
}) {
  const agentResults = Object.fromEntries(
    (agentRuns || [])
      .map((runInfo) => [
        runInfo.agent.agentId,
        readRunExecutionSummary(runInfo, wave, {
          mode: validationMode,
          securityRolePromptPath: lanePaths?.securityRolePromptPath,
        }),
      ])
      .filter(([, summary]) => Boolean(summary)),
  );
  return buildGateSnapshotPure({
    wave,
    agentResults,
    derivedState: {
      ...derivedState,
      clarificationBarrier:
        derivedState?.clarificationBarrier || readClarificationBarrier(derivedState),
      helperAssignmentBarrier:
        derivedState?.helperAssignmentBarrier || readWaveAssignmentBarrier(derivedState),
      dependencyBarrier:
        derivedState?.dependencyBarrier || readWaveDependencyBarrier(derivedState),
    },
    validationMode,
    laneConfig: {
      contQaAgentId: lanePaths?.contQaAgentId,
      contEvalAgentId: lanePaths?.contEvalAgentId,
      integrationAgentId: lanePaths?.integrationAgentId,
      documentationAgentId: lanePaths?.documentationAgentId,
      securityRolePromptPath: lanePaths?.securityRolePromptPath,
      requireIntegrationStewardFromWave: lanePaths?.requireIntegrationStewardFromWave,
      laneProfile: lanePaths?.laneProfile,
      benchmarkCatalogPath: lanePaths?.laneProfile?.paths?.benchmarkCatalogPath,
      componentMatrixPayload,
      componentMatrixJsonPath,
    },
  });
}

// --- Pure gate variants (no file I/O) ---
// These accept agentResults map { agentId: executionSummary } instead of runInfo objects.
// Used by the wave-state-reducer for deterministic replay.

function waveDeclaresAgent(wave, agentId) {
  return (Array.isArray(wave?.agents) ? wave.agents : []).some(
    (agent) => agent?.agentId === agentId,
  );
}

export function readWaveImplementationGatePure(wave, agentResults, options = {}) {
  const contQaAgentId = options.contQaAgentId || wave.contQaAgentId || "A0";
  const contEvalAgentId = options.contEvalAgentId || wave.contEvalAgentId || "E0";
  const integrationAgentId = options.integrationAgentId || wave.integrationAgentId || "A8";
  const documentationAgentId = options.documentationAgentId || wave.documentationAgentId || "A9";
  const agents = Array.isArray(wave.agents) ? wave.agents : [];
  for (const agent of agents) {
    if (
      [contQaAgentId, integrationAgentId, documentationAgentId].includes(agent.agentId) ||
      isContEvalReportOnlyAgent(agent, { contEvalAgentId }) ||
      isDocsOnlyDesignAgent(agent) ||
      isSecurityReviewAgentWithOptions(agent, options)
    ) {
      continue;
    }
    const summary = agentResults?.[agent.agentId] || null;
    const validation = validateImplementationSummary(agent, summary);
    if (!validation.ok) {
      return {
        ok: false,
        agentId: agent.agentId,
        statusCode: validation.statusCode,
        detail: validation.detail,
        logPath: summary?.logPath || null,
      };
    }
  }
  return {
    ok: true, agentId: null, statusCode: "pass",
    detail: "All implementation exit contracts are satisfied.", logPath: null,
  };
}

export function readWaveDesignGatePure(wave, agentResults) {
  const agents = Array.isArray(wave.agents) ? wave.agents : [];
  const designAgents = agents.filter((agent) => isDesignAgent(agent));
  if (designAgents.length === 0) {
    return {
      ok: true,
      agentId: null,
      statusCode: "pass",
      detail: "No design agent declared for this wave.",
      logPath: null,
    };
  }
  for (const agent of designAgents) {
    const summary = agentResults?.[agent.agentId] || null;
    const validation = validateDesignSummary(agent, summary);
    if (!validation.ok) {
      return {
        ok: false,
        agentId: agent.agentId,
        statusCode: validation.statusCode,
        detail: validation.detail,
        logPath: summary?.logPath || null,
      };
    }
  }
  return {
    ok: true,
    agentId: null,
    statusCode: "pass",
    detail: "All design packets are ready for implementation.",
    logPath: null,
  };
}

export function readWaveContQaGatePure(wave, agentResults, options = {}) {
  const mode = String(options.mode || "live").trim().toLowerCase();
  const contQaAgentId = options.contQaAgentId || wave.contQaAgentId || "A0";
  const summary = agentResults?.[contQaAgentId] || null;
  if (!summary) {
    return { ok: false, agentId: contQaAgentId, statusCode: "missing-cont-qa",
      detail: `Missing cont-QA summary for ${contQaAgentId}.`, logPath: null };
  }
  const agent = { agentId: contQaAgentId };
  const validation = validateContQaSummary(agent, summary, { mode });
  return { ok: validation.ok, agentId: contQaAgentId, statusCode: validation.statusCode,
    detail: validation.detail, logPath: summary?.logPath || null };
}

export function readWaveContEvalGatePure(wave, agentResults, options = {}) {
  const mode = String(options.mode || "live").trim().toLowerCase();
  const contEvalAgentId = options.contEvalAgentId || wave.contEvalAgentId || "E0";
  if (!waveDeclaresAgent(wave, contEvalAgentId)) {
    return { ok: true, agentId: null, statusCode: "pass",
      detail: "Wave does not include cont-EVAL.", logPath: null };
  }
  const summary = agentResults?.[contEvalAgentId] || null;
  const agent = { agentId: contEvalAgentId };
  const validation = validateContEvalSummary(agent, summary, {
    mode, evalTargets: options.evalTargets || wave.evalTargets,
    benchmarkCatalogPath: options.benchmarkCatalogPath,
  });
  return { ok: validation.ok, agentId: contEvalAgentId, statusCode: validation.statusCode,
    detail: validation.detail, logPath: summary?.logPath || null };
}

export function readWaveEvaluatorGatePure(wave, agentResults, options = {}) {
  return readWaveContQaGatePure(wave, agentResults, {
    ...options, contQaAgentId: options.evaluatorAgentId || options.contQaAgentId,
  });
}

function analyzePromotedComponentOwnersPure(componentId, agents, summariesByAgentId) {
  const ownerAgents = (agents || []).filter((agent) => agent.components?.includes(componentId));
  const ownerAgentIds = ownerAgents.map((agent) => agent.agentId);
  const satisfiedAgentIds = [];
  const waitingOnAgentIds = [];
  const failedOwnContractAgentIds = [];
  for (const agent of ownerAgents) {
    const summary = summariesByAgentId?.[agent.agentId] || null;
    const implementationValidation = validateImplementationSummary(agent, summary);
    const componentMarkers = new Map(
      Array.isArray(summary?.components)
        ? summary.components.map((c) => [c.componentId, c]) : [],
    );
    const marker = componentMarkers.get(componentId);
    const expectedLevel = agent.componentTargets?.[componentId] || null;
    const componentSatisfied = marker && marker.state === "met" &&
      (!expectedLevel || marker.level === expectedLevel);
    if (implementationValidation.ok && componentSatisfied) {
      satisfiedAgentIds.push(agent.agentId);
    } else {
      waitingOnAgentIds.push(agent.agentId);
      if (!implementationValidation.ok) { failedOwnContractAgentIds.push(agent.agentId); }
    }
  }
  return { componentId, ownerAgentIds, satisfiedAgentIds, waitingOnAgentIds, failedOwnContractAgentIds };
}

function buildSharedComponentSiblingPendingPure(componentId, agents, summariesByAgentId) {
  const componentState = analyzePromotedComponentOwnersPure(componentId, agents, summariesByAgentId);
  if (componentState.satisfiedAgentIds.length === 0 || componentState.waitingOnAgentIds.length === 0) {
    return null;
  }
  const landedSummary = componentState.satisfiedAgentIds.length === 1
    ? `${componentState.satisfiedAgentIds[0]} desired-state slice landed`
    : `${componentState.satisfiedAgentIds.join(", ")} desired-state slices landed`;
  return {
    ok: false, agentId: componentState.waitingOnAgentIds[0] || null,
    componentId: componentState.componentId || null,
    statusCode: "shared-component-sibling-pending",
    detail: `${landedSummary}; shared component closure still depends on ${componentState.waitingOnAgentIds.join("/")}.`,
    logPath: null,
    ownerAgentIds: componentState.ownerAgentIds,
    satisfiedAgentIds: componentState.satisfiedAgentIds,
    waitingOnAgentIds: componentState.waitingOnAgentIds,
    failedOwnContractAgentIds: componentState.failedOwnContractAgentIds,
  };
}

export function readWaveComponentGatePure(wave, agentResults, options = {}) {
  const summariesByAgentId = agentResults || {};
  const validation = validateWaveComponentPromotions(wave, summariesByAgentId, options);
  const agents = Array.isArray(wave.agents) ? wave.agents : [];
  const sharedPending = (wave.componentPromotions || [])
    .map((p) => buildSharedComponentSiblingPendingPure(p.componentId, agents, summariesByAgentId))
    .find(Boolean);
  if (sharedPending) { return sharedPending; }
  if (validation.ok) {
    return { ok: true, agentId: null, componentId: null,
      statusCode: validation.statusCode, detail: validation.detail, logPath: null };
  }
  const componentState = analyzePromotedComponentOwnersPure(validation.componentId, agents, summariesByAgentId);
  return {
    ok: false, agentId: componentState.waitingOnAgentIds[0] || componentState.ownerAgentIds[0] || null,
    componentId: validation.componentId || null,
    statusCode: validation.statusCode, detail: validation.detail, logPath: null,
    ownerAgentIds: componentState.ownerAgentIds,
    satisfiedAgentIds: componentState.satisfiedAgentIds,
    waitingOnAgentIds: componentState.waitingOnAgentIds,
    failedOwnContractAgentIds: componentState.failedOwnContractAgentIds,
  };
}

export function readWaveComponentMatrixGatePure(wave, agentResults, options = {}) {
  const validation = validateWaveComponentMatrixCurrentLevels(wave, options);
  if (validation.ok) {
    return { ok: true, agentId: null, componentId: null,
      statusCode: validation.statusCode, detail: validation.detail, logPath: null };
  }
  const documentationAgentId = options.documentationAgentId || wave.documentationAgentId || "A9";
  return { ok: false, agentId: documentationAgentId, componentId: validation.componentId || null,
    statusCode: validation.statusCode, detail: validation.detail, logPath: null };
}

export function readWaveDocumentationGatePure(wave, agentResults, options = {}) {
  const documentationAgentId = options.documentationAgentId || wave.documentationAgentId || "A9";
  if (!waveDeclaresAgent(wave, documentationAgentId)) {
    return { ok: true, agentId: null, statusCode: "pass",
      detail: "No documentation steward declared for this wave.", logPath: null };
  }
  const summary = agentResults?.[documentationAgentId] || null;
  const agent = { agentId: documentationAgentId };
  const validation = validateDocumentationClosureSummary(agent, summary);
  return { ok: validation.ok, agentId: documentationAgentId, statusCode: validation.statusCode,
    detail: validation.detail, logPath: summary?.logPath || null };
}

export function readWaveSecurityGatePure(wave, agentResults, options = {}) {
  const agents = Array.isArray(wave.agents) ? wave.agents : [];
  const securityAgents = agents.filter((agent) =>
    isSecurityReviewAgentWithOptions(agent, options),
  );
  if (securityAgents.length === 0) {
    return { ok: true, agentId: null, statusCode: "pass",
      detail: "No security reviewer declared for this wave.", logPath: null };
  }
  const concernAgentIds = [];
  for (const agent of securityAgents) {
    const summary = agentResults?.[agent.agentId] || null;
    const validation = validateSecuritySummary(agent, summary);
    if (!validation.ok) {
      return { ok: false, agentId: agent.agentId, statusCode: validation.statusCode,
        detail: validation.detail, logPath: summary?.logPath || null };
    }
    if (summary?.security?.state === "concerns") { concernAgentIds.push(agent.agentId); }
  }
  if (concernAgentIds.length > 0) {
    return { ok: true, agentId: null, statusCode: "security-concerns",
      detail: `Security review reported advisory concerns (${concernAgentIds.join(", ")}).`, logPath: null };
  }
  return { ok: true, agentId: null, statusCode: "pass",
    detail: "Security review is clear.", logPath: null };
}

export function readWaveIntegrationGatePure(wave, agentResults, options = {}) {
  const integrationAgentId = options.integrationAgentId || wave.integrationAgentId || "A8";
  const requireIntegration = options.requireIntegrationSteward === true ||
    (options.requireIntegrationStewardFromWave != null && wave.wave >= options.requireIntegrationStewardFromWave);
  if (!waveDeclaresAgent(wave, integrationAgentId)) {
    return {
      ok: !requireIntegration,
      agentId: requireIntegration ? integrationAgentId : null,
      statusCode: requireIntegration ? "missing-integration" : "pass",
      detail: requireIntegration ? `Agent ${integrationAgentId} is missing.`
        : "No explicit integration steward declared for this wave.",
      logPath: null,
    };
  }
  const summary = agentResults?.[integrationAgentId] || null;
  const agent = { agentId: integrationAgentId };
  const validation = validateIntegrationSummary(agent, summary);
  return { ok: validation.ok, agentId: integrationAgentId, statusCode: validation.statusCode,
    detail: validation.detail, logPath: summary?.logPath || null };
}

const NON_BLOCKING_INFRA_SIGNAL_STATES = new Set([
  "conformant", "setup-required", "setup-in-progress",
  "action-required", "action-approved", "action-complete",
]);

export function readWaveInfraGatePure(wave, agentResults, options = {}) {
  for (const [agentId, summary] of Object.entries(agentResults || {})) {
    if (!summary?.infra) { continue; }
    const infra = summary.infra;
    const normalizedState = String(infra.state || "").trim().toLowerCase();
    if (NON_BLOCKING_INFRA_SIGNAL_STATES.has(normalizedState)) { continue; }
    return {
      ok: false, agentId,
      statusCode: `infra-${normalizedState || "blocked"}`,
      detail: `Infra signal ${infra.kind || "unknown"} on ${infra.target || "unknown"} ended in state ${normalizedState || "unknown"}${infra.detail ? ` (${infra.detail})` : ""}.`,
      logPath: summary.logPath || null,
    };
  }
  return { ok: true, agentId: null, statusCode: "pass",
    detail: "No blocking infra signals detected.", logPath: null };
}

export function buildGateSnapshotPure({ wave, agentResults, derivedState, validationMode = "live", laneConfig = {} }) {
  const designGate = readWaveDesignGatePure(wave, agentResults);
  const implementationGate = readWaveImplementationGatePure(wave, agentResults, {
    contQaAgentId: laneConfig.contQaAgentId, contEvalAgentId: laneConfig.contEvalAgentId,
    integrationAgentId: laneConfig.integrationAgentId, documentationAgentId: laneConfig.documentationAgentId,
    securityRolePromptPath: laneConfig.securityRolePromptPath,
  });
  const componentGate = readWaveComponentGatePure(wave, agentResults, { laneProfile: laneConfig.laneProfile });
  const integrationMarkerGate = readWaveIntegrationGatePure(wave, agentResults, {
    integrationAgentId: laneConfig.integrationAgentId,
    requireIntegrationStewardFromWave: laneConfig.requireIntegrationStewardFromWave,
  });
  const integrationBarrier = (() => {
    if (!integrationMarkerGate.ok) { return integrationMarkerGate; }
    const integrationSummary = derivedState?.integrationSummary || null;
    if (!integrationSummary) {
      return { ok: false, agentId: integrationMarkerGate.agentId,
        statusCode: "missing-integration-summary",
        detail: `Missing integration summary artifact for wave ${wave.wave}.`,
        logPath: integrationMarkerGate.logPath };
    }
    if (integrationSummary.recommendation !== "ready-for-doc-closure") {
      return { ok: false, agentId: integrationMarkerGate.agentId,
        statusCode: "integration-needs-more-work",
        detail: integrationSummary.detail || `Integration summary still reports ${integrationSummary.recommendation}.`,
        logPath: integrationMarkerGate.logPath };
    }
    const contradictionBarrier = readIntegrationContradictionBarrier(
      derivedState,
      integrationMarkerGate.agentId,
      integrationMarkerGate.logPath,
    );
    if (contradictionBarrier) {
      return contradictionBarrier;
    }
    return integrationMarkerGate;
  })();
  const documentationGate = readWaveDocumentationGatePure(wave, agentResults, {
    documentationAgentId: laneConfig.documentationAgentId });
  const componentMatrixGate = readWaveComponentMatrixGatePure(wave, agentResults, {
    laneProfile: laneConfig.laneProfile, documentationAgentId: laneConfig.documentationAgentId,
    componentMatrixPayload: laneConfig.componentMatrixPayload,
    componentMatrixJsonPath: laneConfig.componentMatrixJsonPath });
  const contEvalGate = readWaveContEvalGatePure(wave, agentResults, {
    contEvalAgentId: laneConfig.contEvalAgentId, mode: validationMode,
    evalTargets: wave.evalTargets, benchmarkCatalogPath: laneConfig.benchmarkCatalogPath });
  const securityGate = readWaveSecurityGatePure(wave, agentResults, {
    securityRolePromptPath: laneConfig.securityRolePromptPath,
  });
  const contQaGate = readWaveContQaGatePure(wave, agentResults, {
    contQaAgentId: laneConfig.contQaAgentId, mode: validationMode });
  const infraGate = readWaveInfraGatePure(wave, agentResults);
  const clarificationBarrier = derivedState?.clarificationBarrier || { ok: true, statusCode: "pass", detail: "" };
  const helperAssignmentBarrier = derivedState?.helperAssignmentBarrier || { ok: true, statusCode: "pass", detail: "" };
  const dependencyBarrier = derivedState?.dependencyBarrier || { ok: true, statusCode: "pass", detail: "" };
  const orderedGates = [
    ["designGate", designGate], ["implementationGate", implementationGate], ["componentGate", componentGate],
    ["helperAssignmentBarrier", helperAssignmentBarrier], ["dependencyBarrier", dependencyBarrier],
    ["contEvalGate", contEvalGate], ["securityGate", securityGate],
    ["integrationBarrier", integrationBarrier], ["documentationGate", documentationGate],
    ["componentMatrixGate", componentMatrixGate], ["contQaGate", contQaGate],
    ["infraGate", infraGate], ["clarificationBarrier", clarificationBarrier],
  ];
  const firstFailure = orderedGates.find(([, gate]) => gate?.ok === false);
  return {
    designGate, implementationGate, componentGate, integrationGate: integrationMarkerGate,
    integrationBarrier, documentationGate, componentMatrixGate,
    contEvalGate, securityGate, contQaGate, infraGate,
    clarificationBarrier, helperAssignmentBarrier, dependencyBarrier,
    overall: firstFailure
      ? { ok: false, gate: firstFailure[0], statusCode: firstFailure[1].statusCode,
          detail: firstFailure[1].detail, agentId: firstFailure[1].agentId || null }
      : { ok: true, gate: "pass", statusCode: "pass",
          detail: "All replayed wave gates passed.", agentId: null },
  };
}
