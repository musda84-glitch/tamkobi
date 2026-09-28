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
