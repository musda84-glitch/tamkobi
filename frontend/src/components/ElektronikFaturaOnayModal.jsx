import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, ChevronDown, ListOrdered, Loader2, Check } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import {
  orderCanIssueEFatura,
  orderEBelgeType,
  efaturaOnayMessage,
  resolveOrderContact,
} from "../utils/orderEBelge";
import {
  WITHHOLDING_OPTIONS,
  invoiceNeedsWithholdingPrompt,
  parseWithholdingValue,
} from "../utils/invoiceWithholding";

function digitsTax(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function orderBuyerTaxId(order, contacts = []) {
  const c = resolveOrderContact(order, contacts);
  const tax =
    c?.tax_number_or_id ||
    c?.tax_id ||
    order?.contact_tax_id ||
    order?.buyer_tax_id ||
    order?.customer_tax_id ||
    "";
  return digitsTax(tax);
}

function confirmErrorDetail(err) {
  const d = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.message;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (Array.isArray(d)) {
    const parts = d.map((x) => x?.msg || x?.message || x?.detail || "").filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return "Gönderim başarısız.";
}

export function isReturnInvoiceDoc(doc) {
  const invTypeNorm = String(doc?.invoice_type || "")
    .replace(/İ/g, "I")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    ["return", "sales_return", "purchase_return", "iade"].includes(invTypeNorm) ||
    invTypeNorm.includes("return") ||
    invTypeNorm.includes("iade")
  );
}

/** Nota / alanlardan iade edilen fatura no + tarih ön doldurma. */
export function prefillReturnBillingRef(doc) {
  const number = String(
    doc?.original_invoice_number ||
      doc?.return_of_invoice_number ||
      doc?.billing_reference_id ||
      doc?.referenced_invoice_number ||
      "",
  ).trim();
  let date = String(
    doc?.original_issue_date ||
      doc?.return_of_issue_date ||
      doc?.billing_reference_date ||
      "",
  ).trim().slice(0, 10);
  const notes = String(doc?.notes || "");
  let num = number;
  if (!num) {
    const m =
      notes.match(/([A-Z]{2,3}\d{10,16})\s*numaral[ıi]/i) ||
      notes.match(/[←<]\s*([A-Z]{2,3}\d{10,16})/i) ||
      notes.match(/\b([A-Z]{2,3}\d{13,16})\b/i);
    if (m) num = m[1].toUpperCase();
  }
  if (!date) {
    const m2 = notes.match(/(\d{2})[./](\d{2})[./](\d{4})\s*tarihli/);
    if (m2) date = `${m2[3]}-${m2[2]}-${m2[1]}`;
  }
  return { number: num, date };
}

export function buildIadeNote(number, dateYmd) {
  const no = String(number || "").trim().toUpperCase();
  const ymd = String(dateYmd || "").slice(0, 10);
  let trDate = ymd;
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split("-");
    trDate = `${d}.${m}.${y}`;
  }
  return `${trDate} tarihli ${no} numaralı faturaya istinaden düzenlenen iade faturasıdır.`;
}

/**
 * Faturalaştı siparişte «E-Fatura Oluştur» / fatura ⋮ «E-Fatura / E-Arşiv (GİB)» onayı.
 * İade: orijinal fatura no + tarih formu. KDV %0: tevkifat seçimi.
 */
