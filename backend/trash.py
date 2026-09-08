"""Çöp kutusu: silinen kayıtlar 30 gün saklanır, geri getirilebilir veya kalıcı silinebilir."""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api")
_db = None
_hooks: Dict[str, Callable[[dict, list], Awaitable[None]]] = {}
RETENTION_DAYS = 30

TYPE_LABELS = {"contact": "Cari Hesap", "product": "Ürün / Stok Kartı", "order": "Sipariş", "quote": "Teklif", "project": "Proje", "survey": "Keşif", "expense": "Masraf", "loan": "Kredi", "cheque": "Çek / Senet",
               "bank_transaction": "Banka / Kasa Hareketi", "bank_account": "Banka / Kasa Hesabı", "partner": "Ortak", "partner_transaction": "Ortak Hareketi", "leave": "İzin Talebi", "bonus": "Prim / Avans / 2. Maaş",
               "recipe": "Reçete (BOM)", "production_order": "Üretim Emri", "stock_count": "Stok Sayımı", "shift": "Vardiya", "shift_template": "Vardiya Şablonu", "trade_file": "İthalat / İhracat Dosyası", "invoice": "Fatura"}
PREVIEW_FIELDS = ("name", "customer_name", "contact_name", "partner_name", "employee_name", "product_name", "sku", "barcode", "order_number", "quote_number", "project_number", "survey_number", "expense_number",
                  "invoice_number", "description", "category", "amount", "total", "total_amount", "grand_total", "stock_quantity", "sale_price", "status", "order_status", "payment_status", "date", "order_date", "start_date", "end_date", "channel", "type")


def init(db):
    global _db
    _db = db


def register_hook(entity_type: str, fn: Callable[[dict, list], Awaitable[None]]):
    _hooks[entity_type] = fn


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def stash(collection: str, doc: dict, entity_type: str, label: str, related: Optional[List[dict]] = None, note: str = "", deleted_by: Optional[str] = None) -> str:
    now = _now()
    rec = {"_id": str(uuid.uuid4()), "collection": collection, "entity_type": entity_type, "label": label or doc.get("_id"), "company_id": doc.get("company_id"), "doc": doc,
           "related": related or [], "note": note, "deleted_by": deleted_by, "deleted_at": now.isoformat(), "expires_at": (now + timedelta(days=RETENTION_DAYS)).isoformat()}
    await _db.trash.insert_one(rec)
    return rec["_id"]


async def soft_delete(collection: str, doc: dict, entity_type: str, label: str, related: Optional[List[dict]] = None, note: str = "") -> str:
    """Belgeyi çöp kutusuna taşır ve koleksiyondan siler. related: [{"collection", "docs"}]."""
    tid = await stash(collection, doc, entity_type, label, related, note)
    await _db[collection].delete_one({"_id": doc["_id"]})
    for r in related or []:
        ids = [d["_id"] for d in r.get("docs") or []]
        if ids:
            await _db[r["collection"]].delete_many({"_id": {"$in": ids}})
    return tid


async def purge_expired(company_id: Optional[str] = None) -> int:
    q: Dict[str, Any] = {"expires_at": {"$lt": _now().isoformat()}}
    if company_id:
        q["company_id"] = company_id
    r = await _db.trash.delete_many(q)
    return r.deleted_count


def _summary(rec: dict) -> dict:
    doc = rec.get("doc") or {}
    preview = {k: doc[k] for k in PREVIEW_FIELDS if doc.get(k) not in (None, "", [], {})}
    try:
        days_left = max(0, (datetime.fromisoformat(rec["expires_at"]) - _now()).days)
    except (KeyError, ValueError):
        days_left = 0
    return {"id": rec["_id"], "entity_type": rec["entity_type"], "type_label": TYPE_LABELS.get(rec["entity_type"], rec["entity_type"]), "label": rec.get("label"), "collection": rec["collection"],
            "company_id": rec.get("company_id"), "deleted_at": rec.get("deleted_at"), "expires_at": rec.get("expires_at"), "days_left": days_left, "note": rec.get("note") or "",
            "related_count": sum(len(r.get("docs") or []) for r in rec.get("related") or []), "has_side_effects": rec["entity_type"] in _hooks, "preview": preview, "original_id": doc.get("_id")}


