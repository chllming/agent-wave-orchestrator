import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLanePaths, REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

describe("tracked VS Code terminals baseline", () => {
  it("keeps tracked terminals repo-scoped and inert by default", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".vscode", "terminals.json"), "utf8"),
    );
    const lanePaths = buildLanePaths("main");

    expect(config.autorun).toBe(false);
    expect(config.env).toEqual({});
    expect(config.terminals).toEqual([
      {
        name: `${lanePaths.project}-${lanePaths.lane}-wave-dashboard-current`,
        icon: "dashboard",
        color: "terminal.ansiBrightCyan",
        command: `TMUX= tmux -L ${lanePaths.tmuxSocketName} new -As ${lanePaths.tmuxDashboardSessionPrefix}_current`,
      },
      {
        name: lanePaths.globalDashboardTerminalName,
        icon: "dashboard",
        color: "terminal.ansiBrightBlue",
        command: `TMUX= tmux -L ${lanePaths.tmuxSocketName} new -As ${lanePaths.tmuxGlobalDashboardSessionPrefix}_current`,
      },
    ]);
  });
});
