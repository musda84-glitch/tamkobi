"""Ara sayım: devam eden işte biriken sağlam adet.

Her giriş ayrı satırdır. Idempotency-Key aynı şirkette ikinci kez
sayımı artırmaz. Negatif ve plan aşımı reddedilir.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import company_audit
import idempotency
import production_work_orders as pwo
import shopfloor_accounts
import shopfloor_pin
import shopfloor_takeover
import tenant_access

router = APIRouter(prefix="/api")
_current_user = None

NOT_RUNNING = "Sadece devam eden işte ara sayım girilir."
NOT_POSITIVE = "Miktar sıfırdan büyük olmalı."
NEGATIVE = "Miktar negatif olamaz."
OVER = "Miktar planı aşamaz."


class _LiveDB:
    def __getattr__(self, name):
        import server
        return getattr(server.db, name)

    def __getitem__(self, name):
        import server
        return server.db[name]


_db = _LiveDB()


def init(db, get_current_user) -> None:
    global _current_user
    _current_user = get_current_user
    if db is None:
        return


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Ara sayım bağlanmadı.")
    return await _current_user(request)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def total_of(work_order: Optional[dict]) -> float:
    try:
        return float((work_order or {}).get("partial_qty_total") or 0)
    except (TypeError, ValueError):
        return 0.0


def _planned(work_order: dict) -> float:
    try:
        return float(work_order.get("planned_quantity") or 0)
    except (TypeError, ValueError):
        return 0.0


def normalize_qty(raw: Any, unit: str) -> float:
    try:
        qty = float(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=NOT_POSITIVE)
    if qty < 0:
        raise HTTPException(status_code=400, detail=NEGATIVE)
    if qty <= 0:
        raise HTTPException(status_code=400, detail=NOT_POSITIVE)
    if pwo.is_discrete_unit(unit):
        qty = float(pwo.round_needed_qty(qty, unit))
    return qty


def _log(work_order: dict, who: Any, note: str) -> dict:
    return {
        "at": _now(),
        "action": "partial_count",
        "by": str(who or work_order.get("operator_name") or ""),
        "note": note,
    }


def _response(work_order: dict, entry: dict, *, replay: bool = False) -> dict:
    return {
        "status": "success",
        "partial_qty_total": total_of(work_order),
        "entry": {
            "id": entry.get("id"),
            "qty": entry.get("qty"),
            "at": entry.get("at"),
            "employee_id": entry.get("employee_id"),
            "device_id": entry.get("device_id"),
        },
        "work_order_id": work_order.get("_id"),
        "replay": replay,
    }


async def _load(wo_id: str, user: dict) -> dict:
    cid = tenant_access.resolve_company_id(user, None)
    row = await _db.work_orders.find_one({"_id": wo_id, "company_id": cid})
    if not row:
        raise HTTPException(status_code=404, detail="İş emri bulunamadı.")
    return row


async def apply(wo_id: str, req: Optional[dict], user: dict, request: Optional[Request] = None) -> dict:
    body = req or {}
    row = await _load(wo_id, user)
    cid = str(row.get("company_id") or "")
    shopfloor_accounts.enforce_station(user, row.get("station"))
    who = await shopfloor_pin.resolve_operator(body, user, row, request=request)
    key = idempotency.header_key(request)
    if key:
        for entry in row.get("partial_counts") or []:
            if isinstance(entry, dict) and str(entry.get("idempotency_key") or "") == key:
                return _response(row, entry, replay=True)
    if str(row.get("status") or "") != "in_progress":
        raise HTTPException(status_code=400, detail=NOT_RUNNING)
    unit = str(row.get("unit") or "Adet")
    qty = normalize_qty(body.get("qty", body.get("quantity")), unit)
    planned = _planned(row)
    current = total_of(row)
    if planned > 0 and current + qty > planned + 1e-9:
        raise HTTPException(status_code=400, detail=OVER)
    new_total = current + qty
    entry = {
        "id": str(uuid.uuid4()),
        "qty": qty,
        "at": _now(),
        "employee_id": shopfloor_takeover.employee_id_of(who),
        "operator_name": str(who or ""),
        "device_id": shopfloor_takeover.device_id_of(user),
        "idempotency_key": key,
    }
    await _db.work_orders.update_one(
        {"_id": wo_id, "company_id": cid},
        {
            "$set": {"partial_qty_total": new_total, "company_id": cid},
            "$push": {
                "partial_counts": entry,
                "logs": _log(row, who, f"+{qty:g} toplam {new_total:g}"),
            },
        },
    )
    await shopfloor_pin.record_wo_action(user, row, who)
    await company_audit.write(
        _db,
        company_id=cid,
        user=user if isinstance(user, dict) else None,
        module="/atolye",
        action="update",
        record_id=wo_id,
        record_label=str(row.get("step_name") or ""),
        record_no=str(row.get("order_code") or ""),
        summary=f"Ara sayım {qty:g}, toplam {new_total:g}",
        path=f"/api/production/work-orders/{wo_id}/partial-count",
    )
    fresh = await _db.work_orders.find_one({"_id": wo_id, "company_id": cid}) or {**row, "partial_qty_total": new_total}
    return _response(fresh, entry, replay=False)


@router.post("/production/work-orders/{wo_id}/partial-count")
async def partial_count(
    wo_id: str,
    req: Optional[dict] = None,
    request: Request = None,
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(user, None)

    async def _run():
        return await apply(wo_id, req, user, request)

    return await idempotency.run(
        _db, cid, request, f"/production/work-orders/{wo_id}/partial-count", _run,
    )
