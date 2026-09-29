"""B2B katalog ürün sorgusu yardımcıları."""
from typing import Any, Dict


def b2b_catalog_mongo_filter(
    company_id: str,
    *,
    require_active: bool = False,
    require_sale_price: bool = False,
) -> Dict[str, Any]:
    """B2B katalog: show_in_b2b açık tüm türler (ticari mal, hammadde, mamul, hizmet)."""
    q: Dict[str, Any] = {
        "company_id": company_id,
        "show_in_b2b": {"$ne": False},
    }
    if require_active:
        q["is_active"] = {"$ne": False}
    if require_sale_price:
        q["sale_price"] = {"$gt": 0}
    return q
