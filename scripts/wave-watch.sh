#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
MODE="follow"
WAVE=""
REFRESH_SECONDS="${WAVE_STATUS_REFRESH_SECONDS:-2}"

while (($# > 0)); do
  case "$1" in
    --until-change)
      MODE="until-change"
      shift
      ;;
    --follow)
      MODE="follow"
      shift
      ;;
    *)
      WAVE="$1"
      shift
      ;;
  esac
done

last_snapshot=""
first_pass=1

while true; do
  set +e
  output="$(bash "$SCRIPT_DIR/wave-status.sh" "${WAVE:+$WAVE}" 2>&1)"
  status_exit=$?
  set -e

  snapshot="${output}"
  if [[ "$snapshot" != "$last_snapshot" ]]; then
    printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$output"
    if [[ "$MODE" == "until-change" && $first_pass -eq 0 ]]; then
      exit "$status_exit"
    fi
    last_snapshot="$snapshot"
  fi

  if [[ $status_exit -eq 0 || $status_exit -eq 20 ]]; then
    exit "$status_exit"
  fi

  first_pass=0
  sleep "$REFRESH_SECONDS"
done
