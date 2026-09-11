
import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, Loader2, RefreshCw } from "lucide-react";
import { ScanButton } from "./CameraScanner";
import { API_URL } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const F = ({ label, children }) => <div><label className="block font-semibold text-slate-700 mb-1">{label}</label>{children}</div>;

export const ProductEditForm = ({ product, onUpdated, onSaved }) => {
  const [f, setF] = useState({ name: product.name, sku: product.sku, barcode: product.barcode, category: product.category, unit: product.unit, vat_rate: product.vat_rate, purchase_price: product.purchase_price, sale_price: product.sale_price, min_stock_alert: product.min_stock_alert, stock_quantity: product.stock_quantity, type: product.type, show_in_b2b: product.show_in_b2b !== false, track_stock: product.track_stock !== false, is_active: product.is_active !== false, purchase_vat_rate: product.purchase_vat_rate ?? 20, price_includes_vat: product.price_includes_vat === true, vat_exemption_code: product.vat_exemption_code || "", tags: product.tags || [] });
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  const genBarcode = () => set("barcode", "868" + String(Math.floor(Math.random() * 1e10)).padStart(10, "0"));
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/products/${product.id}`, { ...f, vat_rate: Number(f.vat_rate), purchase_price: Number(f.purchase_price), sale_price: Number(f.sale_price), min_stock_alert: Number(f.min_stock_alert), stock_quantity: Number(f.stock_quantity) });
      onUpdated(r.data); toast.success("Stok kartı güncellendi."); onSaved?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-3 text-xs" data-testid="product-edit-form">
      <F label="Ürün Adı"><input value={f.name} onChange={(e) => set("name", e.target.value)} className={`${inputCls} font-semibold`} required data-testid="edit-name-input" /></F>
      <div className="grid grid-cols-2 gap-2">
        <F label="SKU"><input value={f.sku} onChange={(e) => set("sku", e.target.value)} className={`${inputCls} font-mono`} data-testid="edit-sku-input" /></F>
        <F label="Barkod (EAN-13)"><div className="flex gap-1"><input value={f.barcode} onChange={(e) => set("barcode", e.target.value)} className={`${inputCls} font-mono`} data-testid="edit-barcode-input" /><button type="button" onClick={genBarcode} className="px-2 border rounded-lg hover:bg-slate-50" title="Yeni barkod üret" data-testid="regen-barcode-btn"><RefreshCw className="w-3.5 h-3.5" /></button><ScanButton size="sm" onScan={(code) => set("barcode", code)} title="Ürün barkodunu kamerayla okut" /></div></F>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <F label="Kategori"><input list="product-categories-list" value={f.category} onChange={(e) => set("category", e.target.value)} className={inputCls} data-testid="edit-category-input" /></F>
        <F label="Tür"><select value={f.type} onChange={(e) => set("type", e.target.value)} className={inputCls}><option value="product">Ticari Mal</option><option value="raw_material">Hammadde</option><option value="finished_good">Mamul</option><option value="service">Hizmet</option></select></F>
        <F label="Birim"><input list="product-units-list" value={f.unit} onChange={(e) => set("unit", e.target.value)} className={inputCls} data-testid="edit-unit-input" /></F>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <F label="Alış (₺)"><input type="number" step="0.01" value={f.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} className={inputCls} /></F>
        <F label="Satış (₺)"><input type="number" step="0.01" value={f.sale_price} onChange={(e) => set("sale_price", e.target.value)} className={`${inputCls} font-bold`} data-testid="edit-price-input" /></F>
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
        <div className="text-[11px] text-slate-500">KDV'siz satış: <b>{(f.price_includes_vat ? Number(f.sale_price) / (1 + Number(f.vat_rate) / 100) : Number(f.sale_price)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</b> • KDV dahil: <b>{(f.price_includes_vat ? Number(f.sale_price) : Number(f.sale_price) * (1 + Number(f.vat_rate) / 100)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</b></div>
      </div>
      <F label="Etiketler">
        <div className="flex flex-wrap gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="tags-editor">
          {f.tags.map((t) => <span key={t} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md px-2 py-0.5 text-[11px] font-semibold">{t}<button type="button" onClick={() => set("tags", f.tags.filter((x) => x !== t))} className="text-indigo-400 hover:text-rose-600">×</button></span>)}
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); const t = tagInput.trim(); if (t && !f.tags.includes(t)) set("tags", [...f.tags, t]); setTagInput(""); } }} placeholder="Etiket yaz + Enter" className="flex-1 min-w-[120px] bg-transparent outline-none" data-testid="tag-input" />
        </div>
      </F>
      {!product.has_variants && <F label="Mevcut Stok (düzeltme)"><input type="number" step="0.01" value={f.stock_quantity} onChange={(e) => set("stock_quantity", e.target.value)} className={`${inputCls} font-bold`} data-testid="edit-stock-input" /></F>}
      <div className="grid grid-cols-3 gap-2">
        {[["show_in_b2b", "B2B'de göster"], ["track_stock", "Stok takibi"], ["is_active", "Aktif"]].map(([k, l]) => <label key={k} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer"><input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`edit-${k}-checkbox`} /><span className="font-semibold">{l}</span></label>)}
      </div>
      <div className="flex justify-end pt-2 border-t"><button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60" data-testid="save-product-edit-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
    </form>
  );
};
