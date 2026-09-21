
import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Sparkles, Upload, Loader2, Link2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount((Number(n) || 0));

export const AiStockImportModal = ({ companyId, onClose, onSaved }) => {
  useEscape(onClose);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState([]);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [updateStock, setUpdateStock] = useState(true);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await axios.post(`${API_URL}/ai/product-extract?company_id=${companyId}`, fd);
      setRes(r.data);
      setSel(r.data.products.map((_, i) => i));
      if (!r.data.count) toast.info("Dosyada ürün bulunamadı.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Dosya işlenemedi.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const products = (res.products || []).filter((_, i) => sel.includes(i));
    if (!products.length) {
      toast.error("Ürün seçin.");
      return;
    }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/ai/product-extract/confirm`, {
        company_id: companyId,
        products,
        update_existing: updateExisting,
        update_stock: updateStock,
      });
      toast.success(r.data.message);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Stok kartları oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5 space-y-4 text-xs" onClick={(e) => e.stopPropagation()} data-testid="ai-stock-modal">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" /> AI ile Stok Yükle (Excel / PDF)
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" data-testid="ai-stock-close"><X className="w-4 h-4" /></button>
        </div>
        {!res ? (
          <label className="block border-2 border-dashed border-purple-200 bg-purple-50/40 rounded-2xl p-10 text-center cursor-pointer hover:bg-purple-50" data-testid="ai-stock-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}>
            <input type="file" accept=".pdf,.xlsx,.xlsm,.csv,.txt" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="ai-stock-file" />
            {busy ? <Loader2 className="w-8 h-8 mx-auto animate-spin text-purple-500" /> : <Upload className="w-8 h-8 mx-auto text-purple-400" />}
            <div className="mt-2 font-semibold text-slate-800">{busy ? "Belge okunuyor…" : "Fiyat listesi, stok Excel’i veya PDF kataloğu sürükleyin / seçin"}</div>
            <div className="text-slate-500 mt-1">Excel ve CSV sütunları otomatik eşlenir; PDF katalogları AI ile okunur. Onaylamadan stok kartı oluşmaz, cari bakiyesi etkilenmez.</div>
          </label>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{res.filename} → <b>{res.count}</b> ürün ({res.new_count} yeni, {res.existing_count} mevcut)</span>
              <button onClick={() => setRes(null)} className="px-3 py-1.5 border rounded-lg" data-testid="ai-stock-reupload">Başka dosya</button>
            </div>
            <div className="flex flex-wrap gap-4 text-slate-600">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} data-testid="ai-stock-update-existing" />
                Mevcut kartları güncelle
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} disabled={!updateExisting} data-testid="ai-stock-update-qty" />
                Stok miktarını da yaz
              </label>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2 text-left">Ürün</th>
                    <th className="px-2 py-2 text-left">SKU / Barkod</th>
                    <th className="px-2 py-2 text-right">Alış</th>
                    <th className="px-2 py-2 text-right">Satış</th>
                    <th className="px-2 py-2 text-right">Stok</th>
                    <th className="px-2 py-2 text-left">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {res.products.map((p, i) => (
                    <tr key={i} className={sel.includes(i) ? "bg-white" : "opacity-50"} data-testid={`ai-stock-row-${i}`}>
                      <td className="px-2 py-1.5"><input type="checkbox" checked={sel.includes(i)} onChange={() => setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i])} data-testid={`ai-stock-select-${i}`} /></td>
                      <td className="px-2 py-1.5 font-semibold text-slate-900">{p.name}<div className="text-[10px] font-normal text-slate-400">{p.category} · {p.unit}</div></td>
                      <td className="px-2 py-1.5 font-mono">{p.sku || "—"}{p.barcode ? <div className="text-[10px] text-slate-400">{p.barcode}</div> : null}</td>
                      <td className="px-2 py-1.5 text-right">{fmt(p.purchase_price)} ₺</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{fmt(p.sale_price)} ₺</td>
                      <td className="px-2 py-1.5 text-right">{p.stock_quantity}</td>
                      <td className="px-2 py-1.5">
                        {p.match_id ? (
                          <span className="text-amber-700 flex items-center gap-0.5"><Link2 className="w-3 h-3" /> {p.match_name}{p.match_stock != null ? ` · stok ${p.match_stock}` : ""}</span>
                        ) : <span className="text-sky-700">yeni kart</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 border rounded-lg">İptal</button>
              <button onClick={confirm} disabled={busy || !sel.length} className="px-5 py-2 bg-purple-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="ai-stock-confirm">
                {busy ? "Aktarılıyor…" : `${sel.length} stok kartını yükle`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
