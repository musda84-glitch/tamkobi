"""Platform e-Fatura / e-Arşiv XSLT tasarımları (Sistem paneli)."""
from __future__ import annotations

import asyncio
import base64
import gzip
import io
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

import saas

logger = logging.getLogger("TamKobiERP")

router = APIRouter(prefix="/api", tags=["einvoice-designs"])
_db = None

COLLECTION = "einvoice_designs"
SETTINGS_ID = "einvoice_design_settings"
KINDS = ("e_invoice", "e_archive")
KIND_LABELS = {"e_invoice": "e-Fatura", "e_archive": "e-Arşiv"}
SOURCES = ("visual", "xslt")
MAX_XSLT_BYTES = 2 * 1024 * 1024
MAX_LAYOUT_BYTES = 500 * 1024
XSLT_TRANSFORM_TIMEOUT_S = 5.0
DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "einvoice_xslt")
SAMPLE_INVOICE = os.path.join(DATA_DIR, "sample_invoice.xml")
LAYOUT_COMMENT_RE = re.compile(r"<!--\s*TAMKOBI_LAYOUT\s+v1:([A-Za-z0-9+/=]+)\s*-->")
HTML_ENTITY_RE = re.compile(r"&(?:nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);", re.I)
DOCTYPE_RE = re.compile(r"<!DOCTYPE\b", re.I)
# Statik yasaklar: dosya/ağ yazma veya harici belge yükleme.
BANNED_XSLT_PATTERNS = (
    (re.compile(r"<\s*exsl:document\b", re.I), "exsl:document"),
    (re.compile(r"<\s*xsl:result-document\b", re.I), "xsl:result-document"),
    (re.compile(r"<\s*xsl:include\b", re.I), "xsl:include"),
    (re.compile(r"<\s*xsl:import\b", re.I), "xsl:import"),
    (re.compile(r"\bdocument\s*\(", re.I), "document()"),
)
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


def extract_layout_from_xslt(text: str) -> Optional[dict]:
    m = LAYOUT_COMMENT_RE.search(str(text or ""))
    if not m:
        return None
    try:
        return json.loads(base64.b64decode(m.group(1)).decode("utf-8"))
    except Exception:
        return None


def _reject_dangerous_xslt(raw: str) -> None:
    if DOCTYPE_RE.search(raw):
        raise HTTPException(status_code=400, detail="XSLT içinde DOCTYPE yasaktır.")
    for pat, label in BANNED_XSLT_PATTERNS:
        if pat.search(raw):
            raise HTTPException(status_code=400, detail=f"XSLT içinde {label} yasaktır.")


def compile_and_transform_xslt(text: str) -> str:
    """lxml ile XSLT derle + sample_invoice.xml üzerinde dönüştür; hata → 400.

    Sync yol: güvenli XMLParser + DENY_ALL + statik yasaklar (validate_xslt / seçili tasarım).
    """
    raw = str(text or "")
    if len(raw.encode("utf-8")) > MAX_XSLT_BYTES:
        raise HTTPException(status_code=400, detail="XSLT 2 MB sınırını aşıyor.")
    # &nbsp; gibi HTML entity'ler XSLT XML parse'ını bozar (&#160; serbest).
    if re.search(r"&nbsp;", raw, re.I):
        raise HTTPException(status_code=400, detail="XSLT içinde &nbsp; kullanılamaz; &#160; yazın.")
    if "<xsl:stylesheet" not in raw and "<xsl:transform" not in raw:
        raise HTTPException(status_code=400, detail="Geçerli bir XSLT dosyası değil (xsl:stylesheet yok).")
    _reject_dangerous_xslt(raw)
    try:
        from lxml import etree
    except ImportError as e:
        raise HTTPException(status_code=500, detail="lxml yüklü değil; XSLT doğrulanamıyor.") from e
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    # Yorumdaki layout base64 JSON'u XML olarak parse edilebilir kalsın.
    try:
        xslt_doc = etree.fromstring(raw.encode("utf-8"), parser)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"XSLT XML parse hatası: {e}") from e
    try:
        transform = etree.XSLT(xslt_doc, access_control=etree.XSLTAccessControl.DENY_ALL)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"XSLT derleme hatası: {e}") from e
    try:
        with open(SAMPLE_INVOICE, "rb") as fh:
            sample = etree.parse(fh, parser)
        result = transform(sample)
        out = str(result) if result is not None else ""
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"XSLT örnek dönüşüm hatası: {e}") from e
    if not out.strip():
        raise HTTPException(status_code=400, detail="XSLT örnek fatura üzerinde boş çıktı üretti.")
    return raw


