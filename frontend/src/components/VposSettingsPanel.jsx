import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Copy, CreditCard, Loader2, Save, X } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

/** Banka 3D sayfasına tarayıcıdan POST. Kart alanları eklenmez. */
export function postBankForm(actionUrl, fields) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = actionUrl;
  form.setAttribute("method", "POST");
  form.setAttribute("action", actionUrl);
  form.acceptCharset = "UTF-8";
  form.setAttribute("data-testid", "vpos-bank-form");
  Object.entries(fields || {}).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value == null ? "" : String(value);
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
  return form;
}

export const navigation = {
  assign(url) {
    window.location.assign(url);
  },
};

function hostIs(url, root) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && (host === root || host.endsWith(`.${root}`));
  } catch {
    return false;
  }
}

/** PayTR iframe yalnız bu origin ve yol. */
export function paytrIframeAllowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && parsed.hostname === "www.paytr.com"
      && parsed.pathname.startsWith("/odeme/guvenli/");
  } catch {
    return false;
  }
}

/** iyzico ödeme sayfası yalnız https ve iyzipay.com alan adları. */
export function iyzicoRedirectAllowed(url) {
  return hostIs(url, "iyzipay.com");
}

export function classifyTestPayment(data) {
  const kind = data?.kind || (data?.action_url ? "form" : "");
  if (kind === "iframe") {
    const url = String(data?.iframe_url || "");
    return paytrIframeAllowed(url) ? { type: "iframe", url } : { type: "rejected" };
  }
  if (kind === "redirect") {
    const url = String(data?.url || "");
    return iyzicoRedirectAllowed(url) ? { type: "redirect", url } : { type: "rejected" };
  }
  if (data?.action_url && data?.fields) {
    return { type: "form", actionUrl: data.action_url, fields: data.fields };
  }
  return { type: "rejected" };
}

export async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

function isCompanyAdmin(user) {
  if (!user) return false;
  if (user.is_super_admin) return true;
  const role = String(user.role || "").toLowerCase();
  return role === "admin" || role === "owner" || role === "yönetici" || role === "yonetici";
}

