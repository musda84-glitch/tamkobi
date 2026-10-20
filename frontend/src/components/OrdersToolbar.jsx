
import React from "react";
import { Search, ArrowUpDown, X, ChevronDown, FileStack, RefreshCw } from "lucide-react";
import { channelTr } from "../utils/labels";
import { ExportButtons } from "./ExportButtons";
import { OrdersBulkMenu } from "./OrdersBulkMenu";
import { orderGross } from "../utils/orderMoney";
import { formatTrAmount } from "../utils/money";
import { formatOrderDateTime } from "../utils/orderTermin";
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
import { MobileFilterField, MobileFilterSheet, mobileChipClass, mobileChipRowClass, mobileFilterFieldClass } from "./MobileFilterSheet";

export {
  ORDER_FILTER_DEFAULTS,
  applyOrderFilters,
  isIncomingOrder,
  isDispatchedOrder,
  orderFiltersFromSearch,
};

const ORD_COLS = [{ key: "order_number", label: "Sipariş No" }, { label: "Tarih", value: (r) => formatOrderDateTime(r.order_date) }, { label: "Kanal", value: (r) => channelTr(r.channel || "b2b") }, { key: "customer_name", label: "Müşteri" }, { key: "customer_phone", label: "Telefon" }, { label: "Ürünler", value: (r) => (r.items || []).map((i) => `${i.quantity}x ${i.product_name}`).join(", ") }, { label: "Tutar (KDV dahil)", num: true, value: (r) => orderGross(r) }, { key: "order_status", label: "Durum" }, { key: "invoice_number", label: "Fatura" }, { key: "cargo_tracking_number", label: "Kargo Takip" }];
const STATUS = ORDER_STATUS_OPTIONS;
const SORT = [["date_desc", "Tarih (yeni)"], ["date_asc", "Tarih (eski)"], ["amount_desc", "Tutar (yüksek)"], ["amount_asc", "Tutar (düşük)"], ["customer", "Müşteri (A→Z)"], ["number", "Sipariş No"]];
export const ORDER_PAGE_SIZES = [50, 100, 200, 500, 1000];

