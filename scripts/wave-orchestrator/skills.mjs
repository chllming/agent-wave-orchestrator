import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_ROOT } from "./roots.mjs";

const REPO_ROOT = WORKSPACE_ROOT;

export const DEFAULT_SKILLS_DIR = "skills";
export const SKILL_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
export const SUPPORTED_SKILL_RUNTIMES = ["codex", "claude", "opencode", "local"];

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

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
  );
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

function normalizeSkillMap(rawMap = {}, label) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(rawMap).map(([key, values]) => [
      cleanText(key).toLowerCase(),
      normalizeSkillIdArray(values, `${label}.${key}`),
    ]),
  );
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
  const dir =
    Object.prototype.hasOwnProperty.call(skills, "dir")
      ? normalizeRepoRelativePath(skills.dir || DEFAULT_SKILLS_DIR, `${label}.dir`)
      : options.preserveOmittedDir
        ? null
        : DEFAULT_SKILLS_DIR;
  return {
    dir,
    base: normalizeSkillIdArray(skills.base, `${label}.base`),
    byRole: normalizeSkillMap(skills.byRole, `${label}.byRole`),
    byRuntime: normalizeSkillMap(skills.byRuntime, `${label}.byRuntime`),
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

export function mergeSkillsConfig(baseSkills = emptySkillsConfig(), overrideSkills = emptySkillsConfig()) {
  return {
    dir: overrideSkills.dir || baseSkills.dir || DEFAULT_SKILLS_DIR,
    base: uniqueStrings([...(baseSkills.base || []), ...(overrideSkills.base || [])]).map((skillId) =>
      normalizeSkillId(skillId),
    ),
    byRole: mergeSkillMaps(baseSkills.byRole, overrideSkills.byRole),
    byRuntime: mergeSkillMaps(baseSkills.byRuntime, overrideSkills.byRuntime),
    byDeployKind: mergeSkillMaps(baseSkills.byDeployKind, overrideSkills.byDeployKind),
  };
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

function resolveSkillBundleDir(skillsDir, skillId) {
  return path.join(REPO_ROOT, skillsDir, skillId);
}

export function loadSkillBundle(skillId, options = {}) {
  const normalizedSkillId = normalizeSkillId(skillId);
  const skillsDir = normalizeRepoRelativePath(
    options.skillsDir || DEFAULT_SKILLS_DIR,
    "skills.dir",
  );
  const bundleDir = resolveSkillBundleDir(skillsDir, normalizedSkillId);
  if (!fs.existsSync(bundleDir) || !fs.statSync(bundleDir).isDirectory()) {
    throw new Error(
      `Missing skill bundle "${normalizedSkillId}" in ${repoRelativePath(path.join(REPO_ROOT, skillsDir))}`,
    );
  }
  const manifestPath = path.join(bundleDir, "skill.json");
  const skillPath = path.join(bundleDir, "SKILL.md");
  const manifest = readJsonObject(manifestPath, "skill manifest");
  if (normalizeSkillId(manifest.id || normalizedSkillId, `skills.${normalizedSkillId}.id`) !== normalizedSkillId) {
    throw new Error(
      `Skill manifest id mismatch for ${normalizedSkillId}: expected "${normalizedSkillId}"`,
    );
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
  const sourceFiles = listFilesRecursively(bundleDir).map((filePath) => ({
    path: repoRelativePath(filePath),
    hash: hashBuffer(fs.readFileSync(filePath)),
  }));
  const bundleHash = hashText(
    sourceFiles.map((entry) => `${entry.path}:${entry.hash}`).join("\n"),
  );
  return {
    id: normalizedSkillId,
    title: cleanText(manifest.title) || normalizedSkillId,
    description: cleanText(manifest.description) || cleanText(manifest.summary) || null,
    bundlePath: repoRelativePath(bundleDir),
    manifestPath: repoRelativePath(manifestPath),
    skillPath: repoRelativePath(skillPath),
    skillText,
    adapterPathByRuntime,
    adapterTextByRuntime,
    sourceFiles,
    bundleHash,
  };
}

function renderBundlePrompt(bundle, runtimeId) {
  const lines = [`## Skill ${bundle.id}`];
  if (bundle.description) {
    lines.push(`- Summary: ${bundle.description}`);
  }
  lines.push(`- Bundle: ${bundle.bundlePath}`);
  lines.push("### Canonical instructions");
  lines.push("```text");
  lines.push(bundle.skillText);
  lines.push("```");
  const adapterText = bundle.adapterTextByRuntime[runtimeId];
  if (adapterText) {
    lines.push("");
    lines.push(`### ${runtimeId} adapter`);
    lines.push("```text");
    lines.push(adapterText);
    lines.push("```");
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
    ...bundles.map(
      (bundle) => `- ${bundle.id}${bundle.description ? `: ${bundle.description}` : ""}`,
    ),
    "- Skills are additive guidance. Repository source, standing role prompts, shared summaries, and ownership boundaries remain authoritative.",
    "",
  ];
  for (const bundle of bundles) {
    lines.push(...renderBundlePrompt(bundle, runtimeId));
  }
  return lines.join("\n").trim();
}

function renderRuntimeOnlyText(bundles, runtimeId) {
  const sections = [];
  for (const bundle of bundles) {
    const adapterText = bundle.adapterTextByRuntime[runtimeId];
    if (!adapterText) {
      continue;
    }
    sections.push(`Skill ${bundle.id}`);
    sections.push("```text");
    sections.push(adapterText);
    sections.push("```");
    sections.push("");
  }
  return sections.join("\n").trim();
}

function defaultDeployEnvironmentKind(wave) {
  const environments = Array.isArray(wave?.deployEnvironments) ? wave.deployEnvironments : [];
  if (environments.length === 0) {
    return null;
  }
  return environments.find((environment) => environment.isDefault)?.kind || environments[0]?.kind || null;
}

export function resolveSkillIdsForAgent(agent, wave, laneProfile) {
  const skillsConfig = laneProfile?.skills || emptySkillsConfig();
  const role = cleanText(agent?.executorResolved?.role).toLowerCase() || null;
  const runtimeId = cleanText(agent?.executorResolved?.id).toLowerCase() || null;
  const deployKind = cleanText(defaultDeployEnvironmentKind(wave)).toLowerCase() || null;
  return {
    role,
    runtimeId,
    deployKind,
    ids: uniqueStrings([
      ...(skillsConfig.base || []),
      ...(role ? skillsConfig.byRole?.[role] || [] : []),
      ...(runtimeId ? skillsConfig.byRuntime?.[runtimeId] || [] : []),
      ...(deployKind ? skillsConfig.byDeployKind?.[deployKind] || [] : []),
      ...(Array.isArray(agent?.skills) ? agent.skills : []),
    ]).map((skillId) => normalizeSkillId(skillId)),
  };
}

export function resolveAgentSkills(agent, wave, options = {}) {
  const laneProfile = options.laneProfile || {};
  const skillsConfig = laneProfile.skills || emptySkillsConfig();
  const { ids, role, runtimeId, deployKind } = resolveSkillIdsForAgent(agent, wave, laneProfile);
  const bundles = ids.map((skillId) => loadSkillBundle(skillId, { skillsDir: skillsConfig.dir }));
  const promptText = renderSkillPromptText(bundles, runtimeId || "local");
  const runtimeText = renderRuntimeOnlyText(bundles, runtimeId || "local");
  return {
    dir: skillsConfig.dir,
    ids,
    role,
    runtime: runtimeId,
    deployKind,
    promptText,
    promptHash: hashText(promptText || JSON.stringify({ ids, role, runtimeId, deployKind })),
    runtimeText,
    bundles: bundles.map((bundle) => ({
      id: bundle.id,
      title: bundle.title,
      description: bundle.description,
      bundlePath: bundle.bundlePath,
      manifestPath: bundle.manifestPath,
      skillPath: bundle.skillPath,
      adapterPath: bundle.adapterPathByRuntime[runtimeId] || null,
      bundleHash: bundle.bundleHash,
      sourceFiles: bundle.sourceFiles.map((entry) => entry.path),
    })),
    codexAddDirs: uniqueStrings(bundles.map((bundle) => bundle.bundlePath)),
    opencodeFiles: uniqueStrings(
      bundles.flatMap((bundle) => [
        bundle.skillPath,
        bundle.adapterPathByRuntime[runtimeId] || null,
      ]),
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
          bundlePath: bundle.bundlePath,
          manifestPath: bundle.manifestPath,
          skillPath: bundle.skillPath,
          adapterPath: bundle.adapterPath || null,
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
  const metadataPath = path.join(overlayDir, "skills.metadata.json");
  const runtimePromptPath =
    resolvedSkills.runtime
      ? path.join(overlayDir, `${resolvedSkills.runtime}-skills.txt`)
      : null;
  const artifacts = {
    promptPath: repoRelativePath(promptPath),
    metadataPath: repoRelativePath(metadataPath),
    runtimePromptPath: runtimePromptPath ? repoRelativePath(runtimePromptPath) : null,
  };
  writeTextAtomic(promptPath, `${resolvedSkills.promptText}\n`);
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

export function validateLaneSkillConfiguration(laneProfile) {
  const skillsConfig = laneProfile?.skills || emptySkillsConfig();
  const referencedSkillIds = uniqueStrings([
    ...(skillsConfig.base || []),
    ...Object.values(skillsConfig.byRole || {}).flat(),
    ...Object.values(skillsConfig.byRuntime || {}).flat(),
    ...Object.values(skillsConfig.byDeployKind || {}).flat(),
  ]).map((skillId) => normalizeSkillId(skillId));
  const errors = [];
  for (const skillId of referencedSkillIds) {
    try {
      loadSkillBundle(skillId, { skillsDir: skillsConfig.dir });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}
