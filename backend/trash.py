"""Çöp kutusu: silinen kayıtlar 30 gün saklanır, geri getirilebilir veya kalıcı silinebilir."""
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import tenant_access

router = APIRouter(prefix="/api")
_db = None
_current_user = None
_hooks: Dict[str, Callable[[dict, list], Awaitable[None]]] = {}
RETENTION_DAYS = 30

TYPE_LABELS = {"contact": "Cari Hesap", "product": "Ürün / Stok Kartı", "order": "Sipariş", "purchase_order": "Verilen Sipariş", "quote": "Teklif", "project": "Proje", "survey": "Keşif", "expense": "Masraf", "loan": "Kredi", "cheque": "Çek / Senet",
               "bank_transaction": "Banka / Kasa Hareketi", "bank_account": "Banka / Kasa Hesabı", "partner": "Ortak", "partner_transaction": "Ortak Hareketi", "leave": "İzin Talebi", "bonus": "Prim / Avans / 2. Maaş", "payroll": "Bordro / Maaş",
               "employee": "Personel", "recipe": "Reçete (BOM)", "production_order": "Üretim Emri", "work_order": "İş Emri (Atölye)", "assigned_task": "Personel Görevi", "stock_count": "Stok Sayımı", "shift": "Vardiya", "shift_template": "Vardiya Şablonu", "trade_file": "İthalat / İhracat Dosyası", "invoice": "Fatura", "vehicle": "Araç"}
PREVIEW_FIELDS = ("name", "full_name", "customer_name", "contact_name", "partner_name", "employee_name", "product_name", "sku", "barcode", "order_number", "order_code", "quote_number", "project_number", "survey_number", "expense_number",
                  "invoice_number", "description", "category", "amount", "total", "total_amount", "grand_total", "stock_quantity", "sale_price", "status", "order_status", "payment_status", "date", "order_date", "start_date", "end_date", "channel", "type", "step_name", "station", "job_file_name", "plate", "brand", "model", "year")


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Trash auth bağlanmadı.")
    return await _current_user(request)


def register_hook(entity_type: str, fn: Callable[[dict, list], Awaitable[None]]):
    _hooks[entity_type] = fn


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def stash(collection: str, doc: dict, entity_type: str, label: str, related: Optional[List[dict]] = None, note: str = "", deleted_by: Optional[str] = None, restore_group: Optional[str] = None) -> str:
    now = _now()
    rec = {"_id": str(uuid.uuid4()), "collection": collection, "entity_type": entity_type, "label": label or doc.get("_id"), "company_id": doc.get("company_id"), "doc": doc,
           "related": related or [], "note": note, "deleted_by": deleted_by, "deleted_at": now.isoformat(), "expires_at": (now + timedelta(days=RETENTION_DAYS)).isoformat()}
    if restore_group:
        rec["restore_group"] = restore_group
    await _db.trash.insert_one(rec)
    return rec["_id"]


def _company_id_of(doc: Optional[dict]) -> Optional[str]:
    """Boş company_id yok sayılır; eski kayıtlarda sorguya eklenmez."""
    if not isinstance(doc, dict):
        return None
    cid = doc.get("company_id")
    if cid is None:
        return None
    text = str(cid).strip()
    return text or None


def _deleted_count(result) -> Optional[int]:
    """0 gerçekten sıfır satırdır. Sonuç yoksa veya sayı değilse None (eski sahte sürücüler)."""
    if result is None:
        return None
    count = getattr(result, "deleted_count", None)
    if count is None and isinstance(result, dict):
        count = result.get("deleted_count")
    if isinstance(count, bool) or count is None:
        return None
    try:
        return int(count)
    except (TypeError, ValueError):
        return None


async def _find_trash_for_original(collection: str, doc: dict):
    """Aynı özgün _id için duran çöp kaydı. Varsa yenisi yazılmaz."""
    original_id = doc.get("_id")
    if not original_id:
        return None
    cid = _company_id_of(doc)
    if cid:
        return await _db.trash.find_one({"collection": collection, "doc._id": original_id, "company_id": cid})
    # tenant-ok: company_id'siz eski kayıt çöpü paylaşılan katalogdadır
    return await _db.trash.find_one({"collection": collection, "doc._id": original_id})


