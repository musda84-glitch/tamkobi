import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Save, Loader2, Check, Sparkles, ExternalLink } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { fmtTL, PlanChip, Toggle, inputCls, groupByCategory, PLAN_COLORS } from "./saasUi";

const cred = { withCredentials: true };

export const PlansPanel = ({ plans, catalog, onChanged }) => {
  const [edit, setEdit] = useState(null);
  const del = async (p) => { if (!window.confirm(`${p.name} paketi silinsin mi?`)) return; try { await axios.delete(`${API_URL}/system/plans/${p.id}`, cred); toast.success("Paket silindi."); onChanged(); } catch (e) { toast.error(e.response?.data?.detail || "Silinemedi."); } };
  const publish = async (p, on) => {
    try {
      await axios.put(`${API_URL}/system/plans/${p.id}`, { is_public: on }, cred);
      toast.success(on ? `${p.name} tamkobi.com vitrininde yayınlandı.` : `${p.name} siteden kaldırıldı.`);
      onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || "Güncellenemedi."); }
  };
  return (
    <div className="space-y-3 text-xs" data-testid="saas-plans">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-slate-500">“Yayınla” açık paketler <b>tamkobi.com</b> vitrininde görünür; kapalı olanlar gizlenir.</p>
        <div className="flex gap-2">
          <a href="/web" target="_blank" rel="noreferrer" className="px-3 py-2 border border-slate-200 rounded-xl font-semibold flex items-center gap-1.5 hover:bg-white" data-testid="plans-preview-site"><ExternalLink className="w-3.5 h-3.5" /> Sitede gör</a>
          <button onClick={() => setEdit({})} className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl font-bold flex items-center gap-1.5" data-testid="new-plan-btn"><Plus className="w-4 h-4" /> Yeni Paket</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {plans.map((p) => (
          <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col relative" data-testid={`plan-admin-${p.id}`}>
            {p.is_popular && <span className="absolute -top-2 right-3 bg-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" /> Popüler</span>}
            <div className="flex items-center justify-between"><PlanChip name={p.name} color={p.color} /><span className="text-[10px] text-slate-500">{p.company_count} şirket</span></div>
            <div className="text-[11px] text-slate-500 mt-2 min-h-[28px]">{p.tagline}</div>
            <div className="text-xl font-bold text-slate-900 mt-1">{fmtTL(p.price_monthly)}<span className="text-[10px] font-normal text-slate-500">/ay</span></div>
            <div className="text-[10px] text-slate-500">{fmtTL(p.price_yearly)}/yıl · {p.user_limit ? `${p.user_limit} kullanıcı` : "sınırsız kullanıcı"} · {p.company_limit ? `${p.company_limit} şirket` : "sınırsız şirket"} · {p.modules.length}/{catalog.filter((m) => !m.is_core).length} modül</div>
            <label className={`mt-2 flex items-center gap-2 font-semibold ${p.is_public ? "text-emerald-700" : "text-slate-500"}`}>
              <Toggle on={!!p.is_public} onChange={(v) => publish(p, v)} testId={`plan-publish-${p.id}`} />
              <span>{p.is_public ? "Sitede yayınlı" : "Gizli"}</span>
            </label>
            <ul className="mt-3 space-y-0.5 flex-1">{catalog.filter((m) => !m.is_core).map((m) => <li key={m.key} className={`flex items-center gap-1.5 ${p.modules.includes(m.key) ? "text-slate-700" : "text-slate-300"}`}><Check className={`w-3 h-3 ${p.modules.includes(m.key) ? "text-emerald-600" : "text-slate-200"}`} />{m.label}</li>)}</ul>
            <div className="flex gap-2 mt-3"><button onClick={() => setEdit(p)} className="flex-1 py-1.5 border rounded-lg font-semibold flex items-center justify-center gap-1 hover:bg-slate-50" data-testid={`plan-edit-${p.id}`}><Pencil className="w-3.5 h-3.5" /> Düzenle</button><button onClick={() => del(p)} className="px-2.5 py-1.5 border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50" data-testid={`plan-delete-${p.id}`}><Trash2 className="w-3.5 h-3.5" /></button></div>
          </div>))}
      </div>
      {edit && <PlanEditor plan={edit} catalog={catalog} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
    </div>
  );
};

