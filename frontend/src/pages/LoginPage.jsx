import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { LogIn, KeyRound, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { API_URL, useAuth } from "../context/AuthContext";
import { BuildStamp } from "../components/BuildStamp";
import { LOGIN } from "../constants/testIds/auth";
import { REMEMBER_ERP_KEY, clearRememberedEmail, loadRememberedEmail, saveRememberedEmail } from "../utils/rememberEmail";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", phone: "" });
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("login");
  const [channel, setChannel] = useState("email");
  const [err, setErr] = useState("");
  const [resetInfo, setResetInfo] = useState(null);

  useEffect(() => {
    const saved = loadRememberedEmail(REMEMBER_ERP_KEY);
    if (saved) {
      setForm((f) => ({ ...f, email: saved }));
      setRemember(true);
    }
  }, []);

  const forgetMe = () => {
    clearRememberedEmail(REMEMBER_ERP_KEY);
    setForm({ email: "", password: "", phone: "" });
    setRemember(false);
    toast.message("Kayıtlı giriş bilgisi temizlendi.");
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await login(form.email, form.password, remember);
    setBusy(false);
    if (ok) {
      if (remember) saveRememberedEmail(REMEMBER_ERP_KEY, form.email);
      else clearRememberedEmail(REMEMBER_ERP_KEY);
      navigate("/panel");
    }
  };

  const forgot = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setResetInfo(null);
    try {
      const payload = { channel, base_url: window.location.origin, next: "login" };
      if (channel === "sms") payload.phone = form.phone;
      else payload.email = form.email;
      const r = await axios.post(`${API_URL}/auth/forgot-password`, payload);
      setResetInfo(r.data);
      toast.success(r.data.message);
    } catch (e2) {
      setErr(e2.response?.data?.detail || "İstek gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const smsMode = channel === "sms";
  const deliveryOk = smsMode ? resetInfo?.sms_status === "sent" : resetInfo?.mail_status === "sent";
  const deliveryFail = resetInfo && (smsMode ? resetInfo.sms_status !== "sent" : resetInfo.mail_status && resetInfo.mail_status !== "sent");

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      {mode === "forgot" ? (
        <form onSubmit={forgot} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-4" data-testid="login-forgot-form">
          <div className="text-2xl font-black text-slate-900">Tam<span className="text-emerald-600">Kobi</span></div>
          <p className="text-xs text-slate-500">ERP veya personel hesabınız için sıfırlama bağlantısı alın. Eşleşen hesap varsa seçtiğiniz kanala gönderilir.</p>
          <div className="flex gap-2" data-testid="login-forgot-channel">
            <button type="button" onClick={() => { setChannel("email"); setResetInfo(null); setErr(""); }} className={`flex-1 py-2 rounded-xl border text-xs font-bold ${!smsMode ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700"}`} data-testid="login-forgot-channel-email">E-posta</button>
            <button type="button" onClick={() => { setChannel("sms"); setResetInfo(null); setErr(""); }} className={`flex-1 py-2 rounded-xl border text-xs font-bold ${smsMode ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700"}`} data-testid="login-forgot-channel-sms">SMS</button>
          </div>
          {smsMode ? (
            <div>
              <label className="block text-xs font-semibold mb-1">Kayıtlı telefon</label>
              <input type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" placeholder="05XXXXXXXXX" data-testid="login-forgot-phone" autoComplete="tel" />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold mb-1">E-posta</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="login-forgot-email" autoComplete="username" />
            </div>
          )}
          {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="login-forgot-error">{err}</div>}
          {resetInfo && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 space-y-1" data-testid="login-forgot-result">
              <div>{resetInfo.message}</div>
              {deliveryOk && <div>{smsMode ? "Telefonunuzu kontrol edin (1 saat geçerli)." : "E-postanızı kontrol edin (1 saat geçerli)."}</div>}
              {deliveryFail && (
                <div className="text-amber-800" data-testid="login-forgot-mail-fail">{resetInfo.detail || (smsMode ? "SMS gönderilemedi." : "E-posta gönderilemedi. Mail ayarlarını kontrol edip tekrar deneyin.")}</div>
              )}
            </div>
          )}
          <button disabled={busy} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2" data-testid="login-forgot-submit">
            <KeyRound className="w-4 h-4" /> {busy ? "Gönderiliyor…" : (smsMode ? "SMS ile Bağlantı Gönder" : "Sıfırlama Bağlantısı Gönder")}
          </button>
          <button type="button" onClick={() => { setMode("login"); setErr(""); setResetInfo(null); }} className="w-full text-[11px] text-slate-500 flex items-center justify-center gap-1" data-testid="login-forgot-back">
            <ArrowLeft className="w-3 h-3" /> Girişe dön
          </button>
          <BuildStamp tone="light" />
        </form>
      ) : (
        <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-4" data-testid="login-page">
          <div className="text-2xl font-black text-slate-900">Tam<span className="text-emerald-600">Kobi</span></div>
          <p className="text-xs text-slate-500">Hesabınızla giriş yapın. Personel ve yönetici aynı ekranı kullanır.</p>
          <div>
            <label className="block text-xs font-semibold mb-1">E-posta</label>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="login-email" autoComplete="username" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Şifre</label>
            <input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="login-password" autoComplete="current-password" />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2" data-testid="login-remember-row">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none" data-testid="login-remember-label">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                data-testid="login-remember"
              />
              Beni hatırla
            </label>
            <button
              type="button"
              onClick={forgetMe}
              className="text-xs text-slate-600 hover:text-rose-700 font-semibold underline-offset-2 hover:underline px-1.5 py-0.5"
              data-testid="login-forget"
              title="Kayıtlı e-postayı temizle"
            >
              Beni unut
            </button>
          </div>
          <button disabled={busy} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2" data-testid="login-submit">
            <LogIn className="w-4 h-4" /> {busy ? "Giriş yapılıyor…" : "Giriş Yap"}
          </button>
          <button type="button" onClick={() => { setMode("forgot"); setErr(""); }} className="w-full text-[11px] text-emerald-700 font-semibold" data-testid={LOGIN.forgotPasswordLink}>
            Şifremi unuttum
          </button>
          <p className="text-[11px] text-slate-500 text-center">
            Hesabınız yok mu? <Link to="/web" className="text-emerald-600 font-semibold" data-testid="login-signup-link">14 gün ücretsiz deneyin</Link>
            {" "}· Bayi misiniz? <Link to="/b2b/giris" className="text-indigo-600 font-semibold" data-testid="login-b2b-link">B2B Girişi</Link>
          </p>
          <BuildStamp tone="light" />
        </form>
      )}
    </div>
  );
}
