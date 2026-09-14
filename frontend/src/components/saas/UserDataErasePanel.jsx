import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  Database,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  UserX,
} from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const cred = { withCredentials: true };

const UserEraseSection = () => {
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
    <div className="space-y-4" data-testid="saas-user-erase">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-slate-700" data-testid="sys-erase-explainer">
        <div className="font-bold text-slate-900 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-rose-600" /> Kullanıcı hesabı silme
        </div>
        <p className="mt-1 text-[11px] leading-relaxed">
          Müşteri şirket kullanıcılarının hesabını ve kişisel izlerini (davet, giriş denemeleri, aktivite) kalıcı siler.
          Faturalar, siparişler, stok ve teklifler silinmez — bunlar için <b>Şirket veritabanı</b> sekmesini kullanın.
          Onay: yönetici şifresi, hedef e-posta ve <b className="font-mono">{phrase}</b>.
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
        <form onSubmit={erase} className="rounded-2xl border border-rose-300 bg-white p-4 space-y-3 shadow-sm" data-testid="sys-erase-confirm">
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
              <input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className={inputCls} placeholder={selected.email} autoComplete="off" data-testid="sys-erase-confirm-email" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Onay cümlesi</label>
              <input value={confirmPhrase} onChange={(e) => setConfirmPhrase(e.target.value)} className={inputCls} placeholder={phrase} autoComplete="off" data-testid="sys-erase-confirm-phrase" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Yönetici şifreniz</label>
              <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className={inputCls} autoComplete="current-password" data-testid="sys-erase-admin-password" />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSelected(null)} className="px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-600">İptal</button>
            <button type="submit" disabled={!ready || busy} className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50" data-testid="sys-erase-submit">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Kalıcı olarak sil
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

