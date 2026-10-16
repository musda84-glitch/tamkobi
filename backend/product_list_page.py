"""Ürün / stok listesi sayfası. Salt okunur; stok, maliyet ve hareket yazmaz.

``GET /products`` page ve page_size yokken eskisi gibi bir dizi döner.
İkisi verilirse yanıt ``{items, total, page, page_size, has_more, truncated, summary}`` olur.

Arama (ad, SKU, barkod), kategori, marka, depo, kart durumu, B2B, stok seviyesi
ve sıralama dilimden önce uygulanır. Eşitlikte ikincil anahtar id'dir.
``summary.count``, stok değeri ve adet sayfa diliminin değil, stok seviyesi
dahil filtrelenmiş kümenin tamamıdır. Kritik / sıfır / eksi sayaçları stok
seviyesi filtresinden önceki kümedendir; açılır listedeki adet seçili
seviyeye sıkışmaz.

Depo kovalarındaki adet, ürünün kayıtlı ``stock_quantity`` değeridir
(``track_stock`` kapalı olsa da). Hareket, lot veya transferden yeniden
hesaplanmaz.

``decorate_page`` verilirse yalnız sayfa dilimine uygulanır (lite değilken).
Alış maliyeti bu callback ile eklenir; sayfa dışındaki ürünlere uygulanmaz.
"""
from __future__ import annotations

import copy
from typing import Any, Callable, Dict, List, Optional, Sequence

from fastapi import HTTPException

from b2b_catalog import b2b_catalog_mongo_filter

PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200
FETCH_CAP = 10000
LITE_CAP = 5000
KEYED_CAP = 500

_STATUSES = frozenset({"all", "critical", "out", "in", "untracked", "zero", "negative"})
_ACTIVES = frozenset({"all", "active", "inactive"})
_B2B = frozenset({"all", "yes", "no"})
_SORTS = frozenset({
    "name_asc", "name_desc", "stock_asc", "stock_desc",
    "price_asc", "price_desc", "value_desc", "newest",
})

# Türkçe alfabe sırası. JS localeCompare(..., "tr") birincil sırasına yakın,
# sabit ve yerel ayardan bağımsız.
_TR_ORDER = {
    "a": 1, "b": 2, "c": 3, "ç": 4, "d": 5, "e": 6, "f": 7, "g": 8, "ğ": 9,
    "h": 10, "ı": 11, "i": 12, "j": 13, "k": 14, "l": 15, "m": 16, "n": 17,
    "o": 18, "ö": 19, "p": 20, "r": 21, "s": 22, "ş": 23, "t": 24, "u": 25,
    "ü": 26, "v": 27, "y": 28, "z": 29,
}

LITE_PROJ = {
    "name": 1, "sku": 1, "barcode": 1, "sale_price": 1, "vat_rate": 1, "unit": 1,
    "price_includes_vat": 1,
    "image_url": 1, "thumbnail_url": 1, "images": 1, "company_id": 1, "type": 1, "is_active": 1,
    "stock_quantity": 1, "min_stock_alert": 1, "track_stock": 1, "has_recipe": 1,
    "purchase_price": 1, "category": 1,
}


def clamp_page(page: Any) -> int:
    try:
        n = int(page)
    except (TypeError, ValueError):
        return 1
    return n if n >= 1 else 1


def clamp_page_size(page_size: Any) -> int:
    if page_size is None or page_size == "":
        return PAGE_SIZE_DEFAULT
    try:
        n = int(page_size)
    except (TypeError, ValueError):
        return PAGE_SIZE_DEFAULT
    if n < 1:
        return PAGE_SIZE_DEFAULT
    return n if n <= PAGE_SIZE_MAX else PAGE_SIZE_MAX


def product_id(product: dict) -> str:
    return str((product or {}).get("id") or (product or {}).get("_id") or "")


def js_lower(value: Any) -> str:
    """JS String.toLowerCase() (Unicode varsayılanı; tr-TR değil)."""
    return str(value or "").lower()


