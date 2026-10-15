"""Personel ödeme satırları: cari hareket, kasa/banka, avans mahsubu, idempotency."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Request

import bank_guard
import employee_pay
import finance_txn
import idempotency
import linked_moves
import partner_pay
import pay_claim
import rbac
import tenant_access
import trash

KIND_LABELS = {
    "salary": "Maaş",
    "remaining": "Kalan ödeme",
    "advance": "Avans",
    "bonus": "Prim",
    "expense": "Masraf iadesi",
    "meal": "Yol/Yemek",
    "transport": "Yol/Yemek",
    "reimburse": "Masraf ödemesi",
}

SOURCE = "personnel_payment"
REIMBURSE_TEMPLATE_SOURCE = employee_pay.REIMBURSE_TEMPLATE_SOURCE
DEBT_LABEL = "Maaştan düşülecek (personel borcu)"
ENTITLEMENT_LABEL = "Personele ek ödeme / hak ediş"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _amt(v: Any) -> float:
    return employee_pay._amt(v)


def _cid(emp: dict) -> str:
    return str(emp.get("company_id") or "")


def _truthy(v: Any) -> bool:
    return employee_pay._truthy_flag(v)


def _fill_reimburse_line(item: dict, row: dict) -> None:
    expense_id = str(row.get("expense_id") or "").strip()
    expense_number = str(row.get("expense_number") or "").strip()[:40]
    if expense_id:
        item["expense_id"] = expense_id
    if expense_number:
        item["expense_number"] = expense_number
    cat = str(row.get("category") or employee_pay.REIMBURSE_DEFAULT_CATEGORY).strip()[:80]
    item["category"] = cat or employee_pay.REIMBURSE_DEFAULT_CATEGORY
    item["charge_to_account"] = _truthy(row.get("charge_to_account") or row.get("chargeToAccount"))
    if item["charge_to_account"]:
        item["account_effect"] = employee_pay.reimburse_account_effect(row)
    item["recurring"] = _truthy(row.get("recurring") or row.get("is_recurring"))
    if item["recurring"]:
        try:
            day = int(row.get("recurring_day") or row.get("recurrence_day") or 0)
        except (TypeError, ValueError):
            day = 0
        item["recurring_day"] = min(31, max(1, day)) if day else None
        end = str(row.get("recurring_end") or row.get("recurrence_end") or "").strip()[:10]
        item["recurring_end"] = end or None
    parent = str(row.get("recurring_parent_id") or "").strip()
    if parent:
        item["recurring_parent_id"] = parent


def _link(movement_id: str) -> Dict[str, Any]:
    return linked_moves.link_fields(SOURCE, movement_id)


class _Hdr:
    def __init__(self, key: str):
        self.headers = {"Idempotency-Key": key} if key else {}


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
        item = {
            "kind": kind,
            "amount": amount,
            "account_id": account_id,
            "partner_id": partner_id,
            "description": str(row.get("description") or row.get("note") or "").strip()[:300],
        }
        if kind == "reimburse":
            _fill_reimburse_line(item, row)
        out.append(item)
    if not out:
        raise HTTPException(status_code=400, detail="Ödenecek tutar girin.")
    return out


def _matched(res: Any) -> int:
    return int(getattr(res, "matched_count", 1) or 0)


async def _load_accounts(db, lines: List[dict], emp: dict) -> Dict[str, dict]:
    found: Dict[str, dict] = {}
    cid = _cid(emp)
    for ln in lines:
        aid = ln.get("account_id")
        if not aid or aid in found:
            continue
        acc = await db.bank_accounts.find_one({"_id": aid, "company_id": cid})
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


def _payroll_lock_query(p: dict, cid: str) -> dict:
    q: Dict[str, Any] = {"_id": p["_id"], "company_id": cid}
    if p.get("paid_amount") not in (None, ""):
        q["paid_amount"] = employee_pay.payroll_paid_amount(p)
    else:
        q["paid_amount"] = {"$exists": False}
    return q


def _pay_claim_unlocked() -> dict:
    """Taze _pay_claimed_at yok. Bayat kilit ödeme/geri almayı engellemez."""
    cutoff = (pay_claim._now() - pay_claim.STALE_AFTER).isoformat()
    return {"$or": [
        {"_pay_claimed_at": {"$exists": False}},
        {"_pay_claimed_at": None},
        {"_pay_claimed_at": ""},
        {"_pay_claimed_at": {"$lt": cutoff}},
    ]}


def _paid_amount_clause(doc: dict) -> dict:
    if doc.get("paid_amount") not in (None, ""):
        return {"paid_amount": doc.get("paid_amount")}
    return {"$or": [
        {"paid_amount": {"$exists": False}},
        {"paid_amount": None},
        {"paid_amount": ""},
    ]}


def _target_amount(coll: str, doc: dict) -> float:
    if coll == "payrolls":
        return employee_pay.payroll_payable(doc)
    if coll == "expenses":
        raw = doc.get("total") if doc.get("total") not in (None, "") else doc.get("amount")
        return round(_amt(raw), 2)
    if doc.get("final_payable") not in (None, ""):
        return round(_amt(doc.get("final_payable")), 2)
    raw = doc.get("amount") if doc.get("amount") not in (None, "") else doc.get("total")
    return round(_amt(raw), 2)


def _current_paid(coll: str, doc: dict) -> float:
    if doc.get("paid_amount") not in (None, ""):
        return round(_amt(doc.get("paid_amount")), 2)
    if coll == "payrolls":
        return employee_pay.payroll_paid_amount(doc)
    marker = doc.get("payment_status") if coll == "expenses" else doc.get("status")
    if str(marker or "") == "paid":
        return _target_amount(coll, doc)
    return 0.0


def _status_after_paid(coll: str, doc: dict, new_paid: float) -> Dict[str, Any]:
    """Yeni paid_amount tam tutarı karşılıyorsa paid, değilse açık."""
    target = _target_amount(coll, doc)
    fully = target > 0.004 and new_paid + 0.004 >= target
    patch: Dict[str, Any] = {"paid_amount": round(new_paid, 2)}
    if coll == "expenses":
        patch["payment_status"] = "paid" if fully else "unpaid"
    else:
        patch["status"] = "paid" if fully else "pending"
    if not fully:
        patch["paid_date"] = None
    return patch


def _tracks_paid_amount(coll: str, doc: Optional[dict]) -> bool:
    if coll == "payrolls":
        return True
    return bool(doc) and "paid_amount" in doc


async def _subtract_paid_amount(db, coll: str, doc_id: str, delta: float) -> None:
    """Bu ödemenin tutarını güncel paid_amount'tan düş; status'u yeniden hesapla.

    Mutlak prev_paid yazılmaz. Koşul, okunan paid_amount ve taze ödeme kilidi;
    eşzamanlı ikinci ödeme kendi tutarını korur.
    """
    delta = round(_amt(delta), 2)
    if delta <= 0.004:
        return
    store = getattr(db, coll, None)
    if store is None:
        return
    busy = "Bu bordro ödemesi sürüyor." if coll == "payrolls" else "Bu kayıt üzerinde ödeme sürüyor."
    for _attempt in range(8):
        doc = await store.find_one({"_id": doc_id})
        if not doc:
            return
        current = _current_paid(coll, doc)
        new_paid = round(max(0.0, current - delta), 2)
        res = await store.update_one_atomic(
            {"_id": doc_id, "$and": [_paid_amount_clause(doc), _pay_claim_unlocked()]},
            {"$set": _status_after_paid(coll, doc, new_paid)},
        )
        if _matched(res):
            return
    fresh = await store.find_one({"_id": doc_id})
    if fresh and fresh.get("_pay_claimed_at") not in (None, "") and not pay_claim.is_stale_claim(fresh.get("_pay_claimed_at")):
        raise HTTPException(status_code=409, detail=busy)
    raise HTTPException(status_code=409, detail="Kayıt aynı anda güncellendi. Tekrar deneyin.")


async def _cover_salary(
    db, emp: dict, period: str, amount: float, pay_date: str, *, movement_id: str, cx: finance_txn.CompensatingTxn,
) -> tuple[float, List[dict]]:
    """Açık maaş kadar bordroya yazar. Sığmayan kısım (tahakkuk yok / fazla) geri döner."""
    cid = _cid(emp)
    link = _link(movement_id)
    rows = await _rows(db, "payrolls", {"employee_id": emp.get("_id"), "company_id": cid})
    per = (period or "")[:7]
    open_rows = [p for p in rows if employee_pay.payroll_open_remainder(p) > 0.004]
    period_rows = [p for p in open_rows if str(p.get("period") or "")[:7] == per]
    other_rows = [p for p in open_rows if p not in period_rows]
    targets = list(period_rows)
    effects: List[dict] = []
    if (
        not period_rows
        and not employee_pay.month_blocks_salary_fallback(rows, per)
        and employee_pay.has_pay_start_date(emp)
    ):
        entitled = employee_pay.unpaid_salary_amount(emp, rows, per, pay_date)
        if entitled > 0.004:
            doc = _insert_payroll(emp, per, entitled, manual=False)
            doc.update(link)
            await db.payrolls.insert_one(doc)
            pid = doc["_id"]
            cx.push("payroll_ins", lambda pid=pid: db.payrolls.delete_one({"_id": pid}))
            effects.append({"collection": "payrolls", "id": pid, "action": "insert"})
            targets = [doc]
    targets.extend(other_rows)
    left = round(amount, 2)
    for p in targets:
        if left <= 0.004:
            break
        payable = employee_pay.payroll_payable(p)
        already = employee_pay.payroll_paid_amount(p)
        prev_status = p.get("status")
        prev_date = p.get("paid_date")
        room = round(max(0.0, payable - already), 2)
        take = round(min(room, left), 2) if room > 0.004 else 0.0
        if take <= 0.004:
            continue
        applied = await _apply_payroll_payment(
            db, p, take, pay_date, cid, link, cx,
            stamp_link=bool(effects and effects[-1].get("id") == p["_id"] and effects[-1].get("action") == "insert"),
        )
        if applied <= 0.004:
            continue
        effects.append({
            "collection": "payrolls",
            "id": p["_id"],
            "action": "update",
            "paid_delta": applied,
            "prev_paid": already,
            "prev_status": prev_status,
            "prev_paid_date": prev_date,
        })
        left = round(left - applied, 2)
    return round(max(0.0, left), 2), effects


async def _apply_payroll_payment(
    db, p: dict, take: float, pay_date: str, cid: str, link: dict, cx: finance_txn.CompensatingTxn, *, stamp_link: bool,
) -> float:
    """Bordro paid_amount artır. Taze _pay_claimed_at varsa 409; kendi kilidini yazıp bırakır."""
    pid = p["_id"]
    claimed_at = None
    try:
        gate = await pay_claim.acquire_pay_claim(
            db,
            "payrolls",
            pid,
            company_id=cid,
            idempotency_key="",
            source_type="payroll",
            paid_detail="Bu bordro zaten ödenmiş.",
            busy_detail="Bu bordro ödemesi sürüyor.",
        )
        if gate["action"] == "already_paid":
            raise HTTPException(status_code=409, detail="Bu bordro zaten ödenmiş.")
        claimed_at = gate["claimed_at"]
        fresh = await db.payrolls.find_one({"_id": pid}) or p
        payable = employee_pay.payroll_payable(fresh)
        already = employee_pay.payroll_paid_amount(fresh)
        room = round(max(0.0, payable - already), 2)
        take = round(min(room, take), 2)
        if take <= 0.004:
            return 0.0
        new_paid = round(already + take, 2)
        status = "paid" if new_paid + 0.004 >= payable else "pending"
        prev_date = fresh.get("paid_date")
        upd = {
            "paid_amount": new_paid,
            "status": status,
            "paid_date": pay_date if status == "paid" else prev_date,
        }
        if stamp_link:
            upd.update(link)
        query = _payroll_lock_query(fresh, cid)
        query["_pay_claimed_at"] = claimed_at
        res = await db.payrolls.update_one_atomic(
            query,
            {
                "$set": upd,
                "$unset": {
                    "_pay_claimed_at": "",
                    "_pay_idempotency_key": "",
                    "_pay_idempotency_company": "",
                },
            },
        )
        if _matched(res) == 0:
            raise HTTPException(status_code=409, detail="Bordro aynı anda güncellendi. Tekrar deneyin.")
        claimed_at = None
        p["paid_amount"] = new_paid
        p["status"] = status
        p["paid_date"] = upd["paid_date"]

        async def _undo_pay(pid=pid, delta=take):
            await _subtract_paid_amount(db, "payrolls", pid, delta)

        cx.push("payroll_upd", _undo_pay)
        return take
    finally:
        if claimed_at:
            await pay_claim.release_pay_claim(db, "payrolls", pid, claimed_at)


async def _mark_amount(
    db, coll: str, rows: List[dict], amount: float, *, status_field: str, paid_value: str,
    pay_date: str, cid: str, cx: finance_txn.CompensatingTxn,
) -> tuple[float, List[dict]]:
    left = round(amount, 2)
    effects: List[dict] = []
    for row in rows:
        if left <= 0.004:
            break
        if row.get(status_field) == paid_value:
            continue
        row_amt = round(_amt(row.get("amount") if coll == "bonus_payments" else row.get("total")), 2)
        if row_amt <= 0.004 or row_amt > left + 0.004:
            if row_amt > left + 0.004:
                continue
        prev_status = row.get(status_field)
        prev_paid_at = row.get("paid_at")
        prev_paid_date = row.get("paid_date")
        has_paid = "paid_amount" in row
        set_doc = {status_field: paid_value, "paid_at": pay_date, "paid_date": pay_date}
        query: Dict[str, Any] = {"_id": row["_id"], "company_id": cid, status_field: {"$ne": paid_value}}
        if has_paid:
            set_doc["paid_amount"] = round(_current_paid(coll, row) + row_amt, 2)
            if row.get("paid_amount") not in (None, ""):
                query["paid_amount"] = row.get("paid_amount")
            else:
                query["paid_amount"] = {"$exists": False}
        res = await getattr(db, coll).update_one_atomic(query, {"$set": set_doc})
        if _matched(res) == 0:
            continue
        rid = row["_id"]
        if has_paid:
            async def _undo_mark(coll=coll, rid=rid, delta=row_amt):
                await _subtract_paid_amount(db, coll, rid, delta)
        else:
            async def _undo_mark(
                coll=coll, rid=rid, status_field=status_field,
                prev_status=prev_status, prev_paid_at=prev_paid_at, prev_paid_date=prev_paid_date,
            ):
                await getattr(db, coll).update_one_atomic(
                    {"_id": rid, status_field: paid_value},
                    {"$set": {status_field: prev_status, "paid_at": prev_paid_at, "paid_date": prev_paid_date}},
                )

        cx.push(f"{coll}_upd", _undo_mark)
        effect = {
            "collection": coll,
            "id": rid,
            "action": "update",
            "status_field": status_field,
            "paid_value": paid_value,
            "prev_status": prev_status,
            "prev_paid_at": prev_paid_at,
            "prev_paid_date": prev_paid_date,
        }
        if has_paid:
            effect["paid_delta"] = row_amt
        effects.append(effect)
        row[status_field] = paid_value
        if has_paid:
            row["paid_amount"] = set_doc["paid_amount"]
        left = round(left - row_amt, 2)
    return round(max(0.0, left), 2), effects


async def _cover_bonus(db, emp: dict, amount: float, pay_date: str, *, cx: finance_txn.CompensatingTxn) -> tuple[float, List[dict]]:
    cid = _cid(emp)
    rows = await _rows(db, "bonus_payments", {"employee_id": emp.get("_id"), "company_id": cid})
    pending = [
        b for b in rows
        if b.get("status") != "paid"
        and str(b.get("type") or "").lower() not in ("advance", "borc", "bakiye", "overtime")
        and b.get("status") != "rejected"
    ]
    return await _mark_amount(
        db, "bonus_payments", pending, amount,
        status_field="status", paid_value="paid", pay_date=pay_date, cid=cid, cx=cx,
    )


async def _cover_expenses(db, emp: dict, amount: float, pay_date: str, *, cx: finance_txn.CompensatingTxn) -> tuple[float, List[dict]]:
    cid = _cid(emp)
    rows = await _rows(db, "expenses", {"employee_id": emp.get("_id"), "company_id": cid})
    pending = [
        e for e in rows
        if employee_pay.expense_counts_in_receivable(e) and _amt(e.get("total")) > 0.004
    ]
    return await _mark_amount(
        db, "expenses", pending, amount,
        status_field="payment_status", paid_value="paid", pay_date=pay_date, cid=cid, cx=cx,
    )


async def _cover_allowance(
    db, emp: dict, period: str, amount: float, pay_date: str, balance: dict, *, movement_id: str, cx: finance_txn.CompensatingTxn,
) -> tuple[float, List[dict]]:
    left = round(amount, 2)
    effects: List[dict] = []
    link = _link(movement_id)
    chunks = (
        ("meal", employee_pay.MEAL_CAT, _amt(balance.get("meal_due"))),
        ("transport", employee_pay.TRANSPORT_CAT, _amt(balance.get("transport_due"))),
    )
    for kind, cat, due in chunks:
        if left <= 0.004 or due <= 0.004:
            continue
        take = round(min(left, due), 2)
        eid = f"payexp_{uuid.uuid4().hex[:8]}"
        doc = {
            "_id": eid,
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
            "source": SOURCE,
            "created_at": _now(),
        }
        doc.update(link)
        await db.expenses.insert_one(doc)
        cx.push("exp_ins", lambda eid=eid: db.expenses.delete_one({"_id": eid}))
        effects.append({"collection": "expenses", "id": eid, "action": "insert"})
        left = round(left - take, 2)
    return round(max(0.0, left), 2), effects


async def _insert_advance(
    db, emp: dict, period: str, amount: float, pay_date: str, note: str,
    account_id: Optional[str], movement_id: str, cx: finance_txn.CompensatingTxn,
) -> List[dict]:
    if amount <= 0.004:
        return []
    bid = str(uuid.uuid4())
    doc = {
        "_id": bid,
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
        "source": SOURCE,
        "movement_id": movement_id,
        "created_at": _now(),
    }
    doc.update(_link(movement_id))
    await db.bonus_payments.insert_one(doc)
    cx.push("bonus_ins", lambda bid=bid: db.bonus_payments.delete_one({"_id": bid}))
    return [{"collection": "bonus_payments", "id": bid, "action": "insert", "paid_delta": round(amount, 2)}]


async def _cash_out(
    db, emp: dict, ln: dict, acc: Optional[dict], pay_date: str, period: str, movement_id: str, cx: finance_txn.CompensatingTxn,
) -> Optional[str]:
    amount = ln["amount"]
    label = KIND_LABELS[ln["kind"]]
    desc = ln.get("description") or f"{emp.get('full_name')} - {period} {label}"
    cid = _cid(emp)
    link = _link(movement_id)
    extra = {**link, "personnel_movement_id": movement_id, "employee_id": emp.get("_id")}
    if ln.get("partner_id"):
        partner = await db.partners.find_one({"_id": ln["partner_id"], "company_id": cid})
        if not partner:
            raise HTTPException(status_code=404, detail="Ortak hesabı bulunamadı.")
        name = await partner_pay.withdraw(db, cid, ln["partner_id"], amount, desc, pay_date, extra=extra)

        async def _undo_partner(mid=movement_id):
            await partner_pay.reverse_one(db, {"source_type": SOURCE, "source_id": mid, "company_id": cid})

        cx.push("partner", _undo_partner)
        return f"{name} (Ortak)"
    aid = ln.get("account_id")
    await bank_guard.assert_manual_allowed(db, aid)
    res = await db.bank_accounts.update_one({"_id": aid, "company_id": cid}, {"$inc": {"current_balance": -amount}})
    if _matched(res) == 0:
        raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
    cx.push(
        "acc",
        lambda aid=aid, amount=amount, cid=cid: db.bank_accounts.update_one(
            {"_id": aid, "company_id": cid}, {"$inc": {"current_balance": amount}},
        ),
    )
    acc_name = (acc or {}).get("account_name") or "Hesap"
    tx_id = str(uuid.uuid4())
    tx_doc = {
        "_id": tx_id,
        "company_id": cid,
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
    }
    tx_doc.update(link)
    await db.bank_transactions.insert_one(tx_doc)
    cx.push("btx", lambda tx_id=tx_id: db.bank_transactions.delete_one({"_id": tx_id}))
    return acc_name


def _debt_snapshot(exp: dict) -> dict:
    return {
        "personnel_debt_status": exp.get("personnel_debt_status"),
        "reimburse_movement_id": exp.get("reimburse_movement_id"),
        "personnel_reimbursed_at": exp.get("personnel_reimbursed_at"),
        "reimbursed_amount": exp.get("reimbursed_amount"),
    }


async def _load_reimburse_expense(db, emp: dict, ln: dict) -> Optional[dict]:
    cid = _cid(emp)
    expense_id = str(ln.get("expense_id") or "").strip()
    expense_number = str(ln.get("expense_number") or "").strip()
    if not expense_id and not expense_number:
        return None
    if expense_id:
        exp = await db.expenses.find_one({"_id": expense_id, "company_id": cid})
    else:
        exp = await db.expenses.find_one({"company_id": cid, "expense_number": expense_number})
    if not exp:
        raise HTTPException(status_code=404, detail="Masraf kaydı bulunamadı.")
    return exp


async def _next_msr(db, company_id: str) -> str:
    year = datetime.now(timezone.utc).strftime("%Y")
    prefix = f"MSR-{year}-"
    rows = await _rows(db, "expenses", {"company_id": company_id}, limit=8000)
    n = 1 + sum(1 for r in rows if str(r.get("expense_number") or "").startswith(prefix))
    return f"{prefix}{n:04d}"


def _month_day(pay_date: str, day: Optional[int]) -> str:
    import calendar
    raw = (pay_date or "")[:10]
    try:
        y, m, d = [int(x) for x in raw.split("-")]
        base = date(y, m, d)
    except (TypeError, ValueError):
        base = employee_pay.istanbul_today()
    use = int(day) if day else base.day
    last = calendar.monthrange(base.year, base.month)[1]
    return date(base.year, base.month, min(max(1, use), last)).isoformat()


def next_monthly_date(pay_date: str, day: Optional[int] = None) -> str:
    import calendar
    raw = (pay_date or "")[:10]
    try:
        y, m, d0 = [int(x) for x in raw.split("-")]
        cur = date(y, m, d0)
    except (TypeError, ValueError):
        cur = employee_pay.istanbul_today()
    use = int(day) if day else cur.day
    if cur.month == 12:
        nxt = date(cur.year + 1, 1, 1)
    else:
        nxt = date(cur.year, cur.month + 1, 1)
    last = calendar.monthrange(nxt.year, nxt.month)[1]
    return date(nxt.year, nxt.month, min(max(1, use), last)).isoformat()


async def _close_personnel_debt(
    db, emp: dict, exp: dict, ln: dict, movement_id: str, pay_date: str, *, cx: finance_txn.CompensatingTxn,
) -> List[dict]:
    """MSR kaydındaki personel borcunu kapatır. Masrafın kendisi silinmez, gider yeniden yazılmaz."""
    if employee_pay.personnel_debt_closed(exp):
        raise HTTPException(status_code=400, detail="Personel masraf borcu zaten kapanmış.")
    if not employee_pay.personnel_debt_open(exp):
        raise HTTPException(status_code=400, detail="Bu masrafta personel tarafından ödenen açık borç yok.")
    debt = employee_pay.personnel_debt_amount(exp)
    if ln["amount"] + 0.004 < debt:
        raise HTTPException(status_code=400, detail="Ödeme tutarı personel masraf borcundan az.")
    prev = _debt_snapshot(exp)
    eid = exp["_id"]
    cid = _cid(emp)
    number = str(exp.get("expense_number") or ln.get("expense_number") or "")
    ln["expense_id"] = eid
    if number:
        ln["expense_number"] = number
    await db.expenses.update_one(
        {"_id": eid, "company_id": cid},
        {"$set": {
            "personnel_debt_status": "closed",
            "reimburse_movement_id": movement_id,
            "personnel_reimbursed_at": pay_date,
            "reimbursed_amount": ln["amount"],
        }},
    )

    async def _undo(eid=eid, prev=prev):
        await db.expenses.update_one({"_id": eid}, {"$set": prev})

    cx.push("debt", _undo)
    return [{
        "collection": "expenses",
        "id": eid,
        "action": "reopen_personnel_debt",
        "prev": prev,
    }]


async def _mark_linked_expense_paid(
    db, emp: dict, exp: dict, ln: dict, movement_id: str, pay_date: str, account_name: Optional[str],
    *, cx: finance_txn.CompensatingTxn,
) -> List[dict]:
    """Mevcut ödenmemiş masrafı bu ödeme ile kapatır; yeni MSR açılmaz."""
    if str(exp.get("payment_status") or "") == "paid":
        raise HTTPException(status_code=400, detail="Bu masraf zaten ödenmiş.")
    eid = exp["_id"]
    cid = _cid(emp)
    prev = {
        "payment_status": exp.get("payment_status"),
        "account_id": exp.get("account_id"),
        "partner_id": exp.get("partner_id"),
        "account_name": exp.get("account_name"),
        "paid_date": exp.get("paid_date"),
        "reimburse_movement_id": exp.get("reimburse_movement_id"),
    }
    patch = {
        "payment_status": "paid",
        "account_id": None if ln.get("partner_id") else ln.get("account_id"),
        "partner_id": ln.get("partner_id"),
        "account_name": account_name,
        "paid_date": pay_date,
        "reimburse_movement_id": movement_id,
    }
    await db.expenses.update_one({"_id": eid, "company_id": cid}, {"$set": patch})
    ln["expense_id"] = eid
    number = str(exp.get("expense_number") or "")
    if number:
        ln["expense_number"] = number

    async def _undo(eid=eid, prev=prev):
        await db.expenses.update_one({"_id": eid}, {"$set": prev})

    cx.push("exp_pay", _undo)
    return [{"collection": "expenses", "id": eid, "action": "unpay", "prev": prev}]


async def _insert_reimburse_expense(
    db, emp: dict, ln: dict, movement_id: str, pay_date: str, account_name: Optional[str],
    *, cx: finance_txn.CompensatingTxn, template: bool = False,
) -> dict:
    cid = _cid(emp)
    amount = round(ln["amount"], 2)
    number = await _next_msr(db, cid)
    desc = ln.get("description") or f"{emp.get('full_name')} · {ln.get('category') or employee_pay.REIMBURSE_DEFAULT_CATEGORY}"
    link = _link(movement_id) if not template else {}
    eid = f"{'rexp' if template else 'pexp'}_{uuid.uuid4().hex[:10]}"
    doc = {
        "_id": eid,
        "company_id": cid,
        "expense_number": number,
        "date": pay_date,
        "category": ln.get("category") or employee_pay.REIMBURSE_DEFAULT_CATEGORY,
        "description": desc[:200],
        "amount": amount,
        "vat_rate": 0,
        "vat_amount": 0,
        "total": amount,
        "currency": "TRY",
        "fx_rate": 1,
        "local_total": amount,
        "payment_status": "template" if template else "paid",
        "account_id": None if ln.get("partner_id") else ln.get("account_id"),
        "partner_id": ln.get("partner_id"),
        "account_name": None if template else account_name,
        "paid_date": None if template else pay_date,
        "employee_id": emp.get("_id"),
        "employee_name": emp.get("full_name"),
        "notes": "Tekrarlayan personel masraf şablonu" if template else (ln.get("description") or "Personel masraf ödemesi"),
        "is_recurring": bool(template),
        "recurrence": "monthly",
        "source": REIMBURSE_TEMPLATE_SOURCE if template else SOURCE,
        "charge_to_account": bool(ln.get("charge_to_account")),
        "account_effect": ln.get("account_effect") if ln.get("charge_to_account") else None,
        "created_at": _now(),
    }
    if template:
        day = ln.get("recurring_day")
        doc["recurrence_day"] = day
        doc["recurring_end"] = ln.get("recurring_end")
        doc["next_date"] = next_monthly_date(pay_date, day)
        doc["date"] = _month_day(pay_date, day)
    else:
        doc.update(link)
        doc["personnel_movement_id"] = movement_id
        if ln.get("recurring_parent_id"):
            doc["recurring_parent_id"] = ln["recurring_parent_id"]
    await db.expenses.insert_one(doc)
    cx.push("exp_ins", lambda eid=eid: db.expenses.delete_one({"_id": eid}))
    if not template:
        ln["expense_id"] = eid
        ln["expense_number"] = number
    return doc


async def _charge_personnel_account(
    db, emp: dict, ln: dict, period: str, pay_date: str, movement_id: str, cx: finance_txn.CompensatingTxn,
) -> List[dict]:
    """Hesaba yaz: borç = maaştan düşülecek; hak ediş = ek ödeme (kalan borç güncellenir)."""
    amount = round(ln["amount"], 2)
    if amount <= 0.004 or not ln.get("charge_to_account"):
        return []
    effect = employee_pay.reimburse_account_effect(ln)
    if effect == employee_pay.REIMBURSE_EFFECT_ENTITLEMENT:
        btype, label = "bakiye", ENTITLEMENT_LABEL
    else:
        btype, label = "borc", DEBT_LABEL
    bid = str(uuid.uuid4())
    doc = {
        "_id": bid,
        "company_id": emp.get("company_id"),
        "employee_id": emp.get("_id"),
        "employee_name": emp.get("full_name"),
        "type": btype,
        "type_label": label,
        "period": period,
        "amount": amount,
        "status": "paid",
        "note": ln.get("description") or label,
        "date": pay_date,
        "paid_at": pay_date,
        "account_id": ln.get("account_id"),
        "source": SOURCE,
        "movement_id": movement_id,
        "created_at": _now(),
    }
    doc.update(_link(movement_id))
    await db.bonus_payments.insert_one(doc)
    cx.push("bonus_ins", lambda bid=bid: db.bonus_payments.delete_one({"_id": bid}))
    return [{"collection": "bonus_payments", "id": bid, "action": "insert", "paid_delta": amount}]


async def _ensure_reimburse_template(
    db, emp: dict, ln: dict, pay_date: str, *, cx: finance_txn.CompensatingTxn,
) -> Optional[str]:
    if not ln.get("recurring"):
        return ln.get("recurring_parent_id")
    day = ln.get("recurring_day")
    period = (pay_date or "")[:7]
    existing = await db.expenses.find_one({
        "company_id": _cid(emp),
        "employee_id": emp.get("_id"),
        "source": REIMBURSE_TEMPLATE_SOURCE,
        "is_recurring": True,
        "account_id": ln.get("account_id"),
        "partner_id": ln.get("partner_id"),
        "category": ln.get("category"),
        "charge_to_account": bool(ln.get("charge_to_account")),
        "account_effect": ln.get("account_effect") if ln.get("charge_to_account") else None,
        "date": {"$regex": f"^{period}"},
    })
    if existing:
        ln["recurring_parent_id"] = existing["_id"]
        return existing["_id"]
    tpl = await _insert_reimburse_expense(db, emp, ln, "", pay_date, None, cx=cx, template=True)
    if day and not tpl.get("recurrence_day"):
        await db.expenses.update_one({"_id": tpl["_id"]}, {"$set": {"recurrence_day": day}})
    ln["recurring_parent_id"] = tpl["_id"]
    return tpl["_id"]


async def _apply_reimburse(
    db, emp: dict, ln: dict, movement_id: str, pay_date: str, period: str, account_name: Optional[str],
    *, cx: finance_txn.CompensatingTxn,
) -> List[dict]:
    """Yeni MSR aç veya mevcut kayda bağla; isteğe bağlı personel hesabı + tekrar."""
    effects: List[dict] = []
    existing = await _load_reimburse_expense(db, emp, ln)
    if existing:
        if str(existing.get("employee_id") or "") != str(emp.get("_id") or ""):
            raise HTTPException(status_code=400, detail="Masraf bu personele ait değil.")
        if employee_pay.expense_is_recurring_template(existing):
            raise HTTPException(status_code=400, detail="Tekrarlayan şablona bağlanamaz.")
        if employee_pay.personnel_debt_open(existing):
            effects.extend(await _close_personnel_debt(db, emp, existing, ln, movement_id, pay_date, cx=cx))
        elif employee_pay.personnel_debt_closed(existing):
            raise HTTPException(status_code=400, detail="Personel masraf borcu zaten kapanmış.")
        else:
            effects.extend(await _mark_linked_expense_paid(
                db, emp, existing, ln, movement_id, pay_date, account_name, cx=cx,
            ))
    else:
        created = await _insert_reimburse_expense(
            db, emp, ln, movement_id, pay_date, account_name, cx=cx, template=False,
        )
        effects.append({"collection": "expenses", "id": created["_id"], "action": "insert"})
    if ln.get("charge_to_account"):
        effects.extend(await _charge_personnel_account(db, emp, ln, period, pay_date, movement_id, cx))
    if ln.get("recurring"):
        await _ensure_reimburse_template(db, emp, ln, pay_date, cx=cx)
        if ln.get("recurring_parent_id") and ln.get("expense_id"):
            await db.expenses.update_one(
                {"_id": ln["expense_id"]},
                {"$set": {"recurring_parent_id": ln["recurring_parent_id"]}},
            )
    return effects


def recurring_expense_rows(expenses: Optional[List[dict]]) -> List[dict]:
    """Personel kartı / İK: durdurulabilir tekrarlayan masraf şablonları."""
    out: List[dict] = []
    for e in expenses or []:
        if not e.get("is_recurring"):
            continue
        out.append({
            "id": e.get("id") or e.get("_id"),
            "expense_number": e.get("expense_number"),
            "category": e.get("category"),
            "description": e.get("description") or "",
            "amount": e.get("total") if e.get("total") not in (None, "") else e.get("amount"),
            "recurrence_day": e.get("recurrence_day"),
            "recurring_end": e.get("recurring_end"),
            "next_date": e.get("next_date"),
            "charge_to_account": bool(e.get("charge_to_account")),
            "account_effect": e.get("account_effect"),
            "account_name": e.get("account_name"),
            "is_recurring": True,
            "employee_id": e.get("employee_id"),
            "source": e.get("source"),
        })
    return out


def reimbursement_rows(movements: Optional[List[dict]]) -> List[dict]:
    """İK portalı: masraf ödemesi tek satır, rozet metni sabit."""
    out: List[dict] = []
    for m in movements or []:
        if str(m.get("kind") or "") != "reimburse":
            continue
        if str(m.get("status") or "posted") in ("reversed", "cancelled"):
            continue
        out.append({
            "id": m.get("id") or m.get("_id"),
            "kind": "reimburse",
            "kind_label": KIND_LABELS["reimburse"],
            "amount": m.get("amount"),
            "date": m.get("date") or m.get("created_at"),
            "account_name": m.get("account_name"),
            "description": m.get("description") or "",
            "expense_number": m.get("expense_number"),
            "category": m.get("category"),
            "charge_to_account": bool(m.get("charge_to_account")),
            "account_effect": m.get("account_effect"),
            "status": m.get("status") or "posted",
        })
    return out


async def _apply_payment_lines_body(
    db,
    emp: dict,
    company: Optional[dict],
    payload: Optional[dict],
    *,
    balance: Optional[dict],
    pay_date: str,
    period: str,
) -> dict:
    payload = payload or {}
    balance = balance or {}
    lines = normalize_lines(payload.get("lines"))
    actor = payload.get("_actor")
    if any(ln["kind"] == "reimburse" for ln in lines):
        err = rbac.personnel_expense_forbidden(actor, (actor or {}).get("permissions"))
        if err:
            raise HTTPException(status_code=403, detail=err)
    accounts = await _load_accounts(db, lines, emp)
    sgk_err = employee_pay.validate_sgk_lines(emp, company, lines, accounts)
    if sgk_err:
        raise HTTPException(status_code=400, detail=sgk_err)
    cash_err = employee_pay.grouped_cash_shortfall(lines, accounts)
    if cash_err:
        raise HTTPException(status_code=400, detail=cash_err)

    balance_lines = employee_pay.payment_lines_affecting_balance(lines)
    preview = employee_pay.payment_after(balance.get("remaining"), balance_lines)
    cash_total = round(sum(ln["amount"] for ln in lines), 2)
    manual_salary = any(ln["kind"] == "salary" for ln in lines) and _amt(balance.get("unpaid_payroll")) <= 0.004
    key = str(payload.get("idempotency_key") or "").strip()[:200]
    receipt_id = f"rcpt_{uuid.uuid4().hex[:10]}"

    async def _body(cx: finance_txn.CompensatingTxn) -> dict:
        saved_lines = []
        for ln in lines:
            movement_id = str(uuid.uuid4())
            acc = accounts.get(ln.get("account_id") or "")
            account_name = await _cash_out(db, emp, ln, acc, pay_date, period, movement_id, cx)
            excess = 0.0
            effects: List[dict] = []
            if ln["kind"] in ("salary", "remaining"):
                excess, cov = await _cover_salary(db, emp, period, ln["amount"], pay_date, movement_id=movement_id, cx=cx)
                effects.extend(cov)
                if ln["kind"] == "remaining" and excess > 0.004:
                    excess, cov = await _cover_expenses(db, emp, excess, pay_date, cx=cx)
                    effects.extend(cov)
                    excess, cov = await _cover_allowance(
                        db, emp, period, excess, pay_date, balance, movement_id=movement_id, cx=cx,
                    )
                    effects.extend(cov)
                    excess, cov = await _cover_bonus(db, emp, excess, pay_date, cx=cx)
                    effects.extend(cov)
            elif ln["kind"] == "advance":
                excess = ln["amount"]
            elif ln["kind"] == "bonus":
                excess, cov = await _cover_bonus(db, emp, ln["amount"], pay_date, cx=cx)
                effects.extend(cov)
            elif ln["kind"] == "expense":
                excess, cov = await _cover_expenses(db, emp, ln["amount"], pay_date, cx=cx)
                effects.extend(cov)
            elif ln["kind"] in ("meal", "transport"):
                excess, cov = await _cover_allowance(
                    db, emp, period, ln["amount"], pay_date, balance, movement_id=movement_id, cx=cx,
                )
                effects.extend(cov)
            elif ln["kind"] == "reimburse":
                effects.extend(await _apply_reimburse(
                    db, emp, ln, movement_id, pay_date, period, account_name, cx=cx,
                ))
                excess = 0.0
            if excess > 0.004 and ln["kind"] != "advance":
                effects.extend(await _insert_advance(
                    db, emp, period, excess, pay_date, "Fazla ödeme", ln.get("account_id"), movement_id, cx,
                ))
            elif ln["kind"] == "advance":
                effects.extend(await _insert_advance(
                    db, emp, period, ln["amount"], pay_date, ln.get("description") or "Avans",
                    ln.get("account_id"), movement_id, cx,
                ))
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
                "expense_id": ln.get("expense_id"),
                "expense_number": ln.get("expense_number"),
                "category": ln.get("category"),
                "charge_to_account": bool(ln.get("charge_to_account")),
                "account_effect": ln.get("account_effect"),
                "recurring_parent_id": ln.get("recurring_parent_id"),
                "date": pay_date,
                "idempotency_key": key or None,
                "receipt_id": receipt_id,
                "effects": effects,
                "status": "posted",
                "created_at": _now(),
            }
            await db.personnel_movements.insert_one(movement)
            cx.push("mov", lambda mid=movement_id: db.personnel_movements.delete_one({"_id": mid}))
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
            "total": cash_total,
            "remaining_before": result["remaining_before"],
            "remaining_after": result["remaining_after"],
            "overpaid": result["overpaid"],
            "idempotency_key": key or None,
            "status": "issued",
            "result": result,
            "created_at": _now(),
        })
        cx.push("rcpt", lambda rid=receipt_id: db.personnel_receipts.delete_one({"_id": rid}))
        return result

    return await finance_txn.CompensatingTxn(label=f"personnel-pay:{emp.get('_id')}").run(_body)


async def apply_payment_lines(
    db,
    emp: dict,
    company: Optional[dict],
    payload: Optional[dict],
    *,
    balance: Optional[dict] = None,
    pay_date: str,
    period: str,
    request: Optional[Request] = None,
    actor: Optional[dict] = None,
) -> dict:
    payload = payload or {}
    header = idempotency.header_key(request) if request is not None else ""
    key = header or str(payload.get("idempotency_key") or "").strip()[:200]
    if key and not payload.get("idempotency_key"):
        payload = {**payload, "idempotency_key": key}
    if actor is not None and not payload.get("_actor"):
        payload = {**payload, "_actor": actor}
    req = request if request is not None else (_Hdr(key) if key else None)

    async def _go():
        return await _apply_payment_lines_body(
            db, emp, company, payload, balance=balance, pay_date=pay_date, period=period,
        )

    if req is None:
        return await _go()
    return await idempotency.run(db, _cid(emp), req, "personnel/settle", _go)


async def _undo_effect(db, eff: dict) -> None:
    coll = eff.get("collection")
    did = eff.get("id")
    if not coll or not did:
        return
    action = eff.get("action")
    store = getattr(db, coll, None)
    if store is None:
        return
    if action == "insert":
        await store.delete_one({"_id": did})
        return
    if action == "reopen_personnel_debt":
        prev = eff.get("prev") if isinstance(eff.get("prev"), dict) else {}
        await store.update_one(
            {"_id": did},
            {"$set": {
                "personnel_debt_status": prev.get("personnel_debt_status"),
                "reimburse_movement_id": prev.get("reimburse_movement_id"),
                "personnel_reimbursed_at": prev.get("personnel_reimbursed_at"),
                "reimbursed_amount": prev.get("reimbursed_amount"),
            }},
        )
        return
    if action == "unpay":
        prev = eff.get("prev") if isinstance(eff.get("prev"), dict) else {}
        await store.update_one({"_id": did}, {"$set": prev})
        return
    doc = await store.find_one({"_id": did})
    if not doc:
        return
    delta = round(_amt(eff.get("paid_delta")), 2)
    if delta > 0.004 and _tracks_paid_amount(coll, doc):
        await _subtract_paid_amount(db, coll, did, delta)
        return
    field = eff.get("status_field") or ("status" if coll == "bonus_payments" else "payment_status")
    paid_value = eff.get("paid_value") or "paid"
    await store.update_one_atomic(
        {"_id": did, field: paid_value},
        {"$set": {
            field: eff.get("prev_status"),
            "paid_at": eff.get("prev_paid_at"),
            "paid_date": eff.get("prev_paid_date"),
        }},
    )


async def reverse_payment(db, mov: dict, actor: Optional[dict] = None) -> dict:
    if not mov:
        raise HTTPException(status_code=404, detail="Ödeme hareketi bulunamadı.")
    if actor is not None:
        await tenant_access.require_company_admin(actor, str(mov.get("company_id") or ""))
    status = str(mov.get("status") or "posted")
    if status in ("reversed", "cancelled"):
        return {"status": "success", "idempotent": True, "message": "Ödeme zaten geri alınmış."}
    cid = str(mov.get("company_id") or "")
    mid = mov["_id"]
    claim = await db.personnel_movements.update_one_atomic(
        {"_id": mid, "status": {"$nin": ["reversed", "cancelled", "reversing"]}},
        {"$set": {"status": "reversing", "reversing_at": _now()}},
    )
    if _matched(claim) == 0:
        fresh = await db.personnel_movements.find_one({"_id": mid}) or {}
        if str(fresh.get("status") or "") in ("reversed", "cancelled"):
            return {"status": "success", "idempotent": True, "message": "Ödeme zaten geri alınmış."}
        raise HTTPException(status_code=409, detail="Bu ödemenin geri alınması sürüyor.")
    applied = 0
    try:
        rev = await linked_moves.reverse_linked(
            db, SOURCE, mid, mode="delete", actor=actor,
            reason="ödemeyi geri al", also_expenses=True, company_id=cid or None,
        )
        for eff in reversed(list(mov.get("effects") or [])):
            await _undo_effect(db, eff)
            applied += 1
        rid = mov.get("receipt_id")
        if rid:
            await db.personnel_receipts.update_one(
                {"_id": rid, "company_id": cid} if cid else {"_id": rid},
                {"$set": {"status": "cancelled", "cancelled_at": _now()}},
            )
        done = await db.personnel_movements.update_one_atomic(
            {"_id": mid, "status": "reversing"},
            {"$set": {"status": "reversed", "reversed_at": _now()}, "$unset": {"reversing_at": ""}},
        )
        if _matched(done) == 0:
            raise HTTPException(status_code=409, detail="Bu ödemenin geri alınması sürüyor.")
    except Exception:
        if applied == 0:
            await db.personnel_movements.update_one_atomic(
                {"_id": mid, "status": "reversing"},
                {"$set": {"status": status}, "$unset": {"reversing_at": ""}},
            )
        raise
    return {
        "status": "success",
        "idempotent": False,
        "message": "Ödeme geri alındı.",
        "reversed": rev.get("reversed", 0),
        "receipt_id": rid,
    }


_CLOSED_MOVE = ("reversed", "cancelled", "reversing")


def movement_ids_on(doc: Optional[dict]) -> List[str]:
    """Personel kaydının işaret ettiği ödeme hareketi id'leri."""
    if not doc:
        return []
    ids: List[str] = []
    for key in ("movement_id", "personnel_movement_id"):
        val = str(doc.get(key) or "").strip()
        if val and val not in ids:
            ids.append(val)
    st = str(doc.get("source_type") or doc.get("source") or "").strip()
    if st == SOURCE:
        val = str(doc.get("source_id") or "").strip()
        if val and val not in ids:
            ids.append(val)
    return ids