export function VposSettingsPanel({ companyId, accounts = [] }) {
  const { user } = useAuth();
  const isAdmin = isCompanyAdmin(user);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [family, setFamily] = useState("nestpay");
  const [bankLabel, setBankLabel] = useState("");
  const [mode, setMode] = useState("test");
  const [clientId, setClientId] = useState("");
  const [storeKey, setStoreKey] = useState("");
  const [hasStoreKey, setHasStoreKey] = useState(false);
  const [apiUser, setApiUser] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [hasApiPassword, setHasApiPassword] = useState(false);
  const [gateway, setGateway] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [merchantKey, setMerchantKey] = useState("");
  const [hasMerchantKey, setHasMerchantKey] = useState(false);
  const [merchantSalt, setMerchantSalt] = useState("");
  const [hasMerchantSalt, setHasMerchantSalt] = useState(false);
  const [maxInstallment, setMaxInstallment] = useState("0");
  const [noInstallment, setNoInstallment] = useState(false);
  const [notifyUrl, setNotifyUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [hasSecretKey, setHasSecretKey] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [iframeUrl, setIframeUrl] = useState("");

  const posAccounts = (accounts || []).filter((acc) => acc && (acc.type === "pos" || acc.type === "okc_pos"));

  const applyConfig = (data) => {
    const nextFamily = data.family === "paytr" || data.family === "iyzico" ? data.family : "nestpay";
    setFamily(nextFamily);
    setBankLabel(data.bank_label || "");
    setMode(data.mode === "live" ? "live" : "test");
    setClientId(data.client_id || "");
    setStoreKey("");
    setHasStoreKey(!!data.has_store_key);
    setApiUser(data.api_user || "");
    setApiPassword("");
    setHasApiPassword(!!data.has_api_password);
    setGateway(data.gateway_3d_url || "");
    setMerchantId(data.merchant_id || "");
    setMerchantKey("");
    setHasMerchantKey(!!data.has_merchant_key);
    setMerchantSalt("");
    setHasMerchantSalt(!!data.has_merchant_salt);
    setMaxInstallment(String(data.max_installment ?? 0));
    setNoInstallment(!!data.no_installment);
    setNotifyUrl(data.notify_url || "");
    setApiKey("");
    setHasApiKey(!!data.has_api_key);
    setSecretKey("");
    setHasSecretKey(!!data.has_secret_key);
    setAccountId(data.account_id || "");
    setEnabled(!!data.enabled);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get(`${API_URL}/vpos/configs`, { params: { company_id: companyId } })
      .then((res) => {
        if (cancelled) return;
        applyConfig(res.data || {});
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.response?.data?.detail || "Sanal POS ayarı yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyId]);

  const save = async (event) => {
    event.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    try {
      const payload = {
        company_id: companyId,
        family,
        bank_label: bankLabel,
        mode,
        account_id: accountId,
        enabled,
      };
      if (family === "nestpay") {
        Object.assign(payload, {
          client_id: clientId,
          store_key: storeKey,
          api_user: apiUser,
          api_password: apiPassword,
          gateway_3d_url: gateway,
        });
      } else if (family === "paytr") {
        Object.assign(payload, {
          merchant_id: merchantId,
          merchant_key: merchantKey,
          merchant_salt: merchantSalt,
          max_installment: Number(maxInstallment || 0),
          no_installment: noInstallment,
        });
      } else if (family === "iyzico") {
        Object.assign(payload, { api_key: apiKey, secret_key: secretKey });
      }
      const res = await axios.put(`${API_URL}/vpos/configs`, payload);
      applyConfig(res.data || {});
      toast.success("Sanal POS ayarı kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const startTest = async () => {
    if (!isAdmin || mode !== "test") return;
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/vpos/test-payment`, { company_id: companyId, amount: "1.00" });
      const next = classifyTestPayment(res.data || {});
      if (next.type === "form") {
        postBankForm(next.actionUrl, next.fields);
        return;
      }
      if (next.type === "iframe") {
        setIframeUrl(next.url);
        setBusy(false);
        return;
      }
      if (next.type === "redirect") {
        navigation.assign(next.url);
        return;
      }
      throw new Error("form");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Test ödemesi başlatılamadı.");
      setBusy(false);
    }
  };

  const copyNotify = async () => {
    if (!notifyUrl) return;
    try {
      const ok = await copyText(notifyUrl);
      if (!ok) throw new Error("copy");
      setCopied(true);
      toast.success("Bildirim URL kopyalandı.");
    } catch {
      toast.error("Kopyalanamadı.");
    }
  };

  if (loading) {
    return <div className="text-xs text-slate-400 flex items-center gap-2" data-testid="vpos-loading"><Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…</div>;
  }

  const labelName = family === "nestpay" ? "Banka adı" : "Görünen ad";

  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs max-w-2xl" data-testid="vpos-settings-form">
      <div>
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><CreditCard className="w-4 h-4 text-emerald-600" /> Sanal POS</h2>
        <p className="text-slate-500 mt-1" data-testid="vpos-pci-note">
          Kart bilgisi bu ekranda istenmez. Ödeme bankanın sayfasında yapılır; kart numarası sunucuya gelmez ve saklanmaz.
        </p>
      </div>
      {!isAdmin && <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" data-testid="vpos-admin-only">Bu ayarı yalnız şirket yöneticisi değiştirebilir.</p>}
      <label className="block font-semibold text-slate-700">Ödeme ailesi
        <select className={`${inputCls} mt-1`} value={family} onChange={(e) => setFamily(e.target.value)} data-testid="vpos-family" disabled={!isAdmin}>
          <option value="nestpay">Banka POS (NestPay)</option>
          <option value="paytr">PayTR</option>
          <option value="iyzico">iyzico</option>
          <option value="param" disabled>Param — yakında</option>
        </select>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block font-semibold text-slate-700">{labelName}
          <input value={bankLabel} onChange={(e) => setBankLabel(e.target.value)} className={`${inputCls} mt-1`} data-testid="vpos-bank-label" disabled={!isAdmin} />
        </label>
        <label className="block font-semibold text-slate-700">Mod
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${inputCls} mt-1`} data-testid="vpos-mode" disabled={!isAdmin}>
            <option value="test">Test</option>
            <option value="live">Canlı</option>
          </select>
        </label>
      </div>
      {family === "nestpay" && (
        <div className="space-y-3" data-testid="vpos-fields-nestpay">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block font-semibold text-slate-700">Client ID
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={`${inputCls} mt-1`} data-testid="vpos-client-id" autoComplete="off" disabled={!isAdmin} />
            </label>
            <label className="block font-semibold text-slate-700">Store key
              <input type="password" value={storeKey} onChange={(e) => setStoreKey(e.target.value)} placeholder={hasStoreKey ? "••••••••" : ""} className={`${inputCls} mt-1`} data-testid="vpos-store-key" autoComplete="new-password" disabled={!isAdmin} />
            </label>
          </div>
          {hasStoreKey && <p className="text-slate-500" data-testid="vpos-store-key-mask">Kayıtlı store key: •••••••• — boş bırakırsanız değişmez.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block font-semibold text-slate-700">API kullanıcı (isteğe bağlı)
              <input value={apiUser} onChange={(e) => setApiUser(e.target.value)} className={`${inputCls} mt-1`} data-testid="vpos-api-user" autoComplete="off" disabled={!isAdmin} />
            </label>
            <label className="block font-semibold text-slate-700">API şifre (isteğe bağlı)
              <input type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} placeholder={hasApiPassword ? "••••••••" : ""} className={`${inputCls} mt-1`} data-testid="vpos-api-password" autoComplete="new-password" disabled={!isAdmin} />
            </label>
          </div>
          {hasApiPassword && <p className="text-slate-500" data-testid="vpos-api-password-mask">Kayıtlı API şifresi: ••••••••</p>}
          <label className="block font-semibold text-slate-700">3D gateway URL
            <input value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="https://..." className={`${inputCls} mt-1`} data-testid="vpos-gateway-url" disabled={!isAdmin} />
          </label>
          <p className="text-slate-500" data-testid="vpos-test-endpoint">
            Test modunda ödeme Payten test ucuna gider. Canlı modda bankanızın https 3D adresini yazın.
          </p>
        </div>
      )}
      {family === "paytr" && (
        <div className="space-y-3" data-testid="vpos-fields-paytr">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block font-semibold text-slate-700">Mağaza no
              <input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} inputMode="numeric" className={`${inputCls} mt-1`} data-testid="vpos-merchant-id" autoComplete="off" disabled={!isAdmin} />
            </label>
            <label className="block font-semibold text-slate-700">En fazla taksit
              <input value={maxInstallment} onChange={(e) => setMaxInstallment(e.target.value)} className={`${inputCls} mt-1`} data-testid="vpos-max-installment" disabled={!isAdmin} />
            </label>
            <label className="block font-semibold text-slate-700">Merchant key
              <input type="password" value={merchantKey} onChange={(e) => setMerchantKey(e.target.value)} placeholder={hasMerchantKey ? "••••••••" : ""} className={`${inputCls} mt-1`} data-testid="vpos-merchant-key" autoComplete="new-password" disabled={!isAdmin} />
            </label>
            <label className="block font-semibold text-slate-700">Merchant salt
              <input type="password" value={merchantSalt} onChange={(e) => setMerchantSalt(e.target.value)} placeholder={hasMerchantSalt ? "••••••••" : ""} className={`${inputCls} mt-1`} data-testid="vpos-merchant-salt" autoComplete="new-password" disabled={!isAdmin} />
            </label>
          </div>
          {hasMerchantKey && <p className="text-slate-500" data-testid="vpos-merchant-key-mask">Kayıtlı merchant key: •••••••• — boş bırakırsanız değişmez.</p>}
          {hasMerchantSalt && <p className="text-slate-500" data-testid="vpos-merchant-salt-mask">Kayıtlı merchant salt: •••••••• — boş bırakırsanız değişmez.</p>}
          <label className="flex items-center gap-2 font-semibold text-slate-700">
            <input type="checkbox" checked={noInstallment} onChange={(e) => setNoInstallment(e.target.checked)} data-testid="vpos-no-installment" disabled={!isAdmin} />
            Taksit gösterme
          </label>
          <p className="text-slate-500" data-testid="vpos-paytr-mode-note">Test modu PayTR test_mode 1, canlı mod 0 olarak gider. Adres girilmez.</p>
          {notifyUrl && (
            <div className="space-y-1" data-testid="vpos-notify-box">
              <p className="font-semibold text-slate-700">PayTR panelinde Bildirim URL olarak şunu girin</p>
              <div className="flex gap-2">
                <input readOnly value={notifyUrl} className={`${inputCls} font-mono`} data-testid="vpos-notify-url" />
                <button type="button" onClick={copyNotify} className="inline-flex items-center gap-1 px-3 border border-slate-300 rounded-lg font-semibold" data-testid="vpos-notify-copy">
                  <Copy className="w-3.5 h-3.5" /> Kopyala
                </button>
              </div>
              {copied && <p className="text-emerald-700" data-testid="vpos-notify-copied">Kopyalandı</p>}
            </div>
          )}
        </div>
      )}
      {family === "iyzico" && (
        <div className="space-y-3" data-testid="vpos-fields-iyzico">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block font-semibold text-slate-700">API anahtarı
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasApiKey ? "••••••••" : ""} className={`${inputCls} mt-1`} data-testid="vpos-api-key" autoComplete="new-password" disabled={!isAdmin} />
            </label>
            <label className="block font-semibold text-slate-700">Secret key
              <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={hasSecretKey ? "••••••••" : ""} className={`${inputCls} mt-1`} data-testid="vpos-secret-key" autoComplete="new-password" disabled={!isAdmin} />
            </label>
          </div>
          {hasApiKey && <p className="text-slate-500" data-testid="vpos-api-key-mask">Kayıtlı API anahtarı: •••••••• — boş bırakırsanız değişmez.</p>}
          {hasSecretKey && <p className="text-slate-500" data-testid="vpos-secret-key-mask">Kayıtlı secret key: •••••••• — boş bırakırsanız değişmez.</p>}
          <p className="text-slate-500" data-testid="vpos-iyzico-mode-note">
            Test: https://sandbox-api.iyzipay.com — Canlı: https://api.iyzipay.com. Adres elle girilmez.
          </p>
        </div>
      )}
      <label className="block font-semibold text-slate-700">Bağlı POS hesabı
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${inputCls} mt-1`} data-testid="vpos-account" disabled={!isAdmin}>
          <option value="">Seçin</option>
          {posAccounts.map((acc) => {
            const id = acc.id || acc._id;
            const label = [acc.bank_name, acc.account_name].filter(Boolean).join(" — ") || id;
            return <option key={id} value={id}>{label} ({acc.type === "okc_pos" ? "ÖKC" : "POS"})</option>;
          })}
        </select>
      </label>
      <label className="flex items-center gap-2 font-semibold text-slate-700">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="vpos-enabled" disabled={!isAdmin} />
        Etkin
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!isAdmin || busy} className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-50" data-testid="vpos-save">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Kaydet
        </button>
        <button type="button" onClick={startTest} disabled={!isAdmin || busy || mode !== "test" || !enabled} className="px-4 py-2 border border-slate-300 rounded-xl font-semibold disabled:opacity-50" data-testid="vpos-test-payment">
          Test ödemesi (1,00 ₺)
        </button>
      </div>
      {iframeUrl && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" data-testid="vpos-iframe-modal">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
              <p className="font-semibold text-slate-800">PayTR ödeme</p>
              <button type="button" onClick={() => setIframeUrl("")} className="p-1" data-testid="vpos-iframe-close" aria-label="Kapat"><X className="w-4 h-4" /></button>
            </div>
            <iframe title="PayTR" src={iframeUrl} className="w-full h-96 border-0" data-testid="vpos-paytr-iframe" />
          </div>
        </div>
      )}
    </form>
  );
}
