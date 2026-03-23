import { describe, expect, it } from "vitest";
import {
  KNOWN_ADAPTERS,
  adapterSummary,
  buildDefaultAdapterContract,
  buildLaunchSpec,
  canFallback,
  hasCapability,
  isAvailable,
  locateResultEnvelope,
  normalizeAdapterContract,
  selectBestAdapter,
  synthesizeLegacyEnvelope,
  validateResultEnvelope,
} from "../../scripts/wave-orchestrator/adapter-contract.mjs";

describe("normalizeAdapterContract", () => {
  it("returns safe defaults from null input", () => {
    const contract = normalizeAdapterContract(null);
    expect(contract.adapterId).toBe("local");
    expect(contract.displayName).toBe("Local");
    expect(contract.capabilities).toEqual({
      sandboxModes: [],
      supportsSearch: false,
      supportsImages: false,
      supportsAddDirs: false,
      supportsMcp: false,
      supportsHooks: false,
      supportsJson: false,
      maxTurns: null,
      rateLimitRetry: false,
    });
    expect(contract.fallbackEligibility).toEqual({
      canFallbackTo: [],
      canFallbackFrom: [],
      restrictions: [],
    });
    expect(contract.supervisionHooks.onRateLimit).toBe("retry");
    expect(contract.supervisionHooks.onTimeout).toBe("retry");
    expect(contract.supervisionHooks.onCrash).toBe("abort");
    expect(contract.supervisionHooks.onLaunch).toBeNull();
    expect(contract.supervisionHooks.onComplete).toBeNull();
  });

  it("normalizes structured capabilities", () => {
    const contract = normalizeAdapterContract({
      adapterId: "codex",
      capabilities: {
        sandboxModes: ["danger-full-access"],
        supportsSearch: true,
        supportsImages: true,
        maxTurns: 10,
        rateLimitRetry: true,
      },
    });
    expect(contract.capabilities.sandboxModes).toEqual(["danger-full-access"]);
    expect(contract.capabilities.supportsSearch).toBe(true);
    expect(contract.capabilities.supportsImages).toBe(true);
    expect(contract.capabilities.supportsAddDirs).toBe(false);
    expect(contract.capabilities.maxTurns).toBe(10);
    expect(contract.capabilities.rateLimitRetry).toBe(true);
  });

  it("normalizes fallback eligibility with restrictions", () => {
    const contract = normalizeAdapterContract({
      adapterId: "codex",
      fallbackEligibility: {
        canFallbackTo: ["claude"],
        canFallbackFrom: [],
        restrictions: ["no-sandbox-fallback"],
      },
    });
    expect(contract.fallbackEligibility.canFallbackTo).toEqual(["claude"]);
    expect(contract.fallbackEligibility.restrictions).toEqual(["no-sandbox-fallback"]);
  });

  it("normalizes supervision hooks with onLaunch and onComplete", () => {
    const onLaunch = () => {};
    const onComplete = () => {};
    const contract = normalizeAdapterContract({
      adapterId: "test",
      supervisionHooks: {
        onLaunch,
        onComplete,
        onRateLimit: "retry",
        onTimeout: "fallback",
        onCrash: "abort",
      },
    });
    expect(contract.supervisionHooks.onLaunch).toBe(onLaunch);
    expect(contract.supervisionHooks.onComplete).toBe(onComplete);
    expect(contract.supervisionHooks.onRateLimit).toBe("retry");
    expect(contract.supervisionHooks.onTimeout).toBe("fallback");
    expect(contract.supervisionHooks.onCrash).toBe("abort");
  });

  it("includes displayName field", () => {
    const contract = normalizeAdapterContract({
      adapterId: "codex",
      displayName: "Codex CLI",
    });
    expect(contract.displayName).toBe("Codex CLI");
  });

  it("defaults displayName to adapterId", () => {
    const contract = normalizeAdapterContract({
      adapterId: "codex",
    });
    expect(contract.displayName).toBe("codex");
  });
});

