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


def _amt(v: Any, default: float = 0.0) -> float:
    try:
        return float(v if v is not None and v != "" else default)
    except (TypeError, ValueError):
        return float(default)


def extra_advance_due(
    bonuses: Optional[List[dict]],
    payrolls: Optional[List[dict]],
    *,
    counts_as_advance,
) -> float:
    """Açık avans / borç tutarı — kalan alacaktan düşülür (eksi bakiyeye izin).

    Dönem filtresi yok: gelecek dönem için erken ödenen avans da hemen borç yazar.
    Bordrodaki `advance_payment` (ödenen + bekleyen) mahsup edilir; böylece
    hakediş/bordro avansı bağladığında çift sayım olmaz.
    """
    advances = round(
        sum(_amt(b.get("amount")) for b in (bonuses or []) if counts_as_advance(b)),
        2,
    )
    recovered = round(
        sum(
            _amt(p.get("advance_payment"))
            for p in (payrolls or [])
            if p.get("status") != "rejected"
        ),
        2,
    )
    return round(max(0.0, advances - recovered), 2)


def compose_remaining(
    *,
    unpaid_payroll: float = 0,
    unpaid_expenses: float = 0,
    meal_due: float = 0,
    transport_due: float = 0,
    bonus_pending: float = 0,
    overtime_due: float = 0,
    extra_advance: float = 0,
    bakiye_paid: float = 0,
) -> float:
    """Kalan alacak: hak edişler − açık avans/bakiye ödemesi."""
    return round(
        unpaid_payroll
        + unpaid_expenses
        + meal_due
        + transport_due
        + bonus_pending
        + overtime_due
        - extra_advance
        - bakiye_paid,
        2,
    )


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
    if "salary" in [str(k) for k in raw] and "salary" not in picked:
        picked.append("salary")
    if not picked and not req.get("advance") and not (req.get("new_expense") or {}).get("amount"):
        raise HTTPException(status_code=400, detail="Ayrı ayrı ödeme için en az bir kalem seçin.")
    return picked


def pay_slot_emp(emp: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "salary_start_date": emp.get("pay_start_date"),
        "salary_day": emp.get("pay_day"),
        "salary_recurring": emp.get("pay_recurring"),
    }


def period_is_entitled(emp: Dict[str, Any], month: str, as_of: Optional[str] = None) -> bool:
    """Ay için hak ediş günü gelmiş mi? (maaş slotları ile aynı)."""
    if not emp or not emp.get("pay_start_date"):
        return False
    today = partner_pay.parse_iso_date(as_of) or datetime.now(timezone.utc).date()
    slots = partner_pay.salary_slots(pay_slot_emp(emp), today, explicit_period=month)
    return any(per == month and due <= today for per, due in slots)


def allowance_due(amount: Any, category: str, expenses: Optional[List[dict]], month: str) -> float:
    """Ay içinde aynı kategoride yazılmış masraf düşülmüş kalan hak."""
    try:
        amt = round(float(amount if amount is not None and amount != "" else 0), 2)
    except (TypeError, ValueError):
        amt = 0.0
    if amt <= 0:
        return 0.0
    recorded = 0.0
    for e in expenses or []:
        if e.get("category") != category:
            continue
        if not str(e.get("date") or "").startswith(month):
            continue
        try:
            recorded += float(e.get("total") or 0)
        except (TypeError, ValueError):
            pass
    return round(max(0.0, amt - round(recorded, 2)), 2)


def entitlement_allowance_due(
    emp: Dict[str, Any],
    amount: Any,
    category: str,
    expenses: Optional[List[dict]],
    month: str,
    as_of: Optional[str] = None,
) -> float:
    """Hak ediş günü gelmeden yemek/yol alacağı 0 (maaş gibi)."""
    if not period_is_entitled(emp, month, as_of=as_of):
        return 0.0
    return allowance_due(amount, category, expenses, month)


def allowance_save_message(accrual: Optional[Dict[str, Any]], start_date: Optional[str] = None) -> str:
    """Kayıt sonrası kullanıcı mesajı — ortak maaş akışıyla aynı dil."""
    if not accrual:
        return "Kaydedildi."
    if int(accrual.get("posted_count") or 0) > 0:
        return accrual.get("message") or "Yemek/yol hak edişi yazıldı."
    due = accrual.get("scheduled_date") or next(
        (s.get("due_date") for s in (accrual.get("skipped") or []) if s.get("reason") == "not_due" and s.get("due_date")),
        None,
    ) or start_date
    if due:
        raw = str(due)[:10]
        parts = raw.split("-")
        label = f"{parts[2]}.{parts[1]}.{parts[0]}" if len(parts) == 3 else raw
        return f"Kaydedildi. {label} tarihinde yemek/yol alacağa yazılacak."
    return accrual.get("message") or "Kaydedildi."


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
        # Personel yemek/yol: geçmiş ayları da yakala (ortak maaşı catch_up=False)
        slots = partner_pay.salary_slots(
            pay_slot_emp(emp), today, force_start=force_start, catch_up=True
        )
        if not slots:
            start = partner_pay.parse_iso_date(emp.get("pay_start_date"))
            due_date = start.isoformat() if start and start > today else None
            skipped.append({"employee_id": emp.get("_id"), "reason": "not_due", "due_date": due_date})
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
    scheduled = next((s.get("due_date") for s in skipped if s.get("reason") == "not_due" and s.get("due_date")), None)
    if posted:
        message = f"{len(posted)} hak ediş masrafı yazıldı."
    elif scheduled:
        message = f"Kaydedildi. Hak ediş tarihinde ({scheduled}) alacağa yazılacak."
    else:
        message = "Yazılacak yeni yemek/yol hakkı yok."
    return {
        "status": "success",
        "as_of": today.isoformat(),
        "posted": posted,
        "skipped": skipped,
        "posted_count": len(posted),
        "scheduled_date": scheduled,
        "message": message,
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
