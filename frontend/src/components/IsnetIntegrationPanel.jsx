import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Plug, Save } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

/**
 * İşNet Net-e Fatura (NetteFatura) bağlantı paneli.
 * Kaydet / test: /api/integrations/isnet/save|test
 */
export default function IsnetIntegrationPanel({ companyId }) {
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [testMode, setTestMode] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [status, setStatus] = useState("simulated");
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    client_code: "",
    gib_alias: "",
    company_tax_id: "",
    company_vendor_number: "",
  });

  const load = useCallback(async () => {
    if (!companyId) return;
    setBooting(true);
    try {
      const r = await axios.get(`${API_URL}/einvoice/settings`, { params: { company_id: companyId } });
      const d = r.data || {};
      setFormData({
        username: d.username || "",
        password: "",
        client_code: d.corporate_code || "",
        gib_alias: d.alias || "",
        company_tax_id: d.company_tax_id || "",
        company_vendor_number: d.company_vendor_number || "",
      });
      setTestMode((d.mode || "test") !== "live");
      setHasPassword(Boolean(d.has_password));
      setStatus(d.status || "simulated");
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşNet ayarları alınamadı.");
    } finally {
      setBooting(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const body = () => ({
    company_id: companyId,
    test_mode: testMode,
    username: formData.username,
    password: formData.password,
    client_code: formData.client_code,
    gib_alias: formData.gib_alias,
    company_tax_id: formData.company_tax_id,
    company_vendor_number: formData.company_vendor_number,
  });

  const handleTestConnection = async () => {
    setLoading(true);
    try {
      const r = await axios.post(`${API_URL}/integrations/isnet/test`, body());
      toast.success(r.data?.message || "İşNet Net-e Fatura bağlantı testi başarılı!");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Bağlantı kurulamadı, bilgilerinizi kontrol edin.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await axios.post(`${API_URL}/integrations/isnet/save`, body());
      setStatus(r.data?.status || "configured");
      setHasPassword(Boolean(r.data?.has_password));
      setFormData((prev) => ({ ...prev, password: "" }));
      toast.success("İşNet Net-e Fatura ayarları kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ayarlar kaydedilirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  if (booting) {
    return <div className="text-xs text-slate-400 p-4" data-testid="isnet-loading">Yükleniyor…</div>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs max-w-xl" data-testid="isnet-integration-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">İşNet Net-e Fatura Entegrasyonu</h3>
          <p className="text-slate-500 mt-0.5">İşNet e-Fatura servis sağlayıcısı bağlantı ve kimlik ayarları.</p>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${status === "configured" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}
          data-testid="isnet-status"
        >
          {status === "configured" ? "YAPILANDIRILDI" : "SİMÜLE"}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTestMode(true)}
          className={`px-3 py-1.5 rounded-lg font-semibold border transition ${testMode ? "bg-amber-500 text-white border-amber-500" : "bg-slate-50 text-slate-700 border-slate-200"}`}
          data-testid="isnet-mode-test"
        >
          Test Ortamı
        </button>
        <button
          type="button"
          onClick={() => setTestMode(false)}
          className={`px-3 py-1.5 rounded-lg font-semibold border transition ${!testMode ? "bg-emerald-600 text-white border-emerald-600" : "bg-slate-50 text-slate-700 border-slate-200"}`}
          data-testid="isnet-mode-live"
        >
          Canlı Ortam
        </button>
      </div>
      <p className="text-[10px] text-slate-500">
        SOAP:{" "}
        <span className="font-mono">
          {testMode ? "einvoiceservicetest.isnet.net.tr" : "einvoiceservice.isnet.net.tr"}
        </span>
        {" · "}Portal API:{" "}
        <span className="font-mono">
          {testMode ? "einvoiceapitest.isnet.net.tr" : "einvoiceapi.isnet.net.tr"}
        </span>
        {" · "}
        <a
          href="https://github.com/EfeSorogluu/NetteFatura-API"
          target="_blank"
          rel="noreferrer"
          className="underline text-slate-600"
        >
          NetteFatura-API
        </a>
      </p>

      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="block font-semibold mb-1">Müşteri Kodu / Firma Kodu</label>
          <input
            type="text"
            name="client_code"
            value={formData.client_code}
            onChange={handleChange}
            placeholder="İşNet müşteri kodunuz"
            className={inputCls}
            required
            data-testid="isnet-client-code"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Kullanıcı Adı (API Kullanıcısı)</label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleChange}
            placeholder="Net-e Fatura API kullanıcı adınız"
            className={inputCls}
            required
            data-testid="isnet-username"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">
            Şifre {hasPassword && <span className="text-slate-400 font-normal">(kayıtlı — değiştirmek için yazın)</span>}
          </label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="••••••••"
            className={inputCls}
            required={!hasPassword}
            data-testid="isnet-password"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">GİB Posta Kutusu Etiketi (Alias)</label>
          <input
            type="text"
            name="gib_alias"
            value={formData.gib_alias}
            onChange={handleChange}
            placeholder="urn:mail:defaultpk@firma.com.tr"
            className={`${inputCls} font-mono`}
            required
            data-testid="isnet-gib-alias"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">
            Şirket VKN / TCKN
            <span className="text-slate-400 font-normal"> (SOAP CompanyTaxCode — NetteFatura-API IP–VKN)</span>
          </label>
          <input
            type="text"
            name="company_tax_id"
            value={formData.company_tax_id}
            onChange={handleChange}
            placeholder="10 veya 11 haneli vergi kimlik no"
            className={`${inputCls} font-mono`}
            inputMode="numeric"
            maxLength={11}
            data-testid="isnet-company-tax-id"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">
            Şube / Vendor No
            <span className="text-slate-400 font-normal"> (opsiyonel — CompanyVendorNumber)</span>
          </label>
          <input
            type="text"
            name="company_vendor_number"
            value={formData.company_vendor_number}
            onChange={handleChange}
            placeholder="Varsa İşNet şube/vendor numarası"
            className={`${inputCls} font-mono`}
            data-testid="isnet-company-vendor-number"
          />
        </div>


        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={loading}
            className="px-4 py-2 border border-slate-200 rounded-xl font-semibold disabled:opacity-60 inline-flex items-center gap-1.5"
            data-testid="isnet-test-btn"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
            Bağlantıyı Dene
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60 inline-flex items-center gap-1.5"
            data-testid="isnet-save-btn"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Kaydet
          </button>
        </div>
      </form>
    </div>
  );
}
