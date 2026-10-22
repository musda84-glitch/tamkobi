"""Personel alacak hak edişi: tarih, aylık tekrar, satır seçimi."""
from datetime import datetime, timezone, date as dt_date
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException

import partner_pay

IST = ZoneInfo("Europe/Istanbul")
SGK_BANK_MSG = "SGK'lı personelin resmi maaşı bankadan ödenmelidir"
CASH_SHORT_MSG = "Kasa bakiyesi yetersiz"
OVERPAY_MSG = "sonraki maaştan düşülecek"
CLOSED_PAYROLL = {"rejected", "cancelled", "canceled", "void"}
CASH_ACCOUNT_TYPES = {"cash", "kasa", "cashbox", "nakit", "cash_box"}
POS_ACCOUNT_TYPES = {"pos", "okc_pos", "credit_card", "customer_credit_card"}
SALARY_LINE_KINDS = {"salary", "remaining"}
ADMIN_ROLES = {"admin", "owner"}

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

REIMBURSE_KIND = "reimburse"
REIMBURSE_DEFAULT_CATEGORY = "Personel Masrafı"
REIMBURSE_TEMPLATE_SOURCE = "personnel_reimburse_recurring"
REIMBURSE_EFFECT_DEBT = "debt"
REIMBURSE_EFFECT_ENTITLEMENT = "entitlement"
REIMBURSE_ACCOUNT_EFFECTS = (REIMBURSE_EFFECT_DEBT, REIMBURSE_EFFECT_ENTITLEMENT)
PERSONNEL_PAYER_VALUES = {"personnel", "employee", "personel", "staff"}
CLOSED_PERSONNEL_DEBT = {"closed", "reimbursed", "paid"}
_PERSONNEL_DEBT_TEXT = "personel tarafından ödendi"
_TEMPLATE_PAYMENT = {"template", "recurring"}


def istanbul_today(now: Any = None) -> dt_date:
    """Europe/Istanbul takvim günü. Naive datetime UTC sayılır."""
    if isinstance(now, datetime):
        dt = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).date()
    if isinstance(now, dt_date):
        return now
    if now not in (None, ""):
        text = str(now).strip().replace("Z", "+00:00")
        parsed = partner_pay.parse_iso_date(text[:10])
        if len(text) > 10:
            try:
                dt = datetime.fromisoformat(text)
            except ValueError:
                dt = None
            if dt is not None:
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(IST).date()
        if parsed:
            return parsed
    return datetime.now(IST).date()


def istanbul_period(now: Any = None) -> str:
    d = istanbul_today(now)
    return f"{d.year:04d}-{d.month:02d}"


def today_iso() -> str:
    return istanbul_today().isoformat()


