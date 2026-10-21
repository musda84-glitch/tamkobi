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
_SCOPE_OUTSIDE = "İstenen kapsam çağıran anahtarın kapsamının dışında."
_DANGER_CREATE_DETAIL = "platform_admin anahtarı danger/key.admin_create ile oluşturulur."
_DANGER_SCOPES_DETAIL = "platform_admin anahtarının kapsamı danger/key.admin_scopes ile değişir."
_DANGER_USER_CREATE = "Panel yöneticisi danger/platform_user.create ile oluşturulur."
_DANGER_USER_PASSWORD = "Şifre danger/platform_user.password ile değişir."
_DANGER_USER_EMAIL = "E-posta danger/platform_user.email ile değişir."
_DANGER_PRODUCT_CREATE = "Yazma kapsamı danger/key.product_create ile verilir."
_DANGER_PRODUCT_SCOPES = "Yazma kapsamı danger/key.product_scopes ile verilir."
_PRODUCT_READ_SCOPES = frozenset(item for item in store.DEFAULT_SCOPES if not str(item).endswith(":write"))
_PRODUCT_WRITE_SCOPES = frozenset(item for item in store.DEFAULT_SCOPES if str(item).endswith(":write"))


def _reject_blank_password(payload: Dict[str, Any]) -> None:
    """Boş veya yalnızca boşluk şifre yazılmaz. Sır kapsamı bu kontrolden önce aranır."""
    if "password" not in payload:
        return
    password = payload.get("password")
    if isinstance(password, str) and not password.strip():
        raise HTTPException(status_code=400, detail="Şifre boş olamaz.")


def scope_set(scopes: Any) -> set:
    if isinstance(scopes, str) or not isinstance(scopes, (list, tuple, set, frozenset)):
        return set()
    return {str(item).strip() for item in scopes if str(item).strip()}


def assert_scope_subset(requested: Any, caller_scopes: Any) -> None:
    if scope_set(requested) - scope_set(caller_scopes):
        raise HTTPException(status_code=403, detail=_SCOPE_OUTSIDE)


def assert_caller_has_keys_write(doc: dict) -> None:
    if store.SCOPE_ADMIN_KEYS_WRITE not in scope_set((doc or {}).get("scopes")):
        raise HTTPException(status_code=403, detail="Kapsam yetersiz")


def assert_product_scopes(requested: Any, caller_scopes: Any, *, danger: bool, danger_detail: str) -> None:
    """Ürün anahtarı çağıranın tutmadığı kapsamı alamaz. Yazma kapsamı danger ister.

    license:verify ve heartbeat, keys:write ile verilebilir. usage:write yalnız
    danger akışında ve bilinen ürün yazma kapsamı olarak verilir.
    """
    requested_set = scope_set(requested)
    writes = {item for item in requested_set if item.endswith(":write")}
    if writes and not danger:
        raise HTTPException(status_code=403, detail=danger_detail)
    exempt = set(_PRODUCT_READ_SCOPES)
    if danger:
        exempt.update(item for item in writes if item in _PRODUCT_WRITE_SCOPES)
    assert_scope_subset(requested_set - exempt, caller_scopes)


async def caller_key_doc(key_doc: dict) -> dict:
    """_auth belgesi. Başlıktan ikinci bir okuma yapılmaz."""
    if not isinstance(key_doc, dict) or not str(key_doc.get("_id") or "").strip() or key_doc.get("revoked_at"):
        raise HTTPException(status_code=403, detail="Kapsam yetersiz")
    return key_doc


def _requested_scopes(payload: Dict[str, Any]) -> List[str]:
    if "scopes" not in payload or payload.get("scopes") is None:
        return list(store.DEFAULT_SCOPES)
    return [str(item).strip() for item in payload["scopes"]]


