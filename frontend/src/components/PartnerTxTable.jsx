
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import React, { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, ArrowUpDown, Pencil, Trash2, X, Check } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";

const TX_LABEL = { capital_in: "Sermaye Girişi", withdrawal: "Para Çekişi", profit_share: "Kâr Payı" };
const fmt = (n) => formatTrAmount((n || 0));
const COLS = [["date", "Tarih"], ["partner_name", "Ortak"], ["type", "İşlem"], ["account_name", "Hesap / Açıklama"], ["amount", "Tutar", "text-right"]];
const inputCls = "bg-white border border-slate-200 rounded-md p-1 text-xs";

export const PartnerTxTable = ({ txs, accounts, companyId, onChanged }) => {
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "amount" || key === "date" ? "desc" : "asc" }));
  const rows = useMemo(() => [...txs].sort((a, b) => {
    const x = sort.key === "amount" ? Number(a.amount) : sort.key === "type" ? TX_LABEL[a.type] : (a[sort.key] || "");
    const y = sort.key === "amount" ? Number(b.amount) : sort.key === "type" ? TX_LABEL[b.type] : (b[sort.key] || "");
    const r = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "tr") || (a.created_at || "").localeCompare(b.created_at || "");
    return sort.dir === "asc" ? r : -r;
  }), [txs, sort]);
  const save = async () => {
    setBusy(true);
    try { await axios.put(`${API_URL}/banking/partners/transactions/${edit.id}`, { amount: Number(edit.amount), date: edit.date, description: edit.description, account_id: edit.account_id }); toast.success("Hareket güncellendi; bakiyeler yeniden hesaplandı."); setEdit(null); onChanged?.(); }
    catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); } finally { setBusy(false); }
  };
  const del = async (t) => {
    if (!window.confirm(`${TX_LABEL[t.type]} (${fmt(t.amount)} ₺) silinsin mi? Ortak ve hesap bakiyeleri geri alınır.`)) return;
    try { const r = await axios.delete(`${API_URL}/banking/partners/transactions/${t.id}`); toast.success(r.data.message); onChanged?.(); }
    catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };
  return (
    <table className="w-full text-left text-xs text-slate-600" data-testid="partner-tx-table">
      <thead className="bg-slate-50 border-b text-slate-500 uppercase font-semibold select-none">
        <tr>
          {COLS.map(([k, l, cls]) => (
            <th key={k} className={`px-4 py-2 ${cls || ""}`}><button onClick={() => toggle(k)} className={`inline-flex items-center gap-1 hover:text-slate-900 group ${sort.key === k ? "text-indigo-700" : ""}`} data-testid={`partner-tx-sort-${k}`}>{l}{sort.key === k ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100" />}</button></th>
          ))}
          <th className="px-4 py-2 text-right w-[90px]">İşlemler</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-5 text-center text-slate-400">Hareket yok.</td></tr>}
        {rows.map((t) => edit?.id === t.id ? (
          <tr key={t.id} className="bg-indigo-50/40" data-testid={`partner-tx-edit-row-${t.id}`}>
            <td className="px-4 py-2"><input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} className={inputCls} data-testid="partner-tx-edit-date" /></td>
            <td className="px-4 py-2 font-semibold text-slate-900">{t.partner_name}</td>
            <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-md font-semibold bg-slate-100">{TX_LABEL[t.type]}</span></td>
            <td className="px-4 py-2 flex gap-1"><PaymentTargetSelect companyId={companyId} accounts={accounts} value={edit.account_id || ""} onChange={(v) => setEdit({ ...edit, account_id: v })} testId="partner-tx-edit-account" includePartners={false} className={inputCls} /><input value={edit.description || ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className={`${inputCls} flex-1`} placeholder="Açıklama" data-testid="partner-tx-edit-desc" /></td>
            <td className="px-4 py-2 text-right"><input type="number" step="0.01" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} className={`${inputCls} w-28 text-right font-bold`} data-testid="partner-tx-edit-amount" /></td>
            <td className="px-4 py-2 text-right whitespace-nowrap"><button onClick={save} disabled={busy} className="p-1.5 rounded-md bg-emerald-600 text-white mr-1" title="Kaydet" data-testid="partner-tx-edit-save"><Check className="w-3.5 h-3.5" /></button><button onClick={() => setEdit(null)} className="p-1.5 rounded-md border" title="İptal" data-testid="partner-tx-edit-cancel"><X className="w-3.5 h-3.5" /></button></td>
          </tr>
        ) : (
          <tr key={t.id} className="hover:bg-slate-50/70 group" data-testid={`partner-tx-row-${t.id}`}>
            <td className="px-4 py-2 font-mono text-slate-500">{t.date}</td>
            <td className="px-4 py-2 font-semibold text-slate-900">{t.partner_name}</td>
            <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-md font-semibold ${t.type === "capital_in" ? "bg-emerald-50 text-emerald-700" : t.type === "withdrawal" ? "bg-rose-50 text-rose-700" : "bg-indigo-50 text-indigo-700"}`}>{TX_LABEL[t.type]}{t.type === "profit_share" && !t.is_paid ? " (Tahakkuk)" : ""}</span></td>
            <td className="px-4 py-2 text-slate-600">{t.account_name ? <span className="font-semibold text-slate-700">{t.account_name} • </span> : ""}{t.description}</td>
            <td className={`px-4 py-2 text-right font-bold ${t.type === "capital_in" ? "text-emerald-600" : "text-rose-600"}`}>{t.type === "capital_in" ? "+" : "-"}{fmt(t.amount)} ₺</td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              {t.type !== "profit_share" && <button onClick={() => setEdit({ id: t.id, date: t.date, amount: t.amount, description: t.description, account_id: t.account_id })} className="p-1.5 rounded-md text-slate-500 hover:text-indigo-600 hover:bg-indigo-50" title="Düzenle" data-testid={`partner-tx-edit-${t.id}`}><Pencil className="w-3.5 h-3.5" /></button>}
              <button onClick={() => del(t)} className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50" title="Sil (bakiyeler geri alınır)" data-testid={`partner-tx-del-${t.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
