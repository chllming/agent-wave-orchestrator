import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "../wave-orchestrator/roots.mjs";
import {
  PLANNER_CONTEXT7_BUNDLE_ID,
  PLANNER_CONTEXT7_DEFAULT_QUERY,
  PLANNER_CONTEXT7_LIBRARY_NAME,
  PLANNER_CONTEXT7_SOURCE_DIR,
  PLANNER_CONTEXT7_SOURCE_FILES,
} from "../wave-orchestrator/planner-context.mjs";

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function extractFrontmatterValue(text, key) {
  const match = String(text || "").match(new RegExp(`^${key}:\\s*['"]?(.+?)['"]?$`, "m"));
  return match ? match[1].trim() : "";
}

function extractMarkdownHeading(text) {
  const match = String(text || "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function renderPlannerTopicIndex(copiedFiles) {
  const paperLines = copiedFiles
    .filter((entry) => entry.kind === "paper")
    .map((file) => {
      return `- [${file.title || file.targetPath.split("/").pop()}](../papers/${path.basename(file.targetPath)})`;
    });
  return [
    "---",
    "summary: 'Curated planning and orchestration corpus exported for the agentic planner Context7 bundle.'",
    "read_when:",
    "  - You are publishing or refreshing the planner-agentic Context7 library",
    "  - You need the exact planner research subset that Wave ships for agentic planning",
    "title: 'Planner Agentic Context7 Corpus'",
    "---",
    "",
    "# Planner Agentic Context7 Corpus",
    "",
    "This file is the tracked topic index for the planner-specific Context7 corpus.",
    "It intentionally references only the copied files that ship under",
    "`docs/context7/planner-agent/`.",
    "",
    "## Included papers",
    "",
    ...paperLines,
    "",
  ].join("\n");
}

function writePlannerContextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, "utf8");
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: sha256Text(text),
  };
}

function copyPlannerContextFile(entry, copiedFiles) {
  const sourcePath = path.join(PACKAGE_ROOT, entry.sourcePath);
  const targetPath = path.join(PACKAGE_ROOT, entry.targetPath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Planner Context7 source file is missing: ${entry.sourcePath}`);
  }
  ensureDirectory(path.dirname(targetPath));
  const text = fs.readFileSync(sourcePath, "utf8");
  const written =
    entry.kind === "topic"
      ? writePlannerContextFile(
          targetPath,
          renderPlannerTopicIndex(copiedFiles),
        )
      : writePlannerContextFile(targetPath, text);
  return {
    kind: entry.kind,
    sourcePath: entry.sourcePath,
    targetPath: entry.targetPath,
    title:
      entry.kind === "topic"
        ? "Planner Agentic Context7 Corpus"
        : extractFrontmatterValue(text, "title") || extractMarkdownHeading(text) || path.basename(entry.targetPath),
    ...written,
  };
}

function writeManifest(files) {
  const manifestPath = path.join(PACKAGE_ROOT, PLANNER_CONTEXT7_SOURCE_DIR, "manifest.json");
  ensureDirectory(path.dirname(manifestPath));
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        bundleId: PLANNER_CONTEXT7_BUNDLE_ID,
        libraryName: PLANNER_CONTEXT7_LIBRARY_NAME,
        defaultQuery: PLANNER_CONTEXT7_DEFAULT_QUERY,
        sourceRoot: "docs/research/agent-context-cache",
        targetRoot: PLANNER_CONTEXT7_SOURCE_DIR,
        files,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function main() {
  const files = [];
  const orderedEntries = [
    ...PLANNER_CONTEXT7_SOURCE_FILES.filter((entry) => entry.kind !== "topic"),
    ...PLANNER_CONTEXT7_SOURCE_FILES.filter((entry) => entry.kind === "topic"),
  ];
  for (const entry of orderedEntries) {
    files.push(copyPlannerContextFile(entry, files));
  }
  writeManifest(files);
  console.log(
    `[planner-context7] synced ${files.length} files into ${PLANNER_CONTEXT7_SOURCE_DIR}`,
  );
}

main();
