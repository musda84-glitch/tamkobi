"""Personel ödeme satırları: cari hareket, kasa/banka, avans mahsubu, idempotency."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Request

import bank_guard
import employee_pay
import finance_txn
import idempotency
import linked_moves
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

SOURCE = "personnel_payment"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _amt(v: Any) -> float:
    return employee_pay._amt(v)


def _cid(emp: dict) -> str:
    return str(emp.get("company_id") or "")


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
    if not period_rows and not employee_pay.month_blocks_salary_fallback(rows, per):
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
        room = round(max(0.0, payable - already), 2)
        take = round(min(room, left), 2) if room > 0.004 else 0.0
        if take <= 0.004:
            continue
        new_paid = round(already + take, 2)
        status = "paid" if new_paid + 0.004 >= payable else "pending"
        prev_status = p.get("status")
        prev_date = p.get("paid_date")
        upd = {
            "paid_amount": new_paid,
            "status": status,
            "paid_date": pay_date if status == "paid" else prev_date,
        }
        if effects and effects[-1].get("id") == p["_id"] and effects[-1].get("action") == "insert":
            upd.update(link)
        res = await db.payrolls.update_one_atomic(_payroll_lock_query(p, cid), {"$set": upd})
        if _matched(res) == 0:
            raise HTTPException(status_code=409, detail="Bordro aynı anda güncellendi. Tekrar deneyin.")
        pid = p["_id"]

        async def _undo_pay(pid=pid, prev_paid=already, prev_status=prev_status, prev_date=prev_date):
            await db.payrolls.update_one(
                {"_id": pid},
                {"$set": {"paid_amount": prev_paid, "status": prev_status, "paid_date": prev_date}},
            )

        cx.push("payroll_upd", _undo_pay)
        p["paid_amount"] = new_paid
        p["status"] = status
        effects.append({
            "collection": "payrolls",
            "id": pid,
            "action": "update",
            "paid_delta": take,
            "prev_paid": already,
            "prev_status": prev_status,
            "prev_paid_date": prev_date,
        })
        left = round(left - take, 2)
    return round(max(0.0, left), 2), effects


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
        res = await getattr(db, coll).update_one_atomic(
            {"_id": row["_id"], "company_id": cid, status_field: {"$ne": paid_value}},
            {"$set": {status_field: paid_value, "paid_at": pay_date, "paid_date": pay_date}},
        )
        if _matched(res) == 0:
            continue
        rid = row["_id"]

        async def _undo_mark(
            coll=coll, rid=rid, status_field=status_field,
            prev_status=prev_status, prev_paid_at=prev_paid_at, prev_paid_date=prev_paid_date,
        ):
            await getattr(db, coll).update_one(
                {"_id": rid},
                {"$set": {status_field: prev_status, "paid_at": prev_paid_at, "paid_date": prev_paid_date}},
            )

        cx.push(f"{coll}_upd", _undo_mark)
        effects.append({
            "collection": coll,
            "id": rid,
            "action": "update",
            "status_field": status_field,
            "prev_status": prev_status,
            "prev_paid_at": prev_paid_at,
            "prev_paid_date": prev_paid_date,
        })
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
    pending = [e for e in rows if e.get("payment_status") != "paid" and _amt(e.get("total")) > 0.004]
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
    accounts = await _load_accounts(db, lines, emp)
    sgk_err = employee_pay.validate_sgk_lines(emp, company, lines, accounts)
    if sgk_err:
        raise HTTPException(status_code=400, detail=sgk_err)
    cash_err = employee_pay.grouped_cash_shortfall(lines, accounts)
    if cash_err:
        raise HTTPException(status_code=400, detail=cash_err)

    preview = employee_pay.payment_after(balance.get("remaining"), lines)
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
            "total": preview["paying"],
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
) -> dict:
    payload = payload or {}
    header = idempotency.header_key(request) if request is not None else ""
    key = header or str(payload.get("idempotency_key") or "").strip()[:200]
    if key and not payload.get("idempotency_key"):
        payload = {**payload, "idempotency_key": key}
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
    if coll == "payrolls":
        await store.update_one(
            {"_id": did},
            {"$set": {
                "paid_amount": eff.get("prev_paid") or 0,
                "status": eff.get("prev_status") or "pending",
                "paid_date": eff.get("prev_paid_date"),
            }},
        )
        return
    field = eff.get("status_field") or ("status" if coll == "bonus_payments" else "payment_status")
    await store.update_one(
        {"_id": did},
        {"$set": {
            field: eff.get("prev_status"),
            "paid_at": eff.get("prev_paid_at"),
            "paid_date": eff.get("prev_paid_date"),
        }},
    )


async def reverse_payment(db, mov: dict, actor: Optional[dict] = None) -> dict:
    if not mov:
        raise HTTPException(status_code=404, detail="Ödeme hareketi bulunamadı.")
    if str(mov.get("status") or "") in ("reversed", "cancelled"):
        return {"status": "success", "idempotent": True, "message": "Ödeme zaten geri alınmış."}
    cid = str(mov.get("company_id") or "")
    mid = mov["_id"]
    rev = await linked_moves.reverse_linked(
        db, SOURCE, mid, mode="delete", actor=actor,
        reason="ödemeyi geri al", also_expenses=True, company_id=cid or None,
    )
    for eff in reversed(list(mov.get("effects") or [])):
        await _undo_effect(db, eff)
    rid = mov.get("receipt_id")
    if rid:
        await db.personnel_receipts.update_one(
            {"_id": rid, "company_id": cid} if cid else {"_id": rid},
            {"$set": {"status": "cancelled", "cancelled_at": _now()}},
        )
    await db.personnel_movements.update_one(
        {"_id": mid},
        {"$set": {"status": "reversed", "reversed_at": _now()}},
    )
    return {
        "status": "success",
        "idempotent": False,
        "message": "Ödeme geri alındı.",
        "reversed": rev.get("reversed", 0),
        "receipt_id": rid,
    }
