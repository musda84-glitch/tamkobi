#!/usr/bin/env python3
"""Sipariş taslağı ile irsaliye faturası arasındaki boşlukları listeler.

Varsayılan ve tek kip dry-run'dur. Mevcut fatura, irsaliye ve sipariş
kayıtlarına yazılmaz; numara sayacı değiştirilmez.

  python backend/scripts/report_dispatch_invoice_gaps.py
  python backend/scripts/report_dispatch_invoice_gaps.py --company comp_xxx
  python backend/scripts/report_dispatch_invoice_gaps.py --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _draft_sales(inv: dict) -> bool:
    if not inv or inv.get("invoice_type") == "dispatch":
        return False
    if str(inv.get("status") or "draft").lower() != "draft":
        return False
    return str(inv.get("einvoice_state") or "draft").lower() not in ("sent", "queued", "accepted")


def _local_irs(value) -> bool:
    return str(value or "").strip().upper().startswith("IRS-")


async def collect_report(db, company_id: str = "") -> dict:
    """Çift taslak ve GİB numarası olmayan irsaliye referanslarını sayar."""
    query = {}
    if company_id:
        query["company_id"] = company_id
    orders = await db.orders.find(query).to_list(5000)
    invoices = await db.invoices.find(query).to_list(8000)
    by_id = {str(row.get("_id")): row for row in invoices}
    dispatch_by_order = {}
    for row in invoices:
        if row.get("invoice_type") != "dispatch":
            continue
        oid = str(row.get("order_id") or "").strip()
        if not oid:
            continue
        dispatch_by_order.setdefault(oid, []).append(str(row.get("invoice_number") or row.get("_id")))

    duplicate_drafts = []
    for order in orders:
        oid = str(order.get("_id") or "")
        iid = str(order.get("invoice_id") or "").strip()
        linked = by_id.get(iid)
        has_dispatch = bool(order.get("dispatch_id") or dispatch_by_order.get(oid))
        if not has_dispatch or not _draft_sales(linked):
            continue
        duplicate_drafts.append({
            "company_id": order.get("company_id"),
            "order_id": oid,
            "order_number": order.get("order_number"),
            "draft_invoice_id": iid,
            "draft_invoice_number": linked.get("invoice_number"),
            "dispatch_numbers": dispatch_by_order.get(oid) or [order.get("dispatch_number")],
        })

    local_refs = []
    for row in invoices:
        if row.get("invoice_type") == "dispatch":
            continue
        numbers = [str(n).strip() for n in (row.get("dispatch_numbers") or []) if str(n or "").strip()]
        one = str(row.get("dispatch_number") or "").strip()
        if one and one not in numbers:
            numbers.append(one)
        local = [n for n in numbers if _local_irs(n)]
        gib_ids = [str(n).strip() for n in (row.get("despatch_gib_ids") or []) if str(n or "").strip()]
        if not local or gib_ids:
            continue
        local_refs.append({
            "company_id": row.get("company_id"),
            "invoice_id": row.get("_id"),
            "invoice_number": row.get("invoice_number"),
            "status": row.get("status"),
            "dispatch_numbers": local,
        })

    return {
        "dry_run": True,
        "company_id": company_id or None,
        "orders_scanned": len(orders),
        "invoices_scanned": len(invoices),
        "intake_draft_with_dispatch": len(duplicate_drafts),
        "local_despatch_ref_without_gib_id": len(local_refs),
        "duplicate_drafts": duplicate_drafts,
        "local_refs": local_refs,
    }


def _summary(report: dict) -> str:
    return (
        "dry-run: "
        f"{report.get('intake_draft_with_dispatch', 0)} siparişte geliş taslağı ve irsaliye birlikte, "
        f"{report.get('local_despatch_ref_without_gib_id', 0)} faturada yerel IRS referansı var. "
        "Veritabanı değişmedi."
    )


async def _main(company_id: str) -> int:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    try:
        from setup_state import apply_saved_secrets
        apply_saved_secrets()
    except Exception:
        pass

    from mysql_store import MySQLClient

    db = MySQLClient()
    report = await collect_report(db, company_id)
    print(_summary(report))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description="İrsaliye-fatura boşluk raporu (yalnızca dry-run)")
    parser.add_argument("--company", default="", help="Yalnızca bu company_id")
    parser.add_argument("--dry-run", action="store_true", help="Yalnızca rapor (varsayılan, tek kip)")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(args.company.strip())))


if __name__ == "__main__":
    main()
