"""n11 Faturam (Digital Planet) SOAP e-Fatura / e-Arşiv client."""
from __future__ import annotations

import base64
import io
import logging
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

LIVE_URL = "https://www.n11faturam.com/integrationservicewithoutmtom/IntegrationService.asmx"
TEST_URL = "https://n11integrationtest.digitalplanet.com.tr/IntegrationService.asmx"
NS_SOAP = "http://tempuri.org/"
UNIT_MAP = {
    "Adet": "C62", "adet": "C62", "C62": "C62",
    "Kg": "KGM", "kg": "KGM", "KGM": "KGM",
    "Lt": "LTR", "Litre": "LTR", "LTR": "LTR",
    "Metre": "MTR", "m": "MTR", "MTR": "MTR",
    "Paket": "PK", "PK": "PK",
}


def soap_url(settings: dict) -> str:
    custom = (settings.get("api_url") or "").strip()
    if custom:
        return custom
    return LIVE_URL if (settings.get("mode") or "test") == "live" else TEST_URL


def document_url(tax_id: str, ettn: str, e_type: str) -> str:
    doctype = "arcinv" if e_type == "e_archive" else "outinvoice"
    return f"https://ebelge.n11faturam.com/ViewDocument.aspx?ID={tax_id}&UUID={ettn}&doctype={doctype}"


def _esc(value: Any) -> str:
    return escape(str(value if value is not None else ""), {'"': "&quot;", "'": "&apos;"})


def _local(tag: str) -> str:
    return (tag.split("}")[-1] if "}" in tag else tag).strip()


def _key(tag: str) -> str:
    """Etiket adını karşılaştırma anahtarına indirger.

    n11/Digital Planet aynı alanı yanıttan yanıta farklı yazıyor: SenderTaxId /
    Sendertaxid / SENDERTAXID, UUID / Uuid. Büyük-küçük harfe ve alt tireye
    duyarlı karşılaştırma yüzünden alanlar boş dönüyordu.
    """
    return _local(tag).replace("_", "").lower()


def _text(root: Optional[ET.Element], name: str, default: str = "") -> str:
    if root is None:
        return default
    want = _key(name)
    if _key(root.tag) == want and (root.text or "").strip():
        return (root.text or "").strip()
    for el in root.iter():
        if _key(el.tag) == want and (el.text or "").strip():
            return (el.text or "").strip()
    return default


def _first(root: Optional[ET.Element], *names: str) -> str:
    """İlk dolu alanı döndürür; alan adı sürüme göre değiştiği için birden çok ad denenir."""
    for name in names:
        value = _text(root, name)
        if value:
            return value
    return ""


def _all(root: Optional[ET.Element], name: str) -> List[ET.Element]:
    if root is None:
        return []
    want = _key(name)
    return [el for el in root.iter() if _key(el.tag) == want]


def _money(value: Any) -> str:
    try:
        return f"{float(value or 0):.2f}"
    except (TypeError, ValueError):
        return "0.00"


def gib_invoice_id(invoice_number: str, issue_date: str) -> str:
    raw = re.sub(r"[^A-Z0-9]", "", (invoice_number or "").upper())
    if re.fullmatch(r"[A-Z0-9]{3}\d{13}", raw):
        return raw
    year = (issue_date or "")[:4]
    if not re.fullmatch(r"\d{4}", year):
        year = datetime.now(timezone.utc).strftime("%Y")
    digits = re.sub(r"\D", "", invoice_number or "")
    if digits.startswith(year):
        digits = digits[4:]
    digits = digits[-9:].zfill(9)
    return f"TKB{year}{digits}"


