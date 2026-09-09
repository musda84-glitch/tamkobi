#!/usr/bin/env bash
# Restore a TamKobi .json.gz snapshot. Overwrites the target database.
#   ./scripts/mysql_restore.sh backups/mysql/tamkobi-YYYYMMDD-HHMMSS.json.gz --yes
# Restore into a scratch database as root:
#   ./scripts/mysql_restore.sh FILE.json.gz --database tamkobi_restore_test --yes --as-root
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${ROOT}/backend${PYTHONPATH:+:${PYTHONPATH}}"
exec python3 "${ROOT}/backend/mysql_backup.py" restore "$@"
