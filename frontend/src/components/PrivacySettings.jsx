import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ShieldOff, ShieldCheck, Loader2, EyeOff } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

export const PrivacySettings = ({ companyId }) => {
  const { user } = useAuth();
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const canEdit = user?.role === "admin";
  useEffect(() => {
    axios.get(`${API_URL}/companies/${companyId}/privacy`).then((r) => setP(r.data)).catch((e) => toast.error(e.response?.data?.detail || "Gizlilik ayarı yüklenemedi."));
  }, [companyId]);
  const setAllow = async (allow) => {
    if (!canEdit) { toast.error("Bu ayarı yalnızca şirket yöneticisi değiştirebilir."); return; }
    if (!allow && !window.confirm("Yönetim paneli (Platform Yönetimi) bu hesaba 'Şirket Olarak Gir' ile giremeyecek. Destek ekibi verilerinizi göremez. Kapatmak istiyor musunuz?")) return;
    setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/companies/${companyId}/privacy`, { allow_platform_access: allow });
      setP(r.data);
      toast.success(r.data.message);
    } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  if (!p) return <div className="bg-white border rounded-2xl p-8 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  const on = p.allow_platform_access !== false;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs max-w-2xl" data-testid="privacy-settings">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${on ? "bg-emerald-50 text-emerald-700" : "bg-slate-900 text-amber-300"}`}>
          {on ? <ShieldCheck className="w-5 h-5" /> : <ShieldOff className="w-5 h-5" />}
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><EyeOff className="w-4 h-4 text-slate-400" /> Yönetim paneli erişimi</h2>
          <p className="text-slate-500 mt-0.5">Platform Yönetimi’ndeki “Şirket Olarak Gir” (destek modu), hesabınıza sizin yerinize giriş yapar. Bu anahtarı kapatırsanız yönetim paneli hesabınıza giremez; fatura, cari ve stok verileriniz destek oturumuyla açılamaz.</p>
        </div>
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${on ? "border-emerald-200 bg-emerald-50/60" : "border-slate-300 bg-slate-50"}`} data-testid="privacy-platform-row">
        <div>
          <div className="font-bold text-slate-900">Destek ekibinin hesaba girişine izin ver</div>
          <div className="text-[11px] text-slate-500 mt-0.5" data-testid="privacy-platform-status">{on ? "Açık — yönetim paneli destek moduyla girebilir." : "Kapalı — yönetim panelinden hesaba giriş engellendi."}</div>
          {p.updated_at && <div className="text-[10px] text-slate-400 mt-1">Son değişiklik: {new Date(p.updated_at).toLocaleString("tr-TR")}{p.updated_by_name ? ` · ${p.updated_by_name}` : ""}</div>}
        </div>
        <button type="button" role="switch" aria-checked={on} disabled={busy || !canEdit} onClick={() => setAllow(!on)} className={`relative inline-flex w-12 h-6 rounded-full transition ${on ? "bg-emerald-600" : "bg-slate-400"} disabled:opacity-50`} data-testid="privacy-platform-toggle">
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? "left-6" : "left-0.5"}`} />
        </button>
      </div>
      {!canEdit && <p className="text-[11px] text-amber-700">Bu anahtarı yalnızca şirket yöneticisi açıp kapatabilir.</p>}
      <ul className="text-[11px] text-slate-500 list-disc pl-4 space-y-1">
        <li>Kapalıyken Platform Yönetimi şirket kartındaki “Şirket Olarak Gir” çalışmaz.</li>
        <li>Kendi kullanıcılarınız ve davet ettiğiniz çalışanlar her zamanki gibi giriş yapar.</li>
        <li>İstediğiniz zaman bu ekrandan tekrar açabilirsiniz.</li>
      </ul>
    </div>
  );
};
