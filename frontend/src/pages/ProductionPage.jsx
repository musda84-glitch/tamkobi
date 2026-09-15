import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Factory, BookOpen, Plus, Play, CheckCircle2, XCircle, Pencil, Trash2, AlertTriangle, Clock, Package, MonitorPlay } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { RecipeModal } from "../components/RecipeModal";
import { ProductionOrderModal } from "../components/ProductionOrderModal";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const STATUS = { planned: ["Planlandı", "bg-slate-100 text-slate-700", Clock], in_production: ["Üretimde", "bg-amber-50 text-amber-700", Play], completed: ["Tamamlandı", "bg-emerald-50 text-emerald-700", CheckCircle2], cancelled: ["İptal", "bg-rose-50 text-rose-700", XCircle] };

export default function ProductionPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get("tab") || "orders";
  const [recipes, setRecipes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [kpis, setKpis] = useState({ open: 0, in_production: 0, completed_this_month: 0, recipes: 0 });
  const [recipeModal, setRecipeModal] = useState(null);
  const [orderModal, setOrderModal] = useState(false);
  const [completeQty, setCompleteQty] = useState({});
  const [filter, setFilter] = useState("open");
  const [recipesLoaded, setRecipesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const statusQs = filter === "open" ? "&status=open" : filter === "all" ? "" : `&status=${filter}`;
      const [o, p, k] = await Promise.all([
        axios.get(`${API_URL}/production/orders?company_id=${companyId}${statusQs}&include_steps=1`),
        axios.get(`${API_URL}/products?company_id=${companyId}&lite=1`),
        axios.get(`${API_URL}/production/orders/kpis?company_id=${companyId}`),
      ]);
      setOrders(o.data || []);
      setProducts(p.data || []);
      setKpis(k.data || { open: 0, in_production: 0, completed_this_month: 0, recipes: 0 });
    } catch {
      toast.error("Üretim emirleri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [companyId, filter]);

  const loadRecipes = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/production/recipes?company_id=${companyId}`);
      setRecipes(r.data || []);
      setRecipesLoaded(true);
    } catch {
      toast.error("Reçeteler yüklenemedi.");
    }
  }, [companyId]);

  const load = useCallback(async () => {
    await loadOrders();
    if (tab === "recipes" || recipesLoaded) await loadRecipes();
  }, [loadOrders, loadRecipes, tab, recipesLoaded]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { if (tab === "recipes" && !recipesLoaded) loadRecipes(); }, [tab, recipesLoaded, loadRecipes]);
  useEffect(() => { const nf = params.get("new_for"); if (nf && products.length) { setRecipeModal({ presetProductId: nf }); const np = new URLSearchParams(params); np.delete("new_for"); setParams(np); } }, [params, products, setParams]);

  const act = async (id, action, body) => { try { const r = await axios.post(`${API_URL}/production/orders/${id}/${action}`, body || {}); toast.success(r.data.message); load(); } catch (err) { toast.error(err.response?.data?.detail || "İşlem başarısız."); } };
  const delRecipe = async (r) => { if (!window.confirm(`${r.name} reçetesi silinsin mi?`)) return; try { await axios.delete(`${API_URL}/production/recipes/${r.id}`); toast.success("Reçete silindi."); load(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } };
  const lowStockWithRecipe = products.filter((p) => p.has_recipe && p.track_stock !== false && (p.stock_quantity || 0) <= (p.min_stock_alert || 0));
  const recipeCount = recipesLoaded ? recipes.length : (kpis.recipes || products.filter((p) => p.has_recipe).length);
  const kpi = [
    ["Açık Emir", kpis.open, "text-amber-600"],
    ["Üretimde", kpis.in_production, "text-blue-600"],
    ["Bu Ay Tamamlanan", kpis.completed_this_month, "text-emerald-600"],
    ["Reçete", recipeCount, "text-slate-700"],
  ];

  return (
    <div className="space-y-6" data-testid="production-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Üretim & Reçeteler</h1><p className="text-xs sm:text-sm text-slate-500">Reçete (ürün ağacı) tanımla → üretim emri ver → hammadde düşsün, mamul stoğa girsin</p></div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/atolye")} className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white rounded-xl text-xs font-semibold hover:bg-slate-50" data-testid="goto-shopfloor-btn"><MonitorPlay className="w-4 h-4" /> Üretim Ekranı</button>
          <button onClick={() => { setRecipeModal({}); if (!recipesLoaded) loadRecipes(); }} className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white rounded-xl text-xs font-semibold hover:bg-slate-50" data-testid="new-recipe-btn"><BookOpen className="w-4 h-4" /> Yeni Reçete</button>
          <button onClick={() => { setOrderModal(true); if (!recipesLoaded) loadRecipes(); }} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700" data-testid="new-production-order-btn"><Plus className="w-4 h-4" /> Üretim Emri Ver</button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{kpi.map(([l, v, c]) => <div key={l} className="bg-white border border-slate-200 rounded-2xl p-4" data-testid={`prod-kpi-${l}`}><div className="text-[10px] uppercase font-semibold text-slate-400">{l}</div><div className={`text-2xl font-bold ${c}`}>{v}</div></div>)}</div>
      {lowStockWithRecipe.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs flex flex-wrap items-center gap-2" data-testid="low-stock-recipe-alert">
          <AlertTriangle className="w-4 h-4 text-amber-600" /><span className="font-semibold text-amber-800">Stoğu azalan reçeteli ürünler:</span>
          {lowStockWithRecipe.map((p) => <button key={p.id} onClick={() => setOrderModal(p)} className="px-2 py-1 bg-white border border-amber-300 rounded-lg font-semibold text-amber-900 hover:bg-amber-100" data-testid={`low-stock-produce-${p.id}`}>{p.name} ({p.stock_quantity} {p.unit}) → Üret</button>)}
        </div>
      )}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {[["orders", "Üretim Emirleri", Factory, filter === "open" ? orders.length : kpis.open], ["recipes", "Reçeteler", BookOpen, recipeCount]].map(([k, l, Icon, n]) => <button key={k} onClick={() => setParams({ tab: k })} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} data-testid={`production-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l} <span className="text-slate-400">({n})</span></button>)}
        {tab === "orders" && <div className="ml-auto flex gap-1 text-[11px]">{[["open", "Açık"], ["completed", "Tamamlanan"], ["cancelled", "İptal"], ["all", "Tümü"]].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`px-2 py-1 rounded-lg font-semibold ${filter === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`} data-testid={`po-filter-${k}`}>{l}</button>)}</div>}
      </div>

      {tab === "orders" && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="px-4 py-2">Emir</th><th className="px-4 py-2">Ürün</th><th className="px-4 py-2 text-right">Plan / Üretilen</th><th className="px-4 py-2">Tarih</th><th className="px-4 py-2 text-right">Maliyet</th><th className="px-4 py-2">Durum</th><th className="px-4 py-2 text-right">İşlem</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400" data-testid="po-loading">Yükleniyor…</td></tr>}
              {!loading && orders.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Üretim emri yok.</td></tr>}
              {!loading && orders.map((o) => { const [l, c, Icon] = STATUS[o.status] || STATUS.planned; const remaining = o.planned_quantity - (o.completed_quantity || 0); return (
                <tr key={o.id} data-testid={`po-row-${o.order_code}`}>
                  <td className="px-4 py-2 font-mono font-semibold text-slate-900">{o.order_code}{o.source === "stock_card" && <div className="text-[9px] text-slate-400 font-sans">Stok kartından</div>}{o.notes && <div className="text-[10px] text-slate-400 font-sans truncate max-w-[160px]">{o.notes}</div>}</td>
                  <td className="px-4 py-2"><div className="font-semibold">{o.finished_product_name}</div><div className="text-[10px] text-slate-400">{o.recipe_name}</div>{o.shortages?.length > 0 && o.status !== "completed" && <div className="text-[10px] text-rose-600 font-semibold flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> {o.shortages.length} hammadde eksik</div>}</td>
                  <td className="px-4 py-2 text-right font-bold">{o.planned_quantity} / <span className="text-emerald-700">{o.completed_quantity || 0}</span>{(() => { const s = o.steps_summary; if (!s?.total) return null; return <div className="text-[10px] font-normal text-slate-500" data-testid={`po-steps-${o.order_code}`}>Adım {s.done}/{s.total}{s.current_step_name ? ` • ${s.current_step_name}${s.current_operator ? " (" + s.current_operator + ")" : ""}` : ""}</div>; })()}</td>
                  <td className="px-4 py-2 text-slate-500">{o.planned_date || o.start_date}{o.end_date && <div className="text-[10px] text-emerald-600">Bitti: {o.end_date}</div>}</td>
                  <td className="px-4 py-2 text-right">{fmt(o.total_cost)} ₺</td>
                  <td className="px-4 py-2"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${c}`}><Icon className="w-3 h-3" /> {l}</span></td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end items-center gap-1">
                      {o.status === "planned" && <button onClick={() => act(o.id, "start")} className="px-2 py-1 bg-amber-500 text-white rounded-md font-semibold" data-testid={`po-start-${o.order_code}`}>Başlat</button>}
                      {o.status === "in_production" && <><input type="number" min="0.001" step="any" value={completeQty[o.id] ?? remaining} onChange={(e) => setCompleteQty({ ...completeQty, [o.id]: e.target.value })} className="w-16 bg-slate-50 border rounded p-1 text-right" title="Tamamlanan miktar" data-testid={`po-complete-qty-${o.order_code}`} /><button onClick={() => act(o.id, "complete", { quantity: Number(completeQty[o.id] ?? remaining), update_cost: true })} className="px-2 py-1 bg-emerald-600 text-white rounded-md font-semibold" data-testid={`po-complete-${o.order_code}`}>Tamamla</button></>}
                      {o.status === "planned" && <button onClick={async () => { if (!window.confirm("Üretim emri silinsin mi?")) return; try { await axios.delete(`${API_URL}/production/orders/${o.id}`); toast.success("Silindi."); load(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } }} className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md" title="Sil" data-testid={`po-delete-${o.order_code}`}><Trash2 className="w-4 h-4" /></button>}
                      {["planned", "in_production"].includes(o.status) && <button onClick={() => act(o.id, "cancel")} className="p-1 text-rose-500 hover:bg-rose-50 rounded-md" title="İptal" data-testid={`po-cancel-${o.order_code}`}><XCircle className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "recipes" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {recipes.length === 0 && <div className="col-span-full bg-white border border-dashed rounded-2xl p-10 text-center text-xs text-slate-400"><BookOpen className="w-8 h-8 mx-auto mb-2 text-slate-300" />Henüz reçete yok. "Yeni Reçete" ile ürün ağacını tanımlayın.</div>}
          {recipes.map((r) => { const fp = products.find((p) => p.id === r.finished_product_id); return (
            <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs hover:shadow-md transition" data-testid={`recipe-card-${r.code}`}>
              <div className="flex justify-between items-start gap-2"><div className="min-w-0"><div className="font-mono text-[10px] text-slate-400">{r.code}</div><div className="font-bold text-slate-900 truncate">{r.name}</div><div className="text-slate-500 flex items-center gap-1"><Package className="w-3 h-3" /> {r.finished_product_name} • {r.target_quantity} {r.unit}</div></div><div className="flex gap-1 shrink-0"><button onClick={() => setRecipeModal({ recipe: r })} className="p-1.5 border rounded-lg hover:bg-slate-50" title="Düzenle" data-testid={`recipe-edit-${r.code}`}><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => delRecipe(r)} className="p-1.5 border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50" title="Sil" data-testid={`recipe-delete-${r.code}`}><Trash2 className="w-3.5 h-3.5" /></button></div></div>
              <div className="bg-slate-50 rounded-xl p-2 divide-y divide-slate-100">{(r.materials || []).map((m, i) => { const mp = products.find((p) => p.id === m.product_id); const low = mp && mp.stock_quantity < m.quantity; return <div key={i} className="flex justify-between py-1"><span className={low ? "text-rose-600 font-semibold" : "text-slate-700"}>{m.product_name}{m.wastage_percent > 0 && <span className="text-slate-400"> (+%{m.wastage_percent} fire)</span>}</span><span className="font-semibold">{m.quantity} {m.unit}{mp && <span className="text-slate-400 font-normal"> / stok {mp.stock_quantity}</span>}</span></div>; })}</div>
              <div className="flex justify-between items-center pt-1"><div><div className="text-[10px] uppercase text-slate-400 font-semibold">Birim Maliyet</div><div className="font-black text-emerald-700 text-sm">{fmt(r.unit_cost || r.total_estimated_cost / (r.target_quantity || 1))} ₺</div>{fp?.sale_price > 0 && <div className="text-[10px] text-slate-500">Satış {fmt(fp.sale_price)} ₺</div>}</div><button onClick={() => setOrderModal(fp || { id: r.finished_product_id, name: r.finished_product_name })} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" data-testid={`recipe-produce-${r.code}`}><Factory className="w-3.5 h-3.5" /> Üret</button></div>
            </div>); })}
        </div>
      )}

      {recipeModal && <RecipeModal companyId={companyId} products={products} recipe={recipeModal.recipe} presetProductId={recipeModal.presetProductId} onClose={() => setRecipeModal(null)} onSaved={load} />}
      {orderModal && <ProductionOrderModal companyId={companyId} product={orderModal === true ? null : orderModal} recipes={orderModal === true ? recipes.filter((r) => r.is_active !== false) : null} onClose={() => setOrderModal(false)} onCreated={() => { load(); setParams({ tab: "orders" }); }} />}
    </div>
  );
}
