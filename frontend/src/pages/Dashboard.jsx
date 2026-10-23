import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";
import { OverviewPanel } from "../components/OverviewPanel";
import { DemoContentCard } from "../components/DemoContentCard";
import { PersonnelRequestsInbox } from "../components/PersonnelRequestsInbox";
import { EdocPendingInbox } from "../components/EdocPendingInbox";
import { MarketplaceQuestionsInbox } from "../components/MarketplaceQuestionsInbox";
import { OpsAlertsPanel } from "../components/OpsAlertsPanel";
import { StaffMessagesPanel } from "../components/StaffMessagesPanel";
import { DashboardHero } from "../components/DashboardHero";
import { DashboardProductionCard } from "../components/DashboardProductionCard";
import { DashboardProjectsCard } from "../components/DashboardProjectsCard";
import { DashboardShopFloorPerf } from "../components/DashboardShopFloorPerf";
import { ProductionAiAdvisor } from "../components/ProductionAiAdvisor";
import { useManagerSummary } from "../components/DashboardManagerSection";
import { useDashboardLayout } from "../hooks/useDashboardLayout";
import { ClipboardList, ChevronRight } from "lucide-react";
import { fmtDate, fmtMoney } from "../utils/money";
import { showHomeFinanceSummary } from "../utils/selfPersonnelNav";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { activeCompanyId } from "../utils/activeCompanyId";
import NoCompanyNotice from "../components/NoCompanyNotice";

const STAFF_HIDDEN_SECTIONS = new Set(["kpis", "charts", "bottom", "ai", "decision", "overview", "demo", "manager"]);

const INV_TYPE = { sales: "Satış", purchase: "Alış", dispatch: "İrsaliye" };
const INV_STATUS = { approved: "Onaylı", draft: "Taslak", cancelled: "İptal", paid: "Ödendi", pending: "Bekliyor" };

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function salesChangeText(pct) {
  if (pct == null || pct === "") return "Önceki ay yok";
  const n = Number(pct);
  if (!Number.isFinite(n)) return "Önceki ay yok";
  if (n > 0) return `+%${n} önceki aya`;
  if (n < 0) return `-%${Math.abs(n)} önceki aya`;
  return "%0 önceki aya";
}

function currentMonthName() {
  const name = new Date().toLocaleDateString("tr-TR", { month: "long" });
  return name.charAt(0).toLocaleUpperCase("tr-TR") + name.slice(1);
}

function formatAxisTry(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs >= 100000) {
    const millions = Math.round((abs / 1000000) * 10) / 10;
    const text = Number.isInteger(millions)
      ? String(millions)
      : millions.toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    return `${sign}${text}M`;
  }
  if (abs >= 1000) {
    const thousands = Math.round((abs / 1000) * 10) / 10;
    const text = Number.isInteger(thousands)
      ? String(thousands)
      : thousands.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
    return `${sign}${text}B`;
  }
  return `${sign}${Math.round(abs).toLocaleString("tr-TR")}`;
}

function currentChartRow(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return [...list].reverse().find((row) => String(row?.month || "").includes("Güncel")) || list[list.length - 1] || null;
}

function invoiceBadge(inv) {
  const type = INV_TYPE[inv?.invoice_type] || "";
  const status = inv?.gib_status || INV_STATUS[inv?.status] || inv?.status || "";
  return [type, status].filter(Boolean).join(" · ") || "—";
}

function invoiceBadgeClass(inv) {
  const ok = inv?.status === "approved" || /onay/i.test(String(inv?.gib_status || ""));
  return ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600";
}

