
import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { LogIn, ShoppingCart, FileSpreadsheet, Truck, Wallet, KeyRound, ArrowLeft } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export default function B2BLoginPage() {
  const [f, setF] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState("login");
  const [resetInfo, setResetInfo] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await axios.post(`${API_URL}/public/b2b/login`, f); toast.success(`Hoş geldiniz, ${r.data.name}`); window.location.href = r.data.redirect; } catch (e2) { setErr(e2.response?.data?.detail || "Giriş yapılamadı."); } finally { setBusy(false); }
  };
  const forgot = async (e) => {
    e.preventDefault(); setBusy(true); setErr(""); setResetInfo(null);
    try {
      const r = await axios.post(`${API_URL}/public/b2b/forgot-password`, { email: f.email, base_url: window.location.origin });
      setResetInfo(r.data);
      toast.success(r.data.message);
    } catch (e2) { setErr(e2.response?.data?.detail || "İstek gönderilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid grid-cols-1 lg:grid-cols-2" data-testid="b2b-login-page">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.25),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_40%)]">
        <div className="font-bold text-lg">Bayi <span className="text-emerald-400">Portalı</span></div>
        <div className="space-y-6 max-w-md">
          <h1 className="text-4xl font-black leading-tight">Siparişinizi dakikalar içinde verin.</h1>
          <ul className="space-y-3 text-sm text-slate-300">
            {[[ShoppingCart, "Size özel iskontolu fiyat listesi ve anlık stok"], [FileSpreadsheet, "Excel / PDF sipariş listenizi yükleyin, AI sepetinizi otomatik oluştursun"], [Truck, "Kargo takibi ve sipariş geçmişi"], [Wallet, "Cari ekstre, fatura ve taksit takibi"]].map(([I, t]) => <li key={t} className="flex items-start gap-3"><span className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0"><I className="w-4 h-4 text-emerald-300" /></span>{t}</li>)}
          </ul>
        </div>
        <div className="text-[11px] text-slate-500">Bu portal yalnızca yetkili bayi/müşterilere açıktır.</div>
      </div>
      <div className="flex items-center justify-center p-6">
        {mode === "forgot" ? (
          <form onSubmit={forgot} className="w-full max-w-sm bg-white text-slate-900 rounded-3xl p-8 space-y-4 shadow-2xl" data-testid="b2b-forgot-form">
            <div><div className="text-[10px] uppercase tracking-[0.2em] text-emerald-600 font-semibold">Şifre Sıfırlama</div><h2 className="text-xl font-bold mt-1">Bağlantı isteyin</h2><p className="text-xs text-slate-500 mt-1">Kayıtlı e-posta veya VKN girin. Eşleşen hesap varsa sıfırlama bağlantısı gönderilir.</p></div>
            <div><label className="block text-xs font-semibold mb-1">E-posta veya VKN</label><input required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm" data-testid="b2b-forgot-email" /></div>
            {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="b2b-forgot-error">{err}</div>}
            {resetInfo && (
              <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 space-y-1" data-testid="b2b-forgot-result">
                <div>{resetInfo.message}</div>
                {resetInfo.mail_status === "sent" && <div>E-postanızı kontrol edin (1 saat geçerli).</div>}
                {resetInfo.reset_url && <a href={resetInfo.reset_url} className="block font-semibold text-emerald-700 underline" data-testid="b2b-forgot-link">E-posta gönderilemedi — şifreyi buradan sıfırlayın</a>}
              </div>
            )}
            <button disabled={busy} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60" data-testid="b2b-forgot-submit"><KeyRound className="w-4 h-4" /> {busy ? "Gönderiliyor…" : "Sıfırlama Bağlantısı Gönder"}</button>
            <button type="button" onClick={() => { setMode("login"); setErr(""); setResetInfo(null); }} className="w-full text-[11px] text-slate-500 flex items-center justify-center gap-1" data-testid="b2b-forgot-back"><ArrowLeft className="w-3 h-3" /> Girişe dön</button>
          </form>
        ) : (
          <form onSubmit={submit} className="w-full max-w-sm bg-white text-slate-900 rounded-3xl p-8 space-y-4 shadow-2xl">
            <div><div className="text-[10px] uppercase tracking-[0.2em] text-emerald-600 font-semibold">B2B Müşteri Girişi</div><h2 className="text-xl font-bold mt-1">Hesabınıza giriş yapın</h2><p className="text-xs text-slate-500 mt-1">Tedarikçinizin size verdiği e-posta / VKN ve şifre ile.</p></div>
            <div><label className="block text-xs font-semibold mb-1">E-posta veya VKN</label><input required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm" data-testid="b2b-login-email" /></div>
            <div><label className="block text-xs font-semibold mb-1">Şifre</label><input type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm" data-testid="b2b-login-password" /></div>
            {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="b2b-login-error">{err}</div>}
            <button disabled={busy} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60" data-testid="b2b-login-submit"><LogIn className="w-4 h-4" /> {busy ? "Giriş yapılıyor…" : "Portala Giriş"}</button>
            <button type="button" onClick={() => { setMode("forgot"); setErr(""); }} className="w-full text-[11px] text-emerald-700 font-semibold" data-testid="b2b-forgot-open">Şifremi unuttum</button>
            <p className="text-[11px] text-slate-400 text-center">Şifrenizi bilmiyorsanız tedarikçinizden B2B erişimi isteyin.</p>
          </form>
        )}
      </div>
    </div>
  );
}
