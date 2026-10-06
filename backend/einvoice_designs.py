"""Platform e-Fatura / e-Arşiv XSLT tasarımları (Sistem paneli)."""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

import saas

router = APIRouter(prefix="/api", tags=["einvoice-designs"])
_db = None

COLLECTION = "einvoice_designs"
KINDS = ("e_invoice", "e_archive")
KIND_LABELS = {"e_invoice": "e-Fatura", "e_archive": "e-Arşiv"}
MAX_XSLT_BYTES = 2 * 1024 * 1024
DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "einvoice_xslt")
BUILTIN = (
    {
        "id": "einvoice_xslt_default_e_invoice",
        "kind": "e_invoice",
        "name": "Varsayılan e-Fatura",
        "file": "default_e_invoice.xslt",
    },
    {
        "id": "einvoice_xslt_default_e_archive",
        "kind": "e_archive",
        "name": "Varsayılan e-Arşiv",
        "file": "default_e_archive.xslt",
    },
)


def init(db):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _kind(value: Any) -> str:
    k = str(value or "").strip()
    if k in ("efatura", "e-fatura", "invoice"):
        k = "e_invoice"
    if k in ("earsiv", "e-arsiv", "e_arsiv", "archive"):
        k = "e_archive"
    if k not in KINDS:
        raise HTTPException(status_code=400, detail="Tasarım türü e-Fatura veya e-Arşiv olmalı.")
    return k


def _read_builtin_xslt(filename: str) -> str:
    path = os.path.join(DATA_DIR, filename)
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def validate_xslt(text: str) -> str:
    raw = str(text or "")
    if len(raw.encode("utf-8")) > MAX_XSLT_BYTES:
        raise HTTPException(status_code=400, detail="XSLT 2 MB sınırını aşıyor.")
    if "<xsl:stylesheet" not in raw and "<xsl:transform" not in raw:
        raise HTTPException(status_code=400, detail="Geçerli bir XSLT dosyası değil (xsl:stylesheet yok).")
    return raw


def _slug_filename(name: str, kind: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9._-]+", "_", (name or KIND_LABELS.get(kind, kind)).strip())[:60].strip("._") or kind
    if not base.lower().endswith(".xslt"):
        base += ".xslt"
    return base


def _public(doc: dict, *, include_xslt: bool = False) -> dict:
    xslt = doc.get("xslt") or ""
    out = {
        "id": doc.get("_id") or doc.get("id"),
        "name": doc.get("name") or "",
        "kind": doc.get("kind"),
        "kind_label": KIND_LABELS.get(doc.get("kind") or "", doc.get("kind") or ""),
        "is_builtin": bool(doc.get("is_builtin")),
        "is_selected": bool(doc.get("is_selected")),
        "xslt_bytes": len(str(xslt).encode("utf-8")),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }
    if include_xslt:
        out["xslt"] = xslt
    return out


async def ensure_defaults() -> None:
    for spec in BUILTIN:
        existing = await _db[COLLECTION].find_one({"_id": spec["id"]})
        if existing:
            continue
        same_kind = await _db[COLLECTION].find_one({"kind": spec["kind"], "is_selected": True})
        doc = {
            "_id": spec["id"],
            "name": spec["name"],
            "kind": spec["kind"],
            "xslt": _read_builtin_xslt(spec["file"]),
            "is_builtin": True,
            "is_selected": not bool(same_kind),
            "created_at": _now(),
            "updated_at": _now(),
        }
        await _db[COLLECTION].insert_one(doc)


async def selected_xslt(kind: str) -> Optional[str]:
    k = _kind(kind)
    await ensure_defaults()
    row = await _db[COLLECTION].find_one({"kind": k, "is_selected": True})
    if not row:
        row = await _db[COLLECTION].find_one({"kind": k})
    if not row:
        return None
    return row.get("xslt") or None


