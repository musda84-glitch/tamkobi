#!/usr/bin/env python3
"""Eksik çek/senet ciro satırlarını cari Ödemeler listesine yazar.

Ciro sırasında cari bakiyesi zaten işlenmiştir. Bu betik yalnız
bank_transactions görünürlük satırını ekler; bakiyeye $inc yapmaz.

Varsayılan dry-run: adayları sayar, kayıt yazmaz.
  python backend/scripts/backfill_cheque_endorsements.py
  python backend/scripts/backfill_cheque_endorsements.py --company comp_xxx
  python backend/scripts/backfill_cheque_endorsements.py --apply

İkinci çalıştırma aynı çeke yeniden satır yazmaz.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def _company_ids(db, company_id: str) -> list:
    if company_id:
        return [company_id]
    rows = await db.companies.find({}).to_list(5000)
    out = []
    for row in rows or []:
        cid = str((row or {}).get("_id") or (row or {}).get("id") or "").strip()
        if cid:
            out.append(cid)
    return out


async def _main(company_id: str, apply: bool) -> int:
    from mysql_store import MySQLClient
    import cheques

    db = MySQLClient()
    summaries = []
    for cid in await _company_ids(db, company_id):
        summaries.append(await cheques.backfill_endorsement_rows(db, company_id=cid, apply=apply))
    print(json.dumps({
        "dry_run": not apply,
        "company_id": company_id or None,
        "companies": summaries,
        "candidates": sum(int(row.get("candidates") or 0) for row in summaries),
        "inserted": sum(int(row.get("inserted") or 0) for row in summaries),
    }, ensure_ascii=False, indent=2))
    if not apply:
        print(json.dumps({"note": "Dry-run. Yazmak için --apply verin."}, ensure_ascii=False))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Eksik çek ciro satırlarını Ödemeler listesine yazar")
    parser.add_argument("--company", default="", help="Yalnızca bu company_id (boşsa tüm firmalar)")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Değişiklik yapma (varsayılan)")
    parser.add_argument("--apply", action="store_true", help="Eksik satırları yaz")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(str(args.company or "").strip(), apply=bool(args.apply))))


if __name__ == "__main__":
    main()
