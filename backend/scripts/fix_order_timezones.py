#!/usr/bin/env python3
"""Pazaryeri sipariş saatlerini bir kerelik düzeltir.

Trendyol orderDate (GMT+3 epoch) ve ShopPHP saat dilimsiz tarih, yerel
Türkiye saati UTC sanılarak saklanmıştı. Bu betik o duvar saatini
Europe/Istanbul kabul edip gerçek UTC'ye çevirir. Yeni içe aktarılan
kayıtlar `order_date_tz=utc` taşır ve tekrar kaydırılmaz.

Varsayılan dry-run'dır: kaç kaydın etkileneceğini yazar, veritabanını değiştirmez.

  python backend/scripts/fix_order_timezones.py
  python backend/scripts/fix_order_timezones.py --company comp_xxx
  python backend/scripts/fix_order_timezones.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _summary_line(report: dict) -> str:
    channels = report.get("by_channel") or {}
    parts = ", ".join(f"{name} {count}" for name, count in sorted(channels.items()))
    detail = f" ({parts})" if parts else ""
    if report.get("dry_run"):
        return f"dry-run: {report.get('affected', 0)} sipariş etkilenecek{detail}. Veritabanı değişmedi."
    return f"uygulandı: {report.get('updated', 0)} sipariş güncellendi{detail}."


async def _main(company_id: str, apply: bool) -> int:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    try:
        from setup_state import apply_saved_secrets
        apply_saved_secrets()
    except Exception:
        pass

    from mysql_store import MySQLClient
    from order_time import collect_order_date_fixes

    db = MySQLClient()
    report = await collect_order_date_fixes(db, company_id=company_id or None, apply=apply)
    print(_summary_line(report))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Pazaryeri sipariş saatlerini UTC'ye çevir (dry-run varsayılan)")
    parser.add_argument("--company", default="", help="Yalnızca bu company_id")
    parser.add_argument("--dry-run", action="store_true", help="Yalnızca rapor (varsayılan)")
    parser.add_argument("--apply", action="store_true", help="Düzeltmeyi veritabanına yaz")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(args.company.strip(), apply=bool(args.apply))))


if __name__ == "__main__":
    main()
