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
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Union
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
    # SendDespatchAdviceXml — InvoiceXml ile aynı WCF dizi kalıbı
    "DespatchAdvices": "DespatchAdviceXml",
    "InvoiceDetails": "InvoiceDetail",
    "TaxPayers": "TaxPayer",
    "InboxTagList": "string",
    "OutboxTagList": "string",
    "Aliases": "Alias",
    "Notes": "string",
    "FinancialAccount": "FinancialAccount",
    "InvoiceTotalTaxList": "Tax",
    "Taxes": "Tax",
}

# Yapısal SendInvoice / SendArchiveInvoice (InvoiceNumber yok → İşNet atar)
_ARRAY_ITEM_STRUCTURED_INVOICE = {
    **_ARRAY_ITEM,
    "Invoices": "Invoice",
    "InvoiceDetails": "InvoiceDetail",
}
_ARRAY_ITEM_STRUCTURED_ARCHIVE = {
    **_ARRAY_ITEM,
    "ArchiveInvoices": "ArchiveInvoice",
    "InvoiceDetails": "ArchiveInvoiceDetail",
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


# İşNet test/canlı şube serisi: U05… → CompanyVendorNumber "05"
_VENDOR_FROM_SERIES_RE = re.compile(r"^U(\d{2})\d", re.I)


def infer_vendor_from_invoice_number(invoice_number: str = "") -> str:
    """U052026000000080 → '05' (İşNet şube/vendor kodu)."""
    m = _VENDOR_FROM_SERIES_RE.match((invoice_number or "").strip())
    return m.group(1) if m else ""


def with_inferred_vendor(settings: dict, invoice_number: str = "") -> dict:
    """Ayarlarda vendor yoksa fatura no serisinden CompanyVendorNumber ekle."""
    if company_vendor_number(settings or {}):
        return settings or {}
    vendor = infer_vendor_from_invoice_number(invoice_number)
    if not vendor:
        return settings or {}
    out = dict(settings or {})
    out["company_vendor_number"] = vendor
    return out


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


async def detect_egress_ips() -> List[str]:
    """Sunucunun İşNet’e görünen genel çıkış IP’lerini tespit et (IP–VKN kaydı için)."""
    urls = (
        "https://api.ipify.org",
        "https://icanhazip.com",
        "https://ifconfig.me/ip",
    )
    found: List[str] = []
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            for url in urls:
                try:
                    r = await client.get(url)
                    ip = (r.text or "").strip().split()[0] if r.text else ""
                    if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", ip) and ip not in found:
                        found.append(ip)
                except Exception:
                    continue
    except Exception:
        logger.exception("egress IP tespiti başarısız")
    return found


def _soap_unreachable_hint(exc: BaseException) -> str:
    """Timeout / connect hatalarını kısa Türkçe özetle."""
    name = type(exc).__name__
    text = str(exc) or name
    if isinstance(exc, (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout)):
        return "bağlantı zaman aşımı (TLS/HealthCheck yanıt vermedi)"
    if isinstance(exc, httpx.ConnectError):
        return f"bağlantı kurulamadı ({text[:120]})"
    if "timed out" in text.lower() or "timeout" in text.lower():
        return "bağlantı zaman aşımı (TLS/HealthCheck yanıt vermedi)"
    return text[:180]


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
            ips = await detect_egress_ips()
            info["egress_ips"] = ips
            ip_txt = ", ".join(ips) if ips else "tespit edilemedi"
            # Live REST (einvoiceapi) çoğu ağda açık; SOAP (einvoiceservice) IP–VKN firewall ister
            rest_ok = False
            try:
                rest_ok = await health_check({**settings, "mode": "live"})
            except Exception:
                rest_ok = False
            info["live_rest_ok"] = rest_ok
            rest_note = (
                " Live REST (einvoiceapi) erişilebilir; sorun canlı SOAP (einvoiceservice) IP–VKN kaydında."
                if rest_ok
                else ""
            )
            hint = (
                f" Canlıda IP–VKN için çıkış IP: {ip_txt} — VKN {tax} ile "
                f"{SUPPORT_EMAIL} adresine iletin.{rest_note}"
            )
        elif tax not in TEST_FIRM_VKNS:
            hint = (
                f" Test VKN örnekleri: {', '.join(TEST_FIRM_VKNS)} "
                f"(portal: {TEST_PORTAL_USER} / {TEST_PORTAL_PASSWORD} · {TEST_PORTAL})."
            )
        raise HTTPException(
            status_code=e.status_code,
            detail=f"İşNet SOAP testi başarısız: {e.detail}.{hint}",
        ) from e

    # SOAP IP–VKN yeter; portal REST (kullanıcı/şifre) ayrı üründür ve bu testi kirletmesin.
    # Kayıtlı/opsiyonel şifre yanlış olsa bile HealthCheck + bakiye başarılıysa bağlantı OK.
    _ = password
    info["portal_ok"] = None
    info["portal_hint"] = (
        "SOAP IP–VKN ile çalışır; NetteFatura portal kullanıcı/şifresi gerekmez. "
        "Gelen kutu için Ayarlar → İşNet Web Portal bağlantısını kullanın."
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


def _element_value(el: Optional[ET.Element]) -> str:
    """Düz metin veya iç içe Code/Value/Id (WCF enum / kompleks DetailStatus)."""
    if el is None:
        return ""
    direct = _text(el)
    if direct:
        return direct
    for child_name in ("Code", "Value", "Id", "StatusCode", "DetailStatusCode", "Description", "Name"):
        for child in el:
            if _local(child.tag).lower() == child_name.lower():
                t = _text(child)
                if t:
                    return t
    for child in el.iter():
        if child is el:
            continue
        if _local(child.tag).lower() in {
            "code",
            "value",
            "id",
            "statuscode",
            "detailstatuscode",
        }:
            t = _text(child)
            if t:
                return t
    return ""


def _find_value(root: Optional[ET.Element], *names: str) -> str:
    """Önce doğrudan çocuk, sonra derin arama — Status/DetailStatus için."""
    if root is None:
        return ""
    wanted = {n.lower() for n in names}
    for el in list(root):
        if _local(el.tag).lower() in wanted:
            val = _element_value(el)
            if val:
                return val
    for el in root.iter():
        if _local(el.tag).lower() in wanted:
            val = _element_value(el)
            if val:
                return val
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


# Invoice.DetailStatus = GİB zarf/iletim kodu (WSDL InvoiceDetailStatus).
# Invoice.Status = İşNet süreç durumu (Imza_Bekliyor, Gibe_Iletildi, …).
_DETAIL_STATUS_CODE_BY_ENUM = {
    "zarflanmadi": "1",
    "zarf_kuyruga_eklendi": "1000",
    "zarf_isleniyor": "1100",
    "zip_dosyasi_degil": "1110",
    "zarfid_uzunlugu_gecersiz": "1111",
    "zarf_arsivden_kopyalanamadi": "1120",
    "zip_acilamadi": "1130",
    "zip_bir_dosya_icermeli": "1131",
    "xml_dosyasi_degil": "1132",
    "zarf_id_ve_xml_dosyasinin_adi_ayni_olmali": "1133",
    "dokuman_ayristirilamadi": "1140",
    "zarf_id_yok": "1141",
    "zarf_id_ve_zip_dosyasi_adi_ayni_olmali": "1142",
    "gecersiz_versiyon": "1143",
    "schematron_kontrol_sonucu_hatali": "1150",
    "xml_sema_kontrolundan_gecemedi": "1160",
    "imza_sahibi_tckn_vkn_alinamadi": "1161",
    "imza_kaydedilemedi": "1162",
    "gonderilen_zarf_kayitli_bir_fatura_icermelidir": "1163",
    "gonderilen_zarf_kayitli_bir_belge_icermektedir": "1164",
    "yetki_kontrol_edilemedi": "1170",
    "gonderici_birim_yetkisi_yok": "1171",
    "posta_kutusu_yetkisi_yok": "1172",
    "islem_yetkisi_yok": "1173",
    "fatura_islem_yetkisi_yok": "1174",
    "imza_yetkisi_kontrol_edilemedi": "1175",
    "imza_sahibi_yetkisi": "1176",
    "gecersiz_imza": "1177",
    "adres_kontrol_edilemedi": "1180",
    "adres_bulunamadi": "1181",
    "kullanici_eklenemedi": "1182",
    "kullanici_silinemedi": "1183",
    "sistem_yaniti_hazirlanamadi": "1190",
    "sistem_hatasi": "1195",
    "zarf_basariyla_islendi": "1200",
    "dokuman_bulunan_adrese_gonderilemedi": "1210",
    "dokuman_gonderimi_basarisiz_tekrar_gonderme_sonlandi": "1215",
    "hedeften_sistem_yaniti_gelmedi": "1220",
    "hedeften_sistem_yaniti_basarisiz_geldi": "1230",
    "fatura_iptale_konu_edildi": "1235",
    "basariyla_tamamlandi": "1300",
}

_DETAIL_STATUS_LABEL_BY_CODE = {
    "1": "Zarflanmadı",
    "1000": "Zarf kuyruğa eklendi",
    "1100": "Zarf işleniyor",
    "1110": "ZIP dosyası değil",
    "1111": "Zarf ID uzunluğu geçersiz",
    "1120": "Zarf arşivden kopyalanamadı",
    "1130": "ZIP açılamadı",
    "1131": "ZIP bir dosya içermeli",
    "1132": "XML dosyası değil",
    "1133": "Zarf ID ve XML dosya adı aynı olmalı",
    "1140": "Doküman ayrıştırılamadı",
    "1141": "Zarf ID yok",
    "1142": "Zarf ID ve ZIP dosya adı aynı olmalı",
    "1143": "Geçersiz versiyon",
    "1150": "Schematron kontrol sonucu hatalı",
    "1160": "XML şema kontrolünden geçemedi",
    "1161": "İmza sahibi TCKN/VKN alınamadı",
    "1162": "İmza kaydedilemedi",
    "1163": "Gönderilen zarf kayıtlı bir fatura içermektedir",
    "1164": "Gönderilen zarf kayıtlı bir belge içermektedir",
    "1170": "Yetki kontrol edilemedi",
    "1171": "Gönderici birim yetkisi yok",
    "1172": "Posta kutusu yetkisi yok",
    "1173": "İşlem yetkisi yok",
    "1174": "Fatura işlem yetkisi yok",
    "1175": "İmza yetkisi kontrol edilemedi",
    "1176": "İmza sahibi yetkisiz",
    "1177": "Geçersiz imza",
    "1180": "Adres kontrol edilemedi",
    "1181": "Adres bulunamadı",
    "1182": "Kullanıcı eklenemedi",
    "1183": "Kullanıcı silinemedi",
    "1190": "Sistem yanıtı hazırlanamadı",
    "1195": "Sistem hatası",
    "1200": "Zarf başarıyla işlendi",
    "1210": "Doküman bulunan adrese gönderilemedi",
    "1215": "Doküman gönderimi başarısız — tekrar gönderme sonlandı",
    "1220": "Hedeften sistem yanıtı gelmedi",
    "1230": "Hedeften sistem yanıtı başarısız geldi",
    "1235": "Fatura iptale konu edildi",
    "1300": "Başarıyla Tamamlandı",
}

_PROCESS_STATUS_LABELS = {
    "onay_bekliyor": "Onay bekliyor",
    "onaylandi": "Onaylandı",
    "reddedildi": "Reddedildi",
    "onay_akisinda": "Onay akışında",
    "iade_edildi": "İade edildi",
    "gonderildi": "Gönderildi",
    "ziplendi": "Ziplenmiş",
    "gibe_iletildi": "GİB'e iletildi",
    "imza_bekliyor": "İmza bekliyor",
    "gib_tarafinda_hata_olustu": "GİB tarafında hata oluştu",
    "sistem_hatasi": "Sistem hatası",
    "alici_kabul_etti": "Alıcı kabul etti",
    "alici_reddetti": "Alıcı reddetti",
    "alici_iade_etti": "Alıcı iade etti",
    "otomatik_onaylandi": "Otomatik onaylandı",
    "otomatik_alici_kabul_etti": "Otomatik alıcı kabul etti",
}


def _norm_status_key(value: str) -> str:
    s = (value or "").strip().lower()
    for ch in ("ı", "İ"):
        s = s.replace(ch, "i")
    s = (
        s.replace("ş", "s")
        .replace("ğ", "g")
        .replace("ü", "u")
        .replace("ö", "o")
        .replace("ç", "c")
        .replace(" ", "_")
        .replace("-", "_")
    )
    return s


def resolve_gib_transmission_status(
    *,
    detail_status: str = "",
    process_status: str = "",
    status_code: str = "",
) -> Dict[str, str]:
    """GİB iletim durumu: DetailStatus (1300…) öncelikli; yoksa süreç Status."""
    detail = (detail_status or "").strip()
    process = (process_status or "").strip()
    code = (status_code or "").strip()

    if detail:
        key = _norm_status_key(detail)
        if key.isdigit():
            code = code or key
        else:
            code = code or _DETAIL_STATUS_CODE_BY_ENUM.get(key, "")
        # Zarflanmadı = henüz GİB iletimi yok → süreç Status'a düş
        if key not in ("zarflanmadi", "1") and code not in ("", "1"):
            if code in _DETAIL_STATUS_LABEL_BY_CODE:
                return {"status": _DETAIL_STATUS_LABEL_BY_CODE[code], "status_code": code, "source": "detail"}
            label = detail.replace("_", " ").strip()
            return {"status": label, "status_code": code, "source": "detail"}

    if code and code in _DETAIL_STATUS_LABEL_BY_CODE and code not in ("1",):
        return {"status": _DETAIL_STATUS_LABEL_BY_CODE[code], "status_code": code, "source": "code"}

    if process:
        pkey = _norm_status_key(process)
        if pkey in _PROCESS_STATUS_LABELS:
            return {"status": _PROCESS_STATUS_LABELS[pkey], "status_code": code, "source": "process"}
        if pkey in _DETAIL_STATUS_CODE_BY_ENUM:
            c = _DETAIL_STATUS_CODE_BY_ENUM[pkey]
            return {
                "status": _DETAIL_STATUS_LABEL_BY_CODE.get(c, process.replace("_", " ")),
                "status_code": c,
                "source": "process",
            }
        return {"status": process.replace("_", " ").strip(), "status_code": code, "source": "process"}

    return {"status": "", "status_code": code, "source": ""}


def _search_row_from_el(inv: ET.Element) -> Dict[str, Any]:
    """SearchInvoice / SearchArchiveInvoice satırı — DetailStatus = GİB iletim."""
    # Doğrudan çocuk tercih: satır kalemi Status ile karışmasın
    process = _find_value(inv, "Status", "State", "StatusDescription", "InvoiceStatus")
    detail = _find_value(
        inv,
        "DetailStatus",
        "InvoiceDetailStatus",
        "GibDetailStatus",
        "EnvelopeDetailStatus",
    )
    # Bazı yanıtlarda kod ayrı alanda
    detail_code = _find_value(
        inv, "DetailStatusCode", "InvoiceDetailStatusCode", "GibStatusCode", "EnvelopeStatusCode"
    )
    resolved = resolve_gib_transmission_status(
        detail_status=detail,
        process_status=process,
        status_code=detail_code,
    )
    return {
        "ettn": _find_text(inv, "ETTN", "Ettn", "UUID", "InvoiceETTN"),
        "invoice_id": _find_text(
            inv, "InvoiceNumber", "ArchiveInvoiceNumber", "InvoiceId", "ID"
        ),
        "status": resolved["status"],
        "status_code": resolved["status_code"],
        "detail_status": detail or detail_code,
        "process_status": process,
        "envelope_id": _find_text(inv, "EnvelopeId", "EnvelopeID"),
        "status_source": resolved["source"],
        # Search ResultSet IsHtmlIncluded / IsPdfIncluded (veya IsPDFIncluded)
        "invoice_html": _find_text(inv, "InvoiceHtml", "Html", "InvoiceHTML") or "",
        "invoice_pdf": _find_text(inv, "InvoicePdf", "Pdf", "InvoicePDF") or "",
    }


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


def _humanize_isnet_error(msg: str) -> str:
    """İşNet .NET ham hatalarını kullanıcıya anlamlı Türkçe metne çevir."""
    raw = (msg or "").strip()
    if not raw:
        return raw
    low = raw.lower()
    if "object reference not set to an instance of an object" in low:
        return (
            "İşNet UBL işlerken zorunlu bir alan boş kaldı "
            "(satır KDV TaxCategory, adres veya vergi dairesi). "
            "Cari/şirket adresini ve fatura kalemlerini kontrol edip yeniden gönderin."
        )
    return raw


def _row_failed(el: ET.Element) -> Optional[str]:
    """InvoiceResult / ArchiveInvoiceReturn satırında başarısızlık mesajı (yoksa None)."""
    ok = _find_text(el, "IsSucceded", "IsSucceeded", "IsSuccess", "Success")
    result = _find_text(el, "Result")
    if ok and _is_fail_flag(ok):
        return _humanize_isnet_error(
            _find_text(el, "ErrorMessage", "Error", "Message")
            or f"İşNet satır sonucu başarısız ({ok})."
        )
    if result and _is_fail_flag(result):
        return _humanize_isnet_error(
            _find_text(el, "ErrorMessage", "Error", "Message")
            or f"İşNet satır sonucu başarısız ({result})."
        )
    # ErrorMessage varken IsSucceded açıkça true değilse hata say
    err = _find_text(el, "ErrorMessage", "Error")
    if err and (not ok or _is_fail_flag(ok)):
        return _humanize_isnet_error(err)
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
        msg = _humanize_isnet_error(
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
        top_err = _humanize_isnet_error(top_err)
        results = [v.lower() for v in _find_all_texts(body, "Result")]
        oks = [v.lower() for v in _find_all_texts(body, "IsSucceded", "IsSucceeded", "IsSuccess")]
        if any(r in _FAIL_RESULTS for r in results) or any(o in _FAIL_RESULTS for o in oks):
            raise HTTPException(status_code=400, detail=top_err)
        if results and all(r not in ("success", "successful", "ok", "true", "1") for r in results):
            raise HTTPException(status_code=400, detail=top_err)
        if oks and all(o not in ("true", "1", "success") for o in oks):
            raise HTTPException(status_code=400, detail=top_err)


def _serialize_ein(
    obj: Any,
    parent: Optional[str] = None,
    *,
    array_map: Optional[Dict[str, str]] = None,
) -> str:
    """WCF DataContract SOAP gövdesi — NetteFatura-API serializeToSoapXml (alfabetik anahtar)."""
    amap = array_map or _ARRAY_ITEM
    if obj is None:
        return ""
    if isinstance(obj, bool):
        return "true" if obj else "false"
    if isinstance(obj, (int, float)):
        return str(obj)
    if isinstance(obj, str):
        return xml_esc(obj)
    if isinstance(obj, list):
        item_name = amap.get(parent or "", "Item")
        chunks = []
        for item in obj:
            if isinstance(item, dict):
                chunks.append(
                    f"<ein:{item_name}>{_serialize_ein(item, item_name, array_map=amap)}</ein:{item_name}>"
                )
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
                inner = _serialize_ein(val, key, array_map=amap)
                if inner:
                    parts.append(f"<ein:{key}>{inner}</ein:{key}>")
            else:
                parts.append(f"<ein:{key}>{_serialize_ein(val, key, array_map=amap)}</ein:{key}>")
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
    array_map: Optional[Dict[str, str]] = None,
) -> ET.Element:
    _ = settings
    inner = _serialize_ein(request or {}, array_map=array_map)
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
        raise HTTPException(
            status_code=502,
            detail=f"İşNet SOAP'a ulaşılamadı ({action}): {_soap_unreachable_hint(e)}",
        ) from e
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


async def lookup_despatch_user(settings: dict, password: str, tax_id: str) -> Dict[str, Any]:
    """GetDespatchTaxPayer — e-İrsaliye mükellefiyet / alias (NetteFatura-API)."""
    _ = password
    tax = re.sub(r"\D", "", str(tax_id or ""))
    if len(tax) not in (10, 11):
        raise HTTPException(status_code=400, detail="VKN 10 veya TCKN 11 haneli olmalıdır.")
    body = await _soap_call(
        settings,
        endpoint=address_book_url(settings),
        action="GetDespatchTaxPayer",
        service_interface="IAddressBookService",
        request={"TaxPayerTaxCode": tax},
        timeout=30.0,
    )
    payers = _find_all(body, "TaxPayer")
    if not payers:
        return {"tax_id": tax, "is_e_dispatch_user": False, "alias": "", "name": ""}
    payer = payers[0]
    name = _find_text(payer, "TaxPayerName", "Title", "IdentifierName", "Name") or ""
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
    return {
        "tax_id": tax,
        "is_e_dispatch_user": bool(name or aliases),
        "alias": aliases[0] if aliases else "",
        "name": name or "",
        "aliases": aliases,
        "source": "isnet_despatch",
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


def _round2(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _measure_unit(raw: Any) -> str:
    u = str(raw or "Adet").strip().upper()
    mapping = {
        "ADET": "NIU",
        "AD": "NIU",
        "NIU": "NIU",
        "KG": "KGM",
        "KGM": "KGM",
        "LT": "LTR",
        "LTR": "LTR",
        "M": "MTR",
        "MTR": "MTR",
        "M2": "MTK",
        "MTK": "MTK",
        "M3": "MTQ",
        "MTQ": "MTQ",
        "PAKET": "PK",
        "PK": "PK",
        "SAAT": "HUR",
        "HUR": "HUR",
    }
    return mapping.get(u, "NIU")


def build_structured_invoice(
    invoice: dict,
    company: dict,
    contact: Optional[dict],
    *,
    is_earchive: bool,
    receiver_alias: str = "",
) -> Dict[str, Any]:
    """NetteFatura yapısal Invoice / ArchiveInvoice — InvoiceNumber YOK (İşNet atar)."""
    import uuid as _uuid

    issue = (invoice.get("issue_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))[:10]
    currency = invoice.get("currency") or "TRY"
    items = invoice.get("items") or []
    details = []
    for idx, it in enumerate(items, start=1):
        qty = _round2(it.get("quantity") or 1)
        unit = _round2(it.get("unit_price") or 0)
        vat_rate = _round2(it.get("vat_rate") if it.get("vat_rate") is not None else 20)
        # satır tutarı: KDV hariç tercih
        line_ext = it.get("line_total") or it.get("amount") or (qty * unit)
        line_ext = _round2(line_ext)
        if it.get("vat_included") or str(it.get("price_mode") or "").lower() in ("incl", "gross"):
            # kabaca KDV dahil fiyattan matrah
            line_ext = _round2(line_ext / (1 + vat_rate / 100.0)) if vat_rate else line_ext
        disc = _round2(it.get("discount_amount") or 0)
        if disc and disc < line_ext:
            line_ext = _round2(line_ext - disc)
        vat_amt = _round2(it.get("vat_amount") if it.get("vat_amount") is not None else line_ext * vat_rate / 100.0)
        code = str(it.get("product_code") or it.get("sku") or it.get("product_id") or f"PRD-{idx}")
        name = str(it.get("name") or it.get("product_name") or f"Kalem {idx}")
        details.append(
            {
                "CurrencyCode": currency,
                "DiscountAmount": disc or None,
                "LineExtensionAmount": line_ext,
                "Product": {
                    "ExternalProductCode": code,
                    "MeasureUnit": _measure_unit(it.get("unit") or it.get("measure_unit")),
                    "ProductCode": code,
                    "ProductName": name,
                    "UnitPrice": unit,
                },
                "Quantity": qty,
                "VATAmount": vat_amt,
                "VATRate": vat_rate,
                "Mensei": "TR",
            }
        )

    if not details:
        raise HTTPException(status_code=400, detail="Faturada en az bir kalem gerekli (İşNet yapısal gönderim).")

    subtotal = _round2(invoice.get("subtotal"))
    if not subtotal:
        subtotal = _round2(sum(d["LineExtensionAmount"] for d in details))
    vat_total = _round2(invoice.get("vat_total"))
    if not vat_total:
        vat_total = _round2(sum(d["VATAmount"] for d in details))
    discount = _round2(invoice.get("discount_total") or 0)
    payable = _round2(invoice.get("grand_total") or (subtotal + vat_total))
    tax_incl = _round2(subtotal + vat_total)

    buyer_tax = re.sub(
        r"\D",
        "",
        str(
            (contact or {}).get("tax_number_or_id")
            or (contact or {}).get("tax_id")
            or invoice.get("contact_tax_id")
            or ""
        ),
    )
    if is_earchive and len(buyer_tax) not in (10, 11):
        buyer_tax = "11111111111"
    buyer_name = (contact or {}).get("name") or invoice.get("contact_name") or "Nihai Tüketici"
    buyer_email = (
        (contact or {}).get("email")
        or invoice.get("contact_email")
        or invoice.get("buyer_email")
        or ""
    ).strip()
    address = {
        "BoulevardAveneuStreetName": (
            (contact or {}).get("address") or invoice.get("contact_address") or "Türkiye"
        )[:200],
        "CityName": (contact or {}).get("city") or invoice.get("contact_city") or "İSTANBUL",
        "CountryCode": "TR",
        "CountryName": "TÜRKİYE",
        "EMail": buyer_email or None,
        "PhoneNumber": (contact or {}).get("phone") or None,
        "TaxOfficeName": (contact or {}).get("tax_office") or None,
        "TownName": (contact or {}).get("district") or None,
    }
    receiver = {
        "ReceiverName": buyer_name,
        "ReceiverTaxCode": buyer_tax,
        "Address": {k: v for k, v in address.items() if v},
        "TaxOfficeName": (contact or {}).get("tax_office") or None,
        "EMail": buyer_email or None,
    }

    scen = invoice.get("gib_scenario") or invoice.get("_profile_override") or ""
    if scen not in ("TEMELFATURA", "TICARIFATURA", "EARSIVFATURA", "IHRACAT"):
        scen = "EARSIVFATURA" if is_earchive else "TICARIFATURA"
    # TamKobi invoice_type=return/sales_return/iade → GİB IADE (önceden hep SATIS kalıyordu)
    import ubl_export

    inv_type = ubl_export.gib_invoice_type_code(invoice)

    ettn = str(invoice.get("gib_uuid") or invoice.get("ettn") or _uuid.uuid4()).upper()
    external = str(
        invoice.get("id")
        or invoice.get("_id")
        or invoice.get("invoice_number")
        or ettn
    )
    notes = []
    if invoice.get("notes"):
        notes.append(str(invoice.get("notes"))[:500])

    payload: Dict[str, Any] = {
        "CurrencyCode": currency,
        "ETTN": ettn,
        "InvoiceDate": issue,
        "InvoiceCreationDate": issue,
        "InvoiceDetails": details,
        "InvoiceType": inv_type,
        "Receiver": {k: v for k, v in receiver.items() if v is not None},
        "TotalDiscountAmount": discount or None,
        "TotalLineExtensionAmount": subtotal,
        "TotalPayableAmount": payable,
        "TotalTaxInclusiveAmount": tax_incl,
        "TotalVATAmount": vat_total,
    }
    if notes:
        payload["Notes"] = notes
    if invoice.get("order_number"):
        payload["OrderNumber"] = str(invoice.get("order_number"))
        if invoice.get("order_date"):
            payload["OrderDate"] = str(invoice.get("order_date"))[:10]
    if is_earchive:
        payload["ExternalArchiveInvoiceCode"] = external
        # InvoiceNumber bilerek yok — İşNet GİB serisinden atar
    else:
        payload["ExternalInvoiceCode"] = external
        payload["ScenarioType"] = scen
        if receiver_alias:
            payload["ReceiverInboxTag"] = receiver_alias
        # InvoiceNumber bilerek yok — İşNet GİB serisinden atar
    return payload


async def send_structured_invoice(
    settings: dict,
    *,
    invoice_payload: dict,
    is_earchive: bool = False,
) -> Dict[str, Any]:
    """SendInvoice / SendArchiveInvoice — InvoiceNumber İşNet tarafından üretilir."""
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet SOAP gönderimi için şirket VKN (company_tax_id) gerekli."
        )
    if is_earchive:
        action = "SendArchiveInvoice"
        request: Dict[str, Any] = {**req_base, "ArchiveInvoices": [invoice_payload]}
        array_map = _ARRAY_ITEM_STRUCTURED_ARCHIVE
    else:
        action = "SendInvoice"
        request = {**req_base, "Invoices": [invoice_payload]}
        array_map = _ARRAY_ITEM_STRUCTURED_INVOICE

    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action=action,
        service_interface="IInvoiceService",
        request=request,
        timeout=90.0,
        array_map=array_map,
    )
    row_tags = (
        "InvoiceResult",
        "ArchiveInvoiceResult",
        "InvoiceResultItem",
        "ArchiveInvoiceReturn",
        "InvoiceReturn",
        "ArchiveInvoice",
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
        ettn = _find_text(body, "ETTN", "Ettn", "InvoiceETTN") or ""
        invoice_id = (
            _find_text(body, "InvoiceNumber", "InvoiceId", "DocumentId", "ArchiveInvoiceNumber") or ""
        )
        message = _find_text(body, "Message") or ""
    # Yanıtta satır listesi ArchiveInvoices altında da olabilir
    if not invoice_id:
        for inv in _find_all(body, "ArchiveInvoice", "Invoice"):
            invoice_id = invoice_id or _find_text(
                inv, "InvoiceNumber", "ArchiveInvoiceNumber", "InvoiceId", "ID"
            )
            ettn = ettn or _find_text(inv, "ETTN", "Ettn")
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
        "invoice_id": (invoice_id or "").strip(),
        "status": _find_text(body, "Status", "State") or "sent",
        "message": message,
        "document_url": _find_text(body, "HtmlUrl", "PdfUrl", "DocumentUrl") or "",
        "via": "structured",
    }


def _parse_send_xml_body(body: ET.Element, action: str) -> Dict[str, Any]:
    """Send*Xml SOAP gövdesinden ETTN + İşNet fatura no."""
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
                result_el,
                "InvoiceNumber",
                "DespatchAdviceNumber",
                "InvoiceId",
                "DocumentId",
                "ArchiveInvoiceNumber",
            )
            message = message or _find_text(result_el, "Message")
    else:
        ettn = _find_text(body, "ETTN", "Ettn", "InvoiceETTN") or ""
        invoice_id = (
            _find_text(
                body,
                "InvoiceNumber",
                "DespatchAdviceNumber",
                "InvoiceId",
                "DocumentId",
                "ArchiveInvoiceNumber",
            )
            or ""
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
        "invoice_id": (invoice_id or "").strip(),
        "status": _find_text(body, "Status", "State") or "sent",
        "message": message,
        "document_url": _find_text(body, "HtmlUrl", "PdfUrl", "DocumentUrl") or "",
        "action": action,
    }


def _xml_send_actions(*, is_earchive: bool, assign_number: bool) -> List[str]:
    """Önce WithoutInvoiceNumber (İşNet seri atar), yoksa klasik *Xml."""
    if is_earchive:
        auto = "SendArchiveInvoiceXmlWithoutInvoiceNumber"
        classic = "SendArchiveInvoiceXml"
    else:
        auto = "SendInvoiceXmlWithoutInvoiceNumber"
        classic = "SendInvoiceXml"
    return [auto, classic] if assign_number else [classic]


def _action_missing(err: HTTPException) -> bool:
    """SOAP metodu WSDL'de yok / Fault — diğer aksiyona düş."""
    if err.status_code not in (400, 502):
        return False
    d = str(err.detail or "").lower()
    keys = (
        "not found",
        "bilinmeyen",
        "unknown",
        "does not exist",
        "bulunamadı",
        "not supported",
        "desteklenmiyor",
        "operation",
        "action",
        "method",
    )
    return any(k in d for k in keys)


async def send_invoice_xml(
    settings: dict,
    *,
    ubl_xml: str,
    receiver_alias: str = "",
    is_earchive: bool = False,
    assign_number: bool = True,
) -> Dict[str, Any]:
    """UBL gönder — NetteFatura test/canlıya düşen kanıtlı yol.

    assign_number=True: resmi *WithoutInvoiceNumber (İşNet kayıtlı seriyi atar).
    Metod yoksa SendInvoiceXml / SendArchiveInvoiceXml.
    """
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
        request: Dict[str, Any] = {
            **req_base,
            "ArchiveInvoices": [{"ArchiveInvoiceContent": content}],
        }
    else:
        item: Dict[str, Any] = {"InvoiceContent": content}
        if alias:
            item["ReceiverTag"] = alias
        request = {**req_base, "Invoices": [item]}

    actions = _xml_send_actions(is_earchive=is_earchive, assign_number=assign_number)
    last_err: Optional[HTTPException] = None
    for i, action in enumerate(actions):
        try:
            body = await _soap_call(
                settings,
                endpoint=soap_url(settings),
                action=action,
                service_interface="IInvoiceService",
                request=request,
                timeout=90.0,
            )
            return _parse_send_xml_body(body, action)
        except HTTPException as e:
            last_err = e
            more = i < len(actions) - 1
            if more and _action_missing(e):
                logger.warning("isnet %s yok/geçersiz — %s deneniyor: %s", action, actions[i + 1], e.detail)
                continue
            if more and e.status_code == 502:
                logger.warning("isnet %s 502 — %s deneniyor: %s", action, actions[i + 1], e.detail)
                continue
            raise
    raise last_err or HTTPException(status_code=502, detail="İşNet UBL gönderimi başarısız.")


async def send_despatch_xml(
    settings: dict,
    *,
    ubl_xml: str,
    receiver_alias: str = "",
) -> Dict[str, Any]:
    """SendDespatchAdviceXml — NetteFatura-API invoice.sendDespatchAdviceXml()."""
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet e-İrsaliye gönderimi için şirket VKN (company_tax_id) gerekli."
        )
    content = _ensure_b64(ubl_xml)
    if not content:
        raise HTTPException(status_code=400, detail="e-İrsaliye UBL XML boş.")
    item: Dict[str, Any] = {"DespatchAdviceContent": content}
    alias = (receiver_alias or settings.get("alias") or "").strip()
    if alias:
        item["ReceiverTag"] = alias
    request: Dict[str, Any] = {**req_base, "DespatchAdvices": [item]}
    last_err: Optional[HTTPException] = None
    # Önce Xml kalemi DespatchAdviceXml; WSDL farklıysa DespatchAdvice dene
    for amap in (
        _ARRAY_ITEM,
        {**_ARRAY_ITEM, "DespatchAdvices": "DespatchAdvice"},
    ):
        try:
            body = await _soap_call(
                settings,
                endpoint=soap_url(settings),
                action="SendDespatchAdviceXml",
                service_interface="IInvoiceService",
                request=request,
                timeout=90.0,
                array_map=amap,
            )
            parsed = _parse_send_xml_body(body, "SendDespatchAdviceXml")
            # İrsaliye no alanı DespatchAdviceNumber olabilir
            if not parsed.get("invoice_id"):
                parsed["invoice_id"] = _find_text(
                    body, "DespatchAdviceNumber", "DocumentNumber", "InvoiceNumber"
                ) or ""
            return parsed
        except HTTPException as e:
            last_err = e
            if _action_missing(e):
                continue
            if e.status_code == 502 and amap is _ARRAY_ITEM:
                continue
            raise
    raise last_err or HTTPException(status_code=502, detail="İşNet e-İrsaliye gönderimi başarısız.")


def is_provisional_invoice_number(number: str, local_ubl: str = "") -> bool:
    """Yerel TKB / UBL id — entegratör serisi değil."""
    no = (number or "").strip().upper()
    if not no:
        return True
    if no.startswith("TKB"):
        return True
    if no.startswith("IRS") and len(no) < 16:
        # Yerel IRS sayacı — İşNet serisi genelde daha uzun / farklı prefix
        pass
    loc = (local_ubl or "").strip().upper()
    return bool(loc and no == loc)


def build_ubl(
    invoice: dict,
    company: dict,
    contact: Optional[dict],
    ettn: Optional[str] = None,
) -> tuple:
    """İşNet Send*Xml UBL — ubl_export (IADE / TEVKIFAT / WithholdingTaxTotal).

    n11faturam.build_ubl kullanılmaz; GİB tip ve tevkifat alanları burada üretilir.
    Dönüş: (xml_str, ettn, invoice_id) — send_document ile uyumlu.
    """
    import ubl_export

    inv = dict(invoice or {})
    if ettn:
        inv["gib_uuid"] = str(ettn).upper()
    seller = {
        "name": (company or {}).get("name"),
        "tax_number": (company or {}).get("tax_number") or (company or {}).get("tax_id"),
        "tax_office": (company or {}).get("tax_office"),
        "address": (company or {}).get("address"),
        "city": (company or {}).get("city"),
        "district": (company or {}).get("district"),
        "phone": (company or {}).get("phone"),
        "email": (company or {}).get("email"),
    }
    buyer = ubl_export._buyer_from(inv, contact)
    xml_bytes = ubl_export.build_invoice_ubl(inv, seller, buyer, send_ready=True)
    root = ET.fromstring(xml_bytes)
    cbc = "{urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2}"
    inv_id = ""
    uuid_out = ""
    id_el = root.find(f"{cbc}ID")
    if id_el is not None and id_el.text:
        inv_id = id_el.text.strip()
    uuid_el = root.find(f"{cbc}UUID")
    if uuid_el is not None and uuid_el.text:
        uuid_out = uuid_el.text.strip()
    return xml_bytes.decode("utf-8"), uuid_out, inv_id


def build_despatch_ubl(
    invoice: dict,
    company: dict,
    contact: Optional[dict],
    ettn: Optional[str] = None,
) -> tuple:
    """İşNet SendDespatchAdviceXml UBL — (xml_str, ettn, despatch_id)."""
    import ubl_export

    inv = dict(invoice or {})
    if ettn:
        inv["gib_uuid"] = str(ettn).upper()
    seller = {
        "name": (company or {}).get("name"),
        "tax_number": (company or {}).get("tax_number") or (company or {}).get("tax_id"),
        "tax_office": (company or {}).get("tax_office"),
        "address": (company or {}).get("address"),
        "city": (company or {}).get("city"),
        "district": (company or {}).get("district"),
        "phone": (company or {}).get("phone"),
        "email": (company or {}).get("email"),
    }
    buyer = ubl_export._buyer_from(inv, contact)
    xml_bytes = ubl_export.build_despatch_ubl(inv, seller, buyer, send_ready=True)
    root = ET.fromstring(xml_bytes)
    cbc = "{urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2}"
    inv_id = ""
    uuid_out = ""
    id_el = root.find(f"{cbc}ID")
    if id_el is not None and id_el.text:
        inv_id = id_el.text.strip()
    uuid_el = root.find(f"{cbc}UUID")
    if uuid_el is not None and uuid_el.text:
        uuid_out = uuid_el.text.strip()
    return xml_bytes.decode("utf-8"), uuid_out, inv_id


async def send_despatch_document(
    settings: dict,
    password: str,
    invoice: dict,
    contact: Optional[dict],
    company: dict,
) -> Dict[str, Any]:
    """e-İrsaliye → SendDespatchAdviceXml (İşNet SOAP)."""
    merged = {**settings}
    seller_vkn = company_tax_code(merged) or company_tax_code(settings, company)
    if not seller_vkn:
        raise HTTPException(
            status_code=400,
            detail=(
                "İşNet e-İrsaliye için şirket VKN gerekli. "
                "Ayarlar → e-Fatura (İşNet SOAP) içinde CompanyTaxCode / VKN kaydedin."
            ),
        )
    merged["company_tax_id"] = seller_vkn

    buyer_tax = re.sub(
        r"\D",
        "",
        str(
            (contact or {}).get("tax_number_or_id")
            or (contact or {}).get("tax_id")
            or invoice.get("contact_tax_id")
            or ""
        ),
    )
    if len(buyer_tax) not in (10, 11):
        raise HTTPException(
            status_code=400,
            detail="e-İrsaliye için alıcı VKN/TCKN zorunlu. Cari kartını güncelleyin.",
        )

    receiver = (
        (contact or {}).get("e_dispatch_alias")
        or (contact or {}).get("e_invoice_alias")
        or (contact or {}).get("gib_alias")
        or settings.get("alias")
        or ""
    ).strip()
    try:
        looked = await lookup_despatch_user(merged, password or "", buyer_tax)
        if looked.get("alias") and not receiver:
            receiver = (looked.get("alias") or "").strip()
        if not looked.get("is_e_dispatch_user"):
            logger.info("isnet GetDespatchTaxPayer: alıcı e-irsaliye mükellefi değil tax=%s", buyer_tax)
    except HTTPException as e:
        logger.info("isnet GetDespatchTaxPayer failed tax=%s: %s", buyer_tax, e.detail)

    company_for_ubl = {**(company or {}), "tax_number": seller_vkn}
    try:
        xml, _local_ettn, inv_id = build_despatch_ubl(dict(invoice or {}), company_for_ubl, contact)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("isnet build_despatch_ubl")
        raise HTTPException(status_code=500, detail=f"e-İrsaliye UBL hatası: {e}") from e
    local_ubl = (inv_id or "").strip()

    info = await send_despatch_xml(merged, ubl_xml=xml, receiver_alias=str(receiver or ""))
    uuid_out = (info.get("ettn") or "").strip()
    if not is_ettn_uuid(uuid_out):
        raise HTTPException(
            status_code=502,
            detail="İşNet e-İrsaliye geçerli ETTN (UUID) döndürmedi — NetteFatura kaydı doğrulanamadı.",
        )

    soap_inv_no = (info.get("invoice_id") or "").strip()
    hint_no = "" if is_provisional_invoice_number(soap_inv_no, local_ubl) else soap_inv_no
    verified = await try_verify_outgoing_in_portal(
        merged,
        uuid_out,
        e_type="e_dispatch",
        invoice_number=hint_no,
        retries=4,
        wait_for_gib=True,
    )
    portal_no = (verified.get("invoice_id") or "").strip()
    official = ""
    number_source = "ubl"
    for cand, src in ((portal_no, "portal"), (soap_inv_no, "soap")):
        if cand and not is_provisional_invoice_number(cand, local_ubl):
            official, number_source = cand, src
            break
    inv_no = official or soap_inv_no or local_ubl or (invoice.get("invoice_number") or "").strip()
    return {
        "ettn": uuid_out,
        "invoice_id": inv_no,
        "official_invoice_id": official,
        "number_source": number_source,
        "ubl_id": local_ubl,
        "document_url": verified.get("document_url") or info.get("document_url") or "",
        "description": info.get("message") or "",
        "provider": "isnet",
        "seller_tax": seller_vkn,
        "verified": bool(verified.get("ok")),
        "verify_via": verified.get("via") or "",
        "gib_status_raw": (verified.get("status") or "").strip(),
        "gib_status_code": (verified.get("status_code") or "").strip(),
        "detail_status": (verified.get("detail_status") or "").strip(),
        "process_status": (verified.get("process_status") or "").strip(),
        "mode": "test" if is_test_mode(merged) else "live",
        "send_mode": info.get("action") or "SendDespatchAdviceXml",
    }


async def send_document(
    settings: dict,
    password: str,
    invoice: dict,
    contact: Optional[dict],
    company: dict,
) -> Dict[str, Any]:
    """n11faturam.send_document ile aynı sözleşme.

    Kanıtlı yol: UBL Send*Xml (NetteFatura test/canlıya düşer).
    Numara: Send*XmlWithoutInvoiceNumber → SOAP/portal InvoiceNumber (TKB değil).
    UBL: isnet.build_ubl → ubl_export (IADE/TEVKIFAT); n11faturam değil.
    """
    e_type = invoice.get("e_type") or "e_archive"
    if e_type == "e_dispatch" or invoice.get("invoice_type") == "dispatch":
        return await send_despatch_document(settings, password, invoice, contact, company)
    if e_type not in ("e_invoice", "e_archive"):
        raise HTTPException(status_code=400, detail="İşNet yalnızca e-Fatura, e-Arşiv ve e-İrsaliye gönderir.")

    merged = {**settings}
    seller_vkn = company_tax_code(merged) or company_tax_code(settings, company)
    if not seller_vkn:
        raise HTTPException(
            status_code=400,
            detail=(
                "İşNet gönderimi için şirket VKN gerekli. "
                "Ayarlar → e-Fatura (İşNet SOAP) içinde CompanyTaxCode / VKN kaydedin "
                f"(test: {', '.join(TEST_FIRM_VKNS)})."
            ),
        )
    merged["company_tax_id"] = seller_vkn
    is_earchive = e_type == "e_archive"

    receiver = (
        (contact or {}).get("e_invoice_alias")
        or (contact or {}).get("gib_alias")
        or (contact or {}).get("inbox_tag")
        or settings.get("alias")
        or ""
    ).strip()
    if e_type == "e_invoice" and not receiver:
        buyer_tax = re.sub(
            r"\D",
            "",
            str(
                (contact or {}).get("tax_number_or_id")
                or (contact or {}).get("tax_id")
                or invoice.get("contact_tax_id")
                or ""
            ),
        )
        if len(buyer_tax) in (10, 11):
            try:
                looked = await lookup_user(merged, password or "", buyer_tax)
                receiver = (looked.get("alias") or "").strip()
            except HTTPException:
                logger.info("isnet GetTaxPayer alias lookup failed tax=%s", buyer_tax)
        if not receiver:
            raise HTTPException(
                status_code=400,
                detail=(
                    "E-Fatura için alıcı GİB posta kutusu (ReceiverTag / alias) gerekli. "
                    "Caride e-fatura alias girin veya Ayarlar → İşNet alias alanını doldurun."
                ),
            )

    buyer_tax_digits = re.sub(
        r"\D",
        "",
        str(
            (contact or {}).get("tax_number_or_id")
            or (contact or {}).get("tax_id")
            or invoice.get("contact_tax_id")
            or ""
        ),
    )
    if e_type == "e_invoice" and len(buyer_tax_digits) not in (10, 11):
        raise HTTPException(
            status_code=400,
            detail=(
                "E-Fatura için cari VKN/TCKN zorunlu. "
                "Eksik kimlik İşNet'te «Object reference…» hatasına yol açar — cari kartını güncelleyin."
            ),
        )

    import ubl_export as _ubl_exp

    inv_for_ubl = dict(invoice or {})
    # IADE Schematron: TICARIFATURA yasak → TEMELFATURA
    if _ubl_exp.is_return_invoice(inv_for_ubl) or _ubl_exp.gib_invoice_type_code(inv_for_ubl) in (
        "IADE",
        "TEVKIFATIADE",
    ):
        if (inv_for_ubl.get("gib_scenario") or "") == "TICARIFATURA" or e_type == "e_invoice":
            inv_for_ubl["gib_scenario"] = "TEMELFATURA"
            inv_for_ubl["_profile_override"] = "TEMELFATURA"
        if not _ubl_exp.return_billing_ref(inv_for_ubl):
            raise HTTPException(
                status_code=400,
                detail=(
                    "İade e-faturası Schematron için orijinal fatura numarası (BillingReference) zorunlu. "
                    "Fatura notuna «… numaralı faturaya istinaden» yazın veya original_invoice_number girin."
                ),
            )
    if _ubl_exp.invoice_has_zero_vat(inv_for_ubl) and not _ubl_exp.resolve_tax_exemption(inv_for_ubl):
        line_ok = any(
            _ubl_exp.resolve_tax_exemption(inv_for_ubl, it)
            for it in (inv_for_ubl.get("items") or [])
            if float(it.get("vat_rate") or 0) == 0
        )
        if not line_ok:
            raise HTTPException(
                status_code=400,
                detail=(
                    "KDV %0 satırlarda vergi muafiyet sebebi zorunlu "
                    "(TaxExemptionReasonCode). E-fatura onayında muafiyet kodunu seçin."
                ),
            )

    company_for_ubl = {**(company or {})}
    company_for_ubl["tax_number"] = seller_vkn
    try:
        xml, _local_ettn, inv_id = build_ubl(inv_for_ubl, company_for_ubl, contact)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("isnet build_ubl")
        raise HTTPException(status_code=500, detail=f"UBL oluşturma hatası: {e}") from e
    local_ubl = (inv_id or "").strip()

    info = await send_invoice_xml(
        merged,
        ubl_xml=xml,
        receiver_alias=str(receiver or ""),
        is_earchive=is_earchive,
        assign_number=True,
    )
    send_mode = (info.get("action") or "ubl_xml").strip()

    seller = seller_vkn
    uuid_out = (info.get("ettn") or "").strip()
    if not is_ettn_uuid(uuid_out):
        raise HTTPException(
            status_code=502,
            detail="İşNet geçerli ETTN (UUID) döndürmedi — NetteFatura/GİB kaydı doğrulanamadı.",
        )

    soap_inv_no = (info.get("invoice_id") or "").strip()
    hint_no = "" if is_provisional_invoice_number(soap_inv_no, local_ubl) else soap_inv_no
    verified = await try_verify_outgoing_in_portal(
        merged,
        uuid_out,
        e_type=e_type,
        invoice_number=hint_no,
        retries=4,
        wait_for_gib=True,
    )
    pending = verified.get("pending_gib") or _is_pending_process_status(
        verified.get("process_status") or "",
        verified.get("status") or "",
        verified.get("status_code") or "",
    )
    advance_pwd = (password or "").strip()
    portal_settings = merged
    if not advance_pwd and is_test_mode(merged):
        advance_pwd = TEST_PORTAL_PASSWORD
        portal_settings = {
            **merged,
            "mobile_username": merged.get("mobile_username") or TEST_PORTAL_USER,
            "username": merged.get("username") or TEST_PORTAL_USER,
        }
    if pending and advance_pwd:
        try:
            import isnet_portal as _portal

            advanced = await _portal.advance_outgoing_invoice(
                portal_settings,
                advance_pwd,
                ettn=uuid_out,
                invoice_number=hint_no or soap_inv_no,
                e_type=e_type,
                process_status=verified.get("process_status") or "",
            )
            if advanced.get("invoice_number") and not hint_no:
                hint_no = str(advanced.get("invoice_number") or "")
            if advanced.get("ok"):
                verified = await try_verify_outgoing_in_portal(
                    merged,
                    uuid_out,
                    e_type=e_type,
                    invoice_number=hint_no or soap_inv_no,
                    retries=5,
                    wait_for_gib=True,
                )
        except Exception:
            logger.exception("isnet portal advance failed ettn=%s", uuid_out)
    portal_no = (verified.get("invoice_id") or "").strip()
    xml_no = ""
    if not portal_no or is_provisional_invoice_number(portal_no, local_ubl):
        xml_no = await resolve_invoice_number_from_xml(
            merged,
            uuid_out,
            e_type=e_type,
            invoice_number=soap_inv_no if not is_provisional_invoice_number(soap_inv_no, local_ubl) else "",
            viewer_url=(verified.get("document_url") or info.get("document_url") or ""),
        )
        xml_no = (xml_no or "").strip()

    official = ""
    number_source = "ubl"
    for cand, src in (
        (portal_no, "portal"),
        (soap_inv_no, "soap"),
        (xml_no, "xml"),
    ):
        if cand and not is_provisional_invoice_number(cand, local_ubl):
            official, number_source = cand, src
            break

    inv_no = official or soap_inv_no or local_ubl or (invoice.get("invoice_number") or "").strip()
    # GİB iletim: DetailStatus (1300 Başarıyla Tamamlandı); süreç Status yedek
    portal_status = (verified.get("status") or "").strip()
    portal_code = (verified.get("status_code") or "").strip()
    if not verified.get("ok"):
        logger.info(
            "isnet soft-verify pending ettn=%s inv=%s action=%s",
            uuid_out,
            soap_inv_no or inv_no,
            send_mode,
        )
    elif official:
        logger.info(
            "isnet fatura no kaynak=%s ettn=%s no=%s action=%s status=%s code=%s",
            number_source,
            uuid_out,
            official,
            send_mode,
            portal_status or "-",
            portal_code or "-",
        )
    return {
        "ettn": uuid_out,
        "invoice_id": inv_no,
        "official_invoice_id": official,
        "number_source": number_source,
        "ubl_id": local_ubl,
        "document_url": verified.get("document_url") or info.get("document_url") or "",
        "description": info.get("message") or "",
        "provider": "isnet",
        "seller_tax": seller,
        "verified": bool(verified.get("ok")),
        "verify_via": verified.get("via") or "",
        "gib_status_raw": portal_status,
        "gib_status_code": portal_code,
        "detail_status": (verified.get("detail_status") or "").strip(),
        "process_status": (verified.get("process_status") or "").strip(),
        "mode": "test" if is_test_mode(merged) else "live",
        "send_mode": send_mode,
    }


def _search_invoice_filters(*, ettn: str = "", invoice_number: str = "") -> Dict[str, str]:
    """WSDL: Ettn + MinInvoiceNumber/MaxInvoiceNumber (InvoiceNumber/ETTN geçersiz)."""
    out: Dict[str, str] = {}
    e = (ettn or "").strip()
    no = (invoice_number or "").strip()
    if e:
        out["Ettn"] = e
    if no:
        out["MinInvoiceNumber"] = no
        out["MaxInvoiceNumber"] = no
    return out


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
    req.update(_search_invoice_filters(ettn=ettn, invoice_number=invoice_number))
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
        out.append(_search_row_from_el(inv))
    return out


async def search_outgoing_invoice(
    settings: dict,
    *,
    ettn: str = "",
    invoice_number: str = "",
    min_date: str = "",
    max_date: str = "",
    include_documents: bool = False,
    direction: str = "Outgoing",
) -> List[Dict[str, Any]]:
    """SearchInvoice — giden/gelen e-Fatura arama.

    include_documents=True → IsHtmlIncluded + IsPdfIncluded (PDF fallback için).
    """
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet giden fatura arama için şirket VKN (company_tax_id) gerekli."
        )
    direction = "Incoming" if str(direction or "").lower().startswith("in") else "Outgoing"
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=90)
    result_set: Dict[str, Any] = {
        "IsAdditionalTaxIncluded": True,
        "IsArchiveIncluded": True,
        "IsInvoiceDetailIncluded": True,
        "IsXMLIncluded": False,
    }
    if include_documents:
        result_set["IsHtmlIncluded"] = True
        result_set["IsPdfIncluded"] = True
        # Bazı WSDL sürümleri IsPDFIncluded kullanır
        result_set["IsPDFIncluded"] = True
    req: Dict[str, Any] = {
        **req_base,
        "InvoiceDirection": direction,
        "MinInvoiceDate": (min_date or start.strftime("%Y-%m-%d")),
        "MaxInvoiceDate": (max_date or end.strftime("%Y-%m-%d")),
        "PagingRequest": {"PageNumber": 1, "RecordsPerPage": 50},
        "ResultSet": result_set,
    }
    req.update(_search_invoice_filters(ettn=ettn, invoice_number=invoice_number))
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="SearchInvoice",
        service_interface="IInvoiceService",
        request=req,
        timeout=90.0 if include_documents else 60.0,
    )
    out: List[Dict[str, Any]] = []
    for inv in _find_all(body, "Invoice", "InvoiceInfo", "Document"):
        out.append(_search_row_from_el(inv))
    return out


