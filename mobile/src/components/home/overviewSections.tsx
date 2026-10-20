import React from "react";
import { Pressable, Text, View } from "react-native";
import { HomePanels, type HomePanelProps } from "./HomePanels";
import { Card, Muted, Row } from "../kit";
import { goHref } from "../../nav";
import { colors } from "../../theme";
import type { LowStockProduct, ManagerProductionSummary, ManagerProjectsSummary } from "../../types";
import type { HomeTask } from "../../utils/dashboard";
import { monthTitle } from "../../utils/calendar";
import { trUpper } from "../../utils/labels";
import { fmtMoney, idOf } from "../../utils/money";
import { resolveMobilePath } from "../../utils/quickMenu";

/** Sıkıştırma ölçüleri. Kök boşluk, satır dolgusu ve KPI punto tek yerde. */
export const COMPACT = {
  cardPad: 10,
  rowPadV: 4,
  stockPadV: 3,
  gap: 8,
  kpiValue: 14,
  label: 10,
  salesValue: 24,
  barHeight: 6,
  miniPadV: 6,
  miniValue: 15,
  badgeMin: 24,
  boxRadius: 10,
  boxPad: 8,
} as const;

export type OverviewSectionKey = "today" | "panels" | "month" | "stock" | "production" | "projects";

/**
 * Kalıcı bölüm anahtarları (AsyncStorage). Bu metinler veri sözleşmesidir;
 * yeniden adlandırma yasak: "today", "panels", "month", "stock", "production", "projects".
 */
export const DEFAULT_OVERVIEW_SECTION_ORDER: OverviewSectionKey[] = [
  "today",
  "panels",
  "month",
  "stock",
  "production",
  "projects",
];

/** DEFAULT_OVERVIEW_SECTION_ORDER ile aynı küme. Kalıcı anahtar; yeniden adlandırma yasak. */
export const OVERVIEW_SECTION_KEYS: readonly OverviewSectionKey[] = DEFAULT_OVERVIEW_SECTION_ORDER;

export function isOverviewSectionKey(value: unknown): value is OverviewSectionKey {
  return typeof value === "string" && (OVERVIEW_SECTION_KEYS as readonly string[]).includes(value);
}

export type OverviewKpi = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  valueColor?: string;
};

type MoneySlice = { total?: number; overdue?: number; not_due?: number } | null;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

/** Sayı 0 ve satır yoksa gizlenir. Alan yoksa "Kritik stok · —" kalır. */
export function isStockSectionEmpty(count: unknown, productCount: number): boolean {
  return productCount <= 0 && finite(count) && count === 0;
}

/** overview.date veya KDV ayı → "Ekim 2026". İkisi de yoksa yerel ay. */
export function overviewMonthTitle(dateLike?: string | null): string {
  const match = /^(\d{4})-(\d{2})/.exec(String(dateLike || ""));
  if (match) {
    const month0 = Number(match[2]) - 1;
    if (month0 >= 0 && month0 <= 11) return monthTitle(Number(match[1]), month0);
  }
  const now = new Date();
  return monthTitle(now.getFullYear(), now.getMonth());
}

