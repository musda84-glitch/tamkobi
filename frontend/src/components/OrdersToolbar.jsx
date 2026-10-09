
import React from "react";
import { Search, ArrowUpDown, X, ChevronDown, FileStack, RefreshCw } from "lucide-react";
import { channelTr } from "../utils/labels";
import { ExportButtons } from "./ExportButtons";
import { OrdersBulkMenu } from "./OrdersBulkMenu";
import { orderGross } from "../utils/orderMoney";
import { fmtDate, formatTrAmount } from "../utils/money";
import {
  ORDER_DOC_STATUS_ALL,
  ORDER_DOC_STATUS_LABELS,
  docStatusFilterActive,
} from "../utils/orderDocStatus";
import {
  ORDER_FILTER_DEFAULTS,
  ORDER_STATUS_OPTIONS,
  applyOrderFilters,
  isIncomingOrder,
  isDispatchedOrder,
  orderFiltersFromSearch,
} from "../utils/orderFilters";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export {
  ORDER_FILTER_DEFAULTS,
  applyOrderFilters,
  isIncomingOrder,
  isDispatchedOrder,
  orderFiltersFromSearch,
};

const ORD_COLS = [{ key: "order_number", label: "Sipariş No" }, { label: "Tarih", value: (r) => fmtDate(r.order_date) }, { label: "Kanal", value: (r) => channelTr(r.channel || "b2b") }, { key: "customer_name", label: "Müşteri" }, { key: "customer_phone", label: "Telefon" }, { label: "Ürünler", value: (r) => (r.items || []).map((i) => `${i.quantity}x ${i.product_name}`).join(", ") }, { label: "Tutar (KDV dahil)", num: true, value: (r) => orderGross(r) }, { key: "order_status", label: "Durum" }, { key: "invoice_number", label: "Fatura" }, { key: "cargo_tracking_number", label: "Kargo Takip" }];
const STATUS = ORDER_STATUS_OPTIONS;
const SORT = [["date_desc", "Tarih (yeni)"], ["date_asc", "Tarih (eski)"], ["amount_desc", "Tutar (yüksek)"], ["amount_asc", "Tutar (düşük)"], ["customer", "Müşteri (A→Z)"], ["number", "Sipariş No"]];
export const ORDER_PAGE_SIZES = [50, 100, 200, 500, 1000];

