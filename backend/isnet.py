"""İşNet NetteFatura SOAP/REST istemcisi.

Resmi sözleşme (İşNet / NetteFatura):
  InvoiceService + AddressBookService — kimlik doğrulama IP–VKN (CompanyTaxCode).
  SOAP tarafında kullanıcı adı / şifre gerekmez.
  Canlı IP kaydı: efaturadestek@nettefatura.com.tr
  WSDL (test): …/InvoiceService.svc?wsdl · AddressBookService.svc?wsdl

Gönderim başarı ölçütü (NetteFatura-API / WSDL ile aynı):
  SendArchiveInvoiceXml / SendInvoiceXml → satır IsSucceded + geçerli ETTN (UUID).
  GetDocumentViewerLink / Search* portal indeksi gecikebilir; soft verify, gönderimi engellemez.

İsteğe bağlı:
  Portal REST (einvoiceapi) — Account/Login (kullanıcı/şifre) yalnızca ek kontrol için.
"""
from __future__ import annotations

import asyncio
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

# --- Endpoints: İşNet resmi SOAP + NetteFatura portal ---
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
# İşNet destek — canlıda firewall IP–VKN tanımı için
SUPPORT_EMAIL = "efaturadestek@nettefatura.com.tr"
# İşNet test portalı (http://efatura.isnet.net.tr) — resmi deneme hesabı
TEST_PORTAL_USER = "12345678901"
TEST_PORTAL_PASSWORD = "1234"
TEST_FIRM_VKNS = ("4810173324", "1234567805")  # isnet test · Test firma 05
TEST_FIRM_LABELS = {
    "4810173324": "isnet test",
    "1234567805": "Test firma 05",
}

SOAP_NS = "http://tempuri.org/"
EIN_NS = "http://schemas.datacontract.org/2004/07/EInvoice.Service.Model"
ARR_NS = "http://schemas.microsoft.com/2003/10/Serialization/Arrays"

