/** Bitir modalı plan miktarı/birim — hammadde adımında kalem ihtiyacı. */
export function workOrderFinishPlan(w) {
  const mats = Array.isArray(w?.materials) ? w.materials : [];
  const mid = String(w?.material_product_id || "").trim();
  const mname = String(w?.material_name || "").trim();
  let hit = null;
  if (mid) hit = mats.find((m) => String(m?.product_id || "").trim() === mid) || null;
  if (!hit && mname) {
    const key = mname.toLocaleLowerCase("tr");
    hit = mats.find((m) => String(m?.product_name || "").trim().toLocaleLowerCase("tr") === key) || null;
  }
  const needed = Number(hit?.needed);
  if (hit && Number.isFinite(needed) && needed > 0) {
    return {
      qty: needed,
      unit: String(hit.unit || "Adet").trim() || "Adet",
      isMaterial: true,
      materialName: String(hit.product_name || mname || "").trim() || null,
    };
  }
  if (w?.finish_qty != null && Number(w.finish_qty) > 0) {
    return {
      qty: Number(w.finish_qty),
      unit: String(w.finish_unit || w.unit || "Adet").trim() || "Adet",
      isMaterial: !!w.finish_is_material,
      materialName: mname || null,
    };
  }
  return {
    qty: Number(w?.planned_quantity || 0),
    unit: String(w?.unit || "Adet").trim() || "Adet",
    isMaterial: false,
    materialName: null,
  };
}

/** Atölye kartı aksiyonları — durum → hangi butonlar. */
export function shopFloorCardActions(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "ready") return { start: true, pause: false, resume: false, finish: false };
  if (s === "in_progress" || s === "running" || s === "active") {
    return { start: false, pause: true, resume: false, finish: true };
  }
  if (s === "paused" || s === "pause") {
    return { start: false, pause: false, resume: true, finish: true };
  }
  return { start: false, pause: false, resume: false, finish: false };
}

export function shopFloorCardBorder(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "in_progress" || s === "running" || s === "active") {
    return "border-amber-400 shadow-lg shadow-amber-100";
  }
  if (s === "paused" || s === "pause") return "border-orange-300";
  if (s === "ready") return "border-blue-200";
  return "border-slate-200";
}
