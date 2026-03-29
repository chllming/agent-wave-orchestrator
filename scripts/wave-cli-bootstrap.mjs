import path from "node:path";
import fs from "node:fs";

const ALLOWLISTED_ENV_FILE_KEYS = new Set([
  "CONTEXT7_API_KEY",
  "CORRIDOR_API_TOKEN",
  "CORRIDOR_API_KEY",
  "WAVE_API_TOKEN",
  "WAVE_CONTROL_AUTH_TOKEN",
]);

function stripRepoRootArg(argv) {
  const normalizedArgs = [];
  let repoRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root") {
      repoRoot = path.resolve(process.cwd(), String(argv[index + 1] || ""));
      index += 1;
      continue;
    }
    if (String(arg).startsWith("--repo-root=")) {
      repoRoot = path.resolve(process.cwd(), String(arg).slice("--repo-root=".length));
      continue;
    }
    normalizedArgs.push(arg);
  }
  if (repoRoot) {
    process.env.WAVE_REPO_ROOT = repoRoot;
  }
  return normalizedArgs;
}

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const exportPrefix = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const equalsIndex = exportPrefix.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }
  const key = exportPrefix.slice(0, equalsIndex).trim();
  let value = exportPrefix.slice(equalsIndex + 1).trim();
  if (!ALLOWLISTED_ENV_FILE_KEYS.has(key)) {
    return null;
  }
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadRepoLocalEnv() {
  const repoRoot = path.resolve(process.env.WAVE_REPO_ROOT || process.cwd());
  const envPath = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const entry = parseEnvLine(line);
    if (!entry || process.env[entry.key]) {
      continue;
    }
    process.env[entry.key] = entry.value;
  }
}

export function bootstrapWaveArgs(argv) {
  const normalizedArgs = stripRepoRootArg(Array.isArray(argv) ? argv : []);
  loadRepoLocalEnv();
  return normalizedArgs;
}
