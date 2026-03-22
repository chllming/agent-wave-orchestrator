import { readJsonOrNull, toIsoTimestamp, writeJsonAtomic } from "./shared.mjs";

export function buildDocsQueue({
  lane,
  wave,
  summariesByAgentId = {},
  sharedPlanDocs = [],
  componentPromotions = [],
  runtimeAssignments = [],
}) {
  const waveNumber =
    typeof wave === "object" && wave !== null && Object.hasOwn(wave, "wave") ? wave.wave : wave;
  const items = [];
  for (const [agentId, summary] of Object.entries(summariesByAgentId || {})) {
    if (!summary?.docDelta) {
      continue;
    }
    if (summary.docDelta.state === "owned") {
      for (const docPath of summary.docDelta.paths || []) {
        items.push({
          id: `${agentId}:owned:${docPath}`,
          kind: "owned-doc",
          agentId,
          ownerAgentId: agentId,
          path: docPath,
          summary: `Owned documentation update required in ${docPath}`,
          detail: summary.docDelta.detail || "",
          targets: [agentId],
        });
      }
    }
    if (summary.docDelta.state === "shared-plan") {
      const sharedPlanPaths =
        Array.isArray(summary.docDelta.paths) && summary.docDelta.paths.length > 0
          ? summary.docDelta.paths
          : sharedPlanDocs;
      for (const docPath of sharedPlanPaths) {
        items.push({
          id: `${agentId}:shared:${docPath}`,
          kind: "shared-plan",
          agentId,
          ownerAgentId: null,
          path: docPath,
          summary: `Shared-plan reconciliation required in ${docPath}`,
          detail: summary.docDelta.detail || "",
          targets: [],
        });
      }
    }
  }
  for (const promotion of componentPromotions || []) {
    items.push({
      id: `component-matrix:${promotion.componentId}`,
      kind: "component-matrix",
      agentId: null,
      ownerAgentId: null,
      path: promotion.componentId,
      summary: `Component matrix currentLevel must reflect ${promotion.componentId} -> ${promotion.targetLevel}`,
      detail: "",
      targets: [],
    });
  }
  const releaseNotesRequired = items.some((item) => item.kind === "shared-plan");
  return {
    lane,
    wave: waveNumber,
    createdAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
    releaseNotesRequired,
    runtimeAssignments,
    items,
  };
}

export function writeDocsQueue(filePath, payload) {
  writeJsonAtomic(filePath, payload);
}

export function readDocsQueue(filePath) {
  return readJsonOrNull(filePath);
}
