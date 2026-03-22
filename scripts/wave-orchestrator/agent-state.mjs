import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  REPORT_VERDICT_REGEX,
  WAVE_VERDICT_REGEX,
  parseVerdictFromText,
  readFileTail,
  readJsonOrNull,
  writeJsonAtomic,
} from "./shared.mjs";
import { resolveEvalTargetsAgainstCatalog } from "./evals.mjs";

export const EXIT_CONTRACT_COMPLETION_VALUES = ["contract", "integrated", "authoritative", "live"];
export const EXIT_CONTRACT_DURABILITY_VALUES = ["none", "ephemeral", "durable"];
export const EXIT_CONTRACT_PROOF_VALUES = ["unit", "integration", "live"];
export const EXIT_CONTRACT_DOC_IMPACT_VALUES = ["none", "owned", "shared-plan"];

const ORDER = (values) => Object.fromEntries(values.map((value, index) => [value, index]));
const COMPLETION_ORDER = ORDER(EXIT_CONTRACT_COMPLETION_VALUES);
const DURABILITY_ORDER = ORDER(EXIT_CONTRACT_DURABILITY_VALUES);
const PROOF_ORDER = ORDER(EXIT_CONTRACT_PROOF_VALUES);
const DOC_IMPACT_ORDER = ORDER(EXIT_CONTRACT_DOC_IMPACT_VALUES);
const COMPONENT_MATURITY_LEVELS = [
  "inventoried",
  "contract-frozen",
  "repo-landed",
  "baseline-proved",
  "pilot-live",
  "qa-proved",
  "fleet-ready",
  "cutover-ready",
  "deprecation-ready",
];
const COMPONENT_MATURITY_ORDER = ORDER(COMPONENT_MATURITY_LEVELS);
const PROOF_CENTRIC_COMPONENT_LEVEL = "pilot-live";

const WAVE_PROOF_REGEX =
  /^\[wave-proof\]\s*completion=(contract|integrated|authoritative|live)\s+durability=(none|ephemeral|durable)\s+proof=(unit|integration|live)\s+state=(met|gap)\s*(?:detail=(.*))?$/gim;
const WAVE_DOC_DELTA_REGEX =
  /^\[wave-doc-delta\]\s*state=(none|owned|shared-plan)(?:\s+paths=([^\n]*?))?(?:\s+detail=(.*))?$/gim;
const WAVE_DOC_CLOSURE_REGEX =
  /^\[wave-doc-closure\]\s*state=(closed|no-change|delta)(?:\s+paths=([^\n]*?))?(?:\s+detail=(.*))?$/gim;
const WAVE_INTEGRATION_REGEX =
  /^\[wave-integration\]\s*state=(ready-for-doc-closure|needs-more-work)\s+claims=(\d+)\s+conflicts=(\d+)\s+blockers=(\d+)\s*(?:detail=(.*))?$/gim;
const WAVE_EVAL_REGEX =
  /^\[wave-eval\]\s*state=(satisfied|needs-more-work|blocked)\s+targets=(\d+)\s+benchmarks=(\d+)\s+regressions=(\d+)(?:\s+target_ids=([^\s]+))?(?:\s+benchmark_ids=([^\s]+))?\s*(?:detail=(.*))?$/gim;
const WAVE_SECURITY_REGEX =
  /^\[wave-security\]\s*state=(clear|concerns|blocked)\s+findings=(\d+)\s+approvals=(\d+)\s*(?:detail=(.*))?$/gim;
const WAVE_GATE_REGEX =
  /^\[wave-gate\]\s*architecture=(pass|concerns|blocked)\s+integration=(pass|concerns|blocked)\s+durability=(pass|concerns|blocked)\s+live=(pass|concerns|blocked)\s+docs=(pass|concerns|blocked)\s*(?:detail=(.*))?$/gim;
const WAVE_GAP_REGEX =
  /^\[wave-gap\]\s*kind=(architecture|integration|durability|ops|docs)\s*(?:detail=(.*))?$/gim;
const WAVE_COMPONENT_REGEX =
  /^\[wave-component\]\s*component=([a-z0-9._-]+)\s+level=([a-z0-9._-]+)\s+state=(met|gap)\s*(?:detail=(.*))?$/gim;
