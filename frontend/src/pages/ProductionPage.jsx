import React, { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Factory, BookOpen, Plus, Play, CheckCircle2, XCircle, Pencil, Trash2, AlertTriangle, Clock, Package, MonitorPlay, BellRing, Loader2, Copy, X } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { RecipeModal } from "../components/RecipeModal";
import { ProductionOrderModal } from "../components/ProductionOrderModal";
import { formatTrAmount } from "../utils/money";
import { filterMissingByOrder, missingLinesForOrder } from "../utils/missingOrderLines";

const fmt = (n) => formatTrAmount((n || 0));
const STATUS = { planned: ["Planlandı", "bg-slate-100 text-slate-700", Clock], in_production: ["Üretimde", "bg-amber-50 text-amber-700", Play], completed: ["Tamamlandı", "bg-emerald-50 text-emerald-700", CheckCircle2], cancelled: ["İptal", "bg-rose-50 text-rose-700", XCircle] };

export default function ProductionPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get("tab") || "orders";
  const highlightOrder = params.get("order") || "";
  const [recipes, setRecipes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [kpis, setKpis] = useState({ open: 0, in_production: 0, completed_this_month: 0, recipes: 0, missing_notifications: 0 });
  const [recipeModal, setRecipeModal] = useState(null);
  const [orderModal, setOrderModal] = useState(false);
  const [completeQty, setCompleteQty] = useState({});
  const [filter, setFilter] = useState("open");
  const [recipesLoaded, setRecipesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [missingItems, setMissingItems] = useState([]);
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingMeta, setMissingMeta] = useState({ count: 0, notification_count: 0 });
  const [planQty, setPlanQty] = useState({});
  const [selected, setSelected] = useState({});
  const [planning, setPlanning] = useState(false);
  const [produceShortagesBusy, setProduceShortagesBusy] = useState(null); // production order id
  const [editPlan, setEditPlan] = useState({}); // { [orderId]: { qty, recipe_id } }
  const [orderMissingView, setOrderMissingView] = useState(null); // kaynak sipariş → eksik ürün listesi

  const visibleMissingItems = useMemo(
    () => filterMissingByOrder(missingItems, highlightOrder),
    [missingItems, highlightOrder],
  );

  const orderMissingLines = useMemo(
    () => missingLinesForOrder(missingItems, orderMissingView || {}),
    [orderMissingView, missingItems],
  );

  const openOrderMissing = (src) => {
    if (!src?.order_id && !src?.order_number) return;
    setOrderMissingView(src);
    const np = new URLSearchParams(params);
    np.set("tab", "missing");
    if (src.order_id) np.set("order", src.order_id);
    setParams(np);
  };

  const clearOrderMissingFilter = () => {
    setOrderMissingView(null);
    const np = new URLSearchParams(params);
    np.delete("order");
    setParams(np);
  };

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const statusQs = filter === "open" ? "&status=open" : filter === "all" ? "" : `&status=${filter}`;
      const [o, p, k] = await Promise.all([
        axios.get(`${API_URL}/production/orders?company_id=${companyId}${statusQs}&include_steps=1`),
        axios.get(`${API_URL}/products?company_id=${companyId}&lite=1`),
        axios.get(`${API_URL}/production/kpis?company_id=${companyId}`),
      ]);
      setOrders(o.data || []);
      setProducts(p.data || []);
      setKpis(k.data || { open: 0, in_production: 0, completed_this_month: 0, recipes: 0, missing_notifications: 0 });
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

  const loadMissing = useCallback(async () => {
    try {
      setMissingLoading(true);
      const r = await axios.get(`${API_URL}/production/missing-plan`, { params: { company_id: companyId } });
      const items = r.data?.items || [];
      setMissingItems(items);
      setMissingMeta({ count: r.data?.count || items.length, notification_count: r.data?.notification_count || 0 });
      setPlanQty((prev) => {
        const next = { ...prev };
        items.forEach((it) => {
          if (next[it.key] == null) next[it.key] = it.suggested_qty || it.missing_qty || 1;
        });
        return next;
      });
      setSelected((prev) => {
        const next = { ...prev };
        items.forEach((it) => {
          if (next[it.key] == null) {
            const fromPick = (it.sources || []).some((s) => s.type === "order_pick");
            next[it.key] = fromPick && Number(it.suggested_qty || it.missing_qty) > 0;
          }
        });
        return next;
      });
    } catch {
      toast.error("Eksik ürün bildirimleri yüklenemedi.");
    } finally {
      setMissingLoading(false);
    }
  }, [companyId]);

  const load = useCallback(async () => {
    await loadOrders();
    if (tab === "recipes" || recipesLoaded) await loadRecipes();
    if (tab === "missing") await loadMissing();
  }, [loadOrders, loadRecipes, loadMissing, tab, recipesLoaded]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { if (tab === "recipes" && !recipesLoaded) loadRecipes(); }, [tab, recipesLoaded, loadRecipes]);
  useEffect(() => { if (tab === "missing") loadMissing(); }, [tab, loadMissing]);
  useEffect(() => { if (tab === "orders" && !recipesLoaded) loadRecipes(); }, [tab, recipesLoaded, loadRecipes]);
  useEffect(() => { const nf = params.get("new_for"); if (nf && products.length) { setRecipeModal({ presetProductId: nf }); const np = new URLSearchParams(params); np.delete("new_for"); setParams(np); } }, [params, products, setParams]);

  const act = async (id, action, body) => { try { const r = await axios.post(`${API_URL}/production/orders/${id}/${action}`, body || {}); toast.success(r.data.message); load(); } catch (err) { toast.error(err.response?.data?.detail || "İşlem başarısız."); } };

  const produceShortages = async (o) => {
    if (!o?.id) return;
    setProduceShortagesBusy(o.id);
    try {
      const r = await axios.post(`${API_URL}/production/orders/${o.id}/produce-shortages`, {});
      toast.success(r.data.message || "Eksik ürünler üretime alındı.");
      await loadOrders();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Eksik ürünler üretime alınamadı.");
    } finally {
      setProduceShortagesBusy(null);
    }
  };
  const saveOrderPlan = async (o, patch) => {
    try {
      const r = await axios.put(`${API_URL}/production/orders/${o.id}`, patch);
      toast.success(r.data.message || "Güncellendi.");
      setEditPlan((prev) => { const n = { ...prev }; delete n[o.id]; return n; });
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Güncellenemedi.");
    }
  };
  const planDraft = (o) => editPlan[o.id] || { qty: o.planned_quantity, recipe_id: o.recipe_id || "" };
  const setPlanDraft = (o, fields) => setEditPlan((prev) => ({
    ...prev,
    [o.id]: { qty: o.planned_quantity, recipe_id: o.recipe_id || "", ...(prev[o.id] || {}), ...fields },
  }));
  const recipesForOrder = (o) => {
    const all = (recipes || []).filter((r) => r.is_active !== false);
    const same = all.filter((r) => r.finished_product_id === o.finished_product_id);
    return same.length ? [...same, ...all.filter((r) => r.finished_product_id !== o.finished_product_id)] : all;
  };
  const delRecipe = async (r) => { if (!window.confirm(`${r.name} reçetesi silinsin mi?`)) return; try { await axios.delete(`${API_URL}/production/recipes/${r.id}`); toast.success("Reçete silindi."); load(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } };
  const copyRecipe = async (r) => {
    try {
      const res = await axios.post(`${API_URL}/production/recipes/${r.id}/copy`);
      toast.success(res.data.message || "Reçete kopyalandı.");
      await loadRecipes();
      if (res.data?.id) setRecipeModal({ recipe: res.data });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kopyalanamadı.");
    }
  };
  const lowStockWithRecipe = products.filter((p) => p.has_recipe && p.track_stock !== false && (p.stock_quantity || 0) <= (p.min_stock_alert || 0));
  const recipeCount = recipesLoaded ? recipes.length : (kpis.recipes || products.filter((p) => p.has_recipe).length);
  const missingCount = tab === "missing" ? missingMeta.count : (kpis.missing_notifications || missingMeta.count || 0);
  const kpi = [
    ["Açık Emir", kpis.open, "text-amber-600"],
    ["Üretimde", kpis.in_production, "text-blue-600"],
    ["Bu Ay Tamamlanan", kpis.completed_this_month, "text-emerald-600"],
    ["Reçete", recipeCount, "text-slate-700"],
  ];

  const selectedLines = useMemo(
    () => missingItems.filter((it) => selected[it.key] && Number(planQty[it.key] || 0) > 0),
    [missingItems, selected, planQty],
  );

  const toggleAll = (on) => {
    const next = { ...selected };
    visibleMissingItems.forEach((it) => { next[it.key] = on; });
    setSelected(next);
  };

  const createPlan = async () => {
    if (!selectedLines.length) {
      toast.error("Planlanacak ürün seçin.");
      return;
    }
    setPlanning(true);
    try {
      const r = await axios.post(`${API_URL}/production/missing-plan/create`, {
        company_id: companyId,
        mark_read: true,
        items: selectedLines.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          planned_quantity: Number(planQty[it.key] || it.suggested_qty || 1),
          recipe_id: it.recipe_id || undefined,
          notification_ids: it.notification_ids || [],
          sources: it.sources || [],
          notes: (it.sources || [])
            .filter((s) => s.order_number)
            .map((s) => `Sipariş ${s.order_number} eksik ${s.missing_qty ?? ""}`)
            .join("; "),
        })),
      });
      toast.success(r.data.message || "Üretim emirleri oluşturuldu.");
      setSelected({});
      await loadOrders();
      await loadMissing();
      setParams({ tab: "orders" });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Plan oluşturulamadı.");
    } finally {
      setPlanning(false);
    }
  };

  const setTab = (k) => {
    const np = new URLSearchParams(params);
    np.set("tab", k);
    if (k !== "missing") np.delete("order");
    setParams(np);
  };

  return (
    <div className="space-y-6" data-testid="production-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Üretim & Reçeteler</h1><p className="text-xs sm:text-sm text-slate-500">Eksik ürün bildirimi → üretim planla → emir ver → hammadde düşsün, mamul stoğa girsin</p></div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/atolye")} className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white rounded-xl text-xs font-semibold hover:bg-slate-50" data-testid="goto-shopfloor-btn"><MonitorPlay className="w-4 h-4" /> Üretim Ekranı</button>
          <button onClick={() => { setRecipeModal({}); if (!recipesLoaded) loadRecipes(); }} className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white rounded-xl text-xs font-semibold hover:bg-slate-50" data-testid="new-recipe-btn"><BookOpen className="w-4 h-4" /> Yeni Reçete</button>
          <button onClick={() => { setOrderModal(true); if (!recipesLoaded) loadRecipes(); }} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700" data-testid="new-production-order-btn"><Plus className="w-4 h-4" /> Üretim Emri Ver</button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{kpi.map(([l, v, c]) => <div key={l} className="bg-white border border-slate-200 rounded-2xl p-4" data-testid={`prod-kpi-${l}`}><div className="text-[10px] uppercase font-semibold text-slate-400">{l}</div><div className={`text-2xl font-bold ${c}`}>{v}</div></div>)}</div>
      {tab !== "missing" && lowStockWithRecipe.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs flex flex-wrap items-center gap-2" data-testid="low-stock-recipe-alert">
          <AlertTriangle className="w-4 h-4 text-amber-600" /><span className="font-semibold text-amber-800">Stoğu azalan reçeteli ürünler:</span>
          {lowStockWithRecipe.map((p) => <button key={p.id} onClick={() => setOrderModal(p)} className="px-2 py-1 bg-white border border-amber-300 rounded-lg font-semibold text-amber-900 hover:bg-amber-100" data-testid={`low-stock-produce-${p.id}`}>{p.name} ({p.stock_quantity} {p.unit}) → Üret</button>)}
          <button onClick={() => setTab("missing")} className="ml-auto px-2 py-1 text-amber-800 font-semibold underline" data-testid="goto-missing-tab">Eksik ürün planına git</button>
        </div>
      )}
      <div className="flex items-center gap-1 border-b border-slate-200" data-testid="production-tabs">
        {[
          ["missing", "Eksik Ürün Bildirimleri", BellRing, missingCount],
          ["orders", "Üretim Emirleri", Factory, filter === "open" ? orders.length : kpis.open],
          ["recipes", "Reçeteler", BookOpen, recipeCount],
        ].map(([k, l, Icon, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} data-testid={`production-tab-${k}`}>
            <Icon className="w-3.5 h-3.5" /> {l} <span className="text-slate-400">({n})</span>
          </button>
        ))}
        {tab === "orders" && <div className="ml-auto flex gap-1 text-[11px]">{[["open", "Açık"], ["completed", "Tamamlanan"], ["cancelled", "İptal"], ["all", "Tümü"]].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`px-2 py-1 rounded-lg font-semibold ${filter === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`} data-testid={`po-filter-${k}`}>{l}</button>)}</div>}
        {tab === "missing" && (
          <div className="ml-auto flex items-center gap-2 text-[11px]">
            <button onClick={() => toggleAll(true)} className="px-2 py-1 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold" data-testid="missing-select-all">Tümünü seç</button>
            <button onClick={() => toggleAll(false)} className="px-2 py-1 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold" data-testid="missing-select-none">Temizle</button>
            <button onClick={createPlan} disabled={planning || !selectedLines.length} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="missing-plan-create">
              {planning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Factory className="w-3.5 h-3.5" />}
              Üretim Planla ({selectedLines.length})
            </button>
          </div>
        )}
      </div>

      {tab === "missing" && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="missing-plan-panel">
          <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/60 text-xs text-amber-900 flex flex-wrap items-center gap-2">
            <BellRing className="w-4 h-4" />
            <span>Depodan gelen eksik ürün bildirimleri ve kritik stok buradan planlanır; onayladığınız kalemler <b>Üretim Emirleri</b> sekmesine düşer.</span>
            {missingMeta.notification_count > 0 && <span className="ml-auto font-semibold">{missingMeta.notification_count} okunmamış bildirim</span>}
          </div>
          {highlightOrder ? (
            <div className="px-4 py-2 border-b border-indigo-100 bg-indigo-50 text-xs text-indigo-900 flex flex-wrap items-center gap-2" data-testid="missing-order-filter-bar">
              <span className="font-semibold">
                Sipariş filtresi: {orderMissingView?.order_number || highlightOrder}
                {orderMissingView?.customer_name ? ` · ${orderMissingView.customer_name}` : ""}
              </span>
              <span className="text-indigo-700">{visibleMissingItems.length} ürün</span>
              <button type="button" onClick={clearOrderMissingFilter} className="ml-auto px-2 py-1 rounded-lg border border-indigo-200 bg-white font-semibold hover:bg-indigo-100" data-testid="missing-order-filter-clear">Filtreyi kaldır</button>
            </div>
          ) : null}
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">Ürün</th>
                <th className="px-3 py-2">Kaynak</th>
                <th className="px-3 py-2 text-right">Eksik</th>
                <th className="px-3 py-2 text-right">Stok</th>
                <th className="px-3 py-2 text-right">Açık emir</th>
                <th className="px-3 py-2 text-right">Plan miktar</th>
                <th className="px-3 py-2 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {missingLoading && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400" data-testid="missing-loading">Yükleniyor…</td></tr>}
              {!missingLoading && visibleMissingItems.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400" data-testid="missing-empty">
                  <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  {highlightOrder ? "Bu sipariş için listede eksik ürün yok." : "Bekleyen eksik ürün bildirimi yok. Depo sevkiyatında “Eksikleri bildir” ile buraya düşer."}
                </td></tr>
              )}
              {!missingLoading && visibleMissingItems.map((it) => {
                const fromHighlight = highlightOrder && (it.order_ids || []).includes(highlightOrder);
                const pickSources = (it.sources || []).filter((s) => s.type === "order_pick");
                const lowSources = (it.sources || []).filter((s) => s.type === "low_stock");
                return (
                  <tr key={it.key} className={fromHighlight ? "bg-amber-50/80" : selected[it.key] ? "bg-emerald-50/40" : ""} data-testid={`missing-row-${it.product_id || it.key}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={!!selected[it.key]} onChange={(e) => setSelected({ ...selected, [it.key]: e.target.checked })} className="rounded border-slate-300" data-testid={`missing-check-${it.product_id || it.key}`} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900" data-testid={`missing-product-name-${it.product_id || it.key}`}>
                        {it.product_name || "Ürün"}
                      </div>
                      <div className="text-[10px] text-slate-400 flex flex-wrap gap-1.5 mt-0.5">
                        {it.sku && <span className="font-mono">{it.sku}</span>}
                        {it.has_recipe ? <span className="text-emerald-700 font-semibold">Reçeteli</span> : <span className="text-amber-700 font-semibold">Reçetesiz</span>}
                        {it.recipe_name && <span>{it.recipe_name}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {pickSources.map((s, i) => (
                        <button
                          type="button"
                          key={i}
                          onClick={() => openOrderMissing(s)}
                          className="block w-full text-left text-[11px] rounded-md px-1 -mx-1 py-0.5 hover:bg-indigo-50 hover:text-indigo-900 transition"
                          title="Bu siparişin eksik ürünlerini göster"
                          data-testid={`missing-source-order-${s.order_number || s.order_id || i}`}
                        >
                          <span className="font-semibold text-slate-800 underline decoration-slate-300 underline-offset-2">Sipariş {s.order_number || "—"}</span>
                          {s.customer_name && <span className="text-slate-400"> · {s.customer_name}</span>}
                          {s.missing_qty != null && <span className="text-rose-600"> · {Number(s.missing_qty)} eksik</span>}
                        </button>
                      ))}
                      {lowSources.map((s, i) => (
                        <div key={`l${i}`} className="text-[11px] text-amber-800 font-semibold">Kritik stok{s.detail ? ` · ${s.detail}` : ""}</div>
                      ))}
                      {!pickSources.length && !lowSources.length && <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-rose-700">{Number(it.missing_qty)} <span className="text-slate-400 font-normal">{it.unit}</span></td>
                    <td className="px-3 py-2 text-right">{Number(it.stock_quantity)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{Number(it.open_production_qty) || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        value={planQty[it.key] ?? it.suggested_qty ?? 1}
                        onChange={(e) => setPlanQty({ ...planQty, [it.key]: e.target.value })}
                        className="w-20 bg-slate-50 border rounded-lg p-1.5 text-right font-bold"
                        data-testid={`missing-qty-${it.product_id || it.key}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {!it.has_recipe && it.product_id && (
                          <button onClick={() => setRecipeModal({ presetProductId: it.product_id })} className="px-2 py-1 border rounded-md font-semibold hover:bg-slate-50" data-testid={`missing-recipe-${it.product_id}`}>Reçete</button>
                        )}
                        <button
                          onClick={() => {
                            if (!it.product_id) { toast.error("Ürün kartı yok."); return; }
                            setOrderModal({
                              id: it.product_id,
                              name: it.product_name,
                              stock_quantity: it.stock_quantity,
                              min_stock_alert: it.min_stock_alert,
                              unit: it.unit,
                              _planQty: Number(planQty[it.key] || it.suggested_qty || 1),
                              _planNotes: (it.sources || []).filter((s) => s.order_number).map((s) => `Sipariş ${s.order_number}`).join(", "),
                            });
                          }}
                          className="px-2 py-1 bg-slate-900 text-white rounded-md font-semibold"
                          data-testid={`missing-produce-${it.product_id || it.key}`}
                        >
                          Emir ver
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "orders" && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="px-4 py-2">Emir</th><th className="px-4 py-2">Ürün</th><th className="px-4 py-2 text-right">Plan / Üretilen</th><th className="px-4 py-2">Tarih</th><th className="px-4 py-2 text-right">Maliyet</th><th className="px-4 py-2">Durum</th><th className="px-4 py-2 text-right">İşlem</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400" data-testid="po-loading">Yükleniyor…</td></tr>}
              {!loading && orders.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Üretim emri yok.</td></tr>}
              {!loading && orders.map((o) => { const [l, c, Icon] = STATUS[o.status] || STATUS.planned; const remaining = o.planned_quantity - (o.completed_quantity || 0); const canEditPlan = ["planned", "in_production"].includes(o.status); const draft = planDraft(o); const dirty = canEditPlan && (Number(draft.qty) !== Number(o.planned_quantity) || String(draft.recipe_id || "") !== String(o.recipe_id || "")); return (
                <tr key={o.id} data-testid={`po-row-${o.order_code}`}>
                  <td className="px-4 py-2 font-mono font-semibold text-slate-900">{o.order_code}{o.source === "stock_card" && <div className="text-[9px] text-slate-400 font-sans">Stok kartından</div>}{o.source === "order_pick" && <div className="text-[9px] text-amber-700 font-sans">Eksik ürün planından</div>}{o.source === "bom_shortage" && <div className="text-[9px] text-rose-700 font-sans">Hammadde eksğinden</div>}{o.source === "sales_order" && <div className="text-[9px] text-indigo-700 font-sans">Siparişten</div>}{o.notes && <div className="text-[10px] text-slate-400 font-sans truncate max-w-[160px]">{o.notes}</div>}</td>
                  <td className="px-4 py-2">
                    <div className="font-semibold">{o.finished_product_name}</div>
                    {canEditPlan && !(o.completed_quantity > 0) ? (
                      <select
                        value={draft.recipe_id || ""}
                        onChange={(e) => setPlanDraft(o, { recipe_id: e.target.value })}
                        onFocus={() => { if (!recipesLoaded) loadRecipes(); }}
                        className="mt-0.5 w-full max-w-[220px] bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 text-[10px] text-slate-700"
                        title="Reçete değiştir (plan dışı seçilebilir)"
                        data-testid={`po-recipe-${o.order_code}`}
                      >
                        {!draft.recipe_id && <option value="">Reçete seç…</option>}
                        {recipesForOrder(o).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}{r.finished_product_id !== o.finished_product_id ? ` · ${r.finished_product_name}` : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-[10px] text-slate-400">{o.recipe_name}</div>
                    )}
                    {o.shortages?.length > 0 && o.status !== "completed" && <div className="text-[10px] text-rose-600 font-semibold flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> {o.shortages.length} hammadde eksik</div>}
                  </td>
                  <td className="px-4 py-2 text-right font-bold" data-testid={`po-plan-cell-${o.order_code}`}>
                    {canEditPlan ? (
                      <div className="inline-flex flex-col items-end gap-0.5">
                        <div className="inline-flex items-center gap-1 justify-end">
                          <input
                            type="number"
                            min={Math.max(0.001, Number(o.completed_quantity) || 0.001)}
                            step="any"
                            value={draft.qty}
                            onChange={(e) => setPlanDraft(o, { qty: e.target.value })}
                            onFocus={() => setPlanDraft(o, {})}
                            className="w-16 bg-slate-50 border border-slate-200 rounded-md p-1 text-right font-bold"
                            title="Plan miktarını değiştir"
                            data-testid={`po-plan-qty-${o.order_code}`}
                          />
                          <span className="text-slate-400 font-normal">/</span>
                          <span className="text-emerald-700">{o.completed_quantity || 0}</span>
                        </div>
                        {dirty && (
                          <button
                            type="button"
                            onClick={() => saveOrderPlan(o, { planned_quantity: Number(draft.qty), recipe_id: draft.recipe_id || undefined })}
                            className="px-2 py-0.5 bg-indigo-600 text-white rounded-md text-[10px] font-semibold"
                            data-testid={`po-plan-save-${o.order_code}`}
                          >
                            Kaydet
                          </button>
                        )}
                      </div>
                    ) : (
                      <>{o.planned_quantity} / <span className="text-emerald-700">{o.completed_quantity || 0}</span></>
                    )}
                    {(() => {
                      const s = o.steps_summary;
                      if (!s?.total) return null;
                      const steps = Array.isArray(s.steps) ? s.steps : [];
                      return (
                        <div className="mt-0.5 text-right" data-testid={`po-steps-${o.order_code}`}>
                          <div className="text-[10px] font-normal text-slate-500">
                            Adım {s.done}/{s.total}{s.current_step_name ? ` • ${s.current_step_name}${s.current_operator ? ` (${s.current_operator})` : ""}` : ""}
                          </div>
                          {steps.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5" data-testid={`po-steps-list-${o.order_code}`}>
                              {steps.map((st) => (
                                <li
                                  key={`${st.no}-${st.name}`}
                                  className={`text-[10px] font-medium leading-tight ${st.done ? "text-emerald-600" : st.current ? "text-amber-700" : "text-slate-400"}`}
                                  data-testid={`po-step-${o.order_code}-${st.no}`}
                                >
                                  {st.no}. {st.name}{st.done ? " ✓" : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })()}
                    {o.over_produced && <div className="text-[10px] font-semibold text-amber-700">Plan üstü üretim</div>}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{o.planned_date || o.start_date}{o.end_date && <div className="text-[10px] text-emerald-600">Bitti: {o.end_date}</div>}</td>
                  <td className="px-4 py-2 text-right">{fmt(o.total_cost)} ₺</td>
                  <td className="px-4 py-2"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${c}`}><Icon className="w-3 h-3" /> {l}</span></td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-wrap justify-end items-center gap-1">
                      {o.status === "planned" && <button onClick={() => act(o.id, "start")} className="px-2 py-1 bg-amber-500 text-white rounded-md font-semibold" data-testid={`po-start-${o.order_code}`}>Başlat</button>}
                      {["planned", "in_production"].includes(o.status) && (
                        <button
                          type="button"
                          onClick={() => produceShortages(o)}
                          disabled={produceShortagesBusy === o.id}
                          className="px-2 py-1 bg-rose-600 text-white rounded-md font-semibold text-[10px] leading-tight disabled:opacity-50 max-w-[9.5rem] text-left"
                          title="Reçetedeki eksik hammaddeler için üretim emri aç"
                          data-testid={`po-produce-shortages-${o.order_code}`}
                        >
                          {produceShortagesBusy === o.id ? (
                            <span className="inline-flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Alınıyor…</span>
                          ) : (
                            "Eksik ürünleri üretime al"
                          )}
                        </button>
                      )}
                      {o.status === "in_production" && <><input type="number" min="0.001" step="any" value={completeQty[o.id] ?? remaining} onChange={(e) => setCompleteQty({ ...completeQty, [o.id]: e.target.value })} className="w-16 bg-slate-50 border rounded p-1 text-right" title="Tamamlanan miktar (plan üstü girilebilir)" data-testid={`po-complete-qty-${o.order_code}`} /><button onClick={() => act(o.id, "complete", { quantity: Number(completeQty[o.id] ?? remaining), update_cost: true, allow_over: true })} className="px-2 py-1 bg-emerald-600 text-white rounded-md font-semibold" data-testid={`po-complete-${o.order_code}`}>Tamamla</button></>}
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
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] text-slate-400">{r.code}</div>
                  <div className="font-bold text-slate-900 truncate flex items-center gap-1.5 flex-wrap">
                    <span className="truncate">{r.name}</span>
                    {r.one_time ? <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200" data-testid={`recipe-one-time-badge-${r.code}`}>Tek seferlik</span> : null}
                  </div>
                  <div className="text-slate-500 flex items-center gap-1"><Package className="w-3 h-3" /> {r.finished_product_name} • {r.target_quantity} {r.unit}</div>
                  {(r.contact_name || r.job_file_name) ? (
                    <div className="text-[11px] text-indigo-700 mt-0.5 space-y-0.5" data-testid={`recipe-customer-job-${r.code}`}>
                      {r.contact_name ? <div>Müşteri: <span className="font-semibold">{r.contact_name}</span></div> : null}
                      {r.job_file_name ? <div>İş dosyası: <span className="font-semibold">{r.job_file_name}</span></div> : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => copyRecipe(r)} className="p-1.5 border rounded-lg hover:bg-indigo-50 hover:border-indigo-200 text-slate-600 hover:text-indigo-700" title="Kopyala" data-testid={`recipe-copy-${r.code}`}><Copy className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => setRecipeModal({ recipe: r })} className="p-1.5 border rounded-lg hover:bg-slate-50" title="Düzenle" data-testid={`recipe-edit-${r.code}`}><Pencil className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => delRecipe(r)} className="p-1.5 border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50" title="Sil" data-testid={`recipe-delete-${r.code}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-2 divide-y divide-slate-100">{(r.materials || []).map((m, i) => { const mp = products.find((p) => p.id === m.product_id); const low = mp && mp.stock_quantity < m.quantity; return <div key={i} className="flex justify-between py-1"><span className={low ? "text-rose-600 font-semibold" : "text-slate-700"}>{m.product_name}{m.wastage_percent > 0 && <span className="text-slate-400"> (+%{m.wastage_percent} fire)</span>}</span><span className="font-semibold">{m.quantity} {m.unit}{mp && <span className="text-slate-400 font-normal"> / stok {mp.stock_quantity}</span>}</span></div>; })}</div>
              <div className="flex justify-between items-center pt-1"><div><div className="text-[10px] uppercase text-slate-400 font-semibold">Birim Maliyet</div><div className="font-black text-emerald-700 text-sm">{fmt(r.unit_cost || r.total_estimated_cost / (r.target_quantity || 1))} ₺</div>{fp?.sale_price > 0 && <div className="text-[10px] text-slate-500">Satış {fmt(fp.sale_price)} ₺</div>}</div><button onClick={() => setOrderModal(fp || { id: r.finished_product_id, name: r.finished_product_name })} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" data-testid={`recipe-produce-${r.code}`}><Factory className="w-3.5 h-3.5" /> Üret</button></div>
            </div>); })}
        </div>
      )}

      {recipeModal && <RecipeModal companyId={companyId} products={products} recipe={recipeModal.recipe} presetProductId={recipeModal.presetProductId} onClose={() => setRecipeModal(null)} onSaved={load} />}
      {orderModal && <ProductionOrderModal companyId={companyId} product={orderModal === true ? null : orderModal} recipes={orderModal === true ? recipes.filter((r) => r.is_active !== false) : null} onClose={() => setOrderModal(false)} onCreated={() => { load(); setParams({ tab: "orders" }); }} />}
      {orderMissingView && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setOrderMissingView(null)} data-testid="order-missing-modal-backdrop">
          <div
            className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-3 text-xs shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            data-testid="order-missing-modal"
          >
            <div className="flex justify-between items-start border-b pb-2 gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  Sipariş {orderMissingView.order_number || "—"} — eksik ürünler
                </h3>
                {orderMissingView.customer_name ? <p className="text-[11px] text-slate-500 mt-0.5">{orderMissingView.customer_name}</p> : null}
              </div>
              <button type="button" onClick={() => setOrderMissingView(null)} className="text-slate-400 hover:text-slate-700" data-testid="order-missing-close"><X className="w-5 h-5" /></button>
            </div>
            {!orderMissingLines.length ? (
              <p className="text-slate-400 py-6 text-center">Bu sipariş için eksik ürün bulunamadı.</p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden" data-testid="order-missing-list">
                {orderMissingLines.map((line) => (
                  <div key={line.key} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-white" data-testid={`order-missing-line-${line.product_id || line.key}`}>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{line.product_name}</div>
                      <div className="text-[10px] text-slate-400 flex gap-1.5">
                        {line.sku ? <span className="font-mono">{line.sku}</span> : null}
                        {line.has_recipe ? <span className="text-emerald-700 font-semibold">Reçeteli</span> : <span className="text-amber-700 font-semibold">Reçetesiz</span>}
                        <span>Stok {Number(line.stock_quantity)}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-black text-rose-700">{line.missing_qty} <span className="text-slate-400 font-normal">{line.unit}</span></div>
                      <div className="text-[10px] text-slate-400">eksik</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between items-center gap-2 border-t pt-2">
              <span className="text-slate-500 font-semibold">{orderMissingLines.length} kalem · {orderMissingLines.reduce((s, l) => s + Number(l.missing_qty || 0), 0)} adet eksik</span>
              <button type="button" onClick={() => setOrderMissingView(null)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" data-testid="order-missing-ok">Tamam</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
