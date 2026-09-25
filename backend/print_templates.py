"""Print form templates and linked custom form categories."""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

BASE_PRINT_DOC_TYPES = ("invoice", "order", "quote", "dispatch")
BASE_PRINT_LABELS = {
    "invoice": "Fatura",
    "order": "Sipariş Formu",
    "quote": "Teklif",
    "dispatch": "İrsaliye",
}
DEFAULT_PRINT_TEMPLATE = {
    "show_logo": True,
    "primary_color": "#059669",
    "header_note": "",
    "footer_note": "Bizi tercih ettiğiniz için teşekkür ederiz.",
    "show_bank_info": True,
    "show_tax_info": True,
    "show_signature": True,
    "show_barcode": True,
    "show_images": True,
    "font_size": "sm",
    "paper": "A4",
    "title_override": "",
    "layout": "classic",
    "hide_line_prices": False,
    "hide_vat": False,
    "hide_all_prices": False,
    "show_item_notes": True,
    "show_order_notes": True,
    "show_qty_total": False,
}
# Meta fields stored on custom categories (not part of DEFAULT template body).
CATEGORY_META_KEYS = ("is_category", "base_type", "label")


def _slugify_title(title: str) -> str:
    raw = unicodedata.normalize("NFKD", title or "")
    ascii_part = raw.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_part).strip("-").lower()
    if slug:
        return slug[:48]
    # Keep a stable fallback for titles that are only non-ASCII (e.g. Turkish).
    compact = re.sub(r"\s+", "-", (title or "").strip().lower())
    compact = re.sub(r"[^\w\-]", "", compact, flags=re.UNICODE)
    return (compact or "ozel")[:48]


def form_category_key(base_type: str, title: str) -> str:
    return f"{base_type}__{_slugify_title(title)}"


def is_base_doc_type(doc_type: str) -> bool:
    return doc_type in BASE_PRINT_DOC_TYPES


def is_category_key(doc_type: str, stored: Optional[Dict[str, Any]] = None) -> bool:
    if stored and stored.get("is_category"):
        return True
    if is_base_doc_type(doc_type):
        return False
    return "__" in (doc_type or "")


def template_body(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    src = raw or {}
    return {k: src[k] if k in src else DEFAULT_PRINT_TEMPLATE[k] for k in DEFAULT_PRINT_TEMPLATE}


def merge_template(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    body = template_body(raw)
    src = raw or {}
    out = {**body}
    for k in CATEGORY_META_KEYS:
        if k in src:
            out[k] = src[k]
    return out


def build_print_templates_response(stored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    templates = stored or {}
    out: Dict[str, Any] = {doc: merge_template(templates.get(doc)) for doc in BASE_PRINT_DOC_TYPES}
    for key, raw in templates.items():
        if key in BASE_PRINT_DOC_TYPES or not isinstance(raw, dict):
            continue
        if raw.get("is_category") or is_category_key(key, raw):
            base = raw.get("base_type") if raw.get("base_type") in BASE_PRINT_DOC_TYPES else None
            if not base and "__" in key:
                base = key.split("__", 1)[0]
            if base not in BASE_PRINT_DOC_TYPES:
                continue
            merged = merge_template(raw)
            merged["is_category"] = True
            merged["base_type"] = base
            merged["label"] = (raw.get("label") or raw.get("title_override") or key).strip() or BASE_PRINT_LABELS[base]
            out[key] = merged
    return out


def list_form_categories(response: Dict[str, Any], base_type: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = []
    for key, tpl in response.items():
        if not isinstance(tpl, dict) or not tpl.get("is_category"):
            continue
        if base_type and tpl.get("base_type") != base_type:
            continue
        rows.append({"key": key, **tpl})
    rows.sort(key=lambda r: (r.get("base_type") or "", (r.get("label") or "").lower()))
    return rows


def prepare_save(
    doc_type: str,
    req: Dict[str, Any],
    existing: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    """
    Returns (sets_by_key, primary_result).
    When saving a base type with a non-empty title, also upserts a linked form category
    and clears title_override on the base template so the default form stays default-named.
    """
    existing = existing or {}
    if is_base_doc_type(doc_type):
        allowed = {k: req[k] for k in DEFAULT_PRINT_TEMPLATE if k in req}
        title = str(allowed.get("title_override") or "").strip()
        sets: Dict[str, Dict[str, Any]] = {}
        if title:
            cat_key = form_category_key(doc_type, title)
            prev = existing.get(cat_key) if isinstance(existing.get(cat_key), dict) else {}
            cat = {
                **template_body({**prev, **allowed}),
                "title_override": title,
                "is_category": True,
                "base_type": doc_type,
                "label": title,
            }
            sets[cat_key] = cat
            base_body = {**template_body({**(existing.get(doc_type) or {}), **allowed}), "title_override": ""}
            sets[doc_type] = base_body
            return sets, {**cat, "key": cat_key, "created_category": True, "category_key": cat_key}
        base_body = template_body({**(existing.get(doc_type) or {}), **allowed})
        sets[doc_type] = base_body
        return sets, {**DEFAULT_PRINT_TEMPLATE, **base_body}

    # Custom category key
    prev = existing.get(doc_type) if isinstance(existing.get(doc_type), dict) else {}
    if not prev.get("is_category") and not is_category_key(doc_type, prev):
        raise ValueError("invalid_doc_type")
    base = prev.get("base_type") or (doc_type.split("__", 1)[0] if "__" in doc_type else "")
    if base not in BASE_PRINT_DOC_TYPES:
        raise ValueError("invalid_doc_type")
    allowed = {k: req[k] for k in DEFAULT_PRINT_TEMPLATE if k in req}
    title = str(allowed.get("title_override") or req.get("label") or prev.get("label") or "").strip()
    if not title:
        title = prev.get("label") or BASE_PRINT_LABELS[base]
    # Retarget key if title slug changed
    new_key = form_category_key(base, title)
    cat = {
        **template_body({**prev, **allowed}),
        "title_override": title,
        "is_category": True,
        "base_type": base,
        "label": title,
    }
    sets = {new_key: cat}
    result = {**cat, "key": new_key, "category_key": new_key}
    if new_key != doc_type:
        result["renamed_from"] = doc_type
        result["delete_old_key"] = doc_type
    return sets, result
