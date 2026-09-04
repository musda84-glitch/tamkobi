import React, { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const sel = "bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs";
const MODES = [["contact", "Cari"], ["invoice", "Cari + Fatura"], ["transfer", "Kasa / Hesap (Virman)"], ["category", "Sadece Kategori"]];

export const BankMatchRow = ({ tx, contacts, accounts, invoices, onDone }) => {
  const [mode, setMode] = useState(tx.suggested_contact_id ? "contact" : "contact");
  const [contactId, setContactId] = useState(tx.suggested_contact_id || "");
  const [invoiceId, setInvoiceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [category, setCategory] = useState("");
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const isIn = tx.type === "inflow";
  const openInvoices = useMemo(() => invoices
    .filter((i) => i.contact_id === contactId && i.payment_status !== "paid" && i.status !== "draft" && i.invoice_type === (isIn ? "sales" : "purchase"))
    .sort((a, b) => Math.abs((a.grand_total - a.paid_amount) - tx.amount) - Math.abs((b.grand_total - b.paid_amount) - tx.amount)), [invoices, contactId, isIn, tx.amount]);
  const targets = accounts.filter((a) => a.id !== tx.account_id && !a.is_integrated);
  const canSubmit = mode === "category" ? !!category.trim() : mode === "transfer" ? !!targetId : mode === "invoice" ? !!invoiceId : true;
  const submit = async () => {
    setBusy(true);
    try {
      const body = { learn, category: category || null, contact_id: mode === "contact" || mode === "invoice" ? contactId || null : null, invoice_id: mode === "invoice" ? invoiceId : null, target_account_id: mode === "transfer" ? targetId : null };
      await axios.post(`${API_URL}/banking/transactions/${tx.id}/match`, body);
      toast.success(learn ? "Eşleştirildi ve kural olarak öğrenildi." : "Eşleştirildi.");
      onDone?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Eşleştirilemedi."); } finally { setBusy(false); }
  };
  return (
    <tr data-testid={`unmatched-tx-${tx.id}`} className="align-top">
      <td className="px-4 py-2 font-mono text-slate-500 whitespace-nowrap">{tx.date}</td>
      <td className="px-4 py-2 font-semibold text-slate-900">{tx.account_name}</td>
      <td className="px-4 py-2 max-w-[260px]">{tx.description} {tx.is_simulated && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold">SİMÜLE</span>}
        {tx.suggested_contact_name && <div className="text-[10px] text-violet-700 flex items-center gap-1 mt-0.5"><Sparkles className="w-3 h-3" /> Öneri: {tx.suggested_contact_name}</div>}</td>
      <td className={`px-4 py-2 text-right font-bold whitespace-nowrap ${isIn ? "text-emerald-600" : "text-rose-600"}`}>{isIn ? "+" : "-"}{fmt(tx.amount)} ₺</td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={sel} data-testid={`match-mode-${tx.id}`}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {(mode === "contact" || mode === "invoice") && (
            <select value={contactId} onChange={(e) => { setContactId(e.target.value); setInvoiceId(""); }} className={`${sel} w-44`} data-testid={`match-contact-select-${tx.id}`}>
              <option value="">{mode === "contact" ? "Cari seçin (boş = sadece onayla)" : "Cari seçin"}</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{tx.suggested_contact_id === c.id ? `${c.name} ★` : c.name}</option>)}
            </select>
          )}
          {mode === "invoice" && (
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className={`${sel} w-52`} disabled={!contactId} data-testid={`match-invoice-select-${tx.id}`}>
              <option value="">{contactId ? (openInvoices.length ? "Açık fatura seçin" : "Açık fatura yok") : "Önce cari seçin"}</option>
              {openInvoices.map((i) => <option key={i.id} value={i.id}>{`${i.invoice_number} · kalan ${fmt(i.grand_total - (i.paid_amount || 0))} ₺`}</option>)}
            </select>
          )}
          {mode === "transfer" && (
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={`${sel} w-48`} data-testid={`match-target-select-${tx.id}`}>
              <option value="">{isIn ? "Para nereden geldi?" : "Para nereye gitti?"}</option>
              {targets.map((a) => <option key={a.id} value={a.id}>{`${a.bank_name} — ${a.account_name}`}</option>)}
            </select>
          )}
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={mode === "category" ? "Kategori (zorunlu)" : "Kategori (ops.)"} className={`${sel} w-36`} data-testid={`match-category-${tx.id}`} />
          <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer" title="Bu açıklama tekrar gelirse aynı işlemi otomatik yap"><input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} data-testid={`match-learn-${tx.id}`} /> Öğren</label>
        </div>
      </td>
      <td className="px-4 py-2"><button onClick={submit} disabled={busy || !canSubmit} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1" data-testid={`match-btn-${tx.id}`}>{busy && <Loader2 className="w-3 h-3 animate-spin" />} Eşleştir</button></td>
    </tr>
  );
};
