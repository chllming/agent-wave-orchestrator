import { describe, expect, it } from "vitest";
import { buildDashboardSummary } from "../../services/wave-control-web/src/dashboard-summary";

describe("wave-control web dashboard summary", () => {
  it("builds dashboard-first health panels and an attention queue", () => {
    const summary = buildDashboardSummary({
      overview: {
        overview: {
          runCount: 3,
          benchmarkRunCount: 3,
          latestRunUpdatedAt: "2026-03-22T11:00:00.000Z",
          latestBenchmarkUpdatedAt: "2026-03-22T11:05:00.000Z",
          latestActivityAt: "2026-03-22T11:05:00.000Z",
          runStatusCounts: { blocked: 1, completed: 2 },
          benchmarkStatusCounts: { completed: 2, running: 1 },
          benchmarkComparisonReadyCount: 1,
          benchmarkComparisonPendingCount: 1,
          benchmarkComparisonUnknownCount: 1,
          gateCounts: { clarificationBarrier: 1, pass: 2 },
          reviewValidityCounts: {
            "benchmark-invalid": 1,
            "comparison-valid": 1,
          },
          reviewCount: 2,
          verificationCount: 1,
          coordinationRecordCount: 2,
          proofBundleCount: 3,
          artifactCount: 4,
        },
        recentRuns: [],
        recentBenchmarks: [],
      },
      runItems: [
        {
          projectId: "wave-orchestration",
          lane: "main",
          wave: 7,
          status: "blocked",
          latestGate: "clarificationBarrier",
          updatedAt: "2026-03-22T11:00:00.000Z",
          attemptCount: 2,
          agentIds: ["planner", "qa"],
          proofBundleCount: 1,
          coordinationRecordCount: 1,
          artifactCount: 2,
        },
        {
          projectId: "wave-orchestration",
          lane: "main",
          wave: 6,
          status: "completed",
          latestGate: "pass",
          updatedAt: "2026-03-22T10:30:00.000Z",
          attemptCount: 1,
          agentIds: ["planner"],
          proofBundleCount: 2,
          coordinationRecordCount: 1,
          artifactCount: 2,
        },
        {
          projectId: "wave-orchestration",
          lane: "main",
          wave: 5,
          status: "completed",
          latestGate: "pass",
          updatedAt: "2026-03-22T09:55:00.000Z",
          attemptCount: 0,
          agentIds: [],
          proofBundleCount: 0,
          coordinationRecordCount: 0,
          artifactCount: 0,
        },
      ],
      benchmarks: [
        {
          benchmarkRunId: "bench-2",
          status: "completed",
          comparisonReady: false,
          reviewBreakdown: { "review-only": 1 },
          updatedAt: "2026-03-22T11:05:00.000Z",
          itemCount: 2,
          reviewCount: 1,
          verificationCount: 1,
          adapterId: "swe-bench-pro",
          manifestId: "pilot-2",
        },
        {
          benchmarkRunId: "bench-1",
          status: "completed",
          comparisonReady: true,
          reviewBreakdown: { "comparison-valid": 1 },
          updatedAt: "2026-03-22T10:45:00.000Z",
          itemCount: 3,
          reviewCount: 1,
          verificationCount: 0,
          adapterId: "swe-bench-lite",
          manifestId: "pilot-1",
        },
        {
          benchmarkRunId: "bench-3",
          status: "running",
          comparisonReady: null,
          reviewBreakdown: { "benchmark-invalid": 1 },
          updatedAt: "2026-03-22T10:50:00.000Z",
          itemCount: 1,
          reviewCount: 0,
          verificationCount: 0,
          adapterId: "local-bench",
          manifestId: "pilot-local",
        },
      ],
      userItems: [
        {
          id: "pending-1",
          email: "pending@example.com",
          accessState: "pending",
          accessRequestedAt: "2026-03-22T10:55:00.000Z",
          role: "member",
        },
        {
          id: "approved-1",
          email: "approved@example.com",
          accessState: "approved",
          role: "member",
        },
      ],
      userCredentialItems: {
        "approved-1": [{ credentialId: "corridor" }],
      },
    });

    expect(summary.access).toEqual({
      pendingRequests: 1,
      approvedUsers: 1,
      superusers: 0,
      usersWithCredentials: 1,
      credentialCount: 1,
    });
    expect(summary.runs).toEqual({
      total: 3,
      active: 1,
      healthy: 2,
      needsAttention: 1,
      latestUpdatedAt: "2026-03-22T11:00:00.000Z",
      statusCounts: { blocked: 1, completed: 2 },
      gateCounts: { clarificationBarrier: 1, pass: 2 },
    });
    expect(summary.benchmarks).toEqual({
      total: 3,
      active: 1,
      ready: 1,
      pending: 1,
      unknown: 1,
      reviewIssues: 1,
      latestUpdatedAt: "2026-03-22T11:05:00.000Z",
      statusCounts: { completed: 2, running: 1 },
      validityCounts: {
        "benchmark-invalid": 1,
        "comparison-valid": 1,
        "review-only": 1,
      },
    });
    expect(summary.downstream).toEqual({
      attemptCount: 3,
      activeAgentCount: 2,
      proofBundleCount: 3,
      coordinationRecordCount: 2,
      artifactCount: 4,
      benchmarkItemCount: 6,
      reviewCount: 2,
      verificationCount: 1,
    });
    expect(summary.attentionItems).toEqual([
      {
        kind: "access",
        tone: "accent",
        label: "1 access request waiting",
        detail: "pending@example.com is waiting for review.",
        view: "access:requests",
        updatedAt: "2026-03-22T10:55:00.000Z",
      },
      {
        kind: "run",
        tone: "danger",
        label: "main / wave 7 is blocked",
        detail: "Latest gate clarificationBarrier; 2 attempts across 2 agents.",
        view: "operations:runs",
        updatedAt: "2026-03-22T11:00:00.000Z",
      },
      {
        kind: "benchmark",
        tone: "danger",
        label: "bench-3 has review issues",
        detail: "Status running; benchmark-invalid=1.",
        view: "operations:benchmarks",
        updatedAt: "2026-03-22T10:50:00.000Z",
      },
      {
        kind: "benchmark",
        tone: "accent",
        label: "bench-2 is not comparison-ready",
        detail: "2 items, 1 review, 1 verification recorded.",
        view: "operations:benchmarks",
        updatedAt: "2026-03-22T11:05:00.000Z",
      },
    ]);
  });

  it("treats missing comparison readiness as unknown instead of pending", () => {
    const summary = buildDashboardSummary({
      overview: null,
      runItems: [
        {
          projectId: "wave-orchestration",
          lane: "main",
          wave: 4,
          status: "completed",
          latestGate: "pass",
          updatedAt: "2026-03-22T09:00:00.000Z",
          attemptCount: 1,
          agentIds: ["planner"],
          proofBundleCount: 0,
          coordinationRecordCount: 0,
          artifactCount: 0,
        },
      ],
      benchmarks: [
        {
          benchmarkRunId: "bench-local",
          status: "completed",
          comparisonReady: null,
          reviewBreakdown: {},
          updatedAt: "2026-03-22T09:10:00.000Z",
          itemCount: 1,
          reviewCount: 0,
          verificationCount: 0,
          adapterId: "local-bench",
          manifestId: "pilot-local",
        },
      ],
      userItems: [],
      userCredentialItems: {},
    });

    expect(summary.latestActivityAt).toBe("2026-03-22T09:10:00.000Z");
    expect(summary.runs.latestUpdatedAt).toBe("2026-03-22T09:00:00.000Z");
    expect(summary.runs.statusCounts).toEqual({ completed: 1 });
    expect(summary.runs.gateCounts).toEqual({ pass: 1 });
    expect(summary.benchmarks.latestUpdatedAt).toBe("2026-03-22T09:10:00.000Z");
    expect(summary.benchmarks.pending).toBe(0);
    expect(summary.benchmarks.unknown).toBe(1);
    expect(summary.attentionItems).toEqual([]);
  });

  it("prefers live collections over stale overview counters", () => {
    const summary = buildDashboardSummary({
      overview: {
        overview: {
          runCount: 9,
          benchmarkRunCount: 4,
          latestRunUpdatedAt: "2026-03-22T08:00:00.000Z",
          latestBenchmarkUpdatedAt: "2026-03-22T08:05:00.000Z",
          latestActivityAt: "2026-03-22T08:05:00.000Z",
          runStatusCounts: { completed: 9 },
          benchmarkStatusCounts: { completed: 4 },
          benchmarkComparisonReadyCount: 4,
          benchmarkComparisonPendingCount: 0,
          benchmarkComparisonUnknownCount: 0,
          gateCounts: { pass: 9 },
          reviewValidityCounts: {},
          reviewCount: 0,
          verificationCount: 0,
          coordinationRecordCount: 0,
          proofBundleCount: 0,
          artifactCount: 5,
        },
        recentRuns: [],
        recentBenchmarks: [],
      },
      runItems: [
        {
          projectId: "wave-orchestration",
          lane: "main",
          wave: 8,
          status: "blocked",
          latestGate: "clarificationBarrier",
          updatedAt: "2026-03-22T09:20:00.000Z",
          attemptCount: 1,
          agentIds: ["planner"],
          proofBundleCount: 0,
          coordinationRecordCount: 0,
          artifactCount: 0,
        },
      ],
      benchmarks: [
        {
          benchmarkRunId: "bench-live",
          status: "completed",
          comparisonReady: false,
          reviewBreakdown: {},
          updatedAt: "2026-03-22T09:25:00.000Z",
          itemCount: 1,
          reviewCount: 1,
          verificationCount: 0,
          adapterId: "swe-bench-pro",
          manifestId: "pilot-live",
        },
      ],
      userItems: [],
      userCredentialItems: {},
    });

    expect(summary.latestActivityAt).toBe("2026-03-22T09:25:00.000Z");
    expect(summary.runs.total).toBe(1);
    expect(summary.runs.active).toBe(1);
    expect(summary.runs.statusCounts).toEqual({ blocked: 1 });
    expect(summary.benchmarks.total).toBe(1);
    expect(summary.benchmarks.pending).toBe(1);
    expect(summary.benchmarks.statusCounts).toEqual({ completed: 1 });
    expect(summary.downstream.artifactCount).toBe(5);
  });

  it("uses overview snapshot signals when live collections are unavailable", () => {
    const summary = buildDashboardSummary({
      overview: {
        overview: {
          runCount: 2,
          benchmarkRunCount: 2,
          latestRunUpdatedAt: "2026-03-22T09:00:00.000Z",
          latestBenchmarkUpdatedAt: "2026-03-22T09:10:00.000Z",
          latestActivityAt: "2026-03-22T09:10:00.000Z",
          runStatusCounts: { blocked: 1, completed: 1 },
          benchmarkStatusCounts: { completed: 1, running: 1 },
          benchmarkComparisonReadyCount: 1,
          benchmarkComparisonPendingCount: 1,
          benchmarkComparisonUnknownCount: 0,
          gateCounts: { clarificationBarrier: 1, pass: 1 },
          reviewValidityCounts: { "benchmark-invalid": 1 },
          reviewCount: 1,
          verificationCount: 0,
          coordinationRecordCount: 0,
          proofBundleCount: 0,
          artifactCount: 0,
        },
        recentRuns: [],
        recentBenchmarks: [],
      },
      runItems: [],
      benchmarks: [],
      userItems: [],
      userCredentialItems: {},
    });

    expect(summary.runs.needsAttention).toBe(1);
    expect(summary.runs.healthy).toBe(1);
    expect(summary.benchmarks.reviewIssues).toBe(1);
    expect(summary.attentionItems).toEqual([
      {
        kind: "benchmark",
        tone: "danger",
        label: "1 benchmark needs follow-up",
        detail: "1 active benchmark, 1 pending comparison, 1 review issue in the latest snapshot.",
        view: "operations:benchmarks",
        updatedAt: "2026-03-22T09:10:00.000Z",
      },
      {
        kind: "run",
        tone: "danger",
        label: "1 run needs attention",
        detail: "1 non-completed run or gate issue in the latest snapshot.",
        view: "operations:runs",
        updatedAt: "2026-03-22T09:00:00.000Z",
      },
    ]);
  });

  it("clamps overview-only attention counts to the total run and benchmark counts", () => {
    const summary = buildDashboardSummary({
      overview: {
        overview: {
          runCount: 1,
          benchmarkRunCount: 1,
          latestRunUpdatedAt: "2026-03-22T08:40:00.000Z",
          latestBenchmarkUpdatedAt: "2026-03-22T08:45:00.000Z",
          latestActivityAt: "2026-03-22T08:45:00.000Z",
          runStatusCounts: { completed: 1 },
          benchmarkStatusCounts: { completed: 1 },
          benchmarkComparisonReadyCount: 0,
          benchmarkComparisonPendingCount: 1,
          benchmarkComparisonUnknownCount: 0,
          gateCounts: { clarificationBarrier: 3 },
          reviewValidityCounts: { "benchmark-invalid": 2 },
          reviewCount: 2,
          verificationCount: 0,
          coordinationRecordCount: 0,
          proofBundleCount: 0,
          artifactCount: 0,
        },
        recentRuns: [],
        recentBenchmarks: [],
      },
      runItems: [],
      benchmarks: [],
      userItems: [],
      userCredentialItems: {},
    });

    expect(summary.runs.needsAttention).toBe(1);
    expect(summary.runs.healthy).toBe(0);
    expect(summary.attentionItems).toEqual([
      {
        kind: "benchmark",
        tone: "danger",
        label: "1 benchmark needs follow-up",
        detail: "1 pending comparison, 2 review issues in the latest snapshot.",
        view: "operations:benchmarks",
        updatedAt: "2026-03-22T08:45:00.000Z",
      },
      {
        kind: "run",
        tone: "danger",
        label: "1 run needs attention",
        detail: "1 non-completed run or gate issue in the latest snapshot.",
        view: "operations:runs",
        updatedAt: "2026-03-22T08:40:00.000Z",
      },
    ]);
  });
});
