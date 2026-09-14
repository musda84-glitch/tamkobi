import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Plug, Save } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

/**
 * İşNet Net-e Fatura — Web Portal (NetteFatura-Portal) paneli.
 * VKN/TCKN + portal şifresi. Kaydet / test: /integrations/isnet-portal/save|test
 */
export default function IsnetPortalPanel({ companyId }) {
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  // Gerçek NetteFatura hesapları canlıda; Test yalnızca İşNet deneme hesabı
  const [testMode, setTestMode] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [status, setStatus] = useState("simulated");
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    corporate_code: "",
  });

  const load = useCallback(async () => {
    if (!companyId) return;
    setBooting(true);
    try {
      const r = await axios.get(`${API_URL}/einvoice/settings`, { params: { company_id: companyId } });
      const d = r.data || {};
      setFormData({
        username: d.username || d.company_tax_id || "",
        password: "",
        corporate_code: d.corporate_code || "",
      });
      setTestMode((d.mode || "live") === "test");
      setHasPassword(Boolean(d.has_password));
      setStatus(d.status || "simulated");
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşNet portal ayarları alınamadı.");
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
    corporate_code: formData.corporate_code,
    vkn: formData.username,
  });

  const handleTest = async () => {
    setLoading(true);
    try {
      const r = await axios.post(`${API_URL}/integrations/isnet-portal/test`, body());
      if (r.data?.suggested_mode) {
        setTestMode(r.data.suggested_mode === "test");
      }
      const msg = r.data?.message || "İşNet Web Portal bağlantı testi başarılı!";
      if (r.data?.mobile_ok === false) {
        toast.warning(msg);
      } else {
        toast.success(msg);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Portal bağlantısı kurulamadı.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await axios.post(`${API_URL}/integrations/isnet-portal/save`, body());
      setStatus(r.data?.status || "configured");
      setHasPassword(Boolean(r.data?.has_password));
      setFormData((prev) => ({ ...prev, password: "" }));
      toast.success("İşNet Web Portal ayarları kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ayarlar kaydedilemedi.");
    } finally {
      setLoading(false);
    }
  };

  if (booting) {
    return <div className="text-xs text-slate-400 p-4" data-testid="isnet-portal-loading">Yükleniyor…</div>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs max-w-xl" data-testid="isnet-portal-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">İşNet Web Portal (NetteFatura-Portal)</h3>
          <p className="text-slate-500 mt-0.5">
            VKN/TCKN ve portal şifresi ile giriş. Statik IP / SOAP sözleşmesi gerekmez.{" "}
            <a
              href="https://github.com/EfeSorogluu/NetteFatura-Portal"
              target="_blank"
              rel="noreferrer"
              className="underline text-slate-600"
            >
              NetteFatura-Portal
            </a>
          </p>
          <p className="text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mt-2" data-testid="isnet-portal-inbox-hint">
            Bağlantıyı kaydetmek yetmez. Gelen faturaları görmek için{" "}
            <span className="font-semibold">Muhasebe → Gelen e-Belgeler → Entegratörden çek</span> kullanın.
          </p>
          <p className="text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 mt-2" data-testid="isnet-portal-mode-hint">
            Gerçek NetteFatura hesabınız varsa <span className="font-semibold">Canlı Ortam</span> seçin.
            Portal açılıp Mobile API 401 verirse gelen faturalar Web Portal oturumuyla çekilir.
          </p>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${status === "configured" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}
          data-testid="isnet-portal-status"
        >
          {status === "configured" ? "YAPILANDIRILDI" : "SİMÜLE"}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTestMode(true)}
          className={`px-3 py-1.5 rounded-lg font-semibold border transition ${testMode ? "bg-amber-500 text-white border-amber-500" : "bg-slate-50 text-slate-700 border-slate-200"}`}
          data-testid="isnet-portal-mode-test"
        >
          Test Ortamı
        </button>
        <button
          type="button"
          onClick={() => setTestMode(false)}
          className={`px-3 py-1.5 rounded-lg font-semibold border transition ${!testMode ? "bg-emerald-600 text-white border-emerald-600" : "bg-slate-50 text-slate-700 border-slate-200"}`}
          data-testid="isnet-portal-mode-live"
        >
          Canlı Ortam
        </button>
      </div>
      <p className="text-[10px] text-slate-500 font-mono space-y-0.5" data-testid="isnet-portal-hosts">
        <span className="block">
          Portal: {testMode ? "efatura.isnet.net.tr" : "nettefatura.isnet.net.tr"}
        </span>
        <span className="block">
          Mobile API: {testMode ? "einvoiceapitest.isnet.net.tr" : "einvoiceapi.isnet.net.tr"}
        </span>
      </p>

      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="block font-semibold mb-1">VKN / TCKN</label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleChange}
            placeholder="10 veya 11 haneli vergi no"
            className={`${inputCls} font-mono`}
            required
            data-testid="isnet-portal-vkn"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">
            Portal şifresi {hasPassword && <span className="text-slate-400 font-normal">(kayıtlı — değiştirmek için yazın)</span>}
          </label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="nettefatura.isnet.net.tr ile aynı şifre"
            className={inputCls}
            required={!hasPassword}
            data-testid="isnet-portal-password"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">
            Portal firma ID <span className="text-slate-400 font-normal">(opsiyonel)</span>
          </label>
          <input
            type="text"
            name="corporate_code"
            value={formData.corporate_code}
            onChange={handleChange}
            placeholder="Çoklu firmada CompanyId"
            className={`${inputCls} font-mono`}
            data-testid="isnet-portal-company-id"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleTest}
            disabled={loading}
            className="px-4 py-2 border rounded-xl font-semibold flex items-center gap-1.5 disabled:opacity-60"
            data-testid="isnet-portal-test-btn"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
            Bağlantıyı dene
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold flex items-center gap-1.5 disabled:opacity-60"
            data-testid="isnet-portal-save-btn"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Kaydet
          </button>
        </div>
      </form>
    </div>
  );
}
