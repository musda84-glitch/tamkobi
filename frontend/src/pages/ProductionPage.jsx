import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  Factory,
  Plus,
  Play,
  CheckCircle2,
  Clock,
  Layers,
  Sparkles,
  AlertCircle,
  X,
  FileSpreadsheet
} from "lucide-react";

export default function ProductionPage() {
  const { activeCompany } = useAuth();
  const [recipes, setRecipes] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);

  // New Production Order Form
  const [orderForm, setOrderForm] = useState({
    recipe_id: "",
    planned_quantity: 10,
    target_warehouse_id: "wh_main"
  });

  useEffect(() => {
    loadProductionData();
  }, [activeCompany]);

  const loadProductionData = async () => {
    try {
      setLoading(true);
      const [recRes, ordRes, prodRes] = await Promise.all([
        axios.get(`${API_URL}/production/recipes?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/production/orders?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/products?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`)
      ]);
      setRecipes(recRes.data);
      setProductionOrders(ordRes.data);
      setProducts(prodRes.data);
      if (recRes.data.length > 0) {
        setOrderForm(prev => ({ ...prev, recipe_id: recRes.data[0].id || recRes.data[0]._id }));
      }
    } catch (err) {
      toast.error("Üretim verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProductionOrder = async (e) => {
    e.preventDefault();
    const r = recipes.find(rec => (rec.id === orderForm.recipe_id || rec._id === orderForm.recipe_id));
    if (!r) {
      toast.error("Lütfen bir reçete seçin.");
      return;
    }
    try {
      await axios.post(`${API_URL}/production/orders`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        recipe_id: r.id || r._id,
        recipe_name: r.name,
        finished_product_id: r.finished_product_id,
        finished_product_name: r.finished_product_name,
        planned_quantity: Number(orderForm.planned_quantity),
        target_warehouse_id: orderForm.target_warehouse_id,
        total_cost: (r.total_estimated_cost || 0) * Number(orderForm.planned_quantity),
        status: "in_production"
      });
      toast.success("Üretim emri açıldı ve üretime başlandı.");
      setShowOrderModal(false);
      loadProductionData();
    } catch (err) {
      toast.error("Üretim emri oluşturulamadı.");
    }
  };

  const handleCompleteOrder = async (orderId) => {
    try {
      const res = await axios.post(`${API_URL}/production/orders/${orderId}/complete`);
      toast.success(res.data.message);
      loadProductionData();
    } catch (err) {
      toast.error("Üretim tamamlanamadı.");
    }
  };

  return (
    <div className="space-y-6" data-testid="production-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Üretim & Reçete (BOM) Yönetimi</h1>
          <p className="text-xs sm:text-sm text-slate-500">Ürün Reçeteleri, Hammadde Maliyetleri ve Otomatik Stok Giriş/Çıkış Emirleri</p>
        </div>
        <button
          onClick={() => setShowOrderModal(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition self-start sm:self-auto"
          data-testid="start-production-order-btn"
        >
          <Play className="w-4 h-4" />
          <span>Yeni Üretim Emri Aç</span>
        </button>
      </div>

      {/* Recipes Cards */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
          <span>Tanımlı Üretim Reçeteleri (BOM)</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recipes.map((rec) => (
            <div
              key={rec.id || rec._id}
              className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-3"
              data-testid={`recipe-card-${rec.code}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                    {rec.code}
                  </span>
                  <h3 className="font-bold text-slate-900 text-sm mt-1">{rec.name}</h3>
                  <div className="text-xs text-slate-500 font-semibold mt-0.5">
                    Mamul: <span className="text-slate-900">{rec.finished_product_name}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Birim Maliyet</div>
                  <div className="text-base font-bold text-emerald-600">{rec.total_estimated_cost?.toLocaleString('tr-TR')} ₺</div>
                </div>
              </div>

              {/* Recipe items */}
              <div className="space-y-1 pt-2 border-t border-slate-100 text-xs">
                <span className="font-semibold text-slate-700 text-[11px]">Kullanılan Hammaddeler:</span>
                {rec.materials?.map((m, idx) => (
                  <div key={idx} className="flex justify-between text-slate-600">
                    <span>• {m.product_name}</span>
                    <span className="font-mono">{m.quantity} {m.unit} x {m.cost_per_unit} ₺</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Production Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden space-y-3 p-5">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Factory className="w-4 h-4 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900">Aktif & Geçmiş Üretim Emirleri</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-2.5">Emir No & Tarih</th>
                <th className="px-4 py-2.5">Üretilen Mamul</th>
                <th className="px-4 py-2.5 text-center">Planlanan Miktar</th>
                <th className="px-4 py-2.5 text-right">Toplam Maliyet</th>
                <th className="px-4 py-2.5">Üretim Durumu</th>
                <th className="px-4 py-2.5 text-center">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productionOrders.map((ord) => (
                <tr key={ord.id || ord._id} className="hover:bg-slate-50/70 transition" data-testid={`prod-order-row-${ord.order_code}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-slate-900 font-mono">{ord.order_code}</div>
                    <div className="text-slate-400 text-[11px]">{ord.start_date}</div>
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{ord.finished_product_name}</td>
                  <td className="px-4 py-2.5 text-center font-bold text-indigo-700">{ord.planned_quantity} Adet</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                    {ord.total_cost?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      ord.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {ord.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {ord.status === 'completed' ? 'Üretim Tamamlandı' : 'Üretimde / Montajda'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {ord.status !== 'completed' ? (
                      <button
                        onClick={() => handleCompleteOrder(ord.id || ord._id)}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm"
                        data-testid={`complete-order-btn-${ord.order_code}`}
                      >
                        Üretimi Bitir & Stoğa Ekle
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400 font-medium">Bitti ({ord.end_date})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* START PRODUCTION ORDER MODAL */}
      {showOrderModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="start-production-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Yeni Üretim Emri Oluştur</h3>
              <button onClick={() => setShowOrderModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateProductionOrder} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Kullanılacak Reçete (BOM)</label>
                <select
                  value={orderForm.recipe_id}
                  onChange={(e) => setOrderForm({ ...orderForm, recipe_id: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="production-recipe-select"
                >
                  {recipes.map(r => (
                    <option key={r.id || r._id} value={r.id || r._id}>
                      {r.name} ({r.finished_product_name})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Üretilecek Miktar (Adet)</label>
                <input
                  type="number"
                  min="1"
                  value={orderForm.planned_quantity}
                  onChange={(e) => setOrderForm({ ...orderForm, planned_quantity: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900 text-sm"
                  data-testid="production-qty-input"
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900">
                <p className="font-semibold text-[11px]">Otomatik Stok Entegrasyonu:</p>
                <p className="text-[11px] mt-0.5">
                  Üretim tamamlandığında reçetedeki gerekli hammaddeler (çip, batarya, kasa) stoktan otomatik düşülecek ve bitmiş mamul stoğu artırılacaktır.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowOrderModal(false)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="confirm-start-production-btn"
                >
                  Emri Başlat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
