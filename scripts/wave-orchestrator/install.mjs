import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  applyContext7SelectionsToWave,
  loadContext7BundleIndex,
} from "./context7.mjs";
import {
  PLANNER_CONTEXT7_TEMPLATE_PATHS,
} from "./planner-context.mjs";
import { buildLanePaths, ensureDirectory, PACKAGE_ROOT, readJsonOrNull, REPO_ROOT, writeJsonAtomic } from "./shared.mjs";
import { fetchLatestPackageVersion } from "./package-update-notice.mjs";
import {
  compareVersions,
  readInstalledPackageMetadata,
  WAVE_PACKAGE_NAME,
} from "./package-version.mjs";
import { loadWaveConfig } from "./config.mjs";
import { applyExecutorSelectionsToWave, parseWaveFiles, validateWaveDefinition } from "./wave-files.mjs";
import { validateLaneSkillConfiguration } from "./skills.mjs";

export const INSTALL_STATE_SCHEMA_VERSION = 1;
export const INSTALL_STATE_DIR = ".wave";
export const INSTALL_STATE_PATH = path.join(REPO_ROOT, INSTALL_STATE_DIR, "install-state.json");
export const UPGRADE_HISTORY_DIR = path.join(REPO_ROOT, INSTALL_STATE_DIR, "upgrade-history");
export const CHANGELOG_MANIFEST_PATH = path.join(PACKAGE_ROOT, "releases", "manifest.json");
export const WORKSPACE_PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
export const STARTER_TEMPLATE_PATHS = [
  "wave.config.json",
  "docs/README.md",
  "docs/agents/wave-documentation-role.md",
  "docs/agents/wave-design-role.md",
  "docs/agents/wave-cont-qa-role.md",
  "docs/agents/wave-cont-eval-role.md",
  "docs/agents/wave-integration-role.md",
  "docs/agents/wave-planner-role.md",
  "docs/agents/wave-security-role.md",
  "docs/concepts/context7-vs-skills.md",
  "docs/concepts/operating-modes.md",
  "docs/concepts/runtime-agnostic-orchestration.md",
  "docs/concepts/what-is-a-wave.md",
  "docs/context7/bundles.json",
  "docs/evals/benchmark-catalog.json",
  "docs/evals/external-benchmarks.json",
  "docs/evals/external-command-config.sample.json",
  "docs/evals/external-command-config.swe-bench-pro.json",
  "docs/evals/wave-benchmark-program.md",
  "docs/evals/pilots/README.md",
  "docs/evals/pilots/swe-bench-pro-public-pilot.json",
  "docs/evals/pilots/swe-bench-pro-public-full-wave-review-10.json",
  "docs/evals/arm-templates/README.md",
  "docs/evals/arm-templates/single-agent.json",
  "docs/evals/arm-templates/full-wave.json",
  "docs/evals/cases/README.md",
  "docs/evals/cases/wave-hidden-profile-private-evidence.json",
  "docs/evals/cases/wave-premature-closure-guard.json",
  "docs/evals/cases/wave-silo-cross-agent-state.json",
  "docs/evals/cases/wave-blackboard-inbox-targeting.json",
  "docs/evals/cases/wave-contradiction-conflict.json",
  "docs/evals/cases/wave-simultaneous-lockstep.json",
  "docs/evals/cases/wave-expert-routing-preservation.json",
  "docs/guides/planner.md",
  "docs/guides/terminal-surfaces.md",
  "docs/plans/component-cutover-matrix.json",
  "docs/plans/component-cutover-matrix.md",
  "docs/plans/context7-wave-orchestrator.md",
  "docs/plans/current-state.md",
  "docs/plans/examples/wave-example-live-proof.md",
  "docs/plans/master-plan.md",
  "docs/plans/migration.md",
  "docs/plans/wave-orchestrator.md",
  "docs/plans/waves/wave-0.md",
  "docs/reference/live-proof-waves.md",
  "docs/reference/repository-guidance.md",
  "docs/reference/sample-waves.md",
  "docs/reference/skills.md",
  "docs/reference/wave-planning-lessons.md",
  "skills/role-design/SKILL.md",
  "skills/role-design/skill.json",
  "docs/reference/runtime-config/README.md",
  "docs/reference/runtime-config/codex.md",
  "docs/reference/runtime-config/claude.md",
  "docs/reference/runtime-config/opencode.md",
  "docs/research/coordination-failure-review.md",
  "docs/research/agent-context-sources.md",
  "docs/plans/examples/wave-benchmark-improvement.md",
  ...PLANNER_CONTEXT7_TEMPLATE_PATHS,
];
const REQUIRED_GITIGNORE_ENTRIES = [
  ".tmp/",
  ".wave/",
  ".vscode/terminals.json",
  "docs/research/cache/",
  "docs/research/agent-context-cache/",
  "docs/research/papers/",
  "docs/research/articles/",
];
const PLANNER_MIGRATION_REQUIRED_SURFACES = [
  {
    id: "planner-role",
    label: "docs/agents/wave-planner-role.md",
    path: "docs/agents/wave-planner-role.md",
    kind: "file",
  },
  {
    id: "planner-skill",
    label: "skills/role-planner/",
    path: "skills/role-planner",
    kind: "dir",
  },
  {
    id: "planner-context7",
    label: "docs/context7/planner-agent/",
    path: "docs/context7/planner-agent",
    kind: "dir",
  },
  {
    id: "planner-lessons",
    label: "docs/reference/wave-planning-lessons.md",
    path: "docs/reference/wave-planning-lessons.md",
    kind: "file",
  },
];
const PLANNER_REQUIRED_BUNDLE_ID = "planner-agentic";

