import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_ROOT } from "./roots.mjs";

const REPO_ROOT = WORKSPACE_ROOT;

export const DEFAULT_SKILLS_DIR = "skills";
export const SKILL_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
export const SUPPORTED_SKILL_RUNTIMES = ["codex", "claude", "opencode", "local"];
export const SUPPORTED_SKILL_ROLES = [
  "design",
  "implementation",
  "integration",
  "documentation",
  "cont-qa",
  "cont-eval",
  "security",
  "infra",
  "deploy",
  "research",
];
export const SUPPORTED_SKILL_DEPLOY_KINDS = [
  "railway-cli",
  "railway-mcp",
  "docker-compose",
  "kubernetes",
  "ssh-manual",
  "custom",
  "aws",
  "github-release",
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function hashBuffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeTextAtomic(filePath, text) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, text, "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeJsonAtomic(filePath, payload) {
  writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeRepoRelativePath(value, label) {
  const raw = cleanText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  if (!raw) {
    throw new Error(`${label} is required`);
  }
  if (raw.startsWith("/") || raw.startsWith("../") || raw.includes("/../")) {
    throw new Error(`${label} must stay within the repository: ${value}`);
  }
  return raw;
}

function uniqueStrings(values, options = {}) {
  const lowerCase = options.lowerCase !== false;
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => {
          const normalized = cleanText(value);
          return lowerCase ? normalized.toLowerCase() : normalized;
        })
        .filter(Boolean),
    ),
  );
}

function listFilesRecursively(rootDir) {
  if (!fs.existsSync(rootDir)) {
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
  visit(rootDir);
  return files.toSorted();
}

function repoRelativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replaceAll(path.sep, "/");
}

