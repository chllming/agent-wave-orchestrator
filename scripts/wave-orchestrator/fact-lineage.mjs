import crypto from "node:crypto";
import { toIsoTimestamp } from "./shared.mjs";

// ── Fact / Evidence Entity (P2-14) ──
// End-state schema from docs/plans/end-state-architecture.md

export const FACT_KINDS = new Set([
  "claim",
  "proof",
  "observation",
  "decision",
  "evidence",
]);

export const FACT_STATUSES = new Set([
  "active",
  "superseded",
  "retracted",
]);

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
}

export function generateFactId() {
  return `fact-${crypto.randomBytes(8).toString("hex")}`;
}

function computeContentHash(content) {
  return crypto.createHash("sha256").update(String(content ?? "")).digest("hex");
}

function normalizeCitedByEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const entityType = normalizeText(raw.entityType);
  const entityId = normalizeText(raw.entityId);
  if (!entityType || !entityId) {
    return null;
  }
  return {
    entityType,
    entityId,
    context: normalizeText(raw.context),
  };
}

function normalizeCitedBy(rawCitedBy) {
  if (!Array.isArray(rawCitedBy)) {
    return [];
  }
  const result = [];
  for (const raw of rawCitedBy) {
    const entry = normalizeCitedByEntry(raw);
    if (entry) {
      result.push(entry);
    }
  }
  return result;
}

function normalizeSourceArtifact(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const path = normalizeText(raw.path);
  if (!path) {
    return null;
  }
  return {
    path,
    kind: normalizeText(raw.kind),
    sha256: normalizeText(raw.sha256),
  };
}

export function normalizeFact(raw, defaults = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Fact must be an object");
  }

  const now = toIsoTimestamp();
  const factId =
    normalizeText(raw.factId) || normalizeText(defaults.factId) || generateFactId();

  const kind = normalizeText(raw.kind) || normalizeText(defaults.kind) || "claim";
  if (!FACT_KINDS.has(kind)) {
    throw new Error(
      `kind must be one of ${[...FACT_KINDS].join(", ")} (got: ${kind})`,
    );
  }

  const content = normalizeText(raw.content, defaults.content || "");
  const contentHash = computeContentHash(content);

  const rawStatus = normalizeText(raw.status) || normalizeText(defaults.status) || "active";
  const status = FACT_STATUSES.has(rawStatus) ? rawStatus : "active";

  const version = Number.isFinite(raw.version)
    ? raw.version
    : Number.isFinite(defaults.version)
      ? defaults.version
      : 1;

  const waveNumber = Number.isFinite(raw.waveNumber)
    ? raw.waveNumber
    : Number.isFinite(defaults.waveNumber)
      ? defaults.waveNumber
      : null;
  const lane = normalizeText(raw.lane) || normalizeText(defaults.lane) || null;

  return {
    factId,
    contentHash,
    version,
    waveNumber,
    lane,
    introducedBy: normalizeText(raw.introducedBy) || normalizeText(defaults.introducedBy) || null,
    introducedAt: normalizeText(raw.introducedAt) || normalizeText(defaults.introducedAt) || now,
    kind,
    content,
    sourceArtifact: normalizeSourceArtifact(raw.sourceArtifact || defaults.sourceArtifact),
    citedBy: normalizeCitedBy(raw.citedBy || defaults.citedBy),
    contradictedBy: normalizeStringArray(raw.contradictedBy || defaults.contradictedBy),
    supersedes: normalizeText(raw.supersedes) || normalizeText(defaults.supersedes) || null,
    supersededBy: normalizeText(raw.supersededBy) || normalizeText(defaults.supersededBy) || null,
    status,
  };
}

