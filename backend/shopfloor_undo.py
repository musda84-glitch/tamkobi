"""Bitirmeyi geri alma.

Stok silinmez; ters stock_movements yazılır. Üretim emri kapanışı,
mamul girişi, hammadde tüketimi ve sonraki adıma aktarılan plan,
finish anındaki görüntüden döner. İkinci çağrı aynı sonucu verir.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import company_audit
import idempotency
import shopfloor_accounts
import shopfloor_pin
import shopfloor_settings
import shopfloor_takeover
import tenant_access

router = APIRouter(prefix="/api")
_current_user = None

WINDOW = "undo_window_expired"
NEXT_STEP = "undo_next_step_started"
NOT_DONE = "Bitirme geri alınamaz."
FORBIDDEN = "Bu bitirmeyi yalnız aynı operatör veya yönetici geri alabilir."
IN_PROGRESS = "undo_in_progress"
RECIPE = "Tek seferlik reçete silindiği için geri alma kapalı."
COST = "Maliyet güncellemesi geri alınamadığı için bitirme geri alınamaz."
_STARTED = frozenset({"in_progress", "paused", "done"})
_BEFORE_KEYS = (
    "status",
    "produced_qty",
    "scrap_qty",
    "planned_quantity",
    "over_produced",
    "finished_at",
    "operator_name",
    "operator_employee_id",
    "material_stock_deducted",
    "material_stock_qty",
    "material_stock_product_id",
    "scrap_content",
    "scrap_content_unit",
    "scrap_reason_code",
    "scrap_reason_label",
    "scrap_reason_note",
    "finish_note",
    "finish_unit",
    "finish_is_material",
)
_ORDER_KEYS = (
    "status",
    "completed_quantity",
    "end_date",
    "shortages",
    "over_produced",
    "over_produced_qty",
    "under_produced",
    "under_produced_qty",
)


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
        raise HTTPException(status_code=500, detail="Geri alma bağlanmadı.")
    return await _current_user(request)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def capture_before(work_order: dict) -> dict:
    return {key: work_order.get(key) for key in _BEFORE_KEYS}


def order_slice(order: Optional[dict]) -> Optional[dict]:
    if not isinstance(order, dict):
        return None
    return {key: order.get(key) for key in _ORDER_KEYS}


def movement_slice(movement: dict) -> dict:
    return {
        "_id": movement.get("_id"),
        "company_id": movement.get("company_id"),
        "product_id": movement.get("product_id"),
        "product_name": movement.get("product_name"),
        "change": movement.get("change"),
        "reason": movement.get("reason"),
        "work_order_id": movement.get("work_order_id"),
        "order_id": movement.get("order_id"),
    }


def build(
    before: dict,
    movements: Optional[list] = None,
    *,
    order_before: Optional[dict] = None,
    order_touched: bool = False,
    next_before: Optional[dict] = None,
    next_touched: bool = False,
    update_cost: bool = False,
    previous_purchase_price: Any = None,
    finished_product_id: str = "",
    recipe_deleted: bool = False,
) -> dict:
    return {
        "wo_before": dict(before or {}),
        "movements": [movement_slice(item) for item in (movements or []) if isinstance(item, dict) and item.get("_id")],
        "order_before": order_slice(order_before) if order_before else None,
        "order_touched": bool(order_touched),
        "next_before": dict(next_before) if next_before else None,
        "next_touched": bool(next_touched),
        "update_cost": bool(update_cost),
        "previous_purchase_price": previous_purchase_price,
        "finished_product_id": str(finished_product_id or ""),
        "recipe_deleted": bool(recipe_deleted),
    }


def _is_admin(user: Any) -> bool:
    if not isinstance(user, dict):
        return False
    # Cihaz ve atölye oturumu, rol veya süper admin bayrağı taşısa da yönetici değildir.
    if shopfloor_accounts.is_atolye_user(user):
        return False
    if user.get("is_super_admin"):
        return True
    role = str(user.get("role") or "").strip().lower()
    return role in {"admin", "owner"}


def _same_operator(who: Any, work_order: dict) -> bool:
    eid = shopfloor_takeover.employee_id_of(who)
    row_eid = str(work_order.get("operator_employee_id") or "").strip()
    if eid and row_eid:
        return eid == row_eid
    name = str(who or "").strip()
    previous = str(work_order.get("operator_name") or "").strip()
    return bool(name) and name == previous


def _stored(work_order: dict) -> Optional[dict]:
    if not work_order.get("undo_id") or not work_order.get("undone_at"):
        return None
    undone = shopfloor_pin._parse_dt(work_order.get("undone_at"))
    finished = shopfloor_pin._parse_dt(work_order.get("finished_at"))
    if undone is not None and finished is not None and undone < finished:
        return None
    saved = work_order.get("undo_response")
    if isinstance(saved, dict) and saved.get("undo_id"):
        return saved
    return {
        "status": "success",
        "undo_id": work_order.get("undo_id"),
        "message": "Bitirme geri alındı.",
        "work_order_status": work_order.get("status"),
    }


async def _reverse_one(company_id: str, movement: dict, undo_id: str) -> bool:
    mid = str(movement.get("_id") or "")
    if not mid:
        return False
    current = await _db.stock_movements.find_one({"_id": mid, "company_id": company_id})
    if not current or current.get("reversed_by"):
        return False
    try:
        change = float(movement.get("change") if movement.get("change") is not None else current.get("change") or 0)
    except (TypeError, ValueError):
        change = 0.0
    rev_id = str(uuid.uuid4())
    claimed = await _db.stock_movements.update_one(
        {"_id": mid, "company_id": company_id, "reversed_by": {"$exists": False}},
        {"$set": {"reversed_by": rev_id, "undo_id": undo_id}},
    )
    if int(getattr(claimed, "modified_count", 0) or 0) != 1:
        return False
    now = utcnow().isoformat()
    await _db.stock_movements.insert_one({
        "_id": rev_id,
        "company_id": company_id,
        "product_id": current.get("product_id") or movement.get("product_id"),
        "product_name": current.get("product_name") or movement.get("product_name"),
        "change": -change,
        "reason": f"Üretim geri alma: {current.get('reason') or movement.get('reason') or ''}".strip()[:180],
        "date": now,
        "work_order_id": current.get("work_order_id") or movement.get("work_order_id"),
        "order_id": current.get("order_id") or movement.get("order_id"),
        "reverses": mid,
        "undo_id": undo_id,
    })
    product_id = str(current.get("product_id") or movement.get("product_id") or "")
    if product_id:
        await _db.products.update_one(
            {"_id": product_id, "company_id": company_id},
            {"$inc": {"stock_quantity": -change}},
        )
    return True


async def apply(wo_id: str, req: Optional[dict], user: dict, request: Optional[Request] = None) -> dict:
    cid = tenant_access.resolve_company_id(user, None)
    row = await _db.work_orders.find_one({"_id": wo_id, "company_id": cid})
    if not row:
        raise HTTPException(status_code=404, detail="İş emri bulunamadı.")
    shopfloor_accounts.enforce_station(user, row.get("station"))
    stored = _stored(row)
    if stored:
        return stored
    if str(row.get("status") or "") != "done":
        raise HTTPException(status_code=400, detail=NOT_DONE)
    who = await shopfloor_pin.resolve_operator(req or {}, user, row, request=request)
    if not _is_admin(user) and not _same_operator(who, row):
        raise HTTPException(status_code=403, detail=FORBIDDEN)
    company = await shopfloor_settings.load_company(_db, cid)
    minutes = shopfloor_settings.undo_minutes(company)
    finished = shopfloor_pin._parse_dt(row.get("finished_at"))
    if finished is None or utcnow() - finished > timedelta(minutes=minutes):
        raise HTTPException(status_code=409, detail={"code": WINDOW, "message": "Geri alma süresi doldu."})
    snap = row.get("finish_undo_snapshot") if isinstance(row.get("finish_undo_snapshot"), dict) else {}
    if snap.get("recipe_deleted"):
        raise HTTPException(status_code=409, detail={"code": "undo_recipe_deleted", "message": RECIPE})
    if snap.get("update_cost") and snap.get("previous_purchase_price") is None:
        raise HTTPException(status_code=409, detail={"code": "undo_cost_unknown", "message": COST})
    nxt = await _db.work_orders.find_one({
        "company_id": cid,
        "order_id": row.get("order_id"),
        "step_no": int(row.get("step_no") or 0) + 1,
    })
    if nxt and str(nxt.get("status") or "") in _STARTED:
        raise HTTPException(
            status_code=409,
            detail={"code": NEXT_STEP, "message": "Sonraki adım başladığı için geri alınamaz."},
        )
    undo_id = str(uuid.uuid4())
    claimed = await _db.work_orders.find_one_and_update(
        {
            "_id": wo_id,
            "company_id": cid,
            "status": "done",
            "undo_lock": {"$exists": False},
        },
        {"$set": {"undo_lock": undo_id}},
    )
    if not claimed:
        raise HTTPException(
            status_code=409,
            detail={"code": IN_PROGRESS, "message": "Geri alma sürüyor."},
        )
    try:
        for movement in snap.get("movements") or []:
            if isinstance(movement, dict):
                await _reverse_one(cid, movement, undo_id)
        next_before = snap.get("next_before") if isinstance(snap.get("next_before"), dict) else None
        if snap.get("next_touched") and next_before and next_before.get("_id"):
            await _db.work_orders.update_one(
                {"_id": next_before.get("_id"), "company_id": cid},
                {"$set": {
                    "status": next_before.get("status"),
                    "planned_quantity": next_before.get("planned_quantity"),
                }},
            )
        if snap.get("order_touched") and isinstance(snap.get("order_before"), dict) and row.get("order_id"):
            await _db.production_orders.update_one(
                {"_id": row.get("order_id"), "company_id": cid},
                {"$set": dict(snap.get("order_before") or {})},
            )
        if snap.get("update_cost") and snap.get("finished_product_id"):
            await _db.products.update_one(
                {"_id": snap.get("finished_product_id"), "company_id": cid},
                {"$set": {"purchase_price": snap.get("previous_purchase_price")}},
            )
        before = snap.get("wo_before") if isinstance(snap.get("wo_before"), dict) else {}
        restored = str(before.get("status") or "in_progress")
        now = utcnow().isoformat()
        response = {
            "status": "success",
            "undo_id": undo_id,
            "message": "Bitirme geri alındı.",
            "work_order_status": restored,
        }
        patch = {key: before.get(key) for key in _BEFORE_KEYS}
        patch["status"] = restored
        patch["undone_at"] = now
        patch["undo_id"] = undo_id
        patch["undo_response"] = response
        await _db.work_orders.update_one(
            {"_id": wo_id, "company_id": cid},
            {
                "$set": patch,
                "$unset": {"undo_lock": ""},
                "$push": {"logs": {
                    "at": now,
                    "action": "undo_finish",
                    "by": str(who or ""),
                    "note": f"geri alma {undo_id}",
                }},
            },
        )
        await shopfloor_pin.record_wo_action(user, row, who)
        await company_audit.write(
            _db,
            company_id=cid,
            user=user if isinstance(user, dict) else None,
            module="/atolye",
            action="restore",
            record_id=wo_id,
            record_label=str(row.get("step_name") or ""),
            record_no=str(row.get("order_code") or ""),
            summary="Bitirme geri alındı",
            path=f"/api/production/work-orders/{wo_id}/undo-finish",
        )
        return response
    except Exception:
        await _db.work_orders.update_one(
            {"_id": wo_id, "company_id": cid, "undo_lock": undo_id},
            {"$unset": {"undo_lock": ""}},
        )
        raise


@router.post("/production/work-orders/{wo_id}/undo-finish")
async def undo_finish(
    wo_id: str,
    req: Optional[dict] = None,
    request: Request = None,
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(user, None)

    async def _run():
        return await apply(wo_id, req, user, request)

    return await idempotency.run(
        _db, cid, request, f"/production/work-orders/{wo_id}/undo-finish", _run,
    )
