import { describe, expect, it } from "vitest";
import { buildDocsQueue } from "../../scripts/wave-orchestrator/docs-queue.mjs";

describe("docs queue", () => {
  it("falls back to canonical shared-plan docs and keeps wave 0 numeric", () => {
    const queue = buildDocsQueue({
      lane: "main",
      wave: { wave: 0 },
      summariesByAgentId: {
        A1: {
          docDelta: {
            state: "shared-plan",
            paths: [],
            detail: "Shared-plan docs changed.",
          },
        },
      },
      sharedPlanDocs: ["docs/plans/current-state.md", "docs/plans/master-plan.md"],
    });

    expect(queue.wave).toBe(0);
    expect(queue.releaseNotesRequired).toBe(true);
    expect(queue.items).toHaveLength(2);
    expect(queue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "A1:shared:docs/plans/current-state.md",
          kind: "shared-plan",
          path: "docs/plans/current-state.md",
        }),
        expect.objectContaining({
          id: "A1:shared:docs/plans/master-plan.md",
          kind: "shared-plan",
          path: "docs/plans/master-plan.md",
        }),
      ]),
    );
  });
});
