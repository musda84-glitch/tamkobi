"""Depo sevkiyat / sipariş toplama: barkod eşleştirme, eksik bildirimi, kısmi teslimat, üretime alma."""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

import attendance

router = APIRouter(prefix="/api")
_db = None
_create_production_order = None

PICKABLE = {"pending", "approved", "preparing", "new"}
DONE_PICK = {"shipped", "completed", "cancelled", "returned", "partially_returned"}


def init(db, deps: Optional[dict] = None):
    global _db, _create_production_order
    _db = db
    if deps:
        _create_production_order = deps.get("create_production_order")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    if not d:
        return d
    d = dict(d)
    if "_id" in d:
        d["id"] = str(d.pop("_id"))
    return d


def _norm(v) -> str:
    return str(v or "").strip().lower()


async def _product_by_code(company_id: str, code: str) -> Optional[dict]:
    raw = (code or "").strip()
    if not raw:
        return None
    p = await _db.products.find_one({"company_id": company_id, "barcode": raw})
    if p:
        return p
    p = await _db.products.find_one({"company_id": company_id, "sku": raw})
    if p:
        return p
    p = await _db.products.find_one({"company_id": company_id, "variants.barcode": raw})
    if p:
        return p
    p = await _db.products.find_one({"company_id": company_id, "variants.sku": raw})
    return p


async def _enrich_items(company_id: str, order_items: list) -> List[dict]:
    out = []
    for it in order_items or []:
        pid = it.get("product_id")
        prod = await _db.products.find_one({"_id": pid}) if pid else None
        if not prod:
            prod = await _product_by_code(company_id, it.get("sku") or "") or await _product_by_code(company_id, it.get("barcode") or "")
        barcode = it.get("barcode") or (prod or {}).get("barcode") or ""
        sku = it.get("sku") or (prod or {}).get("sku") or ""
        extra = []
        for v in (prod or {}).get("variants") or []:
            if v.get("barcode"):
                extra.append(str(v["barcode"]))
            if v.get("sku"):
                extra.append(str(v["sku"]))
        ordered = float(it.get("quantity") or 0)
        out.append({
            "product_id": pid or (prod or {}).get("_id"),
            "product_name": it.get("product_name") or it.get("name") or (prod or {}).get("name") or "Kalem",
            "sku": sku,
            "barcode": barcode,
            "codes": [c for c in {barcode, sku, *extra} if c],
            "ordered_qty": ordered,
            "picked_qty": 0.0,
            "image_url": it.get("image_url") or (prod or {}).get("image_url"),
        })
    return out


def _progress(items: list) -> dict:
    ordered = sum(float(i.get("ordered_qty") or 0) for i in items)
    picked = sum(min(float(i.get("picked_qty") or 0), float(i.get("ordered_qty") or 0)) for i in items)
    missing = [i for i in items if float(i.get("picked_qty") or 0) + 1e-9 < float(i.get("ordered_qty") or 0)]
    return {
        "ordered": ordered,
        "picked": picked,
        "missing_lines": len(missing),
        "complete": not missing and ordered > 0,
    }


