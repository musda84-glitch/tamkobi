"""Herkese açık site / yasal satıcı bilgisi — platform ayarı + ortam değişkeni."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

# Platform ayarı anahtarları (admin paneli) ↔ yasal şablon alanları
LEGAL_SETTING_KEYS = (
    "legal_name",
    "legal_address",
    "legal_city",
    "legal_tax_number",
    "legal_tax_office",
    "legal_mersis",
    "legal_iban",
    "legal_bank_name",
    "legal_phone",
    "legal_email",
    "legal_website",
)

ENV_MAP = {
    "legal_name": "PLATFORM_LEGAL_NAME",
    "legal_address": "PLATFORM_LEGAL_ADDRESS",
    "legal_city": "PLATFORM_LEGAL_CITY",
    "legal_tax_number": "PLATFORM_LEGAL_TAX_NUMBER",
    "legal_tax_office": "PLATFORM_LEGAL_TAX_OFFICE",
    "legal_mersis": "PLATFORM_LEGAL_MERSIS",
    "legal_iban": "PLATFORM_LEGAL_IBAN",
    "legal_bank_name": "PLATFORM_LEGAL_BANK_NAME",
    "legal_phone": "PLATFORM_LEGAL_PHONE",
    "legal_email": "PLATFORM_SUPPORT_EMAIL",
    "legal_website": "PLATFORM_PUBLIC_URL",
    "support_email": "PLATFORM_SUPPORT_EMAIL",
    "support_phone": "PLATFORM_SUPPORT_PHONE",
    "support_whatsapp": "PLATFORM_SUPPORT_WHATSAPP",
    "public_url": "PLATFORM_PUBLIC_URL",
    "brand_name": "PLATFORM_BRAND_NAME",
}


def _env(key: str) -> str:
    return (os.environ.get(ENV_MAP.get(key, key)) or "").strip()


def _pick(*vals: Any) -> str:
    for v in vals:
        s = str(v or "").strip()
        if s and s != "—":
            return s
    return ""


def merge_seller(
    company: Optional[dict],
    settings: Optional[dict],
    brand: str = "",
    *,
    use_company_party: bool = True,
) -> dict:
    """Platform yasal ayarları > (isteğe bağlı şirket) > ortam değişkeni > marka adı.

    use_company_party=False: vitrin /yasal — demo şirket (comp_nexus_main_01) ünvanı sızmaz.
    """
    c = company or {} if use_company_party else {}
    st = settings or {}
    brand = _pick(st.get("brand_name"), brand, _env("brand_name"), "TamKobi")
    name = _pick(st.get("legal_name"), c.get("name"), _env("legal_name"), brand)
    address = _pick(
        st.get("legal_address"),
        ", ".join(x for x in [(c.get("address") or "").strip(), (c.get("city") or "").strip()] if x),
        _env("legal_address"),
    )
    city = _pick(st.get("legal_city"), c.get("city"), _env("legal_city"))
    tax_number = _pick(st.get("legal_tax_number"), c.get("tax_number"), c.get("tax_number_or_id"), _env("legal_tax_number"))
    tax_office = _pick(st.get("legal_tax_office"), c.get("tax_office"), _env("legal_tax_office"))
    email = _pick(st.get("legal_email"), st.get("support_email"), c.get("email"), _env("legal_email"), _env("support_email"))
    phone = _pick(st.get("legal_phone"), st.get("support_phone"), c.get("phone"), _env("legal_phone"), _env("support_phone"))
    mersis = _pick(st.get("legal_mersis"), c.get("mersis"), _env("legal_mersis"))
    website = _pick(st.get("legal_website"), st.get("public_url"), c.get("website"), _env("legal_website"), _env("public_url"))
    iban = _pick(st.get("legal_iban"), c.get("iban"), _env("legal_iban"))
    bank_name = _pick(st.get("legal_bank_name"), c.get("bank_name"), _env("legal_bank_name"))
    return {
        "name": name or brand or "Satıcı",
        "address": address or "—",
        "city": city or "—",
        "tax_number": tax_number or "—",
        "tax_office": tax_office or "—",
        "email": email or "—",
        "phone": phone or "—",
        "mersis": mersis or "—",
        "website": website,
        "iban": iban or "—",
        "bank_name": bank_name or "—",
    }


def public_contact(settings: Optional[dict]) -> Dict[str, str]:
    st = settings or {}
    # WhatsApp yalnızca kendi alanı / env — support_phone’a düşmez (buton gizlensin).
    return {
        "support_email": _pick(st.get("support_email"), st.get("legal_email"), _env("support_email")),
        "support_phone": _pick(st.get("support_phone"), st.get("legal_phone"), _env("support_phone")),
        "support_whatsapp": _pick(st.get("support_whatsapp"), _env("support_whatsapp")),
        "public_url": _pick(st.get("public_url"), _env("public_url"), "https://tamkobi.com").rstrip("/"),
        "brand_name": _pick(st.get("brand_name"), _env("brand_name"), "TamKobi"),
    }


def normalize_whatsapp(raw: str) -> str:
    """wa.me için yalnızca rakam (ülke kodu dahil)."""
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if not digits:
        return ""
    if digits.startswith("0") and len(digits) >= 10:
        digits = "90" + digits.lstrip("0")
    if len(digits) == 10:
        digits = "90" + digits
    return digits
