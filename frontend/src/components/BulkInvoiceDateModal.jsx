import React, { useState } from "react";
import { X, History } from "lucide-react";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { invoiceBulkDateSummaryText } from "../utils/invoiceBulkActions";

export function BulkInvoiceDateModal({
  updateCount = 0,
  skipCount = 0,
  defaultDate,
  busy = false,
  onClose,
  onConfirm,
}) {
  useEscape(busy ? () => {} : onClose);
  const [date, setDate] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const submit = () => {
    if (busy) return;
    const value = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    onConfirm?.(value);
  };
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4"
      {...(busy ? { onClick: (e) => e.stopPropagation() } : backdropDismissProps(onClose))}
      data-testid="bulk-invoice-date-modal"
    >
      <div
        className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-slate-800 px-4 py-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5" data-testid="bulk-invoice-date-title">
            <History className="w-4 h-4" />
            Toplu fatura tarihi
          </h3>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            className="text-white/80 hover:text-white disabled:opacity-40"
            aria-label="Kapat"
            data-testid="bulk-invoice-date-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="text-slate-600" data-testid="bulk-invoice-date-summary">
            {invoiceBulkDateSummaryText({ updateCount, skipCount })}
          </p>
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase text-slate-500">Yeni tarih</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              data-testid="bulk-invoice-date-input"
            />
          </label>
        </div>
        <div className="p-3 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 border rounded-lg text-sm font-semibold disabled:opacity-50"
            data-testid="bulk-invoice-date-cancel"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            data-testid="bulk-invoice-date-confirm"
          >
            {busy ? "Güncelleniyor…" : "Güncelle"}
          </button>
        </div>
      </div>
    </div>
  );
}
