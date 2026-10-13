"""Personel ödeme satırları: cari hareket, kasa/banka, avans mahsubu, idempotency."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

import bank_guard
import employee_pay
import partner_pay

KIND_LABELS = {
    "salary": "Maaş",
    "remaining": "Kalan ödeme",
    "advance": "Avans",
    "bonus": "Prim",
    "expense": "Masraf iadesi",
    "meal": "Yol/Yemek",
    "transport": "Yol/Yemek",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _amt(v: Any) -> float:
    return employee_pay._amt(v)


def normalize_lines(raw: Any) -> List[dict]:
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=400, detail="Ödeme satırı yok.")
    out: List[dict] = []
    for row in raw:
        if not isinstance(row, dict):
            raise HTTPException(status_code=400, detail="Ödeme satırı geçersiz.")
        kind = str(row.get("kind") or "").strip().lower()
        if kind not in KIND_LABELS:
            raise HTTPException(status_code=400, detail="Ödeme türü geçersiz.")
        amount = round(_amt(row.get("amount")), 2)
        if amount <= 0.004:
            continue
        account_id = row.get("account_id") or None
        partner_id = row.get("partner_id") or None
        if account_id and partner_id:
            raise HTTPException(status_code=400, detail="Kasa/banka ve ortak hesabı aynı anda seçilemez.")
        if not account_id and not partner_id:
            raise HTTPException(status_code=400, detail="Kasa/Banka veya ortak hesabı seçin.")
        out.append({
            "kind": kind,
            "amount": amount,
            "account_id": account_id,
            "partner_id": partner_id,
            "description": str(row.get("description") or row.get("note") or "").strip()[:300],
        })
    if not out:
        raise HTTPException(status_code=400, detail="Ödenecek tutar girin.")
    return out


def _replay(receipt: Optional[dict]) -> dict:
    stored = (receipt or {}).get("result") if isinstance((receipt or {}).get("result"), dict) else None
    if stored:
        return {**stored, "idempotent": True, "status": "success"}
    rid = (receipt or {}).get("_id")
    return {
        "status": "success",
        "idempotent": True,
        "receipt_id": rid,
        "receipt_url": f"/api/personnel/receipts/{rid}" if rid else None,
        "message": "Bu ödeme daha önce kaydedildi.",
    }


async def _load_accounts(db, lines: List[dict]) -> Dict[str, dict]:
    found: Dict[str, dict] = {}
    for ln in lines:
        aid = ln.get("account_id")
        if not aid or aid in found:
            continue
        acc = await db.bank_accounts.find_one({"_id": aid})
        if not acc:
            raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
        found[aid] = acc
    return found


async def _rows(db, coll: str, query: dict, limit: int = 500) -> List[dict]:
    cursor = getattr(db, coll).find(query)
    if hasattr(cursor, "to_list"):
        return await cursor.to_list(limit)
    return list(cursor)


def _insert_payroll(emp: dict, period: str, final: float, manual: bool) -> dict:
    return {
        "_id": f"pay_{uuid.uuid4().hex[:8]}",
        "company_id": emp.get("company_id"),
        "employee_id": emp.get("_id"),
        "employee_name": emp.get("full_name"),
        "period": period,
        "net_salary": round(final, 2),
        "gross_salary": round(final, 2),
        "final_payable": round(final, 2),
        "paid_amount": 0.0,
        "status": "pending",
        "manual": manual,
        "deduction": 0.0,
        "bonus": 0.0,
        "advance_payment": 0.0,
        "created_at": _now(),
    }


async def _cover_salary(db, emp: dict, period: str, amount: float, pay_date: str) -> float:
    """Açık maaş kadar bordroya yazar. Sığmayan kısım (tahakkuk yok / fazla) geri döner."""
    rows = await _rows(db, "payrolls", {"employee_id": emp.get("_id")})
    per = (period or "")[:7]
    open_rows = [p for p in rows if employee_pay.payroll_open_remainder(p) > 0.004]
    period_rows = [p for p in open_rows if str(p.get("period") or "")[:7] == per]
    other_rows = [p for p in open_rows if p not in period_rows]
    targets = list(period_rows)
    if not period_rows and not employee_pay.month_blocks_salary_fallback(rows, per):
        entitled = employee_pay.unpaid_salary_amount(emp, rows, per, pay_date)
        if entitled > 0.004:
            doc = _insert_payroll(emp, per, entitled, manual=False)
            await db.payrolls.insert_one(doc)
            targets = [doc]
    targets.extend(other_rows)
    left = round(amount, 2)
    for p in targets:
        if left <= 0.004:
            break
        payable = employee_pay.payroll_payable(p)
        already = employee_pay.payroll_paid_amount(p)
        room = round(max(0.0, payable - already), 2)
        take = round(min(room, left), 2) if room > 0.004 else 0.0
        if take <= 0.004:
            continue
        new_paid = round(already + take, 2)
        status = "paid" if new_paid + 0.004 >= payable else "pending"
        await db.payrolls.update_one(
            {"_id": p["_id"]},
            {"$set": {"paid_amount": new_paid, "status": status, "paid_date": pay_date if status == "paid" else p.get("paid_date")}},
        )
        p["paid_amount"] = new_paid
        p["status"] = status
        left = round(left - take, 2)
    return round(max(0.0, left), 2)


async def _mark_amount(db, coll: str, rows: List[dict], amount: float, *, status_field: str, paid_value: str, pay_date: str) -> float:
    left = round(amount, 2)
    for row in rows:
        if left <= 0.004:
            break
        if row.get(status_field) == paid_value:
            continue
        row_amt = round(_amt(row.get("amount") if coll == "bonus_payments" else row.get("total")), 2)
        if row_amt <= 0.004 or row_amt > left + 0.004:
            if row_amt > left + 0.004:
                continue
        await getattr(db, coll).update_one(
            {"_id": row["_id"]},
            {"$set": {status_field: paid_value, "paid_at": pay_date, "paid_date": pay_date}},
        )
        left = round(left - row_amt, 2)
    return round(max(0.0, left), 2)


async def _cover_bonus(db, emp: dict, amount: float, pay_date: str) -> float:
    rows = await _rows(db, "bonus_payments", {"employee_id": emp.get("_id")})
    pending = [
        b for b in rows
        if b.get("status") != "paid"
        and str(b.get("type") or "").lower() not in ("advance", "borc", "bakiye", "overtime")
        and b.get("status") != "rejected"
    ]
    return await _mark_amount(db, "bonus_payments", pending, amount, status_field="status", paid_value="paid", pay_date=pay_date)


async def _cover_expenses(db, emp: dict, amount: float, pay_date: str) -> float:
    rows = await _rows(db, "expenses", {"employee_id": emp.get("_id")})
    pending = [e for e in rows if e.get("payment_status") != "paid" and _amt(e.get("total")) > 0.004]
    return await _mark_amount(db, "expenses", pending, amount, status_field="payment_status", paid_value="paid", pay_date=pay_date)


async def _cover_allowance(db, emp: dict, period: str, amount: float, pay_date: str, balance: dict) -> float:
    left = round(amount, 2)
    chunks = (
        ("meal", employee_pay.MEAL_CAT, _amt(balance.get("meal_due"))),
        ("transport", employee_pay.TRANSPORT_CAT, _amt(balance.get("transport_due"))),
    )
    for kind, cat, due in chunks:
        if left <= 0.004 or due <= 0.004:
            continue
        take = round(min(left, due), 2)
        await db.expenses.insert_one({
            "_id": f"payexp_{uuid.uuid4().hex[:8]}",
            "company_id": emp.get("company_id"),
            "employee_id": emp.get("_id"),
            "employee_name": emp.get("full_name"),
            "category": cat,
            "description": KIND_LABELS["meal"],
            "date": pay_date,
            "amount": take,
            "total": take,
            "vat_rate": 0,
            "payment_status": "paid",
            "allowance_period": period,
            "allowance_kind": kind,
            "source": "personnel_payment",
            "created_at": _now(),
        })
        left = round(left - take, 2)
    return round(max(0.0, left), 2)


async def _insert_advance(db, emp: dict, period: str, amount: float, pay_date: str, note: str, account_id: Optional[str], movement_id: str) -> None:
    if amount <= 0.004:
        return
    await db.bonus_payments.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": emp.get("company_id"),
        "employee_id": emp.get("_id"),
        "employee_name": emp.get("full_name"),
        "type": "advance",
        "type_label": "Avans",
        "period": period,
        "amount": round(amount, 2),
        "status": "paid",
        "note": note or "Avans",
        "date": pay_date,
        "paid_at": pay_date,
        "account_id": account_id,
        "source": "personnel_payment",
        "movement_id": movement_id,
        "created_at": _now(),
    })


async def _cash_out(db, emp: dict, ln: dict, acc: Optional[dict], pay_date: str, period: str, movement_id: str) -> Optional[str]:
    amount = ln["amount"]
    label = KIND_LABELS[ln["kind"]]
    desc = ln.get("description") or f"{emp.get('full_name')} - {period} {label}"
    if ln.get("partner_id"):
        return await partner_pay.withdraw(
            db, emp.get("company_id"), ln["partner_id"], amount, desc, pay_date,
            extra={"personnel_movement_id": movement_id, "employee_id": emp.get("_id")},
        )
    aid = ln.get("account_id")
    await bank_guard.assert_manual_allowed(db, aid)
    await db.bank_accounts.update_one({"_id": aid}, {"$inc": {"current_balance": -amount}})
    acc_name = (acc or {}).get("account_name") or "Hesap"
    await db.bank_transactions.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": emp.get("company_id"),
        "account_id": aid,
        "account_name": acc_name,
        "type": "outflow",
        "category": f"Personel {label}",
        "amount": amount,
        "currency": "TRY",
        "description": desc,
        "date": pay_date,
        "employee_id": emp.get("_id"),
        "period": period,
        "kind": ln["kind"],
        "personnel_movement_id": movement_id,
        "created_at": _now(),
    })
    return acc_name


async def apply_payment_lines(
    db,
    emp: dict,
    company: Optional[dict],
    payload: Optional[dict],
    *,
    balance: Optional[dict] = None,
    pay_date: str,
    period: str,
) -> dict:
    payload = payload or {}
    balance = balance or {}
    lines = normalize_lines(payload.get("lines"))
    accounts = await _load_accounts(db, lines)
    sgk_err = employee_pay.validate_sgk_lines(emp, company, lines, accounts)
    if sgk_err:
        raise HTTPException(status_code=400, detail=sgk_err)
    cash_err = employee_pay.grouped_cash_shortfall(lines, accounts)
    if cash_err:
        raise HTTPException(status_code=400, detail=cash_err)

    key = str(payload.get("idempotency_key") or "").strip()[:200]
    if key:
        existing = await db.personnel_movements.find_one({
            "company_id": emp.get("company_id"),
            "employee_id": emp.get("_id"),
            "idempotency_key": key,
        })
        if existing and existing.get("receipt_id"):
            receipt = await db.personnel_receipts.find_one({"_id": existing["receipt_id"]})
            return _replay(receipt)

    preview = employee_pay.payment_after(balance.get("remaining"), lines)
    manual_salary = any(ln["kind"] == "salary" for ln in lines) and _amt(balance.get("unpaid_payroll")) <= 0.004
    receipt_id = f"rcpt_{uuid.uuid4().hex[:10]}"
    saved_lines = []
    for ln in lines:
        movement_id = str(uuid.uuid4())
        acc = accounts.get(ln.get("account_id") or "")
        account_name = await _cash_out(db, emp, ln, acc, pay_date, period, movement_id)
        excess = 0.0
        if ln["kind"] in ("salary", "remaining"):
            excess = await _cover_salary(db, emp, period, ln["amount"], pay_date)
            if ln["kind"] == "remaining" and excess > 0.004:
                excess = await _cover_expenses(db, emp, excess, pay_date)
                excess = await _cover_allowance(db, emp, period, excess, pay_date, balance)
                excess = await _cover_bonus(db, emp, excess, pay_date)
        elif ln["kind"] == "advance":
            excess = ln["amount"]
        elif ln["kind"] == "bonus":
            excess = await _cover_bonus(db, emp, ln["amount"], pay_date)
        elif ln["kind"] == "expense":
            excess = await _cover_expenses(db, emp, ln["amount"], pay_date)
        elif ln["kind"] in ("meal", "transport"):
            excess = await _cover_allowance(db, emp, period, ln["amount"], pay_date, balance)
        if excess > 0.004 and ln["kind"] != "advance":
            await _insert_advance(db, emp, period, excess, pay_date, "Fazla ödeme", ln.get("account_id"), movement_id)
        elif ln["kind"] == "advance":
            await _insert_advance(db, emp, period, ln["amount"], pay_date, ln.get("description") or "Avans", ln.get("account_id"), movement_id)
        movement = {
            "_id": movement_id,
            "company_id": emp.get("company_id"),
            "employee_id": emp.get("_id"),
            "employee_name": emp.get("full_name"),
            "period": period,
            "kind": ln["kind"],
            "kind_label": KIND_LABELS[ln["kind"]],
            "amount": ln["amount"],
            "account_id": ln.get("account_id"),
            "partner_id": ln.get("partner_id"),
            "account_name": account_name,
            "description": ln.get("description") or "",
            "date": pay_date,
            "idempotency_key": key or None,
            "receipt_id": receipt_id,
            "created_at": _now(),
        }
        await db.personnel_movements.insert_one(movement)
        saved_lines.append({
            "id": movement_id,
            "kind": ln["kind"],
            "kind_label": KIND_LABELS[ln["kind"]],
            "amount": ln["amount"],
            "account_name": account_name,
            "description": ln.get("description") or "",
            "period": period,
        })

    message = f"{emp.get('full_name')} için {len(saved_lines)} ödeme satırı işlendi."
    if manual_salary:
        message = f"{message} Bu dönem için tahakkuk yok; maaş elle girildi."
    if preview.get("overpaid"):
        message = f"{message} Fazla ödeme sonraki maaştan düşülecek."
    result = {
        "status": "success",
        "paid": [ln["kind"] for ln in saved_lines],
        "date": pay_date,
        "period": period,
        "lines": saved_lines,
        "receipt_id": receipt_id,
        "receipt_url": f"/api/personnel/receipts/{receipt_id}",
        "remaining_before": round(_amt(balance.get("remaining")), 2),
        "remaining_after": preview["remaining_after"],
        "overpaid": bool(preview["overpaid"]),
        "manual_salary": manual_salary,
        "idempotent": False,
        "message": message,
    }
    await db.personnel_receipts.insert_one({
        "_id": receipt_id,
        "company_id": emp.get("company_id"),
        "employee_id": emp.get("_id"),
        "employee_name": emp.get("full_name"),
        "period": period,
        "date": pay_date,
        "lines": saved_lines,
        "total": preview["paying"],
        "remaining_before": result["remaining_before"],
        "remaining_after": result["remaining_after"],
        "overpaid": result["overpaid"],
        "idempotency_key": key or None,
        "result": result,
        "created_at": _now(),
    })
    return result