const CompanyResetSection = () => {
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const phrase = selected?.confirm_phrase || "VERİLERİ SIFIRLA";

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/system/companies`, cred);
      const rows = Array.isArray(r.data) ? r.data : r.data.companies || [];
      setCompanies(rows);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Şirketler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const filtered = companies.filter((c) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      (c.name || "").toLowerCase().includes(needle) ||
      (c.id || "").toLowerCase().includes(needle) ||
      (c.email || "").toLowerCase().includes(needle) ||
      (c.tax_number || "").toLowerCase().includes(needle)
    );
  });

  const openPreview = async (c) => {
    try {
      const r = await axios.get(`${API_URL}/system/companies/${c.id}/reset-preview`, cred);
      setSelected(r.data);
      setConfirmName("");
      setConfirmPhrase("");
      setAdminPassword("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Önizleme alınamadı.");
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const r = await axios.post(
        `${API_URL}/system/companies/${selected.id}/reset-data`,
        { confirm_name: confirmName, confirm_phrase: confirmPhrase, admin_password: adminPassword },
        cred,
      );
      toast.success(r.data.message || "Şirket verileri sıfırlandı.");
      setSelected(null);
      await loadCompanies();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Sıfırlanamadı.");
    } finally {
      setBusy(false);
    }
  };

  const ready =
    selected &&
    confirmName.trim() === (selected.name || "").trim() &&
    confirmPhrase.trim() === phrase &&
    adminPassword.length > 0;

  const usage = (c) => c.usage || {};

  return (
    <div className="space-y-4" data-testid="saas-company-reset">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-slate-700" data-testid="sys-reset-explainer">
        <div className="font-bold text-slate-900 flex items-center gap-1.5">
          <Database className="w-4 h-4 text-amber-700" /> Şirket veritabanı sıfırlama
        </div>
        <p className="mt-1 text-[11px] leading-relaxed">
          Seçilen şirketin faturalarını, siparişlerini, stoklarını, tekliflerini, carilerini ve diğer iş kayıtlarını siler.
          Şirket kaydı, lisans ve kullanıcı hesapları korunur. Onay: şirket adı, <b className="font-mono">{phrase}</b> ve yönetici şifresi.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Şirket adı, vergi no veya e-posta…"
            className={`${inputCls} pl-8 bg-white`}
            data-testid="sys-reset-search"
          />
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        <div className="text-[11px] text-slate-500">{filtered.length} şirket</div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[760px]" data-testid="sys-reset-table">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Şirket</th>
              <th className="px-3 py-2.5 text-left">Kullanım</th>
              <th className="px-3 py-2.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-slate-400">Şirket bulunamadı.</td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} data-testid={`sys-reset-row-${c.id}`}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    {c.name}
                    {c.protected ? <span className="text-[10px] text-slate-400 font-semibold">demo</span> : null}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">{c.id}</div>
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-500">
                  fatura {usage(c).invoices || 0} · sipariş {usage(c).orders || 0} · ürün {usage(c).products || 0} · cari {usage(c).contacts || 0}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => openPreview(c)}
                    className="px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 bg-amber-600 text-white"
                    data-testid={`sys-reset-open-${c.id}`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Sıfırla
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <form onSubmit={reset} className="rounded-2xl border border-amber-300 bg-white p-4 space-y-3 shadow-sm" data-testid="sys-reset-confirm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Veritabanı sıfırlama onayı</h3>
              <p className="text-[11px] text-slate-600 mt-0.5">
                <b>{selected.name}</b> · <span className="font-mono">{selected.id}</span>
                {" · "}toplam <b>{selected.total_docs || 0}</b> kayıt silinecek
              </p>
            </div>
            <button type="button" className="ml-auto text-slate-400 hover:text-slate-700 text-[11px]" onClick={() => setSelected(null)}>
              Vazgeç
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            {(selected.highlight || [])
              .filter((h) => h.count > 0)
              .slice(0, 12)
              .map((h) => (
                <div key={h.key} className="rounded-lg bg-slate-50 px-2 py-1.5" data-testid={`sys-reset-count-${h.key}`}>
                  {h.label}: <b>{h.count}</b>
                </div>
              ))}
            {!(selected.highlight || []).some((h) => h.count > 0) && (
              <div className="col-span-2 text-slate-500">Silinecek iş kaydı görünmüyor (zaten boş olabilir).</div>
            )}
          </div>

          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-900">
            Korunacak: kullanıcılar <b>{selected.kept?.users ?? "—"}</b>
            {" · "}roller <b>{selected.kept?.roles ?? "—"}</b>
            {" · "}şirket + lisans
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Şirket adı</label>
              <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} className={inputCls} placeholder={selected.name} autoComplete="off" data-testid="sys-reset-confirm-name" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Onay cümlesi</label>
              <input value={confirmPhrase} onChange={(e) => setConfirmPhrase(e.target.value)} className={inputCls} placeholder={phrase} autoComplete="off" data-testid="sys-reset-confirm-phrase" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Yönetici şifreniz</label>
              <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className={inputCls} autoComplete="current-password" data-testid="sys-reset-admin-password" />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSelected(null)} className="px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-600">İptal</button>
            <button type="submit" disabled={!ready || busy} className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50" data-testid="sys-reset-submit">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Veritabanını sıfırla
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export const UserDataErasePanel = () => {
  const [tab, setTab] = useState("company");

  return (
    <div className="space-y-4 text-xs" data-testid="saas-data-erase">
      <div className="flex flex-wrap gap-2" data-testid="sys-erase-tabs">
        <button
          type="button"
          onClick={() => setTab("company")}
          className={`px-3 py-1.5 rounded-xl font-bold inline-flex items-center gap-1.5 ${tab === "company" ? "bg-amber-600 text-white" : "bg-white border border-slate-200 text-slate-700"}`}
          data-testid="sys-erase-tab-company"
        >
          <Database className="w-3.5 h-3.5" /> Şirket veritabanı
        </button>
        <button
          type="button"
          onClick={() => setTab("user")}
          className={`px-3 py-1.5 rounded-xl font-bold inline-flex items-center gap-1.5 ${tab === "user" ? "bg-rose-600 text-white" : "bg-white border border-slate-200 text-slate-700"}`}
          data-testid="sys-erase-tab-user"
        >
          <UserX className="w-3.5 h-3.5" /> Kullanıcı hesabı
        </button>
      </div>
      {tab === "company" ? <CompanyResetSection /> : <UserEraseSection />}
    </div>
  );
};
