import React from "react";
import { Link } from "react-router-dom";
import { fmtDate, formatTrAmount } from "../utils/money";
import { daysSince } from "../utils/calendarDays";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function moneyPair(cost, budget) {
  return `${formatTrAmount(cost)} / ${formatTrAmount(budget)} ₺`;
}

function usagePct(cost, budget) {
  if (!num(budget)) return null;
  return Math.round((num(cost) / num(budget)) * 100);
}

function Stat({ label, value, sub, tone }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
    slate: "bg-slate-50 text-slate-800 border-slate-100",
  };
  return (
    <div className={`rounded-xl border px-2 py-2 ${tones[tone] || tones.slate}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      {sub ? <div className="text-[10px] font-medium opacity-80">{sub}</div> : null}
    </div>
  );
}

export function DashboardProjectsCard({ data }) {
  const active = num(data?.active);
  if (active === 0) {
    return (
      <Link
        to="/projects"
        className="bg-white rounded-2xl border border-slate-200 px-4 py-2.5 flex items-center gap-2 text-sm hover:bg-slate-50"
        data-testid="dashboard-projects-card"
      >
        <span className="font-bold text-slate-900">📐 Projeler · Aktif proje yok · Projeler ›</span>
      </Link>
    );
  }
  const overdue = num(data?.overdue);
  const costTotal = num(data?.cost_total);
  const budgetTotal = num(data?.budget_total);
  const budgetPct = usagePct(costTotal, budgetTotal);
  const rows = (Array.isArray(data?.top_projects) ? data.top_projects : []).slice(0, 3);
  const extra = active - rows.length;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3" data-testid="dashboard-projects-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">📐 Projeler</h2>
        <Link to="/projects" className="text-xs font-semibold text-blue-700 hover:text-blue-900">Projeler ›</Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Aktif proje" value={active} tone="blue" />
        <Stat label="Süresi geçen" value={overdue} tone={overdue > 0 ? "rose" : "slate"} />
        <Stat
          label="Bütçe kullanımı"
          value={budgetPct == null ? "—" : `%${budgetPct}`}
          sub={moneyPair(costTotal, budgetTotal)}
          tone="slate"
        />
      </div>
      <div className="space-y-2.5">
        {rows.map((project, index) => {
          const progress = num(project?.progress_pct);
          const cost = num(project?.cost_total ?? project?.cost ?? project?.spent);
          const budget = num(project?.budget_total ?? project?.budget);
          const pct = usagePct(cost, budget);
          const over = Boolean(project?.overdue);
          const due = project?.due_date || project?.end_date || project?.delivery_date;
          const lateDays = over && due ? daysSince(due) : 0;
          return (
            <div key={project?.id || project?.name || index} data-testid={`project-row-${index}`}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-800 truncate">{project?.name || "Proje"}</span>
                <span className="font-bold text-slate-700 shrink-0">%{progress}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  data-testid="project-progress"
                  className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-blue-500"}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {project?.stage_label || "—"} · masraf {formatTrAmount(cost)} / {formatTrAmount(budget)} ₺ ({pct == null ? "—" : <span className={pct > 100 ? "text-rose-600 font-bold" : ""}>%{pct}</span>})
              </div>
              {over && due ? (
                <div className="text-[11px] font-semibold text-rose-600">
                  Teslim {fmtDate(due)}{lateDays > 0 ? ` · ${lateDays} gün gecikti` : ""}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {active > 3 && extra > 0 ? (
        <Link to="/projects" className="text-xs font-semibold text-blue-700" data-testid="projects-more">+{extra} aktif proje</Link>
      ) : null}
    </div>
  );
}

export default DashboardProjectsCard;