function readJsonObject(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${repoRelativePath(filePath)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label} JSON at ${repoRelativePath(filePath)}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object: ${repoRelativePath(filePath)}`);
  }
  return parsed;
}

function normalizeRequiredText(value, label) {
  const normalized = cleanText(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function normalizeOptionalText(value) {
  const normalized = cleanText(value);
  return normalized || null;
}

function normalizeChoiceArray(values, label, allowedValues) {
  if (values === undefined || values === null || values === "") {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }
  const normalized = uniqueStrings(values);
  const allowed = new Set(allowedValues);
  for (const value of normalized) {
    if (!allowed.has(value)) {
      throw new Error(`${label} contains unsupported value "${value}"`);
    }
  }
  return normalized;
}

function normalizeStringArray(values, label) {
  if (values === undefined || values === null || values === "") {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }
  return uniqueStrings(values, { lowerCase: false });
}

function normalizeDeployKind(value, label = "deploy kind") {
  const normalized = cleanText(value).toLowerCase();
  if (!SKILL_ID_REGEX.test(normalized)) {
    throw new Error(`${label} must match ${SKILL_ID_REGEX}`);
  }
  return normalized;
}

function normalizeDeployKindArray(values, label, options = {}) {
  if (values === undefined || values === null || values === "") {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }
  const normalized = uniqueStrings(
    values.map((value, index) => normalizeDeployKind(value, `${label}[${index}]`)),
  );
  const allowedValues = Array.isArray(options.allowedValues) ? options.allowedValues : [];
  if (allowedValues.length === 0) {
    return normalized;
  }
  const allowed = new Set(allowedValues.map((value) => normalizeDeployKind(value, label)));
  for (const value of normalized) {
    if (!allowed.has(value)) {
      throw new Error(`${label} contains unsupported value "${value}"`);
    }
  }
  return normalized;
}

export function normalizeSkillId(value, label = "skill id") {
  const normalized = cleanText(value).toLowerCase();
  if (!SKILL_ID_REGEX.test(normalized)) {
    throw new Error(`${label} must match ${SKILL_ID_REGEX}`);
  }
  return normalized;
}

export function normalizeSkillIdArray(values, label = "skills") {
  if (values === undefined || values === null || values === "") {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }
  return uniqueStrings(
    values.map((value, index) => normalizeSkillId(value, `${label}[${index}]`)),
  );
}

function normalizeSkillMap(rawMap = {}, label, options = {}) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return {};
  }
  const allowedKeys = options.allowedKeys ? new Set(options.allowedKeys) : null;
  return Object.fromEntries(
    Object.entries(rawMap).map(([key, values]) => {
      const normalizedKey = cleanText(key).toLowerCase();
      if (!normalizedKey) {
        throw new Error(`${label} keys must be non-empty`);
      }
      if (allowedKeys && !allowedKeys.has(normalizedKey)) {
        throw new Error(`${label}.${key} is not a supported selector key`);
      }
      return [normalizedKey, normalizeSkillIdArray(values, `${label}.${key}`)];
    }),
  );
}

function normalizeSkillActivation(rawActivation, label) {
  if (!rawActivation || typeof rawActivation !== "object" || Array.isArray(rawActivation)) {
    throw new Error(`${label} is required and must be an object`);
  }
  return {
    when: normalizeRequiredText(rawActivation.when, `${label}.when`),
    roles: normalizeChoiceArray(rawActivation.roles, `${label}.roles`, SUPPORTED_SKILL_ROLES),
    runtimes: normalizeChoiceArray(
      rawActivation.runtimes,
      `${label}.runtimes`,
      SUPPORTED_SKILL_RUNTIMES,
    ),
    deployKinds: normalizeDeployKindArray(rawActivation.deployKinds, `${label}.deployKinds`),
  };
}

function normalizeSkillTermination(rawTermination, label) {
  if (rawTermination === undefined || rawTermination === null || rawTermination === "") {
    return null;
  }
  if (typeof rawTermination === "string") {
    return {
      when: normalizeRequiredText(rawTermination, label),
    };
  }
  if (!rawTermination || typeof rawTermination !== "object" || Array.isArray(rawTermination)) {
    throw new Error(`${label} must be a string or an object`);
  }
  return {
    when: normalizeRequiredText(rawTermination.when, `${label}.when`),
  };
}

function normalizeSkillPermissions(rawPermissions, label) {
  if (rawPermissions === undefined || rawPermissions === null || rawPermissions === "") {
    return {
      network: [],
      shell: [],
      mcpServers: [],
    };
  }
  if (!rawPermissions || typeof rawPermissions !== "object" || Array.isArray(rawPermissions)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    network: normalizeStringArray(rawPermissions.network, `${label}.network`),
    shell: normalizeStringArray(rawPermissions.shell, `${label}.shell`),
    mcpServers: normalizeStringArray(rawPermissions.mcpServers, `${label}.mcpServers`),
  };
}

function normalizeTrustTier(value, label) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  if (!SKILL_ID_REGEX.test(normalized)) {
    throw new Error(`${label} must match ${SKILL_ID_REGEX}`);
  }
  return normalized;
}

function normalizeSkillTrust(rawTrust, label) {
  if (rawTrust === undefined || rawTrust === null || rawTrust === "") {
    return null;
  }
  if (typeof rawTrust === "string") {
    return {
      tier: normalizeTrustTier(rawTrust, label),
    };
  }
  if (!rawTrust || typeof rawTrust !== "object" || Array.isArray(rawTrust)) {
    throw new Error(`${label} must be a string or an object`);
  }
  return {
    tier: normalizeTrustTier(rawTrust.tier, `${label}.tier`),
  };
}

function normalizeSkillEvalCase(rawEvalCase, label) {
  if (!rawEvalCase || typeof rawEvalCase !== "object" || Array.isArray(rawEvalCase)) {
    throw new Error(`${label} must be an object`);
  }
  const expectActive = rawEvalCase.expectActive;
  if (typeof expectActive !== "boolean") {
    throw new Error(`${label}.expectActive must be a boolean`);
  }
  return {
    id: normalizeSkillId(rawEvalCase.id, `${label}.id`),
    role: normalizeChoiceArray(
      [normalizeRequiredText(rawEvalCase.role, `${label}.role`)],
      `${label}.role`,
      SUPPORTED_SKILL_ROLES,
    )[0],
    runtime: normalizeChoiceArray(
      [normalizeRequiredText(rawEvalCase.runtime, `${label}.runtime`)],
      `${label}.runtime`,
      SUPPORTED_SKILL_RUNTIMES,
    )[0],
    deployKind:
      rawEvalCase.deployKind === undefined || rawEvalCase.deployKind === null || rawEvalCase.deployKind === ""
        ? null
        : normalizeDeployKind(rawEvalCase.deployKind, `${label}.deployKind`),
    expectActive,
  };
}

function normalizeSkillEvalCaseArray(rawEvalCases, label) {
  if (rawEvalCases === undefined || rawEvalCases === null || rawEvalCases === "") {
    return [];
  }
  if (!Array.isArray(rawEvalCases)) {
    throw new Error(`${label} must be an array`);
  }
  return rawEvalCases.map((entry, index) =>
    normalizeSkillEvalCase(entry, `${label}[${index}]`),
  );
}

function normalizeSkillManifest(rawManifest, normalizedSkillId) {
  const label = `skills.${normalizedSkillId}`;
  return {
    id: normalizeSkillId(rawManifest.id || normalizedSkillId, `${label}.id`),
    title: normalizeRequiredText(rawManifest.title, `${label}.title`),
    description: normalizeRequiredText(
      rawManifest.description || rawManifest.summary,
      `${label}.description`,
    ),
    version: normalizeOptionalText(rawManifest.version),
    tags: normalizeStringArray(rawManifest.tags, `${label}.tags`),
    activation: normalizeSkillActivation(rawManifest.activation, `${label}.activation`),
    termination: normalizeSkillTermination(rawManifest.termination, `${label}.termination`),
    permissions: normalizeSkillPermissions(rawManifest.permissions, `${label}.permissions`),
    trust: normalizeSkillTrust(rawManifest.trust, `${label}.trust`),
    evalCases: normalizeSkillEvalCaseArray(rawManifest.evalCases, `${label}.evalCases`),
  };
}

function formatScopeList(values, fallback = "any") {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : fallback;
}

function formatPermissionSummary(permissions) {
  const segments = [];
  if (permissions.network.length > 0) {
    segments.push(`network=${permissions.network.join(", ")}`);
  }
  if (permissions.shell.length > 0) {
    segments.push(`shell=${permissions.shell.join(", ")}`);
  }
  if (permissions.mcpServers.length > 0) {
    segments.push(`mcp=${permissions.mcpServers.join(", ")}`);
  }
  return segments.length > 0 ? segments.join("; ") : "none declared";
}

function resolveSkillBundleDir(skillsDir, skillId) {
  return path.join(REPO_ROOT, skillsDir, skillId);
}

function listSkillBundleIds(skillsDir) {
  const skillsRoot = path.join(REPO_ROOT, skillsDir);
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SKILL_ID_REGEX.test(entry.name))
    .map((entry) => entry.name)
    .toSorted();
}

export function emptySkillsConfig() {
  return {
    dir: DEFAULT_SKILLS_DIR,
    base: [],
    byRole: {},
    byRuntime: {},
    byDeployKind: {},
  };
}

export function normalizeSkillsConfig(rawSkills = {}, label = "skills", options = {}) {
  const skills =
    rawSkills && typeof rawSkills === "object" && !Array.isArray(rawSkills) ? rawSkills : {};
  if (
    skills.byRole &&
    typeof skills.byRole === "object" &&
    !Array.isArray(skills.byRole) &&
    Object.keys(skills.byRole).some((key) => cleanText(key).toLowerCase() === "evaluator")
  ) {
    throw new Error(`${label}.byRole.evaluator was renamed to ${label}.byRole.cont-qa`);
  }
  const dir =
    Object.prototype.hasOwnProperty.call(skills, "dir")
      ? normalizeRepoRelativePath(skills.dir || DEFAULT_SKILLS_DIR, `${label}.dir`)
      : options.preserveOmittedDir
        ? null
        : DEFAULT_SKILLS_DIR;
  const byRole = normalizeSkillMap(skills.byRole, `${label}.byRole`, {
    allowedKeys: SUPPORTED_SKILL_ROLES,
  });
  return {
    dir,
    base: normalizeSkillIdArray(skills.base, `${label}.base`),
    byRole,
    byRuntime: normalizeSkillMap(skills.byRuntime, `${label}.byRuntime`, {
      allowedKeys: SUPPORTED_SKILL_RUNTIMES,
    }),
    byDeployKind: normalizeSkillMap(skills.byDeployKind, `${label}.byDeployKind`),
  };
}

function mergeSkillMaps(baseMap = {}, overrideMap = {}) {
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(baseMap || {}), ...Object.keys(overrideMap || {})]))
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, uniqueStrings([...(baseMap[key] || []), ...(overrideMap[key] || [])])]),
  );
}

export function mergeSkillsConfig(
  baseSkills = emptySkillsConfig(),
  overrideSkills = emptySkillsConfig(),
) {
  return {
    dir: overrideSkills.dir || baseSkills.dir || DEFAULT_SKILLS_DIR,
    base: uniqueStrings([...(baseSkills.base || []), ...(overrideSkills.base || [])]).map(
      (skillId) => normalizeSkillId(skillId),
    ),
    byRole: mergeSkillMaps(baseSkills.byRole, overrideSkills.byRole),
    byRuntime: mergeSkillMaps(baseSkills.byRuntime, overrideSkills.byRuntime),
    byDeployKind: mergeSkillMaps(baseSkills.byDeployKind, overrideSkills.byDeployKind),
  };
}

export function skillMatchesActivation(bundle, context = {}) {
  if (!bundle?.activation) {
    return true;
  }
  const role = cleanText(context.role).toLowerCase() || null;
  const runtimeId = cleanText(context.runtimeId).toLowerCase() || null;
  const deployKind = cleanText(context.deployKind).toLowerCase() || null;
  if (bundle.activation.roles.length > 0 && (!role || !bundle.activation.roles.includes(role))) {
    return false;
  }
  if (
    bundle.activation.runtimes.length > 0 &&
    (!runtimeId || !bundle.activation.runtimes.includes(runtimeId))
  ) {
    return false;
  }
  if (
    bundle.activation.deployKinds.length > 0 &&
    (!deployKind || !bundle.activation.deployKinds.includes(deployKind))
  ) {
    return false;
  }
  return true;
}

export function evaluateSkillBundleCases(bundle) {
  const errors = [];
  for (const evalCase of bundle.evalCases || []) {
    const actual = skillMatchesActivation(bundle, {
      role: evalCase.role,
      runtimeId: evalCase.runtime,
      deployKind: evalCase.deployKind,
    });
    if (actual !== evalCase.expectActive) {
      errors.push(
        `Skill "${bundle.id}" eval case "${evalCase.id}" expected active=${evalCase.expectActive} but resolved ${actual}`,
      );
    }
  }
  return {
    errors,
    evaluatedCases: Array.isArray(bundle.evalCases) ? bundle.evalCases.length : 0,
  };
}

export function loadSkillBundle(skillId, options = {}) {
  const normalizedSkillId = normalizeSkillId(skillId);
  const skillsDir = normalizeRepoRelativePath(options.skillsDir || DEFAULT_SKILLS_DIR, "skills.dir");
  const bundleDir = resolveSkillBundleDir(skillsDir, normalizedSkillId);
  if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
    throw new Error(
      `Missing skill bundle "${normalizedSkillId}" in ${repoRelativePath(path.join(REPO_ROOT, skillsDir))}`,
    );
  }
  const manifestPath = path.join(bundleDir, "skill.json");
  const skillPath = path.join(bundleDir, "SKILL.md");
  const rawManifest = readJsonObject(manifestPath, "skill manifest");
  const manifest = normalizeSkillManifest(rawManifest, normalizedSkillId);
  if (manifest.id !== normalizedSkillId) {
    throw new Error(`Skill manifest id mismatch for ${normalizedSkillId}: expected "${normalizedSkillId}"`);
  }
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Missing SKILL.md for skill "${normalizedSkillId}"`);
  }
  const skillText = fs.readFileSync(skillPath, "utf8").trim();
  const adapterTextByRuntime = {};
  const adapterPathByRuntime = {};
  for (const runtimeId of SUPPORTED_SKILL_RUNTIMES) {
    const adapterPath = path.join(bundleDir, "adapters", `${runtimeId}.md`);
    if (!fs.existsSync(adapterPath)) {
      continue;
    }
    adapterPathByRuntime[runtimeId] = repoRelativePath(adapterPath);
    adapterTextByRuntime[runtimeId] = fs.readFileSync(adapterPath, "utf8").trim();
  }
  const referencesDir = path.join(bundleDir, "references");
  const referencePaths = listFilesRecursively(referencesDir).map((filePath) =>
    repoRelativePath(filePath),
  );
  const sourceFiles = listFilesRecursively(bundleDir).map((filePath) => ({
    path: repoRelativePath(filePath),
    hash: hashBuffer(fs.readFileSync(filePath)),
  }));
  const bundleHash = hashText(sourceFiles.map((entry) => `${entry.path}:${entry.hash}`).join("\n"));
  return {
    ...manifest,
    bundlePath: repoRelativePath(bundleDir),
    manifestPath: repoRelativePath(manifestPath),
    skillPath: repoRelativePath(skillPath),
    skillText,
    adapterPathByRuntime,
    adapterTextByRuntime,
    referencePaths,
    sourceFiles,
    bundleHash,
  };
}