const STRUCTURED_SIGNAL_LINE_REGEX = /^\[wave-[^\]]+\].*$/;
const WRAPPED_STRUCTURED_SIGNAL_LINE_REGEX = /^`\[wave-[^`]+`$/;

function normalizeStructuredSignalText(text) {
  if (!text) {
    return "";
  }
  const normalizedLines = [];
  let fenceLines = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      if (fenceLines === null) {
        fenceLines = [];
        continue;
      }
      const normalizedFenceLines = fenceLines
        .map((line) => normalizeStructuredSignalLine(line))
        .filter(Boolean);
      if (normalizedFenceLines.length > 0 && normalizedFenceLines.length === fenceLines.length) {
        normalizedLines.push(...normalizedFenceLines);
      }
      fenceLines = null;
      continue;
    }
    if (fenceLines !== null) {
      if (!trimmed) {
        continue;
      }
      fenceLines.push(trimmed);
      continue;
    }
    const normalized = normalizeStructuredSignalLine(trimmed);
    if (normalized) {
      normalizedLines.push(normalized);
    }
  }
  return normalizedLines.join("\n");
}

function normalizeStructuredSignalLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return null;
  }
  if (STRUCTURED_SIGNAL_LINE_REGEX.test(trimmed)) {
    return trimmed;
  }
  if (WRAPPED_STRUCTURED_SIGNAL_LINE_REGEX.test(trimmed)) {
    return trimmed.slice(1, -1);
  }
  return null;
}

function cleanText(value) {
  return String(value || "").trim();
}

function parsePaths(value) {
  return cleanText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIdList(value) {
  return cleanText(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return Array.from(new Set((values || []).map((value) => cleanText(value)).filter(Boolean))).sort();
}

function sameStringLists(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function findLastMatch(text, regex, mapper) {
  if (!text) {
    return null;
  }
  regex.lastIndex = 0;
  let match = regex.exec(text);
  let result = null;
  while (match !== null) {
    result = mapper(match);
    match = regex.exec(text);
  }
  return result;
}

function findAllMatches(text, regex, mapper) {
  if (!text) {
    return [];
  }
  regex.lastIndex = 0;
  const out = [];
  let match = regex.exec(text);
  while (match !== null) {
    out.push(mapper(match));
    match = regex.exec(text);
  }
  return out;
}

function findLatestComponentMatches(text) {
  const matches = findAllMatches(text, WAVE_COMPONENT_REGEX, (match) => ({
    componentId: match[1],
    level: match[2],
    state: match[3],
    detail: cleanText(match[4]),
  }));
  const byComponent = new Map();
  for (const match of matches) {
    byComponent.set(match.componentId, match);
  }
  return Array.from(byComponent.values());
}

function detectTermination(agent, logText, statusRecord) {
  const patterns = [
    { reason: "max-turns", regex: /(Reached max turns \(\d+\))/i },
    { reason: "timeout", regex: /(timed out(?: after [^\n.]+)?)/i },
    { reason: "session-missing", regex: /(session [^\n]+ disappeared before [^\n]+ was written)/i },
  ];
  for (const pattern of patterns) {
    const match = String(logText || "").match(pattern.regex);
    if (match) {
      const baseHint = cleanText(match[1] || match[0]);
      if (pattern.reason === "max-turns" && agent?.executorResolved?.id === "codex") {
        return {
          reason: pattern.reason,
          hint: `${baseHint}. Wave does not set a Codex turn-limit flag; inspect launch-preview.json limits for any profile or upstream-runtime ceiling notes.`,
        };
      }
      return {
        reason: pattern.reason,
        hint: baseHint,
      };
    }
  }
  const statusHint = cleanText(
    statusRecord?.detail || statusRecord?.message || statusRecord?.error || statusRecord?.reason,
  );
  if (statusHint) {
    return {
      reason: "status-detail",
      hint: statusHint,
    };
  }
  const exitCode = Number.isFinite(Number(statusRecord?.code)) ? Number(statusRecord.code) : null;
  if (exitCode !== null && exitCode !== 0) {
    return {
      reason: "exit-code",
      hint: `Exit code ${exitCode}.`,
    };
  }
  return {
    reason: null,
    hint: "",
  };
}

function appendTerminationHint(detail, summary) {
  const hint = cleanText(summary?.terminationHint || summary?.terminationReason);
  if (!hint) {
    return detail;
  }
  return `${detail} Termination: ${hint}`;
}

function meetsOrExceeds(actual, required, orderMap) {
  if (!required) {
    return true;
  }
  if (!actual || !(actual in orderMap) || !(required in orderMap)) {
    return false;
  }
  return orderMap[actual] >= orderMap[required];
}

function proofCentricLevelReached(level) {
  return (
    COMPONENT_MATURITY_ORDER[String(level || "").trim()] >=
    COMPONENT_MATURITY_ORDER[PROOF_CENTRIC_COMPONENT_LEVEL]
  );
}

function highestAgentComponentTargetLevel(agent) {
  const levels = Array.isArray(agent?.components)
    ? agent.components
        .map((componentId) => agent?.componentTargets?.[componentId] || null)
        .filter(Boolean)
    : [];
  if (levels.length === 0) {
    return null;
  }
  return levels.sort(
    (left, right) => COMPONENT_MATURITY_ORDER[right] - COMPONENT_MATURITY_ORDER[left],
  )[0];
}

function proofArtifactRequiredForAgent(agent, artifact) {
  if (!artifact) {
    return false;
  }
  const requiredFor = Array.isArray(artifact.requiredFor) ? artifact.requiredFor : [];
  if (requiredFor.length === 0) {
    return true;
  }
  const highestTarget = highestAgentComponentTargetLevel(agent);
  if (!highestTarget) {
    return true;
  }
  return requiredFor.some(
    (level) => COMPONENT_MATURITY_ORDER[highestTarget] >= COMPONENT_MATURITY_ORDER[level],
  );
}

export function normalizeExitContract(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const completion = cleanText(raw.completion);
  const durability = cleanText(raw.durability);
  const proof = cleanText(raw.proof);
  const docImpact = cleanText(raw.docImpact || raw["doc-impact"]);
  if (!completion && !durability && !proof && !docImpact) {
    return null;
  }
  return {
    completion: completion || null,
    durability: durability || null,
    proof: proof || null,
    docImpact: docImpact || null,
  };
}

export function validateExitContractShape(contract) {
  if (!contract) {
    return [];
  }
  const errors = [];
  if (!EXIT_CONTRACT_COMPLETION_VALUES.includes(contract.completion)) {
    errors.push(`completion must be one of ${EXIT_CONTRACT_COMPLETION_VALUES.join(", ")}`);
  }
  if (!EXIT_CONTRACT_DURABILITY_VALUES.includes(contract.durability)) {
    errors.push(`durability must be one of ${EXIT_CONTRACT_DURABILITY_VALUES.join(", ")}`);
  }
  if (!EXIT_CONTRACT_PROOF_VALUES.includes(contract.proof)) {
    errors.push(`proof must be one of ${EXIT_CONTRACT_PROOF_VALUES.join(", ")}`);
  }
  if (!EXIT_CONTRACT_DOC_IMPACT_VALUES.includes(contract.docImpact)) {
    errors.push(`doc-impact must be one of ${EXIT_CONTRACT_DOC_IMPACT_VALUES.join(", ")}`);
  }
  return errors;
}

export function agentSummaryPathFromStatusPath(statusPath) {
  return statusPath.endsWith(".status")
    ? statusPath.replace(/\.status$/i, ".summary.json")
    : `${statusPath}.summary.json`;
}

export function readAgentExecutionSummary(summaryPathOrStatusPath) {
  const summaryPath = summaryPathOrStatusPath.endsWith(".summary.json")
    ? summaryPathOrStatusPath
    : agentSummaryPathFromStatusPath(summaryPathOrStatusPath);
  const payload = readJsonOrNull(summaryPath);
  return payload && typeof payload === "object" ? payload : null;
}

export function buildAgentExecutionSummary({ agent, statusRecord, logPath, reportPath = null }) {
  const logText = readFileTail(logPath, 60000);
  const signalText = normalizeStructuredSignalText(logText);
  const reportText =
    reportPath && readJsonOrNull(reportPath) === null
      ? readFileTail(reportPath, 60000)
      : reportPath
        ? readFileTail(reportPath, 60000)
        : "";
  const reportVerdict = parseVerdictFromText(reportText, REPORT_VERDICT_REGEX);
  const logVerdict = parseVerdictFromText(signalText, WAVE_VERDICT_REGEX);
  const verdict = reportVerdict.verdict ? reportVerdict : logVerdict;
  const termination = detectTermination(agent, logText, statusRecord);
  return {
    agentId: agent?.agentId || null,
    promptHash: statusRecord?.promptHash || null,
    exitCode: Number.isFinite(Number(statusRecord?.code)) ? Number(statusRecord.code) : null,
    completedAt: statusRecord?.completedAt || null,
    proof: findLastMatch(signalText, WAVE_PROOF_REGEX, (match) => ({
      completion: match[1],
      durability: match[2],
      proof: match[3],
      state: match[4],
      detail: cleanText(match[5]),
    })),
    docDelta: findLastMatch(signalText, WAVE_DOC_DELTA_REGEX, (match) => ({
      state: match[1],
      paths: parsePaths(match[2]),
      detail: cleanText(match[3]),
    })),
    docClosure: findLastMatch(signalText, WAVE_DOC_CLOSURE_REGEX, (match) => ({
      state: match[1],
      paths: parsePaths(match[2]),
      detail: cleanText(match[3]),
    })),
    integration: findLastMatch(signalText, WAVE_INTEGRATION_REGEX, (match) => ({
      state: match[1],
      claims: Number.parseInt(String(match[2] || "0"), 10) || 0,
      conflicts: Number.parseInt(String(match[3] || "0"), 10) || 0,
      blockers: Number.parseInt(String(match[4] || "0"), 10) || 0,
      detail: cleanText(match[5]),
    })),
    eval: findLastMatch(signalText, WAVE_EVAL_REGEX, (match) => ({
      state: match[1],
      targets: Number.parseInt(String(match[2] || "0"), 10) || 0,
      benchmarks: Number.parseInt(String(match[3] || "0"), 10) || 0,
      regressions: Number.parseInt(String(match[4] || "0"), 10) || 0,
      targetIds: parseIdList(match[5]),
      benchmarkIds: parseIdList(match[6]),
      detail: cleanText(match[7]),
    })),
    security: findLastMatch(signalText, WAVE_SECURITY_REGEX, (match) => ({
      state: match[1],
      findings: Number.parseInt(String(match[2] || "0"), 10) || 0,
      approvals: Number.parseInt(String(match[3] || "0"), 10) || 0,
      detail: cleanText(match[4]),
    })),
    gate: findLastMatch(signalText, WAVE_GATE_REGEX, (match) => ({
      architecture: match[1],
      integration: match[2],
      durability: match[3],
      live: match[4],
      docs: match[5],
      detail: cleanText(match[6]),
    })),
    components: findLatestComponentMatches(signalText),
    gaps: findAllMatches(signalText, WAVE_GAP_REGEX, (match) => ({
      kind: match[1],
      detail: cleanText(match[2]),
    })),
    deliverables: Array.isArray(agent?.deliverables)
      ? agent.deliverables.map((deliverable) => ({
          path: deliverable,
          exists: fs.existsSync(path.resolve(REPO_ROOT, deliverable)),
          modifiedAt:
            fs.existsSync(path.resolve(REPO_ROOT, deliverable))
              ? fs.statSync(path.resolve(REPO_ROOT, deliverable)).mtime.toISOString()
              : null,
        }))
      : [],
    proofArtifacts: Array.isArray(agent?.proofArtifacts)
      ? agent.proofArtifacts.map((artifact) => {
          const absolutePath = path.resolve(REPO_ROOT, artifact.path);
          const exists = fs.existsSync(absolutePath);
          return {
            path: artifact.path,
            kind: artifact.kind || null,
            requiredFor: Array.isArray(artifact.requiredFor) ? artifact.requiredFor : [],
            exists,
            modifiedAt: exists ? fs.statSync(absolutePath).mtime.toISOString() : null,
          };
        })
      : [],
    verdict: verdict.verdict
      ? {
          verdict: verdict.verdict,
          detail: cleanText(verdict.detail),
        }
      : null,
    terminationReason: termination.reason,
    terminationHint: termination.hint,
    logPath: path.relative(REPO_ROOT, logPath),
    reportPath: reportPath ? path.relative(REPO_ROOT, reportPath) : null,
  };
}

export function writeAgentExecutionSummary(summaryPathOrStatusPath, summary) {
  const summaryPath = summaryPathOrStatusPath.endsWith(".summary.json")
    ? summaryPathOrStatusPath
    : agentSummaryPathFromStatusPath(summaryPathOrStatusPath);
  writeJsonAtomic(summaryPath, summary);
  return summaryPath;
}

export function validateImplementationSummary(agent, summary) {
  const contract = normalizeExitContract(agent?.exitContract);
  if (!contract) {
    return { ok: true, statusCode: "pass", detail: "No exit contract declared." };
  }
  if (!summary) {
    return {
      ok: false,
      statusCode: "missing-summary",
      detail: `Missing execution summary for ${agent.agentId}.`,
    };
  }
  if (!summary.proof) {
    return {
      ok: false,
      statusCode: "missing-wave-proof",
      detail: appendTerminationHint(`Missing [wave-proof] marker for ${agent.agentId}.`, summary),
    };
  }
  if (summary.proof.state !== "met") {
    return {
      ok: false,
      statusCode: "wave-proof-gap",
      detail: `Agent ${agent.agentId} reported a proof gap${summary.proof.detail ? `: ${summary.proof.detail}` : "."}`,
    };
  }
  if (!meetsOrExceeds(summary.proof.completion, contract.completion, COMPLETION_ORDER)) {
    return {
      ok: false,
      statusCode: "completion-gap",
      detail: `Agent ${agent.agentId} only proved ${summary.proof.completion}; exit contract requires ${contract.completion}.`,
    };
  }
  if (!meetsOrExceeds(summary.proof.durability, contract.durability, DURABILITY_ORDER)) {
    return {
      ok: false,
      statusCode: "durability-gap",
      detail: `Agent ${agent.agentId} only proved ${summary.proof.durability} durability; exit contract requires ${contract.durability}.`,
    };
  }
  if (!meetsOrExceeds(summary.proof.proof, contract.proof, PROOF_ORDER)) {
    return {
      ok: false,
      statusCode: "proof-level-gap",
      detail: `Agent ${agent.agentId} only proved ${summary.proof.proof}; exit contract requires ${contract.proof}.`,
    };
  }
  if (!summary.docDelta) {
    return {
      ok: false,
      statusCode: "missing-doc-delta",
      detail: appendTerminationHint(`Missing [wave-doc-delta] marker for ${agent.agentId}.`, summary),
    };
  }
  if (!meetsOrExceeds(summary.docDelta.state, contract.docImpact, DOC_IMPACT_ORDER)) {
    return {
      ok: false,
      statusCode: "doc-impact-gap",
      detail: `Agent ${agent.agentId} only reported ${summary.docDelta.state} doc impact; exit contract requires ${contract.docImpact}.`,
    };
  }
  const ownedComponents = Array.isArray(agent?.components) ? agent.components : [];
  if (ownedComponents.length > 0) {
    const componentMarkers = new Map(
      Array.isArray(summary.components)
        ? summary.components.map((component) => [component.componentId, component])
        : [],
    );
    for (const componentId of ownedComponents) {
      const marker = componentMarkers.get(componentId);
      if (!marker) {
        return {
          ok: false,
          statusCode: "missing-wave-component",
          detail: `Missing [wave-component] marker for ${agent.agentId} component ${componentId}.`,
        };
      }
      const expectedLevel = agent?.componentTargets?.[componentId] || null;
      if (expectedLevel && marker.level !== expectedLevel) {
        return {
          ok: false,
          statusCode: "component-level-mismatch",
          detail: `Agent ${agent.agentId} reported ${componentId} at ${marker.level}; wave requires ${expectedLevel}.`,
        };
      }
      if (marker.state !== "met") {
        return {
          ok: false,
          statusCode: "component-gap",
          detail:
            marker.detail ||
            `Agent ${agent.agentId} reported a component gap for ${componentId}.`,
        };
      }
    }
  }
  const deliverables = Array.isArray(agent?.deliverables) ? agent.deliverables : [];
  if (deliverables.length > 0) {
    const deliverableState = new Map(
      Array.isArray(summary.deliverables)
        ? summary.deliverables.map((deliverable) => [deliverable.path, deliverable])
        : [],
    );
    for (const deliverablePath of deliverables) {
      const deliverable = deliverableState.get(deliverablePath);
      if (!deliverable) {
        return {
          ok: false,
          statusCode: "missing-deliverable-summary",
          detail: `Missing deliverable presence record for ${agent.agentId} path ${deliverablePath}.`,
        };
      }
      if (deliverable.exists !== true) {
        return {
          ok: false,
          statusCode: "missing-deliverable",
          detail: `Agent ${agent.agentId} did not land required deliverable ${deliverablePath}.`,
        };
      }
    }
  }
  const proofArtifacts = Array.isArray(agent?.proofArtifacts) ? agent.proofArtifacts : [];
  if (proofArtifacts.length > 0) {
    const artifactState = new Map(
      Array.isArray(summary.proofArtifacts)
        ? summary.proofArtifacts.map((artifact) => [artifact.path, artifact])
        : [],
    );
    for (const proofArtifact of proofArtifacts) {
      if (!proofArtifactRequiredForAgent(agent, proofArtifact)) {
        continue;
      }
      const artifact = artifactState.get(proofArtifact.path);
      if (!artifact) {
        return {
          ok: false,
          statusCode: "missing-proof-artifact-summary",
          detail: `Missing proof artifact presence record for ${agent.agentId} path ${proofArtifact.path}.`,
        };
      }
      if (artifact.exists !== true) {
        return {
          ok: false,
          statusCode: "missing-proof-artifact",
          detail: `Agent ${agent.agentId} did not land required proof artifact ${proofArtifact.path}.`,
        };
      }
    }
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: `Exit contract satisfied for ${agent.agentId}.`,
  };
}

export function validateDocumentationClosureSummary(agent, summary) {
  if (!summary?.docClosure) {
    return {
      ok: false,
      statusCode: "missing-doc-closure",
      detail: appendTerminationHint(
        `Missing [wave-doc-closure] marker for ${agent?.agentId || "A9"}.`,
        summary,
      ),
    };
  }
  if (summary.docClosure.state === "delta") {
    return {
      ok: false,
      statusCode: "doc-closure-open",
      detail: `Documentation steward still reports open shared-plan delta${summary.docClosure.detail ? `: ${summary.docClosure.detail}` : "."}`,
    };
  }
  return {
    ok: true,
    statusCode: "pass",
    detail:
      summary.docClosure.state === "closed"
        ? "Documentation steward closed the shared-plan delta."
        : "Documentation steward confirmed no shared-plan changes were needed.",
  };
}

export function validateSecuritySummary(agent, summary) {
  if (!summary?.security) {
    return {
      ok: false,
      statusCode: "missing-wave-security",
      detail: appendTerminationHint(
        `Missing [wave-security] marker for ${agent?.agentId || "A7"}.`,
        summary,
      ),
    };
  }
  if (!summary.reportPath) {
    return {
      ok: false,
      statusCode: "missing-security-report",
      detail: `Missing security review report path for ${agent?.agentId || "A7"}.`,
    };
  }
  if (!fs.existsSync(path.resolve(REPO_ROOT, summary.reportPath))) {
    return {
      ok: false,
      statusCode: "missing-security-report",
      detail: `Missing security review report at ${summary.reportPath}.`,
    };
  }
  if (
    summary.security.state === "clear" &&
    ((summary.security.findings || 0) > 0 || (summary.security.approvals || 0) > 0)
  ) {
    return {
      ok: false,
      statusCode: "invalid-security-clear-state",
      detail:
        "Security review cannot report clear while findings or approvals remain open.",
    };
  }
  if (summary.security.state === "blocked") {
    return {
      ok: false,
      statusCode: "security-blocked",
      detail:
        summary.security.detail ||
        `Security review reported blocked for ${agent?.agentId || "A7"}.`,
    };
  }
  return {
    ok: true,
    statusCode: summary.security.state === "concerns" ? "security-concerns" : "pass",
    detail:
      summary.security.detail ||
      (summary.security.state === "concerns"
        ? "Security review reported advisory concerns."
        : "Security review reported clear."),
  };
}

export function validateIntegrationSummary(agent, summary) {
  if (!summary?.integration) {
    return {
      ok: false,
      statusCode: "missing-wave-integration",
      detail: appendTerminationHint(
        `Missing [wave-integration] marker for ${agent?.agentId || "A8"}.`,
        summary,
      ),
    };
  }
  if (summary.integration.state !== "ready-for-doc-closure") {
    return {
      ok: false,
      statusCode: "integration-needs-more-work",
      detail:
        summary.integration.detail ||
        `Integration steward reported ${summary.integration.state}.`,
    };
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: summary.integration.detail || "Integration summary is ready for doc closure.",
  };
}

export function validateContEvalSummary(agent, summary, options = {}) {
  const mode = String(options.mode || "compat").trim().toLowerCase();
  const strict = mode === "live";
  if (!summary?.eval) {
    return {
      ok: false,
      statusCode: "missing-wave-eval",
      detail: appendTerminationHint(
        `Missing [wave-eval] marker for ${agent?.agentId || "E0"}.`,
        summary,
      ),
    };
  }
  if (strict) {
    if (!summary.reportPath) {
      return {
        ok: false,
        statusCode: "missing-cont-eval-report",
        detail: `Missing cont-EVAL report path for ${agent?.agentId || "E0"}.`,
      };
    }
  }
  if (summary.eval.state !== "satisfied") {
    return {
      ok: false,
      statusCode:
        summary.eval.state === "blocked" ? "cont-eval-blocked" : "cont-eval-needs-more-work",
      detail:
        summary.eval.detail ||
        `cont-EVAL reported ${summary.eval.state}.`,
    };
  }
  if (summary.reportPath && !fs.existsSync(path.resolve(REPO_ROOT, summary.reportPath))) {
    return {
      ok: false,
      statusCode: "missing-cont-eval-report",
      detail: `Missing cont-EVAL report at ${summary.reportPath}.`,
    };
  }
  if (strict) {
    const evalTargets = Array.isArray(options.evalTargets) ? options.evalTargets : [];
    if (evalTargets.length === 0) {
      return {
        ok: false,
        statusCode: "missing-cont-eval-contract",
        detail: `Missing eval target contract for ${agent?.agentId || "E0"}.`,
      };
    }
    const expectedTargetIds = uniqueSorted(evalTargets.map((target) => target.id));
    const actualTargetIds = uniqueSorted(summary.eval.targetIds);
    if (actualTargetIds.length === 0) {
      return {
        ok: false,
        statusCode: "missing-cont-eval-target-ids",
        detail: `Missing target_ids in [wave-eval] marker for ${agent?.agentId || "E0"}.`,
      };
    }
    if (summary.eval.targets !== actualTargetIds.length) {
      return {
        ok: false,
        statusCode: "cont-eval-target-count-mismatch",
        detail: `cont-EVAL reported ${summary.eval.targets} targets, but target_ids enumerates ${actualTargetIds.length}.`,
      };
    }
    if (!sameStringLists(actualTargetIds, expectedTargetIds)) {
      return {
        ok: false,
        statusCode: "cont-eval-target-mismatch",
        detail: `cont-EVAL target_ids must match the declared eval targets (${expectedTargetIds.join(", ")}).`,
      };
    }
    const actualBenchmarkIds = uniqueSorted(summary.eval.benchmarkIds);
    if (actualBenchmarkIds.length === 0) {
      return {
        ok: false,
        statusCode: "missing-cont-eval-benchmarks",
        detail: `Missing benchmark_ids in [wave-eval] marker for ${agent?.agentId || "E0"}.`,
      };
    }
    if (summary.eval.benchmarks !== actualBenchmarkIds.length) {
      return {
        ok: false,
        statusCode: "cont-eval-benchmark-count-mismatch",
        detail: `cont-EVAL reported ${summary.eval.benchmarks} benchmarks, but benchmark_ids enumerates ${actualBenchmarkIds.length}.`,
      };
    }
    if ((summary.eval.regressions || 0) > 0) {
      return {
        ok: false,
        statusCode: "cont-eval-regressions",
        detail: summary.eval.detail || "cont-EVAL reported unresolved regressions.",
      };
    }
    const resolvedTargets = resolveEvalTargetsAgainstCatalog(evalTargets, {
      benchmarkCatalogPath: options.benchmarkCatalogPath,
    });
    const actualBenchmarkSet = new Set(actualBenchmarkIds);
    const allowedBenchmarkIds = new Set(
      resolvedTargets.targets.flatMap((target) => target.allowedBenchmarks || []),
    );
    for (const benchmarkId of actualBenchmarkIds) {
      if (!allowedBenchmarkIds.has(benchmarkId)) {
        return {
          ok: false,
          statusCode: "cont-eval-benchmark-mismatch",
          detail: `cont-EVAL selected undeclared benchmark "${benchmarkId}".`,
        };
      }
    }
    for (const target of resolvedTargets.targets) {
      if (target.selection === "pinned") {
        const missingPinned = (target.benchmarks || []).filter(
          (benchmarkId) => !actualBenchmarkSet.has(benchmarkId),
        );
        if (missingPinned.length > 0) {
          return {
            ok: false,
            statusCode: "cont-eval-benchmark-mismatch",
            detail: `cont-EVAL must include pinned benchmarks for ${target.id}: ${missingPinned.join(", ")}.`,
          };
        }
        continue;
      }
      if (!(target.allowedBenchmarks || []).some((benchmarkId) => actualBenchmarkSet.has(benchmarkId))) {
        return {
          ok: false,
          statusCode: "cont-eval-benchmark-mismatch",
          detail: `cont-EVAL must select at least one benchmark from family "${target.benchmarkFamily}" for ${target.id}.`,
        };
      }
    }
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: summary.eval.detail || "cont-EVAL reported satisfied targets.",
  };
}

export function validateContQaSummary(agent, summary, options = {}) {
  const mode = String(options.mode || "compat").trim().toLowerCase();
  const strict = mode === "live";
  if (!summary?.gate) {
    return {
      ok: false,
      statusCode: "missing-wave-gate",
      detail: appendTerminationHint(
        `Missing [wave-gate] marker for ${agent?.agentId || "A0"}.`,
        summary,
      ),
    };
  }
  if (strict) {
    if (!summary.reportPath) {
      return {
        ok: false,
        statusCode: "missing-cont-qa-report",
        detail: `Missing cont-QA report path for ${agent?.agentId || "A0"}.`,
      };
    }
    if (!fs.existsSync(path.resolve(REPO_ROOT, summary.reportPath))) {
      return {
        ok: false,
        statusCode: "missing-cont-qa-report",
        detail: `Missing cont-QA report at ${summary.reportPath}.`,
      };
    }
  }
  if (!summary?.verdict?.verdict) {
    return {
      ok: false,
      statusCode: "missing-cont-qa-verdict",
      detail: appendTerminationHint(
        `Missing Verdict line or [wave-verdict] marker for ${agent?.agentId || "A0"}.`,
        summary,
      ),
    };
  }
  if (summary.verdict.verdict !== "pass") {
    return {
      ok: false,
      statusCode: `cont-qa-${summary.verdict.verdict}`,
      detail: summary.verdict.detail || "Verdict read from cont-QA report.",
    };
  }
  for (const key of ["architecture", "integration", "durability", "live", "docs"]) {
    if (summary.gate[key] !== "pass") {
      return {
        ok: false,
        statusCode: `gate-${key}-${summary.gate[key]}`,
        detail:
          summary.gate.detail ||
          `Final cont-QA gate did not pass ${key}; got ${summary.gate[key]}.`,
      };
    }
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: summary.verdict.detail || summary.gate.detail || "cont-QA gate passed.",
  };
}
