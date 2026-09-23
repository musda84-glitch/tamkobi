"""Platform bakım / güncelleme penceresi ve şirketlere bildirim pop-up'ları."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

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

AUDIENCE_ALL = "all"
AUDIENCE_SELECTED = "selected"
STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"


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


def normalize_company_ids(raw) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw = [raw]
    out = []
    seen = set()
    for item in raw:
        cid = str(item or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        out.append(cid)
    return out


def normalize_audience(raw: Optional[str], company_ids: Optional[List[str]] = None) -> str:
    aud = (str(raw or AUDIENCE_ALL).strip().lower() or AUDIENCE_ALL)
    if aud not in (AUDIENCE_ALL, AUDIENCE_SELECTED):
        aud = AUDIENCE_ALL
    if aud == AUDIENCE_SELECTED and not (company_ids or []):
        # Seçim yoksa güvenli varsayılan: tüm şirketler
        return AUDIENCE_ALL
    return aud


def normalize_status(raw: Optional[str], *, default: str = STATUS_PUBLISHED) -> str:
    st = (str(raw or default).strip().lower() or default)
    if st not in (STATUS_DRAFT, STATUS_PUBLISHED):
        return default
    return st


def announcement_targets_company(a: Optional[dict], company_id: Optional[str]) -> bool:
    """company_id yoksa sadece 'all' duyurular görünür (anonim / şirket seçilmemiş)."""
    if not a:
        return False
    audience = normalize_audience(a.get("audience"), a.get("company_ids"))
    if audience == AUDIENCE_ALL:
        return True
    ids = set(normalize_company_ids(a.get("company_ids")))
    if not company_id:
        return False
    return str(company_id) in ids


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


def announcement_visible(a: Optional[dict], *, now: Optional[datetime] = None, include_drafts: bool = False) -> bool:
    if not a:
        return False
    status = normalize_status(a.get("status"), default=STATUS_PUBLISHED)
    if status == STATUS_DRAFT and not include_drafts:
        return False
    if a.get("active") is False:
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
    company_ids = normalize_company_ids(raw.get("company_ids"))
    audience = normalize_audience(raw.get("audience"), company_ids)
    return {
        "enabled": bool(raw.get("enabled")),
        "title": str(title).strip() or DEFAULT_MAINTENANCE_TITLE,
        "body": str(body).strip() or DEFAULT_MAINTENANCE_BODY,
        "starts_at": raw.get("starts_at") or None,
        "ends_at": raw.get("ends_at") or None,
        "support_email": (str(raw.get("support_email") or "").strip() or None),
        "support_phone": (str(raw.get("support_phone") or "").strip() or None),
        "notify_popup": bool(raw.get("notify_popup", True)),
        "audience": audience,
        "company_ids": company_ids if audience == AUDIENCE_SELECTED else [],
        "updated_at": raw.get("updated_at"),
    }


async def get_maintenance() -> dict:
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    return normalize_maintenance(st.get("maintenance") or {})


async def public_notices(*, company_id: Optional[str] = None, demo: bool = False) -> dict:
    """Şirket panelleri için duyurular.

    demo=True: taslaklar da dahil (yalnızca süper admin önizlemesi için kullanılır).
    """
    m = await get_maintenance()
    now = _now()
    active = maintenance_active(m, now=now)
    upcoming = maintenance_upcoming(m, now=now)
    maintenance_payload = None
    if (active or (upcoming and m.get("notify_popup"))) and announcement_targets_company(m, company_id):
        maintenance_payload = {
            **m,
            "active": active,
            "upcoming": upcoming and not active,
            "kind": "maintenance",
        }
    rows = await _db.platform_announcements.find({}).sort("starts_at", -1).to_list(100)
    announcements = []
    for a in rows:
        if not announcement_visible(a, now=now, include_drafts=demo):
            continue
        if not announcement_targets_company(a, company_id):
            continue
        cleaned = _clean(a)
        if cleaned:
            announcements.append(cleaned)
    return {
        "maintenance": maintenance_payload,
        "announcements": announcements,
        "server_time": now.isoformat(),
        "company_id": company_id,
        "demo": bool(demo),
    }


@router.get("/platform/notices")
async def platform_notices(company_id: Optional[str] = Query(None)):
    """Kimlik doğrulamasız — güncelleme / duyuru pop-up'ı için."""
    return await public_notices(company_id=company_id, demo=False)


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
    if "company_ids" in req or "audience" in req:
        cids = normalize_company_ids(req.get("company_ids") if "company_ids" in req else patch.get("company_ids"))
        aud = normalize_audience(req.get("audience") if "audience" in req else patch.get("audience"), cids)
        patch["audience"] = aud
        patch["company_ids"] = cids if aud == AUDIENCE_SELECTED else []
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
    audience = normalize_audience(m.get("audience"), m.get("company_ids"))
    company_ids = normalize_company_ids(m.get("company_ids")) if audience == AUDIENCE_SELECTED else []
    doc = {
        "_id": "announce_maintenance",
        "title": title,
        "body": body,
        "active": True,
        "status": STATUS_PUBLISHED,
        "kind": "maintenance",
        "audience": audience,
        "company_ids": company_ids,
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


def _announce_fields_from_req(req: Dict[str, Any], *, partial: bool = False, existing: Optional[dict] = None) -> Dict[str, Any]:
    base = existing or {}
    if not partial or "title" in req:
        title = (req.get("title") if "title" in req else base.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="Başlık zorunlu.")
    else:
        title = base.get("title")
    if not partial or "body" in req:
        body = (req.get("body") if "body" in req else base.get("body") or "").strip()
        if not body:
            raise HTTPException(status_code=400, detail="Metin zorunlu.")
    else:
        body = base.get("body")

    starts_at = req.get("starts_at") if "starts_at" in req else base.get("starts_at")
    if starts_at is None or starts_at == "":
        starts_at = _now_iso() if not partial else base.get("starts_at")
    if starts_at and _parse_iso(starts_at) is None:
        raise HTTPException(status_code=400, detail="Geçersiz başlangıç zamanı.")
    ends_at = req.get("ends_at") if "ends_at" in req else base.get("ends_at")
    if ends_at in ("", None):
        ends_at = None
    elif _parse_iso(ends_at) is None:
        raise HTTPException(status_code=400, detail="Geçersiz bitiş zamanı.")

    cids = normalize_company_ids(req.get("company_ids") if "company_ids" in req else base.get("company_ids"))
    audience = normalize_audience(req.get("audience") if "audience" in req else base.get("audience"), cids)
    status = normalize_status(req.get("status") if "status" in req else base.get("status"), default=STATUS_PUBLISHED)
    active = bool(req.get("active")) if "active" in req else bool(base.get("active", True))
    kind = ((req.get("kind") if "kind" in req else base.get("kind")) or "info")
    kind = str(kind).strip() or "info"

    return {
        "title": title,
        "body": body,
        "active": active,
        "status": status,
        "kind": kind,
        "audience": audience,
        "company_ids": cids if audience == AUDIENCE_SELECTED else [],
        "starts_at": starts_at,
        "ends_at": ends_at,
    }


@router.get("/system/announcements")
async def system_list_announcements(_: dict = Depends(saas.require_super_admin)):
    rows = await _db.platform_announcements.find({}).sort("created_at", -1).to_list(200)
    return [_clean(r) for r in rows]


@router.get("/system/announcements/preview")
async def system_preview_notices(
    company_id: Optional[str] = Query(None),
    admin: dict = Depends(saas.require_super_admin),
):
    """Yayın öncesi demo: taslaklar dahil, seçilen şirketin göreceği pop-up listesi."""
    return await public_notices(company_id=company_id, demo=True)


@router.post("/system/announcements")
async def system_create_announcement(req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    fields = _announce_fields_from_req(req, partial=False)
    doc = {
        "_id": str(uuid.uuid4()),
        **fields,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "created_by": admin.get("email") or admin.get("_id"),
    }
    await _db.platform_announcements.insert_one(doc)
    msg = (
        "Taslak kaydedildi. Önizleyip yayınlayabilirsiniz."
        if doc["status"] == STATUS_DRAFT
        else "Duyuru yayınlandı; hedef şirketlerde pop-up görünecek."
    )
    return {"status": "success", "announcement": _clean(doc), "message": msg}


@router.put("/system/announcements/{announce_id}")
async def system_update_announcement(announce_id: str, req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    cur = await _db.platform_announcements.find_one({"_id": announce_id})
    if not cur:
        raise HTTPException(status_code=404, detail="Duyuru bulunamadı.")
    fields = _announce_fields_from_req(req, partial=True, existing=cur)
    patch = {**fields, "updated_at": _now_iso()}
    await _db.platform_announcements.update_one({"_id": announce_id}, {"$set": patch})
    return {"status": "success", "announcement": _clean(await _db.platform_announcements.find_one({"_id": announce_id}))}


@router.post("/system/announcements/{announce_id}/publish")
async def system_publish_announcement(announce_id: str, _: dict = Depends(saas.require_super_admin)):
    cur = await _db.platform_announcements.find_one({"_id": announce_id})
    if not cur:
        raise HTTPException(status_code=404, detail="Duyuru bulunamadı.")
    await _db.platform_announcements.update_one(
        {"_id": announce_id},
        {"$set": {"status": STATUS_PUBLISHED, "active": True, "updated_at": _now_iso()}},
    )
    return {
        "status": "success",
        "announcement": _clean(await _db.platform_announcements.find_one({"_id": announce_id})),
        "message": "Duyuru yayınlandı.",
    }


@router.delete("/system/announcements/{announce_id}")
async def system_delete_announcement(announce_id: str, _: dict = Depends(saas.require_super_admin)):
    r = await _db.platform_announcements.delete_one({"_id": announce_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Duyuru bulunamadı.")
    return {"status": "success", "message": "Duyuru silindi."}