# WCF DataContract dizi eleman adları.
# SendInvoiceXml / SendArchiveInvoiceXml resmi örnekleri (docs/request-samples):
#   Invoices → InvoiceXml, ArchiveInvoices → ArchiveInvoiceXml
# Yapısal SendInvoice / SendArchiveInvoice için Invoice / ArchiveInvoice kullanılır;
# bu istemci yalnızca *Xml metotlarını çağırır.
_ARRAY_ITEM = {
    "Invoices": "InvoiceXml",
    "ArchiveInvoices": "ArchiveInvoiceXml",
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


async def test_connection(settings: dict, password: str = "") -> Dict[str, Any]:
    """SOAP IP–VKN bağlantı testi (asıl yol). Portal login isteğe bağlı.

    İşNet resmi not: SOAP'ta kullanıcı/şifre yok; kimlik doğrulama IP–VKN.
    Canlıda IP kaydı: efaturadestek@nettefatura.com.tr
    """
    alias = (settings.get("alias") or "").strip()
    tax = company_tax_code(settings)
    if len(tax) not in (10, 11):
        raise HTTPException(
            status_code=400,
            detail="Şirket VKN/TCKN (company_tax_id) zorunlu — SOAP CompanyTaxCode / IP–VKN kimliği.",
        )
    if not alias:
        raise HTTPException(status_code=400, detail="GİB posta kutusu etiketi (alias) gerekli.")

    client_code = (settings.get("corporate_code") or settings.get("client_code") or "").strip()
    info: Dict[str, Any] = {
        "ok": True,
        "auth": "ip-vkn",
        "company_tax_id": tax,
        "alias": alias,
        "client_code": client_code or None,
        "soap_endpoint": soap_url(settings),
        "address_book_endpoint": address_book_url(settings),
        "portal": portal_url(settings),
        "mode": "test" if is_test_mode(settings) else "live",
        "support_email": SUPPORT_EMAIL,
        "sdk": "https://github.com/EfeSorogluu/NetteFatura-API",
    }
    if is_test_mode(settings):
        info["test_portal"] = {
            "url": TEST_PORTAL,
            "user": TEST_PORTAL_USER,
            "password": TEST_PORTAL_PASSWORD,
            "firms": [{"vkn": v, "name": TEST_FIRM_LABELS.get(v, v)} for v in TEST_FIRM_VKNS],
        }

    # 1) SOAP HealthCheck + bakiye (IP–VKN)
    try:
        soap_health = await soap_health_check(settings)
        info["soap_health"] = soap_health
        bal = await get_company_balance(settings)
        info["soap_ok"] = True
        info["balance"] = bal.get("balance")
        info["remaining_credit"] = bal.get("remaining_credit")
        shown = bal.get("balance") if bal.get("balance") not in (None, "") else bal.get("remaining_credit")
        info["message"] = f"İşNet SOAP (IP–VKN) OK · HealthCheck · bakiye: {shown or '?'}"
    except HTTPException as e:
        info["soap_ok"] = False
        info["soap_warning"] = str(e.detail)
        hint = ""
        if not is_test_mode(settings):
            hint = f" Canlıda IP–VKN tanımı için {SUPPORT_EMAIL} adresine çıkış IP’nizi iletin."
        elif tax not in TEST_FIRM_VKNS:
            hint = (
                f" Test VKN örnekleri: {', '.join(TEST_FIRM_VKNS)} "
                f"(portal: {TEST_PORTAL_USER} / {TEST_PORTAL_PASSWORD} · {TEST_PORTAL})."
            )
        raise HTTPException(
            status_code=e.status_code,
            detail=f"İşNet SOAP testi başarısız: {e.detail}.{hint}",
        ) from e

    # 2) Opsiyonel portal REST login (şifre varsa)
    username = (settings.get("username") or "").strip()
    if username and password:
        try:
            healthy = await health_check(settings)
            portal = await login(settings, password)
            info["portal_ok"] = True
            info["healthy"] = healthy
            info["token_preview"] = portal.get("token_preview")
            info["user_name"] = portal.get("user_name")
            info["company_count"] = portal.get("company_count")
            info["message"] = (info.get("message") or "SOAP OK") + " · Portal login OK"
        except HTTPException as e:
            info["portal_ok"] = False
            info["portal_warning"] = str(e.detail)
            info["message"] = (info.get("message") or "SOAP OK") + f" · Portal: {e.detail}"
    else:
        info["portal_ok"] = None
        info["portal_hint"] = (
            "SOAP IP–VKN ile çalışır; kullanıcı/şifre zorunlu değildir. "
            f"Portal denemesi için isteğe bağlı API kullanıcı bilgisi girilebilir ({TEST_PORTAL})."
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


def _find_all_texts(root: Optional[ET.Element], *names: str) -> List[str]:
    """Tüm eşleşen etiket metinleri (ilk değil) — iç içe Result=Failed kaçmasın."""
    if root is None:
        return []
    wanted = {n.lower() for n in names}
    out: List[str] = []
    for el in root.iter():
        if _local(el.tag).lower() in wanted and el.text and str(el.text).strip():
            out.append(str(el.text).strip())
    return out


def _find_all(root: Optional[ET.Element], *names: str) -> List[ET.Element]:
    if root is None:
        return []
    wanted = {n.lower() for n in names}
    return [el for el in root.iter() if _local(el.tag).lower() in wanted]


_FAIL_RESULTS = frozenset({"failed", "error", "false", "0"})
_ETTN_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def is_ettn_uuid(value: Optional[str]) -> bool:
    """İşNet ETTN yalnızca UUID formatında geçerli sayılır (yerel fatura no değil)."""
    return bool(value and _ETTN_UUID_RE.match(str(value).strip()))


def _is_fail_flag(value: str) -> bool:
    return (value or "").strip().lower() in _FAIL_RESULTS


def _row_failed(el: ET.Element) -> Optional[str]:
    """InvoiceResult / ArchiveInvoiceReturn satırında başarısızlık mesajı (yoksa None)."""
    ok = _find_text(el, "IsSucceded", "IsSucceeded", "IsSuccess", "Success")
    result = _find_text(el, "Result")
    if ok and _is_fail_flag(ok):
        return (
            _find_text(el, "ErrorMessage", "Error", "Message")
            or f"İşNet satır sonucu başarısız ({ok})."
        )
    if result and _is_fail_flag(result):
        return (
            _find_text(el, "ErrorMessage", "Error", "Message")
            or f"İşNet satır sonucu başarısız ({result})."
        )
    # ErrorMessage varken IsSucceded açıkça true değilse hata say
    err = _find_text(el, "ErrorMessage", "Error")
    if err and (not ok or _is_fail_flag(ok)):
        return err
    return None


def _assert_soap_execution_ok(body: ET.Element, action: str) -> None:
    """HTTP 200 + SOAP Body içinde Result=Failed / IsSucceded=false yakala.

    Önemli: yalnızca ilk Result'a bakmak yetmez — dış Result=Success iken
    iç ArchiveInvoiceReturn.Result=Failed kaçırılıp 'GİB'e iletildi' yazılabiliyordu.
    """
    fail_msgs: List[str] = []
    for val in _find_all_texts(body, "Result"):
        if _is_fail_flag(val):
            fail_msgs.append(val)
    for val in _find_all_texts(body, "IsSucceded", "IsSucceeded", "IsSuccess"):
        if _is_fail_flag(val):
            fail_msgs.append(val)
    # Satır nesneleri (Send*Xml dönüşleri)
    for row in _find_all(
        body,
        "InvoiceResult",
        "ArchiveInvoiceResult",
        "InvoiceResultItem",
        "ArchiveInvoiceReturn",
        "InvoiceReturn",
    ):
        row_err = _row_failed(row)
        if row_err:
            raise HTTPException(status_code=400, detail=row_err)

    if fail_msgs:
        msg = (
            _find_text(body, "ErrorMessage", "Error")
            or _find_text(body, "Message")
            or ""
        )
        raise HTTPException(
            status_code=400,
            detail=msg or f"İşNet {action} başarısız ({fail_msgs[0]}).",
        )

    # Üst düzey ErrorMessage + açık Success yoksa (yalnızca Failed senaryosu)
    top_err = _find_text(body, "ErrorMessage")
    if top_err:
        results = [v.lower() for v in _find_all_texts(body, "Result")]
        oks = [v.lower() for v in _find_all_texts(body, "IsSucceded", "IsSucceeded", "IsSuccess")]
        if any(r in _FAIL_RESULTS for r in results) or any(o in _FAIL_RESULTS for o in oks):
            raise HTTPException(status_code=400, detail=top_err)
        if results and all(r not in ("success", "successful", "ok", "true", "1") for r in results):
            raise HTTPException(status_code=400, detail=top_err)
        if oks and all(o not in ("true", "1", "success") for o in oks):
            raise HTTPException(status_code=400, detail=top_err)


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
    _assert_soap_execution_ok(body, action)
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
    # Satır sonucu: yalnızca başarılı satırdan ETTN al (Failed satırdaki UUID iletildi sayılmasın)
    row_tags = (
        "InvoiceResult",
        "ArchiveInvoiceResult",
        "InvoiceResultItem",
        "ArchiveInvoiceReturn",
        "InvoiceReturn",
    )
    ettn = ""
    invoice_id = ""
    message = ""
    rows = _find_all(body, *row_tags)
    if rows:
        for result_el in rows:
            row_err = _row_failed(result_el)
            if row_err:
                raise HTTPException(status_code=400, detail=row_err)
            ettn = ettn or _find_text(result_el, "ETTN", "Ettn", "InvoiceETTN")
            invoice_id = invoice_id or _find_text(
                result_el, "InvoiceNumber", "InvoiceId", "DocumentId", "ArchiveInvoiceNumber"
            )
            message = message or _find_text(result_el, "Message")
    else:
        # Satır yoksa gövde düzeyi (eski yanıt şekli)
        ettn = _find_text(body, "ETTN", "Ettn", "InvoiceETTN") or ""
        invoice_id = (
            _find_text(body, "InvoiceNumber", "InvoiceId", "DocumentId", "ArchiveInvoiceNumber") or ""
        )
        message = _find_text(body, "Message") or ""
    if not message:
        message = "SOAP yanıtı alındı."
    if not is_ettn_uuid(ettn):
        raise HTTPException(
            status_code=502,
            detail=(
                f"İşNet {action} geçerli ETTN (UUID) döndürmedi"
                f"{f' ({ettn})' if ettn else ''} — fatura NetteFatura'ya düşmemiş olabilir. "
                f"{message}"
            ).strip(),
        )
    return {
        "ettn": ettn.strip(),
        "invoice_id": invoice_id,
        "status": _find_text(body, "Status", "State") or "sent",
        "message": message,
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

        xml, _local_ettn, inv_id = n11faturam.build_ubl(invoice, company or {}, contact)
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
    # NetteFatura-API / WSDL: başarı = satır IsSucceded + geçerli ETTN (UUID).
    # GetDocumentViewerLink / Search anında hazır olmayabilir — soft verify.
    uuid_out = (info.get("ettn") or "").strip()
    if not is_ettn_uuid(uuid_out):
        raise HTTPException(
            status_code=502,
            detail="İşNet geçerli ETTN (UUID) döndürmedi — NetteFatura/GİB kaydı doğrulanamadı.",
        )
    # Yalnızca SOAP'ın verdiği fatura no (yerel TA no ile portal arama yanıltmasın)
    soap_inv_no = (info.get("invoice_id") or "").strip()
    inv_no = soap_inv_no or (inv_id or invoice.get("invoice_number") or "").strip()
    verified = await try_verify_outgoing_in_portal(
        merged,
        uuid_out,
        e_type=e_type,
        invoice_number=soap_inv_no,
        retries=3,
    )
    if not verified.get("ok"):
        logger.info(
            "isnet soft-verify pending ettn=%s inv=%s — SOAP Success kabul (SDK ile aynı)",
            uuid_out,
            soap_inv_no or inv_no,
        )
    return {
        "ettn": uuid_out,
        "invoice_id": inv_no,
        "ubl_id": inv_id,
        "document_url": verified.get("document_url") or info.get("document_url") or "",
        "description": info.get("message") or "",
        "provider": "isnet",
        "seller_tax": seller,
        "verified": bool(verified.get("ok")),
        "verify_via": verified.get("via") or "",
    }


async def search_archive_invoice(
    settings: dict,
    *,
    ettn: str = "",
    invoice_number: str = "",
    min_date: str = "",
    max_date: str = "",
) -> List[Dict[str, Any]]:
    """SearchArchiveInvoice — NetteFatura-API invoice.searchArchiveInvoice()."""
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet arşiv arama için şirket VKN (company_tax_id) gerekli."
        )
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=90)
    req: Dict[str, Any] = {
        **req_base,
        "MinInvoiceDate": (min_date or start.strftime("%Y-%m-%d")),
        "MaxInvoiceDate": (max_date or end.strftime("%Y-%m-%d")),
        "PagingRequest": {"PageNumber": 1, "RecordsPerPage": 50},
        # NetteFatura-API varsayılan ResultSet ile uyum
        "ResultSet": {
            "IsAdditionalTaxIncluded": True,
            "IsArchiveIncluded": True,
            "IsInvoiceDetailIncluded": True,
            "IsHtmlIncluded": True,
            "IsPdfIncluded": True,
            "IsXMLIncluded": False,
        },
    }
    if ettn:
        req["ETTN"] = str(ettn).strip()
    if invoice_number:
        req["InvoiceNumber"] = str(invoice_number).strip()
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="SearchArchiveInvoice",
        service_interface="IInvoiceService",
        request=req,
        timeout=60.0,
    )
    out: List[Dict[str, Any]] = []
    for inv in _find_all(body, "ArchiveInvoice", "ArchiveInvoiceInfo", "Invoice", "ArchiveInvoiceReturn"):
        out.append(
            {
                "ettn": _find_text(inv, "ETTN", "Ettn", "UUID", "InvoiceETTN"),
                "invoice_id": _find_text(inv, "InvoiceNumber", "ArchiveInvoiceNumber", "InvoiceId", "ID"),
                "status": _find_text(inv, "Status", "State"),
            }
        )
    return out


