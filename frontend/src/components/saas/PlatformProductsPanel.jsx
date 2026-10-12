import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const cred = { withCredentials: true };

export const PlatformProductsPanel = () => {
  const [products, setProducts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", kind: "other", base_url: "", status: "active" });

  const load = useCallback(() => {
    axios
      .get(`${API_URL}/platform/admin/products`, cred)
      .then((r) => setProducts(r.data.products || []))
      .catch((e) => toast.error(e.response?.data?.detail || "Ürünler alınamadı."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!products) return <div className="text-xs text-slate-400">Yükleniyor…</div>;

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API_URL}/platform/admin/products`, form, cred);
      toast.success("Ürün eklendi.");
      setForm({ code: "", name: "", kind: "other", base_url: "", status: "active" });
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  };

  const del = async (p) => {
    if (p.code === "tamkobi") {
      toast.error("tamkobi silinemez.");
      return;
    }
    if (!window.confirm(`${p.name} silinsin mi?`)) return;
    try {
      await axios.delete(`${API_URL}/platform/admin/products/${p.id || p._id}`, cred);
      toast.success("Silindi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  return (
    <div className="space-y-4 text-xs" data-testid="platform-products">
      <form onSubmit={create} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="platform-product-create">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Plus className="w-4 h-4 text-amber-500" /> Yeni ürün
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Kod</label>
            <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputCls} data-testid="pp-code" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Ad</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} data-testid="pp-name" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Tür</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputCls} data-testid="pp-kind">
              <option value="erp">erp</option>
              <option value="ecommerce">ecommerce</option>
              <option value="other">other</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Base URL</label>
            <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} className={inputCls} data-testid="pp-base" />
          </div>
        </div>
        <button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="pp-create-submit">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />} Oluştur
        </button>
      </form>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[640px]" data-testid="platform-products-table">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Kod</th>
              <th className="px-3 py-2.5 text-left">Ad</th>
              <th className="px-3 py-2.5 text-left">Tür</th>
              <th className="px-3 py-2.5 text-left">Durum</th>
              <th className="px-3 py-2.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((p) => (
              <tr key={p.id || p._id} data-testid={`pp-row-${p.code}`}>
                <td className="px-3 py-2 font-mono font-semibold">{p.code}</td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">{p.kind}</td>
                <td className="px-3 py-2">{p.status}</td>
                <td className="px-3 py-2 text-right">
                  {p.code !== "tamkobi" && (
                    <button type="button" onClick={() => del(p)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg" data-testid={`pp-del-${p.code}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
