"""Atölye iş emri yardımcıları — reçeteden istasyon / iş dosyası / hammadde alanları."""
import math
from typing import Any, Dict, List, Optional

# Sayılabilir birimler: 2.857 Adet olmaz → yukarı yuvarla (plaka / vida / paket).
_DISCRETE_UNITS = frozenset({
    "adet", "ad", "takım", "takim", "çift", "cift", "koli", "kutu", "paket", "set", "parça", "parca",
})


def is_discrete_unit(unit: Any) -> bool:
    u = str(unit or "").strip().casefold()
    if not u:
        return True
    return u in _DISCRETE_UNITS or u.startswith("adet")


def round_needed_qty(needed: float, unit: Any) -> float:
    """Sürekli birimde 3 hane; Adet vb. sayılabilir birimde yukarı tam sayı."""
    try:
        n = float(needed)
    except (TypeError, ValueError):
        return 0.0
    if n <= 0:
        return 0.0
    if is_discrete_unit(unit):
        # 2.0001 → 3 değil 2; 2.857 → 3
        return float(math.ceil(n - 1e-9))
    return round(n, 3)


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
        unit = str(m.get("unit") or "Adet").strip() or "Adet"
        needed = round_needed_qty(base * factor * (1 + waste / 100.0), unit)
        if needed <= 0:
            continue
        name = str(m.get("product_name") or "").strip() or "Hammadde"
        out.append({
            "product_id": m.get("product_id"),
            "product_name": name,
            "unit": unit,
            "needed": needed,
        })
    return out


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


def normalize_step(st: Any) -> Optional[Dict[str, Any]]:
    """Adım adı (bölüm) boşsa istasyon adını kullan — sessizce düşmesin."""
    if not isinstance(st, dict):
        return None
    name = str(st.get("name") or "").strip()
    station = str(st.get("station") or "").strip()
    if not name and station:
        name = station
    if not name:
        return None
    note = str(st.get("note") or "").strip()
    return {
        "no": st.get("no", 0),
        "name": name,
        "station": station,
        "duration_min": st.get("duration_min", 0) or 0,
        "note": note,
        "images": sanitize_step_images(st.get("images")),
    }


# geriye dönük
_normalize_step = normalize_step


LOCKED_WO_STATUSES = ("done", "in_progress", "paused")


