"""Entegre (API bağlı) banka hesaplarına manuel işlem engeli."""
from fastapi import HTTPException


async def get_connection_for_account(db, account_id):
    if not account_id:
        return None
    return await db.bank_connections.find_one({"linked_account_id": account_id})


async def assert_manual_allowed(db, account_id):
    conn = await get_connection_for_account(db, account_id)
    if conn:
        name = conn.get("linked_account_name") or "Bu hesap"
        raise HTTPException(status_code=400, detail=f"{name} banka entegrasyonuna ({conn.get('provider_name') or 'API'}) bağlı; manuel işlem yapılamaz. Hareketler bankadan otomatik çekilir ve Banka Entegrasyonu → Eşleştirme ekranından işlenir.")
