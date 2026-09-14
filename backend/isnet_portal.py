"""İşNet NetteFatura Web Portal istemcisi (gayriresmî).

Kaynak: https://github.com/EfeSorogluu/NetteFatura-Portal
VKN/TCKN + portal şifresi. SOAP/IP–VKN için `isnet.py` (NetteFatura-API) kullanılır.

Gelen kutu: portal şifresi ile Mobile REST API
(einvoiceapi.isnet.net.tr → Account/Login + GetIncomingEInvoiceList + GetInvoiceExternalXmlUrl).
"""
from __future__ import annotations

import base64
import io
import logging
import re
import zipfile
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

UBL_ROOTS = ("Invoice", "DespatchAdvice")
_ROOT_RE = re.compile(rb"<\s*(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)[\s/>]")
MAX_ZIP_ENTRIES = 32
MAX_ZIP_MEMBER_BYTES = 4 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 16 * 1024 * 1024


def _ubl_root_name(data: bytes) -> str:
    """Belgenin kök etiket yerel adını döner (XML bildirimi / DOCTYPE atlanır)."""
    if not data:
        return ""
    head = re.sub(
        rb"<\?.*?\?>|<!--.*?-->|<!\[CDATA\[.*?\]\]>|<!DOCTYPE[^>]*>",
        b" ",
        data[:4096],
        flags=re.S,
    )
    m = _ROOT_RE.search(head)
    return m.group(2).decode("ascii", "ignore") if m else ""


def _zip_xml_members(z: zipfile.ZipFile):
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


