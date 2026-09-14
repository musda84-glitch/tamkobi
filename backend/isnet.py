"""İşNet NetteFatura SOAP/REST istemcisi.

Resmi sözleşme: https://github.com/EfeSorogluu/NetteFatura-API
  (InvoiceService + AddressBookService, IP–VKN / CompanyTaxCode)

İki kanal:
1) Portal REST — Account/Login + GetHealthCheck (kullanıcı/şifre).
2) NetteFatura SOAP — HealthCheck, GetCompanyBalance, GetTaxPayer,
   SendInvoiceXml / SendArchiveInvoiceXml, SearchInvoice.
"""
from __future__ import annotations

import base64
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape as xml_esc

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# --- Endpoints: nettefatura-api NETTEFATURA_ENDPOINTS ile birebir ---
LIVE_API = "https://einvoiceapi.isnet.net.tr"
TEST_API = "https://einvoiceapitest.isnet.net.tr"
LIVE_SOAP = "https://einvoiceservice.isnet.net.tr/InvoiceService/ServiceContract/InvoiceService.svc"
TEST_SOAP = "https://einvoiceservicetest.isnet.net.tr/InvoiceService/ServiceContract/InvoiceService.svc"
LIVE_ADDRESS_BOOK = (
    "https://einvoiceservice.isnet.net.tr/AddressBookService/ServiceContract/AddressBookService.svc"
)
TEST_ADDRESS_BOOK = (
    "https://einvoiceservicetest.isnet.net.tr/AddressBookService/ServiceContract/AddressBookService.svc"
)
LIVE_PORTAL = "https://nettefatura.isnet.net.tr"
TEST_PORTAL = "https://efatura.isnet.net.tr"

SOAP_NS = "http://tempuri.org/"
EIN_NS = "http://schemas.datacontract.org/2004/07/EInvoice.Service.Model"
ARR_NS = "http://schemas.microsoft.com/2003/10/Serialization/Arrays"

# WCF DataContract dizi eleman adları (NetteFatura-API ARRAY_ITEM_NAME_MAP)
_ARRAY_ITEM = {
    "Invoices": "Invoice",
    "ArchiveInvoices": "ArchiveInvoice",
    "TaxPayers": "TaxPayer",
    "InboxTagList": "string",
    "OutboxTagList": "string",
    "Aliases": "Alias",
    "Notes": "string",
}


def is_test_mode(settings: dict) -> bool:
    mode = (settings.get("mode") or "test").strip().lower()
    return mode in ("test", "sandbox", "demo")


def api_base(settings: dict) -> str:
    custom = (settings.get("api_url") or "").strip().rstrip("/")
    if custom:
        return custom
    return TEST_API if is_test_mode(settings) else LIVE_API


def soap_url(settings: dict) -> str:
    return TEST_SOAP if is_test_mode(settings) else LIVE_SOAP


def address_book_url(settings: dict) -> str:
    return TEST_ADDRESS_BOOK if is_test_mode(settings) else LIVE_ADDRESS_BOOK


def portal_url(settings: dict) -> str:
    return TEST_PORTAL if is_test_mode(settings) else LIVE_PORTAL


def company_tax_code(settings: dict, company: Optional[dict] = None) -> str:
    for src in (settings or {}, company or {}):
        for key in (
            "company_tax_id",
            "company_tax_code",
            "vkn",
            "tax_number",
            "tax_id",
            "vergi_no",
        ):
            val = re.sub(r"\D", "", str(src.get(key) or ""))
            if len(val) in (10, 11):
                return val
    return ""


def company_vendor_number(settings: dict) -> str:
    return str(
        settings.get("company_vendor_number")
        or settings.get("vendor_number")
        or settings.get("branch_code")
        or ""
    ).strip()


