import React from "react";
import { X, Mail } from "lucide-react";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";

export function BulkInvoiceLinkConfirmModal({
  ready = [],
  skipped = [],
  total,
  busy = false,
  onClose,
  onConfirm,
}) {
  useEscape(busy ? () => {} : onClose);
  const n = total != null ? total : ready.length + skipped.length;
  const submit = () => {
    if (busy || !ready.length) return;
    onConfirm?.();
  };
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4"
      {...(busy ? { onClick: (e) => e.stopPropagation() } : backdropDismissProps(onClose))}
      data-testid="bulk-invoice-link-confirm-modal"
    >
      <div
        className="bg-white rounded-xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-indigo-600 px-4 py-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5" data-testid="bulk-invoice-link-confirm-title">
            <Mail className="w-4 h-4" />
            Fatura linki gönder
          </h3>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            className="text-white/80 hover:text-white disabled:opacity-40"
            aria-label="Kapat"
            data-testid="bulk-invoice-link-confirm-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto text-sm">
          <p className="text-slate-600" data-testid="bulk-invoice-link-confirm-total">
            {n} fatura seçildi. Link 30 gün geçerlidir.
          </p>
          {ready.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase text-slate-500 mb-1">Alıcılar</div>
              <ul className="space-y-1" data-testid="bulk-invoice-link-ready-list">
                {ready.map(({ inv, email }) => (
                  <li
                    key={inv.id || inv._id || inv.invoice_number}
                    className="rounded-lg bg-emerald-50 text-emerald-900 px-3 py-1.5 font-medium"
                    data-testid="bulk-invoice-link-ready-row"
                  >
                    {inv.invoice_number || "—"} → {email}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skipped.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase text-slate-500 mb-1">E-postası yok (atlanacak)</div>
              <ul className="space-y-1" data-testid="bulk-invoice-link-skipped-list">
                {skipped.map(({ inv }) => (
                  <li
                    key={inv.id || inv._id || inv.invoice_number}
                    className="rounded-lg bg-amber-50 text-amber-900 px-3 py-1.5"
                    data-testid="bulk-invoice-link-skipped-row"
                  >
                    {inv.invoice_number || "—"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="p-3 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 border rounded-lg text-sm font-semibold disabled:opacity-50"
            data-testid="bulk-invoice-link-confirm-cancel"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !ready.length}
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            data-testid="bulk-invoice-link-confirm-send"
          >
            {busy ? "Gönderiliyor…" : "Gönder"}
          </button>
        </div>
      </div>
    </div>
  );
}