export function buildFactLineage(coordinationRecords, proofBundles = []) {
  const facts = new Map();
  const factsByAgent = new Map();
  const recordIdToFactId = new Map();

  const safeRecords = Array.isArray(coordinationRecords) ? coordinationRecords : [];
  const safeBundles = Array.isArray(proofBundles) ? proofBundles : [];

  // Map old coordination kinds to end-state fact kinds
  function mapKind(rawKind) {
    const k = normalizeText(rawKind);
    if (k === "claim") return "claim";
    if (k === "evidence") return "evidence";
    if (k === "decision") return "decision";
    if (k === "proof-artifact" || k === "proof") return "proof";
    if (k === "observation") return "observation";
    return null; // not a fact-producing kind
  }

  // Process coordination records
  for (const record of safeRecords) {
    if (!record || typeof record !== "object") {
      continue;
    }
    const factKind = mapKind(record.kind);
    if (!factKind) {
      continue;
    }

    const agentId = normalizeText(record.agentId);
    const recordId = normalizeText(record.id);
    const content = normalizeText(record.detail || record.summary);

    const fact = normalizeFact({
      kind: factKind,
      content,
      introducedBy: agentId || null,
      introducedAt: normalizeText(record.createdAt) || undefined,
      sourceRecordId: recordId || null,
      citedBy: [],
      contradictedBy: [],
      status: "active",
    });

    facts.set(fact.factId, fact);

    if (recordId) {
      recordIdToFactId.set(recordId, fact.factId);
    }

    if (agentId) {
      if (!factsByAgent.has(agentId)) {
        factsByAgent.set(agentId, []);
      }
      factsByAgent.get(agentId).push(fact.factId);
    }
  }

  // Process proof bundles
  for (const bundle of safeBundles) {
    if (!bundle || typeof bundle !== "object") {
      continue;
    }

    const agentId = normalizeText(bundle.agentId);
    const artifacts = Array.isArray(bundle.artifacts) ? bundle.artifacts : [];

    for (const artifact of artifacts) {
      if (!artifact || typeof artifact !== "object") {
        continue;
      }

      const artifactPath = normalizeText(artifact.path);
      const fact = normalizeFact({
        kind: "proof",
        content: artifactPath || normalizeText(bundle.detail || bundle.summary),
        introducedBy: agentId || null,
        introducedAt: normalizeText(bundle.recordedAt) || undefined,
        sourceArtifact: artifactPath
          ? { path: artifactPath, kind: normalizeText(artifact.kind), sha256: normalizeText(artifact.sha256) }
          : null,
        citedBy: [],
        contradictedBy: [],
        status: "active",
      });

      facts.set(fact.factId, fact);

      if (agentId) {
        if (!factsByAgent.has(agentId)) {
          factsByAgent.set(agentId, []);
        }
        factsByAgent.get(agentId).push(fact.factId);
      }
    }

    // If a proof bundle has no artifacts, create a fact for the bundle itself
    if (artifacts.length === 0) {
      const fact = normalizeFact({
        kind: "proof",
        content: normalizeText(bundle.detail || bundle.summary),
        introducedBy: agentId || null,
        introducedAt: normalizeText(bundle.recordedAt) || undefined,
        citedBy: [],
        contradictedBy: [],
        status: "active",
      });

      facts.set(fact.factId, fact);

      if (agentId) {
        if (!factsByAgent.has(agentId)) {
          factsByAgent.set(agentId, []);
        }
        factsByAgent.get(agentId).push(fact.factId);
      }
    }
  }

  // Cross-reference: if a record's dependsOn references another record's id, add citation
  for (const record of safeRecords) {
    if (!record || typeof record !== "object") {
      continue;
    }
    const dependsOn = Array.isArray(record.dependsOn) ? record.dependsOn : [];
    const thisRecordId = normalizeText(record.id);
    const thisFactId = thisRecordId ? recordIdToFactId.get(thisRecordId) : null;
    if (!thisFactId) {
      continue;
    }

    for (const depId of dependsOn) {
      const depFactId = recordIdToFactId.get(normalizeText(depId));
      if (!depFactId) {
        continue;
      }
      const depFact = facts.get(depFactId);
      if (!depFact) {
        continue;
      }
      const citingAgent = normalizeText(record.agentId);
      if (citingAgent) {
        // Add as structured citation
        const alreadyCited = depFact.citedBy.some(
          (c) => c.entityType === "agent" && c.entityId === citingAgent,
        );
        if (!alreadyCited) {
          depFact.citedBy.push({
            entityType: "agent",
            entityId: citingAgent,
            context: `depends on ${depId}`,
          });
        }
      }
    }
  }

  return { facts, factsByAgent };
}