const DocStatusFilter = ({ value, onChange, variant = "inline" }) => {
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
          className={variant === "sheet"
            ? `inline-flex h-11 w-full items-center justify-between gap-1.5 rounded-xl border px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500 ${active ? "border-violet-300 bg-violet-50 font-semibold" : "border-slate-200 bg-white"}`
            : `inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none ${active ? "border-violet-300 bg-violet-50 font-semibold" : ""}`}
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
  channelOptions,
  statusCounts,
  loadExportRows,
  pageSizeOptions = ORDER_PAGE_SIZES,
  showTotal = true,
}) => {
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const channels = [...(channelOptions?.length ? channelOptions : new Set((orders || []).map((o) => o.channel || "b2b")))];
  if (f.channel && f.channel !== "all" && !channels.includes(f.channel)) channels.push(f.channel);
  const sel = "bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none";
  const cls = (variant, extra = "") => (
    variant === "sheet"
      ? (extra ? `${mobileFilterFieldClass} ${extra}` : mobileFilterFieldClass)
      : (extra ? `${sel} ${extra}` : sel)
  );
  const active = Object.keys(ORDER_FILTER_DEFAULTS).filter((k) => {
    if (k === "sort") return false;
    if (k === "docStatus") return docStatusFilterActive(f.docStatus);
    return f[k] !== ORDER_FILTER_DEFAULTS[k];
  }).length;
  const clearFilters = () => setF({ ...ORDER_FILTER_DEFAULTS, docStatus: [...ORDER_DOC_STATUS_ALL], sort: f.sort });
  const counts = statusCounts || (orders || []).reduce((m, o) => {
    m[o.order_status] = (m[o.order_status] || 0) + 1;
    if (isIncomingOrder(o)) m.incoming = (m.incoming || 0) + 1;
    if (isDispatchedOrder(o)) m.dispatched = (m.dispatched || 0) + 1;
    if (String(o?.cancel_request?.status || "") === "pending") m.cancel_request = (m.cancel_request || 0) + 1;
    return m;
  }, {});

  const renderSearch = (variant) => (
    <div className={variant === "mobile" ? "relative flex-1 min-w-0" : "relative flex-1 min-w-[220px]"}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={f.q}
        onChange={(e) => set("q", e.target.value)}
        placeholder="Sipariş no, müşteri, telefon, ürün, kargo takip no…"
        className={variant === "mobile"
          ? "w-full h-11 min-w-0 pl-9 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500"
          : "w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500"}
        data-testid={variant === "mobile" ? "ord-search-m" : "ord-search"}
      />
      {f.q && (
        <button onClick={() => set("q", "")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" data-testid={variant === "mobile" ? "ord-search-clear-m" : "ord-search-clear"}>
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
  const renderStatus = (variant) => {
    const node = (
      <select value={f.status} onChange={(e) => set("status", e.target.value)} className={cls(variant, f.status !== "all" ? "border-emerald-300 bg-emerald-50 font-semibold" : "")} data-testid="ord-status">
        {STATUS.map(([k, l]) => <option key={k} value={k}>{l}{k !== "all" && counts[k] ? ` (${counts[k]})` : ""}</option>)}
      </select>
    );
    return variant === "sheet" ? <MobileFilterField label="Durum">{node}</MobileFilterField> : node;
  };
  const renderChannel = (variant) => {
    const node = (
      <select value={f.channel} onChange={(e) => set("channel", e.target.value)} className={cls(variant, f.channel !== "all" ? "border-sky-300 bg-sky-50 font-semibold" : "")} data-testid="ord-channel">
        <option value="all">Tüm Kanallar</option>
        {channels.map((c) => <option key={c} value={c}>{channelTr(c)}</option>)}
      </select>
    );
    return variant === "sheet" ? <MobileFilterField label="Kanal">{node}</MobileFilterField> : node;
  };
  const renderDocStatus = (variant) => {
    const node = <DocStatusFilter value={f.docStatus} onChange={(v) => set("docStatus", v)} variant={variant === "sheet" ? "sheet" : "inline"} />;
    return variant === "sheet" ? <MobileFilterField label="Belge">{node}</MobileFilterField> : node;
  };
  const renderInvoiced = (variant) => {
    const node = (
      <select value={f.invoiced} onChange={(e) => set("invoiced", e.target.value)} className={cls(variant)} data-testid="ord-invoiced">
        <option value="all">Fatura: Tümü</option>
        <option value="yes">Faturalandı</option>
        <option value="einvoice">E Fatura Kesildi</option>
        <option value="einvoice_unsent">E-Fatura Kesilmedi (GİB'e gönderilmedi)</option>
        <option value="no">Faturalanmadı</option>
      </select>
    );
    return variant === "sheet" ? <MobileFilterField label="Fatura">{node}</MobileFilterField> : node;
  };
  const renderCargo = (variant) => {
    const node = (
      <select value={f.cargo} onChange={(e) => set("cargo", e.target.value)} className={cls(variant)} data-testid="ord-cargo">
        <option value="all">Kargo: Tümü</option>
        <option value="yes">Kargolandı</option>
        <option value="no">Kargo Bekliyor</option>
      </select>
    );
    return variant === "sheet" ? <MobileFilterField label="Kargo">{node}</MobileFilterField> : node;
  };
  const renderCancel = (variant) => (
    <button
      type="button"
      onClick={() => set("cancel_request", f.cancel_request === "pending" ? "all" : "pending")}
      className={variant === "chip"
        ? mobileChipClass(f.cancel_request === "pending")
        : `px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
          f.cancel_request === "pending"
            ? "bg-amber-100 text-amber-900 border-amber-300"
            : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
        }`}
      data-testid={variant === "chip" ? "ord-cancel-request-chip-m" : "ord-cancel-request-chip"}
    >
      İptal talepleri ({counts.cancel_request || 0})
    </button>
  );
  const renderSort = (variant) => {
    const select = (
      <select value={f.sort} onChange={(e) => set("sort", e.target.value)} className={cls(variant)} data-testid="ord-sort">
        {SORT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
    if (variant === "sheet") return <MobileFilterField label="Sıralama">{select}</MobileFilterField>;
    return <div className="flex items-center gap-1 text-xs"><ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />{select}</div>;
  };
  const renderDate = (key, testId, variant) => (
    <input type="date" value={f[key]} onChange={(e) => set(key, e.target.value)} className={cls(variant)} data-testid={testId} />
  );
  const renderDates = (variant) => (variant === "sheet" ? (
    <>
      <MobileFilterField label="Başlangıç">{renderDate("from", "ord-from", "sheet")}</MobileFilterField>
      <MobileFilterField label="Bitiş">{renderDate("to", "ord-to", "sheet")}</MobileFilterField>
    </>
  ) : (
    <>
      {renderDate("from", "ord-from", "inline")}
      <span className="text-slate-400">–</span>
      {renderDate("to", "ord-to", "inline")}
    </>
  ));
  const renderPageSize = (variant) => {
    const select = (
      <select
        value={pageSize}
        onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
        className={cls(variant)}
        data-testid="ord-page-size"
      >
        {(pageSizeOptions || ORDER_PAGE_SIZES).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    );
    if (variant === "sheet") return <MobileFilterField label="Sayfa">{select}</MobileFilterField>;
    return (
      <label className="inline-flex items-center gap-1.5 text-slate-600">
        <span className="font-semibold text-slate-500">Sayfa</span>
        {select}
      </label>
    );
  };
  const renderRefresh = (variant) => (onRefresh ? (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshBusy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      data-testid={variant === "mobile" ? "ord-refresh-btn-m" : "ord-refresh-btn"}
      title="Pazaryerinden sipariş çek (nav/F5 çekmez; otomatik 10 dk + bu buton)"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${refreshBusy ? "animate-spin" : ""}`} />
      {refreshBusy ? "Çekiliyor…" : "Yenile"}
    </button>
  ) : null);
  const renderSummary = (variant) => (
    <div className="ml-auto flex items-center gap-3 text-slate-500">
      {onBulkAction && <OrdersBulkMenu selectedCount={selectedCount} busy={bulkBusy} onAction={onBulkAction} testidSuffix={variant === "mobile" ? "-m" : ""} />}
      <ExportButtons rows={rows} loadRows={loadExportRows} columns={ORD_COLS} filename="siparisler" title="Sipariş Listesi" testidSuffix={variant === "mobile" ? "-m" : ""} />
      <div data-testid={variant === "mobile" ? "ord-result-summary-m" : "ord-result-summary"}><b className="text-slate-900">{count}</b>{showTotal === false ? " sipariş" : " sipariş · Toplam "}{showTotal === false ? null : <b className="text-slate-900">{formatTrAmount(total)} ₺</b>}</div>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3" data-testid="orders-toolbar">
      <div data-layout="desktop" className="hidden sm:flex flex-wrap items-center gap-2">
        {renderSearch("inline")}
        {renderStatus("inline")}
        {renderChannel("inline")}
        {renderDocStatus("inline")}
        {renderInvoiced("inline")}
        {renderCargo("inline")}
        {renderCancel("inline")}
        {renderSort("inline")}
      </div>
      <div data-layout="desktop" className="hidden sm:flex flex-wrap items-center gap-2 text-xs sm:mt-2">
        {renderDates("inline")}
        {active > 0 && <button onClick={clearFilters} className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100" data-testid="ord-filters-clear">Filtreleri temizle ({active})</button>}
        {renderPageSize("inline")}
        {renderRefresh("inline")}
        {renderSummary("inline")}
      </div>
      <div data-layout="mobile" className="sm:hidden space-y-2">
        <div className="flex items-center gap-2">
          {renderSearch("mobile")}
          <MobileFilterSheet activeCount={active} onClear={clearFilters}>
            {renderStatus("sheet")}
            {renderChannel("sheet")}
            {renderDocStatus("sheet")}
            {renderInvoiced("sheet")}
            {renderCargo("sheet")}
            {renderSort("sheet")}
            {renderDates("sheet")}
            {renderPageSize("sheet")}
          </MobileFilterSheet>
        </div>
        <div className={mobileChipRowClass}>
          {renderCancel("chip")}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {renderRefresh("mobile")}
          {renderSummary("mobile")}
        </div>
      </div>
    </div>
  );
};
