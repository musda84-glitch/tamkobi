import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ClipboardList, Plus, Scan, CheckCircle2, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const StockCountPanel = ({ companyId, warehouses }) => {
  const [counts, setCounts] = useState([]);
  const [active, setActive] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [newForm, setNewForm] = useState({ name: "", warehouse_id: "", preload_all: true });
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const inputRef = useRef(null);

  const load = async () => { try { const r = await axios.get(`${API_URL}/warehouses/stock-counts?company_id=${companyId}`); setCounts(r.data); } catch { toast.error("Sayımlar yüklenemedi."); } };
  useEffect(() => { load(); }, [companyId]);

  const open = async (id) => { const r = await axios.get(`${API_URL}/warehouses/stock-counts/${id}`); setActive(r.data); setTimeout(() => inputRef.current?.focus(), 100); };

  const create = async (e) => {
    e.preventDefault();
    try { const r = await axios.post(`${API_URL}/warehouses/stock-counts`, { company_id: companyId, ...newForm, warehouse_id: newForm.warehouse_id || null }); toast.success("Sayım oturumu açıldı."); setShowNew(false); load(); setActive(r.data); setTimeout(() => inputRef.current?.focus(), 100); }
    catch (err) { toast.error(err.response?.data?.detail || "Sayım oluşturulamadı."); }
  };

  const scan = async (e) => {
    e?.preventDefault();
    if (!barcode.trim()) return;
    try { const r = await axios.post(`${API_URL}/warehouses/stock-counts/${active.id}/scan`, { barcode: barcode.trim(), quantity: 1 }); toast.success(r.data.message); setBarcode(""); open(active.id); }
    catch (err) { toast.error(err.response?.data?.detail || "Barkod okunamadı."); setBarcode(""); }
    inputRef.current?.focus();
  };

  const setCounted = async (item, value) => {
    try { const r = await axios.put(`${API_URL}/warehouses/stock-counts/${active.id}/items`, { product_id: item.product_id, variant_id: item.variant_id, counted: Number(value) }); setActive(r.data); }
    catch { toast.error("Güncellenemedi."); }
  };

  const complete = async (apply) => {
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/warehouses/stock-counts/${active.id}/complete`, { apply, only_scanned: true }); toast.success(r.data.message); setActive(null); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Tamamlanamadı."); } finally { setBusy(false); }
  };

  const remove = async (id) => { await axios.delete(`${API_URL}/warehouses/stock-counts/${id}`); load(); if (active?.id === id) setActive(null); };

  const items = (active?.items || []).filter((i) => filter === "all" || (filter === "diff" && i.scanned && i.counted !== i.expected) || (filter === "scanned" && i.scanned) || (filter === "pending" && !i.scanned));
  const diffCount = (active?.items || []).filter((i) => i.scanned && i.counted !== i.expected).length;

  return (
    <div className="space-y-4" data-testid="stock-count-panel">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2"><div className="p-2 rounded-xl bg-violet-50 text-violet-600"><ClipboardList className="w-5 h-5" /></div><div><h2 className="text-base font-bold text-slate-900">Barkodlu Stok Sayımı</h2><p className="text-xs text-slate-500">Sayım oturumu aç, barkod okut, farkları gör ve stoğu tek tıkla güncelle</p></div></div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="new-stock-count-btn"><Plus className="w-4 h-4" /> Yeni Sayım</button>
      </div>

      {showNew && (
        <form onSubmit={create} className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs items-end" data-testid="new-stock-count-form">
          <div><label className="block font-semibold mb-1">Sayım Adı</label><input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} placeholder="Örn: Eylül Ay Sonu Sayımı" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="stock-count-name-input" /></div>
          <div><label className="block font-semibold mb-1">Depo</label><select value={newForm.warehouse_id} onChange={(e) => setNewForm({ ...newForm, warehouse_id: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"><option value="">Tüm Depolar</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
          <label className="flex items-center gap-2 py-2 cursor-pointer"><input type="checkbox" checked={newForm.preload_all} onChange={(e) => setNewForm({ ...newForm, preload_all: e.target.checked })} /><span className="font-semibold">Tüm ürünleri listeye yükle</span></label>
          <div className="flex gap-2"><button type="button" onClick={() => setShowNew(false)} className="px-3 py-2 border rounded-lg">İptal</button><button type="submit" className="flex-1 px-3 py-2 bg-violet-600 text-white rounded-lg font-semibold" data-testid="create-stock-count-btn">Oturumu Aç</button></div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden lg:col-span-1">
          <div className="px-4 py-2.5 border-b text-xs font-bold text-slate-900">Sayım Oturumları</div>
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
            {counts.length === 0 && <div className="p-4 text-xs text-slate-400 text-center">Henüz sayım yok.</div>}
            {counts.map((c) => (
              <div key={c.id} className={`px-4 py-2.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-slate-50 ${active?.id === c.id ? "bg-violet-50" : ""}`} onClick={() => open(c.id)} data-testid={`stock-count-item-${c.id}`}>
                <div className="flex-1"><div className="font-semibold text-slate-900 truncate">{c.name}</div><div className="text-slate-400">{c.warehouse_name} • {new Date(c.created_at).toLocaleDateString("tr-TR")}</div></div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.status === "open" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{c.status === "open" ? "AÇIK" : "TAMAM"}</span>
                <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} className="text-slate-300 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-3">
          {!active ? <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-xs text-slate-400">Bir sayım oturumu seçin veya yeni sayım açın.</div> : (<>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div><h3 className="text-sm font-bold text-slate-900">{active.name}</h3><p className="text-xs text-slate-500">{active.warehouse_name} • {active.items.length} kalem • {active.items.filter((i) => i.scanned).length} sayıldı • <b className={diffCount ? "text-rose-600" : "text-emerald-600"}>{diffCount} fark</b></p></div>
                {active.status === "open" && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => complete(false)} disabled={busy} className="px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-slate-50" data-testid="complete-no-apply-btn">Sadece Kaydet</button>
                    <button onClick={() => complete(true)} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="complete-apply-btn">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Tamamla & Stoğu Güncelle</button>
                  </div>
                )}
              </div>
              {active.status === "open" && (
                <form onSubmit={scan} className="flex gap-2">
                  <div className="relative flex-1"><Scan className="w-4 h-4 absolute left-3 top-2.5 text-violet-500" /><input ref={inputRef} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Barkod okutun veya yazın, Enter → +1" className="w-full pl-9 bg-violet-50/50 border border-violet-200 rounded-xl p-2 font-mono text-sm font-bold" autoFocus data-testid="stock-count-scan-input" /></div>
                  <button type="submit" className="px-4 py-2 bg-violet-600 text-white rounded-xl text-xs font-semibold" data-testid="stock-count-scan-btn">Okut</button>
                </form>
              )}
              <div className="flex gap-1 text-[11px]">{[["all", "Tümü"], ["scanned", "Sayılan"], ["pending", "Sayılmayan"], ["diff", "Farklı"]].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-lg font-semibold ${filter === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid={`count-filter-${k}`}>{l}</button>)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold"><tr><th className="px-4 py-2">Ürün</th><th className="px-4 py-2">Barkod</th><th className="px-4 py-2 text-right">Sistem</th><th className="px-4 py-2 text-right w-28">Sayılan</th><th className="px-4 py-2 text-right">Fark</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {items.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Kayıt yok.</td></tr>}
                  {items.map((i) => { const diff = i.counted - i.expected; return (
                    <tr key={`${i.product_id}-${i.variant_id}`} className={i.scanned && diff !== 0 ? "bg-rose-50/40" : ""} data-testid={`count-row-${i.sku}`}>
                      <td className="px-4 py-2"><div className="font-semibold text-slate-900">{i.product_name}</div><div className="font-mono text-slate-400">{i.sku}</div></td>
                      <td className="px-4 py-2 font-mono text-slate-600">{i.barcode}</td>
                      <td className="px-4 py-2 text-right font-semibold">{i.expected}</td>
                      <td className="px-4 py-2 text-right">{active.status === "open" ? <input type="number" value={i.counted} onChange={(e) => setCounted(i, e.target.value)} className="w-20 text-right bg-slate-50 border border-slate-200 rounded-lg p-1 font-bold" data-testid={`count-input-${i.sku}`} /> : <b>{i.counted}</b>}</td>
                      <td className={`px-4 py-2 text-right font-bold ${!i.scanned ? "text-slate-300" : diff === 0 ? "text-emerald-600" : "text-rose-600"}`}>{!i.scanned ? "—" : <span className="inline-flex items-center gap-1">{diff !== 0 && <AlertTriangle className="w-3 h-3" />}{diff > 0 ? "+" : ""}{diff}</span>}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
};