async def search_outgoing_invoice(
    settings: dict,
    *,
    ettn: str = "",
    invoice_number: str = "",
    min_date: str = "",
    max_date: str = "",
) -> List[Dict[str, Any]]:
    """SearchInvoice (Outgoing) — giden e-Fatura arama."""
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet giden fatura arama için şirket VKN (company_tax_id) gerekli."
        )
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=90)
    req: Dict[str, Any] = {
        **req_base,
        "InvoiceDirection": "Outgoing",
        "MinInvoiceDate": (min_date or start.strftime("%Y-%m-%d")),
        "MaxInvoiceDate": (max_date or end.strftime("%Y-%m-%d")),
        "PagingRequest": {"PageNumber": 1, "RecordsPerPage": 50},
        "ResultSet": {
            "IsAdditionalTaxIncluded": True,
            "IsArchiveIncluded": True,
            "IsInvoiceDetailIncluded": True,
            "IsXMLIncluded": False,
        },
    }
    if ettn:
        req["ETTN"] = str(ettn).strip()
    if invoice_number:
        req["InvoiceNumber"] = str(invoice_number).strip()
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="SearchInvoice",
        service_interface="IInvoiceService",
        request=req,
        timeout=60.0,
    )
    out: List[Dict[str, Any]] = []
    for inv in _find_all(body, "Invoice", "InvoiceInfo", "Document"):
        out.append(
            {
                "ettn": _find_text(inv, "ETTN", "Ettn", "UUID", "InvoiceETTN"),
                "invoice_id": _find_text(inv, "InvoiceNumber", "InvoiceId", "ID"),
                "status": _find_text(inv, "Status", "State"),
            }
        )
    return out


