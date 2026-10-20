import { formatTrQty } from "./money";

const DISCRETE_UNITS = new Set(["adet", "ad", "takım", "takim", "çift", "cift", "koli", "kutu", "paket", "set", "parça", "parca"]);
const BAD_QTY_TOKEN = /^(undefined|null|nan)$/i;

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

function displayUnit(...candidates) {
  for (const raw of candidates) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s || BAD_QTY_TOKEN.test(s)) continue;
    return s;
  }
  return "Adet";
}

/** null / undefined / boş miktar yok sayılır; 0 gerçek miktardır. */
function hasQty(value) {
  if (value == null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const n = Number(value);
  return Number.isFinite(n);
}

function finishedGoodsQtyLabel(w) {
  if (!hasQty(w?.planned_quantity)) return null;
  const unit = displayUnit(w?.finish_unit, w?.unit);
  return `${formatTrQty(w.planned_quantity)} ${unit}`.trim();
}

/**
 * Atölye kartı miktar etiketi.
 * Birim: finish_unit → unit → "Adet".
 * Miktar yoksa null (ekranda "0 undefined" yok).
 */
export function workOrderQtyLabel(w, plan) {
  const finished = finishedGoodsQtyLabel(w);
  if (plan?.isMaterial) {
    const unit = displayUnit(plan.unit);
    const main = hasQty(plan.qty) ? `${formatTrQty(plan.qty)} ${unit}`.trim() : null;
    if (main && finished) return `${main} · mamul ${finished}`;
    return main || finished || null;
  }
  return finished || null;
}

/** İstasyon karşılaştırması (TR). */
export function shopFloorStationKey(station) {
  return String(station || "").trim().toLocaleLowerCase("tr");
}

/**
 * Operatörün bitirilmemiş (in_progress) işi başka istasyondaysa engel satırı.
 * paused/done serbest; aynı istasyon serbest; başka personelin işi engellemez.
 * `wos` istasyon filtresiz olmalı (tablet kiosk’ta ayrı in_progress listesi verin).
 */
export function operatorStationLock(wos, operatorName, targetStation, excludeId = null) {
  const who = String(operatorName || "").trim();
  if (!who) return null;
  const target = shopFloorStationKey(targetStation);
  const ex = String(excludeId || "").trim();
  for (const w of wos || []) {
    if (String(w?.status || "") !== "in_progress") continue;
    if (String(w?.operator_name || "").trim() !== who) continue;
    const id = String(w?.id || w?._id || "").trim();
    if (ex && id === ex) continue;
    if (shopFloorStationKey(w?.station) !== target) return w;
  }
  return null;
}

export function operatorStationLockMessage(blocker, operatorName) {
  if (!blocker) return "";
  const who = String(operatorName || blocker.operator_name || "Operatör").trim() || "Operatör";
  const st = String(blocker.station || "başka istasyon").trim() || "başka istasyon";
  const code = String(blocker.order_code || "").trim();
  const step = blocker.step_no;
  const where = code && step != null ? `${code} · adım ${step}` : (code || "açık iş");
  return `${who} şu an «${st}» istasyonunda devam eden işi var (${where}). Bitirin veya duraklatın; başka istasyonda işlem açılamaz. Başka personel bu işi alabilir.`;
}

/** Atölye kartı aksiyonları — durum → hangi butonlar. */
export function shopFloorCardActions(status, pauseAllowed = true) {
  const s = String(status || "").trim().toLowerCase();
  // waiting: önceki adım bitmeden araya girilebilir
  if (s === "ready" || s === "waiting") {
    return { start: true, pause: false, pauseEnabled: false, resume: false, finish: false };
  }
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
  if (s === "ready" || s === "waiting") return "border-blue-200";
  return "border-slate-200";
}

/** Atölye kart sırası: in_progress → paused → ready → diğerleri. Eşitlikte giriş sırası korunur. */
export function sortWorkOrdersByStatus(list) {
  const rank = (status) => {
    const s = String(status || "").trim().toLowerCase();
    if (s === "in_progress") return 0;
    if (s === "paused") return 1;
    if (s === "ready") return 2;
    return 3;
  };
  return (Array.isArray(list) ? list : []).map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = rank(a.item?.status) - rank(b.item?.status);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ item }) => item);
}

/** paused_at → "12 dk" / "1 sa 12 dk". Yok veya geçersizse "". */
export function pausedForLabel(pausedAt, now = new Date()) {
  if (pausedAt == null || pausedAt === "") return "";
  const start = new Date(pausedAt).getTime();
  if (!Number.isFinite(start)) return "";
  const end = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(end) || end < start) return "";
  const totalMin = Math.floor((end - start) / 60000);
  if (totalMin < 60) return `${totalMin} dk`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${hours} sa ${mins} dk`;
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
