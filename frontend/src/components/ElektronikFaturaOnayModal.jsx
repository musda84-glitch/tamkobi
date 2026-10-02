import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  X,
  ChevronDown,
  ListOrdered,
  Loader2,
  Check,
  CheckCircle2,
  Circle,
  AlertCircle,
  Printer,
} from "lucide-react";
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
import {
  TAX_EXEMPTION_OPTIONS,
  TAX_EXEMPTION_LABELS,
  invoiceNeedsExemptionPrompt,
} from "../utils/invoiceExemption";

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

function docLabel(doc) {
  return (
    doc?.invoice_number ||
    doc?.order_number ||
    doc?.display_number ||
    doc?.id ||
    doc?._id ||
    "Belge"
  );
}

function docKey(doc, idx = 0) {
  return String(doc?.id || doc?._id || doc?.invoice_number || doc?.order_number || `doc-${idx}`);
}

export const DEFAULT_SEND_FLOW = [
  { id: "prepare", label: "Hazırlık ve doğrulama" },
  { id: "send", label: "Entegratöre / GİB’e gönderim" },
  { id: "refresh", label: "GİB durum sorgusu" },
  { id: "done", label: "Tamamlandı" },
];

export const DEFAULT_PRINT_FLOW = [
  { id: "prepare", label: "Belgeler hazırlanıyor" },
  { id: "print", label: "Yazdırma pencereleri açılıyor" },
  { id: "done", label: "Tamamlandı" },
];

export function makeFlowState(defs) {
  return (defs || []).map((s, i) => ({
    id: s.id,
    label: s.label,
    status: i === 0 ? "pending" : "pending",
    detail: "",
  }));
}

/** Progress helpers passed to onConfirm(payload, ctx). */
export function createOnayProgressApi(setFlowSteps, setItemStatuses) {
  return {
    setSteps(defs) {
      setFlowSteps(makeFlowState(defs));
    },
    setStep(id, status = "active", detail = "") {
      setFlowSteps((prev) => {
        const list = prev.length ? prev : makeFlowState(DEFAULT_SEND_FLOW);
        const idx = list.findIndex((s) => s.id === id);
        return list.map((s, i) => {
          if (s.id === id) return { ...s, status, detail: detail || s.detail };
          if (status === "active" && i < idx && s.status !== "error" && s.status !== "done") {
            return { ...s, status: "done" };
          }
          return s;
        });
      });
    },
    completeStep(id, detail = "") {
      setFlowSteps((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "done", detail: detail || s.detail } : s)),
      );
    },
    failStep(id, detail = "") {
      setFlowSteps((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "error", detail: detail || s.detail } : s)),
      );
    },
    initItems(items) {
      setItemStatuses(
        (items || []).map((it, idx) => ({
          id: String(it.id ?? docKey(it, idx)),
          label: it.label || docLabel(it),
          sublabel: it.sublabel || it.contact_name || it.customer_name || "",
          status: "pending",
          detail: "",
        })),
      );
    },
    setItem(id, patch = {}) {
      const key = String(id);
      setItemStatuses((prev) =>
        prev.map((it) => (it.id === key ? { ...it, ...patch } : it)),
      );
    },
  };
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

function FlowStepIcon({ status }) {
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (status === "error") return <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />;
  if (status === "active") return <Loader2 className="w-4 h-4 text-sky-600 animate-spin shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-300 shrink-0" />;
}

