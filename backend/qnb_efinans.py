"""QNB eFinans (eSolutions) e-Fatura SOAP istemcisi.

Sözleşme test WSDL'sinden (tests/fixtures/qnb/connectorService.xsd):
  hedef ad alanı http://service.connector.uut.cs.com.tr/
  belgeGonderExt / gidenBelgeParametreleri → belgeOid
  gidenBelgeDurumSorgulaExt / gidenBelgeDurumParametreleri (belgeNoTipi)
  gidenBelgeleriIndir (belgeOidListesi, belgeFormati)
  efaturaKullaniciBilgisi (vergiTcKimlikNo)

Kimlik: her istekte WS-Security UsernameToken.
Test uçları sabittir. Canlı adres dokümanda net değildir; canlıda https URL zorunludur.
e-Arşiv, e-İrsaliye, iptal, gelen kutu ve kontör bu iskelette yok.
"""
from __future__ import annotations

import base64
import hashlib
import io
import logging
import zipfile
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse
from xml.sax.saxutils import escape

import httpx
from fastapi import HTTPException

from safe_error import mask_sensitive_text

logger = logging.getLogger(__name__)

NS = "http://service.connector.uut.cs.com.tr/"
WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
TEST_CONNECTOR_URL = "https://erpefaturatest1.qnbesolutions.com.tr/efatura/ws/connectorService"
TEST_USER_SERVICE_URL = "https://erpefaturatest1.qnbesolutions.com.tr/efatura/ws/userService"

MIME_TYPE = "application/xml"
BELGE_VERSIYON = "1.0"
BELGE_TURU_UBL = "FATURA_UBL"
BELGE_TURU_FATURA = "FATURA"
UNSUPPORTED_DETAIL = "QNB eFinans için henüz desteklenmiyor"
PROCESSING_STATUS = "Gönderildi (işleniyor)"

MAX_ZIP_MEMBER_BYTES = 8 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 16 * 1024 * 1024
_TIMEOUT = httpx.Timeout(45.0, connect=15.0)


def _esc(value: Any) -> str:
    return escape(str(value if value is not None else ""), {'"': "&quot;", "'": "&apos;"})


def _local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in (tag or "") else (tag or "")


def _digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _text(root: Optional[Any], name: str) -> str:
    if root is None:
        return ""
    for el in root.iter():
        if _local(el.tag) == name and (el.text or "").strip():
            return (el.text or "").strip()
    return ""


def validate_endpoint_url(value: Any, label: str, *, required: bool) -> str:
    """Canlı QNB adresi: boşsa (zorunluysa) veya https değilse 400."""
    url = str(value or "").strip()
    if not url:
        if required:
            raise HTTPException(
                status_code=400,
                detail=f"QNB eFinans canlı {label} adresi zorunlu ve https olmalı.",
            )
        return ""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        raise HTTPException(
            status_code=400,
            detail=f"QNB eFinans {label} adresi geçerli bir https URL olmalı.",
        )
    return url


def connector_url(settings: dict) -> str:
    mode = str((settings or {}).get("mode") or "test").strip().lower()
    if mode in ("test", "sandbox", "demo", ""):
        return TEST_CONNECTOR_URL
    if mode == "live":
        return validate_endpoint_url((settings or {}).get("efatura_url"), "e-Fatura", required=True)
    raise HTTPException(status_code=400, detail="QNB eFinans ortamı Test veya Canlı olmalı.")


def _require_identity(settings: dict, password: str) -> Tuple[str, str, str]:
    user = str((settings or {}).get("username") or "").strip()
    tax = _digits((settings or {}).get("company_tax_id"))
    if not user or not password:
        raise HTTPException(status_code=400, detail="QNB eFinans kullanıcı adı ve şifre gerekli.")
    if len(tax) not in (10, 11):
        raise HTTPException(
            status_code=400,
            detail="QNB eFinans için şirket VKN/TCKN (10 veya 11 hane) gerekli.",
        )
    return user, password, tax


def _soap_envelope(op: str, body: str, username: str, password: str) -> str:
    """WS-Security UsernameToken zarfı. Alan değerleri XML kaçışlıdır."""
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
        f'xmlns:ser="{NS}">'
        "<soapenv:Header>"
        f'<wsse:Security xmlns:wsse="{WSSE}">'
        "<wsse:UsernameToken>"
        f"<wsse:Username>{_esc(username)}</wsse:Username>"
        f"<wsse:Password>{_esc(password)}</wsse:Password>"
        "</wsse:UsernameToken>"
        "</wsse:Security>"
        "</soapenv:Header>"
        "<soapenv:Body>"
        f"<ser:{op}>{body}</ser:{op}>"
        "</soapenv:Body>"
        "</soapenv:Envelope>"
    )


