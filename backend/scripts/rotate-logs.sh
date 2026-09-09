#!/usr/bin/env bash
# Rotate TamKobi application and MySQL logs by size, then drop files older
# than LOG_RETENTION_DAYS. Safe to run from cron:
#   0 */6 * * * /app/scripts/rotate-logs.sh
set -euo pipefail

LOG_DIR="${LOG_DIR:-/var/log/tamkobi}"
MYSQL_LOG_DIR="${MYSQL_LOG_DIR:-}"
MAX_BYTES="${LOG_MAX_BYTES:-52428800}"
KEEP_DAYS="${LOG_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

rotate_copytruncate() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  local sz
  sz="$(wc -c < "$f" | tr -d ' ')"
  if [[ "${sz:-0}" -lt "$MAX_BYTES" ]]; then
    return 0
  fi
  local snap="${f}.${STAMP}"
  cp -p "$f" "$snap"
  : > "$f"
  gzip -f "$snap"
  echo "rotated $f -> ${snap}.gz (${sz} bytes)"
}

expire_old() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  find "$dir" -type f \( -name '*.log.*' -o -name '*.gz' \) -mtime "+${KEEP_DAYS}" -print -delete 2>/dev/null || true
}

mkdir -p "$LOG_DIR"
for f in "$LOG_DIR"/app.log "$LOG_DIR"/auth.log "$LOG_DIR"/error.log "$LOG_DIR"/sql.log; do
  rotate_copytruncate "$f"
done
expire_old "$LOG_DIR"

if [[ -d "$MYSQL_LOG_DIR" ]]; then
  for f in "$MYSQL_LOG_DIR"/slow.log "$MYSQL_LOG_DIR"/error.log; do
    rotate_copytruncate "$f"
  done
  expire_old "$MYSQL_LOG_DIR"
  if command -v mysqladmin >/dev/null 2>&1; then
    mysqladmin flush-logs >/dev/null 2>&1 || true
  fi
fi

# Purge MySQL system_logs rows (best-effort).
PY=""
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
fi
if [[ -n "$PY" ]]; then
  APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  if [[ -f "$APP_DIR/applog.py" ]]; then
    (cd "$APP_DIR" && "$PY" -m applog rotate) || true
  fi
fi
