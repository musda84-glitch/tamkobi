"""Platform bakım / güncelleme penceresi ve şirketlere bildirim pop-up'ları."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

import saas

router = APIRouter(prefix="/api")
_db = None

DEFAULT_MAINTENANCE_TITLE = "Sistem Güncellemesi"
DEFAULT_MAINTENANCE_BODY = (
    "Değerli Kullanıcımız,\n\n"
    "Sistemimizde planlı bir güncelleme yapılmaktadır. Bu süre boyunca bazı işlemler "
    "geçici olarak kullanılamayabilir.\n\n"
    "Anlayışınız için teşekkür ederiz."
)


def init(db):
    global _db
    _db = db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _clean(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    out = {**doc}
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    return out


def maintenance_active(m: Optional[dict], *, now: Optional[datetime] = None) -> bool:
    if not m or not m.get("enabled"):
        return False
    now = now or _now()
    start = _parse_iso(m.get("starts_at"))
    end = _parse_iso(m.get("ends_at"))
    if start and now < start:
        return False
    if end and now > end:
        return False
    return True


def maintenance_upcoming(m: Optional[dict], *, now: Optional[datetime] = None) -> bool:
    if not m or not m.get("enabled"):
        return False
    now = now or _now()
    start = _parse_iso(m.get("starts_at"))
    if not start or now >= start:
        return False
    end = _parse_iso(m.get("ends_at"))
    if end and end <= start:
        return False
    return True


def announcement_visible(a: Optional[dict], *, now: Optional[datetime] = None) -> bool:
    if not a or a.get("active") is False:
        return False
    now = now or _now()
    start = _parse_iso(a.get("starts_at"))
    end = _parse_iso(a.get("ends_at"))
    if start and now < start:
        return False
    if end and now > end:
        return False
    return True


def normalize_maintenance(raw: Optional[dict]) -> dict:
    raw = raw or {}
    title = (raw.get("title") or DEFAULT_MAINTENANCE_TITLE)
    body = (raw.get("body") or DEFAULT_MAINTENANCE_BODY)
    return {
        "enabled": bool(raw.get("enabled")),
        "title": str(title).strip() or DEFAULT_MAINTENANCE_TITLE,
        "body": str(body).strip() or DEFAULT_MAINTENANCE_BODY,
        "starts_at": raw.get("starts_at") or None,
        "ends_at": raw.get("ends_at") or None,
        "support_email": (str(raw.get("support_email") or "").strip() or None),
        "support_phone": (str(raw.get("support_phone") or "").strip() or None),
        "notify_popup": bool(raw.get("notify_popup", True)),
        "updated_at": raw.get("updated_at"),
    }


async def get_maintenance() -> dict:
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    return normalize_maintenance(st.get("maintenance") or {})


async def public_notices() -> dict:
    m = await get_maintenance()
    now = _now()
    active = maintenance_active(m, now=now)
    upcoming = maintenance_upcoming(m, now=now)
    maintenance_payload = None
    if active or (upcoming and m.get("notify_popup")):
        maintenance_payload = {
            **m,
            "active": active,
            "upcoming": upcoming and not active,
            "kind": "maintenance",
        }
    rows = await _db.platform_announcements.find({}).sort("starts_at", -1).to_list(100)
    announcements = [_clean(a) for a in rows if announcement_visible(a, now=now)]
    return {
        "maintenance": maintenance_payload,
        "announcements": announcements,
        "server_time": now.isoformat(),
    }


@router.get("/platform/notices")
async def platform_notices():
    """Kimlik doğrulamasız — güncelleme / duyuru pop-up'ı için."""
    return await public_notices()


@router.get("/system/maintenance")
async def system_get_maintenance(_: dict = Depends(saas.require_super_admin)):
    m = await get_maintenance()
    now = _now()
    return {
        **m,
        "active": maintenance_active(m, now=now),
        "upcoming": maintenance_upcoming(m, now=now),
        "server_time": now.isoformat(),
    }


