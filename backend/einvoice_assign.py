"""Firma e-fatura entegratör ataması.

/system/companies/{id}/einvoice ve admin-v1 aynı yazmayı kullanır.
Sağlayıcı kataloğu server.EINVOICE_PROVIDERS kaydeder; bu modül server'ı import etmez.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import HTTPException

KNOWN_PROVIDERS: Dict[str, Any] = {}


def register_providers(providers: Dict[str, Any]) -> None:
    KNOWN_PROVIDERS.clear()
    KNOWN_PROVIDERS.update(providers or {})


async def assign_company_provider(db, company_id: str, provider: Any) -> dict:
    """Sağlayıcı kodunu yazar. Şifre ve API anahtarı kabul etmez.

    Sağlayıcı değişince kullanıcı adı ve şifreli alanlar temizlenir.
    Dönüş, kayıtlı ayar belgesidir (çağıran yanıtı maskeler).
    """
    if not await db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    provider = (provider or "").strip()
    if provider and provider not in KNOWN_PROVIDERS:
        raise HTTPException(status_code=400, detail="Desteklenmeyen entegratör.")
    existing = await db.einvoice_settings.find_one({"company_id": company_id}) or {}
    now = datetime.now(timezone.utc).isoformat()
    update = {"provider": provider, "updated_at": now, "assigned_at": now}
    unset: Dict[str, str] = {}
    if provider != (existing.get("provider") or ""):
        update["username"] = ""
        update["api_url"] = ""
        update["corporate_code"] = ""
        update["erp_code"] = ""
        update["efatura_url"] = ""
        update["earsiv_url"] = ""
        update["status"] = "simulated"
        unset["password_enc"] = ""
        unset["api_key_enc"] = ""
    if not provider:
        update["status"] = "simulated"
    ops: Dict[str, Any] = {
        "$set": update,
        "$setOnInsert": {
            "_id": str(uuid.uuid4()),
            "company_id": company_id,
            "mode": existing.get("mode") or "test",
            "alias": existing.get("alias") or "",
        },
    }
    if unset:
        ops["$unset"] = unset
    await db.einvoice_settings.update_one({"company_id": company_id}, ops, upsert=True)
    return await db.einvoice_settings.find_one({"company_id": company_id}) or {}


def public_assignment(company_id: str, doc: dict) -> dict:
    """Şifre, kullanıcı adı, VKN ve adres yok. Yalnız atama özeti."""
    code = (doc or {}).get("provider") or ""
    meta = KNOWN_PROVIDERS.get(code) or {}
    return {
        "company_id": company_id,
        "provider": code,
        "provider_name": meta.get("name") or "",
        "assigned": bool(code),
        "status": (doc or {}).get("status") or "simulated",
        "has_password": bool((doc or {}).get("password_enc")),
        "has_api_key": bool((doc or {}).get("api_key_enc")),
    }
