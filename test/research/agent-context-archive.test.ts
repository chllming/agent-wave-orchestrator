import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPaperSectionAssignments,
  buildTopicGroups,
  inferTopics,
  loadArchiveEntries,
  parseArchiveEntry,
  parsePaperSectionMap,
} from "../../scripts/research/agent-context-archive.mjs";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-agent-context-archive-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseArchiveEntry", () => {
  it("reads frontmatter topics and metadata rows from cached markdown", () => {
    const entry = parseArchiveEntry(
      `---
summary: 'Cached article text and source links for Writing effective tools for agents.'
read_when:
  - Reviewing tool design guidance
topics:
  - harnesses-and-practice
kind: 'article'
title: 'Writing effective tools for agents'
---

# Writing effective tools for agents

## Metadata

| Field | Value |
| --- | --- |
| Content type | Article |
| Year | 2025 |
| Venue | Anthropic Engineering |
| Research bucket | Practice and harness patterns |
| Maps to | Tool schema design and token-efficient responses. |
| Harness fit | Directly informs tool contract design. |
| Source page | [Open source](https://www.anthropic.com/engineering/writing-tools-for-agents) |
`,
      "articles/writing-effective-tools-for-agents.md",
    );

    expect(entry.kind).toBe("article");
    expect(entry.slug).toBe("writing-effective-tools-for-agents");
    expect(entry.topics).toEqual(["harnesses-and-practice"]);
    expect(entry.year).toBe(2025);
    expect(entry.sourcePage).toBe("https://www.anthropic.com/engineering/writing-tools-for-agents");
  });
});

describe("parsePaperSectionMap", () => {
  it("preserves section assignments from the existing local paper index", () => {
    const sectionMap = parsePaperSectionMap(`
## P1 strong adjacent work

| Paper | Year | Venue | Maps to | Fit | Source |
| --- | --- | --- | --- | --- | --- |
| [Evaluating AGENTS.md](../papers/evaluating-agents-md-are-repository-level-context-files-helpful-for-coding-agents.md) | 2026 | ICML | Context files | Fit | [Source](https://arxiv.org/abs/2602.11988) |

## P2 lineage and older references

| Paper | Year | Venue | Maps to | Fit | Source |
| --- | --- | --- | --- | --- | --- |
| [An Open Agent Architecture](./an-open-agent-architecture.md) | 1994 | AAAI | Blackboard | Fit | [Source](https://cdn.aaai.org/Symposia/Spring/1994/SS-94-03/SS94-03-001.pdf) |
`);

    expect(sectionMap.get("evaluating-agents-md-are-repository-level-context-files-helpful-for-coding-agents")).toBe(
      "P1 strong adjacent work",
    );
    expect(sectionMap.get("an-open-agent-architecture")).toBe("P2 lineage and older references");
  });
});