def _company_request(settings: dict, tax: Optional[str] = None) -> Dict[str, str]:
    """SOAP isteklerinde CompanyTaxCode (+ opsiyonel CompanyVendorNumber)."""
    code = re.sub(r"\D", "", str(tax or company_tax_code(settings) or ""))
    req: Dict[str, str] = {"CompanyTaxCode": code}
    vendor = company_vendor_number(settings)
    if vendor:
        req["CompanyVendorNumber"] = vendor
    return req


# ---------------------------------------------------------------------------
# Portal REST
# ---------------------------------------------------------------------------

async def health_check(settings: dict) -> bool:
    url = f"{api_base(settings)}/api/Account/GetHealthCheck"
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            r = await client.get(url)
        if r.status_code >= 500:
            return False
        text = (r.text or "").strip().lower()
        return text in ("true", '"true"', "ok", '"ok"') or r.status_code == 200
    except Exception:
        logger.exception("İşNet portal health check failed")
        return False


async def login(settings: dict, password: str) -> Dict[str, Any]:
    """Portal API kullanıcısı ile oturum — Token döner."""
    username = (settings.get("username") or "").strip()
    if not username or not password:
        raise HTTPException(status_code=400, detail="İşNet kullanıcı adı ve şifre gerekli.")
    url = f"{api_base(settings)}/api/Account/Login"
    payloads = [
        {"IdentificationNumber": username, "Password": password},
        {"UserName": username, "Password": password},
        {"Username": username, "Password": password},
    ]
    last_detail = "İşNet girişi başarısız."
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
        for body in payloads:
            try:
                r = await client.post(url, json=body)
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"İşNet API'ye ulaşılamadı: {e}") from e
            if r.status_code == 401:
                last_detail = "İşNet kullanıcı adı veya şifre hatalı."
                continue
            if r.status_code >= 400:
                last_detail = f"İşNet Login HTTP {r.status_code}: {(r.text or '')[:180]}"
                continue
            try:
                data = r.json() if r.content else {}
            except Exception:
                data = {}
            if not isinstance(data, dict):
                data = {}
            result = data.get("Result")
            err = (data.get("ErrorMessage") or "").strip()
            token = (data.get("Token") or "").strip()
            ok = bool(token) or result in (0, "0", "Success", "success", True, "True")
            if err and not ok:
                last_detail = err
                continue
            if not ok:
                last_detail = err or "İşNet Login yanıtında Token yok."
                continue
            companies = data.get("CompanyList") or data.get("CompanyList") or []
            return {
                "ok": True,
                "token_preview": (token[:8] + "…") if token else "",
                "user_name": " ".join(x for x in [data.get("Adi"), data.get("Soyadi")] if x).strip(),
                "company_count": len(companies) if isinstance(companies, list) else 0,
                "companies": [
                    {
                        "id": c.get("IdFirma"),
                        "name": c.get("FirmaAdi") or "",
                        "schema": c.get("SchemaName") or "",
                    }
                    for c in (companies if isinstance(companies, list) else [])[:10]
                    if isinstance(c, dict)
                ],
                "endpoint": url,
                "mode": "test" if is_test_mode(settings) else "live",
                "message": "İşNet portal bağlantı testi başarılı.",
            }
    raise HTTPException(status_code=400, detail=last_detail)


