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
    """Bankaya giden tutar (charge). Callback tutarı okunmaz."""
    return float(format_amount(intent.get("amount")))


def _ledger_amount(intent: dict) -> float:
    """Cariye işlenen tutar. Yoksa charge ile aynıdır."""
    raw = intent.get("ledger_amount")
    if raw in (None, ""):
        return _amount(intent)
    return float(format_amount(raw))


_B2B_CARD_PURPOSES = ("b2b_collection", "b2b_order")


def _fee_amount(intent: dict) -> float:
    """Alıcı komisyon farkı. Satıcıda ve panel tahsilatında 0."""
    if str(intent.get("purpose") or "") not in _B2B_CARD_PURPOSES:
        return 0.0
    if str(intent.get("commission_payer") or "") != "buyer":
        return 0.0
    diff = round(_amount(intent) - _ledger_amount(intent), 2)
    return diff if diff > 0 else 0.0


_COLLECTION_PURPOSES = ("contact_collection", "b2b_collection", "b2b_order")


async def _link(db, intent_id: str, tx_id: str, *, company_id: str) -> None:
    cid = str(company_id or "")
    if not cid:
        return
    await db.payment_intents.update_one(
        {"_id": intent_id, "company_id": cid},
        {"$set": {"collection_tx_id": tx_id, "collection_error": None}},
    )


def _effects_of(tx: Any) -> dict:
    raw = tx.get("effects") if isinstance(tx, dict) else None
    if not isinstance(raw, dict):
        return {"account": False, "contact": False}
    out = {"account": bool(raw.get("account")), "contact": bool(raw.get("contact"))}
    if "fee" in raw:
        out["fee"] = bool(raw.get("fee"))
    return out


def _stored_effects(effects: dict) -> dict:
    stored = {"account": bool(effects.get("account")), "contact": bool(effects.get("contact"))}
    if "fee" in effects:
        stored["fee"] = bool(effects.get("fee"))
    return stored


async def _save_effects(db, tx_id: str, effects: dict, *, company_id: str) -> None:
    cid = str(company_id or "")
    if not cid:
        return
    await db.bank_transactions.update_one(
        {"_id": tx_id, "company_id": cid},
        {"$set": {"effects": _stored_effects(effects)}},
    )