def js_num(value: Any) -> float:
    """JS ``value || 0`` sonra sayıya zorlama. Boş, false ve NaN 0'dır."""
    if value is None or value is False or value == "":
        return 0.0
    if value is True:
        return 1.0
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    if n != n:
        return 0.0
    return n


def stock_alert_min(product: dict) -> float:
    """Min stok boşsa panel eşiği 5. Bilinçli 0 olduğu gibi kalır."""
    if not isinstance(product, dict) or "min_stock_alert" not in product:
        return 5.0
    raw = product.get("min_stock_alert")
    if raw is None or raw == "":
        return 5.0
    try:
        n = float(raw)
    except (TypeError, ValueError):
        return 5.0
    if n != n:
        return 5.0
    return n


def is_tracked(product: dict) -> bool:
    return (product or {}).get("track_stock") is not False


def is_critical(product: dict) -> bool:
    return is_tracked(product) and js_num((product or {}).get("stock_quantity")) <= stock_alert_min(product)


def stock_value_of(product: dict) -> float:
    """Panel: takip kapalıysa 0, değilse (adet || 0) * (alış || 0)."""
    if not is_tracked(product):
        return 0.0
    return js_num((product or {}).get("stock_quantity")) * js_num((product or {}).get("purchase_price"))


def tr_sort_key(value: Any) -> tuple:
    parts = []
    for ch in str(value or ""):
        folded = ch.lower()
        if folded == "i\u0307":
            folded = "i"
        order = _TR_ORDER.get(folded)
        if order is None:
            parts.append((1, ord(ch)))
        else:
            parts.append((0, order, 0 if ch.isupper() else 1))
    return tuple(parts)


class _Desc:
    """Birincil anahtar azalan, yanındaki id artan kalsın diye."""

    def __init__(self, value: Any):
        self.value = value

    def __lt__(self, other: "_Desc") -> bool:
        return self.value > other.value

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _Desc) and self.value == other.value


def normalize_status(status: Any) -> str:
    flag = str(status or "all").strip().lower() or "all"
    if flag not in _STATUSES:
        raise HTTPException(status_code=400, detail="status all, critical, out, in, untracked, zero veya negative olmalı.")
    return flag


def normalize_active(active: Any) -> str:
    flag = str(active or "all").strip().lower() or "all"
    if flag not in _ACTIVES:
        raise HTTPException(status_code=400, detail="active all, active veya inactive olmalı.")
    return flag


def normalize_b2b(b2b: Any) -> str:
    flag = str(b2b or "all").strip().lower() or "all"
    if flag not in _B2B:
        raise HTTPException(status_code=400, detail="b2b all, yes veya no olmalı.")
    return flag


def normalize_sort(sort: Any) -> str:
    flag = str(sort or "name_asc").strip().lower() or "name_asc"
    if flag not in _SORTS:
        raise HTTPException(status_code=400, detail="sort name_asc, name_desc, stock_asc, stock_desc, price_asc, price_desc, value_desc veya newest olmalı.")
    return flag


def _blank(value: Any) -> bool:
    return value is None or str(value).strip() == "" or str(value).strip().lower() == "all"


def matches_search(product: dict, q: str) -> bool:
    """Ad ve SKU küçük harf; barkod paneldeki gibi olduğu gibi."""
    raw = "" if q is None else str(q)
    if raw == "":
        return True
    needle = js_lower(raw)
    if needle in js_lower((product or {}).get("name") or ""):
        return True
    if needle in js_lower((product or {}).get("sku") or ""):
        return True
    return raw in str((product or {}).get("barcode") or "")


def matches_category(product: dict, category: Any) -> bool:
    if _blank(category):
        return True
    return str((product or {}).get("category") or "") == str(category)


def matches_brand(product: dict, brand: Any) -> bool:
    if _blank(brand):
        return True
    return js_lower((product or {}).get("brand") or "") == js_lower(brand)


def matches_warehouse(product: dict, warehouse_id: Any) -> bool:
    if _blank(warehouse_id):
        return True
    return str((product or {}).get("warehouse_id") or "") == str(warehouse_id)


