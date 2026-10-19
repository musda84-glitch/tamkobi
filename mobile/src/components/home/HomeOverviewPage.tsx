import React from "react";
import { Pressable, Text, View } from "react-native";
import { HomeHeaderTitle } from "../HomeHeaderTitle";
import { Card, Muted, Row } from "../kit";
import { goHref } from "../../nav";
import { colors } from "../../theme";
import type { DashboardStats, LowStockProduct, ManagerSummary, Overview, User } from "../../types";
import { monthlySalesRow, netProfitRow, salesChangeText, visibleHomeTasks } from "../../utils/dashboard";
import { trUpper } from "../../utils/labels";
import { fmtMoney, idOf } from "../../utils/money";
import { resolveMobilePath } from "../../utils/quickMenu";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function moneyOrDash(value: unknown): string {
  return finite(value) ? fmtMoney(value) : "—";
}

function countOrDash(value: unknown): string {
  return finite(value) ? String(value) : "—";
}

function qtyOrDash(value: unknown): string {
  return finite(value) ? value.toLocaleString("tr-TR") : "—";
}

function budgetPct(cost: unknown, budget: unknown): string {
  if (!finite(cost) || !finite(budget) || budget === 0) return "—";
  return `%${Math.round((cost / budget) * 100)}`;
}

function summaryBlock<K extends "production" | "projects">(
  manager: ManagerSummary | null | undefined,
  key: K,
): NonNullable<ManagerSummary[K]> | null {
  if (!manager || typeof manager !== "object" || Array.isArray(manager)) return null;
  if (!Object.prototype.hasOwnProperty.call(manager, key)) return null;
  const value = manager[key];
  if (!value || typeof value !== "object") return null;
  return value;
}

function MiniStat({ label, value, tone, testID }: { label: string; value: string; tone?: string; testID?: string }) {
  return (
    <View testID={testID} style={{ flex: 1, minWidth: 0, backgroundColor: colors.slate50, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8 }}>
      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.muted }} numberOfLines={1}>{trUpper(label)}</Text>
      <Text style={{ fontSize: 16, fontWeight: "800", color: tone || colors.text }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function MoneyBar({
  title,
  testID,
  data,
  overdueColor,
  pendingColor,
}: {
  title: string;
  testID: string;
  data?: { total?: number; overdue?: number; not_due?: number } | null;
  overdueColor: string;
  pendingColor: string;
}) {
  const total = finite(data?.total) ? data.total : null;
  const overdue = finite(data?.overdue) ? data.overdue : null;
  const notDue = finite(data?.not_due) ? data.not_due : null;
  const overdueWidth = total != null && overdue != null && total > 0 ? (overdue / total) * 100 : 0;
  const notDueWidth = total != null && notDue != null && total > 0 ? (notDue / total) * 100 : 0;
  return (
    <Card testID={testID}>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "800", color: colors.text }}>{title}</Text>
        <Text style={{ fontWeight: "800", color: colors.text }}>{total == null ? "—" : fmtMoney(total)}</Text>
      </Row>
      <View testID={`${testID}-bar`} style={{ height: 8, borderRadius: 999, backgroundColor: colors.slate100, overflow: "hidden", flexDirection: "row" }}>
        {overdueWidth > 0 ? <View style={{ width: `${overdueWidth}%`, backgroundColor: overdueColor, minWidth: 4 }} /> : null}
        {notDueWidth > 0 ? <View style={{ width: `${notDueWidth}%`, backgroundColor: pendingColor }} /> : null}
      </View>
      <Text style={{ fontSize: 11, color: colors.muted }}>
        <Text style={{ color: overdueColor, fontWeight: "700" }}>Gecikmiş {overdue == null ? "—" : fmtMoney(overdue)}</Text>
        {" · "}
        <Text style={{ color: pendingColor, fontWeight: "700" }}>Vadesi gelmemiş {notDue == null ? "—" : fmtMoney(notDue)}</Text>
      </Text>
    </Card>
  );
}