def _is_pending_process_status(process: str = "", status: str = "", code: str = "") -> bool:
    """Onay/Imza/Ziplenmiş/GİB'e iletildi — DetailStatus 1300 gelene kadar poll devam."""
    if (code or "").strip() == "1300":
        return False
    blob = f"{process} {status}".lower().replace("ı", "i").replace("İ", "i")
    if "basariyla tamamland" in blob:
        return False
    if (
        "ziplen" in blob
        or "imza_bekliyor" in blob
        or "imza bekliyor" in blob
        or "onay_bekliyor" in blob
        or "onay bekliyor" in blob
        or "gibe_iletildi" in blob
        or "gib'e iletildi" in blob
        or "gibe iletildi" in blob
    ):
        return True
    if code in ("", "1") and "gonderildi" in blob and "gibe" not in blob:
        return False
    return False


def is_outbound_gib_pending(
    *,
    gib_status: str = "",
    gib_status_code: str = "",
    detail_status: str = "",
    process_status: str = "",
) -> bool:
    """TamKobi giden fatura — GİB 1300 tamamlanmadı mı?"""
    code = str(gib_status_code or "").strip()
    if code == "1300":
        return False
    gs = (gib_status or "").lower().replace("ı", "i")
    if "basariyla tamamland" in gs:
        return False
    if _is_pending_process_status(process_status, gib_status, code):
        return True
    if "imza bek" in gs or "onay bek" in gs or "ziplen" in gs or "tamamlaniyor" in gs or "bekleniyor" in gs:
        return True
    if "gib" in gs and "iletildi" in gs:
        return True
    return code in ("", "1", "1000", "1100", "1200", "1220")


