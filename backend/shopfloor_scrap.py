"""Şirket tanımlı fire nedeni.

Eski istemci kod göndermezse kayıt null kalır. scrap_reason_required
açıksa zorunluluk yalnız atolye_device isteğindedir.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException

import shopfloor_accounts
import shopfloor_settings

REASON_INVALID = "Fire nedeni geçersiz."
REASON_INACTIVE = "Fire nedeni pasif."
REASON_REQUIRED = "Fire nedeni seçin."
NOTE_LONG = "Fire notu çok uzun."


def movement_fields(req: Optional[dict]) -> dict:
    body = req or {}
    code = str(body.get("scrap_reason_code") or "").strip()
    if not code:
        return {}
    out = {"scrap_reason_code": code}
    label = str(body.get("scrap_reason_label") or "").strip()
    note = str(body.get("scrap_reason_note") or "").strip()
    if label:
        out["scrap_reason_label"] = label
    if note:
        out["scrap_reason_note"] = note
    return out


async def enforce(db, company_id: str, req: Optional[dict], scrap_qty: float, user: Any) -> dict:
    """scrap_qty 0 ise boş. Aksi halde doğrulanmış alanlar ya da 400."""
    body = req or {}
    if float(scrap_qty or 0) <= 0 and not str(body.get("scrap_reason_code") or "").strip():
        return {}
    if float(scrap_qty or 0) <= 0:
        return {}
    company = await shopfloor_settings.load_company(db, company_id)
    reasons = shopfloor_settings.scrap_reasons(company)
    code = str(body.get("scrap_reason_code") or "").strip().lower()
    note = str(body.get("scrap_reason_note") or body.get("scrap_reason_text") or "").strip()
    if not code:
        if shopfloor_settings.scrap_reason_required(company) and shopfloor_accounts.is_device_user(user):
            raise HTTPException(status_code=400, detail=REASON_REQUIRED)
        return {"scrap_reason_code": None, "scrap_reason_label": None, "scrap_reason_note": None}
    match = next((item for item in reasons if item.get("code") == code), None)
    if match is None:
        raise HTTPException(status_code=400, detail=REASON_INVALID)
    if not match.get("active"):
        raise HTTPException(status_code=400, detail=REASON_INACTIVE)
    if len(note) > shopfloor_settings.NOTE_MAX:
        raise HTTPException(status_code=400, detail=NOTE_LONG)
    stored_note = note if code == "other" else ""
    return {
        "scrap_reason_code": code,
        "scrap_reason_label": match.get("label") or code,
        "scrap_reason_note": stored_note or None,
    }
