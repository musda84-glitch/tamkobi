import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Inbox, Loader2, Plug, Save, Truck, Send, FileCheck2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

/** İşNet resmi SOAP uçları — mode seçimine göre panelde gösterilir. */
const ISNET_SOAP = {
  test: {
    invoice: "https://einvoiceservicetest.isnet.net.tr/InvoiceService/ServiceContract/InvoiceService.svc",
    addressBook: "https://einvoiceservicetest.isnet.net.tr/AddressBookService/ServiceContract/AddressBookService.svc",
  },
  live: {
    invoice: "https://einvoiceservice.isnet.net.tr/InvoiceService/ServiceContract/InvoiceService.svc",
    addressBook: "https://einvoiceservice.isnet.net.tr/AddressBookService/ServiceContract/AddressBookService.svc",
  },
};

const emptyDespatch = {
  plate: "",
  trailer: "",
  driver_first: "",
  driver_last: "",
  driver_tckn: "",
  carrier_name: "",
  carrier_vkn: "",
};

/**
 * İşNet Net-e Fatura SOAP (IP–VKN) bağlantı paneli.
 * e-Fatura / e-Arşiv / e-İrsaliye aynı SOAP kanalı — ikinci bağlantı yok.
 * Kaydet / test: /api/integrations/isnet/save|test
 */
