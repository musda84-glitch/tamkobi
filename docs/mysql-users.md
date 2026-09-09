# TamKobi MySQL accounts (least privilege)

The application must never connect as `root`. Official `mysql:8.0` creates `MYSQL_USER` with **ALL PRIVILEGES on `tamkobi.*`**; this project revokes that and splits work across four accounts. Run after every new data volume (init script) **and** on existing volumes:

```bash
./scripts/mysql_harden.sh
```

The script generates 32-byte URL-safe passwords, writes them only to gitignored `.env` / `backend/.env`, then `FLUSH PRIVILEGES`. **Do not commit those files.** Recreate the backend container so it picks up `MYSQL_PASSWORD` (`docker compose up -d --no-deps --force-recreate backend`).

## Accounts

| User | Host | Privileges | Used by |
|---|---|---|---|
| `tamkobi` | `%` | `SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES` on `tamkobi.*` | FastAPI (`DATABASE_URL`) |
| `tamkobi_backup` | `%` | `SELECT, LOCK TABLES, SHOW VIEW` on `tamkobi.*` | dumps |
| `tamkobi_migrate` | `%` | DML + `CREATE, DROP, ALTER, INDEX, …` on `tamkobi.*` | schema changes / in-place restore |
| `tamkobi_dba` | `%` | `CREATE, CREATE USER, RELOAD, PROCESS, SHOW DATABASES` globally; `ALL` on `tamkobi.*` and `tamkobi\_%.*` | scratch DBs, user admin |
| `root` | `localhost` | instance admin (healthcheck, `docker exec`) | operators |
| `root` | `%` | **ACCOUNT LOCK** after harden | — |

`CREATE` on the app user is required because `mysql_store` runs `CREATE TABLE IF NOT EXISTS` at startup. The app **cannot** `DROP DATABASE`, `FILE`, `SUPER`, `GRANT OPTION`, or read `mysql.user`.

`REPLACE INTO docs` needs `DELETE` as well as `INSERT`.

## Root password

`MYSQL_ROOT_PASSWORD` is independent of `MYSQL_PASSWORD`. Compose previously used `DB_PASSWORD` for both root and (via copy-paste defaults) the app — that is removed. Healthcheck pings `root@localhost` inside the container, so locking `root@%` does not break it.

Rotate:

```bash
MYSQL_ROOT_CURRENT_PASSWORD='<current>' ./scripts/mysql_harden.sh
```

`--no-rotate` keeps existing non-weak passwords and only repairs grants. `--keep-remote-root` leaves `root@%` unlocked (not recommended).

## Docker

[`backend/docker/mysql-init-privileges.sh`](../backend/docker/mysql-init-privileges.sh) is mounted as `/docker-entrypoint-initdb.d/02-privileges.sh` and runs **only on an empty volume**, after the image creates `MYSQL_USER`. Extra users are created when `MYSQL_BACKUP_PASSWORD` / `MYSQL_MIGRATE_PASSWORD` / `MYSQL_DBA_PASSWORD` are set in Compose env.

## Tests

`backend/tests/test_mysql_users.py` — grant parser unit tests plus live checks (skipped if the hardened users are not configured).
