import { buildAccessSummary, getPendingAccessUsers, type AccessSummary } from "./access-summary";
import type {
  AppOverviewPayload,
  AppRecord,
  BenchmarkSummary,
  CountMap,
  RunSummary,
} from "./app-state";
import type { ViewId } from "./navigation";

type SummaryRun = Pick<
  RunSummary,
  | "projectId"
  | "lane"
  | "wave"
  | "status"
  | "latestGate"
  | "updatedAt"
  | "attemptCount"
  | "agentIds"
  | "proofBundleCount"
  | "coordinationRecordCount"
  | "artifactCount"
>;

type SummaryBenchmark = Pick<
  BenchmarkSummary,
  | "benchmarkRunId"
  | "status"
  | "comparisonReady"
  | "reviewBreakdown"
  | "updatedAt"
  | "itemCount"
  | "reviewCount"
  | "verificationCount"
>;

export type DashboardAttentionItem = {
  kind: "access" | "run" | "benchmark";
  tone: "danger" | "accent";
  label: string;
  detail: string;
  view: ViewId;
  updatedAt: string | null;
};

export type DashboardSummary = {
  latestActivityAt: string | null;
  access: AccessSummary;
  runs: {
    total: number;
    active: number;
    healthy: number;
    needsAttention: number;
    latestUpdatedAt: string | null;
    statusCounts: CountMap;
    gateCounts: CountMap;
  };
  benchmarks: {
    total: number;
    active: number;
    ready: number;
    pending: number;
    unknown: number;
    reviewIssues: number;
    latestUpdatedAt: string | null;
    statusCounts: CountMap;
    validityCounts: CountMap;
  };
  downstream: {
    attemptCount: number;
    activeAgentCount: number;
    proofBundleCount: number;
    coordinationRecordCount: number;
    artifactCount: number;
    benchmarkItemCount: number;
    reviewCount: number;
    verificationCount: number;
  };
  attentionItems: DashboardAttentionItem[];
};

export type DashboardSummaryInput = {
  overview: AppOverviewPayload | null;
  runItems: SummaryRun[];
  benchmarks: SummaryBenchmark[];
  userItems: AppRecord[];
  userCredentialItems: Record<string, AppRecord[]>;
};

const HEALTHY_GATE_NAMES = new Set(["pass", "ready", "ok", "success", "green"]);
const NON_ISSUE_REVIEW_VALIDITIES = new Set(["comparison-valid", "review-only"]);

function normalizeCountMap(counts: CountMap | null | undefined): CountMap {
  if (!counts || typeof counts !== "object") {
    return {};
  }
  const normalized: CountMap = {};
  for (const [label, rawCount] of Object.entries(counts)) {
    if (
      label === "__proto__" ||
      label === "constructor" ||
      label === "prototype" ||
      !Number.isFinite(Number(rawCount))
    ) {
      continue;
    }
    normalized[label] = Number(rawCount);
  }
  return normalized;
}

function sumCountMap(counts: CountMap, predicate?: (label: string, count: number) => boolean): number {
  return Object.entries(counts).reduce((total, [label, count]) => {
    if (predicate && !predicate(label, count)) {
      return total;
    }
    return total + Number(count || 0);
  }, 0);
}

