import fs from "node:fs";
import path from "node:path";
import {
  materializeCoordinationState,
  normalizeCoordinationRecord,
} from "./coordination-store.mjs";
import { loadBenchmarkCatalog } from "./evals.mjs";
import { REPO_ROOT, readJsonOrNull } from "./shared.mjs";

const DEFAULT_BENCHMARK_CASES_DIR = "docs/evals/cases";
const DEFAULT_EXTERNAL_BENCHMARKS_PATH = "docs/evals/external-benchmarks.json";
const SUPPORTED_CASE_KINDS = new Set(["projection"]);
const SUPPORTED_CASE_ARMS = new Set([
  "single-agent",
  "multi-agent-minimal",
  "full-wave",
  "full-wave-plus-improvement",
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeRepoRelativePath(value, label) {
  const normalized = cleanText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${label} must stay within the repository`);
  }
  return normalized;
}

function normalizeId(value, label) {
  const normalized = cleanText(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`${label} must match /^[a-z0-9][a-z0-9._-]*$/`);
  }
  return normalized;
}

function normalizeStringArray(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => cleanText(entry)).map((entry, index) => {
    if (!entry) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function normalizeIdArray(value, label, { allowEmpty = true } = {}) {
  const ids = normalizeStringArray(value, label).map((entry, index) =>
    normalizeId(entry, `${label}[${index}]`),
  );
  if (!allowEmpty && ids.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return Array.from(new Set(ids));
}

function normalizeAgent(rawAgent, index) {
  if (!rawAgent || typeof rawAgent !== "object" || Array.isArray(rawAgent)) {
    throw new Error(`fixture.agents[${index}] must be an object`);
  }
  const agentId = normalizeId(rawAgent.agentId, `fixture.agents[${index}].agentId`);
  return {
    agentId,
    title: cleanText(rawAgent.title) || agentId,
    ownedPaths: normalizeStringArray(rawAgent.ownedPaths, `fixture.agents[${index}].ownedPaths`),
    capabilities: normalizeIdArray(
      rawAgent.capabilities,
      `fixture.agents[${index}].capabilities`,
    ),
  };
}

function normalizeAssignments(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    return {
      requestId: normalizeId(entry.requestId, `${label}[${index}].requestId`),
      assignedAgentId: normalizeId(entry.assignedAgentId, `${label}[${index}].assignedAgentId`),
    };
  });
}

function normalizeTargetedInboxes(value, label) {
  if (value == null) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([agentId, facts]) => [
      normalizeId(agentId, `${label}.${agentId}`),
      normalizeStringArray(facts, `${label}.${agentId}`),
    ]),
  );
}

function normalizeExpectations(rawExpectations = {}) {
  if (!rawExpectations || typeof rawExpectations !== "object" || Array.isArray(rawExpectations)) {
    throw new Error("expectations must be an object");
  }
  return {
    globalFacts: normalizeStringArray(rawExpectations.globalFacts, "expectations.globalFacts"),
    summaryFacts: normalizeStringArray(rawExpectations.summaryFacts, "expectations.summaryFacts"),
    targetedInboxes: normalizeTargetedInboxes(
      rawExpectations.targetedInboxes,
      "expectations.targetedInboxes",
    ),
    requiredAssignments: normalizeAssignments(
      rawExpectations.requiredAssignments,
      "expectations.requiredAssignments",
    ),
    clarificationRequestIds: normalizeIdArray(
      rawExpectations.clarificationRequestIds,
      "expectations.clarificationRequestIds",
    ),
    minimumDistinctAssignedAgents:
      rawExpectations.minimumDistinctAssignedAgents == null
        ? null
        : Number.parseInt(String(rawExpectations.minimumDistinctAssignedAgents), 10),
    requireBlockingGuard:
      rawExpectations.requireBlockingGuard === undefined
        ? false
        : Boolean(rawExpectations.requireBlockingGuard),
  };
}

function normalizeThresholds(rawThresholds = {}) {
  if (!rawThresholds || typeof rawThresholds !== "object" || Array.isArray(rawThresholds)) {
    throw new Error("scoring.thresholds must be an object");
  }
  const normalized = {};
  for (const [key, value] of Object.entries(rawThresholds)) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`scoring.thresholds.${key} must be numeric`);
    }
    normalized[key] = parsed;
  }
  return normalized;
}

function normalizeScoring(rawScoring = {}) {
  if (!rawScoring || typeof rawScoring !== "object" || Array.isArray(rawScoring)) {
    throw new Error("scoring must be an object");
  }
  const kind = normalizeId(rawScoring.kind, "scoring.kind");
  return {
    kind,
    primaryMetric: normalizeId(rawScoring.primaryMetric, "scoring.primaryMetric"),
    thresholds: normalizeThresholds(rawScoring.thresholds || {}),
    practicalWinThreshold:
      rawScoring.practicalWinThreshold == null
        ? 5
        : Number.parseFloat(String(rawScoring.practicalWinThreshold)),
  };
}

function normalizeCapabilityRouting(value) {
  if (value == null) {
    return { preferredAgents: {} };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("fixture.capabilityRouting must be an object");
  }
  const preferredAgents =
    value.preferredAgents && typeof value.preferredAgents === "object" && !Array.isArray(value.preferredAgents)
      ? value.preferredAgents
      : {};
  return {
    preferredAgents: Object.fromEntries(
      Object.entries(preferredAgents).map(([capability, agents]) => [
        normalizeId(capability, `fixture.capabilityRouting.preferredAgents.${capability}`),
        normalizeIdArray(
          agents,
          `fixture.capabilityRouting.preferredAgents.${capability}`,
        ),
      ]),
    ),
  };
}

function normalizeBenchmarkCase(rawCase, filePath, catalog) {
  if (!rawCase || typeof rawCase !== "object" || Array.isArray(rawCase)) {
    throw new Error(`Benchmark case must be an object: ${filePath}`);
  }
  const id = normalizeId(rawCase.id, `${filePath}: id`);
  const familyId = normalizeId(rawCase.familyId, `${filePath}: familyId`);
  const benchmarkId = normalizeId(rawCase.benchmarkId, `${filePath}: benchmarkId`);
  const family = catalog.families[familyId];
  if (!family) {
    throw new Error(`${filePath}: unknown benchmark family "${familyId}"`);
  }
  const benchmark = family.benchmarks[benchmarkId];
  if (!benchmark) {
    throw new Error(`${filePath}: unknown benchmark "${benchmarkId}" for family "${familyId}"`);
  }
  const catalogLocalCases = Array.from(
    new Set([...(family.localCases || []), ...(benchmark.localCases || [])]),
  );
  if (catalogLocalCases.length > 0 && !catalogLocalCases.includes(id)) {
    throw new Error(
      `${filePath}: case "${id}" is not registered in ${catalog.path} for ${familyId}/${benchmarkId}`,
    );
  }
  const kind = normalizeId(rawCase.kind || "projection", `${filePath}: kind`);
  if (!SUPPORTED_CASE_KINDS.has(kind)) {
    throw new Error(`${filePath}: unsupported case kind "${kind}"`);
  }
  const fixture = rawCase.fixture;
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    throw new Error(`${filePath}: fixture must be an object`);
  }
  const agents = Array.isArray(fixture.agents)
    ? fixture.agents.map((agent, index) => normalizeAgent(agent, index))
    : [];
  if (agents.length === 0) {
    throw new Error(`${filePath}: fixture.agents must define at least one agent`);
  }
  const primaryAgentId = normalizeId(
    fixture.primaryAgentId || agents[0].agentId,
    `${filePath}: fixture.primaryAgentId`,
  );
  if (!agents.some((agent) => agent.agentId === primaryAgentId)) {
    throw new Error(`${filePath}: fixture.primaryAgentId must match one of fixture.agents`);
  }
  const supportedArms = normalizeIdArray(
    rawCase.supportedArms || ["single-agent", "multi-agent-minimal", "full-wave"],
    `${filePath}: supportedArms`,
    { allowEmpty: false },
  );
  for (const arm of supportedArms) {
    if (!SUPPORTED_CASE_ARMS.has(arm)) {
      throw new Error(`${filePath}: unsupported benchmark arm "${arm}"`);
    }
  }
  const records = Array.isArray(fixture.records)
    ? fixture.records.map((record, index) =>
        normalizeCoordinationRecord(record, {
          lane: cleanText(fixture.lane) || "main",
          wave:
            fixture.waveNumber == null ? 0 : Number.parseInt(String(fixture.waveNumber), 10),
          source: "benchmark-case",
        }),
      )
    : [];
  if (records.length === 0) {
    throw new Error(`${filePath}: fixture.records must define at least one coordination record`);
  }
  return {
    id,
    version: Number.parseInt(String(rawCase.version ?? "1"), 10) || 1,
    path: path.relative(REPO_ROOT, filePath).replaceAll(path.sep, "/"),
    title: cleanText(rawCase.title) || id,
    summary: cleanText(rawCase.summary) || null,
    tags: normalizeIdArray(rawCase.tags, `${filePath}: tags`),
    kind,
    familyId,
    benchmarkId,
    familyTitle: family.title,
    benchmarkTitle: benchmark.title,
    supportedArms,
    scoring: normalizeScoring(rawCase.scoring),
    expectations: normalizeExpectations(rawCase.expectations),
    fixture: {
      lane: cleanText(fixture.lane) || "main",
      waveNumber:
        fixture.waveNumber == null ? 0 : Number.parseInt(String(fixture.waveNumber), 10),
      primaryAgentId,
      capabilityRouting: normalizeCapabilityRouting(fixture.capabilityRouting),
      agents,
      records,
      state: materializeCoordinationState(records),
    },
  };
}

function readJsonFile(filePath) {
  const payload = readJsonOrNull(filePath);
  if (!payload) {
    throw new Error(`Invalid JSON file: ${path.relative(REPO_ROOT, filePath)}`);
  }
  return payload;
}

export function loadBenchmarkCases(options = {}) {
  const casesDir = path.resolve(
    REPO_ROOT,
    normalizeRepoRelativePath(options.casesDir || DEFAULT_BENCHMARK_CASES_DIR, "casesDir"),
  );
  if (!fs.existsSync(casesDir)) {
    throw new Error(`Benchmark cases directory does not exist: ${path.relative(REPO_ROOT, casesDir)}`);
  }
  const catalog = loadBenchmarkCatalog(options);
  const files = fs
    .readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(casesDir, entry.name))
    .toSorted();
  const seen = new Set();
  const cases = files.map((filePath) => {
    const benchmarkCase = normalizeBenchmarkCase(readJsonFile(filePath), filePath, catalog);
    if (seen.has(benchmarkCase.id)) {
      throw new Error(`Duplicate benchmark case id "${benchmarkCase.id}"`);
    }
    seen.add(benchmarkCase.id);
    return benchmarkCase;
  });
  return {
    casesDir: path.relative(REPO_ROOT, casesDir).replaceAll(path.sep, "/"),
    absoluteCasesDir: casesDir,
    catalog,
    cases,
    byId: new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase])),
  };
}

export function loadExternalBenchmarkAdapters(options = {}) {
  const registryPath = path.resolve(
    REPO_ROOT,
    normalizeRepoRelativePath(
      options.externalBenchmarksPath || DEFAULT_EXTERNAL_BENCHMARKS_PATH,
      "externalBenchmarksPath",
    ),
  );
  const payload = readJsonFile(registryPath);
  const adapters = Array.isArray(payload.adapters) ? payload.adapters : [];
  return {
    path: path.relative(REPO_ROOT, registryPath).replaceAll(path.sep, "/"),
    version: Number.parseInt(String(payload.version ?? "1"), 10) || 1,
    adapters: adapters.map((adapter, index) => {
      if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
        throw new Error(`adapters[${index}] in ${registryPath} must be an object`);
      }
      return {
        id: normalizeId(adapter.id, `adapters[${index}].id`),
        title: cleanText(adapter.title) || normalizeId(adapter.id, `adapters[${index}].id`),
        mode: cleanText(adapter.mode) || "adapted",
        sourceBenchmark: cleanText(adapter.sourceBenchmark) || null,
        split: cleanText(adapter.split) || null,
        pilotManifestPath: cleanText(adapter.pilotManifestPath) || null,
        officialDocsUrl: cleanText(adapter.officialDocsUrl) || null,
        officialCodeUrl: cleanText(adapter.officialCodeUrl) || null,
        summary: cleanText(adapter.summary) || null,
        commandTemplate: cleanText(adapter.commandTemplate) || null,
        metrics: normalizeStringArray(adapter.metrics, `adapters[${index}].metrics`),
        notes: normalizeStringArray(adapter.notes, `adapters[${index}].notes`),
      };
    }),
  };
}