function collectDeclaredDeployKinds(waves = []) {
  return Array.from(
    new Set(
      (Array.isArray(waves) ? waves : [])
        .flatMap((wave) => wave?.deployEnvironments || [])
        .map((environment) => String(environment?.kind || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();
}

function packageMetadata() {
  return readInstalledPackageMetadata();
}

function readInstallState() {
  const payload = readJsonOrNull(INSTALL_STATE_PATH);
  return payload && typeof payload === "object" ? payload : null;
}

function writeInstallState(state) {
  ensureDirectory(path.dirname(INSTALL_STATE_PATH));
  writeJsonAtomic(INSTALL_STATE_PATH, state);
  return INSTALL_STATE_PATH;
}

function ensureWorkspaceSubdir(relPath) {
  const target = path.join(REPO_ROOT, relPath);
  ensureDirectory(target);
  return target;
}

function templateStatusList() {
  return starterTemplatePaths().map((relPath) => ({
    path: relPath,
    sourcePath: path.join(PACKAGE_ROOT, relPath),
    targetPath: path.join(REPO_ROOT, relPath),
    exists: fs.existsSync(path.join(REPO_ROOT, relPath)),
  }));
}

function starterSkillTemplatePaths() {
  const skillsRoot = path.join(PACKAGE_ROOT, "skills");
  if (!fs.existsSync(skillsRoot)) {
    return [];
  }
  const files = [];
  const visit = (targetDir) => {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      const fullPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else {
        files.push(path.relative(PACKAGE_ROOT, fullPath).replaceAll(path.sep, "/"));
      }
    }
  };
  visit(skillsRoot);
  return files.toSorted();
}

function starterTemplatePaths() {
  return [...STARTER_TEMPLATE_PATHS, ...starterSkillTemplatePaths()];
}

function existingBootstrapMarkers() {
  return templateStatusList()
    .filter((entry) => entry.exists)
    .map((entry) => entry.path);
}

function copyTemplateFile(relPath) {
  const sourcePath = path.join(PACKAGE_ROOT, relPath);
  const targetPath = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing packaged template: ${relPath}`);
  }
  ensureDirectory(path.dirname(targetPath));
  if (relPath === "docs/plans/component-cutover-matrix.json") {
    const payload = readJsonOrNull(sourcePath);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`Invalid packaged template JSON: ${relPath}`);
    }
    const components = Object.fromEntries(
      Object.entries(payload.components || {}).map(([componentId, component]) => [
        componentId,
        {
          ...component,
          promotions: Array.isArray(component?.promotions)
            ? component.promotions.filter((entry) => Number(entry?.wave) === 0)
            : [],
        },
      ]),
    );
    writeJsonAtomic(targetPath, {
      ...payload,
      components,
    });
    return targetPath;
  }
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function nextHistoryRecord(existingState, entry) {
  const history = Array.isArray(existingState?.history) ? existingState.history.slice(0, 50) : [];
  history.push(entry);
  return history;
}

function readChangelogManifest() {
  const payload = readJsonOrNull(CHANGELOG_MANIFEST_PATH);
  if (!payload?.releases || !Array.isArray(payload.releases)) {
    throw new Error(`Invalid changelog manifest: ${CHANGELOG_MANIFEST_PATH}`);
  }
  return payload;
}

function releasesBetween(manifest, fromVersion, toVersion) {
  return manifest.releases.filter((release) => {
    if (!release?.version) {
      return false;
    }
    const afterStart = !fromVersion || compareVersions(release.version, fromVersion) > 0;
    const beforeEnd = !toVersion || compareVersions(release.version, toVersion) <= 0;
    return afterStart && beforeEnd;
  });
}

function renderReleaseNotes(releases) {
  if (releases.length === 0) {
    return ["- No packaged release notes in the selected range."];
  }
  return releases.flatMap((release) => [
    `### ${release.version} (${release.date || "undated"})`,
    release.summary ? `- Summary: ${release.summary}` : null,
    ...(Array.isArray(release.features) && release.features.length > 0
      ? release.features.map((feature) => `- ${feature}`)
      : ["- No feature bullets recorded."]),
    ...(Array.isArray(release.manualSteps) && release.manualSteps.length > 0
      ? release.manualSteps.map((step) => `- Manual step: ${step}`)
      : []),
    "",
  ]).filter(Boolean);
}

function slugifyVersion(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function formatUpgradeReport(report) {
  const plannerMigrationErrors = report.doctor.errors.filter((issue) => isPlannerMigrationIssue(issue));
  const otherDoctorErrors = report.doctor.errors.filter((issue) => !isPlannerMigrationIssue(issue));
  return [
    `# Wave Upgrade Report`,
    "",
    `- Workspace root: \`${REPO_ROOT}\``,
    `- Package: \`${report.packageName}\``,
    `- Previous version: \`${report.previousVersion || "unknown"}\``,
    `- Current version: \`${report.currentVersion}\``,
    `- Generated: ${report.generatedAt}`,
    "",
    "## Release Notes",
    "",
    ...renderReleaseNotes(report.releases),
    "## Workspace Impact",
    "",
    "- No repo-owned plans, waves, role prompts, or config files were overwritten.",
    "- New runtime behavior comes from the installed package version.",
    ...(report.initMode === "adopt-existing" && plannerMigrationErrors.length > 0
      ? [
          "",
          "## Adopted Repo Follow-Up",
          "",
          "- This workspace was adopted from an existing repo-owned Wave surface.",
          "- `wave upgrade` does not copy new planner starter docs, skills, or Context7 bundle entries into adopted repos.",
          ...plannerMigrationErrors.map((issue) => `- Error: ${issue}`),
        ]
      : []),
    ...(report.initMode === "adopt-existing" && plannerMigrationErrors.length > 0
      ? [
          "- After syncing that planner surface, rerun `pnpm exec wave doctor` before relying on `wave draft --agentic` or planner-aware validation.",
        ]
      : []),
    ...(report.doctor.errors.length > 0 || report.doctor.warnings.length > 0
      ? [
          "",
          "## Follow-Up",
          "",
          ...otherDoctorErrors.map((issue) => `- Error: ${issue}`),
          ...report.doctor.warnings.map((issue) => `- Warning: ${issue}`),
        ]
      : []),
    "",
  ].join("\n");
}

function gitignoreWarnings() {
  const gitignorePath = path.join(REPO_ROOT, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return ['Missing `.gitignore`; add Wave runtime ignores before running real waves.'];
  }
  const content = fs.readFileSync(gitignorePath, "utf8");
  return REQUIRED_GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry)).map(
    (entry) => `Missing recommended .gitignore entry: ${entry}`,
  );
}

