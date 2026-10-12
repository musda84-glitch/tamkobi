import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { ShieldCheck, Copy, Check } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { BuildStamp } from "../components/BuildStamp";

export default function System2FASetupPage() {
  const { user, authenticated, loading, refreshLicense } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState("load"); // load | qr | codes | done
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!authenticated || !user?.is_super_admin) {
      navigate("/sistem/giris", { replace: true });
      return;
    }
    if (user.totp_enabled && !user.requires_2fa_setup) {
      navigate("/sistem", { replace: true });
    }
  }, [loading, authenticated, user, navigate]);

  useEffect(() => {
    if (!authenticated || !user?.is_super_admin || user?.totp_enabled) return;
    let cancelled = false;
    (async () => {
      setBusy(true); setErr("");
      try {
        const r = await axios.post(`${API_URL}/auth/2fa/setup/start`, {}, { withCredentials: true });
        if (cancelled) return;
        setSecret(r.data.secret || "");
        setQr(r.data.qr_data_url || "");
        setStep("qr");
      } catch (e) {
        if (!cancelled) setErr(e.response?.data?.detail || "Kurulum başlatılamadı.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, user?.is_super_admin, user?.totp_enabled]);

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await axios.post(`${API_URL}/auth/2fa/setup/confirm`, { code: code.trim() }, { withCredentials: true });
      setRecovery(r.data.recovery_codes || []);
      setStep("codes");
      toast.success("2FA etkinleştirildi.");
      try { await refreshLicense?.(); } catch { /* ignore */ }
    } catch (e2) {
      setErr(e2.response?.data?.detail || "Kod doğrulanamadı.");
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recovery.join("\n"));
      setCopied(true);
      toast.success("Kurtarma kodları kopyalandı.");
    } catch {
      toast.error("Kopyalanamadı.");
    }
  };

  const finish = () => {
    setStep("done");
    window.location.href = "/sistem";
  };

  if (loading || !user?.is_super_admin) {
    return <div className="min-h-screen bg-[#0b0f1a] text-slate-400 flex items-center justify-center text-xs">Yükleniyor…</div>;
  }

  return (
    <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center p-6" data-testid="sys-2fa-setup-page">
      <div className="relative bg-[#0e1422] border border-white/10 rounded-3xl w-full max-w-md p-8 space-y-4 text-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-400 flex items-center justify-center text-slate-900"><ShieldCheck className="w-5 h-5" /></div>
          <div>
            <div className="font-bold text-white text-sm">Süper admin 2FA kurulumu</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Google Authenticator uyumlu</div>
          </div>
        </div>

        {step === "load" && <p className="text-xs text-slate-400">{busy ? "Kurulum hazırlanıyor…" : (err || "…")}</p>}

        {step === "qr" && (
          <form onSubmit={confirm} className="space-y-4">
            <p className="text-xs text-slate-400">Authenticator uygulamanızda QR kodu tarayın veya anahtarı elle girin. Ardından 6 haneli kodu doğrulayın.</p>
            {qr && <img src={qr} alt="2FA QR" className="mx-auto w-48 h-48 rounded-xl bg-white p-2" data-testid="sys-2fa-qr" />}
            <div className="text-[11px] font-mono text-amber-200 bg-white/5 border border-white/10 rounded-xl px-3 py-2 break-all" data-testid="sys-2fa-secret">{secret}</div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-300">Doğrulama kodu</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                placeholder="000000"
                data-testid="sys-2fa-setup-code"
              />
            </div>
            {err && <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2" data-testid="sys-2fa-setup-error">{err}</div>}
            <button disabled={busy} type="submit" className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl font-bold disabled:opacity-60" data-testid="sys-2fa-setup-confirm">
              {busy ? "Doğrulanıyor…" : "Etkinleştir"}
            </button>
          </form>
        )}

        {step === "codes" && (
          <div className="space-y-4" data-testid="sys-2fa-recovery">
            <p className="text-xs text-amber-200 bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2">
              Bu kurtarma kodları yalnızca bir kez gösterilir. Telefonunuzu kaybederseniz bunlarla giriş yapabilirsiniz; güvenli bir yere kaydedin.
            </p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-xs">
              {recovery.map((c) => (
                <li key={c} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-center" data-testid="sys-2fa-recovery-code">{c}</li>
              ))}
            </ul>
            <button type="button" onClick={copyCodes} className="w-full py-2 border border-white/15 rounded-xl text-xs font-bold flex items-center justify-center gap-2" data-testid="sys-2fa-copy-codes">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Kopyalandı" : "Kodları kopyala"}
            </button>
            <button type="button" onClick={finish} className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl font-bold" data-testid="sys-2fa-setup-done">
              Kaydettim — panele git
            </button>
          </div>
        )}

        <BuildStamp tone="system" />
      </div>
    </div>
  );
}
