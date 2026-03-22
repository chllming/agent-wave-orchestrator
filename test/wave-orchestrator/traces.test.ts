import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { readAgentExecutionSummary, writeAgentExecutionSummary } from "../../scripts/wave-orchestrator/agent-state.mjs";
import {
  appendCoordinationRecord,
  readMaterializedCoordinationState,
} from "../../scripts/wave-orchestrator/coordination-store.mjs";
import { buildGateSnapshot } from "../../scripts/wave-orchestrator/launcher.mjs";
import { deriveWaveLedger } from "../../scripts/wave-orchestrator/ledger.mjs";
import { replayTraceBundle } from "../../scripts/wave-orchestrator/replay.mjs";
import { PACKAGE_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";
import {
  buildQualityMetrics,
  loadTraceBundle,
  validateTraceBundle,
  writeTraceBundle,
} from "../../scripts/wave-orchestrator/traces.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-traces-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function makeLanePaths(dir, componentMatrixJsonPath, componentMatrixDocPath) {
  return {
    lane: "main",
    runVariant: "live",
    componentCutoverMatrixJsonPath: componentMatrixJsonPath,
    componentCutoverMatrixDocPath: componentMatrixDocPath,
    evaluatorAgentId: "A0",
    integrationAgentId: "A8",
    documentationAgentId: "A9",
    requireIntegrationStewardFromWave: 0,
    requireComponentPromotionsFromWave: 0,
    laneProfile: {
      roles: {
        evaluatorAgentId: "A0",
        integrationAgentId: "A8",
        documentationAgentId: "A9",
      },
      validation: {
        requireComponentPromotionsFromWave: 0,
      },
    },
    tracesDir: path.join(dir, "traces"),
  };
}

function makeStatus(statusPath, code = 0) {
  writeJson(statusPath, {
    code,
    promptHash: `prompt-${path.basename(statusPath)}`,
    orchestratorId: "orch-1",
    completedAt: "2026-03-21T00:05:00.000Z",
  });
}

function makeSummary(statusPath, summary) {
  writeAgentExecutionSummary(statusPath, summary);
}