def _move_open(mov: Optional[dict]) -> bool:
    if not mov:
        return False
    return str(mov.get("status") or "posted") not in _CLOSED_MOVE


async def movements_linked_to(db, doc: dict, collection: str) -> List[dict]:
    """Personel prim/bordro kaydına bağlı, hâlâ açık ödeme hareketleri.

    Doğrudan movement_id / source_id ve effects içindeki kayıt id'si.
    Bakiye formülüne dokunmaz; yalnız silme sırasında geri alınacak hareketi bulur.
    """
    cid = str((doc or {}).get("company_id") or "")
    doc_id = str((doc or {}).get("_id") or (doc or {}).get("id") or "")
    out: List[dict] = []
    seen = set()

    def _keep(mov: Optional[dict]) -> None:
        if not _move_open(mov):
            return
        mid = str(mov.get("_id") or "")
        if not mid or mid in seen:
            return
        mcid = str(mov.get("company_id") or "")
        if cid and mcid and mcid != cid:
            return
        seen.add(mid)
        out.append(mov)

    for mid in movement_ids_on(doc):
        _keep(await db.personnel_movements.find_one({"_id": mid}))

    if doc_id and collection:
        q: Dict[str, Any] = {"effects": {"$elemMatch": {"id": doc_id, "collection": collection}}}
        if cid:
            q["company_id"] = cid
        for mov in await _rows(db, "personnel_movements", q, limit=500):
            _keep(mov)
    return out


