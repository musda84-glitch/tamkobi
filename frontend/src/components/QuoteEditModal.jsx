
import React, { useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Plus, Trash2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount((n || 0));
const STATUSES = [["draft", "Taslak"], ["sent", "Gönderildi"], ["accepted", "Kabul Edildi"], ["rejected", "Reddedildi"]];

export const QuoteEditModal = ({ quote, onClose, onSaved }) => {
  useEscape(onClose);
  const [f, setF] = useState({ title: quote.title || "", valid_until: quote.valid_until || "", notes: quote.notes || "", terms: quote.terms || "", status: quote.status || "draft" });
  const [items, setItems] = useState((quote.items || []).map((i) => ({ ...i })));
  const upd = (i, k, v) => setItems(items.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const total = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0) * (1 + Number(it.vat_rate ?? 20) / 100), 0);
  const save = async () => {
    try {
      const payload = { ...f, items: items.filter((i) => i.name).map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), vat_rate: Number(i.vat_rate ?? 20), total: Number(i.quantity) * Number(i.unit_price) })) };
      await axios.put(`${API_URL}/quotes/${quote.id}`, payload);
      toast.success("Teklif güncellendi."); onSaved?.(); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };
  const cls = "w-full bg-slate-50 border rounded-lg p-2";
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full p-5 space-y-3 text-xs shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="quote-edit-modal">
        <div className="flex justify-between border-b pb-2"><h3 className="text-sm font-bold">Teklif Düzenle — {quote.quote_number}</h3><button onClick={onClose} className="text-slate-400" data-testid="quote-edit-close"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2"><label className="block font-semibold mb-1">Başlık</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={cls} data-testid="quote-edit-title" /></div>
          <div><label className="block font-semibold mb-1">Durum</label><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={cls} data-testid="quote-edit-status">{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="block font-semibold mb-1">Geçerlilik</label><input type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} className={cls} /></div>
          <div className="col-span-2"><label className="block font-semibold mb-1">Not</label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={cls} /></div>
          <div className="col-span-3"><label className="block font-semibold mb-1">Şartlar</label><input value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} className={cls} /></div>
        </div>
        <table className="w-full"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1">Kalem</th><th className="py-1 w-20">Miktar</th><th className="py-1 w-16">Birim</th><th className="py-1 w-28">Birim Fiyat</th><th className="py-1 w-16">KDV</th><th className="py-1 text-right">Tutar</th><th className="w-8"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{items.map((it, i) => (
            <tr key={i}><td className="py-1"><input value={it.name} onChange={(e) => upd(i, "name", e.target.value)} className="w-full bg-slate-50 border rounded p-1" data-testid={`quote-item-name-${i}`} /></td><td className="py-1"><input type="number" value={it.quantity} onChange={(e) => upd(i, "quantity", e.target.value)} className="w-full bg-slate-50 border rounded p-1 text-center" data-testid={`quote-item-qty-${i}`} /></td><td className="py-1"><input value={it.unit || "Adet"} onChange={(e) => upd(i, "unit", e.target.value)} className="w-full bg-slate-50 border rounded p-1 text-center" /></td><td className="py-1"><input type="number" value={it.unit_price} onChange={(e) => upd(i, "unit_price", e.target.value)} className="w-full bg-slate-50 border rounded p-1 text-right" /></td><td className="py-1"><select value={it.vat_rate ?? 20} onChange={(e) => upd(i, "vat_rate", Number(e.target.value))} className="w-full bg-slate-50 border rounded p-1">{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select></td><td className="py-1 text-right font-bold">{fmt(Number(it.quantity || 0) * Number(it.unit_price || 0))} ₺</td><td className="text-right"><button onClick={() => setItems(items.filter((_, idx) => idx !== i))} className="text-rose-500" title="Sil"><Trash2 className="w-3.5 h-3.5" /></button></td></tr>
          ))}</tbody></table>
        <button onClick={() => setItems([...items, { name: "", quantity: 1, unit: "Adet", unit_price: 0, vat_rate: 20 }])} className="flex items-center gap-1 text-emerald-700 font-semibold" data-testid="quote-add-item"><Plus className="w-3.5 h-3.5" /> Kalem Ekle</button>
        <div className="flex justify-between items-center border-t pt-2"><span className="font-bold">Genel Toplam (KDV dahil): {fmt(total)} ₺</span><div className="flex gap-2"><button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={save} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="quote-edit-save">Kaydet</button></div></div>
      </div>
    </div>
  );
};
