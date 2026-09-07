"""Entegre (API bağlı) banka hesaplarına manuel işlem engeli + kredi kartı tahsilat yasağı."""
from fastapi import HTTPException

NO_COLLECT_MSG = "Kredi kartı tahsilat için kullanılamaz. Tahsilatı kasa, banka veya POS hesabına alın."


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
