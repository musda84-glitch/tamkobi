#!/usr/bin/env python3
"""Boş cari VKN/TCKN ve vergi dairesini satış faturalarından doldur.

Varsayılan dry-run: etkilenecek cari sayısını yazar, kayıt değiştirmez.
  python backend/scripts/backfill_contact_tax.py
  python backend/scripts/backfill_contact_tax.py --company comp_xxx
  python backend/scripts/backfill_contact_tax.py --apply

İkinci çalıştırma aynı kartlara dokunmaz (yalnızca hâlâ boş alanlar dolar).
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
    from contact_tax import plan_sales_invoice_tax_backfill

    db = MySQLClient()
    cq = {"company_id": company_id} if company_id else {}
    iq = {"invoice_type": "sales"}
    if company_id:
        iq["company_id"] = company_id
    contacts = await db.contacts.find(cq, {
        "name": 1, "company_id": 1, "tax_number_or_id": 1, "tax_office": 1,
    }).to_list(100000)
    invoices = await db.invoices.find(iq, {
        "contact_id": 1, "invoice_type": 1, "status": 1, "invoice_number": 1,
        "contact_tax_id": 1, "buyer_tax_id": 1, "contact_tax_office": 1,
        "issue_date": 1, "created_at": 1, "company_id": 1,
    }).to_list(100000)
    plans = plan_sales_invoice_tax_backfill(contacts, invoices)
    summary = {
        "dry_run": not apply,
        "company_id": company_id or None,
        "contacts_scanned": len(contacts),
        "sales_invoices_scanned": len(invoices),
        "would_update": len(plans),
        "samples": plans[:20],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not apply:
        print(json.dumps({"note": "Dry-run. Yazmak için --apply verin."}, ensure_ascii=False))
        return 0
    updated = 0
    for plan in plans:
        await db.contacts.update_one({"_id": plan["contact_id"]}, {"$set": plan["patch"]})
        updated += 1
    print(json.dumps({"applied": updated}, ensure_ascii=False))
    return 0


def main():
    p = argparse.ArgumentParser(description="Boş cari VKN/vergi dairesini satış faturalarından doldur")
    p.add_argument("--company", default="", help="Yalnızca bu company_id (boşsa tüm firmalar)")
    p.add_argument("--dry-run", action="store_true", default=True, help="Değişiklik yapma (varsayılan)")
    p.add_argument("--apply", action="store_true", help="Kartlara yaz")
    args = p.parse_args()
    raise SystemExit(asyncio.run(_main(str(args.company or "").strip(), apply=bool(args.apply))))


if __name__ == "__main__":
    main()