function plannerRequiredPaths() {
  return Array.from(
    new Set(
      [
        "docs/agents/wave-planner-role.md",
        "docs/reference/wave-planning-lessons.md",
        "skills/role-planner/SKILL.md",
        ...PLANNER_CONTEXT7_TEMPLATE_PATHS,
      ].filter(Boolean),
    ),
  ).sort();
}

function isPlannerMigrationIssue(issue) {
  return String(issue || "").startsWith("Planner starter surface is incomplete");
}

function missingPlannerMigrationSurfaceLabels() {
  const missing = [];
  for (const surface of PLANNER_MIGRATION_REQUIRED_SURFACES) {
    const targetPath = path.join(REPO_ROOT, surface.path);
    if (!fs.existsSync(targetPath)) {
      missing.push(surface.label);
      continue;
    }
    if (surface.kind === "dir") {
      try {
        if (fs.readdirSync(targetPath).length === 0) {
          missing.push(surface.label);
        }
      } catch {
        missing.push(surface.label);
      }
    }
  }
  return missing;
}

function plannerMigrationIssue(config, context7BundleIndex) {
  const missing = missingPlannerMigrationSurfaceLabels();
  const bundleId = String(config?.planner?.agentic?.context7Bundle || "").trim();
  const bundleEntryMissing =
    bundleId === "" || bundleId === PLANNER_REQUIRED_BUNDLE_ID
      ? !context7BundleIndex?.bundles?.[PLANNER_REQUIRED_BUNDLE_ID]
      : false;
  if (missing.length === 0 && !bundleEntryMissing) {
    return null;
  }
  const remediationItems = missing.slice();
  if (bundleEntryMissing) {
    remediationItems.push(`docs/context7/bundles.json#${PLANNER_REQUIRED_BUNDLE_ID}`);
  }
  return `Planner starter surface is incomplete for 0.7.x workspaces. Sync ${remediationItems.join(", ")} from the packaged release, then rerun \`pnpm exec wave doctor\`.`;
}

