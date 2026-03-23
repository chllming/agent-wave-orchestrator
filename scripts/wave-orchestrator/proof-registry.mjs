import fs from "node:fs";
import path from "node:path";
import {
  readProofRegistry,
  writeProofRegistry,
} from "./artifact-schemas.mjs";
import {
  appendWaveControlEvent,
  readWaveControlPlaneState,
  syncWaveControlPlaneProjections,
} from "./control-plane.mjs";
import { REPO_ROOT, ensureDirectory, hashText, toIsoTimestamp } from "./shared.mjs";

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeArray(values) {
  return Array.isArray(values) ? values : [];
}

function matchingDeclaredProofArtifact(agent, artifactPath) {
  return safeArray(agent?.proofArtifacts).find((artifact) => artifact?.path === artifactPath) || null;
}

function absoluteArtifactPath(repoRelativePath) {
  return path.resolve(REPO_ROOT, String(repoRelativePath || ""));
}

function buildProofArtifactRecord(agent, artifactPath) {
  const declared = matchingDeclaredProofArtifact(agent, artifactPath);
  const absolutePath = absoluteArtifactPath(artifactPath);
  const exists = fs.existsSync(absolutePath);
  return {
    path: artifactPath,
    kind: declared?.kind || null,
    requiredFor: safeArray(declared?.requiredFor),
    exists,
    sha256: exists ? hashText(fs.readFileSync(absolutePath, "utf8")) : null,
  };
}

function normalizeRegisteredComponent(agent, componentInput, detail = null) {
  const normalized = String(componentInput || "").trim();
  if (!normalized) {
    return null;
  }
  const [componentId, explicitLevel = ""] = normalized.split(":", 2);
  const cleanComponentId = String(componentId || "").trim();
  if (!cleanComponentId) {
    return null;
  }
  return {
    componentId: cleanComponentId,
    level: String(explicitLevel || "").trim() || agent?.componentTargets?.[cleanComponentId] || null,
    state: "met",
    detail: String(detail || "").trim() || null,
  };
}

function ensureDeliverableState(agent, summary) {
  const deliverables = safeArray(agent?.deliverables);
  if (deliverables.length === 0) {
    return summary;
  }
  const current = new Map(
    safeArray(summary.deliverables).map((item) => [item.path, item]),
  );
  for (const deliverablePath of deliverables) {
    const existing = current.get(deliverablePath);
    if (existing?.exists === true) {
      continue;
    }
    current.set(deliverablePath, {
      path: deliverablePath,
      exists: fs.existsSync(absoluteArtifactPath(deliverablePath)),
    });
  }
  summary.deliverables = Array.from(current.values());
  return summary;
}

function mergeComponents(summary, components) {
  const current = new Map(
    safeArray(summary.components).map((item) => [item.componentId, item]),
  );
  for (const component of components) {
    if (!component?.componentId) {
      continue;
    }
    const existing = current.get(component.componentId) || {};
    current.set(component.componentId, {
      componentId: component.componentId,
      level: component.level || existing.level || null,
      state: component.state || existing.state || "met",
      detail: component.detail || existing.detail || "",
    });
  }
  summary.components = Array.from(current.values());
  return summary;
}

function mergeProofArtifacts(summary, artifacts) {
  const current = new Map(
    safeArray(summary.proofArtifacts).map((item) => [item.path, item]),
  );
  for (const artifact of artifacts) {
    if (!artifact?.path) {
      continue;
    }
    const existing = current.get(artifact.path) || {};
    current.set(artifact.path, {
      path: artifact.path,
      kind: artifact.kind || existing.kind || null,
      exists: artifact.exists === true || existing.exists === true,
      requiredFor: safeArray(artifact.requiredFor).length > 0
        ? safeArray(artifact.requiredFor)
        : safeArray(existing.requiredFor),
      sha256: artifact.sha256 || existing.sha256 || null,
    });
  }
  summary.proofArtifacts = Array.from(current.values());
  return summary;
}

function latestAuthoritativeEntry(proofRegistry, agentId) {
  return safeArray(proofRegistry?.entries)
    .filter(
      (entry) =>
        entry?.authoritative === true &&
        entry?.agentId === agentId &&
        !["revoked", "superseded"].includes(String(entry?.state || "").trim().toLowerCase()),
    )
    .sort((left, right) => Date.parse(left.recordedAt || "") - Date.parse(right.recordedAt || ""))
    .at(-1) || null;
}

export function waveProofRegistryPath(lanePaths, waveNumber) {
  return path.join(lanePaths.proofDir, `wave-${waveNumber}.json`);
}

export function readWaveProofRegistry(lanePaths, waveNumber) {
  const controlState = readWaveControlPlaneState(lanePaths, waveNumber);
  if (controlState.proofBundles.length === 0) {
    return readProofRegistry(waveProofRegistryPath(lanePaths, waveNumber), {
      lane: lanePaths?.lane || null,
      wave: waveNumber,
    });
  }
  const registry = syncWaveControlPlaneProjections(
    lanePaths,
    waveNumber,
    controlState,
  ).proofRegistry;
  return registry || readProofRegistry(waveProofRegistryPath(lanePaths, waveNumber), {
    lane: lanePaths?.lane || null,
    wave: waveNumber,
  });
}