@router.get("/trash")
async def list_trash(company_id: str = "comp_nexus_main_01", entity_type: Optional[str] = None, q: Optional[str] = None):
    await purge_expired(company_id)
    query: Dict[str, Any] = {"company_id": company_id}
    if entity_type:
        query["entity_type"] = entity_type
    items = [_summary(r) for r in await _db.trash.find(query).sort("deleted_at", -1).to_list(2000)]
    if q:
        ql = q.strip().lower()
        items = [i for i in items if ql in (i["label"] or "").lower() or ql in i["type_label"].lower() or any(ql in str(v).lower() for v in i["preview"].values())]
    counts: Dict[str, int] = {}
    async for r in _db.trash.find({"company_id": company_id}, {"entity_type": 1}):
        counts[r["entity_type"]] = counts.get(r["entity_type"], 0) + 1
    return {"items": items, "total": sum(counts.values()), "retention_days": RETENTION_DAYS,
            "types": [{"key": k, "label": TYPE_LABELS.get(k, k), "count": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]}


@router.get("/trash/{trash_id}")
async def get_trash_item(trash_id: str):
    rec = await _db.trash.find_one({"_id": trash_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Kayıt çöp kutusunda bulunamadı.")
    doc = dict(rec.get("doc") or {})
    doc["id"] = doc.pop("_id", None)
    return {**_summary(rec), "doc": doc}


@router.post("/trash/{trash_id}/restore")
async def restore_trash_item(trash_id: str):
    rec = await _db.trash.find_one({"_id": trash_id})
    if not rec:
        raise HTTPException(status_code=404, detail="Kayıt çöp kutusunda bulunamadı.")
    coll, doc = rec["collection"], rec["doc"]
    if await _db[coll].find_one({"_id": doc["_id"]}):
        raise HTTPException(status_code=409, detail="Aynı kimlikte bir kayıt zaten mevcut; geri getirilemez.")
    await _db[coll].insert_one(doc)
    restored_related = 0
    for r in rec.get("related") or []:
        for d in r.get("docs") or []:
            if not await _db[r["collection"]].find_one({"_id": d["_id"]}):
                await _db[r["collection"]].insert_one(d)
                restored_related += 1
    hook = _hooks.get(rec["entity_type"])
    if hook:
        try:
            await hook(doc, rec.get("related") or [])
        except HTTPException as e:
            await _db[coll].delete_one({"_id": doc["_id"]})
            for r in rec.get("related") or []:
                await _db[r["collection"]].delete_many({"_id": {"$in": [d["_id"] for d in r.get("docs") or []]}})
            raise HTTPException(status_code=400, detail=f"Geri getirilemedi: {e.detail}")
    await _db.trash.delete_one({"_id": trash_id})
    label = TYPE_LABELS.get(rec["entity_type"], rec["entity_type"])
    return {"status": "success", "entity_type": rec["entity_type"], "id": str(doc["_id"]), "message": f"{label} geri getirildi: {rec.get('label')}" + (f" (+{restored_related} bağlı kayıt)" if restored_related else "") + (" — bakiye etkileri yeniden uygulandı." if hook else ".")}


@router.delete("/trash/{trash_id}")
async def purge_trash_item(trash_id: str):
    r = await _db.trash.delete_one({"_id": trash_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Kayıt çöp kutusunda bulunamadı.")
    return {"status": "success", "message": "Kayıt kalıcı olarak silindi."}


@router.post("/trash/empty")
async def empty_trash(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    q: Dict[str, Any] = {"company_id": company_id}
    if req.get("entity_type"):
        q["entity_type"] = req["entity_type"]
    r = await _db.trash.delete_many(q)
    return {"status": "success", "deleted": r.deleted_count, "message": f"{r.deleted_count} kayıt kalıcı olarak silindi."}
