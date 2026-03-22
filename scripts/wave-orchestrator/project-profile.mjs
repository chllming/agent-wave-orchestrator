import path from "node:path";
import { loadWaveConfig } from "./config.mjs";
import { REPO_ROOT, ensureDirectory, readJsonOrNull, writeJsonAtomic } from "./shared.mjs";
import { normalizeTerminalSurface } from "./terminals.mjs";

export const PROJECT_PROFILE_SCHEMA_VERSION = 1;
export const PROJECT_PROFILE_PATH = path.join(REPO_ROOT, ".wave", "project-profile.json");
export const PROJECT_OVERSIGHT_MODES = ["oversight", "dark-factory"];
export const PROJECT_PROFILE_TERMINAL_SURFACES = ["vscode", "tmux"];
export const DEPLOY_ENVIRONMENT_KINDS = [
  "railway-mcp",
  "railway-cli",
  "docker-compose",
  "kubernetes",
  "ssh-manual",
  "custom",
];
export const DRAFT_TEMPLATES = ["implementation", "qa", "infra", "release"];

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizePathForProfile(value) {
  const normalized = cleanText(value).replaceAll("\\", "/");
  if (!normalized) {
    return null;
  }
  return path.isAbsolute(normalized) ? path.relative(REPO_ROOT, normalized) : normalized;
}

function normalizeProjectTerminalSurface(value, label = "defaultTerminalSurface") {
  const normalized = normalizeTerminalSurface(value, label);
  return normalized === "none" ? "vscode" : normalized;
}

export function normalizeOversightMode(value, label = "oversight mode") {
  const normalized = cleanText(value).toLowerCase();
  if (!PROJECT_OVERSIGHT_MODES.includes(normalized)) {
    throw new Error(`${label} must be one of: ${PROJECT_OVERSIGHT_MODES.join(", ")}`);
  }
  return normalized;
}

export function normalizeDraftTemplate(value, label = "draft template") {
  const normalized = cleanText(value).toLowerCase();
  if (!DRAFT_TEMPLATES.includes(normalized)) {
    throw new Error(`${label} must be one of: ${DRAFT_TEMPLATES.join(", ")}`);
  }
  return normalized;
}

function normalizeDeployEnvironment(rawEnvironment, index) {
  if (!rawEnvironment || typeof rawEnvironment !== "object" || Array.isArray(rawEnvironment)) {
    throw new Error(`deployEnvironments[${index}] must be an object`);
  }
  const id = cleanText(rawEnvironment.id).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`deployEnvironments[${index}].id must be a lowercase repo-safe identifier`);
  }
  const kind = cleanText(rawEnvironment.kind).toLowerCase();
  if (!DEPLOY_ENVIRONMENT_KINDS.includes(kind)) {
    throw new Error(
      `deployEnvironments[${index}].kind must be one of: ${DEPLOY_ENVIRONMENT_KINDS.join(", ")}`,
    );
  }
  return {
    id,
    name: cleanText(rawEnvironment.name) || id,
    kind,
    isDefault: rawEnvironment.isDefault === true,
    notes: cleanText(rawEnvironment.notes) || null,
  };
}

export function buildDefaultProjectProfile(config = loadWaveConfig()) {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
    initializedAt: now,
    updatedAt: now,
    newProject: false,
    defaultOversightMode: "oversight",
    defaultTerminalSurface: "vscode",
    deployEnvironments: [],
    plannerDefaults: {
      template: "implementation",
      lane: cleanText(config.defaultLane) || "main",
    },
    source: {
      projectName: cleanText(config.projectName) || "Wave Orchestrator",
      configPath: normalizePathForProfile(config.configPath || "wave.config.json"),
    },
  };
}

export function normalizeProjectProfile(rawProfile, options = {}) {
  if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
    throw new Error(`Project profile is invalid: ${path.relative(REPO_ROOT, PROJECT_PROFILE_PATH)}`);
  }
  const config = options.config || loadWaveConfig();
  const base = buildDefaultProjectProfile(config);
  const deployEnvironments = Array.isArray(rawProfile.deployEnvironments)
    ? rawProfile.deployEnvironments.map((entry, index) => normalizeDeployEnvironment(entry, index))
    : [];
  const defaultEnvironmentIndex = deployEnvironments.findIndex((entry) => entry.isDefault);
  if (defaultEnvironmentIndex === -1 && deployEnvironments.length > 0) {
    deployEnvironments[0].isDefault = true;
  } else if (defaultEnvironmentIndex > -1) {
    deployEnvironments.forEach((entry, index) => {
      entry.isDefault = index === defaultEnvironmentIndex;
    });
  }
  const plannerDefaults =
    rawProfile.plannerDefaults && typeof rawProfile.plannerDefaults === "object"
      ? rawProfile.plannerDefaults
      : {};
  return {
    schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
    initializedAt: cleanText(rawProfile.initializedAt) || base.initializedAt,
    updatedAt: cleanText(rawProfile.updatedAt) || base.updatedAt,
    newProject: rawProfile.newProject === true,
    defaultOversightMode: normalizeOversightMode(
      rawProfile.defaultOversightMode || base.defaultOversightMode,
      "defaultOversightMode",
    ),
    defaultTerminalSurface: normalizeProjectTerminalSurface(
      rawProfile.defaultTerminalSurface || base.defaultTerminalSurface,
      "defaultTerminalSurface",
    ),
    deployEnvironments,
    plannerDefaults: {
      template: normalizeDraftTemplate(
        plannerDefaults.template || base.plannerDefaults.template,
        "plannerDefaults.template",
      ),
      lane: cleanText(plannerDefaults.lane) || base.plannerDefaults.lane,
    },
    source: {
      projectName: cleanText(rawProfile.source?.projectName) || base.source.projectName,
      configPath: normalizePathForProfile(rawProfile.source?.configPath) || base.source.configPath,
    },
  };
}

export function readProjectProfile(options = {}) {
  const payload = readJsonOrNull(PROJECT_PROFILE_PATH);
  if (!payload) {
    return null;
  }
  return normalizeProjectProfile(payload, options);
}

export function writeProjectProfile(profile, options = {}) {
  const config = options.config || loadWaveConfig();
  const now = new Date().toISOString();
  const normalized = normalizeProjectProfile(
    {
      ...profile,
      initializedAt: profile?.initializedAt || now,
      updatedAt: now,
      source: {
        projectName: profile?.source?.projectName || config.projectName,
        configPath: normalizePathForProfile(config.configPath || "wave.config.json"),
      },
    },
    { config },
  );
  ensureDirectory(path.dirname(PROJECT_PROFILE_PATH));
  writeJsonAtomic(PROJECT_PROFILE_PATH, normalized);
  return normalized;
}

export function updateProjectProfile(mutator, options = {}) {
  const config = options.config || loadWaveConfig();
  const current = readProjectProfile({ config }) || buildDefaultProjectProfile(config);
  const next = typeof mutator === "function" ? mutator(current) : { ...current, ...(mutator || {}) };
  return writeProjectProfile(
    {
      ...current,
      ...(next || {}),
      initializedAt: current.initializedAt,
    },
    { config },
  );
}

export function resolveDefaultTerminalSurface(profile) {
  return normalizeProjectTerminalSurface(profile?.defaultTerminalSurface || "vscode");
}
