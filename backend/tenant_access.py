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


def resolve_caller_company(user: Any, requested: Optional[str] = None) -> str:
    """HTTP oturumunda resolve_company_id. Doğrudan çağrıda payload company_id zorunlu."""
    if isinstance(user, dict):
        return resolve_company_id(user, requested)
    cid = str(requested or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket seçilmedi.")
    return cid


_KEEP_CATALOG = object()


async def _doc_from_company_store(db: Any, collection: str, doc_id: str, company_id: str):
    """Dedicated/shared_v2 kaydı kendi deposundan okur.

    Bayrak kapalı veya legacy ise katalog belgesi kalır. Depoda yoksa None:
    çağıran paylaşılan kopyayı dönmez. DSN hatası yukarı çıkar.
    """
    import storage_router

    if not storage_router.enabled():
        return _KEEP_CATALOG
    cid = storage_router.canonical_company_id(str(company_id or ""))
    if not cid:
        return _KEEP_CATALOG
    mode, _epoch, _locked = await storage_router.storage_decision(db, cid)
    if mode == storage_router.LEGACY:
        return _KEEP_CATALOG
    return await db[collection].find_one({"_id": doc_id, "company_id": cid})


async def _doc_from_active_company(db: Any, collection: str, doc_id: str, user: dict):
    """Router açıkken aktif şirketin deposundan {_id, company_id} ile oku.

    Dedicated ve shared_v2 sorguyu router kendi deposuna bırakır. Paylaşılan
    katalog yalnız legacy kipte bu sorguda okunur. Kayıt yoksa veya şirket
    çözülemezse None: çağıran mevcut katalog adımına düşer. DSN hatası çıkar.
    """
    import storage_router

    if not storage_router.enabled():
        return None
    try:
        cid = resolve_company_id(user)
    except HTTPException:
        return None
    cid = storage_router.canonical_company_id(str(cid or ""))
    if not cid:
        return None
    return await db[collection].find_one({"_id": doc_id, "company_id": cid})


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
    routed = await _doc_from_active_company(db, collection, doc_id, user)
    if routed:
        return assert_doc_company(user, routed, not_found=not_found, status_on_deny=status_on_deny)
    doc = await db[collection].find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail=not_found)
    cid = doc.get("company_id")
    if cid is not None and not user_may_access_company(user, str(cid)):
        raise HTTPException(status_code=status_on_deny, detail=not_found if status_on_deny == 404 else "Bu kayıt için yetkiniz yok.")
    if cid is not None:
        live = await _doc_from_company_store(db, collection, doc_id, str(cid))
        if live is not _KEEP_CATALOG:
            if not live:
                raise HTTPException(status_code=404, detail=not_found)
            live_cid = live.get("company_id")
            if live_cid is not None and not user_may_access_company(user, str(live_cid)):
                raise HTTPException(
                    status_code=status_on_deny,
                    detail=not_found if status_on_deny == 404 else "Bu kayıt için yetkiniz yok.",
                )
            return live
    return doc


def assert_doc_company(user: dict, doc: Optional[dict], *, not_found: str = "Kayıt bulunamadı.", status_on_deny: int = 404) -> dict:
    """Yüklenmiş kaydın company_id erişimini doğrula (yoksa 404)."""
    if not doc:
        raise HTTPException(status_code=404, detail=not_found)
    cid = doc.get("company_id")
    if cid is not None and not user_may_access_company(user, str(cid)):
        raise HTTPException(status_code=status_on_deny, detail=not_found if status_on_deny == 404 else "Bu kayıt için yetkiniz yok.")
    return doc


def assert_same_company(user: dict, *docs: Optional[dict], not_found: str = "Kayıt bulunamadı.") -> None:
    """Dönüşüm/bağlama: tüm kayıtlar kullanıcının erişebildiği aynı şirkette olmalı."""
    cids = []
    for d in docs:
        if not d:
            raise HTTPException(status_code=404, detail=not_found)
        cid = str(d.get("company_id") or "").strip()
        if not cid:
            raise HTTPException(status_code=404, detail=not_found)
        if not user_may_access_company(user, cid):
            raise HTTPException(status_code=404, detail=not_found)
        cids.append(cid)
    if len(set(cids)) > 1:
        raise HTTPException(status_code=404, detail=not_found)


async def get_tenant_child(
    db: Any,
    collection: str,
    doc_id: str,
    user: dict,
    *,
    parent_collection: str,
    parent_id_field: str,
    not_found: str = "Kayıt bulunamadı.",
) -> dict:
    """Alt kayıt (company_id yoksa) üst kaydın şirketi üzerinden doğrulanır."""
    doc = await db[collection].find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail=not_found)
    cid = doc.get("company_id")
    if cid is not None:
        if not user_may_access_company(user, str(cid)):
            raise HTTPException(status_code=404, detail=not_found)
        return doc
    parent_id = doc.get(parent_id_field)
    if not parent_id:
        raise HTTPException(status_code=404, detail=not_found)
    await get_tenant_doc(db, parent_collection, parent_id, user, not_found=not_found)
    return doc