const DocStatusFilter = ({ value, onChange }) => {
  const selected = Array.isArray(value) ? value : [...ORDER_DOC_STATUS_ALL];
  const allOn = ORDER_DOC_STATUS_ALL.every((k) => selected.includes(k));
  const active = docStatusFilterActive(selected);
  const label = !active
    ? "Belge: Tümü"
    : selected.length === 1
      ? `Belge: ${ORDER_DOC_STATUS_LABELS[selected[0]]}`
      : `Belge: ${selected.length}`;

  const toggle = (key) => {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else onChange([...selected, key]);
  };
  const toggleAll = () => {
    onChange(allOn ? [] : [...ORDER_DOC_STATUS_ALL]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none ${active ? "border-violet-300 bg-violet-50 font-semibold" : ""}`}
          data-testid="ord-doc-status"
        >
          <FileStack className="w-3.5 h-3.5 text-slate-400" />
          {label}
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[80] w-52 rounded-xl p-1 shadow-lg" data-testid="ord-doc-status-menu">
        <DropdownMenuLabel className="text-[10px] font-bold text-rose-600 uppercase tracking-wide">
          Belge durumu seçin
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={allOn}
          onCheckedChange={toggleAll}
          onSelect={(e) => e.preventDefault()}
          className="text-xs font-semibold text-rose-700"
          data-testid="ord-doc-status-all"
        >
          Tümünü seç
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {ORDER_DOC_STATUS_ALL.map((key) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={selected.includes(key)}
            onCheckedChange={() => toggle(key)}
            onSelect={(e) => e.preventDefault()}
            className="text-xs"
            data-testid={`ord-doc-status-${key}`}
          >
            {ORDER_DOC_STATUS_LABELS[key]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const OrdersToolbar = ({
  f,
  setF,
  orders,
  count,
  total,
  rows = [],
  selectedCount = 0,
  bulkBusy = false,
  onBulkAction,
  pageSize = 50,
  onPageSizeChange,
  onRefresh,
  refreshBusy = false,
}) => {
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const channels = [...new Set(orders.map((o) => o.channel || "b2b"))];
  const sel = "bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none";
  const active = Object.keys(ORDER_FILTER_DEFAULTS).filter((k) => {
    if (k === "sort") return false;
    if (k === "docStatus") return docStatusFilterActive(f.docStatus);
    return f[k] !== ORDER_FILTER_DEFAULTS[k];
  }).length;
  const counts = orders.reduce((m, o) => {
    m[o.order_status] = (m[o.order_status] || 0) + 1;
    if (isIncomingOrder(o)) m.incoming = (m.incoming || 0) + 1;
    if (isDispatchedOrder(o)) m.dispatched = (m.dispatched || 0) + 1;
    return m;
  }, {});
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3 space-y-2" data-testid="orders-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Sipariş no, müşteri, telefon, ürün, kargo takip no…" className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500" data-testid="ord-search" />{f.q && <button onClick={() => set("q", "")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" data-testid="ord-search-clear"><X className="w-3.5 h-3.5" /></button>}</div>
        <select value={f.status} onChange={(e) => set("status", e.target.value)} className={`${sel} ${f.status !== "all" ? "border-emerald-300 bg-emerald-50 font-semibold" : ""}`} data-testid="ord-status">{STATUS.map(([k, l]) => <option key={k} value={k}>{l}{k !== "all" && counts[k] ? ` (${counts[k]})` : ""}</option>)}</select>
        <select value={f.channel} onChange={(e) => set("channel", e.target.value)} className={`${sel} ${f.channel !== "all" ? "border-sky-300 bg-sky-50 font-semibold" : ""}`} data-testid="ord-channel"><option value="all">Tüm Kanallar</option>{channels.map((c) => <option key={c} value={c}>{channelTr(c)}</option>)}</select>
        <DocStatusFilter value={f.docStatus} onChange={(v) => set("docStatus", v)} />
        <select value={f.invoiced} onChange={(e) => set("invoiced", e.target.value)} className={sel} data-testid="ord-invoiced">
          <option value="all">Fatura: Tümü</option>
          <option value="yes">Faturalandı</option>
          <option value="einvoice">E Fatura Kesildi</option>
          <option value="no">Faturalanmadı</option>
        </select>
        <select value={f.cargo} onChange={(e) => set("cargo", e.target.value)} className={sel} data-testid="ord-cargo"><option value="all">Kargo: Tümü</option><option value="yes">Kargolandı</option><option value="no">Kargo Bekliyor</option></select>
        <div className="flex items-center gap-1 text-xs"><ArrowUpDown className="w-3.5 h-3.5 text-slate-400" /><select value={f.sort} onChange={(e) => set("sort", e.target.value)} className={sel} data-testid="ord-sort">{SORT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} className={sel} data-testid="ord-from" /><span className="text-slate-400">–</span><input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} className={sel} data-testid="ord-to" />
        {active > 0 && <button onClick={() => setF({ ...ORDER_FILTER_DEFAULTS, docStatus: [...ORDER_DOC_STATUS_ALL], sort: f.sort })} className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100" data-testid="ord-filters-clear">Filtreleri temizle ({active})</button>}
        <label className="inline-flex items-center gap-1.5 text-slate-600">
          <span className="font-semibold text-slate-500">Sayfa</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
            className={sel}
            data-testid="ord-page-size"
          >
            {ORDER_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshBusy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-testid="ord-refresh-btn"
            title="Pazaryerinden siparişleri çek ve listeyi yenile (sayfa açılışı çekmez)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshBusy ? "animate-spin" : ""}`} />
            Yenile
          </button>
        )}
        <div className="ml-auto flex items-center gap-3 text-slate-500">
          {onBulkAction && <OrdersBulkMenu selectedCount={selectedCount} busy={bulkBusy} onAction={onBulkAction} />}
          <ExportButtons rows={rows} columns={ORD_COLS} filename="siparisler" title="Sipariş Listesi" />
          <div data-testid="ord-result-summary"><b className="text-slate-900">{count}</b> sipariş · Toplam <b className="text-slate-900">{formatTrAmount(total)} ₺</b></div>
        </div>
      </div>
    </div>
  );
};