def _as_ubl(data: Optional[bytes]) -> Optional[bytes]:
    """Ham baytları UBL-TR Invoice/DespatchAdvice XML'e indirger; HTML/SOAP reddedilir."""
    if not data:
        return None
    if data[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                data = next((d for d in _zip_xml_members(z) if _ubl_root_name(d) in UBL_ROOTS), None)
                if data is None:
                    return None
        except (zipfile.BadZipFile, KeyError, RuntimeError, ValueError):
            return None
    data = data.lstrip(b"\xef\xbb\xbf").lstrip()
    head = data[:200].decode("utf-8", errors="ignore").lstrip().lower()
    if head.startswith("<!doctype html") or head.startswith("<html"):
        return None
    root = _ubl_root_name(data)
    return data if root in UBL_ROOTS else None


def _decode_possible_ubl(payload: Any) -> Optional[bytes]:
    """Düz UBL, base64 UBL veya base64 ZIP olabilir."""
    if payload is None:
        return None
    if isinstance(payload, (bytes, bytearray)):
        return _as_ubl(bytes(payload))
    if not isinstance(payload, str):
        return None
    raw_text = payload.strip()
    if not raw_text:
        return None
    if raw_text.startswith("<"):
        return _as_ubl(raw_text.encode("utf-8"))
    try:
        raw = base64.b64decode("".join(raw_text.split()), validate=False)
    except Exception:
        return None
    return _as_ubl(raw)


def _portal_xml_candidates(ettn: str, xml_url: str, page_html: str) -> List[str]:
    """Portal HTML/AJAX yanıtından XML indirme aday URL'lerini üretir."""
    candidates: List[str] = []
    if xml_url:
        candidates.append(xml_url)
    if ettn:
        for path in (
            f"/Inbox/DownloadXml?ettn={ettn}",
            f"/Inbox/DownloadXml?Ettn={ettn}",
            f"/Inbox/DownloadXml?uuid={ettn}",
            f"/Inbox/GetXml?ettn={ettn}",
            f"/Inbox/GetXml?uuid={ettn}",
            f"/Inbox/DownloadUbl?ettn={ettn}",
            f"/Inbox/Download?ettn={ettn}",
            f"/Inbox/GetDocumentXml?ettn={ettn}",
            f"/IncomingInvoice/DownloadXml?ettn={ettn}",
            f"/IncomingInvoice/DownloadXml?uuid={ettn}",
            f"/IncomingInvoice/GetXml?uuid={ettn}",
            f"/IncomingInvoice/GetXml?ettn={ettn}",
            f"/IncomingEInvoice/DownloadXml?ettn={ettn}",
            f"/Invoice/DownloadIncomingXml?ettn={ettn}",
            f"/Invoice/GetIncomingXml?ettn={ettn}",
            f"/Invoice/DownloadXml?ettn={ettn}",
            f"/Invoice/GetXml?ettn={ettn}",
            f"/Document/DownloadXml?ettn={ettn}",
            f"/Document/GetXml?ettn={ettn}",
            f"/EInvoice/DownloadXml?ettn={ettn}",
            f"/GelenKutu/DownloadXml?ettn={ettn}",
        ):
            candidates.append(path)
    html = page_html or ""
    for href in re.findall(
        r'(?:href|data-url|data-href|data-xml-url)\s*=\s*["\']([^"\']+)["\']',
        html,
        re.I,
    ):
        if ettn and ettn.lower() in href.lower():
            candidates.append(href)
    for m in re.finditer(
        r"(?:downloadxml|getxml|downloadubl|getubl)\s*\(\s*['\"]([^'\"]+)['\"]",
        html,
        re.I,
    ):
        val = m.group(1).strip()
        if val.startswith("/") or val.startswith("http"):
            candidates.append(val)
        elif ettn and val.lower() == ettn.lower():
            candidates.append(f"/Inbox/DownloadXml?ettn={ettn}")
    seen: set = set()
    out: List[str] = []
    for c in candidates:
        c = (c or "").strip()
        if not c or c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out


async def _try_download_portal_xml(
    client: httpx.AsyncClient,
    candidates: List[str],
    *,
    csrf: str = "",
    referer: str = "",
) -> Tuple[Optional[bytes], str]:
    """Aday URL'lerden ilk geçerli UBL'yi döner; HTML yanıtları reddeder."""
    last_hint = "Portal HTML üzerinden XML indirilemedi."
    headers_get = {"Accept": "application/xml,text/xml,application/zip,*/*"}
    if referer:
        headers_get["Referer"] = referer
    for cand in candidates:
        try:
            r = await client.get(cand, headers=headers_get)
        except httpx.RequestError:
            r = None
        if r is not None and r.status_code < 400 and r.content:
            ubl = _as_ubl(r.content)
            if ubl:
                return ubl, ""
            data = None
            try:
                data = r.json()
            except Exception:
                pass
            if isinstance(data, dict):
                for key in (
                    "Xml",
                    "XML",
                    "InvoiceXml",
                    "Ubl",
                    "UBL",
                    "Content",
                    "Data",
                    "XmlContent",
                    "FileContent",
                    "ExternalLink",
                    "Url",
                ):
                    val = data.get(key)
                    ubl = _decode_possible_ubl(val)
                    if ubl:
                        return ubl, ""
                    if isinstance(val, str) and key in ("ExternalLink", "Url") and val.startswith("http"):
                        try:
                            nested = await client.get(val, headers=headers_get)
                        except httpx.RequestError:
                            nested = None
                        if nested is not None and nested.status_code < 400:
                            ubl = _as_ubl(nested.content)
                            if ubl:
                                return ubl, ""
            head = r.content[:120].decode("utf-8", errors="ignore").lstrip().lower()
            if head.startswith("<!doctype html") or head.startswith("<html"):
                last_hint = "Portal XML yerine HTML sayfası döndü (oturum veya indirme adresi hatalı)."
            elif r.content[:4] == b"%PDF":
                last_hint = "Portal PDF döndü; UBL XML indirme adresi bulunamadı."
            else:
                last_hint = "Portal yanıtı UBL-TR e-Fatura/e-İrsaliye değil."

        form: Dict[str, str] = {}
        if csrf:
            form["__RequestVerificationToken"] = csrf
        m = re.search(r"(?:ettn|uuid|ETTN|UUID)=([0-9a-fA-F-]{36})", cand)
        if m:
            ettn = m.group(1)
            form.update({"ettn": ettn, "Ettn": ettn, "uuid": ettn, "UUID": ettn})
        post_url = cand.split("?", 1)[0] if ("?" in cand and form) else cand
        try:
            r = await client.post(
                post_url,
                data=form or None,
                headers={**headers_get, "X-Requested-With": "XMLHttpRequest"},
            )
        except httpx.RequestError:
            continue
        if r.status_code >= 400 or not r.content:
            continue
        ubl = _as_ubl(r.content)
        if ubl:
            return ubl, ""
        try:
            data = r.json()
        except Exception:
            data = None
        if isinstance(data, dict):
            for key in (
                "Xml",
                "XML",
                "InvoiceXml",
                "Ubl",
                "UBL",
                "Content",
                "Data",
                "XmlContent",
                "FileContent",
            ):
                ubl = _decode_possible_ubl(data.get(key))
                if ubl:
                    return ubl, ""
    return None, last_hint




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
                # NetteFatura-Portal: RememberMe=on
                "RememberMe": "on",
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
        # .ASPXFORMSAUTH / .AspNet.ApplicationCookie vb.
        authed = any(
            ("AUTH" in n.upper()) or n.upper().endswith("FORMSAUTH") or "APPLICATIONCOOKIE" in n.upper()
            for n in cookie_names
        )
        body = r.text or ""
        if r.status_code in (401, 403) or ((not authed) and "__RequestVerificationToken" in body and "VknTckn" in body):
            err = ""
            m = re.search(
                r'class=["\'][^"\']*(?:validation-summary-errors|field-validation-error|alert-danger)[^"\']*["\'][^>]*>(.*?)</',
                body,
                re.I | re.S,
            )
            if m:
                err = re.sub(r"<[^>]+>", " ", m.group(1)).strip()
            mode_hint = (
                " Test ortamı seçili — gerçek NetteFatura hesabınız varsa «Canlı Ortam»ı deneyin."
                if is_test_mode(self.settings)
                else " Canlı ortam seçili — İşNet test hesabı kullanıyorsanız «Test Ortamı»nı seçin."
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"İşNet portal girişi başarısız (HTTP {r.status_code}). "
                    f"{err or 'VKN/TCKN veya portal şifresi hatalı olabilir.'}"
                    f"{mode_hint}"
                ),
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


    async def list_inbox(self, days: int = 14) -> List[Dict[str, Any]]:
        """Gelen kutuyu HTML portal oturumuyla çeker (Mobile API 401 yedek yolu)."""
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=max(1, min(int(days or 14), 90)))
        first = start.strftime("%d.%m.%Y")
        last = end.strftime("%d.%m.%Y")

        page_html = ""
        for path in ("/Inbox", "/Inbox/Index", "/IncomingInvoice", "/IncomingInvoice/Index"):
            try:
                r = await self._client.get(path, headers={"Accept": "text/html"})
            except httpx.RequestError:
                continue
            text = r.text or ""
            if r.status_code >= 400:
                continue
            if "VknTckn" in text and "__RequestVerificationToken" in text and "login" in str(r.url).lower():
                continue
            page_html = text
            if len(text) > 500:
                break
        if not page_html:
            try:
                home = await self._client.get("/", headers={"Accept": "text/html"})
                page_html = home.text or ""
            except httpx.RequestError:
                page_html = ""

        ajax_urls: List[str] = []
        for m in re.finditer(r"(?:ajax\s*:\s*\{|url\s*:)\s*['\"]([^'\"]+)['\"]", page_html, re.I):
            u = m.group(1).strip()
            if u.startswith("/") and any(k in u.lower() for k in ("inbox", "incoming", "gelen")):
                ajax_urls.append(u)
        for m in re.finditer(r"['\"](/(?:Inbox|IncomingInvoice|Incoming)[^'\"]+)['\"]", page_html, re.I):
            ajax_urls.append(m.group(1))
        for cand in (
            "/Inbox/GetList",
            "/Inbox/List",
            "/Inbox/GetIncomingList",
            "/Inbox/GetIncomingInvoices",
            "/Inbox/DataHandler",
            "/IncomingInvoice/GetList",
            "/IncomingInvoice/List",
            "/IncomingInvoice/GetIncomingList",
            "/IncomingEInvoice/GetList",
        ):
            ajax_urls.append(cand)
        seen: set = set()
        urls: List[str] = []
        for u in ajax_urls:
            if u not in seen:
                seen.add(u)
                urls.append(u)

        token = ""
        try:
            if page_html:
                token = _token_from_html(page_html)
        except HTTPException:
            token = ""

        rows: List[Dict[str, Any]] = []
        for url in urls:
            payloads = [
                {
                    "draw": 1,
                    "start": 0,
                    "length": 100,
                    "FirstInvoiceDate": first,
                    "LastInvoiceDate": last,
                    "StartDate": first,
                    "EndDate": last,
                    "BaslangicTarihi": first,
                    "BitisTarihi": last,
                },
                {
                    "draw": "1",
                    "start": "0",
                    "length": "100",
                    "search[value]": "",
                    "FirstInvoiceDate": first,
                    "LastInvoiceDate": last,
                },
            ]
            for body in payloads:
                data = dict(body)
                if token:
                    data["__RequestVerificationToken"] = token
                if self.company_id:
                    data["CompanyId"] = self.company_id
                    data["companyId"] = self.company_id
                try:
                    r = await self._client.post(
                        url,
                        data=data,
                        headers={
                            "Accept": "application/json, text/javascript, */*; q=0.01",
                            "X-Requested-With": "XMLHttpRequest",
                            "Referer": urljoin(self.base + "/", "Inbox"),
                        },
                    )
                except httpx.RequestError:
                    continue
                if r.status_code >= 400:
                    continue
                try:
                    parsed = r.json()
                except Exception:
                    parsed = None
                items: List[Any] = []
                if isinstance(parsed, dict):
                    for key in ("data", "Data", "Invoices", "items", "Items", "aaData"):
                        val = parsed.get(key)
                        if isinstance(val, list):
                            items = val
                            break
                elif isinstance(parsed, list):
                    items = parsed
                if not items:
                    continue
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    ettn = str(
                        it.get("Ettn")
                        or it.get("ETTN")
                        or it.get("Uuid")
                        or it.get("UUID")
                        or it.get("EttnNo")
                        or ""
                    ).strip()
                    inv_no = str(
                        it.get("InvoiceNumber")
                        or it.get("FaturaNo")
                        or it.get("InvoiceId")
                        or it.get("DocumentNumber")
                        or ""
                    ).strip()
                    xml_url = str(
                        it.get("XmlUrl")
                        or it.get("DownloadUrl")
                        or it.get("ExternalLink")
                        or it.get("XmlDownloadUrl")
                        or ""
                    ).strip()
                    rows.append(
                        {
                            "uuid": ettn or None,
                            "invoice_id": inv_no or ettn or None,
                            "sender_title": it.get("SenderTitle")
                            or it.get("GonderenUnvan")
                            or it.get("RecipientCompanyName")
                            or it.get("SenderCompanyName")
                            or "",
                            "issue_date": it.get("InvoiceDate") or it.get("FaturaTarihi") or it.get("IssueDate") or "",
                            "payable_amount": it.get("PayableAmount")
                            or it.get("InvoiceTotalLineAmount")
                            or it.get("OdenecekTutar"),
                            "currency": it.get("CurrencyCode") or it.get("ParaBirimi") or "TRY",
                            "status": it.get("Status") or it.get("Durum") or "",
                            "xml_url": xml_url,
                            "xml": it.get("Xml")
                            or it.get("XML")
                            or it.get("Ubl")
                            or it.get("XmlContent")
                            or it.get("FileContent")
                            or "",
                        }
                    )
                if rows:
                    break
            if rows:
                break

        if not rows and page_html:
            found = []
            for m in re.finditer(
                r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                page_html,
            ):
                ettn = m.group(1)
                found.append(
                    {
                        "uuid": ettn,
                        "invoice_id": ettn,
                        "sender_title": "",
                        "issue_date": "",
                        "payable_amount": None,
                        "currency": "TRY",
                        "status": "",
                        "xml_url": "",
                    }
                )
            uniq = {r.get("uuid"): r for r in found}
            rows = list(uniq.values())

        csrf = ""
        try:
            if page_html:
                csrf = _token_from_html(page_html)
        except Exception:
            csrf = ""

        out: List[Dict[str, Any]] = []
        for row in rows:
            xml_bytes = None
            xml_err = ""
            xml_url = (row.get("xml_url") or "").strip()
            ettn = (row.get("uuid") or "").strip()
            for key in ("xml", "Xml", "XML", "Ubl", "UBL", "XmlContent", "FileContent"):
                if row.get(key):
                    xml_bytes = _decode_possible_ubl(row.get(key))
                    if xml_bytes:
                        break
            if not xml_bytes:
                candidates = _portal_xml_candidates(ettn, xml_url, page_html or "")
                xml_bytes, xml_err = await _try_download_portal_xml(
                    self._client,
                    candidates,
                    csrf=csrf,
                    referer=urljoin(self.base + "/", "Inbox"),
                )
            if not xml_bytes and not xml_err:
                xml_err = "Portal HTML üzerinden UBL XML indirilemedi."
            out.append(
                {
                    "uuid": row.get("uuid"),
                    "invoice_id": row.get("invoice_id"),
                    "sender_title": row.get("sender_title") or "",
                    "issue_date": row.get("issue_date") or "",
                    "payable_amount": row.get("payable_amount"),
                    "currency": row.get("currency") or "TRY",
                    "status": row.get("status") or "",
                    "xml": xml_bytes,
                    "xml_error": "" if xml_bytes else xml_err,
                    "source": "isnet_portal_html",
                }
            )
        logger.info(
            "isnet_portal list_inbox html: company=%s days=%s count=%s",
            self.company_id,
            days,
            len(out),
        )
        return out




