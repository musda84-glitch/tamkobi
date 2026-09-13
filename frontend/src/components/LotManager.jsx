import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, AlertTriangle, Package } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";
const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (product) => ({
  tracking_type: product?.track_serial ? "serial" : "lot",
  lot_number: "",
  serial_number: "",
  production_date: "",
  expiry_date: "",
  quantity: 1,
  notes: "",
});

/** Ürün kartında lot / seri / SKT yönetimi */
export default function LotManager({ product, companyId, onChanged }) {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(() => emptyForm(product));
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!product?.id && !product?._id) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/products/${product.id || product._id}/lots`, { params: { include_empty: true } });
      setLots(Array.isArray(r.data) ? r.data : []);
    } catch {
      setLots([]);
    } finally {
      setLoading(false);
    }
  }, [product]);

  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/stock-lots`, {
        ...form,
        product_id: product.id || product._id,
        company_id: companyId,
        quantity: Number(form.quantity || 0),
      });
      toast.success("Lot / seri kaydı eklendi.");
      setForm(emptyForm(product));
      setOpen(false);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Lot eklenemedi.");
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Bu lot/seri kaydı silinsin mi? Stok miktarı düşülür.")) return;
    try {
      await axios.delete(`${API_URL}/stock-lots/${id}`);
      toast.success("Silindi.");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  const expired = (d) => d && d < today();
  const soon = (d) => {
    if (!d) return false;
    const limit = new Date(); limit.setDate(limit.getDate() + 30);
    return d <= limit.toISOString().slice(0, 10) && d >= today();
  };

  if (!product?.track_lot && !product?.track_serial && !product?.track_expiry) {
    return (
      <div className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-3">
        Lot / seri / SKT takibi kapalı. Ürün kartında ilgili seçenekleri açın.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="lot-manager">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Package className="w-4 h-4 text-indigo-600" /> Lot / Seri / SKT
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold" data-testid="add-lot-toggle">
          <Plus className="w-3.5 h-3.5" /> Yeni Kayıt
        </button>
      </div>

      {open && (
        <form onSubmit={save} className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 space-y-2 text-xs" data-testid="lot-form">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold block mb-1">Tür</label>
              <select className={inputCls} value={form.tracking_type} onChange={(e) => setForm({ ...form, tracking_type: e.target.value, quantity: e.target.value === "serial" ? 1 : form.quantity })}>
                <option value="lot">Lot / Parti</option>
                <option value="serial">Seri No</option>
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1">Miktar</label>
              <input type="number" step="0.001" min="0.001" className={inputCls} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required disabled={form.tracking_type === "serial"} />
            </div>
          </div>
          {form.tracking_type === "lot" ? (
            <div>
              <label className="font-semibold block mb-1">Lot / Parti No</label>
              <input className={inputCls} value={form.lot_number} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} required data-testid="lot-number-input" />
            </div>
          ) : (
            <div>
              <label className="font-semibold block mb-1">Seri No</label>
              <input className={inputCls} value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} required data-testid="serial-number-input" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold block mb-1">Üretim Tarihi</label>
              <input type="date" className={inputCls} value={form.production_date} onChange={(e) => setForm({ ...form, production_date: e.target.value })} data-testid="production-date-input" />
            </div>
            <div>
              <label className="font-semibold block mb-1">Son Kullanma (SKT){product.track_expiry ? " *" : ""}</label>
              <input type="date" className={inputCls} value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} required={!!product.track_expiry} data-testid="expiry-date-input" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 border rounded-lg">İptal</button>
            <button type="submit" className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold" data-testid="save-lot-btn">Kaydet</button>
          </div>
        </form>
      )}

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Lot / Seri</th>
              <th className="text-left px-3 py-2">Üretim</th>
              <th className="text-left px-3 py-2">SKT</th>
              <th className="text-right px-3 py-2">Miktar</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">Yükleniyor…</td></tr>}
            {!loading && lots.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">Kayıt yok</td></tr>}
            {lots.map((l) => (
              <tr key={l.id} className="border-t border-slate-100" data-testid={`lot-row-${l.id}`}>
                <td className="px-3 py-2 font-semibold text-slate-800">
                  {l.serial_number || l.lot_number || "—"}
                  <div className="text-[10px] text-slate-400 uppercase">{l.tracking_type === "serial" ? "Seri" : "Lot"}</div>
                </td>
                <td className="px-3 py-2">{l.production_date || "—"}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 ${expired(l.expiry_date) ? "text-rose-600 font-bold" : soon(l.expiry_date) ? "text-amber-600 font-semibold" : ""}`}>
                    {(expired(l.expiry_date) || soon(l.expiry_date)) && <AlertTriangle className="w-3 h-3" />}
                    {l.expiry_date || "—"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.quantity || 0).toLocaleString("tr-TR")}</td>
                <td className="px-2 py-2 text-right">
                  <button type="button" onClick={() => remove(l.id)} className="p-1 text-slate-300 hover:text-rose-600" data-testid={`delete-lot-${l.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
