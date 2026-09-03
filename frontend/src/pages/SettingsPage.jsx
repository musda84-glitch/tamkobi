import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { Building2, MessageSquare, Mail, Landmark, ShoppingCart, Truck, FileCheck2, Printer, Upload, Save, Loader2, ListOrdered, Link as LinkIcon } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { SmsCenter } from "../components/SmsCenter";
import { MailClient } from "../components/MailClient";
import { BankConnectionsPanel } from "../components/BankConnectionsPanel";
import { PrintTemplateEditor } from "../components/PrintDocument";
import { resolveImageUrl } from "../utils/imageUrl";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const TABS = [["company", "Şirket Bilgileri", Building2], ["print", "Form & Yazdırma", Printer], ["einvoice", "E-Fatura Entegratörü", FileCheck2], ["sms", "SMS (Netgsm)", MessageSquare], ["mail", "E-posta Hesabı", Mail], ["bank", "Banka Bağlantıları", Landmark], ["channels", "E-Ticaret & Kargo", ShoppingCart], ["whatsapp", "WhatsApp Business", MessageSquare], ["modules", "Modül Sıralama", ListOrdered]];

const CompanyForm = ({ companyId }) => {
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get(`${API_URL}/companies/${companyId}`).then((r) => setC(r.data)); }, [companyId]);
  if (!c) return null;
  const set = (k, v) => setC({ ...c, [k]: v });
  const save = async (e) => { e.preventDefault(); setBusy(true); try { await axios.put(`${API_URL}/companies/${companyId}`, c); toast.success("Şirket bilgileri kaydedildi."); } catch { toast.error("Kaydedilemedi."); } finally { setBusy(false); } };
  const uploadLogo = async (e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append("file", f); try { const r = await axios.post(`${API_URL}/files/upload?entity=company&entity_id=${companyId}&company_id=${companyId}`, fd); setC({ ...c, logo_url: r.data.url }); toast.success("Logo yüklendi."); } catch (err) { toast.error(err.response?.data?.detail || "Logo yüklenemedi."); } };
  const fields = [["name", "Şirket Ünvanı"], ["tax_number", "VKN / TCKN"], ["tax_office", "Vergi Dairesi"], ["mersis", "MERSİS No"], ["trade_registry", "Ticaret Sicil No"], ["phone", "Telefon"], ["email", "E-posta"], ["website", "Web Sitesi"], ["address", "Adres"], ["city", "Şehir"], ["bank_name", "Banka"], ["iban", "IBAN"], ["e_invoice_alias", "GİB Posta Kutusu (PK)"]];
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 text-xs" data-testid="company-form">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">{c.logo_url ? <img src={resolveImageUrl(c.logo_url)} alt="logo" className="w-full h-full object-contain" /> : <Building2 className="w-8 h-8 text-slate-300" />}</div>
        <label className="flex items-center gap-1.5 px-3 py-2 border rounded-lg cursor-pointer hover:bg-slate-50 font-semibold"><Upload className="w-3.5 h-3.5" /> Logo Yükle<input type="file" accept="image/*" className="hidden" onChange={uploadLogo} data-testid="company-logo-input" /></label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{fields.map(([k, l]) => <div key={k} className={k === "address" ? "sm:col-span-2" : ""}><label className="block font-semibold text-slate-700 mb-1">{l}</label><input value={c[k] || ""} onChange={(e) => set(k, e.target.value)} className={inputCls} data-testid={`company-${k}-input`} /></div>)}</div>
      <div className="flex justify-end"><button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-60" data-testid="save-company-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Kaydet</button></div>
    </form>
  );
};

