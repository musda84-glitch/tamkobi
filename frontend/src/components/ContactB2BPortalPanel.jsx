import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ShoppingCart, Copy, ExternalLink, KeyRound, Loader2, Save } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const FEATURES = [
  ["allow_orders", "Sipariş alımı", "Sepet ve sipariş gönderme"],
  ["show_prices", "Fiyatları göster", "Kapalıysa yalnızca katalog"],
  ["show_stock", "Stok durumunu göster", ""],
  ["show_statement", "Hesap ekstresi sekmesi", ""],
  ["show_installments", "Taksitler sekmesi", ""],
  ["allow_ai_cart", "AI sepet (Excel/PDF yükleme)", "Sipariş listesini yükler, AI eşleştirir"],
];

/** Cari kartı içinde B2B portal erişimi + özellik ayarları. */
export function ContactB2BPortalPanel({ contactId, contactName, onChanged }) {
  const [portal, setPortal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [settings, setSettings] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [discount, setDiscount] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/contacts/${contactId}/b2b-portal`);
      setPortal(r.data);
      setSettings({ ...(r.data.settings || {}) });
      setEnabled(!!r.data.b2b_enabled);
      setDiscount(Number(r.data.b2b_discount) || 0);
      setLoginEmail(r.data.b2b_login_email || "");
      setPassword("");
    } catch {
      toast.error("B2B portal ayarları yüklenemedi.");
    }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);

  if (!portal || !settings) {
    return (
      <div className="flex items-center gap-2 text-slate-500 py-8 justify-center" data-testid="contact-b2b-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…
      </div>
    );
  }

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const link = portal.b2b_token ? `${window.location.origin}/portal/${portal.b2b_token}` : null;
  const loginUrl = `${window.location.origin}/b2b/giris`;

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        enabled,
        discount,
        login_email: loginEmail,
        settings,
        base_url: window.location.origin,
      };
      if (password.trim()) body.password = password.trim();
      const r = await axios.put(`${API_URL}/contacts/${contactId}/b2b-portal`, body);
      toast.success(r.data.message || "Kaydedildi.");
      if (enabled && r.data.link) {
        await navigator.clipboard?.writeText(r.data.link).catch(() => {});
      }
      setPassword("");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text, msg) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg || "Kopyalandı.");
    } catch {
      toast.error("Kopyalanamadı.");
    }
  };

  return (
    <div className="space-y-4 text-xs" data-testid="contact-b2b-portal-panel">
      {!portal.company_enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2" data-testid="contact-b2b-company-off">
          Şirket genelinde B2B portalı kapalı. Cari ayarları kaydedilir; müşteri giriş yapamaz ta ki şirket portalı açılana kadar.
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <ShoppingCart className="w-4 h-4 text-emerald-600" />
              {contactName || "Cari"} — B2B Portal
            </div>
            <p className="text-slate-500 mt-0.5">Bu cariye özel portal özellikleri, iskonto ve giriş bilgileri.</p>
          </div>
          <span className={`px-2 py-1 rounded-lg font-bold ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"}`} data-testid="contact-b2b-status">
            {enabled ? "ERİŞİM AÇIK" : "KAPALI"}
          </span>
        </div>

        <label className="flex items-start gap-2 bg-white border rounded-xl p-2.5 cursor-pointer" data-testid="contact-b2b-enabled">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5 rounded" />
          <span>
            <span className="block font-semibold text-slate-800">Portal erişimi açık</span>
            <span className="block text-[10px] text-slate-500">Kapalıysa bu müşteri B2B’ye giremez</span>
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block font-semibold mb-1">Giriş e-postası</label>
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="boş = cari e-posta / VKN"
              className="w-full bg-white border rounded-lg p-2"
              data-testid="contact-b2b-login-email"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">B2B iskonto %</label>
            <input
              type="number"
              min="0"
              max="90"
              step="0.5"
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value) || 0)}
              className="w-full bg-white border rounded-lg p-2 font-bold"
              data-testid="contact-b2b-discount"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block font-semibold mb-1 flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5" />
              {portal.has_password ? "Yeni şifre (değiştirmek için yazın)" : "Portal şifresi (min 6)"}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white border rounded-lg p-2"
              data-testid="contact-b2b-password"
              autoComplete="new-password"
            />
            {portal.has_password && (
              <div className="text-[10px] text-emerald-700 mt-1">Şifre tanımlı{portal.b2b_last_login ? ` · son giriş ${new Date(portal.b2b_last_login).toLocaleDateString("tr-TR")}` : ""}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-slate-200">
          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[220px]" title={loginUrl}>{loginUrl}</span>
          <button type="button" onClick={() => copy(loginUrl, "Giriş adresi kopyalandı.")} className="px-2 py-1 border rounded-lg font-semibold inline-flex items-center gap-1 hover:bg-white" data-testid="contact-b2b-copy-login">
            <Copy className="w-3 h-3" /> Giriş adresi
          </button>
          {enabled && link ? (
            <>
              <button type="button" onClick={() => copy(link, "Portal linki kopyalandı.")} className="px-2 py-1 border rounded-lg font-semibold inline-flex items-center gap-1 hover:bg-white" data-testid="contact-b2b-copy-link">
                <Copy className="w-3 h-3" /> Özel link
              </button>
              <a href={link} target="_blank" rel="noreferrer" className="px-2 py-1 bg-emerald-600 text-white rounded-lg font-semibold inline-flex items-center gap-1" data-testid="contact-b2b-open-link">
                <ExternalLink className="w-3 h-3" /> Aç
              </a>
            </>
          ) : null}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-slate-900">Bu cari için portal özellikleri</div>
          <div className="text-slate-500">Şirket varsayılanından bağımsız; yalnızca bu müşteriye uygulanır.</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FEATURES.map(([k, l, sub]) => (
            <label key={k} className="flex items-start gap-2 bg-slate-50 border rounded-xl p-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!!settings[k]}
                onChange={(e) => set(k, e.target.checked)}
                className="mt-0.5 rounded"
                data-testid={`contact-b2b-set-${k}`}
              />
              <span>
                <span className="block font-semibold text-slate-800">{l}</span>
                {sub ? <span className="block text-[10px] text-slate-500">{sub}</span> : null}
              </span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block font-semibold mb-1">Minimum sipariş (₺)</label>
            <input
              type="number"
              min="0"
              value={settings.min_order_amount ?? 0}
              onChange={(e) => set("min_order_amount", Number(e.target.value) || 0)}
              className="w-full bg-slate-50 border rounded-lg p-2"
              data-testid="contact-b2b-set-min"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Karşılama notu</label>
            <input
              value={settings.welcome_note || ""}
              onChange={(e) => set("welcome_note", e.target.value)}
              placeholder="Hoş geldiniz…"
              className="w-full bg-slate-50 border rounded-lg p-2"
              data-testid="contact-b2b-set-welcome"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          data-testid="contact-b2b-save"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Kaydet
        </button>
      </div>
    </div>
  );
}
