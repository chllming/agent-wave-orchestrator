import { describe, expect, it } from "vitest";
import {
  createCurrentWaveDashboardTerminalEntry,
  createGlobalDashboardTerminalEntry,
  createTemporaryTerminalEntries,
  createWaveAgentSessionName,
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

  it("creates stable per-wave session names without run-tag suffixes", () => {
    const lanePaths = {
      tmuxSocketName: "socket-main",
      tmuxSessionPrefix: "oc_main_wave",
      tmuxDashboardSessionPrefix: "oc_main_wave_dashboard",
      terminalNamePrefix: "main-wave",
      dashboardTerminalNamePrefix: "main-wave-dashboard",
    };

    expect(createWaveAgentSessionName(lanePaths, 7, "a1")).toBe("oc_main_wave7_a1");

    const entries = createTemporaryTerminalEntries(
      lanePaths,
      7,
      [{ slug: "a1" }, { slug: "docs-helper" }],
      "deadbeef",
      true,
    );

    expect(entries.map((entry) => entry.sessionName)).toEqual([
      "oc_main_wave7_a1",
      "oc_main_wave7_docs-helper",
      "oc_main_wave_dashboard7",
    ]);
  });
});
