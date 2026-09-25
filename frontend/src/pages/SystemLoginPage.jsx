import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { ShieldCheck, LogIn, KeyRound, ArrowLeft } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { BuildStamp } from "../components/BuildStamp";
import { REMEMBER_SYS_KEY, clearRememberedEmail, loadRememberedEmail, saveRememberedEmail } from "../utils/rememberEmail";

export default function SystemLoginPage() {
  const { user, authenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [remember, setRemember] = useState(true);
  const [mode, setMode] = useState("login");
  const [channel, setChannel] = useState("email");
  const [resetInfo, setResetInfo] = useState(null);

  useEffect(() => { if (!loading && authenticated && user?.is_super_admin) navigate("/sistem", { replace: true }); }, [loading, authenticated, user, navigate]);
  useEffect(() => {
    const saved = loadRememberedEmail(REMEMBER_SYS_KEY);
    if (saved) {
      setForm((f) => ({ ...f, email: saved }));
      setRemember(true);
    }
  }, []);

  const forgetMe = () => {
    clearRememberedEmail(REMEMBER_SYS_KEY);
    setForm({ email: "", password: "", phone: "" });
    setRemember(false);
    toast.message("Kayıtlı giriş bilgisi temizlendi.");
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await axios.post(`${API_URL}/auth/login`, { ...form, remember }, { withCredentials: true });
      if (!r.data.user?.is_super_admin) { await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true }).catch(() => {}); setErr("Bu hesap platform yöneticisi değil. Sistem paneline yalnızca süper admin girebilir."); return; }
      if (remember) saveRememberedEmail(REMEMBER_SYS_KEY, form.email);
      else clearRememberedEmail(REMEMBER_SYS_KEY);
      toast.success(`Hoş geldiniz, ${r.data.user.name}`);
      window.location.href = "/sistem";
    } catch (e2) { setErr(e2.response?.data?.detail || "Giriş yapılamadı."); } finally { setBusy(false); }
  };

  const forgot = async (e) => {
    e.preventDefault(); setBusy(true); setErr(""); setResetInfo(null);
    try {
      const payload = { channel, base_url: window.location.origin, next: "sistem" };
      if (channel === "sms") payload.phone = form.phone;
      else payload.email = form.email;
      const r = await axios.post(`${API_URL}/auth/forgot-password`, payload);
      setResetInfo(r.data);
      toast.success(r.data.message);
    } catch (e2) { setErr(e2.response?.data?.detail || "İstek gönderilemedi."); } finally { setBusy(false); }
  };

  const smsMode = channel === "sms";
  const deliveryOk = smsMode ? resetInfo?.sms_status === "sent" : resetInfo?.mail_status === "sent";
  const deliveryFail = resetInfo && (smsMode ? resetInfo.sms_status !== "sent" : resetInfo.mail_status && resetInfo.mail_status !== "sent");

  return (
    <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute -left-20 -top-20 w-96 h-96 rounded-full bg-amber-400/10 blur-3xl" />
      {mode === "forgot" ? (
        <form onSubmit={forgot} className="relative bg-[#0e1422] border border-white/10 rounded-3xl w-full max-w-sm p-8 space-y-4 text-slate-100" data-testid="sys-forgot-form">
          <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-xl bg-amber-400 flex items-center justify-center text-slate-900"><ShieldCheck className="w-5 h-5" /></div><div><div className="font-bold">Tam<span className="text-amber-400">Kobi</span></div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Şifre Sıfırlama</div></div></div>
          <p className="text-xs text-slate-400">Platform yönetici hesabınız için sıfırlama bağlantısı alın. Eşleşen hesap varsa seçtiğiniz kanala gider.</p>
          <div className="flex gap-2" data-testid="sys-forgot-channel">
            <button type="button" onClick={() => { setChannel("email"); setResetInfo(null); setErr(""); }} className={`flex-1 py-2 rounded-xl border text-xs font-bold ${!smsMode ? "bg-amber-400 text-slate-900 border-amber-400" : "bg-white/5 text-slate-300 border-white/10"}`} data-testid="sys-forgot-channel-email">E-posta</button>
            <button type="button" onClick={() => { setChannel("sms"); setResetInfo(null); setErr(""); }} className={`flex-1 py-2 rounded-xl border text-xs font-bold ${smsMode ? "bg-amber-400 text-slate-900 border-amber-400" : "bg-white/5 text-slate-300 border-white/10"}`} data-testid="sys-forgot-channel-sms">SMS</button>
          </div>
          {smsMode ? (
            <div><label className="block text-xs font-semibold mb-1 text-slate-300">Kayıtlı telefon</label><input type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50" placeholder="05XXXXXXXXX" data-testid="sys-forgot-phone" /></div>
          ) : (
            <div><label className="block text-xs font-semibold mb-1 text-slate-300">E-posta</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50" data-testid="sys-forgot-email" /></div>
          )}
          {err && <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2" data-testid="sys-forgot-error">{err}</div>}
          {resetInfo && (
            <div className="text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 space-y-1" data-testid="sys-forgot-result">
              <div>{resetInfo.message}</div>
              {deliveryOk && <div>{smsMode ? "Telefonunuzu kontrol edin (1 saat geçerli)." : "E-postanızı kontrol edin (1 saat geçerli)."}</div>}
              {deliveryFail && (
                <div className="text-amber-200" data-testid="sys-forgot-mail-fail">{resetInfo.detail || (smsMode ? "SMS gönderilemedi." : "E-posta gönderilemedi. Mail ayarlarını kontrol edip tekrar deneyin.")}</div>
              )}
            </div>
          )}
          <button disabled={busy} className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60" data-testid="sys-forgot-submit"><KeyRound className="w-4 h-4" /> {busy ? "Gönderiliyor…" : (smsMode ? "SMS ile Bağlantı Gönder" : "Sıfırlama Bağlantısı Gönder")}</button>
          <button type="button" onClick={() => { setMode("login"); setErr(""); setResetInfo(null); }} className="w-full text-[11px] text-slate-400 flex items-center justify-center gap-1" data-testid="sys-forgot-back"><ArrowLeft className="w-3 h-3" /> Girişe dön</button>
          <BuildStamp tone="system" />
        </form>
      ) : (
        <form onSubmit={submit} className="relative bg-[#0e1422] border border-white/10 rounded-3xl w-full max-w-sm p-8 space-y-4 text-slate-100" data-testid="system-login-page">
          <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-xl bg-amber-400 flex items-center justify-center text-slate-900"><ShieldCheck className="w-5 h-5" /></div><div><div className="font-bold" data-testid="sys-login-brand">Tam<span className="text-amber-400">Kobi</span></div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Platform Yönetimi</div></div></div>
          <p className="text-xs text-slate-400">Bu alan müşteri ERP'sinden bağımsızdır; yalnızca platform yöneticileri giriş yapabilir.</p>
          <div><label className="block text-xs font-semibold mb-1 text-slate-300">E-posta</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50" data-testid="sys-login-email" /></div>
          <div><label className="block text-xs font-semibold mb-1 text-slate-300">Şifre</label><input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50" data-testid="sys-login-password" /></div>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2" data-testid="sys-remember-row">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-200 cursor-pointer select-none">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 rounded border-white/20 text-amber-400 focus:ring-amber-400" data-testid="sys-remember" />
              Beni hatırla
            </label>
            <button type="button" onClick={forgetMe} className="text-xs text-slate-400 hover:text-rose-300 font-semibold underline-offset-2 hover:underline px-1.5 py-0.5" data-testid="sys-forget">Beni unut</button>
          </div>
          {err && <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2" data-testid="sys-login-error">{err}</div>}
          <button disabled={busy} className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60" data-testid="sys-login-submit"><LogIn className="w-4 h-4" /> {busy ? "Giriş yapılıyor…" : "Panele Giriş"}</button>
          <button type="button" onClick={() => { setMode("forgot"); setErr(""); }} className="w-full text-[11px] text-amber-300 font-semibold" data-testid="sys-forgot-open">Şifremi unuttum</button>
          <BuildStamp tone="system" />
        </form>
      )}
    </div>
  );
}
