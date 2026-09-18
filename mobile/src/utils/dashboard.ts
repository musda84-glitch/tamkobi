import type { DashboardStats, Overview } from "../types";
import { fmtMoney } from "./money";

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
