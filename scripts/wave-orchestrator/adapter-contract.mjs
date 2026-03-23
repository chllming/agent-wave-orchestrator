import crypto from "node:crypto";
import { toIsoTimestamp } from "./shared.mjs";

/**
 * Known adapter identifiers.
 */
export const KNOWN_ADAPTERS = new Set(["codex", "claude", "opencode", "local"]);

/**
 * Default structured capabilities per adapter (P2-12 end-state).
 */
const DEFAULT_CAPABILITIES = {
  sandboxModes: [],
  supportsSearch: false,
  supportsImages: false,
  supportsAddDirs: false,
  supportsMcp: false,
  supportsHooks: false,
  supportsJson: false,
  maxTurns: null,
  rateLimitRetry: false,
};

const DEFAULT_SUPERVISION_HOOKS = {
  onLaunch: null,
  onComplete: null,
  onRateLimit: "retry",
  onTimeout: "retry",
  onCrash: "abort",
};

const ADAPTER_DEFAULTS = {
  codex: {
    displayName: "Codex",
    capabilities: {
      sandboxModes: ["danger-full-access", "workspace-write"],
      supportsSearch: true,
      supportsImages: true,
      supportsAddDirs: true,
      supportsMcp: false,
      supportsHooks: false,
      supportsJson: true,
      maxTurns: null,
      rateLimitRetry: true,
    },
    launchContract: {
      command: "codex",
      argTemplate: null,
      envTemplate: null,
      requiresShell: true,
    },
    resultContract: {
      statusFilePattern: ".status",
      logFilePattern: ".log",
      summaryFilePattern: ".summary.json",
      envelopeFilePattern: ".envelope.json",
    },
    fallbackEligibility: {
      canFallbackTo: ["claude", "opencode"],
      canFallbackFrom: [],
      restrictions: [],
    },
    supervisionHooks: {
      onLaunch: null,
      onComplete: null,
      onRateLimit: "retry",
      onTimeout: "fallback",
      onCrash: "fallback",
    },
  },
  claude: {
    displayName: "Claude Code",
    capabilities: {
      sandboxModes: [],
      supportsSearch: false,
      supportsImages: false,
      supportsAddDirs: false,
      supportsMcp: true,
      supportsHooks: true,
      supportsJson: false,
      maxTurns: null,
      rateLimitRetry: true,
    },
    launchContract: {
      command: "claude",
      argTemplate: null,
      envTemplate: null,
      requiresShell: true,
    },
    resultContract: {
      statusFilePattern: ".status",
      logFilePattern: ".log",
      summaryFilePattern: ".summary.json",
      envelopeFilePattern: ".envelope.json",
    },
    fallbackEligibility: {
      canFallbackTo: ["opencode"],
      canFallbackFrom: ["codex"],
      restrictions: [],
    },
    supervisionHooks: {
      onLaunch: null,
      onComplete: null,
      onRateLimit: "retry",
      onTimeout: "retry",
      onCrash: "abort",
    },
  },
  opencode: {
    displayName: "OpenCode",
    capabilities: {
      sandboxModes: [],
      supportsSearch: true,
      supportsImages: false,
      supportsAddDirs: false,
      supportsMcp: false,
      supportsHooks: false,
      supportsJson: true,
      maxTurns: null,
      rateLimitRetry: true,
    },
    launchContract: {
      command: "opencode",
      argTemplate: null,
      envTemplate: null,
      requiresShell: true,
    },
    resultContract: {
      statusFilePattern: ".status",
      logFilePattern: ".log",
      summaryFilePattern: ".summary.json",
      envelopeFilePattern: ".envelope.json",
    },
    fallbackEligibility: {
      canFallbackTo: ["claude"],
      canFallbackFrom: ["codex"],
      restrictions: [],
    },
    supervisionHooks: {
      onLaunch: null,
      onComplete: null,
      onRateLimit: "retry",
      onTimeout: "retry",
      onCrash: "abort",
    },
  },
  local: {
    displayName: "Local",
    capabilities: { ...DEFAULT_CAPABILITIES },
    launchContract: {
      command: "node",
      argTemplate: null,
      envTemplate: null,
      requiresShell: false,
    },
    resultContract: {
      statusFilePattern: ".status",
      logFilePattern: ".log",
      summaryFilePattern: ".summary.json",
      envelopeFilePattern: ".envelope.json",
    },
    fallbackEligibility: {
      canFallbackTo: [],
      canFallbackFrom: [],
      restrictions: [],
    },
    supervisionHooks: {
      onLaunch: null,
      onComplete: null,
      onRateLimit: "abort",
      onTimeout: "abort",
      onCrash: "abort",
    },
  },
};

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeCapabilities(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CAPABILITIES };
  }
  return {
    sandboxModes: Array.isArray(raw.sandboxModes)
      ? raw.sandboxModes.filter((m) => typeof m === "string" && m.trim())
      : [],
    supportsSearch: Boolean(raw.supportsSearch),
    supportsImages: Boolean(raw.supportsImages),
    supportsAddDirs: Boolean(raw.supportsAddDirs),
    supportsMcp: Boolean(raw.supportsMcp),
    supportsHooks: Boolean(raw.supportsHooks),
    supportsJson: Boolean(raw.supportsJson),
    maxTurns:
      typeof raw.maxTurns === "number" && Number.isFinite(raw.maxTurns)
        ? raw.maxTurns
        : null,
    rateLimitRetry: Boolean(raw.rateLimitRetry),
  };
}