function MiniStat({ label, value, tone, testID }: { label: string; value: string; tone?: string; testID?: string }) {
  return (
    <View testID={testID} style={{ flex: 1, minWidth: 0, backgroundColor: colors.slate50, borderRadius: COMPACT.boxRadius, paddingVertical: COMPACT.miniPadV, paddingHorizontal: COMPACT.boxPad }}>
      <Text style={{ fontSize: COMPACT.label, fontWeight: "700", color: colors.muted }} numberOfLines={1}>{trUpper(label)}</Text>
      <Text style={{ fontSize: COMPACT.miniValue, fontWeight: "800", color: tone || colors.text }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function MoneyBar({
  title,
  testID,
  data,
  overdueColor,
  pendingColor,
  compact,
}: {
  title: string;
  testID: string;
  data?: MoneySlice;
  overdueColor: string;
  pendingColor: string;
  compact?: boolean;
}) {
  const total = finite(data?.total) ? data.total : null;
  const overdue = finite(data?.overdue) ? data.overdue : null;
  const notDue = finite(data?.not_due) ? data.not_due : null;
  const overdueWidth = total != null && overdue != null && total > 0 ? (overdue / total) * 100 : 0;
  const notDueWidth = total != null && notDue != null && total > 0 ? (notDue / total) * 100 : 0;
  const body = (
    <>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "800", fontSize: compact ? 12 : undefined, color: colors.text }}>{title}</Text>
        <Text style={{ fontWeight: "800", fontSize: compact ? 12 : undefined, color: colors.text }}>{total == null ? "—" : fmtMoney(total)}</Text>
      </Row>
      <View testID={`${testID}-bar`} style={{ height: compact ? COMPACT.barHeight : 8, borderRadius: 999, backgroundColor: colors.slate100, overflow: "hidden", flexDirection: "row" }}>
        {overdueWidth > 0 ? <View style={{ width: `${overdueWidth}%`, backgroundColor: overdueColor, minWidth: 4 }} /> : null}
        {notDueWidth > 0 ? <View style={{ width: `${notDueWidth}%`, backgroundColor: pendingColor }} /> : null}
      </View>
      <Text style={{ fontSize: compact ? COMPACT.label : 11, color: colors.muted }} numberOfLines={1}>
        <Text style={{ color: overdueColor, fontWeight: "700" }}>Gecikmiş {overdue == null ? "—" : fmtMoney(overdue)}</Text>
        {" · "}
        <Text style={{ color: pendingColor, fontWeight: "700" }}>Vadesi gelmemiş {notDue == null ? "—" : fmtMoney(notDue)}</Text>
      </Text>
    </>
  );
  if (compact) return <View testID={testID} style={{ gap: 4 }}>{body}</View>;
  return <Card testID={testID}>{body}</Card>;
}

function MoneyLegend() {
  return (
    <Text style={{ fontSize: COMPACT.label, color: colors.muted }} numberOfLines={1}>
      <Text style={{ color: colors.danger, fontWeight: "700" }}>Gecikmiş</Text>
      {" · "}
      <Text style={{ color: colors.primary, fontWeight: "700" }}>Vadesi gelmemiş</Text>
    </Text>
  );
}

export function TodaySection({ todos }: { todos: HomeTask[] }) {
  return (
    <Card testID="home-overview-tasks" style={{ padding: COMPACT.cardPad }}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{trUpper("Bugün")}</Text>
      {!todos.length ? <Muted numberOfLines={1}>Bekleyen görev yok.</Muted> : todos.map((t) => {
        const href = resolveMobilePath(t.path);
        const row = (
          <Row style={{ justifyContent: "space-between", paddingVertical: COMPACT.rowPadV }}>
            <Text style={{ color: colors.text, flex: 1, fontWeight: "700" }} numberOfLines={1}>{t.label}{t.extra ? ` · ${t.extra}` : ""}</Text>
            {t.key === "receivable" ? null : (
              <View style={{ minWidth: COMPACT.badgeMin, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: t.count ? colors.amber50 : colors.slate100, flexShrink: 0 }}>
                <Text style={{ fontWeight: "800", fontSize: 11, color: t.count ? "#B45309" : colors.muted, textAlign: "center" }}>{String(t.count)}</Text>
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
  );
}

/** Mevcut bildirim / onay / mesaj sarmalayıcısı. İç marginTop değerleri HomePanels'te kalır. */
export function PanelsSection(props: HomePanelProps) {
  return (
    <View testID="home-overview-panels">
      <HomePanels {...props} />
    </View>
  );
}

export function MonthSection({
  title,
  salesLabel,
  salesValue,
  invoiceText,
  salesMeta,
  todayText,
  kpiRows,
  collections,
  payments,
}: {
  title: string;
  salesLabel: string;
  salesValue: string;
  invoiceText: string;
  salesMeta: string;
  todayText: string;
  kpiRows: OverviewKpi[][];
  collections?: MoneySlice;
  payments?: MoneySlice;
}) {
  return (
    <Card testID="home-overview-month" style={{ padding: COMPACT.cardPad }}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }} numberOfLines={1}>{title}</Text>
      <View testID="home-overview-sales" style={{ backgroundColor: colors.indigo50, borderRadius: COMPACT.boxRadius, padding: COMPACT.boxPad, gap: 2 }}>
        <Text style={{ fontSize: COMPACT.label, fontWeight: "700", color: colors.muted, letterSpacing: 0.3 }} numberOfLines={1}>{trUpper(salesLabel)}</Text>
        <Row style={{ alignItems: "baseline", gap: 8 }}>
          <Text testID="home-overview-sales-value" style={{ fontSize: COMPACT.salesValue, fontWeight: "800", color: "#1E1B4B", flexShrink: 1 }} numberOfLines={1}>{salesValue}</Text>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }} numberOfLines={1}>{invoiceText}</Text>
        </Row>
        <Muted numberOfLines={1}>Kesilen satış faturaları (taslak ve iptal hariç)</Muted>
        <Muted testID="home-overview-sales-meta">{salesMeta}</Muted>
        <Text testID="home-overview-today" style={{ color: colors.indigo, fontWeight: "700", fontSize: 12 }} numberOfLines={1}>{todayText}</Text>
      </View>
      <View testID="home-overview-kpis" style={{ gap: COMPACT.gap }}>
        {kpiRows.map((row) => (
          <View key={row.map((item) => item.key).join("-")} style={{ flexDirection: "row", gap: COMPACT.gap }}>
            {row.map((item) => (
              <View key={item.key} testID={`home-overview-kpi-${item.key}`} style={{ flex: 1, minWidth: 0, backgroundColor: colors.slate50, borderRadius: COMPACT.boxRadius, padding: COMPACT.boxPad }}>
                <Text style={{ fontSize: COMPACT.label, fontWeight: "700", color: colors.muted }} numberOfLines={1}>{trUpper(item.label)}</Text>
                <Text style={{ fontSize: COMPACT.kpiValue, fontWeight: "800", color: item.valueColor || colors.text }} numberOfLines={1}>{item.value}</Text>
                {item.hint ? <Text style={{ fontSize: COMPACT.label, color: colors.muted }} numberOfLines={1}>{item.hint}</Text> : null}
              </View>
            ))}
          </View>
        ))}
      </View>
      <MoneyBar compact title="Tahsilat" testID="home-overview-collections" data={collections} overdueColor={colors.danger} pendingColor={colors.primary} />
      <MoneyBar compact title="Ödeme" testID="home-overview-payments" data={payments} overdueColor={colors.danger} pendingColor="#0284C7" />
      <MoneyLegend />
    </Card>
  );
}

export function StockSection({
  countLabel,
  products,
}: {
  countLabel: string;
  products: LowStockProduct[];
}) {
  return (
    <Card testID="home-overview-stock" style={{ padding: COMPACT.cardPad }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text, flex: 1 }} numberOfLines={1}>Kritik stok · {countLabel}</Text>
        <Pressable testID="home-overview-stock-all" onPress={() => goHref("/stok")} hitSlop={8}>
          <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 12 }}>Tümü ›</Text>
        </Pressable>
      </Row>
      {products.map((product, index) => (
        <StockRow key={idOf(product) || `${product.sku || "sku"}-${index}`} product={product} index={index} />
      ))}
    </Card>
  );
}

