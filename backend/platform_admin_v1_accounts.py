"""admin-v1: kota, eklenti varsayılanı, depolama, panel kullanıcısı, şirket API anahtarı.

Tehlikeli uçlar (kullanıcı silme, anahtar iptali, alt şirket koparma) danger akışındadır.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request

from client_ip import request_ip
import addons
import platform_store as store
import saas
import storage_manager
from platform_admin_v1 import _auth, _item, _redact
from platform_admin_v1_write import (
    _company_or_404,
    _present,
    _reject_unknown,
    _require_bool,
    _write,
    audit_field_names,
    body_has_secret,
    require_secret_scope,
)

router = APIRouter(prefix="/api", tags=["platform-admin-v1-accounts"])

_QUOTA_FIELDS = saas.QUOTA_KEYS


def _quota_value(payload: Dict[str, Any], field: str) -> None:
    value = payload[field]
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise HTTPException(
            status_code=400,
            detail="Limit sayısal olmalıdır (boş = paketten al, 0 = sınırsız).",
        )


async def _storage_company(company_id: str) -> None:
    await _company_or_404(company_id)


@router.put("/platform/admin-v1/companies/{company_id}/quotas")
async def admin_v1_company_quotas(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _QUOTA_FIELDS)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        for field in _QUOTA_FIELDS:
            if field in payload:
                _quota_value(payload, field)
        await _company_or_404(company_id)
        return _present(payload, _QUOTA_FIELDS)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await saas.apply_license_update(company_id, payload)
        return _item(row)

    return await _write(
        request,
        store.SCOPE_ADMIN_QUOTAS_WRITE,
        "company",
        company_id,
        apply,
        op="quota.update",
        prepare=prepare,
    )


@router.get("/platform/admin-v1/addons")
async def admin_v1_addons(request: Request):
    await _auth(request, store.SCOPE_ADMIN_SETTINGS_READ)
    return _redact(await addons._list_addons())


@router.put("/platform/admin-v1/addons")
async def admin_v1_addon_defaults(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("defaults",))
        defaults = payload.get("defaults")
        if not isinstance(defaults, dict) or not defaults:
            raise HTTPException(status_code=400, detail="defaults zorunlu.")
        for key, value in defaults.items():
            if key not in addons.ADDON_KEYS:
                raise HTTPException(status_code=400, detail=f"Bilinmeyen araç: {key}")
            if value is not None and not isinstance(value, bool):
                raise HTTPException(status_code=400, detail=f"{key} boolean ya da null olmalı.")
        return ["defaults"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        return _item(await addons.put_defaults({"defaults": payload["defaults"]}, {}))

    return await _write(
        request,
        store.SCOPE_ADMIN_SETTINGS_WRITE,
        "platform",
        "addons",
        apply,
        op="addon.defaults",
        prepare=prepare,
    )


@router.get("/platform/admin-v1/storage")
async def admin_v1_storage(request: Request):
    await _auth(request, store.SCOPE_ADMIN_STORAGE_READ)
    accounts = await storage_manager.list_accounts_storage()
    return _redact({
        "accounts": accounts,
        "total_accounts": len(accounts),
        "total_bytes": sum(int(a.get("storage_bytes") or 0) for a in accounts),
        "areas": [{"key": a["key"], "label": a["label"]} for a in storage_manager.STORAGE_AREAS],
    })


@router.get("/platform/admin-v1/companies/{company_id}/storage")
async def admin_v1_company_storage(company_id: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_STORAGE_READ)
    await _storage_company(company_id)
    summary = await storage_manager.account_storage_summary(company_id)
    lic = await saas.effective(company_id)
    company = await saas._db.companies.find_one({"_id": company_id}) or {}
    summary["company_name"] = company.get("name")
    summary["storage_limit_mb"] = lic.get("storage_limit_mb") or 0
    summary["plan_name"] = lic.get("plan_name")
    return _redact(summary)


@router.get("/platform/admin-v1/companies/{company_id}/storage/folders/{area_key}/files")
async def admin_v1_storage_files(company_id: str, area_key: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_STORAGE_READ)
    await _storage_company(company_id)
    return _redact({"files": await storage_manager.list_folder_files(company_id, area_key)})


@router.post("/platform/admin-v1/companies/{company_id}/storage/ensure")
async def admin_v1_storage_ensure(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        await _storage_company(company_id)
        return ["ensure"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        folders = await storage_manager.ensure_account_folders(
            company_id, created_by=str(key_doc.get("_id") or ""),
        )
        return _item({
            "status": "ok",
            "folder_count": len(folders),
            "folders": [
                {"id": f["_id"], "area_key": f.get("area_key"), "label": f.get("label"), "path": f.get("path")}
                for f in folders
            ],
        })

    return await _write(
        request,
        store.SCOPE_ADMIN_STORAGE_WRITE,
        "company",
        company_id,
        apply,
        op="storage.ensure",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/companies/{company_id}/storage/folders")
async def admin_v1_storage_folder(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("label",))
        label = payload.get("label")
        if not isinstance(label, str) or len(label.strip()) < 2:
            raise HTTPException(status_code=400, detail="Klasör adı en az 2 karakter olmalı.")
        await _storage_company(company_id)
        return ["label"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        doc = await storage_manager.create_custom_folder(
            company_id, payload["label"], created_by=str(key_doc.get("_id") or ""),
        )
        return _item({"id": doc["_id"], "area_key": doc["area_key"], "label": doc["label"], "path": doc["path"]})

    return await _write(
        request,
        store.SCOPE_ADMIN_STORAGE_WRITE,
        "company",
        company_id,
        apply,
        op="storage.folder",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/storage/ensure-all")
async def admin_v1_storage_ensure_all(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        return ["ensure_all"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        companies = await saas._db.companies.find({}, {"_id": 1}).to_list(5000)
        actor = str(key_doc.get("_id") or "")
        for company in companies:
            await storage_manager.ensure_account_folders(company["_id"], created_by=actor)
        return _item({"status": "ok", "companies": len(companies)})

    return await _write(
        request,
        store.SCOPE_ADMIN_STORAGE_WRITE,
        "platform",
        "storage",
        apply,
        op="storage.ensure_all",
        prepare=prepare,
    )


_USER_CREATE = ("name", "email", "password", "is_active")
_USER_UPDATE = ("name", "email", "phone", "is_active", "password")


@router.post("/platform/admin-v1/platform-users")
async def admin_v1_create_platform_user(request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _USER_CREATE)
        if body_has_secret(payload):
            await require_secret_scope(request)
        for field in ("name", "email", "password"):
            if not isinstance(payload.get(field), str) or not str(payload.get(field)).strip():
                raise HTTPException(status_code=400, detail=f"{field} zorunlu.")
        if "is_active" in payload:
            _require_bool(payload, "is_active")
        return audit_field_names(_present(payload, _USER_CREATE))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await saas.system_create_user(payload, {})
        return _item(row), audit_field_names(_present(payload, _USER_CREATE))

    return await _write(
        request,
        store.SCOPE_ADMIN_USERS_WRITE,
        "user",
        "platform",
        apply,
        op="platform_user.create",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/platform-users/{user_id}")
async def admin_v1_update_platform_user(user_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _USER_UPDATE)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if body_has_secret(payload):
            await require_secret_scope(request)
        if "is_active" in payload:
            _require_bool(payload, "is_active")
        for field in ("name", "email", "phone", "password"):
            if field in payload and not isinstance(payload[field], str):
                raise HTTPException(status_code=400, detail=f"{field} metin olmalı.")
        user = await saas._db.users.find_one({"_id": user_id})
        if not user or not user.get("is_super_admin"):
            raise HTTPException(status_code=404, detail="Panel yöneticisi bulunamadı.")
        return audit_field_names(_present(payload, _USER_UPDATE))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        row = await saas.system_update_user(user_id, payload, {})
        return _item(row), audit_field_names(_present(payload, _USER_UPDATE))

    return await _write(
        request,
        store.SCOPE_ADMIN_USERS_WRITE,
        "user",
        user_id,
        apply,
        op="platform_user.update",
        prepare=prepare,
    )


_KEY_CREATE = ("product_id", "name", "scopes", "instance_id", "kind", "expires_at", "ip_allowlist")


@router.post("/platform/admin-v1/api-keys")
async def admin_v1_create_api_key(request: Request):
    """Şirket anahtarı (kind=product) ve platform anahtarı. credential yalnız bu yanıtta bir kez döner."""

    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, _KEY_CREATE)
        kind = payload.get("kind") or store.KEY_KIND_PRODUCT
        if kind not in (store.KEY_KIND_PRODUCT, store.KEY_KIND_PLATFORM_ADMIN):
            raise HTTPException(status_code=400, detail="kind product veya platform_admin olmalı.")
        if not isinstance(payload.get("name"), str) or not payload["name"].strip():
            raise HTTPException(status_code=400, detail="name zorunlu.")
        if not isinstance(payload.get("product_id"), str) or not payload["product_id"].strip():
            raise HTTPException(status_code=400, detail="product_id zorunlu.")
        if "scopes" in payload:
            scopes = payload["scopes"]
            if not isinstance(scopes, list) or not scopes or not all(isinstance(s, str) and s.strip() for s in scopes):
                raise HTTPException(status_code=400, detail="scopes metin listesi olmalı.")
        if kind == store.KEY_KIND_PRODUCT:
            instance_id = payload.get("instance_id")
            if not isinstance(instance_id, str) or not instance_id.strip():
                raise HTTPException(status_code=400, detail="Şirket anahtarı instance_id ister.")
            if not await saas._db.companies.find_one({"_id": instance_id.strip()}):
                raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
        elif payload.get("instance_id"):
            raise HTTPException(status_code=400, detail="platform_admin anahtarı bir instance'a bağlanamaz")
        if "expires_at" in payload and payload["expires_at"] is not None and not isinstance(payload["expires_at"], str):
            raise HTTPException(status_code=400, detail="expires_at metin ya da null olmalı.")
        if "ip_allowlist" in payload and not isinstance(payload["ip_allowlist"], list):
            raise HTTPException(status_code=400, detail="ip_allowlist liste olmalı.")
        return audit_field_names(_present(payload, _KEY_CREATE))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        kind = payload.get("kind") or store.KEY_KIND_PRODUCT
        try:
            pub, secret = await store.create_api_key(
                product_id=payload["product_id"].strip(),
                name=payload["name"].strip(),
                scopes=payload.get("scopes"),
                instance_id=(payload.get("instance_id") or "").strip() or None,
                expires_at=payload.get("expires_at"),
                ip_allowlist=payload.get("ip_allowlist"),
                actor_id=str(key_doc.get("_id") or ""),
                ip=request_ip(request),
                kind=kind,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        return {"item": pub, "credential": secret}, audit_field_names(_present(payload, _KEY_CREATE))

    return await _write(
        request,
        store.SCOPE_ADMIN_KEYS_WRITE,
        "api_key",
        "new",
        apply,
        op="api_key.create",
        prepare=prepare,
    )


@router.put("/platform/admin-v1/api-keys/{key_id}/scopes")
async def admin_v1_api_key_scopes(key_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ("scopes",))
        scopes = payload.get("scopes")
        if not isinstance(scopes, list) or not scopes or not all(isinstance(s, str) and s.strip() for s in scopes):
            raise HTTPException(status_code=400, detail="scopes metin listesi olmalı.")
        if not await store._db.platform_api_keys.find_one({"_id": key_id}):
            raise HTTPException(status_code=404, detail="Anahtar bulunamadı")
        return ["scopes"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        try:
            pub = await store.update_api_key_scopes(
                key_id,
                payload["scopes"],
                actor_id=str(key_doc.get("_id") or ""),
                ip=request_ip(request),
            )
        except LookupError:
            raise HTTPException(status_code=404, detail="Anahtar bulunamadı") from None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        return _item(pub)

    return await _write(
        request,
        store.SCOPE_ADMIN_KEYS_WRITE,
        "api_key",
        key_id,
        apply,
        op="api_key.scopes",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/api-keys/{key_id}/rotate")
async def admin_v1_rotate_api_key(key_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]) -> List[str]:
        _reject_unknown(payload, ())
        if not await store._db.platform_api_keys.find_one({"_id": key_id}):
            raise HTTPException(status_code=404, detail="Anahtar bulunamadı")
        return ["rotate"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        try:
            pub, secret = await store.rotate_api_key(
                key_id,
                actor_id=str(key_doc.get("_id") or ""),
                ip=request_ip(request),
            )
        except LookupError:
            raise HTTPException(status_code=404, detail="Anahtar bulunamadı") from None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        return {"item": pub, "credential": secret}, ["rotate"]

    return await _write(
        request,
        store.SCOPE_ADMIN_KEYS_WRITE,
        "api_key",
        key_id,
        apply,
        op="api_key.rotate",
        prepare=prepare,
    )