function normalizeFallbackEligibility(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      canFallbackTo: [],
      canFallbackFrom: [],
      restrictions: [],
    };
  }
  return {
    canFallbackTo: Array.isArray(raw.canFallbackTo)
      ? raw.canFallbackTo.filter((id) => typeof id === "string" && id.trim())
      : [],
    canFallbackFrom: Array.isArray(raw.canFallbackFrom)
      ? raw.canFallbackFrom.filter((id) => typeof id === "string" && id.trim())
      : [],
    restrictions: Array.isArray(raw.restrictions)
      ? raw.restrictions.filter((r) => typeof r === "string" && r.trim())
      : [],
  };
}

function normalizeSupervisionHooks(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SUPERVISION_HOOKS };
  }
  const validActions = new Set(["retry", "fallback", "abort"]);
  return {
    onLaunch: typeof raw.onLaunch === "function" ? raw.onLaunch : null,
    onComplete: typeof raw.onComplete === "function" ? raw.onComplete : null,
    onRateLimit: validActions.has(raw.onRateLimit) ? raw.onRateLimit : DEFAULT_SUPERVISION_HOOKS.onRateLimit,
    onTimeout: validActions.has(raw.onTimeout) ? raw.onTimeout : DEFAULT_SUPERVISION_HOOKS.onTimeout,
    onCrash: validActions.has(raw.onCrash) ? raw.onCrash : DEFAULT_SUPERVISION_HOOKS.onCrash,
  };
}

function normalizeLaunchContract(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      command: "",
      argTemplate: null,
      envTemplate: null,
      requiresShell: false,
    };
  }
  return {
    command: typeof raw.command === "string" ? raw.command : "",
    argTemplate: typeof raw.argTemplate === "function" ? raw.argTemplate : null,
    envTemplate: typeof raw.envTemplate === "function" ? raw.envTemplate : null,
    requiresShell: Boolean(raw.requiresShell),
  };
}

function normalizeResultContract(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      statusFilePattern: ".status",
      logFilePattern: ".log",
      summaryFilePattern: ".summary.json",
      envelopeFilePattern: ".envelope.json",
    };
  }
  return {
    statusFilePattern: typeof raw.statusFilePattern === "string" ? raw.statusFilePattern : ".status",
    logFilePattern: typeof raw.logFilePattern === "string" ? raw.logFilePattern : ".log",
    summaryFilePattern: typeof raw.summaryFilePattern === "string" ? raw.summaryFilePattern : ".summary.json",
    envelopeFilePattern: typeof raw.envelopeFilePattern === "string" ? raw.envelopeFilePattern : ".envelope.json",
  };
}

// ---------------------------------------------------------------------------
// Contract normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an adapter contract from raw input.
 * Fills in missing fields with sensible defaults.
 */
