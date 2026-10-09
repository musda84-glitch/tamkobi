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
