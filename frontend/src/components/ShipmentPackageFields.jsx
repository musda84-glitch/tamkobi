import React, { useMemo } from "react";
import { Package } from "lucide-react";

/** Shared package fields for all cargo carriers (Geliver, Yurtiçi, …). */
export const emptyPackageForm = () => ({
  package_count: 1,
  desi: "",
  weight: "",
  length: "",
  width: "",
  height: "",
});

const numOr0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Merge stok kartı paket alanlarını sipariş kalemine (kalemde yoksa). */
export const mergeItemPackageFromProduct = (item, product) => {
  if (!product) return item || {};
  const row = { ...(item || {}) };
  for (const k of ["desi", "weight", "length", "width", "height", "package_count"]) {
    const cur = row[k];
    if ((cur == null || cur === "" || Number(cur) === 0) && product[k] != null && product[k] !== "") {
      row[k] = product[k];
    }
  }
  return row;
};

/**
 * Sipariş + isteğe bağlı stok kartlarından paket formu varsayılanları.
 * productsById: { [productId]: product }
 */
export const packageDefaultsFromOrder = (order, productsById = null) => {
  const items = (order?.items || []).map((it) => {
    const pid = it.product_id || it.productId;
    const prod = productsById && pid ? productsById[pid] || productsById[String(pid)] : null;
    return mergeItemPackageFromProduct(it, prod);
  });
  let desi = 0;
  let weight = 0;
  let packageCount = 0;
  const dims = [];
  for (const it of items) {
    const qty = numOr0(it.quantity) || 1;
    desi += numOr0(it.desi) * qty;
    weight += numOr0(it.weight) * qty;
    const L = numOr0(it.length);
    const W = numOr0(it.width);
    const H = numOr0(it.height);
    if (L > 0 && W > 0 && H > 0) dims.push(`${L}|${W}|${H}`);
    const pc = parseInt(it.package_count, 10);
    if (pc > 0) packageCount += pc;
  }
  let length = "";
  let width = "";
  let height = "";
  // Ölçüleri yalnızca tüm kalemlerde aynı ölçü varsa doldur (karışık paketlerde boş bırak)
  if (dims.length && dims.length === items.length && new Set(dims).size === 1) {
    const [L, W, H] = dims[0].split("|");
    length = L;
    width = W;
    height = H;
  }
  return {
    package_count: packageCount > 1 ? packageCount : 1,
    desi: desi > 0 ? String(Math.round(desi * 100) / 100) : "",
    weight: weight > 0 ? String(Math.round(weight * 100) / 100) : "",
    length,
    width,
    height,
  };
};

/** Build API payload keys from form state (omit empty). */
export const packagePayload = (form) => {
  const out = {};
  const n = (v) => (v === "" || v == null ? null : Number(v));
  const pc = Math.max(1, Math.min(50, parseInt(form.package_count, 10) || 1));
  out.package_count = pc;
  const desi = n(form.desi);
  const weight = n(form.weight);
  const length = n(form.length);
  const width = n(form.width);
  const height = n(form.height);
  if (desi != null && !Number.isNaN(desi)) out.desi = desi;
  if (weight != null && !Number.isNaN(weight)) out.weight = weight;
  if (length != null && !Number.isNaN(length)) out.length = length;
  if (width != null && !Number.isNaN(width)) out.width = width;
  if (height != null && !Number.isNaN(height)) out.height = height;
  return out;
};

export const ShipmentPackageFields = ({ value, onChange, compact = false, idPrefix = "pkg", hint }) => {
  const set = (key, raw) => onChange({ ...value, [key]: raw });
  const preview = useMemo(() => {
    const pc = Math.max(1, parseInt(value.package_count, 10) || 1);
    const desi = Number(value.desi);
    const weight = Number(value.weight);
    const L = Number(value.length);
    const W = Number(value.width);
    const H = Number(value.height);
    const fromDims = L > 0 && W > 0 && H > 0 ? Math.round((L * W * H) / 3000 * 100) / 100 : null;
    const perDesi = !Number.isNaN(desi) && desi > 0 ? desi : fromDims;
    return {
      perDesi,
      totalDesi: perDesi != null ? Math.round(perDesi * pc * 100) / 100 : null,
      totalWeight: !Number.isNaN(weight) && weight > 0 ? Math.round(weight * pc * 100) / 100 : null,
    };
  }, [value]);

  const field = "w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs";
  const label = "block text-[10px] font-semibold text-slate-600 mb-0.5";

  return (
    <div className={`space-y-2 ${compact ? "" : "border border-slate-200 rounded-xl p-3 bg-slate-50/50"}`} data-testid="shipment-package-fields">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
        <Package className="w-3.5 h-3.5 text-indigo-600" />
        Paket bilgisi
        <span className="font-normal text-slate-500">(tüm kargo entegrasyonları)</span>
      </div>
      {hint && <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1" data-testid={`${idPrefix}-stock-hint`}>{hint}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div>
          <label className={label} htmlFor={`${idPrefix}-count`}>Paket sayısı</label>
          <input id={`${idPrefix}-count`} type="number" min={1} max={50} step={1} value={value.package_count} onChange={(e) => set("package_count", e.target.value)} className={field} data-testid={`${idPrefix}-count`} />
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-desi`}>Desi (paket başı)</label>
          <input id={`${idPrefix}-desi`} type="number" min={0} step={0.1} value={value.desi} onChange={(e) => set("desi", e.target.value)} placeholder="örn. 1.5" className={field} data-testid={`${idPrefix}-desi`} />
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-weight`}>Ağırlık kg</label>
          <input id={`${idPrefix}-weight`} type="number" min={0} step={0.1} value={value.weight} onChange={(e) => set("weight", e.target.value)} placeholder="boşsa ≈ desi" className={field} data-testid={`${idPrefix}-weight`} />
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-length`}>En cm</label>
          <input id={`${idPrefix}-length`} type="number" min={0} step={0.1} value={value.length} onChange={(e) => set("length", e.target.value)} className={field} data-testid={`${idPrefix}-length`} />
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-width`}>Boy cm</label>
          <input id={`${idPrefix}-width`} type="number" min={0} step={0.1} value={value.width} onChange={(e) => set("width", e.target.value)} className={field} data-testid={`${idPrefix}-width`} />
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-height`}>Yükseklik cm</label>
          <input id={`${idPrefix}-height`} type="number" min={0} step={0.1} value={value.height} onChange={(e) => set("height", e.target.value)} className={field} data-testid={`${idPrefix}-height`} />
        </div>
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Desi ≈ (en × boy × yükseklik) / 3000. Ölçü girerseniz desi hesaplanır; yalnızca desi girerseniz kübik ölçü türetilir.
        {preview.totalDesi != null && <> Toplam desi: <b>{preview.totalDesi}</b>.</>}
        {preview.totalWeight != null && <> Toplam ağırlık: <b>{preview.totalWeight} kg</b>.</>}
      </p>
    </div>
  );
};
