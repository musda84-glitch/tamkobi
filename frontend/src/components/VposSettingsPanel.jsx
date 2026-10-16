import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CreditCard, Loader2, Save } from "lucide-react";
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
  const [bankLabel, setBankLabel] = useState("");
  const [mode, setMode] = useState("test");
  const [clientId, setClientId] = useState("");
  const [storeKey, setStoreKey] = useState("");
  const [hasStoreKey, setHasStoreKey] = useState(false);
  const [apiUser, setApiUser] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [hasApiPassword, setHasApiPassword] = useState(false);
  const [gateway, setGateway] = useState("");
  const [accountId, setAccountId] = useState("");
  const [enabled, setEnabled] = useState(false);

  const posAccounts = (accounts || []).filter((acc) => acc && (acc.type === "pos" || acc.type === "okc_pos"));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get(`${API_URL}/vpos/configs`, { params: { company_id: companyId } })
      .then((res) => {
        if (cancelled) return;
        const data = res.data || {};
        setBankLabel(data.bank_label || "");
        setMode(data.mode === "live" ? "live" : "test");
        setClientId(data.client_id || "");
        setStoreKey("");
        setHasStoreKey(!!data.has_store_key);
        setApiUser(data.api_user || "");
        setApiPassword("");
        setHasApiPassword(!!data.has_api_password);
        setGateway(data.gateway_3d_url || "");
        setAccountId(data.account_id || "");
        setEnabled(!!data.enabled);
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
      const res = await axios.put(`${API_URL}/vpos/configs`, {
        company_id: companyId,
        family: "nestpay",
        bank_label: bankLabel,
        mode,
        client_id: clientId,
        store_key: storeKey,
        api_user: apiUser,
        api_password: apiPassword,
        gateway_3d_url: gateway,
        account_id: accountId,
        enabled,
      });
      const data = res.data || {};
      setStoreKey("");
      setApiPassword("");
      setHasStoreKey(!!data.has_store_key);
      setHasApiPassword(!!data.has_api_password);
      setGateway(data.gateway_3d_url || gateway);
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
      const actionUrl = res.data?.action_url;
      const fields = res.data?.fields;
      if (!actionUrl || !fields) throw new Error("form");
      postBankForm(actionUrl, fields);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Test ödemesi başlatılamadı.");
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-xs text-slate-400 flex items-center gap-2" data-testid="vpos-loading"><Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…</div>;
  }

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
        <select className={`${inputCls} mt-1`} value="nestpay" onChange={() => {}} data-testid="vpos-family" disabled={!isAdmin}>
          <option value="nestpay">NestPay (EST / Payten) — 3D Pay Hosting</option>
          <option value="paytr" disabled>PayTR — yakında</option>
          <option value="iyzico" disabled>iyzico — yakında</option>
          <option value="param" disabled>Param — yakında</option>
        </select>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block font-semibold text-slate-700">Banka adı
          <input value={bankLabel} onChange={(e) => setBankLabel(e.target.value)} className={`${inputCls} mt-1`} data-testid="vpos-bank-label" disabled={!isAdmin} />
        </label>
        <label className="block font-semibold text-slate-700">Mod
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${inputCls} mt-1`} data-testid="vpos-mode" disabled={!isAdmin}>
            <option value="test">Test</option>
            <option value="live">Canlı</option>
          </select>
        </label>
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
    </form>
  );
}
