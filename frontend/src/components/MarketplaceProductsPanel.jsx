import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { RefreshCw, Upload, Link2, Loader2, Search, PackagePlus, AlertTriangle } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export const MarketplaceProductsPanel = ({ companyId }) => {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState([]);
  const [edits, setEdits] = useState({});
  const [matchSel, setMatchSel] = useState({});
  const [bulkQty, setBulkQty] = useState("");
  const [stockSrc, setStockSrc] = useState("marketplace");
  const applyBulkQty = () => { if (bulkQty === "") { toast.error("Toplu stok değeri girin."); return; } const next = { ...edits }; rows.forEach((r) => { next[r.barcode] = { ...next[r.barcode], qty: Number(bulkQty) }; }); setEdits(next); setSel(rows.map((r) => r.barcode)); toast.success(`${rows.length} ürüne stok ${bulkQty} uygulandı; göndermek için "Stok/Fiyat Gönder".`); };
  const load = useCallback((refresh = false) => {
    setBusy(true);
    return axios.get(`${API_URL}/marketplace/products`, { params: { company_id: companyId, channel: "trendyol", refresh } }).then((r) => setD(r.data)).catch((e) => toast.error(e.response?.data?.detail || "Pazaryeri ürünleri yüklenemedi.")).finally(() => setBusy(false));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (d?.rows || []).filter((r) => {
    if (filter === "unmatched" && r.product_id) return false;
    if (filter === "price_diff" && !(r.price_diff && Math.abs(r.price_diff) >= 0.01)) return false;
    if (filter === "stock_diff" && !(r.stock_diff && Math.abs(r.stock_diff) >= 1)) return false;
    const s = q.trim().toLowerCase();
    return !s || (r.title || "").toLowerCase().includes(s) || (r.barcode || "").includes(s) || (r.stock_code || "").toLowerCase().includes(s) || (r.product_name || "").toLowerCase().includes(s);
  }), [d, filter, q]);

  const toggle = (bc) => setSel((s) => (s.includes(bc) ? s.filter((x) => x !== bc) : [...s, bc]));
  const push = async (fromStock) => {
    const list = rows.filter((r) => sel.includes(r.barcode));
    if (!list.length) { toast.error("Ürün seçin."); return; }
    const items = fromStock ? list.filter((r) => r.product_id).map((r) => ({ barcode: r.barcode })) : list.map((r) => ({ barcode: r.barcode, sale_price: edits[r.barcode]?.price ?? r.sale_price, quantity: edits[r.barcode]?.qty ?? r.quantity }));
    if (!items.length) { toast.error("Seçili ürünlerin stok kartı eşleşmesi yok."); return; }
    if (!window.confirm(`${items.length} ürünün fiyat/stok bilgisi Trendyol'a gönderilsin mi?`)) return;
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/marketplace/products/push`, { company_id: companyId, channel: "trendyol", items, from_stock: fromStock }); toast.success(r.data.message); setSel([]); setEdits({}); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(false); }
  };
  const match = async (r) => {
    const pid = matchSel[r.barcode];
    if (!pid) { toast.error("Stok kartı seçin."); return; }
    try { const res = await axios.post(`${API_URL}/marketplace/product-match`, { product_id: pid, alias: r.barcode }); toast.success(res.data.message); load(); } catch (e) { toast.error(e.response?.data?.detail || "Eşleştirilemedi."); }
  };
  const createCard = async (r) => {
    try { const res = await axios.post(`${API_URL}/marketplace/product-create`, { company_id: companyId, product_name: r.title, barcode: r.barcode, sku: r.stock_code, sale_price: r.sale_price, stock_quantity: r.quantity, vat_rate: r.vat_rate || 20, category: r.category, channel: "trendyol" }); toast.success(res.data.message); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Stok kartı oluşturulamadı."); }
  };

  if (!d) return <div className="p-6 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Pazaryeri ürünleri yükleniyor…</div>;
  const counts = { all: d.rows.length, unmatched: d.rows.filter((r) => !r.product_id).length, price_diff: d.rows.filter((r) => r.price_diff && Math.abs(r.price_diff) >= 0.01).length, stock_diff: d.rows.filter((r) => r.stock_diff && Math.abs(r.stock_diff) >= 1).length };
  return (
    <div className="space-y-3" data-testid="marketplace-products-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Trendyol Ürünleri — Fiyat & Stok Güncelleme, Eşleşme</h3>
          <p className="text-[11px] text-slate-500">{d.live ? `Canlı API · ${d.count} ürün · ${d.matched} eşleşmiş` : "Canlı API bağlantısı yok — E-Ticaret Entegrasyon ekranından Trendyol API bilgilerini girin."}{d.fetched_at ? ` · Son çekim ${new Date(d.fetched_at).toLocaleString("tr-TR")}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load(true)} disabled={busy || !d.live} className="px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-xs font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="mp-refresh-btn"><RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Trendyol'dan Çek</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {[["all", "Tümü"], ["unmatched", "Eşleşmeyen"], ["price_diff", "Fiyat farkı"], ["stock_diff", "Stok farkı"]].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg border font-semibold ${filter === k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`} data-testid={`mp-filter-${k}`}>{l} ({counts[k]})</button>)}
        <div className="relative ml-auto"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün adı, marka, stok kodu, barkod…" className="pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl w-60" data-testid="mp-search" /></div>
        <span className="text-slate-400">{rows.length} ürün</span>
        <div className="flex items-center gap-1 border-l pl-2"><input type="number" min="0" value={bulkQty} onChange={(e) => setBulkQty(e.target.value)} placeholder="Toplu stok" className="w-24 bg-white border border-slate-200 rounded-lg p-1.5" data-testid="mp-bulk-qty" /><button onClick={applyBulkQty} className="px-2 py-1.5 border border-slate-200 bg-white rounded-lg font-semibold" data-testid="mp-bulk-apply">Tümüne Uygula</button></div>
        <div className="flex items-center gap-1 border-l pl-2 text-[10px] text-slate-500">Stok kaynağı: {[["marketplace", "Pazaryeri"], ["crm", "Stok Kartı"]].map(([k, l]) => <button key={k} onClick={() => setStockSrc(k)} className={`px-2 py-1 rounded-lg border text-xs font-semibold ${stockSrc === k ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-slate-200 text-slate-600"}`} data-testid={`mp-stocksrc-${k}`}>{l}</button>)}</div>
        <button onClick={() => push(stockSrc === "crm")} disabled={busy || !sel.length} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="mp-send-btn"><Upload className="w-3.5 h-3.5" /> Stok/Fiyat Gönder{sel.length ? ` (${sel.length})` : ""}</button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold text-[10px]"><tr>
            <th className="px-3 py-2.5 w-8"><input type="checkbox" checked={rows.length > 0 && sel.length === rows.length} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.barcode) : [])} data-testid="mp-select-all" /></th>
            <th className="px-3 py-2.5">Görsel</th><th className="px-3 py-2.5">Ürün</th><th className="px-3 py-2.5">Marka / Kategori</th><th className="px-3 py-2.5">Stok Kodu</th><th className="px-3 py-2.5">Stok Kartı</th><th className="px-3 py-2.5 text-right">Stok</th><th className="px-3 py-2.5 text-right">Pazaryeri Stoğu</th><th className="px-3 py-2.5 text-right">Fiyat</th><th className="px-3 py-2.5 text-right">Yeni Fiyat</th><th className="px-3 py-2.5">Durum</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={11} className="p-10 text-center text-slate-400" data-testid="mp-empty">{d.live ? "Bu filtrede ürün yok." : "Canlı Trendyol bağlantısı olmadan ürün listesi çekilemez."}</td></tr>}
            {rows.map((r) => (
              <tr key={r.barcode} className="hover:bg-slate-50/60" data-testid={`mp-row-${r.barcode}`}>
                <td className="px-3 py-2"><input type="checkbox" checked={sel.includes(r.barcode)} onChange={() => toggle(r.barcode)} data-testid={`mp-select-${r.barcode}`} /></td>
                <td className="px-3 py-2">{r.image ? <img src={r.image} alt="" className="w-10 h-10 rounded-lg object-cover border" /> : <div className="w-10 h-10 rounded-lg bg-slate-100" />}</td>
                <td className="px-3 py-2"><div className="font-semibold text-slate-900 line-clamp-2 max-w-sm">{r.title}</div><div className="text-[10px] text-slate-400 font-mono">{r.barcode}</div></td>
                <td className="px-3 py-2"><div className="font-semibold text-slate-700">{r.brand || "—"}</div><div className="text-[10px] text-slate-400">{r.category || ""}</div></td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.stock_code || "—"}</td>
                <td className="px-3 py-2">{r.product_id ? <span className="inline-flex items-center gap-1 text-emerald-700" title={r.product_name}><Link2 className="w-3 h-3" /> <span className="line-clamp-1 max-w-[140px]">{r.product_name}</span></span> : (
                  <div className="flex items-center gap-1">
                    <select value={matchSel[r.barcode] || ""} onChange={(e) => setMatchSel({ ...matchSel, [r.barcode]: e.target.value })} className="bg-amber-50 border border-amber-200 rounded-lg p-1 w-32" data-testid={`mp-match-select-${r.barcode}`}><option value="">Eşleştir…</option>{d.products.map((p) => <option key={p.id} value={p.id}>{p.sku ? `${p.name} (${p.sku})` : p.name}</option>)}</select>
                    <button onClick={() => match(r)} className="px-2 py-1 bg-slate-900 text-white rounded-lg font-semibold" data-testid={`mp-match-btn-${r.barcode}`}>Eşle</button>
                    <button onClick={() => createCard(r)} className="px-2 py-1 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1" title="Trendyol bilgileriyle stok kartı oluştur" data-testid={`mp-create-btn-${r.barcode}`}><PackagePlus className="w-3 h-3" /> Kart Aç</button>
                  </div>)}</td>
                <td className={`px-3 py-2 text-right font-bold ${r.local_stock != null && r.local_stock <= 0 ? "text-rose-600" : "text-slate-900"}`}>{r.local_stock != null ? r.local_stock : "—"}</td>
                <td className="px-3 py-2 text-right"><div className="inline-flex items-center gap-1.5"><input type="checkbox" checked={sel.includes(r.barcode)} onChange={() => toggle(r.barcode)} className="accent-emerald-600" data-testid={`mp-select-${r.barcode}`} /><input type="number" step="1" value={edits[r.barcode]?.qty ?? r.quantity} onChange={(e) => { setEdits({ ...edits, [r.barcode]: { ...edits[r.barcode], qty: Number(e.target.value) } }); if (!sel.includes(r.barcode)) toggle(r.barcode); }} className={`w-16 text-right bg-slate-50 border rounded-lg p-1 ${r.stock_diff && Math.abs(r.stock_diff) >= 1 ? "border-amber-400" : ""}`} data-testid={`mp-qty-input-${r.barcode}`} /></div></td>
                <td className="px-3 py-2 text-right"><div className="font-bold text-slate-900">₺{fmt(r.sale_price)}</div>{r.list_price > r.sale_price && <div className="text-[10px] text-slate-400 line-through">₺{fmt(r.list_price)}</div>}{r.price_diff && Math.abs(r.price_diff) >= 0.01 ? <div className="text-[10px] text-amber-700 flex items-center justify-end gap-0.5" title="Stok kartı fiyatından farklı"><AlertTriangle className="w-3 h-3" /> kart ₺{fmt(r.local_price)}</div> : null}</td>
                <td className="px-3 py-2 text-right"><input type="number" step="0.01" placeholder={fmt(r.sale_price)} value={edits[r.barcode]?.price ?? ""} onChange={(e) => { setEdits({ ...edits, [r.barcode]: { ...edits[r.barcode], price: e.target.value === "" ? undefined : Number(e.target.value) } }); if (!sel.includes(r.barcode)) toggle(r.barcode); }} className="w-24 text-right bg-slate-50 border rounded-lg p-1" data-testid={`mp-price-input-${r.barcode}`} /></td>
                <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{r.approved ? <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold">Onaylı</span> : <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-semibold">Onay bekliyor</span>}{r.on_sale && r.approved && <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[10px] font-semibold">Satışta</span>}</div></td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
