"""e-Fatura / e-Arşiv XSLT tasarımları: platform varsayılanı + şirket kopyaları."""
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
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

import saas
import tenant_access

logger = logging.getLogger("TamKobiERP")

router = APIRouter(prefix="/api", tags=["einvoice-designs"])
_db = None
_current_user: Optional[Callable[..., Awaitable[dict]]] = None

COLLECTION = "einvoice_designs"
SETTINGS_ID = "einvoice_design_settings"
KINDS = ("e_invoice", "e_archive", "e_dispatch")
KIND_LABELS = {"e_invoice": "e-Fatura", "e_archive": "e-Arşiv", "e_dispatch": "e-İrsaliye"}
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
    {
        "id": "einvoice_xslt_default_e_dispatch",
        "kind": "e_dispatch",
        "name": "Klasik (İşNet örneği)",
        "file": "",
    },
)


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Kimlik doğrulama bağlanmadı.")
    return await _current_user(request)


def _col(name: str):
    if _db is None:
        return None
    if isinstance(_db, dict):
        return _db.get(name)
    return getattr(_db, name, None)


def _is_platform(doc: Optional[dict]) -> bool:
    return not str((doc or {}).get("company_id") or "").strip()


def _doc_company_id(doc: Optional[dict]) -> str:
    return str((doc or {}).get("company_id") or "").strip()


def _kind_from_e_type(e_type: str) -> str:
    raw_kind = str(e_type or "").strip().lower()
    if raw_kind in ("e_archive", "earsiv", "e-arsiv"):
        return "e_archive"
    if raw_kind in ("e_dispatch", "e-irsaliye", "irsaliye", "despatch", "e_despatch"):
        return "e_dispatch"
    return "e_invoice"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _kind(value: Any) -> str:
    k = str(value or "").strip()
    if k in ("efatura", "e-fatura", "invoice"):
        k = "e_invoice"
    if k in ("earsiv", "e-arsiv", "e_arsiv", "archive"):
        k = "e_archive"
    if k in ("e-irsaliye", "irsaliye", "despatch", "e_despatch"):
        k = "e_dispatch"
    if k not in KINDS:
        raise HTTPException(status_code=400, detail="Tasarım türü e-Fatura, e-Arşiv veya e-İrsaliye olmalı.")
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
    # İşNet standart şablonları XSLT 2.0 (character-map). lxml yalnız 1.0 derler;
    # 2.0 metin güvenlik ve iyi biçimlilikten geçer, orijinal haliyle saklanır.
    version = str(xslt_doc.get("version") or "").strip()
    if version.startswith("2"):
        return raw
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
        mode = str(row.get("xslt_embed") or "base64").strip().lower()
        return mode if mode in ("base64", "gzip_base64") else "base64"
    except Exception:
        return "base64"


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
        "company_id": _doc_company_id(doc) or None,
        "is_platform": _is_platform(doc),
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
        same_kind = await _find_platform_selected(spec["kind"])
        doc = {
            "_id": spec["id"],
            "name": spec["name"],
            "kind": spec["kind"],
            "xslt": _builtin_xslt_for_kind(spec["kind"]),
            "is_builtin": True,
            "is_selected": not bool(same_kind),
            "created_at": _now(),
            "updated_at": _now(),
        }
        await _db[COLLECTION].insert_one(doc)


def _builtin_xslt_for_kind(kind: str) -> str:
    spec = next((s for s in BUILTIN if s["kind"] == kind), None)
    if spec and spec.get("file"):
        return _read_builtin_xslt(spec["file"])
    if (spec and spec["kind"] == "e_dispatch") or kind == "e_dispatch":
        from einvoice_classic_xslt import classic_isnet_xslt
        return classic_isnet_xslt("e_dispatch")
    return _read_builtin_xslt(BUILTIN[0]["file"])


async def _rows_of_kind(kind: str) -> List[dict]:
    col = _col(COLLECTION)
    if col is None:
        return []
    try:
        rows = await col.find({"kind": kind}).sort("name", 1).to_list(400)
    except Exception:
        rows = []
    return [r for r in (rows or []) if r.get("kind") == kind]