/** Sayfa 0: yönetici genel bakış. Alan yoksa "—"; uydurma tutar yok. */
export function HomeOverviewPage({
  userName,
  companyName,
  logoUrl,
  user,
  stats,
  overview,
  manager,
}: {
  userName?: string | null;
  companyName?: string | null;
  logoUrl?: string | null;
  user?: User | null;
  stats: DashboardStats | null;
  overview: Overview | null;
  manager: ManagerSummary | null;
}) {
  const sales = monthlySalesRow(stats, overview);
  const change = salesChangeText(stats?.sales_change_pct);
  const monthCount = overview?.invoices?.outgoing?.month;
  const invoiceText = finite(monthCount) ? `${monthCount} fatura` : "—";
  const tasks = visibleHomeTasks(overview?.tasks, user);
  const todos = [...tasks];
  const receivables = stats?.total_receivables;
  if (finite(receivables) && receivables > 0 && !todos.some((t) => t.key === "receivable")) {
    todos.push({
      key: "receivable",
      label: "Tahsil edilecek",
      count: 0,
      extra: fmtMoney(receivables),
      path: "/invoices",
    });
  }
  const products = (Array.isArray(stats?.low_stock_products) ? stats.low_stock_products : []).slice(0, 5);
  const stockCount = countOrDash(stats?.low_stock_count);
  const production = summaryBlock(manager, "production");
  const projects = summaryBlock(manager, "projects");
  const profit = netProfitRow(stats);
  const net = stats?.net_profit;
  const loss = finite(net) && net < 0;
  const kpis: { key: string; label: string; value: string; hint?: string; valueColor?: string }[] = [
    { key: "bank", label: "Kasa & Banka", value: moneyOrDash(stats?.total_bank_balance) },
    { key: "recv", label: "Alacak", value: moneyOrDash(stats?.total_receivables), valueColor: colors.primary },
    { key: "pay", label: "Borç", value: moneyOrDash(stats?.total_payables), valueColor: colors.danger },
    {
      key: "profit",
      label: "Net kâr",
      value: profit?.value ?? "—",
      hint: profit?.hint ?? (finite(stats?.monthly_expenses) ? `Gider ${fmtMoney(stats.monthly_expenses)}` : "Gider —"),
      valueColor: loss ? colors.danger : colors.text,
    },
  ];

  return (
    <View testID="home-overview" accessibilityLabel="Genel Bakış" style={{ gap: 12 }}>
      <HomeHeaderTitle name={userName} company={companyName} logoUrl={logoUrl} />

      <Card testID="home-overview-sales" style={{ backgroundColor: colors.indigo50, borderColor: "#C7D2FE" }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, letterSpacing: 0.3 }}>{trUpper(sales.label)}</Text>
        <Text testID="home-overview-sales-value" style={{ fontSize: 28, fontWeight: "800", color: "#1E1B4B" }}>{sales.value}</Text>
        <Muted>Kesilen satış faturaları (taslak ve iptal hariç)</Muted>
        <Muted testID="home-overview-sales-meta">{invoiceText} · {change || "—"}</Muted>
        <Text testID="home-overview-today" style={{ color: colors.indigo, fontWeight: "700", fontSize: 12 }}>
          Bugün {moneyOrDash(stats?.today_sales)}
        </Text>
      </Card>

      <Card testID="home-overview-tasks">
        <Text style={{ fontSize: 11, fontWeight: "800", letterSpacing: 0.4, color: colors.muted }}>{trUpper("Bugün yapılacaklar")}</Text>
        {!todos.length ? <Muted>Bekleyen görev yok.</Muted> : todos.map((t) => {
          const href = resolveMobilePath(t.path);
          const row = (
            <Row style={{ justifyContent: "space-between", paddingVertical: 8 }}>
              <Text style={{ color: colors.text, flex: 1, fontWeight: "700" }}>{t.label}{t.extra ? ` · ${t.extra}` : ""}</Text>
              {t.key === "receivable" ? null : (
                <View style={{ minWidth: 28, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: t.count ? colors.amber50 : colors.slate100 }}>
                  <Text style={{ fontWeight: "800", fontSize: 12, color: t.count ? "#B45309" : colors.muted, textAlign: "center" }}>{String(t.count)}</Text>
                </View>
              )}
            </Row>
          );
          if (!href) return <View key={t.key} testID={`home-overview-task-${t.key}`}>{row}</View>;
          return (
            <Pressable key={t.key} onPress={() => goHref(href)} testID={`home-overview-task-${t.key}`}>
              {row}
            </Pressable>
          );
        })}
      </Card>

      <View testID="home-overview-kpis" style={{ gap: 8 }}>
        {[kpis.slice(0, 2), kpis.slice(2)].map((row) => (
          <View key={row.map((item) => item.key).join("-")} style={{ flexDirection: "row", gap: 8 }}>
            {row.map((item) => (
              <Card key={item.key} testID={`home-overview-kpi-${item.key}`} style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted }}>{trUpper(item.label)}</Text>
                <Text style={{ fontSize: 16, fontWeight: "800", color: item.valueColor || colors.text }}>{item.value}</Text>
                {item.hint ? <Text style={{ fontSize: 11, color: colors.muted }}>{item.hint}</Text> : null}
              </Card>
            ))}
          </View>
        ))}
      </View>

      <MoneyBar title="Tahsilat" testID="home-overview-collections" data={overview?.collections} overdueColor={colors.danger} pendingColor={colors.primary} />
      <MoneyBar title="Ödeme" testID="home-overview-payments" data={overview?.payments} overdueColor={colors.danger} pendingColor="#0284C7" />

      <Card testID="home-overview-stock">
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", color: colors.text }}>Kritik stok · {stockCount}</Text>
          <Pressable testID="home-overview-stock-all" onPress={() => goHref("/stok")} hitSlop={8}>
            <Text style={{ color: colors.primary, fontWeight: "800" }}>Tümü ›</Text>
          </Pressable>
        </Row>
        {products.map((product, index) => (
          <StockRow key={idOf(product) || `${product.sku || "sku"}-${index}`} product={product} index={index} />
        ))}
      </Card>

      {production || projects ? (
        <View testID="home-overview-manager" style={{ flexDirection: "column", gap: 8 }}>
          {production ? (
            <Pressable testID="home-overview-production" onPress={() => goHref("/production")} style={{ width: "100%" }}>
              <Card>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text style={{ fontWeight: "800", color: colors.text }}>Üretim</Text>
                  <Text style={{ color: colors.indigo, fontWeight: "700", fontSize: 12 }}>Üretim ›</Text>
                </Row>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <MiniStat label="Açık" value={countOrDash(production.open)} tone={colors.indigo} />
                  <MiniStat label="Geciken" value={countOrDash(production.late)} tone={finite(production.late) && production.late > 0 ? colors.danger : colors.text} />
                  <MiniStat label="Bu ay biten" value={countOrDash(production.completed_this_month)} tone={colors.primary} />
                </View>
              </Card>
            </Pressable>
          ) : null}
          {projects ? (
            <Pressable testID="home-overview-projects" onPress={() => goHref("/projects")} style={{ width: "100%" }}>
              <Card>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text style={{ fontWeight: "800", color: colors.text }}>Projeler</Text>
                  <Text style={{ color: "#1D4ED8", fontWeight: "700", fontSize: 12 }}>Projeler ›</Text>
                </Row>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <MiniStat label="Aktif" value={countOrDash(projects.active)} tone="#1D4ED8" />
                  <MiniStat label="Geciken" value={countOrDash(projects.overdue)} tone={finite(projects.overdue) && projects.overdue > 0 ? colors.danger : colors.text} />
                  <MiniStat testID="home-overview-budget" label="Bütçe" value={budgetPct(projects.cost_total, projects.budget_total)} />
                </View>
              </Card>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function StockRow({ product, index }: { product: LowStockProduct; index: number }) {
  const name = String(product.name || product.sku || "").trim();
  return (
    <Pressable testID={`home-overview-stock-${index}`} onPress={() => goHref("/stok")} style={{ paddingVertical: 6 }}>
      <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={1}>{name || "—"}</Text>
      <Muted>Stok {qtyOrDash(product.stock_quantity)} · eşik {qtyOrDash(product.min_stock_alert)}</Muted>
    </Pressable>
  );
}
