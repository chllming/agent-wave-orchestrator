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

export const EXIT_CONTRACT_COMPLETION_VALUES = ["contract", "integrated", "authoritative", "live"];
export const EXIT_CONTRACT_DURABILITY_VALUES = ["none", "ephemeral", "durable"];
export const EXIT_CONTRACT_PROOF_VALUES = ["unit", "integration", "live"];
export const EXIT_CONTRACT_DOC_IMPACT_VALUES = ["none", "owned", "shared-plan"];

const ORDER = (values) => Object.fromEntries(values.map((value, index) => [value, index]));
const COMPLETION_ORDER = ORDER(EXIT_CONTRACT_COMPLETION_VALUES);
const DURABILITY_ORDER = ORDER(EXIT_CONTRACT_DURABILITY_VALUES);
const PROOF_ORDER = ORDER(EXIT_CONTRACT_PROOF_VALUES);
const DOC_IMPACT_ORDER = ORDER(EXIT_CONTRACT_DOC_IMPACT_VALUES);

const WAVE_PROOF_REGEX =
  /^\[wave-proof\]\s*completion=(contract|integrated|authoritative|live)\s+durability=(none|ephemeral|durable)\s+proof=(unit|integration|live)\s+state=(met|gap)\s*(?:detail=(.*))?$/gim;
const WAVE_DOC_DELTA_REGEX =
  /^\[wave-doc-delta\]\s*state=(none|owned|shared-plan)(?:\s+paths=([^\n]*?))?(?:\s+detail=(.*))?$/gim;
const WAVE_DOC_CLOSURE_REGEX =
  /^\[wave-doc-closure\]\s*state=(closed|no-change|delta)(?:\s+paths=([^\n]*?))?(?:\s+detail=(.*))?$/gim;
const WAVE_INTEGRATION_REGEX =
  /^\[wave-integration\]\s*state=(ready-for-doc-closure|needs-more-work)\s+claims=(\d+)\s+conflicts=(\d+)\s+blockers=(\d+)\s*(?:detail=(.*))?$/gim;
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

function detectTermination(logText, statusRecord) {
  const patterns = [
    { reason: "max-turns", regex: /(Reached max turns \(\d+\))/i },
    { reason: "timeout", regex: /(timed out(?: after [^\n.]+)?)/i },
    { reason: "session-missing", regex: /(session [^\n]+ disappeared before [^\n]+ was written)/i },
  ];
  for (const pattern of patterns) {
    const match = String(logText || "").match(pattern.regex);
    if (match) {
      return {
        reason: pattern.reason,
        hint: cleanText(match[1] || match[0]),
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
  const termination = detectTermination(logText, statusRecord);
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
        }))
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

export function validateEvaluatorSummary(agent, summary) {
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
  if (!summary?.verdict?.verdict) {
    return {
      ok: false,
      statusCode: "missing-evaluator-verdict",
      detail: appendTerminationHint(
        `Missing Verdict line or [wave-verdict] marker for ${agent?.agentId || "A0"}.`,
        summary,
      ),
    };
  }
  if (summary.verdict.verdict !== "pass") {
    return {
      ok: false,
      statusCode: `evaluator-${summary.verdict.verdict}`,
      detail: summary.verdict.detail || "Verdict read from evaluator report.",
    };
  }
  for (const key of ["architecture", "integration", "durability", "live", "docs"]) {
    if (summary.gate[key] !== "pass") {
      return {
        ok: false,
        statusCode: `gate-${key}-${summary.gate[key]}`,
        detail:
          summary.gate.detail ||
          `Final evaluator gate did not pass ${key}; got ${summary.gate[key]}.`,
      };
    }
  }
  return {
    ok: true,
    statusCode: "pass",
    detail: summary.verdict.detail || summary.gate.detail || "Evaluator gate passed.",
  };
}