async def _find_platform_selected(kind: str) -> Optional[dict]:
    for row in await _rows_of_kind(kind):
        if _is_platform(row) and row.get("is_selected"):
            return row
    return None


async def _find_company_selected(kind: str, company_id: str) -> Optional[dict]:
    cid = str(company_id or "").strip()
    if not cid:
        return None
    col = _col(COLLECTION)
    if col is None:
        return None
    row = await col.find_one({"kind": kind, "company_id": cid, "is_selected": True})
    if row and _doc_company_id(row) == cid:
        return row
    for item in await _rows_of_kind(kind):
        if _doc_company_id(item) == cid and item.get("is_selected"):
            return item
    return None


async def _selected_row(kind: str, company_id: Optional[str] = None) -> Tuple[Optional[dict], str]:
    """Şirkete özel seçili tasarım, yoksa platform varsayılanı."""
    k = _kind(kind)
    await ensure_defaults()
    cid = str(company_id or "").strip()
    if cid:
        row = await _find_company_selected(k, cid)
        if row:
            return row, "company"
    row = await _find_platform_selected(k)
    if row:
        return row, "platform"
    for item in await _rows_of_kind(k):
        if _is_platform(item):
            return item, "platform"
    return None, "builtin"


async def selected_xslt(kind: str, company_id: Optional[str] = None) -> Optional[str]:
    k = _kind(kind)
    row, scope = await _selected_row(k, company_id)
    if not row:
        return _builtin_xslt_for_kind(k)
    raw = row.get("xslt") or ""
    try:
        await validate_xslt_async(raw)
        return raw
    except HTTPException as e:
        logger.error(
            "selected_xslt broken kind=%s id=%s scope=%s detail=%s — falling back to GİB default",
            k, row.get("_id"), scope, getattr(e, "detail", e),
        )
        return _builtin_xslt_for_kind(k)


_DATA_IMAGE_RE = re.compile(
    r"data:image/(webp|jpeg|jpg|png|gif);base64,([A-Za-z0-9+/=\s]+)",
    re.IGNORECASE,
)
# İşNet render anında bu dizeleri görselle değiştirir; JPEG'e çevrilmez.
_ISNET_IMAGE_TOKENS = frozenset({
    "firmaLogoImageString",
    "firmaImzaImageString",
    "qrCodeImageString",
})


def gzip_xslt_b64(xslt: str) -> str:
    """Eski gzip+Base64 yardımcı. UBL gömme artık plain_xslt_b64 kullanır."""
    raw = str(xslt or "").encode("utf-8")
    return base64.b64encode(gzip.compress(raw, compresslevel=9)).decode("ascii")


def plain_xslt_b64(xslt: str) -> str:
    """UBL EmbeddedDocumentBinaryObject: gzip'siz düz Base64. 2 MB sınırını aşarsa hata."""
    raw = str(xslt or "").encode("utf-8")
    if len(raw) > MAX_XSLT_BYTES:
        raise ValueError(f"XSLT {len(raw)} bayt; sınır {MAX_XSLT_BYTES} bayt.")
    return base64.b64encode(raw).decode("ascii")


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


# xsl:otherwise içine gömülmüş gerçek logo (yer tutucu değil).
_FALLBACK_LOGO_OTHERWISE_RE = re.compile(
    r"<xsl:otherwise>\s*<img\b[^>]*src=[\"']data:image/(?:webp|jpeg|jpg|png|gif);base64,"
    r"(?!firmaLogoImageString|firmaImzaImageString|qrCodeImageString)[A-Za-z0-9+/=\s]+[\"']"
    r"[^>]*/?>(?:\s*<xsl:attribute\b[^>]*>[\s\S]*?</xsl:attribute>\s*</img>)?"
    r"\s*</xsl:otherwise>",
    re.IGNORECASE,
)
_LOGO_WHEN_CLOSE_RE = re.compile(
    r"(<xsl:when\b[^>]*\$IsLogoExists='true'[^>]*>[\s\S]*?firmaLogoImageString[\s\S]*?</xsl:when>)",
    re.IGNORECASE,
)


