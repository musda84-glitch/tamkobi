import React, { useState } from "react";
import { X } from "lucide-react";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { CANCEL_REQUEST_ACCEPT_CONFIRM } from "../utils/orderCancelRequest";

export function OrderCancelRequestDialog({
  action,
  order,
  busy = false,
  onClose,
  onConfirm,
}) {
  useEscape(onClose);
  const [note, setNote] = useState("");
  if (!order || (action !== "accept" && action !== "reject")) return null;
  const isAccept = action === "accept";
  const title = isAccept ? "İptal talebini onayla" : "İptal talebini reddet";
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4"
      {...backdropDismissProps(onClose)}
      data-testid="cancel-request-dialog"
      data-action={action}
    >
      <div
        className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-slate-800 px-4 py-3">
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <button type="button" onClick={onClose} className="text-white/80 hover:text-white" aria-label="Kapat" data-testid="cancel-request-dialog-close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="font-semibold text-slate-800">{order.order_number}</p>
          {isAccept ? (
            <p className="text-slate-600" data-testid="cancel-request-accept-text">{CANCEL_REQUEST_ACCEPT_CONFIRM}</p>
          ) : (
            <label className="block text-xs text-slate-600">
              Not (isteğe bağlı)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm"
                data-testid="cancel-request-reject-note"
              />
            </label>
          )}
        </div>
        <div className="p-3 border-t flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 border rounded-lg text-sm">Vazgeç</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm?.(isAccept ? "" : note)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold text-white ${isAccept ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
            data-testid="cancel-request-dialog-confirm"
          >
            {isAccept ? "Onayla" : "Reddet"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrderCancelRequestBadge({ ord, className = "" }) {
  if (String(ord?.cancel_request?.status || "") !== "pending") return null;
  const reason = String(ord?.cancel_request?.reason || "").trim();
  return (
    <span
      className={`text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block ${className}`}
      title={reason ? `İptal talebi: ${reason}` : "İptal talebi"}
      data-testid={`cancel-request-badge-${ord.order_number}`}
    >
      İptal talebi
    </span>
  );
}
