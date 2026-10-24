"""POS bloke çözümü: gelen banka hareketini POS bakiyesinin çözülmesi olarak eşler.

Banka hesabı hareketin kendisiyle zaten net tutar kadar artmıştır; burada
yeniden artmaz. POS bakiyesi brüt kadar düşer, komisyon tek masraf olur.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

import account_balance
import expenses

_POS_TYPES = ("pos", "okc_pos")
_TOL = 0.005
_DEFAULT_CATEGORY = "POS Komisyonu"


class SettlementBusy(HTTPException):
    """Aynı banka hareketi için ikinci karşı kayıt. Çağıran bakiyeyi geri almaz."""

    def __init__(self) -> None:
        super().__init__(status_code=409, detail="Bu bloke çözümü zaten işleniyor.")


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
    await account_balance.apply_balance_delta(db, pos_id, gross, company_id=cid)
    if counter_id:
        await db.bank_transactions.delete_one({"_id": counter_id, "company_id": cid})


async def _counters(db, cid: str, tx_id, pos_id: str) -> list:
    rows = await db.bank_transactions.find({
        "company_id": cid,
        "source": "bank_match",
        "related_bank_tx_id": tx_id,
        "account_id": pos_id,
    }).to_list(10)
    return [row for row in rows or [] if isinstance(row, dict)]


def _deleted(result) -> bool:
    return int(getattr(result, "deleted_count", 0) or 0) == 1


async def validate(
    db,
    tx: dict,
    *,
    pos_account_id,
    gross,
    commission,
    category,
) -> dict:
    """Yazmadan önce tutar, hesap, entegrasyon ve para birimi. Bakiye $inc yok."""
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
    if await account_balance.account_is_integrated(db, pos_id, company_id=cid):
        raise HTTPException(
            status_code=400,
            detail="Entegre POS hesabının bakiyesi bankadan gelir; bloke çözümü uygulanamaz.",
        )
    tx_ccy = str(tx.get("currency") or "TRY").upper()
    acc_ccy = str(account.get("currency") or "TRY").upper()
    if tx_ccy != acc_ccy:
        raise HTTPException(status_code=400, detail="POS hesabı ile banka hareketinin para birimi farklı.")
    existing = await _counters(db, cid, tx.get("_id"), pos_id)
    # Eşik kayıtlı current_balance'dır. Liste örtüsü yalnız gösterimdir.
    stored = round(float(account.get("current_balance") or 0), 2)
    if not existing and stored + _TOL < gross_v:
        raise HTTPException(status_code=400, detail="Brüt tutar POS bakiyesini aşıyor.")
    return {
        "cid": cid,
        "pos_id": pos_id,
        "gross": gross_v,
        "commission": commission_v,
        "category": cat,
        "pos_name": account.get("account_name") or "POS",
        "net": net,
        "existing": bool(existing),
    }


def _match_fields(prepared: dict, *, expense_id=None, expense_number=None) -> dict:
    fields = {
        "match_kind": "pos_settlement",
        "target_account_id": prepared["pos_id"],
        "target_account_name": prepared["pos_name"],
        "pos_gross": prepared["gross"],
        "pos_commission": prepared["commission"],
        "category": prepared["category"],
    }
    if expense_id:
        fields["expense_id"] = expense_id
    if expense_number:
        fields["expense_number"] = expense_number
    return fields


async def _commission_expense(db, cid: str, tx: dict, prepared: dict):
    if prepared["commission"] <= 0:
        return None, None
    existing = await db.expenses.find_one({
        "company_id": cid,
        "source": "bank_match",
        "bank_transaction_id": tx.get("_id"),
    })
    if existing and existing.get("_id"):
        return existing.get("_id"), existing.get("expense_number")
    exp = await expenses.record_card_spend(
        cid,
        date=(tx.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        category=prepared["category"],
        description="POS komisyonu",
        amount=prepared["commission"],
        account_id=prepared["pos_id"],
        account_name=prepared["pos_name"],
        bank_tx_id=tx.get("_id"),
        source="bank_match",
    )
    exp_id = (exp or {}).get("id") or (exp or {}).get("_id")
    exp_number = (exp or {}).get("expense_number")
    if not exp_id:
        raise HTTPException(status_code=400, detail="POS komisyon masrafı kaydedilemedi.")
    return exp_id, exp_number


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
    prepared = await validate(
        db, tx,
        pos_account_id=pos_account_id,
        gross=gross,
        commission=commission,
        category=category,
    )
    cid = prepared["cid"]
    pos_id = prepared["pos_id"]
    gross_v = prepared["gross"]
    if prepared.get("existing"):
        exp_id, exp_number = await _commission_expense(db, cid, tx, prepared)
        return _match_fields(prepared, expense_id=exp_id, expense_number=exp_number)
    posted = await account_balance.apply_capped_balance_delta(
        db, pos_id, -gross_v, company_id=cid, floor=gross_v,
        match={"type": {"$in": list(_POS_TYPES)}},
    )
    if posted == "integrated":
        raise HTTPException(
            status_code=400,
            detail="Entegre POS hesabının bakiyesi bankadan gelir; bloke çözümü uygulanamaz.",
        )
    if posted != "posted":
        raise HTTPException(status_code=400, detail="Brüt tutar POS bakiyesini aşıyor.")
    counter_id = str(uuid.uuid4())
    bank_name = tx.get("account_name") or "Banka"
    try:
        await db.bank_transactions.insert_one({
            "_id": counter_id,
            "company_id": cid,
            "account_id": pos_id,
            "account_name": prepared["pos_name"],
            "type": "outflow",
            "category": prepared["category"],
            "amount": gross_v,
            "currency": tx.get("currency") or "TRY",
            "description": f"{bank_name} ← {prepared['pos_name']}: POS bloke çözümü",
            "source": "bank_match",
            "related_bank_tx_id": tx.get("_id"),
            "date": tx.get("date"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        await _restore_pos(db, cid, pos_id, gross_v, None)
        raise
    rows = await _counters(db, cid, tx.get("_id"), pos_id)
    if len(rows) > 1:
        deleted = await db.bank_transactions.delete_one({"_id": counter_id, "company_id": cid})
        if _deleted(deleted):
            await account_balance.apply_balance_delta(db, pos_id, gross_v, company_id=cid)
        raise SettlementBusy()
    try:
        exp_id, exp_number = await _commission_expense(db, cid, tx, prepared)
    except Exception:
        await _restore_pos(db, cid, pos_id, gross_v, counter_id)
        raise
    return _match_fields(prepared, expense_id=exp_id, expense_number=exp_number)


async def reverse(db, tx: dict) -> None:
    """Karşı kaydı silinen satır kadar iade eder. İkinci çağrı bakiye yazmaz."""
    cid = _company_id(tx)
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket bilgisi eksik.")
    seen = set()
    while len(seen) < 20:
        counter = await db.bank_transactions.find_one({
            "related_bank_tx_id": tx.get("_id"),
            "company_id": cid,
            "source": "bank_match",
        })
        if not counter or not counter.get("_id") or counter["_id"] in seen:
            break
        seen.add(counter["_id"])
        deleted = await db.bank_transactions.delete_one({"_id": counter["_id"], "company_id": cid})
        if not _deleted(deleted):
            continue
        try:
            amount = round(float(counter.get("amount") or 0), 2)
        except (TypeError, ValueError):
            amount = 0.0
        pos_id = str(counter.get("account_id") or "").strip()
        if pos_id and amount > 0:
            await account_balance.apply_balance_delta(db, pos_id, amount, company_id=cid)
    expense_id = tx.get("expense_id")
    if expense_id:
        await db.expenses.delete_one({"_id": expense_id, "company_id": cid})
        return
    exp = await db.expenses.find_one({
        "company_id": cid,
        "source": "bank_match",
        "bank_transaction_id": tx.get("_id"),
    })
    if exp and exp.get("_id"):
        await db.expenses.delete_one({"_id": exp["_id"], "company_id": cid})
