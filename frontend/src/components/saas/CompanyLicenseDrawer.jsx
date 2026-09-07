import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Save, Loader2, CalendarPlus, Users, Check, Lock, Building2, Plus, Trash2, Power } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { fmtDate, StatusBadge, PlanChip, Toggle, inputCls, groupByCategory, STATUS_LABELS } from "./saasUi";

const cred = { withCredentials: true };

const dateInputValue = (iso) => {
  const m = String(iso || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};

const toIsoEndOfDay = (dateStr) => {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59)).toISOString();
};

export const CompanyLicenseDrawer = ({ companyId, plans, catalog, onClose, onChanged }) => {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState("");
  const [newCo, setNewCo] = useState({ name: "", tax_number: "", city: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const load = useCallback(() => axios.get(`${API_URL}/system/companies/${companyId}`, cred).then((r) => { setD(r.data); const l = r.data.license; setF({ plan_id: l.plan_id || "", status: l.status, trial_ends_at: dateInputValue(l.trial_ends_at), expires_at: dateInputValue(l.expires_at), user_limit: l.user_limit ?? "", company_limit: l.company_limit ?? "", notes: l.notes || "", billing_period: l.billing_period || "monthly" }); }).catch(() => toast.error("Şirket bilgisi alınamadı.")), [companyId]);
  useEffect(() => { load(); }, [load]);
  if (!d || !f) return <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center text-white text-xs">Yükleniyor…</div>;
  const lic = d.license;
  const plan = plans.find((p) => p.id === (f.plan_id || lic.plan_id));
  const groups = groupByCategory(catalog);
  const isLive = lic.status === "active" || lic.status === "trial";
  const applyLicense = (licRes) => {
    setD((prev) => ({ ...prev, license: licRes }));
    setF((prev) => ({ ...prev, status: licRes.status }));
  };
  const save = async () => {
    setBusy("save");
    try { await axios.put(`${API_URL}/system/companies/${companyId}/license`, { ...f, trial_ends_at: toIsoEndOfDay(f.trial_ends_at), expires_at: toIsoEndOfDay(f.expires_at), user_limit: f.user_limit === "" ? null : Number(f.user_limit), company_limit: f.company_limit === "" ? null : Number(f.company_limit) }, cred); toast.success("Lisans güncellendi."); await load(); onChanged(); } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); }
  };
  const extend = async (days) => { setBusy("ext"); try { await axios.put(`${API_URL}/system/companies/${companyId}/license`, { extend_days: days }, cred); toast.success(`${days} gün uzatıldı.`); await load(); onChanged(); } catch (e) { toast.error(e.response?.data?.detail || "Uzatılamadı."); } finally { setBusy(""); } };
  const toggle = async (key, enabled) => { setBusy(key); try { const r = await axios.post(`${API_URL}/system/companies/${companyId}/modules${key}`, { enabled }, cred); setD({ ...d, license: r.data }); onChanged(); } catch (e) { toast.error(e.response?.data?.detail || "Modül değiştirilemedi."); } finally { setBusy(""); } };
  const siblings = d.license_companies || [];
  const limit = Number(lic.company_limit || 0);
  const canAddSibling = !limit || siblings.length < limit;
  const addSibling = async () => {
    if (!newCo.name.trim()) return;
    setBusy("co");
    try {
      await axios.post(`${API_URL}/system/companies/${companyId}/companies`, newCo, cred);
      toast.success("Lisans altına yeni şirket eklendi. Verileri diğer şirketlerden ayrıdır.");
      setNewCo({ name: "", tax_number: "", city: "" });
      await load();
      onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || "Şirket eklenemedi."); } finally { setBusy(""); }
  };
  const setActive = async (active) => {
    setBusy(active ? "on" : "off");
    try {
      const r = await axios.post(`${API_URL}/system/companies/${companyId}/activation`, { active }, cred);
      applyLicense(r.data);
      toast.success(active ? "Şirket aktif." : "Şirket pasife alındı — modüller kilitli.");
      onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || "Durum değiştirilemedi."); } finally { setBusy(""); }
  };
  const remove = async () => {
    if (deleteName.trim() !== (d.name || "").trim()) {
      toast.error("Onay için şirket adını birebir yazın.");
      return;
    }
    setBusy("del");
    try {
      await axios.delete(`${API_URL}/system/companies/${companyId}`, cred);
      toast.success(`${d.name} silindi.`);
      onChanged();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Şirket silinemedi."); } finally { setBusy(""); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl bg-slate-50 text-slate-900 h-full overflow-y-auto shadow-2xl text-xs" data-testid="company-license-drawer">
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between z-10 gap-3">
          <div className="min-w-0"><div className="text-sm font-bold text-slate-900">{d.name}</div><div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5"><PlanChip name={lic.plan_name} color={lic.plan_color} /><StatusBadge status={lic.status} testId="drawer-status" /> · {d.admin?.email || "yönetici yok"} · {d.usage.users} kullanıcı · {d.usage.invoices} fatura · {d.usage.contacts} cari · {d.usage.products} ürün</div></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={() => setActive(true)} disabled={!!busy || isLive} className={`px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 ${isLive ? "bg-emerald-600 text-white" : "border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"} disabled:opacity-60`} data-testid="company-activate-btn"><Power className="w-3.5 h-3.5" /> Aktif</button>
            <button type="button" onClick={() => setActive(false)} disabled={!!busy || lic.status === "suspended"} className={`px-2.5 py-1.5 rounded-lg font-bold ${lic.status === "suspended" ? "bg-amber-500 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"} disabled:opacity-60`} data-testid="company-deactivate-btn">Pasif</button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg" data-testid="drawer-close"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Şirket işlemleri</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Pasif (askıda) şirkette tüm modüller kilitlenir. Silme geri alınamaz.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setActive(true)} disabled={!!busy || isLive} className={`px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 ${isLive ? "bg-emerald-600 text-white" : "border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"} disabled:opacity-60`} data-testid="company-activate-btn-body"><Power className="w-3.5 h-3.5" /> Aktif</button>
                <button type="button" onClick={() => setActive(false)} disabled={!!busy || lic.status === "suspended"} className={`px-3 py-1.5 rounded-lg font-bold ${lic.status === "suspended" ? "bg-amber-500 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"} disabled:opacity-60`} data-testid="company-deactivate-btn-body">Pasif</button>
                {d.protected ? (
                  <span className="text-[10px] text-slate-400 font-semibold" data-testid="company-delete-protected">Demo şirket silinemez</span>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)} disabled={!!busy} className="px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-60" data-testid="company-delete-btn"><Trash2 className="w-3.5 h-3.5" /> Şirketi Sil</button>
                )}
              </div>
            </div>
            {confirmDelete && !d.protected && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2" data-testid="company-delete-confirm">
                <div className="font-bold text-rose-800">Bu işlem geri alınamaz</div>
                <p className="text-[11px] text-rose-700">Faturalar, stok, cari, kullanıcılar ve lisans kalıcı olarak silinir. Onaylamak için şirket adını yazın: <b>{d.name}</b></p>
                <input value={deleteName} onChange={(e) => setDeleteName(e.target.value)} className={inputCls} placeholder="Şirket adı" data-testid="company-delete-confirm-name" />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setConfirmDelete(false); setDeleteName(""); }} className="px-3 py-1.5 border rounded-lg font-semibold" data-testid="company-delete-cancel">Vazgeç</button>
                  <button type="button" onClick={remove} disabled={busy === "del"} className="px-3 py-1.5 bg-rose-600 text-white rounded-lg font-bold inline-flex items-center gap-1 disabled:opacity-60" data-testid="company-delete-confirm-btn">{busy === "del" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Kalıcı olarak sil</button>
                </div>
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <h3 className="font-bold text-slate-900 text-sm">Lisans</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className="block font-semibold text-slate-700 mb-1">Paket</label><select value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })} className={inputCls} data-testid="lic-plan">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.modules.length} modül)</option>)}</select></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Durum</label><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={inputCls} data-testid="lic-status">{Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Faturalama</label><select value={f.billing_period} onChange={(e) => setF({ ...f, billing_period: e.target.value })} className={inputCls} data-testid="lic-billing"><option value="monthly">Aylık</option><option value="yearly">Yıllık</option></select></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Deneme Bitiş</label><input type="date" value={f.trial_ends_at} onChange={(e) => setF({ ...f, trial_ends_at: e.target.value })} className={inputCls} data-testid="lic-trial-end" /></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Lisans Bitiş (boş = süresiz)</label><input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} className={inputCls} data-testid="lic-expires" /></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Kullanıcı Limiti (boş = paket: {plan?.user_limit || "∞"})</label><input type="number" min={0} value={f.user_limit} onChange={(e) => setF({ ...f, user_limit: e.target.value })} className={inputCls} data-testid="lic-user-limit" /></div>
              <div><label className="block font-semibold text-slate-700 mb-1">Şirket Limiti (boş = paket: {plan?.company_limit || "∞"})</label><input type="number" min={0} value={f.company_limit} onChange={(e) => setF({ ...f, company_limit: e.target.value })} className={inputCls} data-testid="lic-company-limit" /></div>
              <div className="sm:col-span-3"><label className="block font-semibold text-slate-700 mb-1">Not</label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} data-testid="lic-notes" /></div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-slate-500 flex items-center gap-1"><CalendarPlus className="w-3.5 h-3.5" /> Hızlı uzat:</span>
              {[7, 30, 365].map((n) => <button key={n} type="button" onClick={() => extend(n)} disabled={!!busy} className="px-2.5 py-1.5 border border-slate-300 rounded-lg font-semibold text-slate-800 bg-white hover:bg-slate-100 disabled:opacity-50" data-testid={`lic-extend-${n}`}>+{n} gün</button>)}
              <button onClick={save} disabled={busy === "save"} className="ml-auto px-5 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="lic-save">{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button>
            </div>
            {lic.days_left !== null && lic.days_left !== undefined && <div className={`rounded-lg px-3 py-2 ${lic.days_left <= 7 ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>Bitiş: {fmtDate(lic.trial_ends_at || lic.expires_at)} · <b>{lic.days_left} gün</b> kaldı</div>}
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-slate-900 text-sm">Modüller <span className="text-slate-400 font-normal">({lic.enabled_count}/{lic.total_count} aktif)</span></h3>{lic.locked && <span className="text-rose-600 font-semibold flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Lisans {lic.status_label.toLowerCase()} — tüm modüller kilitli</span>}</div>
            <p className="text-[10px] text-slate-500 mb-3">Paketin dışında modül açmak veya paketteki bir modülü kapatmak için anahtarı değiştirin. Paket varsayılanından farklı olanlar “özel” olarak işaretlenir.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(groups).map(([cat, mods]) => (
                <div key={cat} className="border border-slate-100 rounded-xl p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{cat}</div>
                  <ul className="space-y-2">{mods.map((m) => { const on = !!lic.modules[m.key]; const inPlan = plan?.modules?.includes(m.key); const custom = lic.module_overrides?.[m.key] !== undefined; return (
                    <li key={m.key} className="flex items-center justify-between gap-2" data-testid={`mod-row-${m.key.replace("/", "")}`}>
                      <div className="min-w-0"><div className={`font-semibold ${on ? "text-slate-800" : "text-slate-400"} flex items-center gap-1.5`}>{m.label}{custom && <span className="text-[9px] bg-amber-100 text-amber-800 px-1 rounded">özel</span>}{inPlan && !custom && <Check className="w-3 h-3 text-emerald-500" />}</div><div className="text-[10px] text-slate-400 truncate">{m.description}</div></div>
                      <Toggle on={on} disabled={lic.locked || busy === m.key} onChange={(v) => toggle(m.key, v)} testId={`mod-toggle-${m.key.replace("/", "")}`} />
                    </li>); })}</ul>
                </div>))}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl p-4" data-testid="drawer-license-companies">
            <h3 className="font-bold text-slate-900 text-sm mb-1 flex items-center gap-1.5"><Building2 className="w-4 h-4 text-slate-400" /> Lisans şirketleri ({siblings.length}{limit ? `/${limit}` : ""})</h3>
            <p className="text-[10px] text-slate-500 mb-3">Aynı pakette birden fazla tüzel kişi. Her şirketin carisi, faturası ve stoğu ayrıdır; müşteri hesapları birbirini görmez.</p>
            <ul className="divide-y mb-3">{siblings.map((c) => (
              <li key={c.id} className="py-1.5 flex items-center justify-between gap-2" data-testid={`drawer-co-${c.id}`}>
                <span className="font-semibold text-slate-800 truncate">{c.name}</span>
                {c.primary || c.id === companyId ? <span className="text-[10px] font-black text-amber-700">ANA</span> : <span className="text-[10px] text-slate-400">Şube</span>}
              </li>
            ))}</ul>
            {canAddSibling ? (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <input className={inputCls + " sm:col-span-2"} placeholder="Yeni şirket unvanı" value={newCo.name} onChange={(e) => setNewCo({ ...newCo, name: e.target.value })} data-testid="drawer-new-co-name" />
                <input className={inputCls} placeholder="VKN" value={newCo.tax_number} onChange={(e) => setNewCo({ ...newCo, tax_number: e.target.value })} data-testid="drawer-new-co-tax" />
                <button type="button" disabled={!!busy || !newCo.name.trim()} onClick={addSibling} className="px-3 py-2 bg-amber-400 text-slate-900 rounded-xl font-bold flex items-center justify-center gap-1 disabled:opacity-40" data-testid="drawer-new-co-submit">{busy === "co" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Şirket ekle</button>
              </div>
            ) : <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Paket şirket limiti doldu. Limit alanını yükseltin veya üst pakete geçin.</p>}
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="font-bold text-slate-900 text-sm mb-2 flex items-center gap-1.5"><Users className="w-4 h-4 text-slate-400" /> Şirket kullanıcıları ({d.users.length}{lic.user_limit ? `/${lic.user_limit}` : ""})</h3>
            <p className="text-[10px] text-slate-500 mb-2">Bu listedekiler müşteri şirketinin personelidir. Platform (panel) yöneticileri burada görünmez.</p>
            <ul className="divide-y">{d.users.length === 0 ? <li className="py-2 text-slate-400">Şirket kullanıcısı yok.</li> : d.users.map((u) => <li key={u.id} className="py-1.5 flex items-center justify-between"><div><b className="text-slate-800">{u.name}</b> <span className="text-slate-500">{u.email}</span></div><div className="text-[10px] text-slate-500">{u.role} · {u.is_active ? "aktif" : "pasif"} · son giriş {fmtDate(u.last_login_at)}</div></li>)}</ul>
            {d.requests.length > 0 && (<><h3 className="font-bold text-slate-900 text-sm mt-4 mb-2">Paket Talepleri</h3><ul className="divide-y">{d.requests.map((r) => <li key={r.id} className="py-1.5 flex items-center justify-between"><span>{r.plan_name} · {r.message}</span><span className={`text-[10px] font-semibold ${r.status === "pending" ? "text-amber-700" : r.status === "approved" ? "text-emerald-700" : "text-slate-400"}`}>{r.status} · {fmtDate(r.created_at)}</span></li>)}</ul></>)}
          </section>
        </div>
      </div>
    </div>
  );
};