function renderBundleCatalog(bundle, runtimeId) {
  const lines = [`## Skill ${bundle.id}`];
  lines.push(`- Summary: ${bundle.description}`);
  lines.push(`- Bundle: ${bundle.bundlePath}`);
  lines.push(`- Manifest: ${bundle.manifestPath}`);
  lines.push(`- Canonical instructions: ${bundle.skillPath}`);
  lines.push(`- Activation: ${bundle.activation.when}`);
  lines.push(`- Activation roles: ${formatScopeList(bundle.activation.roles)}`);
  lines.push(`- Activation runtimes: ${formatScopeList(bundle.activation.runtimes)}`);
  lines.push(`- Activation deploy kinds: ${formatScopeList(bundle.activation.deployKinds)}`);
  if (bundle.termination?.when) {
    lines.push(`- Termination: ${bundle.termination.when}`);
  }
  if (bundle.trust?.tier) {
    lines.push(`- Trust tier: ${bundle.trust.tier}`);
  }
  lines.push(`- Permissions: ${formatPermissionSummary(bundle.permissions)}`);
  lines.push(
    `- Runtime adapter (${runtimeId}): ${bundle.adapterPathByRuntime[runtimeId] || "none"}`,
  );
  if (Array.isArray(bundle.referencePaths) && bundle.referencePaths.length > 0) {
    for (const refPath of bundle.referencePaths) {
      lines.push(`- Reference: ${refPath}`);
    }
  }
  lines.push("");
  return lines;
}