async def test_connection(settings: dict, password: str) -> Dict[str, Any]:
    """Portal login + (VKN varsa) NetteFatura SOAP HealthCheck / bakiye.

    SOAP tarafı NetteFatura-API gibi IP–VKN ile çalışır; company_tax_id zorunlu önerilir.
    """
    client_code = (settings.get("corporate_code") or settings.get("client_code") or "").strip()
    if not client_code:
        raise HTTPException(status_code=400, detail="İşNet müşteri / firma kodu gerekli.")
    alias = (settings.get("alias") or "").strip()
    if not alias:
        raise HTTPException(status_code=400, detail="GİB posta kutusu etiketi (alias) gerekli.")

    healthy = await health_check(settings)
    info = await login(settings, password)
    info["ok"] = True
    info["healthy"] = healthy
    info["client_code"] = client_code
    info["alias"] = alias
    info["soap_endpoint"] = soap_url(settings)
    info["address_book_endpoint"] = address_book_url(settings)
    info["portal"] = portal_url(settings)
    info["mode"] = "test" if is_test_mode(settings) else "live"
    info["sdk"] = "https://github.com/EfeSorogluu/NetteFatura-API"
    if not healthy:
        info["warning"] = "Login başarılı ancak GetHealthCheck yanıt vermedi; servis kısmen erişilebilir olabilir."

    tax = company_tax_code(settings)
    info["company_tax_id"] = tax
    if tax:
        try:
            soap_health = await soap_health_check(settings)
            info["soap_health"] = soap_health
            bal = await get_company_balance(settings)
            info["soap_ok"] = True
            info["balance"] = bal.get("balance")
            info["remaining_credit"] = bal.get("remaining_credit")
            shown = bal.get("balance") if bal.get("balance") not in (None, "") else bal.get("remaining_credit")
            info["message"] = (info.get("message") or "Bağlantı OK") + f" · SOAP HealthCheck OK · bakiye: {shown or '?'}"
        except HTTPException as e:
            info["soap_ok"] = False
            info["soap_warning"] = str(e.detail)
            info["message"] = (info.get("message") or "Portal OK") + f" · SOAP: {e.detail}"
    else:
        info["soap_ok"] = None
        info["soap_hint"] = (
            "Şirket VKN (company_tax_id) girin — NetteFatura SOAP (IP–VKN) bakiye / GİB için zorunlu."
        )
    return info


# ---------------------------------------------------------------------------
# SOAP (NetteFatura-API SoapClient / serializeToSoapXml uyumu)
# ---------------------------------------------------------------------------

def _local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def _text(el: Optional[ET.Element]) -> str:
    if el is None or el.text is None:
        return ""
    return str(el.text).strip()


def _find_text(root: Optional[ET.Element], *names: str) -> str:
    if root is None:
        return ""
    wanted = {n.lower() for n in names}
    for el in root.iter():
        if _local(el.tag).lower() in wanted and el.text and str(el.text).strip():
            return str(el.text).strip()
    return ""


def _find_all(root: Optional[ET.Element], *names: str) -> List[ET.Element]:
    if root is None:
        return []
    wanted = {n.lower() for n in names}
    return [el for el in root.iter() if _local(el.tag).lower() in wanted]


def _serialize_ein(obj: Any, parent: Optional[str] = None) -> str:
    """WCF DataContract SOAP gövdesi — NetteFatura-API serializeToSoapXml (alfabetik anahtar)."""
    if obj is None:
        return ""
    if isinstance(obj, bool):
        return "true" if obj else "false"
    if isinstance(obj, (int, float)):
        return str(obj)
    if isinstance(obj, str):
        return xml_esc(obj)
    if isinstance(obj, list):
        item_name = _ARRAY_ITEM.get(parent or "", "Item")
        chunks = []
        for item in obj:
            if isinstance(item, dict):
                chunks.append(f"<ein:{item_name}>{_serialize_ein(item, item_name)}</ein:{item_name}>")
            else:
                chunks.append(f"<ein:{item_name}>{xml_esc(str(item))}</ein:{item_name}>")
        return "".join(chunks)
    if isinstance(obj, dict):
        parts = []
        for key in sorted(obj.keys()):
            val = obj[key]
            if val is None or (isinstance(val, list) and not val):
                continue
            if isinstance(val, (dict, list)):
                inner = _serialize_ein(val, key)
                if inner:
                    parts.append(f"<ein:{key}>{inner}</ein:{key}>")
            else:
                parts.append(f"<ein:{key}>{_serialize_ein(val, key)}</ein:{key}>")
        return "".join(parts)
    return xml_esc(str(obj))