async def _session_for(order: dict, create: bool = True) -> dict:
    sid_order = order["_id"]
    ses = await _db.order_pick_sessions.find_one({"order_id": sid_order, "status": {"$nin": ["shipped"]}})
    if ses:
        return ses
    if not create:
        raise HTTPException(status_code=404, detail="Toplama oturumu yok.")
    items = await _enrich_items(order["company_id"], order.get("items") or [])
    ses = {
        "_id": str(uuid.uuid4()),
        "company_id": order["company_id"],
        "order_id": sid_order,
        "order_number": order.get("order_number"),
        "customer_name": order.get("customer_name"),
        "city": order.get("city"),
        "status": "open",
        "items": items,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await _db.order_pick_sessions.insert_one(ses)
    await _db.orders.update_one({"_id": sid_order}, {"$set": {"pick_status": "open", "pick_session_id": ses["_id"]}})
    return ses


def _public(ses: dict, order: Optional[dict] = None) -> dict:
    d = _clean(ses)
    d["progress"] = _progress(ses.get("items") or [])
    if order:
        d["order_status"] = order.get("order_status")
        d["shipping_address"] = order.get("shipping_address")
        d["customer_phone"] = order.get("customer_phone")
    return d


@router.get("/order-picks")
async def list_pickable(company_id: Optional[str] = "comp_nexus_main_01"):
    orders = await _db.orders.find({"company_id": company_id, "order_status": {"$in": list(PICKABLE)}}).sort("order_date", -1).to_list(200)
    sessions = {s["order_id"]: s for s in await _db.order_pick_sessions.find({"company_id": company_id, "order_id": {"$in": [o["_id"] for o in orders]}}).to_list(200)}
    rows = []
    for o in orders:
        ses = sessions.get(o["_id"])
        items = (ses or {}).get("items") or []
        prog = _progress(items) if items else {"ordered": sum(float(i.get("quantity") or 0) for i in o.get("items") or []), "picked": 0, "missing_lines": len(o.get("items") or []), "complete": False}
        rows.append({
            "id": o["_id"],
            "order_number": o.get("order_number"),
            "customer_name": o.get("customer_name"),
            "city": o.get("city"),
            "order_status": o.get("order_status"),
            "pick_status": (ses or {}).get("status") or o.get("pick_status") or "idle",
            "item_count": len(o.get("items") or []),
            "progress": prog,
            "order_date": o.get("order_date"),
        })
    return rows


@router.get("/order-picks/{order_id}")
async def open_pick(order_id: str):
    o = await _db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    if o.get("order_status") in DONE_PICK:
        raise HTTPException(status_code=400, detail="Bu sipariş sevk/iptal durumunda, toplanamaz.")
    ses = await _session_for(o, create=True)
    return _public(ses, o)


def _match_line(items: list, code: str, product: Optional[dict]) -> Optional[dict]:
    n = _norm(code)
    for it in items:
        codes = [_norm(c) for c in (it.get("codes") or [])] + [_norm(it.get("barcode")), _norm(it.get("sku"))]
        if n and n in codes:
            return it
        if product and it.get("product_id") and str(it["product_id"]) == str(product.get("_id")):
            return it
    return None


@router.post("/order-picks/{order_id}/scan")
async def scan_pick(order_id: str, req: Dict[str, Any]):
    o = await _db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    ses = await _session_for(o, create=True)
    code = str(req.get("barcode") or "").strip()
    qty = float(req.get("quantity") or 1)
    if qty <= 0:
        qty = 1
    if not code:
        raise HTTPException(status_code=400, detail="Barkod boş.")
    prod = await _product_by_code(o["company_id"], code)
    line = _match_line(ses["items"], code, prod)
    if not line:
        raise HTTPException(status_code=404, detail=f"Bu barkod siparişte yok: {code}")
    ordered = float(line.get("ordered_qty") or 0)
    picked = float(line.get("picked_qty") or 0)
    if picked + qty > ordered + 1e-9:
        raise HTTPException(status_code=400, detail=f"{line['product_name']}: sipariş {ordered:g} adet, {picked:g} okutuldu. Fazla okutmayın.")
    line["picked_qty"] = round(picked + qty, 3)
    if o.get("order_status") == "pending":
        await _db.orders.update_one({"_id": order_id}, {"$set": {"order_status": "preparing"}})
        o["order_status"] = "preparing"
    await _db.order_pick_sessions.update_one({"_id": ses["_id"]}, {"$set": {"items": ses["items"], "status": "picking", "updated_at": _now(), "last_scan": code}})
    await _db.orders.update_one({"_id": order_id}, {"$set": {"pick_status": "picking", "order_status": o["order_status"]}})
    return {**_public(ses, o), "matched": line["product_name"], "message": f"{line['product_name']} · {line['picked_qty']:g}/{ordered:g}"}


@router.post("/order-picks/{order_id}/adjust")
async def adjust_pick(order_id: str, req: Dict[str, Any]):
    o = await _db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    ses = await _session_for(o, create=True)
    pid = str(req.get("product_id") or "")
    name = str(req.get("product_name") or "")
    qty = float(req.get("picked_qty") if req.get("picked_qty") is not None else 0)
    line = next((i for i in ses["items"] if (pid and str(i.get("product_id")) == pid) or (name and i.get("product_name") == name)), None)
    if not line:
        raise HTTPException(status_code=404, detail="Kalem bulunamadı.")
    ordered = float(line.get("ordered_qty") or 0)
    line["picked_qty"] = max(0.0, min(qty, ordered))
    await _db.order_pick_sessions.update_one({"_id": ses["_id"]}, {"$set": {"items": ses["items"], "updated_at": _now()}})
    return _public(ses, o)


@router.post("/order-picks/{order_id}/notify-missing")
async def notify_missing(order_id: str):
    o = await _db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    ses = await _session_for(o, create=True)
    missing = [i for i in ses["items"] if float(i.get("picked_qty") or 0) + 1e-9 < float(i.get("ordered_qty") or 0)]
    if not missing:
        return {"status": "ok", "message": "Eksik kalem yok.", "missing": []}
    lines = ", ".join(f"{i['product_name']} ({float(i['picked_qty'] or 0):g}/{float(i['ordered_qty']):g})" for i in missing[:12])
    title = f"Depo eksik: {o.get('order_number')}"
    msg = f"{o.get('customer_name')} siparişi {o.get('order_number')} toplanırken eksik: {lines}"
    note = await attendance.notify_managers(o["company_id"], "order_pick_missing", title, msg, link=f"/sevk?order={order_id}")
    await _db.order_pick_sessions.update_one({"_id": ses["_id"]}, {"$set": {"notified_missing_at": _now(), "updated_at": _now()}})
    await _db.notifications.update_one({"title": title, "company_id": o["company_id"]}, {"$set": {"link": f"/sevk?order={order_id}", "ref_type": "order_pick", "ref_id": order_id}})
    return {"status": note.get("status"), "message": "Yöneticiye eksik kalemler bildirildi.", "missing": [{"product_name": i["product_name"], "picked": i["picked_qty"], "ordered": i["ordered_qty"]} for i in missing], "mail": note.get("mail")}


@router.post("/order-picks/{order_id}/to-production")
async def send_missing_to_production(order_id: str):
    if not _create_production_order:
        raise HTTPException(status_code=500, detail="Üretim bağlantısı yok.")
    o = await _db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    ses = await _session_for(o, create=True)
    created, skipped = [], []
    for i in ses["items"]:
        miss = float(i.get("ordered_qty") or 0) - float(i.get("picked_qty") or 0)
        if miss <= 1e-9:
            continue
        pid = i.get("product_id")
        if not pid:
            skipped.append({"product_name": i["product_name"], "reason": "stok kartı yok"})
            continue
        try:
            po = await _create_production_order({
                "company_id": o["company_id"],
                "finished_product_id": pid,
                "planned_quantity": miss,
                "source": "sales_order",
                "notes": f"Sipariş {o.get('order_number')} eksik {miss:g} adet",
            })
            created.append({"product_name": i["product_name"], "qty": miss, "order_code": po.get("order_code")})
        except HTTPException as e:
            skipped.append({"product_name": i["product_name"], "reason": str(e.detail)})
    if created:
        await _db.order_pick_sessions.update_one({"_id": ses["_id"]}, {"$set": {"production_orders": created, "updated_at": _now()}})
        await attendance.notify_managers(
            o["company_id"], "order_pick_production",
            f"Üretime alındı: {o.get('order_number')}",
            f"{len(created)} kalem üretime gönderildi: " + ", ".join(f"{c['product_name']} ({c['qty']:g})" for c in created),
            link="/atolye",
        )
    if not created and not skipped:
        return {"status": "ok", "message": "Eksik kalem yok.", "created": [], "skipped": []}
    msg = f"{len(created)} üretim emri açıldı." + (f" {len(skipped)} kalem atlandı." if skipped else "")
    return {"status": "ok", "message": msg, "created": created, "skipped": skipped}


@router.post("/order-picks/{order_id}/complete")
async def complete_pick(order_id: str, req: Dict[str, Any] = None):
    req = req or {}
    mode = (req.get("mode") or "ready").strip()  # ready | partial | ship
    if mode not in ("ready", "partial", "ship"):
        raise HTTPException(status_code=400, detail="mode ready, partial veya ship olmalı.")
    o = await _db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    ses = await _session_for(o, create=True)
    prog = _progress(ses["items"])
    if mode == "ship" and not prog["complete"] and not req.get("force"):
        raise HTTPException(status_code=400, detail="Tüm kalemler okutulmadan tam sevk yapılamaz. Kısmi teslim kullanın veya force=true.")
    pick_status = {"ready": "ready", "partial": "partial", "ship": "shipped"}[mode]
    order_status = {"ready": "preparing", "partial": "preparing", "ship": "shipped"}[mode]
    await _db.order_pick_sessions.update_one({"_id": ses["_id"]}, {"$set": {"status": pick_status, "completed_at": _now(), "updated_at": _now(), "complete_mode": mode}})
    await _db.orders.update_one({"_id": order_id}, {"$set": {"pick_status": pick_status, "order_status": order_status, "picked_at": _now()}})
    labels = {"ready": "Sipariş depoda hazır.", "partial": "Kısmi teslim kaydedildi; kalan kalemler sonra toplanabilir.", "ship": "Sipariş sevk edildi."}
    return {**_public(ses, {**o, "order_status": order_status}), "message": labels[mode]}