function renderBundleExpandedPrompt(bundle, runtimeId) {
  const lines = [`## Skill ${bundle.id}`];
  lines.push(`- Summary: ${bundle.description}`);
  lines.push(`- Manifest: ${bundle.manifestPath}`);
  lines.push(`- Canonical instructions: ${bundle.skillPath}`);
  lines.push("### Canonical instructions");
  lines.push("```text");
  lines.push(bundle.skillText);
  lines.push("```");
  const adapterText = bundle.adapterTextByRuntime[runtimeId];
  if (adapterText) {
    lines.push("");
    lines.push(`### ${runtimeId} adapter (${bundle.adapterPathByRuntime[runtimeId]})`);
    lines.push("```text");
    lines.push(adapterText);
    lines.push("```");
  }
  if (Array.isArray(bundle.referencePaths) && bundle.referencePaths.length > 0) {
    lines.push("");
    lines.push("### Available references");
    for (const refPath of bundle.referencePaths) {
      lines.push(`- ${refPath}`);
    }
  }
  lines.push("");
  return lines;
}

function renderSkillPromptText(bundles, runtimeId) {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    return "";
  }
  const lines = [
    "Active skill packs for this run:",
    ...bundles.map((bundle) => `- ${bundle.id}: ${bundle.description}`),
    "- Skills are additive guidance. Repository source, standing role prompts, shared summaries, and ownership boundaries remain authoritative.",
    "- Use this catalog first. Open each bundle's manifest, SKILL.md, runtime adapter, and references only when needed for the current step.",
    "",
  ];
  for (const bundle of bundles) {
    lines.push(...renderBundleCatalog(bundle, runtimeId));
  }
  return lines.join("\n").trim();
}

