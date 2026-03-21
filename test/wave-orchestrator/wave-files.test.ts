import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashText, REPO_ROOT } from "../../scripts/wave-orchestrator/shared.mjs";
import { hashAgentPromptFingerprint } from "../../scripts/wave-orchestrator/context7.mjs";
import {
  completedWavesFromStatusFiles,
  normalizeCompletedWaves,
  parseWaveContent,
  parseWaveFiles,
  readRunState,
  reconcileRunStateFromStatusFiles,
  requiredDocumentationStewardPathsForWave,
  SHARED_PLAN_DOC_PATHS,
  validateWaveComponentMatrixCurrentLevels,
  validateWaveDefinition,
  WAVE_DOCUMENTATION_ROLE_PROMPT_PATH,
  WAVE_EVALUATOR_ROLE_PROMPT_PATH,
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

  it("extracts owned paths and evaluator report paths", () => {
    const wave = parseWaveContent(
      `# Wave 0 - Sample

**Commit message**: \`Docs: sample\`

## Agent A0: Evaluator

### Prompt
\`\`\`text
Read docs/code-guidance.md.
Read docs/research/hardening-tech-stack.md.

File ownership (only touch these paths):
- docs/plans/waves/reviews/wave-0-evaluator.md
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
      "docs/plans/waves/reviews/wave-0-evaluator.md",
    ]);
    expect(wave.agents[1]?.ownedPaths).toEqual(["go/contracts/types.go"]);
    expect(wave.evaluatorReportPath).toBe("docs/plans/waves/reviews/wave-0-evaluator.md");
  });

  it("composes imported standing role prompts while keeping ownership local", () => {
    const overlayPrompt = [
      "Primary goal:",
      "- Keep the wave coherent.",
      "",
      "File ownership (only touch these paths):",
      "- docs/plans/waves/reviews/wave-0-evaluator.md",
    ].join("\n");
    const wave = parseWaveContent(
      `# Wave 0 - Sample

**Commit message**: \`Docs: sample\`

## Agent A0: Evaluator

### Role prompts

- ${WAVE_EVALUATOR_ROLE_PROMPT_PATH}

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
      rolePromptPaths: [WAVE_EVALUATOR_ROLE_PROMPT_PATH],
      ownedPaths: ["docs/plans/waves/reviews/wave-0-evaluator.md"],
    });
    expect(wave.agents[0]?.prompt).toContain("You are the running evaluator for the current wave.");
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
- docs/plans/waves/reviews/wave-1-evaluator.md
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
                "docs/plans/waves/reviews/wave-0-evaluator.md",
              ),
              rolePromptPaths: [WAVE_EVALUATOR_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-evaluator.md"],
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

  it("rejects leap-claw waves without an evaluator", () => {
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
                "- docs/plans/waves/reviews/wave-0-evaluator.md",
              ].join("\n"),
              rolePromptPaths: [WAVE_EVALUATOR_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-evaluator.md"],
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(/must reference docs\/research\/agent-context-sources\.md/);
  });

  it("rejects leap-claw evaluators that do not import the standing evaluator role", () => {
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
                "docs/plans/waves/reviews/wave-0-evaluator.md",
              ),
              rolePromptPaths: [],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-evaluator.md"],
            },
          ],
        },
        { lane: "leap-claw" },
      ),
    ).toThrow(new RegExp(`must import ${WAVE_EVALUATOR_ROLE_PROMPT_PATH}`));
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
                "docs/plans/waves/reviews/wave-5-evaluator.md",
              ),
              rolePromptPaths: [WAVE_EVALUATOR_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-5-evaluator.md"],
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
                "docs/plans/waves/reviews/wave-0-evaluator.md",
              ),
              rolePromptPaths: [WAVE_EVALUATOR_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-0-evaluator.md"],
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
                "docs/plans/waves/reviews/wave-6-evaluator.md",
              ),
              rolePromptPaths: [WAVE_EVALUATOR_ROLE_PROMPT_PATH],
              ownedPaths: ["docs/plans/waves/reviews/wave-6-evaluator.md"],
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
});

describe("completedWavesFromStatusFiles", () => {
  it("requires prompt-hash-matching status files and evaluator PASS", () => {
    const tempRoot = registerTempPath(
      path.join(REPO_ROOT, ".tmp", `wave-files-test-${Date.now()}-completion`),
    );
    const statusDir = path.join(tempRoot, "status");
    const logsDir = path.join(tempRoot, "logs");
    fs.mkdirSync(statusDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    const reportRelPath = `.tmp/${path.basename(tempRoot)}/wave-0-evaluator.md`;
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
      evaluatorReportPath: reportRelPath,
    };

    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# Evaluator\n\nVerdict: PASS\n", "utf8");
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

    const reportRelPath = `.tmp/${path.basename(tempRoot)}/wave-0-evaluator.md`;
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
          rolePromptPaths: [WAVE_EVALUATOR_ROLE_PROMPT_PATH],
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
      evaluatorReportPath: reportRelPath,
    };

    fs.writeFileSync(path.join(REPO_ROOT, reportRelPath), "# Evaluator\n\nVerdict: PASS\n", "utf8");
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
});

describe("reconcileRunStateFromStatusFiles", () => {
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
            "- docs/plans/waves/reviews/wave-1-evaluator.md",
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
      evaluatorReportPath: "docs/plans/waves/reviews/wave-1-evaluator.md",
    };

    fs.writeFileSync(path.join(statusDir, "wave-1-1-a0.status"), "0\n", "utf8");
    fs.writeFileSync(path.join(statusDir, "wave-1-1-a1.status"), "0\n", "utf8");

    const reconciliation = reconcileRunStateFromStatusFiles([wave], runStatePath, statusDir);
    expect(reconciliation.completedFromStatus).toEqual([]);
    expect(readRunState(runStatePath).completedWaves).toEqual([]);
  });
});
