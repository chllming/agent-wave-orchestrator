import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const allowedLegacyRoots = [
  "compat/host-node/",
  "docs/",
  "go/contracts/",
  "third_party/",
];
const allowedLegacyFiles = new Set(["CLAUDE.md", "THIRD_PARTY_NOTICES.md"]);
const codeExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".jsx",
]);

function shouldSkipDir(relativePath: string) {
  return (
    relativePath === ".git" ||
    relativePath === ".tmp" ||
    relativePath === ".wave" ||
    relativePath === ".claude" ||
    relativePath === "node_modules" ||
    relativePath.startsWith(".git/") ||
    relativePath.startsWith(".tmp/") ||
    relativePath.startsWith(".wave/") ||
    relativePath.startsWith(".claude/") ||
    relativePath.startsWith("node_modules/") ||
    relativePath.startsWith("services/slowfast/node_modules/")
  );
}

function listCodeFiles(currentPath: string, files: string[] = []) {
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(repoRoot, fullPath).replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      if (!shouldSkipDir(relativePath)) {
        listCodeFiles(fullPath, files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!codeExtensions.has(path.extname(entry.name))) {
      continue;
    }

    files.push(relativePath);
  }
  return files;
}

function allowsLegacyReference(relativePath: string) {
  if (allowedLegacyFiles.has(relativePath)) {
    return true;
  }
  return allowedLegacyRoots.some((root) => relativePath.startsWith(root));
}

function findForbiddenLegacyReferences() {
  const files = listCodeFiles(repoRoot);
  const forbidden = [];

  for (const relativePath of files) {
    if (allowsLegacyReference(relativePath)) {
      continue;
    }

    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    if (
      /from\s+['"](?:@openclaw\/|openclaw\/)/.test(source) ||
      /import\(\s*['"](?:@openclaw\/|openclaw\/)/.test(source) ||
      /require\(\s*['"](?:@openclaw\/|openclaw\/)/.test(source)
    ) {
      forbidden.push(relativePath);
    }
  }

  return forbidden;
}

function openclawPathIsTrackedByGit() {
  const result = spawnSync("git", ["ls-files", "--", "openclaw"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return Boolean(result.stdout?.trim());
}

function openclawPathIsGitignored() {
  const result = spawnSync("git", ["check-ignore", "-q", "openclaw"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.status === 0;
}

describe("legacy surface guardrails", () => {
  it("does not keep a tracked vendored openclaw monorepo in the repo root", () => {
    const openclawPath = path.join(repoRoot, "openclaw");
    if (!fs.existsSync(openclawPath)) {
      return;
    }
    expect(
      openclawPathIsTrackedByGit(),
      "openclaw/ must not be committed; keep it as a local gitignored mount only",
    ).toBe(false);
    expect(
      openclawPathIsGitignored(),
      "openclaw/ exists at repo root but is not ignored; add openclaw/ to .gitignore for local mounts or remove the directory",
    ).toBe(true);
  });

  it("keeps legacy OpenClaw imports confined to compat/host-node", () => {
    expect(findForbiddenLegacyReferences()).toEqual([]);
  });
});
