import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  compactSingleLine,
  ensureDirectory,
  hashText,
  readJsonOrNull,
  sleep,
  writeJsonAtomic,
} from "./shared.mjs";

export const DEFAULT_CONTEXT7_BUNDLE_INDEX_PATH = path.join(
  REPO_ROOT,
  "docs",
  "context7",
  "bundles.json",
);
export const DEFAULT_CONTEXT7_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CONTEXT7_PROMPT_CHAR_BUDGET = 12000;

const CONTEXT7_SEARCH_URL = "https://context7.com/api/v2/libs/search";
const CONTEXT7_CONTEXT_URL = "https://context7.com/api/v2/context";

function cleanText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const wrappedQuote =
    (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"));
  if (wrappedQuote) {
    return text.slice(1, -1).trim();
  }
  return text;
}

export function normalizeContext7Config(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const bundle = cleanText(raw.bundle);
  const query = compactSingleLine(cleanText(raw.query), 280);
  if (!bundle && !query) {
    return null;
  }
  return {
    bundle: bundle || null,
    query: query || null,
  };
}

function normalizeBundleLibrary(entry, bundleId) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Context7 bundle "${bundleId}" has a malformed library entry.`);
  }
  const libraryId = cleanText(entry.libraryId);
  const libraryName = cleanText(entry.libraryName);
  if (!libraryId && !libraryName) {
    throw new Error(
      `Context7 bundle "${bundleId}" must define either "libraryId" or "libraryName" for each library.`,
    );
  }
  return {
    libraryId: libraryId || null,
    libraryName: libraryName || null,
    queryHint: compactSingleLine(cleanText(entry.queryHint), 220) || null,
  };
}

function normalizeBundleDefinition(bundleId, rawBundle) {
  if (!rawBundle || typeof rawBundle !== "object" || Array.isArray(rawBundle)) {
    throw new Error(`Context7 bundle "${bundleId}" must be an object.`);
  }
  const libraries = Array.isArray(rawBundle.libraries)
    ? rawBundle.libraries.map((entry) => normalizeBundleLibrary(entry, bundleId))
    : [];
  return {
    description: compactSingleLine(cleanText(rawBundle.description), 220) || "",
    libraries,
  };
}

export function loadContext7BundleIndex(indexPath = DEFAULT_CONTEXT7_BUNDLE_INDEX_PATH) {
  const payload = readJsonOrNull(indexPath);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      `Context7 bundle index is missing or invalid: ${path.relative(REPO_ROOT, indexPath)}`,
    );
  }
  const rawBundles = payload.bundles;
  if (!rawBundles || typeof rawBundles !== "object" || Array.isArray(rawBundles)) {
    throw new Error(`Context7 bundle index must define a "bundles" object.`);
  }
  const bundles = Object.fromEntries(
    Object.entries(rawBundles).map(([bundleId, rawBundle]) => [
      bundleId,
      normalizeBundleDefinition(bundleId, rawBundle),
    ]),
  );
  const defaultBundle = cleanText(payload.defaultBundle) || "none";
  if (!bundles[defaultBundle]) {
    throw new Error(`Context7 default bundle "${defaultBundle}" is not defined.`);
  }
  if (!bundles.none) {
    throw new Error('Context7 bundle index must define a "none" bundle.');
  }
  const laneDefaults = Object.fromEntries(
    Object.entries(payload.laneDefaults || {})
      .map(([lane, bundleId]) => [String(lane || "").trim().toLowerCase(), cleanText(bundleId)])
      .filter(([, bundleId]) => Boolean(bundleId)),
  );
  for (const [lane, bundleId] of Object.entries(laneDefaults)) {
    if (!bundles[bundleId]) {
      throw new Error(
        `Context7 lane default "${lane}" references unknown bundle "${bundleId}".`,
      );
    }
  }
  const canonicalPayload = {
    version: Number.parseInt(String(payload.version ?? "1"), 10) || 1,
    defaultBundle,
    laneDefaults,
    bundles,
  };
  return {
    ...canonicalPayload,
    indexPath,
    contentHash: hashText(JSON.stringify(canonicalPayload)),
  };
}

function deriveContext7Query(agent) {
  const lines = String(agent?.promptOverlay || agent?.prompt || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^File ownership\b/i.test(line) &&
        !/^Validation\b/i.test(line) &&
        !/^Output\b/i.test(line),
    )
    .slice(0, 6);
  return compactSingleLine(lines.join(" "), 260) || compactSingleLine(agent?.title || "", 120) || "";
}

export function resolveContext7Selection({ lane, waveDefaults, agentConfig, agent, bundleIndex }) {
  const normalizedWaveDefaults = normalizeContext7Config(waveDefaults);
  const normalizedAgentConfig = normalizeContext7Config(agentConfig);
  const laneKey = String(lane || "").trim().toLowerCase();
  const laneDefaultBundle = bundleIndex.laneDefaults[laneKey] || bundleIndex.defaultBundle || "none";
  const bundleId =
    normalizedAgentConfig?.bundle ||
    normalizedWaveDefaults?.bundle ||
    laneDefaultBundle ||
    "none";
  const bundle = bundleIndex.bundles[bundleId];
  if (!bundle) {
    throw new Error(`Unknown Context7 bundle "${bundleId}" for agent ${agent?.agentId || "unknown"}.`);
  }
  let query = "";
  let querySource = "none";
  if (bundleId !== "none") {
    if (normalizedAgentConfig?.query) {
      query = normalizedAgentConfig.query;
      querySource = "agent";
    } else if (normalizedWaveDefaults?.query) {
      query = normalizedWaveDefaults.query;
      querySource = "wave";
    } else {
      query = deriveContext7Query(agent);
      querySource = query ? "derived" : "none";
    }
  }
  const selection = {
    bundleId,
    description: bundle.description || "",
    libraries: bundle.libraries,
    query,
    bundleSource: normalizedAgentConfig?.bundle
      ? "agent"
      : normalizedWaveDefaults?.bundle
        ? "wave"
        : bundleIndex.laneDefaults[laneKey]
          ? "lane"
          : "default",
    querySource,
    indexHash: bundleIndex.contentHash,
  };
  return {
    ...selection,
    selectionHash: hashText(JSON.stringify(selection)),
  };
}

export function applyContext7SelectionsToWave(wave, { lane, bundleIndex }) {
  const context7Defaults = normalizeContext7Config(wave.context7Defaults);
  return {
    ...wave,
    context7Defaults,
    agents: wave.agents.map((agent) => ({
      ...agent,
      context7Config: normalizeContext7Config(agent.context7Config),
      context7Resolved: resolveContext7Selection({
        lane,
        waveDefaults: context7Defaults,
        agentConfig: agent.context7Config,
        agent,
        bundleIndex,
      }),
    })),
  };
}

export function buildAgentPromptFingerprintSource(agent) {
  return JSON.stringify({
    prompt: String(agent?.prompt || ""),
    context7SelectionHash: String(agent?.context7Resolved?.selectionHash || ""),
    exitContract: agent?.exitContract || null,
    components: agent?.components || [],
    componentTargets: agent?.componentTargets || null,
    executorResolved: agent?.executorResolved || null,
    skillsResolved: agent?.skillsResolved
      ? {
          ids: agent.skillsResolved.ids || [],
          role: agent.skillsResolved.role || null,
          runtime: agent.skillsResolved.runtime || null,
          deployKind: agent.skillsResolved.deployKind || null,
          promptHash: agent.skillsResolved.promptHash || null,
        }
      : null,
  });
}

export function hashAgentPromptFingerprint(agent) {
  return hashText(buildAgentPromptFingerprintSource(agent));
}

function context7CacheKey(selection) {
  return hashText(
    JSON.stringify({
      bundleId: selection.bundleId,
      query: selection.query,
      libraries: selection.libraries,
      indexHash: selection.indexHash,
    }),
  );
}

function context7CachePath(cacheDir, selection) {
  return path.join(cacheDir, `${context7CacheKey(selection)}.json`);
}

function trimContextText(text, budget = DEFAULT_CONTEXT7_PROMPT_CHAR_BUDGET) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= budget) {
    return trimmed;
  }
  const suffix = "\n\n[Context7 output truncated to fit prompt budget]";
  return `${trimmed.slice(0, Math.max(0, budget - suffix.length)).trimEnd()}${suffix}`;
}

function renderPrefetchedContextText({ selection, results, budget }) {
  const sections = results.map((result) => {
    const label = result.libraryName || result.libraryId || "unknown-library";
    return [
      `### ${label}`,
      `- Library ID: ${result.libraryId || "unresolved"}`,
      `- Query: ${result.query}`,
      "",
      result.text.trim(),
    ].join("\n");
  });
  return trimContextText(sections.join("\n\n"), budget);
}

