#!/usr/bin/env bash
# Enable slow query log and tighten timeouts without restarting MySQL.
# Buffer pool still requires a restart with mysql/perf.cnf mounted.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
if command -v mysql >/dev/null 2>&1; then
  mysql -h"${MYSQL_HOST:-127.0.0.1}" -P"${MYSQL_PORT:-3306}" -u"${MYSQL_USER:-tamkobi}" -p"${MYSQL_PASSWORD:-tamkobi}" --connect-timeout=5 <<'SQL'
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;
SET GLOBAL wait_timeout = 600;
SET GLOBAL interactive_timeout = 600;
SELECT @@slow_query_log, @@long_query_time, @@innodb_buffer_pool_size, @@max_connections;
SQL
  exit 0
fi
PY="python3"
command -v python3 >/dev/null 2>&1 || PY="python"
"$PY" - <<'PY'
from mysql_store import mysql_settings_from_env
import os, pymysql
cfg = mysql_settings_from_env()
user = os.environ.get("MYSQL_ADMIN_USER") or "root"
password = os.environ.get("MYSQL_ADMIN_PASSWORD") or os.environ.get("MYSQL_ROOT_PASSWORD") or os.environ.get("DB_PASSWORD") or cfg["password"]
conn = pymysql.connect(host=cfg["host"], port=int(cfg["port"]), user=user, password=password, autocommit=True)
cur = conn.cursor()
for sql in (
    "SET GLOBAL slow_query_log = ON",
    "SET GLOBAL long_query_time = 1",
    "SET GLOBAL wait_timeout = 600",
    "SET GLOBAL interactive_timeout = 600",
):
    try:
        cur.execute(sql)
        print("ok", sql)
    except Exception as e:
        print("skip", sql, e)
cur.execute("SELECT @@slow_query_log, @@long_query_time, @@innodb_buffer_pool_size, @@max_connections")
print(cur.fetchone())
conn.close()
PY
