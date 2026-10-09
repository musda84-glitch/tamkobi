"""Pazaryeri sipariş kalemlerine Ürünler & Fiyat cache görsel/adı."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

MP_ITEM_MEDIA_SKIP_CHANNELS = frozenset({"b2b", "manual", "saha", ""})


def build_cache_media_index(cache_items: list) -> Dict[str, dict]:
    """Önbellek satırlarından barkod/stok kodu → {image, title} indeksi."""
    idx: Dict[str, dict] = {}
    for it in cache_items or []:
        if not isinstance(it, dict):
            continue
        image = str(it.get("image") or it.get("image_url") or "").strip()
        title = str(it.get("title") or it.get("product_name") or "").strip()
        if not image and not title:
            continue
        media = {"image": image, "title": title}
        for k in (it.get("barcode"), it.get("stock_code")):
            key = str(k or "").strip().lower()
            if key:
                idx[key] = media
    return idx


def apply_marketplace_item_media(order: dict, by_channel: Dict[str, Dict[str, dict]]) -> dict:
    """Sipariş kalemlerine pazaryeri liste görseli/adını yaz (barkod eşleşmesi)."""
    if not isinstance(order, dict):
        return order
    ch = str(order.get("channel") or "").strip().lower()
    if ch in MP_ITEM_MEDIA_SKIP_CHANNELS:
        return order
    idx = by_channel.get(ch) or {}
    if not idx:
        return order
    items = order.get("items") or []
    if not items:
        return order
    new_items = []
    changed = False
    for it in items:
        if not isinstance(it, dict):
            new_items.append(it)
            continue
        row = dict(it)
        keys = [
            str(row.get("barcode") or "").strip().lower(),
            str(row.get("sku") or "").strip().lower(),
        ]
        media = None
        for k in keys:
            if k and k in idx:
                media = idx[k]
                break
        if media:
            img = media.get("image") or ""
            title = media.get("title") or ""
            if img and str(row.get("image_url") or "").strip() != img:
                row["image_url"] = img
                changed = True
            if title and str(row.get("product_name") or "").strip() != title:
                row["product_name"] = title
                changed = True
        new_items.append(row)
    if not changed:
        return order
    return {**order, "items": new_items}


def marketplace_channels_from_orders(docs: List[Dict[str, Any]]) -> Set[str]:
    channels = {
        str(o.get("channel") or "").strip().lower()
        for o in (docs or [])
        if isinstance(o, dict) and str(o.get("channel") or "").strip().lower() not in MP_ITEM_MEDIA_SKIP_CHANNELS
    }
    channels.discard("")
    return channels


async def load_marketplace_cache_media_index(db: Any, company_id: str, channels: set) -> Dict[str, Dict[str, dict]]:
    """channel → barkod/stok kodu (lower) → {image, title}."""
    out: Dict[str, Dict[str, dict]] = {}
    cid = str(company_id or "").strip()
    if not cid:
        return out
    for ch in channels or []:
        ch_key = str(ch or "").strip().lower()
        if not ch_key or ch_key in MP_ITEM_MEDIA_SKIP_CHANNELS:
            continue
        cache = await db.marketplace_product_cache.find_one({"company_id": cid, "channel": ch_key}) or {}
        out[ch_key] = build_cache_media_index(cache.get("items") or [])
    return out


async def enrich_orders_marketplace_item_media(
    db: Any,
    docs: List[Dict[str, Any]],
    company_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Liste: pazaryeri sipariş kalemlerine cache'ten görsel + başlık."""
    if not docs:
        return docs
    channels = marketplace_channels_from_orders(docs)
    if not channels:
        return docs
    cid = str(
        company_id
        or next((o.get("company_id") for o in docs if isinstance(o, dict) and o.get("company_id")), "")
        or ""
    ).strip()
    if not cid:
        return docs
    by_ch = await load_marketplace_cache_media_index(db, cid, channels)
    if not any(by_ch.values()):
        return docs
    for i, o in enumerate(docs):
        docs[i] = apply_marketplace_item_media(o, by_ch)
    return docs
