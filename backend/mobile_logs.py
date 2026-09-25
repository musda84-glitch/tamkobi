"""Şirkete özel panel / mobil istemci logları (Çöp Kutusu sekmesinden görüntülenir)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/mobile", tags=["mobile-logs"])
_db = None
_current_user = None
RETENTION_DAYS = 30
COLLECTION = "mobile_client_logs"


def init(db, current_user_dep):
    global _db, _current_user
    _db = db
    _current_user = current_user_dep


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


async def purge_expired(company_id: Optional[str] = None) -> int:
    q: Dict[str, Any] = {"expires_at": {"$lt": _now_iso()}}
    if company_id:
        q["company_id"] = company_id
    r = await _db[COLLECTION].delete_many(q)
    return int(r.deleted_count or 0)


def _clean(doc: dict) -> dict:
    out = dict(doc)
    out["id"] = out.pop("_id", out.get("id"))
    return out


def _user_companies(user: dict) -> set:
    ids = set(user.get("company_ids") or [])
    active = user.get("active_company_id")
    if active:
        ids.add(active)
    return {str(x) for x in ids if x}


async def _require_company_user(request: Request, company_id: str) -> dict:
    if not _current_user:
        raise HTTPException(status_code=500, detail="Auth yapılandırılmadı.")
    user = await _current_user(request)
    if user.get("is_super_admin"):
        return user
    if str(company_id) not in _user_companies(user):
        raise HTTPException(status_code=403, detail="Bu şirketin loglarına erişim yok.")
    return user


@router.get("/logs")
async def list_mobile_logs(
    request: Request,
    company_id: str = "comp_nexus_main_01",
    q: Optional[str] = None,
    source: Optional[str] = None,
    level: Optional[str] = None,
    limit: int = 200,
):
    await _require_company_user(request, company_id)
    await purge_expired(company_id)
    query: Dict[str, Any] = {"company_id": company_id}
    if source:
        query["source"] = str(source).strip().lower()
    if level:
        query["level"] = str(level).strip().upper()
    rows = await _db[COLLECTION].find(query).sort("created_at", -1).to_list(min(max(int(limit or 200), 1), 500))
    if q:
        ql = q.strip().lower()
        rows = [
            r for r in rows
            if ql in str(r.get("message") or "").lower()
            or ql in str(r.get("screen") or "").lower()
            or ql in str(r.get("user_email") or "").lower()
            or ql in str(r.get("path") or "").lower()
        ]
    return {
        "items": [_clean(r) for r in rows],
        "total": len(rows),
        "retention_days": RETENTION_DAYS,
    }


@router.post("/logs")
async def create_mobile_log(req: Dict[str, Any], request: Request):
    company_id = str(req.get("company_id") or "").strip() or "comp_nexus_main_01"
    user = await _require_company_user(request, company_id)
    message = str(req.get("message") or req.get("error") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Log mesajı gerekli.")
    now = _now()
    source = str(req.get("source") or "mobile").strip().lower() or "mobile"
    if source not in ("mobile", "web", "panel", "kiosk"):
        source = "mobile"
    level = str(req.get("level") or "ERROR").strip().upper()
    if level not in ("DEBUG", "INFO", "WARNING", "ERROR"):
        level = "ERROR"
    doc = {
        "_id": f"mlog_{uuid.uuid4().hex[:12]}",
        "company_id": company_id,
        "source": source,
        "level": level,
        "message": message[:2000],
        "stack": str(req.get("stack") or "")[:8000],
        "screen": str(req.get("screen") or req.get("label") or req.get("component") or "")[:200],
        "path": str(req.get("path") or "")[:400],
        "app_version": str(req.get("app_version") or req.get("version") or "")[:40],
        "platform": str(req.get("platform") or "")[:80],
        "user_agent": str(req.get("user_agent") or request.headers.get("user-agent") or "")[:400],
        "user_id": str(user.get("_id") or user.get("id") or ""),
        "user_email": str(user.get("email") or ""),
        "user_name": str(user.get("name") or ""),
        "details": req.get("details") if isinstance(req.get("details"), dict) else {},
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=RETENTION_DAYS)).isoformat(),
    }
    await _db[COLLECTION].insert_one(doc)
    return {"status": "ok", "id": doc["_id"]}


@router.delete("/logs/{log_id}")
async def delete_mobile_log(log_id: str, request: Request, company_id: str = "comp_nexus_main_01"):
    await _require_company_user(request, company_id)
    rec = await _db[COLLECTION].find_one({"_id": log_id})
    if not rec or rec.get("company_id") != company_id:
        raise HTTPException(status_code=404, detail="Log bulunamadı.")
    await _db[COLLECTION].delete_one({"_id": log_id})
    return {"status": "success", "message": "Log silindi."}


@router.post("/logs/empty")
async def empty_mobile_logs(req: Dict[str, Any], request: Request):
    company_id = str(req.get("company_id") or "").strip() or "comp_nexus_main_01"
    await _require_company_user(request, company_id)
    r = await _db[COLLECTION].delete_many({"company_id": company_id})
    return {"status": "success", "deleted": int(r.deleted_count or 0), "message": f"{int(r.deleted_count or 0)} mobil log silindi."}
