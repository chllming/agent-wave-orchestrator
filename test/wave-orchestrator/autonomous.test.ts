import { describe, expect, it } from "vitest";
import { nextIncompleteWave, parseArgs } from "../../scripts/wave-orchestrator/autonomous.mjs";
import { DEFAULT_CODEX_SANDBOX_MODE } from "../../scripts/wave-orchestrator/launcher.mjs";

describe("autonomous parseArgs", () => {
  it("defaults to a single external attempt per wave", () => {
    const parsed = parseArgs([]);
    expect(parsed.help).toBe(false);
    expect(parsed.options.maxAttemptsPerWave).toBe(1);
    expect(parsed.options.executorMode).toBe("codex");
    expect(parsed.options.codexSandboxMode).toBe(DEFAULT_CODEX_SANDBOX_MODE);
  });

  it("rejects the local executor", () => {
    expect(() => parseArgs(["--executor", "local"])).toThrow(/does not support --executor local/i);
  });

  it("accepts an explicit codex sandbox override", () => {
    const parsed = parseArgs(["--codex-sandbox", "workspace-write"]);
    expect(parsed.options.codexSandboxMode).toBe("workspace-write");
  });
});

describe("nextIncompleteWave", () => {
  it("returns the first wave not present in run-state", () => {
    expect(nextIncompleteWave([0, 1, 2, 3], [0, 1, 3])).toBe(2);
    expect(nextIncompleteWave([0, 1], [0, 1])).toBe(null);
  });
});