def company_logo_to_jpeg_data_uri(logo: Any) -> Optional[str]:
    """companies.logo / data URI / ham Base64 → JPEG data URI."""
    if logo is None:
        return None
    if isinstance(logo, (bytes, bytearray)):
        raw = bytes(logo)
        mime = "jpeg" if raw[:2] == b"\xff\xd8" else "png"
        try:
            jpeg_b64 = _image_bytes_to_jpeg_b64(mime, base64.b64encode(raw).decode("ascii"))
        except Exception:
            return None
        return f"data:image/jpeg;base64,{jpeg_b64}"
    s = str(logo or "").strip()
    if not s:
        return None
    m = _DATA_IMAGE_RE.search(s.replace("\n", ""))
    if m:
        compact = re.sub(r"\s+", "", m.group(2) or "")
        if compact in _ISNET_IMAGE_TOKENS:
            return None
        try:
            jpeg_b64 = _image_bytes_to_jpeg_b64(m.group(1), m.group(2))
        except Exception:
            return None
        return f"data:image/jpeg;base64,{jpeg_b64}"
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", s), validate=False)
    except Exception:
        return None
    if len(raw) < 8:
        return None
    mime = "jpeg" if raw[:2] == b"\xff\xd8" else "png"
    try:
        jpeg_b64 = _image_bytes_to_jpeg_b64(mime, base64.b64encode(raw).decode("ascii"))
    except Exception:
        return None
    return f"data:image/jpeg;base64,{jpeg_b64}"


async def load_company_logo(company_id: Optional[str]) -> Optional[str]:
    """Şirket ayarlarındaki logo (companies.logo, yoksa logo_url)."""
    cid = str(company_id or "").strip()
    if not cid:
        return None
    col = _col("companies")
    if col is None:
        return None
    try:
        co = await col.find_one({"_id": cid}) or await col.find_one({"id": cid})
    except Exception:
        return None
    if not co:
        return None
    raw = co.get("logo")
    if raw:
        return raw if isinstance(raw, (bytes, bytearray)) else str(raw)
    url = str(co.get("logo_url") or "").strip()
    if not url:
        return None
    if url.startswith("data:image/"):
        return url
    if url.startswith("/api/files/"):
        path = url[len("/api/files/"):]
        try:
            from storage_service import get_object
            data, ctype = get_object(path)
        except Exception:
            return None
        mime = "png"
        ct = (ctype or "").lower()
        if "jpeg" in ct or "jpg" in ct:
            mime = "jpeg"
        elif "webp" in ct:
            mime = "webp"
        elif "gif" in ct:
            mime = "gif"
        return f"data:image/{mime};base64,{base64.b64encode(data).decode('ascii')}"
    return None


def _strip_embedded_fallback_logos(text: str) -> str:
    return _FALLBACK_LOGO_OTHERWISE_RE.sub("", text)


def _inject_company_fallback_logo(text: str, jpeg_data_uri: str) -> str:
    cleaned = _strip_embedded_fallback_logos(text)
    otherwise = (
        f'<xsl:otherwise><img style="height:72px;width:auto;border:0;" '
        f'src="{jpeg_data_uri}"/></xsl:otherwise>'
    )
    m = _LOGO_WHEN_CLOSE_RE.search(cleaned)
    if m:
        return cleaned[: m.end()] + otherwise + cleaned[m.end():]
    token = "data:image/jpeg;base64,firmaLogoImageString"
    idx = cleaned.find(token)
    if idx < 0:
        return cleaned
    close = cleaned.find("</xsl:when>", idx)
    if close < 0:
        return cleaned
    end = close + len("</xsl:when>")
    return cleaned[:end] + otherwise + cleaned[end:]


