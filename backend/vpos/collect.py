"""Doğrulanmış sanal POS tahsilatını kasa ve cariye yazar.

Yalnız ``post_collection`` çağrılır; istemci isteği ve intent GET'i tetiklemez.
Kart numarası, CVV ve son kullanma bu modüle girmez.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from .nestpay import format_amount

logger = logging.getLogger("vpos.collect")

_MASKED_PAN = re.compile(r"^\d{6}\*{4,}\d{4}$")
_IST = ZoneInfo("Europe/Istanbul")


def tr_today() -> str:
    return datetime.now(_IST).strftime("%Y-%m-%d")


def _masked_pan(result: Any) -> str:
    if not isinstance(result, dict):
        return ""
    masked = str(result.get("masked_pan") or "")
    return masked if _MASKED_PAN.fullmatch(masked) else ""


def _auth_code(result: Any) -> str:
    if not isinstance(result, dict):
        return ""
    return str(result.get("auth_code") or "").strip()[:32]


def _installment(intent: dict) -> Optional[int]:
    raw = intent.get("installment")
    if raw in (None, ""):
        return None
    try:
        number = int(raw)
    except (TypeError, ValueError):
        return None
    if number < 1:
        return None
    return number


def _amount(intent: dict) -> float:
    """Kayıt tutarı daima intent tutarıdır. Callback tutarı okunmaz."""
    return float(format_amount(intent.get("amount")))


async def _link(db, intent_id: str, tx_id: str) -> None:
    await db.payment_intents.update_one(
        {"_id": intent_id},
        {"$set": {"collection_tx_id": tx_id, "collection_error": None}},
    )


def _effects_of(tx: Any) -> dict:
    raw = tx.get("effects") if isinstance(tx, dict) else None
    if not isinstance(raw, dict):
        return {"account": False, "contact": False}
    return {"account": bool(raw.get("account")), "contact": bool(raw.get("contact"))}


async def _save_effects(db, tx_id: str, effects: dict) -> None:
    await db.bank_transactions.update_one(
        {"_id": tx_id},
        {"$set": {"effects": {"account": bool(effects.get("account")), "contact": bool(effects.get("contact"))}}},
    )


async def _apply_balances(db, tx_id: str, account_id: str, contact_id: str, amount: float) -> dict:
    """Eksik bakiyeyi yazar. Bu çağrıda artan hesap, cari patlarsa geri alınır."""
    fresh = await db.bank_transactions.find_one({"_id": tx_id}) or {}
    effects = _effects_of(fresh)
    applied_account_now = False
    if not effects["account"]:
        await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": amount}})
        effects["account"] = True
        applied_account_now = True
        await _save_effects(db, tx_id, effects)
    if contact_id and not effects["contact"]:
        try:
            await db.contacts.update_one({"_id": contact_id}, {"$inc": {"balance": -amount}})
        except Exception:
            if applied_account_now:
                try:
                    await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": -amount}})
                    effects["account"] = False
                    await _save_effects(db, tx_id, effects)
                except Exception:
                    logger.exception("vpos collection account rollback failed tx=%s", tx_id)
            raise
        effects["contact"] = True
        await _save_effects(db, tx_id, effects)
    elif not contact_id and not effects["contact"]:
        effects["contact"] = True
        await _save_effects(db, tx_id, effects)
    return effects


async def _drop_if_unsettled(db, tx_id: str) -> None:
    fresh = await db.bank_transactions.find_one({"_id": tx_id})
    if not fresh:
        return
    effects = _effects_of(fresh)
    if effects["account"] or effects["contact"]:
        return
    try:
        await db.bank_transactions.delete_one({"_id": tx_id})
    except Exception:
        logger.exception("vpos collection rollback failed tx=%s", tx_id)


async def post_collection(db, intent: dict) -> None:
    """Ödenmiş cari tahsilatını bir kez yazar. Hata intent'i paid bırakır."""
    intent = intent or {}
    intent_id = str(intent.get("_id") or "")
    if not intent_id or intent.get("purpose") != "contact_collection":
        return
    if str(intent.get("status") or "") != "paid":
        return
    tx_id = f"vpos:{intent_id}"
    try:
        existing = await db.bank_transactions.find_one({"_id": tx_id})
        if existing:
            try:
                await _apply_balances(
                    db, tx_id,
                    str(existing.get("account_id") or ""),
                    str(existing.get("contact_id") or ""),
                    float(existing.get("amount") or 0),
                )
            except Exception:
                await _drop_if_unsettled(db, tx_id)
                raise
            await _link(db, intent_id, tx_id)
            return
        cfg_id = intent.get("vpos_config_id")
        cfg = await db.vpos_configs.find_one({"_id": cfg_id}) if cfg_id else None
        if not cfg:
            raise RuntimeError("config")
        account_id = str(cfg.get("account_id") or "").strip()
        account = await db.bank_accounts.find_one({"_id": account_id}) if account_id else None
        if not account or str(account.get("company_id") or "") != str(intent.get("company_id") or ""):
            raise RuntimeError("account")
        contact_id = str(intent.get("contact_id") or "").strip()
        contact = await db.contacts.find_one({"_id": contact_id}) if contact_id else None
        if not contact or str(contact.get("company_id") or "") != str(intent.get("company_id") or ""):
            raise RuntimeError("contact")
        amount = _amount(intent)
        description = str(intent.get("description") or "").strip() or "Cari Tahsilat"
        doc = {
            "_id": tx_id,
            "company_id": intent.get("company_id"),
            "account_id": account_id,
            "account_name": account.get("account_name") or "",
            "type": "inflow",
            "category": "Cari Tahsilat",
            "source": "vpos",
            "contact_id": contact_id,
            "contact_name": contact.get("name") or "",
            "amount": amount,
            "currency": "TRY",
            "description": description[:160],
            "date": tr_today(),
            "vpos_intent_id": intent_id,
            "auth_code": _auth_code(intent.get("result")),
            "installment": _installment(intent),
            "effects": {"account": False, "contact": False},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        masked = _masked_pan(intent.get("result"))
        if masked:
            doc["masked_pan"] = masked
        try:
            await db.bank_transactions.insert_one(doc)
        except Exception:
            raced = await db.bank_transactions.find_one({"_id": tx_id})
            if not raced:
                raise
            try:
                await _apply_balances(
                    db, tx_id,
                    str(raced.get("account_id") or account_id),
                    str(raced.get("contact_id") or contact_id),
                    float(raced.get("amount") or amount),
                )
            except Exception:
                await _drop_if_unsettled(db, tx_id)
                raise
            await _link(db, intent_id, tx_id)
            return
        try:
            await _apply_balances(db, tx_id, account_id, contact_id, amount)
        except Exception:
            await _drop_if_unsettled(db, tx_id)
            raise
        await _link(db, intent_id, tx_id)
    except Exception:
        logger.exception("vpos collection post_failed intent=%s", intent_id)
        try:
            await db.payment_intents.update_one(
                {"_id": intent_id},
                {"$set": {"collection_error": "post_failed"}},
            )
        except Exception:
            logger.exception("vpos collection post_failed mark intent=%s", intent_id)