def matches_active(product: dict, active: str) -> bool:
    if active == "all":
        return True
    on = (product or {}).get("is_active") is not False
    if active == "active":
        return on
    return not on


def matches_b2b(product: dict, b2b: str) -> bool:
    if b2b == "all":
        return True
    visible = (product or {}).get("show_in_b2b") is not False
    if b2b == "yes":
        return visible
    return not visible


def matches_status(product: dict, status: str) -> bool:
    if status == "all":
        return True
    tracked = is_tracked(product)
    qty = js_num((product or {}).get("stock_quantity"))
    if status == "critical":
        return is_critical(product)
    if status == "out":
        return tracked and qty <= 0
    if status == "in":
        return tracked and qty > 0
    if status == "untracked":
        return not tracked
    if status == "zero":
        return tracked and qty == 0
    if status == "negative":
        return tracked and qty < 0
    return True


def sort_products(rows: Sequence[dict], sort: str) -> List[dict]:
    """Birincil anahtar, eşitlikte id artan."""
    items = list(rows or [])
    sort_n = normalize_sort(sort)

    def pid(row):
        return product_id(row)

    if sort_n == "name_asc":
        return sorted(items, key=lambda p: (tr_sort_key(p.get("name")), pid(p)))
    if sort_n == "name_desc":
        return sorted(items, key=lambda p: (_Desc(tr_sort_key(p.get("name"))), pid(p)))
    if sort_n == "stock_asc":
        return sorted(items, key=lambda p: (js_num(p.get("stock_quantity")), pid(p)))
    if sort_n == "stock_desc":
        return sorted(items, key=lambda p: (-js_num(p.get("stock_quantity")), pid(p)))
    if sort_n == "price_asc":
        return sorted(items, key=lambda p: (js_num(p.get("sale_price")), pid(p)))
    if sort_n == "price_desc":
        return sorted(items, key=lambda p: (-js_num(p.get("sale_price")), pid(p)))
    if sort_n == "value_desc":
        return sorted(items, key=lambda p: (-(js_num(p.get("stock_quantity")) * js_num(p.get("purchase_price"))), pid(p)))
    return sorted(items, key=lambda p: (_Desc(str(p.get("created_at") or "")), pid(p)))


def facet_counts(rows: Sequence[dict]) -> dict:
    counts = {"critical": 0, "zero": 0, "negative": 0}
    for row in rows or []:
        if is_critical(row):
            counts["critical"] += 1
        qty = js_num(row.get("stock_quantity"))
        if is_tracked(row) and qty == 0:
            counts["zero"] += 1
        if is_tracked(row) and qty < 0:
            counts["negative"] += 1
    return counts


def warehouse_quantities(rows: Sequence[dict]) -> Dict[str, float]:
    """Depo -> kayıtlı adet toplamı. Yeniden hesap yok."""
    buckets: Dict[str, float] = {}
    for row in rows or []:
        wid = str(row.get("warehouse_id") or "")
        buckets[wid] = buckets.get(wid, 0.0) + js_num(row.get("stock_quantity"))
    return {key: round(buckets[key], 4) for key in sorted(buckets)}


def distinct_brands(rows: Sequence[dict]) -> List[str]:
    seen = []
    for row in rows or []:
        brand = str(row.get("brand") or "").strip()
        if brand and brand not in seen:
            seen.append(brand)
    return sorted(seen, key=lambda name: (tr_sort_key(name), name))


def summarize(rows: Sequence[dict], facets: dict, brands: Sequence[str]) -> dict:
    ordered = list(rows or [])
    value = 0.0
    qty = 0.0
    for row in ordered:
        value += stock_value_of(row)
        if is_tracked(row):
            qty += js_num(row.get("stock_quantity"))
    facets = facets or {}
    return {
        "count": len(ordered),
        "stock_value": round(value, 2),
        "quantity_total": round(qty, 4),
        "critical_count": int(facets.get("critical") or 0),
        "zero_count": int(facets.get("zero") or 0),
        "negative_count": int(facets.get("negative") or 0),
        "warehouse_quantities": warehouse_quantities(ordered),
        "brands": list(brands or []),
    }