function renderExpandedSkillText(bundles, runtimeId) {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    return "";
  }
  const lines = ["Full canonical skill payload for this run:", ""];
  for (const bundle of bundles) {
    lines.push(...renderBundleExpandedPrompt(bundle, runtimeId));
  }
  return lines.join("\n").trim();
}

function renderRuntimeOnlyText(bundles, runtimeId) {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    return "";
  }
  const lines = [`Runtime skill catalog for ${runtimeId}:`];
  for (const bundle of bundles) {
    lines.push(
      `- ${bundle.id}: adapter=${bundle.adapterPathByRuntime[runtimeId] || "none"} manifest=${bundle.manifestPath}`,
    );
  }
  return lines.join("\n").trim();
}

function defaultDeployEnvironmentKind(wave) {
  const environments = Array.isArray(wave?.deployEnvironments) ? wave.deployEnvironments : [];
  if (environments.length === 0) {
    return null;
  }
  return (
    environments.find((environment) => environment.isDefault)?.kind || environments[0]?.kind || null
  );
}

function buildPromptHash({ ids, role, runtimeId, deployKind, promptText, bundles }) {
  return hashText(
    JSON.stringify({
      ids,
      role,
      runtimeId,
      deployKind,
      promptText,
      bundles: bundles.map((bundle) => ({
        id: bundle.id,
        bundleHash: bundle.bundleHash,
        adapterPath: bundle.adapterPathByRuntime[runtimeId || "local"] || null,
        activation: bundle.activation,
        termination: bundle.termination,
        permissions: bundle.permissions,
        trust: bundle.trust,
        referencePaths: bundle.referencePaths,
      })),
    }),
  );
}

