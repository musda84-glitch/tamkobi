import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";
import { OverviewPanel } from "../components/OverviewPanel";
import { DemoContentCard } from "../components/DemoContentCard";
import { PersonnelRequestsInbox } from "../components/PersonnelRequestsInbox";
import { OpsAlertsPanel } from "../components/OpsAlertsPanel";
import { StaffMessagesPanel } from "../components/StaffMessagesPanel";
import { useDashboardLayout } from "../hooks/useDashboardLayout";

import {
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowDownRight,
  ArrowUpRight,
  PackageCheck,
  AlertTriangle,
  Clock,
  ClipboardList,
  Sparkles,
  ChevronRight,
  ShoppingBag,
  Layers,
  ArrowRight
} from "lucide-react";
import { fmtMoney } from "../utils/money";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";

export default function Dashboard() {
  const { activeCompany, addonOn, user } = useAuth();
  const { order, wrap, toolbar } = useDashboardLayout();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const fetchStats = useCallback(async ({ silent = false } = {}) => {
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

  const staffHome = Boolean(user?.employee_id);
  const staffRow = (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4" data-testid="dashboard-staff-row">
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
        <StaffMessagesPanel compact testId="dashboard-messages" />
      </div>
    </div>
  );

  if (loading || !stats) {
    return (
      <div className="space-y-6" data-testid="dashboard-loading">
        {staffRow}
        <div className="space-y-6 animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-slate-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const kpis = [
    {
      title: "Toplam Kasa & Banka",
      value: fmtMoney(stats.total_bank_balance, "TRY"),
      sub: "Nakit, banka ve POS bakiyeleri",
      icon: Wallet,
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
      trend: stats.total_stock_value ? `Stok değeri ${fmtMoney(stats.total_stock_value, "TRY")}` : "Güncel bakiye"
    },
    {
      title: "Müşteri Alacakları",
      value: fmtMoney(stats.total_receivables, "TRY"),
      sub: "Tahsil edilecek vadeli cari bakiye",
      icon: ArrowDownRight,
      color: "text-blue-600 bg-blue-50 border-blue-100",
      trend: `${stats.receivable_count || 0} cari hesap`
    },
    {
      title: "Tedarikçi Borçları",
      value: fmtMoney(stats.total_payables, "TRY"),
      sub: "Ödenecek hammadde ve hizmet borcu",
      icon: ArrowUpRight,
      color: "text-amber-600 bg-amber-50 border-amber-100",
      trend: `${stats.payable_count || 0} cari`
    },
    {
      title: "Net Aylık Kâr",
      value: fmtMoney(stats.net_profit, "TRY"),
      sub: "Ciro: " + fmtMoney(stats.monthly_sales || 0, "TRY"),
      icon: TrendingUp,
      color: "text-indigo-600 bg-indigo-50 border-indigo-100",
      trend: stats.sales_change_pct == null ? "Önceki ay yok" : `${stats.sales_change_pct > 0 ? "+" : ""}${stats.sales_change_pct}% ciro (önceki aya)`
    }
  ];

  const sections = {
    staff: staffRow,
    alerts: (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-testid="dashboard-alerts-row">
        <PersonnelRequestsInbox companyId={companyId} />
        <OpsAlertsPanel companyId={companyId} />
      </div>
    ),
    overview: <OverviewPanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />,
    decision: stats.decision?.length > 0 ? (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2" data-testid="dashboard-decision">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">Yönetici karar özeti</div>
        <div className="flex flex-wrap gap-2">
          {stats.decision.map((d, i) => (
            <Link key={i} to={d.path || "/reports"} className="text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 font-semibold text-slate-800" data-testid={`dashboard-decision-${i}`}>{d.text}</Link>
          ))}
        </div>
      </div>
    ) : null,
    demo: <DemoContentCard companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} variant="dashboard" />,
    ai: (
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden border border-slate-800">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            {addonOn("ai.advisor") && (
            <div className="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-300 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border border-indigo-500/30">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              TamKobi AI Finans Danışmanı
            </div>
            )}
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
              {activeCompany?.name || "TamKobi"} Finansal Özeti
            </h1>
            <p className="text-slate-300 text-xs md:text-sm max-w-2xl">
              Tüm pazaryeri siparişleriniz senkronize edildi. Bekleyen {stats.pending_orders_count} sipariş ve {stats.low_stock_count} kritik stok uyarısı bulunuyor.
            </p>
          </div>
          {addonOn("ai.advisor") && (
          <Link
            to="/ai-advisor"
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex-shrink-0"
            data-testid="dashboard-ai-forecast-btn"
          >
            <span>AI Nakit Tahmini & Analiz</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
          )}
        </div>
      </div>
    ),
    kpis: (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              className="bg-white p-5 rounded-xl border border-slate-200/90 shadow-sm hover:shadow-md transition space-y-3"
              data-testid={`kpi-card-${idx}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{kpi.title}</span>
                <div className={`p-2 rounded-lg border ${kpi.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900 tracking-tight">{kpi.value}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{kpi.sub}</div>
              </div>
              <div className={`pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]`}>
                <span className={`font-medium ${String(kpi.trend).startsWith("-") ? "text-rose-600" : "text-emerald-600"}`}>{kpi.trend}</span>
              </div>
            </div>
          );
        })}
      </div>
    ),
    charts: (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue & Expense Area Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Gelir & Gider Trendi (6 Aylık)</h2>
              <p className="text-xs text-slate-500">Satış faturaları ve hammadde/gider dengesi</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Gelir
              </span>
              <span className="flex items-center gap-1.5 text-rose-500 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span> Gider
              </span>
            </div>
          </div>
          <div className="h-64 w-full min-w-0 min-h-[256px]">
            <ResponsiveContainer width="100%" height={256} minWidth={0}>
              <AreaChart data={stats.chart_data}>
                <defs>
                  <linearGradient id="colorGelir" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorGider" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} tickFormatter={(v) => `${v/1000}k ₺`} />
                <Tooltip formatter={(value) => `${Number(value).toLocaleString('tr-TR')} ₺`} />
                <Area type="monotone" dataKey="gelir" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorGelir)" />
                <Area type="monotone" dataKey="gider" stroke="#f43f5e" strokeWidth={2.5} fillOpacity={1} fill="url(#colorGider)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* E-Commerce Channels Breakdown */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Satış Kanalı Dağılımı</h2>
            <p className="text-xs text-slate-500">Pazaryerleri ve B2B Sipariş Payı</p>
          </div>
          <div className="h-44 w-full min-w-0 min-h-[176px] flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height={176} minWidth={0}>
              <PieChart>
                <Pie
                  data={stats.channels_breakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {stats.channels_breakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `%${v}`} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute text-center">
              <span className="text-xs font-semibold text-slate-700">En Çok</span>
              <div className="text-sm font-bold text-slate-900">{(stats.channels_breakdown || []).slice().sort((a, b) => b.value - a.value)[0]?.name || "—"}</div>
            </div>
          </div>
          <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
            {stats.channels_breakdown.map((ch, i) => (
              <div key={i} className="flex items-center justify-between text-slate-600">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ch.color }}></span>
                  {ch.name}
                </span>
                <span className="font-semibold text-slate-900">%{ch.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    bottom: (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Son Kesilen Faturalar</h2>
            <Link to="/invoices" className="text-xs text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-1">
              Tümünü Gör <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {stats.recent_invoices?.map((inv) => (
              <div key={inv.id || inv._id || inv.invoice_number} className="py-3 flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-slate-800">{inv.contact_name}</div>
                  <div className="text-slate-400 text-[11px] font-mono">{inv.invoice_number} • {inv.issue_date}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-slate-900">{fmtMoney(inv.grand_total, inv.currency || "TRY")}</div>
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    inv.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {inv.gib_status || inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Critical Stock & Pending Orders */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h2 className="text-base font-bold text-slate-900">Kritik Stok Uyarıları</h2>
            </div>
            <Link to="/stock" className="text-xs text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-1">
              Stok Yönetimi <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="space-y-2.5">
            {stats.low_stock_products?.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">Tüm ürünlerin stok seviyesi güvenli bölgede.</p>
            ) : (
              stats.low_stock_products?.map((prod) => (
                <div key={prod.id || prod._id} className="p-3 bg-amber-50/60 border border-amber-200/70 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-800">{prod.name}</div>
                    <div className="text-amber-800 text-[11px] font-mono">SKU: {prod.sku} • Eşik: {prod.min_stock_alert} Adet</div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-lg">
                      {prod.stock_quantity} Adet Kaldı
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    ),
  };

  return (
    <div className="space-y-6" data-testid="dashboard-view">
      {toolbar}
      <div className="space-y-8" data-testid="dashboard-sections">
        {order.map((id) => wrap(id, sections[id]))}
      </div>
    </div>
  );

}
