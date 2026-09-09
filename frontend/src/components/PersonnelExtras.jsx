
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CalendarDays, Plus, Check, X, Calculator, Gift, Trash2, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const LEAVE_TYPES = { annual: "Yıllık İzin", sick: "Hastalık", unpaid: "Ücretsiz", other: "Diğer" };

export const LeaveRequestsPanel = ({ companyId, employees, onChanged }) => {
  const [leaves, setLeaves] = useState([]);
  const [form, setForm] = useState({ employee_id: "", type: "annual", start_date: "", end_date: "", reason: "" });
  const [show, setShow] = useState(false);
  const load = useCallback(async () => { const r = await axios.get(`${API_URL}/personnel/leaves?company_id=${companyId}`); setLeaves(r.data); }, [companyId]);
  useEffect(() => { load(); }, [load]);
  const save = async (e) => { e.preventDefault(); try { await axios.post(`${API_URL}/personnel/leaves`, { ...form, employee_id: form.employee_id || employees[0]?.id }); toast.success("İzin talebi oluşturuldu."); setShow(false); load(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } };
  const decide = async (id, status) => { try { await axios.post(`${API_URL}/personnel/leaves/${id}/decide`, { status }); toast.success(status === "approved" ? "İzin onaylandı." : "İzin reddedildi."); load(); onChanged?.(); } catch (err) { toast.error(err.response?.data?.detail || "İşlem başarısız."); } };
  return (
    <div className="space-y-4" data-testid="leave-requests-panel">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-indigo-600" /> İzin Talepleri</h3><button onClick={() => setShow(true)} className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold" data-testid="new-leave-btn"><Plus className="w-4 h-4" /> İzin Talebi</button></div>
      {show && (
        <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs items-end" data-testid="leave-form">
          <div><label className="block font-semibold mb-1">Çalışan</label><select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className={inputCls} data-testid="leave-employee-select">{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name} (kalan {e.annual_leave_days - e.used_leave_days} g)</option>)}</select></div>
          <div><label className="block font-semibold mb-1">Tür</label><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>{Object.entries(LEAVE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="block font-semibold mb-1">Başlangıç</label><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} required data-testid="leave-start-input" /></div>
          <div><label className="block font-semibold mb-1">Bitiş</label><input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={inputCls} required data-testid="leave-end-input" /></div>
          <div className="flex gap-2"><button type="button" onClick={() => setShow(false)} className="px-3 py-2 border rounded-lg">İptal</button><button type="submit" className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg font-semibold" data-testid="save-leave-btn">Kaydet</button></div>
          <div className="sm:col-span-5"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Açıklama (opsiyonel)" className={inputCls} /></div>
        </form>
      )}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs"><thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold"><tr><th className="px-4 py-2">Çalışan</th><th className="px-4 py-2">Tür</th><th className="px-4 py-2">Tarih</th><th className="px-4 py-2 text-right">Gün</th><th className="px-4 py-2">Durum</th><th className="px-4 py-2"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {leaves.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">İzin talebi yok.</td></tr>}
            {leaves.map((l) => (
              <tr key={l.id} data-testid={`leave-row-${l.id}`}>
                <td className="px-4 py-2 font-semibold text-slate-900">{l.employee_name}</td><td className="px-4 py-2">{LEAVE_TYPES[l.type]}</td><td className="px-4 py-2 font-mono text-slate-500">{l.start_date} → {l.end_date}</td><td className="px-4 py-2 text-right font-bold">{l.days}</td>
                <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${l.status === "approved" ? "bg-emerald-50 text-emerald-700" : l.status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{l.status === "approved" ? "Onaylandı" : l.status === "rejected" ? "Reddedildi" : "Bekliyor"}</span></td>
                <td className="px-4 py-2 text-right">{l.status === "pending" && <div className="flex justify-end gap-1"><button onClick={() => decide(l.id, "approved")} className="p-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100" data-testid={`approve-leave-${l.id}`}><Check className="w-3.5 h-3.5" /></button><button onClick={() => decide(l.id, "rejected")} className="p-1.5 bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100" data-testid={`reject-leave-${l.id}`}><X className="w-3.5 h-3.5" /></button></div>}</td>
              </tr>
            ))}
          </tbody></table>
      </div>
    </div>
  );
};

export const SalaryCalculator = () => {
  const [mode, setMode] = useState("gross");
  const [amount, setAmount] = useState("50000");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const calc = async (e) => { e.preventDefault(); setBusy(true); try { const r = await axios.post(`${API_URL}/personnel/salary-calc`, { mode, amount: Number(amount) }); setResult(r.data); } catch (err) { toast.error(err.response?.data?.detail || "Hesaplanamadı."); } finally { setBusy(false); } };
  const rows = result ? [["Brüt Maaş", result.gross, "text-slate-900"], ["SGK İşçi Payı (%14)", -result.sgk_employee], ["İşsizlik İşçi (%1)", -result.unemployment_employee], ["Gelir Vergisi", -result.income_tax], ["Damga Vergisi", -result.stamp_tax], ["NET MAAŞ", result.net, "text-emerald-700 text-base"], ["SGK İşveren (%15.5)", result.employer_sgk], ["İşsizlik İşveren (%2)", result.employer_unemployment], ["TOPLAM İŞVEREN MALİYETİ", result.total_employer_cost, "text-rose-700 text-base"]] : [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="salary-calculator">
      <form onSubmit={calc} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Calculator className="w-4 h-4 text-indigo-600" /> Maaş Hesaplama (Brüt ⇄ Net)</h3>
        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setMode("gross")} className={`p-2 rounded-lg border font-semibold ${mode === "gross" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white"}`} data-testid="salary-mode-gross">Brütten Nete</button><button type="button" onClick={() => setMode("net")} className={`p-2 rounded-lg border font-semibold ${mode === "net" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white"}`} data-testid="salary-mode-net">Netten Brüte</button></div>
        <div><label className="block font-semibold mb-1">{mode === "gross" ? "Brüt Maaş (₺)" : "Net Maaş (₺)"}</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} font-bold text-base`} data-testid="salary-amount-input" /></div>
        <button type="submit" disabled={busy} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-semibold disabled:opacity-60" data-testid="salary-calc-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : "Hesapla"}</button>
        <p className="text-[10px] text-slate-400">2026 yaklaşık oranlar; asgari ücret gelir/damga vergisi istisnası uygulanır. Resmi bordro için mali müşavirinizle doğrulayın.</p>
      </form>
      <div className="bg-white border border-slate-200 rounded-2xl p-5 text-xs">
        {!result ? <div className="h-full flex items-center justify-center text-slate-300">Hesaplama sonucu burada görünür.</div> : (
          <div className="divide-y divide-slate-100" data-testid="salary-result">{rows.map(([l, v, cls]) => <div key={l} className={`flex justify-between py-2 ${cls?.includes("text-base") ? "font-bold" : ""}`}><span className="text-slate-600">{l}</span><span className={`font-bold ${cls || (v < 0 ? "text-rose-600" : "text-slate-800")}`}>{v < 0 ? "-" : ""}{fmt(Math.abs(v))} ₺</span></div>)}</div>
        )}
      </div>
    </div>
  );
};

export const BonusPanel = ({ companyId, employees, accounts, onChanged }) => {
  const [bonuses, setBonuses] = useState([]);
  const [form, setForm] = useState({ employee_id: "", type: "bonus", amount: "", period: new Date().toISOString().slice(0, 7), account_id: "", note: "" });
  const load = useCallback(async () => { const r = await axios.get(`${API_URL}/personnel/bonuses?company_id=${companyId}`); setBonuses(r.data); }, [companyId]);
  useEffect(() => { load(); }, [load]);
  const save = async (e) => { e.preventDefault(); try { const { account_id: target, ...rest } = form; await axios.post(`${API_URL}/personnel/bonuses`, { ...rest, employee_id: form.employee_id || employees[0]?.id, amount: Number(form.amount), ...splitPaymentTarget(target) }); toast.success("Ödeme kaydedildi."); setForm({ ...form, amount: "", note: "" }); load(); onChanged?.(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } };
  const remove = async (id) => { await axios.delete(`${API_URL}/personnel/bonuses/${id}`); load(); onChanged?.(); };
  const total = bonuses.filter((b) => b.period === form.period).reduce((s, b) => s + b.amount, 0);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="bonus-panel">
      <form onSubmit={save} className="bg-white border border-amber-200 rounded-2xl p-5 space-y-3 text-xs">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Gift className="w-4 h-4 text-amber-600" /> Prim / İkinci Maaş <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 font-bold">GAYRİ RESMİ</span></h3>
        <div><label className="block font-semibold mb-1">Çalışan</label><select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className={inputCls} data-testid="bonus-employee-select">{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
        <div className="grid grid-cols-3 gap-1">{[["bonus", "Prim"], ["second_salary", "2. Maaş"], ["advance", "Avans"]].map(([k, l]) => <button key={k} type="button" onClick={() => setForm({ ...form, type: k })} className={`p-2 rounded-lg border font-semibold ${form.type === k ? "bg-amber-500 text-white border-amber-500" : "bg-white"}`} data-testid={`bonus-type-${k}`}>{l}</button>)}</div>
        <div className="grid grid-cols-2 gap-2"><div><label className="block font-semibold mb-1">Dönem</label><input type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} className={inputCls} /></div><div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={`${inputCls} font-bold`} required data-testid="bonus-amount-input" /></div></div>
        <div><label className="block font-semibold mb-1">Ödeme Kaynağı</label><PaymentTargetSelect companyId={companyId} accounts={accounts} value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} testId="bonus-account-select" emptyLabel="Sadece kaydet (ödeme yok)" /></div>
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Not" className={inputCls} />
        <button type="submit" className="w-full py-2 bg-amber-500 text-white rounded-lg font-semibold" data-testid="save-bonus-btn">Kaydet</button>
      </form>
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b text-xs font-bold text-slate-900 flex justify-between"><span>Prim / İkinci Maaş Kayıtları</span><span className="text-slate-500 font-medium">{form.period} toplamı: <b className="text-amber-700">{fmt(total)} ₺</b></span></div>
        <table className="w-full text-left text-xs"><thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold"><tr><th className="px-4 py-2">Dönem</th><th className="px-4 py-2">Çalışan</th><th className="px-4 py-2">Tür</th><th className="px-4 py-2">Kaynak</th><th className="px-4 py-2 text-right">Tutar</th><th className="px-4 py-2"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {bonuses.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Kayıt yok.</td></tr>}
            {bonuses.map((b) => <tr key={b.id} data-testid={`bonus-row-${b.id}`}><td className="px-4 py-2 font-mono text-slate-500">{b.period}</td><td className="px-4 py-2 font-semibold text-slate-900">{b.employee_name}</td><td className="px-4 py-2"><span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{b.type_label}</span></td><td className="px-4 py-2 text-slate-500">{b.account_name || "Ödenmedi"}</td><td className="px-4 py-2 text-right font-bold">{fmt(b.amount)} ₺</td><td className="px-4 py-2 text-right"><button onClick={() => remove(b.id)} className="text-slate-300 hover:text-rose-600" data-testid={`delete-bonus-${b.id}`}><Trash2 className="w-3.5 h-3.5" /></button></td></tr>)}
          </tbody></table>
      </div>
    </div>
  );
};