export function normalizeAdapterContract(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      adapterId: "local",
      displayName: "Local",
      capabilities: { ...DEFAULT_CAPABILITIES },
      launchContract: normalizeLaunchContract(null),
      resultContract: normalizeResultContract(null),
      fallbackEligibility: normalizeFallbackEligibility(null),
      supervisionHooks: normalizeSupervisionHooks(null),
    };
  }
  const adapterId = typeof raw.adapterId === "string" && raw.adapterId.trim()
    ? raw.adapterId.trim()
    : "local";
  return {
    adapterId,
    displayName: typeof raw.displayName === "string" && raw.displayName.trim()
      ? raw.displayName.trim()
      : adapterId,
    capabilities: normalizeCapabilities(raw.capabilities),
    launchContract: normalizeLaunchContract(raw.launchContract),
    resultContract: normalizeResultContract(raw.resultContract),
    fallbackEligibility: normalizeFallbackEligibility(raw.fallbackEligibility),
    supervisionHooks: normalizeSupervisionHooks(raw.supervisionHooks),
  };
}

/**
 * Returns the default adapter contract for a known adapter.
 */
export function buildDefaultAdapterContract(adapterId) {
  const id = String(adapterId || "").trim().toLowerCase();
  const defaults = ADAPTER_DEFAULTS[id];
  if (!defaults) {
    return normalizeAdapterContract({ adapterId: id });
  }
  return {
    adapterId: id,
    displayName: defaults.displayName,
    capabilities: { ...defaults.capabilities },
    launchContract: { ...defaults.launchContract },
    resultContract: { ...defaults.resultContract },
    fallbackEligibility: {
      canFallbackTo: [...defaults.fallbackEligibility.canFallbackTo],
      canFallbackFrom: [...defaults.fallbackEligibility.canFallbackFrom],
      restrictions: [...defaults.fallbackEligibility.restrictions],
    },
    supervisionHooks: { ...defaults.supervisionHooks },
  };
}

// ---------------------------------------------------------------------------
// Capability queries
// ---------------------------------------------------------------------------

/**
 * Capability key → structured-capabilities field mapping.
 * Allows legacy string-based capability checks to work against the
 * structured capabilities object.
 */
const CAPABILITY_KEY_MAP = {
  sandbox: (caps) => Array.isArray(caps.sandboxModes) && caps.sandboxModes.length > 0,
  search: (caps) => caps.supportsSearch === true,
  images: (caps) => caps.supportsImages === true,
  "add-dirs": (caps) => caps.supportsAddDirs === true,
  "json-output": (caps) => caps.supportsJson === true,
  "turn-limit": (caps) => caps.maxTurns != null,
  mcp: (caps) => caps.supportsMcp === true,
  hooks: (caps) => caps.supportsHooks === true,
  "rate-limit-retry": (caps) => caps.rateLimitRetry === true,
};

/**
 * Check if an adapter contract has a specific capability.
 * Works with both structured capabilities objects and legacy Sets/Arrays.
 */
