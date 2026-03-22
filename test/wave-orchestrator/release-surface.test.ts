import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("release surface alignment", () => {
  it("keeps package metadata, README, changelog, and release manifest on the same version", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "releases", "manifest.json"), "utf8"),
    );

    const version = packageJson.version;
    expect(manifest.releases[0]?.version).toBe(version);
    expect(readme).toContain(`@chllming/wave-orchestration@${version}`);
    expect(readme).toContain(`/releases/tag/v${version}`);
    expect(changelog).toMatch(new RegExp(`^## ${version.replaceAll(".", "\\.")} - \\d{4}-\\d{2}-\\d{2}$`, "m"));
  });

  it("documents Codex turn ceilings as opaque and keeps budget.turns scoped to Claude/OpenCode", () => {
    const runtimeReadme = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "runtime-config", "README.md"),
      "utf8",
    );
    const codexDoc = fs.readFileSync(
      path.join(repoRoot, "docs", "reference", "runtime-config", "codex.md"),
      "utf8",
    );
    const runbook = fs.readFileSync(
      path.join(repoRoot, "docs", "plans", "wave-orchestrator.md"),
      "utf8",
    );

    expect(runtimeReadme).toContain(
      "Seeds Claude `maxTurns` and OpenCode `steps` when runtime-specific values are absent; it does not set a Codex turn limit",
    );
    expect(runtimeReadme).toContain("Wave emitted no turn-limit flag");
    expect(codexDoc).toContain("Generic `budget.turns` does not set a Codex turn limit.");
    expect(codexDoc).not.toContain(`"turns": 12`);
    expect(runbook).toContain("Codex turn ceilings remain external to Wave");
  });
});
