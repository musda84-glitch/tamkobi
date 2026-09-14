import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Search, ShieldAlert, Trash2, UserX } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const cred = { withCredentials: true };

export const UserDataErasePanel = () => {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [phrase, setPhrase] = useState("VERİLERİ SİL");
  const [hint, setHint] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (term) => {
    const needle = (term || "").trim();
    if (needle.length < 2) {
      setUsers([]);
      setHint("En az 2 karakter yazın.");
      return;
    }
    setSearching(true);
    try {
      const r = await axios.get(`${API_URL}/system/tenant-users`, { ...cred, params: { q: needle } });
      setUsers(r.data.users || []);
      setPhrase(r.data.confirm_phrase || "VERİLERİ SİL");
      setHint(r.data.hint || (r.data.users?.length ? "" : "Eşleşen kullanıcı yok."));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Arama yapılamadı.");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  const openErase = async (u) => {
    try {
      const r = await axios.get(`${API_URL}/system/users/${u.id}/erase-preview`, cred);
      setSelected(r.data);
      setPhrase(r.data.confirm_phrase || phrase);
      setConfirmEmail("");
      setConfirmPhrase("");
      setAdminPassword("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Önizleme alınamadı.");
    }
  };

  const erase = async (e) => {
    e.preventDefault();
    if (!selected?.can_erase) return;
    setBusy(true);
    try {
      const r = await axios.post(
        `${API_URL}/system/users/${selected.id}/erase`,
        { confirm_email: confirmEmail, confirm_phrase: confirmPhrase, admin_password: adminPassword },
        cred,
      );
      toast.success(r.data.message || "Kullanıcı verileri silindi.");
      setSelected(null);
      setConfirmEmail("");
      setConfirmPhrase("");
      setAdminPassword("");
      await search(q);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    } finally {
      setBusy(false);
    }
  };

  const counts = selected?.counts || {};
  const ready =
    selected?.can_erase &&
    confirmEmail.trim().toLowerCase() === (selected.email || "").toLowerCase() &&
    confirmPhrase.trim() === phrase &&
    adminPassword.length > 0;

  return (
    <div className="space-y-4 text-xs" data-testid="saas-user-erase">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-slate-700" data-testid="sys-erase-explainer">
        <div className="font-bold text-slate-900 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-rose-600" /> Kullanıcı veri silme
        </div>
        <p className="mt-1 text-[11px] leading-relaxed">
          Müşteri şirket kullanıcılarının hesabını ve kişisel izlerini (davet, giriş denemeleri, aktivite kayıtları) kalıcı olarak siler.
          Şirket faturaları / siparişleri silinmez. İşlem için yönetici şifreniz, hedef e-posta ve <b className="font-mono">{phrase}</b> onayı gerekir.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ad, e-posta veya kullanıcı no ara…"
            className={`${inputCls} pl-8 bg-white`}
            data-testid="sys-erase-search"
          />
        </div>
        {searching && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        <div className="text-[11px] text-slate-500">{users.length ? `${users.length} sonuç` : hint}</div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[720px]" data-testid="sys-erase-table">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Kullanıcı</th>
              <th className="px-3 py-2.5 text-left">Şirketler</th>
              <th className="px-3 py-2.5 text-left">Rol</th>
              <th className="px-3 py-2.5 text-left">Veri</th>
              <th className="px-3 py-2.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!q.trim() && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">Silinecek kullanıcıyı arayın.</td>
              </tr>
            )}
            {q.trim().length >= 2 && !searching && users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">Eşleşen kullanıcı yok.</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} data-testid={`sys-erase-row-${u.id}`}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900">{u.name || "—"}</div>
                  <div className="font-mono text-[11px] text-slate-500">{u.email}</div>
                  {u.user_number ? <div className="text-[10px] text-slate-400">{u.user_number}</div> : null}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {(u.companies || []).map((c) => c.name).join(", ") || "—"}
                </td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2 text-[11px] text-slate-500">
                  aktivite {u.counts?.activity_logs || 0} · davet {u.counts?.invites || 0}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => openErase(u)}
                    disabled={!u.can_erase}
                    title={(u.block_reasons || []).join(" · ") || "Verileri sil"}
                    className="px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 bg-rose-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid={`sys-erase-open-${u.id}`}
                  >
                    <UserX className="w-3.5 h-3.5" /> Sil
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <form
          onSubmit={erase}
          className="rounded-2xl border border-rose-300 bg-white p-4 space-y-3 shadow-sm"
          data-testid="sys-erase-confirm"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Kalıcı silme onayı</h3>
              <p className="text-[11px] text-slate-600 mt-0.5">
                <b>{selected.name}</b> · <span className="font-mono">{selected.email}</span>
                {(selected.companies || []).length ? ` · ${(selected.companies || []).map((c) => c.name).join(", ")}` : ""}
              </p>
            </div>
            <button type="button" className="ml-auto text-slate-400 hover:text-slate-700 text-[11px]" onClick={() => setSelected(null)}>
              Vazgeç
            </button>
          </div>

          {!selected.can_erase && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900 text-[11px]">
              {(selected.block_reasons || ["Bu kullanıcı silinemez."]).join(" ")}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-lg bg-slate-50 px-2 py-1.5">Aktivite: <b>{counts.activity_logs || 0}</b></div>
            <div className="rounded-lg bg-slate-50 px-2 py-1.5">Davet: <b>{counts.invites || 0}</b></div>
            <div className="rounded-lg bg-slate-50 px-2 py-1.5">Giriş denemesi: <b>{counts.login_attempts || 0}</b></div>
            <div className="rounded-lg bg-slate-50 px-2 py-1.5">Personel bağı: <b>{counts.employee_linked ? "var" : "yok"}</b></div>
            <div className="rounded-lg bg-slate-50 px-2 py-1.5">Destek talebi: <b>{counts.support_tickets || 0}</b></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Hedef e-posta</label>
              <input
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                className={inputCls}
                placeholder={selected.email}
                autoComplete="off"
                data-testid="sys-erase-confirm-email"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Onay cümlesi</label>
              <input
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                className={inputCls}
                placeholder={phrase}
                autoComplete="off"
                data-testid="sys-erase-confirm-phrase"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Yönetici şifreniz</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className={inputCls}
                autoComplete="current-password"
                data-testid="sys-erase-admin-password"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSelected(null)} className="px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-600">
              İptal
            </button>
            <button
              type="submit"
              disabled={!ready || busy}
              className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
              data-testid="sys-erase-submit"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Kalıcı olarak sil
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
