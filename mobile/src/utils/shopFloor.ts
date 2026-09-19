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
  planned_quantity?: number;
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
