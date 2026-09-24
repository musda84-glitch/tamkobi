import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Receipt, Wallet, RefreshCw, Trash2, Pencil, Search, CheckCircle2, Clock, Paperclip, X, ArrowUpDown, Repeat, Camera, ImagePlus } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { SearchSelect } from "../components/SearchSelect";
import { useEscape } from "../utils/useEscape";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressImageFile } from "../utils/compressImage";
import { ExportButtons } from "../components/ExportButtons";
import { BudgetPanel } from "../components/BudgetPanel";
import { FxPicker, fmtMoney } from "../components/FxPicker";
import { PaymentTargetSelect, splitPaymentTarget } from "../components/PaymentTargetSelect";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";
import { formatTrAmount } from "../utils/money";
import { applyExpenseScan, expenseScanHint } from "../utils/expenseScan";
const EXP_COLS = [{ key: "expense_number", label: "Masraf No" }, { key: "date", label: "Tarih" }, { key: "category", label: "Kategori" }, { key: "description", label: "Açıklama" }, { key: "contact_name", label: "Tedarikçi" }, { key: "employee_name", label: "Personel" }, { key: "amount", label: "Net", num: true }, { key: "vat_amount", label: "KDV", num: true }, { key: "total", label: "Toplam", num: true }, { label: "Ödeme", value: (r) => r.payment_status === "paid" ? `Ödendi (${r.account_name || ""})` : "Ödenmedi" }];

const fmt = (n) => formatTrAmount((Number(n) || 0));
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-emerald-500 outline-none";
const sel = "bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none";
const EMPTY = { date: new Date().toISOString().slice(0, 10), category: "Diğer", description: "", amount: "", vat_rate: 20, vat_included: false, account_id: "", contact_id: "", employee_id: "", document_no: "", notes: "", is_recurring: false, receipt_url: "", currency: "TRY", fx_rate: 1, fx_source: "try" };
const PRESETS = [["", "Tüm zamanlar"], ["month", "Bu ay"], ["last_month", "Geçen ay"], ["quarter", "Bu çeyrek"], ["year", "Bu yıl"]];
const range = (p) => { const d = new Date(); const iso = (x) => x.toISOString().slice(0, 10); const m0 = new Date(d.getFullYear(), d.getMonth(), 1);
  if (p === "month") return [iso(m0), iso(d)]; if (p === "last_month") return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))];
  if (p === "quarter") return [iso(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)), iso(d)]; if (p === "year") return [`${d.getFullYear()}-01-01`, iso(d)]; return ["", ""]; };

const Stat = ({ label, value, sub, cls = "", testid }) => <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4"><div className="text-[10px] uppercase font-semibold text-slate-400">{label}</div><div className={`text-lg font-bold ${cls}`} data-testid={testid}>{value}</div>{sub && <div className="text-[11px] text-slate-500">{sub}</div>}</div>;

const accountLabel = (a) => {
  const name = a.account_name || a.bank_name || "Hesap";
  const bank = a.bank_name && a.bank_name !== name ? a.bank_name : "";
  return `${bank ? `${bank} — ` : ""}${name} · ${fmt(a.current_balance)} ₺`;
};

