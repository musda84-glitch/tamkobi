import React from "react";
import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";
import { formatTrAmount } from "../../utils/money";
import { PARTNER_PAID_LABEL, PARTNER_RECEIVED_LABEL, partnerBalanceMeta } from "../../utils/partnerTx";

const fmt = (n) => formatTrAmount((n || 0));

const TX_ACTIONS = [
  { type: "capital_in", label: "Para Koy", testId: "partner-pane-capital-in", cls: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" },
  { type: "withdrawal", label: "Para Çek", testId: "partner-pane-withdrawal", cls: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100" },
  { type: "credit", label: "Alacaklandır", testId: "partner-pane-credit", cls: "border-rose-300 bg-white text-rose-800 hover:bg-rose-50" },
  { type: "debit", label: "Borçlandır", testId: "partner-pane-debit", cls: "border-rose-300 bg-white text-rose-800 hover:bg-rose-50" },
];

/** Seçili ortak: net, ledger kontrolü ve para koy/çek fişleri. */
export function PartnerDetailPane({ partner, ledger = null, onClose, onOpenTx, children }) {
  const meta = partner ? partnerBalanceMeta(partner.balance) : null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm min-w-0 overflow-hidden" data-testid="partner-detail-pane">
      {!partner ? (
        <div className="px-5 py-10 text-center text-sm text-slate-400" data-testid="partner-detail-empty">Ortak seçin</div>
      ) : (
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate" data-testid="partner-detail-name">{partner.name}</h3>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500" data-testid="partner-detail-net">
                {`Net · ${meta.label.toLocaleUpperCase("tr-TR")}`}
              </div>
              <div className={`text-lg font-bold tabular-nums ${meta.amountCls}`} data-testid="partner-detail-amount">{fmt(meta.display)} ₺</div>
            </div>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100"
              aria-label="Kapat"
              data-testid="partner-tx-clear-filter"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {ledger && (
            <div
              className={`rounded-xl border px-3 py-3 text-xs space-y-2 ${ledger.drift ? "bg-rose-50/80 border-rose-100" : "bg-slate-50/80 border-slate-100"}`}
              data-testid="partner-ledger-check"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-bold text-slate-800">Bakiye kontrolü</div>
                <div className={ledger.drift || !ledger.netMatchesCard ? "text-rose-700 font-semibold" : "text-emerald-700 font-semibold"} data-testid="partner-ledger-match">
                  {ledger.drift
                    ? `Sapma: kayıtlı ${fmt(partnerBalanceMeta(ledger.stored).display)} ₺ ≠ hareket ${fmt(partnerBalanceMeta(ledger.ledger).display)} ₺`
                    : `Bakiye hareketlerle uyumlu (${fmt(partnerBalanceMeta(ledger.ledger).display)} ₺ ${partnerBalanceMeta(ledger.ledger).label} · ${ledger.count} kayıt)`}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2" data-testid="partner-ledger-buckets">
                <div className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold">{PARTNER_RECEIVED_LABEL}</div>
                  <div className="font-bold text-emerald-700" data-testid="partner-ledger-inflow">{fmt(Math.abs(ledger.girisDisplay))} ₺</div>
                </div>
                <div className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold">{PARTNER_PAID_LABEL}</div>
                  <div className="font-bold text-rose-700" data-testid="partner-ledger-outflow">{fmt(Math.abs(ledger.cikisDisplay))} ₺</div>
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {TX_ACTIONS.map((action) => (
              <button
                key={action.type}
                type="button"
                onClick={() => onOpenTx?.(action.type)}
                className={`inline-flex items-center justify-center gap-1 px-2 py-2 rounded-xl border text-xs font-semibold ${action.cls}`}
                data-testid={action.testId}
              >
                {action.type === "capital_in" ? <ArrowDownRight className="w-3.5 h-3.5" /> : action.type === "withdrawal" ? <ArrowUpRight className="w-3.5 h-3.5" /> : null}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