export function resolveSkillIdsForAgent(agent, wave, laneProfile) {
  const skillsConfig = laneProfile?.skills || emptySkillsConfig();
  const role = cleanText(agent?.executorResolved?.role).toLowerCase() || null;
  const runtimeId = cleanText(agent?.executorResolved?.id).toLowerCase() || null;
  const deployKind = cleanText(defaultDeployEnvironmentKind(wave)).toLowerCase() || null;
  const configuredIds = uniqueStrings([
    ...(skillsConfig.base || []),
    ...(role ? skillsConfig.byRole?.[role] || [] : []),
    ...(runtimeId ? skillsConfig.byRuntime?.[runtimeId] || [] : []),
    ...(deployKind ? skillsConfig.byDeployKind?.[deployKind] || [] : []),
  ]).map((skillId) => normalizeSkillId(skillId));
  const explicitIds = normalizeSkillIdArray(agent?.skills, "agent.skills");
  return {
    role,
    runtimeId,
    deployKind,
    configuredIds,
    explicitIds,
    ids: uniqueStrings([...configuredIds, ...explicitIds]).map((skillId) => normalizeSkillId(skillId)),
  };
}

export function resolveAgentSkills(agent, wave, options = {}) {
  const laneProfile = options.laneProfile || {};
  const skillsConfig = laneProfile.skills || emptySkillsConfig();
  const { configuredIds, explicitIds, role, runtimeId, deployKind } = resolveSkillIdsForAgent(
    agent,
    wave,
    laneProfile,
  );
  const resolvedRuntimeId = runtimeId || "local";
  const bundleCache = new Map();
  const loadBundleCached = (skillId) => {
    if (!bundleCache.has(skillId)) {
      bundleCache.set(skillId, loadSkillBundle(skillId, { skillsDir: skillsConfig.dir }));
    }
    return bundleCache.get(skillId);
  };
  const activeConfiguredBundles = configuredIds
    .map((skillId) => loadBundleCached(skillId))
    .filter((bundle) =>
      skillMatchesActivation(bundle, {
        role,
        runtimeId: resolvedRuntimeId,
        deployKind,
      }),
    );
  const explicitBundles = explicitIds.map((skillId) => loadBundleCached(skillId));
  const bundles = [];
  const seen = new Set();
  for (const bundle of [...activeConfiguredBundles, ...explicitBundles]) {
    if (seen.has(bundle.id)) {
      continue;
    }
    seen.add(bundle.id);
    bundles.push(bundle);
  }
  const promptText = renderSkillPromptText(bundles, resolvedRuntimeId);
  const expandedPromptText = renderExpandedSkillText(bundles, resolvedRuntimeId);
  const runtimeText = renderRuntimeOnlyText(bundles, resolvedRuntimeId);
  return {
    dir: skillsConfig.dir,
    ids: bundles.map((bundle) => bundle.id),
    role,
    runtime: runtimeId,
    deployKind,
    promptText,
    expandedPromptText,
    promptHash: buildPromptHash({
      ids: bundles.map((bundle) => bundle.id),
      role,
      runtimeId: resolvedRuntimeId,
      deployKind,
      promptText,
      bundles,
    }),
    runtimeText,
    bundles: bundles.map((bundle) => ({
      id: bundle.id,
      title: bundle.title,
      description: bundle.description,
      version: bundle.version,
      tags: bundle.tags,
      activation: bundle.activation,
      termination: bundle.termination,
      permissions: bundle.permissions,
      trust: bundle.trust,
      evalCases: bundle.evalCases,
      bundlePath: bundle.bundlePath,
      manifestPath: bundle.manifestPath,
      skillPath: bundle.skillPath,
      adapterPath: bundle.adapterPathByRuntime[resolvedRuntimeId] || null,
      referencePaths: bundle.referencePaths,
      bundleHash: bundle.bundleHash,
      sourceFiles: bundle.sourceFiles.map((entry) => entry.path),
    })),
    codexAddDirs: uniqueStrings(bundles.map((bundle) => bundle.bundlePath), { lowerCase: false }),
    opencodeFiles: uniqueStrings(
      bundles.flatMap((bundle) => [
        bundle.manifestPath,
        bundle.skillPath,
        bundle.adapterPathByRuntime[resolvedRuntimeId] || null,
        ...bundle.referencePaths,
      ]),
      { lowerCase: false },
    ),
    opencodeInstructions: promptText ? [promptText] : [],
  };
}