def filter_tenant_ids(docs: list, user: dict) -> list:
    """Toplu işlem: yalnızca kullanıcının şirketindeki kayıtları bırak."""
    return [d for d in docs if d and user_may_access_company(user, d.get("company_id"))]


def is_company_admin(user: Optional[dict], company_id: str) -> bool:
    """require_company_admin ile aynı kural; okuma amaçlı, istisna fırlatmaz."""
    if not user or not user_may_access_company(user, company_id):
        return False
    if user.get("is_super_admin"):
        return True
    role = (user.get("role") or "").strip().lower()
    return role in ("admin", "owner")


def id_query(doc_id, company_id=None) -> dict:
    """`_id` süzgeci. company_id doluysa router dedicated/shared_v2 deposuna gider.

    Boş company_id legacy sorgudur: yalnız `_id`.
    """
    query = {"_id": doc_id}
    cid = str(company_id or "").strip()
    if cid:
        query["company_id"] = cid
    return query


async def _routed_mode(db, company_id: str):
    """Router kapalıysa None. Açıksa kip (legacy / shared_v2 / dedicated)."""
    import storage_router

    if not storage_router.enabled():
        return None
    cid = storage_router.canonical_company_id(str(company_id or ""))
    if not cid:
        return None
    mode, _epoch, _locked = await storage_router.storage_decision(db, cid)
    return mode


def _write_count(result, field: str):
    value = getattr(result, field, None)
    if value is None:
        return None
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return None


async def raise_if_unmatched(db, result, company_id, *, detail: str = "Kayıt güncellenemedi.") -> None:
    """Dedicated/shared_v2 yazması 0 satıra denk geldiyse hata.

    Router kapalı ve legacy kip eski gibi susar. Sonuçta sayaç yoksa (eski
    test çiftleri) kontrol edilmez.
    """
    matched = _write_count(result, "matched_count")
    if matched is None:
        matched = _write_count(result, "deleted_count")
    if matched is None or matched >= 1:
        return
    mode = await _routed_mode(db, company_id)
    if mode is None:
        return
    import storage_router

    if mode == storage_router.LEGACY:
        return
    raise HTTPException(status_code=404, detail=detail)


async def delete_one_company(db, collection: str, doc_id, company_id, *, missing: str = "Kayıt silinemedi."):
    """Tek satırı çağıranın şirket deposundan sil.

    Router kapalı veya legacy: yalnız `_id` (eski davranış, sayaç susar).
    Dedicated ve shared_v2: `_id` + company_id. Silinen 0 ise 404.
    """
    cid = str(company_id or "").strip()
    coll = db[collection]
    mode = await _routed_mode(db, cid)
    import storage_router

    if mode is None or mode == storage_router.LEGACY:
        return await coll.delete_one({"_id": doc_id})  # id-ok: legacy kip, company_id yazılmaz
    result = await coll.delete_one({"_id": doc_id, "company_id": cid})
    if _write_count(result, "deleted_count") == 0:
        raise HTTPException(status_code=404, detail=missing)
    return result


async def delete_many_company(db, collection: str, ids, company_id, *, missing: str = "Bağlı kayıt silinemedi."):
    """Birden çok satır. Legacy yalnız `_id`. Arşiv deposu company_id ister."""
    clean = [item for item in (ids or []) if item is not None]
    if not clean:
        return None
    cid = str(company_id or "").strip()
    coll = db[collection]
    mode = await _routed_mode(db, cid)
    import storage_router

    if mode is None or mode == storage_router.LEGACY:
        return await coll.delete_many({"_id": {"$in": clean}})  # id-ok: legacy kip, company_id yazılmaz
    result = await coll.delete_many({"_id": {"$in": clean}, "company_id": cid})
    deleted = _write_count(result, "deleted_count")
    if deleted == 0:
        raise HTTPException(status_code=404, detail=missing)
    return result


async def find_live_doc(db, collection: str, doc_id, company_id):
    """Arşiv şirketinde katalogdaki `_id` kopyasına düşülmez."""
    cid = str(company_id or "").strip()
    coll = db[collection]
    mode = await _routed_mode(db, cid)
    import storage_router

    if mode is not None and mode != storage_router.LEGACY:
        return await coll.find_one({"_id": doc_id, "company_id": cid})
    return await coll.find_one({"_id": doc_id})  # id-ok: legacy veya router kapalı


async def require_company_admin(user: dict, company_id: str) -> None:
    """Demo yükleme/silme gibi işlemler için şirket yöneticisi zorunlu."""
    if not user:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")
    if is_company_admin(user, company_id):
        return
    raise HTTPException(status_code=403, detail="Bu işlem için şirket yöneticisi yetkisi gerekli.")
