
import React from "react";
import { Search, Tag, PackageCheck, ArrowUpDown, X, Globe, ShoppingCart } from "lucide-react";
import { ExportButtons } from "./ExportButtons";
import { fmtMoney } from "../utils/money";
import { MobileFilterField, MobileFilterSheet, mobileFilterFieldClass } from "./MobileFilterSheet";

const STOCK_COLS = [{ key: "sku", label: "SKU" }, { key: "barcode", label: "Barkod" }, { key: "name", label: "Ürün" }, { key: "category", label: "Kategori" }, { key: "unit", label: "Birim" }, { key: "stock_quantity", label: "Stok", num: true }, { key: "min_stock_alert", label: "Min. Stok", num: true }, { key: "purchase_price", label: "Alış Fiyatı", num: true }, { key: "sale_price", label: "Satış Fiyatı", num: true }, { key: "vat_rate", label: "KDV %" }, { label: "Stok Değeri", value: (r) => (r.stock_quantity || 0) * (r.purchase_price || 0), num: true }];

export const STOCK_FILTER_DEFAULTS = { status: "all", b2b: "all", sort: "name_asc" };
const STATUS = [["all", "Tüm Stok Durumları"], ["critical", "Kritik Stok (min. altı)"], ["out", "Stokta Yok"], ["in", "Stokta Var"], ["untracked", "Stok Takibi Yok (Hizmet)"]];

/** Min stok boşsa panel istatistiğiyle aynı eşik (5). Bilinçli 0 olduğu gibi kalır. */
export function stockAlertMin(p) {
  const m = p?.min_stock_alert;
  if (m === null || m === undefined || m === "") return 5;
  const n = Number(m);
  return Number.isFinite(n) ? n : 5;
}

export function isCriticalStock(p) {
  return p?.track_stock !== false && Number(p?.stock_quantity || 0) <= stockAlertMin(p);
}

/** Mevcut stok hücresi: takip kapalı olsa da adet (+ birim) gösterilir. */
export function stockQuantityLabel(p) {
  const qty = Number(p?.stock_quantity);
  const n = Number.isFinite(qty) ? qty : 0;
  const unit = String(p?.unit || "").trim();
  return unit ? `${n} ${unit}` : String(n);
}

export function isStockUntracked(p) {
  return p?.track_stock === false;
}

export function stockFiltersFromSearch(params) {
  const status = params?.get?.("status") || "";
  const next = { ...STOCK_FILTER_DEFAULTS };
  if (STATUS.some(([k]) => k === status)) next.status = status;
  return next;
}
const B2B = [["all", "B2B: Tümü"], ["yes", "B2B'de Görünür"], ["no", "B2B'de Gizli"]];
const SORT = [["name_asc", "Ad (A → Z)"], ["name_desc", "Ad (Z → A)"], ["stock_asc", "Stok (azdan çoğa)"], ["stock_desc", "Stok (çoktan aza)"], ["price_desc", "Satış Fiyatı (yüksek)"], ["price_asc", "Satış Fiyatı (düşük)"], ["value_desc", "Stok Değeri (yüksek)"], ["newest", "En Yeni"]];

export const applyStockFilters = (products, f) => {
  const list = products.filter((p) => {
    const tracked = p.track_stock !== false;
    if (f.status === "critical" && !isCriticalStock(p)) return false;
    if (f.status === "out" && !(tracked && (p.stock_quantity || 0) <= 0)) return false;
    if (f.status === "in" && !(tracked && (p.stock_quantity || 0) > 0)) return false;
    if (f.status === "untracked" && tracked) return false;
    // Toggle UI treats undefined as open (`!== false`); keep filter in sync.
    if (f.b2b === "yes" && p.show_in_b2b === false) return false;
    if (f.b2b === "no" && p.show_in_b2b !== false) return false;
    return true;
  });
  const val = (p) => (p.stock_quantity || 0) * (p.purchase_price || 0);
  const cmp = { name_asc: (a, b) => a.name.localeCompare(b.name, "tr"), name_desc: (a, b) => b.name.localeCompare(a.name, "tr"), stock_asc: (a, b) => (a.stock_quantity || 0) - (b.stock_quantity || 0), stock_desc: (a, b) => (b.stock_quantity || 0) - (a.stock_quantity || 0),
    price_desc: (a, b) => (b.sale_price || 0) - (a.sale_price || 0), price_asc: (a, b) => (a.sale_price || 0) - (b.sale_price || 0), value_desc: (a, b) => val(b) - val(a), newest: (a, b) => (b.created_at || "").localeCompare(a.created_at || "") }[f.sort];
  return cmp ? [...list].sort(cmp) : list;
};

