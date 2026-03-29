import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyContext7SelectionsToWave,
  loadContext7BundleIndex,
  prefetchContext7ForSelection,
} from "../../scripts/wave-orchestrator/context7.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slowfast-wave-context7-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.WAVE_API_TOKEN;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeBundleIndex(dir) {
  const indexPath = path.join(dir, "bundles.json");
  fs.writeFileSync(
    indexPath,
    JSON.stringify(
      {
        version: 1,
        defaultBundle: "none",
        laneDefaults: {
          "leap-claw": "none",
        },
        bundles: {
          none: {
            description: "No external docs.",
            libraries: [],
          },
          "core-go": {
            description: "Temporal docs.",
            libraries: [
              {
                libraryName: "temporal",
                queryHint: "Go SDK workflows",
              },
            ],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return indexPath;
}

function makeHybridLanePaths() {
  return {
    externalProviders: {
      context7: {
        mode: "hybrid",
        apiKeyEnvVar: "CONTEXT7_API_KEY",
      },
    },
    waveControl: {
      endpoint: "https://wave-control.internal/api/v1",
      authTokenEnvVar: "WAVE_API_TOKEN",
      authTokenEnvVars: ["WAVE_API_TOKEN"],
    },
  };
}

describe("Context7 selection resolution", () => {
  it("applies wave defaults and agent overrides without changing local prompt ownership", () => {
    const bundleIndex = loadContext7BundleIndex(writeBundleIndex(makeTempDir()));
    const wave = applyContext7SelectionsToWave(
      {
        wave: 4,
        file: "docs/plans/waves/wave-4.md",
        context7Defaults: {
          bundle: "core-go",
          query: "Temporal bootstrap defaults",
        },
        agents: [
          {
            agentId: "A1",
            title: "Bootstrap",
            prompt: "Implement bootstrap.",
            promptOverlay: "Implement bootstrap.",
            context7Config: {
              query: "Temporal activity retries",
            },
            ownedPaths: ["go/internal/bootstrap.go"],
          },
          {
            agentId: "A2",
            title: "Worker",
            prompt: "Implement worker.",
            promptOverlay: "Implement worker.",
            context7Config: null,
            ownedPaths: ["go/internal/worker.go"],
          },
        ],
      },
      {
        lane: "leap-claw",
        bundleIndex,
      },
    );

    expect(wave.context7Defaults).toEqual({
      bundle: "core-go",
      query: "Temporal bootstrap defaults",
    });
    expect(wave.agents[0]?.context7Resolved).toMatchObject({
      bundleId: "core-go",
      query: "Temporal activity retries",
      bundleSource: "wave",
      querySource: "agent",
    });
    expect(wave.agents[1]?.context7Resolved).toMatchObject({
      bundleId: "core-go",
      query: "Temporal bootstrap defaults",
      bundleSource: "wave",
      querySource: "wave",
    });
  });
});

describe("Context7 prefetch", () => {
  it("fails open when CONTEXT7_API_KEY is missing", async () => {
    const result = await prefetchContext7ForSelection(
      {
        bundleId: "core-go",
        query: "Temporal schedules",
        libraries: [{ libraryName: "temporal", libraryId: null, queryHint: null }],
        indexHash: "index",
      },
      {
        cacheDir: makeTempDir(),
        apiKey: "",
      },
    );

    expect(result).toMatchObject({
      mode: "missing-key",
      promptText: "",
    });
  });

  it("caches fetched text and reuses it on subsequent runs", async () => {
    const cacheDir = makeTempDir();
    const selection = {
      bundleId: "core-go",
      query: "Temporal schedules",
      libraries: [{ libraryName: "temporal", libraryId: null, queryHint: null }],
      indexHash: "index",
    };
    const seenUrls = [];
    const fetchImpl = async (url) => {
      seenUrls.push(String(url));
      if (String(url).includes("/libs/search")) {
        return {
          ok: true,
          json: async () => [{ id: "/temporalio/temporal", name: "Temporal" }],
          headers: new Headers(),
        };
      }
      return {
        ok: true,
        text: async () => "Temporal docs snippet",
        headers: new Headers(),
      };
    };

    const fetched = await prefetchContext7ForSelection(selection, {
      cacheDir,
      apiKey: "ctx7sk-test",
      fetchImpl,
      nowMs: Date.UTC(2026, 0, 1),
    });
    expect(fetched.mode).toBe("fetched");
    expect(fetched.promptText).toContain("Temporal docs snippet");
    expect(seenUrls).toHaveLength(2);

    const cached = await prefetchContext7ForSelection(selection, {
      cacheDir,
      apiKey: "ctx7sk-test",
      fetchImpl: async () => {
        throw new Error("cache should prevent refetch");
      },
      nowMs: Date.UTC(2026, 0, 1, 1),
    });
    expect(cached.mode).toBe("cached");
    expect(cached.promptText).toContain("Temporal docs snippet");
  });

  it("falls back to direct mode when a hybrid broker request fails at runtime", async () => {
    process.env.WAVE_API_TOKEN = "wave-token";
    const selection = {
      bundleId: "core-go",
      query: "Temporal schedules",
      libraries: [{ libraryName: "temporal", libraryId: null, queryHint: null }],
      indexHash: "index",
    };
    const seenUrls = [];
    const fetchImpl = async (url) => {
      const normalized = String(url);
      seenUrls.push(normalized);
      if (normalized.includes("/providers/context7/search")) {
        return new Response(JSON.stringify({ error: "broker unavailable" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      if (normalized.includes("/providers/context7/context")) {
        throw new Error("broker context should not be used after fallback");
      }
      if (normalized.includes("/libs/search")) {
        return new Response(JSON.stringify([{ id: "/temporalio/temporal", name: "Temporal" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Temporal direct docs snippet", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    };

    const result = await prefetchContext7ForSelection(selection, {
      lanePaths: makeHybridLanePaths(),
      cacheDir: makeTempDir(),
      apiKey: "ctx7sk-direct",
      fetchImpl,
      nowMs: Date.UTC(2026, 0, 2),
    });

    expect(result.mode).toBe("fetched");
    expect(result.warning).toContain("fell back to direct auth");
    expect(result.promptText).toContain("Temporal direct docs snippet");
    expect(seenUrls.filter((url) => url.includes("/providers/context7/search"))).toHaveLength(1);
    expect(seenUrls.filter((url) => url.includes("context7.com/api/v2/libs/search"))).toHaveLength(1);
    expect(seenUrls.filter((url) => url.includes("context7.com/api/v2/context"))).toHaveLength(1);
  });

  it("falls back to direct mode when a hybrid broker response is malformed", async () => {
    process.env.WAVE_API_TOKEN = "wave-token";
    const selection = {
      bundleId: "core-go",
      query: "Temporal schedules",
      libraries: [{ libraryName: "temporal", libraryId: null, queryHint: null }],
      indexHash: "index",
    };
    const fetchImpl = async (url) => {
      const normalized = String(url);
      if (normalized.includes("/providers/context7/search")) {
        return {
          ok: true,
          json: async () => {
            throw new Error("invalid broker json");
          },
          headers: new Headers(),
        };
      }
      if (normalized.includes("/providers/context7/context")) {
        throw new Error("broker context should not be used after malformed fallback");
      }
      if (normalized.includes("/libs/search")) {
        return new Response(JSON.stringify([{ id: "/temporalio/temporal", name: "Temporal" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Temporal direct docs snippet", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    };

    const result = await prefetchContext7ForSelection(selection, {
      lanePaths: makeHybridLanePaths(),
      cacheDir: makeTempDir(),
      apiKey: "ctx7sk-direct",
      fetchImpl,
      nowMs: Date.UTC(2026, 0, 3),
    });

    expect(result.mode).toBe("fetched");
    expect(result.warning).toContain("invalid broker json");
    expect(result.promptText).toContain("Temporal direct docs snippet");
  });

  it("returns an error when hybrid broker fallback has no direct API key available", async () => {
    process.env.WAVE_API_TOKEN = "wave-token";
    const selection = {
      bundleId: "core-go",
      query: "Temporal schedules",
      libraries: [{ libraryName: "temporal", libraryId: null, queryHint: null }],
      indexHash: "index",
    };

    const result = await prefetchContext7ForSelection(selection, {
      lanePaths: makeHybridLanePaths(),
      cacheDir: makeTempDir(),
      apiKey: "",
      fetchImpl: async (url) => {
        if (String(url).includes("/providers/context7/search")) {
          return new Response(JSON.stringify({ error: "broker unavailable" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL: ${String(url)}`);
      },
      nowMs: Date.UTC(2026, 0, 4),
    });

    expect(result.mode).toBe("error");
    expect(result.warning).toContain("direct fallback is unavailable");
    expect(result.warning).toContain("CONTEXT7_API_KEY is not set");
  });
});
