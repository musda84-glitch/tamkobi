import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Search, Settings2, Users, FileText, Loader2, X, LogIn, ShieldOff } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { fmtDate, StatusBadge, PlanChip, inputCls } from "./saasUi";

export const CompaniesTable = ({ rows, plans, onOpen, onCreated }) => {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [showNew, setShowNew] = useState(false);
  const impersonate = async (r) => {
    if (!window.confirm(`${r.name} şirketine yönetici olarak girilecek (destek modu, 2 saat). Panel oturumunuz geçici olarak bu şirkete geçer; ERP'deki "Destek modunu bitir" ile geri dönersiniz. Devam?`)) return;
    try { const res = await axios.post(`${API_URL}/system/companies/${r.id}/impersonate`, {}); toast.success(res.data.message); window.location.href = "/"; } catch (e) { toast.error(e.response?.data?.detail || "Giriş yapılamadı."); }
  };
  const list = rows.filter((r) => (!status || r.license.status === status) && (!q || `${r.name} ${r.admin?.email || ""} ${r.tax_number || ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-3 text-xs" data-testid="saas-companies">
      <p className="text-slate-500">Müşteri hesapları birbirinin verisini görmez. Aynı lisans altında paket limiti kadar yasal şirket açılabilir; her şirketin carisi ve faturası ayrıdır.</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Şirket, yönetici e-postası, VKN ara…" className={`${inputCls} pl-8`} data-testid="companies-search" /></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2" data-testid="companies-status-filter"><option value="">Tüm durumlar</option><option value="active">Aktif</option><option value="trial">Deneme</option><option value="suspended">Askıda</option><option value="expired">Süresi doldu</option><option value="cancelled">İptal</option></select>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl font-bold flex items-center gap-1.5" data-testid="new-company-btn"><Plus className="w-4 h-4" /> Yeni Müşteri Şirket</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2.5 text-left">Şirket</th><th className="px-3 py-2.5 text-left">Yönetici</th><th className="px-3 py-2.5 text-left">Paket</th><th className="px-3 py-2.5 text-left">Durum</th><th className="px-3 py-2.5 text-center">Modül</th><th className="px-3 py-2.5 text-center">Kullanıcı</th><th className="px-3 py-2.5 text-center">Fatura</th><th className="px-3 py-2.5 text-left">Bitiş</th><th className="px-3 py-2.5 text-left">Son İşlem</th><th className="px-3 py-2.5" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Şirket bulunamadı.</td></tr>}
            {list.map((r) => (
              <tr key={r.id} className="hover:bg-amber-50/40" data-testid={`company-row-${r.id}`}>
                <td className="px-3 py-2.5"><b className="text-slate-900">{r.name}</b><div className="text-[10px] text-slate-400">{r.tax_number || "VKN yok"} · {r.city || "-"} · {fmtDate(r.created_at)}{(r.license_companies || []).length > 1 ? ` · lisans: ${(r.license_companies || []).length} şirket` : ""}</div></td>
                <td className="px-3 py-2.5 text-slate-600">{r.admin ? <>{r.admin.name}<div className="text-[10px] text-slate-400">{r.admin.email}</div></> : "—"}</td>
                <td className="px-3 py-2.5"><PlanChip name={r.license.plan_name} color={r.license.plan_color} testId={`company-plan-${r.id}`} /></td>
                <td className="px-3 py-2.5"><StatusBadge status={r.license.status} testId={`company-status-${r.id}`} /></td>
                <td className="px-3 py-2.5 text-center font-semibold" data-testid={`company-modules-${r.id}`}>{r.license.enabled_count}/{r.license.total_count}</td>
                <td className="px-3 py-2.5 text-center"><span className="inline-flex items-center gap-1"><Users className="w-3 h-3 text-slate-400" />{r.usage.users}{r.license.user_limit ? `/${r.license.user_limit}` : ""}</span></td>
                <td className="px-3 py-2.5 text-center"><span className="inline-flex items-center gap-1"><FileText className="w-3 h-3 text-slate-400" />{r.usage.invoices}</span></td>
                <td className="px-3 py-2.5 text-slate-600">{r.license.days_left !== null && r.license.days_left !== undefined ? <span className={r.license.days_left <= 7 ? "text-amber-700 font-bold" : ""}>{fmtDate(r.license.trial_ends_at || r.license.expires_at)} ({r.license.days_left} gün)</span> : "Süresiz"}</td>
                <td className="px-3 py-2.5 text-slate-500">{r.usage.last_activity ? fmtDate(r.usage.last_activity) : "—"}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {r.allow_platform_access === false ? (
                    <span className="px-3 py-1.5 border border-slate-200 text-slate-500 bg-slate-50 rounded-lg font-semibold inline-flex items-center gap-1 mr-1.5" title="Şirket gizlilik ayarından yönetim paneli erişimini kapatmış" data-testid={`company-impersonate-blocked-${r.id}`}><ShieldOff className="w-3.5 h-3.5" /> Gizlilik kapalı</span>
                  ) : (
                    <button onClick={() => impersonate(r)} className="px-3 py-1.5 border border-amber-300 text-amber-800 bg-amber-50 rounded-lg font-semibold inline-flex items-center gap-1 hover:bg-amber-100 mr-1.5" title="Bu şirkete yönetici olarak gir (destek modu)" data-testid={`company-impersonate-${r.id}`}><LogIn className="w-3.5 h-3.5" /> Şirket Olarak Gir</button>
                  )}
                  <button onClick={() => onOpen(r.id)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold inline-flex items-center gap-1 hover:bg-slate-800" data-testid={`company-manage-${r.id}`}><Settings2 className="w-3.5 h-3.5" /> Yönet</button>
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">{r.license?.addons?.["support.impersonate"] !== false && <button onClick={() => impersonate(r)} className="px-3 py-1.5 border border-amber-300 text-amber-800 bg-amber-50 rounded-lg font-semibold inline-flex items-center gap-1 hover:bg-amber-100 mr-1.5" title="Bu şirkete yönetici olarak gir (destek modu)" data-testid={`company-impersonate-${r.id}`}><LogIn className="w-3.5 h-3.5" /> Şirket Olarak Gir</button>}<button onClick={() => onOpen(r.id)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold inline-flex items-center gap-1 hover:bg-slate-800" data-testid={`company-manage-${r.id}`}><Settings2 className="w-3.5 h-3.5" /> Yönet</button></td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {showNew && <NewCompanyModal plans={plans} onClose={() => setShowNew(false)} onCreated={(r) => { setShowNew(false); onCreated(r); }} />}
    </div>
  );
};

const NewCompanyModal = ({ plans, onClose, onCreated }) => {
  const [f, setF] = useState({ name: "", tax_number: "", city: "", phone: "", admin_name: "", admin_email: "", admin_password: "", plan_id: plans.find((p) => p.is_popular)?.id || plans[0]?.id || "", trial_days: 14, notes: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await axios.post(`${API_URL}/system/companies`, f); toast.success(`${r.data.name} oluşturuldu. Yönetici: ${f.admin_email}`); onCreated(r.data); } catch (err) { toast.error(err.response?.data?.detail || "Şirket oluşturulamadı."); } finally { setBusy(false); }
  };
  const F = (k, l, type = "text", req, span) => <div className={span ? "sm:col-span-2" : ""}><label className="block font-semibold text-slate-700 mb-1">{l}</label><input type={type} required={req} value={f[k]} onChange={(e) => set(k, e.target.value)} className={inputCls} data-testid={`new-company-${k}`} /></div>;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-2xl p-5 space-y-4 text-xs max-h-[90vh] overflow-y-auto" data-testid="new-company-modal">
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900">Yeni Müşteri Şirket Aç</h3><button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {F("name", "Şirket Ünvanı", "text", true, true)}<F k="tax_number" l="VKN / TCKN" />{F("city", "Şehir", "text", false, false)}{F("phone", "Telefon", "text", false, false)}
          <div className="sm:col-span-2 border-t pt-3 font-bold text-slate-900">Yönetici Hesabı</div>
          {F("admin_name", "Ad Soyad", "text", false, false)}{F("admin_email", "E-posta (giriş)", "email", true, false)}{F("admin_password", "Geçici Şifre (min 6)", "text", true, false)}
          <div><label className="block font-semibold text-slate-700 mb-1">Paket</label><select value={f.plan_id} onChange={(e) => set("plan_id", e.target.value)} className={inputCls} data-testid="new-company-plan">{plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.price_monthly} ₺/ay</option>)}</select></div>
          <div><label className="block font-semibold text-slate-700 mb-1">Deneme Süresi (gün, 0 = direkt aktif)</label><input type="number" min={0} value={f.trial_days} onChange={(e) => set("trial_days", Number(e.target.value))} className={inputCls} data-testid="new-company-trial" /></div>
          {F("notes", "Not (satış temsilcisi, sözleşme no…)", "text", false, true)}
        </div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 border rounded-xl font-semibold">Vazgeç</button><button type="submit" disabled={busy} className="px-5 py-2 bg-amber-400 text-slate-900 rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="new-company-submit">{busy && <Loader2 className="w-4 h-4 animate-spin" />} Şirketi Oluştur</button></div>
      </form>
    </div>
  );
};