def prepare_xslt_for_gib(xslt: str, company_logo: Optional[Any] = None) -> str:
    """GİB HTML görüntüleyici WebP/HTTP logo okumaz — JPEG data URI'ye çevir.

    Platform varsayılanında gömülü firma logosu olmaz (yalnız firmaLogoImageString).
    Şirkete özel tasarımda fallback logo companies.logo'dan üretilir; başka şirket
    logosu asla gömülmez. $IsLogoExists='true' İşNet portal logosunu öncelikli tutar.
    """
    text = str(xslt or "")

    def _repl(match: re.Match) -> str:
        mime, payload = match.group(1), match.group(2)
        compact = re.sub(r"\s+", "", payload or "")
        if compact in _ISNET_IMAGE_TOKENS:
            return match.group(0)
        try:
            jpeg_b64 = _image_bytes_to_jpeg_b64(mime, payload)
        except Exception:
            return match.group(0)
        return f"data:image/jpeg;base64,{jpeg_b64}"

    text = _DATA_IMAGE_RE.sub(_repl, text)
    if company_logo is not None and str(company_logo).strip() != "":
        uri = company_logo_to_jpeg_data_uri(company_logo)
        if uri:
            return _inject_company_fallback_logo(text, uri)
        return _strip_embedded_fallback_logos(text)
    return _strip_embedded_fallback_logos(text)


async def selected_xslt_for_e_type(e_type: str, company_id: Optional[str] = None) -> Optional[str]:
    """Giden UBL'ye gömülecek seçili tasarım (GİB-uyumlu JPEG logo)."""
    kind = _kind_from_e_type(e_type)
    row, scope = await _selected_row(kind, company_id)
    if not row:
        raw = _builtin_xslt_for_kind(kind)
        return prepare_xslt_for_gib(raw)
    raw = row.get("xslt") or ""
    try:
        await validate_xslt_async(raw)
    except HTTPException as e:
        logger.error(
            "selected_xslt_for_e_type broken kind=%s id=%s detail=%s — falling back to GİB default",
            kind, row.get("_id"), getattr(e, "detail", e),
        )
        raw = _builtin_xslt_for_kind(kind)
        scope = "platform"
    logo = None
    if scope == "company":
        logo = await load_company_logo(company_id)
    return prepare_xslt_for_gib(raw, company_logo=logo)