def validate_xslt(text: str) -> str:
    """Sync doğrulama (birim testleri + güvenli parser/DENY_ALL/statik yasaklar)."""
    return compile_and_transform_xslt(text)


async def validate_xslt_async(text: str) -> str:
    """Async rotalar: dönüşümü thread'de 5 sn zaman aşımı ile çalıştır."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(compile_and_transform_xslt, text),
            timeout=XSLT_TRANSFORM_TIMEOUT_S,
        )
    except asyncio.TimeoutError as e:
        raise HTTPException(status_code=400, detail="XSLT doğrulama zaman aşımı (5 sn).") from e


def validate_layout(value: Any) -> Optional[dict]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="Görsel düzen bir nesne olmalı.")
    raw = json.dumps(value, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_LAYOUT_BYTES:
        raise HTTPException(status_code=400, detail="Tasarım düzeni çok büyük (logoyu küçültün).")
    return value


def _normalize_source(value: Any, *, has_layout: bool) -> str:
    s = str(value or "").strip().lower()
    if s in SOURCES:
        return s
    return "visual" if has_layout else "xslt"


async def get_xslt_embed_mode() -> str:
    try:
        row = await _db.platform_settings.find_one({"_id": SETTINGS_ID}) or {}
        mode = str(row.get("xslt_embed") or "gzip_base64").strip().lower()
        return mode if mode in ("base64", "gzip_base64") else "gzip_base64"
    except Exception:
        return "gzip_base64"


async def set_xslt_embed_mode(mode: str) -> str:
    m = str(mode or "").strip().lower()
    if m not in ("base64", "gzip_base64"):
        raise HTTPException(status_code=400, detail="xslt_embed base64 veya gzip_base64 olmalı.")
    await _db.platform_settings.update_one(
        {"_id": SETTINGS_ID},
        {"$set": {"xslt_embed": m, "updated_at": _now()}},
        upsert=True,
    )
    return m


def _slug_filename(name: str, kind: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9._-]+", "_", (name or KIND_LABELS.get(kind, kind)).strip())[:60].strip("._") or kind
    if not base.lower().endswith(".xslt"):
        base += ".xslt"
    return base


def _public(doc: dict, *, include_xslt: bool = False) -> dict:
    xslt = doc.get("xslt") or ""
    has_layout = isinstance(doc.get("layout"), dict)
    source = _normalize_source(doc.get("source"), has_layout=has_layout)
    out = {
        "id": doc.get("_id") or doc.get("id"),
        "name": doc.get("name") or "",
        "kind": doc.get("kind"),
        "kind_label": KIND_LABELS.get(doc.get("kind") or "", doc.get("kind") or ""),
        "source": source,
        "is_builtin": bool(doc.get("is_builtin")),
        "is_selected": bool(doc.get("is_selected")),
        "has_layout": has_layout and source == "visual",
        "xslt_bytes": len(str(xslt).encode("utf-8")),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }
    if include_xslt:
        out["xslt"] = xslt
        out["layout"] = doc.get("layout") if (has_layout and source == "visual") else None
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


def _builtin_xslt_for_kind(kind: str) -> str:
    spec = next((s for s in BUILTIN if s["kind"] == kind), BUILTIN[0])
    return _read_builtin_xslt(spec["file"])


async def selected_xslt(kind: str) -> Optional[str]:
    k = _kind(kind)
    await ensure_defaults()
    row = await _db[COLLECTION].find_one({"kind": k, "is_selected": True})
    if not row:
        row = await _db[COLLECTION].find_one({"kind": k})
    if not row:
        return _builtin_xslt_for_kind(k)
    raw = row.get("xslt") or ""
    try:
        await validate_xslt_async(raw)
        return raw
    except HTTPException as e:
        logger.error(
            "selected_xslt broken kind=%s id=%s detail=%s — falling back to GİB default",
            k, row.get("_id"), getattr(e, "detail", e),
        )
        return _builtin_xslt_for_kind(k)


_DATA_IMAGE_RE = re.compile(
    r"data:image/(webp|jpeg|jpg|png|gif);base64,([A-Za-z0-9+/=\s]+)",
    re.IGNORECASE,
)


def gzip_xslt_b64(xslt: str) -> str:
    """GİB UBL: XSLT gzip + Base64 (EmbeddedDocumentBinaryObject)."""
    raw = str(xslt or "").encode("utf-8")
    return base64.b64encode(gzip.compress(raw, compresslevel=9)).decode("ascii")


def _image_bytes_to_jpeg_b64(mime: str, payload_b64: str) -> str:
    raw = base64.b64decode(re.sub(r"\s+", "", payload_b64 or ""))
    kind = (mime or "").lower()
    if kind in ("jpeg", "jpg") and raw[:2] == b"\xff\xd8":
        return base64.b64encode(raw).decode("ascii")
    from PIL import Image

    im = Image.open(io.BytesIO(raw))
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=85, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def prepare_xslt_for_gib(xslt: str) -> str:
    """GİB HTML görüntüleyici WebP/HTTP logo okumaz — JPEG data URI'ye çevir."""
    text = str(xslt or "")

    def _repl(match: re.Match) -> str:
        mime, payload = match.group(1), match.group(2)
        try:
            jpeg_b64 = _image_bytes_to_jpeg_b64(mime, payload)
        except Exception:
            return match.group(0)
        return f"data:image/jpeg;base64,{jpeg_b64}"

    return _DATA_IMAGE_RE.sub(_repl, text)


