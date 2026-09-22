
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { TrendingUp, Link2, ChevronDown, ChevronUp, PackagePlus } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { channelTr } from "../utils/labels";
import { fmtMoney } from "../utils/money";

const fmt = (n, c = "TRY") => fmtMoney(n, c);
const tone = (m) => (m < 10 ? "text-rose-600" : m < 20 ? "text-amber-600" : "text-emerald-600");

export const ProductProfitPanel = ({ companyId }) => {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(90);
  const [d, setD] = useState(null);
  const [sel, setSel] = useState({});
  const [cost, setCost] = useState({});
  const [busy, setBusy] = useState(null);
  const createCard = async (u) => {
    setBusy(u.key);
    try {
      const r = await axios.post(`${API_URL}/marketplace/product-create`, { company_id: companyId, product_name: u.product_name, barcode: u.barcode, sku: u.sku, sale_price: u.qty ? u.revenue / u.qty : 0, purchase_price: Number(cost[u.key]) || 0, channel: u.channels[0] });
      toast.success(r.data.message); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Stok kartı oluşturulamadı."); } finally { setBusy(null); }
  };
  const load = useCallback(() => axios.get(`${API_URL}/marketplace/product-profitability?company_id=${companyId}&days=${days}`).then((r) => setD(r.data)).catch(() => toast.error("Ürün kârlılığı yüklenemedi.")), [companyId, days]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const match = async (u) => {
    const pid = sel[u.key];
    if (!pid) { toast.error("Önce eşleştirilecek ürünü seçin."); return; }
    try { const r = await axios.post(`${API_URL}/marketplace/product-match`, { product_id: pid, alias: u.barcode || u.sku || u.product_name }); toast.success(r.data.message); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Eşleştirilemedi."); }
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="product-profit-panel">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 flex items-center justify-between text-left" data-testid="product-profit-toggle">
        <span className="text-sm font-bold text-slate-900 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-600" /> Pazaryeri Ürün Kârlılığı & Eşleştirme</span>
        <span className="flex items-center gap-2 text-xs text-slate-500">{d?.unmatched?.length ? <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded" data-testid="unmatched-count">{d.unmatched.length} eşleşmeyen</span> : null}{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-4 space-y-4 text-xs">
          <div className="flex items-center justify-between"><p className="text-slate-500">Pazaryeri siparişleri barkod / SKU ile stok kartına eşlenir; komisyon, hizmet-kargo payı, KDV ve alış maliyeti düşülerek ürün başına net kâr hesaplanır.</p><select value={days} onChange={(e) => setDays(Number(e.target.value))} className="bg-slate-50 border rounded-lg p-1.5" data-testid="product-profit-days">{[30, 90, 180, 365].map((n) => <option key={n} value={n}>{`Son ${n} gün`}</option>)}</select></div>
          {!d ? <div className="text-slate-400">Yükleniyor…</div> : (<>
            {d.unmatched.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2" data-testid="unmatched-list">
                <div className="font-bold text-amber-900 flex items-center gap-1.5"><Link2 className="w-4 h-4" /> Stok kartıyla eşleşmeyen pazaryeri ürünleri — eşleştirin ki kârlılık ve stok düşümü doğru hesaplansın</div>
                {d.unmatched.map((u) => (
                  <div key={u.key} className="flex flex-wrap items-center gap-2 bg-white rounded-lg px-3 py-2 border border-amber-100" data-testid={`unmatched-${u.key.replace(/[^a-z0-9]/gi, "-")}`}>
                    <div className="flex-1 min-w-[200px]"><b className="text-slate-900">{u.product_name}</b><div className="text-[10px] text-slate-500">{u.barcode ? `Barkod ${u.barcode}` : ""}{u.sku ? ` · SKU ${u.sku}` : ""} · {u.channels.map(channelTr).join(", ")} · {u.qty} adet · {fmt(u.revenue)}</div></div>
                    <select value={sel[u.key] || ""} onChange={(e) => setSel({ ...sel, [u.key]: e.target.value })} className="bg-slate-50 border rounded-lg p-1.5 w-56" data-testid="unmatched-product-select"><option value="">Stok kartı seç…</option>{d.products.map((p) => <option key={p.id} value={p.id}>{p.sku ? `${p.name} (${p.sku})` : p.name}</option>)}</select>
                    <button onClick={() => match(u)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" data-testid="unmatched-match-btn">Eşleştir</button>
                    <span className="text-slate-300">|</span>
                    <input type="number" step="0.01" min="0" placeholder="Alış" value={cost[u.key] || ""} onChange={(e) => setCost({ ...cost, [u.key]: e.target.value })} className="bg-slate-50 border rounded-lg p-1.5 w-20" data-testid="unmatched-cost-input" />
                    <button onClick={() => createCard(u)} disabled={busy === u.key} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" title="Pazaryeri bilgileriyle yeni stok kartı aç ve otomatik eşleştir" data-testid="unmatched-create-btn"><PackagePlus className="w-3.5 h-3.5" /> Stok Kartı Oluştur</button>
                  </div>))}
              </div>
            )}
            <div className="overflow-x-auto border border-slate-200 rounded-xl"><table className="w-full"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Ürün</th><th className="px-3 py-2 text-left">Kanallar</th><th className="px-3 py-2 text-right">Adet</th><th className="px-3 py-2 text-right">Ort. Satış</th><th className="px-3 py-2 text-right">Ciro</th><th className="px-3 py-2 text-right">Komisyon</th><th className="px-3 py-2 text-right">Hizmet/Kargo</th><th className="px-3 py-2 text-right">Maliyet</th><th className="px-3 py-2 text-right">Birim Kâr</th><th className="px-3 py-2 text-right">Net Kâr</th><th className="px-3 py-2 text-right">Marj</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{d.rows.map((r) => (
                <tr key={r.product_id} data-testid={`product-profit-row-${r.sku || r.product_id}`}>
                  <td className="px-3 py-1.5"><b className="text-slate-900">{r.product_name}</b><div className="text-[10px] text-slate-400 font-mono">{r.sku}{r.purchase_price ? ` · alış ${fmt(r.purchase_price)}` : " · alış fiyatı yok!"}</div></td>
                  <td className="px-3 py-1.5"><div className="flex flex-wrap gap-1">{r.channels.map((c) => <span key={c.channel} className="text-[9px] font-bold bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded" title={`${fmt(c.revenue)} ciro · ${fmt(c.net)} net`}>{channelTr(c.channel)} ×{c.qty}</span>)}</div></td>
                  <td className="px-3 py-1.5 text-right font-semibold">{r.qty}</td><td className="px-3 py-1.5 text-right">{fmt(r.avg_price)}</td><td className="px-3 py-1.5 text-right">{fmt(r.revenue)}</td><td className="px-3 py-1.5 text-right text-rose-600">−{fmt(r.commission)}</td><td className="px-3 py-1.5 text-right text-rose-600">−{fmt(r.fees)}</td><td className="px-3 py-1.5 text-right text-rose-600">−{fmt(r.cost)}</td>
                  <td className={`px-3 py-1.5 text-right font-bold ${tone(r.margin_pct)}`}>{fmt(r.unit_profit)}</td><td className={`px-3 py-1.5 text-right font-bold ${tone(r.margin_pct)}`}>{fmt(r.net_profit)}</td><td className={`px-3 py-1.5 text-right font-bold ${tone(r.margin_pct)}`}>%{r.margin_pct}</td>
                </tr>))}</tbody></table>
              {d.rows.length === 0 && <div className="p-8 text-center text-slate-400">Bu dönemde eşleşen pazaryeri satışı yok.</div>}</div>
          </>)}
        </div>
      )}
    </div>
  );
};
