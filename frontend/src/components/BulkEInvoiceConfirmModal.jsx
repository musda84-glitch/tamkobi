import React, { useState } from "react";
import { X } from "lucide-react";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { ordersHaveOldDocumentDate } from "../utils/orderBulkActions";

/**
 * Toplu E-Fatura ön onayı: eski tarihli faturaları bugüne çekme seçeneği.
 */
export function BulkEInvoiceConfirmModal({
  orders = [],
  onClose,
  onConfirm,
  busy = false,
}) {
  useEscape(busy ? () => {} : onClose);
  const hasOld = ordersHaveOldDocumentDate(orders);
  const [mode, setMode] = useState("today"); // today | keep

  const submit = () => {
    if (busy) return;
    onConfirm?.({ setDateToToday: mode === "today", orders });
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4"
      {...(busy ? { onClick: (e) => e.stopPropagation() } : backdropDismissProps(onClose))}
      data-testid="bulk-einvoice-confirm-modal"
    >
      <div
        className="bg-white rounded-xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-indigo-600 px-4 py-3">
          <h3 className="text-sm font-bold text-white" data-testid="bulk-einvoice-confirm-title">
            Toplu Faturalaştırma Onayı
          </h3>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            className="text-white/80 hover:text-white disabled:opacity-40"
            aria-label="Kapat"
            data-testid="bulk-einvoice-confirm-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {hasOld ? (
            <div
              className="rounded-lg bg-rose-100 text-rose-800 text-sm leading-relaxed px-3 py-2.5"
              data-testid="bulk-einvoice-old-date-warn"
            >
              Eski tarihli işlemleri faturalandırıyorsunuz. Dilerseniz bütün işlemlerin tarihini &quot;Bugün&quot; olarak güncelleyebiliriz.
            </div>
          ) : (
            <p className="text-sm text-slate-600" data-testid="bulk-einvoice-same-day-note">
              {orders.length} faturalaşmış sipariş için e-Fatura / e-Arşiv kesilecek.
            </p>
          )}

          <fieldset className="space-y-2" data-testid="bulk-einvoice-date-options">
            <legend className="sr-only">Fatura tarihi</legend>
            <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="radio"
                name="bulk-einvoice-date"
                value="today"
                checked={mode === "today"}
                onChange={() => setMode("today")}
                className="accent-rose-500"
                data-testid="bulk-einvoice-date-today"
              />
              Bugün olarak güncelle ve faturalaştır
            </label>
            <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="radio"
                name="bulk-einvoice-date"
                value="keep"
                checked={mode === "keep"}
                onChange={() => setMode("keep")}
                className="accent-rose-500"
                data-testid="bulk-einvoice-date-keep"
              />
              Tarihleri değiştirmeden faturalaştır
            </label>
          </fieldset>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1.5 border rounded-lg text-xs font-semibold text-slate-600 disabled:opacity-50"
              data-testid="bulk-einvoice-confirm-cancel"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !orders.length}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              data-testid="bulk-einvoice-confirm-submit"
            >
              {busy ? "Hazırlanıyor…" : "Onayla"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BulkEInvoiceConfirmModal;
