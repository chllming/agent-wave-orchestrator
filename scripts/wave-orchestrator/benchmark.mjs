import path from "node:path";
import {
  compileAgentInbox,
  compileSharedSummary,
  openClarificationLinkedRequests,
} from "./coordination-store.mjs";
import { buildRequestAssignments } from "./routing-state.mjs";
import { loadBenchmarkCases, loadExternalBenchmarkAdapters } from "./benchmark-cases.mjs";
import {
  REPO_ROOT,
  buildLanePaths,
  ensureDirectory,
  toIsoTimestamp,
  writeJsonAtomic,
  writeTextAtomic,
} from "./shared.mjs";
import {
  loadExternalArmTemplates,
  loadExternalCommandConfig,
  loadExternalPilotManifest,
  loadExternalPilotManifests,
  runExternalBenchmarkPilot,
} from "./benchmark-external.mjs";
import {
  buildWaveControlArtifactFromPath,
  flushWaveControlQueue,
  safeQueueWaveControlEvent,
} from "./wave-control-client.mjs";
import { buildWaveControlConfigAttestationHash } from "./wave-control-schema.mjs";

const DEFAULT_OUTPUT_DIR = ".tmp/wave-benchmarks/latest";
const BASELINE_ARM = "single-agent";

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeId(value, label) {
  const normalized = cleanText(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`${label} must match /^[a-z0-9][a-z0-9._-]*$/`);
  }
  return normalized;
}

function benchmarkTelemetryLanePaths(options = {}) {
  try {
    return buildLanePaths(options.lane || undefined, {
      project: options.project || undefined,
    });
  } catch {
    return null;
  }
}

function localBenchmarkRunId(output) {
  return `bench-local-${String(output.generatedAt || toIsoTimestamp()).replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function flushBenchmarkTelemetryBestEffort(lanePaths) {
  return flushWaveControlQueue(lanePaths).catch((error) => {
    console.warn(
      `[wave:benchmark] telemetry flush skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });
}

function publishLocalBenchmarkTelemetry({ output, outputDir, project, lane }) {
  const lanePaths = benchmarkTelemetryLanePaths({ project, lane });
  if (!lanePaths || lanePaths.waveControl?.captureBenchmarkRuns === false) {
    return null;
  }
  const benchmarkRunIdValue = localBenchmarkRunId(output);
  const attestation = {
    suite: output.suite,
    cases: output.cases.map((benchmarkCase) => benchmarkCase.id),
    familySummary: output.familySummary,
    comparisons: output.comparisons,
  };
  safeQueueWaveControlEvent(lanePaths, {
    category: "benchmark",
    entityType: "benchmark_run",
    entityId: benchmarkRunIdValue,
    action: "completed",
    source: "benchmark-runner",
    actor: "wave benchmark run",
    recordedAt: output.generatedAt,
    identity: {
      runKind: "benchmark",
      benchmarkRunId: benchmarkRunIdValue,
    },
    tags: ["local-benchmark-suite"],
    attestation,
    data: {
      suite: output.suite,
      familySummary: output.familySummary,
      comparisons: output.comparisons,
      configHash: buildWaveControlConfigAttestationHash(attestation),
    },
    artifacts: [
      {
        ...buildWaveControlArtifactFromPath(path.join(outputDir, "results.json"), {
          kind: "benchmark-results",
          uploadPolicy: "selected",
        }),
        sourcePath: path.join(outputDir, "results.json"),
      },
      {
        ...buildWaveControlArtifactFromPath(path.join(outputDir, "results.md"), {
          kind: "benchmark-results-markdown",
          uploadPolicy: "metadata-only",
        }),
        sourcePath: path.join(outputDir, "results.md"),
      },
    ],
  });
  for (const benchmarkCase of output.cases || []) {
    for (const [arm, armResult] of Object.entries(benchmarkCase.arms || {})) {
      safeQueueWaveControlEvent(lanePaths, {
        category: "benchmark",
        entityType: "benchmark_item",
        entityId: `${benchmarkCase.id}:${arm}`,
        action: armResult.passed ? "passed" : "failed",
        source: "benchmark-runner",
        actor: "wave benchmark run",
        recordedAt: output.generatedAt,
        identity: {
          runKind: "benchmark",
          benchmarkRunId: benchmarkRunIdValue,
          benchmarkItemId: `${benchmarkCase.id}:${arm}`,
        },
        tags: [benchmarkCase.familyId, benchmarkCase.benchmarkId, arm],
        data: {
          id: benchmarkCase.id,
          title: benchmarkCase.title,
          familyId: benchmarkCase.familyId,
          benchmarkId: benchmarkCase.benchmarkId,
          primaryMetric: benchmarkCase.primaryMetric,
          arm,
          score: armResult.score,
          alignedScore: armResult.alignedScore,
          passed: armResult.passed,
          direction: armResult.direction,
          threshold: armResult.threshold,
          metrics: armResult.metrics,
          details: armResult.details,
          artifacts: armResult.artifacts,
        },
      });
    }
  }
  void flushBenchmarkTelemetryBestEffort(lanePaths);
  return benchmarkRunIdValue;
}

