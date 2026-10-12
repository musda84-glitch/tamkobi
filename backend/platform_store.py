"""Platform Yönetimi: products, instances (adapter), API keys, audit, nonces."""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import comm_service
from mysql_store import DuplicateKeyError

_db = None
logger = logging.getLogger("tamkobi.platform")

PRODUCT_TAMKOBI = "tamkobi"
DEFAULT_SCOPES = ("license:verify", "heartbeat", "usage:write")
SCOPE_PLATFORM_ALL = "platform:all"
KEY_RATE_LIMIT = 120  # per key per minute
IP_RATE_LIMIT = 300  # per IP per minute (before signature)
NONCE_TTL_SEC = 600
RATE_TTL_SEC = 600
LAST_USED_MIN_INTERVAL = 60
ROTATION_GRACE_HOURS = 24
CLEANUP_INTERVAL_SEC = 300
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_SENSITIVE_KEY = re.compile(r"(secret|password|token|api_key|authorization|cookie)", re.I)


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


async def _get_product_doc(product_id: str) -> Optional[dict]:
    """Internal product lookup (not the Depends route get_product)."""
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
    doc = await _get_product_doc(product_id)
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
    doc = await _get_product_doc(product_id)
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
    prod = await _get_product_doc(pid) if pid else None
    if not prod:
        raise ValueError("product_id gerekli")
    if prod.get("code") == PRODUCT_TAMKOBI and data.get("company_id"):
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


def _normalize_scopes(scopes: Optional[List[str]]) -> List[str]:
    if scopes is None:
        return list(DEFAULT_SCOPES)
    sc = [str(s).strip() for s in scopes if str(s).strip()]
    if not sc:
        raise ValueError("En az bir kapsam gerekli")
    return sc


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
    prod = await _get_product_doc(product_id)
    if not prod:
        raise ValueError("Ürün bulunamadı")
    sc = _normalize_scopes(scopes)
    secret = _new_secret()
    kid = _key_id()
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


# ---------- Target resolution + key scope ----------
async def resolve_target(
    *,
    instance_ref: Optional[str] = None,
    company_id: Optional[str] = None,
) -> Optional[dict]:
    """Resolve instance_ref/company_id to {id, product_id, company_id, external_ref}."""
    await ensure_seeded()
    ref = (company_id or instance_ref or "").strip()
    if not ref:
        return None
    raw = ref[5:] if ref.startswith("virt_") else ref

    inst = await _db.platform_instances.find_one(
        {"$or": [{"_id": ref}, {"_id": raw}, {"external_ref": ref}, {"external_ref": raw},
                 {"company_id": ref}, {"company_id": raw}]}
    )
    if inst:
        return {
            "id": inst["_id"],
            "product_id": inst.get("product_id"),
            "company_id": inst.get("company_id"),
            "external_ref": inst.get("external_ref") or "",
            "virtual": False,
        }

    # Virtual TamKobi company
    tam = await _db.platform_products.find_one({"code": PRODUCT_TAMKOBI})
    if not tam:
        return None
    company = await _db.companies.find_one({"_id": raw})
    if company:
        return {
            "id": f"virt_{raw}",
            "product_id": tam["_id"],
            "company_id": raw,
            "external_ref": raw,
            "virtual": True,
        }
    return {
        "id": raw,
        "product_id": tam["_id"],
        "company_id": raw,
        "external_ref": raw,
        "virtual": True,
    }


class KeyScopeError(PermissionError):
    """Key may not access the requested instance/company."""


