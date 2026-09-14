"""İşNet NetteFatura Web Portal istemcisi (gayriresmî).

Kaynak: https://github.com/EfeSorogluu/NetteFatura-Portal
VKN/TCKN + portal şifresi. SOAP/IP–VKN için `isnet.py` (NetteFatura-API) kullanılır.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

LIVE_PORTAL = "https://nettefatura.isnet.net.tr"
TEST_PORTAL = "https://efatura.isnet.net.tr"
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


async def test_connection(settings: dict, password: str) -> Dict[str, Any]:
    async with IsnetPortalClient(settings, password) as client:
        info = await client.login()
        kontor = await client.get_kontor()
        return {
            "ok": True,
            "provider": "isnet_portal",
            "mode": "test" if is_test_mode(settings) else "live",
            "portal": client.base,
            "vkn": info.get("vkn"),
            "company_id": info.get("company_id") or client.company_id,
            "companies": info.get("companies") or [],
            "remaining_credits": kontor.get("remaining_credits"),
            "message": (
                "İşNet Web Portal girişi başarılı"
                + (
                    f" · kalan kontör: {kontor.get('remaining_credits')}"
                    if kontor.get("remaining_credits") is not None
                    else ""
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


async def list_incoming(settings: dict, password: str, days: int = 14) -> List[Dict[str, Any]]:
    async with IsnetPortalClient(settings, password) as client:
        await client.login()
    logger.info("isnet_portal list_incoming: oturum OK (days=%s)", days)
    return []


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


# API aliases
portal_base = portal_base
is_test_mode = is_test_mode

portal_base = portal_base
is_test_mode = is_test_mode
