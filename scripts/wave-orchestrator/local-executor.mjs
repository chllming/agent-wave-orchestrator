import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, ensureDirectory } from "./shared.mjs";
import { isContEvalReportPath } from "./role-helpers.mjs";

function titleFromPath(relPath) {
  return path
    .basename(relPath, path.extname(relPath))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractAssignedPrompt(raw) {
  const match = raw.match(/Assigned implementation prompt:\s*```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : raw;
}

function extractAgentId(rawPrompt) {
  const match = String(rawPrompt || "").match(
    /You are the Wave executor running Wave \d+ \/ Agent ([A-Za-z0-9.]+):/,
  );
  return match ? match[1].trim() : "";
}

function extractRoleAgentIds(rawPrompt) {
  const contQaMatch = String(rawPrompt || "").match(/- cont-QA agent id:\s*([A-Za-z0-9.]+)/);
  const contEvalMatch = String(rawPrompt || "").match(/- cont-EVAL agent id:\s*([A-Za-z0-9.]+)/);
  const integrationMatch = String(rawPrompt || "").match(
    /- Integration steward agent id:\s*([A-Za-z0-9.]+)/,
  );
  const documentationMatch = String(rawPrompt || "").match(
    /- Documentation steward agent id:\s*([A-Za-z0-9.]+)/,
  );
  return {
    contQaAgentId: contQaMatch ? contQaMatch[1].trim() : "A0",
    contEvalAgentId: contEvalMatch ? contEvalMatch[1].trim() : "E0",
    integrationAgentId: integrationMatch ? integrationMatch[1].trim() : "A8",
    documentationAgentId: documentationMatch ? documentationMatch[1].trim() : "A9",
  };
}

function extractOwnedComponents(rawPrompt) {
  const lines = String(rawPrompt || "").split(/\r?\n/);
  const components = [];
  let inComponents = false;
  for (const line of lines) {
    if (/^\s*Components you own in this wave:\s*$/i.test(line)) {
      inComponents = true;
      continue;
    }
    if (inComponents && /^\s*[A-Za-z][A-Za-z0-9 _/-]*:\s*$/.test(line)) {
      inComponents = false;
    }
    if (!inComponents) {
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+([a-z0-9._-]+)(?:\s*:\s*([a-z0-9._-]+))?\s*$/i);
    if (!bulletMatch) {
      continue;
    }
    components.push({
      componentId: bulletMatch[1],
      level: bulletMatch[2] || null,
    });
  }
  return components;
}

function extractDeliverablesFromList(text, headingPattern) {
  const out = [];
  let inList = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (headingPattern.test(line)) {
      inList = true;
      continue;
    }
    if (inList && /^\s*[A-Za-z][A-Za-z0-9 _-]*:\s*$/.test(line)) {
      inList = false;
    }
    if (!inList) {
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!bulletMatch) {
      continue;
    }
    const cleaned = bulletMatch[1].replace(/[`"']/g, "").trim();
    if (
      cleaned.includes("/") ||
      /\.(md|mdx|js|mjs|ts|go|json|yaml|yml|sh|sql)$/.test(cleaned)
    ) {
      out.push(cleaned);
    }
  }
  return out;
}

function extractDeliverables(rawPrompt, promptText) {
  const explicit = extractDeliverablesFromList(
    rawPrompt,
    /^\s*Deliverables required for this agent:\s*$/i,
  );
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }
  const out = extractDeliverablesFromList(promptText, /^\s*File ownership\b/i);
  for (const line of String(promptText || "").split(/\r?\n/)) {
    const match = line.match(/^\s*\d+[.)]\s*(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const cleaned = match[1].replace(/[`"']/g, "").trim();
    if (cleaned.includes("/") || /\.(md|mdx|js|mjs|ts|go|json|yaml|yml|sh)$/.test(cleaned)) {
      out.push(cleaned);
    }
  }
  return Array.from(new Set(out));
}

function extractFileOwnershipPaths(promptText) {
  return Array.from(
    new Set(extractDeliverablesFromList(promptText, /^\s*File ownership\b/i)),
  );
}

function extractEvalMarkerPayload(rawPrompt) {
  const lines = String(rawPrompt || "").split(/\r?\n/);
  const targetIds = [];
  const benchmarkIds = [];
  let inTargets = false;
  for (const line of lines) {
    if (/^\s*Eval targets for this wave:\s*$/i.test(line)) {
      inTargets = true;
      continue;
    }
    if (inTargets && !line.trim()) {
      break;
    }
    if (!inTargets) {
      continue;
    }
    const match = line.match(/^\s*-\s+([a-z0-9._-]+):\s+(.+)\s*$/i);
    if (!match) {
      continue;
    }
    targetIds.push(match[1].toLowerCase());
    const payload = match[2];
    const benchmarkMatch =
      payload.match(/\bbenchmarks=([a-z0-9._\-,\s]+)/i) ||
      payload.match(/\ballowed-benchmarks=([a-z0-9._\-,\s]+)/i);
    if (!benchmarkMatch) {
      continue;
    }
    for (const benchmarkId of benchmarkMatch[1].split(",")) {
      const normalized = benchmarkId.trim().toLowerCase();
      if (normalized) {
        benchmarkIds.push(normalized);
      }
    }
  }
  return {
    targetIds: Array.from(new Set(targetIds)).sort(),
    benchmarkIds: Array.from(new Set(benchmarkIds)).sort(),
  };
}

function formatWaveEvalLine(evalMarker, detail) {
  const targetIds = Array.isArray(evalMarker?.targetIds) ? evalMarker.targetIds : [];
  const benchmarkIds = Array.isArray(evalMarker?.benchmarkIds) ? evalMarker.benchmarkIds : [];
  const targetIdSegment = targetIds.length > 0 ? ` target_ids=${targetIds.join(",")}` : "";
  const benchmarkIdSegment =
    benchmarkIds.length > 0 ? ` benchmark_ids=${benchmarkIds.join(",")}` : "";
  return `[wave-eval] state=satisfied targets=${targetIds.length} benchmarks=${benchmarkIds.length} regressions=0${targetIdSegment}${benchmarkIdSegment} detail=${detail}`;
}

function isDesignAgentPrompt(rawPrompt) {
  const text = String(rawPrompt || "");
  return /\[wave-design\]/i.test(text) || /\bwave design\b/i.test(text);
}

export function resolveRepoOwnedDeliverablePath(relPath) {
  if (!relPath || path.isAbsolute(relPath)) {
    throw new Error(`Unsafe deliverable path: ${String(relPath || "")}`);
  }
  const absPath = path.resolve(REPO_ROOT, relPath);
  const relative = path.relative(REPO_ROOT, absPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Deliverable escapes repo root: ${relPath}`);
  }
  return absPath;
}

function markdownTemplate(relPath, promptText, options = {}) {
  const requirements = promptText
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .slice(0, 12);

  return [
    `# ${titleFromPath(relPath)}`,
    "",
    "Generated by `wave-local-executor` for smoke-testing the Wave framework.",
    "",
    "## Objective",
    `Create an implementation-ready placeholder for \`${relPath}\` so the local executor path can complete.`,
    "",
    "## Scope",
    ...(requirements.length > 0
      ? requirements.map((item) => `- ${item}`)
      : ["- Derived from assigned wave prompt."]),
    "",
    ...(options.contQaReport ? ["## Verdict", "Verdict: PASS", ""] : []),
    "## Note",
    "- Replace this placeholder with real implementation work before relying on it.",
    "",
  ].join("\n");
}

function sourceTemplate(relPath) {
  return [
    "// Generated by wave-local-executor for smoke-testing only.",
    `// Source deliverable: ${relPath}`,
    "",
    "export {};",
    "",
  ].join("\n");
}

function writeDeliverable(relPath, promptText, options = {}) {
  const absPath = resolveRepoOwnedDeliverablePath(relPath);
  ensureDirectory(path.dirname(absPath));
  if (fs.existsSync(absPath)) {
    return "exists";
  }
  if (/\.(md|mdx)$/i.test(absPath)) {
    const contQaReport =
      options.contQaAgent === true &&
      /(?:^|\/)(?:reviews?|.*cont[-_]?qa).*\.(md|mdx)$/i.test(relPath);
    fs.writeFileSync(
      absPath,
      `${markdownTemplate(relPath, promptText, { contQaReport })}\n`,
      "utf8",
    );
    return "created";
  }
  fs.writeFileSync(absPath, `${sourceTemplate(relPath)}\n`, "utf8");
  return "created";
}

function parseArgs(argv) {
  const options = { promptFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--prompt-file") {
      options.promptFile = argv[++i] ? path.resolve(REPO_ROOT, argv[i]) : null;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, options };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.promptFile) {
    throw new Error("--prompt-file is required");
  }
  return { help: false, options };
}

export function runLocalExecutorCli(argv) {
  const { help, options } = parseArgs(argv);
  if (help) {
    console.log("Usage: pnpm exec wave local --prompt-file <path>");
    return;
  }
  const rawPrompt = fs.readFileSync(options.promptFile, "utf8");
  const agentId = extractAgentId(rawPrompt);
  const { contQaAgentId, contEvalAgentId, integrationAgentId, documentationAgentId } =
    extractRoleAgentIds(rawPrompt);
  const contQaAgent = agentId === contQaAgentId;
  const contEvalAgent = agentId === contEvalAgentId;
  const integrationAgent = agentId === integrationAgentId;
  const designAgent = isDesignAgentPrompt(rawPrompt);
  const implementationMarkersRequired = /\[wave-proof\]/i.test(rawPrompt);
  const ownedComponents = extractOwnedComponents(rawPrompt);
  const assignedPrompt = extractAssignedPrompt(rawPrompt);
  const ownedPaths = extractFileOwnershipPaths(assignedPrompt);
  const deliverables = extractDeliverables(rawPrompt, assignedPrompt);
  const evalMarker = extractEvalMarkerPayload(rawPrompt);
  const contEvalImplementationOwning =
    contEvalAgent &&
    ownedPaths.some((ownedPath) => !isContEvalReportPath(ownedPath));
  if (deliverables.length === 0) {
    console.log("[local-executor] no deliverables detected; nothing to do.");
    if (contQaAgent) {
      console.log(
        "[wave-gate] architecture=pass integration=pass durability=pass live=pass docs=pass detail=local-executor-no-deliverables",
      );
      console.log("[wave-verdict] pass detail=local-executor-no-deliverables");
    } else if (contEvalAgent) {
      console.log(formatWaveEvalLine(evalMarker, "local-executor-no-deliverables"));
      if (contEvalImplementationOwning) {
        console.log(
          "[wave-proof] completion=contract durability=none proof=unit state=met detail=local-executor-no-deliverables",
        );
        console.log("[wave-doc-delta] state=none detail=local-executor-no-deliverables");
      }
    } else if (integrationAgent) {
      console.log(
        "[wave-integration] state=ready-for-doc-closure claims=0 conflicts=0 blockers=0 detail=local-executor-no-deliverables",
      );
    } else if (designAgent) {
      console.log(
        "[wave-design] state=ready-for-implementation decisions=1 assumptions=1 open_questions=0 detail=local-executor-no-deliverables",
      );
      if (implementationMarkersRequired) {
        console.log(
          "[wave-proof] completion=contract durability=none proof=unit state=met detail=local-executor-no-deliverables",
        );
        console.log("[wave-doc-delta] state=none detail=local-executor-no-deliverables");
        for (const component of ownedComponents) {
          console.log(
            `[wave-component] component=${component.componentId} level=${component.level || "repo-landed"} state=met detail=local-executor-no-deliverables`,
          );
        }
      }
    } else if (agentId === documentationAgentId) {
      console.log("[wave-doc-closure] state=no-change detail=local-executor-no-deliverables");
    } else if (agentId) {
      console.log(
        "[wave-proof] completion=contract durability=none proof=unit state=met detail=local-executor-no-deliverables",
      );
      console.log("[wave-doc-delta] state=none detail=local-executor-no-deliverables");
      for (const component of ownedComponents) {
        console.log(
          `[wave-component] component=${component.componentId} level=${component.level || "repo-landed"} state=met detail=local-executor-no-deliverables`,
        );
      }
    }
    return;
  }
  console.log(`[local-executor] prompt=${path.relative(REPO_ROOT, options.promptFile)}`);
  console.log(`[local-executor] deliverables=${deliverables.join(", ")}`);
  for (const deliverable of deliverables) {
    console.log(
      `[local-executor] ${writeDeliverable(deliverable, assignedPrompt, { contQaAgent })}: ${deliverable}`,
    );
  }
  if (contQaAgent) {
    console.log(
      "[wave-gate] architecture=pass integration=pass durability=pass live=pass docs=pass detail=local-executor-smoke",
    );
    console.log("[wave-verdict] pass detail=local-executor-smoke");
  } else if (contEvalAgent) {
    console.log(formatWaveEvalLine(evalMarker, "local-executor-smoke"));
    if (contEvalImplementationOwning) {
      console.log(
        "[wave-proof] completion=contract durability=none proof=unit state=met detail=local-executor-smoke",
      );
      console.log("[wave-doc-delta] state=none detail=local-executor-smoke");
      for (const component of ownedComponents) {
        console.log(
          `[wave-component] component=${component.componentId} level=${component.level || "repo-landed"} state=met detail=local-executor-smoke`,
        );
      }
    }
  } else if (integrationAgent) {
    console.log(
      "[wave-integration] state=ready-for-doc-closure claims=0 conflicts=0 blockers=0 detail=local-executor-smoke",
    );
  } else if (designAgent) {
    console.log(
      "[wave-design] state=ready-for-implementation decisions=2 assumptions=1 open_questions=0 detail=local-executor-smoke",
    );
    if (implementationMarkersRequired) {
      console.log(
        "[wave-proof] completion=contract durability=none proof=unit state=met detail=local-executor-smoke",
      );
      console.log("[wave-doc-delta] state=owned detail=local-executor-smoke");
      for (const component of ownedComponents) {
        console.log(
          `[wave-component] component=${component.componentId} level=${component.level || "repo-landed"} state=met detail=local-executor-smoke`,
        );
      }
    }
  } else if (agentId === documentationAgentId) {
    console.log("[wave-doc-closure] state=no-change detail=local-executor-smoke");
  } else if (agentId) {
    console.log(
      "[wave-proof] completion=contract durability=none proof=unit state=met detail=local-executor-smoke",
    );
    console.log("[wave-doc-delta] state=owned detail=local-executor-smoke");
    for (const component of ownedComponents) {
      console.log(
        `[wave-component] component=${component.componentId} level=${component.level || "repo-landed"} state=met detail=local-executor-smoke`,
      );
    }
  }
  console.log("[local-executor] completed.");
}
