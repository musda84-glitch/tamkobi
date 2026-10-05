"""Personel alacak hak edişi: tarih, aylık tekrar, satır seçimi."""
from datetime import datetime, timezone, date as dt_date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

import partner_pay

MEAL_CAT = "Yemek"
TRANSPORT_CAT = "Yol / Ulaşım"
ALLOWANCE_KINDS = (
    ("meal", "meal_allowance", MEAL_CAT, "Aylık yemek hakkı"),
    ("transport", "transport_allowance", TRANSPORT_CAT, "Aylık yol hakkı"),
)

PAY_KIND_FIELDS = (
    ("salary", "unpaid_payroll"),
    ("overtime", "overtime_due"),
    ("bonus", "bonus_pending"),
    ("meal", "meal_due"),
    ("transport", "transport_due"),
    ("expense", "unpaid_expenses"),
)


def today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def prepare_employee_pay(doc: Dict[str, Any], *, fill_start: bool = False) -> Dict[str, Any]:
    """pay_start_date / pay_day / pay_recurring doğrula."""
    out = dict(doc)
    if "pay_recurring" in doc:
        out["pay_recurring"] = bool(doc["pay_recurring"])
    if "pay_start_date" in doc:
        raw = doc.get("pay_start_date")
        if raw in ("", None):
            out["pay_start_date"] = None
        else:
            d = partner_pay.parse_iso_date(raw)
            if not d:
                raise HTTPException(status_code=400, detail="Hak ediş tarihi geçersiz.")
            out["pay_start_date"] = d.isoformat()
            out["pay_day"] = d.day
    elif "pay_day" in doc:
        try:
            out["pay_day"] = min(31, max(1, int(doc["pay_day"])))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Hak ediş günü geçersiz.")
    if fill_start and not out.get("pay_start_date"):
        today = datetime.now(timezone.utc).date()
        out["pay_start_date"] = today.isoformat()
        out["pay_day"] = today.day
        out.setdefault("pay_recurring", True)
    return out