async def try_verify_outgoing_in_portal(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
    retries: int = 3,
    wait_for_gib: bool = False,
) -> Dict[str, Any]:
    """NetteFatura-API ile uyum: viewer/search soft doğrulama; bulunamazsa hata fırlatmaz.

    Send*Xml Success+ETTN yeterli kabul edilir; portal indeksi gecikebilir.
    Fatura no için arama (ETTN) viewer'dan ayrı yapılır — viewer tek başına
    InvoiceNumber döndürmez.

    wait_for_gib=True: süreç Status=Ziplendi iken DetailStatus (1300…) gelene kadar
    daha uzun poll (NetteFatura testinde imza+GİB iletimi gecikebilir).
    """
    ettn = (ettn or "").strip()
    if not is_ettn_uuid(ettn):
        return {"ok": False, "document_url": "", "via": ""}

    # Kısa doğrulama vs gönderim sonrası GİB DetailStatus bekleme
    if wait_for_gib:
        # ~0+1+2+3+5+8+10+12 ≈ 41s — Ziplenmiş → 1300 (portal advance sonrası)
        delays = (0.0, 1.0, 2.0, 3.0, 5.0, 8.0, 10.0, 12.0)
    else:
        delays = (0.0, 0.8, 1.6, 3.0)[: max(1, int(retries or 1))]
    last_url = ""
    found_no = ""
    found_status = ""
    found_code = ""
    found_detail = ""
    found_process = ""
    via = ""
    found_rank = -1

    def _status_rank(row: Dict[str, Any]) -> int:
        """1300 / DetailStatus, süreç Ziplendi'nin üzerine yazılmasın."""
        code = str(row.get("status_code") or "").strip()
        status = str(row.get("status") or "").strip().lower().replace("ı", "i").replace("İ", "i")
        src = str(row.get("status_source") or "")
        detail = str(row.get("detail_status") or "").strip()
        if code == "1300" or "basariyla tamamland" in status:
            return 100
        if code in ("1220", "1200"):
            return 80
        if "gibe_iletildi" in status or "gib'e iletildi" in status or "gibe iletildi" in status:
            return 75
        if src == "detail" and code and code not in ("1", ""):
            return 60
        if detail and _norm_status_key(detail) not in ("", "zarflanmadi", "1"):
            return 55
        if "ziplen" in status:
            return 15
        if row.get("status"):
            return 30
        return 0

    def _apply_row(row: Dict[str, Any]) -> None:
        nonlocal found_no, found_status, found_code, found_detail, found_process, via, found_rank
        row_no = (row.get("invoice_id") or "").strip()
        if row_no:
            found_no = row_no
        rank = _status_rank(row)
        # Daha iyi GİB DetailStatus (1300) süreç Ziplendi'yi ezmesin diye rank
        if rank >= found_rank and (row.get("status") or row.get("status_code") or row.get("detail_status")):
            found_rank = rank
            if row.get("status"):
                found_status = str(row.get("status") or "").strip()
            if row.get("status_code"):
                found_code = str(row.get("status_code") or "").strip()
            if row.get("detail_status"):
                found_detail = str(row.get("detail_status") or "").strip()
            if row.get("process_status"):
                found_process = str(row.get("process_status") or "").strip()
        elif row.get("process_status") and not found_process:
            found_process = str(row.get("process_status") or "").strip()
        via = via or "search"

    for attempt, delay in enumerate(delays):
        if delay:
            await asyncio.sleep(delay)
        # 1) GetDocumentViewerLink
        try:
            link = await get_document_viewer_link(
                settings, ettn, e_type=e_type, invoice_number=invoice_number or found_no
            )
            last_url = (link.get("url") or link.get("html_url") or link.get("pdf_url") or "").strip()
            if last_url and not via:
                via = "viewer"
        except HTTPException as e:
            logger.info("isnet soft-verify viewer miss ettn=%s try=%s: %s", ettn, attempt + 1, e.detail)

        # 2) Search — önce ETTN ile (yerel TKB filtresi yanlış eşleşmeyi engellemesin)
        try:
            if e_type == "e_dispatch":
                rows = await search_outgoing_despatch(settings, ettn=ettn, invoice_number="")
            elif e_type == "e_archive":
                rows = await search_archive_invoice(settings, ettn=ettn, invoice_number="")
            else:
                rows = await search_outgoing_invoice(settings, ettn=ettn, invoice_number="")
            needle = ettn.lower()
            for row in rows:
                row_ettn = (row.get("ettn") or "").strip().lower()
                row_no = (row.get("invoice_id") or "").strip()
                if row_ettn == needle or (invoice_number and row_no == invoice_number):
                    _apply_row(row)
                    break
            # ETTN satırında no yoksa, istenen local no ile ikinci arama
            if not found_no and invoice_number:
                if e_type == "e_dispatch":
                    rows2 = await search_outgoing_despatch(
                        settings, ettn="", invoice_number=invoice_number
                    )
                elif e_type == "e_archive":
                    rows2 = await search_archive_invoice(
                        settings, ettn="", invoice_number=invoice_number
                    )
                else:
                    rows2 = await search_outgoing_invoice(
                        settings, ettn="", invoice_number=invoice_number
                    )
                for row in rows2:
                    row_ettn = (row.get("ettn") or "").strip().lower()
                    row_no = (row.get("invoice_id") or "").strip()
                    if row_ettn == needle or row_no == invoice_number:
                        _apply_row(row)
                        break
        except HTTPException as e:
            logger.info("isnet soft-verify search miss ettn=%s try=%s: %s", ettn, attempt + 1, e.detail)

        # Fatura no + nihai 1300 → hemen dön.
        # Ziplendi / imza ara durum: wait_for_gib ise DetailStatus için poll devam.
        terminal = found_rank >= 100
        pending_zip = _is_pending_process_status(
            found_process, found_status, found_code
        ) and found_rank < 60
        last_try = attempt >= len(delays) - 1
        if found_no and terminal:
            return {
                "ok": True,
                "document_url": last_url,
                "via": via or "search",
                "invoice_id": found_no,
                "status": found_status,
                "status_code": found_code,
                "detail_status": found_detail,
                "process_status": found_process,
                "attempt": attempt + 1,
            }
        if found_no and last_try:
            break
        if found_no and wait_for_gib and pending_zip:
            continue
        if found_no and not wait_for_gib and not pending_zip:
            return {
                "ok": True,
                "document_url": last_url,
                "via": via or "search",
                "invoice_id": found_no,
                "status": found_status,
                "status_code": found_code,
                "detail_status": found_detail,
                "process_status": found_process,
                "attempt": attempt + 1,
            }

    # Son deneme: viewer varsa soft-ok (no sonra XML/refresh ile tamamlanır)
    if last_url or found_no:
        return {
            "ok": True,
            "document_url": last_url,
            "via": via or ("viewer" if last_url else "search"),
            "invoice_id": found_no,
            "status": found_status,
            "status_code": found_code,
            "detail_status": found_detail,
            "process_status": found_process,
            "attempt": len(delays),
            "pending_gib": _is_pending_process_status(found_process, found_status, found_code)
            and found_rank < 60,
        }

    return {
        "ok": False,
        "document_url": last_url,
        "via": via,
        "invoice_id": found_no,
        "status": found_status,
        "status_code": found_code,
        "detail_status": found_detail,
        "process_status": found_process,
        "pending_gib": True,
    }


