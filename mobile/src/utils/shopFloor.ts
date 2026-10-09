import { idOf } from "./money";
import type { Employee } from "./personnel";

export type WorkOrder = {
  id?: string;
  _id?: string;
  order_id?: string;
  order_code?: string;
  step_no?: number;
  step_count?: number;
  step_name?: string;
  product_name?: string;
  station?: string;
  job_file_name?: string;
  /** Reçete adım notu — atölyede iş dosyası yanında */
  step_note?: string;
  recipe_name?: string;
  material_name?: string;
  material_product_id?: string;
  materials?: { product_id?: string; product_name?: string; unit?: string; needed?: number }[];
  /** Reçete adımına bağlı istasyon görselleri */
  images?: string[];
  planned_quantity?: number;
  finish_qty?: number;
  finish_unit?: string;
  finish_is_material?: boolean;
  unit?: string;
  duration_min?: number;
  elapsed_min?: number;
  operator_name?: string;
  assigned_name?: string;
  assigned_to?: string;
  planned_date?: string;
  notes?: string;
  status?: string;
  produced_qty?: number;
  scrap_qty?: number;
  finished_at?: string;
  trash_request_pending?: boolean;
};

/** Web ShopFloorPage STATUS etiketleri. */
export const WO_STATUS_TR: Record<string, string> = {
  waiting: "Bekliyor",
  ready: "Hazır",
  in_progress: "Devam Ediyor",
  paused: "Duraklatıldı",
  done: "Tamamlandı",
};

export function woStatusTr(v?: string | null): string {
  if (!v) return "Bekliyor";
  return WO_STATUS_TR[v] || v;
}

export function woStatusTone(v?: string | null): "slate" | "green" | "amber" | "indigo" {
  if (v === "done") return "green";
  if (v === "ready") return "indigo";
  if (v === "in_progress" || v === "paused") return "amber";
  return "slate";
}

export function isOpenStatus(status?: string | null): boolean {
  return status !== "done" && status !== "waiting";
}

export function shopFloorStationKey(station?: string | null): string {
  return String(station || "").trim().toLocaleLowerCase("tr");
}

/** Operatörün in_progress işi başka istasyondaysa engel; paused serbest, başka personel engellemez. */
export function operatorStationLock(
  wos: WorkOrder[] | null | undefined,
  operatorName?: string | null,
  targetStation?: string | null,
  excludeId?: string | null,
): WorkOrder | null {
  const who = String(operatorName || "").trim();
  if (!who) return null;
  const target = shopFloorStationKey(targetStation);
  const ex = String(excludeId || "").trim();
  for (const w of wos || []) {
    if (String(w?.status || "") !== "in_progress") continue;
    if (String(w?.operator_name || "").trim() !== who) continue;
    const id = idOf(w);
    if (ex && id === ex) continue;
    if (shopFloorStationKey(w?.station) !== target) return w;
  }
  return null;
}

export function operatorStationLockMessage(blocker: WorkOrder | null | undefined, operatorName?: string | null): string {
  if (!blocker) return "";
  const who = String(operatorName || blocker.operator_name || "Operatör").trim() || "Operatör";
  const st = String(blocker.station || "başka istasyon").trim() || "başka istasyon";
  const code = String(blocker.order_code || "").trim();
  const step = blocker.step_no;
  const where = code && step != null ? `${code} · adım ${step}` : (code || "açık iş");
  return `${who} şu an «${st}» istasyonunda devam eden işi var (${where}). Bitirin veya duraklatın; başka istasyonda işlem açılamaz. Başka personel bu işi alabilir.`;
}

export function isMine(w: WorkOrder, operator?: string | null): boolean {
  if (!operator) return false;
  return w.operator_name === operator || w.assigned_name === operator;
}

export function partitionWorkOrders(wos: WorkOrder[], operator?: string | null) {
  const active = wos.filter((w) => isOpenStatus(w.status));
  const waiting = wos.filter((w) => w.status === "waiting");
  const done = wos.filter((w) => w.status === "done");
  const mine = active.filter((w) => isMine(w, operator));
  const others = active.filter((w) => !isMine(w, operator));
  return { active, waiting, done, mine, others };
}

export function readyCount(wos: WorkOrder[]): number {
  return wos.filter((w) => w.status === "ready").length;
}

export function runningCount(wos: WorkOrder[]): number {
  return wos.filter((w) => w.status === "in_progress" || w.status === "paused").length;
}

export function todayDoneCount(wos: WorkOrder[], today = new Date().toISOString().slice(0, 10)): number {
  return wos.filter((w) => w.status === "done" && String(w.finished_at || "").startsWith(today)).length;
}

/** Ana ekran rozeti: hazır + devam + duraklatılmış. */
export function openWorkOrderCount(wos: WorkOrder[] | null | undefined): number {
  return (wos || []).filter((w) => w.status === "ready" || w.status === "in_progress" || w.status === "paused").length;
}

/** Negatif miktar kontrolü. Plan üstü web ile aynı şekilde serbest (uyarı UI’da). */
export function finishQtyError(produced: number, scrap: number, _planned?: number | null): string | null {
  if (!Number.isFinite(produced) || !Number.isFinite(scrap) || produced < 0 || scrap < 0) {
    return "Miktar negatif olamaz.";
  }
  return null;
}

