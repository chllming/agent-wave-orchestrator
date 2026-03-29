import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeWaveCorridorContext,
  readWaveCorridorContext,
  renderCorridorPromptContext,
} from "../../scripts/wave-orchestrator/corridor.mjs";
import { readWaveSecurityGatePure } from "../../scripts/wave-orchestrator/gate-engine.mjs";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-corridor-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeLanePaths(dir: string) {
  return {
    lane: "main",
    project: "app",
    securityDir: path.join(dir, "security"),
    contEvalAgentId: "E0",
    integrationAgentId: "A8",
    documentationAgentId: "A9",
    waveControl: {
      endpoint: "https://wave-control.internal/api/v1",
      authTokenEnvVar: "WAVE_API_TOKEN",
      authTokenEnvVars: ["WAVE_API_TOKEN", "WAVE_CONTROL_AUTH_TOKEN"],
    },
    externalProviders: {
      corridor: {
        enabled: true,
        mode: "direct",
        baseUrl: "https://app.corridor.dev/api",
        apiTokenEnvVar: "CORRIDOR_API_TOKEN",
        apiKeyFallbackEnvVar: "CORRIDOR_API_KEY",
        teamId: "team-1",
        projectId: "corridor-project",
        severityThreshold: "critical",
        findingStates: ["open"],
        requiredAtClosure: true,
      },
      context7: {
        mode: "direct",
        apiKeyEnvVar: "CONTEXT7_API_KEY",
      },
    },
  };
}

afterEach(() => {
  delete process.env.CORRIDOR_API_TOKEN;
  delete process.env.CORRIDOR_API_KEY;
  delete process.env.WAVE_API_TOKEN;
  delete process.env.WAVE_CONTROL_AUTH_TOKEN;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("corridor provider integration", () => {
  it("materializes matched findings for implementation-owned paths", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    process.env.CORRIDOR_API_TOKEN = "corridor-token";

    const payload = await materializeWaveCorridorContext(
      lanePaths,
      {
        wave: 3,
        agents: [
          { agentId: "A1", role: "implementation", ownedPaths: ["src/auth"] },
          { agentId: "A8", role: "integration", ownedPaths: ["src"] },
          { agentId: "S1", role: "security-review", ownedPaths: ["reports/security.md"] },
        ],
      },
      {
        fetchImpl: async (url: string) => {
          if (String(url).endsWith("/reports")) {
            return new Response(
              JSON.stringify({ reports: [{ id: "r1", name: "No secrets" }] }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          if (String(url).includes("/findings")) {
            return new Response(
              JSON.stringify([
                {
                  id: "f1",
                  title: "Hardcoded token",
                  affectedFile: "src/auth/token.ts",
                  severity: "critical",
                  state: "open",
                },
                {
                  id: "f2",
                  title: "Docs finding",
                  affectedFile: "docs/security.md",
                  severity: "critical",
                  state: "open",
                },
              ]),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          throw new Error(`Unexpected URL: ${String(url)}`);
        },
      },
    );

    expect(payload?.blocking).toBe(true);
    expect(payload?.blockingFindings).toHaveLength(1);
    expect(payload?.blockingFindings[0].id).toBe("f1");

    const persisted = readWaveCorridorContext(lanePaths, 3);
    expect(persisted?.matchedFindings).toHaveLength(1);
    expect(persisted?.relevantOwnedPaths).toEqual(["src/auth"]);
  });

  it("fails the pure security gate when Corridor fetch fails or blocks", () => {
    const wave = {
      wave: 1,
      agents: [{ agentId: "S1", role: "security-review" }],
    };
    expect(
      readWaveSecurityGatePure(wave, {}, {
        derivedState: {
          corridorSummary: {
            ok: false,
            requiredAtClosure: true,
            error: "fetch failed",
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      statusCode: "corridor-fetch-failed",
    });

    expect(
      readWaveSecurityGatePure(wave, {}, {
        derivedState: {
          corridorSummary: {
            ok: true,
            blocking: true,
            blockingFindings: [{ id: "f1" }],
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      statusCode: "corridor-blocked",
    });
  });

  it("preserves successful broker payloads for prompts and persisted state", async () => {
    const dir = makeTempDir();
    const lanePaths = makeLanePaths(dir);
    lanePaths.externalProviders.corridor.mode = "broker";
    lanePaths.externalProviders.corridor.findingStates = [];
    process.env.WAVE_API_TOKEN = "wave-broker-token";

    const payload = await materializeWaveCorridorContext(
      lanePaths,
      {
        wave: 2,
        agents: [{ agentId: "A1", role: "implementation", ownedPaths: ["src/auth"] }],
      },
      {
        fetchImpl: async (url: string, options?: RequestInit) => {
          expect(String(url)).toBe("https://wave-control.internal/api/v1/providers/corridor/context");
          expect(options?.method).toBe("POST");
          expect((options?.headers as Record<string, string>)?.authorization).toBe("Bearer wave-broker-token");
          expect(JSON.parse(String(options?.body || "{}")).findingStates).toEqual([]);
          return new Response(
            JSON.stringify({
              ok: true,
              error: null,
              schemaVersion: 1,
              source: "broker",
              fetchedAt: "2026-03-29T00:00:00.000Z",
              project: {
                waveProjectId: "app",
                corridorProjectId: "corridor-project",
                teamId: "team-1",
              },
              relevantOwnedPaths: ["src/auth"],
              severityThreshold: "critical",
              guardrails: [],
              matchedFindings: [
                {
                  id: "f1",
                  title: "Hardcoded token",
                  affectedFile: "src/auth/token.ts",
                  severity: "critical",
                  matchedOwnedPaths: ["src/auth"],
                },
              ],
              blockingFindings: [
                {
                  id: "f1",
                  title: "Hardcoded token",
                  affectedFile: "src/auth/token.ts",
                  severity: "critical",
                  matchedOwnedPaths: ["src/auth"],
                },
              ],
              blocking: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );

    expect(payload?.ok).toBe(true);
    expect(renderCorridorPromptContext(payload)).toContain("Corridor blocking: yes");
    expect(renderCorridorPromptContext(payload)).toContain("Corridor matched findings: 1");

    const persisted = readWaveCorridorContext(lanePaths, 2);
    expect(persisted?.ok).toBe(true);
    expect(persisted?.blockingFindings).toHaveLength(1);
  });
});
