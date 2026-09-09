#!/usr/bin/env bash
# Automated MySQL schema + backup/restore tests (no live ERP UI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f backend/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source backend/.env
  set +a
fi
export REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-http://127.0.0.1:8000}"
export PYTHONPATH="${ROOT}/backend${PYTHONPATH:+:${PYTHONPATH}}"

echo "== pytest schema / backup =="
python3 -m pytest backend/tests/test_mysql_schema.py -n 0 --dist loadscope -q

echo "== backup + restore round-trip =="
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
python3 "${ROOT}/backend/mysql_backup.py" backup --dir "$TMP" --keep 1
SNAP="$(ls -1t "$TMP"/*.json.gz | head -1)"
python3 "${ROOT}/backend/mysql_backup.py" verify "$SNAP"
python3 "${ROOT}/backend/mysql_backup.py" restore "$SNAP" --database tamkobi_schema_test --yes --as-root
python3 - <<'PY'
from mysql_backup import connect, mysql_settings, drop_database, TEST_DATABASE, load_env
load_env()
cfg = mysql_settings()
src = connect(cfg)
dst = connect({**cfg, "user": "root", "password": __import__("os").environ.get("MYSQL_ROOT_PASSWORD") or __import__("os").environ.get("DB_PASSWORD") or cfg["password"], "database": TEST_DATABASE})
sc, dc = src.cursor(), dst.cursor()
sc.execute("SELECT COUNT(*) FROM docs")
dc.execute("SELECT COUNT(*) FROM docs")
a, b = sc.fetchone()[0], dc.fetchone()[0]
assert a == b, (a, b)
sc.execute("SELECT COUNT(*) FROM meta_indexes")
dc.execute("SELECT COUNT(*) FROM meta_indexes")
a, b = sc.fetchone()[0], dc.fetchone()[0]
assert a == b, (a, b)
src.close(); dst.close()
drop_database(TEST_DATABASE)
print("round-trip docs/meta_indexes counts match; dropped", TEST_DATABASE)
PY

echo "mysql schema tests OK"
