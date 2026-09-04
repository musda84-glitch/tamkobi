import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Plug, Loader2, ShieldCheck, FlaskConical } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";

const LABELS = { api_key: "API Token / Key", api_secret: "API Secret", customer_number: "Müşteri No", api_username: "API Kullanıcı", api_password: "API Şifre", sender_address_id: "Gönderici Adres ID (senderAddressID)" };
const isSecret = (f) => f.includes("password") || f.includes("secret") || f === "api_key";

export const CargoConfigModal = ({ config, catalogItem, onClose, onSaved }) => {
  useEscape(onClose);
  const fields = catalogItem?.fields || ["customer_number", "api_username", "api_password"];
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [f, isSecret(f) ? "" : config[f] || ""])));
  const [testMode, setTestMode] = useState(config.test_mode !== false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [addresses, setAddresses] = useState(config.sender_addresses || []);
  const isGeliver = config.carrier_code === "geliver";
  const id = config.id || config._id;

  const save = async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    try {
      const body = { ...Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "")), test_mode: testMode, is_active: true };
      const r = await axios.put(`${API_URL}/integrations/cargo/${id}`, body);
      toast.success(`${config.carrier_name} ayarları kaydedildi.`);
      if (!e?.silent) onSaved?.(r.data);
      return r.data;
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  const test = async () => {
    setTesting(true);
    try {
      if (Object.values(form).some((v) => v !== "")) await save({ silent: true });
      const r = await axios.post(`${API_URL}/integrations/cargo/${id}/test`);
      setAddresses(r.data.addresses || []);
      toast[r.data.ok ? "success" : "error"](r.data.message);
      if (r.data.addresses?.length === 1) setForm((f) => ({ ...f, sender_address_id: r.data.addresses[0].id }));
    } catch (err) { toast.error(err.response?.data?.detail || "Bağlantı testi başarısız."); } finally { setTesting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" onClick={(e) => e.stopPropagation()} data-testid="cargo-config-modal">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-base font-bold text-slate-900">{config.carrier_name} API Ayarları</h3>
          <button onClick={onClose} className="text-slate-400" data-testid="cargo-config-close"><X className="w-5 h-5" /></button>
        </div>
        {isGeliver && <div className="text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2 flex gap-1.5"><ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Token <b>app.geliver.io → API Tokens</b> sayfasından alınır; sunucuda şifreli saklanır, tarayıcıya asla geri gönderilmez.</div>}
        <form onSubmit={save} className="space-y-3 text-xs">
          {fields.map((f) => (
            <div key={f}>
              <label className="block font-semibold text-slate-700 mb-1">{LABELS[f] || f}</label>
              {f === "sender_address_id" && addresses.length > 0 ? (
                <select value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="cargo-cfg-sender_address_id">
                  <option value="">Seçin…</option>
                  {addresses.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.district}/{a.city}</option>)}
                </select>
              ) : (
                <input type={isSecret(f) ? "password" : "text"} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} placeholder={isSecret(f) && config[`has_${f}`] ? "•••••••• (kayıtlı — değiştirmek için yazın)" : ""} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono" data-testid={`cargo-cfg-${f}`} />
              )}
            </div>
          ))}
          {isGeliver && (
            <label className="flex items-center gap-2 cursor-pointer bg-amber-50 border border-amber-200 rounded-lg p-2" data-testid="cargo-cfg-test-mode">
              <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} className="rounded" />
              <FlaskConical className="w-3.5 h-3.5 text-amber-600" /><span><b>Test modu</b> (test:true) — gerçek kargo/ücret oluşmaz. Canlıya geçmek için kapatın.</span>
            </label>
          )}
          <div className="flex justify-between gap-2 pt-2 border-t">
            {isGeliver ? <button type="button" onClick={test} disabled={testing} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg font-semibold text-slate-700 hover:bg-slate-50" data-testid="cargo-cfg-test-btn">{testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />} Bağlantıyı Test Et & Adresleri Getir</button> : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
              <button type="submit" disabled={busy} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="cargo-cfg-save">{busy ? "Kaydediliyor…" : "Kaydet"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