export function finishOverPlan(produced: number, scrap: number, planned?: number | null): boolean {
  const plannedQ = Number(planned || 0);
  if (!plannedQ || !Number.isFinite(produced) || !Number.isFinite(scrap)) return false;
  return produced + scrap > plannedQ + 1e-9;
}

export function shopFloorCardBorder(status?: string | null): string {
  const s = String(status || "").trim().toLowerCase();
  if (s === "in_progress" || s === "running" || s === "active") return "#F59E0B";
  if (s === "paused" || s === "pause") return "#FDBA74";
  if (s === "ready") return "#C7D2FE";
  return "#E2E8F0";
}

const DISCRETE_UNITS = new Set(["adet", "ad", "takım", "takim", "çift", "cift", "koli", "kutu", "paket", "set", "parça", "parca"]);

export function isDiscreteUnit(unit?: string | null): boolean {
  const u = String(unit || "").trim().toLocaleLowerCase("tr");
  if (!u) return true;
  return DISCRETE_UNITS.has(u) || u.startsWith("adet");
}

/** Sayılabilir birimde yukarı yuvarla (2.857 Adet → 3). */
export function roundNeededQty(needed: number, unit?: string | null): number {
  const n = Number(needed);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (isDiscreteUnit(unit)) return Math.ceil(n - 1e-9);
  return Math.round(n * 1000) / 1000;
}

export function formatQty(n: number | string | null | undefined): string {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  if (Number.isInteger(num) || Math.abs(num - Math.round(num)) < 1e-9) {
    return String(Math.round(num));
  }
  return String(Math.round(num * 1000) / 1000).replace(".", ",");
}

/** Bitir modalı: hammadde adımında kalem ihtiyacı (ör. 16 Metre). */
export function workOrderFinishPlan(w?: WorkOrder | null): {
  qty: number;
  unit: string;
  isMaterial: boolean;
  materialName: string | null;
} {
  const mats = Array.isArray(w?.materials) ? w!.materials! : [];
  const mid = String(w?.material_product_id || "").trim();
  const mname = String(w?.material_name || "").trim();
  let hit = mid ? mats.find((m) => String(m?.product_id || "").trim() === mid) : undefined;
  if (!hit && mname) {
    const key = mname.toLocaleLowerCase("tr");
    hit = mats.find((m) => String(m?.product_name || "").trim().toLocaleLowerCase("tr") === key);
  }
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

export type PausePolicy = {
  allowed?: boolean;
  phase?: string;
  reason?: string | null;
  deadline?: string | null;
};

export function shopFloorPausePhaseLabel(phase?: string | null): string {
  const p = String(phase || "").trim().toLowerCase();
  if (p === "mesai") return "Mesai";
  if (p === "mola") return "Mola";
  if (p === "fazla_mesai") return "Fazla mesai";
  if (p === "tolerans") return "Mesai bitiş toleransı";
  return "Mesai dışı";
}

export function employeeLabel(e: Employee): string {
  const name = e.full_name || "Personel";
  return e.position ? `${name} — ${e.position}` : name;
}

/** Sistem kullanıcısı (create-user) açılmış personel — atölye operatör listesi. */
export function employeeHasSystemUser(emp?: Employee | null): boolean {
  if (!emp) return false;
  if (emp.has_user === true) return true;
  if (emp.has_user === false) return false;
  const uid = String(emp.user_id || "").trim();
  return uid.length > 0 && uid !== "-";
}

export function shopFloorOperators(employees: Employee[] | null | undefined): Employee[] {
  return (employees || []).filter(employeeHasSystemUser);
}

/** Üretim rolü /personnel listesini göremez; oturumdaki kartı operatör listesine ekle. */
export function mergeSelfEmployee(list: Employee[] | null | undefined, self?: Employee | null): Employee[] {
  const rows = list || [];
  if (!self) return rows;
  const sid = idOf(self);
  if (!sid) return rows;
  const stamped = { ...self, has_user: true };
  if (rows.some((e) => idOf(e) === sid)) {
    return rows.map((e) => (idOf(e) === sid ? { ...e, has_user: true } : e));
  }
  return [stamped, ...rows];
}

export function woCardKey(w: WorkOrder): string {
  return idOf(w) || `${w.order_code || "wo"}-${w.step_no || 0}`;
}

export function stationKey(s?: string | null): string {
  return String(s || "").trim().toLocaleLowerCase("tr");
}

export function groupWorkOrdersByStation(wos: WorkOrder[]): WorkOrder[] {
  const buckets: WorkOrder[][] = [];
  const indexByKey = new Map<string, number>();
  const noStation: WorkOrder[] = [];
  for (const w of wos || []) {
    const key = stationKey(w.station);
    if (!key) {
      noStation.push(w);
      continue;
    }
    if (!indexByKey.has(key)) {
      indexByKey.set(key, buckets.length);
      buckets.push([]);
    }
    buckets[indexByKey.get(key)!].push(w);
  }
  return [...buckets.flat(), ...noStation];
}

export function shopFloorStationSections(wos: WorkOrder[]): { key: string; label: string; items: WorkOrder[] }[] {
  const sections: { key: string; label: string; items: WorkOrder[] }[] = [];
  for (const w of wos || []) {
    const key = stationKey(w.station) || "_none";
    const label = String(w.station || "").trim() || "İstasyon yok";
    const last = sections[sections.length - 1];
    if (!last || last.key !== key) sections.push({ key, label, items: [w] });
    else last.items.push(w);
  }
  return sections;
}