def group_steps_by_station(steps: List[Dict[str, Any]], station_order: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Aynı istasyon adımlarını peşi sıra topla (ilk görülen istasyon sırası korunur)."""
    if station_order is None:
        station_order = []
        seen = set()
        for st in steps or []:
            key = str(st.get("station") or "").strip().casefold()
            if key and key not in seen:
                seen.add(key)
                station_order.append(key)
    buckets: Dict[str, List[Dict[str, Any]]] = {k: [] for k in station_order}
    extra: List[List[Dict[str, Any]]] = []
    extra_index: Dict[str, int] = {}
    no_station: List[Dict[str, Any]] = []
    for st in steps or []:
        key = str(st.get("station") or "").strip().casefold()
        if not key:
            no_station.append(st)
            continue
        if key in buckets:
            buckets[key].append(st)
            continue
        if key not in extra_index:
            extra_index[key] = len(extra)
            extra.append([])
        extra[extra_index[key]].append(st)
    out: List[Dict[str, Any]] = []
    for key in station_order:
        out.extend(buckets[key])
    for group in extra:
        out.extend(group)
    out.extend(no_station)
    return out


def group_work_orders_for_display(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Atölye listesi: aynı istasyon kartları peşi sıra (step_no değişmez)."""
    return group_steps_by_station(list(rows or []))


def regroup_remaining_work_orders(rows: List[Dict[str, Any]], enabled: bool = True) -> List[Dict[str, Any]]:
    """Hazır/bekleyen adımları istasyona göre yeniden diz; başlamış/bitenler yerinde kalır.

    Kilitli (done / in_progress / paused) step_no slotları korunur. Kalan adımlar
    bu slotlara istasyon gruplu (veya original_step_no ile) yerleştirilir.
    Ardından ilk açık adım ready, sonrası waiting olur.
    """
    ordered = sorted(list(rows or []), key=lambda w: int(w.get("step_no") or 0))
    movable_idx = [i for i, w in enumerate(ordered) if w.get("status") not in LOCKED_WO_STATUSES]
    movable = [ordered[i] for i in movable_idx]
    if enabled:
        station_order: List[str] = []
        seen = set()
        for w in ordered:
            key = str(w.get("station") or "").strip().casefold()
            if key and key not in seen:
                seen.add(key)
                station_order.append(key)
        movable = group_steps_by_station(movable, station_order)
    else:
        movable = sorted(
            movable,
            key=lambda w: int(w.get("original_step_no") or w.get("step_no") or 0),
        )
    slot_nos = [int(ordered[i].get("step_no") or 0) for i in movable_idx]
    for wo, new_no in zip(movable, slot_nos):
        wo["step_no"] = new_no
    for i, wo in zip(movable_idx, movable):
        ordered[i] = wo
    ordered.sort(key=lambda w: int(w.get("step_no") or 0))
    seen_open = False
    for w in ordered:
        st = str(w.get("status") or "")
        if st == "done":
            continue
        if st in ("in_progress", "paused"):
            seen_open = True
            continue
        w["status"] = "waiting" if seen_open else "ready"
        seen_open = True
    return ordered


def flatten_recipe_steps(recipe: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Kalem adımları (malzeme sırası) + reçete geneli adımlar; yoksa tek 'Üretim'.

    group_same_station=True ise aynı istasyonlar peşi sıra gruplanır.
    """
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
        return [{"no": 1, "name": "Üretim", "station": "", "duration_min": 0, "note": "", "images": []}]
    if r.get("group_same_station"):
        out = group_steps_by_station(out)
    for i, st in enumerate(out):
        st["no"] = i + 1
        st.setdefault("images", [])
        st.setdefault("note", "")
    return out


def work_order_step_label(st: Optional[Dict[str, Any]] = None, idx: int = 0) -> str:
    """İş emri başlığı: bölüm + varsa kalem adı."""
    s = st or {}
    base = str(s.get("name") or f"Adım {idx + 1}").strip() or f"Adım {idx + 1}"
    mname = str(s.get("material_name") or "").strip()
    return f"{base} — {mname}" if mname else base


def recipe_step_for_work_order(
    steps: Optional[List[Dict[str, Any]]] = None,
    wo: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Reçete adımını bul — regroup sonrası step_no kayarsa original_step_no kullan."""
    seq = list(steps or [])
    if not seq:
        return None
    w = wo or {}
    for key in ("original_step_no", "step_no"):
        raw = w.get(key)
        if raw is None or raw == "":
            continue
        try:
            sn = int(raw)
        except (TypeError, ValueError):
            continue
        if 1 <= sn <= len(seq):
            return seq[sn - 1]
    return None


def resolve_work_order_finish_plan(
    wo: Optional[Dict[str, Any]] = None,
    materials: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Bitir modalı: hammadde adımında kalem ihtiyacı (ör. 16 Metre), aksi halde mamul planı."""
    w = wo or {}
    mats = list(materials if materials is not None else (w.get("materials") or []))
    mid = str(w.get("material_product_id") or "").strip()
    mname = str(w.get("material_name") or "").strip()
    hit: Optional[Dict[str, Any]] = None
    if mid:
        hit = next((m for m in mats if str(m.get("product_id") or "").strip() == mid), None)
    if not hit and mname:
        key = mname.casefold()
        hit = next((m for m in mats if str(m.get("product_name") or "").strip().casefold() == key), None)
    # Kartta tek hammadde satırı varken material_* eksik olsa da o kalemi kullan.
    if not hit and len(mats) == 1:
        hit = mats[0]
    try:
        needed = float((hit or {}).get("needed") or 0)
    except (TypeError, ValueError):
        needed = 0.0
    if hit and needed > 0 and (mid or mname or len(mats) == 1):
        unit = str(hit.get("unit") or "Adet").strip() or "Adet"
        return {
            "qty": round_needed_qty(needed, unit),
            "unit": unit,
            "is_material": True,
            "material_name": str(hit.get("product_name") or mname or "").strip() or None,
        }
    try:
        pq = float(w.get("planned_quantity") or 0)
    except (TypeError, ValueError):
        pq = 0.0
    return {
        "qty": pq,
        "unit": str(w.get("unit") or "Adet").strip() or "Adet",
        "is_material": False,
        "material_name": None,
    }


def materials_for_work_order_step(
    materials: Optional[List[Dict[str, Any]]] = None,
    wo: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Kartta hammadde adımıysa yalnızca o kalemi göster."""
    mats = list(materials or [])
    w = wo or {}
    mid = str(w.get("material_product_id") or "").strip()
    mname = str(w.get("material_name") or "").strip()
    if not mid and not mname:
        return mats
    filtered = []
    for m in mats:
        if mid and str(m.get("product_id") or "").strip() == mid:
            filtered.append(m)
        elif mname and str(m.get("product_name") or "").strip().casefold() == mname.casefold():
            filtered.append(m)
    return filtered or mats


def customer_recipe_steps(recipe: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Proje dosyası / müşteri takibi için reçete adım özeti (maliyet yok)."""
    out: List[Dict[str, Any]] = []
    for st in flatten_recipe_steps(recipe):
        name = str(st.get("name") or "").strip()
        if not name:
            continue
        row: Dict[str, Any] = {
            "no": int(st.get("no") or len(out) + 1),
            "name": name,
            "station": str(st.get("station") or "").strip(),
        }
        note = str(st.get("note") or "").strip()
        if note:
            row["note"] = note
        mname = str(st.get("material_name") or "").strip()
        if mname:
            row["material_name"] = mname
        out.append(row)
    return out


def enrich_work_order_row(row: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Liste yanıtında eksik job_file_name / recipe_name / station / images / materials / step_note doldur."""
    m = meta or {}
    if not row.get("job_file_name") and m.get("job_file_name"):
        row["job_file_name"] = m["job_file_name"]
    if not row.get("recipe_name") and m.get("recipe_name"):
        row["recipe_name"] = m["recipe_name"]
    if m.get("station") and (not row.get("station") or str(row.get("station")).strip().casefold() == "genel"):
        row["station"] = m["station"]
    elif not row.get("station"):
        row["station"] = "Genel"
    if m.get("materials") is not None:
        row["materials"] = m["materials"]
    elif "materials" not in row:
        row["materials"] = []
    if not sanitize_step_images(row.get("images")) and m.get("images"):
        row["images"] = list(m["images"])
    elif "images" not in row:
        row["images"] = []
    if not str(row.get("step_note") or "").strip() and m.get("step_note") is not None:
        row["step_note"] = m.get("step_note") or ""
    elif "step_note" not in row:
        row["step_note"] = ""
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


def production_order_trash_block_reason(order: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Stok işlenmiş / tamamlanmış emir silinemez."""
    o = order or {}
    if o.get("status") == "completed":
        return "Tamamlanmış üretim emri silinemez."
    try:
        done = float(o.get("completed_quantity") or 0)
    except (TypeError, ValueError):
        done = 0.0
    if done > 0:
        return "Üretimi yapılmış (stok işlenmiş) emir silinemez."
    return None


def production_order_trash_label(order: Optional[Dict[str, Any]] = None, wo: Optional[Dict[str, Any]] = None) -> str:
    o = order or {}
    w = wo or {}
    code = str(o.get("order_code") or o.get("order_number") or w.get("order_code") or "").strip()
    product = str(o.get("finished_product_name") or o.get("product_name") or w.get("product_name") or "").strip()
    bits = [b for b in (code, product) if b]
    return " · ".join(bits) or str(o.get("_id") or w.get("_id") or "Üretim emri")