async def _rollback_new_trash(trash_id: str, company_id: Optional[str]) -> None:
    if not trash_id:
        return
    try:
        if company_id:
            await _db.trash.delete_one({"_id": trash_id, "company_id": company_id})
        else:
            # tenant-ok: company_id'siz çöp satırı paylaşılan katalogdadır
            await _db.trash.delete_one({"_id": trash_id})
    except Exception:
        logging.getLogger(__name__).exception("Çöp kopyası geri alınamadı")


async def _delete_ids(collection: str, ids: List[Any], company_id: Optional[str]):
    """Dedicated yazma company_id ister. Yoksa eski _id sorgusu aynı kalır."""
    clean = [item for item in ids if item is not None]
    if not clean:
        return None
    if len(clean) == 1:
        if company_id:
            return await _db[collection].delete_one({"_id": clean[0], "company_id": company_id})
        # tenant-ok: company_id'siz eski kayıt paylaşılan katalogdan silinir
        return await _db[collection].delete_one({"_id": clean[0]})
    if company_id:
        return await _db[collection].delete_many({"_id": {"$in": clean}, "company_id": company_id})
    # tenant-ok: company_id'siz eski kayıtlar paylaşılan katalogdan silinir
    return await _db[collection].delete_many({"_id": {"$in": clean}})


def _ids_by_company(docs: List[dict], fallback: Optional[str] = None) -> Dict[Optional[str], List[Any]]:
    grouped: Dict[Optional[str], List[Any]] = {}
    for doc in docs or []:
        if not isinstance(doc, dict) or doc.get("_id") is None:
            continue
        grouped.setdefault(_company_id_of(doc) or fallback, []).append(doc["_id"])
    return grouped


class AlreadyTrashed(HTTPException):
    """Aynı özgün _id çöpte duruyor. Bu istek yeni silme değildir; bakiye iadesi yazılmaz."""

    def __init__(self):
        super().__init__(
            status_code=409,
            detail="Kayıt zaten çöp kutusunda. Bakiye yeniden işlenmedi.",
        )


async def original_in_trash(collection: str, doc: Optional[dict]) -> bool:
    """Aynı özgün _id için duran çöp kaydı var mı."""
    if _db is None or not isinstance(doc, dict) or doc.get("_id") is None:
        return False
    try:
        found = await _find_trash_for_original(collection, doc)
    except Exception:
        logging.getLogger(__name__).exception("Çöp kaydı okunamadı")
        return False
    return bool(isinstance(found, dict) and found.get("_id"))


async def refuse_repeat(collection: str, doc: dict) -> None:
    """Çöpte kayıt varsa canlı satırı temizler ve 409 verir. Yoksa bir şey yapmaz.

    Bakiye iadesi ancak bu fonksiyon döndükten ve soft_delete bu istekte satırı
    sildikten sonra yazılır. Tekrar silme iade yazmaz.
    """
    if not isinstance(doc, dict) or doc.get("_id") is None or not await original_in_trash(collection, doc):
        return
    try:
        await _delete_ids(collection, [doc.get("_id")], _company_id_of(doc))
    except Exception:
        logging.getLogger(__name__).exception("Tekrar silmede canlı satır kalkmadı")
        raise
    raise AlreadyTrashed()


async def soft_delete(collection: str, doc: dict, entity_type: str, label: str, related: Optional[List[dict]] = None, note: str = "", restore_group: Optional[str] = None) -> str:
    """Belgeyi çöp kutusuna taşır ve koleksiyondan siler. related: [{"collection", "docs"}].

    company_id varsa silme sorgusuna yazılır; dedicated depo ancak öyle seçilir.
    Silinen satır 0 ise yeni çöp kopyası bırakılmaz ve 409 döner.
    Aynı özgün _id çöpte varsa satır yeniden silinmiş sayılmaz (409); iade yazılmaz.
    """
    if not isinstance(doc, dict) or doc.get("_id") is None:
        raise HTTPException(status_code=409, detail="Kayıt silinemedi; belge kimliği yok.")
    await refuse_repeat(collection, doc)
    cid = _company_id_of(doc)
    tid = await stash(collection, doc, entity_type, label, related, note, restore_group=restore_group)
    try:
        result = await _delete_ids(collection, [doc["_id"]], cid)
    except Exception:
        await _rollback_new_trash(tid, cid)
        raise
    if _deleted_count(result) == 0:
        await _rollback_new_trash(tid, cid)
        raise HTTPException(status_code=409, detail="Kayıt silinemedi. Çöp kutusuna taşınmadı.")
    for block in related or []:
        grouped = _ids_by_company(block.get("docs") or [], cid)
        for rcid, ids in grouped.items():
            try:
                related_result = await _delete_ids(block["collection"], ids, rcid)
            except Exception:
                logging.getLogger(__name__).exception("Bağlı kayıt silinemedi")
                continue
            if _deleted_count(related_result) == 0:
                logging.getLogger(__name__).warning("Bağlı kayıt silinemedi: %s", block.get("collection"))
    return tid


