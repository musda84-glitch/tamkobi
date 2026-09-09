"""Apply TamKobi MySQL 8 schema (idempotent).

Usage (from backend/):
    python migrate.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mysql_store import MySQLDatabase, mysql_settings_from_env, SCHEMA_SQL
from setup_state import lock_installed


async def migrate() -> dict:
    cfg = mysql_settings_from_env()
    db = MySQLDatabase(cfg)
    await db._ensure()
    await db.close()
    return {"ok": True, "database": cfg["db"], "host": cfg["host"], "port": cfg["port"]}


def migrate_error_exit_code(installed: bool) -> int:
    """Uninstalled hosts may boot the wizard without MySQL. Installed hosts must fail."""
    return 1 if installed else 0


def main() -> int:
    try:
        info = asyncio.run(migrate())
    except Exception as exc:
        installed = lock_installed()
        code = migrate_error_exit_code(installed)
        if installed:
            print(f"MySQL migrate failed on an installed instance: {exc}", file=sys.stderr)
        else:
            print(
                f"MySQL not ready ({exc}). Starting the API so the first-run setup wizard can run.",
                file=sys.stderr,
            )
        return code
    print(
        f"MySQL schema ready → {info['host']}:{info['port']}/{info['database']}\n"
        "Tables: docs, meta_indexes, system_logs (created if missing; docs.company_id generated column upgraded in place)."
    )
    print("SCHEMA:\n", SCHEMA_SQL.strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
