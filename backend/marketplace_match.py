"""Pazaryeri ürün satırı → stok kartı akıllı eşleşme önerileri."""
from __future__ import annotations

import difflib
import re
from typing import Any, Dict, List, Optional


def norm_code(val: Any) -> str:
    s = re.sub(r"[^A-Z0-9]+", "", str(val or "").strip().upper())
    return s


def norm_text(val: Any) -> str:
    s = str(val or "").strip().lower()
    s = re.sub(r"[^a-z0-9ğüşıöç\s]+", " ", s, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", s).strip()


def score_row_product(row: Optional[dict], product: Optional[dict]) -> float:
    if not row or not product:
        return 0.0
    row_codes = [norm_code(x) for x in (row.get("barcode"), row.get("stock_code"), row.get("sku")) if norm_code(x)]
    prod_codes = [norm_code(x) for x in (product.get("barcode"), product.get("sku")) if norm_code(x)]
    aliases = [norm_code(a) for a in (product.get("marketplace_aliases") or []) if norm_code(a)]
    for rc in row_codes:
        if rc in prod_codes:
            return 1.0
        if rc in aliases:
            return 0.98
    title = norm_text(row.get("title") or row.get("product_name") or row.get("name") or "")
    name = norm_text(product.get("name") or "")
    if not title or not name:
        return 0.0
    if title == name:
        return 0.95
    ratio = difflib.SequenceMatcher(None, title, name).ratio()
    if title in name or name in title:
        ratio = max(ratio, 0.88)
    return round(min(1.0, ratio), 2)


def suggest_matches(
    row: dict,
    products: List[dict],
    *,
    limit: int = 3,
    min_score: float = 0.45,
) -> List[Dict[str, Any]]:
    scored = []
    for p in products or []:
        sc = score_row_product(row, p)
        if sc < min_score:
            continue
        reason = "ad"
        if sc >= 0.99:
            reason = "barkod"
        elif sc >= 0.97:
            reason = "alias"
        elif sc >= 0.8:
            reason = "güçlü"
        elif sc >= 0.55:
            reason = "benzer"
        scored.append({
            "product_id": p.get("id") or p.get("_id"),
            "name": p.get("name"),
            "sku": p.get("sku"),
            "barcode": p.get("barcode"),
            "score": sc,
            "reason": reason,
        })
    scored.sort(key=lambda x: (-float(x["score"]), str(x.get("name") or "")))
    return scored[:limit]


def suggest_for_rows(
    rows: List[dict],
    products: List[dict],
    *,
    limit: int = 3,
    min_score: float = 0.45,
) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows or []:
        bc = str((row or {}).get("barcode") or "").strip()
        if not bc:
            continue
        out[bc] = suggest_matches(row, products, limit=limit, min_score=min_score)
    return out


def build_product_match_index(products: List[dict]) -> Dict[str, dict]:
    """barkod / sku / marketplace_aliases (lower) → stok kartı."""
    idx: Dict[str, dict] = {}
    for p in products or []:
        if not isinstance(p, dict):
            continue
        keys = [p.get("barcode"), p.get("sku"), *(p.get("marketplace_aliases") or [])]
        for v in p.get("variants") or []:
            if isinstance(v, dict) and v.get("barcode"):
                keys.append(v.get("barcode"))
        for key in keys:
            k = str(key or "").strip().lower()
            if k:
                idx.setdefault(k, p)
    return idx


def apply_exact_stock_matches(
    items: Optional[List[Any]],
    product_index: Dict[str, dict],
) -> List[Any]:
    """Eşleşmesi düşmüş / hiç bağlanmamış kalemlere barkod-sku-alias ile stok kartı yaz.

    Sadece kesin anahtar (score≈1 / alias) kullanır; ad benzerliği ile otomatik
    bağlanmaz. Görsel yoksa stok kartı thumbnail/image doldurulur.
    Değişiklik yoksa orijinal listeyi döner.
    """
    if not items or not product_index:
        return items if items is not None else []
    out: List[Any] = []
    changed = False
    for it in items:
        if not isinstance(it, dict):
            out.append(it)
            continue
        # Zaten manuel eşleşmiş (matched_product_name damgası) → dokunma.
        if str(it.get("matched_product_name") or "").strip() and str(it.get("product_id") or "").strip():
            out.append(it)
            continue
        hit = None
        for key in (
            it.get("barcode"),
            it.get("sku"),
            it.get("product_name"),
            it.get("name"),
        ):
            k = str(key or "").strip().lower()
            if k and k in product_index:
                hit = product_index[k]
                break
        if not hit:
            out.append(it)
            continue
        row = dict(it)
        pid = hit.get("_id") or hit.get("id")
        if pid and str(row.get("product_id") or "") != str(pid):
            row["product_id"] = pid
            changed = True
        if hit.get("name") and str(row.get("matched_product_name") or "") != str(hit["name"]):
            row["matched_product_name"] = hit["name"]
            changed = True
        if not str(row.get("image_url") or "").strip():
            img = (
                str(hit.get("thumbnail_url") or "").strip()
                or str(hit.get("image_url") or "").strip()
            )
            if img:
                row["image_url"] = img
                changed = True
        out.append(row)
    return out if changed else items