def due_lines(balance: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    b = balance or {}
    rows = []
    for key, field in PAY_KIND_FIELDS:
        try:
            amt = round(float(b.get(field) or 0), 2)
        except (TypeError, ValueError):
            amt = 0.0
        if amt > 0.004:
            rows.append({"key": key, "field": field, "amount": amt})
    return rows


def selected_kinds(req: Dict[str, Any], lines: List[Dict[str, Any]]) -> List[str]:
    mode = (req.get("mode") or "all").strip().lower()
    available = [r["key"] for r in lines]
    if mode != "split":
        return available
    raw = req.get("kinds") or []
    if isinstance(raw, str):
        raw = [raw]
    picked = [str(k) for k in raw if k in available]
    if not picked and not req.get("advance") and not (req.get("new_expense") or {}).get("amount"):
        raise HTTPException(status_code=400, detail="Ayrı ayrı ödeme için en az bir kalem seçin.")
    return picked


def pay_slot_emp(emp: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "salary_start_date": emp.get("pay_start_date"),
        "salary_day": emp.get("pay_day"),
        "salary_recurring": emp.get("pay_recurring"),
    }


async def accrue_allowances(
    db,
    company_id: str,
    *,
    employee_id: Optional[str] = None,
    as_of: Optional[str] = None,
    force_start: bool = False,
    generate_payroll_fn=None,
) -> Dict[str, Any]:
    """Hak ediş tarihinde yemek/yol masrafını (ödenmemiş) yazar. Aynı ay tekrar etmez."""
    today = partner_pay.parse_iso_date(as_of) or datetime.now(timezone.utc).date()
    q: Dict[str, Any] = {"company_id": company_id}
    if employee_id:
        q = {"_id": employee_id}
    cursor = db.employees.find(q)
    employees = await cursor.to_list(500) if hasattr(cursor, "to_list") else list(cursor)
    posted: List[dict] = []
    skipped: List[dict] = []
    for emp in employees:
        if emp.get("status") == "terminated":
            skipped.append({"employee_id": emp.get("_id"), "reason": "terminated"})
            continue
        if not emp.get("pay_start_date"):
            skipped.append({"employee_id": emp.get("_id"), "reason": "no_date"})
            continue
        slots = partner_pay.salary_slots(pay_slot_emp(emp), today, force_start=force_start)
        if not slots:
            skipped.append({"employee_id": emp.get("_id"), "reason": "not_due"})
            continue
        for per, due in slots:
            if generate_payroll_fn:
                try:
                    await generate_payroll_fn({
                        "company_id": emp.get("company_id") or company_id,
                        "period": per,
                        "employee_id": emp["_id"],
                    })
                except Exception:  # noqa: BLE001
                    skipped.append({"employee_id": emp.get("_id"), "reason": "payroll", "period": per})
            for kind, field, cat, desc in ALLOWANCE_KINDS:
                try:
                    amount = round(float(emp.get(field) or 0), 2)
                except (TypeError, ValueError):
                    amount = 0.0
                if amount <= 0:
                    continue
                exists = await db.expenses.find_one({
                    "employee_id": emp["_id"],
                    "category": cat,
                    "allowance_period": per,
                    "source": "employee_allowance",
                })
                if exists:
                    skipped.append({"employee_id": emp["_id"], "reason": "already", "period": per, "kind": kind})
                    continue
                doc = {
                    "_id": f"alw_{emp['_id']}_{kind}_{per}",
                    "company_id": emp.get("company_id") or company_id,
                    "expense_number": f"HAK-{kind[:1].upper()}-{per}-{str(emp['_id'])[-4:]}",
                    "date": due.isoformat(),
                    "category": cat,
                    "description": f"{desc} · {partner_pay.salary_period_label(per)}",
                    "amount": amount,
                    "vat_rate": 0,
                    "vat_amount": 0,
                    "total": amount,
                    "currency": "TRY",
                    "fx_rate": 1,
                    "local_total": amount,
                    "payment_status": "unpaid",
                    "employee_id": emp["_id"],
                    "employee_name": emp.get("full_name"),
                    "notes": desc,
                    "source": "employee_allowance",
                    "allowance_period": per,
                    "allowance_kind": kind,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.expenses.insert_one(doc)
                posted.append({"employee_id": emp["_id"], "kind": kind, "amount": amount, "period": per, "date": due.isoformat()})
    return {
        "status": "success",
        "as_of": today.isoformat(),
        "posted": posted,
        "skipped": skipped,
        "posted_count": len(posted),
        "message": f"{len(posted)} hak ediş masrafı yazıldı." if posted else "Yazılacak yeni yemek/yol hakkı yok.",
    }


async def accrue_due_for_all_companies(db, as_of: Optional[str] = None, generate_payroll_fn=None) -> Dict[str, Any]:
    cursor = db.employees.find({})
    employees = await cursor.to_list(5000) if hasattr(cursor, "to_list") else list(cursor)
    seen = set()
    posted = 0
    companies = 0
    for e in employees:
        cid = e.get("company_id")
        if not cid or cid in seen:
            continue
        seen.add(cid)
        companies += 1
        r = await accrue_allowances(db, cid, as_of=as_of, generate_payroll_fn=generate_payroll_fn)
        posted += int(r.get("posted_count") or 0)
    return {"posted_count": posted, "companies": companies}


async def scheduler_loop(db, generate_payroll_fn=None):
    import asyncio
    import logging
    log = logging.getLogger("employee_pay")
    await asyncio.sleep(55)
    while True:
        try:
            r = await accrue_due_for_all_companies(db, generate_payroll_fn=generate_payroll_fn)
            if r.get("posted_count"):
                log.info("employee allowance scheduler posted %s", r["posted_count"])
        except Exception as exc:  # noqa: BLE001
            log.warning("employee allowance scheduler: %s", exc)
        await asyncio.sleep(3600)
