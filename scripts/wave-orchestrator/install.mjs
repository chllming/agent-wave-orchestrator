import fs from "node:fs";
import path from "node:path";
import {
  applyContext7SelectionsToWave,
  loadContext7BundleIndex,
} from "./context7.mjs";
import { buildLanePaths, ensureDirectory, PACKAGE_ROOT, readJsonOrNull, REPO_ROOT, writeJsonAtomic } from "./shared.mjs";
import { loadWaveConfig } from "./config.mjs";
import { applyExecutorSelectionsToWave, parseWaveFiles, validateWaveDefinition } from "./wave-files.mjs";
import { validateLaneSkillConfiguration } from "./skills.mjs";

export const INSTALL_STATE_SCHEMA_VERSION = 1;
export const INSTALL_STATE_DIR = ".wave";
export const INSTALL_STATE_PATH = path.join(REPO_ROOT, INSTALL_STATE_DIR, "install-state.json");
export const UPGRADE_HISTORY_DIR = path.join(REPO_ROOT, INSTALL_STATE_DIR, "upgrade-history");
export const CHANGELOG_MANIFEST_PATH = path.join(PACKAGE_ROOT, "releases", "manifest.json");
export const PACKAGE_METADATA_PATH = path.join(PACKAGE_ROOT, "package.json");
export const STARTER_TEMPLATE_PATHS = [
  "wave.config.json",
  "docs/README.md",
  "docs/agents/wave-documentation-role.md",
  "docs/agents/wave-cont-qa-role.md",
  "docs/agents/wave-cont-eval-role.md",
  "docs/agents/wave-integration-role.md",
  "docs/agents/wave-security-role.md",
  "docs/concepts/context7-vs-skills.md",
  "docs/concepts/operating-modes.md",
  "docs/concepts/runtime-agnostic-orchestration.md",
  "docs/concepts/what-is-a-wave.md",
  "docs/context7/bundles.json",
  "docs/evals/benchmark-catalog.json",
  "docs/guides/planner.md",
  "docs/guides/terminal-surfaces.md",
  "docs/plans/component-cutover-matrix.json",
  "docs/plans/component-cutover-matrix.md",
  "docs/plans/context7-wave-orchestrator.md",
  "docs/plans/current-state.md",
  "docs/plans/master-plan.md",
  "docs/plans/migration.md",
  "docs/plans/wave-orchestrator.md",
  "docs/plans/waves/wave-0.md",
  "docs/reference/repository-guidance.md",
  "docs/reference/skills.md",
  "docs/reference/runtime-config/README.md",
  "docs/reference/runtime-config/codex.md",
  "docs/reference/runtime-config/claude.md",
  "docs/reference/runtime-config/opencode.md",
  "docs/research/agent-context-sources.md",
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
  const payload = readJsonOrNull(PACKAGE_METADATA_PATH);
  if (!payload?.name || !payload?.version) {
    throw new Error(`Invalid package metadata: ${PACKAGE_METADATA_PATH}`);
  }
  return payload;
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
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function nextHistoryRecord(existingState, entry) {
  const history = Array.isArray(existingState?.history) ? existingState.history.slice(0, 50) : [];
  history.push(entry);
  return history;
}

function normalizeVersionParts(version) {
  return String(version || "")
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ""), 10) || 0);
}

function compareVersions(a, b) {
  const left = normalizeVersionParts(a);
  const right = normalizeVersionParts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
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
    ...(report.doctor.errors.length > 0 || report.doctor.warnings.length > 0
      ? [
          "",
          "## Follow-Up",
          "",
          ...report.doctor.errors.map((issue) => `- Error: ${issue}`),
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
      let parsedWaves = [];
      if (fs.existsSync(lanePaths.wavesDir)) {
        const context7BundleIndex = loadContext7BundleIndex(lanePaths.context7BundleIndexPath);
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

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function printHelp() {
  console.log(`Usage:
  wave init [--adopt-existing] [--json]
  wave upgrade [--json]
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
