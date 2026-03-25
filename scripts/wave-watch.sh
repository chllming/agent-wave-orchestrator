#!/usr/bin/env bash
set -euo pipefail

lane="main"
wave=""
agent=""
run_id=""
dry_run="0"
mode="follow"
refresh_ms="2000"

usage() {
  cat <<'EOF'
Usage:
  scripts/wave-watch.sh [--lane <lane>] [--wave <n>] [--agent <id>] [--run <id>] [--dry-run] [--refresh-ms <n>] [--follow|--until-change]

Exit codes:
  0   completed
  20  input required
  30  watched signal changed while the wave remained active
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
    --refresh-ms)
      refresh_ms="${2:-}"
      shift 2
      ;;
    --follow)
      mode="follow"
      shift
      ;;
    --until-change)
      mode="until-change"
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

status_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/wave-status.sh"
common_args=(--lane "$lane")
if [ -n "$wave" ]; then
  common_args+=(--wave "$wave")
fi
if [ -n "$agent" ]; then
  common_args+=(--agent "$agent")
fi
if [ -n "$run_id" ]; then
  common_args+=(--run "$run_id")
fi
if [ "$dry_run" = "1" ]; then
  common_args+=(--dry-run)
fi

extract_field() {
  local payload="$1"
  local field="$2"
  PAYLOAD="$payload" node - "$agent" "$field" <<'NODE'
const agentId = String(process.argv[2] || "").trim();
const field = String(process.argv[3] || "").trim();
const payload = JSON.parse(process.env.PAYLOAD || "{}");
const signals = payload?.signals || {};
const snapshot = agentId
  ? (Array.isArray(signals.agents) ? signals.agents.find((entry) => entry.agentId === agentId) : null)
  : signals.wave;
const value = snapshot?.[field];
process.stdout.write(value === undefined || value === null ? "" : String(value));
NODE
}

print_line() {
  local payload="$1"
  PAYLOAD="$payload" node - "$lane" "${wave:-0}" "$agent" <<'NODE'
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
  phase: payload?.phase || "unknown",
  status: payload?.blockingEdge ? "blocked" : "running",
  blocking: payload?.blockingEdge || null,
  attempt: payload?.activeAttempt?.attemptNumber || 0,
  version: 0,
  shouldWake: agentId ? true : null,
  targetAgentIds: agentId ? [agentId] : [],
};
const targetKey = agentId ? "agent" : "agents";
const targetValue = agentId || (effective.targetAgentIds || []).join(",") || "none";
const shouldWake =
  typeof effective.shouldWake === "boolean" ? (effective.shouldWake ? "yes" : "no") : "n/a";
console.log(
  [
    `signal=${effective.signal || "waiting"}`,
    `lane=${lane}`,
    `wave=${wave}`,
    `phase=${effective.phase || "unknown"}`,
    `status=${effective.status || "running"}`,
    `blocking=${effective?.blocking?.kind || "none"}`,
    `attempt=${effective.attempt || 0}`,
    `${targetKey}=${targetValue}`,
    `version=${effective.version || 0}`,
    `should_wake=${shouldWake}`,
  ].join(" "),
);
NODE
}

exit_code_for_payload() {
  local payload="$1"
  PAYLOAD="$payload" node - "$agent" <<'NODE'
const agentId = String(process.argv[2] || "").trim();
const payload = JSON.parse(process.env.PAYLOAD || "{}");
const signals = payload?.signals || {};
const snapshot = agentId
  ? (Array.isArray(signals.agents) ? signals.agents.find((entry) => entry.agentId === agentId) : null)
  : signals.wave;
const signal = String(snapshot?.signal || "").trim().toLowerCase();
if (signal === "completed") {
  process.exit(0);
}
if (signal === "failed") {
  process.exit(40);
}
if (signal === "feedback-requested") {
  process.exit(20);
}
process.exit(10);
NODE
}

payload="$("$status_script" "${common_args[@]}" --json)"
version="$(extract_field "$payload" "version")"
print_line "$payload"

if exit_code_for_payload "$payload"; then
  exit 0
else
  status=$?
  if [ "$status" -eq 20 ] || [ "$status" -eq 40 ]; then
    exit "$status"
  fi
fi

while true; do
  sleep "$(awk "BEGIN { printf \"%.3f\", ${refresh_ms}/1000 }")"
  payload="$("$status_script" "${common_args[@]}" --json)"
  next_version="$(extract_field "$payload" "version")"
  if [ "$next_version" = "$version" ]; then
    continue
  fi
  version="$next_version"
  print_line "$payload"
  if exit_code_for_payload "$payload"; then
    exit 0
  else
    status=$?
    if [ "$status" -eq 20 ] || [ "$status" -eq 40 ]; then
      exit "$status"
    fi
  fi
  if [ "$mode" = "until-change" ]; then
    exit 30
  fi
done
