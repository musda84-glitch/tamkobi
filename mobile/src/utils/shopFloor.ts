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

export function finishQtyError(produced: number, scrap: number, planned?: number | null): string | null {
  if (!Number.isFinite(produced) || !Number.isFinite(scrap) || produced < 0 || scrap < 0) {
    return "Miktar negatif olamaz.";
  }
  const plannedQ = Number(planned || 0);
  if (plannedQ && produced + scrap > plannedQ + 1e-9) {
    return `Üretilen + fire (${produced + scrap}) planlanan miktarı (${plannedQ}) aşamaz.`;
  }
  return null;
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

/** Üretim rolü /personnel listesini göremez; oturumdaki kartı operatör listesine ekle. */
export function mergeSelfEmployee(list: Employee[] | null | undefined, self?: Employee | null): Employee[] {
  const rows = list || [];
  if (!self) return rows;
  const sid = idOf(self);
  if (!sid) return rows;
  if (rows.some((e) => idOf(e) === sid)) return rows;
  return [self, ...rows];
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
