import React, { useEffect, useState, useCallback } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, CalendarClock, CheckCircle2, Trash2, Wallet } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const INTERVALS = [["month", "Aylık"], ["week", "Haftalık"], ["days", "Gün aralığı"]];
const F = ({ label, children }) => <div><label className="block font-semibold text-slate-700 mb-1">{label}</label>{children}</div>;
const cls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

export const PlanForm = ({ total, onSaved, saveLabel = "Taksit Planını Oluştur" }) => {
  const [cfg, setCfg] = useState({ count: 3, down_payment: 0, interval: "month", interval_days: 30, first_due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) });
  const [rows, setRows] = useState([]);
  useEffect(() => { axios.post(`${API_URL}/installments/preview`, { total, ...cfg }).then((r) => setRows(r.data)).catch(() => setRows([])); }, [cfg, total]);
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <F label="Taksit Sayısı"><input type="number" min="1" max="60" value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: Number(e.target.value) || 1 })} className={`${cls} font-bold`} data-testid="plan-count-input" /></F>
        <F label="Peşinat (₺)"><input type="number" min="0" value={cfg.down_payment} onChange={(e) => setCfg({ ...cfg, down_payment: Number(e.target.value) || 0 })} className={cls} data-testid="plan-down-input" /></F>
        <F label="Periyot"><select value={cfg.interval} onChange={(e) => setCfg({ ...cfg, interval: e.target.value })} className={cls} data-testid="plan-interval-select">{INTERVALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        {cfg.interval === "days" ? <F label="Gün"><input type="number" min="1" value={cfg.interval_days} onChange={(e) => setCfg({ ...cfg, interval_days: Number(e.target.value) || 30 })} className={cls} /></F>
          : <F label="İlk Taksit Tarihi"><input type="date" value={cfg.first_due_date} onChange={(e) => setCfg({ ...cfg, first_due_date: e.target.value })} className={cls} data-testid="plan-first-date-input" /></F>}
      </div>
      <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto" data-testid="plan-preview">
        {rows.map((r) => <div key={r.no} className="flex items-center justify-between px-3 py-1.5"><span className="font-semibold text-slate-700">{r.label}</span><span className="text-slate-500 font-mono">{r.due_date}</span><span className="font-bold text-slate-900">{fmt(r.amount)} ₺</span></div>)}
      </div>
      <div className="flex items-center justify-between"><span className="text-slate-500">Toplam: <b className="text-slate-900">{fmt(total)} ₺</b></span>
        <button onClick={() => onSaved(cfg)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold" data-testid="plan-save-btn">{saveLabel}</button></div>
    </div>
  );
};

export const InstallmentRows = ({ rows, accounts, companyId, onPaid, compact = false }) => {
  const [paying, setPaying] = useState(null);
  const [account, setAccount] = useState(accounts?.[0]?.id || "");
  const [amount, setAmount] = useState("");
  const pay = async () => {
    try {
      const r = await axios.post(`${API_URL}/installments/${paying.id}/pay`, { ...splitPaymentTarget(account), amount: Number(amount) || undefined });
      toast.success(r.data.message); setPaying(null); setAmount(""); onPaid?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Ödeme kaydedilemedi."); }
  };
  return (
    <div className="space-y-2 text-xs">
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-2 px-3 py-2 ${r.is_overdue ? "bg-rose-50/60" : ""}`} data-testid={`installment-row-${r.no}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${r.status === "paid" ? "bg-emerald-600 text-white" : r.is_overdue ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-700"}`}>{r.status === "paid" ? <CheckCircle2 className="w-3 h-3" /> : r.no}</span>
            <span className="font-semibold text-slate-800 w-20">{r.label}</span>
            <span className="text-slate-500 font-mono">{r.due_date}</span>
            {r.status !== "paid" && <span className={`text-[10px] font-semibold ${r.is_overdue ? "text-rose-600" : "text-slate-400"}`}>{r.is_overdue ? `${-r.days_left} gün gecikti` : `${r.days_left} gün kaldı`}</span>}
            <span className="ml-auto font-bold text-slate-900">{fmt(r.amount)} ₺</span>
            {r.status === "partial" && <span className="text-[10px] text-amber-600">({fmt(r.paid_amount)} ödendi)</span>}
            {r.status !== "paid" && !compact && <button onClick={() => { setPaying(r); setAmount(String(r.amount - (r.paid_amount || 0))); }} className="px-2 py-1 bg-emerald-600 text-white rounded-lg font-semibold" data-testid={`installment-pay-btn-${r.no}`}>{r.direction === "payable" ? "Öde" : "Tahsil Et"}</button>}
          </div>
        ))}
      </div>
      {paying && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2" data-testid="installment-pay-form">
          <div className="font-semibold text-emerald-800 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> {paying.label} — {paying.contact_name}</div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-white border border-slate-200 rounded-lg p-2 font-bold" data-testid="installment-pay-amount" />
            <PaymentTargetSelect companyId={companyId} accounts={accounts} value={account} onChange={setAccount} testId="installment-pay-account" className="!bg-white" collectableOnly={paying.direction !== "payable"} />
          </div>
          <div className="flex justify-end gap-2"><button onClick={() => setPaying(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={pay} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="installment-pay-confirm">Kaydet</button></div>
        </div>
      )}
    </div>
  );
};

