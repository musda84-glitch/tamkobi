"""Fatura alıcı VKN/TCKN: belgede gerçek kimlik varsa o, yoksa cari kartı.

Yer tutucu (11111111111 vb.) belge VKN'si cariyi ezmez. Cari is_e_invoice_user
karar vermez. Modal ve issue_invoice aynı sırayı kullanır.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

from contact_tax import is_placeholder_tax_id

DOC_TAX_FIELDS = (
    "contact_tax_id",
    "buyer_tax_id",
    "customer_tax_id",
    "tax_number_or_id",
    "tax_id",
)
CONTACT_TAX_FIELDS = (
    "tax_number_or_id",
    "tax_id",
    "tax_number",
    "vkn",
    "tckn",
)


def digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def first_tax_digits(src: Optional[dict], fields: tuple) -> str:
    card = src or {}
    for key in fields:
        d = digits(card.get(key))
        if d:
            return d
    return ""


def usable_tax(raw: Any) -> str:
    """Boş veya yer tutucu değilse rakamlar; aksi halde boş."""
    d = digits(raw)
    if not d or is_placeholder_tax_id(d):
        return ""
    return d


def contact_card_tax_id(contact: Optional[dict] = None) -> str:
    """Cari kartında ilk dolu VKN/TCKN (yalnız rakam)."""
    return first_tax_digits(contact, CONTACT_TAX_FIELDS)


def invoice_contact_tax_id(contact: Optional[dict] = None) -> str:
    """Sipariş→fatura: cari VKN'si, yoksa perakende yer tutucu."""
    return contact_card_tax_id(contact) or "11111111111"


# Kartta kayıtlı GİB / e-fatura mükellef ünvanı. company_title (ticari ünvan) ayrıdır.
_GIB_TITLE_KEYS = (
    "gib_title",
    "einvoice_title",
    "e_invoice_title",
    "taxpayer_title",
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def gib_buyer_title(contact: Optional[dict] = None, explicit: Any = None) -> str:
    """Kartta veya çağıranın elindeki GİB/e-fatura ünvanı. Canlı sorgu yapmaz."""
    given = _text(explicit)
    if given:
        return given
    card = contact or {}
    for key in _GIB_TITLE_KEYS:
        title = _text(card.get(key))
        if title:
            return title
    return ""


def invoice_buyer_name(
    contact: Optional[dict] = None,
    *,
    gib_title: Any = None,
    fallback: Any = "",
    tax_id: Any = None,
) -> str:
    """Fatura alıcı adı / ünvanı.

    Ticari ünvan (company_title) doluysa o yazılır, cari adı yazılmaz.
    Ticari ünvan boş ve gerçek VKN/TCKN (kart veya belge) varsa kayıtlı
    GİB/e-fatura ünvanı kullanılır; o da yoksa mevcut davranış (cari adı) kalır.
    Yer tutucu kimlik GİB ünvanına zorlamaz.
    """
    card = contact or {}
    commercial = _text(card.get("company_title"))
    if commercial:
        return commercial
    has_real_tax = bool(usable_tax(contact_card_tax_id(card)) or usable_tax(tax_id))
    if has_real_tax:
        official = gib_buyer_title(card, gib_title)
        if official:
            return official
    person = _text(card.get("name"))
    if person:
        return person
    return _text(fallback)


def _target_get(target: Any, key: str) -> Any:
    if isinstance(target, dict):
        return target.get(key)
    return getattr(target, key, None)


def _target_set(target: Any, key: str, value: Any) -> None:
    if isinstance(target, dict):
        target[key] = value
    else:
        setattr(target, key, value)


def stamp_invoice_buyer(
    target: Any,
    contact: Optional[dict] = None,
    *,
    gib_title: Any = None,
) -> None:
    """Yeni fatura belgesine alıcı ünvanı, boşsa VKN ve adresi yazar.

    Ticari ünvan veya kayıtlı GİB ünvanı varsa contact_name onunla değişir.
    İkisi de yoksa formdan gelen ad korunur. Mevcut fatura kaydını okuyup
    güncellemez; çağıran yeni belgeyi doldurur.
    """
    if target is None or not contact:
        return
    doc_tax = _target_get(target, "contact_tax_id")
    resolved = invoice_buyer_name(
        contact,
        gib_title=gib_title,
        fallback=_target_get(target, "contact_name") or "",
        tax_id=doc_tax,
    )
    commercial = _text(contact.get("company_title"))
    has_real_tax = bool(usable_tax(contact_card_tax_id(contact)) or usable_tax(doc_tax))
    official = gib_buyer_title(contact, gib_title) if has_real_tax else ""
    current = _text(_target_get(target, "contact_name"))
    if resolved and (commercial or official or not current):
        _target_set(target, "contact_name", resolved)
    card_tax = usable_tax(contact_card_tax_id(contact))
    current_tax = _text(_target_get(target, "contact_tax_id"))
    if card_tax and not usable_tax(current_tax):
        _target_set(target, "contact_tax_id", card_tax)
    street = _text(contact.get("address"))
    if street and street != "-":
        ship = _text(_target_get(target, "shipping_address"))
        if not ship or ship == "-":
            _target_set(target, "shipping_address", street)
    city = _text(contact.get("city"))
    if city and city != "-":
        current_city = _text(_target_get(target, "city"))
        if not current_city or current_city == "-":
            _target_set(target, "city", city)


def buyer_tax_choice(doc: Optional[dict], contact: Optional[dict] = None) -> Dict[str, Any]:
    """Sorgu VKN'si: belgede gerçek kimlik varsa o, değilse cari.

    Belge VKN'si boş veya yer tutucu ise cariye düşülür. Yer tutucu yalnız
    ikisi de boş/yer tutucu ise. mismatch yalnız ikisi de gerçek ve farklıysa.
    """
    src = doc or {}
    card = contact or {}
    doc_raw = first_tax_digits(src, DOC_TAX_FIELDS)
    contact_raw = contact_card_tax_id(card)
    doc_real = usable_tax(doc_raw)
    contact_real = usable_tax(contact_raw)
    if doc_real:
        tax, source = doc_real, "Belge"
    elif contact_real:
        tax, source = contact_real, "Cari"
    else:
        tax, source = "", ""
    return {
        "tax": tax,
        "doc_tax": doc_raw,
        "contact_tax": contact_raw,
        "mismatch": bool(doc_real and contact_real and doc_real != contact_real),
        "source": source,
        "placeholder": not doc_real and not contact_real,
    }