async def _get(design_id: str) -> dict:
    doc = await _db[COLLECTION].find_one({"_id": design_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Tasarım bulunamadı.")
    return doc


async def _list() -> List[dict]:
    await ensure_defaults()
    rows = await _db[COLLECTION].find({}).sort("name", 1).to_list(200)
    return [_public(r) for r in rows]


@router.get("/system/einvoice-designs")
async def list_designs(_: dict = Depends(saas.require_super_admin)):
    items = await _list()
    selected = {k: next((i["id"] for i in items if i["kind"] == k and i["is_selected"]), None) for k in KINDS}
    return {"items": items, "selected": selected, "kinds": [{"id": k, "label": KIND_LABELS[k]} for k in KINDS]}


@router.get("/system/einvoice-designs/{design_id}")
async def get_design(design_id: str, _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    return _public(await _get(design_id), include_xslt=True)


@router.get("/system/einvoice-designs/{design_id}/download")
async def download_design(design_id: str, _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    doc = await _get(design_id)
    body = (doc.get("xslt") or "").encode("utf-8")
    filename = _slug_filename(doc.get("name") or "", doc.get("kind") or "e_invoice")
    return Response(
        content=body,
        media_type="application/xslt+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/system/einvoice-designs")
async def create_design(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    copy_from = str(req.get("copy_from_id") or "").strip()
    src = await _get(copy_from) if copy_from else None
    kind = _kind(req.get("kind") or (src.get("kind") if src else "e_invoice"))
    name = str(req.get("name") or "").strip() or f"Yeni {KIND_LABELS[kind]}"
    xslt = req.get("xslt")
    if src:
        xslt = src.get("xslt") or ""
        if not str(req.get("name") or "").strip():
            name = f"{src.get('name') or KIND_LABELS[kind]} kopya"
    builtin_file = next((s["file"] for s in BUILTIN if s["kind"] == kind), BUILTIN[0]["file"])
    xslt = validate_xslt(xslt if xslt is not None else _read_builtin_xslt(builtin_file))
    doc = {
        "_id": f"einvoice_xslt_{uuid.uuid4().hex[:10]}",
        "name": name[:120],
        "kind": kind,
        "xslt": xslt,
        "is_builtin": False,
        "is_selected": False,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await _db[COLLECTION].insert_one(doc)
    return _public(doc, include_xslt=True)


@router.put("/system/einvoice-designs/{design_id}")
async def update_design(design_id: str, req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    doc = await _get(design_id)
    patch: Dict[str, Any] = {"updated_at": _now()}
    if "name" in req:
        name = str(req.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Tasarım adı boş olamaz.")
        patch["name"] = name[:120]
    if "xslt" in req:
        patch["xslt"] = validate_xslt(req.get("xslt"))
    if "kind" in req:
        patch["kind"] = _kind(req.get("kind"))
    await _db[COLLECTION].update_one({"_id": design_id}, {"$set": patch})
    return _public(await _get(design_id), include_xslt=True)


@router.post("/system/einvoice-designs/{design_id}/select")
async def select_design(design_id: str, _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    doc = await _get(design_id)
    kind = doc.get("kind")
    await _db[COLLECTION].update_many({"kind": kind, "is_selected": True}, {"$set": {"is_selected": False, "updated_at": _now()}})
    await _db[COLLECTION].update_one({"_id": design_id}, {"$set": {"is_selected": True, "updated_at": _now()}})
    return {"status": "success", "id": design_id, "kind": kind, "items": await _list()}


@router.delete("/system/einvoice-designs/{design_id}")
async def delete_design(design_id: str, _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    doc = await _get(design_id)
    if doc.get("is_builtin"):
        raise HTTPException(status_code=400, detail="Varsayılan tasarım silinemez. Kopyalayıp düzenleyin.")
    if doc.get("is_selected"):
        raise HTTPException(status_code=400, detail="Seçili tasarım silinemez. Önce başka bir tasarımı seçin.")
    await _db[COLLECTION].delete_one({"_id": design_id})
    return {"status": "success", "items": await _list()}
