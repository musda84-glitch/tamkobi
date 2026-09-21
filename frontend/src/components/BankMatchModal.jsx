import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Link2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";
import { PaymentTargetSelect } from "./PaymentTargetSelect";

const fmt = (n) => formatTrAmount(n || 0);
const sel = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";
const MODES = [
  ["contact", "Cari"],
  ["invoice", "Cari + Fatura"],
  ["transfer", "Kasa / Hesap (Virman)"],
  ["category", "Sadece Kategori"],
];

/** Banka hareketi eşleştirme / düzeltme modalı — hareketler listesi ve entegrasyon paneli ortak. */
export function BankMatchModal({ tx, contacts = [], accounts = [], companyId, onClose, onDone }) {
  const txId = tx?.id || tx?._id;
  const isIn = tx?.type === "inflow";
  const [mode, setMode] = useState("contact");
  const [contactId, setContactId] = useState(tx?.suggested_contact_id || tx?.contact_id || "");
  const [invoiceId, setInvoiceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [category, setCategory] = useState(tx?.category || "");
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    if (!companyId) return;
    axios.get(`${API_URL}/invoices?company_id=${companyId}&type=all`).then((r) => setInvoices(r.data || [])).catch(() => setInvoices([]));
  }, [companyId]);

  const openInvoices = useMemo(() => invoices
    .filter((i) => i.contact_id === contactId && i.payment_status !== "paid" && i.status !== "draft" && i.invoice_type === (isIn ? "sales" : "purchase"))
    .sort((a, b) => Math.abs((a.grand_total - a.paid_amount) - (tx?.amount || 0)) - Math.abs((b.grand_total - b.paid_amount) - (tx?.amount || 0))),
  [invoices, contactId, isIn, tx?.amount]);

  const targets = accounts.filter((a) => (a.id || a._id) !== tx?.account_id && !a.is_integrated);
  const canSubmit = mode === "category" ? !!category.trim() : mode === "transfer" ? !!targetId : mode === "invoice" ? !!invoiceId : true;

  const submit = async (e) => {
    e.preventDefault();
    if (!txId || !canSubmit) return;
    setBusy(true);
    try {
      const body = {
        learn,
        category: category || null,
        contact_id: mode === "contact" || mode === "invoice" ? contactId || null : null,
        invoice_id: mode === "invoice" ? invoiceId : null,
        target_account_id: mode === "transfer" ? targetId : null,
      };
      await axios.post(`${API_URL}/banking/transactions/${txId}/match`, body);
      toast.success(learn ? "Eşleştirildi ve kural olarak öğrenildi." : "Eşleştirildi.");
      onDone?.();
      onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Eşleştirilemedi.");
    } finally {
      setBusy(false);
    }
  };

  if (!tx) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose} data-testid={`tx-match-modal-${txId}`}>
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b pb-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-violet-600 shrink-0" /> Eşleşme
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={tx.description}>
              {tx.date} · {isIn ? "+" : "-"}{fmt(tx.amount)} ₺ · {tx.description}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="tx-match-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block font-semibold mb-1">Eşleşme türü</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={sel} data-testid={`tx-match-mode-${txId}`}>
            {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>

        {(mode === "contact" || mode === "invoice") && (
          <div>
            <label className="block font-semibold mb-1">Cari</label>
            <select
              value={contactId}
              onChange={(e) => { setContactId(e.target.value); setInvoiceId(""); }}
              className={sel}
              data-testid={`tx-match-contact-${txId}`}
            >
              <option value="">{mode === "contact" ? "Cari seçin (boş = sadece onayla)" : "Cari seçin"}</option>
              {contacts.map((c) => {
                const id = c.id || c._id;
                return <option key={id} value={id}>{c.name}</option>;
              })}
            </select>
          </div>
        )}

        {mode === "invoice" && (
          <div>
            <label className="block font-semibold mb-1">Açık fatura</label>
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className={sel} disabled={!contactId} data-testid={`tx-match-invoice-${txId}`}>
              <option value="">{contactId ? (openInvoices.length ? "Açık fatura seçin" : "Açık fatura yok") : "Önce cari seçin"}</option>
              {openInvoices.map((i) => (
                <option key={i.id || i._id} value={i.id || i._id}>
                  {`${i.invoice_number} · kalan ${fmt(i.grand_total - (i.paid_amount || 0))} ₺`}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === "transfer" && (
          <div>
            <label className="block font-semibold mb-1">{isIn ? "Para nereden geldi?" : "Para nereye gitti?"}</label>
            <PaymentTargetSelect
              companyId={companyId}
              accounts={targets}
              value={targetId}
              onChange={setTargetId}
              testId={`tx-match-target-${txId}`}
              excludeIntegrated
              includePartners
              collectableOnly={isIn}
              emptyLabel="Hesap / ortak seçin"
            />
          </div>
        )}

        <div>
          <label className="block font-semibold mb-1">Kategori {mode === "category" ? "(zorunlu)" : "(ops.)"}</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} className={sel} data-testid={`tx-match-category-${txId}`} />
        </div>

        <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
          <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} data-testid={`tx-match-learn-${txId}`} />
          Bu açıklama tekrar gelirse otomatik eşleştir (öğren)
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="px-4 py-1.5 bg-violet-600 text-white rounded-lg font-semibold disabled:opacity-40 flex items-center gap-1.5"
            data-testid={`tx-match-save-${txId}`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Eşleştir
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
