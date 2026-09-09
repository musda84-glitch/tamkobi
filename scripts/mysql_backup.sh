#!/usr/bin/env bash
# Regular TamKobi MySQL backup. Credentials come from backend/.env (never hard-code secrets).
#   ./scripts/mysql_backup.sh
#   ./scripts/mysql_backup.sh --dir /var/backups/tamkobi --keep 14
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${ROOT}/backend${PYTHONPATH:+:${PYTHONPATH}}"
exec python3 "${ROOT}/backend/mysql_backup.py" backup "$@"