async def month_occurrence_exists(db, parent_id: str, period: str, cid: str) -> bool:
    if not parent_id or not period:
        return False
    q_exp: Dict[str, Any] = {
        "recurring_parent_id": parent_id,
        "date": {"$regex": f"^{period}"},
    }
    if cid:
        q_exp["company_id"] = cid
    if await db.expenses.find_one(q_exp):
        return True
    q_mov: Dict[str, Any] = {
        "recurring_parent_id": parent_id,
        "period": period,
        "kind": "reimburse",
        "status": {"$nin": list(_CLOSED_MOVE)},
    }
    if cid:
        q_mov["company_id"] = cid
    return bool(await db.personnel_movements.find_one(q_mov))


async def spawn_recurring_reimburse(db, template: dict, pay_date: str) -> Optional[dict]:
    """Tekrarlayan şablondan bir ay oluşur; aynı ay ikinci kez yazılmaz."""
    if not template or not template.get("is_recurring"):
        return None
    end = str(template.get("recurring_end") or "").strip()[:10]
    if end and pay_date > end:
        return None
    cid = str(template.get("company_id") or "")
    period = (pay_date or "")[:7]
    parent_id = str(template.get("_id") or template.get("id") or "")
    if await month_occurrence_exists(db, parent_id, period, cid):
        return {"status": "skipped", "reason": "already", "period": period}
    emp = await db.employees.find_one({"_id": template.get("employee_id"), "company_id": cid})
    if not emp:
        if not template.get("employee_id"):
            return None
        emp = {
            "_id": template.get("employee_id"),
            "company_id": cid,
            "full_name": template.get("employee_name") or "",
        }
    amount = round(_amt(template.get("total") if template.get("total") not in (None, "") else template.get("amount")), 2)
    if amount <= 0.004:
        return None
    line = {
        "kind": "reimburse",
        "amount": amount,
        "account_id": template.get("account_id"),
        "partner_id": template.get("partner_id"),
        "category": template.get("category") or employee_pay.REIMBURSE_DEFAULT_CATEGORY,
        "description": template.get("description") or "",
        "charge_to_account": bool(template.get("charge_to_account")),
        "recurring_parent_id": parent_id,
    }
    if line["charge_to_account"]:
        line["account_effect"] = employee_pay.reimburse_account_effect(template)
    if not line.get("account_id") and not line.get("partner_id"):
        return None
    balance = {"remaining": 0.0, "unpaid_payroll": 0.0, "meal_due": 0.0, "transport_due": 0.0}
    return await apply_payment_lines(
        db, emp, {}, {"lines": [line]}, balance=balance, pay_date=pay_date, period=period,
    )


