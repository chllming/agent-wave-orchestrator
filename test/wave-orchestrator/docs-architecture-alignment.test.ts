import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const activeDocsAndSkills = [
  "README.md",
  "docs/README.md",
  "docs/roadmap.md",
  "docs/concepts/what-is-a-wave.md",
  "docs/concepts/runtime-agnostic-orchestration.md",
  "docs/concepts/operating-modes.md",
  "docs/guides/author-and-run-waves.md",
  "docs/guides/planner.md",
  "docs/guides/terminal-surfaces.md",
  "docs/reference/cli-reference.md",
  "docs/reference/coordination-and-closure.md",
  "docs/reference/skills.md",
  "docs/reference/wave-control.md",
  "docs/plans/current-state.md",
  "docs/plans/master-plan.md",
  "docs/plans/migration.md",
  "docs/plans/architecture-hardening-migration.md",
  "docs/plans/end-state-architecture.md",
  "docs/plans/wave-orchestrator.md",
  "docs/research/coordination-failure-review.md",
  "docs/agents/wave-launcher-role.md",
  "docs/agents/wave-orchestrator-role.md",
  "docs/agents/wave-cont-qa-role.md",
  "docs/agents/wave-integration-role.md",
  "skills/README.md",
  "skills/wave-core/SKILL.md",
  "skills/wave-core/references/marker-syntax.md",
  "skills/runtime-codex/SKILL.md",
  "skills/runtime-claude/SKILL.md",
  "skills/runtime-opencode/SKILL.md",
  "skills/role-implementation/SKILL.md",
  "skills/role-integration/SKILL.md",
  "skills/role-documentation/SKILL.md",
  "skills/role-cont-qa/SKILL.md",
  "skills/role-security/SKILL.md",
  "skills/role-deploy/SKILL.md",
  "skills/role-infra/SKILL.md",
  "skills/repo-coding-rules/SKILL.md",
];

const bannedPhrases: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "launcher as scheduler truth and final authority",
    pattern: /The launcher remains the scheduler truth and final authority/i,
  },
  {
    label: "launcher-owned execution surface",
    pattern: /launcher-owned execution surface/i,
  },
  {
    label: "coordination log as sole source of truth",
    pattern: /The coordination log is the source of truth/i,
  },
  {
    label: "launcher-managed runtime artifacts wording",
    pattern: /managed by the launcher and operator tooling/i,
  },
  {
    label: "marker as unchallengeable authority",
    pattern: /authoritative state from that role/i,
  },
  {
    label: "gate marker authoritative for closure",
    pattern: /Treat the last gate marker and last verdict line as authoritative for closure/i,
  },
  {
    label: "board as scheduler source of truth",
    pattern: /scheduler'?s source of truth/i,
  },
];

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("docs architecture alignment", () => {
  it("keeps active docs and skills free of stale launcher-truth wording", () => {
    const failures: string[] = [];

    for (const relativePath of activeDocsAndSkills) {
      const source = read(relativePath);
      for (const banned of bannedPhrases) {
        if (banned.pattern.test(source)) {
          failures.push(`${relativePath}: ${banned.label}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("anchors the migration and operator docs on the authority-set architecture", () => {
    const migrationDoc = read("docs/plans/architecture-hardening-migration.md");
    const readme = read("README.md");
    const runbook = read("docs/plans/wave-orchestrator.md");
    const waveCoreSkill = read("skills/wave-core/SKILL.md");
    const migrationGuide = read("docs/plans/migration.md");
    const currentState = read("docs/plans/current-state.md");
    const endStateArchitecture = read("docs/plans/end-state-architecture.md");
    const cliReference = read("docs/reference/cli-reference.md");

    expect(readme).toContain("canonical authority set");
    expect(readme).toContain("CLI Surfaces");
    expect(runbook).toContain("immutable result envelopes");
    expect(runbook).toContain("thin orchestrator");
    expect(waveCoreSkill).toContain("canonical authority set");
    expect(waveCoreSkill).toContain("immutable attempt-scoped result artifacts");
    expect(migrationGuide).toContain("architecture-hardening-migration.md");
    expect(currentState).toContain("architecture-hardening-migration.md");
    expect(migrationDoc).toContain("Stage 0: Baseline Lock");
    expect(migrationDoc).toContain("Stage 3: Envelope-Authoritative Gate Evaluation");
    expect(migrationDoc).toContain("shared `0.7.3` parity suites");
    expect(endStateArchitecture).toContain("Runtime Module Layout");
    expect(endStateArchitecture).toContain("no longer part of the live runtime tree");
    expect(endStateArchitecture).toContain("projection writes");
    expect(endStateArchitecture).not.toContain(
      "The projection writer is the single module responsible for all non-canonical file writes.",
    );
    expect(endStateArchitecture).toContain(".tmp/<lane>-wave-launcher/inboxes/wave-<N>/shared-summary.md");
    expect(endStateArchitecture).toContain(".tmp/<lane>-wave-launcher/messageboards/wave-<N>.md");
    expect(endStateArchitecture).toContain(".tmp/<lane>-wave-launcher/waves.manifest.json");
    expect(cliReference).toContain("Command Families");
    expect(cliReference).toContain("--orchestrator-board <path>");
    expect(cliReference).toContain("--coordination-note <text>");
  });
});