export function runDoctor() {
  const errors = [];
  const warnings = [];
  const installState = readInstallState();
  const metadata = packageMetadata();

  if (!installState) {
    errors.push("Workspace is not initialized. Run `pnpm exec wave init` or `pnpm exec wave init --adopt-existing`.");
  }

  let config = null;
  try {
    config = loadWaveConfig();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (config) {
    try {
      const lanePaths = buildLanePaths(config.defaultLane, { config });
      if (!fs.existsSync(path.join(REPO_ROOT, "wave.config.json"))) {
        errors.push("Missing wave.config.json.");
      }
      const missingSharedPlanDocs = lanePaths.sharedPlanDocs.filter(
        (docPath) => !fs.existsSync(path.join(REPO_ROOT, docPath)),
      );
      for (const docPath of missingSharedPlanDocs) {
        errors.push(`Missing shared plan doc: ${docPath}`);
      }
      for (const requiredPath of [
        lanePaths.contQaRolePromptPath,
        lanePaths.contEvalRolePromptPath,
        lanePaths.integrationRolePromptPath,
        lanePaths.documentationRolePromptPath,
        lanePaths.benchmarkCatalogPath.replace(`${REPO_ROOT}${path.sep}`, ""),
        lanePaths.context7BundleIndexPath.replace(`${REPO_ROOT}${path.sep}`, ""),
      ]) {
        const relPath = path.isAbsolute(requiredPath)
          ? path.relative(REPO_ROOT, requiredPath)
          : requiredPath;
        if (!fs.existsSync(path.join(REPO_ROOT, relPath))) {
          errors.push(`Missing required Wave file: ${relPath}`);
        }
      }
      const context7BundleIndex = loadContext7BundleIndex(lanePaths.context7BundleIndexPath);
      const plannerMigration = plannerMigrationIssue(config, context7BundleIndex);
      if (plannerMigration) {
        errors.push(plannerMigration);
      }
      const plannerPaths = plannerRequiredPaths();
      for (const relPath of plannerPaths) {
        if (!fs.existsSync(path.join(REPO_ROOT, relPath)) && !plannerMigration) {
          errors.push(`Missing planner file: ${relPath}`);
        }
      }
      const plannerBundleId = String(config.planner?.agentic?.context7Bundle || "").trim();
      if (
        plannerBundleId &&
        !context7BundleIndex.bundles[plannerBundleId] &&
        !(plannerMigration && plannerBundleId === PLANNER_REQUIRED_BUNDLE_ID)
      ) {
        errors.push(
          `planner.agentic.context7Bundle references unknown bundle "${plannerBundleId}".`,
        );
      }
      let parsedWaves = [];
      if (fs.existsSync(lanePaths.wavesDir)) {
        parsedWaves = parseWaveFiles(lanePaths.wavesDir, { laneProfile: lanePaths.laneProfile })
          .map((wave) =>
            applyExecutorSelectionsToWave(wave, {
              laneProfile: lanePaths.laneProfile,
              executorMode: lanePaths.executors.default,
              codexSandboxMode: lanePaths.executors.codex.sandbox,
            }),
          )
          .map((wave) =>
            applyContext7SelectionsToWave(wave, {
              lane: lanePaths.lane,
              bundleIndex: context7BundleIndex,
            }),
          );
        const skillValidation = validateLaneSkillConfiguration(lanePaths.laneProfile, {
          allowedDeployKinds: collectDeclaredDeployKinds(parsedWaves),
        });
        if (!skillValidation.ok) {
          errors.push(...skillValidation.errors);
        }
        parsedWaves.forEach((wave) => validateWaveDefinition(wave, { laneProfile: lanePaths.laneProfile }));
      } else {
        const skillValidation = validateLaneSkillConfiguration(lanePaths.laneProfile);
        if (!skillValidation.ok) {
          errors.push(...skillValidation.errors);
        }
        warnings.push(`No waves directory found at ${path.relative(REPO_ROOT, lanePaths.wavesDir)}.`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  warnings.push(...gitignoreWarnings());
  if (installState?.installedVersion && compareVersions(metadata.version, installState.installedVersion) !== 0) {
    warnings.push(
      `Installed package version is ${metadata.version} but install-state records ${installState.installedVersion}; run \`pnpm exec wave upgrade\`.`,
    );
  }

  return {
    ok: errors.length === 0,
    workspaceRoot: REPO_ROOT,
    packageName: metadata.name,
    packageVersion: metadata.version,
    errors,
    warnings,
  };
}

export function initializeWorkspace(options = {}) {
  const adoptExisting = Boolean(options.adoptExisting);
  const existingState = readInstallState();
  const metadata = packageMetadata();
  const markers = existingBootstrapMarkers();

  if (existingState) {
    return {
      mode: "already-initialized",
      seededFiles: [],
      adoptedFiles: existingState.adoptedFiles || [],
      installStatePath: INSTALL_STATE_PATH,
      state: existingState,
    };
  }

  if (markers.length > 0 && !adoptExisting) {
    throw new Error(
      `Existing Wave bootstrap files detected (${markers.slice(0, 8).join(", ")}). Re-run with \`pnpm exec wave init --adopt-existing\` to record them without overwriting anything.`,
    );
  }

  ensureWorkspaceSubdir(INSTALL_STATE_DIR);
  ensureWorkspaceSubdir(path.join(INSTALL_STATE_DIR, "upgrade-history"));

  const seededFiles = [];
  const adoptedFiles = [];
  if (adoptExisting) {
    adoptedFiles.push(...markers);
  } else {
    for (const relPath of starterTemplatePaths()) {
      copyTemplateFile(relPath);
      seededFiles.push(relPath);
    }
  }

  const now = new Date().toISOString();
  const state = {
    schemaVersion: INSTALL_STATE_SCHEMA_VERSION,
    packageName: metadata.name,
    installedVersion: metadata.version,
    initializedAt: now,
    lastUpgradeAt: now,
    initMode: adoptExisting ? "adopt-existing" : "fresh",
    seededFiles,
    adoptedFiles,
    history: [
      {
        at: now,
        action: adoptExisting ? "init-adopt-existing" : "init-fresh",
        version: metadata.version,
      },
    ],
  };
  writeInstallState(state);
  return {
    mode: state.initMode,
    seededFiles,
    adoptedFiles,
    installStatePath: INSTALL_STATE_PATH,
    state,
  };
}

export function readChangelog(options = {}) {
  const manifest = readChangelogManifest();
  const installState = readInstallState();
  const currentVersion = packageMetadata().version;
  const releases = options.sinceInstalled
    ? releasesBetween(manifest, installState?.installedVersion || null, currentVersion)
    : manifest.releases;
  return {
    packageName: manifest.packageName || packageMetadata().name,
    currentVersion,
    installedVersion: installState?.installedVersion || null,
    releases,
    markdown: [
      "# Wave Package Changelog",
      "",
      ...renderReleaseNotes(releases),
    ].join("\n"),
  };
}

export function upgradeWorkspace() {
  const existingState = readInstallState();
  if (!existingState) {
    throw new Error("Workspace is not initialized. Run `pnpm exec wave init` first.");
  }
  const metadata = packageMetadata();
  const manifest = readChangelogManifest();
  const previousVersion = existingState.installedVersion || null;
  const releases = releasesBetween(manifest, previousVersion, metadata.version);
  const doctor = runDoctor();
  const generatedAt = new Date().toISOString();
  const report = {
    packageName: metadata.name,
    previousVersion,
    currentVersion: metadata.version,
    generatedAt,
    initMode: existingState.initMode || null,
    releases,
    doctor,
  };
  ensureDirectory(UPGRADE_HISTORY_DIR);
  const reportBaseName = `${generatedAt.replace(/[:]/g, "-")}-${slugifyVersion(previousVersion)}-to-${slugifyVersion(metadata.version)}`;
  const markdownPath = path.join(UPGRADE_HISTORY_DIR, `${reportBaseName}.md`);
  const jsonPath = path.join(UPGRADE_HISTORY_DIR, `${reportBaseName}.json`);
  fs.writeFileSync(markdownPath, `${formatUpgradeReport(report)}\n`, "utf8");
  writeJsonAtomic(jsonPath, report);

  const nextState = {
    ...existingState,
    installedVersion: metadata.version,
    lastUpgradeAt: generatedAt,
    lastUpgradeReport: path.relative(REPO_ROOT, markdownPath),
    history: nextHistoryRecord(existingState, {
      at: generatedAt,
      action: "upgrade",
      fromVersion: previousVersion,
      toVersion: metadata.version,
      report: path.relative(REPO_ROOT, markdownPath),
    }),
  };
  writeInstallState(nextState);
  return {
    report,
    markdownPath,
    jsonPath,
    state: nextState,
  };
}

function readWorkspacePackageManifest(workspaceRoot = REPO_ROOT) {
  const payload = readJsonOrNull(path.join(workspaceRoot, "package.json"));
  if (!payload || typeof payload !== "object") {
    throw new Error(`Missing package.json at ${path.join(workspaceRoot, "package.json")}`);
  }
  return payload;
}

function readInstallStateForWorkspace(workspaceRoot = REPO_ROOT) {
  const payload = readJsonOrNull(path.join(workspaceRoot, INSTALL_STATE_DIR, "install-state.json"));
  return payload && typeof payload === "object" ? payload : null;
}

function parsePackageManagerId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("pnpm@")) {
    return "pnpm";
  }
  if (normalized.startsWith("npm@")) {
    return "npm";
  }
  if (normalized.startsWith("yarn@")) {
    return "yarn";
  }
  if (normalized.startsWith("bun@")) {
    return "bun";
  }
  return null;
}

export function detectWorkspacePackageManager(workspaceRoot = REPO_ROOT) {
  const manifest = readWorkspacePackageManifest(workspaceRoot);
  const packageManagerFromManifest = parsePackageManagerId(manifest.packageManager);
  if (packageManagerFromManifest) {
    return {
      id: packageManagerFromManifest,
      source: "packageManager",
      raw: manifest.packageManager,
    };
  }
  for (const [fileName, id] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
  ]) {
    if (fs.existsSync(path.join(workspaceRoot, fileName))) {
      return {
        id,
        source: "lockfile",
        raw: fileName,
      };
    }
  }
  return {
    id: "npm",
    source: "default",
    raw: null,
  };
}

function packageManagerCommands(managerId, packageName = WAVE_PACKAGE_NAME) {
  if (managerId === "pnpm") {
    return {
      install: ["pnpm", ["add", "-D", `${packageName}@latest`]],
      execWave: (args) => ["pnpm", ["exec", "wave", ...args]],
    };
  }
  if (managerId === "npm") {
    return {
      install: ["npm", ["install", "--save-dev", `${packageName}@latest`]],
      execWave: (args) => ["npm", ["exec", "--", "wave", ...args]],
    };
  }
  if (managerId === "yarn") {
    return {
      install: ["yarn", ["add", "-D", `${packageName}@latest`]],
      execWave: (args) => ["yarn", ["exec", "wave", ...args]],
    };
  }
  if (managerId === "bun") {
    return {
      install: ["bun", ["add", "-d", `${packageName}@latest`]],
      execWave: (args) => ["bun", ["x", "wave", ...args]],
    };
  }
  throw new Error(`Unsupported package manager: ${managerId}`);
}

function runCommandOrThrow(command, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawnSync;
  const result = spawnImpl(command, args, {
    cwd: options.workspaceRoot || REPO_ROOT,
    stdio: options.stdio || "inherit",
    env: options.env || process.env,
    encoding: "utf8",
  });
  const status = Number.isInteger(result?.status) ? result.status : 1;
  if (status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${status}`);
  }
  return result;
}

export async function selfUpdateWorkspace(options = {}) {
  const workspaceRoot = options.workspaceRoot || REPO_ROOT;
  const metadata = options.packageMetadata || packageMetadata();
  const installState = readInstallStateForWorkspace(workspaceRoot);
  const packageManager = detectWorkspacePackageManager(workspaceRoot);
  const commands = packageManagerCommands(packageManager.id, metadata.name || WAVE_PACKAGE_NAME);
  const emit = options.emit || console.log;
  let latestVersion = null;

  try {
    latestVersion = await fetchLatestPackageVersion(metadata.name || WAVE_PACKAGE_NAME, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    latestVersion = null;
  }

  const currentVersion = String(metadata.version || "").trim();
  const recordedVersion = String(installState?.installedVersion || "").trim() || null;
  const needsUpgradeOnly = recordedVersion && compareVersions(currentVersion, recordedVersion) !== 0;

  emit(`[wave:self-update] package_manager=${packageManager.id}`);

  if (latestVersion && compareVersions(latestVersion, currentVersion) <= 0) {
    if (!needsUpgradeOnly) {
      emit(`[wave:self-update] ${metadata.name} is already current at ${currentVersion}.`);
      return {
        mode: "already-current",
        packageManager: packageManager.id,
        currentVersion,
        latestVersion,
      };
    }
    emit(
      `[wave:self-update] dependency is already at ${currentVersion}; recording workspace upgrade state.`,
    );
    const [upgradeCommand, upgradeArgs] = commands.execWave(["upgrade"]);
    runCommandOrThrow(upgradeCommand, upgradeArgs, options);
    return {
      mode: "upgrade-only",
      packageManager: packageManager.id,
      currentVersion,
      latestVersion,
    };
  }

  emit(
    `[wave:self-update] updating ${metadata.name} from ${currentVersion}${latestVersion ? ` to ${latestVersion}` : " to the latest published version"}.`,
  );
  const [installCommand, installArgs] = commands.install;
  runCommandOrThrow(installCommand, installArgs, options);

  emit("[wave:self-update] release notes since the recorded install:");
  const [changelogCommand, changelogArgs] = commands.execWave(["changelog", "--since-installed"]);
  runCommandOrThrow(changelogCommand, changelogArgs, options);

  emit("[wave:self-update] recording install-state and upgrade report:");
  const [upgradeCommand, upgradeArgs] = commands.execWave(["upgrade"]);
  runCommandOrThrow(upgradeCommand, upgradeArgs, options);

  return {
    mode: "updated",
    packageManager: packageManager.id,
    currentVersion,
    latestVersion,
  };
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function printHelp() {
  console.log(`Usage:
  wave init [--adopt-existing] [--json]
  wave upgrade [--json]
  wave self-update
  wave changelog [--since-installed] [--json]
  wave doctor [--json]
`);
}

export async function runInstallCli(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const subcommand = String(args.shift() || "").trim().toLowerCase();
  const options = {
    adoptExisting: false,
    json: false,
    sinceInstalled: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--adopt-existing") {
      options.adoptExisting = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--since-installed") {
      options.sinceInstalled = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!subcommand) {
    printHelp();
    return;
  }

  if (subcommand === "init") {
    const result = initializeWorkspace({ adoptExisting: options.adoptExisting });
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`[wave:init] mode=${result.mode}`);
    if (result.seededFiles.length > 0) {
      console.log(`[wave:init] seeded files: ${result.seededFiles.join(", ")}`);
    }
    if (result.adoptedFiles.length > 0) {
      console.log(`[wave:init] adopted files: ${result.adoptedFiles.join(", ")}`);
    }
    console.log(`[wave:init] install state: ${path.relative(REPO_ROOT, result.installStatePath)}`);
    return;
  }

  if (subcommand === "upgrade") {
    const result = upgradeWorkspace();
    if (options.json) {
      printJson({
        markdownPath: path.relative(REPO_ROOT, result.markdownPath),
        jsonPath: path.relative(REPO_ROOT, result.jsonPath),
        report: result.report,
      });
      return;
    }
    console.log(`[wave:upgrade] ${result.report.previousVersion || "unknown"} -> ${result.report.currentVersion}`);
    console.log(`[wave:upgrade] report: ${path.relative(REPO_ROOT, result.markdownPath)}`);
    if (result.report.doctor.warnings.length > 0) {
      for (const warning of result.report.doctor.warnings) {
        console.warn(`[wave:upgrade] warning: ${warning}`);
      }
    }
    if (result.report.doctor.errors.length > 0) {
      for (const error of result.report.doctor.errors) {
        console.error(`[wave:upgrade] error: ${error}`);
      }
    }
    return;
  }

  if (subcommand === "self-update") {
    if (options.json) {
      throw new Error("`wave self-update` does not support --json.");
    }
    await selfUpdateWorkspace();
    return;
  }

  if (subcommand === "changelog") {
    const result = readChangelog({ sinceInstalled: options.sinceInstalled });
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(result.markdown);
    return;
  }

  if (subcommand === "doctor") {
    const result = runDoctor();
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`[wave:doctor] workspace=${result.workspaceRoot}`);
    console.log(`[wave:doctor] package=${result.packageName}@${result.packageVersion}`);
    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log("[wave:doctor] ok");
      return;
    }
    for (const error of result.errors) {
      console.error(`[wave:doctor] error: ${error}`);
    }
    for (const warning of result.warnings) {
      console.warn(`[wave:doctor] warning: ${warning}`);
    }
    if (result.errors.length > 0) {
      const error = new Error("Wave doctor found blocking issues.");
      error.exitCode = 1;
      throw error;
    }
    return;
  }

  throw new Error(`Unknown subcommand: ${subcommand}`);
}