const EInvoiceSettings = ({ companyId }) => {
  const [providers, setProviders] = useState([]);
  const [s, setS] = useState(null);
  const [password, setPassword] = useState("");
  useEffect(() => { Promise.all([axios.get(`${API_URL}/einvoice/providers`), axios.get(`${API_URL}/einvoice/settings?company_id=${companyId}`)]).then(([p, st]) => { setProviders(p.data); setS(st.data); }); }, [companyId]);
  if (!s) return null;
  const prov = providers.find((p) => p.code === s.provider);
  const save = async (e) => { e.preventDefault(); try { const r = await axios.put(`${API_URL}/einvoice/settings`, { ...s, company_id: companyId, password }); setS(r.data); setPassword(""); toast.success(r.data.status === "configured" ? "Entegratör bilgileri kaydedildi." : "Kaydedildi — kimlik bilgisi girilmediği için SİMÜLE mod."); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } };
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs max-w-xl" data-testid="einvoice-settings">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold">E-Fatura / E-Arşiv / E-İrsaliye Entegratörü</h3><span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${s.status === "configured" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`} data-testid="einvoice-status">{s.status === "configured" ? "YAPILANDIRILDI" : "SİMÜLE"}</span></div>
      <p className="text-slate-500">Entegratör anahtarı girilmediği sürece GİB gönderimleri simüle edilir. Anahtar geldiğinde buradan girin, tüm fatura ekranları otomatik canlıya geçer.</p>
      <div><label className="block font-semibold mb-1">Entegratör</label><select value={s.provider} onChange={(e) => setS({ ...s, provider: e.target.value })} className={inputCls} data-testid="einvoice-provider-select"><option value="">Seçilmedi (Simüle)</option>{providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setS({ ...s, mode: "test" })} className={`p-2 rounded-lg border font-semibold ${s.mode === "test" ? "bg-amber-500 text-white border-amber-500" : ""}`}>Test Ortamı</button><button type="button" onClick={() => setS({ ...s, mode: "live" })} className={`p-2 rounded-lg border font-semibold ${s.mode === "live" ? "bg-emerald-600 text-white border-emerald-600" : ""}`}>Canlı</button></div>
      {(prov?.fields || []).includes("api_url") && <div><label className="block font-semibold mb-1">API URL</label><input value={s.api_url || ""} onChange={(e) => setS({ ...s, api_url: e.target.value })} className={`${inputCls} font-mono`} /></div>}
      <div className="grid grid-cols-2 gap-2"><div><label className="block font-semibold mb-1">Kullanıcı Adı</label><input value={s.username} onChange={(e) => setS({ ...s, username: e.target.value })} className={inputCls} data-testid="einvoice-username-input" /></div><div><label className="block font-semibold mb-1">Şifre {s.has_password && <span className="text-slate-400 font-normal">(kayıtlı)</span>}</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} data-testid="einvoice-password-input" /></div></div>
      <div><label className="block font-semibold mb-1">GİB Etiket / Alias</label><input value={s.alias || ""} onChange={(e) => setS({ ...s, alias: e.target.value })} placeholder="urn:mail:defaultpk@firma.com.tr" className={`${inputCls} font-mono`} /></div>
      <div className="flex justify-end"><button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold" data-testid="save-einvoice-btn">Kaydet</button></div>
    </form>
  );
};

const PrintSettings = ({ companyId }) => {
  const [editing, setEditing] = useState(null);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="print-settings">
      {[["invoice", "Fatura"], ["order", "Sipariş Formu"], ["quote", "Teklif"], ["dispatch", "İrsaliye"]].map(([k, l]) => (
        <button key={k} onClick={() => setEditing(k)} className="bg-white border border-slate-200 rounded-2xl p-5 text-left hover:border-emerald-500 hover:shadow-md transition" data-testid={`print-tpl-${k}`}><Printer className="w-5 h-5 text-slate-400 mb-2" /><div className="text-sm font-bold text-slate-900">{l}</div><div className="text-xs text-slate-500">Başlık, renk, notlar, logo/imza alanları</div></button>
      ))}
      {editing && <PrintTemplateEditor companyId={companyId} docType={editing} onClose={() => setEditing(null)} onSaved={() => toast.success("Form şablonu kaydedildi.")} />}
    </div>
  );
};

const WhatsAppSettings = ({ companyId }) => {
  const [s, setS] = useState(null); const [token, setToken] = useState("");
  useEffect(() => { axios.get(`${API_URL}/comm/whatsapp/settings?company_id=${companyId}`).then((r) => setS(r.data)); }, [companyId]);
  if (!s) return null;
  const save = async (e) => { e.preventDefault(); try { const r = await axios.put(`${API_URL}/comm/whatsapp/settings`, { ...s, company_id: companyId, access_token: token }); setS(r.data); setToken(""); toast.success(r.data.status === "connected" ? "WhatsApp Cloud API bağlandı." : "Kaydedildi — anahtar girilmeden SİMÜLE."); } catch { toast.error("Kaydedilemedi."); } };
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs max-w-xl" data-testid="whatsapp-settings">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold">WhatsApp Business (Meta Cloud API)</h3><span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${s.status === "connected" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`} data-testid="wa-status">{s.status === "connected" ? "BAĞLI" : "SİMÜLE"}</span></div>
      <p className="text-slate-500">Meta for Developers → WhatsApp → API Setup'tan Phone Number ID ve kalıcı erişim token'ı alın. Webhook URL: <code className="bg-slate-100 px-1 rounded">{window.location.origin}{s.webhook_url}</code> (gelen mesajlar telefon numarasına göre cari kartına düşer).</p>
      <div><label className="block font-semibold mb-1">Phone Number ID</label><input value={s.phone_number_id} onChange={(e) => setS({ ...s, phone_number_id: e.target.value })} className={`${inputCls} font-mono`} data-testid="wa-phone-id-input" /></div>
      <div><label className="block font-semibold mb-1">Erişim Token {s.has_token && <span className="text-slate-400 font-normal">(kayıtlı)</span>}</label><input type="password" value={token} onChange={(e) => setToken(e.target.value)} className={inputCls} data-testid="wa-token-input" /></div>
      <div><label className="block font-semibold mb-1">Webhook Verify Token</label><input value={s.verify_token} onChange={(e) => setS({ ...s, verify_token: e.target.value })} className={`${inputCls} font-mono`} placeholder="nexus-wa-verify" /></div>
      <div className="flex justify-end"><button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold" data-testid="save-wa-btn">Kaydet</button></div>
    </form>
  );
};