async def resolve_invoice_number_from_xml(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
    viewer_url: str = "",
) -> str:
    """Resmi UBL cbc:ID — İşNet'in kestiği fatura numarası."""
    try:
        data = await download_invoice_xml(
            settings,
            ettn,
            e_type=e_type,
            invoice_number=invoice_number,
            viewer_url=viewer_url,
        )
    except Exception as e:
        logger.info("resolve_invoice_number_from_xml failed ettn=%s: %s", ettn, e)
        return ""
    if not data:
        return ""
    try:
        import xml.etree.ElementTree as ET

        root = ET.fromstring(data)
        cbc = "{urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2}"
        el = root.find(f"{cbc}ID")
        return (el.text or "").strip() if el is not None else ""
    except Exception:
        logger.info("resolve_invoice_number_from_xml parse failed ettn=%s", ettn)
        return ""


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


def _isnet_error_snippet(content: bytes = b"", text: str = "") -> str:
    """İşNet HTML/JSON hata gövdesinden kısa Türkçe mesaj ayıkla."""
    raw = (text or "").strip()
    if not raw and content:
        try:
            raw = content.decode("utf-8", errors="ignore")
        except Exception:
            raw = ""
    if not raw:
        return ""
    cleaned = re.sub(r"<[^>]+>", " ", raw)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    # JSON {"detail":"..."} veya ErrorMessage
    try:
        import json

        j = json.loads(raw)
        if isinstance(j, dict):
            for k in ("detail", "ErrorMessage", "Message", "message", "error"):
                if j.get(k):
                    return str(j[k])[:240]
    except Exception:
        pass
    return cleaned[:240]