async def _soap_call(
    settings: dict,
    *,
    endpoint: str,
    action: str,
    service_interface: str,
    request: Optional[dict] = None,
    timeout: float = 60.0,
) -> ET.Element:
    _ = settings
    inner = _serialize_ein(request or {})
    envelope = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
        f'xmlns:tem="{SOAP_NS}" xmlns:ein="{EIN_NS}" xmlns:arr="{ARR_NS}">'
        "<soapenv:Header/>"
        "<soapenv:Body>"
        f"<tem:{action}>"
        f"{'<tem:request>' + inner + '</tem:request>' if request is not None else ''}"
        f"</tem:{action}>"
        "</soapenv:Body>"
        "</soapenv:Envelope>"
    )
    # NetteFatura-API: SOAPAction = http://tempuri.org/IInvoiceService/{Action}
    headers = {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": f'"{SOAP_NS}{service_interface}/{action}"',
    }
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.post(endpoint, content=envelope.encode("utf-8"), headers=headers)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"İşNet SOAP'a ulaşılamadı ({action}): {e}") from e
    text = resp.text or ""
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502, detail=f"İşNet SOAP HTTP {resp.status_code} ({action}): {text[:300]}"
        )
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise HTTPException(status_code=502, detail=f"İşNet SOAP XML parse ({action}): {e}") from e
    body = root.find(".//{http://schemas.xmlsoap.org/soap/envelope/}Body")
    if body is None:
        body = root
    fault = _find_text(body, "faultstring", "FaultString", "Message")
    if body is not None and any(_local(c.tag).lower() == "fault" for c in list(body)):
        raise HTTPException(
            status_code=502, detail=f"İşNet SOAP Fault ({action}): {fault or 'bilinmeyen'}"
        )
    success = _find_text(body, "IsSucceded", "IsSucceeded", "Success", "IsSuccess").lower()
    msg = _find_text(body, "Message", "ErrorMessage", "Error")
    if success in ("false", "0"):
        raise HTTPException(status_code=400, detail=msg or f"İşNet {action} başarısız.")
    return body


async def soap_health_check(settings: dict) -> str:
    """InvoiceService.HealthCheck — NetteFatura-API invoice.healthCheck()."""
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="HealthCheck",
        service_interface="IInvoiceService",
        request=None,
        timeout=20.0,
    )
    return _find_text(body, "HealthCheckResult", "Result") or "OK"


async def get_company_balance(settings: dict, tax_code: Optional[str] = None) -> Dict[str, Any]:
    """GetCompanyBalance — NetteFatura-API invoice.getCompanyBalance()."""
    req = _company_request(settings, tax_code)
    if len(req["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="SOAP bakiye için şirket VKN/TCKN (company_tax_id) gerekli."
        )
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="GetCompanyBalance",
        service_interface="IInvoiceService",
        request=req,
        timeout=25.0,
    )
    return {
        "balance": _find_text(body, "Balance", "RemainingCredit", "TotalCredit", "RemainingCredit"),
        "remaining_credit": _find_text(body, "RemainingCredit", "RemainingCredit"),
        "used_credit": _find_text(body, "UsedCredit", "UsedCredit"),
        "total_credit": _find_text(body, "TotalCredit", "TotalCredit"),
        "message": _find_text(body, "Message") or "OK",
    }


