"""POS bloke çözümü: gelen banka hareketini POS bakiyesinin çözülmesi olarak eşler.

Banka hesabı hareketin kendisiyle zaten net tutar kadar artmıştır; burada
yeniden artmaz. POS bakiyesi brüt kadar düşer, komisyon tek masraf olur.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

import expenses

_POS_TYPES = ("pos", "okc_pos")
_TOL = 0.005
_DEFAULT_CATEGORY = "POS Komisyonu"


def _money(value: Any, label: str) -> float:
    try:
        number = round(float(value), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{label} geçersiz.")
    if number != number:  # NaN
        raise HTTPException(status_code=400, detail=f"{label} geçersiz.")
    return number


def _company_id(tx: dict) -> str:
    return str((tx or {}).get("company_id") or "").strip()


def gross_from_rate(net: float, rate: float) -> float:
    if rate <= 0 or rate >= 1:
        return round(float(net or 0), 2)
    return round(float(net or 0) / (1 - rate), 2)


def suggest_from_rule(rule: Optional[dict], net) -> dict:
    """Öğrenilen orandan brüt önerisi. Otomatik eşleşme bu türü uygulamaz."""
    rule = rule or {}
    try:
        rate = round(float(rule.get("pos_commission_rate") or 0), 6)
    except (TypeError, ValueError):
        rate = 0.0
    try:
        net_v = round(float(net or 0), 2)
    except (TypeError, ValueError):
        net_v = 0.0
    return {
        "suggested_match_kind": "pos_settlement",
        "suggested_pos_commission_rate": rate,
        "suggested_target_account_id": rule.get("target_account_id"),
        "suggested_target_account_name": rule.get("target_account_name"),
        "suggested_category": rule.get("category"),
        "suggested_pos_gross": gross_from_rate(net_v, rate),
    }


def _pick_rule(rules: list, description: str) -> Optional[dict]:
    from bank_auto_match import match_pattern

    if not match_pattern(description or ""):
        return None
    hay = (description or "").lower()
    ordered = sorted(rules or [], key=lambda row: (row.get("hits") or 0), reverse=True)
    for rule in ordered:
        words = str(rule.get("pattern") or "").split()
        if words and all(word in hay for word in words):
            return rule
    return None


async def annotate(db, company_id: str, txs: list) -> list:
    """Eşleşmemiş giriş hareketlerine POS kuralı önerisini yazar. Kayıt güncellemez."""
    cid = str(company_id or "").strip()
    rows = list(txs or [])
    if not cid or not rows:
        return rows
    pending = [
        tx for tx in rows
        if isinstance(tx, dict)
        and tx.get("match_status") != "matched"
        and tx.get("type") == "inflow"
        and str(tx.get("company_id") or "") == cid
    ]
    if not pending:
        return rows
    rules = getattr(db, "bank_match_rules", None)
    if rules is None:
        return rows
    found = await rules.find({"company_id": cid}).to_list(500)
    for tx in pending:
        rule = _pick_rule(found or [], tx.get("description") or "")
        if not rule or rule.get("match_kind") != "pos_settlement":
            continue
        tx.update(suggest_from_rule(rule, tx.get("amount")))
    return rows


async def _restore_pos(db, cid: str, pos_id: str, gross: float, counter_id: Optional[str]) -> None:
    await db.bank_accounts.update_one(
        {"_id": pos_id, "company_id": cid},
        {"$inc": {"current_balance": gross}},
    )
    if counter_id:
        await db.bank_transactions.delete_one({"_id": counter_id, "company_id": cid})


async def apply(
    db,
    tx: dict,
    *,
    pos_account_id,
    gross,
    commission,
    category,
    actor,
) -> dict:
    """POS bakiyesini düşür, karşı hareketi ve tek komisyon masrafını yaz.

    Dönüş, banka hareketine yazılacak alanlardır. Banka bakiyesine dokunmaz.
    actor eşleşme kaydına burada yazılmaz (çağıran matched_by alanlarını kurar).
    """
    del actor
    cid = _company_id(tx)
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket bilgisi eksik.")
    if tx.get("type") != "inflow":
        raise HTTPException(status_code=400, detail="POS bloke çözümü yalnızca giriş hareketlerinde yapılabilir.")
    pos_id = str(pos_account_id or "").strip()
    if not pos_id:
        raise HTTPException(status_code=404, detail="POS hesabı bulunamadı.")
    if pos_id == str(tx.get("account_id") or ""):
        raise HTTPException(status_code=400, detail="POS hesabı hareketin kendi hesabı olamaz.")
    net = _money(tx.get("amount"), "Bankaya gelen tutar")
    gross_v = _money(gross, "Brüt tutar")
    commission_v = _money(commission, "Komisyon")
    if gross_v <= 0:
        raise HTTPException(status_code=400, detail="Brüt tutar sıfırdan büyük olmalı.")
    if gross_v + _TOL < net:
        raise HTTPException(status_code=400, detail="Brüt tutar bankaya gelen tutardan küçük olamaz.")
    if commission_v + _TOL < 0:
        raise HTTPException(status_code=400, detail="Komisyon negatif olamaz.")
    expected = round(gross_v - net, 2)
    if abs(commission_v - expected) > _TOL:
        raise HTTPException(status_code=400, detail="Komisyon, brüt ile bankaya gelen tutarın farkı olmalı.")
    commission_v = expected
    cat = (category or "").strip() or _DEFAULT_CATEGORY
    account = await db.bank_accounts.find_one({"_id": pos_id, "company_id": cid})
    if not account:
        raise HTTPException(status_code=404, detail="POS hesabı bulunamadı.")
    if account.get("type") not in _POS_TYPES:
        raise HTTPException(status_code=400, detail="POS bloke çözümü yalnızca POS hesabına uygulanabilir.")
    pos_name = account.get("account_name") or "POS"
    # Eşik kayıtlı current_balance'dır. Liste örtüsü yalnız gösterimdir.
    updated = await db.bank_accounts.update_one(
        {"_id": pos_id, "company_id": cid, "type": {"$in": ["pos", "okc_pos"]}, "current_balance": {"$gte": gross_v}},
        {"$inc": {"current_balance": -gross_v}},
    )
    if int(getattr(updated, "modified_count", 0) or 0) == 0:
        raise HTTPException(status_code=400, detail="Brüt tutar POS bakiyesini aşıyor.")
    counter_id = str(uuid.uuid4())
    bank_name = tx.get("account_name") or "Banka"
    try:
        await db.bank_transactions.insert_one({
            "_id": counter_id,
            "company_id": cid,
            "account_id": pos_id,
            "account_name": pos_name,
            "type": "outflow",
            "category": cat,
            "amount": gross_v,
            "currency": tx.get("currency") or "TRY",
            "description": f"{bank_name} ← {pos_name}: POS bloke çözümü",
            "source": "bank_match",
            "related_bank_tx_id": tx.get("_id"),
            "date": tx.get("date"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        await _restore_pos(db, cid, pos_id, gross_v, None)
        raise
    exp_id = None
    exp_number = None
    if commission_v > 0:
        try:
            exp = await expenses.record_card_spend(
                cid,
                date=(tx.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")),
                category=cat,
                description="POS komisyonu",
                amount=commission_v,
                account_id=pos_id,
                account_name=pos_name,
                bank_tx_id=tx.get("_id"),
                source="bank_match",
            )
        except Exception:
            await _restore_pos(db, cid, pos_id, gross_v, counter_id)
            raise
        exp_id = (exp or {}).get("id") or (exp or {}).get("_id")
        exp_number = (exp or {}).get("expense_number")
        if not exp_id:
            await _restore_pos(db, cid, pos_id, gross_v, counter_id)
            raise HTTPException(status_code=400, detail="POS komisyon masrafı kaydedilemedi.")
    fields = {
        "match_kind": "pos_settlement",
        "target_account_id": pos_id,
        "target_account_name": pos_name,
        "pos_gross": gross_v,
        "pos_commission": commission_v,
        "category": cat,
    }
    if exp_id:
        fields["expense_id"] = exp_id
    if exp_number:
        fields["expense_number"] = exp_number
    return fields


async def reverse(db, tx: dict) -> None:
    """POS bakiyesini, karşı hareketi ve bağlı masrafı geri alır."""
    cid = _company_id(tx)
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket bilgisi eksik.")
    gross_v = 0.0
    if tx.get("pos_gross") not in (None, ""):
        gross_v = _money(tx.get("pos_gross"), "Brüt tutar")
    pos_id = str(tx.get("target_account_id") or "").strip()
    if pos_id and gross_v > 0:
        await db.bank_accounts.update_one(
            {"_id": pos_id, "company_id": cid},
            {"$inc": {"current_balance": gross_v}},
        )
    counter = await db.bank_transactions.find_one({
        "related_bank_tx_id": tx.get("_id"),
        "company_id": cid,
        "source": "bank_match",
    })
    if counter and counter.get("_id"):
        await db.bank_transactions.delete_one({"_id": counter["_id"], "company_id": cid})
    expense_id = tx.get("expense_id")
    if expense_id:
        await db.expenses.delete_one({"_id": expense_id, "company_id": cid})