async def try_verify_outgoing_in_portal(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
    retries: int = 3,
) -> Dict[str, Any]:
    """NetteFatura-API ile uyum: viewer/search soft doğrulama; bulunamazsa hata fırlatmaz.

    Send*Xml Success+ETTN yeterli kabul edilir; portal indeksi gecikebilir.
    """
    ettn = (ettn or "").strip()
    if not is_ettn_uuid(ettn):
        return {"ok": False, "document_url": "", "via": ""}

    delays = (0.0, 0.8, 1.6)[: max(1, int(retries or 1))]
    last_url = ""
    for attempt, delay in enumerate(delays):
        if delay:
            await asyncio.sleep(delay)
        # 1) GetDocumentViewerLink
        try:
            link = await get_document_viewer_link(
                settings, ettn, e_type=e_type, invoice_number=invoice_number
            )
            last_url = (link.get("url") or link.get("html_url") or link.get("pdf_url") or "").strip()
            if last_url:
                return {"ok": True, "document_url": last_url, "via": "viewer", "attempt": attempt + 1}
        except HTTPException as e:
            logger.info("isnet soft-verify viewer miss ettn=%s try=%s: %s", ettn, attempt + 1, e.detail)

        # 2) SearchArchiveInvoice / SearchInvoice
        try:
            if e_type == "e_archive":
                rows = await search_archive_invoice(
                    settings, ettn=ettn, invoice_number=invoice_number
                )
            else:
                rows = await search_outgoing_invoice(
                    settings, ettn=ettn, invoice_number=invoice_number
                )
            needle = ettn.lower()
            for row in rows:
                row_ettn = (row.get("ettn") or "").strip().lower()
                row_no = (row.get("invoice_id") or "").strip()
                if row_ettn == needle or (invoice_number and row_no == invoice_number):
                    return {
                        "ok": True,
                        "document_url": last_url,
                        "via": "search",
                        "invoice_id": row_no,
                        "attempt": attempt + 1,
                    }
        except HTTPException as e:
            logger.info("isnet soft-verify search miss ettn=%s try=%s: %s", ettn, attempt + 1, e.detail)

    return {"ok": False, "document_url": last_url, "via": ""}