async def _http_get_invoice_pdf(settings: dict, key: str) -> bytes:
    """NetteFatura-API ile aynı: GetInvoicePdf?key= — key mutlaka URL-encode."""
    from urllib.parse import quote

    key = (key or "").strip()
    if not key:
        raise HTTPException(status_code=404, detail="İşNet PDF anahtarı (key) bulunamadı.")
    # encodeURIComponent ile aynı: + / = bozulmasın (+ query'de boşluk sayılır)
    url = f"{api_base(settings)}/api/Invoice/GetInvoicePdf?key={quote(key, safe='')}"
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
        snippet = _isnet_error_snippet(r.content, getattr(r, "text", "") or "")
        raise HTTPException(
            status_code=502,
            detail=snippet or f"İşNet PDF HTTP {r.status_code}: {(getattr(r, 'text', '') or '')[:200]}",
        )
    ctype = (r.headers.get("content-type") or "").lower()
    if "pdf" not in ctype and not r.content.startswith(b"%PDF"):
        snippet = _isnet_error_snippet(r.content, getattr(r, "text", "") or "")
        raise HTTPException(
            status_code=502,
            detail=snippet
            or "İşNet PDF yanıtı geçersiz (PDF değil). Fatura NetteFatura'da henüz hazır olmayabilir.",
        )
    return bytes(r.content)


