import { describe, expect, it } from "vitest";
import { getBenchmarkBadge, getRunBadge } from "../../services/wave-control-web/src/pages";

describe("wave-control web analytics presentation", () => {
  it("marks completed runs with unhealthy gates as follow-up work", () => {
    expect(
      getRunBadge({
        status: "completed",
        latestGate: "clarificationBarrier",
      }),
    ).toEqual({
      label: "needs follow-up",
      className: "pill danger",
    });

    expect(
      getRunBadge({
        status: "completed",
        latestGate: "pass",
      }),
    ).toEqual({
      label: "healthy",
      className: "pill success",
    });

    expect(
      getRunBadge({
        status: "completed",
        latestGate: "manualReview",
      }),
    ).toEqual({
      label: "needs follow-up",
      className: "pill danger",
    });
  });

  it("marks benchmark rows from readiness and review signals instead of raw completion alone", () => {
    expect(
      getBenchmarkBadge({
        status: "completed",
        comparisonReady: false,
        reviewBreakdown: {},
      }),
    ).toEqual({
      label: "needs follow-up",
      className: "pill danger",
    });

    expect(
      getBenchmarkBadge({
        status: "completed",
        comparisonReady: true,
        reviewBreakdown: {
          "benchmark-invalid": 1,
        },
      }),
    ).toEqual({
      label: "needs follow-up",
      className: "pill danger",
    });

    expect(
      getBenchmarkBadge({
        status: "completed",
        comparisonReady: true,
        reviewBreakdown: {
          "comparison-valid": 1,
        },
      }),
    ).toEqual({
      label: "ready",
      className: "pill success",
    });

    expect(
      getBenchmarkBadge({
        status: "completed",
        comparisonReady: null,
        reviewBreakdown: {},
      }),
    ).toEqual({
      label: "snapshot",
      className: "pill",
    });
  });
});