export const StockToolbar = ({
  categories, filterCategory, setFilterCategory, f, setF, search, setSearch, count, stockValue, criticalCount, rows = [], onReorderCritical,
  paging = false, zeroCount, negativeCount, quantityTotal, loadRows,
  brand = "all", setBrand, brands = [],
  warehouseId = "all", setWarehouseId, warehouses = [],
  cardStatus = "all", setCardStatus,
}) => {
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const sel = "bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none";
  const statuses = paging ? [...STATUS, ["zero", "Stok Sıfır"], ["negative", "Eksi Stok"]] : STATUS;
  const brandOptions = !brand || brand === "all" || brands.includes(brand) ? brands : [brand, ...brands];
  const active = (filterCategory !== "all" ? 1 : 0) + (f.status !== "all" ? 1 : 0) + (f.b2b !== "all" ? 1 : 0) + (search ? 1 : 0)
    + (paging && brand && brand !== "all" ? 1 : 0)
    + (paging && warehouseId && warehouseId !== "all" ? 1 : 0)
    + (paging && cardStatus && cardStatus !== "all" ? 1 : 0);
  const cls = (variant, extra = "") => (
    variant === "sheet"
      ? (extra ? `${mobileFilterFieldClass} ${extra}` : mobileFilterFieldClass)
      : (extra ? `${sel} ${extra}` : sel)
  );
  const clearFilters = () => {
    setFilterCategory("all");
    setSearch("");
    setF(STOCK_FILTER_DEFAULTS);
    setBrand?.("all");
    setWarehouseId?.("all");
    setCardStatus?.("all");
  };
  const statusExtra = f.status === "critical" || f.status === "out" || f.status === "negative" || f.status === "zero"
    ? "border-rose-300 bg-rose-50 text-rose-700 font-semibold"
    : f.status !== "all" ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" : "";
  const renderSearch = (variant) => (
    <div className={variant === "mobile" ? "relative flex-1 min-w-0" : "relative flex-1 min-w-[240px]"}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        type="text"
        placeholder="Ürün adı, SKU veya barkod ile ara…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={variant === "mobile"
          ? "w-full min-w-0 h-11 pl-9 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
          : "w-full min-w-[240px] pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"}
        data-testid="stock-search-input"
      />
      {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" data-testid="stock-search-clear"><X className="w-3.5 h-3.5" /></button>}
    </div>
  );
  const renderCategory = (variant) => {
    const select = (
      <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={cls(variant, filterCategory !== "all" ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" : "")} data-testid="stock-category-select">
        <option value="all">Tüm Kategoriler</option>
        {categories.map((c) => <option key={c.name} value={c.name} data-testid={`stock-filter-${c.name}`}>{`${c.name}${c.count !== undefined ? ` (${c.count})` : ""}`}</option>)}
      </select>
    );
    if (variant === "sheet") return <MobileFilterField label="Kategori">{select}</MobileFilterField>;
    return <div className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-slate-400" />{select}</div>;
  };
  const renderStatus = (variant) => {
    const select = (
      <select value={f.status} onChange={(e) => set("status", e.target.value)} className={cls(variant, statusExtra)} data-testid="stock-status-select">
        {statuses.map(([k, l]) => <option key={k} value={k}>{`${l}${k === "critical" && criticalCount ? ` (${criticalCount})` : ""}${k === "zero" && zeroCount ? ` (${zeroCount})` : ""}${k === "negative" && negativeCount ? ` (${negativeCount})` : ""}`}</option>)}
      </select>
    );
    if (variant === "sheet") return <MobileFilterField label="Stok durumu">{select}</MobileFilterField>;
    return <div className="flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-slate-400" />{select}</div>;
  };
  const renderB2b = (variant) => {
    const select = (
      <select value={f.b2b} onChange={(e) => set("b2b", e.target.value)} className={cls(variant, f.b2b !== "all" ? "border-sky-300 bg-sky-50 text-sky-800 font-semibold" : "")} data-testid="stock-b2b-select">
        {B2B.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
    if (variant === "sheet") return <MobileFilterField label="B2B">{select}</MobileFilterField>;
    return <div className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-slate-400" />{select}</div>;
  };
  const renderSort = (variant) => {
    const select = (
      <select value={f.sort} onChange={(e) => set("sort", e.target.value)} className={cls(variant)} data-testid="stock-sort-select">
        {SORT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
    if (variant === "sheet") return <MobileFilterField label="Sıralama">{select}</MobileFilterField>;
    return <div className="flex items-center gap-1.5"><ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />{select}</div>;
  };
  const renderBrand = (variant) => {
    if (!paging) return null;
    const select = (
      <select value={brand || "all"} onChange={(e) => setBrand?.(e.target.value)} className={cls(variant, brand && brand !== "all" ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" : "")} data-testid="stock-brand-select">
        <option value="all">Tüm Markalar</option>
        {brandOptions.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    );
    return variant === "sheet" ? <MobileFilterField label="Marka">{select}</MobileFilterField> : select;
  };
  const renderWarehouse = (variant) => {
    if (!paging) return null;
    const select = (
      <select value={warehouseId || "all"} onChange={(e) => setWarehouseId?.(e.target.value)} className={cls(variant, warehouseId && warehouseId !== "all" ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" : "")} data-testid="stock-warehouse-select">
        <option value="all">Tüm Depolar</option>
        {warehouses.map((w) => {
          const id = w.id || w._id;
          return <option key={id} value={id}>{w.name || w.code || id}</option>;
        })}
      </select>
    );
    return variant === "sheet" ? <MobileFilterField label="Depo">{select}</MobileFilterField> : select;
  };
  const renderCardStatus = (variant) => {
    if (!paging) return null;
    const select = (
      <select value={cardStatus || "all"} onChange={(e) => setCardStatus?.(e.target.value)} className={cls(variant, cardStatus && cardStatus !== "all" ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" : "")} data-testid="stock-active-select">
        <option value="all">Kart: Tümü</option>
        <option value="active">Aktif</option>
        <option value="inactive">Pasif</option>
      </select>
    );
    return variant === "sheet" ? <MobileFilterField label="Kart durumu">{select}</MobileFilterField> : select;
  };
  const renderActions = () => (
    <>
      {criticalCount > 0 && onReorderCritical && (
        <button type="button" onClick={onReorderCritical} className="px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-900 font-semibold border border-amber-200 hover:bg-amber-100 flex items-center gap-1" data-testid="stock-reorder-btn">
          <ShoppingCart className="w-3.5 h-3.5" /> Kritik stok siparişi ({criticalCount})
        </button>
      )}
      <div className="ml-auto flex items-center gap-3 text-slate-500">
        <ExportButtons rows={rows} columns={STOCK_COLS} filename="stok" title="Stok Listesi" loadRows={loadRows} />
        <div data-testid="stock-result-summary"><b className="text-slate-900">{count}</b> ürün{quantityTotal != null && <> · <b className="text-slate-900">{quantityTotal}</b> adet</>} · Stok değeri (alış) <b className="text-slate-900">{fmtMoney(stockValue, "TRY")}</b>{criticalCount > 0 && <> · <button onClick={() => set("status", "critical")} className="text-rose-600 font-semibold hover:underline" data-testid="stock-critical-link">{criticalCount} kritik</button></>}{zeroCount > 0 && <> · <button onClick={() => set("status", "zero")} className="text-rose-600 font-semibold hover:underline" data-testid="stock-zero-link">{zeroCount} sıfır</button></>}{negativeCount > 0 && <> · <button onClick={() => set("status", "negative")} className="text-rose-600 font-semibold hover:underline" data-testid="stock-negative-link">{negativeCount} eksi</button></>}</div>
      </div>
    </>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3" data-testid="stock-toolbar">
      <div data-layout="desktop" className="hidden sm:flex flex-wrap items-center gap-2">
        {renderSearch("inline")}
        {renderCategory("inline")}
        {renderStatus("inline")}
        {renderB2b("inline")}
        {renderSort("inline")}
        {renderBrand("inline")}
        {renderWarehouse("inline")}
        {renderCardStatus("inline")}
      </div>
      <div data-layout="desktop" className="hidden sm:flex flex-wrap items-center gap-2 text-xs sm:mt-2">
        {active > 0 && <button onClick={clearFilters} className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100" data-testid="stock-filters-clear">Filtreleri temizle ({active})</button>}
        {renderActions()}
      </div>
      <div data-layout="mobile" className="sm:hidden space-y-2">
        <div className="flex items-center gap-2">
          {renderSearch("mobile")}
          <MobileFilterSheet activeCount={active} onClear={clearFilters}>
            {renderCategory("sheet")}
            {renderStatus("sheet")}
            {renderB2b("sheet")}
            {renderSort("sheet")}
            {renderBrand("sheet")}
            {renderWarehouse("sheet")}
            {renderCardStatus("sheet")}
          </MobileFilterSheet>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {renderActions()}
        </div>
      </div>
    </div>
  );
};