async def reverse_linked_personnel_payments(
    db, doc: dict, *, collection: str, actor: Optional[dict] = None,
) -> int:
    """Bağlı ödeme hareketini mevcut reverse_payment ile geri al.

    actor verilmezse personel kaydı silme yolu yönetici kontrolünü tekrarlamaz;
    kasa/banka/ortak düzeltmesi reverse_payment → linked_moves içindedir.
    """
    n = 0
    for mov in await movements_linked_to(db, doc, collection):
        await reverse_payment(db, mov, actor=actor)
        n += 1
    return n


def _bonus_trash_label(bonus: dict) -> str:
    amount = float(bonus.get("amount") or 0)
    return f"{bonus.get('employee_name')} · {bonus.get('type')} · {amount:,.2f} ₺"


async def delete_bonus_record(db, bonus: dict) -> bool:
    """Prim kaydını mevcut silme yoluyla çöpe taşır.

    Önce bağlı personel ödeme hareketi (varsa kasa/banka/ortak etkisiyle) geri alınır.
    Kayıt duruyorsa ve ödenmişse bağlı kasa/banka/ortak hareketleri prepare_source_trash
    ile birlikte taşınır. Kayıt zaten yoksa işlem tekrarlanabilir.
    """
    if not bonus or not bonus.get("_id"):
        return False
    bonus_id = bonus["_id"]
    await reverse_linked_personnel_payments(db, bonus, collection="bonus_payments")
    fresh = await db.bonus_payments.find_one({"_id": bonus_id})
    if not fresh:
        return True
    related: List[dict] = []
    if fresh.get("status") == "paid":
        related = await linked_moves.prepare_source_trash(
            db, "personnel_bonus", bonus_id, company_id=fresh.get("company_id"),
        )
    await trash.soft_delete(
        "bonus_payments",
        fresh,
        "bonus",
        _bonus_trash_label(fresh),
        related=related,
        note=fresh.get("status") or "",
    )
    if related:
        await linked_moves.recalc_after_trash(db, related)
    return True


