
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const ok = await login(form.email, form.password);
    setBusy(false);
    if (ok) navigate("/panel");
  };
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-4" data-testid="login-page">
        <div className="text-2xl font-black text-slate-900">Tam<span className="text-emerald-600">Kobi</span></div>
        <p className="text-xs text-slate-500">Hesabınızla giriş yapın.</p>
        <div><label className="block text-xs font-semibold mb-1">E-posta</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="login-email" /></div>
        <div><label className="block text-xs font-semibold mb-1">Şifre</label><input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="login-password" /></div>
        <button disabled={busy} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2" data-testid="login-submit"><LogIn className="w-4 h-4" /> {busy ? "Giriş yapılıyor…" : "Giriş Yap"}</button>
        <p className="text-[11px] text-slate-500 text-center">Hesabınız yok mu? <Link to="/web" className="text-emerald-600 font-semibold" data-testid="login-signup-link">14 gün ücretsiz deneyin</Link> · Bayi misiniz? <Link to="/b2b/giris" className="text-indigo-600 font-semibold" data-testid="login-b2b-link">B2B Girişi</Link></p>
      </form>
    </div>
  );
}