function containsFact(text, fact) {
  return String(text || "").toLowerCase().includes(String(fact || "").trim().toLowerCase());
}

function percent(numerator, denominator) {
  if (!denominator) {
    return 100;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function scoreFactRecall(text, facts = []) {
  const matched = facts.filter((fact) => containsFact(text, fact)).length;
  return {
    matched,
    total: facts.length,
    percent: percent(matched, facts.length),
  };
}

function scoreTargetedInboxes(inboxes, expectedInboxes) {
  const entries = Object.entries(expectedInboxes || {});
  if (entries.length === 0) {
    return { matched: 0, total: 0, percent: 100 };
  }
  let matched = 0;
  let total = 0;
  for (const [agentId, facts] of entries) {
    const text = inboxes[agentId] || "";
    for (const fact of facts) {
      total += 1;
      if (containsFact(text, fact)) {
        matched += 1;
      }
    }
  }
  return { matched, total, percent: percent(matched, total) };
}

function scoreAssignments(assignments, expectedAssignments) {
  if ((expectedAssignments || []).length === 0) {
    return { matched: 0, total: 0, percent: 100 };
  }
  const lookup = new Map(assignments.map((assignment) => [assignment.requestId, assignment.assignedAgentId]));
  let matched = 0;
  for (const expected of expectedAssignments) {
    if (lookup.get(expected.requestId) === expected.assignedAgentId) {
      matched += 1;
    }
  }
  return {
    matched,
    total: expectedAssignments.length,
    percent: percent(matched, expectedAssignments.length),
  };
}

function renderCoordinationLine(record) {
  return `- ${record.kind} ${record.id}: ${record.summary || record.detail || record.id}`;
}

function singleAgentVisibleRecords(benchmarkCase) {
  const primaryAgentId = benchmarkCase.fixture.primaryAgentId;
  return benchmarkCase.fixture.state.latestRecords.filter((record) => record.agentId === primaryAgentId);
}

function renderSingleAgentSummary(benchmarkCase) {
  const primaryAgentId = benchmarkCase.fixture.primaryAgentId;
  const lines = singleAgentVisibleRecords(benchmarkCase).map(renderCoordinationLine);
  return [
    `# Single Agent Local View`,
    "",
    `- Agent: ${primaryAgentId}`,
    `- Visible records: ${lines.length}`,
    "",
    "## Local coordination",
    ...(lines.length > 0 ? lines : ["- None."]),
    "",
  ].join("\n");
}

function renderMinimalSharedSummary(benchmarkCase) {
  const state = benchmarkCase.fixture.state;
  return [
    `# Minimal Shared Summary`,
    "",
    `- Open records: ${state.openRecords.length}`,
    `- Requests: ${state.requests.length}`,
    `- Blockers: ${state.blockers.length}`,
    `- Clarifications: ${state.clarifications.length}`,
    "",
    "## Coordination shape",
    "- This baseline keeps only coarse counts and does not preserve detailed targeted facts.",
    "",
  ].join("\n");
}

function renderSingleAgentInbox(benchmarkCase, agent) {
  if (agent.agentId !== benchmarkCase.fixture.primaryAgentId) {
    return `# Inbox unavailable for ${agent.agentId}\n\n- This arm does not compile targeted inboxes.\n`;
  }
  const records = singleAgentVisibleRecords(benchmarkCase).map(renderCoordinationLine);
  return [
    `# Local Inbox For ${agent.agentId}`,
    "",
    ...(records.length > 0 ? records : ["- None."]),
    "",
  ].join("\n");
}

function buildArmArtifacts(benchmarkCase, arm) {
  const wave = {
    wave: benchmarkCase.fixture.waveNumber,
    agents: benchmarkCase.fixture.agents,
  };
  const state = benchmarkCase.fixture.state;
  if (arm === "single-agent") {
    return {
      sharedSummary: renderSingleAgentSummary(benchmarkCase),
      inboxes: Object.fromEntries(
        benchmarkCase.fixture.agents.map((agent) => [agent.agentId, renderSingleAgentInbox(benchmarkCase, agent)]),
      ),
      assignments: [],
      blockingGuard: false,
    };
  }
  if (arm === "multi-agent-minimal") {
    const sharedSummary = renderMinimalSharedSummary(benchmarkCase);
    return {
      sharedSummary,
      inboxes: Object.fromEntries(benchmarkCase.fixture.agents.map((agent) => [agent.agentId, sharedSummary])),
      assignments: [],
      blockingGuard: false,
    };
  }
  const assignments = buildRequestAssignments({
    coordinationState: state,
    agents: benchmarkCase.fixture.agents,
    capabilityRouting: benchmarkCase.fixture.capabilityRouting,
    ledger: { tasks: [] },
  });
  const sharedSummary = compileSharedSummary({
    wave,
    state,
    capabilityAssignments: assignments,
  }).text;
  const inboxes = Object.fromEntries(
    benchmarkCase.fixture.agents.map((agent) => [
      agent.agentId,
      compileAgentInbox({
        wave,
        agent,
        state,
        capabilityAssignments: assignments,
      }).text,
    ]),
  );
  return {
    sharedSummary,
    inboxes,
    assignments,
    blockingGuard:
      benchmarkCase.expectations.requireBlockingGuard &&
      openClarificationLinkedRequests(state).length > 0,
  };
}

function renderAssignmentLine(assignment) {
  return [
    assignment.requestId,
    assignment.summary || "",
    assignment.target,
    assignment.assignedAgentId || "unassigned",
    assignment.assignmentReason || "",
    assignment.assignmentDetail || "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildArtifactUnionText(artifacts) {
  return [artifacts.sharedSummary, ...Object.values(artifacts.inboxes || {}), ...(artifacts.assignments || []).map(
    (assignment) => renderAssignmentLine(assignment),
  )]
    .filter(Boolean)
    .join("\n");
}

function integrationAgentIds(benchmarkCase) {
  return benchmarkCase.fixture.agents
    .filter((agent) => Array.isArray(agent.capabilities) && agent.capabilities.includes("integration"))
    .map((agent) => agent.agentId);
}

function buildIntegrationVisibleText(benchmarkCase, artifacts) {
  const integrationIds = integrationAgentIds(benchmarkCase);
  const integrationInboxes =
    integrationIds.length > 0
      ? integrationIds.map((agentId) => artifacts.inboxes?.[agentId] || "")
      : [];
  return [artifacts.sharedSummary, ...integrationInboxes, ...(artifacts.assignments || []).map(
    (assignment) => renderAssignmentLine(assignment),
  )]
    .filter(Boolean)
    .join("\n");
}

function scoreProjectionCase(benchmarkCase, arm, artifacts) {
  const integrationVisibleText = buildIntegrationVisibleText(benchmarkCase, artifacts);
  const artifactUnionText = buildArtifactUnionText(artifacts);
  const globalFacts = scoreFactRecall(integrationVisibleText, benchmarkCase.expectations.globalFacts);
  const summaryFacts = scoreFactRecall(artifacts.sharedSummary, benchmarkCase.expectations.summaryFacts);
  const targetedInboxes = scoreTargetedInboxes(
    artifacts.inboxes,
    benchmarkCase.expectations.targetedInboxes,
  );
  const assignmentPrecision = scoreAssignments(
    artifacts.assignments,
    benchmarkCase.expectations.requiredAssignments,
  );
  const distinctAssignedAgents = new Set(
    (artifacts.assignments || []).map((assignment) => assignment.assignedAgentId).filter(Boolean),
  ).size;
  const clarificationRecall = scoreFactRecall(
    artifactUnionText,
    benchmarkCase.expectations.clarificationRequestIds,
  );
  const metrics = {
    "distributed-info-accuracy": globalFacts.percent,
    "latent-asymmetry-surfacing-rate":
      benchmarkCase.expectations.clarificationRequestIds.length > 0
        ? clarificationRecall.percent
        : targetedInboxes.percent,
    "premature-convergence-rate":
      benchmarkCase.expectations.requireBlockingGuard && !artifacts.blockingGuard ? 100 : 0,
    "global-state-reconstruction-rate": globalFacts.percent,
    "summary-fact-retention-rate": summaryFacts.percent,
    "communication-reasoning-gap": Number((100 - globalFacts.percent).toFixed(2)),
    "projection-consistency-rate": summaryFacts.percent,
    "targeted-inbox-recall": targetedInboxes.percent,
    "integration-coherence-rate": globalFacts.percent,
    "contradiction-detection-rate": targetedInboxes.percent,
    "repair-closure-rate": assignmentPrecision.percent,
    "false-consensus-rate":
      benchmarkCase.expectations.requireBlockingGuard && !artifacts.blockingGuard ? 100 : 0,
    "deadlock-rate":
      benchmarkCase.expectations.minimumDistinctAssignedAgents &&
      distinctAssignedAgents < benchmarkCase.expectations.minimumDistinctAssignedAgents
        ? 100
        : 0,
    "contention-resolution-rate": assignmentPrecision.percent,
    "symmetry-breaking-rate":
      benchmarkCase.expectations.minimumDistinctAssignedAgents == null
        ? 100
        : percent(
            Math.min(distinctAssignedAgents, benchmarkCase.expectations.minimumDistinctAssignedAgents),
            benchmarkCase.expectations.minimumDistinctAssignedAgents,
          ),
    "expert-preservation-rate": targetedInboxes.percent,
    "capability-routing-precision": assignmentPrecision.percent,
    "expert-performance-gap": Number((100 - targetedInboxes.percent).toFixed(2)),
  };
  return {
    metrics,
    details: {
      globalFacts,
      summaryFacts,
      targetedInboxes,
      clarificationRecall,
      assignmentPrecision,
      distinctAssignedAgents,
      blockingGuard: artifacts.blockingGuard,
    },
  };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.floor(p * (sortedValues.length - 1))));
  return sortedValues[index];
}

function createSeededRandom(seedInput) {
  let seed = 0;
  for (const char of String(seedInput || "wave-benchmark")) {
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  }
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function bootstrapMeanConfidenceInterval(values, seedKey) {
  if (values.length <= 1) {
    const only = Number(values[0] || 0);
    return { low: only, high: only };
  }
  const random = createSeededRandom(seedKey);
  const means = [];
  for (let index = 0; index < 400; index += 1) {
    let total = 0;
    for (let sampleIndex = 0; sampleIndex < values.length; sampleIndex += 1) {
      const picked = values[Math.floor(random() * values.length)];
      total += picked;
    }
    means.push(total / values.length);
  }
  means.sort((left, right) => left - right);
  return {
    low: Number(percentile(means, 0.025).toFixed(2)),
    high: Number(percentile(means, 0.975).toFixed(2)),
  };
}

function metricDirection(benchmarkCase, metricId, catalog) {
  const family = catalog.families[benchmarkCase.familyId];
  const metricDescriptors = [family.primaryMetric, ...(family.secondaryMetrics || [])].filter(Boolean);
  return metricDescriptors.find((descriptor) => descriptor.id === metricId)?.direction || "higher-is-better";
}

function metricPasses(direction, actual, threshold) {
  if (threshold == null) {
    return true;
  }
  return direction === "lower-is-better" ? actual <= threshold : actual >= threshold;
}

function alignMetricScore(direction, score) {
  const numeric = Number(score || 0);
  return Number((direction === "lower-is-better" ? 100 - numeric : numeric).toFixed(2));
}

function evaluateBenchmarkCaseArm(benchmarkCase, arm, catalog) {
  const artifacts = buildArmArtifacts(benchmarkCase, arm);
  const scoring = scoreProjectionCase(benchmarkCase, arm, artifacts);
  const primaryMetric = benchmarkCase.scoring.primaryMetric;
  const primaryScore = scoring.metrics[primaryMetric] ?? 0;
  const direction = metricDirection(benchmarkCase, primaryMetric, catalog);
  const threshold = benchmarkCase.scoring.thresholds[primaryMetric] ?? null;
  return {
    arm,
    score: primaryScore,
    alignedScore: alignMetricScore(direction, primaryScore),
    passed: metricPasses(direction, primaryScore, threshold),
    direction,
    threshold,
    metrics: scoring.metrics,
    details: scoring.details,
    artifacts: {
      sharedSummary: artifacts.sharedSummary,
      inboxes: artifacts.inboxes,
      assignments: artifacts.assignments,
      blockingGuard: artifacts.blockingGuard,
    },
  };
}

function aggregateByFamily(caseResults) {
  const familyMap = new Map();
  for (const caseResult of caseResults) {
    const entry = familyMap.get(caseResult.familyId) || {
      familyId: caseResult.familyId,
      familyTitle: caseResult.familyTitle,
      arms: {},
      cases: 0,
    };
    entry.cases += 1;
    for (const [arm, armResult] of Object.entries(caseResult.arms)) {
      const armEntry = entry.arms[arm] || { totalAlignedScore: 0, passed: 0, cases: 0 };
      armEntry.totalAlignedScore += armResult.alignedScore;
      armEntry.passed += armResult.passed ? 1 : 0;
      armEntry.cases += 1;
      entry.arms[arm] = armEntry;
    }
    familyMap.set(caseResult.familyId, entry);
  }
  return Array.from(familyMap.values()).map((entry) => ({
    familyId: entry.familyId,
    familyTitle: entry.familyTitle,
    cases: entry.cases,
    arms: Object.fromEntries(
      Object.entries(entry.arms).map(([arm, value]) => [
        arm,
        {
          meanScore: Number((value.totalAlignedScore / value.cases).toFixed(2)),
          passRate: percent(value.passed, value.cases),
          cases: value.cases,
        },
      ]),
    ),
  }));
}

function buildComparisons(caseResults, catalog) {
  const arms = Array.from(
    new Set(caseResults.flatMap((caseResult) => Object.keys(caseResult.arms))),
  ).filter((arm) => arm !== BASELINE_ARM);
  const comparisons = [];
  for (const challenger of arms) {
    const overallDeltas = [];
    for (const caseResult of caseResults) {
      const baseline = caseResult.arms[BASELINE_ARM];
      const candidate = caseResult.arms[challenger];
      if (!baseline || !candidate) {
        continue;
      }
      overallDeltas.push(candidate.alignedScore - baseline.alignedScore);
    }
    if (overallDeltas.length > 0) {
      const ci = bootstrapMeanConfidenceInterval(overallDeltas, `overall:${challenger}`);
      const meanDelta = Number(
        (overallDeltas.reduce((total, value) => total + value, 0) / overallDeltas.length).toFixed(2),
      );
      comparisons.push({
        scope: "overall",
        baselineArm: BASELINE_ARM,
        challengerArm: challenger,
        meanDelta,
        confidenceInterval: ci,
        statisticallyConfident: ci.low > 0,
      });
    }
  }
  const familyIds = Array.from(new Set(caseResults.map((caseResult) => caseResult.familyId)));
  for (const familyId of familyIds) {
    for (const challenger of arms) {
      const deltas = caseResults
        .filter((caseResult) => caseResult.familyId === familyId)
        .map((caseResult) => {
          const baseline = caseResult.arms[BASELINE_ARM];
          const candidate = caseResult.arms[challenger];
          return baseline && candidate ? candidate.alignedScore - baseline.alignedScore : null;
        })
        .filter((value) => typeof value === "number");
      if (deltas.length === 0) {
        continue;
      }
      const ci = bootstrapMeanConfidenceInterval(deltas, `${familyId}:${challenger}`);
      const meanDelta = Number(
        (deltas.reduce((total, value) => total + value, 0) / deltas.length).toFixed(2),
      );
      comparisons.push({
        scope: "family",
        familyId,
        familyTitle: catalog.families[familyId]?.title || familyId,
        baselineArm: BASELINE_ARM,
        challengerArm: challenger,
        meanDelta,
        confidenceInterval: ci,
        statisticallyConfident: ci.low > 0,
      });
    }
  }
  return comparisons;
}

function renderCaseMarkdown(caseResult) {
  const lines = [
    `### ${caseResult.title}`,
    "",
    `- Case id: \`${caseResult.id}\``,
    `- Family: \`${caseResult.familyId}\``,
    `- Benchmark: \`${caseResult.benchmarkId}\``,
    `- Primary metric: \`${caseResult.primaryMetric}\``,
  ];
  for (const [arm, armResult] of Object.entries(caseResult.arms)) {
    const scoreLabel =
      armResult.alignedScore === armResult.score
        ? `score=${armResult.score}`
        : `score=${armResult.score} aligned=${armResult.alignedScore}`;
    lines.push(
      `- ${arm}: ${scoreLabel} pass=${armResult.passed ? "yes" : "no"} threshold=${armResult.threshold ?? "n/a"}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderMarkdownReport(output) {
  return [
    "# Wave Benchmark Results",
    "",
    `- Generated: ${output.generatedAt}`,
    `- Cases: ${output.cases.length}`,
    `- Cases directory: \`${output.suite.casesDir}\``,
    `- Baseline arm: \`${BASELINE_ARM}\``,
    "",
    "## Family Summary",
    ...output.familySummary.flatMap((family) => [
      `### ${family.familyTitle}`,
      ...Object.entries(family.arms).map(
        ([arm, stats]) =>
          `- ${arm}: aligned_mean=${stats.meanScore} pass_rate=${stats.passRate}% cases=${stats.cases}`,
      ),
      "",
    ]),
    "## Comparisons",
    ...(output.comparisons.length > 0
      ? output.comparisons.map((comparison) => {
          const scope =
            comparison.scope === "overall"
              ? "overall"
              : `${comparison.familyTitle || comparison.familyId}`;
          return `- ${scope}: ${comparison.challengerArm} vs ${comparison.baselineArm} aligned_delta=${comparison.meanDelta} ci=[${comparison.confidenceInterval.low}, ${comparison.confidenceInterval.high}] confident=${comparison.statisticallyConfident ? "yes" : "no"}`;
        })
      : ["- None."]),
    "",
    "## Cases",
    ...output.cases.map(renderCaseMarkdown),
  ].join("\n");
}

export function runBenchmarkSuite(options = {}) {
  const suite = loadBenchmarkCases(options);
  const adapters = loadExternalBenchmarkAdapters(options);
  const selectedCaseIds = options.caseIds?.length
    ? options.caseIds.map((caseId) => normalizeId(caseId, "caseIds"))
    : null;
  const selectedFamilyIds = options.familyIds?.length
    ? options.familyIds.map((familyId) => normalizeId(familyId, "familyIds"))
    : null;
  const selectedBenchmarkIds = options.benchmarkIds?.length
    ? options.benchmarkIds.map((benchmarkId) => normalizeId(benchmarkId, "benchmarkIds"))
    : null;
  const requestedArms = options.arms?.length
    ? options.arms.map((arm) => normalizeId(arm, "arms"))
    : [BASELINE_ARM, "multi-agent-minimal", "full-wave"];
  const cases = suite.cases.filter((benchmarkCase) => {
    if (selectedCaseIds && !selectedCaseIds.includes(benchmarkCase.id)) {
      return false;
    }
    if (selectedFamilyIds && !selectedFamilyIds.includes(benchmarkCase.familyId)) {
      return false;
    }
    if (selectedBenchmarkIds && !selectedBenchmarkIds.includes(benchmarkCase.benchmarkId)) {
      return false;
    }
    return true;
  });
  const caseResults = cases.map((benchmarkCase) => ({
    id: benchmarkCase.id,
    title: benchmarkCase.title,
    summary: benchmarkCase.summary,
    familyId: benchmarkCase.familyId,
    familyTitle: benchmarkCase.familyTitle,
    benchmarkId: benchmarkCase.benchmarkId,
    benchmarkTitle: benchmarkCase.benchmarkTitle,
    primaryMetric: benchmarkCase.scoring.primaryMetric,
    arms: Object.fromEntries(
      requestedArms
        .filter((arm) => benchmarkCase.supportedArms.includes(arm))
        .map((arm) => [arm, evaluateBenchmarkCaseArm(benchmarkCase, arm, suite.catalog)]),
    ),
  }));
  const output = {
    generatedAt: toIsoTimestamp(),
    suite: {
      casesDir: suite.casesDir,
      benchmarkCatalogPath: suite.catalog.path,
      requestedArms,
    },
    adapters,
    cases: caseResults,
    familySummary: aggregateByFamily(caseResults),
    comparisons: buildComparisons(caseResults, suite.catalog),
  };
  if (options.writeOutputs !== false) {
    const outputDir = path.resolve(REPO_ROOT, cleanText(options.outputDir) || DEFAULT_OUTPUT_DIR);
    ensureDirectory(outputDir);
    writeJsonAtomic(path.join(outputDir, "results.json"), output);
    writeTextAtomic(path.join(outputDir, "results.md"), `${renderMarkdownReport(output)}\n`);
    publishLocalBenchmarkTelemetry({
      output,
      outputDir,
      project: options.project,
      lane: options.lane,
    });
    output.outputDir = path.relative(REPO_ROOT, outputDir).replaceAll(path.sep, "/");
  }
  return output;
}

function printUsage() {
  console.log(`Usage:
  wave benchmark list [--json]
  wave benchmark show --case <id> [--json]
  wave benchmark run [--project <id>] [--lane <lane>] [--case <id>] [--family <id>] [--benchmark <id>] [--arm <id>] [--output-dir <path>] [--json]
  wave benchmark adapters [--json]
  wave benchmark external-list [--json]
  wave benchmark external-show --adapter <id> [--json]
  wave benchmark external-pilots [--project <id>] [--lane <lane>] [--json]
  wave benchmark external-run --adapter <id> [--project <id>] [--lane <lane>] [--manifest <path>] [--task <id>] [--arm <id>] [--dry-run] [--command-config <path>] [run options] [--json]
`);
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const subcommand = cleanText(args.shift()).toLowerCase();
  const options = {
    project: "",
    lane: "",
    json: false,
    caseIds: [],
    familyIds: [],
    benchmarkIds: [],
    arms: [],
    outputDir: "",
    adapterId: "",
    manifestPath: "",
    taskIds: [],
    dryRun: false,
    modelId: "",
    executorId: "",
    executorCommand: "",
    toolPermissions: "",
    temperature: "",
    reasoningEffort: "",
    maxWallClockMinutes: "",
    maxTurns: "",
    retryLimit: "",
    verificationHarness: "",
    datasetVersion: "",
    commandConfigPath: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--project") {
      options.project = cleanText(args[++index]);
    } else if (arg === "--lane") {
      options.lane = cleanText(args[++index]);
    } else if (arg === "--case") {
      options.caseIds.push(args[++index]);
    } else if (arg === "--family") {
      options.familyIds.push(args[++index]);
    } else if (arg === "--benchmark") {
      options.benchmarkIds.push(args[++index]);
    } else if (arg === "--arm") {
      options.arms.push(args[++index]);
    } else if (arg === "--output-dir") {
      options.outputDir = cleanText(args[++index]);
    } else if (arg === "--adapter") {
      options.adapterId = cleanText(args[++index]);
    } else if (arg === "--manifest") {
      options.manifestPath = cleanText(args[++index]);
    } else if (arg === "--task") {
      options.taskIds.push(cleanText(args[++index]));
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--model-id") {
      options.modelId = cleanText(args[++index]);
    } else if (arg === "--executor-id") {
      options.executorId = cleanText(args[++index]);
    } else if (arg === "--executor-command") {
      options.executorCommand = cleanText(args[++index]);
    } else if (arg === "--tool-permissions") {
      options.toolPermissions = cleanText(args[++index]);
    } else if (arg === "--temperature") {
      options.temperature = cleanText(args[++index]);
    } else if (arg === "--reasoning-effort") {
      options.reasoningEffort = cleanText(args[++index]);
    } else if (arg === "--max-wall-clock-minutes") {
      options.maxWallClockMinutes = cleanText(args[++index]);
    } else if (arg === "--max-turns") {
      options.maxTurns = cleanText(args[++index]);
    } else if (arg === "--retry-limit") {
      options.retryLimit = cleanText(args[++index]);
    } else if (arg === "--verification-harness") {
      options.verificationHarness = cleanText(args[++index]);
    } else if (arg === "--dataset-version") {
      options.datasetVersion = cleanText(args[++index]);
    } else if (arg === "--command-config") {
      options.commandConfigPath = cleanText(args[++index]);
    } else if (arg === "--help" || arg === "-h") {
      return { subcommand: "help", options };
    } else if (arg) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { subcommand, options };
}

export async function runBenchmarkCli(argv) {
  const { subcommand, options } = parseArgs(argv);
  if (!subcommand || subcommand === "help") {
    printUsage();
    return;
  }
  if (subcommand === "list") {
    const suite = loadBenchmarkCases(options);
    const payload = suite.cases.map((benchmarkCase) => ({
      id: benchmarkCase.id,
      familyId: benchmarkCase.familyId,
      benchmarkId: benchmarkCase.benchmarkId,
      title: benchmarkCase.title,
      supportedArms: benchmarkCase.supportedArms,
    }));
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    for (const item of payload) {
      console.log(`${item.id} ${item.familyId}/${item.benchmarkId} ${item.title}`);
    }
    return;
  }
  if (subcommand === "show") {
    if (options.caseIds.length !== 1) {
      throw new Error("wave benchmark show requires exactly one --case <id>");
    }
    const suite = loadBenchmarkCases(options);
    const benchmarkCase = suite.byId.get(normalizeId(options.caseIds[0], "--case"));
    if (!benchmarkCase) {
      throw new Error(`Unknown benchmark case: ${options.caseIds[0]}`);
    }
    if (options.json) {
      console.log(JSON.stringify(benchmarkCase, null, 2));
      return;
    }
    console.log(`${benchmarkCase.id} ${benchmarkCase.familyId}/${benchmarkCase.benchmarkId}`);
    console.log(benchmarkCase.title);
    return;
  }
  if (subcommand === "adapters") {
    const adapters = loadExternalBenchmarkAdapters(options);
    if (options.json) {
      console.log(JSON.stringify(adapters, null, 2));
      return;
    }
    for (const adapter of adapters.adapters) {
      console.log(`${adapter.id} ${adapter.mode} ${adapter.sourceBenchmark || ""}`.trim());
    }
    return;
  }
  if (subcommand === "external-list") {
    const adapters = loadExternalBenchmarkAdapters(options);
    const payload = adapters.adapters.filter((adapter) => adapter.mode === "direct");
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    for (const adapter of payload) {
      console.log(`${adapter.id} ${adapter.sourceBenchmark || ""}`.trim());
    }
    return;
  }
  if (subcommand === "external-show") {
    if (!options.adapterId) {
      throw new Error("wave benchmark external-show requires --adapter <id>");
    }
    const adapters = loadExternalBenchmarkAdapters(options);
    const adapter = adapters.adapters.find((entry) => entry.id === normalizeId(options.adapterId, "--adapter"));
    if (!adapter) {
      throw new Error(`Unknown external benchmark adapter: ${options.adapterId}`);
    }
    const templates = loadExternalArmTemplates(options);
    const payload = {
      adapter,
      armTemplates: Object.fromEntries(Array.from(templates.templates.entries())),
    };
    if (adapter.pilotManifestPath) {
      payload.manifest = loadExternalPilotManifest(options.manifestPath || adapter.pilotManifestPath);
    }
    if (options.commandConfigPath) {
      payload.commandConfig = loadExternalCommandConfig(options.commandConfigPath);
    }
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`${adapter.id} ${adapter.title}`);
    if (payload.manifest?.path) {
      console.log(`manifest=${payload.manifest.path}`);
    }
    return;
  }
  if (subcommand === "external-pilots") {
    const manifests = loadExternalPilotManifests(options);
    if (options.json) {
      console.log(JSON.stringify(manifests, null, 2));
      return;
    }
    for (const manifest of manifests.manifests) {
      console.log(`${manifest.id} ${manifest.benchmarkId} tasks=${manifest.tasks.length}`);
    }
    return;
  }
  if (subcommand === "external-run") {
    if (!options.adapterId) {
      throw new Error("wave benchmark external-run requires --adapter <id>");
    }
    const output = runExternalBenchmarkPilot({
      project: options.project || undefined,
      lane: options.lane || undefined,
      adapterId: options.adapterId,
      manifestPath: options.manifestPath || undefined,
      taskIds: options.taskIds,
      arms: options.arms,
      outputDir: options.outputDir || undefined,
      dryRun: options.dryRun,
      modelId: options.modelId,
      executorId: options.executorId,
      executorCommand: options.executorCommand,
      toolPermissions: options.toolPermissions,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort,
      maxWallClockMinutes: options.maxWallClockMinutes,
      maxTurns: options.maxTurns,
      retryLimit: options.retryLimit,
      verificationHarness: options.verificationHarness,
      datasetVersion: options.datasetVersion,
      commandConfigPath: options.commandConfigPath || undefined,
    });
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    console.log(`external benchmark ${output.adapter.id}`);
    console.log(`output_dir=${output.outputDir}`);
    return;
  }
  if (subcommand === "run") {
    const output = runBenchmarkSuite(options);
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    console.log(renderMarkdownReport(output));
    if (output.outputDir) {
      console.log(`\n[wave:benchmark] output_dir=${output.outputDir}`);
    }
    return;
  }
  throw new Error(`Unknown benchmark subcommand: ${subcommand}`);
}
