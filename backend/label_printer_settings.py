"""Şirket varsayılan ağ etiket yazıcısı (Xprinter XP-490B, TSPL, TCP 9100)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request

import tenant_access

router = APIRouter(prefix="/api")
_db = None
_current_user = None

SERIAL_BAUD_PORTS = frozenset({9600, 19200, 38400, 57600, 115200})


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Label printer auth bağlanmadı.")
    return await _current_user(request)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mm(value: Any, fallback: float, lo: float, hi: float) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return fallback
    if n != n:  # NaN
        return fallback
    n = max(lo, min(hi, n))
    return round(n, 1)


def normalize_label_printer(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Cihaz ve API'nin paylaştığı yazıcı varsayılanı."""
    src = raw or {}
    try:
        port = int(src.get("port") if src.get("port") not in (None, "") else 9100)
    except (TypeError, ValueError) as e:
        raise ValueError("Port sayı olmalı. Varsayılan 9100.") from e
    if port in SERIAL_BAUD_PORTS:
        raise ValueError(
            f"Port {port} seri baud hızıdır (yazıcı konfig etiketi), Ethernet ham port değil. "
            "XP-490B için port 9100 kullanın."
        )
    if port < 1 or port > 65535:
        raise ValueError("Port 1–65535 arasında olmalı. Varsayılan 9100.")
    try:
        dpi = int(src.get("dpi") or 203)
    except (TypeError, ValueError):
        dpi = 203
    host = str(src.get("host") or "").strip()[:253]
    name = str(src.get("name") or "Xprinter XP-490B").strip()[:80] or "Xprinter XP-490B"
    text_mode = "bitmap" if str(src.get("text_mode") or "").strip() == "bitmap" else "codepage"
    return {
        "name": name,
        "host": host,
        "port": port,
        "width_mm": _mm(src.get("width_mm"), 100, 20, 120),
        "height_mm": _mm(src.get("height_mm"), 50, 10, 300),
        "gap_mm": _mm(src.get("gap_mm"), 2, 0, 25),
        "dpi": 300 if dpi == 300 else 203,
        "text_mode": text_mode,
        "configured": bool(host),
    }


def empty_label_printer() -> Dict[str, Any]:
    return normalize_label_printer({})


async def load_company_label_printer(db, company_id: str) -> Dict[str, Any]:
    company = await db.companies.find_one({"_id": company_id}, {"label_printer": 1})
    if not company:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    stored = company.get("label_printer") if isinstance(company.get("label_printer"), dict) else {}
    try:
        return normalize_label_printer(stored)
    except ValueError:
        return empty_label_printer()


async def save_company_label_printer(db, company_id: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    company = await db.companies.find_one({"_id": company_id}, {"_id": 1})
    if not company:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    try:
        doc = normalize_label_printer(raw or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not doc["host"]:
        raise HTTPException(status_code=400, detail="Yazıcı IP adresi girin (örn. 192.168.1.117).")
    doc["updated_at"] = _now()
    await db.companies.update_one({"_id": company_id}, {"$set": {"label_printer": doc}})
    return doc


def _require_member(user: dict, company_id: str) -> None:
    if not tenant_access.user_may_access_company(user, company_id):
        raise HTTPException(status_code=403, detail="Yalnızca bu şirketin kullanıcıları yazıcı ayarını görebilir.")


@router.get("/companies/{company_id}/label-printer")
async def get_label_printer(company_id: str, request: Request):
    user = await _user_dep(request)
    _require_member(user, company_id)
    if _db is None:
        raise HTTPException(status_code=500, detail="Veritabanı bağlanmadı.")
    return await load_company_label_printer(_db, company_id)


@router.put("/companies/{company_id}/label-printer")
async def put_label_printer(company_id: str, req: Dict[str, Any], request: Request):
    user = await _user_dep(request)
    _require_member(user, company_id)
    if _db is None:
        raise HTTPException(status_code=500, detail="Veritabanı bağlanmadı.")
    saved = await save_company_label_printer(_db, company_id, req or {})
    return {"status": "success", "message": "Şirket yazıcı varsayılanı kaydedildi.", **saved}