def _auth_header_sets(token: str) -> List[Dict[str, str]]:
    t = (token or "").strip()
    return [
        {"Token": t, "Accept": "application/json"},
        {"Authorization": f"Bearer {t}", "Accept": "application/json"},
        {"Authorization": t, "Accept": "application/json"},
        {"X-Token": t, "Accept": "application/json"},
    ]


def _mobile_login_payloads(vkn: str, password: str, corporate_code: str = "") -> List[dict]:
    """Mobile Login gövdeleri — Help sayfası IdentificationNumber; bazı tenant'larda ek alanlar."""
    base = [
        {"IdentificationNumber": vkn, "Password": password},
        {"IdentificationNo": vkn, "Password": password},
        {"VknTckn": vkn, "Password": password},
        {"TaxNumber": vkn, "Password": password},
        {"UserName": vkn, "Password": password},
        {"Username": vkn, "Password": password},
    ]
    code = (corporate_code or "").strip()
    if code:
        extras = []
        for body in list(base):
            for key in ("CorporateCode", "CompanyCode", "CompanyId", "IdFirma"):
                extras.append({**body, key: code})
        base.extend(extras)
    return base


def _format_mobile_login_error(status: int, body_text: str, settings: dict) -> str:
    snippet = (body_text or "").strip().replace("\n", " ")[:160]
    env = "test (einvoiceapitest.isnet.net.tr)" if is_test_mode(settings) else "canlı (einvoiceapi.isnet.net.tr)"
    if status in (401, 403):
        tip = (
            "Gerçek NetteFatura portal şifrenizi kullanıyorsanız ortamı «Canlı» yapın; "
            "yalnızca İşNet test hesabı için «Test» seçin."
            if is_test_mode(settings)
            else (
                "VKN/TCKN ve portal şifresini nettefatura.isnet.net.tr ile aynı girin. "
                "Portal açılıp Mobile 401 ise gelen kutu Web Portal üzerinden çekilir; "
                "gerekirse Mobile kullanıcı TCKN deneyin."
            )
        )
        return f"Login HTTP {status} [{env}]: kimlik doğrulama reddedildi. {tip}" + (f" ({snippet})" if snippet else "")
    return f"Login HTTP {status} [{env}]: {snippet or 'İşNet Mobile API girişi başarısız.'}"


