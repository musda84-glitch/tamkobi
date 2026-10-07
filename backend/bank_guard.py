"""Entegre (API bağlı) banka hesaplarına manuel işlem engeli + kredi kartı tahsilat yasağı."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException

NO_COLLECT_MSG = "Kredi kartı tahsilat için kullanılamaz. Tahsilatı kasa, banka veya POS hesabına alın."
CUSTOMER_CARD_POOL_BANK = "Müşteri Kartları"
CUSTOMER_CARD_POOL_NAME = "Müşteri Kredi Kartları"


def parse_payment_target(value: Optional[str]) -> Tuple[str, str]:
    """Virman / ödeme hedefi: ('partner'|'contact'|'account', id)."""
    raw = str(value or "").strip()
    if raw.startswith("partner:"):
        return "partner", raw[8:]
    if raw.startswith("contact:"):
        return "contact", raw[8:]
    return "account", raw


def is_customer_card_pool(account: Optional[Dict[str, Any]]) -> bool:
    return bool(account and account.get("type") == "credit_card" and account.get("is_customer_card_pool"))


def is_customer_card(account: Optional[Dict[str, Any]]) -> bool:
    """Per-cari müşteri kartı (havuz değil)."""
    if not account or account.get("type") != "credit_card":
        return False
    if account.get("is_customer_card_pool"):
        return False
    if str(account.get("card_owner") or "company") != "customer":
        return False
    return bool(account.get("linked_contact_id"))


async def ensure_customer_card_pool(db, company_id: str) -> Dict[str, Any]:
    """Şirket başına tek «Müşteri Kredi Kartları» kasası — cari virman hareketleri burada görünür."""
    if not company_id:
        raise HTTPException(status_code=400, detail="Şirket gerekli.")
    existing = await db.bank_accounts.find_one({"company_id": company_id, "is_customer_card_pool": True})
    if existing:
        return existing
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "type": "credit_card",
        "bank_name": CUSTOMER_CARD_POOL_BANK,
        "account_name": CUSTOMER_CARD_POOL_NAME,
        "currency": "TRY",
        "current_balance": 0.0,
        "card_owner": "customer",
        "is_customer_card_pool": True,
        "linked_contact_id": None,
        "linked_contact_name": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.bank_accounts.insert_one(doc)
    return doc


async def get_connection_for_account(db, account_id):
    if not account_id:
        return None
    return await db.bank_connections.find_one({"linked_account_id": account_id})


async def assert_manual_allowed(db, account_id):
    conn = await get_connection_for_account(db, account_id)
    if conn:
        name = conn.get("linked_account_name") or "Bu hesap"
        raise HTTPException(status_code=400, detail=f"{name} banka entegrasyonuna ({conn.get('provider_name') or 'API'}) bağlı; manuel işlem yapılamaz. Hareketler bankadan otomatik çekilir ve Banka Entegrasyonu → Eşleştirme ekranından işlenir.")


async def assert_collection_allowed(db, account_id):
    """Company credit cards are spend accounts, not cash-in (tahsilat) targets."""
    if not account_id:
        return None
    acc = await db.bank_accounts.find_one({"_id": account_id})
    if acc and acc.get("type") == "credit_card":
        raise HTTPException(status_code=400, detail=NO_COLLECT_MSG)
    return acc


def customer_card_owner_delta(
    account: Optional[Dict[str, Any]],
    tx_type: str,
    amount: float,
    payee_contact_id: Optional[str] = None,
) -> Optional[Tuple[str, float]]:
    """Müşteri kartından çıkışta cari sahibi bakiyesi: −tutar (alacak azalır / borç artar).

    Returns (owner_contact_id, balance_delta) or None.
    """
    if not is_customer_card(account):
        return None
    owner_id = account.get("linked_contact_id")
    if not owner_id:
        return None
    if str(tx_type or "") != "outflow":
        return None
    if payee_contact_id and str(payee_contact_id) == str(owner_id):
        return None
    return str(owner_id), -float(amount or 0)


async def apply_customer_card_owner_effect(
    db,
    account: Optional[Dict[str, Any]],
    tx_type: str,
    amount: float,
    payee_contact_id: Optional[str] = None,
    *,
    sign: int = 1,
) -> Optional[Dict[str, str]]:
    """sign=+1 uygular, sign=-1 geri alır. owner_contact_id / name döner."""
    hit = customer_card_owner_delta(account, tx_type, amount, payee_contact_id)
    if not hit:
        return None
    owner_id, delta = hit
    await db.contacts.update_one({"_id": owner_id}, {"$inc": {"balance": float(delta) * sign}})
    return {
        "owner_contact_id": owner_id,
        "owner_contact_name": (account or {}).get("linked_contact_name") or "",
    }
