import { describe, expect, it } from "vitest";
import { createCurrentWaveDashboardTerminalEntry } from "../../scripts/wave-orchestrator/terminals.mjs";

describe("terminal helpers", () => {
  it("creates a stable current-wave dashboard entry", () => {
    const entry = createCurrentWaveDashboardTerminalEntry({
      lane: "main",
      tmuxSocketName: "socket-main",
      tmuxDashboardSessionPrefix: "oc_main_wave_dashboard",
    });

    expect(entry.terminalName).toBe("Current Wave Dashboard");
    expect(entry.sessionName).toBe("oc_main_wave_dashboard_current");
    expect(entry.config.command).toContain("tmux -L socket-main new -As oc_main_wave_dashboard_current");
  });

  it("names non-main lanes distinctly while keeping the entry stable", () => {
    const entry = createCurrentWaveDashboardTerminalEntry({
      lane: "release",
      tmuxSocketName: "socket-release",
      tmuxDashboardSessionPrefix: "oc_release_wave_dashboard",
    });

    expect(entry.terminalName).toBe("Current Wave Dashboard (release)");
    expect(entry.sessionName).toBe("oc_release_wave_dashboard_current");
  });
});
