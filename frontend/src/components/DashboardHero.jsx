import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronRight, Sparkles } from "lucide-react";
import { fmtMoney } from "../utils/money";
import { useDashboardOverview } from "./OverviewPanel";

function formatHeroDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date();
  return date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" });
}

function chipClass(tone) {
  if (tone === "green") return "bg-emerald-500 hover:bg-emerald-400 text-white";
  if (tone === "rose") return "bg-rose-500/25 hover:bg-rose-500/40 ring-1 ring-rose-400/40 text-rose-100";
  if (tone === "amber") return "bg-amber-500/20 hover:bg-amber-500/30 text-amber-100";
  return "bg-white/10 hover:bg-white/20 text-white";
}

function buildChips(stats, overview) {
  const tasks = overview?.tasks || [];
  const taskKeys = new Set(tasks.map((t) => t.key));
  const chips = [];

  for (const task of tasks) {
    chips.push({
      key: task.key,
      testId: `task-${task.key}`,
      path: task.path || "/panel",
      tone: task.key === "leaves" ? "rose" : "plain",
      count: task.count,
      label: task.label,
      extra: task.extra,
    });
  }

  const decision = Array.isArray(stats?.decision) ? stats.decision : [];
  decision.forEach((item, index) => {
    const text = String(item?.text || "");
    if (/stok kritik/i.test(text)) return;
    if (/sipariş/i.test(text)) {
      if (taskKeys.has("pending_orders") || chips.some((c) => c.key === "pending_orders")) return;
      const count = Number(stats?.pending_orders_count) || 0;
      if (count <= 0) return;
      chips.push({
        key: "pending_orders",
        testId: "task-pending_orders",
        path: item.path || "/orders",
        tone: "plain",
        count,
        label: "Onay bekleyen sipariş",
      });
      return;
    }
    if (/tahsil edilecek/i.test(text)) {
      chips.push({
        key: "receivable",
        testId: "task-receivable",
        path: item.path || "/invoices",
        tone: "green",
        label: `Tahsil edilecek ${fmtMoney(stats?.total_receivables, "TRY")}`,
      });
      return;
    }
    if (!text) return;
    chips.push({
      key: `decision-${index}`,
      testId: `dashboard-decision-${index}`,
      path: item.path || "/reports",
      tone: "plain",
      label: text,
    });
  });

  if (!chips.some((c) => c.key === "pending_orders")) {
    const count = Number(stats?.pending_orders_count) || 0;
    if (count > 0) {
      chips.push({
        key: "pending_orders",
        testId: "task-pending_orders",
        path: "/orders",
        tone: "plain",
        count,
        label: "Onay bekleyen sipariş",
      });
    }
  }

  for (const warning of overview?.budget_warnings || []) {
    chips.push({
      key: `budget-${warning.category}`,
      testId: `task-budget-${warning.category}`,
      path: "/expenses",
      tone: "amber",
      label: `${warning.category} bütçesi %${warning.pct}`,
      icon: true,
    });
  }
  return chips;
}

export function DashboardHero({ companyName, companyId, stats, showAi }) {
  const navigate = useNavigate();
  const overview = useDashboardOverview(companyId);
  const chips = buildChips(stats, overview);
  const dateLabel = formatHeroDate(overview?.date);

  return (
    <div className="bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 rounded-2xl border border-slate-800 text-white shadow-lg overflow-hidden" data-testid="dashboard-hero">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-slate-300 capitalize">{dateLabel}</div>
          <div className="text-base md:text-lg font-bold tracking-tight truncate">{companyName || "TamKobi"}</div>
        </div>
        {showAi ? (
          <Link
            to="/ai-advisor"
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-xs px-3 py-2 rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex-shrink-0"
            data-testid="dashboard-ai-forecast-btn"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Nakit Tahmini & Analiz</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        ) : null}
      </div>
      <div className="px-4 pb-3 flex flex-wrap items-center gap-2" data-testid="today-tasks">
        <span className="text-[10px] font-bold tracking-wider text-slate-400">BUGÜN YAPILACAKLAR</span>
        {chips.length === 0 ? (
          <span className="text-xs text-slate-300">Bugün için bekleyen görev yok</span>
        ) : chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => navigate(chip.path)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${chipClass(chip.tone)}`}
            data-testid={chip.testId}
          >
            {chip.icon ? <AlertTriangle className="w-3 h-3" /> : null}
            {chip.count != null ? <b className={chip.tone === "rose" ? "text-rose-200" : chip.tone === "green" ? "text-white" : "text-emerald-300"}>{chip.count}</b> : null}
            {chip.label}
            {chip.extra ? <span className="text-rose-200">· {chip.extra}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export default DashboardHero;
