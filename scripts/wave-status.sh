#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LANE="${WAVE_LANE:-main}"
STATE_FILE="$REPO_ROOT/.tmp/${LANE}-wave-launcher/run-state.json"
DRY_RUN_STATE_FILE="$REPO_ROOT/.tmp/${LANE}-wave-launcher/dry-run/run-state.json"
WAVE="${1:-}"

run_wave() {
  if [[ -x "$REPO_ROOT/node_modules/.bin/wave" ]]; then
    "$REPO_ROOT/node_modules/.bin/wave" "$@"
    return
  fi
  if command -v wave >/dev/null 2>&1; then
    wave "$@"
    return
  fi
  if command -v pnpm >/dev/null 2>&1; then
    pnpm exec wave "$@"
    return
  fi
  if command -v npx >/dev/null 2>&1; then
    npx --no-install wave "$@"
    return
  fi
  echo "wave-status: unable to locate the wave CLI. Install @chllming/wave-orchestration in this workspace first." >&2
  return 127
}

resolve_wave() {
  local state_path="$1"
  node -e 'const fs=require("fs"); const state=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const entries=Object.values(state.waves||{}).sort((a,b)=>a.wave-b.wave); const next=entries.find((entry)=>String(entry.currentState||"").toLowerCase()!=="completed"); process.stdout.write(String(next ? next.wave : (entries.at(-1)?.wave ?? 0)));' "$state_path"
}

if [[ -z "$WAVE" ]]; then
  if [[ -f "$STATE_FILE" ]]; then
    WAVE="$(resolve_wave "$STATE_FILE")"
  elif [[ -f "$DRY_RUN_STATE_FILE" ]]; then
    WAVE="$(resolve_wave "$DRY_RUN_STATE_FILE")"
  else
    WAVE="0"
  fi
fi

status_json="$(run_wave control status --lane "$LANE" --wave "$WAVE" --json)"

STATUS_JSON="$status_json" node -e '
const tail = process.argv.slice(-2);
const [lane, wave] = tail;
const payload = JSON.parse(process.env.STATUS_JSON || "{}");
const blocking = payload.blockingEdge
  ? `${payload.blockingEdge.kind}:${payload.blockingEdge.id}`
  : "none";
const activeAttempt = payload.activeAttempt?.attemptId || "none";
const logical = Array.isArray(payload.logicalAgents)
  ? payload.logicalAgents.map((agent) => `${agent.agentId}:${agent.state}`).join(",")
  : "";

const phase = String(payload.phase || "").trim().toLowerCase();
const humanBlocked =
  ["human-input", "human-escalation"].includes(String(payload.blockingEdge?.kind || "").trim().toLowerCase()) ||
  (Array.isArray(payload.tasks) &&
    payload.tasks.some(
      (task) =>
        task &&
        task.needsHuman === true &&
        ["open", "working", "acknowledged", "in_progress", "input-required"].includes(
          String(task.state || "").toLowerCase(),
        ),
    ));

let signal = "waiting";
let exitCode = 10;
if (phase === "completed") {
  signal = "completed";
  exitCode = 0;
} else if (humanBlocked) {
  signal = "input-required";
  exitCode = 20;
}

console.log(
  [
    `signal=${signal}`,
    `lane=${lane}`,
    `wave=${wave}`,
    `phase=${payload.phase}`,
    `blocking=${blocking}`,
    `selection=${payload.selectionSource || "none"}`,
    `attempt=${activeAttempt}`,
    logical ? `agents=${logical}` : "",
  ]
    .filter(Boolean)
    .join(" "),
);

process.exit(exitCode);
' "$LANE" "$WAVE"
