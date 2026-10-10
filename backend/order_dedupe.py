"""Marketplace sipariş mükerrerlerini tekilleştirme yardımcıları.

Anahtar: (company_id, channel, order_number) — Trendyol paketleri aynı
orderNumber ile gelir; eşzamanlı sync iki satır üretebiliyordu.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


KEEP_FIELDS = (
    "invoice_id",
    "is_invoiced",
    "contact_id",
    "contact_name",
    "internal_note",
    "label_printed_at",
    "form_printed_at",
    "sent_to_production_at",
    "production_recipe_id",
    "production_order_id",
)

def marketplace_order_key(doc: Dict[str, Any], company_id: Optional[str] = None) -> Tuple[str, str, str]:
    cid = str(company_id or doc.get("company_id") or "").strip()
    ch = str(doc.get("channel") or "").strip().lower()
    on = str(doc.get("order_number") or "").strip()
    return (cid, ch, on)


def _ts(doc: Dict[str, Any]) -> str:
    return str(doc.get("updated_at") or doc.get("created_at") or doc.get("order_date") or "")


def order_keep_score(doc: Dict[str, Any]) -> Tuple:
    """Yüksek skor = korunacak satır (fatura/cari/zenginlik/yenilik)."""
    items = doc.get("items") if isinstance(doc.get("items"), list) else []
    return (
        1 if doc.get("invoice_id") or doc.get("is_invoiced") else 0,
        1 if doc.get("contact_id") else 0,
        1 if doc.get("sent_to_production_at") or doc.get("production_order_id") else 0,
        len(items),
        _ts(doc),
        str(doc.get("_id") or doc.get("id") or ""),
    )


def pick_canonical_order(rows: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not rows:
        return None
    return max(rows, key=order_keep_score)


def _item_identity_keys(it: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Kalem eşleme anahtarları (öncelik sırası)."""
    keys: List[Tuple[str, str]] = []
    for field in ("line_id", "order_line_id", "barcode", "sku"):
        val = str(it.get(field) or "").strip().lower()
        if val:
            keys.append((field, val))
    return keys


def _items_index_compatible(existing_line: Dict[str, Any], incoming_line: Dict[str, Any]) -> bool:
    """İndeks yedek eşlemesi: kimlik yoksa veya ortak barkod/sku/ad varsa kabul."""
    ex_keys = {k for k in _item_identity_keys(existing_line)}
    in_keys = {k for k in _item_identity_keys(incoming_line)}
    if not ex_keys and not in_keys:
        return True
    if ex_keys & in_keys:
        return True
    ex_name = str(
        existing_line.get("product_name") or existing_line.get("name") or ""
    ).strip().lower()
    in_name = str(
        incoming_line.get("product_name") or incoming_line.get("name") or ""
    ).strip().lower()
    return bool(ex_name and in_name and ex_name == in_name)


def _find_existing_line(
    incoming_line: Dict[str, Any],
    by_key: Dict[Tuple[str, str], Dict[str, Any]],
    existing_items: Sequence[Dict[str, Any]],
    idx: int,
) -> Optional[Dict[str, Any]]:
    for key in _item_identity_keys(incoming_line):
        hit = by_key.get(key)
        if hit is not None:
            return hit
    if 0 <= idx < len(existing_items):
        cand = existing_items[idx]
        if isinstance(cand, dict) and _items_index_compatible(cand, incoming_line):
            return cand
    return None


def merge_order_items(
    existing_items: Optional[Sequence[Any]],
    incoming_items: Optional[Sequence[Any]],
) -> List[Any]:
    """Pazaryeri sync kalemlerinde yerel stok eşleşmesi ve görselleri koru.

    Gelen satır pazaryeri alanlarını (ad, fiyat, adet) günceller; daha önce
    `match_order_item_product` ile yazılmış product_id / matched_product_name
    ve dolu image_url silinmez. ShopPHP gibi kanallar kendi urunID'sini
    product_id yazdığı için eşleşmiş satırda yerel id önceliklidir.
    """
    existing = [it for it in (existing_items or []) if isinstance(it, dict)]
    incoming = list(incoming_items or [])
    if not existing:
        return incoming
    if not incoming:
        return list(existing_items or [])

    by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for it in existing:
        for key in _item_identity_keys(it):
            by_key.setdefault(key, it)

    out: List[Any] = []
    for idx, it in enumerate(incoming):
        if not isinstance(it, dict):
            out.append(it)
            continue
        row = dict(it)
        prev = _find_existing_line(row, by_key, existing, idx)
        if not prev:
            out.append(row)
            continue

        prev_pid = str(prev.get("product_id") or "").strip()
        prev_matched = str(prev.get("matched_product_name") or "").strip()
        incoming_pid = str(row.get("product_id") or "").strip()

        # Manuel eşleşme damgası veya boş gelen product_id → yerel id kalsın.
        if prev_pid and (prev_matched or not incoming_pid):
            row["product_id"] = prev_pid
            if prev_matched:
                row["matched_product_name"] = prev_matched
        elif prev_matched and not row.get("matched_product_name"):
            row["matched_product_name"] = prev_matched

        for field in ("image_url", "thumbnail_url"):
            if not str(row.get(field) or "").strip() and prev.get(field):
                row[field] = prev[field]

        # Eşleşmeden gelen sku/barcode boşsa önceki (stok kartından doldurulmuş) kalsın.
        for field in ("sku", "barcode"):
            if not str(row.get(field) or "").strip() and prev.get(field):
                row[field] = prev[field]

        out.append(row)
    return out


def merge_keep_fields(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Gelen pazaryeri alanının üzerine yerel fatura/cari vb. alanları koru."""
    out = {**incoming}
    for k in KEEP_FIELDS:
        if existing.get(k) is not None:
            out[k] = existing[k]
    # Eski sync: Shipped/Delivered → is_invoiced=True yazılmış, invoice_id yok.
    # Yerel fatura kaydı yokken True'yu koruma; taslak açılsın ve rozet düzeltilsin.
    if out.get("is_invoiced") and not (out.get("invoice_id") or existing.get("invoice_id")):
        out["is_invoiced"] = False
    if "items" in incoming or existing.get("items"):
        out["items"] = merge_order_items(existing.get("items"), incoming.get("items"))
    return out


def dedupe_orders_by_marketplace_key(docs: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Liste yanıtı için: aynı (company, channel, order_number) tek satır."""
    best: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    passthrough: List[Dict[str, Any]] = []
    for d in docs or []:
        if not isinstance(d, dict):
            continue
        key = marketplace_order_key(d)
        if not key[2]:
            passthrough.append(d)
            continue
        prev = best.get(key)
        if prev is None or order_keep_score(d) > order_keep_score(prev):
            best[key] = d
    # Stable-ish: preserved order of first occurrence of each key, then orphans.
    seen = set()
    out: List[Dict[str, Any]] = []
    for d in docs or []:
        if not isinstance(d, dict):
            continue
        key = marketplace_order_key(d)
        if not key[2]:
            out.append(d)
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(best[key])
    return out


def duplicate_ids_to_drop(rows: Sequence[Dict[str, Any]]) -> List[str]:
    keep = pick_canonical_order(rows)
    if not keep:
        return []
    kid = str(keep.get("_id") or keep.get("id") or "")
    drop = []
    for r in rows:
        rid = str(r.get("_id") or r.get("id") or "")
        if rid and rid != kid:
            drop.append(rid)
    return drop
