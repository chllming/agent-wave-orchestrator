import { describe, expect, it } from "vitest";
import {
  createCurrentWaveDashboardTerminalEntry,
  createGlobalDashboardTerminalEntry,
} from "../../scripts/wave-orchestrator/terminals.mjs";

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

  it("creates a stable global dashboard entry", () => {
    const entry = createGlobalDashboardTerminalEntry(
      {
        lane: "main",
        tmuxSocketName: "socket-main",
        tmuxGlobalDashboardSessionPrefix: "oc_main_wave_dashboard_global",
        globalDashboardTerminalName: "Wave Dashboard",
      },
      "run-42",
    );

    expect(entry.terminalName).toBe("Wave Dashboard");
    expect(entry.sessionName).toBe("oc_main_wave_dashboard_global_current");
    expect(entry.config.command).toContain("tmux -L socket-main new -As oc_main_wave_dashboard_global_current");
  });
});