def public_docs(docs: Sequence[dict]) -> List[dict]:
    out = []
    for doc in docs or []:
        if not isinstance(doc, dict):
            continue
        row = copy.deepcopy(doc)
        if "_id" in row:
            row["id"] = str(row.pop("_id"))
        elif row.get("id") is not None:
            row["id"] = str(row["id"])
        for secret in ("b2b_password_hash", "password_hash", "shopfloor_pin_hash", "cashier_pin_hash", "punch_pin_hash"):
            row.pop(secret, None)
        out.append(row)
    return out


def _split_keys(raw: Optional[str]) -> List[str]:
    return [x.strip() for x in (raw or "").split(",") if x.strip()]


def product_query(
    company_id: str,
    *,
    category: Optional[str] = None,
    type: Optional[str] = None,
    b2b_only: bool = False,
    ids: Optional[str] = None,
    skus: Optional[str] = None,
) -> dict:
    """Sayfasız ``GET /products`` sorgusu ile aynı daraltma."""
    cid = str(company_id or "")
    query: Dict[str, Any] = {"company_id": cid}
    if b2b_only:
        query.update(b2b_catalog_mongo_filter(cid, require_active=True, require_sale_price=True))
    if category and str(category) != "all":
        query["category"] = category
    if type and str(type) != "all":
        query["type"] = type
    id_list = _split_keys(ids)
    sku_list = _split_keys(skus)
    if id_list and sku_list:
        query["$or"] = [{"_id": {"$in": id_list}}, {"sku": {"$in": sku_list}}]
    elif id_list:
        query["_id"] = {"$in": id_list}
    elif sku_list:
        query["sku"] = {"$in": sku_list}
    return query


def fetch_limit(*, lite: bool, ids: Optional[str], skus: Optional[str]) -> int:
    id_list = _split_keys(ids)
    sku_list = _split_keys(skus)
    if id_list or sku_list:
        return min(max(len(id_list) + len(sku_list), 1), KEYED_CAP)
    return LITE_CAP if lite else FETCH_CAP


async def fetch_product_rows(
    db,
    company_id: str,
    *,
    category: Optional[str] = None,
    type: Optional[str] = None,
    b2b_only: bool = False,
    lite: bool = False,
    ids: Optional[str] = None,
    skus: Optional[str] = None,
) -> tuple:
    """Şirket ürünleri. Üst sınır aşılırsa truncated. Yazmaz."""
    cid = str(company_id or "")
    cap = fetch_limit(lite=lite, ids=ids, skus=skus)
    query = product_query(cid, category=category, type=type, b2b_only=b2b_only, ids=ids, skus=skus)
    proj = LITE_PROJ if lite else None
    fetched = await db.products.find(query, proj).to_list(cap + 1)
    truncated = len(fetched or []) > cap
    rows = []
    for row in (fetched or [])[:cap]:
        if isinstance(row, dict) and str(row.get("company_id") or "") == cid:
            rows.append(row)
    return rows, truncated


def _clean(docs: Sequence[dict], clean: Optional[Callable]) -> List[dict]:
    copied = [copy.deepcopy(doc) for doc in docs or [] if isinstance(doc, dict)]
    fn = clean or public_docs
    return [row for row in fn(copied) if isinstance(row, dict)]


def apply_view(
    docs: Sequence[dict],
    *,
    q: str = "",
    category: Any = None,
    brand: Any = None,
    warehouse_id: Any = None,
    active: str = "all",
    b2b: str = "all",
    status: str = "all",
    sort: str = "name_asc",
) -> dict:
    """Arama ve filtre, sonra stok seviyesi, sonra sıralama."""
    active_n = normalize_active(active)
    b2b_n = normalize_b2b(b2b)
    status_n = normalize_status(status)
    sort_n = normalize_sort(sort)
    pre_brand = []
    for row in docs or []:
        if not matches_search(row, q or ""):
            continue
        if not matches_category(row, category):
            continue
        if not matches_warehouse(row, warehouse_id):
            continue
        if not matches_active(row, active_n):
            continue
        if not matches_b2b(row, b2b_n):
            continue
        pre_brand.append(row)
    base = [row for row in pre_brand if matches_brand(row, brand)]
    facets = facet_counts(base)
    brands = distinct_brands(pre_brand)
    chosen = [row for row in base if matches_status(row, status_n)]
    ordered = sort_products(chosen, sort_n)
    return {
        "rows": ordered,
        "base": base,
        "summary": summarize(ordered, facets, brands),
    }


