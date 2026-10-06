const DISCRETE_UNITS = new Set(["adet", "ad", "takım", "takim", "çift", "cift", "koli", "kutu", "paket", "set", "parça", "parca"]);

export function isDiscreteUnit(unit) {
  const u = String(unit || "").trim().toLocaleLowerCase("tr");
  if (!u) return true;
  return DISCRETE_UNITS.has(u) || u.startsWith("adet");
}

/** Sayılabilir birimde yukarı yuvarla (2.857 Adet → 3). */
export function roundNeededQty(needed, unit) {
  const n = Number(needed);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (isDiscreteUnit(unit)) return Math.ceil(n - 1e-9);
  return Math.round(n * 1000) / 1000;
}

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
  // Kartta tek hammadde (ör. 16 Metre) varken material_* eksik olsa da onu kullan.
  if (!hit && mats.length === 1) hit = mats[0];
  const needed = Number(hit?.needed);
  if (hit && Number.isFinite(needed) && needed > 0 && (mid || mname || mats.length === 1)) {
    const unit = String(hit.unit || "Adet").trim() || "Adet";
    return {
      qty: roundNeededQty(needed, unit),
      unit,
      isMaterial: true,
      materialName: String(hit.product_name || mname || "").trim() || null,
    };
  }
  if (w?.finish_qty != null && Number(w.finish_qty) > 0) {
    const unit = String(w.finish_unit || w.unit || "Adet").trim() || "Adet";
    return {
      qty: roundNeededQty(Number(w.finish_qty), unit),
      unit,
      isMaterial: !!w.finish_is_material,
      materialName: mname || null,
    };
  }
  const unit = String(w?.unit || "Adet").trim() || "Adet";
  return {
    qty: roundNeededQty(Number(w?.planned_quantity || 0), unit),
    unit,
    isMaterial: false,
    materialName: null,
  };
}

/** Atölye kartı aksiyonları — durum → hangi butonlar. */
export function shopFloorCardActions(status, pauseAllowed = true) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "ready") return { start: true, pause: false, pauseEnabled: false, resume: false, finish: false };
  if (s === "in_progress" || s === "running" || s === "active") {
    return { start: false, pause: true, pauseEnabled: !!pauseAllowed, resume: false, finish: true };
  }
  if (s === "paused" || s === "pause") {
    return { start: false, pause: false, pauseEnabled: false, resume: true, finish: true };
  }
  return { start: false, pause: false, pauseEnabled: false, resume: false, finish: false };
}

/** Duraklat politikası faz etiketi (mesai / mola / OT). */
export function shopFloorPausePhaseLabel(phase) {
  const p = String(phase || "").trim().toLowerCase();
  if (p === "mesai") return "Mesai";
  if (p === "mola") return "Mola";
  if (p === "fazla_mesai") return "Fazla mesai";
  if (p === "tolerans") return "Mesai bitiş toleransı";
  return "Mesai dışı";
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

/** Sistem kullanıcısı (create-user) açılmış personel — atölye operatör listesi. */
export function employeeHasSystemUser(emp) {
  if (!emp) return false;
  if (emp.has_user === true) return true;
  if (emp.has_user === false) return false;
  const uid = String(emp.user_id || "").trim();
  return uid.length > 0 && uid !== "-";
}

export function shopFloorOperators(employees) {
  return (employees || []).filter(employeeHasSystemUser);
}
