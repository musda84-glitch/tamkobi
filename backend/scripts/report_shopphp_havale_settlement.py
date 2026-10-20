#!/usr/bin/env python3
"""ShopPHP hakediş uyumsuzluklarını listeler.

Varsayılan dry-run'dır: onay bekleyen havale, PayTR hesabına yazılmış havale
veya liste fiyatından tahsil edilmiş kayıtları yazar. Veritabanını değiştirmez;
otomatik silme ve ters kayıt yapmaz.

  python backend/scripts/report_shopphp_havale_settlement.py
  python backend/scripts/report_shopphp_havale_settlement.py --company comp_xxx
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from marketplace_providers import shopphp_settlement_mismatch_reason  # noqa: E402


def _summary(report: dict) -> str:
    return (
        f"dry-run: {report.get('flagged', 0)} ShopPHP hakediş kaydı incelenmeli. "
        "Veritabanı değişmedi; silme veya ters kayıt yapılmadı."
    )


async def collect_report(db, company_id: str = "") -> dict:
    query = {"channel": "shopphp", "settlement.tx_id": {"$nin": [None, ""]}}
    if company_id:
        query["company_id"] = company_id
    orders = await db.orders.find(query).to_list(5000)
    configs = await db.integration_configs.find(
        {"channel": "shopphp", **({"company_id": company_id} if company_id else {})}
    ).to_list(200)
    card_by_company = {
        str(cfg.get("company_id") or ""): str(cfg.get("settlement_account_id") or "")
        for cfg in configs
    }
    rows = []
    for order in orders:
        reason = shopphp_settlement_mismatch_reason(
            order,
            card_by_company.get(str(order.get("company_id") or ""), ""),
        )
        if not reason:
            continue
        settlement = order.get("settlement") or {}
        rows.append({
            "order_id": order.get("_id"),
            "company_id": order.get("company_id"),
            "order_number": order.get("order_number"),
            "payment_status": order.get("payment_status") or order.get("marketplace_status"),
            "payment_type": order.get("payment_type"),
            "total_amount": order.get("total_amount"),
            "gross_total": order.get("gross_total"),
            "settlement_account_id": settlement.get("account_id"),
            "settlement_gross": settlement.get("gross"),
            "tx_id": settlement.get("tx_id"),
            "reason": reason,
        })
    return {"dry_run": True, "scanned": len(orders), "flagged": len(rows), "rows": rows}


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
    parser = argparse.ArgumentParser(description="ShopPHP hakediş uyumsuzluk raporu (yalnızca dry-run)")
    parser.add_argument("--company", default="", help="Yalnızca bu company_id")
    parser.add_argument("--dry-run", action="store_true", help="Yalnızca rapor (varsayılan, tek kip)")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(args.company.strip())))


if __name__ == "__main__":
    main()
