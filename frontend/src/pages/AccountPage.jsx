import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { Building2, CreditCard, KeyRound, Loader2, Plus, Settings, UserRound, Wallet } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { MyPlanPanel } from "../components/saas/MyPlanPanel";
import { EMBEDDED_SETTINGS_PARAM } from "../utils/settingsTabs";
import SettingsPage from "./SettingsPage";

const TABS = [
  ["profil", "Profilim", UserRound],
  ["sirketler", "Şirketlerim", Building2],
  ["kontor", "GİB Kontör", Wallet],
  ["paket", "Paketim", CreditCard],
  ["ayarlar", "Firma ayarları", Settings],
];

export default function AccountPage() {
  const { activeCompany, companies, switchCompany, reloadSession, refreshLicense, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "sirketler";
  const companyId = activeCompany?.id || activeCompany?._id;
  const setTab = (k) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", k);
      if (k !== "ayarlar") next.delete(EMBEDDED_SETTINGS_PARAM);
      return next;
    });
  };
  return (
    <div className="space-y-5" data-testid="account-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-600 font-semibold">Hesap</div>
        <h1 className="text-2xl font-bold text-slate-900">Hesabım</h1>
        <p className="text-sm text-slate-500">Yalnızca sizin şirketleriniz. Profilinizi yönetin, yeni yasal şirket açın, GİB kontörü satın alın ve firma ayarlarını buradan düzenleyin.</p>
      </div>
      <div className="flex gap-1 bg-white border border-slate-200 rounded-2xl p-1 w-fit flex-wrap">
        {TABS.map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 ${tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`} data-testid={`account-tab-${k}`}>
            <Icon className="w-3.5 h-3.5" /> {l}
          </button>
        ))}
      </div>
      {tab === "profil" && <ProfileTab user={user} />}
      {tab === "sirketler" && <CompaniesTab companyId={companyId} companies={companies} switchCompany={switchCompany} reloadSession={reloadSession} refreshLicense={refreshLicense} canAdd={!user?.role || user.role === "admin" || user?.is_super_admin} />}
      {tab === "kontor" && <GibCreditsPanel companyId={companyId} />}
      {tab === "paket" && companyId && <MyPlanPanel companyId={companyId} />}
      {tab === "ayarlar" && <SettingsPage embedded />}
    </div>
  );
}

const ROLE_LABELS = { admin: "Yönetici", accountant: "Mali Müşavir", sales: "Satış & B2B", warehouse: "Depo Sorumlusu" };

const ProfileTab = ({ user }) => {
  const [f, setF] = useState({ current_password: "", new_password: "", new_password2: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (f.new_password !== f.new_password2) { toast.error("Yeni şifreler eşleşmiyor."); return; }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/auth/change-password`, { current_password: f.current_password, new_password: f.new_password }, { withCredentials: true });
      setF({ current_password: "", new_password: "", new_password2: "" });
      toast.success("Şifreniz güncellendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Şifre değiştirilemedi.");
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 text-xs max-w-2xl" data-testid="account-profile">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-lg font-bold">{user?.name?.charAt(0) || "U"}</div>
        <div>
          <div className="font-bold text-slate-900 text-sm" data-testid="account-profile-name">{user?.name || "Kullanıcı"}</div>
          <div className="text-slate-500" data-testid="account-profile-email">{user?.email}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-slate-800 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded" data-testid="account-profile-user-number">
              ID: {user?.user_number || "—"}
            </span>
            <span className="text-[10px] text-emerald-700 font-semibold">{user?.role_name || ROLE_LABELS[user?.role] || user?.role || "Üye"}</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Destek ve bildirimlerde bu kullanıcı ID’sini kullanabilirsiniz.</p>
        </div>
      </div>
      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3" data-testid="account-change-password">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-500" /> Şifre değiştir</h3>
        <p className="text-[11px] text-slate-500">Hesabınızın şifresini buradan güncelleyin. Mevcut şifre doğrulanır; yeni şifre en az 6 karakter olmalıdır.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="block font-semibold text-slate-700 mb-1">Mevcut şifre</label><input type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="account-chg-current" autoComplete="current-password" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Yeni şifre</label><input type="password" required minLength={6} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="account-chg-new" autoComplete="new-password" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Yeni şifre (tekrar)</label><input type="password" required value={f.new_password2} onChange={(e) => setF({ ...f, new_password2: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="account-chg-new2" autoComplete="new-password" /></div>
        </div>
        <div className="flex justify-end"><button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="account-chg-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Şifreyi değiştir</button></div>
      </form>
    </div>
  );
};

const CompaniesTab = ({ companyId, companies, switchCompany, reloadSession, refreshLicense, canAdd }) => {
  const [form, setForm] = useState({ name: "", tax_number: "", city: "" });
  const [busy, setBusy] = useState(false);
  const mine = companies || [];
  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/license/companies`, { ...form, company_id: companyId });
      toast.success(`${r.data.name} eklendi — verileri diğer şirketlerden ayrıdır.`);
      setForm({ name: "", tax_number: "", city: "" });
      if (reloadSession) await reloadSession();
      if (refreshLicense) await refreshLicense(companyId);
      await switchCompany(r.data.id);
    } catch (err) { toast.error(err.response?.data?.detail || "Şirket açılamadı."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 text-xs" data-testid="account-companies">
      <ul className="bg-white border border-slate-200 rounded-2xl divide-y">
        {mine.length === 0 && <li className="px-4 py-6 text-slate-400">Bu hesapta şirket yok.</li>}
        {mine.map((c) => {
          const id = c.id || c._id;
          const on = id === companyId;
          return (
            <li key={id} className="px-4 py-3 flex items-center justify-between gap-3" data-testid={`account-co-${id}`}>
              <div>
                <div className="font-bold text-slate-900">{c.name}</div>
                <div className="text-[10px] text-slate-400">{c.tax_number || "VKN yok"} · {c.city || "—"}</div>
              </div>
              {on ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">Aktif</span> : <button type="button" onClick={() => switchCompany(id)} className="text-[11px] font-semibold text-emerald-700">Bu şirkete geç</button>}
            </li>
          );
        })}
      </ul>
      {canAdd && (
        <form onSubmit={create} className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end" data-testid="account-add-form">
          <div className="sm:col-span-2"><label className="block font-semibold text-slate-700 mb-1">Yeni yasal şirket</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" placeholder="Ünvan" data-testid="hesap-new-co-name" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">VKN</label><input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="hesap-new-co-tax" /></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Şehir</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full bg-slate-50 border rounded-lg p-2" placeholder="İl" data-testid="hesap-new-co-city" /></div>
          <button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60" data-testid="hesap-new-co-submit">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Şirket aç</button>
        </form>
      )}
    </div>
  );
};

export const GibCreditsPanel = ({ companyId }) => {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState("");
  const [providers, setProviders] = useState({ stripe: true, paytr: false });
  const [paytr, setPaytr] = useState(null);
  const load = useCallback(() => {
    if (!companyId) return;
    axios.get(`${API_URL}/account/gib-credits`, { params: { company_id: companyId } }).then((r) => setD(r.data)).catch(() => toast.error("Kontör bilgisi alınamadı."));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API_URL}/payments/providers`).then((r) => setProviders(r.data)).catch(() => {}); }, []);
  if (!d) return <div className="text-xs text-slate-400 p-6">Yükleniyor…</div>;
  const buy = async (pack, via) => {
    setBusy(pack.id + via);
    try {
      const body = { company_id: companyId, pack_id: pack.id, product_type: "gib_credits", origin_url: window.location.origin };
      if (via === "paytr") {
        const r = await axios.post(`${API_URL}/payments/paytr/session`, body);
        setPaytr(r.data);
      } else {
        const r = await axios.post(`${API_URL}/payments/checkout`, body);
        window.location.href = r.data.checkout_url;
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Ödeme başlatılamadı."); } finally { setBusy(""); }
  };
  return (
    <div className="space-y-4 text-xs" data-testid="gib-credits-panel">
      {paytr && <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4" onClick={() => setPaytr(null)}><div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-2xl p-3"><div className="flex justify-between px-2 pb-2"><b>PayTR — GİB Kontör</b><button type="button" onClick={() => setPaytr(null)}>Kapat</button></div><iframe title="PayTR" src={paytr.iframe_url} className="w-full h-[640px] rounded-xl" /></div></div>}
      <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-wrap items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-900 flex items-center justify-center"><Wallet className="w-6 h-6" /></div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold">GİB e-Fatura / e-Arşiv kontörü</div>
          <div className="text-3xl font-black mt-1" data-testid="gib-balance">{d.balance.toLocaleString("tr-TR")}</div>
          <p className="text-slate-300 mt-1">Her e-fatura veya e-arşiv gönderimi 1 kontör düşer. Kağıt fatura kontör kullanmaz. Kontör lisansınızdaki tüm şirketlerde ortaktır.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {(d.packs || []).map((p) => (
          <div key={p.id} className={`bg-white border rounded-2xl p-4 flex flex-col ${p.popular ? "border-amber-400 ring-2 ring-amber-400/20" : "border-slate-200"}`} data-testid={`gib-pack-${p.id}`}>
            {p.popular && <span className="text-[10px] font-bold text-amber-700 mb-1">En çok alınan</span>}
            <div className="font-bold text-slate-900">{p.name}</div>
            <div className="text-[11px] text-slate-500">{p.tagline}</div>
            <div className="text-2xl font-black text-slate-900 mt-2">{Number(p.price).toLocaleString("tr-TR")} ₺</div>
            <div className="text-[11px] text-slate-500">{p.credits.toLocaleString("tr-TR")} kontör</div>
            <button type="button" disabled={!!busy} onClick={() => buy(p, "stripe")} className="mt-4 w-full py-2 rounded-xl font-bold bg-slate-900 text-white disabled:opacity-60 inline-flex items-center justify-center gap-1.5" data-testid={`gib-buy-${p.id}`}>{busy === p.id + "stripe" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} Satın al</button>
            {providers.paytr && <button type="button" disabled={!!busy} onClick={() => buy(p, "paytr")} className="mt-1.5 w-full py-2 rounded-xl font-bold bg-sky-600 text-white disabled:opacity-60" data-testid={`gib-buy-paytr-${p.id}`}>PayTR ile öde</button>}
          </div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b font-bold text-slate-900">Hareketler</div>
        <ul className="divide-y text-[11px]">{(d.ledger || []).length === 0 ? <li className="px-4 py-6 text-slate-400">Henüz hareket yok.</li> : d.ledger.map((row) => (
          <li key={row.id} className="px-4 py-2 flex justify-between gap-2" data-testid={`gib-led-${row.id}`}>
            <span className="text-slate-600">{row.note || row.type}{row.invoice_id ? ` · ${row.invoice_id}` : ""}</span>
            <span className={`font-bold ${row.credits > 0 ? "text-emerald-700" : "text-rose-700"}`}>{row.credits > 0 ? "+" : ""}{row.credits}</span>
          </li>
        ))}</ul>
      </div>
    </div>
  );
};
