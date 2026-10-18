import React from "react";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount(n || 0);

function amount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function ProjectMoneyLine({ project, onAddQuote, onEdit }) {
  const number = project?.project_number;
  const budget = amount(project?.budget);
  const quoted = amount(project?.quoted_total);
  const invoiced = amount(project?.invoiced_total);
  const expense = amount(project?.expense_total);
  const purchase = amount(project?.purchase_invoice_total);
  const empty = budget === 0 && quoted === 0 && invoiced === 0 && expense === 0;
  const tone = (value, emphasis) => (value === 0 ? "text-slate-400" : emphasis);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" data-testid={`project-stats-${number}`}>
      <span className={tone(budget, "text-slate-800")}>
        <span className="text-slate-400">Bütçe</span>
        {" "}
        <b>{fmt(budget)} ₺</b>
      </span>
      <span className="text-slate-300" aria-hidden>·</span>
      <span className={tone(quoted, "text-slate-800")}>
        <span className="text-slate-400">Teklif</span>
        {" "}
        <b>{`${project?.quote_count || 0} • ${fmt(quoted)} ₺`}</b>
      </span>
      <span className="text-slate-300" aria-hidden>·</span>
      <span className={tone(invoiced, "text-emerald-700")}>
        <span className="text-slate-400">Faturalanan</span>
        {" "}
        <b>{fmt(invoiced)} ₺</b>
      </span>
      <span className="text-slate-300" aria-hidden>·</span>
      <span data-testid={`project-expense-total-${number}`} className={expense > 0 ? "text-rose-700" : "text-slate-400"}>
        <span className={expense > 0 ? "" : "text-slate-400"}>Masraf</span>
        {" "}
        <b>{fmt(expense)} ₺</b>
        {purchase > 0 ? (
          <span className="ml-1 text-[10px] font-semibold text-slate-400">{`Harcanan ${fmt(project?.cost_total)} ₺`}</span>
        ) : null}
      </span>
      {empty ? (
        <span className="ml-auto text-slate-500">
          Henüz tutar yok —{" "}
          <button type="button" onClick={() => onAddQuote?.(project)} className="font-semibold text-emerald-700 hover:underline">
            Teklif ekle
          </button>
          {" · "}
          <button type="button" onClick={() => onEdit?.(project)} className="font-semibold text-emerald-700 hover:underline">
            Bütçe gir
          </button>
        </span>
      ) : null}
    </div>
  );
}