async def ensure_key_may_access(
    key_doc: dict,
    *,
    instance_ref: Optional[str] = None,
    company_id: Optional[str] = None,
) -> dict:
    """Raise KeyScopeError if key cannot access the target. Returns resolved target."""
    target = await resolve_target(instance_ref=instance_ref, company_id=company_id)
    if not target:
        raise KeyScopeError("Hedef çözülemedi")

    bound = (key_doc.get("instance_id") or "").strip()
    scopes = key_doc.get("scopes") or []
    key_pid = key_doc.get("product_id")

    if bound:
        # Bound key: only that instance / TamKobi company
        allowed_ids = {bound, f"virt_{bound}"}
        bound_inst = await _db.platform_instances.find_one({"_id": bound})
        if bound_inst:
            allowed_ids.add(bound_inst["_id"])
            if bound_inst.get("external_ref"):
                allowed_ids.add(bound_inst["external_ref"])
            if bound_inst.get("company_id"):
                allowed_ids.add(bound_inst["company_id"])
                allowed_ids.add(f"virt_{bound_inst['company_id']}")
        else:
            # Bound id may be a TamKobi company_id
            allowed_ids.add(bound)
            allowed_ids.add(f"virt_{bound}")
        cand = {
            target.get("id"),
            target.get("company_id"),
            target.get("external_ref"),
            f"virt_{target.get('company_id')}" if target.get("company_id") else None,
        }
        if not (cand & allowed_ids):
            raise KeyScopeError("Anahtar bu instance için yetkili değil")
        return target

    # Unbound: product must match
    if target.get("product_id") and key_pid and target["product_id"] != key_pid:
        raise KeyScopeError("Anahtar bu ürün için yetkili değil")

    prod = await _get_product_doc(key_pid) if key_pid else None
    if prod and prod.get("code") == PRODUCT_TAMKOBI:
        if SCOPE_PLATFORM_ALL not in scopes:
            # TamKobi unbound without platform:all cannot query companies
            raise KeyScopeError("TamKobi için platform:all veya instance bağlı anahtar gerekli")
    return target


# ---------- Nonces + rate limit ----------
async def check_and_store_nonce(key_id: str, nonce: str) -> bool:
    """Return True if nonce is new; False if replay (duplicate insert)."""
    nid = f"{key_id}:{nonce}"
    try:
        await _db.platform_nonces.insert_one({
            "_id": nid,
            "key_id": key_id,
            "nonce": nonce,
            "created_at": _now_iso(),
            "expires_at": (_now() + timedelta(seconds=NONCE_TTL_SEC)).isoformat(),
        })
        return True
    except DuplicateKeyError:
        return False


async def check_rate_limit(key_id: str) -> bool:
    """Return True if under key limit; False if exceeded (caller → 429)."""
    return await _bump_rate(f"rl:key:{key_id}:{int(time.time() // 60)}", KEY_RATE_LIMIT, key_id=key_id)


async def check_ip_rate_limit(ip: str) -> bool:
    """Pre-signature IP throttle. Return True if under limit."""
    ip = (ip or "unknown").strip() or "unknown"
    return await _bump_rate(f"rl:ip:{ip}:{int(time.time() // 60)}", IP_RATE_LIMIT, key_id=ip)


async def _bump_rate(bucket: str, limit: int, *, key_id: str = "") -> bool:
    doc = await _db.platform_rate.find_one({"_id": bucket})
    count = int((doc or {}).get("count") or 0)
    if count >= limit:
        return False
    await _db.platform_rate.update_one(
        {"_id": bucket},
        {"$inc": {"count": 1}, "$set": {
            "key_id": key_id,
            "updated_at": _now_iso(),
            "expires_at": (_now() + timedelta(seconds=RATE_TTL_SEC)).isoformat(),
        }},
        upsert=True,
    )
    return True