export function addCitation(factMap, factId, citation) {
  if (!(factMap instanceof Map)) {
    throw new Error("factMap must be a Map");
  }
  const fact = factMap.get(factId);
  if (!fact) {
    throw new Error(`Fact not found: ${factId}`);
  }

  // Support both structured citation object and simple string (agentId)
  let entry;
  if (typeof citation === "string") {
    const agentStr = normalizeText(citation);
    if (!agentStr) {
      throw new Error("citation is required");
    }
    entry = { entityType: "agent", entityId: agentStr, context: "" };
  } else if (citation && typeof citation === "object") {
    entry = normalizeCitedByEntry(citation);
    if (!entry) {
      throw new Error("citation must have entityType and entityId");
    }
  } else {
    throw new Error("citation is required");
  }

  const alreadyCited = fact.citedBy.some(
    (c) => c.entityType === entry.entityType && c.entityId === entry.entityId,
  );
  if (!alreadyCited) {
    fact.citedBy.push(entry);
  }
  return fact;
}

export function markContradicted(factMap, factId, contradictionId) {
  if (!(factMap instanceof Map)) {
    throw new Error("factMap must be a Map");
  }
  const fact = factMap.get(factId);
  if (!fact) {
    throw new Error(`Fact not found: ${factId}`);
  }
  const cId = normalizeText(contradictionId);
  if (cId && !fact.contradictedBy.includes(cId)) {
    fact.contradictedBy.push(cId);
  }
  return fact;
}

export function markSuperseded(factMap, factId, supersedingFactId) {
  if (!(factMap instanceof Map)) {
    throw new Error("factMap must be a Map");
  }
  const fact = factMap.get(factId);
  if (!fact) {
    throw new Error(`Fact not found: ${factId}`);
  }
  fact.supersededBy = normalizeText(supersedingFactId) || null;
  fact.status = "superseded";
  return fact;
}

export function retractFact(factMap, factId) {
  if (!(factMap instanceof Map)) {
    throw new Error("factMap must be a Map");
  }
  const fact = factMap.get(factId);
  if (!fact) {
    throw new Error(`Fact not found: ${factId}`);
  }
  fact.status = "retracted";
  return fact;
}

export function refineFact(factMap, factId, newContent) {
  if (!(factMap instanceof Map)) {
    throw new Error("factMap must be a Map");
  }
  const fact = factMap.get(factId);
  if (!fact) {
    throw new Error(`Fact not found: ${factId}`);
  }
  fact.content = normalizeText(newContent, fact.content);
  fact.contentHash = computeContentHash(fact.content);
  fact.version = (fact.version || 1) + 1;
  return fact;
}

export function activeFacts(factMap) {
  if (!(factMap instanceof Map)) {
    return [];
  }
  const result = [];
  for (const fact of factMap.values()) {
    if (fact.status === "active") {
      result.push(fact);
    }
  }
  return result;
}

export function factsForGate(factMap, gateName) {
  if (!(factMap instanceof Map) || !gateName) {
    return [];
  }
  const result = [];
  for (const fact of factMap.values()) {
    // Check citedBy for gate references
    if (
      Array.isArray(fact.citedBy) &&
      fact.citedBy.some(
        (c) => c.entityType === "gate" && c.entityId === gateName,
      )
    ) {
      result.push(fact);
    }
  }
  return result;
}

export function factLineageSummary(factMap) {
  if (!(factMap instanceof Map)) {
    return {
      totalFacts: 0,
      activeFacts: 0,
      supersededFacts: 0,
      retractedFacts: 0,
      contradictedFacts: 0,
      citationCount: 0,
    };
  }

  let total = 0;
  let activeCount = 0;
  let supersededCount = 0;
  let retractedCount = 0;
  let contradictedCount = 0;
  let citationCount = 0;

  for (const fact of factMap.values()) {
    total++;
    if (fact.status === "active") {
      activeCount++;
    }
    if (fact.status === "superseded") {
      supersededCount++;
    }
    if (fact.status === "retracted") {
      retractedCount++;
    }
    if (Array.isArray(fact.contradictedBy) && fact.contradictedBy.length > 0) {
      contradictedCount++;
    }
    citationCount += Array.isArray(fact.citedBy) ? fact.citedBy.length : 0;
  }

  return {
    totalFacts: total,
    activeFacts: activeCount,
    supersededFacts: supersededCount,
    retractedFacts: retractedCount,
    contradictedFacts: contradictedCount,
    citationCount,
  };
}
