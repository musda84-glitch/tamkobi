"""Kullanıcı → şirket (Hesap seçici) erişimi."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set


def normalize_company_ids(raw: Any) -> List[str]:
    if not isinstance(raw, (list, tuple)):
        return []
    out: List[str] = []
    seen: Set[str] = set()
    for x in raw:
        cid = str(x or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        out.append(cid)
    return out


def filter_assignable_company_ids(
    requested: Iterable[str],
    assignable: Iterable[str],
) -> List[str]:
    """İstenen şirketleri lisans grubundaki izinli kümeye indirger (sıra korunur)."""
    allow = {str(x) for x in assignable if x}
    return [c for c in normalize_company_ids(list(requested)) if c in allow]


def resolve_active_company_id(
    company_ids: List[str],
    current_active: Optional[str] = None,
) -> Optional[str]:
    ids = normalize_company_ids(company_ids)
    if not ids:
        return None
    cur = str(current_active or "").strip()
    return cur if cur in ids else ids[0]


def company_brief(row: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    c = row or {}
    return {
        "id": c.get("_id") or c.get("id"),
        "name": c.get("name") or c.get("_id") or c.get("id"),
        "tax_number": c.get("tax_number"),
    }
