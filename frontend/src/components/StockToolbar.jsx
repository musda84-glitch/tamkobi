import React from "react";
import { Search, Tag, PackageCheck, ArrowUpDown, X, Globe } from "lucide-react";
import { ExportButtons } from "./ExportButtons";

const STOCK_COLS = [{ key: "sku", label: "SKU" }, { key: "barcode", label: "Barkod" }, { key: "name", label: "Ürün" }, { key: "category", label: "Kategori" }, { key: "unit", label: "Birim" }, { key: "stock_quantity", label: "Stok", num: true }, { key: "min_stock_alert", label: "Min. Stok", num: true }, { key: "purchase_price", label: "Alış Fiyatı", num: true }, { key: "sale_price", label: "Satış Fiyatı", num: true }, { key: "vat_rate", label: "KDV %" }, { label: "Stok Değeri", value: (r) => (r.stock_quantity || 0) * (r.purchase_price || 0), num: true }];

export const STOCK_FILTER_DEFAULTS = { status: "all", b2b: "all", sort: "name_asc" };
const STATUS = [["all", "Tüm Stok Durumları"], ["critical", "Kritik Stok (min. altı)"], ["out", "Stokta Yok"], ["in", "Stokta Var"], ["untracked", "Stok Takibi Yok (Hizmet)"]];
const B2B = [["all", "B2B: Tümü"], ["yes", "B2B'de Görünür"], ["no", "B2B'de Gizli"]];
const SORT = [["name_asc", "Ad (A → Z)"], ["name_desc", "Ad (Z → A)"], ["stock_asc", "Stok (azdan çoğa)"], ["stock_desc", "Stok (çoktan aza)"], ["price_desc", "Satış Fiyatı (yüksek)"], ["price_asc", "Satış Fiyatı (düşük)"], ["value_desc", "Stok Değeri (yüksek)"], ["newest", "En Yeni"]];

export const applyStockFilters = (products, f) => {
  const list = products.filter((p) => {
    const tracked = p.track_stock !== false;
    if (f.status === "critical" && !(tracked && p.stock_quantity <= (p.min_stock_alert ?? 0))) return false;
    if (f.status === "out" && !(tracked && (p.stock_quantity || 0) <= 0)) return false;
    if (f.status === "in" && !(tracked && (p.stock_quantity || 0) > 0)) return false;
    if (f.status === "untracked" && tracked) return false;
    if (f.b2b === "yes" && !p.show_in_b2b) return false;
    if (f.b2b === "no" && p.show_in_b2b) return false;
    return true;
  });
  const val = (p) => (p.stock_quantity || 0) * (p.purchase_price || 0);
  const cmp = { name_asc: (a, b) => a.name.localeCompare(b.name, "tr"), name_desc: (a, b) => b.name.localeCompare(a.name, "tr"), stock_asc: (a, b) => (a.stock_quantity || 0) - (b.stock_quantity || 0), stock_desc: (a, b) => (b.stock_quantity || 0) - (a.stock_quantity || 0),
    price_desc: (a, b) => (b.sale_price || 0) - (a.sale_price || 0), price_asc: (a, b) => (a.sale_price || 0) - (b.sale_price || 0), value_desc: (a, b) => val(b) - val(a), newest: (a, b) => (b.created_at || "").localeCompare(a.created_at || "") }[f.sort];
  return cmp ? [...list].sort(cmp) : list;
};

export const StockToolbar = ({ categories, filterCategory, setFilterCategory, f, setF, search, setSearch, count, stockValue, criticalCount, rows = [] }) => {
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const sel = "bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none";
  const active = (filterCategory !== "all" ? 1 : 0) + (f.status !== "all" ? 1 : 0) + (f.b2b !== "all" ? 1 : 0) + (search ? 1 : 0);
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3 space-y-2" data-testid="stock-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="text" placeholder="Ürün adı, SKU veya barkod ile ara…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" data-testid="stock-search-input" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" data-testid="stock-search-clear"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <div className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-slate-400" />
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={`${sel} ${filterCategory !== "all" ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" : ""}`} data-testid="stock-category-select">
            <option value="all">Tüm Kategoriler</option>
            {categories.map((c) => <option key={c.name} value={c.name} data-testid={`stock-filter-${c.name}`}>{`${c.name}${c.count !== undefined ? ` (${c.count})` : ""}`}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-slate-400" />
          <select value={f.status} onChange={(e) => set("status", e.target.value)} className={`${sel} ${f.status === "critical" || f.status === "out" ? "border-rose-300 bg-rose-50 text-rose-700 font-semibold" : f.status !== "all" ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" : ""}`} data-testid="stock-status-select">
            {STATUS.map(([k, l]) => <option key={k} value={k}>{`${l}${k === "critical" && criticalCount ? ` (${criticalCount})` : ""}`}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-slate-400" />
          <select value={f.b2b} onChange={(e) => set("b2b", e.target.value)} className={`${sel} ${f.b2b !== "all" ? "border-sky-300 bg-sky-50 text-sky-800 font-semibold" : ""}`} data-testid="stock-b2b-select">{B2B.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        <div className="flex items-center gap-1.5"><ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
          <select value={f.sort} onChange={(e) => set("sort", e.target.value)} className={sel} data-testid="stock-sort-select">{SORT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {active > 0 && <button onClick={() => { setFilterCategory("all"); setSearch(""); setF(STOCK_FILTER_DEFAULTS); }} className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100" data-testid="stock-filters-clear">Filtreleri temizle ({active})</button>}
        <div className="ml-auto flex items-center gap-3 text-slate-500"><ExportButtons rows={rows} columns={STOCK_COLS} filename="stok" title="Stok Listesi" /><div data-testid="stock-result-summary"><b className="text-slate-900">{count}</b> ürün · Stok değeri (alış) <b className="text-slate-900">{stockValue.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</b>{criticalCount > 0 && <> · <button onClick={() => set("status", "critical")} className="text-rose-600 font-semibold hover:underline" data-testid="stock-critical-link">{criticalCount} kritik</button></>}</div></div>
      </div>
    </div>
  );
};
