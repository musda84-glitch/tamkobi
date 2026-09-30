import React, { useEffect, useState } from "react";
import axios from "axios";
import { X, ChevronDown, ListOrdered, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { orderCanIssueEFatura, orderEBelgeType, efaturaOnayMessage } from "../utils/orderEBelge";

/**
 * Faturalaştı siparişte «E-Fatura Oluştur» onayı.
 * E-fatura mükellefinde Temel / Ticari senaryo seçimi; kontör bakiyesi gösterilir.
 */
export function ElektronikFaturaOnayModal({
  order,
  contacts = [],
  companyId,
  onClose,
  onConfirm,
}) {
  useEscape(onClose);
  const [credits, setCredits] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isEFatura = orderCanIssueEFatura(order, contacts);
  const eType = orderEBelgeType(order, contacts);
  const message = efaturaOnayMessage(order, contacts);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    axios
      .get(`${API_URL}/account/gib-credits`, { params: { company_id: companyId } })
      .then((r) => {
        if (!cancelled) setCredits(Number(r.data?.balance ?? 0));
      })
      .catch(() => {
        if (!cancelled) setCredits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const submit = async (scenario) => {
    setBusy(true);
    setMenuOpen(false);
    try {
      await onConfirm?.({
        eType,
        scenario: eType === "e_invoice" ? scenario : undefined,
      });
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4"
      {...backdropDismissProps(onClose)}
      data-testid="efatura-onay-modal"
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-sky-800 px-4 py-3 rounded-t-2xl">
          <h3 className="text-sm font-bold text-white" data-testid="efatura-onay-title">
            Elektronik Fatura Onayı
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white"
            aria-label="Kapat"
            data-testid="efatura-onay-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-slate-700 leading-relaxed" data-testid="efatura-onay-msg">
            {message}
          </p>
          {credits != null && (
            <div
              className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5 text-sm text-amber-900"
              data-testid="efatura-onay-credits"
            >
              <ListOrdered className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                <b>{credits.toLocaleString("tr-TR")}</b> adet e-fatura kontörünüz var.
              </span>
            </div>
          )}
        </div>

        <div className="relative flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/80 rounded-b-2xl overflow-visible">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm disabled:opacity-50"
            data-testid="efatura-onay-cancel"
          >
            <X className="w-4 h-4" />
            Vazgeç
          </button>

          {isEFatura ? (
            <div className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                data-testid="efatura-onay-continue"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Devam Et
                <ChevronDown className={`w-4 h-4 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-slate-200 rounded-xl p-1.5 shadow-lg z-10"
                  role="menu"
                  data-testid="efatura-onay-scenario-menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => submit("TEMEL")}
                    className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                    data-testid="efatura-onay-temel"
                  >
                    Temel Fatura Gönder
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => submit("TICARI")}
                    className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                    data-testid="efatura-onay-ticari"
                  >
                    Ticari Fatura Gönder
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => submit()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50"
              data-testid="efatura-onay-continue"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Devam Et
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ElektronikFaturaOnayModal;
