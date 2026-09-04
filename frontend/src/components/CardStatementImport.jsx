import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Sparkles, Loader2, X, CreditCard } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CardStatementImport = ({ account, onClose, onDone }) => {
  useEscape(onClose);
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (dry) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await axios.post(`${API_URL}/banking/accounts/${account.id}/import-statement?dry_run=${dry}`, fd);
      setRes(r.data);
      if (dry) toast.success(`AI ekstreyi okudu: ${r.data.transactions.length} hareket.`); else { toast.success(r.data.message); onDone?.(); onClose(); }
    } catch (err) { toast.error(err.response?.data?.detail || "Ekstre işlenemedi."); } finally { setBusy(false); }
  };
  const st = res?.statement;
  const newCount = res?.transactions.filter((t) => !t.duplicate).length || 0;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-3xl p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="card-statement-modal">
        <div className="flex items-center justify-between border-b pb-3"><h3 className="text-base font-bold flex items-center gap-2"><CreditCard className="w-5 h-5 text-fuchsia-600" /> Kredi Kartı Ekstresi Aktar <span className="text-xs font-normal text-slate-500">· {account.account_name}</span></h3><button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button></div>
        <label className="flex items-center gap-3 border-2 border-dashed rounded-xl p-4 cursor-pointer text-xs hover:bg-violet-50/40" data-testid="card-stmt-dropzone">
          <Sparkles className="w-6 h-6 text-violet-600" /><div><b>{file ? file.name : "Banka ekstre PDF'ini seçin"}</b><div className="text-slate-400">AI (Claude Sonnet 4.6) harcamaları, taksitleri, kategori ve toplam borcu çıkarır; mükerrer satırlar atlanır.</div></div>
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { setFile(e.target.files?.[0]); setRes(null); }} data-testid="card-stmt-file" />
        </label>
        {!res && <div className="flex justify-end"><button onClick={() => run(true)} disabled={!file || busy} className="px-4 py-2 bg-violet-600 text-white rounded-lg text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5" data-testid="card-stmt-analyze">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI ile Analiz Et</button></div>}
        {res && (<>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">{[["Banka", st.bank], ["Kart", st.card_last4 ? `**** ${st.card_last4}` : "-"], ["Son Ödeme", st.due_date], ["Toplam Borç", st.total_debt != null ? `${fmt(st.total_debt)} ₺` : "-"], ["Asgari", st.minimum_payment != null ? `${fmt(st.minimum_payment)} ₺` : "-"]].map(([l, v]) => <div key={l} className="bg-slate-50 rounded-lg p-2"><div className="text-[10px] text-slate-400">{l}</div><b>{v || "-"}</b></div>)}</div>
          <div className="max-h-64 overflow-auto border rounded-xl"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase text-[10px]"><tr><th className="p-2 text-left">Tarih</th><th className="text-left">Açıklama</th><th className="text-left">Kategori</th><th className="text-right pr-2">Tutar</th></tr></thead><tbody className="divide-y">{res.transactions.map((t, i) => <tr key={i} className={t.duplicate ? "opacity-40" : ""} data-testid={`card-stmt-row-${i}`}><td className="p-2">{t.date}</td><td>{t.description}{t.installment && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded">{t.installment}</span>}{t.duplicate && <span className="ml-1 text-[9px] text-slate-400">(zaten var)</span>}</td><td>{t.category}</td><td className={`text-right pr-2 font-bold ${t.amount < 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(t.amount)}</td></tr>)}</tbody></table></div>
          <div className="flex justify-between items-center pt-2 border-t text-xs"><span className="text-slate-500">{newCount} yeni hareket aktarılacak{st.total_debt != null ? `, kart borcu ${fmt(st.total_debt)} ₺ olarak güncellenecek` : ""}.</span><button onClick={() => run(false)} disabled={busy || !newCount} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-40" data-testid="card-stmt-import">{busy ? "Aktarılıyor…" : "Hareketleri Aktar"}</button></div>
        </>)}
      </div>
    </div>
  );
};
