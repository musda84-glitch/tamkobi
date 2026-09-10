
import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../context/AuthContext";

export const ModuleCatalogPanel = ({ catalog = [], plans = [], onChanged }) => {
  const [prices, setPrices] = useState(() => Object.fromEntries((catalog || []).filter((m) => !m.is_core).map((m) => [m.key, m.price_monthly || 0])));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrices(Object.fromEntries((catalog || []).filter((m) => !m.is_core).map((m) => [m.key, m.price_monthly || 0]))); }, [catalog]);
  const save = async () => {
    setBusy(true);
    try {
      await axios.put(`${API_URL}/system/modules/prices`, { prices }, { withCredentials: true });
      toast.success("Modül fiyatları kaydedildi. Sitedeki özel paket hesabı buna göre güncellenir.");
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 text-xs" data-testid="saas-module-catalog">
      <p className="text-slate-500">Çekirdek modüller her pakette vardır. Aylık fiyat, müşterinin sitede kendi paketini oluştururken kullanılır (yıllık = 10 ay).</p>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[840px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2.5 text-left">Modül</th><th className="px-3 py-2.5 text-left">Kategori</th><th className="px-3 py-2.5 text-right">Aylık ₺</th>{plans.filter((p) => p.id !== "plan_custom").map((p) => <th key={p.id} className="px-3 py-2.5 text-center">{p.name}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{catalog.map((m) => <tr key={m.key} data-testid={`catalog-row-${m.key.replace("/", "") || "dashboard"}`}><td className="px-3 py-2 font-semibold text-slate-800">{m.label}{m.is_core && <span className="ml-1.5 text-[9px] bg-slate-100 text-slate-500 px-1 rounded">çekirdek</span>}</td><td className="px-3 py-2 text-slate-500">{m.category}</td><td className="px-3 py-2 text-right">{m.is_core ? "—" : <input type="number" min={0} value={prices[m.key] ?? 0} onChange={(e) => setPrices({ ...prices, [m.key]: Number(e.target.value) })} className="w-20 bg-slate-50 border rounded-lg px-2 py-1 text-right" data-testid={`mod-price-${m.key.replace("/", "")}`} />}</td>{plans.filter((p) => p.id !== "plan_custom").map((p) => <td key={p.id} className="px-3 py-2 text-center">{m.is_core || p.modules.includes(m.key) ? <span className="text-emerald-600 font-bold">✓</span> : <span className="text-slate-300">—</span>}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <button onClick={save} disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold disabled:opacity-60" data-testid="mod-prices-save">{busy ? "Kaydediliyor…" : "Fiyatları kaydet"}</button>
    </div>
  );
};
