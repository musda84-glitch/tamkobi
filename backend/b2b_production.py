"""B2B portal: sipariş üretim durumu ve aşama özeti (müşteriye açık)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import production_work_orders as pwo

PO_STATUS_LABELS = {
    "planned": "Üretim planlandı",
    "in_production": "Üretimde",
    "completed": "Üretim tamamlandı",
    "cancelled": "Üretim iptal",
}
ACTIVE_PO_STATUSES = frozenset({"planned", "in_production"})


def production_status_label(status: Optional[str]) -> str:
    st = str(status or "").strip().lower()
    return PO_STATUS_LABELS.get(st) or "Üretimde"


def _steps_from_work_orders(work_orders: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    rows = sorted(
        [w for w in (work_orders or []) if isinstance(w, dict)],
        key=lambda w: int(w.get("step_no") or w.get("original_step_no") or 0),
    )
    cur = next((w for w in rows if w.get("status") in ("in_progress", "paused")), None)
    if not cur:
        cur = next((w for w in rows if w.get("status") == "ready"), None)
    out: List[Dict[str, Any]] = []
    for w in rows:
        name = str(w.get("step_name") or w.get("name") or "").strip()
        if not name:
            continue
        st = str(w.get("status") or "").strip().lower()
        is_done = st == "done"
        is_current = bool(cur) and w is cur
        row: Dict[str, Any] = {
            "no": int(w.get("step_no") or len(out) + 1),
            "name": name,
            "station": str(w.get("station") or "").strip(),
            "status": st or ("done" if is_done else "waiting"),
            "done": is_done,
            "current": is_current,
        }
        note = str(w.get("step_note") or w.get("note") or "").strip()
        if note:
            row["note"] = note
        out.append(row)
    return out


def _steps_from_recipe(recipe: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    base = pwo.customer_recipe_steps(recipe)
    return [
        {
            "no": int(s.get("no") or i + 1),
            "name": s["name"],
            "station": str(s.get("station") or "").strip(),
            "status": "waiting",
            "done": False,
            "current": i == 0,
            **({"note": s["note"]} if s.get("note") else {}),
            **({"material_name": s["material_name"]} if s.get("material_name") else {}),
        }
        for i, s in enumerate(base)
    ]


def build_b2b_production(
    *,
    production_order: Optional[Dict[str, Any]] = None,
    work_orders: Optional[List[Dict[str, Any]]] = None,
    recipe: Optional[Dict[str, Any]] = None,
    sent_to_production: bool = False,
) -> Optional[Dict[str, Any]]:
    """Portal satırı için üretim özeti. Aktif/tamamlanmış PO veya reçete/işaret varsa döner."""
    po = production_order if isinstance(production_order, dict) else None
    if not po and not recipe and not sent_to_production and not work_orders:
        return None
    status = str((po or {}).get("status") or "").strip().lower()
    if not status:
        status = "planned" if (recipe or sent_to_production or work_orders) else ""
    if not status:
        return None
    steps = _steps_from_work_orders(work_orders)
    if not steps and recipe:
        steps = _steps_from_recipe(recipe)
    if not steps and (po or sent_to_production):
        steps = [{
            "no": 1,
            "name": "Üretim",
            "station": "",
            "status": "done" if status == "completed" else ("in_progress" if status == "in_production" else "waiting"),
            "done": status == "completed",
            "current": status in ACTIVE_PO_STATUSES,
        }]
    done_n = sum(1 for s in steps if s.get("done"))
    cur = next((s for s in steps if s.get("current")), None)
    active = status in ACTIVE_PO_STATUSES
    product = (
        (po or {}).get("finished_product_name")
        or (po or {}).get("recipe_name")
        or (recipe or {}).get("finished_product_name")
        or (recipe or {}).get("name")
        or None
    )
    return {
        "status": status,
        "status_label": production_status_label(status),
        "active": active,
        "order_code": (po or {}).get("order_code") or None,
        "product_name": product,
        "done": done_n,
        "total": len(steps),
        "current_step_name": (cur or {}).get("name"),
        "steps": steps,
    }


def order_shows_production(order: Optional[Dict[str, Any]] = None) -> bool:
    """Durum/kargo hücresinde üretim kartı gösterilsin mi?"""
    o = order or {}
    prod = o.get("production")
    if not isinstance(prod, dict) or not prod.get("status"):
        return False
    ost = str(o.get("order_status") or "").strip().lower()
    if ost in ("cancelled", "delivered", "completed", "shipped", "returned", "partially_returned"):
        return False
    if o.get("tracking") and not prod.get("active"):
        return False
    return True
