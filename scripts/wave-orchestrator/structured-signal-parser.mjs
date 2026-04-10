const STRUCTURED_SIGNAL_LINE_REGEX = /^\[wave-[a-z0-9-]+(?:\]|\s|=|$).*$/i;
const WRAPPED_STRUCTURED_SIGNAL_LINE_REGEX = /^`\[wave-[^`]+`$/;
const STRUCTURED_SIGNAL_LIST_PREFIX_REGEX = /^(?:[-*+]|\d+\.)\s+/;
const TAG_MATCH_REGEX = /^\[wave-([a-z0-9-]+)\](.*)$/i;
const KEY_START_REGEX = /(^|\s)([a-z][a-z0-9_-]*)=/gi;

const KIND_BY_TAG = {
  proof: "proof",
  "doc-delta": "docDelta",
  "doc-closure": "docClosure",
  integration: "integration",
  eval: "eval",
  security: "security",
  design: "design",
  gate: "gate",
  gap: "gap",
  component: "component",
};

function cleanText(value) {
  return String(value || "").trim();
}

function parseCsv(value) {
  return cleanText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntValue(value) {
  return Number.parseInt(String(value || "0"), 10) || 0;
}

const SIGNAL_SPECS = {
  proof: {
    requiredKeys: ["completion", "durability", "proof", "state"],
    orderedKeys: ["completion", "durability", "proof", "state", "detail"],
    normalize(values) {
      const normalizedState = cleanText(values.state).toLowerCase() === "complete" ? "met" : cleanText(values.state).toLowerCase();
      const completion = cleanText(values.completion).toLowerCase();
      const durability = cleanText(values.durability).toLowerCase();
      const proof = cleanText(values.proof).toLowerCase();
      if (!["contract", "integrated", "authoritative", "live"].includes(completion)) {
        return null;
      }
      if (!["none", "ephemeral", "durable"].includes(durability)) {
        return null;
      }
      if (!["unit", "integration", "live"].includes(proof)) {
        return null;
      }
      if (!["met", "gap"].includes(normalizedState)) {
        return null;
      }
      return {
        values: {
          completion,
          durability,
          proof,
          state: normalizedState,
          detail: cleanText(values.detail),
        },
      };
    },
  },
  docDelta: {
    requiredKeys: ["state"],
    orderedKeys: ["state", "paths", "detail"],
    normalize(values) {
      const state = cleanText(values.state).toLowerCase();
      if (!["none", "owned", "shared-plan"].includes(state)) {
        return null;
      }
      return {
        values: {
          state,
          paths: parseCsv(values.paths).join(","),
          detail: cleanText(values.detail),
        },
      };
    },
  },
  docClosure: {
    requiredKeys: ["state"],
    orderedKeys: ["state", "paths", "detail"],
    normalize(values) {
      const state = cleanText(values.state).toLowerCase();
      if (!["closed", "no-change", "delta"].includes(state)) {
        return null;
      }
      return {
        values: {
          state,
          paths: parseCsv(values.paths).join(","),
          detail: cleanText(values.detail),
        },
      };
    },
  },
  integration: {
    requiredKeys: ["state", "claims", "conflicts", "blockers"],
    orderedKeys: ["state", "claims", "conflicts", "blockers", "detail"],
    normalize(values) {
      const state = cleanText(values.state).toLowerCase();
      if (!["ready-for-doc-closure", "needs-more-work"].includes(state)) {
        return null;
      }
      return {
        values: {
          state,
          claims: String(parseIntValue(values.claims)),
          conflicts: String(parseIntValue(values.conflicts)),
          blockers: String(parseIntValue(values.blockers)),
          detail: cleanText(values.detail),
        },
      };
    },
  },
  eval: {
    requiredKeys: ["state", "targets", "benchmarks", "regressions"],
    orderedKeys: ["state", "targets", "benchmarks", "regressions", "target_ids", "benchmark_ids", "detail"],
    normalize(values) {
      const state = cleanText(values.state).toLowerCase();
      if (!["satisfied", "needs-more-work", "blocked"].includes(state)) {
        return null;
      }
      return {
        values: {
          state,
          targets: String(parseIntValue(values.targets)),
          benchmarks: String(parseIntValue(values.benchmarks)),
          regressions: String(parseIntValue(values.regressions)),
          target_ids: parseCsv(values.target_ids).join(","),
          benchmark_ids: parseCsv(values.benchmark_ids).join(","),
          detail: cleanText(values.detail),
        },
      };
    },
  },
  security: {
    requiredKeys: ["state", "findings", "approvals"],
    orderedKeys: ["state", "findings", "approvals", "detail"],
    normalize(values) {
      const state = cleanText(values.state).toLowerCase();
      if (!["clear", "concerns", "blocked"].includes(state)) {
        return null;
      }
      return {
        values: {
          state,
          findings: String(parseIntValue(values.findings)),
          approvals: String(parseIntValue(values.approvals)),
          detail: cleanText(values.detail),
        },
      };
    },
  },
  design: {
    requiredKeys: ["state", "decisions", "assumptions", "open_questions"],
    orderedKeys: ["state", "decisions", "assumptions", "open_questions", "detail"],
    normalize(values) {
      const state = cleanText(values.state).toLowerCase();
      if (!["ready-for-implementation", "needs-clarification", "blocked"].includes(state)) {
        return null;
      }
      return {
        values: {
          state,
          decisions: String(parseIntValue(values.decisions)),
          assumptions: String(parseIntValue(values.assumptions)),
          open_questions: String(parseIntValue(values.open_questions)),
          detail: cleanText(values.detail),
        },
      };
    },
  },
  gate: {
    requiredKeys: ["architecture", "integration", "durability", "live", "docs"],
    orderedKeys: ["architecture", "integration", "durability", "live", "docs", "detail"],
    normalize(values) {
      const allowed = new Set(["pass", "concerns", "blocked", "gap"]);
      const normalized = {
        architecture: cleanText(values.architecture).toLowerCase(),
        integration: cleanText(values.integration).toLowerCase(),
        durability: cleanText(values.durability).toLowerCase(),
        live: cleanText(values.live).toLowerCase(),
        docs: cleanText(values.docs).toLowerCase(),
        detail: cleanText(values.detail),
      };
      if (![normalized.architecture, normalized.integration, normalized.durability, normalized.live, normalized.docs].every((value) => allowed.has(value))) {
        return null;
      }
      return { values: normalized };
    },
  },
  gap: {
    requiredKeys: ["kind"],
    orderedKeys: ["kind", "detail"],
    normalize(values) {
      const kind = cleanText(values.kind).toLowerCase();
      if (!["architecture", "integration", "durability", "ops", "docs"].includes(kind)) {
        return null;
      }
      return {
        values: {
          kind,
          detail: cleanText(values.detail),
        },
      };
    },
  },
  component: {
    requiredKeys: ["component", "level", "state"],
    orderedKeys: ["component", "level", "state", "detail"],
    normalize(values) {
      const component = cleanText(values.component);
      const level = cleanText(values.level).toLowerCase();
      const state = cleanText(values.state).toLowerCase() === "complete" ? "met" : cleanText(values.state).toLowerCase();
      if (!component || !level || !["met", "gap"].includes(state)) {
        return null;
      }
      return {
        values: {
          component,
          level,
          state,
          detail: cleanText(values.detail),
        },
      };
    },
  },
};

function buildEmptyStructuredSignalDiagnostics() {
  return {
    proof: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    docDelta: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    docClosure: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    integration: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    eval: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    security: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    design: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    gate: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    gap: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [] },
    component: { rawCount: 0, acceptedCount: 0, normalizedCount: 0, rejectedCount: 0, rejectedSamples: [], normalizedSamples: [], unknownKeysSeen: [], seenComponentIds: [] },
  };
}

function pushLimited(list, value, limit = 3) {
  if (!value || list.length >= limit) {
    return;
  }
  list.push(value);
}

export function normalizeStructuredSignalLine(line) {
  const trimmed = cleanText(line);
  if (!trimmed) {
    return null;
  }
  const withoutListPrefix = trimmed.replace(STRUCTURED_SIGNAL_LIST_PREFIX_REGEX, "").trim();
  if (STRUCTURED_SIGNAL_LINE_REGEX.test(withoutListPrefix)) {
    return withoutListPrefix;
  }
  if (WRAPPED_STRUCTURED_SIGNAL_LINE_REGEX.test(withoutListPrefix)) {
    return withoutListPrefix.slice(1, -1).trim();
  }
  return null;
}

function parseKeyValues(body) {
  const matches = Array.from(String(body || "").matchAll(KEY_START_REGEX));
  const values = {};
  if (matches.length === 0) {
    return values;
  }
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const key = String(match[2] || "").toLowerCase();
    const keyStart = match.index + match[1].length;
    const valueStart = keyStart + key.length + 1;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index + matches[index + 1][1].length : String(body || "").length;
    values[key] = cleanText(String(body || "").slice(valueStart, nextStart));
  }
  return values;
}

function buildCanonicalLine(tag, orderedKeys, values) {
  const parts = [`[wave-${tag}]`];
  for (const key of orderedKeys) {
    const value = cleanText(values[key]);
    if (!value) {
      continue;
    }
    parts.push(`${key}=${value}`);
  }
  return parts.join(" ").trim();
}

export function parseStructuredSignalCandidate(line) {
  const rawLine = cleanText(line);
  if (!rawLine) {
    return null;
  }
  const canonicalLine = normalizeStructuredSignalLine(rawLine);
  if (!canonicalLine) {
    return null;
  }
  const tagMatch = canonicalLine.match(TAG_MATCH_REGEX);
  if (!tagMatch) {
    return null;
  }
  const tag = cleanText(tagMatch[1]).toLowerCase();
  const kind = KIND_BY_TAG[tag] || null;
  const body = cleanText(tagMatch[2]);
  const rawValues = parseKeyValues(body);
  const spec = kind ? SIGNAL_SPECS[kind] : null;
  const unknownKeys = spec
    ? Object.keys(rawValues).filter((key) => !spec.orderedKeys.includes(key))
    : Object.keys(rawValues);
  let normalizedLine = canonicalLine;
  let normalized = false;
  let accepted = false;
  let componentId = cleanText(rawValues.component || "");
  if (spec) {
    const requiredPresent = spec.requiredKeys.every((key) => cleanText(rawValues[key]));
    if (requiredPresent) {
      const parsed = spec.normalize(rawValues);
      if (parsed?.values) {
        accepted = true;
        normalizedLine = buildCanonicalLine(tag, spec.orderedKeys, parsed.values);
        normalized = normalizedLine !== canonicalLine;
        if (kind === "component") {
          componentId = cleanText(parsed.values.component || componentId);
        }
      }
    }
  }
  return {
    rawLine,
    canonicalLine,
    normalizedLine,
    normalized,
    accepted,
    tag,
    kind,
    rawValues,
    unknownKeys,
    componentId: componentId || null,
  };
}

function appendParsedStructuredSignalCandidates(lines, candidates, { requireAll = false } = {}) {
  const parsedCandidates = [];
  for (const line of lines || []) {
    const candidate = parseStructuredSignalCandidate(line);
    if (candidate) {
      parsedCandidates.push(candidate);
      continue;
    }
    if (requireAll) {
      return;
    }
  }
  candidates.push(...parsedCandidates);
}

function collectEmbeddedStructuredSignalTexts(value, texts) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEmbeddedStructuredSignalTexts(item, texts);
    }
    return;
  }
  if (typeof value.text === "string") {
    texts.push(value.text);
  }
  if (typeof value.aggregated_output === "string") {
    texts.push(value.aggregated_output);
  }
  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === "object") {
      collectEmbeddedStructuredSignalTexts(nestedValue, texts);
    }
  }
}

function extractEmbeddedStructuredSignalTextsFromJsonLine(line) {
  const trimmed = cleanText(line);
  if (!trimmed || !/^[{\[]/.test(trimmed)) {
    return [];
  }
  try {
    const payload = JSON.parse(trimmed);
    const texts = [];
    collectEmbeddedStructuredSignalTexts(payload, texts);
    return texts.filter(Boolean);
  } catch {
    return [];
  }
}

export function collectStructuredSignalCandidates(text) {
  if (!text) {
    return [];
  }
  const candidates = [];
  let fenceLines = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const embeddedTexts = extractEmbeddedStructuredSignalTextsFromJsonLine(rawLine);
    for (const embeddedText of embeddedTexts) {
      candidates.push(...collectStructuredSignalCandidates(embeddedText));
    }
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      if (fenceLines === null) {
        fenceLines = [];
        continue;
      }
      appendParsedStructuredSignalCandidates(fenceLines, candidates, { requireAll: true });
      fenceLines = null;
      continue;
    }
    if (fenceLines !== null) {
      if (!trimmed) {
        continue;
      }
      fenceLines.push(rawLine);
      continue;
    }
    const candidate = parseStructuredSignalCandidate(rawLine);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  if (fenceLines !== null) {
    appendParsedStructuredSignalCandidates(fenceLines, candidates);
  }
  return candidates;
}

export function buildStructuredSignalDiagnostics(candidates) {
  const diagnostics = buildEmptyStructuredSignalDiagnostics();
  for (const candidate of candidates || []) {
    if (!candidate?.kind || !diagnostics[candidate.kind]) {
      continue;
    }
    const bucket = diagnostics[candidate.kind];
    bucket.rawCount += 1;
    if (candidate.kind === "component" && candidate.componentId) {
      bucket.seenComponentIds.push(candidate.componentId);
    }
    for (const unknownKey of candidate.unknownKeys || []) {
      if (!bucket.unknownKeysSeen.includes(unknownKey)) {
        bucket.unknownKeysSeen.push(unknownKey);
      }
    }
    if (candidate.accepted) {
      bucket.acceptedCount += 1;
      if (candidate.normalized) {
        bucket.normalizedCount += 1;
        pushLimited(bucket.normalizedSamples, {
          from: candidate.rawLine,
          to: candidate.normalizedLine,
        });
      }
      continue;
    }
    bucket.rejectedCount += 1;
    pushLimited(bucket.rejectedSamples, {
      line: candidate.rawLine,
      rawValues: candidate.rawValues,
      unknownKeys: candidate.unknownKeys,
      ...(candidate.kind === "component" && candidate.componentId ? { componentId: candidate.componentId } : {}),
    });
  }
  diagnostics.component.seenComponentIds = Array.from(new Set(diagnostics.component.seenComponentIds)).sort();
  for (const bucket of Object.values(diagnostics)) {
    if (Array.isArray(bucket.unknownKeysSeen)) {
      bucket.unknownKeysSeen.sort();
    }
  }
  return diagnostics;
}

export function extractStructuredSignalPayload(text) {
  const candidates = collectStructuredSignalCandidates(text);
  return {
    signalText: candidates
      .filter((candidate) => candidate.accepted)
      .map((candidate) => candidate.normalizedLine)
      .join("\n"),
    diagnostics: buildStructuredSignalDiagnostics(candidates),
  };
}
