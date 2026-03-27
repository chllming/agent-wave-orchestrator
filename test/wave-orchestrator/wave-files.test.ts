import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWaveConfig, resolveLaneProfile } from "../../scripts/wave-orchestrator/config.mjs";
import { hashText, REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";
import { hashAgentPromptFingerprint } from "../../scripts/wave-orchestrator/context7.mjs";
import {
  completedWavesFromStatusFiles,
  markWaveCompleted,
  normalizeCompletedWaves,
  parseWaveContent,
  parseWaveFiles,
  readRunState,
  reconcileRunStateFromStatusFiles,
  resolveAgentExecutor,
  requiredDocumentationStewardPathsForWave,
  SHARED_PLAN_DOC_PATHS,
  validateWaveComponentPromotions,
  validateWaveComponentMatrixCurrentLevels,
  validateWaveDefinition,
  validateWaveRuntimeMixAssignments,
  WAVE_CONT_EVAL_ROLE_PROMPT_PATH,
  WAVE_DOCUMENTATION_ROLE_PROMPT_PATH,
  WAVE_CONT_QA_ROLE_PROMPT_PATH,
  WAVE_DESIGN_ROLE_PROMPT_PATH,
  WAVE_INTEGRATION_ROLE_PROMPT_PATH,
  WAVE_SECURITY_ROLE_PROMPT_PATH,
} from "../../scripts/wave-orchestrator/wave-files.mjs";

const tempPaths = [];

function registerTempPath(targetPath) {
  tempPaths.push(targetPath);
  return targetPath;
}

afterEach(() => {
  for (const targetPath of tempPaths.splice(0)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

const starterComponentPromotions = [
  { componentId: "wave-parser-and-launcher", targetLevel: "repo-landed" },
  { componentId: "starter-docs-and-adoption-guidance", targetLevel: "repo-landed" },
];
const starterComponentTargets = Object.fromEntries(
  starterComponentPromotions.map((promotion) => [promotion.componentId, promotion.targetLevel]),
);
const starterDocumentationPaths = requiredDocumentationStewardPathsForWave(0);

describe("parseWaveContent", () => {
  it("extracts the commit message and agent prompts", () => {
    const wave = parseWaveContent(
      `# Wave 1 - Sample

**Commit message**: \`Docs: sample\`

## Agent A1: First Task

### Prompt
\`\`\`text
Do the first thing.
\`\`\`

## Agent A2: Second Task

### Prompt
\`\`\`text
Do the second thing.
\`\`\`
`,
      "/tmp/wave-1.md",
    );

    expect(wave.wave).toBe(1);
    expect(wave.commitMessage).toBe("Docs: sample");
    expect(wave.agents).toHaveLength(2);
    expect(wave.agents[0]).toMatchObject({
      agentId: "A1",
      title: "First Task",
      prompt: "Do the first thing.",
    });
    expect(wave.agents[1]).toMatchObject({
      agentId: "A2",
      title: "Second Task",
      prompt: "Do the second thing.",
    });
  });

  it("extracts owned paths and cont-qa report paths", () => {
    const wave = parseWaveContent(
      `# Wave 0 - Sample

**Commit message**: \`Docs: sample\`

## Agent A0: cont-QA

### Prompt
\`\`\`text
Read docs/code-guidance.md.
Read docs/research/hardening-tech-stack.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-0-cont-qa.md
\`\`\`

## Agent A1: Worker

### Prompt
\`\`\`text
Read docs/code-guidance.md.
Read docs/research/hardening-tech-stack.md.

File ownership (only touch these paths):
- go/contracts/types.go
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-0.md"),
    );

    expect(wave.agents[0]?.ownedPaths).toEqual([
      "docs/plans/waves/reviews/wave-0-cont-qa.md",
    ]);
    expect(wave.agents[1]?.ownedPaths).toEqual(["go/contracts/types.go"]);
    expect(wave.contQaReportPath).toBe("docs/plans/waves/reviews/wave-0-cont-qa.md");
  });

  it("extracts eval targets and the cont-EVAL report path", () => {
    const wave = parseWaveContent(
      `# Wave 4 - Output Tuning

**Commit message**: \`Test: eval targets\`

## Eval targets

- id: response-quality | selection: delegated | benchmark-family: service-output | objective: Match the expected support response tone and facts | threshold: No material gap in the manual review sample
- id: latency-guard | selection: pinned | benchmarks: http-latency-smoke,cold-start-smoke | objective: Preserve startup responsiveness while tuning output | threshold: No benchmark regresses beyond the accepted smoke threshold

## Agent E0: cont-EVAL

### Role prompts

- ${WAVE_CONT_EVAL_ROLE_PROMPT_PATH}

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-4-cont-eval.md
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-4.md"),
    );

    expect(wave.contEvalReportPath).toBe("docs/plans/waves/reviews/wave-4-cont-eval.md");
    expect(wave.evalTargets).toEqual([
      {
        id: "response-quality",
        selection: "delegated",
        benchmarkFamily: "service-output",
        benchmarks: [],
        objective: "Match the expected support response tone and facts",
        threshold: "No material gap in the manual review sample",
      },
      {
        id: "latency-guard",
        selection: "pinned",
        benchmarkFamily: null,
        benchmarks: ["http-latency-smoke", "cold-start-smoke"],
        objective: "Preserve startup responsiveness while tuning output",
        threshold: "No benchmark regresses beyond the accepted smoke threshold",
      },
    ]);
  });

  it("validates design agents as docs-first packet owners", () => {
    const laneProfile = {
      ...resolveLaneProfile(loadWaveConfig(), "main"),
      validation: {
        ...resolveLaneProfile(loadWaveConfig(), "main").validation,
        requireDocumentationStewardFromWave: null,
        requireIntegrationStewardFromWave: null,
        requireComponentPromotionsFromWave: null,
        requireAgentComponentsFromWave: null,
      },
    };
    const wave = parseWaveContent(
      `# Wave 2 - Design First

**Commit message**: \`Docs: add design packet\`

## Agent A0: cont-QA

### Role prompts
- ${WAVE_CONT_QA_ROLE_PROMPT_PATH}

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-2-cont-qa.md
\`\`\`

## Agent D1: Design Steward

### Role prompts
- ${WAVE_DESIGN_ROLE_PROMPT_PATH}

### Capabilities
- design

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/waves/design/wave-2-D1.md
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-2.md"),
    );

    expect(() =>
      validateWaveDefinition({
        ...wave,
        agents: wave.agents.map((agent) => ({
          ...agent,
          executorResolved: { id: "claude", role: agent.agentId === "D1" ? "design" : "cont-qa" },
        })),
        componentPromotions: [],
      }, { laneProfile }),
    ).not.toThrow();
  });

  it("validates hybrid design stewards when they explicitly own implementation files", () => {
    const lane = resolveLaneProfile(loadWaveConfig(), "main");
    const laneProfile = {
      ...lane,
      validation: {
        ...lane.validation,
        requireDocumentationStewardFromWave: null,
        requireIntegrationStewardFromWave: null,
        requireComponentPromotionsFromWave: null,
        requireAgentComponentsFromWave: null,
        requireExitContractsFromWave: 1,
      },
    };
    const wave = parseWaveContent(
      `# Wave 2 - Hybrid Design

**Commit message**: \`Fix: add hybrid design steward\`

## Agent A0: cont-QA

### Role prompts
- ${WAVE_CONT_QA_ROLE_PROMPT_PATH}

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-2-cont-qa.md
\`\`\`

## Agent D1: Design Steward

### Role prompts
- ${WAVE_DESIGN_ROLE_PROMPT_PATH}

### Capabilities
- design

### Exit contract
- completion: contract
- durability: durable
- proof: integration
- doc-impact: owned

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.
Read docs/research/agent-context-sources.md.

File ownership (only touch these paths):
- docs/plans/waves/design/wave-2-D1.md
- src/runtime.ts
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-2.md"),
    );

    expect(() =>
      validateWaveDefinition({
        ...wave,
        agents: wave.agents.map((agent) => ({
          ...agent,
          executorResolved: { id: "codex", role: agent.agentId === "D1" ? "design" : "cont-qa" },
        })),
        componentPromotions: [],
      }, { laneProfile }),
    ).not.toThrow();
  });

  it("extracts optional deliverables separately from file ownership", () => {
    const wave = parseWaveContent(
      `# Wave 7 - Sample

**Commit message**: \`Test: deliverables\`

## Component promotions

- wave-parser-and-launcher: repo-landed

## Context7 defaults

- bundle: none

## Agent A0: cont-QA

### Role prompts

- ${WAVE_CONT_QA_ROLE_PROMPT_PATH}

### Context7

- bundle: none

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-7-cont-qa.md
\`\`\`

## Agent A8: Integration

### Role prompts

- ${WAVE_INTEGRATION_ROLE_PROMPT_PATH}

### Context7

- bundle: none

### Prompt
\`\`\`text
File ownership (only touch these paths):
- .tmp/main-wave-launcher/integration/wave-7.md
\`\`\`

## Agent A9: Docs

### Role prompts

- ${WAVE_DOCUMENTATION_ROLE_PROMPT_PATH}

### Context7

- bundle: none

### Prompt
\`\`\`text
File ownership (only touch these paths):
- docs/plans/current-state.md
- docs/plans/master-plan.md
- docs/plans/migration.md
\`\`\`

## Agent A1: Worker

### Context7

- bundle: none

### Components

- wave-parser-and-launcher

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- src/example.ts
- test/example.test.ts

### Prompt
\`\`\`text
Read docs/reference/repository-guidance.md.

File ownership (only touch these paths):
- src/
- test/
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-7.md"),
      { lane: "main" },
    );

    expect(wave.agents.find((agent) => agent.agentId === "A1")?.deliverables).toEqual([
      "src/example.ts",
      "test/example.test.ts",
    ]);
    expect(wave.agents.find((agent) => agent.agentId === "A1")?.ownedPaths).toEqual([
      "src/",
      "test/",
    ]);
  });

  it("extracts optional explicit skills from agent sections", () => {
    const wave = parseWaveContent(
      `# Wave 8 - Skills

## Agent A1: Worker

### Skills

- provider-github-release
- provider-aws

### Prompt
\`\`\`text
File ownership (only touch these paths):
- docs/releases.md
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-8.md"),
      { lane: "main" },
    );

    expect(wave.agents[0]?.skills).toEqual(["provider-github-release", "provider-aws"]);
  });

  it("extracts proof artifacts from agent sections", () => {
    const wave = parseWaveContent(
      `# Wave 8 - Live Proof

## Agent A6: Live Validation

### Exit contract

- completion: live
- durability: durable
- proof: live
- doc-impact: none

### Proof artifacts

- path: .tmp/wave-8-learning-proof/learning-plane-before-restart.json | kind: live-status | required-for: pilot-live
- path: .tmp/wave-8-learning-proof/learning-plane-after-restart.json | kind: restart-check | required-for: pilot-live

### Prompt
\`\`\`text
File ownership (only touch these paths):
- .tmp/wave-8-learning-proof/
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-8.md"),
      { lane: "main" },
    );

    expect(wave.agents[0]?.proofArtifacts).toEqual([
      {
        path: ".tmp/wave-8-learning-proof/learning-plane-before-restart.json",
        kind: "live-status",
        requiredFor: ["pilot-live"],
      },
      {
        path: ".tmp/wave-8-learning-proof/learning-plane-after-restart.json",
        kind: "restart-check",
        requiredFor: ["pilot-live"],
      },
    ]);
  });

  it("accepts deliverables that exactly match an owned file path", () => {
    const wave = parseWaveContent(
      `# Wave 7 - Sample

**Commit message**: \`Test: deliverables\`

## Agent A1: Worker

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- README.md

### Prompt
\`\`\`text
File ownership (only touch these paths):
- README.md
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-7.md"),
      { lane: "main" },
    );

    expect(wave.agents.find((agent) => agent.agentId === "A1")?.deliverables).toEqual([
      "README.md",
    ]);
  });

  it("rejects deliverables that escape the agent's owned paths", () => {
    expect(() =>
      parseWaveContent(
        `# Wave 7 - Sample

**Commit message**: \`Test: deliverables\`

## Agent A1: Worker

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- README.md

### Prompt
\`\`\`text
File ownership (only touch these paths):
- src/
\`\`\`
`,
        path.join(REPO_ROOT, "docs/plans/waves/wave-7.md"),
        { lane: "main" },
      ),
    ).toThrow(/must stay within the agent's declared file ownership/);
  });

  it("rejects directory-style deliverables", () => {
    expect(() =>
      parseWaveContent(
        `# Wave 7 - Sample

**Commit message**: \`Test: deliverables\`

## Agent A1: Worker

### Exit contract

- completion: contract
- durability: none
- proof: unit
- doc-impact: owned

### Deliverables

- src/

### Prompt
\`\`\`text
File ownership (only touch these paths):
- src/
\`\`\`
`,
        path.join(REPO_ROOT, "docs/plans/waves/wave-7.md"),
        { lane: "main" },
      ),
    ).toThrow(/must be a file path, not a directory path/);
  });

  it("rejects proof artifacts that escape the agent's owned paths", () => {
    expect(() =>
      parseWaveContent(
        `# Wave 8 - Live Proof

## Agent A6: Live Validation

### Exit contract

- completion: live
- durability: durable
- proof: live
- doc-impact: none

### Proof artifacts

- path: .tmp/wave-8-learning-proof/learning-plane-before-restart.json | kind: live-status | required-for: pilot-live

### Prompt
\`\`\`text
File ownership (only touch these paths):
- docs/
\`\`\`
`,
        path.join(REPO_ROOT, "docs/plans/waves/wave-8.md"),
        { lane: "main" },
      ),
    ).toThrow(/Proof artifact ".*" .* must stay within the agent's declared file ownership/);
  });

  it("defaults proof-centric agents to sticky retry policy", () => {
    const resolved = resolveAgentExecutor(
      {
        agentId: "A6",
        title: "Live Validation",
        components: ["learning-memory-action-plane"],
        componentTargets: {
          "learning-memory-action-plane": "pilot-live",
        },
        exitContract: {
          completion: "live",
          durability: "durable",
          proof: "live",
          docImpact: "none",
        },
        proofArtifacts: [
          {
            path: ".tmp/wave-8-learning-proof/learning-plane-after-restart.json",
            kind: "restart-check",
            requiredFor: ["pilot-live"],
          },
        ],
        executorConfig: {
          id: "codex",
        },
      },
      {
        lane: "main",
        wave: {
          wave: 8,
          componentPromotions: [
            {
              componentId: "learning-memory-action-plane",
              targetLevel: "pilot-live",
            },
          ],
        },
      },
    );

    expect(resolved).toMatchObject({
      id: "codex",
      retryPolicy: "sticky",
      allowFallbackOnRetry: false,
      fallbacks: [],
    });
  });

  it("keeps generic budget.turns advisory for Claude and OpenCode executors", () => {
    const claudeResolved = resolveAgentExecutor(
      {
        agentId: "A2",
        title: "Docs",
        executorConfig: {
          id: "claude",
          budget: {
            turns: 6,
            minutes: 15,
          },
        },
      },
      { lane: "main", wave: { wave: 4, componentPromotions: [] } },
    );
    const opencodeResolved = resolveAgentExecutor(
      {
        agentId: "A3",
        title: "Research",
        executorConfig: {
          id: "opencode",
          budget: {
            turns: 9,
            minutes: 12,
          },
        },
      },
      { lane: "main", wave: { wave: 4, componentPromotions: [] } },
    );

    expect(claudeResolved).toMatchObject({
      budget: {
        turns: 6,
        minutes: 15,
      },
      claude: {
        maxTurns: null,
        maxTurnsSource: null,
      },
    });
    expect(opencodeResolved).toMatchObject({
      budget: {
        turns: 9,
        minutes: 12,
      },
      opencode: {
        steps: null,
        stepsSource: null,
      },
    });
  });

  it("composes imported standing role prompts while keeping ownership local", () => {
    const overlayPrompt = [
      "Primary goal:",
      "- Keep the wave coherent.",
      "",
      "File ownership (only touch these paths):",
      "- docs/plans/waves/reviews/wave-0-cont-qa.md",
    ].join("\n");
    const wave = parseWaveContent(
      `# Wave 0 - Sample

**Commit message**: \`Docs: sample\`

## Agent A0: cont-QA

### Role prompts

- ${WAVE_CONT_QA_ROLE_PROMPT_PATH}

### Prompt
\`\`\`text
${overlayPrompt}
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-0.md"),
    );

    expect(wave.agents[0]).toMatchObject({
      agentId: "A0",
      promptOverlay: overlayPrompt,
      rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
      ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
    });
    expect(wave.agents[0]?.prompt).toContain("You are the cont-QA role for the current wave.");
    expect(wave.agents[0]?.prompt).toContain("Primary goal:");
    expect(wave.agents[0]?.prompt).toContain("exact shared-doc deltas");
  });

  it("parses documentation steward role prompts while keeping shared plan ownership local", () => {
    const overlayPrompt = [
      "Primary goal:",
      "- Keep shared plan docs aligned with the wave.",
      "",
      "File ownership (only touch these paths):",
      ...SHARED_PLAN_DOC_PATHS.map((docPath) => `- ${docPath}`),
    ].join("\n");
    const wave = parseWaveContent(
      `# Wave 5 - Sample

**Commit message**: \`Docs: sample\`

## Agent A9: Documentation Steward

### Role prompts

- ${WAVE_DOCUMENTATION_ROLE_PROMPT_PATH}

### Prompt
\`\`\`text
${overlayPrompt}
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-5.md"),
    );

    expect(wave.agents[0]).toMatchObject({
      agentId: "A9",
      promptOverlay: overlayPrompt,
      rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
      ownedPaths: SHARED_PLAN_DOC_PATHS,
    });
    expect(wave.agents[0]?.prompt).toContain(
      "You are the wave documentation steward for the current wave.",
    );
    expect(wave.agents[0]?.prompt).toContain("same-wave closure of the shared plan docs");
    expect(wave.agents[0]?.prompt).toContain("exact-scope `no-change` note");
  });

  it("extracts wave-level and agent-level Context7 settings separately from prompt ownership", () => {
    const wave = parseWaveContent(
      `# Wave 4 - Sample

## Context7 defaults

- bundle: core-go
- query: "Temporal bootstrap and schedules"

## Agent A1: Worker

### Context7

- query: "Temporal activity retry policy"

### Prompt
\`\`\`text
Read docs/code-guidance.md.
Read docs/research/hardening-tech-stack.md.

File ownership (only touch these paths):
- go/internal/workflows/example.go
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-4.md"),
    );

    expect(wave.context7Defaults).toEqual({
      bundle: "core-go",
      query: "Temporal bootstrap and schedules",
    });
    expect(wave.agents[0]?.context7Config).toEqual({
      query: "Temporal activity retry policy",
      bundle: null,
    });
    expect(wave.agents[0]?.ownedPaths).toEqual(["go/internal/workflows/example.go"]);
  });

  it("extracts structured exit contracts for waves that declare them", () => {
    const wave = parseWaveContent(
      `# Wave 6 - Sample

## Context7 defaults

- bundle: plugins
- query: "Plugin compatibility host"

## Agent A1: Worker

### Context7

- bundle: plugins
- query: "Node lifecycle"

### Exit contract

- completion: integrated
- durability: none
- proof: integration
- doc-impact: owned

### Prompt
\`\`\`text
Read docs/code-guidance.md.
Read docs/research/hardening-tech-stack.md.

File ownership (only touch these paths):
- go/internal/plugins/host/example.go
\`\`\`
`,
      path.join(REPO_ROOT, "docs/plans/waves/wave-6.md"),
    );

    expect(wave.agents[0]?.exitContract).toEqual({
      completion: "integrated",
      durability: "none",
      proof: "integration",
      docImpact: "owned",
    });
  });

  it("rejects role prompts outside docs/agents", () => {
    expect(() =>
      parseWaveContent(
        `# Wave 1 - Sample

**Commit message**: \`Docs: sample\`

## Agent A1: First Task

### Role prompts

- docs/plans/current-state.md

### Prompt
\`\`\`text
Do the first thing.
\`\`\`
`,
        path.join(REPO_ROOT, "docs/plans/waves/wave-1.md"),
      ),
    ).toThrow(/must stay within docs\/agents/);
  });

  it("rejects missing role prompt files", () => {
    expect(() =>
      parseWaveContent(
        `# Wave 1 - Sample

**Commit message**: \`Docs: sample\`

## Agent A1: First Task

### Role prompts

- docs/agents/__missing-wave-files-role-test__.md

### Prompt
\`\`\`text
Do the first thing.
\`\`\`
`,
        path.join(REPO_ROOT, "docs/plans/waves/wave-1.md"),
      ),
    ).toThrow(/Missing role prompt/);
  });

  it("rejects malformed role prompt docs without a standing prompt block", () => {
    const rolePromptRelPath = "docs/agents/__wave-files-invalid-role-test__.md";
    const rolePromptAbsPath = registerTempPath(path.join(REPO_ROOT, rolePromptRelPath));
    fs.mkdirSync(path.dirname(rolePromptAbsPath), { recursive: true });
    fs.writeFileSync(rolePromptAbsPath, "# Invalid role doc\n", "utf8");

    expect(() =>
      parseWaveContent(
        `# Wave 1 - Sample

**Commit message**: \`Docs: sample\`

## Agent A1: First Task

### Role prompts

- ${rolePromptRelPath}

### Prompt
\`\`\`text
Do the first thing.
\`\`\`
`,
        path.join(REPO_ROOT, "docs/plans/waves/wave-1.md"),
      ),
    ).toThrow(/Missing "## Standing prompt" section/);
  });

  it("changes the resolved prompt hash when an imported role prompt changes", () => {
    const rolePromptRelPath = "docs/agents/__wave-files-hash-role-test__.md";
    const rolePromptAbsPath = registerTempPath(path.join(REPO_ROOT, rolePromptRelPath));
    fs.mkdirSync(path.dirname(rolePromptAbsPath), { recursive: true });
    const waveContent = `# Wave 1 - Sample

**Commit message**: \`Docs: sample\`

## Agent A1: First Task

### Role prompts

- ${rolePromptRelPath}

### Prompt
\`\`\`text
File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-1-cont-qa.md
\`\`\`
`;

    fs.writeFileSync(
      rolePromptAbsPath,
      "## Standing prompt\n\n```text\nRole version one.\n```\n",
      "utf8",
    );
    const firstPrompt = parseWaveContent(
      waveContent,
      path.join(REPO_ROOT, "docs/plans/waves/wave-1.md"),
    ).agents[0]?.prompt;

    fs.writeFileSync(
      rolePromptAbsPath,
      "## Standing prompt\n\n```text\nRole version two.\n```\n",
      "utf8",
    );
    const secondPrompt = parseWaveContent(
      waveContent,
      path.join(REPO_ROOT, "docs/plans/waves/wave-1.md"),
    ).agents[0]?.prompt;

    expect(firstPrompt).not.toBe(secondPrompt);
    expect(hashText(firstPrompt)).not.toBe(hashText(secondPrompt));
  });
});

describe("normalizeCompletedWaves", () => {
  it("preserves wave 0 and removes invalid entries", () => {
    expect(normalizeCompletedWaves([2, "0", 1, -1, "nope", 0])).toEqual([0, 1, 2]);
  });
});

describe("validateWaveDefinition", () => {
  const leapClawPrompt = [
    "Read docs/reference/repository-guidance.md.",
    "Read docs/research/agent-context-sources.md.",
    "",
    "File ownership (only touch these paths):",
    "- go/example/file.go",
  ].join("\n");
  const documentationStewardPrompt = [
    "Read docs/reference/repository-guidance.md.",
    "Read docs/research/agent-context-sources.md.",
    "",
    "File ownership (only touch these paths):",
    ...starterDocumentationPaths.map((docPath) => `- ${docPath}`),
  ].join("\n");
  const integrationStewardPrompt = [
    "Read docs/reference/repository-guidance.md.",
    "Read docs/research/agent-context-sources.md.",
    "",
    "File ownership (only touch these paths):",
    "- .tmp/main-wave-launcher/integration/wave-0.json",
    "- .tmp/main-wave-launcher/integration/wave-0.md",
  ].join("\n");

  it("accepts a valid leap-claw wave definition", () => {
    expect(
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          componentPromotions: starterComponentPromotions,
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-0-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
            },
            {
              agentId: "A8",
              prompt: integrationStewardPrompt,
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-0.json",
                ".tmp/main-wave-launcher/integration/wave-0.md",
              ],
            },
            {
              agentId: "A9",
              prompt: documentationStewardPrompt,
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: starterDocumentationPaths,
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              components: Object.keys(starterComponentTargets),
              componentTargets: starterComponentTargets,
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toMatchObject({ wave: 0 });
  });

  it("accepts a security reviewer without components or an exit contract", () => {
    expect(
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          componentPromotions: starterComponentPromotions,
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-0-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
            },
            {
              agentId: "A8",
              prompt: integrationStewardPrompt,
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-0.json",
                ".tmp/main-wave-launcher/integration/wave-0.md",
              ],
            },
            {
              agentId: "A9",
              prompt: documentationStewardPrompt,
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: starterDocumentationPaths,
            },
            {
              agentId: "A7",
              title: "Security Engineer",
              prompt: [
                "Read docs/reference/repository-guidance.md.",
                "Read docs/research/agent-context-sources.md.",
                "",
                "File ownership (only touch these paths):",
                "- .tmp/main-wave-launcher/security/wave-0-review.md",
              ].join("\n"),
              rolePromptPaths: [WAVE_SECURITY_ROLE_PROMPT_PATH],
              ownedPaths: [".tmp/main-wave-launcher/security/wave-0-review.md"],
              capabilities: ["security-review"],
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              components: Object.keys(starterComponentTargets),
              componentTargets: starterComponentTargets,
              exitContract: {
                completion: "integrated",
                durability: "none",
                proof: "integration",
                docImpact: "owned",
              },
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toMatchObject({ wave: 0 });
  });

  it("requires security reviewers to import the standing security role prompt", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          componentPromotions: starterComponentPromotions,
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-0-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
            },
            {
              agentId: "A8",
              prompt: integrationStewardPrompt,
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-0.json",
                ".tmp/main-wave-launcher/integration/wave-0.md",
              ],
            },
            {
              agentId: "A9",
              prompt: documentationStewardPrompt,
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: starterDocumentationPaths,
            },
            {
              agentId: "A7",
              title: "Security Engineer",
              prompt: [
                "Read docs/reference/repository-guidance.md.",
                "Read docs/research/agent-context-sources.md.",
                "",
                "File ownership (only touch these paths):",
                "- .tmp/main-wave-launcher/security/wave-0-review.md",
              ].join("\n"),
              rolePromptPaths: [],
              ownedPaths: [".tmp/main-wave-launcher/security/wave-0-review.md"],
              capabilities: ["security-review"],
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              components: Object.keys(starterComponentTargets),
              componentTargets: starterComponentTargets,
              exitContract: {
                completion: "integrated",
                durability: "none",
                proof: "integration",
                docImpact: "owned",
              },
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(new RegExp(`must import ${WAVE_SECURITY_ROLE_PROMPT_PATH}`));
  });

  it("requires security reviewers to own a security review report path", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          componentPromotions: starterComponentPromotions,
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-0-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
            },
            {
              agentId: "A8",
              prompt: integrationStewardPrompt,
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-0.json",
                ".tmp/main-wave-launcher/integration/wave-0.md",
              ],
            },
            {
              agentId: "A9",
              prompt: documentationStewardPrompt,
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: starterDocumentationPaths,
            },
            {
              agentId: "A7",
              title: "Security Engineer",
              prompt: [
                "Read docs/reference/repository-guidance.md.",
                "Read docs/research/agent-context-sources.md.",
                "",
                "File ownership (only touch these paths):",
                "- docs/reviews/wave-0.md",
              ].join("\n"),
              rolePromptPaths: [WAVE_SECURITY_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/reviews/wave-0.md"],
              capabilities: ["security-review"],
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              components: Object.keys(starterComponentTargets),
              componentTargets: starterComponentTargets,
              exitContract: {
                completion: "integrated",
                durability: "none",
                proof: "integration",
                docImpact: "owned",
              },
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(/must own a security review report path/);
  });

  it("does not classify implementation agents by title alone as security reviewers", () => {
    expect(
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          componentPromotions: starterComponentPromotions,
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-0-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
            },
            {
              agentId: "A8",
              prompt: integrationStewardPrompt,
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-0.json",
                ".tmp/main-wave-launcher/integration/wave-0.md",
              ],
            },
            {
              agentId: "A9",
              prompt: documentationStewardPrompt,
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: starterDocumentationPaths,
            },
            {
              agentId: "A1",
              title: "Security Hardening Engineer",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              components: Object.keys(starterComponentTargets),
              componentTargets: starterComponentTargets,
              exitContract: {
                completion: "integrated",
                durability: "none",
                proof: "integration",
                docImpact: "owned",
              },
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toMatchObject({ wave: 0 });
  });

  it("rejects leap-claw waves without a cont-QA role", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          agents: [
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(/must include Agent A0/);
  });

  it("rejects leap-claw waves missing required references", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          agents: [
            {
              agentId: "A0",
              prompt: [
                "Read docs/reference/repository-guidance.md.",
                "",
                "File ownership (only touch these paths):",
                "- docs/plans/waves/reviews/wave-0-cont-qa.md",
              ].join("\n"),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(/must reference docs\/research\/agent-context-sources\.md/);
  });

  it("rejects leap-claw cont-QA agents that do not import the standing cont-QA role", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-0-cont-qa.md",
              ),
              rolePromptPaths: [],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(new RegExp(`must import ${WAVE_CONT_QA_ROLE_PROMPT_PATH}`));
  });

  it("requires one documentation steward for leap-claw waves 5 and later", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 5,
          file: "docs/plans/waves/wave-5.md",
          componentPromotions: starterComponentPromotions,
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-5-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-5-cont-qa.md"],
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(new RegExp(`must include exactly one documentation steward importing ${WAVE_DOCUMENTATION_ROLE_PROMPT_PATH}`));
  });

  it("accepts waves when the documentation steward owns the shared plan and matrix docs", () => {
    expect(
      validateWaveDefinition(
        {
          wave: 0,
          file: "docs/plans/waves/wave-0.md",
          componentPromotions: starterComponentPromotions,
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-0-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-cont-qa.md"],
            },
            {
              agentId: "A8",
              prompt: integrationStewardPrompt,
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-0.json",
                ".tmp/main-wave-launcher/integration/wave-0.md",
              ],
            },
            {
              agentId: "A9",
              prompt: documentationStewardPrompt,
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: starterDocumentationPaths,
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              components: Object.keys(starterComponentTargets),
              componentTargets: starterComponentTargets,
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toMatchObject({ wave: 0 });
  });

  it("requires Context7 declarations and exit contracts for leap-claw waves 6 and later", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 6,
          file: "docs/plans/waves/wave-6.md",
          context7Defaults: {
            bundle: "plugins",
            query: "Plugin host work",
          },
          componentPromotions: starterComponentPromotions,
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-6-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-6-cont-qa.md"],
              context7Config: { bundle: "none", query: "repo truth only" },
            },
            {
              agentId: "A8",
              prompt: [
                "Read docs/reference/repository-guidance.md.",
                "Read docs/research/agent-context-sources.md.",
                "",
                "File ownership (only touch these paths):",
                "- .tmp/main-wave-launcher/integration/wave-6.json",
                "- .tmp/main-wave-launcher/integration/wave-6.md",
              ].join("\n"),
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-6.json",
                ".tmp/main-wave-launcher/integration/wave-6.md",
              ],
              context7Config: { bundle: "none", query: "repo truth only" },
            },
            {
              agentId: "A9",
              prompt: documentationStewardPrompt,
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: starterDocumentationPaths,
              context7Config: { bundle: "none", query: "repo truth only" },
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              context7Config: { bundle: "plugins", query: "Node lifecycle" },
              components: Object.keys(starterComponentTargets),
              componentTargets: starterComponentTargets,
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(/must declare a ### Exit contract section/);
  });

  it("accepts the retrofitted remaining wave files", () => {
    const waves = parseWaveFiles(path.join(REPO_ROOT, "docs/plans/waves"));
      waves
        .filter((wave) => wave.wave >= 6 && wave.wave <= 11)
        .forEach((wave) => {
          expect(() => validateWaveDefinition(wave, { lane: "leap-claw" })).not.toThrow();
        });
  });

  it("requires eval targets when cont-EVAL is present", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 4,
          file: "docs/plans/waves/wave-4.md",
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-4-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-4-cont-qa.md"],
            },
            {
              agentId: "E0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-4-cont-eval.md",
              ),
              rolePromptPaths: [WAVE_CONT_EVAL_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-4-cont-eval.md"],
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(/must declare a ## Eval targets section when E0 is present/);
  });

  it("allows report-only cont-EVAL agents to stay exempt from implementation exit contracts", () => {
    const wave6DocumentationPaths = requiredDocumentationStewardPathsForWave(6);
    expect(
      validateWaveDefinition(
        {
          wave: 6,
          file: "docs/plans/waves/wave-6.md",
          evalTargets: [
            {
              id: "response-quality",
              selection: "delegated",
              benchmarkFamily: "service-output",
              benchmarks: [],
              objective: "Tune response quality",
              threshold: "Golden response smoke passes",
            },
          ],
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-6-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-6-cont-qa.md"],
              context7Config: { bundle: "none", query: "repo truth only" },
            },
            {
              agentId: "E0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-6-cont-eval.md",
              ),
              rolePromptPaths: [WAVE_CONT_EVAL_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-6-cont-eval.md"],
              context7Config: { bundle: "none", query: "repo truth only" },
            },
            {
              agentId: "A8",
              prompt: integrationStewardPrompt.replaceAll("wave-0", "wave-6"),
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-6.json",
                ".tmp/main-wave-launcher/integration/wave-6.md",
              ],
              context7Config: { bundle: "none", query: "repo truth only" },
            },
            {
              agentId: "A9",
              prompt: [
                "Read docs/reference/repository-guidance.md.",
                "Read docs/research/agent-context-sources.md.",
                "",
                "File ownership (only touch these paths):",
                ...wave6DocumentationPaths.map((docPath) => `- ${docPath}`),
              ].join("\n"),
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: wave6DocumentationPaths,
              context7Config: { bundle: "none", query: "repo truth only" },
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              context7Config: { bundle: "none", query: "repo truth only" },
              exitContract: {
                completion: "contract",
                durability: "none",
                proof: "unit",
                docImpact: "owned",
              },
            },
          ],
          context7Defaults: { bundle: "none", query: "repo truth only" },
        },
        {
          laneProfile: {
            lane: "leap-claw",
            roles: {
              contQaAgentId: "A0",
              contQaRolePromptPath: WAVE_CONT_QA_ROLE_PROMPT_PATH,
              contEvalAgentId: "E0",
              contEvalRolePromptPath: WAVE_CONT_EVAL_ROLE_PROMPT_PATH,
              integrationAgentId: "A8",
              integrationRolePromptPath: WAVE_INTEGRATION_ROLE_PROMPT_PATH,
              documentationAgentId: "A9",
              documentationRolePromptPath: WAVE_DOCUMENTATION_ROLE_PROMPT_PATH,
            },
            validation: {
              requiredPromptReferences: [],
              requireComponentPromotionsFromWave: null,
              requireDocumentationStewardFromWave: 5,
              requireContext7DeclarationsFromWave: 6,
              requireExitContractsFromWave: 6,
              requireIntegrationStewardFromWave: 0,
              requireAgentComponentsFromWave: null,
            },
            paths: {
              benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
              componentCutoverMatrixJsonPath: "docs/plans/component-cutover-matrix.json",
              componentCutoverMatrixDocPath: "docs/plans/component-cutover-matrix.md",
            },
            sharedPlanDocs: SHARED_PLAN_DOC_PATHS,
          },
        },
      ),
    ).toMatchObject({ wave: 6 });
  });

  it("requires implementation-owning cont-EVAL agents to declare an exit contract", () => {
    const wave6DocumentationPaths = requiredDocumentationStewardPathsForWave(6);
    expect(() =>
      validateWaveDefinition(
        {
          wave: 6,
          file: "docs/plans/waves/wave-6.md",
          evalTargets: [
            {
              id: "response-quality",
              selection: "delegated",
              benchmarkFamily: "service-output",
              benchmarks: [],
              objective: "Tune response quality",
              threshold: "Golden response smoke passes",
            },
          ],
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-6-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-6-cont-qa.md"],
            },
            {
              agentId: "E0",
              prompt: [
                "Read docs/reference/repository-guidance.md.",
                "Read docs/research/agent-context-sources.md.",
                "",
                "File ownership (only touch these paths):",
                "- docs/plans/waves/reviews/wave-6-cont-eval.md",
                "- go/example/eval-tuning.go",
              ].join("\n"),
              rolePromptPaths: [WAVE_CONT_EVAL_ROLE_PROMPT_PATH],
              ownedPaths: [
                "docs/plans/waves/reviews/wave-6-cont-eval.md",
                "go/example/eval-tuning.go",
              ],
            },
            {
              agentId: "A8",
              prompt: integrationStewardPrompt.replaceAll("wave-0", "wave-6"),
              rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
              ownedPaths: [
                ".tmp/main-wave-launcher/integration/wave-6.json",
                ".tmp/main-wave-launcher/integration/wave-6.md",
              ],
            },
            {
              agentId: "A9",
              prompt: [
                "Read docs/reference/repository-guidance.md.",
                "Read docs/research/agent-context-sources.md.",
                "",
                "File ownership (only touch these paths):",
                ...wave6DocumentationPaths.map((docPath) => `- ${docPath}`),
              ].join("\n"),
              rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
              ownedPaths: wave6DocumentationPaths,
            },
            {
              agentId: "A1",
              prompt: leapClawPrompt,
              ownedPaths: ["go/example/file.go"],
              exitContract: {
                completion: "contract",
                durability: "none",
                proof: "unit",
                docImpact: "owned",
              },
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(/Agent E0 must declare a ### Exit contract section/);
  });

  it("rejects eval targets when cont-EVAL is not present", () => {
    expect(() =>
      validateWaveDefinition(
        {
          wave: 4,
          file: "docs/plans/waves/wave-4.md",
          evalTargets: [
            {
              id: "response-quality",
              selection: "delegated",
              benchmarkFamily: "service-output",
              benchmarks: [],
              objective: "Tune response quality",
              threshold: "Manual review passes",
            },
          ],
          agents: [
            {
              agentId: "A0",
              prompt: leapClawPrompt.replace(
                "go/example/file.go",
                "docs/plans/waves/reviews/wave-4-cont-qa.md",
              ),
              rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-4-cont-qa.md"],
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(/declares ## Eval targets but does not include Agent E0/);
  });
});

describe("completedWavesFromStatusFiles", () => {
  it("rejects waves that exceed configured runtime mix targets", () => {
    expect(
      validateWaveRuntimeMixAssignments(
        {
          wave: 3,
          agents: [
            { agentId: "A1", executorResolved: { id: "claude" } },
            { agentId: "A2", executorResolved: { id: "claude" } },
          ],
        },
        {
          laneProfile: {
            executors: { default: "codex" },
            runtimePolicy: {
              runtimeMixTargets: {
                claude: 1,
              },
            },
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "runtime-mix-exceeded",
    });
  });

  it("requires prompt-hash-matching status files and cont-QA PASS", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-completion`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    const reportRelPath = `.tmp/${path.basename(tempRoot)}/wave-0-cont-qa.md`;
    const evaluatorPrompt = [
      "Read docs/code-guidance.md.",
      "Read docs/research/hardening-tech-stack.md.",
      "",
      "File ownership (only touch these paths):",
      `- ${reportRelPath}`,
    ].join("\n");
    const workerPrompt = [
      "Read docs/code-guidance.md.",
      "Read docs/research/hardening-tech-stack.md.",
      "",
      "File ownership (only touch these paths):",
      "- go/example/file.go",
    ].join("\n");
    const wave = {
      wave: 0,
      file: "docs/plans/waves/wave-0.md",
      componentPromotions: [
        { componentId: "wave-parser-and-launcher", targetLevel: "repo-landed" },
      ],
      agents: [
        {
          agentId: "A0",
          slug: "0-a0",
          prompt: evaluatorPrompt,
        },
        {
          agentId: "A1",
          slug: "0-a1",
          prompt: workerPrompt,
          components: ["wave-parser-and-launcher"],
          componentTargets: {
            "wave-parser-and-launcher": "repo-landed",
          },
        },
      ],
      contQaReportPath: reportRelPath,
    };

    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# cont-QA\n\nVerdict: PASS\n", "utf8");
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a0.status"),
      JSON.stringify(
        {
          code: 0,
          promptHash: "bad-hash",
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a1.status"),
      JSON.stringify(
        {
          code: 0,
          promptHash: "bad-hash",
        },
        null,
        2,
      ),
      "utf8",
    );
    expect(completedWavesFromStatusFiles([wave], statusDir, { logsDir })).toEqual([]);

    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a0.status"),
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(wave.agents[0]),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a1.status"),
      JSON.stringify(
        {
          code: 0,
          promptHash: hashAgentPromptFingerprint(wave.agents[1]),
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a0.summary.json"),
      JSON.stringify(
        {
          agentId: "A0",
          reportPath: reportRelPath,
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
          },
          verdict: { verdict: "pass", detail: "ready" },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a1.summary.json"),
      JSON.stringify(
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["go/example/file.go"],
          },
          components: [
            {
              componentId: "wave-parser-and-launcher",
              level: "repo-landed",
              state: "met",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      completedWavesFromStatusFiles([wave], statusDir, {
        logsDir,
        requireComponentPromotionsFromWave: 0,
      }),
    ).toEqual([0]);
  });

  it("requires documentation closure before marking a component-promotion wave complete", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-doc-closure`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    const reportRelPath = `.tmp/${path.basename(tempRoot)}/wave-0-cont-qa.md`;
    const wave = {
      wave: 0,
      file: "docs/plans/waves/wave-0.md",
      componentPromotions: [
        { componentId: "wave-parser-and-launcher", targetLevel: "repo-landed" },
      ],
      agents: [
        {
          agentId: "A0",
          slug: "0-a0",
          prompt: `File ownership (only touch these paths):\n- ${reportRelPath}`,
          rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
        },
        {
          agentId: "A8",
          slug: "0-a8",
          prompt: [
            "File ownership (only touch these paths):",
            "- .tmp/main-wave-launcher/integration/wave-0.json",
            "- .tmp/main-wave-launcher/integration/wave-0.md",
          ].join("\n"),
          rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
        },
        {
          agentId: "A9",
          slug: "0-a9",
          prompt: [
            "File ownership (only touch these paths):",
            ...starterDocumentationPaths.map((docPath) => `- ${docPath}`),
          ].join("\n"),
          rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
        },
        {
          agentId: "A1",
          slug: "0-a1",
          prompt: "File ownership (only touch these paths):\n- go/example/file.go",
          components: ["wave-parser-and-launcher"],
          componentTargets: {
            "wave-parser-and-launcher": "repo-landed",
          },
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
      ],
      contQaReportPath: reportRelPath,
    };

    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# cont-QA\n\nVerdict: PASS\n", "utf8");
    for (const agent of wave.agents) {
      fs.writeFileSync(
        path.join(statusDir, `wave-0-${agent.slug}.status`),
        JSON.stringify(
          {
            code: 0,
            promptHash: hashAgentPromptFingerprint(agent),
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a0.summary.json"),
      JSON.stringify(
        {
          reportPath: reportRelPath,
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
          },
          verdict: { verdict: "pass" },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a1.summary.json"),
      JSON.stringify(
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["go/example/file.go"],
          },
          components: [
            {
              componentId: "wave-parser-and-launcher",
              level: "repo-landed",
              state: "met",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      completedWavesFromStatusFiles([wave], statusDir, {
        logsDir,
        requireComponentPromotionsFromWave: 0,
      }),
    ).toEqual([]);
  });

  it("requires integration closure before marking an integration-gated wave complete", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-integration-closure`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    const reportRelPath = `.tmp/${path.basename(tempRoot)}/wave-0-cont-qa.md`;
    const wave = {
      wave: 0,
      file: "docs/plans/waves/wave-0.md",
      componentPromotions: [
        { componentId: "wave-parser-and-launcher", targetLevel: "repo-landed" },
      ],
      agents: [
        {
          agentId: "A0",
          slug: "0-a0",
          prompt: `File ownership (only touch these paths):\n- ${reportRelPath}`,
          rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
        },
        {
          agentId: "A8",
          slug: "0-a8",
          prompt: [
            "File ownership (only touch these paths):",
            "- .tmp/main-wave-launcher/integration/wave-0.json",
            "- .tmp/main-wave-launcher/integration/wave-0.md",
          ].join("\n"),
          rolePromptPaths: [WAVE_INTEGRATION_ROLE_PROMPT_PATH],
        },
        {
          agentId: "A9",
          slug: "0-a9",
          prompt: [
            "File ownership (only touch these paths):",
            ...starterDocumentationPaths.map((docPath) => `- ${docPath}`),
          ].join("\n"),
          rolePromptPaths: [WAVE_DOCUMENTATION_ROLE_PROMPT_PATH],
        },
        {
          agentId: "A1",
          slug: "0-a1",
          prompt: "File ownership (only touch these paths):\n- go/example/file.go",
          components: ["wave-parser-and-launcher"],
          componentTargets: {
            "wave-parser-and-launcher": "repo-landed",
          },
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
      ],
      contQaReportPath: reportRelPath,
    };

    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# cont-QA\n\nVerdict: PASS\n", "utf8");
    for (const agent of wave.agents) {
      fs.writeFileSync(
        path.join(statusDir, `wave-0-${agent.slug}.status`),
        JSON.stringify(
          {
            code: 0,
            promptHash: hashAgentPromptFingerprint(agent),
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a0.summary.json"),
      JSON.stringify(
        {
          reportPath: reportRelPath,
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
          },
          verdict: { verdict: "pass" },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a9.summary.json"),
      JSON.stringify(
        {
          docClosure: {
            state: "closed",
            detail: "Shared docs aligned",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a1.summary.json"),
      JSON.stringify(
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["go/example/file.go"],
          },
          components: [
            {
              componentId: "wave-parser-and-launcher",
              level: "repo-landed",
              state: "met",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      completedWavesFromStatusFiles([wave], statusDir, {
        logsDir,
        requireComponentPromotionsFromWave: 0,
        requireIntegrationStewardFromWave: 0,
      }),
    ).toEqual([]);
  });

  it("does not mark a wave complete while clarification follow-up requests remain open", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-clarification-open`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    const coordinationDir = path.join(tempRoot, "coordination");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(coordinationDir, { recursive: true });

    const reportRelPath = `.tmp/${path.basename(tempRoot)}/wave-0-cont-qa.md`;
    const wave = {
      wave: 0,
      file: "docs/plans/waves/wave-0.md",
      componentPromotions: [],
      agents: [
        {
          agentId: "A0",
          slug: "0-a0",
          prompt: `File ownership (only touch these paths):\n- ${reportRelPath}`,
          rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
        },
        {
          agentId: "A1",
          slug: "0-a1",
          prompt: "File ownership (only touch these paths):\n- src/example.ts",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
      ],
      contQaReportPath: reportRelPath,
    };

    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# cont-QA\n\nVerdict: PASS\n", "utf8");
    for (const agent of wave.agents) {
      fs.writeFileSync(
        path.join(statusDir, `wave-0-${agent.slug}.status`),
        JSON.stringify(
          {
            code: 0,
            promptHash: hashAgentPromptFingerprint(agent),
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a0.summary.json"),
      JSON.stringify(
        {
          reportPath: reportRelPath,
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
          },
          verdict: { verdict: "pass" },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a1.summary.json"),
      JSON.stringify(
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["src/example.ts"],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(coordinationDir, "wave-0.jsonl"),
      [
        JSON.stringify({
          id: "clarify-a1",
          kind: "clarification-request",
          wave: 0,
          lane: "main",
          agentId: "A1",
          status: "in_progress",
          priority: "high",
          targets: ["agent:A9"],
          summary: "Need shared plan answer",
          detail: "Waiting on shared plan guidance",
        }),
        JSON.stringify({
          id: "route-clarify-a1-1",
          kind: "request",
          wave: 0,
          lane: "main",
          agentId: "launcher",
          status: "open",
          priority: "high",
          targets: ["agent:A9"],
          dependsOn: ["clarify-a1"],
          closureCondition: "clarification:clarify-a1",
          summary: "Clarification follow-up for A1",
          detail: "Resolve docs scope",
        }),
      ].join("\n"),
      "utf8",
    );

    expect(
      completedWavesFromStatusFiles([wave], statusDir, {
        logsDir,
        coordinationDir,
      }),
    ).toEqual([]);
  });

  it("stops treating downgraded clarification follow-up records as completion blockers", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-clarification-advisory`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    const coordinationDir = path.join(tempRoot, "coordination");
    const runStatePath = path.join(tempRoot, "run-state.json");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(coordinationDir, { recursive: true });

    const reportRelPath = `.tmp/${path.basename(tempRoot)}/wave-0-cont-qa.md`;
    const wave = {
      wave: 0,
      file: "docs/plans/waves/wave-0.md",
      componentPromotions: [],
      agents: [
        {
          agentId: "A0",
          slug: "0-a0",
          prompt: `File ownership (only touch these paths):\n- ${reportRelPath}`,
          rolePromptPaths: [WAVE_CONT_QA_ROLE_PROMPT_PATH],
        },
        {
          agentId: "A1",
          slug: "0-a1",
          prompt: "File ownership (only touch these paths):\n- src/example.ts",
          exitContract: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            docImpact: "owned",
          },
        },
      ],
      contQaReportPath: reportRelPath,
    };

    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# cont-QA\n\nVerdict: PASS\n", "utf8");
    for (const agent of wave.agents) {
      fs.writeFileSync(
        path.join(statusDir, `wave-0-${agent.slug}.status`),
        JSON.stringify(
          {
            code: 0,
            promptHash: hashAgentPromptFingerprint(agent),
          },
          null,
          2,
        ),
        "utf8",
      );
    }
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a0.summary.json"),
      JSON.stringify(
        {
          reportPath: reportRelPath,
          gate: {
            architecture: "pass",
            integration: "pass",
            durability: "pass",
            live: "pass",
            docs: "pass",
          },
          verdict: { verdict: "pass" },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(statusDir, "wave-0-0-a1.summary.json"),
      JSON.stringify(
        {
          agentId: "A1",
          proof: {
            completion: "contract",
            durability: "none",
            proof: "unit",
            state: "met",
          },
          docDelta: {
            state: "owned",
            paths: ["src/example.ts"],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(coordinationDir, "wave-0.jsonl"),
      [
        JSON.stringify({
          id: "clarify-a1",
          kind: "clarification-request",
          wave: 0,
          lane: "main",
          agentId: "A1",
          status: "open",
          priority: "high",
          blocking: false,
          blockerSeverity: "advisory",
          targets: ["agent:A9"],
          summary: "Optional shared plan note",
          detail: "Helpful but no longer required for closure",
        }),
        JSON.stringify({
          id: "route-clarify-a1-1",
          kind: "request",
          wave: 0,
          lane: "main",
          agentId: "launcher",
          status: "open",
          priority: "high",
          blocking: false,
          blockerSeverity: "advisory",
          targets: ["agent:A9"],
          dependsOn: ["clarify-a1"],
          closureCondition: "clarification:clarify-a1",
          summary: "Advisory clarification follow-up",
          detail: "Keep visible without blocking completion",
        }),
      ].join("\n"),
      "utf8",
    );

    const reconciliation = reconcileRunStateFromStatusFiles([wave], runStatePath, statusDir, {
      logsDir,
      coordinationDir,
    });
    const blockedReasons = reconciliation.blockedFromStatus.flatMap((entry) => entry.reasons || []);

    expect(blockedReasons.map((reason) => reason.code)).not.toContain("open-clarification");
    expect(blockedReasons.map((reason) => reason.code)).not.toContain("open-clarification-request");
  });
});

describe("validateWaveComponentMatrixCurrentLevels", () => {
  it("requires the matrix currentLevel to advance to the promoted target", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-matrix-state`),
    );
    const matrixJsonPath = path.join(tempRoot, "component-cutover-matrix.json");
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.writeFileSync(
      matrixJsonPath,
      JSON.stringify(
        {
          version: 1,
          levels: ["repo-landed", "baseline-proved"],
          components: {
            "wave-parser-and-launcher": {
              title: "Wave parser and launcher",
              currentLevel: "repo-landed",
              promotions: [{ wave: 2, target: "baseline-proved" }],
              canonicalDocs: ["README.md"],
              proofSurfaces: ["launcher dry-run"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(
      validateWaveComponentMatrixCurrentLevels(
        {
          wave: 2,
          componentPromotions: [
            { componentId: "wave-parser-and-launcher", targetLevel: "baseline-proved" },
          ],
        },
        {
          laneProfile: {
            validation: { requireComponentPromotionsFromWave: 0 },
            paths: {
              componentCutoverMatrixJsonPath: path.relative(REPO_ROOT, matrixJsonPath),
              componentCutoverMatrixDocPath: "docs/plans/component-cutover-matrix.md",
            },
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      statusCode: "component-current-level-stale",
      componentId: "wave-parser-and-launcher",
    });
  });

  it("skips matrix loading when a wave declares no component promotions", () => {
    expect(
      validateWaveComponentMatrixCurrentLevels(
        {
          wave: 2,
          agents: [
            {
              agentId: "A1",
              title: "Implementation",
              components: ["wave-parser-and-launcher"],
            },
          ],
          componentPromotions: [],
        },
        {
          laneProfile: {
            validation: { requireComponentPromotionsFromWave: 0 },
          },
          componentMatrixPayload: {
            version: 1,
            levels: [],
            components: {},
          },
        },
      ),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
    });
  });
});

describe("validateWaveComponentPromotions", () => {
  it("defaults missing laneProfile roles instead of throwing", () => {
    expect(
      validateWaveComponentPromotions(
        {
          wave: 0,
          componentPromotions: [
            { componentId: "wave-parser-and-launcher", targetLevel: "repo-landed" },
          ],
          agents: [
            {
              agentId: "A1",
              components: ["wave-parser-and-launcher"],
              componentTargets: { "wave-parser-and-launcher": "repo-landed" },
            },
          ],
        },
        {
          A1: {
            components: [
              {
                componentId: "wave-parser-and-launcher",
                level: "repo-landed",
                state: "met",
              },
            ],
          },
        },
        {
          laneProfile: {
            validation: { requireComponentPromotionsFromWave: 0 },
          },
        },
      ),
    ).toMatchObject({
      ok: true,
      statusCode: "pass",
      componentId: null,
    });
  });
});

describe("reconcileRunStateFromStatusFiles", () => {
  function makeReconcileWave(tempRoot) {
    return {
      wave: 200,
      file: "docs/research/runtime-waves/wave-200.md",
      agents: [
        {
          agentId: "A0",
          slug: "200-a0",
          prompt: [
            "Read docs/code-guidance.md.",
            "",
            "File ownership (only touch these paths):",
            "- docs/research/runtime-waves/reviews/wave-200-cont-qa.md",
          ].join("\n"),
        },
        {
          agentId: "A1",
          slug: "200-a1",
          prompt: [
            "Read docs/code-guidance.md.",
            "",
            "File ownership (only touch these paths):",
            "- docs/research/runtime-waves/wave-200.md",
          ].join("\n"),
        },
        {
          agentId: "A8",
          slug: "200-a8",
          prompt: [
            "Read docs/code-guidance.md.",
            "",
            "File ownership (only touch these paths):",
            "- docs/research/runtime-waves/reviews/wave-200-integration.md",
          ].join("\n"),
        },
        {
          agentId: "A9",
          slug: "200-a9",
          prompt: [
            "Read docs/code-guidance.md.",
            "",
            "File ownership (only touch these paths):",
            "- docs/research/runtime-waves/reviews/wave-200-docs.md",
          ].join("\n"),
        },
      ],
      contQaReportPath: `.tmp/${path.basename(tempRoot)}/wave-200-cont-qa.md`,
    };
  }

  function writeStatus(statusDir, agent, payload) {
    fs.writeFileSync(
      path.join(statusDir, `wave-200-${agent.slug}.status`),
      JSON.stringify(payload, null, 2),
      "utf8",
    );
  }

  function writeSummary(statusDir, agent, payload) {
    fs.writeFileSync(
      path.join(statusDir, `wave-200-${agent.slug}.summary.json`),
      JSON.stringify({ agentId: agent.agentId, ...payload }, null, 2),
      "utf8",
    );
  }

  it("does not mark waves complete from legacy plain-int status files without metadata", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-reconcile`),
    );
    const statusDir = path.join(tempRoot, "status");
    const runStatePath = path.join(tempRoot, "run-state.json");
    fs.mkdirSync(statusDir, { recursive: true });

    const wave = {
      wave: 1,
      file: "docs/plans/waves/wave-1.md",
      agents: [
        {
          agentId: "A0",
          slug: "1-a0",
          prompt: [
            "Read docs/code-guidance.md.",
            "Read docs/research/hardening-tech-stack.md.",
            "",
            "File ownership (only touch these paths):",
            "- docs/plans/waves/reviews/wave-1-cont-qa.md",
          ].join("\n"),
        },
        {
          agentId: "A1",
          slug: "1-a1",
          prompt: [
            "Read docs/code-guidance.md.",
            "Read docs/research/hardening-tech-stack.md.",
            "",
            "File ownership (only touch these paths):",
            "- go/example/file.go",
          ].join("\n"),
        },
      ],
      contQaReportPath: "docs/plans/waves/reviews/wave-1-cont-qa.md",
    };

    fs.writeFileSync(path.join(statusDir, "wave-1-1-a0.status"), "0\n", "utf8");
    fs.writeFileSync(path.join(statusDir, "wave-1-1-a1.status"), "0\n", "utf8");

    const reconciliation = reconcileRunStateFromStatusFiles([wave], runStatePath, statusDir);
    expect(reconciliation.completedFromStatus).toEqual([]);
    expect(readRunState(runStatePath)).toMatchObject({
      schemaVersion: 2,
      kind: "wave-run-state",
      completedWaves: [],
    });
  });

  it("writes append-only run-state history with legacy normalization and blocker evidence", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-run-state-history`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    const coordinationDir = path.join(tempRoot, "coordination");
    const assignmentsDir = path.join(tempRoot, "assignments");
    const dependencySnapshotsDir = path.join(tempRoot, "dependencies");
    const runStatePath = path.join(tempRoot, "run-state.json");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(coordinationDir, { recursive: true });
    fs.mkdirSync(assignmentsDir, { recursive: true });
    fs.mkdirSync(dependencySnapshotsDir, { recursive: true });

    fs.writeFileSync(
      path.join(runStatePath),
      JSON.stringify({ completedWaves: [7] }, null, 2),
      "utf8",
    );
    expect(readRunState(runStatePath)).toMatchObject({
      schemaVersion: 2,
      kind: "wave-run-state",
      completedWaves: [7],
      waves: {
        7: {
          currentState: "completed",
          lastSource: "legacy-run-state",
        },
      },
      history: [],
    });

    const wave = makeReconcileWave(tempRoot);
    fs.writeFileSync(
      path.join(REPO_ROOT, wave.contQaReportPath),
      "# cont-QA\n\nVerdict: PASS\n",
      "utf8",
    );
    for (const agent of wave.agents) {
      writeStatus(statusDir, agent, {
        code: 0,
        promptHash: hashAgentPromptFingerprint(agent),
        completedAt: "2026-03-22T00:00:00.000Z",
      });
    }
    writeSummary(statusDir, wave.agents[0], {
      reportPath: wave.contQaReportPath,
      verdict: { verdict: "pass", detail: "good" },
      gate: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
        detail: "all clear",
      },
    });
    writeSummary(statusDir, wave.agents[1], {
      proof: { completion: "contract", durability: "none", proof: "unit", state: "met" },
      docDelta: { state: "owned", paths: [] },
    });
    writeSummary(statusDir, wave.agents[2], {
      integration: { state: "ready-for-doc-closure", detail: "all lanes landed" },
    });
    writeSummary(statusDir, wave.agents[3], {
      docClosure: { state: "closed", detail: "docs reconciled" },
    });
    fs.writeFileSync(path.join(coordinationDir, "wave-200.jsonl"), "", "utf8");

    const completedState = markWaveCompleted(runStatePath, wave.wave, {
      detail: "Wave 200 completed after 1 attempt(s).",
      evidence: {
        waveFileHash: "abc123",
      },
    });
    expect(completedState).toMatchObject({
      schemaVersion: 2,
      kind: "wave-run-state",
      completedWaves: [7, 200],
      waves: {
        200: {
          currentState: "completed",
          lastReasonCode: "wave-complete",
        },
      },
    });
    expect(completedState.history).toMatchObject([
      {
        wave: 200,
        toState: "completed",
        source: "live-launcher",
        reasonCode: "wave-complete",
        evidence: {
          waveFileHash: "abc123",
        },
      },
    ]);

    fs.writeFileSync(
      path.join(assignmentsDir, "wave-200.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "wave-assignment-snapshot",
          lane: "research",
          wave: 200,
          assignments: [
            {
              id: "assignment:request-2",
              requestId: "request-2",
              assignedAgentId: "A1",
              blocking: true,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dependencySnapshotsDir, "wave-200.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "wave-dependency-snapshot",
          lane: "research",
          wave: 200,
          requiredInbound: [{ id: "dep-2" }],
          requiredOutbound: [],
          unresolvedInboundAssignments: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const reconciliation = reconcileRunStateFromStatusFiles([wave], runStatePath, statusDir, {
      logsDir,
      coordinationDir,
      assignmentsDir,
      dependencySnapshotsDir,
      requireIntegrationStewardFromWave: 0,
      laneProfile: {
        validation: {
          requireComponentPromotionsFromWave: null,
          requireIntegrationStewardFromWave: 0,
          requiredPromptReferences: [],
        },
        paths: {
          benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
        },
      },
    });

    expect(reconciliation.state.completedWaves).toEqual([7]);
    expect(reconciliation.state.waves["200"]).toMatchObject({
      currentState: "blocked",
      lastSource: "status-reconcile",
      lastReasonCode: "helper-assignment-open",
    });
    expect(reconciliation.state.history).toMatchObject([
      {
        wave: 200,
        toState: "completed",
        source: "live-launcher",
      },
      {
        wave: 200,
        fromState: "completed",
        toState: "blocked",
        source: "status-reconcile",
        reasonCode: "helper-assignment-open",
        evidence: {
          blockedReasons: expect.arrayContaining([
            {
              code: "helper-assignment-open",
              detail: "Helper assignments remain open (request-2).",
            },
            {
              code: "dependency-open",
              detail: "Open required dependencies remain (dep-2).",
            },
          ]),
        },
      },
    ]);
  });

  it("reports missing closure-agent statuses as blocked-from-status reasons", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-reconcile-blocked`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    const runStatePath = path.join(tempRoot, "run-state.json");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    const wave = makeReconcileWave(tempRoot);
    const [contQa, implementation, integration] = wave.agents;
    fs.writeFileSync(
      path.join(REPO_ROOT, wave.contQaReportPath),
      "# cont-QA\n\nVerdict: PASS\n",
      "utf8",
    );
    writeStatus(statusDir, contQa, {
      code: 0,
      promptHash: hashAgentPromptFingerprint(contQa),
    });
    writeSummary(statusDir, contQa, {
      reportPath: wave.contQaReportPath,
      gate: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
      },
      verdict: { verdict: "pass", detail: "ready" },
    });
    writeStatus(statusDir, implementation, {
      code: 0,
      promptHash: hashAgentPromptFingerprint(implementation),
    });
    writeStatus(statusDir, integration, {
      code: 0,
      promptHash: hashAgentPromptFingerprint(integration),
    });
    writeSummary(statusDir, integration, {
      integration: { state: "ready-for-doc-closure", detail: "all lanes landed" },
    });

    const reconciliation = reconcileRunStateFromStatusFiles([wave], runStatePath, statusDir, {
      logsDir,
      requireIntegrationStewardFromWave: 0,
    });
    expect(reconciliation.completedFromStatus).toEqual([]);
    expect(reconciliation.blockedFromStatus).toMatchObject([
      {
        wave: 200,
        reasons: expect.arrayContaining([
          {
            code: "missing-status",
            detail: "Missing status files for A9.",
          },
        ]),
      },
    ]);
  });

  it("preserves previously completed waves as completed_with_drift when only prompt hashes drift", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-reconcile-drift`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    const coordinationDir = path.join(tempRoot, "coordination");
    const runStatePath = path.join(tempRoot, "run-state.json");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(coordinationDir, { recursive: true });

    const wave = makeReconcileWave(tempRoot);
    fs.writeFileSync(
      path.join(REPO_ROOT, wave.contQaReportPath),
      "# cont-QA\n\nVerdict: PASS\n",
      "utf8",
    );
    writeStatus(statusDir, wave.agents[0], {
      code: 0,
    });
    writeStatus(statusDir, wave.agents[1], {
      code: 0,
      promptHash: hashText("old-prompt-hash"),
    });
    writeStatus(statusDir, wave.agents[2], {
      code: 0,
      promptHash: hashAgentPromptFingerprint(wave.agents[2]),
    });
    writeStatus(statusDir, wave.agents[3], {
      code: 0,
      promptHash: hashAgentPromptFingerprint(wave.agents[3]),
    });
    writeSummary(statusDir, wave.agents[0], {
      reportPath: wave.contQaReportPath,
      verdict: { verdict: "pass", detail: "good" },
      gate: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
        detail: "all clear",
      },
    });
    writeSummary(statusDir, wave.agents[1], {
      proof: { completion: "contract", durability: "none", proof: "unit", state: "met" },
      docDelta: { state: "owned", paths: [] },
    });
    writeSummary(statusDir, wave.agents[2], {
      integration: { state: "ready-for-doc-closure", detail: "all lanes landed" },
    });
    writeSummary(statusDir, wave.agents[3], {
      docClosure: { state: "closed", detail: "docs reconciled" },
    });
    fs.writeFileSync(path.join(coordinationDir, "wave-200.jsonl"), "", "utf8");
    markWaveCompleted(runStatePath, wave.wave, {
      detail: "Wave 200 completed after 1 attempt(s).",
      evidence: {
        waveFileHash: "wave-200-hash",
      },
    });

    const reconciliation = reconcileRunStateFromStatusFiles([wave], runStatePath, statusDir, {
      logsDir,
      coordinationDir,
      requireIntegrationStewardFromWave: 0,
      laneProfile: {
        validation: {
          requireComponentPromotionsFromWave: null,
          requireIntegrationStewardFromWave: 0,
          requiredPromptReferences: [],
        },
        paths: {
          benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
        },
      },
    });

    expect(reconciliation.completedFromStatus).toEqual([]);
    expect(reconciliation.blockedFromStatus).toEqual([]);
    expect(reconciliation.preservedWithDrift).toHaveLength(1);
    expect(reconciliation.preservedWithDrift[0]).toMatchObject({
      wave: 200,
      previousState: "completed",
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: "prompt-hash-missing",
        }),
        expect.objectContaining({
          code: "prompt-hash-mismatch",
        }),
      ]),
    });
    expect(reconciliation.state.completedWaves).toEqual([200]);
    expect(reconciliation.state.waves["200"]).toMatchObject({
      currentState: "completed_with_drift",
      lastSource: "status-reconcile",
      lastReasonCode: "status-reconcile-completed-with-drift",
    });
    expect(reconciliation.state.history).toHaveLength(2);
    expect(reconciliation.state.history[0]).toMatchObject({
      wave: 200,
      toState: "completed",
      source: "live-launcher",
    });
    expect(reconciliation.state.history[1]).toMatchObject({
      wave: 200,
      fromState: "completed",
      toState: "completed_with_drift",
      source: "status-reconcile",
      reasonCode: "status-reconcile-completed-with-drift",
      evidence: {
        preservedCompletion: {
          preserved: true,
          driftReasons: expect.arrayContaining([
            expect.objectContaining({
              code: "prompt-hash-missing",
            }),
            expect.objectContaining({
              code: "prompt-hash-mismatch",
            }),
          ]),
        },
      },
    });
  });

  it("surfaces cont-QA artifact and open coordination blockers during reconciliation", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-reconcile-reasons`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    const coordinationDir = path.join(tempRoot, "coordination");
    const runStatePath = path.join(tempRoot, "run-state.json");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(coordinationDir, { recursive: true });

    const wave = makeReconcileWave(tempRoot);
    fs.writeFileSync(
      path.join(REPO_ROOT, wave.contQaReportPath),
      "# cont-QA\n\nNotes only.\n",
      "utf8",
    );
    for (const agent of wave.agents) {
      writeStatus(statusDir, agent, {
        code: 0,
        promptHash: hashAgentPromptFingerprint(agent),
      });
    }
    writeSummary(statusDir, wave.agents[2], {
      integration: { state: "ready-for-doc-closure", detail: "all lanes landed" },
    });
    writeSummary(statusDir, wave.agents[3], {
      docClosure: { state: "closed", detail: "docs reconciled" },
    });
    fs.writeFileSync(
      path.join(coordinationDir, "wave-200.jsonl"),
      `${JSON.stringify({
        id: "escalation-1",
        kind: "human-escalation",
        wave: 200,
        lane: "research",
        agentId: "launcher",
        status: "open",
        summary: "Need operator input",
        detail: "still waiting",
        createdAt: "2026-03-22T10:00:00.000Z",
        updatedAt: "2026-03-22T10:00:00.000Z",
      })}\n`,
      "utf8",
    );

    const reconciliation = reconcileRunStateFromStatusFiles([wave], runStatePath, statusDir, {
      logsDir,
      coordinationDir,
      requireIntegrationStewardFromWave: 0,
      laneProfile: {
        validation: {
          requireComponentPromotionsFromWave: null,
          requireIntegrationStewardFromWave: 0,
        },
      },
    });
    expect(reconciliation.completedFromStatus).toEqual([]);
    expect(reconciliation.blockedFromStatus).toMatchObject([
      {
        wave: 200,
        reasons: expect.arrayContaining([
          {
            code: "invalid-cont-qa-summary",
            detail: expect.stringContaining("missing-wave-gate"),
          },
          {
            code: "open-human-escalation",
            detail: "Open human escalation records: escalation-1.",
          },
        ]),
      },
    ]);
  });

  it("removes previously completed waves when helper assignments or dependencies stay open", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-reconcile-hardening`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    const coordinationDir = path.join(tempRoot, "coordination");
    const assignmentsDir = path.join(tempRoot, "assignments");
    const dependencySnapshotsDir = path.join(tempRoot, "dependencies");
    const runStatePath = path.join(tempRoot, "run-state.json");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(coordinationDir, { recursive: true });
    fs.mkdirSync(assignmentsDir, { recursive: true });
    fs.mkdirSync(dependencySnapshotsDir, { recursive: true });

    const wave = makeReconcileWave(tempRoot);
    fs.writeFileSync(
      runStatePath,
      JSON.stringify({ completedWaves: [200] }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(REPO_ROOT, wave.contQaReportPath),
      "# cont-QA\n\nVerdict: PASS\n",
      "utf8",
    );
    for (const agent of wave.agents) {
      writeStatus(statusDir, agent, {
        code: 0,
        promptHash: hashAgentPromptFingerprint(agent),
      });
    }
    writeSummary(statusDir, wave.agents[0], {
      reportPath: wave.contQaReportPath,
      verdict: { verdict: "pass", detail: "good" },
      gate: {
        architecture: "pass",
        integration: "pass",
        durability: "pass",
        live: "pass",
        docs: "pass",
        detail: "all clear",
      },
    });
    writeSummary(statusDir, wave.agents[1], {
      proof: { completion: "contract", durability: "none", proof: "unit", state: "met" },
      docDelta: { state: "owned", paths: [] },
    });
    writeSummary(statusDir, wave.agents[2], {
      integration: { state: "ready-for-doc-closure", detail: "all lanes landed" },
    });
    writeSummary(statusDir, wave.agents[3], {
      docClosure: { state: "closed", detail: "docs reconciled" },
    });
    fs.writeFileSync(path.join(coordinationDir, "wave-200.jsonl"), "", "utf8");
    fs.writeFileSync(
      path.join(assignmentsDir, "wave-200.json"),
      JSON.stringify(
        [
          {
            id: "assignment:request-1",
            requestId: "request-1",
            assignedAgentId: "A1",
            blocking: true,
          },
        ],
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dependencySnapshotsDir, "wave-200.json"),
      JSON.stringify(
        {
          requiredInbound: [{ id: "dep-1" }],
          requiredOutbound: [],
          unresolvedInboundAssignments: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const reconciliation = reconcileRunStateFromStatusFiles([wave], runStatePath, statusDir, {
      logsDir,
      coordinationDir,
      assignmentsDir,
      dependencySnapshotsDir,
      requireIntegrationStewardFromWave: 0,
      laneProfile: {
        validation: {
          requireComponentPromotionsFromWave: null,
          requireIntegrationStewardFromWave: 0,
          requiredPromptReferences: [],
        },
        paths: {
          benchmarkCatalogPath: "docs/evals/benchmark-catalog.json",
        },
      },
    });

    expect(reconciliation.state.completedWaves).toEqual([]);
    expect(reconciliation.blockedFromStatus).toMatchObject([
      {
        wave: 200,
        reasons: expect.arrayContaining([
          {
            code: "helper-assignment-open",
            detail: "Helper assignments remain open (request-1).",
          },
          {
            code: "dependency-open",
            detail: "Open required dependencies remain (dep-1).",
          },
        ]),
      },
    ]);
  });
});