function StockRow({ product, index }: { product: LowStockProduct; index: number }) {
  const name = String(product.name || product.sku || "").trim();
  return (
    <Pressable testID={`home-overview-stock-${index}`} onPress={() => goHref("/stok")} style={{ paddingVertical: COMPACT.stockPadV }}>
      <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={1}>{name || "—"}</Text>
      <Muted>Stok {qtyOrDash(product.stock_quantity)} · eşik {qtyOrDash(product.min_stock_alert)}</Muted>
    </Pressable>
  );
}

export function ProductionSection({ production }: { production: ManagerProductionSummary | null | undefined }) {
  if (!production) return null;
  return (
    <Pressable testID="home-overview-production" onPress={() => goHref("/production")} style={{ width: "100%" }}>
      <Card style={{ padding: COMPACT.cardPad }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>Üretim</Text>
          <Text style={{ color: colors.indigo, fontWeight: "700", fontSize: 12 }}>Üretim ›</Text>
        </Row>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <MiniStat label="Açık" value={countOrDash(production.open)} tone={colors.indigo} />
          <MiniStat label="Geciken" value={countOrDash(production.late)} tone={finite(production.late) && production.late > 0 ? colors.danger : colors.text} />
          <MiniStat label="Bu ay biten" value={countOrDash(production.completed_this_month)} tone={colors.primary} />
        </View>
      </Card>
    </Pressable>
  );
}

export function ProjectsSection({ projects }: { projects: ManagerProjectsSummary | null | undefined }) {
  if (!projects) return null;
  return (
    <Pressable testID="home-overview-projects" onPress={() => goHref("/projects")} style={{ width: "100%" }}>
      <Card style={{ padding: COMPACT.cardPad }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>Projeler</Text>
          <Text style={{ color: "#1D4ED8", fontWeight: "700", fontSize: 12 }}>Projeler ›</Text>
        </Row>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <MiniStat label="Aktif" value={countOrDash(projects.active)} tone="#1D4ED8" />
          <MiniStat label="Geciken" value={countOrDash(projects.overdue)} tone={finite(projects.overdue) && projects.overdue > 0 ? colors.danger : colors.text} />
          <MiniStat testID="home-overview-budget" label="Bütçe" value={budgetPct(projects.cost_total, projects.budget_total)} />
        </View>
      </Card>
    </Pressable>
  );
}
