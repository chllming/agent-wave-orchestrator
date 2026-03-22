import { describe, expect, it } from "vitest";
import {
  normalizeProjectProfile,
  resolveDefaultTerminalSurface,
} from "../../scripts/wave-orchestrator/project-profile.mjs";

describe("project profile terminal defaults", () => {
  it("coerces legacy none defaults back to a live terminal surface", () => {
    const profile = normalizeProjectProfile({
      schemaVersion: 1,
      initializedAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
      defaultTerminalSurface: "none",
    });

    expect(profile.defaultTerminalSurface).toBe("vscode");
    expect(resolveDefaultTerminalSurface({ defaultTerminalSurface: "none" })).toBe("vscode");
  });
});
