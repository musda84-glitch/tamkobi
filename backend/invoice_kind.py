"""Fatura türü: legacy iade, cari işareti ve stok yönü.

Satış bakiyesi artı, alış bakiyesi eksi kalır.
Satış ve alış iadesi (+) cariyi artırır; alış ve satış iadesi (−) azaltır.
Satış ve alış iadesi stoktan çıkar; alış ve satış iadesi stoğa girer.
"""
from __future__ import annotations

from typing import Any, Optional, Tuple

LEGACY_RETURN_TYPES = frozenset({"return", "iade"})
_SUPPLIER = frozenset({"supplier", "tedarikci", "tedarikçi", "vendor", "satici", "satıcı"})
_CUSTOMER = frozenset({"customer", "musteri", "müşteri", "client", "alici", "alıcı"})
_PURCHASE_DIRECTION = frozenset({"incoming", "purchase", "in", "alis", "alış"})


def _text(value: Any) -> str:
    return str(value or "").strip().lower()


def is_legacy_return(invoice_type: Any) -> bool:
    return _text(invoice_type) in LEGACY_RETURN_TYPES


def _contact_type(contact: Optional[dict]) -> str:
    if not isinstance(contact, dict):
        return ""
    return _text(contact.get("type") or contact.get("contact_type"))


def canonical_invoice_type(invoice: Any, contact: Optional[dict] = None) -> str:
    """`return` / `iade` → tedarikçi alış iadesi, müşteri satış iadesi.

    Cari türü yönün önündedir. `both` ve türsüz kayıtta direction=incoming alış iadesidir.
    Bilinmeyen legacy iade, eski eksi işareti bozmamak için satış iadesi sayılır.
    Satış, alış ve kanonik iade türleri olduğu gibi kalır.
    """
    if isinstance(invoice, dict):
        raw = _text(invoice.get("invoice_type"))
    else:
        raw = _text(invoice)
        invoice = {}
    if raw not in LEGACY_RETURN_TYPES:
        return raw
    ctype = _contact_type(contact) or _text(invoice.get("contact_type"))
    nested = invoice.get("contact")
    if not ctype and isinstance(nested, dict):
        ctype = _contact_type(nested)
    if ctype in _SUPPLIER:
        return "purchase_return"
    if ctype in _CUSTOMER:
        return "sales_return"
    direction = _text(invoice.get("direction"))
    if direction in _PURCHASE_DIRECTION:
        return "purchase_return"
    return "sales_return"


def balance_increases(invoice_type: Any) -> bool:
    """Satış ve alış iadesi cariyi artırır. Alış, satış iadesi ve diğer türler azaltır."""
    return _text(invoice_type) in ("sales", "purchase_return")


def balance_delta(amount: Any, invoice_type: Any) -> float:
    amt = float(amount or 0)
    return amt if balance_increases(invoice_type) else -amt


def stock_delta_sign(invoice_type: Any) -> int:
    """1 stoğa giriş, −1 stoktan çıkış, 0 hareket yok."""
    kind = _text(invoice_type)
    if kind in ("sales", "purchase_return"):
        return -1
    if kind in ("purchase", "sales_return"):
        return 1
    return 0


def stock_reason_label(invoice_type: Any) -> str:
    kind = _text(invoice_type)
    if kind == "sales":
        return "Satış"
    if kind == "purchase":
        return "Alış"
    if kind == "purchase_return":
        return "Alış iadesi"
    if kind == "sales_return":
        return "Satış iadesi"
    return ""


def statement_label_and_sides(invoice_type: Any, total: Any) -> Tuple[str, float, float]:
    """Ekstre etiketi, borç, alacak. İade satırı «İade Faturası»."""
    kind = _text(invoice_type)
    amount = float(total or 0)
    if kind == "purchase_return":
        return "İade Faturası", amount, 0.0
    if kind == "sales_return":
        return "İade Faturası", 0.0, amount
    if kind == "sales":
        return "Satış Faturası", amount, 0.0
    return "Alış Faturası", 0.0, amount
