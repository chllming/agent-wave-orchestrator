import fs from "node:fs/promises";
import path from "node:path";

export const TOPIC_DEFINITIONS = [
  {
    id: "harnesses-and-practice",
    title: "Harnesses and Practice",
    description:
      "Current guidance and recent papers on agent harness design, reviewer loops, terminal-native execution, and practical coding-agent workflows.",
  },
  {
    id: "planning-and-orchestration",
    title: "Planning and Orchestration",
    description:
      "Planning topology, verifier and replanner loops, protocol-driven coordination, and blackboard-aware orchestration patterns for multi-agent systems.",
  },
  {
    id: "long-running-agents-and-compaction",
    title: "Long-Running Agents and Compaction",
    description:
      "Long-horizon execution, resumability, memory systems, compaction, and evolving-task evaluation for agents that span many sessions.",
  },
  {
    id: "skills-and-procedural-memory",
    title: "Skills and Procedural Memory",
    description:
      "Reusable skills, procedural memory, workflow induction, skill libraries, and evaluation patterns for agents that improve through reusable procedures.",
  },
  {
    id: "blackboard-and-shared-workspaces",
    title: "Blackboard and Shared Workspaces",
    description:
      "Shared-workspace coordination, blackboard-style agent systems, explicit consensus mechanics, and distributed reasoning under coordination constraints.",
  },
  {
    id: "repo-context-and-evaluation",
    title: "Repo Context and Evaluation",
    description:
      "Repository-level context files, harness evaluation methods, and evidence on what improves or harms coding-agent performance.",
  },
  {
    id: "security-and-secure-code-generation",
    title: "Security and Secure Code Generation",
    description:
      "Secure code generation, repair and analyzer loops, repository-grounded security benchmarks, and security/privacy risks in multi-agent systems.",
  },
];

export const PAPER_SECTION_ORDER = [
  "P0 direct hits",
  "P1 strong adjacent work",
  "P2 lineage and older references",
];

const PAPER_SECTION_OVERRIDES = {
  "an-open-agent-architecture": "P2 lineage and older references",
  "evaluating-agents-md-are-repository-level-context-files-helpful-for-coding-agents":
    "P1 strong adjacent work",
  "memory-for-autonomous-llm-agents-mechanisms-evaluation-and-emerging-frontiers":
    "P1 strong adjacent work",
};

const TOPIC_OVERRIDE_MAP = {
  "evaluating-agents-md-are-repository-level-context-files-helpful-for-coding-agents":
    ["repo-context-and-evaluation"],
};

const PLANNING_TOPIC_OVERRIDE_SLUGS = new Set([
  "building-effective-ai-coding-agents-for-the-terminal-scaffolding-harness-context-engineering-and-lessons-learned",
  "vero-an-evaluation-harness-for-agents-to-optimize-agents",
  "evoclaw-evaluating-ai-agents-on-continuous-software-evolution",
  "exploring-advanced-llm-multi-agent-systems-based-on-blackboard-architecture",
  "llm-based-multi-agent-blackboard-system-for-information-discovery-in-data-science",
  "dova-deliberation-first-multi-agent-orchestration-for-autonomous-research-automation",
  "symphony-synergistic-multi-agent-planning-with-heterogeneous-language-model-assembly",
  "silo-bench-a-scalable-environment-for-evaluating-distributed-coordination-in-multi-agent-llm-systems",
  "terrarium-revisiting-the-blackboard-for-multi-agent-safety-privacy-and-security-studies",
  "macc-multi-agent-collaborative-competition-for-scientific-exploration",
  "the-orchestration-of-multi-agent-systems-architectures-protocols-and-enterprise-adoption",
  "describing-agentic-ai-systems-with-c4-lessons-from-industry-projects",
  "verified-multi-agent-orchestration-a-plan-execute-verify-replan-framework-for-complex-query-resolution",
  "todoevolve-learning-to-architect-agent-planning-systems",
  "parallelized-planning-acting-for-efficient-llm-based-multi-agent-systems-in-minecraft",
  "orchmas-orchestrated-reasoning-with-multi-collaborative-heterogeneous-scientific-expert-structured-agents",
  "towards-engineering-multi-agent-llms-a-protocol-driven-approach",
  "advancing-multi-agent-systems-through-model-context-protocol-architecture-implementation-and-applications",
  "enhancing-model-context-protocol-mcp-with-context-aware-server-collaboration",
  "why-do-multi-agent-llm-systems-fail",
  "systematic-failures-in-collective-reasoning-under-distributed-information-in-multi-agent-llms",
  "dpbench-large-language-models-struggle-with-simultaneous-coordination",
  "multi-agent-teams-hold-experts-back",
  "a-survey-on-llm-based-multi-agent-systems-workflow-infrastructure-and-challenges",
  "llm-based-multi-agent-systems-for-software-engineering-literature-review-vision-and-the-road-ahead",
  "a-taxonomy-of-hierarchical-multi-agent-systems-design-patterns-coordination-mechanisms-and-industrial-applications",
  "blackboard-systems-part-one-the-blackboard-model-of-problem-solving-and-the-evolution-of-blackboard-architectures",
  "a-blackboard-architecture-for-control",
  "incremental-planning-to-control-a-blackboard-based-problem-solver",
  "blackboard-systems",
]);