const ModuleOrder = () => {
  const { menuItems, moveModule, resetModuleOrder } = useAuth();
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 text-xs max-w-lg space-y-2" data-testid="module-order-settings">
      <div className="flex justify-between items-center"><h3 className="text-sm font-bold">Modül Sıralama</h3><button onClick={resetModuleOrder} className="text-slate-500 hover:underline">Varsayılana dön</button></div>
      <p className="text-slate-500">Sol menüde modülleri sürükleyip bırakarak da sıralayabilirsiniz.</p>
      {menuItems.map((m, i) => (
        <div key={m.path} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-testid={`module-order-row-${m.path.replace("/", "") || "dashboard"}`}>
          <span className="w-5 text-slate-400 font-mono">{i + 1}</span><span className="flex-1 font-semibold">{m.label}</span>
          <button onClick={() => moveModule(i, i - 1)} disabled={i === 0} className="px-2 py-0.5 border rounded disabled:opacity-30" data-testid={`module-up-${i}`}>↑</button>
          <button onClick={() => moveModule(i, i + 1)} disabled={i === menuItems.length - 1} className="px-2 py-0.5 border rounded disabled:opacity-30" data-testid={`module-down-${i}`}>↓</button>
        </div>
      ))}
    </div>
  );
};

export default function SettingsPage() {
  const { activeCompany } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const tab = searchParams.get("tab") || "company";
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  useEffect(() => { axios.get(`${API_URL}/contacts?company_id=${companyId}`).then((r) => setContacts(r.data)).catch(() => {}); axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).then((r) => setAccounts(r.data)).catch(() => {}); }, [companyId]);
  return (
    <div className="space-y-6" data-testid="settings-page">
      <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Firma Ayarları</h1><p className="text-xs sm:text-sm text-slate-500">Şirket bilgileri, form şablonları ve tüm entegrasyon ayarları tek yerde</p></div>
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">{TABS.map(([k, l, Icon]) => <button key={k} onClick={() => setSearchParams({ tab: k })} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`settings-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l}</button>)}</div>
      {tab === "company" && <CompanyForm companyId={companyId} />}
      {tab === "print" && <PrintSettings companyId={companyId} />}
      {tab === "einvoice" && <EInvoiceSettings companyId={companyId} />}
      {tab === "sms" && <SmsCenter companyId={companyId} contacts={contacts} />}
      {tab === "mail" && <MailClient companyId={companyId} />}
      {tab === "bank" && <BankConnectionsPanel companyId={companyId} accounts={accounts} contacts={contacts} />}
      {tab === "channels" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <a href="/ecommerce" className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-500 flex items-center gap-3" data-testid="settings-link-ecommerce"><ShoppingCart className="w-6 h-6 text-orange-500" /><div><div className="text-sm font-bold">E-Ticaret Entegrasyonları</div><div className="text-xs text-slate-500">Trendyol, Hepsiburada, N11… API anahtarları</div></div><LinkIcon className="w-4 h-4 text-slate-300 ml-auto" /></a>
          <a href="/cargo" className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-emerald-500 flex items-center gap-3" data-testid="settings-link-cargo"><Truck className="w-6 h-6 text-blue-500" /><div><div className="text-sm font-bold">Kargo Entegrasyonları</div><div className="text-xs text-slate-500">Yurtiçi, Aras, MNG, Sürat… API anahtarları</div></div><LinkIcon className="w-4 h-4 text-slate-300 ml-auto" /></a>
        </div>
      )}
      {tab === "whatsapp" && <WhatsAppSettings companyId={companyId} />}
      {tab === "modules" && <ModuleOrder />}
    </div>
  );
}