async def _mobile_login(settings: dict, password: str, *, _tried_alt_env: bool = False) -> Dict[str, Any]:
    vkn = _vkn(settings)
    if not vkn or not password:
        raise HTTPException(status_code=400, detail="Portal gelen kutu için VKN/TCKN ve şifre zorunludur.")
    corp = str(
        settings.get("corporate_code")
        or settings.get("company_id")
        or settings.get("portal_company_id")
        or ""
    ).strip()
    url = f"{mobile_api_base(settings)}/api/Account/Login"
    # Bazı hesaplarda portal VKN ile açılır; Mobile API kullanıcı TCKN ister.
    mobile_user = _digits(
        settings.get("mobile_username")
        or settings.get("user_tckn")
        or settings.get("mobile_tckn")
        or ""
    )
    id_candidates = []
    for cand in (mobile_user, vkn):
        if cand and cand not in id_candidates:
            id_candidates.append(cand)
    payloads: List[dict] = []
    for ident in id_candidates:
        payloads.extend(_mobile_login_payloads(ident, password, corp))
    last = "İşNet Mobile API girişi başarısız."
    saw_401 = False
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers={"User-Agent": UA}) as client:
        for body in payloads:
            try:
                r = await client.post(url, json=body)
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"İşNet Mobile API'ye ulaşılamadı: {e}") from e
            if r.status_code >= 400:
                if r.status_code in (401, 403):
                    saw_401 = True
                last = _format_mobile_login_error(r.status_code, r.text or "", settings)
                continue
            try:
                data = r.json() if r.content else {}
            except Exception:
                data = {}
            if not isinstance(data, dict):
                data = {}
            token = str(
                data.get("Token")
                or data.get("token")
                or data.get("AccessToken")
                or data.get("access_token")
                or ""
            ).strip()
            err = str(
                data.get("ErrorMessage")
                or data.get("errorMessage")
                or data.get("Message")
                or data.get("message")
                or ""
            ).strip()
            result = data.get("Result") if "Result" in data else data.get("result")
            ok = bool(token) or result in (0, "0", "Success", "success", True, "True")
            if err and not ok:
                last = err
                continue
            if not token:
                last = err or "Mobile Login yanıtında Token yok."
                continue
            companies = data.get("CompanyList") or data.get("companyList") or data.get("Companies") or []
            if not isinstance(companies, list):
                companies = []
            return {
                "token": token,
                "companies": [
                    {
                        "id": c.get("IdFirma") or c.get("CompanyId") or c.get("Id") or c.get("id"),
                        "name": c.get("FirmaAdi") or c.get("CompanyName") or c.get("name") or "",
                        "schema": c.get("SchemaName") or c.get("schema") or "",
                    }
                    for c in companies
                    if isinstance(c, dict)
                ],
                "vkn": vkn,
                "mode": "test" if is_test_mode(settings) else "live",
            }

    # Test↔canlı otomatik deneme: 401'de sıkça ortam uyuşmazlığı olur
    if saw_401 and not _tried_alt_env and not (settings.get("mobile_api_url") or "").strip():
        alt_mode = "live" if is_test_mode(settings) else "test"
        alt = {**settings, "mode": alt_mode}
        try:
            session = await _mobile_login(alt, password, _tried_alt_env=True)
            session["mode_switched"] = True
            session["suggested_mode"] = alt_mode
            return session
        except HTTPException:
            pass

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
    header_sets = _auth_header_sets(token) + [
        {"Accept": "application/xml,text/xml,application/zip,*/*", "User-Agent": UA}
    ]
    for headers in header_sets:
        try:
            r = await client.get(url, headers=headers, follow_redirects=True)
        except httpx.RequestError:
            continue
        if r.status_code >= 400 or not r.content:
            continue
        ubl = _as_ubl(r.content)
        if ubl:
            return ubl
        try:
            data = r.json()
        except Exception:
            continue
        if isinstance(data, dict):
            for key in (
                "Xml",
                "XML",
                "InvoiceXml",
                "Content",
                "Data",
                "ExternalLink",
                "Ubl",
                "UBL",
                "FileContent",
            ):
                val = data.get(key)
                ubl = _decode_possible_ubl(val)
                if ubl:
                    return ubl
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
            if r.status_code < 400 and r.content:
                ubl = _as_ubl(r.content)
                if not ubl:
                    try:
                        payload = r.json()
                    except Exception:
                        payload = None
                    if isinstance(payload, dict):
                        for key in (
                            "Xml",
                            "XML",
                            "InvoiceXml",
                            "Content",
                            "Data",
                            "Ubl",
                            "UBL",
                            "FileContent",
                        ):
                            ubl = _decode_possible_ubl(payload.get(key))
                            if ubl:
                                break
                if ubl:
                    return ubl, ""
    return None, err or "İşNet Portal UBL XML döndürmedi."


