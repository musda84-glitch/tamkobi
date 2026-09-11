
import React, { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, Sparkles, X, Check, AlertTriangle } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const B2BAiCart = ({ token, products = [], onApply }) => {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState({});
  const ref = useRef(null);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.append("file", file);
    try { const r = await axios.post(`${API_URL}/public/b2b/${token}/ai-cart`, fd); setRes({ ...r.data, items: r.data.items.map((i) => ({ ...i, on: true })) }); setPick({}); if (!r.data.items.length && !r.data.unmatched.length) toast.error("Listedeki ürünler katalogla eşleşmedi."); } catch (e) { toast.error(e.response?.data?.detail || "Dosya işlenemedi."); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  const mapUnmatched = (i) => {
    const u = res.unmatched[i];
    const productId = pick[i];
    const p = products.find((x) => x.id === productId);
    if (!u || !p) return;
    setRes({
      ...res,
      items: [...res.items, { requested: u.requested, quantity: u.quantity, product_id: p.id, matched_name: p.name, confidence: 1, learned: true, on: true }],
      unmatched: res.unmatched.filter((_, j) => j !== i),
    });
    setPick({});
  };
  const apply = async () => {
    const sel = res.items.filter((i) => i.on && i.product_id);
    const mappings = sel
      .filter((i) => i.learned || (i.requested && i.matched_name && i.requested.toLowerCase() !== i.matched_name.toLowerCase()))
      .map((i) => ({ alias: i.requested, product_id: i.product_id }));
    if (mappings.length) {
      try { await axios.post(`${API_URL}/public/b2b/${token}/ai-cart/learn`, { mappings }); } catch { /* eşleme kaydı başarısız olsa da sepet uygulanır */ }
    }
    onApply(sel); toast.success(`${sel.length} kalem sepete eklendi.`); setRes(null);
  };
  return (
    <>
      <label className={`flex items-center gap-2 border-2 border-dashed rounded-xl px-3 py-2.5 cursor-pointer transition ${busy ? "border-indigo-300 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40"}`} data-testid="b2b-ai-cart-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}>
        <input ref={ref} type="file" accept=".xlsx,.xls,.csv,.pdf,.txt" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="b2b-ai-cart-input" disabled={busy} />
        {busy ? <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" /> : <Sparkles className="w-5 h-5 text-indigo-600" />}
        <div className="text-xs"><div className="font-bold text-slate-800">{busy ? "AI sipariş listenizi okuyor…" : "Excel / PDF sipariş listesi yükle → AI sepeti oluştursun"}</div><div className="text-[10px] text-slate-500 flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" /> Ürün adı / kod + adet içeren herhangi bir dosya (xlsx, csv, pdf)</div></div>
      </label>
      {res && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setRes(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl" data-testid="b2b-ai-cart-modal">
            <div className="flex items-center justify-between px-5 py-3 border-b"><div><div className="font-bold text-slate-900 text-sm">AI Sepet Önerisi</div><div className="text-[11px] text-slate-500">{res.filename} · {res.items.length} eşleşen, {res.unmatched.length} eşleşmeyen satır</div></div><button onClick={() => setRes(null)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
            <div className="p-4 overflow-y-auto text-xs space-y-1.5 flex-1">
              {res.items.map((it, i) => (
                <label key={i} className={`flex items-center gap-3 p-2 rounded-lg border ${it.on ? "bg-emerald-50/50 border-emerald-200" : "bg-slate-50 border-slate-200 opacity-60"}`} data-testid={`b2b-ai-item-${i}`}>
                  <input type="checkbox" checked={it.on} onChange={(e) => setRes({ ...res, items: res.items.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
                  <div className="flex-1 min-w-0"><div className="font-semibold text-slate-800 truncate">{it.matched_name}</div><div className="text-[10px] text-slate-500 truncate">Listede: “{it.requested}” · eşleşme %{Math.round(it.confidence * 100)}{it.learned ? " · öğrenilen eşleme" : ""}</div></div>
                  <input type="number" min={1} value={it.quantity} onChange={(e) => setRes({ ...res, items: res.items.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)) })} className="w-16 border rounded-lg p-1 text-center font-bold" data-testid={`b2b-ai-qty-${i}`} />
                  {it.confidence < 0.8 && <AlertTriangle className="w-4 h-4 text-amber-500" title="Düşük eşleşme – kontrol edin" />}
                </label>))}
              {res.unmatched.length > 0 && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5" data-testid="b2b-ai-unmatched">
                  <div className="font-semibold text-amber-800 mb-1">Katalogda bulunamayanlar — ürün seçin, bir sonraki yüklemede hatırlanır</div>
                  {res.unmatched.map((u, i) => (
                    <div key={`${u.requested}-${i}`} className="flex flex-wrap items-center gap-2 py-1.5 text-amber-900" data-testid={`b2b-ai-unmatched-${i}`}>
                      <span className="min-w-[140px] font-medium">• {u.requested} × {u.quantity}</span>
                      <select value={pick[i] || ""} onChange={(e) => setPick({ ...pick, [i]: e.target.value })} className="flex-1 min-w-[160px] border rounded-lg p-1.5 bg-white" data-testid={`b2b-ai-map-select-${i}`}>
                        <option value="">Stok kartı seç…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.sku ? `${p.name} (${p.sku})` : p.name}</option>)}
                      </select>
                      <button type="button" onClick={() => mapUnmatched(i)} disabled={!pick[i]} className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-40" data-testid={`b2b-ai-map-btn-${i}`}>Eşle</button>
                    </div>
                  ))}
                  <div className="text-[10px] text-amber-700 mt-1">Eşlemediğiniz satırlar sipariş notuna yazılabilir.</div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t"><button onClick={() => setRes(null)} className="px-4 py-2 border rounded-xl text-xs font-semibold">Vazgeç</button><button onClick={apply} disabled={!res.items.some((i) => i.on)} className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-50" data-testid="b2b-ai-apply"><Check className="w-4 h-4" /> Seçilenleri Sepete Ekle</button></div>
          </div>
        </div>
      )}
    </>
  );
};