async def _get(design_id: str) -> dict:
    doc = await _db[COLLECTION].find_one({"_id": design_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Tasarım bulunamadı.")
    return doc


def _visible_for_company(doc: dict, company_id: Optional[str]) -> bool:
    if _is_platform(doc):
        return True
    cid = str(company_id or "").strip()
    return bool(cid) and _doc_company_id(doc) == cid


def _effective_selected_id(items: List[dict], kind: str, company_id: Optional[str]) -> Optional[str]:
    cid = str(company_id or "").strip()
    if cid:
        for it in items:
            if it.get("kind") == kind and it.get("company_id") == cid and it.get("is_selected"):
                return it.get("id")
    for it in items:
        if it.get("kind") == kind and it.get("is_platform") and it.get("is_selected"):
            return it.get("id")
    for it in items:
        if it.get("kind") == kind and it.get("is_platform"):
            return it.get("id")
    return None


async def _list(company_id: Optional[str] = None) -> List[dict]:
    await ensure_defaults()
    rows = await _db[COLLECTION].find({}).sort("name", 1).to_list(400)
    cid = str(company_id or "").strip() or None
    visible = [r for r in rows if _visible_for_company(r, cid)] if cid else [r for r in rows if _is_platform(r)]
    items = [_public(r) for r in visible]
    if cid:
        selected_ids = {k: _effective_selected_id(items, k, cid) for k in KINDS}
        for it in items:
            it["is_selected"] = it.get("id") == selected_ids.get(it.get("kind"))
    return items


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


async def _create_design_impl(req: Dict[str, Any], company_id: Optional[str] = None) -> dict:
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
    raw_xslt = xslt if xslt is not None else _builtin_xslt_for_kind(kind)
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
    cid = str(company_id or "").strip()
    if cid:
        doc["company_id"] = cid
    await _db[COLLECTION].insert_one(doc)
    return _public(doc, include_xslt=True)


@router.post("/system/einvoice-designs")
async def create_design(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    return await _create_design_impl(req)


async def _update_design_impl(design_id: str, req: Dict[str, Any]) -> dict:
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


@router.put("/system/einvoice-designs/{design_id}")
async def update_design(design_id: str, req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    doc = await _get(design_id)
    if not _is_platform(doc):
        raise HTTPException(status_code=403, detail="Şirket tasarımı yalnızca şirket yöneticisi tarafından değiştirilir.")
    return await _update_design_impl(design_id, req)


async def _unselect_scope(kind: str, company_id: Optional[str] = None) -> None:
    now = _now()
    cid = str(company_id or "").strip()
    for row in await _rows_of_kind(kind):
        if cid:
            match = _doc_company_id(row) == cid
        else:
            match = _is_platform(row)
        if match and row.get("is_selected"):
            await _db[COLLECTION].update_one(
                {"_id": row["_id"]},
                {"$set": {"is_selected": False, "updated_at": now}},
            )


@router.post("/system/einvoice-designs/{design_id}/select")
async def select_design(design_id: str, _: dict = Depends(saas.require_super_admin)):
    await ensure_defaults()
    doc = await _get(design_id)
    if not _is_platform(doc):
        raise HTTPException(status_code=403, detail="Platform varsayılanı yalnızca platform tasarımlarından seçilir.")
    try:
        await validate_xslt_async(doc.get("xslt") or "")
    except HTTPException as e:
        raise HTTPException(status_code=400, detail=f"Bozuk tasarım seçilemez: {e.detail}") from e
    kind = doc.get("kind")
    await _unselect_scope(kind)
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
    if not _is_platform(doc):
        raise HTTPException(status_code=403, detail="Şirket tasarımı Sistem panelinden silinemez.")
    if doc.get("is_builtin"):
        raise HTTPException(status_code=400, detail="Varsayılan tasarım silinemez. Kopyalayıp düzenleyin.")
    if doc.get("is_selected"):
        raise HTTPException(status_code=400, detail="Seçili tasarım silinemez. Önce başka bir tasarımı seçin.")
    await _db[COLLECTION].delete_one({"_id": design_id})
    return {"status": "success", "items": await _list()}


def _catalog(items: List[dict]) -> dict:
    selected = {k: next((i["id"] for i in items if i["kind"] == k and i["is_selected"]), None) for k in KINDS}
    return {"items": items, "selected": selected, "kinds": [{"id": k, "label": KIND_LABELS[k]} for k in KINDS]}


async def _company_scope(user: dict, requested: Optional[str]) -> str:
    cid = tenant_access.resolve_company_id(user, requested)
    await tenant_access.require_company_admin(user, cid)
    return cid


async def _get_for_company(design_id: str, company_id: str) -> dict:
    doc = await _get(design_id)
    if _is_platform(doc) or _doc_company_id(doc) == company_id:
        return doc
    raise HTTPException(status_code=404, detail="Tasarım bulunamadı.")


@router.get("/einvoice/designs")
async def list_company_designs(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, company_id)
    items = await _list(cid)
    return _catalog(items)


@router.get("/einvoice/designs/{design_id}")
async def get_company_design(design_id: str, company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, company_id)
    await ensure_defaults()
    return _public(await _get_for_company(design_id, cid), include_xslt=True)


@router.get("/einvoice/designs/{design_id}/download")
async def download_company_design(design_id: str, company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, company_id)
    await ensure_defaults()
    doc = await _get_for_company(design_id, cid)
    body = (doc.get("xslt") or "").encode("utf-8")
    filename = _slug_filename(doc.get("name") or "", doc.get("kind") or "e_invoice")
    return Response(
        content=body,
        media_type="application/xslt+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/einvoice/designs/{design_id}/export")
async def export_company_design(design_id: str, company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, company_id)
    await ensure_defaults()
    doc = await _get_for_company(design_id, cid)
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


@router.post("/einvoice/designs")
async def create_company_design(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, (req or {}).get("company_id"))
    copy_from = str((req or {}).get("copy_from_id") or "").strip()
    if copy_from:
        await _get_for_company(copy_from, cid)
    return await _create_design_impl(req or {}, company_id=cid)


@router.put("/einvoice/designs/{design_id}")
async def update_company_design(design_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, (req or {}).get("company_id"))
    doc = await _get_for_company(design_id, cid)
    if _is_platform(doc):
        raise HTTPException(
            status_code=403,
            detail="Platform varsayılanı yalnız süper yönetici tarafından değiştirilir. Kopyalayıp kendi tasarımınızı kaydedin.",
        )
    if _doc_company_id(doc) != cid:
        raise HTTPException(status_code=404, detail="Tasarım bulunamadı.")
    return await _update_design_impl(design_id, req or {})


@router.post("/einvoice/designs/{design_id}/select")
async def select_company_design(design_id: str, req: Optional[Dict[str, Any]] = None, company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, company_id or (req or {}).get("company_id"))
    await ensure_defaults()
    doc = await _get_for_company(design_id, cid)
    try:
        await validate_xslt_async(doc.get("xslt") or "")
    except HTTPException as e:
        raise HTTPException(status_code=400, detail=f"Bozuk tasarım seçilemez: {e.detail}") from e
    kind = doc.get("kind")
    await _unselect_scope(kind, cid)
    if _is_platform(doc):
        # Şirket seçimi yok → platform varsayılanı kullanılır.
        return {"status": "success", "id": design_id, "kind": kind, "items": await _list(cid)}
    await _db[COLLECTION].update_one(
        {"_id": design_id},
        {"$set": {"is_selected": True, "updated_at": _now()}},
    )
    return {"status": "success", "id": design_id, "kind": kind, "items": await _list(cid)}


@router.post("/einvoice/designs/import")
async def import_company_design(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, (req or {}).get("company_id"))
    created = await import_design(req or {}, user)
    await _db[COLLECTION].update_one({"_id": created["id"]}, {"$set": {"company_id": cid, "updated_at": _now()}})
    return _public(await _get(created["id"]), include_xslt=True)


@router.delete("/einvoice/designs/{design_id}")
async def delete_company_design(design_id: str, company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = await _company_scope(user, company_id)
    await ensure_defaults()
    doc = await _get_for_company(design_id, cid)
    if _is_platform(doc) or doc.get("is_builtin"):
        raise HTTPException(status_code=400, detail="Varsayılan tasarım silinemez. Kopyalayıp düzenleyin.")
    if _doc_company_id(doc) != cid:
        raise HTTPException(status_code=404, detail="Tasarım bulunamadı.")
    if doc.get("is_selected"):
        raise HTTPException(status_code=400, detail="Seçili tasarım silinemez. Önce başka bir tasarımı seçin.")
    await _db[COLLECTION].delete_one({"_id": design_id})
    return {"status": "success", "items": await _list(cid)}


_VISUAL_DOC_TYPES = frozenset({
    "LOGO", "KASE", "KAŞE", "STAMP", "IMAGE", "GORSEL", "GÖRSEL", "FIRMA_LOGO", "SIGNATURE", "IMZA", "İMZA",
})
_QR_TYPES = frozenset({"QRCODE", "KAREKOD", "QR"})


def assert_send_ready_has_no_visuals(xml: Any) -> None:
    """send_ready UBL'de logo/kaşe görsel eki olmamalı (XSLT ve GİB karekod serbest)."""
    import xml.etree.ElementTree as ET

    if isinstance(xml, bytes):
        root = ET.fromstring(xml)
    elif isinstance(xml, str):
        root = ET.fromstring(xml.encode("utf-8"))
    else:
        root = xml
    ns = {
        "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    }
    for adr in root.findall("cac:AdditionalDocumentReference", ns):
        dtype = (adr.findtext("cbc:DocumentType", default="", namespaces=ns) or "").strip().upper()
        dcode = (adr.findtext("cbc:DocumentTypeCode", default="", namespaces=ns) or "").strip().upper()
        if dtype in _VISUAL_DOC_TYPES or dcode in _VISUAL_DOC_TYPES:
            raise AssertionError(f"send_ready UBL görsel ek içeriyor: {dtype or dcode}")
        obj = adr.find("cac:Attachment/cbc:EmbeddedDocumentBinaryObject", ns)
        if obj is None:
            continue
        mime = (obj.get("mimeCode") or "").lower()
        if mime.startswith("image/") and dtype not in _QR_TYPES and dcode not in _QR_TYPES:
            raise AssertionError(f"send_ready UBL görsel ek içeriyor: mime={mime} type={dtype}")
