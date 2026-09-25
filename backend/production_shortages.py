"""Üretim emrindeki hammadde eksiklerini alt üretim emrine çevir."""

from __future__ import annotations

from typing import Any, Optional


def shortage_produce_lines(
    shortages: Optional[list],
    *,
    already_pids: Optional[set] = None,
    parent_code: str = "",
) -> tuple[list, list]:
    """
    shortages → create payload list + skipped.
    Zaten açılmış product_id'ler atlanır.
    """
    done = {str(p) for p in (already_pids or set()) if p}
    created_plan: list = []
    skipped: list = []
    for s in shortages or []:
        if not isinstance(s, dict):
            continue
        pid = s.get("product_id")
        qty = float(s.get("shortage") or 0)
        name = s.get("product_name") or "Hammadde"
        if qty <= 1e-9:
            continue
        if not pid:
            skipped.append({"product_name": name, "reason": "stok kartı yok"})
            continue
        if str(pid) in done:
            skipped.append({"product_id": pid, "product_name": name, "reason": "zaten üretime alındı"})
            continue
        note = f"{parent_code} hammaddesi eksik {qty:g}".strip() if parent_code else f"Hammadde eksik {qty:g}"
        created_plan.append({
            "product_id": str(pid),
            "product_name": name,
            "planned_quantity": qty,
            "notes": note,
        })
        done.add(str(pid))
    return created_plan, skipped


def merge_shortage_children(existing: Any, new_rows: list) -> list:
    out = [c for c in (existing or []) if isinstance(c, dict)]
    seen = {str(c.get("product_id")) for c in out if c.get("product_id")}
    for row in new_rows or []:
        pid = str(row.get("product_id") or "")
        if not pid or pid in seen:
            continue
        out.append(row)
        seen.add(pid)
    return out
