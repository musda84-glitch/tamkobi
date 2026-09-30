import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Copy, ChevronDown, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { SearchSelect } from "./SearchSelect";
import { API_URL } from "../context/AuthContext";
import { INVOICE_COPY_MODES, canCopyInvoice, normalizeContactOptions } from "./invoiceCopyModes";
import { backdropDismissProps } from "../utils/modalBackdrop";

export { INVOICE_COPY_MODES, canCopyInvoice, normalizeContactOptions } from "./invoiceCopyModes";

export async function copyInvoice(invoice, mode, contactId) {
  const id = invoice?.id || invoice?._id;
  if (!id) throw new Error("Fatura bulunamadı.");
  const body = { mode };
  if (contactId) body.contact_id = contactId;
  const r = await axios.post(`${API_URL}/invoices/${id}/copy`, body);
  return r.data;
}

/** Contact picker for different_contact / to_supplier_order. */
export function InvoiceCopyContactModal({ mode, invoice, contacts = [], companyId, onClose, onDone }) {
  const meta = INVOICE_COPY_MODES.find((m) => m.key === mode) || INVOICE_COPY_MODES[1];
  const [contactId, setContactId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState(() => normalizeContactOptions(contacts));

  useEffect(() => {
    let cancelled = false;
    const seed = normalizeContactOptions(contacts);
    if (seed.length) setList(seed);
    const cid = companyId || invoice?.company_id || "";
    if (!cid) {
      setLoading(false);
      if (!seed.length) toast.error("Firma seçili değil; cariler yüklenemedi.");
      return undefined;
    }
    setLoading(true);
    axios
      .get(`${API_URL}/contacts`, { params: { company_id: cid, lite: 1 } })
      .then((r) => {
        if (cancelled) return;
        const rows = normalizeContactOptions(r.data);
        setList(rows);
        if (!rows.length) toast.error("Bu firmada cari bulunamadı.");
      })
      .catch((err) => {
        if (cancelled) return;
        if (seed.length) {
          setList(seed);
          return;
        }
        toast.error(err.response?.data?.detail || "Cariler yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, invoice?.company_id, mode]); // eslint-disable-line react-hooks/exhaustive-deps -- seed contacts once; always refresh from API

  const filtered = meta.preferSupplier
    ? list.filter((c) => !c.type || c.type === "supplier" || c.type === "both" || c.is_supplier)
    : list;
  const options = filtered.length ? filtered : list;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!contactId) {
      toast.error(meta.preferSupplier ? "Tedarikçi seçin." : "Cari seçin.");
      return;
    }
    setBusy(true);
    try {
      const data = await copyInvoice(invoice, mode, contactId);
      toast.success(data.message);
      onDone?.(data);
      onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kopyalanamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 flex items-center justify-center p-4" {...backdropDismissProps(onClose)} data-testid="invoice-copy-contact-modal">
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3 text-xs"
      >
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold text-slate-900">{meta.label}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-slate-500">
          Kaynak: <b className="text-slate-800">{invoice?.invoice_number}</b>
          {invoice?.contact_name ? ` · ${invoice.contact_name}` : ""}
        </p>
        <div>
          <label className="block font-semibold mb-1">{meta.preferSupplier ? "Tedarikçi" : "Hedef cari"}</label>
          {loading && !options.length ? (
            <div className="text-slate-400 py-2" data-testid="invoice-copy-contact-loading">Cariler yükleniyor…</div>
          ) : (
            <SearchSelect
              value={contactId}
              options={options}
              getLabel={(c) => c.name || c.company_title || "—"}
              getSub={(c) => c.tax_number_or_id || c.phone || ""}
              placeholder={meta.preferSupplier ? "Tedarikçi ara…" : "Cari ara…"}
              onChange={(id) => setContactId(id || "")}
              testId="invoice-copy-contact-select"
              inline
            />
          )}
          {!loading && options.length > 0 && (
            <div className="text-[10px] text-slate-400 mt-1" data-testid="invoice-copy-contact-count">{options.length} cari</div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button type="submit" disabled={busy || loading || !contactId} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="invoice-copy-confirm-btn">
            {busy ? "Kopyalanıyor…" : "Kopyala"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Indigo "Kopyala ▾" dropdown for invoice edit headers.
 * onPickMode(mode) — parent may open contact picker; if omitted, same_contact runs immediately.
 */
export function InvoiceCopyButton({ invoice, onPickMode, onCopied, className = "", disabled }) {
  const [busy, setBusy] = useState(false);
  if (!canCopyInvoice(invoice)) return null;

  const run = async (mode) => {
    const meta = INVOICE_COPY_MODES.find((m) => m.key === mode);
    if (meta?.needsContact) {
      onPickMode?.(mode);
      return;
    }
    setBusy(true);
    try {
      const data = await copyInvoice(invoice, mode);
      toast.success(data.message);
      onCopied?.(data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kopyalanamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || busy}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 ${className}`}
          data-testid="invoice-copy-btn"
          title="Faturayı kopyala"
        >
          <Copy className="w-3.5 h-3.5" />
          Kopyala
          <ChevronDown className="w-3.5 h-3.5 opacity-90" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[90] w-56 rounded-xl p-1 shadow-lg" data-testid="invoice-copy-menu">
        {INVOICE_COPY_MODES.map((m, i) => (
          <React.Fragment key={m.key}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={() => run(m.key)}
              className="text-xs font-medium py-2"
              data-testid={`invoice-copy-${m.key}`}
            >
              {m.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hook-ish helper: manages contact picker state for parents. */
export function useInvoiceCopyFlow({ contacts, companyId, onCopied }) {
  const [pick, setPick] = useState(null); // { invoice, mode }
  const openPick = (invoice, mode) => setPick({ invoice, mode });
  const modal = pick ? (
    <InvoiceCopyContactModal
      mode={pick.mode}
      invoice={pick.invoice}
      contacts={contacts}
      companyId={companyId || pick.invoice?.company_id}
      onClose={() => setPick(null)}
      onDone={(data) => { setPick(null); onCopied?.(data); }}
    />
  ) : null;
  return { openPick, modal, pick };
}

/** For InvoiceContextMenu — call after selecting a copy mode. */
export function useInvoiceCopyFromContext({ contacts, companyId, onCopied }) {
  const flow = useInvoiceCopyFlow({ contacts, companyId, onCopied });
  const handleCopyMode = async (invoice, mode) => {
    const meta = INVOICE_COPY_MODES.find((m) => m.key === mode);
    if (meta?.needsContact) {
      flow.openPick(invoice, mode);
      return;
    }
    try {
      const data = await copyInvoice(invoice, mode);
      toast.success(data.message);
      onCopied?.(data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kopyalanamadı.");
    }
  };
  return { ...flow, handleCopyMode };
}
