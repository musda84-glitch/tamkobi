#!/usr/bin/env bash
# Collect host+MySQL metrics. Cron:
#   * * * * * /app/scripts/perf-monitor.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export LOG_DIR="${LOG_DIR:-/var/log/tamkobi}"
PY="python3"
command -v python3 >/dev/null 2>&1 || PY="python"
cd "$APP_DIR"
"$PY" -m perfmon once >/dev/null
# Keep jsonl from growing without bound (~1 line/min → trim to 7 days of minutes)
if [[ -f "$LOG_DIR/perf.jsonl" ]]; then
  tail -n 10080 "$LOG_DIR/perf.jsonl" > "$LOG_DIR/perf.jsonl.tmp" && mv "$LOG_DIR/perf.jsonl.tmp" "$LOG_DIR/perf.jsonl"
fi