def build_ubl(invoice: dict, company: dict, contact: Optional[dict], ettn: Optional[str] = None) -> Tuple[str, str, str]:
    """Return (xml, ettn, invoice_id) for UBL-TR 1.2."""
    ettn = ettn or str(uuid.uuid4()).upper()
    inv_id = gib_invoice_id(invoice.get("invoice_number") or "", invoice.get("issue_date") or "")
    e_type = invoice.get("e_type") or "e_archive"
    profile = invoice.get("_profile_override") or invoice.get("gib_scenario")
    if profile not in ("TEMELFATURA", "TICARIFATURA", "EARSIVFATURA", "IHRACAT"):
        profile = "TICARIFATURA" if e_type == "e_invoice" else "EARSIVFATURA"
    issue = (invoice.get("issue_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))[:10]
    due = (invoice.get("due_date") or issue)[:10]
    currency = invoice.get("currency") or "TRY"
    items = invoice.get("items") or []
    subtotal = float(invoice.get("subtotal") or 0)
    vat_total = float(invoice.get("vat_total") or 0)
    discount = float(invoice.get("discount_total") or 0)
    payable = float(invoice.get("grand_total") or (subtotal + vat_total))
    notes = invoice.get("notes") or ""

    seller_tax = re.sub(r"\D", "", str(company.get("tax_number") or ""))
    seller_scheme = "VKN" if len(seller_tax) == 10 else "TCKN"
    if len(seller_tax) not in (10, 11):
        seller_tax, seller_scheme = (seller_tax.zfill(10)[:10] or "0000000000"), "VKN"
    buyer_tax = re.sub(r"\D", "", str((contact or {}).get("tax_number_or_id") or invoice.get("contact_tax_id") or ""))
    if e_type == "e_archive" and len(buyer_tax) not in (10, 11):
        buyer_tax = "11111111111"
    buyer_scheme = "VKN" if len(buyer_tax) == 10 else "TCKN"
    buyer_name = (contact or {}).get("name") or invoice.get("contact_name") or "Nihai Tüketici"

    def party(tax: str, scheme: str, name: str, src: dict) -> str:
        street = _esc(src.get("address") or "")
        city = _esc(src.get("city") or "İstanbul")
        district = _esc(src.get("district") or src.get("tax_office") or "")
        email = _esc(src.get("email") or "")
        phone = _esc(src.get("phone") or "")
        office = _esc(src.get("tax_office") or "")
        person = ""
        if scheme == "TCKN":
            parts = (name or "").split(None, 1)
            first, last = (parts[0] if parts else "Ad"), (parts[1] if len(parts) > 1 else "Soyad")
            person = f"<cac:Person><cbc:FirstName>{_esc(first)}</cbc:FirstName><cbc:FamilyName>{_esc(last)}</cbc:FamilyName></cac:Person>"
        return f"""<cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="{scheme}">{_esc(tax)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>{_esc(name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>{street or "-"}</cbc:StreetName>
        <cbc:CitySubdivisionName>{district or "-"}</cbc:CitySubdivisionName>
        <cbc:CityName>{city}</cbc:CityName>
        <cbc:Country><cbc:Name>Türkiye</cbc:Name></cbc:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>{office or "Vergi Dairesi"}</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
      <cac:Contact><cbc:Telephone>{phone}</cbc:Telephone><cbc:ElectronicMail>{email}</cbc:ElectronicMail></cac:Contact>
      {person}
    </cac:Party>"""

    lines_xml = []
    for i, item in enumerate(items, 1):
        qty = float(item.get("quantity") or 1) or 1
        total = float(item.get("total") or 0)
        price = float(item.get("unit_price") or (total / qty if qty else 0))
        vat = float(item.get("vat_rate") or 20)
        vat_amt = round(total * vat / 100.0, 2)
        unit = UNIT_MAP.get(str(item.get("unit") or "Adet"), "C62")
        sku = item.get("sku") or item.get("product_id") or ""
        sku_xml = f"<cac:SellersItemIdentification><cbc:ID>{_esc(sku)}</cbc:ID></cac:SellersItemIdentification>" if sku else ""
        lines_xml.append(f"""<cac:InvoiceLine>
    <cbc:ID>{i}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="{unit}">{qty:g}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="{currency}">{_money(total)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="{currency}">{_money(vat_amt)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="{currency}">{_money(total)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="{currency}">{_money(vat_amt)}</cbc:TaxAmount>
        <cbc:Percent>{vat:g}</cbc:Percent>
        <cac:TaxCategory>
          <cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>{_esc(item.get("name") or "Kalem")}</cbc:Name>
      {sku_xml}
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="{currency}">{_money(price)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>""")

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>{profile}</cbc:ProfileID>
  <cbc:ID>{_esc(inv_id)}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>{ettn}</cbc:UUID>
  <cbc:IssueDate>{issue}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  {f"<cbc:Note>{_esc(notes)}</cbc:Note>" if notes else ""}
  <cbc:DocumentCurrencyCode>{_esc(currency)}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>{len(items)}</cbc:LineCountNumeric>
  <cac:OrderReference><cbc:ID>{_esc(invoice.get("order_number") or invoice.get("invoice_number") or inv_id)}</cbc:ID></cac:OrderReference>
  <cac:AccountingSupplierParty>{party(seller_tax, seller_scheme, company.get("name") or "Satıcı", company)}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>{party(buyer_tax, buyer_scheme, buyer_name, contact or {})}</cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>1</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>{due}</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="{currency}">{_money(vat_total)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="{currency}">{_money(subtotal)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="{currency}">{_money(vat_total)}</cbc:TaxAmount>
      <cbc:Percent>20</cbc:Percent>
      <cac:TaxCategory>
        <cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="{currency}">{_money(subtotal + discount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="{currency}">{_money(subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="{currency}">{_money(subtotal + vat_total)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="{currency}">{_money(discount)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="{currency}">{_money(payable)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  {"".join(lines_xml)}
</Invoice>
"""
    return xml, ettn, inv_id


def parse_soap_xml(body: bytes) -> ET.Element:
    try:
        return ET.fromstring(body)
    except ET.ParseError as e:
        raise HTTPException(status_code=502, detail=f"n11 Faturam SOAP yanıtı okunamadı: {e}") from e


def _fault(root: ET.Element) -> None:
    fault = _text(root, "faultstring") or _text(root, "Fault")
    if fault and _text(root, "faultcode"):
        raise HTTPException(status_code=502, detail=f"n11 Faturam SOAP hatası: {fault[:300]}")


def parse_ticket(body: bytes) -> str:
    root = parse_soap_xml(body)
    _fault(root)
    ticket = _text(root, "GetFormsAuthenticationTicketResult") or _text(root, "GetFormsAuthenticationTicketPWResult")
    if not ticket or ticket.lower() in ("null", "none"):
        desc = _text(root, "ServiceResultDescription") or "ticket alınamadı"
        raise HTTPException(status_code=401, detail=f"n11 Faturam oturumu açılamadı: {desc}")
    return ticket


# Servisin fatura satırını sardığı bilinen etiketler (küçük harf, alt tiresiz).
_ROW_TAGS = {
    "invoicestateresult", "invoiceinforesult", "invoiceinfo", "invoiceresult",
    "incominginvoiceresult", "incominginvoiceinfo", "incominginvoice",
    "inboxinvoiceresult", "inboxinvoice", "invoicelistresult",
}
# Bir düğümü "fatura satırı" yapan doğrudan alt alanlar.
_ROW_MARKERS = {"uuid", "ettn", "invoiceuuid", "documentuuid", "invoiceid", "returnvalue"}


def _innermost(cand: List[ET.Element]) -> List[ET.Element]:
    """Başka bir adayı içeren adayları atar; yalnızca en içtekiler kalır."""
    inner = []
    for el in cand:
        descendants = {id(x) for x in el.iter()} - {id(el)}
        if any(id(other) in descendants for other in cand):
            continue
        inner.append(el)
    return inner


def invoice_rows(node: Optional[ET.Element]) -> List[ET.Element]:
    """Yanıttaki fatura düğümlerini bulur.

    Bir düğümün fatura satırı olması için doğrudan altında UUID/ETTN/
    InvoiceId/ReturnValue taşıması gerekiyor; `_ROW_TAGS` yalnızca birden çok
    aday olduğunda hangisinin satır olduğunu ayırmaya yarıyor. Eskiden ada
    bakmak tek başına yeterliydi ve liste kabı da (`InvoiceListResult`) bu
    kümede olduğu için iki ayrı hata çıkıyordu: kap satır sayılıp `_text` alt
    düğümleri taradığından ilk faturanın kopyası ikinci kez ekleniyor, kabın
    çocukları bilinen bir ad taşımadığında ise yalnızca kap dönüp listedeki
    diğer faturalar sessizce kayboluyordu.
    """
    if node is None:
        return []
    marked = [el for el in node.iter() if any(_key(c.tag) in _ROW_MARKERS for c in el)]
    named = [el for el in marked if _key(el.tag) in _ROW_TAGS]
    return _innermost(named or marked)


def parse_service_result(root: ET.Element, result_tag: str) -> Dict[str, Any]:
    _fault(root)
    node = next((el for el in root.iter() if _key(el.tag) == _key(result_tag)), root)
    status = _text(node, "ServiceResult")
    desc = _text(node, "ServiceResultDescription")
    if status and status.lower() not in ("successful", "success", ""):
        raise HTTPException(status_code=502, detail=f"n11 Faturam: {desc or status}")
    invoices = []
    for inv in invoice_rows(node):
        invoices.append({
            "uuid": _first(inv, "UUID", "Ettn", "InvoiceUUID", "DocumentUUID"),
            "invoice_id": _first(inv, "InvoiceId", "InvoiceNumber", "DocumentId"),
            "status": _text(inv, "ServiceResult") or status,
            "status_description": _first(inv, "StatusDescription", "ServiceResultDescription"),
            "status_code": _text(inv, "StatusCode"),
            "sender_tax_id": _first(inv, "Sendertaxid", "SenderTaxNumber", "SenderIdentifier"),
            "receiver_tax_id": _first(inv, "Receivertaxid", "ReceiverTaxNumber", "ReceiverIdentifier"),
            "party_name": _first(inv, "Partyname", "SenderName", "CompanyName", "Title"),
            "payable": _first(inv, "Payableamount", "Amount"),
            "issue_date": _first(inv, "Issuedate", "InvoiceDate", "CreateDate"),
            "profile": _first(inv, "Profileid", "Profile"),
            "return_value": _first(inv, "ReturnValue", "InvoiceRawData", "XmlData", "InvoiceData"),
        })
    first = invoices[0] if invoices else {}
    if first.get("status") and first["status"].lower() not in ("successful", "success", ""):
        raise HTTPException(status_code=502, detail=f"n11 Faturam fatura hatası: {first.get('status_description') or first['status']}")
    return {
        "service_result": status or "Successful",
        "description": desc,
        "uuid": first.get("uuid") or _text(node, "UUID"),
        "invoice_id": first.get("invoice_id") or _text(node, "InvoiceId"),
        "invoices": invoices,
    }


def parse_customer_list(body: bytes) -> List[Dict[str, Any]]:
    root = parse_soap_xml(body)
    _fault(root)
    status = _text(root, "ServiceResult")
    if status and status.lower() not in ("successful", "success", ""):
        raise HTTPException(status_code=502, detail=_text(root, "ServiceResultDescription") or status)
    out = []
    for c in _all(root, "EInvoiceCustomerResult"):
        exist = (_text(c, "IsExist") or "").lower() in ("true", "1")
        out.append({
            "tax_id": _text(c, "TaxIdOrPersonalId"),
            "alias": _text(c, "Alias"),
            "type": _text(c, "Type"),
            "name": _text(c, "Name"),
            "is_exist": exist,
        })
    return out


async def _post(url: str, action: str, inner_xml: str) -> bytes:
    envelope = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
        'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
        f"<soap:Body>{inner_xml}</soap:Body></soap:Envelope>"
    )
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=15.0)) as client:
            r = await client.post(
                url,
                content=envelope.encode("utf-8"),
                headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": f'"{NS_SOAP}{action}"'},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"n11 Faturam'a bağlanılamadı: {e}") from e
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"n11 Faturam HTTP {r.status_code}: {(r.text or '')[:240]}")
    return r.content


async def get_ticket(settings: dict, password: str) -> str:
    corp = (settings.get("corporate_code") or "").strip()
    user = (settings.get("username") or "").strip()
    if not corp or not user or not password:
        raise HTTPException(status_code=400, detail="n11 Faturam kurum kodu, kullanıcı adı ve şifre gerekli.")
    inner = (
        f'<GetFormsAuthenticationTicket xmlns="{NS_SOAP}">'
        f"<CorporateCode>{_esc(corp)}</CorporateCode>"
        f"<LoginName>{_esc(user)}</LoginName>"
        f"<Password>{_esc(password)}</Password>"
        "</GetFormsAuthenticationTicket>"
    )
    return parse_ticket(await _post(soap_url(settings), "GetFormsAuthenticationTicket", inner))


async def test_login(settings: dict, password: str) -> Dict[str, Any]:
    ticket = await get_ticket(settings, password)
    return {"ok": True, "ticket_preview": ticket[:8] + "…", "message": "n11 Faturam oturumu açıldı.", "endpoint": soap_url(settings)}


async def lookup_user(settings: dict, password: str, tax_id: str) -> Dict[str, Any]:
    ticket = await get_ticket(settings, password)
    inner = (
        f'<CheckCustomerTaxId xmlns="{NS_SOAP}">'
        f"<Ticket>{_esc(ticket)}</Ticket>"
        f"<TaxIdOrPersonalId>{_esc(tax_id)}</TaxIdOrPersonalId>"
        "</CheckCustomerTaxId>"
    )
    rows = parse_customer_list(await _post(soap_url(settings), "CheckCustomerTaxId", inner))
    hit = next((r for r in rows if r.get("is_exist")), None) or (rows[0] if rows else None)
    if not hit:
        return {"tax_id": tax_id, "is_e_invoice_user": False, "alias": "", "name": ""}
    return {
        "tax_id": hit.get("tax_id") or tax_id,
        "is_e_invoice_user": bool(hit.get("is_exist")),
        "alias": hit.get("alias") or "",
        "name": hit.get("name") or "",
    }


async def send_document(settings: dict, password: str, invoice: dict, contact: Optional[dict], company: dict) -> Dict[str, Any]:
    e_type = invoice.get("e_type") or "e_archive"
    if e_type not in ("e_invoice", "e_archive"):
        raise HTTPException(status_code=400, detail="n11 Faturam yalnızca e-Fatura ve e-Arşiv gönderir.")
    ticket = await get_ticket(settings, password)
    xml, ettn, inv_id = build_ubl(invoice, company or {}, contact)
    raw = base64.b64encode(xml.encode("utf-8")).decode("ascii")
    corp = _esc((settings.get("corporate_code") or "").strip())
    map_code = _esc(invoice.get("id") or invoice.get("_id") or inv_id)
    receiver = _esc((contact or {}).get("e_invoice_alias") or settings.get("alias") or "")
    if e_type == "e_invoice":
        inner = (
            f'<SendInvoiceData xmlns="{NS_SOAP}">'
            f"<Ticket>{_esc(ticket)}</Ticket><FileType>UBL</FileType>"
            f"<InvoiceRawData>{raw}</InvoiceRawData>"
            f"<CorporateCode>{corp}</CorporateCode><MapCode>{map_code}</MapCode>"
            f"<ReceiverPostboxName>{receiver}</ReceiverPostboxName>"
            "</SendInvoiceData>"
        )
        action, result_tag = "SendInvoiceData", "SendInvoiceDataResult"
    else:
        inner = (
            f'<SendEArchiveData xmlns="{NS_SOAP}">'
            f"<Ticket>{_esc(ticket)}</Ticket><FileType>UBL</FileType>"
            f"<InvoiceRawData>{raw}</InvoiceRawData>"
            f"<CorporateCode>{corp}</CorporateCode><MapCode>{map_code}</MapCode>"
            "</SendEArchiveData>"
        )
        action, result_tag = "SendEArchiveData", "SendEArchiveDataResult"
    parsed = parse_service_result(parse_soap_xml(await _post(soap_url(settings), action, inner)), result_tag)
    uuid_out = parsed.get("uuid") or ettn
    seller = re.sub(r"\D", "", str((company or {}).get("tax_number") or ""))
    return {
        "ettn": uuid_out,
        "invoice_id": parsed.get("invoice_id") or inv_id,
        "ubl_id": inv_id,
        "document_url": document_url(seller, uuid_out, e_type) if seller and uuid_out else "",
        "description": parsed.get("description") or "",
    }


UBL_ROOTS = ("Invoice", "DespatchAdvice")
# Arşiv sınırları: bir e-fatura ZIP'i tek bir UBL taşır, kalanı imza ve ek olur.
MAX_ZIP_ENTRIES = 32
MAX_ZIP_MEMBER_BYTES = 4 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 16 * 1024 * 1024
_ROOT_RE = re.compile(rb"<\s*(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)[\s/>]")


def _root_name(data: bytes) -> str:
    """Belgenin kök etiketinin yerel adını döndürür (bildirim, yorum ve DOCTYPE atlanır)."""
    head = re.sub(rb"<\?.*?\?>|<!--.*?-->|<!\[CDATA\[.*?\]\]>|<!DOCTYPE[^>]*>", b" ", data[:4096], flags=re.S)
    m = _ROOT_RE.search(head)
    return m.group(2).decode("ascii", "ignore") if m else ""


def _zip_xml_members(z: zipfile.ZipFile):
    """Arşivdeki XML girdilerini sınırlı boyutta okur.

    Girdiler tek tek ve üst sınırla okunuyor: başlıktaki boyut yalan
    söyleyebildiği için sıkıştırma oranı yüksek bir arşiv, tek bir istekle
    paylaşılan API işçisinin belleğini tüketebilir. Girdi sayısı, tek girdinin
    açılmış boyutu ve toplam açılan bayt ayrı ayrı sınırlı.
    """
    total = 0
    for info in z.infolist()[:MAX_ZIP_ENTRIES]:
        if info.is_dir() or not info.filename.lower().endswith(".xml"):
            continue
        if info.file_size > MAX_ZIP_MEMBER_BYTES:
            continue
        with z.open(info) as fh:
            member = fh.read(MAX_ZIP_MEMBER_BYTES + 1)
        if len(member) > MAX_ZIP_MEMBER_BYTES:
            continue
        total += len(member)
        if total > MAX_ZIP_TOTAL_BYTES:
            return
        yield member


def _as_xml(data: Optional[bytes]) -> Optional[bytes]:
    """Ham baytları UBL XML'e indirger; ZIP ise içindeki ilk XML'i çıkarır.

    Kök etiketi Invoice/DespatchAdvice olmayan içerik atılır: eskiden `<?xml`
    görmek yetiyordu, bu yüzden SOAP zarfları ve hata belgeleri fatura sanılıp
    tamamen boş kayıt olarak gelen kutusuna düşüyordu.
    """
    if not data:
        return None
    if data[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                data = next((d for d in _zip_xml_members(z) if _root_name(d) in UBL_ROOTS), None)
                if data is None:
                    return None
        except (zipfile.BadZipFile, KeyError, RuntimeError, ValueError):
            return None
    data = data.lstrip(b"\xef\xbb\xbf").lstrip()
    return data if _root_name(data) in UBL_ROOTS else None


def _decode_xml(payload: str) -> Optional[bytes]:
    """ReturnValue alanını XML'e çevirir: base64, base64'lü ZIP ya da düz XML olabilir."""
    if not payload:
        return None
    text = payload.strip()
    if text.startswith("<"):
        return _as_xml(text.encode("utf-8"))
    try:
        # Servis base64'ü satır sonlarıyla bölerek gönderiyor; boşlukları at.
        data = base64.b64decode("".join(text.split()), validate=False)
    except Exception:
        return None
    return _as_xml(data)


def _extract_invoice_payload(root: Optional[ET.Element]) -> Optional[bytes]:
    """GetInvoiceXML* yanıtından UBL baytlarını çıkarır.

    Sonuç sarmalayıcısının (GetInvoiceXMLResult) kendi metni değil; önce
    ReturnValue / InvoiceRawData gibi gövde alanlarına bakılır. Aksi halde
    boş ReturnValue + 'Invoice is retrieved successfully.' çifti başarı
    açıklamasını hata sanmadan sessizce XML'siz kalıyordu.
    """
    if root is None:
        return None
    raw = _first(root, "ReturnValue", "InvoiceRawData", "XmlData", "InvoiceData", "FileContent")
    decoded = _decode_xml(raw)
    if decoded:
        return decoded
    # Bazı ortamlarda UBL doğrudan sonuç etiketinin metninde (iç çocuk yok).
    for el in root.iter():
        if _key(el.tag) not in ("getinvoicexmlresult", "getinvoicexmlwithoutflagresult"):
            continue
        if list(el):
            continue
        text = (el.text or "").strip()
        if not text:
            continue
        decoded = _decode_xml(text)
        if decoded:
            return decoded
    # ReturnValueBySovos: UBL SOAP ağacına gömülü gelebilir.
    for el in root.iter():
        if _key(el.tag) not in ("invoice", "despatchadvice"):
            continue
        if not (list(el) or (el.text or "").strip()):
            continue
        try:
            blob = ET.tostring(el, encoding="utf-8")
        except Exception:
            continue
        got = _as_xml(blob)
        if got:
            return got
    return None


def _xml_error_message(root: Optional[ET.Element], *, had_non_ubl: bool = False) -> str:
    """Servis açıklamasını kullanıcıya göstermek için Türkçeleştirir.

    'Invoice is retrieved successfully.' başarı metnidir; boş gövdede bunu
    hata nedeni olarak göstermek '22 alınamadı (…successfully…)' gibi çelişki
    yaratıyordu.
    """
    if had_non_ubl:
        return "n11'in gönderdiği belge UBL e-Fatura değil."
    desc = (_text(root, "ServiceResultDescription") if root is not None else "") or ""
    status = (_text(root, "ServiceResult") if root is not None else "") or ""
    low = f"{status} {desc}".lower()
    if any(token in low for token in ("success", "successful", "retrieved successfully")):
        return "n11 faturayı buldu ama UBL XML gövdesi boş döndü."
    if desc.strip():
        return desc.strip()[:200]
    return "n11 bu fatura için XML döndürmedi."


async def _fetch_invoice_xml(settings: dict, ticket: str, invoice_uuid: str) -> Tuple[Optional[bytes], str]:
    """UUID ile UBL çeker.

    GetInvoiceXML bazen faturayı 'alınmış' işaretleyip sonraki çağrıda
    Successful + boş ReturnValue döndürüyor. GetInvoiceXMLWithOutFlag bayrağı
    değiştirmeden gövdeyi yeniden verir; onu önce deneriz.
    """
    last_error = ""
    for action in ("GetInvoiceXMLWithOutFlag", "GetInvoiceXML"):
        inner = (
            f'<{action} xmlns="{NS_SOAP}">'
            f"<Ticket>{_esc(ticket)}</Ticket><UUID>{_esc(invoice_uuid)}</UUID>"
            f"</{action}>"
        )
        try:
            root = parse_soap_xml(await _post(soap_url(settings), action, inner))
        except HTTPException as e:
            last_error = str(e.detail)
            logger.warning("n11 Faturam %s başarısız (%s): %s", action, invoice_uuid, last_error)
            continue
        xml_bytes = _extract_invoice_payload(root)
        if xml_bytes:
            return xml_bytes, ""
        last_error = _xml_error_message(root)
    return None, last_error or "n11 bu fatura için XML döndürmedi."


async def list_incoming(settings: dict, password: str, days: int = 14) -> List[Dict[str, Any]]:
    ticket = await get_ticket(settings, password)
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=max(1, min(int(days or 14), 90)))
    inner = (
        f'<GetIncomingInvoicesByIssueDate xmlns="{NS_SOAP}">'
        f"<Ticket>{_esc(ticket)}</Ticket>"
        f"<CorporateCode>{_esc((settings.get('corporate_code') or '').strip())}</CorporateCode>"
        f"<StartDate>{start.strftime('%Y-%m-%dT00:00:00')}</StartDate>"
        f"<EndDate>{end.strftime('%Y-%m-%dT23:59:59')}</EndDate>"
        "</GetIncomingInvoicesByIssueDate>"
    )
    parsed = parse_service_result(
        parse_soap_xml(await _post(soap_url(settings), "GetIncomingInvoicesByIssueDate", inner)),
        "GetIncomingInvoicesByIssueDateResult",
    )
    out = []
    for inv in parsed.get("invoices") or []:
        raw = inv.get("return_value") or ""
        xml_bytes = _decode_xml(raw)
        error = "n11'in gönderdiği belge UBL e-Fatura değil." if raw and not xml_bytes else ""
        if not xml_bytes and inv.get("uuid"):
            xml_bytes, fetch_error = await _fetch_invoice_xml(settings, ticket, inv["uuid"])
            if not xml_bytes:
                error = fetch_error or error or "n11 bu fatura için XML döndürmedi."
        elif not xml_bytes:
            error = error or "Faturanın UUID'si yok, XML istenemedi."
        out.append({**inv, "xml": xml_bytes, "xml_error": "" if xml_bytes else error})
    return out
