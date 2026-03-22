import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BENCHMARK_CATALOG_PATH } from "./config.mjs";
import { REPO_ROOT, readJsonOrNull } from "./shared.mjs";

const EVAL_SELECTION_VALUES = new Set(["pinned", "delegated"]);
const METRIC_DIRECTION_VALUES = new Set(["higher-is-better", "lower-is-better", "target", "rubric"]);

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

function normalizeEvalTargetId(value, label) {
  const normalized = cleanText(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`${label} must match /^[a-z0-9][a-z0-9._-]*$/`);
  }
  return normalized;
}

function normalizeLooseId(value, label) {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error(`${label} must contain at least one alphanumeric character`);
  }
  return normalizeEvalTargetId(normalized, label);
}

function stripWrappedQuotes(value) {
  return cleanText(value).replace(/^["'`](.*)["'`]$/s, "$1").trim();
}

function parseOptionalYear(value, label) {
  const normalized = cleanText(value);
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 9999) {
    throw new Error(`${label} must be a valid year`);
  }
  return parsed;
}

function normalizeStringArray(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value
    .map((entry, index) => cleanText(entry ?? ""))
    .filter(Boolean)
    .map((entry, index) => {
      if (!entry) {
        throw new Error(`${label}[${index}] must be a non-empty string`);
      }
      return entry;
    });
}

function normalizeMetricDescriptor(value, label) {
  if (value == null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const id = normalizeEvalTargetId(value.id, `${label}.id`);
  const direction = cleanText(value.direction);
  if (direction && !METRIC_DIRECTION_VALUES.has(direction)) {
    throw new Error(
      `${label}.direction must be one of: ${Array.from(METRIC_DIRECTION_VALUES).join(", ")}`,
    );
  }
  return {
    id,
    title: cleanText(value.title) || id,
    unit: cleanText(value.unit) || null,
    direction: direction || null,
    summary: cleanText(value.summary) || null,
  };
}

function normalizeMetricDescriptorArray(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => normalizeMetricDescriptor(entry, `${label}[${index}]`));
}

function normalizePaperReference(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const title = cleanText(value.title);
  if (!title) {
    throw new Error(`${label}.title is required`);
  }
  const id = cleanText(value.id)
    ? normalizeEvalTargetId(value.id, `${label}.id`)
    : normalizeLooseId(title, `${label}.title`);
  return {
    id,
    title,
    year: parseOptionalYear(value.year, `${label}.year`),
    url: cleanText(value.url) || null,
    summary: cleanText(value.summary) || null,
  };
}

function normalizePaperReferenceArray(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => normalizePaperReference(entry, `${label}[${index}]`));
}

