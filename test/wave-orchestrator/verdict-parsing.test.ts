import { describe, expect, it } from "vitest";
import {
  parseVerdictFromText,
  normalizeWaveVerdict,
  REPORT_VERDICT_REGEX,
  WAVE_VERDICT_REGEX,
} from "../../scripts/wave-orchestrator/shared.mjs";

describe("parseVerdictFromText", () => {
  it("returns null verdict for empty text", () => {
    const result = parseVerdictFromText("", REPORT_VERDICT_REGEX);
    expect(result.verdict).toBeNull();
  });

  it("returns null verdict for null text", () => {
    const result = parseVerdictFromText(null, REPORT_VERDICT_REGEX);
    expect(result.verdict).toBeNull();
  });

  it("extracts pass verdict from report", () => {
    const text = "Some report content\nVerdict: PASS\nMore content";
    const result = parseVerdictFromText(text, REPORT_VERDICT_REGEX);
    expect(result.verdict).toBe("pass");
  });

  it("extracts blocked verdict from report", () => {
    const text = "Some report content\nVerdict: BLOCKED\nMore content";
    const result = parseVerdictFromText(text, REPORT_VERDICT_REGEX);
    expect(result.verdict).toBe("blocked");
  });

  it("uses first verdict when multiple are present in an append-only report", () => {
    const text = [
      "## Latest Pass",
      "Verdict: PASS",
      "",
      "## Older Pass",
      "Verdict: PASS",
      "",
      "## Original Attempt (stale)",
      "Verdict: BLOCKED",
    ].join("\n");
    const result = parseVerdictFromText(text, REPORT_VERDICT_REGEX);
    expect(result.verdict).toBe("pass");
  });

  it("handles [wave-verdict] markers", () => {
    const text = "[wave-verdict] pass detail=All tests passed";
    const result = parseVerdictFromText(text, WAVE_VERDICT_REGEX);
    expect(result.verdict).toBe("pass");
    expect(result.detail).toBe("All tests passed");
  });

  it("uses first [wave-verdict] from log", () => {
    const text = [
      "[wave-verdict] pass detail=Latest run",
      "[wave-verdict] blocked detail=Old run",
    ].join("\n");
    const result = parseVerdictFromText(text, WAVE_VERDICT_REGEX);
    expect(result.verdict).toBe("pass");
    expect(result.detail).toBe("Latest run");
  });
});

describe("normalizeWaveVerdict", () => {
  it("normalizes PASS to pass", () => {
    expect(normalizeWaveVerdict("PASS")).toBe("pass");
  });

  it("normalizes Blocked to blocked", () => {
    expect(normalizeWaveVerdict("Blocked")).toBe("blocked");
  });

  it("normalizes hold to hold", () => {
    expect(normalizeWaveVerdict("hold")).toBe("hold");
  });
});
