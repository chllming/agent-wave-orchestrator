import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl } from "../../services/wave-control-web/src/config";

describe("wave-control web config", () => {
  it("normalizes origin-style API base urls", () => {
    expect(normalizeApiBaseUrl("https://control.example.test")).toBe(
      "https://control.example.test",
    );
    expect(normalizeApiBaseUrl("https://control.example.test/")).toBe(
      "https://control.example.test",
    );
  });

  it("normalizes endpoint-style API base urls ending in /api/v1", () => {
    expect(normalizeApiBaseUrl("https://control.example.test/api/v1")).toBe(
      "https://control.example.test",
    );
    expect(normalizeApiBaseUrl("https://control.example.test/api/v1/")).toBe(
      "https://control.example.test",
    );
  });
});
