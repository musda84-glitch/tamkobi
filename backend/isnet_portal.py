"""İşNet NetteFatura Web Portal istemcisi (gayriresmî).

Kaynak: https://github.com/EfeSorogluu/NetteFatura-Portal
VKN/TCKN + portal şifresi. SOAP/IP–VKN için `isnet.py` (NetteFatura-API) kullanılır.

Gelen kutu: portal şifresi ile Mobile REST API
(einvoiceapi.isnet.net.tr → Account/Login + GetIncomingEInvoiceList + GetInvoiceExternalXmlUrl).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

LIVE_PORTAL = "https://nettefatura.isnet.net.tr"
TEST_PORTAL = "https://efatura.isnet.net.tr"
LIVE_MOBILE_API = "https://einvoiceapi.isnet.net.tr"
TEST_MOBILE_API = "https://einvoiceapitest.isnet.net.tr"
INVOICE_DIR_INCOMING = 1  # IncomingInvoice
DOC_TYPE_EINVOICE = 1  # EInvoice
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def is_test_mode(settings: dict) -> bool:
    mode = (settings.get("mode") or "test").strip().lower()
    return mode in ("test", "sandbox", "demo")


def portal_base(settings: dict) -> str:
    custom = (settings.get("api_url") or settings.get("portal_url") or "").strip().rstrip("/")
    if custom:
        return custom
    return TEST_PORTAL if is_test_mode(settings) else LIVE_PORTAL


def mobile_api_base(settings: dict) -> str:
    custom = (settings.get("mobile_api_url") or "").strip().rstrip("/")
    if custom:
        return custom
    return TEST_MOBILE_API if is_test_mode(settings) else LIVE_MOBILE_API


def _digits(val: Any) -> str:
    return re.sub(r"\D", "", str(val or ""))


def _vkn(settings: dict, company: Optional[dict] = None) -> str:
    for src in (settings or {}, company or {}):
        for key in ("username", "company_tax_id", "vkn", "tax_number", "tax_id"):
            val = _digits(src.get(key))
            if len(val) in (10, 11):
                return val
    return _digits((settings or {}).get("username"))


def _token_from_html(html: str) -> str:
    m = re.search(
        r'name=["\']__RequestVerificationToken["\'][^>]*value=["\']([^"\']+)["\']',
        html or "",
        re.I,
    )
    if not m:
        m = re.search(
            r'value=["\']([^"\']+)["\'][^>]*name=["\']__RequestVerificationToken["\']',
            html or "",
            re.I,
        )
    if not m:
        raise HTTPException(status_code=502, detail="İşNet portal CSRF token alınamadı.")
    return m.group(1)


class IsnetPortalClient:
    """Cookie tabanlı web portal oturumu (bağlantı testi / TÜRMOB)."""

    def __init__(self, settings: dict, password: str):
        self.settings = settings or {}
        self.password = password or ""
        self.base = portal_base(self.settings)
        self.company_id = str(
            self.settings.get("corporate_code")
            or self.settings.get("company_id")
            or self.settings.get("portal_company_id")
            or ""
        ).strip()
        self._client = httpx.AsyncClient(
            base_url=self.base,
            timeout=45.0,
            follow_redirects=True,
            headers={"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "IsnetPortalClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self.aclose()

    async def _get_token(self, path: str = "/account/login") -> str:
        r = await self._client.get(
            path,
            headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
        )
        return _token_from_html(r.text)

    async def login(self) -> Dict[str, Any]:
        vkn = _vkn(self.settings)
        if not vkn or not self.password:
            raise HTTPException(status_code=400, detail="Portal girişi için VKN/TCKN ve şifre zorunludur.")
        token = await self._get_token("/account/login")
        r = await self._client.post(
            "/Account/Login",
            data={
                "VknTckn": vkn,
                "Password": self.password,
                "RememberMe": "true",
                "__RequestVerificationToken": token,
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": urljoin(self.base + "/", "account/login"),
                "Origin": self.base,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        cookie_names = set(self._client.cookies.keys())
        authed = any("AUTH" in n.upper() for n in cookie_names)
        body = r.text or ""
        if (not authed) and "__RequestVerificationToken" in body and "VknTckn" in body:
            err = ""
            m = re.search(
                r'class=["\'][^"\']*(?:validation-summary-errors|field-validation-error|alert-danger)[^"\']*["\'][^>]*>(.*?)</',
                body,
                re.I | re.S,
            )
            if m:
                err = re.sub(r"<[^>]+>", " ", m.group(1)).strip()
            raise HTTPException(
                status_code=400,
                detail=f"İşNet portal girişi başarısız. {err or 'VKN/TCKN veya şifre hatalı olabilir.'}",
            )
        companies = await self.list_companies()
        if companies and not self.company_id:
            selected = next((c for c in companies if c.get("selected")), companies[0])
            self.company_id = str(selected.get("id") or "")
        return {"ok": True, "vkn": vkn, "companies": companies, "company_id": self.company_id}

    async def list_companies(self) -> List[Dict[str, Any]]:
        r = await self._client.get("/", headers={"Accept": "text/html"})
        html = r.text or ""
        chunk = html
        idx = html.lower().find("companyid")
        if idx >= 0:
            chunk = html[idx : idx + 5000]
        out: List[Dict[str, Any]] = []
        for m in re.finditer(
            r'<option[^>]*value=["\']([^"\']+)["\']([^>]*)>(.*?)</option>',
            chunk,
            re.I | re.S,
        ):
            val, attrs, label = m.group(1), m.group(2), re.sub(r"<[^>]+>", "", m.group(3)).strip()
            if not val or not re.match(r"^[\w\-]{1,64}$", val):
                continue
            out.append({"id": val, "name": label, "selected": "selected" in (attrs or "").lower()})
        return out

    async def get_kontor(self) -> Dict[str, Any]:
        r = await self._client.get("/", headers={"Accept": "text/html"})
        html = r.text or ""
        m = re.search(
            r'id=["\']kontorInfo["\'][^>]*>(.*?)</(?:div|span|td|p)>',
            html,
            re.I | re.S,
        )
        raw = re.sub(r"<[^>]+>", " ", m.group(1)).strip() if m else ""
        u = re.search(r"<u[^>]*>(\d+)</u>", html, re.I)
        remaining = int(u.group(1)) if u else 0
        if not remaining and raw:
            nums = re.findall(r"\d+", raw)
            if nums:
                remaining = int(nums[0])
        return {"remaining_credits": remaining, "raw_text": raw or f"Kalan Kontör : {remaining}"}

    async def lookup_turmob(self, tax_id: str) -> Dict[str, Any]:
        tid = _digits(tax_id)
        if len(tid) not in (10, 11):
            raise HTTPException(status_code=400, detail="Geçerli VKN/TCKN girin.")
        r = await self._client.get(
            "/Recipient/GetUserInfoFromTurmobService",
            params={"vknTckn": tid},
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": urljoin(self.base + "/", "Invoice/CreateQuick"),
            },
        )
        try:
            data = r.json()
        except Exception:
            data = {"raw": (r.text or "")[:500]}
        return data if isinstance(data, dict) else {"data": data}


def _auth_header_sets(token: str) -> List[Dict[str, str]]:
    t = (token or "").strip()
    return [
        {"Token": t, "Accept": "application/json"},
        {"Authorization": f"Bearer {t}", "Accept": "application/json"},
        {"Authorization": t, "Accept": "application/json"},
        {"X-Token": t, "Accept": "application/json"},
    ]


async def _mobile_login(settings: dict, password: str) -> Dict[str, Any]:
    vkn = _vkn(settings)
    if not vkn or not password:
        raise HTTPException(status_code=400, detail="Portal gelen kutu için VKN/TCKN ve şifre zorunludur.")
    url = f"{mobile_api_base(settings)}/api/Account/Login"
    payloads = [
        {"IdentificationNumber": vkn, "Password": password},
        {"IdentificationNo": vkn, "Password": password},
        {"UserName": vkn, "Password": password},
        {"Username": vkn, "Password": password},
    ]
    last = "İşNet Mobile API girişi başarısız."
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers={"User-Agent": UA}) as client:
        for body in payloads:
            try:
                r = await client.post(url, json=body)
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"İşNet Mobile API'ye ulaşılamadı: {e}") from e
            if r.status_code >= 400:
                last = f"Login HTTP {r.status_code}: {(r.text or '')[:160]}"
                continue
            try:
                data = r.json() if r.content else {}
            except Exception:
                data = {}
            if not isinstance(data, dict):
                data = {}
            token = str(data.get("Token") or "").strip()
            err = str(data.get("ErrorMessage") or "").strip()
            result = data.get("Result")
            ok = bool(token) or result in (0, "0", "Success", "success", True, "True")
            if err and not ok:
                last = err
                continue
            if not token:
                last = err or "Mobile Login yanıtında Token yok."
                continue
            companies = data.get("CompanyList") or []
            if not isinstance(companies, list):
                companies = []
            return {
                "token": token,
                "companies": [
                    {
                        "id": c.get("IdFirma") or c.get("CompanyId") or c.get("Id"),
                        "name": c.get("FirmaAdi") or c.get("CompanyName") or "",
                        "schema": c.get("SchemaName") or "",
                    }
                    for c in companies
                    if isinstance(c, dict)
                ],
                "vkn": vkn,
            }
    raise HTTPException(status_code=400, detail=last)


def _pick_company_id(settings: dict, companies: List[dict]) -> Optional[str]:
    preferred = str(
        settings.get("corporate_code")
        or settings.get("company_id")
        or settings.get("portal_company_id")
        or ""
    ).strip()
    if preferred:
        return preferred
    if companies:
        return str(companies[0].get("id") or "").strip() or None
    return None


async def _mobile_post_json(
    client: httpx.AsyncClient,
    url: str,
    token: str,
    body: dict,
) -> Tuple[int, Any]:
    last_status, last_data = 0, None
    for headers in _auth_header_sets(token):
        r = await client.post(url, json=body, headers=headers)
        last_status = r.status_code
        try:
            last_data = r.json() if r.content else {}
        except Exception:
            last_data = {"raw": (r.text or "")[:300]}
        if r.status_code in (401, 403):
            continue
        if r.status_code < 400:
            return r.status_code, last_data
        if isinstance(last_data, dict) and (
            last_data.get("Invoices") is not None or last_data.get("ExternalLink") or last_data.get("ExternalUrl") is not None
        ):
            return r.status_code, last_data
    return last_status, last_data


async def _download_xml_bytes(client: httpx.AsyncClient, url: str, token: str) -> Optional[bytes]:
    if not url:
        return None
    header_sets = _auth_header_sets(token) + [{"Accept": "application/xml,text/xml,*/*", "User-Agent": UA}]
    for headers in header_sets:
        try:
            r = await client.get(url, headers=headers, follow_redirects=True)
        except httpx.RequestError:
            continue
        if r.status_code >= 400 or not r.content:
            continue
        raw = r.content
        text = raw[:200].decode("utf-8", errors="ignore").lstrip()
        if text.startswith("<") or b"Invoice" in raw[:800]:
            return raw
        try:
            data = r.json()
        except Exception:
            continue
        if isinstance(data, dict):
            for key in ("Xml", "XML", "InvoiceXml", "Content", "Data", "ExternalLink"):
                val = data.get(key)
                if isinstance(val, str) and val.strip().startswith("<"):
                    return val.encode("utf-8")
                if isinstance(val, str) and key == "ExternalLink" and val.startswith("http"):
                    nested = await _download_xml_bytes(client, val, token)
                    if nested:
                        return nested
    return None


async def _fetch_invoice_xml(
    client: httpx.AsyncClient,
    api: str,
    token: str,
    ettn: str,
    company_id: Optional[str],
) -> Tuple[Optional[bytes], str]:
    if not ettn:
        return None, "ETTN yok."
    # Help: POST api/Invoice/GetInvoiceExternalXmlUrl (Ettn + direction)
    status, data = await _mobile_post_json(
        client,
        f"{api}/api/Invoice/GetInvoiceExternalXmlUrl",
        token,
        {
            "Ettn": ettn,
            "InvoiceDirection": INVOICE_DIR_INCOMING,
            "InvoiceDocumentType": DOC_TYPE_EINVOICE,
        },
    )
    link = ""
    err = f"HTTP {status}"
    if isinstance(data, dict):
        link = str(data.get("ExternalLink") or data.get("Url") or data.get("Link") or "").strip()
        err = str(data.get("ErrorMessage") or "").strip() or err
    if link:
        xml = await _download_xml_bytes(client, link, token)
        if xml:
            return xml, ""
        err = err or "Harici XML bağlantısı indirilemedi."
    for path, params in (
        (f"{api}/api/Invoice/GetInvoiceXml", {"Ettn": ettn, "CompanyId": company_id}),
        (f"{api}/api/Invoice/GetInvoiceXml", {"ettn": ettn}),
    ):
        for headers in _auth_header_sets(token):
            try:
                r = await client.get(
                    path,
                    params={k: v for k, v in params.items() if v not in (None, "")},
                    headers=headers,
                )
            except httpx.RequestError:
                continue
            if r.status_code < 400 and r.content and (b"<" in r.content[:100] or b"Invoice" in r.content[:800]):
                return r.content, ""
    return None, err or "İşNet Portal XML döndürmedi."


async def test_connection(settings: dict, password: str) -> Dict[str, Any]:
    async with IsnetPortalClient(settings, password) as client:
        info = await client.login()
        kontor = await client.get_kontor()
        company_id = info.get("company_id") or client.company_id
    return {
        "ok": True,
        "provider": "isnet_portal",
        "mode": "test" if is_test_mode(settings) else "live",
        "portal": portal_base(settings),
        "vkn": info.get("vkn"),
        "company_id": company_id,
        "companies": info.get("companies") or [],
        "remaining_credits": kontor.get("remaining_credits"),
        "message": (
            "İşNet Web Portal girişi başarılı"
            + (
                f" · kalan kontör: {kontor.get('remaining_credits')}"
                if kontor.get("remaining_credits") is not None
                else ""
            )
            + ". Gelen faturalar için Muhasebe → Gelen e-Belgeler → «Entegratörden çek»."
        ),
        "hint": "Bağlantıyı kaydetmek yetmez; Gelen e-Belgeler ekranından senkronize edin.",
    }


async def lookup_user(settings: dict, password: str, tax_id: str) -> Dict[str, Any]:
    async with IsnetPortalClient(settings, password) as client:
        await client.login()
        data = await client.lookup_turmob(tax_id)
        name = (
            data.get("KimlikUnvani")
            or " ".join(x for x in (data.get("Ad"), data.get("Soyad")) if x).strip()
            or data.get("Unvan")
            or ""
        )
        aliases = data.get("EtiketListesi") or data.get("aliases") or []
        alias = None
        if isinstance(aliases, list) and aliases:
            first = aliases[0]
            alias = first.get("Etiket") if isinstance(first, dict) else str(first)
        return {
            "tax_id": _digits(tax_id),
            "name": name,
            "tax_office": data.get("VergiDairesiAdi") or "",
            "is_e_invoice_user": bool(alias or data.get("EFaturaMukellefi")),
            "alias": alias,
            "source": "isnet_portal",
            "raw": data,
        }


async def list_incoming(settings: dict, password: str, days: int = 14) -> List[Dict[str, Any]]:
    """Gelen e-faturaları Mobile REST ile listeler ve UBL XML indirir."""
    session = await _mobile_login(settings, password)
    company_id = _pick_company_id(settings, session.get("companies") or [])
    if not company_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "İşNet Portal firma ID bulunamadı. Ayarlarda «Portal firma ID» girin "
                "veya hesabın en az bir firması olduğundan emin olun."
            ),
        )
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=max(1, min(int(days or 14), 90)))
    first = start.strftime("%d.%m.%Y")
    last = end.strftime("%d.%m.%Y")
    api = mobile_api_base(settings)
    token = session["token"]
    cid: Any = float(company_id) if str(company_id).replace(".", "", 1).isdigit() else company_id
    bodies = [
        {
            "CompanyId": cid,
            "InvoiceNumber": "",
            "FirstInvoiceDate": first,
            "LastInvoiceDate": last,
            "AliciAdi": "",
            "AliciVkn": "",
            "ScenarioId": None,
            "InvoiceTypeId": None,
            "PageIndex": 0,
            "PageSize": 100,
            "IsArchiveIncluded": True,
        },
        {
            "CompanyId": cid,
            "FirstInvoiceDate": first,
            "LastInvoiceDate": last,
            "PageIndex": 1,
            "PageSize": 100,
            "IsArchiveIncluded": True,
        },
    ]
    out: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True, headers={"User-Agent": UA}) as client:
        data: Any = None
        status = 0
        last_err = ""
        for body in bodies:
            # Help: POST api/Invoice/GetIncomingEInvoiceList
            status, data = await _mobile_post_json(
                client, f"{api}/api/Invoice/GetIncomingEInvoiceList", token, body
            )
            if isinstance(data, dict):
                last_err = str(data.get("ErrorMessage") or "").strip()
                if data.get("Invoices") is not None:
                    break
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail=f"Gelen kutu yanıtı okunamadı (HTTP {status}).")
        invoices = data.get("Invoices")
        if invoices is None and last_err:
            raise HTTPException(status_code=400, detail=f"İşNet gelen kutu: {last_err}")
        if not isinstance(invoices, list):
            invoices = []
        logger.info(
            "isnet_portal list_incoming: company=%s days=%s count=%s http=%s",
            company_id,
            days,
            len(invoices),
            status,
        )
        for inv in invoices:
            if not isinstance(inv, dict):
                continue
            ettn = str(inv.get("Ettn") or inv.get("ETTN") or inv.get("Uuid") or "").strip()
            inv_no = str(inv.get("InvoiceNumber") or inv.get("InvoiceId") or "").strip()
            xml_bytes, xml_err = await _fetch_invoice_xml(client, api, token, ettn, company_id)
            out.append(
                {
                    "uuid": ettn or None,
                    "invoice_id": inv_no or ettn or None,
                    "sender_title": inv.get("RecipientCompanyName") or inv.get("SenderCompanyName") or "",
                    "issue_date": inv.get("InvoiceDate") or "",
                    "payable_amount": inv.get("InvoiceTotalLineAmount"),
                    "currency": inv.get("CurrencyCode") or "TRY",
                    "status": inv.get("Status") or "",
                    "xml": xml_bytes,
                    "xml_error": "" if xml_bytes else (xml_err or "XML yok"),
                }
            )
    return out


async def send_document(
    settings: dict,
    password: str,
    invoice: dict,
    contact: Optional[dict] = None,
    company: Optional[dict] = None,
) -> Dict[str, Any]:
    contact = contact or {}
    async with IsnetPortalClient(settings, password) as client:
        await client.login()
        kontor = await client.get_kontor()
        buyer_tax = _digits(
            contact.get("tax_number") or contact.get("tax_id") or invoice.get("buyer_tax_id")
        )
        if buyer_tax:
            try:
                await client.lookup_turmob(buyer_tax)
            except Exception:
                logger.exception("portal turmob lookup failed for %s", buyer_tax)
        raise HTTPException(
            status_code=501,
            detail=(
                "İşNet Web Portal bağlantısı doğrulandı"
                f" (kontör: {kontor.get('remaining_credits', '?')}). "
                "Portal üzerinden otomatik fatura kesimi için alıcının NetteFatura'da kayıtlı olması gerekir. "
                "Statik IP / SOAP sözleşmeniz varsa «İşNet Net-e Fatura — SOAP API» seçeneğini kullanın."
            ),
        )