async def purge_expired(company_id: Optional[str] = None) -> int:
    cid = str(company_id or "").strip()
    if not cid:
        return 0
    q: Dict[str, Any] = {"expires_at": {"$lt": _now().isoformat()}, "company_id": cid}
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
async def list_trash(company_id: Optional[str] = None, entity_type: Optional[str] = None, q: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    await purge_expired(cid)
    query: Dict[str, Any] = {"company_id": cid}
    if entity_type:
        query["entity_type"] = entity_type
    items = [_summary(r) for r in await _db.trash.find(query).sort("deleted_at", -1).to_list(2000)]
    if q:
        ql = q.strip().lower()
        items = [i for i in items if ql in (i["label"] or "").lower() or ql in i["type_label"].lower() or any(ql in str(v).lower() for v in i["preview"].values())]
    counts: Dict[str, int] = {}
    async for r in _db.trash.find({"company_id": cid}, {"entity_type": 1}):
        counts[r["entity_type"]] = counts.get(r["entity_type"], 0) + 1
    return {"items": items, "total": sum(counts.values()), "retention_days": RETENTION_DAYS,
            "types": [{"key": k, "label": TYPE_LABELS.get(k, k), "count": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]}


@router.get("/trash/{trash_id}")
async def get_trash_item(trash_id: str, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user)
    rec = await _db.trash.find_one({"_id": trash_id, "company_id": cid})
    if not rec:
        raise HTTPException(status_code=404, detail="Kayıt çöp kutusunda bulunamadı.")
    doc = dict(rec.get("doc") or {})
    doc["id"] = doc.pop("_id", None)
    return {**_summary(rec), "doc": doc}


async def _clear_sync_tombstones(collection: str, doc_ids: List[Any], company_id: Optional[str] = None) -> None:
    """Geri alınan kayıtların eski tombstone'larını sil — artımlı sync tekrar 'silindi' demesin."""
    ids = [str(i) for i in doc_ids if i is not None]
    cid = str(company_id or "").strip()
    if not ids or not cid or collection in ("sync_tombstones", "trash"):
        return
    try:
        await _db.sync_tombstones.delete_many({
            "collection": collection,
            "doc_id": {"$in": ids},
            "company_id": cid,
        })
    except Exception:
        logging.getLogger(__name__).exception("Beklenmeyen hata (trash.py)")


def _trash_company_id(rec: dict) -> Optional[str]:
    cid = rec.get("company_id") or (rec.get("doc") or {}).get("company_id")
    return str(cid) if cid is not None else None


async def _live_doc(collection: str, doc_id, company_id: Optional[str]):
    """Varlık kontrolü dedicated depoda company_id ile yapılır."""
    if company_id:
        return await _db[collection].find_one({"_id": doc_id, "company_id": company_id})
    # tenant-ok: company_id'siz eski kayıt paylaşılan katalogda aranır
    return await _db[collection].find_one({"_id": doc_id})


def _stamp_company(doc: dict, fallback: Optional[str]) -> Optional[str]:
    cid = _company_id_of(doc) or fallback
    if cid and not doc.get("company_id"):
        doc["company_id"] = cid
    return cid


async def _restore_one_trash_rec(rec: dict) -> tuple:
    """Tek çöp kaydını koleksiyona yazar. (inserted_doc, related_count, related_ids)."""
    coll, doc = rec["collection"], dict(rec["doc"] or {})
    if not doc.get("_id"):
        raise HTTPException(status_code=400, detail="Çöp kaydında belge kimliği yok; geri getirilemez.")
    cid = _stamp_company(doc, _company_id_of(rec))
    if await _live_doc(coll, doc["_id"], cid):
        raise HTTPException(status_code=409, detail="Aynı kimlikte bir kayıt zaten mevcut; geri getirilemez.")
    now = _now().isoformat()
    doc["restored_at"] = now
    doc["updated_at"] = now
    await _db[coll].insert_one(doc)
    restored_related = 0
    related_ids: List[tuple] = [(coll, doc["_id"])]
    for r in rec.get("related") or []:
        for d in r.get("docs") or []:
            rd = dict(d)
            if not rd.get("_id"):
                continue
            rcid = _stamp_company(rd, cid)
            if not await _live_doc(r["collection"], rd["_id"], rcid):
                rd["restored_at"] = now
                rd["updated_at"] = now
                await _db[r["collection"]].insert_one(rd)
                restored_related += 1
                related_ids.append((r["collection"], rd["_id"]))
    return doc, restored_related, related_ids


@router.post("/trash/{trash_id}/restore")
async def restore_trash_item(trash_id: str, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user)
    rec = await _db.trash.find_one({"_id": trash_id, "company_id": cid})
    if not rec:
        raise HTTPException(status_code=404, detail="Kayıt çöp kutusunda bulunamadı.")
    records = [rec]
    group = rec.get("restore_group")
    if group and cid:
        siblings = await _db.trash.find({
            "restore_group": group,
            "company_id": cid,
            "_id": {"$ne": trash_id},
        }).to_list(50)
        for sib in siblings:
            scid = _trash_company_id(sib)
            if scid is not None and not tenant_access.user_may_access_company(user, scid):
                continue
            records.append(sib)
    restored_docs = []
    restored_related = 0
    related_ids: List[tuple] = []
    for item in records:
        doc, rel_n, rel_ids = await _restore_one_trash_rec(item)
        restored_docs.append((item, doc))
        restored_related += rel_n
        related_ids.extend(rel_ids)
    for cname, did in related_ids:
        await _clear_sync_tombstones(cname, [did], cid)
    for item, doc in restored_docs:
        hook = _hooks.get(item["entity_type"])
        if not hook:
            continue
        try:
            await hook(doc, item.get("related") or [])
        except HTTPException as e:
            await _delete_ids(item["collection"], [doc["_id"]], _company_id_of(doc))
            for r in item.get("related") or []:
                for rcid, ids in _ids_by_company(r.get("docs") or [], _company_id_of(doc)).items():
                    await _delete_ids(r["collection"], ids, rcid)
            raise HTTPException(status_code=400, detail=f"Geri getirilemedi: {e.detail}")
    await _db.trash.delete_many({"_id": {"$in": [r["_id"] for r in records]}, "company_id": cid})
    label = TYPE_LABELS.get(rec["entity_type"], rec["entity_type"])
    extra = restored_related
    grouped = len(records) - 1
    suffix = ""
    if extra:
        suffix += f" (+{extra} bağlı kayıt)"
    if grouped:
        suffix += f" (+{grouped} ortak grup)"
    hook = _hooks.get(rec["entity_type"])
    return {"status": "success", "entity_type": rec["entity_type"], "id": str((rec.get("doc") or {}).get("_id")), "message": f"{label} geri getirildi: {rec.get('label')}" + suffix + (" — bakiye etkileri yeniden uygulandı." if hook else ".")}


@router.delete("/trash/{trash_id}")
async def purge_trash_item(trash_id: str, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user)
    rec = await _db.trash.find_one({"_id": trash_id, "company_id": cid})
    if not rec:
        raise HTTPException(status_code=404, detail="Kayıt çöp kutusunda bulunamadı.")
    r = await _db.trash.delete_one({"_id": trash_id, "company_id": cid})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Kayıt çöp kutusunda bulunamadı.")
    return {"status": "success", "message": "Kayıt kalıcı olarak silindi."}


@router.post("/trash/empty")
async def empty_trash(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    company_id = tenant_access.resolve_company_id(user, req.get("company_id"))
    q: Dict[str, Any] = {"company_id": company_id}
    if req.get("entity_type"):
        q["entity_type"] = req["entity_type"]
    r = await _db.trash.delete_many(q)
    return {"status": "success", "deleted": r.deleted_count, "message": f"{r.deleted_count} kayıt kalıcı olarak silindi."}