def as_of_date(as_of: Any = None) -> dt_date:
    if isinstance(as_of, datetime):
        return istanbul_today(as_of)
    if isinstance(as_of, dt_date):
        return as_of
    return istanbul_today(as_of) if as_of else istanbul_today()


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
        today = istanbul_today()
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
    today = partner_pay.parse_iso_date(as_of) or istanbul_today()
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
    today = partner_pay.parse_iso_date(as_of) or istanbul_today()
    cid = str(company_id or "").strip()
    if not cid:
        return {
            "status": "success",
            "as_of": today.isoformat(),
            "posted": [],
            "skipped": [],
            "posted_count": 0,
            "scheduled_date": None,
            "message": "Yazılacak yeni yemek/yol hakkı yok.",
        }
    q: Dict[str, Any] = {"company_id": cid}
    if employee_id:
        q["_id"] = employee_id
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
                emp_cid = str(emp.get("company_id") or cid)
                exists = await db.expenses.find_one({
                    "employee_id": emp["_id"],
                    "company_id": emp_cid,
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


async def _accrue_due_routed(db, as_of: Optional[str] = None, generate_payroll_fn=None) -> Dict[str, Any]:
    """Bayrak açık: personel her şirketin kendi deposundan okunur."""
    import storage_router

    seen = set()
    posted = 0
    companies = 0
    async for cid, store in storage_router.iter_company_stores(db):
        if cid in seen:
            continue
        seen.add(cid)
        try:
            cursor = store.employees.find({"company_id": cid})
            employees = await cursor.to_list(5000) if hasattr(cursor, "to_list") else list(cursor)
            if not employees:
                continue
            companies += 1
            r = await accrue_allowances(store, cid, as_of=as_of, generate_payroll_fn=generate_payroll_fn)
            posted += int(r.get("posted_count") or 0)
        except Exception as exc:
            storage_router.log_store_failure(cid, exc)
    return {"posted_count": posted, "companies": companies}


async def accrue_due_for_all_companies(db, as_of: Optional[str] = None, generate_payroll_fn=None) -> Dict[str, Any]:
    import storage_router

    if storage_router.enabled():
        return await _accrue_due_routed(db, as_of=as_of, generate_payroll_fn=generate_payroll_fn)
    # tenant-ok değil: zamanlayıcı tüm şirketleri tarar; her satırın company_id'si ile şirket bazlı işleme devreder.
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
        try:
            import expenses as exp_mod
            import storage_router

            if storage_router.enabled():
                posted_rec = 0
                async for cid, store in storage_router.iter_company_stores(db):
                    try:
                        cursor = store.employees.find({"company_id": cid})
                        employees = await cursor.to_list(5000) if hasattr(cursor, "to_list") else list(cursor)
                        if not employees:
                            continue
                        rec = await exp_mod.run_recurring_for_company(cid, db=store)
                        posted_rec += len(rec.get("created") or [])
                    except Exception as exc:
                        storage_router.log_store_failure(cid, exc)
                if posted_rec:
                    log.info("recurring expenses scheduler posted %s", posted_rec)
                await asyncio.sleep(3600)
                continue
            # tenant-ok değil: zamanlayıcı tüm şirketleri tarar; her satırın company_id'si ile şirket bazlı işleme devreder.
            cursor = db.employees.find({})
            employees = await cursor.to_list(5000) if hasattr(cursor, "to_list") else list(cursor)
            seen_cid = set()
            posted_rec = 0
            for e in employees:
                cid = e.get("company_id")
                if not cid or cid in seen_cid:
                    continue
                seen_cid.add(cid)
                rec = await exp_mod.run_recurring_for_company(cid, db=db)
                posted_rec += len(rec.get("created") or [])
            if posted_rec:
                log.info("recurring expenses scheduler posted %s", posted_rec)
        except Exception as exc:  # noqa: BLE001
            log.warning("recurring expenses scheduler: %s", exc)
        await asyncio.sleep(3600)


def payroll_status(p: Optional[dict]) -> str:
    return str((p or {}).get("status") or "").strip().casefold()


def payroll_payable(p: Optional[dict]) -> float:
    row = p or {}
    return round(_amt(row.get("final_payable"), _amt(row.get("net_salary"))), 2)


def payroll_paid_amount(p: Optional[dict]) -> float:
    row = p or {}
    if row.get("paid_amount") not in (None, ""):
        return round(_amt(row.get("paid_amount")), 2)
    if payroll_status(row) == "paid":
        return payroll_payable(row)
    return 0.0


def payroll_open_remainder(p: Optional[dict]) -> float:
    if payroll_status(p) in CLOSED_PAYROLL:
        return 0.0
    return round(max(0.0, payroll_payable(p) - payroll_paid_amount(p)), 2)


def month_blocks_salary_fallback(payrolls: Optional[List[dict]], month: str) -> bool:
    """Bu ay için reddedilmemiş bordro varsa maaş tahmini eklenmez."""
    per = (month or "")[:7]
    for p in payrolls or []:
        if str(p.get("period") or "")[:7] != per:
            continue
        if payroll_status(p) in CLOSED_PAYROLL:
            continue
        return True
    return False


def has_pay_start_date(emp: Optional[Dict[str, Any]]) -> bool:
    """Hak ediş yalnızca pay_start_date dolu personelde hesaplanır."""
    return bool(str((emp or {}).get("pay_start_date") or "").strip())


def entitlement_slot_partner(emp: Dict[str, Any], month: str) -> Optional[Dict[str, Any]]:
    """pay_start_date yoksa hak ediş çapasını kurmaz (işe giriş / ay başı yedeği yok)."""
    if not has_pay_start_date(emp):
        return None
    start = str(emp.get("pay_start_date") or "").strip()
    rec = emp.get("pay_recurring")
    return {
        "salary_start_date": start[:10],
        "salary_day": emp.get("pay_day"),
        "salary_recurring": True if rec is None else bool(rec),
    }


def unpaid_salary_amount(
    emp: Dict[str, Any],
    payrolls: Optional[List[dict]],
    month: str,
    as_of: Any = None,
) -> float:
    """Açık bordro kalanı; yoksa İstanbul gününe göre hak edilmiş maaş.

    Reddedilen / iptal bordro alacağı şişirmez ve hak edişi de gizlemez.
    Kısmi `paid_amount` düşülür. pay_start_date yoksa tahmini maaş 0'dır.
    """
    total = round(sum(payroll_open_remainder(p) for p in (payrolls or [])), 2)
    if total > 0.004:
        return total
    if str((emp or {}).get("pay_type") or "monthly").lower() == "daily":
        return 0.0
    per = (month or "")[:7]
    if month_blocks_salary_fallback(payrolls, per):
        return 0.0
    partner = entitlement_slot_partner(emp or {}, per)
    if not partner:
        return 0.0
    today = as_of_date(as_of)
    if partner.get("salary_recurring") is False:
        start = partner_pay.parse_iso_date(partner.get("salary_start_date"))
        if not start or partner_pay.period_of(start) != per:
            return 0.0
    slots = partner_pay.salary_slots(partner, today, explicit_period=per)
    if any(slot_per == per and due <= today for slot_per, due in slots):
        return round(_amt((emp or {}).get("salary")), 2)
    return 0.0


def period_figures(
    emp: Dict[str, Any],
    payrolls: Optional[List[dict]],
    bonuses: Optional[List[dict]],
    month: str,
    *,
    unpaid_payroll: float = 0,
    bonus_pending: float = 0,
    overtime_due: float = 0,
    extra_advance: float = 0,
    bakiye_paid: float = 0,
) -> Dict[str, float]:
    """Öde ekranı özeti: hak edilen, prim/mesai, kesinti, önceki ödeme."""
    per = (month or "")[:7]
    earned = 0.0
    deductions = 0.0
    previous = 0.0
    saw = False
    for p in payrolls or []:
        if str(p.get("period") or "")[:7] != per:
            continue
        if payroll_status(p) in CLOSED_PAYROLL:
            continue
        saw = True
        payable = payroll_payable(p)
        earned += payable
        deductions += _amt(p.get("deduction"))
        previous += payroll_paid_amount(p)
    if not saw and unpaid_payroll > 0.004 and has_pay_start_date(emp):
        earned = _amt((emp or {}).get("salary"))
    for b in bonuses or []:
        in_period = str(b.get("period") or "")[:7] == per or str(b.get("date") or "").startswith(per)
        if not in_period or b.get("status") != "paid":
            continue
        if str(b.get("type") or "").lower() in ("advance", "borc", "bakiye"):
            continue
        previous += _amt(b.get("amount"))
    return {
        "salary_earned": round(earned, 2),
        "premium": round(_amt(bonus_pending) + _amt(overtime_due), 2),
        "deductions": round(deductions + _amt(extra_advance), 2),
        "previous_payments": round(previous + _amt(bakiye_paid), 2),
    }


def sgk_rule_enabled(company: Optional[dict]) -> bool:
    """Firma ayarı yoksa kural açıktır."""
    company = company or {}
    settings = company.get("settings") if isinstance(company.get("settings"), dict) else {}
    if "sgk_salary_bank_only" in settings:
        return bool(settings.get("sgk_salary_bank_only"))
    if "sgk_salary_bank_only" in company:
        return bool(company.get("sgk_salary_bank_only"))
    return True


def employee_is_sgk(emp: Optional[dict]) -> bool:
    emp = emp or {}
    if emp.get("sgk_insured") is True:
        return True
    return bool(str(emp.get("sgk_number") or "").strip())


def official_salary_of(emp: Optional[dict]) -> float:
    emp = emp or {}
    if not employee_is_sgk(emp):
        return 0.0
    if emp.get("official_salary") not in (None, ""):
        return round(_amt(emp.get("official_salary")), 2)
    return round(_amt(emp.get("salary")), 2)


def account_type(acc: Optional[dict]) -> str:
    return str((acc or {}).get("type") or "").strip().lower()


def account_is_bank(acc: Optional[dict]) -> bool:
    return account_type(acc) == "bank"


def account_is_cash(acc: Optional[dict]) -> bool:
    return account_type(acc) in CASH_ACCOUNT_TYPES


def account_is_pos(acc: Optional[dict]) -> bool:
    return account_type(acc) in POS_ACCOUNT_TYPES


def is_company_admin(user: Optional[dict]) -> bool:
    user = user or {}
    if user.get("is_super_admin"):
        return True
    return str(user.get("role") or "").strip().lower() in ADMIN_ROLES


def sgk_setting_error(user: Optional[dict], enabled: bool) -> Optional[str]:
    if is_company_admin(user):
        return None
    if not enabled:
        return "SGK maaş kuralını yalnızca firma yöneticisi kapatabilir."
    return "SGK maaş kuralını yalnızca firma yöneticisi değiştirebilir."


def validate_sgk_lines(
    emp: Optional[dict],
    company: Optional[dict],
    lines: Optional[List[dict]],
    accounts_by_id: Optional[Dict[str, dict]] = None,
) -> Optional[str]:
    """Resmi maaş kadar kısmı bankadan karşılanmadan kasa/POS/ortak kabul edilmez."""
    if not sgk_rule_enabled(company) or not employee_is_sgk(emp):
        return None
    official = official_salary_of(emp)
    salary_lines = [ln for ln in (lines or []) if str(ln.get("kind") or "") in SALARY_LINE_KINDS and _amt(ln.get("amount")) > 0.004]
    if not salary_lines or official <= 0.004:
        return None
    accounts_by_id = accounts_by_id or {}
    bank_cover = 0.0
    other = 0.0
    for ln in salary_lines:
        amt = _amt(ln.get("amount"))
        acc = accounts_by_id.get(ln.get("account_id") or "")
        if ln.get("partner_id") or not account_is_bank(acc):
            other += amt
        else:
            bank_cover += amt
    need = min(official, round(sum(_amt(ln.get("amount")) for ln in salary_lines), 2))
    if bank_cover + 0.004 < need and other > 0.004:
        return SGK_BANK_MSG
    return None


def cash_shortfall(account: Optional[dict], amount: float) -> bool:
    if not account_is_cash(account):
        return False
    return _amt((account or {}).get("current_balance")) + 0.004 < _amt(amount)


def grouped_cash_shortfall(lines: Optional[List[dict]], accounts_by_id: Optional[Dict[str, dict]]) -> Optional[str]:
    totals: Dict[str, float] = {}
    accounts_by_id = accounts_by_id or {}
    for ln in lines or []:
        aid = ln.get("account_id")
        acc = accounts_by_id.get(aid or "")
        if not aid or not account_is_cash(acc):
            continue
        totals[aid] = round(totals.get(aid, 0.0) + _amt(ln.get("amount")), 2)
    for aid, total in totals.items():
        if cash_shortfall(accounts_by_id.get(aid), total):
            return CASH_SHORT_MSG
    return None


def _truthy_flag(v: Any) -> bool:
    if v is True or v == 1:
        return True
    return str(v or "").strip().lower() in {"1", "true", "yes", "evet"}


def expense_paid_by_personnel(exp: Optional[dict]) -> bool:
    """Personel şirket adına cebinden ödediyse True."""
    if not isinstance(exp, dict):
        return False
    if _truthy_flag(exp.get("paid_by_personnel")):
        return True
    for key in ("payer", "paid_by_kind", "payment_source", "paid_by"):
        if str(exp.get(key) or "").strip().lower() in PERSONNEL_PAYER_VALUES:
            return True
    blob = " ".join(
        str(exp.get(k) or "")
        for k in ("note", "notes", "description", "payment_note", "paid_by_label")
    ).lower()
    return _PERSONNEL_DEBT_TEXT in blob


def personnel_debt_status_of(exp: Optional[dict]) -> str:
    return str((exp or {}).get("personnel_debt_status") or "").strip().lower()


def personnel_debt_closed(exp: Optional[dict]) -> bool:
    return personnel_debt_status_of(exp) in CLOSED_PERSONNEL_DEBT


def personnel_debt_open(exp: Optional[dict]) -> bool:
    """Açık 'personel tarafından ödendi' borcu. Kapalı kayıt açık sayılmaz."""
    if not isinstance(exp, dict) or personnel_debt_closed(exp):
        return False
    if personnel_debt_status_of(exp) == "open":
        return True
    return expense_paid_by_personnel(exp)


def expense_is_recurring_template(exp: Optional[dict]) -> bool:
    """Tekrarlayan şablon satırı hak edişe ve ödenmemiş toplama girmez."""
    if not isinstance(exp, dict):
        return False
    if str(exp.get("source") or "") == REIMBURSE_TEMPLATE_SOURCE:
        return True
    return str(exp.get("payment_status") or "").strip().lower() in _TEMPLATE_PAYMENT


def expense_counts_in_receivable(exp: Optional[dict]) -> bool:
    """Şirketin personele masraf borcu hak edişe girer. Personel cebinden ödenen girmez."""
    if not isinstance(exp, dict):
        return False
    if expense_is_recurring_template(exp):
        return False
    if str(exp.get("payment_status") or "") == "paid":
        return False
    if personnel_debt_status_of(exp) or expense_paid_by_personnel(exp):
        return False
    return True


def personnel_debt_amount(exp: Optional[dict]) -> float:
    if not isinstance(exp, dict):
        return 0.0
    if exp.get("personnel_debt_amount") not in (None, ""):
        return round(_amt(exp.get("personnel_debt_amount")), 2)
    raw = exp.get("total") if exp.get("total") not in (None, "") else exp.get("amount")
    return round(_amt(raw), 2)


def charge_reimburse_to_account(ln: Optional[dict]) -> bool:
    """Personel hesabına yaz açıksa masraf ödemesi bakiyeyi etkiler."""
    if not isinstance(ln, dict):
        return False
    if str(ln.get("kind") or "").strip().lower() != REIMBURSE_KIND:
        return False
    return _truthy_flag(ln.get("charge_to_account") or ln.get("chargeToAccount"))


def reimburse_account_effect(ln: Optional[dict]) -> str:
    raw = str((ln or {}).get("account_effect") or (ln or {}).get("accountEffect") or "").strip().lower()
    if raw in REIMBURSE_ACCOUNT_EFFECTS:
        return raw
    return REIMBURSE_EFFECT_DEBT


def payment_lines_affecting_balance(lines: Optional[List[dict]]) -> List[dict]:
    """Masraf ödemesi varsayılan olarak bakiyeden düşülmez; hesaba yazılınca düşer."""
    out: List[dict] = []
    for ln in lines or []:
        kind = str((ln or {}).get("kind") or "").strip().lower()
        if kind == REIMBURSE_KIND and not charge_reimburse_to_account(ln):
            continue
        out.append(ln)
    return out


def payment_after(remaining: float, lines: Optional[List[dict]]) -> Dict[str, Any]:
    paying = round(sum(_amt(ln.get("amount")) for ln in (lines or [])), 2)
    after = round(_amt(remaining) - paying, 2)
    over = paying > 0.004 and after < -0.004
    return {
        "paying": paying,
        "remaining_after": after,
        "overpaid": over,
        "message": OVERPAY_MSG if over else None,
    }
