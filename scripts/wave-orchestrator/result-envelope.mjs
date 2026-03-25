import path from "node:path";
import {
  REPO_ROOT,
  readJsonOrNull,
  toIsoTimestamp,
  writeJsonAtomic,
} from "./shared.mjs";

export const ENVELOPE_VALID_ROLES = [
  "design",
  "implementation",
  "integration",
  "documentation",
  "cont-qa",
  "cont-eval",
  "security",
  "deploy",
];

function inferEnvelopeRole(agent, summary) {
  const candidate = String(agent?.role || summary?.role || "").trim().toLowerCase();
  if (candidate && ENVELOPE_VALID_ROLES.includes(candidate)) {
    return candidate;
  }
  if (summary?.integration) {
    return "integration";
  }
  if (summary?.design) {
    return "design";
  }
  if (summary?.docClosure) {
    return "documentation";
  }
  if (summary?.eval) {
    return "cont-eval";
  }
  if (summary?.security) {
    return "security";
  }
  if (summary?.gate || summary?.verdict) {
    return "cont-qa";
  }
  if (summary?.deploy) {
    return "deploy";
  }
  if (summary?.proof || summary?.docDelta || Array.isArray(summary?.components)) {
    return "implementation";
  }
  return null;
}

function toSummaryRelativePath(filePath) {
  const normalized = String(filePath || "").trim();
  if (!normalized) {
    return null;
  }
  return path.isAbsolute(normalized) ? path.relative(REPO_ROOT, normalized) : normalized;
}

function toLegacyProofState(state) {
  if (state === "satisfied") {
    return "met";
  }
  if (state === "partial") {
    return "gap";
  }
  if (state === "failed") {
    return "failed";
  }
  return "not_applicable";
}

export function agentEnvelopePath({ lane, waveNumber, attempt, agentId }) {
  const safeLane = lane || "main";
  const safeWave = waveNumber ?? 0;
  const safeAttempt = attempt ?? 1;
  const safeAgent = agentId || "unknown";
  return `.tmp/${safeLane}-wave-launcher/results/wave-${safeWave}/attempt-${safeAttempt}/${safeAgent}.json`;
}

