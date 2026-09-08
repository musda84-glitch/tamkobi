import React from "react";

export const fmtTL = (n) => (Number(n) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
export const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("tr-TR") : "—");
export const PLAN_COLORS = { slate: "bg-slate-700 text-white", emerald: "bg-emerald-600 text-white", indigo: "bg-indigo-600 text-white", amber: "bg-amber-400 text-slate-900", rose: "bg-rose-600 text-white" };
export const STATUS_STYLES = { trial: "bg-sky-50 text-sky-700 border-sky-200", active: "bg-emerald-50 text-emerald-700 border-emerald-200", suspended: "bg-amber-50 text-amber-700 border-amber-200", expired: "bg-rose-50 text-rose-700 border-rose-200", cancelled: "bg-slate-100 text-slate-500 border-slate-200" };
export const STATUS_LABELS = { trial: "Deneme", active: "Aktif", suspended: "Askıda", expired: "Süresi Doldu", cancelled: "İptal" };
export const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400/40";

export const StatusBadge = ({ status, testId }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.cancelled}`} data-testid={testId}>
    <span className={`w-1.5 h-1.5 rounded-full ${status === "active" ? "bg-emerald-500" : status === "trial" ? "bg-sky-500" : status === "suspended" ? "bg-amber-500" : "bg-rose-500"}`} />{STATUS_LABELS[status] || status}
  </span>
);

export const PlanChip = ({ name, color, testId }) => <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide ${PLAN_COLORS[color] || PLAN_COLORS.slate}`} data-testid={testId}>{name}</span>;

export const Toggle = ({ on, onChange, disabled, testId }) => (
  <button type="button" onClick={() => !disabled && onChange(!on)} disabled={disabled} className={`relative inline-flex shrink-0 w-10 h-5 p-0 m-0 align-middle rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-300"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`} data-testid={testId} aria-pressed={on}>
    <span className={`absolute left-0 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
  </button>
);

export const StatCard = ({ label, value, sub, accent = "text-slate-900", testId }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-4" data-testid={testId}>
    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
    <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

export const fmtBytes = (n) => {
  const b = Number(n) || 0;
  if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
};

export const QuotaBar = ({ used = 0, limit = 0, testId }) => {
  const unlimited = !limit;
  const pct = unlimited ? 0 : Math.min(100, Math.round((Number(used) / Number(limit)) * 100));
  const over = !unlimited && Number(used) >= Number(limit);
  const warn = !unlimited && pct >= 80;
  return (
    <div className="space-y-0.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-bold ${over ? "text-rose-700" : warn ? "text-amber-700" : "text-slate-800"}`}>{used}{unlimited ? "" : `/${limit}`}</span>
        <span className="text-[10px] text-slate-400">{unlimited ? "sınırsız" : `%${pct}`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${over ? "bg-rose-500" : warn ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: unlimited ? "8%" : `${Math.max(pct, used ? 4 : 0)}%` }} />
      </div>
    </div>
  );
};

export const groupByCategory = (catalog) => catalog.filter((m) => !m.is_core).reduce((acc, m) => { (acc[m.category] = acc[m.category] || []).push(m); return acc; }, {});