describe("buildDefaultAdapterContract", () => {
  it("builds default for codex with structured capabilities", () => {
    const contract = buildDefaultAdapterContract("codex");
    expect(contract.adapterId).toBe("codex");
    expect(contract.displayName).toBe("Codex");
    expect(contract.capabilities.sandboxModes).toEqual(["danger-full-access", "workspace-write"]);
    expect(contract.capabilities.supportsSearch).toBe(true);
    expect(contract.capabilities.supportsImages).toBe(true);
    expect(contract.capabilities.supportsAddDirs).toBe(true);
    expect(contract.capabilities.supportsJson).toBe(true);
    expect(contract.capabilities.rateLimitRetry).toBe(true);
    expect(contract.fallbackEligibility.canFallbackTo).toEqual(["claude", "opencode"]);
    expect(contract.fallbackEligibility.restrictions).toEqual([]);
  });

  it("builds default for claude with structured capabilities", () => {
    const contract = buildDefaultAdapterContract("claude");
    expect(contract.adapterId).toBe("claude");
    expect(contract.displayName).toBe("Claude Code");
    expect(contract.capabilities.supportsMcp).toBe(true);
    expect(contract.capabilities.supportsHooks).toBe(true);
    expect(contract.capabilities.supportsSearch).toBe(false);
    expect(contract.fallbackEligibility.canFallbackTo).toEqual(["opencode"]);
    expect(contract.fallbackEligibility.canFallbackFrom).toEqual(["codex"]);
  });

  it("builds default for opencode with structured capabilities", () => {
    const contract = buildDefaultAdapterContract("opencode");
    expect(contract.capabilities.supportsSearch).toBe(true);
    expect(contract.capabilities.supportsJson).toBe(true);
    expect(contract.capabilities.supportsMcp).toBe(false);
  });

  it("builds default for local with empty capabilities", () => {
    const contract = buildDefaultAdapterContract("local");
    expect(contract.capabilities.supportsSearch).toBe(false);
    expect(contract.capabilities.supportsImages).toBe(false);
    expect(contract.fallbackEligibility.canFallbackTo).toEqual([]);
  });

  it("falls back to normalizeAdapterContract for unknown adapter", () => {
    const contract = buildDefaultAdapterContract("unknown");
    expect(contract.adapterId).toBe("unknown");
    expect(contract.capabilities.supportsSearch).toBe(false);
  });
});

describe("hasCapability", () => {
  it("checks sandbox capability from structured object", () => {
    const contract = buildDefaultAdapterContract("codex");
    expect(hasCapability(contract, "sandbox")).toBe(true);
  });

  it("checks search capability", () => {
    const contract = buildDefaultAdapterContract("codex");
    expect(hasCapability(contract, "search")).toBe(true);
    const claude = buildDefaultAdapterContract("claude");
    expect(hasCapability(claude, "search")).toBe(false);
  });

  it("checks json-output capability", () => {
    const contract = buildDefaultAdapterContract("codex");
    expect(hasCapability(contract, "json-output")).toBe(true);
    const claude = buildDefaultAdapterContract("claude");
    expect(hasCapability(claude, "json-output")).toBe(false);
  });

  it("checks mcp capability", () => {
    const claude = buildDefaultAdapterContract("claude");
    expect(hasCapability(claude, "mcp")).toBe(true);
    const codex = buildDefaultAdapterContract("codex");
    expect(hasCapability(codex, "mcp")).toBe(false);
  });

  it("checks hooks capability", () => {
    const claude = buildDefaultAdapterContract("claude");
    expect(hasCapability(claude, "hooks")).toBe(true);
    const codex = buildDefaultAdapterContract("codex");
    expect(hasCapability(codex, "hooks")).toBe(false);
  });

  it("checks rate-limit-retry capability", () => {
    const codex = buildDefaultAdapterContract("codex");
    expect(hasCapability(codex, "rate-limit-retry")).toBe(true);
    const local = buildDefaultAdapterContract("local");
    expect(hasCapability(local, "rate-limit-retry")).toBe(false);
  });

  it("returns false for null adapter contract", () => {
    expect(hasCapability(null, "search")).toBe(false);
  });

  it("returns false for unknown capability", () => {
    const codex = buildDefaultAdapterContract("codex");
    expect(hasCapability(codex, "teleportation")).toBe(false);
  });

  it("supports direct boolean field check on structured capabilities", () => {
    const contract = normalizeAdapterContract({
      adapterId: "test",
      capabilities: { supportsSearch: true },
    });
    expect(hasCapability(contract, "supportsSearch")).toBe(true);
  });
});

