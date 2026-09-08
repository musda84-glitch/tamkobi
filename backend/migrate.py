"""Apply TamKobi MySQL 8 schema (idempotent).

Usage (from backend/):
    python migrate.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mysql_store import MySQLDatabase, mysql_settings_from_env, SCHEMA_SQL


async def migrate() -> dict:
    cfg = mysql_settings_from_env()
    db = MySQLDatabase(cfg)
    await db._ensure()
    await db.close()
    return {"ok": True, "database": cfg["db"], "host": cfg["host"], "port": cfg["port"]}


def main():
    info = asyncio.run(migrate())
    print(
        f"MySQL schema ready → {info['host']}:{info['port']}/{info['database']}\n"
        "Tables: docs, meta_indexes, system_logs (created if missing; docs.company_id generated column upgraded in place)."
    )
    print("SCHEMA:\n", SCHEMA_SQL.strip())


if __name__ == "__main__":
    main()