export function summarizeResolvedSkills(resolvedSkills) {
  if (!resolvedSkills || typeof resolvedSkills !== "object") {
    return {
      ids: [],
      role: null,
      runtime: null,
      deployKind: null,
      promptHash: null,
      bundles: [],
      artifacts: null,
    };
  }
  return {
    ids: Array.isArray(resolvedSkills.ids) ? resolvedSkills.ids.slice() : [],
    role: resolvedSkills.role || null,
    runtime: resolvedSkills.runtime || null,
    deployKind: resolvedSkills.deployKind || null,
    promptHash: resolvedSkills.promptHash || null,
    bundles: Array.isArray(resolvedSkills.bundles)
      ? resolvedSkills.bundles.map((bundle) => ({
          id: bundle.id,
          title: bundle.title || null,
          description: bundle.description || null,
          version: bundle.version || null,
          tags: Array.isArray(bundle.tags) ? bundle.tags.slice() : [],
          activation: bundle.activation || null,
          termination: bundle.termination || null,
          permissions: bundle.permissions || null,
          trust: bundle.trust || null,
          evalCases: Array.isArray(bundle.evalCases) ? bundle.evalCases.slice() : [],
          bundlePath: bundle.bundlePath,
          manifestPath: bundle.manifestPath,
          skillPath: bundle.skillPath,
          adapterPath: bundle.adapterPath || null,
          referencePaths: Array.isArray(bundle.referencePaths) ? bundle.referencePaths.slice() : [],
          bundleHash: bundle.bundleHash || null,
          sourceFiles: Array.isArray(bundle.sourceFiles) ? bundle.sourceFiles.slice() : [],
        }))
      : [],
    artifacts: resolvedSkills.artifacts || null,
  };
}

