import { describe, expect, it } from "vitest";
import { normalizeControlPlaneEvent } from "../../scripts/wave-orchestrator/control-plane.mjs";

describe("control-plane normalization", () => {
  it("accepts contradiction entities", () => {
    expect(
      normalizeControlPlaneEvent({
        lane: "main",
        wave: 3,
        entityType: "contradiction",
        entityId: "contra-1",
        action: "create",
      }),
    ).toMatchObject({
      entityType: "contradiction",
      entityId: "contra-1",
      action: "create",
    });
  });

  it("accepts fact entities", () => {
    expect(
      normalizeControlPlaneEvent({
        lane: "main",
        wave: 3,
        entityType: "fact",
        entityId: "fact-1",
        action: "create",
      }),
    ).toMatchObject({
      entityType: "fact",
      entityId: "fact-1",
      action: "create",
    });
  });
});
