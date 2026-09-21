import React from "react";
import { Search, ArrowUpDown, X, CalendarDays } from "lucide-react";
import { ExportButtons } from "./ExportButtons";
import { formatTrAmount } from "../utils/money";

const INV_COLS = [{ key: "invoice_number", label: "Fatura No" }, { key: "issue_date", label: "Tarih" }, { key: "due_date", label: "Vade" }, { label: "Tür", value: (r) => r.trade_kind === "export" || r.e_type === "e_export" ? "İhracat" : r.trade_kind === "import" ? "İthalat" : r.invoice_type === "sales" ? "Satış" : r.invoice_type === "purchase" ? "Alış" : r.invoice_type === "dispatch" ? "İrsaliye" : r.invoice_type }, { key: "e_type", label: "Belge" }, { key: "contact_name", label: "Cari" }, { key: "contact_tax_id", label: "VKN" }, { key: "subtotal", label: "Ara Toplam", num: true }, { key: "vat_total", label: "KDV", num: true }, { key: "grand_total", label: "Genel Toplam", num: true }, { label: "Ödeme", value: (r) => r.payment_status === "paid" ? "Ödendi" : r.payment_status === "partially_paid" ? "Kısmi" : "Cariye işlendi" }, { key: "gib_status", label: "GİB" }];

export const SORT_OPTIONS = [
  ["date_desc", "Tarih (yeni → eski)"], ["date_asc", "Tarih (eski → yeni)"],
  ["due_asc", "Vade (yakın önce)"], ["due_desc", "Vade (uzak önce)"],
  ["amount_desc", "Tutar (çoktan aza)"], ["amount_asc", "Tutar (azdan çoğa)"],
  ["contact_asc", "Cari (A → Z)"], ["contact_desc", "Cari (Z → A)"],
  ["number_desc", "Fatura No (yeni)"], ["number_asc", "Fatura No (eski)"],
  ["gib_asc", "GİB (A → Z)"], ["gib_desc", "GİB (Z → A)"],
  ["pay_asc", "Ödeme (ödenmedi önce)"], ["pay_desc", "Ödeme (ödendi önce)"],
];
/** Kolon başlığı ↔ sıralama anahtarları (ilk tık = [0], tekrar = [1]). */
export const SORT_COL_KEYS = {
  number: ["number_desc", "number_asc"],
  contact: ["contact_asc", "contact_desc"],
  date: ["date_desc", "date_asc"],
  amount: ["amount_desc", "amount_asc"],
  gib: ["gib_asc", "gib_desc"],
  pay: ["pay_asc", "pay_desc"],
};
export const toggleInvoiceSort = (current, col) => {
  const pair = SORT_COL_KEYS[col];
  if (!pair) return current;
  return current === pair[0] ? pair[1] : pair[0];
};
export const invoiceSortCol = (sort) => Object.keys(SORT_COL_KEYS).find((c) => SORT_COL_KEYS[c].includes(sort)) || null;
export const invoiceSortDir = (sort) => (String(sort || "").endsWith("_asc") ? "asc" : String(sort || "").endsWith("_desc") ? "desc" : null);

const PAY_RANK = { unpaid: 0, partially_paid: 1, paid: 2 };
const PAY = [["all", "Tümü"], ["unpaid", "Cariye işlendi"], ["partially_paid", "Kısmi"], ["paid", "Ödendi"], ["overdue", "Vadesi Geçti"]];
const ETYPE = [["all", "Tüm Belgeler"], ["e_invoice", "E-Fatura"], ["e_archive", "E-Arşiv"], ["e_export", "e-İhracat"], ["paper", "Kağıt"], ["e_dispatch", "E-İrsaliye"]];
const PRESETS = [["", "Tüm zamanlar"], ["today", "Bugün"], ["week", "Bu hafta"], ["month", "Bu ay"], ["quarter", "Bu çeyrek"], ["year", "Bu yıl"]];

export const presetRange = (p) => {
  const d = new Date(); const iso = (x) => x.toISOString().slice(0, 10);
  if (p === "today") return [iso(d), iso(d)];
  if (p === "week") { const s = new Date(d); s.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(s), iso(d)]; }
  if (p === "month") return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)];
  if (p === "quarter") return [iso(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)), iso(d)];
  if (p === "year") return [`${d.getFullYear()}-01-01`, iso(d)];
  return ["", ""];
};

