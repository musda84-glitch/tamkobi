#!/usr/bin/env python3
"""Mükerrer GİB kontör düşümlerini raporla (varsayılan dry-run) veya düzelt.

type=consume kayıtları {company_id, invoice_id} ile gruplanır (invoice_id dolu).
count>1 ise en eski kayıt kalır; fazlalık silinmez. --apply her fazla kayıt için
type=dedupe_reversal (+1) yazar ve cüzdanı $inc ile aynı tutarda yükseltir.

Ayrıca integrator alanı gerçek entegratör olup gib_tracking_id "GIB-" ile başlayan
faturaları yalnız sayı ve fatura numarasıyla raporlar.

  python backend/scripts/gib_credit_dedupe.py
  python backend/scripts/gib_credit_dedupe.py --dry-run
  python backend/scripts/gib_credit_dedupe.py --apply
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

REVERSAL_TYPE = "dedupe_reversal"
REVERSAL_NOTE = "Mükerrer kontör düşümü düzeltmesi"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mükerrer GİB kontör düşümlerini listele veya düzelt")
    parser.add_argument("--dry-run", action="store_true", help="Yalnız raporla (varsayılan)")
    parser.add_argument("--apply", action="store_true", help="Reversal yaz ve cüzdan bakiyesini düzelt")
    return parser


def apply_requested(args) -> bool:
    return bool(getattr(args, "apply", False)) and not bool(getattr(args, "dry_run", False))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _rows(cursor, limit: int = 100000) -> list:
    if cursor is None:
        return []
    to_list = getattr(cursor, "to_list", None)
    if to_list is None:
        return []
    found = to_list(limit)
    if hasattr(found, "__await__"):
        found = await found
    return [row for row in (found or []) if isinstance(row, dict)]


def _pair(row: dict):
    company_id = str(row.get("company_id") or "").strip()
    invoice_id = str(row.get("invoice_id") or "").strip()
    if not company_id or not invoice_id:
        return None
    return company_id, invoice_id


def _oldest(rows: list) -> list:
    return sorted(rows, key=lambda row: (str(row.get("created_at") or ""), str(row.get("_id") or "")))


def _real_integrators():
    from e_invoice import REAL_INTEGRATOR_PROVIDERS

    return tuple(REAL_INTEGRATOR_PROVIDERS)


async def build_plan(db) -> dict:
    ledger = await _rows(db.gib_credit_ledger.find({}))
    consumes = [row for row in ledger if row.get("type") == "consume"]
    reversals = [row for row in ledger if row.get("type") == REVERSAL_TYPE]
    grouped: dict = {}
    for row in consumes:
        key = _pair(row)
        if key is None:
            continue
        grouped.setdefault(key, []).append(row)
    reversed_ids = {str(row.get("reverses") or "") for row in reversals if row.get("reverses")}
    reversal_by_pair: dict = {}
    for row in reversals:
        key = _pair(row)
        if key is None:
            continue
        reversal_by_pair[key] = reversal_by_pair.get(key, 0) + 1

    planned = []
    wallet_delta: dict = {}
    for key, rows in grouped.items():
        ordered = _oldest(rows)
        extras = ordered[1:]
        already = reversal_by_pair.get(key, 0)
        need = max(0, len(rows) - 1 - already)
        pending = [row for row in extras if str(row.get("_id") or "") not in reversed_ids][:need]
        if not pending:
            continue
        company_id, invoice_id = key
        for row in pending:
            wallet_id = str(row.get("wallet_id") or ordered[0].get("wallet_id") or "").strip()
            planned.append({
                "_id": str(uuid.uuid4()),
                "wallet_id": wallet_id,
                "company_id": company_id,
                "type": REVERSAL_TYPE,
                "credits": 1,
                "invoice_id": invoice_id,
                "reverses": str(row.get("_id") or ""),
                "note": REVERSAL_NOTE,
                "created_at": _now(),
            })
            if wallet_id:
                wallet_delta[wallet_id] = wallet_delta.get(wallet_id, 0) + 1

    simulated = await _simulated_integrator_invoices(db)
    groups = {(row["company_id"], row["invoice_id"]) for row in planned}
    return {
        "reversals": planned,
        "wallet_increments": [
            {"wallet_id": wallet_id, "credits": credits}
            for wallet_id, credits in sorted(wallet_delta.items())
        ],
        "duplicate_groups": len(groups),
        "simulated_integrator_invoices": simulated,
    }


async def _simulated_integrator_invoices(db) -> dict:
    real = set(_real_integrators())
    rows = await _rows(db.invoices.find({}))
    numbers = []
    count = 0
    for row in rows:
        integrator = str(row.get("integrator") or "").strip()
        tracking = str(row.get("gib_tracking_id") or "")
        if integrator not in real or not tracking.startswith("GIB-"):
            continue
        count += 1
        number = str(row.get("invoice_number") or "").strip()
        if number:
            numbers.append(number)
    return {"count": count, "invoice_numbers": numbers}


def public_report(plan: dict, *, dry_run: bool) -> dict:
    simulated = plan.get("simulated_integrator_invoices") or {}
    return {
        "dry_run": dry_run,
        "applied": not dry_run,
        "duplicate_groups": int(plan.get("duplicate_groups") or 0),
        "reversal_count": len(plan.get("reversals") or []),
        "wallet_increments": list(plan.get("wallet_increments") or []),
        "simulated_integrator_invoices": {
            "count": int(simulated.get("count") or 0),
            "invoice_numbers": list(simulated.get("invoice_numbers") or []),
        },
    }


async def run(db, *, apply: bool = False) -> dict:
    plan = await build_plan(db)
    if not apply:
        return public_report(plan, dry_run=True)
    for doc in plan["reversals"]:
        await db.gib_credit_ledger.insert_one(dict(doc))
    now = _now()
    for inc in plan["wallet_increments"]:
        await db.gib_wallets.update_one(
            {"_id": inc["wallet_id"]},
            {"$inc": {"balance": int(inc["credits"])}, "$set": {"updated_at": now}},
        )
    return public_report(plan, dry_run=False)


async def _main(apply: bool) -> int:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    try:
        from setup_state import apply_saved_secrets

        apply_saved_secrets()
    except Exception:
        pass
    from mysql_store import MySQLClient

    db = MySQLClient()
    report = await run(db, apply=apply)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    raise SystemExit(asyncio.run(_main(apply_requested(args))))


if __name__ == "__main__":
    main()