def _decode_maybe_b64(payload: str = "", *, prefer_pdf: bool = False) -> bytes:
    """SearchInvoice InvoicePdf/InvoiceHtml — ham veya base64."""
    raw = (payload or "").strip()
    if not raw:
        return b""
    # Zaten PDF / HTML
    if raw.startswith("%PDF") or raw.lstrip().lower().startswith("<!doctype") or raw.lstrip().startswith("<"):
        return raw.encode("utf-8", errors="replace")
    try:
        data = base64.b64decode(raw, validate=False)
    except Exception:
        return raw.encode("utf-8", errors="replace")
    if prefer_pdf and data.startswith(b"%PDF"):
        return data
    if data.startswith(b"%PDF") or data.lstrip().lower().startswith(b"<!doctype") or data.lstrip().startswith(b"<"):
        return data
    # validate=False bazen çöp üretir — orijinal metin HTML olabilir
    if "<html" in raw.lower() or "<!doctype" in raw.lower():
        return raw.encode("utf-8", errors="replace")
    return data if data else b""


def _chrome_bin() -> str:
    for cand in (
        os.environ.get("CHROME_BIN") or "",
        os.environ.get("GOOGLE_CHROME_BIN") or "",
        shutil.which("google-chrome") or "",
        shutil.which("google-chrome-stable") or "",
        shutil.which("chromium") or "",
        shutil.which("chromium-browser") or "",
        "/usr/local/bin/google-chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ):
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return ""


def html_to_pdf_bytes(html: Union[bytes, str], *, timeout: float = 45.0) -> bytes:
    """İşNet InvoiceHtml → PDF (Chrome headless --print-to-pdf).

    Chrome bazen PDF yazdıktan sonra çıkmaz; dosya oluşunca süreç sonlandırılır.
    """
    if isinstance(html, str):
        html_bytes = html.encode("utf-8", errors="replace")
    else:
        html_bytes = html or b""
    if not html_bytes.strip():
        raise HTTPException(status_code=502, detail="İşNet InvoiceHtml boş.")
    chrome = _chrome_bin()
    if not chrome:
        raise HTTPException(
            status_code=502,
            detail="İşNet HTML belgesi alındı ancak PDF dönüştürücü (Chrome) yok.",
        )
    tmp = tempfile.mkdtemp(prefix="isnet-html-pdf-")
    try:
        html_path = os.path.join(tmp, "invoice.html")
        pdf_path = os.path.join(tmp, "invoice.pdf")
        user_data = os.path.join(tmp, "chrome-ud")
        os.makedirs(user_data, exist_ok=True)
        with open(html_path, "wb") as f:
            f.write(html_bytes)
        cmd = [
            chrome,
            "--headless",
            "--disable-gpu",
            "--no-pdf-header-footer",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            f"--user-data-dir={user_data}",
            f"--print-to-pdf={pdf_path}",
            f"file://{html_path}",
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        step = 0.25
        elapsed = 0.0
        while elapsed < timeout:
            if os.path.isfile(pdf_path) and os.path.getsize(pdf_path) > 500:
                time.sleep(0.4)  # yazmanın bitmesi
                break
            if proc.poll() is not None:
                break
            time.sleep(step)
            elapsed += step
        try:
            if proc.poll() is None:
                proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        if not os.path.isfile(pdf_path) or os.path.getsize(pdf_path) < 100:
            err = b""
            try:
                err = (proc.stderr.read() if proc.stderr else b"") or b""
            except Exception:
                pass
            snippet = err.decode("utf-8", errors="ignore")[:200]
            raise HTTPException(
                status_code=502,
                detail=snippet or "İşNet InvoiceHtml PDF'e dönüştürülemedi.",
            )
        with open(pdf_path, "rb") as f:
            data = f.read()
        if not data.startswith(b"%PDF"):
            raise HTTPException(status_code=502, detail="Chrome PDF çıktısı geçersiz.")
        return data
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def _pdf_from_search_documents(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_invoice",
    invoice_number: str = "",
    direction: str = "Outgoing",
) -> Optional[bytes]:
    """GetDocumentViewerLink yokken Search* InvoicePdf / InvoiceHtml → PDF."""
    ettn = (ettn or "").strip()
    inv_no = str(invoice_number or "").strip()
    if not ettn and not inv_no:
        return None
    rows: List[Dict[str, Any]] = []
    try:
        if e_type == "e_archive":
            # Archive search zaten IsHtml/IsPdf açıyor
            rows = await search_archive_invoice(
                settings, ettn=ettn, invoice_number=inv_no or ""
            )
        else:
            rows = await search_outgoing_invoice(
                settings,
                ettn=ettn,
                invoice_number=inv_no or "",
                include_documents=True,
                direction=direction,
            )
    except HTTPException as e:
        logger.info("isnet search-doc miss ettn=%s: %s", ettn, e.detail)
        return None
    needle = ettn.lower()
    match: Optional[Dict[str, Any]] = None
    for row in rows:
        row_ettn = (row.get("ettn") or "").strip().lower()
        row_no = (row.get("invoice_id") or "").strip()
        if (needle and row_ettn == needle) or (inv_no and row_no == inv_no):
            match = row
            break
    if not match and rows and (ettn or inv_no):
        # Tek satır döndüyse kullan
        if len(rows) == 1:
            match = rows[0]
    if not match:
        return None
    pdf_raw = match.get("invoice_pdf") or ""
    if pdf_raw:
        pdf = _decode_maybe_b64(pdf_raw, prefer_pdf=True)
        if pdf.startswith(b"%PDF"):
            logger.info("isnet pdf via Search InvoicePdf ettn=%s", ettn)
            return pdf
    html_raw = match.get("invoice_html") or ""
    if html_raw:
        html = _decode_maybe_b64(html_raw)
        if html and (b"<html" in html.lower() or b"<!doctype" in html.lower() or len(html) > 200):
            logger.info("isnet pdf via Search InvoiceHtml→PDF ettn=%s html=%s", ettn, len(html))
            return await asyncio.to_thread(html_to_pdf_bytes, html)
    return None


async def download_invoice_pdf(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
    viewer_url: str = "",
    direction: str = "Outgoing",
) -> bytes:
    """İşNet resmi e-Fatura/e-Arşiv PDF.

    Sıra:
      1) Kayıtlı viewer key → GetInvoicePdf
      2) GetDocumentViewerLink (vendor: ayar veya U05 serisi)
      3) Search* InvoicePdf / InvoiceHtml→Chrome PDF
         (Zarflanmadı / Ziplenmiş iken viewer boş kalabiliyor)
    """
    errors: List[str] = []
    inv_no = str(invoice_number or "").strip()
    settings = with_inferred_vendor(settings, inv_no)

    async def _try_key_src(key_src: str, label: str) -> Optional[bytes]:
        key = extract_viewer_key(key_src or "")
        if not key:
            return None
        try:
            return await _http_get_invoice_pdf(settings, key)
        except HTTPException as e:
            errors.append(f"{label}: {e.detail}")
            logger.info("isnet pdf miss %s ettn=%s: %s", label, ettn, e.detail)
            return None

    stored = (viewer_url or "").strip()
    if stored:
        out = await _try_key_src(stored, "kayıtlı link")
        if out:
            return out

    ettn = (ettn or "").strip()
    primary = e_type if e_type in ("e_invoice", "e_archive") else "e_archive"
    alt = "e_archive" if primary == "e_invoice" else "e_invoice"
    type_order = [primary, alt]
    inv_nos = [inv_no, ""]
    seen_nos: List[str] = []
    for n in inv_nos:
        if n not in seen_nos:
            seen_nos.append(n)

    for et in type_order:
        for try_no in seen_nos:
            try:
                link = await get_document_viewer_link(
                    settings,
                    ettn,
                    e_type=et,
                    invoice_number=try_no,
                    direction=direction,
                )
            except HTTPException as e:
                errors.append(f"viewer({et}{',no' if try_no else ''}): {e.detail}")
                continue
            candidates = [
                (link.get("pdf_url") or "", "PdfUrl"),
                (link.get("url") or "", "viewer"),
                (link.get("html_url") or "", "HtmlUrl"),
            ]
            seen_keys: set = set()
            for src, label in candidates:
                if not src:
                    continue
                k = extract_viewer_key(src)
                if not k or k in seen_keys:
                    continue
                seen_keys.add(k)
                out = await _try_key_src(src, f"{label}/{et}")
                if out:
                    return out

    # Viewer yok / Zarflanmadı: Search InvoiceHtml (resmi e-belge içeriği)
    for et in type_order:
        try:
            out = await _pdf_from_search_documents(
                settings,
                ettn,
                e_type=et,
                invoice_number=inv_no,
                direction=direction,
            )
            if out:
                return out
        except HTTPException as e:
            errors.append(f"search-doc({et}): {e.detail}")
            logger.info("isnet pdf search-doc miss ettn=%s: %s", ettn, e.detail)

    detail = errors[-1] if errors else "İşNet PDF anahtarı (key) bulunamadı."
    if len(errors) > 1:
        detail = f"{detail} ({len(errors)} deneme)"
    raise HTTPException(status_code=502, detail=detail)


async def download_invoice_xml(
    settings: dict,
    ettn: str,
    *,
    e_type: str = "e_archive",
    invoice_number: str = "",
    viewer_url: str = "",
    direction: str = "Outgoing",
) -> bytes:
    """İşNet DocumentViewer/DownloadXml — resmi UBL-TR (NetteFatura-API).

    PDF ile aynı: kayıtlı link stale olabilir; taze viewer + alternatif tip/no dene.
    """
    errors: List[str] = []

    async def _try_key_src(key_src: str, label: str) -> Optional[bytes]:
        key = extract_viewer_key(key_src or "")
        if not key:
            return None
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
            errors.append(f"{label}: {e}")
            return None
        if r.status_code >= 400 or not r.content:
            errors.append(f"{label}: HTTP {r.status_code}")
            return None
        text = r.content
        head = text[:200].lstrip()
        if head.startswith(b"<") or b"Invoice" in head[:500]:
            return bytes(text)
        errors.append(f"{label}: UBL değil")
        return None

    stored = (viewer_url or "").strip()
    if stored:
        out = await _try_key_src(stored, "kayıtlı link")
        if out:
            return out

    ettn = (ettn or "").strip()
    primary = e_type if e_type in ("e_invoice", "e_archive") else "e_archive"
    alt = "e_archive" if primary == "e_invoice" else "e_invoice"
    inv_nos = [str(invoice_number or "").strip(), ""]
    seen_nos: List[str] = []
    for n in inv_nos:
        if n not in seen_nos:
            seen_nos.append(n)

    for et in [primary, alt]:
        for inv_no in seen_nos:
            try:
                link = await get_document_viewer_link(
                    settings,
                    ettn,
                    e_type=et,
                    invoice_number=inv_no,
                    direction=direction,
                )
            except HTTPException as e:
                errors.append(f"viewer({et}): {e.detail}")
                continue
            candidates = [
                (link.get("url") or "", "viewer"),
                (link.get("html_url") or "", "HtmlUrl"),
                (link.get("pdf_url") or "", "PdfUrl"),
            ]
            seen_keys: set = set()
            for src, label in candidates:
                if not src:
                    continue
                k = extract_viewer_key(src)
                if not k or k in seen_keys:
                    continue
                seen_keys.add(k)
                out = await _try_key_src(src, f"{label}/{et}")
                if out:
                    return out

    detail = errors[-1] if errors else "İşNet XML anahtarı (key) bulunamadı."
    if len(errors) > 1:
        detail = f"{detail} ({len(errors)} deneme)"
    raise HTTPException(status_code=502, detail=detail)


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
                "kind": "invoice",
                "xml": xml_bytes,
                "xml_error": (
                    ""
                    if xml_bytes
                    else ("İşNet XML döndürmedi." if not raw_xml else "İşNet XML çözümlenemedi.")
                ),
            }
        )
    return out