async def _ensure_fee(db, fee: dict, *, company_id: str) -> None:
    """Komisyon farkını aynı POS hesabına bir kez yazar. Cari bağlanmaz."""
    cid = str((fee or {}).get("company_id") or "")
    if not cid or cid != str(company_id or ""):
        return
    amount = float(fee.get("amount") or 0)
    if amount <= 0:
        return
    intent_id = str(fee.get("intent_id") or "")
    fee_id = f"vpos:{intent_id}:fee"
    account_id = str(fee.get("account_id") or "")
    existing = await db.bank_transactions.find_one({"_id": fee_id, "company_id": cid})
    if existing and str(existing.get("company_id") or "") != cid:
        raise RuntimeError("account")
    if not existing:
        doc = {
            "_id": fee_id,
            "company_id": fee.get("company_id"),
            "account_id": account_id,
            "account_name": fee.get("account_name") or "",
            "type": "inflow",
            "category": "Kart komisyon farkı",
            "source": "vpos",
            "amount": amount,
            "currency": "TRY",
            "description": "Kart komisyon farkı",
            "date": tr_today(),
            "vpos_intent_id": intent_id,
            "effects": {"account": False},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await db.bank_transactions.insert_one(doc)
        except Exception:
            existing = await db.bank_transactions.find_one({"_id": fee_id, "company_id": cid})
            if not existing or str(existing.get("company_id") or "") != cid:
                raise
        else:
            existing = doc
    effects = existing.get("effects") if isinstance(existing.get("effects"), dict) else {}
    if effects.get("account"):
        return
    await db.bank_accounts.update_one(
        {"_id": account_id, "company_id": cid},
        {"$inc": {"current_balance": amount}},
    )
    try:
        await db.bank_transactions.update_one(
            {"_id": fee_id, "company_id": cid},
            {"$set": {"effects": {"account": True}}},
        )
    except Exception:
        try:
            await db.bank_accounts.update_one(
                {"_id": account_id, "company_id": cid},
                {"$inc": {"current_balance": -amount}},
            )
        except Exception:
            logger.exception("vpos collection fee rollback failed tx=%s", fee_id)
        raise


async def _apply_balances(db, tx_id: str, account_id: str, contact_id: str, amount: float, fee: Optional[dict] = None, *, company_id: str) -> dict:
    """Eksik bakiyeyi yazar. Bu çağrıda artan hesap, cari patlarsa geri alınır.

    ``amount`` ana satırın tutarıdır (cari tahsilatı / ledger). Komisyon farkı
    varsa ayrıca POS hesabına eklenir; cariye yazılmaz.
    """
    cid = str(company_id or "")
    if not cid:
        return {"account": False, "contact": False}
    fresh = await db.bank_transactions.find_one({"_id": tx_id, "company_id": cid}) or {}
    if fresh and str(fresh.get("company_id") or "") != cid:
        raise RuntimeError("account")
    effects = _effects_of(fresh)
    applied_account_now = False
    if not effects["account"]:
        await db.bank_accounts.update_one(
            {"_id": account_id, "company_id": cid},
            {"$inc": {"current_balance": amount}},
        )
        effects["account"] = True
        applied_account_now = True
        await _save_effects(db, tx_id, effects, company_id=cid)
    if contact_id and not effects["contact"]:
        try:
            await db.contacts.update_one(
                {"_id": contact_id, "company_id": cid},
                {"$inc": {"balance": -amount}},
            )
        except Exception:
            if applied_account_now:
                try:
                    await db.bank_accounts.update_one(
                        {"_id": account_id, "company_id": cid},
                        {"$inc": {"current_balance": -amount}},
                    )
                    effects["account"] = False
                    await _save_effects(db, tx_id, effects, company_id=cid)
                except Exception:
                    logger.exception("vpos collection account rollback failed tx=%s", tx_id)
            raise
        effects["contact"] = True
        await _save_effects(db, tx_id, effects, company_id=cid)
    elif not contact_id and not effects["contact"]:
        effects["contact"] = True
        await _save_effects(db, tx_id, effects, company_id=cid)
    if "fee" in effects and not effects["fee"]:
        if fee and float(fee.get("amount") or 0) > 0:
            fee_cid = str(fee.get("company_id") or "")
            if fee_cid != cid:
                raise RuntimeError("account")
            await _ensure_fee(db, fee, company_id=fee_cid)
        effects["fee"] = True
        await _save_effects(db, tx_id, effects, company_id=cid)
    return effects


async def _drop_if_unsettled(db, tx_id: str, *, company_id: str) -> None:
    cid = str(company_id or "")
    if not cid:
        return
    fresh = await db.bank_transactions.find_one({"_id": tx_id, "company_id": cid})
    if not fresh or str(fresh.get("company_id") or "") != cid:
        return
    effects = _effects_of(fresh)
    if effects["account"] or effects["contact"] or effects.get("fee"):
        return
    try:
        await db.bank_transactions.delete_one({"_id": tx_id, "company_id": cid})
    except Exception:
        logger.exception("vpos collection rollback failed tx=%s", tx_id)


def _fee_spec(intent: dict, intent_id: str, account_id: str, account_name: str, company_id: Any) -> Optional[dict]:
    if str(intent.get("purpose") or "") not in _B2B_CARD_PURPOSES:
        return None
    return {
        "amount": _fee_amount(intent),
        "intent_id": intent_id,
        "account_id": account_id,
        "account_name": account_name or "",
        "company_id": company_id,
    }


async def _notify_b2b_collection(db, intent: dict, *, company_id: str) -> None:
    """Yöneticiye uygulama içi bildirim. E-posta yok; hata tahsilatı bozmaz."""
    purpose = str((intent or {}).get("purpose") or "")
    if purpose not in _B2B_CARD_PURPOSES:
        return
    if intent.get("collection_notified"):
        return
    cid = str(intent.get("company_id") or "")
    if not cid or cid != str(company_id or ""):
        return
    intent_id = str(intent.get("_id") or "")
    try:
        import notify
        contact_id = str(intent.get("contact_id") or "")
        contact = await db.contacts.find_one({"_id": contact_id, "company_id": cid}) if contact_id else None
        name = (contact or {}).get("name") or "Cari"
        ledger = _ledger_amount(intent)
        if purpose == "b2b_order":
            ntype = "b2b_order_card"
            title = "Kartlı sipariş ödemesi"
            message = f"{name} portaldan {ledger:,.2f} ₺ kartlı sipariş ödemesi yaptı."
        else:
            ntype = "b2b_card_collection"
            title = "B2B kart tahsilatı"
            message = f"{name} portaldan {ledger:,.2f} ₺ kartla ödedi."
        await notify.insert_notification(db, notify.notification_doc(
            cid,
            ntype,
            title,
            message,
            link=f"/contacts?contact_id={contact_id}" if contact_id else "/banking",
            roles=["admin"],
            ref_type="payment_intent",
            ref_id=intent_id,
        ))
        await db.payment_intents.update_one(
            {"_id": intent_id, "company_id": cid},
            {"$set": {"collection_notified": True}},
        )
    except Exception:
        logger.exception("b2b card notify failed intent=%s", intent_id)


async def _finish(db, intent: dict, intent_id: str, tx_id: str, *, company_id: str) -> None:
    await _link(db, intent_id, tx_id, company_id=company_id)
    await _notify_b2b_collection(db, intent, company_id=company_id)


async def post_collection(db, intent: dict) -> None:
    """Ödenmiş cari tahsilatını bir kez yazar. Hata intent'i paid bırakır."""
    intent = intent or {}
    cid = str(intent.get("company_id") or "")
    if not cid:
        return
    intent_id = str(intent.get("_id") or "")
    if not intent_id or intent.get("purpose") not in _COLLECTION_PURPOSES:
        return
    if str(intent.get("status") or "") != "paid":
        return
    tx_id = f"vpos:{intent_id}"
    b2b = str(intent.get("purpose") or "") in _B2B_CARD_PURPOSES
    try:
        existing = await db.bank_transactions.find_one({"_id": tx_id, "company_id": cid})
        if existing and str(existing.get("company_id") or "") != cid:
            raise RuntimeError("account")
        if existing:
            fee = _fee_spec(
                intent, intent_id,
                str(existing.get("account_id") or ""),
                str(existing.get("account_name") or ""),
                existing.get("company_id"),
            )
            try:
                await _apply_balances(
                    db, tx_id,
                    str(existing.get("account_id") or ""),
                    str(existing.get("contact_id") or ""),
                    float(existing.get("amount") or 0),
                    fee=fee,
                    company_id=cid,
                )
            except Exception:
                await _drop_if_unsettled(db, tx_id, company_id=cid)
                raise
            await _finish(db, intent, intent_id, tx_id, company_id=cid)
            return
        cfg_id = intent.get("vpos_config_id")
        cfg = await db.vpos_configs.find_one({"_id": cfg_id, "company_id": cid}) if cfg_id else None
        if not cfg:
            raise RuntimeError("config")
        account_id = str(cfg.get("account_id") or "").strip()
        account = await db.bank_accounts.find_one({"_id": account_id, "company_id": cid}) if account_id else None
        if not account or str(account.get("company_id") or "") != cid:
            raise RuntimeError("account")
        contact_id = str(intent.get("contact_id") or "").strip()
        contact = await db.contacts.find_one({"_id": contact_id, "company_id": cid}) if contact_id else None
        if not contact or str(contact.get("company_id") or "") != cid:
            raise RuntimeError("contact")
        amount = _ledger_amount(intent)
        description = str(intent.get("description") or "").strip() or "Cari Tahsilat"
        effects = {"account": False, "contact": False}
        if b2b:
            effects["fee"] = False
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
            "effects": effects,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        masked = _masked_pan(intent.get("result"))
        if masked:
            doc["masked_pan"] = masked
        fee = _fee_spec(intent, intent_id, account_id, account.get("account_name") or "", intent.get("company_id"))
        try:
            await db.bank_transactions.insert_one(doc)
        except Exception:
            raced = await db.bank_transactions.find_one({"_id": tx_id, "company_id": cid})
            if not raced or str(raced.get("company_id") or "") != cid:
                raise
            try:
                await _apply_balances(
                    db, tx_id,
                    str(raced.get("account_id") or account_id),
                    str(raced.get("contact_id") or contact_id),
                    float(raced.get("amount") or amount),
                    fee=fee,
                    company_id=cid,
                )
            except Exception:
                await _drop_if_unsettled(db, tx_id, company_id=cid)
                raise
            await _finish(db, intent, intent_id, tx_id, company_id=cid)
            return
        try:
            await _apply_balances(db, tx_id, account_id, contact_id, amount, fee=fee, company_id=cid)
        except Exception:
            await _drop_if_unsettled(db, tx_id, company_id=cid)
            raise
        await _finish(db, intent, intent_id, tx_id, company_id=cid)
    except Exception:
        logger.exception("vpos collection post_failed intent=%s", intent_id)
        try:
            await db.payment_intents.update_one(
                {"_id": intent_id, "company_id": cid},
                {"$set": {"collection_error": "post_failed"}},
            )
        except Exception:
            logger.exception("vpos collection post_failed mark intent=%s", intent_id)
