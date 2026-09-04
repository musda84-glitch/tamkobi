import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  Truck,
  CheckCircle2,
  Printer,
  Plus,
  Search,
  ExternalLink,
  Package,
  X,
  Settings,
  QrCode
} from "lucide-react";
import { BarcodeRenderer } from "../components/BarcodeRenderer";

export default function CargoPage() {
  const { activeCompany } = useAuth();
  const [cargoConfigs, setCargoConfigs] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [showConfigModal, setShowConfigModal] = useState(null);

  const [catalog, setCatalog] = useState([]);
  const [addProv, setAddProv] = useState(null);
  const [creds, setCreds] = useState({});
  const loadCatalog = useCallback(() => axios.get(`${API_URL}/integrations/cargo/catalog?company_id=${activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}`).then((r) => setCatalog(r.data)).catch(() => {}), [activeCompany]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  const addProvider = async () => { try { const r = await axios.post(`${API_URL}/integrations/cargo`, { company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01", carrier_code: addProv.carrier_code, ...creds }); toast.success(r.data.message); setAddProv(null); setCreds({}); loadCatalog(); loadCargoData(); } catch (err) { toast.error(err.response?.data?.detail || "Eklenemedi."); } };
  const removeProvider = async (car) => { if (!window.confirm(`${car.carrier_name} kaldırılsın mı?`)) return; try { await axios.delete(`${API_URL}/integrations/cargo/${car.id}`); toast.success("Kaldırıldı."); loadCatalog(); loadCargoData(); } catch (err) { toast.error(err.response?.data?.detail || "Kaldırılamadı."); } };
  const loadCargoData = useCallback(async () => {
    try {
      setLoading(true);
      const [confRes, shipRes] = await Promise.all([
        axios.get(`${API_URL}/integrations/cargo?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/cargo/shipments?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`)
      ]);
      setCargoConfigs(confRes.data);
      setShipments(shipRes.data);
    } catch (err) {
      toast.error("Kargo verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);
  useEffect(() => { loadCargoData(); }, [loadCargoData]);

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`${API_URL}/integrations/cargo/${showConfigModal.id || showConfigModal._id}`, {
        ...showConfigModal,
        is_active: true,
        status: "connected"
      });
      toast.success(`${showConfigModal.carrier_name} entegrasyonu başarıyla kaydedildi.`);
      setShowConfigModal(null);
      loadCargoData();
    } catch (err) {
      toast.error("Kargo ayarları kaydedilemedi.");
    }
  };

  return (
    <div className="space-y-6" data-testid="cargo-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Kargo Entegrasyonları</h1>
          <p className="text-xs sm:text-sm text-slate-500">Kargo firmaları + kargo pazaryerleri (Navlungo, Geliver, Kolay Kargo, BasitKargo) API bağlantıları & barkodlu kargo fişi</p>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="cargo-catalog">
        <div className="flex items-center justify-between"><div><div className="text-sm font-bold text-slate-900">Sağlayıcı Ekle</div><div className="text-xs text-slate-500">Kargo pazaryerleri tüm firmaları tek API ile kapsar; anahtar girilene kadar SİMÜLE çalışır.</div></div></div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
          {catalog.map((c) => (
            <button key={c.carrier_code} onClick={() => { if (!c.installed) { setAddProv(c); setCreds({}); } }} disabled={c.installed} className={`text-left rounded-xl border-2 p-2.5 text-xs transition ${c.installed ? "border-emerald-200 bg-emerald-50/50 opacity-70" : c.kind === "marketplace" ? "border-violet-200 hover:border-violet-500 bg-violet-50/30" : "border-slate-200 hover:border-slate-400"}`} data-testid={`cargo-catalog-${c.carrier_code}`}>
              <div className="font-bold text-slate-900 leading-tight">{c.carrier_name.replace(" (Kargo Pazaryeri)", "").replace(" (Pazaryeri)", "").replace(" API", "")}</div>
              <div className={`text-[10px] font-semibold mt-1 ${c.kind === "marketplace" ? "text-violet-700" : "text-slate-400"}`}>{c.installed ? "✓ Ekli" : c.kind === "marketplace" ? "Kargo Pazaryeri" : "Kargo Firması"}</div>
              {c.desc && <div className="text-[10px] text-slate-500 mt-1 leading-tight">{c.desc}</div>}
            </button>
          ))}
        </div>
        {addProv && (
          <div className="border-t pt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end text-xs" data-testid="cargo-add-form">
            <div className="md:col-span-4 font-semibold text-slate-800">{addProv.carrier_name} — API bilgileri (isteğe bağlı; boş bırakılırsa simüle)</div>
            {addProv.fields.map((f) => <div key={f}><label className="block font-semibold mb-1 capitalize">{({ api_key: "API Key", api_secret: "API Secret", customer_number: "Müşteri No", api_username: "API Kullanıcı", api_password: "API Şifre" })[f] || f}</label><input type={f.includes("password") || f.includes("secret") ? "password" : "text"} value={creds[f] || ""} onChange={(e) => setCreds({ ...creds, [f]: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid={`cargo-cred-${f}`} /></div>)}
            <div className="flex gap-2"><button onClick={addProvider} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="cargo-add-submit">Ekle</button><button onClick={() => setAddProv(null)} className="px-3 py-2 border rounded-lg">İptal</button></div>
          </div>
        )}
      </div>

      {/* Cargo Carriers Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cargoConfigs.map((car) => {
          const isConnected = car.status === 'connected' && car.is_active;
          return (
            <div
              key={car.id || car._id}
              className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between space-y-3"
              data-testid={`cargo-carrier-${car.carrier_code}`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="p-2 rounded-xl bg-slate-100 text-slate-800">
                    <Truck className="w-5 h-5 text-indigo-600" />
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    isConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {isConnected ? 'API Bağlı' : 'Devre Dışı'}
                  </span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{car.carrier_name}</h3>
                  <div className="text-xs text-slate-500">Müşteri No: {car.customer_number || '-'}</div>
                </div>
              </div>

              <button
                onClick={() => setShowConfigModal(car)}
                className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 transition"
                data-testid={`cargo-settings-btn-${car.carrier_code}`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>API Yapılandır</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Shipments Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden space-y-3 p-5">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">Son Kargo Gönderileri & Takip</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-2.5">Kargo Firması & Takip No</th>
                <th className="px-4 py-2.5">Alıcı Müşteri</th>
                <th className="px-4 py-2.5">Varış Şehri</th>
                <th className="px-4 py-2.5">Kargo Durumu</th>
                <th className="px-4 py-2.5 text-center">Etiket / Fiş</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shipments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Henüz kargo gönderisi oluşturulmadı.</td>
                </tr>
              ) : (
                shipments.map((shp) => (
                  <tr key={shp.id || shp._id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-slate-900">{shp.carrier_name}</div>
                      <div className="font-mono text-indigo-600 text-[11px] font-semibold">{shp.tracking_number}</div>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{shp.customer_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{shp.city}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        <CheckCircle2 className="w-3 h-3" />
                        {shp.status === 'in_transit' ? 'Taşımada / Yolda' : shp.status === 'delivered' ? 'Teslim Edildi' : 'Kargoya Verildi'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => setSelectedLabel(shp)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
                        data-testid={`print-cargo-label-btn-${shp.tracking_number}`}
                      >
                        <Printer className="w-3.5 h-3.5" /> Etiket Yazdır
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PRINTABLE CARGO LABEL MODAL */}
      {selectedLabel && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-200 text-center" data-testid="cargo-label-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-sm font-bold text-slate-900">Kargo Taşıma Etiketi</h3>
              <button onClick={() => setSelectedLabel(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-2 border-slate-900 rounded-xl bg-white space-y-3 text-left">
              <div className="flex justify-between items-center border-b pb-2">
                <span className="font-bold text-base text-slate-900">{selectedLabel.carrier_name}</span>
                <span className="text-xs font-mono font-bold bg-slate-100 px-2 py-0.5 rounded">STANDART GÖNDERİ</span>
              </div>
              <div className="text-xs space-y-1">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">ALICI:</div>
                <div className="font-bold text-slate-900">{selectedLabel.customer_name}</div>
                <div className="text-slate-600 text-[11px]">{selectedLabel.address} / {selectedLabel.city}</div>
              </div>
              <div className="pt-2 border-t flex flex-col items-center">
                <BarcodeRenderer code={selectedLabel.barcode || "8690001928371"} width={200} height={45} />
                <span className="text-xs font-mono font-bold text-slate-800 mt-1">Takip No: {selectedLabel.tracking_number}</span>
              </div>
            </div>

            <div className="flex justify-center gap-2 pt-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800"
              >
                <Printer className="w-3.5 h-3.5" /> Termal Etiket Yazdır
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CARRIER CONFIG MODAL */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">{showConfigModal.carrier_name} API Ayarları</h3>
              <button onClick={() => setShowConfigModal(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveConfig} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Müşteri / Anlaşma Numarası</label>
                <input
                  type="text"
                  value={showConfigModal.customer_number || ""}
                  onChange={(e) => setShowConfigModal({ ...showConfigModal, customer_number: e.target.value })}
                  placeholder="Örn: YK-9948210"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  data-testid="cargo-cust-num-input"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">API Kullanıcı Adı</label>
                <input
                  type="text"
                  value={showConfigModal.api_username || ""}
                  onChange={(e) => setShowConfigModal({ ...showConfigModal, api_username: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">API Şifresi</label>
                <input
                  type="password"
                  value={showConfigModal.api_password || ""}
                  onChange={(e) => setShowConfigModal({ ...showConfigModal, api_password: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(null)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-cargo-config-btn"
                >
                  Kaydet & Bağlan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
