"""Atölye iş emri yardımcıları — reçeteden istasyon / iş dosyası alanları."""
from typing import Any, Dict, List, Optional


def recipe_job_fields(recipe: Optional[Dict[str, Any]] = None) -> Dict[str, Optional[str]]:
    """Reçeteden iş emrine kopyalanacak iş dosyası / reçete adı."""
    r = recipe or {}
    job = str(r.get("job_file_name") or "").strip() or None
    name = str(r.get("name") or "").strip() or None
    return {"job_file_name": job, "recipe_name": name}


def sanitize_step_images(raw: Any, limit: int = 12) -> List[str]:
    """Adım / iş emri görsel URL listesi — tekrarları düş, boşları at."""
    out: List[str] = []
    seen = set()
    for item in raw or []:
        url = ""
        if isinstance(item, str):
            url = item.strip()
        elif isinstance(item, dict):
            url = str(item.get("url") or item.get("image_url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(url)
        if len(out) >= limit:
            break
    return out


def _normalize_step(st: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(st, dict):
        return None
    name = str(st.get("name") or "").strip()
    if not name:
        return None
    return {
        "no": st.get("no", 0),
        "name": name,
        "station": str(st.get("station") or "").strip(),
        "duration_min": st.get("duration_min", 0) or 0,
        "images": sanitize_step_images(st.get("images")),
    }


def flatten_recipe_steps(recipe: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Kalem adımları (malzeme sırası) + reçete geneli adımlar; yoksa tek 'Üretim'."""
    r = recipe or {}
    out: List[Dict[str, Any]] = []
    for mat in r.get("materials") or []:
        if not isinstance(mat, dict):
            continue
        mat_steps = mat.get("steps") or []
        if not mat_steps:
            continue
        mname = str(mat.get("product_name") or "").strip() or None
        mid = str(mat.get("product_id") or "").strip() or None
        for st in sorted(mat_steps, key=lambda x: (x or {}).get("no", 0) if isinstance(x, dict) else 0):
            norm = _normalize_step(st)
            if not norm:
                continue
            norm["material_name"] = mname
            norm["material_product_id"] = mid
            out.append(norm)
    for st in sorted(r.get("steps") or [], key=lambda x: (x or {}).get("no", 0) if isinstance(x, dict) else 0):
        norm = _normalize_step(st)
        if norm:
            out.append(norm)
    if not out:
        return [{"no": 1, "name": "Üretim", "station": "", "duration_min": 0, "images": []}]
    for i, st in enumerate(out):
        st["no"] = i + 1
        st.setdefault("images", [])
    return out


def work_order_step_label(st: Optional[Dict[str, Any]] = None, idx: int = 0) -> str:
    """İş emri başlığı: bölüm + varsa kalem adı."""
    s = st or {}
    base = str(s.get("name") or f"Adım {idx + 1}").strip() or f"Adım {idx + 1}"
    mname = str(s.get("material_name") or "").strip()
    return f"{base} — {mname}" if mname else base


def enrich_work_order_row(row: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Liste yanıtında eksik job_file_name / recipe_name / station / images doldur."""
    m = meta or {}
    if not row.get("job_file_name") and m.get("job_file_name"):
        row["job_file_name"] = m["job_file_name"]
    if not row.get("recipe_name") and m.get("recipe_name"):
        row["recipe_name"] = m["recipe_name"]
    if m.get("station") and (not row.get("station") or str(row.get("station")).strip().casefold() == "genel"):
        row["station"] = m["station"]
    elif not row.get("station"):
        row["station"] = "Genel"
    if not sanitize_step_images(row.get("images")) and m.get("images"):
        row["images"] = list(m["images"])
    elif "images" not in row:
        row["images"] = []
    return row


def needs_station_resolve(row: Optional[Dict[str, Any]] = None) -> bool:
    st = str((row or {}).get("station") or "").strip()
    return (not st) or st.casefold() == "genel"


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