EMPLOYEE_BONUS_BLOCK = "Ödenmiş/hareketli primler var, önce onları yönetin"


async def bonus_has_money_move(db, bonus_id: str, company_id: str) -> bool:
    """Bağlı kasa/banka veya ortak hareketi var mı. Kayıtları değiştirmez."""
    found = await linked_moves.find_linked(
        db, "personnel_bonus", str(bonus_id), company_id=company_id or None,
    )
    return bool(found.get("bank_transactions") or found.get("partner_transactions"))


async def delete_employee_bonuses(db, employee: dict) -> List[dict]:
    """Personelle birlikte çöpe gidecek ödenmemiş ve hareketsiz primleri döndürür.

    Ödenmiş veya kasa/banka/ortak hareketi olan prim varsa 409. Bakiye değişmez,
    hareket geri alınmaz. Dönen kayıtlar personelin çöp kaydına related olarak bağlanır.
    """
    emp_id = str((employee or {}).get("_id") or "").strip()
    cid = str((employee or {}).get("company_id") or "").strip()
    if not emp_id or not cid:
        return []
    rows = await db.bonus_payments.find({"employee_id": emp_id, "company_id": cid}).to_list(5000)
    safe: List[dict] = []
    for row in list(rows):
        if str(row.get("company_id") or "") != cid or str(row.get("employee_id") or "") != emp_id:
            continue
        if str(row.get("status") or "") == "paid" or await bonus_has_money_move(db, str(row.get("_id") or ""), cid):
            raise HTTPException(status_code=409, detail=EMPLOYEE_BONUS_BLOCK)
        safe.append(row)
    return safe
