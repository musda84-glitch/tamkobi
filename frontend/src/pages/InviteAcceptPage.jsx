import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export default function InviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ name: "", password: "", password2: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/public/invites/${token}`).then((r) => { setInv(r.data); setForm((f) => ({ ...f, name: r.data.name || "" })); }).catch((e) => setErr(e.response?.data?.detail || "Davet yüklenemedi.")); }, [token]);
  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.password2) { toast.error("Şifreler eşleşmiyor."); return; }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/public/invites/${token}/accept`, { name: form.name, password: form.password }, { withCredentials: true });
      toast.success("Hesabınız oluşturuldu. Hoş geldiniz!");
      window.location.href = "/";
    } catch (e2) { toast.error(e2.response?.data?.detail || "Kayıt tamamlanamadı."); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5" data-testid="invite-page">
        <div className="flex items-center gap-2 text-emerald-600 font-black text-lg"><ShieldCheck className="w-6 h-6" /> NexusHesap Davet</div>
        {err ? <div className="text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm" data-testid="invite-error">{err}<button onClick={() => navigate("/login")} className="block mt-2 underline text-xs">Giriş sayfasına git</button></div> : !inv ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : (
          <form onSubmit={submit} className="space-y-3 text-sm">
            <p className="text-slate-600"><b>{inv.company_name}</b> sizi <b>{inv.role_name}</b> rolüyle davet etti. Hesabınız <span className="font-mono">{inv.email}</span> için oluşturulacak.</p>
            <div><label className="block text-xs font-semibold mb-1">Ad Soyad</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-xl p-2.5" data-testid="invite-accept-name" /></div>
            <div><label className="block text-xs font-semibold mb-1">Şifre (en az 6 karakter)</label><input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-xl p-2.5" data-testid="invite-accept-password" /></div>
            <div><label className="block text-xs font-semibold mb-1">Şifre (tekrar)</label><input type="password" required value={form.password2} onChange={(e) => setForm({ ...form, password2: e.target.value })} className="w-full border rounded-xl p-2.5" data-testid="invite-accept-password2" /></div>
            <button disabled={busy} className="w-full py-2.5 bg-emerald-600 text-white rounded-xl font-bold" data-testid="invite-accept-submit">{busy ? "Oluşturuluyor…" : "Hesabımı Oluştur & Giriş Yap"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