async function requestContext7(fetchImpl, url, { apiKey, expectText = false, maxRetries = 3 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: expectText ? "text/plain, application/json" : "application/json",
      },
    });
    if (response.ok) {
      return expectText ? response.text() : response.json();
    }
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Math.max(0, Number.parseInt(retryAfterHeader, 10) || 0) * 1000
      : 0;
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    lastError = new Error(
      `Context7 request failed (${response.status}): ${payload?.message || payload?.error || response.statusText || "unknown error"}`,
    );
    if (![202, 429, 500, 503].includes(response.status) || attempt >= maxRetries - 1) {
      throw lastError;
    }
    await sleep(Math.max(retryAfterMs, 1000 * 2 ** attempt));
  }
  throw lastError || new Error("Context7 request failed.");
}

async function resolveLibraryId(fetchImpl, library, selection, apiKey) {
  if (library.libraryId) {
    return {
      libraryId: library.libraryId,
      libraryName: library.libraryName || library.libraryId,
    };
  }
  const params = new URLSearchParams({
    libraryName: library.libraryName,
    query: selection.query || library.queryHint || library.libraryName,
  });
  const results = await requestContext7(fetchImpl, `${CONTEXT7_SEARCH_URL}?${params.toString()}`, {
    apiKey,
  });
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`Context7 search returned no matches for "${library.libraryName}".`);
  }
  return {
    libraryId: cleanText(results[0]?.id),
    libraryName: cleanText(results[0]?.name) || library.libraryName,
  };
}

