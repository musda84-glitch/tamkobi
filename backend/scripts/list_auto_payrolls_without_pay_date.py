#!/usr/bin/env python3
"""Hak ediş tarihi boş personelde otomatik oluşmuş bordroları listele (salt okunur).

19fc965d sonrası pay_start_date yokken işe giriş / dönem başı ile yazılmış
manual=false, source_type=personnel_payment bordroları bulur.
Düzeltme önerisi olarak ilgili personnel_movements id'sini yazar.
Hiçbir şey silmez / güncellemez.

  python backend/scripts/list_auto_payrolls_without_pay_date.py
  python backend/scripts/list_auto_payrolls_without_pay_date.py --company comp_xxx
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Hak ediş tarihi boş personelde otomatik bordroları listele (silmez)",
    )
    parser.add_argument("--company", default="", help="Yalnızca bu company_id")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Yalnızca listele (varsayılan; bu script yazmaz)",
    )
    return parser


def pay_start_blank(emp: Optional[Dict[str, Any]]) -> bool:
    return not str((emp or {}).get("pay_start_date") or "").strip()


def is_auto_payment_payroll(payroll: Dict[str, Any]) -> bool:
    if payroll.get("manual") in (True, 1, "1", "true", "True"):
        return False
    return str(payroll.get("source_type") or "") == "personnel_payment"


def suggested_movement_id(
    payroll: Dict[str, Any],
    movements: Optional[Iterable[Dict[str, Any]]] = None,
) -> Optional[str]:
    for key in ("source_id", "personnel_movement_id"):
        sid = str(payroll.get(key) or "").strip()
        if sid:
            return sid
    pid = str(payroll.get("_id") or payroll.get("id") or "")
    if not pid:
        return None
    for mov in movements or []:
        mid = mov.get("_id") or mov.get("id")
        for effect in mov.get("effects") or []:
            if not isinstance(effect, dict):
                continue
            if effect.get("collection") == "payrolls" and str(effect.get("id") or "") == pid:
                return mid
        if str(mov.get("source_id") or "") == pid:
            return mid
    return None


def match_rows(
    payrolls: Iterable[Dict[str, Any]],
    employees: Iterable[Dict[str, Any]],
    movements: Optional[Iterable[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    by_emp = {(e.get("_id") or e.get("id")): e for e in employees}
    rows: List[Dict[str, Any]] = []
    for payroll in payrolls:
        if not is_auto_payment_payroll(payroll):
            continue
        emp = by_emp.get(payroll.get("employee_id"))
        if emp is None or not pay_start_blank(emp):
            continue
        movement_id = suggested_movement_id(payroll, movements)
        rows.append({
            "payroll_id": payroll.get("_id") or payroll.get("id"),
            "company_id": payroll.get("company_id") or emp.get("company_id"),
            "employee_id": payroll.get("employee_id"),
            "employee_name": emp.get("full_name") or payroll.get("employee_name"),
            "period": payroll.get("period"),
            "amount": payroll.get("final_payable") if payroll.get("final_payable") is not None else payroll.get("net_salary"),
            "suggested_personnel_movement_id": movement_id,
            "correction": (
                f"personnel_movements id={movement_id} kaydını inceleyin"
                if movement_id else
                "bağlı personnel_movements bulunamadı"
            ),
        })
    return rows


async def _to_list(cursor, limit: int = 8000) -> List[dict]:
    if cursor is None:
        return []
    if hasattr(cursor, "to_list"):
        return await cursor.to_list(limit)
    return list(cursor)


async def collect_report(db, company_id: str = "") -> Dict[str, Any]:
    query: Dict[str, Any] = {}
    if company_id:
        query["company_id"] = company_id
    payrolls = [
        p for p in await _to_list(db.payrolls.find({**query, "source_type": "personnel_payment"}))
        if is_auto_payment_payroll(p)
    ]
    emp_ids = [p.get("employee_id") for p in payrolls if p.get("employee_id")]
    employees: List[dict] = []
    if emp_ids:
        employees = await _to_list(db.employees.find({"_id": {"$in": list(dict.fromkeys(emp_ids))}}))
    move_ids = []
    for p in payrolls:
        for key in ("source_id", "personnel_movement_id"):
            sid = str(p.get(key) or "").strip()
            if sid:
                move_ids.append(sid)
    movements: List[dict] = []
    if move_ids:
        movements = await _to_list(db.personnel_movements.find({"_id": {"$in": list(dict.fromkeys(move_ids))}}))
    rows = match_rows(payrolls, employees, movements)
    return {
        "dry_run": True,
        "company_id": company_id or None,
        "count": len(rows),
        "rows": rows,
        "deleted": 0,
        "message": "salt okunur: hiçbir kayıt silinmedi",
    }


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
    print(f"dry-run: {report['count']} otomatik bordro (pay_start_date boş). Veritabanı değişmedi.")
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 0


def main() -> None:
    args = build_parser().parse_args()
    raise SystemExit(asyncio.run(_main(str(args.company or "").strip())))


if __name__ == "__main__":
    main()
