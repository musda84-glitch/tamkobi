"""Pazaryeri hakediş / kesinti carisi."""
from typing import Any, Dict, Optional

MARKETPLACE_CONTACT_NAMES = {
    "trendyol": "Trendyol",
    "hepsiburada": "Hepsiburada",
    "amazon": "Amazon",
    "n11": "n11",
    "shopify": "Shopify",
    "woocommerce": "WooCommerce",
    "ciceksepeti": "Çiçeksepeti",
    "shopphp": "ShopPHP",
}

# Sipariş iptal / iade durumunda hakediş hareketleri geri alınır.
SETTLEMENT_REVERSE_STATUSES = frozenset({
    "cancelled",
    "canceled",
    "returned",
    "partially_returned",
})


def marketplace_contact_name(channel: Optional[str] = None) -> str:
    key = (channel or "").strip().lower()
    if key in MARKETPLACE_CONTACT_NAMES:
        return MARKETPLACE_CONTACT_NAMES[key]
    title = (channel or "").strip().title()
    return title or "Pazaryeri"


def should_reverse_settlement_on_status(status: Optional[str] = None) -> bool:
    return (status or "").strip().lower() in SETTLEMENT_REVERSE_STATUSES


def is_marketplace_settlement_tx(tx: Optional[Dict[str, Any]] = None) -> bool:
    """Hakediş tahsilatı veya pazaryeri kesinti ledger satırı mı?"""
    if not tx:
        return False
    src = (tx.get("source") or "").strip().lower()
    cat = (tx.get("category") or "").strip()
    if src == "marketplace_settlement":
        return True
    if cat == "Pazaryeri Hakedişi":
        return True
    if src == "ledger" and cat == "Pazaryeri Kesintisi":
        return True
    return False
