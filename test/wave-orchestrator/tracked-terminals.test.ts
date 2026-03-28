import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("tracked VS Code terminals baseline", () => {
  it("keeps a static, inert workstation baseline by default", () => {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "test", "wave-orchestrator", "tracked-terminals.fixture.json"),
        "utf8",
      ),
    );

    expect(config.autorun).toBe(false);
    expect(config.env).toEqual({});
    expect(config.terminals).toEqual([
      {
        name: "Workspace Shell",
        icon: "terminal-bash",
        color: "terminal.ansiGreen",
        command: "bash",
      },
      {
        name: "Tests",
        icon: "beaker",
        color: "terminal.ansiYellow",
        command: "bash -lc 'pnpm test; exec bash'",
      },
      {
        name: "Wave Doctor",
        icon: "pulse",
        color: "terminal.ansiCyan",
        command: "bash -lc 'node scripts/wave.mjs doctor --json; exec bash'",
      },
      {
        name: "Wave Dashboard Current",
        icon: "dashboard",
        color: "terminal.ansiBrightCyan",
        command:
          "TMUX= tmux -L oc_default_main_wave_orchest_2f5c21f3_waves new -As oc_default_main_wave_orchest_2f5c21f3_wave_dashboard_current",
      },
      {
        name: "Wave Dashboard Global",
        icon: "dashboard",
        color: "terminal.ansiBrightBlue",
        command:
          "TMUX= tmux -L oc_default_main_wave_orchest_2f5c21f3_waves new -As oc_default_main_wave_orchest_2f5c21f3_wave_dashboard_global_current",
      },
    ]);
  });
});