function ItemStatusIcon({ status }) {
  if (status === "ok" || status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
  if (status === "error" || status === "fail") return <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
  if (status === "running" || status === "active") return <Loader2 className="w-3.5 h-3.5 text-sky-600 animate-spin shrink-0" />;
  if (status === "skipped") return <Circle className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  return <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />;
}

/**
 * Faturalaştı siparişte «E-Fatura Oluştur» / fatura ⋮ «E-Fatura / E-Arşiv (GİB)» onayı.
 * İşlem bitene kadar açık kalır; durum akışı + (toplu) belge durumları gösterilir.
 */
export function ElektronikFaturaOnayModal({
  order,
  invoice,
  invoices,
  mode = "send",
  contacts = [],
  companyId,
  onClose,
  onConfirm,
}) {
  const isPrint = mode === "print";
  const bulkDocs = useMemo(() => {
    if (Array.isArray(invoices) && invoices.length) return invoices;
    return [];
  }, [invoices]);
  const isBulk = bulkDocs.length > 1 || (bulkDocs.length === 1 && !invoice && !order);
  const doc = order || invoice || bulkDocs[0] || null;

  const [credits, setCredits] = useState(null);
  const [creditsSource, setCreditsSource] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(!isPrint);
  const [menuOpen, setMenuOpen] = useState(false);
  const [gibMeta, setGibMeta] = useState(null);
  const askExemption = !isPrint && !isBulk && invoiceNeedsExemptionPrompt(invoice || doc);
  const askWithholding = !isPrint && !isBulk && invoiceNeedsWithholdingPrompt(invoice || doc);
  const [exemptionCode, setExemptionCode] = useState(
    String(doc?.tax_exemption_code || doc?.vat_exemption_code || "").trim(),
  );
  const [withholdingValue, setWithholdingValue] = useState("");
  const [withholdingTouched, setWithholdingTouched] = useState(false);
  const isReturnInvoice = !isPrint && !isBulk && isReturnInvoiceDoc(doc);
  const prefilled = prefillReturnBillingRef(doc);
  const [returnInvoiceNo, setReturnInvoiceNo] = useState(prefilled.number);
  const [returnInvoiceDate, setReturnInvoiceDate] = useState(prefilled.date);

  const [phase, setPhase] = useState("confirm"); // confirm | running | done
  const [flowSteps, setFlowSteps] = useState([]);
  const [itemStatuses, setItemStatuses] = useState([]);
  const [runError, setRunError] = useState("");
  const [summary, setSummary] = useState("");

  const busy = phase === "running";
  const canDismiss = phase !== "running";

  useEscape(canDismiss ? onClose : () => {});

  const fallbackEFatura = orderCanIssueEFatura(doc, contacts);
  const isEFatura = gibMeta ? !!gibMeta.is_e_invoice_user : fallbackEFatura;
  const suggestedEType = gibMeta?.suggested_e_type || orderEBelgeType(doc, contacts);
  const message = isPrint
    ? isBulk || bulkDocs.length
      ? `${bulkDocs.length || 1} fatura yazdırılacak. İşlem bitene kadar bu pencere açık kalır; her belgenin durumu listede görünür.`
      : "Fatura yazdırılacak. İşlem bitene kadar bu pencere açık kalır."
    : gibMeta?.message
      ? (isEFatura
        ? "Bu müşteri e-fatura mükellefidir, karşı tarafa e-fatura gönderilecek. Onaylıyor musunuz?"
        : "Bu müşteri e-fatura mükellefi değildir, e-arşiv faturası oluşturulacak. Onaylıyor musunuz?")
      : isBulk
        ? `${bulkDocs.length} fatura için e-belge gönderimi başlatılacak. Onaylıyor musunuz? İşlem bitene kadar durum akışı burada görünür.`
        : efaturaOnayMessage(doc, contacts);

  useEffect(() => {
    const next = prefillReturnBillingRef(doc);
    setReturnInvoiceNo(next.number);
    setReturnInvoiceDate(next.date);
    setExemptionCode(String(doc?.tax_exemption_code || doc?.vat_exemption_code || "").trim());
  }, [doc]);

  useEffect(() => {
    if (isPrint) {
      setLoadingMeta(false);
      return;
    }
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

    const loadGib = (!isBulk && (tax.length === 10 || tax.length === 11))
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
  }, [companyId, doc, contacts, isPrint, isBulk]);

  const runJob = async (payload) => {
    setMenuOpen(false);
    setPhase("running");
    setRunError("");
    setSummary("");
    const defaults = isPrint ? DEFAULT_PRINT_FLOW : DEFAULT_SEND_FLOW;
    setFlowSteps(makeFlowState(defaults));
    const docsForItems = bulkDocs.length ? bulkDocs : doc ? [doc] : [];
    setItemStatuses(
      docsForItems.map((d, idx) => ({
        id: docKey(d, idx),
        label: docLabel(d),
        sublabel: d?.contact_name || d?.customer_name || "",
        status: "pending",
        detail: "",
      })),
    );

    const ctx = createOnayProgressApi(setFlowSteps, setItemStatuses);
    ctx.setStep(defaults[0]?.id || "prepare", "active");

    try {
      const result = await Promise.resolve().then(() => onConfirm?.(payload, ctx));
      setFlowSteps((prev) =>
        prev.map((s) =>
          s.status === "active" || s.status === "pending"
            ? { ...s, status: s.id === "done" || s.status === "active" ? "done" : "done" }
            : s,
        ),
      );
      ctx.setStep("done", "done");
      if (result && typeof result === "object") {
        const ok = Number(result.ok || 0);
        const fail = Number(result.fail || 0);
        const skipped = Number(result.skipped || 0);
        if (ok || fail || skipped) {
          setSummary(
            `${ok} başarılı${fail ? `, ${fail} hata` : ""}${skipped ? `, ${skipped} atlandı` : ""}.`,
          );
        } else if (result.message) {
          setSummary(String(result.message));
        }
      }
      setPhase("done");
    } catch (err) {
      const detail = confirmErrorDetail(err);
      setRunError(detail);
      setFlowSteps((prev) => {
        const active = prev.find((s) => s.status === "active");
        if (!active) return prev;
        return prev.map((s) =>
          s.id === active.id ? { ...s, status: "error", detail } : s,
        );
      });
      toast.error(detail);
      setPhase("done");
    }
  };

  const submit = (scenario) => {
    if (isPrint) {
      runJob({ mode: "print" });
      return;
    }
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
    if (askExemption && !String(exemptionCode || "").trim()) {
      toast.error("KDV %0 satır var — vergi muafiyet / istisna kodunu seçin.");
      setMenuOpen(false);
      return;
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
    const exCode = String(exemptionCode || "").trim();
    const exemption = exCode
      ? {
          tax_exemption_code: exCode,
          tax_exemption_reason: (
            TAX_EXEMPTION_LABELS[exCode] || `Vergi muafiyet kodu ${exCode}`
          ).replace(/^\d+\s*[–-]\s*/, ""),
        }
      : undefined;
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
      exemption,
      returnRef,
      documents: bulkDocs.length ? bulkDocs : doc ? [doc] : [],
      mode: "send",
    };
    runJob(payload);
  };

  const title = isPrint
    ? (isBulk || bulkDocs.length > 1 ? "Toplu Fatura Yazdırma" : "Fatura Yazdırma")
    : isBulk
      ? "Toplu Elektronik Fatura Onayı"
      : "Elektronik Fatura Onayı";

  const showConfirmForm = phase === "confirm";

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4"
      {...(canDismiss ? backdropDismissProps(onClose) : { onClick: (e) => e.stopPropagation() })}
      data-testid="efatura-onay-modal"
      data-phase={phase}
      data-mode={mode}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-sky-800 px-4 py-3 rounded-t-2xl sticky top-0 z-[1]">
          <h3 className="text-sm font-bold text-white" data-testid="efatura-onay-title">
            {title}
          </h3>
          <button
            type="button"
            onClick={canDismiss ? onClose : undefined}
            disabled={!canDismiss}
            className="text-white/80 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Kapat"
            data-testid="efatura-onay-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {showConfirmForm && (
            <>
              {loadingMeta ? (
                <p className="text-sm text-slate-500 flex items-center gap-2" data-testid="efatura-onay-loading">
                  <Loader2 className="w-4 h-4 animate-spin" /> Entegratör sorgulanıyor…
                </p>
              ) : (
                <p className="text-sm text-slate-700 leading-relaxed" data-testid="efatura-onay-msg">
                  {message}
                </p>
              )}
              {credits != null && !isPrint && (
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
              {(isBulk || bulkDocs.length > 1) && (
                <div
                  className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 max-h-36 overflow-y-auto"
                  data-testid="efatura-onay-bulk-preview"
                >
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                    {bulkDocs.length} belge
                  </p>
                  <ul className="space-y-1">
                    {bulkDocs.slice(0, 40).map((d, idx) => (
                      <li key={docKey(d, idx)} className="text-xs text-slate-700 flex justify-between gap-2">
                        <span className="font-semibold truncate">{docLabel(d)}</span>
                        <span className="text-slate-400 truncate shrink min-w-0">
                          {d?.contact_name || d?.customer_name || ""}
                        </span>
                      </li>
                    ))}
                    {bulkDocs.length > 40 && (
                      <li className="text-[11px] text-slate-400">+{bulkDocs.length - 40} belge daha…</li>
                    )}
                  </ul>
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
              {askExemption && (
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-3 space-y-2"
                  data-testid="efatura-onay-exemption"
                >
                  <label className="block text-sm font-semibold text-amber-950" htmlFor="efatura-onay-ex-select">
                    KDV %0 — Vergi muafiyet / istisna sebebi
                  </label>
                  <p className="text-[11px] text-amber-900/80 leading-snug">
                    İşNet/GİB, KDV oranı 0 olan faturalarda TaxExemptionReasonCode ister.
                    Uygun kodu seçmeden gönderim reddedilir.
                  </p>
                  <select
                    id="efatura-onay-ex-select"
                    value={exemptionCode}
                    onChange={(e) => setExemptionCode(e.target.value)}
                    className="w-full bg-white border border-amber-200 rounded-lg p-2 text-sm font-medium text-slate-800"
                    data-testid="efatura-onay-exemption-select"
                  >
                    <option value="" disabled>
                      Muafiyet kodu seçin…
                    </option>
                    {TAX_EXEMPTION_OPTIONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {askWithholding && (
                <div
                  className="rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-3 space-y-2"
                  data-testid="efatura-onay-withholding"
                >
                  <label className="block text-sm font-semibold text-indigo-900" htmlFor="efatura-onay-wh-select">
                    Tevkifat (isteğe bağlı)
                  </label>
                  <p className="text-[11px] text-indigo-800/80 leading-snug">
                    Hizmet tevkifatı uygulanacaksa kodu seçin; değilse «Tevkifat yok».
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
            </>
          )}

          {(phase === "running" || phase === "done") && (
            <div className="space-y-3" data-testid="efatura-onay-progress">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                    İşlem sürüyor — pencereyi kapatmayın
                  </>
                ) : runError ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    İşlem tamamlandı (hata var)
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    İşlem tamamlandı
                  </>
                )}
              </div>
              {summary && (
                <p className="text-xs text-slate-600" data-testid="efatura-onay-summary">{summary}</p>
              )}
              {runError && (
                <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2" data-testid="efatura-onay-error">
                  {runError}
                </p>
              )}
              <ol className="space-y-2" data-testid="efatura-onay-flow">
                {flowSteps.map((step) => (
                  <li
                    key={step.id}
                    className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-sm border ${
                      step.status === "active"
                        ? "bg-sky-50 border-sky-100 text-sky-900"
                        : step.status === "done"
                          ? "bg-emerald-50/60 border-emerald-100 text-emerald-900"
                          : step.status === "error"
                            ? "bg-rose-50 border-rose-100 text-rose-900"
                            : "bg-slate-50 border-slate-100 text-slate-500"
                    }`}
                    data-testid={`efatura-flow-${step.id}`}
                    data-status={step.status}
                  >
                    <FlowStepIcon status={step.status} />
                    <div className="min-w-0">
                      <div className="font-medium leading-snug">{step.label}</div>
                      {step.detail ? (
                        <div className="text-[11px] opacity-80 mt-0.5 break-words">{step.detail}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
              {itemStatuses.length > 0 && (
                <div
                  className="rounded-xl border border-slate-200 overflow-hidden"
                  data-testid="efatura-onay-items"
                >
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Fatura işlem durumları ({itemStatuses.filter((i) => i.status === "ok" || i.status === "done").length}/{itemStatuses.length})
                  </div>
                  <ul className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                    {itemStatuses.map((it) => (
                      <li
                        key={it.id}
                        className="flex items-start gap-2 px-3 py-2 text-xs"
                        data-testid={`efatura-item-${it.id}`}
                        data-status={it.status}
                      >
                        <ItemStatusIcon status={it.status} />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-800 truncate">{it.label}</div>
                          {it.sublabel ? (
                            <div className="text-slate-400 truncate">{it.sublabel}</div>
                          ) : null}
                          {it.detail ? (
                            <div className={`mt-0.5 break-words ${it.status === "error" || it.status === "fail" ? "text-rose-600" : "text-slate-500"}`}>
                              {it.detail}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/80 rounded-b-2xl overflow-visible sticky bottom-0">
          {phase === "done" ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm"
              data-testid="efatura-onay-finish"
            >
              <Check className="w-4 h-4" />
              Kapat
            </button>
          ) : phase === "running" ? (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-200 text-slate-500 text-sm font-semibold cursor-not-allowed"
              data-testid="efatura-onay-busy"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              İşleniyor…
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold shadow-sm"
                data-testid="efatura-onay-cancel"
              >
                <X className="w-4 h-4" />
                Vazgeç
              </button>

              {isPrint ? (
                <button
                  type="button"
                  disabled={loadingMeta}
                  onClick={() => submit("PRINT")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50"
                  data-testid="efatura-onay-print"
                >
                  <Printer className="w-4 h-4" />
                  Yazdır
                </button>
              ) : (
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ElektronikFaturaOnayModal;
