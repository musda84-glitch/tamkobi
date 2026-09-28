"""Atölye iş emri yardımcıları — reçeteden istasyon / iş dosyası alanları."""
from typing import Any, Dict, Optional


def recipe_job_fields(recipe: Optional[Dict[str, Any]] = None) -> Dict[str, Optional[str]]:
    """Reçeteden iş emrine kopyalanacak iş dosyası / reçete adı."""
    r = recipe or {}
    job = str(r.get("job_file_name") or "").strip() or None
    name = str(r.get("name") or "").strip() or None
    return {"job_file_name": job, "recipe_name": name}


def enrich_work_order_row(row: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Liste yanıtında eksik job_file_name / recipe_name doldur."""
    m = meta or {}
    if not row.get("job_file_name") and m.get("job_file_name"):
        row["job_file_name"] = m["job_file_name"]
    if not row.get("recipe_name") and m.get("recipe_name"):
        row["recipe_name"] = m["recipe_name"]
    if not row.get("station"):
        row["station"] = "Genel"
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
