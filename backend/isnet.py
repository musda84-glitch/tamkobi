"""İşNet Net-e Fatura (NetteFatura / eInvoice API) istemcisi.

Kimlik bilgileri firma `einvoice_settings` kaydında tutulur.
Bağlantı testi: https://einvoiceapi[test].isnet.net.tr/api/Account/Login
"""
from __future__ import annotations

import logging
from typing import Any, Dict

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

LIVE_API = "https://einvoiceapi.isnet.net.tr"
TEST_API = "https://einvoiceapitest.isnet.net.tr"

LIVE_SOAP = "http://einvoiceservice.isnet.net.tr/InvoiceService/ServiceContract/InvoiceService.svc"
TEST_SOAP = "http://einvoiceservicetest.isnet.net.tr/InvoiceService/ServiceContract/InvoiceService.svc"


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
        logger.exception("İşNet health check failed")
        return False


async def login(settings: dict, password: str) -> Dict[str, Any]:
    """Portal / API kullanıcısı ile oturum açar; Token döner."""
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
                "message": "İşNet Net-e Fatura bağlantı testi başarılı.",
            }
    raise HTTPException(status_code=400, detail=last_detail)


async def test_connection(settings: dict, password: str) -> Dict[str, Any]:
    """Sağlık kontrolü + Login ile kimlik doğrulama."""
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
    info["mode"] = "test" if is_test_mode(settings) else "live"
    if not healthy:
        info["warning"] = "Login başarılı ancak GetHealthCheck yanıt vermedi; servis kısmen erişilebilir olabilir."
    return info
