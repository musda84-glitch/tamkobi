"""Platform Yönetimi: products, instances (adapter), API keys, audit, nonces."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import comm_service

_db = None

PRODUCT_TAMKOBI = "tamkobi"
DEFAULT_SCOPES = ("license:verify", "heartbeat", "usage:write")
KEY_RATE_LIMIT = 120  # per minute
NONCE_TTL_SEC = 600
LAST_USED_MIN_INTERVAL = 60
ROTATION_GRACE_HOURS = 24


def init(db) -> None:
    global _db
    _db = db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _sha256_hex(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


async def ensure_seeded() -> None:
    """Idempotent: platform_products.tamkobi + indexes via docs pattern."""
    if _db is None:
        return
    existing = await _db.platform_products.find_one({"code": PRODUCT_TAMKOBI})
    if existing:
        return
    await _db.platform_products.insert_one({
        "_id": f"pp_{uuid.uuid4().hex[:12]}",
        "code": PRODUCT_TAMKOBI,
        "name": "TamKobi ERP",
        "kind": "erp",
        "status": "active",
        "base_url": "https://tamkobi.com",
        "created_at": _now_iso(),
    })


# ---------- Products ----------
async def list_products() -> List[dict]:
    await ensure_seeded()
    rows = await _db.platform_products.find({}).to_list(500)
    return [_public_product(r) for r in rows]


def _public_product(doc: dict) -> dict:
    out = {**doc, "id": str(doc.get("_id"))}
    return out


async def get_product(product_id: str) -> Optional[dict]:
    await ensure_seeded()
    doc = await _db.platform_products.find_one({"_id": product_id})
    if not doc:
        doc = await _db.platform_products.find_one({"code": product_id})
    return doc


async def create_product(data: dict, *, actor_id: str, ip: str = "") -> dict:
    await ensure_seeded()
    code = (data.get("code") or "").strip().lower()
    if not code:
        raise ValueError("code gerekli")
    if await _db.platform_products.find_one({"code": code}):
        raise ValueError("Bu ürün kodu zaten var")
    kind = (data.get("kind") or "other").strip().lower()
    if kind not in ("erp", "ecommerce", "other"):
        kind = "other"
    doc = {
        "_id": f"pp_{uuid.uuid4().hex[:12]}",
        "code": code,
        "name": (data.get("name") or code).strip(),
        "kind": kind,
        "status": (data.get("status") or "active").strip() or "active",
        "base_url": (data.get("base_url") or "").strip(),
        "created_at": _now_iso(),
    }
    await _db.platform_products.insert_one(doc)
    await write_audit(
        actor_type="superadmin", actor_id=actor_id, ip=ip,
        action="product.create", target_type="product", target_id=doc["_id"],
        details={"code": code},
    )
    return _public_product(doc)


async def update_product(product_id: str, data: dict, *, actor_id: str, ip: str = "") -> dict:
    doc = await get_product(product_id)
    if not doc:
        raise LookupError("Ürün bulunamadı")
    changes = {}
    for k in ("name", "kind", "status", "base_url"):
        if k in data and data[k] is not None:
            changes[k] = data[k]
    if "code" in data and data["code"] and data["code"] != doc.get("code"):
        if doc.get("code") == PRODUCT_TAMKOBI:
            raise ValueError("tamkobi ürün kodu değiştirilemez")
        new_code = str(data["code"]).strip().lower()
        if await _db.platform_products.find_one({"code": new_code}):
            raise ValueError("Bu ürün kodu zaten var")
        changes["code"] = new_code
    if changes:
        await _db.platform_products.update_one({"_id": doc["_id"]}, {"$set": changes})
        await write_audit(
            actor_type="superadmin", actor_id=actor_id, ip=ip,
            action="product.update", target_type="product", target_id=doc["_id"],
            details={"fields": list(changes.keys())},
        )
    return _public_product({**doc, **changes})


async def delete_product(product_id: str, *, actor_id: str, ip: str = "") -> None:
    doc = await get_product(product_id)
    if not doc:
        raise LookupError("Ürün bulunamadı")
    if doc.get("code") == PRODUCT_TAMKOBI:
        raise ValueError("tamkobi ürünü silinemez")
    await _db.platform_products.delete_one({"_id": doc["_id"]})
    await write_audit(
        actor_type="superadmin", actor_id=actor_id, ip=ip,
        action="product.delete", target_type="product", target_id=doc["_id"],
        details={"code": doc.get("code")},
    )


# ---------- Instances (TamKobi = virtual from saas) ----------
async def list_instances(*, product_id: Optional[str] = None, limit: int = 200) -> List[dict]:
    """List stored instances + virtual TamKobi company rows (not copied)."""
    await ensure_seeded()
    q: Dict[str, Any] = {}
    if product_id:
        q["product_id"] = product_id
    stored = await _db.platform_instances.find(q).to_list(limit)
    out = [_public_instance(r) for r in stored]

    prod = await _db.platform_products.find_one({"code": PRODUCT_TAMKOBI})
    if prod and (not product_id or product_id in (prod["_id"], PRODUCT_TAMKOBI)):
        import saas
        companies = await _db.companies.find({}).to_list(limit)
        for c in companies:
            try:
                eff = await saas.effective(c["_id"])
            except Exception:
                eff = {}
            out.append({
                "id": f"virt_{c['_id']}",
                "product_id": prod["_id"],
                "product_code": PRODUCT_TAMKOBI,
                "external_ref": c["_id"],
                "name": c.get("name") or c["_id"],
                "company_id": c["_id"],
                "plan_code": eff.get("plan_id") or "",
                "status": eff.get("status") or "unknown",
                "valid_until": eff.get("expires_at") or eff.get("trial_ends_at"),
                "seats": eff.get("user_limit"),
                "modules": eff.get("modules") or {},
                "last_heartbeat_at": None,
                "meta": {"virtual": True},
                "virtual": True,
            })
    return out[:limit]


def _public_instance(doc: dict) -> dict:
    out = {**doc, "id": str(doc.get("_id")), "virtual": False}
    return out


async def upsert_instance(data: dict, *, actor_id: str, ip: str = "") -> dict:
    await ensure_seeded()
    pid = data.get("product_id")
    prod = await get_product(pid) if pid else None
    if not prod:
        raise ValueError("product_id gerekli")
    if prod.get("code") == PRODUCT_TAMKOBI and data.get("company_id"):
        # Do not copy TamKobi companies — return virtual view
        import saas
        cid = data["company_id"]
        c = await _db.companies.find_one({"_id": cid}) or {}
        eff = await saas.effective(cid)
        await write_audit(
            actor_type="superadmin", actor_id=actor_id, ip=ip,
            action="instance.view_virtual", target_type="instance", target_id=cid,
            details={},
        )
        return {
            "id": f"virt_{cid}",
            "product_id": prod["_id"],
            "external_ref": cid,
            "name": c.get("name") or cid,
            "company_id": cid,
            "plan_code": eff.get("plan_id") or "",
            "status": eff.get("status"),
            "valid_until": eff.get("expires_at") or eff.get("trial_ends_at"),
            "seats": eff.get("user_limit"),
            "modules": eff.get("modules") or {},
            "virtual": True,
        }
    iid = data.get("_id") or data.get("id") or f"pi_{uuid.uuid4().hex[:12]}"
    doc = {
        "_id": iid,
        "product_id": prod["_id"],
        "external_ref": (data.get("external_ref") or "").strip(),
        "name": (data.get("name") or "").strip() or iid,
        "company_id": data.get("company_id"),
        "plan_code": data.get("plan_code") or "",
        "status": data.get("status") or "active",
        "valid_until": data.get("valid_until"),
        "seats": data.get("seats"),
        "modules": data.get("modules") or {},
        "last_heartbeat_at": data.get("last_heartbeat_at"),
        "meta": data.get("meta") or {},
    }
    await _db.platform_instances.update_one({"_id": iid}, {"$set": doc}, upsert=True)
    await write_audit(
        actor_type="superadmin", actor_id=actor_id, ip=ip,
        action="instance.upsert", target_type="instance", target_id=iid,
        details={"product_id": prod["_id"]},
    )
    return _public_instance(doc)


# ---------- API keys ----------
def _new_secret() -> str:
    return secrets.token_urlsafe(32)


def _key_id() -> str:
    return "pk_" + secrets.token_hex(8)


async def create_api_key(
    *,
    product_id: str,
    name: str,
    scopes: Optional[List[str]] = None,
    instance_id: Optional[str] = None,
    expires_at: Optional[str] = None,
    actor_id: str,
    ip: str = "",
) -> Tuple[dict, str]:
    """Returns (public_row_without_secret, plaintext_secret once)."""
    await ensure_seeded()
    prod = await get_product(product_id)
    if not prod:
        raise ValueError("Ürün bulunamadı")
    secret = _new_secret()
    kid = _key_id()
    sc = list(scopes or DEFAULT_SCOPES)
    doc = {
        "_id": kid,
        "product_id": prod["_id"],
        "instance_id": instance_id,
        "name": (name or kid).strip(),
        "scopes": sc,
        "secret_enc": comm_service.encrypt(secret),
        "secret_hash": _sha256_hex(secret),
        "created_by": actor_id,
        "created_at": _now_iso(),
        "last_used_at": None,
        "last_used_ip": None,
        "revoked_at": None,
        "expires_at": expires_at,
        "rotated_from": None,
        "grace_until": None,
    }
    await _db.platform_api_keys.insert_one(doc)
    await write_audit(
        actor_type="superadmin", actor_id=actor_id, ip=ip,
        action="api_key.create", target_type="api_key", target_id=kid,
        details={"product_id": prod["_id"], "name": doc["name"], "scopes": sc},
    )
    return _public_key(doc), secret


def _public_key(doc: dict) -> dict:
    """Never include secret / secret_enc / secret_hash in API responses."""
    return {
        "id": doc["_id"],
        "product_id": doc.get("product_id"),
        "instance_id": doc.get("instance_id"),
        "name": doc.get("name"),
        "scopes": doc.get("scopes") or [],
        "created_by": doc.get("created_by"),
        "created_at": doc.get("created_at"),
        "last_used_at": doc.get("last_used_at"),
        "last_used_ip": doc.get("last_used_ip"),
        "revoked_at": doc.get("revoked_at"),
        "expires_at": doc.get("expires_at"),
        "rotated_from": doc.get("rotated_from"),
        "grace_until": doc.get("grace_until"),
    }


async def list_api_keys(*, product_id: Optional[str] = None) -> List[dict]:
    q: Dict[str, Any] = {}
    if product_id:
        q["product_id"] = product_id
    rows = await _db.platform_api_keys.find(q).to_list(500)
    return [_public_key(r) for r in rows]


async def rotate_api_key(key_id: str, *, actor_id: str, ip: str = "") -> Tuple[dict, str]:
    old = await _db.platform_api_keys.find_one({"_id": key_id})
    if not old:
        raise LookupError("Anahtar bulunamadı")
    if old.get("revoked_at"):
        raise ValueError("İptal edilmiş anahtar döndürülemez")
    new_pub, secret = await create_api_key(
        product_id=old["product_id"],
        name=old.get("name") or key_id,
        scopes=old.get("scopes"),
        instance_id=old.get("instance_id"),
        expires_at=old.get("expires_at"),
        actor_id=actor_id,
        ip=ip,
    )
    grace = (_now() + timedelta(hours=ROTATION_GRACE_HOURS)).isoformat()
    await _db.platform_api_keys.update_one(
        {"_id": key_id},
        {"$set": {"grace_until": grace}},
    )
    await _db.platform_api_keys.update_one(
        {"_id": new_pub["id"]},
        {"$set": {"rotated_from": key_id}},
    )
    await write_audit(
        actor_type="superadmin", actor_id=actor_id, ip=ip,
        action="api_key.rotate", target_type="api_key", target_id=new_pub["id"],
        details={"from": key_id, "grace_until": grace},
    )
    new_pub["rotated_from"] = key_id
    return new_pub, secret


async def revoke_api_key(key_id: str, *, actor_id: str, ip: str = "") -> dict:
    old = await _db.platform_api_keys.find_one({"_id": key_id})
    if not old:
        raise LookupError("Anahtar bulunamadı")
    ts = _now_iso()
    await _db.platform_api_keys.update_one(
        {"_id": key_id},
        {"$set": {"revoked_at": ts, "grace_until": None}},
    )
    await write_audit(
        actor_type="superadmin", actor_id=actor_id, ip=ip,
        action="api_key.revoke", target_type="api_key", target_id=key_id,
        details={},
    )
    return _public_key({**old, "revoked_at": ts, "grace_until": None})


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    raw = str(value).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def resolve_key_for_auth(key_id: str) -> Tuple[Optional[dict], Optional[str]]:
    """Return (key_doc, plaintext_secret) if usable; else (None, None)."""
    doc = await _db.platform_api_keys.find_one({"_id": key_id})
    if not doc:
        return None, None
    if doc.get("revoked_at"):
        return None, None
    exp = _parse_iso(doc.get("expires_at"))
    if exp and exp < _now():
        return None, None
    # grace_until set on OLD key after rotation — usable until grace ends, then 401
    grace = _parse_iso(doc.get("grace_until"))
    if grace is not None and grace < _now():
        return None, None
    try:
        secret = comm_service.decrypt(doc.get("secret_enc") or "")
    except Exception:
        return None, None
    if not secret:
        return None, None
    return doc, secret


async def touch_last_used(key_id: str, ip: str = "") -> None:
    doc = await _db.platform_api_keys.find_one({"_id": key_id}, {"last_used_at": 1})
    if not doc:
        return
    last = _parse_iso(doc.get("last_used_at"))
    if last and (_now() - last).total_seconds() < LAST_USED_MIN_INTERVAL:
        return
    await _db.platform_api_keys.update_one(
        {"_id": key_id},
        {"$set": {"last_used_at": _now_iso(), "last_used_ip": ip or None}},
    )


# ---------- Nonces + rate limit ----------
async def check_and_store_nonce(key_id: str, nonce: str) -> bool:
    """Return True if nonce is new; False if replay."""
    nid = f"{key_id}:{nonce}"
    existing = await _db.platform_nonces.find_one({"_id": nid})
    if existing:
        return False
    await _db.platform_nonces.insert_one({
        "_id": nid,
        "key_id": key_id,
        "nonce": nonce,
        "created_at": _now_iso(),
        "expires_at": (_now() + timedelta(seconds=NONCE_TTL_SEC)).isoformat(),
    })
    return True


async def check_rate_limit(key_id: str) -> bool:
    """Return True if under limit; False if exceeded (caller → 429)."""
    bucket = f"rl:{key_id}:{int(time.time() // 60)}"
    doc = await _db.platform_rate.find_one({"_id": bucket})
    count = int((doc or {}).get("count") or 0)
    if count >= KEY_RATE_LIMIT:
        return False
    await _db.platform_rate.update_one(
        {"_id": bucket},
        {"$inc": {"count": 1}, "$set": {"key_id": key_id, "updated_at": _now_iso()}},
        upsert=True,
    )
    return True


def sign_payload(secret: str, ts: str, nonce: str, method: str, path: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body or b"").hexdigest()
    msg = f"{ts}\n{nonce}\n{(method or 'GET').upper()}\n{path}\n{body_hash}"
    return hmac.new(secret.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_signature(secret: str, ts: str, nonce: str, method: str, path: str, body: bytes, signature: str) -> bool:
    expected = sign_payload(secret, ts, nonce, method, path, body)
    return hmac.compare_digest(expected, (signature or "").strip().lower()) or hmac.compare_digest(
        expected, (signature or "").strip()
    )


# ---------- Audit ----------
async def write_audit(
    *,
    actor_type: str,
    actor_id: str,
    action: str,
    target_type: str = "",
    target_id: str = "",
    details: Optional[dict] = None,
    ip: str = "",
) -> None:
    if _db is None:
        return
    safe = dict(details or {})
    for bad in ("secret", "secret_enc", "password", "token", "api_key"):
        safe.pop(bad, None)
    # Strip any nested secret-like values
    for k in list(safe.keys()):
        if "secret" in k.lower() or k.endswith("_enc"):
            safe.pop(k, None)
    await _db.platform_audit_log.insert_one({
        "_id": f"pal_{uuid.uuid4().hex[:16]}",
        "at": _now_iso(),
        "actor_type": actor_type,
        "actor_id": actor_id or "",
        "ip": ip or "",
        "action": action,
        "target_type": target_type or "",
        "target_id": target_id or "",
        "details": safe,
    })


async def list_audit(
    *,
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    target_type: Optional[str] = None,
    limit: int = 100,
) -> List[dict]:
    q: Dict[str, Any] = {}
    if action:
        q["action"] = action
    if actor_id:
        q["actor_id"] = actor_id
    if target_type:
        q["target_type"] = target_type
    rows = await _db.platform_audit_log.find(q).sort("at", -1).to_list(min(limit, 500))
    return [{**r, "id": r["_id"]} for r in rows]


# ---------- License verify / heartbeat / usage ----------
async def verify_license(*, instance_ref: Optional[str] = None, company_id: Optional[str] = None) -> dict:
    import saas
    cid = company_id or instance_ref
    if not cid:
        return {"valid": False, "plan": None, "status": "unknown", "valid_until": None, "modules": {}, "seats": None}
    # Stored instance?
    inst = await _db.platform_instances.find_one({"$or": [{"_id": cid}, {"external_ref": cid}, {"company_id": cid}]})
    if inst and inst.get("company_id"):
        cid = inst["company_id"]
    elif inst and not inst.get("company_id"):
        return {
            "valid": (inst.get("status") or "") in ("active", "trial"),
            "plan": inst.get("plan_code"),
            "status": inst.get("status"),
            "valid_until": inst.get("valid_until"),
            "modules": inst.get("modules") or {},
            "seats": inst.get("seats"),
        }
    # Strip virt_ prefix
    if str(cid).startswith("virt_"):
        cid = cid[5:]
    try:
        eff = await saas.effective(cid)
    except Exception:
        return {"valid": False, "plan": None, "status": "error", "valid_until": None, "modules": {}, "seats": None}
    status = eff.get("status") or "unknown"
    valid = status in ("active", "trial") and not eff.get("locked")
    return {
        "valid": valid,
        "plan": eff.get("plan_name") or eff.get("plan_id"),
        "status": status,
        "valid_until": eff.get("expires_at") or eff.get("trial_ends_at"),
        "modules": eff.get("modules") or {},
        "seats": eff.get("user_limit"),
    }


async def record_heartbeat(*, instance_ref: str, version: str = "", meta: Optional[dict] = None) -> dict:
    now = _now_iso()
    q = {"$or": [{"_id": instance_ref}, {"external_ref": instance_ref}, {"company_id": instance_ref}]}
    inst = await _db.platform_instances.find_one(q)
    if inst:
        await _db.platform_instances.update_one(
            {"_id": inst["_id"]},
            {"$set": {"last_heartbeat_at": now, "meta": {**(inst.get("meta") or {}), **(meta or {}), "version": version}}},
        )
    else:
        # Virtual TamKobi: store heartbeat meta only
        await _db.platform_heartbeats.update_one(
            {"_id": instance_ref},
            {"$set": {"last_heartbeat_at": now, "version": version, "meta": meta or {}, "updated_at": now}},
            upsert=True,
        )
    return {"ok": True, "at": now}


async def record_usage(*, instance_ref: str, metrics: dict, period: str = "") -> dict:
    doc = {
        "_id": f"pu_{uuid.uuid4().hex[:16]}",
        "instance_ref": instance_ref,
        "metrics": metrics or {},
        "period": period or "",
        "created_at": _now_iso(),
    }
    await _db.platform_usage.insert_one(doc)
    return {"ok": True, "id": doc["_id"]}
