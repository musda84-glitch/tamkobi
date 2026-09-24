import React from "react";
import { CalendarClock } from "lucide-react";
import { resolveImageUrl } from "../utils/imageUrl";
import { lineGross, lineUnitGross } from "../utils/orderMoney";
import { fmtDate, fmtMoney } from "../utils/money";

const fmt = (n, c = "TRY") => fmtMoney(n, c);

/** Herkese açık teklif gövdesi — kalemler, toplam, plan, not. */
export function PublicQuoteContents({ q, testIdPrefix = "public-quote" }) {
  if (!q) return null;
  return (
    <div className="space-y-3 text-sm" data-testid={`${testIdPrefix}-detail`}>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        {q.issue_date ? <div>Tarih: <b className="text-slate-800">{fmtDate(q.issue_date)}</b></div> : null}
        {q.valid_until ? (
          <div className={q.is_expired ? "text-rose-600 font-semibold" : ""}>
            Geçerlilik: <b>{fmtDate(q.valid_until)}</b>{q.is_expired ? " (süresi doldu)" : ""}
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-900 text-white">
              <th className="text-left p-2 rounded-l-lg">Açıklama</th>
              <th className="text-right p-2">Miktar</th>
              <th className="text-right p-2">Birim (KDV Dahil)</th>
              <th className="text-right p-2 rounded-r-lg">Tutar (KDV Dahil)</th>
            </tr>
          </thead>
          <tbody>
            {(q.items || []).map((it, i) => (
              <tr key={`${it.name || "satir"}-${i}`} className="border-b border-slate-100" data-testid={`${testIdPrefix}-item-${i}`}>
                <td className="p-2">{it.name}</td>
                <td className="p-2 text-right">{it.quantity} {it.unit || ""}</td>
                <td className="p-2 text-right">{fmt(lineUnitGross(it), q.currency || "TRY")}</td>
                <td className="p-2 text-right font-semibold">{fmt(lineGross(it), q.currency || "TRY")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <div className="w-full sm:w-64 space-y-1 text-xs">
          <div className="flex justify-between text-slate-500"><span>Ara Toplam (KDV Hariç)</span><span>{fmt(q.subtotal, q.currency || "TRY")}</span></div>
          <div className="flex justify-between text-slate-500"><span>KDV</span><span>{fmt(q.vat_total, q.currency || "TRY")}</span></div>
          <div className="flex justify-between text-sm font-black border-t-2 border-slate-900 pt-1" data-testid={`${testIdPrefix}-grand`}>
            <span>TOPLAM (KDV Dahil)</span><span>{fmt(q.grand_total, q.currency || "TRY")}</span>
          </div>
        </div>
      </div>
      {q.payment_plan?.rows?.length > 0 ? (
        <div className="bg-violet-50 border border-violet-100 rounded-xl p-3">
          <div className="flex items-center gap-1 font-bold text-violet-800 text-xs mb-1">
            <CalendarClock className="w-3.5 h-3.5" /> Ödeme Planı ({q.payment_plan.rows.length} taksit)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">
            {q.payment_plan.rows.map((r) => (
              <div key={r.no || r.label} className="flex justify-between border-b border-violet-100 py-1">
                <span>{r.label}</span>
                <span className="text-slate-500">{fmtDate(r.due_date)}</span>
                <b>{fmt(r.amount, q.currency || "TRY")}</b>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {(q.notes || q.terms) ? (
        <div className="text-xs text-slate-600 whitespace-pre-wrap">
          {q.notes}
          {q.terms ? <div className="mt-1"><b>Şartlar:</b> {q.terms}</div> : null}
        </div>
      ) : null}
      {q.images?.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {q.images.map((img) => (
            <img key={img} src={resolveImageUrl(img)} alt="" className="w-full h-24 object-cover rounded-lg border" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