async def lookup_user(settings: dict, password: str, tax_id: str) -> Dict[str, Any]:
    """GetTaxPayer — NetteFatura-API addressBook.getTaxPayer() / n11faturam.lookup_user."""
    _ = password
    tax = re.sub(r"\D", "", str(tax_id or ""))
    if len(tax) not in (10, 11):
        raise HTTPException(status_code=400, detail="VKN 10 veya TCKN 11 haneli olmalıdır.")
    body = await _soap_call(
        settings,
        endpoint=address_book_url(settings),
        action="GetTaxPayer",
        service_interface="IAddressBookService",
        request={"TaxPayerTaxCode": tax},
        timeout=30.0,
    )
    payers = _find_all(body, "TaxPayer")
    if not payers:
        return {"tax_id": tax, "is_e_invoice_user": False, "alias": "", "name": ""}

    payer = payers[0]
    name = _find_text(payer, "TaxPayerName", "Title", "IdentifierName", "Name") or _find_text(
        body, "TaxPayerName", "Title"
    )
    aliases: List[str] = []
    for tag in ("InboxTagList", "OutboxTagList", "Alias", "Aliases", "string"):
        for el in _find_all(payer, tag):
            if list(el):
                for child in el:
                    val = _text(child) or _find_text(child, "Alias", "Value", "Tag")
                    if val and "@" in val and val not in aliases:
                        aliases.append(val)
            else:
                val = _text(el)
                if val and "@" in val and val not in aliases:
                    aliases.append(val)
    for el in _find_all(payer, "Alias"):
        val = _find_text(el, "Alias", "Value", "Tag") or _text(el)
        if val and "@" in val and val not in aliases:
            aliases.append(val)

    is_user = bool(name or aliases)
    return {
        "tax_id": tax,
        "is_e_invoice_user": is_user,
        "alias": aliases[0] if aliases else "",
        "name": name or "",
        "aliases": aliases,
        "source": "isnet",
    }


def _ensure_b64(xml_or_b64: str) -> str:
    raw = (xml_or_b64 or "").strip()
    if not raw:
        return ""
    if raw.lstrip().startswith("<"):
        return base64.b64encode(raw.encode("utf-8")).decode("ascii")
    try:
        base64.b64decode(raw, validate=True)
        return raw
    except Exception:
        return base64.b64encode(raw.encode("utf-8")).decode("ascii")


async def send_invoice_xml(
    settings: dict,
    *,
    ubl_xml: str,
    receiver_alias: str = "",
    is_earchive: bool = False,
) -> Dict[str, Any]:
    """SendInvoiceXml / SendArchiveInvoiceXml — NetteFatura-API invoice.sendInvoiceXml()."""
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet SOAP gönderimi için şirket VKN (company_tax_id) gerekli."
        )
    content = _ensure_b64(ubl_xml)
    if not content:
        raise HTTPException(status_code=400, detail="UBL XML boş.")
    alias = (receiver_alias or settings.get("alias") or "").strip()

    if is_earchive:
        action = "SendArchiveInvoiceXml"
        request: Dict[str, Any] = {
            **req_base,
            "ArchiveInvoices": [{"ArchiveInvoiceContent": content}],
        }
    else:
        action = "SendInvoiceXml"
        item: Dict[str, Any] = {"InvoiceContent": content}
        if alias:
            item["ReceiverTag"] = alias
        request = {**req_base, "Invoices": [item]}

    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action=action,
        service_interface="IInvoiceService",
        request=request,
        timeout=90.0,
    )
    return {
        "ettn": _find_text(body, "ETTN", "Ettn", "UUID", "InvoiceETTN") or "",
        "invoice_id": _find_text(body, "InvoiceNumber", "InvoiceId", "DocumentId") or "",
        "status": _find_text(body, "Status", "State") or "sent",
        "message": _find_text(body, "Message") or "Fatura İşNet'e iletildi.",
        "document_url": _find_text(body, "HtmlUrl", "PdfUrl", "DocumentUrl") or "",
    }


