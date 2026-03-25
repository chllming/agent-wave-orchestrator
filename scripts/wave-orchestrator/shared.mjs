import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_WAVE_LANE as CONFIG_DEFAULT_WAVE_LANE,
  loadWaveConfig,
  resolveLaneProfile,
} from "./config.mjs";
import { PACKAGE_ROOT, WORKSPACE_ROOT } from "./roots.mjs";

export { PACKAGE_ROOT };
export const REPO_ROOT = WORKSPACE_ROOT;

export const DEFAULT_WAVE_LANE = CONFIG_DEFAULT_WAVE_LANE;
export const DEFAULT_TIMEOUT_MINUTES = 240;
export const DEFAULT_MAX_RETRIES_PER_WAVE = 1;
export const DEFAULT_AGENT_RATE_LIMIT_RETRIES = 2;
export const DEFAULT_AGENT_RATE_LIMIT_BASE_DELAY_SECONDS = 20;
export const DEFAULT_AGENT_RATE_LIMIT_MAX_DELAY_SECONDS = 180;
export const DEFAULT_AGENT_LAUNCH_STAGGER_MS = 1200;
export const DEFAULT_WAIT_PROGRESS_INTERVAL_MS = 3000;
export const DEFAULT_LIVE_COORDINATION_REFRESH_MS = 15000;
export const DEFAULT_COORDINATION_ACK_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_COORDINATION_RESOLUTION_STALE_MS = 30 * 60 * 1000;
export const DEFAULT_REFRESH_MS = 2000;
export const DEFAULT_WATCH_REFRESH_MS = 2000;
export const DEFAULT_WAIT_TIMEOUT_SECONDS = 1800;
export const TMUX_COMMAND_TIMEOUT_MS = 15000;
export const MESSAGEBOARD_PROMPT_MAX_CHARS = 8000;
export const DASHBOARD_MAX_EVENTS = 120;
export const DASHBOARD_MESSAGEBOARD_TAIL_LINES = 28;
export const DASHBOARD_MESSAGEBOARD_TAIL_CHARS = 12000;
export const FINAL_EXIT_DELAY_MS = 15000;
export const LOCK_RETRY_INTERVAL_MS = 50;
export const LOCK_TIMEOUT_MS = 5000;
export const LOCK_STALE_MS = 5 * 60 * 1000;
export const ORCHESTRATOR_DETAIL_MAX_CHARS = 1000;
export const WAVE_TERMINAL_STATES = new Set(["completed", "failed", "timed_out"]);
export const TERMINAL_STATES = new Set(["completed", "failed", "timed_out"]);
export const TERMINAL_ICON = "circuit-board";
export const TERMINAL_COLOR = "terminal.ansiBrightMagenta";
export const DASHBOARD_TERMINAL_ICON = "pulse";
export const DASHBOARD_TERMINAL_COLOR = "terminal.ansiBlue";
export const PHASE_SIGNAL_REGEX = /^\[wave-phase\]\s*([a-z_][a-z0-9_-]*)\s*$/gim;
export const WAVE_VERDICT_REGEX =
  /^\[wave-verdict\]\s*(pass|concerns|blocked|hold|fail)\s*(?:detail=(.*))?$/gim;
export const REPORT_VERDICT_REGEX =
  /^Verdict:\s*(PASS|CONCERNS|BLOCKED|HOLD|FAIL)\b(?:\s*[-:]?\s*(.*))?$/gim;
export const DEPLOY_SIGNAL_REGEX =
  /^\[deploy-status\]\s*service=([a-z0-9_.:-]+)\s+state=(deploying|healthy|failed|rolledover)\s*(?:detail=(.*))?$/gim;
export const INFRA_SIGNAL_REGEX =
  /^\[infra-status\]\s*kind=([a-z0-9_.:-]+)\s+target=([a-z0-9_.:@/-]+)\s+state=([a-z0-9_.:-]+)\s*(?:detail=(.*))?$/gim;

export function sanitizeLaneName(value) {
  const lane = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!lane) {
    throw new Error("Lane name is required");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(lane)) {
    throw new Error(`Invalid lane: ${value}`);
  }
  return lane;
}

export function sanitizeOrchestratorId(value) {
  const id = String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Orchestrator ID is required");
  }
  return id.slice(0, 64);
}

