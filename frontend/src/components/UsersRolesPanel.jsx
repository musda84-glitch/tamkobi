import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { UserPlus, Shield, Activity, Copy, Trash2, Mail, KeyRound, Plus, Loader2, Eye, UserCheck } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { groupMenuItems } from "../navGroups";

const LEVEL_LABEL = { none: "Yok", view: "Görüntüle", edit: "Düzenle" };
const LEVEL_CLS = { none: "bg-slate-100 text-slate-500", view: "bg-sky-100 text-sky-700", edit: "bg-emerald-100 text-emerald-700" };

const UsersTab = ({ companyId, roles, reload, data }) => {
  const { user: me } = useAuth();
  const [inv, setInv] = useState({ name: "", email: "", role: "sales" });
  const [manual, setManual] = useState({ name: "", email: "", password: "", role: "sales" });
  const [busy, setBusy] = useState(false);
  const [pwdFor, setPwdFor] = useState(null);
  const [pwd, setPwd] = useState("");
  const invite = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/users/invite`, { ...inv, company_id: companyId, base_url: window.location.origin, invited_by: me?.id });
      toast[r.data.mail.status === "sent" ? "success" : "info"](r.data.mail.detail);
      setInv({ name: "", email: "", role: "sales" }); reload();
    } catch (err) { toast.error(err.response?.data?.detail || "Davet gönderilemedi."); } finally { setBusy(false); }
  };
  const createManual = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/users`, { ...manual, company_id: companyId });
      toast.success(r.data.message || "Kullanıcı eklendi.");
      setManual({ name: "", email: "", password: "", role: "sales" }); reload();
    } catch (err) { toast.error(err.response?.data?.detail || "Kullanıcı eklenemedi."); } finally { setBusy(false); }
  };
  const patch = async (u, body, ok) => { try { await axios.put(`${API_URL}/users/${u.id}`, body); toast.success(ok); reload(); } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); } };
  const del = async (u) => { if (!window.confirm(`${u.name} silinsin mi?`)) return; try { await axios.delete(`${API_URL}/users/${u.id}`); toast.success("Kullanıcı silindi."); reload(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } };
  const copy = async (link) => { try { await navigator.clipboard.writeText(link); toast.success("Davet linki kopyalandı."); } catch { window.prompt("Davet linki (kopyalayın):", link); } };
  return (
    <div className="space-y-5">
      <form onSubmit={invite} className="bg-slate-50 border rounded-xl p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end text-xs" data-testid="user-invite-form">
        <div className="md:col-span-5 font-bold text-slate-800 flex items-center gap-1.5"><UserPlus className="w-4 h-4 text-emerald-600" /> Yeni kullanıcı davet et (e-posta ile link gönderilir)</div>
        <div><label className="block font-semibold mb-1">Ad Soyad</label><input value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} className="w-full border rounded-lg p-2 bg-white" data-testid="invite-name" /></div>
        <div className="md:col-span-2"><label className="block font-semibold mb-1">E-posta</label><input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} className="w-full border rounded-lg p-2 bg-white" data-testid="invite-email" /></div>
        <div><label className="block font-semibold mb-1">Rol</label><select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })} className="w-full border rounded-lg p-2 bg-white" data-testid="invite-role">{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></div>
        <button disabled={busy} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold flex items-center justify-center gap-1" data-testid="invite-submit">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Davet Gönder</button>
      </form>
      <form onSubmit={createManual} className="bg-white border border-slate-200 rounded-xl p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end text-xs" data-testid="user-manual-form">
        <div className="md:col-span-6 font-bold text-slate-800 flex items-center gap-1.5"><KeyRound className="w-4 h-4 text-slate-700" /> Manuel kullanıcı ekle (şifre siz belirlersiniz, hemen giriş yapabilir)</div>
        <div><label className="block font-semibold mb-1">Ad Soyad</label><input required value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="manual-user-name" /></div>
        <div className="md:col-span-2"><label className="block font-semibold mb-1">E-posta</label><input type="email" required value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="manual-user-email" /></div>
        <div><label className="block font-semibold mb-1">Şifre</label><input type="password" required minLength={6} value={manual.password} onChange={(e) => setManual({ ...manual, password: e.target.value })} placeholder="En az 6 karakter" className="w-full border rounded-lg p-2 bg-slate-50" data-testid="manual-user-password" /></div>
        <div><label className="block font-semibold mb-1">Rol</label><select value={manual.role} onChange={(e) => setManual({ ...manual, role: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="manual-user-role">{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></div>
        <button disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold flex items-center justify-center gap-1" data-testid="manual-user-submit">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Kullanıcıyı Ekle</button>
      </form>
      {data.invites.length > 0 && (
        <div className="space-y-1.5" data-testid="pending-invites">
          <div className="text-xs font-bold text-slate-700">Bekleyen davetler ({data.invites.length})</div>
          {data.invites.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid={`invite-row-${i.email}`}>
              <span className="font-semibold text-slate-800">{i.name || "-"}</span><span className="text-slate-500">{i.email}</span><span className="px-1.5 py-0.5 rounded bg-white border text-[10px]">{roles.find((r) => r.code === i.role)?.name || i.role}</span>
              <span className={`text-[10px] ${i.mail?.status === "sent" ? "text-emerald-700" : "text-amber-700"}`}>{i.mail?.status === "sent" ? "E-posta gönderildi" : "E-posta gönderilmedi — linki iletin"}</span>
              <button onClick={() => copy(i.link)} className="ml-auto p-1 rounded hover:bg-white" title="Linki kopyala" data-testid={`invite-copy-${i.email}`}><Copy className="w-3.5 h-3.5" /></button>
              <button onClick={async () => { await axios.delete(`${API_URL}/users/invite/${i.id}`); reload(); }} className="p-1 rounded hover:bg-white text-rose-600" title="İptal" data-testid={`invite-cancel-${i.email}`}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <table className="w-full text-xs" data-testid="users-table">
        <thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-2">Kullanıcı</th><th className="text-left">Rol</th><th className="text-left">Durum</th><th className="text-left">Son Giriş</th><th className="text-right">İşlem</th></tr></thead>
        <tbody className="divide-y">
          {data.users.map((u) => (
            <tr key={u.id} data-testid={`user-row-${u.email}`}>
              <td className="py-2"><div className="font-semibold text-slate-900">{u.name}</div><div className="text-slate-500">{u.email}</div></td>
              <td><select value={u.role} onChange={(e) => patch(u, { role: e.target.value }, "Rol güncellendi.")} className="border rounded-lg p-1.5 bg-white" data-testid={`user-role-${u.email}`}>{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></td>
              <td><button onClick={() => patch(u, { is_active: !u.is_active }, u.is_active ? "Kullanıcı pasife alındı." : "Kullanıcı aktif.")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`} data-testid={`user-active-${u.email}`}>{u.is_active ? "Aktif" : "Pasif"}</button></td>
              <td className="text-slate-500">{u.last_login_at ? new Date(u.last_login_at).toLocaleString("tr-TR") : "-"}</td>
              <td className="text-right whitespace-nowrap">
                {pwdFor === u.id ? (
                  <span className="inline-flex gap-1"><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Yeni şifre" className="border rounded-lg p-1 w-28" data-testid={`user-pwd-input-${u.email}`} /><button onClick={() => { patch(u, { password: pwd }, "Şifre değiştirildi."); setPwdFor(null); setPwd(""); }} className="px-2 bg-slate-900 text-white rounded-lg" data-testid={`user-pwd-save-${u.email}`}>Kaydet</button></span>
                ) : <button onClick={() => setPwdFor(u.id)} className="p-1.5 rounded hover:bg-slate-100" title="Şifre belirle" data-testid={`user-pwd-${u.email}`}><KeyRound className="w-3.5 h-3.5" /></button>}
                <button onClick={() => del(u)} className="p-1.5 rounded hover:bg-rose-50 text-rose-600" title="Sil" data-testid={`user-del-${u.email}`}><Trash2 className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const RolesTab = ({ companyId, rolesData, reload }) => {
  const [newRole, setNewRole] = useState("");
  const [template, setTemplate] = useState("");
  const [sel, setSel] = useState(rolesData.roles[1]?.id);
  const [rename, setRename] = useState(null);
  const role = rolesData.roles.find((r) => r.id === sel) || rolesData.roles[0];
  const savePerms = async (permissions, msg) => {
    try { await axios.put(`${API_URL}/roles/${role.id}`, { permissions }); if (msg) toast.success(msg); reload(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };
  const setLevel = (mod, level) => savePerms({ ...role.permissions, [mod]: level });
  const saveFeature = async (key, val) => { try { await axios.put(`${API_URL}/roles/${role.id}`, { features: { ...role.features, [key]: val } }); toast.success(val ? "Özellik açıldı." : "Özellik kapatıldı."); reload(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } };
  const setAll = (level) => savePerms(Object.fromEntries(rolesData.modules.map((m) => [m.key, level])), `Tüm modüller "${LEVEL_LABEL[level]}" yapıldı.`);
  const add = async (e) => {
    e.preventDefault();
    const tpl = rolesData.roles.find((r) => r.id === template);
    try { const r = await axios.post(`${API_URL}/roles`, { company_id: companyId, name: newRole, permissions: tpl?.permissions || {} }); toast.success(tpl ? `"${tpl.name}" şablonundan rol oluşturuldu.` : "Rol oluşturuldu."); setNewRole(""); setTemplate(""); await reload(); setSel(r.data.id); } catch (err) { toast.error(err.response?.data?.detail || "Oluşturulamadı."); }
  };
  const doRename = async (e) => {
    e.preventDefault();
    try { await axios.put(`${API_URL}/roles/${role.id}`, { name: rename }); toast.success("Rol adı güncellendi."); setRename(null); reload(); } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };
  const del = async () => { if (!window.confirm(`${role.name} rolü silinsin mi?`)) return; try { await axios.delete(`${API_URL}/roles/${role.id}`); toast.success("Rol silindi."); setSel(rolesData.roles[0].id); reload(); } catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } };
  const savePolicy = async (key, val) => {
    try {
      await axios.put(`${API_URL}/roles/policies`, { company_id: companyId, [key]: val });
      toast.success(val ? "Politika açıldı." : "Politika kapatıldı.");
      reload();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };
  return (
    <div className="space-y-4">
      <div className="bg-white border border-indigo-200 rounded-xl p-3 text-xs" data-testid="company-policies">
        <div className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5 text-indigo-600" /> Firma politikaları</div>
        <label className="flex items-start gap-2 bg-indigo-50/50 border border-indigo-100 rounded-lg px-2.5 py-2 cursor-pointer" data-testid="policy-row-cash-dual-approval">
          <input type="checkbox" checked={!!rolesData.policies?.cash_dual_approval} onChange={(e) => savePolicy("cash_dual_approval", e.target.checked)} className="mt-0.5 accent-indigo-600" data-testid="policy-cash-dual-approval" />
          <span>
            <span className="font-semibold text-slate-800">Entegre olmayan kasa/banka işlemlerinde diğer yöneticiden onay iste</span>
            <div className="text-[10px] text-slate-500 leading-tight">Açıkken kâr payı dağıtımı (hemen öde), ortak para koy/çek ve virman hemen uygulanmaz; başka bir Banka &amp; Kasa yetkilisinin onayı gerekir. Entegre hesaplar zaten manuel işleme kapalıdır.</div>
          </span>
        </label>
      </div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
      <div className="space-y-2">
        {rolesData.roles.map((r) => <button key={r.id} onClick={() => { setSel(r.id); setRename(null); }} className={`w-full text-left px-3 py-2 rounded-xl border flex justify-between ${r.id === role?.id ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50"}`} data-testid={`role-btn-${r.code}`}><span className="font-semibold">{r.name}{!r.is_system && <span className="ml-1 text-[9px] opacity-60">özel</span>}</span><span className="opacity-60">{r.user_count} kul.</span></button>)}
        <form onSubmit={add} className="space-y-1.5 pt-2 border-t" data-testid="new-role-form">
          <div className="font-semibold text-slate-700">Yeni rol oluştur</div>
          <input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="Rol adı (örn. Saha Satış, Depo Şefi)" className="w-full border rounded-lg p-2" required data-testid="new-role-input" />
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full border rounded-lg p-2 bg-white" data-testid="new-role-template"><option value="">Yetki şablonu: boş (hepsi Yok)</option>{rolesData.roles.map((r) => <option key={r.id} value={r.id}>Şablon: {r.name} yetkilerini kopyala</option>)}</select>
          <button className="w-full flex items-center justify-center gap-1 px-2 py-2 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="new-role-add"><Plus className="w-4 h-4" /> Rolü Oluştur</button>
        </form>
      </div>
      <div className="md:col-span-3 bg-white border rounded-xl p-3" data-testid="role-matrix">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          {rename !== null ? (
            <form onSubmit={doRename} className="flex items-center gap-1"><input value={rename} onChange={(e) => setRename(e.target.value)} className="border rounded-lg p-1.5 text-sm font-bold" autoFocus data-testid="role-rename-input" /><button className="px-2 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" data-testid="role-rename-save">Kaydet</button><button type="button" onClick={() => setRename(null)} className="px-2 py-1.5 border rounded-lg">İptal</button></form>
          ) : (
            <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5"><Shield className="w-4 h-4 text-indigo-600" /> {role?.name} — modül yetkileri {role?.is_system ? <span className="text-[10px] font-normal text-slate-400">(sistem rolü)</span> : <button onClick={() => setRename(role.name)} className="text-[10px] font-normal text-indigo-600 hover:underline" data-testid="role-rename-btn">adı değiştir</button>}</div>
          )}
          <div className="flex items-center gap-1.5">
            {role?.code !== "admin" && <>
              <span className="text-[10px] text-slate-400">Hızlı:</span>
              {rolesData.levels.map((l) => <button key={l} onClick={() => setAll(l)} className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${LEVEL_CLS[l]}`} data-testid={`perm-all-${l}`}>Tümü {LEVEL_LABEL[l]}</button>)}
            </>}
            {!role?.is_system && <button onClick={del} className="text-rose-600 flex items-center gap-1 ml-2" data-testid="role-delete"><Trash2 className="w-3.5 h-3.5" /> Rolü sil</button>}
          </div>
        </div>
        {role?.code === "admin" && <div className="text-[11px] text-slate-500 mb-2">Yönetici tüm modüllerde tam yetkilidir; değiştirilemez.</div>}
        {rolesData.features && (
          <div className="mb-3 border border-amber-200 bg-amber-50/40 rounded-xl p-2.5" data-testid="role-features">
            <div className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-amber-600" /> Özellik Yetkileri (fiyat görünürlüğü & üst bar hızlı işlemler)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">{rolesData.features.map((f) => (
              <label key={f.key} className="flex items-start gap-2 bg-white border rounded-lg px-2.5 py-1.5 cursor-pointer" title={f.help} data-testid={`feature-row-${f.key}`}>
                <input type="checkbox" disabled={role?.code === "admin"} checked={role?.features?.[f.key] !== false} onChange={(e) => saveFeature(f.key, e.target.checked)} className="mt-0.5 accent-emerald-600" data-testid={`feature-toggle-${f.key}`} />
                <span><span className="font-semibold text-slate-800">{f.label}</span>{f.help && <div className="text-[10px] text-slate-500 leading-tight">{f.help}</div>}</span>
              </label>))}</div>
          </div>)}
        <div className="space-y-3">
          {groupMenuItems((rolesData.modules || []).map((m) => ({ ...m, path: m.key }))).map((g) => (
            <div key={g.id} className="border border-slate-100 rounded-xl p-2.5">
              {g.label && <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5 px-0.5">{g.label}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {g.items.map((m) => (
                  <div key={m.key} className="flex items-center justify-between border rounded-lg px-2.5 py-1.5" data-testid={`perm-row-${m.key}`}>
                    <span className="font-semibold text-slate-700">{m.label}</span>
                    <div className="flex gap-0.5">{rolesData.levels.map((l) => <button key={l} disabled={role?.code === "admin"} onClick={() => setLevel(m.key, l)} className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${role?.permissions?.[m.key] === l ? LEVEL_CLS[l] + " ring-1 ring-current" : "text-slate-400 hover:bg-slate-100"}`} data-testid={`perm-${m.key}-${l}`}>{LEVEL_LABEL[l]}</button>)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
};

const LogTab = ({ companyId, users }) => {
  const [uid, setUid] = useState("");
  const [rows, setRows] = useState([]);
  useEffect(() => { axios.get(`${API_URL}/activity-logs?company_id=${companyId}${uid ? `&user_id=${uid}` : ""}&limit=150`).then((r) => setRows(r.data)).catch(() => {}); }, [companyId, uid]);
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-600" /><span className="font-bold">İşlem günlüğü</span><select value={uid} onChange={(e) => setUid(e.target.value)} className="ml-auto border rounded-lg p-1.5" data-testid="log-user-filter"><option value="">Tüm kullanıcılar</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div className="max-h-[420px] overflow-auto border rounded-xl" data-testid="activity-log">
        <table className="w-full"><tbody className="divide-y">
          {rows.length === 0 && <tr><td className="p-4 text-center text-slate-400">Kayıt yok.</td></tr>}
          {rows.map((r) => <tr key={r.id} className="hover:bg-slate-50"><td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString("tr-TR")}</td><td className="px-3 font-semibold">{r.user_name}</td><td className="px-3"><span className={`px-1.5 rounded text-[10px] font-bold ${r.method === "DELETE" ? "bg-rose-100 text-rose-700" : r.method === "POST" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>{r.method}</span></td><td className="px-3 font-mono text-slate-600">{r.path}</td><td className="px-3 text-slate-400">{r.module}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
};

export const UsersRolesPanel = ({ companyId }) => {
  const [tab, setTab] = useState("users");
  const [data, setData] = useState(null);
  const [rolesData, setRolesData] = useState(null);
  const reload = useCallback(async () => {
    const [u, r] = await Promise.all([axios.get(`${API_URL}/users?company_id=${companyId}`), axios.get(`${API_URL}/roles?company_id=${companyId}`)]);
    setData(u.data); setRolesData(r.data);
  }, [companyId]);
  useEffect(() => { reload().catch(() => toast.error("Kullanıcılar yüklenemedi.")); }, [reload]);
  if (!data || !rolesData) return <div className="text-xs text-slate-400">Yükleniyor…</div>;
  return (
    <div className="space-y-4" data-testid="users-roles-panel">
      <p className="text-[11px] text-slate-500 -mt-1" data-testid="ur-company-users-note">Bu listedeki kullanıcılar şirketinizin personelidir. TamKobi panel yöneticileri burada görünmez; onlar platform ekibidir.</p>
      <div className="flex gap-1 border-b">{[["users", "Kullanıcılar", data.users.length], ["roles", "Roller & Yetkiler", rolesData.roles.length], ["log", "İşlem Günlüğü"]].map(([k, l, n]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${tab === k ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500"}`} data-testid={`ur-tab-${k}`}>{l}{n !== undefined && <span className="ml-1 text-[10px] bg-slate-100 px-1.5 rounded-full">{n}</span>}</button>)}</div>
      {tab === "users" && <UsersTab companyId={companyId} roles={rolesData.roles} data={data} reload={reload} />}
      {tab === "roles" && <RolesTab companyId={companyId} rolesData={rolesData} reload={reload} />}
      {tab === "log" && <LogTab companyId={companyId} users={data.users} />}
    </div>
  );
};
