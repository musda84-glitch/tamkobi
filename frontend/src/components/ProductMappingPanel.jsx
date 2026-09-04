import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link2, Trash2, Plus, AlertTriangle } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { SearchSelect } from "./SearchSelect";

export const ProductMappingPanel = ({ companyId }) => {
  const [maps, setMaps] = useState([]); const [unmapped, setUnmapped] = useState([]); const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ channel: "trendyol", marketplace_sku: "", product_id: "" });
  const load = useCallback(async () => { const [m, u, p] = await Promise.all([axios.get(`${API_URL}/integrations/ecommerce/mappings?company_id=${companyId}`), axios.get(`${API_URL}/integrations/ecommerce/unmapped?company_id=${companyId}`), axios.get(`${API_URL}/products?company_id=${companyId}`)]); setMaps(m.data); setUnmapped(u.data); setProducts(p.data); }, [companyId]);
  useEffect(() => { load().catch(() => toast.error("Eşleştirmeler yüklenemedi.")); }, [load]);
  const save = async (e) => { e.preventDefault(); try { await axios.post(`${API_URL}/integrations/ecommerce/mappings`, { company_id: companyId, ...form }); toast.success("Ürün eşleştirildi."); setForm({ ...form, marketplace_sku: "", product_id: "" }); load(); } catch (err) { toast.error(err.response?.data?.detail || "Eşleştirilemedi."); } };
  const del = async (id) => { await axios.delete(`${API_URL}/integrations/ecommerce/mappings/${id}`); load(); };
  return (
    <div className="space-y-4 text-xs" data-testid="product-mapping-panel">
      <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <div><label className="block font-semibold mb-1">Pazaryeri</label><select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="map-channel-select">{["trendyol", "hepsiburada", "n11", "amazon", "ciceksepeti", "shopify", "woocommerce"].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label className="block font-semibold mb-1">Pazaryeri SKU / Barkod</label><input value={form.marketplace_sku} onChange={(e) => setForm({ ...form, marketplace_sku: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2 font-mono" required data-testid="map-sku-input" /></div>
        <div><label className="block font-semibold mb-1">Stok Kartı</label><SearchSelect value={form.product_id} options={products} placeholder="Ürün ara..." getLabel={(p) => p.name} getSub={(p) => p.sku} getImage={(p) => p.image_url} onChange={(id) => setForm({ ...form, product_id: id })} testId="map-product" /></div>
        <button type="submit" className="flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="map-save-btn"><Plus className="w-4 h-4" /> Eşleştir</button>
      </form>
      {unmapped.length > 0 && <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4" data-testid="unmapped-list"><div className="font-bold text-amber-800 flex items-center gap-1 mb-2"><AlertTriangle className="w-4 h-4" /> Eşleşmemiş pazaryeri ürünleri ({unmapped.length})</div><div className="flex flex-wrap gap-1.5">{unmapped.map((u, i) => <button key={i} onClick={() => setForm({ ...form, channel: u.channel, marketplace_sku: u.marketplace_sku })} className="bg-white border border-amber-200 rounded-lg px-2 py-1 hover:border-emerald-500" data-testid={`unmapped-${i}`}><b className="uppercase text-[10px] text-slate-500">{u.channel}</b> {u.marketplace_sku} <span className="text-slate-500">• {u.product_name}</span></button>)}</div></div>}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden"><table className="w-full text-left"><thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold"><tr><th className="px-4 py-2">Pazaryeri</th><th className="px-4 py-2">Pazaryeri SKU</th><th className="px-4 py-2">Stok Kartı</th><th className="px-4 py-2">Senk.</th><th className="px-4 py-2"></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{maps.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Henüz eşleştirme yok.</td></tr>}{maps.map((m) => <tr key={m.id} data-testid={`mapping-row-${m.id}`}><td className="px-4 py-2 uppercase font-bold text-slate-600">{m.channel}</td><td className="px-4 py-2 font-mono">{m.marketplace_sku}</td><td className="px-4 py-2"><div className="font-semibold flex items-center gap-1"><Link2 className="w-3 h-3 text-emerald-600" /> {m.product_name}</div><div className="font-mono text-slate-400">{m.sku}</div></td><td className="px-4 py-2 text-slate-500">{m.sync_stock && "Stok"} {m.sync_price && "• Fiyat"}</td><td className="px-4 py-2 text-right"><button onClick={() => del(m.id)} className="text-slate-300 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button></td></tr>)}</tbody></table></div>
    </div>
  );
};