def sign_payload(secret: str, ts: str, nonce: str, method: str, path: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body or b"").hexdigest()
    msg = f"{ts}\n{nonce}\n{(method or 'GET').upper()}\n{path}\n{body_hash}"
    return hmac.new(secret.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_signature(secret: str, ts: str, nonce: str, method: str, path: str, body: bytes, signature: str) -> bool:
    sig = (signature or "").strip().lower()
    if not _HEX64.match(sig):
        return False
    expected = sign_payload(secret, ts, nonce, method, path, body)
    return hmac.compare_digest(expected, sig)


# ---------- Audit ----------
def scrub_details(obj: Any) -> Any:
    """Recursively strip secret-like keys from audit details."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            kl = str(k).lower()
            if kl.endswith("_enc") or _SENSITIVE_KEY.search(kl):
                continue
            out[k] = scrub_details(v)
        return out
    if isinstance(obj, list):
        return [scrub_details(x) for x in obj]
    return obj


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
    safe = scrub_details(dict(details or {}))
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
async def verify_license(
    *,
    key_doc: Optional[dict] = None,
    instance_ref: Optional[str] = None,
    company_id: Optional[str] = None,
) -> dict:
    import saas
    if key_doc is not None:
        target = await ensure_key_may_access(key_doc, instance_ref=instance_ref, company_id=company_id)
        cid = target.get("company_id") or target.get("id")
    else:
        target = await resolve_target(instance_ref=instance_ref, company_id=company_id)
        cid = (company_id or instance_ref or "").strip()
        if target:
            cid = target.get("company_id") or target.get("id") or cid

    if not cid:
        return {"valid": False, "plan": None, "status": "unknown", "valid_until": None, "modules": {}, "seats": None}

    if target and not target.get("virtual") and not target.get("company_id"):
        inst = await _db.platform_instances.find_one({"_id": target["id"]})
        if inst:
            return {
                "valid": (inst.get("status") or "") in ("active", "trial"),
                "plan": inst.get("plan_code"),
                "status": inst.get("status"),
                "valid_until": inst.get("valid_until"),
                "modules": inst.get("modules") or {},
                "seats": inst.get("seats"),
            }

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


async def record_heartbeat(
    *,
    key_doc: Optional[dict] = None,
    instance_ref: str,
    version: str = "",
    meta: Optional[dict] = None,
) -> dict:
    if key_doc is not None:
        await ensure_key_may_access(key_doc, instance_ref=instance_ref)
    now = _now_iso()
    q = {"$or": [{"_id": instance_ref}, {"external_ref": instance_ref}, {"company_id": instance_ref}]}
    inst = await _db.platform_instances.find_one(q)
    if inst:
        await _db.platform_instances.update_one(
            {"_id": inst["_id"]},
            {"$set": {"last_heartbeat_at": now, "meta": {**(inst.get("meta") or {}), **(meta or {}), "version": version}}},
        )
    else:
        await _db.platform_heartbeats.update_one(
            {"_id": instance_ref},
            {"$set": {"last_heartbeat_at": now, "version": version, "meta": meta or {}, "updated_at": now}},
            upsert=True,
        )
    return {"ok": True, "at": now}


async def record_usage(
    *,
    key_doc: Optional[dict] = None,
    instance_ref: str,
    metrics: dict,
    period: str = "",
) -> dict:
    if key_doc is not None:
        await ensure_key_may_access(key_doc, instance_ref=instance_ref)
    doc = {
        "_id": f"pu_{uuid.uuid4().hex[:16]}",
        "instance_ref": instance_ref,
        "metrics": metrics or {},
        "period": period or "",
        "key_id": (key_doc or {}).get("_id"),
        "product_id": (key_doc or {}).get("product_id"),
        "created_at": _now_iso(),
    }
    await _db.platform_usage.insert_one(doc)
    return {"ok": True, "id": doc["_id"]}


# ---------- Cleanup ----------
async def cleanup_platform_ephemera(db=None) -> dict:
    """Delete expired platform_nonces and platform_rate rows. Unit-test callable."""
    database = db if db is not None else _db
    if database is None:
        return {"nonces": 0, "rates": 0}
    now = _now_iso()
    nonces = 0
    rates = 0
    # Scan and delete expired (docs store; no TTL index required)
    try:
        rows = await database.platform_nonces.find({}).to_list(5000)
        for r in rows:
            exp = _parse_iso(r.get("expires_at"))
            if exp is not None and exp < _now():
                await database.platform_nonces.delete_one({"_id": r["_id"]})
                nonces += 1
    except Exception as e:
        logger.warning("platform_nonces cleanup: %s", e)
    try:
        rows = await database.platform_rate.find({}).to_list(5000)
        for r in rows:
            exp = _parse_iso(r.get("expires_at"))
            # Legacy buckets without expires_at: drop if updated_at older than TTL
            if exp is None:
                upd = _parse_iso(r.get("updated_at"))
                if upd is None or (_now() - upd).total_seconds() < RATE_TTL_SEC:
                    continue
            elif exp >= _now():
                continue
            await database.platform_rate.delete_one({"_id": r["_id"]})
            rates += 1
    except Exception as e:
        logger.warning("platform_rate cleanup: %s", e)
    return {"nonces": nonces, "rates": rates}


async def cleanup_loop(db=None):
    """Background loop: leased externally via platform_lease.run_exclusive."""
    import asyncio
    while True:
        try:
            await cleanup_platform_ephemera(db)
        except Exception as e:
            logger.warning("platform cleanup loop: %s", e)
        await asyncio.sleep(CLEANUP_INTERVAL_SEC)