const SKILLS_TOPIC_OVERRIDE_SLUGS = new Set([
  "memory-for-autonomous-llm-agents-mechanisms-evaluation-and-emerging-frontiers",
  "meta-context-engineering-via-agentic-skill-evolution",
]);

function escapeInlinePipes(value) {
  return String(value ?? "").replaceAll("|", "\\|");
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replaceAll("\u00a0", " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function safeSlugFromPath(relPath) {
  return path.basename(relPath, ".md");
}

function stripQuotes(value) {
  const text = String(value ?? "").trim();
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("\"") && text.endsWith("\""))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1] : "";
}

function parseFrontmatterScalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? stripQuotes(match[1]) : null;
}

function parseFrontmatterList(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\n((?:  - .*\\n?)*)`, "m"));
  if (!match) {
    return [];
  }
  return match[1]
    .split("\n")
    .map((line) => line.match(/^  - (.+)$/)?.[1] ?? null)
    .map((entry) => stripQuotes(entry))
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);
}

function extractFirstUrl(value) {
  const match = String(value ?? "").match(/\((https?:\/\/[^)]+)\)/);
  return match ? match[1] : null;
}

function parseMetadataRows(markdown) {
  const sectionMatch = markdown.match(/## Metadata\s+([\s\S]*?)(?:\n## |\n# |$)/);
  if (!sectionMatch) {
    return new Map();
  }

  const rows = new Map();
  for (const line of sectionMatch[1].split("\n")) {
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2 || cells[0] === "Field" || cells[0] === "---") {
      continue;
    }
    rows.set(cells[0].toLowerCase(), cells[1]);
  }
  return rows;
}

function parseYear(value) {
  if (!value) {
    return null;
  }
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

export function parseArchiveEntry(markdown, relPath) {
  const frontmatter = parseFrontmatter(markdown);
  const rows = parseMetadataRows(markdown);
  const kind =
    parseFrontmatterScalar(frontmatter, "kind") ??
    (relPath.startsWith("articles/") ? "article" : "paper");

  return {
    slug: safeSlugFromPath(relPath),
    path: relPath,
    kind,
    title: parseFrontmatterScalar(frontmatter, "title") ?? safeSlugFromPath(relPath),
    summary: parseFrontmatterScalar(frontmatter, "summary"),
    topics: parseFrontmatterList(frontmatter, "topics"),
    year: parseYear(rows.get("year")),
    venue: normalizeWhitespace(rows.get("venue")),
    bucket: normalizeWhitespace(rows.get("research bucket")),
    mapsTo: normalizeWhitespace(rows.get("maps to")),
    fit: normalizeWhitespace(rows.get("harness fit")),
    sourcePage: extractFirstUrl(rows.get("source page")),
    sourcePdf: extractFirstUrl(rows.get("source pdf")),
    additionalSource: extractFirstUrl(rows.get("additional source")),
    additionalPdf: extractFirstUrl(rows.get("additional pdf")),
  };
}

export function parsePaperSectionMap(indexMarkdown) {
  const sectionMap = new Map();
  let currentSection = null;

  for (const line of String(indexMarkdown).split("\n")) {
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
      continue;
    }
    const match = line.match(
      /\]\((?:(?:\.\/|\.\.\/)(?:papers\/)?|\/(?:[^)]+\/)?agent-context-cache\/(?:papers\/)?)?([a-z0-9-]+)(?:\.md)?\)/i,
    );
    if (!match || !currentSection) {
      continue;
    }
    sectionMap.set(match[1], currentSection);
  }

  return sectionMap;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function inferTopics(entry, section = null) {
  const topics = [...(entry.topics ?? [])];
  const override = TOPIC_OVERRIDE_MAP[entry.slug];
  if (override) {
    topics.push(...override);
  }
  const hasDeclaredTopics = topics.length > 0;
  if (PLANNING_TOPIC_OVERRIDE_SLUGS.has(entry.slug)) {
    topics.push("planning-and-orchestration");
  }
  if (SKILLS_TOPIC_OVERRIDE_SLUGS.has(entry.slug)) {
    topics.push("skills-and-procedural-memory");
  }

  if (hasDeclaredTopics) {
    return unique(topics);
  }

  const haystack = `${entry.slug} ${entry.title} ${entry.mapsTo} ${entry.fit}`.toLowerCase();

  if (
    /agents-md|repository-level|repo context|repository context|evaluation harness|benchmark/.test(
      haystack,
    )
  ) {
    topics.push("repo-context-and-evaluation");
  }

  if (
    /blackboard|shared workspace|shared workspaces|distributed coordination|coordination|consensus|communication-reasoning gap|silo-bench|symphony|dova|open agent architecture/.test(
      haystack,
    )
  ) {
    topics.push("blackboard-and-shared-workspaces");
  }

  if (
    /long-running|long horizon|long-horizon|compaction|context engineering|memory|continuous software evolution|resumability|initializer|trace|versioned snapshots|reviewer loop/.test(
      haystack,
    )
  ) {
    topics.push("long-running-agents-and-compaction");
  }

  if (
    /skill|procedural memory|workflow memory|skill library|voyager|toolformer|tool makers|synapse|expel|reuseit|skillweaver|procmem|memskill|memento-skills|metaclaw/.test(
      haystack,
    )
  ) {
    topics.push("skills-and-procedural-memory");
  }

  if (
    entry.kind === "article" || /harness|codex|terminal|engineering|reviewer|agent-first/.test(haystack)
  ) {
    topics.push("harnesses-and-practice");
  }

  if (
    /security|secure code|secure coding|vulnerability|vulnerabilities|cve|static analyzer|codeql|secureagentbench|secrepobench|secodeplt|tosss|privacy/.test(
      haystack,
    )
  ) {
    topics.push("security-and-secure-code-generation");
  }

  if (topics.length === 0) {
    topics.push(entry.kind === "article" ? "harnesses-and-practice" : "long-running-agents-and-compaction");
  }

  return unique(topics);
}

export async function loadArchiveEntries(archiveRoot) {
  const entries = [];

  for (const folder of ["papers", "articles"]) {
    const dirPath = path.join(archiveRoot, folder);
    let fileNames = [];
    try {
      fileNames = await fs.readdir(dirPath);
    } catch {
      continue;
    }

    for (const fileName of fileNames.sort()) {
      if (!fileName.endsWith(".md") || fileName === "index.md") {
        continue;
      }
      const relPath = path.posix.join(folder, fileName);
      const markdown = await fs.readFile(path.join(archiveRoot, relPath), "utf8");
      entries.push(parseArchiveEntry(markdown, relPath));
    }
  }

  return entries.sort((left, right) => left.title.localeCompare(right.title));
}

function relativeLink(fromDir, toPath) {
  return path.relative(fromDir, toPath).split(path.sep).join("/");
}

function formatLocalLink(fromDir, targetPath, label) {
  const relPath = relativeLink(fromDir, targetPath);
  return `[${escapeInlinePipes(label)}](${relPath})`;
}

function formatSourceLink(entry) {
  const url = entry.sourcePage ?? entry.additionalSource ?? entry.sourcePdf ?? entry.additionalPdf;
  return url ? `[Source](${url})` : "—";
}

function formatCell(value, fallback = "—") {
  const normalized = normalizeWhitespace(value);
  return normalized ? escapeInlinePipes(normalized) : fallback;
}

function renderTable(headers, rows) {
  const headerLine = `| ${headers.join(" | ")} |`;
  const dividerLine = `| ${headers.map(() => "---").join(" | ")} |`;
  return [headerLine, dividerLine, ...rows].join("\n");
}

export function buildPaperSectionAssignments(entries, existingSectionMap) {
  const assignments = new Map();
  for (const entry of entries.filter((item) => item.kind === "paper")) {
    const requestedBucket = PAPER_SECTION_ORDER.includes(entry.bucket) ? entry.bucket : null;
    assignments.set(
      entry.slug,
      existingSectionMap.get(entry.slug) ??
        requestedBucket ??
        PAPER_SECTION_OVERRIDES[entry.slug] ??
        "P2 lineage and older references",
    );
  }
  return assignments;
}

export function renderPaperIndex(entries, sectionAssignments) {
  const paperEntries = entries.filter((entry) => entry.kind === "paper");
  const grouped = new Map(PAPER_SECTION_ORDER.map((section) => [section, []]));
  for (const entry of paperEntries) {
    const section = sectionAssignments.get(entry.slug) ?? "P2 lineage and older references";
    if (!grouped.has(section)) {
      grouped.set(section, []);
    }
    grouped.get(section).push(entry);
  }

  const sections = PAPER_SECTION_ORDER.filter((section) => (grouped.get(section) ?? []).length > 0).map(
    (section) => {
      const rows = grouped
        .get(section)
        .slice()
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((entry) => {
          const fileLabel = formatLocalLink("papers", path.posix.join("papers", `${entry.slug}.md`), entry.title);
          return `| ${fileLabel} | ${entry.year ?? "Unknown"} | ${formatCell(entry.venue)} | ${formatCell(entry.mapsTo)} | ${formatCell(entry.fit)} | ${formatSourceLink(entry)} |`;
        });
      return `## ${section}\n\n${renderTable(
        ["Paper", "Year", "Venue", "Maps to", "Fit", "Source"],
        rows,
      )}`;
    },
  );

  return `---
