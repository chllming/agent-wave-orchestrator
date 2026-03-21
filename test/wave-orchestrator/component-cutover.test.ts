import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";

const matrixMarkdownPath = path.join(REPO_ROOT, "docs/plans/component-cutover-matrix.md");
const matrixJsonPath = path.join(REPO_ROOT, "docs/plans/component-cutover-matrix.json");
const waveZeroPath = path.join(REPO_ROOT, "docs/plans/waves/wave-0.md");

function parseMarkdownComponentIds(markdown) {
  return Array.from(
    new Set(
      Array.from(markdown.matchAll(/- `([a-z0-9._-]+)`:/g)).map((match) => match[1]),
    ),
  ).sort();
}

function parseWavePromotions(markdown) {
  const lines = markdown.split(/\r?\n/);
  const promotions = [];
  let inPromotions = false;
  for (const line of lines) {
    if (/^## Component promotions\s*$/.test(line.trim())) {
      inPromotions = true;
      continue;
    }
    if (inPromotions && /^##\s+/.test(line)) {
      break;
    }
    if (!inPromotions) {
      continue;
    }
    const match = line.trim().match(/^- ([a-z0-9._-]+): ([a-z0-9._-]+)$/);
    if (match) {
      promotions.push({ componentId: match[1], targetLevel: match[2] });
    }
  }
  return promotions;
}

function parseMarkdownCurrentLevels(markdown) {
  return Object.fromEntries(
    Array.from(
      markdown.matchAll(/^\| `([a-z0-9._-]+)` \| `([a-z0-9._-]+)` \|/gm),
    ).map((match) => [match[1], match[2]]),
  );
}

describe("component cutover matrix", () => {
  it("keeps markdown and JSON component ids aligned", () => {
    const markdown = fs.readFileSync(matrixMarkdownPath, "utf8");
    const json = JSON.parse(fs.readFileSync(matrixJsonPath, "utf8"));

    expect(parseMarkdownComponentIds(markdown)).toEqual(Object.keys(json.components).sort());
  });

  it("keeps wave-0 promotions aligned with the matrix JSON", () => {
    const waveZero = fs.readFileSync(waveZeroPath, "utf8");
    const json = JSON.parse(fs.readFileSync(matrixJsonPath, "utf8"));
    const levels = new Set(json.levels);

    for (const promotion of parseWavePromotions(waveZero)) {
      expect(json.components[promotion.componentId]).toBeTruthy();
      expect(levels.has(promotion.targetLevel)).toBe(true);
      expect(
        json.components[promotion.componentId].promotions.some(
          (entry) => entry.wave === 0 && entry.target === promotion.targetLevel,
        ),
      ).toBe(true);
    }
  });

  it("keeps markdown current levels aligned with the matrix JSON", () => {
    const markdown = fs.readFileSync(matrixMarkdownPath, "utf8");
    const json = JSON.parse(fs.readFileSync(matrixJsonPath, "utf8"));

    expect(parseMarkdownCurrentLevels(markdown)).toEqual(
      Object.fromEntries(
        Object.entries(json.components).map(([componentId, component]) => [
          componentId,
          component.currentLevel,
        ]),
      ),
    );
  });
});
