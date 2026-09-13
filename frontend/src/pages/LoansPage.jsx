
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Landmark, Plus, Sparkles, Upload, Loader2, Trash2, CheckCircle2, X, ChevronDown, ChevronUp } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "../components/PaymentTargetSelect";
import { useEscape } from "../utils/useEscape";
import { ExportButtons } from "../components/ExportButtons";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-emerald-500 outline-none";
const TYPES = { ticari: "Ticari Kredi", tasit: "Taşıt Kredisi", konut: "Konut / İşyeri", ihtiyac: "İhtiyaç Kredisi", kmh: "KMH / Rotatif", diger: "Diğer" };
const Stat = ({ label, value, cls = "", testid }) => <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4"><div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div><div className={`text-lg font-bold ${cls}`} data-testid={testid}>{value}</div></div>;

const LoanModal = ({ companyId, accounts, onClose, onSaved }) => {
  useEscape(onClose);
  const { addonOn } = useAuth();
  const [d, setD] = useState({ name: "", bank: "", loan_type: "ticari", principal: "", interest_rate: "", term_months: 12, start_date: new Date().toISOString().slice(0, 10), monthly_payment: "", installments: [], account_id: "", credit_to_account: false });
  const [busy, setBusy] = useState(null);
  const upload = async (file) => {
    if (!file) return; setBusy("ai");
    try { const fd = new FormData(); fd.append("file", file); const r = await axios.post(`${API_URL}/loans/extract`, fd); const x = r.data.draft; setD((s) => ({ ...s, ...x, name: `${x.bank || "Banka"} ${TYPES[x.loan_type] || "Kredisi"}`, principal: x.principal || "", interest_rate: x.interest_rate ?? "", monthly_payment: x.monthly_payment || "" })); toast.success(`AI ödeme planını okudu: ${x.installments.length} taksit (güven %${Math.round((x.confidence || 0) * 100)})`); }
    catch (err) { toast.error(err.response?.data?.detail || "PDF işlenemedi."); } finally { setBusy(null); }
  };
  const genPlan = () => { const n = Number(d.term_months) || 0, p = Number(d.principal) || 0, r = (Number(d.interest_rate) || 0) / 100; if (!n || !p) return toast.error("Anapara ve vade girin."); const pay = r ? p * r / (1 - Math.pow(1 + r, -n)) : p / n; let rem = p; const start = new Date(d.start_date); const ins = Array.from({ length: n }, (_, i) => { const interest = rem * r; const principal = pay - interest; rem -= principal; const due = new Date(start.getFullYear(), start.getMonth() + i + 1, Math.min(start.getDate(), 28)); return { no: i + 1, due_date: due.toISOString().slice(0, 10), principal: +principal.toFixed(2), interest: +interest.toFixed(2), kkdf_bsmv: 0, amount: +pay.toFixed(2), remaining_principal: +Math.max(0, rem).toFixed(2), paid: false }; }); setD({ ...d, installments: ins, monthly_payment: +pay.toFixed(2) }); };
  const save = async (e) => { e.preventDefault(); setBusy("save"); try { const { account_id: _a, ...rest } = d; await axios.post(`${API_URL}/loans`, { ...rest, company_id: companyId, principal: Number(d.principal), term_months: Number(d.term_months), ...splitPaymentTarget(d.account_id) }); toast.success("Kredi kaydedildi."); onSaved(); onClose(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(null); } };
  const total = d.installments.reduce((t, i) => t + (Number(i.amount) || 0), 0);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-4xl p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="loan-modal">
        <div className="flex items-center justify-between border-b pb-3"><h3 className="text-base font-bold flex items-center gap-2"><Landmark className="w-5 h-5 text-indigo-600" /> Yeni Kredi</h3><button type="button" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button></div>
        {addonOn("ai.finance_docs") && (
        <label className={`flex items-center gap-3 border-2 border-dashed rounded-xl p-4 cursor-pointer text-xs ${busy === "ai" ? "opacity-60" : "hover:bg-violet-50/40 hover:border-violet-400"}`} data-testid="loan-ai-dropzone">
          {busy === "ai" ? <Loader2 className="w-6 h-6 animate-spin text-violet-600" /> : <Sparkles className="w-6 h-6 text-violet-600" />}<div><b>Bankanın ödeme planı PDF'ini yükleyin</b> — AI (Claude Sonnet 4.6) taksitleri, faizi ve KKDF/BSMV'yi otomatik çıkarır.<div className="text-slate-400">veya aşağıdan elle girip "Plan Oluştur" ile eşit taksit hesaplayın</div></div>
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="loan-ai-file" /><Upload className="w-4 h-4 text-slate-400 ml-auto" />
        </label>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="col-span-2"><label className="block font-semibold mb-1">Kredi Adı</label><input required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} className={inputCls} data-testid="loan-name" /></div>
          <div><label className="block font-semibold mb-1">Banka</label><input value={d.bank || ""} onChange={(e) => setD({ ...d, bank: e.target.value })} className={inputCls} /></div>
          <div><label className="block font-semibold mb-1">Tür</label><select value={d.loan_type} onChange={(e) => setD({ ...d, loan_type: e.target.value })} className={inputCls}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="block font-semibold mb-1">Anapara (₺)</label><input type="number" step="0.01" required value={d.principal} onChange={(e) => setD({ ...d, principal: e.target.value })} className={`${inputCls} font-bold`} data-testid="loan-principal" /></div>
          <div><label className="block font-semibold mb-1">Aylık Faiz %</label><input type="number" step="0.01" value={d.interest_rate ?? ""} onChange={(e) => setD({ ...d, interest_rate: e.target.value })} className={inputCls} /></div>
          <div><label className="block font-semibold mb-1">Vade (ay)</label><input type="number" min="1" value={d.term_months} onChange={(e) => setD({ ...d, term_months: e.target.value })} className={inputCls} /></div>
          <div><label className="block font-semibold mb-1">Kullandırım Tarihi</label><input type="date" value={d.start_date || ""} onChange={(e) => setD({ ...d, start_date: e.target.value })} className={inputCls} /></div>
          <div className="col-span-2"><label className="block font-semibold mb-1">Taksitlerin ödeneceği hesap</label><PaymentTargetSelect companyId={companyId} accounts={accounts} value={d.account_id} onChange={(v) => setD({ ...d, account_id: v })} testId="loan-account" emptyLabel="Seçilmedi" /></div>
          <label className="col-span-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2 cursor-pointer"><input type="checkbox" checked={d.credit_to_account} onChange={(e) => setD({ ...d, credit_to_account: e.target.checked })} /> Anaparayı bu hesaba giriş olarak işle (kredi kullanıldı)</label>
        </div>
        <div className="flex items-center justify-between"><div className="text-xs font-bold">Ödeme Planı {d.installments.length > 0 && <span className="text-slate-500 font-normal">· {d.installments.length} taksit · toplam {fmt(total)} ₺</span>}</div><button type="button" onClick={genPlan} className="px-3 py-1.5 border rounded-lg text-xs font-semibold" data-testid="loan-gen-plan">Plan Oluştur (eşit taksit)</button></div>
        {d.installments.length > 0 && <div className="max-h-56 overflow-auto border rounded-xl"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase text-[10px]"><tr><th className="p-2 text-left">No</th><th className="text-left">Vade</th><th className="text-right">Anapara</th><th className="text-right">Faiz</th><th className="text-right">KKDF/BSMV</th><th className="text-right pr-2">Taksit</th></tr></thead><tbody className="divide-y">{d.installments.map((i, k) => <tr key={k} data-testid={`loan-plan-row-${i.no}`}><td className="p-2">{i.no}</td><td><input type="date" value={i.due_date || ""} onChange={(e) => setD({ ...d, installments: d.installments.map((x, j) => j === k ? { ...x, due_date: e.target.value } : x) })} className="border rounded p-0.5" /></td><td className="text-right">{fmt(i.principal)}</td><td className="text-right">{fmt(i.interest)}</td><td className="text-right">{fmt(i.kkdf_bsmv)}</td><td className="text-right pr-2"><input type="number" step="0.01" value={i.amount} onChange={(e) => setD({ ...d, installments: d.installments.map((x, j) => j === k ? { ...x, amount: e.target.value } : x) })} className="border rounded p-0.5 w-24 text-right font-bold" /></td></tr>)}</tbody></table></div>}
        <div className="flex justify-end gap-2 pt-3 border-t"><button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">İptal</button><button type="submit" disabled={busy || !d.installments.length} className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold disabled:opacity-40" data-testid="loan-save">Krediyi Kaydet</button></div>
      </form>
    </div>
  );
};

export default function LoansPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [data, setData] = useState({ loans: [], summary: null });
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(false);
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => { const [l, a] = await Promise.all([axios.get(`${API_URL}/loans?company_id=${companyId}`), axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`)]); setData(l.data); setAccounts(a.data); }, [companyId]);
  useEffect(() => { load().catch(() => toast.error("Krediler yüklenemedi.")); }, [load]);
  const refreshSilent = useCallback(() => load(), [load]);
  useDataRefresh(refreshSilent, { companyId, scopes: ["cash", "expenses"] });
  const pay = async (loan, ins) => { const acc = loan.partner_id ? `partner:${loan.partner_id}` : (loan.account_id || accounts[0]?.id); if (!acc) return toast.error("Kredi için ödeme hesabı tanımlı değil."); if (!window.confirm(`${ins.no}. taksit (${fmt(ins.amount)} ₺) ödensin mi?`)) return; try { await axios.post(`${API_URL}/loans/${loan.id}/installments/${ins.no}/pay`, { ...splitPaymentTarget(acc) }); toast.success("Taksit ödendi; faiz gideri Masraflar'a işlendi."); await notifyDataChanged({ companyId, scopes: ["cash", "expenses"] }); load(); } catch (err) { toast.error(err.response?.data?.detail || "Ödenemedi."); } };
  const del = async (l) => { if (!window.confirm(`${l.name} silinsin mi?`)) return; await axios.delete(`${API_URL}/loans/${l.id}`); toast.success("Kredi silindi."); load(); };
  const s = data.summary;
  const today = new Date().toISOString().slice(0, 10);
  const COLS = [{ key: "name", label: "Kredi" }, { key: "bank", label: "Banka" }, { key: "principal", label: "Anapara", num: true }, { key: "term_months", label: "Vade" }, { key: "paid_count", label: "Ödenen" }, { key: "remaining_debt", label: "Kalan Borç", num: true }, { label: "Sonraki Vade", value: (r) => r.next_installment?.due_date || "-" }];
  return (
    <div className="space-y-6" data-testid="loans-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Krediler</h1><p className="text-xs sm:text-sm text-slate-500">Banka kredileri, ödeme planı takibi, taksit ödemeleri ve finansman gideri</p></div>
        <div className="flex gap-2 self-start"><ExportButtons rows={data.loans} columns={COLS} filename="krediler" title="Kredi Listesi" size="md" /><button onClick={() => setModal(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md" data-testid="loan-new-btn"><Plus className="w-4 h-4" /> Yeni Kredi</button></div></div>
      {s && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Stat label="Aktif Kredi" value={s.count} testid="loan-stat-count" /><Stat label="Toplam Kalan Borç" value={`${fmt(s.total_debt)} ₺`} cls="text-rose-600" testid="loan-stat-debt" /><Stat label="Bu Ay Ödenecek" value={`${fmt(s.due_this_month)} ₺`} cls="text-amber-600" /><Stat label="Gecikmiş Taksit" value={s.overdue} cls={s.overdue ? "text-rose-600" : ""} /></div>}
      <div className="space-y-3">
        {data.loans.length === 0 && <div className="bg-white rounded-2xl border p-10 text-center text-sm text-slate-400" data-testid="loans-empty">Kayıtlı kredi yok. "Yeni Kredi" ile bankanın ödeme planı PDF'ini yükleyin.</div>}
        {data.loans.map((l) => (
          <div key={l.id} className="bg-white rounded-2xl border border-slate-200/90 shadow-sm" data-testid={`loan-card-${l.id}`}>
            <div className="p-4 flex flex-wrap items-center gap-4 cursor-pointer" onClick={() => setOpen(open === l.id ? null : l.id)}>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center"><Landmark className="w-5 h-5" /></div>
              <div className="min-w-[200px]"><div className="font-bold text-slate-900 text-sm">{l.name}</div><div className="text-xs text-slate-500">{l.bank} · {TYPES[l.loan_type]} · {l.term_months} ay{l.interest_rate ? ` · %${l.interest_rate}` : ""}</div></div>
              <div className="text-xs"><div className="text-slate-400">Anapara</div><b>{fmt(l.principal)} ₺</b></div>
              <div className="text-xs"><div className="text-slate-400">Kalan Borç</div><b className="text-rose-600">{fmt(l.remaining_debt)} ₺</b></div>
              <div className="text-xs"><div className="text-slate-400">Sonraki Taksit</div><b className={l.next_installment && l.next_installment.due_date < today ? "text-rose-600" : ""}>{l.next_installment ? `${l.next_installment.due_date} · ${fmt(l.next_installment.amount)} ₺` : "Tamamlandı"}</b></div>
              <div className="flex-1 min-w-[120px]"><div className="flex justify-between text-[10px] text-slate-500"><span>{l.paid_count}/{l.installments.length} taksit</span><span>%{Math.round(l.paid_count / l.installments.length * 100)}</span></div><div className="h-2 bg-slate-100 rounded-full"><div className="h-2 bg-indigo-500 rounded-full" style={{ width: `${l.paid_count / l.installments.length * 100}%` }} /></div></div>
              <button onClick={(e) => { e.stopPropagation(); del(l); }} className="p-1.5 text-slate-400 hover:text-rose-600" data-testid={`loan-del-${l.id}`}><Trash2 className="w-4 h-4" /></button>{open === l.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
            {open === l.id && <div className="border-t px-4 pb-4 overflow-x-auto"><table className="w-full text-xs mt-3"><thead className="text-slate-500 uppercase text-[10px]"><tr><th className="text-left py-1">No</th><th className="text-left">Vade</th><th className="text-right">Anapara</th><th className="text-right">Faiz</th><th className="text-right">KKDF/BSMV</th><th className="text-right">Taksit</th><th className="text-right">Kalan</th><th className="text-right">Durum</th></tr></thead><tbody className="divide-y">{l.installments.map((i) => <tr key={i.no} className={i.paid ? "text-slate-400" : i.due_date < today ? "bg-rose-50/50" : ""} data-testid={`loan-inst-${l.id}-${i.no}`}><td className="py-1.5">{i.no}</td><td>{i.due_date}</td><td className="text-right">{fmt(i.principal)}</td><td className="text-right">{fmt(i.interest)}</td><td className="text-right">{fmt(i.kkdf_bsmv)}</td><td className="text-right font-bold">{fmt(i.amount)} ₺</td><td className="text-right">{i.remaining_principal != null ? fmt(i.remaining_principal) : "-"}</td><td className="text-right">{i.paid ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3 h-3" /> {i.paid_date}</span> : <button onClick={() => pay(l, i)} className="px-2 py-0.5 bg-indigo-600 text-white rounded-md font-semibold" data-testid={`loan-pay-${l.id}-${i.no}`}>Öde</button>}</td></tr>)}</tbody></table></div>}
          </div>
        ))}
      </div>
      {modal && <LoanModal companyId={companyId} accounts={accounts} onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}
