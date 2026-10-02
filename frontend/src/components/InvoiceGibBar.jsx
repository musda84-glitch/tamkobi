import React from "react";
import { Link } from "react-router-dom";
import { Inbox, Send, Truck, RefreshCw, Loader2 } from "lucide-react";
import {
  einvoiceProviderLabel,
  isEinvoiceConfigured,
  supportsGibInbox,
  supportsEDispatch,
} from "../utils/einvoiceIntegrator";

/**
 * Faturalar — bağlı entegratöre göre GİB kısayolları.
 * Dolibarr İşNet menüsü ile aynı dört kova:
 *   Gelen e-Fatura · Gelen e-İrsaliye · Giden e-Fatura · Giden e-İrsaliye
 * Ref: github.com/mbrksntrk/dolibarr-isnet-nettefatura
 */
export function InvoiceGibBar({
  settings,
  busy = "",
  onPullIncoming,
  onRefreshOutgoing,
  onFilterDispatch,
  onFilterOutgoing,
  onFilterIncoming,
}) {
  if (!isEinvoiceConfigured(settings)) {
    return (
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-amber-200 bg-amber-50/80 text-[11px] text-amber-900"
        data-testid="invoice-gib-bar-unconfigured"
      >
        <span className="font-semibold">GİB entegratörü bağlı değil.</span>
        <Link to="/settings?tab=einvoice" className="underline font-semibold hover:text-amber-950" data-testid="invoice-gib-bar-settings">
          Ayarlar → e-Fatura
        </Link>
        <span className="text-amber-700">bağlayın (İşNet / n11).</span>
      </div>
    );
  }

  const label = einvoiceProviderLabel(settings.provider);
  const mode = String(settings.mode || "test").toLowerCase();
  const inbox = supportsGibInbox(settings);
  const dispatchOk = supportsEDispatch(settings);
  const btn =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition disabled:opacity-60";
  const group =
    "flex flex-wrap items-center gap-1.5 pl-2 border-l border-indigo-200/80 first:border-l-0 first:pl-0";

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 rounded-xl border border-indigo-200/80 bg-indigo-50/50"
      data-testid="invoice-gib-bar"
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-800" data-testid="invoice-gib-bar-provider">
        {label}
        {mode === "test" || mode === "sandbox" ? " · Test" : " · Canlı"}
      </span>

      {inbox && (
        <div className={group} data-testid="invoice-gib-group-incoming-invoice">
          <span className="text-[10px] font-bold text-indigo-600/80 uppercase tracking-wide">Gelen e-Fatura</span>
          <button
            type="button"
            disabled={busy === "pull"}
            onClick={onPullIncoming}
            className={`${btn} border-indigo-300 bg-white text-indigo-800 hover:bg-indigo-100`}
            data-testid="invoice-gib-pull-incoming"
            title="Entegratör gelen e-Fatura + e-İrsaliye kutusunu çek"
          >
            {busy === "pull" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Inbox className="w-3.5 h-3.5" />}
            Çek
          </button>
          <Link
            to="/edoc-inbox"
            className={`${btn} border-indigo-200 bg-indigo-100/80 text-indigo-900 hover:bg-indigo-100`}
            data-testid="invoice-gib-inbox-link"
          >
            <Inbox className="w-3.5 h-3.5" />
            Gelen Kutu
          </Link>
          {typeof onFilterIncoming === "function" && (
            <button
              type="button"
              onClick={onFilterIncoming}
              className={`${btn} border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-50`}
              data-testid="invoice-gib-filter-incoming"
            >
              Liste
            </button>
          )}
        </div>
      )}

      {inbox && dispatchOk && (
        <div className={group} data-testid="invoice-gib-group-incoming-dispatch">
          <span className="text-[10px] font-bold text-fuchsia-700/80 uppercase tracking-wide">Gelen e-İrsaliye</span>
          <Link
            to="/edoc-inbox?kind=dispatch"
            className={`${btn} border-fuchsia-300 bg-white text-fuchsia-800 hover:bg-fuchsia-50`}
            data-testid="invoice-gib-incoming-dispatch"
          >
            <Truck className="w-3.5 h-3.5" />
            Gelen İrsaliye
          </Link>
        </div>
      )}

      <div className={group} data-testid="invoice-gib-group-outgoing-invoice">
        <span className="text-[10px] font-bold text-emerald-700/80 uppercase tracking-wide">Giden e-Fatura</span>
        <button
          type="button"
          disabled={busy === "refresh"}
          onClick={onRefreshOutgoing}
          className={`${btn} border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50`}
          data-testid="invoice-gib-refresh-outgoing"
          title="Giden e-belge GİB durumlarını güncelle"
        >
          {busy === "refresh" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Durum Yenile
        </button>
        {typeof onFilterOutgoing === "function" && (
          <button
            type="button"
            onClick={onFilterOutgoing}
            className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100`}
            data-testid="invoice-gib-filter-outgoing"
          >
            <Send className="w-3.5 h-3.5" />
            Giden Liste
          </button>
        )}
      </div>

      {dispatchOk && (
        <div className={group} data-testid="invoice-gib-group-outgoing-dispatch">
          <span className="text-[10px] font-bold text-fuchsia-700/80 uppercase tracking-wide">Giden e-İrsaliye</span>
          <button
            type="button"
            onClick={onFilterDispatch}
            className={`${btn} border-fuchsia-300 bg-white text-fuchsia-800 hover:bg-fuchsia-50`}
            data-testid="invoice-gib-filter-dispatch"
          >
            <Truck className="w-3.5 h-3.5" />
            Liste
          </button>
          <Link
            to="/dispatches"
            className={`${btn} border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900 hover:bg-fuchsia-100`}
            data-testid="invoice-gib-dispatches-link"
          >
            <Truck className="w-3.5 h-3.5" />
            İrsaliyeler
          </Link>
        </div>
      )}
    </div>
  );
}