async def _search_despatch_advice_xml(
    settings: dict, *, req_base: dict, ettn: str, direction: str = "Incoming"
) -> Optional[bytes]:
    """ETTN ile tekil SearchDespatchAdvice — tarih aralığı satır/XML vermeyebilir (Dolibarr notu)."""
    if not ettn:
        return None
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="SearchDespatchAdvice",
        service_interface="IInvoiceService",
        request={
            **req_base,
            "DespatchAdviceDirection": direction,
            "Ettn": ettn,
            "PagingRequest": {"PageNumber": 1, "RecordsPerPage": 1},
            "ResultSet": {
                "IsArchiveIncluded": False,
                "IsAttachmentIncluded": False,
                "IsDespatchAdviceDetailIncluded": True,
                "IsExternalUrlIncluded": False,
                "IsHtmlIncluded": False,
                "IsPDFIncluded": False,
                "IsXMLIncluded": True,
            },
        },
        timeout=60.0,
    )
    for adv in _find_all(body, "DespatchAdvice", "DespatchAdviceInfo", "Document"):
        raw_xml = _find_text(
            adv, "DespatchAdviceXML", "XMLContent", "XmlData", "UBL", "InvoiceXML"
        )
        xml_bytes = _decode_xml_payload(raw_xml) if raw_xml else None
        if xml_bytes:
            return xml_bytes
    return None


