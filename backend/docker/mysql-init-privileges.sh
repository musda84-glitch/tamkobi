#!/bin/bash
# Applied only on an empty MySQL data volume (docker-entrypoint-initdb.d).
# Existing volumes: run `scripts/mysql_harden.sh` instead.
# Keep GRANT lists in sync with backend/mysql_users.py.
set -euo pipefail

mysql_exec() {
  mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" --connect-expired-password "$@"
}

DB="${MYSQL_DATABASE:-tamkobi}"
APP_USER="${MYSQL_USER:-tamkobi}"

mysql_exec <<EOSQL
REVOKE ALL PRIVILEGES, GRANT OPTION FROM \`${APP_USER}\`@\`%\`;
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES ON \`${DB}\`.* TO \`${APP_USER}\`@\`%\`;
EOSQL

if [[ -n "${MYSQL_BACKUP_PASSWORD:-}" ]]; then
  mysql_exec <<EOSQL
CREATE USER IF NOT EXISTS 'tamkobi_backup'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_BACKUP_PASSWORD}';
ALTER USER 'tamkobi_backup'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_BACKUP_PASSWORD}';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'tamkobi_backup'@'%';
GRANT SELECT, LOCK TABLES, SHOW VIEW ON \`${DB}\`.* TO 'tamkobi_backup'@'%';
EOSQL
fi

if [[ -n "${MYSQL_MIGRATE_PASSWORD:-}" ]]; then
  mysql_exec <<EOSQL
CREATE USER IF NOT EXISTS 'tamkobi_migrate'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_MIGRATE_PASSWORD}';
ALTER USER 'tamkobi_migrate'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_MIGRATE_PASSWORD}';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'tamkobi_migrate'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES, CREATE VIEW, SHOW VIEW ON \`${DB}\`.* TO 'tamkobi_migrate'@'%';
EOSQL
fi

if [[ -n "${MYSQL_DBA_PASSWORD:-}" ]]; then
  mysql_exec <<EOSQL
CREATE USER IF NOT EXISTS 'tamkobi_dba'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_DBA_PASSWORD}';
ALTER USER 'tamkobi_dba'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_DBA_PASSWORD}';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'tamkobi_dba'@'%';
GRANT CREATE, CREATE USER, RELOAD, PROCESS, SHOW DATABASES ON *.* TO 'tamkobi_dba'@'%';
GRANT ALL PRIVILEGES ON \`${DB}\`.* TO 'tamkobi_dba'@'%';
GRANT ALL PRIVILEGES ON \`tamkobi\\_%\`.* TO 'tamkobi_dba'@'%';
EOSQL
fi

mysql_exec <<EOSQL
DROP DATABASE IF EXISTS test;
FLUSH PRIVILEGES;
EOSQL