describe("topic inference and grouping", () => {
  it("classifies existing cache entries by topic when frontmatter tags are absent", () => {
    const topics = inferTopics({
      slug: "vero-an-evaluation-harness-for-agents-to-optimize-agents",
      title: "VeRO: An Evaluation Harness for Agents to Optimize Agents",
      mapsTo: "Versioned traces, long-running evaluation, and controlled budgets.",
      fit: "Makes harness evaluation reproducible across edit-execute-evaluate loops.",
      kind: "paper",
      topics: [],
    });

    expect(topics).toContain("repo-context-and-evaluation");
    expect(topics).toContain("long-running-agents-and-compaction");
  });

  it("classifies secure-coding benchmarks into the security topic", () => {
    const topics = inferTopics({
      slug: "secureagentbench-benchmarking-secure-code-generation-under-realistic-vulnerability-scenarios",
      title: "SecureAgentBench: Benchmarking Secure Code Generation under Realistic Vulnerability Scenarios",
      mapsTo: "Secure code generation benchmark tasks grounded in realistic vulnerability scenarios.",
      fit: "Checks whether security improvements hold under more realistic attack conditions.",
      kind: "paper",
      topics: [],
    });

    expect(topics).toContain("security-and-secure-code-generation");
    expect(topics).toContain("repo-context-and-evaluation");
  });

  it("adds planning as an override topic without removing existing categories", () => {
    const topics = inferTopics({
      slug: "symphony-synergistic-multi-agent-planning-with-heterogeneous-language-model-assembly",
      title: "SYMPHONY: Synergistic Multi-agent Planning with Heterogeneous Language Model Assembly",
      mapsTo: "Heterogeneous agent pools and multi-agent planning.",
      fit: "Broadens the coordination design space while staying relevant to shared-workspace orchestration.",
      kind: "paper",
      topics: ["blackboard-and-shared-workspaces"],
    });

    expect(topics).toContain("planning-and-orchestration");
    expect(topics).toContain("blackboard-and-shared-workspaces");
  });

  it("adds skills as an override topic without removing existing categories", () => {
    const topics = inferTopics({
      slug: "memory-for-autonomous-llm-agents-mechanisms-evaluation-and-emerging-frontiers",
      title: "Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers",
      mapsTo: "Memory architecture, procedural memory, retrieval, reflection, and policy-aware context management.",
      fit: "Adds a concrete memory survey that overlaps with reusable skill systems.",
      kind: "paper",
      topics: ["long-running-agents-and-compaction"],
    });

    expect(topics).toContain("skills-and-procedural-memory");
    expect(topics).toContain("long-running-agents-and-compaction");
  });

  it("adds cooperation as an override topic without removing existing categories", () => {
    const topics = inferTopics({
      slug: "cooperbench-why-coding-agents-cannot-be-your-teammates-yet",
      title: "CooperBench: Why Coding Agents Cannot be Your Teammates Yet",
      mapsTo:
        "Collaborative coding benchmark for inter-agent cooperation, communication quality, commitment tracking, and coordination failures.",
      fit: "Direct benchmark for whether coding agents behave like usable teammates instead of isolated solo solvers.",
      kind: "paper",
      topics: ["planning-and-orchestration"],
    });

    expect(topics).toContain("planning-and-orchestration");
    expect(topics).toContain("agent-cooperation-and-coordination");
  });

  it("loads entries from the archive tree and groups them by section and topic", async () => {
    const archiveRoot = makeTempDir();
    fs.mkdirSync(path.join(archiveRoot, "papers"), { recursive: true });
    fs.mkdirSync(path.join(archiveRoot, "articles"), { recursive: true });
    fs.writeFileSync(
      path.join(archiveRoot, "papers", "memory-for-autonomous-llm-agents-mechanisms-evaluation-and-emerging-frontiers.md"),
      `---
title: 'Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers'
---

## Metadata

| Field | Value |
| --- | --- |
| Year | 2026 |
| Venue | arXiv 2603.07670 |
| Research bucket | P1 strong adjacent work |
| Maps to | Memory architecture, compaction, retrieval, reflection. |
| Harness fit | Adds a concrete long-running agent memory survey. |
| Source page | [Open source](https://arxiv.org/abs/2603.07670) |
`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(archiveRoot, "articles", "run-long-horizon-tasks-with-codex.md"),
      `---
topics:
  - harnesses-and-practice
kind: 'article'
title: 'Run long horizon tasks with Codex'
---

## Metadata

| Field | Value |
| --- | --- |
| Year | 2025 |
| Venue | OpenAI Developers |
| Maps to | Harness loops and resumability. |
| Harness fit | Long-running loops matter more than one giant prompt. |
| Source page | [Open source](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex/) |
`,
      "utf8",
    );

    const entries = await loadArchiveEntries(archiveRoot);
    const sections = buildPaperSectionAssignments(entries, new Map());
    const topicGroups = buildTopicGroups(entries, sections);

    expect(entries).toHaveLength(2);
    expect(sections.get("memory-for-autonomous-llm-agents-mechanisms-evaluation-and-emerging-frontiers")).toBe(
      "P1 strong adjacent work",
    );
    expect(
      topicGroups
        .get("long-running-agents-and-compaction")
        ?.some(
          (entry) =>
            entry.slug === "memory-for-autonomous-llm-agents-mechanisms-evaluation-and-emerging-frontiers",
        ),
    ).toBe(true);
    expect(
      topicGroups
        .get("harnesses-and-practice")
        ?.some((entry) => entry.slug === "run-long-horizon-tasks-with-codex"),
    ).toBe(true);
  });
});