export const applyInvoiceFilters = (invoices, f) => {
  const q = f.q.trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const list = invoices.filter((inv) => {
    if (q && !`${inv.invoice_number} ${inv.contact_name} ${inv.contact_tax_id || ""} ${inv.notes || ""}`.toLowerCase().includes(q)) return false;
    if (f.pay === "overdue") { if (inv.payment_status === "paid" || !inv.due_date || inv.due_date >= today) return false; }
    else if (f.pay !== "all" && (inv.payment_status || "unpaid") !== f.pay) return false;
    if (f.etype !== "all" && inv.e_type !== f.etype) return false;
    if (f.from && inv.issue_date < f.from) return false;
    if (f.to && inv.issue_date > f.to) return false;
    if (f.min && Number(inv.grand_total) < Number(f.min)) return false;
    if (f.max && Number(inv.grand_total) > Number(f.max)) return false;
    return true;
  });
  const cmp = {
    date_desc: (a, b) => (b.issue_date || "").localeCompare(a.issue_date || ""),
    date_asc: (a, b) => (a.issue_date || "").localeCompare(b.issue_date || ""),
    due_asc: (a, b) => (a.due_date || "9").localeCompare(b.due_date || "9"),
    due_desc: (a, b) => (b.due_date || "").localeCompare(a.due_date || ""),
    amount_desc: (a, b) => (b.grand_total || 0) - (a.grand_total || 0),
    amount_asc: (a, b) => (a.grand_total || 0) - (b.grand_total || 0),
    contact_asc: (a, b) => (a.contact_name || "").localeCompare(b.contact_name || "", "tr"),
    contact_desc: (a, b) => (b.contact_name || "").localeCompare(a.contact_name || "", "tr"),
    number_desc: (a, b) => (b.invoice_number || "").localeCompare(a.invoice_number || ""),
    number_asc: (a, b) => (a.invoice_number || "").localeCompare(b.invoice_number || ""),
    gib_asc: (a, b) => (a.gib_status || "").localeCompare(b.gib_status || "", "tr"),
    gib_desc: (a, b) => (b.gib_status || "").localeCompare(a.gib_status || "", "tr"),
    pay_asc: (a, b) => (PAY_RANK[a.payment_status] ?? 0) - (PAY_RANK[b.payment_status] ?? 0),
    pay_desc: (a, b) => (PAY_RANK[b.payment_status] ?? 0) - (PAY_RANK[a.payment_status] ?? 0),
  }[f.sort] || (() => 0);
  return [...list].sort(cmp);
};

export const DEFAULT_FILTERS = { q: "", pay: "all", etype: "all", from: "", to: "", preset: "", min: "", max: "", sort: "date_desc" };

export const InvoiceToolbar = ({ f, setF, count, total, hidePay = false, rows = [] }) => {
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setPreset = (p) => { const [from, to] = presetRange(p); setF((s) => ({ ...s, preset: p, from, to })); };
  const active = Object.keys(DEFAULT_FILTERS).filter((k) => k !== "sort" && f[k] !== DEFAULT_FILTERS[k]).length;
  const sel = "bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none";
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3 space-y-2" data-testid="invoice-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Fatura no, cari, VKN veya not ara…" className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none" data-testid="inv-search" />
          {f.q && <button onClick={() => set("q", "")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" data-testid="inv-search-clear"><X className="w-3.5 h-3.5" /></button>}
        </div>
        {!hidePay && <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-0.5" data-testid="inv-pay-filter">
          {PAY.map(([k, l]) => <button key={k} onClick={() => set("pay", k)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${f.pay === k ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-800"}`} data-testid={`inv-pay-${k}`}>{l}</button>)}
        </div>}
        <select value={f.etype} onChange={(e) => set("etype", e.target.value)} className={sel} data-testid="inv-etype-filter">{ETYPE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div className="flex items-center gap-1 text-xs text-slate-600"><ArrowUpDown className="w-3.5 h-3.5 text-slate-400" /><select value={f.sort} onChange={(e) => set("sort", e.target.value)} className={sel} data-testid="inv-sort">{SORT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
        <select value={f.preset} onChange={(e) => setPreset(e.target.value)} className={sel} data-testid="inv-date-preset">{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="date" value={f.from} onChange={(e) => setF((s) => ({ ...s, from: e.target.value, preset: "" }))} className={sel} data-testid="inv-date-from" /><span className="text-slate-400">–</span>
        <input type="date" value={f.to} onChange={(e) => setF((s) => ({ ...s, to: e.target.value, preset: "" }))} className={sel} data-testid="inv-date-to" />
        <input type="number" value={f.min} onChange={(e) => set("min", e.target.value)} placeholder="Min ₺" className={`${sel} w-24`} data-testid="inv-min" />
        <input type="number" value={f.max} onChange={(e) => set("max", e.target.value)} placeholder="Max ₺" className={`${sel} w-24`} data-testid="inv-max" />
        {active > 0 && <button onClick={() => setF({ ...DEFAULT_FILTERS, sort: f.sort })} className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100" data-testid="inv-filters-clear">Filtreleri temizle ({active})</button>}
        <div className="ml-auto flex items-center gap-3 text-slate-500"><ExportButtons rows={rows} columns={INV_COLS} filename={hidePay ? "irsaliyeler" : "faturalar"} title={hidePay ? "İrsaliye Listesi" : "Fatura Listesi"} /><div data-testid="inv-result-summary"><b className="text-slate-900">{count}</b> belge · Toplam <b className="text-slate-900">{formatTrAmount(total)} ₺</b></div></div>
      </div>
    </div>
  );
};