export default function Dashboard() {
  const { activeCompany, addonOn, user, can, moduleOn } = useAuth();
  const { order, wrap, toolbar } = useDashboardLayout();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const companyId = activeCompanyId(activeCompany);
  const financeHome = showHomeFinanceSummary(user);
  const wantProd = Boolean(can?.("/production") && moduleOn?.("/production"));
  const wantProj = Boolean(can?.("/projects") && moduleOn?.("/projects"));
  const managerData = useManagerSummary(companyId, financeHome && (wantProd || wantProj));
  const fetchStats = useCallback(async ({ silent = false } = {}) => {
    if (!companyId) {
      setStats(null);
      if (!silent) setLoading(false);
      return;
    }
    try {
      if (!silent) setLoading(true);
      const res = await axios.get(`${API_URL}/dashboard/stats?company_id=${companyId}`);
      setStats(res.data);
    } catch (err) {
      console.error(err);
      setStats((prev) => prev || {});
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  const refreshStatsSilent = useCallback(() => fetchStats({ silent: true }), [fetchStats]);
  useDataRefresh(refreshStatsSilent, { companyId, scopes: ["cash", "contacts", "invoices", "expenses"] });

  const staffHome = !financeHome;
  const staffRow = (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4" data-testid="dashboard-staff-row">
      {!companyId && <NoCompanyNotice />}
      {staffHome ? (
        <Link
          to="/personelim?tab=gorevler"
          className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex items-center gap-3 hover:bg-indigo-100"
          data-testid="dashboard-my-tasks"
        >
          <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900">Görevlerim</div>
            <div className="text-[11px] text-slate-500">Atanan proje görevlerini aç</div>
          </div>
          <ChevronRight className="w-4 h-4 text-indigo-600 ml-auto" />
        </Link>
      ) : null}
      <div className={staffHome ? "xl:col-span-2" : "xl:col-span-3"}>
        <StaffMessagesPanel variant="overview" testId="dashboard-messages" />
      </div>
    </div>
  );

  if (loading || !stats) {
    return (
      <div className="space-y-6" data-testid="dashboard-loading">
        {staffRow}
        <div className="space-y-6 animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-28 bg-slate-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const loss = Number(stats.net_profit) < 0;
  const kpis = [
    {
      testId: "kpi-card-0",
      title: `Bu Ay Ciro · ${currentMonthName()}`,
      value: fmtMoney(stats.monthly_sales, "TRY"),
      valueClass: "text-indigo-950",
      cardClass: "bg-indigo-50/70 border-indigo-200",
      sub: `Kesilen satış faturaları (taslak ve iptal hariç) · ${salesChangeText(stats.sales_change_pct)}`,
      today: typeof stats.today_sales === "number" ? `Bugün: ${fmtMoney(stats.today_sales, "TRY")}` : null,
    },
    {
      testId: "kpi-card-1",
      title: "Toplam Kasa & Banka",
      value: fmtMoney(stats.total_bank_balance, "TRY"),
      valueClass: "text-slate-900",
      cardClass: "bg-white border-slate-200",
      sub: "Nakit, banka ve POS bakiyeleri",
    },
    {
      testId: "kpi-card-2",
      title: "Müşteri Alacakları",
      value: fmtMoney(stats.total_receivables, "TRY"),
      valueClass: "text-emerald-600",
      cardClass: "bg-white border-emerald-200",
      sub: `${stats.receivable_count || 0} cari hesap`,
    },
    {
      testId: "kpi-card-3",
      title: "Tedarikçi Borçları",
      value: fmtMoney(stats.total_payables, "TRY"),
      valueClass: "text-rose-600",
      cardClass: "bg-white border-rose-200",
      sub: `${stats.payable_count || 0} cari`,
    },
    {
      testId: "kpi-net",
      title: "Net Aylık Kâr",
      value: fmtMoney(stats.net_profit, "TRY"),
      valueClass: loss ? "text-rose-600" : "text-slate-900",
      cardClass: loss ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200",
      sub: `Gider (alış) ${fmtMoney(stats.monthly_expenses, "TRY")}`,
    },
  ];

  const chartNow = currentChartRow(stats.chart_data);
  const channels = stats.channels_breakdown || [];
  const recentInvoices = (stats.recent_invoices || []).slice(0, 5);
  const prodData = wantProd && isRecord(managerData?.production) ? managerData.production : null;
  const projData = wantProj && isRecord(managerData?.projects) ? managerData.projects : null;

  const sections = {
    staff: staffRow,
    alerts: (
      <div className="space-y-4">
        {financeHome ? <OverviewPanel companyId={companyId} part="invoices" /> : null}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-testid="dashboard-alerts-row">
          <OpsAlertsPanel companyId={companyId} />
          <div className="space-y-2" data-testid="dashboard-alerts-left">
            <PersonnelRequestsInbox companyId={companyId} compact slimWhenEmpty />
            <EdocPendingInbox companyId={companyId} slimWhenEmpty />
            <MarketplaceQuestionsInbox companyId={companyId} slimWhenEmpty />
          </div>
        </div>
      </div>
    ),
    overview: <OverviewPanel companyId={companyId} part="collections" />,
    manager: (prodData || projData) ? (
      <div className="space-y-4">
        <div className={`grid grid-cols-1 gap-4 ${prodData && projData ? "md:grid-cols-2" : ""}`} data-testid="dashboard-manager">
          {prodData ? <DashboardProductionCard data={prodData} /> : null}
          {projData ? <DashboardProjectsCard data={projData} /> : null}
        </div>
        {prodData ? (
          <>
            <ProductionAiAdvisor companyId={companyId} compact />
            <DashboardShopFloorPerf key={companyId || "none"} companyId={companyId} />
          </>
        ) : null}
      </div>
    ) : null,
    decision: null,
    demo: <DemoContentCard companyId={companyId} variant="dashboard" />,
    ai: (
      <DashboardHero
        companyName={activeCompany?.name || "TamKobi"}
        companyId={companyId}
        stats={stats}
        showAi={addonOn?.("ai.advisor")}
      />
    ),
    kpis: (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4" data-testid="dashboard-kpis">
        {kpis.map((kpi) => (
          <div
            key={kpi.testId}
            className={`p-4 rounded-2xl border shadow-sm space-y-2 ${kpi.cardClass}`}
            data-testid={kpi.testId}
          >
            <div className="text-xs font-medium text-slate-500">{kpi.title}</div>
            <div className={`text-2xl font-bold tracking-tight ${kpi.valueClass}`}>{kpi.value}</div>
            <div className="text-[11px] text-slate-500">{kpi.sub}</div>
            {kpi.today ? <div className="text-[11px] font-semibold text-indigo-700" data-testid="kpi-today-sales">{kpi.today}</div> : null}
          </div>
        ))}
      </div>
    ),
    charts: (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Gelir & Gider Trendi · 6 aylık</h2>
              <p className="text-xs text-slate-500">Satış faturaları ve hammadde/gider dengesi</p>
            </div>
            <div className="flex flex-col items-end gap-1 text-xs">
              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                Gelir {chartNow ? fmtMoney(chartNow.gelir, "TRY") : ""}
              </span>
              <span className="flex items-center gap-1.5 text-rose-500 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
                Gider {chartNow ? fmtMoney(chartNow.gider, "TRY") : ""}
              </span>
            </div>
          </div>
          <div className="h-64 w-full min-w-0 min-h-[256px]">
            <ResponsiveContainer width="100%" height={256} minWidth={0}>
              <BarChart data={stats.chart_data || []} barGap={4} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatAxisTry} width={48} />
                <Tooltip formatter={(value, name) => [fmtMoney(value, "TRY"), name === "gider" ? "Gider" : "Gelir"]} />
                <Bar dataKey="gelir" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="gider" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Satış Kanalı Dağılımı</h2>
            <p className="text-xs text-slate-500">Sipariş tutarı payı</p>
          </div>
          <div className="space-y-3">
            {channels.map((ch, i) => (
              <div key={`${ch.name}-${i}`}>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-medium">{ch.name}</span>
                  <span className="font-semibold text-slate-900">%{ch.value}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Number(ch.value) || 0}%`, backgroundColor: ch.color || "#64748b" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    bottom: (
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Son Kesilen Faturalar</h2>
          <Link to="/invoices" className="text-xs text-emerald-600 hover:text-emerald-700 font-semibold">
            Tüm faturalar ›
          </Link>
        </div>
        <div className="w-full max-w-full overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th className="text-left font-semibold pb-2">Cari</th>
              <th className="text-left font-semibold pb-2">Tür/Durum</th>
              <th className="text-right font-semibold pb-2">Tutar</th>
              <th className="text-right font-semibold pb-2">Tarih</th>
            </tr>
          </thead>
          <tbody>
            {recentInvoices.map((inv) => (
              <tr key={inv.id || inv._id || inv.invoice_number} className="border-t border-slate-100">
                <td className="py-2 pr-2 font-semibold text-slate-800">{inv.contact_name}</td>
                <td className="py-2 pr-2">
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-medium ${invoiceBadgeClass(inv)}`}>
                    {invoiceBadge(inv)}
                  </span>
                </td>
                <td className="py-2 text-right font-bold text-slate-900 whitespace-nowrap">{fmtMoney(inv.grand_total, inv.currency || "TRY")}</td>
                <td className="py-2 text-right text-slate-500 whitespace-nowrap">{fmtDate(inv.issue_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    ),
  };

  const visibleOrder = financeHome ? order : order.filter((id) => !STAFF_HIDDEN_SECTIONS.has(id));

  return (
    <div className="space-y-6" data-testid="dashboard-view" data-staff-home={staffHome ? "1" : "0"}>
      {financeHome ? toolbar : null}
      <div className="space-y-8" data-testid="dashboard-sections">
        {visibleOrder.map((id) => wrap(id, sections[id]))}
      </div>
    </div>
  );
}