function runWaveCli(args, cwd) {
  return spawnSync("node", [path.join(PACKAGE_ROOT, "scripts", "wave.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

function listFilesRecursively(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  const visit = (targetDir) => {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      const fullPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  };
  visit(dir);
  return files.toSorted();
}

function traceAttemptDirForRepo(repoDir, attempt = 1) {
  return path.join(repoDir, ".tmp", "main-wave-launcher", "traces", "wave-0", `attempt-${attempt}`);
}

function updateWaveConfig(repoDir, mutate) {
  const filePath = path.join(repoDir, "wave.config.json");
  const current = readJson(filePath);
  const next = mutate(JSON.parse(JSON.stringify(current))) || current;
  writeJson(filePath, next);
  return next;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAgentExecutorBlock(markdown, agentId, blockLines) {
  const pattern = new RegExp(
    `(## Agent ${escapeRegex(agentId)}:[\\s\\S]*?### Executor\\n\\n)[\\s\\S]*?(?=\\n### )`,
  );
  if (!pattern.test(markdown)) {
    throw new Error(`Unable to locate executor block for ${agentId}`);
  }
  return markdown.replace(pattern, `$1${blockLines.join("\n")}\n`);
}

function configureWaveExecutorsForLiveTrace(repoDir, options = {}) {
  const wavePath = path.join(repoDir, "docs", "plans", "waves", "wave-0.md");
  const current = fs.readFileSync(wavePath, "utf8");
  const implementationBlock = options.implementationExecutorBlock || ["- profile: implement-fast"];
  const next = [
    ["A0", options.evaluatorExecutorBlock || ["- id: local"]],
    ["A8", options.integrationExecutorBlock || ["- id: local"]],
    ["A9", options.documentationExecutorBlock || ["- id: local"]],
    ["A1", implementationBlock],
  ].reduce((markdown, [agentId, lines]) => replaceAgentExecutorBlock(markdown, agentId, lines), current);
  fs.writeFileSync(wavePath, next, "utf8");
}

function configureRepoExecutorsForLiveTrace(repoDir, options = {}) {
  const updated = updateWaveConfig(repoDir, (config) => {
    config.executors.default = options.defaultExecutor || "local";
    config.executors.profiles["deep-review"] = {
      ...config.executors.profiles["deep-review"],
      id: options.deepReviewExecutor || "local",
    };
    config.executors.profiles["docs-pass"] = {
      ...config.executors.profiles["docs-pass"],
      id: options.docsExecutor || "local",
    };
    config.executors.profiles["implement-fast"] = {
      ...config.executors.profiles["implement-fast"],
      id: options.implementFastExecutor || "local",
      ...(options.implementFastFallbacks
        ? { fallbacks: options.implementFastFallbacks }
        : {}),
    };
    if (options.codexCommand) {
      config.executors.codex.command = options.codexCommand;
    }
    config.lanes.main.runtimePolicy.runtimeMixTargets =
      options.runtimeMixTargets || {
        local: 8,
      };
    config.lanes.main.runtimePolicy.defaultExecutorByRole = {
      implementation: options.defaultExecutorByRole?.implementation || "local",
      integration: options.defaultExecutorByRole?.integration || "local",
      documentation: options.defaultExecutorByRole?.documentation || "local",
      evaluator: options.defaultExecutorByRole?.evaluator || "local",
      research: options.defaultExecutorByRole?.research || "local",
      infra: options.defaultExecutorByRole?.infra || "local",
      deploy: options.defaultExecutorByRole?.deploy || "local",
    };
    config.lanes.main.runtimePolicy.fallbackExecutorOrder =
      options.fallbackExecutorOrder || ["local"];
    return config;
  });
  const waveFilePath = path.join(repoDir, "docs", "plans", "waves", "wave-0.md");
  const waveText = fs.readFileSync(waveFilePath, "utf8");
  fs.writeFileSync(
    waveFilePath,
    waveText
      .replace(
        /(## Agent A0:[\s\S]*?### Executor\s*\n\n)([\s\S]*?)(\n### Context7)/,
        "$1- id: local$3",
      )
      .replace(
        /(## Agent A8:[\s\S]*?### Executor\s*\n\n)([\s\S]*?)(\n### Context7)/,
        "$1- id: local$3",
      )
      .replace(
        /(## Agent A9:[\s\S]*?### Executor\s*\n\n)([\s\S]*?)(\n### Context7)/,
        "$1- id: local$3",
      ),
    "utf8",
  );
  return updated;
}

function seedCoordinationRecord(repoDir, payload) {
  const coordinationLogPath = path.join(
    repoDir,
    ".tmp",
    "main-wave-launcher",
    "coordination",
    "wave-0.jsonl",
  );
  appendCoordinationRecord(coordinationLogPath, payload);
  return coordinationLogPath;
}

function removeLiveSourceArtifacts(repoDir) {
  fs.rmSync(path.join(repoDir, ".tmp", "main-wave-launcher", "status"), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(repoDir, ".tmp", "main-wave-launcher", "logs"), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(repoDir, ".tmp", "main-wave-launcher", "coordination"), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(repoDir, "docs", "plans", "waves", "wave-0.md"), {
    force: true,
  });
  fs.rmSync(path.join(repoDir, "docs", "plans", "component-cutover-matrix.json"), {
    force: true,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("trace bundles", () => {
  it("writes a replayable attempt bundle with cumulative metrics and matching replay output", () => {
    const dir = makeTempDir();
    const tracesDir = path.join(dir, "traces");
    const sourceDir = path.join(dir, "source");
    const coordinationLogPath = path.join(sourceDir, "coordination", "wave-0.jsonl");
    const componentMatrixJsonPath = path.join(sourceDir, "component-cutover-matrix.json");
    const componentMatrixDocPath = path.join(sourceDir, "component-cutover-matrix.md");
    writeJson(componentMatrixJsonPath, {
      levels: ["planned", "repo-landed"],
      components: {
        "runtime-engine": {
          title: "Runtime engine",
          currentLevel: "repo-landed",
          promotions: [{ wave: 0, target: "repo-landed" }],
          canonicalDocs: [],
          proofSurfaces: [],
        },
      },
    });
    writeText(componentMatrixDocPath, "# Component Matrix\n");

    appendCoordinationRecord(coordinationLogPath, {
      id: "request-a1",
      lane: "main",
      wave: 0,
      agentId: "A8",
      kind: "request",
      targets: ["agent:A1"],
      status: "open",
      priority: "high",
      artifactRefs: ["src/runtime.ts"],
      dependsOn: [],
      closureCondition: "",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
      confidence: "medium",
      summary: "Need runtime proof",
      detail: "Please add proof for src/runtime.ts.",
      source: "agent",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "request-a1",
      lane: "main",
      wave: 0,
      agentId: "A1",
      kind: "request",
      targets: ["agent:A1"],
      status: "acknowledged",
      priority: "high",
      artifactRefs: ["src/runtime.ts"],
      dependsOn: [],
      closureCondition: "",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:02:00.000Z",
      confidence: "medium",
      summary: "Need runtime proof",
      detail: "Acknowledged by A1.",
      source: "agent",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "block-runtime",
      lane: "main",
      wave: 0,
      agentId: "A8",
      kind: "blocker",
      targets: ["agent:A1"],
      status: "open",
      priority: "high",
      artifactRefs: ["src/runtime.ts"],
      dependsOn: [],
      closureCondition: "",
      createdAt: "2026-03-21T00:01:00.000Z",
      updatedAt: "2026-03-21T00:01:00.000Z",
      confidence: "medium",
      summary: "Runtime blocked",
      detail: "Need integration proof first.",
      source: "agent",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "block-runtime",
      lane: "main",
      wave: 0,
      agentId: "A8",
      kind: "blocker",
      targets: ["agent:A1"],
      status: "resolved",
      priority: "high",
      artifactRefs: ["src/runtime.ts"],
      dependsOn: [],
      closureCondition: "",
      createdAt: "2026-03-21T00:01:00.000Z",
      updatedAt: "2026-03-21T00:04:00.000Z",
      confidence: "high",
      summary: "Runtime blocked",
      detail: "Resolved after proof landed.",
      source: "agent",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "clarify-policy",
      lane: "main",
      wave: 0,
      agentId: "A1",
      kind: "clarification-request",
      targets: ["launcher"],
      status: "resolved",
      priority: "normal",
      artifactRefs: ["docs/plans/master-plan.md"],
      dependsOn: [],
      closureCondition: "",
      createdAt: "2026-03-21T00:00:30.000Z",
      updatedAt: "2026-03-21T00:03:00.000Z",
      confidence: "medium",
      summary: "Who owns docs?",
      detail: "Resolved directly by policy.",
      source: "agent",
    });
    appendCoordinationRecord(coordinationLogPath, {
      id: "triage-clarify-policy-policy",
      lane: "main",
      wave: 0,
      agentId: "launcher",
      kind: "resolved-by-policy",
      targets: ["agent:A1"],
      status: "resolved",
      priority: "normal",
      artifactRefs: ["docs/plans/master-plan.md"],
      dependsOn: ["clarify-policy"],
      closureCondition: "clarification:clarify-policy",
      createdAt: "2026-03-21T00:03:00.000Z",
      updatedAt: "2026-03-21T00:03:00.000Z",
      confidence: "high",
      summary: "Docs ownership resolved",
      detail: "A9 owns shared-plan docs.",
      source: "launcher",
    });

    const coordinationState = readMaterializedCoordinationState(coordinationLogPath);
    const wave = {
      wave: 0,
      file: "docs/plans/waves/wave-0.md",
      componentPromotions: [{ componentId: "runtime-engine", targetLevel: "repo-landed" }],
      agents: [
        {
          agentId: "A1",
          slug: "0-a1",
          title: "Implementation",
          prompt: "Implement the runtime proof.",
          ownedPaths: ["src/runtime.ts"],
          components: ["runtime-engine"],
          exitContract: {
            completion: "integrated",
            durability: "none",
            proof: "integration",
            docImpact: "owned",
          },
          executorResolved: {
            id: "claude",
            initialExecutorId: "codex",
            role: "implementation",
            profile: "implementation-default",
            selectedBy: "retry-fallback",
            budget: { turns: 8, minutes: 10 },
            fallbacks: ["claude"],
            fallbackUsed: true,
            fallbackReason: "retry:timeout",
            executorHistory: [
              { attempt: 0, executorId: "codex", reason: "initial" },
              { attempt: 2, executorId: "claude", reason: "retry:timeout" },
            ],
          },
          context7Resolved: {
            bundleId: "core-js",
            query: "runtime proof",
            libraries: [{ libraryName: "node", libraryId: "/nodejs/node" }],
          },
          skillsResolved: {
            ids: ["wave-core", "runtime-claude"],
            role: "implementation",
            runtime: "claude",
            deployKind: null,
            promptHash: "skill-prompt-hash",
            bundles: [
              {
                id: "wave-core",
                bundlePath: "skills/wave-core",
                manifestPath: "skills/wave-core/skill.json",
                skillPath: "skills/wave-core/SKILL.md",
                adapterPath: null,
                bundleHash: "bundle-wave-core",
                sourceFiles: [
                  "skills/wave-core/skill.json",
                  "skills/wave-core/SKILL.md",
                ],
              },
            ],
          },
        },
        {
          agentId: "A8",
          slug: "0-a8",
          title: "Integration Steward",
          prompt: "Check integration.",
          ownedPaths: ["docs/plans/current-state.md"],
          components: [],
          executorResolved: {
            id: "claude",
            initialExecutorId: "claude",
            role: "integration",
            profile: "integration-default",
            selectedBy: "lane-role-default",
            budget: { turns: 6, minutes: 10 },
            fallbacks: [],
            fallbackUsed: false,
            fallbackReason: null,
            executorHistory: [{ attempt: 0, executorId: "claude", reason: "initial" }],
          },
          context7Resolved: { bundleId: "none", query: "", libraries: [] },
        },
        {
          agentId: "A9",
          slug: "0-a9",
          title: "Documentation Steward",
          prompt: "Close docs.",
          ownedPaths: ["docs/plans/master-plan.md"],
          components: [],
          executorResolved: {
            id: "claude",
            initialExecutorId: "claude",
            role: "documentation",
            profile: "docs-default",
            selectedBy: "lane-role-default",
            budget: { turns: 6, minutes: 10 },
            fallbacks: [],
            fallbackUsed: false,
            fallbackReason: null,
            executorHistory: [{ attempt: 0, executorId: "claude", reason: "initial" }],
          },
          context7Resolved: { bundleId: "none", query: "", libraries: [] },
        },
        {
          agentId: "A0",
          slug: "0-a0",
          title: "Evaluator",
          prompt: "Evaluate the wave.",
          ownedPaths: ["docs/plans/current-state.md"],
          components: [],
          executorResolved: {
            id: "claude",
            initialExecutorId: "claude",
            role: "evaluator",
            profile: "eval-default",
            selectedBy: "lane-role-default",
            budget: { turns: 6, minutes: 10 },
            fallbacks: [],
            fallbackUsed: false,
            fallbackReason: null,
            executorHistory: [{ attempt: 0, executorId: "claude", reason: "initial" }],
          },
          context7Resolved: { bundleId: "none", query: "", libraries: [] },
        },
      ],
    };

    const sharedSummaryPath = path.join(sourceDir, "inboxes", "wave-0", "shared-summary.md");
    writeText(sharedSummaryPath, "# Shared summary\n");
    const integrationMarkdownPath = path.join(sourceDir, "integration", "wave-0.md");
    writeText(integrationMarkdownPath, "# Integration\nReady for doc closure.\n");
    const triagePath = path.join(sourceDir, "feedback", "triage", "wave-0.jsonl");
    writeText(triagePath, '{"id":"triage-1"}\n');
    const pendingHumanPath = path.join(sourceDir, "feedback", "triage", "wave-0", "pending-human.md");
    writeText(pendingHumanPath, "# Pending human\n");

    const agentRuns = wave.agents.map((agent) => {
      const promptPath = path.join(sourceDir, "prompts", `${agent.slug}.prompt.md`);
      const logPath = path.join(sourceDir, "logs", `${agent.slug}.log`);
      const statusPath = path.join(sourceDir, "status", `${agent.slug}.status`);
      const inboxPath = path.join(sourceDir, "inboxes", "wave-0", `${agent.agentId}.md`);
      writeText(promptPath, `Prompt for ${agent.agentId}\n`);
      writeText(logPath, `[wave-phase] complete\n`);
      makeStatus(statusPath);
      writeText(inboxPath, `Inbox for ${agent.agentId}\n`);
      return {
        agent,
        promptPath,
        logPath,
        statusPath,
        inboxPath,
        sharedSummaryPath,
        lastLaunchAttempt: 2,
        lastContext7:
          agent.agentId === "A1"
            ? {
                mode: "fetched",
                selection: agent.context7Resolved,
                promptText: "Node runtime docs snippet",
                snippetHash: "snippet-a1",
                warning: "",
              }
            : {
                mode: "none",
                selection: agent.context7Resolved,
                promptText: "",
                snippetHash: "",
                warning: "",
              },
      };
    });

    makeSummary(agentRuns[0].statusPath, {
      agentId: "A1",
      proof: {
        completion: "integrated",
        durability: "none",
        proof: "integration",
        state: "met",
        detail: "Proof complete.",
      },
      docDelta: { state: "owned", paths: ["src/runtime.ts"], detail: "Owned docs only." },
      components: [{ componentId: "runtime-engine", level: "repo-landed", state: "met", detail: "" }],
      logPath: agentRuns[0].logPath,
    });
    makeSummary(agentRuns[1].statusPath, {
      agentId: "A8",
      integration: {
        state: "ready-for-doc-closure",
        claims: 2,
        conflicts: 0,
        blockers: 0,
        detail: "Integrated and ready.",
      },
      logPath: agentRuns[1].logPath,
    });
    makeSummary(agentRuns[2].statusPath, {
      agentId: "A9",
      docClosure: {
        state: "closed",
        paths: ["docs/plans/master-plan.md"],
        detail: "Shared plan updated.",
      },
      logPath: agentRuns[2].logPath,
    });
    makeSummary(agentRuns[3].statusPath, {
      agentId: "A0",
      gate: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
        detail: "All gates closed.",
      },
      verdict: {
        verdict: "pass",
        detail: "Wave ready.",
      },
      logPath: agentRuns[3].logPath,
    });

    const summariesByAgentId = Object.fromEntries(
      agentRuns.map((run) => [run.agent.agentId, readAgentExecutionSummary(run.statusPath)]),
    );
    const docsQueue = { wave: 0, lane: "main", items: [] };
    const integrationSummary = {
      wave: 0,
      lane: "main",
      agentId: "A8",
      attempt: 2,
      openClaims: [{ id: "claim-1" }],
      conflictingClaims: [],
      unresolvedBlockers: [],
      changedInterfaces: [],
      crossComponentImpacts: [],
      proofGaps: [],
      docGaps: [],
      deployRisks: [],
      runtimeAssignments: wave.agents.map((agent) => ({
        agentId: agent.agentId,
        executorId: agent.executorResolved.id,
        role: agent.executorResolved.role,
        profile: agent.executorResolved.profile,
        fallbackUsed: agent.executorResolved.fallbackUsed,
      })),
      recommendation: "ready-for-doc-closure",
      detail: "Everything is aligned.",
      createdAt: "2026-03-21T00:05:00.000Z",
      updatedAt: "2026-03-21T00:05:00.000Z",
    };
    const ledger = deriveWaveLedger({
      lane: "main",
      wave,
      summariesByAgentId,
      coordinationState,
      integrationSummary,
      docsQueue,
      attempt: 2,
      evaluatorAgentId: "A0",
      integrationAgentId: "A8",
      documentationAgentId: "A9",
    });
    const lanePaths = makeLanePaths(dir, componentMatrixJsonPath, componentMatrixDocPath);
    const gateSnapshot = buildGateSnapshot({
      wave,
      agentRuns,
      derivedState: { coordinationState, ledger, docsQueue, integrationSummary },
      lanePaths,
      componentMatrixPayload: readAgentExecutionSummary(agentRuns[0].statusPath) ? readJson(componentMatrixJsonPath) : null,
      componentMatrixJsonPath,
    });
    writeJson(path.join(tracesDir, "wave-0", "attempt-1", "run-metadata.json"), {
      traceVersion: 1,
      attempt: 1,
      agents: [
        {
          agentId: "A1",
          launchedInAttempt: true,
          executor: { role: "implementation", executorId: "codex" },
        },
        {
          agentId: "A0",
          launchedInAttempt: true,
          executor: { role: "evaluator", executorId: "claude" },
        },
      ],
      gateSnapshot: {
        evaluatorGate: {
          ok: false,
          statusCode: "evaluator-concerns",
        },
      },
    });
    const quality = buildQualityMetrics({
      tracesDir,
      wave,
      attempt: 2,
      coordinationLogPath,
      coordinationState,
      integrationSummary,
      ledger,
      docsQueue,
      summariesByAgentId,
      agentRuns,
      gateSnapshot,
    });

    const traceDir = writeTraceBundle({
      tracesDir,
      lanePaths,
      launcherOptions: {
        timeoutMinutes: 60,
        maxRetriesPerWave: 2,
        dryRun: false,
      },
      wave,
      attempt: 2,
      manifest: {
        generatedAt: "2026-03-21T00:05:00.000Z",
        source: "docs/**/*",
        docs: [],
        waves: [wave],
      },
      coordinationLogPath,
      coordinationState,
      ledger,
      docsQueue,
      integrationSummary,
      integrationMarkdownPath,
      clarificationTriage: {
        triagePath,
        pendingHumanPath,
      },
      agentRuns,
      quality,
      structuredSignals: {
        A1: { phases: ["complete"] },
        A8: { phases: ["integration"] },
      },
      gateSnapshot,
    });
    const metadataPath = path.join(traceDir, "run-metadata.json");
    const metadata = readJson(metadataPath);
    metadata.agents = metadata.agents.map((agent) =>
      agent.agentId === "A1"
        ? {
            ...agent,
            summary: {
              proof: {
                completion: "integrated",
                durability: "none",
                proof: "integration",
                state: "missing",
                detail: "inline metadata should be ignored for v2 replay",
              },
            },
          }
        : agent,
    );
    writeJson(metadataPath, metadata);

    const bundle = loadTraceBundle(traceDir);
    const validation = validateTraceBundle(bundle);
    expect(validation).toMatchObject({ ok: true });
    expect(bundle.metadata.traceVersion).toBe(2);
    expect(bundle.metadata.replayMode).toBe("hermetic");
    expect(Array.isArray(bundle.metadata.historySnapshot.launchEvents)).toBe(true);
    expect(bundle.metadata.artifacts.manifest.present).toBe(true);
    expect(bundle.metadata.artifacts.outcome.present).toBe(true);
    expect(bundle.metadata.artifacts.structuredSignals.present).toBe(true);
    expect(bundle.metadata.artifacts.sharedSummary.present).toBe(true);
    expect(bundle.metadata.artifacts.agents.A1.prompt.present).toBe(true);
    expect(bundle.metadata.artifacts.agents.A1.log.present).toBe(true);
    expect(bundle.metadata.artifacts.agents.A1.status.present).toBe(true);
    expect(bundle.metadata.agents.find((agent) => agent.agentId === "A1")?.skills).toMatchObject({
      ids: ["wave-core", "runtime-claude"],
      runtime: "claude",
      promptHash: "skill-prompt-hash",
    });

    const filesBeforeReplay = listFilesRecursively(traceDir);
    const replay = replayTraceBundle(traceDir);
    const filesAfterReplay = listFilesRecursively(traceDir);
    expect(replay.ok).toBe(true);
    expect(replay.replayMode).toBe("hermetic");
    expect(replay.warnings).toEqual([]);
    expect(replay.matchesStoredGateSnapshot).toBe(true);
    expect(replay.matchesStoredQuality).toBe(true);
    expect(replay.comparison.gateSnapshot.diffPaths).toEqual([]);
    expect(replay.comparison.quality.diffPaths).toEqual([]);
    expect(filesAfterReplay).toEqual(filesBeforeReplay);
    expect(replay.quality.relaunchCountByRole).toMatchObject({
      implementation: 1,
      evaluator: 1,
    });
    expect(replay.quality.relaunchCountByExecutor).toMatchObject({
      claude: 2,
    });
    expect(replay.quality.runtimeFallbackCount).toBe(1);
    expect(replay.quality.runtimeFallbackRate).toBeGreaterThan(0);
    expect(replay.quality.meanTimeToFirstAckMs).not.toBeNull();
    expect(replay.quality.meanTimeToBlockerResolutionMs).not.toBeNull();
    expect(replay.quality.evaluatorReversal).toBe(true);

    fs.rmSync(path.join(tracesDir, "wave-0", "attempt-1"), { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
    const isolatedReplay = replayTraceBundle(traceDir);
    expect(isolatedReplay.ok).toBe(true);
    expect(isolatedReplay.replayMode).toBe("hermetic");
    expect(isolatedReplay.quality).toEqual(replay.quality);
  });

  it("fails validation when a promoted-component bundle omits the copied component matrix artifact", () => {
    const dir = makeTempDir();
    const traceDir = path.join(dir, "traces", "wave-0", "attempt-1");
    writeJson(path.join(traceDir, "manifest.json"), {
      generatedAt: "2026-03-21T00:00:00.000Z",
      source: "docs/**/*",
      docs: [],
      waves: [
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          componentPromotions: [{ componentId: "runtime-engine", targetLevel: "repo-landed" }],
          agents: [],
        },
      ],
    });
    writeText(path.join(traceDir, "coordination.raw.jsonl"), "");
    writeJson(path.join(traceDir, "coordination.materialized.json"), {});
    writeJson(path.join(traceDir, "ledger.json"), {});
    writeJson(path.join(traceDir, "docs-queue.json"), {});
    writeJson(path.join(traceDir, "integration.json"), {});
    writeText(path.join(traceDir, "shared-summary.md"), "# Shared summary\n");
    writeJson(path.join(traceDir, "structured-signals.json"), {});
    writeJson(path.join(traceDir, "quality.json"), {});
    writeJson(path.join(traceDir, "outcome.json"), {
      gateSnapshot: null,
      quality: {},
    });
    writeJson(path.join(traceDir, "run-metadata.json"), {
      traceVersion: 2,
      replayMode: "hermetic",
      wave: 0,
      lane: "main",
      attempt: 1,
      replayContext: {
        lane: "main",
        roles: {
          evaluatorAgentId: "A0",
          integrationAgentId: "A8",
          documentationAgentId: "A9",
        },
        validation: {
          requireIntegrationStewardFromWave: 0,
          requireComponentPromotionsFromWave: 0,
        },
      },
      historySnapshot: {
        launchEvents: [],
        evaluatorStatuses: [],
      },
      artifacts: {
        manifest: { path: "manifest.json", required: true, present: true, sha256: null },
        coordinationRaw: { path: "coordination.raw.jsonl", required: true, present: true, sha256: null },
        coordinationMaterialized: {
          path: "coordination.materialized.json",
          required: true,
          present: true,
          sha256: null,
        },
        ledger: { path: "ledger.json", required: true, present: true, sha256: null },
        docsQueue: { path: "docs-queue.json", required: true, present: true, sha256: null },
        integration: { path: "integration.json", required: true, present: true, sha256: null },
        componentMatrix: {
          path: "component-cutover-matrix.json",
          required: true,
          present: false,
          sha256: null,
        },
        outcome: { path: "outcome.json", required: true, present: true, sha256: null },
        sharedSummary: { path: "shared-summary.md", required: true, present: true, sha256: null },
        structuredSignals: { path: "structured-signals.json", required: true, present: true, sha256: null },
        quality: { path: "quality.json", required: true, present: true, sha256: null },
        runMetadata: { path: "run-metadata.json", required: true, present: true, sha256: null },
        agents: {},
      },
      agents: [],
    });

    const validation = validateTraceBundle(loadTraceBundle(traceDir));
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.includes("componentMatrix"))).toBe(true);
  });

  it("fails validation when a recorded artifact hash does not match disk contents", () => {
    const dir = makeTempDir();
    const tracesDir = path.join(dir, "traces");
    const traceDir = path.join(tracesDir, "wave-0", "attempt-1");
    writeJson(path.join(traceDir, "manifest.json"), {
      generatedAt: "2026-03-21T00:00:00.000Z",
      source: "docs/**/*",
      docs: [],
      waves: [{ wave: 0, file: "docs/plans/waves/wave-0.md", agents: [] }],
    });
    writeText(path.join(traceDir, "coordination.raw.jsonl"), "");
    writeJson(path.join(traceDir, "coordination.materialized.json"), {});
    writeJson(path.join(traceDir, "ledger.json"), {});
    writeJson(path.join(traceDir, "docs-queue.json"), {});
    writeJson(path.join(traceDir, "integration.json"), {});
    writeText(path.join(traceDir, "shared-summary.md"), "# Shared summary\n");
    writeJson(path.join(traceDir, "structured-signals.json"), {});
    writeJson(path.join(traceDir, "quality.json"), {});
    writeJson(path.join(traceDir, "outcome.json"), {
      gateSnapshot: null,
      quality: {},
    });
    writeJson(path.join(traceDir, "run-metadata.json"), {
      traceVersion: 2,
      replayMode: "hermetic",
      wave: 0,
      lane: "main",
      attempt: 1,
      replayContext: {
        lane: "main",
        roles: {
          evaluatorAgentId: "A0",
          integrationAgentId: "A8",
          documentationAgentId: "A9",
        },
        validation: {
          requireIntegrationStewardFromWave: 0,
          requireComponentPromotionsFromWave: null,
        },
      },
      historySnapshot: {
        launchEvents: [],
        evaluatorStatuses: [],
      },
      artifacts: {
        manifest: {
          path: "manifest.json",
          required: true,
          present: true,
          sha256: "bogus",
        },
        coordinationRaw: {
          path: "coordination.raw.jsonl",
          required: true,
          present: true,
          sha256: null,
        },
        coordinationMaterialized: {
          path: "coordination.materialized.json",
          required: true,
          present: true,
          sha256: null,
        },
        ledger: { path: "ledger.json", required: true, present: true, sha256: null },
        docsQueue: { path: "docs-queue.json", required: true, present: true, sha256: null },
        integration: { path: "integration.json", required: true, present: true, sha256: null },
        outcome: { path: "outcome.json", required: true, present: true, sha256: null },
        sharedSummary: { path: "shared-summary.md", required: true, present: true, sha256: null },
        structuredSignals: {
          path: "structured-signals.json",
          required: true,
          present: true,
          sha256: null,
        },
        quality: { path: "quality.json", required: true, present: true, sha256: null },
        runMetadata: { path: "run-metadata.json", required: true, present: true, sha256: null },
        agents: {},
      },
      agents: [],
    });

    const validation = validateTraceBundle(loadTraceBundle(traceDir));
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.includes("hash mismatch"))).toBe(true);
  });

  it("fails validation when a launched v2 agent is missing the copied summary artifact", () => {
    const dir = makeTempDir();
    const traceDir = path.join(dir, "traces", "wave-0", "attempt-1");
    writeJson(path.join(traceDir, "manifest.json"), {
      generatedAt: "2026-03-21T00:00:00.000Z",
      source: "docs/**/*",
      docs: [],
      waves: [
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          agents: [
            {
              agentId: "A1",
              title: "Implementation",
              slug: "0-a1",
              exitContract: {
                completion: "integrated",
                durability: "none",
                proof: "integration",
                docImpact: "owned",
              },
            },
          ],
        },
      ],
    });
    writeText(path.join(traceDir, "coordination.raw.jsonl"), "");
    writeJson(path.join(traceDir, "coordination.materialized.json"), {
      requests: [],
      clarifications: [],
      humanEscalations: [],
      humanFeedback: [],
      resolvedByPolicy: [],
      orchestratorGuidance: [],
    });
    writeJson(path.join(traceDir, "ledger.json"), { tasks: [] });
    writeJson(path.join(traceDir, "docs-queue.json"), { items: [] });
    writeJson(path.join(traceDir, "integration.json"), {
      recommendation: "ready-for-doc-closure",
      conflictingClaims: [],
    });
    writeText(path.join(traceDir, "shared-summary.md"), "# Shared summary\n");
    writeJson(path.join(traceDir, "structured-signals.json"), {});
    writeJson(path.join(traceDir, "quality.json"), {});
    writeJson(path.join(traceDir, "outcome.json"), {
      gateSnapshot: null,
      quality: {},
    });
    writeText(path.join(traceDir, "prompts", "0-a1.prompt.md"), "Prompt for A1\n");
    writeText(path.join(traceDir, "logs", "0-a1.log"), "[wave-phase] complete\n");
    makeStatus(path.join(traceDir, "status", "0-a1.status"));
    writeText(path.join(traceDir, "inboxes", "0-a1.md"), "Inbox for A1\n");
    writeJson(path.join(traceDir, "run-metadata.json"), {
      traceVersion: 2,
      replayMode: "hermetic",
      wave: 0,
      lane: "main",
      attempt: 1,
      replayContext: {
        lane: "main",
        roles: {
          evaluatorAgentId: "A0",
          integrationAgentId: "A8",
          documentationAgentId: "A9",
        },
        validation: {
          requireIntegrationStewardFromWave: null,
          requireComponentPromotionsFromWave: null,
        },
      },
      historySnapshot: {
        launchEvents: [{ attempt: 1, agentId: "A1", role: "implementation", executorId: "codex" }],
        evaluatorStatuses: [],
      },
      artifacts: {
        manifest: { path: "manifest.json", required: true, present: true, sha256: null },
        coordinationRaw: { path: "coordination.raw.jsonl", required: true, present: true, sha256: null },
        coordinationMaterialized: {
          path: "coordination.materialized.json",
          required: true,
          present: true,
          sha256: null,
        },
        ledger: { path: "ledger.json", required: true, present: true, sha256: null },
        docsQueue: { path: "docs-queue.json", required: true, present: true, sha256: null },
        integration: { path: "integration.json", required: true, present: true, sha256: null },
        outcome: { path: "outcome.json", required: true, present: true, sha256: null },
        sharedSummary: { path: "shared-summary.md", required: true, present: true, sha256: null },
        structuredSignals: { path: "structured-signals.json", required: true, present: true, sha256: null },
        quality: { path: "quality.json", required: true, present: true, sha256: null },
        runMetadata: { path: "run-metadata.json", required: true, present: true, sha256: null },
        agents: {
          A1: {
            prompt: { path: "prompts/0-a1.prompt.md", required: true, present: true, sha256: null },
            log: { path: "logs/0-a1.log", required: true, present: true, sha256: null },
            status: { path: "status/0-a1.status", required: true, present: true, sha256: null },
            summary: {
              path: "summaries/0-a1.summary.json",
              required: false,
              present: false,
              sha256: null,
            },
            inbox: { path: "inboxes/0-a1.md", required: true, present: true, sha256: null },
          },
        },
      },
      agents: [
        {
          agentId: "A1",
          title: "Implementation",
          launchedInAttempt: true,
          promptPath: "prompts/0-a1.prompt.md",
          logPath: "logs/0-a1.log",
          statusPath: "status/0-a1.status",
          summaryPath: "summaries/0-a1.summary.json",
          summary: {
            proof: {
              completion: "integrated",
              durability: "none",
              proof: "integration",
              state: "met",
              detail: "inline metadata should not satisfy v2 replay",
            },
            docDelta: { state: "owned", paths: ["src/runtime.ts"], detail: "owned docs" },
            logPath: "logs/0-a1.log",
          },
          inboxPath: "inboxes/0-a1.md",
          executor: {
            role: "implementation",
            executorId: "codex",
            initialExecutorId: "codex",
            executorHistory: [{ attempt: 1, executorId: "codex", reason: "initial" }],
          },
          context7: { selection: null },
        },
      ],
    });

    const validation = validateTraceBundle(loadTraceBundle(traceDir));
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.includes("summary"))).toBe(true);
  });

  it("marks v1 bundles as legacy best-effort replay instead of hermetic", () => {
    const dir = makeTempDir();
    const tracesDir = path.join(dir, "traces");
    const traceDir = path.join(tracesDir, "wave-0", "attempt-1");
    writeJson(path.join(traceDir, "manifest.json"), {
      generatedAt: "2026-03-21T00:00:00.000Z",
      source: "docs/**/*",
      docs: [],
      waves: [{ wave: 0, file: "docs/plans/waves/wave-0.md", agents: [] }],
    });
    writeText(path.join(traceDir, "coordination.raw.jsonl"), "");
    writeJson(path.join(traceDir, "coordination.materialized.json"), {
      requests: [],
      clarifications: [],
      humanEscalations: [],
      humanFeedback: [],
    });
    writeJson(path.join(traceDir, "ledger.json"), { tasks: [] });
    writeJson(path.join(traceDir, "docs-queue.json"), { items: [] });
    writeJson(path.join(traceDir, "integration.json"), { recommendation: "ready-for-doc-closure" });
    writeText(path.join(traceDir, "shared-summary.md"), "# Shared summary\n");
    writeJson(path.join(traceDir, "structured-signals.json"), {});
    writeJson(path.join(traceDir, "quality.json"), {});
    writeJson(path.join(traceDir, "run-metadata.json"), {
      traceVersion: 1,
      wave: 0,
      lane: "main",
      roles: {
        evaluatorAgentId: "A0",
        integrationAgentId: "A8",
        documentationAgentId: "A9",
      },
      validation: {
        requireIntegrationStewardFromWave: 0,
        requireComponentPromotionsFromWave: null,
      },
      attempt: 1,
      gateSnapshot: {
        evaluatorGate: { statusCode: "pass", ok: true, detail: "" },
      },
      artifacts: {
        manifest: { path: "manifest.json", required: true, present: true, sha256: null },
        coordinationRaw: { path: "coordination.raw.jsonl", required: true, present: true, sha256: null },
        coordinationMaterialized: {
          path: "coordination.materialized.json",
          required: true,
          present: true,
          sha256: null,
        },
        ledger: { path: "ledger.json", required: true, present: true, sha256: null },
        docsQueue: { path: "docs-queue.json", required: true, present: true, sha256: null },
        integration: { path: "integration.json", required: true, present: true, sha256: null },
        sharedSummary: { path: "shared-summary.md", required: true, present: true, sha256: null },
        structuredSignals: { path: "structured-signals.json", required: true, present: true, sha256: null },
        quality: { path: "quality.json", required: true, present: true, sha256: null },
        runMetadata: { path: "run-metadata.json", required: true, present: true, sha256: null },
        agents: {},
      },
      agents: [],
    });

    const replay = replayTraceBundle(traceDir);
    expect(replay.replayMode).toBe("legacy-best-effort");
    expect(replay.validation.ok).toBe(true);
    expect(replay.warnings.some((warning) => warning.includes("Legacy traceVersion 1"))).toBe(true);
  });

  it("dry-run seeds state but leaves attempt traces file-empty", () => {
    const repoDir = makeTempDir();
    writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

    const initResult = runWaveCli(["init"], repoDir);
    expect(initResult.status).toBe(0);

    const dryRunResult = runWaveCli(["launch", "--lane", "main", "--dry-run", "--no-dashboard"], repoDir);
    expect(dryRunResult.status).toBe(0);

    const tracesDir = path.join(repoDir, ".tmp", "main-wave-launcher", "dry-run", "traces");
    expect(fs.existsSync(tracesDir)).toBe(true);
    const files = listFilesRecursively(tracesDir);
    expect(files).toEqual([]);
  });

  it(
    "replays a launcher-generated local trace hermetically after live repo drift",
    () => {
      const repoDir = makeTempDir();
      writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

      const initResult = runWaveCli(["init"], repoDir);
      expect(initResult.status).toBe(0);
      configureRepoExecutorsForLiveTrace(repoDir);
      configureWaveExecutorsForLiveTrace(repoDir);
      seedCoordinationRecord(repoDir, {
        id: "decision-doc-owner",
        lane: "main",
        wave: 0,
        agentId: "A9",
        kind: "decision",
        targets: ["agent:A1"],
        status: "resolved",
        priority: "normal",
        artifactRefs: ["docs/plans/master-plan.md"],
        dependsOn: [],
        closureCondition: "",
        confidence: "high",
        summary: "A9 owns shared plan updates",
        detail: "Documentation ownership is already resolved to A9.",
        source: "agent",
      });
      seedCoordinationRecord(repoDir, {
        id: "clarify-doc-owner",
        lane: "main",
        wave: 0,
        agentId: "A1",
        kind: "clarification-request",
        targets: ["launcher"],
        status: "open",
        priority: "normal",
        artifactRefs: ["docs/plans/master-plan.md"],
        dependsOn: [],
        closureCondition: "",
        confidence: "medium",
        summary: "Who owns docs/plans/master-plan.md?",
        detail: "Need the shared-plan owner before closing docs.",
        source: "agent",
      });

      const launchResult = runWaveCli(
        [
          "launch",
          "--lane",
          "main",
          "--no-context7",
          "--no-dashboard",
          "--timeout-minutes",
          "1",
          "--max-retries-per-wave",
          "0",
        ],
        repoDir,
      );
      expect(launchResult.status).toBe(0);

      const traceDir = traceAttemptDirForRepo(repoDir, 1);
      const bundle = loadTraceBundle(traceDir);
      expect(validateTraceBundle(bundle).ok).toBe(true);
      expect(bundle.metadata.artifacts.outcome.present).toBe(true);

      const replay = replayTraceBundle(traceDir);
      expect(replay.ok).toBe(true);
      expect(replay.matchesStoredGateSnapshot).toBe(true);
      expect(replay.matchesStoredQuality).toBe(true);
      expect(replay.comparison.gateSnapshot.diffPaths).toEqual([]);
      expect(replay.comparison.quality.diffPaths).toEqual([]);
      expect(replay.quality.orchestratorResolvedClarificationCount).toBeGreaterThan(0);
      expect(replay.bundle.metadata.artifacts.feedbackTriage.present).toBe(true);

      updateWaveConfig(repoDir, (config) => {
        config.roles.evaluatorAgentId = "Z0";
        config.validation.requireIntegrationStewardFromWave = 99;
        return config;
      });
      removeLiveSourceArtifacts(repoDir);

      const isolatedReplay = replayTraceBundle(traceDir);
      expect(isolatedReplay.ok).toBe(true);
      expect(isolatedReplay.gateSnapshot).toEqual(replay.gateSnapshot);
      expect(isolatedReplay.quality).toEqual(replay.quality);
    },
    30000,
  );

  it(
    "captures a launcher-generated human escalation as a blocking replay outcome",
    () => {
      const repoDir = makeTempDir();
      writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

      const initResult = runWaveCli(["init"], repoDir);
      expect(initResult.status).toBe(0);
      configureRepoExecutorsForLiveTrace(repoDir);
      configureWaveExecutorsForLiveTrace(repoDir);

      seedCoordinationRecord(repoDir, {
        id: "clarify-product-name",
        lane: "main",
        wave: 0,
        agentId: "A1",
        kind: "clarification-request",
        targets: ["launcher"],
        status: "open",
        priority: "high",
        artifactRefs: ["product-direction/unknown.md"],
        dependsOn: [],
        closureCondition: "",
        confidence: "medium",
        summary: "Should the product be renamed to Nebula?",
        detail: "No owning file or prior decision covers this naming choice.",
        source: "agent",
      });

      const launchResult = runWaveCli(
        [
          "launch",
          "--lane",
          "main",
          "--no-context7",
          "--no-dashboard",
          "--timeout-minutes",
          "1",
          "--max-retries-per-wave",
          "0",
        ],
        repoDir,
      );
      expect(launchResult.status).not.toBe(0);

      const replay = replayTraceBundle(traceAttemptDirForRepo(repoDir, 1));
      expect(replay.ok).toBe(false);
      expect(replay.gateSnapshot.overall.gate).toBe("clarificationBarrier");
      expect(replay.quality.humanEscalationCount).toBeGreaterThan(0);
    },
    30000,
  );

  it(
    "replays launcher-generated retry history after a codex-to-local fallback",
    () => {
      const repoDir = makeTempDir();
      writeJson(path.join(repoDir, "package.json"), { name: "fixture-repo", private: true });

      const initResult = runWaveCli(["init"], repoDir);
      expect(initResult.status).toBe(0);
      configureRepoExecutorsForLiveTrace(repoDir, {
        implementFastExecutor: "codex",
        implementFastFallbacks: ["local"],
        codexCommand: "bash",
        runtimeMixTargets: {
          codex: 1,
          local: 8,
        },
        defaultExecutorByRole: {
          implementation: "codex",
          integration: "local",
          documentation: "local",
          evaluator: "local",
          research: "local",
          infra: "local",
          deploy: "local",
        },
        fallbackExecutorOrder: ["local"],
      });
      configureWaveExecutorsForLiveTrace(repoDir);

      const launchResult = runWaveCli(
        [
          "launch",
          "--lane",
          "main",
          "--no-context7",
          "--no-dashboard",
          "--timeout-minutes",
          "1",
          "--max-retries-per-wave",
          "1",
        ],
        repoDir,
      );
      expect(launchResult.status).toBe(0);

      const traceDir = traceAttemptDirForRepo(repoDir, 2);
      const replay = replayTraceBundle(traceDir);
      expect(replay.ok).toBe(true);
      expect(replay.matchesStoredGateSnapshot).toBe(true);
      expect(replay.matchesStoredQuality).toBe(true);
      expect(replay.quality.runtimeFallbackCount).toBeGreaterThan(0);
      expect(replay.quality.runtimeFallbackRate).toBeGreaterThan(0);
      expect(replay.bundle.metadata.agents.some((agent) => agent.executor?.fallbackUsed === true)).toBe(
        true,
      );

      fs.rmSync(traceAttemptDirForRepo(repoDir, 1), { recursive: true, force: true });
      const isolatedReplay = replayTraceBundle(traceDir);
      expect(isolatedReplay.ok).toBe(true);
      expect(isolatedReplay.quality).toEqual(replay.quality);
    },
    30000,
  );
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