function normalizeSotaBaseline(value, label) {
  if (value == null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const source = cleanText(value.source);
  const paper = cleanText(value.paper);
  const metric = cleanText(value.metric);
  if (!source) {
    throw new Error(`${label}.source is required`);
  }
  if (!paper) {
    throw new Error(`${label}.paper is required`);
  }
  if (!metric) {
    throw new Error(`${label}.metric is required`);
  }
  let baselineValue = value.value ?? null;
  if (typeof baselineValue === "string") {
    baselineValue = cleanText(baselineValue);
  }
  if (
    baselineValue !== null &&
    typeof baselineValue !== "number" &&
    typeof baselineValue !== "string"
  ) {
    throw new Error(`${label}.value must be a number or string when present`);
  }
  if (typeof baselineValue === "string" && !baselineValue) {
    throw new Error(`${label}.value must not be empty when provided`);
  }
  return {
    source,
    paper,
    year: parseOptionalYear(value.year, `${label}.year`),
    metric,
    value: baselineValue,
    notes: cleanText(value.notes) || null,
    url: cleanText(value.url) || null,
  };
}

function normalizeScoringDescriptor(value, label) {
  if (value == null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    primaryMetric: cleanText(value.primaryMetric) || null,
    successCriterion: cleanText(value.successCriterion) || null,
    rubric: cleanText(value.rubric) || null,
    notes: cleanText(value.notes) || null,
  };
}

function parseEvalTargetLine(line, filePath, index) {
  const bulletMatch = cleanText(line).match(/^-\s+(.+)$/);
  if (!bulletMatch) {
    throw new Error(`Malformed eval target "${line}" in ${filePath}`);
  }
  const fields = {};
  for (const entry of bulletMatch[1].split("|")) {
    const pair = cleanText(entry);
    if (!pair) {
      continue;
    }
    const separatorIndex = pair.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Malformed eval target field "${pair}" in ${filePath}`);
    }
    const key = cleanText(pair.slice(0, separatorIndex)).toLowerCase();
    const value = stripWrappedQuotes(pair.slice(separatorIndex + 1));
    if (!key || !value) {
      throw new Error(`Malformed eval target field "${pair}" in ${filePath}`);
    }
    fields[key] = value;
  }
  const id = normalizeEvalTargetId(fields.id, `evalTargets[${index}].id`);
  const selection = cleanText(fields.selection).toLowerCase();
  if (!EVAL_SELECTION_VALUES.has(selection)) {
    throw new Error(
      `evalTargets[${index}].selection must be one of: ${Array.from(EVAL_SELECTION_VALUES).join(", ")}`,
    );
  }
  const benchmarkFamily = fields["benchmark-family"]
    ? normalizeEvalTargetId(fields["benchmark-family"], `evalTargets[${index}].benchmark-family`)
    : null;
  const benchmarks = cleanText(fields.benchmarks)
    .split(",")
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .map((entry, benchmarkIndex) =>
      normalizeEvalTargetId(entry, `evalTargets[${index}].benchmarks[${benchmarkIndex}]`),
    );
  const objective = cleanText(fields.objective);
  const threshold = cleanText(fields.threshold);
  if (!objective) {
    throw new Error(`evalTargets[${index}].objective is required`);
  }
  if (!threshold) {
    throw new Error(`evalTargets[${index}].threshold is required`);
  }
  if (selection === "delegated" && !benchmarkFamily) {
    throw new Error(`evalTargets[${index}] must declare benchmark-family when selection=delegated`);
  }
  if (selection === "pinned" && benchmarks.length === 0) {
    throw new Error(`evalTargets[${index}] must declare benchmarks when selection=pinned`);
  }
  return {
    id,
    selection,
    benchmarkFamily,
    benchmarks,
    objective,
    threshold,
  };
}

export function parseEvalTargets(blockText, filePath) {
  if (!blockText) {
    return [];
  }
  const targets = [];
  const seen = new Set();
  for (const line of String(blockText).split(/\r?\n/)) {
    const trimmed = cleanText(line);
    if (!trimmed) {
      continue;
    }
    const target = parseEvalTargetLine(trimmed, filePath, targets.length);
    if (seen.has(target.id)) {
      throw new Error(`Duplicate eval target "${target.id}" in ${filePath}`);
    }
    seen.add(target.id);
    targets.push(target);
  }
  return targets;
}

export function loadBenchmarkCatalog(options = {}) {
  const benchmarkCatalogPath = normalizeRepoRelativePath(
    options.benchmarkCatalogPath || DEFAULT_BENCHMARK_CATALOG_PATH,
    "benchmarkCatalogPath",
  );
  const absolutePath = path.resolve(REPO_ROOT, benchmarkCatalogPath);
  const payload = readJsonOrNull(absolutePath);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Benchmark catalog is missing or invalid: ${benchmarkCatalogPath}`);
  }
  const familiesInput =
    payload.families && typeof payload.families === "object" && !Array.isArray(payload.families)
      ? payload.families
      : null;
  if (!familiesInput) {
    throw new Error(`Benchmark catalog must define a "families" object in ${benchmarkCatalogPath}`);
  }
  const families = {};
  const benchmarkIndex = {};
  for (const [familyKey, rawFamily] of Object.entries(familiesInput)) {
    const familyId = normalizeEvalTargetId(familyKey, `families.${familyKey}`);
    if (!rawFamily || typeof rawFamily !== "object" || Array.isArray(rawFamily)) {
      throw new Error(`Benchmark family "${familyId}" must be an object in ${benchmarkCatalogPath}`);
    }
    const benchmarksInput =
      rawFamily.benchmarks &&
      typeof rawFamily.benchmarks === "object" &&
      !Array.isArray(rawFamily.benchmarks)
        ? rawFamily.benchmarks
        : null;
    if (!benchmarksInput || Object.keys(benchmarksInput).length === 0) {
      throw new Error(`Benchmark family "${familyId}" must define a non-empty benchmarks object`);
    }
    const familyPrimaryMetric = normalizeMetricDescriptor(
      rawFamily.primaryMetric,
      `families.${familyId}.primaryMetric`,
    );
    const familySecondaryMetrics = normalizeMetricDescriptorArray(
      rawFamily.secondaryMetrics,
      `families.${familyId}.secondaryMetrics`,
    );
    const familyPaperReferences = normalizePaperReferenceArray(
      rawFamily.paperReferences,
      `families.${familyId}.paperReferences`,
    );
    const familySotaBaseline = normalizeSotaBaseline(
      rawFamily.sotaBaseline,
      `families.${familyId}.sotaBaseline`,
    );
    const benchmarks = {};
    for (const [benchmarkKey, rawBenchmark] of Object.entries(benchmarksInput)) {
      const benchmarkId = normalizeEvalTargetId(
        benchmarkKey,
        `families.${familyId}.benchmarks.${benchmarkKey}`,
      );
      if (benchmarkIndex[benchmarkId]) {
        throw new Error(`Benchmark id "${benchmarkId}" appears in multiple families`);
      }
      const benchmark =
        rawBenchmark && typeof rawBenchmark === "object" && !Array.isArray(rawBenchmark)
          ? rawBenchmark
          : {};
      benchmarks[benchmarkId] = {
        id: benchmarkId,
        title: cleanText(benchmark.title) || benchmarkId,
        summary: cleanText(benchmark.summary) || null,
        goal: cleanText(benchmark.goal) || null,
        failureModes: normalizeStringArray(
          benchmark.failureModes,
          `families.${familyId}.benchmarks.${benchmarkId}.failureModes`,
        ),
        signals: normalizeStringArray(
          benchmark.signals,
          `families.${familyId}.benchmarks.${benchmarkId}.signals`,
        ),
        scoring: normalizeScoringDescriptor(
          benchmark.scoring,
          `families.${familyId}.benchmarks.${benchmarkId}.scoring`,
        ),
        tuningNotes: cleanText(benchmark.tuningNotes) || null,
        paperReferences: normalizePaperReferenceArray(
          benchmark.paperReferences,
          `families.${familyId}.benchmarks.${benchmarkId}.paperReferences`,
        ),
        sotaBaseline: normalizeSotaBaseline(
          benchmark.sotaBaseline,
          `families.${familyId}.benchmarks.${benchmarkId}.sotaBaseline`,
        ),
      };
      benchmarkIndex[benchmarkId] = familyId;
    }
    families[familyId] = {
      id: familyId,
      title: cleanText(rawFamily.title) || familyId,
      summary: cleanText(rawFamily.summary) || null,
      category: cleanText(rawFamily.category) || null,
      coordinationModel: cleanText(rawFamily.coordinationModel) || null,
      primaryMetric: familyPrimaryMetric,
      secondaryMetrics: familySecondaryMetrics,
      paperReferences: familyPaperReferences,
      sotaBaseline: familySotaBaseline,
      benchmarks,
    };
  }
  return {
    version: Number.parseInt(String(payload.version ?? "1"), 10) || 1,
    path: benchmarkCatalogPath,
    absolutePath,
    families,
    benchmarkIndex,
  };
}

