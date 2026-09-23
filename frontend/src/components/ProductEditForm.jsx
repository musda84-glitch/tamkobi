import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, Loader2, RefreshCw, Package } from "lucide-react";
import { ScanButton } from "./CameraScanner";
import { API_URL } from "../context/AuthContext";
import { confirmGenerateBarcode } from "../utils/barcodeFormat";
import { CURRENCIES, fmtMoney, moneySuffix } from "../utils/money";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const F = ({ label, children }) => <div><label className="block font-semibold text-slate-700 mb-1">{label}</label>{children}</div>;

const pkgNum = (v) => (v === "" || v == null ? "" : v);

export const ProductEditForm = ({ product, onUpdated, onSaved }) => {
  const companyId = product.company_id || product.companyId;
  const unitsListId = `product-units-list-${product.id || product._id || "edit"}`;
  const [f, setF] = useState({
    name: product.name, sku: product.sku, barcode: product.barcode, category: product.category, unit: product.unit,
    vat_rate: product.vat_rate, purchase_price: product.purchase_price, sale_price: product.sale_price,
    currency: product.currency || "TRY",
    min_stock_alert: product.min_stock_alert, stock_quantity: product.stock_quantity, type: product.type,
    show_in_b2b: product.show_in_b2b !== false, track_stock: product.track_stock !== false, is_active: product.is_active !== false,
    track_lot: !!product.track_lot, track_serial: !!product.track_serial, track_expiry: !!product.track_expiry,
    purchase_vat_rate: product.purchase_vat_rate ?? 20, price_includes_vat: product.price_includes_vat === true,
    vat_exemption_code: product.vat_exemption_code || "", tags: product.tags || [],
    desi: pkgNum(product.desi), weight: pkgNum(product.weight), length: pkgNum(product.length),
    width: pkgNum(product.width), height: pkgNum(product.height), package_count: product.package_count || 1,
    label_template_id: product.label_template_id || "",
  });
  const ccy = f.currency || "TRY";
  const ccyLabel = moneySuffix(ccy);
  const [units, setUnits] = useState([]);
  const [labelTpls, setLabelTpls] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });

  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/products/units?company_id=${companyId}`)
      .then((r) => { if (!cancelled) setUnits(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});
    axios.get(`${API_URL}/label-templates?company_id=${companyId}`)
      .then((r) => { if (!cancelled) setLabelTpls(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [companyId]);

  const genBarcode = () => {
    if (!confirmGenerateBarcode(f.barcode)) return;
    set("barcode", "868" + String(Math.floor(Math.random() * 1e10)).padStart(10, "0"));
  };
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const n = (v) => (v === "" || v == null ? null : Number(v));
      const unit = String(f.unit || "").trim() || "Adet";
      const r = await axios.put(`${API_URL}/products/${product.id}`, {
        ...f,
        unit,
        label_template_id: f.label_template_id || null,
        vat_rate: Number(f.vat_rate), purchase_price: Number(f.purchase_price), sale_price: Number(f.sale_price),
        min_stock_alert: Number(f.min_stock_alert), stock_quantity: Number(f.stock_quantity),
        desi: n(f.desi), weight: n(f.weight), length: n(f.length), width: n(f.width), height: n(f.height),
        package_count: Math.max(1, Math.min(50, parseInt(f.package_count, 10) || 1)),
      });
      if (companyId && unit && !units.some((u) => u.name === unit)) {
        await axios.post(`${API_URL}/products/units`, { company_id: companyId, name: unit }).catch(() => {});
        setUnits((prev) => (prev.some((u) => u.name === unit) ? prev : [...prev, { name: unit, count: 0 }]));
      }
      onUpdated(r.data); toast.success("Stok kartı güncellendi."); onSaved?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  const calcDesi = () => {
    const L = Number(f.length); const W = Number(f.width); const H = Number(f.height);
    if (L > 0 && W > 0 && H > 0) set("desi", String(Math.round((L * W * H) / 3000 * 100) / 100));
  };
  return (
    <form onSubmit={save} className="space-y-3 text-xs" data-testid="product-edit-form">
      <datalist id={unitsListId}>{units.map((u) => <option key={u.name} value={u.name} />)}</datalist>
      <F label="Ürün Adı"><input value={f.name} onChange={(e) => set("name", e.target.value)} className={`${inputCls} font-semibold`} required data-testid="edit-name-input" /></F>
      <div className="grid grid-cols-2 gap-2">
        <F label="SKU"><input value={f.sku} onChange={(e) => set("sku", e.target.value)} className={`${inputCls} font-mono`} data-testid="edit-sku-input" /></F>
        <F label="Barkod (EAN-13)"><div className="flex gap-1"><input value={f.barcode} onChange={(e) => set("barcode", e.target.value)} className={`${inputCls} font-mono`} data-testid="edit-barcode-input" /><button type="button" onClick={genBarcode} className="px-2 border rounded-lg hover:bg-slate-50" title="Yeni barkod üret" data-testid="regen-barcode-btn"><RefreshCw className="w-3.5 h-3.5" /></button><ScanButton size="sm" onScan={(code) => set("barcode", code)} title="Ürün barkodunu kamerayla okut" /></div></F>
      </div>
      <F label="Etiket tasarımı">
        <select
          value={f.label_template_id || ""}
          onChange={(e) => set("label_template_id", e.target.value)}
          className={inputCls}
          data-testid="edit-label-template-select"
        >
          <option value="">— Firma varsayılanı / hazır şablon —</option>
          {labelTpls.map((t) => (
            <option key={t.id} value={t.id}>
              {t.is_default ? "★ " : ""}{t.name} ({t.width_mm}×{t.height_mm} mm)
            </option>
          ))}
        </select>
        <p className="text-[10px] text-slate-400 mt-0.5">
          Barkod / etiket yazdırmada bu şablon kullanılır. Şablon yoksa Stok → Etiket Tasarımı sekmesinden kaydedin.
        </p>
      </F>
      <div className="grid grid-cols-3 gap-2">
        <F label="Kategori"><input list="product-categories-list" value={f.category} onChange={(e) => set("category", e.target.value)} className={inputCls} data-testid="edit-category-input" /></F>
        <F label="Tür"><select value={f.type} onChange={(e) => set("type", e.target.value)} className={inputCls}><option value="product">Ticari Mal</option><option value="raw_material">Hammadde</option><option value="finished_good">Mamul</option><option value="service">Hizmet</option></select></F>
        <F label="Birim">
          <input
            list={unitsListId}
            value={f.unit}
            onChange={(e) => set("unit", e.target.value)}
            className={inputCls}
            placeholder="Adet, Kg…"
            data-testid="edit-unit-input"
          />
          <p className="text-[10px] text-slate-400 mt-0.5">Firma ayarlarındaki birimler; yeni yazılan kayıt edilir.</p>
        </F>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <F label={`Alış (${ccyLabel})`}><input type="number" step="0.01" value={f.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} className={inputCls} data-testid="edit-purchase-price" /></F>
        <F label={`Satış (${ccyLabel})`}><input type="number" step="0.01" value={f.sale_price} onChange={(e) => set("sale_price", e.target.value)} className={`${inputCls} font-bold`} data-testid="edit-price-input" /></F>
        <F label="Para Birimi">
          <select value={ccy} onChange={(e) => set("currency", e.target.value)} className={inputCls} data-testid="edit-currency-select">
            {CURRENCIES.map((c) => <option key={c} value={c}>{moneySuffix(c)} · {c}</option>)}
          </select>
        </F>
        <F label="Kritik Stok"><input type="number" value={f.min_stock_alert} onChange={(e) => set("min_stock_alert", e.target.value)} className={inputCls} /></F>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2" data-testid="vat-details">
        <div className="font-bold text-slate-700">KDV Detayları</div>
        <div className="grid grid-cols-3 gap-2">
          <F label="Satış KDV %"><select value={f.vat_rate} onChange={(e) => set("vat_rate", e.target.value)} className={inputCls}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select></F>
          <F label="Alış KDV %"><select value={f.purchase_vat_rate} onChange={(e) => set("purchase_vat_rate", e.target.value)} className={inputCls} data-testid="edit-purchase-vat-select">{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select></F>
          <F label="KDV İstisna Kodu"><input value={f.vat_exemption_code} onChange={(e) => set("vat_exemption_code", e.target.value)} placeholder="Örn: 301, 350" className={inputCls} /></F>
        </div>
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={f.price_includes_vat} onChange={(e) => set("price_includes_vat", e.target.checked)} data-testid="edit-vat-included-checkbox" /><span className="font-semibold">Satış fiyatı KDV dahil</span></label>
        <div className="text-[11px] text-slate-500">KDV'siz satış: <b>{fmtMoney((f.price_includes_vat ? Number(f.sale_price) / (1 + Number(f.vat_rate) / 100) : Number(f.sale_price)), ccy)}</b> • KDV dahil: <b>{fmtMoney((f.price_includes_vat ? Number(f.sale_price) : Number(f.sale_price) * (1 + Number(f.vat_rate) / 100)), ccy)}</b></div>
      </div>

      <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3 space-y-2" data-testid="product-package-fields">
        <div className="font-bold text-slate-800 flex items-center gap-1.5"><Package className="w-3.5 h-3.5 text-indigo-600" /> Paket bilgisi (kargo)</div>
        <p className="text-[10px] text-slate-500">Kargo oluştururken bu değerler otomatik doldurulur. Desi ≈ (en × boy × yükseklik) / 3000.</p>
        <div className="grid grid-cols-3 gap-2">
          <F label="Paket sayısı"><input type="number" min={1} max={50} step={1} value={f.package_count} onChange={(e) => set("package_count", e.target.value)} className={inputCls} data-testid="edit-package-count" /></F>
          <F label="Desi"><input type="number" min={0} step={0.1} value={f.desi} onChange={(e) => set("desi", e.target.value)} placeholder="örn. 1.5" className={inputCls} data-testid="edit-desi" /></F>
          <F label="Ağırlık kg"><input type="number" min={0} step={0.1} value={f.weight} onChange={(e) => set("weight", e.target.value)} className={inputCls} data-testid="edit-weight" /></F>
          <F label="En cm"><input type="number" min={0} step={0.1} value={f.length} onChange={(e) => set("length", e.target.value)} onBlur={calcDesi} className={inputCls} data-testid="edit-length" /></F>
          <F label="Boy cm"><input type="number" min={0} step={0.1} value={f.width} onChange={(e) => set("width", e.target.value)} onBlur={calcDesi} className={inputCls} data-testid="edit-width" /></F>
          <F label="Yükseklik cm"><input type="number" min={0} step={0.1} value={f.height} onChange={(e) => set("height", e.target.value)} onBlur={calcDesi} className={inputCls} data-testid="edit-height" /></F>
        </div>
      </div>

      <F label="Etiketler">
        <div className="flex flex-wrap gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="tags-editor">
          {f.tags.map((t) => <span key={t} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md px-2 py-0.5 text-[11px] font-semibold">{t}<button type="button" onClick={() => set("tags", f.tags.filter((x) => x !== t))} className="text-indigo-400 hover:text-rose-600">×</button></span>)}
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); const t = tagInput.trim(); if (t && !f.tags.includes(t)) set("tags", [...f.tags, t]); setTagInput(""); } }} placeholder="Etiket yaz + Enter" className="flex-1 min-w-[120px] bg-transparent outline-none" data-testid="tag-input" />
        </div>
      </F>
      {!product.has_variants && <F label="Mevcut Stok (düzeltme)"><input type="number" step="0.01" value={f.stock_quantity} onChange={(e) => set("stock_quantity", e.target.value)} className={`${inputCls} font-bold`} data-testid="edit-stock-input" /></F>}
      <div className="grid grid-cols-3 gap-2">
        {[["show_in_b2b", "B2B'de göster"], ["track_stock", "Stok takibi"], ["is_active", "Aktif"], ["track_lot", "Lot / parti"], ["track_serial", "Seri no"], ["track_expiry", "SKT / üretim"]].map(([k, l]) => <label key={k} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer"><input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`edit-${k}-checkbox`} /><span className="font-semibold">{l}</span></label>)}
      </div>
      <div className="flex justify-end pt-2 border-t"><button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60" data-testid="save-product-edit-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
    </form>
  );
};
