import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { BuildStamp } from "../components/BuildStamp";

const REMEMBER_KEY = "tamkobi_remember_email";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setForm((f) => ({ ...f, email: saved }));
        setRemember(true);
      }
    } catch { /* ignore */ }
  }, []);

  const forgetMe = () => {
    try { localStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ }
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
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, form.email.trim().toLowerCase());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch { /* ignore */ }
      navigate("/panel");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-4" data-testid="login-page">
        <div className="text-2xl font-black text-slate-900">Tam<span className="text-emerald-600">Kobi</span></div>
        <p className="text-xs text-slate-500">Hesabınızla giriş yapın.</p>
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
        <p className="text-[11px] text-slate-500 text-center">
          Hesabınız yok mu? <Link to="/web" className="text-emerald-600 font-semibold" data-testid="login-signup-link">14 gün ücretsiz deneyin</Link>
          {" "}· Bayi misiniz? <Link to="/b2b/giris" className="text-indigo-600 font-semibold" data-testid="login-b2b-link">B2B Girişi</Link>
        </p>
        <BuildStamp tone="light" />
      </form>
    </div>
  );
}
