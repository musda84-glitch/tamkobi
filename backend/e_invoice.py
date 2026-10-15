"""Giden e-Fatura / e-Arşiv servisi.

Alıcı doğrulama → UBL → n11 Faturam (veya simülasyon) → XML arşivi + durum.
POST /api/e-invoice/create — invoice_id veya order_id.
POST /invoices/{id}/send-to-gib bu modüle delege eder.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field

import n11faturam
import isnet
import isnet_portal
import ubl_export
from buyer_tax import buyer_tax_choice, usable_tax
from invoice_edit_lock import invoice_gib_locked
from safe_error import mask_sensitive_text, public_provider_detail

_TR_TZ = ZoneInfo("Europe/Istanbul")

logger = logging.getLogger("tamkobi.e_invoice")
router = APIRouter(prefix="/api")

_db = None
_deps: Dict[str, Any] = {}

SCENARIO_MAP = {
    "TICARI": "TICARIFATURA",
    "TEMEL": "TEMELFATURA",
    "TICARIFATURA": "TICARIFATURA",
    "TEMELFATURA": "TEMELFATURA",
}


def init(db, deps: Optional[dict] = None):
    global _db
    _db = db
    if deps:
        _deps.update(deps)


def _blank_gib_id(value: Any) -> bool:
    return not str(value or "").strip()


async def migrate_mislabelled_paper_invoices(db) -> int:
    """e_type=paper, einvoice_state=sent, gib_uuid ve gib_invoice_id boş → einvoice_state=paper.

    Yalnız einvoice_state yazılır. İkinci çalıştırmada eşleşme kalmaz (idempotent).
    """
    if db is None:
        return 0
    try:
        rows = await db.invoices.find({"e_type": "paper", "einvoice_state": "sent"}).to_list(20000)
    except Exception:
        logger.exception("paper einvoice_state migration query failed")
        return 0
    updated = 0
    for inv in rows or []:
        if not _blank_gib_id(inv.get("gib_uuid")) or not _blank_gib_id(inv.get("gib_invoice_id")):
            continue
        if str(inv.get("e_type") or "") != "paper" or str(inv.get("einvoice_state") or "") != "sent":
            continue
        inv_id = inv.get("_id")
        if not inv_id:
            continue
        await db.invoices.update_one(
            {"_id": inv_id, "e_type": "paper", "einvoice_state": "sent"},
            {"$set": {"einvoice_state": "paper"}},
        )
        updated += 1
        logger.info(
            "paper einvoice_state migration: invoice %s sent → paper (gib_uuid/gib_invoice_id empty)",
            inv_id,
        )
    if updated:
        logger.info("paper einvoice_state migration updated %s invoice(s)", updated)
    return updated


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def istanbul_now() -> datetime:
    return datetime.now(_TR_TZ)


def normalize_issue_time(value: Any) -> str:
    t = str(value or "").strip()
    if len(t) == 5 and t[2] == ":":
        t = f"{t}:00"
    return t[:8] if t else ""


async def apply_issue_stamp(
    invoice_id: str,
    inv: Dict[str, Any],
    *,
    stamp_now: bool = False,
    issue_date: Optional[str] = None,
    issue_time: Optional[str] = None,
) -> Dict[str, Any]:
    """GİB kesiminden hemen önce IssueDate/IssueTime yaz (istemci «şimdi» damgası).

    stamp_now=True iken istemci tarih/saat vermezse Europe/Istanbul «şimdi» kullanılır.
    """
    patch: Dict[str, Any] = {}
    d = str(issue_date or "").strip()[:10] if issue_date is not None else ""
    t = normalize_issue_time(issue_time) if issue_time is not None else ""
    if stamp_now:
        n = istanbul_now()
        patch["issue_date"] = d if re.match(r"^\d{4}-\d{2}-\d{2}$", d) else n.strftime("%Y-%m-%d")
        patch["issue_time"] = t or n.strftime("%H:%M:%S")
    else:
        if re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            patch["issue_date"] = d
        if issue_time is not None:
            patch["issue_time"] = t
    if not patch:
        return inv
    if invoice_gib_locked(inv):
        raise HTTPException(
            status_code=400,
            detail="GİB'e iletilmiş faturada tarih/saat değiştirilemez.",
        )
    await _db.invoices.update_one({"_id": invoice_id}, {"$set": patch})
    refreshed = await _db.invoices.find_one({"_id": invoice_id})
    return {**(refreshed or inv or {}), **patch}


def digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


MANUAL_ISSUE_TYPES = frozenset({"paper", "e_export", "e_ihracat", "e_dispatch", "expense_slip"})


def _portal_password_for_advance(settings: dict) -> tuple:
    """Portal advance için şifre + ayar.

    SOAP-only kayıtlarda şifre boş olabilir; test ortamında İşNet deneme
    hesabı (12345678901 / 1234) ile Ziplenmiş → GİB iletimi ilerletilir.
    """
    password_fn: Optional[Callable] = _deps.get("password_fn")
    pwd = ""
    if password_fn:
        try:
            pwd = password_fn(settings) or ""
        except Exception:
            pwd = ""
    merged = dict(settings or {})
    if pwd:
        # mode yoksa test varsayılmaz ve arka plan Account/Login yapılmaz
        if not str(merged.get("mode") or "").strip():
            return "", merged
        return pwd, merged
    if isnet.is_test_mode(merged):
        merged.setdefault("mobile_username", isnet.TEST_PORTAL_USER)
        if not digits(merged.get("username")):
            merged["username"] = isnet.TEST_PORTAL_USER
        return isnet.TEST_PORTAL_PASSWORD, merged
    return "", merged


async def resolve_buyer_mukellef(
    company_id: str,
    tax_id: str,
    *,
    contact: Optional[dict] = None,
    contact_id: Optional[str] = None,
    refresh: bool = False,
) -> Dict[str, Any]:
    """GİB e-Fatura mükellef sorgusu → suggested_e_type (e_invoice | e_archive).

    Karar cari kartındaki is_e_invoice_user bayrağından gelmez.
    Entegratör yapılandırılmışsa canlı sorgu (aynı VKN, aynı turda tek kez);
    değilse yalnız VKN/TCKN uzunluğu ile simüle. Yer tutucu kimlikler e-Arşiv.
    unknown / hata önbelleğe yazılmaz. refresh=True önbelleği okumaz, sonucu yeniden yazar.
    Cari contact_id + company_id ile çekilir; yoksa VKN ile yedeklenir.
    """
    tid = digits(tax_id)
    local = contact
    cid = str(contact_id or (local or {}).get("_id") or (local or {}).get("id") or "").strip()
    if local is None and _db is not None:
        if cid:
            local = await _db.contacts.find_one({"_id": cid, "company_id": company_id})
        elif tid:
            local = await _db.contacts.find_one({"company_id": company_id, "tax_number_or_id": tid})
    from contact_tax import is_placeholder_tax_id
    # Boş kimlik yer tutucu gibi sorgusuz e-Arşiv. Dolu ama 10/11 hane değilse hata.
    if not tid or is_placeholder_tax_id(tid):
        return _placeholder_mukellef(tid, local)
    if len(tid) not in (10, 11):
        raise HTTPException(status_code=422, detail="VKN/TCKN 10 veya 11 haneli olmalı")

    settings = (await _db.einvoice_settings.find_one({"company_id": company_id}) if _db else None) or {}
    live = settings.get("status") == "configured"
    provider = settings.get("provider") or ""
    cache_key = f"{company_id}:{tid}:{provider}" if live and provider in ("n11faturam", "isnet", "isnet_portal") else ""
    if cache_key and not refresh:
        now = time.monotonic()
        hit = _mukellef_cache.get(cache_key)
        if hit and hit[0] > now:
            cached = dict(hit[1])
            cached["local_contact"] = local
            return cached
        inflight = _mukellef_inflight.get(cache_key)
        if inflight is not None and not inflight.done():
            shared = await asyncio.shield(inflight)
            out = dict(shared)
            out["local_contact"] = local
            return out
    if cache_key:
        task = asyncio.create_task(_resolve_buyer_mukellef_uncached(company_id, tid, local=local, settings=settings))
        if not refresh:
            _mukellef_inflight[cache_key] = task
        try:
            result = await task
        finally:
            if _mukellef_inflight.get(cache_key) is task:
                _mukellef_inflight.pop(cache_key, None)
        if result.get("lookup_status") != "unknown":
            stored = {k: v for k, v in result.items() if k != "local_contact"}
            _mukellef_cache[cache_key] = (time.monotonic() + _MUKELLEF_TTL_S, stored)
        return result
    return await _resolve_buyer_mukellef_uncached(company_id, tid, local=local, settings=settings)


async def _resolve_buyer_mukellef_uncached(
    company_id: str,
    tid: str,
    *,
    local: Optional[dict],
    settings: dict,
) -> Dict[str, Any]:
    """Canlı veya simüle mükellef çözümü. Yer tutucu / hatalı uzunluk çağıran tarafta elenir."""
    live = settings.get("status") == "configured"
    provider = settings.get("provider") or ""
    if live and provider in ("n11faturam", "isnet", "isnet_portal"):
        password_fn: Optional[Callable] = _deps.get("password_fn")
        if not password_fn:
            raise HTTPException(status_code=500, detail="e-Fatura şifre çözücü yapılandırılmamış.")
        pwd = password_fn(settings)
        src_label = {"isnet": "İşNet SOAP", "isnet_portal": "İşNet Portal"}.get(provider, "n11 Faturam")
        try:
            if provider == "isnet":
                remote = await isnet.lookup_user(settings, pwd, tid)
            elif provider == "isnet_portal":
                remote = await isnet_portal.lookup_user(settings, pwd, tid)
            else:
                remote = await n11faturam.lookup_user(settings, pwd, tid)
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(
                "GIB lookup failed provider=%s: %s",
                provider,
                mask_sensitive_text(str(e))[:2000],
            )
            raise HTTPException(status_code=502, detail=f"{src_label} GİB sorgusu başarısız.") from e
        status = str(remote.get("lookup_status") or "").strip().lower()
        if status == "unknown":
            code = int(remote.get("status_code") or 422)
            if code not in (422, 502):
                code = 422
            raise HTTPException(
                status_code=code,
                detail=str(remote.get("detail") or remote.get("message") or "GİB mükellefiyeti doğrulanamadı."),
            )
        if status == "mukellef":
            is_efatura = True
        elif status == "not_mukellef":
            is_efatura = False
        elif remote.get("is_e_invoice_user") is True:
            is_efatura = True
            status = "mukellef"
        elif remote.get("is_e_invoice_user") is False:
            is_efatura = False
            status = "not_mukellef"
        else:
            raise HTTPException(status_code=422, detail="GİB mükellefiyeti doğrulanamadı.")
        aliases = [str(a).strip() for a in (remote.get("aliases") or []) if str(a or "").strip()]
        alias = str(remote.get("alias") or "").strip() or (aliases[0] if aliases and is_efatura else "")
        if not is_efatura:
            alias = ""
            aliases = []
        elif alias and alias not in aliases:
            aliases = [alias, *aliases]
        msg = (
            f"{src_label}: {remote.get('name') or tid} e-Fatura mükellefi."
            if is_efatura
            else f"{src_label}: GİB e-Fatura listesinde kayıtlı değil (e-Arşiv kesilmeli)."
        )
        if local:
            msg = "Cari kayıtlarınızda bulundu. " + msg
        return {
            "tax_id": tid,
            "kind": "VKN" if len(tid) == 10 else "TCKN",
            "is_e_invoice_user": is_efatura,
            "suggested_e_type": "e_invoice" if is_efatura else "e_archive",
            "alias": alias or None,
            "aliases": aliases,
            "lookup_status": status,
            "source": remote.get("source") or provider,
            "name": remote.get("name") or (local or {}).get("name") or "",
            "local_contact": local,
            "message": msg,
        }

    # Simüle: cari bayrağı kullanılmaz. 10 hane VKN e-Fatura, 11 hane TCKN e-Arşiv.
    is_efatura = len(tid) == 10
    return {
        "tax_id": tid,
        "kind": "VKN" if len(tid) == 10 else "TCKN",
        "is_e_invoice_user": is_efatura,
        "suggested_e_type": "e_invoice" if is_efatura else "e_archive",
        "alias": f"urn:mail:defaultpk@{tid}.com.tr" if is_efatura else None,
        "aliases": [f"urn:mail:defaultpk@{tid}.com.tr"] if is_efatura else [],
        "lookup_status": "mukellef" if is_efatura else "not_mukellef",
        "source": provider if live else "simulated",
        "name": (local or {}).get("name") or "",
        "local_contact": local,
        "message": (
            ("Cari kayıtlarınızda bulundu." if local else "GİB e-Fatura mükellef listesinde " + (
                "kayıtlı (e-Fatura kesilmeli)." if is_efatura else "kayıtlı değil (e-Arşiv kesilmeli)."
            ))
            + ("" if live else " [SİMÜLE — entegratör bağlanınca gerçek sorgu yapılır]")
        ),
    }


def should_resolve_e_type_from_gib(e_type: Optional[str]) -> bool:
    """Kağıt / ihracat dışındaki kesimlerde tür GİB mükellef kaydından gelir."""
    if e_type is None or e_type == "" or e_type == "auto":
        return True
    return e_type not in MANUAL_ISSUE_TYPES


def honor_explicit_einvoice(e_type: Optional[str]) -> bool:
    """Eski: Temel/Ticari onayı GİB sorgusunu atlıyordu.

    issue_invoice artık açık e_invoice isteğinde de resolve_buyer_mukellef çalıştırır.
    Bu yardımcı yalnız geriye dönük testler için durur; kesim kararında kullanılmaz.
    """
    return (e_type or "").strip().lower() == "e_invoice"


NOT_EINVOICE_MUKELLEF_DETAIL = "Alıcı e-Fatura mükellefi değil, e-Arşiv kesilmeli"

# Aynı faturalama turunda (toplu kesim dahil) aynı VKN için tek canlı sorgu.
_MUKELLEF_TTL_S = 120.0
_mukellef_cache: Dict[str, tuple] = {}
_mukellef_inflight: Dict[str, "asyncio.Task"] = {}


def clear_mukellef_cache() -> None:
    _mukellef_cache.clear()
    _mukellef_inflight.clear()


def _placeholder_mukellef(tax_id: str, contact: Optional[dict] = None) -> Dict[str, Any]:
    tid = digits(tax_id)
    return {
        "tax_id": tid,
        "kind": "VKN" if len(tid) == 10 else "TCKN" if len(tid) == 11 else "UNKNOWN",
        "is_e_invoice_user": False,
        "suggested_e_type": "e_archive",
        "alias": None,
        "aliases": [],
        "lookup_status": "not_mukellef",
        "source": "placeholder",
        "name": (contact or {}).get("name") or "",
        "local_contact": contact,
        "message": "Yer tutucu VKN/TCKN — e-Fatura kesilmez, e-Arşiv kesilmeli.",
    }


def format_integrator_gib_status(
    *,
    label: str,
    mode: str = "",
    portal_status: str = "",
    verified: bool = False,
    status_code: str = "",
    detail_status: str = "",
    process_status: str = "",
) -> str:
    """Liste «GİB Durumu» metni — test/canlı + GİB iletim (DetailStatus/1300)."""
    mode_l = (mode or "").strip().lower()
    is_test = mode_l in ("test", "sandbox", "demo")
    prefix = "Test · " if is_test else ""
    portal = (portal_status or "").strip()
    code = (status_code or "").strip()
    detail = (detail_status or "").strip()
    process = (process_status or "").strip()

    # Ham DetailStatus (1300) süreç Status (Ziplendi) üzerine öncelikli
    if detail or process or portal or code:
        try:
            if detail or process:
                resolved = isnet.resolve_gib_transmission_status(
                    detail_status=detail,
                    process_status=process or portal,
                    status_code=code,
                )
            else:
                resolved = isnet.resolve_gib_transmission_status(
                    detail_status=portal if "_" in portal or (portal.isdigit()) else "",
                    process_status="" if ("_" in portal or portal.isdigit()) else portal,
                    status_code=code,
                )
            if resolved.get("status"):
                portal = resolved["status"]
            if resolved.get("status_code"):
                code = resolved["status_code"]
        except Exception:
            logging.getLogger(__name__).exception("Beklenmeyen hata (e_invoice.py)")

    if portal:
        low = portal.lower().replace("ı", "i").replace("İ", "i")
        # Yalnız gerçek 1300 / «Başarıyla Tamamlandı» — U05…068–071 NetteFatura ile aynı.
        # 1200/1220 ara kodlar olduğu gibi kalsın (sahte başarı gösterme).
        if code == "1300" or "basariyla tamamland" in low:
            portal = "Başarıyla Tamamlandı"
        elif low in ("succeed", "succeeded", "success", "approved", "completed", "ok", "gib onayli"):
            portal = "Başarıyla Tamamlandı"
        elif code == "1200" or "zarf basariyla islendi" in low:
            # Ara GİB kodu — henüz 1300 değil; NetteFatura'da da «işlendi» görünür
            portal = "Zarf işlendi — GİB tamamlanıyor"
        elif "ziplen" in low and code in ("", "1"):
            # Süreç Status=Ziplendi, DetailStatus yok — NetteFatura ara durumu
            portal = "Ziplenmiş — GİB iletimi bekleniyor"
        elif "onay bek" in low and code in ("", "1"):
            portal = "Onay bekliyor — GİB gönderimi sırada"
        elif "imza bek" in low and code in ("", "1"):
            portal = "İmza bekliyor — GİB iletimi sırada"
        elif "gib" in low and "iletildi" in low and code not in ("1300",):
            portal = "GİB'e iletildi — tamamlanıyor"
        elif code == "1220" or "hedeften sistem yaniti gelmedi" in low:
            portal = "Alıcı yanıtı bekleniyor"
        elif "wait" in low or "pending" in low:
            portal = "Alıcı yanıtı bekleniyor"
        elif (
            code in ("1150", "1160", "1162", "1177", "1195", "1210", "1215", "1230")
            or "schematron" in low
            or low.startswith("hata")
            or "fail" in low
            or "error" in low
            or "hatali" in low
            or "basarisiz" in low
            or "gonderilemedi" in low
        ):
            if not low.startswith("hata"):
                portal = f"Hata: {portal}"
        return f"{prefix}{portal}"
    if verified:
        return f"{prefix}{label} ile GİB'e iletildi"
    if is_test:
        return f"{prefix}NetteFatura'ya iletildi — GİB durumu bekleniyor"
    return f"{label} ile GİB'e iletildi — durum bekleniyor"


class InvoiceCreateRequest(BaseModel):
    order_id: Optional[str] = None
    invoice_id: Optional[str] = None
    company_id: Optional[str] = None
    scenario: str = "TICARI"
    e_type: Optional[str] = None
    stamp_now: Optional[bool] = None
    issue_date: Optional[str] = None
    issue_time: Optional[str] = None


def scenario_short(gib_scenario: Optional[str]) -> str:
    s = (gib_scenario or "").upper()
    if "TEMEL" in s:
        return "TEMEL"
    if "EARSIV" in s or "ARŞIV" in s or "ARSIV" in s:
        return "EARSIV"
    if "IHRACAT" in s:
        return "IHRACAT"
    return "TICARI"


def state_to_track_status(einvoice_state: Optional[str]) -> str:
    return {
        "draft": "DRAFT",
        "queued": "DRAFT",
        "sent": "SENT",
        "accepted": "ACCEPTED",
        "rejected": "REJECTED",
        "cancelled": "CANCELLED",
        "error": "REJECTED",
    }.get((einvoice_state or "draft").lower(), "DRAFT")


async def record_e_invoice(
    *,
    company_id: Optional[str],
    invoice_id: str,
    order_id: Optional[str] = None,
    result: Optional[Dict[str, Any]] = None,
) -> None:
    """e_invoices takip belgesi (docs koleksiyonu; kullanıcı şablonundaki alanlarla uyumlu)."""
    if not _db or not invoice_id:
        return
    inv = await _db.invoices.find_one({"_id": invoice_id}) or {}
    result = result or {}
    doc_id = f"einv_{invoice_id}"
    status = state_to_track_status(result.get("einvoice_state") or inv.get("einvoice_state"))
    payload = {
        "_id": doc_id,
        "company_id": company_id or inv.get("company_id") or "",
        "order_id": order_id or inv.get("order_id") or inv.get("source_order_id") or "",
        "invoice_id": invoice_id,
        "invoice_number": result.get("invoice_number") or inv.get("invoice_number"),
        "scenario": scenario_short(result.get("scenario") or inv.get("gib_scenario")),
        "status": status,
        "total_amount": float(inv.get("grand_total") or 0),
        "gib_uuid": result.get("gib_uuid") or inv.get("gib_uuid"),
        "pdf_url": result.get("document_url") or inv.get("gib_document_url") or "",
        "updated_at": _now(),
    }
    existing = await _db.e_invoices.find_one({"_id": doc_id})
    if not existing:
        payload["created_at"] = _now()
    await _db.e_invoices.update_one({"_id": doc_id}, {"$set": payload}, upsert=True)


async def finalize_create_result(
    result: Dict[str, Any],
    invoice_id: str,
    *,
    order_id: Optional[str] = None,
    company_id: Optional[str] = None,
) -> Dict[str, Any]:
    inv = await _db.invoices.find_one({"_id": invoice_id}) or {}
    out = dict(result or {})
    out.setdefault("invoice_id", invoice_id)
    out.setdefault("invoice_number", inv.get("invoice_number"))
    out.setdefault("company_id", company_id or inv.get("company_id"))
    out.setdefault("message", out.get("message") or "Fatura GİB sistemine başarıyla iletildi.")
    oid = order_id or inv.get("order_id")
    if oid and out.get("status") != "error":
        e_type = out.get("e_type") or inv.get("e_type") or "e_archive"
        einvoice_state = out.get("einvoice_state") or inv.get("einvoice_state") or "sent"
        order_patch = {
            "is_invoiced": True,
            "invoice_id": invoice_id,
            "invoice_number": inv.get("invoice_number"),
            # Sipariş listesi rozeti: Faturalaşmış (E-Fatura|E-Arşiv) — kırmızı bilgi
            "e_type": e_type,
            "invoice_e_type": e_type,
            "einvoice_state": einvoice_state,
        }
        await _db.orders.update_one({"_id": oid}, {"$set": order_patch})
        from dispatch_invoice import order_ids_of
        for extra in order_ids_of(inv):
            if extra == oid:
                continue
            await _db.orders.update_one({"_id": extra}, {"$set": order_patch})
        out.setdefault("order_id", oid)
        out.setdefault("e_type", e_type)
    await record_e_invoice(
        company_id=out.get("company_id"),
        invoice_id=invoice_id,
        order_id=oid,
        result=out,
    )
    logger.info("E-Fatura oluşturuldu: %s (sipariş=%s)", out.get("invoice_number"), oid or "-")
    return out


async def _finish_issued_invoice(inv: Dict[str, Any], result: Dict[str, Any]) -> Dict[str, Any]:
    """Kesim başarılı: bağlı siparişler faturalansın; taslak irsaliye varsa uyarı eklensin."""
    import dispatch_invoice as _di
    warn = await _di.draft_dispatch_warning(_db, inv)
    await _di.mark_orders_invoiced(_db, inv)
    if warn:
        result = {**result, "warning": warn, "dispatch_draft_warning": warn}
    return result


def normalize_scenario(raw: Optional[str], e_type: str) -> str:
    if (e_type or "") == "e_archive":
        return "EARSIVFATURA"
    if (e_type or "") in ("e_export", "e_ihracat"):
        return "IHRACAT"
    return SCENARIO_MAP.get((raw or "TICARI").strip().upper(), "TICARIFATURA")


def validate_buyer(contact: Optional[dict], invoice: dict, e_type: str) -> Dict[str, Any]:
    name = ((contact or {}).get("name") or invoice.get("contact_name") or "").strip()
    tax = buyer_tax_choice(invoice, contact)["tax"]
    if not name:
        raise HTTPException(status_code=400, detail="Alıcı ünvanı zorunludur (GİB).")
    if e_type == "e_invoice" and len(tax) not in (10, 11):
        raise HTTPException(status_code=400, detail="e-Fatura için alıcı VKN (10) veya TCKN (11) zorunludur.")
    if e_type == "e_dispatch" and len(tax) not in (10, 11):
        raise HTTPException(status_code=400, detail="e-İrsaliye için alıcı VKN (10) veya TCKN (11) zorunludur.")
    if e_type == "e_archive" and tax and len(tax) not in (10, 11):
        raise HTTPException(status_code=400, detail="Alıcı vergi kimlik numarası 10 veya 11 haneli olmalıdır.")
    return {
        "name": name,
        "tax_id": tax or ("11111111111" if e_type == "e_archive" else tax),
        "tax_office": (contact or {}).get("tax_office") or "",
        "address": (contact or {}).get("address") or invoice.get("contact_address") or invoice.get("shipping_address") or "",
        "city": (contact or {}).get("city") or invoice.get("city") or "",
        "email": (contact or {}).get("email") or "",
        "phone": (contact or {}).get("phone") or invoice.get("customer_phone") or "",
        "is_e_invoice_user": bool((contact or {}).get("is_e_invoice_user")),
    }


async def store_outgoing_xml(invoice_id: str, company_id: str, xml_bytes: bytes, meta: Optional[dict] = None) -> None:
    await _db.outgoing_einvoice_xml.update_one(
        {"_id": invoice_id},
        {
            "$set": {
                "invoice_id": invoice_id,
                "company_id": company_id,
                "xml": xml_bytes.decode("utf-8", "replace"),
                "byte_len": len(xml_bytes),
                "updated_at": _now(),
                **(meta or {}),
            }
        },
        upsert=True,
    )


async def build_and_store_xml(invoice: dict, company: dict, contact: Optional[dict], scenario: str) -> bytes:
    inv = {**invoice, "gib_scenario": scenario}
    if scenario in ("TEMELFATURA", "TICARIFATURA"):
        inv["e_type"] = "e_invoice"
        inv["_profile_override"] = scenario
    try:
        from stock_codes import fill_stock_codes
        await fill_stock_codes(_db, inv.get("company_id"), inv.get("items") or [])
    except Exception:
        logger.exception("e-invoice stock code fill failed")
    seller = {
        "name": company.get("name"),
        "tax_number": company.get("tax_number") or company.get("tax_id"),
        "tax_office": company.get("tax_office"),
        "city": company.get("city"),
        "address": company.get("address"),
        "email": company.get("email"),
        "phone": company.get("phone"),
        "iban": company.get("iban"),
        "bank_name": company.get("bank_name"),
    }
    buyer = ubl_export._buyer_from(inv, contact)
    xslt = None
    try:
        import einvoice_designs as _ed
        xslt = await _ed.selected_xslt_for_e_type(
            inv.get("e_type") or "e_invoice",
            inv.get("company_id") or (company or {}).get("_id") or (company or {}).get("id"),
        )
    except Exception:
        logger.exception("e-invoice selected xslt load failed")
    xml = ubl_export.build_invoice_ubl(inv, seller, buyer, xslt=xslt)
    await store_outgoing_xml(str(inv.get("_id") or inv.get("id")), inv["company_id"], xml, {"scenario": scenario, "source": "ubl_export"})
    return xml


async def issue_invoice(
    invoice_id: str,
    *,
    e_type: Optional[str] = None,
    scenario: Optional[str] = None,
    stamp_now: bool = False,
    issue_date: Optional[str] = None,
    issue_time: Optional[str] = None,
) -> Dict[str, Any]:
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if inv.get("direction") == "incoming" or inv.get("source") == "edoc_inbox":
        raise HTTPException(status_code=400, detail="Gelen e-fatura kesilmez; Onayla/Reddet kullanın.")
    if inv.get("invoice_type") == "purchase" and (e_type or inv.get("e_type")) == "e_invoice":
        raise HTTPException(status_code=400, detail="Alış e-faturası GİB'den gelir; kesim yalnızca satış belgelerinde yapılır.")

    inv = await apply_issue_stamp(
        invoice_id,
        inv,
        stamp_now=bool(stamp_now),
        issue_date=issue_date,
        issue_time=issue_time,
    )

    contact_filt = None
    if inv.get("contact_id") and inv.get("company_id"):
        contact_filt = {"_id": inv.get("contact_id"), "company_id": inv.get("company_id")}
    contact = await _db.contacts.find_one(contact_filt) if contact_filt else None
    if inv.get("invoice_type") == "sales" and contact:
        from contact_tax import contact_tax_patch
        tax_patch = contact_tax_patch(
            contact,
            inv.get("contact_tax_id") or inv.get("buyer_tax_id"),
            inv.get("contact_tax_office"),
        )
        if tax_patch:
            await _db.contacts.update_one(contact_filt, {"$set": tax_patch})
            contact = {**contact, **tax_patch}
    requested = e_type if e_type is not None else inv.get("e_type")
    requested_l = (requested or "").strip().lower()
    gib_meta: Optional[Dict[str, Any]] = None
    # İrsaliye belgesi — GİB mükellef çözümlemesi e_archive'a çevirmesin
    if inv.get("invoice_type") == "dispatch" or (requested or inv.get("e_type")) == "e_dispatch":
        e_type = "e_dispatch"
    # İhracat / kağıt kuralları aynı kalır; mükellef sorgusu bunları e-Arşiv'e çevirmez.
    elif requested_l in MANUAL_ISSUE_TYPES or (
        inv.get("trade_kind") == "export" and requested_l in ("", "auto", "e_export", "e_ihracat")
    ):
        if requested_l in ("", "auto") and inv.get("trade_kind") == "export":
            e_type = "e_export"
        elif requested_l == "e_ihracat":
            e_type = "e_export"
        else:
            e_type = requested or inv.get("e_type")
    elif should_resolve_e_type_from_gib(requested):
        # e_type=e_invoice açıkça gelse bile alıcı VKN/TCKN için GİB sorgusu çalışır.
        # Belgede yer tutucu/boş, caride gerçek VKN varsa cari kullanılır ve taslak güncellenir.
        choice = buyer_tax_choice(inv, contact)
        tax = choice["tax"]
        if choice["mismatch"]:
            logger.info(
                "alıcı VKN fatura ile cari farklı doc=%s contact=%s invoice=%s",
                choice["doc_tax"],
                choice["contact_tax"],
                invoice_id,
            )
        from contact_tax import is_placeholder_tax_id
        if (
            tax
            and not is_placeholder_tax_id(tax)
            and not usable_tax(choice.get("doc_tax"))
            and inv.get("contact_tax_id") != tax
        ):
            await _db.invoices.update_one({"_id": invoice_id}, {"$set": {"contact_tax_id": tax}})
            inv = {**inv, "contact_tax_id": tax}
        if not tax or is_placeholder_tax_id(tax):
            gib_meta = _placeholder_mukellef(tax, contact)
        elif len(tax) not in (10, 11):
            raise HTTPException(status_code=422, detail="VKN/TCKN 10 veya 11 haneli olmalı")
        else:
            gib_meta = await resolve_buyer_mukellef(
                inv.get("company_id") or "",
                tax,
                contact=contact,
                contact_id=inv.get("contact_id"),
            )
        if (
            contact
            and contact.get("_id")
            and not choice["mismatch"]
            and bool(contact.get("is_e_invoice_user")) != bool(gib_meta["is_e_invoice_user"])
        ):
            alias_set = gib_meta.get("alias")
            await _db.contacts.update_one(
                {"_id": contact["_id"]},
                {"$set": {
                    "is_e_invoice_user": bool(gib_meta["is_e_invoice_user"]),
                    "e_invoice_alias": alias_set,
                    "updated_at": _now(),
                }},
            )
            contact = {
                **contact,
                "is_e_invoice_user": bool(gib_meta["is_e_invoice_user"]),
                "e_invoice_alias": alias_set,
            }
        # Alias kesimde cari kartındaki eski etiketten değil, bu sorgunun sonucundan gelir.
        if gib_meta.get("alias"):
            contact = {**(contact or {}), "e_invoice_alias": gib_meta.get("alias")}
        elif contact is not None and not gib_meta.get("is_e_invoice_user"):
            contact = {**contact, "e_invoice_alias": None}
        if requested_l == "e_invoice" and not gib_meta.get("is_e_invoice_user"):
            raise HTTPException(status_code=409, detail=NOT_EINVOICE_MUKELLEF_DETAIL)
        e_type = gib_meta["suggested_e_type"]

    if inv.get("invoice_type") == "purchase" and (e_type or inv.get("e_type")) == "e_invoice":
        raise HTTPException(status_code=400, detail="Alış e-faturası GİB'den gelir; kesim yalnızca satış belgelerinde yapılır.")

    if e_type:
        await _db.invoices.update_one({"_id": invoice_id}, {"$set": {"e_type": e_type}})
        refreshed = await _db.invoices.find_one({"_id": invoice_id})
        inv = {**(refreshed or inv or {}), "e_type": e_type}

    et = e_type or (inv.get("e_type") if inv else None) or "e_archive"
    scen = "TEMELIRSALIYE" if et == "e_dispatch" else normalize_scenario(scenario or inv.get("gib_scenario"), et)
    # GİB Schematron: IADE / TEVKIFATIADE → TICARIFATURA yasak
    if ubl_export.is_return_invoice(inv) or ubl_export.gib_invoice_type_code(inv) in (
        "IADE",
        "TEVKIFATIADE",
    ):
        if et == "e_invoice" and scen == "TICARIFATURA":
            scen = "TEMELFATURA"
        if et == "e_invoice" and not ubl_export.return_billing_ref(inv):
            raise HTTPException(
                status_code=400,
                detail=(
                    "İade e-faturası için orijinal fatura numarası zorunlu (GİB Schematron / BillingReference). "
                    "Nota «… numaralı faturaya istinaden» ekleyin veya original_invoice_number girin."
                ),
            )
    if et != "e_dispatch" and ubl_export.invoice_has_zero_vat(inv) and not ubl_export.resolve_tax_exemption(inv):
        line_ok = any(
            ubl_export.resolve_tax_exemption(inv, it)
            for it in (inv.get("items") or [])
            if float(it.get("vat_rate") or 0) == 0
        )
        if not line_ok:
            raise HTTPException(
                status_code=400,
                detail=(
                    "KDV %0 satırlarda vergi muafiyet sebebi zorunlu. "
                    "E-fatura onayında muafiyet / istisna kodunu seçin."
                ),
            )
    buyer = validate_buyer(contact, inv, et)
    company = await _db.companies.find_one({"_id": inv.get("company_id")}) or {}

    if et == "e_dispatch":
        from despatch_shipment import despatch_gib_accepted, is_incoming_dispatch, shipment_problems

        if is_incoming_dispatch(inv):
            raise HTTPException(status_code=400, detail="Gelen e-irsaliye gönderilemez.")
        if despatch_gib_accepted(inv):
            raise HTTPException(
                status_code=409,
                detail="Bu irsaliye GİB tarafından kabul edilmiş; tekrar gönderilemez.",
            )
        problems = shipment_problems(inv, {
            "name": company.get("name"),
            "tax_number": company.get("tax_number") or company.get("tax_id"),
        })
        if problems:
            raise HTTPException(status_code=422, detail=" ".join(problems))

    if et == "paper":
        # Kağıt / matbu GİB'e gitmez. "sent" gerçek e-belge sanılıp kırmızı rozet
        # ve «GİB:» etiketi üretiyordu.
        await _db.invoices.update_one(
            {"_id": invoice_id},
            {"$set": {
                "status": "approved",
                "gib_status": "Kağıt Fatura (Matbu)",
                "einvoice_state": "paper",
                "gib_scenario": None,
                "gib_tracking_id": None,
                "issued_at": _now(),
            }},
        )
        return await _finish_issued_invoice(inv, {"status": "success", "einvoice_state": "paper", "message": "Kağıt fatura olarak kesildi.", "invoice_id": invoice_id, "tracking_id": None})

    settings = await _db.einvoice_settings.find_one({"company_id": inv.get("company_id")}) or {}
    provider = settings.get("provider") or ""
    if provider in ("isnet", "isnet_portal") and not isnet.explicit_environment(settings):
        raise HTTPException(status_code=400, detail=isnet.MODE_REQUIRED_DETAIL)

    await _db.invoices.update_one(
        {"_id": invoice_id},
        {"$set": {"einvoice_state": "queued", "gib_scenario": scen, "gib_status": "Kuyrukta", "queued_at": _now()}},
    )
    try:
        if et == "e_dispatch":
            seller = {
                "name": company.get("name"),
                "tax_number": company.get("tax_number") or company.get("tax_id"),
                "tax_office": company.get("tax_office"),
                "city": company.get("city"),
                "address": company.get("address"),
                "email": company.get("email"),
                "phone": company.get("phone"),
            }
            xslt = None
            try:
                import einvoice_designs as _ed
                xslt = await _ed.selected_xslt_for_e_type(
                    "e_dispatch",
                    inv.get("company_id") or (company or {}).get("_id") or (company or {}).get("id"),
                )
            except Exception:
                logger.exception("e-irsaliye seçili XSLT yüklenemedi")
            xml = ubl_export.build_despatch_ubl(
                {**inv, "gib_scenario": scen}, seller, ubl_export._buyer_from(inv, contact),
                send_ready=False, xslt=xslt,
            )
            await store_outgoing_xml(invoice_id, inv["company_id"], xml, {"scenario": scen, "source": "ubl_despatch"})
        else:
            await build_and_store_xml({**inv, "gib_scenario": scen}, company, contact, scen)
    except Exception:
        logger.exception("UBL arşivi yazılamadı: %s", invoice_id)

    settings = await _db.einvoice_settings.find_one({"company_id": inv.get("company_id")}) or {}
    password_fn: Optional[Callable] = _deps.get("password_fn")
    consume = _deps.get("consume_credits")

    provider = settings.get("provider") or ""
    live_providers = ("n11faturam", "isnet", "isnet_portal")
    # e-İrsaliye yalnızca İşNet SOAP (portal da aynı WSDL)
    live_etypes = ("e_invoice", "e_archive") + (("e_dispatch",) if provider in ("isnet", "isnet_portal") else ())
    if provider in live_providers and et in live_etypes:
        if settings.get("status") != "configured":
            labels = {
                "n11faturam": "n11 Faturam",
                "isnet": "İşNet SOAP API",
                "isnet_portal": "İşNet Web Portal",
            }
            label = labels.get(provider, provider)
            await _db.invoices.update_one(
                {"_id": invoice_id},
                {"$set": {
                    "einvoice_state": "error",
                    "gib_status": f"Hata: {label} yapılandırılmamış",
                    "gib_error": "integrator_not_configured",
                    "error_at": _now(),
                }},
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{label} seçili ama bağlantı yapılandırılmamış / test edilmemiş. "
                    "Ayarlar → e-Fatura entegrasyonundan kaydedip test edin; "
                    "simüle GİB gönderimi yapılmaz."
                ),
            )
        if et == "e_dispatch" and settings.get("e_dispatch_enabled") is False:
            await _db.invoices.update_one(
                {"_id": invoice_id},
                {"$set": {
                    "einvoice_state": "error",
                    "gib_status": "Hata: e-İrsaliye kapalı",
                    "gib_error": "e_dispatch_disabled",
                    "error_at": _now(),
                }},
            )
            raise HTTPException(
                status_code=400,
                detail="e-İrsaliye Ayarlar → İşNet panelinde kapalı. Açıp tekrar deneyin.",
            )
        if not password_fn:
            raise HTTPException(status_code=500, detail="e-Fatura şifre çözücü yapılandırılmamış.")
        pwd = password_fn(settings) or ""
        if provider == "n11faturam":
            sender, label = n11faturam, "n11 Faturam"
        elif et == "e_dispatch":
            # Portal stub yerine SOAP SendDespatchAdviceXml
            sender, label = isnet, "İşNet SOAP API"
        elif provider == "isnet_portal":
            sender, label = isnet_portal, "İşNet Web Portal"
        else:
            sender, label = isnet, "İşNet SOAP API"
        try:
            sent = await sender.send_document(
                settings, pwd, {**inv, "id": invoice_id, "e_type": et, "gib_scenario": scen}, contact, company
            )
        except HTTPException as e:
            await _db.invoices.update_one(
                {"_id": invoice_id},
                {"$set": {"einvoice_state": "error", "gib_status": f"Hata: {e.detail}", "gib_error": str(e.detail)[:500], "error_at": _now()}},
            )
            raise
        except Exception as e:
            await _db.invoices.update_one(
                {"_id": invoice_id},
                {"$set": {"einvoice_state": "error", "gib_status": f"Hata: {e}", "gib_error": str(e)[:500], "error_at": _now()}},
            )
            logger.warning(
                "integrator send failed invoice=%s: %s",
                invoice_id,
                mask_sensitive_text(str(e))[:2000],
            )
            raise HTTPException(status_code=502, detail="Entegratör gönderimi başarısız.") from e

        tracking = (sent.get("ettn") or "").strip()
        # İşNet: yalnızca UUID ETTN — yerel fatura no ile sahte «iletildi» yok
        if provider in ("isnet", "isnet_portal"):
            if not isnet.is_ettn_uuid(tracking):
                await _db.invoices.update_one(
                    {"_id": invoice_id},
                    {"$set": {
                        "einvoice_state": "error",
                        "gib_status": "Hata: İşNet geçerli ETTN (UUID) döndürmedi",
                        "gib_error": "missing_or_invalid_ettn",
                        "error_at": _now(),
                    }},
                )
                raise HTTPException(
                    status_code=502,
                    detail=f"{label} geçerli ETTN (UUID) döndürmedi — NetteFatura/GİB kaydı doğrulanamadı.",
                )
        else:
            tracking = (tracking or (sent.get("invoice_id") or "").strip()).strip()
            if not tracking:
                await _db.invoices.update_one(
                    {"_id": invoice_id},
                    {"$set": {
                        "einvoice_state": "error",
                        "gib_status": "Hata: Entegratör ETTN/fatura no döndürmedi",
                        "gib_error": "missing_ettn",
                        "error_at": _now(),
                    }},
                )
                raise HTTPException(
                    status_code=502,
                    detail=f"{label} ETTN/fatura numarası döndürmedi — NetteFatura/GİB kaydı doğrulanamadı.",
                )

        # Canlı entegratör (İşNet / n11): kontör entegratör bakiyesinden düşer.
        # Platform «GİB kontör» cüzdanı yalnızca simüle gönderimde zorunlu (aşağıda).
        remaining = None
        # Resmi GİB/NetteFatura no — yerel TKB UBL id listeyi ezmesin
        official = (sent.get("official_invoice_id") or "").strip()
        number_source = (sent.get("number_source") or "").strip()
        gib_no = official or ""
        if not gib_no and number_source in ("portal", "xml", "soap", "isnet"):
            gib_no = (sent.get("invoice_id") or "").strip()
        if not gib_no and provider not in ("isnet", "isnet_portal"):
            gib_no = (sent.get("invoice_id") or "").strip()
        gib_mode = (sent.get("mode") or settings.get("mode") or "test").strip()
        gib_status = format_integrator_gib_status(
            label=label,
            mode=gib_mode,
            portal_status=sent.get("gib_status_raw") or "",
            verified=bool(sent.get("verified")),
            status_code=str(sent.get("gib_status_code") or ""),
            detail_status=str(sent.get("detail_status") or ""),
            process_status=str(sent.get("process_status") or ""),
        )
        gib_code = sent.get("gib_status_code") or None
        if not gib_code and "Başarıyla Tamamlandı" in gib_status:
            gib_code = "1300"
        patch = {
            "status": "approved",
            "einvoice_state": "sent",
            "gib_status": gib_status,
            "gib_status_code": gib_code,
            "gib_detail_status": sent.get("detail_status") or None,
            "gib_process_status": sent.get("process_status") or None,
            "gib_tracking_id": tracking,
            "gib_uuid": sent.get("ettn"),
            "gib_invoice_id": gib_no or None,
            "gib_document_url": sent.get("document_url") or "",
            "integrator": provider,
            "gib_scenario": scen,
            "gib_mode": gib_mode,
            "issued_at": _now(),
            "buyer_tax_id": buyer["tax_id"],
        }
        sent_vendor = str(sent.get("vendor_number") or "").strip()
        if sent_vendor:
            patch["gib_vendor_number"] = sent_vendor
        # GİB / NetteFatura fatura numarası geldiyse liste numarası da onu göstersin
        if gib_no and et != "e_dispatch":
            if gib_no.upper() != str(inv.get("invoice_number") or "").strip().upper():
                patch["local_invoice_number"] = inv.get("invoice_number")
            patch["invoice_number"] = gib_no
        await _db.invoices.update_one({"_id": invoice_id}, {"$set": patch})
        try:
            archive_inv = {
                **inv,
                "e_type": et,
                "gib_scenario": scen,
                "invoice_number": gib_no or inv.get("invoice_number"),
            }
            if et == "e_dispatch":
                dispatch_xslt = None
                try:
                    import einvoice_designs as _ed
                    dispatch_xslt = await _ed.selected_xslt_for_e_type(
                        "e_dispatch",
                        inv.get("company_id") or (company or {}).get("_id") or (company or {}).get("id"),
                    )
                except Exception:
                    logger.exception("e-irsaliye arşiv XSLT yüklenemedi")
                xml_str, ettn, _iid = isnet.build_despatch_ubl(
                    archive_inv, company, contact, ettn=sent.get("ettn"), xslt=dispatch_xslt,
                )
            else:
                archive_xslt = None
                try:
                    import einvoice_designs as _ed
                    archive_xslt = await _ed.selected_xslt_for_e_type(
                        et,
                        inv.get("company_id") or (company or {}).get("_id") or (company or {}).get("id"),
                    )
                except Exception:
                    logger.exception("e-fatura arşiv XSLT yüklenemedi")
                if provider in ("isnet", "isnet_portal"):
                    # İşNet: ubl_export üzerinden (TEVKIFAT/IADE); n11faturam değil
                    xml_str, ettn, _iid = isnet.build_ubl(
                        archive_inv, company, contact, ettn=sent.get("ettn"), xslt=archive_xslt,
                    )
                else:
                    xml_str, ettn, _iid = n11faturam.build_ubl(
                        archive_inv, company, contact, ettn=sent.get("ettn"), xslt=archive_xslt,
                    )
            await store_outgoing_xml(
                invoice_id, inv["company_id"], xml_str.encode("utf-8"),
                {"scenario": scen, "ettn": ettn, "source": provider},
            )
        except Exception:
            logger.exception("%s UBL arşivi yazılamadı", provider)
        if et == "e_dispatch":
            msg = f"e-İrsaliye {label} üzerinden İşNet/GİB'e iletildi. ETTN: {tracking}"
            patch_extra = {"dispatch_status": "sent"}
            await _db.invoices.update_one({"_id": invoice_id}, {"$set": patch_extra})
        else:
            msg = f"Fatura {label} üzerinden GİB'e iletildi. ETTN: {tracking}"
        if gib_no:
            msg = f"{'İrsaliye' if et == 'e_dispatch' else 'Fatura'} no {gib_no}. {msg}"
        if gib_meta and et != "e_dispatch":
            msg = f"{'E-Fatura' if et == 'e_invoice' else 'E-Arşiv'} (GİB). {msg}"
        if gib_mode.lower() in ("test", "sandbox", "demo"):
            msg = f"[Test] {msg}"
        return await _finish_issued_invoice(inv, {
            "status": "success",
            "einvoice_state": "sent",
            "message": msg,
            "invoice_id": invoice_id,
            "invoice_number": gib_no or inv.get("invoice_number"),
            "e_type": et,
            "gib_uuid": sent.get("ettn"),
            "gib_invoice_id": gib_no or None,
            "gib_status": gib_status,
            "tracking_id": tracking,
            "document_url": sent.get("document_url") or "",
            "provider": provider,
            "mode": gib_mode,
            "scenario": scen,
            "gib_credits_left": remaining,
            "gib_lookup": gib_meta,
        })

    if et == "e_dispatch":
        await _db.invoices.update_one(
            {"_id": invoice_id},
            {"$set": {
                "einvoice_state": "draft",
                "gib_status": "Taslak (e-İrsaliye) — İşNet yapılandırın",
                "gib_error": "isnet_required_for_despatch",
                "error_at": _now(),
            }},
        )
        raise HTTPException(
            status_code=400,
            detail=(
                "e-İrsaliye yalnızca İşNet (SOAP) üzerinden gönderilir. "
                "Ayarlar → e-Fatura entegratörünü İşNet olarak kaydedip test edin."
            ),
        )

    remaining = None
    # Simüle / kağıt dışı yerel GİB yolu — platform kontörü burada düşer
    if consume:
        remaining = await consume(inv.get("company_id"), 1, invoice_id=invoice_id, note=inv.get("invoice_number") or invoice_id)
    tracking = f"GIB-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    export = et in ("e_export", "e_ihracat") or inv.get("trade_kind") == "export"
    gib_status = "e-İhracat GİB'e iletildi" if export else "Başarıyla İletildi (GİB Onaylı)"
    patch = {
        "status": "approved",
        "einvoice_state": "sent",
        "gib_status": gib_status,
        "gib_tracking_id": tracking,
        "gib_uuid": str(uuid.uuid4()).upper(),
        "gib_scenario": scen,
        "integrator": settings.get("provider") or "simulated",
        "gib_mode": settings.get("mode") or "simulated",
        "issued_at": _now(),
        "buyer_tax_id": buyer["tax_id"],
    }
    await _db.invoices.update_one({"_id": invoice_id}, {"$set": patch})
    if export:
        message = f"e-İhracat faturası GİB sistemine iletildi. ETTN/Takip No: {tracking}"
    elif gib_meta:
        kind = "E-Fatura" if et == "e_invoice" else "E-Arşiv"
        message = f"{kind} olarak kesildi (GİB mükellef kaydı). ETTN/Takip No: {tracking}"
    else:
        message = f"Fatura GİB sistemine başarıyla iletildi ve imzalandı. ETTN/Takip No: {tracking}"
    return await _finish_issued_invoice(inv, {
        "status": "success",
        "einvoice_state": "sent",
        "message": message,
        "invoice_id": invoice_id,
        "e_type": et,
        "tracking_id": tracking,
        "gib_uuid": patch["gib_uuid"],
        "provider": patch["integrator"],
        "mode": patch["gib_mode"],
        "scenario": scen,
        "gib_credits_left": remaining,
        "gib_lookup": gib_meta,
    })


async def create_from_order(order_id: str, req: Dict[str, Any]) -> Dict[str, Any]:
    convert = _deps.get("convert_order")
    if not convert:
        raise HTTPException(status_code=500, detail="Sipariş→fatura dönüştürücü yapılandırılmamış.")
    order = await _db.orders.find_one({"_id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    company_id = (req.get("company_id") or "").strip()
    if company_id and order.get("company_id") and order.get("company_id") != company_id:
        raise HTTPException(status_code=403, detail="Sipariş bu firmaya ait değil.")
    inv_id = order.get("invoice_id")
    if not inv_id:
        converted = await convert(order_id, {"e_type": req.get("e_type") or "e_archive"})
        inv_id = converted.get("invoice_id")
        if not inv_id:
            raise HTTPException(status_code=400, detail=converted.get("message") or "Sipariş faturaya dönüştürülemedi.")
    inv_q = {"_id": inv_id}
    if company_id:
        inv_q["company_id"] = company_id
    inv = await _db.invoices.find_one(inv_q)
    if inv and inv.get("status") == "draft" and inv.get("invoice_type") != "dispatch" and inv.get("e_type") != "e_dispatch":
        raise HTTPException(status_code=409, detail="Önce Faturalaştırın")
    result = await issue_invoice(
        inv_id,
        e_type=req.get("e_type"),
        scenario=req.get("scenario"),
        stamp_now=bool(req.get("stamp_now")),
        issue_date=req.get("issue_date"),
        issue_time=req.get("issue_time"),
    )
    return await finalize_create_result(result, inv_id, order_id=order_id, company_id=company_id or order.get("company_id"))


@router.get("/e-invoice/integrator-credits")
async def api_integrator_credits(company_id: str = "comp_nexus_main_01"):
    """Entegratör (İşNet SOAP vb.) kontör / bakiye — yerel gib-credits cüzdanı değil."""
    settings = (await _db.einvoice_settings.find_one({"company_id": company_id}) if _db else None) or {}
    provider = (settings.get("provider") or "").strip()
    if settings.get("status") != "configured" or provider not in ("isnet", "isnet_portal", "n11faturam"):
        return {
            "company_id": company_id,
            "provider": provider or None,
            "balance": None,
            "source": "none",
            "message": "Entegratör yapılandırılmamış — kontör bilgisi alınamadı.",
        }
    password_fn: Optional[Callable] = _deps.get("password_fn")
    _ = password_fn  # SOAP IP–VKN; şifre gerekmez
    label = {"isnet": "İşNet SOAP", "isnet_portal": "İşNet Portal", "n11faturam": "n11 Faturam"}.get(provider, provider)
    try:
        if provider in ("isnet", "isnet_portal"):
            try:
                isnet.require_explicit_mode(settings)
            except HTTPException as e:
                return {
                    "company_id": company_id,
                    "provider": provider,
                    "balance": None,
                    "source": provider,
                    "message": e.detail if isinstance(e.detail, str) else isnet.MODE_REQUIRED_DETAIL,
                }
            bal = await isnet.get_company_balance(settings)
            src = provider
        else:
            return {
                "company_id": company_id,
                "provider": provider,
                "balance": None,
                "source": provider,
                "message": "n11 Faturam kontör sorgusu bu uçtan desteklenmiyor.",
            }
    except HTTPException as e:
        logger.warning(
            "integrator credit query: %s",
            mask_sensitive_text(str(getattr(e, "detail", e)))[:2000],
        )
        raise HTTPException(
            status_code=e.status_code,
            detail=public_provider_detail(f"{label} kontör sorgusu başarısız.", e.detail),
        ) from e
    except Exception as e:
        logger.warning("integrator credit query failed: %s", mask_sensitive_text(str(e))[:2000])
        raise HTTPException(status_code=502, detail="Entegratör kontör sorgusu başarısız.") from e

    raw = bal.get("remaining_credit") or bal.get("balance") or bal.get("total_credit") or ""
    digits = re.sub(r"[^\d.]", "", str(raw))
    try:
        balance = int(float(digits)) if digits else None
    except ValueError:
        balance = None
    return {
        "company_id": company_id,
        "provider": provider,
        "balance": balance,
        "raw": bal,
        "source": src,
        "message": bal.get("message") or f"{label} kontör bakiyesi",
    }


@router.post("/e-invoice/create")
async def api_create_einvoice(payload: InvoiceCreateRequest):
    """Body: { invoice_id?, order_id?, company_id?, e_type?, scenario?: TICARI|TEMEL }"""
    invoice_id = (payload.invoice_id or "").strip()
    order_id = (payload.order_id or "").strip()
    company_id = (payload.company_id or "").strip()
    if not invoice_id and not order_id:
        raise HTTPException(status_code=400, detail="invoice_id veya order_id gerekli.")
    req = {
        "invoice_id": invoice_id,
        "order_id": order_id,
        "company_id": company_id,
        "scenario": payload.scenario,
        "e_type": payload.e_type,
        "stamp_now": bool(payload.stamp_now),
        "issue_date": payload.issue_date,
        "issue_time": payload.issue_time,
    }
    try:
        if invoice_id:
            inv_q = {"_id": invoice_id}
            if company_id:
                inv_q["company_id"] = company_id
            inv = await _db.invoices.find_one(inv_q)
            if inv and company_id and inv.get("company_id") and inv.get("company_id") != company_id:
                raise HTTPException(status_code=403, detail="Fatura bu firmaya ait değil.")
            if inv and inv.get("status") == "draft" and inv.get("invoice_type") != "dispatch" and inv.get("e_type") != "e_dispatch":
                raise HTTPException(status_code=409, detail="Önce Faturalaştırın")
        if order_id and not invoice_id:
            return await create_from_order(order_id, req)
        result = await issue_invoice(
            invoice_id,
            e_type=payload.e_type,
            scenario=payload.scenario,
            stamp_now=bool(payload.stamp_now),
            issue_date=payload.issue_date,
            issue_time=payload.issue_time,
        )
        return await finalize_create_result(result, invoice_id, order_id=order_id or None, company_id=company_id or None)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("E-Fatura oluşturma hatası: %s", e)
        raise HTTPException(status_code=400, detail=f"Fatura kesilemedi: {e}") from e


@router.get("/e-invoice/{invoice_id}/status")
async def api_einvoice_status(invoice_id: str):
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if inv.get("einvoice_state") in ("sent", "queued") and (inv.get("gib_uuid") or inv.get("gib_tracking_id")):
        try:
            await refresh_one_invoice_status(invoice_id)
            inv = await _db.invoices.find_one({"_id": invoice_id}) or inv
        except Exception:
            logger.exception("status refresh on read failed for %s", invoice_id)
    xml_doc = await _db.outgoing_einvoice_xml.find_one({"_id": invoice_id}, {"byte_len": 1, "scenario": 1, "updated_at": 1})
    track = await _db.e_invoices.find_one({"_id": f"einv_{invoice_id}"})
    return {
        "invoice_id": invoice_id,
        "invoice_number": inv.get("invoice_number"),
        "e_type": inv.get("e_type"),
        "einvoice_state": inv.get("einvoice_state") or ("sent" if inv.get("gib_tracking_id") else "draft"),
        "gib_status": inv.get("gib_status"),
        "gib_status_code": inv.get("gib_status_code"),
        "gib_uuid": inv.get("gib_uuid"),
        "gib_invoice_id": inv.get("gib_invoice_id"),
        "gib_tracking_id": inv.get("gib_tracking_id"),
        "gib_scenario": inv.get("gib_scenario"),
        "gib_document_url": inv.get("gib_document_url"),
        "gib_error": inv.get("gib_error"),
        "mode": inv.get("gib_mode"),
        "gib_mode": inv.get("gib_mode"),
        "has_xml": bool(xml_doc),
        "xml_meta": xml_doc,
        "e_invoice_track": track,
    }


async def refresh_one_invoice_status(invoice_id: str) -> Dict[str, Any]:
    """Tek fatura için İşNet/GİB durum + fatura no senkronu."""
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    ettn = (inv.get("gib_uuid") or inv.get("gib_tracking_id") or "").strip()
    if not ettn or not isnet.is_ettn_uuid(ettn):
        return {"updated": False, "invoice": inv}
    settings = await _db.einvoice_settings.find_one({"company_id": inv.get("company_id")}) or {}
    provider = (inv.get("integrator") or settings.get("provider") or "").strip()
    if provider not in ("isnet", "isnet_portal") or settings.get("status") != "configured":
        return {"updated": False, "invoice": inv}
    if not isnet.explicit_environment(settings):
        raise HTTPException(status_code=400, detail=isnet.MODE_REQUIRED_DETAIL)
    settings = _isnet_settings_for_invoice(settings, inv)
    e_type = inv.get("e_type") or "e_archive"
    hint_no = str(inv.get("gib_invoice_id") or inv.get("local_invoice_number") or inv.get("invoice_number") or "")
    pending_zip = isnet.is_outbound_gib_pending(
        gib_status=str(inv.get("gib_status") or ""),
        gib_status_code=str(inv.get("gib_status_code") or ""),
        detail_status=str(inv.get("gib_detail_status") or ""),
        process_status=str(inv.get("gib_process_status") or ""),
    )
    # e_dispatch doğrulama SearchDespatchAdvice Outgoing ile
    verify_type = e_type if e_type in ("e_invoice", "e_archive", "e_dispatch") else "e_archive"
    if pending_zip and verify_type != "e_dispatch":
        pwd, portal_settings = _portal_password_for_advance(settings)
        if pwd:
            try:
                advanced = await isnet_portal.advance_outgoing_invoice(
                    portal_settings,
                    pwd,
                    ettn=ettn,
                    invoice_number=hint_no,
                    e_type=e_type,
                    process_status=str(inv.get("gib_process_status") or ""),
                )
                if advanced.get("invoice_number") and not hint_no:
                    hint_no = str(advanced.get("invoice_number") or "")
            except Exception:
                logger.exception("refresh_one portal advance failed for %s", invoice_id)
    info = await isnet.try_verify_outgoing_in_portal(
        settings,
        ettn,
        e_type=verify_type,
        invoice_number=hint_no,
        retries=5 if pending_zip else 3,
        wait_for_gib=bool(pending_zip),
    )
    if not info.get("ok"):
        return {"updated": False, "invoice": inv, "verified": False}
    patch: Dict[str, Any] = {}
    url = (info.get("document_url") or "").strip()
    if url:
        patch["gib_document_url"] = url
    vendor_no = str(info.get("vendor_number") or "").strip()
    if vendor_no and vendor_no != str(inv.get("gib_vendor_number") or "").strip():
        patch["gib_vendor_number"] = vendor_no
    gib_no = (info.get("invoice_id") or "").strip()
    if not gib_no:
        gib_no = await isnet.resolve_invoice_number_from_xml(
            settings,
            ettn,
            e_type=e_type,
            invoice_number=hint_no,
            viewer_url=url or (inv.get("gib_document_url") or ""),
        )
        gib_no = (gib_no or "").strip()
    if gib_no:
        patch["gib_invoice_id"] = gib_no
        if gib_no.upper() != str(inv.get("invoice_number") or "").strip().upper():
            if inv.get("invoice_number") and not inv.get("local_invoice_number"):
                patch["local_invoice_number"] = inv.get("invoice_number")
            patch["invoice_number"] = gib_no
    label = "İşNet SOAP API" if provider == "isnet" else "İşNet Web Portal"
    patch["gib_status"] = format_integrator_gib_status(
        label=label,
        mode=inv.get("gib_mode") or settings.get("mode") or "",
        portal_status=(info.get("status") or "").strip(),
        verified=True,
        status_code=str(info.get("status_code") or ""),
        detail_status=str(info.get("detail_status") or ""),
        process_status=str(info.get("process_status") or ""),
    )
    if info.get("status_code"):
        patch["gib_status_code"] = info.get("status_code")
    elif "Başarıyla Tamamlandı" in (patch.get("gib_status") or ""):
        patch["gib_status_code"] = "1300"
    if info.get("detail_status"):
        patch["gib_detail_status"] = info.get("detail_status")
    if info.get("process_status"):
        patch["gib_process_status"] = info.get("process_status")
    if patch:
        await _db.invoices.update_one({"_id": invoice_id}, {"$set": patch})
    refreshed = await _db.invoices.find_one({"_id": invoice_id}) or {**inv, **patch}
    return {"updated": bool(patch), "invoice": refreshed, "verified": True}


@router.post("/e-invoice/{invoice_id}/refresh-status")
async def api_refresh_einvoice_status(invoice_id: str):
    out = await refresh_one_invoice_status(invoice_id)
    inv = out.get("invoice") or {}
    return {
        "status": "success",
        "updated": out.get("updated"),
        "verified": out.get("verified"),
        "invoice_number": inv.get("invoice_number"),
        "gib_invoice_id": inv.get("gib_invoice_id"),
        "gib_status": inv.get("gib_status"),
        "gib_mode": inv.get("gib_mode"),
        "gib_document_url": inv.get("gib_document_url"),
        "message": (
            "GİB durumu güncellendi."
            if out.get("updated")
            else "Yeni GİB durumu yok (NetteFatura henüz indekslenmemiş olabilir)."
        ),
    }


async def _require_einvoice_access(request, invoice_id: str, kind: str):
    from auth_utils import session_token, get_user_from_token
    import signed_links
    import tenant_access

    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    share_t = request.query_params.get("t")
    # Geçerli t varsa oturuma hiç bakmadan izin (e-fatura → yerel PDF düşüşü için invoices-pdf de kabul)
    alt = (kind, "invoices-pdf") if kind == "e-invoice-pdf" else (kind,)
    if share_t and any(signed_links.verify_doc_share_token(invoice_id, k, share_t) for k in alt):
        return inv, None
    tok = session_token(request)
    if tok:
        user = await get_user_from_token(tok, _db)
        if not tenant_access.user_may_access_company(user, inv.get("company_id")):
            raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
        return inv, user
    raise HTTPException(status_code=401, detail="Giriş yapmanız veya geçerli paylaşım linki gerekli.")


@router.get("/e-invoice/{invoice_id}/share-link")
async def einvoice_share_link(
    invoice_id: str,
    request: Request,
    kind: str = Query("pdf"),
    ttl_hours: int = Query(2160, ge=1, le=2160),
):
    from auth_utils import session_token, get_user_from_token
    import signed_links
    import tenant_access
    import os

    tok = session_token(request)
    if not tok:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    user = await get_user_from_token(tok, _db)
    await tenant_access.get_tenant_doc(_db, "invoices", invoice_id, user, not_found="Fatura bulunamadı.")
    ext = "pdf" if kind in ("pdf", "e-invoice-pdf") else "xml" if kind in ("xml", "e-invoice-xml") else None
    if not ext:
        raise HTTPException(status_code=400, detail="kind pdf veya xml olmalı.")
    k = f"e-invoice-{ext}"
    ttl_sec = int(ttl_hours) * 3600
    token = signed_links.make_doc_share_token(invoice_id, k, ttl_sec=ttl_sec)
    import public_url as pu
    base = await pu.public_base_url_for(_db, "app", request=request)
    url = signed_links.build_doc_share_url(base, f"/api/e-invoice/{invoice_id}/{ext}", token)
    return {"url": url, "token": token, "expires_in": ttl_sec, "invoice_id": invoice_id, "kind": ext}


@router.get("/e-invoice/{invoice_id}/xml")
async def api_einvoice_xml(invoice_id: str, request: Request, t: Optional[str] = Query(None)):
    inv, _user = await _require_einvoice_access(request, invoice_id, "e-invoice-xml")
    try:
        remote = await fetch_integrator_xml(invoice_id)
        if remote:
            name = ubl_export.invoice_filename(inv or {"invoice_number": invoice_id}, "xml")
            return Response(
                remote,
                media_type="application/xml",
                headers={
                    "Content-Disposition": f'attachment; filename="{name}"',
                    "X-Document-Source": "integrator",
                },
            )
    except HTTPException as exc:
        # Entegratör anahtarı/ETTN yoksa yerel UBL'e düş (menü «XML indir» kırılmasın).
        logger.info("integrator xml unavailable for %s: %s", invoice_id, getattr(exc, "detail", exc))
    except Exception:
        logger.exception("integrator xml fetch failed for %s", invoice_id)
    stored = await _db.outgoing_einvoice_xml.find_one({"_id": invoice_id})
    if stored and stored.get("xml"):
        data = stored["xml"].encode("utf-8") if isinstance(stored["xml"], str) else stored["xml"]
        name = ubl_export.invoice_filename({"invoice_number": stored.get("invoice_id") or invoice_id}, "xml")
        return Response(data, media_type="application/xml", headers={"Content-Disposition": f'attachment; filename="{name}"'})
    return await ubl_export.invoice_xml(invoice_id)


@router.get("/e-invoice/{invoice_id}/pdf")
async def api_einvoice_pdf(invoice_id: str, request: Request, download: bool = True, t: Optional[str] = Query(None)):
    """Sipariş menüsü «E-Fatura PDF İndir» — önce entegratör (İşNet), yoksa yerel PDF."""
    inv, _user = await _require_einvoice_access(request, invoice_id, "e-invoice-pdf")
    disp = "attachment" if download else "inline"
    name = ubl_export.invoice_filename(inv, "pdf")
    try:
        remote = await fetch_integrator_pdf(invoice_id)
        if remote:
            return Response(
                remote,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'{disp}; filename="{name}"',
                    "X-Document-Source": "integrator",
                    "Access-Control-Expose-Headers": "X-Document-Source",
                },
            )
    except HTTPException as exc:
        logger.info("integrator pdf unavailable for %s: %s", invoice_id, getattr(exc, "detail", exc))
    except Exception:
        logger.exception("integrator pdf fetch failed for %s", invoice_id)
    # Yerel şablon (entegratör PDF henüz yoksa menü kırılmasın)
    import saas_docs

    return await saas_docs.invoice_pdf(
        invoice_id, request=request, download=download, require_integrator=False, t=t
    )


def _is_n11_document_url(url: str) -> bool:
    u = (url or "").lower()
    return "n11faturam.com" in u or "ebelge.n11" in u


def _is_http_url(url: str) -> bool:
    u = (url or "").strip().lower()
    return u.startswith("http://") or u.startswith("https://")


async def resolve_gib_document_url(invoice_id: str) -> Dict[str, Any]:
    """Resmi GİB/entegratör görüntüleme URL'si — yanlış n11 linkini İşNet'te düzeltir."""
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    settings = await _db.einvoice_settings.find_one({"company_id": inv.get("company_id")}) or {}
    provider = (inv.get("integrator") or settings.get("provider") or "").strip()
    stored = (inv.get("gib_document_url") or "").strip()
    ettn = (inv.get("gib_uuid") or inv.get("gib_tracking_id") or "").strip()
    e_type = inv.get("e_type") or "e_archive"

    # n11: kayıtlı / üretilebilir ViewDocument URL
    if provider == "n11faturam" or (not provider and _is_n11_document_url(stored)):
        if _is_http_url(stored) and _is_n11_document_url(stored):
            return {"url": stored, "provider": "n11faturam", "source": "stored"}
        company = await _db.companies.find_one({"_id": inv["company_id"]}) or {}
        seller = digits(company.get("tax_number") or company.get("tax_id"))
        if seller and ettn:
            url = n11faturam.document_url(seller, ettn, e_type)
            if url:
                await _db.invoices.update_one({"_id": invoice_id}, {"$set": {"gib_document_url": url}})
                return {"url": url, "provider": "n11faturam", "source": "built"}

    # İşNet: GetDocumentViewerLink (kayıtlı n11 URL'si yanlış olabilir — yok say)
    if provider in ("isnet", "isnet_portal") or (stored and not _is_n11_document_url(stored)):
        if _is_http_url(stored) and not _is_n11_document_url(stored):
            return {"url": stored, "provider": provider or "stored", "source": "stored"}
        if provider == "isnet" and ettn and settings.get("status") == "configured":
            doc_settings = _isnet_settings_for_invoice(settings, inv)
            info = await isnet.get_document_viewer_link(
                doc_settings,
                ettn,
                e_type=e_type,
                invoice_number=str(inv.get("gib_invoice_id") or inv.get("invoice_number") or ""),
            )
            url = info.get("url") or ""
            if url:
                patch = {"gib_document_url": url}
                vendor_no = str(info.get("vendor_number") or "").strip()
                if vendor_no:
                    patch["gib_vendor_number"] = vendor_no
                await _db.invoices.update_one({"_id": invoice_id}, {"$set": patch})
                return {"url": url, "provider": "isnet", "source": "viewer_link"}

    if _is_http_url(stored) and not (provider in ("isnet", "isnet_portal") and _is_n11_document_url(stored)):
        return {"url": stored, "provider": provider or "stored", "source": "stored"}

    raise HTTPException(
        status_code=404,
        detail=(
            "Resmi GİB görüntüleme linki yok. "
            "İşNet için ETTN ve yapılandırılmış SOAP gerekir; "
            f"PDF için /api/invoices/{invoice_id}/pdf kullanın."
        ),
    )


@router.get("/invoices/{invoice_id}/gib-document")
async def api_gib_document_redirect(invoice_id: str):
    """Tarayıcıda resmi entegratör belgesini aç (cookie ile)."""
    info = await resolve_gib_document_url(invoice_id)
    return RedirectResponse(url=info["url"], status_code=302)


@router.get("/invoices/{invoice_id}/gib-document.json")
async def api_gib_document_json(invoice_id: str):
    return await resolve_gib_document_url(invoice_id)


def _invoice_ettn(inv: dict) -> str:
    return (inv.get("gib_uuid") or inv.get("gib_tracking_id") or "").strip()


def _invoice_provider(inv: dict, settings: Optional[dict] = None) -> str:
    return (inv.get("integrator") or (settings or {}).get("provider") or "").strip()


def _is_incoming_invoice(inv: dict) -> bool:
    """Gelen alış e-fatura / edoc_inbox — İşNet InvoiceDirection=Incoming."""
    if not inv:
        return False
    if inv.get("direction") == "incoming" or inv.get("source") == "edoc_inbox" or inv.get("edoc_id"):
        return True
    gs = str(inv.get("gib_status") or "").lower()
    return "gelen" in gs or gs == "received"


def _invoice_soap_direction(inv: dict) -> str:
    return "Incoming" if _is_incoming_invoice(inv) else "Outgoing"


def _isnet_settings_for_invoice(settings: dict, inv: dict) -> dict:
    """PDF/XML/viewer/search: kayıtlı şube veya seri eşlemesi CompanyVendorNumber olsun."""
    hint = str((inv or {}).get("gib_vendor_number") or "").strip()
    number = str((inv or {}).get("gib_invoice_id") or (inv or {}).get("invoice_number") or "")
    merged = dict(settings or {})
    if hint:
        merged["gib_vendor_number"] = hint
    return isnet.with_inferred_vendor(merged, number, vendor_hint=hint)


async def _remember_isnet_document(invoice_id: str, inv: dict, captured: Optional[dict]) -> None:
    """Başarılı viewer linki ve şube kodunu faturaya yaz — sonraki indirme tek çağrı."""
    if not isinstance(captured, dict) or _db is None:
        return
    patch: Dict[str, Any] = {}
    url = str(captured.get("url") or "").strip()
    stored = str((inv or {}).get("gib_document_url") or "").strip()
    if url and _is_http_url(url) and not _is_n11_document_url(url) and url != stored:
        patch["gib_document_url"] = url
    vendor = str(captured.get("vendor_number") or "").strip()
    if vendor and vendor != str((inv or {}).get("gib_vendor_number") or "").strip():
        patch["gib_vendor_number"] = vendor
    if patch:
        await _db.invoices.update_one({"_id": invoice_id}, {"$set": patch})


async def fetch_integrator_pdf(invoice_id: str) -> Optional[bytes]:
    """GİB e-belge PDF (İşNet). Gelen faturalarda InvoiceDirection=Incoming."""
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        return None
    et = inv.get("e_type") or ""
    if et in ("paper", "expense_slip", "e_dispatch") or inv.get("status") == "draft":
        return None
    if inv.get("einvoice_state") == "error":
        return None
    gs = str(inv.get("gib_status") or "")
    if re.match(r"^\s*hata\s*:", gs, re.I):
        return None
    ettn = _invoice_ettn(inv)
    if not ettn:
        return None
    # Yerel fatura no ETTN sayılmaz — İşNet GetInvoicePdf UUID ister
    if not isnet.is_ettn_uuid(ettn):
        logger.warning("fetch_integrator_pdf: geçersiz ETTN %s invoice=%s", ettn, invoice_id)
        return None
    settings = await _db.einvoice_settings.find_one({"company_id": inv.get("company_id")}) or {}
    provider = _invoice_provider(inv, settings)
    if provider not in ("isnet", "isnet_portal") or settings.get("status") != "configured":
        return None
    settings = _isnet_settings_for_invoice(settings, inv)
    viewer = ""
    stored = (inv.get("gib_document_url") or "").strip()
    if _is_http_url(stored) and not _is_n11_document_url(stored):
        viewer = stored
    # İşNet fatura no: önce GİB'den dönen numara, sonra yerel
    inv_no = str(inv.get("gib_invoice_id") or inv.get("invoice_number") or "").strip()
    direction = _invoice_soap_direction(inv)
    captured: Dict[str, Any] = {}
    try:
        data = await isnet.download_invoice_pdf(
            settings,
            ettn,
            e_type=et or "e_archive",
            invoice_number=inv_no,
            viewer_url=viewer,
            direction=direction,
            captured=captured,
        )
        await _remember_isnet_document(invoice_id, inv, captured)
        return data
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        logger.warning(
            "fetch_integrator_pdf: %s → %s",
            invoice_id,
            mask_sensitive_text(detail)[:2000],
        )
        status = exc.status_code if exc.status_code and exc.status_code >= 400 else 502
        raise HTTPException(
            status_code=status,
            detail=public_provider_detail("Entegratör belgesi alınamadı.", detail),
        ) from exc
    except Exception as exc:
        logger.exception("fetch_integrator_pdf failed for %s", invoice_id)
        raise HTTPException(status_code=502, detail="Entegratör belgesi alınamadı.") from exc


async def fetch_integrator_xml(invoice_id: str) -> Optional[bytes]:
    """GİB UBL XML (İşNet). Gelen faturalarda InvoiceDirection=Incoming."""
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        return None
    et = inv.get("e_type") or ""
    if et in ("paper", "expense_slip", "e_dispatch") or inv.get("status") == "draft":
        return None
    ettn = _invoice_ettn(inv)
    if not ettn:
        return None
    settings = await _db.einvoice_settings.find_one({"company_id": inv.get("company_id")}) or {}
    provider = _invoice_provider(inv, settings)
    if provider != "isnet" or settings.get("status") != "configured":
        return None
    settings = _isnet_settings_for_invoice(settings, inv)
    viewer = ""
    stored = (inv.get("gib_document_url") or "").strip()
    if _is_http_url(stored) and not _is_n11_document_url(stored):
        viewer = stored
    inv_no = str(inv.get("gib_invoice_id") or inv.get("invoice_number") or "").strip()
    direction = _invoice_soap_direction(inv)
    captured: Dict[str, Any] = {}
    try:
        data = await isnet.download_invoice_xml(
            settings,
            ettn,
            e_type=et or "e_archive",
            invoice_number=inv_no,
            viewer_url=viewer,
            direction=direction,
            captured=captured,
        )
        await _remember_isnet_document(invoice_id, inv, captured)
        return data
    except HTTPException as exc:
        logger.info("fetch_integrator_xml: %s → %s", invoice_id, getattr(exc, "detail", exc))
        return None
    except Exception:
        logger.exception("fetch_integrator_xml failed for %s", invoice_id)
        return None


async def refresh_outbound_statuses(limit: int = 50) -> Dict[str, Any]:
    checked = updated = 0
    # Önce GİB tamamlanmamış (Ziplenmiş/1200) faturalar — 1300'ler limit'i doldurmasın
    cursor = _db.invoices.find({"einvoice_state": {"$in": ["queued", "sent"]}}).sort("issued_at", -1).limit(
        max(limit * 3, 150)
    )
    pending_first: list = []
    rest: list = []
    async for inv in cursor:
        gs_low = str(inv.get("gib_status") or "").lower().replace("ı", "i")
        done = str(inv.get("gib_status_code") or "") == "1300" or "basariyla tamamland" in gs_low
        pending = isnet.is_outbound_gib_pending(
            gib_status=str(inv.get("gib_status") or ""),
            gib_status_code=str(inv.get("gib_status_code") or ""),
            detail_status=str(inv.get("gib_detail_status") or ""),
            process_status=str(inv.get("gib_process_status") or ""),
        )
        if inv.get("einvoice_state") == "queued" or (pending and not done):
            pending_first.append(inv)
        elif not done:
            rest.append(inv)
        # 1300 tamamlanmış → bu turda atla (yeniden poll gereksiz)
    for inv in (pending_first + rest)[:limit]:
        checked += 1
        if inv.get("einvoice_state") == "queued":
            queued_at = inv.get("queued_at") or ""
            try:
                ts = datetime.fromisoformat(queued_at.replace("Z", "+00:00"))
                age = (datetime.now(timezone.utc) - ts).total_seconds()
            except Exception:
                age = 99999
            if age > 900 and not inv.get("gib_tracking_id"):
                await _db.invoices.update_one(
                    {"_id": inv["_id"]},
                    {"$set": {"einvoice_state": "error", "gib_status": "Gönderim zaman aşımı", "gib_error": "queued_timeout", "error_at": _now()}},
                )
                updated += 1
            continue

        ettn = (inv.get("gib_uuid") or inv.get("gib_tracking_id") or "").strip()
        if not ettn:
            continue
        settings = await _db.einvoice_settings.find_one({"company_id": inv.get("company_id")}) or {}
        provider = (inv.get("integrator") or settings.get("provider") or "").strip()

        if provider == "n11faturam" or (not provider and not inv.get("gib_document_url")):
            company = await _db.companies.find_one({"_id": inv["company_id"]}) or {}
            seller = digits(company.get("tax_number") or company.get("tax_id"))
            if seller and not inv.get("gib_document_url"):
                url = n11faturam.document_url(seller, ettn, inv.get("e_type") or "e_archive")
                if url:
                    await _db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"gib_document_url": url}})
                    updated += 1
            continue

        if provider not in ("isnet", "isnet_portal") or settings.get("status") != "configured":
            continue
        if not isnet.explicit_environment(settings):
            continue
        if not isnet.is_ettn_uuid(ettn):
            continue
        settings = _isnet_settings_for_invoice(settings, inv)

        pending_zip = isnet.is_outbound_gib_pending(
            gib_status=str(inv.get("gib_status") or ""),
            gib_status_code=str(inv.get("gib_status_code") or ""),
            detail_status=str(inv.get("gib_detail_status") or ""),
            process_status=str(inv.get("gib_process_status") or ""),
        )
        e_type_inv = inv.get("e_type") or "e_archive"
        hint_no = str(inv.get("gib_invoice_id") or inv.get("invoice_number") or "")
        if pending_zip and e_type_inv != "e_dispatch":
            pwd, portal_settings = _portal_password_for_advance(settings)
            if pwd:
                try:
                    advanced = await isnet_portal.advance_outgoing_invoice(
                        portal_settings,
                        pwd,
                        ettn=ettn,
                        invoice_number=hint_no,
                        e_type=e_type_inv,
                        process_status=str(inv.get("gib_process_status") or ""),
                    )
                    if advanced.get("invoice_number") and (
                        not hint_no or str(hint_no).upper().startswith("TKB")
                    ):
                        hint_no = str(advanced.get("invoice_number") or hint_no)
                except Exception:
                    logger.exception("outbound refresh portal advance failed for %s", inv.get("_id"))
        try:
            info = await isnet.try_verify_outgoing_in_portal(
                settings,
                ettn,
                e_type=e_type_inv if e_type_inv in ("e_invoice", "e_archive", "e_dispatch") else "e_archive",
                invoice_number=hint_no,
                retries=5 if pending_zip else 2,
                wait_for_gib=bool(pending_zip),
            )
        except Exception:
            logger.exception("isnet status refresh failed for %s", inv.get("_id"))
            continue

        if not info.get("ok"):
            continue

        patch: Dict[str, Any] = {}
        url = (info.get("document_url") or "").strip()
        if url and url != (inv.get("gib_document_url") or ""):
            patch["gib_document_url"] = url
        vendor_no = str(info.get("vendor_number") or "").strip()
        if vendor_no and vendor_no != str(inv.get("gib_vendor_number") or "").strip():
            patch["gib_vendor_number"] = vendor_no

        gib_no = (info.get("invoice_id") or "").strip()
        if not gib_no:
            try:
                gib_no = await isnet.resolve_invoice_number_from_xml(
                    settings,
                    ettn,
                    e_type=inv.get("e_type") or "e_archive",
                    invoice_number=str(inv.get("gib_invoice_id") or inv.get("invoice_number") or ""),
                    viewer_url=url or (inv.get("gib_document_url") or ""),
                )
                gib_no = (gib_no or "").strip()
            except Exception:
                logger.info("outbound status xml no resolve failed for %s", inv.get("_id"))
        if gib_no:
            if gib_no != (inv.get("gib_invoice_id") or ""):
                patch["gib_invoice_id"] = gib_no
            if gib_no.upper() != str(inv.get("invoice_number") or "").strip().upper():
                if inv.get("invoice_number") and not inv.get("local_invoice_number"):
                    patch["local_invoice_number"] = inv.get("invoice_number")
                patch["invoice_number"] = gib_no

        portal_status = (info.get("status") or "").strip()
        if portal_status or gib_no or url or info.get("detail_status"):
            label = "İşNet SOAP API" if provider == "isnet" else "İşNet Web Portal"
            new_gs = format_integrator_gib_status(
                label=label,
                mode=inv.get("gib_mode") or settings.get("mode") or "",
                portal_status=portal_status,
                verified=True,
                status_code=str(info.get("status_code") or ""),
                detail_status=str(info.get("detail_status") or ""),
                process_status=str(info.get("process_status") or ""),
            )
            if new_gs != (inv.get("gib_status") or ""):
                patch["gib_status"] = new_gs
            if info.get("status_code"):
                patch["gib_status_code"] = info.get("status_code")
            elif "Başarıyla Tamamlandı" in new_gs:
                patch["gib_status_code"] = "1300"
            if info.get("detail_status"):
                patch["gib_detail_status"] = info.get("detail_status")
            if info.get("process_status"):
                patch["gib_process_status"] = info.get("process_status")

        if patch:
            await _db.invoices.update_one({"_id": inv["_id"]}, {"$set": patch})
            updated += 1

    return {"checked": checked, "updated": updated}


async def outbound_status_loop(interval_s: int = 90):
    """Giden İşNet faturalarında Ziplenmiş→1300 gecikmesi için sık yenile (varsayılan 90 sn)."""
    import asyncio

    await asyncio.sleep(30)
    while True:
        try:
            await refresh_outbound_statuses()
        except Exception:
            logger.exception("e-fatura giden durum döngüsü")
        await asyncio.sleep(interval_s)