async def _portal_login_with_fallback(
    settings: dict, password: str
) -> Tuple[dict, dict, Dict[str, Any], Dict[str, Any]]:
    """HTML portal girişi; 401/yanlış ortamda test↔canlı otomatik dener.

    Returns: (effective_settings, info, kontor, meta)
    """
    custom = bool((settings.get("api_url") or settings.get("portal_url") or "").strip())
    last_err: Optional[HTTPException] = None
    modes = [settings]
    if not custom:
        alt_mode = "live" if is_test_mode(settings) else "test"
        modes.append({**settings, "mode": alt_mode})

    for idx, cfg in enumerate(modes):
        try:
            async with IsnetPortalClient(cfg, password) as client:
                info = await client.login()
                kontor = await client.get_kontor()
                info["company_id"] = info.get("company_id") or client.company_id
            meta = {
                "mode_switched": idx > 0,
                "suggested_mode": "test" if is_test_mode(cfg) else "live",
            }
            return cfg, info, kontor, meta
        except HTTPException as e:
            last_err = e
            if idx == 0 and e.status_code == 400:
                continue
            raise
    assert last_err is not None
    raise last_err


async def test_connection(settings: dict, password: str) -> Dict[str, Any]:
    """HTML portal + Mobile API birlikte doğrular (gelen kutu Mobile'a bağlı)."""
    used, info, kontor, portal_meta = await _portal_login_with_fallback(settings, password)
    company_id = info.get("company_id")
    mode = portal_meta.get("suggested_mode") or ("test" if is_test_mode(used) else "live")
    mode_switched = bool(portal_meta.get("mode_switched"))

    mobile_ok = False
    mobile_detail = ""
    try:
        session = await _mobile_login(used, password)
        mobile_ok = True
        if session.get("mode_switched") and session.get("suggested_mode"):
            mode = session["suggested_mode"]
            mode_switched = True
            used = {**used, "mode": mode}
        elif session.get("mode"):
            mode = session["mode"]
    except HTTPException as e:
        mobile_detail = str(e.detail or "")

    parts = ["İşNet Web Portal girişi başarılı"]
    if kontor.get("remaining_credits") is not None:
        parts[0] += f" · kalan kontör: {kontor.get('remaining_credits')}"
    if mode_switched:
        parts.append(
            f"Ortam otomatik «{'Test' if mode == 'test' else 'Canlı'}» olarak düzeltildi — kaydederken bunu seçin."
        )
    if mobile_ok:
        parts.append("Mobile API (gelen kutu) girişi de başarılı.")
        inbox_channel = "mobile"
    else:
        parts.append(
            "Portal HTML girişi OK; Mobile API reddetti"
            + (f": {mobile_detail}" if mobile_detail else ".")
            + " Gelen kutu Web Portal oturumuyla çekilecek."
        )
        inbox_channel = "portal_html"
    parts.append("Gelen faturalar: Muhasebe → Gelen e-Belgeler → «Entegratörden çek».")

    return {
        # Portal HTML başarılıysa bağlantı kullanılabilir; Mobile 401 tek başına engel değil.
        "ok": True,
        "provider": "isnet_portal",
        "mode": mode,
        "mode_switched": mode_switched,
        "suggested_mode": mode if mode_switched else None,
        "portal": portal_base(used),
        "mobile_api": mobile_api_base(used),
        "mobile_ok": mobile_ok,
        "inbox_channel": inbox_channel,
        "vkn": info.get("vkn"),
        "company_id": company_id,
        "companies": info.get("companies") or [],
        "remaining_credits": kontor.get("remaining_credits"),
        "message": " ".join(parts),
        "hint": (
            "Bağlantıyı kaydetmek yetmez; Gelen e-Belgeler ekranından senkronize edin."
            if mobile_ok
            else (
                "Mobile API bu hesapta kapalı/uyumsuz olabilir. Kaydedin; gelen faturalar "
                "Web Portal oturumuyla çekilir. İsteğe bağlı: Mobile kullanıcı TCKN deneyin."
            )
        ),
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



async def _list_incoming_via_portal(settings: dict, password: str, days: int = 14) -> List[Dict[str, Any]]:
    """Mobile API olmadan HTML portal oturumuyla gelen kutuyu çeker."""
    used, info, _kontor, meta = await _portal_login_with_fallback(settings, password)
    if meta.get("mode_switched") and meta.get("suggested_mode"):
        settings["mode"] = meta["suggested_mode"]
        settings["_mode_switched"] = True
    async with IsnetPortalClient(used, password) as client:
        # Zaten login fallback içinde yapıldı; yeniden login (cookie taze)
        await client.login()
        if info.get("company_id") and not client.company_id:
            client.company_id = str(info.get("company_id") or "")
        rows = await client.list_inbox(days=days)
    # Sunucu ingest alan adlarıyla uyumlu tut
    out = []
    for row in rows:
        out.append(
            {
                "uuid": row.get("uuid"),
                "invoice_id": row.get("invoice_id"),
                "sender_title": row.get("sender_title") or "",
                "issue_date": row.get("issue_date") or "",
                "payable_amount": row.get("payable_amount"),
                "currency": row.get("currency") or "TRY",
                "status": row.get("status") or "",
                "xml": row.get("xml"),
                "xml_error": row.get("xml_error") or "",
                "source": row.get("source") or "isnet_portal_html",
            }
        )
    return out


async def list_incoming(settings: dict, password: str, days: int = 14) -> List[Dict[str, Any]]:
    """Gelen e-faturaları Mobile REST ile listeler; 401'de Web Portal HTML yedek yolu."""
    try:
        session = await _mobile_login(settings, password)
    except HTTPException as e:
        detail = str(e.detail or "")
        if e.status_code in (400, 401, 403) and ("401" in detail or "kimlik" in detail.lower() or "Login HTTP" in detail):
            logger.warning("isnet_portal mobile login failed; falling back to portal HTML inbox: %s", detail[:200])
            return await _list_incoming_via_portal(settings, password, days=days)
        raise
    # Ortam otomatik değiştiyse sonraki çağrılar doğru API host'unu kullanmalı
    if session.get("mode_switched") and session.get("suggested_mode"):
        settings["mode"] = session["suggested_mode"]
        settings["_mode_switched"] = True
    elif session.get("mode"):
        settings["mode"] = session["mode"]
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