async def verify_outgoing_in_portal(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
) -> Dict[str, Any]:
    """Sıkı doğrulama (PDF/yeniden gönderim). Soft sonucu yoksa 502."""
    info = await try_verify_outgoing_in_portal(
        settings, ettn, e_type=e_type, invoice_number=invoice_number, retries=2
    )
    if info.get("ok"):
        return info
    raise HTTPException(
        status_code=502,
        detail=(
            "İşNet ETTN ile NetteFatura portalında fatura bulunamadı. "
            "Gönderim SOAP Success olsa bile görüntüleme henüz hazır olmayabilir; "
            "birkaç saniye sonra PDF/GİB belgesi deneyin."
        ),
    )


async def get_document_viewer_link(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
    direction: str = "Outgoing",
) -> Dict[str, str]:
    """GetDocumentViewerLink — NetteFatura-API invoice.getDocumentViewerLink()."""
    ettn = (ettn or "").strip()
    if not ettn:
        raise HTTPException(status_code=400, detail="ETTN gerekli.")
    direction = "Incoming" if str(direction or "").lower().startswith("in") else "Outgoing"
    req = {
        **_company_request(settings),
        "Ettn": ettn,
        "InvoiceDirection": direction,
        "InvoiceDocumentType": "EArchiveInvoice" if e_type == "e_archive" else "EInvoice",
    }
    if invoice_number:
        req["InvoiceNumber"] = str(invoice_number)
    if len(req["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet görüntüleme linki için şirket VKN (company_tax_id) gerekli."
        )
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="GetDocumentViewerLink",
        service_interface="IInvoiceService",
        request=req,
        timeout=45.0,
    )
    html = _find_text(body, "HtmlUrl", "DocumentUrl") or ""
    pdf = _find_text(body, "PdfUrl") or ""
    url = html or pdf
    if not url:
        raise HTTPException(
            status_code=404,
            detail=_find_text(body, "Message", "ErrorMessage")
            or "İşNet görüntüleme linki dönmedi.",
        )
    return {"html_url": html, "pdf_url": pdf, "url": url}


