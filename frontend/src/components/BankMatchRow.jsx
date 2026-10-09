import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { SearchSelect } from "./SearchSelect";

const fmt = (n) => formatTrAmount((n || 0));
const sel = "bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs";
const MODES_BASE = [
  ["contact", "Cari"],
  ["invoice", "Cari + Fatura"],
  ["transfer", "Kasa / Hesap (Virman)"],
  ["category", "Sadece Kategori"],
];
const MODE_EXPENSE = ["expense", "Masraf"];

export const BankMatchRow = ({ tx, contacts, accounts, invoices, companyId, onDone }) => {
  const isIn = tx.type === "inflow";
  const modes = useMemo(() => (isIn ? MODES_BASE : [...MODES_BASE, MODE_EXPENSE]), [isIn]);
  const [mode, setMode] = useState(tx.suggested_contact_id ? "contact" : "contact");
  const [contactId, setContactId] = useState(tx.suggested_contact_id || "");
  const [invoiceId, setInvoiceId] = useState("");
  const [targetId, setTargetId] = useState(tx.suggested_target_account_id || "");
  const [category, setCategory] = useState("");
  const [expenseCats, setExpenseCats] = useState([]);
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "expense" || !companyId) return;
    axios.get(`${API_URL}/expenses/categories`, { params: { company_id: companyId } })
      .then((r) => setExpenseCats((r.data || []).map((c) => c.name || c).filter(Boolean)))
      .catch(() => setExpenseCats([]));
  }, [mode, companyId]);

  const openInvoices = useMemo(() => (invoices || [])
    .filter((i) => i.contact_id === contactId && i.payment_status !== "paid" && i.status !== "draft" && i.invoice_type === (isIn ? "sales" : "purchase"))
    .sort((a, b) => Math.abs((a.grand_total - a.paid_amount) - tx.amount) - Math.abs((b.grand_total - b.paid_amount) - tx.amount)), [invoices, contactId, isIn, tx.amount]);
  const targets = useMemo(
    () => (accounts || []).filter((a) => (a.id || a._id) !== tx.account_id && !a.is_integrated),
    [accounts, tx.account_id],
  );
  const contactLabel = (c) => (tx.suggested_contact_id === (c.id || c._id) ? `${c.name} ★` : (c.name || "—"));
  const selectedContactName = (() => {
    if (!contactId) return "";
    const hit = (contacts || []).find((c) => (c.id || c._id) === contactId);
    return hit ? contactLabel(hit) : (tx.suggested_contact_name || "");
  })();
  const canSubmit = mode === "category" || mode === "expense"
    ? !!category.trim()
    : mode === "transfer" ? !!targetId
    : mode === "invoice" ? !!invoiceId
    : true;
  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        learn,
        category: category || null,
        contact_id: mode === "contact" || mode === "invoice" || mode === "expense" ? contactId || null : null,
        invoice_id: mode === "invoice" ? invoiceId : null,
        target_account_id: mode === "transfer" ? targetId : null,
        as_expense: mode === "expense",
      };
      await axios.post(`${API_URL}/banking/transactions/${tx.id}/match`, body);
      toast.success(mode === "expense"
        ? (learn ? "Masraf kaydedildi ve kural olarak öğrenildi." : "Masraf kaydedildi.")
        : (learn ? "Eşleştirildi ve kural olarak öğrenildi." : "Eşleştirildi."));
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
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={sel} data-testid={`match-mode-${tx.id}`}>{modes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {(mode === "contact" || mode === "invoice" || mode === "expense") && (
            <SearchSelect
              value={contactId}
              onChange={(id) => { setContactId(id || ""); setInvoiceId(""); }}
              options={contacts || []}
              getLabel={contactLabel}
              getSub={(c) => c.tax_number_or_id || c.phone || ""}
              valueLabel={selectedContactName}
              placeholder={mode === "expense" ? "Cari (ops.)" : mode === "contact" ? "Cari seçin (boş = onayla)" : "Cari ara…"}
              searchPlaceholder="Cari adı ara…"
              clearable={mode === "contact" || mode === "expense"}
              className="w-44"
              testId={`match-contact-select-${tx.id}`}
            />
          )}
          {mode === "invoice" && (
            <SearchSelect
              value={invoiceId}
              onChange={(id) => setInvoiceId(id || "")}
              options={openInvoices}
              getLabel={(i) => `${i.invoice_number} · kalan ${fmt(i.grand_total - (i.paid_amount || 0))} ₺`}
              placeholder={!contactId ? "Önce cari seçin" : (openInvoices.length ? "Açık fatura seçin" : "Açık fatura yok")}
              searchPlaceholder="Fatura no ara…"
              clearable
              className="w-52"
              testId={`match-invoice-select-${tx.id}`}
            />
          )}
          {mode === "transfer" && (
            <PaymentTargetSelect
              companyId={companyId}
              accounts={targets}
              value={targetId}
              onChange={setTargetId}
              testId={`match-target-select-${tx.id}`}
              excludeIntegrated
              includePartners
              collectableOnly={isIn}
              emptyLabel={isIn ? "Para nereden geldi?" : "Para nereye gitti?"}
              className="w-56"
            />
          )}
          {mode === "expense" ? (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`${sel} w-40`}
              data-testid={`match-expense-cat-${tx.id}`}
            >
              <option value="">Masraf kategorisi…</option>
              {expenseCats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={mode === "category" ? "Kategori (zorunlu)" : "Kategori (ops.)"} className={`${sel} w-36`} data-testid={`match-category-${tx.id}`} />
          )}
          <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer" title="Bu açıklama tekrar gelirse aynı işlemi otomatik yap"><input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} data-testid={`match-learn-${tx.id}`} /> Öğren</label>
        </div>
      </td>
      <td className="px-4 py-2"><button onClick={submit} disabled={busy || !canSubmit} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1" data-testid={`match-btn-${tx.id}`}>{busy && <Loader2 className="w-3 h-3 animate-spin" />} Eşleştir</button></td>
    </tr>
  );
};