export function validateEvalTargets(evalTargets, options = {}) {
  const targets = Array.isArray(evalTargets) ? evalTargets : [];
  const catalog = loadBenchmarkCatalog(options);
  for (const target of targets) {
    if (target.selection === "delegated") {
      if (!catalog.families[target.benchmarkFamily]) {
        throw new Error(
          `Eval target "${target.id}" references unknown benchmark family "${target.benchmarkFamily}" from ${catalog.path}`,
        );
      }
      continue;
    }
    for (const benchmarkId of target.benchmarks || []) {
      const familyId = catalog.benchmarkIndex[benchmarkId];
      if (!familyId) {
        throw new Error(
          `Eval target "${target.id}" references unknown benchmark "${benchmarkId}" from ${catalog.path}`,
        );
      }
      if (target.benchmarkFamily && target.benchmarkFamily !== familyId) {
        throw new Error(
          `Eval target "${target.id}" pins benchmark "${benchmarkId}" from family "${familyId}", not declared family "${target.benchmarkFamily}"`,
        );
      }
    }
  }
  return catalog;
}

export function resolveEvalTargetsAgainstCatalog(evalTargets, options = {}) {
  const targets = Array.isArray(evalTargets) ? evalTargets : [];
  const catalog = validateEvalTargets(targets, options);
  return {
    catalog,
    targets: targets.map((target) => ({
      ...target,
      allowedBenchmarks:
        target.selection === "delegated"
          ? Object.keys(catalog.families[target.benchmarkFamily]?.benchmarks || {})
          : [...(target.benchmarks || [])],
    })),
  };
}

export function benchmarkCatalogExists(options = {}) {
  const benchmarkCatalogPath = normalizeRepoRelativePath(
    options.benchmarkCatalogPath || DEFAULT_BENCHMARK_CATALOG_PATH,
    "benchmarkCatalogPath",
  );
  return fs.existsSync(path.resolve(REPO_ROOT, benchmarkCatalogPath));
}
