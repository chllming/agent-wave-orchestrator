#!/usr/bin/env bash
set -euo pipefail

lane="main"
wave=""
agent=""
run_id=""
dry_run="0"
json_output="0"

usage() {
  cat <<'EOF'
Usage:
  scripts/wave-status.sh [--lane <lane>] [--wave <n>] [--agent <id>] [--run <id>] [--dry-run] [--json]

Exit codes:
  0   completed
  10  waiting or running
  20  input required
  40  failed
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --lane)
      lane="${2:-}"
      shift 2
      ;;
    --wave)
      wave="${2:-}"
      shift 2
      ;;
    --agent)
      agent="${2:-}"
      shift 2
      ;;
    --run)
      run_id="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run="1"
      shift
      ;;
    --json)
      json_output="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

run_wave_cli() {
  if [ -n "${WAVE_WRAPPER_ENTRY:-}" ]; then
    node "$WAVE_WRAPPER_ENTRY" "$@"
    return
  fi
  if [ -f "scripts/wave.mjs" ]; then
    node "scripts/wave.mjs" "$@"
    return
  fi
  if [ -f "node_modules/@chllming/wave-orchestration/scripts/wave.mjs" ]; then
    node "node_modules/@chllming/wave-orchestration/scripts/wave.mjs" "$@"
    return
  fi
  if command -v pnpm >/dev/null 2>&1; then
    pnpm exec wave "$@"
    return
  fi
  echo "Unable to locate Wave CLI. Set WAVE_WRAPPER_ENTRY or install the package locally." >&2
  exit 2
}

infer_wave() {
  node - "$lane" "$run_id" "$dry_run" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const lane = process.argv[2] || "main";
const runId = process.argv[3] || "";
const dryRun = process.argv[4] === "1";
const stateDir = runId
  ? path.join(process.cwd(), ".tmp", `${lane}-wave-launcher`, "adhoc", runId, dryRun ? "dry-run" : "")
  : path.join(process.cwd(), ".tmp", `${lane}-wave-launcher`, dryRun ? "dry-run" : "");
const runStatePath = path.join(stateDir, "run-state.json");
let payload = null;
try {
  payload = JSON.parse(fs.readFileSync(runStatePath, "utf8"));
} catch {
  payload = null;
}
const waves = Object.values(payload?.waves || {})
  .filter((entry) => entry && typeof entry === "object")
  .map((entry) => ({
    wave: Number.parseInt(String(entry.wave ?? ""), 10),
    state: String(entry.currentState || "").trim().toLowerCase(),
  }))
  .filter((entry) => Number.isFinite(entry.wave))
  .sort((left, right) => left.wave - right.wave);
const active = waves.findLast(
  (entry) => !["completed", "failed", "timed_out", "timed-out"].includes(entry.state),
);
if (active) {
  process.stdout.write(String(active.wave));
  process.exit(0);
}
const completed = Array.isArray(payload?.completedWaves)
  ? payload.completedWaves
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)
  : [];
process.stdout.write(String(completed.at(-1) ?? 0));
NODE
}

if [ -z "$wave" ]; then
  wave="$(infer_wave)"
fi

status_args=(control status --lane "$lane" --wave "$wave" --json)
if [ -n "$agent" ]; then
  status_args+=(--agent "$agent")
fi
if [ -n "$run_id" ]; then
  status_args+=(--run "$run_id")
fi
if [ "$dry_run" = "1" ]; then
  status_args+=(--dry-run)
fi

payload="$(run_wave_cli "${status_args[@]}")"

if [ "$json_output" = "1" ]; then
  printf '%s\n' "$payload"
  exit 0
fi

PAYLOAD="$payload" node - "$lane" "$wave" "$agent" <<'NODE'
const fs = require("node:fs");

const lane = process.argv[2] || "main";
const wave = Number.parseInt(String(process.argv[3] || "0"), 10) || 0;
const agentId = String(process.argv[4] || "").trim();
const payload = JSON.parse(process.env.PAYLOAD || "{}");
const signals = payload?.signals || {};
const snapshot = agentId
  ? (Array.isArray(signals.agents) ? signals.agents.find((entry) => entry.agentId === agentId) : null)
  : signals.wave;
const effective = snapshot || {
  signal: payload?.blockingEdge?.kind === "human-input" ? "feedback-requested" : "waiting",
  lane,
  wave,
  phase: payload?.phase || "unknown",
  status: payload?.blockingEdge ? "blocked" : "running",
  blocking: payload?.blockingEdge || null,
  attempt: payload?.activeAttempt?.attemptNumber || 0,
  targetAgentIds: agentId ? [agentId] : [],
  shouldWake: agentId ? true : null,
  version: 0,
};
const targetKey = agentId ? "agent" : "agents";
const targetValue = agentId || (effective.targetAgentIds || []).join(",") || "none";
const blocking = effective?.blocking?.kind || "none";
const shouldWake =
  typeof effective.shouldWake === "boolean" ? (effective.shouldWake ? "yes" : "no") : "n/a";
console.log(
  [
    `signal=${effective.signal || "waiting"}`,
    `lane=${lane}`,
    `wave=${wave}`,
    `phase=${effective.phase || "unknown"}`,
    `status=${effective.status || "running"}`,
    `blocking=${blocking}`,
    `attempt=${effective.attempt || 0}`,
    `${targetKey}=${targetValue}`,
    `version=${effective.version || 0}`,
    `should_wake=${shouldWake}`,
  ].join(" "),
);
if (String(effective.signal || "").trim().toLowerCase() === "completed") {
  process.exit(0);
}
if (String(effective.signal || "").trim().toLowerCase() === "failed") {
  process.exit(40);
}
if (String(effective.signal || "").trim().toLowerCase() === "feedback-requested") {
  process.exit(20);
}
process.exit(10);
NODE
