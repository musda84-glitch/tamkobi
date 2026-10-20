import React from "react";
import { View } from "react-native";
import { HomeHeaderTitle } from "../HomeHeaderTitle";
import type { HomePanelProps } from "./HomePanels";
import {
  COMPACT,
  isStockSectionEmpty,
  MonthSection,
  overviewMonthTitle,
  PanelsSection,
  ProductionSection,
  ProjectsSection,
  StockSection,
  TodaySection,
  type OverviewKpi,
  type OverviewSectionKey,
} from "./overviewSections";
import { colors } from "../../theme";
import type { DashboardStats, ManagerSummary, Overview, User } from "../../types";
import { monthlySalesRow, netProfitRow, salesChangeText, visibleHomeTasks } from "../../utils/dashboard";
import { fmtMoney } from "../../utils/money";
import { normalizeOverviewOrder } from "../../utils/homeOverviewOrder";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function moneyOrDash(value: unknown): string {
  return finite(value) ? fmtMoney(value) : "—";
}

function countOrDash(value: unknown): string {
  return finite(value) ? String(value) : "—";
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

const MANAGER_KEYS: OverviewSectionKey[] = ["production", "projects"];

/** Sayfa 0: yönetici genel bakış. Alan yoksa "—"; uydurma tutar yok. Sıra sectionOrder; yoksa varsayılan. */
export function HomeOverviewPage({
  userName,
  companyName,
  logoUrl,
  user,
  stats,
  overview,
  manager,
  sectionOrder,
  ...panelProps
}: {
  userName?: string | null;
  companyName?: string | null;
  logoUrl?: string | null;
  user?: User | null;
  stats: DashboardStats | null;
  overview: Overview | null;
  manager: ManagerSummary | null;
  sectionOrder?: readonly OverviewSectionKey[];
} & HomePanelProps) {
  const order = normalizeOverviewOrder(sectionOrder);
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
  const kpis: OverviewKpi[] = [
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
    { key: "vat", label: "KDV ödenecek", value: moneyOrDash(overview?.vat?.payable), hint: `${overview?.vat?.days_left ?? "—"} gün` },
  ];
  const kpiRows = Array.from({ length: Math.ceil(kpis.length / 2) }, (_, index) => kpis.slice(index * 2, index * 2 + 2));

  const renderSection = (key: OverviewSectionKey): React.ReactNode => {
    switch (key) {
      case "today":
        return <TodaySection todos={todos} />;
      case "panels":
        return <PanelsSection {...panelProps} />;
      case "month":
        return (
          <MonthSection
            title={overviewMonthTitle(overview?.date || overview?.vat?.month)}
            salesLabel={sales.label}
            salesValue={sales.value}
            invoiceText={invoiceText}
            salesMeta={`${invoiceText} · ${change || "—"}`}
            todayText={`Bugün ${moneyOrDash(stats?.today_sales)}`}
            kpiRows={kpiRows}
            collections={overview?.collections}
            payments={overview?.payments}
          />
        );
      case "stock":
        if (isStockSectionEmpty(stats?.low_stock_count, products.length)) return null;
        return <StockSection countLabel={stockCount} products={products} />;
      case "production":
        if (!production) return null;
        return <ProductionSection production={production} />;
      case "projects":
        if (!projects) return null;
        return <ProjectsSection projects={projects} />;
      default: {
        const unexpected: never = key;
        return unexpected;
      }
    }
  };

  const pieces = order.map((key) => {
    const content = renderSection(key);
    if (content == null) return null;
    return (
      <View key={key} testID={`home-overview-section-${key}`}>
        {content}
      </View>
    );
  });

  const body: React.ReactNode[] = [];
  const managerChildren: React.ReactElement[] = [];
  let managerGroup = 0;
  const flushManager = () => {
    if (!managerChildren.length) return;
    const index = managerGroup;
    managerGroup += 1;
    body.push(
      <View
        key={`manager-${index}`}
        {...(index === 0 ? { testID: "home-overview-manager" } : {})}
        style={{ flexDirection: "column", gap: COMPACT.gap }}
      >
        {managerChildren.splice(0, managerChildren.length)}
      </View>,
    );
  };
  order.forEach((key, index) => {
    const piece = pieces[index];
    if (MANAGER_KEYS.includes(key)) {
      if (piece) managerChildren.push(piece);
      return;
    }
    flushManager();
    if (piece) body.push(piece);
  });
  flushManager();

  return (
    <View testID="home-overview" accessibilityLabel="Genel Bakış" style={{ gap: COMPACT.gap }}>
      <HomeHeaderTitle name={userName} company={companyName} logoUrl={logoUrl} />
      {body}
    </View>
  );
}
