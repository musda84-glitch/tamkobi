"""Hesap türü ve görünen etiket. Tam IBAN/hesap no yazılmaz; son 4 hane maskelenir."""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional

ELLIPSIS = "…"

ACCOUNT_TYPE_TR = {
    "bank": "Banka hesabı",
    "banka": "Banka hesabı",
    "cash_box": "Kasa",
    "cash": "Kasa",
    "kasa": "Kasa",
    "cashbox": "Kasa",
    "nakit": "Kasa",
    "pos": "POS",
    "okc_pos": "ÖKC",
    "okc": "ÖKC",
    "credit_card": "Kredi kartı",
    "kart": "Kredi kartı",
    "card": "Kredi kartı",
}

_IBAN_RE = re.compile(r"^TR[A-Z0-9]{13,}$")


def norm_ref(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def is_iban(value: Any) -> bool:
    return bool(_IBAN_RE.match(norm_ref(value)))


def account_type_label(typ: Any) -> str:
    key = str(typ or "").strip().lower()
    if not key:
        return ""
    return ACCOUNT_TYPE_TR.get(key, key)


def masked_ref(value: Any) -> str:
    """IBAN veya hesap no'nun son 4 hanesi. Tam değer dönmez."""
    token = norm_ref(value)
    if not token or token == "-":
        return ""
    return f"{ELLIPSIS}{token[-4:]}"


def account_masked_ref(acc: Optional[dict]) -> str:
    acc = acc or {}
    preset = str(acc.get("masked_ref") or "").strip()
    if preset:
        return preset
    if is_iban(acc.get("iban")):
        return masked_ref(acc.get("iban"))
    number = norm_ref(acc.get("account_number"))
    if number and number != "-":
        return masked_ref(number)
    return ""


def account_display_label(acc: Optional[dict], *, integrated: bool = False) -> str:
    """Ör. Kuveyt Türk · Vadesiz TL Hesabı · …1234 · entegre"""
    acc = acc or {}
    bank = str(acc.get("bank_name") or "").strip()
    name = str(acc.get("account_name") or acc.get("name") or acc.get("ad") or "").strip()
    ref = account_masked_ref(acc)
    parts = []
    if bank:
        parts.append(bank)
    if name and name != bank:
        parts.append(name)
    elif not parts and name:
        parts.append(name)
    if ref:
        parts.append(ref)
    if integrated or acc.get("is_integrated") or acc.get("entegre_mi"):
        parts.append("entegre")
    return " · ".join(parts) or (name or bank or "Hesap")


def duplicate_ref_message(noun: str, accounts: Iterable[dict], masked: str) -> str:
    """Uyarıda banka adı ve son 4 hane; tam IBAN/hesap no yok."""
    rows = list(accounts or [])
    bits = []
    for acc in rows:
        bank = str((acc or {}).get("bank_name") or "").strip() or "Hesap"
        bit = f"{bank} · {masked}" if masked else bank
        if bit not in bits:
            bits.append(bit)
    count = len(rows) or 0
    shown = ", ".join(bits)
    if shown:
        return f"Aynı {noun} {count} hesaba bağlı: {shown}."
    return f"Aynı {noun} {count} hesaba bağlı."