summary: "Index of local-only agent-context papers and reports converted to Markdown with source links"
read_when:
  - Browsing the local harness and blackboard paper archive
  - Looking for the paper copy of a source in the local cache
title: "Paper Archive"
---

# Paper Archive

<Note>
This local-only archive contains ${paperEntries.length} papers and reports. Source
documents were fetched transiently, converted to Markdown, and removed from
disk after extraction. This directory is gitignored and is not shipped as part
of the repository docs.
</Note>

## Coverage

- Harnesses and practice
- Planning and orchestration
- Long-running agents and compaction
- Skills and procedural memory
- Blackboard and shared workspaces
- Repo context and evaluation
- Security and secure code generation

${sections.join("\n\n")}
`;
}

export function renderArticleIndex(entries) {
  const articleEntries = entries.filter((entry) => entry.kind === "article");
  const rows = articleEntries
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title))
    .map((entry) => {
      const localLink = formatLocalLink(
        "articles",
        path.posix.join("articles", `${entry.slug}.md`),
        entry.title,
      );
      return `| ${localLink} | ${entry.year ?? "Unknown"} | ${formatCell(entry.venue)} | ${formatCell(entry.mapsTo)} | ${formatSourceLink(entry)} |`;
    });

  return `---
summary: "Index of local-only practice articles cached alongside the agent-context paper archive"
read_when:
  - Browsing current practice articles in the local harness archive
  - Jumping from topic indexes into cached OpenAI and Anthropic guidance
