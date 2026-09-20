"""Dual approval for manual (non-integrated) cash/bank operations."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

import bank_guard
import rbac

KIND_LABELS = {
    "distribute_profit": "Kâr payı dağıtımı",
    "partner_tx": "Ortak para koy / çek",
    "virman": "Virman",
}


def uid(user: dict) -> str:
    return str((user or {}).get("_id") or (user or {}).get("id") or "")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def enabled(db, company_id: str) -> bool:
    c = await db.companies.find_one({"_id": company_id}) or {}
    return bool(c.get("cash_dual_approval"))


async def can_approve(db, user: dict, company_id: str) -> bool:
    if not user:
        return False
    role = await rbac.role_for(user, company_id)
    if role.get("code") == "admin" or user.get("role") == "admin":
        return True
    return (role.get("permissions") or {}).get("/banking") == "edit"


async def queue(db, *, company_id: str, kind: str, payload: dict, account_ids: List[Optional[str]],
                summary: str, user: dict) -> dict:
    for aid in account_ids:
        if aid:
            await bank_guard.assert_manual_allowed(db, aid)
    req_id = str(uuid.uuid4())
    actor_id = uid(user)
    actor_name = (user or {}).get("name") or (user or {}).get("email") or "Kullanıcı"
    doc = {
        "_id": req_id,
        "company_id": company_id,
        "kind": kind,
        "payload": payload,
        "account_ids": [a for a in account_ids if a],
        "summary": summary,
        "requested_by": actor_id,
        "requested_by_name": actor_name,
        "requested_by_email": (user or {}).get("email"),
        "status": "pending",
        "created_at": _now(),
    }
    await db.cash_approval_requests.insert_one(doc)
    import notify as _notify
    await _notify.insert_notification(db, {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "type": "cash_approval",
        "title": "Kasa/banka işlemi onay bekliyor",
        "message": f"{actor_name}: {summary}. Diğer yöneticinin onayı gerekli.",
        "ref_type": "cash_approval",
        "ref_id": req_id,
        "link": "/banking?tab=partners" if kind != "virman" else "/banking",
        "is_read": False,
        "created_at": _now(),
    })
    return {
        "status": "pending_approval",
        "request_id": req_id,
        "kind": kind,
        "message": "İşlem kaydedildi; diğer yöneticinin onayı bekleniyor. Para henüz hareket etmedi.",
    }


async def maybe_queue(db, *, company_id: str, kind: str, payload: dict, account_ids: List[Optional[str]],
                     summary: str, user: dict) -> Optional[dict]:
    if not await enabled(db, company_id):
        return None
    return await queue(db, company_id=company_id, kind=kind, payload=payload, account_ids=account_ids,
                       summary=summary, user=user)


def public_row(doc: dict, user: dict) -> dict:
    row = dict(doc)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    row.pop("payload", None)
    actor = uid(user)
    row["is_own"] = bool(actor and actor == row.get("requested_by"))
    row["kind_label"] = KIND_LABELS.get(row.get("kind"), row.get("kind"))
    return row
