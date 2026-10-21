"""İş emri teknik çizimi.

Üretim emri, reçete, ürün veya iş emrindeki dosya kaydı. Kısa ömürlü
imzalı URL döner. stream=1 içeriği akıtır. Başka şirket 404.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

import rbac
import shopfloor_accounts
import signed_links
import tenant_access

router = APIRouter(prefix="/api")
_current_user = None

NOT_FOUND = "Çizim bulunamadı."
TYPE_CODE = "drawing_type_rejected"
TTL_SEC = 15 * 60
ALLOWED_TYPES = frozenset({
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
})
_EXT = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "svg": "image/svg+xml",
}


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
        raise HTTPException(status_code=500, detail="Çizim servisi bağlanmadı.")
    return await _current_user(request)


def safe_storage_path(path: Any) -> str:
    raw = str(path or "").strip().replace("\\", "/")
    if not raw or raw.startswith("/") or ".." in raw.split("/"):
        return ""
    lowered = raw.split("?", 1)[0].strip("/")
    if lowered.startswith("api/files/"):
        lowered = lowered[len("api/files/"):]
    if ".." in lowered.split("/"):
        return ""
    try:
        norm = rbac.normalized_file_storage_path(lowered)
    except Exception:
        return ""
    if not norm or ".." in norm.split("/"):
        return ""
    return norm


def content_type_of(record: Optional[dict]) -> str:
    row = record or {}
    ct = str(row.get("content_type") or "").split(";")[0].strip().lower()
    if ct in ALLOWED_TYPES:
        return ct
    name = str(row.get("original_filename") or row.get("storage_path") or "")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return _EXT.get(ext, "")


def _storage_from_url(url: Any) -> str:
    text = str(url or "").strip()
    if "/api/files/" not in text:
        return ""
    return safe_storage_path(text.split("/api/files/", 1)[1])


async def _file_by_id(company_id: str, file_id: str) -> Optional[dict]:
    fid = str(file_id or "").strip()
    if not fid:
        return None
    return await _db.files.find_one({
        "_id": fid,
        "company_id": company_id,
        "is_deleted": {"$ne": True},
    })


async def _file_by_path(company_id: str, storage_path: str) -> Optional[dict]:
    path = safe_storage_path(storage_path)
    if not path:
        return None
    return await _db.files.find_one({
        "company_id": company_id,
        "storage_path": path,
        "is_deleted": {"$ne": True},
    })


async def _linked_files(company_id: str, entity_ids: list) -> list:
    ids = [str(item) for item in entity_ids if str(item or "").strip()]
    if not ids:
        return []
    return await _db.files.find({
        "company_id": company_id,
        "entity_id": {"$in": ids},
        "is_deleted": {"$ne": True},
    }).to_list(40)


async def resolve_record(work_order: dict) -> Optional[dict]:
    cid = str(work_order.get("company_id") or "").strip()
    if not cid:
        return None
    order = None
    if work_order.get("order_id"):
        order = await _db.production_orders.find_one({
            "_id": work_order.get("order_id"),
            "company_id": cid,
        })
    recipe = None
    product = None
    if order and order.get("recipe_id"):
        recipe = await _db.recipes.find_one({
            "_id": order.get("recipe_id"),
            "company_id": cid,
        })
    product_id = ""
    if order:
        product_id = str(order.get("finished_product_id") or "")
    if product_id:
        product = await _db.products.find_one({"_id": product_id, "company_id": cid})
    ids = [
        work_order.get("drawing_file_id"),
        (order or {}).get("drawing_file_id"),
        (recipe or {}).get("drawing_file_id"),
        (product or {}).get("drawing_file_id"),
    ]
    for file_id in ids:
        found = await _file_by_id(cid, file_id)
        if found:
            return found
    entity_ids = [
        work_order.get("_id"),
        (order or {}).get("_id"),
        (recipe or {}).get("_id"),
        product_id,
    ]
    for record in await _linked_files(cid, entity_ids):
        if content_type_of(record) or record.get("storage_path"):
            return record
    urls = list(work_order.get("images") or [])
    if recipe:
        for step in recipe.get("steps") or []:
            if isinstance(step, dict):
                urls.extend(step.get("images") or [])
    if product:
        if product.get("image_url"):
            urls.append(product.get("image_url"))
        urls.extend(product.get("images") or [])
    for url in urls:
        path = _storage_from_url(url)
        if not path:
            continue
        found = await _file_by_path(cid, path)
        if found:
            return found
    return None


def _filename(record: dict) -> str:
    name = str(record.get("original_filename") or "cizim").replace('"', "").replace("/", "_")
    return name[:120] or "cizim"


def describe(record: dict) -> dict:
    path = safe_storage_path(record.get("storage_path"))
    ctype = content_type_of(record)
    if not path or not ctype:
        if record and not ctype:
            raise HTTPException(status_code=400, detail={"code": TYPE_CODE, "message": "Bu çizim türü açılamaz."})
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    token = signed_links.make_doc_share_token(path, "files", ttl_sec=TTL_SEC)
    return {
        "url": f"/api/files/{path}?t={token}",
        "content_type": ctype,
        "filename": _filename(record),
        "expires_in": TTL_SEC,
        "file_id": record.get("_id"),
    }


async def load_for_user(wo_id: str, user: dict) -> tuple:
    cid = tenant_access.resolve_company_id(user, None)
    row = await _db.work_orders.find_one({"_id": wo_id, "company_id": cid})
    if not row:
        raise HTTPException(status_code=404, detail="İş emri bulunamadı.")
    if str(row.get("company_id") or "") != cid:
        raise HTTPException(status_code=404, detail="İş emri bulunamadı.")
    shopfloor_accounts.enforce_station(user, row.get("station"))
    record = await resolve_record(row)
    if not record:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    if not content_type_of(record):
        raise HTTPException(status_code=400, detail={"code": TYPE_CODE, "message": "Bu çizim türü açılamaz."})
    if not safe_storage_path(record.get("storage_path")):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return row, record


async def stream_bytes(record: dict) -> Response:
    path = safe_storage_path(record.get("storage_path"))
    ctype = content_type_of(record)
    if not path or not ctype:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    from storage_service import get_object
    try:
        data, _stored = get_object(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    except Exception:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return Response(
        content=data,
        media_type=ctype,
        headers={"Content-Disposition": f'inline; filename="{_filename(record)}"'},
    )


@router.get("/production/work-orders/{wo_id}/drawing")
async def work_order_drawing(
    wo_id: str,
    stream: Optional[int] = Query(None),
    user: dict = Depends(_user_dep),
):
    tenant_access.resolve_company_id(user, None)
    _row, record = await load_for_user(wo_id, user)
    if stream:
        return await stream_bytes(record)
    return describe(record)
