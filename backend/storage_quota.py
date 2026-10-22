"""Depolama limiti ve artış talebi.

Limit, lisans kotasındaki `storage_limit_mb` alanıdır (Kotalar ile aynı kayıt).
0 = sınırsız, null = paketten al. Kullanım `saas.quota_usage` ile hesaplanır.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import logging

from fastapi import HTTPException

_db = None
logger = logging.getLogger("tamkobi.storage")

_MB = 1024 * 1024
_MAX_MB = 10_485_760
_STATUSES = ("pending", "approved", "rejected")
_STATUS_LABELS = {
    "pending": "Bekliyor",
    "approved": "Onaylandı",
    "rejected": "Reddedildi",
}


def init(db) -> None:
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tr_number(value: float) -> str:
    rounded = round(float(value), 1)
    if abs(rounded - round(rounded)) < 0.05:
        return str(int(round(rounded)))
    return f"{rounded:.1f}".replace(".", ",")


def storage_limit_message(used_bytes: int, limit_mb: int) -> str:
    used_mb = max(0, int(used_bytes or 0)) / _MB
    return (
        f"Depolama limiti aşıldı. Kullanılan {_tr_number(used_mb)} MB, "
        f"limit {_tr_number(limit_mb)} MB. "
        "Ayarlar → Depolama bölümünden limit artışı talep edebilirsiniz."
    )


def usage_view(used_bytes: int, limit_mb: int) -> Dict[str, Any]:
    used = max(0, int(used_bytes or 0))
    limit = max(0, int(limit_mb or 0))
    unlimited = limit <= 0
    limit_bytes = None if unlimited else limit * _MB
    if unlimited or not limit_bytes:
        percent = None
    else:
        percent = round(used * 100.0 / limit_bytes, 1)
    free = None if unlimited else max(0, limit_bytes - used)
    return {
        "used_bytes": used,
        "used_mb": round(used / _MB, 1),
        "limit_mb": limit,
        "limit_bytes": limit_bytes,
        "free_bytes": free,
        "unlimited": unlimited,
        "percent": percent,
    }


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or value is None:
        raise HTTPException(status_code=400, detail=f"{label} sayısal olmalıdır.")
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(" ", "").replace(",", ".")
        if not text:
            raise HTTPException(status_code=400, detail=f"{label} sayısal olmalıdır.")
        try:
            return float(text)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"{label} sayısal olmalıdır.") from None
    raise HTTPException(status_code=400, detail=f"{label} sayısal olmalıdır.")


def _unit(value: Any) -> str:
    unit = str(value or "mb").strip().lower()
    if unit not in ("mb", "gb"):
        raise HTTPException(status_code=400, detail="Birim MB veya GB olmalıdır.")
    return unit


def mb_from_amount(amount: Any, unit: Any) -> int:
    number = _number(amount, "Miktar")
    if number <= 0:
        raise HTTPException(status_code=400, detail="Miktar sıfırdan büyük olmalıdır.")
    factor = 1024 if _unit(unit) == "gb" else 1
    mb = int(round(number * factor))
    if mb < 1:
        raise HTTPException(status_code=400, detail="Limit en az 1 MB olmalıdır.")
    if mb > _MAX_MB:
        raise HTTPException(status_code=400, detail="Limit çok büyük.")
    return mb


def parse_admin_limit(payload: Dict[str, Any]) -> Optional[int]:
    """Yazılacak storage_limit_mb. None = paket limiti, 0 = sınırsız."""
    has_mb = "storage_limit_mb" in payload
    has_amount = "amount" in payload or "unit" in payload
    unlimited = payload.get("unlimited")
    if unlimited is not None and not isinstance(unlimited, bool):
        raise HTTPException(status_code=400, detail="Sınırsız seçeneği doğru ya da yanlış olmalıdır.")
    if unlimited is True and (has_mb or has_amount):
        raise HTTPException(status_code=400, detail="Sınırsız seçiliyken miktar gönderilmez.")
    if unlimited is True:
        return 0
    if has_mb and has_amount:
        raise HTTPException(status_code=400, detail="Limit ya MB olarak ya da miktar ve birim ile gönderilir.")
    if has_amount and "amount" not in payload:
        raise HTTPException(status_code=400, detail="Miktar zorunlu.")
    if has_mb:
        raw = payload.get("storage_limit_mb")
        if raw is None:
            return None
        if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
            raise HTTPException(
                status_code=400,
                detail="Limit sayısal olmalıdır (boş = paketten al, 0 = sınırsız).",
            )
        if raw > _MAX_MB:
            raise HTTPException(status_code=400, detail="Limit çok büyük.")
        return raw
    if "amount" in payload:
        return mb_from_amount(payload.get("amount"), payload.get("unit") or "mb")
    raise HTTPException(status_code=400, detail="Depolama limiti gerekli.")


def _public_request(doc: dict) -> dict:
    status = doc.get("status") or "pending"
    return {
        "id": doc.get("_id"),
        "company_id": doc.get("company_id"),
        "company_name": doc.get("company_name") or "",
        "status": status,
        "status_label": _STATUS_LABELS.get(status, status),
        "requested_limit_mb": doc.get("requested_limit_mb"),
        "requested_amount": doc.get("requested_amount"),
        "requested_unit": doc.get("requested_unit") or "mb",
        "current_limit_mb": doc.get("current_limit_mb"),
        "current_used_bytes": int(doc.get("current_used_bytes") or 0),
        "message": doc.get("message") or "",
        "admin_note": doc.get("admin_note") or "",
        "requested_by": doc.get("requested_by") or "",
        "requested_by_name": doc.get("requested_by_name") or "",
        "created_at": doc.get("created_at"),
        "resolved_at": doc.get("resolved_at"),
    }


def _desired_limit(payload: Dict[str, Any]) -> tuple:
    message = payload.get("message") if "message" in payload else ""
    if message is None:
        message = ""
    if not isinstance(message, str):
        raise HTTPException(status_code=400, detail="Not metin olmalıdır.")
    if len(message) > 500:
        raise HTTPException(status_code=400, detail="Not en çok 500 karakter olabilir.")
    if "limit_mb" in payload and ("amount" in payload or "unit" in payload):
        raise HTTPException(status_code=400, detail="Limit ya MB olarak ya da miktar ve birim ile gönderilir.")
    if "limit_mb" in payload:
        raw = payload.get("limit_mb")
        if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
            raise HTTPException(status_code=400, detail="İstenen limit en az 1 MB olmalıdır.")
        if raw > _MAX_MB:
            raise HTTPException(status_code=400, detail="Limit çok büyük.")
        return raw, raw, "mb", message.strip()
    if "amount" not in payload:
        raise HTTPException(status_code=400, detail="İstenen depolama limiti gerekli.")
    unit = _unit(payload.get("unit") or "mb")
    mb = mb_from_amount(payload.get("amount"), unit)
    return mb, payload.get("amount"), unit, message.strip()


async def latest_increase_request(company_id: str) -> Optional[dict]:
    pending = await _db.storage_increase_requests.find_one(
        {"company_id": company_id, "status": "pending"},
        sort=[("created_at", -1)],
    )
    if pending:
        return _public_request(pending)
    row = await _db.storage_increase_requests.find_one(
        {"company_id": company_id},
        sort=[("created_at", -1)],
    )
    return _public_request(row) if row else None


async def list_increase_requests(company_id: str, status: Optional[str] = None, limit: int = 50) -> List[dict]:
    if status:
        rows = await _db.storage_increase_requests.find(
            {"company_id": company_id, "status": status},
        ).sort("created_at", -1).to_list(limit)
    else:
        rows = await _db.storage_increase_requests.find(
            {"company_id": company_id},
        ).sort("created_at", -1).to_list(limit)
    return [_public_request(row) for row in rows]


async def create_increase_request(company_id: str, user: dict, payload: Dict[str, Any]) -> dict:
    import saas

    requested_mb, amount, unit, message = _desired_limit(payload)
    if await _db.storage_increase_requests.find_one({"company_id": company_id, "status": "pending"}):
        raise HTTPException(status_code=400, detail="Bekleyen bir depolama artış talebiniz zaten var.")
    lic = await saas.effective(company_id)
    limit_mb = int(lic.get("storage_limit_mb") or 0)
    if limit_mb <= 0:
        raise HTTPException(status_code=400, detail="Depolama limitiniz sınırsız. Artış talebi gerekmez.")
    if requested_mb <= limit_mb:
        raise HTTPException(status_code=400, detail="İstenen limit mevcut limitten büyük olmalıdır.")
    used = int((await saas.quota_usage(company_id)).get("storage_bytes") or 0)
    company = await _db.companies.find_one({"_id": company_id}, {"name": 1}) or {}
    doc = {
        "_id": f"sir_{uuid.uuid4().hex[:16]}",
        "company_id": company_id,
        "company_name": company.get("name") or "",
        "requested_limit_mb": requested_mb,
        "requested_amount": amount if isinstance(amount, (int, float)) and not isinstance(amount, bool) else requested_mb,
        "requested_unit": unit,
        "current_limit_mb": limit_mb,
        "current_used_bytes": used,
        "message": message,
        "requested_by": user.get("email") or "",
        "requested_by_name": user.get("name") or "",
        "status": "pending",
        "admin_note": "",
        "created_at": _now(),
    }
    await _db.storage_increase_requests.insert_one(doc)
    return _public_request(doc)


async def resolve_increase_request(
    company_id: str,
    request_id: str,
    status: str,
    note: Optional[str],
    *,
    actor: str = "",
) -> dict:
    import saas

    if status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    text = note if isinstance(note, str) else ""
    if note is not None and not isinstance(note, str):
        raise HTTPException(status_code=400, detail="Not metin olmalıdır.")
    if len(text) > 1000:
        raise HTTPException(status_code=400, detail="Not en çok 1000 karakter olabilir.")
    if status == "rejected" and not text.strip():
        raise HTTPException(status_code=400, detail="Red notu zorunlu.")
    row = await _db.storage_increase_requests.find_one({"_id": request_id, "company_id": company_id})
    if not row:
        raise HTTPException(status_code=404, detail="Talep bulunamadı.")
    if row.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Talep zaten sonuçlanmış.")
    if status == "approved":
        requested = int(row.get("requested_limit_mb") or 0)
        if requested < 1:
            raise HTTPException(status_code=400, detail="İstenen limit geçersiz.")
        await saas.apply_license_update(company_id, {"storage_limit_mb": requested})
    await _db.storage_increase_requests.update_one(
        {"_id": request_id, "company_id": company_id},
        {"$set": {
            "status": status,
            "admin_note": text.strip(),
            "resolved_at": _now(),
            "resolved_by": actor or "",
        }},
    )
    saved = await _db.storage_increase_requests.find_one({"_id": request_id, "company_id": company_id})
    try:
        import notify
        title = "Depolama limiti talebiniz onaylandı" if status == "approved" else "Depolama limiti talebiniz reddedildi"
        if status == "approved":
            body = f"Yeni limit {int(row.get('requested_limit_mb') or 0)} MB olarak uygulandı."
        else:
            body = text.strip()
        await notify.insert_notification(_db, notify.notification_doc(
            company_id,
            "storage_limit",
            title,
            body,
            link="/settings?tab=storage",
            roles=("admin",),
            ref_type="storage_increase",
            ref_id=request_id,
        ))
    except Exception:
        logger.exception("Depolama talep bildirimi yazılamadı")
    return _public_request(saved or row)
