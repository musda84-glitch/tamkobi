import React from "react";
import { Link } from "react-router-dom";
import { formatTrQty } from "../utils/money";
import { daysSince } from "../utils/calendarDays";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function productName(order) {
  return order?.product_name || order?.finished_product_name || order?.name || "Ürün";
}

function inProduction(status) {
  const s = String(status || "").toLocaleLowerCase("tr-TR");
  return s === "in_production" || s === "üretimde" || s === "uretimde";
}

function stepCounts(order) {
  const done = order?.done ?? order?.steps_done ?? order?.steps?.done ?? 0;
  const total = order?.total ?? order?.steps_total ?? order?.steps?.total ?? 0;
  return { done: num(done), total: num(total) };
}

function OrderBadge({ order }) {
  const late = Boolean(order?.late);
  const days = late ? daysSince(order?.planned_date) : 0;
  const steps = stepCounts(order);
  const running = inProduction(order?.status);
  const base = running ? `Üretimde · ${steps.done}/${steps.total} adım` : "Planlı";
  const text = late && days > 0 ? `${base} · ${days} gün gecikti` : base;
  const tone = late
    ? "bg-rose-50 text-rose-700 border-rose-100"
    : running
      ? "bg-amber-50 text-amber-800 border-amber-100"
      : "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-lg border px-2 py-0.5 text-[10px] font-bold ${tone}`} data-testid={`production-badge-${order?.order_code || "order"}`}>
      {text}
    </span>
  );
}

function Stat({ label, value, sub, tone }) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
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

export function DashboardProductionCard({ data }) {
  const open = num(data?.open);
  if (open === 0) {
    return (
      <Link
        to="/production"
        className="bg-white rounded-2xl border border-slate-200 px-4 py-2.5 flex items-center gap-2 text-sm hover:bg-slate-50"
        data-testid="dashboard-production-card"
      >
        <span className="font-bold text-slate-900">🏭 Üretim · Açık üretim emri yok · Üretim ›</span>
      </Link>
    );
  }
  const late = num(data?.late);
  const stepsToday = num(data?.today_completed_steps ?? data?.today_steps ?? data?.steps_completed_today);
  const producedToday = num(data?.today_produced_qty ?? data?.today_produced ?? data?.produced_today);
  const orders = Array.isArray(data?.top_orders) ? data.top_orders : [];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3" data-testid="dashboard-production-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">🏭 Üretim</h2>
        <Link to="/production" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">Üretim ›</Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Açık emir" value={open} sub="planlı + üretimde" tone="indigo" />
        <Stat label="Üretimde" value={num(data?.in_production)} tone="slate" />
        <Stat label="Geciken" value={late} sub="planlanan tarih geçti" tone={late > 0 ? "rose" : "slate"} />
        <Stat label="Bu ay biten" value={num(data?.completed_this_month)} tone="emerald" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400 mb-1">Açık emirler</div>
        <div className="divide-y divide-slate-100">
          {orders.map((order, index) => (
            <div key={order.order_code || index} className="py-1.5 flex items-center gap-2 text-xs" data-testid={`production-order-${order.order_code || index}`}>
              <div className="min-w-0 flex-1 truncate font-semibold text-slate-800">
                {order.order_code} {productName(order)}
              </div>
              <div className="shrink-0 text-slate-500">{formatTrQty(order.planned_quantity)} adet</div>
              <OrderBadge order={order} />
            </div>
          ))}
        </div>
      </div>
      <div className="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
        Bugün tamamlanan iş adımı {formatTrQty(stepsToday)} · üretilen {formatTrQty(producedToday)} adet
      </div>
    </div>
  );
}

export default DashboardProductionCard;
