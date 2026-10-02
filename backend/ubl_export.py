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
EXT = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
EDOC_TYPES = ("e_invoice", "e_archive")
RETURN_INVOICE_TYPES = frozenset({"return", "sales_return", "purchase_return", "iade"})
UNIT_CODES = {
    "Adet": "C62", "adet": "C62", "C62": "C62", "NIU": "NIU",
    "Kg": "KGM", "kg": "KGM", "Kilogram": "KGM",
    "Lt": "LTR", "Litre": "LTR", "L": "LTR",
    "M": "MTR", "m": "MTR", "Metre": "MTR",
    "Paket": "PK", "Koli": "CT", "Saat": "HUR",
}

ET.register_namespace("", INVOICE_NS)
ET.register_namespace("cbc", CBC)
ET.register_namespace("cac", CAC)
ET.register_namespace("ext", EXT)


def init(db):
    global _db
    _db = db


def is_outgoing_edoc(inv: Dict[str, Any]) -> bool:
    et = inv.get("e_type")
    if et not in EDOC_TYPES:
        return False
    itype = str(inv.get("invoice_type") or "").lower()
    if itype in ("sales", "sale") or itype in RETURN_INVOICE_TYPES:
        return True
    # Gelen alış dışındaki satış belgeleri
    if inv.get("direction") == "incoming" or inv.get("source") == "edoc_inbox":
        return False
    return itype not in ("purchase", "dispatch", "expense_slip", "proforma")


def _norm_invoice_type(value: Any) -> str:
    """Türkçe İ/ı dahil invoice_type karşılaştırması için ASCII-ish küçük harf."""
    s = str(value or "").strip().lower()
    return (
        s.replace("ı", "i")
        .replace("İ", "i")
        .replace("i̇", "i")  # İ.lower() → i + combining dot
        .replace("ş", "s")
        .replace("ğ", "g")
        .replace("ü", "u")
        .replace("ö", "o")
        .replace("ç", "c")
    )


def is_return_invoice(inv: Dict[str, Any]) -> bool:
    return _norm_invoice_type(inv.get("invoice_type")) in RETURN_INVOICE_TYPES