const PlanEditor = ({ plan, catalog, onClose, onSaved }) => {
  const [f, setF] = useState({ name: plan.name || "", tagline: plan.tagline || "", price_monthly: plan.price_monthly ?? 0, price_yearly: plan.price_yearly ?? 0, user_limit: plan.user_limit ?? 0, company_limit: plan.company_limit ?? 1, modules: plan.modules || [], color: plan.color || "slate", sort: plan.sort ?? 99, is_public: plan.is_public ?? true, is_popular: plan.is_popular ?? false });
  const [busy, setBusy] = useState(false);
  const groups = groupByCategory(catalog);
  const toggleMod = (k) => setF({ ...f, modules: f.modules.includes(k) ? f.modules.filter((x) => x !== k) : [...f.modules, k] });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { if (plan.id) await axios.put(`${API_URL}/system/plans/${plan.id}`, f, cred); else await axios.post(`${API_URL}/system/plans`, f, cred); toast.success("Paket kaydedildi."); onSaved(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  const num = (k, l) => <div><label className="block font-semibold text-slate-700 mb-1">{l}</label><input type="number" min={0} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} className={inputCls} data-testid={`plan-${k}`} /></div>;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-3xl p-5 space-y-4 text-xs max-h-[90vh] overflow-y-auto" data-testid="plan-editor">
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900">{plan.id ? `${plan.name} paketini düzenle` : "Yeni Paket"}</h3><button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="block font-semibold text-slate-700 mb-1">Paket Adı</label><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} data-testid="plan-name" /></div>
          <div className="sm:col-span-2"><label className="block font-semibold text-slate-700 mb-1">Slogan</label><input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} className={inputCls} data-testid="plan-tagline" /></div>
          {num("price_monthly", "Aylık Fiyat (₺)")}{num("price_yearly", "Yıllık Fiyat (₺)")}{num("user_limit", "Kullanıcı Limiti (0 = sınırsız)")}{num("company_limit", "Şirket Limiti (0 = sınırsız)")}
          <div><label className="block font-semibold text-slate-700 mb-1">Renk</label><div className="flex gap-1.5">{Object.keys(PLAN_COLORS).map((c) => <button type="button" key={c} onClick={() => setF({ ...f, color: c })} className={`w-7 h-7 rounded-lg ${PLAN_COLORS[c]} ${f.color === c ? "ring-2 ring-offset-1 ring-slate-900" : ""}`} data-testid={`plan-color-${c}`} />)}</div></div>
          {num("sort", "Sıra")}
          <div className="flex items-center gap-4 pt-5"><label className="flex items-center gap-2"><Toggle on={f.is_public} onChange={(v) => setF({ ...f, is_public: v })} testId="plan-public" /> <span>tamkobi.com’da yayınla</span></label><label className="flex items-center gap-2"><Toggle on={f.is_popular} onChange={(v) => setF({ ...f, is_popular: v })} testId="plan-popular" /> <span>Popüler</span></label></div>
        </div>
        <div>
          <div className="font-bold text-slate-900 mb-2">Pakete Dahil Modüller ({f.modules.length})</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{Object.entries(groups).map(([cat, mods]) => (
            <div key={cat} className="border border-slate-100 rounded-xl p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{cat}</div>
              <ul className="space-y-1.5">{mods.map((m) => <li key={m.key} className="flex items-center justify-between gap-2"><span className={f.modules.includes(m.key) ? "text-slate-800 font-semibold" : "text-slate-400"}>{m.label}</span><Toggle on={f.modules.includes(m.key)} onChange={() => toggleMod(m.key)} testId={`plan-mod-${m.key.replace("/", "")}`} /></li>)}</ul></div>))}</div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 border rounded-xl font-semibold">Vazgeç</button><button type="submit" disabled={busy} className="px-5 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 disabled:opacity-60" data-testid="plan-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
      </form>
    </div>
  );
};