@router.put("/system/maintenance")
async def system_put_maintenance(req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    cur = await get_maintenance()
    patch = {**cur}
    for key in ("enabled", "notify_popup"):
        if key in req:
            patch[key] = bool(req.get(key))
    for key in ("title", "body", "starts_at", "ends_at", "support_email", "support_phone"):
        if key not in req:
            continue
        val = req.get(key)
        if val is None or val == "":
            if key in ("starts_at", "ends_at", "support_email", "support_phone"):
                patch[key] = None
            continue
        patch[key] = str(val).strip()
    if patch.get("starts_at") and _parse_iso(patch["starts_at"]) is None:
        raise HTTPException(status_code=400, detail="Geçersiz başlangıç zamanı.")
    if patch.get("ends_at") and _parse_iso(patch["ends_at"]) is None:
        raise HTTPException(status_code=400, detail="Geçersiz bitiş zamanı.")
    start = _parse_iso(patch.get("starts_at"))
    end = _parse_iso(patch.get("ends_at"))
    if start and end and end <= start:
        raise HTTPException(status_code=400, detail="Bitiş, başlangıçtan sonra olmalı.")
    patch = normalize_maintenance({**patch, "updated_at": _now_iso()})
    await _db.platform_settings.update_one(
        {"_id": "platform"},
        {"$set": {"maintenance": patch, "updated_at": _now_iso()}},
        upsert=True,
    )
    if patch.get("enabled") and patch.get("notify_popup") and (patch.get("starts_at") or maintenance_active(patch)):
        await _upsert_maintenance_announcement(patch, admin)
    elif not patch.get("enabled"):
        await _db.platform_announcements.update_one(
            {"_id": "announce_maintenance"},
            {"$set": {"active": False, "updated_at": _now_iso()}},
        )
    now = _now()
    return {
        **patch,
        "active": maintenance_active(patch, now=now),
        "upcoming": maintenance_upcoming(patch, now=now),
        "server_time": now.isoformat(),
        "message": "Bakım / güncelleme ayarı kaydedildi.",
    }


async def _upsert_maintenance_announcement(m: dict, admin: dict):
    title = m.get("title") or DEFAULT_MAINTENANCE_TITLE
    body = m.get("body") or DEFAULT_MAINTENANCE_BODY
    extras = []
    if m.get("starts_at"):
        extras.append(f"Başlangıç: {m['starts_at']}")
    if m.get("ends_at"):
        extras.append(f"Bitiş: {m['ends_at']}")
    if extras:
        body = f"{body.rstrip()}\n\n" + "\n".join(extras)
    contacts = []
    if m.get("support_email"):
        contacts.append(f"E-posta: {m['support_email']}")
    if m.get("support_phone"):
        contacts.append(f"Telefon: {m['support_phone']}")
    if contacts:
        body = f"{body.rstrip()}\n\n" + "\n".join(contacts)
    doc = {
        "_id": "announce_maintenance",
        "title": title,
        "body": body,
        "active": True,
        "kind": "maintenance",
        "starts_at": m.get("starts_at") or _now_iso(),
        "ends_at": m.get("ends_at"),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "created_by": admin.get("email") or admin.get("_id"),
    }
    existing = await _db.platform_announcements.find_one({"_id": "announce_maintenance"})
    if existing:
        doc["created_at"] = existing.get("created_at") or doc["created_at"]
        await _db.platform_announcements.replace_one({"_id": "announce_maintenance"}, doc)
    else:
        await _db.platform_announcements.insert_one(doc)


@router.get("/system/announcements")
async def system_list_announcements(_: dict = Depends(saas.require_super_admin)):
    rows = await _db.platform_announcements.find({}).sort("created_at", -1).to_list(200)
    return [_clean(r) for r in rows]


@router.post("/system/announcements")
async def system_create_announcement(req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    title = (req.get("title") or "").strip()
    body = (req.get("body") or "").strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="Başlık ve metin zorunlu.")
    starts_at = req.get("starts_at") or _now_iso()
    if _parse_iso(starts_at) is None:
        raise HTTPException(status_code=400, detail="Geçersiz başlangıç zamanı.")
    ends_at = req.get("ends_at") or None
    if ends_at and _parse_iso(ends_at) is None:
        raise HTTPException(status_code=400, detail="Geçersiz bitiş zamanı.")
    doc = {
        "_id": str(uuid.uuid4()),
        "title": title,
        "body": body,
        "active": bool(req.get("active", True)),
        "kind": (req.get("kind") or "info").strip() or "info",
        "starts_at": starts_at,
        "ends_at": ends_at,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "created_by": admin.get("email") or admin.get("_id"),
    }
    await _db.platform_announcements.insert_one(doc)
    return {"status": "success", "announcement": _clean(doc), "message": "Duyuru yayınlandı; şirketlerde pop-up görünecek."}


@router.put("/system/announcements/{announce_id}")
async def system_update_announcement(announce_id: str, req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    cur = await _db.platform_announcements.find_one({"_id": announce_id})
    if not cur:
        raise HTTPException(status_code=404, detail="Duyuru bulunamadı.")
    patch: Dict[str, Any] = {"updated_at": _now_iso()}
    if "title" in req:
        t = (req.get("title") or "").strip()
        if not t:
            raise HTTPException(status_code=400, detail="Başlık boş olamaz.")
        patch["title"] = t
    if "body" in req:
        b = (req.get("body") or "").strip()
        if not b:
            raise HTTPException(status_code=400, detail="Metin boş olamaz.")
        patch["body"] = b
    if "active" in req:
        patch["active"] = bool(req.get("active"))
    if "kind" in req:
        patch["kind"] = (req.get("kind") or "info").strip() or "info"
    if "starts_at" in req:
        if req.get("starts_at") and _parse_iso(req.get("starts_at")) is None:
            raise HTTPException(status_code=400, detail="Geçersiz başlangıç zamanı.")
        patch["starts_at"] = req.get("starts_at") or None
    if "ends_at" in req:
        if req.get("ends_at") and _parse_iso(req.get("ends_at")) is None:
            raise HTTPException(status_code=400, detail="Geçersiz bitiş zamanı.")
        patch["ends_at"] = req.get("ends_at") or None
    await _db.platform_announcements.update_one({"_id": announce_id}, {"$set": patch})
    return {"status": "success", "announcement": _clean(await _db.platform_announcements.find_one({"_id": announce_id}))}


@router.delete("/system/announcements/{announce_id}")
async def system_delete_announcement(announce_id: str, _: dict = Depends(saas.require_super_admin)):
    r = await _db.platform_announcements.delete_one({"_id": announce_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Duyuru bulunamadı.")
    return {"status": "success", "message": "Duyuru silindi."}
