import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { StockCountPanel } from "../components/StockCountPanel";

import {
  Building2,
  ArrowRightLeft,
  Plus,
  Boxes,
  MapPin,
  User,
  X,
  History,
  CheckCircle2
  , ClipboardList
} from "lucide-react";

export default function WarehousePage() {
  const { activeCompany } = useAuth();
  const [warehouses, setWarehouses] = useState([]);
  const [showCount, setShowCount] = useState(false);
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "warehouses");
  const [transfers, setTransfers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Transfer Form
  const [transferForm, setTransferForm] = useState({
    source_warehouse_id: "",
    target_warehouse_id: "",
    product_id: "",
    quantity: 1,
    notes: "Şubeler arası stok sevkiyatı"
  });

  // New Warehouse Form
  const [newWarehouse, setNewWarehouse] = useState({
    name: "",
    code: "",
    location: "",
    manager_name: ""
  });

  const loadWarehouseData = useCallback(async () => {
    try {
      setLoading(true);
      const [whRes, trRes, prodRes] = await Promise.all([
        axios.get(`${API_URL}/warehouses?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/warehouses/transfers?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/products?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`)
      ]);
      setWarehouses(whRes.data);
      setTransfers(trRes.data);
      setProducts(prodRes.data);
      if (whRes.data.length >= 2) {
        setTransferForm(prev => ({
          ...prev,
          source_warehouse_id: whRes.data[0].id || whRes.data[0]._id,
          target_warehouse_id: whRes.data[1].id || whRes.data[1]._id,
          product_id: prodRes.data[0]?.id || prodRes.data[0]?._id || ""
        }));
      }
    } catch (err) {
      toast.error("Depo verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);
  useEffect(() => { loadWarehouseData(); }, [loadWarehouseData]);

  const handleSaveWarehouse = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/warehouses`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        ...newWarehouse
      });
      toast.success("Yeni depo başarıyla tanımlandı.");
      setShowAddModal(false);
      loadWarehouseData();
    } catch (err) {
      toast.error("Depo kaydedilemedi.");
    }
  };

  const handleExecuteTransfer = async (e) => {
    e.preventDefault();
    if (!transferForm.product_id || Number(transferForm.quantity) <= 0) {
      toast.error("Lütfen geçerli ürün ve miktar seçin.");
      return;
    }
    const p = products.find(prod => (prod.id === transferForm.product_id || prod._id === transferForm.product_id));
    try {
      await axios.post(`${API_URL}/warehouses/transfer`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        product_name: p?.name || "Ürün",
        ...transferForm,
        quantity: Number(transferForm.quantity)
      });
      toast.success("Depolar arası stok transferi tamamlandı ve sevk irsaliyesi oluşturuldu.");
      setShowTransferModal(false);
      loadWarehouseData();
    } catch (err) {
      toast.error("Transfer gerçekleştirilemedi.");
    }
  };

  return (
    <div className="space-y-6" data-testid="warehouses-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Depo & Transfer Yönetimi</h1>
          <p className="text-xs sm:text-sm text-slate-500">Çoklu Depo / Şube Yönetimi, Stok Transferi ve Sevk İrsaliyeleri</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button onClick={() => setShowCount(!showCount)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition ${showCount ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`} data-testid="toggle-stock-count-btn">
            <span>Gelişmiş Stok Sayımı</span>
          </button>
          <button
            onClick={() => setShowTransferModal(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-indigo-600/20 transition"
            data-testid="open-transfer-modal-btn"
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span>Stok Transferi Yap</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition"
            data-testid="add-warehouse-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Depo Ekle</span>
          </button>
        </div>
      </div>
      {showCount && <div data-testid="warehouse-stock-count"><StockCountPanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} warehouses={warehouses} /></div>}

      <div className="flex items-center gap-1 border-b border-slate-200">
        {[["warehouses", "Depolar & Transferler", Building2], ["count", "Stok Sayımı (Stoklar sayfasına taşındı)", ClipboardList]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`warehouse-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l}</button>
        ))}
      </div>
      {tab === "count" && <div className="bg-white border border-dashed rounded-2xl p-8 text-center text-xs text-slate-500">Stok sayımı artık <a href="/stock?tab=count" className="text-emerald-700 font-semibold underline" data-testid="goto-stock-count-link">Stoklar & Ürünler → Barkodlu Stok Sayımı</a> sekmesinde.</div>}
      {tab === "warehouses" && (<>
      {/* Warehouses Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {warehouses.map((wh) => (
          <div
            key={wh.id || wh._id}
            className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-3 flex flex-col justify-between"
            data-testid={`warehouse-card-${wh.code}`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Building2 className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                  {wh.code}
                </span>
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{wh.name}</h3>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span>{wh.location}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>Sorumlu: {wh.manager_name || 'Atanmadı'}</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400">Durum:</span>
              <span className="text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Aktif Depo
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Transfers History Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden space-y-3 p-5">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">Son Depo Sevk Transferleri</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-2.5">Transfer No & Tarih</th>
                <th className="px-4 py-2.5">Transfer Edilen Ürün</th>
                <th className="px-4 py-2.5 text-center">Miktar</th>
                <th className="px-4 py-2.5">Açıklama / İrsaliye</th>
                <th className="px-4 py-2.5 text-center">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Henüz transfer kaydı bulunmuyor.</td>
                </tr>
              ) : (
                transfers.map((tr) => (
                  <tr key={tr.id || tr._id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-slate-900 font-mono">{tr.transfer_number}</div>
                      <div className="text-slate-400 text-[11px]">{tr.transfer_date?.split("T")[0]}</div>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{tr.product_name}</td>
                    <td className="px-4 py-2.5 text-center font-bold text-indigo-700">{tr.quantity} Adet</td>
                    <td className="px-4 py-2.5 text-slate-600">{tr.notes}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-[11px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                        Tamamlandı
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      </>)}

      {/* TRANSFER MODAL */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="transfer-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Depolar Arası Stok Sevk Transferi</h3>
              <button onClick={() => setShowTransferModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleExecuteTransfer} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Transfer Edilecek Ürün</label>
                <select
                  value={transferForm.product_id}
                  onChange={(e) => setTransferForm({ ...transferForm, product_id: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="transfer-product-select"
                >
                  {products.map(p => (
                    <option key={p.id || p._id} value={p.id || p._id}>
                      {p.name} (Mevcut Stok: {p.stock_quantity} {p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kaynak Depo (Çıkış)</label>
                  <select
                    value={transferForm.source_warehouse_id}
                    onChange={(e) => setTransferForm({ ...transferForm, source_warehouse_id: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  >
                    {warehouses.map(w => (
                      <option key={w.id || w._id} value={w.id || w._id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hedef Depo (Giriş)</label>
                  <select
                    value={transferForm.target_warehouse_id}
                    onChange={(e) => setTransferForm({ ...transferForm, target_warehouse_id: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  >
                    {warehouses.map(w => (
                      <option key={w.id || w._id} value={w.id || w._id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Transfer Miktarı</label>
                <input
                  type="number"
                  min="1"
                  value={transferForm.quantity}
                  onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900"
                  data-testid="transfer-quantity-input"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Sevk Notu / İrsaliye Açıklaması</label>
                <input
                  type="text"
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="confirm-transfer-btn"
                >
                  Transferi Başlat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD WAREHOUSE MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Yeni Depo / Şube Tanımla</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveWarehouse} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Depo Adı</label>
                <input
                  type="text"
                  placeholder="Örn: Ege Bölge Lojistik Deposu"
                  value={newWarehouse.name}
                  onChange={(e) => setNewWarehouse({ ...newWarehouse, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="warehouse-name-input"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Depo Kodu</label>
                  <input
                    type="text"
                    placeholder="Örn: DEP-04"
                    value={newWarehouse.code}
                    onChange={(e) => setNewWarehouse({ ...newWarehouse, code: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Depo Sorumlusu</label>
                  <input
                    type="text"
                    placeholder="Ad Soyad"
                    value={newWarehouse.manager_name}
                    onChange={(e) => setNewWarehouse({ ...newWarehouse, manager_name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Konum / Lokasyon</label>
                <input
                  type="text"
                  placeholder="Örn: Bornova / İzmir"
                  value={newWarehouse.location}
                  onChange={(e) => setNewWarehouse({ ...newWarehouse, location: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-warehouse-btn"
                >
                  Depoyu Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