export function writeResolvedSkillArtifacts(overlayDir, resolvedSkills) {
  if (!resolvedSkills || !Array.isArray(resolvedSkills.ids) || resolvedSkills.ids.length === 0) {
    return null;
  }
  const promptPath = path.join(overlayDir, "skills.resolved.md");
  const expandedPromptPath = path.join(overlayDir, "skills.expanded.md");
  const metadataPath = path.join(overlayDir, "skills.metadata.json");
  const runtimePromptPath =
    resolvedSkills.runtime ? path.join(overlayDir, `${resolvedSkills.runtime}-skills.txt`) : null;
  const artifacts = {
    promptPath: repoRelativePath(promptPath),
    expandedPromptPath: repoRelativePath(expandedPromptPath),
    metadataPath: repoRelativePath(metadataPath),
    runtimePromptPath: runtimePromptPath ? repoRelativePath(runtimePromptPath) : null,
  };
  writeTextAtomic(promptPath, `${resolvedSkills.promptText}\n`);
  writeTextAtomic(expandedPromptPath, `${resolvedSkills.expandedPromptText || resolvedSkills.promptText}\n`);
  if (runtimePromptPath) {
    writeTextAtomic(runtimePromptPath, `${resolvedSkills.runtimeText || resolvedSkills.promptText}\n`);
  }
  writeJsonAtomic(
    metadataPath,
    summarizeResolvedSkills({
      ...resolvedSkills,
      artifacts,
    }),
  );
  return artifacts;
}

export function validateLaneSkillConfiguration(laneProfile, options = {}) {
  const skillsConfig = laneProfile?.skills || emptySkillsConfig();
  const allowedDeployKinds = new Set([
    ...SUPPORTED_SKILL_DEPLOY_KINDS,
    ...(Array.isArray(options.allowedDeployKinds) ? options.allowedDeployKinds : []),
  ]);
  const allSkillIds = uniqueStrings([
    ...listSkillBundleIds(skillsConfig.dir || DEFAULT_SKILLS_DIR),
    ...(skillsConfig.base || []),
    ...Object.values(skillsConfig.byRole || {}).flat(),
    ...Object.values(skillsConfig.byRuntime || {}).flat(),
    ...Object.values(skillsConfig.byDeployKind || {}).flat(),
  ]).map((skillId) => normalizeSkillId(skillId));
  const errors = [];
  const bundles = new Map();
  const loadBundleSafe = (skillId) => {
    if (bundles.has(skillId)) {
      return bundles.get(skillId);
    }
    try {
      const bundle = loadSkillBundle(skillId, { skillsDir: skillsConfig.dir });
      bundles.set(skillId, bundle);
      return bundle;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  for (const skillId of allSkillIds) {
    loadBundleSafe(skillId);
  }
  for (const [role, skillIds] of Object.entries(skillsConfig.byRole || {})) {
    for (const skillId of skillIds) {
      const bundle = loadBundleSafe(skillId);
      if (!bundle) {
        continue;
      }
      if (bundle.activation.roles.length > 0 && !bundle.activation.roles.includes(role)) {
        errors.push(
          `Skill "${skillId}" is configured under skills.byRole.${role} but manifest activation.roles excludes "${role}"`,
        );
      }
    }
  }
  for (const [runtimeId, skillIds] of Object.entries(skillsConfig.byRuntime || {})) {
    for (const skillId of skillIds) {
      const bundle = loadBundleSafe(skillId);
      if (!bundle) {
        continue;
      }
      if (
        bundle.activation.runtimes.length > 0 &&
        !bundle.activation.runtimes.includes(runtimeId)
      ) {
        errors.push(
          `Skill "${skillId}" is configured under skills.byRuntime.${runtimeId} but manifest activation.runtimes excludes "${runtimeId}"`,
        );
      }
    }
  }
  for (const [deployKind, skillIds] of Object.entries(skillsConfig.byDeployKind || {})) {
    if (!allowedDeployKinds.has(deployKind)) {
      errors.push(
        `skills.byDeployKind.${deployKind} is not a supported selector key for this lane`,
      );
      continue;
    }
    for (const skillId of skillIds) {
      const bundle = loadBundleSafe(skillId);
      if (!bundle) {
        continue;
      }
      if (
        bundle.activation.deployKinds.length > 0 &&
        !bundle.activation.deployKinds.includes(deployKind)
      ) {
        errors.push(
          `Skill "${skillId}" is configured under skills.byDeployKind.${deployKind} but manifest activation.deployKinds excludes "${deployKind}"`,
        );
      }
    }
  }
  let evaluatedCases = 0;
  for (const bundle of bundles.values()) {
    const evalResult = evaluateSkillBundleCases(bundle);
    errors.push(...evalResult.errors);
    evaluatedCases += evalResult.evaluatedCases;
  }
  return {
    ok: errors.length === 0,
    errors,
    evaluatedBundles: bundles.size,
    evaluatedCases,
  };
}