async def list_products_unpaged(
    db,
    company_id: str,
    *,
    category: Optional[str] = None,
    type: Optional[str] = None,
    b2b_only: bool = False,
    lite: bool = False,
    ids: Optional[str] = None,
    skus: Optional[str] = None,
    q: str = "",
    brand: str = "",
    warehouse_id: str = "",
    active: str = "all",
    b2b: str = "all",
    status: str = "all",
    sort: str = "name_asc",
    clean: Optional[Callable] = None,
) -> List[dict]:
    """Aynı filtre ve sıra ile sayfasız küme. Yazmaz.

    HTTP'de page yokken dönen dizi bu fonksiyon değildir; o yol eski gövdedir.
    """
    rows, _truncated = await fetch_product_rows(
        db, company_id, category=category, type=type, b2b_only=b2b_only, lite=lite, ids=ids, skus=skus,
    )
    docs = _clean(rows, clean)
    return apply_view(
        docs, q=q or "", category=category, brand=brand, warehouse_id=warehouse_id,
        active=active, b2b=b2b, status=status, sort=sort,
    )["rows"]


async def list_products_paged(
    db,
    company_id: str,
    *,
    page: Any = 1,
    page_size: Any = None,
    category: Optional[str] = None,
    type: Optional[str] = None,
    b2b_only: bool = False,
    lite: bool = False,
    ids: Optional[str] = None,
    skus: Optional[str] = None,
    q: str = "",
    brand: str = "",
    warehouse_id: str = "",
    active: str = "all",
    b2b: str = "all",
    status: str = "all",
    sort: str = "name_asc",
    export: bool = False,
    clean: Optional[Callable] = None,
    decorate_page: Optional[Callable] = None,
) -> dict:
    """Sayfa döner. products yazılmaz.

    lite değilse ve dilim doluysa ``decorate_page`` yalnız o dilimi görür.
    """
    exporting = bool(export)
    if exporting:
        size = fetch_limit(lite=lite, ids=ids, skus=skus)
        page_n = 1
    else:
        size = clamp_page_size(page_size)
        page_n = clamp_page(page)
    rows, truncated = await fetch_product_rows(
        db, company_id, category=category, type=type, b2b_only=b2b_only, lite=lite, ids=ids, skus=skus,
    )
    docs = _clean(rows, clean)
    view = apply_view(
        docs, q=q or "", category=category, brand=brand, warehouse_id=warehouse_id,
        active=active, b2b=b2b, status=status, sort=sort,
    )
    ordered = view["rows"]
    total = len(ordered)
    start = (page_n - 1) * size
    if start >= total and total > 0:
        page_rows: List[dict] = []
    else:
        page_rows = ordered[start:start + size]
    if decorate_page is not None and page_rows and not lite:
        decorated = await decorate_page(page_rows, company_id=str(company_id or ""))
        page_rows = [row for row in (decorated or []) if isinstance(row, dict)]
    summary = dict(view["summary"])
    return {
        "items": page_rows,
        "total": total,
        "page": page_n,
        "page_size": size,
        "has_more": start + len(page_rows) < total,
        "truncated": bool(truncated),
        "summary": summary,
    }


async def list_products_for_user(db, user: dict, company_id: Optional[str] = None, *, paged: bool = False, **kwargs) -> Any:
    """company_id kullanıcının erişimindeki şirketle çözülür; başka şirket 403."""
    import tenant_access

    cid = tenant_access.resolve_company_id(user, company_id)
    if paged:
        return await list_products_paged(db, cid, **kwargs)
    return await list_products_unpaged(db, cid, **kwargs)
