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


async def _apply_effects(db, account_id: str, contact_id: str, amount: float) -> None:
    await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": amount}})
    if contact_id:
        await db.contacts.update_one({"_id": contact_id}, {"$inc": {"balance": -amount}})


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
            await _link(db, intent_id, tx_id)
            return
        try:
            await _apply_effects(db, account_id, contact_id, amount)
        except Exception:
            try:
                await db.bank_transactions.delete_one({"_id": tx_id})
            except Exception:
                logger.exception("vpos collection rollback failed intent=%s", intent_id)
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
