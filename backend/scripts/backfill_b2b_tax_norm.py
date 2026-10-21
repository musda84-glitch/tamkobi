#!/usr/bin/env python3
"""Cari VKN/TCKN için tax_norm alanını doldurur. tax_number_or_id değişmez.

Varsayılan dry-run: yazılacak kart sayısını basar, kayıt değiştirmez.
  python backend/scripts/backfill_b2b_tax_norm.py
  python backend/scripts/backfill_b2b_tax_norm.py --company comp_xxx
  python backend/scripts/backfill_b2b_tax_norm.py --apply
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


async def _main(company_id: str, apply: bool) -> int:
    from mysql_store import MySQLClient
    from b2b_identity import plan_tax_norm_backfill

    db = MySQLClient()
    query = {"company_id": company_id} if company_id else {}
    contacts = await db.contacts.find(query, {
        "company_id": 1, "tax_number_or_id": 1, "tax_norm": 1,
    }).to_list(100000)
    plans = plan_tax_norm_backfill(contacts)
    summary = {
        "dry_run": not apply,
        "company_id": company_id or None,
        "contacts_scanned": len(contacts),
        "would_update": len(plans),
        "samples": plans[:20],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not apply:
        print(json.dumps({"note": "Dry-run. Yazmak için --apply verin."}, ensure_ascii=False))
        return 0
    updated = 0
    for plan in plans:
        filt = {"_id": plan["contact_id"]}
        if plan.get("company_id"):
            filt["company_id"] = plan["company_id"]
        await db.contacts.update_one(filt, {"$set": plan["patch"]})
        updated += 1
    print(json.dumps({"applied": updated}, ensure_ascii=False))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Cari tax_norm alanını VKN/TCKN rakamlarından doldur")
    parser.add_argument("--company", default="", help="Yalnızca bu company_id")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Değişiklik yapma (varsayılan)")
    parser.add_argument("--apply", action="store_true", help="Kartlara tax_norm yaz")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(str(args.company or "").strip(), apply=bool(args.apply))))


if __name__ == "__main__":
    main()