async def list_incoming_despatch(settings: dict, password: str, days: int = 14) -> List[Dict[str, Any]]:
    """SearchDespatchAdvice (Incoming) — Dolibarr isnetefatura syncDespatch ile aynı operasyon."""
    _ = password
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet gelen e-İrsaliye için şirket VKN (company_tax_id) gerekli."
        )
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=max(1, min(int(days or 14), 90)))
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="SearchDespatchAdvice",
        service_interface="IInvoiceService",
        request={
            **req_base,
            "DespatchAdviceDirection": "Incoming",
            "MaxDespatchAdviceDate": end.strftime("%Y-%m-%d"),
            "MinDespatchAdviceDate": start.strftime("%Y-%m-%d"),
            "PagingRequest": {"PageNumber": 1, "RecordsPerPage": 50},
            "ResultSet": {
                "IsArchiveIncluded": False,
                "IsAttachmentIncluded": False,
                "IsDespatchAdviceDetailIncluded": True,
                "IsExternalUrlIncluded": False,
                "IsHtmlIncluded": False,
                "IsPDFIncluded": False,
                "IsXMLIncluded": True,
            },
        },
        timeout=60.0,
    )
    out: List[Dict[str, Any]] = []
    for adv in _find_all(body, "DespatchAdvice", "DespatchAdviceInfo", "Document"):
        uuid = _find_text(adv, "ETTN", "Ettn", "UUID")
        inv_id = _find_text(adv, "DespatchAdviceNumber", "InvoiceNumber", "InvoiceId", "ID")
        raw_xml = _find_text(
            adv, "DespatchAdviceXML", "XMLContent", "XmlData", "UBL", "InvoiceXML"
        )
        xml_bytes = _decode_xml_payload(raw_xml) if raw_xml else None
        if not xml_bytes and uuid:
            try:
                xml_bytes = await _search_despatch_advice_xml(
                    settings, req_base=req_base, ettn=uuid, direction="Incoming"
                )
            except HTTPException:
                xml_bytes = None
        # Dolibarr: gelen irsaliyede karşı taraf DespatchSupplierParty.Receiver*
        sender_vkn = _find_text(
            adv, "SenderTaxCode", "SenderVKN", "ReceiverTaxCode", "VKN"
        )
        sender_title = _find_text(
            adv, "SenderName", "SenderTitle", "ReceiverName", "Title"
        )
        out.append(
            {
                "uuid": uuid,
                "invoice_id": inv_id,
                "sender_vkn": sender_vkn,
                "sender_title": sender_title,
                "issue_date": _find_text(
                    adv, "DespatchAdviceDate", "InvoiceDate", "IssueDate", "Date"
                ),
                "payable_amount": _find_text(
                    adv, "TotalValueAmount", "PayableAmount", "Payable", "Amount"
                ),
                "profile": _find_text(
                    adv, "DespatchAdviceScenarioType", "ProfileId", "Scenario", "Profile"
                ),
                "status": _find_text(adv, "Status", "State"),
                "kind": "dispatch",
                "xml": xml_bytes,
                "xml_error": (
                    ""
                    if xml_bytes
                    else ("İşNet e-İrsaliye XML döndürmedi." if not raw_xml else "İşNet XML çözümlenemedi.")
                ),
            }
        )
    return out


async def search_outgoing_despatch(
    settings: dict,
    *,
    ettn: str = "",
    invoice_number: str = "",
    min_date: str = "",
    max_date: str = "",
) -> List[Dict[str, Any]]:
    """SearchDespatchAdvice (Outgoing) — giden e-İrsaliye durum/ETTN."""
    req_base = _company_request(settings)
    if len(req_base["CompanyTaxCode"]) not in (10, 11):
        raise HTTPException(
            status_code=400, detail="İşNet giden e-İrsaliye arama için şirket VKN gerekli."
        )
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=90)
    req: Dict[str, Any] = {
        **req_base,
        "DespatchAdviceDirection": "Outgoing",
        "MinDespatchAdviceDate": (min_date or start.strftime("%Y-%m-%d")),
        "MaxDespatchAdviceDate": (max_date or end.strftime("%Y-%m-%d")),
        "PagingRequest": {"PageNumber": 1, "RecordsPerPage": 50},
        "ResultSet": {
            "IsArchiveIncluded": False,
            "IsAttachmentIncluded": False,
            "IsDespatchAdviceDetailIncluded": True,
            "IsExternalUrlIncluded": False,
            "IsHtmlIncluded": False,
            "IsPDFIncluded": False,
            "IsXMLIncluded": False,
        },
    }
    e = (ettn or "").strip()
    no = (invoice_number or "").strip()
    if e:
        req["Ettn"] = e
    if no:
        req["MinDespatchAdviceNumber"] = no
        req["MaxDespatchAdviceNumber"] = no
    body = await _soap_call(
        settings,
        endpoint=soap_url(settings),
        action="SearchDespatchAdvice",
        service_interface="IInvoiceService",
        request=req,
        timeout=60.0,
    )
    out: List[Dict[str, Any]] = []
    for adv in _find_all(body, "DespatchAdvice", "DespatchAdviceInfo", "Document"):
        row = _search_row_from_el(adv)
        # İrsaliye numarası InvoiceNumber yerine DespatchAdviceNumber olabilir
        if not row.get("invoice_id"):
            row["invoice_id"] = _find_text(
                adv, "DespatchAdviceNumber", "InvoiceNumber", "InvoiceId", "ID"
            )
        if not row.get("ettn"):
            row["ettn"] = _find_text(adv, "ETTN", "Ettn", "UUID")
        out.append(row)
    return out


async def list_incoming_all(settings: dict, password: str, days: int = 14) -> List[Dict[str, Any]]:
    """Gelen e-Fatura + e-İrsaliye (Dolibarr: Gelen e-Faturalar / Gelen e-İrsaliyeler)."""
    invoices = await list_incoming(settings, password, days=days)
    try:
        despatches = await list_incoming_despatch(settings, password, days=days)
    except HTTPException as e:
        # e-İrsaliye yetkisi yoksa fatura çekimini bozma
        logger.warning("İşNet SearchDespatchAdvice Incoming atlandı: %s", e.detail)
        despatches = []
    return list(invoices) + list(despatches)