export function ElektronikFaturaOnayModal({
  order,
  invoice,
  contacts = [],
  companyId,
  onClose,
  onConfirm,
}) {
  useEscape(onClose);
  const doc = order || invoice || null;
  const [credits, setCredits] = useState(null);
  const [creditsSource, setCreditsSource] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [gibMeta, setGibMeta] = useState(null);
  const askWithholding = invoiceNeedsWithholdingPrompt(invoice || doc);
  const [withholdingValue, setWithholdingValue] = useState("");
  const [withholdingTouched, setWithholdingTouched] = useState(false);
  const isReturnInvoice = isReturnInvoiceDoc(doc);
  const prefilled = prefillReturnBillingRef(doc);
  const [returnInvoiceNo, setReturnInvoiceNo] = useState(prefilled.number);
  const [returnInvoiceDate, setReturnInvoiceDate] = useState(prefilled.date);

  const fallbackEFatura = orderCanIssueEFatura(doc, contacts);
  const isEFatura = gibMeta ? !!gibMeta.is_e_invoice_user : fallbackEFatura;
  const suggestedEType = gibMeta?.suggested_e_type || orderEBelgeType(doc, contacts);
  const message = gibMeta?.message
    ? (isEFatura
      ? "Bu müşteri e-fatura mükellefidir, karşı tarafa e-fatura gönderilecek. Onaylıyor musunuz?"
      : "Bu müşteri e-fatura mükellefi değildir, e-arşiv faturası oluşturulacak. Onaylıyor musunuz?")
    : efaturaOnayMessage(doc, contacts);

  useEffect(() => {
    const next = prefillReturnBillingRef(doc);
    setReturnInvoiceNo(next.number);
    setReturnInvoiceDate(next.date);
  }, [doc]);

  useEffect(() => {
    if (!companyId) {
      setLoadingMeta(false);
      return;
    }
    let cancelled = false;
    const tax = orderBuyerTaxId(doc, contacts);

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
  }, [companyId, doc, contacts]);

  const submit = (scenario) => {
    if (isReturnInvoice) {
      const no = String(returnInvoiceNo || "").trim();
      const dt = String(returnInvoiceDate || "").trim();
      if (!no) {
        toast.error("İade edilen fatura numarasını girin.");
        setMenuOpen(false);
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
        toast.error("İade edilen faturanın tarihini seçin.");
        setMenuOpen(false);
        return;
      }
    }
    if (askWithholding && !withholdingTouched) {
      toast.error("KDV %0 satır var — tevkifat seçin veya «Tevkifat yok» deyin.");
      setMenuOpen(false);
      return;
    }
    // GİB Schematron: iade → yalnızca Temel (Ticari yasak)
    const sc = isReturnInvoice || scenario === "TEMEL" ? "TEMEL" : "TICARI";
    setMenuOpen(false);
    const wh = askWithholding ? parseWithholdingValue(withholdingValue) : null;
    const returnRef = isReturnInvoice
      ? {
          original_invoice_number: String(returnInvoiceNo || "").trim().toUpperCase(),
          original_issue_date: String(returnInvoiceDate || "").trim().slice(0, 10),
          notes: buildIadeNote(returnInvoiceNo, returnInvoiceDate),
        }
      : undefined;
    const payload = {
      // Kullanıcı Temel/Ticari seçti → her zaman e-fatura senaryosu (lookup e-arşiv dese bile).
      eType: "e_invoice",
      scenario: sc,
      suggestedEType,
      alias: gibMeta?.alias || undefined,
      gibMeta: gibMeta || undefined,
      withholding: wh || undefined,
      returnRef,
    };
    const confirmFn = onConfirm;
    // Modal hemen kapansın; uzun süren GİB/entegratör gönderimi arka planda devam etsin.
    onClose?.();
    toast.message("E-fatura gönderimi arka planda devam ediyor…");
    Promise.resolve()
      .then(() => confirmFn?.(payload))
      .catch((err) => {
        toast.error(confirmErrorDetail(err));
      });
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4"
      {...backdropDismissProps(onClose)}
      data-testid="efatura-onay-modal"
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-sky-800 px-4 py-3 rounded-t-2xl sticky top-0 z-[1]">
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
          {isReturnInvoice && (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50/90 px-3 py-3 space-y-2.5"
              data-testid="efatura-onay-iade-fields"
            >
              <div>
                <p className="text-sm font-semibold text-rose-900">İade edilen fatura</p>
                <p className="text-[11px] text-rose-800/80 leading-snug mt-0.5">
                  GİB Schematron için orijinal fatura numarası ve tarihi zorunlu.
                  İade yalnızca <b>Temel</b> senaryoda gönderilir.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-[11px] font-semibold text-rose-900 uppercase tracking-wide">
                    Fatura numarası
                  </span>
                  <input
                    type="text"
                    value={returnInvoiceNo}
                    onChange={(e) => setReturnInvoiceNo(e.target.value.toUpperCase())}
                    placeholder="Örn. U052026000000065"
                    autoComplete="off"
                    className="w-full bg-white border border-rose-200 rounded-lg px-3 py-2 text-sm font-medium text-slate-800 placeholder:text-slate-400"
                    data-testid="efatura-onay-iade-number"
                  />
                </label>
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-[11px] font-semibold text-rose-900 uppercase tracking-wide">
                    Fatura tarihi
                  </span>
                  <input
                    type="date"
                    value={returnInvoiceDate}
                    onChange={(e) => setReturnInvoiceDate(e.target.value)}
                    className="w-full bg-white border border-rose-200 rounded-lg px-3 py-2 text-sm font-medium text-slate-800"
                    data-testid="efatura-onay-iade-date"
                  />
                </label>
              </div>
            </div>
          )}
          {askWithholding && (
            <div
              className="rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-3 space-y-2"
              data-testid="efatura-onay-withholding"
            >
              <label className="block text-sm font-semibold text-indigo-900" htmlFor="efatura-onay-wh-select">
                KDV %0 satır var — Tevkifat (Hizmet Faturası)
              </label>
              <p className="text-[11px] text-indigo-800/80 leading-snug">
                E-fatura kesmeden önce tevkifat kodunu seçin. Uygulanmayacaksa «Tevkifat yok» seçin.
              </p>
              <select
                id="efatura-onay-wh-select"
                value={withholdingValue}
                onChange={(e) => {
                  setWithholdingValue(e.target.value);
                  setWithholdingTouched(true);
                }}
                className="w-full bg-white border border-indigo-200 rounded-lg p-2 text-sm font-medium text-slate-800"
                data-testid="efatura-onay-withholding-select"
              >
                {!withholdingTouched && (
                  <option value="" disabled>
                    Tevkifat seçin…
                  </option>
                )}
                {WITHHOLDING_OPTIONS.map(([v, l]) => (
                  <option key={v || "yok"} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="relative flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/80 rounded-b-2xl overflow-visible sticky bottom-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm"
            data-testid="efatura-onay-cancel"
          >
            <X className="w-4 h-4" />
            Vazgeç
          </button>

          <div className="relative">
            <button
              type="button"
              disabled={loadingMeta}
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              data-testid="efatura-onay-continue"
            >
              <Check className="w-4 h-4" />
              Devam Et
              <ChevronDown className={`w-4 h-4 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 bottom-full mb-1.5 w-56 bg-white border border-slate-200 rounded-xl p-1.5 shadow-lg z-10"
                role="menu"
                data-testid="efatura-onay-scenario-menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => submit("TEMEL")}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  data-testid="efatura-onay-temel"
                >
                  {isReturnInvoice ? "İade — Temel Fatura Gönder" : "Temel Fatura Gönder"}
                </button>
                {!isReturnInvoice && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => submit("TICARI")}
                    className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                    data-testid="efatura-onay-ticari"
                  >
                    Ticari Fatura Gönder
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ElektronikFaturaOnayModal;
