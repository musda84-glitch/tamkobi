import React, { useEffect, useState } from "react";
import axios from "axios";
import { X, ChevronDown, ListOrdered, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import {
  orderCanIssueEFatura,
  orderEBelgeType,
  efaturaOnayMessage,
  resolveOrderContact,
} from "../utils/orderEBelge";

function digitsTax(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function orderBuyerTaxId(order, contacts = []) {
  const c = resolveOrderContact(order, contacts);
  const tax =
    c?.tax_number_or_id ||
    c?.tax_id ||
    order?.contact_tax_id ||
    order?.customer_tax_id ||
    "";
  return digitsTax(tax);
}

/**
 * Faturalaştı siparişte «E-Fatura Oluştur» onayı.
 * Mükellefiyet + kontör entegratörden (GİB lookup / İşNet bakiye) gelir.
 * Devam Et her zaman Temel / Ticari senaryo seçimi ister (GİB önerisinden bağımsız).
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
  const [creditsSource, setCreditsSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [gibMeta, setGibMeta] = useState(null);

  const fallbackEFatura = orderCanIssueEFatura(order, contacts);
  const isEFatura = gibMeta ? !!gibMeta.is_e_invoice_user : fallbackEFatura;
  const suggestedEType = gibMeta?.suggested_e_type || orderEBelgeType(order, contacts);
  const message = gibMeta?.message
    ? (isEFatura
      ? "Bu müşteri e-fatura mükellefidir, karşı tarafa e-fatura gönderilecek. Onaylıyor musunuz?"
      : "Bu müşteri e-fatura mükellefi değildir, e-arşiv faturası oluşturulacak. Onaylıyor musunuz?")
    : efaturaOnayMessage(order, contacts);

  useEffect(() => {
    if (!companyId) {
      setLoadingMeta(false);
      return;
    }
    let cancelled = false;
    const tax = orderBuyerTaxId(order, contacts);

    const loadCredits = axios
      .get(`${API_URL}/e-invoice/integrator-credits`, { params: { company_id: companyId } })
      .then((r) => {
        if (cancelled) return;
        const bal = r.data?.balance;
        setCredits(bal == null || Number.isNaN(Number(bal)) ? null : Number(bal));
        setCreditsSource(r.data?.source || r.data?.provider || "");
      })
      .catch(() => {
        if (!cancelled) {
          setCredits(null);
          setCreditsSource("");
        }
      });

    const loadGib = tax.length === 10 || tax.length === 11
      ? axios
        .get(`${API_URL}/gib/lookup`, { params: { tax_id: tax, company_id: companyId } })
        .then((r) => {
          if (!cancelled) setGibMeta(r.data || null);
        })
        .catch(() => {
          if (!cancelled) setGibMeta(null);
        })
      : Promise.resolve();

    Promise.all([loadCredits, loadGib]).finally(() => {
      if (!cancelled) setLoadingMeta(false);
    });

    return () => {
      cancelled = true;
    };
  }, [companyId, order, contacts]);

  const submit = async (scenario) => {
    const sc = scenario === "TEMEL" ? "TEMEL" : "TICARI";
    setBusy(true);
    setMenuOpen(false);
    setError("");
    try {
      // Kullanıcı Temel/Ticari seçti → her zaman e-fatura senaryosu (lookup e-arşiv dese bile).
      await onConfirm?.({
        eType: "e_invoice",
        scenario: sc,
        suggestedEType,
        alias: gibMeta?.alias || undefined,
        gibMeta: gibMeta || undefined,
      });
      onClose?.();
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Gönderim başarısız.";
      setError(typeof detail === "string" ? detail : "Gönderim başarısız.");
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
          {loadingMeta ? (
            <p className="text-sm text-slate-500 flex items-center gap-2" data-testid="efatura-onay-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Entegratör sorgulanıyor…
            </p>
          ) : (
            <p className="text-sm text-slate-700 leading-relaxed" data-testid="efatura-onay-msg">
              {message}
            </p>
          )}
          {credits != null && (
            <div
              className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5 text-sm text-amber-900"
              data-testid="efatura-onay-credits"
              data-credits-source={creditsSource || "integrator"}
            >
              <ListOrdered className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                <b>{credits.toLocaleString("tr-TR")}</b> adet e-fatura kontörünüz var.
                {creditsSource ? (
                  <span className="text-[11px] text-amber-700/80 ml-1">
                    ({creditsSource === "isnet" || creditsSource === "isnet_portal" ? "İşNet" : creditsSource})
                  </span>
                ) : null}
              </span>
            </div>
          )}
          {error ? (
            <div
              className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800"
              data-testid="efatura-onay-error"
              role="alert"
            >
              {error}
            </div>
          ) : null}
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

          <div className="relative">
            <button
              type="button"
              disabled={busy || loadingMeta}
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
        </div>
      </div>
    </div>
  );
}

export default ElektronikFaturaOnayModal;
