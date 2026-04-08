function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function sortByRecordedAt(events) {
  return [...(events || [])].sort((left, right) => {
    const timeDiff = Date.parse(left.recordedAt || "") - Date.parse(right.recordedAt || "");
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  return groups;
}

function runKey(event) {
  const identity = event.identity || {};
  return JSON.stringify({
    workspaceId: identity.workspaceId || "",
    projectId: identity.projectId || "",
    runKind: identity.runKind || "",
    runId: identity.runId || "",
    lane: identity.lane || "",
    wave: identity.wave ?? null,
    orchestratorId: identity.orchestratorId || "",
    runtimeVersion: identity.runtimeVersion || "",
  });
}

function benchmarkRunKey(event) {
  const identity = event.identity || {};
  return JSON.stringify({
    workspaceId: identity.workspaceId || "",
    projectId: identity.projectId || "",
    runKind: identity.runKind || "",
    runId: identity.runId || "",
    lane: identity.lane || "",
    wave: identity.wave ?? null,
    benchmarkRunId: identity.benchmarkRunId || "",
    orchestratorId: identity.orchestratorId || "",
    runtimeVersion: identity.runtimeVersion || "",
  });
}

function matchesRunFilters(event, filters = {}) {
  const identity = event.identity || {};
  if (filters.workspaceId && identity.workspaceId !== filters.workspaceId) {
    return false;
  }
  if (filters.projectId && identity.projectId !== filters.projectId) {
    return false;
  }
  if (filters.runKind && identity.runKind !== filters.runKind) {
    return false;
  }
  if (filters.runId && identity.runId !== filters.runId) {
    return false;
  }
  if (filters.lane && identity.lane !== filters.lane) {
    return false;
  }
  if (filters.wave != null && Number(identity.wave) !== Number(filters.wave)) {
    return false;
  }
  if (filters.orchestratorId && identity.orchestratorId !== filters.orchestratorId) {
    return false;
  }
  if (filters.runtimeVersion && identity.runtimeVersion !== filters.runtimeVersion) {
    return false;
  }
  return true;
}

function matchesBenchmarkFilters(event, filters = {}) {
  const identity = event.identity || {};
  if (filters.workspaceId && identity.workspaceId !== filters.workspaceId) {
    return false;
  }
  if (filters.projectId && identity.projectId !== filters.projectId) {
    return false;
  }
  if (filters.runKind && identity.runKind !== filters.runKind) {
    return false;
  }
  if (filters.runId && identity.runId !== filters.runId) {
    return false;
  }
  if (filters.lane && identity.lane !== filters.lane) {
    return false;
  }
  if (filters.wave != null && Number(identity.wave) !== Number(filters.wave)) {
    return false;
  }
  if (filters.benchmarkRunId && identity.benchmarkRunId !== filters.benchmarkRunId) {
    return false;
  }
  if (filters.orchestratorId && identity.orchestratorId !== filters.orchestratorId) {
    return false;
  }
  if (filters.runtimeVersion && identity.runtimeVersion !== filters.runtimeVersion) {
    return false;
  }
  return true;
}

function latestEventByEntity(events, entityType) {
  return sortByRecordedAt(events).filter((event) => event.entityType === entityType).at(-1) || null;
}

function distinctValues(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function countByValue(values, fallback = "unknown") {
  const counts = {};
  for (const value of values || []) {
    const normalized = cleanText(value, fallback);
    counts[normalized] = (counts[normalized] || 0) + 1;
  }
  return counts;
}

function latestTimestamp(values) {
  return (values || []).reduce((latest, value) => {
    const normalized = cleanText(value, null);
    if (!normalized) {
      return latest;
    }
    if (!latest) {
      return normalized;
    }
    return Date.parse(normalized) > Date.parse(latest) ? normalized : latest;
  }, null);
}

function normalizeReferenceId(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return cleanText(value, null);
  }
  if (typeof value === "object") {
    return cleanText(value.id || value.slug || value.name || value.label, null);
  }
  return null;
}

function normalizeOptionalBoolean(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return null;
}

function summarizeRunEvents(events) {
  const ordered = sortByRecordedAt(events);
  const first = ordered[0] || {};
  const latest = ordered.at(-1) || {};
  const waveRun = latestEventByEntity(ordered, "wave_run");
  const gate = latestEventByEntity(ordered, "gate");
  const attempts = ordered.filter((event) => event.entityType === "attempt");
  const agentRuns = ordered.filter((event) => event.entityType === "agent_run");
  const proofs = ordered.filter((event) => event.entityType === "proof_bundle");
  const coordination = ordered.filter((event) => event.entityType === "coordination_record");
  const artifacts = ordered.flatMap((event) => event.artifacts || []);
  const identity = latest.identity || first.identity || {};
  return {
    workspaceId: identity.workspaceId || null,
    projectId: identity.projectId || null,
    runKind: identity.runKind || null,
    runId: identity.runId || null,
    lane: identity.lane || null,
    wave: identity.wave ?? null,
    orchestratorId: identity.orchestratorId || null,
    runtimeVersion: identity.runtimeVersion || null,
    startedAt: first.recordedAt || null,
    updatedAt: latest.recordedAt || null,
    status: waveRun?.action || latest.action || "unknown",
    latestGate: gate?.data?.gateSnapshot?.overall?.gate || gate?.data?.gateSnapshot?.overall?.statusCode || null,
    attemptCount: Math.max(
      distinctValues(attempts.map((event) => event.data?.attemptNumber || event.identity?.attempt)).length,
      0,
    ),
    agentIds: distinctValues(agentRuns.map((event) => event.data?.agentId || event.identity?.agentId)),
    proofBundleCount: proofs.length,
    coordinationRecordCount: coordination.length,
    artifactCount: artifacts.length,
    tags: distinctValues(ordered.flatMap((event) => event.tags || [])),
  };
}

export function listRunSummaries(events, filters = {}) {
  const runEvents = events.filter(
    (event) =>
      ["roadmap", "adhoc"].includes(event.identity?.runKind || "") &&
      matchesRunFilters(event, filters),
  );
  const grouped = groupBy(runEvents, (event) => runKey(event));
  return Array.from(grouped.values())
    .map((group) => summarizeRunEvents(group))
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
}

export function getRunDetail(events, filters = {}) {
  const filtered = events.filter(
    (event) =>
      ["roadmap", "adhoc"].includes(event.identity?.runKind || "") &&
      matchesRunFilters(event, filters),
  );
  if (filtered.length === 0) {
    return null;
  }
  const ordered = sortByRecordedAt(filtered);
  const summary = summarizeRunEvents(ordered);
  return {
    summary,
    timeline: ordered,
    attempts: ordered.filter((event) => event.entityType === "attempt"),
    agentRuns: ordered.filter((event) => event.entityType === "agent_run"),
    gates: ordered.filter((event) => event.entityType === "gate"),
    proofs: ordered.filter((event) => event.entityType === "proof_bundle"),
    coordination: ordered.filter((event) => event.entityType === "coordination_record"),
    artifacts: ordered.flatMap((event) =>
      (event.artifacts || []).map((artifact) => ({
        ...artifact,
        eventId: event.id,
        entityType: event.entityType,
      })),
    ),
  };
}

function summarizeBenchmarkEvents(events) {
  const ordered = sortByRecordedAt(events);
  const first = ordered[0] || {};
  const latest = ordered.at(-1) || {};
  const runEvent = latestEventByEntity(ordered, "benchmark_run");
  const items = ordered.filter((event) => event.entityType === "benchmark_item");
  const reviews = ordered.filter((event) => event.entityType === "review");
  const verifications = ordered.filter((event) => event.entityType === "verification");
  const identity = runEvent?.identity || latest.identity || first.identity || {};
  const reviewBreakdown = {};
  for (const review of reviews) {
    const validity = cleanText(review.data?.reviewValidity, "review-only");
    reviewBreakdown[validity] = (reviewBreakdown[validity] || 0) + 1;
  }
  const status = runEvent?.action || latest.action || "unknown";
  return {
    workspaceId: identity.workspaceId || null,
    projectId: identity.projectId || null,
    runKind: identity.runKind || null,
    runId: identity.runId || null,
    lane: identity.lane || null,
    wave: identity.wave ?? null,
    benchmarkRunId: identity.benchmarkRunId || null,
    orchestratorId: identity.orchestratorId || null,
    runtimeVersion: identity.runtimeVersion || null,
    startedAt: first.recordedAt || null,
    updatedAt: latest.recordedAt || null,
    action: status,
    status,
    summary: runEvent?.data?.summary || null,
    adapter: runEvent?.data?.adapter || null,
    adapterId: normalizeReferenceId(runEvent?.data?.adapter),
    manifest: runEvent?.data?.manifest || null,
    manifestId: normalizeReferenceId(runEvent?.data?.manifest),
    selectedArms: runEvent?.data?.selectedArms || [],
    comparisonMode: runEvent?.data?.comparisonMode || null,
    comparisonReady: normalizeOptionalBoolean(runEvent?.data?.comparisonReady),
    benchmarkItemCount: items.length,
    itemCount: items.length,
    reviewCount: reviews.length,
    verificationCount: verifications.length,
    reviewBreakdown,
  };
}

export function listBenchmarkRunSummaries(events, filters = {}) {
  const benchmarkEvents = events.filter(
    (event) => event.identity?.benchmarkRunId && matchesBenchmarkFilters(event, filters),
  );
  const grouped = groupBy(benchmarkEvents, (event) => benchmarkRunKey(event));
  return Array.from(grouped.values())
    .map((group) => summarizeBenchmarkEvents(group))
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
}

export function getBenchmarkRunDetail(events, filters = {}) {
  const filtered = events.filter(
    (event) => event.identity?.benchmarkRunId && matchesBenchmarkFilters(event, filters),
  );
  if (filtered.length === 0) {
    return null;
  }
  const ordered = sortByRecordedAt(filtered);
  return {
    summary: summarizeBenchmarkEvents(ordered),
    run: latestEventByEntity(ordered, "benchmark_run"),
    items: ordered.filter((event) => event.entityType === "benchmark_item"),
    verifications: ordered.filter((event) => event.entityType === "verification"),
    reviews: ordered.filter((event) => event.entityType === "review"),
    timeline: ordered,
    artifacts: ordered.flatMap((event) =>
      (event.artifacts || []).map((artifact) => ({
        ...artifact,
        eventId: event.id,
        entityType: event.entityType,
      })),
    ),
  };
}

export function buildAnalyticsOverview(events, filters = {}) {
  const baseFiltered = events.filter((event) => {
    const identity = event.identity || {};
    if (filters.workspaceId && identity.workspaceId !== filters.workspaceId) {
      return false;
    }
    if (filters.projectId && identity.projectId !== filters.projectId) {
      return false;
    }
    if (filters.orchestratorId && identity.orchestratorId !== filters.orchestratorId) {
      return false;
    }
    if (filters.runtimeVersion && identity.runtimeVersion !== filters.runtimeVersion) {
      return false;
    }
    return true;
  });
  const runEvents = baseFiltered.filter(
    (event) =>
      ["roadmap", "adhoc"].includes(event.identity?.runKind || "") &&
      matchesRunFilters(event, filters),
  );
  const benchmarkEvents = baseFiltered.filter(
    (event) => event.identity?.benchmarkRunId && matchesBenchmarkFilters(event, filters),
  );
  const runSummaries = listRunSummaries(runEvents, filters);
  const benchmarkRuns = listBenchmarkRunSummaries(benchmarkEvents, filters);
  const reviewValidityCounts = {};
  for (const event of benchmarkEvents.filter((entry) => entry.entityType === "review")) {
    const validity = cleanText(event.data?.reviewValidity, "review-only");
    reviewValidityCounts[validity] = (reviewValidityCounts[validity] || 0) + 1;
  }
  const gateCounts = {};
  for (const event of runEvents.filter((entry) => entry.entityType === "gate")) {
    const gate = cleanText(
      event.data?.gateSnapshot?.overall?.gate || event.data?.gateSnapshot?.overall?.statusCode,
      "unknown",
    );
    gateCounts[gate] = (gateCounts[gate] || 0) + 1;
  }
  const artifactCount = [...runEvents, ...benchmarkEvents].reduce(
    (total, event) => total + (event.artifacts || []).length,
    0,
  );
  return {
    runCount: runSummaries.length,
    benchmarkRunCount: benchmarkRuns.length,
    latestRunUpdatedAt: runSummaries[0]?.updatedAt || null,
    latestBenchmarkUpdatedAt: benchmarkRuns[0]?.updatedAt || null,
    latestActivityAt: latestTimestamp([runSummaries[0]?.updatedAt, benchmarkRuns[0]?.updatedAt]),
    runStatusCounts: countByValue(runSummaries.map((summary) => summary.status)),
    benchmarkStatusCounts: countByValue(
      benchmarkRuns.map((summary) => summary.status || summary.action),
    ),
    benchmarkComparisonReadyCount: benchmarkRuns.filter((summary) => summary.comparisonReady === true).length,
    benchmarkComparisonPendingCount: benchmarkRuns.filter((summary) => summary.comparisonReady === false).length,
    benchmarkComparisonUnknownCount: benchmarkRuns.filter((summary) => summary.comparisonReady == null).length,
    gateCounts,
    reviewValidityCounts,
    reviewCount: benchmarkRuns.reduce((total, summary) => total + Number(summary.reviewCount || 0), 0),
    verificationCount: benchmarkRuns.reduce((total, summary) => total + Number(summary.verificationCount || 0), 0),
    coordinationRecordCount: runEvents.filter((event) => event.entityType === "coordination_record").length,
    proofBundleCount: runEvents.filter((event) => event.entityType === "proof_bundle").length,
    artifactCount,
  };
}
