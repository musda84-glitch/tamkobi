"""Giden e-Fatura / e-Arşiv UBL-TR XML üretimi (imzasız arşiv kopyası). Gelen parse edocs.parse_ubl ile sınırlıdır."""
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

router = APIRouter(prefix="/api")
_db = None

INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
EDOC_TYPES = ("e_invoice", "e_archive")
UNIT_CODES = {
    "Adet": "C62", "adet": "C62", "C62": "C62",
    "Kg": "KGM", "kg": "KGM", "Kilogram": "KGM",
    "Lt": "LTR", "Litre": "LTR", "L": "LTR",
    "M": "MTR", "m": "MTR", "Metre": "MTR",
    "Paket": "PK", "Koli": "CT", "Saat": "HUR",
}

ET.register_namespace("", INVOICE_NS)
ET.register_namespace("cbc", CBC)
ET.register_namespace("cac", CAC)


def init(db):
    global _db
    _db = db


def is_outgoing_edoc(inv: Dict[str, Any]) -> bool:
    return inv.get("invoice_type") == "sales" and inv.get("e_type") in EDOC_TYPES


def invoice_filename(inv: Dict[str, Any], ext: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", str(inv.get("invoice_number") or "fatura")).strip("._") or "fatura"
    return f"{name}.{ext}"


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def _cbc(parent, tag: str, text: Optional[str] = None, **attrib):
    el = ET.SubElement(parent, _q(CBC, tag), {k: str(v) for k, v in attrib.items() if v is not None})
    if text is not None:
        el.text = str(text)
    return el


def _cac(parent, tag: str):
    return ET.SubElement(parent, _q(CAC, tag))


def _amt(n: Any) -> str:
    try:
        return f"{float(n or 0):.2f}"
    except (TypeError, ValueError):
        return "0.00"


def _date(s: Any) -> str:
    raw = str(s or "")[:10]
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        return raw
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _tax_id(raw: Any) -> Tuple[str, str]:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 11:
        return "TCKN", digits
    return "VKN", digits


def _party(parent_tag, party: Dict[str, Any], parent):
    wrap = _cac(parent, parent_tag)
    p = _cac(wrap, "Party")
    scheme, tid = _tax_id(party.get("tax_id") or party.get("tax_number") or party.get("tax_number_or_id"))
    if tid:
        ident = _cac(p, "PartyIdentification")
        _cbc(ident, "ID", tid, schemeID=scheme)
    name = (party.get("name") or "").strip()
    if name:
        pn = _cac(p, "PartyName")
        _cbc(pn, "Name", name[:200])
    addr = _cac(p, "PostalAddress")
    street = (party.get("address") or party.get("street") or "").strip()
    if street:
        _cbc(addr, "StreetName", street[:200])
    city = str(party.get("city") or "").strip()
    if city:
        _cbc(addr, "CityName", city[:60])
    country = _cac(addr, "Country")
    _cbc(country, "Name", "Türkiye")
    office = (party.get("tax_office") or "").strip()
    if office:
        pts = _cac(p, "PartyTaxScheme")
        ts = _cac(pts, "TaxScheme")
        _cbc(ts, "Name", office[:80])
    email = (party.get("email") or "").strip()
    phone = (party.get("phone") or "").strip()
    if email or phone:
        contact = _cac(p, "Contact")
        if phone:
            _cbc(contact, "Telephone", phone[:30])
        if email:
            _cbc(contact, "ElectronicMail", email[:120])
    return p


def _stable_uuid(inv: Dict[str, Any]) -> str:
    existing = (inv.get("gib_uuid") or "").strip()
    if existing:
        return existing
    raw = str(inv.get("_id") or inv.get("id") or uuid.uuid4())
    try:
        return str(uuid.UUID(raw))
    except ValueError:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tamkobi-invoice:{raw}"))


def build_invoice_ubl(inv: Dict[str, Any], seller: Dict[str, Any], buyer: Dict[str, Any]) -> bytes:
    """UBL-TR Invoice XML (imzasız arşiv). parse_ubl ile okunabilir."""
    e_type = inv.get("e_type") or "e_archive"
    profile = "TICARIFATURA" if e_type == "e_invoice" else "EARSIVFATURA"
    type_code = "IADE" if inv.get("invoice_type") == "return" else "SATIS"
    items = list(inv.get("items") or [])
    currency = (inv.get("currency") or "TRY").upper()
    subtotal = float(inv.get("subtotal") or 0)
    vat_total = float(inv.get("vat_total") or 0)
    grand = float(inv.get("grand_total") or 0)
    discount = float(inv.get("discount_total") or inv.get("general_discount_amount") or 0)

    root = ET.Element(_q(INVOICE_NS, "Invoice"))
    _cbc(root, "UBLVersionID", "2.1")
    _cbc(root, "CustomizationID", "TR1.2")
    _cbc(root, "ProfileID", profile)
    _cbc(root, "ID", inv.get("invoice_number") or "")
    _cbc(root, "CopyIndicator", "false")
    _cbc(root, "UUID", _stable_uuid(inv))
    _cbc(root, "IssueDate", _date(inv.get("issue_date")))
    _cbc(root, "InvoiceTypeCode", type_code)
    notes = (inv.get("notes") or "").strip()
    if notes:
        _cbc(root, "Note", notes[:500])
    if inv.get("gib_tracking_id"):
        _cbc(root, "Note", f"ETTN/Takip: {inv['gib_tracking_id']}")
    _cbc(root, "DocumentCurrencyCode", currency)
    _cbc(root, "LineCountNumeric", str(len(items) or 1))

    seller_party = {
        "name": seller.get("name"),
        "tax_id": seller.get("tax_number") or seller.get("tax_id"),
        "tax_office": seller.get("tax_office"),
        "address": seller.get("address"),
        "city": seller.get("city"),
        "phone": seller.get("phone"),
        "email": seller.get("email"),
    }
    buyer_party = {
        "name": buyer.get("name") or inv.get("contact_name"),
        "tax_id": buyer.get("tax_number_or_id") or buyer.get("tax_number") or inv.get("contact_tax_id"),
        "tax_office": buyer.get("tax_office"),
        "address": buyer.get("address"),
        "city": buyer.get("city"),
        "phone": buyer.get("phone"),
        "email": buyer.get("email"),
    }
    _party("AccountingSupplierParty", seller_party, root)
    _party("AccountingCustomerParty", buyer_party, root)

    tax_total = _cac(root, "TaxTotal")
    _cbc(tax_total, "TaxAmount", _amt(vat_total), currencyID=currency)
    by_rate: Dict[float, float] = {}
    for it in items:
        rate = float(it.get("vat_rate") or 0)
        net = float(it.get("total") or 0)
        by_rate[rate] = by_rate.get(rate, 0) + net * rate / 100
    if not by_rate and vat_total:
        by_rate[20.0] = vat_total
    for rate, amount in sorted(by_rate.items(), key=lambda x: -x[0]):
        sub = _cac(tax_total, "TaxSubtotal")
        _cbc(sub, "TaxableAmount", _amt(sum(float(it.get("total") or 0) for it in items if float(it.get("vat_rate") or 0) == rate) or subtotal), currencyID=currency)
        _cbc(sub, "TaxAmount", _amt(amount), currencyID=currency)
        _cbc(sub, "Percent", f"{rate:g}")
        cat = _cac(sub, "TaxCategory")
        sch = _cac(cat, "TaxScheme")
        _cbc(sch, "Name", "KDV")
        _cbc(sch, "TaxTypeCode", "0015")

    totals = _cac(root, "LegalMonetaryTotal")
    _cbc(totals, "LineExtensionAmount", _amt(subtotal + discount if discount else subtotal), currencyID=currency)
    if discount:
        _cbc(totals, "AllowanceTotalAmount", _amt(discount), currencyID=currency)
    _cbc(totals, "TaxExclusiveAmount", _amt(subtotal), currencyID=currency)
    _cbc(totals, "TaxInclusiveAmount", _amt(subtotal + vat_total), currencyID=currency)
    _cbc(totals, "PayableAmount", _amt(grand), currencyID=currency)

    if not items:
        items = [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": subtotal, "vat_rate": 20, "total": subtotal}]
    for i, it in enumerate(items, 1):
        line = _cac(root, "InvoiceLine")
        _cbc(line, "ID", str(i))
        qty = float(it.get("quantity") or 1) or 1
        unit = UNIT_CODES.get(str(it.get("unit") or "Adet"), "C62")
        _cbc(line, "InvoicedQuantity", f"{qty:g}", unitCode=unit)
        net = float(it.get("total") or 0)
        _cbc(line, "LineExtensionAmount", _amt(net), currencyID=currency)
        rate = float(it.get("vat_rate") or 0)
        line_vat = net * rate / 100
        lt = _cac(line, "TaxTotal")
        _cbc(lt, "TaxAmount", _amt(line_vat), currencyID=currency)
        ls = _cac(lt, "TaxSubtotal")
        _cbc(ls, "Percent", f"{rate:g}")
        item_el = _cac(line, "Item")
        _cbc(item_el, "Name", str(it.get("name") or "Kalem")[:200])
        sku = (it.get("sku") or "").strip()
        if sku:
            sid = _cac(item_el, "SellersItemIdentification")
            _cbc(sid, "ID", sku[:50])
        price = _cac(line, "Price")
        unit_price = float(it.get("unit_price") or 0)
        _cbc(price, "PriceAmount", _amt(unit_price), currencyID=currency)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _buyer_from(inv: Dict[str, Any], contact: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    c = contact or {}
    return {
        "name": c.get("name") or inv.get("contact_name") or "",
        "tax_number_or_id": c.get("tax_number_or_id") or inv.get("contact_tax_id") or "",
        "tax_office": c.get("tax_office") or "",
        "address": c.get("address") or "",
        "city": c.get("city") or "",
        "phone": c.get("phone") or "",
        "email": c.get("email") or "",
    }


@router.get("/invoices/{invoice_id}/xml")
async def invoice_xml(invoice_id: str):
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if not is_outgoing_edoc(inv):
        raise HTTPException(status_code=400, detail="Yalnızca e-Fatura / e-Arşiv belgelerinin XML'i indirilebilir.")
    seller = await _db.companies.find_one({"_id": inv["company_id"]}) or {}
    contact = await _db.contacts.find_one({"_id": inv.get("contact_id")}) if inv.get("contact_id") else None
    xml = build_invoice_ubl(inv, seller, _buyer_from(inv, contact))
    filename = invoice_filename(inv, "xml")
    return Response(xml, media_type="application/xml", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