function normalizePositiveAttempt(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function inferResultsDirFromStatusPath(statusPath) {
  const normalized = String(statusPath || "").trim();
  if (!normalized) {
    return null;
  }
  const statusDir = path.dirname(normalized);
  if (path.basename(statusDir) === "status") {
    return path.join(path.dirname(statusDir), "results");
  }
  return path.join(statusDir, "results");
}

function runScopedEnvelopePath({ resultsDir, lane, waveNumber, attempt, agentId }) {
  const safeWave = waveNumber ?? 0;
  const safeAttempt = normalizePositiveAttempt(attempt) ?? 1;
  const safeAgent = agentId || "unknown";
  if (resultsDir) {
    return path.join(resultsDir, `wave-${safeWave}`, `attempt-${safeAttempt}`, `${safeAgent}.json`);
  }
  return path.join(
    REPO_ROOT,
    agentEnvelopePath({
      lane,
      waveNumber: safeWave,
      attempt: safeAttempt,
      agentId: safeAgent,
    }),
  );
}

export function agentEnvelopePathFromStatusPath(statusPath) {
  if (statusPath.endsWith(".summary.json")) {
    return statusPath.replace(/\.summary\.json$/i, ".envelope.json");
  }
  if (statusPath.endsWith(".status")) {
    return statusPath.replace(/\.status$/i, ".envelope.json");
  }
  return `${statusPath}.envelope.json`;
}

export function buildAgentResultEnvelope(agent, summary, options = {}) {
  const safeAgent = agent || {};
  const safeSummary = summary || {};
  const safeOptions = options || {};

  const agentId = safeAgent.agentId || safeSummary.agentId || null;
  const role = inferEnvelopeRole(safeAgent, safeSummary);

  const proof = safeSummary.proof || {};
  const proofSection = {
    state: proof.state === "met"
      ? "satisfied"
      : proof.state === "gap"
        ? "partial"
        : proof.state === "failed"
          ? "failed"
          : "not_applicable",
    completion: proof.completion || null,
    durability: proof.durability || null,
    proofLevel: proof.proof || null,
    detail: proof.detail || null,
  };

  const deliverables = Array.isArray(safeSummary.deliverables)
    ? safeSummary.deliverables.map((deliverable) => ({
        path: deliverable.path || null,
        exists: deliverable.exists === true,
        sha256: deliverable.sha256 || null,
      }))
    : [];
  const proofArtifacts = Array.isArray(safeSummary.proofArtifacts)
    ? safeSummary.proofArtifacts.map((artifact) => ({
        path: artifact.path || null,
        kind: artifact.kind || null,
        exists: artifact.exists === true,
        sha256: artifact.sha256 || null,
        requiredFor: artifact.requiredFor || null,
      }))
    : [];
  const gaps = Array.isArray(safeSummary.gaps)
    ? safeSummary.gaps.map((gap) => ({
        kind: gap.kind || null,
        detail: gap.detail || null,
      }))
    : [];
  const unresolvedBlockers = Array.isArray(safeSummary.unresolvedBlockers)
    ? safeSummary.unresolvedBlockers.map((blocker) =>
        typeof blocker === "object"
          ? {
              kind: blocker.kind || null,
              detail: blocker.detail || null,
              blocking: blocker.blocking || null,
            }
          : { kind: null, detail: String(blocker), blocking: null })
    : [];
  const riskNotes = Array.isArray(safeSummary.riskNotes) ? safeSummary.riskNotes : [];
  const facts = Array.isArray(safeSummary.facts)
    ? safeSummary.facts.map((fact) => ({
        factId: fact.factId || null,
        kind: fact.kind || null,
        content: fact.content || null,
      }))
    : [];

  const envelope = {
    schemaVersion: 2,
    agentId,
    waveNumber: safeOptions.waveNumber ?? safeSummary.waveNumber ?? null,
    attempt: safeOptions.attempt ?? safeSummary.attempt ?? null,
    completedAt: safeOptions.completedAt || safeSummary.completedAt || toIsoTimestamp(),
    exitCode:
      typeof safeOptions.exitCode === "number"
        ? safeOptions.exitCode
        : typeof safeSummary.exitCode === "number"
          ? safeSummary.exitCode
          : 0,
    role,
    proof: proofSection,
    deliverables,
    proofArtifacts,
    gaps,
    unresolvedBlockers,
    riskNotes,
    facts,
  };

  if (
    role === "implementation" ||
    safeSummary.docDelta ||
    Array.isArray(safeSummary.components)
  ) {
    const docDelta = safeSummary.docDelta || {};
    const components = Array.isArray(safeSummary.components)
      ? safeSummary.components.map((component) => ({
          componentId: component.componentId || null,
          level: component.level || null,
          state: component.state || null,
          detail: component.detail || null,
        }))
      : [];
    envelope.implementation = {
      docDelta: {
        state: docDelta.state || "none",
        paths: Array.isArray(docDelta.paths) ? docDelta.paths : [],
        detail: docDelta.detail || null,
      },
      components,
    };
  }

  if (role === "design") {
    const design = safeSummary.design || {};
    envelope.design = {
      state: design.state || null,
      decisions: design.decisions || 0,
      assumptions: design.assumptions || 0,
      openQuestions: design.openQuestions || 0,
      detail: design.detail || null,
    };
  }

  if (role === "integration") {
    const integration = safeSummary.integration || {};
    envelope.integration = {
      state: integration.state || null,
      claims: integration.claims || 0,
      conflicts: integration.conflicts || 0,
      blockers: integration.blockers || 0,
      detail: integration.detail || null,
    };
  }

  if (role === "documentation") {
    const docClosure = safeSummary.docDelta || safeSummary.docClosure || {};
    envelope.documentation = {
      docClosure: {
        state: docClosure.state || "no-change",
        paths: Array.isArray(docClosure.paths) ? docClosure.paths : [],
        detail: docClosure.detail || null,
      },
    };
  }

  if (role === "cont-qa") {
    const verdict = safeSummary.verdict || {};
    const gate = safeSummary.gate || {};
    const gateClaims = {
      architecture: gate.architecture || null,
      integration: gate.integration || null,
      durability: gate.durability || null,
      live: gate.live || null,
      docs: gate.docs || null,
      detail: gate.detail || null,
    };
    envelope.contQa = {
      verdict: {
        verdict: verdict.verdict || null,
        detail: verdict.detail || null,
      },
      ...(Object.values(gateClaims).some((value) => value !== null) ? { gateClaims } : {}),
    };
  }

  if (role === "cont-eval") {
    const evalSection = safeSummary.eval || {};
    envelope.contEval = {
      state: evalSection.state || null,
      targets: evalSection.targets || 0,
      benchmarks: evalSection.benchmarks || 0,
      regressions: evalSection.regressions || 0,
      targetIds: Array.isArray(evalSection.targetIds) ? evalSection.targetIds : [],
      benchmarkIds: Array.isArray(evalSection.benchmarkIds) ? evalSection.benchmarkIds : [],
      detail: evalSection.detail || null,
    };
  }

  if (role === "security") {
    const security = safeSummary.security || {};
    envelope.security = {
      state: security.state || null,
      findings: security.findings || 0,
      approvals: security.approvals || 0,
      detail: security.detail || null,
    };
  }

  if (role === "deploy") {
    const deploy = safeSummary.deploy || {};
    envelope.deploy = {
      state: deploy.state || "not_applicable",
      environment: deploy.environment || null,
      healthCheck: deploy.healthCheck || null,
      rolloutArtifact: deploy.rolloutArtifact || null,
      detail: deploy.detail || null,
    };
  }

  return envelope;
}

export function synthesizeLegacyEnvelope(agent, legacySummary, options = {}) {
  const envelope = buildAgentResultEnvelope(agent, legacySummary, options);
  envelope._synthesizedFromLegacy = true;
  return envelope;
}

export function projectLegacySummaryFromEnvelope(envelope, options = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }
  const role = inferEnvelopeRole(options.agent || {}, envelope);
  const proof =
    envelope.proof && typeof envelope.proof === "object"
      ? {
          state: toLegacyProofState(envelope.proof.state),
          completion: envelope.proof.completion || null,
          durability: envelope.proof.durability || null,
          proof: envelope.proof.proofLevel || null,
          detail: envelope.proof.detail || null,
        }
      : null;
  const summary = {
    agentId: envelope.agentId || options.agent?.agentId || null,
    role,
    waveNumber: envelope.waveNumber ?? options.waveNumber ?? null,
    attempt: envelope.attempt ?? options.attempt ?? null,
    completedAt: envelope.completedAt || null,
    exitCode: typeof envelope.exitCode === "number" ? envelope.exitCode : 0,
    logPath: toSummaryRelativePath(options.logPath),
    reportPath: toSummaryRelativePath(options.reportPath),
    proof,
    deliverables: Array.isArray(envelope.deliverables)
      ? envelope.deliverables.map((deliverable) => ({
          path: deliverable.path || null,
          exists: deliverable.exists === true,
          sha256: deliverable.sha256 || null,
        }))
      : [],
    proofArtifacts: Array.isArray(envelope.proofArtifacts)
      ? envelope.proofArtifacts.map((artifact) => ({
          path: artifact.path || null,
          kind: artifact.kind || null,
          exists: artifact.exists === true,
          sha256: artifact.sha256 || null,
          requiredFor: artifact.requiredFor || null,
        }))
      : [],
    gaps: Array.isArray(envelope.gaps)
      ? envelope.gaps.map((gap) => ({
          kind: gap.kind || null,
          detail: gap.detail || null,
        }))
      : [],
    unresolvedBlockers: Array.isArray(envelope.unresolvedBlockers)
      ? envelope.unresolvedBlockers.map((blocker) => ({
          kind: blocker.kind || null,
          detail: blocker.detail || null,
          blocking: blocker.blocking ?? null,
        }))
      : [],
    riskNotes: Array.isArray(envelope.riskNotes) ? envelope.riskNotes.slice() : [],
    facts: Array.isArray(envelope.facts)
      ? envelope.facts.map((fact) => ({
          factId: fact.factId || null,
          kind: fact.kind || null,
          content: fact.content || null,
        }))
      : [],
  };

  if (envelope.implementation) {
    summary.docDelta = {
      state: envelope.implementation.docDelta?.state || "none",
      paths: Array.isArray(envelope.implementation.docDelta?.paths)
        ? envelope.implementation.docDelta.paths
        : [],
      detail: envelope.implementation.docDelta?.detail || null,
    };
    summary.components = Array.isArray(envelope.implementation.components)
      ? envelope.implementation.components.map((component) => ({
          componentId: component.componentId || null,
          level: component.level || null,
          state: component.state || null,
          detail: component.detail || null,
        }))
      : [];
  }

  if (envelope.design) {
    summary.design = {
      state: envelope.design.state || null,
      decisions: envelope.design.decisions || 0,
      assumptions: envelope.design.assumptions || 0,
      openQuestions: envelope.design.openQuestions || 0,
      detail: envelope.design.detail || null,
    };
  }

  if (envelope.documentation?.docClosure) {
    summary.docClosure = {
      state: envelope.documentation.docClosure.state || "no-change",
      paths: Array.isArray(envelope.documentation.docClosure.paths)
        ? envelope.documentation.docClosure.paths
        : [],
      detail: envelope.documentation.docClosure.detail || null,
    };
  }

  if (envelope.integration) {
    summary.integration = {
      state: envelope.integration.state || null,
      claims: envelope.integration.claims || 0,
      conflicts: envelope.integration.conflicts || 0,
      blockers: envelope.integration.blockers || 0,
      detail: envelope.integration.detail || null,
    };
  }

  if (envelope.contEval) {
    summary.eval = {
      state: envelope.contEval.state || null,
      targets: envelope.contEval.targets || 0,
      benchmarks: envelope.contEval.benchmarks || 0,
      regressions: envelope.contEval.regressions || 0,
      targetIds: Array.isArray(envelope.contEval.targetIds) ? envelope.contEval.targetIds : [],
      benchmarkIds: Array.isArray(envelope.contEval.benchmarkIds) ? envelope.contEval.benchmarkIds : [],
      detail: envelope.contEval.detail || null,
    };
  }

  if (envelope.contQa) {
    const gateClaims = envelope.contQa.gateClaims || null;
    if (gateClaims && Object.values(gateClaims).some((value) => value !== null)) {
      summary.gate = {
        architecture: gateClaims.architecture || null,
        integration: gateClaims.integration || null,
        durability: gateClaims.durability || null,
        live: gateClaims.live || null,
        docs: gateClaims.docs || null,
        detail: gateClaims.detail || null,
      };
    }
    summary.verdict = {
      verdict: envelope.contQa.verdict?.verdict || null,
      detail: envelope.contQa.verdict?.detail || null,
    };
  }

  if (envelope.security) {
    summary.security = {
      state: envelope.security.state || null,
      findings: envelope.security.findings || 0,
      approvals: envelope.security.approvals || 0,
      detail: envelope.security.detail || null,
    };
  }

  if (envelope.deploy) {
    summary.deploy = {
      state: envelope.deploy.state || "not_applicable",
      environment: envelope.deploy.environment || null,
      healthCheck: envelope.deploy.healthCheck || null,
      rolloutArtifact: envelope.deploy.rolloutArtifact || null,
      detail: envelope.deploy.detail || null,
    };
  }

  return summary;
}

