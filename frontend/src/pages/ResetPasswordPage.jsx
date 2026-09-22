import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export default function ResetPasswordPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ password: "", password2: "" });
  const [busy, setBusy] = useState(false);
  const nextHint = params.get("next") === "sistem" ? "sistem" : "login";

  useEffect(() => {
    axios.get(`${API_URL}/auth/reset/${token}`).then((r) => setInfo(r.data)).catch((e) => setErr(e.response?.data?.detail || "Bağlantı geçersiz."));
  }, [token]);

  const loginHref = (info?.next || nextHint) === "sistem" ? "/sistem/giris" : "/login";

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.password2) { toast.error("Şifreler eşleşmiyor."); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/auth/reset/${token}`, { password: form.password });
      toast.success("Şifreniz güncellendi.");
      window.location.href = r.data.redirect || loginHref;
    } catch (e2) { toast.error(e2.response?.data?.detail || "Şifre güncellenemedi."); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5" data-testid="erp-reset-page">
        <div className="flex items-center gap-2 text-emerald-600 font-black text-lg"><ShieldCheck className="w-6 h-6" /> Şifre Sıfırlama</div>
        {err ? (
          <div className="text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm" data-testid="erp-reset-error">
            {err}
            <button onClick={() => navigate(loginHref)} className="block mt-2 underline text-xs">Giriş sayfasına dön</button>
          </div>
        ) : !info ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : (
          <form onSubmit={submit} className="space-y-3 text-sm">
            <p className="text-slate-600">{info.name ? <><b>{info.name}</b> hesabı için</> : "Hesabınız için"} yeni bir şifre belirleyin.{info.email_masked && <span className="block text-xs text-slate-400 mt-1">{info.email_masked}</span>}</p>
            <div><label className="block text-xs font-semibold mb-1">Yeni şifre (en az 6 karakter)</label><input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-xl p-2.5" data-testid="erp-reset-password" /></div>
            <div><label className="block text-xs font-semibold mb-1">Yeni şifre (tekrar)</label><input type="password" required value={form.password2} onChange={(e) => setForm({ ...form, password2: e.target.value })} className="w-full border rounded-xl p-2.5" data-testid="erp-reset-password2" /></div>
            <button disabled={busy} className="w-full py-2.5 bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60" data-testid="erp-reset-submit"><KeyRound className="w-4 h-4" /> {busy ? "Kaydediliyor…" : "Şifreyi Kaydet"}</button>
            <p className="text-[11px] text-slate-400 text-center"><Link to={loginHref} className="text-emerald-700 font-semibold">Girişe dön</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
