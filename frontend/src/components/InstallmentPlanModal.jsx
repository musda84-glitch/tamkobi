import React, { useEffect, useState, useCallback } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, CalendarClock, CheckCircle2, Trash2, Wallet, Printer, ScrollText } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { PromissoryPrint } from "./PromissoryPrint";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount((n || 0));
const INTERVALS = [["month", "Aylık"], ["week", "Haftalık"], ["days", "Gün aralığı"]];
const F = ({ label, children }) => <div><label className="block font-semibold text-slate-700 mb-1">{label}</label>{children}</div>;
const cls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

const normalizePlanResponse = (data) => {
  if (Array.isArray(data)) return { installments: data, promissory_notes: [] };
  return { installments: data?.installments || [], promissory_notes: data?.promissory_notes || [] };
};

export const PlanForm = ({ total, onSaved, saveLabel = "Taksit Planını Oluştur", allowPromissory = true }) => {
  const [cfg, setCfg] = useState({
    count: 3,
    down_payment: 0,
    interval: "month",
    interval_days: 30,
    first_due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    create_promissory: true,
    promissory_include_down_payment: false,
    print_promissory: true,
  });
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const { create_promissory, promissory_include_down_payment, print_promissory, ...plan } = cfg;
    axios.post(`${API_URL}/installments/preview`, { total, ...plan }).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [cfg.count, cfg.down_payment, cfg.interval, cfg.interval_days, cfg.first_due_date, total]);
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
      {allowPromissory && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3 space-y-2" data-testid="plan-promissory-options">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={!!cfg.create_promissory} onChange={(e) => setCfg({ ...cfg, create_promissory: e.target.checked })} data-testid="plan-create-promissory" />
            <span>
              <span className="font-bold text-violet-900 flex items-center gap-1"><ScrollText className="w-3.5 h-3.5" /> Her taksit için senet oluştur</span>
              <span className="block text-[11px] text-violet-700/80">Çek/Senet portföyüne işlenir; cari bakiyeye ikinci kez dokunulmaz. Peşinat satırı varsayılan olarak hariçtir.</span>
            </span>
          </label>
          {cfg.create_promissory && (
            <div className="pl-6 space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer text-violet-900">
                <input type="checkbox" checked={!!cfg.promissory_include_down_payment} onChange={(e) => setCfg({ ...cfg, promissory_include_down_payment: e.target.checked })} data-testid="plan-promissory-include-down" />
                Peşinat için de senet kes
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-violet-900">
                <input type="checkbox" checked={!!cfg.print_promissory} onChange={(e) => setCfg({ ...cfg, print_promissory: e.target.checked })} data-testid="plan-print-promissory" />
                Oluşturunca yazdır
              </label>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between"><span className="text-slate-500">Toplam: <b className="text-slate-900">{fmt(total)} ₺</b></span>
        <button onClick={() => onSaved(cfg)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold" data-testid="plan-save-btn">{saveLabel}</button></div>
    </div>
  );
};

export const InstallmentRows = ({ rows, accounts, companyId, onPaid, compact = false, onPrintPromissory }) => {
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
            {r.cheque_number && <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded" title="Bağlı senet">{r.cheque_number}</span>}
            {r.status !== "paid" && <span className={`text-[10px] font-semibold ${r.is_overdue ? "text-rose-600" : "text-slate-400"}`}>{r.is_overdue ? `${-r.days_left} gün gecikti` : `${r.days_left} gün kaldı`}</span>}
            <span className="ml-auto font-bold text-slate-900">{fmt(r.amount)} ₺</span>
            {r.status === "partial" && <span className="text-[10px] text-amber-600">({fmt(r.paid_amount)} ödendi)</span>}
            {r.status !== "paid" && !compact && <button onClick={() => { setPaying(r); setAmount(String(r.amount - (r.paid_amount || 0))); }} className="px-2 py-1 bg-emerald-600 text-white rounded-lg font-semibold" data-testid={`installment-pay-btn-${r.no}`}>{r.direction === "payable" ? "Öde" : "Tahsil Et"}</button>}
          </div>
        ))}
      </div>
      {(rows || []).some((r) => r.cheque_id) && onPrintPromissory && (
        <button type="button" onClick={() => onPrintPromissory((rows || []).filter((r) => r.cheque_id))} className="flex items-center gap-1 text-violet-700 hover:underline font-semibold" data-testid="installment-print-promissory-btn">
          <Printer className="w-3.5 h-3.5" /> Bağlı senetleri yazdır
        </button>
      )}
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
  const { activeCompany } = useAuth() || {};
  const [rows, setRows] = useState(null);
  const [printNotes, setPrintNotes] = useState(null);
  const isQuote = kind === "quote";
  const isBalance = kind === "balance";
  const base = isBalance ? `${API_URL}/contacts/${doc.id}/installments` : `${API_URL}/invoices/${doc.id}/installments`;
  const load = useCallback(() => isQuote ? setRows(doc.payment_plan?.rows || []) : axios.get(base).then((r) => setRows(r.data)), [isQuote, doc.payment_plan?.rows, base]);
  useEffect(() => { load(); }, [load]);

  const openPrintFromRows = async (linkedRows) => {
    const ids = linkedRows.map((r) => r.cheque_id).filter(Boolean);
    if (!ids.length) { toast.error("Yazdırılacak senet bulunamadı."); return; }
    try {
      const r = await axios.get(`${API_URL}/cheques`, { params: { company_id: companyId, instrument: "promissory" } });
      const all = r.data?.cheques || r.data?.items || r.data || [];
      const notes = (Array.isArray(all) ? all : []).filter((c) => ids.includes(c.id));
      if (!notes.length) { toast.error("Senet kayıtları bulunamadı."); return; }
      setPrintNotes(notes);
    } catch { toast.error("Senetler yüklenemedi."); }
  };

  const save = async (cfg) => {
    try {
      const { print_promissory, ...payload } = cfg;
      if (isQuote) {
        const r = await axios.post(`${API_URL}/quotes/${doc.id}/payment-plan`, payload);
        setRows(r.data.payment_plan.rows);
        toast.success("Ödeme planı teklife eklendi.");
      } else {
        const r = await axios.post(base, payload);
        const { installments, promissory_notes } = normalizePlanResponse(r.data);
        setRows(installments);
        if (payload.create_promissory && promissory_notes.length) {
          toast.success(`Taksit planı ve ${promissory_notes.length} senet oluşturuldu.`);
          if (print_promissory) setPrintNotes(promissory_notes);
        } else {
          toast.success("Taksit planı oluşturuldu.");
        }
      }
      onChanged?.();
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
    <>
      <div className="fixed inset-0 z-[75] bg-slate-900/60 backdrop-blur-sm overflow-y-auto overscroll-contain" onClick={onClose}>
        <div className="min-h-full flex items-start justify-center p-4 sm:p-6">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[calc(100vh-2rem)] overflow-y-auto my-4" onClick={(e) => e.stopPropagation()} data-testid="installment-plan-modal">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-emerald-600" /><div><h3 className="text-base font-bold text-slate-900">{isQuote ? "Teklif Ödeme Planı (Taksit)" : isBalance ? "Açık Bakiyeyi Taksitlendir" : "Taksitlendirme"}</h3><p className="text-xs text-slate-500">{doc.invoice_number || doc.quote_number} • {doc.contact_name} • {fmt(doc.grand_total)} ₺</p></div></div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="installment-close-btn"><X className="w-5 h-5" /></button>
            </div>
            {rows === null ? <div className="text-xs text-slate-400">Yükleniyor…</div> : rows.length === 0 ? (
              <PlanForm total={total} onSaved={save} saveLabel={isQuote ? "Ödeme Planını Teklife Ekle" : "Taksit Planını Oluştur"} allowPromissory={!isQuote} />
            ) : (
              <>
                {isQuote ? <div className="bg-slate-50 rounded-xl border divide-y text-xs">{rows.map((r) => <div key={r.no} className="flex justify-between px-3 py-1.5"><b>{r.label}</b><span className="font-mono text-slate-500">{r.due_date}</span><b>{fmt(r.amount)} ₺</b></div>)}</div>
                  : <InstallmentRows rows={rows} accounts={accounts} companyId={companyId} onPaid={() => { load(); onChanged?.(); }} onPrintPromissory={openPrintFromRows} />}
                {isQuote && <p className="text-[11px] text-slate-500">Teklif faturaya çevrildiğinde bu plan otomatik olarak fatura taksitlerine dönüşür.</p>}
                {isBalance && <p className="text-[11px] text-slate-500">Taksitler <b>Taksitler</b> modülünde &quot;AÇIK BAKİYE&quot; olarak izlenir; senetler <b>Çek/Senet</b> portföyüne düşer.</p>}
                <div className="flex justify-between items-center pt-2 border-t">
                  <button onClick={remove} className="flex items-center gap-1 text-xs text-rose-600 hover:underline" data-testid="installment-remove-btn"><Trash2 className="w-3.5 h-3.5" /> Planı Kaldır</button>
                  <button onClick={onClose} className="px-4 py-2 border rounded-xl text-xs font-semibold">Kapat</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {printNotes && (
        <PromissoryPrint
          notes={printNotes}
          contact={{ name: doc.contact_name, tax_number_or_id: doc.contact_tax_number, address: doc.contact_address, city: doc.contact_city }}
          company={activeCompany}
          onClose={() => setPrintNotes(null)}
        />
      )}
    </>
  );
};
