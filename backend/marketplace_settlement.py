"""Pazaryeri hakediş / kesinti carisi."""
from typing import Optional

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


def marketplace_contact_name(channel: Optional[str] = None) -> str:
    key = (channel or "").strip().lower()
    if key in MARKETPLACE_CONTACT_NAMES:
        return MARKETPLACE_CONTACT_NAMES[key]
    title = (channel or "").strip().title()
    return title or "Pazaryeri"