const ExpenseModal = ({ companyId, initial, categories, accounts: accountsProp, contacts, employees, onClose, onSaved }) => {
  useEscape(onClose);
  const [f, setF] = useState(initial);
  const [newCat, setNewCat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const camRef = React.useRef(null);
  const galRef = React.useRef(null);
  const pickGuard = React.useRef(0);
  const scanFile = async (file) => {
    if (!file || scanBusy || !companyId) return;
    setScanBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await axios.post(
        `${API_URL}/ai/expense-extract?company_id=${encodeURIComponent(companyId)}`,
        fd,
        { timeout: 180000 },
      );
      const draft = r.data?.draft;
      if (!draft || !(Number(draft.amount) > 0)) {
        toast.error("Fişten tutar okunamadı. Daha net bir fotoğraf deneyin.");
        return;
      }
      setF((cur) => applyExpenseScan(cur, draft, r.data?.matched_contact));
      toast.success(expenseScanHint(draft));
    } catch (err) {
      toast.error(err.response?.data?.detail || (err.code === "ECONNABORTED" ? "İstek zaman aşımına uğradı." : "Fiş okunamadı."));
    } finally {
      setScanBusy(false);
      if (camRef.current) camRef.current.value = "";
      if (galRef.current) galRef.current.value = "";
    }
  };
  const openScan = (kind) => {
    pickGuard.current = Date.now() + 1500;
    (kind === "camera" ? camRef : galRef).current?.click();
  };
  // Modal açılışında taze çek — sayfa açıkken eklenen kasa/banka eski listede kalmasın.
  const [accounts, setAccounts] = useState(accountsProp || []);
  const [accountsLoading, setAccountsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setAccountsLoading(true);
    axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`)
      .then((r) => { if (!cancelled) setAccounts(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) toast.error("Kasa / banka listesi yenilenemedi."); })
      .finally(() => { if (!cancelled) setAccountsLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);
  const isEdit = !!initial.id;
  const calc = useMemo(() => { const a = Number(f.amount) || 0, r = Number(f.vat_rate) || 0; const net = f.vat_included ? a / (1 + r / 100) : a; return { net, vat: net * r / 100, total: net * (1 + r / 100) }; }, [f.amount, f.vat_rate, f.vat_included]);
  const upload = async (file) => {
    if (!file) return;
    const compressed = await compressImageFile(file);
    const fd = new FormData();
    fd.append("file", compressed);
    try {
      const r = await axios.post(`${API_URL}/files/upload?entity=expense&entity_id=${f.id || "new"}&company_id=${companyId}`, fd);
      setF({ ...f, receipt_url: r.data.url });
      toast.success(r.data?.saved_pct ? `Fiş/fatura eklendi (≈%${r.data.saved_pct} küçültüldü).` : "Fiş/fatura eklendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Yüklenemedi.");
    }
  };
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const { account_id: _acc, ...rest } = f; const body = { ...rest, company_id: companyId, amount: Number(f.amount), vat_rate: Number(f.vat_rate), contact_id: f.contact_id || null, employee_id: f.employee_id || null, ...splitPaymentTarget(f.account_id) };
      if (isEdit) await axios.put(`${API_URL}/expenses/${f.id}`, body); else await axios.post(`${API_URL}/expenses`, body);
      toast.success(isEdit ? "Masraf güncellendi." : `Masraf kaydedildi${f.account_id ? " ve ödendi" : ""}.`); if (f.account_id) await notifyDataChanged({ companyId, scopes: ["cash", "expenses"] }); onSaved(); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { if (Date.now() < pickGuard.current) return; onClose(); }}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="expense-modal">
        <div className="flex items-center justify-between border-b pb-3"><h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Receipt className="w-5 h-5 text-rose-600" /> {isEdit ? `Masraf Düzenle · ${f.expense_number}` : "Yeni Masraf"}</h3><button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-500" data-testid="exp-scan-hint">{scanBusy ? "Fiş okunuyor…" : "Kamera veya galeri ile fiş okuyun; tutar, KDV ve açıklama dolar."}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={scanBusy} onClick={() => openScan("camera")} className="px-2 py-1.5 rounded-lg border font-semibold inline-flex items-center justify-center gap-1 bg-indigo-50 text-indigo-800 border-indigo-200 disabled:opacity-50 text-xs" data-testid="exp-scan-camera"><Camera className="w-3.5 h-3.5" /> Kamera</button>
            <button type="button" disabled={scanBusy} onClick={() => openScan("gallery")} className="px-2 py-1.5 rounded-lg border font-semibold inline-flex items-center justify-center gap-1 bg-emerald-50 text-emerald-800 border-emerald-200 disabled:opacity-50 text-xs" data-testid="exp-scan-gallery"><ImagePlus className="w-3.5 h-3.5" /> Galeriden</button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => scanFile(e.target.files?.[0])} data-testid="exp-scan-camera-input" />
          <input ref={galRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={(e) => scanFile(e.target.files?.[0])} data-testid="exp-scan-gallery-input" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div><label className="block font-semibold mb-1">Tarih</label><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} data-testid="exp-date" /></div>
          <div className="md:col-span-2"><label className="flex justify-between font-semibold mb-1">Kategori <button type="button" onClick={() => setNewCat(!newCat)} className="text-emerald-700 hover:underline">{newCat ? "listeden seç" : "+ yeni kategori"}</button></label>
            {newCat ? <input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Yeni kategori adı" className={inputCls} data-testid="exp-category-new" /> : <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inputCls} data-testid="exp-category">{categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select>}</div>
          <div className="col-span-2 md:col-span-3"><label className="block font-semibold mb-1">Açıklama *</label><input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Örn: Eylül ayı ofis kirası" className={inputCls} data-testid="exp-description" /></div>
          <div><label className="block font-semibold mb-1">Tutar ({f.currency === "TRY" || !f.currency ? "₺" : f.currency})</label><input type="number" step="0.01" min="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={`${inputCls} font-bold`} data-testid="exp-amount" /></div>
          <div className="col-span-2"><FxPicker companyId={companyId} date={f.date} currency={f.currency} rate={f.fx_rate} source={f.fx_source} onChange={(p) => setF({ ...f, ...p })} testId="exp-fx" /></div>
          <div><label className="block font-semibold mb-1">KDV %</label><select value={f.vat_rate} onChange={(e) => setF({ ...f, vat_rate: e.target.value })} className={inputCls} data-testid="exp-vat-rate">{[0, 1, 10, 20].map((v) => <option key={v} value={v}>{`%${v}`}</option>)}</select></div>
          <div className="flex items-end"><label className="flex items-center gap-2 cursor-pointer bg-slate-50 border rounded-lg p-2 w-full"><input type="checkbox" checked={f.vat_included} onChange={(e) => setF({ ...f, vat_included: e.target.checked })} data-testid="exp-vat-included" /> Tutar KDV dahil</label></div>
          <div className="col-span-2 md:col-span-3 bg-slate-50 rounded-xl p-3 flex justify-between text-slate-600"><span>Net: <b>{fmtMoney(calc.net, f.currency || "TRY")}</b></span><span>KDV: <b data-testid="exp-vat-amount">{fmtMoney(calc.vat, f.currency || "TRY")}</b></span><span className="text-slate-900">Toplam: <b className="text-rose-600" data-testid="exp-total">{fmtMoney(calc.total, f.currency || "TRY")}</b></span></div>
          {(f.currency || "TRY") !== "TRY" && Number(f.fx_rate) > 0 && <div className="col-span-2 md:col-span-3 text-[11px] text-slate-500" data-testid="exp-local-total">TL karşılığı: <b>{fmtMoney(calc.total * Number(f.fx_rate), "TRY")}</b> (kur {Number(f.fx_rate).toLocaleString("tr-TR")})</div>}
          <div className="col-span-2 md:col-span-3"><label className="block font-semibold mb-1">Ödeme (Kasa / Banka / Kart / Ortak) {isEdit && <span className="text-slate-400 font-normal">— ödeme durumu listeden değiştirilir</span>}</label>
            <PaymentTargetSelect
              companyId={companyId}
              accounts={accounts}
              value={f.account_id || ""}
              onChange={(v) => setF({ ...f, account_id: v })}
              testId="exp-account"
              emptyLabel={accountsLoading ? "Hesaplar yükleniyor…" : "Henüz ödenmedi (borç olarak kaydet)"}
              className={inputCls}
              disabled={(isEdit && f.payment_status !== "paid") || accountsLoading}
            /></div>
          <div className="col-span-2 md:col-span-3 grid grid-cols-2 gap-3">
            <div><label className="block font-semibold mb-1">Tedarikçi (opsiyonel)</label><SearchSelect value={f.contact_id} options={contacts} getLabel={(c) => c.name} getSub={(c) => c.tax_number_or_id} placeholder="Cari ara…" onChange={(id) => setF({ ...f, contact_id: id })} testId="exp-contact" /></div>
            <div><label className="block font-semibold mb-1">Personel (masraf sahibi)</label><select value={f.employee_id || ""} onChange={(e) => setF({ ...f, employee_id: e.target.value })} className={inputCls} data-testid="exp-employee"><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
          </div>
          <div><label className="block font-semibold mb-1">Belge / Fiş No</label><input value={f.document_no} onChange={(e) => setF({ ...f, document_no: e.target.value })} className={inputCls} /></div>
          <div className="md:col-span-2"><label className="block font-semibold mb-1">Not</label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} /></div>
          <label className="col-span-2 md:col-span-2 flex items-center gap-2 cursor-pointer bg-violet-50 border border-violet-200 rounded-lg p-2 text-violet-800"><input type="checkbox" checked={f.is_recurring} onChange={(e) => setF({ ...f, is_recurring: e.target.checked })} data-testid="exp-recurring" /><Repeat className="w-3.5 h-3.5" /> Her ay tekrarlansın (kira, abonelik vb.)</label>
          <label className="flex items-center gap-2 cursor-pointer border border-dashed rounded-lg p-2 text-slate-600 hover:bg-slate-50"><Paperclip className="w-3.5 h-3.5" /> {f.receipt_url ? "Fiş ekli ✓ (değiştir)" : "Fiş / fatura ekle"}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="exp-receipt" /></label>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t"><button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">İptal</button><button type="submit" disabled={busy} className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold" data-testid="exp-save">{busy ? "Kaydediliyor…" : isEdit ? "Güncelle" : f.account_id ? "Kaydet & Öde" : "Kaydet"}</button></div>
      </form>
    </div>
  );
};

export default function ExpensesPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [data, setData] = useState({ expenses: [], summary: null });
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filters, setFilters] = useState({ q: "", category: "all", status: "all", preset: "month", from: range("month")[0], to: range("month")[1], sort: "date_desc" });
  const [modal, setModal] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [payAcc, setPayAcc] = useState("");
  const load = useCallback(async ({ silent = false } = {}) => {
    const p = new URLSearchParams({ company_id: companyId, category: filters.category, status: filters.status, ...(filters.from && { date_from: filters.from }), ...(filters.to && { date_to: filters.to }), ...(filters.q && { q: filters.q }) });
    const [e, c, a, ct, em] = await Promise.all([axios.get(`${API_URL}/expenses?${p}`), axios.get(`${API_URL}/expenses/categories?company_id=${companyId}`), axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`), axios.get(`${API_URL}/contacts?company_id=${companyId}`), axios.get(`${API_URL}/personnel/employees?company_id=${companyId}`)]);
    setData(e.data); setCategories(c.data); setAccounts(a.data); setContacts(ct.data.filter((x) => x.type !== "customer")); setEmployees(em.data);
  }, [companyId, filters.category, filters.status, filters.from, filters.to, filters.q]);
  useEffect(() => { load().catch(() => toast.error("Masraflar yüklenemedi.")); }, [load]);
  const refreshLoadSilent = useCallback(() => load({ silent: true }), [load]);
  useDataRefresh(refreshLoadSilent, { companyId, scopes: ["cash", "expenses", "contacts"] });
  const rows = useMemo(() => { const c = { date_desc: (a, b) => b.date.localeCompare(a.date), date_asc: (a, b) => a.date.localeCompare(b.date), amount_desc: (a, b) => b.total - a.total, amount_asc: (a, b) => a.total - b.total, category: (a, b) => a.category.localeCompare(b.category, "tr") }[filters.sort]; return [...data.expenses].sort(c); }, [data.expenses, filters.sort]);
  const s = data.summary;
  const del = async (x) => { if (!window.confirm(`${x.expense_number} silinsin mi?`)) return; try { const r = await axios.delete(`${API_URL}/expenses/${x.id}`); toast.success(r.data.message); load(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } };
  const pay = async () => { try { await axios.post(`${API_URL}/expenses/${payFor.id}/pay`, { ...splitPaymentTarget(payAcc) }); toast.success("Masraf ödendi, kasa/banka hareketi oluşturuldu."); setPayFor(null); await notifyDataChanged({ companyId, scopes: ["cash", "expenses"] }); load(); } catch (err) { toast.error(err.response?.data?.detail || "Ödenemedi."); } };
  const unpay = async (x) => { if (!window.confirm("Ödeme geri alınsın mı? Kasa/banka bakiyesi düzeltilir.")) return; try { await axios.post(`${API_URL}/expenses/${x.id}/unpay`); toast.success("Ödeme geri alındı."); await notifyDataChanged({ companyId, scopes: ["cash", "expenses"] }); load(); } catch (err) { toast.error(err.response?.data?.detail || "İşlem başarısız."); } };
  const runRecurring = async () => { try { const r = await axios.post(`${API_URL}/expenses/run-recurring`, { company_id: companyId }); toast.success(r.data.message); load(); } catch (err) { toast.error(err.response?.data?.detail || "Çalıştırılamadı."); } };
  const maxCat = s?.by_category?.[0]?.total || 1;
  return (
    <div className="space-y-6" data-testid="expenses-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Masraflar</h1><p className="text-xs sm:text-sm text-slate-500">Kira, fatura, yakıt, yemek, personel masrafları — kategori bazlı gider takibi ve kasa/banka entegrasyonu</p></div>
        <div className="flex gap-2 self-start">
          <ExportButtons rows={rows} columns={EXP_COLS} filename="masraflar" title="Masraf Listesi" size="md" />
          {s?.recurring_count > 0 && <button onClick={runRecurring} className="flex items-center gap-1.5 px-3 py-2 border border-violet-200 text-violet-700 bg-violet-50 rounded-xl text-xs font-semibold" title="Vadesi gelen tekrarlayan masrafları oluştur" data-testid="exp-run-recurring"><RefreshCw className="w-3.5 h-3.5" /> Tekrarlayanları İşle ({s.recurring_count})</button>}
          <button onClick={() => setModal({ ...EMPTY })} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-rose-600/20" data-testid="exp-new-btn"><Plus className="w-4 h-4" /> Yeni Masraf</button>
        </div>
      </div>
      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Bu Ay Toplam Masraf" value={`${fmt(s.this_month_total)} ₺`} cls="text-rose-600" testid="exp-stat-month" />
          <Stat label="Filtre Toplamı" value={`${fmt(s.total)} ₺`} sub={`${s.count} kayıt · KDV ${fmt(s.vat_total)} ₺`} testid="exp-stat-total" />
          <Stat label="Ödenmemiş" value={`${fmt(s.unpaid_total)} ₺`} sub={`${s.unpaid_count} bekleyen`} cls="text-amber-600" testid="exp-stat-unpaid" />
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-1.5" data-testid="exp-by-category"><div className="text-[10px] uppercase font-semibold text-slate-400">Kategori Dağılımı</div>
            {s.by_category.slice(0, 4).map((c) => <div key={c.category} className="text-[11px]"><div className="flex justify-between"><span className="truncate text-slate-700">{c.category}</span><b>{fmt(c.total)} ₺</b></div><div className="h-1.5 bg-slate-100 rounded-full"><div className="h-1.5 bg-rose-500 rounded-full" style={{ width: `${Math.max(4, (c.total / maxCat) * 100)}%` }} /></div></div>)}
            {s.by_category.length === 0 && <div className="text-xs text-slate-400">Kayıt yok</div>}</div>
        </div>
      )}
      <BudgetPanel companyId={companyId} refreshKey={data.expenses.length} />
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3 flex flex-wrap items-center gap-2" data-testid="exp-toolbar">
        <div className="relative flex-1 min-w-[200px]"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Açıklama, no, tedarikçi ara…" className="w-full pl-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500" data-testid="exp-search" /></div>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className={sel} data-testid="exp-filter-category"><option value="all">Tüm Kategoriler</option>{categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={sel} data-testid="exp-filter-status"><option value="all">Tümü</option><option value="paid">Ödendi</option><option value="unpaid">Ödenmedi</option></select>
        <select value={filters.preset} onChange={(e) => { const [from, to] = range(e.target.value); setFilters({ ...filters, preset: e.target.value, from, to }); }} className={sel} data-testid="exp-filter-preset">{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value, preset: "" })} className={sel} /><span className="text-slate-400 text-xs">–</span><input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value, preset: "" })} className={sel} />
        <div className="flex items-center gap-1 text-xs"><ArrowUpDown className="w-3.5 h-3.5 text-slate-400" /><select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })} className={sel} data-testid="exp-sort"><option value="date_desc">Tarih (yeni)</option><option value="date_asc">Tarih (eski)</option><option value="amount_desc">Tutar (yüksek)</option><option value="amount_asc">Tutar (düşük)</option><option value="category">Kategori</option></select></div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50 border-b text-slate-500 uppercase font-semibold"><tr><th className="px-4 py-3">Masraf No / Tarih</th><th className="px-4 py-3">Kategori</th><th className="px-4 py-3">Açıklama</th><th className="px-4 py-3">Tedarikçi / Personel</th><th className="px-4 py-3 text-right">Net / KDV</th><th className="px-4 py-3 text-right">Toplam</th><th className="px-4 py-3">Ödeme</th><th className="px-4 py-3 text-center">İşlemler</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400" data-testid="exp-empty">Bu filtrede masraf yok. "Yeni Masraf" ile ekleyin.</td></tr>}
            {rows.map((x) => (
              <tr key={x.id} className="hover:bg-slate-50/70" data-testid={`exp-row-${x.expense_number}`}>
                <td className="px-4 py-2.5"><div className="font-mono font-semibold text-slate-900">{x.expense_number}</div><div className="text-slate-400">{x.date}{x.is_recurring && <span className="ml-1 text-[9px] bg-violet-100 text-violet-700 px-1 rounded" title={`Sonraki: ${x.next_date}`}>AYLIK</span>}</div></td>
                <td className="px-4 py-2.5"><span className="bg-slate-100 px-2 py-0.5 rounded-md font-semibold">{x.category}</span></td>
                <td className="px-4 py-2.5 text-slate-800 max-w-[260px]"><div className="truncate" title={x.description}>{x.description}</div>{x.document_no && <div className="text-[10px] text-slate-400">Belge: {x.document_no}</div>}</td>
                <td className="px-4 py-2.5 text-slate-600">{x.contact_name || "-"}{x.employee_name && <div className="text-[10px] text-indigo-600">{x.employee_name}</div>}</td>
                <td className="px-4 py-2.5 text-right text-slate-500">{fmt(x.amount)} <span className="text-[10px]">/ {fmt(x.vat_amount)}</span></td>
                <td className="px-4 py-2.5 text-right font-bold text-rose-600">{fmtMoney(x.total, x.currency || "TRY")}{(x.currency || "TRY") !== "TRY" && x.local_total != null && <div className="text-[10px] font-normal text-slate-400">{fmtMoney(x.local_total, "TRY")}</div>}</td>
                <td className="px-4 py-2.5">{x.payment_status === "paid" ? <button onClick={() => unpay(x)} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700" title={`${x.account_name} · ${x.paid_date} — geri almak için tıkla`} data-testid={`exp-paid-${x.expense_number}`}><CheckCircle2 className="w-3 h-3" /> Ödendi</button> : <button onClick={async () => {
                  setPayFor(x);
                  try {
                    const r = await axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`);
                    const list = Array.isArray(r.data) ? r.data : [];
                    setAccounts(list);
                    setPayAcc(list[0]?.id || list[0]?._id || "");
                  } catch {
                    setPayAcc(accounts[0]?.id || accounts[0]?._id || "");
                  }
                }} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100" data-testid={`exp-pay-${x.expense_number}`}><Clock className="w-3 h-3" /> Öde</button>}</td>
                <td className="px-4 py-2.5 text-center whitespace-nowrap">
                  {x.receipt_url && <a href={resolveImageUrl(x.receipt_url)} target="_blank" rel="noreferrer" className="inline-block p-1.5 text-slate-500 hover:text-indigo-600" title="Fiş / belge"><Paperclip className="w-3.5 h-3.5" /></a>}
                  <button onClick={() => setModal({ ...EMPTY, ...x, account_id: x.account_id || "" })} className="p-1.5 text-slate-500 hover:text-indigo-600" title="Düzenle" data-testid={`exp-edit-${x.expense_number}`}><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => del(x)} className="p-1.5 text-slate-500 hover:text-rose-600" title="Sil" data-testid={`exp-del-${x.expense_number}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <ExpenseModal companyId={companyId} initial={modal} categories={categories} accounts={accounts} contacts={contacts} employees={employees} onClose={() => setModal(null)} onSaved={load} />}
      {payFor && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setPayFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3 text-xs shadow-2xl" data-testid="exp-pay-modal">
            <div className="font-bold text-slate-900 text-sm flex items-center gap-2"><Wallet className="w-4 h-4 text-emerald-600" /> Masrafı Öde · {fmtMoney(payFor.total, payFor.currency || "TRY")}</div>
            <div className="text-slate-500">{payFor.expense_number} — {payFor.description}</div>
            <PaymentTargetSelect companyId={companyId} accounts={accounts} value={payAcc} onChange={setPayAcc} testId="exp-pay-account" className={inputCls} />
            <div className="flex justify-end gap-2 pt-2 border-t"><button onClick={() => setPayFor(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={pay} disabled={!payAcc} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="exp-pay-confirm">Öde</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