export function writeWaveProofRegistry(lanePaths, waveNumber, payload) {
  const filePath = waveProofRegistryPath(lanePaths, waveNumber);
  ensureDirectory(path.dirname(filePath));
  return writeProofRegistry(filePath, payload, {
    lane: lanePaths?.lane || null,
    wave: waveNumber,
  });
}

export function registerWaveProofBundle({
  lanePaths,
  wave,
  agent,
  artifactPaths = [],
  componentIds = [],
  authoritative = false,
  satisfyOwnedComponents = false,
  completion = null,
  durability = null,
  proofLevel = null,
  docDeltaState = null,
  detail = "",
  recordedBy = "human-operator",
}) {
  const recordedAt = toIsoTimestamp();
  const normalizedArtifacts = Array.from(
    new Set(safeArray(artifactPaths).map((value) => String(value || "").trim()).filter(Boolean)),
  ).map((artifactPath) => buildProofArtifactRecord(agent, artifactPath));
  const normalizedComponents = [
    ...safeArray(componentIds).map((componentId) =>
      normalizeRegisteredComponent(agent, componentId, detail),
    ),
    ...(satisfyOwnedComponents
      ? safeArray(agent?.components).map((componentId) =>
          normalizeRegisteredComponent(agent, componentId, detail),
        )
      : []),
  ].filter((component, index, values) =>
    component && values.findIndex((other) => other?.componentId === component.componentId) === index,
  );
  const entry = {
    id: `proof-${agent.agentId}-${recordedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    agentId: agent.agentId,
    authoritative,
    recordedAt,
    recordedBy,
    detail: String(detail || "").trim() || null,
    summary: authoritative
      ? `Authoritative proof bundle registered for ${agent.agentId}`
      : `Proof bundle registered for ${agent.agentId}`,
    satisfyOwnedComponents,
    proof:
      completion || durability || proofLevel || authoritative
        ? {
            state: "met",
            completion: completion || agent?.exitContract?.completion || null,
            durability: durability || agent?.exitContract?.durability || null,
            proof: proofLevel || agent?.exitContract?.proof || null,
            detail: String(detail || "").trim() || null,
          }
        : null,
    docDelta: docDeltaState
      ? {
          state: docDeltaState,
          detail: String(detail || "").trim() || null,
        }
      : null,
    components: normalizedComponents,
    artifacts: normalizedArtifacts,
  };
  appendWaveControlEvent(lanePaths, wave.wave, {
    entityType: "proof_bundle",
    entityId: entry.id,
    action: "registered",
    source: "operator",
    actor: recordedBy,
    data: {
      proofBundleId: entry.id,
      agentId: entry.agentId,
      state: "active",
      authoritative: entry.authoritative,
      recordedAt: entry.recordedAt,
      recordedBy: entry.recordedBy,
      detail: entry.detail,
      summary: entry.summary,
      satisfyOwnedComponents: entry.satisfyOwnedComponents,
      proof: entry.proof,
      docDelta: entry.docDelta,
      components: entry.components,
      artifacts: entry.artifacts,
      scope: "wave",
      satisfies: normalizedComponents.map((component) => component.componentId),
    },
  });
  const normalized = syncWaveControlPlaneProjections(
    lanePaths,
    wave.wave,
    readWaveControlPlaneState(lanePaths, wave.wave),
  ).proofRegistry;
  return {
    registry: normalized,
    entry: cloneJson(entry),
  };
}

export function augmentSummaryWithProofRegistry(agent, summary, proofRegistry) {
  const authoritativeEntry = latestAuthoritativeEntry(proofRegistry, agent?.agentId);
  if (!authoritativeEntry) {
    return summary;
  }
  const next = cloneJson(summary) || {
    agentId: agent?.agentId || null,
  };
  if (authoritativeEntry.proof?.state === "met") {
    next.proof = {
      completion:
        authoritativeEntry.proof.completion ||
        next.proof?.completion ||
        agent?.exitContract?.completion ||
        null,
      durability:
        authoritativeEntry.proof.durability ||
        next.proof?.durability ||
        agent?.exitContract?.durability ||
        null,
      proof:
        authoritativeEntry.proof.proof ||
        next.proof?.proof ||
        agent?.exitContract?.proof ||
        null,
      state: "met",
      detail:
        authoritativeEntry.proof.detail ||
        next.proof?.detail ||
        "Satisfied by authoritative proof registry.",
    };
  }
  if (authoritativeEntry.docDelta) {
    next.docDelta = cloneJson(authoritativeEntry.docDelta);
  }
  mergeProofArtifacts(next, authoritativeEntry.artifacts);
  if (authoritativeEntry.satisfyOwnedComponents || safeArray(authoritativeEntry.components).length > 0) {
    mergeComponents(
      next,
      safeArray(authoritativeEntry.components).length > 0
        ? authoritativeEntry.components
        : safeArray(agent?.components).map((componentId) => ({
            componentId,
            level: agent?.componentTargets?.[componentId] || null,
            state: "met",
            detail: authoritativeEntry.detail || "",
          })),
    );
  }
  ensureDeliverableState(agent, next);
  return next;
}