export function sanitizeAdhocRunId(value) {
  const id = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Ad-hoc run ID is required");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid ad-hoc run ID: ${value}`);
  }
  return id;
}

export function buildWorkspaceTmuxToken(workspaceRoot = REPO_ROOT) {
  const repoBase =
    path
      .basename(path.resolve(String(workspaceRoot || REPO_ROOT)))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 12) || "repo";
  const repoHash = crypto
    .createHash("sha1")
    .update(path.resolve(String(workspaceRoot || REPO_ROOT)))
    .digest("hex")
    .slice(0, 8);
  return `${repoBase}_${repoHash}`;
}

function buildTelemetryProjectId(config) {
  return (
    String(config?.waveControl?.projectId || config?.projectId || config?.projectName || path.basename(REPO_ROOT))
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "wave"
  );
}

function readRuntimeVersion() {
  return String(readJsonOrNull(path.join(PACKAGE_ROOT, "package.json"))?.version || "").trim() || null;
}

export function buildLanePaths(laneInput = DEFAULT_WAVE_LANE, options = {}) {
  const config = options.config || loadWaveConfig();
  const baseLaneProfile = resolveLaneProfile(config, laneInput || config.defaultLane);
  const adhocRunId = options.adhocRunId ? sanitizeAdhocRunId(options.adhocRunId) : null;
  const laneProfile = adhocRunId
    ? {
        ...baseLaneProfile,
        validation: {
          ...baseLaneProfile.validation,
          requireComponentPromotionsFromWave: null,
          requireAgentComponentsFromWave: null,
        },
      }
    : baseLaneProfile;
  const lane = laneProfile.lane;
  const laneTmux = lane.replace(/-/g, "_");
  const runKind = adhocRunId ? "adhoc" : "roadmap";
  const runVariant = String(options.runVariant || "")
    .trim()
    .toLowerCase();
  if (runVariant && runVariant !== "dry-run") {
    throw new Error(`Unsupported lane path variant: ${options.runVariant}`);
  }
  const workspaceTmuxToken = buildWorkspaceTmuxToken(REPO_ROOT);
  const docsDir = path.join(REPO_ROOT, laneProfile.docsDir);
  const plansDir = path.join(REPO_ROOT, laneProfile.plansDir);
  const preferredWavesDir = path.join(REPO_ROOT, laneProfile.wavesDir);
  const legacyWavesDir = path.join(docsDir, "waves");
  const adhocRootDir = path.join(REPO_ROOT, ".wave", "adhoc");
  const adhocRunDir = adhocRunId ? path.join(adhocRootDir, "runs", adhocRunId) : null;
  const baseStateDir = adhocRunId
    ? path.join(REPO_ROOT, laneProfile.paths.stateRoot, `${lane}-wave-launcher`, "adhoc", adhocRunId)
    : path.join(REPO_ROOT, laneProfile.paths.stateRoot, `${lane}-wave-launcher`);
  const stateDir = runVariant === "dry-run" ? path.join(baseStateDir, "dry-run") : baseStateDir;
  const orchestratorStateDir =
    runVariant === "dry-run"
      ? path.join(stateDir, "orchestrator")
      : path.join(REPO_ROOT, laneProfile.paths.orchestratorStateDir);
  const feedbackStateDir = path.join(orchestratorStateDir, "feedback");
  return {
    config,
    laneProfile,
    lane,
    runKind,
    runId: adhocRunId,
    runVariant,
    docsDir,
    plansDir,
    wavesDir:
      adhocRunDir ||
      (fs.existsSync(preferredWavesDir) || !fs.existsSync(legacyWavesDir)
        ? preferredWavesDir
        : legacyWavesDir),
    legacyWavesDir,
    adhocRootDir,
    adhocRunDir,
    adhocIndexPath: path.join(adhocRootDir, "index.json"),
    adhocRequestPath: adhocRunDir ? path.join(adhocRunDir, "request.json") : null,
    adhocSpecPath: adhocRunDir ? path.join(adhocRunDir, "spec.json") : null,
    adhocWavePath: adhocRunDir ? path.join(adhocRunDir, "wave-0.md") : null,
    adhocResultPath: adhocRunDir ? path.join(adhocRunDir, "result.json") : null,
    promptsDir: path.join(stateDir, "prompts"),
    logsDir: path.join(stateDir, "logs"),
    statusDir: path.join(stateDir, "status"),
    messageboardsDir: path.join(stateDir, "messageboards"),
    dashboardsDir: path.join(stateDir, "dashboards"),
    coordinationDir: path.join(stateDir, "coordination"),
    controlDir: path.join(stateDir, "control"),
    controlPlaneDir: path.join(stateDir, "control-plane"),
    telemetryDir: path.join(stateDir, "control-plane", "telemetry"),
    assignmentsDir: path.join(stateDir, "assignments"),
    inboxesDir: path.join(stateDir, "inboxes"),
    ledgerDir: path.join(stateDir, "ledger"),
    integrationDir: path.join(stateDir, "integration"),
    resultsDir: path.join(stateDir, "results"),
    proofDir: path.join(stateDir, "proof"),
    securityDir: path.join(stateDir, "security"),
    dependencySnapshotsDir: path.join(stateDir, "dependencies"),
    docsQueueDir: path.join(stateDir, "docs-queue"),
    tracesDir: path.join(stateDir, "traces"),
    context7CacheDir: path.join(stateDir, "context7-cache"),
    executorOverlaysDir: path.join(stateDir, "executors"),
    stateDir,
    terminalsPath: path.join(REPO_ROOT, laneProfile.paths.terminalsPath),
    skillsDir: path.join(REPO_ROOT, laneProfile.skills?.dir || "skills"),
    context7BundleIndexPath: path.join(REPO_ROOT, laneProfile.paths.context7BundleIndexPath),
    benchmarkCatalogPath: path.join(REPO_ROOT, laneProfile.paths.benchmarkCatalogPath),
    componentCutoverMatrixDocPath: path.join(
      REPO_ROOT,
      laneProfile.paths.componentCutoverMatrixDocPath,
    ),
    componentCutoverMatrixJsonPath: path.join(
      REPO_ROOT,
      laneProfile.paths.componentCutoverMatrixJsonPath,
    ),
    sharedPlanDocs: laneProfile.sharedPlanDocs || [],
    requiredPromptReferences: laneProfile.validation.requiredPromptReferences,
    rolePromptDir: laneProfile.roles.rolePromptDir,
    contQaAgentId: laneProfile.roles.contQaAgentId,
    contEvalAgentId: laneProfile.roles.contEvalAgentId,
    integrationAgentId: laneProfile.roles.integrationAgentId,
    documentationAgentId: laneProfile.roles.documentationAgentId,
    contQaRolePromptPath: laneProfile.roles.contQaRolePromptPath,
    contEvalRolePromptPath: laneProfile.roles.contEvalRolePromptPath,
    integrationRolePromptPath: laneProfile.roles.integrationRolePromptPath,
    documentationRolePromptPath: laneProfile.roles.documentationRolePromptPath,
    securityRolePromptPath: laneProfile.roles.securityRolePromptPath,
    designRolePromptPath: laneProfile.roles.designRolePromptPath,
    requireDocumentationStewardFromWave:
      laneProfile.validation.requireDocumentationStewardFromWave,
    requireContext7DeclarationsFromWave:
      laneProfile.validation.requireContext7DeclarationsFromWave,
    requireExitContractsFromWave: laneProfile.validation.requireExitContractsFromWave,
    requireIntegrationStewardFromWave:
      laneProfile.validation.requireIntegrationStewardFromWave,
    requireComponentPromotionsFromWave:
      laneProfile.validation.requireComponentPromotionsFromWave,
    requireAgentComponentsFromWave: laneProfile.validation.requireAgentComponentsFromWave,
    executors: laneProfile.executors,
    skills: laneProfile.skills,
    capabilityRouting: laneProfile.capabilityRouting,
    projectId: buildTelemetryProjectId(config),
    runtimeVersion: readRuntimeVersion(),
    orchestratorId: null,
    waveControl: laneProfile.waveControl,
    defaultManifestPath: path.join(stateDir, "waves.manifest.json"),
    defaultRunStatePath: path.join(stateDir, "run-state.json"),
    globalDashboardPath: path.join(stateDir, "dashboards", "global.json"),
    launcherLockPath: path.join(stateDir, "launcher.lock"),
    terminalNamePrefix: `${lane}-wave`,
    dashboardTerminalNamePrefix: `${lane}-wave-dashboard`,
    globalDashboardTerminalName: `${lane}-wave-dashboard-global`,
    tmuxSessionPrefix: `oc_${laneTmux}_${workspaceTmuxToken}_wave`,
    tmuxDashboardSessionPrefix: `oc_${laneTmux}_${workspaceTmuxToken}_wave_dashboard`,
    tmuxGlobalDashboardSessionPrefix: `oc_${laneTmux}_${workspaceTmuxToken}_wave_dashboard_global`,
    tmuxSocketName: `oc_${laneTmux}_${workspaceTmuxToken}_waves`,
    orchestratorStateDir,
    defaultOrchestratorBoardPath: path.join(
      orchestratorStateDir,
      "messageboards",
      "orchestrator.md",
    ),
    feedbackStateDir,
    feedbackRequestsDir: path.join(feedbackStateDir, "requests"),
    feedbackTriageDir: path.join(stateDir, "feedback", "triage"),
    crossLaneDependenciesDir: path.join(REPO_ROOT, laneProfile.paths.orchestratorStateDir, "dependencies"),
    runtimePolicy: laneProfile.runtimePolicy,
  };
}