def extract_viewer_key(key_or_url: str) -> str:
    """DocumentViewer HtmlUrl/PdfUrl içinden key= parametresini ayıkla."""
    raw = (key_or_url or "").strip()
    if not raw:
        return ""
    if "key=" in raw:
        try:
            from urllib.parse import urlparse, parse_qs, unquote

            parsed = urlparse(raw if "://" in raw else f"https://x.local/{raw.lstrip('/')}")
            qs = parse_qs(parsed.query)
            if qs.get("key"):
                return unquote(qs["key"][0])
        except Exception:
            pass
        m = re.search(r"[?&]key=([^&]+)", raw)
        if m:
            try:
                from urllib.parse import unquote

                return unquote(m.group(1))
            except Exception:
                return m.group(1)
    try:
        from urllib.parse import unquote

        return unquote(raw)
    except Exception:
        return raw


async def download_invoice_pdf(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
    viewer_url: str = "",
    direction: str = "Outgoing",
) -> bytes:
    """İşNet Invoice/GetInvoicePdf — resmi e-Arşiv/e-Fatura PDF (NetteFatura-API)."""
    key_src = (viewer_url or "").strip()
    if not key_src:
        link = await get_document_viewer_link(
            settings,
            ettn,
            e_type=e_type,
            invoice_number=invoice_number,
            direction=direction,
        )
        key_src = link.get("url") or ""
    key = extract_viewer_key(key_src)
    if not key:
        raise HTTPException(status_code=404, detail="İşNet PDF anahtarı (key) bulunamadı.")
    url = f"{api_base(settings)}/api/Invoice/GetInvoicePdf?key={key}"
    try:
        async with httpx.AsyncClient(timeout=90.0, follow_redirects=True) as client:
            r = await client.get(
                url,
                headers={
                    "Accept": "application/pdf, application/octet-stream, */*",
                    "User-Agent": "TamKobi-Isnet-Client",
                },
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"İşNet PDF indirilemedi: {e}") from e
    if r.status_code >= 400 or not r.content:
        raise HTTPException(
            status_code=502,
            detail=f"İşNet PDF HTTP {r.status_code}: {(r.text or '')[:200]}",
        )
    ctype = (r.headers.get("content-type") or "").lower()
    if "pdf" not in ctype and not r.content.startswith(b"%PDF"):
        raise HTTPException(
            status_code=502,
            detail="İşNet PDF yanıtı geçersiz (PDF değil). Fatura NetteFatura'da henüz hazır olmayabilir.",
        )
    return bytes(r.content)


async def download_invoice_xml(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
    viewer_url: str = "",
    direction: str = "Outgoing",
) -> bytes:
    """İşNet DocumentViewer/DownloadXml — resmi UBL-TR (NetteFatura-API)."""
    key_src = (viewer_url or "").strip()
    if not key_src:
        link = await get_document_viewer_link(
            settings,
            ettn,
            e_type=e_type,
            invoice_number=invoice_number,
            direction=direction,
        )
        key_src = link.get("url") or ""
    key = extract_viewer_key(key_src)
    if not key:
        raise HTTPException(status_code=404, detail="İşNet XML anahtarı (key) bulunamadı.")
    from urllib.parse import quote

    url = f"{portal_url(settings).rstrip('/')}/DocumentViewer/DownloadXml?key={quote(key, safe='')}"
    try:
        async with httpx.AsyncClient(timeout=90.0, follow_redirects=True) as client:
            r = await client.get(
                url,
                headers={
                    "Accept": "text/xml, application/xml, application/octet-stream, */*",
                    "User-Agent": "TamKobi-Isnet-Client",
                },
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"İşNet XML indirilemedi: {e}") from e
    if r.status_code >= 400 or not r.content:
        raise HTTPException(
            status_code=502,
            detail=f"İşNet XML HTTP {r.status_code}: {(r.text or '')[:200]}",
        )
    text = r.content
    # Bazen zip/html döner
    head = text[:200].lstrip()
    if head.startswith(b"<") or b"Invoice" in head[:500]:
        return bytes(text)
    raise HTTPException(
        status_code=502,
        detail="İşNet XML yanıtı UBL değil. Fatura NetteFatura'da henüz hazır olmayabilir.",
    )


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
