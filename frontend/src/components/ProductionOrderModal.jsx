
import React, { useEffect, useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Factory, Loader2, AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount((n || 0));

export const ProductionOrderModal = ({ companyId, product, recipes: recipesProp, onClose, onCreated }) => {
  useEscape(onClose);
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState(recipesProp || null);
  const [recipeId, setRecipeId] = useState("");
  const [qty, setQty] = useState(product ? Math.max(1, Math.ceil((product.min_stock_alert || 0) - (product.stock_quantity || 0))) || 1 : 1);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [req, setReq] = useState(null);
  const [busy, setBusy] = useState(false);
  const productId = product?.id;
  useEffect(() => {
    if (recipesProp) return;
    axios.get(`${API_URL}/production/recipes?company_id=${companyId}${productId ? `&product_id=${productId}` : ""}`).then((r) => setRecipes(r.data.filter((x) => x.is_active !== false))).catch(() => setRecipes([]));
  }, [companyId, productId, recipesProp]);
  useEffect(() => { if (recipes?.length) setRecipeId((cur) => cur || (recipes.find((r) => r.finished_product_id === productId) || recipes[0]).id); }, [recipes, productId]);
  useEffect(() => { if (recipeId && qty > 0) axios.get(`${API_URL}/production/requirements?recipe_id=${recipeId}&quantity=${qty}`).then((r) => setReq(r.data)).catch(() => setReq(null)); }, [recipeId, qty]);
  const recipe = recipes?.find((r) => r.id === recipeId);
  const submit = async () => {
    if (!recipeId) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/production/orders`, { company_id: companyId, recipe_id: recipeId, planned_quantity: Number(qty), planned_date: date, notes, source: product ? "stock_card" : "manual" });
      toast.success(r.data.message); onCreated?.(r.data); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Üretim emri oluşturulamadı."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full p-5 space-y-4 text-xs shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="production-order-modal">
        <div className="flex justify-between items-start border-b pb-2">
          <div><h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Factory className="w-4 h-4 text-emerald-600" /> Üretim Emri Ver{product ? ` — ${product.name}` : ""}</h3>{product && <p className="text-slate-500">Stok: <b className={product.stock_quantity <= 0 ? "text-rose-600" : ""}>{product.stock_quantity} {product.unit}</b> • Min: {product.min_stock_alert}</p>}</div>
          <button onClick={onClose} className="text-slate-400" data-testid="po-close"><X className="w-5 h-5" /></button>
        </div>
        {recipes === null ? <div className="text-slate-400 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reçeteler yükleniyor…</div> : recipes.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2" data-testid="po-no-recipe">
            <div className="flex items-center gap-1.5 font-bold text-amber-800"><AlertTriangle className="w-4 h-4" /> Bu ürün için reçete (BOM) yok.</div>
            <p className="text-amber-700">Üretim emri vermek için önce hangi hammaddelerden üretileceğini tanımlayan bir reçete oluşturun.</p>
            <button onClick={() => { onClose(); navigate(`/production?tab=recipes&new_for=${product?.id || ""}`); }} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" data-testid="po-create-recipe">Reçete Oluştur</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3 sm:col-span-1"><label className="block font-semibold mb-1">Reçete</label><select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="po-recipe-select">{recipes.map((r) => <option key={r.id} value={r.id}>{r.name} {!product ? `(${r.finished_product_name})` : ""}</option>)}</select></div>
              <div><label className="block font-semibold mb-1">Miktar ({recipe?.unit || "Adet"})</label><input type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-full bg-slate-50 border rounded-lg p-2 font-bold" data-testid="po-qty" /></div>
              <div><label className="block font-semibold mb-1">Planlanan Tarih</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="po-date" /></div>
            </div>
            {req && (
              <div className="space-y-1.5" data-testid="po-requirements">
                <div className="flex items-center justify-between"><span className="font-bold text-slate-800 flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" /> Hammadde İhtiyacı</span><span className="text-slate-500">Tahmini maliyet: <b className="text-slate-900">{fmt(req.estimated_total_cost)} ₺</b> ({fmt(req.unit_cost)} ₺/birim)</span></div>
                <table className="w-full"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1">Hammadde</th><th className="py-1 text-right">Gerekli</th><th className="py-1 text-right">Stokta</th><th className="py-1 text-right">Durum</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{req.rows.map((r) => <tr key={r.product_id} className={r.shortage > 0 ? "bg-rose-50/60" : ""} data-testid={`po-req-${r.product_id}`}><td className="py-1 font-semibold">{r.product_name}</td><td className="py-1 text-right">{r.needed} {r.unit}</td><td className="py-1 text-right">{r.in_stock} {r.unit}</td><td className="py-1 text-right">{r.shortage > 0 ? <span className="inline-flex items-center gap-0.5 text-rose-600 font-bold"><AlertTriangle className="w-3 h-3" /> {r.shortage} eksik</span> : <span className="inline-flex items-center gap-0.5 text-emerald-600 font-semibold"><CheckCircle2 className="w-3 h-3" /> Yeterli</span>}</td></tr>)}</tbody></table>
                {req.has_shortage && <p className="text-[11px] text-rose-600">Eksik hammadde var — emir yine oluşturulur, ancak tamamlamadan önce satın alma yapmanız gerekir.</p>}
              </div>
            )}
            <div><label className="block font-semibold mb-1">Not</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Operatör, vardiya, sipariş no…" className="w-full bg-slate-50 border rounded-lg p-2" data-testid="po-notes" /></div>
            <div className="flex justify-end gap-2 border-t pt-2"><button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={submit} disabled={busy || !recipeId || !qty} className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="po-submit">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Factory className="w-3.5 h-3.5" />} Üretim Emri Oluştur</button></div>
          </>
        )}
      </div>
    </div>
  );
};