function deriveRunStatusCounts(runItems: SummaryRun[]): CountMap {
  const counts: CountMap = {};
  for (const run of runItems) {
    const status = String(run.status || "unknown");
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function deriveRunGateCounts(runItems: SummaryRun[]): CountMap {
  const counts: CountMap = {};
  for (const run of runItems) {
    if (!run.latestGate) {
      continue;
    }
    counts[run.latestGate] = (counts[run.latestGate] || 0) + 1;
  }
  return counts;
}

function deriveBenchmarkStatusCounts(benchmarks: SummaryBenchmark[]): CountMap {
  const counts: CountMap = {};
  for (const benchmark of benchmarks) {
    const status = String(benchmark.status || "unknown");
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function deriveReviewValidityCounts(benchmarks: SummaryBenchmark[]): CountMap {
  const counts: CountMap = {};
  for (const benchmark of benchmarks) {
    for (const [validity, count] of Object.entries(normalizeCountMap(benchmark.reviewBreakdown))) {
      counts[validity] = (counts[validity] || 0) + count;
    }
  }
  return counts;
}

export function isHealthyGate(gate: string | null | undefined): boolean {
  const normalized = String(gate || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return HEALTHY_GATE_NAMES.has(normalized);
}

function runNeedsAttention(run: SummaryRun): boolean {
  return String(run.status || "unknown") !== "completed" || !isHealthyGate(run.latestGate);
}

function benchmarkHasReviewIssues(benchmark: SummaryBenchmark): boolean {
  return Object.entries(normalizeCountMap(benchmark.reviewBreakdown)).some(
    ([validity, count]) => !NON_ISSUE_REVIEW_VALIDITIES.has(validity) && count > 0,
  );
}

function benchmarkNeedsAttention(benchmark: SummaryBenchmark): boolean {
  return (
    benchmarkHasReviewIssues(benchmark) ||
    String(benchmark.status || "unknown") !== "completed" ||
    benchmark.comparisonReady === false
  );
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function timestampValue(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildAccessAttentionItem(pendingUsers: AppRecord[]): DashboardAttentionItem[] {
  if (pendingUsers.length === 0) {
    return [];
  }
  const firstUser = pendingUsers[0];
  return [
    {
      kind: "access",
      tone: "accent",
      label: `${pluralize(pendingUsers.length, "access request")} waiting`,
      detail: `${firstUser.email || firstUser.id || "A user"} is waiting for review.`,
      view: "access:requests",
      updatedAt: firstUser.accessRequestedAt || null,
    },
  ];
}

function buildRunAttentionItems(runItems: SummaryRun[]): DashboardAttentionItem[] {
  return runItems
    .filter((run) => runNeedsAttention(run))
    .map((run) => {
      const attemptCount = Number(run.attemptCount || 0);
      const agentCount = new Set((run.agentIds || []).filter(Boolean)).size;
      const status = String(run.status || "unknown");
      const tone: DashboardAttentionItem["tone"] = status === "completed" ? "accent" : "danger";
      const prefix = run.latestGate ? `Latest gate ${run.latestGate}; ` : "";
      return {
        kind: "run",
        tone,
        label: `${run.lane || "lane"} / wave ${run.wave ?? "n/a"} is ${status}`,
        detail: `${prefix}${pluralize(attemptCount, "attempt")} across ${pluralize(agentCount, "agent")}.`,
        view: "operations:runs",
        updatedAt: run.updatedAt || null,
      };
    });
}

function buildBenchmarkAttentionItems(benchmarks: SummaryBenchmark[]): DashboardAttentionItem[] {
  return benchmarks
    .filter((benchmark) => benchmarkNeedsAttention(benchmark))
    .map((benchmark) => {
      const benchmarkId = benchmark.benchmarkRunId || "benchmark";
      const invalidEntries = Object.entries(normalizeCountMap(benchmark.reviewBreakdown)).filter(
        ([validity, count]) => !NON_ISSUE_REVIEW_VALIDITIES.has(validity) && count > 0,
      );
      if (invalidEntries.length > 0) {
        return {
          kind: "benchmark",
          tone: "danger",
          label: `${benchmarkId} has review issues`,
          detail: `Status ${benchmark.status || "unknown"}; ${invalidEntries
            .map(([validity, count]) => `${validity}=${count}`)
            .join(", ")}.`,
          view: "operations:benchmarks",
          updatedAt: benchmark.updatedAt || null,
        } satisfies DashboardAttentionItem;
      }
      if (String(benchmark.status || "unknown") !== "completed") {
        return {
          kind: "benchmark",
          tone: "danger",
          label: `${benchmarkId} is ${benchmark.status || "unknown"}`,
          detail: `${pluralize(Number(benchmark.itemCount || 0), "item")}, ${pluralize(
            Number(benchmark.reviewCount || 0),
            "review",
          )}, ${pluralize(Number(benchmark.verificationCount || 0), "verification")} recorded.`,
          view: "operations:benchmarks",
          updatedAt: benchmark.updatedAt || null,
        } satisfies DashboardAttentionItem;
      }
      return {
        kind: "benchmark",
        tone: "accent",
        label: `${benchmarkId} is not comparison-ready`,
        detail: `${pluralize(Number(benchmark.itemCount || 0), "item")}, ${pluralize(
          Number(benchmark.reviewCount || 0),
          "review",
        )}, ${pluralize(Number(benchmark.verificationCount || 0), "verification")} recorded.`,
        view: "operations:benchmarks",
        updatedAt: benchmark.updatedAt || null,
      } satisfies DashboardAttentionItem;
    });
}

function buildOverviewRunAttentionItem(
  runNeedsAttentionCount: number,
  latestRunUpdatedAt: string | null,
): DashboardAttentionItem[] {
  if (runNeedsAttentionCount <= 0) {
    return [];
  }
  return [
    {
      kind: "run",
      tone: "danger",
      label: `${pluralize(runNeedsAttentionCount, "run")} needs attention`,
      detail: `${pluralize(runNeedsAttentionCount, "non-completed run")} or gate issue in the latest snapshot.`,
      view: "operations:runs",
      updatedAt: latestRunUpdatedAt,
    },
  ];
}

function buildOverviewBenchmarkAttentionItem(
  benchmarkTotal: number,
  benchmarkActive: number,
  benchmarkPending: number,
  benchmarkReviewIssues: number,
  latestBenchmarkUpdatedAt: string | null,
): DashboardAttentionItem[] {
  if (benchmarkActive <= 0 && benchmarkPending <= 0 && benchmarkReviewIssues <= 0) {
    return [];
  }
  const details = [
    benchmarkActive > 0 ? pluralize(benchmarkActive, "active benchmark") : null,
    benchmarkPending > 0 ? pluralize(benchmarkPending, "pending comparison") : null,
    benchmarkReviewIssues > 0 ? pluralize(benchmarkReviewIssues, "review issue") : null,
  ].filter(Boolean);
  const benchmarkNeedsFollowUpCount = Math.min(
    Math.max(benchmarkTotal, 1),
    Math.max(benchmarkActive, benchmarkPending, benchmarkReviewIssues),
  );
  return [
    {
      kind: "benchmark",
      tone: benchmarkReviewIssues > 0 || benchmarkActive > 0 ? "danger" : "accent",
      label: `${pluralize(benchmarkNeedsFollowUpCount, "benchmark")} needs follow-up`,
      detail: `${details.join(", ")} in the latest snapshot.`,
      view: "operations:benchmarks",
      updatedAt: latestBenchmarkUpdatedAt,
    },
  ];
}

function compareAttentionItems(left: DashboardAttentionItem, right: DashboardAttentionItem): number {
  const priority = (item: DashboardAttentionItem): number => {
    if (item.kind === "access") {
      return 0;
    }
    return item.tone === "danger" ? 1 : 2;
  };
  const priorityDiff = priority(left) - priority(right);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  return timestampValue(right.updatedAt) - timestampValue(left.updatedAt);
}

function latestFromValues(values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!value) {
      return latest;
    }
    if (!latest) {
      return value;
    }
    return timestampValue(value) > timestampValue(latest) ? value : latest;
  }, null);
}

export function getSortedCountEntries(
  counts: CountMap | null | undefined,
): Array<{ label: string; count: number }> {
  return Object.entries(normalizeCountMap(counts))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => ({ label, count }));
}

export function buildDashboardSummary(input: DashboardSummaryInput): DashboardSummary {
  const access = buildAccessSummary(input.userItems, input.userCredentialItems);
  const pendingUsers = getPendingAccessUsers(input.userItems);
  const overview = input.overview?.overview || null;
  const hasRunItems = input.runItems.length > 0;
  const hasBenchmarks = input.benchmarks.length > 0;

  const normalizedRunStatusCounts = hasRunItems
    ? deriveRunStatusCounts(input.runItems)
    : normalizeCountMap(overview?.runStatusCounts);
  const normalizedGateCounts = hasRunItems
    ? deriveRunGateCounts(input.runItems)
    : normalizeCountMap(overview?.gateCounts);

  const normalizedBenchmarkStatusCounts = hasBenchmarks
    ? deriveBenchmarkStatusCounts(input.benchmarks)
    : normalizeCountMap(overview?.benchmarkStatusCounts);
  const normalizedReviewValidityCounts = hasBenchmarks
    ? deriveReviewValidityCounts(input.benchmarks)
    : normalizeCountMap(overview?.reviewValidityCounts);

  const runTotal = hasRunItems ? input.runItems.length : Number(overview?.runCount ?? 0);
  const runActive = hasRunItems
    ? input.runItems.filter((run) => String(run.status || "unknown") !== "completed").length
    : sumCountMap(normalizedRunStatusCounts, (status) => status !== "completed");
  const latestRunUpdatedAt = hasRunItems
    ? latestFromValues(input.runItems.map((run) => run.updatedAt || null))
    : overview?.latestRunUpdatedAt || null;
  const runAttentionCount = hasRunItems
    ? input.runItems.filter((run) => runNeedsAttention(run)).length
    : Math.min(
        Math.max(runTotal, 1),
        Math.max(
          runActive,
          sumCountMap(normalizedGateCounts, (gate) => !isHealthyGate(gate)),
        ),
      );

  const benchmarkTotal = hasBenchmarks ? input.benchmarks.length : Number(overview?.benchmarkRunCount ?? 0);
  const benchmarkActive = hasBenchmarks
    ? input.benchmarks.filter((benchmark) => String(benchmark.status || "unknown") !== "completed").length
    : sumCountMap(normalizedBenchmarkStatusCounts, (status) => status !== "completed");
  const benchmarkReady = hasBenchmarks
    ? input.benchmarks.filter((benchmark) => benchmark.comparisonReady === true).length
    : Number(overview?.benchmarkComparisonReadyCount ?? 0);
  const benchmarkPending = hasBenchmarks
    ? input.benchmarks.filter((benchmark) => benchmark.comparisonReady === false).length
    : Number(overview?.benchmarkComparisonPendingCount ?? 0);
  const benchmarkUnknown = hasBenchmarks
    ? input.benchmarks.filter((benchmark) => benchmark.comparisonReady == null).length
    : Number(overview?.benchmarkComparisonUnknownCount ?? 0);
  const benchmarkReviewIssues = sumCountMap(
    normalizedReviewValidityCounts,
    (validity) => !NON_ISSUE_REVIEW_VALIDITIES.has(validity),
  );
  const latestBenchmarkUpdatedAt = hasBenchmarks
    ? latestFromValues(input.benchmarks.map((benchmark) => benchmark.updatedAt || null))
    : overview?.latestBenchmarkUpdatedAt || null;
  const latestActivityAt =
    hasRunItems || hasBenchmarks
      ? latestFromValues([latestRunUpdatedAt, latestBenchmarkUpdatedAt])
      : overview?.latestActivityAt || null;

  const attentionItems = [
    ...buildAccessAttentionItem(pendingUsers),
    ...(hasRunItems
      ? buildRunAttentionItems(input.runItems)
      : buildOverviewRunAttentionItem(runAttentionCount, latestRunUpdatedAt)),
    ...(hasBenchmarks
      ? buildBenchmarkAttentionItems(input.benchmarks)
      : buildOverviewBenchmarkAttentionItem(
          benchmarkTotal,
          benchmarkActive,
          benchmarkPending,
          benchmarkReviewIssues,
          latestBenchmarkUpdatedAt,
        )),
  ]
    .sort(compareAttentionItems)
    .slice(0, 6);

  const runArtifactCount = input.runItems.reduce((total, run) => total + Number(run.artifactCount || 0), 0);
  const overviewArtifactCount = Number(overview?.artifactCount ?? 0);

  return {
    latestActivityAt,
    access,
    runs: {
      total: runTotal,
      active: runActive,
      healthy: Math.max(runTotal - runAttentionCount, 0),
      needsAttention: runAttentionCount,
      latestUpdatedAt: latestRunUpdatedAt,
      statusCounts: normalizedRunStatusCounts,
      gateCounts: normalizedGateCounts,
    },
    benchmarks: {
      total: benchmarkTotal,
      active: benchmarkActive,
      ready: benchmarkReady,
      pending: benchmarkPending,
      unknown: benchmarkUnknown,
      reviewIssues: benchmarkReviewIssues,
      latestUpdatedAt: latestBenchmarkUpdatedAt,
      statusCounts: normalizedBenchmarkStatusCounts,
      validityCounts: normalizedReviewValidityCounts,
    },
    downstream: {
      attemptCount: input.runItems.reduce((total, run) => total + Number(run.attemptCount || 0), 0),
      activeAgentCount: new Set(input.runItems.flatMap((run) => run.agentIds || []).filter(Boolean)).size,
      proofBundleCount: hasRunItems
        ? input.runItems.reduce((total, run) => total + Number(run.proofBundleCount || 0), 0)
        : Number(overview?.proofBundleCount ?? 0),
      coordinationRecordCount: hasRunItems
        ? input.runItems.reduce((total, run) => total + Number(run.coordinationRecordCount || 0), 0)
        : Number(overview?.coordinationRecordCount ?? 0),
      artifactCount: hasRunItems ? Math.max(runArtifactCount, overviewArtifactCount) : overviewArtifactCount,
      benchmarkItemCount: input.benchmarks.reduce((total, benchmark) => total + Number(benchmark.itemCount || 0), 0),
      reviewCount: hasBenchmarks
        ? input.benchmarks.reduce((total, benchmark) => total + Number(benchmark.reviewCount || 0), 0)
        : Number(overview?.reviewCount ?? 0),
      verificationCount: hasBenchmarks
        ? input.benchmarks.reduce((total, benchmark) => total + Number(benchmark.verificationCount || 0), 0)
        : Number(overview?.verificationCount ?? 0),
    },
    attentionItems,
  };
}