def _fault_message(root: Any) -> str:
    for el in root.iter():
        if _local(el.tag) != "Fault":
            continue
        text = _text(el, "faultstring") or _text(el, "Reason") or _text(el, "Text")
        return text or "QNB eFinans SOAP hatası."
    return ""


def _raise_if_fault(root: Any) -> None:
    message = _fault_message(root)
    if not message:
        return
    try:
        raw = ET.tostring(root, encoding="unicode")
    except Exception:
        raw = message
    logger.warning("qnb soap fault: %s", mask_sensitive_text(raw)[:2000])
    detail = mask_sensitive_text(message).strip() or "QNB eFinans SOAP hatası."
    raise HTTPException(status_code=502, detail=detail[:500])


def _parse_xml(content: bytes) -> ET.Element:
    try:
        return ET.fromstring(content)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail="QNB eFinans yanıtı okunamadı.") from exc


async def _post(url: str, action: str, xml: str) -> bytes:
    headers = {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": f'"{action}"' if action else '""',
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(url, content=xml.encode("utf-8"), headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("qnb connect failed: %s", mask_sensitive_text(str(exc))[:2000])
        raise HTTPException(status_code=502, detail="QNB eFinans'a bağlanılamadı.") from exc
    body = response.content or b""
    if body.lstrip().startswith(b"<"):
        root = _parse_xml(body)
        _raise_if_fault(root)
    if response.status_code >= 400:
        logger.warning(
            "qnb http %s: %s",
            response.status_code,
            mask_sensitive_text(response.text or "")[:2000],
        )
        raise HTTPException(status_code=502, detail="QNB eFinans isteği başarısız.")
    return body


def _param(name: str, value: str) -> str:
    if value is None or value == "":
        return ""
    return f"<{name}>{_esc(value)}</{name}>"


async def test_connection(settings: dict, password: str) -> Dict[str, Any]:
    """Kendi VKN için efaturaKullaniciBilgisi — kimlik ve uç doğrulaması."""
    user, pwd, tax = _require_identity(settings, password)
    url = connector_url(settings)
    body = _param("vergiTcKimlikNo", tax)
    xml = _soap_envelope("efaturaKullaniciBilgisi", body, user, pwd)
    root = _parse_xml(await _post(url, "efaturaKullaniciBilgisi", xml))
    count = sum(1 for el in root.iter() if _local(el.tag) == "return")
    info = {
        "ok": True,
        "message": "QNB eFinans bağlantısı doğrulandı.",
        "endpoint": url,
        "mukellef_count": count,
    }
    if str((settings or {}).get("mode") or "test").strip().lower() in ("test", "sandbox", "demo", ""):
        info["user_service"] = TEST_USER_SERVICE_URL
    return info


def _recipient_alias(settings: dict, contact: Optional[dict]) -> str:
    return str(
        (contact or {}).get("e_invoice_alias")
        or (settings or {}).get("alias")
        or ""
    ).strip()


async def send_document(
    settings: dict,
    password: str,
    invoice: dict,
    contact: Optional[dict],
    company: dict,
) -> Dict[str, Any]:
    """e-Fatura UBL'ini belgeGonderExt ile kuyruğa alır. belgeOid başarı değildir."""
    e_type = (invoice or {}).get("e_type") or ""
    if e_type != "e_invoice":
        raise HTTPException(status_code=400, detail=UNSUPPORTED_DETAIL)
    user, pwd, tax = _require_identity(settings, password)
    url = connector_url(settings)
    xslt = None
    try:
        import einvoice_designs as _ed

        xslt = await _ed.selected_xslt_for_e_type(
            "e_invoice",
            (company or {}).get("_id") or (company or {}).get("id") or (invoice or {}).get("company_id"),
        )
    except Exception:
        logger.exception("qnb selected xslt load failed")
    import isnet

    xml_text, ettn, inv_id = isnet.build_ubl(invoice, company or {}, contact, xslt=xslt)
    raw_b64 = base64.b64encode(xml_text.encode("utf-8")).decode("ascii")
    digest = hashlib.md5(xml_text.encode("utf-8")).hexdigest().upper()
    belge_no = (inv_id or ettn or "").strip()
    if not belge_no:
        raise HTTPException(status_code=502, detail="UBL fatura numarası üretilemedi.")
    parts = [
        _param("alanEtiket", _recipient_alias(settings, contact)),
        _param("belgeHash", digest),
        _param("belgeNo", belge_no),
        _param("belgeTuru", BELGE_TURU_UBL),
        _param("belgeVersiyon", BELGE_VERSIYON),
        _param("erpKodu", str((settings or {}).get("erp_code") or "").strip()),
        _param("mimeType", MIME_TYPE),
        _param("vergiTcKimlikNo", tax),
        f"<veri>{raw_b64}</veri>",
    ]
    body = "<parametreler>" + "".join(parts) + "</parametreler>"
    envelope = _soap_envelope("belgeGonderExt", body, user, pwd)
    root = _parse_xml(await _post(url, "belgeGonderExt", envelope))
    oid = _text(root, "belgeOid")
    if not oid:
        raise HTTPException(status_code=502, detail="QNB eFinans belgeOid döndürmedi.")
    return {
        "ettn": ettn,
        "gib_uuid": ettn,
        "invoice_id": inv_id,
        "ubl_id": inv_id,
        "official_invoice_id": "",
        "number_source": "",
        "document_url": "",
        "description": "",
        "belge_oid": oid,
        "qnb_belge_oid": oid,
        "einvoice_state": "pending",
        "integrator": "qnb_efinans",
        "gib_status": PROCESSING_STATUS,
        "gib_status_raw": PROCESSING_STATUS,
        "verified": False,
        "mode": (settings or {}).get("mode") or "test",
    }


def _fold(value: str) -> str:
    """Türkçe durum etiketlerini ASCII'ye katla (İşlendi → islendi)."""
    table = str.maketrans({
        "İ": "i", "I": "i", "ı": "i",
        "Ş": "s", "ş": "s",
        "Ğ": "g", "ğ": "g",
        "Ü": "u", "ü": "u",
        "Ö": "o", "ö": "o",
        "Ç": "c", "ç": "c",
    })
    return str(value or "").strip().translate(table).lower()


def _durum_kind(durum: str) -> str:
    """WSDL durum int: 1 Alındı, 2 İşleme Hatası, 3 İşlendi. Metin etiketleri de kabul."""
    raw = str(durum or "").strip()
    folded = _fold(raw)
    if raw == "2" or (raw not in ("1", "3") and "hata" in folded):
        return "error"
    if raw == "3" or folded == "islendi":
        return "ok"
    return "pending"


async def query_status(settings: dict, password: str, invoice: dict) -> Dict[str, Any]:
    """gidenBelgeDurumSorgulaExt. İşlendi başarı, İşleme Hatası açıklama ile hata."""
    user, pwd, tax = _require_identity(settings, password)
    oid = str((invoice or {}).get("qnb_belge_oid") or (invoice or {}).get("belge_oid") or "").strip()
    if oid:
        belge_no, tip = oid, "OID"
    else:
        belge_no = str(
            (invoice or {}).get("gib_invoice_id")
            or (invoice or {}).get("invoice_number")
            or ""
        ).strip()
        tip = "YEREL"
    if not belge_no:
        raise HTTPException(status_code=400, detail="QNB eFinans durum sorgusu için belgeOid veya belge no yok.")
    url = connector_url(settings)
    params = (
        _param("belgeNo", belge_no)
        + _param("belgeNoTipi", tip)
        + _param("belgeTuru", BELGE_TURU_UBL)
        + _param("donusTipiVersiyon", "6.0")
    )
    body = _param("vergiTcKimlikNo", tax) + f"<parametreler>{params}</parametreler>"
    envelope = _soap_envelope("gidenBelgeDurumSorgulaExt", body, user, pwd)
    root = _parse_xml(await _post(url, "gidenBelgeDurumSorgulaExt", envelope))
    durum = _text(root, "durum")
    aciklama = _text(root, "aciklama")
    kind = _durum_kind(durum)
    ettn = _text(root, "ettn")
    belge_out = _text(root, "belgeNo")
    if kind == "ok":
        return {
            "ok": True,
            "pending": False,
            "einvoice_state": "sent",
            "gib_status": "İşlendi",
            "message": "İşlendi",
            "aciklama": aciklama,
            "durum": durum,
            "ettn": ettn,
            "belge_no": belge_out,
            "integrator": "qnb_efinans",
            "verified": True,
        }
    if kind == "error":
        message = aciklama or "İşleme Hatası"
        return {
            "ok": False,
            "pending": False,
            "einvoice_state": "error",
            "gib_status": f"Hata: {message}",
            "message": message,
            "aciklama": aciklama,
            "durum": durum,
            "ettn": ettn,
            "belge_no": belge_out,
            "integrator": "qnb_efinans",
            "verified": False,
        }
    return {
        "ok": False,
        "pending": True,
        "einvoice_state": "pending",
        "gib_status": PROCESSING_STATUS,
        "message": "Alındı" if str(durum).strip() == "1" or _fold(durum) == "alindi" else PROCESSING_STATUS,
        "aciklama": aciklama,
        "durum": durum,
        "ettn": ettn,
        "belge_no": belge_out,
        "integrator": "qnb_efinans",
        "verified": False,
    }


def _decode_b64(payload: str) -> bytes:
    text = "".join((payload or "").split())
    if not text:
        return b""
    try:
        return base64.b64decode(text, validate=False)
    except Exception:
        return b""


def _pick_member(data: bytes, prefer: str) -> Optional[bytes]:
    """ZIP içinden PDF veya HTML. Düz PDF/HTML de kabul."""
    if not data:
        return None
    want = "pdf" if prefer == "application/pdf" else "html"
    if data[:4] == b"%PDF":
        return data if want == "pdf" else None
    head = data.lstrip()
    head_l = head[:400].lower()
    is_html = head_l.startswith(b"<html") or head_l.startswith(b"<!doctype html") or b"<html" in head_l[:200]
    if is_html:
        return data if want == "html" else None
    if data[:2] != b"PK":
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            total = 0
            chosen = None
            for info in archive.infolist():
                if info.is_dir():
                    continue
                name = info.filename.lower()
                if want == "pdf" and not name.endswith(".pdf"):
                    continue
                if want == "html" and not (name.endswith(".html") or name.endswith(".htm")):
                    continue
                if info.file_size > MAX_ZIP_MEMBER_BYTES:
                    continue
                with archive.open(info) as handle:
                    blob = handle.read(MAX_ZIP_MEMBER_BYTES + 1)
                if len(blob) > MAX_ZIP_MEMBER_BYTES:
                    continue
                total += len(blob)
                if total > MAX_ZIP_TOTAL_BYTES:
                    return chosen
                chosen = blob
                break
            return chosen
    except (zipfile.BadZipFile, RuntimeError, ValueError):
        return None


async def _download_format(
    settings: dict,
    password: str,
    tax: str,
    oid: str,
    belge_formati: str,
) -> bytes:
    user = str(settings.get("username") or "").strip()
    url = connector_url(settings)
    body = (
        _param("vergiTcKimlikNo", tax)
        + _param("belgeOidListesi", oid)
        + _param("belgeTuru", BELGE_TURU_FATURA)
        + _param("belgeFormati", belge_formati)
    )
    envelope = _soap_envelope("gidenBelgeleriIndir", body, user, password)
    root = _parse_xml(await _post(url, "gidenBelgeleriIndir", envelope))
    return _decode_b64(_text(root, "return"))


async def download_document(settings: dict, password: str, invoice: dict) -> Dict[str, Any]:
    """gidenBelgeleriIndir: önce PDF, yoksa HTML. İkisi de yoksa net mesaj."""
    user, pwd, tax = _require_identity(settings, password)
    _ = user
    oid = str((invoice or {}).get("qnb_belge_oid") or (invoice or {}).get("belge_oid") or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="QNB eFinans belgeOid yok; belge önce gönderilmeli.")
    pdf_raw = await _download_format(settings, pwd, tax, oid, "PDF")
    pdf = _pick_member(pdf_raw, "application/pdf")
    if pdf:
        return {"ok": True, "content": pdf, "media_type": "application/pdf", "message": ""}
    html_raw = await _download_format(settings, pwd, tax, oid, "HTML")
    html = _pick_member(html_raw, "text/html")
    if html:
        return {"ok": True, "content": html, "media_type": "text/html", "message": ""}
    return {
        "ok": False,
        "content": None,
        "media_type": "",
        "message": "QNB eFinans bu belge için PDF veya HTML döndürmedi.",
    }