async function fetchLibraryContext(fetchImpl, library, selection, apiKey) {
  const resolvedLibrary = await resolveLibraryId(fetchImpl, library, selection, apiKey);
  const query = compactSingleLine(
    [selection.query, library.queryHint].filter(Boolean).join(". Focus: "),
    320,
  );
  const params = new URLSearchParams({
    libraryId: resolvedLibrary.libraryId,
    query,
    type: "txt",
  });
  const text = await requestContext7(fetchImpl, `${CONTEXT7_CONTEXT_URL}?${params.toString()}`, {
    apiKey,
    expectText: true,
  });
  return {
    libraryId: resolvedLibrary.libraryId,
    libraryName: resolvedLibrary.libraryName,
    query,
    text: String(text || "").trim(),
  };
}

export async function prefetchContext7ForSelection(
  selection,
  {
    cacheDir,
    apiKey = process.env.CONTEXT7_API_KEY || "",
    fetchImpl = globalThis.fetch,
    disabled = false,
    budget = DEFAULT_CONTEXT7_PROMPT_CHAR_BUDGET,
    ttlMs = DEFAULT_CONTEXT7_CACHE_TTL_MS,
    nowMs = Date.now(),
  } = {},
) {
  if (!selection || selection.bundleId === "none" || selection.libraries.length === 0) {
    return {
      mode: "none",
      selection,
      promptText: "",
      snippetHash: "",
      warning: "",
    };
  }
  if (disabled) {
    return {
      mode: "disabled",
      selection,
      promptText: "",
      snippetHash: "",
      warning: "Context7 prefetch disabled for this launcher run.",
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      mode: "unavailable",
      selection,
      promptText: "",
      snippetHash: "",
      warning: "Context7 fetch is unavailable in this Node runtime.",
    };
  }
  if (!apiKey) {
    return {
      mode: "missing-key",
      selection,
      promptText: "",
      snippetHash: "",
      warning: "CONTEXT7_API_KEY is not set; skipping Context7 prefetch.",
    };
  }

  ensureDirectory(cacheDir);
  const cachePath = context7CachePath(cacheDir, selection);
  const cached = readJsonOrNull(cachePath);
  const cachedAtMs = Date.parse(String(cached?.createdAt || ""));
  if (
    cached &&
    typeof cached === "object" &&
    Number.isFinite(cachedAtMs) &&
    nowMs - cachedAtMs <= ttlMs &&
    typeof cached.promptText === "string"
  ) {
    return {
      mode: "cached",
      selection,
      promptText: cached.promptText,
      snippetHash: String(cached.snippetHash || ""),
      warning: "",
    };
  }

  try {
    const results = [];
    for (const library of selection.libraries) {
      const result = await fetchLibraryContext(fetchImpl, library, selection, apiKey);
      if (result.text) {
        results.push(result);
      }
    }
    if (results.length === 0) {
      return {
        mode: "empty",
        selection,
        promptText: "",
        snippetHash: "",
        warning: `Context7 returned no promptable snippets for bundle "${selection.bundleId}".`,
      };
    }
    const promptText = renderPrefetchedContextText({ selection, results, budget });
    const snippetHash = hashText(promptText);
    writeJsonAtomic(cachePath, {
      createdAt: new Date(nowMs).toISOString(),
      promptText,
      snippetHash,
    });
    return {
      mode: "fetched",
      selection,
      promptText,
      snippetHash,
      warning: "",
    };
  } catch (error) {
    return {
      mode: "error",
      selection,
      promptText: "",
      snippetHash: "",
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export function describeContext7Libraries(selection) {
  return (selection?.libraries || [])
    .map((library) => library.libraryName || library.libraryId || "unknown-library")
    .join(", ");
}