async def selected_xslt_for_e_type(e_type: str) -> Optional[str]:
    """Giden UBL'ye gömülecek seçili tasarım (GİB-uyumlu JPEG logo)."""
    raw_kind = str(e_type or "").strip().lower()
    kind = "e_archive" if raw_kind in ("e_archive", "earsiv", "e-arsiv") else "e_invoice"
    raw = await selected_xslt(kind)
    if not raw:
        return None
    return prepare_xslt_for_gib(raw)


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
    raw_xslt = xslt if xslt is not None else _read_builtin_xslt(builtin_file)
    # Builtin kopyada lxml katı doğrulama opsiyonel gevşek: yine de stylesheet şart.
    try:
        xslt = await validate_xslt_async(raw_xslt)
    except HTTPException:
        if src and src.get("is_builtin"):
            xslt = str(raw_xslt or "")
            if "<xsl:stylesheet" not in xslt and "<xsl:transform" not in xslt:
                raise
        else:
            raise
    has_layout_hint = ("layout" in req and req.get("layout") is not None) or (
        bool(src) and isinstance(src.get("layout"), dict) and _normalize_source(src.get("source"), has_layout=True) == "visual"
    )
    source = _normalize_source(
        req.get("source") if "source" in req else (src.get("source") if src else None),
        has_layout=has_layout_hint,
    )
    if "layout" in req:
        layout = req.get("layout")
    elif src and source != "xslt":
        layout = src.get("layout")
    else:
        layout = extract_layout_from_xslt(xslt) if source == "visual" else None
    if source == "xslt":
        layout = None
    else:
        layout = validate_layout(layout) if layout is not None else None
        if layout is not None:
            source = "visual"
        elif "source" not in req:
            source = "xslt"
    doc = {
        "_id": f"einvoice_xslt_{uuid.uuid4().hex[:10]}",
        "name": name[:120],
        "kind": kind,
        "source": source,
        "xslt": xslt,
        "layout": layout,
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
        patch["xslt"] = await validate_xslt_async(req.get("xslt"))
    if "kind" in req:
        patch["kind"] = _kind(req.get("kind"))
    if "source" in req:
        patch["source"] = _normalize_source(req.get("source"), has_layout="layout" in req or isinstance(doc.get("layout"), dict))
    source = patch.get("source") or _normalize_source(doc.get("source"), has_layout=isinstance(doc.get("layout"), dict))
    if "layout" in req:
        if source == "xslt":
            patch["layout"] = None
        else:
            patch["layout"] = validate_layout(req.get("layout"))
            patch["source"] = "visual"
    if source == "xslt":
        patch["layout"] = None
        patch["source"] = "xslt"
    await _db[COLLECTION].update_one({"_id": design_id}, {"$set": patch})
    return _public(await _get(design_id), include_xslt=True)


@router.post("/system/einvoice-designs/{design_id}/select")
async def select_design(design_id: str, _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    doc = await _get(design_id)
    try:
        await validate_xslt_async(doc.get("xslt") or "")
    except HTTPException as e:
        raise HTTPException(status_code=400, detail=f"Bozuk tasarım seçilemez: {e.detail}") from e
    kind = doc.get("kind")
    await _db[COLLECTION].update_many({"kind": kind, "is_selected": True}, {"$set": {"is_selected": False, "updated_at": _now()}})
    await _db[COLLECTION].update_one({"_id": design_id}, {"$set": {"is_selected": True, "updated_at": _now()}})
    return {"status": "success", "id": design_id, "kind": kind, "items": await _list()}


@router.get("/system/einvoice-designs/{design_id}/export")
async def export_design(design_id: str, _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    doc = await _get(design_id)
    source = _normalize_source(doc.get("source"), has_layout=isinstance(doc.get("layout"), dict))
    payload = {
        "schema_version": 1,
        "kind": doc.get("kind"),
        "name": doc.get("name"),
        "source": source,
        "layout": doc.get("layout") if source == "visual" else None,
        "xslt": doc.get("xslt") or "",
    }
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    fname = _slug_filename(doc.get("name") or "tasarim", doc.get("kind") or "e_invoice").replace(".xslt", ".tkdesign.json")
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/system/einvoice-designs/import")
async def import_design(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    """Import .tkdesign.json body or raw {name, kind, xslt, layout, source}."""
    await ensure_defaults()
    payload = req.get("design") if isinstance(req.get("design"), dict) else req
    if isinstance(payload.get("content"), str) and not payload.get("xslt"):
        # Ham .xslt metni
        text = payload["content"]
        if text.strip().startswith("{"):
            try:
                payload = json.loads(text)
            except Exception as e:
                raise HTTPException(status_code=400, detail="JSON tasarım parse edilemedi.") from e
        else:
            payload = {"xslt": text, "source": "xslt", "name": payload.get("name") or "İçe aktarılan"}
    kind = _kind(payload.get("kind") or "e_invoice")
    name = str(payload.get("name") or "İçe aktarılan tasarım").strip()[:120]
    xslt = await validate_xslt_async(payload.get("xslt") or "")
    source = _normalize_source(payload.get("source"), has_layout=isinstance(payload.get("layout"), dict))
    layout = None
    if source == "visual":
        layout = validate_layout(payload.get("layout")) if payload.get("layout") is not None else extract_layout_from_xslt(xslt)
        if layout is None:
            source = "xslt"
    doc = {
        "_id": f"einvoice_xslt_{uuid.uuid4().hex[:10]}",
        "name": name,
        "kind": kind,
        "source": source,
        "xslt": xslt,
        "layout": layout if source == "visual" else None,
        "is_builtin": False,
        "is_selected": False,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await _db[COLLECTION].insert_one(doc)
    return _public(doc, include_xslt=True)


@router.get("/system/einvoice-designs/settings/embed")
async def get_embed_settings(_: dict = Depends(saas.require_super_admin)):
    return {"xslt_embed": await get_xslt_embed_mode()}


@router.put("/system/einvoice-designs/settings/embed")
async def put_embed_settings(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    mode = await set_xslt_embed_mode(req.get("xslt_embed"))
    return {"xslt_embed": mode}


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