describe("canFallback", () => {
  it("codex can fall back to claude", () => {
    const codex = buildDefaultAdapterContract("codex");
    const claude = buildDefaultAdapterContract("claude");
    expect(canFallback(codex, claude)).toBe(true);
  });

  it("claude cannot fall back to codex", () => {
    const codex = buildDefaultAdapterContract("codex");
    const claude = buildDefaultAdapterContract("claude");
    expect(canFallback(claude, codex)).toBe(false);
  });

  it("local cannot fall back to anything", () => {
    const local = buildDefaultAdapterContract("local");
    const codex = buildDefaultAdapterContract("codex");
    expect(canFallback(local, codex)).toBe(false);
  });

  it("handles null adapters", () => {
    expect(canFallback(null, buildDefaultAdapterContract("codex"))).toBe(false);
    expect(canFallback(buildDefaultAdapterContract("codex"), null)).toBe(false);
  });
});

describe("selectBestAdapter", () => {
  it("returns null for empty list", () => {
    expect(selectBestAdapter([], ["search"])).toBeNull();
  });

  it("selects adapter with most matching capabilities", () => {
    const codex = buildDefaultAdapterContract("codex");
    const claude = buildDefaultAdapterContract("claude");
    const result = selectBestAdapter([codex, claude], ["search", "json-output"]);
    expect(result?.adapterId).toBe("codex");
  });

  it("selects first adapter on tie", () => {
    const claude = buildDefaultAdapterContract("claude");
    const opencode = buildDefaultAdapterContract("opencode");
    const result = selectBestAdapter([claude, opencode], []);
    expect(result?.adapterId).toBe("claude");
  });

  it("handles null in adapter list", () => {
    const codex = buildDefaultAdapterContract("codex");
    const result = selectBestAdapter([null, codex], ["search"]);
    expect(result?.adapterId).toBe("codex");
  });

  it("accepts structured capabilities object as requirements", () => {
    const codex = buildDefaultAdapterContract("codex");
    const claude = buildDefaultAdapterContract("claude");
    const result = selectBestAdapter([codex, claude], { supportsSearch: true, supportsJson: true });
    expect(result?.adapterId).toBe("codex");
  });
});

describe("buildLaunchSpec", () => {
  it("builds a launch spec from adapter contract", () => {
    const contract = buildDefaultAdapterContract("codex");
    const spec = buildLaunchSpec(contract, { agentId: "A1" }, { waveNumber: 3 });
    expect(spec).not.toBeNull();
    expect(spec.adapterId).toBe("codex");
    expect(spec.command).toBe("codex");
    expect(spec.agentId).toBe("A1");
    expect(spec.waveNumber).toBe(3);
    expect(spec.requiresShell).toBe(true);
    expect(typeof spec.createdAt).toBe("string");
  });

  it("returns null for null contract", () => {
    expect(buildLaunchSpec(null, {}, {})).toBeNull();
  });

  it("calls argTemplate when provided", () => {
    const contract = normalizeAdapterContract({
      adapterId: "test",
      launchContract: {
        command: "test-cli",
        argTemplate: (agent) => ["--agent", agent.agentId],
        requiresShell: false,
      },
    });
    const spec = buildLaunchSpec(contract, { agentId: "A5" }, {});
    expect(spec.args).toEqual(["--agent", "A5"]);
  });
});

describe("locateResultEnvelope", () => {
  it("resolves from .status path", () => {
    const contract = buildDefaultAdapterContract("codex");
    const result = locateResultEnvelope(contract, "/tmp/A1.status", null);
    expect(result).toBe("/tmp/A1.envelope.json");
  });

  it("resolves from .summary.json path", () => {
    const contract = buildDefaultAdapterContract("codex");
    const result = locateResultEnvelope(contract, "/tmp/A1.summary.json", null);
    expect(result).toBe("/tmp/A1.envelope.json");
  });

  it("resolves from .log path when status is not provided", () => {
    const contract = buildDefaultAdapterContract("codex");
    const result = locateResultEnvelope(contract, null, "/tmp/A1.log");
    expect(result).toBe("/tmp/A1.envelope.json");
  });

  it("returns null for null contract", () => {
    expect(locateResultEnvelope(null, "/tmp/A1.status", null)).toBeNull();
  });

  it("returns null when no path is provided", () => {
    const contract = buildDefaultAdapterContract("codex");
    expect(locateResultEnvelope(contract, null, null)).toBeNull();
  });
});

