"""Kiracı (company) erişim yardımcıları — company_id ve IDOR filtreleri."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException


def user_allowed_company_ids(user: Optional[dict]) -> set:
    """Yetki yalnızca company_ids listesinden; active_company_id tek başına yetki vermez."""
    if not user:
        return set()
    return {str(x) for x in (user.get("company_ids") or []) if x}


def users_share_company(actor: Optional[dict], target: Optional[dict]) -> bool:
    """İki kullanıcı ortak şirket paylaşıyor mu (veya actor süper admin)."""
    if not actor or not target:
        return False
    if actor.get("is_super_admin"):
        return True
    a = user_allowed_company_ids(actor)
    t = user_allowed_company_ids(target)
    return bool(a & t)


def user_may_access_company(user: Optional[dict], company_id: Optional[str]) -> bool:
    """Oturumsuz kullanıcı hiçbir şirkete erişemez; süper admin tümüne erişir."""
    if not user:
        return False
    if user.get("is_super_admin"):
        return True
    cid = str(company_id or "").strip()
    if not cid:
        return False
    return cid in user_allowed_company_ids(user)


def resolve_company_id(user: dict, requested: Optional[str] = None) -> str:
    """İstek company_id'sini yalnızca kullanıcının erişimi varsa kabul et; aksi halde aktif şirket."""
    if not user:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    allowed = user_allowed_company_ids(user)
    req = str(requested or "").strip()
    if req:
        if user.get("is_super_admin") or req in allowed:
            return req
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")
    active = str(user.get("active_company_id") or "").strip()
    if active and (user.get("is_super_admin") or active in allowed):
        return active
    if allowed:
        return next(iter(sorted(allowed)))
    if user.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="Şirket seçilmedi.")
    raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")


async def get_tenant_doc(
    db: Any,
    collection: str,
    doc_id: str,
    user: dict,
    *,
    not_found: str = "Kayıt bulunamadı.",
    status_on_deny: int = 404,
) -> dict:
    """ID ile kayıt getir; şirketi kullanıcının erişiminde değilse 404/403."""
    doc = await db[collection].find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail=not_found)
    cid = doc.get("company_id")
    if cid is not None and not user_may_access_company(user, str(cid)):
        raise HTTPException(status_code=status_on_deny, detail=not_found if status_on_deny == 404 else "Bu kayıt için yetkiniz yok.")
    return doc


async def require_company_admin(user: dict, company_id: str) -> None:
    """Demo yükleme/silme gibi işlemler için şirket yöneticisi zorunlu."""
    if not user:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")
    if user.get("is_super_admin"):
        return
    role = (user.get("role") or "").strip().lower()
    if role not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Bu işlem için şirket yöneticisi yetkisi gerekli.")
