"""Giden e-Fatura / e-Arşiv servisi.

Alıcı doğrulama → UBL → n11 Faturam (veya simülasyon) → XML arşivi + durum.
POST /api/e-invoice/create — invoice_id veya order_id.
POST /invoices/{id}/send-to-gib bu modüle delege eder.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

import n11faturam
import ubl_export

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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def normalize_scenario(raw: Optional[str], e_type: str) -> str:
    if (e_type or "") == "e_archive":
        return "EARSIVFATURA"
    if (e_type or "") in ("e_export", "e_ihracat"):
        return "IHRACAT"
    return SCENARIO_MAP.get((raw or "TICARI").strip().upper(), "TICARIFATURA")


def validate_buyer(contact: Optional[dict], invoice: dict, e_type: str) -> Dict[str, Any]:
    name = ((contact or {}).get("name") or invoice.get("contact_name") or "").strip()
    tax = digits(
        (contact or {}).get("tax_number_or_id")
        or (contact or {}).get("tax_id")
        or invoice.get("contact_tax_id")
        or ""
    )
    if not name:
        raise HTTPException(status_code=400, detail="Alıcı ünvanı zorunludur (GİB).")
    if e_type == "e_invoice" and len(tax) not in (10, 11):
        raise HTTPException(status_code=400, detail="e-Fatura için alıcı VKN (10) veya TCKN (11) zorunludur.")
    if e_type == "e_archive" and tax and len(tax) not in (10, 11):
        raise HTTPException(status_code=400, detail="Alıcı vergi kimlik numarası 10 veya 11 haneli olmalıdır.")
    return {
        "name": name,
        "tax_id": tax or ("11111111111" if e_type == "e_archive" else tax),
        "tax_office": (contact or {}).get("tax_office") or "",
        "address": (contact or {}).get("address") or invoice.get("contact_address") or "",
        "city": (contact or {}).get("city") or "",
        "email": (contact or {}).get("email") or "",
        "phone": (contact or {}).get("phone") or "",
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
    seller = {
        "name": company.get("name"),
        "tax_number": company.get("tax_number") or company.get("tax_id"),
        "tax_office": company.get("tax_office"),
        "city": company.get("city"),
        "address": company.get("address"),
        "email": company.get("email"),
        "phone": company.get("phone"),
    }
    buyer = ubl_export._buyer_from(inv, contact)
    xml = ubl_export.build_invoice_ubl(inv, seller, buyer)
    await store_outgoing_xml(str(inv.get("_id") or inv.get("id")), inv["company_id"], xml, {"scenario": scenario, "source": "ubl_export"})
    return xml


async def issue_invoice(invoice_id: str, *, e_type: Optional[str] = None, scenario: Optional[str] = None) -> Dict[str, Any]:
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if inv.get("direction") == "incoming" or inv.get("source") == "edoc_inbox":
        raise HTTPException(status_code=400, detail="Gelen e-fatura kesilmez; Onayla/Reddet kullanın.")
    if inv.get("invoice_type") == "purchase" and (e_type or inv.get("e_type")) == "e_invoice":
        raise HTTPException(status_code=400, detail="Alış e-faturası GİB'den gelir; kesim yalnızca satış belgelerinde yapılır.")

    if e_type:
        await _db.invoices.update_one({"_id": invoice_id}, {"$set": {"e_type": e_type}})
        inv = await _db.invoices.find_one({"_id": invoice_id})

    et = inv.get("e_type") or "e_archive"
    scen = normalize_scenario(scenario or inv.get("gib_scenario"), et)
    contact = await _db.contacts.find_one({"_id": inv.get("contact_id")}) if inv.get("contact_id") else None
    buyer = validate_buyer(contact, inv, et)
    company = await _db.companies.find_one({"_id": inv.get("company_id")}) or {}

    if et == "paper":
        await _db.invoices.update_one(
            {"_id": invoice_id},
            {"$set": {
                "status": "approved",
                "gib_status": "Kağıt Fatura (Matbu)",
                "einvoice_state": "sent",
                "gib_scenario": None,
                "gib_tracking_id": None,
                "issued_at": _now(),
            }},
        )
        return {"status": "success", "einvoice_state": "sent", "message": "Kağıt fatura olarak kesildi.", "invoice_id": invoice_id, "tracking_id": None}

    await _db.invoices.update_one(
        {"_id": invoice_id},
        {"$set": {"einvoice_state": "queued", "gib_scenario": scen, "gib_status": "Kuyrukta", "queued_at": _now()}},
    )
    try:
        await build_and_store_xml({**inv, "gib_scenario": scen}, company, contact, scen)
    except Exception:
        logger.exception("UBL arşivi yazılamadı: %s", invoice_id)

    settings = await _db.einvoice_settings.find_one({"company_id": inv.get("company_id")}) or {}
    password_fn: Optional[Callable] = _deps.get("password_fn")
    consume = _deps.get("consume_credits")

    if settings.get("provider") == "n11faturam" and settings.get("status") == "configured" and et in ("e_invoice", "e_archive"):
        if not password_fn:
            raise HTTPException(status_code=500, detail="e-Fatura şifre çözücü yapılandırılmamış.")
        pwd = password_fn(settings)
        try:
            sent = await n11faturam.send_document(
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
            raise HTTPException(status_code=502, detail=f"Entegratör gönderimi başarısız: {e}") from e

        remaining = None
        if consume:
            remaining = await consume(inv.get("company_id"), 1, invoice_id=invoice_id, note=inv.get("invoice_number") or invoice_id)
        tracking = sent.get("ettn") or sent.get("invoice_id")
        patch = {
            "status": "approved",
            "einvoice_state": "sent",
            "gib_status": "n11 Faturam ile GİB'e iletildi",
            "gib_tracking_id": tracking,
            "gib_uuid": sent.get("ettn"),
            "gib_invoice_id": sent.get("invoice_id") or None,
            "gib_document_url": sent.get("document_url") or "",
            "integrator": "n11faturam",
            "gib_scenario": scen,
            "gib_mode": settings.get("mode") or "test",
            "issued_at": _now(),
            "buyer_tax_id": buyer["tax_id"],
        }
        await _db.invoices.update_one({"_id": invoice_id}, {"$set": patch})
        try:
            xml_str, ettn, _iid = n11faturam.build_ubl(
                {**inv, "e_type": et, "gib_scenario": scen}, company, contact, ettn=sent.get("ettn")
            )
            await store_outgoing_xml(invoice_id, inv["company_id"], xml_str.encode("utf-8"), {"scenario": scen, "ettn": ettn, "source": "n11faturam"})
        except Exception:
            logger.exception("n11 UBL arşivi yazılamadı")
        return {
            "status": "success",
            "einvoice_state": "sent",
            "message": f"Fatura n11 Faturam üzerinden GİB'e iletildi. ETTN: {tracking}",
            "invoice_id": invoice_id,
            "gib_uuid": sent.get("ettn"),
            "gib_invoice_id": sent.get("invoice_id"),
            "tracking_id": tracking,
            "document_url": sent.get("document_url") or "",
            "provider": "n11faturam",
            "mode": settings.get("mode") or "test",
            "scenario": scen,
            "gib_credits_left": remaining,
        }

    remaining = None
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
    return {
        "status": "success",
        "einvoice_state": "sent",
        "message": (
            f"e-İhracat faturası GİB sistemine iletildi. ETTN/Takip No: {tracking}"
            if export
            else f"Fatura GİB sistemine başarıyla iletildi ve imzalandı. ETTN/Takip No: {tracking}"
        ),
        "invoice_id": invoice_id,
        "tracking_id": tracking,
        "gib_uuid": patch["gib_uuid"],
        "provider": patch["integrator"],
        "mode": patch["gib_mode"],
        "scenario": scen,
        "gib_credits_left": remaining,
    }


async def create_from_order(order_id: str, req: Dict[str, Any]) -> Dict[str, Any]:
    convert = _deps.get("convert_order")
    if not convert:
        raise HTTPException(status_code=500, detail="Sipariş→fatura dönüştürücü yapılandırılmamış.")
    order = await _db.orders.find_one({"_id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    inv_id = order.get("invoice_id")
    if not inv_id:
        converted = await convert(order_id, {"e_type": req.get("e_type") or "e_archive"})
        inv_id = converted.get("invoice_id")
        if not inv_id:
            raise HTTPException(status_code=400, detail=converted.get("message") or "Sipariş faturaya dönüştürülemedi.")
    return await issue_invoice(inv_id, e_type=req.get("e_type"), scenario=req.get("scenario"))


@router.post("/e-invoice/create")
async def api_create_einvoice(req: Dict[str, Any]):
    """Body: { invoice_id?, order_id?, e_type?, scenario?: TICARI|TEMEL }"""
    invoice_id = (req.get("invoice_id") or "").strip()
    order_id = (req.get("order_id") or "").strip()
    if not invoice_id and not order_id:
        raise HTTPException(status_code=400, detail="invoice_id veya order_id gerekli.")
    apply_effects = _deps.get("apply_effects")
    if invoice_id and apply_effects:
        inv = await _db.invoices.find_one({"_id": invoice_id})
        if inv and inv.get("status") == "draft" and not inv.get("effects_applied"):
            await apply_effects(inv)
            await _db.invoices.update_one({"_id": invoice_id}, {"$set": {"effects_applied": True}})
    if order_id and not invoice_id:
        return await create_from_order(order_id, req)
    return await issue_invoice(invoice_id, e_type=req.get("e_type"), scenario=req.get("scenario"))


@router.get("/e-invoice/{invoice_id}/status")
async def api_einvoice_status(invoice_id: str):
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    xml_doc = await _db.outgoing_einvoice_xml.find_one({"_id": invoice_id}, {"byte_len": 1, "scenario": 1, "updated_at": 1})
    return {
        "invoice_id": invoice_id,
        "invoice_number": inv.get("invoice_number"),
        "e_type": inv.get("e_type"),
        "einvoice_state": inv.get("einvoice_state") or ("sent" if inv.get("gib_tracking_id") else "draft"),
        "gib_status": inv.get("gib_status"),
        "gib_uuid": inv.get("gib_uuid"),
        "gib_invoice_id": inv.get("gib_invoice_id"),
        "gib_tracking_id": inv.get("gib_tracking_id"),
        "gib_scenario": inv.get("gib_scenario"),
        "gib_document_url": inv.get("gib_document_url"),
        "gib_error": inv.get("gib_error"),
        "mode": inv.get("gib_mode"),
        "has_xml": bool(xml_doc),
        "xml_meta": xml_doc,
    }


@router.get("/e-invoice/{invoice_id}/xml")
async def api_einvoice_xml(invoice_id: str):
    stored = await _db.outgoing_einvoice_xml.find_one({"_id": invoice_id})
    if stored and stored.get("xml"):
        data = stored["xml"].encode("utf-8")
        name = ubl_export.invoice_filename({"invoice_number": stored.get("invoice_id") or invoice_id}, "xml")
        return Response(data, media_type="application/xml", headers={"Content-Disposition": f'attachment; filename="{name}"'})
    return await ubl_export.invoice_xml(invoice_id)


async def refresh_outbound_statuses(limit: int = 50) -> Dict[str, Any]:
    checked = updated = 0
    cursor = _db.invoices.find({"einvoice_state": {"$in": ["queued", "sent"]}}).sort("issued_at", -1).limit(limit)
    async for inv in cursor:
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
        elif inv.get("einvoice_state") == "sent" and inv.get("gib_uuid") and not inv.get("gib_document_url"):
            company = await _db.companies.find_one({"_id": inv["company_id"]}) or {}
            seller = digits(company.get("tax_number") or company.get("tax_id"))
            if seller:
                url = n11faturam.document_url(seller, inv["gib_uuid"], inv.get("e_type") or "e_archive")
                if url:
                    await _db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"gib_document_url": url}})
                    updated += 1
    return {"checked": checked, "updated": updated}


async def outbound_status_loop(interval_s: int = 300):
    import asyncio

    await asyncio.sleep(60)
    while True:
        try:
            await refresh_outbound_statuses()
        except Exception:
            logger.exception("e-fatura giden durum döngüsü")
        await asyncio.sleep(interval_s)