function requiredRoleSection(role) {
  switch (role) {
    case "design":
      return "design";
    case "implementation":
      return "implementation";
    case "integration":
      return "integration";
    case "documentation":
      return "documentation";
    case "cont-qa":
      return "contQa";
    case "cont-eval":
      return "contEval";
    case "security":
      return "security";
    case "deploy":
      return "deploy";
    default:
      return null;
  }
}

export function validateResultEnvelope(envelope, options = {}) {
  const errors = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return {
      valid: false,
      errors: ["Envelope must be a JSON object."],
      envelope: null,
      role: null,
    };
  }
  if (Number(envelope.schemaVersion) !== 2) {
    errors.push(`Unsupported envelope schema version: ${envelope.schemaVersion ?? "missing"}.`);
  }
  const expectedAgentId = String(options.agent?.agentId || "").trim() || null;
  const agentId = String(envelope.agentId || "").trim() || null;
  if (!agentId) {
    errors.push("Envelope is missing agentId.");
  } else if (expectedAgentId && agentId !== expectedAgentId) {
    errors.push(`Envelope agentId ${agentId} does not match expected agent ${expectedAgentId}.`);
  }
  const role = inferEnvelopeRole(options.agent || {}, envelope);
  if (!role) {
    errors.push("Envelope role could not be inferred.");
  }
  const section = requiredRoleSection(role);
  if (section && (!envelope[section] || typeof envelope[section] !== "object")) {
    errors.push(`Envelope is missing required ${section} payload.`);
  }
  if (!envelope.proof || typeof envelope.proof !== "object") {
    errors.push("Envelope is missing proof payload.");
  }
  return {
    valid: errors.length === 0,
    errors,
    envelope,
    role,
  };
}

