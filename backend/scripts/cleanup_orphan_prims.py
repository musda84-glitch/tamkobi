#!/usr/bin/env python3
"""Kalıcı silinmiş personele ait, kasa/banka/ortak hareketi olmayan primleri temizler.

Yalnızca --company ile verilen firmanın bonus_payments satırlarına bakar.
Personeli duran, çöp kutusundaki veya bağlı hareketi olan primlere dokunmaz.
Çöpteki personel: entity_type=employee ve original_id (yoksa doc._id) eşleşmesi.
Kalıcı silinmiş personelin ödenmiş ama hareketsiz primi --apply ile silinebilir.
Varsayılan dry-run'dur; veritabanı --apply ile değişir. İkinci çalıştırma
silinecek kayıt kalmadığında no-op'tur.

  python backend/scripts/cleanup_orphan_prims.py --company comp_xxx
  python backend/scripts/cleanup_orphan_prims.py --company comp_xxx --dry-run
  python backend/scripts/cleanup_orphan_prims.py --company comp_xxx --apply
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logger = logging.getLogger("cleanup_orphan_prims")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Silinmiş personelin hareketi olmayan prim kayıtlarını listele veya sil",
    )
    parser.add_argument("--company", required=True, help="Yalnızca bu company_id")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Yalnızca listele (varsayılan)")
    mode.add_argument("--apply", action="store_true", help="Uygun prim kayıtlarını sil")
    return parser


def _summary(row: dict) -> Dict[str, Any]:
    return {
        "bonus_id": row.get("_id"),
        "company_id": row.get("company_id"),
        "employee_id": row.get("employee_id"),
        "employee_name": row.get("employee_name"),
        "amount": row.get("amount"),
        "type": row.get("type"),
        "status": row.get("status"),
    }


async def _live_employee_ids(db, company_id: str) -> set:
    rows = await db.employees.find({"company_id": company_id}, {"_id": 1}).to_list(20000)
    return {str(row.get("_id")) for row in rows if row.get("_id")}


def _trash_employee_id(row: dict) -> str:
    """Çöp kaydındaki personel kimliği. original_id yoksa belgenin _id'si."""
    original = str(row.get("original_id") or "").strip()
    if original:
        return original
    doc = row.get("doc") if isinstance(row.get("doc"), dict) else {}
    return str(doc.get("_id") or "").strip()


async def _trashed_employee_ids(db, company_id: str) -> set:
    """Bu firmanın çöpündeki personel kimlikleri. Başka firmanın çöpü sayılmaz."""
    rows = await db.trash.find({"company_id": company_id, "entity_type": "employee"}).to_list(20000)
    out = set()
    for row in rows:
        if str(row.get("entity_type") or "") != "employee":
            continue
        if str(row.get("company_id") or "") != company_id:
            continue
        employee_id = _trash_employee_id(row)
        if employee_id:
            out.add(employee_id)
    return out


async def has_linked_money_move(db, bonus_id: str, company_id: str) -> bool:
    """Bağlı kasa/banka veya ortak hareketi varsa kayıt silinmez."""
    import linked_moves

    found = await linked_moves.find_linked(db, "personnel_bonus", str(bonus_id), company_id=company_id)
    return bool(found.get("bank_transactions") or found.get("partner_transactions"))


async def orphan_prim_candidates(db, company_id: str) -> List[dict]:
    """Personeli kalıcı silinmiş ve bağlı kasa/banka/ortak hareketi olmayan primler.

    Çöp kutusundaki personelin primleri aday değildir. Ödenmiş olmak engel değildir.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id gerekli")
    live = await _live_employee_ids(db, cid)
    trashed = await _trashed_employee_ids(db, cid)
    bonuses = await db.bonus_payments.find({"company_id": cid}).to_list(20000)
    out: List[dict] = []
    for row in bonuses:
        if str(row.get("company_id") or "") != cid:
            continue
        employee_id = str(row.get("employee_id") or "").strip()
        if not employee_id or employee_id in live or employee_id in trashed:
            continue
        if await has_linked_money_move(db, str(row.get("_id")), cid):
            continue
        out.append(row)
    return out


async def cleanup_orphan_prims(db, company_id: str, *, apply: bool) -> Dict[str, Any]:
    """Dry-run listeler. apply=True iken adayları siler ve her silmeyi loglar."""
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id gerekli")
    rows = await orphan_prim_candidates(db, cid)
    listed: List[dict] = []
    deleted: List[dict] = []
    for row in rows:
        employee_id = str(row.get("employee_id") or "").strip()
        bonus_id = row.get("_id")
        still = await db.employees.find_one({"_id": employee_id, "company_id": cid})
        if still or not bonus_id:
            continue
        if employee_id in await _trashed_employee_ids(db, cid):
            continue
        if await has_linked_money_move(db, str(bonus_id), cid):
            continue
        entry = _summary(row)
        if not apply:
            listed.append(entry)
            continue
        await db.bonus_payments.delete_one({"_id": bonus_id, "company_id": cid})
        deleted.append(entry)
        logger.info("silindi %s", json.dumps(entry, ensure_ascii=False, default=str))
    return {
        "company_id": cid,
        "dry_run": not apply,
        "count": len(listed if not apply else deleted),
        "rows": listed if not apply else deleted,
    }


async def _main(company_id: str, apply: bool) -> int:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    try:
        from setup_state import apply_saved_secrets

        apply_saved_secrets()
    except Exception:
        pass

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    from mysql_store import MySQLClient

    db = MySQLClient()
    report = await cleanup_orphan_prims(db, company_id, apply=apply)
    if report["dry_run"]:
        print(f"dry-run: {report['count']} sahipsiz prim. Veritabanı değişmedi.")
    else:
        print(f"uygulandı: {report['count']} prim silindi.")
        for row in report["rows"]:
            print("silindi " + json.dumps(row, ensure_ascii=False, default=str))
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 0


def main() -> None:
    args = build_parser().parse_args()
    # Yazma yalnız --apply ile. Bayrak yoksa veya --dry-run ise listele.
    raise SystemExit(asyncio.run(_main(args.company.strip(), bool(args.apply))))


if __name__ == "__main__":
    main()