async def send_document(
    settings: dict,
    password: str,
    invoice: dict,
    contact: Optional[dict],
    company: dict,
) -> Dict[str, Any]:
    """n11faturam.send_document ile aynı sözleşme."""
    _ = password
    e_type = invoice.get("e_type") or "e_archive"
    if e_type not in ("e_invoice", "e_archive"):
        raise HTTPException(status_code=400, detail="İşNet yalnızca e-Fatura ve e-Arşiv gönderir.")

    merged = {**settings}
    if not company_tax_code(merged):
        merged["company_tax_id"] = company_tax_code(settings, company)

    try:
        import n11faturam

        xml, ettn, inv_id = n11faturam.build_ubl(invoice, company or {}, contact)
    except Exception as e:
        logger.exception("isnet build_ubl")
        raise HTTPException(status_code=500, detail=f"UBL oluşturma hatası: {e}") from e

    receiver = (
        (contact or {}).get("e_invoice_alias")
        or (contact or {}).get("gib_alias")
        or settings.get("alias")
        or ""
    )
    info = await send_invoice_xml(
        merged,
        ubl_xml=xml,
        receiver_alias=str(receiver or ""),
        is_earchive=(e_type == "e_archive"),
    )
    seller = re.sub(r"\D", "", str((company or {}).get("tax_number") or ""))
    uuid_out = info.get("ettn") or ettn
    return {
        "ettn": uuid_out,
        "invoice_id": info.get("invoice_id") or inv_id,
        "ubl_id": inv_id,
        "document_url": info.get("document_url") or "",
        "description": info.get("message") or "",
        "provider": "isnet",
        "seller_tax": seller,
    }


def _decode_xml_payload(payload: str) -> Optional[bytes]:
    if not payload:
        return None
    text = payload.strip()
    if text.startswith("<"):
        return text.encode("utf-8")
    try:
        return base64.b64decode("".join(text.split()), validate=False)
    except Exception:
        return None


async def list_incoming(settings: dict, password: str, days: int = 14) -> List[Dict[str, Any]]:
    """SearchInvoice (Incoming) — NetteFatura-API invoice.searchInvoice()."""
    _ = password
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet gelen kutu için şirket VKN (company_tax_id) gerekli."
        )
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=max(1, min(int(days or 14), 90)))
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="SearchInvoice",
        service_interface="IInvoiceService",
        request={
            **req_base,
            "InvoiceDirection": "Incoming",
            "MaxInvoiceDate": end.strftime("%Y-%m-%d"),
            "MinInvoiceDate": start.strftime("%Y-%m-%d"),
            "PagingRequest": {"PageNumber": 1, "RecordsPerPage": 50},
            "ResultSet": {
                "IsAdditionalTaxIncluded": False,
                "IsArchiveIncluded": True,
                "IsInvoiceDetailIncluded": True,
                "IsXMLIncluded": True,
            },
        },
        timeout=60.0,
    )
    out: List[Dict[str, Any]] = []
    for inv in _find_all(body, "Invoice", "InvoiceInfo", "Document"):
        uuid = _find_text(inv, "ETTN", "Ettn", "UUID", "InvoiceETTN")
        inv_id = _find_text(inv, "InvoiceNumber", "InvoiceId", "ID")
        raw_xml = _find_text(inv, "InvoiceXML", "XMLContent", "InvoiceContent", "XmlData", "UBL")
        xml_bytes = _decode_xml_payload(raw_xml) if raw_xml else None
        out.append(
            {
                "uuid": uuid,
                "invoice_id": inv_id,
                "sender_vkn": _find_text(inv, "SenderTaxCode", "SenderVKN", "VKN"),
                "sender_title": _find_text(inv, "SenderName", "SenderTitle", "Title"),
                "issue_date": _find_text(inv, "InvoiceDate", "IssueDate", "Date"),
                "payable_amount": _find_text(inv, "PayableAmount", "Payable", "Amount"),
                "profile": _find_text(inv, "ProfileId", "Scenario", "Profile"),
                "status": _find_text(inv, "Status", "State"),
                "xml": xml_bytes,
                "xml_error": (
                    ""
                    if xml_bytes
                    else ("İşNet XML döndürmedi." if not raw_xml else "İşNet XML çözümlenemedi.")
                ),
            }
        )
    return out