export function parsePositiveInt(value, flagName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${flagName} requires a value`);
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

export function parseNonNegativeInt(value, flagName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${flagName} requires a value`);
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer, got: ${value}`);
  }
  return parsed;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepSync(ms) {
  const timeout = Math.max(0, Number.parseInt(String(ms), 10) || 0);
  if (timeout <= 0) {
    return;
  }
  const atomicsArray = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(atomicsArray, 0, 0, timeout);
}

export function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function writeTextAtomic(filePath, text) {
  ensureDirectory(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(3).toString("hex")}`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function writeJsonAtomic(filePath, payload) {
  writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function toIsoTimestamp() {
  return new Date().toISOString();
}

export function readFileTail(filePath, maxChars = 12000) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.length <= maxChars ? raw : raw.slice(-maxChars);
}

export function hashText(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

export function normalizeWaveVerdict(verdict) {
  const normalized = String(verdict || "")
    .trim()
    .toLowerCase();
  if (normalized === "hold") {
    return "concerns";
  }
  if (normalized === "fail") {
    return "blocked";
  }
  return normalized;
}

export function parseVerdictFromText(text, regex) {
  if (!text) {
    return { verdict: null, detail: "" };
  }
  regex.lastIndex = 0;
  let match = regex.exec(text);
  let verdict = null;
  let detail = "";
  while (match !== null) {
    verdict = normalizeWaveVerdict(match[1]);
    detail = String(match[2] || "")
      .trim()
      .replace(/^detail=/i, "")
      .trim();
    match = regex.exec(text);
  }
  return { verdict, detail };
}

export function readStatusRecordIfPresent(statusPath) {
  if (!fs.existsSync(statusPath)) {
    return null;
  }
  const raw = fs.readFileSync(statusPath, "utf8").trim();
  if (!raw) {
    return null;
  }
  const parsedJson = readJsonOrNull(statusPath);
  if (parsedJson && typeof parsedJson === "object") {
    const code = Number.parseInt(String(parsedJson.code ?? ""), 10);
    return Number.isFinite(code)
      ? {
          code,
          promptHash: typeof parsedJson.promptHash === "string" ? parsedJson.promptHash : null,
          orchestratorId:
            typeof parsedJson.orchestratorId === "string" ? parsedJson.orchestratorId : null,
          completedAt: typeof parsedJson.completedAt === "string" ? parsedJson.completedAt : null,
        }
      : null;
  }
  const code = Number.parseInt(raw, 10);
  return Number.isFinite(code)
    ? {
        code,
        promptHash: null,
        orchestratorId: null,
        completedAt: null,
      }
    : null;
}

export function walkFiles(dirPath) {
  const output = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      output.push(fullPath);
    }
  }
  return output;
}

export function truncate(value, width) {
  const text = String(value ?? "");
  if (text.length <= width) {
    return text;
  }
  if (width <= 1) {
    return text.slice(0, width);
  }
  return `${text.slice(0, width - 1)}…`;
}

export function pad(value, width) {
  return truncate(value, width).padEnd(width, " ");
}

export function compactSingleLine(value, maxChars = 220) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

export function formatAgeFromTimestamp(timestampMs) {
  if (!Number.isFinite(timestampMs)) {
    return "n/a";
  }
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

export function formatElapsed(startIso, endIso = null) {
  if (!startIso) {
    return "n/a";
  }
  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "n/a";
  }
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
