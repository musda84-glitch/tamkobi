import type { DashboardStats, Overview, User } from "../types";
import { fmtMoney } from "./money";
import { hasSelfPersonnelRecord } from "./permissions";

export type HomeTask = { key: string; label: string; count: number; extra?: string | null; path: string };

/** Rolün göreceği şirket işleri; personel kartı varken finans KPI’ları düşmez. */
const TASK_ROLES: Record<string, string[]> = {
  pending_orders: ["admin", "manager", "sales", "warehouse"],
  pick_missing: ["admin", "manager", "warehouse", "production"],
  due_today: ["admin", "manager", "accountant"],
  overdue: ["admin", "manager", "accountant"],
  installments: ["admin", "manager", "accountant"],
  cheques: ["admin", "manager", "accountant"],
  drafts: ["admin", "manager", "accountant"],
  quotes: ["admin", "manager", "sales"],
  critical_stock: ["admin", "manager", "warehouse", "production"],
  leaves: ["admin", "manager", "accountant"],
};

export function visibleHomeTasks(
  tasks: HomeTask[] | null | undefined,
  user?: User | null,
  mine?: { openTasks?: number; openWorkOrders?: number },
): HomeTask[] {
  const role = (user?.role || "").toLowerCase();
  const staff = hasSelfPersonnelRecord(user || null);
  const company = (tasks || []).filter((t) => {
    if (!staff) return true;
    if (role === "admin") return false;
    const allowed = TASK_ROLES[t.key];
    return !allowed || allowed.includes(role);
  });
  const personal: HomeTask[] = [];
  if (staff) {
    const openTasks = Number(mine?.openTasks || 0);
    const openWorkOrders = Number(mine?.openWorkOrders || 0);
    if (openTasks) personal.push({ key: "my_tasks", label: "Bana atanan görev", count: openTasks, path: "/personelim?tab=gorevler" });
    if (openWorkOrders) personal.push({ key: "my_work_orders", label: "Bana atanan iş emri", count: openWorkOrders, path: "/atolye" });
  }
  return [...personal, ...company];
}

/** Geçen aya göre değişim; önceki ay satış yoksa sunucu null döner. */
export function salesChangeText(pct?: number | null): string {
  if (pct == null || !Number.isFinite(Number(pct))) return "";
  const n = Number(pct);
  const sign = n > 0 ? "▲" : n < 0 ? "▼" : "";
  return `${sign}%${Math.abs(n).toLocaleString("tr-TR")} geçen aya göre`;
}

/** Ciro yüklenemezse fatura adedine düşer; ekran boş kalmaz. */
export function monthlySalesRow(
  stats: DashboardStats | null,
  overview: Overview | null
): { label: string; value: string; hint: string } {
  const count = overview?.invoices?.outgoing?.month ?? 0;
  const sales = stats?.monthly_sales;
  if (sales == null) {
    return { label: "Bu ay satış", value: String(count), hint: "Fatura adedi" };
  }
  const change = salesChangeText(stats?.sales_change_pct);
  return {
    label: "Bu ay ciro",
    value: fmtMoney(sales),
    hint: [`${count} fatura`, change].filter(Boolean).join(" · "),
  };
}

export function netProfitRow(stats: DashboardStats | null): { label: string; value: string; hint: string } | null {
  if (!stats || stats.net_profit == null) return null;
  return {
    label: "Bu ay net kâr",
    value: fmtMoney(stats.net_profit),
    hint: `Gider ${fmtMoney(stats.monthly_expenses)}`,
  };
}
