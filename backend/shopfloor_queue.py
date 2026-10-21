"""Sıradaki iş: cihaz istasyonuna göre sıralı atölye kuyruğu.

Sıra: operatörün devam eden/duraklatılmış işi, sonra ready, sonra waiting
(önceki adım bitmedi). Kova içinde plan tarihi, öncelik, sipariş no, adım.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import production_work_orders as pwo
import shopfloor_accounts
import shopfloor_operators
import shopfloor_pin
import tenant_access

router = APIRouter(prefix="/api")
_current_user = None

_MINE = ("in_progress", "paused")
_OPEN = ("in_progress", "paused", "ready", "waiting")


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
        raise HTTPException(status_code=500, detail="Atölye kuyruğu bağlanmadı.")
    return await _current_user(request)


def _priority(row: dict, orders: dict) -> int:
    raw = row.get("priority")
    if raw is None or raw == "":
        raw = (orders.get(row.get("order_id")) or {}).get("priority")
    if raw is None or raw == "":
        return 100
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 100


def _mine(row: dict, employee_id: str, name: str) -> bool:
    if str(row.get("status") or "") not in _MINE:
        return False
    row_eid = str(row.get("operator_employee_id") or "").strip()
    if employee_id and row_eid:
        return row_eid == employee_id
    if employee_id and not row_eid:
        return bool(name) and str(row.get("operator_name") or "").strip() == name
    return bool(name) and str(row.get("operator_name") or "").strip() == name


def _bucket(row: dict, employee_id: str, name: str) -> int:
    status = str(row.get("status") or "")
    if _mine(row, employee_id, name):
        return 0
    if status == "ready":
        return 1
    if status == "waiting":
        return 2
    return 9


def has_drawing(row: dict) -> bool:
    if str(row.get("drawing_file_id") or "").strip():
        return True
    images = row.get("images") or []
    return bool(images)


def sort_queue(rows: list, employee_id: str = "", name: str = "", orders: Optional[dict] = None) -> list:
    orders = orders or {}
    kept = []
    for row in rows or []:
        if _bucket(row, employee_id, name) == 9:
            continue
        if str(row.get("status") or "") not in _OPEN:
            continue
        kept.append(row)
    kept.sort(key=lambda row: (
        _bucket(row, employee_id, name),
        str(row.get("planned_date") or "9999-99-99"),
        _priority(row, orders),
        str(row.get("order_code") or ""),
        int(row.get("step_no") or 0),
    ))
    return kept


def _public_text(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def public_row(row: dict, orders: Optional[dict] = None) -> dict:
    orders = orders or {}
    status = str(row.get("status") or "")
    return {
        "id": row.get("_id") or row.get("id"),
        "order_id": row.get("order_id"),
        "order_code": row.get("order_code"),
        "planned_date": row.get("planned_date"),
        "product_name": row.get("product_name"),
        "step_name": row.get("step_name"),
        "step_no": row.get("step_no"),
        "quantity": row.get("planned_quantity"),
        "planned_quantity": row.get("planned_quantity"),
        "unit": row.get("unit") or "Adet",
        "status": status,
        "has_drawing": has_drawing(row),
        "previous_step_pending": status == "waiting",
        "station": row.get("station"),
        "priority": _priority(row, orders),
        "operator_name": row.get("operator_name"),
        "operator_employee_id": row.get("operator_employee_id"),
        "recipe_id": _public_text(row.get("recipe_id")),
        "recipe_name": _public_text(row.get("recipe_name")),
        "customer_name": _public_text(row.get("customer_name")),
        "project_id": _public_text(row.get("project_id")),
        "project_name": _public_text(row.get("project_name")),
        "sales_order_no": _public_text(row.get("sales_order_no")),
        "job_file_name": _public_text(row.get("job_file_name")),
    }


_ORDER_PROJ = {
    "status": 1,
    "priority": 1,
    "company_id": 1,
    "recipe_id": 1,
    "recipe_name": 1,
    "project_id": 1,
    "project_number": 1,
    "sales_order_id": 1,
    "sales_order_no": 1,
    "customer_id": 1,
    "customer_name": 1,
}


async def _fill_queue_link_fields(rows: list, company_id: str, orders: dict) -> None:
    """Eksik proje / sipariş / reçete alanlarını yanıt kopyasına yaz. Koleksiyona yazmaz."""
    project_ids = []
    recipe_ids = []
    for row in rows:
        order = orders.get(row.get("order_id")) or {}
        for src in (row, order):
            pid = str(src.get("project_id") or "").strip()
            rid = str(src.get("recipe_id") or "").strip()
            if pid:
                project_ids.append(pid)
            if rid:
                recipe_ids.append(rid)
    project_ids = list(set(project_ids))
    recipe_ids = list(set(recipe_ids))
    projects = {}
    if project_ids:
        found = await _db.projects.find(
            {"company_id": company_id, "_id": {"$in": project_ids}},
            {"name": 1, "project_number": 1, "company_id": 1},
        ).to_list(len(project_ids) + 10)
        projects = {item.get("_id"): item for item in found if item.get("company_id") == company_id}
    recipes = {}
    if recipe_ids:
        found = await _db.recipes.find(
            {"company_id": company_id, "_id": {"$in": recipe_ids}},
            {"name": 1, "job_file_name": 1, "contact_name": 1, "company_id": 1},
        ).to_list(len(recipe_ids) + 10)
        recipes = {item.get("_id"): item for item in found if item.get("company_id") == company_id}
    for row in rows:
        order = orders.get(row.get("order_id")) or {}
        rid = str(order.get("recipe_id") or row.get("recipe_id") or "").strip()
        pid = str(order.get("project_id") or row.get("project_id") or "").strip()
        meta = pwo.recipe_job_fields(recipes.get(rid) or {})
        if not meta.get("recipe_name"):
            meta["recipe_name"] = order.get("recipe_name") or None
        link = pwo.order_link_meta(order, projects.get(pid) or {})
        if link.get("customer_name"):
            meta["customer_name"] = link["customer_name"]
        for key, val in link.items():
            if key != "customer_name" and val:
                meta[key] = val
        pwo.enrich_work_order_row(row, meta)


async def _open_shopfloor_rows(user: dict, station: Optional[str] = None, *, enforce: bool = False):
    cid = tenant_access.resolve_company_id(user, None)
    rows = await _db.work_orders.find(
        {"company_id": cid, "status": {"$in": list(_OPEN)}},
    ).to_list(500)
    order_ids = list({row.get("order_id") for row in rows if row.get("order_id")})
    orders = {}
    if order_ids:
        found = await _db.production_orders.find(
            {"company_id": cid, "_id": {"$in": order_ids}},
            _ORDER_PROJ,
        ).to_list(len(order_ids) + 10)
        orders = {
            item.get("_id"): item
            for item in found
            if item.get("status") != "cancelled" and item.get("company_id") == cid
        }
        rows = [row for row in rows if row.get("order_id") in orders]
    await _fill_queue_link_fields(rows, cid, orders)
    station_text = str(station or "").strip()
    if enforce and station_text:
        shopfloor_accounts.enforce_station(user, station)
    if shopfloor_accounts.is_atolye_user(user):
        rows = shopfloor_accounts.filter_work_orders_for_user(user, rows)
    if station_text and (enforce or not shopfloor_accounts.is_atolye_user(user)):
        want = shopfloor_operators.station_key(station)
        rows = [row for row in rows if shopfloor_operators.station_key(row.get("station")) == want]
    return rows, orders


async def _who(user: dict, company_id: str, request: Optional[Request]) -> Any:
    if shopfloor_accounts.is_atolye_user(user):
        if shopfloor_pin._extract_token(None, request):
            return await shopfloor_pin.resolve_operator(
                None, user, {"company_id": company_id}, request=request,
            )
        return None
    if isinstance(user, dict):
        return await shopfloor_pin.caller_display_name(user)
    return None


async def list_next(
    user: dict,
    request: Optional[Request] = None,
    station: Optional[str] = None,
    project_id: Optional[str] = None,
    recipe_id: Optional[str] = None,
) -> list:
    cid = tenant_access.resolve_company_id(user, None)
    who = await _who(user, cid, request)
    eid = shopfloor_takeover_employee(who)
    name = str(who or "").strip()
    rows, orders = await _open_shopfloor_rows(user, station, enforce=False)
    if project_id or recipe_id:
        rows = [
            row for row in rows
            if pwo.match_work_order_link_filter(row, project_id=project_id, recipe_id=recipe_id)
        ]
    ordered = sort_queue(rows, eid, name, orders)
    return [public_row(row, orders) for row in ordered]


async def list_filters(user: dict, station: Optional[str] = None) -> dict:
    """Görünen istasyonlardaki açık işlerin proje ve reçete sayıları."""
    rows, _orders = await _open_shopfloor_rows(user, station, enforce=True)
    return pwo.shopfloor_filter_catalog(rows)


def shopfloor_takeover_employee(who: Any) -> str:
    if getattr(who, "operator_type", "") == "employee":
        return str(getattr(who, "operator_id", "") or "").strip()
    return ""


@router.get("/production/work-orders/shopfloor-filters")
async def shopfloor_filters(
    station: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    return await list_filters(user, station)


@router.get("/production/work-orders/shopfloor-next")
async def shopfloor_next(
    request: Request,
    station: Optional[str] = None,
    project_id: Optional[str] = None,
    recipe_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    return await list_next(user, request, station, project_id=project_id, recipe_id=recipe_id)