@router.post("/platform/admin-v1/platform-users")
async def admin_v1_create_platform_user(request: Request):
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _USER_CREATE)
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        _reject_blank_password(payload)
        for field in ("name", "email", "password"):
            if not isinstance(payload.get(field), str) or not str(payload.get(field)).strip():
                raise HTTPException(status_code=400, detail=f"{field} zorunlu.")
        if "is_active" in payload:
            _require_bool(payload, "is_active")
        raise HTTPException(status_code=403, detail=_DANGER_USER_CREATE)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        raise HTTPException(status_code=403, detail=_DANGER_USER_CREATE)

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
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _USER_UPDATE)
        if not payload:
            raise HTTPException(status_code=400, detail="Gövde boş olamaz.")
        if body_has_secret(payload):
            await require_secret_scope(key_doc)
        _reject_blank_password(payload)
        if "is_active" in payload:
            _require_bool(payload, "is_active")
        for field in ("name", "email", "phone", "password"):
            if field in payload and not isinstance(payload[field], str):
                raise HTTPException(status_code=400, detail=f"{field} metin olmalı.")
        user = await saas._db.users.find_one({"_id": user_id})
        if not user or not user.get("is_super_admin"):
            raise HTTPException(status_code=404, detail="Panel yöneticisi bulunamadı.")
        if "password" in payload:
            raise HTTPException(status_code=403, detail=_DANGER_USER_PASSWORD)
        if "email" in payload:
            raise HTTPException(status_code=403, detail=_DANGER_USER_EMAIL)
        return audit_field_names(_present(payload, _USER_UPDATE))

    async def apply(payload: Dict[str, Any], key_doc: dict):
        if "password" in payload:
            raise HTTPException(status_code=403, detail=_DANGER_USER_PASSWORD)
        if "email" in payload:
            raise HTTPException(status_code=403, detail=_DANGER_USER_EMAIL)
        safe = {key: value for key, value in payload.items() if key not in ("password", "email")}
        row = await saas.system_update_user(user_id, safe, {})
        return _item(row), audit_field_names(_present(safe, _USER_UPDATE))

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
    """Şirket anahtarı (kind=product). credential yalnız bu yanıtta bir kez döner.

    platform_admin anahtarı burada oluşmaz; danger/key.admin_create ister.
    """

    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, _KEY_CREATE)
        kind = payload.get("kind") or store.KEY_KIND_PRODUCT
        if kind not in (store.KEY_KIND_PRODUCT, store.KEY_KIND_PLATFORM_ADMIN):
            raise HTTPException(status_code=400, detail="kind product veya platform_admin olmalı.")
        if kind == store.KEY_KIND_PLATFORM_ADMIN:
            raise HTTPException(status_code=400, detail=_DANGER_CREATE_DETAIL)
        if not isinstance(payload.get("name"), str) or not payload["name"].strip():
            raise HTTPException(status_code=400, detail="name zorunlu.")
        if not isinstance(payload.get("product_id"), str) or not payload["product_id"].strip():
            raise HTTPException(status_code=400, detail="product_id zorunlu.")
        if "scopes" in payload:
            scopes = payload["scopes"]
            if not isinstance(scopes, list) or not scopes or not all(isinstance(s, str) and s.strip() for s in scopes):
                raise HTTPException(status_code=400, detail="scopes metin listesi olmalı.")
        caller = await caller_key_doc(key_doc)
        assert_product_scopes(
            _requested_scopes(payload),
            caller.get("scopes") or [],
            danger=False,
            danger_detail=_DANGER_PRODUCT_CREATE,
        )
        if kind == store.KEY_KIND_PRODUCT:
            instance_id = payload.get("instance_id")
            if not isinstance(instance_id, str) or not instance_id.strip():
                raise HTTPException(status_code=400, detail="Şirket anahtarı instance_id ister.")
            if not await saas._db.companies.find_one({"_id": instance_id.strip()}):
                raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
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
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, ("scopes",))
        scopes = payload.get("scopes")
        if not isinstance(scopes, list) or not scopes or not all(isinstance(s, str) and s.strip() for s in scopes):
            raise HTTPException(status_code=400, detail="scopes metin listesi olmalı.")
        existing = await store._db.platform_api_keys.find_one({"_id": key_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Anahtar bulunamadı")
        if (existing.get("kind") or store.KEY_KIND_PRODUCT) == store.KEY_KIND_PLATFORM_ADMIN:
            raise HTTPException(status_code=400, detail=_DANGER_SCOPES_DETAIL)
        caller = await caller_key_doc(key_doc)
        assert_product_scopes(
            [str(item).strip() for item in scopes],
            caller.get("scopes") or [],
            danger=False,
            danger_detail=_DANGER_PRODUCT_SCOPES,
        )
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
    async def prepare(payload: Dict[str, Any], key_doc: dict) -> List[str]:
        _reject_unknown(payload, ())
        existing = await store._db.platform_api_keys.find_one({"_id": key_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Anahtar bulunamadı")
        if (existing.get("kind") or store.KEY_KIND_PRODUCT) == store.KEY_KIND_PLATFORM_ADMIN:
            caller = await caller_key_doc(key_doc)
            assert_scope_subset(existing.get("scopes") or [], caller.get("scopes") or [])
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
