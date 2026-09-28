"""Atölye iş emri yardımcıları — reçeteden istasyon / iş dosyası / hammadde alanları."""
from typing import Any, Dict, List, Optional


def recipe_job_fields(recipe: Optional[Dict[str, Any]] = None) -> Dict[str, Optional[str]]:
    """Reçeteden iş emrine kopyalanacak iş dosyası / reçete adı."""
    r = recipe or {}
    job = str(r.get("job_file_name") or "").strip() or None
    name = str(r.get("name") or "").strip() or None
    return {"job_file_name": job, "recipe_name": name}


def recipe_materials_for_qty(recipe: Optional[Dict[str, Any]] = None, quantity: Any = 1) -> List[Dict[str, Any]]:
    """Plan miktarına göre reçete hammaddeleri (atölye kartı için)."""
    r = recipe or {}
    try:
        qty = float(quantity if quantity is not None else 1)
    except (TypeError, ValueError):
        qty = 1.0
    try:
        target = float(r.get("target_quantity") or 1) or 1.0
    except (TypeError, ValueError):
        target = 1.0
    factor = qty / target
    out: List[Dict[str, Any]] = []
    for m in r.get("materials") or []:
        if not isinstance(m, dict):
            continue
        try:
            base = float(m.get("quantity") or 0)
            waste = float(m.get("wastage_percent") or 0)
        except (TypeError, ValueError):
            continue
        needed = round(base * factor * (1 + waste / 100.0), 3)
        if needed <= 0:
            continue
        name = str(m.get("product_name") or "").strip() or "Hammadde"
        out.append({
            "product_id": m.get("product_id"),
            "product_name": name,
            "unit": str(m.get("unit") or "Adet").strip() or "Adet",
            "needed": needed,
        })
    return out


def enrich_work_order_row(row: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Liste yanıtında eksik job_file_name / recipe_name / materials doldur."""
    m = meta or {}
    if not row.get("job_file_name") and m.get("job_file_name"):
        row["job_file_name"] = m["job_file_name"]
    if not row.get("recipe_name") and m.get("recipe_name"):
        row["recipe_name"] = m["recipe_name"]
    if not row.get("station"):
        row["station"] = "Genel"
    if m.get("materials") is not None:
        row["materials"] = m["materials"]
    elif "materials" not in row:
        row["materials"] = []
    return row


def work_order_trash_label(wo: Optional[Dict[str, Any]] = None) -> str:
    """Çöp kutusu satır etiketi."""
    w = wo or {}
    bits = [
        str(w.get("order_code") or "").strip(),
        str(w.get("step_name") or "").strip(),
        str(w.get("product_name") or "").strip(),
    ]
    return " · ".join(b for b in bits if b) or str(w.get("_id") or "İş emri")


def work_order_trash_note(wo: Optional[Dict[str, Any]] = None) -> str:
    w = wo or {}
    station = str(w.get("station") or "—").strip() or "—"
    job = str(w.get("job_file_name") or "").strip()
    note = f"İstasyon: {station}"
    if job:
        note += f" · İş dosyası: {job}"
    return note
