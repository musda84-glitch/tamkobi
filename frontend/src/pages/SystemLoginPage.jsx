import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { ShieldCheck, LogIn } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

export default function SystemLoginPage() {
  const { user, authenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (!loading && authenticated && user?.is_super_admin) navigate("/sistem", { replace: true }); }, [loading, authenticated, user, navigate]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await axios.post(`${API_URL}/auth/login`, form, { withCredentials: true });
      if (!r.data.user?.is_super_admin) { await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true }).catch(() => {}); setErr("Bu hesap platform yöneticisi değil. Sistem paneline yalnızca süper admin girebilir."); return; }
      toast.success(`Hoş geldiniz, ${r.data.user.name}`);
      window.location.href = "/sistem";
    } catch (e2) { setErr(e2.response?.data?.detail || "Giriş yapılamadı."); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute -left-20 -top-20 w-96 h-96 rounded-full bg-amber-400/10 blur-3xl" />
      <form onSubmit={submit} className="relative bg-[#0e1422] border border-white/10 rounded-3xl w-full max-w-sm p-8 space-y-4 text-slate-100" data-testid="system-login-page">
        <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-xl bg-amber-400 flex items-center justify-center text-slate-900"><ShieldCheck className="w-5 h-5" /></div><div><div className="font-bold" data-testid="sys-login-brand">Tam<span className="text-amber-400">Kobi</span></div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Platform Yönetimi</div></div></div>
        <p className="text-xs text-slate-400">Bu alan müşteri ERP'sinden bağımsızdır; yalnızca platform yöneticileri giriş yapabilir.</p>
        <div><label className="block text-xs font-semibold mb-1 text-slate-300">E-posta</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50" data-testid="sys-login-email" /></div>
        <div><label className="block text-xs font-semibold mb-1 text-slate-300">Şifre</label><input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50" data-testid="sys-login-password" /></div>
        {err && <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2" data-testid="sys-login-error">{err}</div>}
        <button disabled={busy} className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60" data-testid="sys-login-submit"><LogIn className="w-4 h-4" /> {busy ? "Giriş yapılıyor…" : "Panele Giriş"}</button>
      </form>
    </div>
  );
}
