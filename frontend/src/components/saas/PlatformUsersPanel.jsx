
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { UserPlus, Loader2, KeyRound, Trash2, Search, Shield } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls, Toggle, fmtDate } from "./saasUi";

const cred = { withCredentials: true };

export const PlatformUsersPanel = () => {
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", is_active: true });
  const [pwdFor, setPwdFor] = useState(null);
  const [pwd, setPwd] = useState("");
  const load = useCallback(() => {
    axios.get(`${API_URL}/system/users`, cred).then((r) => setData(r.data)).catch((e) => toast.error(e.response?.data?.detail || "Kullanıcılar alınamadı."));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="text-xs text-slate-400">Yükleniyor…</div>;
  const ql = q.trim().toLowerCase();
  const users = (data.users || []).filter((u) => !ql || (u.name || "").toLowerCase().includes(ql) || (u.email || "").toLowerCase().includes(ql));
  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API_URL}/system/users`, form, cred);
      toast.success("Panel yöneticisi oluşturuldu.");
      setForm({ name: "", email: "", password: "", is_active: true });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Oluşturulamadı."); } finally { setBusy(false); }
  };
  const patch = async (u, body, ok) => {
    try {
      await axios.put(`${API_URL}/system/users/${u.id}`, body, cred);
      toast.success(ok);
      setPwdFor(null); setPwd("");
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };
  const del = async (u) => {
    if (!window.confirm(`${u.name} (${u.email}) panel yöneticisi silinsin mi?`)) return;
    try {
      await axios.delete(`${API_URL}/system/users/${u.id}`, cred);
      toast.success("Panel yöneticisi silindi.");
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); }
  };
  return (
    <div className="space-y-4 text-xs" data-testid="saas-users">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-slate-700" data-testid="sys-staff-explainer">
        <div className="font-bold text-slate-900 flex items-center gap-1.5"><Shield className="w-4 h-4 text-amber-600" /> TamKobi panel ekibi</div>
        <p className="mt-1 text-[11px] leading-relaxed">Bu kişiler platformu (lisans, paket, müşteri şirketler) yönetir; bir müşteri şirketinin personeli değildir. Şirket kullanıcıları <b>Şirketler &amp; Lisanslar</b> üzerinden veya müşterinin <b>Firma Ayarları → Kullanıcılar &amp; Roller</b> ekranından yönetilir.</p>
      </div>
      <form onSubmit={create} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="sys-user-create">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><UserPlus className="w-4 h-4 text-amber-500" /> Yeni panel yöneticisi</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div><label className="block font-semibold text-slate-700 mb-1">Ad Soyad</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} data-testid="sys-user-name" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">E-posta</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} data-testid="sys-user-email" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Şifre</label><input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} data-testid="sys-user-password" /></div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2"><Toggle on={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} testId="sys-user-active" /> <span>Aktif</span></label>
          <button type="submit" disabled={busy} className="ml-auto px-4 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="sys-user-create-submit">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Oluştur</button>
        </div>
      </form>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad veya e-posta ara…" className={`${inputCls} pl-8 bg-white`} data-testid="sys-user-search" /></div>
        <div className="text-[11px] text-slate-500">{users.length} panel yöneticisi</div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[680px]" data-testid="sys-users-table">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2.5 text-left">Yönetici</th><th className="px-3 py-2.5 text-left">Durum</th><th className="px-3 py-2.5 text-left">Son giriş</th><th className="px-3 py-2.5 text-right">İşlem</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {users.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">Panel yöneticisi yok.</td></tr>}
            {users.map((u) => (
              <tr key={u.id} data-testid={`sys-user-row-${u.id}`}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{u.name}</div>
                  <div className="text-[10px] text-slate-500">{u.email}</div>
                  <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded"><Shield className="w-3 h-3" /> Platform</div>
                </td>
                <td className="px-3 py-2"><label className="flex items-center gap-2"><Toggle on={!!u.is_active} onChange={(v) => patch(u, { is_active: v }, v ? "Aktif edildi." : "Pasifleştirildi.")} testId={`sys-user-active-${u.id}`} /> <span>{u.is_active ? "Aktif" : "Pasif"}</span></label></td>
                <td className="px-3 py-2 text-slate-500">{fmtDate(u.last_login_at)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {pwdFor === u.id ? (
                    <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); patch(u, { password: pwd }, "Şifre güncellendi."); }}>
                      <input type="password" minLength={6} required value={pwd} onChange={(e) => setPwd(e.target.value)} className={`${inputCls} py-1 w-28`} data-testid={`sys-user-pwd-${u.id}`} placeholder="Yeni şifre" />
                      <button type="submit" className="px-2 py-1 bg-amber-500 text-slate-900 rounded-lg font-bold" data-testid={`sys-user-pwd-save-${u.id}`}>Kaydet</button>
                      <button type="button" onClick={() => { setPwdFor(null); setPwd(""); }} className="text-slate-400">İptal</button>
                    </form>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setPwdFor(u.id); setPwd(""); }} className="p-1.5 text-slate-500 hover:text-amber-600" title="Şifre sıfırla" data-testid={`sys-user-pwd-btn-${u.id}`}><KeyRound className="w-4 h-4" /></button>
                      <button type="button" onClick={() => del(u)} className="p-1.5 text-slate-500 hover:text-rose-600" title="Sil" data-testid={`sys-user-del-${u.id}`}><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
