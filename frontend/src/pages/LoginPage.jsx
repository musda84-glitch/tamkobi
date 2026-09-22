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
  const [form, setForm] = useState({ email: "", password: "" });
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("login");
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
    setForm({ email: "", password: "" });
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
      const r = await axios.post(`${API_URL}/auth/forgot-password`, { email: form.email, base_url: window.location.origin, next: "login" });
      setResetInfo(r.data);
      toast.success(r.data.message);
    } catch (e2) {
      setErr(e2.response?.data?.detail || "İstek gönderilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      {mode === "forgot" ? (
        <form onSubmit={forgot} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-4" data-testid="login-forgot-form">
          <div className="text-2xl font-black text-slate-900">Tam<span className="text-emerald-600">Kobi</span></div>
          <p className="text-xs text-slate-500">ERP veya personel hesabınızın e-postasını girin. Eşleşen hesap varsa sıfırlama bağlantısı gönderilir.</p>
          <div>
            <label className="block text-xs font-semibold mb-1">E-posta</label>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="login-forgot-email" autoComplete="username" />
          </div>
          {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="login-forgot-error">{err}</div>}
          {resetInfo && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 space-y-1" data-testid="login-forgot-result">
              <div>{resetInfo.message}</div>
              {resetInfo.mail_status === "sent" && <div>E-postanızı kontrol edin (1 saat geçerli).</div>}
              {resetInfo.reset_url && <a href={resetInfo.reset_url} className="block font-semibold text-emerald-700 underline" data-testid="login-forgot-link">E-posta gönderilemedi — şifreyi buradan sıfırlayın</a>}
            </div>
          )}
          <button disabled={busy} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2" data-testid="login-forgot-submit">
            <KeyRound className="w-4 h-4" /> {busy ? "Gönderiliyor…" : "Sıfırlama Bağlantısı Gönder"}
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