export default function IsnetIntegrationPanel({ companyId }) {
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [testMode, setTestMode] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [status, setStatus] = useState("simulated");
  const [eDispatchEnabled, setEDispatchEnabled] = useState(true);
  const [despatch, setDespatch] = useState(emptyDespatch);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    client_code: "",
    gib_alias: "",
    company_tax_id: "",
    company_vendor_number: "",
  });
  const [egressIps, setEgressIps] = useState([]);
  const [prodIps, setProdIps] = useState([]);
  const [prodHost, setProdHost] = useState("tamkobi.com");
  const [sameAsProd, setSameAsProd] = useState(true);

  const applyEgressPayload = (d) => {
    setEgressIps(Array.isArray(d?.egress_ips) ? d.egress_ips : []);
    setProdIps(Array.isArray(d?.production_ips) ? d.production_ips : []);
    if (d?.production_host) setProdHost(d.production_host);
    setSameAsProd(Boolean(d?.same_as_production));
  };

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
      setEDispatchEnabled(d.e_dispatch_enabled !== false);
      setDespatch({ ...emptyDespatch, ...(d.despatch_defaults || {}) });
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşNet ayarları alınamadı.");
    } finally {
      setBooting(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (testMode) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/integrations/isnet/egress`);
        if (!cancelled) applyEgressPayload(r.data);
      } catch {
        if (!cancelled) setEgressIps([]);
      }
    })();
    return () => { cancelled = true; };
  }, [testMode]);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleDespatchChange = (e) => {
    const { name, value } = e.target;
    setDespatch((prev) => ({ ...prev, [name]: value }));
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
    e_dispatch_enabled: eDispatchEnabled,
    despatch_defaults: {
      plate: despatch.plate,
      trailer: despatch.trailer,
      driver_first: despatch.driver_first,
      driver_last: despatch.driver_last,
      driver_tckn: despatch.driver_tckn,
      carrier_name: despatch.carrier_name,
      carrier_vkn: despatch.carrier_vkn,
    },
  });

  const handleTestConnection = async () => {
    setLoading(true);
    try {
      const r = await axios.post(`${API_URL}/integrations/isnet/test`, body());
      const msg = String(r.data?.message || "").split(" · Portal:")[0].trim();
      toast.success(msg || "İşNet SOAP (IP–VKN) bağlantı testi başarılı!");
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : (detail?.message || "Bağlantı kurulamadı, bilgilerinizi kontrol edin.");
      toast.error(msg, { duration: 12000 });
      // Canlı hata sonrası IP’yi yenile (toast’ta da yazılmış olabilir)
      if (!testMode) {
        try {
          const eg = await axios.get(`${API_URL}/integrations/isnet/egress`);
          applyEgressPayload(eg.data);
        } catch { /* ignore */ }
      }
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
      setEDispatchEnabled(r.data?.e_dispatch_enabled !== false);
      setDespatch({ ...emptyDespatch, ...(r.data?.despatch_defaults || {}) });
      setFormData((prev) => ({ ...prev, password: "" }));
      toast.success("İşNet SOAP ayarları kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ayarlar kaydedilirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  if (booting) {
    return <div className="text-xs text-slate-400 p-4" data-testid="isnet-loading">Yükleniyor…</div>;
  }

  const linkBtn =
    "px-3 py-1.5 rounded-lg font-semibold border inline-flex items-center gap-1.5 transition";

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs max-w-xl" data-testid="isnet-integration-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">İşNet SOAP API (IP–VKN)</h3>
          <p className="text-slate-500 mt-0.5">
            Resmi SOAP: kullanıcı/şifre yok — kimlik doğrulama çıkış IP’niz + şirket VKN ile yapılır.
          </p>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${status === "configured" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}
          data-testid="isnet-status"
        >
          {status === "configured" ? "YAPILANDIRILDI" : "SİMÜLE"}
        </span>
      </div>

      <div
        className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[11px] text-indigo-950 space-y-1"
        data-testid="isnet-coverage-note"
      >
        <p className="font-semibold">Bu bağlantı kapsar: e-Fatura · e-Arşiv · e-İrsaliye</p>
        <p className="text-indigo-800/90">
          Ayrı SOAP / ikinci entegratör kaydı gerekmez. Giden irsaliye <code className="font-mono text-[10px]">SendDespatchAdvice</code>,
          gelen <code className="font-mono text-[10px]">SearchDespatchAdvice</code>; mükellef sorgusu{" "}
          <code className="font-mono text-[10px]">GetDespatchTaxPayer</code> (e-Fatura listesinden ayrı).
          Canlıda e-İrsaliye ürünü İşNet hesabınızda açık olmalıdır.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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

      <div
        className={`rounded-xl border px-3 py-2.5 space-y-2 text-[11px] ${
          testMode ? "border-amber-200 bg-amber-50/50 text-amber-950" : "border-emerald-200 bg-emerald-50/50 text-emerald-950"
        }`}
        data-testid="isnet-soap-endpoints"
      >
        <p className="font-bold underline decoration-from-font underline-offset-2" data-testid="isnet-soap-env-label">
          {testMode ? "Test ortamı:" : "Canlı ortam:"}
        </p>
        <ul className="space-y-1.5 list-disc pl-4">
          <li>
            <span className="font-semibold">Fatura servisi (InvoiceService)</span>
            <a
              href={`${(testMode ? ISNET_SOAP.test : ISNET_SOAP.live).invoice}?wsdl`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block font-mono text-[10px] break-all text-indigo-700 hover:underline"
              data-testid="isnet-soap-invoice-url"
            >
              {(testMode ? ISNET_SOAP.test : ISNET_SOAP.live).invoice}
            </a>
          </li>
          <li>
            <span className="font-semibold">Adres defteri (AddressBookService)</span>
            <a
              href={`${(testMode ? ISNET_SOAP.test : ISNET_SOAP.live).addressBook}?wsdl`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block font-mono text-[10px] break-all text-indigo-700 hover:underline"
              data-testid="isnet-soap-addressbook-url"
            >
              {(testMode ? ISNET_SOAP.test : ISNET_SOAP.live).addressBook}
            </a>
          </li>
        </ul>
        {!testMode && (
          <div className="text-[10px] text-emerald-900/80 pt-0.5 space-y-1" data-testid="isnet-live-ip-hint">
            <p>
              Canlı fatura kesimi SOAP WCF ister: <span className="font-mono">einvoiceservice.isnet.net.tr</span>
              (InvoiceService). Portal/REST onayı <span className="font-mono">einvoiceapi.isnet.net.tr</span> içindir;
              ikisi farklı IP’dir. Destek «sorun yok» dediyse SOAP InvoiceService allow-list’ini sorun.
            </p>
            <p>
              İşNet onayı <span className="font-semibold">{prodHost}</span> içindir — canlı testi{" "}
              <a href={`https://${prodHost}`} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                https://{prodHost}
              </a>{" "}
              üzerinden yapın.
            </p>
            {prodIps.length > 0 ? (
              <p className="font-mono font-semibold text-emerald-950" data-testid="isnet-production-ips">
                Üretim IP (kayda giden): {prodIps.join(", ")} ({prodHost})
              </p>
            ) : null}
            {!sameAsProd && egressIps.length > 0 ? (
              <p className="text-amber-900" data-testid="isnet-egress-ips">
                Bu önizleme ortamının çıkışı farklıdır ({egressIps.join(", ")}) ve değişebilir; canlı HealthCheck burada zaman aşımına düşer.
              </p>
            ) : egressIps.length > 0 ? (
              <p className="font-mono font-semibold text-emerald-950" data-testid="isnet-egress-ips">
                Sunucu çıkış IP: {egressIps.join(", ")}
              </p>
            ) : (
              <p className="text-emerald-800/70" data-testid="isnet-egress-ips-loading">Çıkış IP tespit ediliyor…</p>
            )}
            <p>
              Kayıt metni: VKN + üretim IP + «InvoiceService / einvoiceservice.isnet.net.tr SOAP WCF» →{" "}
              <a href="mailto:efaturadestek@nettefatura.com.tr" className="underline font-semibold">
                efaturadestek@nettefatura.com.tr
              </a>
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2" data-testid="isnet-quick-links">
        <Link to="/edoc-inbox" className={`${linkBtn} border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100`} data-testid="isnet-edoc-inbox-link">
          <Inbox className="w-3.5 h-3.5" />
          Gelen e-Fatura
        </Link>
        <Link to="/edoc-inbox?kind=dispatch" className={`${linkBtn} border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 hover:bg-fuchsia-100`} data-testid="isnet-incoming-despatch-link">
          <Truck className="w-3.5 h-3.5" />
          Gelen e-İrsaliye
        </Link>
        <Link to="/dispatches" className={`${linkBtn} border-fuchsia-200 bg-white text-fuchsia-800 hover:bg-fuchsia-50`} data-testid="isnet-outgoing-despatch-link">
          <Send className="w-3.5 h-3.5" />
          Giden e-İrsaliye
        </Link>
        <Link to="/invoices" className={`${linkBtn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`} data-testid="isnet-invoices-link">
          <FileCheck2 className="w-3.5 h-3.5" />
          Faturalar
        </Link>
      </div>

      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="block font-semibold mb-1">
            Şirket VKN / TCKN <span className="text-rose-600">*</span>
            <span className="text-slate-400 font-normal"> — SOAP CompanyTaxCode (IP–VKN)</span>
          </label>
          <input
            type="text"
            name="company_tax_id"
            value={formData.company_tax_id}
            onChange={handleChange}
            placeholder={testMode ? "4810173324 veya 1234567805" : "10 veya 11 haneli vergi kimlik no"}
            className={`${inputCls} font-mono`}
            inputMode="numeric"
            maxLength={11}
            required
            data-testid="isnet-company-tax-id"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">
            GİB Posta Kutusu Etiketi (Alias) <span className="text-rose-600">*</span>
            <span className="text-slate-400 font-normal"> — e-Fatura gönderici etiketi</span>
          </label>
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
            Müşteri / Firma Kodu
            <span className="text-slate-400 font-normal"> (opsiyonel)</span>
          </label>
          <input
            type="text"
            name="client_code"
            value={formData.client_code}
            onChange={handleChange}
            placeholder="İşNet müşteri kodunuz (varsa)"
            className={inputCls}
            data-testid="isnet-client-code"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">
            Şube / Vendor No
            <span className="text-slate-400 font-normal"> (CompanyVendorNumber)</span>
          </label>
          <input
            type="text"
            name="company_vendor_number"
            value={formData.company_vendor_number}
            onChange={handleChange}
            placeholder="Örn. 05 — Test firma 05 / U05… fatura serisi"
            className={`${inputCls} font-mono`}
            data-testid="isnet-company-vendor-number"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            U05… serisi faturalarda arama ve PDF için <span className="font-mono">05</span> gerekir.
            Boş bırakılırsa fatura numarasından otomatik çıkarılır.
          </p>
        </div>

        <div
          className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/40 p-3 space-y-3"
          data-testid="isnet-despatch-section"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-fuchsia-900 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5" />
                e-İrsaliye (aynı SOAP)
              </div>
              <p className="text-[10px] text-fuchsia-900/70 mt-0.5">
                İkinci bağlantı yok. Alıcı e-İrsaliye mükellefi değilse kâğıt irsaliye kullanılır.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 font-semibold text-fuchsia-900 cursor-pointer" data-testid="isnet-despatch-enabled-label">
              <input
                type="checkbox"
                checked={eDispatchEnabled}
                onChange={(e) => setEDispatchEnabled(e.target.checked)}
                className="rounded border-fuchsia-300"
                data-testid="isnet-despatch-enabled"
              />
              Aktif
            </label>
          </div>

          {eDispatchEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="isnet-despatch-defaults">
              <div>
                <label className="block font-semibold mb-1">Varsayılan plaka</label>
                <input
                  type="text"
                  name="plate"
                  value={despatch.plate}
                  onChange={handleDespatchChange}
                  placeholder="34ABC123"
                  className={`${inputCls} font-mono uppercase`}
                  data-testid="isnet-despatch-plate"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Dorse plaka</label>
                <input
                  type="text"
                  name="trailer"
                  value={despatch.trailer}
                  onChange={handleDespatchChange}
                  placeholder="opsiyonel"
                  className={`${inputCls} font-mono uppercase`}
                  data-testid="isnet-despatch-trailer"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Sürücü adı</label>
                <input
                  type="text"
                  name="driver_first"
                  value={despatch.driver_first}
                  onChange={handleDespatchChange}
                  className={inputCls}
                  data-testid="isnet-despatch-driver-first"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Sürücü soyadı</label>
                <input
                  type="text"
                  name="driver_last"
                  value={despatch.driver_last}
                  onChange={handleDespatchChange}
                  className={inputCls}
                  data-testid="isnet-despatch-driver-last"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Sürücü TCKN</label>
                <input
                  type="text"
                  name="driver_tckn"
                  value={despatch.driver_tckn}
                  onChange={handleDespatchChange}
                  placeholder="11 hane"
                  className={`${inputCls} font-mono`}
                  inputMode="numeric"
                  maxLength={11}
                  data-testid="isnet-despatch-driver-tckn"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Taşıyıcı VKN</label>
                <input
                  type="text"
                  name="carrier_vkn"
                  value={despatch.carrier_vkn}
                  onChange={handleDespatchChange}
                  placeholder="kendi araçsa boş"
                  className={`${inputCls} font-mono`}
                  inputMode="numeric"
                  maxLength={11}
                  data-testid="isnet-despatch-carrier-vkn"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1">Taşıyıcı unvan</label>
                <input
                  type="text"
                  name="carrier_name"
                  value={despatch.carrier_name}
                  onChange={handleDespatchChange}
                  placeholder="Üçüncü firma nakliyede"
                  className={inputCls}
                  data-testid="isnet-despatch-carrier-name"
                />
              </div>
            </div>
          )}
        </div>

        <details className="rounded-xl border border-dashed border-slate-200 p-3" data-testid="isnet-optional-portal">
          <summary className="cursor-pointer font-semibold text-slate-700">
            Opsiyonel — Portal API kullanıcı/şifre (SOAP testinde kullanılmaz)
          </summary>
          <p className="text-[10px] text-slate-500 mt-1 mb-2">
            SOAP gönderimi IP–VKN ile yapılır; buradaki kullanıcı/şifre Bağlantıyı Test Et sonucunu etkilemez.
            NetteFatura web girişi için Ayarlar’daki İşNet Web Portal panelini kullanın.
          </p>
          <div className="space-y-2">
            <div>
              <label className="block font-semibold mb-1">Kullanıcı Adı</label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                placeholder={testMode ? "12345678901" : "API kullanıcı adınız"}
                className={inputCls}
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
                placeholder={testMode ? "1234" : "••••••••"}
                className={inputCls}
                data-testid="isnet-password"
              />
            </div>
          </div>
        </details>

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