export const InstallmentPlanModal = ({ doc, kind = "invoice", accounts = [], companyId, onClose, onChanged }) => {
  useEscape(onClose);
  const [rows, setRows] = useState(null);
  const isQuote = kind === "quote";
  const isBalance = kind === "balance";
  const base = isBalance ? `${API_URL}/contacts/${doc.id}/installments` : `${API_URL}/invoices/${doc.id}/installments`;
  const load = useCallback(() => isQuote ? setRows(doc.payment_plan?.rows || []) : axios.get(base).then((r) => setRows(r.data)), [isQuote, doc.payment_plan?.rows, base]);
  useEffect(() => { load(); }, [load]);
  const save = async (cfg) => {
    try {
      if (isQuote) { const r = await axios.post(`${API_URL}/quotes/${doc.id}/payment-plan`, cfg); setRows(r.data.payment_plan.rows); }
      else await axios.post(base, cfg).then((r) => setRows(r.data));
      toast.success(isQuote ? "Ödeme planı teklife eklendi." : "Taksit planı oluşturuldu."); onChanged?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Plan kaydedilemedi."); }
  };
  const remove = async () => {
    try {
      if (isQuote) await axios.post(`${API_URL}/quotes/${doc.id}/payment-plan`, { remove: true }); else await axios.delete(base);
      setRows([]); toast.success("Plan kaldırıldı."); onChanged?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Plan kaldırılamadı."); }
  };
  const total = (doc.grand_total || 0) - (doc.paid_amount || 0);
  return (
    <div className="fixed inset-0 z-[75] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="installment-plan-modal">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-emerald-600" /><div><h3 className="text-base font-bold text-slate-900">{isQuote ? "Teklif Ödeme Planı (Taksit)" : isBalance ? "Açık Bakiyeyi Taksitlendir" : "Taksitlendirme"}</h3><p className="text-xs text-slate-500">{doc.invoice_number || doc.quote_number} • {doc.contact_name} • {fmt(doc.grand_total)} ₺</p></div></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="installment-close-btn"><X className="w-5 h-5" /></button>
        </div>
        {rows === null ? <div className="text-xs text-slate-400">Yükleniyor…</div> : rows.length === 0 ? <PlanForm total={total} onSaved={save} saveLabel={isQuote ? "Ödeme Planını Teklife Ekle" : "Taksit Planını Oluştur"} /> : (
          <>
            {isQuote ? <div className="bg-slate-50 rounded-xl border divide-y text-xs">{rows.map((r) => <div key={r.no} className="flex justify-between px-3 py-1.5"><b>{r.label}</b><span className="font-mono text-slate-500">{r.due_date}</span><b>{fmt(r.amount)} ₺</b></div>)}</div>
              : <InstallmentRows rows={rows} accounts={accounts} companyId={companyId} onPaid={() => { load(); onChanged?.(); }} />}
            {isQuote && <p className="text-[11px] text-slate-500">Teklif faturaya çevrildiğinde bu plan otomatik olarak fatura taksitlerine dönüşür.</p>}
            {isBalance && <p className="text-[11px] text-slate-500">Taksitler <b>Taksitler</b> modülünde "AÇIK BAKİYE" olarak izlenir; tahsilat kasa/banka/ortak hesabına işlenir ve cari bakiyesi düşer.</p>}
            <div className="flex justify-between items-center pt-2 border-t">
              <button onClick={remove} className="flex items-center gap-1 text-xs text-rose-600 hover:underline" data-testid="installment-remove-btn"><Trash2 className="w-3.5 h-3.5" /> Planı Kaldır</button>
              <button onClick={onClose} className="px-4 py-2 border rounded-xl text-xs font-semibold">Kapat</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
