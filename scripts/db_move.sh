#!/usr/bin/env bash
# Move the TamKobi database to another MySQL server (tables + data), then repoint the app.
#   ./scripts/db_move.sh show
#   ./scripts/db_move.sh test --host db.firma.com --db tamkobi --user tamkobi
#   TARGET_MYSQL_PASSWORD='...' ./scripts/db_move.sh move --host db.firma.com --db tamkobi --user tamkobi --yes
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="${ROOT}/backend${PYTHONPATH:+:${PYTHONPATH}}"
exec python3 "${ROOT}/backend/db_relocate.py" "$@"
