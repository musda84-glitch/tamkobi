import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Loader2, Rocket } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PLAN_COLORS } from "../components/saas/saasUi";
import { SiteHeader, siteBrand } from "../components/saas/SiteChrome";
import ModulePackBuilder from "../components/saas/ModulePackBuilder";
import { parseModuleKeys, packQuote } from "../utils/modulePack";

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/50 placeholder:text-slate-600";

export default function SignupPage() {
  const [params] = useSearchParams();
  const [d, setD] = useState(null);
  const [f, setF] = useState({ company_name: "", tax_number: "", city: "", phone: "", name: "", email: "", password: "", plan_id: params.get("plan") || "" });
  const [picked, setPicked] = useState(() => parseModuleKeys(params.get("modules") || ""));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const customMode = picked.length > 0;
  useEffect(() => { axios.get(`${API_URL}/public/plans`).then((r) => { setD(r.data); if (!f.plan_id && !picked.length) setF((x) => ({ ...x, plan_id: (r.data.plans.find((p) => p.is_popular) || r.data.plans[0])?.id || "" })); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const payload = { ...f };
    if (picked.length) { payload.modules = picked; delete payload.plan_id; }
    try { const r = await axios.post(`${API_URL}/public/signup`, payload, { withCredentials: true }); setDone(r.data); toast.success(r.data.message); } catch (err) { toast.error(err.response?.data?.detail || "Kayıt yapılamadı."); } finally { setBusy(false); }
  };
  const plan = d?.plans?.find((p) => p.id === f.plan_id);
  const customTotal = packQuote(d?.catalog || [], picked, false);
  if (done) return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 flex items-center justify-center p-6"><div className="bg-white/5 border border-white/10 rounded-3xl p-10 max-w-md text-center space-y-4" data-testid="signup-success">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500 text-slate-900 flex items-center justify-center"><Rocket className="w-7 h-7" /></div>
      <h2 className="text-xl font-bold">Hesabınız hazır!</h2><p className="text-sm text-slate-300">{done.message} Paket: <b>{done.license?.plan_name}</b> · {done.license?.days_left} gün.</p>
      <a href="/panel" className="inline-flex px-5 py-3 bg-emerald-500 text-slate-900 rounded-xl font-bold text-sm" data-testid="signup-go-app">Uygulamaya Git</a></div></div>);
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100" data-testid="signup-page">
      <SiteHeader brand={siteBrand(d?.brand_name)} right={<Link to="/login" className="text-xs text-slate-300 hover:text-white">Zaten hesabım var</Link>} />
      <div className="max-w-5xl mx-auto px-6 pb-16 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        <form onSubmit={submit} className="space-y-5">
          <div><h1 className="text-3xl sm:text-4xl font-black">{d?.trial_days || 14} gün ücretsiz deneyin</h1><p className="text-sm text-slate-400 mt-2">Kredi kartı gerekmez. Deneme bitiminde dilediğiniz pakete geçebilirsiniz.</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="sm:col-span-2"><label className="block font-semibold text-slate-300 mb-1">Şirket Ünvanı *</label><input required value={f.company_name} onChange={set("company_name")} className={inputCls} placeholder="Örn. Yıldız Mobilya Ltd. Şti." data-testid="signup-company" /></div>
            <div><label className="block font-semibold text-slate-300 mb-1">VKN / TCKN</label><input value={f.tax_number} onChange={set("tax_number")} className={inputCls} data-testid="signup-tax" /></div>
            <div><label className="block font-semibold text-slate-300 mb-1">Şehir</label><input value={f.city} onChange={set("city")} className={inputCls} data-testid="signup-city" /></div>
            <div><label className="block font-semibold text-slate-300 mb-1">Ad Soyad *</label><input required value={f.name} onChange={set("name")} className={inputCls} data-testid="signup-name" /></div>
            <div><label className="block font-semibold text-slate-300 mb-1">Telefon (WhatsApp)</label><input value={f.phone} onChange={set("phone")} className={inputCls} placeholder="05xx xxx xx xx" data-testid="signup-phone" /></div>
            <div><label className="block font-semibold text-slate-300 mb-1">E-posta *</label><input type="email" required value={f.email} onChange={set("email")} className={inputCls} data-testid="signup-email" /></div>
            <div><label className="block font-semibold text-slate-300 mb-1">Şifre * (min 6)</label><input type="password" required minLength={6} value={f.password} onChange={set("password")} className={inputCls} data-testid="signup-password" /></div>
          </div>
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={() => { setPicked([]); }} className={`px-3 py-1.5 rounded-lg font-semibold border ${!customMode ? "bg-white text-slate-900 border-white" : "border-white/10 text-slate-300"}`} data-testid="signup-mode-plans">Hazır paket</button>
            <button type="button" onClick={() => { if (!picked.length) setPicked(["/invoices", "/contacts"]); setF((x) => ({ ...x, plan_id: "" })); }} className={`px-3 py-1.5 rounded-lg font-semibold border ${customMode ? "bg-white text-slate-900 border-white" : "border-white/10 text-slate-300"}`} data-testid="signup-mode-custom">Kendi paketim</button>
          </div>
          {customMode ? (
            <ModulePackBuilder catalog={d?.catalog || []} selected={picked} onChange={setPicked} />
          ) : (
            <div><label className="block font-semibold text-slate-300 mb-2 text-xs">Denemek istediğiniz paket</label><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{(d?.plans || []).map((p) => <button type="button" key={p.id} onClick={() => setF({ ...f, plan_id: p.id })} className={`rounded-xl p-3 text-left border transition ${f.plan_id === p.id ? "bg-white text-slate-900 border-white" : "bg-white/5 border-white/10 hover:bg-white/10"}`} data-testid={`signup-plan-${p.id}`}><div className="text-xs font-bold">{p.name}</div><div className={`text-[10px] ${f.plan_id === p.id ? "text-slate-500" : "text-slate-400"}`}>{p.modules.length} modül</div></button>)}</div></div>
          )}
          <button disabled={busy || (customMode && !picked.length)} className="w-full sm:w-auto px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60" data-testid="signup-submit">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} Denemeyi Başlat</button>
          <p className="text-[11px] text-slate-500">Kayıt olarak kullanım koşullarını kabul edersiniz. Verileriniz yalnızca şirketinize aittir.</p>
        </form>
        {customMode ? (
          <aside className="bg-white/5 border border-white/10 rounded-3xl p-6 h-fit lg:sticky lg:top-6" data-testid="signup-custom-summary">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white">Özel Paket</span>
            <div className="text-xs text-slate-400 mt-2">Seçtiğiniz {picked.length} modül</div>
            <div className="mt-3 text-2xl font-black">{customTotal.toLocaleString("tr-TR")} ₺<span className="text-xs text-slate-400 font-normal"> /ay · deneme sonrası</span></div>
            <ul className="mt-4 space-y-1.5 text-xs">{(d?.catalog || []).filter((m) => picked.includes(m.key)).map((m) => <li key={m.key} className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400" />{m.label}</li>)}</ul>
          </aside>
        ) : plan && <aside className="bg-white/5 border border-white/10 rounded-3xl p-6 h-fit lg:sticky lg:top-6" data-testid="signup-plan-summary">
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${PLAN_COLORS[plan.color] || PLAN_COLORS.slate}`}>{plan.name}</span>
          <div className="text-xs text-slate-400 mt-2">{plan.tagline}</div>
          <div className="mt-3 text-2xl font-black">{Number(plan.price_monthly).toLocaleString("tr-TR")} ₺<span className="text-xs text-slate-400 font-normal"> /ay · deneme sonrası</span></div>
          <ul className="mt-4 space-y-1.5 text-xs">{(d?.catalog || []).filter((m) => plan.modules.includes(m.key)).map((m) => <li key={m.key} className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400" />{m.label}</li>)}</ul>
        </aside>}
      </div>
    </div>
  );
}