def has_withholding(inv: Dict[str, Any]) -> bool:
    """TamKobi tevkifat seçimi (withholding_rate / withholding_code) dolu mu?"""
    try:
        rate = float(inv.get("withholding_rate") or 0)
    except (TypeError, ValueError):
        rate = 0.0
    code = str(inv.get("withholding_code") or "").strip()
    try:
        amount = float(inv.get("withholding_amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    return rate > 0 or bool(code) or amount > 0


def withholding_parts(inv: Dict[str, Any], vat_total: Optional[float] = None) -> Optional[Tuple[str, float, float, float]]:
    """Tevkifat için (code, percent_0_100, taxable=vat, amount).

    withholding_rate 0.5 → Percent 50 (5/10). TaxableAmount = KDV tutarı.
    """
    if not has_withholding(inv):
        return None
    code = str(inv.get("withholding_code") or "").strip() or "603"
    try:
        rate = float(inv.get("withholding_rate") or 0)
    except (TypeError, ValueError):
        rate = 0.0
    if vat_total is None:
        try:
            vat_total = float(inv.get("vat_total") or 0)
        except (TypeError, ValueError):
            vat_total = 0.0
    vat_total = float(vat_total or 0)
    try:
        amount = float(inv.get("withholding_amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    if amount <= 0 and rate > 0 and vat_total > 0:
        amount = round(vat_total * rate, 2)
    percent = round(rate * 100.0, 2) if rate <= 1 else round(rate, 2)
    if percent <= 0 and vat_total > 0 and amount > 0:
        percent = round(amount / vat_total * 100.0, 2)
    return code, percent, vat_total, amount


def gib_invoice_type_code(inv: Dict[str, Any]) -> str:
    """GİB InvoiceTypeCode — İşNet/n11 UBL ve yapılandırılmış gönderim için.

    Açık invoice_type_code / gib_invoice_type varsa onu kullanır; yoksa
    TamKobi invoice_type (return…) → IADE, tevkifat → TEVKIFAT, aksi SATIS.
    """
    allowed = (
        "SATIS",
        "IADE",
        "TEVKIFAT",
        "TEVKIFATIADE",
        "ISTISNA",
        "OZELMATRAH",
        "IHRACKAYITLI",
    )
    raw = str(inv.get("invoice_type_code") or inv.get("gib_invoice_type") or "").strip()
    explicit = _norm_invoice_type(raw).upper()
    if explicit in allowed:
        return explicit
    returning = is_return_invoice(inv)
    withholding = has_withholding(inv)
    if returning and withholding:
        return "TEVKIFATIADE"
    if returning:
        return "IADE"
    if withholding:
        return "TEVKIFAT"
    return "SATIS"


def withholding_tax_total_xml(
    inv: Dict[str, Any],
    currency: str,
    *,
    vat_total: Optional[float] = None,
    amount_override: Optional[float] = None,
) -> str:
    """cac:WithholdingTaxTotal UBL parçası (İşNet Send*Xml / n11 UBL)."""
    parts = withholding_parts(inv, vat_total)
    if not parts:
        return ""
    code, percent, taxable, amount = parts
    if amount_override is not None:
        amount = float(amount_override)
    if amount <= 0 and taxable <= 0:
        return ""
    from xml.sax.saxutils import escape as _xml_esc

    def _m(v: float) -> str:
        return f"{float(v):.2f}"

    return (
        f"<cac:WithholdingTaxTotal>"
        f"<cbc:TaxAmount currencyID=\"{_xml_esc(currency)}\">{_m(amount)}</cbc:TaxAmount>"
        f"<cac:TaxSubtotal>"
        f"<cbc:TaxableAmount currencyID=\"{_xml_esc(currency)}\">{_m(taxable)}</cbc:TaxableAmount>"
        f"<cbc:TaxAmount currencyID=\"{_xml_esc(currency)}\">{_m(amount)}</cbc:TaxAmount>"
        f"<cbc:Percent>{percent:g}</cbc:Percent>"
        f"<cac:TaxCategory>"
        f"<cac:TaxScheme>"
        f"<cbc:Name>KDV TEVKİFATI</cbc:Name>"
        f"<cbc:TaxTypeCode>{_xml_esc(code)}</cbc:TaxTypeCode>"
        f"</cac:TaxScheme>"
        f"</cac:TaxCategory>"
        f"</cac:TaxSubtotal>"
        f"</cac:WithholdingTaxTotal>"
    )


def return_billing_ref(inv: Dict[str, Any]) -> Optional[Tuple[str, str, str, str]]:
    """İade faturası için (original_id, issue_date, doc_type_code, doc_type)."""
    return _return_billing_ref(inv)


def _return_billing_ref(inv: Dict[str, Any]) -> Optional[Tuple[str, str, str, str]]:
    """İade faturası için (original_id, issue_date, doc_type_code, doc_type)."""
    oid = (
        inv.get("original_invoice_number")
        or inv.get("return_of_invoice_number")
        or inv.get("billing_reference_id")
        or inv.get("referenced_invoice_number")
        or ""
    )
    oid = str(oid).strip()
    odate = (
        inv.get("original_issue_date")
        or inv.get("return_of_issue_date")
        or inv.get("billing_reference_date")
        or ""
    )
    odate = _date(odate) if odate else ""
    dtype = str(inv.get("billing_reference_type") or inv.get("original_document_type") or "").strip()
    dcode = str(inv.get("billing_reference_type_code") or "İADE").strip() or "İADE"
    if not oid:
        # Notdan «GHJ2026000002586 numaralı» yakala
        notes = str(inv.get("notes") or "")
        m = re.search(r"([A-Z]{2,3}\d{10,16})\s*numaralı", notes, re.I)
        if m:
            oid = m.group(1).upper()
        m2 = re.search(r"(\d{2}[./]\d{2}[./]\d{4})\s*tarihli", notes)
        if m2 and not odate:
            raw = m2.group(1).replace(".", "-").replace("/", "-")
            parts = raw.split("-")
            if len(parts) == 3 and len(parts[2]) == 4:
                odate = f"{parts[2]}-{parts[1]}-{parts[0]}"
    if not oid:
        return None
    return oid, odate or _date(inv.get("issue_date")), dcode, dtype


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


def build_invoice_ubl(
    inv: Dict[str, Any],
    seller: Dict[str, Any],
    buyer: Dict[str, Any],
    *,
    send_ready: bool = False,
) -> bytes:
    """UBL-TR Invoice XML. parse_ubl ile okunabilir.

    İşNet test başarılı örnekleriyle uyum: SATIS/TICARIFATURA, IADE/TEMELFATURA + BillingReference,
    TEVKIFAT + WithholdingTaxTotal.

    send_ready=True: İşNet Send*Xml için UBLExtensions + Signature (+ e-Arşiv GONDERIMSEKLI).
    """
    e_type = inv.get("e_type") or "e_archive"
    profile = inv.get("_profile_override") or inv.get("gib_scenario")
    if profile not in ("TEMELFATURA", "TICARIFATURA", "EARSIVFATURA", "IHRACAT"):
        profile = "TICARIFATURA" if e_type == "e_invoice" else "EARSIVFATURA"
    type_code = gib_invoice_type_code(inv)
    returning = type_code in ("IADE", "TEVKIFATIADE") or is_return_invoice(inv)
    items = list(inv.get("items") or [])
    currency = (inv.get("currency") or "TRY").upper()
    subtotal = float(inv.get("subtotal") or 0)
    vat_total = float(inv.get("vat_total") or 0)
    withhold_amt = float(inv.get("withholding_amount") or 0)
    if withhold_amt <= 0 and has_withholding(inv):
        wp = withholding_parts(inv, vat_total)
        withhold_amt = float(wp[3]) if wp else 0.0
    grand = float(inv.get("grand_total") or 0)
    if not grand:
        grand = round(subtotal + vat_total - withhold_amt, 2)
    discount = float(inv.get("discount_total") or inv.get("general_discount_amount") or 0)
    issue_date = _date(inv.get("issue_date"))

    root = ET.Element(_q(INVOICE_NS, "Invoice"))
    if send_ready:
        exts = ET.SubElement(root, _q(EXT, "UBLExtensions"))
        ext_one = ET.SubElement(exts, _q(EXT, "UBLExtension"))
        ET.SubElement(ext_one, _q(EXT, "ExtensionContent"))
    _cbc(root, "UBLVersionID", "2.1")
    _cbc(root, "CustomizationID", "TR1.2")
    _cbc(root, "ProfileID", profile)
    _cbc(root, "ID", inv.get("invoice_number") or "")
    _cbc(root, "CopyIndicator", "false")
    _cbc(root, "UUID", _stable_uuid(inv))
    _cbc(root, "IssueDate", issue_date)
    issue_time = (inv.get("issue_time") or "").strip()
    if not issue_time:
        issue_time = datetime.now(timezone.utc).strftime("%H:%M:%S")
    _cbc(root, "IssueTime", issue_time[:8] if len(issue_time) >= 8 else issue_time)
    _cbc(root, "InvoiceTypeCode", type_code)
    notes = (inv.get("notes") or "").strip()
    if notes:
        _cbc(root, "Note", notes[:500])
    if inv.get("gib_tracking_id"):
        _cbc(root, "Note", f"ETTN/Takip: {inv['gib_tracking_id']}")
    _cbc(root, "DocumentCurrencyCode", currency)
    _cbc(root, "LineCountNumeric", str(len(items) or 1))

    if send_ready and (e_type == "e_archive" or profile == "EARSIVFATURA"):
        buyer_email = str(buyer.get("email") or inv.get("contact_email") or "").strip()
        send_type = str(inv.get("earchive_send_type") or inv.get("sending_type") or "").strip().upper()
        if send_type not in ("ELEKTRONIK", "KAGIT"):
            send_type = "ELEKTRONIK" if buyer_email else "KAGIT"
        if send_type == "ELEKTRONIK" and not buyer_email:
            send_type = "KAGIT"
        internet = str(inv.get("internet_sale") or "HAYIR").strip().upper()
        if internet not in ("EVET", "HAYIR"):
            internet = "HAYIR"
        for doc_type, desc in (("GONDERIMSEKLI", send_type), ("INTERNETSATISI", internet)):
            adr = _cac(root, "AdditionalDocumentReference")
            _cbc(adr, "ID", str(uuid.uuid4()))
            _cbc(adr, "IssueDate", issue_date)
            _cbc(adr, "DocumentType", doc_type)
            _cbc(adr, "DocumentDescription", desc)

    # İade: orijinal satış faturasına BillingReference (İşNet IADE örneği)
    if returning:
        bref = _return_billing_ref(inv)
        if bref:
            oid, odate, dcode, dtype = bref
            br = _cac(root, "BillingReference")
            idr = _cac(br, "InvoiceDocumentReference")
            _cbc(idr, "ID", oid)
            if odate:
                _cbc(idr, "IssueDate", odate)
            _cbc(idr, "DocumentTypeCode", dcode)
            if dtype:
                _cbc(idr, "DocumentType", dtype[:120])

    seller_party = {
        "name": seller.get("name"),
        "tax_id": seller.get("tax_number") or seller.get("tax_id"),
        "tax_office": seller.get("tax_office"),
        "address": seller.get("address"),
        "city": seller.get("city"),
        "phone": seller.get("phone"),
        "email": seller.get("email"),
        "district": seller.get("district"),
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
    if send_ready:
        # İşNet Send*Xml: dolu Signature (ExtensionContent entegratörde imzalanır)
        seller_tax = "".join(ch for ch in str(seller_party.get("tax_id") or "") if ch.isdigit())
        seller_scheme = "VKN" if len(seller_tax) == 10 else "TCKN"
        if len(seller_tax) not in (10, 11):
            seller_tax, seller_scheme = (seller_tax.zfill(10)[:10] or "0000000000"), "VKN"
        sig = _cac(root, "Signature")
        _cbc(sig, "ID", seller_tax, schemeID="VKN_TCKN")
        sparty = _cac(sig, "SignatoryParty")
        sid = _cac(sparty, "PartyIdentification")
        _cbc(sid, "ID", seller_tax, schemeID=seller_scheme)
        addr = _cac(sparty, "PostalAddress")
        _cbc(addr, "StreetName", str(seller.get("address") or "-") or "-")
        district = (
            seller.get("district") or seller.get("tax_office") or seller.get("city") or "Merkez"
        )
        district = str(district).strip() or "Merkez"
        if district in ("-", "."):
            district = str(seller.get("city") or "Merkez")
        _cbc(addr, "CitySubdivisionName", district)
        _cbc(addr, "CityName", str(seller.get("city") or "İstanbul"))
        country = _cac(addr, "Country")
        _cbc(country, "Name", "Türkiye")
        dsa = _cac(sig, "DigitalSignatureAttachment")
        eref = _cac(dsa, "ExternalReference")
        _cbc(eref, "URI", "#Signature")

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

    # Tevkifat: WithholdingTaxTotal (TaxTypeCode = 601…615; 9015 değil)
    wp = withholding_parts(inv, vat_total)
    if wp:
        code, percent, taxable, amount = wp
        wtt = _cac(root, "WithholdingTaxTotal")
        _cbc(wtt, "TaxAmount", _amt(amount), currencyID=currency)
        wsub = _cac(wtt, "TaxSubtotal")
        _cbc(wsub, "TaxableAmount", _amt(taxable), currencyID=currency)
        _cbc(wsub, "TaxAmount", _amt(amount), currencyID=currency)
        _cbc(wsub, "Percent", f"{percent:g}")
        wcat = _cac(wsub, "TaxCategory")
        wsch = _cac(wcat, "TaxScheme")
        _cbc(wsch, "Name", "KDV TEVKİFATI")
        _cbc(wsch, "TaxTypeCode", code)

    totals = _cac(root, "LegalMonetaryTotal")
    _cbc(totals, "LineExtensionAmount", _amt(subtotal + discount if discount else subtotal), currencyID=currency)
    if discount:
        _cbc(totals, "AllowanceTotalAmount", _amt(discount), currencyID=currency)
    _cbc(totals, "TaxExclusiveAmount", _amt(subtotal), currencyID=currency)
    _cbc(totals, "TaxInclusiveAmount", _amt(subtotal + vat_total), currencyID=currency)
    _cbc(totals, "PayableAmount", _amt(grand), currencyID=currency)

    if not items:
        items = [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": subtotal, "vat_rate": 20, "total": subtotal}]
    wh_rate = float(inv.get("withholding_rate") or 0)
    wh_code = str(inv.get("withholding_code") or "").strip()
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
        if wh_code and wh_rate > 0 and line_vat > 0:
            line_wh = round(line_vat * wh_rate, 2)
            lwt = _cac(line, "WithholdingTaxTotal")
            _cbc(lwt, "TaxAmount", _amt(line_wh), currencyID=currency)
            lws = _cac(lwt, "TaxSubtotal")
            _cbc(lws, "TaxableAmount", _amt(line_vat), currencyID=currency)
            _cbc(lws, "TaxAmount", _amt(line_wh), currencyID=currency)
            _cbc(lws, "Percent", f"{(wh_rate * 100):g}")
            lwcat = _cac(lws, "TaxCategory")
            lwsch = _cac(lwcat, "TaxScheme")
            _cbc(lwsch, "Name", "KDV TEVKİFATI")
            _cbc(lwsch, "TaxTypeCode", wh_code)
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
    filename = invoice_filename(inv, "xml")
    # GİB'e iletilmiş: resmi entegratör UBL (İşNet DownloadXml); hata olursa yerel UBL.
    try:
        import e_invoice

        remote = await e_invoice.fetch_integrator_xml(invoice_id)
        if remote:
            return Response(
                remote,
                media_type="application/xml",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "X-Document-Source": "integrator",
                },
            )
    except HTTPException:
        pass
    except Exception:
        pass
    seller = await _db.companies.find_one({"_id": inv["company_id"]}) or {}
    contact = await _db.contacts.find_one({"_id": inv.get("contact_id")}) if inv.get("contact_id") else None
    xml = build_invoice_ubl(inv, seller, _buyer_from(inv, contact))
    return Response(xml, media_type="application/xml", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
