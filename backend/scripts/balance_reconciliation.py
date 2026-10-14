#!/usr/bin/env python3
"""Salt-okuma bakiye mutabakatı. Varsayılan veritabanı adını zorlamaz.

Örnek:
  python backend/scripts/balance_reconciliation.py --company comp_nexus_main_01
  python backend/scripts/balance_reconciliation.py --company comp_x --db tamkobi_x --format csv
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def _main(company_id: str, db_name: str, fmt: str) -> int:
    from mysql_store import MySQLClient
    import balance_reconciliation as report_mod

    client = MySQLClient()
    db = client[db_name]
    try:
        report = await report_mod.build_reconciliation(db, company_id)
    finally:
        try:
            client.close()
        except Exception:
            pass
    if fmt == "csv":
        sys.stdout.write(report_mod.render_csv(report))
    else:
        print(report_mod.render_table(report))
    return 0


def main() -> None:
    from mysql_store import mysql_settings_from_env

    configured = mysql_settings_from_env()
    parser = argparse.ArgumentParser(description="Bakiye mutabakat raporu (salt okuma)")
    parser.add_argument("--company", required=True, help="company_id")
    parser.add_argument(
        "--db",
        default=configured.get("db") or "",
        help="MySQL veritabanı adı (MySQLClient()[db]). Boşsa ortam ayarı.",
    )
    parser.add_argument("--format", choices=("table", "csv"), default="table")
    args = parser.parse_args()
    db_name = str(args.db or "").strip()
    if not db_name:
        print("Veritabanı adı yok. --db verin veya MYSQL ayarını tanımlayın.", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(asyncio.run(_main(args.company, db_name, args.format)))


if __name__ == "__main__":
    main()
