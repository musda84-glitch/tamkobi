
import React, { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Plug, Loader2, ShieldCheck, FlaskConical, AlertTriangle } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";

const LABELS = {
  api_key: "API Token / Key",
  api_secret: "API Secret",
  customer_number: "Müşteri No",
  api_username: "API Kullanıcı",
  api_password: "API Şifre",
  sender_address_id: "Gönderici Adres ID (senderAddressID)",
};
const isSecret = (f) => f.includes("password") || f.includes("secret") || f === "api_key";

/** Domain / mağaza URL'si adres ID değildir (örn. matekdekor.geliver.io). */
const looksLikeDomainNotAddressId = (v) => {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return false;
  if (s.includes("://") || s.includes(" ")) return true;
  if (s.includes(".geliver.") || s.endsWith(".io") || s.endsWith(".com")) return true;
  return false;
};

export const CargoConfigModal = ({ config, catalogItem, onClose, onSaved }) => {
  useEscape(onClose);
  const fields = catalogItem?.fields || ["customer_number", "api_username", "api_password"];
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [f, isSecret(f) ? "" : config[f] || ""])));
  const [testMode, setTestMode] = useState(config.test_mode !== false);
  const [defaults, setDefaults] = useState({
    default_package_count: config.default_package_count || 1,
    default_desi: config.default_desi || "",
    default_weight: config.default_weight || "",
    default_length: config.default_length || "",
    default_width: config.default_width || "",
    default_height: config.default_height || "",
  });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [addresses, setAddresses] = useState(config.sender_addresses || []);
  const [testError, setTestError] = useState("");
  const isGeliver = config.carrier_code === "geliver";
  const id = config.id || config._id;
  const badSender = useMemo(
    () => isGeliver && looksLikeDomainNotAddressId(form.sender_address_id),
    [isGeliver, form.sender_address_id],
  );

  const packageBody = () => ({
    ...Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== "" && v != null)),
    default_package_count: Number(defaults.default_package_count) || 1,
  });

  const save = async (e) => {
    e?.preventDefault?.();
    if (badSender) {
      toast.error("Gönderici Adres ID alanına mağaza adresi (…geliver.io) yazmayın. Önce «Bağlantıyı Test Et» ile adres listesini çekip seçin.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "")),
        test_mode: testMode,
        is_active: true,
        ...packageBody(),
      };
      if (isGeliver && looksLikeDomainNotAddressId(body.sender_address_id)) delete body.sender_address_id;
      const r = await axios.put(`${API_URL}/integrations/cargo/${id}`, body);
      toast.success(`${config.carrier_name} ayarları kaydedildi.`);
      if (!e?.silent) onSaved?.(r.data);
      return r.data;
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestError("");
    try {
      const tokenOnly = { ...form };
      if (looksLikeDomainNotAddressId(tokenOnly.sender_address_id)) {
        tokenOnly.sender_address_id = "";
        setForm((f) => ({ ...f, sender_address_id: "" }));
      }
      setBusy(true);
      try {
        await axios.put(`${API_URL}/integrations/cargo/${id}`, {
          ...Object.fromEntries(Object.entries(tokenOnly).filter(([, v]) => v !== "")),
          test_mode: testMode,
          is_active: true,
          ...packageBody(),
        });
      } finally {
        setBusy(false);
      }
      const r = await axios.post(`${API_URL}/integrations/cargo/${id}/test`);
      const addrs = r.data.addresses || [];
      setAddresses(addrs);
      toast[r.data.ok ? "success" : "error"](r.data.message);
      if (addrs.length === 1) {
        const next = { ...tokenOnly, sender_address_id: addrs[0].id };
        setForm(next);
        setBusy(true);
        try {
          await axios.put(`${API_URL}/integrations/cargo/${id}`, {
            ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== "")),
            test_mode: testMode,
            is_active: true,
            ...packageBody(),
          });
          toast.success(`Gönderici adres kaydedildi: ${addrs[0].name || addrs[0].id}`);
        } catch (err) {
          toast.error(err.response?.data?.detail || "Gönderici adres kaydedilemedi.");
        } finally {
          setBusy(false);
        }
      } else if (addrs.length > 1) {
        toast.message("Birden fazla gönderici adres var — listeden seçip Kaydet'e basın.");
      }
    } catch (err) {
      const detail = err.response?.data?.detail || "Bağlantı testi başarısız.";
      const msg = typeof detail === "string" ? detail : "Bağlantı testi başarısız.";
      setTestError(msg);
      toast.error(msg);
      if (!testMode && isGeliver) setTestMode(true);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="cargo-config-modal">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-base font-bold text-slate-900">{config.carrier_name} API Ayarları</h3>
          <button onClick={onClose} className="text-slate-400" data-testid="cargo-config-close"><X className="w-5 h-5" /></button>
        </div>

        {testError && (
          <div className="text-[11px] bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-2 leading-relaxed flex gap-1.5" data-testid="cargo-cfg-test-error">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{testError}</span>
          </div>
        )}

        {isGeliver && (
          <div className="space-y-2">
            <div className="text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2 flex gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Token <b>app.geliver.io → API Tokens</b> sayfasından alınır (mağaza domain’i veya oturum anahtarı değil).
            </div>
            <div className="text-[11px] bg-slate-50 border border-slate-200 text-slate-700 rounded-lg p-2 leading-relaxed">
              <b>«Yetkiniz yok»</b> çoğunlukla Geliver hesabından gelir: <b>Test modunu açın</b>, bakiyeyi kontrol edin, token’ı API Tokens’tan yenileyin.
              Gönderici adres alanına <code className="font-mono">xxx.geliver.io</code> yazmayın — «Bağlantıyı Test Et» sonrası listeden seçin.
            </div>
          </div>
        )}

        <form onSubmit={save} className="space-y-3 text-xs">
          {fields.map((f) => (
            <div key={f}>
              <label className="block font-semibold text-slate-700 mb-1">{LABELS[f] || f}</label>
              {f === "sender_address_id" && addresses.length > 0 ? (
                <select
                  value={form[f] || ""}
                  onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  data-testid="cargo-cfg-sender_address_id"
                >
                  <option value="">Seçin…</option>
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} — {a.district}/{a.city}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={isSecret(f) ? "password" : "text"}
                  value={form[f]}
                  onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                  placeholder={
                    isSecret(f) && config[`has_${f}`]
                      ? "•••••••• (kayıtlı — değiştirmek için yazın)"
                      : f === "sender_address_id"
                        ? "Önce Bağlantıyı Test Et → listeden seçin (domain yazmayın)"
                        : ""
                  }
                  className={`w-full bg-slate-50 border rounded-lg p-2 font-mono ${f === "sender_address_id" && badSender ? "border-rose-400" : "border-slate-200"}`}
                  data-testid={`cargo-cfg-${f}`}
                />
              )}
              {f === "sender_address_id" && badSender && (
                <p className="mt-1 text-[10px] text-rose-700" data-testid="cargo-cfg-sender-domain-warn">
                  Bu alan mağaza adresi değil. <b>{form.sender_address_id}</b> geçersiz — silin, Test Et ile gerçek adres ID’sini seçin.
                </p>
              )}
            </div>
          ))}

          {isGeliver && (
            <label className={`flex items-center gap-2 cursor-pointer border rounded-lg p-2 ${testMode ? "bg-amber-50 border-amber-200" : "bg-rose-50 border-rose-300"}`} data-testid="cargo-cfg-test-mode">
              <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} className="rounded" />
              <FlaskConical className={`w-3.5 h-3.5 ${testMode ? "text-amber-600" : "text-rose-600"}`} />
              <span>
                <b>Test modu</b> (test:true) — gerçek kargo/ücret oluşmaz.
                {!testMode && <span className="block text-rose-700 font-semibold">Canlı mod açık — yetki/bakiye hataları sık görülür; önce Test’i açın.</span>}
              </span>
            </label>
          )}

          <div className="border-t pt-2 space-y-2" data-testid="cargo-cfg-package-defaults">
            <div className="text-[11px] font-bold text-slate-700">Varsayılan paket (tüm gönderiler)</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["default_package_count", "Paket"],
                ["default_desi", "Desi"],
                ["default_weight", "Kg"],
                ["default_length", "En cm"],
                ["default_width", "Boy cm"],
                ["default_height", "Yükseklik cm"],
              ].map(([k, l]) => (
                <div key={k}>
                  <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">{l}</label>
                  <input
                    type="number"
                    min={0}
                    step={k === "default_package_count" ? 1 : 0.1}
                    value={defaults[k]}
                    onChange={(e) => setDefaults({ ...defaults, [k]: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5"
                    data-testid={`cargo-cfg-${k}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-2 border-t">
            {isGeliver ? (
              <button type="button" onClick={test} disabled={testing} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg font-semibold text-slate-700 hover:bg-slate-50" data-testid="cargo-cfg-test-btn">
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />} Bağlantıyı Test Et & Adresleri Getir
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
              <button type="submit" disabled={busy || badSender} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="cargo-cfg-save">
                {busy ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