export function hasCapability(adapterContract, capability) {
  if (!adapterContract || typeof adapterContract !== "object") {
    return false;
  }
  const caps = adapterContract.capabilities;
  if (!caps) {
    return false;
  }
  // Structured capabilities object
  if (typeof caps === "object" && !Array.isArray(caps) && !(caps instanceof Set)) {
    const checker = CAPABILITY_KEY_MAP[capability];
    if (checker) {
      return checker(caps);
    }
    // Direct boolean field check (e.g. "supportsSearch")
    if (capability in caps) {
      return Boolean(caps[capability]);
    }
    return false;
  }
  // Legacy: Set or Array
  if (caps instanceof Set) {
    return caps.has(capability);
  }
  if (Array.isArray(caps)) {
    return caps.includes(capability);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Adapter contract methods (P2-12)
// ---------------------------------------------------------------------------

/**
 * Build a launch specification from an agent definition, wave context, and options.
 * Returns a LaunchSpec object suitable for the session supervisor.
 *
 * This is a default/stub implementation. Real adapters override per-executor.
 */
export function buildLaunchSpec(adapterContract, agent, wave, options = {}) {
  if (!adapterContract || typeof adapterContract !== "object") {
    return null;
  }
  const launch = adapterContract.launchContract || {};
  return {
    adapterId: adapterContract.adapterId,
    command: launch.command || "",
    agentId: agent?.agentId || null,
    waveNumber: wave?.waveNumber ?? null,
    requiresShell: Boolean(launch.requiresShell),
    args: typeof launch.argTemplate === "function"
      ? launch.argTemplate(agent, wave, options)
      : [],
    env: typeof launch.envTemplate === "function"
      ? launch.envTemplate(agent, wave, options)
      : {},
    createdAt: toIsoTimestamp(),
  };
}

/**
 * Locate the result envelope file given a status path and log path.
 * Returns the envelope path if it can be determined, or null.
 */
export function locateResultEnvelope(adapterContract, statusPath, logPath) {
  if (!adapterContract || typeof adapterContract !== "object") {
    return null;
  }
  const rc = adapterContract.resultContract || {};
  const envelopePattern = rc.envelopeFilePattern || ".envelope.json";
  if (statusPath && typeof statusPath === "string") {
    if (statusPath.endsWith(".status")) {
      return statusPath.replace(/\.status$/, envelopePattern);
    }
    if (statusPath.endsWith(".summary.json")) {
      return statusPath.replace(/\.summary\.json$/, envelopePattern);
    }
  }
  if (logPath && typeof logPath === "string") {
    if (logPath.endsWith(".log")) {
      return logPath.replace(/\.log$/, envelopePattern);
    }
  }
  return null;
}

/**
 * Validate a result envelope against the expected schema.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateResultEnvelope(adapterContract, envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object") {
    return { valid: false, errors: ["Envelope is null or not an object"] };
  }
  if (envelope.schemaVersion !== 2) {
    errors.push(`Expected schemaVersion 2, got ${envelope.schemaVersion}`);
  }
  if (!envelope.agentId || typeof envelope.agentId !== "string") {
    errors.push("Missing or invalid agentId");
  }
  if (typeof envelope.waveNumber !== "number") {
    errors.push("Missing or invalid waveNumber");
  }
  if (typeof envelope.attempt !== "number") {
    errors.push("Missing or invalid attempt");
  }
  if (!envelope.completedAt || typeof envelope.completedAt !== "string") {
    errors.push("Missing or invalid completedAt");
  }
  if (typeof envelope.exitCode !== "number") {
    errors.push("Missing or invalid exitCode");
  }
  const validRoles = new Set([
    "implementation", "integration", "documentation",
    "cont-qa", "cont-eval", "security", "deploy",
  ]);
  if (!validRoles.has(envelope.role)) {
    errors.push(`Invalid or missing role: ${envelope.role}`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Synthesize a result envelope from legacy log-parsed signals.
 * Migration-only adapter: converts old log markers into the new envelope shape.
 */
export function synthesizeLegacyEnvelope(adapterContract, logPath, statusPath) {
  // Stub: returns a minimal valid v2 envelope shell.
  // In production this would parse the log file and status file to extract markers.
  return {
    schemaVersion: 2,
    agentId: null,
    waveNumber: null,
    attempt: 1,
    completedAt: toIsoTimestamp(),
    exitCode: 0,
    role: "implementation",
    proof: {
      state: "not_applicable",
      completion: null,
      durability: null,
      proofLevel: null,
      detail: "Synthesized from legacy signals",
    },
    deliverables: [],
    proofArtifacts: [],
    gaps: [],
    unresolvedBlockers: [],
    riskNotes: [],
    facts: [],
    _synthesizedFromLegacy: true,
    _logPath: logPath || null,
    _statusPath: statusPath || null,
  };
}

/**
 * Check if the executor for this adapter is available on the current system.
 * Returns true if the command exists and is callable.
 */
export function isAvailable(adapterContract) {
  if (!adapterContract || typeof adapterContract !== "object") {
    return false;
  }
  const command = adapterContract.launchContract?.command;
  if (!command || typeof command !== "string") {
    return false;
  }
  // Simple heuristic: known adapters are assumed available.
  // Real implementation would check PATH or run `which <command>`.
  return true;
}

// ---------------------------------------------------------------------------
// Fallback logic
// ---------------------------------------------------------------------------

/**
 * Check if fromAdapter can fall back to toAdapter.
 */
export function canFallback(fromAdapter, toAdapter) {
  if (!fromAdapter || typeof fromAdapter !== "object") {
    return false;
  }
  if (!toAdapter || typeof toAdapter !== "object") {
    return false;
  }
  const fromCanFallbackTo = Array.isArray(fromAdapter.fallbackEligibility?.canFallbackTo)
    ? fromAdapter.fallbackEligibility.canFallbackTo
    : [];
  const toCanFallbackFrom = Array.isArray(toAdapter.fallbackEligibility?.canFallbackFrom)
    ? toAdapter.fallbackEligibility.canFallbackFrom
    : [];
  return (
    fromCanFallbackTo.includes(toAdapter.adapterId) ||
    toCanFallbackFrom.includes(fromAdapter.adapterId)
  );
}

/**
 * Select the adapter that best matches required capabilities.
 * Required capabilities can be an array of string keys (legacy) or
 * a structured object with boolean fields.
 *
 * Returns the adapter with the most matching capabilities.
 * Ties are broken by order of fallbackEligibility (first in canFallbackTo).
 * Returns null if no adapters are provided.
 */
export function selectBestAdapter(adapters, requiredCapabilities) {
  const list = Array.isArray(adapters) ? adapters : [];
  if (list.length === 0) {
    return null;
  }

  // Normalize required capabilities to an array of string keys
  let required = [];
  if (Array.isArray(requiredCapabilities)) {
    required = requiredCapabilities;
  } else if (requiredCapabilities instanceof Set) {
    required = [...requiredCapabilities];
  } else if (requiredCapabilities && typeof requiredCapabilities === "object") {
    // Structured capabilities object: extract truthy keys
    for (const [key, value] of Object.entries(requiredCapabilities)) {
      if (value === true || (Array.isArray(value) && value.length > 0) || (typeof value === "number" && value > 0)) {
        required.push(key);
      }
    }
  }

  let bestAdapter = null;
  let bestMatchCount = -1;
  let bestIndex = Infinity;

  for (let i = 0; i < list.length; i++) {
    const adapter = list[i];
    if (!adapter || typeof adapter !== "object") {
      continue;
    }
    let matchCount = 0;
    for (const cap of required) {
      if (hasCapability(adapter, cap)) {
        matchCount++;
      }
    }
    if (
      matchCount > bestMatchCount ||
      (matchCount === bestMatchCount && i < bestIndex)
    ) {
      bestAdapter = adapter;
      bestMatchCount = matchCount;
      bestIndex = i;
    }
  }
  return bestAdapter;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Returns a summary of an adapter contract.
 */
export function adapterSummary(adapterContract) {
  if (!adapterContract || typeof adapterContract !== "object") {
    return {
      adapterId: null,
      displayName: null,
      capabilityCount: 0,
      capabilities: {},
      canFallbackTo: [],
      restrictions: [],
    };
  }
  const caps = adapterContract.capabilities || {};
  const capObj = typeof caps === "object" && !Array.isArray(caps) && !(caps instanceof Set)
    ? { ...caps }
    : {};
  const trueCount = Object.values(capObj).filter((v) =>
    v === true || (Array.isArray(v) && v.length > 0) || (typeof v === "number" && v > 0),
  ).length;
  const fallbackTo = Array.isArray(adapterContract.fallbackEligibility?.canFallbackTo)
    ? [...adapterContract.fallbackEligibility.canFallbackTo]
    : [];
  const restrictions = Array.isArray(adapterContract.fallbackEligibility?.restrictions)
    ? [...adapterContract.fallbackEligibility.restrictions]
    : [];
  return {
    adapterId: adapterContract.adapterId || null,
    displayName: adapterContract.displayName || null,
    capabilityCount: trueCount,
    capabilities: capObj,
    canFallbackTo: fallbackTo,
    restrictions,
  };
}
