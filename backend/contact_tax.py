"""Satış faturasındaki VKN/TCKN ve vergi dairesini boş cari karta yazma.

Dolu kart alanının üzerine yazılmaz. Perakende yer tutucuları (11111111111,
'Perakende') gerçek kimlik sayılmaz.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from contact_search import fold_tr

PLACEHOLDER_TAX_IDS = frozenset({
    "11111111111",
    "1111111111",
    "00000000000",
    "0000000000",
    "99999999999",
    "9999999999",
})

_BLANK_OFFICE = frozenset({"", "-", "—", "0", "yok", "perakende", "bilinmiyor", "vd", "v.d.", "v.d"})


def digits_only(raw: Any) -> str:
    return re.sub(r"\D", "", str(raw or ""))


def is_blank_text(raw: Any) -> bool:
    return str(raw or "").strip() in ("", "-", "—", "0")


def is_placeholder_tax_id(raw: Any) -> bool:
    """Perakende / test yer tutucuları e-Fatura mükellefi sayılmaz.

    11111111111 ve aynı rakamın tekrarı (2222222222 gibi) gerçek kimlik değildir.
    """
    d = digits_only(raw)
    if not d:
        return False
    if d in PLACEHOLDER_TAX_IDS:
        return True
    if len(d) in (10, 11) and len(set(d)) == 1:
        return True
    return False


def is_real_tax_id(raw: Any) -> bool:
    d = digits_only(raw)
    if len(d) not in (10, 11):
        return False
    if is_placeholder_tax_id(d):
        return False
    return True


def is_real_tax_office(raw: Any) -> bool:
    s = str(raw or "").strip()
    if not s or is_blank_text(s):
        return False
    if fold_tr(s) in _BLANK_OFFICE:
        return False
    return True


def contact_tax_patch(contact: Optional[dict], tax_id: Any, tax_office: Any) -> Dict[str, str]:
    """Kartta boş olan alanları dolduracak yama. Dolu alana dokunmaz."""
    if not contact:
        return {}
    patch: Dict[str, str] = {}
    if is_blank_text(contact.get("tax_number_or_id")) and is_real_tax_id(tax_id):
        patch["tax_number_or_id"] = digits_only(tax_id)
    if is_blank_text(contact.get("tax_office")) and is_real_tax_office(tax_office):
        patch["tax_office"] = str(tax_office).strip()
    return patch


def _invoice_stamp(inv: dict) -> str:
    return f"{inv.get('issue_date') or ''} {inv.get('created_at') or ''}"


def plan_sales_invoice_tax_backfill(contacts: List[dict], invoices: List[dict]) -> List[dict]:
    """Satış faturalarından boş cari VKN/vergi dairesi yamalarını çıkar.

    Her alan için o carinin en güncel gerçek değeri kullanılır. İptal ve
    satış dışı belgeler yok sayılır. Kartta dolu olan alan değişmez.
    """
    by_id: Dict[str, dict] = {}
    for c in contacts:
        cid = str(c.get("_id") or c.get("id") or "")
        if cid:
            by_id[cid] = c
    best_tax: Dict[str, tuple] = {}
    best_office: Dict[str, tuple] = {}
    for inv in invoices:
        if str(inv.get("invoice_type") or "") != "sales":
            continue
        if str(inv.get("status") or "") == "cancelled":
            continue
        cid = str(inv.get("contact_id") or "")
        if cid not in by_id:
            continue
        stamp = _invoice_stamp(inv)
        number = inv.get("invoice_number") or inv.get("_id") or ""
        tax = inv.get("contact_tax_id") or inv.get("buyer_tax_id") or ""
        office = inv.get("contact_tax_office") or ""
        if is_real_tax_id(tax):
            prev = best_tax.get(cid)
            if prev is None or stamp >= prev[0]:
                best_tax[cid] = (stamp, digits_only(tax), number)
        if is_real_tax_office(office):
            prev_o = best_office.get(cid)
            if prev_o is None or stamp >= prev_o[0]:
                best_office[cid] = (stamp, str(office).strip(), number)
    plans = []
    for cid, contact in by_id.items():
        tax = best_tax.get(cid, (None, "", ""))[1]
        office = best_office.get(cid, (None, "", ""))[1]
        patch = contact_tax_patch(contact, tax, office)
        if not patch:
            continue
        source = best_tax.get(cid, best_office.get(cid, ("", "", "")))[2]
        plans.append({
            "contact_id": cid,
            "name": contact.get("name") or "",
            "patch": patch,
            "source_invoice": source,
        })
    plans.sort(key=lambda p: (str(p.get("name") or ""), p["contact_id"]))
    return plans