title: "Practice Articles"
---

# Practice Articles

<Note>
These cached articles are local-only working copies of vendor guidance that was
useful for the harness archive. The source URLs remain the canonical
references.
</Note>

${renderTable(["Article", "Year", "Venue", "Maps to", "Source"], rows)}
`;
}

export function buildTopicGroups(entries, sectionAssignments) {
  const groups = new Map(TOPIC_DEFINITIONS.map((topic) => [topic.id, []]));
  for (const entry of entries) {
    const section = entry.kind === "paper" ? sectionAssignments.get(entry.slug) : null;
    for (const topic of inferTopics(entry, section)) {
      if (!groups.has(topic)) {
        groups.set(topic, []);
      }
      groups.get(topic).push(entry);
    }
  }
  return groups;
}

function renderTopicList(fromDir, entries) {
  return entries
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title))
    .map((entry) => {
      const targetPath = path.posix.join(entry.kind === "article" ? "articles" : "papers", `${entry.slug}.md`);
      const localLink = formatLocalLink(fromDir, targetPath, entry.title);
      const label = entry.kind === "article" ? "Article" : "Paper";
      return `- ${localLink} (${label}; ${entry.year ?? "Unknown"}; ${formatCell(entry.venue)})`;
    })
    .join("\n");
}

export function renderTopicsIndex(topicGroups) {
  const lines = TOPIC_DEFINITIONS.map((topic) => {
    const count = (topicGroups.get(topic.id) ?? []).length;
    return `- [${topic.title}](./${topic.id}.md) (${count})\n  ${topic.description}`;
  }).join("\n");

  return `---
summary: "Topic-based guides into the local-only agent-context archive"
read_when:
  - You want to browse the local archive by theme instead of by source type
  - You are building a future reading list around a specific agent-system topic
title: "Topic Indexes"
---

# Topic Indexes

<Note>
These indexes group the whole local archive by theme while leaving the cached
Markdown files flat in their original \`papers/\` and \`articles/\` directories.
</Note>

${lines}
`;
}

export function renderTopicPage(topic, entries) {
  const articleEntries = entries.filter((entry) => entry.kind === "article");
  const paperEntries = entries.filter((entry) => entry.kind === "paper");
  const sections = [];

  if (articleEntries.length > 0) {
    sections.push(`## Articles\n\n${renderTopicList("topics", articleEntries)}`);
  }
  if (paperEntries.length > 0) {
    sections.push(`## Papers and reports\n\n${renderTopicList("topics", paperEntries)}`);
  }

  return `---
summary: '${topic.description.replaceAll("'", "''")}'
read_when:
  - You want a curated reading slice of the local agent-context archive
  - You need related practice articles and papers in one place
title: '${topic.title.replaceAll("'", "''")}'
---

# ${topic.title}

<Note>
${topic.description} This page is a local-only grouping aid for the cache under
\`docs/research/agent-context-cache/\`.
</Note>

${sections.join("\n\n")}
`;
}
