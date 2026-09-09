import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { ProductMappingPanel } from "../components/ProductMappingPanel";
import { ChannelCatalogModal, CHANNEL_FIELD_LABELS } from "../components/ChannelCatalogModal";

import {
  ShoppingCart,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Settings,
  Sparkles,
  Zap,
  X,
  Layers,
  ArrowDown
} from "lucide-react";

export default function EcommercePage() {
  const { activeCompany } = useAuth();
  const [integrations, setIntegrations] = useState([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState(null);
  const [testingId, setTestingId] = useState(null);

  // Settings Modal
  const [selectedConfig, setSelectedConfig] = useState(null);

  const loadIntegrations = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/integrations/ecommerce?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`);
      setIntegrations(res.data);
    } catch (err) {
      toast.error("Entegrasyonlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);
  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

  const handleTestConnection = async (channelId) => {
    try {
      setTestingId(channelId);
      const res = await axios.post(`${API_URL}/integrations/ecommerce/${channelId}/test-connection`);
      if (res.data.status === "success") {
        toast.success(res.data.message);
      } else {
        toast.error(res.data.message);
      }
      loadIntegrations();
    } catch (err) {
      toast.error("Bağlantı testi başarısız.");
    } finally {
      setTestingId(null);
    }
  };

  const handleSyncNow = async (channelId) => {
    try {
      setSyncingId(channelId);
      const res = await axios.post(`${API_URL}/integrations/ecommerce/${channelId}/sync-now`);
      toast.success(res.data.message);
      loadIntegrations();
    } catch (err) {
      toast.error("Senkronizasyon sırasında hata oluştu.");
    } finally {
      setSyncingId(null);
    }
  };

  const [accounts, setAccounts] = useState([]);
  const [rest, setRest] = useState({ email: "", password: "", auto: true });
  useEffect(() => { if (selectedConfig) setRest({ email: selectedConfig.rest_email || "", password: "", auto: selectedConfig.rest_auto_push !== false }); }, [selectedConfig?.id, selectedConfig?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveRest = async () => { try { const r = await axios.put(`${API_URL}/integrations/ecommerce/${selectedConfig.id || selectedConfig._id}/rest-credentials`, { rest_email: rest.email, rest_password: rest.password || undefined, rest_auto_push: rest.auto }); setSelectedConfig({ ...selectedConfig, rest_email: r.data.rest_email, rest_configured: r.data.rest_configured, rest_auto_push: r.data.rest_auto_push }); toast.success("REST bilgileri kaydedildi."); loadIntegrations(); } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } };
  const testRest = async () => { try { if (rest.password) await saveRest(); const r = await axios.post(`${API_URL}/integrations/ecommerce/${selectedConfig.id || selectedConfig._id}/rest-test`); toast.success(r.data.message); } catch (e) { toast.error(e.response?.data?.detail || "REST testi başarısız."); } };
  useEffect(() => { axios.get(`${API_URL}/banking/accounts?company_id=${activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}`).then((r) => setAccounts(r.data)).catch(() => {}); }, [activeCompany]);
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    try {
      const { settlement_account_id, settlement_account_name, ...rest } = selectedConfig;
      await axios.put(`${API_URL}/integrations/ecommerce/${selectedConfig.id || selectedConfig._id}`, rest);
      await axios.put(`${API_URL}/integrations/ecommerce/${selectedConfig.id || selectedConfig._id}/settlement-account`, { account_id: settlement_account_id || null });
      toast.success(`${selectedConfig.channel_name} ayarları kaydedildi.`);
      setSelectedConfig(null);
      loadIntegrations();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ayarlar kaydedilemedi.");
    }
  };

  const channelLogos = {
    trendyol: "https://cdn.dsmcdn.com/web/logo/ty-web.svg",
    hepsiburada: "https://images.hepsiburada.net/assets/sfstatic/Content/images/favicon.ico",
    amazon: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg",
    shopify: "https://cdn.iconscout.com/icon/free/png-256/free-shopify-1869030-1583156.png",
    n11: "https://cdn.iconscout.com/icon/free/png-256/free-n11-3628929-3030097.png",
    woocommerce: "https://woocommerce.com/wp-content/themes/woo/images/logo-woocommerce.svg"
  };

  return (
    <div className="space-y-6" data-testid="ecommerce-page">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">E-Ticaret Entegrasyon Merkezi</h1>
          <p className="text-xs sm:text-sm text-slate-500">Pazaryerleri & Web Siteleri ile 2 Yönlü Sipariş, Stok ve E-Fatura Eşitleme</p>
        </div>
        <button onClick={() => setCatalogOpen(true)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 self-start" data-testid="add-channel-btn"><Layers className="w-4 h-4" /> Kanal Ekle (69 kanal)</button>
      </div>
      {catalogOpen && <ChannelCatalogModal companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onClose={() => setCatalogOpen(false)} onAdded={loadIntegrations} />}

      {/* Info Banner */}
      <div className="bg-indigo-50/80 border border-indigo-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-indigo-950">
        <Zap className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Otomatik API Bağlantısı:</span> API anahtarlarınızı kaydettiğiniz andan itibaren siparişler otomatik çekilir, E-Arşiv/E-Faturası anında kesilir ve stoklar tüm pazaryerlerinde eş zamanlı güncellenir.
        </div>
      </div>

      {/* Channels Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {integrations.map((ch) => {
          const isConnected = ch.status === "connected" && ch.is_active;
          const isSyncing = syncingId === (ch.id || ch._id);
          const isTesting = testingId === (ch.id || ch._id);

          return (
            <div
              key={ch.id || ch._id}
              className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4"
              data-testid={`channel-card-${ch.channel}`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-base text-slate-900 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: isConnected ? '#10b981' : '#cbd5e1' }}></span>
                    {ch.channel_name}
                  </div>
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                    isConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {isConnected ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {isConnected ? 'Bağlantı Aktif' : 'Bağlı Değil'}
                  </span>
                </div>

                <div className="text-xs text-slate-600 space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Satıcı / Mağaza ID:</span>
                    <span className="font-mono font-semibold text-slate-800">{ch.supplier_id || 'Tanımlanmadı'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Oto Fatura:</span>
                    <span className="font-semibold text-emerald-700">{ch.auto_create_invoice ? 'Açık' : 'Kapalı'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Son Senkronizasyon:</span>
                    <span className="font-mono text-[11px]">{ch.last_synced_at ? new Date(ch.last_synced_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'Yapılmadı'}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => setSelectedConfig(ch)}
                  className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                  data-testid={`config-btn-${ch.channel}`}
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Ayarlar</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTestConnection(ch.id || ch._id)}
                    disabled={isTesting}
                    className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                    data-testid={`test-btn-${ch.channel}`}
                  >
                    {isTesting ? 'Test Ediliyor...' : 'Test Et'}
                  </button>

                  <button
                    onClick={() => handleSyncNow(ch.id || ch._id)}
                    disabled={isSyncing}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm flex items-center gap-1.5 transition"
                    data-testid={`sync-btn-${ch.channel}`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Çekiliyor...' : 'Sipariş Çek'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CONFIG MODAL */}
      {selectedConfig && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="ecommerce-config-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">{selectedConfig.channel_name} Entegrasyon Ayarları</h3>
              <button onClick={() => setSelectedConfig(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveConfig} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{CHANNEL_FIELD_LABELS[selectedConfig.channel]?.api_key || "API Key / Satıcı Anahtarı"}</label>
                <input
                  type="text"
                  value={selectedConfig.api_key || ""}
                  onChange={(e) => setSelectedConfig({ ...selectedConfig, api_key: e.target.value })}
                  placeholder="API Key yapıştırın"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  data-testid="api-key-input"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{CHANNEL_FIELD_LABELS[selectedConfig.channel]?.api_secret || "API Secret / Şifre"}</label>
                <input
                  type="password"
                  value={selectedConfig.api_secret || ""}
                  onChange={(e) => setSelectedConfig({ ...selectedConfig, api_secret: e.target.value })}
                  placeholder="API Secret yapıştırın"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                  data-testid="api-secret-input"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{CHANNEL_FIELD_LABELS[selectedConfig.channel]?.supplier_id || "Satıcı ID / Merchant ID"}</label>
                <input
                  type="text"
                  value={selectedConfig.supplier_id || ""}
                  onChange={(e) => setSelectedConfig({ ...selectedConfig, supplier_id: e.target.value })}
                  placeholder="Örn: 184920"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  data-testid="supplier-id-input"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{CHANNEL_FIELD_LABELS[selectedConfig.channel]?.store_url || "Mağaza Web Adresi"}</label>
                <input
                  type="text"
                  value={selectedConfig.store_url || ""}
                  onChange={(e) => setSelectedConfig({ ...selectedConfig, store_url: e.target.value })}
                  placeholder="https://..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>

              {selectedConfig.channel === "shopphp" && (
                <div className="pt-2 border-t space-y-2" data-testid="shopphp-rest-section">
                  <div className="font-semibold text-slate-800">Mağazaya Geri Bildirim (ShopPHP REST API)</div>
                  <p className="text-[10px] text-slate-500">Sipariş onayı, kargo firması/takip no ve fatura numarası otomatik mağazaya yazılır. ShopPHP Yönetim → Ayarlar → REST API'yi açın; "Rest API kullanabilir" izinli bir yönetici kullanıcının e-posta/parolasını girin.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input value={rest.email} onChange={(e) => setRest({ ...rest, email: e.target.value })} placeholder="REST kullanıcı e-postası" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="shopphp-rest-email" />
                    <input type="password" value={rest.password} onChange={(e) => setRest({ ...rest, password: e.target.value })} placeholder={selectedConfig.rest_configured ? "Parola kayıtlı (değiştirmek için yazın)" : "REST kullanıcı parolası"} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="shopphp-rest-password" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={rest.auto} onChange={(e) => setRest({ ...rest, auto: e.target.checked })} data-testid="shopphp-rest-auto" /> Otomatik bildir (onay / kargo / fatura)</label>
                    <button type="button" onClick={saveRest} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="shopphp-rest-save">REST Bilgilerini Kaydet</button>
                    <button type="button" onClick={testRest} disabled={!selectedConfig.rest_configured && !rest.password} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="shopphp-rest-test">REST Test</button>
                    {selectedConfig.rest_configured && <span className="text-[10px] text-emerald-700 font-semibold" data-testid="shopphp-rest-ok">REST kayıtlı</span>}
                  </div>
                </div>)}
              <div className="pt-2 border-t">
                <label className="block font-semibold text-slate-700 mb-1">Ödeme / Hakediş Hesabı</label>
                <select value={selectedConfig.settlement_account_id || ""} onChange={(e) => setSelectedConfig({ ...selectedConfig, settlement_account_id: e.target.value || null })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="ecom-settlement-select">
                  <option value="">Hesap seçilmedi — fatura yalnızca "ödendi" işaretlenir</option>
                  {accounts.filter((a) => a.type !== "credit_card").map((a) => <option key={a.id} value={a.id} disabled={a.is_integrated}>{a.account_name}{a.is_integrated ? " (entegre — seçilemez)" : ""}</option>)}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">Sipariş faturalandığında net hakediş (ciro − komisyon − hizmet/kargo) bu hesaba tahsilat olarak işlenir; kesintiler "Pazaryeri Komisyonu" masrafına yazılır.</p>
              </div>
              <div className="space-y-2 pt-2 border-t">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedConfig.auto_sync_orders}
                    onChange={(e) => setSelectedConfig({ ...selectedConfig, auto_sync_orders: e.target.checked })}
                    className="rounded text-emerald-600"
                  />
                  <span>Siparişleri otomatik çek</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedConfig.auto_create_invoice}
                    onChange={(e) => setSelectedConfig({ ...selectedConfig, auto_create_invoice: e.target.checked })}
                    className="rounded text-emerald-600"
                  />
                  <span>Sipariş geldiğinde otomatik E-Arşiv fatura kes</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setSelectedConfig(null)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-ecommerce-config-btn"
                >
                  Kaydet & Bağlan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="pt-4 border-t border-slate-200">
        <h2 className="text-base font-bold text-slate-900 mb-3">Ürün Eşleştirme (Pazaryeri SKU ↔ Stok Kartı)</h2>
        <ProductMappingPanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
      </div>
    </div>
  );
}
