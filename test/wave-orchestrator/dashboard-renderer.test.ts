import { describe, expect, it } from "vitest";
import { renderDashboard } from "../../scripts/wave-orchestrator/dashboard-renderer.mjs";

describe("dashboard renderer", () => {
  it("shows completed versus active versus pending counts in the global dashboard", () => {
    const now = new Date().toISOString();
    const rendered = renderDashboard({
      dashboardPath: "/tmp/global.json",
      lane: "main",
      state: {
        lane: "main",
        runId: "run-1",
        status: "running",
        startedAt: now,
        updatedAt: now,
        options: {
          autoNext: false,
          startWave: 0,
          endWave: 0,
          maxRetriesPerWave: 1,
        },
        waves: [
          {
            wave: 0,
            status: "running",
            attempt: 1,
            maxAttempts: 2,
            agentsTotal: 9,
            agentsCompleted: 2,
            agentsActive: 3,
            agentsPending: 4,
            agentsFailed: 0,
            lastMessage: "active",
            deployments: [],
          },
        ],
        events: [],
      },
    });

    expect(rendered).toContain("done 2/9 active 3 pending 4 fail 0");
    expect(rendered).not.toContain("2/9 ok, 0 fail");
  });

  it("adds ANSI color cues when colorized output is requested", () => {
    const now = new Date().toISOString();
    const rendered = renderDashboard({
      dashboardPath: "/tmp/wave.json",
      lane: "main",
      colorize: true,
      state: {
        lane: "main",
        wave: 0,
        status: "running",
        attempt: 1,
        maxAttempts: 2,
        startedAt: now,
        updatedAt: now,
        runTag: "run-1",
        waveFile: "docs/plans/waves/wave-0.md",
        messageBoardPath: "board.md",
        agents: [
          {
            agentId: "A1",
            state: "running",
            attempts: 1,
            exitCode: null,
            deploymentService: null,
            deploymentState: null,
            detail: "",
            lastUpdateAt: now,
          },
        ],
        events: [{ at: now, level: "warn", agentId: "A1", message: "waiting on proof" }],
      },
    });

    expect(rendered).toContain("\u001b[");
  });
});