describe("validateResultEnvelope", () => {
  it("validates a valid v2 envelope", () => {
    const contract = buildDefaultAdapterContract("codex");
    const envelope = {
      schemaVersion: 2,
      agentId: "A1",
      waveNumber: 3,
      attempt: 1,
      completedAt: new Date().toISOString(),
      exitCode: 0,
      role: "implementation",
    };
    const result = validateResultEnvelope(contract, envelope);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects null envelope", () => {
    const contract = buildDefaultAdapterContract("codex");
    const result = validateResultEnvelope(contract, null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects wrong schemaVersion", () => {
    const contract = buildDefaultAdapterContract("codex");
    const result = validateResultEnvelope(contract, {
      schemaVersion: 1,
      agentId: "A1",
      waveNumber: 3,
      attempt: 1,
      completedAt: new Date().toISOString(),
      exitCode: 0,
      role: "implementation",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects invalid role", () => {
    const contract = buildDefaultAdapterContract("codex");
    const result = validateResultEnvelope(contract, {
      schemaVersion: 2,
      agentId: "A1",
      waveNumber: 3,
      attempt: 1,
      completedAt: new Date().toISOString(),
      exitCode: 0,
      role: "unknown-role",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("role"))).toBe(true);
  });

  it("collects multiple errors", () => {
    const contract = buildDefaultAdapterContract("codex");
    const result = validateResultEnvelope(contract, {
      schemaVersion: 1,
      agentId: null,
      role: "bad",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });
});

describe("synthesizeLegacyEnvelope", () => {
  it("returns a v2 envelope with legacy marker", () => {
    const contract = buildDefaultAdapterContract("codex");
    const envelope = synthesizeLegacyEnvelope(contract, "/tmp/A1.log", "/tmp/A1.status");
    expect(envelope.schemaVersion).toBe(2);
    expect(envelope._synthesizedFromLegacy).toBe(true);
    expect(envelope._logPath).toBe("/tmp/A1.log");
    expect(envelope._statusPath).toBe("/tmp/A1.status");
    expect(envelope.role).toBe("implementation");
  });
});

describe("isAvailable", () => {
  it("returns true for valid adapter contract", () => {
    const contract = buildDefaultAdapterContract("codex");
    expect(isAvailable(contract)).toBe(true);
  });

  it("returns false for null contract", () => {
    expect(isAvailable(null)).toBe(false);
  });

  it("returns false for contract without command", () => {
    const contract = normalizeAdapterContract({
      adapterId: "test",
      launchContract: { command: "" },
    });
    expect(isAvailable(contract)).toBe(false);
  });
});

describe("adapterSummary", () => {
  it("returns summary with structured capabilities", () => {
    const contract = buildDefaultAdapterContract("codex");
    const summary = adapterSummary(contract);
    expect(summary.adapterId).toBe("codex");
    expect(summary.displayName).toBe("Codex");
    expect(summary.capabilityCount).toBeGreaterThan(0);
    expect(summary.capabilities).toHaveProperty("supportsSearch");
    expect(summary.canFallbackTo).toEqual(["claude", "opencode"]);
    expect(summary.restrictions).toEqual([]);
  });

  it("returns safe defaults for null", () => {
    const summary = adapterSummary(null);
    expect(summary.adapterId).toBeNull();
    expect(summary.displayName).toBeNull();
    expect(summary.capabilityCount).toBe(0);
    expect(summary.capabilities).toEqual({});
    expect(summary.canFallbackTo).toEqual([]);
    expect(summary.restrictions).toEqual([]);
  });
});

describe("KNOWN_ADAPTERS", () => {
  it("contains the four expected adapters", () => {
    expect(KNOWN_ADAPTERS.has("codex")).toBe(true);
    expect(KNOWN_ADAPTERS.has("claude")).toBe(true);
    expect(KNOWN_ADAPTERS.has("opencode")).toBe(true);
    expect(KNOWN_ADAPTERS.has("local")).toBe(true);
    expect(KNOWN_ADAPTERS.size).toBe(4);
  });
});