export function resolveRunEnvelopeContext(runInfo, wave = null, options = {}) {
  const lane = options.lane || runInfo?.lane || wave?.lane || "main";
  const waveNumber = options.waveNumber ?? runInfo?.wave ?? wave?.wave ?? 0;
  const statusRecord = options.statusRecord || null;
  const attempt =
    normalizePositiveAttempt(
      options.attempt ?? statusRecord?.attempt ?? runInfo?.lastLaunchAttempt,
    ) || 1;
  const agentId = options.agentId || runInfo?.agent?.agentId || "unknown";
  const resultsDir =
    options.resultsDir ||
    runInfo?.resultsDir ||
    runInfo?.lanePaths?.resultsDir ||
    inferResultsDirFromStatusPath(runInfo?.statusPath);
  return {
    lane,
    waveNumber,
    attempt,
    agentId,
    resultsDir,
    envelopePath: runScopedEnvelopePath({
      resultsDir,
      lane,
      waveNumber,
      attempt,
      agentId,
    }),
  };
}

function normalizeEnvelopeForRunWrite(envelope, context) {
  return {
    ...envelope,
    agentId: envelope?.agentId || context.agentId || null,
    waveNumber: envelope?.waveNumber ?? context.waveNumber ?? null,
    attempt: envelope?.attempt ?? context.attempt ?? null,
  };
}

export function writeAgentResultEnvelopeForRun(runInfo, wave, envelope, options = {}) {
  const context = resolveRunEnvelopeContext(runInfo, wave, options);
  const payload = normalizeEnvelopeForRunWrite(envelope, context);
  writeJsonAtomic(context.envelopePath, payload);
  return context.envelopePath;
}

export function readAgentResultEnvelopeForRun(runInfo, wave, options = {}) {
  const context = resolveRunEnvelopeContext(runInfo, wave, options);
  const payload = readJsonOrNull(context.envelopePath);
  return payload && typeof payload === "object" ? payload : null;
}

export function writeAgentResultEnvelope(statusPath, envelope) {
  const envelopePath = agentEnvelopePathFromStatusPath(statusPath);
  writeJsonAtomic(envelopePath, envelope);
  return envelopePath;
}

export function readAgentResultEnvelope(statusPath) {
  const envelopePath = agentEnvelopePathFromStatusPath(statusPath);
  const payload = readJsonOrNull(envelopePath);
  return payload && typeof payload === "object" ? payload : null;
}
